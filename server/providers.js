// Data providers: MarketCheck (market value, new-car prices, incentives, recalls)
// and auto.dev (VIN decode, listings, and paid-plan payments/APR/TCO if available).
// Every call is cached and failures are returned as structured errors so the UI
// can fall back to manual entry instead of breaking.
import { getCached, setCached, countCall } from './cache.js';
import * as mock from './mock.js';

const MC_BASE = 'https://api.marketcheck.com';
const AD_BASE = 'https://api.auto.dev';
const MOCK = process.env.MOCK === '1';

const mcKey = () => process.env.MARKETCHECK_API_KEY;
const adKey = () => process.env.AUTODEV_API_KEY;

export function configured() {
  return { marketcheck: MOCK || !!mcKey(), autodev: MOCK || !!adKey(), mock: MOCK };
}

export class ProviderError extends Error {
  constructor(provider, status, message) {
    super(message);
    this.provider = provider;
    this.status = status;
  }
}

function describe(status, body) {
  const msg = body?.message || body?.error?.message || body?.error || body?.detail || '';
  if (status === 401) return 'API key rejected';
  if (status === 403) return `Not included in your plan${msg ? ` (${String(msg).slice(0, 120)})` : ''}`;
  if (status === 429) return 'Rate limit or monthly quota reached';
  if (status === 404) return 'No data found';
  return `HTTP ${status}${msg ? `: ${String(msg).slice(0, 160)}` : ''}`;
}

// Free tiers allow ~5 calls/second: space live calls per provider (cache hits skip this).
const nextSlot = {};
async function pace(provider, gapMs = 350) {
  const now = Date.now();
  const at = Math.max(now, nextSlot[provider] || 0);
  nextSlot[provider] = at + gapMs;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

async function getJSON(provider, url, { headers = {}, ttl, cacheKey }, attempt = 0) {
  const key = cacheKey || `${provider}:${url.replace(/(api_key|apiKey)=[^&]+/, '')}`;
  const hit = getCached(key);
  if (hit !== undefined) return hit;
  await pace(provider);
  countCall(provider);
  const started = Date.now();
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(20000) });
  } catch (e) {
    throw new ProviderError(provider, 0, `Network error: ${e.message}`);
  }
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 300) }; }
  const safeUrl = url.replace(/(api_key|apiKey)=[^&]+/, '$1=***');
  console.log(`[${provider}] ${res.status} ${Date.now() - started}ms ${safeUrl} keys=${Object.keys(body || {}).slice(0, 12).join(',')}`);
  if (res.status === 429 && attempt < 4) {
    await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
    return getJSON(provider, url, { headers, ttl, cacheKey }, attempt + 1);
  }
  if (!res.ok) throw new ProviderError(provider, res.status, describe(res.status, body));
  setCached(key, body, ttl);
  return body;
}

const qs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

function mc(path, params, ttl) {
  if (MOCK) return mock.marketcheck(path, params);
  if (!mcKey()) throw new ProviderError('marketcheck', 0, 'MARKETCHECK_API_KEY not set');
  return getJSON('marketcheck', `${MC_BASE}${path}?${qs({ api_key: mcKey(), ...params })}`, { ttl });
}

function ad(path, params, ttl) {
  if (MOCK) return mock.autodev(path, params);
  if (!adKey()) throw new ProviderError('autodev', 0, 'AUTODEV_API_KEY not set');
  const q = qs(params || {});
  return getJSON('autodev', `${AD_BASE}${path}${q ? `?${q}` : ''}`, {
    ttl,
    headers: { Authorization: `Bearer ${adKey()}` },
    cacheKey: `autodev:${path}?${q}`,
  });
}

const DAY = 86400;
const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function attempt(fn) {
  try { return { ok: true, data: await fn() }; } catch (e) {
    return { ok: false, error: { provider: e.provider || 'app', status: e.status ?? 0, message: e.message } };
  }
}

// ---------- Current vehicle ----------

