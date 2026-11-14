import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expireStaleCandidates, loadAnalysisQueue } from "../src/index.js";

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
  return { prepare: (sql) => statement(sql) };
}

function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8"));
  db.exec(`ALTER TABLE listings ADD COLUMN item_creation_date TEXT;
    ALTER TABLE listings ADD COLUMN deal_type TEXT NOT NULL DEFAULT 'repair';`);
  let n = 0;
  // Ages are hours before now; SQLite's 'now' is the real clock.
  const add = ({ title, listedHoursAgo, foundHoursAgo, dealType = "repair", score = 45, analysisStatus = "details_ready" }) => {
    db.prepare(`INSERT INTO listings (ebay_item_id, title, item_url, price, status, analysis_status, deal_score,
        deal_type, item_creation_date, first_seen_at)
      VALUES (?, ?, 'https://www.ebay.com/itm/1', 20, 'candidate', ?, ?, ?,
        datetime('now', ?), datetime('now', ?))`)
      .run("e" + n++, title, analysisStatus, score, dealType,
        `-${listedHoursAgo * 60} minutes`, `-${foundHoursAgo * 60} minutes`);
  };
  const statusOf = (title) => db.prepare("SELECT status FROM listings WHERE title = ?").get(title).status;
  return { db, env: { DB: fakeD1(db) }, add, statusOf };
}

test("a listing found late still gets 4 hours in the queue", async () => {
  const { env, add, statusOf } = setup();
  add({ title: "found late, 1h ago", listedHoursAgo: 13, foundHoursAgo: 1, dealType: "flip", score: 25 });
  add({ title: "found late, 5h ago", listedHoursAgo: 14, foundHoursAgo: 5, dealType: "flip", score: 25 });
  add({ title: "found early, listed 13h ago", listedHoursAgo: 13, foundHoursAgo: 12 });
  add({ title: "fresh", listedHoursAgo: 2, foundHoursAgo: 2 });

  const expired = await expireStaleCandidates(env);
  assert.equal(expired, 2);
  assert.equal(statusOf("found late, 1h ago"), "candidate");
  assert.equal(statusOf("fresh"), "candidate");
  assert.equal(statusOf("found late, 5h ago"), "expired");
  assert.equal(statusOf("found early, listed 13h ago"), "expired");

  const queued = (await loadAnalysisQueue(env)).map((item) => item.id);
  assert.equal(queued.length, 2, "the queue holds exactly the listings that didn't expire");
});

test("a flip about to leave the queue ranks ahead of newer repairs", async () => {
  const { env, add, db } = setup();
  add({ title: "new repair", listedHoursAgo: 0.5, foundHoursAgo: 0.5, score: 45 });
  add({ title: "older repair", listedHoursAgo: 4, foundHoursAgo: 4, score: 45 });
  add({ title: "flip, 1h left", listedHoursAgo: 11, foundHoursAgo: 3, dealType: "flip", score: 25 });
  add({ title: "flip, plenty of time", listedHoursAgo: 2, foundHoursAgo: 2, dealType: "flip", score: 25 });

  const titles = (await loadAnalysisQueue(env)).map((item) =>
    db.prepare("SELECT title FROM listings WHERE id = ?").get(item.id).title);
  assert.deepEqual(titles, ["flip, 1h left", "new repair", "older repair", "flip, plenty of time"]);
});
