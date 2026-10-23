// Offline fixtures (MOCK=1) so the UI can be developed and tested without spending API calls.
export async function marketcheck(path, p) {
  await new Promise((r) => setTimeout(r, 150));
  if (path.includes('/decode/')) return { is_valid: true, year: 2023, make: 'Toyota', model: 'RAV4', trim: 'XLE', body_type: 'SUV', fuel_type: 'Unleaded', city_mpg: 27, highway_mpg: 35, drivetrain: 'AWD', engine: '2.5L I4', powertrain_type: 'Combustion' };
  if (path.includes('marketcheck_price')) return { marketcheck_price: 29150, msrp: 33480 };
  if (path.includes('autorecalls')) return { data: { items: [{ recalls: [{ nhtsaNumber: '24V-123', recallTitle: 'Rearview camera may not display', recallDescription: 'The rearview camera image may not display when reversing.', remedyDescription: 'Dealers will update the software free of charge.', status: 'Open' }] }] } };
  if (path.includes('/search/car/active')) {
    const h = [...String(p.make) + p.model].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 9973, 7);
    const base = 31000 + (h % 14) * 1100;
    const listings = Array.from({ length: 8 }, (_, i) => ({
      vin: `MOCKVIN${String(i).padStart(10, '0')}`, price: base + i * 450, msrp: base + 1800, miles: 5,
      build: { year: Number(p.year) || 2027, make: p.make, model: p.model, trim: p.trim || 'Base', city_mpg: 20 + (h % 9), highway_mpg: 27 + (h % 8) },
      dealer: { name: `Mock ${p.make} of Denver ${i + 1}`, city: 'Denver', state: 'CO' },
      vdp_url: 'https://example.com', media: { photo_links: [] },
    }));
    const usedK = p.car_type === 'used' ? 0.72 : p.car_type === 'certified' ? 0.8 : 1;
    return { num_found: 12 + (h % 60), listings, stats: { price: { median: Math.round((base + 1500) * usedK), min: Math.round(base * usedK) }, msrp: { median: base + 3200 }, miles: { median: p.car_type === 'new' ? 8 : 24000 } } };
  }
  if (path.includes('incentive') && !p.make && p.offer_type === 'lease') {
    // All-makes sweep (cheapest first).
    const rows = [
      ['Hyundai', 'Tucson', 2026, 'SE', 'SUV', 289, 36, 3999, 33500, 10000],
      ['Genesis', 'GV70', 2026, '2.5T', 'SUV', 389, 24, 4999, 50480, 10000],
      ['Lexus', 'NX', 2026, '350', 'SUV', 449, 36, 4999, 49689, 10000],
      ['Mercedes-Benz', 'GLC', 2026, 'GLC 300', 'SUV', 469, 24, 5103, 52900, 20000],
      ['Ford', 'Explorer', 2026, 'Active', null, 449, 24, 4289, 45000, 21000],
      ['Nissan', 'Murano', 2026, 'SL', 'SUV', 399, 36, 4919, 49130, 10000],
      ['Honda', 'Accord', 2026, 'EX', 'Sedan', 329, 36, 3499, 33000, 12000],
    ];
    const start = Number(p.start) || 0;
    return { num_found: rows.length, listings: rows.slice(start, start + 10).map(([make, model, year, trim, body, monthly, term, due, msrp, miles], k) => ({ id: `sw${k}`, base_sha: `sw${k}`, city: 'Southfield', offer: { offer_type: 'lease', titles: [`${year} ${make} ${model} ${trim}`], vehicles: [{ year, make, model, trim, body_type: body }], amounts: [{ monthly, term, term_unit: 'months' }], due_at_signing: due, msrp, mileage_limit: miles, over_mileage_fee: 0.25, valid_through: '11/02/2026', disclaimers: ['Mock offer.'] } })) };
  }
  if (path.includes('incentive')) {
    if (!['Ford', 'Toyota', 'Honda', 'Hyundai'].includes(p.make)) return { num_found: 0, listings: [] };
    const ford = p.make === 'Ford';
    return {
      num_found: 3,
      listings: [
        { id: 'l1', offer: { offer_type: 'lease', titles: [`Lease a 2027 ${p.make} ${p.model || ''} for $369/mo`], vehicles: [{ year: 2027, make: p.make, model: p.model }], amounts: [{ monthly: 369, term: 36, term_unit: 'months' }], due_at_signing: 2999, msrp: 34500, mileage_limit: 10000, over_mileage_fee: 0.25, disposition_fee: 350, valid_through: '11/30/2026', disclaimers: ['Mock offer.'] } },
        { id: 'f1', offer: { offer_type: 'finance', titles: ['3.9% APR for 60 months'], vehicles: [{ year: 2027, make: p.make, model: p.model }], amounts: [{ apr: ford ? 1.9 : 3.9, term: 60, term_unit: 'months' }], valid_through: '11/30/2026' } },
        { id: 'c1', offer: { offer_type: 'cash', titles: ['Retail Customer Cash'], vehicles: [{ year: 2027, make: p.make, model: p.model }], cashback_amount: ford ? 4000 : 1000, valid_through: '11/30/2026', disclaimers: ['Program #14232: take delivery by 1/4/2027.'] } },
        { id: 'c2', offer: { offer_type: 'cash', titles: ['Retail Owner Loyalty'], vehicles: [{ year: 2027, make: p.make, model: p.model }], cashback_amount: 1000, cashback_target_group: 'Current owners of eligible vehicles', valid_through: '11/30/2026', disclaimers: ['Program #33394: proof of ownership required.'] } },
        { id: 'c3', offer: { offer_type: 'cash', titles: ['$4,000 Cash Back + $1,000 Owner Loyalty'], vehicles: [{ year: 2027, make: p.make, model: p.model }], cashback_amount: 4000, valid_through: '11/30/2026', disclaimers: ['$4,000 Retail Customer Cash (PGM #14232) + $1,000 Retail Owner Loyalty (PGM #33394).'] } },
        { id: 'c4', offer: { offer_type: 'cash', titles: ['Bonus Cash'], vehicles: [{ year: 2027, make: p.make, model: p.model }], cashback_amount: 1000, valid_through: '11/02/2026', disclaimers: ['Program #14256.'] } },
        { id: 'c5', offer: { offer_type: 'cash', titles: ['2026 Military Recognition Exclusive Cash Reward'], vehicles: [{ year: 2027, make: p.make, model: p.model }], cashback_amount: 500, cashback_target_group: 'Military personnel', valid_through: '01/04/2027', disclaimers: ['May not be combined with any Ford private offer (32894).'] } },
      ],
    };
  }
  throw Object.assign(new Error('Mock: unknown path'), { provider: 'marketcheck', status: 404 });
}

