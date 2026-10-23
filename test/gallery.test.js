import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
process.env.CACHE_DIR = '/tmp/lba-test-cache';
const { spinFrames, guessTags, galleryParams } = await import('../server/providers.js');
const { signImg, resized } = await import('../server/images.js');

test('walkaround keeps the best photo per 45° step, in order around the car', () => {
  const ph = [10, 0, 50, 95, 100, 180, 185, 270, 300, 330].map((angle) => ({ cat: 'exterior', angle, ok: true }));
  ph.push({ cat: 'dash', angle: null, ok: true }, { cat: 'exterior', angle: 90, ok: false });
  const f = spinFrames(ph).map((p) => p.angle);
  assert.deepEqual(f, [0, 50, 95, 180, 270, 300]);
});

test('without sorting, the first third or so of photos count as outside', () => {
  const t = guessTags(30);
  assert.equal([...t.values()].filter((x) => x.cat === 'exterior').length, 11);
  assert.equal(t.get(29).cat, 'inside');
});

test('gallery inputs fill year and trim from the researched deal', () => {
  const g = galleryParams({ make: 'Kia', model: 'Sorento', zip: '34287' });
  assert.equal(g.year, '2026');
  assert.equal(g.trim, 'LX');
  assert.equal(g.used, false);
  assert.equal(galleryParams({ make: 'Ford', model: 'Edge', year: 2024, trim: 'SEL', mine: true, zip: '34287' }).used, true);
});

test('image URLs are signed and resized to phone size', async () => {
  const sharp = (await import('sharp')).default;
  const big = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#cccccc' } }).jpeg({ quality: 95 }).toBuffer();
  const srv = http.createServer((_q, r) => { r.writeHead(200, { 'Content-Type': 'image/jpeg' }); r.end(big); }).listen(0);
  const url = `http://127.0.0.1:${srv.address().port}/car.jpg`;
  assert.match(signImg(url), /^api\/img\?u=.+&w=800&s=[\w-]{22}$/);
  const out = await resized(url, 800);
  const meta = await sharp(out.buf).metadata();
  assert.equal(meta.width, 800);
  assert.equal(meta.format, 'webp');
  assert.ok(out.buf.length < big.length / 4);
  srv.close();
});
