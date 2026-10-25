// Safety tab: IIHS first, then NHTSA, then equipment and what reviewers say.
// Researched data for known cars ships in data/safety.json; anything else gets live NHTSA
// ratings and recalls from /api/safety. Nothing here guesses: unknown stays "Unconfirmed".

let DATA = null;
let loading = null;
const live = new Map(); // "year|make|model" -> NHTSA result, or 'pending' / 'failed'

const ui = { view: 'overview', sort: 'iihs', h2h: 0, tests: null, rev: 0, spin: null, frame: 0, cat: 'dash', sbs: { a: 0, b: 0 } };

// ---------- Photos: a real car for sale, sorted into a walkaround and interior shots ----------
const galleries = new Map(); // key -> result | 'pending' | 'failed'
const CATS = [['exterior', 'Outside'], ['dash', 'Dash'], ['screen', 'Screens'], ['front-seats', 'Front seats'], ['rear-seats', 'Rear seats'], ['roof', 'Sunroof'], ['cargo', 'Cargo'], ['console', 'Console'], ['third-row', 'Third row'], ['inside', 'Inside']];
const catName = (k) => (CATS.find((c) => c[0] === k) || [k, k])[1];
function galleryFor(x, ctx) {
  const c = x.car, rec = x.rec;
  // The server fills in year and trim from the researched deal, the same way its overnight pre-load does.
  const q = { year: c.year || '', make: c.make, model: c.model, trim: c.trim || '', condition: x.mine ? 'used' : c.condition || 'new', mine: x.mine ? '1' : '', zip: ctx.zip || '' };
  const key = JSON.stringify(q);
  const got = galleries.get(key);
  if (!got) {
    galleries.set(key, 'pending');
    ctx.api(`api/gallery?${new URLSearchParams(q)}`)
      .then((r) => { galleries.set(key, r); ctx.rerender(); })
      .catch(() => { galleries.set(key, 'failed'); ctx.rerender(); });
    return { state: 'pending' };
  }
  if (got === 'pending' || got === 'failed') return { state: got };
  const good = got.photos.filter((p) => p.ok !== false);
  // The server picks evenly spaced outside frames; older cached results fall back to angle order.
  const ext = (got.spin || []).map((i) => got.photos[i]).filter(Boolean);
  if (!ext.length) ext.push(...good.filter((p) => p.cat === 'exterior').sort((a, b) => (a.angle ?? 0) - (b.angle ?? 0)).slice(0, 10));
  const byCat = {};
  for (const p of good) if (p.cat && p.cat !== 'exterior') (byCat[p.cat] ||= []).push(p);
  byCat.exterior = good.filter((p) => p.cat === 'exterior');
  return { state: got.listing ? 'ready' : 'none', g: got, ext, byCat, all: good };
}
function sourceLine(G, esc) {
  const l = G.g.listing;
  const what = [l.color ? l.color.replace(/\s*(metallic|tri-?coat|pearl(coat)?|clearcoat|tinted)\b/gi, '').trim() : '', l.year, l.make, l.model, l.trim].filter(Boolean).join(' ');
  const where = [l.dealer, [l.city, l.state].filter(Boolean).join(', ')].filter(Boolean).join(', ');
  return `Photos of ${/^[aeiou]/i.test(what) ? 'an' : 'a'} ${esc(what)}${l.miles > 100 ? ` with ${Number(l.miles).toLocaleString()} miles` : ''} for sale${where ? ` at ${esc(where)}` : ''}.${l.url ? ` <a href="${esc(l.url)}" target="_blank" rel="noopener">See the listing</a>` : ''}`;
}
const pendingHTML = (msg) => `<div class="g-wait"><span class="spinner" aria-hidden="true"></span>${msg}</div>`;

function spinView(list, ctx) {
  const { esc } = ctx;
  const id = ui.spin && list.some((x) => x.rec.id === ui.spin) ? ui.spin : list[0].rec.id;
  const x = list.find((y) => y.rec.id === id);
  const G = galleryFor(x, ctx);
  const chips = `<div class="s-chips scroll" role="group" aria-label="Car">${list.map((y) => `<button type="button" class="s-chip" data-s="spin" data-k="${esc(y.rec.id)}" aria-pressed="${y.rec.id === id}">${esc(y.mine ? `Her ${y.rec.model}` : `${y.rec.make} ${y.rec.model}`)}</button>`).join('')}</div>`;
  if (G.state === 'pending') return `${chips}${pendingHTML('Finding a white one for sale nearby and sorting its photos. This can take half a minute the first time.')}`;
  if (G.state !== 'ready') return `${chips}<p class="s-empty">No listing with enough photos turned up for this car.</p>`;
  const n = G.ext.length;
  const f = Math.min(ui.frame, Math.max(0, n - 1));
  const insideCats = CATS.filter(([k]) => k !== 'exterior' && G.byCat[k]?.length);
  return `${chips}
    <section class="g-spin-card">
      <div class="g-spin" data-spin="${n}" aria-label="Drag to walk around the car">
        <span class="g-load" aria-live="polite">Loading the walkaround…</span>
        ${G.ext.map((p, i) => `<img src="${esc(p.url)}" alt="${esc(`${x.rec.make} ${x.rec.model}${p.angle != null ? `, from ${p.angle}°` : ''}`)}" class="${i === f ? 'on' : ''}" draggable="false" decoding="async" referrerpolicy="no-referrer">`).join('')}
        <span class="g-hint" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 4 0 0 0 18 0"></path><path d="M17 15l4-3-4-3"></path></svg>Drag to turn</span>
      </div>
      <label class="g-range"><span class="sr-only">Turn the car</span><input type="range" min="0" max="${Math.max(0, n - 1)}" value="${f}" data-range></label>
      <p class="fine">${sourceLine(G, esc)}${G.g.sorted ? '' : ' These photos are only roughly sorted for now; they get sorted properly overnight.'}</p>
    </section>
    ${insideCats.length ? insideCats.map(([k, label]) => `
      <section class="g-row"><h3>${esc(label)}</h3>
        <div class="g-strip">${G.byCat[k].map((p) => `<button type="button" class="g-thumb" data-s="zoom" data-k="${esc(p.full || p.url)}" aria-label="${esc(`${label}, larger`)}"><img src="${esc(p.thumb || p.url)}" alt="" loading="lazy" referrerpolicy="no-referrer"></button>`).join('')}</div>
      </section>`).join('') : `<section class="g-row"><h3>All photos</h3><div class="g-strip">${G.all.map((p) => `<button type="button" class="g-thumb" data-s="zoom" data-k="${esc(p.full || p.url)}" aria-label="Photo, larger"><img src="${esc(p.thumb || p.url)}" alt="" loading="lazy" referrerpolicy="no-referrer"></button>`).join('')}</div></section>`}`;
}

