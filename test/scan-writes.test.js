import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/index.js";

// Counts the listing inserts a scan sends, because D1 bills a skipped
// INSERT OR IGNORE as a row written.
const db = new DatabaseSync(":memory:");
db.exec(readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8"));
db.exec(readFileSync(new URL("../migrations/0002_scanner_v2.sql", import.meta.url), "utf8"));
db.exec("ALTER TABLE searches ADD COLUMN last_scanned_at TEXT"); // added by /setup-v2 in production
let listingInserts = 0;
function fakeD1() {
  const statement = (sql, params = []) => ({
    bind: (...values) => statement(sql, values),
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    first: async () => db.prepare(sql).get(...params) ?? null,
    run: async () => {
      if (/INSERT OR IGNORE INTO listings/.test(sql)) listingInserts += 1;
      const info = db.prepare(sql).run(...params);
      return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
    },
  });
  return { prepare: (sql) => statement(sql), batch: async (list) => { const out = []; for (const s of list) out.push(await s.run()); return out; } };
}

const posted = new Date(Date.now() - 30 * 60 * 1000).toISOString();
const ends = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
const items = Array.from({ length: 120 }, (_, i) => ({
  itemId: `v1|${1000 + i}|0`,
  title: `Nintendo 3DS console for parts broken hinge ${i}`,
  itemWebUrl: `https://www.ebay.com/itm/${1000 + i}`,
  condition: "For parts or not working",
  price: { value: "12.00", currency: "USD" },
  currentBidPrice: { value: "12.00", currency: "USD" },
  shippingOptions: [{ shippingCostType: "FIXED", shippingCost: { value: "5.00", currency: "USD" } }],
  itemCreationDate: posted,
  itemEndDate: ends,
  seller: { username: "seller" + i },
}));
let fresh = items.slice(0, 100);
globalThis.fetch = async (input) => {
  const url = String(input);
  if (url.includes("/identity/v1/oauth2/token")) return Response.json({ access_token: "app-token", expires_in: 7200 });
  if (url.includes("/item_summary/search")) return Response.json({ total: fresh.length, itemSummaries: fresh });
  throw new Error("Unexpected fetch " + url);
};

const env = { DB: fakeD1(), EBAY_CLIENT_ID: "id", EBAY_CLIENT_SECRET: "secret", BAGSPEC_ADMIN_KEY: "k" };
const admin = { Authorization: "Basic " + btoa("bagspec:k") };
const scan = async () => (await worker.fetch(new Request("https://bagspec.com/scan", { headers: admin }), env)).json();

test("a scan only inserts listings it has not seen before", async () => {
  const first = await scan();
  assert.ok(!first.error, JSON.stringify(first));
  const saved = db.prepare("SELECT COUNT(*) AS n FROM listings").get().n;
  assert.ok(saved > 0, "the first scan saves listings");
  assert.equal(listingInserts, saved, "one insert per new listing, even across repeated searches");

  // eBay returns the same listings again plus 20 new ones (over 90 ids, so
  // the lookup is chunked under D1's 100-parameter limit).
  fresh = items;
  listingInserts = 0;
  await scan();
  const added = db.prepare("SELECT COUNT(*) AS n FROM listings").get().n - saved;
  assert.equal(listingInserts, added, "already-saved listings cost no write");
  assert.ok(added > 0 && added <= 20);
});
