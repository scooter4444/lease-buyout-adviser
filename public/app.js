import { analyze, leaseTermsFromOffer, STATE_TAX, NO_TRADE_TAX_CREDIT, taxDefaults, defaultInsurance, maintenanceAnnual, modelAge, fmtYears } from './engine.js';
import { SEGMENTS, segmentFor, suggestions, AZ_MAKES } from './segments.js';
import { logoUrl, logoIsMono } from './logos.js';
import { bestStack, classify, eligible, regionOk } from './stack.js';
import { renderSafety, loadSafety, renderCompare3 } from './safety.js';

// ---------- State ----------
const STORAGE_KEY = 'lba:v2';
const today = new Date();
const blankCandidate = (o = {}) => ({
  id: Math.random().toString(36).slice(2, 8),
  year: String(today.getFullYear() + (today.getMonth() >= 8 ? 1 : 0)), make: '', model: '', trim: '',
  sellingPrice: '', msrp: '', mpg: '', insuranceAnnual: '', condition: 'new', miles: '',
  buy: { enabled: true, rebate: '', apr: '', termMonths: '60', downPayment: '', payCash: false, source: 'estimate' },
  lease: { enabled: true, monthly: '', termMonths: '36', dueAtSigning: '', annualMileage: '', overMileageFee: '', dispositionFee: '', residualPct: '', moneyFactor: '', source: 'estimate' },
  market: null, offers: [], applied: {},
  ...o,
});

const blankProfile = (name = 'My car') => ({
  name,
  pricing: { plan: 'public', A: '5', Z: '7' },
  segment: '',
  photo: null,
  assumptions: { zip: '', state: 'CO', horizonYears: '3', annualMiles: '12000', salesTaxPct: '', leaseTaxPct: '', gasPrice: '3.40', tradeInPct: '90', tradeInTaxCredit: '', discountRatePct: '4', docFee: '', titleFees: '', costMode: 'payments', spreadUpfront: true, includeRunning: false },
  current: {
    vin: '', year: '', make: '', model: '', trim: '', mpg: '', marketValue: '', msrp: '',
    buyoutPrice: '', purchaseOptionFee: '', leaseEndDate: '', currentMiles: '', allowedMiles: '', excessMileRate: '', dispositionFee: '', wearCharges: '', monthlyPayment: '',
    payCash: false, downPayment: '', apr: '', termMonths: '48', insuranceAnnual: '', maintenanceAnnual: '', upcomingRepairs: '', buyoutIsTaxed: true,
  },
  candidates: [],
  lookup: null, // last VIN lookup result
});

// All saved cars; `state` is the one being viewed.
let store = { active: null, profiles: {} };
let state = blankProfile();
const newId = () => Math.random().toString(36).slice(2, 9);

// ---------- Field definitions ----------
const F = (path, label, o = {}) => ({ path, label, ...o });
const FIELDS = {
  lease: [
    F('current.buyoutPrice', 'Buyout price', { pre: '$', hint: 'From your leasing company’s payoff quote' }),
    F('current.purchaseOptionFee', 'Purchase option fee', { pre: '$', placeholder: '0', hint: 'Only if not already in the quote' }),
    F('current.leaseEndDate', 'Lease ends', { type: 'date' }),
    F('current.currentMiles', 'Odometer today', { suf: 'mi' }),
    F('current.allowedMiles', 'Total miles allowed', { suf: 'mi', hint: 'e.g. 36,000 for 3 yrs × 12k' }),
    F('current.excessMileRate', 'Excess mile charge', { pre: '$', suf: '/mi', placeholder: '0.25' }),
    F('current.dispositionFee', 'Turn-in (disposition) fee', { pre: '$', placeholder: '395' }),
    F('current.wearCharges', 'Expected wear charges', { pre: '$', placeholder: '0', hint: 'Dings, tires, scratches if you return it' }),
  ],
  vehicle: [
    F('current.marketValue', 'Market value today', { pre: '$', hint: 'Retail value. Filled in by the lookup; edit if you have a better number.' }),
    F('current.msrp', 'Original MSRP', { pre: '$' }),
    F('current.year', 'Year', { inputmode: 'numeric' }),
    F('current.make', 'Make', { text: true }),
    F('current.model', 'Model', { text: true }),
    F('current.trim', 'Trim', { text: true }),
    F('current.mpg', 'Combined MPG', { placeholder: '26' }),
    F('current.monthlyPayment', 'Current lease payment', { pre: '$', suf: '/mo', hint: 'For reference only' }),
  ],
  buyoutPay: [
    F('current.payCash', 'Pay cash', { check: true }),
    F('current.downPayment', 'Down payment', { pre: '$', placeholder: '0', hideIf: 'current.payCash' }),
    F('current.apr', 'Loan APR', { suf: '%', placeholder: '7.0', hint: 'Used-car rate', hideIf: 'current.payCash' }),
    F('current.termMonths', 'Loan term', { suf: 'mo', hideIf: 'current.payCash' }),
    F('current.buyoutIsTaxed', 'My state charges sales tax on the buyout', { check: true, full: true }),
  ],
  running: [
    F('current.insuranceAnnual', 'Insurance per year', { pre: '$', est: () => defaultInsurance(Number(state.current.marketValue) || 0) }),
    F('current.maintenanceAnnual', 'Maintenance + repairs per year', { pre: '$', est: () => {
      const y = Number(state.current.year); if (!y) return '';
      return maintenanceAnnual(modelAge(y) + 1, { annualMiles: Number(state.assumptions.annualMiles) || 12000 });
    } }),
    F('current.upcomingRepairs', 'Known repairs coming up', { pre: '$', placeholder: '0', hint: 'Tires, brakes, battery…', full: true }),
  ],
  situation: [
    F('assumptions.zip', 'ZIP code', { inputmode: 'numeric', maxlength: 5 }),
    F('assumptions.state', 'State', { select: 'state' }),
    F('assumptions.horizonYears', 'Years you’d keep the next car', { suf: 'yrs' }),
    F('assumptions.annualMiles', 'Miles you drive per year', { suf: 'mi' }),
    F('assumptions.gasPrice', 'Gas price', { pre: '$', suf: '/gal' }),
    F('assumptions.tradeInPct', 'Dealer trade-in vs retail', { suf: '%', hint: 'Dealers usually pay 85–92% of retail' }),
  ],
  fine: [
    F('assumptions.salesTaxPct', 'Sales tax', { suf: '%', est: () => taxDefaults(state.assumptions.state, state.assumptions.zip).salesTaxPct, hint: () => taxHint() }),
    F('assumptions.leaseTaxPct', 'Tax on lease payments', { suf: '%', est: () => state.assumptions.salesTaxPct || taxDefaults(state.assumptions.state, state.assumptions.zip).leaseTaxPct }),
    F('assumptions.docFee', 'Dealer doc fee', { pre: '$', placeholder: '499' }),
    F('assumptions.titleFees', 'Title & plate fees', { pre: '$', placeholder: '150' }),
    F('assumptions.discountRatePct', 'What your cash earns', { suf: '%', hint: 'Used to weigh money now vs later. 0 to ignore.' }),
    F('assumptions.tradeInTaxCredit', 'Trade-in lowers sales tax in my state', { check: true, full: true }),
  ],
};
const STATES = Object.keys(STATE_TAX).sort();
function taxHint() {
  const d = taxDefaults(state.assumptions.state, state.assumptions.zip);
  return d.surtaxCap ? `State rate. A ${d.surtaxPct}% county surtax is added on the first $${d.surtaxCap.toLocaleString()} of a purchase and on every lease payment.` : 'Your combined state + local rate';
}

// ---------- Helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const getPath = (obj, p) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
function setPath(obj, p, v) {
  const ks = p.split('.'); const last = ks.pop();
  const target = ks.reduce((o, k) => o[k], obj); target[last] = v;
}
const money = (x, d = 0) => (x == null || !Number.isFinite(x) ? '—' : `${x < 0 ? '−' : ''}$${Math.abs(x).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d })}`);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtInput = (v) => (v === '' || v == null ? '' : String(v));

// Brand badge: the maker's logo, transparent, sized to a common box so rows line up.
function logoHTML(make, cls = '') {
  const u = logoUrl(make);
  return u ? `<span class="logo ${logoIsMono(make) ? 'mono' : ''} ${cls}"><img src="${u}" alt="${esc(make)}" loading="lazy" decoding="async" onerror="this.parentNode.remove()"></span>` : '';
}

