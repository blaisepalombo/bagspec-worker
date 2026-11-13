// Connects the owner's eBay account (OAuth authorization code grant) and
// imports what they bought into "My flips". Purchases BagSpec already knows
// about are added automatically; any other eBay purchase is listed so the
// owner can add or hide it, because personal buys are not flips.
import { ensureInventoryTable, estimateSalesTax } from "./inventory.js";

const AUTH_URL = "https://auth.ebay.com/oauth2/authorize";
const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const TRADING_URL = "https://api.ebay.com/ws/api.dll";
// GetMyeBayBuying (Trading API) accepts a User access token with the base
// scope in the X-EBAY-API-IAF-TOKEN header.
const SCOPE = "https://api.ebay.com/oauth/api_scope";
const TRADING_COMPATIBILITY_LEVEL = "1489";
const STATE_MAX_AGE_MS = 15 * 60 * 1000;
export const SYNC_INTERVAL_MINUTES = 60;
const WON_LIST_DAYS = 60; // eBay's maximum
const MAX_PAGES = 5;

const round = (value) => Math.round((Number(value) || 0) * 100) / 100;

let tablesReady = null;
export function ensureEbayTables(env) {
  if (!tablesReady) {
    tablesReady = (async () => {
      await ensureInventoryTable(env);
      await env.DB.batch([
        env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS ebay_account (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            refresh_token TEXT,
            refresh_expires_at TEXT,
            access_token TEXT,
            access_expires_at TEXT,
            connected_at TEXT,
            last_sync_at TEXT,
            last_sync_error TEXT,
            needs_reconnect INTEGER NOT NULL DEFAULT 0,
            oauth_state TEXT,
            oauth_state_at TEXT
          )`),
        env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS ebay_purchases (
            order_line_id TEXT PRIMARY KEY,
            item_id TEXT NOT NULL,
            title TEXT NOT NULL,
            price REAL NOT NULL DEFAULT 0,
            shipping REAL NOT NULL DEFAULT 0,
            quantity INTEGER NOT NULL DEFAULT 1,
            image_url TEXT,
            purchased_at TEXT,
            listing_id INTEGER,
            inventory_id INTEGER,
            dismissed INTEGER NOT NULL DEFAULT 0,
            synced_at TEXT DEFAULT CURRENT_TIMESTAMP
          )`),
        env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_ebay_purchases_open
          ON ebay_purchases (inventory_id, dismissed)`),
      ]);
    })().catch((error) => {
      tablesReady = null;
      throw error;
    });
  }
  return tablesReady;
}

// ---- Token encryption -------------------------------------------------
// Tokens grant access to the owner's eBay account, so they are stored
// encrypted with a key derived from existing Worker secrets. Changing either
// secret just means connecting eBay again.

async function tokenKey(env) {
  if (!env.EBAY_CLIENT_SECRET || !env.BAGSPEC_ADMIN_KEY) {
    throw new Error("EBAY_CLIENT_SECRET and BAGSPEC_ADMIN_KEY must be set");
  }
  const material = new TextEncoder().encode(
    `bagspec-ebay-token:${env.EBAY_CLIENT_SECRET}:${env.BAGSPEC_ADMIN_KEY}`
  );
  const digest = await crypto.subtle.digest("SHA-256", material);
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const toBase64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export async function sealToken(env, token) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, await tokenKey(env), new TextEncoder().encode(token)
  );
  return `${toBase64(iv)}.${toBase64(sealed)}`;
}

// Errors that only a fresh "Connect eBay" can fix. The dashboard swaps
// "Check now" for "Connect eBay again", and the hourly sync stops retrying.
function reconnectError(message) {
  return Object.assign(new Error(message), { reconnect: true });
}

export async function openToken(env, value) {
  const key = await tokenKey(env);
  try {
    const [iv, sealed] = String(value || "").split(".");
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(iv) }, key, fromBase64(sealed)
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw reconnectError("The saved eBay sign-in can't be read (a secret may have changed). Connect eBay again.");
  }
}

// ---- OAuth --------------------------------------------------------------

function clientAuthHeader(env) {
  return "Basic " + btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`);
}

function requireRuName(env) {
  const ruName = String(env.EBAY_RUNAME || "").trim();
  if (!ruName) {
    throw new Error("EBAY_RUNAME is not set. Add your eBay RuName as a Worker secret.");
  }
  return ruName;
}

// Step 1: send the owner to eBay's consent page.
export async function startEbayConnect(env) {
  await ensureEbayTables(env);
  const ruName = requireRuName(env);
  const state = toBase64(crypto.getRandomValues(new Uint8Array(24)))
    .replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" })[c]);
  await env.DB.prepare(`
    INSERT INTO ebay_account (id, oauth_state, oauth_state_at)
    VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET oauth_state = excluded.oauth_state,
      oauth_state_at = excluded.oauth_state_at
  `).bind(state, new Date().toISOString()).run();

  const consent = new URL(AUTH_URL);
  consent.searchParams.set("client_id", env.EBAY_CLIENT_ID);
  consent.searchParams.set("redirect_uri", ruName);
  consent.searchParams.set("response_type", "code");
  consent.searchParams.set("scope", SCOPE);
  consent.searchParams.set("state", state);
  return Response.redirect(consent.toString(), 302);
}

async function requestToken(env, params) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: clientAuthHeader(env),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    if (params.grant_type === "refresh_token" && body.error === "invalid_grant") {
      throw reconnectError("eBay ended BagSpec's sign-in (it expired or was revoked). Connect eBay again.");
    }
    throw new Error(`eBay token request failed (${response.status}): ${body.error_description || body.error || "no token"}`);
  }
  return body;
}

const inSeconds = (seconds) => new Date(Date.now() + Number(seconds || 0) * 1000).toISOString();

// Step 2: eBay sends the owner back here with a one-time code.
export async function finishEbayConnect(env, url) {
  const done = (result) => Response.redirect(`${url.origin}/dashboard?ebay=${result}#flips`, 302);
  await ensureEbayTables(env);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code) return done("declined");

  const saved = await env.DB.prepare(
    "SELECT oauth_state, oauth_state_at FROM ebay_account WHERE id = 1"
  ).first();
  const age = Date.now() - Date.parse(saved?.oauth_state_at || "");
  if (!saved?.oauth_state || saved.oauth_state !== state || !(age < STATE_MAX_AGE_MS)) {
    return done("expired");
  }

  const token = await requestToken(env, {
    grant_type: "authorization_code",
    code,
    redirect_uri: requireRuName(env),
  });
  if (!token.refresh_token) throw new Error("eBay did not return a refresh token");

  await env.DB.prepare(`
    UPDATE ebay_account SET
      refresh_token = ?, refresh_expires_at = ?,
      access_token = ?, access_expires_at = ?,
      connected_at = ?, last_sync_error = NULL, needs_reconnect = 0,
      oauth_state = NULL, oauth_state_at = NULL
    WHERE id = 1
  `).bind(
    await sealToken(env, token.refresh_token), inSeconds(token.refresh_token_expires_in),
    await sealToken(env, token.access_token), inSeconds(token.expires_in),
    new Date().toISOString()
  ).run();

  try {
    await syncEbayPurchases(env);
  } catch (error) {
    console.error("First eBay purchase sync failed", error);
  }
  return done("connected");
}

