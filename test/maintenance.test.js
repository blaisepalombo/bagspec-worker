import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { maybePruneOldData } from "../src/maintenance.js";
import { ensureEbayTables } from "../src/ebay-account.js";

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
  return { prepare: (sql) => statement(sql), batch: async (list) => Promise.all(list.map((s) => s.run())) };
}

const NOW = new Date("2026-12-31T12:00:00Z");
const daysAgo = (days) => new Date(NOW - days * 86400000).toISOString().replace("T", " ").slice(0, 19);

const db = new DatabaseSync(":memory:");
db.exec(readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8"));
db.exec("DROP TABLE inventory");
db.exec("ALTER TABLE listings ADD COLUMN seller TEXT"); // added at runtime in production
db.exec(`CREATE TABLE cycle_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, status TEXT NOT NULL, summary TEXT, error TEXT, completed_at TEXT);
  CREATE TABLE scan_search_stats (id INTEGER PRIMARY KEY AUTOINCREMENT, scan_run_id INTEGER NOT NULL, category TEXT NOT NULL,
    query TEXT NOT NULL, result_count INTEGER NOT NULL, reported_total INTEGER NOT NULL, fresh_count INTEGER NOT NULL,
    new_count INTEGER NOT NULL, saturated INTEGER NOT NULL, scanned_at TEXT NOT NULL);`);
const env = { DB: fakeD1(db) };
await ensureEbayTables(env);

// Listings are inserted oldest first, as in production (ids grow with time).
const insert = db.prepare(`INSERT INTO listings (ebay_item_id, title, item_url, seller, price, description, reasoning,
  status, analysis_status, recommendation, first_seen_at) VALUES (?, ?, 'https://www.ebay.com/itm/1', 'seller', 10, ?, ?, ?, ?, ?, ?)`);
let n = 0;
const add = (age, status, recommendation, title = "item") => {
  const info = insert.run("e" + n++, title, "long description", '{"why":"text"}', status,
    status === "candidate" ? "details_ready" : "complete", recommendation, daysAgo(age));
  return Number(info.lastInsertRowid);
};

db.exec("BEGIN");
const veryOld = add(100, "rejected", "PASS", "very old pass");
const veryOldBought = add(100, "rejected", "PASS", "very old but bought");
const veryOldPurchase = add(100, "expired", "REVIEW", "very old but an eBay purchase");
const oldWatch = add(30, "analyzed", "WATCH", "old watch deal");
const oldRejectedWatch = add(30, "rejected", "WATCH", "old rejected watch");
for (let i = 0; i < 17000; i++) add(20, i % 2 ? "rejected" : "expired", "PASS");
const oldCandidate = add(20, "candidate", "REVIEW", "old candidate");
const recent = add(5, "rejected", "PASS", "recent pass");
db.exec("COMMIT");

db.prepare("INSERT INTO inventory (listing_id, item_name) VALUES (?, 'bought')").run(veryOldBought);
db.prepare("INSERT INTO ebay_purchases (order_line_id, item_id, title, listing_id) VALUES ('1-2', '1', 't', ?)").run(veryOldPurchase);
for (const age of [40, 35, 2, 1]) {
  db.prepare("INSERT INTO cycle_runs (started_at, status) VALUES (?, 'completed')").run(daysAgo(age));
  db.prepare("INSERT INTO scan_runs (started_at, status) VALUES (?, 'completed')").run(daysAgo(age));
  db.prepare(`INSERT INTO scan_search_stats (scan_run_id, category, query, result_count, reported_total, fresh_count,
    new_count, saturated, scanned_at) VALUES (1, 'c', 'q', 1, 1, 1, 1, 0, ?)`).run(daysAgo(age));
}

const row = (id) => db.prepare("SELECT * FROM listings WHERE id = ?").get(id);
const withText = () => db.prepare("SELECT COUNT(*) AS n FROM listings WHERE description IS NOT NULL").get().n;

test("day 1 clears up to the daily cap, deletes 90-day-old passes, and trims logs", async () => {
  const before = withText();
  const result = await maybePruneOldData(env, NOW);
  assert.equal(result.caughtUp, false, "17,000 old rows is more than one day's cap");
  assert.ok(result.textCleared >= 9000 && result.textCleared <= 10000, `cleared ${result.textCleared}`);
  assert.equal(withText(), before - result.textCleared, "text is cleared (before any delete)");

  assert.equal(row(veryOld), undefined, "100-day-old PASS is deleted");
  assert.equal(result.rowsDeleted, 1);
  assert.ok(row(veryOldBought), "a listing in My flips is never deleted");
  assert.ok(row(veryOldPurchase), "a listing linked to an eBay purchase is never deleted");
  assert.equal(row(veryOldBought).description, "long description", "nor is its text cleared");

  assert.equal(result.runLogsRemoved, 6, "two 30+-day-old rows from each of three log tables");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM cycle_runs").get().n, 2);
});

test("it runs once per day", async () => {
  assert.equal(await maybePruneOldData(env, new Date(NOW.getTime() + 3600000)), null);
});

test("day 2 finishes the backlog and keeps deals, the queue, and recent text", async () => {
  const result = await maybePruneOldData(env, new Date(NOW.getTime() + 86400000));
  assert.equal(result.caughtUp, true);
  const leftovers = db.prepare(`SELECT COUNT(*) AS n FROM listings
    WHERE description IS NOT NULL AND status IN ('rejected','expired') AND first_seen_at < ?`).get(daysAgo(14)).n;
  assert.equal(leftovers, 3, "only the My flips, eBay purchase and rejected-WATCH listings keep their text");

  assert.equal(row(oldWatch).description, "long description", "BUY/WATCH deals keep their text");
  assert.equal(row(oldRejectedWatch).description, "long description");
  assert.equal(row(oldCandidate).description, "long description", "the queue is untouched");
  assert.equal(row(recent).description, "long description", "listings under 14 days keep their text");
  const cleared = row(veryOldBought + 100);
  assert.equal(cleared.description, null);
  assert.equal(cleared.reasoning, null);
  assert.equal(cleared.title, "item", "title, seller and price stay for dedupe and the relist check");
  assert.equal(cleared.seller, "seller");
  assert.equal(cleared.price, 10);
});