async function api(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

// ---------- Rendering inputs ----------
function fieldHTML(f) {
  const v = getPath(state, f.path);
  const id = `f-${f.path.replace(/\./g, '-')}`;
  const full = f.full ? ' full' : '';
  if (f.check) {
    return `<label class="field check${full}" data-wrap="${f.path}"><input type="checkbox" id="${id}" data-path="${f.path}" ${v === true || v === 'true' || (v === '' && f.path.endsWith('tradeInTaxCredit') && !NO_TRADE_TAX_CREDIT.has(state.assumptions.state)) ? 'checked' : ''}><span>${esc(f.label)}</span></label>`;
  }
  if (f.select === 'state') {
    return `<label class="field" data-wrap="${f.path}"><span>${esc(f.label)}</span><select id="${id}" data-path="${f.path}">${STATES.map((s) => `<option ${s === v ? 'selected' : ''}>${s}</option>`).join('')}</select></label>`;
  }
  const est = f.est ? f.est() : '';
  const ph = f.placeholder ?? (est !== '' && est != null ? `≈ ${Math.round(Number(est) * 100) / 100}` : '');
  const type = f.type || 'text';
  const im = f.text ? 'text' : (f.inputmode || (type === 'text' ? 'decimal' : ''));
  return `<label class="field${full}" data-wrap="${f.path}">
    <span>${esc(f.label)}</span>
    <span class="input ${f.pre ? 'has-pre' : ''} ${f.suf ? 'has-suf' : ''}">
      ${f.pre ? `<span class="pre">${f.pre}</span>` : ''}
      <input id="${id}" type="${type}" ${im ? `inputmode="${im}"` : ''} ${f.maxlength ? `maxlength="${f.maxlength}"` : ''} data-path="${f.path}" value="${esc(fmtInput(v))}" placeholder="${esc(ph)}">
      ${f.suf ? `<span class="suf">${f.suf}</span>` : ''}
    </span>
    ${f.hint ? `<small>${esc(typeof f.hint === "function" ? f.hint() : f.hint)}</small>` : ''}
  </label>`;
}

function renderFields() {
  for (const el of $$('[data-fields]')) el.innerHTML = FIELDS[el.dataset.fields].map(fieldHTML).join('');
  applyHides();
  $('#vin').value = state.current.vin || '';
  $('#plateState').innerHTML = STATES.map((s) => `<option ${s === state.assumptions.state ? 'selected' : ''}>${s}</option>`).join('');
}

function refreshPlaceholders() {
  for (const group of Object.values(FIELDS)) for (const f of group) {
    if (!f.est) continue;
    const input = document.getElementById(`f-${f.path.replace(/\./g, '-')}`);
    const est = f.est();
    if (input) input.placeholder = est !== '' && est != null ? `≈ ${Math.round(Number(est) * 100) / 100}` : '';
  }
}

function applyHides() {
  for (const group of Object.values(FIELDS)) for (const f of group) {
    if (!f.hideIf) continue;
    const wrap = $(`[data-wrap="${f.path}"]`);
    if (wrap) wrap.hidden = !!getPath(state, f.hideIf);
  }
}

function candidateHTML(c, i) {
  const p = (k) => `candidates.${i}.${k}`;
  const inp = (k, label, o = {}) => fieldHTML(F(p(k), label, o));
  const m = c.market;
  const sel = selection(c);
  const chip = (o) => {
    const kind = offerKind(o);
    const main = kind === 'lease' ? `$${o.monthly}/mo for ${o.term || '?'} mo${o.dueAtSigning != null ? `, $${o.dueAtSigning.toLocaleString()} due` : ''}`
      : kind === 'finance' ? `${o.apr}% APR for ${o.term || '?'} mo` : `$${(o.cashback || 0).toLocaleString()} ${esc(cashLabel(o))}`;
    const pressed = kind === 'cash' ? sel.cash.includes(o.id) : sel[kind] === o.id;
    let el = regionOk(o, c.make, homeOf());
    if (el.ok && kind === 'cash') { try { el = eligible(o, classify({ ...o, make: c.make }), eligibilityOf(), c.make); } catch {} }
    const who = el.ok ? (kind === 'cash' && el.why && el.why !== 'Open to everyone' ? `You qualify: ${el.why}. ` : '') : `Not for you: ${el.why}. `;
    const mkt = multiRegion() && o.region ? `${regionName(o.region)}: ` : '';
    return `<button type="button" class="offer ${el.ok ? '' : 'no'}" data-offer="${i}:${esc(o.id)}" aria-pressed="${pressed}">${main}<small>${esc(mkt)}${esc(who)}${esc((o.title || o.vehicles?.[0] || '').slice(0, 60))}${o.validThrough ? `, ends ${esc(o.validThrough)}` : ''}</small></button>`;
  };
  const byKind = (k) => (c.offers || []).filter((o) => offerKind(o) === k);
  const cashTotal = stackedCash(c);
  const offerChips = (c.offers || []).length ? `
    ${byKind('cash').length ? `<h5>Cash back <span class="soft">the best legal stack is picked for you; tap to change</span></h5><div class="offers">${byKind('cash').map(chip).join('')}</div>
      <p class="stack-total">${cashTotal ? `Stacking ${money(cashTotal)} in cash` : 'No cash selected'}</p>` : ''}
    ${byKind('finance').length ? `<h5>Special financing <span class="soft">pick one, stacks with cash</span></h5><div class="offers">${byKind('finance').map(chip).join('')}</div>` : ''}
    ${byKind('lease').length ? `<h5>Lease deals <span class="soft">pick one</span></h5><div class="offers">${byKind('lease').map(chip).join('')}</div>` : ''}` : '';
  return `<div class="cand" data-cand="${i}">
    <div class="ymmt">
      ${inp('year', 'Year', { inputmode: 'numeric' })}${inp('make', 'Make', { text: true })}${inp('model', 'Model', { text: true })}${inp('trim', 'Trim', { text: true, placeholder: 'Any' })}
    </div>
    ${m ? `<p class="market">${m.count ? `${m.count.toLocaleString()} new for sale near you` : 'No local listings found'}${m.medianPrice ? `, typical price ${money(m.medianPrice)}` : ''}${m.lowPrice ? `, lowest ${money(m.lowPrice)}` : ''}${m.source ? ` (${esc(m.source)})` : ''}.</p>` : ''}
    <div class="grid" style="margin-top:12px">
      ${inp('sellingPrice', azEligible(c) && planPct() ? 'Street price (before A/Z-Plan)' : 'Price you’d pay', { pre: '$' })}${inp('msrp', 'MSRP', { pre: '$' })}
      ${inp('mpg', 'Combined MPG', { placeholder: '30' })}${inp('insuranceAnnual', 'Insurance per year', { pre: '$', placeholder: c.sellingPrice ? `≈ ${defaultInsurance(Number(c.sellingPrice))}` : '' })}
    </div>
    ${offerChips ? `<h4>Manufacturer offers near you</h4><p class="hint">Offers are matched to who’s buying (Settings): loyalty, conquest, lease renewal and military cash are checked against the household. Bring proof of eligibility, and confirm the final combination with the dealer.</p>${offerChips}` : ''}
    <h4><label><input type="checkbox" data-path="${p('buy.enabled')}" ${c.buy.enabled ? 'checked' : ''}> Buy it</label>${c.buy.source !== 'estimate' ? '<span class="tag offer-tag">offer applied</span>' : ''}</h4>
    <div class="grid" ${c.buy.enabled ? '' : 'hidden'}>
      ${inp('buy.rebate', 'Rebate / cash back', { pre: '$', placeholder: '0' })}${inp('buy.apr', 'Loan APR', { suf: '%', placeholder: '6.5' })}
      ${inp('buy.termMonths', 'Loan term', { suf: 'mo' })}${inp('buy.downPayment', 'Down payment', { pre: '$', placeholder: '0' })}
      ${fieldHTML(F(p('buy.payCash'), 'Pay cash', { check: true }))}
    </div>
    ${c.condition && c.condition !== 'new' ? '' : `<h4><label><input type="checkbox" data-path="${p('lease.enabled')}" ${c.lease.enabled ? 'checked' : ''}> Lease it</label>${c.lease.source !== 'estimate' ? '<span class="tag offer-tag">offer applied</span>' : ''}</h4>
    <div class="grid" ${c.lease.enabled ? '' : 'hidden'}>
      ${inp('lease.monthly', 'Monthly payment (before tax)', { pre: '$', placeholder: 'estimate', hint: 'Blank = estimated from price' })}${inp('lease.termMonths', 'Lease term', { suf: 'mo' })}
      ${inp('lease.dueAtSigning', 'Due at signing', { pre: '$', placeholder: 'first month + fees' })}${inp('lease.annualMileage', 'Miles allowed per year', { suf: 'mi', placeholder: '12000' })}
      ${inp('lease.overMileageFee', 'Over-mileage charge', { pre: '$', suf: '/mi', placeholder: '0.25' })}${inp('lease.dispositionFee', 'Turn-in fee', { pre: '$', placeholder: '395' })}
      ${inp('lease.residualPct', 'Residual (for estimate)', { suf: '%', placeholder: '58' })}${inp('lease.moneyFactor', 'Money factor (for estimate)', { placeholder: '0.0018' })}
    </div>`}
    ${c.condition && c.condition !== 'new' ? `<div class="grid" style="margin-top:12px">${inp('miles', 'Odometer', { suf: 'mi' })}</div>` : ''}
  </div>`;
}

// ---------- Photos ----------
const phCls = (ph, cls = '') => `${cls}${ph?.custom ? ' contain' : ''}${ph?.blend ? ' blend' : ''}`;
const photoOf = (c) => (c.photo?.cutout ? c.photo.url : null) || c.market?.photo || c.photo?.url || null;
let cutoutsOn = false;
function imgHTML(url, alt, cls = '') {
  if (!url) return `<div class="ph ${cls} ph-empty" aria-hidden="true"></div>`;
  return `<img class="ph ${cls}" src="${esc(url)}" alt="${esc(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ph ${cls} ph-empty'}))">`;
}
const photoPending = new Set();
async function fetchPhoto(key, params, assign) {
  if (photoPending.has(key)) return;
  photoPending.add(key);
  try {
    const r = await api(`api/photo?${new URLSearchParams(params)}`);
    if (r.url) { assign(r); persist(); return true; }
  } catch {} finally { photoPending.delete(key); }
  return false;
}
async function ensurePhotos() {
  const cur = state.current;
  const jobs = [];
  if (cur.make && cur.model && (!state.photo?.url || (cutoutsOn && !state.photo.custom && !state.photo.cutoutTried))) {
    if (state.photo) state.photo.cutoutTried = true;
    const owner = state;
    jobs.push(fetchPhoto(`cur:${cur.vin || cur.make + cur.model}`, { vin: cur.vin || '', year: cur.year || '', make: cur.make, model: cur.model, zip: state.assumptions.zip || '' }, (r) => { owner.photo = r; }));
  }
  for (const c of state.candidates) {
    const wantCutout = cutoutsOn && !c.photo?.cutout && !c.cutoutTried;
    if (c.make && c.model && ((!photoOf(c) && !c.photoTried) || wantCutout)) {
      c.photoTried = true; if (cutoutsOn) c.cutoutTried = true;
      jobs.push(fetchPhoto(`c:${c.id}`, { year: c.year || '', make: c.make, model: c.model, trim: c.trim || '', zip: state.assumptions.zip || '', prefer: photoOf(c) ? 'cutout' : '' }, (r) => { c.photo = r; }));
    }
  }
  if (!jobs.length) return;
  const got = await Promise.all(jobs);
  if (got.some(Boolean)) { renderCarId(); renderResults(); updateModelSummaries(); }
}

function photoButton() {
  return `<label class="photo-btn"><input type="file" accept="image/*" data-photo-upload hidden><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"></path><circle cx="12" cy="13" r="3.5"></circle></svg>${state.photo?.custom ? 'Change photo' : 'Use your own photo'}</label>`;
}

// Trim transparent margins, cap at 1400px wide, keep transparency.
async function preparePhoto(file) {
  const bmp = await createImageBitmap(file);
  const scan = document.createElement('canvas');
  const k = Math.min(1, 600 / bmp.width);
  scan.width = Math.round(bmp.width * k); scan.height = Math.round(bmp.height * k);
  const sx = scan.getContext('2d', { willReadFrequently: true });
  sx.drawImage(bmp, 0, 0, scan.width, scan.height);
  const d = sx.getImageData(0, 0, scan.width, scan.height).data;
  let x0 = scan.width, y0 = scan.height, x1 = 0, y1 = 0, alpha = false;
  for (let y = 0; y < scan.height; y++) for (let x = 0; x < scan.width; x++) {
    const a = d[(y * scan.width + x) * 4 + 3];
    if (a < 250) alpha = true;
    if (a > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  let crop = { x: 0, y: 0, w: bmp.width, h: bmp.height };
  if (alpha && x1 > x0 && y1 > y0) {
    const pad = 4;
    crop = { x: Math.max(0, x0 / k - pad), y: Math.max(0, y0 / k - pad), w: Math.min(bmp.width, (x1 - x0 + 1) / k + 2 * pad), h: Math.min(bmp.height, (y1 - y0 + 1) / k + 2 * pad) };
  }
  const s2 = Math.min(1, 1400 / crop.w);
  const out = document.createElement('canvas');
  out.width = Math.round(crop.w * s2); out.height = Math.round(crop.h * s2);
  out.getContext('2d').drawImage(bmp, crop.x, crop.y, crop.w, crop.h, 0, 0, out.width, out.height);
  return alpha ? out.toDataURL('image/png') : out.toDataURL('image/jpeg', 0.85);
}

async function uploadPhoto(file) {
  const status = $('#carStatus');
  status.className = 'status'; status.textContent = 'Saving your photo…';
  try {
    const dataUrl = await preparePhoto(file);
    const res = await fetch('api/photo-upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: store.active, dataUrl }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Upload failed (${res.status})`);
    state.photo = { url: body.url, exact: true, custom: true };
    persist(); renderCarId(); renderResults();
    status.textContent = 'Photo saved.';
  } catch (e) { status.className = 'status err'; status.textContent = e.message; }
}

// ---------- Compare models screen ----------
const openEditors = new Set();
const carName = (c) => (c.condition && c.condition !== 'new'
  ? `${c.condition === 'certified' ? 'Certified' : 'Used'} ${[c.year, c.make, c.model].filter(Boolean).join(' ')}`
  : [c.make, c.model].filter(Boolean).join(' ')) || 'New car';
const curLabel = () => [state.current.make, state.current.model].filter(Boolean).join(' ') || 'current car';

function modelRows() {
  const r = lastAnalysis;
  const buyout = r?.scenarios.find((s) => s.kind === 'buyout') || null;
  const rows = state.candidates.map((c, i) => {
    const buy = r?.scenarios.find((s) => s.id === `buy-${c.id}`) || null;
    const lease = r?.scenarios.find((s) => s.id === `lease-${c.id}`) || null;
    const best = [buy, lease].filter(Boolean).sort((a, b) => a.pvCost - b.pvCost)[0] || null;
    return { c, i, buy, lease, best };
  });
  const priced = rows.filter((x) => x.best).sort((a, b) => a.best.pvCost - b.best.pvCost);
  priced.forEach((x, k) => { x.rank = k + 1; });
  return { rows: [...priced, ...rows.filter((x) => !x.best)], buyout, priced };
}

function offerSummary(c) {
  if (!(c.offers || []).length) return '';
  const sel = selection(c);
  const n = (c.offers || []).length;
  const lease = (c.offers || []).find((o) => o.id === sel.lease);
  const lt = lease ? leaseTermsFromOffer(lease) : null;
  const leaseTxt = lease ? `Lease${lease.year || lease.trim ? ` (${[lease.year, lease.trim].filter(Boolean).join(' ')})` : ''}: $${lease.monthly}/mo for ${lease.term} mo, ${money(lease.dueAtSigning || 0)} due${lt ? `; factory rate ${lt.moneyFactor.toFixed(5)} (${(lt.moneyFactor * 2400).toFixed(1)}% APR), residual ${lt.residualPct}%` : ''}.` : '';
  const picked = [c.buyNote, leaseTxt, c.leaseNote].filter(Boolean).join(' ');
  return `${picked || 'No offers selected.'} ${n} offer${n === 1 ? '' : 's'} available; change them in Price, offers and terms.`;
}

function summaryHTML(x, buyout) {
  const { c, i, buy, lease, best } = x;
  const sub = (c.condition && c.condition !== 'new'
    ? [c.miles ? `about ${Number(c.miles).toLocaleString()} mi` : '', c.trim].filter(Boolean).join(', ')
    : [c.year || 'New', c.trim].filter(Boolean).join(' ')) + (c.reason ? `${c.condition && c.condition !== 'new' && c.miles ? '. ' : c.condition && c.condition !== 'new' ? '' : '. '}${c.reason}` : '');
  const remove = `<button type="button" class="btn ghost small" data-remove="${i}">Remove</button>`;
  if (!best) {
    return `<header class="mc-h"><div class="mc-pic">${imgHTML(photoOf(c), carName(c), phCls(c.photo?.cutout ? c.photo : null))}</div><div class="mc-name">${logoHTML(c.make)}<b>${esc(carName(c))}</b><small>${esc(sub)}</small></div></header>
      ${c.status ? `<p class="status ${c.statusErr ? 'err' : ''}">${esc(c.status)}</p>` : '<p class="hint">Not priced yet.</p>'}
      <div class="mc-actions"><button type="button" class="btn primary small" data-price="${i}">Get prices &amp; offers</button>${remove}</div>`;
  }
  const delta = buyout ? best.monthly - buyout.monthly : null;
  const eff = effectivePrice(c);
  const plan = azEligible(c) && planPct() ? `${state.pricing.plan}-Plan price` : 'Typical local price';
  return `<header class="mc-h"><div class="mc-pic">${imgHTML(photoOf(c), carName(c), phCls(c.photo?.cutout ? c.photo : null))}<span class="mc-rank">${x.rank}</span></div>
      <div class="mc-name">${logoHTML(c.make)}<b>${esc(carName(c))}</b><small>${esc(sub)}</small></div>
      <div class="mc-cost"><b>${money(best.monthly)}</b><small>${esc(unitLabel())}, ${best.kind === 'lease' ? 'leased' : 'bought'}</small></div></header>
    ${delta != null ? `<p class="mc-vs ${delta > 0 ? 'neg' : 'pos'}">${delta > 0 ? `${money(delta)}/mo more` : `${money(-delta)}/mo less`} than buying out your ${esc(curLabel())}</p>` : ''}
    <dl class="mc-grid">
      ${buy ? `<div><dt>Buy</dt><dd>${money(buy.monthly)}<small>/mo</small></dd><p>${c.buy.payCash ? 'paid in cash' : `payment ${esc(payText(buy))}`}</p></div>` : ''}
      ${lease ? `<div><dt>Lease${lease.estimated ? ' (estimate)' : ''}</dt><dd>${money(lease.monthly)}<small>/mo</small></dd><p>${esc(payText(lease))}${lease.estimated ? ', no factory deal found' : ''}</p></div>` : ''}
      <div><dt>${plan}</dt><dd>${money(eff)}</dd><p>MSRP ${money(Number(c.msrp) || null)}</p></div>
      <div><dt>Fuel economy</dt><dd>${c.mpg ? `${esc(c.mpg)}<small> mpg</small>` : '—'}</dd><p>${c.market?.count ? `${c.market.count.toLocaleString()} for sale near you` : '&nbsp;'}</p></div>
    </dl>
    ${offerSummary(c) ? `<p class="mc-offers">${esc(offerSummary(c))}</p>` : ''}
    ${c.status && c.statusErr ? `<p class="status err">${esc(c.status)}</p>` : ''}
    <div class="mc-actions"><button type="button" class="btn small" data-price="${i}">Refresh prices</button>${remove}</div>`;
}

function compareChart(priced, buyout) {
  if (!priced.length) return '';
  const W = Math.round(Math.min(760, Math.max(300, ($('#modelCompare').clientWidth || 600)))), rowH = 40, left = W < 480 ? 108 : 150, right = 14, top = 22;
  const H = top + priced.length * rowH + 22;
  const vals = priced.flatMap((x) => [x.buy?.monthly, x.lease?.monthly]).filter(Number.isFinite);
  if (buyout) vals.push(buyout.monthly);
  const lo = Math.min(0, ...vals), hi = Math.max(...vals) * 1.06;
  const xs = (v) => left + ((v - lo) / (hi - lo || 1)) * (W - left - right);
  const ticks = niceTicks(lo, hi, 4);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="All-in monthly cost by model"><g class="grid">`;
  for (const t of ticks) svg += `<line x1="${xs(t)}" x2="${xs(t)}" y1="${top}" y2="${H - 18}"/><text x="${xs(t)}" y="${H - 4}" text-anchor="middle">${shortMoney(t)}</text>`;
  svg += '</g>';
  priced.forEach((x, k) => {
    const y = top + k * rowH;
    svg += `<text x="${left - 8}" y="${y + 20}" text-anchor="end">${esc(trunc(carName(x.c), W < 480 ? 15 : 22))}</text>`;
    if (x.buy) svg += `<rect x="${xs(lo)}" y="${y + 4}" width="${Math.max(0, xs(x.buy.monthly) - xs(lo))}" height="14" rx="2" fill="var(--s1)"><title>Buy: ${money(x.buy.monthly)}/mo</title></rect>`;
    if (x.lease) svg += `<rect x="${xs(lo)}" y="${y + 20}" width="${Math.max(0, xs(x.lease.monthly) - xs(lo))}" height="14" rx="2" fill="var(--s3)"><title>Lease: ${money(x.lease.monthly)}/mo</title></rect>`;
  });
  if (buyout) {
    const bx = xs(buyout.monthly);
    svg += `<line x1="${bx}" x2="${bx}" y1="${top - 6}" y2="${H - 18}" stroke="var(--go)" stroke-width="2.5"/><text x="${bx}" y="${top - 10}" text-anchor="${bx > W - 120 ? 'end' : 'middle'}" style="fill:var(--go);font-weight:650">Buy out ${esc(trunc(curLabel(), 16))}: ${money(buyout.monthly)}</text>`;
  }
  svg += '</svg>';
  return `<div class="compare-chart">${svg}<div class="legend"><span><i style="background:var(--s1)"></i>Buy</span><span><i style="background:var(--s3)"></i>Lease</span><span><i class="line" style="background:var(--go)"></i>Buying out your current car</span></div></div>`;
}

function renderModels() {
  renderCompare3Tab();
  renderPnd();
  renderIdeas();
  renderDeals();
  const seg = state.segment || segmentFor({ make: state.current.make, model: state.current.model, body: state.lookup?.vehicle?.body });
  $('#segment').innerHTML = Object.entries(SEGMENTS).map(([id, sg]) => `<option value="${id}" ${id === seg ? 'selected' : ''}>${esc(sg.label)}</option>`).join('');
  for (const r of $$('input[name="plan"]')) r.checked = r.value === state.pricing.plan;
  $('#planPctWrap').hidden = state.pricing.plan === 'public';
  $('#planPct').value = state.pricing.plan === 'public' ? '' : state.pricing[state.pricing.plan];
  const { rows, buyout, priced } = modelRows();
  const lede = $('#modelsLede');
  lede.textContent = buyout
    ? `${basisLine(lastAnalysis.horizonMonths)} The green line is buying out your ${curLabel()} at ${money(buyout.monthly)}/mo.`
    : 'Every model is priced as a purchase and a lease with local dealer prices and current manufacturer offers, then ranked by what it really costs per month.';
  $('#modelCompare').innerHTML = (rows.length ? compareChart(priced, buyout) : `<div class="empty small"><p>No models yet. Tap <b>Add comparable models</b> to fill this with the cars that compete with your ${esc(curLabel())}.</p></div>`)
    + rows.map((x) => `<article class="mc ${x.rank === 1 ? 'first' : ''}" data-card="${x.i}">
        <div class="mc-sum" data-sum="${x.i}">${summaryHTML(x, buyout)}</div>
        <details class="mc-edit" data-cid="${x.c.id}" ${openEditors.has(x.c.id) ? 'open' : ''}><summary>Price, offers and terms</summary>${candidateHTML(x.c, x.i)}</details>
      </article>`).join('');
}

// Refresh numbers without rebuilding the editors (keeps focus while typing).
function updateModelSummaries() {
  const { rows, buyout, priced } = modelRows();
  for (const x of rows) { const el = $(`[data-sum="${x.i}"]`); if (el) el.innerHTML = summaryHTML(x, buyout); }
  const chart = $('#modelCompare .compare-chart');
  if (chart) chart.outerHTML = compareChart(priced, buyout);
  else if (priced.length && $('#modelCompare')) renderModels();
}

function renderCarId() {
  const L = state.lookup;
  const el = $('#carId');
  if (!L?.vehicle?.make) {
    const c = state.current;
    if (c.make && c.model) {
      el.hidden = false;
      el.innerHTML = `${state.photo?.url ? imgHTML(state.photo.url, 'Your car', phCls(state.photo, 'car-ph')) : ''}<div class="name">${logoHTML(c.make, 'inline')}${esc([c.year, c.make, c.model, c.trim].filter(Boolean).join(' '))}</div><div class="spec">${c.mpg ? `${esc(c.mpg)} mpg combined` : ''}</div>${photoButton()}`;
    } else el.hidden = true;
    $('#valueSource').textContent = '';
    return;
  }
  const v = L.vehicle;
  const open = (L.recalls || []).filter((r) => !/closed|complete|remedied/i.test(r.status || ''));
  el.hidden = false;
  el.innerHTML = `${state.photo?.url ? imgHTML(state.photo.url, 'Your car', phCls(state.photo, 'car-ph')) : ''}<div class="name">${logoHTML(v.make, 'inline')}${esc([v.year, v.make, v.model, v.trim].filter(Boolean).join(' '))}</div>
    <div class="spec">${esc([v.style || v.body, v.engine, v.drivetrain, v.mpg ? `${v.mpg} mpg combined` : ''].filter(Boolean).join(', '))}</div>
    ${photoButton()}
    ${L.recalls ? `<div class="recalls">${open.length ? `${open.length} open recall${open.length > 1 ? 's' : ''}. Details below the results.` : '<span style="color:var(--go)">No open recalls found.</span>'}</div>` : ''}`;
  $('#valueSource').textContent = L.valuation ? `Value source: ${L.valuation.method}.` : '';
}

// ---------- Results ----------
const CAT_ORDER = ['Current lease exit', 'Vehicle price', 'Lease payments & signing', 'Lease-end charges', 'Loan interest', 'Taxes & fees', 'Insurance', 'Fuel', 'Maintenance & repairs', 'Registration'];
const CAT_COLOR = {
  'Vehicle price': 'var(--s1)', 'Lease payments & signing': 'var(--s2)', 'Lease-end charges': 'var(--s9)', 'Loan interest': 'var(--s8)',
  'Taxes & fees': 'var(--s6)', Insurance: 'var(--s3)', Fuel: 'var(--s7)', 'Maintenance & repairs': 'var(--s5)', Registration: 'var(--s4)', 'Current lease exit': 'var(--s10)',
};
const CAT_LABEL = { 'Vehicle price': 'Price paid minus resale value', 'Current lease exit': 'Ending current lease' };
const LINE_COLORS = ['var(--go)', 'var(--s2)', 'var(--s6)', 'var(--s9)', 'var(--s8)', 'var(--s3)', 'var(--s7)'];

let lastAnalysis = null;
function winnerPhoto(best) {
  if (best.kind === 'buyout') return state.photo?.url ? state.photo : null;
  const c = state.candidates.find((x) => x.id === best.candidateId);
  const url = c && photoOf(c);
  return url ? { url, exact: !!c.photo?.cutout, custom: !!c.photo?.cutout } : null;
}
function renderResults() {
  const r = analyze(analysisInput());
  lastAnalysis = r;
  const el = $('#results');
  const H = r.horizonMonths;

  if (!r.scenarios.length) {
    el.innerHTML = `<div class="empty"><h2>Is your buyout a good deal?</h2>
      <p>Three steps to an answer:</p>
      <ol><li>Look up your car by VIN so the app knows what it’s worth today.</li>
      <li>Enter the buyout price from your payoff quote and your lease mileage.</li>
      <li>Open <a href="#" data-goto="models">Compare models</a> and add the cars you’d replace it with.</li></ol>
      ${r.warnings.length ? `<div class="warns" style="margin-top:14px">${r.warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join('')}</div>` : ''}</div>`;
    return;
  }

  const best = r.scenarios[0];
  state.lastVerdict = verdictShort(best);
  const v = r.verdict;
  const eq = r.equity;
  const stickerFresh = renderResults.lastHeadline !== v.headline;
  renderResults.lastHeadline = v.headline;

  const equityCells = [];
  if (eq.marketValueNow > 0) equityCells.push(`<div><b>${money(eq.valueAtLeaseEnd)}</b><span>Worth at lease end</span></div>`);
  if (eq.buyoutPrice > 0) equityCells.push(`<div><b>${money(eq.buyoutPrice)}</b><span>Buyout price</span></div>`);
  if (eq.marketValueNow > 0 && eq.buyoutPrice > 0) {
    equityCells.push(`<div><b class="${eq.retailEquity >= 0 ? 'pos' : 'neg'}">${money(eq.retailEquity)}</b><span>Equity at retail</span></div>`);
    equityCells.push(`<div><b class="${eq.tradeEquity >= 0 ? 'pos' : 'neg'}">${money(eq.tradeEquity)}</b><span>Equity if a dealer buys it</span></div>`);
  }
  equityCells.push(`<div><b class="${eq.returnCharges > 0 ? 'neg' : ''}">${money(eq.returnCharges)}</b><span>Cost to hand it back${eq.excessMiles > 0 ? ` (${Math.round(eq.excessMiles).toLocaleString()} mi over)` : ''}</span></div>`);

  const scenarioRows = r.scenarios.map((s, i) => {
    const cats = CAT_ORDER.filter((c) => s.breakdown[c]).map((c) => `<tr><td>${esc(CAT_LABEL[c] || c)}</td><td>${money(s.breakdown[c])}</td></tr>`).join('');
    const tv = Math.abs(s.timeValue) >= 1 ? `<tr><td>Time value of money (${r.assumptions.discountRatePct}%)</td><td>${money(s.timeValue)}</td></tr>` : '';
    return `<li>
      <span class="t">${logoHTML(s.kind === 'buyout' ? state.current.make : winnerMake(s), 'inline')}${esc(optTitle(s))}${s.estimated ? ' <span class="tag">estimated payment</span>' : ''}</span>
      <span class="m"><b>${money(s.monthly)}</b><small>${esc(unitLabel())}</small></span>
      <span class="d">${payText(s) ? `<span>${esc(payText(s))}</span>` : ''}<span>${money(s.paidOverPeriod)} paid over ${H} months</span>${runningOn() ? '' : `<span>+ about ${money(s.runningPerMonth)}/mo gas, insurance, upkeep</span>`}${s.upfront < 0 ? `<span>${money(-s.upfront)} back at start</span>` : ''}</span>
      <details><summary>Where the money goes</summary>
        <table>${cats}${tv}<tr><td><b>Total</b></td><td><b>${money(s.pvCost)}</b></td></tr></table>
        <ul class="notes">${s.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
      </details>
    </li>`;
  }).join('');

  const recalls = state.lookup?.recalls || [];
  const curPh = state.photo?.url ? state.photo : null;
  const optRows = r.scenarios.slice(0, 6).map((s) => {
    const ph = winnerPhoto(s);
    const d = r.scenarios.find((x) => x.kind === 'buyout');
    const diff = d && s.kind !== 'buyout' ? s.monthly - d.monthly : null;
    return `<li class="opt">
      <div class="o-pic">${ph ? imgHTML(ph.url, s.vehicle, phCls(ph)) : '<span class="ph ph-empty"></span>'}</div>
      <div class="o-t">${logoHTML(s.kind === 'buyout' ? state.current.make : winnerMake(s), 'inline')}<b>${esc(optTitle(s))}</b><small>${esc(payText(s) || '')}${s.estimated ? ', estimated' : ''}</small></div>
      <div class="o-m"><b>${money(s.monthly)}</b><small>${diff == null ? 'a month' : `${diff >= 0 ? '+' : '−'}${money(Math.abs(diff))} vs. buying out`}</small></div>
      ${stackChips(s)}
    </li>`;
  }).join('');
  el.innerHTML = `
    <article class="sticker options-view ${stickerFresh ? 'fresh' : ''}">
      <div class="band"><span>${deadlineShort(state) ? esc(deadlineShort(state)) : 'Your options'}</span><span>${periodText(H)}, ${Math.round(Number(r.assumptions.annualMiles) / 1000)}k mi a year</span></div>
      <div class="verdict ${curPh ? 'with-ph' : ''}"><div class="v-head">${logoHTML(state.current.make)}<h1>Your options</h1><p class="v-sub">${r.scenarios.length} ways forward from your ${esc(curLabel())}, ${esc(unitLabel())}, lowest first.</p></div>${curPh ? `<figure>${imgHTML(curPh.url, curLabel(), phCls(curPh, 'win-ph'))}</figure>` : ''}</div>
      <ol class="opts">${optRows}</ol>
      ${r.scenarios.length > 6 ? `<p class="opts-more"><a href="#all-options">See all ${r.scenarios.length} options</a></p>` : ''}
      <p class="fine">${esc(basisLine(H))}</p>
    </article>

    ${byPlaceHTML(r)}
    ${repriceBannerHTML()}
    <div class="verdict-actions">
      <button type="button" class="btn small" data-act="share"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 13v6h14v-6"></path></svg>Share these options</button>
      <button type="button" class="btn small ghost" data-act="settings">How costs are counted</button>
      <button type="button" class="btn small ghost" data-act="reprice">Re-check prices now</button>
    </div>
    ${r.warnings.length ? `<div class="warns">${r.warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join('')}</div>` : ''}

    ${timelineHTML()}

    <section class="panel"><h2>Your lease equity</h2>
      <p class="sub">${eq.monthsToEnd >= 1 ? `Projected to lease end in ${Math.round(eq.monthsToEnd)} months at ${Math.round(eq.milesAtEnd).toLocaleString()} miles. ` : ''}Positive equity is money you keep by buying out or trading in instead of returning the car.</p>
      <div class="equity">${equityCells.join('')}</div>
    </section>

    <section class="panel" id="all-options"><h2>All options, lowest monthly first</h2><p class="sub">${esc(basisLine(H))}</p><ol class="rank">${scenarioRows}</ol></section>

    <section class="panel"><h2>Where the money goes</h2>
      <p class="sub">Total cost over ${fmtYears(H)}. Bars left of zero are money coming back to you.</p>
      ${stackedChart(r)}
    </section>

    <section class="panel"><h2>How long you keep it changes the answer</h2>
      <p class="sub">All-in monthly cost by years kept. Owning gets cheaper the longer you keep the car; leasing stays flat.</p>
      ${lineChart(r)}
    </section>

    ${recalls.length ? `<section class="panel"><h2>Recalls on your car</h2>${recalls.map((x) => `<div class="recall"><b>${esc(x.title || x.id || 'Recall')}${x.status ? ` (${esc(x.status)})` : ''}</b><p>${esc(x.description || '')}</p>${x.remedy ? `<p>Fix: ${esc(x.remedy)}</p>` : ''}</div>`).join('')}</section>` : ''}

    <p class="sources">${sourcesLine()}</p>`;
}

// ---------- Re-pricing notice, decide-by timeline, reminders, sharing ----------
function repriceBannerHTML() {
  const n = state.repriceNotice;
  const when = state.repricedAt ? new Date(state.repricedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;
  if (n && n.at && n.before && n.after && n.before !== n.after) {
    return `<div class="notice changed" role="status"><b>The lowest-cost option changed.</b> Prices re-checked ${esc(when || '')}: it was “${esc(n.before)}”, now “${esc(n.after)}”. <button type="button" class="linkish" data-act="dismiss">Got it</button></div>`;
  }
  return when ? `<p class="checked">Prices and offers re-checked ${esc(when)}${n?.after ? `; the lowest is still “${esc(n.after)}”` : ''}. They refresh automatically, more often as the deadline gets close.</p>` : '';
}

const MILESTONES = [
  { days: 90, title: 'Get a fresh payoff quote', text: 'Ask the leasing company for a lease-end payoff quote and update the buyout price in the app.' },
  { days: 60, title: 'Check the numbers', text: 'Prices and manufacturer offers have been re-checked. Open the app to see if the answer changed.' },
  { days: 30, title: 'Book the pre-return inspection', text: 'If you might return it, book the free pre-return inspection so wear charges aren’t a surprise. Shop the offers you like.' },
  { days: 7, title: 'Decide', text: 'Final numbers are in the app. Bring the payoff quote and the offer details to the dealer or leasing company.' },
];
function milestoneDates(p) {
  const end = p.current.leaseEndDate;
  if (!end) return [];
  const e = new Date(`${end}T12:00:00`);
  return [...MILESTONES.map((m) => ({ ...m, date: new Date(e.getTime() - m.days * 86400000) })), { days: 0, title: 'Lease ends', text: 'Last day of the lease.', date: e }];
}
function timelineHTML() {
  const ms = milestoneDates(state);
  if (!ms.length) return `<section class="panel"><h2>Between now and the deadline</h2><p class="sub">Add the lease end date on the Your car tab to get a timeline and reminders.</p></section>`;
  const now = Date.now();
  return `<section class="panel"><h2>Between now and the deadline</h2>
    <ol class="timeline">${ms.map((m) => `<li class="${m.date.getTime() < now ? 'past' : ''}"><span class="t-when">${m.days ? `${m.days} days out` : 'Lease ends'}<small>${m.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</small></span><span><b>${esc(m.title)}</b><br>${esc(m.text)}</span></li>`).join('')}</ol>
    <button type="button" class="btn small" data-act="ics"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2"></rect><path d="M3.5 10h17M8 3v4M16 3v4"></path></svg>Add reminders to my calendar</button>
  </section>`;
}
function downloadReminders() {
  const ms = milestoneDates(state).filter((m) => m.date.getTime() > Date.now() - 86400000);
  if (!ms.length) { toast('No upcoming dates to remind you about.'); return; }
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const link = location.origin + location.pathname;
  const escI = (t) => String(t).replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const name = profileName(state);
  const events = ms.map((m, i) => [
    'BEGIN:VEVENT',
    `UID:${store.active}-${m.days}-${ymd(m.date)}@lease-buyout-advisor`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${ymd(m.date)}T090000`,
    'DURATION:PT30M',
    `SUMMARY:${escI(`${name}: ${m.title}`)}`,
    `DESCRIPTION:${escI(`${m.text}\n${m.days ? `${m.days} days until the lease ends.` : ''}\n${link}`)}`,
    `URL:${link}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escI(m.title)}`, 'TRIGGER:-PT0M', 'END:VALARM',
    'END:VEVENT',
  ].join('\r\n'));
  void events;
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lease Buyout Advisor//EN', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR'].join('\r\n');
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${name.replace(/[^\w]+/g, '-')}-reminders.ics` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function shareDecision() {
  try {
    persist();
    await new Promise((r) => setTimeout(r, 1400)); // let the latest numbers save first
    const res = await fetch('api/share', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId: store.active }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Couldn’t make a share link.');
    const url = new URL(body.url, location.href).href;
    const title = `${profileName(state)}: lease decision`;
    if (navigator.share) { try { await navigator.share({ title, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    await navigator.clipboard.writeText(url);
    toast('Share link copied. It shows this car’s decision only, without the VIN.');
  } catch (e) { toast(e.message); }
}
async function repriceNow() {
  toast('Re-checking prices and offers…');
  try {
    persist();
    await new Promise((r) => setTimeout(r, 1400));
    const res = await fetch('api/reprice-now', { method: 'POST' });
    if (!res.ok) throw new Error('Couldn’t re-check right now.');
    await reloadFromServer('Prices and offers re-checked.');
    refreshUsage();
  } catch (e) { toast(e.message); }
}

function sourcesLine() {
  const s = state.lookup?.sources || {};
  const parts = [];
  if (s.decode) parts.push(`Vehicle details: ${s.decode}`);
  if (s.value) parts.push(`value: ${s.value}`);
  if (s.recalls) parts.push(`recalls: ${s.recalls}`);
  const mk = state.candidates.map((c) => c.market?.source).filter(Boolean);
  if (mk.length) parts.push(`new-car prices: ${[...new Set(mk)].join(', ')}`);
  return parts.length ? `Data: ${parts.join('; ')}.` : '';
}

function shortTitle(s, narrow = false) {
  if (s.kind === 'buyout') return 'Buy out current';
  const name = narrow ? s.vehicle.split(' ').filter((w) => !/^\d{4}$/.test(w)).slice(1).join(' ') || s.vehicle : s.vehicle;
  return `${s.kind === 'lease' ? 'Lease' : 'Buy'} ${name}`;
}

function chartWidth() {
  return Math.round(Math.min(760, Math.max(300, $('#results').clientWidth || 640)));
}

function stackedChart(r) {
  const rows = r.scenarios;
  const W = chartWidth(), rowH = 34, left = W < 480 ? 112 : 150, right = 12, top = 8;
  const H = top + rows.length * rowH + 24;
  let min = 0, max = 0;
  for (const s of rows) {
    let pos = 0, neg = 0;
    for (const [k, v] of Object.entries(s.breakdown)) (v >= 0 ? (pos += v) : (neg += v));
    max = Math.max(max, pos); min = Math.min(min, neg);
  }
  const span = max - min || 1;
  const x = (v) => left + ((v - min) / span) * (W - left - right);
  const ticks = niceTicks(min, max, 4);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cost breakdown by option"><g class="grid">`;
  for (const t of ticks) svg += `<line x1="${x(t)}" x2="${x(t)}" y1="${top}" y2="${H - 20}"/><text x="${x(t)}" y="${H - 6}" text-anchor="middle">${shortMoney(t)}</text>`;
  svg += `</g><line class="zero" x1="${x(0)}" x2="${x(0)}" y1="${top}" y2="${H - 20}"/>`;
  rows.forEach((s, i) => {
    const y = top + i * rowH + 6;
    svg += `<text x="${left - 8}" y="${y + 15}" text-anchor="end">${esc(trunc(shortTitle(s, W < 480), W < 480 ? 16 : 24))}</text>`;
    let pos = 0, neg = 0;
    for (const c of CAT_ORDER) {
      const v = s.breakdown[c]; if (!v) continue;
      const a = v >= 0 ? pos : neg + v;
      const w = Math.abs(x(a + Math.abs(v)) - x(a));
      svg += `<rect x="${x(a)}" y="${y}" width="${Math.max(0, w)}" height="22" rx="2" fill="${CAT_COLOR[c]}"><title>${esc(CAT_LABEL[c] || c)}: ${money(v)}</title></rect>`;
      if (v >= 0) pos += v; else neg += v;
    }
  });
  svg += '</svg>';
  const used = CAT_ORDER.filter((c) => rows.some((s) => s.breakdown[c]));
  return svg + `<div class="legend">${used.map((c) => `<span><i style="background:${CAT_COLOR[c]}"></i>${esc(CAT_LABEL[c] || c)}</span>`).join('')}</div>`;
}

function lineChart(r) {
  const keys = r.scenarios.map((s) => s.id);
  const W = chartWidth(), H = W < 480 ? 220 : 260, l = 48, rt = 12, t = 10, b = 28;
  const vals = r.curve.flatMap((row) => keys.map((k) => row[k]).filter(Number.isFinite));
  if (!vals.length) return '';
  const lo = Math.min(...vals) * 0.92, hi = Math.max(...vals) * 1.04;
  const x = (yr) => l + ((yr - 1) / 7) * (W - l - rt);
  const y = (v) => t + (1 - (v - lo) / (hi - lo || 1)) * (H - t - b);
  const ticks = niceTicks(lo, hi, 4);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly cost by years kept"><g class="grid">`;
  for (const tk of ticks) if (tk >= lo && tk <= hi) svg += `<line x1="${l}" x2="${W - rt}" y1="${y(tk)}" y2="${y(tk)}"/><text x="${l - 6}" y="${y(tk) + 4}" text-anchor="end">${shortMoney(tk)}</text>`;
  for (let yr = 1; yr <= 8; yr++) svg += `<text x="${x(yr)}" y="${H - 8}" text-anchor="middle">${W < 480 ? yr : `${yr} yr`}</text>`;
  svg += '</g>';
  const horizonYr = r.horizonMonths / 12;
  if (horizonYr >= 1 && horizonYr <= 8) svg += `<line x1="${x(horizonYr)}" x2="${x(horizonYr)}" y1="${t}" y2="${H - b}" stroke="var(--ink)" stroke-dasharray="3 4" stroke-width="1"/>`;
  keys.forEach((k, i) => {
    const pts = r.curve.filter((row) => Number.isFinite(row[k])).map((row) => `${x(row.years)},${y(row[k])}`).join(' ');
    const color = LINE_COLORS[i % LINE_COLORS.length];
    svg += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="${i === 0 ? 3.5 : 2}" stroke-linejoin="round" stroke-linecap="round"/>`;
  });
  svg += '</svg>';
  return svg + `<div class="legend">${r.scenarios.map((s, i) => `<span><i class="line" style="background:${LINE_COLORS[i % LINE_COLORS.length]}"></i>${esc(shortTitle(s))}</span>`).join('')}<span><i class="line" style="background:var(--ink);opacity:.6"></i>your horizon</span></div>`;
}

function niceTicks(lo, hi, n) {
  const span = hi - lo || 1;
  const step0 = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || step0;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v));
  return out;
}
const shortMoney = (v) => (Math.abs(v) >= 1000 ? `${v < 0 ? '−' : ''}$${Math.round(Math.abs(v) / 100) / 10}k` : `${v < 0 ? '−' : ''}$${Math.round(Math.abs(v))}`);
const trunc = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ---------- Persistence ----------
let saveTimer;
function snapshot() {
  const profiles = {};
  for (const [id, p] of Object.entries(store.profiles)) {
    profiles[id] = { name: p.name, pricing: p.pricing, segment: p.segment, photo: p.photo, suggested: p.suggested, lastVerdict: p.lastVerdict, repricedAt: p.repricedAt, repriceLog: p.repriceLog, needsVerdictCheck: p.needsVerdictCheck, repriceNotice: p.repriceNotice, assumptions: p.assumptions, eligibility: p.eligibility, safetyPrefs: p.safetyPrefs, stackVersion: p.stackVersion, regionInfo: p.regionInfo, needsOfferRefresh: p.needsOfferRefresh, current: p.current, candidates: p.candidates.map(({ status, statusErr, ...c }) => c), lookup: p.lookup };
  }
  return JSON.stringify({ active: store.active, rev: store.rev || 0, profiles });
}
function persist() {
  const snap = snapshot();
  try { localStorage.setItem(STORAGE_KEY, snap); } catch {}
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const res = await fetch('api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: snap });
      if (res.status === 409) await reloadFromServer('Prices were just re-checked on the server, so the latest numbers were loaded.');
    } catch {}
  }, 1200);
}

function hydrate(p) {
  const b = blankProfile(p.name || 'My car');
  return {
    ...b,
    name: p.name || b.name,
    pricing: { ...b.pricing, ...p.pricing },
    segment: p.segment || '',
    photo: p.photo || null,
    suggested: !!p.suggested,
    lastVerdict: p.lastVerdict || null, repricedAt: p.repricedAt || null, repriceLog: p.repriceLog || null,
    needsVerdictCheck: !!p.needsVerdictCheck, repriceNotice: p.repriceNotice || null,
    assumptions: { ...b.assumptions, ...p.assumptions },
    eligibility: { leaseCaptive: true, ...(p.eligibility || {}) },
    regionInfo: { ...(p.regionInfo || {}) },
    safetyPrefs: { ...(p.safetyPrefs || {}) },
    stackVersion: p.stackVersion || 0,
    needsOfferRefresh: !!p.needsOfferRefresh,
    current: { ...b.current, ...p.current },
    candidates: (p.candidates || []).map((c) => blankCandidate({ ...c, buy: { ...blankCandidate().buy, ...c.buy }, lease: { ...blankCandidate().lease, ...c.lease } })),
    lookup: p.lookup || null,
  };
}

async function restore() {
  let saved = null;
  try { saved = await api('api/profile'); } catch {}
  if (!saved) { try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem('lba:v1') || 'null'); } catch {} }
  if (saved && saved.current && !saved.profiles) saved = { active: 'p1', profiles: { p1: { name: 'My car', ...saved } } }; // old single-car format
  store.rev = saved?.rev || 0;
  if (saved && saved.profiles && Object.keys(saved.profiles).length) {
    store.profiles = Object.fromEntries(Object.entries(saved.profiles).map(([id, p]) => [id, hydrate(p)]));
    store.active = store.profiles[saved.active] ? saved.active : Object.keys(store.profiles)[0];
  } else {
    store.active = newId();
    store.profiles[store.active] = blankProfile('My car');
  }
  state = store.profiles[store.active];
  afterLoad();
}

// After loading: re-pick offers the server refreshed, and note whether the answer changed.
// Carol's Edge is white: always show the white studio shot of it, never a listing photo in another color.
const WHITE_EDGE = { url: 'img/ford-edge-2024-white.png', exact: true, custom: true, cutout: true, fixed: 'white-edge' };
function knownHousehold(id, p) {
  const isCarols = id === 'carol' || /carol/i.test(p.name || '');
  if (!isCarols || p.eligibility?.setAt) return false;
  p.eligibility = { owned: 'Toyota, Cadillac', military: true, leaseCaptive: true, setAt: '2026-10-23', ...(p.eligibility || {}) };
  for (const c of p.candidates || []) if (c.offers?.length) c.needsPick = true;
  return true;
}
// Carol lives in North Port, FL (the Edge is still registered in Michigan); Scott is in Highlands Ranch, CO.
function knownPlaces(id, p) {
  const isCarols = id === 'carol' || /carol/i.test(p.name || '');
  if (!isCarols || p.assumptions?.whereSetAt) return false;
  p.assumptions = { ...p.assumptions, zip: '34287', state: 'FL', salesTaxPct: '', leaseTaxPct: '', tradeInTaxCredit: true, shopZips: '48302, 80129', whereSetAt: '2026-10-23' };
  p.regionInfo = { ...(p.regionInfo || {}), 34287: { city: 'North Port', st: 'FL' }, 48302: { city: 'Bloomfield Hills', st: 'MI' }, 80129: { city: 'Highlands Ranch', st: 'CO' } };
  p.needsOfferRefresh = true;
  return true;
}
function fixedPhotos(id, p) {
  const isCarols = id === 'carol' || /carol/i.test(p.name || '');
  if (isCarols && /ford/i.test(p.current?.make || '') && /edge/i.test(p.current?.model || '') && p.photo?.fixed !== 'white-edge') { p.photo = { ...WHITE_EDGE }; return true; }
  return false;
}
function afterLoad() {
  let fixed = false;
  for (const [id, p] of Object.entries(store.profiles)) {
    fixed = fixedPhotos(id, p) || fixed; fixed = knownHousehold(id, p) || fixed; fixed = knownPlaces(id, p) || fixed;
    // Stacking rules changed (no public rebates on advertised leases): re-pick saved offers once.
    if ((p.stackVersion || 0) < 2) { for (const c of p.candidates || []) if (c.offers?.length && !c.userPicked) c.needsPick = true; p.stackVersion = 2; fixed = true; }
    // Junk listing prices (a $998 "price" on a $48k car) got saved while MarketCheck was out: clear them.
    if ((p.stackVersion || 0) < 3) {
      for (const c of p.candidates || []) {
        const floor = c.condition && c.condition !== 'new' ? 2000 : 10000;
        const msrp = Number(c.msrp) || 0, price = Number(c.sellingPrice) || 0;
        if (msrp && msrp < floor) c.msrp = '';
        if (price && (price < floor || (Number(c.msrp) && price < 0.5 * Number(c.msrp)))) { c.sellingPrice = c.msrp || ''; c.status = 'The listed price looked wrong. Tap Refresh prices when you can.'; c.needsPick = !!c.offers?.length; }
      }
      p.stackVersion = 3; fixed = true;
    }
  }
  if (fixed) setTimeout(() => persist(), 0);
  for (const p of Object.values(store.profiles)) {
    for (const c of p.candidates) if (c.needsPick) { const keep = state; state = p; autoPick(c); state = keep; delete c.needsPick; }
    if (p.needsVerdictCheck) {
      const v = profileVerdict(p);
      const now = v ? v.short : null;
      p.repriceNotice = { at: p.repricedAt, before: p.lastVerdict || null, after: now };
      p.lastVerdict = now;
      p.needsVerdictCheck = false;
    }
  }
  // Places changed (e.g. a new home ZIP): fetch every market's offers once.
  if (state.needsOfferRefresh && state.candidates.some((c) => c.make && c.model) && !refreshing) {
    refreshing = true;
    setTimeout(async () => {
      const p = state;
      try { await priceAll(false); p.needsOfferRefresh = false; persist(); toast(`Offers updated for ${shopRegions().length} places`); } catch {} finally { refreshing = false; }
    }, 1200);
  }
}
var refreshing = false; // var: afterLoad can run before this line is reached

async function reloadFromServer(msg) {
  try {
    const saved = await api('api/profile');
    if (!saved?.profiles) return;
    store.rev = saved.rev || 0;
    store.profiles = Object.fromEntries(Object.entries(saved.profiles).map(([id, p]) => [id, hydrate(p)]));
    if (!store.profiles[store.active]) store.active = Object.keys(store.profiles)[0];
    state = store.profiles[store.active];
    afterLoad();
    renderAll();
    if (msg) toast(msg);
  } catch {}
}

function toast(msg) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 5000);
}

function profileName(p) {
  return p.name || [p.current.year, p.current.make, p.current.model].filter(Boolean).join(' ') || 'My car';
}

function renderProfiles() {
  $('#garageLabel').textContent = profileName(state);
}

function switchProfile(id) {
  store.active = id;
  state = store.profiles[id];
  renderAll();
  persist();
  if (!state.suggested && state.current.make && state.current.model && !state.candidates.length) autoSuggest();
}

const fmtDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
function daysUntil(d) {
  if (!d) return null;
  const t = new Date(`${d}T12:00:00`);
  if (Number.isNaN(t.getTime())) return null;
  return Math.ceil((t - new Date()) / 86400000);
}
function deadlineShort(p) {
  const n = daysUntil(p.current.leaseEndDate);
  if (n == null) return '';
  if (n < 0) return 'Lease has ended';
  return n === 0 ? 'Decide today' : `Decide by ${new Date(`${p.current.leaseEndDate}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${n} days`;
}
function deadlineText(p) {
  const n = daysUntil(p.current.leaseEndDate);
  if (n == null) return '';
  if (n < 0) return `Lease ended ${fmtDate(p.current.leaseEndDate)}`;
  if (n === 0) return 'Decide today';
  return `Decide by ${fmtDate(p.current.leaseEndDate)}, ${n} day${n === 1 ? '' : 's'} left`;
}

function verdictShort(best) {
  const name = best.vehicle.split(' ').filter((w) => !/^\d{4}$/.test(w)).slice(1).join(' ') || best.vehicle;
  return best.kind === 'buyout' ? 'Buy out' : best.kind === 'lease' ? `Lease ${name}` : `Buy ${best.condition && best.condition !== 'new' ? `${best.condition} ` : ''}${name}`;
}
function profileVerdict(p) {
  try {
    const r = analyze(analysisInput(p.candidates, {}, p));
    const best = r.scenarios[0];
    if (!best) return null;
    return { short: verdictShort(best), monthly: best.monthly, compared: r.scenarios.length, mode: r.assumptions.costMode };
  } catch { return null; }
}

function renderGarage() {
  $('#garageList').innerHTML = Object.entries(store.profiles).map(([id, p]) => {
    const v = profileVerdict(p);
    const c = p.current;
    const sub = [[c.year, c.make, c.model, c.trim].filter(Boolean).join(' '), c.currentMiles ? `${Number(c.currentMiles).toLocaleString()} mi` : ''].filter(Boolean).join(', ');
    return `<article class="g-car ${id === store.active ? 'on' : ''}">
      <button type="button" class="g-open" data-open="${id}" aria-label="Open ${esc(profileName(p))}">
        <div class="g-pic">${imgHTML(p.photo?.url, profileName(p), phCls(p.photo))}</div>
        <div class="g-text">
          <b>${logoHTML(c.make, 'inline')}${esc(profileName(p))}</b>
          <small>${esc(sub || 'No car details yet')}</small>
          ${deadlineText(p) ? `<small class="g-deadline">${esc(deadlineText(p))}</small>` : ''}
        </div>
        ${v ? `<div class="g-verdict"><small>${v.compared} options</small><small>from ${money(v.monthly)}/mo</small></div>` : ''}
      </button>
      <div class="g-actions"><button type="button" class="btn ghost small" data-rename="${id}">Rename</button>${Object.keys(store.profiles).length > 1 ? `<button type="button" class="btn ghost small" data-delete="${id}">Delete</button>` : ''}</div>
    </article>`;
  }).join('');
}

function openGarage() { renderGarage(); $('#garage').showModal(); }

function onGarageClick(e) {
  const o = e.target.closest('[data-open]');
  if (o) { $('#garage').close(); switchProfile(o.dataset.open); setTab(wide() ? 'car' : 'verdict'); return; }
  const r = e.target.closest('[data-rename]');
  if (r) {
    const p = store.profiles[r.dataset.rename];
    const name = prompt('Rename this car', profileName(p));
    if (name && name.trim()) { p.name = name.trim(); persist(); renderGarage(); renderProfiles(); }
    return;
  }
  const d = e.target.closest('[data-delete]');
  if (d) {
    const p = store.profiles[d.dataset.delete];
    if (confirm(`Delete “${profileName(p)}” and everything saved with it?`)) {
      delete store.profiles[d.dataset.delete];
      if (store.active === d.dataset.delete) switchProfile(Object.keys(store.profiles)[0]);
      else persist();
      renderGarage();
    }
  }
}

// ---------- Add a car (three steps) ----------
const draft = { step: 1, lookup: null };
function showStep(n) {
  draft.step = n;
  for (const sec of $$('#addCar .step')) sec.hidden = Number(sec.dataset.step) !== n;
  $('#addStepLabel').textContent = `Step ${n} of 3`;
  $$('#addCar .steps i').forEach((el, i) => el.classList.toggle('on', i < n));
  $('#addBack').style.visibility = n > 1 ? 'visible' : 'hidden';
  const first = $(`#addCar .step[data-step="${n}"] input`);
  if (first && !wide()) setTimeout(() => first.focus({ preventScroll: true }), 50);
}
function startAdd() {
  if ($('#garage').open) $('#garage').close();
  Object.assign(draft, { step: 1, lookup: null, payoffExtras: null });
  for (const id of ['newName', 'newVin', 'newPlate', 'newMiles', 'newBuyout', 'newEnd', 'newAllowed', 'newPayment']) $(`#${id}`).value = '';
  $('#newZip').value = state.assumptions.zip || '';
  const opts = STATES.map((x) => `<option ${x === state.assumptions.state ? 'selected' : ''}>${x}</option>`).join('');
  $('#newState').innerHTML = opts; $('#newPlateState').innerHTML = opts;
  for (const id of ['step1Status', 'step2Status', 'step3Status']) { $(`#${id}`).textContent = ''; $(`#${id}`).className = 'status'; }
  for (const r of $$('input[name="newPlan"]')) r.checked = r.value === (state.pricing.plan || 'public');
  showStep(1);
  $('#addCar').showModal();
}
function stepStatus(n, msg, err = false) { const el = $(`#step${n}Status`); el.textContent = msg; el.className = `status${err ? ' err' : ''}`; }

async function step1() {
  const vin = $('#newVin').value.trim().toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) { stepStatus(1, 'A VIN is 17 letters and numbers (never I, O or Q). Check it and try again.', true); return; }
  const btn = $('#step1Go'); btn.disabled = true;
  stepStatus(1, 'Looking up this car…');
  try {
    const r = await api(`api/vehicle/${vin}`);
    if (!r.vehicle?.make) throw new Error('That VIN didn’t match a vehicle. Check for a typo.');
    draft.lookup = r; draft.vin = vin;
    draft.photo = null;
    api(`api/photo?${new URLSearchParams({ vin, year: r.vehicle.year || '', make: r.vehicle.make, model: r.vehicle.model, zip: $('#newZip').value })}`)
      .then((ph) => { if (ph.url) { draft.photo = ph; renderConfirm(); } }).catch(() => {});
    if (!$('#newName').value.trim()) $('#newName').value = `My ${r.vehicle.model}`;
    renderConfirm();
    stepStatus(1, '');
    showStep(2);
    refreshUsage();
  } catch (e) { stepStatus(1, e.message, true); } finally { btn.disabled = false; }
}

function renderConfirm() {
  const r = draft.lookup; if (!r) return;
  const v = r.vehicle;
  const open = (r.recalls || []).filter((x) => !/closed|complete|remedied/i.test(x.status || ''));
  $('#confirmCard').innerHTML = `<div class="confirm">
    <div class="c-pic">${imgHTML(draft.photo?.url, [v.year, v.make, v.model].join(' '))}${draft.photo && !draft.photo.exact ? '<small>Similar car from a local listing</small>' : ''}</div>
    <b class="c-name">${esc([v.year, v.make, v.model, v.trim].filter(Boolean).join(' '))}</b>
    <small>${esc([v.style || v.body, v.engine, v.drivetrain, v.mpg ? `${v.mpg} mpg combined` : ''].filter(Boolean).join(', '))}</small>
    <dl class="c-facts">
      <div><dt>Worth today</dt><dd>${draft.value ? money(draft.value.marketValue) : 'after miles'}</dd></div>
      <div><dt>Open recalls</dt><dd>${r.recalls ? open.length : '—'}</dd></div>
    </dl>
  </div>`;
}

async function step2() {
  const miles = Number(String($('#newMiles').value).replace(/[^\d]/g, ''));
  const zip = $('#newZip').value.trim();
  if (!miles) { stepStatus(2, 'Enter the odometer reading.', true); return; }
  if (!/^\d{5}$/.test(zip)) { stepStatus(2, 'Enter a 5-digit ZIP.', true); return; }
  const btn = $('#step2Go'); btn.disabled = true;
  stepStatus(2, 'Checking what it’s worth…');
  try {
    const r = await api(`api/vehicle/${draft.vin}?miles=${miles}&zip=${zip}`);
    draft.lookup = r; draft.miles = miles; draft.zip = zip; draft.state = $('#newState').value;
    draft.value = r.valuation || null;
    renderConfirm();
    stepStatus(2, '');
    showStep(3);
    if (!draft.value) stepStatus(3, 'No market value came back for this car. You can enter one later on the Your car tab.', true);
    refreshUsage();
  } catch (e) { stepStatus(2, e.message, true); } finally { btn.disabled = false; }
}

function step3() {
  const buyout = Number(String($('#newBuyout').value).replace(/[^\d.]/g, ''));
  if (!buyout) { stepStatus(3, 'Enter the buyout price from your payoff quote.', true); return; }
  const v = draft.lookup.vehicle;
  const id = newId();
  const p = blankProfile($('#newName').value.trim() || `My ${v.model}`);
  p.assumptions = { ...state.assumptions, zip: draft.zip, state: draft.state, salesTaxPct: draft.state === state.assumptions.state ? state.assumptions.salesTaxPct : '', leaseTaxPct: draft.state === state.assumptions.state ? state.assumptions.leaseTaxPct : '', tradeInTaxCredit: '' };
  p.current = {
    ...p.current,
    vin: draft.vin, year: String(v.year || ''), make: v.make, model: v.model, trim: v.trim || '', mpg: v.mpg ? String(v.mpg) : '',
    marketValue: draft.value ? String(Math.round(draft.value.marketValue)) : '', msrp: draft.value?.msrp ? String(Math.round(draft.value.msrp)) : '',
    currentMiles: String(draft.miles), buyoutPrice: String(buyout), leaseEndDate: $('#newEnd').value || '',
    allowedMiles: String($('#newAllowed').value).replace(/[^\d]/g, ''), monthlyPayment: String($('#newPayment').value).replace(/[^\d.]/g, ''),
    ...Object.fromEntries(Object.entries(draft.payoffExtras || {}).filter(([, v]) => v !== '')),
  };
  p.lookup = draft.lookup;
  p.photo = draft.photo || null;
  p.pricing = { ...p.pricing, plan: ($$('input[name="newPlan"]').find((r) => r.checked) || {}).value || 'public' };
  store.profiles[id] = p;
  $('#addCar').close();
  switchProfile(id); // runs suggestions for the new car
  setTab('verdict');
}

// ---------- Reading photos: VIN and payoff letter ----------
async function photoToJpeg(file, max = 1600) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  return { dataUrl: cv.toDataURL('image/jpeg', 0.88), bmp };
}
async function readImageApi(kind, dataUrl) {
  const res = await fetch('api/read-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, dataUrl }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Couldn’t read the photo (${res.status}).`);
  return body;
}
// VIN check digit (North American VINs).
function vinValid(v) {
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(v)) return false;
  const map = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
  const w = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
  const sum = [...v].reduce((t, ch, i) => t + (/\d/.test(ch) ? Number(ch) : map[ch]) * w[i], 0);
  const check = sum % 11 === 10 ? 'X' : String(sum % 11);
  return v[8] === check;
}
let zxingLoad;
function loadZxing() {
  zxingLoad ||= new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'vendor/zxing.js'; sc.onload = () => res(window.ZXing); sc.onerror = rej; document.head.appendChild(sc); });
  return zxingLoad;
}
// Try the barcode first (door-jamb Code 39, windshield Data Matrix), in a few sizes and rotations.
async function decodeVinBarcode(bmp) {
  const Z = await loadZxing();
  const hints = new Map();
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.DATA_MATRIX, Z.BarcodeFormat.QR_CODE, Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.PDF_417]);
  hints.set(Z.DecodeHintType.TRY_HARDER, true);
  const reader = new Z.MultiFormatReader(); reader.setHints(hints);
  for (const max of [1400, 900, 2000]) for (const rot of [0, 90]) {
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
    const cv = document.createElement('canvas');
    cv.width = rot ? h : w; cv.height = rot ? w : h;
    const cx = cv.getContext('2d');
    if (rot) { cx.translate(h, 0); cx.rotate(Math.PI / 2); }
    cx.drawImage(bmp, 0, 0, w, h);
    try {
      const res = reader.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(cv))));
      const m = /[A-HJ-NPR-Z0-9]{17}/.exec(String(res.getText()).toUpperCase().replace(/^I(?=[A-HJ-NPR-Z0-9]{17}$)/, ''));
      if (m) return m[0];
    } catch {}
  }
  return null;
}
async function scanVin(file) {
  stepStatus(1, 'Reading the VIN…');
  try {
    const { dataUrl, bmp } = await photoToJpeg(file, 2000);
    let vin = await decodeVinBarcode(bmp).catch(() => null);
    let how = 'barcode';
    if (!vin) { const r = await readImageApi('vin', dataUrl); vin = r.vin ? String(r.vin).toUpperCase().replace(/[^A-Z0-9]/g, '') : null; how = 'text'; }
    if (!vin) throw new Error('Couldn’t find a VIN in that photo. Try closer, with the label filling the frame, or type it in.');
    $('#newVin').value = vin;
    if (vinValid(vin)) { stepStatus(1, `Read the VIN from the ${how}. Looking it up…`); step1(); }
    else stepStatus(1, `Read ${vin} from the ${how}, but it doesn’t pass the VIN check. Fix any wrong character, then tap Look up.`, true);
  } catch (e) { stepStatus(1, e.message, true); }
}
async function readPayoff(file, target) {
  const say = (m, err) => (target === 'draft' ? stepStatus(3, m, err) : (($('#carStatus').className = `status${err ? ' err' : ''}`), ($('#carStatus').textContent = m)));
  say('Reading the payoff letter…');
  try {
    const { dataUrl } = await photoToJpeg(file, 1800);
    const r = await readImageApi('payoff', dataUrl);
    const num = (x) => (x == null || x === '' || Number.isNaN(Number(x)) ? '' : String(Math.round(Number(x) * 100) / 100));
    const found = [];
    if (target === 'draft') {
      if (r.buyoutPrice) { $('#newBuyout').value = num(r.buyoutPrice); found.push(`buyout ${money(Number(r.buyoutPrice))}`); }
      if (r.leaseEndDate) { $('#newEnd').value = r.leaseEndDate; found.push(`lease ends ${fmtDate(r.leaseEndDate)}`); }
      if (r.milesAllowed) { $('#newAllowed').value = num(r.milesAllowed); found.push(`${Number(r.milesAllowed).toLocaleString()} miles allowed`); }
      if (r.monthlyPayment) { $('#newPayment').value = num(r.monthlyPayment); found.push(`payment ${money(Number(r.monthlyPayment))}`); }
      draft.payoffExtras = { purchaseOptionFee: num(r.purchaseOptionFee), excessMileRate: num(r.excessMileRate), dispositionFee: num(r.dispositionFee) };
    } else {
      fillCurrent({ buyoutPrice: num(r.buyoutPrice), leaseEndDate: r.leaseEndDate || '', allowedMiles: num(r.milesAllowed), monthlyPayment: num(r.monthlyPayment), purchaseOptionFee: num(r.purchaseOptionFee), excessMileRate: num(r.excessMileRate), dispositionFee: num(r.dispositionFee) });
      ['buyoutPrice', 'leaseEndDate', 'allowedMiles', 'monthlyPayment'].forEach((k) => { if (state.current[k]) found.push(k); });
      scheduleResults();
    }
    if (!found.length) throw new Error('Couldn’t find the lease numbers in that photo. Try a clearer shot of the payoff page.');
    say(`Read from the letter${r.lessor ? ` (${r.lessor})` : ''}: ${target === 'draft' ? found.join(', ') : 'buyout, dates and fees filled in'}. Check them before you continue.${r.notes ? ` Note: ${r.notes}` : ''}${r.payoffGoodThrough ? ` Quote good through ${fmtDate(r.payoffGoodThrough)}.` : ''}`);
  } catch (e) { say(e.message, true); }
}