function sideBySide(A, B, ctx) {
  const { esc } = ctx;
  const GA = galleryFor(A, ctx), GB = galleryFor(B, ctx);
  if (GA.state === 'pending' || GB.state === 'pending') return `<section class="g-sbs">${pendingHTML('Loading photos of both cars…')}</section>`;
  const cats = CATS.filter(([k]) => GA.byCat?.[k]?.length || GB.byCat?.[k]?.length);
  if (!cats.length) return '';
  const cat = cats.some(([k]) => k === ui.cat) ? ui.cat : cats[0][0];
  const side = (G, x, which) => {
    const ps = cat === 'exterior' ? G.ext : G.byCat?.[cat] || [];
    if (!ps.length) return `<figure class="g-side"><div class="g-none">No ${esc(catName(cat).toLowerCase())} photo in this listing</div><figcaption>${esc(x.mine ? `Her ${x.rec.model}` : x.rec.model)}</figcaption></figure>`;
    const i = ui.sbs[which] % ps.length;
    return `<figure class="g-side"><button type="button" class="g-big" data-s="zoom" data-k="${esc(ps[i].full || ps[i].url)}" aria-label="Larger"><img src="${esc(ps[i].url)}" alt="${esc(`${x.rec.model} ${catName(cat).toLowerCase()}`)}" referrerpolicy="no-referrer"></button>
      <figcaption>${esc(x.mine ? `Her ${x.rec.model}` : x.rec.model)}${ps.length > 1 ? ` <button type="button" class="g-more" data-s="sbs" data-k="${which}">${i + 1} of ${ps.length}</button>` : ''}</figcaption></figure>`;
  };
  return `<section class="g-sbs" aria-label="Side by side photos">
    <div class="s-chips scroll" role="group" aria-label="What to compare">${cats.map(([k, l]) => `<button type="button" class="s-chip" data-s="cat" data-k="${k}" aria-pressed="${k === cat}">${esc(l)}</button>`).join('')}</div>
    <div class="g-pair">${side(GA, A, 'a')}${side(GB, B, 'b')}</div>
    <p class="fine">Real cars for sale; trims and colors can differ from the deal.</p>
  </section>`;
}

const FEATS = [
  { k: 'handsFree', label: 'Hands-free highway driving' },
  { k: 'camera360', label: '360° camera' },
  { k: 'ventilatedSeats', label: 'Cooled seats' },
  { k: 'heatedSeats', label: 'Heated seats' },
  { k: 'heatedWheel', label: 'Heated steering wheel' },
  { k: 'wirelessCarPlay', label: 'Wireless CarPlay' },
  { k: 'handsFreeLiftgate', label: 'Hands-free liftgate' },
  { k: 'panoramicRoof', label: 'Panoramic roof' },
  { k: 'awd', label: 'All-wheel drive' },
];
const DEFAULT_WANT = ['handsFree', 'ventilatedSeats', 'wirelessCarPlay', 'awd'];

const IIHS_TESTS = [
  ['smallOverlapDriver', 'Small overlap front, driver side'],
  ['smallOverlapPassenger', 'Small overlap front, passenger side'],
  ['moderateOverlapUpdated', 'Moderate overlap front, updated (rear passenger)'],
  ['sideUpdated', 'Side crash, updated test'],
  ['headlights', 'Headlights (trim in the deal)'],
  ['pedestrianAEB', 'Pedestrian crash prevention'],
  ['seatBeltReminders', 'Seat belt reminders'],
  ['latch', 'Child seat anchors (LATCH)'],
];
const KEY_TESTS = ['smallOverlapDriver', 'moderateOverlapUpdated', 'sideUpdated', 'headlights'];
const SHORT = { smallOverlapDriver: 'Small overlap', moderateOverlapUpdated: 'Rear seat', sideUpdated: 'Side', headlights: 'Lights' };

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export async function loadSafety() {
  if (DATA) return DATA;
  loading ||= fetch('data/safety.json').then((r) => r.json()).then((d) => (DATA = d)).catch(() => (DATA = { cars: [] }));
  return loading;
}

function matchData(make, model) {
  if (!DATA) return null;
  const mk = norm(make), md = norm(model);
  return DATA.cars.find((c) => norm(c.make) === mk && (norm(c.model) === md || md.startsWith(norm(c.model)) || norm(c.model).startsWith(md))) || null;
}

// A car as the tab sees it: researched record, or a thin one built from live NHTSA data.
function recordFor(car, ctx) {
  const found = matchData(car.make, car.model);
  if (found) return { ...found, researched: true, yearNote: car.year && Number(car.year) !== found.year ? `Ratings are for the ${found.year} model.` : '' };
  const year = Number(car.year) || new Date().getFullYear();
  const key = `${year}|${car.make}|${car.model}`;
  const got = live.get(key);
  if (!got) {
    live.set(key, 'pending');
    ctx.api(`api/safety?${new URLSearchParams({ year, make: car.make, model: car.model })}`)
      .then((r) => { live.set(key, r); ctx.rerender(); })
      .catch(() => { live.set(key, 'failed'); ctx.rerender(); });
  }
  const r = got && typeof got === 'object' ? got : null;
  return {
    id: `live-${norm(car.make)}-${norm(car.model)}`, researched: false, pending: got === 'pending' || !got,
    year, make: car.make, model: car.model, trim: car.trim || '', name: [year, car.make, car.model, car.trim].filter(Boolean).join(' '),
    note: r ? 'Only government crash tests and recalls are loaded for this car. IIHS results and equipment haven’t been checked yet.' : got === 'failed' ? 'Couldn’t reach NHTSA just now.' : 'Loading NHTSA ratings…',
    nhtsa: { overall: r?.ratings?.overall ?? null, frontal: r?.ratings?.frontal ?? null, side: r?.ratings?.side ?? null, rollover: r?.ratings?.rollover ?? null, rolloverRiskPct: r?.ratings?.rolloverRiskPct ?? null, recalls: r?.recalls?.count ?? null, recallTopics: r?.recalls?.topics || [], url: r?.ratings?.url || 'https://www.nhtsa.gov/ratings' },
    iihs: { award: null, awardYear: null, url: 'https://www.iihs.org/ratings', unchecked: true },
    assist: {}, feat: {}, specs: {}, warranty: null, review: { score: '–', scoreN: null, pros: [], cons: [] }, reliability: '',
  };
}

