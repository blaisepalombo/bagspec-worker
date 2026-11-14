import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getSearchTerm,
  pickAuctionSearch,
  REPAIR_SEARCH_TERMS,
  SEARCH_TERMS,
} from "../src/index.js";

test("broken-item searches use only the broad term plus proven model terms", () => {
  assert.deepEqual(Object.keys(REPAIR_SEARCH_TERMS).sort(), Object.keys(SEARCH_TERMS).sort());
  for (const [category, terms] of Object.entries(REPAIR_SEARCH_TERMS)) {
    assert.ok(terms.length >= 1 && terms.length <= 3, category);
    assert.ok(SEARCH_TERMS[category].includes(terms[0]), `${category}'s broad term is also a working-item term`);
  }
  // Model terms that found almost nothing new on broken-item searches.
  const repairTerms = Object.values(REPAIR_SEARCH_TERMS).flat();
  for (const dead of ["sony alpha", "canon eos", "airpods max", "sony wh-1000xm", "switch lite", "nintendo 3ds"]) {
    assert.ok(!repairTerms.includes(dead), dead);
  }
});

test("working-item searches keep model terms that work there and drop dead ones", () => {
  const flipTerms = Object.values(SEARCH_TERMS).flat();
  for (const kept of ["canon eos", "sony wh-1000xm", "nintendo switch", "ti-84 plus ce"]) {
    assert.ok(flipTerms.includes(kept), kept);
  }
  for (const dead of ["switch lite", "nintendo 3ds", "sonos", "soundbar", "benq projector"]) {
    assert.ok(!flipTerms.includes(dead), dead);
  }
});

test("a single-term category always searches its broad term", () => {
  const search = { category: "Headphones" };
  for (let slot = 0; slot < 6; slot += 1) {
    assert.equal(getSearchTerm(search, slot, REPAIR_SEARCH_TERMS), "headphones");
  }
  assert.equal(getSearchTerm({ category: "Unknown", query: "fallback" }, 3), "fallback");
});

test("low-yield auction categories run on one turn in three; the rest every turn", () => {
  const searches = ["Business Laptops", "Game Consoles", "Graphing Calculators", "Headphones",
    "Premium Audio", "Projectors", "Cameras"].map((category, i) => ({ id: 101 + i, category }));
  const runs = {};
  const rounds = 30;
  for (let slot = 0; slot < searches.length * rounds; slot += 1) {
    const search = pickAuctionSearch(searches, slot);
    if (search) runs[search.category] = (runs[search.category] || 0) + 1;
  }
  assert.equal(runs.Cameras, rounds);
  assert.equal(runs["Game Consoles"], rounds);
  assert.equal(runs["Graphing Calculators"], rounds / 3);
  assert.equal(runs.Projectors, rounds / 3);
  assert.equal(runs["Premium Audio"], rounds / 3);
  assert.equal(pickAuctionSearch([], 5), null);
});
