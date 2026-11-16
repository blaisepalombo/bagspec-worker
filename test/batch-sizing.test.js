import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  ANALYSIS_EBAY_CALLS,
  BATCH_LIMITS,
  CYCLE_MINUTES,
  countEbayCall,
  cycleCallBudget,
  getCycleCallBudget,
  nextPacificMidnight,
  pendingEbayCallTotal,
  resetEbayUsageState,
  splitBatchCalls,
} from "../src/ebay-usage.js";

function fakeD1(db) {
  const statement = (sql, params = []) => ({
    bind: (...values) => statement(sql, values),
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    first: async () => db.prepare(sql).get(...params) ?? null,
    run: async () => {
      const info = db.prepare(sql).run(...params);
      return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
    },
  });
  return { prepare: (sql) => statement(sql), batch: async (list) => { for (const s of list) await s.run(); } };
}

const NOW = new Date("2026-11-14T20:00:00Z"); // 12:00 PM Pacific
const RESET = "2026-11-15T08:00:00.000Z";     // midnight Pacific
const realFetch = globalThis.fetch;

beforeEach(() => resetEbayUsageState());
afterEach(() => { globalThis.fetch = realFetch; });

test("the next reset is midnight Pacific", () => {
  assert.equal(new Date(nextPacificMidnight(NOW)).toISOString(), RESET);
  // 11:58 PM Pacific: two minutes left.
  const late = new Date("2026-11-15T07:58:00Z");
  assert.equal(nextPacificMidnight(late) - late.getTime(), 2 * 60000);
});

test("each cycle gets an even share of the calls left, minus a small reserve", () => {
  const budget = cycleCallBudget({ limit: 5000, used: 2400, resetMs: Date.parse(RESET), now: NOW });
  assert.equal(budget.cyclesLeft, 12 * 60 / CYCLE_MINUTES); // 144
  assert.equal(budget.spendable, 5000 - 150 - 2400);
  assert.ok(Math.abs(budget.perCycle - 2450 / 144) < 1e-9);
  assert.equal(budget.paused, false);

  const nearlyOut = cycleCallBudget({ limit: 5000, used: 4860, resetMs: Date.parse(RESET), now: NOW });
  assert.equal(nearlyOut.paused, true);
  assert.equal(nearlyOut.perCycle, 0);

  // A higher allowance from eBay is used with no code change.
  const approved = cycleCallBudget({ limit: 15000, used: 2400, resetMs: Date.parse(RESET), now: NOW });
  assert.ok(approved.perCycle > budget.perCycle * 4);
});

test("calls after the scan are split between enrichment and analysis", () => {
  assert.deepEqual(splitBatchCalls(11), { enrichment: 5, analysis: 4 });
  assert.deepEqual(splitBatchCalls(30), { enrichment: 13, analysis: 13 });
  // Never below the minimum, so the queue keeps moving...
  assert.deepEqual(splitBatchCalls(-4), { enrichment: BATCH_LIMITS.enrichment.min, analysis: BATCH_LIMITS.analysis.min });
  // ...and never above the maximum.
  assert.deepEqual(splitBatchCalls(500), { enrichment: BATCH_LIMITS.enrichment.max, analysis: BATCH_LIMITS.analysis.max });
});

test("uses eBay's own count when it answers", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    rateLimits: [{ apiContext: "buy", apiName: "Browse", resources: [
      { name: "buy.browse", rates: [{ count: 3000, limit: 5000, remaining: 2000, reset: RESET, timeWindow: 86400 }] },
    ] }],
  }), { status: 200 });
  const env = { DB: fakeD1(new DatabaseSync(":memory:")) };
  const budget = await getCycleCallBudget(env, async () => "token", NOW);
  assert.equal(budget.source, "ebay");
  assert.equal(budget.used, 3000);
  assert.equal(budget.cyclesLeft, 144);
});

test("falls back to BagSpec's own count when eBay doesn't answer", async () => {
  globalThis.fetch = async () => { throw new Error("network down"); };
  const env = { DB: fakeD1(new DatabaseSync(":memory:")) };
  for (let i = 0; i < 40; i += 1) countEbayCall("search");
  assert.equal(pendingEbayCallTotal(), 40);
  const budget = await getCycleCallBudget(env, async () => "token", NOW);
  assert.equal(budget.source, "own count");
  assert.equal(budget.limit, 5000);
  assert.equal(budget.used, 40);
});

test("a full day with a full queue lands just under the limit", () => {
  const limit = 5000;
  const start = Date.parse("2026-11-14T08:00:00Z"); // midnight Pacific
  let used = 0;
  let paused = 0;
  for (let cycle = 0; cycle < 288; cycle += 1) {
    const now = new Date(start + cycle * CYCLE_MINUTES * 60000);
    const budget = cycleCallBudget({ limit, used, resetMs: start + 86400000, now });
    if (budget.paused) { paused += 1; continue; }
    const scanCalls = 6; // about what scans used on Nov 15
    const sizes = splitBatchCalls(budget.perCycle - scanCalls);
    used += scanCalls + sizes.enrichment + Math.round(sizes.analysis * ANALYSIS_EBAY_CALLS);
  }
  assert.ok(used <= limit, `used ${used}`);
  assert.ok(used >= limit * 0.93, `used ${used}`);
  assert.equal(paused, 0, "spread across the day, never paused");
});

test("a quiet morning leaves bigger batches for later", () => {
  const resetMs = Date.parse(RESET);
  const busy = cycleCallBudget({ limit: 5000, used: 2400, resetMs, now: NOW });
  const quiet = cycleCallBudget({ limit: 5000, used: 1200, resetMs, now: NOW });
  const busySizes = splitBatchCalls(busy.perCycle - 6);
  const quietSizes = splitBatchCalls(quiet.perCycle - 6);
  assert.ok(quietSizes.analysis > busySizes.analysis);
  assert.ok(quietSizes.enrichment > busySizes.enrichment);
});