async function getAccessToken(env, account) {
  const expires = Date.parse(account.access_expires_at || "");
  if (account.access_token && expires - Date.now() > 2 * 60 * 1000) {
    return openToken(env, account.access_token);
  }
  if (!account.refresh_token) throw new Error("eBay is not connected");
  if (Date.parse(account.refresh_expires_at || "") <= Date.now()) {
    throw reconnectError("eBay's sign-in for BagSpec has expired. Connect eBay again.");
  }
  const token = await requestToken(env, {
    grant_type: "refresh_token",
    refresh_token: await openToken(env, account.refresh_token),
    scope: SCOPE,
  });
  await env.DB.prepare(
    "UPDATE ebay_account SET access_token = ?, access_expires_at = ? WHERE id = 1"
  ).bind(await sealToken(env, token.access_token), inSeconds(token.expires_in)).run();
  return token.access_token;
}

// ---- Reading purchases --------------------------------------------------

function decodeXml(value) {
  return String(value ?? "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

function tag(xml, name) {
  const match = String(xml).match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return match ? decodeXml(match[1].trim()) : null;
}

const amount = (xml, name) => round(Number(tag(xml, name)) || 0);

// Pulls the won items out of a GetMyeBayBuying response. A purchase is either
// a lone <Transaction> or a <Transaction> inside a multi-item <Order>.
export function parseWonList(xml) {
  const ack = tag(xml, "Ack");
  if (ack === "Failure") {
    throw new Error(`eBay GetMyeBayBuying failed: ${tag(xml, "LongMessage") || tag(xml, "ShortMessage") || "unknown error"}`);
  }
  const wonList = tag(xml, "WonList") || "";
  const purchases = [];
  for (const [, transaction] of wonList.matchAll(/<Transaction>([\s\S]*?)<\/Transaction>/g)) {
    const item = tag(transaction, "Item") || "";
    const itemId = tag(item, "ItemID");
    if (!itemId) continue;
    const transactionId = tag(transaction, "TransactionID") || "0";
    const quantity = Math.max(1, Number(tag(transaction, "QuantityPurchased")) || 1);
    purchases.push({
      orderLineId: tag(transaction, "OrderLineItemID") || `${itemId}-${transactionId}`,
      itemId,
      title: tag(item, "Title") || `eBay item ${itemId}`,
      price: amount(transaction, "TotalTransactionPrice") || amount(transaction, "TotalPrice"),
      // The seller's listed shipping; eBay does not return what was charged.
      shipping: amount(item, "ShippingServiceCost"),
      quantity,
      imageUrl: tag(item, "GalleryURL"),
      purchasedAt: tag(transaction, "CreatedDate") || tag(transaction, "PaidTime"),
    });
  }
  const pages = Number(tag(wonList, "TotalNumberOfPages")) || 1;
  return { purchases, pages };
}

function wonListRequest(page) {
  return `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBayBuyingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <WonList>
    <Include>true</Include>
    <DurationInDays>${WON_LIST_DAYS}</DurationInDays>
    <Pagination><EntriesPerPage>100</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination>
  </WonList>
</GetMyeBayBuyingRequest>`;
}

export async function fetchWonPurchases(accessToken) {
  const purchases = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await fetch(TRADING_URL, {
      method: "POST",
      headers: {
        "X-EBAY-API-IAF-TOKEN": accessToken,
        "X-EBAY-API-CALL-NAME": "GetMyeBayBuying",
        "X-EBAY-API-SITEID": "0",
        "X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_COMPATIBILITY_LEVEL,
        "Content-Type": "text/xml",
      },
      body: wonListRequest(page),
    });
    const xml = await response.text();
    if (!response.ok) throw new Error(`eBay Trading API returned ${response.status}: ${xml.slice(0, 200)}`);
    const result = parseWonList(xml);
    purchases.push(...result.purchases);
    if (page >= result.pages) break;
  }
  return purchases;
}

function inventoryNote(purchase) {
  return `Imported from eBay${purchase.quantity > 1 ? ` (quantity ${purchase.quantity})` : ""}. ` +
    "Shipping and tax are estimates; check the order and update if needed.";
}

async function addPurchaseToInventory(env, purchase) {
  // If the owner already pressed "I bought this" on the deal, link that row
  // instead of adding a second one.
  if (purchase.listing_id) {
    const manual = await env.DB.prepare(`
      SELECT i.id FROM inventory i
      WHERE i.listing_id = ?
        AND NOT EXISTS (SELECT 1 FROM ebay_purchases p WHERE p.inventory_id = i.id)
      ORDER BY i.id LIMIT 1
    `).bind(purchase.listing_id).first();
    if (manual) return manual.id;
  }
  const result = await env.DB.prepare(`
    INSERT INTO inventory (listing_id, item_name, purchase_price, inbound_shipping,
      sales_tax, notes, status, purchased_at)
    VALUES (?, ?, ?, ?, ?, ?, 'purchased', ?)
  `).bind(
    purchase.listing_id ?? null, purchase.title, purchase.price, purchase.shipping,
    estimateSalesTax(purchase.price, purchase.shipping), inventoryNote(purchase),
    String(purchase.purchased_at || new Date().toISOString()).replace("T", " ").slice(0, 19)
  ).run();
  return result.meta?.last_row_id;
}

// Saves won items and adds the ones that match a BagSpec listing to My flips.
export async function syncEbayPurchases(env) {
  await ensureEbayTables(env);
  const account = await env.DB.prepare("SELECT * FROM ebay_account WHERE id = 1").first();
  if (!account?.refresh_token) return { status: "eBay not connected", imported: 0 };

  try {
    const purchases = await fetchWonPurchases(await getAccessToken(env, account));
    let added = 0;
    for (const purchase of purchases) {
      const listing = await env.DB.prepare(
        "SELECT id FROM listings WHERE ebay_item_id = ?"
      ).bind(`v1|${purchase.itemId}|0`).first();
      await env.DB.prepare(`
        INSERT INTO ebay_purchases (order_line_id, item_id, title, price, shipping,
          quantity, image_url, purchased_at, listing_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(order_line_id) DO UPDATE SET
          title = excluded.title, price = excluded.price, shipping = excluded.shipping,
          quantity = excluded.quantity, image_url = excluded.image_url,
          listing_id = COALESCE(ebay_purchases.listing_id, excluded.listing_id),
          synced_at = CURRENT_TIMESTAMP
      `).bind(
        purchase.orderLineId, purchase.itemId, purchase.title, purchase.price,
        purchase.shipping, purchase.quantity, purchase.imageUrl, purchase.purchasedAt,
        listing?.id ?? null
      ).run();

      const saved = await env.DB.prepare(
        "SELECT * FROM ebay_purchases WHERE order_line_id = ?"
      ).bind(purchase.orderLineId).first();
      if (saved.listing_id && !saved.inventory_id && !saved.dismissed) {
        const inventoryId = await addPurchaseToInventory(env, saved);
        await env.DB.prepare(
          "UPDATE ebay_purchases SET inventory_id = ? WHERE order_line_id = ?"
        ).bind(inventoryId, saved.order_line_id).run();
        added += 1;
      }
    }
    await env.DB.prepare(
      "UPDATE ebay_account SET last_sync_at = ?, last_sync_error = NULL, needs_reconnect = 0 WHERE id = 1"
    ).bind(new Date().toISOString()).run();
    return { status: "eBay purchases synced", found: purchases.length, added };
  } catch (error) {
    await env.DB.prepare(
      "UPDATE ebay_account SET last_sync_at = ?, last_sync_error = ?, needs_reconnect = ? WHERE id = 1"
    ).bind(new Date().toISOString(), String(error.message || error).slice(0, 500), error.reconnect ? 1 : 0).run();
    throw error;
  }
}

// Called from the five-minute cron; only does work once an hour.
export async function maybeSyncEbayPurchases(env) {
  await ensureEbayTables(env);
  const account = await env.DB.prepare(
    "SELECT refresh_token, last_sync_at, needs_reconnect FROM ebay_account WHERE id = 1"
  ).first();
  if (!account?.refresh_token || account.needs_reconnect) return null;
  const last = Date.parse(account.last_sync_at || "");
  if (Number.isFinite(last) && Date.now() - last < SYNC_INTERVAL_MINUTES * 60 * 1000) return null;
  return syncEbayPurchases(env);
}

// The buyer's order details page (needs the owner's eBay sign-in). The old
// listing page is useless once an auction ends: eBay shows similar items.
export function orderDetailsUrl(orderLineId) {
  const match = String(orderLineId || "").match(/^(\d+)-(\d+)$/);
  if (!match || /^0+$/.test(match[2])) return "https://www.ebay.com/mye/myebay/purchase";
  return `https://order.ebay.com/ord/show?itemid=${match[1]}&transid=${match[2]}`;
}

// ---- Dashboard API (owner only; the caller checks the login) ------------

export async function handleEbayAccountRequest(request, env, url) {
  await ensureEbayTables(env);
  const parts = url.pathname.split("/").filter(Boolean); // api, ebay, ...
  try {
    if (request.method === "GET" && parts[2] === "status") {
      const account = await env.DB.prepare(
        "SELECT refresh_token, connected_at, last_sync_at, last_sync_error, needs_reconnect FROM ebay_account WHERE id = 1"
      ).first();
      const { results: otherPurchases } = await env.DB.prepare(`
        SELECT order_line_id, item_id, title, price, shipping, quantity, image_url, purchased_at
        FROM ebay_purchases
        WHERE inventory_id IS NULL AND dismissed = 0
        ORDER BY purchased_at DESC
        LIMIT 50
      `).all();
      const { results: imported } = await env.DB.prepare(
        "SELECT inventory_id, order_line_id FROM ebay_purchases WHERE inventory_id IS NOT NULL"
      ).all();
      const orderLinks = Object.fromEntries(
        imported.map((row) => [row.inventory_id, orderDetailsUrl(row.order_line_id)])
      );
      return Response.json({
        connected: Boolean(account?.refresh_token),
        configured: Boolean(String(env.EBAY_RUNAME || "").trim()),
        connectedAt: account?.connected_at || null,
        lastSyncAt: account?.last_sync_at || null,
        lastSyncError: account?.last_sync_error || null,
        needsReconnect: Boolean(account?.refresh_token && account.needs_reconnect),
        otherPurchases: otherPurchases.map((p) => ({ ...p, order_url: orderDetailsUrl(p.order_line_id) })),
        orderLinks,
      });
    }

    if (request.method === "POST" && parts[2] === "sync") {
      return Response.json(await syncEbayPurchases(env));
    }

    if (request.method === "POST" && parts[2] === "disconnect") {
      await env.DB.prepare("DELETE FROM ebay_account WHERE id = 1").run();
      return Response.json({ ok: true });
    }

    // /api/ebay/purchases/<orderLineId>/(add|hide)
    if (request.method === "POST" && parts[2] === "purchases" && parts.length === 5) {
      const orderLineId = decodeURIComponent(parts[3]);
      const purchase = await env.DB.prepare(
        "SELECT * FROM ebay_purchases WHERE order_line_id = ?"
      ).bind(orderLineId).first();
      if (!purchase) return Response.json({ error: "Purchase not found" }, { status: 404 });
      if (parts[4] === "hide") {
        await env.DB.prepare(
          "UPDATE ebay_purchases SET dismissed = 1 WHERE order_line_id = ?"
        ).bind(orderLineId).run();
        return Response.json({ ok: true });
      }
      if (parts[4] === "add") {
        if (purchase.inventory_id) return Response.json({ ok: true, id: purchase.inventory_id });
        const id = await addPurchaseToInventory(env, purchase);
        await env.DB.prepare(
          "UPDATE ebay_purchases SET inventory_id = ?, dismissed = 0 WHERE order_line_id = ?"
        ).bind(id, orderLineId).run();
        return Response.json({ ok: true, id }, { status: 201 });
      }
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    return Response.json({ error: String(error.message || error).slice(0, 300) }, { status: 400 });
  }
}
