# Backlog

## Waiting on Scott

- **No-background model images from invoice-pricing.com.** The app is ready: set `IMAGE_URL_TEMPLATE` on the `web` service in Railway to the image address pattern, e.g.
  `https://invoice-pricing.com/<path>/{year}/{make_slug}/{model_slug}.png`.
  Placeholders: `{year}` `{make}` `{model}` `{trim}` (as given), `{make_slug}` `{model_slug}` (lower-case, hyphens), `{make_us}` `{model_us}` (lower-case, underscores). Each address is checked once and cached; models without an image fall back to listing photos. Needs one real image URL from the quote tool to read the pattern (its pages block automated readers, so it can't be scraped from outside).
- **Turn on Ask.** Add `GEMINI_API_KEY` to the `web` service (same key as the NFL app's `nfl-schedule-check` service).

## Next up

- Camera VIN scan in the add-a-car flow (barcode on the door jamb / windshield).
- Read a photo of the payoff letter to fill buyout price, lease end and miles allowed.
- Reminders before the decide-by date: 90 days (get a fresh payoff quote), 60 (re-check prices and offers, notify if the answer changes), 30 (book the pre-return inspection), 7 (final numbers and checklist).
- Scheduled re-pricing of saved cars so offers and market value stay current without spending calls on every visit.
- Lease-specific Ford offers that stack with A/Z-Plan: confirm compatibility rules and apply automatically.
- Used and certified alternatives (e.g. a 1–2 year old Explorer) alongside new.
- Share a read-only summary of one car's decision (for Carol).

## Done

- Cost engine: buy out vs lease new vs buy new, all-in monthly cost, break-even by years kept.
- MarketCheck + auto.dev data with caching and a monthly call meter.
- Saved cars per person, garage, three-step add-a-car flow with decide-by countdown.
- Suggestion-driven comparisons with reasons; auto-pricing; cash back vs APR chosen automatically.
- Ford A-Plan / Z-Plan pricing.
- Ask (Gemini) assistant, app data first then the web, with sources.
- Own photos per car; listing photos for comparisons.
- Link-only access, hidden from search engines.
