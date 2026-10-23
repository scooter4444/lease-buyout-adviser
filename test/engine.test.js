import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyze, loanPayment, loanStatus, retention, estimateLeasePayment, coloradoRegistration, normalize, leaseExit,
} from '../public/engine.js';

const TODAY = '2026-10-23';

function base(overrides = {}) {
  return {
    today: TODAY,
    assumptions: { state: 'CO', zip: '80202', horizonYears: 3, annualMiles: 12000, salesTaxPct: 8.81, discountRatePct: 0, ...overrides.assumptions },
    current: {
      year: 2023, make: 'Toyota', model: 'RAV4', trim: 'XLE', mpg: 30,
      currentMiles: 30000, monthsRemaining: 2, marketValue: 29000, msrp: 33000,
      buyoutPrice: 24000, purchaseOptionFee: 300, allowedMiles: 30000, excessMileRate: 0.25,
      dispositionFee: 395, apr: 7, termMonths: 48, ...overrides.current,
    },
    candidates: overrides.candidates ?? [{
      id: 'rav', year: 2027, make: 'Toyota', model: 'RAV4', trim: 'XLE', msrp: 34000, sellingPrice: 33500, mpg: 31,
      buy: { apr: 6, termMonths: 60 },
      lease: { monthly: 399, termMonths: 36, dueAtSigning: 3000, annualMileage: 12000 },
    }],
  };
}

test('loan payment matches standard amortization', () => {
  assert.equal(Math.round(loanPayment(30000, 6, 60) * 100) / 100, 579.98);
  assert.equal(loanPayment(12000, 0, 12), 1000);
  const s = loanStatus(30000, 6, 60, 60);
  assert.ok(s.balance < 0.01);
  assert.ok(Math.abs(s.interest - (579.98 * 60 - 30000)) < 1);
});

test('retention curve is monotonic and anchored at 1', () => {
  assert.equal(retention(0), 1);
  for (let a = 0; a < 15; a += 0.5) assert.ok(retention(a + 0.5) <= retention(a));
  assert.ok(retention(3, 1.12) < retention(3, 1));
});

test('lease payment estimate is in a sane range', () => {
  const { monthly } = estimateLeasePayment({ sellingPrice: 33500, msrp: 34000, termMonths: 36, residualPct: 58, moneyFactor: 0.0025 });
  assert.ok(monthly > 350 && monthly < 600, `monthly ${monthly}`);
});

test('colorado ownership tax year 1 on $40k MSRP', () => {
  assert.equal(coloradoRegistration(40000, 1), Math.round(0.85 * 40000 * 0.021 + 110));
});

test('breakdown categories sum to net cost for every scenario', () => {
  const r = analyze(base());
  assert.equal(r.scenarios.length, 3);
  for (const s of r.scenarios) {
    const sum = Object.values(s.breakdown).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - s.netCost) < 0.01, `${s.id}: ${sum} vs ${s.netCost}`);
    assert.ok(Math.abs(s.pvCost - s.netCost) < 0.01, 'discount 0 => pv == nominal');
  }
});

test('financed and cash buyout differ only by interest (no discounting)', () => {
  const fin = analyze(base({ current: { apr: 7 } })).scenarios.find((s) => s.kind === 'buyout');
  const cash = analyze(base({ current: { payCash: true } })).scenarios.find((s) => s.kind === 'buyout');
  const interest = fin.breakdown['Loan interest'];
  assert.ok(interest > 0);
  assert.ok(Math.abs(fin.netCost - cash.netCost - interest) < 0.01);
});

test('big positive equity makes buyout win; huge negative equity makes it lose', () => {
  const good = analyze(base({ current: { buyoutPrice: 18000 } }));
  assert.equal(good.scenarios[0].kind, 'buyout');
  assert.equal(good.verdict.headline, 'Buy out your lease');
  const bad = analyze(base({ current: { buyoutPrice: 40000 } }));
  assert.notEqual(bad.scenarios[0].kind, 'buyout');
});

test('lease exit picks trade when equity beats return charges', () => {
  const n = normalize(base({ current: { buyoutPrice: 20000 } }));
  const ex = leaseExit(n);
  assert.equal(ex.choice, 'trade');
  assert.ok(ex.cashAtExit > 0);
  const n2 = normalize(base({ current: { buyoutPrice: 35000 } }));
  const ex2 = leaseExit(n2);
  assert.equal(ex2.choice, 'return');
  assert.ok(Math.abs(ex2.cashAtExit + ex2.returnCharges) < 1e-9);
});

test('excess miles are charged on return', () => {
  const n = normalize(base({ current: { currentMiles: 40000, allowedMiles: 30000, buyoutPrice: 40000 } }));
  const ex = leaseExit(n);
  assert.ok(ex.excessMiles >= 10000);
  assert.ok(ex.returnCharges >= 10000 * 0.25 + 395);
});

test('lease horizon longer than term repeats the lease', () => {
  const r3 = analyze(base({ assumptions: { horizonYears: 3 } })).scenarios.find((s) => s.kind === 'lease');
  const r6 = analyze(base({ assumptions: { horizonYears: 6 } })).scenarios.find((s) => s.kind === 'lease');
  const lease3 = r3.breakdown['Lease payments & signing'];
  const lease6 = r6.breakdown['Lease payments & signing'];
  assert.ok(Math.abs(lease6 - 2 * lease3) < 0.01);
});

test('discounting lowers the cost of a financed buy', () => {
  const r0 = analyze(base()).scenarios.find((s) => s.kind === 'buy');
  const r4 = analyze(base({ assumptions: { discountRatePct: 4 } })).scenarios.find((s) => s.kind === 'buy');
  assert.ok(r4.pvCost !== r0.pvCost);
});

test('missing data produces warnings instead of crashing', () => {
  const r = analyze({ today: TODAY, current: {}, candidates: [{ make: 'Honda' }] });
  assert.equal(r.scenarios.length, 0);
  assert.ok(r.warnings.length >= 2);
  assert.equal(r.verdict, null);
});

test('break-even curve has 8 rows with every scenario', () => {
  const r = analyze(base());
  assert.equal(r.curve.length, 8);
  for (const row of r.curve) for (const k of ['buyout', 'buy-rav', 'lease-rav']) assert.ok(Number.isFinite(row[k]), k);
});
