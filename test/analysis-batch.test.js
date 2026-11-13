import { test } from "node:test";
import assert from "node:assert/strict";
import { runBalancedBatch } from "../src/index.js";

// A fake queue that behaves like analyzeNextCandidate: best listing first,
// skipping excluded categories.
function fakeQueue(categories) {
  const queue = categories.map((category, i) => ({ id: i + 1, category }));
  const calls = [];
  const next = async (excluded) => {
    calls.push([...excluded]);
    const index = queue.findIndex((item) => !excluded.includes(item.category));
    if (index === -1) return { status: "No enriched candidates are waiting for analysis" };
    const [listing] = queue.splice(index, 1);
    return { status: "Analysis completed", listing };
  };
  return { next, calls, queue };
}

test("one per category first, then the rest of the batch from the busiest categories", async () => {
  const { next, queue } = fakeQueue(["Cameras", "Cameras", "Cameras", "Game Consoles", "Cameras", "Game Consoles", "Headphones"]);
  const results = await runBalancedBatch(6, next);
  assert.deepEqual(results.map((r) => r.listing.category),
    ["Cameras", "Game Consoles", "Headphones", "Cameras", "Cameras", "Cameras"]);
  assert.equal(queue.length, 1, "only the batch limit stops it, not running out of categories");
});

test("stops when the queue is empty and respects the limit", async () => {
  const small = fakeQueue(["Cameras"]);
  assert.equal((await runBalancedBatch(6, small.next)).length, 1);

  const big = fakeQueue(Array(20).fill("Cameras"));
  assert.equal((await runBalancedBatch(6, big.next)).length, 6);

  const empty = fakeQueue([]);
  assert.equal((await runBalancedBatch(6, empty.next)).length, 0);
});

test("an analysis error ends the batch and is reported", async () => {
  let reported = null;
  const results = await runBalancedBatch(6, async () => { throw new Error("AI down"); }, (error) => { reported = error.message; });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "Analysis failed");
  assert.equal(reported, "AI down");
});
