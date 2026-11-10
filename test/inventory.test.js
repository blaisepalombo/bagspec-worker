import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimateSellingFees,
  handleInventoryRequest,
  itemCost,
  itemProfit,
  parseInventoryUpdate,
  parseNewInventoryItem,
  summarizeInventory,
} from "../src/inventory.js";

test("eBay fees are 13.6% plus 40 cents; local sales have none", () => {
  assert.equal(estimateSellingFees("eBay", 100), 14);
  assert.equal(estimateSellingFees("Local", 100), 0);
  assert.equal(estimateSellingFees("eBay", 0), 0);
});

test("a bought item takes the listing title and estimates 6% tax", () => {
  const item = parseNewInventoryItem(
    { purchasePrice: "30", inboundShipping: "8" },
    { id: 7, title: "Nintendo 3DS XL broken hinge" }
  );
  assert.equal(item.listingId, 7);
  assert.equal(item.itemName, "Nintendo 3DS XL broken hinge");
  assert.equal(item.salesTax, 2.28);
  assert.throws(() => parseNewInventoryItem({ itemName: "x" }), /purchasePrice is required/);
  assert.throws(() => parseNewInventoryItem({ purchasePrice: "-3", itemName: "x" }), /0 or more/);
  assert.throws(() => parseNewInventoryItem({ purchasePrice: "5" }), /itemName/);
});

test("marking sold needs a price and fills in eBay fees", () => {
  const update = parseInventoryUpdate({ status: "sold", salePrice: "90", saleChannel: "eBay" });
  assert.equal(update.status, "sold");
  assert.equal(update.selling_fees, 12.64);
  assert.throws(() => parseInventoryUpdate({ status: "sold" }), /salePrice is required/);
  assert.throws(() => parseInventoryUpdate({ status: "stolen" }), /status/);
  assert.throws(() => parseInventoryUpdate({}), /Nothing to update/);
  assert.deepEqual(parseInventoryUpdate({ partsCost: "12.5" }), { parts_cost: 12.5 });
});

test("profit counts every cost, and a failed repair is a loss", () => {
  const sold = {
    status: "sold", purchase_price: 30, inbound_shipping: 8, sales_tax: 2.28,
    parts_cost: 12, packing_cost: 3, sale_price: 90, selling_fees: 12.64, outbound_shipping: 10,
  };
  assert.equal(itemCost(sold), 55.28);
  assert.equal(itemProfit(sold), 12.08);
  assert.equal(itemProfit({ ...sold, status: "failed" }), -55.28);
  assert.equal(itemProfit({ ...sold, status: "repairing" }), null);

  const summary = summarizeInventory([
    { ...sold, estimated_profit: 25 },
    { ...sold, status: "failed" },
    { ...sold, status: "repairing" },
  ]);
  assert.equal(summary.items, 3);
  assert.equal(summary.sold, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.open, 1);
  assert.equal(summary.moneyTiedUp, 55.28);
  assert.equal(summary.totalProfit, -43.2);
  assert.equal(summary.averageProfit, -21.6);
  assert.equal(summary.averageVsEstimate, -12.92, "made $12.92 less than BagSpec guessed");
});

// A tiny stand-in for Cloudflare D1 that records every query.
function fakeDb({ listing = null } = {}) {
  const queries = [];
  const statement = (sql) => {
    const entry = { sql, params: [] };
    queries.push(entry);
    return {
      bind(...params) { entry.params = params; return this; },
      async run() { return { meta: { last_row_id: 42, changes: 1 } }; },
      async first() { return /FROM listings/.test(sql) ? listing : null; },
      async all() { return { results: [] }; },
    };
  };
  return { queries, prepare: statement };
}

function post(path, body, contentType = "application/json") {
  return new Request("https://bagspec.com" + path, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: JSON.stringify(body),
  });
}

test("'I bought this' saves the listing's item to inventory", async () => {
  const DB = fakeDb({ listing: { id: 7, title: "Canon PowerShot G7 X for parts" } });
  const request = post("/api/inventory", { listingId: 7, purchasePrice: "38", inboundShipping: "6" });
  const response = await handleInventoryRequest(request, { DB }, new URL(request.url));
  assert.equal(response.status, 201);
  const insert = DB.queries.find((q) => /INSERT INTO inventory/.test(q.sql));
  assert.deepEqual(insert.params.slice(0, 5), [7, "Canon PowerShot G7 X for parts", 38, 6, 2.64]);
});

test("updates only touch allowed columns, and bad input is refused", async () => {
  const DB = fakeDb();
  const ok = post("/api/inventory/42", { status: "sold", salePrice: "120", saleChannel: "Local" });
  assert.equal((await handleInventoryRequest(ok, { DB }, new URL(ok.url))).status, 200);
  const update = DB.queries.find((q) => /^UPDATE inventory/.test(q.sql));
  assert.match(update.sql, /status = \?, sale_channel = \?/);
  assert.ok(update.params.includes(0), "local sale has no fees");
  assert.equal(update.params.at(-1), 42);

  const bad = post("/api/inventory/42", { status: "sold" });
  const badResponse = await handleInventoryRequest(bad, { DB }, new URL(bad.url));
  assert.equal(badResponse.status, 400);
  assert.match((await badResponse.json()).error, /salePrice/);

  const notJson = post("/api/inventory", { purchasePrice: 1 }, "text/plain");
  assert.equal((await handleInventoryRequest(notJson, { DB }, new URL(notJson.url))).status, 400);
});
