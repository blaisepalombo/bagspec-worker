import { test } from "node:test";
import assert from "node:assert/strict";
import { loadAnalysisQueue, runBalancedBatch, takeFromAnalysisQueue } from "../src/index.js";

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

test("the analysis queue is taken best first, one category at a time", () => {
  const queue = [
    { id: 1, category: "Cameras" },
    { id: 2, category: "Cameras" },
    { id: 3, category: "Headphones" },
  ];
  const first = takeFromAnalysisQueue(queue, []);
  assert.ok(first, "a listing is picked");
  assert.equal(queue.length, 2, "a picked listing leaves the queue");
  const second = takeFromAnalysisQueue(queue, [first.category]);
  assert.notEqual(second.category, first.category, "another category goes next");
  const third = takeFromAnalysisQueue(queue, ["Cameras", "Headphones"]);
  assert.ok(third, "falls back to any category when all are excluded");
  assert.equal(takeFromAnalysisQueue(queue, []), null, "an empty queue gives nothing");
});

test("the queue is read once, with ids and categories only", async () => {
  const sqls = [];
  const env = { DB: { prepare: (sql) => ({ all: async () => { sqls.push(sql); return { results: [{ id: 7, category: "Cameras" }] }; } }) } };
  const queue = await loadAnalysisQueue(env);
  assert.deepEqual(queue, [{ id: 7, category: "Cameras" }]);
  assert.equal(sqls.length, 1);
  assert.match(sqls[0], /SELECT id, category\s+FROM listings/);
  assert.doesNotMatch(sqls[0], /SELECT \*/);
});
