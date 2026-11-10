// Final BUY check by Claude: does the listing really match its comparables,
// is anything suspicious, and does the profit hold up after fees?
//
// Safety rule: this module never throws. Any API error, refusal, cut-off
// answer or invalid JSON becomes a "pass" verdict, so a broken check can
// never turn into a BUY.
import Anthropic from "@anthropic-ai/sdk";

export const CLAUDE_MODEL = "claude-sonnet-5-5";
export const CLAUDE_MIN_CONFIDENCE = 75;
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
