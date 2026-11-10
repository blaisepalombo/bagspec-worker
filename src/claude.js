// Final BUY check by Claude: does the listing really match its comparables,
// is anything suspicious, and does the profit hold up after fees?
//
// Safety rule: this module never throws. Any API error, refusal, cut-off
// answer or invalid JSON becomes a "pass" verdict, so a broken check can
// never turn into a BUY.
import Anthropic from "@anthropic-ai/sdk";

export const CLAUDE_MODEL = "claude-sonnet-5-5";
// Bulk repair screening uses the cheapest model; only BUY checks use Sonnet.
export const CLAUDE_SCREEN_MODEL = "claude-haiku-5-5";
export const CLAUDE_MIN_CONFIDENCE = 75;

// US dollars per million tokens (Claude API list prices, Nov 2026).
const PRICES = {
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

export function estimateCostUsd(model, usage) {
  const price = PRICES[model];
  if (!price || !usage) return 0;
  return (Number(usage.input || 0) * price.input +
    Number(usage.output || 0) * price.output) / 1_000_000;
}
// Description text is capped to keep each check around one or two cents.
const MAX_DESCRIPTION_CHARS = 3000;

export const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["buy", "pass"] },
    listingMatchesComps: { type: "boolean" },
    matchingCompIndexes: { type: "array", items: { type: "integer" } },
    estimatedResale: { type: "number" },
    estimatedProfitAfterFees: { type: "number" },
    confidence: { type: "integer" },
    authenticityRedFlags: { type: "array", items: { type: "string" } },
    mismatchReasons: { type: "array", items: { type: "string" } },
    reason: { type: "string" },
  },
  required: [
    "verdict",
    "listingMatchesComps",
    "matchingCompIndexes",
    "estimatedResale",
    "estimatedProfitAfterFees",
    "confidence",
    "authenticityRedFlags",
    "mismatchReasons",
    "reason",
  ],
};

const SYSTEM_PROMPT = `You check used-electronics deals for a student reseller in Rexburg, Idaho, who buys on eBay and resells locally or on eBay. Your answer decides whether they spend real money, so a wrong "buy" costs them far more than a missed deal.

You get one listing, the comparable listings BagSpec found, and BagSpec's profit maths. Decide:

1. Which comparables are the same product as the listing: same brand, exact model and generation (for example Mark I vs Mark III, G5 vs G8, Series S vs Series X, a controller vs a console), the same configuration where it changes the price (storage, RAM, CPU, lens included or body only), and a similar condition. List their indexes in matchingCompIndexes. listingMatchesComps is true only if at least 3 comparables match.
2. Authenticity and scam red flags: a price far below what genuine units sell for, vague or odd wording ("one of one", "replica", "1:1", "AAA", "read description" with nothing to read), stock photos only, missing serial or box for items often faked (AirPods, Beats, Bose, Sony headphones), new seller accounts, missing parts not reflected in the price, or a description that contradicts the title. Leave authenticityRedFlags empty only if you see none.
3. estimatedResale: what this exact item would realistically sell for, based only on the matching comparables. Comparable prices are asking prices, which run above sold prices, so stay at or below their lower quartile.
4. estimatedProfitAfterFees: estimatedResale minus eBay fees (13.6% of the sale plus $0.40), outbound shipping, $5 packing, the buy cost and the parts cost given. If the local channel is recommended, use the local resale rate given instead of eBay fees and shipping.
5. confidence (0-100) that buying this listing at its price makes the stated profit.

If the listing is an auction, its price is only the current bid and will rise. Judge profit at the current bid as usual; BagSpec separately tells the owner a maximum bid (auction.maxBid). Mention in reason if many bids or little time left make winning at that maximum unlikely.

Answer "buy" only when the comparables match, there are no authenticity red flags, and estimatedProfitAfterFees is at least the minimum profit given. Otherwise answer "pass". Do not invent facts that are not in the listing. Write reason in one or two plain sentences.`;

export function createClaudeClient(env) {
  if (!env?.ANTHROPIC_API_KEY) return null;
  return new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    maxRetries: 1,
    timeout: 45_000,
  });
}

export function passVerdict(reason, extra = {}) {
  return {
    approved: false,
    verdict: "pass",
    source: "claude",
    model: CLAUDE_MODEL,
    reason,
    redFlags: [],
    confidence: 0,
    estimatedResale: 0,
    estimatedProfitAfterFees: 0,
    matchingCompCount: 0,
    clearMismatch: false,
    ...extra,
  };
}

