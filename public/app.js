import { analyze, STATE_TAX, NO_TRADE_TAX_CREDIT, defaultInsurance, maintenanceAnnual, modelAge, fmtYears } from './engine.js';

// ---------- State ----------
const STORAGE_KEY = 'lba:v1';
const today = new Date();
const blankCandidate = (o = {}) => ({
  id: Math.random().toString(36).slice(2, 8),
  year: String(today.getFullYear() + (today.getMonth() >= 8 ? 1 : 0)), make: '', model: '', trim: '',
  sellingPrice: '', msrp: '', mpg: '', insuranceAnnual: '',
  buy: { enabled: true, rebate: '', apr: '', termMonths: '60', downPayment: '', payCash: false, source: 'estimate' },
  lease: { enabled: true, monthly: '', termMonths: '36', dueAtSigning: '', annualMileage: '', overMileageFee: '', dispositionFee: '', residualPct: '', moneyFactor: '', source: 'estimate' },
  market: null, offers: [], applied: {},
  ...o,
});

let state = {
  assumptions: { zip: '', state: 'CO', horizonYears: '3', annualMiles: '12000', salesTaxPct: '', leaseTaxPct: '', gasPrice: '3.40', tradeInPct: '90', tradeInTaxCredit: '', discountRatePct: '4', docFee: '', titleFees: '' },
  current: {
    vin: '', year: '', make: '', model: '', trim: '', mpg: '', marketValue: '', msrp: '',
    buyoutPrice: '', purchaseOptionFee: '', leaseEndDate: '', currentMiles: '', allowedMiles: '', excessMileRate: '', dispositionFee: '', wearCharges: '', monthlyPayment: '',
    payCash: false, downPayment: '', apr: '', termMonths: '48', insuranceAnnual: '', maintenanceAnnual: '', upcomingRepairs: '', buyoutIsTaxed: true,
  },
  candidates: [],
  lookup: null, // last VIN lookup result
};

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
    F('assumptions.salesTaxPct', 'Sales tax', { suf: '%', est: () => STATE_TAX[state.assumptions.state] ?? 7, hint: 'Your combined state + local rate' }),
    F('assumptions.leaseTaxPct', 'Tax on lease payments', { suf: '%', est: () => state.assumptions.salesTaxPct || (STATE_TAX[state.assumptions.state] ?? 7) }),
    F('assumptions.docFee', 'Dealer doc fee', { pre: '$', placeholder: '499' }),
    F('assumptions.titleFees', 'Title & plate fees', { pre: '$', placeholder: '150' }),
    F('assumptions.discountRatePct', 'What your cash earns', { suf: '%', hint: 'Used to weigh money now vs later. 0 to ignore.' }),
    F('assumptions.tradeInTaxCredit', 'Trade-in lowers sales tax in my state', { check: true, full: true }),
  ],
};
const STATES = Object.keys(STATE_TAX).sort();

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
    ${f.hint ? `<small>${esc(f.hint)}</small>` : ''}
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
  const offerChips = (c.offers || []).map((o) => {
    const kind = o.type === 'lease' ? 'lease' : o.type === 'finance' ? 'finance' : 'cash';
    const main = kind === 'lease' ? `$${o.monthly}/mo · ${o.term || '?'} mo${o.dueAtSigning != null ? ` · $${o.dueAtSigning.toLocaleString()} down` : ''}`
      : kind === 'finance' ? `${o.apr}% APR · ${o.term || '?'} mo` : `$${(o.cashback || 0).toLocaleString()} cash back`;
    const pressed = c.applied?.[kind] === o.id;
    return `<button type="button" class="offer" data-offer="${i}:${esc(o.id)}" aria-pressed="${pressed}">${esc(main)}<small>${esc((o.vehicles?.[0] || o.title || '').slice(0, 60))}${o.validThrough ? ` · ends ${esc(o.validThrough)}` : ''}</small></button>`;
  }).join('');
  return `<article class="cand" data-cand="${i}">
    <header><strong>${esc([c.year, c.make, c.model, c.trim].filter(Boolean).join(' ') || 'New car')}</strong>
      <button type="button" class="btn ghost small" data-remove="${i}">Remove</button></header>
    <div class="ymmt">
      ${inp('year', 'Year', { inputmode: 'numeric' })}${inp('make', 'Make', { text: true })}${inp('model', 'Model', { text: true })}${inp('trim', 'Trim', { text: true, placeholder: 'Any' })}
    </div>
    <div class="add-row"><button type="button" class="btn primary small" data-price="${i}">Get local prices &amp; offers</button></div>
    ${m ? `<p class="market">${m.count ? `${m.count.toLocaleString()} new for sale near you` : 'No local listings found'}${m.medianPrice ? `, typical price ${money(m.medianPrice)}` : ''}${m.lowPrice ? `, lowest ${money(m.lowPrice)}` : ''}${m.source ? ` (${esc(m.source)})` : ''}.</p>` : ''}
    ${c.status ? `<p class="status ${c.statusErr ? 'err' : ''}">${esc(c.status)}</p>` : ''}
    <div class="grid" style="margin-top:12px">
      ${inp('sellingPrice', 'Price you’d pay', { pre: '$' })}${inp('msrp', 'MSRP', { pre: '$' })}
      ${inp('mpg', 'Combined MPG', { placeholder: '30' })}${inp('insuranceAnnual', 'Insurance per year', { pre: '$', placeholder: c.sellingPrice ? `≈ ${defaultInsurance(Number(c.sellingPrice))}` : '' })}
    </div>
    ${offerChips ? `<h4>Manufacturer offers near you</h4><p class="hint">Tap one to use it. Offers are often for a specific trim; check the fine print.</p><div class="offers">${offerChips}</div>` : ''}
    <h4><label><input type="checkbox" data-path="${p('buy.enabled')}" ${c.buy.enabled ? 'checked' : ''}> Buy it</label>${c.buy.source !== 'estimate' ? '<span class="tag offer-tag">offer applied</span>' : ''}</h4>
    <div class="grid" ${c.buy.enabled ? '' : 'hidden'}>
      ${inp('buy.rebate', 'Rebate / cash back', { pre: '$', placeholder: '0' })}${inp('buy.apr', 'Loan APR', { suf: '%', placeholder: '6.5' })}
      ${inp('buy.termMonths', 'Loan term', { suf: 'mo' })}${inp('buy.downPayment', 'Down payment', { pre: '$', placeholder: '0' })}
      ${fieldHTML(F(p('buy.payCash'), 'Pay cash', { check: true }))}
    </div>
    <h4><label><input type="checkbox" data-path="${p('lease.enabled')}" ${c.lease.enabled ? 'checked' : ''}> Lease it</label>${c.lease.source !== 'estimate' ? '<span class="tag offer-tag">offer applied</span>' : ''}</h4>
    <div class="grid" ${c.lease.enabled ? '' : 'hidden'}>
      ${inp('lease.monthly', 'Monthly payment (before tax)', { pre: '$', placeholder: 'estimate', hint: 'Blank = estimated from price' })}${inp('lease.termMonths', 'Lease term', { suf: 'mo' })}
      ${inp('lease.dueAtSigning', 'Due at signing', { pre: '$', placeholder: 'first month + fees' })}${inp('lease.annualMileage', 'Miles allowed per year', { suf: 'mi', placeholder: '12000' })}
      ${inp('lease.overMileageFee', 'Over-mileage charge', { pre: '$', suf: '/mi', placeholder: '0.25' })}${inp('lease.dispositionFee', 'Turn-in fee', { pre: '$', placeholder: '395' })}
      ${inp('lease.residualPct', 'Residual (for estimate)', { suf: '%', placeholder: '58' })}${inp('lease.moneyFactor', 'Money factor (for estimate)', { placeholder: '0.0025' })}
    </div>
  </article>`;
}

