// eBay Browse API usage: what eBay says BagSpec has used today, plus
// BagSpec's own count of its calls by kind.
//
// The Browse API allows 5,000 calls a day for searches and item lookups
// combined. Going over makes eBay refuse calls until the daily reset, which
// stops scanning for the rest of the day.

const RATE_LIMIT_URL =
  "https://api.ebay.com/developer/analytics/v1_beta/rate_limit/?api_context=buy&api_name=Browse";
// Warn when today's usage passes this share of the limit, or is on pace to
// pass PROJECTED_WARN_SHARE by the reset.
export const USAGE_WARN_SHARE = 0.85;
const PROJECTED_WARN_SHARE = 0.95;
// The dashboard may reload often; eBay's numbers are reread at most this often.
const RATE_LIMIT_CACHE_MS = 60 * 1000;

export const EBAY_CALL_KINDS = ["search", "item", "comparables", "sold"];

// Calls counted in this isolate and not yet saved. Saved once per cycle
// rather than once per call, which keeps D1 writes to a few per cycle.
const pendingCalls = new Map();
let rateLimitCache = null;

export function countEbayCall(kind) {
  pendingCalls.set(kind, (pendingCalls.get(kind) || 0) + 1);
}

// eBay's daily window resets at midnight Pacific, so days are counted in
// Pacific time to line up with it.
export function ebayUsageDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export async function ensureEbayUsageTables(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS ebay_call_counts (
      usage_day TEXT NOT NULL,
      kind TEXT NOT NULL,
      calls INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (usage_day, kind)
    )
  `).run();
}

export async function flushEbayCallCounts(env, now = new Date()) {
  if (!pendingCalls.size) return 0;
  const entries = [...pendingCalls.entries()];
  pendingCalls.clear();
  const day = ebayUsageDay(now);
  try {
    await ensureEbayUsageTables(env);
    const statements = entries.map(([kind, calls]) => env.DB.prepare(`
      INSERT INTO ebay_call_counts (usage_day, kind, calls) VALUES (?, ?, ?)
      ON CONFLICT(usage_day, kind) DO UPDATE SET calls = calls + excluded.calls
    `).bind(day, kind, calls));
    if (env.DB.batch) await env.DB.batch(statements);
    else for (const statement of statements) await statement.run();
  } catch (error) {
    // Keep the counts for the next try rather than losing them.
    for (const [kind, calls] of entries) {
      pendingCalls.set(kind, (pendingCalls.get(kind) || 0) + calls);
    }
    throw error;
  }
  return entries.reduce((sum, [, calls]) => sum + calls, 0);
}

// Reduces eBay's response to the Browse API's resources.
export function summarizeRateLimits(data, now = new Date()) {
  const resources = [];
  for (const api of data?.rateLimits || []) {
    for (const resource of api.resources || []) {
      for (const rate of resource.rates || []) {
        const limit = Number(rate.limit) || 0;
        const used = Number(rate.count) || 0;
        const remaining = Number.isFinite(Number(rate.remaining))
          ? Number(rate.remaining)
          : Math.max(0, limit - used);
        const windowSeconds = Number(rate.timeWindow) || 86400;
        const resetMs = Date.parse(rate.reset);
        // Where the day will end at today's pace.
        const elapsed = Number.isFinite(resetMs)
          ? windowSeconds - (resetMs - now.getTime()) / 1000
          : null;
        const projected = elapsed && elapsed > windowSeconds * 0.1
          ? Math.round(used * windowSeconds / Math.min(elapsed, windowSeconds))
          : null;
        resources.push({
          name: resource.name,
          limit,
          used,
          remaining,
          reset: rate.reset || null,
          windowSeconds,
          share: limit ? used / limit : null,
          projected,
        });
      }
    }
  }
  // The main Browse quota is the one named "buy.browse"; otherwise the one
  // with the largest allowance.
  const main = resources.find((resource) => resource.name === "buy.browse") ||
    [...resources].sort((a, b) => b.limit - a.limit)[0] || null;
  return { main, resources };
}

export function usageWarning(main) {
  if (!main || !main.limit) return null;
  if (main.used >= main.limit * USAGE_WARN_SHARE) {
    return `eBay API usage is at ${main.used.toLocaleString("en-US")} of ${main.limit.toLocaleString("en-US")} calls today (${Math.round(main.share * 100)}%).`;
  }
  if (main.projected && main.projected >= main.limit * PROJECTED_WARN_SHARE) {
    return `eBay API usage is on pace for about ${main.projected.toLocaleString("en-US")} of ${main.limit.toLocaleString("en-US")} calls today.`;
  }
  return null;
}

export async function fetchEbayRateLimits(accessToken, { now = new Date(), fresh = false } = {}) {
  if (!fresh && rateLimitCache && rateLimitCache.until > now.getTime()) {
    return rateLimitCache.value;
  }
  const response = await fetch(RATE_LIMIT_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  let value;
  if (response.status === 204) {
    // eBay has had outages where this returned no content.
    value = { available: false, reason: "eBay returned no usage data" };
  } else if (!response.ok) {
    value = {
      available: false,
      reason: `eBay usage check failed ${response.status}: ${(await response.text()).slice(0, 200)}`,
    };
  } else {
    value = { available: true, ...summarizeRateLimits(await response.json(), now) };
  }
  rateLimitCache = { value, until: now.getTime() + RATE_LIMIT_CACHE_MS };
  return value;
}

// BagSpec's own counts for today and yesterday (Pacific days), by kind.
export async function getOwnCallCounts(env, now = new Date()) {
  await ensureEbayUsageTables(env);
  const today = ebayUsageDay(now);
  const yesterday = ebayUsageDay(new Date(now.getTime() - 86400000));
  const { results } = await env.DB.prepare(`
    SELECT usage_day, kind, calls FROM ebay_call_counts WHERE usage_day IN (?, ?)
  `).bind(today, yesterday).all();
  const day = (date) => {
    const counts = Object.fromEntries(EBAY_CALL_KINDS.map((kind) => [kind, 0]));
    for (const row of results) {
      if (row.usage_day === date) counts[row.kind] = (counts[row.kind] || 0) + Number(row.calls);
    }
    // Calls made since the last save.
    if (date === today) {
      for (const [kind, calls] of pendingCalls) counts[kind] = (counts[kind] || 0) + calls;
    }
    return { day: date, ...counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
  };
  return { today: day(today), yesterday: day(yesterday) };
}

export async function getEbayUsage(env, accessToken, now = new Date()) {
  const [ebay, own] = await Promise.all([
    fetchEbayRateLimits(accessToken, { now }).catch((error) => ({
      available: false,
      reason: String(error.message || error),
    })),
    getOwnCallCounts(env, now),
  ]);
  return {
    ebay,
    own,
    warning: ebay.available ? usageWarning(ebay.main) : null,
    checkedAt: now.toISOString(),
  };
}

// Calls counted in this isolate since the last save. The cycle reads this
// before and after its scan to see what the scan cost.
export function pendingEbayCallTotal() {
  let total = 0;
  for (const calls of pendingCalls.values()) total += calls;
  return total;
}

// ---- Self-sizing batches -------------------------------------------------
// Each cycle gets an even share of the calls eBay has left today. The scan
// comes off the top and enrichment and analysis split the rest. A quiet
// stretch leaves calls unspent, so later cycles get bigger shares; a busy
// one shrinks them. A higher eBay allowance is picked up with no code change.

export const DEFAULT_EBAY_DAILY_LIMIT = 5000;
export const CYCLE_MINUTES = 5;
// Kept back for the dashboard and manual checks.
export const EBAY_RESERVE_SHARE = 0.03;
// eBay calls per item: an enrichment is one item lookup; an analysis is
// usually one comparables search, sometimes a broader retry or a sold check.
// Estimates only: a wrong guess is corrected by the next cycles' shares.
export const ENRICH_EBAY_CALLS = 1;
export const ANALYSIS_EBAY_CALLS = 1.3;
export const BATCH_LIMITS = {
  enrichment: { min: 2, max: 20 },
  analysis: { min: 2, max: 15 },
};
// Used when eBay's numbers and BagSpec's own count are both unavailable.
export const FALLBACK_BATCH_SIZES = { enrichment: 7, analysis: 6 };

// The next midnight in Pacific time, when eBay's daily window resets.
export function nextPacificMidnight(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  const sinceMidnight = (Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second)) * 1000 +
    now.getUTCMilliseconds();
  return now.getTime() + 86400000 - sinceMidnight;
}

export function cycleCallBudget({ limit, used, resetMs, now = new Date() }) {
  const nowMs = now.getTime();
  const reset = Number.isFinite(resetMs) && resetMs > nowMs ? resetMs : nextPacificMidnight(now);
  const cyclesLeft = Math.max(1, Math.ceil((reset - nowMs) / (CYCLE_MINUTES * 60000)));
  const spendable = limit - Math.ceil(limit * EBAY_RESERVE_SHARE) - used;
  return {
    limit,
    used,
    cyclesLeft,
    spendable,
    perCycle: spendable > 0 ? spendable / cyclesLeft : 0,
    paused: spendable <= 0,
  };
}

// Splits a cycle's calls (after the scan) between enrichment and analysis,
// about one of each, since enrichment feeds analysis.
export function splitBatchCalls(calls) {
  const clamp = (value, { min, max }) => Math.max(min, Math.min(max, Math.floor(value)));
  const analysis = clamp(calls / (ENRICH_EBAY_CALLS + ANALYSIS_EBAY_CALLS), BATCH_LIMITS.analysis);
  const enrichment = clamp((calls - analysis * ANALYSIS_EBAY_CALLS) / ENRICH_EBAY_CALLS, BATCH_LIMITS.enrichment);
  return { enrichment, analysis };
}

// This cycle's share of today's remaining eBay calls. Uses eBay's own count
// when it answers, otherwise BagSpec's count against the default limit.
export async function getCycleCallBudget(env, getToken, now = new Date()) {
  let main = null;
  try {
    const ebay = await fetchEbayRateLimits(await getToken(), { now });
    if (ebay.available && ebay.main?.limit) main = ebay.main;
  } catch (error) {
    console.error("eBay usage check for batch sizing failed", error);
  }
  if (main) {
    return {
      source: "ebay",
      ...cycleCallBudget({ limit: main.limit, used: main.used, resetMs: Date.parse(main.reset), now }),
    };
  }
  const own = await getOwnCallCounts(env, now);
  const limit = Number(env.EBAY_DAILY_CALL_LIMIT) || DEFAULT_EBAY_DAILY_LIMIT;
  return {
    source: "own count",
    ...cycleCallBudget({ limit, used: own.today.total, resetMs: nextPacificMidnight(now), now }),
  };
}

// Test helper.
export function resetEbayUsageState() {
  pendingCalls.clear();
  rateLimitCache = null;
}
