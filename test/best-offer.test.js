import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker, {
  acceptsOffers,
  buildDiscordDealPayload,
  buildWatchDigestPayload,
  getAuctionMaxBid,
  getBestOfferCeiling,
  getBestOfferPlan,
  isAffordable,
  isOfferDeal,
} from "../src/index.js";
import { dealNotification } from "../src/push.js";

const env75 = { BUY_BUDGET_USD: "75" };

test("Best Offer listings may ask up to 1.4x the budget", () => {
  assert.equal(getBestOfferCeiling(env75), 105);
  assert.equal(acceptsOffers(["FIXED_PRICE", "BEST_OFFER"]), true);
  assert.equal(acceptsOffers(["FIXED_PRICE"]), false);
  assert.equal(acceptsOffers(undefined), false);

  assert.equal(isAffordable(70, env75, false), true, "in budget");
  assert.equal(isAffordable(90, env75, false), false, "over budget, no offers");
  assert.equal(isAffordable(90, env75, true), true, "over budget, takes offers");
  assert.equal(isAffordable(106, env75, true), false, "over the 1.4x ceiling");

  assert.equal(isOfferDeal(70, env75, true), false, "in budget needs no offer");
  assert.equal(isOfferDeal(90, env75, true), true);
  assert.equal(isOfferDeal(90, env75, false), false);
});

test("an offer is only realistic at 75% or more of the asking price", () => {
  assert.deepEqual(getBestOfferPlan({ maxOffer: 66, askingPrice: 88 }),
    { maxOffer: 66, minRealistic: 66, realistic: true });
  assert.equal(getBestOfferPlan({ maxOffer: 65, askingPrice: 88 }).realistic, false);
  assert.equal(getBestOfferPlan({ maxOffer: 0, askingPrice: 0 }).realistic, false);
});

test("the max offer keeps the BUY profit and return within budget", () => {
  // $160 resale on eBay: fees $22.16, $12 out, $5 packing, no parts or risk.
  const maxOffer = getAuctionMaxBid({
    netForBuyAndProfit: 160 - 22.16 - 12 - 5,
    otherInvestment: 5 + 12,
    buyProfit: 25,
    buyRoi: 50,
    inboundShipping: 8,
    budget: 75,
  });
  // The budget binds: $75 all-in / 1.06 - $8 shipping = $62.
  assert.equal(maxOffer, 62);
  const allIn = (maxOffer + 8) * 1.06;
  assert.ok(allIn <= 75);
  const profit = 160 - 22.16 - 12 - 5 - allIn;
  assert.ok(profit >= 25 && profit / (allIn + 17) >= 0.5);
});

test("alerts say how much to offer", () => {
  const push = dealNotification({ id: 9, title: "Sony a6000 body", deal_type: "flip", recommendation: "BUY",
    offer_needed: 1, suggested_offer: 62, price: 85, total_buy_cost: 98.58, estimated_profit: 41 });
  assert.equal(push.kind, "buy");
  assert.equal(push.message.body, "Offer up to $62.00 (asks $85.00) · est. $41.00 profit");

  const plain = dealNotification({ id: 10, title: "Sony a6000 body", deal_type: "flip", recommendation: "BUY",
    offer_needed: 0, suggested_offer: 50, price: 60, total_buy_cost: 68, estimated_profit: 41 });
  assert.equal(plain.message.body, "$68.00 all-in · est. $41.00 profit");

  const discord = buildDiscordDealPayload({ id: 9, title: "Sony a6000 body", item_url: "https://www.ebay.com/itm/9",
    deal_type: "flip", recommendation: "BUY", offer_needed: 1, suggested_offer: 62, price: 85,
    total_buy_cost: 98.58, estimated_profit: 41, reasoning: "{}" });
  assert.match(discord.content, /Best Offer deal\*\*: offer up to \$62\.00/);
  const field = discord.embeds[0].fields.find((f) => f.name === "Offer up to");
  assert.equal(field.value, "$62.00 (asks $85.00)");

  const digest = buildWatchDigestPayload([{ title: "Sony a6000 body", item_url: "https://www.ebay.com/itm/9",
    total_buy_cost: 98.58, estimated_profit: 30, roi_percent: 40, category: "Cameras", deal_type: "flip",
    offer_needed: 1, suggested_offer: 62, price: 85, recommendation: "WATCH" }], "2026-11-13");
  assert.match(digest.embeds[0].description, /working flip, offer up to \$62 \(asks \$85\)/);
});

// --- Scan: the Best Offer search and the budget gate ---------------------

