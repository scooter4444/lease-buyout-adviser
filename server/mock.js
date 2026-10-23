// Offline fixtures (MOCK=1) so the UI can be developed and tested without spending API calls.
export async function marketcheck(path, p) {
  await new Promise((r) => setTimeout(r, 150));
  if (path.includes('/decode/')) return { is_valid: true, year: 2023, make: 'Toyota', model: 'RAV4', trim: 'XLE', body_type: 'SUV', fuel_type: 'Unleaded', city_mpg: 27, highway_mpg: 35, drivetrain: 'AWD', engine: '2.5L I4', powertrain_type: 'Combustion' };
  if (path.includes('marketcheck_price')) return { marketcheck_price: 29150, msrp: 33480 };
  if (path.includes('autorecalls')) return { data: { items: [{ recalls: [{ nhtsaNumber: '24V-123', recallTitle: 'Rearview camera may not display', recallDescription: 'The rearview camera image may not display when reversing.', remedyDescription: 'Dealers will update the software free of charge.', status: 'Open' }] }] } };
  if (path.includes('/search/car/active')) {
    const base = p.make === 'Honda' ? 36500 : 34200;
    const listings = Array.from({ length: 8 }, (_, i) => ({
      vin: `MOCKVIN${String(i).padStart(10, '0')}`, price: base + i * 450, msrp: base + 1800, miles: 5,
      build: { year: Number(p.year) || 2027, make: p.make, model: p.model, trim: p.trim || 'XLE', city_mpg: 27, highway_mpg: 35 },
      dealer: { name: `Mock ${p.make} of Denver ${i + 1}`, city: 'Denver', state: 'CO' },
      vdp_url: 'https://example.com', media: { photo_links: [] },
    }));
    return { num_found: 42, listings, stats: { price: { median: base + 1500, min: base }, msrp: { median: base + 1800 } } };
  }
  if (path.includes('incentive')) {
    return {
      num_found: 3,
      listings: [
        { id: 'l1', offer: { offer_type: 'lease', titles: [`Lease a 2027 ${p.make} ${p.model || ''} for $369/mo`], vehicles: [{ year: 2027, make: p.make, model: p.model }], amounts: [{ monthly: 369, term: 36, term_unit: 'months' }], due_at_signing: 2999, msrp: 34500, mileage_limit: 10000, over_mileage_fee: 0.25, disposition_fee: 350, valid_through: '11/30/2026', disclaimers: ['Mock offer.'] } },
        { id: 'f1', offer: { offer_type: 'finance', titles: ['3.9% APR for 60 months'], vehicles: [{ year: 2027, make: p.make, model: p.model }], amounts: [{ apr: 3.9, term: 60, term_unit: 'months' }], valid_through: '11/30/2026' } },
        { id: 'c1', offer: { offer_type: 'cash', titles: ['$1,000 customer cash'], vehicles: [{ year: 2027, make: p.make, model: p.model }], cashback_amount: 1000, valid_through: '11/30/2026' } },
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
