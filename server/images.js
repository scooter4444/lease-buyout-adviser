// Phone-sized copies of dealer photos. Dealer images are often 1–2 MB; these come out around
// 50–120 KB as WebP, cached on disk. Only URLs this server signed can be fetched, so it isn't an
// open proxy. If sharp can't load, the original image is passed through unchanged.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cacheDir } from './cache.js';

const DIR = path.join(cacheDir, 'img');
try { fs.mkdirSync(DIR, { recursive: true }); } catch {}

let SECRET = process.env.IMG_SECRET;
if (!SECRET) {
  const f = path.join(cacheDir, 'img-secret');
  try { SECRET = fs.readFileSync(f, 'utf8').trim(); } catch {}
  if (!SECRET) { SECRET = crypto.randomBytes(24).toString('hex'); try { fs.writeFileSync(f, SECRET); } catch {} }
}

let sharpMod;
async function sharp() {
  if (sharpMod !== undefined) return sharpMod;
  try { sharpMod = (await import('sharp')).default; } catch (e) { console.warn('[img] sharp unavailable, passing images through:', e.message); sharpMod = null; }
  return sharpMod;
}

const sig = (url) => crypto.createHmac('sha256', SECRET).update(url).digest('base64url').slice(0, 22);
export const WIDTHS = { thumb: 480, view: 800, full: 1400 };
export function signImg(url, w = WIDTHS.view) {
  if (!/^https?:\/\//i.test(String(url || ''))) return url; // demo data URLs stay as they are
  return `api/img?${new URLSearchParams({ u: url, w: String(w), s: sig(url) })}`;
}

// Drop resized copies nobody has asked for in 45 days.
function prune() {
  const old = Date.now() - 45 * 86400000;
  try { for (const f of fs.readdirSync(DIR)) { const p = path.join(DIR, f); if (fs.statSync(p).atimeMs < old) fs.unlinkSync(p); } } catch {}
}
setTimeout(prune, 5 * 60 * 1000).unref();

async function fetchImage(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (LeaseBuyoutAdvisor)', Accept: 'image/*' }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
  const type = (r.headers.get('content-type') || '').split(';')[0].trim();
  if (!r.ok || !/^image\//.test(type)) throw new Error(`image fetch ${r.status} ${type}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 12e6) throw new Error('image too large');
  return { buf, type };
}

const inflight = new Map();
// Resized bytes for a URL at a width, from disk when we've made it before.
export async function resized(url, w, format = 'webp') {
  const width = Math.max(160, Math.min(1600, Number(w) || WIDTHS.view));
  const key = crypto.createHash('sha1').update(`${url}|${width}|${format}`).digest('hex');
  const file = path.join(DIR, `${key}.${format}`);
  try { const buf = fs.readFileSync(file); const now = new Date(); fs.utimes(file, now, now, () => {}); return { buf, type: `image/${format}` }; } catch {}
  if (inflight.has(key)) return inflight.get(key);
  const job = (async () => {
    const src = await fetchImage(url);
    const s = await sharp();
    if (!s) return src;
    const img = s(src.buf, { failOn: 'none' }).rotate().resize({ width, withoutEnlargement: true });
    const buf = format === 'jpeg' ? await img.jpeg({ quality: 74, mozjpeg: true }).toBuffer() : await img.webp({ quality: 70 }).toBuffer();
    try { fs.writeFileSync(file, buf); } catch {}
    return { buf, type: `image/${format}` };
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

export async function serveImg(req, res) {
  const { u, w, s } = req.query;
  if (!u || !s || s !== sig(String(u))) return res.status(403).json({ error: 'Unsigned image URL' });
  try {
    const { buf, type } = await resized(String(u), w);
    res.set('Cache-Control', 'public, max-age=2592000, immutable');
    res.type(type).send(buf);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
