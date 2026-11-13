import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/index.js";
import {
  finishEbayConnect,
  handleEbayAccountRequest,
  openToken,
  parseWonList,
  sealToken,
  startEbayConnect,
  maybeSyncEbayPurchases,
  syncEbayPurchases,
} from "../src/ebay-account.js";

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

const db = new DatabaseSync(":memory:");
db.exec(readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8"));
// Production uses the My flips inventory table from inventory.js, not the
// original migration's draft of it.
db.exec("DROP TABLE inventory");
db.prepare(`INSERT INTO listings (id, ebay_item_id, title, item_url) VALUES (?, ?, ?, ?)`)
  .run(7, "v1|128175992473|0", "Olympus Camedia C-740", "https://www.ebay.com/itm/128175992473");
db.prepare(`INSERT INTO listings (id, ebay_item_id, title, item_url) VALUES (?, ?, ?, ?)`)
  .run(8, "v1|555|0", "Bought by hand first", "https://www.ebay.com/itm/555");

const env = {
  DB: fakeD1(db),
  EBAY_CLIENT_ID: "client-id",
  EBAY_CLIENT_SECRET: "client-secret",
  BAGSPEC_ADMIN_KEY: "admin-key",
  EBAY_RUNAME: "Blaise_P-BagSpec-PRD-runame",
};
const admin = { Authorization: "Basic " + btoa("bagspec:admin-key") };

const WON_XML = `<?xml version="1.0" encoding="UTF-8"?>
<GetMyeBayBuyingResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <Ack>Success</Ack>
  <WonList>
    <OrderTransactionArray>
      <OrderTransaction>
        <Transaction>
          <CreatedDate>2026-11-11T03:21:00.000Z</CreatedDate>
          <Item>
            <ItemID>128175992473</ItemID>
            <Title>Olympus Camedia C-740 Ultra Zoom &amp; Strap</Title>
            <PictureDetails><GalleryURL>https://i.ebayimg.com/a.jpg</GalleryURL></PictureDetails>
            <ShippingDetails><ShippingServiceOptions><ShippingServiceCost currencyID="USD">8.53</ShippingServiceCost></ShippingServiceOptions></ShippingDetails>
          </Item>
          <OrderLineItemID>128175992473-1001</OrderLineItemID>
          <QuantityPurchased>1</QuantityPurchased>
          <TotalTransactionPrice currencyID="USD">3.0</TotalTransactionPrice>
          <TransactionID>1001</TransactionID>
        </Transaction>
      </OrderTransaction>
      <OrderTransaction>
        <Order>
          <OrderID>ORDER-9</OrderID>
          <TransactionArray>
            <Transaction>
              <CreatedDate>2026-11-02T10:00:00.000Z</CreatedDate>
              <Item><ItemID>999</ItemID><Title>Phone case (personal)</Title></Item>
              <OrderLineItemID>999-2002</OrderLineItemID>
              <TotalTransactionPrice currencyID="USD">9.99</TotalTransactionPrice>
            </Transaction>
            <Transaction>
              <CreatedDate>2026-11-01T10:00:00.000Z</CreatedDate>
              <Item><ItemID>555</ItemID><Title>Bought by hand first</Title></Item>
              <OrderLineItemID>555-3003</OrderLineItemID>
              <TotalTransactionPrice currencyID="USD">20</TotalTransactionPrice>
            </Transaction>
          </TransactionArray>
        </Order>
      </OrderTransaction>
    </OrderTransactionArray>
    <PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages></PaginationResult>
  </WonList>
</GetMyeBayBuyingResponse>`;

const calls = [];
let refreshRevoked = false;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  calls.push({ url, init });
  if (url === "https://api.ebay.com/identity/v1/oauth2/token") {
    const body = new URLSearchParams(String(init.body));
    assert.equal(init.headers.Authorization, "Basic " + btoa("client-id:client-secret"));
    if (body.get("grant_type") === "authorization_code") {
      assert.equal(body.get("code"), "one-time-code");
      assert.equal(body.get("redirect_uri"), env.EBAY_RUNAME);
      return Response.json({ access_token: "access-1", expires_in: 7200, refresh_token: "refresh-1", refresh_token_expires_in: 47304000 });
    }
    assert.equal(body.get("grant_type"), "refresh_token");
    if (refreshRevoked) {
      return Response.json({ error: "invalid_grant", error_description: "the provided authorization refresh token is invalid" }, { status: 400 });
    }
    assert.equal(body.get("refresh_token"), "refresh-1");
    return Response.json({ access_token: "access-2", expires_in: 7200 });
  }
  if (url === "https://api.ebay.com/ws/api.dll") {
    assert.equal(init.headers["X-EBAY-API-CALL-NAME"], "GetMyeBayBuying");
    assert.match(init.headers["X-EBAY-API-IAF-TOKEN"], /^access-/);
    assert.match(String(init.body), /<WonList>[\s\S]*<DurationInDays>60<\/DurationInDays>/);
    return new Response(WON_XML, { status: 200 });
  }
  throw new Error("Unexpected fetch " + url);
};