// ---------- Small pieces ----------
function tile(r) {
  const u = String(r || '');
  if (u === 'Superior') return { l: 'S', word: 'Superior', cls: 'g' };
  if (u === 'Advanced') return { l: 'Ad', word: 'Advanced', cls: 'a' };
  if (u === 'Basic') return { l: 'B', word: 'Basic', cls: 'm' };
  const k = u.charAt(0).toUpperCase();
  return { G: { l: 'G', word: 'Good', cls: 'g' }, A: { l: 'A', word: 'Acceptable', cls: 'a' }, M: { l: 'M', word: 'Marginal', cls: 'm' }, P: { l: 'P', word: 'Poor', cls: 'p' } }[k]
    || { l: '–', word: 'Not rated', cls: 'n' };
}
const tileHTML = (r, esc, big = false) => { const t = tile(r); return `<span class="ii ii-${t.cls}${big ? ' big' : ''}" title="${esc(t.word)}">${t.l}</span>`; };
function award(c) {
  const a = c.iihs?.award;
  if (c.iihs?.unchecked) return { short: 'Not checked', long: 'IIHS results not loaded for this car', cls: 'none' };
  if (!a) return { short: 'No award', long: `No IIHS award for the ${c.year}`, cls: 'none' };
  const old = c.iihs.awardYear && c.iihs.awardYear < 2026;
  return { short: `${a} ${c.iihs.awardYear || ''}`.trim(), long: `${a === 'TSP+' ? 'Top Safety Pick+' : 'Top Safety Pick'} ${c.iihs.awardYear || ''}${old ? ' (older, easier criteria)' : ''}`, cls: a === 'TSP+' ? (old ? 'plus old' : 'plus') : 'pick' };
}
const stars = (n) => (n ? `<span class="stars" aria-label="${n} of 5 stars">${'★'.repeat(n)}<span class="off">${'★'.repeat(5 - n)}</span></span>` : '<span class="soft">Not rated</span>');
const has = (v) => v === true || v === 'standard';
const lvl = (v) => (v === true || v === 'standard' ? 2 : v === 'optional' ? 1 : 0);
const featWord = (v) => (v === true || v === 'standard' ? 'Standard' : v === 'optional' ? 'Optional' : v === false ? 'Not offered' : 'Unconfirmed');

// IIHS-led safety score: award (2026 counts most), then the key crash tests, then NHTSA, minus recalls.
function safetyScore(c) {
  let s = 0;
  const a = c.iihs?.award, y = c.iihs?.awardYear || 0;
  if (a) s += (a === 'TSP+' ? 60 : 45) - (y && y < 2026 ? (2026 - y) * 8 : 0);
  for (const k of KEY_TESTS) { const t = tile(c.iihs?.[k]).cls; s += t === 'g' ? 8 : t === 'a' ? 4 : t === 'm' ? 1 : 0; }
  s += (c.nhtsa?.overall || 0) * 3;
  s -= Math.min(10, (c.nhtsa?.recalls || 0) * 0.7);
  return s;
}

