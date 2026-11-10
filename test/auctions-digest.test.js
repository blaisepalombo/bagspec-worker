import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildWatchDigestPayload,
  getAuctionMaxBid,
  getLocalDigestClock,
  getSellerRejectReason,
  getStatedHandheldFault,
  getUnverifiedConsoleReason,
  isAuctionInWindow,
  isHandheldTitle,
  toEbayDate,
} from "../src/index.js";

function consoleListing(title, condition = "For parts or not working") {
  return { title, condition, category: "Game Consoles" };
}

test("broken handhelds with a simple stated fault are no longer rejected", () => {
  for (const title of [
    "Nintendo 3DS XL Red For Parts Broken Hinge",
    "Nintendo DS Lite cracked top screen for parts",
    "Nintendo Switch Lite for parts left stick drift",
  ]) {
    const listing = consoleListing(title);
    assert.equal(getUnverifiedConsoleReason(listing), null, title);
    assert.equal(getSellerRejectReason(listing), null, title);
  }
});

test("handhelds that won't power on, and home consoles, are still rejected", () => {
  assert.ok(getSellerRejectReason(consoleListing("Nintendo 3DS XL for parts does not turn on")));
  assert.ok(getUnverifiedConsoleReason(consoleListing("PS4 Slim for parts no hdd")));
  assert.ok(getSellerRejectReason({
    title: "Dell Latitude 7490 cracked screen for parts", condition: "For parts", category: "Business Laptops",
  }), "laptop display damage still rejected");
});

test("handheld helpers", () => {
  assert.equal(isHandheldTitle("Nintendo 3DS XL"), true);
  assert.equal(isHandheldTitle("Game Boy Advance SP"), true);
  assert.equal(isHandheldTitle("PlayStation 4 Slim"), false);
  assert.equal(getStatedHandheldFault("broken hinge"), "hinge");
  assert.equal(getStatedHandheldFault("comes with charger"), null);
});

test("auctions are picked up only when ending 10 minutes to 12 hours from now", () => {
  const now = Date.UTC(2026, 10, 10, 18, 0, 0);
  const at = (minutes) => new Date(now + minutes * 60000).toISOString();
  assert.equal(isAuctionInWindow(at(5), now), false, "too late to bid");
  assert.equal(isAuctionInWindow(at(45), now), true);
  assert.equal(isAuctionInWindow(at(170), now), true);
  assert.equal(isAuctionInWindow(at(600), now), true);
  assert.equal(isAuctionInWindow(at(800), now), false, "too far away");
  assert.equal(isAuctionInWindow(null, now), false);
  assert.equal(toEbayDate(now + 123), "2026-11-10T18:00:00Z");
});

test("the max bid keeps $25 profit and a 50% return within budget", () => {
  // Resale $110 on eBay: fee $15.36, ship $15, pack $5, parts $15, risk $5.
  const net = 110 - 15.36 - 15 - 5 - 15 - 5; // 54.64 left for buy + profit
  const other = 15 + 5 + 15; // parts + packing + outbound shipping
  const maxBid = getAuctionMaxBid({
    netForBuyAndProfit: net, otherInvestment: other,
    buyProfit: 25, buyRoi: 50, inboundShipping: 6, budget: 50,
  });
  // Profit limit: all-in <= 29.64. ROI limit: (54.64 - 17.5) / 1.5 = 24.76.
  // 24.76 / 1.06 - 6 = 17.36, rounded down.
  assert.equal(maxBid, 17);

  const allIn = (maxBid + 6) * 1.06;
  const profit = net - allIn;
  assert.ok(profit >= 25, `profit ${profit}`);
  assert.ok(profit / (allIn + other) >= 0.5, "ROI at least 50%");

  assert.equal(getAuctionMaxBid({
    netForBuyAndProfit: 300, otherInvestment: 0, buyProfit: 25, buyRoi: 50, inboundShipping: 0, budget: 50,
  }), 47, "never above the $50 budget");
  assert.equal(getAuctionMaxBid({
    netForBuyAndProfit: 10, otherInvestment: 10, buyProfit: 25, buyRoi: 50, inboundShipping: 5, budget: 50,
  }), 0, "never negative");
});

test("the digest goes out after 7pm Idaho time", () => {
  // 02:30 UTC on Nov 11 is 7:30pm on Nov 10 in Idaho (MST, UTC-7).
  assert.deepEqual(getLocalDigestClock(new Date("2026-11-11T02:30:00Z")), { date: "2026-11-10", hour: 19 });
  assert.equal(getLocalDigestClock(new Date("2026-11-10T18:00:00Z")).hour, 11);
});

test("the digest lists near-deals, or says it is still scanning", () => {
  const payload = buildWatchDigestPayload([{
    title: "Nintendo 3DS XL broken hinge", item_url: "https://www.ebay.com/itm/1",
    total_buy_cost: 32.5, estimated_profit: 21, roi_percent: 48, category: "Game Consoles",
    deal_type: "auction", suggested_offer: 28, recommendation: "WATCH",
  }], "2026-11-10");
  assert.match(payload.content, /daily digest \(2026-11-10\)/);
  assert.match(payload.embeds[0].description, /3DS XL/);
  assert.match(payload.embeds[0].description, /bid up to \$28/);

  assert.match(buildWatchDigestPayload([], "2026-11-10").content, /Still scanning/);
});

test("auction prices come from the current bid", async () => {
  const { getListedPrice } = await import("../src/index.js");
  assert.equal(getListedPrice({ currentBidPrice: { value: "12.50" } }), 12.5);
  assert.equal(getListedPrice({ price: { value: "30.00" } }), 30);
  assert.equal(getListedPrice({ currentBidPrice: { value: "9.99" }, price: { value: "0.00" } }), 9.99);
  assert.equal(getListedPrice({}), 0);
});
