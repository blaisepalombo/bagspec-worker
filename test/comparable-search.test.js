import { test } from "node:test";
import assert from "node:assert/strict";
import { buildComparableSearchQuery, findWorkingComparables } from "../src/index.js";

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
    const floor = Number(url.searchParams.get("filter").match(/price:\[(\d+)\.\./)[1]);
    searches.push({ q: url.searchParams.get("q"), floor });
    const listing = (i, price) => ({
      itemId: `v1|${floor}${i}|0`, title: `Texas Instruments TI-83 Plus Graphing Calculator Tested Working ${i}`,
      condition: "Used", buyingOptions: ["FIXED_PRICE"], price: { value: String(price) },
      shippingOptions: [{ shippingCost: { value: "0.00" } }],
    });
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
  assert.deepEqual(searches.map((s) => s.floor), [29, 35]);
  assert.equal(searches[0].q, "Texas Instruments TI-83 Plus");
  assert.equal(result.searchRetriedAtFloor, true);
  assert.ok(result.count >= 10, `found ${result.count} comparables`);
  assert.ok(result.conservativeResale > 0);
});

test("a rare model with few listings is not searched twice", async () => {
  const searches = fakeEbay({ saturated: false });
  const result = await findWorkingComparables(env, "Texas Instruments TI-83 Plus graphing calculator", "Graphing Calculators");
  assert.equal(searches.length, 1, "no second search when eBay had nothing more");
  assert.equal(result.count, 0);
  assert.equal(result.searchRetriedAtFloor, undefined);
});
