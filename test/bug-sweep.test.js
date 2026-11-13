import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/index.js";

const migration = (name) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");

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

test("migrations 0001 and 0002 apply to an empty database", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(migration("0001_initial.sql"));
  db.exec(migration("0002_scanner_v2.sql"));
  const searches = db.prepare("SELECT name, category FROM searches ORDER BY id").all();
  assert.equal(searches.length, 6);
  assert.ok(searches.every((s) => s.category === s.name));
});

test("Operations queue counts only live candidates and BUY/WATCH history", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(migration("0001_initial.sql"));
  db.exec(migration("0002_scanner_v2.sql"));
  db.exec(`CREATE TABLE IF NOT EXISTS cycle_runs (id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT DEFAULT CURRENT_TIMESTAMP, completed_at TEXT, status TEXT, summary TEXT, error TEXT)`);
  const add = db.prepare(`INSERT INTO listings (ebay_item_id, title, item_url, category, status, analysis_status, recommendation)
    VALUES (?, 'x', 'https://www.ebay.com/itm/1', ?, ?, ?, ?)`);
  let n = 0;
  const many = (count, ...row) => { for (let i = 0; i < count; i++) add.run("e" + n++, ...row); };
  many(3, "Cameras", "candidate", "details_ready", "REVIEW");
  many(50, "Cameras", "expired", "details_ready", "REVIEW"); // timed out, not waiting
  many(2, "Cameras", "analyzed", "complete", "WATCH");
  many(1, "Cameras", "analyzed", "complete", "BUY");
  many(40, "Cameras", "rejected", "complete", "PASS");

  const body = await (await worker.fetch(new Request("https://bagspec.com/diagnostics"), { DB: fakeD1(db) })).json();
  const count = (status, rec) => body.queue.find((q) => q.analysis_status === status && q.recommendation === rec)?.count;
  assert.equal(count("details_ready", "REVIEW"), 3);
  assert.equal(count("complete", "WATCH"), 2);
  assert.equal(count("complete", "BUY"), 1);
  assert.equal(count("complete", "PASS"), undefined);
});

test("the dashboard allows Cloudflare Web Analytics in its CSP", async () => {
  const response = await worker.fetch(new Request("https://bagspec.com/dashboard"), {});
  const csp = response.headers.get("Content-Security-Policy");
  assert.match(csp, /script-src [^;]*https:\/\/static\.cloudflareinsights\.com/);
  assert.match(csp, /connect-src [^;]*https:\/\/cloudflareinsights\.com/);
  assert.match(csp, /default-src 'self'/);
});