// ---------- Suggestions ----------
const DISCONTINUED = new Set(['ford|edge', 'ford|ecosport', 'ford|fusion', 'ford|focus', 'chevrolet|malibu', 'ford|escape']);
function suggestionList(p = state) {
  const cur = { make: p.current.make, model: p.current.model, body: p.lookup?.vehicle?.body };
  if (!cur.make || !cur.model) return [];
  const items = suggestions(cur, 12).items;
  if (!DISCONTINUED.has(`${cur.make}|${cur.model}`.toLowerCase())) items.unshift({ make: cur.make, model: cur.model, reason: 'A new one of the same model' });
  const have = new Set(p.candidates.map((c) => `${c.make}|${c.model}`.toLowerCase()));
  return items.filter((x) => !have.has(`${x.make}|${x.model}`.toLowerCase()));
}

// Gently used versions of the top suggestions: certified ~1 year old, used ~2 years old.
function usedSuggestionList(p = state) {
  const now = new Date();
  const newest = now.getFullYear() + (now.getMonth() >= 8 ? 1 : 0);
  const base = suggestionList(p).filter((x) => x.make && x.model).slice(0, 3);
  const have = new Set(p.candidates.map((c) => `${c.condition || 'new'}|${c.year}|${c.make}|${c.model}`.toLowerCase()));
  const out = [];
  base.forEach((x, k) => {
    out.push({ make: x.make, model: x.model, condition: 'certified', year: String(newest - 2), reason: 'About a year old, with a factory-backed warranty' });
    if (k < 2) out.push({ make: x.make, model: x.model, condition: 'used', year: String(newest - 3), reason: 'Two years old: someone else took the biggest drop in value' });
  });
  return out.filter((x) => !have.has(`${x.condition}|${x.year}|${x.make}|${x.model}`.toLowerCase()));
}

