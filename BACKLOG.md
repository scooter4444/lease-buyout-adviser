# Backlog

## Waiting on Scott

- **No-background model images from invoice-pricing.com.** The app is ready: set `IMAGE_URL_TEMPLATE` on the `web` service in Railway to the image address pattern, e.g.
  `https://invoice-pricing.com/<path>/{year}/{make_slug}/{model_slug}.png`.
  Placeholders: `{year}` `{make}` `{model}` `{trim}` (as given), `{make_slug}` `{model_slug}` (lower-case, hyphens), `{make_us}` `{model_us}` (lower-case, underscores). Each address is checked once and cached; models without an image fall back to listing photos. Needs one real image URL from the quote tool to read the pattern (its pages block automated readers, so it can't be scraped from outside).
- **Turn on Ask.** Add `GEMINI_API_KEY` to the `web` service (same key as the NFL app's `nfl-schedule-check` service).

## Next up

- Live camera viewfinder for VIN scanning (today: take a photo; the barcode is decoded on the phone, and Gemini reads the printed VIN if the barcode can't be read).
- Push or text notifications when re-pricing changes the answer (today: a banner in the app and calendar reminders).
- Apply loyalty / lease-renewal cash to lease deals as well as purchases.

## Done

- Camera VIN scan (photo → on-phone barcode decode → Gemini text fallback, with VIN check-digit validation).
- Payoff letter photo → buyout, lease end, miles allowed, payment and fees filled in for review (Gemini).
- Decide-by timeline at 90/60/30/7 days with one-tap calendar reminders (.ics).
- Scheduled re-pricing overnight (weekly → daily near the deadline, within the MarketCheck budget), "answer changed" banner, Re-check now.
- Offers fully stackable and selectable: cash stacks, one special APR, one lease; defaults count each program once, loyalty only for same-brand, military/first-responder opt-in.
- Used and certified alternatives priced from local listings, with their own depreciation and warranty effects.
- Share link per car: read-only summary without the VIN.
- Studio car images from Autoweb (transparent cutouts when available).

- Cost engine: buy out vs lease new vs buy new, all-in monthly cost, break-even by years kept.
- MarketCheck + auto.dev data with caching and a monthly call meter.
- Saved cars per person, garage, three-step add-a-car flow with decide-by countdown.
- Suggestion-driven comparisons with reasons; auto-pricing; cash back vs APR chosen automatically.
- Ford A-Plan / Z-Plan pricing.
- Ask (Gemini) assistant, app data first then the web, with sources.
- Own photos per car; listing photos for comparisons.
- Link-only access, hidden from search engines.
