import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  lookupVehicle, newCarMarket, incentives, dealSweep, autodevTco, autodevApr, plateToVin, photoFor, nhtsaSafety, gallery, cutoutsConfigured, configured, ProviderError,
} from './providers.js';
import { usageThisMonth, cacheDir } from './cache.js';
import { ask, askConfigured, readImage } from './ask.js';
import { startRepricer } from './repricer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' }));

// Keep the app out of search engines: link-only access.
app.use((_req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet'); next(); });
app.get('/robots.txt', (_req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /\n'));

// Optional password gate (HTTP Basic), off unless APP_PASSWORD is set.
const PASSWORD = process.env.APP_PASSWORD;
app.use((req, res, next) => {
  if (!PASSWORD || req.path === '/api/health' || req.path === '/robots.txt') return next();
  const [scheme, encoded] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const pass = Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':');
    const a = crypto.createHash('sha256').update(pass).digest();
    const b = crypto.createHash('sha256').update(PASSWORD).digest();
    if (crypto.timingSafeEqual(a, b)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Lease Buyout Advisor"').status(401).send('Password required');
});

const wrap = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (e) {
    const status = e instanceof ProviderError && e.status >= 400 && e.status < 500 ? e.status : 502;
    console.error('request failed:', req.path, e.message);
    res.status(status).json({ error: e.message, provider: e.provider || 'app' });
  }
};

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/status', (_req, res) => {
  const usage = usageThisMonth();
  res.json({
    providers: { ...configured(), ask: askConfigured(), cutouts: cutoutsConfigured() },
    usage,
    limits: { marketcheck: Number(process.env.MARKETCHECK_MONTHLY_LIMIT || 500), autodev: Number(process.env.AUTODEV_MONTHLY_LIMIT || 1000) },
  });
});

app.get('/api/vehicle/:vin', wrap((req) => lookupVehicle({ vin: req.params.vin, miles: req.query.miles, zip: req.query.zip })));
app.get('/api/plate', wrap((req) => plateToVin({ state: req.query.state, plate: req.query.plate })));
app.get('/api/new-market', wrap((req) => newCarMarket(req.query)));
app.get('/api/incentives', wrap((req) => incentives(req.query)));
app.get('/api/deals', wrap((req) => dealSweep(req.query)));
app.get('/api/safety', wrap((req) => nhtsaSafety(req.query)));
app.get('/api/gallery', wrap((req) => gallery(req.query)));
app.get('/api/photo', wrap((req) => photoFor(req.query)));
app.post('/api/read-image', async (req, res) => {
  try { res.json(await readImage(req.body || {})); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
app.post('/api/ask', async (req, res) => {
  try { res.json(await ask(req.body || {})); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
app.get('/api/autodev/tco/:vin', wrap((req) => autodevTco({ vin: req.params.vin, zip: req.query.zip })));
app.get('/api/autodev/apr/:vin', wrap((req) => autodevApr({ vin: req.params.vin, ...req.query })));

// One saved profile (your car + comparisons) so phone and laptop see the same numbers.
// Your own car photos (uploaded from the app), kept on the volume, never in the repo.
const PHOTOS = path.join(cacheDir, 'photos');
try { fs.mkdirSync(PHOTOS, { recursive: true }); } catch {}
app.use('/photos', express.static(PHOTOS, { maxAge: '30d' }));
app.post('/api/photo-upload', (req, res) => {
  const { id, dataUrl } = req.body || {};
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  const safe = String(id || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40);
  if (!m || !safe) return res.status(400).json({ error: 'Send a PNG, JPEG or WebP image.' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 6 * 1024 * 1024) return res.status(413).json({ error: 'That image is too large (6 MB max).' });
  const file = `${safe}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  for (const ext of ['png', 'jpg', 'webp']) { try { fs.unlinkSync(path.join(PHOTOS, `${safe}.${ext}`)); } catch {} }
  fs.writeFileSync(path.join(PHOTOS, file), buf);
  res.json({ url: `photos/${file}?v=${Date.now()}` });
});

// Saved cars live here (shape: { active, profiles: { id: {...} } }).
// SEED_PROFILE (a Railway variable, never committed) pre-loads cars on first run.
const PROFILE = path.join(cacheDir, 'profile.json');
if (!fs.existsSync(PROFILE) && process.env.SEED_PROFILE) {
  try {
    fs.writeFileSync(PROFILE, JSON.stringify(JSON.parse(process.env.SEED_PROFILE)));
    console.log('Seeded saved cars from SEED_PROFILE');
  } catch (e) {
    console.warn('SEED_PROFILE is not valid JSON:', e.message);
  }
}
const readStore = () => { try { return JSON.parse(fs.readFileSync(PROFILE, 'utf8')); } catch { return null; } };
const writeStore = (st) => { fs.writeFileSync(`${PROFILE}.tmp`, JSON.stringify(st)); fs.renameSync(`${PROFILE}.tmp`, PROFILE); };
app.get('/api/profile', (_req, res) => res.json(readStore()));
app.put('/api/profile', (req, res) => {
  try {
    const cur = readStore();
    // Prices were refreshed on the server since this copy was loaded: tell the app to reload.
    if (cur?.rev && (Number(req.body?.rev) || 0) < cur.rev) return res.status(409).json({ error: 'stale', rev: cur.rev });
    writeStore({ ...req.body, rev: cur?.rev || 0, shares: cur?.shares || {}, savedAt: new Date().toISOString() });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Re-pricing on a schedule (overnight), and on demand for one car.
const repricer = startRepricer({ file: PROFILE, readStore, writeStore });
app.post('/api/reprice-now', async (_req, res) => {
  try { await repricer.runNow(); res.json({ ok: true, store: readStore() }); } catch (e) { res.status(500).json({ error: e.message }); }
});

// Share links: a read-only page for one car (no VIN), e.g. for Carol.
app.post('/api/share', (req, res) => {
  const st = readStore();
  const id = String(req.body?.profileId || '');
  if (!st?.profiles?.[id]) return res.status(404).json({ error: 'Save the car first, then share it.' });
  st.shares ||= {};
  let token = Object.keys(st.shares).find((t) => st.shares[t] === id);
  if (!token) { token = crypto.randomBytes(9).toString('base64url'); st.shares[token] = id; writeStore(st); }
  res.json({ url: `s/${token}` });
});
app.get('/api/share/:token', (req, res) => {
  const st = readStore();
  const id = st?.shares?.[req.params.token];
  const p = id && st.profiles?.[id];
  if (!p) return res.status(404).json({ error: 'This share link no longer works.' });
  const { vin, ...current } = p.current || {};
  void vin;
  res.json({ name: p.name, pricing: p.pricing, photo: p.photo, assumptions: p.assumptions, current, candidates: p.candidates, repricedAt: p.repricedAt || null, lookup: p.lookup ? { recalls: p.lookup.recalls || null, valuation: p.lookup.valuation || null, vehicle: { ...(p.lookup.vehicle || {}), vin: undefined } } : null });
});
app.get('/s/:token', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'share.html')));

app.get('/vendor/zxing.js', (_req, res) => res.sendFile(path.join(__dirname, '..', 'node_modules', '@zxing', 'library', 'umd', 'index.min.js'), { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'], maxAge: '5m' }));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  const p = configured();
  console.log(`Lease Buyout Advisor on :${port} — MarketCheck ${p.marketcheck ? 'on' : 'off'}, auto.dev ${p.autodev ? 'on' : 'off'}${p.mock ? ' (MOCK)' : ''}, cache ${cacheDir}, password ${PASSWORD ? 'on' : 'off'}`);
});
