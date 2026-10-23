// Incentive stacking: who qualifies for each manufacturer offer, what it can't be combined
// with, and the best legal combination for one household. Pure functions, shared by the app
// and the tests.

export const FAMILIES = {
  ford: ['ford', 'lincoln', 'mercury'],
  gm: ['chevrolet', 'gmc', 'buick', 'cadillac', 'pontiac', 'saturn', 'hummer'],
  stellantis: ['jeep', 'ram', 'dodge', 'chrysler', 'fiat', 'alfa romeo', 'maserati'],
  toyota: ['toyota', 'lexus', 'scion'],
  honda: ['honda', 'acura'],
  nissan: ['nissan', 'infiniti'],
  hyundai: ['hyundai'],
  genesis: ['genesis'],
  kia: ['kia'],
  vw: ['volkswagen', 'audi'],
  bmw: ['bmw', 'mini'],
  mercedes: ['mercedes-benz'],
  volvo: ['volvo', 'polestar', 'saab'],
  mazda: ['mazda'],
  subaru: ['subaru'],
  mitsubishi: ['mitsubishi'],
  tesla: ['tesla'],
  porsche: ['porsche'],
  jlr: ['land rover', 'jaguar'],
};
const ALIAS = { chevy: 'chevrolet', mercedes: 'mercedes-benz', 'mercedes benz': 'mercedes-benz', vw: 'volkswagen', landrover: 'land rover', 'land-rover': 'land rover', alfa: 'alfa romeo' };
const ALL_MAKES = Object.values(FAMILIES).flat();
export const normMake = (m) => { const k = String(m || '').trim().toLowerCase(); return ALIAS[k] || k; };
export const familyOf = (make) => { const m = normMake(make); return Object.keys(FAMILIES).find((f) => FAMILIES[f].includes(m)) || m; };
const sameFamily = (a, b) => familyOf(a) === familyOf(b);
const cap = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

// Makes named in the parts of the text that talk about owning or leasing.
function namedMakes(text) {
  const found = new Set();
  const frags = String(text).match(/[^.;]*\b(own|owner|owners|ownership|lease|leases|lessee|lessees|leasing|registered|conquest|competitive)\b[^.;]*/gi) || [];
  for (const f of frags) {
    for (const m of ALL_MAKES) {
      const re = new RegExp(`\\b${m.replace(/[-\s]/g, '[-\\s]?')}\\b`, 'i');
      if (re.test(f)) found.add(m);
    }
    if (/\bchevy\b/i.test(f)) found.add('chevrolet');
    if (/\bmercedes\b/i.test(f)) found.add('mercedes-benz');
  }
  return [...found];
}

// What the research found (fall 2026) about each brand's programs. Conquest lists name the
// makes you must own or lease; null = any competing make (verify).
const LUXURY = ['lexus', 'acura', 'infiniti', 'bmw', 'mercedes-benz', 'audi', 'cadillac', 'lincoln', 'volvo', 'land rover', 'jaguar', 'porsche', 'tesla', 'genesis'];
export const BRAND_RULES = {
  ford: { cashOrApr: 'varies', conquestMakes: 'non-family', privateVsPlan: true },
  lincoln: { cashOrApr: true, conquestMakes: 'non-family' },
  chevrolet: { conquestMakes: 'non-family' }, gmc: { conquestMakes: 'non-family' }, buick: { conquestMakes: 'non-family' }, cadillac: { conquestMakes: 'non-family' },
  toyota: { cashOrApr: true, conquestMakes: [] },
  lexus: { cashOrApr: true },
  honda: { conquestMakes: 'non-family' },
  acura: { cashOrApr: true },
  nissan: { cashOrApr: 'varies' },
  genesis: { conquestMakes: [...LUXURY.filter((m) => m !== 'genesis'), 'toyota', 'nissan', 'honda', 'hyundai'] },
  kia: { conquestMakes: LUXURY },
  mazda: { conquestMakes: [] },
  volkswagen: { cashOrApr: true },
  audi: { cashOrApr: true },
};