// ---------- Views ----------
function overview(list, ctx) {
  const { esc } = ctx;
  const want = new Set(ctx.prefs.want || DEFAULT_WANT);
  const picked = FEATS.filter((f) => want.has(f.k));
  const rows = list.map((x) => {
    const c = x.rec;
    const known = picked.filter((f) => c.feat?.[f.k] !== undefined && c.feat?.[f.k] !== null);
    const hit = picked.filter((f) => has(c.feat?.[f.k]));
    const miss = picked.filter((f) => c.feat?.[f.k] === false || c.feat?.[f.k] === 'optional');
    return { x, c, hit, miss, known, score: safetyScore(c) };
  });
  rows.sort((a, b) => (a.x.mine !== b.x.mine ? (a.x.mine ? -1 : 1) : ui.sort === 'iihs' ? b.score - a.score || b.hit.length - a.hit.length : b.hit.length - a.hit.length || b.score - a.score));
  const allHave = rows.filter((r) => picked.length && r.hit.length === picked.length).length;
  return `
    <div class="s-intro">
      <h2>Safety and features</h2>
      <p>IIHS crash tests and awards first, then the government’s star ratings and recalls, then the equipment on the trim in each deal. Tap what Carol won’t give up.</p>
    </div>
    <div class="s-chips" role="group" aria-label="Must-haves">
      ${FEATS.map((f) => `<button type="button" class="s-chip" data-s="want" data-k="${f.k}" aria-pressed="${want.has(f.k)}">${want.has(f.k) ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"></path></svg>' : ''}${esc(f.label)}</button>`).join('')}
    </div>
    <div class="s-bar">
      <span>${picked.length ? `${allHave} of ${rows.length} have all ${picked.length}` : `${rows.length} cars`}</span>
      <div class="seg-ctl small" role="group" aria-label="Sort">
        <button type="button" data-s="sort" data-k="iihs" aria-pressed="${ui.sort === 'iihs'}">Safest first</button>
        <button type="button" data-s="sort" data-k="match" aria-pressed="${ui.sort === 'match'}">Most must-haves</button>
      </div>
    </div>
    <ol class="s-list">
      ${rows.map(({ x, c, hit, miss }) => {
        const aw = award(c);
        const shortlisted = (ctx.prefs.shortlist || []).includes(c.id);
        return `<li class="s-card${x.mine ? ' mine' : ''}">
          <div class="s-card-top">
            <div class="s-pic">${x.photoHTML}</div>
            <div class="s-id">
              ${ctx.logoHTML(c.make, 'inline')}
              <h3>${esc(x.mine ? `Her ${c.year} ${c.model}` : `${c.make} ${c.model}`)}${shortlisted ? '<span class="s-flag">Shortlisted</span>' : ''}</h3>
              <small>${esc(x.sub)}</small>
            </div>
          </div>
          <div class="s-safety">
            <div class="s-award ${aw.cls}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v6c0 4.2-3 7.6-7 9-4-1.4-7-4.8-7-9V6z"></path></svg><span><small>IIHS</small>${esc(aw.short)}</span></div>
            <div class="s-tiles" aria-label="Key IIHS tests">${KEY_TESTS.map((k) => `<span class="s-t">${tileHTML(c.iihs?.[k], esc)}<small>${SHORT[k]}</small></span>`).join('')}</div>
          </div>
          <dl class="s-meta">
            <div><dt>NHTSA</dt><dd>${c.pending ? '<span class="soft">Loading…</span>' : stars(c.nhtsa?.overall)}</dd></div>
            <div><dt>Recalls</dt><dd>${c.nhtsa?.recalls ?? '–'}</dd></div>
            <div><dt>Reviewers</dt><dd>${c.review?.scoreN ? `${c.review.scoreN}<small>/10</small>` : '–'}</dd></div>
          </dl>
          ${picked.length ? `<div class="s-match">
            <div><b>${hit.length} of ${picked.length} must-haves</b><span>${miss.length ? `No ${esc(miss.map((f) => f.label.toLowerCase()).slice(0, 2).join(', '))}${miss.length > 2 ? '…' : ''}` : hit.length === picked.length ? 'Has them all' : c.researched ? 'Some unconfirmed' : 'Equipment not checked'}</span></div>
            <div class="s-meter" aria-hidden="true"><i style="width:${Math.round((hit.length / picked.length) * 100)}%"></i></div>
          </div>` : ''}
          <div class="s-actions">
            <button type="button" class="btn small ghost" data-s="tests" data-k="${esc(c.id)}">Crash tests</button>
            ${x.mine ? '' : `<button type="button" class="btn small ghost" data-s="h2h" data-k="${esc(c.id)}">Compare with her Edge</button>`}
          </div>
        </li>`;
      }).join('')}
    </ol>
    ${sourcesHTML(ctx)}`;
}

const LINES = [
  { h: 'IIHS crash tests' },
  { label: 'IIHS award', v: (c) => (c.iihs?.unchecked ? null : c.iihs?.award ? (c.iihs.award === 'TSP+' ? 2 : 1) * 10 - (2026 - (c.iihs.awardYear || 2026)) : 0), f: (c) => award(c).short },
  ...IIHS_TESTS.slice(0, 5).map(([k, label]) => ({ label: label.replace(' (trim in the deal)', '').replace(', updated (rear passenger)', ' (rear seat)'), v: (c) => (c.iihs?.unchecked ? null : 'npmag'.indexOf(tile(c.iihs?.[k]).cls)), f: (c) => (c.iihs?.unchecked ? '–' : tile(c.iihs?.[k]).word) })),
  { h: 'Government tests and recalls' },
  { label: 'NHTSA overall', v: (c) => c.nhtsa?.overall ?? null, f: (c) => (c.nhtsa?.overall ? `${c.nhtsa.overall} stars` : 'Not rated') },
  { label: 'Recalls, this model year', v: (c) => c.nhtsa?.recalls ?? null, f: (c) => (c.nhtsa?.recalls ?? '–'), less: true },
  { h: 'Driver assistance' },
  { feat: 'assist', k: 'pedestrianAEB', label: 'Pedestrian emergency braking' },
  { feat: 'assist', k: 'adaptiveCruiseStopGo', label: 'Stop-and-go cruise' },
  { feat: 'assist', k: 'laneCentering', label: 'Lane centering' },
  { feat: 'feat', k: 'handsFree', label: 'Hands-free highway driving' },
  { feat: 'feat', k: 'camera360', label: '360° camera' },
  { h: 'Comfort and tech' },
  { label: 'Center screen', v: (c) => parseFloat(c.specs?.screen) || null, f: (c) => c.specs?.screen || '–' },
  { feat: 'feat', k: 'wirelessCarPlay', label: 'Wireless CarPlay' },
  { feat: 'feat', k: 'heatedSeats', label: 'Heated seats' },
  { feat: 'feat', k: 'ventilatedSeats', label: 'Cooled seats' },
  { feat: 'feat', k: 'heatedWheel', label: 'Heated wheel' },
  { feat: 'feat', k: 'handsFreeLiftgate', label: 'Hands-free liftgate' },
  { feat: 'feat', k: 'panoramicRoof', label: 'Panoramic roof' },
  { h: 'Space and driving' },
  { label: 'Cargo behind rear seat', v: (c) => c.specs?.cargo ?? null, f: (c) => (c.specs?.cargo ? `${c.specs.cargo} cu ft` : '–') },
  { label: 'Seats', v: () => null, f: (c) => c.specs?.seating ?? '–' },
  { feat: 'feat', k: 'awd', label: 'All-wheel drive' },
  { label: 'Horsepower', v: (c) => c.specs?.hp ?? null, f: (c) => (c.specs?.hp ? `${c.specs.hp} hp` : '–') },
  { label: 'Combined mpg', v: (c) => c.specs?.mpg ?? null, f: (c) => (c.specs?.mpg ? `${c.specs.mpg} mpg` : '–') },
  { label: 'Towing', v: (c) => c.specs?.tow ?? null, f: (c) => (c.specs?.tow ? `${c.specs.tow.toLocaleString()} lb` : '–') },
  { h: 'Ownership' },
  { label: 'Factory warranty', v: () => null, f: (c) => c.warranty || '–' },
  { label: 'Reviewer score', v: (c) => c.review?.scoreN ?? null, f: (c) => (c.review?.scoreN ? `${c.review.scoreN}/10` : '–') },
];

function headToHead(list, ctx) {
  const { esc } = ctx;
  const mine = list.find((x) => x.mine);
  const others = list.filter((x) => !x.mine);
  if (!mine || !others.length) return '<p class="s-empty">Add some cars on the Compare tab to see them side by side.</p>';
  const n = others.length, i = ((ui.h2h % n) + n) % n, o = others[i];
  const A = mine.rec, B = o.rec;
  const gains = [], losses = [];
  const rows = LINES.map((L) => {
    if (L.h) return `<tr class="h"><th colspan="3" scope="colgroup">${esc(L.h)}</th></tr>`;
    let a, b, va, vb;
    if (L.feat) {
      const x = A[L.feat]?.[L.k], y = B[L.feat]?.[L.k];
      a = L.k === 'handsFree' && A.feat?.handsFreeName && has(x) ? A.feat.handsFreeName : featWord(x);
      b = L.k === 'handsFree' && B.feat?.handsFreeName && has(y) ? B.feat.handsFreeName : featWord(y);
      va = x == null ? null : lvl(x); vb = y == null ? null : lvl(y);
    } else { a = L.f(A); b = L.f(B); va = L.v(A); vb = L.v(B); }
    let better = 0;
    if (va != null && vb != null && va !== vb) better = (L.less ? va < vb : va > vb) ? -1 : 1;
    if (better === 1) gains.push(L.feat && !lvl(A[L.feat]?.[L.k]) ? L.label : `${L.label}: ${b}`);
    if (better === -1) losses.push(L.feat && !lvl(B[L.feat]?.[L.k]) ? L.label : `${L.label}: ${b}`);
    return `<tr><th scope="row">${esc(L.label)}</th><td class="${better === -1 ? 'win' : ''}">${esc(a)}</td><td class="${better === 1 ? 'win' : ''}">${esc(b)}</td></tr>`;
  }).join('');
  const li = (xs, sign) => (xs.length ? `<ul>${xs.slice(0, 7).map((g) => `<li><span aria-hidden="true">${sign}</span>${esc(g)}</li>`).join('')}</ul>` : '<p class="soft">Nothing on this list.</p>');
  return `
    <section class="s-pick" aria-label="Pick a car">
      <button type="button" class="icon-btn" data-s="h2hstep" data-k="-1" aria-label="Previous car"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"></path></svg></button>
      <div class="s-pair" data-swipe="h2hstep">
        <figure><div class="s-pic">${mine.photoHTML}</div>${ctx.logoHTML(A.make, 'inline')}<figcaption><b>Her ${esc(A.model)}</b><small>${esc(mine.sub)}</small></figcaption></figure>
        <span class="vs" aria-hidden="true">vs</span>
        <figure><div class="s-pic">${o.photoHTML}</div>${ctx.logoHTML(B.make, 'inline')}<figcaption><b>${esc(B.make)} ${esc(B.model)}</b><small>${esc(o.sub)}</small></figcaption></figure>
      </div>
      <button type="button" class="icon-btn" data-s="h2hstep" data-k="1" aria-label="Next car"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"></path></svg></button>
      <p class="s-pos">${i + 1} of ${n} · swipe to change</p>
    </section>
    ${sideBySide(mine, o, ctx)}
    <section class="s-gl">
      <div><h3>What she’d gain</h3>${li(gains, '+')}</div>
      <div class="lose"><h3>What she’d give up</h3>${li(losses, '−')}</div>
    </section>
    ${B.note || A.note ? `<p class="s-note">${esc(B.note || '')}</p>` : ''}
    <div class="s-table-wrap"><table class="s-table">
      <thead><tr><th scope="col"><span class="sr-only">Item</span></th><th scope="col">Her ${esc(A.model)}</th><th scope="col">${esc(B.model)}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="fine">Bold is the better of the two. Equipment is for the trim in each deal; options cost extra.</p>
    ${sourcesHTML(ctx)}`;
}

function crashTests(list, ctx) {
  const { esc } = ctx;
  const id = ui.tests && list.some((x) => x.rec.id === ui.tests) ? ui.tests : (list.find((x) => !x.mine) || list[0]).rec.id;
  const x = list.find((y) => y.rec.id === id);
  const c = x.rec;
  const aw = award(c);
  const n = c.nhtsa || {};
  return `
    <div class="s-chips scroll" role="group" aria-label="Car">
      ${list.map((y) => `<button type="button" class="s-chip" data-s="tests" data-k="${esc(y.rec.id)}" aria-pressed="${y.rec.id === id}">${esc(y.mine ? `Her ${y.rec.model}` : `${y.rec.make} ${y.rec.model}`)}</button>`).join('')}
    </div>
    <section class="s-hero">
      <div class="s-stage">${x.photoHTML}</div>
      ${ctx.logoHTML(c.make, 'inline')}
      <h2>${esc(c.name)}</h2>
      <div class="s-award big ${aw.cls}"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v6c0 4.2-3 7.6-7 9-4-1.4-7-4.8-7-9V6z"></path><path d="M9 12l2 2 4-4" stroke-linecap="round"></path></svg><span>${esc(aw.long)}</span></div>
      ${c.note ? `<p class="s-note">${esc(c.note)}</p>` : ''}
      ${c.yearNote ? `<p class="s-note">${esc(c.yearNote)}</p>` : ''}
    </section>
    <section class="s-box s-sec">
      <div class="s-sec-h"><h3>IIHS crash tests</h3><a href="${esc(c.iihs?.url || 'https://www.iihs.org/ratings')}" target="_blank" rel="noopener">iihs.org</a></div>
      ${c.iihs?.unchecked ? `<p class="soft">IIHS results haven’t been checked for this car. Look it up at <a href="https://www.iihs.org/ratings" target="_blank" rel="noopener">iihs.org/ratings</a>.</p>` : `
      <ul class="s-tests">${IIHS_TESTS.map(([k, label]) => `<li>${tileHTML(c.iihs?.[k], esc, true)}<span>${esc(label)}</span><small>${esc(tile(c.iihs?.[k]).word)}</small></li>`).join('')}</ul>
      <p class="s-legend"><span>${tileHTML('G', esc)} Good</span><span>${tileHTML('A', esc)} Acceptable</span><span>${tileHTML('M', esc)} Marginal</span><span>${tileHTML('P', esc)} Poor</span></p>`}
    </section>
    <section class="s-box s-sec">
      <div class="s-sec-h"><h3>Government crash tests</h3><a href="${esc(n.url || 'https://www.nhtsa.gov/ratings')}" target="_blank" rel="noopener">nhtsa.gov</a></div>
      <p class="s-big-stars">${c.pending ? '<span class="soft">Loading…</span>' : stars(n.overall)} <small>${n.overall ? `${n.overall} of 5 overall` : 'No overall rating for this year'}</small></p>
      <dl class="s-nh">
        <div><dt>Front</dt><dd>${stars(n.frontal)}</dd></div>
        <div><dt>Side</dt><dd>${stars(n.side)}</dd></div>
        <div><dt>Rollover</dt><dd>${stars(n.rollover)}</dd></div>
      </dl>
      ${n.rolloverRiskPct ? `<p class="soft">Rollover risk in a single-vehicle crash: ${n.rolloverRiskPct}%.</p>` : ''}
    </section>
    <section class="s-box s-sec">
      <div class="s-sec-h"><h3>Recalls</h3><b>${n.recalls ?? '–'}</b></div>
      ${(n.recallTopics || []).length ? `<ul class="s-recalls">${n.recallTopics.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : `<p class="soft">${n.recalls === 0 ? 'None listed for this model year.' : 'No details loaded.'}</p>`}
      <p class="soft">A specific car’s open recalls show up by VIN at <a href="https://www.nhtsa.gov/recalls" target="_blank" rel="noopener">nhtsa.gov/recalls</a>. Check before signing.</p>
    </section>`;
}

function reviews(list, ctx) {
  const { esc } = ctx;
  const n = list.length, i = ((ui.rev % n) + n) % n, x = list[i], c = x.rec, r = c.review || {};
  const sl = ctx.prefs.shortlist || [];
  const on = sl.includes(c.id);
  const all = [...list].sort((a, b) => (b.rec.review?.scoreN || 0) - (a.rec.review?.scoreN || 0));
  return `
    <div class="s-bar"><h2>What reviewers say</h2><span>${i + 1} of ${n}</span></div>
    <div class="s-deck">
      <article class="s-rev" data-swipe="revstep">
        <div class="s-stage">${x.photoHTML}</div>
        <div class="s-rev-b">
          <div class="s-rev-h">
            <div>${ctx.logoHTML(c.make, 'inline')}<h3>${esc(x.mine ? `Her ${c.year} ${c.model}` : c.name)}</h3></div>
            <div class="s-score"><b>${r.scoreN ?? '–'}</b><small>${r.scoreN ? `out of 10 · ${esc(r.source || '')}` : 'No score found'}</small></div>
          </div>
          ${r.verdict ? `<p class="s-verdict">${esc(r.verdict)}</p>` : '<p class="soft">No review loaded for this car yet.</p>'}
          ${(r.pros || []).length || (r.cons || []).length ? `<div class="s-pc">
            <div><h4>Liked</h4><ul>${(r.pros || []).map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>
            <div class="lose"><h4>Didn’t like</h4><ul>${(r.cons || []).map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>
          </div>` : ''}
          ${c.reliability ? `<p class="soft">${esc(c.reliability)}</p>` : ''}
          ${r.url ? `<p><a href="${esc(r.url)}" target="_blank" rel="noopener">Read the full review</a></p>` : ''}
        </div>
        <div class="s-rev-act">
          <button type="button" class="btn" data-s="revstep" data-k="-1">Previous</button>
          <button type="button" class="btn ${on ? '' : 'primary'}" data-s="shortlist" data-k="${esc(c.id)}" aria-pressed="${on}">${on ? 'Shortlisted' : 'Shortlist'}</button>
          <button type="button" class="btn" data-s="revstep" data-k="1">Next</button>
        </div>
      </article>
    </div>
    <section class="s-box s-sec">
      <h3>All scores</h3>
      <ol class="s-scores">${all.map((y) => `<li>${ctx.logoHTML(y.rec.make, 'inline')}<span>${esc(y.mine ? `Her ${y.rec.model}` : `${y.rec.make} ${y.rec.model}`)}${sl.includes(y.rec.id) ? ' <small>· Shortlisted</small>' : ''}</span><b>${y.rec.review?.scoreN ?? '–'}</b></li>`).join('')}</ol>
    </section>
    ${sourcesHTML(ctx)}`;
}

function sourcesHTML() {
  return `<p class="fine">Crash tests from <a href="https://www.iihs.org/ratings" target="_blank" rel="noopener">IIHS</a> and <a href="https://www.nhtsa.gov/ratings" target="_blank" rel="noopener">NHTSA</a>; equipment from each maker’s trim pages; reviews from Edmunds. Checked ${DATA?.updated || ''}. “Unconfirmed” means sources disagreed or didn’t say.</p>`;
}

// ---------- Entry point ----------
// ctx: { current, candidates, prefs, save, rerender, api, esc, logoHTML, photoHTML(car), sub(car) }
export function renderSafety(el, ctx) {
  if (!DATA) { el.innerHTML = '<p class="s-empty">Loading safety data…</p>'; loadSafety().then(() => ctx.rerender()); return; }
  const seen = new Set();
  const list = [];
  const add = (car, mine) => {
    if (!car?.make || !car?.model) return;
    const k = `${norm(car.make)}|${norm(car.model)}`;
    if (seen.has(k)) return;
    seen.add(k);
    const rec = recordFor(car, ctx);
    list.push({ mine, car, rec, photoHTML: ctx.photoHTML(car, mine), sub: ctx.sub(car, mine, rec) });
  };
  add(ctx.current, true);
  for (const c of ctx.candidates) add(c, false);
  if (!list.length) { el.innerHTML = '<p class="s-empty">Add your car on the Your car tab to see safety ratings.</p>'; return; }
  const views = [['overview', 'Overview'], ['spin', '360°'], ['h2h', 'Head to head'], ['tests', 'Crash tests'], ['reviews', 'Reviews']];
  const body = ui.view === 'h2h' ? headToHead(list, ctx) : ui.view === 'spin' ? spinView(list, ctx) : ui.view === 'tests' ? crashTests(list, ctx) : ui.view === 'reviews' ? reviews(list, ctx) : overview(list, ctx);
  el.innerHTML = `
    <nav class="seg-ctl s-views" aria-label="Safety views">${views.map(([k, l]) => `<button type="button" data-s="view" data-k="${k}" aria-pressed="${ui.view === k}">${l}</button>`).join('')}</nav>
    <div class="s-body">${body}</div>
    <dialog class="g-zoom" id="gZoom"><img alt=""><button type="button" class="icon-btn" data-close aria-label="Close"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg></button></dialog>`;
  wire(el, ctx, list);
  trackSpinLoad(el);
}

// Show progress until every walkaround frame has loaded, so dragging never shows a blank.
function trackSpinLoad(el) {
  const box = el.querySelector('.g-spin');
  if (!box) return;
  const imgs = [...box.querySelectorAll('img')];
  const label = box.querySelector('.g-load');
  const update = () => {
    const done = imgs.filter((i) => i.complete).length;
    if (done >= imgs.length) { box.classList.add('ready'); return; }
    if (label) label.textContent = `Loading the walkaround… ${done} of ${imgs.length}`;
  };
  imgs.forEach((i) => { i.addEventListener('load', update, { once: true }); i.addEventListener('error', update, { once: true }); });
  update();
}

function wire(el, ctx, list) {
  if (el.dataset.wired) { el._ctx = ctx; el._list = list; return; }
  el.dataset.wired = '1'; el._ctx = ctx; el._list = list;
  const others = () => el._list.filter((x) => !x.mine);
  const act = (s, k) => {
    const c = el._ctx;
    if (s === 'view') ui.view = k;
    else if (s === 'sort') ui.sort = k;
    else if (s === 'want') { const w = new Set(c.prefs.want || DEFAULT_WANT); w.has(k) ? w.delete(k) : w.add(k); c.prefs.want = [...w]; c.save(); }
    else if (s === 'tests') { ui.tests = k; ui.view = 'tests'; }
    else if (s === 'h2h') { ui.h2h = Math.max(0, others().findIndex((x) => x.rec.id === k)); ui.view = 'h2h'; }
    else if (s === 'h2hstep') ui.h2h += Number(k);
    else if (s === 'revstep') ui.rev += Number(k);
    else if (s === 'spin') { if (ui.spin !== k) ui.frame = 0; ui.spin = k; ui.view = 'spin'; }
    else if (s === 'cat') { ui.cat = k; ui.sbs = { a: 0, b: 0 }; }
    else if (s === 'sbs') ui.sbs[k] += 1;
    else if (s === 'zoom') { const d = el.querySelector('#gZoom'); d.querySelector('img').src = k; d.showModal(); return; }
    else if (s === 'shortlist') { const sl = new Set(c.prefs.shortlist || []); sl.has(k) ? sl.delete(k) : sl.add(k); c.prefs.shortlist = [...sl]; c.save(); }
    c.rerender();
    if (['view', 'tests', 'h2h'].includes(s)) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (b && el.contains(b) && b.tagName === 'BUTTON') act(b.dataset.s, b.dataset.k);
  });
  // Swipe left/right on the head-to-head pair and the review card.
  let start = null;
  el.addEventListener('pointerdown', (e) => {
    const sp = e.target.closest('[data-spin]');
    if (sp) { e.preventDefault(); spin = { x: e.clientX, f: ui.frame, n: Number(sp.dataset.spin), el: sp }; sp.setPointerCapture?.(e.pointerId); return; }
    const t = e.target.closest('[data-swipe]'); if (t) start = { x: e.clientX, y: e.clientY, s: t.dataset.swipe };
  });
  // The walkaround: dragging scrubs frames without re-rendering, so it stays smooth.
  let spin = null;
  const show = (root, f) => {
    const imgs = root.querySelectorAll('.g-spin img');
    imgs.forEach((im, i) => im.classList.toggle('on', i === f));
    const r = root.querySelector('[data-range]'); if (r) r.value = f;
    ui.frame = f;
  };
  el.addEventListener('pointermove', (e) => {
    if (!spin || !spin.n) return;
    const f = (((spin.f - Math.round((e.clientX - spin.x) / 36)) % spin.n) + spin.n) % spin.n;
    if (f !== ui.frame) show(el, f);
  });
  el.addEventListener('pointercancel', () => { spin = null; });
  el.addEventListener('input', (e) => { if (e.target.matches('[data-range]')) show(el, Number(e.target.value)); });
  el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) e.target.closest('dialog')?.close(); if (e.target.matches('dialog.g-zoom')) e.target.close(); });
  el.addEventListener('pointerup', (e) => {
    if (spin) { spin = null; return; }
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) act(start.s, dx < 0 ? 1 : -1);
    start = null;
  });
}

