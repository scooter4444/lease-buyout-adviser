// Comparable-model groups. Used to suggest what to compare a leased car against.
// Order matters: the first models in each list are suggested first.
export const SEGMENTS = {
  'compact-suv': {
    label: 'Compact SUVs',
    models: [['Toyota', 'RAV4'], ['Honda', 'CR-V'], ['Ford', 'Bronco Sport'], ['Mazda', 'CX-50'], ['Hyundai', 'Tucson'], ['Kia', 'Sportage'], ['Subaru', 'Forester'], ['Chevrolet', 'Equinox'], ['Nissan', 'Rogue'], ['Ford', 'Escape'], ['Volkswagen', 'Tiguan'], ['Jeep', 'Compass']],
  },
  'midsize-2row': {
    label: 'Midsize two-row SUVs',
    models: [['Ford', 'Explorer'], ['Honda', 'Passport'], ['Nissan', 'Murano'], ['Mazda', 'CX-70'], ['Hyundai', 'Santa Fe'], ['Kia', 'Sorento'], ['Chevrolet', 'Blazer'], ['Volkswagen', 'Atlas Cross Sport'], ['Jeep', 'Grand Cherokee'], ['Toyota', 'RAV4'], ['Subaru', 'Outback'], ['Ford', 'Bronco Sport']],
  },
  'midsize-3row': {
    label: 'Three-row SUVs',
    models: [['Ford', 'Explorer'], ['Toyota', 'Highlander'], ['Honda', 'Pilot'], ['Kia', 'Telluride'], ['Hyundai', 'Palisade'], ['Chevrolet', 'Traverse'], ['Mazda', 'CX-90'], ['Volkswagen', 'Atlas'], ['Nissan', 'Pathfinder'], ['Subaru', 'Ascent'], ['Toyota', 'Grand Highlander'], ['Jeep', 'Grand Cherokee L']],
  },
  'fullsize-suv': {
    label: 'Full-size SUVs',
    models: [['Ford', 'Expedition'], ['Chevrolet', 'Tahoe'], ['GMC', 'Yukon'], ['Toyota', 'Sequoia'], ['Jeep', 'Wagoneer'], ['Nissan', 'Armada']],
  },
  'luxury-suv': {
    label: 'Luxury SUVs',
    models: [['Lincoln', 'Nautilus'], ['Lexus', 'RX'], ['BMW', 'X5'], ['Mercedes-Benz', 'GLE'], ['Audi', 'Q7'], ['Acura', 'MDX'], ['Genesis', 'GV80'], ['Volvo', 'XC90'], ['Cadillac', 'XT6'], ['Lincoln', 'Aviator']],
  },
  'compact-lux-suv': {
    label: 'Compact luxury SUVs',
    models: [['Lincoln', 'Corsair'], ['Lexus', 'NX'], ['BMW', 'X3'], ['Mercedes-Benz', 'GLC'], ['Audi', 'Q5'], ['Acura', 'RDX'], ['Genesis', 'GV70'], ['Volvo', 'XC60'], ['Cadillac', 'XT5']],
  },
  'ev-suv': {
    label: 'Electric SUVs',
    models: [['Ford', 'Mustang Mach-E'], ['Tesla', 'Model Y'], ['Hyundai', 'Ioniq 5'], ['Kia', 'EV6'], ['Chevrolet', 'Equinox EV'], ['Volkswagen', 'ID.4'], ['Honda', 'Prologue'], ['Toyota', 'bZ']],
  },
  'midsize-sedan': {
    label: 'Midsize sedans',
    models: [['Toyota', 'Camry'], ['Honda', 'Accord'], ['Hyundai', 'Sonata'], ['Kia', 'K5'], ['Nissan', 'Altima'], ['Subaru', 'Legacy'], ['Mazda', 'Mazda3']],
  },
  'compact-car': {
    label: 'Compact cars',
    models: [['Toyota', 'Corolla'], ['Honda', 'Civic'], ['Hyundai', 'Elantra'], ['Mazda', 'Mazda3'], ['Nissan', 'Sentra'], ['Volkswagen', 'Jetta'], ['Kia', 'K4'], ['Subaru', 'Impreza']],
  },
  'fullsize-pickup': {
    label: 'Full-size pickups',
    models: [['Ford', 'F-150'], ['Chevrolet', 'Silverado 1500'], ['Ram', '1500'], ['GMC', 'Sierra 1500'], ['Toyota', 'Tundra'], ['Nissan', 'Titan']],
  },
  'midsize-pickup': {
    label: 'Midsize and compact pickups',
    models: [['Ford', 'Ranger'], ['Ford', 'Maverick'], ['Toyota', 'Tacoma'], ['Chevrolet', 'Colorado'], ['GMC', 'Canyon'], ['Nissan', 'Frontier'], ['Hyundai', 'Santa Cruz'], ['Jeep', 'Gladiator']],
  },
};