const offerKind = (o) => (o.type === 'lease' ? 'lease' : o.type === 'finance' ? 'finance' : 'cash');
const programs = (text) => [...new Set((String(text).match(/(?:#|PGM\s*#?|program\s*#?)\s?(\d{4,6})/gi) || []).map((x) => x.replace(/\D/g, '')))];

// What kind of offer this is and what it can't be combined with.
export function classify(o) {
  const generic = !o.title || /^(cash|cash back|public offers|offer|incentive)s?$/i.test(String(o.title).trim());
  const head = `${o.title || ''} ${o.group || ''} ${generic ? String(o.text || o.disclaimer || '').slice(0, 160) : ''}`;
  const text = `${head} ${o.text || o.disclaimer || ''}`;
  const kind = offerKind(o);
  let affinity = null;
  if (/military|veteran|armed forces|active duty/i.test(head) || (/military|veteran/i.test(o.group || ''))) affinity = 'military';
  else if (/first responder|nurse|police|firefighter|\bems\b|emt/i.test(head)) affinity = 'first-responder';
  else if (/college|graduate|\bgrad\b|student/i.test(head)) affinity = 'college';
  else if (/costco/i.test(head)) affinity = 'costco';
  else if (/farm bureau/i.test(head)) affinity = 'farm-bureau';
  else if (/mobility/i.test(head)) affinity = 'mobility';
  else if (/educator|teacher/i.test(head)) affinity = 'educator';
  else if (/business|fleet|commercial/i.test(head)) affinity = 'business';
  const returning = !affinity && /returning lessee|lease loyalty|rcl renewal|\brenewal\b|lease[- ]end|coming out of an? [^.]{0,40}lease|terminated a lease/i.test(text);
  const conquest = !affinity && /conquest|competitive|competitor/i.test(head);
  const loyalty = !affinity && !conquest && /loyal|owners?\b|lessees?\b/i.test(head);
  const makes = affinity ? [] : namedMakes(o.group ? `${o.group}. ${o.title || ''}` : text);
  let audience = affinity ? 'affinity' : returning ? 'returning' : conquest ? 'conquest' : loyalty ? 'loyalty' : 'public';
  // A "loyalty" offer for owners of a different brand is really a conquest offer.
  if (audience === 'loyalty' && o.make && makes.length && makes.every((m) => !sameFamily(m, o.make))) audience = 'conquest';

  const excludes = new Set();
  const nots = String(text).match(/(?:not (?:be )?(?:compatible|combinable|combined|available|eligible)|cannot be (?:combined|used)|may not be (?:used|combined)|excludes?|in lieu of)[^.;]{0,140}/gi) || [];
  for (const n of nots) {
    if (/\bAPR\b|financ|special lease|subvent|promo/i.test(n)) excludes.add('special-apr');
    if (/private offer|\bVPP\b|A\/?Z|X-?Plan|employee|supplier|partner/i.test(n)) excludes.add('private');
    if (/loyal/i.test(n)) excludes.add('loyalty');
    if (/conquest|competitive|competitor/i.test(n)) excludes.add('conquest');
    if (/military|college|grad|first responder|affinity|\bVPP\b/i.test(n)) excludes.add('affinity');
  }
  if (o.noSpecialApr) excludes.add('special-apr');
  // Brands where retail cash is "cash OR special APR/lease".
  const rule = BRAND_RULES[normMake(o.make)] || {};
  if (kind === 'cash' && rule.cashOrApr === true && audience === 'public' && !/with (?:special |promo\w* )?APR|APR bonus|finance cash|bonus cash/i.test(head)) excludes.add('special-apr');
  const titleKey = String(o.title && !generic ? o.title : `${o.group || ''} ${String(o.text || '').slice(0, 60)}`)
    .toLowerCase().replace(/\$[\d,]+|\b20\d\d\b|\d+/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const needsCaptive = !!o.requiresCaptive || /must (?:be )?(?:financed?|leased?)[^.]{0,60}(?:through|with|via)|financed or leased through|when financed through|through (?:ford credit|lincoln (?:afs|automotive financial)|nmac|infiniti financial|hmf|hyundai motor finance|kia finance|tfs|toyota financial|lfs|lexus financial|ahfc|american honda finance|honda financial|acura financial|gm financial|vcfs|mbfs|bmw financial|audi financial|vw credit|mazda financial|subaru motors finance|genesis (?:motor )?finance)/i.test(text);
  const leaseOnly = /lease cash|lease bonus|lease loyalty|toward(?:s)? (?:a |the )?(?:new )?lease|on (?:a |the )?lease only|lease credit/i.test(head) || returning && (/lease|\brcl\b|renewal/i.test(head) || !/purchase|financ|retail/i.test(text));
  const purchaseOnly = /purchase only|retail purchase|when purchasing|who purchase|on the purchase of|purchase allowance/i.test(text) && !/purchase or lease|lease or purchase/i.test(text);
  return {
    kind, audience, affinity, makes, excludes, needsCaptive,
    appliesToLease: kind === 'cash' ? (leaseOnly || /purchase or lease|lease or purchase|leas(?:e|ing)/i.test(text)) && !purchaseOnly : kind === 'lease',
    appliesToPurchase: kind === 'cash' ? !leaseOnly : kind === 'finance',
    programs: programs(text),
    key: `${audience}|${affinity || ''}|${titleKey}`,
  };
}

// Does this household qualify? elig = { household: [makes], owned: [makes], currentLease: { make, captive }, military, firstResponder, college, costco }
export function eligible(o, cls, elig, targetMake) {
  const target = normMake(targetMake || o.make);
  const house = (elig.household || []).map(normMake).filter(Boolean);
  const lease = elig.currentLease?.make ? normMake(elig.currentLease.make) : null;
  if (cls.audience === 'public') return { ok: true, why: 'Open to everyone' };
  if (cls.audience === 'affinity') {
    const map = { military: ['military', 'Military or veteran'], 'first-responder': ['firstResponder', 'First responder'], college: ['college', 'Recent college grad'], costco: ['costco', 'Costco member'] };
    const m = map[cls.affinity];
    if (m && elig[m[0]]) return { ok: true, why: m[1] };
    return { ok: false, why: `For ${(o.group || cls.affinity || 'a specific group').toLowerCase()}` };
  }
  if (cls.audience === 'returning') {
    if (lease && sameFamily(lease, target) && (elig.currentLease?.captive !== false)) return { ok: true, why: `Coming out of a ${cap(lease)} lease` };
    return { ok: false, why: `For people coming out of a ${cap(familyOf(target) === 'ford' ? 'Ford Credit' : target)} lease` };
  }
  if (cls.audience === 'loyalty') {
    const want = cls.makes.length ? cls.makes : FAMILIES[familyOf(target)] || [target];
    const hit = house.find((h) => want.some((w) => normMake(w) === h || sameFamily(w, h) && !cls.makes.length));
    if (hit && lease && hit === lease && !(elig.owned || []).map(normMake).includes(hit)) return { ok: true, why: `Leasing a ${cap(hit)} (some loyalty programs want ownership; confirm)`, verify: true };
    return hit ? { ok: true, why: `Household ${cap(hit)}` } : { ok: false, why: `For current ${cls.makes.length ? cls.makes.map(cap).join('/') : cap(target)} owners` };
  }
  if (cls.audience === 'conquest') {
    if (cls.makes.length) {
      const hit = house.find((h) => cls.makes.includes(h));
      return hit ? { ok: true, why: `Household ${cap(hit)}` } : { ok: false, why: `For current ${cls.makes.map(cap).join('/')} owners` };
    }
    const list = (BRAND_RULES[target] || {}).conquestMakes;
    if (Array.isArray(list)) {
      const hit = house.find((h) => list.includes(h));
      return hit ? { ok: true, why: `Household ${cap(hit)}` } : { ok: false, why: list.length ? `For owners of ${list.slice(0, 4).map(cap).join(', ')}${list.length > 4 ? ' and others' : ''}` : 'Not open to her current brands' };
    }
    const rival = house.find((h) => !sameFamily(h, target));
    if (rival && list === 'non-family') return { ok: true, why: `Household ${cap(rival)}` };
    return rival ? { ok: true, why: `Household ${cap(rival)} (check it’s on the eligible list)`, verify: true } : { ok: false, why: 'For owners of a competing brand' };
  }
  return { ok: false, why: '' };
}

function conflicts(a, b) {
  // One program of each targeted kind: one affinity, one loyalty, one conquest, one lease renewal.
  if (a.cls.audience !== 'public' && a.cls.audience === b.cls.audience) return true;
  if (a.cls.excludes.has(b.cls.audience) || b.cls.excludes.has(a.cls.audience)) return true;
  if (a.cls.programs.length && a.cls.programs.some((p) => b.cls.programs.includes(p))) return true;
  // The same program listed for several trims or dealers.
  if (a.cls.key === b.cls.key) return true;
  // Loyalty and conquest almost never stack (GM, Stellantis, Honda, Mazda, Genesis, Volvo, Audi).
  if ((a.cls.audience === 'loyalty' && b.cls.audience === 'conquest') || (a.cls.audience === 'conquest' && b.cls.audience === 'loyalty')) return true;
  return false;
}

// Best legal stack of cash offers.
// opts: { elig, make, mode: 'cash'|'finance'|'lease', specialApr: bool (finance at a promo rate, or a factory lease deal), azActive: bool, year }
// Domestic brands tie offers to where the buyer lives ("Residency restrictions apply"); most
// import brands key offers to the selling dealer's region ("regardless of buyer's residency").
export const RESIDENCE_MAKES = new Set(['ford', 'lincoln', 'chevrolet', 'gmc', 'buick', 'cadillac', 'jeep', 'ram', 'dodge', 'chrysler']);
export function regionOk(o, make, home) {
  if (!o.region || !home?.zip || o.region === home.zip) return { ok: true };
  const m = normMake(o.make || make);
  if (RESIDENCE_MAKES.has(m) || /residency restrictions apply|must reside|residents of/i.test(String(o.text || o.disclaimer || '')))
    return { ok: false, why: `${cap(m)} offers go by where you live${home.st ? ` (${home.st})` : ''}` };
  return { ok: true };
}

export function bestStack(offers, opts) {
  const { elig = {}, make, mode = 'finance', specialApr = false, azActive = false, year = null, region = null, home = null } = opts;
  const pool = [];
  const blocked = [];
  for (const o of offers || []) {
    if (offerKind(o) !== 'cash' || !(o.cashback > 0)) continue;
    // One stack comes from one market: offers listed for another region are skipped, not blocked.
    if (region && o.region && o.region !== region) continue;
    const ro = regionOk(o, make, home);
    if (!ro.ok) { blocked.push({ id: o.id, why: ro.why }); continue; }
    const cls = classify({ ...o, make: o.make || make });
    const oy = Number(o.year) || Number(String(o.vehicles?.[0] || '').match(/^(20\d\d)\b/)?.[1]) || null;
    if (year && oy && oy !== year) continue;
    const el = eligible(o, cls, elig, make);
    let why = el.ok ? null : el.why;
    if (!why && mode === 'cash' && cls.needsCaptive) why = 'Needs the brand’s own financing';
    if (!why && mode === 'lease' && !cls.appliesToLease) why = 'Purchase only';
    if (!why && mode !== 'lease' && !cls.appliesToPurchase) why = 'Lease only';
    if (!why && specialApr && cls.excludes.has('special-apr')) why = mode === 'lease' ? 'Not with the factory lease deal' : 'Not with the special APR';
    if (!why && azActive && cls.excludes.has('private')) why = 'Not with A/Z-Plan pricing';
    if (why) { blocked.push({ id: o.id, why }); continue; }
    pool.push({ o, cls, why: el.why, verify: !!el.verify });
  }
  // Brute force (pools are small): the highest total with no conflicts.
  pool.sort((a, b) => b.o.cashback - a.o.cashback);
  const n = Math.min(pool.length, 14);
  let best = { total: 0, picks: [] };
  const walk = (i, picks, total) => {
    if (total > best.total) best = { total, picks: [...picks] };
    for (let j = i; j < n; j++) {
      if (picks.some((p) => conflicts(p, pool[j]))) continue;
      picks.push(pool[j]); walk(j + 1, picks, total + pool[j].o.cashback); picks.pop();
    }
  };
  walk(0, [], 0);
  const chosen = new Set(best.picks.map((p) => p.o.id));
  for (const p of pool) if (!chosen.has(p.o.id)) blocked.push({ id: p.o.id, why: 'Can’t combine with a bigger offer in the stack' });
  return {
    ids: best.picks.map((p) => p.o.id),
    total: best.total,
    reasons: best.picks.map((p) => ({ id: p.o.id, amount: p.o.cashback, why: p.why, verify: p.verify, audience: p.cls.audience })),
    blocked,
  };
}
