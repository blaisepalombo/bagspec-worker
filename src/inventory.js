// "My flips" tracker: what the owner bought, what they spent fixing it, and
// what it sold for. Pure helpers are exported for tests; the handler works
// on the existing D1 `inventory` table.

export const INVENTORY_STATUSES = ["purchased", "repairing", "listed", "sold", "failed"];
export const SALE_CHANNELS = ["eBay", "Local", "Other"];
const EBAY_FEE_RATE = 0.136;
const EBAY_FEE_FIXED = 0.4;
const SALES_TAX_RATE = 0.06;

const round = (value) => Math.round((Number(value) || 0) * 100) / 100;

// eBay's final value fee on a sale (13.6% of the total + $0.40); local sales
// have none.
export function estimateSellingFees(channel, salePrice) {
  if (channel !== "eBay" || !(Number(salePrice) > 0)) return 0;
  return round(Number(salePrice) * EBAY_FEE_RATE + EBAY_FEE_FIXED);
}

export function estimateSalesTax(price, shipping) {
  return round((Number(price || 0) + Number(shipping || 0)) * SALES_TAX_RATE);
}

function money(body, key, { required = false } = {}) {
  const raw = body?.[key];
  if (raw === undefined || raw === null || raw === "") {
    if (required) throw new Error(`${key} is required`);
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 100000) {
    throw new Error(`${key} must be a dollar amount of 0 or more`);
  }
  return round(value);
}

function text(body, key, max) {
  const raw = body?.[key];
  if (raw === undefined || raw === null) return undefined;
  return String(raw).trim().slice(0, max);
}

// Checks a "bought it" or "add item" form. Throws an Error with a plain
// message on bad input.
export function parseNewInventoryItem(body, listing = null) {
  const itemName = text(body, "itemName", 200) || listing?.title || "";
  if (!itemName) throw new Error("itemName is required");
  const purchasePrice = money(body, "purchasePrice", { required: true });
  const inboundShipping = money(body, "inboundShipping") ?? 0;
  const salesTax = money(body, "salesTax") ?? estimateSalesTax(purchasePrice, inboundShipping);
  return {
    listingId: listing?.id ?? null,
    itemName,
    purchasePrice,
    inboundShipping,
    salesTax,
    partsCost: money(body, "partsCost") ?? 0,
    notes: text(body, "notes", 1000) || "",
  };
}

// Checks an update (parts, status, or a sale). Only fields that were sent
// are returned, so the UI can update one thing at a time.
export function parseInventoryUpdate(body) {
  const update = {};
  for (const [key, column] of [
    ["purchasePrice", "purchase_price"], ["inboundShipping", "inbound_shipping"],
    ["salesTax", "sales_tax"], ["partsCost", "parts_cost"], ["packingCost", "packing_cost"],
    ["salePrice", "sale_price"], ["sellingFees", "selling_fees"],
    ["outboundShipping", "outbound_shipping"],
  ]) {
    const value = money(body, key);
    if (value !== undefined) update[column] = value;
  }
  const status = text(body, "status", 20);
  if (status !== undefined) {
    if (!INVENTORY_STATUSES.includes(status)) throw new Error("status is not valid");
    update.status = status;
  }
  const channel = text(body, "saleChannel", 20);
  if (channel !== undefined && channel !== "") {
    if (!SALE_CHANNELS.includes(channel)) throw new Error("saleChannel is not valid");
    update.sale_channel = channel;
  }
  const notes = text(body, "notes", 1000);
  if (notes !== undefined) update.notes = notes;
  const name = text(body, "itemName", 200);
  if (name) update.item_name = name;

  if (update.status === "sold") {
    if (update.sale_price === undefined) throw new Error("salePrice is required to mark an item sold");
    if (update.selling_fees === undefined) {
      update.selling_fees = estimateSellingFees(update.sale_channel, update.sale_price);
    }
  }
  if (Object.keys(update).length === 0) throw new Error("Nothing to update");
  return update;
}

export function itemCost(row) {
  return round(
    Number(row.purchase_price || 0) + Number(row.inbound_shipping || 0) +
    Number(row.sales_tax || 0) + Number(row.parts_cost || 0) + Number(row.packing_cost || 0)
  );
}

// Profit only once sold; a "failed" item counts as a loss of its cost.
export function itemProfit(row) {
  if (row.status === "failed") return round(-itemCost(row));
  if (row.status !== "sold") return null;
  return round(
    Number(row.sale_price || 0) - Number(row.selling_fees || 0) -
    Number(row.outbound_shipping || 0) - itemCost(row)
  );
}