const db = new DatabaseSync(":memory:");
db.exec(readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8"));
db.exec(readFileSync(new URL("../migrations/0002_scanner_v2.sql", import.meta.url), "utf8"));
db.exec("ALTER TABLE searches ADD COLUMN last_scanned_at TEXT");
db.exec(`INSERT INTO searches (id, name, query, category, max_price, enabled, category_id, profile_key)
  VALUES (109, 'Cameras', 'camera', 'Cameras', 300, 1, '31388', 'Cameras')`);
function fakeD1() {
  const statement = (sql, params = []) => ({
    bind: (...values) => statement(sql, values),
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    first: async () => db.prepare(sql).get(...params) ?? null,
    run: async () => {
      const info = db.prepare(sql).run(...params);
      return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
    },
  });
  return { prepare: (sql) => statement(sql), batch: async (list) => { const out = []; for (const s of list) out.push(await s.run()); return out; } };
}

test("a scan searches Best Offer listings just over budget and keeps those that take offers", async () => {
  // Pin the clock to a cycle that runs the Best Offer search.
  const realNow = Date.now;
  const slot = Math.floor(realNow() / 300000);
  let now = (slot % 2 === 0 ? slot : slot + 1) * 300000 + 1000;
  Date.now = () => now;
  const realFetch = globalThis.fetch;
  const offerFilters = [];
  const posted = new Date(now - 30 * 60 * 1000).toISOString();
  const offerItem = (id, price, options) => ({
    itemId: `v1|${id}|0`,
    title: `Canon EOS Rebel T6 camera body for parts shutter error ${id}`,
    itemWebUrl: `https://www.ebay.com/itm/${id}`,
    condition: "For parts or not working",
    conditionId: "7000",
    price: { value: String(price), currency: "USD" },
    buyingOptions: options,
    shippingOptions: [{ shippingCostType: "FIXED", shippingCost: { value: "5.00", currency: "USD" } }],
    itemCreationDate: posted,
    seller: { username: "seller" + id },
  });
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/identity/v1/oauth2/token")) return Response.json({ access_token: "t", expires_in: 7200 });
    if (url.pathname.includes("/item_summary/search")) {
      const filter = url.searchParams.get("filter") || "";
      if (!filter.includes("BEST_OFFER")) return Response.json({ total: 0, itemSummaries: [] });
      offerFilters.push(filter);
      // Only the Cameras search (eBay category 31388) has these listings.
      if (url.searchParams.get("category_ids") !== "31388") return Response.json({ total: 0, itemSummaries: [] });
      return Response.json({ total: 3, itemSummaries: [
        offerItem(501, 85, ["FIXED_PRICE", "BEST_OFFER"]),
        offerItem(502, 110, ["FIXED_PRICE", "BEST_OFFER"]),
        offerItem(503, 85, ["FIXED_PRICE"]),
      ] });
    }
    if (url.pathname.includes("/buy/browse/v1/item/")) {
      const id = decodeURIComponent(url.pathname.split("/").pop()).split("|")[1];
      return Response.json({ ...offerItem(id, 85, ["FIXED_PRICE", "BEST_OFFER"]), description: "Shutter error 20." });
    }
    throw new Error("Unexpected fetch " + url);
  };
  try {
    const env = { DB: fakeD1(), EBAY_CLIENT_ID: "id", EBAY_CLIENT_SECRET: "secret", BAGSPEC_ADMIN_KEY: "k", BUY_BUDGET_USD: "75" };
    // The Best Offer search rotates through categories every other cycle;
    // scan until it reaches Cameras.
    let cameraScanned = false;
    for (let tries = 0; tries < 40 && !cameraScanned; tries += 1) {
      const before = offerFilters.length;
      const response = await worker.fetch(new Request("https://bagspec.com/scan", {
        headers: { Authorization: "Basic " + btoa("bagspec:k") },
      }), env);
      const body = await response.json();
      assert.ok(!body.error, JSON.stringify(body));
      assert.equal(offerFilters.length - before, 1, "one Best Offer search per even cycle");
      cameraScanned = db.prepare("SELECT COUNT(*) AS n FROM listings").get().n > 0;
      now += 2 * 300000;
    }
    assert.ok(cameraScanned, "the rotation reaches Cameras");
    assert.match(offerFilters[0], /buyingOptions:\{BEST_OFFER\}/);
    // $70 is the normal ceiling ($75 budget less tax); offers run to $105 / 1.06.
    assert.match(offerFilters[0], /price:\[71\.\.99\]/);

    const rows = Object.fromEntries(db.prepare("SELECT ebay_item_id, reasoning, deal_type FROM listings").all()
      .map((row) => [row.ebay_item_id, row]));
    assert.ok(rows["v1|501|0"], "the $85 listing that takes offers is saved");
    assert.doesNotMatch(rows["v1|501|0"].reasoning, /Over budget/, "and screened, not rejected for price");
    assert.equal(rows["v1|501|0"].deal_type, "repair", "for-parts items take the repair path");
    assert.match(rows["v1|502|0"].reasoning, /Over budget/, "$121.90 all-in is past the 1.4x ceiling");
    assert.equal(rows["v1|503|0"], undefined, "listings without Best Offer are dropped before saving");

    // Enrichment must pick up the over-budget offer listing and keep it.
    const enriched = await (await worker.fetch(new Request("https://bagspec.com/enrich", {
      headers: { Authorization: "Basic " + btoa("bagspec:k") },
    }), env)).json();
    assert.ok(!enriched.error, JSON.stringify(enriched));
    const after = db.prepare("SELECT analysis_status, total_buy_cost FROM listings WHERE ebay_item_id = 'v1|501|0'").get();
    assert.equal(after.analysis_status, "details_ready", "enriched, not dropped as over budget");
    assert.equal(after.total_buy_cost, 95.4, "the asking price stays on the listing");

    const columns = db.prepare("PRAGMA table_info(listings)").all().map((c) => c.name);
    assert.ok(columns.includes("offer_needed"), "the offer flag column is added at runtime");
  } finally {
    Date.now = realNow;
    globalThis.fetch = realFetch;
  }
});
