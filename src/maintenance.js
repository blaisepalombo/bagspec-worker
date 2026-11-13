// Keeps the D1 database under the free plan's 500 MB per-database limit.
//
// Most of the space is the eBay description and AI reasoning text saved on
// listings BagSpec passed on or never got to (status rejected or expired).
// That text is only read while a listing is being analyzed, so once a day:
//
// - after TEXT_DAYS, clear description and reasoning on those listings. The
//   row stays, so the scanner still skips the same eBay item and the relist
//   check (title, seller, price) still works;
// - after DELETE_DAYS, delete those rows;
// - after RUN_LOG_DAYS, delete old scan and cycle logs.
//
// BUY/WATCH deals, the current queue, and any listing linked to My flips or
// an eBay purchase are never touched.
import { ensureEbayTables } from "./ebay-account.js";

export const TEXT_DAYS = 14;
export const DELETE_DAYS = 90;
export const RUN_LOG_DAYS = 30;
const BATCH_ROWS = 2000;
// D1's free plan allows 100,000 row writes a day and BagSpec already uses
// ~30,000, so each day touches at most 10,000 listing rows per sweep and
// 3,000 rows per log table. The first ~40,000-row backlog takes ~4 days.
const MAX_BATCHES = 5;
const MAX_LOG_ROWS = 3000;

const PRUNABLE = `
  status IN ('rejected', 'expired')
  AND COALESCE(recommendation, '') NOT IN ('BUY', 'WATCH')
  AND id NOT IN (SELECT listing_id FROM inventory WHERE listing_id IS NOT NULL)
  AND id NOT IN (SELECT listing_id FROM ebay_purchases WHERE listing_id IS NOT NULL)
`;

let maintenanceTableReady = false;
async function ensureMaintenanceTable(env) {
  if (maintenanceTableReady) return;
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS maintenance_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  maintenanceTableReady = true;
}

async function getState(env, key) {
  const row = await env.DB.prepare(
    "SELECT value FROM maintenance_state WHERE key = ?"
  ).bind(key).first();
  return row?.value ?? null;
}

async function setState(env, key, value) {
  await env.DB.prepare(`
    INSERT INTO maintenance_state (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).bind(key, String(value)).run();
}

// Listing ids grow with first_seen_at, so the newest listing older than the
// cutoff marks where pruning stops. One index seek, not a table scan.
async function boundaryId(env, days, now) {
  const row = await env.DB.prepare(`
    SELECT id FROM listings
    WHERE first_seen_at < datetime(?, ?)
    ORDER BY first_seen_at DESC, id DESC
    LIMIT 1
  `).bind(now, `-${days} days`).first();
  return row ? Number(row.id) : 0;
}

// Walks listings in id order from a saved cursor, BATCH_ROWS rows at a time,
// so each day only reads rows it has not handled before.
async function sweep(env, cursorKey, boundary, apply) {
  let cursor = Number(await getState(env, cursorKey)) || 0;
  let changed = 0;
  let batches = 0;
  while (cursor < boundary && batches < MAX_BATCHES) {
    const last = await env.DB.prepare(`
      SELECT MAX(id) AS id FROM (
        SELECT id FROM listings WHERE id > ? AND id <= ? ORDER BY id LIMIT ?
      )
    `).bind(cursor, boundary, BATCH_ROWS).first();
    const upTo = last?.id == null ? boundary : Number(last.id);
    changed += await apply(cursor, upTo);
    cursor = upTo;
    batches += 1;
    await setState(env, cursorKey, cursor);
  }
  return { changed, caughtUp: cursor >= boundary };
}

async function pruneRunLogs(env, now) {
  const cutoff = [now, `-${RUN_LOG_DAYS} days`];
  let removed = 0;
  for (const [table, column] of [["scan_search_stats", "scanned_at"], ["scan_runs", "started_at"], ["cycle_runs", "started_at"]]) {
    // Ids grow with time, so delete everything below the first recent row.
    // "+" makes SQLite walk ids from the oldest instead of the date index.
    const result = await env.DB.prepare(`
      DELETE FROM ${table}
      WHERE id IN (
        SELECT id FROM ${table}
        WHERE id < COALESCE(
          (SELECT id FROM ${table} WHERE +${column} >= datetime(?, ?) ORDER BY id LIMIT 1),
          0
        )
        ORDER BY id LIMIT ?
      )
    `).bind(...cutoff, MAX_LOG_ROWS).run();
    removed += Number(result.meta?.changes || 0);
  }
  return removed;
}

export async function pruneOldData(env, now = new Date()) {
  const stamp = now.toISOString().replace("T", " ").slice(0, 19);
  await ensureEbayTables(env);
  await ensureMaintenanceTable(env);

  const textBoundary = await boundaryId(env, TEXT_DAYS, stamp);
  const text = await sweep(env, "text_cleared_through", textBoundary, async (from, to) => {
    const result = await env.DB.prepare(`
      UPDATE listings SET description = NULL, reasoning = NULL
      WHERE id > ? AND id <= ?
        AND (description IS NOT NULL OR reasoning IS NOT NULL)
        AND ${PRUNABLE}
    `).bind(from, to).run();
    return Number(result.meta?.changes || 0);
  });

  const deleteBoundary = await boundaryId(env, DELETE_DAYS, stamp);
  const deleted = await sweep(env, "rows_deleted_through", deleteBoundary, async (from, to) => {
    const result = await env.DB.prepare(`
      DELETE FROM listings WHERE id > ? AND id <= ? AND ${PRUNABLE}
    `).bind(from, to).run();
    return Number(result.meta?.changes || 0);
  });

  const runLogsRemoved = await pruneRunLogs(env, stamp);
  return {
    textCleared: text.changed,
    rowsDeleted: deleted.changed,
    runLogsRemoved,
    caughtUp: text.caughtUp && deleted.caughtUp,
  };
}

// Called from every cron cycle; does the work once per UTC day. A backlog
// bigger than one day's cap carries over to the next day.
export async function maybePruneOldData(env, now = new Date()) {
  await ensureMaintenanceTable(env);
  const today = now.toISOString().slice(0, 10);
  if (await getState(env, "last_prune_day") === today) return null;
  await setState(env, "last_prune_day", today);
  const result = await pruneOldData(env, now);
  await setState(env, "last_prune_result", JSON.stringify({ at: now.toISOString(), ...result }));
  return result;
}