function addSuggestion(x, { price = true } = {}) {
  state.candidates.push(blankCandidate({ year: x.year || '', make: x.make, model: x.model, reason: x.reason, condition: x.condition || 'new' }));
  if (price) priceCandidate(state.candidates.length - 1);
}

function autoSuggest(n = 5) {
  state.suggested = true;
  const list = [...suggestionList().slice(0, n), ...usedSuggestionList().filter((x) => x.condition === 'certified').slice(0, 1)];
  if (!list.length) return;
  for (const x of list) addSuggestion(x, { price: false });
  renderModels(); persist();
  $('#modelsStatus').textContent = `Suggested ${list.map((x) => carName(x)).join(', ')}. Getting prices…`;
  priceAll(true);
}

function renderIdeas() {
  const fresh = suggestionList().slice(0, 8);
  const used = usedSuggestionList().slice(0, 5);
  const el = $('#ideas');
  if (!fresh.length && !used.length) { el.innerHTML = ''; return; }
  const chips = (list, tag) => list.map((x, i) => `<button type="button" class="idea" data-idea="${tag}:${i}">${logoHTML(x.make)}<b>+ ${esc(carName(x))}</b><small>${esc(x.reason)}</small></button>`).join('');
  el.innerHTML = `${fresh.length ? `<h3 class="ideas-h">New, suggested for your ${esc(state.current.model)}</h3><div class="ideas">${chips(fresh, 'n')}</div>` : ''}
    ${used.length ? `<h3 class="ideas-h">Gently used and certified</h3><div class="ideas">${chips(used, 'u')}</div>` : ''}`;
  el.onclick = (e) => {
    const b = e.target.closest('[data-idea]'); if (!b) return;
    const [tag, i] = b.dataset.idea.split(':');
    addSuggestion((tag === 'u' ? used : fresh)[Number(i)]);
  };
}

