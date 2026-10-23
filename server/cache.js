// Small persistent cache + monthly usage counter.
// MarketCheck's free tier is 500 calls/month, so every lookup is cached and counted.
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.env.CACHE_DIR || (fs.existsSync('/data') ? '/data' : path.resolve('.cache'));
const FILE = path.join(DIR, 'cache.json');
const USAGE_FILE = path.join(DIR, 'usage.json');

let store = {};
let usage = {};
try { fs.mkdirSync(DIR, { recursive: true }); } catch {}
try { store = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
try { usage = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')); } catch {}

let dirty = false;
setInterval(flush, 15000).unref();
process.on('SIGTERM', () => { flush(); process.exit(0); });

function flush() {
  if (!dirty) return;
  dirty = false;
  try {
    // Drop expired entries before writing.
    const now = Date.now();
    for (const k of Object.keys(store)) if (store[k].exp < now) delete store[k];
    fs.writeFileSync(FILE, JSON.stringify(store));
    fs.writeFileSync(USAGE_FILE, JSON.stringify(usage));
  } catch (e) {
    console.warn('cache flush failed:', e.message);
  }
}

export function getCached(key) {
  const hit = store[key];
  if (hit && hit.exp > Date.now()) return hit.value;
  return undefined;
}

export function setCached(key, value, ttlSeconds) {
  store[key] = { value, exp: Date.now() + ttlSeconds * 1000 };
  dirty = true;
}

const month = () => new Date().toISOString().slice(0, 7);

export function countCall(provider) {
  const m = month();
  usage[m] ??= {};
  usage[m][provider] = (usage[m][provider] || 0) + 1;
  dirty = true;
}

export function usageThisMonth() {
  return usage[month()] || {};
}

export const cacheDir = DIR;
