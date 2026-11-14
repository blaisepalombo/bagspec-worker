import { test } from "node:test";
import assert from "node:assert/strict";
import { getScamCheck, SCAM_BLOCK_POINTS, SCAM_PASS_POINTS } from "../src/index.js";
import { buildUserMessageForTest } from "../src/claude.js";

// Working AirPods Max ask $110-150; comparables' lower quartile is $115.
const comps = { prices: [110, 115, 120, 125, 130, 135, 140, 150] };
const check = (listing, details, isFlip = true) => getScamCheck({ listing, details, comps, isFlip });

// The real production BUY: $64.33 all-in, no returns, description = title.
const airpodsTitle = "Apple AirPods Max Over-Ear Wireless Bluetooth Headphones one of one";
const airpods = { title: airpodsTitle, total_buy_cost: 64.33 };

test("the production AirPods Max scam is passed", () => {
  const result = check(airpods, {
    fullDescription: airpodsTitle, returnsAccepted: false,
    seller: { feedbackScore: 2, feedbackPercentage: 100 }, imageCount: 1,
  });
  assert.ok(result.points >= SCAM_PASS_POINTS, `points ${result.points}`);
  assert.ok(result.flags.includes("the description only repeats the title"));
  assert.ok(result.flags.includes("no returns"));
  assert.ok(result.flags.some((f) => /new seller \(2 feedback\)/.test(f)));
  assert.ok(result.flags.some((f) => /priced at 56% of what working ones ask/.test(f)));
});

test("it is caught even on older listings without seller or photo data", () => {
  const result = check(airpods, { fullDescription: airpodsTitle, returnsAccepted: false });
  assert.equal(result.points, 5, "repeats title (2) + no returns (1) + priced at 56% (2)");
});

test("a real deal with a real description is not flagged", () => {
  const result = check({ title: "Apple AirPods Max AUTHENTIC Headphones w/ Mic Silver/White", total_buy_cost: 153.7 }, {
    fullDescription: "Authentic, used. Has quite a bit of cosmetic wear, see photos for details, works.\n\nNo returns, free shipping.",
    returnsAccepted: false, seller: { feedbackScore: 412, feedbackPercentage: 100 }, imageCount: 9,
  });
  assert.deepEqual(result.flags, ["no returns"]);
  assert.ok(result.points < SCAM_BLOCK_POINTS, "still eligible for BUY");
});

test("some warning signs block BUY but keep the deal as WATCH", () => {
  const result = check({ title: "Apple AirPods Max Over-Ear Wireless Bluetooth Headphones, Black", total_buy_cost: 94.32 }, {
    fullDescription: "Apple AirPods Max Over-Ear Wireless Bluetooth Headphones, Black", returnsAccepted: true,
    seller: { feedbackScore: 150, feedbackPercentage: 99.5 }, imageCount: 6,
  });
  assert.ok(result.points >= SCAM_BLOCK_POINTS && result.points < SCAM_PASS_POINTS, `points ${result.points}`);
});

test("paying outside eBay is always passed, for any deal type", () => {
  const details = { fullDescription: "Works great. Send payment by Zelle for a discount." };
  assert.match(check({ title: "Nintendo Switch", total_buy_cost: 80 }, details).hardReason, /outside eBay/);
  assert.match(check({ title: "Nintendo Switch for parts", total_buy_cost: 40 }, details, false).hardReason, /outside eBay/);
  assert.equal(check({ title: "Switch", total_buy_cost: 80 }, { fullDescription: "Ships fast via USPS. Tested and working great, includes dock." }).hardReason, null);
});

test("a box, picture or part sold as a working device is passed", () => {
  for (const title of [
    "Canon DSLR EOS R100 Mainboard Main Board PCB Replacement Part CG27437",
    "PS5 Console Box Only No Console",
    "Apple AirPods Max Replica 1:1",
    "Picture of Nintendo Switch OLED",
    "MacBook Pro A1708 Logic Board Only",
  ]) {
    assert.match(check({ title, total_buy_cost: 50 }, { fullDescription: "Long enough description of the item for sale here." }).hardReason || "", /not a working device/, title);
  }
  assert.equal(check({ title: "Dell Latitude 7490 laptop with new motherboard", total_buy_cost: 120 },
    { fullDescription: "Motherboard replaced last month, everything works and battery holds charge." }).hardReason, null);
});

test("stock photos, contact details and weak feedback add warning signs", () => {
  const result = check({ title: "Sony WH-1000XM4", total_buy_cost: 120 }, {
    fullDescription: "Stock photo shown. Questions? Call 208-555-0199. Works fine with all features.",
    seller: { feedbackScore: 40, feedbackPercentage: 92.1 },
  });
  assert.ok(result.flags.includes("the seller says the photos are not of the actual item"));
  assert.ok(result.flags.includes("the description lists a phone number or email"));
  assert.ok(result.flags.includes("seller feedback is 92.1%"));
});

test("repair listings only get the outside-eBay check", () => {
  const result = check(airpods, { fullDescription: airpodsTitle, returnsAccepted: false }, false);
  assert.deepEqual(result, { hardReason: null, points: 0, flags: [] });
});

test("Claude's BUY check is given the seller, photo count and warning signs", () => {
  const message = JSON.parse(buildUserMessageForTest({
    listing: { title: "x", scamFlags: ["no returns"], details: { seller: { feedbackScore: 3 }, imageCount: 1 } },
  }, 25));
  assert.deepEqual(message.listing.seller, { feedbackScore: 3 });
  assert.equal(message.listing.photoCount, 1);
  assert.deepEqual(message.listing.bagspecWarningSigns, ["no returns"]);
});
