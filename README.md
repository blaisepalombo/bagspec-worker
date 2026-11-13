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

**Budget**: BagSpec only looks at items that cost at most $75 all-in
(price + shipping + 6% tax; set by `BUY_BUDGET_USD` in `wrangler.jsonc`, and
the default is $50). eBay searches ask only for items priced under that, and
anything that ends up over it after real shipping is passed. With a budget
of $75 or less, a BUY needs $25+ profit
and a 50%+ return (WATCH: $15 and 35%). Searches favor broken cameras and
Nintendo handhelds, which fit the budget best.

**Auctions**: one search per cycle looks at a whole eBay category for
broken-item auctions ending 10 minutes to 12 hours from now. They go to the front of the queue, and a
BUY alert gives the most to bid (`auctionMaxBid`) that still makes the BUY
profit and return within budget.

**Handhelds**: broken Nintendo handhelds (DS, 3DS, Switch Lite, Game Boy)
listed "for parts" with a simple stated fault (hinge, screen, battery,
stick, shell) are analyzed instead of rejected for not proving they boot.

**My flips tracker**: on the dashboard, "I bought this" on a deal (or
"+ Add an item" for local buys) saves it to the `inventory` table. Each item
can be updated with parts costs and status, and marked sold (eBay fees are
estimated if left blank). The tab totals profit, money tied up, and how real
profits compare with BagSpec's estimates. The data is private: the
`/api/inventory` routes always need the admin login, and `/login` signs in.

**Daily digest**: after 7pm Idaho time, Discord gets the top 5 WATCH/BUY
listings from the last 24 hours, once a day.

**Claude**: repairs are diagnosed by Claude Haiku (`claude-haiku-5-5`, about
$0.0005 a listing), falling back to the free Workers AI model if Claude
fails or the budget is used up. Repairs that need soldering are passed.
Estimated Claude spend is tracked in the `claude_spend` table and capped by
`CLAUDE_MONTHLY_BUDGET_USD` (default $8 a month; screening may use at most
1/30 of it per day). `/diagnostics` shows the current spend.

A BUY needs evidence, not just an estimate:

- **Sold-price reference**: the model must match `MODEL_RESALE`, a table of
  recent typical sold prices, or have automatic sold evidence: multi-quantity
  comparable listings whose eBay-reported sold quantities total at least 5
  units across 2 listings, or 10 units on one. That evidence uses the sales-weighted lower quartile, discounted
  10%, cached per model for 14 days (7 when no evidence was found), and at
  most 150 item lookups a day. Other models are valued from active asking
  prices discounted by `UNREFERENCED_SOLD_RATE` and can reach WATCH only.
- **Parts-price reference**: the AI names a `faultType`, the listing itself
  must state that fault, and `REPAIR_PARTS` supplies the parts cost. Unknown
  or unstated faults can reach WATCH only.
- **Claude check**: every would-be BUY goes to Claude (`claude-sonnet-5-5`,
  see `src/claude.js`). Claude checks that the comparables are the same
  model, generation and configuration, looks for fake or scam red flags,
  and re-estimates resale and profit after fees. It must answer "buy" with
  at least 75% confidence, 3+ matching comparables, no red flags, and a
  profit above the category minimum. Any API error, refusal, cut-off or
  invalid answer counts as "pass", so the listing stays at WATCH. A
  confident mismatch or fake drops it to PASS. A model without a
  sold-price reference can still reach BUY when it has 8+ comparables and
  Claude approves. Claude checks are capped at 10 a day (about 1-3 cents
  each); change the cap with `CLAUDE_DAILY_CALL_LIMIT`.
- **Too cheap to be real**: a working flip priced under half of the
  comparables lower quartile is rejected as a likely fake or scam.
- Laptops released before 2017, low-end processors, listings without a
  processor, and items relisted at an unchanged price are rejected. It rejects obvious accessories, obsolete laptops,
locked devices, liquid damage, bulk lots, and incomplete products before
spending calls on enrichment or AI analysis.

## iPhone app

`app/` is a Flutter app for iPhone, shipped through TestFlight by the
"TestFlight beta" GitHub Action. BUY deals, auctions to bid on and the 7 PM
digest are pushed straight to Apple (APNs) from the Worker, alongside
Discord. A deal counts as alerted once either channel delivers it. Setup is
in `app/README.md`.

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
- `ANTHROPIC_API_KEY` (Claude BUY check; without it nothing reaches BUY)
- `CLAUDE_DAILY_CALL_LIMIT` (optional, default 10)
- `EBAY_RUNAME` (optional; turns on "Connect eBay" in My flips)
- `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY` (optional; iPhone push for the
  app in `app/`, see `app/README.md`)

## Connected eBay account

My flips can import what the owner buys on eBay. BagSpec signs in with
eBay's OAuth authorization code grant, stores the tokens encrypted in D1, and
reads won items with the Trading API `GetMyeBayBuying` call once an hour.
Purchases of listings BagSpec found are added to My flips automatically;
other purchases are listed for the owner to add or hide.

Setup:

1. In the eBay Developers Program, open **User Tokens** for the production
   keyset, add an eBay Redirect URL (RuName), and set its **auth accepted
   URL** to `https://bagspec.com/ebay/callback`.
2. Save the RuName as a secret: `npx wrangler secret put EBAY_RUNAME`.
3. Sign in to the dashboard, open **My flips**, and press **Connect eBay**.

## Commands

```bash
npm install
npm run check
npm test
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
- `/dashboard`: public, read-only deal desk (My flips and the full
  Operations view need the login) with deals, recent listings, and scanner health. Open this route in your browser and sign in with the existing BagSpec admin credentials. The displayed resale and profit figures are estimates, and each listing still needs inspection.\n- `/deals`: shows all current `BUY` and `WATCH` results.
- `/stats`, `/listings`, and `/candidates`: operational views.