test("parseWonList reads lone and multi-item order purchases", () => {
  const { purchases, pages } = parseWonList(WON_XML);
  assert.equal(pages, 1);
  assert.deepEqual(purchases.map((p) => p.orderLineId), ["128175992473-1001", "999-2002", "555-3003"]);
  assert.equal(purchases[0].title, "Olympus Camedia C-740 Ultra Zoom & Strap");
  assert.equal(purchases[0].price, 3);
  assert.equal(purchases[0].shipping, 8.53);
  assert.equal(purchases[0].imageUrl, "https://i.ebayimg.com/a.jpg");
});

test("parseWonList surfaces eBay errors", () => {
  assert.throws(
    () => parseWonList("<R><Ack>Failure</Ack><Errors><LongMessage>Invalid IAF token.</LongMessage></Errors></R>"),
    /Invalid IAF token/
  );
});

test("tokens are encrypted at rest and round-trip", async () => {
  const sealed = await sealToken(env, "secret-token");
  assert.ok(!sealed.includes("secret-token"));
  assert.equal(await openToken(env, sealed), "secret-token");
  await assert.rejects(openToken({ ...env, BAGSPEC_ADMIN_KEY: "other" }, sealed));
});

test("/ebay/connect needs the owner login and /api/ebay is not swallowed by the POST catch-all", async () => {
  const connect = await worker.fetch(new Request("https://bagspec.com/ebay/connect"), env);
  assert.equal(connect.status, 401);
  const sync = await worker.fetch(new Request("https://bagspec.com/api/ebay/sync", { method: "POST" }), env);
  assert.equal(sync.status, 401);
});

