import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  lookupVehicle, newCarMarket, incentives, autodevTco, autodevApr, plateToVin, photoFor, configured, ProviderError,
} from './providers.js';
import { usageThisMonth, cacheDir } from './cache.js';
import { ask, askConfigured } from './ask.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

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
    providers: { ...configured(), ask: askConfigured() },
    usage,
    limits: { marketcheck: Number(process.env.MARKETCHECK_MONTHLY_LIMIT || 500), autodev: Number(process.env.AUTODEV_MONTHLY_LIMIT || 1000) },
  });
});

app.get('/api/vehicle/:vin', wrap((req) => lookupVehicle({ vin: req.params.vin, miles: req.query.miles, zip: req.query.zip })));
app.get('/api/plate', wrap((req) => plateToVin({ state: req.query.state, plate: req.query.plate })));
app.get('/api/new-market', wrap((req) => newCarMarket(req.query)));
app.get('/api/incentives', wrap((req) => incentives(req.query)));
app.get('/api/photo', wrap((req) => photoFor(req.query)));
app.post('/api/ask', async (req, res) => {
  try { res.json(await ask(req.body || {})); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
app.get('/api/autodev/tco/:vin', wrap((req) => autodevTco({ vin: req.params.vin, zip: req.query.zip })));
app.get('/api/autodev/apr/:vin', wrap((req) => autodevApr({ vin: req.params.vin, ...req.query })));

// One saved profile (your car + comparisons) so phone and laptop see the same numbers.
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
app.get('/api/profile', (_req, res) => {
  try { res.json(JSON.parse(fs.readFileSync(PROFILE, 'utf8'))); } catch { res.json(null); }
});
app.put('/api/profile', (req, res) => {
  try {
    fs.writeFileSync(PROFILE, JSON.stringify({ ...req.body, savedAt: new Date().toISOString() }));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'], maxAge: '5m' }));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  const p = configured();
  console.log(`Lease Buyout Advisor on :${port} — MarketCheck ${p.marketcheck ? 'on' : 'off'}, auto.dev ${p.autodev ? 'on' : 'off'}${p.mock ? ' (MOCK)' : ''}, cache ${cacheDir}, password ${PASSWORD ? 'on' : 'off'}`);
});
