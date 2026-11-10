import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getAccessoryRejectReason,
  getCategoryRejectReason,
  getMarkVariant,
  getTooCheapReason,
  isControllerOnlyTitle,
  selectComparables,
  stripIncludedExtras,
} from "../src/index.js";

function ebayItem(title, price, extra = {}) {
  return {
    itemId: `v1|${title}|0`,
    title,
    condition: "Used",
    buyingOptions: ["FIXED_PRICE"],
    price: { value: String(price) },
    shippingOptions: [{ shippingCost: { value: "0.00" } }],
    ...extra,
  };
}

function compTitles(result) {
  return result.comparables.map((comp) => comp.title);
}

test("Mark I is not priced against Mark II or Mark III", () => {
  // Real case: a G7 X Mark I was valued from $949-$1090 Mark III listings
  // because "20.1MP" was taken as the model number.
  const items = [
    ebayItem("Canon PowerShot G7 X Mark III 20.1MP Black", 949),
    ebayItem("Canon PowerShot G7X Mark III 20.1MP Digital Camera", 999),
    ebayItem("Canon PowerShot G7 X Mark II 20.1MP Camera", 520),
    ebayItem("Canon PowerShot G7 X 20.1MP Black Compact Camera", 330),
    ebayItem("Canon PowerShot G7 X Mark I 20.1 MP Digital Camera", 345),
    ebayItem("Canon PowerShot G7X Digital Camera Black", 360),
  ];
  const result = selectComparables(items, {
    originalWords: "Canon PowerShot G7 X Mark I 20.1MP Black".split(" "),
    category: "Cameras",
  });
  assert.deepEqual(compTitles(result).sort(), [
    "Canon PowerShot G7 X 20.1MP Black Compact Camera",
    "Canon PowerShot G7 X Mark I 20.1 MP Digital Camera",
    "Canon PowerShot G7X Digital Camera Black",
  ]);
});

test("Canon EOS 5D is matched on the 5D model, not on 'Canon' and 'EOS'", () => {
  const items = [
    ebayItem("Canon EOS 5D Mark IV Body", 1300),
    ebayItem("Canon EOS 5D Mark III DSLR Body", 600),
    ebayItem("Canon EOS 90D DSLR Camera Body", 800),
    ebayItem("Canon EOS 5D 12.8MP DSLR Body", 190),
    ebayItem("Canon EOS 5D Classic Digital Camera Body", 210),
    ebayItem("Canon 5D Original Full Frame DSLR Body", 199),
  ];
  const result = selectComparables(items, {
    originalWords: "Canon EOS 5D Digital SLR Camera Body Only".split(" "),
    category: "Cameras",
  });
  assert.deepEqual(compTitles(result).sort(), [
    "Canon 5D Original Full Frame DSLR Body",
    "Canon EOS 5D 12.8MP DSLR Body",
    "Canon EOS 5D Classic Digital Camera Body",
  ]);
});

test("complete laptops that list their charger or backlit keyboard count as comps", () => {
  const items = [
    ebayItem("HP EliteBook 850 G5 i5-8350U 8GB 256GB SSD w/ Charger", 165),
    ebayItem("HP EliteBook 850 G5 15.6\" i5-8350U 8GB Backlit Keyboard Webcam", 175),
    ebayItem("HP EliteBook 850 G5 Laptop i5-8350U 8GB RAM with AC Adapter", 180),
    ebayItem("Charger for HP EliteBook 850 G5 i5-8350U 8GB", 90),
    ebayItem("HP EliteBook 850 G5 i5-8350U 8GB Keyboard Replacement", 95),
  ];
  const result = selectComparables(items, {
    originalWords: "HP EliteBook 850 G5 Intel Core i5-8350U 8GB".split(" "),
    category: "Business Laptops",
  });
  assert.equal(result.count, 3);
  assert.ok(compTitles(result).every((title) => !/^Charger|Replacement/.test(title)));
});

test("controllers never price a console", () => {
  assert.equal(isControllerOnlyTitle("Microsoft Elite Series 2 Wireless Controller for Xbox Series S/X/One"), true);
  assert.equal(isControllerOnlyTitle("Nintendo Switch Pokemon Scarlet & Violet Edition Joy Cons-Left and Right-Tested!"), true);
  assert.equal(isControllerOnlyTitle("Xbox Series X 1TB Console with Controller"), false);
  assert.equal(isControllerOnlyTitle("PS4 Slim with 2 controllers"), false);
  assert.equal(isControllerOnlyTitle("Nintendo Switch OLED White Joy-Con"), false);

  assert.match(
    getCategoryRejectReason("Microsoft Elite Series 2 Wireless Controller for Xbox Series S/X/One", "Game Consoles"),
    /Controller/
  );

  const items = [
    ebayItem("Microsoft Xbox Series X 1TB Console", 400),
    ebayItem("Xbox Series X Wireless Controller Carbon Black", 45),
  ];
  const result = selectComparables(items, {
    originalWords: "Microsoft Xbox Series X 1TB".split(" "),
    category: "Game Consoles",
  });
  assert.deepEqual(compTitles(result), ["Microsoft Xbox Series X 1TB Console"]);
});

test("an empty chassis is not a laptop", () => {
  assert.match(getAccessoryRejectReason("HP EliteBook 840 G11 Chassis"), /chassis/i);
  assert.equal(getAccessoryRejectReason("HP EliteBook 840 G11 Laptop i7 16GB"), null);
});

test("a working item at under half the market is flagged as too cheap", () => {
  // The AirPods Max BUY: $64.33 when working pairs asked $135+.
  const comps = { prices: [134.99, 142.99, 145, 146.99, 149.99, 150, 154.99, 159.99] };
  assert.match(getTooCheapReason(64.33, comps), /likely fake/);
  assert.equal(getTooCheapReason(95, comps), null);
  assert.equal(getTooCheapReason(10, { prices: [100, 120] }), null, "needs 3+ comps");
});

test("helpers", () => {
  assert.equal(getMarkVariant("Canon G7 X Mark III"), 3);
  assert.equal(getMarkVariant("Canon 5D MkII body"), 2);
  assert.equal(getMarkVariant("Canon EOS 5D"), null);
  assert.equal(stripIncludedExtras("Dell Latitude 7490 w/ Charger & Case"), "Dell Latitude 7490");
});
