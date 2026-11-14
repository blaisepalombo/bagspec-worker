import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import worker, { buildWatchDigestPayload } from "../src/index.js";
import { renderDashboard } from "../src/dashboard.js";
import {
  countEbayCall,
  ebayUsageDay,
  fetchEbayRateLimits,
  flushEbayCallCounts,
  getOwnCallCounts,
  resetEbayUsageState,
  summarizeRateLimits,
  usageWarning,
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

// eBay's documented response shape: rateLimits -> resources -> rates.
const NOW = new Date("2026-11-14T20:00:00Z"); // 12:00 PM Pacific
const RESET = "2026-11-15T08:00:00.000Z";     // midnight Pacific, 12 h away
const ebayResponse = (used) => ({
  rateLimits: [{
    apiContext: "buy", apiName: "Browse", apiVersion: "v1",
    resources: [
      { name: "buy.browse", rates: [{ count: used, limit: 5000, remaining: 5000 - used, reset: RESET, timeWindow: 86400 }] },
      { name: "buy.browse.item.bulk", rates: [{ count: 0, limit: 5000, remaining: 5000, reset: RESET, timeWindow: 86400 }] },
    ],
  }],
});

beforeEach(() => resetEbayUsageState());

test("eBay's response is reduced to the main Browse quota, with today's pace", () => {
  const { main, resources } = summarizeRateLimits(ebayResponse(2000), NOW);
  assert.equal(resources.length, 2);
  assert.equal(main.name, "buy.browse");
  assert.equal(main.used, 2000);
  assert.equal(main.remaining, 3000);
  assert.equal(main.share, 0.4);
  assert.equal(main.projected, 4000, "half the day gone, 2,000 used: on pace for 4,000");
});

test("a warning when usage is high or on pace to run out", () => {
  const at = (used) => usageWarning(summarizeRateLimits(ebayResponse(used), NOW).main);
  assert.equal(at(2000), null);
  assert.match(at(2400), /on pace for about 4,800 of 5,000/);
  assert.match(at(4300), /4,300 of 5,000 calls today \(86%\)/);
  assert.equal(usageWarning(null), null);
});

test("eBay's no-content answer and errors are reported, not thrown, and answers are cached", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response(null, { status: 204 }); };
  const empty = await fetchEbayRateLimits("token", { now: NOW });
  assert.equal(empty.available, false);
  await fetchEbayRateLimits("token", { now: NOW });
  assert.equal(calls, 1, "a second read within a minute uses the cached answer");

  globalThis.fetch = async () => new Response("denied", { status: 403 });
  const failed = await fetchEbayRateLimits("token", { now: NOW, fresh: true });
  assert.equal(failed.available, false);
  assert.match(failed.reason, /403/);
});

test("calls are counted by kind and saved once, by Pacific day", async () => {
  const db = new DatabaseSync(":memory:");
  const env = { DB: fakeD1(db) };
  for (let i = 0; i < 3; i++) countEbayCall("search");
  countEbayCall("item");
  assert.equal(await flushEbayCallCounts(env, NOW), 4);
  countEbayCall("search");
  assert.equal(await flushEbayCallCounts(env, NOW), 1);
  assert.equal(await flushEbayCallCounts(env, NOW), 0, "nothing new, nothing written");
  countEbayCall("comparables"); // not saved yet, still counted

  const { today, yesterday } = await getOwnCallCounts(env, NOW);
  assert.equal(today.day, "2026-11-14");
  assert.deepEqual([today.search, today.item, today.comparables, today.sold, today.total], [4, 1, 1, 0, 6]);
  assert.equal(yesterday.total, 0);
  assert.equal(ebayUsageDay(new Date("2026-11-15T07:30:00Z")), "2026-11-14", "11:30 PM Pacific is still the 14th");
});

test("the usage endpoint is owner only and combines eBay's and BagSpec's numbers", async () => {
  const db = new DatabaseSync(":memory:");
  const env = { DB: fakeD1(db), BAGSPEC_ADMIN_KEY: "admin-key", EBAY_CLIENT_ID: "id", EBAY_CLIENT_SECRET: "secret" };
  const urls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/oauth2/token")) return Response.json({ access_token: "app", expires_in: 7200 });
    return Response.json(ebayResponse(4300));
  };
  const locked = await worker.fetch(new Request("https://bagspec.com/api/ebay/rate-limits"), env);
  assert.equal(locked.status, 401);

  const response = await worker.fetch(new Request("https://bagspec.com/api/ebay/rate-limits", {
    headers: { Authorization: "Basic " + btoa("bagspec:admin-key") },
  }), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ebay.available, true);
  assert.equal(body.ebay.main.used, 4300);
  assert.match(body.warning, /4,300 of 5,000/);
  assert.ok(body.own.today, "BagSpec's own count is included");
  assert.ok(urls.some((url) => url.includes("/developer/analytics/v1_beta/rate_limit/?api_context=buy&api_name=Browse")));
});

test("the digest carries the usage warning", () => {
  const note = "eBay API usage is at 4,300 of 5,000 calls today (86%).";
  assert.match(buildWatchDigestPayload([], "2026-11-14", note).content, /⚠️ eBay API usage is at 4,300/);
  assert.doesNotMatch(buildWatchDigestPayload([], "2026-11-14").content, /⚠️/);
});

test("the dashboard page script still parses", async () => {
  const rendered = renderDashboard(75);
  const html = rendered instanceof Response ? await rendered.text() : String(rendered);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.ok(scripts.length > 0);
  for (const script of scripts) assert.doesNotThrow(() => new Function(script));
  assert.ok(html.includes('id="usage-panel"'));
});
