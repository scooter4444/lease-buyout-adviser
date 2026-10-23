import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestStack, classify, eligible } from '../public/stack.js';

const carol = { owned: ['Toyota', 'Cadillac'], household: ['Toyota', 'Cadillac', 'Ford'], currentLease: { make: 'Ford', captive: true }, military: true };
const cash = (id, amount, title, extra = {}) => ({ id, type: 'cash', cashback: amount, title, ...extra });

test('Lincoln: retail cash + Cadillac conquest + military stack for a household with a Cadillac', () => {
  const offers = [
    cash('rc', 4000, 'Retail Customer Cash', { text: 'Program #11109. Not compatible with subvened APR financing through Lincoln AFS.' }),
    cash('cq', 1000, 'Cadillac Conquest', { group: 'Cadillac owners or lessees', text: 'Current owner/lessee of a 1995 or newer Cadillac. Program #30493.' }),
    cash('mil', 500, '2026 Military Recognition Exclusive Cash Reward', { group: 'Military personnel', text: 'May not be used/combined with any Ford/Lincoln private offer.' }),
    cash('grad', 500, 'College Grad Cash', { group: 'College graduates' }),
  ];
  const s = bestStack(offers, { elig: carol, make: 'Lincoln', mode: 'finance' });
  assert.deepEqual(s.ids.sort(), ['cq', 'mil', 'rc']);
  assert.equal(s.total, 5500);
  assert.match(s.reasons.find((r) => r.id === 'cq').why, /Cadillac/);
  // With the 0% APR, retail cash drops out; with A/Z-Plan, the military cash drops out.
  assert.ok(!bestStack(offers, { elig: carol, make: 'Lincoln', mode: 'finance', specialApr: true }).ids.includes('rc'));
  assert.ok(!bestStack(offers, { elig: carol, make: 'Lincoln', mode: 'finance', azActive: true }).ids.includes('mil'));
});

test('Genesis conquest: Ford doesn’t qualify, the household Toyota does', () => {
  const o = cash('g', 1500, 'Competitive Owner Bonus', { group: 'Competitive vehicle owners' });
  const fordOnly = { household: ['Ford'], owned: [], currentLease: { make: 'Ford' } };
  assert.equal(eligible(o, classify({ ...o, make: 'Genesis' }), fordOnly, 'Genesis').ok, false);
  assert.equal(eligible(o, classify({ ...o, make: 'Genesis' }), carol, 'Genesis').ok, true);
});

test('Ford: lease renewal applies to a Ford Credit lessee on a lease, not on a purchase', () => {
  const offers = [cash('rcl', 1250, 'RCL Renewal', { text: 'Available to customers who come out of any eligible Ford vehicle RCL contract.' })];
  assert.equal(bestStack(offers, { elig: carol, make: 'Ford', mode: 'lease' }).total, 1250);
  assert.equal(bestStack(offers, { elig: carol, make: 'Ford', mode: 'finance' }).total, 0);
});

test('the same program listed for several trims counts once; one loyalty per stack', () => {
  const offers = [
    cash('a', 3000, 'Retail Bonus Cash'), cash('b', 3000, 'Retail Bonus Cash'), cash('c', 2000, 'Retail Bonus Cash'),
    cash('l1', 1000, 'Owner Loyalty', { group: 'Ford owners or lessees' }), cash('l2', 500, 'Owner Loyalty Bonus', { group: 'Current owners of eligible vehicles' }),
  ];
  const s = bestStack(offers, { elig: { ...carol, owned: ['Ford'] }, make: 'Ford', mode: 'finance' });
  assert.equal(s.total, 4000);
});

test('cash that needs the brand’s financing is dropped when paying cash', () => {
  const offers = [cash('hmf', 1000, 'HMF Bonus Cash', { text: 'Must finance through HMF, applied as down payment.' }), cash('pub', 2000, 'Retail Bonus Cash')];
  assert.equal(bestStack(offers, { elig: carol, make: 'Hyundai', mode: 'cash' }).total, 2000);
  assert.equal(bestStack(offers, { elig: carol, make: 'Hyundai', mode: 'finance' }).total, 3000);
});