test("connect, import, dedupe, add and hide", async () => {
  // "I bought this" was pressed on listing 8 before eBay was connected.
  await worker.fetch(new Request("https://bagspec.com/api/inventory", {
    method: "POST",
    headers: { ...admin, "Content-Type": "application/json" },
    body: JSON.stringify({ listingId: 8, purchasePrice: 20 }),
  }), env);

  const start = await startEbayConnect(env);
  const consent = new URL(start.headers.get("Location"));
  assert.equal(consent.origin + consent.pathname, "https://auth.ebay.com/oauth2/authorize");
  assert.equal(consent.searchParams.get("redirect_uri"), env.EBAY_RUNAME);
  assert.equal(consent.searchParams.get("response_type"), "code");
  const state = consent.searchParams.get("state");
  assert.ok(state.length > 20);

  const forged = await finishEbayConnect(env, new URL("https://bagspec.com/ebay/callback?code=one-time-code&state=wrong"));
  assert.match(forged.headers.get("Location"), /ebay=expired/);

  const done = await finishEbayConnect(env, new URL(`https://bagspec.com/ebay/callback?code=one-time-code&state=${state}`));
  assert.match(done.headers.get("Location"), /\/dashboard\?ebay=connected#flips$/);

  const account = db.prepare("SELECT * FROM ebay_account").get();
  assert.ok(!account.refresh_token.includes("refresh-1"), "refresh token is not stored in plain text");
  assert.equal(account.oauth_state, null, "state is single-use");

  // The BagSpec deal (camera) was added; the hand-added row was linked, not duplicated.
  let inventory = db.prepare("SELECT * FROM inventory ORDER BY id").all();
  assert.equal(inventory.length, 2);
  const camera = inventory.find((row) => row.listing_id === 7);
  assert.equal(camera.purchase_price, 3);
  assert.equal(camera.inbound_shipping, 8.53);
  assert.equal(camera.sales_tax, 0.69);
  assert.equal(camera.purchased_at, "2026-11-11 03:21:00");
  assert.equal(inventory.filter((row) => row.listing_id === 8).length, 1);

  // The personal purchase waits for a decision.
  const status = await (await worker.fetch(new Request("https://bagspec.com/api/ebay/status", { headers: admin }), env)).json();
  assert.equal(status.connected, true);
  assert.deepEqual(status.otherPurchases.map((p) => p.title), ["Phone case (personal)"]);

  // A second sync (forcing a token refresh) adds nothing new.
  db.prepare("UPDATE ebay_account SET access_expires_at = '2000-01-01T00:00:00Z'").run();
  const again = await syncEbayPurchases(env);
  assert.equal(again.found, 3);
  assert.equal(again.added, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inventory").get().n, 2);
  assert.ok(calls.some((c) => String(c.init.body).includes("grant_type=refresh_token")));

  const hide = await handleEbayAccountRequest(
    new Request("https://bagspec.com/api/ebay/purchases/999-2002/hide", { method: "POST" }), env,
    new URL("https://bagspec.com/api/ebay/purchases/999-2002/hide"));
  assert.equal(hide.status, 200);
  const hidden = await (await worker.fetch(new Request("https://bagspec.com/api/ebay/status", { headers: admin }), env)).json();
  assert.equal(hidden.otherPurchases.length, 0);

  const add = await worker.fetch(new Request("https://bagspec.com/api/ebay/purchases/999-2002/add", { method: "POST", headers: admin }), env);
  assert.equal(add.status, 201);
  inventory = db.prepare("SELECT * FROM inventory ORDER BY id").all();
  assert.equal(inventory.length, 3);
  assert.equal(inventory[2].item_name, "Phone case (personal)");
  assert.match(inventory[2].notes, /Imported from eBay/);

  const disconnect = await worker.fetch(new Request("https://bagspec.com/api/ebay/disconnect", { method: "POST", headers: admin }), env);
  assert.equal(disconnect.status, 200);
  const after = await (await worker.fetch(new Request("https://bagspec.com/api/ebay/status", { headers: admin }), env)).json();
  assert.equal(after.connected, false);
});

test("a broken eBay sign-in asks for Connect eBay again and pauses the hourly sync", async () => {
  const connect = async () => {
    const consent = new URL((await startEbayConnect(env)).headers.get("Location"));
    await finishEbayConnect(env, new URL("https://bagspec.com/ebay/callback?code=one-time-code&state=" + consent.searchParams.get("state")));
  };
  const status = async () => (await worker.fetch(new Request("https://bagspec.com/api/ebay/status", { headers: admin }), env)).json();
  const expireAccess = () => db.prepare("UPDATE ebay_account SET access_expires_at = '2000-01-01T00:00:00Z', last_sync_at = NULL").run();

  await connect();
  assert.equal((await status()).needsReconnect, false);

  // 1. The saved token can't be decrypted (a secret changed).
  expireAccess();
  db.prepare("UPDATE ebay_account SET refresh_token = 'not.valid'").run();
  await assert.rejects(syncEbayPurchases(env), /Connect eBay again/);
  let now = await status();
  assert.equal(now.connected, true);
  assert.equal(now.needsReconnect, true);
  const before = calls.length;
  assert.equal(await maybeSyncEbayPurchases(env), null, "hourly sync does not keep retrying");
  assert.equal(calls.length, before);

  // Connecting again clears it.
  await connect();
  now = await status();
  assert.equal(now.needsReconnect, false);
  assert.equal(now.lastSyncError, null);

  // 2. eBay revoked the refresh token.
  expireAccess();
  refreshRevoked = true;
  await assert.rejects(syncEbayPurchases(env), /Connect eBay again/);
  assert.equal((await status()).needsReconnect, true);
  refreshRevoked = false;

  // 3. The 18-month refresh token ran out.
  await connect();
  expireAccess();
  db.prepare("UPDATE ebay_account SET refresh_expires_at = '2001-01-01T00:00:00Z'").run();
  await assert.rejects(syncEbayPurchases(env), /expired/);
  assert.equal((await status()).needsReconnect, true);

  // An ordinary eBay outage is not a reconnect.
  await connect();
  expireAccess();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("busy", { status: 503 });
  try { await assert.rejects(syncEbayPurchases(env)); } finally { globalThis.fetch = realFetch; }
  now = await status();
  assert.equal(now.needsReconnect, false);
  assert.ok(now.lastSyncError);
});
