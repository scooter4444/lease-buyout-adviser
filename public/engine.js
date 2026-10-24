// Lease Buyout Advisor — decision engine.
// Pure functions, no network. Runs in the browser and in Node (tests).
//
// Every scenario starts from the same point: your current lease is ending.
// Each scenario is a stream of monthly cash flows over the comparison horizon
// (money out is positive, money back is negative), ending with whatever the car
// you hold is worth minus what you still owe on it. Net cost = what it costs you
// to drive for that period. Lower is better.

export const STATE_TAX = {
  // Approximate average combined (state + local) sales tax, %. Edit to your exact rate.
  AL: 9.29, AK: 1.82, AZ: 8.52, AR: 9.45, CA: 8.85, CO: 7.81, CT: 6.35, DE: 0, DC: 6.0,
  FL: 7.0, GA: 7.0, HI: 4.5, ID: 6.03, IL: 8.86, IN: 7.0, IA: 6.94, KS: 8.65, KY: 6.0,
  LA: 9.56, ME: 5.5, MD: 6.0, MA: 6.25, MI: 6.0, MN: 8.04, MS: 7.06, MO: 8.39, MT: 0,
  NE: 6.97, NV: 8.24, NH: 0, NJ: 6.6, NM: 7.62, NY: 8.53, NC: 3.0, ND: 7.04, OH: 7.24,
  OK: 8.98, OR: 0, PA: 6.34, RI: 7.0, SC: 7.49, SD: 6.11, TN: 9.56, TX: 8.2, UT: 7.25,
  VT: 6.36, VA: 5.77, WA: 9.38, WV: 6.59, WI: 5.72, WY: 5.44,
};

// States that do NOT reduce taxable price by trade-in value.
export const NO_TRADE_TAX_CREDIT = new Set(['CA', 'HI', 'MD', 'MT', 'VA', 'DC']);
// Michigan phases its trade-in credit in: capped at $12,000 for 2026 (Treasury).
export const TRADE_CREDIT_CAP = { MI: 12000 };

// Tax and fee details that a flat rate misses, from each state's revenue/DMV guidance (Oct 2026):
// - FL: 6% state + county surtax that applies only to the first $5,000 of a vehicle sale, but to
//   every lease payment in full. Sarasota County (North Port, Venice) surtax is 1%.
//   $225 initial registration when there's no Florida plate to transfer, ~$78 title.
// - MI: flat 6%, no local tax; dealer doc fee capped at the lesser of $280 or 5% of price.
// - CO: 2.9% state + local by the buyer's address, plus yearly Specific Ownership Tax.
export const STATE_DETAIL = {
  FL: { salesTaxPct: 6, surtaxPct: 1, surtaxCap: 5000, titleFees: 303, docFee: 999 },
  MI: { salesTaxPct: 6, docFee: 280, titleFees: 30 },
  CO: { docFee: 699, titleFees: 110 },
};
// Combined rates for specific ZIPs we've looked up. Highlands Ranch: 2.9 state + 1 Douglas County
// + 1 RTD + 0.1 SCFD (Avalara, 2026).
export const ZIP_TAX = {
  80129: { salesTaxPct: 5.0 },
  34286: { surtaxPct: 1 }, 34287: { surtaxPct: 1 }, 34288: { surtaxPct: 1 }, 34289: { surtaxPct: 1 }, 34290: { surtaxPct: 1 },
  48302: { salesTaxPct: 6 }, 48009: { salesTaxPct: 6 },
};
export function taxDefaults(state, zip) {
  const st = String(state || '').toUpperCase();
  const d = { salesTaxPct: STATE_TAX[st] ?? 7, surtaxPct: 0, surtaxCap: 0, titleFees: 150, docFee: 499, ...(STATE_DETAIL[st] || {}), ...(ZIP_TAX[zip] || {}) };
  d.leaseTaxPct = d.salesTaxPct + (d.surtaxCap ? d.surtaxPct : 0);
  return d;
}
// Sales tax on a vehicle purchase, including a surtax that only applies up to a cap.
export function vehicleSalesTax(taxable, a) {
  const t = Math.max(0, taxable);
  return t * (a.salesTaxPct / 100) + (a.surtaxCap ? Math.min(t, a.surtaxCap) * ((a.surtaxPct || 0) / 100) : 0);
}

export const LUXURY_MAKES = new Set([
  'acura', 'alfa romeo', 'aston martin', 'audi', 'bentley', 'bmw', 'cadillac', 'genesis',
  'infiniti', 'jaguar', 'land rover', 'lexus', 'lincoln', 'lucid', 'maserati',
  'mercedes-benz', 'mercedes', 'polestar', 'porsche', 'rivian', 'tesla', 'volvo',
]);

// Share of original MSRP a typical vehicle keeps, by age in years.
const RETENTION = [
  [0, 1.0], [1, 0.8], [2, 0.7], [3, 0.61], [4, 0.54], [5, 0.48], [6, 0.43],
  [7, 0.38], [8, 0.34], [9, 0.3], [10, 0.27], [12, 0.22], [15, 0.15], [20, 0.08],
];

