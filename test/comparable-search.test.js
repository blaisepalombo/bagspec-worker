import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBroaderComparableQuery, buildComparableSearchQuery, cleanComparableWords, findWorkingComparables, titleHasModel } from "../src/index.js";

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

test("a rare model with few listings is not searched again at the floor, only once broader", async () => {
  const searches = fakeEbay({ saturated: false });
  const result = await findWorkingComparables(env, "Texas Instruments TI-83 Plus graphing calculator", "Graphing Calculators");
  assert.deepEqual(searches.map((s) => s.q), ["Texas Instruments TI-83 Plus", "Texas TI-83 Plus"],
    "no floor retry when eBay had nothing more; one broader try");
  assert.equal(result.count, 0);
  assert.equal(result.searchRetriedAtFloor, undefined);
  assert.equal(result.searchRetriedBroader, undefined, "the broader try found no more, so the first result stands");
});

test("seller titles are cleaned before searching for comparables", () => {
  const query = (title, category) => buildComparableSearchQuery(cleanComparableWords(title), category);
  assert.equal(query("📷Fujifilm FinePix XP70 Waterproof Digital Camera Blue", "Cameras"), "Fujifilm FinePix XP70");
  assert.equal(query("Nintendo DS Lite Noble Pink Japan", "Game Consoles"), "Nintendo DS Lite");
  assert.equal(query("Razer Barracuda X White/Gray Wired Headset USB", "Headphones"), "Razer Barracuda X Headset");
  // eBay reads parentheses as an OR group; seller codes inside are dropped.
  assert.equal(query("onn Large Rugged Speaker with Bluetooth (EPJ033664)", "Premium Audio"), "onn Large Rugged Speaker Bluetooth");
  assert.doesNotMatch(query("Nintendo DS Lite Handheld System (USG-JPN-1)", "Game Consoles"), /[()]|JPN/);
  // A model number inside brackets is kept, without the brackets.
  assert.equal(query("Sony Headphones (WH-1000XM4) Black", "Headphones"), "Sony Headphones WH-1000XM4");
  assert.equal(query("Sony PlayStation 2 Slim (SCPH-90001) Console", "Game Consoles"), "Sony PlayStation 2 Slim SCPH-90001");
  // Words that make a different product stay.
  assert.equal(query("Microsoft Xbox Series X 1TB Console", "Game Consoles"), "Microsoft Xbox Series X");
  assert.equal(query("Texas Instruments TI-84 Plus CE graphing calculator", "Graphing Calculators"), "Texas Instruments TI-84 Plus CE");
  assert.deepEqual(cleanComparableWords("🎧📷"), ["🎧📷"], "never empty");
});

test("the broader retry is brand plus model, or the title without generic words", () => {
  const broader = (title, category) => buildBroaderComparableQuery(cleanComparableWords(title), category);
  assert.equal(broader("Fujifilm FinePix S Series S2980 14MP Digital Camera", "Cameras"), "Fujifilm S2980");
  assert.equal(broader("🎧Sony Noise Canceling Headphones MDR-10RNC", "Headphones"), "Sony MDR-10RNC");
  assert.equal(broader("Razer Barracuda X White/Gray Wired Headset USB", "Headphones"), "Razer Barracuda X");
  assert.equal(broader("Microsoft Xbox Series X 1TB Console", "Game Consoles"), null, "never cut to Xbox Series");
  assert.equal(broader("Nintendo 3DS XL handheld console", "Game Consoles"), null, "already as broad as it gets");
});

test("too few comparables are searched again with brand and model", async () => {
  const searches = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/oauth2/token")) return Response.json({ access_token: "app", expires_in: 7200 });
    const q = url.searchParams.get("q");
    searches.push(q);
    if (/price:\[\d+\.\.\d+\]/.test(url.searchParams.get("filter"))) return Response.json({ total: 0, itemSummaries: [] });
    if (q !== "Sony MDR-10RNC") return Response.json({ total: 0, itemSummaries: [] });
    return Response.json({ total: 6, itemSummaries: [45, 48, 50, 52, 55, 60].map((price, i) => ({
      itemId: `v1|${i}|0`, title: `Sony MDR-10RNC Noise Cancelling Headphones ${i}`, condition: "Used",
      buyingOptions: ["FIXED_PRICE"], price: { value: String(price) }, shippingOptions: [{ shippingCost: { value: "0.00" } }],
    })) });
  };
  const result = await findWorkingComparables(env, "🎧Sony Noise Canceling Headphones MDR-10RNC", "Headphones");
  assert.deepEqual(searches.slice(0, 2), ["Sony Noise Canceling Headphones MDR-10RNC", "Sony MDR-10RNC"]);
  assert.equal(result.searchRetriedBroader, true);
  assert.ok(result.count >= 3, `found ${result.count}`);
  assert.deepEqual(result.searchQueriesTried, ["Sony Noise Canceling Headphones MDR-10RNC", "Sony MDR-10RNC"]);
});