// ---------- Every lease deal nearby, all makes ----------
let deals = null; // { offers, found, at }
let dealsShown = 20;
const NOT_SUV = new Set(['midsize-sedan', 'compact-car', 'fullsize-pickup', 'midsize-pickup']);
const SUV_MODELS = new Set(Object.entries(SEGMENTS).filter(([k]) => !NOT_SUV.has(k)).flatMap(([, v]) => v.models.map(([mk, md]) => `${mk}|${md}`.toLowerCase())));
const SUV_NAME = /\b(SUV|crossover|X[1-7]|iX|Q[2-8]|Q4|e-tron|GL[ABCES]|EQ[BES]|G-Class|XC\d0|EX\d0|[NRUGTL]X|RZ|QX\d0|MDX|RDX|ZDX|ADX|GV\d0|CX-\d0?|RAV4|CR-V|HR-V|Pilot|Passport|Prologue|Rogue|Murano|Pathfinder|Kicks|Ariya|Armada|Highlander|4Runner|Sequoia|Venza|bZ|Corolla Cross|Tucson|Santa Fe|Palisade|Kona|Ioniq [59]|Sportage|Sorento|Telluride|Seltos|EV[369]|Niro|Forester|Outback|Ascent|Crosstrek|Solterra|Trailseeker|Tiguan|Atlas|Taos|ID\.4|Escape|Edge|Explorer|Expedition|Bronco|Mach-E|Corsair|Nautilus|Aviator|Navigator|Equinox|Blazer|Traverse|Tahoe|Suburban|Trax|Trailblazer|Terrain|Acadia|Yukon|Envision|Encore|Enclave|XT[456]|Lyriq|Optiq|Vistiq|Escalade|Wrangler|Cherokee|Compass|Wagoneer|Durango|Hornet|Pacifica|Macan|Cayenne|Range Rover|Defender|Discovery|Stelvio|Tonale|Grecale|Model [XY]|R1S|R2|Outlander|Eclipse Cross|Countryman)\b/i;
const isSuv = (o) => (o.body ? /suv|crossover|utility|wagon/i.test(o.body) : false) || SUV_MODELS.has(`${o.make}|${o.model}`.toLowerCase()) || SUV_NAME.test(`${o.model} ${o.title || ''}`);
const dealMiles = (o) => (o.mileageLimit ? Math.round(o.mileageLimit >= 16000 ? o.mileageLimit / ((o.term || 36) / 12) : o.mileageLimit) : 10000);
function dealFlags(o) {
  const t = `${o.title || ''} ${o.group || ''} ${o.disclaimer || ''}`;
  const f = [];
  if (/loyalty (?:offer|credit)|current or former \w+ owners|owners or lessees|lease loyalty|owner loyalty/i.test(t)) f.push('assumes loyalty');
  if (/conquest/i.test(t)) f.push('conquest');
  if (/military|first responder|college|graduate/i.test(t)) f.push('affinity only');
  if (azEligible(o) && planPct()) f.push(`${state.pricing.plan}-Plan may beat this`);
  return f;
}
function dealScenario(o, annualMiles) {
  const msrp = Number(o.msrp) || (o.netCapCost ? Number(o.netCapCost) + Number(o.downPayment || 0) : Number(o.monthly) * 95);
  const c = {
    id: `deal-${o.id}`, make: o.make, model: o.model, year: String(o.year || ''), trim: o.trim || '', msrp: String(Math.round(msrp)), sellingPrice: String(Math.round(msrp)),
    buy: { enabled: false }, lease: { enabled: true, monthly: String(o.monthly), termMonths: String(o.term || 36), dueAtSigning: o.dueAtSigning != null ? String(o.dueAtSigning) : '', annualMileage: String(dealMiles(o)), overMileageFee: String(o.overMileageFee || 0.25), dispositionFee: String(o.dispositionFee ?? 395), source: 'offer' },
  };
  const p = annualMiles ? { ...state, assumptions: { ...state.assumptions, annualMiles: String(annualMiles) } } : state;
  const r = analyze({ ...analysisInput([c], {}, p), candidates: [{ ...c }] });
  return r.scenarios.find((x) => x.kind === 'lease') || null;
}
async function findDeals() {
  const zip = state.assumptions.zip;
  const st = $('#dealsStatus');
  if (!zip) { st.textContent = 'Add a ZIP code on the Your car tab first.'; st.className = 'status err'; return; }
  st.className = 'status'; st.textContent = 'Pulling every factory lease deal near you…';
  $('#findDeals').disabled = true;
  try {
    const r = await api(`api/deals?zip=${encodeURIComponent(zip)}&radius=15&pages=10`);
    deals = { ...r, at: Date.now() };
    dealsShown = 20;
    st.textContent = r.errors?.length && !r.offers.length ? `Couldn’t load deals (${r.errors[0].message}).` : '';
    renderDeals(); refreshUsage();
  } catch (e) { st.textContent = e.message; st.className = 'status err'; }
  $('#findDeals').disabled = false;
}
function renderDeals() {
  const el = $('#dealList');
  if (!el) return;
  if (!deals) { el.innerHTML = ''; return; }
  const suvOnly = $('#dealsSuv').checked;
  const buyout = lastAnalysis?.scenarios?.find((s) => s.kind === 'buyout');
  const rows = deals.offers.filter((o) => o.make && o.model && (!suvOnly || isSuv(o)))
    .map((o) => ({ o, s: dealScenario(o) })).filter((x) => x.s)
    .sort((a, b) => a.s.monthly - b.s.monthly);
  if (!rows.length) { el.innerHTML = `<p class="hint">No ${suvOnly ? 'SUV ' : ''}lease deals found within 15 miles.</p>`; return; }
  const have = new Set(state.candidates.map((c) => `${c.make}|${c.model}`.toLowerCase()));
  el.innerHTML = `<p class="hint">${rows.length} deals from ${new Set(rows.map((x) => x.o.make)).size} makes, lowest monthly first, counted the same way as everything else (${esc(unitLabel())})${buyout ? `. Buying out your ${esc(curLabel())}: ${money(buyout.monthly)}/mo` : ''}.</p>
    <ol class="deal-list">${rows.slice(0, dealsShown).map(({ o, s }, i) => {
      const d = buyout ? s.monthly - buyout.monthly : null;
      const flags = dealFlags(o);
      const added = have.has(`${o.make}|${o.model}`.toLowerCase());
      return `<li>${logoHTML(o.make, 'deal')}<div class="dl-name"><b>${esc([o.year, o.make, o.model].filter(Boolean).join(' '))}</b><small>${esc([o.trim, o.msrp ? `MSRP ${money(o.msrp)}` : ''].filter(Boolean).join(', '))}</small></div>
        <div class="dl-cost"><b>${money(s.monthly)}</b><small>a month</small></div>
        <div class="dl-terms"><span>${money(o.monthly)}/mo + ${money(o.dueAtSigning || 0)} due</span><span>${o.term || 36} months, ${(dealMiles(o) / 1000).toFixed(dealMiles(o) % 1000 ? 1 : 0)}k mi/yr</span>${d != null ? `<span class="${d > 0 ? 'neg' : 'pos'}">${d > 0 ? `${money(d)}/mo more` : `${money(-d)}/mo less`} than buying out</span>` : ''}${flags.map((f) => `<span class="tag">${esc(f)}</span>`).join('')}</div>
        <button type="button" class="btn small ${added ? 'ghost' : ''}" data-deal="${deals.offers.indexOf(o)}" ${added ? 'disabled' : ''}>${added ? 'In compare' : 'Add to compare'}</button></li>`;
    }).join('')}</ol>
    ${rows.length > dealsShown ? `<button type="button" class="btn small ghost" id="moreDeals">Show ${Math.min(20, rows.length - dealsShown)} more</button>` : ''}`;
  el.onclick = (e) => {
    if (e.target.closest('#moreDeals')) { dealsShown += 20; renderDeals(); return; }
    const b = e.target.closest('[data-deal]'); if (!b) return;
    const o = deals.offers[Number(b.dataset.deal)];
    state.candidates.push(blankCandidate({ year: String(o.year || ''), make: o.make, model: o.model, trim: o.trim || '', reason: `Factory lease: ${money(o.monthly)}/mo + ${money(o.dueAtSigning || 0)} due` }));
    priceCandidate(state.candidates.length - 1);
    b.disabled = true; b.textContent = 'Added';
  };
}

