import { test } from "node:test";
import assert from "node:assert/strict";
import { buildComparableSearchQuery, findWorkingComparables, titleHasModel } from "../src/index.js";

const words = (text) => text.split(/\s+/);

test("the eBay search keeps the words that make a model a different product", () => {
  assert.equal(buildComparableSearchQuery(words("Texas Instruments TI-84 Plus CE graphing calculator"), "Graphing Calculators"),
    "Texas Instruments TI-84 Plus CE");
  assert.equal(buildComparableSearchQuery(words("Texas Instruments TI-83 Plus graphing calculator"), "Graphing Calculators"),
    "Texas Instruments TI-83 Plus");
  assert.equal(buildComparableSearchQuery(words("Nintendo 3DS XL handheld console"), "Game Consoles"), "Nintendo 3DS XL");
  // Unchanged when no variant word follows the model number.
  assert.equal(buildComparableSearchQuery(words("Lenovo ThinkPad T480 laptop 8GB"), "Business Laptops"), "Lenovo ThinkPad T480");
  assert.equal(buildComparableSearchQuery(words("Texas Instruments TI-84 graphing calculator"), "Graphing Calculators"),
    "Texas Instruments TI-84");
});

// A fake eBay: for a popular model the 200 cheapest results above the
// loosened floor are all $29 (under the $35 real floor); from the real floor
// there are plenty of working units.
function fakeEbay({ saturated }) {
  const searches = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/oauth2/token")) return Response.json({ access_token: "app", expires_in: 7200 });
    const [, floorText, ceilingText] = url.searchParams.get("filter").match(/price:\[(\d+)\.\.(\d*)\]/);
    const floor = Number(floorText);
    searches.push({ q: url.searchParams.get("q"), floor, ceiling: ceilingText ? Number(ceilingText) : null });
    const listing = (i, price) => ({
      itemId: `v1|${floor}${i}|0`, title: `Texas Instruments TI-83 Plus Graphing Calculator Tested Working ${i}`,
      condition: "Used", buyingOptions: ["FIXED_PRICE"], price: { value: String(price) },
      shippingOptions: [{ shippingCost: { value: "0.00" } }],
    });
    // The below-the-floor check: only a couple of units sell under $35.
    if (ceilingText) {
      return Response.json({ total: 2, itemSummaries: [listing(901, 25), listing(902, 30)] });
    }
    if (floor < 35) {
      const items = Array.from({ length: saturated ? 200 : 2 }, (_, i) => listing(i, 29));
      return Response.json({ total: saturated ? 2755 : 2, itemSummaries: items });
    }
    return Response.json({ total: 1430, itemSummaries: Array.from({ length: 12 }, (_, i) => listing(i, 36 + i)) });
  };
  return searches;
}

const env = { EBAY_CLIENT_ID: "id", EBAY_CLIENT_SECRET: "secret" };

test("a full page of too-cheap listings is searched again from the real price floor", async () => {
  const searches = fakeEbay({ saturated: true });
  const result = await findWorkingComparables(env, "Texas Instruments TI-83 Plus graphing calculator", "Graphing Calculators");
  assert.deepEqual(searches.map((s) => s.floor), [29, 35, 10], "loosened floor, real floor, then under the floor");
  assert.equal(searches[2].ceiling, 35);
  assert.equal(searches[0].q, "Texas Instruments TI-83 Plus");
  assert.equal(result.searchRetriedAtFloor, true);
  assert.equal(result.belowFloorMarket, undefined, "only 2 sell under the floor, so the floor stands");
  assert.ok(result.count >= 10, `found ${result.count} comparables`);
  assert.ok(result.conservativeResale > 0);
});

// The Nikon P90 case: working P90s sell for ~$48, under the $80 camera
// floor. Above the floor the search finds a few overpriced P90 asks and
// many P900s (a different, much pricier camera).
test("a model that sells under the floor is priced from what it sells for, not from a pricier model", async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/oauth2/token")) return Response.json({ access_token: "app", expires_in: 7200 });
    const ceiling = /price:\[\d+\.\.\d+\]/.test(url.searchParams.get("filter"));
    const item = (id, title, price) => ({
      itemId: `v1|${id}|0`, title, condition: "Used", buyingOptions: ["FIXED_PRICE"],
      price: { value: String(price) }, shippingOptions: [{ shippingCost: { value: "0.00" } }],
    });
    if (ceiling) {
      return Response.json({ total: 14, itemSummaries: [39, 42, 44, 45, 47, 48, 48, 50, 52, 55, 58, 60, 65, 72]
        .map((p, i) => item(`low${i}`, `Nikon Coolpix P90 12.1MP Digital Camera 24x Zoom Tested ${i}`, p)) });
    }
    return Response.json({ total: 12, itemSummaries: [
      ...[220, 300, 340, 349, 360, 365, 375, 390].map((p, i) => item(`p900${i}`, `Nikon Coolpix P900 16MP 83x Zoom Camera ${i}`, p)),
      ...[85, 95, 110, 120].map((p, i) => item(`p90hi${i}`, `Nikon Coolpix P90 Digital Camera Black ${i}`, p)),
    ] });
  };
  const result = await findWorkingComparables(env, "Nikon Coolpix P90 digital camera", "Cameras");
  assert.equal(result.belowFloorMarket, true);
  assert.ok(result.prices.every((p) => p < 150), `no P900 prices: ${result.prices}`);
  const median = result.prices[Math.floor(result.prices.length / 2)];
  assert.ok(median >= 40 && median <= 70, `median ${median}`);
  assert.ok(result.conservativeResale < 60, `resale ${result.conservativeResale}`);
});

test("model numbers match whole numbers only", () => {
  assert.equal(titleHasModel("Nikon Coolpix P90 Digital Camera", "p90"), true);
  assert.equal(titleHasModel("Nikon Coolpix P90 12.1MP Digital Camera", "p90"), true, "a space ends the number");
  assert.equal(titleHasModel("Nikon Coolpix P900 Digital Camera", "p90"), false);
  assert.equal(titleHasModel("Nikon COOLPIX P950", "p90"), false);
  assert.equal(titleHasModel("Lenovo ThinkPad T480s i5", "t480"), true, "letters after are a variant");
  assert.equal(titleHasModel("Sony WH-1000XM4 Headphones", "wh1000xm4"), true, "hyphens inside a model are ignored");
  assert.equal(titleHasModel("Dell 15400 Workstation", "5400"), false, "a digit before joins the number");
  assert.equal(titleHasModel("Nikon P900 and P90 bundle", "p90"), true, "a later whole match still counts");
});

test("a rare model with few listings is not searched twice", async () => {
  const searches = fakeEbay({ saturated: false });
  const result = await findWorkingComparables(env, "Texas Instruments TI-83 Plus graphing calculator", "Graphing Calculators");
  assert.equal(searches.length, 1, "no second search when eBay had nothing more");
  assert.equal(result.count, 0);
  assert.equal(result.searchRetriedAtFloor, undefined);
});