// Models that aren't listed above (often discontinued) mapped to their closest group.
const EXTRA = {
  edge: 'midsize-2row', murano: 'midsize-2row', blazer: 'midsize-2row', passport: 'midsize-2row', 'cx-70': 'midsize-2row',
  'atlas cross sport': 'midsize-2row', 'santa fe': 'midsize-2row', sorento: 'midsize-2row', venza: 'midsize-2row', 'cx-5': 'compact-suv',
  ecosport: 'compact-suv', 'bronco sport': 'compact-suv', escape: 'compact-suv', 'cherokee': 'compact-suv', 'trax': 'compact-suv', 'trailblazer': 'compact-suv',
  fusion: 'midsize-sedan', malibu: 'midsize-sedan', focus: 'compact-car', mkx: 'luxury-suv', mkc: 'compact-lux-suv', nautilus: 'luxury-suv',
  'mach-e': 'ev-suv', 'mustang mach-e': 'ev-suv', bronco: 'midsize-2row', durango: 'midsize-3row', ascent: 'midsize-3row',
};

const norm = (s) => String(s || '').toLowerCase().trim();

export function segmentFor({ make, model, body }) {
  const m = norm(model);
  if (EXTRA[m]) return EXTRA[m];
  for (const [id, seg] of Object.entries(SEGMENTS)) {
    if (seg.models.some(([mk, md]) => norm(md) === m && (!make || norm(mk) === norm(make)))) return id;
  }
  for (const [id, seg] of Object.entries(SEGMENTS)) {
    if (seg.models.some(([, md]) => m && (m.includes(norm(md)) || norm(md).includes(m)))) return id;
  }
  const b = norm(body);
  if (/pickup|truck/.test(b)) return 'fullsize-pickup';
  if (/sedan|hatch|coupe/.test(b)) return 'midsize-sedan';
  return 'midsize-2row';
}

// Suggested models with a reason for each, best first:
// the same brand's closest replacements, then same-size rivals, then a step down in size.
const STEP_DOWN = {
  'midsize-2row': 'compact-suv', 'midsize-3row': 'midsize-2row', 'fullsize-suv': 'midsize-3row',
  'luxury-suv': 'compact-lux-suv', 'fullsize-pickup': 'midsize-pickup', 'midsize-sedan': 'compact-car',
};
const HYBRIDS = { 'Toyota|RAV4': 'Hybrid model available', 'Honda|CR-V': 'Hybrid model available', 'Ford|Maverick': 'Hybrid model available', 'Toyota|Highlander': 'Hybrid model available', 'Kia|Sorento': 'Hybrid model available', 'Hyundai|Santa Fe': 'Hybrid model available', 'Toyota|Camry': 'Hybrid only', 'Honda|Accord': 'Hybrid model available', 'Toyota|Sequoia': 'Hybrid only', 'Toyota|Tundra': 'Hybrid model available' };

export function suggestions(current, n = 10) {
  const seg = segmentFor(current);
  const same = (mk, md) => norm(mk) === norm(current.make) && norm(md) === norm(current.model);
  const out = [];
  const add = (mk, md, reason) => {
    if (same(mk, md) || out.some((x) => norm(x.make) === norm(mk) && norm(x.model) === norm(md))) return;
    const extra = HYBRIDS[`${mk}|${md}`];
    out.push({ make: mk, model: md, reason: extra ? `${reason}. ${extra}` : reason });
  };
  const list = SEGMENTS[seg].models;
  for (const [mk, md] of list) if (norm(mk) === norm(current.make)) add(mk, md, `${mk}’s closest replacement`);
  for (const [mk, md] of list) add(mk, md, `Same size as your ${current.model || 'car'}`);
  const down = STEP_DOWN[seg];
  if (down) for (const [mk, md] of SEGMENTS[down].models.slice(0, 3)) add(mk, md, 'A size smaller, costs less');
  return { segment: seg, label: SEGMENTS[seg].label, items: out.slice(0, n) };
}

// Up to `n` comparable models (make/model pairs), kept for older callers.
export function suggestComparables(current, n = 6) {
  const s = suggestions(current, n);
  return { segment: s.segment, label: s.label, models: s.items.map((x) => [x.make, x.model]) };
}

// Brands whose new cars get Ford A/Z-Plan pricing.
export const AZ_MAKES = new Set(['ford', 'lincoln']);
