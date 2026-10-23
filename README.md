# Lease Buyout Advisor

Your lease is ending. Should you **buy it out**, **lease something new**, or **buy something new**?
This app answers that on total cost of ownership, using live market data for your exact car and the cars you'd replace it with.

## What it does

1. **Looks up your leased car by VIN** (or plate): year/make/model/trim, MPG, open recalls, and what it's worth today in your ZIP.
2. **Works out your lease equity**: market value at lease end vs. your buyout price, what a dealer would pay, and what it costs to hand it back (excess miles, disposition, wear).
3. **Prices the alternatives**: local new-car listing prices plus current manufacturer lease, APR and cash offers for each car you add.
4. **Compares every option on the same footing** over the years you'd keep the next car:
   payments, interest, sales tax, fees, registration (Colorado specific ownership tax built in), insurance, fuel, maintenance, and depreciation, minus what the car is worth when you're done.
5. **Shows how the answer changes with time**: all-in monthly cost for keeping each option 1–8 years.

Every estimate is editable. Blank fields fall back to typical figures, shown as placeholders.

## Data sources

| Need | Source | Plan notes |
| --- | --- | --- |
| VIN decode | auto.dev `/vin` → MarketCheck `/v2/decode/car/{vin}/specs` | auto.dev free tier |
| Market value of your car | MarketCheck Price™ `/v2/predict/car/us/marketcheck_price`, falling back to median of local comparable listings (MarketCheck, then auto.dev) | |
| New-car prices | MarketCheck `/v2/search/car/active?car_type=new`, falling back to auto.dev `/listings` | |
| Lease / APR / cash offers | MarketCheck `/v2/search/car/incentive/oem` | |
| Recalls | MarketCheck AutoRecalls `/v2/car/autorecalls/{vin}`, falling back to auto.dev `/openrecalls` | |
| Plate → VIN | auto.dev `/plate/{state}/{plate}` | |
| Payments, APR, TCO | auto.dev `/payments`, `/apr`, `/tco` (exposed at `/api/autodev/*`) | Growth plan or higher |

MarketCheck's free tier is 500 calls/month. Every response is cached on disk (decode 90 days, value 2 days, listings 12 hours, offers 1 day) and the header shows calls used this month.

Edmunds' public vehicle API was retired, so it isn't used; MarketCheck's OEM incentives cover the same rebate/lease/APR data.

## Running it

```bash
npm install
cp .env.example .env   # add your keys
npm start              # http://localhost:3000
MOCK=1 npm start       # demo data, no API calls
npm test               # cost-engine tests
```

### Environment variables

| Variable | Purpose |
| --- | --- |
| `MARKETCHECK_API_KEY` | MarketCheck API key |
| `AUTODEV_API_KEY` | auto.dev API key |
| `APP_PASSWORD` | Optional. Puts the app behind a password so nobody else spends your API quota. Any username works. |
| `CACHE_DIR` | Where the cache, usage counter and saved profile live. Defaults to `/data` if it exists (Railway volume), else `./.cache`. |
| `MARKETCHECK_MONTHLY_LIMIT` | Shown in the usage meter. Default 500. |
| `MOCK` | `1` to use built-in demo data. |

## Deploying on Railway

The service builds with Nixpacks/Railpack from `package.json` and starts with `npm start`. Attach a volume at `/data` so the cache and your saved car survive redeploys. Set the variables above on the service.

## How the math works

All scenarios start at the moment your lease ends. Each one is a series of monthly cash flows over your horizon; at the end, the car you hold is "sold" at its projected value and any loan balance is paid off. Net cost is everything you paid minus what you got back, optionally discounted at what your cash would otherwise earn.

* **Depreciation**: a typical retention curve (80% after year 1, 61% after year 3, 48% after year 5…), 12% steeper for luxury makes, adjusted ~0.6% per 1,000 miles above or below 12k/yr. Your current car is anchored to its actual market value today.
* **Leaving the current lease**: if a dealer would pay more than your buyout, the equity is credited (and in most states the trade lowers sales tax on the next purchase). Otherwise you pay excess-mile, disposition and wear charges.
* **Leasing new**: uses the manufacturer offer if you pick one, otherwise estimates the payment from price, residual and money factor. Longer horizons re-lease on the same terms.
* **Maintenance**: rises with age ($450/yr new to ~$2,300/yr at 8 years for a mainstream car; ×1.5 luxury).

Engine: [`public/engine.js`](public/engine.js) · tests: [`test/engine.test.js`](test/engine.test.js)
