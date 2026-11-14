import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

// No database: a signed-out request must be turned away before any query.
const env = { BAGSPEC_ADMIN_KEY: "admin-key" };
const get = (path, headers = {}) => worker.fetch(new Request("https://bagspec.com" + path, { headers }), env);

test("deals, listings and diagnostics need the owner login", async () => {
  for (const path of ["/deals", "/listings", "/diagnostics", "/deals?before=50", "/candidates", "/stats"]) {
    const response = await get(path);
    assert.equal(response.status, 401, path);
    assert.match(response.headers.get("WWW-Authenticate") || "", /Basic/, `${path} prompts for the login`);
  }
  const wrong = await get("/deals", { Authorization: "Basic " + btoa("bagspec:wrong") });
  assert.equal(wrong.status, 401);
});

test("the dashboard asks quietly, so it can show its own sign-in screen", async () => {
  const response = await get("/deals", { "X-BagSpec-Quiet": "1" });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("WWW-Authenticate"), null);
});

test("the dashboard page loads signed out but holds no data, only a sign-in screen", async () => {
  const response = await get("/dashboard");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /id="signin"/);
  assert.match(html, /href="\/login"/);
  assert.match(html, /main\.locked/);
});

test("signing in returns to the dashboard", async () => {
  const response = await get("/login", { Authorization: "Basic " + btoa("bagspec:admin-key") });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), "https://bagspec.com/dashboard");
});
