# BagSpec Worker

Cloudflare Worker that scans eBay for repairable electronics, enriches new
listings, estimates repair risk, checks working comparables, and calculates
potential resale profit.

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
