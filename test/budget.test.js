import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import {
  CLAUDE_SCREEN_MODEL,
  estimateCostUsd,
  screenRepairWithClaude,
} from "../src/claude.js";
import {
  getBuyBudget,
  getDecisionThresholds,
  getMaxItemPrice,
  summarizeClaudeBudget,
} from "../src/index.js";

test("the buy budget defaults to $50 and fits tax under it", () => {
  assert.equal(getBuyBudget({}), 50);
  assert.equal(getBuyBudget({ BUY_BUDGET_USD: "80" }), 80);
  assert.equal(getBuyBudget({ BUY_BUDGET_USD: "" }), 50);
  assert.equal(getMaxItemPrice({}), 47, "$47 + 6% tax is under $50");
});

test("small-budget deals need $25 profit and a 50% return", () => {
  const small = getDecisionThresholds("Cameras", 50);
  assert.equal(small.buyProfit, 25);
  assert.equal(small.buyRoi, 50);
  assert.equal(getDecisionThresholds("Cameras", 300).buyProfit, 50);
});

test("Claude costs are estimated from token usage", () => {
  // 3,000 input + 1,000 output on Sonnet: $0.006 + $0.01.
  assert.equal(estimateCostUsd("claude-sonnet-5-5", { input: 3000, output: 1000 }), 0.016);
  // The same on Haiku is 20x cheaper.
  assert.equal(estimateCostUsd("claude-haiku-5-5", { input: 3000, output: 1000 }), 0.0008);
  assert.equal(estimateCostUsd("unknown", { input: 1, output: 1 }), 0);
});

test("the monthly budget blocks screening when today's share or the month is spent", () => {
  assert.equal(summarizeClaudeBudget(8, 2, 0.1).screeningAllowed, true);
  assert.equal(summarizeClaudeBudget(8, 2, 0.27).screeningAllowed, false, "over $8/30 today");
  assert.equal(summarizeClaudeBudget(8, 8, 0).screeningAllowed, false, "month used up");
  assert.ok(summarizeClaudeBudget(8, 8.5, 0).monthRemaining < 0);
});

function fakeClient(respond) {
  const calls = [];
  return { calls, messages: { async create(params) { calls.push(params); return respond(params); } } };
}

const screenAnswer = {
  itemName: "Nintendo 3DS XL",
  comparisonSearchQuery: "Nintendo 3DS XL",
  likelyIssue: "Broken top hinge",
  faultType: "hinge",
  repairDifficulty: 4,
  repairRisk: 3,
  repairSuccessProbability: 80,
  partsCostLow: 8,
  partsCostHigh: 15,
  laborHours: 1.5,
  redFlags: [],
  reject: false,
  rejectReason: "",
  explanation: "The seller says the hinge is cracked but the console works. A replacement shell fixes it.",
};

test("Haiku repair screening uses the cheap model and returns its analysis and cost", async () => {
  const client = fakeClient(() => ({
    stop_reason: "end_turn",
    content: [{ type: "text", text: JSON.stringify(screenAnswer) }],
    usage: { input_tokens: 2000, output_tokens: 400 },
  }));
  const result = await screenRepairWithClaude(client, { title: "Nintendo 3DS XL cracked hinge works" });
  assert.equal(client.calls[0].model, CLAUDE_SCREEN_MODEL);
  assert.equal(client.calls[0].model, "claude-haiku-5-5");
  assert.equal(client.calls[0].output_config.format.type, "json_schema");
  assert.equal(result.analysis.faultType, "hinge");
  assert.ok(result.costUsd > 0 && result.costUsd < 0.001, "well under a tenth of a cent");
});

test("Haiku screening errors throw so the free model can take over", async () => {
  const failing = fakeClient(() => {
    throw new Anthropic.RateLimitError(429, { type: "error" }, "slow down", new Headers());
  });
  await assert.rejects(() => screenRepairWithClaude(failing, { title: "x" }));

  const cutOff = fakeClient(() => ({ stop_reason: "max_tokens", content: [] }));
  await assert.rejects(() => screenRepairWithClaude(cutOff, { title: "x" }), /did not finish/);

  const badFault = fakeClient(() => ({
    stop_reason: "end_turn",
    content: [{ type: "text", text: JSON.stringify({ ...screenAnswer, faultType: "port" }) }],
  }));
  await assert.rejects(() => screenRepairWithClaude(badFault, { title: "x" }), /faultType/);
});