// ---------- Compare: up to three side by side (Compare tab) ----------
// ctx: as renderSafety, plus costFor(car, mine) -> { monthly, how } from the live analysis, and openSafety(view, id).
function buildList(ctx) {
  const seen = new Set(), list = [];
  const add = (car, mine) => {
    if (!car?.make || !car?.model) return;
    // A Leasehackr deal is its own option even when the same model is already on the list.
    const k = car.pnd ? `pnd:${car.pnd}` : `${norm(car.make)}|${norm(car.model)}`;
    if (seen.has(k)) return;
    seen.add(k);
    const rec = recordFor(car, ctx);
    const key = mine ? 'mine' : car.pnd ? car.id : rec.id;
    const label = mine ? `Her ${rec.year} ${rec.model}` : `${car.make} ${car.model}${car.pnd ? ' deal' : ''}`;
    list.push({ mine, car, rec, key, label, photoHTML: ctx.photoHTML(car, mine), sub: ctx.sub(car, mine, rec), cost: ctx.costFor ? ctx.costFor(car, mine) : null });
  };
  add(ctx.current, true);
  for (const c of ctx.candidates) add(c, false);
  return list;
}

const CLIMATE = { physical: 3, mixed: 2, touchscreen: 1 };
const capWord = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '–');
function c3Rows(want) {
  const tileRow = (k, label) => ({ label, cell: (c) => ({ tile: c.iihs?.unchecked ? null : c.iihs?.[k] ?? null, t: c.iihs?.unchecked ? 'Not checked' : tile(c.iihs?.[k]).word, v: c.iihs?.unchecked ? null : 'npmag'.indexOf(tile(c.iihs?.[k]).cls) }) });
  const dimRow = (k, label, unit, opts = {}) => ({ label, ...opts, cell: (c, edge) => {
    const v = c.dims?.[k];
    if (v == null) return { t: '–', v: null };
    const d = edge && !opts.mineRow && edge.dims?.[k] != null ? Math.round((v - edge.dims[k]) * 10) / 10 : null;
    return { t: `${v} ${unit}`, small: d ? `${d > 0 ? '+' : '−'}${Math.abs(d)} vs. Edge` : '', v };
  } });
  return [
    { h: 'Cost' },
    { label: 'A month', less: true, cell: (c, _e, x) => (x.cost?.monthly ? { t: `$${Math.round(x.cost.monthly).toLocaleString()}`, v: x.cost.monthly } : { t: 'Price it on Compare', v: null }) },
    { label: 'How', neutral: true, cell: (c, _e, x) => ({ t: x.cost?.how || '–', v: null, small: '' }) },
    { h: 'Safety, IIHS first' },
    { label: 'IIHS award', cell: (c) => ({ t: award(c).short, v: c.iihs?.unchecked ? null : c.iihs?.award ? (c.iihs.award === 'TSP+' ? 20 : 10) - (2026 - (c.iihs.awardYear || 2026)) : 0 }) },
    tileRow('smallOverlapDriver', 'Small overlap front, driver'),
    tileRow('sideUpdated', 'Side crash, updated test'),
    tileRow('moderateOverlapUpdated', 'Front crash, rear seat'),
    tileRow('headlights', 'Headlights'),
    { label: 'NHTSA overall', cell: (c) => ({ stars: c.nhtsa?.overall || 0, t: c.nhtsa?.overall ? '' : 'Not rated', v: c.nhtsa?.overall ?? null }) },
    { label: 'Recalls this model year', less: true, cell: (c) => ({ t: c.nhtsa?.recalls ?? '–', v: c.nhtsa?.recalls ?? null }) },
    { h: 'Her must-haves' },
    ...FEATS.filter((f) => want.has(f.k)).map((f) => ({ label: f.label, cell: (c) => { const v = c.feat?.[f.k]; return { t: has(v) ? '✓' : v === 'optional' ? 'Option' : v === false ? '–' : '?', v: v == null ? null : lvl(v), aria: featWord(v) }; } })),
    { h: 'Size and feel' },
    dimRow('lengthIn', 'Length', 'in', { neutral: true }),
    dimRow('heightIn', 'Height', 'in', { neutral: true }),
    dimRow('cargoBehind2ndCuFt', 'Cargo behind rear seat', 'cu ft'),
    dimRow('turningCircleFt', 'Turning circle', 'ft', { less: true }),
    { label: 'Climate controls', cell: (c) => ({ t: capWord(c.ease?.climateControls), v: CLIMATE[c.ease?.climateControls] ?? null }) },
    { h: 'Reviews' },
    { label: 'Reviewer score', cell: (c) => ({ t: c.review?.scoreN ? `${c.review.scoreN}/10` : '–', v: c.review?.scoreN ?? null }) },
  ];
}

