# BagSpec Worker

Cloudflare Worker that scans eBay for repairable electronics, enriches new
listings, estimates repair risk, checks working comparables, and calculates
potential resale profit.

Scanner V2 targets seven repair-friendly categories chosen for resale demand
in Rexburg, Idaho (BYU-Idaho): laptops, game consoles, graphing calculators,
headphones, premium portable audio, projectors, and cameras. Local resale is
the preferred channel; eBay is recommended only when it nets more than $10
extra. Each category has its own local resale rate in `CATEGORY_PROFILES`.

Two deal types are scanned:

- **Repair**: "For parts or not working" listings, screened by AI for a
  realistic DIY repair.
- **Flip**: one Used, fixed-price search per cycle (rotating categories, up
  to each category's `flipMaxPrice`). Listings that mention any fault or
  uncertainty are rejected, the AI repair screening is skipped, and profit
  comes straight from working comparables. Flips are tagged on the
  dashboard and in Discord alerts.

A BUY needs evidence, not just an estimate:

- **Sold-price reference**: the model must match `MODEL_RESALE`, a table of
  recent typical sold prices, or have automatic sold evidence: multi-quantity
  comparable listings whose eBay-reported sold quantities total at least 5
  units. That evidence uses the sales-weighted lower quartile, discounted
  10%, cached per model for 14 days (7 when no evidence was found), and at
  most 150 item lookups a day. Other models are valued from active asking
  prices discounted by `UNREFERENCED_SOLD_RATE` and can reach WATCH only.
- **Parts-price reference**: the AI names a `faultType`, the listing itself
  must state that fault, and `REPAIR_PARTS` supplies the parts cost. Unknown
  or unstated faults can reach WATCH only.
- Laptops released before 2017, low-end processors, listings without a
  processor, and items relisted at an unchanged price are rejected. It rejects obvious accessories, obsolete laptops,
locked devices, liquid damage, bulk lots, and incomplete products before
spending calls on enrichment or AI analysis.

## Cloudflare bindings

- `DB`: D1 database named `bagspec-production`
- `AI`: Workers AI binding
- Cron: every five minutes

## Runtime secrets

The following secrets stay in Cloudflare and must never be committed:

- `EBAY_CLIENT_ID`
- `EBAY_CLIENT_SECRET`
- `EBAY_VERIFICATION_TOKEN`
- `BAGSPEC_ADMIN_KEY`
- `DISCORD_WEBHOOK_URL`

## Commands

```bash
npm install
npm run check
npm run dev
npm run deploy
```

Cloudflare Workers Builds uses `npx wrangler deploy` automatically when a
commit reaches the production branch.

## Admin routes

All admin routes use HTTP Basic authentication with username `bagspec` and
the `BAGSPEC_ADMIN_KEY` secret as the password.

- `/setup-v2`: idempotently upgrades the existing D1 configuration and keeps
  historical listings.
- `/cycle`: runs a scan, enriches up to five listings, and analyzes the best
  ready candidate, then sends any unalerted `BUY` deals to Discord.
- `/test-discord`: sends a harmless test notification to the configured
  Discord webhook.
- `/dashboard`: authenticated, read-only deal desk with deals, recent listings, and scanner health. Open this route in your browser and sign in with the existing BagSpec admin credentials. The displayed resale and profit figures are estimates, and each listing still needs inspection.\n- `/deals`: shows all current `BUY` and `WATCH` results.
- `/stats`, `/listings`, and `/candidates`: operational views.