export async function lookupVehicle({ vin, miles, zip }) {
  vin = String(vin || '').trim().toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) throw new ProviderError('app', 400, 'VIN must be 17 characters (no I, O or Q)');
  miles = Number(miles) || undefined;
  const errors = [];
  const sources = {};

  // 1. Decode — auto.dev first (free tier), MarketCheck basic decode for MPG.
  const [adDecode, mcSpecs] = await Promise.all([
    attempt(() => ad(`/vin/${vin}`, null, 90 * DAY)),
    attempt(() => mc(`/v2/decode/car/${vin}/specs`, {}, 90 * DAY)),
  ]);
  if (!adDecode.ok) errors.push(adDecode.error);
  if (!mcSpecs.ok) errors.push(mcSpecs.error);
  const d = adDecode.ok ? adDecode.data : {};
  const s = mcSpecs.ok ? mcSpecs.data : {};
  const city = Number(s.city_mpg) || null;
  const hwy = Number(s.highway_mpg) || null;
  const vehicle = {
    vin,
    year: Number(d.vehicle?.year || s.year) || null,
    make: d.make || d.vehicle?.make || s.make || '',
    model: d.model || d.vehicle?.model || s.model || '',
    trim: d.trim || s.trim || '',
    style: d.style || '',
    body: d.body || s.body_type || '',
    engine: d.engine || s.engine || '',
    drivetrain: d.drive || s.drivetrain || '',
    fuelType: s.fuel_type || '',
    powertrain: s.powertrain_type || '',
    mpg: city && hwy ? Math.round(0.55 * city + 0.45 * hwy) : (city || hwy || null),
  };
  if (adDecode.ok) sources.decode = 'auto.dev';
  else if (mcSpecs.ok) sources.decode = 'MarketCheck';

  // 2. Market value — MarketCheck Price, falling back to local comparable listings.
  let valuation = null;
  if (miles && zip) {
    const price = await attempt(() => mc('/v2/predict/car/us/marketcheck_price', { vin, miles, zip, dealer_type: 'franchise' }, 2 * DAY));
    if (price.ok && price.data?.marketcheck_price) {
      valuation = { marketValue: price.data.marketcheck_price, msrp: price.data.msrp || null, method: 'MarketCheck Price™ (franchise dealer retail)' };
      sources.value = 'MarketCheck';
    } else {
      if (!price.ok) errors.push(price.error);
      if (vehicle.year && vehicle.make && vehicle.model) {
        const comps = await comparables({ ...vehicle, miles, zip });
        if (comps.ok) { valuation = comps.data; sources.value = comps.data.source; } else errors.push(comps.error);
      }
    }
  }

  // 3. Recalls (MarketCheck AutoRecalls; auto.dev as backup).
  let recalls = null;
  const mr = await attempt(() => mc(`/v2/car/autorecalls/${vin}`, {}, 7 * DAY));
  if (mr.ok) {
    const items = mr.data?.data?.items?.[0]?.recalls || [];
    recalls = items.map((r) => ({
      id: r.nhtsaNumber || r.oemRecallNumber,
      title: r.recallTitle,
      description: r.recallDescription,
      risk: r.riskDescription,
      remedy: r.remedyDescription,
      status: r.status || r.recallState,
      date: r.recallIssueDate,
    }));
    sources.recalls = 'AutoRecalls via MarketCheck';
  } else {
    errors.push(mr.error);
    const ar = await attempt(() => ad(`/openrecalls/${vin}`, null, 7 * DAY));
    if (ar.ok) {
      const list = ar.data?.data || ar.data?.recalls || ar.data?.openRecalls || [];
      recalls = (Array.isArray(list) ? list : []).map((r) => ({
        id: r.nhtsaCampaignNumber || r.campaignNumber || r.NHTSACampaignNumber || r.id,
        title: r.component || r.Component || r.title,
        description: r.summary || r.Summary || r.description,
        remedy: r.remedy || r.Remedy,
        status: r.status || 'Open',
        date: r.reportReceivedDate || r.date,
      }));
      sources.recalls = 'auto.dev';
    } else errors.push(ar.error);
  }

  return { vehicle, valuation, recalls, sources, errors };
}