export function renderCompare3(el, ctx) {
  if (!el) return;
  if (!DATA) { el.innerHTML = ''; loadSafety().then(() => ctx.rerender()); return; }
  const { esc } = ctx;
  const list = buildList(ctx);
  const mine = list.find((x) => x.mine);
  const others = list.filter((x) => !x.mine);
  if (!mine || !others.length) { el.innerHTML = ''; return; }
  let picks = (ctx.prefs.compare || []).filter((id) => others.some((x) => x.key === id));
  if (!picks.length) picks = others.slice(0, 2).map((x) => x.key);
  const cols = [mine, ...picks.map((id) => others.find((x) => x.key === id))].filter(Boolean);
  const want = new Set(ctx.prefs.want || DEFAULT_WANT);
  const rows = c3Rows(want).map((R) => {
    if (R.h) return `<div class="c3-h" role="row"><span role="columnheader">${esc(R.h)}</span></div>`;
    const cells = cols.map((x) => R.cell(x.rec, mine.rec, x));
    const nums = cells.map((c) => c.v).filter((v) => v != null && v >= 0);
    const spread = nums.length > 1 && Math.max(...nums) !== Math.min(...nums);
    const best = R.neutral || !spread ? null : R.less ? Math.min(...nums) : Math.max(...nums);
    return `<div class="c3-row" role="row">
      <span class="c3-label" role="rowheader">${esc(R.label)}</span>
      ${cells.map((c) => `<span class="c3-cell${best != null && c.v === best ? ' win' : ''}" role="cell"${c.aria ? ` aria-label="${esc(c.aria)}"` : ''}>${c.tile !== undefined ? tileHTML(c.tile, esc) : ''}${c.stars ? stars(c.stars) : ''}<span>${esc(c.t)}</span>${c.small ? `<small>${esc(c.small)}</small>` : ''}</span>`).join('')}
    </div>`;
  }).join('');
  el.innerHTML = `
    <div class="c3-intro"><h2>Up to three, side by side</h2><p>Her Edge stays first. Pick two more.</p></div>
    <div class="s-chips scroll" role="group" aria-label="Cars to compare">
      ${others.map((x) => { const on = picks.includes(x.key); return `<button type="button" class="s-chip" data-c3="pick" data-k="${esc(x.key)}" aria-pressed="${on}">${on ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"></path></svg>' : ''}${esc(x.label)}</button>`; }).join('')}
    </div>
    <div class="c3-table" role="table" aria-label="Side by side comparison" style="--cols:${cols.length}">
      <div class="c3-top" role="row">
        <span class="sr-only" role="columnheader">Item</span>
        ${cols.map((x) => `<div class="c3-car" role="columnheader"><div class="s-pic">${x.photoHTML}</div>${ctx.logoHTML(x.rec.make, 'inline')}<b>${esc(x.mine ? `Her ${x.rec.year} ${x.rec.model}` : `${x.car.make} ${x.car.model}`)}</b>${x.car.pnd ? '<small class="c3-tag">Leasehackr deal</small>' : ''}</div>`).join('')}
      </div>
      ${rows}
      <div class="c3-row c3-links" role="row">
        <span class="c3-label" role="rowheader">See more</span>
        ${cols.map((x) => `<span class="c3-cell" role="cell"><button type="button" class="btn small ghost" data-c3="spin" data-k="${esc(x.rec.id)}">360°</button><button type="button" class="btn small ghost" data-c3="tests" data-k="${esc(x.rec.id)}">Crash tests</button></span>`).join('')}
      </div>
    </div>
    <p class="fine">Bold is the best of the ${cols.length}. Monthly is what the app works out on the Options tab for the period in Settings; equipment is for the trim in each deal.</p>`;
  if (!el.dataset.wired) {
    el.dataset.wired = '1';
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-c3]');
      if (!b) return;
      const c = el._ctx, k = b.dataset.k;
      if (b.dataset.c3 === 'pick') {
        const cur = (c.prefs.compare || []).filter((id) => el._others.includes(id));
        const p = cur.length ? cur : el._picks.slice();
        const i = p.indexOf(k);
        if (i >= 0) p.splice(i, 1); else { p.push(k); if (p.length > 2) p.shift(); }
        c.prefs.compare = p; c.save(); c.rerender();
      } else if (b.dataset.c3 === 'spin') { ui.spin = k; ui.frame = 0; ui.view = 'spin'; c.openSafety(); }
      else if (b.dataset.c3 === 'tests') { ui.tests = k; ui.view = 'tests'; c.openSafety(); }
    });
  }
  el._ctx = ctx; el._others = others.map((x) => x.key); el._picks = picks;
}