// ---------- Leasehackr pre-negotiated deals (data/pnd.json) ----------
let pnd = null, pndState = null, pndBasis = 'quoted';
async function loadPnd() {
  if (pnd) return pnd;
  try { pnd = await (await fetch('data/pnd.json')).json(); } catch { pnd = { deals: [] }; }
  return pnd;
}
function pndOffer(d) {
  return { id: `pnd-${d.id}`, make: d.make, model: d.model, year: d.year, trim: d.trim, msrp: d.msrp || Math.round(d.monthly * 95), monthly: d.monthly, term: d.term, dueAtSigning: d.due ?? d.monthly, mileageLimit: d.miles || 7500, overMileageFee: 0.2, dispositionFee: 395 };
}
function renderPnd() {
  const box = $('#pnd');
  if (!box) return;
  if (!pnd) { loadPnd().then(() => renderPnd()); return; }
  const states = ['FL', 'MI', 'CO'];
  pndState ||= states.includes(state.assumptions.state) ? state.assumptions.state : 'FL';
  $('#pndStates').innerHTML = states.map((st) => `<button type="button" data-st="${st}" aria-pressed="${st === pndState}">${{ FL: 'Florida', MI: 'Michigan', CO: 'Colorado' }[st]}</button>`).join('');
  const herMiles = Number(state.assumptions.annualMiles || 12000);
  $('#pndMiles').innerHTML = [['quoted', 'Deal’s miles'], ['hers', `Her ${(herMiles / 1000).toFixed(herMiles % 1000 ? 1 : 0)}k miles`]].map(([k, l]) => `<button type="button" data-basis="${k}" aria-pressed="${pndBasis === k}">${l}</button>`).join('');
  const suv = $('#pndSuv').checked, sold = $('#pndSold').checked;
  const buyout = lastAnalysis?.scenarios?.find((x) => x.kind === 'buyout');
  const have = new Set(state.candidates.map((c) => c.pnd).filter(Boolean));
  const rows = (pnd.deals || [])
    .filter((d) => d.monthly && d.term && (!suv || d.body === 'suv') && (sold || d.left !== 0) && d.eligible?.[pndState] !== false)
    .map((d) => {
      const quoted = dealScenario(pndOffer(d), d.miles || 7500), hers = dealScenario(pndOffer(d));
      return { d, quoted, hers, s: pndBasis === 'quoted' ? quoted : hers };
    }).filter((x) => x.s)
    // Sold-out deals sink to the bottom; the rest go cheapest first.
    .sort((a, b) => (a.d.left === 0) - (b.d.left === 0) || a.s.monthly - b.s.monthly);
  const unknown = rows.filter((x) => x.d.eligible?.[pndState] == null).length;
  const stName = { FL: 'Florida', MI: 'Michigan', CO: 'Colorado' }[pndState];
  const listed = pnd.lists?.[pndState];
  $('#pndIntro').textContent = `${listed ? `Leasehackr lists ${listed} deals for ${stName} residents` : `${stName}’s list hasn’t been saved yet, so these are deals that might qualify`} (checked ${pnd.checked || ''}). Showing ${rows.length}${suv ? ' SUVs' : ''}${sold ? '' : ' still available'}, costed like everything else (taxes, fees, money due up front spread over the lease) ${pndBasis === 'quoted' ? 'at each deal’s own mileage' : `at her ${herMiles.toLocaleString()} miles a year, with extra miles charged`}.${unknown ? ` ${unknown} don’t list their registration states; confirm with the broker.` : ''}`;
  $('#pndList').innerHTML = rows.length ? rows.map(({ d, s, quoted, hers }) => {
    const diff = buyout ? s.monthly - buyout.monthly : null;
    const tags = [
      d.eligible?.[pndState] == null ? 'Registration states not listed' : '',
      d.due == null ? 'Due up front not shown on the list' : '',
      d.body !== 'suv' ? { car: 'Car', truck: 'Pickup', van: 'Minivan' }[d.body] : '',
      d.program ? `${money(d.program[0])}/mo with ${d.program[1]}` : '',
      d.left === 0 ? 'Sold out' : d.left ? `${d.left} left` : '',
      d.expires ? `Ends ${new Date(`${d.expires}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : '',
      `${d.dealer} dealer`, d.note || '',
    ].filter(Boolean);
    const added = have.has(d.id);
    return `<li>${logoHTML(d.make, 'deal')}<div class="dl-name"><b>${esc(`${d.year} ${d.make} ${d.model}`)}</b><small>${esc([d.trim, d.msrp ? `MSRP ${money(d.msrp)}` : ''].filter(Boolean).join(', '))}</small></div>
      <div class="dl-cost"><b>${money(s.monthly)}</b><small>${pndBasis === 'quoted' ? `a month at ${((d.miles || 7500) / 1000).toFixed(1).replace('.0', '')}k mi` : `a month at ${(herMiles / 1000).toFixed(herMiles % 1000 ? 1 : 0)}k mi`}</small>${hers && quoted && Math.round(hers.monthly) !== Math.round(quoted.monthly) ? `<small>${money(pndBasis === 'quoted' ? hers.monthly : quoted.monthly)} ${pndBasis === 'quoted' ? `at her ${(herMiles / 1000).toFixed(herMiles % 1000 ? 1 : 0)}k` : 'as quoted'}</small>` : ''}</div>
      <div class="dl-terms"><span>${money(d.monthly)}/mo${d.plusTax ? ' + tax' : ''} + ${money(d.due)} due</span><span>${d.term} months, ${((d.miles || 7500) / 1000).toFixed(1).replace('.0', '')}k mi/yr</span>${diff != null ? `<span class="${diff > 0 ? 'neg' : 'pos'}">${diff > 0 ? `${money(diff)}/mo more` : `${money(-diff)}/mo less`} than buying out</span>` : ''}${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      <button type="button" class="btn small ${added ? 'ghost' : ''}" data-pnd="${esc(d.id)}" ${added || d.left === 0 ? 'disabled' : ''}>${added ? 'In compare' : d.left === 0 ? 'Sold out' : 'Add to compare'}</button></li>`;
  }).join('') : '<p class="hint">No deals here for that state yet.</p>';
  if (!box.dataset.wired) {
    box.dataset.wired = '1';
    box.addEventListener('click', (e) => {
      const st = e.target.closest('[data-st]');
      if (st) { pndState = st.dataset.st; renderPnd(); return; }
      const bs = e.target.closest('[data-basis]');
      if (bs) { pndBasis = bs.dataset.basis; renderPnd(); return; }
      const b = e.target.closest('[data-pnd]');
      if (!b) return;
      const d = pnd.deals.find((x) => x.id === b.dataset.pnd);
      const o = pndOffer(d);
      // The deal's own terms, not market estimates: this is the price Leasehackr's broker quotes.
      state.candidates.push(blankCandidate({
        year: String(d.year), make: d.make, model: d.model, trim: d.trim, msrp: String(o.msrp), sellingPrice: String(o.msrp), pnd: d.id, userPicked: true,
        reason: `Leasehackr deal: ${money(d.monthly)}/mo + ${money(d.due)} due, ${d.term} mo`,
        buy: { enabled: false, rebate: '', apr: '', termMonths: '60', downPayment: '', payCash: false, source: 'estimate' },
        lease: { enabled: true, monthly: String(d.monthly), termMonths: String(d.term), dueAtSigning: d.due != null ? String(d.due) : '', annualMileage: String(d.miles || 7500), overMileageFee: '0.20', dispositionFee: '395', residualPct: '', moneyFactor: '', source: 'offer', offerLabel: 'Leasehackr' },
      }));
      persist(); renderResults(); renderModels(); ensurePhotos();
      toast(`Added the ${d.make} ${d.model} deal`);
    });
    box.addEventListener('change', (e) => { if (e.target.matches('#pndSuv, #pndSold')) renderPnd(); });
  }
}

// What the dealer would quote, in words: "$423/mo, $4,919 due" or "$811/mo for 60 mo".
// ---------- By where it's registered ----------
// Re-runs the comparison as if the car were registered at each ZIP: that state's taxes and fees,
// and offers re-picked with that ZIP as home (residency-tied brands follow it).
const ZIP_STATE = [[[320, 349], 'FL'], [[480, 499], 'MI'], [[800, 816], 'CO']];
function stateOfZip(zip) {
  const r = (state.regionInfo || {})[zip];
  if (r?.st) return r.st;
  const n = Number(String(zip).slice(0, 3));
  return ZIP_STATE.find(([[lo, hi]]) => n >= lo && n <= hi)?.[1] || '';
}
let placeMemo = { key: '', rows: [] };
function placeRows() {
  const places = shopRegions().map((zip) => ({ zip, st: zip === state.assumptions.zip ? state.assumptions.state : stateOfZip(zip) })).filter((x) => x.st);
  const seen = new Set();
  const uniq = places.filter((x) => (seen.has(x.st) ? false : seen.add(x.st)));
  if (uniq.length < 2) return [];
  const key = JSON.stringify([uniq, state.assumptions, state.eligibility, state.current, state.pricing, state.candidates.map((c) => [c.id, c.sellingPrice, c.msrp, (c.offers || []).length, c.userPicked, c.selected, c.buy, c.lease?.enabled])]);
  if (placeMemo.key === key) return placeMemo.rows;
  const keep = state;
  const rows = [];
  try {
    for (const pl of uniq) {
      const home = pl.zip === keep.assumptions.zip;
      const p = JSON.parse(JSON.stringify(keep));
      if (!home) p.assumptions = { ...p.assumptions, zip: pl.zip, state: pl.st, salesTaxPct: '', leaseTaxPct: '', surtaxPct: '', surtaxCap: '', docFee: '', titleFees: '', tradeInTaxCredit: !NO_TRADE_TAX_CREDIT.has(pl.st) };
      state = p;
      if (!home) for (const c of p.candidates) if (c.offers?.length && c.sellingPrice) autoPick(c);
      const r = analyze(analysisInput(p.candidates, {}, p));
      const buyout = r.scenarios.find((x) => x.kind === 'buyout');
      const best = r.scenarios[0];
      rows.push({ ...pl, home, buyout, best, label: best ? optTitle(best) : '', tax: taxDefaults(pl.st, pl.zip) });
    }
  } finally { state = keep; }
  placeMemo = { key, rows };
  return rows;
}
const RESIDENCY = { FL: 'Florida expects new residents to register within 10 days', MI: 'Michigan expects new residents to register right away', CO: 'Colorado gives new residents 90 days' };
function byPlaceHTML(r) {
  const rows = placeRows();
  if (!rows.length) return '';
  const unit = costMode() === 'ownership' ? 'cost a month' : 'a month';
  const cell = (s) => (s ? `<b>${money(s.monthly)}</b>` : '—');
  return `<section class="panel places"><h2>By where it’s registered</h2>
    <p class="sub">Same cars, ${esc(unit)}, with each state’s taxes and fees and the offers a resident there would get. Ford, Lincoln, GM and Stellantis offers follow the registration address; most other brands follow the dealer.</p>
    <table class="place-t"><thead><tr><th scope="col">Registered in</th><th scope="col">Buy out the ${esc(state.current.model || 'car')}</th><th scope="col">Lowest option</th></tr></thead><tbody>
    ${rows.map((x) => `<tr${x.home ? ' class="home"' : ''}><th scope="row">${esc((state.regionInfo || {})[x.zip]?.city || x.zip)}, ${esc(x.st)}${x.home ? '<small>home</small>' : ''}<small>${x.tax.salesTaxPct}%${x.tax.surtaxCap ? ` + ${x.tax.surtaxPct}% on first $5k` : ''} tax</small></th>
      <td>${cell(x.buyout)}</td><td>${cell(x.best)}<small>${esc(x.label)}</small></td></tr>`).join('')}
    </tbody></table>
    <p class="fine">Registering a car in a state generally means living there or keeping the car there. ${rows.map((x) => RESIDENCY[x.st]).filter(Boolean).join('; ')}. Florida credits sales tax already paid to another state. Check with each state’s DMV before relying on a different registration.</p>
  </section>`;
}

// ---------- How costs are counted (Settings) ----------
const costMode = () => (state.assumptions.costMode === 'ownership' ? 'ownership' : 'payments');
const spreadOn = () => !(state.assumptions.spreadUpfront === false || state.assumptions.spreadUpfront === 'false');
const runningOn = () => state.assumptions.includeRunning === true || state.assumptions.includeRunning === 'true';
function unitLabel() {
  const extra = runningOn() ? ', with gas, insurance and upkeep' : '';
  return costMode() === 'ownership' ? `a month to own${extra}` : `a month in payments${extra}`;
}
function periodText(H) { return `${H} months`; }
function basisLine(H) {
  if (costMode() === 'ownership') {
    return `Cost of owning over ${periodText(H)}: payments, money down, interest, taxes and fees, minus what the car is worth at the end${runningOn() ? ', plus gas, insurance and upkeep' : ''}. Change this in Settings.`;
  }
  return `What you’d pay over ${periodText(H)}: monthly payments${spreadOn() ? ', plus money due up front spread across the months' : ''}, taxes and fees${runningOn() ? ', gas, insurance and upkeep' : ''}. Nothing is guessed about resale. Change this in Settings.`;
}
const article = (w) => (/^[aeiou]/i.test(String(w || '').trim()) ? 'an' : 'a');
function optTitle(s) {
  const name = s.vehicle || '';
  if (s.kind === 'buyout') return `Buy out your ${curLabel()}`;
  if (s.kind === 'lease') return `Lease ${article(name)} ${name}`;
  const used = s.condition && s.condition !== 'new' ? `${s.condition} ` : '';
  return `Buy ${article(used || name)} ${used}${name}`;
}
function openSettings() {
  const a = state.assumptions;
  const e = state.eligibility || {};
  $('#eligOwned').value = e.owned || '';
  $('#eligLease').checked = e.leaseCaptive !== false;
  $('#eligLeaseLabel').textContent = state.current.make ? `Leasing the ${curLabel()} through ${/ford|lincoln/i.test(state.current.make) ? 'Ford Credit' : `${state.current.make}’s own finance company`}` : 'Current car is leased through the brand’s finance company';
  for (const k of ['military', 'firstResponder', 'college', 'costco']) $(`#elig-${k}`).checked = !!e[k];
  for (const r of $$('input[name="costMode"]')) r.checked = r.value === costMode();
  $('#setPeriod').value = String(Math.min(7, Math.max(1, Math.round(Number(a.horizonYears) || 3))));
  $('#setSpread').checked = spreadOn();
  $('#setRunning').checked = runningOn();
  $('#setMiles').value = a.annualMiles || '';
  $('#setRate').value = a.discountRatePct ?? '';
  $('#setZip').value = a.zip || '';
  $('#setState').innerHTML = STATES.map((x) => `<option ${x === a.state ? 'selected' : ''}>${x}</option>`).join('');
  $('#setShopZips').value = a.shopZips || '';
  $('#setWhereNote').textContent = '';
  settingsHints();
  $('#settings').showModal();
}
function settingsHints() {
  const own = costMode() === 'ownership';
  $('#modeHint').textContent = own
    ? 'Everything it costs to have the car for the period, minus what it should be worth when the period ends. Uses projected resale values.'
    : 'Just what you’d pay over the period. No projected resale value, and a loan that runs longer than the period only counts the payments inside it.';
  $('#setRateRow').hidden = !own;
}
function onSettingsChange() {
  const a = state.assumptions;
  const before = JSON.stringify(state.eligibility || {});
  state.eligibility = { ...(state.eligibility || {}), owned: $('#eligOwned').value, leaseCaptive: $('#eligLease').checked, military: $('#elig-military').checked, firstResponder: $('#elig-firstResponder').checked, college: $('#elig-college').checked, costco: $('#elig-costco').checked, setAt: state.eligibility?.setAt || new Date().toISOString().slice(0, 10) };
  if (JSON.stringify(state.eligibility) !== before) for (const c of state.candidates) if (c.offers?.length) autoPick(c);
  a.costMode = $$('input[name="costMode"]').find((r) => r.checked)?.value || 'payments';
  a.horizonYears = $('#setPeriod').value;
  a.spreadUpfront = $('#setSpread').checked;
  a.includeRunning = $('#setRunning').checked;
  if ($('#setMiles').value) a.annualMiles = $('#setMiles').value.replace(/[^\d]/g, '');
  if ($('#setRate').value !== '') a.discountRatePct = $('#setRate').value;
  const zip = $('#setZip').value.trim(), shop = $('#setShopZips').value.trim(), st = $('#setState').value;
  let whereChanged = false;
  if (/^\d{5}$/.test(zip) && zip !== a.zip) { a.zip = zip; whereChanged = true; }
  if (shop !== (a.shopZips || '')) { a.shopZips = shop; whereChanged = true; }
  if (st && st !== a.state) {
    a.state = st; a.salesTaxPct = ''; a.leaseTaxPct = ''; a.tradeInTaxCredit = !NO_TRADE_TAX_CREDIT.has(st);
    for (const c of state.candidates) if (c.offers?.length) autoPick(c);
  }
  if (whereChanged) $('#setWhereNote').textContent = 'Offers change with these places. Tap Check offers to refresh them.';
  for (const k of ['zip', 'state', 'salesTaxPct', 'leaseTaxPct']) {
    const el = document.getElementById(`f-assumptions-${k}`);
    if (el && el.type !== 'checkbox') el.value = a[k];
  }
  for (const k of ['horizonYears', 'annualMiles', 'discountRatePct']) {
    const el = document.getElementById(`f-assumptions-${k}`);
    if (el) el.value = a[k];
  }
  settingsHints();
  renderResults(); renderModels(); persist();
}

// The incentives stacked into an option, as small chips: "$4,000 cash back", "$1,000 conquest · Household Cadillac".
function stackChips(s) {
  const c = state.candidates.find((x) => x.id === s.candidateId);
  if (!c || s.kind === 'buyout') return '';
  const sel = c.selected || {};
  const ids = s.kind === 'lease' ? sel.leaseCash || [] : sel.cash || [];
  const used = (c.offers || []).filter((o) => ids.includes(o.id));
  const fin = s.kind === 'buy' && (c.offers || []).find((o) => o.id === sel.finance);
  const chips = used.map((o) => `<span class="chip" title="${esc(sel.why?.[o.id] || '')}">${money(o.cashback)} ${esc(cashLabel(o))}</span>`);
  if (fin) chips.push(`<span class="chip">${fin.apr}% APR</span>`);
  if (s.kind === 'buy' && azEligible(c) && planPct()) chips.unshift(`<span class="chip">${c.azOff ? 'public price' : `${esc(state.pricing.plan)}-Plan`}</span>`);
  const total = used.reduce((t, o) => t + (o.cashback || 0), 0);
  return chips.length ? `<span class="o-s" aria-label="Incentives used">${chips.join('')}${used.length > 1 ? `<span class="chip sum">${money(total)} total</span>` : ''}</span>` : '';
}
function winnerMake(s) {
  if (!s) return '';
  if (s.kind === 'buyout') return state.current.make;
  return state.candidates.find((c) => c.id === s.candidateId)?.make || '';
}
function payText(s) {
  if (!s) return '';
  if (s.kind === 'lease') return `${money(s.monthlyPayment)}/mo + ${money(Math.max(0, s.upfront))} due`;
  if (s.monthlyPayment) return `${money(s.monthlyPayment)}/mo${s.loanTerm ? ` for ${s.loanTerm} mo` : ''}${s.upfront > 1 ? `, ${money(s.upfront)} down` : ''}`;
  return s.upfront > 1 ? `${money(s.upfront)} cash` : '';
}

// ---------- Pricing plans (Ford A/Z-Plan) ----------
const planPct = (p = state) => (p.pricing.plan === 'public' ? 0 : Number(p.pricing[p.pricing.plan]) || 0);
const azEligible = (c) => AZ_MAKES.has(String(c.make || '').toLowerCase());
function effectivePrice(c, p = state) {
  const pct = planPct(p);
  const msrp = Number(c.msrp) || 0;
  if (pct > 0 && azEligible(c) && msrp > 0 && !c.azOff) return Math.round(msrp * (1 - pct / 100));
  return Number(c.sellingPrice) || 0;
}
function analysisInput(candidates = state.candidates, extra = {}, p = state) {
  return {
    ...p,
    today: new Date().toISOString(),
    candidates: candidates.map((c) => ({ ...c, label: c.label || [c.year, c.make, c.model, c.trim].filter(Boolean).join(' ') || undefined, sellingPrice: effectivePrice(c, p) || c.sellingPrice })),
    ...extra,
  };
}

