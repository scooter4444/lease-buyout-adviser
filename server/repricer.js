// Scheduled re-pricing: refresh each saved car's market value and its comparisons'
// prices and offers, more often as the decide-by date gets close, within the API budget.
import fs from 'node:fs';
import { lookupVehicle, newCarMarket, incentives, prewarmGalleries } from './providers.js';
import { usageThisMonth } from './cache.js';

const DAY = 86400000;
const tzHour = () => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: 'numeric', hour12: false }).format(new Date()));

function intervalDays(p) {
  const end = p.current?.leaseEndDate ? new Date(`${p.current.leaseEndDate}T12:00:00`) : null;
  const left = end && !Number.isNaN(end.getTime()) ? Math.ceil((end - Date.now()) / DAY) : null;
  if (left != null && left < 0) return null; // lease is over: stop
  if (left == null || left > 60) return 7;
  if (left > 30) return 4;
  if (left > 7) return 2;
  return 1;
}

export function startRepricer({ file, readStore, writeStore }) {
  const limit = Number(process.env.MARKETCHECK_MONTHLY_LIMIT || 500);
  let running = false;

  async function repriceProfile(p) {
    const zip = p.assumptions?.zip;
    if (!zip) return { skipped: 'no ZIP' };
    const log = [];
    const c = p.current || {};
    // Current car: today's value at an estimated odometer.
    if (c.vin && c.currentMiles && p.lookup?.valuation) {
      const asOf = c.milesAsOf ? new Date(c.milesAsOf) : null;
      const perDay = (Number(p.assumptions.annualMiles) || 12000) / 365;
      const miles = Math.round(Number(c.currentMiles) + (asOf ? Math.max(0, (Date.now() - asOf) / DAY) * perDay : 0));
      try {
        const r = await lookupVehicle({ vin: c.vin, miles, zip });
        if (r.valuation?.marketValue) {
          const before = Number(c.marketValue) || null;
          p.lookup = { ...p.lookup, valuation: r.valuation, recalls: r.recalls ?? p.lookup.recalls };
          c.marketValue = String(Math.round(r.valuation.marketValue));
          log.push({ what: 'value', before, after: Math.round(r.valuation.marketValue) });
        }
      } catch (e) { log.push({ what: 'value', error: e.message }); }
    }
    // Comparisons: listing prices and offers.
    for (const cand of p.candidates || []) {
      if (!cand.make || !cand.model || !cand.market) continue;
      const used = cand.condition && cand.condition !== 'new';
      const q = { year: cand.year || '', make: cand.make, model: cand.model, trim: cand.trim || '', zip, car_type: cand.condition || 'new', max_miles: used ? Math.max(20000, (new Date().getFullYear() + 1 - Number(cand.year || 0)) * 15000) : '' };
      try {
        const m = await newCarMarket(q);
        if (m.medianPrice) {
          const before = Number(cand.sellingPrice) || null;
          cand.market = m;
          cand.sellingPrice = String(m.medianPrice);
          if (m.medianMsrp) cand.msrp = String(m.medianMsrp);
          if (used && m.medianMiles) cand.miles = String(m.medianMiles);
          log.push({ what: `${cand.make} ${cand.model}`, before, after: m.medianPrice });
        }
        if (!used) {
          const inc = await incentives(q);
          if (!inc.errors?.length) {
            const model = cand.model.toLowerCase();
            cand.offers = (inc.offers || []).filter((o) => !o.vehicles?.length || o.vehicles.some((v) => v.toLowerCase().includes(model))).slice(0, 12);
            // Keep the person's picks that still exist; the app re-picks the rest.
            if (cand.selected) {
              const ids = new Set(cand.offers.map((o) => o.id));
              cand.selected = { cash: (cand.selected.cash || []).filter((id) => ids.has(id)), finance: ids.has(cand.selected.finance) ? cand.selected.finance : null, lease: ids.has(cand.selected.lease) ? cand.selected.lease : null };
            }
          }
        }
        cand.needsPick = true;
      } catch (e) { log.push({ what: `${cand.make} ${cand.model}`, error: e.message }); }
    }
    p.repricedAt = new Date().toISOString();
    p.repriceLog = log.slice(0, 40);
    p.needsVerdictCheck = true;
    return { updated: log.length };
  }

  async function tick(force = false) {
    if (running) return;
    const hour = tzHour();
    if (!force && (hour < 3 || hour > 5)) return; // overnight, Denver time
    running = true;
    try {
      const store = readStore();
      if (!store?.profiles) return;
      let changed = false;
      for (const [id, p] of Object.entries(store.profiles)) {
        const every = intervalDays(p);
        if (!every) continue;
        const last = p.repricedAt ? new Date(p.repricedAt).getTime() : 0;
        if (!force && Date.now() - last < every * DAY - 3600000) continue;
        const used = usageThisMonth().marketcheck || 0;
        const urgent = every === 1;
        if (used >= limit * (urgent ? 0.95 : 0.8)) { console.log(`[reprice] skip ${id}: MarketCheck budget ${used}/${limit}`); continue; }
        const r = await repriceProfile(p);
        console.log(`[reprice] ${id} (${p.name || ''}) every ${every}d:`, JSON.stringify(r));
        changed = true;
      }
      if (changed) {
        // Re-read and merge only the refreshed cars, in case the app saved meanwhile.
        const latest = readStore() || store;
        for (const [id, p] of Object.entries(store.profiles)) if (latest.profiles?.[id] && p.repricedAt !== latest.profiles[id].repricedAt) latest.profiles[id] = { ...latest.profiles[id], ...pick(p) };
        latest.rev = (latest.rev || 0) + 1;
        writeStore(latest);
      }
      await warm();
    } catch (e) {
      console.warn('[reprice] failed:', e.message);
    } finally { running = false; }
  }
  // Photos for every saved car, sorted ahead of time. Cached results cost nothing; listings are
  // re-checked every few days and unsorted ones retried.
  let warming = false;
  async function warm() {
    if (warming) return;
    warming = true;
    try {
      const store = readStore();
      const r = await prewarmGalleries(store, { budgetOk: () => (usageThisMonth().marketcheck || 0) < limit * 0.85 });
      console.log('[photos] pre-load:', JSON.stringify(r));
    } catch (e) { console.warn('[photos] pre-load failed:', e.message); } finally { warming = false; }
  }
  const pick = (p) => ({ current: p.current, lookup: p.lookup, candidates: p.candidates, repricedAt: p.repricedAt, repriceLog: p.repriceLog, needsVerdictCheck: p.needsVerdictCheck });

  setInterval(() => tick(false), 30 * 60 * 1000).unref();
  setTimeout(() => tick(false), 60 * 1000).unref();
  setTimeout(() => warm(), 2 * 60 * 1000).unref(); // after a deploy: fill in anything missing
  void file; void fs;
  return { runNow: () => tick(true) };
}