// Maintenance + repairs per year for a mainstream car at 12k mi/yr, by age.
const MAINT = [450, 600, 800, 1100, 1350, 1600, 1850, 2100, 2300, 2450, 2600];

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const num = (v, d = 0) => {
  const n = typeof v === 'string' ? parseFloat(v.replace(/[$,\s]/g, '')) : v;
  return Number.isFinite(n) ? n : d;
};
const bool = (v, d) => (v === undefined || v === null || v === '' ? d : v === true || v === 'true' || v === 'on' || v === 1);

export function retention(ageYears, speed = 1) {
  const a = Math.max(0, ageYears);
  let r = RETENTION[RETENTION.length - 1][1];
  for (let i = 0; i < RETENTION.length - 1; i++) {
    const [a0, r0] = RETENTION[i];
    const [a1, r1] = RETENTION[i + 1];
    if (a <= a1) { r = r0 + ((a - a0) / (a1 - a0)) * (r1 - r0); break; }
  }
  return Math.pow(r, speed);
}

// Value change from mileage relative to a 12k/yr norm: about 0.6% per 1,000 extra miles.
function mileageFactor(excessMiles) {
  return clamp(1 - 0.006 * (excessMiles / 1000), 0.55, 1.25);
}

export function maintenanceAnnual(ageYears, { luxury = false, annualMiles = 12000 } = {}) {
  const i = clamp(Math.floor(Math.max(0, ageYears)), 0, MAINT.length - 1);
  const base = MAINT[i] * (luxury ? 1.5 : 1);
  return base * (0.5 + 0.5 * (annualMiles / 12000));
}

export function defaultInsurance(value) {
  return Math.round(600 + 0.035 * Math.max(0, value));
}

// Colorado specific ownership tax + typical registration fees (Class C).
export function coloradoRegistration(msrp, yearOfService) {
  const rates = [0.021, 0.015, 0.012, 0.009, 0.0045, 0.0045, 0.0045, 0.0045, 0.0045];
  const y = Math.max(1, Math.round(yearOfService));
  const sot = y >= 10 ? 3 : 0.85 * msrp * rates[y - 1];
  return Math.round(sot + 110);
}

export function registrationAnnual({ state, msrp, ageYears, flat }) {
  if (flat !== undefined && flat !== null && flat !== '' && Number.isFinite(num(flat, NaN))) return num(flat);
  if (state === 'CO' && msrp > 0) return coloradoRegistration(msrp, Math.floor(ageYears) + 1);
  if (state === 'FL') return 46; // 3,500 lb+ private auto, plus small county fees
  if (state === 'MI' && msrp > 0) { // $178 + $6 per $1,000 over $30k, then 90% a year through the 4th renewal
    const base = 178 + Math.max(0, Math.ceil((msrp - 30000) / 1000)) * 6;
    return Math.round(base * Math.pow(0.9, Math.min(3, Math.max(0, Math.floor(ageYears)))));
  }
  return 200;
}

export function loanPayment(principal, aprPct, termMonths) {
  if (principal <= 0 || termMonths <= 0) return 0;
  const r = aprPct / 100 / 12;
  if (r === 0) return principal / termMonths;
  return (principal * r) / (1 - Math.pow(1 + r, -termMonths));
}

// Interest paid and balance after k payments.
export function loanStatus(principal, aprPct, termMonths, k) {
  const pmt = loanPayment(principal, aprPct, termMonths);
  const r = aprPct / 100 / 12;
  let bal = principal;
  let interest = 0;
  const n = Math.min(k, termMonths);
  for (let i = 0; i < n; i++) {
    const int = bal * r;
    interest += int;
    bal = bal + int - pmt;
  }
  return { payment: pmt, interest, balance: Math.max(0, bal) };
}

export function estimateLeasePayment({ sellingPrice, msrp, termMonths = 36, residualPct, moneyFactor = DEFAULT_MF, acquisitionFee = 695, capReduction = 0, leaseCash = 0 }) {
  const res = (residualPct ?? defaultResidualPct(termMonths)) / 100 * msrp;
  const cap = sellingPrice + acquisitionFee - capReduction - leaseCash;
  const depreciation = (cap - res) / termMonths;
  const rent = (cap + res) * moneyFactor;
  return { monthly: Math.max(0, depreciation + rent), residual: res, capCost: cap };
}

// Lease rate used only when no factory lease deal was found. Captive lenders' October 2026 buy
// rates run from ~0.00002 (Nissan, Mazda specials) to ~0.0023 (Hyundai); 0.0018 (about 4.3% APR)
// is a middle-of-the-market rate, not a subsidized one.
export const DEFAULT_MF = 0.0018;

// The factory's own lease rate and residual, worked back from an advertised deal the way
// Leasehackr does it: payment = (net cap − residual)/term + (net cap + residual) × MF.
export function leaseTermsFromOffer({ monthly, term = 36, netCapCost, residual, msrp }) {
  if (!(netCapCost > 0 && residual > 0 && monthly > 0)) return null;
  const mf = (monthly - (netCapCost - residual) / term) / (netCapCost + residual);
  return { moneyFactor: Math.max(0, Math.round(mf * 1e6) / 1e6), residualPct: msrp ? Math.round((residual / msrp) * 1000) / 10 : null };
}

export function defaultResidualPct(termMonths) {
  if (termMonths <= 24) return 66;
  if (termMonths <= 36) return 58;
  if (termMonths <= 39) return 56;
  return 52;
}

