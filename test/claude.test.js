import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import {
  CLAUDE_MODEL,
  validateVerdict,
  verifyDealWithClaude,
} from "../src/claude.js";

// A fake Anthropic client: records the request and returns (or throws)
// whatever the test gives it. No network, no API key, no cost.
function fakeClient(respond) {
  const calls = [];
  return {
    calls,
    messages: {
      async create(params) {
        calls.push(params);
        return respond(params);
      },
    },
  };
}

function claudeReply(verdict, stopReason = "end_turn") {
  return {
    stop_reason: stopReason,
    content: [{ type: "text", text: JSON.stringify(verdict) }],
    usage: { input_tokens: 1800, output_tokens: 250 },
  };
}

const comparables = [
  { title: "Nikon D700 12.1MP DSLR Camera Body", total: 249 },
  { title: "Nikon D700 Digital SLR Body Only - Tested", total: 260 },
  { title: "Nikon D700 FX DSLR Camera Body, 30k shutter", total: 275 },
  { title: "Nikon D700 Body w/ Battery and Charger", total: 292 },
];

const context = {
  listing: {
    title: "Nikon D700 DSLR Body - works, needs new battery",
    dealType: "repair",
    category: "Cameras",
    condition: "For parts or not working",
    price: 90,
    inboundShipping: 0,
    details: { shortDescription: "Powers on with external grip. Battery will not hold a charge." },
  },
  comparables,
  ebayResale: 224.1,
  localResale: 179.28,
  localResaleRate: 0.8,
  outboundShipping: 15,
  purchaseCost: 95.4,
  partsCost: 30,
  riskReserve: 5,
  recommendedChannel: "eBay",
  estimatedProfit: 52.62,
};

const goodBuy = {
  verdict: "buy",
  listingMatchesComps: true,
  matchingCompIndexes: [0, 1, 2, 3],
  estimatedResale: 240,
  estimatedProfitAfterFees: 56.5,
  confidence: 82,
  authenticityRedFlags: [],
  mismatchReasons: [],
  reason: "All four comparables are working D700 bodies; a battery is a cheap, stated fix.",
};

test("a matching listing with enough profit is approved as a BUY", async () => {
  const client = fakeClient(() => claudeReply(goodBuy));
  const result = await verifyDealWithClaude(client, context, { minimumProfit: 50 });

  assert.equal(result.approved, true);
  assert.equal(result.verdict, "buy");
  assert.equal(result.matchingCompCount, 4);
  assert.equal(result.estimatedProfitAfterFees, 56.5);
  assert.equal(result.clearMismatch, false);

  // The request uses the agreed model and asks for schema-checked JSON.
  const [request] = client.calls;
  assert.equal(request.model, CLAUDE_MODEL);
  assert.equal(request.model, "claude-sonnet-5-5");
  assert.equal(request.output_config.format.type, "json_schema");
  assert.ok(request.max_tokens <= 4000, "output is capped to keep cost low");
  assert.match(request.messages[0].content, /Nikon D700/);
});

test("a listing that does not match its comparables is a PASS", async () => {
  // Canon G7 X Mark I priced against Mark III comps, the real bug seen in the logs.
  const client = fakeClient(() => claudeReply({
    verdict: "pass",
    listingMatchesComps: false,
    matchingCompIndexes: [],
    estimatedResale: 300,
    estimatedProfitAfterFees: -40,
    confidence: 90,
    authenticityRedFlags: [],
    mismatchReasons: ["Comparables are G7 X Mark III; the listing is a Mark I"],
    reason: "Wrong generation: the comparables are a newer, pricier model.",
  }));
  const result = await verifyDealWithClaude(client, context, { minimumProfit: 50 });

  assert.equal(result.approved, false);
  assert.equal(result.verdict, "pass");
  assert.equal(result.clearMismatch, true, "a confident mismatch drops to PASS, not WATCH");
  assert.ok(result.redFlags.some((flag) => /Mark III/.test(flag)));
});

test("a 'buy' with authenticity red flags is still a PASS", async () => {
  const client = fakeClient(() => claudeReply({
    ...goodBuy,
    authenticityRedFlags: ["AirPods Max at 40% of market with 'one of one' wording"],
  }));
  const result = await verifyDealWithClaude(client, context, { minimumProfit: 50 });
  assert.equal(result.approved, false);
  assert.equal(result.clearMismatch, true);
});

test("a 'buy' whose own profit is below the minimum is a PASS", async () => {
  const client = fakeClient(() => claudeReply({ ...goodBuy, estimatedProfitAfterFees: 20 }));
  const result = await verifyDealWithClaude(client, context, { minimumProfit: 50 });
  assert.equal(result.approved, false);
  assert.match(result.reason, /below \$50/);
});

test("a low-confidence 'buy' is a PASS", async () => {
  const client = fakeClient(() => claudeReply({ ...goodBuy, confidence: 60 }));
  const result = await verifyDealWithClaude(client, context, { minimumProfit: 50 });
  assert.equal(result.approved, false);
});

test("an API error is a PASS, never a BUY", async () => {
  const client = fakeClient(() => {
    throw new Anthropic.InternalServerError(500, { type: "error" }, "overloaded", new Headers());
  });
  const result = await verifyDealWithClaude(client, context, { minimumProfit: 50 });
  assert.equal(result.approved, false);
  assert.equal(result.verdict, "pass");
  assert.match(result.reason, /API error 500/);
});

test("a network error is a PASS", async () => {
  const client = fakeClient(() => { throw new TypeError("fetch failed"); });
  const result = await verifyDealWithClaude(client, context, { minimumProfit: 50 });
  assert.equal(result.approved, false);
});

test("invalid JSON is a PASS", async () => {
  const client = fakeClient(() => ({
    stop_reason: "end_turn",
    content: [{ type: "text", text: "Sure! This looks like a great buy." }],
  }));
  const result = await verifyDealWithClaude(client, context, { minimumProfit: 50 });
  assert.equal(result.approved, false);
  assert.match(result.reason, /invalid answer/);
});

test("JSON that breaks the schema is a PASS", async () => {
  const client = fakeClient(() => claudeReply({ ...goodBuy, confidence: 0.82 }));
  const result = await verifyDealWithClaude(client, context, { minimumProfit: 50 });
  assert.equal(result.approved, false);
});

test("a refusal or cut-off answer is a PASS", async () => {
  for (const stopReason of ["refusal", "max_tokens"]) {
    const client = fakeClient(() => claudeReply(goodBuy, stopReason));
    const result = await verifyDealWithClaude(client, context, { minimumProfit: 50 });
    assert.equal(result.approved, false, stopReason);
  }
});

test("matching indexes that point at no comparable do not count", async () => {
  const client = fakeClient(() => claudeReply({ ...goodBuy, matchingCompIndexes: [0, 7, 9, 9] }));
  const result = await verifyDealWithClaude(client, context, { minimumProfit: 50 });
  assert.equal(result.matchingCompCount, 1);
  assert.equal(result.approved, false);
});

test("no API key means no check and no BUY", async () => {
  const result = await verifyDealWithClaude(null, context, { minimumProfit: 50 });
  assert.equal(result.approved, false);
  assert.match(result.reason, /ANTHROPIC_API_KEY/);
});

test("validateVerdict rejects missing fields", () => {
  const { reason, ...missing } = goodBuy;
  assert.throws(() => validateVerdict(missing), /reason/);
  assert.equal(validateVerdict(goodBuy).verdict, "buy");
});