function renderCandidates() {
  $('#candidates').innerHTML = state.candidates.length
    ? state.candidates.map(candidateHTML).join('')
    : '<p class="hint">No cars added yet.</p>';
}

function renderCarId() {
  const L = state.lookup;
  const el = $('#carId');
  if (!L?.vehicle?.make) { el.hidden = true; return; }
  const v = L.vehicle;
  const open = (L.recalls || []).filter((r) => !/closed|complete|remedied/i.test(r.status || ''));
  el.hidden = false;
  el.innerHTML = `<div class="name">${esc([v.year, v.make, v.model, v.trim].filter(Boolean).join(' '))}</div>
    <div class="spec">${esc([v.style || v.body, v.engine, v.drivetrain, v.mpg ? `${v.mpg} mpg combined` : ''].filter(Boolean).join(', '))}</div>
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

function renderResults() {
  const r = analyze({ ...state, today: new Date().toISOString() });
  const el = $('#results');
  const H = r.horizonMonths;

  if (!r.scenarios.length) {
    el.innerHTML = `<div class="empty"><h2>Is your buyout a good deal?</h2>
      <p>Three steps to an answer:</p>
      <ol><li>Look up your car by VIN so the app knows what it’s worth today.</li>
      <li>Enter the buyout price from your payoff quote and your lease mileage.</li>
      <li>Add one or more new cars to compare against.</li></ol>
      ${r.warnings.length ? `<div class="warns" style="margin-top:14px">${r.warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join('')}</div>` : ''}</div>`;
    return;
  }

  const best = r.scenarios[0];
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
    return `<li class="${i === 0 ? 'best' : ''}">
      <span class="t">${esc(s.title)}${s.estimated ? ' <span class="tag">estimated payment</span>' : ''}</span>
      <span class="m"><b>${money(s.perMonth)}</b><small>per month, all in</small></span>
      <span class="d"><span>${money(s.pvCost)} over ${fmtYears(H)}</span><span>${money(s.perMile, 2)}/mile</span>${s.monthlyPayment ? `<span>payment ${money(s.monthlyPayment)}/mo</span>` : ''}<span>${s.upfront >= 0 ? `${money(s.upfront)} upfront` : `${money(-s.upfront)} back at start`}</span></span>
      <details><summary>Where the money goes</summary>
        <table>${cats}${tv}<tr><td><b>Total</b></td><td><b>${money(s.pvCost)}</b></td></tr></table>
        <ul class="notes">${s.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
      </details>
    </li>`;
  }).join('');

  const recalls = state.lookup?.recalls || [];
  el.innerHTML = `
    <article class="sticker ${stickerFresh ? 'fresh' : ''}">
      <div class="band"><span>Recommendation</span><span>${fmtYears(H)}, ${Number(r.assumptions.annualMiles).toLocaleString()} mi/yr</span></div>
      <div class="verdict"><h1>${esc(v.headline)}</h1></div>
      <div class="figures">
        <div><b>${money(best.perMonth)}</b><span>per month, all in</span></div>
        <div><b>${money(best.pvCost)}</b><span>total over ${fmtYears(H)}</span></div>
        <div><b>${r.scenarios[1] ? money(r.scenarios[1].pvCost - best.pvCost) : '—'}</b><span>saved vs. next best</span></div>
      </div>
      ${v.lines.length ? `<ul>${v.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
      <p class="fine">“All in” is the true cost of driving: payments, interest, taxes, insurance, fuel, maintenance and lost value, minus what the car is worth when you’re done.</p>
    </article>

    ${r.warnings.length ? `<div class="warns">${r.warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join('')}</div>` : ''}

    <section class="panel"><h2>Your lease equity</h2>
      <p class="sub">${eq.monthsToEnd >= 1 ? `Projected to lease end in ${Math.round(eq.monthsToEnd)} months at ${Math.round(eq.milesAtEnd).toLocaleString()} miles. ` : ''}Positive equity is money you keep by buying out or trading in instead of returning the car.</p>
      <div class="equity">${equityCells.join('')}</div>
    </section>

    <section class="panel"><h2>Every option, cheapest first</h2><ol class="rank">${scenarioRows}</ol></section>

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
function persist() {
  const snapshot = JSON.stringify({ assumptions: state.assumptions, current: state.current, candidates: state.candidates, lookup: state.lookup });
  try { localStorage.setItem(STORAGE_KEY, snapshot); } catch {}
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fetch('api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: snapshot }).catch(() => {});
  }, 1200);
}

async function restore() {
  let saved = null;
  try {
    const remote = await api('api/profile');
    if (remote && remote.current) saved = remote;
  } catch {}
  if (!saved) { try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch {} }
  if (saved) {
    state.assumptions = { ...state.assumptions, ...saved.assumptions };
    state.current = { ...state.current, ...saved.current };
    state.candidates = (saved.candidates || []).map((c) => blankCandidate({ ...c, buy: { ...blankCandidate().buy, ...c.buy }, lease: { ...blankCandidate().lease, ...c.lease } }));
    state.lookup = saved.lookup || null;
  }
}

// ---------- Events ----------
let renderTimer;
function scheduleResults() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => { renderResults(); persist(); }, 120);
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
    renderCandidates();
  } else if (/candidates\.\d+\.(year|make|model|trim)$/.test(path)) {
    const i = Number(path.split('.')[1]);
    const head = $(`[data-cand="${i}"] header strong`);
    const c = state.candidates[i];
    if (head) head.textContent = [c.year, c.make, c.model, c.trim].filter(Boolean).join(' ') || 'New car';
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
    renderCarId();
    refreshPlaceholders();
    scheduleResults();
    refreshUsage();
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

async function priceCandidate(i) {
  const c = state.candidates[i];
  if (!c.make || !c.model) { c.status = 'Enter at least a make and model.'; c.statusErr = true; renderCandidates(); return; }
  c.status = 'Checking dealer prices and manufacturer offers…'; c.statusErr = false; renderCandidates();
  const q = new URLSearchParams({ year: c.year || '', make: c.make, model: c.model, trim: c.trim || '', zip: state.assumptions.zip || '' });
  const [market, inc] = await Promise.allSettled([api(`api/new-market?${q}`), api(`api/incentives?${q}`)]);
  const notes = [];
  if (market.status === 'fulfilled') {
    const m = market.value; c.market = m;
    if (m.medianPrice) { c.sellingPrice = String(m.medianPrice); }
    if (m.medianMsrp) { c.msrp = String(m.medianMsrp); } else if (!c.msrp && m.medianPrice) c.msrp = String(m.medianPrice);
    if (m.mpg && !c.mpg) c.mpg = String(m.mpg);
    if (!m.medianPrice) notes.push('No local prices found; enter one.');
    for (const e of m.errors || []) if (!m.source) notes.push(`${e.provider}: ${e.message}`);
  } else notes.push(market.reason.message);
  if (inc.status === 'fulfilled') {
    const offers = (inc.value.offers || []).filter((o) => !c.model || !o.vehicles?.length || o.vehicles.some((v) => v.toLowerCase().includes(c.model.toLowerCase())));
    c.offers = offers.slice(0, 8);
    const lease = offers.filter((o) => o.type === 'lease' && o.monthly).sort((a, b) => a.monthly - b.monthly)[0];
    const fin = offers.filter((o) => o.type === 'finance' && o.apr != null).sort((a, b) => a.apr - b.apr)[0];
    if (lease) applyOffer(c, lease);
    if (fin) applyOffer(c, fin);
    if (!offers.length) notes.push('No manufacturer offers found for this model near you.');
    for (const e of inc.value.errors || []) notes.push(`Offers unavailable (${e.provider}: ${e.message})`);
  } else notes.push(inc.reason.message);
  c.status = notes.length ? notes.join(' ') : 'Prices and offers loaded.';
  c.statusErr = !c.sellingPrice;
  renderCandidates();
  scheduleResults();
  refreshUsage();
}

function applyOffer(c, o) {
  c.applied ||= {};
  if (o.type === 'lease') {
    Object.assign(c.lease, {
      monthly: String(o.monthly), termMonths: String(o.term || 36),
      dueAtSigning: o.dueAtSigning != null ? String(o.dueAtSigning) : '',
      annualMileage: o.mileageLimit ? String(o.mileageLimit) : c.lease.annualMileage,
      overMileageFee: o.overMileageFee ? String(o.overMileageFee) : c.lease.overMileageFee,
      dispositionFee: o.dispositionFee != null ? String(o.dispositionFee) : c.lease.dispositionFee,
      source: 'offer',
    });
    c.applied.lease = o.id;
  } else if (o.type === 'finance') {
    Object.assign(c.buy, { apr: String(o.apr), termMonths: String(o.term || 60), source: 'offer' });
    c.applied.finance = o.id; delete c.applied.cash;
    c.buy.rebate = '';
  } else if (o.type === 'cash') {
    Object.assign(c.buy, { rebate: String(o.cashback || 0), source: 'offer' });
    c.applied.cash = o.id;
  }
}

async function refreshUsage() {
  try {
    const s = await api('api/status');
    const mc = s.usage?.marketcheck || 0; const ad = s.usage?.autodev || 0;
    const left = s.limits.marketcheck - mc;
    const parts = [];
    if (s.providers.mock) parts.push('<b>Demo data</b>');
    parts.push(`MarketCheck <b class="${left < 60 ? 'low' : ''}">${mc}/${s.limits.marketcheck}</b>`);
    parts.push(`auto.dev <b>${ad}/${s.limits.autodev}</b>`);
    $('#usage').innerHTML = `<span>${parts.join('</span> <span>')}</span> <span class="cap">calls this month</span>`;
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
  $('#addCandidate').addEventListener('click', () => { state.candidates.push(blankCandidate()); renderCandidates(); persist(); });
  $('#addSame').addEventListener('click', () => {
    const c = state.current;
    state.candidates.push(blankCandidate({ make: c.make, model: c.model, trim: c.trim }));
    renderCandidates(); persist();
  });
  $('#candidates').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove]');
    if (rm) { state.candidates.splice(Number(rm.dataset.remove), 1); renderCandidates(); scheduleResults(); return; }
    const pr = e.target.closest('[data-price]');
    if (pr) { priceCandidate(Number(pr.dataset.price)); return; }
    const of = e.target.closest('[data-offer]');
    if (of) {
      const [i, id] = of.dataset.offer.split(':');
      const c = state.candidates[Number(i)];
      const o = c.offers.find((x) => String(x.id) === id);
      if (o) { applyOffer(c, o); renderCandidates(); scheduleResults(); }
    }
  });
}

let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderResults, 200); });

// ---------- Boot ----------
(async function boot() {
  await restore();
  renderFields();
  renderCandidates();
  renderCarId();
  renderResults();
  wire();
  refreshUsage();
})();