function monthsBetween(fromDate, toDate) {
  const a = new Date(fromDate);
  const b = new Date(toDate);
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.max(0, (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + (b.getDate() - a.getDate()) / 30);
}

// Age in years of a model year on a given date (model years launch ~fall of the prior year).
export function modelAge(modelYear, onDate = new Date()) {
  const d = new Date(onDate);
  const launch = new Date(modelYear - 1, 9, 1);
  return Math.max(0, (d - launch) / (365.25 * 24 * 3600 * 1000));
}

// ---------- Input normalisation ----------

export function normalize(input = {}) {
  const today = input.today ? new Date(input.today) : new Date();
  const a = input.assumptions || {};
  const state = (a.state || '').toUpperCase();
  const td = taxDefaults(state, a.zip);
  const assumptions = {
    zip: a.zip || '',
    state,
    horizonYears: clamp(num(a.horizonYears, 3), 1, 10),
    annualMiles: clamp(num(a.annualMiles, 12000), 1000, 60000),
    salesTaxPct: num(a.salesTaxPct, td.salesTaxPct),
    surtaxPct: num(a.surtaxPct, td.surtaxPct),
    surtaxCap: num(a.surtaxCap, td.surtaxCap),
    leaseTaxPct: num(a.leaseTaxPct, a.salesTaxPct !== undefined && a.salesTaxPct !== '' ? num(a.salesTaxPct, td.salesTaxPct) : td.leaseTaxPct),
    tradeInTaxCredit: bool(a.tradeInTaxCredit, !NO_TRADE_TAX_CREDIT.has(state)),
    tradeInPct: clamp(num(a.tradeInPct, 90), 50, 105),
    titleFees: num(a.titleFees, td.titleFees),
    docFee: num(a.docFee, td.docFee),
    tradeCreditCap: TRADE_CREDIT_CAP[state] ?? Infinity,
    gasPrice: num(a.gasPrice, 3.4),
    discountRatePct: clamp(num(a.discountRatePct, 4), 0, 20),
    // How the monthly figure is counted (Settings): 'payments' = what you pay over the period,
    // nothing projected; 'ownership' = full cost of owning, minus what the car is worth at the end.
    costMode: a.costMode === 'ownership' ? 'ownership' : 'payments',
    includeRunning: a.includeRunning === true || a.includeRunning === 'true',
    spreadUpfront: !(a.spreadUpfront === false || a.spreadUpfront === 'false'),
  };

  const c = input.current || {};
  const year = num(c.year, today.getFullYear() - 3);
  const make = c.make || '';
  const leaseEnd = c.leaseEndDate ? new Date(c.leaseEndDate) : today;
  const monthsToEnd = c.monthsRemaining !== undefined && c.monthsRemaining !== ''
    ? Math.max(0, num(c.monthsRemaining))
    : monthsBetween(today, leaseEnd);
  const decisionDate = new Date(today.getTime() + monthsToEnd * 30.44 * 86400000);
  const currentMiles = num(c.currentMiles, 0);
  const milesAtEnd = currentMiles + (assumptions.annualMiles / 12) * monthsToEnd;
  const luxury = bool(c.luxury, LUXURY_MAKES.has(make.toLowerCase()));
  const ageNow = modelAge(year, today);
  const ageAtEnd = modelAge(year, decisionDate);
  const marketValueNow = num(c.marketValue, 0);
  const msrp = num(c.msrp, 0) || (marketValueNow > 0 ? marketValueNow / retention(ageNow, luxury ? 1.12 : 1) : 0);
  const current = {
    vin: c.vin || '',
    year, make, model: c.model || '', trim: c.trim || '',
    label: c.label || [year, make, c.model, c.trim].filter(Boolean).join(' ') || 'Current vehicle',
    luxury,
    msrp,
    mpg: num(c.mpg, 26),
    currentMiles,
    milesAtEnd,
    monthsToEnd,
    ageNow,
    ageAtEnd,
    marketValueNow,
    buyoutPrice: num(c.buyoutPrice, 0),
    purchaseOptionFee: num(c.purchaseOptionFee, 0),
    buyoutIsTaxed: bool(c.buyoutIsTaxed, true),
    allowedMiles: num(c.allowedMiles, 0),
    excessMileRate: num(c.excessMileRate, 0.25),
    dispositionFee: num(c.dispositionFee, 395),
    wearCharges: num(c.wearCharges, 0),
    monthlyPayment: num(c.monthlyPayment, 0),
    payCash: bool(c.payCash, false),
    downPayment: num(c.downPayment, 0),
    apr: num(c.apr, 7.0),
    termMonths: clamp(num(c.termMonths, 48), 12, 96),
    insuranceAnnual: c.insuranceAnnual !== undefined && c.insuranceAnnual !== '' ? num(c.insuranceAnnual) : null,
    maintenanceAnnual: c.maintenanceAnnual !== undefined && c.maintenanceAnnual !== '' ? num(c.maintenanceAnnual) : null,
    registrationAnnual: c.registrationAnnual,
    upcomingRepairs: num(c.upcomingRepairs, 0),
    depreciationSpeed: num(c.depreciationSpeed, luxury ? 1.12 : 1),
  };

  const candidates = (input.candidates || []).filter(Boolean).map((v, i) => {
    const vmake = v.make || '';
    const vlux = bool(v.luxury, LUXURY_MAKES.has(vmake.toLowerCase()));
    const condition = ['used', 'certified'].includes(v.condition) ? v.condition : 'new';
    // Listing feeds sometimes report a deposit or a monthly payment as the price. A new car under
    // $10k (used under $2k), or a price under half the sticker, isn't a real price: don't price off it.
    const floor = condition === 'new' ? 10000 : 2000;
    const msrpIn = num(v.msrp, 0), priceIn = num(v.sellingPrice, 0);
    const msrpOk = msrpIn >= floor ? msrpIn : 0;
    const priceOk = priceIn >= floor && !(msrpOk && priceIn < 0.5 * msrpOk) ? priceIn : 0;
    const priceSuspect = (priceIn > 0 && !priceOk) || (msrpIn > 0 && !msrpOk);
    const vmsrp = msrpOk || priceOk;
    const price = priceOk || vmsrp;
    const vyear = num(v.year, today.getFullYear() + 1);
    const used = condition !== 'new';
    return {
      condition,
      ageYears: used ? modelAge(vyear, today) : 0,
      startMiles: used ? num(v.miles, 12000 * Math.max(1, modelAge(vyear, today))) : 0,
      id: v.id || `c${i}`,
      label: v.label || [v.year, vmake, v.model, v.trim].filter(Boolean).join(' ') || `Vehicle ${i + 1}`,
      year: vyear,
      make: vmake, model: v.model || '', trim: v.trim || '',
      luxury: vlux,
      msrp: vmsrp,
      sellingPrice: price,
      priceSuspect,
      mpg: num(v.mpg, 30),
      insuranceAnnual: v.insuranceAnnual !== undefined && v.insuranceAnnual !== '' ? num(v.insuranceAnnual) : null,
      registrationAnnual: v.registrationAnnual,
      depreciationSpeed: num(v.depreciationSpeed, vlux ? 1.12 : 1),
      buy: {
        enabled: bool(v.buy?.enabled, true),
        rebate: num(v.buy?.rebate, 0),
        apr: num(v.buy?.apr, used ? 7.5 : 6.5),
        termMonths: clamp(num(v.buy?.termMonths, 60), 12, 96),
        downPayment: num(v.buy?.downPayment, 0),
        payCash: bool(v.buy?.payCash, false),
        source: v.buy?.source || 'estimate',
      },
      lease: {
        enabled: !used && bool(v.lease?.enabled, true),
        monthly: v.lease?.monthly !== undefined && v.lease?.monthly !== '' ? num(v.lease.monthly) : null,
        termMonths: clamp(num(v.lease?.termMonths, 36), 12, 60),
        dueAtSigning: v.lease?.dueAtSigning !== undefined && v.lease?.dueAtSigning !== '' ? num(v.lease.dueAtSigning) : null,
        dueIncludesFirstPayment: bool(v.lease?.dueIncludesFirstPayment, true),
        annualMileage: num(v.lease?.annualMileage, 12000),
        overMileageFee: num(v.lease?.overMileageFee, 0.25),
        dispositionFee: num(v.lease?.dispositionFee, 395),
        residualPct: v.lease?.residualPct !== undefined && v.lease?.residualPct !== '' ? num(v.lease.residualPct) : null,
        moneyFactor: num(v.lease?.moneyFactor, DEFAULT_MF),
        addOnCash: num(v.lease?.addOnCash, 0),
        acquisitionFee: num(v.lease?.acquisitionFee, 695),
        source: v.lease?.source || 'estimate',
      },
    };
  });

  return { today, decisionDate, assumptions, current, candidates };
}

// ---------- Lease exit (shared by every "get a new car" scenario) ----------

export function leaseExit(n) {
  const { current: c, assumptions: a } = n;
  const excessMiles = c.allowedMiles > 0 ? Math.max(0, c.milesAtEnd - c.allowedMiles) : 0;
  const returnCharges = excessMiles * c.excessMileRate + c.dispositionFee + c.wearCharges;
  const valueAtEnd = currentValueAt(n, 0);
  const tradeValue = valueAtEnd * (a.tradeInPct / 100);
  const payoff = c.buyoutPrice + c.purchaseOptionFee;
  const tradeEquity = tradeValue - payoff;
  // Trading in also reduces the sales tax on the next purchase in most states.
  const tradeTaxCredit = a.tradeInTaxCredit ? Math.min(tradeValue, a.tradeCreditCap) * (a.salesTaxPct / 100) : 0;
  const tradeBenefit = tradeEquity; // tax credit is applied inside the buy-new scenario
  const best = tradeBenefit > -returnCharges ? 'trade' : 'return';
  return {
    excessMiles,
    returnCharges,
    valueAtEnd,
    tradeValue,
    payoff,
    tradeEquity,
    tradeTaxCredit,
    choice: best,
    // Positive = money you get, negative = money you pay to walk away.
    cashAtExit: best === 'trade' ? tradeEquity : -returnCharges,
  };
}

// Market value of the current car `monthsAfterEnd` months after the lease ends.
export function currentValueAt(n, monthsAfterEnd) {
  const { current: c, assumptions: a } = n;
  if (!(c.marketValueNow > 0)) return 0;
  const sp = c.depreciationSpeed;
  const ageT = c.ageAtEnd + monthsAfterEnd / 12;
  const ageRatio = retention(ageT, sp) / retention(c.ageNow, sp);
  const typicalNow = 12000 * c.ageNow;
  const milesT = c.milesAtEnd + (a.annualMiles / 12) * monthsAfterEnd;
  const typicalT = 12000 * ageT;
  const extra = (milesT - typicalT) - (c.currentMiles - typicalNow);
  return c.marketValueNow * ageRatio * mileageFactor(extra);
}

function newValueAt(v, months, annualMiles) {
  if (v.condition && v.condition !== 'new') {
    // Used/certified: anchor on what you pay today and follow the curve from its current age.
    const age0 = v.ageYears || 0;
    const ratio = retention(age0 + months / 12, v.depreciationSpeed) / retention(age0, v.depreciationSpeed);
    const extra = (annualMiles - 12000) * (months / 12);
    return v.sellingPrice * ratio * mileageFactor(extra);
  }
  const base = v.msrp || v.sellingPrice;
  const extra = (annualMiles - 12000) * (months / 12);
  return base * retention(months / 12, v.depreciationSpeed) * mileageFactor(extra);
}

// ---------- Scenario builders ----------

export const RUNNING = new Set(['Insurance', 'Fuel', 'Maintenance & repairs']);

class Flows {
  constructor(H) { this.H = H; this.items = []; }
  // settle: money that only changes hands because the period ends (resale value, loan balance paid off).
  add(month, amount, category, settle = false) { if (amount) this.items.push({ month, amount, category, settle }); }
  nominal() { return this.items.reduce((s, f) => s + f.amount, 0); }
  pv(ratePct, keep = () => true) {
    const r = Math.pow(1 + ratePct / 100, 1 / 12) - 1;
    return this.items.reduce((s, f) => (keep(f) ? s + f.amount / Math.pow(1 + r, f.month) : s), 0);
  }
  byCategory() {
    const out = {};
    for (const f of this.items) out[f.category] = (out[f.category] || 0) + f.amount;
    return out;
  }
}

function operatingCosts(flows, { H, annualMiles, gasPrice, mpg, insuranceAnnual, maintAt, regAt }) {
  for (let m = 0; m < H; m++) {
    const month = m + 0.5; // mid-month
    flows.add(month, insuranceAnnual / 12, 'Insurance');
    flows.add(month, (annualMiles / 12 / Math.max(mpg, 1)) * gasPrice, 'Fuel');
    flows.add(month, maintAt(m) / 12, 'Maintenance & repairs');
    if (m % 12 === 0) flows.add(m, regAt(m), 'Registration');
  }
}

function finance(flows, { H, price, taxesFees, down, payCash, apr, termMonths, priceLabel }) {
  const total = price + taxesFees;
  if (payCash) {
    flows.add(0, price, priceLabel);
    flows.add(0, taxesFees, 'Taxes & fees');
    return { principal: 0, payment: 0, interest: 0, balanceAtEnd: 0 };
  }
  const d = Math.min(Math.max(0, down), total);
  const principal = total - d;
  const st = loanStatus(principal, apr, termMonths, H);
  // Split the down payment and principal between price and taxes so categories stay meaningful.
  const taxShare = total > 0 ? taxesFees / total : 0;
  flows.add(0, d * (1 - taxShare), priceLabel);
  flows.add(0, d * taxShare, 'Taxes & fees');
  const paid = Math.min(H, termMonths);
  for (let m = 1; m <= paid; m++) {
    const bal0 = loanStatus(principal, apr, termMonths, m - 1).balance;
    const int = bal0 * (apr / 100 / 12);
    const prin = st.payment - int;
    flows.add(m, int, 'Loan interest');
    flows.add(m, prin * (1 - taxShare), priceLabel);
    flows.add(m, prin * taxShare, 'Taxes & fees');
  }
  // Balance still owed at the end of the horizon is a cost you settle when you sell.
  flows.add(H, st.balance * (1 - taxShare), priceLabel, true);
  flows.add(H, st.balance * taxShare, 'Taxes & fees', true);
  return { principal, payment: st.payment, interest: st.interest, balanceAtEnd: st.balance };
}

// The headline monthly number, counted the way Settings says.
function paymentFigures(flows, a, carPerMonth, allInPerMonth) {
  const H = flows.H;
  let upfront = 0, recurring = 0, running = 0;
  for (const f of flows.items) {
    if (f.settle) continue;
    if (RUNNING.has(f.category)) { running += f.amount; continue; }
    if (f.month < 1) upfront += f.amount; else recurring += f.amount;
  }
  const paymentsPerMonth = ((a.spreadUpfront ? upfront : 0) + recurring) / H + (a.includeRunning ? running / H : 0);
  const ownMonthly = a.includeRunning ? allInPerMonth : carPerMonth;
  return {
    paymentsPerMonth,
    paidUpfront: upfront,
    paidOverPeriod: upfront + recurring,
    monthly: a.costMode === 'ownership' ? ownMonthly : paymentsPerMonth,
  };
}

function finish(flows, a, meta) {
  const nominal = flows.nominal();
  const pv = flows.pv(a.discountRatePct);
  const cats = flows.byCategory();
  const H = flows.H;
  // "Car cost": what the car itself costs you (payments, cash down, interest, taxes, fees,
  // registration, lease-end charges, minus what it's worth at the end). This is the number to
  // hold up against a lease payment. Gas, insurance and upkeep come on top; the ranking uses both.
  const carPv = flows.pv(a.discountRatePct, (f) => !RUNNING.has(f.category));
  return {
    ...meta,
    netCost: nominal,
    pvCost: pv,
    timeValue: pv - nominal,
    perMonth: pv / H,
    carPerMonth: carPv / H,
    runningPerMonth: (pv - carPv) / H,
    ...paymentFigures(flows, a, carPv / H, pv / H),
    perMile: pv / ((a.annualMiles / 12) * H),
    breakdown: cats,
    flows: flows.items,
  };
}

export function buyoutScenario(n, H) {
  const { current: c, assumptions: a } = n;
  const flows = new Flows(H);
  const taxable = c.buyoutPrice + c.purchaseOptionFee;
  const tax = c.buyoutIsTaxed ? vehicleSalesTax(taxable, a) : 0;
  const taxesFees = tax + a.titleFees + c.purchaseOptionFee;
  const loan = finance(flows, {
    H, price: c.buyoutPrice, taxesFees, down: c.downPayment, payCash: c.payCash,
    apr: c.apr, termMonths: c.termMonths, priceLabel: 'Vehicle price',
  });
  const valueAtEnd = currentValueAt(n, H);
  flows.add(H, -valueAtEnd, 'Vehicle price', true); // what it's worth when you're done
  if (c.upcomingRepairs) flows.add(0, c.upcomingRepairs, 'Maintenance & repairs');
  const insurance = c.insuranceAnnual ?? defaultInsurance(currentValueAt(n, 0));
  operatingCosts(flows, {
    H, annualMiles: a.annualMiles, gasPrice: a.gasPrice, mpg: c.mpg, insuranceAnnual: insurance,
    maintAt: (m) => c.maintenanceAnnual ?? maintenanceAnnual(c.ageAtEnd + m / 12, { luxury: c.luxury, annualMiles: a.annualMiles }),
    regAt: (m) => registrationAnnual({ state: a.state, msrp: c.msrp, ageYears: c.ageAtEnd + m / 12, flat: c.registrationAnnual }),
  });
  return finish(flows, a, {
    id: 'buyout',
    kind: 'buyout',
    title: `Buy out your ${c.label}`,
    vehicle: c.label,
    upfront: c.payCash ? c.buyoutPrice + taxesFees : Math.min(c.downPayment, c.buyoutPrice + taxesFees),
    monthlyPayment: loan.payment,
    loanTerm: c.payCash ? 0 : c.termMonths,
    valueAtEnd,
    balanceAtEnd: loan.balanceAtEnd,
    insurance,
    notes: [
      `Projected value after ${fmtYears(H)}: $${round(valueAtEnd)}`,
      c.payCash ? 'Paid in cash' : `Financed $${round(loan.principal)} at ${c.apr}% for ${c.termMonths} mo ($${round(loan.payment)}/mo)`,
    ],
  });
}

export function buyNewScenario(n, v, H, exit) {
  const { assumptions: a } = n;
  const flows = new Flows(H);
  const price = v.sellingPrice - v.buy.rebate;
  const tradeCredit = exit.choice === 'trade' && a.tradeInTaxCredit ? Math.min(exit.tradeValue, a.tradeCreditCap) : 0;
  const tax = vehicleSalesTax(price + a.docFee - tradeCredit, a);
  const taxesFees = tax + a.docFee + a.titleFees;
  flows.add(0, -exit.cashAtExit, 'Current lease exit');
  const loan = finance(flows, {
    H, price, taxesFees, down: v.buy.downPayment, payCash: v.buy.payCash,
    apr: v.buy.apr, termMonths: v.buy.termMonths, priceLabel: 'Vehicle price',
  });
  const valueAtEnd = newValueAt(v, H, a.annualMiles);
  flows.add(H, -valueAtEnd, 'Vehicle price', true);
  const insurance = v.insuranceAnnual ?? defaultInsurance(v.sellingPrice);
  operatingCosts(flows, {
    H, annualMiles: a.annualMiles, gasPrice: a.gasPrice, mpg: v.mpg, insuranceAnnual: insurance,
    // Certified cars carry an extended warranty: about 30% less in repairs while it lasts (~2 years).
    maintAt: (m) => maintenanceAnnual((v.ageYears || 0) + m / 12, { luxury: v.luxury, annualMiles: a.annualMiles }) * (v.condition === 'certified' && m < 24 ? 0.7 : 1),
    regAt: (m) => registrationAnnual({ state: a.state, msrp: v.msrp, ageYears: (v.ageYears || 0) + m / 12, flat: v.registrationAnnual }),
  });
  const kindWord = v.condition === 'certified' ? 'certified' : v.condition === 'used' ? 'used' : 'new';
  return finish(flows, a, {
    id: `buy-${v.id}`,
    kind: 'buy',
    candidateId: v.id,
    title: `${exit.choice === 'trade' ? 'Trade in' : 'Return'} lease → buy ${kindWord} ${v.label}`,
    condition: v.condition,
    vehicle: v.label,
    upfront: (v.buy.payCash ? price + taxesFees : v.buy.downPayment) - exit.cashAtExit,
    monthlyPayment: loan.payment,
    loanTerm: v.buy.payCash ? 0 : v.buy.termMonths,
    valueAtEnd,
    balanceAtEnd: loan.balanceAtEnd,
    insurance,
    source: v.buy.source,
    notes: [
      `Price $${round(v.sellingPrice)}${v.buy.rebate ? ` − $${round(v.buy.rebate)} rebate` : ''}`,
      v.buy.payCash ? 'Paid in cash' : `Financed $${round(loan.principal)} at ${v.buy.apr}% for ${v.buy.termMonths} mo ($${round(loan.payment)}/mo)`,
      `Projected value after ${fmtYears(H)}: $${round(valueAtEnd)}`,
      tradeCredit ? `Trade-in tax credit saves about $${round(tradeCredit * a.salesTaxPct / 100)}` : null,
    ].filter(Boolean),
  });
}

export function leaseNewScenario(n, v, H, exit) {
  const { assumptions: a } = n;
  const L = v.lease;
  let monthly = L.monthly;
  let estimated = false;
  if (monthly === null) {
    monthly = estimateLeasePayment({
      sellingPrice: v.sellingPrice, msrp: v.msrp, termMonths: L.termMonths,
      residualPct: L.residualPct ?? undefined, moneyFactor: L.moneyFactor, acquisitionFee: L.acquisitionFee,
    }).monthly;
    estimated = true;
  }
  // Extra cash you qualify for (loyalty, conquest, military...) goes against the money due
  // at signing first; anything left lowers the payments.
  const due0 = L.dueAtSigning ?? (monthly * (1 + a.leaseTaxPct / 100) + a.docFee);
  // Guard: extra cash can wipe out what's due at signing but trim payments by at most a quarter.
  // Anything more almost always means cash already built into the advertised payment got counted twice.
  const addOnAsked = Math.max(0, L.addOnCash || 0);
  const addOn = Math.min(addOnAsked, Math.max(0, due0) + 0.25 * monthly * L.termMonths);
  const fromDue = Math.min(addOn, Math.max(0, due0));
  const taxed = Math.max(0, monthly - (addOn - fromDue) / L.termMonths) * (1 + a.leaseTaxPct / 100);
  const due = due0 - fromDue;
  const T = L.termMonths;

  // One full lease term of lease-specific cash flows, then scale to the horizon
  // (re-leasing on the same terms if the horizon is longer than the lease).
  const term = new Flows(T);
  term.add(0, due, 'Lease payments & signing');
  const payments = L.dueIncludesFirstPayment ? T - 1 : T;
  for (let m = 1; m <= payments; m++) term.add(m, taxed, 'Lease payments & signing');
  const overMiles = Math.max(0, a.annualMiles - L.annualMileage) * (T / 12);
  term.add(T, overMiles * L.overMileageFee, 'Lease-end charges');
  term.add(T, L.dispositionFee, 'Lease-end charges');

  const flows = new Flows(H);
  flows.add(0, -exit.cashAtExit, 'Current lease exit');
  const scale = H / T;
  // Lay the term flows out across the horizon, repeating cycles and prorating the last.
  for (let start = 0; start < H; start += T) {
    const frac = Math.min(1, (H - start) / T);
    for (const f of term.items) flows.add(start + f.month * frac, f.amount * frac, f.category);
  }
  const insurance = v.insuranceAnnual ?? defaultInsurance(v.sellingPrice);
  operatingCosts(flows, {
    H, annualMiles: a.annualMiles, gasPrice: a.gasPrice, mpg: v.mpg, insuranceAnnual: insurance,
    maintAt: (m) => maintenanceAnnual((m % T) / 12, { luxury: v.luxury, annualMiles: a.annualMiles }) * 0.7,
    regAt: (m) => registrationAnnual({ state: a.state, msrp: v.msrp, ageYears: (m % T) / 12, flat: v.registrationAnnual }),
  });
  return finish(flows, a, {
    id: `lease-${v.id}`,
    kind: 'lease',
    candidateId: v.id,
    title: `${exit.choice === 'trade' ? 'Trade in' : 'Return'} lease → lease new ${v.label}`,
    vehicle: v.label,
    upfront: due - exit.cashAtExit,
    monthlyPayment: taxed,
    valueAtEnd: 0,
    balanceAtEnd: 0,
    insurance,
    estimated,
    scale,
    source: estimated ? 'estimate' : L.source,
    notes: [
      `${estimated ? 'Estimated' : 'Offer'}: $${round(monthly)}/mo + tax for ${T} mo, $${round(due)} due at signing`,
      addOn ? `Includes $${round(addOn)} of extra cash you qualify for${addOnAsked > addOn ? ` (capped; $${round(addOnAsked)} was stacked, which looks double-counted)` : ''}` : null,
      overMiles > 0 ? `About ${round(overMiles)} miles over the ${round(L.annualMileage)}/yr allowance per term` : null,
      'You own nothing at the end',
    ].filter(Boolean),
  });
}

// ---------- Main entry ----------

export function analyze(input) {
  const n = normalize(input);
  const H = Math.round(n.assumptions.horizonYears * 12);
  const exit = leaseExit(n);
  const scenarios = [];
  const warnings = [];

  if (!(n.current.buyoutPrice > 0)) warnings.push('Enter your buyout price to evaluate buying out your current car.');
  if (!(n.current.marketValueNow > 0)) warnings.push('No market value yet for your current car — look it up or enter one.');

  if (n.current.buyoutPrice > 0 && n.current.marketValueNow > 0) scenarios.push(buyoutScenario(n, H));
  for (const v of n.candidates) {
    if (v.priceSuspect) warnings.push(`${v.label}: the listed price looked wrong${v.sellingPrice > 0 ? ', so it’s priced at the sticker price' : ''}. Refresh its price.`);
    if (!(v.sellingPrice > 0)) { warnings.push(`${v.label}: needs a price.`); continue; }
    if (v.buy.enabled) scenarios.push(buyNewScenario(n, v, H, exit));
    if (v.lease.enabled) scenarios.push(leaseNewScenario(n, v, H, exit));
  }
  scenarios.sort((x, y) => x.monthly - y.monthly);

  // Effective monthly cost by number of years kept (1–8).
  const curve = [];
  for (let y = 1; y <= 8; y++) {
    const h = y * 12;
    const row = { years: y };
    if (n.current.buyoutPrice > 0 && n.current.marketValueNow > 0) row.buyout = buyoutScenario(n, h).perMonth;
    for (const v of n.candidates) {
      if (!(v.sellingPrice > 0)) continue;
      if (v.buy.enabled) row[`buy-${v.id}`] = buyNewScenario(n, v, h, exit).perMonth;
      if (v.lease.enabled) row[`lease-${v.id}`] = leaseNewScenario(n, v, h, exit).perMonth;
    }
    curve.push(row);
  }

  const equity = {
    marketValueNow: n.current.marketValueNow,
    valueAtLeaseEnd: exit.valueAtEnd,
    buyoutPrice: n.current.buyoutPrice,
    retailEquity: exit.valueAtEnd - exit.payoff,
    tradeEquity: exit.tradeEquity,
    returnCharges: exit.returnCharges,
    excessMiles: exit.excessMiles,
    milesAtEnd: n.current.milesAtEnd,
    monthsToEnd: n.current.monthsToEnd,
    exitChoice: exit.choice,
    cashAtExit: exit.cashAtExit,
  };

  return {
    horizonMonths: H,
    assumptions: n.assumptions,
    current: n.current,
    equity,
    scenarios,
    curve,
    verdict: verdict(n, scenarios, equity, curve),
    warnings,
  };
}

function verdict(n, scenarios, equity, curve) {
  if (!scenarios.length) return null;
  const best = scenarios[0];
  const buyout = scenarios.find((s) => s.kind === 'buyout');
  const runnerUp = scenarios.find((s) => s.id !== best.id);
  const H = n.assumptions.horizonYears;
  const lines = [];
  let headline;
  if (best.kind === 'buyout') {
    headline = 'Buy out your lease';
    if (runnerUp) lines.push(`Over ${fmtYears(H * 12)} it costs about $${round(runnerUp.pvCost - best.pvCost)} less than the next best option: ${runnerUp.kind === 'lease' ? 'leasing' : 'buying'} a new ${runnerUp.vehicle}.`);
  } else {
    headline = best.kind === 'lease' ? `Lease the ${best.vehicle}` : `Buy the ${best.vehicle}`;
    if (buyout) lines.push(`That beats buying out your current car by about $${round(buyout.pvCost - best.pvCost)} over ${fmtYears(H * 12)}.`);
  }
  if (equity.retailEquity > 500) {
    lines.push(`Your car is worth about $${round(equity.retailEquity)} more than the buyout at retail. That equity is yours whether you keep it or trade it — don't just hand the keys back.`);
  } else if (equity.retailEquity < -500) {
    lines.push(`Your buyout is about $${round(-equity.retailEquity)} above market value. Returning it lets the leasing company eat that loss.`);
  }
  if (equity.returnCharges > 0 && equity.excessMiles > 0) {
    lines.push(`Turning it in would cost about $${round(equity.returnCharges)} (${round(equity.excessMiles)} excess miles plus fees). Buying out or trading in avoids that.`);
  }
  // Break-even: when does the buyout stop being cheapest per month vs the best new option?
  if (buyout) {
    const others = Object.keys(curve[0]).filter((k) => k !== 'years' && k !== 'buyout');
    const winsAt = curve.filter((r) => others.every((k) => r.buyout <= r[k])).map((r) => r.years);
    if (winsAt.length && winsAt.length < curve.length) {
      lines.push(`Buying out is cheapest per month if you keep it ${describeYears(winsAt)}.`);
    } else if (!winsAt.length) {
      lines.push('At these numbers the buyout is not the cheapest option for any ownership length from 1 to 8 years.');
    }
  }
  return { headline, best: best.id, lines };
}

function describeYears(ys) {
  if (ys.length === 1) return `exactly ${ys[0]} year${ys[0] > 1 ? 's' : ''}`;
  const contiguous = ys.every((y, i) => i === 0 || y === ys[i - 1] + 1);
  if (contiguous) return `${ys[0]}–${ys[ys.length - 1]} years`;
  return `${ys.join(', ')} years`;
}

export function fmtYears(months) {
  const y = months / 12;
  return Number.isInteger(y) ? `${y} year${y === 1 ? '' : 's'}` : `${Math.round(months)} months`;
}

export function round(x) {
  return Math.round(x).toLocaleString('en-US');
}