export function summarizeInventory(rows) {
  const finished = rows.filter((row) => row.status === "sold" || row.status === "failed");
  const sold = rows.filter((row) => row.status === "sold");
  const open = rows.filter((row) => !finished.includes(row));
  const totalProfit = round(finished.reduce((sum, row) => sum + itemProfit(row), 0));
  const withEstimate = sold.filter((row) => Number.isFinite(Number(row.estimated_profit)) && row.estimated_profit !== null);
  return {
    items: rows.length,
    open: open.length,
    sold: sold.length,
    failed: finished.length - sold.length,
    moneyTiedUp: round(open.reduce((sum, row) => sum + itemCost(row), 0)),
    totalProfit,
    averageProfit: finished.length ? round(totalProfit / finished.length) : null,
    // Positive means flips made more than BagSpec predicted.
    averageVsEstimate: withEstimate.length
      ? round(withEstimate.reduce((sum, row) => sum + itemProfit(row) - Number(row.estimated_profit), 0) / withEstimate.length)
      : null,
  };
}

function jsonError(message, status = 400) {
  return Response.json({ error: message }, { status });
}

async function readJson(request) {
  if (!String(request.headers.get("Content-Type") || "").includes("application/json")) {
    throw new Error("Send JSON");
  }
  return request.json();
}

export async function ensureInventoryTable(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id INTEGER,
      item_name TEXT NOT NULL,
      purchase_price REAL NOT NULL DEFAULT 0,
      inbound_shipping REAL NOT NULL DEFAULT 0,
      sales_tax REAL NOT NULL DEFAULT 0,
      parts_cost REAL NOT NULL DEFAULT 0,
      packing_cost REAL NOT NULL DEFAULT 0,
      mileage_cost REAL NOT NULL DEFAULT 0,
      labor_hours REAL NOT NULL DEFAULT 0,
      sale_channel TEXT,
      sale_price REAL,
      selling_fees REAL NOT NULL DEFAULT 0,
      outbound_shipping REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'purchased',
      purchased_at TEXT DEFAULT CURRENT_TIMESTAMP,
      sold_at TEXT,
      notes TEXT
    )
  `).run();
}

async function listInventory(env) {
  const { results } = await env.DB.prepare(`
    SELECT i.*, l.item_url, l.image_url, l.category, l.estimated_profit,
      l.deal_type, l.recommendation
    FROM inventory i
    LEFT JOIN listings l ON l.id = i.listing_id
    ORDER BY i.id DESC
    LIMIT 500
  `).all();
  const items = results.map((row) => ({ ...row, cost: itemCost(row), profit: itemProfit(row) }));
  return { items, summary: summarizeInventory(items) };
}

// Handles /api/inventory routes. The caller has already checked the login.
export async function handleInventoryRequest(request, env, url) {
  await ensureInventoryTable(env);
  const parts = url.pathname.split("/").filter(Boolean); // api, inventory, id?, action?

  try {
    if (request.method === "GET" && parts.length === 2) {
      return Response.json(await listInventory(env));
    }

    if (request.method === "POST" && parts.length === 2) {
      const body = await readJson(request);
      let listing = null;
      if (body.listingId !== undefined && body.listingId !== null && body.listingId !== "") {
        listing = await env.DB.prepare(
          "SELECT id, title FROM listings WHERE id = ?"
        ).bind(Number(body.listingId)).first();
        if (!listing) return jsonError("That listing was not found", 404);
      }
      const item = parseNewInventoryItem(body, listing);
      const result = await env.DB.prepare(`
        INSERT INTO inventory (listing_id, item_name, purchase_price, inbound_shipping,
          sales_tax, parts_cost, notes, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'purchased')
      `).bind(item.listingId, item.itemName, item.purchasePrice, item.inboundShipping,
        item.salesTax, item.partsCost, item.notes).run();
      return Response.json({ ok: true, id: result.meta?.last_row_id }, { status: 201 });
    }

    const id = Number(parts[2]);
    if (!Number.isInteger(id) || id <= 0) return jsonError("Not found", 404);

    if (request.method === "POST" && parts.length === 4 && parts[3] === "delete") {
      await env.DB.prepare("DELETE FROM inventory WHERE id = ?").bind(id).run();
      return Response.json({ ok: true });
    }

    if (request.method === "POST" && parts.length === 3) {
      const update = parseInventoryUpdate(await readJson(request));
      if (update.status === "sold") update.sold_at = new Date().toISOString().replace("T", " ").slice(0, 19);
      const columns = Object.keys(update);
      const result = await env.DB.prepare(
        `UPDATE inventory SET ${columns.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`
      ).bind(...columns.map((column) => update[column]), id).run();
      if (!Number(result.meta?.changes)) return jsonError("Not found", 404);
      return Response.json({ ok: true });
    }

    return jsonError("Not found", 404);
  } catch (error) {
    return jsonError(String(error.message || error).slice(0, 200));
  }
}
