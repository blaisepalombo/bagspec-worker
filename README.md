# BagSpec Worker

Cloudflare Worker that scans eBay for repairable electronics, enriches new
listings, estimates repair risk, checks working comparables, and calculates
potential resale profit.

Scanner V2 targets six repair-friendly categories with eBay category IDs:
business laptops, mini PCs, game consoles, projectors, premium portable
audio, and label printers. It rejects obvious accessories, obsolete laptops,
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
  ready candidate.
- `/deals`: shows all current `BUY` and `WATCH` results.
- `/stats`, `/listings`, and `/candidates`: operational views.