async function comparables({ year, make, model, trim, miles, zip }) {
  // MarketCheck used-car comps first.
  const mcTry = await attempt(() => mc('/v2/search/car/active', {
    car_type: 'used', year, make, model, zip, radius: 100,
    miles_range: `${Math.max(0, miles - 15000)}-${miles + 15000}`,
    stats: 'price,miles', rows: 10,
  }, DAY));
  if (mcTry.ok) {
    const st = mcTry.data?.stats?.price;
    const med = st?.median || median((mcTry.data?.listings || []).map((l) => l.price));
    if (med) {
      return { ok: true, data: { marketValue: Math.round(med), msrp: null, method: `Median of ${mcTry.data.num_found} similar listings within 100 mi`, source: 'MarketCheck listings', comps: (mcTry.data.listings || []).slice(0, 5).map(slimListing) } };
    }
  }
  // auto.dev listings (free tier) as the last resort.
  const adTry = await attempt(() => ad('/listings', {
    'vehicle.make': make, 'vehicle.model': model, 'vehicle.year': year, zip, distance: 100, limit: 20,
  }, DAY));
  if (adTry.ok) {
    const prices = (adTry.data?.data || []).map((l) => l.retailListing?.price).filter((p) => p > 0);
    const med = median(prices);
    if (med) return { ok: true, data: { marketValue: Math.round(med), msrp: null, method: `Median asking price of ${prices.length} ${year} ${make} ${model} listings (auto.dev)`, source: 'auto.dev listings' } };
  }
  return { ok: false, error: (mcTry.ok ? adTry.error : mcTry.error) || { provider: 'app', status: 404, message: 'No comparable listings found' } };
}

function slimListing(l) {
  return {
    vin: l.vin,
    price: l.price,
    msrp: l.msrp,
    miles: l.miles,
    year: l.build?.year,
    make: l.build?.make,
    model: l.build?.model,
    trim: l.build?.trim,
    mpg: l.build?.city_mpg && l.build?.highway_mpg ? Math.round(0.55 * l.build.city_mpg + 0.45 * l.build.highway_mpg) : null,
    dealer: l.dealer?.name,
    city: l.dealer?.city,
    state: l.dealer?.state,
    url: l.vdp_url,
    photo: l.media?.photo_links?.[0],
  };
}

// ---------- New vehicle market ----------

export async function newCarMarket({ year, make, model, trim, zip, radius = 100, car_type = 'new', max_miles }) {
  if (!make || !model) throw new ProviderError('app', 400, 'make and model are required');
  const errors = [];
  const type = ['used', 'certified'].includes(car_type) ? car_type : 'new';
  const r = await attempt(() => mc('/v2/search/car/active', {
    car_type: type, year, make, model, trim, zip, radius: Math.min(100, radius),
    miles_range: type !== 'new' && max_miles ? `0-${Number(max_miles)}` : undefined,
    stats: type === 'new' ? 'price,msrp' : 'price,msrp,miles', rows: 12, sort_by: 'price', sort_order: 'asc', include_build_object: true,
  }, 12 * 3600));
  if (r.ok) {
    const L = (r.data?.listings || []).map(slimListing);
    const priceMed = r.data?.stats?.price?.median || median(L.map((l) => l.price));
    const msrpMed = r.data?.stats?.msrp?.median || median(L.map((l) => l.msrp));
    const mpg = median(L.map((l) => l.mpg));
    return {
      source: 'MarketCheck',
      photo: L.find((l) => l.photo)?.photo || null,
      count: r.data?.num_found ?? L.length,
      medianPrice: priceMed ? Math.round(priceMed) : null,
      medianMsrp: msrpMed ? Math.round(msrpMed) : null,
      lowPrice: r.data?.stats?.price?.min ?? (L[0]?.price || null),
      mpg: mpg ? Math.round(mpg) : null,
      medianMiles: r.data?.stats?.miles?.median ? Math.round(r.data.stats.miles.median) : (median(L.map((l) => l.miles)) || null),
      carType: type,
      listings: L,
      errors,
    };
  }
  errors.push(r.error);
  const a = await attempt(() => ad('/listings', {
    'vehicle.make': make, 'vehicle.model': model, 'vehicle.year': year || undefined, zip, distance: radius, limit: 20, sort: 'price.asc',
  }, 12 * 3600));
  if (a.ok) {
    const rows = (a.data?.data || []).filter((l) => (type === 'new' ? !l.retailListing?.used : type === 'certified' ? l.retailListing?.cpo : l.retailListing?.used));
    const prices = rows.map((l) => l.retailListing?.price).filter((p) => p > 0);
    return {
      source: 'auto.dev',
      photo: rows.find((l) => l.retailListing?.primaryImage)?.retailListing.primaryImage || null,
      count: rows.length,
      medianPrice: median(prices) ? Math.round(median(prices)) : null,
      medianMsrp: null,
      lowPrice: prices.length ? Math.min(...prices) : null,
      mpg: null,
      listings: rows.slice(0, 12).map((l) => ({
        vin: l.vin, price: l.retailListing?.price, year: l.vehicle?.year, make: l.vehicle?.make, model: l.vehicle?.model,
        trim: l.vehicle?.trim, dealer: l.retailListing?.dealer, city: l.retailListing?.city, state: l.retailListing?.state,
        url: l.retailListing?.vdp, photo: l.retailListing?.primaryImage,
      })),
      errors,
    };
  }
  errors.push(a.error);
  return { source: null, photo: null, count: 0, medianPrice: null, listings: [], errors };
}