// Strict check of Claude's JSON. Returns the verdict or throws.
export function validateVerdict(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("verdict is not an object");
  }
  for (const key of VERDICT_SCHEMA.required) {
    if (!(key in value)) throw new Error(`verdict is missing ${key}`);
  }
  if (value.verdict !== "buy" && value.verdict !== "pass") {
    throw new Error("verdict must be buy or pass");
  }
  if (typeof value.listingMatchesComps !== "boolean") {
    throw new Error("listingMatchesComps must be a boolean");
  }
  for (const key of ["estimatedResale", "estimatedProfitAfterFees"]) {
    if (typeof value[key] !== "number" || !Number.isFinite(value[key])) {
      throw new Error(`${key} must be a finite number`);
    }
  }
  if (value.estimatedResale < 0) throw new Error("estimatedResale is negative");
  if (!Number.isInteger(value.confidence) || value.confidence < 0 || value.confidence > 100) {
    throw new Error("confidence must be an integer from 0 to 100");
  }
  if (!Array.isArray(value.matchingCompIndexes) ||
      !value.matchingCompIndexes.every(Number.isInteger)) {
    throw new Error("matchingCompIndexes must be integers");
  }
  for (const key of ["authenticityRedFlags", "mismatchReasons"]) {
    if (!Array.isArray(value[key]) || !value[key].every((item) => typeof item === "string")) {
      throw new Error(`${key} must be a list of strings`);
    }
  }
  if (typeof value.reason !== "string" || !value.reason.trim()) {
    throw new Error("reason must be a non-empty string");
  }
  return value;
}

function buildUserMessage(context, minimumProfit) {
  const listing = context.listing || {};
  const details = listing.details || {};
  const description = [details.shortDescription, details.conditionDescription, details.fullDescription]
    .filter(Boolean).join("\n").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

  return JSON.stringify({
    listing: {
      title: listing.title,
      dealType: listing.dealType,
      category: listing.category,
      condition: listing.condition,
      price: listing.price,
      inboundShipping: listing.inboundShipping,
      totalBuyCost: context.purchaseCost,
      itemSpecifics: details.itemSpecifics || {},
      returnsAccepted: details.returnsAccepted ?? null,
      description: description.slice(0, MAX_DESCRIPTION_CHARS),
      descriptionTruncated: description.length > MAX_DESCRIPTION_CHARS,
    },
    comparables: (context.comparables || []).map((comp, index) => ({
      index,
      title: comp.title,
      totalPrice: comp.total,
    })),
    bagspecEstimate: {
      ebayResale: context.ebayResale,
      localResale: context.localResale,
      localResaleRate: context.localResaleRate,
      outboundShipping: context.outboundShipping,
      partsCost: context.partsCost,
      riskReserve: context.riskReserve,
      recommendedChannel: context.recommendedChannel,
      estimatedProfit: context.estimatedProfit,
      soldPriceReference: context.soldPriceReference || null,
    },
    auction: context.auction || null,
    minimumProfit,
  });
}

// client: an Anthropic client (or a test double with messages.create).
export async function verifyDealWithClaude(client, context, { minimumProfit = 50 } = {}) {
  if (!client) return passVerdict("Claude check unavailable: ANTHROPIC_API_KEY is not set");

  let message;
  try {
    message = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 3000,
      system: SYSTEM_PROMPT,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: VERDICT_SCHEMA },
      },
      messages: [{ role: "user", content: buildUserMessage(context, minimumProfit) }],
    });
  } catch (error) {
    const status = error instanceof Anthropic.APIError && error.status ? ` ${error.status}` : "";
    return passVerdict(`Claude check failed (API error${status}); not buying without it`, {
      error: String(error?.message || error).slice(0, 200),
    });
  }

  if (message?.stop_reason !== "end_turn") {
    return passVerdict(`Claude check did not finish (${message?.stop_reason || "no response"}); not buying`);
  }

  let verdict;
  try {
    const text = (message.content || [])
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    verdict = validateVerdict(JSON.parse(text));
  } catch (error) {
    return passVerdict(`Claude returned an invalid answer (${error.message}); not buying`);
  }

  const compCount = (context.comparables || []).length;
  const matchingCompCount = new Set(
    verdict.matchingCompIndexes.filter((index) => index >= 0 && index < compCount)
  ).size;
  const redFlags = [...verdict.authenticityRedFlags, ...verdict.mismatchReasons]
    .map((flag) => flag.slice(0, 200)).slice(0, 8);

  const blockers = [];
  if (verdict.verdict !== "buy") blockers.push("Claude said pass");
  if (!verdict.listingMatchesComps || matchingCompCount < 3) blockers.push("fewer than 3 matching comparables");
  if (verdict.authenticityRedFlags.length) blockers.push("authenticity red flags");
  if (verdict.confidence < CLAUDE_MIN_CONFIDENCE) blockers.push(`confidence ${verdict.confidence} is below ${CLAUDE_MIN_CONFIDENCE}`);
  if (verdict.estimatedProfitAfterFees < minimumProfit) {
    blockers.push(`Claude's profit $${verdict.estimatedProfitAfterFees.toFixed(2)} is below $${minimumProfit}`);
  }

  const approved = blockers.length === 0;
  return {
    approved,
    verdict: approved ? "buy" : "pass",
    source: "claude",
    model: CLAUDE_MODEL,
    reason: approved ? verdict.reason : `${verdict.reason} (Not a BUY: ${blockers.join("; ")}.)`,
    redFlags,
    confidence: verdict.confidence,
    estimatedResale: verdict.estimatedResale,
    estimatedProfitAfterFees: verdict.estimatedProfitAfterFees,
    matchingCompCount,
    // A confident "wrong product" or "looks fake" call drops the listing
    // to PASS instead of leaving it on the WATCH list.
    clearMismatch:
      verdict.confidence >= CLAUDE_MIN_CONFIDENCE &&
      (!verdict.listingMatchesComps || verdict.authenticityRedFlags.length > 0),
    usage: message.usage
      ? { input: message.usage.input_tokens, output: message.usage.output_tokens }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Repair screening (Claude Haiku). Replaces the tiny free Workers AI model,
// which often answered "other" even when the listing named the fault.
// Returns the same fields the old screener did. Throws on any problem so the
// caller can fall back to the free model.

export const REPAIR_FAULT_TYPES = [
  "missing_storage", "missing_ram", "missing_storage_and_ram", "battery",
  "charger", "software", "fan_or_thermal", "keyboard", "screen", "hinge",
  "joycon_drift", "disc_drive", "lamp", "earpads", "needs_soldering", "other",
];

export const REPAIR_SCREEN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    itemName: { type: "string" },
    comparisonSearchQuery: { type: "string" },
    likelyIssue: { type: "string" },
    faultType: { type: "string", enum: REPAIR_FAULT_TYPES },
    repairDifficulty: { type: "integer" },
    repairRisk: { type: "integer" },
    repairSuccessProbability: { type: "integer" },
    partsCostLow: { type: "number" },
    partsCostHigh: { type: "number" },
    laborHours: { type: "number" },
    redFlags: { type: "array", items: { type: "string" } },
    reject: { type: "boolean" },
    rejectReason: { type: "string" },
    explanation: { type: "string" },
  },
  required: [
    "itemName", "comparisonSearchQuery", "likelyIssue", "faultType",
    "repairDifficulty", "repairRisk", "repairSuccessProbability",
    "partsCostLow", "partsCostHigh", "laborHours", "redFlags", "reject",
    "rejectReason", "explanation",
  ],
};

