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

// Up to `n` comparable models, preferring the same brand's natural replacement first.
export function suggestComparables(current, n = 6) {
  const seg = segmentFor(current);
  const list = SEGMENTS[seg].models.filter(([mk, md]) => !(norm(mk) === norm(current.make) && norm(md) === norm(current.model)));
  const sameBrand = list.filter(([mk]) => norm(mk) === norm(current.make));
  const others = list.filter(([mk]) => norm(mk) !== norm(current.make));
  return { segment: seg, label: SEGMENTS[seg].label, models: [...sameBrand.slice(0, 2), ...others].slice(0, n) };
}

// Brands whose new cars get Ford A/Z-Plan pricing.
export const AZ_MAKES = new Set(['ford', 'lincoln']);