function mapOffer(x) {
  const o = x.offer || {};
  const amt = o.amounts?.[0] || {};
  const term = amt.term ? (amt.term_unit === 'years' ? amt.term * 12 : amt.term) : null;
  return {
    id: x.id,
    sha: x.base_sha || null,
    make: o.vehicles?.[0]?.make ?? null,
    model: o.vehicles?.[0]?.model ?? null,
    body: o.vehicles?.[0]?.body_type ?? null,
    fuel: o.vehicles?.[0]?.fuel_type ?? null,
    city: x.city || null,
    type: o.offer_type,
    title: o.titles?.[0] || o.oem_program_name || '',
    vehicles: (o.vehicles || []).map((v) => [v.year, v.make, v.model, v.trim].filter(Boolean).join(' ')),
    monthly: amt.monthly ?? null,
    apr: amt.apr ?? null,
    term,
    dueAtSigning: o.due_at_signing ?? null,
    cashback: o.cashback_amount ?? null,
    group: o.cashback_target_group || null,
    year: o.vehicles?.[0]?.year ?? null,
    trim: o.vehicles?.[0]?.trim ?? null,
    msrp: o.msrp ?? null,
    netCapCost: o.net_cap_cost ?? null,
    downPayment: o.down_payment ?? null,
    residual: o.lease_end_purchase_price ?? null,
    mileageLimit: o.mileage_limit ?? null,
    overMileageFee: o.over_mileage_fee ?? null,
    dispositionFee: o.disposition_fee ?? null,
    acquisitionFee: o.acquisition_fee ?? null,
    validThrough: o.valid_through ?? null,
    disclaimer: o.disclaimers?.[0]?.slice(0, 400) ?? null,
    // The fine print that matters for stacking, kept separately so it isn't cut off.
    noSpecialApr: /not (?:compatible|combinable|available) with[^.]*(?:special|promo\w*)\s+(?:APR|lease|financ)/i.test((o.disclaimers || []).join(' ')),
    requiresCaptive: /must be (?:financed|leased)[^.]*(?:NMAC|Ford Credit|Toyota Financial|American Honda|Hyundai Motor Finance|captive)|financed or leased through/i.test((o.disclaimers || []).join(' ')),
  };
}

