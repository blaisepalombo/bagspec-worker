// iPhone push notifications for the BagSpec app, sent straight to Apple
// (APNs) with a token-based key, so no Firebase or other paid relay.
//
// Secrets (Cloudflare): APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY (the
// .p8 file's contents). The app registers its device token with
// POST /api/devices; every route here needs the owner login.

export const APNS_TOPIC = "com.bagspec.app";
const APNS_HOSTS = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
};
const DEFAULT_SETTINGS = { buy: true, auctions: true, digest: false };

let tablesReady = null;
export function ensurePushTables(env) {
  if (!tablesReady) {
    tablesReady = env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS push_devices (
        token TEXT PRIMARY KEY,
        environment TEXT NOT NULL DEFAULT 'production',
        settings TEXT NOT NULL DEFAULT '{}',
        device_name TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_push_at TEXT,
        last_error TEXT
      )
    `).run().catch((error) => {
      tablesReady = null;
      throw error;
    });
  }
  return tablesReady;
}

export function pushConfigured(env) {
  return Boolean(env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_PRIVATE_KEY);
}

const base64Url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jsonBase64Url = (value) => base64Url(new TextEncoder().encode(JSON.stringify(value)));

function pemToDer(pem) {
  const body = String(pem)
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

// Apple accepts a provider token for up to an hour and rejects refreshing it
// more than every 20 minutes, so reuse one for 40 minutes.
let cachedToken = null;
export async function providerToken(env, now = Date.now()) {
  if (cachedToken && cachedToken.keyId === env.APNS_KEY_ID && now - cachedToken.issuedAt < 40 * 60 * 1000) {
    return cachedToken.jwt;
  }
  const key = await crypto.subtle.importKey(
    "pkcs8", pemToDer(env.APNS_PRIVATE_KEY),
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]
  );
  const unsigned = `${jsonBase64Url({ alg: "ES256", kid: env.APNS_KEY_ID })}.${jsonBase64Url({
    iss: env.APNS_TEAM_ID,
    iat: Math.floor(now / 1000),
  })}`;
  // WebCrypto returns the raw r||s signature that JWS ES256 expects.
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned)
  );
  cachedToken = { jwt: `${unsigned}.${base64Url(signature)}`, issuedAt: now, keyId: env.APNS_KEY_ID };
  return cachedToken.jwt;
}

// Sends one notification. Returns { ok, status, reason, gone }.
export async function sendApns(env, device, { title, body, data = {} }) {
  const host = APNS_HOSTS[device.environment] || APNS_HOSTS.production;
  const response = await fetch(`${host}/3/device/${device.token}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${await providerToken(env)}`,
      "apns-topic": APNS_TOPIC,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      aps: { alert: { title, body }, sound: "default" },
      ...data,
    }),
  });
  if (response.ok) return { ok: true, status: response.status };
  const reason = (await response.json().catch(() => ({}))).reason || `HTTP ${response.status}`;
  // The app was deleted or the token belongs to the other environment.
  const gone = response.status === 410 ||
    ["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"].includes(reason);
  return { ok: false, status: response.status, reason, gone };
}

function parseSettings(value) {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(value || "{}") };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

// Sends to every registered device whose settings allow this kind of alert
// ("buy", "auctions" or "digest"). Returns how many devices it reached.
export async function notifyDevices(env, kind, message) {
  if (!pushConfigured(env)) return { configured: false, sent: 0, failed: 0 };
  await ensurePushTables(env);
  const { results } = await env.DB.prepare("SELECT * FROM push_devices").all();
  let sent = 0;
  let failed = 0;
  for (const device of results) {
    if (!parseSettings(device.settings)[kind]) continue;
    let result;
    try {
      result = await sendApns(env, device, message);
    } catch (error) {
      result = { ok: false, reason: String(error.message || error) };
    }
    if (result.ok) {
      sent += 1;
      await env.DB.prepare(
        "UPDATE push_devices SET last_push_at = CURRENT_TIMESTAMP, last_error = NULL WHERE token = ?"
      ).bind(device.token).run();
    } else if (result.gone) {
      failed += 1;
      await env.DB.prepare("DELETE FROM push_devices WHERE token = ?").bind(device.token).run();
    } else {
      failed += 1;
      await env.DB.prepare("UPDATE push_devices SET last_error = ? WHERE token = ?")
        .bind(String(result.reason).slice(0, 200), device.token).run();
    }
  }
  return { configured: true, sent, failed };
}

const money = (value) => `$${Number(value || 0).toFixed(2)}`;

export function dealNotification(listing) {
  const auction = listing.deal_type === "auction";
  const body = auction
    ? `Bid up to ${money(listing.suggested_offer)} (now ${money(listing.price)}) · est. ${money(listing.estimated_profit)} profit`
    : `${money(listing.total_buy_cost)} all-in · est. ${money(listing.estimated_profit)} profit`;
  return {
    kind: auction ? "auctions" : "buy",
    message: {
      title: `${auction ? "Auction BUY" : "BUY"}: ${String(listing.title || "").slice(0, 90)}`,
      body,
      data: { dealId: listing.id, url: listing.item_url || null },
    },
  };
}

const TOKEN_PATTERN = /^[0-9a-f]{64,200}$/i;

// /api/devices routes. The caller has already checked the owner login.
export async function handleDeviceRequest(request, env, url) {
  await ensurePushTables(env);
  const parts = url.pathname.split("/").filter(Boolean); // api, devices, ...

  if (request.method === "GET" && parts.length === 2) {
    const { results } = await env.DB.prepare(
      "SELECT substr(token, 1, 8) AS token_start, environment, settings, device_name, created_at, last_seen_at, last_push_at, last_error FROM push_devices ORDER BY last_seen_at DESC"
    ).all();
    return Response.json({
      configured: pushConfigured(env),
      devices: results.map((row) => ({ ...row, settings: parseSettings(row.settings) })),
    });
  }

  if (request.method === "POST" && parts.length === 2) {
    const body = await request.json().catch(() => ({}));
    const token = String(body.token || "").trim();
    if (!TOKEN_PATTERN.test(token)) {
      return Response.json({ error: "A valid APNs device token is required" }, { status: 400 });
    }
    const environment = body.environment === "sandbox" ? "sandbox" : "production";
    const settings = parseSettings(JSON.stringify(body.settings || {}));
    const name = body.deviceName ? String(body.deviceName).slice(0, 80) : null;
    await env.DB.prepare(`
      INSERT INTO push_devices (token, environment, settings, device_name)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(token) DO UPDATE SET environment = excluded.environment,
        settings = excluded.settings, device_name = COALESCE(excluded.device_name, push_devices.device_name),
        last_seen_at = CURRENT_TIMESTAMP
    `).bind(token, environment, JSON.stringify(settings), name).run();
    return Response.json({ ok: true, configured: pushConfigured(env), settings }, { status: 201 });
  }

  if (request.method === "POST" && parts[2] === "test") {
    const body = await request.json().catch(() => ({}));
    const token = String(body.token || "");
    const device = await env.DB.prepare("SELECT * FROM push_devices WHERE token = ?").bind(token).first();
    if (!device) return Response.json({ error: "This device is not registered" }, { status: 404 });
    if (!pushConfigured(env)) {
      return Response.json({ error: "Push is not set up on the server yet (APNs key missing)" }, { status: 503 });
    }
    const result = await sendApns(env, device, {
      title: "BagSpec test",
      body: "Notifications are working. Deals will show up here.",
      data: {},
    });
    if (!result.ok) {
      return Response.json({ error: `Apple refused the notification: ${result.reason}` }, { status: 502 });
    }
    return Response.json({ ok: true });
  }

  if (request.method === "DELETE" && parts.length === 3) {
    await env.DB.prepare("DELETE FROM push_devices WHERE token = ?").bind(decodeURIComponent(parts[2])).run();
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Not found" }, { status: 404 });
}