const SCREEN_PROMPT = `You screen broken electronics listings for a beginner who fixes and resells them. They have basic tools (screwdrivers, spudgers, thermal paste) but cannot solder. Be conservative and never invent facts that are not in the listing.

faultType is the one repair the listing itself plainly states:
- missing_storage, missing_ram, missing_storage_and_ram: drive or memory not included
- battery, charger: dead/swollen battery or missing charger
- software: needs an OS, reset, or boots to BIOS (not a password or device lock)
- fan_or_thermal: overheating, loud or dead fan
- keyboard, screen, hinge: a stated broken keyboard, display or hinge on a device that otherwise works
- joycon_drift, disc_drive, lamp, earpads
- needs_soldering: charging/USB-C/HDMI port, DC jack, broken pins, board-level or chip repair
- other: unclear, several unrelated faults, no power with no stated cause, or anything else

Set reject true for liquid damage, corrosion, iCloud/activation/BIOS locks, missing motherboard, bulk lots, or parts-only listings.

comparisonSearchQuery identifies the exact working product to price it against: brand, exact model and generation (for example "Mark II", "G5", "Slim", "XL"), and storage or CPU when it changes the price. 3 to 8 words. No condition words like broken, parts, repair, working or used.

repairDifficulty and repairRisk are 1-10. repairSuccessProbability is 0-100: missing or easily replaced parts 70-90, a clearly identified minor repair 65-85, powers on but otherwise untested 50-70, no power with unknown cause 20-45, liquid, locks or board faults 5-25. partsCostLow/High are realistic US prices for the parts and supplies. Keep explanation to two plain sentences about the item and the repair. Do not estimate resale value.`;

export async function screenRepairWithClaude(client, listingData) {
  const message = await client.messages.create({
    model: CLAUDE_SCREEN_MODEL,
    max_tokens: 1500,
    system: SCREEN_PROMPT,
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: REPAIR_SCREEN_SCHEMA },
    },
    messages: [{
      role: "user",
      content: "Screen this listing:\n" + JSON.stringify(listingData).slice(0, 7000),
    }],
  });

  if (message?.stop_reason !== "end_turn") {
    throw new Error(`Claude screening did not finish (${message?.stop_reason || "no response"})`);
  }
  const text = (message.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  const analysis = JSON.parse(text);
  if (!REPAIR_FAULT_TYPES.includes(analysis?.faultType)) {
    throw new Error("Claude screening returned an unknown faultType");
  }
  const usage = message.usage
    ? { input: message.usage.input_tokens, output: message.usage.output_tokens }
    : null;
  return { analysis, usage, costUsd: estimateCostUsd(CLAUDE_SCREEN_MODEL, usage) };
}