export async function autodev(path) {
  await new Promise((r) => setTimeout(r, 120));
  if (path.startsWith('/vin/')) return { vin: path.slice(5), make: 'Toyota', model: 'RAV4', trim: 'XLE', style: 'AWD 4dr SUV', body: 'SUV', engine: '2.5L I4', drive: 'AWD', vehicle: { year: 2023, make: 'Toyota', model: 'RAV4' } };
  if (path.startsWith('/plate/')) return { vin: '2T3P1RFV5PW000000' };
  throw Object.assign(new Error('Not included in your plan'), { provider: 'autodev', status: 403 });
}

// Demo-only placeholder: a plain, generic SUV silhouette tinted per model.
export async function photo({ make = '', model = '' }) {
  const h = [...make + model].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 360, 11);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200"><rect width="320" height="200" fill="hsl(${h},25%,88%)"/><path d="M40 140 L60 95 Q70 80 95 78 L215 78 Q240 80 255 100 L285 120 Q292 125 292 135 L292 148 L40 148 Z" fill="hsl(${h},35%,38%)"/><rect x="100" y="88" width="55" height="26" rx="4" fill="hsl(${h},30%,80%)"/><rect x="162" y="88" width="55" height="26" rx="4" fill="hsl(${h},30%,80%)"/><circle cx="95" cy="150" r="20" fill="#222"/><circle cx="240" cy="150" r="20" fill="#222"/><circle cx="95" cy="150" r="8" fill="#999"/><circle cx="240" cy="150" r="8" fill="#999"/></svg>`;
  return { url: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`, exact: false };
}

// NHTSA safety API (offline demo data).
export async function nhtsa(path) {
  if (path.startsWith('/SafetyRatings/modelyear')) return { Count: 1, Results: [{ VehicleDescription: '2026 Demo SUV AWD', VehicleId: 1 }] };
  if (path.startsWith('/SafetyRatings/VehicleId')) return { Results: [{ VehicleDescription: '2026 Demo SUV AWD', OverallRating: '5', OverallFrontCrashRating: '4', OverallSideCrashRating: '5', RolloverRating: '4', RolloverPossibility: 0.163 }] };
  if (path.startsWith('/recalls')) return { Count: 2, results: [{ Component: 'AIR BAGS:FRONTAL' }, { Component: 'ELECTRICAL SYSTEM' }] };
  return {};
}

// A demo gallery: placeholder frames with tags, so the walkaround and side-by-side views render offline.
export async function gallery({ year, make = 'Demo', model = 'Car', trim = '' }) {
  const hue = [...`${make}${model}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
  const frame = (label, angle) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><rect width="640" height="420" fill="hsl(${hue},25%,${angle == null ? 30 : 88}%)"/><text x="320" y="200" font-family="Arial" font-size="34" text-anchor="middle" fill="${angle == null ? '#fff' : '#333'}">${make} ${model}</text><text x="320" y="250" font-family="Arial" font-size="26" text-anchor="middle" fill="${angle == null ? '#ddd' : '#555'}">${label}</text></svg>`)}`;
  const ext = [0, 45, 90, 135, 180, 225, 270, 315].map((a) => ({ url: frame(`outside ${a}°`, a), cat: 'exterior', angle: a, ok: true }));
  const inside = ['dash', 'screen', 'front-seats', 'rear-seats', 'roof', 'cargo', 'console'].map((c) => ({ url: frame(c.replace('-', ' '), null), cat: c, angle: null, ok: true }));
  return { listing: { year, make, model, trim, color: 'Oxford White', interior: 'Ebony', price: 38995, miles: 12, dealer: 'Demo Motors', city: 'Sarasota', state: 'FL', url: 'https://example.com', source: 'demo' }, photos: [...ext, ...inside], sorted: true, errors: [] };
}
