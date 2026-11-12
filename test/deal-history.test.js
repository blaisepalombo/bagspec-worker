import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/index.js";

// Minimal D1 stand-in backed by node:sqlite.
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
  return {
    prepare: (sql) => statement(sql),
    batch: async (statements) => Promise.all(statements.map((s) => s.run())),
  };
}

// Cache API stand-in shared across requests, like caches.default.
function installCache() {
  const store = new Map();
  globalThis.caches = {
    default: {
      put: async (request, response) => { store.set(request.url, await response.text()); },
      match: async (request) => store.has(request.url) ? new Response(store.get(request.url)) : undefined,
    },
  };
}

function seededEnv(dealCount) {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8"));
  db.exec("ALTER TABLE searches ADD COLUMN category_id TEXT; ALTER TABLE searches ADD COLUMN profile_key TEXT;");
  const insert = db.prepare(`INSERT INTO listings (ebay_item_id, title, item_url, recommendation, reasoning)
    VALUES (?, ?, 'https://www.ebay.com/itm/1', ?, 'private notes')`);
  for (let i = 1; i <= dealCount; i++) insert.run("e" + i, "Deal " + i, i % 3 ? "WATCH" : "BUY");
  insert.run("pass", "Passed listing", "PASS");
  return { DB: fakeD1(db) };
}

const get = (env, path) => worker.fetch(new Request("https://bagspec.com" + path), env);

// Schema setup runs once per Worker instance, as in production, so the
// tests share one database.
const env = seededEnv(230);

test("/deals pages through every BUY and WATCH, newest first", async () => {
  installCache();
  const seen = [];
  let path = "/deals";
  for (let pages = 0; path && pages < 10; pages++) {
    const body = await (await get(env, path)).json();
    seen.push(...body.deals.map((deal) => deal.id));
    assert.ok(body.deals.every((deal) => !("reasoning" in deal)), "public view hides reasoning");
    path = body.nextBefore ? "/deals?before=" + body.nextBefore : null;
  }
  assert.equal(seen.length, 230);
  assert.equal(new Set(seen).size, 230);
  assert.deepEqual(seen, [...seen].sort((a, b) => b - a));
});

test("/deals and /listings fall back to the last saved copy when D1 fails", async () => {
  installCache();
  const live = await (await get(env, "/deals")).json();
  assert.equal(live.count, 100);
  assert.equal(live.stale, undefined);
  const liveListings = await (await get(env, "/listings")).json();

  const failing = () => { throw new Error("D1_ERROR: daily row read limit"); };
  const down = { DB: { prepare: failing, batch: failing } };

  const deals = await get(down, "/deals");
  assert.equal(deals.status, 200);
  const saved = await deals.json();
  assert.equal(saved.stale, true);
  assert.deepEqual(saved.deals, live.deals);
  assert.equal(saved.nextBefore, live.nextBefore);
  assert.ok(saved.savedAt);

  const listings = await (await get(down, "/listings")).json();
  assert.equal(listings.stale, true);
  assert.deepEqual(listings.listings, liveListings.listings);
});

test("/deals returns 503 instead of crashing when nothing is saved", async () => {
  installCache();
  const failing = () => { throw new Error("D1_ERROR"); };
  const response = await get({ DB: { prepare: failing, batch: failing } }, "/deals");
  assert.equal(response.status, 503);
});
