# AGENTS.md

A guide for AI coding agents (Claude Code, Codex, Cursor and others) picking up BagSpec. Read `README.md` for how the scanner works. This file covers how to work on it and where things stand.

## The project

BagSpec is a Cloudflare Worker (`bagspec-ebay`, served at bagspec.com) that scans eBay every 5 minutes for broken or underpriced electronics. It estimates repair and resale profit and calls each listing BUY, WATCH or PASS. It has one owner, who buys and flips the items. The longer-term goal is an app other people pay for, so:

- **Don't build features that need manual input for each deal** (for example, typing in sold prices by hand). They should work automatically for any user.
- Explain changes in plain language. The owner reads PR descriptions and decides from them.

## Layout

- `src/index.js`: the Worker. Routes, cron cycle, scanning, enrichment, analysis, alerts and the digest.
- `src/claude.js`: Claude prompts (Haiku repair screen, Sonnet BUY check).
- `src/ebay-usage.js`: eBay API usage tracking and the self-sizing batch planner.
- `src/offers.js`: Best Offer floor (85%) and opening offer.
- `src/dashboard.js`: the login-only dashboard, as an HTML string with inline JS.
- `src/push.js`: Apple push notifications.
- `app/`: Flutter iPhone app, shipped to TestFlight by a GitHub Action.
- `test/`: `node --test` suites. Most use a fake D1 built on `node:sqlite`.
- `migrations/`, `wrangler.jsonc`: D1 schema and Worker config (`BUY_BUDGET_USD` is set there).

## Working rules

- **Every change goes through a PR. Merging to `main` auto-deploys** to production through Cloudflare Workers Builds in about 30 seconds. There is no staging, so only merge when the owner says to.
- Before opening a PR, run `npm test` and `npm run check`. Add tests for new behavior.
- `src/dashboard.js` builds the page script inside a template literal. A `\'` there breaks the whole page. A test checks that the script parses.
- Stage only what you changed (`git add src test ...`). `.claude/` and `.dev.vars` are local only. Never commit secrets.
- Keep D1 queries cheap. `listings` has about 70k rows, so avoid full scans. `cycle_runs`, `ebay_call_counts`, `claude_spend` and `scan_search_stats` (filtered by date) are cheap to read. Read production data with `npx wrangler d1 execute bagspec-production --remote --json --command "..."` (keep the SQL on one line).
- Efficiency: search before opening large files (index.js is ~4,000 lines), read only what's needed, and don't rerun successful commands without a reason.

## Limits that shape the design

- **eBay Browse API: 5,000 calls a day.** This is the real ceiling. Batches size themselves to the calls left (`getCycleCallBudget`), and each `cycle_runs.summary` records how its batches were sized, for example `"batch": "ebay 3780/5000, 5/4"`. eBay's Marketplace Insights (sold prices) is partner-only and was declined, so resale is estimated from asking prices unless a model has a sold-price reference.
- **Cloudflare: Workers Paid** (since Nov 16, 2026), so the free plan's 50-requests-per-run and daily D1 caps no longer apply.
- **Claude: about $10 a month** (`CLAUDE_MONTHLY_BUDGET_USD`), plus at most 10 Sonnet BUY checks a day.
- **Budget: $150 all-in per item.** The BUY bar depends on the item's own cost.

## Where things stand (Nov 17, 2026)

- **Roadmap:** GitHub project #3, "BagSpec roadmap" (`gh project item-list 3 --owner @me`). "What's next" means read this board.
- **Waiting on eBay:** the Application Growth Check (#57), which asked for 15,000 calls a day. It was submitted Nov 14. Once approved, batches grow on their own, and #64 (more sold-price evidence) can start.
- **Next code task:** #66. Comparables should skip nicer listings (boxed, refurbished, bundles) and price from the right cluster. Inflated comparables are why estimates and offers look better than they are.
- **Results so far:** about 600–900 analyses a day, a few WATCH a week, and no BUY yet. Most "deals" don't clear eBay fees once resale is judged realistically.
- **Recently shipped:** queue fixes (#52–#55), the eBay usage card (#58), the login-only dashboard, scam guards (#11), the $150 budget (#65), self-sizing batches (#69, #70) and the 85% offer floor (#73).
