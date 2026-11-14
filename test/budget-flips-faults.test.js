import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FLIP_SEARCH_EVERY_CYCLES,
  getDecisionThresholds,
  getRepairPartsCost,
  pickFlipSearch,
} from "../src/index.js";

test("the configured budget is $150", () => {
  assert.match(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"), /"BUY_BUDGET_USD":\s*"150"/);
});

test("the BUY bar follows the item's own cost, so cheap items keep the $25 bar", () => {
  assert.equal(getDecisionThresholds("Cameras", 150, 60).buyProfit, 25, "a $60 buy under a $150 budget");
  assert.equal(getDecisionThresholds("Cameras", 150, 75).buyRoi, 50);
  assert.equal(getDecisionThresholds("Cameras", 150, 120).buyProfit, 50, "a $120 camera needs $50");
  assert.equal(getDecisionThresholds("Headphones", 150, 120).buyProfit, 40);
  assert.equal(getDecisionThresholds("Graphing Calculators", 150, 120).buyProfit, 25);
  assert.equal(getDecisionThresholds("Cameras", 75).buyProfit, 25, "unchanged with a $75 budget");
  assert.equal(getDecisionThresholds("Cameras", 150).buyProfit, 50, "no cost given: the budget decides");
});

test("working-item flips are searched every third cycle, still rotating through every category", () => {
  const searches = ["Business Laptops", "Game Consoles", "Graphing Calculators", "Headphones",
    "Premium Audio", "Projectors", "Cameras"].map((category, i) => ({ id: 101 + i, category }));
  const cycles = FLIP_SEARCH_EVERY_CYCLES * searches.length * 4;
  const picks = [];
  for (let slot = 0; slot < cycles; slot += 1) {
    const flip = pickFlipSearch(searches, slot);
    if (flip) picks.push(flip);
  }
  assert.equal(picks.length, cycles / 3, "one cycle in three");
  for (const { category } of searches) {
    assert.equal(picks.filter((p) => p.search.category === category).length, 4, category);
  }
  const laptopTerms = new Set(picks.filter((p) => p.search.category === "Business Laptops").map((p) => p.query));
  assert.ok(laptopTerms.size > 1, "the model terms still rotate");
  assert.equal(pickFlipSearch([], 0), null);
});

test("an item untested only because no battery or charger came with it has a parts price", () => {
  const camera = { title: "Fujifilm FinePix S8600", category: "Cameras" };
  assert.equal(getRepairPartsCost("battery", camera, "untested, sold as-is with no batteries, memory card or cables"), 30);
  assert.equal(getRepairPartsCost("battery", camera, "comes without battery, could not test"), 30);
  assert.equal(getRepairPartsCost("charger", camera, "unknown; seller states untested and no power cord included"), 15);
  assert.equal(getRepairPartsCost("charger", camera, "untested, no charging cable"), 15);
  // Still needs the listing to say so.
  assert.equal(getRepairPartsCost("battery", camera, "comes with battery and strap, lens error"), null);
});

test("the AI screener is told how to file untested-for-lack-of-power items", () => {
  const prompt = readFileSync(new URL("../src/claude.js", import.meta.url), "utf8");
  assert.match(prompt, /untested only because no battery or charger came with it/);
  assert.match(prompt, /untested only because no battery or charger is included 55-70/);
});
