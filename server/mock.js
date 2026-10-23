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
    return { num_found: 12 + (h % 60), listings, stats: { price: { median: base + 1500, min: base }, msrp: { median: base + 3200 } } };
  }
  if (path.includes('incentive')) {
    if (!['Ford', 'Toyota', 'Honda', 'Hyundai'].includes(p.make)) return { num_found: 0, listings: [] };
    const ford = p.make === 'Ford';
    return {
      num_found: 3,
      listings: [
        { id: 'l1', offer: { offer_type: 'lease', titles: [`Lease a 2027 ${p.make} ${p.model || ''} for $369/mo`], vehicles: [{ year: 2027, make: p.make, model: p.model }], amounts: [{ monthly: 369, term: 36, term_unit: 'months' }], due_at_signing: 2999, msrp: 34500, mileage_limit: 10000, over_mileage_fee: 0.25, disposition_fee: 350, valid_through: '11/30/2026', disclaimers: ['Mock offer.'] } },
        { id: 'f1', offer: { offer_type: 'finance', titles: ['3.9% APR for 60 months'], vehicles: [{ year: 2027, make: p.make, model: p.model }], amounts: [{ apr: ford ? 1.9 : 3.9, term: 60, term_unit: 'months' }], valid_through: '11/30/2026' } },
        { id: 'c1', offer: { offer_type: 'cash', titles: ['Customer cash'], vehicles: [{ year: 2027, make: p.make, model: p.model }], cashback_amount: ford ? 4000 : 1000, valid_through: '11/30/2026' } },
        { id: 'c2', offer: { offer_type: 'cash', titles: ['Owner loyalty'], vehicles: [{ year: 2027, make: p.make, model: p.model }], cashback_amount: 1000, cashback_target_group: 'Current owners of eligible vehicles', valid_through: '11/30/2026' } },
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