// Offers for one make and ZIP. The by-make-and-ZIP endpoint is the one that returns the
// local (MSA) programs; the generic /oem search with make+zip came back empty for every car.
export async function incentives({ make, model, year, zip }) {
  if (!make) throw new ProviderError('app', 400, 'make is required');
  const slug = encodeURIComponent(String(make).toLowerCase());
  const page = (start) => (zip
    ? mc(`/v2/search/car/incentive/${slug}/${encodeURIComponent(zip)}`, { model, year, rows: 10, start }, DAY)
    : mc('/v2/search/car/incentive/oem', { make, model, year, rows: 10, start }, DAY));
  let r = await attempt(() => page(0));
  if (r.ok && !(r.data?.listings || []).length && zip) {
    // No local programs: fall back to the state's.
    r = await attempt(() => mc('/v2/search/car/incentive/oem', { make, model, year, zip, radius: 100, rows: 10 }, DAY));
  }
  if (!r.ok) return { offers: [], errors: [r.error] };
  const listings = [...(r.data?.listings || [])];
  // Up to two more pages (Ford often has 15–30 programs per model).
  for (let start = 10; start < Math.min(30, r.data?.num_found || 0); start += 10) {
    const more = await attempt(() => page(start));
    if (!more.ok) break;
    listings.push(...(more.data?.listings || []));
  }
  const offers = listings.map(mapOffer);
  // The same program can show up twice across pages.
  const seen = new Set();
  const unique = offers.filter((o) => { const k = o.sha || o.id; return seen.has(k) ? false : seen.add(k); });
  return { offers: unique, count: r.data?.num_found ?? unique.length, errors: [] };
}

// Every factory lease deal nearby, all makes, cheapest payment first (one call per 10 deals,
// cached a day). Nearby dealers repeat the same program, so it is deduped by program.
export async function dealSweep({ zip, radius = 15, pages = 8 }) {
  if (!zip) throw new ProviderError('app', 400, 'zip is required');
  const offers = [];
  const seen = new Set();
  let found = 0;
  const errors = [];
  for (let p = 0; p < Math.min(12, Number(pages) || 8); p++) {
    const r = await attempt(() => mc('/v2/search/car/incentive/oem', {
      zip, radius: Math.min(50, Number(radius) || 15), offer_type: 'lease', monthly_range: '100-1500',
      sort_by: 'monthly', sort_order: 'asc', rows: 10, start: p * 10,
    }, DAY));
    if (!r.ok) { errors.push(r.error); break; }
    found = r.data?.num_found ?? found;
    const page = (r.data?.listings || []).map(mapOffer);
    for (const o of page) { const k = o.sha || o.id; if (!seen.has(k) && o.monthly) { seen.add(k); offers.push(o); } }
    if (page.length < 10) break;
  }
  return { offers, found, errors };
}

// ---------- auto.dev paid-plan extras (used only if the plan allows) ----------

export async function autodevTco({ vin, zip }) {
  const r = await attempt(() => ad(`/tco/${vin}`, { zip }, 30 * DAY));
  return r.ok ? { tco: r.data?.tco || r.data?.data?.tco || null, errors: [] } : { tco: null, errors: [r.error] };
}

export async function autodevApr({ vin, year, make, model, zip, creditScore, vehicleAge, vehicleMileage }) {
  const r = await attempt(() => ad(`/apr/${vin}`, { year, make, model, zip, creditScore, vehicleAge, vehicleMileage }, 7 * DAY));
  return r.ok ? { apr: r.data?.apr || r.data?.data?.apr || null, errors: [] } : { apr: null, errors: [r.error] };
}

export async function plateToVin({ state, plate }) {
  const r = await attempt(() => ad(`/plate/${encodeURIComponent(state)}/${encodeURIComponent(plate)}`, null, 30 * DAY));
  if (!r.ok) return { vin: null, errors: [r.error] };
  const d = r.data?.data || r.data;
  return { vin: d?.vin || d?.VIN || null, errors: [] };
}

