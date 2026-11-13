import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker, { sendPendingDealAlerts } from "../src/index.js";
import { dealNotification, providerToken } from "../src/push.js";

function fakeD1(db) {
  const statement = (sql, params = []) => ({
    bind: (...values) => statement(sql, values),
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    first: async () => db.prepare(sql).get(...params) ?? null,
    run: async () => {
      const info = db.prepare(sql).run(...params);
      return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
    },
  });
  return { prepare: (sql) => statement(sql), batch: async (list) => Promise.all(list.map((s) => s.run())) };
}

// A real P-256 key, exported the way Apple's .p8 file stores it.
const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey)).toString("base64");
const p8 = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g).join("\n")}\n-----END PRIVATE KEY-----`;

const db = new DatabaseSync(":memory:");
db.exec(readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8"));
db.exec("ALTER TABLE listings ADD COLUMN deal_type TEXT; ALTER TABLE listings ADD COLUMN seller TEXT; ALTER TABLE listings ADD COLUMN item_creation_date TEXT;");
const env = {
  DB: fakeD1(db), BAGSPEC_ADMIN_KEY: "k",
  APNS_KEY_ID: "KEY1234567", APNS_TEAM_ID: "AG4SK353YX", APNS_PRIVATE_KEY: p8,
};
const admin = { Authorization: "Basic " + btoa("bagspec:k"), "Content-Type": "application/json" };
const TOKEN = "a1".repeat(32);
const api = (path, init = {}) => worker.fetch(new Request("https://bagspec.com" + path, init), env);

const apns = [];
let apnsReply = () => new Response(null, { status: 200 });
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url.startsWith("https://api.push.apple.com/3/device/") || url.startsWith("https://api.sandbox.push.apple.com/3/device/")) {
    apns.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return apnsReply();
  }
  throw new Error("Unexpected fetch " + url);
};

const fromBase64Url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

test("the APNs provider token is a valid ES256 JWT for the team and key", async () => {
  const jwt = await providerToken(env, Date.UTC(2026, 10, 13));
  const [header, claims, signature] = jwt.split(".");
  assert.deepEqual(JSON.parse(new TextDecoder().decode(fromBase64Url(header))), { alg: "ES256", kid: "KEY1234567" });
  const body = JSON.parse(new TextDecoder().decode(fromBase64Url(claims)));
  assert.equal(body.iss, "AG4SK353YX");
  assert.equal(body.iat, Date.UTC(2026, 10, 13) / 1000);
  const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, keyPair.publicKey,
    fromBase64Url(signature), new TextEncoder().encode(`${header}.${claims}`));
  assert.ok(valid, "signature verifies with the matching public key");
  assert.equal(await providerToken(env, Date.UTC(2026, 10, 13) + 10 * 60 * 1000), jwt, "reused within 40 minutes");
});

test("/api/devices needs the owner login and a real device token", async () => {
  assert.equal((await api("/api/devices")).status, 401);
  assert.equal((await api("/api/devices", { method: "POST", body: JSON.stringify({ token: TOKEN }) })).status, 401);
  const bad = await api("/api/devices", { method: "POST", headers: admin, body: JSON.stringify({ token: "nope" }) });
  assert.equal(bad.status, 400);
});

test("register, test notification, list, and unregister", async () => {
  const reg = await api("/api/devices", { method: "POST", headers: admin,
    body: JSON.stringify({ token: TOKEN, environment: "sandbox", deviceName: "Test iPhone", settings: { digest: true } }) });
  assert.equal(reg.status, 201);
  assert.deepEqual((await reg.json()).settings, { buy: true, auctions: true, digest: true });

  const sent = await api("/api/devices/test", { method: "POST", headers: admin, body: JSON.stringify({ token: TOKEN }) });
  assert.equal(sent.status, 200);
  const call = apns.at(-1);
  assert.equal(call.url, `https://api.sandbox.push.apple.com/3/device/${TOKEN}`);
  assert.equal(call.headers["apns-topic"], "com.bagspec.app");
  assert.equal(call.headers["apns-push-type"], "alert");
  assert.match(call.headers.authorization, /^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  assert.equal(call.body.aps.alert.title, "BagSpec test");

  const list = await (await api("/api/devices", { headers: admin })).json();
  assert.equal(list.configured, true);
  assert.equal(list.devices.length, 1);
  assert.equal(list.devices[0].token_start, TOKEN.slice(0, 8), "the full token is never listed");
  assert.equal(list.devices[0].device_name, "Test iPhone");

  assert.equal((await api(`/api/devices/${TOKEN}`, { method: "DELETE", headers: admin })).status, 200);
  assert.equal((await (await api("/api/devices", { headers: admin })).json()).devices.length, 0);
});

test("a new BUY deal is pushed to the phone, once, and dead tokens are dropped", async () => {
  await api("/api/devices", { method: "POST", headers: admin, body: JSON.stringify({ token: TOKEN }) });
  db.prepare(`INSERT INTO listings (id, ebay_item_id, title, item_url, category, price, shipping_cost, total_buy_cost,
      estimated_profit, recommendation, deal_type, description, item_creation_date, status)
    VALUES (77, 'v1|77|0', 'Olympus Stylus camera for parts lens error', 'https://www.ebay.com/itm/77', 'Cameras',
      12, 5, 18.02, 31.5, 'BUY', 'repair', ?, datetime('now'), 'analyzed')`)
    .run(JSON.stringify({ shippingDetails: [{ type: "FIXED", cost: 5 }] }));

  apns.length = 0;
  const first = await sendPendingDealAlerts(env, 5);
  assert.equal(first.sent, 1, JSON.stringify(first));
  assert.deepEqual(first.sentItems[0].channels, ["push"]);
  assert.equal(apns.length, 1);
  assert.equal(apns[0].url, `https://api.push.apple.com/3/device/${TOKEN}`);
  assert.equal(apns[0].body.aps.alert.title, "BUY: Olympus Stylus camera for parts lens error");
  assert.equal(apns[0].body.aps.alert.body, "$18.02 all-in · est. $31.50 profit");
  assert.equal(apns[0].body.dealId, 77);

  const again = await sendPendingDealAlerts(env, 5);
  assert.equal(again.sent, 0, "a deal is only alerted once");

  // Apple says the app was deleted: the device is removed, and the deal is
  // retried next cycle (it was not delivered anywhere).
  apnsReply = () => Response.json({ reason: "Unregistered" }, { status: 410 });
  db.prepare("UPDATE listings SET alerted_at = NULL WHERE id = 77").run();
  const gone = await sendPendingDealAlerts(env, 5);
  assert.equal(gone.failed, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM push_devices").get().n, 0);
  apnsReply = () => new Response(null, { status: 200 });
});

test("auction deals say how much to bid", () => {
  const { kind, message } = dealNotification({ id: 5, title: "Nintendo 3DS", deal_type: "auction",
    suggested_offer: 22, price: 9.5, estimated_profit: 40, item_url: "https://www.ebay.com/itm/5" });
  assert.equal(kind, "auctions");
  assert.equal(message.title, "Auction BUY: Nintendo 3DS");
  assert.equal(message.body, "Bid up to $22.00 (now $9.50) · est. $40.00 profit");
});
