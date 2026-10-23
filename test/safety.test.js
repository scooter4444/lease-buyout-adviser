import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('../public/data/safety.json', import.meta.url)));

test('safety data: every car has sourced NHTSA and IIHS fields in known shapes', () => {
  assert.ok(data.cars.length >= 11);
  const ok = new Set([null, 'G', 'A', 'M', 'P', 'Superior', 'Advanced', 'Basic']);
  for (const c of data.cars) {
    assert.ok(c.make && c.model && c.year, c.id);
    assert.match(c.nhtsa.url, /^https:\/\/www\.nhtsa\.gov\//, c.id);
    assert.match(c.iihs.url, /^https:\/\/www\.iihs\.org\//, c.id);
    assert.ok([null, 'TSP', 'TSP+'].includes(c.iihs.award), c.id);
    for (const k of ['smallOverlapDriver', 'smallOverlapPassenger', 'moderateOverlapUpdated', 'sideUpdated', 'headlights', 'pedestrianAEB', 'seatBeltReminders', 'latch']) assert.ok(ok.has(c.iihs[k] ?? null), `${c.id} ${k}=${c.iihs[k]}`);
    assert.ok(c.nhtsa.overall == null || (c.nhtsa.overall >= 1 && c.nhtsa.overall <= 5), c.id);
  }
});

test('safety data: the Edge baseline keeps its Poor SEL headlights and no award', () => {
  const e = data.cars.find((c) => c.id === 'edge');
  assert.equal(e.iihs.headlights, 'P');
  assert.equal(e.iihs.award, null);
});