// ---------- Photos ----------
// Clean, no-background model images from your own site, via a URL template set in Railway, e.g.
// IMAGE_URL_TEMPLATE=https://invoice-pricing.com/path/{year}/{make}/{model}.png
// Placeholders: {year} {make} {model} {trim} (as given), {make_slug} {model_slug} (lower-case, hyphens),
// {make_us} {model_us} (lower-case, underscores). Each candidate URL is checked once and cached.
export const cutoutsConfigured = () => !MOCK; // Autoweb studio images are always on; IMAGE_URL_TEMPLATE adds another source
async function cutoutFor({ year, make, model, trim }) {
  const tpl = process.env.IMAGE_URL_TEMPLATE;
  if (!tpl || !make || !model) return null;
  const slug = (x, sep) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, sep).replace(new RegExp(`^${sep}|${sep}$`, 'g'), '');
  const now = new Date().getFullYear();
  const years = [...new Set([Number(year) || now + 1, now + 1, now, now - 1].filter(Boolean))];
  for (const y of years) {
    const url = tpl
      .replaceAll('{year}', String(y)).replaceAll('{make}', encodeURIComponent(make)).replaceAll('{model}', encodeURIComponent(model))
      .replaceAll('{trim}', encodeURIComponent(trim || '')).replaceAll('{make_slug}', slug(make, '-')).replaceAll('{model_slug}', slug(model, '-'))
      .replaceAll('{make_us}', slug(make, '_')).replaceAll('{model_us}', slug(model, '_'));
    const key = `cutout:${url}`;
    let ok = getCached(key);
    if (ok === undefined) {
      try {
        const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
        ok = r.ok && /^image\//.test(r.headers.get('content-type') || '');
      } catch { ok = false; }
      setCached(key, ok, ok ? 30 * DAY : 3 * DAY);
    }
    if (ok) return url;
    if (!/\{year\}/.test(tpl)) break; // template has no year: one try is enough
  }
  return null;
}

// A photo of this exact VIN if one exists (auto.dev, free tier), otherwise a local
// listing photo of the same year/make/model. Returns { url, exact }.
// Studio images from Autoweb model pages (autoweb.com/{make}/{model}/{year}):
// a transparent PNG cutout when the page has one, else a white-background studio shot.
async function autowebImage({ year, make, model }) {
  if (!make || !model) return null;
  const slug = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const now = new Date().getFullYear();
  const years = [...new Set([Number(year) || null, now + 1, now, now - 1, now - 2].filter(Boolean))];
  for (const y of years) {
    const url = `https://www.autoweb.com/${slug(make)}/${slug(model)}/${y}`;
    const key = `autoweb:${url}`;
    let found = getCached(key);
    if (found === undefined) {
      found = null;
      try {
        const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (LeaseBuyoutAdvisor)', Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(12000) });
        if (r.ok) {
          const html = await r.text();
          const t = html.match(/https:\/\/img\.autobytel\.com\/chrome\/expanded\/transparent\/[^"'\s)]+\.png/);
          const w = html.match(/https:\/\/img\.autobytel\.com\/chrome\/colormatched(?:_01)?\/white\/[^"'\s)]+\.jpg/);
          if (t) found = { url: t[0], transparent: true };
          else if (w) found = { url: w[0], transparent: false };
        }
        console.log(`[autoweb] ${r.status} ${url} ${found ? (found.transparent ? 'cutout' : 'studio') : 'none'}`);
      } catch (e) { console.log(`[autoweb] error ${url} ${e.message}`); }
      setCached(key, found, found ? 14 * DAY : 3 * DAY);
    }
    if (found) return found;
  }
  return null;
}

export async function photoFor({ vin, year, make, model, trim, zip, prefer }) {
  if (MOCK) return mock.photo({ make, model });
  const aw = await autowebImage({ year, make, model });
  if (aw) return { url: aw.url, exact: false, cutout: true, custom: true, blend: !aw.transparent, source: 'Autoweb' };
  const cut = await cutoutFor({ year, make, model, trim });
  if (cut) return { url: cut, exact: false, cutout: true, custom: true };
  if (prefer === 'cutout') return { url: null, exact: false };
  if (vin && /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin)) {
    const r = await attempt(() => ad(`/photos/${String(vin).toUpperCase()}`, null, 30 * DAY));
    const url = r.ok && (r.data?.data?.retail?.[0] || r.data?.retail?.[0]);
    if (url) return { url, exact: true };
  }
  if (make && model) {
    const r = await attempt(() => ad('/listings', { 'vehicle.make': make, 'vehicle.model': model, 'vehicle.year': year || undefined, zip: zip || undefined, distance: zip ? 200 : undefined, limit: 10 }, 30 * DAY));
    const hit = r.ok && (r.data?.data || []).find((l) => l.retailListing?.primaryImage);
    if (hit) return { url: hit.retailListing.primaryImage, exact: false };
  }
  return { url: null, exact: false };
}