// ---------- Events ----------
let renderTimer;
function scheduleResults() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => { renderResults(); updateModelSummaries(); persist(); }, 120);
}

function onInput(e) {
  const el = e.target;
  const path = el.dataset.path;
  if (!path) return;
  const val = el.type === 'checkbox' ? el.checked : el.value;
  setPath(state, path, val);
  el.classList.remove('auto');
  if (path === 'assumptions.state') {
    state.assumptions.tradeInTaxCredit = !NO_TRADE_TAX_CREDIT.has(val);
    const box = document.getElementById('f-assumptions-tradeInTaxCredit');
    if (box) box.checked = state.assumptions.tradeInTaxCredit;
  }
  if (/candidates\.\d+\.(buy|lease)\.enabled/.test(path)) {
    renderResults(); renderModels(); persist(); return;
  } else if (/candidates\.\d+\.(lease|buy)\./.test(path)) {
    const [, i, kind] = path.split('.');
    state.candidates[i][kind].source = 'manual';
  }
  if (path === 'current.payCash') applyHides();
  refreshPlaceholders();
  scheduleResults();
}

function fillCurrent(values) {
  for (const [k, v] of Object.entries(values)) {
    if (v === null || v === undefined || v === '') continue;
    state.current[k] = String(v);
    const input = document.getElementById(`f-current-${k}`);
    if (input) { input.value = String(v); input.classList.add('auto'); }
  }
}

async function lookupVin() {
  const vin = ($('#vin').value || '').trim().toUpperCase();
  state.current.vin = vin;
  const status = $('#carStatus');
  if (vin.length !== 17) { status.textContent = 'A VIN is 17 characters. Check your registration or the driver-side windshield.'; status.className = 'status err'; return; }
  const btn = $('#lookupVin'); btn.disabled = true;
  const miles = state.current.currentMiles;
  const zip = state.assumptions.zip;
  status.className = 'status';
  status.textContent = miles && zip ? 'Looking up your car and its market value…' : 'Looking up your car… Add your odometer and ZIP to also get its market value.';
  try {
    const r = await api(`api/vehicle/${encodeURIComponent(vin)}?miles=${encodeURIComponent(miles || '')}&zip=${encodeURIComponent(zip || '')}`);
    state.lookup = r;
    const v = r.vehicle;
    fillCurrent({ year: v.year, make: v.make, model: v.model, trim: v.trim, mpg: v.mpg });
    if (r.valuation) fillCurrent({ marketValue: Math.round(r.valuation.marketValue), msrp: r.valuation.msrp && Math.round(r.valuation.msrp) });
    const errs = (r.errors || []).filter((x) => x.status !== 404);
    status.textContent = r.valuation
      ? `Found it. Market value ${money(r.valuation.marketValue)}.`
      : (miles && zip ? 'Found the car, but no market value came back. Enter one manually.' : 'Found the car. Add odometer miles and ZIP, then look up again for its market value.');
    if (errs.length) status.textContent += ` (${errs.map((x) => `${x.provider}: ${x.message}`).join('; ')})`;
    if (state.photo && !state.photo.exact && !state.photo.fixed) state.photo = null;
    renderCarId();
    refreshPlaceholders();
    scheduleResults();
    refreshUsage();
    ensurePhotos();
  } catch (e) {
    status.textContent = e.message; status.className = 'status err';
  } finally { btn.disabled = false; }
}

async function lookupPlate() {
  const st = $('#plateState').value; const plate = $('#plate').value.trim();
  const status = $('#carStatus');
  if (!plate) return;
  status.className = 'status'; status.textContent = 'Finding the VIN for that plate…';
  try {
    const r = await api(`api/plate?state=${encodeURIComponent(st)}&plate=${encodeURIComponent(plate)}`);
    if (!r.vin) throw new Error(r.errors?.[0]?.message ? `Plate lookup unavailable: ${r.errors[0].message}` : 'No VIN found for that plate.');
    $('#vin').value = r.vin; state.current.vin = r.vin;
    await lookupVin();
  } catch (e) { status.textContent = e.message; status.className = 'status err'; }
}

async function priceCandidate(i, { render = true } = {}) {
  const c = state.candidates[i];
  if (!c.make || !c.model) { c.status = 'Enter at least a make and model.'; c.statusErr = true; if (render) renderModels(); return; }
  c.status = 'Checking dealer prices and manufacturer offers…'; c.statusErr = false;
  if (render) renderModels();
  const used = c.condition && c.condition !== 'new';
  const q = new URLSearchParams({ year: c.year || '', make: c.make, model: c.model, trim: c.trim || '', zip: state.assumptions.zip || '', car_type: c.condition || 'new', max_miles: used ? String(Math.max(20000, (new Date().getFullYear() + 1 - Number(c.year || 0)) * 15000)) : '' });
  const fetchOffers = async () => {
    if (used) return { offers: [], errors: [] };
    const out = { offers: [], errors: [] };
    const res = await Promise.allSettled(shopRegions().map(async (zip) => {
      const r = await api(`api/incentives?${new URLSearchParams({ ...Object.fromEntries(q), zip })}`);
      for (const o of r.offers || []) {
        if (o.city) { state.regionInfo ||= {}; state.regionInfo[zip] ||= { city: o.city, st: o.state || '' }; }
        out.offers.push({ ...o, id: shopRegions().length > 1 ? `${zip}:${o.id}` : o.id, region: zip });
      }
      out.errors.push(...(r.errors || []));
    }));
    for (const x of res) if (x.status === 'rejected') out.errors.push({ provider: 'offers', message: x.reason.message });
    return out;
  };
  const [market, inc] = await Promise.allSettled([api(`api/new-market?${q}`), fetchOffers()]);
  const notes = [];
  if (market.status === 'fulfilled') {
    const m = market.value; c.market = m;
    if (m.medianPrice) c.sellingPrice = String(m.medianPrice);
    if (m.medianMsrp) c.msrp = String(m.medianMsrp); else if (!c.msrp && m.medianPrice) c.msrp = String(m.medianPrice);
    if (m.mpg && !c.mpg) c.mpg = String(m.mpg);
    if (used && m.medianMiles) c.miles = String(m.medianMiles);
    if (!m.medianPrice) notes.push(`No ${used ? c.condition : 'new'} ones for sale near you. Enter a price to include it.`);
    for (const e of m.errors || []) if (!m.source) notes.push(`${e.provider}: ${e.message}`);
  } else notes.push(market.reason.message);
  if (inc.status === 'fulfilled') {
    const model = c.model.toLowerCase();
    const fits = (inc.value.offers || []).filter((o) => !o.vehicles?.length || o.vehicles.some((v) => v.toLowerCase().includes(model)));
    c.offers = shopRegions().flatMap((z) => fits.filter((o) => o.region === z).slice(0, 12));
    for (const e of inc.value.errors || []) notes.push(`Offers unavailable (${e.provider}: ${e.message})`);
  } else notes.push(inc.reason.message);
  if (c.sellingPrice) autoPick(c);
  c.status = notes.join(' ');
  c.statusErr = !c.sellingPrice;
  if (render) { renderResults(); renderModels(); persist(); refreshUsage(); ensurePhotos(); }
}

