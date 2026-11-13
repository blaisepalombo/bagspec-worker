import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTitle } from "../src/index.js";

const flip = (title, category = "Headphones", cost = 40) => classifyTitle(title, cost, category, cost, "flip");

test("a working listing stays a flip", () => {
  const result = flip("Sony WH-1000XM4 Wireless Noise Canceling Headphones Black Excellent");
  assert.equal(result.status, "candidate");
  assert.equal(result.dealType, undefined);
});

test("a used listing with a stated fault becomes a repair candidate, not a rejection", () => {
  const result = flip("Sony WH-1000XM4 Wireless Headphones - battery doesn't hold charge");
  assert.equal(result.dealType, "repair");
  assert.equal(result.status, "candidate");
  assert.notEqual(result.reasoning, "Flip listing mentions a fault or uncertainty");
});

test("a broken hinge on a used listing is analyzed as a hinge repair", () => {
  const result = flip("Sony WH-1000XM4 headphones broken hinge");
  assert.equal(result.dealType, "repair");
  assert.equal(result.status, "candidate");
  assert.match(result.reasoning, /hinge/i);
});

test("the safety rules still apply first", () => {
  // Liquid damage is rejected for every listing, flip or repair.
  const result = flip("Sony WH-1000XM4 headphones water damage not working");
  assert.equal(result.status, "rejected");
});