// ---------- Offers: everything selected stacks ----------
const offerKind = (o) => (o.type === 'lease' ? 'lease' : o.type === 'finance' ? 'finance' : 'cash');
const offerText = (o) => `${o.title || ''} ${o.group || ''} ${o.disclaimer || ''}`;
const pgmsOf = (o) => [...new Set((offerText(o).match(/#\s?\d{4,6}/g) || []).map((x) => x.replace(/\D/g, '')))];
const isAffinity = (o) => /military|first responder|student|college|educator|nurse|affinity/i.test(offerText(o));
const isConquest = (o) => /conquest|competitive/i.test(offerText(o));
const isLoyalty = (o) => !isConquest(o) && /owner|lessee|loyal|renewal|\bRCL\b/i.test(`${o.title || ''} ${o.group || ''}`);
function cashLabel(o) {
  const t = `${o.title || ''} ${o.group || ''}`;
  if (/renewal|\bRCL\b/i.test(t)) return 'lease renewal';
  if (isAffinity(o)) return (o.group || 'affinity').toLowerCase().replace(/ personnel$/, '');
  if (/\+/.test(o.title || '')) return 'combined cash';
  if (isLoyalty(o)) return 'owner loyalty';
  if (isConquest(o)) return 'conquest';
  if (/bonus/i.test(t)) return 'bonus cash';
  return 'cash back';
}
function selection(c) {
  c.selected ||= { cash: [], finance: null, lease: null };
  c.selected.cash ||= [];
  return c.selected;
}
function stackedCash(c) {
  const ids = new Set(selection(c).cash);
  return (c.offers || []).filter((o) => offerKind(o) === 'cash' && ids.has(o.id)).reduce((t, o) => t + (o.cashback || 0), 0);
}
// Model year an offer is for (offers for different model years never stack).
const offerYear = (o) => Number(o.year) || Number(String(o.vehicles?.[0] || '').match(/^(20\d\d)\b/)?.[1]) || null;
const yearOk = (o, y) => !y || !offerYear(o) || offerYear(o) === y;
// Who's buying (Settings): drives loyalty, conquest, lease-renewal and affinity cash.
function eligibilityOf(p = state) {
  const e = p.eligibility || {};
  const owned = String(e.owned || '').split(/[,;/]+|\band\b/i).map((x) => x.trim()).filter(Boolean);
  const lease = p.current?.make ? { make: p.current.make, captive: e.leaseCaptive !== false } : null;
  return { owned, household: [...owned, ...(lease ? [lease.make] : [])], currentLease: lease, military: !!e.military, firstResponder: !!e.firstResponder, college: !!e.college, costco: !!e.costco };
}
const azActiveFor = (c) => azEligible(c) && planPct() > 0 && !c.azOff;
// The best legal cash stack for one way of paying.
function stackFor(c, { year = Number(c.year) || null, mode = 'finance', specialApr = false, azActive = azActiveFor(c), region = null } = {}) {
  return bestStack(c.offers || [], { elig: eligibilityOf(), make: c.make, mode, specialApr, azActive, year, region, home: homeOf() });
}
// ---------- Markets: home ZIP plus other ZIPs to check for offers ----------
const homeOf = (p = state) => ({ zip: p.assumptions.zip || '', st: p.assumptions.state || '' });
function shopRegions(p = state) {
  const extra = String(p.assumptions.shopZips || '').match(/\b\d{5}\b/g) || [];
  return [...new Set([p.assumptions.zip, ...extra].filter(Boolean))];
}
const multiRegion = () => shopRegions().length > 1;
function regionName(zip) {
  const r = (state.regionInfo || {})[zip];
  if (zip === state.assumptions.zip) return r?.city ? `Home, ${r.city}` : 'Home';
  return r?.city ? `${r.city}${r.st ? `, ${r.st}` : ''}` : zip;
}
const offerOk = (c, o) => regionOk(o, c.make, homeOf()).ok;
function applySelection(c) {
  const sel = selection(c);
  const total = stackedCash(c);
  const fin = (c.offers || []).find((o) => o.id === sel.finance);
  c.buy = { ...c.buy, rebate: total ? String(total) : '', apr: fin ? String(fin.apr) : '', termMonths: fin ? String(fin.term || 60) : '60', source: total || fin ? 'offer' : 'estimate' };
  const lease = (c.offers || []).find((o) => o.id === sel.lease);
  if (lease) applyLeaseOffer(c, lease);
  else if (c.lease.source === 'offer' && !c.pnd) c.lease = { ...c.lease, monthly: '', dueAtSigning: '', moneyFactor: '', residualPct: '', source: 'estimate' }; // a Leasehackr deal keeps its quoted terms
  const leaseCash = (c.offers || []).filter((o) => (sel.leaseCash || []).includes(o.id)).reduce((t, o) => t + (o.cashback || 0), 0);
  c.lease = { ...c.lease, addOnCash: leaseCash ? String(leaseCash) : '' };
  const named = (ids) => (c.offers || []).filter((o) => ids.includes(o.id)).map((o) => `${money(o.cashback)} ${cashLabel(o)}${sel.why?.[o.id] ? ` (${sel.why[o.id]})` : ''}`);
  const parts = named(sel.cash || []);
  const yr = sel.year ? `${sel.year} model: ` : '';
  const az = azEligible(c) && planPct() ? (c.azOff ? `public price (A/Z-Plan skipped: the stack beats it)` : `${state.pricing.plan}-Plan price`) : '';
  c.buyNote = parts.length || fin || az ? `${yr}buy at ${[az, parts.join(' + '), fin ? `${fin.apr}% for ${fin.term} months` : ''].filter(Boolean).join(', plus ')}.` : '';
  c.buyNote = c.buyNote && c.buyNote[0].toUpperCase() + c.buyNote.slice(1);
  const lp = named(sel.leaseCash || []);
  c.leaseNote = lp.length ? `Extra cash on the lease: ${lp.join(' + ')}.` : '';
}
// Defaults: for each model year with offers, stack its eligible cash, try each of its APRs
// (dropping cash that can't go with one), keep the cheapest; then the cheapest lease.
function autoPick(c) {
  if (c.userPicked) { applySelection(c); return; }
  const sel = selection(c);
  const cost = (variant, kind) => analyze(analysisInput([variant])).scenarios.find((x) => x.kind === kind)?.monthly ?? Infinity;
  const fixed = Number(c.year) || null;
  const years = fixed ? [fixed] : [...new Set((c.offers || []).map(offerYear).filter(Boolean))];
  if (!years.length) years.push(null);
  // With A/Z-Plan available, try the plan price (and only offers that combine with it) and the public price (every offer).
  const azChoices = azEligible(c) && planPct() > 0 ? [false, true] : [false];
  const regions = [...new Set((c.offers || []).map((o) => o.region).filter(Boolean))];
  if (!regions.length) regions.push(null);
  let best = { m: Infinity, cash: [], why: {}, finance: null, year: null, azOff: false, region: null };
  for (const azOff of azChoices) {
   for (const region of regions) {
    for (const y of years) {
      for (const f of [null, ...(c.offers || []).filter((o) => offerKind(o) === 'finance' && o.apr != null && yearOk(o, y) && (!region || o.region === region) && offerOk(c, o))]) {
        const st = stackFor({ ...c, azOff }, { year: y, mode: c.buy.payCash ? 'cash' : 'finance', specialApr: !!f, region });
        const tmp = { ...c, azOff, buy: { ...c.buy }, lease: { ...c.lease, enabled: false }, selected: { cash: st.ids, finance: f ? f.id : null, lease: null } };
        applySelection(tmp);
        const m = cost(tmp, 'buy');
        if (m < best.m - 0.5 || (m < best.m + 0.5 && region === homeOf().zip && best.region !== region)) best = { m, cash: st.ids, why: Object.fromEntries(st.reasons.map((r) => [r.id, r.why])), finance: f ? f.id : null, year: y, azOff, region: st.ids.length || f ? region : null };
      }
    }
   }
  }
  c.azOff = best.azOff;
  sel.cash = best.cash; sel.finance = best.finance; sel.year = best.year; sel.why = { ...best.why }; sel.buyRegion = best.region;
  let bestLease = { id: null, m: Infinity, cash: [] };
  for (const o of (c.offers || []).filter((x) => offerKind(x) === 'lease' && x.monthly && yearOk(x, fixed) && offerOk(c, x))) {
    const st = stackFor(c, { year: offerYear(o), mode: 'lease', specialApr: true, region: o.region || null });
    const tmp = { ...c, lease: { ...c.lease }, buy: { ...c.buy, enabled: false } };
    applyLeaseOffer(tmp, o);
    tmp.lease.addOnCash = String(st.total || '');
    const m = cost(tmp, 'lease');
    if (m < bestLease.m) bestLease = { id: o.id, m, cash: st.ids, why: Object.fromEntries(st.reasons.map((r) => [r.id, r.why])) };
  }
  sel.lease = bestLease.id; sel.leaseCash = bestLease.cash; Object.assign(sel.why, bestLease.why || {});
  applySelection(c);
}

async function priceAll(onlyMissing = false) {
  const todo = state.candidates.map((c, i) => ({ c, i })).filter(({ c }) => c.make && c.model && (!onlyMissing || !c.market));
  if (!todo.length) { $('#modelsStatus').textContent = state.candidates.length ? 'Everything is already priced.' : 'Add some models first.'; return; }
  if (!state.assumptions.zip) { $('#modelsStatus').textContent = 'Add a ZIP code on the Your car tab so prices and offers are local.'; $('#modelsStatus').className = 'status err'; return; }
  const btn = $('#priceAll'); btn.disabled = true;
  $('#modelsStatus').className = 'status';
  let done = 0;
  const status = () => { $('#modelsStatus').textContent = `Pricing ${Math.min(done + 1, todo.length)} of ${todo.length}…`; };
  status();
  const queue = [...todo];
  const worker = async () => {
    while (queue.length) {
      const { i } = queue.shift();
      await priceCandidate(i, { render: false });
      done += 1; status();
    }
  };
  await Promise.all([worker(), worker()]);
  btn.disabled = false;
  const failed = todo.filter(({ c }) => !c.sellingPrice).length;
  $('#modelsStatus').textContent = `Priced ${todo.length - failed} of ${todo.length} models${failed ? `. ${failed} had no local listings; open them to enter a price.` : '.'}`;
  renderResults(); renderModels(); persist(); refreshUsage(); ensurePhotos();
}

function addComparables() {
  const seg = $('#segment').value;
  state.segment = seg;
  const cur = { make: state.current.make, model: state.current.model, body: state.lookup?.vehicle?.body };
  if (!seg || seg === segmentFor(cur)) { const before = state.candidates.length; autoSuggest(6); if (state.candidates.length === before) $('#modelsStatus').textContent = 'All the top suggestions are already in your list.'; return; }
  const have = new Set(state.candidates.map((c) => `${c.make}|${c.model}`.toLowerCase()));
  const list = SEGMENTS[seg].models.filter(([mk, md]) => !have.has(`${mk}|${md}`.toLowerCase()) && !(mk === cur.make && md === cur.model)).slice(0, 6);
  for (const [make, model] of list) state.candidates.push(blankCandidate({ year: '', make, model, reason: SEGMENTS[seg].label }));
  renderModels(); persist();
  if (list.length) { $('#modelsStatus').textContent = `Added ${list.map((x) => x.join(' ')).join(', ')}. Getting prices…`; priceAll(true); }
  else $('#modelsStatus').textContent = 'Those models are already in your list.';
}

// ---------- Ask (Gemini) ----------
const askThread = [];
function askContext() {
  const r = lastAnalysis;
  const c = state.current;
  const round = (x) => (Number.isFinite(x) ? Math.round(x) : null);
  return {
    car: { name: profileName(state), year: c.year, make: c.make, model: c.model, trim: c.trim, miles: c.currentMiles, mpg: c.mpg, originalMsrp: c.msrp },
    lease: { buyoutPrice: c.buyoutPrice, leaseEndDate: c.leaseEndDate, daysToDecide: daysUntil(c.leaseEndDate), milesAllowed: c.allowedMiles, monthlyPayment: c.monthlyPayment, excessMileRate: c.excessMileRate, dispositionFee: c.dispositionFee },
    howTheyPay: { payCash: c.payCash, loanApr: c.apr || 7, loanMonths: c.termMonths },
    situation: { zip: state.assumptions.zip, state: state.assumptions.state, yearsToKeepNextCar: state.assumptions.horizonYears, milesPerYear: state.assumptions.annualMiles, fordPricing: state.pricing.plan === 'public' ? 'public' : `${state.pricing.plan}-Plan at ${state.pricing[state.pricing.plan]}% off MSRP` },
    recalls: (state.lookup?.recalls || []).map((x) => ({ title: x.title, status: x.status })).slice(0, 8),
    equity: r ? Object.fromEntries(Object.entries(r.equity).map(([k, v]) => [k, typeof v === 'number' ? round(v) : v])) : null,
    verdict: r?.verdict || null,
    howCounted: basisLine(r?.horizonMonths || 36), optionsLowestMonthlyFirst: (r?.scenarios || []).map((x) => ({ option: optTitle(x), monthlyAsCounted: round(x.monthly), paidOverPeriod: round(x.paidOverPeriod), ownershipCostPerMonth: round(x.carPerMonth), runningCostsPerMonth: round(x.runningPerMonth), allInPerMonth: round(x.perMonth), totalOverHorizon: round(x.pvCost), payment: round(x.monthlyPayment), upfront: round(x.upfront), worthAtEnd: round(x.valueAtEnd), estimatedPayment: !!x.estimated, notes: x.notes })),
    newCarsCompared: state.candidates.map((x) => ({ name: [x.year, x.make, x.model, x.trim].filter(Boolean).join(' '), whySuggested: x.reason || null, priceUsed: effectivePrice(x), streetPrice: Number(x.sellingPrice) || null, msrp: Number(x.msrp) || null, mpg: x.mpg || null, forSaleNearby: x.market?.count ?? null, offers: (x.offers || []).slice(0, 8).map((o) => ({ type: o.type, monthly: o.monthly, apr: o.apr, term: o.term, dueAtSigning: o.dueAtSigning, cashBack: o.cashback, forWho: o.group, ends: o.validThrough })) })),
    assumptionsNote: 'All-in monthly = payments, interest, taxes, fees, registration, insurance, fuel and maintenance, minus resale value at the end, spread over the horizon, discounted at 4%/yr.',
  };
}

function askSuggestions() {
  const m = state.current.model || 'car';
  const best = lastAnalysis?.scenarios?.[0];
  const qs = [
    `Should I buy out the ${m}? Explain the main reasons.`,
    'What should I check or negotiate before I sign anything?',
    `How reliable is a ${[state.current.year, state.current.make, m].filter(Boolean).join(' ')} as it ages?`,
  ];
  if (best && best.kind !== 'buyout') qs.splice(1, 0, `Why is ${best.vehicle} cheaper than keeping my ${m}?`);
  if (AZ_MAKES.has(String(state.current.make).toLowerCase())) qs.push('How does Ford A-Plan vs Z-Plan change this?');
  qs.push('Is now a good time to buy a car, or should I wait?');
  return qs.slice(0, 5);
}

function mdLite(t) {
  const lines = esc(t).split('\n');
  let html = '', inList = false;
  for (const raw of lines) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\s)\*(?!\s)(.+?)\*(?=\s|$)/g, '$1<i>$2</i>');
    const m = /^\s*(?:[-*•]|\d+\.)\s+(.*)$/.exec(line);
    if (m) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${m[1]}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    if (line.trim().replace(/^#+\s*/, '')) html += `<p>${line.replace(/^#+\s*/, '')}</p>`;
  }
  if (inList) html += '</ul>';
  return html;
}

function renderAsk() {
  $('#askCar').textContent = profileName(state);
  $('#askThread').innerHTML = askThread.filter((x) => x.profile === store.active).map((x) => `<div class="q">${esc(x.q)}</div>
    <div class="a ${x.error ? 'err' : ''}">${x.pending ? '<p class="thinking">Thinking…</p>' : x.error ? `<p>${esc(x.error)}</p>` : mdLite(x.a)}
    ${x.sources?.length ? `<p class="srcs">Sources: ${x.sources.map((s2) => `<a href="${esc(s2.url)}" target="_blank" rel="noopener noreferrer">${esc(s2.title)}</a>`).join(', ')}</p>` : ''}</div>`).join('');
  $('#askChips').innerHTML = askSuggestions().map((q) => `<button type="button" class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('');
  const t = $('#askThread'); t.scrollTop = t.scrollHeight;
}

function openAsk() { renderAsk(); $('#askSheet').showModal(); if (wide()) $('#askInput').focus(); }

async function sendAsk(q) {
  q = String(q || '').trim(); if (!q) return;
  $('#askInput').value = '';
  const item = { profile: store.active, q, pending: true };
  askThread.push(item); renderAsk();
  $('#askSend').disabled = true;
  try {
    const res = await fetch('api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q, context: askContext() }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    Object.assign(item, { pending: false, a: body.answer, sources: body.sources || [] });
  } catch (e) {
    Object.assign(item, { pending: false, error: e.message });
  } finally { $('#askSend').disabled = false; renderAsk(); }
}

// ---------- Tabs ----------
const wide = () => window.matchMedia('(min-width: 980px)').matches;
function setTab(t, { scroll = true } = {}) {
  if (wide() && t === 'verdict') t = 'car';
  const changed = document.body.dataset.tab !== t;
  document.body.dataset.tab = t;
  for (const b of $$('.tabs [role="tab"]')) b.setAttribute('aria-selected', String(b.dataset.tab === t));
  if (scroll && changed && !wide()) window.scrollTo({ top: 0 });
  if (t === 'models') renderModels();
  if (t === 'safety') renderSafetyTab();
}

// ---------- Safety tab ----------
function renderSafetyTab() {
  const el = $('#safety');
  if (!el) return;
  state.safetyPrefs ||= {};
  renderSafety(el, {
    current: state.current, candidates: state.candidates.filter((c) => c.make && c.model),
    prefs: state.safetyPrefs, save: () => persist(), rerender: () => { if (document.body.dataset.tab === 'safety') renderSafetyTab(); },
    api, esc, logoHTML, zip: state.assumptions.zip,
    photoHTML: (car, mine) => {
      const ph = mine ? (state.photo?.url ? state.photo : null) : (photoOf(car) ? { url: photoOf(car), custom: !!car.photo?.cutout } : null);
      return imgHTML(ph?.url, [car.year, car.make, car.model].filter(Boolean).join(' '), phCls(ph, 'contain'));
    },
    sub: (car, mine, rec) => {
      if (mine) return [`${car.year || ''} ${car.trim || ''}`.trim(), Number(car.buyoutPrice) ? `${money(Number(car.buyoutPrice))} buyout` : ''].filter(Boolean).join(' · ');
      const used = car.condition && car.condition !== 'new';
      const what = `${used ? 'Used' : 'New'}${car.year ? ` ${car.year}` : ''}${car.trim ? ` ${car.trim}` : ''}`;
      return rec?.researched && rec.trim && norm2(rec.trim) !== norm2(car.trim) ? `${what} · rated as ${rec.year} ${rec.trim}` : what;
    },
  });
}
// Compare tab: up to three cars side by side, with the app's own monthly cost for each.
function costFor(car, mine) {
  const r = lastAnalysis;
  if (!r) return null;
  const pick = mine ? r.scenarios.filter((s) => s.kind === 'buyout') : r.scenarios.filter((s) => s.candidateId === car.id);
  const s = pick.sort((a, b) => a.monthly - b.monthly)[0];
  if (!s) return null;
  const pay = payText(s);
  return { monthly: s.monthly, how: `${s.kind === 'lease' ? 'Lease' : s.kind === 'buyout' ? 'Buy out' : 'Buy'}${pay ? `, ${pay}` : ''}` };
}
function renderCompare3Tab() {
  state.safetyPrefs ||= {};
  renderCompare3($('#compare3'), {
    current: state.current, candidates: state.candidates.filter((c) => c.make && c.model),
    prefs: state.safetyPrefs, save: () => persist(), rerender: () => renderCompare3Tab(),
    api, esc, logoHTML, zip: state.assumptions.zip, costFor,
    openSafety: () => { setTab('safety'); },
    photoHTML: (car, mine) => {
      const ph = mine ? (state.photo?.url ? state.photo : null) : (photoOf(car) ? { url: photoOf(car), custom: !!car.photo?.cutout } : null);
      return imgHTML(ph?.url, [car.year, car.make, car.model].filter(Boolean).join(' '), phCls(ph, 'contain'));
    },
    sub: () => '',
  });
}
const norm2 = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function applyLeaseOffer(c, o) {
  const t = leaseTermsFromOffer(o);
  Object.assign(c.lease, {
    moneyFactor: t ? String(t.moneyFactor) : '', residualPct: t?.residualPct ? String(t.residualPct) : '',
    offerLabel: [o.year, o.trim].filter(Boolean).join(' '),
    monthly: String(o.monthly), termMonths: String(o.term || 36),
    dueAtSigning: o.dueAtSigning != null ? String(o.dueAtSigning) : '',
    annualMileage: o.mileageLimit ? String(Math.round(o.mileageLimit >= 16000 ? o.mileageLimit / ((o.term || 36) / 12) : o.mileageLimit)) : c.lease.annualMileage,
    overMileageFee: o.overMileageFee ? String(o.overMileageFee) : c.lease.overMileageFee,
    dispositionFee: o.dispositionFee != null ? String(o.dispositionFee) : c.lease.dispositionFee,
    source: 'offer',
  });
}

async function refreshUsage() {
  try {
    const s = await api('api/status');
    // A phone can hold on to an old copy of the app: if the server is newer, reload once.
    const mine = document.querySelector('meta[name="app-build"]')?.content;
    if (s.version && mine && !mine.includes('{{') && s.version !== mine) {
      let tried = null; try { tried = sessionStorage.getItem('reloadedFor'); } catch {}
      if (tried !== s.version) { try { sessionStorage.setItem('reloadedFor', s.version); } catch {} location.reload(); return; }
    }
    if (s.providers?.cutouts && !cutoutsOn) { cutoutsOn = true; ensurePhotos(); }
    const mc = s.usage?.marketcheck || 0; const ad = s.usage?.autodev || 0;
    const left = s.limits.marketcheck - mc;
    const parts = [];
    if (s.providers.mock) parts.push('<b>Demo data</b>');
    parts.push(`MarketCheck <b class="${left < 60 ? 'low' : ''}">${mc}/${s.limits.marketcheck}</b>`);
    parts.push(`auto.dev <b>${ad}/${s.limits.autodev}</b>`);
    $('#usage').innerHTML = `<span>${parts.join('</span> <span>')}</span> <span class="cap">calls this month</span>${s.version ? ` <span class="cap">· version ${esc(s.version)}</span>` : ''}`;
  } catch { $('#usage').textContent = ''; }
}

function wire() {
  const form = $('#form');
  form.addEventListener('input', onInput);
  form.addEventListener('change', onInput);
  form.addEventListener('submit', (e) => e.preventDefault());
  $('#lookupVin').addEventListener('click', lookupVin);
  $('#vin').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); lookupVin(); } });
  $('#lookupPlate').addEventListener('click', lookupPlate);
  document.addEventListener('change', (e) => { const f = e.target.closest?.('[data-photo-upload]'); if (f && f.files?.[0]) uploadPhoto(f.files[0]); });
  $('#vinPhoto').addEventListener('change', (e) => { if (e.target.files?.[0]) scanVin(e.target.files[0]); e.target.value = ''; });
  $('#payoffPhoto').addEventListener('change', (e) => { if (e.target.files?.[0]) readPayoff(e.target.files[0], 'draft'); e.target.value = ''; });
  $('#payoffPhotoCar').addEventListener('change', (e) => { if (e.target.files?.[0]) readPayoff(e.target.files[0], 'car'); e.target.value = ''; });
  $('#results').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'ics') downloadReminders();
    else if (act === 'share') shareDecision();
    else if (act === 'settings') openSettings();
    else if (act === 'reprice') repriceNow();
    else if (act === 'dismiss') { state.repriceNotice = { ...state.repriceNotice, before: state.repriceNotice?.after }; persist(); renderResults(); }
  });
  $('#garageBtn').addEventListener('click', openGarage);
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#settings').addEventListener('change', onSettingsChange);
  $('#setReprice').addEventListener('click', async () => {
    onSettingsChange();
    const n = shopRegions().length;
    $('#setWhereNote').textContent = `Checking offers in ${n} place${n === 1 ? '' : 's'}…`;
    await priceAll(false);
    $('#setWhereNote').textContent = $('#modelsStatus').textContent;
  });
  $('#garageList').addEventListener('click', onGarageClick);
  $('#startAdd').addEventListener('click', startAdd);
  $('#step1Go').addEventListener('click', step1);
  $('#newVin').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); step1(); } });
  $('#step2Go').addEventListener('click', step2);
  $('#notMine').addEventListener('click', () => showStep(1));
  $('#step3Go').addEventListener('click', step3);
  $('#addBack').addEventListener('click', () => showStep(Math.max(1, draft.step - 1)));
  $('#newPlateGo').addEventListener('click', async () => {
    const plate = $('#newPlate').value.trim(); if (!plate) return;
    stepStatus(1, 'Finding the VIN for that plate…');
    try {
      const r = await api(`api/plate?state=${encodeURIComponent($('#newPlateState').value)}&plate=${encodeURIComponent(plate)}`);
      if (!r.vin) throw new Error(r.errors?.[0]?.message ? `Plate lookup unavailable: ${r.errors[0].message}` : 'No VIN found for that plate.');
      $('#newVin').value = r.vin; step1();
    } catch (e) { stepStatus(1, e.message, true); }
  });
  for (const d of $$('dialog.sheet')) {
    d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
  }
  $('#askBtn').addEventListener('click', openAsk);
  $('#askForm').addEventListener('submit', (e) => { e.preventDefault(); sendAsk($('#askInput').value); });
  $('#askInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAsk($('#askInput').value); } });
  $('#askChips').addEventListener('click', (e) => { const b = e.target.closest('[data-q]'); if (b) sendAsk(b.dataset.q); });
  for (const b of $$('.tabs [role="tab"]')) b.addEventListener('click', () => setTab(b.dataset.tab));
  document.addEventListener('click', (e) => { const g = e.target.closest('[data-goto]'); if (g) { e.preventDefault(); setTab(g.dataset.goto); } });
  $('#suggest').addEventListener('click', addComparables);
  $('#priceAll').addEventListener('click', () => priceAll(false));
  $('#findDeals').addEventListener('click', findDeals);
  $('#dealsSuv').addEventListener('change', renderDeals);
  $('#segment').addEventListener('change', (e) => { state.segment = e.target.value; persist(); });
  for (const r of $$('input[name="plan"]')) r.addEventListener('change', () => { state.pricing.plan = r.value; renderResults(); renderModels(); persist(); });
  $('#planPct').addEventListener('input', (e) => { if (state.pricing.plan !== 'public') { state.pricing[state.pricing.plan] = e.target.value; scheduleResults(); } });
  $('#addCandidate').addEventListener('click', () => {
    const c = blankCandidate(); state.candidates.push(c); openEditors.add(c.id); renderModels(); persist();
  });
  $('#addSame').addEventListener('click', () => {
    const cur = state.current;
    const c = blankCandidate({ year: '', make: cur.make, model: cur.model, trim: cur.trim });
    state.candidates.push(c); renderModels(); persist();
    priceCandidate(state.candidates.length - 1);
  });
  const mc = $('#modelCompare');
  mc.addEventListener('toggle', (e) => {
    const d = e.target.closest('details[data-cid]'); if (!d) return;
    if (d.open) openEditors.add(d.dataset.cid); else openEditors.delete(d.dataset.cid);
  }, true);
  mc.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove]');
    if (rm) { state.candidates.splice(Number(rm.dataset.remove), 1); renderResults(); renderModels(); persist(); return; }
    const pr = e.target.closest('[data-price]');
    if (pr) { priceCandidate(Number(pr.dataset.price)); return; }
    const of = e.target.closest('[data-offer]');
    if (of) {
      const [i, id] = of.dataset.offer.split(':');
      const c = state.candidates[Number(i)];
      const o = c.offers.find((x) => String(x.id) === id);
      if (o) {
        const sel = selection(c);
        const k = offerKind(o);
        if (k === 'cash') sel.cash = sel.cash.includes(o.id) ? sel.cash.filter((x) => x !== o.id) : [...sel.cash, o.id];
        else sel[k] = sel[k] === o.id ? null : o.id;
        if (k === 'lease' && !sel.lease) c.lease = { ...c.lease, monthly: '', dueAtSigning: '', source: 'estimate' };
        c.userPicked = true;
        applySelection(c);
        renderResults(); renderModels(); persist();
      }
    }
  });
}

function renderAll() {
  setTimeout(ensurePhotos, 0);
  renderProfiles();
  renderFields();
  renderCarId();
  $('#carStatus').textContent = '';
  renderResults();
  renderModels();
  if (document.body.dataset.tab === 'safety') renderSafetyTab();
}

let resizeTimer;
// iOS Safari fires resize when its toolbar shows/hides during scroll: only react to real width changes,
// and never scroll the page from here.
let lastWidth = window.innerWidth;
window.addEventListener('resize', () => {
  if (Math.abs(window.innerWidth - lastWidth) < 2) return;
  const wasWide = lastWidth >= 980;
  lastWidth = window.innerWidth;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    renderResults(); updateModelSummaries();
    if (wasWide !== wide()) setTab(document.body.dataset.tab, { scroll: false });
  }, 200);
});

// ---------- Boot ----------
(async function boot() {
  await restore();
  renderAll();
  wire();
  setTab(wide() ? 'car' : 'verdict');
  refreshUsage();
  if (!state.suggested && state.current.make && state.current.model && !state.candidates.length) autoSuggest();
})();
