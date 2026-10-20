import { renderDashboard } from "./dashboard.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // eBay account-deletion verification
    if (request.method === "GET") {
      const challengeCode = url.searchParams.get("challenge_code");

      if (challengeCode) {
        const endpoint = `${url.origin}${url.pathname}`;
        const input =
          challengeCode + env.EBAY_VERIFICATION_TOKEN + endpoint;

        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(input)
        );

        const challengeResponse = Array.from(new Uint8Array(digest))
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");

        return Response.json({ challengeResponse });
      }
    }

    // Acknowledge eBay deletion notifications
    if (request.method === "POST") {
      return new Response(null, { status: 204 });
    }

    if (url.hostname === "bagspec.com" && url.pathname === "/") {
      return Response.redirect(url.origin + "/dashboard", 302);
    }

    if (url.pathname === "/") {
      return Response.json({
        status: "BagSpec is running",
        version: "2.0",
        scanner: "automatic",
        database: "connected",
      });
    }

    const authorized = isAuthorized(request, env);
    const publicDashboardRoutes = new Set([
      "/dashboard", "/deals", "/listings", "/diagnostics",
    ]);

    if ((!publicDashboardRoutes.has(url.pathname) || request.method !== "GET") && !authorized) {
      return new Response("BagSpec login required", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="BagSpec Admin"',
        },
      });
    }

    if (url.pathname === "/dashboard") {
      return new Response(renderDashboard(), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'self'; img-src 'self' https://i.ebayimg.com data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
        },
      });
    }

    if (url.pathname === "/setup-v2") {
      try {
        return Response.json(await setupScannerV2(env));
      } catch (error) {
        return Response.json(
          { error: "V2 setup failed", details: error.message },
          { status: 500 }
        );
      }
    }

    if (url.pathname === "/scan") {
      try {
        return Response.json(await scanListings(env));
      } catch (error) {
        return Response.json(
          { error: "Scan failed", details: error.message },
          { status: 500 }
        );
      }
    }

    if (url.pathname === "/cycle") {
      try {
        return Response.json(await runAutomatedCycle(env));
      } catch (error) {
        return Response.json(
          { error: "Cycle failed", details: error.message },
          { status: 500 }
        );
      }
    }

    if (url.pathname === "/prefilter") {
      try {
        return Response.json(await prefilterExisting(env));
      } catch (error) {
        return Response.json(
          { error: "Prefilter failed", details: error.message },
          { status: 500 }
        );
      }
    }

    if (url.pathname === "/enrich") {
      try {
        return Response.json(await enrichCandidates(env, 10));
      } catch (error) {
        return Response.json(
          { error: "Enrichment failed", details: error.message },
          { status: 500 }
        );
      }
    }

    if (url.pathname === "/analyze") {
      try {
        return Response.json(await analyzeNextCandidate(env));
      } catch (error) {
        await handleAnalysisError(env, error);
        return Response.json(
          { error: "Analysis failed", details: error.message },
          { status: 500 }
        );
      }
    }

    if (url.pathname === "/test-discord") {
      try {
        return Response.json(await sendDiscordTest(env));
      } catch (error) {
        return Response.json(
          { error: "Discord test failed", details: error.message },
          { status: 500 }
        );
      }
    }

    if (url.pathname === "/recheck-deals") {
      try {
        const result = await env.DB.prepare(`
          UPDATE listings
          SET
            status = 'candidate',
            analysis_status = 'details_ready',
            recommendation = 'REVIEW',
            alerted_at = NULL
          WHERE recommendation IN ('BUY', 'WATCH')
        `).run();

        return Response.json({
          status: "Existing deals queued for safety recheck",
          queued: Number(result.meta?.changes || 0),
          next: "Open /analyze to recheck the highest-priority deal",
        });
      } catch (error) {
        return Response.json(
          { error: "Deal recheck failed", details: error.message },
          { status: 500 }
        );
      }
    }

    if (url.pathname === "/stats") {
      const stats = await env.DB.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'candidate' THEN 1 ELSE 0 END) AS candidates,
          SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
          SUM(CASE WHEN analysis_status = 'pending' THEN 1 ELSE 0 END) AS pending
        FROM listings
      `).first();

      return Response.json(stats);
    }

    if (url.pathname === "/diagnostics") {
      try {
        return Response.json(authorized
          ? await getDiagnostics(env)
          : await getPublicDashboardDiagnostics(env));
      } catch (error) {
        return Response.json(
          { error: "Diagnostics failed", details: error.message },
          { status: 500 }
        );
      }
    }

    if (url.pathname === "/candidates") {
      const { results } = await env.DB.prepare(`
        SELECT
          id,
          title,
          item_url,
          image_url,
          category,
          price,
          shipping_cost,
          estimated_tax,
          total_buy_cost,
          deal_score,
          recommendation,
          reasoning,
          first_seen_at
        FROM listings
        WHERE status = 'candidate'
        ORDER BY deal_score DESC, first_seen_at DESC
        LIMIT 100
      `).all();

      return Response.json({
        count: results.length,
        candidates: results,
      });
    }

    if (url.pathname === "/deals") {
      const { results } = await env.DB.prepare(`
        SELECT
          id,
          title,
          item_url,
          image_url,
          category,
          total_buy_cost,
          likely_issue,
          estimated_parts_cost,
          estimated_resale_local,
          estimated_resale_ebay,
          estimated_profit,
          roi_percent,
          repair_risk,
          deal_score,
          suggested_offer,
          recommended_channel,
          recommendation,
          reasoning,
          deal_type,
          first_seen_at
        FROM listings
        WHERE recommendation IN ('BUY', 'WATCH')
        ORDER BY
          CASE recommendation WHEN 'BUY' THEN 0 ELSE 1 END,
          deal_score DESC,
          first_seen_at DESC
        LIMIT 100
      `).all();

      return Response.json({
        count: results.length,
        deals: authorized ? results : results.map(({ reasoning, ...deal }) => deal),
      });
    }

    if (url.pathname === "/listings") {
      const { results } = await env.DB.prepare(`
        SELECT
          id,
          title,
          item_url,
          image_url,
          condition,
          category,
          price,
          shipping_cost,
          estimated_tax,
          total_buy_cost,
          deal_score,
          status,
          analysis_status,
          recommendation,
          reasoning,
          deal_type,
          first_seen_at
        FROM listings
        ORDER BY first_seen_at DESC
        LIMIT 100
      `).all();

      return Response.json({
        count: results.length,
        listings: authorized ? results : results.map(({ reasoning, ...listing }) => listing),
      });
    }

    return Response.json({ error: "Page not found" }, { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAutomatedCycle(env));
  },
};

function isAuthorized(request, env) {
  const authorization = request.headers.get("Authorization") || "";

  if (!authorization.startsWith("Basic ")) {
    return false;
  }

  try {
    const decoded = atob(authorization.slice(6));
    const separator = decoded.indexOf(":");

    if (separator === -1) {
      return false;
    }

    const username = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);

    return (
      username === "bagspec" &&
      password === env.BAGSPEC_ADMIN_KEY
    );
  } catch {
    return false;
  }
}

// Categories are chosen for resale demand in Rexburg, Idaho (BYU-Idaho):
// students turn over every semester and buy laptops, consoles, graphing
// calculators, headphones, speakers, and apartment projectors locally.
// localResaleRate is the share of the eBay comparable price a working unit
// typically brings on local marketplaces; eBay remains the fallback channel.
// flipMaxPrice caps the working-item (no repair) search for each category.
const CATEGORY_PROFILES = {
  "Business Laptops": {
    ebayCategoryId: "175672",
    minimumComparablePrice: 80,
    outboundShipping: 18,
    localResaleRate: 0.9,
    flipMaxPrice: 400,
    requiredTitle:
      /\b(laptop|notebook|thinkpad|latitude|elitebook|probook|macbook|ideapad|vivobook|zenbook|surface)\b/i,
  },
  "Game Consoles": {
    ebayCategoryId: "139971",
    minimumComparablePrice: 60,
    outboundShipping: 20,
    localResaleRate: 0.9,
    flipMaxPrice: 350,
    requiredTitle:
      /\b(console|playstation|ps[2-5]|xbox|nintendo|switch|steam deck|game boy|psp|genesis)\b/i,
  },
  "Graphing Calculators": {
    ebayCategoryId: "9972",
    minimumComparablePrice: 35,
    outboundShipping: 8,
    localResaleRate: 0.95,
    flipMaxPrice: 70,
    requiredTitle:
      /\b(ti-?\s?8[349]|ti-?\s?nspire|graphing calculator|fx-?9750|fx-?cg50)\b/i,
  },
  Headphones: {
    ebayCategoryId: "112529",
    minimumComparablePrice: 50,
    outboundShipping: 10,
    localResaleRate: 0.85,
    flipMaxPrice: 200,
    requiredTitle:
      /\b(headphones?|headset|wh-?1000xm\d|quietcomfort|qc\s?(?:35|45|ultra)|airpods max|beats (?:studio|solo))\b/i,
  },
  "Premium Audio": {
    ebayCategoryId: "111694",
    minimumComparablePrice: 55,
    outboundShipping: 18,
    localResaleRate: 0.85,
    flipMaxPrice: 200,
    requiredTitle:
      /\b(speaker|soundbar|boombox|sonos|soundlink|charge|flip|xtreme)\b/i,
  },
  Projectors: {
    ebayCategoryId: "22610",
    minimumComparablePrice: 70,
    outboundShipping: 24,
    localResaleRate: 0.8,
    flipMaxPrice: 200,
    requiredTitle: /\bprojector\b/i,
  },
  Cameras: {
    ebayCategoryId: "31388",
    minimumComparablePrice: 80,
    outboundShipping: 15,
    localResaleRate: 0.8,
    flipMaxPrice: 400,
    // Many camera titles name only the model, e.g. "Canon EOS Rebel T7 Body".
    requiredTitle:
      /\b(camera|dslr|mirrorless|eos|rebel|alpha|a[679]\d{3}|a7[crs]?|nikon\s+(?:d\d{2,4}|z\s?\d{1,2})|x-?[ths]\d{1,2}|lumix)\b/i,
  },
};

const V2_SEARCHES = [
  [101, "Business Laptops", "laptop", "175672", 300],
  [103, "Game Consoles", "console", "139971", 250],
  [107, "Graphing Calculators", "ti-84", "9972", 90],
  [108, "Headphones", "headphones", "112529", 200],
  [105, "Premium Audio", "speaker", "111694", 180],
  [104, "Projectors", "projector", "22610", 180],
  [109, "Cameras", "camera", "31388", 300],
];

// Run /setup-v2 after changing V2_SEARCHES so the searches table matches.
// Rotate model-specific terms across scans to reach items whose titles omit
// generic words such as "console" or "speaker".
const SEARCH_TERMS = {
  "Business Laptops": ["laptop", "macbook", "thinkpad", "surface laptop"],
  "Game Consoles": ["console", "playstation", "xbox", "nintendo switch", "steam deck"],
  "Graphing Calculators": ["ti-84 plus ce", "ti-84 plus", "ti-nspire cx", "graphing calculator"],
  Headphones: ["headphones", "sony wh-1000xm", "bose quietcomfort", "airpods max"],
  "Premium Audio": ["speaker", "sonos", "soundlink", "soundbar"],
  Projectors: ["projector", "epson projector", "benq projector"],
  Cameras: ["camera", "canon eos", "sony alpha", "nikon camera", "fujifilm camera"],
};
// Selling locally avoids shipping, packing, and return risk, so prefer the
// local channel unless eBay nets meaningfully more.
const LOCAL_PREFERENCE_DOLLARS = 10;
// Working-item flips must be described as working; any stated fault or
// uncertainty belongs in the repair pipeline instead.
const FLIP_LISTINGS_PER_SEARCH = 15;
const FLIP_FAULT_PATTERN =
  /\b(?:for parts|parts only|not working|broken|cracked|damaged|untested|not tested|unable to test|as[- ]is|read description|no power|won't|doesn't work|does not work|faulty|defective|locked|(?<!no )(?:issues?|problems?))\b/;
const FRESH_LISTING_HOURS = 12;
const DAILY_VERIFICATION_LIMIT = 10;

// Typical working, console-only sold prices: the median of the last 90 days
// of non-bundle eBay sales tracked by PriceCharting, rounded. More specific models come
// first because the first match wins. Models whose variants sell for very
// different amounts (Switch with/without Joy-Con, Steam Deck LCD/OLED) are
// left out and fall back to the comparable search.
const MODEL_RESALE_CHECKED = "2026-10-17";
const MODEL_RESALE = [
  { model: "Xbox Series X", resale: 500, sales: 12,
    pattern: /\bxbox\s+(?:one\s+)?series\s*x\b/ },
  { model: "Xbox Series S", resale: 300, sales: 11,
    pattern: /\bxbox\s+(?:one\s+)?series\s*s\b/ },
  { model: "Xbox One X", resale: 140, sales: 16,
    pattern: /\bxbox\s+one\s*x\b/ },
  // Lower of the 1TB ($112, 18 sales) and 500GB ($99, 14 sales) medians.
  { model: "Xbox One S", resale: 99, sales: 14,
    pattern: /\bxbox\s+one\s*s\b/ },
  { model: "Xbox One", resale: 100, sales: 15,
    pattern: /\bxbox\s+one\b/ },
  { model: "PlayStation 5 Digital", resale: 420, sales: 17,
    pattern: /\b(?:ps5|playstation\s*5)\b[\s\S]*\bdigital\b|\bdigital\b[\s\S]*\b(?:ps5|playstation\s*5)\b/,
    exclude: /\bpro\b/ },
  { model: "PlayStation 5", resale: 430, sales: 20,
    pattern: /\b(?:ps5|playstation\s*5)\b/,
    exclude: /\bpro\b/ },
  { model: "PlayStation 4 Pro", resale: 140, sales: 17,
    pattern: /\b(?:ps4|playstation\s*4)\s*pro\b/ },
  { model: "PlayStation 4 Slim", resale: 102, sales: 13,
    pattern: /\b(?:ps4|playstation\s*4)\b[\s\S]*\bslim\b/ },
  { model: "PlayStation 4", resale: 90, sales: 9,
    pattern: /\b(?:ps4|playstation\s*4)\b/ },
  // Lower of the gray ($95, 19 sales) and turquoise ($106, 16 sales) medians.
  { model: "Nintendo Switch Lite", resale: 95, sales: 19,
    pattern: /\bswitch\s+lite\b/ },
].map((entry) => ({ category: "Game Consoles", ...entry })).concat([
  // pcprice.watch eBay sold medians (June and October 2026): T480 EUR 175,
  // T470 EUR 140; one US i5/8GB/256GB T480 sold for $149.99 in August 2026.
  // Rounded down toward the US sale for working i5 units.
  { model: "ThinkPad T480", resale: 160, pattern: /\bt480\b/ },
  { model: "ThinkPad T470", resale: 130, pattern: /\bt470\b/ },
].map((entry) => ({ category: "Business Laptops", ...entry })));

// Without a sold reference, resale comes from active asking prices, which
// run well above what items sell for (T480 listings ask EUR 257-375 but sell
// for EUR 175). Such estimates are discounted and can reach WATCH, never BUY.
const UNREFERENCED_SOLD_RATE = 0.8;

// Sold-quantity evidence (see getSoldEvidence). Sellers with many sales are
// mostly refurbishers whose units carry a warranty, so their prices run
// above a typical used sale and are discounted.
const SOLD_EVIDENCE_DAILY_LOOKUPS = 150;
const SOLD_EVIDENCE_LISTINGS_PER_MODEL = 8;
const SOLD_EVIDENCE_MIN_SALES = 5;
const SOLD_EVIDENCE_MIN_LISTINGS = 2;
const SOLD_EVIDENCE_RATE = 0.9;

// Conservative parts-and-supplies costs by repair type. The AI only names
// the repair type; it never sets the price. A repair type missing here, or
// not named in the listing itself, can reach WATCH but never BUY.
const REPAIR_PARTS_CHECKED = "2026-10-20";
const REPAIR_PARTS = {
  missing_storage: { default: 25 },
  missing_ram: { default: 20 },
  missing_storage_and_ram: { default: 45 },
  battery: { "Business Laptops": 45, MacBook: 85, "Game Consoles": 25,
    "Graphing Calculators": 15, Headphones: 20, "Premium Audio": 25, Cameras: 30 },
  charger: { "Business Laptops": 20, MacBook: 35, default: 15 },
  software: { default: 0 },
  fan_or_thermal: { default: 20 },
  keyboard: { "Business Laptops": 35, MacBook: 150 },
  screen: { "Business Laptops": 75, MacBook: 300, Cameras: 60 },
  hinge: { "Business Laptops": 30 },
  port: { default: 15 },
  joycon_drift: { "Game Consoles": 12 },
  disc_drive: { "Game Consoles": 35 },
  lamp: { Projectors: 60 },
  earpads: { Headphones: 15 },
};

// The listing itself must name the fault; this keeps the AI from inventing
// a cheap diagnosis such as a "TPM failure" for an unexplained fault.
const REPAIR_EVIDENCE = {
  missing_storage: /\b(?:no|missing|without)\s+(?:ssd|hdd|hard\s*drive|storage|drive)\b/,
  missing_ram: /\b(?:no|missing|without)\s+(?:ram|memory)\b/,
  missing_storage_and_ram: /\b(?:no|missing|without)\s+(?:ram|memory)\b[\s\S]*\b(?:ssd|hdd|hard\s*drive|storage|drive)\b|\b(?:no|missing|without)\s+(?:ssd|hdd|hard\s*drive|storage|drive)\b[\s\S]*\b(?:ram|memory)\b/,
  battery: /\bbatter(?:y|ies)\b/,
  charger: /\b(?:no|missing|without)\s+(?:charger|power\s+(?:adapter|cord)|ac\s+adapter|adapter)\b/,
  software: /\b(?:no\s+os|needs?\s+(?:os|windows|reinstall)|boots?\s+to\s+bios|password|reinstall)\b/,
  fan_or_thermal: /\b(?:fan|overheat\w*|thermal)\b/,
  keyboard: /\bkeyboard|\bkeys?\b/,
  screen: /\b(?:screen|lcd|display|panel)\b/,
  hinge: /\bhinges?\b/,
  port: /\b(?:hdmi|charging|charge|usb-?c?|power)\s+(?:port|jack)\b/,
  joycon_drift: /\bdrift\w*\b/,
  disc_drive: /\b(?:disc|disk|optical)\s+drive|\bread(?:ing)?\s+discs?\b/,
  lamp: /\b(?:lamp|bulb)\b/,
  earpads: /\b(?:ear\s?pads?|ear\s?cushions?|cushions?)\b/,
};

function isMacBook(title) {
  return /\bmacbook\b/i.test(String(title || ""));
}

// Returns the reference parts cost, or null when the repair is unknown for
// this item or the listing does not state the fault.
function getRepairPartsCost(faultType, listing, evidence) {
  const prices = REPAIR_PARTS[faultType];
  if (!prices || !REPAIR_EVIDENCE[faultType]?.test(evidence)) return null;
  const key = isMacBook(listing.title) && prices.MacBook !== undefined
    ? "MacBook"
    : listing.category;
  return prices[key] ?? prices.default ?? null;
}

function matchModelResale(title, category) {
  const text = String(title || "").toLowerCase();
  return MODEL_RESALE.find((entry) =>
    entry.category === category &&
    entry.pattern.test(text) &&
    !(entry.exclude && entry.exclude.test(text))
  ) || null;
}

// Highest all-in purchase cost that could still reach WATCH with free parts
// and no risk reserve, using the same fees, shipping, and thresholds as the
// full analysis. Anything above it cannot qualify, so it skips the AI call.
function maxViableBuyCost(resale, category) {
  const { watchProfit, watchRoi } = getDecisionThresholds(category);
  const roi = watchRoi / 100;
  const packingCost = 5;
  const outboundShipping = getOutboundShippingEstimate(category);

  const ebayNet = resale - (resale * 0.136 + 0.4) - outboundShipping - packingCost;
  const ebayMax = Math.min(
    ebayNet - watchProfit,
    (ebayNet - roi * (packingCost + outboundShipping)) / (1 + roi)
  );

  const localNet = resale * getLocalResaleRate(category) - 5;
  const localMax = Math.min(
    localNet - watchProfit,
    (localNet - roi * (packingCost + 5)) / (1 + roi)
  );

  return roundMoney(Math.max(ebayMax, localMax, 0));
}

function getModelPriceRejectReason(title, category, buyCost) {
  const entry = matchModelResale(title, category);
  if (!entry) return null;

  const ceiling = maxViableBuyCost(entry.resale, category);
  if (Number(buyCost) <= ceiling) return null;

  return `${entry.model} typically sells for about $${entry.resale} working; ` +
    `buy cost $${Number(buyCost).toFixed(2)} is above the $${ceiling.toFixed(2)} ` +
    "ceiling where even a free repair could reach WATCH";
}

function getSearchTerm(search, scanSlot) {
  const category = search.profile_key || search.category || search.name;
  const terms = SEARCH_TERMS[category];
  return terms ? terms[scanSlot % terms.length] : search.query;
}

function getSellerEvidence(listing, details = {}) {
  return [listing.title, listing.condition, details.shortDescription,
    details.conditionDescription, details.fullDescription]
    .filter(Boolean).join(" ").replace(/<[^>]*>/g, " ")
    .replace(/&(?:nbsp|amp|quot|#39);/gi, " ").toLowerCase();
}

function ebayBuyerContext(env) {
  const zip = String(env.BUYER_ZIP || "83440");
  if (!/^\d{5}$/.test(zip)) throw new Error("BUYER_ZIP must be a five-digit US ZIP code");
  return "contextualLocation=" + encodeURIComponent("country=US,zip=" + zip);
}
function quotedShipping(options) {
  const costs = (options || []).filter(o => o.shippingCostType !== "LOCAL_PICKUP")
    .map(o => o.shippingCost?.value).filter(v => v !== undefined && v !== null)
    .map(Number).filter(v => Number.isFinite(v) && v >= 0);
  return costs.length ? Math.min(...costs) : null;
}
function savedShippingQuote(details) {
  const costs = (details.shippingDetails || []).filter(o => o.type !== "LOCAL_PICKUP")
    .map(o => o.cost).filter(v => v !== undefined && v !== null)
    .map(Number).filter(v => Number.isFinite(v) && v >= 0);
  return costs.length ? Math.min(...costs) : null;
}

function getUnverifiedConsoleReason(listing, details = {}) {
  if (listing.category !== "Game Consoles") return null;
  const text = getSellerEvidence(listing, details);
  const forParts = /\b(?:for parts|parts or repair|not working|read description|as[- ]is)\b/.test(text) ||
    /\bparts\b/i.test(listing.condition || "");
  if (!forParts) return null;
  if (/\b(?:ylod|r\s?lod|yellow light of death|red light of death|overheats?|shuts? off|turns? off|freezes?)\b/.test(text))
    return "Seller reports a console fault beyond a missing drive";
  const negative = /\b(?:not tested|untested|unable to test)\b/.test(text) || /\b(?:does not|doesn't|will not|won't|cannot|can't|fails to|no)\s+(?:fully\s+)?(?:boot|power|turn on|start|work)\b/.test(text);
  const boots = /\b(?:boots? (?:to|into) (?:the )?(?:menu|dashboard|xmb|recovery|system software)|powers? on (?:to|and) |turns? on (?:to|and) |tested (?:and )?working|plays? (?:ps[123] )?games?|displays? (?:the )?(?:menu|dashboard|install screen))\b/.test(text);
  if (!boots || negative)
    return "For-parts console has no clear seller proof of booting; missing storage may not be the only fault";
  return null;
}

function getSellerRejectReason(listing, details = {}) {
  const text = getSellerEvidence(listing, details);
  if (/\b(?:liquid damage|water damage|corrosion|burnt board|burned board|icloud locked|activation locked|mdm locked|bios password|computrace)\b/.test(text))
    return "Seller reports liquid/board damage or a device lock";
  if (/\b(?:(?:damaged|broken|cracked|shattered|nonworking)\s+(?:lcd|screen|display|panel)|(?:lcd|screen|display|panel)\s+(?:is\s+)?(?:damaged|broken|cracked|shattered|nonworking))\b/.test(text))
    return "Seller reports display damage; simple-parts repair estimate is unreliable";
  if (/\b(?:does not|doesn't|will not|won't|cannot|can't|unable to|fails to)\s+(?:boot|power on|turn on)|\bno power\b|\bdead motherboard\b/.test(text))
    return "Seller reports no boot/power; the fault is unverified";
  if (listing.category === "Business Laptops" &&
      /\b(?:thinkpad\s+[rtx]6[01]|core\s*2\s*duo|pentium\s*[34]|celeron\s*m)\b/.test(text))
    return "Vintage laptop has insufficient resale room for this repair workflow";
  if (listing.category === "Business Laptops") return getOldLaptopReason(listing, details);
  return null;
}

// Laptops released before 2017 (pre-7th-generation Intel) or with
// low-end processors rarely sell for enough to cover a repair. Item
// specifics catch the many titles that omit the processor or year.
function getOldLaptopReason(listing, details = {}) {
  const specifics = details.itemSpecifics || {};
  const cpu = String(specifics.Processor || "").toLowerCase().trim();
  const title = String(listing.title || "").toLowerCase();
  const text = title + " " + cpu;
  const releaseYear = Number(specifics["Release Year"]);

  if (/^(?:not included|no|none|n\/a|missing)$/.test(cpu))
    return "Processor or logic board is not included";
  if (/\b(?:celeron|pentium|atom|turion|athlon|sempron|core\s*2|core duo|amd a\d{1,2}|windows\s+(?:xp|vista|7|8))\b/.test(text))
    return "Low-end or obsolete platform has too little resale value";
  const generation = cpu.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+gen\b/);
  if ((generation && Number(generation[1]) < 7) ||
      /\bi[357][- ]?[2-6]\d{3}[a-z]{0,2}\b/.test(text))
    return "Pre-7th-generation Intel laptop is below the target value floor";
  if ((Number.isFinite(releaseYear) && releaseYear > 1990 && releaseYear < 2017) ||
      /\b(?:200\d|201[0-6])\b/.test(title))
    return "Laptop released before 2017 is below the target value floor";
  if (/\b(?:latitude\s+(?:rugged\s+)?[57]4[01]4|latitude\s+e\d{4}|thinkpad\s+[tlxw][2-5][0-6]0[sp]?|elitebook\s+\d{3,4}[a-z]?\s+g[1-3]|elitebook\s+\d{4}[pw]|probook\s+\d{3}\s+g[1-3]|compaq|a1(?:181|278|286|297|342|369|370|398|465|466|502))\b/.test(title))
    return "Laptop model predates 2017 and is below the target value floor";
  return null;
}

function getCategoryProfile(category) {
  return CATEGORY_PROFILES[category] || null;
}

function getLocalResaleRate(category) {
  return getCategoryProfile(category)?.localResaleRate ?? 0.85;
}

function getDecisionThresholds(category) {
  const smallerItemCategories = new Set([
    "Game Consoles",
    "Headphones",
    "Premium Audio",
  ]);

  // Calculators sell for well under $100, so smaller profits still pay.
  if (category === "Graphing Calculators") {
    return {
      buyProfit: 25,
      buyRoi: 50,
      watchProfit: 15,
      watchRoi: 35,
      targetProfit: 25,
    };
  }

  if (smallerItemCategories.has(category)) {
    return {
      buyProfit: 40,
      buyRoi: 45,
      watchProfit: 25,
      watchRoi: 30,
      targetProfit: 40,
    };
  }

  return {
    buyProfit: 50,
    buyRoi: 50,
    watchProfit: 30,
    watchRoi: 30,
    targetProfit: 50,
  };
}

async function setupScannerV2(env) {
  const { results: columns } = await env.DB.prepare(
    "PRAGMA table_info(searches)"
  ).all();
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("category_id")) {
    await env.DB.prepare(
      "ALTER TABLE searches ADD COLUMN category_id TEXT"
    ).run();
  }

  if (!columnNames.has("profile_key")) {
    await env.DB.prepare(
      "ALTER TABLE searches ADD COLUMN profile_key TEXT"
    ).run();
  }

  // Searches are configuration, not listing history. Replace the old set so
  // databases with a UNIQUE(query) constraint cannot conflict with V2.
  await env.DB.prepare("DELETE FROM searches").run();

  const statements = V2_SEARCHES.map(
    ([id, category, query, categoryId, maxPrice]) =>
      env.DB.prepare(`
        INSERT INTO searches (
          id, name, query, max_price, enabled,
          category_id, profile_key
        )
        VALUES (?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          query = excluded.query,
          max_price = excluded.max_price,
          enabled = 1,
          category_id = excluded.category_id,
          profile_key = excluded.profile_key
      `).bind(
        id,
        category,
        query,
        maxPrice,
        categoryId,
        category
      )
  );

  await env.DB.batch(statements);

  const retired = await env.DB.prepare(`
    UPDATE listings
    SET
      status = 'rejected',
      analysis_status = 'filtered',
      recommendation = 'PASS',
      reasoning = 'Retired from the active queue by the Scanner V2 category upgrade'
    WHERE
      status = 'candidate'
      AND analysis_status IN ('awaiting_details', 'details_ready')
      AND category NOT IN (
        'Business Laptops',
        'Game Consoles',
        'Graphing Calculators',
        'Headphones',
        'Premium Audio',
        'Projectors',
        'Cameras'
      )
  `).run();

  return {
    status: "BagSpec Scanner V2 configured",
    existingListingsPreserved: true,
    oldQueueItemsRetired: Number(retired.meta?.changes || 0),
    enabledSearches: V2_SEARCHES.map(
      ([, category, query, categoryId, maxPrice]) => ({
        category,
        query,
        ebayCategoryId: categoryId,
        maxPrice,
      })
    ),
    next: "Open /scan to run the first targeted scan",
  };
}

function getAccessoryRejectReason(title) {
  const text = String(title || "").toLowerCase();

  const accessoryRules = [
    {
      pattern:
        /\b(?:replacement\s+)?(?:laptop|notebook|chromebook)\s+battery(?:\s+pack)?\b/,
      reason: "Replacement battery rather than a complete device",
    },
    {
      pattern:
        /\b(?:li-ion|lithium[- ]ion)\s+(?:laptop\s+)?battery(?:\s+pack)?\b/,
      reason: "Battery pack rather than a complete device",
    },
    {
      pattern: /\bbattery\s+pack\b/,
      reason: "Battery pack rather than a complete device",
    },
    {
      pattern:
        /\b(?:lcd|led)\s+(?:screen|display)\s+(?:for|compatible with)\b/,
      reason: "Replacement display rather than a complete device",
    },
    {
      pattern:
        /\b(?:charger|power adapter|ac adapter)\s+(?:for|compatible with)\b/,
      reason: "Power accessory rather than a complete device",
    },
    {
      pattern:
        /\b(?:hard drive hdd|hdd hard drive|memory ram|ram memory|base cover|display assembly|replacement lcd)\b/,
      reason: "Replacement component rather than a complete device",
    },
    {
      pattern:
        /\b(?:printer|labelwriter(?:\s+[\w-]+)?)\s+(?:replacement\s+)?parts?\s*[-:]\s*\S/i,
      reason: "Printer part rather than a complete label printer",
    },
    {
      pattern:
        /\b(?:front trim|top lid|printer lid|printhead|print head|platen roller)\s+(?:for|compatible with)\s+.*\b(?:printer|labelwriter)\b/i,
      reason: "Printer component rather than a complete device",
    },
    {
      pattern:
        /^\s*(?:memory|ram|hdd|ssd|hard drive|lcd|screen)\b.*\b(?:for|compatible with)\b/,
      reason: "Replacement component rather than a complete device",
    },
  ];

  for (const rule of accessoryRules) {
    if (rule.pattern.test(text)) {
      return rule.reason;
    }
  }

  return null;
}

function getCategoryRejectReason(title, category) {
  const text = String(title || "").toLowerCase();
  const profile = getCategoryProfile(category);

  if (profile?.requiredTitle && !profile.requiredTitle.test(text)) {
    return `Title does not look like a complete ${category} device`;
  }

  const categoryRules = {
    "Business Laptops": [
      {
        pattern:
          /\b(core 2 duo|core duo|intel atom|windows xp|windows vista)\b/i,
        reason: "Laptop platform is too old for the target resale market",
      },
      {
        pattern: /\b(?:i[357])[- ]?[1-6]\d{3}[a-z]{0,2}\b/i,
        reason: "Pre-7th-generation Intel laptop is below the target value floor",
      },
    ],
    "Game Consoles": [
      {
        pattern:
          /\b(controller|gamepad|joy-?con|dock|power supply|ac adapter|hdmi cable|disc|game|memory card)\s+only\b/i,
        reason: "Console accessory rather than a complete console",
      },
    ],
    Projectors: [
      {
        pattern:
          /\b(lamp|bulb|remote|mount|color wheel|dmd chip|projector screen)\s+only\b/i,
        reason: "Projector part or accessory rather than a complete projector",
      },
    ],
    "Premium Audio": [
      {
        pattern:
          /\b(driver|woofer|tweeter|grille|remote|stand|charging cradle)\s+only\b/i,
        reason: "Audio component or accessory rather than a complete device",
      },
    ],
    "Graphing Calculators": [
      {
        pattern:
          /\b(slide cover|case|cover|charging cable|cable|battery|manual)\s+only\b/i,
        reason: "Calculator accessory rather than a complete calculator",
      },
      {
        pattern: /\b(?:teacher pack|classroom (?:set|pack))\b/i,
        reason: "Classroom bundle rather than a single calculator",
      },
    ],
    Headphones: [
      {
        pattern:
          /\b(?:replacement\s+)?(?:ear\s?pads?|ear\s?cushions?|headband (?:cover|cushion)|carrying case)\b/i,
        reason: "Headphone part or accessory rather than complete headphones",
      },
      {
        pattern: /\b(?:left|right)\s+(?:side|ear|cup)\s+only\b/i,
        reason: "Single earcup rather than complete headphones",
      },
    ],
    Cameras: [
      {
        pattern:
          /\b(lens|battery grip|grip|strap|bag|case|charger|body cap|lens cap)\s+only\b/i,
        reason: "Camera accessory rather than a complete camera",
      },
      {
        pattern: /\bcamera\s+(?:bag|strap|case|backpack|cage|rig)\b/i,
        reason: "Camera accessory rather than a complete camera",
      },
      {
        pattern: /\b(?:disposable|instant|film|trail|security|dash|web)\s?cam(?:era)?\b/i,
        reason: "Camera type outside the target resale market",
      },
    ],
  };

  for (const rule of categoryRules[category] || []) {
    if (rule.pattern.test(text)) {
      return rule.reason;
    }
  }

  return null;
}

// screeningCost is the lowest cost the listing can really have; it differs
// from totalBuyCost when the search result had no shipping quote.
function classifyTitle(
  title,
  totalBuyCost,
  category,
  screeningCost = totalBuyCost,
  dealType = "repair"
) {
  const text = title.toLowerCase();
  const accessoryReason = getAccessoryRejectReason(title);

  if (accessoryReason) {
    return {
      status: "rejected",
      analysisStatus: "filtered",
      score: 0,
      recommendation: "PASS",
      reasoning: accessoryReason,
    };
  }

  const categoryReason = getCategoryRejectReason(title, category);

  if (categoryReason) {
    return {
      status: "rejected",
      analysisStatus: "filtered",
      score: 0,
      recommendation: "PASS",
      reasoning: categoryReason,
    };
  }

  const rejectionRules = [
    {
      pattern: /\b(empty box|box only|packaging only)\b/,
      reason: "Packaging only",
    },
    {
      pattern: /\b(no pcb|without pcb|missing pcb)\b/,
      reason: "Main circuit board is missing",
    },
    {
      pattern: /\b(housing|heatsink|shell|chassis)\s+only\b/,
      reason: "Only an enclosure or cooling component",
    },
    {
      pattern: /\b(screen|display|motherboard|logic board)\s+only\b/,
      reason: "Individual component rather than a complete device",
    },
    {
      pattern: /\b(lot of|parts lot|bulk lot)\b/,
      reason: "Bulk parts lot",
    },
    {
      pattern:
        /\b(icloud locked|activation locked|mdm locked|bios password|computrace)\b/,
      reason: "Device is locked or ownership status is risky",
    },
    {
      pattern:
        /\b(liquid damage|water damage|corrosion|burnt board|burned board)\b/,
      reason: "High-risk board damage",
    },
    {
      pattern:
        /\b(remote control|charger|power adapter|cable|mount|stand)\s+only\b/,
      reason: "Accessory only",
    },
    {
      pattern: /\b(for display only|dummy unit)\b/,
      reason: "Nonfunctional display unit",
    },
  ];

  for (const rule of rejectionRules) {
    if (rule.pattern.test(text)) {
      return {
        status: "rejected",
        analysisStatus: "filtered",
        score: 0,
        recommendation: "PASS",
        reasoning: rule.reason,
      };
    }
  }

  const priceReason = getModelPriceRejectReason(title, category, screeningCost);

  if (priceReason) {
    return {
      status: "rejected",
      analysisStatus: "filtered",
      score: 0,
      recommendation: "PASS",
      reasoning: priceReason,
    };
  }

  if (dealType === "flip") {
    if (FLIP_FAULT_PATTERN.test(text)) {
      return {
        status: "rejected",
        analysisStatus: "filtered",
        score: 0,
        recommendation: "PASS",
        reasoning: "Flip listing mentions a fault or uncertainty",
      };
    }

    return {
      status: "candidate",
      analysisStatus: "awaiting_details",
      // Below repair candidates, so flips never crowd repairs out of the
      // enrichment and analysis queues.
      score: 25,
      recommendation: "REVIEW",
      reasoning: "Working item to resell without repair",
    };
  }

  let score = 30;
  const positiveSignals = [];

  const repairSignals = [
    {
      pattern: /\bbattery\b/,
      label: "Possible battery replacement",
    },
    {
      pattern: /\bboot(?:s|ing)? to bios\b/,
      label: "Boots to BIOS",
    },
    {
      pattern: /\b(no|missing)\s+(hdd|ssd|hard drive|storage)\b/,
      label: "Missing replaceable storage",
    },
    {
      pattern: /\bno ram\b/,
      label: "Missing replaceable RAM",
    },
    {
      pattern: /\bno os\b/,
      label: "May only need an operating system",
    },
    {
      pattern: /\b(cracked|damaged|broken)\s+(screen|display)\b/,
      label: "Identified screen issue",
    },
    {
      pattern: /\bhinge\b/,
      label: "Identified hinge issue",
    },
    {
      pattern: /\b(fan|pump)\s+(issue|issues|problem|problems)\b/,
      label: "Identified cooling issue",
    },
    {
      pattern: /\boverheat|overheating\b/,
      label: "Possible cooling repair",
    },
    {
      pattern: /\b(power jack|charging port|charge port)\b/,
      label: "Identified power connector issue",
    },
    {
      pattern: /\b(won't charge|not charging)\b/,
      label: "Possible battery or charging repair",
    },
    {
      pattern: /\b(disc drive|optical drive|won't read|not reading discs?)\b/,
      label: "Identified disc-drive issue",
    },
    {
      pattern: /\b(lamp|bulb|color wheel)\b/,
      label: "Identified projector service item",
    },
    {
      pattern: /\b(feed|feeding|paper jam|label jam|roller|sensor)\b/,
      label: "Identified printer feed issue",
    },
  ];

  for (const signal of repairSignals) {
    if (signal.pattern.test(text)) {
      score += 8;
      positiveSignals.push(signal.label);
    }
  }

  if (
    category === "Business Laptops" ||
    category === "Game Consoles" ||
    category === "Graphing Calculators"
  ) {
    score += 10;
  } else if (
    category === "Headphones" ||
    category === "Projectors" ||
    category === "Cameras"
  ) {
    score += 8;
  } else if (category === "Premium Audio") {
    score += 5;
  }

  if (totalBuyCost <= 50) {
    score += 12;
  } else if (totalBuyCost <= 100) {
    score += 6;
  }

  if (/\b(?:untested|not tested|unable to test)\b/.test(text)) {
    score -= 25;
  }
  if (/\b(?:as-is|as is)\b/.test(text)) {
    score -= 8;
  }
  if (/\b(?:no power|won't power on|doesn't power on|dead)\b/.test(text)) {
    score -= 30;
  }

  score = Math.max(5, Math.min(95, score));

  return {
    status: "candidate",
    analysisStatus: "awaiting_details",
    score,
    recommendation: "REVIEW",
    reasoning:
      positiveSignals.length > 0
        ? positiveSignals.join("; ")
        : "Complete device that requires more listing details",
  };
}

async function getEbayToken(env) {
  const response = await fetch(
    "https://api.ebay.com/identity/v1/oauth2/token",
    {
      method: "POST",
      headers: {
        Authorization:
          "Basic " +
          btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "https://api.ebay.com/oauth/api_scope",
      }),
    }
  );

  if (!response.ok) {
    throw new Error(
      `eBay token error ${response.status}: ${await response.text()}`
    );
  }

  const data = await response.json();

  return data.access_token;
}

async function scanListings(env) {
  let runId;

  try {
    await ensureRuntimeTables(env);
    const runResult = await env.DB.prepare(`
      INSERT INTO scan_runs (status)
      VALUES ('running')
    `).run();

    runId = runResult.meta.last_row_id;

    const { results: searches } = await env.DB.prepare(`
      SELECT *
      FROM searches
      WHERE enabled = 1
      ORDER BY id
    `).all();

    const accessToken = await getEbayToken(env);

    let listingsFound = 0;
    let newListings = 0;
    let olderOrUndatedIgnored = 0;

    const scanSlot = Math.floor(Date.now() / (5 * 60 * 1000));
    const searchTasks = searches.map((search) => ({
      search,
      query: getSearchTerm(search, scanSlot),
      dealType: "repair",
    }));
    // One additional rotating niche query per cycle increases coverage
    // without doubling Browse API usage.
    const rotatingSearches = searches.filter((search) => {
      const category = search.profile_key || search.category || search.name;
      return (SEARCH_TERMS[category] || []).length > 1;
    });
    if (rotatingSearches.length) {
      const search = rotatingSearches[scanSlot % rotatingSearches.length];
      const query = getSearchTerm(search, scanSlot + 1);
      if (query !== getSearchTerm(search, scanSlot)) {
        searchTasks.push({ search, query, dealType: "repair" });
      }
    }
    // One working-item flip search per cycle, rotating through categories,
    // keeps Browse API usage within the daily allowance.
    if (searches.length) {
      const search = searches[scanSlot % searches.length];
      searchTasks.push({
        search,
        query: getSearchTerm(search, Math.floor(scanSlot / searches.length)),
        dealType: "flip",
      });
    }
    for (const { search, query, dealType } of searchTasks) {
      const ebayUrl = new URL(
        "https://api.ebay.com/buy/browse/v1/item_summary/search"
      );

      ebayUrl.searchParams.set("q", query);
      ebayUrl.searchParams.set("limit", "200");
      ebayUrl.searchParams.set("sort", "newlyListed");

      if (search.category_id) {
        ebayUrl.searchParams.set(
          "category_ids",
          search.category_id
        );
      }

      // Flips use fixed-price listings only: an auction's current bid is not
      // the price the item will sell for.
      const profileKey = search.profile_key || search.category || search.name;
      const flipMaxPrice = getCategoryProfile(profileKey)?.flipMaxPrice || search.max_price;
      ebayUrl.searchParams.set(
        "filter",
        dealType === "flip"
          ? `conditionIds:{3000},buyingOptions:{FIXED_PRICE},itemLocationCountry:US,price:[..${flipMaxPrice}],priceCurrency:USD`
          : `conditionIds:{7000},itemLocationCountry:US,price:[..${search.max_price}],priceCurrency:USD`
      );

      const response = await fetch(ebayUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
          "X-EBAY-C-ENDUSERCTX": ebayBuyerContext(env),
        },
      });

      if (!response.ok) {
        throw new Error(
          `eBay search error ${response.status}: ${await response.text()}`
        );
      }

      const data = await response.json();
      const items = data.itemSummaries || [];

      listingsFound += items.length;
      const searchResultCount = Number(data.total) || 0;
      const searchSaturated = items.length >= 200;

      const recentItems = items.filter((item) => {
        const postedAt = Date.parse(item.itemCreationDate || "");
        const isRecent = Number.isFinite(postedAt) &&
          postedAt <= Date.now() && postedAt >= Date.now() - FRESH_LISTING_HOURS * 60 * 60 * 1000;
        if (!isRecent) olderOrUndatedIgnored += 1;
        return isRecent;
      });
      // Popular flip searches return hundreds of fresh working listings.
      // Only the cheapest few can be underpriced, and storing the rest would
      // flood the enrichment queue and D1's daily write allowance.
      if (dealType === "flip") {
        recentItems.sort((a, b) =>
          Number(a.price?.value || 0) - Number(b.price?.value || 0));
        recentItems.splice(FLIP_LISTINGS_PER_SEARCH);
      }

      let newForSearch = 0;
      if (recentItems.length > 0) {
        const statements = recentItems.map((item) => {
          const price = Number(item.price?.value || 0);

          // Initial estimate only; enrichment must confirm the shipping quote.
          const shippingQuote = quotedShipping(item.shippingOptions);
          const shipping = shippingQuote ?? 30;

          const estimatedTax =
            Math.round((price + shipping) * 0.06 * 100) / 100;

          const totalBuyCost =
            Math.round(
              (price + shipping + estimatedTax) * 100
            ) / 100;

          const classification = classifyTitle(
            item.title || "",
            totalBuyCost,
            search.profile_key || search.category || search.name,
            shippingQuote === null ? price * 1.06 : totalBuyCost,
            dealType
          );

          return env.DB.prepare(`
            INSERT OR IGNORE INTO listings (
              ebay_item_id,
              title,
              item_url,
              image_url,
              condition,
              category,
              price,
              shipping_cost,
              estimated_tax,
              total_buy_cost,
              item_end_date,
              item_creation_date,
              status,
              analysis_status,
              deal_score,
              recommendation,
              reasoning,
              deal_type
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            item.itemId,
            item.title || "Untitled eBay listing",
            item.itemWebUrl || "",
            item.image?.imageUrl || null,
            item.condition || "Unknown",
            search.profile_key || search.category || search.name,
            price,
            shipping,
            estimatedTax,
            totalBuyCost,
            item.itemEndDate || null,
            new Date(item.itemCreationDate).toISOString().replace("T", " ").slice(0, 19),
            classification.status,
            classification.analysisStatus,
            classification.score,
            classification.recommendation,
            classification.reasoning,
            dealType
          );
        });

        const writeResults = await env.DB.batch(statements);

        newForSearch = writeResults.reduce(
          (total, result) =>
            total + Number(result.meta?.changes || 0),
          0
        );
        newListings += newForSearch;
      }

      await env.DB.prepare(`
        INSERT INTO scan_search_stats (
          scan_run_id, category, query, result_count, reported_total,
          fresh_count, new_count, saturated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        runId, search.profile_key || search.category || search.name,
        dealType === "flip" ? `flip: ${query}` : query,
        items.length, searchResultCount, recentItems.length,
        newForSearch, searchSaturated ? 1 : 0
      ).run();

      await env.DB.prepare(`
        UPDATE searches
        SET last_scanned_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(search.id).run();
    }

    await env.DB.prepare(`
      UPDATE scan_runs
      SET
        completed_at = CURRENT_TIMESTAMP,
        listings_found = ?,
        new_listings = ?,
        status = 'completed'
      WHERE id = ?
    `).bind(listingsFound, newListings, runId).run();

    return {
      status: "Scan completed",
      searchesRun: searchTasks.length,
      listingsFound,
      newListings,
      duplicatesIgnored: listingsFound - newListings - olderOrUndatedIgnored,
      olderOrUndatedIgnored,
      saturatedSearches: (await env.DB.prepare(`SELECT COUNT(*) AS count FROM scan_search_stats WHERE scan_run_id = ? AND saturated = 1`).bind(runId).first())?.count || 0,
    };
  } catch (error) {
    if (runId) {
      try {
        const { results: columns } = await env.DB.prepare(
          "PRAGMA table_info(scan_runs)"
        ).all();
        const names = new Set(columns.map((column) => column.name));
        const errorColumn = names.has("error")
          ? "error"
          : names.has("error_message")
            ? "error_message"
            : null;

        if (errorColumn) {
          await env.DB.prepare(`
            UPDATE scan_runs
            SET completed_at = CURRENT_TIMESTAMP,
                status = 'failed',
                ${errorColumn} = ?
            WHERE id = ?
          `).bind(String(error.message || error).slice(0, 1000), runId).run();
        } else {
          await env.DB.prepare(`
            UPDATE scan_runs
            SET completed_at = CURRENT_TIMESTAMP, status = 'failed'
            WHERE id = ?
          `).bind(runId).run();
        }
      } catch (logError) {
        console.error("Could not record scan failure", logError);
      }
    }

    throw error;
  }
}

async function prefilterExisting(env) {
  const { results: listings } = await env.DB.prepare(`
    SELECT id, title, total_buy_cost, category
    FROM listings
    WHERE analysis_status = 'pending'
    ORDER BY id
    LIMIT 500
  `).all();

  let candidates = 0;
  let rejected = 0;
  const statements = [];

  for (const listing of listings) {
    const classification = classifyTitle(
      listing.title,
      listing.total_buy_cost,
      listing.category
    );

    if (classification.status === "candidate") {
      candidates += 1;
    } else {
      rejected += 1;
    }

    statements.push(
      env.DB.prepare(`
        UPDATE listings
        SET
          status = ?,
          analysis_status = ?,
          deal_score = ?,
          recommendation = ?,
          reasoning = ?
        WHERE id = ?
      `).bind(
        classification.status,
        classification.analysisStatus,
        classification.score,
        classification.recommendation,
        classification.reasoning,
        listing.id
      )
    );
  }

  for (let index = 0; index < statements.length; index += 50) {
    await env.DB.batch(statements.slice(index, index + 50));
  }

  const remaining = await env.DB.prepare(`
    SELECT COUNT(*) AS count
    FROM listings
    WHERE analysis_status = 'pending'
  `).first();

  return {
    status: "Prefilter completed",
    processed: listings.length,
    candidates,
    rejected,
    remainingPending: remaining.count,
  };
}

async function runAutomatedCycle(env) {
  await ensureRuntimeTables(env);
  await invalidateUnderpricedProjectorLeads(env);
  const run = await env.DB.prepare(`
    INSERT INTO cycle_runs (status) VALUES ('running')
  `).run();
  const cycleId = run.meta.last_row_id;
  const result = {};

  const stages = [
    ["scan", () => scanListings(env)],
    ["enrichment", () => enrichCandidates(env, 3)],
    ["analysis", () => analyzeCandidateBatch(env, 3)],
    ["alerts", () => sendPendingDealAlerts(env, 5)],
  ];

  for (const [stage, execute] of stages) {
    try {
      result[stage] = await execute();
      if (stage === 'analysis' && result[stage].completed > 0) {
        result.recovery = await requeueInvalidScreenings(env);
      }
    } catch (error) {
      result[stage] = {
        status: `${stage} failed`,
        details: String(error.message || error).slice(0, 500),
      };
      if (stage === "analysis") {
        await handleAnalysisError(env, error);
      }
    }
  }

  const errors = Object.entries(result)
    .filter(([, value]) =>
      /failed/i.test(value.status || "") ||
      Number(value.failed || 0) > 0
    )
    .map(([stage, value]) =>
      `${stage}: ${value.details || value.results?.find((item) => item.status === "Analysis failed")?.details || value.status}`
    );

  await env.DB.prepare(`
    UPDATE cycle_runs
    SET completed_at = CURRENT_TIMESTAMP,
        status = ?,
        summary = ?,
        error = ?
    WHERE id = ?
  `).bind(
    errors.length ? "partial_failure" : "completed",
    JSON.stringify({
      newListings: result.scan?.newListings || 0,
      enriched: result.enrichment?.enriched || 0,
      analyzed: result.analysis?.completed || 0,
      alerted: result.alerts?.sent || 0,
    }),
    errors.join(" | ").slice(0, 1000) || null,
    cycleId
  ).run();

  return result;
}

async function analyzeCandidateBatch(env, limit = 3) {
  const safeLimit = Math.min(
    Math.max(Number(limit) || 3, 1),
    5
  );
  const results = [];
  const usedCategories = [];

  for (let index = 0; index < safeLimit; index += 1) {
    let result;

    try {
      result = await analyzeNextCandidate(env, usedCategories);
    } catch (error) {
      await handleAnalysisError(env, error);
      results.push({
        status: "Analysis failed",
        details: error.message,
      });
      break;
    }

    if (
      result.status ===
      "No enriched candidates are waiting for analysis"
    ) {
      break;
    }

    results.push(result);

    if (result.listing?.category) {
      usedCategories.push(result.listing.category);
    }
  }

  return {
    status: "Analysis batch completed",
    attempted: results.length,
    completed: results.filter(
      (result) => result.status === "Analysis completed"
    ).length,
    filtered: results.filter(
      (result) => result.status === "Listing rejected before analysis"
    ).length,
    failed: results.filter(
      (result) => result.status === "Analysis failed"
    ).length,
    results,
  };
}

// Schema checks only need to succeed once per isolate. Repeating them on
// every stage of every five-minute cycle adds avoidable D1 work.
let runtimeTablesReady = null;

function ensureRuntimeTables(env) {
  if (!runtimeTablesReady) {
    runtimeTablesReady = createRuntimeTables(env).catch((error) => {
      runtimeTablesReady = null;
      throw error;
    });
  }
  return runtimeTablesReady;
}

async function createRuntimeTables(env) {
  const { results: listingColumns } = await env.DB.prepare(
    "PRAGMA table_info(listings)"
  ).all();
  if (!listingColumns.some((column) => column.name === "item_creation_date")) {
    await env.DB.prepare(
      "ALTER TABLE listings ADD COLUMN item_creation_date TEXT"
    ).run();
  }
  if (!listingColumns.some((column) => column.name === "deal_type")) {
    await env.DB.prepare(
      "ALTER TABLE listings ADD COLUMN deal_type TEXT NOT NULL DEFAULT 'repair'"
    ).run();
  }
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS ai_usage (
      usage_day TEXT PRIMARY KEY,
      screening_calls INTEGER NOT NULL DEFAULT 0,
      verification_calls INTEGER NOT NULL DEFAULT 0
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS sold_evidence (
      evidence_key TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      query TEXT NOT NULL,
      sold_price REAL,
      sales_count INTEGER NOT NULL,
      listing_count INTEGER NOT NULL,
      checked_at TEXT NOT NULL
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS ebay_usage (
      usage_day TEXT PRIMARY KEY,
      sold_lookups INTEGER NOT NULL DEFAULT 0
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS system_events (
      event_key TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS scan_search_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_run_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      query TEXT NOT NULL,
      result_count INTEGER NOT NULL,
      reported_total INTEGER NOT NULL,
      fresh_count INTEGER NOT NULL,
      new_count INTEGER NOT NULL,
      saturated INTEGER NOT NULL,
      scanned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS cycle_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      status TEXT NOT NULL,
      summary TEXT,
      error TEXT
    )
  `).run();

  // Without these, each queue, alert, and dashboard query reads the whole
  // listings table, which exhausts D1's free daily row-read allowance.
  await env.DB.batch(LISTING_INDEXES.map((sql) => env.DB.prepare(sql)));
}

const LISTING_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_listings_title
    ON listings (title)`,
  `CREATE INDEX IF NOT EXISTS idx_listings_queue
    ON listings (status, analysis_status, item_creation_date)`,
  `CREATE INDEX IF NOT EXISTS idx_listings_recommendation
    ON listings (recommendation, alerted_at, item_creation_date)`,
  `CREATE INDEX IF NOT EXISTS idx_listings_analysis_status
    ON listings (analysis_status, first_seen_at)`,
  `CREATE INDEX IF NOT EXISTS idx_listings_first_seen
    ON listings (first_seen_at)`,
  `CREATE INDEX IF NOT EXISTS idx_scan_search_stats_run
    ON scan_search_stats (scan_run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_scan_search_stats_scanned
    ON scan_search_stats (scanned_at)`,
];

async function requeueInvalidScreenings(env) {
  const eventKey = 'invalid-screenings-recovered-v1';
  const existing = await env.DB.prepare(`
    SELECT event_key FROM system_events WHERE event_key = ?
  `).bind(eventKey).first();
  if (existing) return { queued: 0, alreadyRecovered: true };

  const result = await env.DB.prepare(`
    UPDATE listings
    SET status = 'candidate',
        analysis_status = 'details_ready',
        recommendation = 'REVIEW',
        reasoning = NULL,
        deal_score = 25
    WHERE id IN (
      SELECT id FROM (
        SELECT id,
          ROW_NUMBER() OVER (
            PARTITION BY category ORDER BY first_seen_at DESC
          ) AS category_rank
        FROM listings
        WHERE analysis_status = 'complete'
          AND recommendation = 'PASS'
          AND first_seen_at >= datetime('now', '-24 hours')
          AND COALESCE(json_extract(reasoning, '$.comparisonSearchQuery'), '') = ''
          AND COALESCE(json_extract(reasoning, '$.repairSuccessProbability'), 0) = 0
          AND COALESCE(json_extract(reasoning, '$.estimatedPartsCost'), 0) = 0
      ) WHERE category_rank <= 8 LIMIT 48
    )
  `).run();

  await env.DB.prepare(`
    INSERT INTO system_events (event_key) VALUES (?)
  `).bind(eventKey).run();

  return { queued: Number(result.meta?.changes || 0) };
}

async function getPublicDashboardDiagnostics(env) {
  const [scans, cycles, queue] = await Promise.all([
    env.DB.prepare(`
      SELECT started_at, completed_at, status, listings_found, new_listings
      FROM scan_runs ORDER BY id DESC LIMIT 8
    `).all(),
    env.DB.prepare(`
      SELECT started_at, completed_at, status, summary
      FROM cycle_runs ORDER BY id DESC LIMIT 8
    `).all(),
    env.DB.prepare(`
      SELECT category, analysis_status, recommendation, COUNT(*) AS count
      FROM listings
      WHERE id IN (
        SELECT id FROM listings WHERE analysis_status = 'details_ready'
        UNION
        SELECT id FROM listings WHERE recommendation IN ('BUY', 'WATCH')
      )
      GROUP BY category, analysis_status, recommendation
      ORDER BY category, analysis_status, recommendation
    `).all(),
  ]);

  return {
    recentScans: scans.results,
    recentCycles: cycles.results,
    queue: queue.results,
  };
}

async function getDiagnostics(env) {
  await ensureRuntimeTables(env);
  const [recentScans, recentCycles, queue, recentDecisions, aiUsage,
    passReasons, nearMisses, validScreens, searchCoverage, queueAge] =
    await Promise.all([
      env.DB.prepare(`
        SELECT *
        FROM scan_runs ORDER BY id DESC LIMIT 12
      `).all(),
      env.DB.prepare(`
        SELECT started_at, completed_at, status, summary, error
        FROM cycle_runs ORDER BY id DESC LIMIT 12
      `).all(),
      env.DB.prepare(`
        SELECT category, analysis_status, recommendation,
               COUNT(*) AS count
        FROM listings
        GROUP BY category, analysis_status, recommendation
        ORDER BY category, analysis_status, recommendation
      `).all(),
      env.DB.prepare(`
        SELECT category, recommendation, COUNT(*) AS count
        FROM listings
        WHERE analysis_status = 'complete'
          AND first_seen_at >= datetime('now', '-24 hours')
        GROUP BY category, recommendation
      `).all(),
      env.DB.prepare(`
        SELECT usage_day, screening_calls, verification_calls
        FROM ai_usage ORDER BY usage_day DESC LIMIT 3
      `).all(),
      env.DB.prepare(`
        SELECT category,
          CASE
            WHEN COALESCE(json_extract(reasoning, '$.rejectReason'), '') <> ''
              THEN 'AI rejected repair'
            WHEN COALESCE(json_extract(reasoning, '$.comparableCount'), 0) < 3
              THEN 'Too few working comparables'
            WHEN json_extract(reasoning, '$.comparableLowConfidence') = 1
              THEN 'Uncertain comparable prices'
            WHEN COALESCE(json_extract(reasoning, '$.estimatedProfit'), 0) <
              CASE WHEN category = 'Graphing Calculators' THEN 25
                WHEN category IN ('Game Consoles', 'Headphones', 'Premium Audio')
                THEN 40 ELSE 50 END
              THEN 'Profit below BUY minimum'
            WHEN COALESCE(json_extract(reasoning, '$.roiPercent'), 0) <
              CASE WHEN category IN ('Game Consoles', 'Headphones', 'Premium Audio')
                THEN 45 ELSE 50 END
              THEN 'ROI below BUY minimum'
            WHEN COALESCE(json_extract(reasoning, '$.repairSuccessProbability'), 0) < 70
              THEN 'Repair probability below BUY minimum'
            WHEN COALESCE(json_extract(reasoning, '$.repairRisk'), 10) > 6
              THEN 'Repair risk above BUY maximum'
            ELSE 'Other decision gate'
          END AS reason,
          COUNT(*) AS count
        FROM listings
        WHERE analysis_status = 'complete'
          AND recommendation = 'PASS'
          AND first_seen_at >= datetime('now', '-24 hours')
        GROUP BY category, reason
        ORDER BY count DESC
      `).all(),
      env.DB.prepare(`
        SELECT title, category, total_buy_cost, estimated_profit,
               roi_percent, repair_risk,
               json_extract(reasoning, '$.comparableCount') AS comparable_count,
               json_extract(reasoning, '$.comparisonSearchQuery') AS comparison_query,
               json_extract(reasoning, '$.estimatedPartsCost') AS parts_cost,
               json_extract(reasoning, '$.repairSuccessProbability') AS success_probability,
               json_extract(reasoning, '$.rejectReason') AS reject_reason
        FROM listings
        WHERE analysis_status = 'complete'
          AND recommendation = 'PASS'
          AND first_seen_at >= datetime('now', '-24 hours')
        ORDER BY estimated_profit DESC, roi_percent DESC
        LIMIT 10
      `).all(),
      env.DB.prepare(`
        SELECT title, category, recommendation, total_buy_cost,
               estimated_profit, repair_risk,
               json_extract(reasoning, '$.comparisonSearchQuery') AS comparison_query,
               json_extract(reasoning, '$.searchQueriesTried') AS search_queries_tried,
               json_extract(reasoning, '$.comparableCount') AS comparable_count,
               json_extract(reasoning, '$.estimatedPartsCost') AS parts_cost,
               json_extract(reasoning, '$.repairSuccessProbability') AS success_probability
        FROM listings
        WHERE analysis_status = 'complete'
          AND COALESCE(json_extract(reasoning, '$.comparisonSearchQuery'), '') <> ''
        ORDER BY id DESC LIMIT 8
      `).all(),
      env.DB.prepare(`
        SELECT category, query, COUNT(*) AS runs,
          SUM(result_count) AS results_returned,
          SUM(fresh_count) AS fresh_results,
          SUM(new_count) AS new_listings,
          SUM(saturated) AS saturated_runs,
          MAX(scanned_at) AS last_scanned_at
        FROM scan_search_stats
        WHERE scanned_at >= datetime('now', '-24 hours')
        GROUP BY category, query ORDER BY category, query
      `).all(),
      env.DB.prepare(`
        SELECT category, analysis_status, COUNT(*) AS count
        FROM listings
        WHERE status = 'candidate'
          AND analysis_status IN ('awaiting_details', 'details_ready')
          AND item_creation_date >= datetime('now', '-24 hours')
          AND item_creation_date < datetime('now', '-12 hours')
        GROUP BY category, analysis_status
      `).all(),
    ]);

  return {
    generatedAt: new Date().toISOString(),
    timeZone: "UTC",
    recentScans: recentScans.results.map((scan) => ({
      started_at: scan.started_at,
      completed_at: scan.completed_at,
      status: scan.status,
      listings_found: scan.listings_found,
      new_listings: scan.new_listings,
      error: scan.error ?? scan.error_message ?? null,
    })),
    recentCycles: recentCycles.results,
    queue: queue.results,
    decisionsFromListingsFirstSeenInLast24Hours:
      recentDecisions.results,
    aiUsage: aiUsage.results,
    searchCoverageLast24Hours: searchCoverage.results,
    olderQueuedCandidates: queueAge.results,
    verificationLimitPerDay: DAILY_VERIFICATION_LIMIT,
    passReasonsLast24Hours: passReasons.results,
    closestPassesLast24Hours: nearMisses.results,
    recentScreeningsWithRealQueries: validScreens.results,
  };
}

async function recordAiUsage(env, column) {
  const allowedColumns = new Set([
    "screening_calls",
    "verification_calls",
  ]);

  if (!allowedColumns.has(column)) {
    return;
  }

  await ensureRuntimeTables(env);
  await env.DB.prepare(`
    INSERT INTO ai_usage (usage_day, ${column})
    VALUES (date('now'), 1)
    ON CONFLICT(usage_day) DO UPDATE SET
      ${column} = ${column} + 1
  `).run();
}

async function getVerificationCallsToday(env) {
  await ensureRuntimeTables(env);
  const row = await env.DB.prepare(`
    SELECT verification_calls
    FROM ai_usage
    WHERE usage_day = date('now')
  `).first();

  return Number(row?.verification_calls || 0);
}

function isAiQuotaError(error) {
  const message = String(error?.message || error || "").toLowerCase();

  return (
    message.includes("4006") ||
    message.includes("daily free allocation") ||
    message.includes("used up your daily")
  );
}

async function handleAnalysisError(env, error) {
  if (!isAiQuotaError(error) || !env.DISCORD_WEBHOOK_URL) {
    return;
  }

  await ensureRuntimeTables(env);
  const eventKey = `ai-quota-${new Date().toISOString().slice(0, 10)}`;
  const existing = await env.DB.prepare(`
    SELECT event_key FROM system_events WHERE event_key = ?
  `).bind(eventKey).first();

  if (existing) {
    return;
  }

  try {
    await postDiscordWebhook(env, {
      content: "⚠️ **BagSpec AI quota paused analysis**",
      embeds: [
        {
          title: "Listings are still being collected",
          description:
            "The free Workers AI allowance is exhausted for today. New eBay listings remain safely queued and analysis will resume after the daily reset.",
          color: 0xf1c40f,
        },
      ],
    });

    await env.DB.prepare(`
      INSERT OR IGNORE INTO system_events (event_key) VALUES (?)
    `).bind(eventKey).run();
  } catch {
    // A failed operational alert must never stop the scanner.
  }
}

function truncateDiscord(value, maximum = 1024) {
  const text = String(value ?? "");

  if (text.length <= maximum) {
    return text;
  }

  return `${text.slice(0, maximum - 1)}…`;
}

async function postDiscordWebhook(env, payload) {
  if (!env.DISCORD_WEBHOOK_URL) {
    throw new Error(
      "DISCORD_WEBHOOK_URL has not been added as a Cloudflare secret"
    );
  }

  const response = await fetch(env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...payload,
      allowed_mentions: { parse: [] },
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Discord returned ${response.status}: ${(
        await response.text()
      ).slice(0, 300)}`
    );
  }
}

async function sendDiscordTest(env) {
  await postDiscordWebhook(env, {
    content: "✅ BagSpec Discord alerts are connected.",
    embeds: [
      {
        title: "Test alert successful",
        description:
          "BagSpec will post a message here when it finds a qualified BUY deal.",
        color: 0x2ecc71,
      },
    ],
  });

  return {
    status: "Discord test sent",
  };
}

function buildDiscordDealPayload(listing) {
  let financials = {};

  try {
    financials = JSON.parse(listing.reasoning || "{}");
  } catch {
    financials = {};
  }

  const successProbability = Number(
    financials.repairSuccessProbability || 0
  );
  const redFlags = Array.isArray(financials.redFlags)
    ? financials.redFlags
    : [];
  const explanation =
    financials.explanation ||
    `Likely repair: ${listing.likely_issue || "Unknown"}`;

  const embed = {
    title: truncateDiscord(listing.title, 256),
    url: listing.item_url,
    description: truncateDiscord(explanation, 1000),
    color: 0x2ecc71,
    fields: [
      {
        name: "Buy cost",
        value: `$${Number(listing.total_buy_cost || 0).toFixed(2)}`,
        inline: true,
      },
      {
        name: "Suggested offer",
        value: `$${Number(listing.suggested_offer || 0).toFixed(2)}`,
        inline: true,
      },
      {
        name: "Projected profit",
        value: `$${Number(listing.estimated_profit || 0).toFixed(2)}`,
        inline: true,
      },
      {
        name: financials.modelSoldReference
          ? "Resale (capped at sold price)"
          : "Resale (asking-price estimate)",
        value:
          `eBay $${Number(listing.estimated_resale_ebay || 0).toFixed(2)}\n` +
          `Local $${Number(listing.estimated_resale_local || 0).toFixed(2)}`,
        inline: true,
      },
      listing.deal_type === "flip"
        ? {
            name: "Deal type",
            value: "Working flip\nNo repair planned",
            inline: true,
          }
        : {
            name: "Repair",
            value:
              `${truncateDiscord(listing.likely_issue || "Unknown", 150)}\n` +
              `Parts: $${Number(listing.estimated_parts_cost || 0).toFixed(2)}`,
            inline: true,
          },
      {
        name: "Risk",
        value:
          `${Number(listing.repair_risk || 0)}/10 risk\n` +
          `${successProbability}% success`,
        inline: true,
      },
      {
        name: "Recommendation",
        value:
          `BUY • Score ${Number(listing.deal_score || 0)}/100 • ` +
          `${listing.recommended_channel || "Best available channel"}`,
        inline: false,
      },
    ],
    footer: {
      text: "BagSpec • Verify condition and recent sold prices before purchasing",
    },
  };

  if (redFlags.length > 0) {
    embed.fields.push({
      name: "Red flags",
      value: truncateDiscord(redFlags.join(" • "), 1000),
      inline: false,
    });
  }

  if (listing.image_url) {
    embed.thumbnail = { url: listing.image_url };
  }

  return {
    content: "🔥 **BagSpec found a BUY deal**",
    embeds: [embed],
  };
}

async function sendPendingDealAlerts(env, limit = 3) {
  if (!env.DISCORD_WEBHOOK_URL) {
    return {
      status: "Discord not configured",
      sent: 0,
    };
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 3, 1), 10);
  // Use the same freshness window as enrichment and analysis; a shorter one
  // silently dropped BUYs analyzed late in the window. Skip ended listings.
  const { results: listings } = await env.DB.prepare(`
    SELECT *
    FROM listings
    WHERE
      recommendation = 'BUY'
      AND alerted_at IS NULL
      AND item_creation_date >= datetime('now', ?)
      AND (item_end_date IS NULL OR julianday(item_end_date) > julianday('now'))
    ORDER BY item_creation_date DESC, deal_score DESC
    LIMIT ?
  `).bind(`-${FRESH_LISTING_HOURS} hours`, safeLimit).all();

  // Remove previously scored component-only listings from the deals list.
  await env.DB.prepare(`
    UPDATE listings
    SET status = 'rejected', analysis_status = 'filtered',
      deal_score = 0, recommendation = 'PASS',
      reasoning = 'Printer part rather than a complete label printer'
    WHERE category = 'Label Printers'
      AND recommendation IN ('BUY', 'WATCH')
      AND (lower(title) LIKE '%printer part - %'
        OR lower(title) LIKE '%printer part: %')
  `).run();

  const sent = [];
  const failed = [];

  for (const listing of listings) {
    try {
      let details = {};
      try {
        details = JSON.parse(listing.description || "{}");
      } catch {
        details = { shortDescription: listing.description || "" };
      }
      const accessoryReason = getAccessoryRejectReason(listing.title) ||
        getCategoryRejectReason(listing.title, listing.category);
      const shippingQuote = savedShippingQuote(details);
      const rejectReason = accessoryReason || (shippingQuote === null ||
        Math.abs(shippingQuote - Number(listing.shipping_cost)) > 0.01
        ? "Shipping quote unavailable or changed since analysis; buy cost must be recalculated"
        : getSellerRejectReason(listing, details) ||
          getUnverifiedConsoleReason(listing, details));
      if (rejectReason) {
        await env.DB.prepare(`
          UPDATE listings SET status = 'rejected', analysis_status = 'filtered',
            deal_score = 0, recommendation = 'PASS', reasoning = ? WHERE id = ?
        `).bind(rejectReason, listing.id).run();
        continue;
      }
      await postDiscordWebhook(
        env,
        buildDiscordDealPayload(listing)
      );

      await env.DB.prepare(`
        UPDATE listings
        SET alerted_at = CURRENT_TIMESTAMP
        WHERE id = ? AND alerted_at IS NULL
      `).bind(listing.id).run();

      sent.push({ id: listing.id, title: listing.title });
    } catch (error) {
      failed.push({
        id: listing.id,
        title: listing.title,
        error: error.message,
      });
    }
  }

  return {
    status: "Discord alert check completed",
    sent: sent.length,
    failed: failed.length,
    sentItems: sent,
    failedItems: failed,
  };
}

async function enrichCandidates(env, limit = 10) {
  const safeLimit = Math.min(
    Math.max(Number(limit) || 10, 1),
    20
  );

  const { results: rankedListings } = await env.DB.prepare(`
    SELECT id, ebay_item_id, title, category, deal_score, first_seen_at, item_creation_date
    FROM listings
    WHERE
      status = 'candidate'
      AND analysis_status = 'awaiting_details'
      AND item_creation_date >= datetime('now', '-12 hours')
    ORDER BY
      deal_score + CASE
        WHEN item_creation_date >= datetime('now', '-1 hour') THEN 20
        WHEN item_creation_date >= datetime('now', '-12 hours') THEN 8
        ELSE 0
      END DESC,
      item_creation_date DESC
    LIMIT 180
  `).all();

  const listings = selectCategoryBalancedListings(
    rankedListings,
    safeLimit
  );

  if (listings.length === 0) {
    return {
      status: "Enrichment completed",
      attempted: 0,
      enriched: 0,
      failed: 0,
      message: "No candidates are waiting for details",
    };
  }

  const accessToken = await getEbayToken(env);

  const outcomes = await Promise.all(
    listings.map(async (listing) => {
      try {
        const itemUrl =
          "https://api.ebay.com/buy/browse/v1/item/" +
          encodeURIComponent(listing.ebay_item_id);

        const response = await fetch(itemUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
            "X-EBAY-C-ENDUSERCTX": ebayBuyerContext(env),
          },
        });

        if (!response.ok) {
          const responseText = await response.text();

          throw new Error(
            `eBay returned ${response.status}: ${responseText.slice(0, 250)}`
          );
        }

        const item = await response.json();

        const itemSpecifics = {};

        for (const aspect of item.localizedAspects || []) {
          if (aspect.name && aspect.value) {
            itemSpecifics[aspect.name] = aspect.value;
          }
        }

        const shippingDetails = (item.shippingOptions || []).map(
          (option) => ({
            type: option.shippingCostType || null,
            cost: option.shippingCost?.value ?? null,
            currency: option.shippingCost?.currency || "USD",
            minDeliveryDate: option.minEstimatedDeliveryDate || null,
            maxDeliveryDate: option.maxEstimatedDeliveryDate || null,
          })
        );

        const savedDetails = {
          shortDescription: item.shortDescription || "",
          conditionDescription: item.conditionDescription || "",
          fullDescription: String(item.description || "").slice(0, 12000),
          itemSpecifics,
          buyingOptions: item.buyingOptions || [],
          shippingDetails,
          returnsAccepted:
            item.returnTerms?.returnsAccepted ?? null,
          returnPeriod: item.returnTerms?.returnPeriod || null,
          returnShippingCostPayer:
            item.returnTerms?.returnShippingCostPayer || null,
        };

        return {
          ok: true,
          id: listing.id,
          title: listing.title,
          condition: item.condition || "",
          description: JSON.stringify(savedDetails),
          shipping: quotedShipping(item.shippingOptions),
          price: Number(item.price?.value),
        };
      } catch (error) {
        return {
          ok: false,
          id: listing.id,
          title: listing.title,
          error: error.message.slice(0, 300),
        };
      }
    })
  );

  const updates = outcomes.map((outcome) => {
    if (outcome.ok) {
      if (outcome.shipping === null || !Number.isFinite(outcome.price) || outcome.price <= 0) {
        return env.DB.prepare(`
          UPDATE listings SET description = ?, status = 'rejected',
            analysis_status = 'filtered', recommendation = 'PASS',
            deal_score = 0,
            reasoning = 'Destination-specific shipping or price unavailable; cannot verify buy cost'
          WHERE id = ?
        `).bind(outcome.description, outcome.id);
      }
      const tax = Math.round((outcome.price + outcome.shipping) * 0.06 * 100) / 100;
      const buyCost = Math.round((outcome.price + outcome.shipping + tax) * 100) / 100;
      return env.DB.prepare(`
        UPDATE listings SET description = ?, price = ?, shipping_cost = ?,
          estimated_tax = ?, total_buy_cost = ?,
          condition = CASE WHEN ? = '' THEN condition ELSE ? END,
          analysis_status = 'details_ready', last_seen_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(outcome.description, outcome.price, outcome.shipping, tax,
        buyCost, outcome.condition, outcome.condition, outcome.id);
    }

    return env.DB.prepare(`
      UPDATE listings
      SET
        analysis_status = 'detail_failed',
        reasoning = reasoning || '; Detail request failed'
      WHERE id = ?
    `).bind(outcome.id);
    });

    if (updates.length > 0) {
      await env.DB.batch(updates);
    }

    const enriched = outcomes.filter(
      (outcome) => outcome.ok
    ).length;

    const failedItems = outcomes
      .filter((outcome) => !outcome.ok)
      .map((outcome) => ({
        title: outcome.title,
        error: outcome.error,
      }));

    const remaining = await env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM listings
      WHERE
        status = 'candidate'
        AND analysis_status = 'awaiting_details'
        AND item_creation_date >= datetime('now', '-12 hours')
    `).first();

    return {
      status: "Enrichment completed",
      attempted: outcomes.length,
      enriched,
      failed: failedItems.length,
      remainingAwaitingDetails: remaining.count,
      failedItems,
    };
  }

function selectCategoryBalancedListings(listings, limit) {
  const selected = [];
  const selectedIds = new Set();
  const categoryOrder = V2_SEARCHES.map(([, category]) => category);
  const offset = Math.floor(Date.now() / 300000) % categoryOrder.length;
  const rotated = categoryOrder.slice(offset).concat(categoryOrder.slice(0, offset));

  for (const category of rotated) {
    const listing = listings.find((candidate) => candidate.category === category);
    if (listing && !selectedIds.has(listing.id)) {
      selected.push(listing);
      selectedIds.add(listing.id);
    }
    if (selected.length >= limit) return selected;
  }

  for (const listing of listings) {
    if (!selectedIds.has(listing.id)) {
      selected.push(listing);
      selectedIds.add(listing.id);
    }

    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

async function analyzeNextCandidate(env, excludedCategories = []) {
  const exclusions = Array.isArray(excludedCategories)
    ? excludedCategories.filter(Boolean)
    : [];
  const exclusionSql = exclusions.length
    ? `AND category NOT IN (${exclusions.map(() => "?").join(", ")})`
    : "";

  let { results: rankedListings } = await env.DB.prepare(`
    SELECT *
    FROM listings
    WHERE
      status = 'candidate'
      AND analysis_status = 'details_ready'
      AND item_creation_date >= datetime('now', '-12 hours')
      ${exclusionSql}
    ORDER BY
      deal_score + CASE
        WHEN item_creation_date >= datetime('now', '-1 hour') THEN 20
        WHEN item_creation_date >= datetime('now', '-12 hours') THEN 8
        ELSE 0
      END DESC,
      item_creation_date DESC
    LIMIT 180
  `).bind(...exclusions).all();

  if (!rankedListings.length && exclusions.length > 0) {
    ({ results: rankedListings } = await env.DB.prepare(`
      SELECT *
      FROM listings
      WHERE
        status = 'candidate'
        AND analysis_status = 'details_ready'
        AND item_creation_date >= datetime('now', '-12 hours')
      ORDER BY
        deal_score + CASE
          WHEN item_creation_date >= datetime('now', '-1 hour') THEN 20
          WHEN item_creation_date >= datetime('now', '-12 hours') THEN 8
          ELSE 0
        END DESC,
        item_creation_date DESC
      LIMIT 180
    `).all());
  }

  const listing = selectCategoryBalancedListings(rankedListings, 1)[0];

  if (!listing) {
    return {
      status: "No enriched candidates are waiting for analysis",
    };
  }

  const accessoryReason =
    getAccessoryRejectReason(listing.title) ||
    getCategoryRejectReason(listing.title, listing.category);

  if (accessoryReason) {
    await env.DB.prepare(`
      UPDATE listings
      SET
        status = 'rejected',
        analysis_status = 'filtered',
        deal_score = 0,
        recommendation = 'PASS',
        reasoning = ?
      WHERE id = ?
    `).bind(accessoryReason, listing.id).run();

    return {
      status: "Listing rejected before analysis",
      listing: {
        title: listing.title,
        link: listing.item_url,
        category: listing.category,
      },
      reason: accessoryReason,
    };
  }

  let savedDetails = {};

  try {
    savedDetails = JSON.parse(listing.description || "{}");
  } catch {
    savedDetails = {
      shortDescription: listing.description || "",
    };
  }

  const sellerRejectReason = getSellerRejectReason(listing, savedDetails) ||
    getUnverifiedConsoleReason(listing, savedDetails);
  if (sellerRejectReason) {
    await env.DB.prepare(`
      UPDATE listings SET status = 'rejected', analysis_status = 'filtered',
        deal_score = 0, recommendation = 'PASS', reasoning = ? WHERE id = ?
    `).bind(sellerRejectReason, listing.id).run();
    return {
      status: "Listing rejected before analysis",
      listing: { title: listing.title, link: listing.item_url, category: listing.category },
      reason: sellerRejectReason,
    };
  }

  const laptopModel = getVerifiedLaptopModel(listing, savedDetails);
  if (isLaptopCategory(listing.category) && !laptopModel) {
    const reason = "Exact laptop model is not stated by the seller; resale comparables cannot be trusted";
    await env.DB.prepare(`
      UPDATE listings SET status = 'rejected', analysis_status = 'filtered',
        deal_score = 0, recommendation = 'PASS', reasoning = ? WHERE id = ?
    `).bind(reason, listing.id).run();
    return {
      status: "Listing rejected before analysis",
      listing: { title: listing.title, link: listing.item_url, category: listing.category },
      reason,
    };
  }

  // A seller relisting the same item at the same or a higher price means it
  // did not sell there, so it is not underpriced.
  const relisted = await env.DB.prepare(`
    SELECT 1 FROM listings
    WHERE title = ? AND id <> ? AND price <= ?
      AND first_seen_at <= datetime(?, '-3 days')
    LIMIT 1
  `).bind(listing.title, listing.id, listing.price, listing.first_seen_at).first();
  if (relisted) {
    const reason = "Relisted at the same or a lower earlier price; it has not sold";
    await env.DB.prepare(`
      UPDATE listings SET status = 'rejected', analysis_status = 'filtered',
        deal_score = 0, recommendation = 'PASS', reasoning = ? WHERE id = ?
    `).bind(reason, listing.id).run();
    return {
      status: "Listing rejected before analysis",
      listing: { title: listing.title, link: listing.item_url, category: listing.category },
      reason,
    };
  }

  // Recheck against the verified, destination-specific buy cost from
  // enrichment before spending an AI call.
  const priceReason = getModelPriceRejectReason(
    listing.title, listing.category, listing.total_buy_cost
  );
  if (priceReason) {
    await env.DB.prepare(`
      UPDATE listings SET status = 'rejected', analysis_status = 'filtered',
        deal_score = 0, recommendation = 'PASS', reasoning = ? WHERE id = ?
    `).bind(priceReason, listing.id).run();
    return {
      status: "Listing rejected before analysis",
      listing: { title: listing.title, link: listing.item_url, category: listing.category },
      reason: priceReason,
    };
  }

  const isFlip = listing.deal_type === "flip";
  const flipEvidence = [listing.title, savedDetails.conditionDescription]
    .filter(Boolean).join(" ").toLowerCase();
  if (isFlip && FLIP_FAULT_PATTERN.test(flipEvidence)) {
    const reason = "Seller's condition notes mention a fault or uncertainty";
    await env.DB.prepare(`
      UPDATE listings SET status = 'rejected', analysis_status = 'filtered',
        deal_score = 0, recommendation = 'PASS', reasoning = ? WHERE id = ?
    `).bind(reason, listing.id).run();
    return {
      status: "Listing rejected before analysis",
      listing: { title: listing.title, link: listing.item_url, category: listing.category },
      reason,
    };
  }

  const listingData = {
    title: listing.title,
    dealType: isFlip ? "flip" : "repair",
    category: listing.category,
    condition: listing.condition,
    price: listing.price,
    inboundShipping: listing.shipping_cost,
    estimatedTax: listing.estimated_tax,
    totalPurchaseCost: listing.total_buy_cost,
    details: savedDetails,
  };

  // Working flips need no repair diagnosis, so they skip the AI screening.
  const analysis = isFlip
    ? getFlipAnalysis(listing)
    : await screenRepairWithAi(env, listing, listingData, savedDetails);

  let comps = {
    count: 0,
    prices: [],
    conservativeResale: 0,
    lowConfidence: true,
  };

  if (laptopModel && !normalizeModelText(analysis.comparisonSearchQuery).includes(laptopModel)) {
    analysis.reject = true;
    analysis.rejectReason = "AI comparison query omitted the seller-stated laptop model";
  }

  if (!analysis.reject && analysis.comparisonSearchQuery) {
    comps = await findWorkingComparables(
      env,
      analysis.comparisonSearchQuery,
      listing.category,
      laptopModel
    );
  }

  const repairEvidence = getSellerEvidence(listing, savedDetails);
  const referencePartsCost = isFlip
    ? 0
    : getRepairPartsCost(analysis.faultType, listing, repairEvidence);
  const partsCost = roundMoney(
    Math.max(
      Number(analysis.partsCostLow) || 0,
      Number(analysis.partsCostHigh) || 0,
      referencePartsCost || 0
    )
  );

  const repairRisk = clamp(
    Number(analysis.repairRisk) || 10,
    1,
    10
  );

  const successProbability = clamp(
    Number(analysis.repairSuccessProbability) || 0,
    0,
    100
  );

  // Asking prices run well above what items actually sell for, so a known
  // model's resale never exceeds its typical sold price, and other models
  // are discounted.
  let modelResale = matchModelResale(listing.title, listing.category);
  if (!modelResale && !analysis.reject && comps.count >= 3 && !comps.lowConfidence) {
    try {
      modelResale = await getSoldEvidence(env, listing.category, comps);
    } catch (error) {
      console.error("Sold evidence lookup failed", error);
    }
  }
  const ebayResale = roundMoney(
    modelResale
      ? Math.min(comps.conservativeResale, modelResale.resale)
      : comps.conservativeResale * UNREFERENCED_SOLD_RATE
  );

  const buyBlockedBy = [];
  if (!modelResale) buyBlockedBy.push("no sold-price reference for this model");
  if (referencePartsCost === null)
    buyBlockedBy.push("repair type is unconfirmed or has no parts-price reference");
  const localResale = roundMoney(
    ebayResale * getLocalResaleRate(listing.category)
  );

  const outboundShipping = getOutboundShippingEstimate(
    listing.category
  );

  const packingCost = 5;
  const ebayFee = roundMoney(ebayResale * 0.136 + 0.4);

  const riskReserve = roundMoney(
    Math.min(
      50,
      Math.max(
        5,
        ((100 - successProbability) / 100) *
          listing.total_buy_cost *
          0.35
      )
    )
  );

  const ebayProfit = roundMoney(
    ebayResale -
      ebayFee -
      outboundShipping -
      packingCost -
      listing.total_buy_cost -
      partsCost -
      riskReserve
  );

  const localProfit = roundMoney(
    localResale -
      listing.total_buy_cost -
      partsCost -
      riskReserve -
      5
  );

  const recommendedChannel =
    ebayProfit > localProfit + LOCAL_PREFERENCE_DOLLARS ? "eBay" : "Local";

  const estimatedProfit =
    recommendedChannel === "eBay" ? ebayProfit : localProfit;
  const thresholds = getDecisionThresholds(listing.category);

  const investment =
    listing.total_buy_cost +
    partsCost +
    packingCost +
    (recommendedChannel === "eBay" ? outboundShipping : 5);

  const roiPercent =
    investment > 0
      ? roundMoney((estimatedProfit / investment) * 100)
      : 0;

  let recommendation = "PASS";
  let newStatus = "rejected";
  let verification = null;

  if (
    !analysis.reject &&
    buyBlockedBy.length === 0 &&
    !comps.lowConfidence &&
    comps.count >= 3 &&
    estimatedProfit >= thresholds.buyProfit &&
    roiPercent >= thresholds.buyRoi &&
    successProbability >= 70 &&
    repairRisk <= 6
  ) {
    recommendation = "BUY";
    newStatus = "qualified";
  } else if (
    !analysis.reject &&
    !comps.lowConfidence &&
    comps.count >= 3 &&
    estimatedProfit >= thresholds.watchProfit &&
    roiPercent >= thresholds.watchRoi &&
    successProbability >= 60
  ) {
    recommendation = "WATCH";
    newStatus = "analyzed";
  }

  if (recommendation === "BUY") {
    const verificationCalls = await getVerificationCallsToday(env);

    if (verificationCalls >= DAILY_VERIFICATION_LIMIT) {
      verification = {
        approved: false,
        reason:
          "Daily large-model verification cap reached. Kept as WATCH for safety.",
        redFlags: [],
      };
    } else {
      try {
        verification = await verifyPotentialBuy(env, {
          listing: listingData,
          screening: analysis,
          comparableCount: comps.count,
          comparableSamples: (comps.comparables || []).slice(0, 5),
          ebayResale,
          localResale,
          purchaseCost: listing.total_buy_cost,
          partsCost,
          riskReserve,
          recommendedChannel,
          estimatedProfit,
          roiPercent,
        });
      } catch (error) {
        await handleAnalysisError(env, error);
        verification = {
          approved: false,
          reason: `Final verification unavailable: ${String(error.message || error).slice(0, 180)}`,
          redFlags: [],
        };
      }
    }

    if (!verification.approved) {
      recommendation = "WATCH";
      newStatus = "analyzed";
    }
  }

  const targetProfit = thresholds.targetProfit;

  const availableAllIn =
    recommendedChannel === "eBay"
      ? ebayResale -
        ebayFee -
        outboundShipping -
        packingCost -
        partsCost -
        riskReserve -
        targetProfit
      : localResale -
        partsCost -
        riskReserve -
        5 -
        targetProfit;

  const calculatedOffer = roundMoney(
    Math.max(
      0,
      (availableAllIn - listing.shipping_cost) / 1.06
    )
  );

  const lowballCap = roundMoney(
    Math.max(0, Number(listing.price || 0) * 0.8)
  );

  const suggestedOffer =
    recommendation === "PASS"
      ? 0
      : Math.min(calculatedOffer, lowballCap);

  const profitScore = clamp(
    (Math.max(estimatedProfit, 0) / 100) * 35,
    0,
    35
  );

  const roiScore = clamp(
    (Math.max(roiPercent, 0) / 100) * 25,
    0,
    25
  );

  const successScore = successProbability * 0.3;
  const riskPenalty = repairRisk * 2;

  const dealScore = Math.round(
    clamp(
      profitScore +
        roiScore +
        successScore +
        (comps.count >= 5 ? 10 : 0) -
        riskPenalty,
      0,
      100
    )
  );

  const finalExplanation =
    comps.count < 3
      ? `${recommendation}: BagSpec found only ${comps.count} valid working comparable listing${comps.count === 1 ? "" : "s"}, so there is not enough reliable market data to estimate resale value. The likely issue is ${analysis.likelyIssue}. Repair difficulty is ${analysis.repairDifficulty}/10, risk is ${repairRisk}/10, and estimated repair success is ${successProbability}%. Estimated parts cost is $${partsCost.toFixed(2)}. This deal is being passed because the resale value cannot be verified and the repair risk is too high.`
      : comps.lowConfidence
        ? `${recommendation}: BagSpec found ${comps.count} possible comparables, but their prices vary too widely to establish a reliable value for this exact configuration. The likely issue is ${analysis.likelyIssue}. Repair difficulty is ${analysis.repairDifficulty}/10, risk is ${repairRisk}/10, and estimated repair success is ${successProbability}%. Estimated parts cost is $${partsCost.toFixed(2)}. This deal is being passed until the exact configuration can be valued confidently.`
      : isFlip
        ? `${recommendation}: Working resale flip with no planned repair. BagSpec found ${comps.count} valid working comparables and estimated resale at $${ebayResale.toFixed(2)} on eBay or $${localResale.toFixed(2)} locally, producing an estimated ${recommendedChannel} profit of $${estimatedProfit.toFixed(2)} and an ROI of ${roiPercent.toFixed(1)}%.`
      : `${recommendation}: The likely issue is ${analysis.likelyIssue}. Repair difficulty is ${analysis.repairDifficulty}/10, risk is ${repairRisk}/10, and estimated repair success is ${successProbability}%. BagSpec found ${comps.count} valid working comparables and estimated resale at $${ebayResale.toFixed(2)} on eBay or $${localResale.toFixed(2)} locally. Estimated parts cost is $${partsCost.toFixed(2)}, producing an estimated ${recommendedChannel} profit of $${estimatedProfit.toFixed(2)} and an ROI of ${roiPercent.toFixed(1)}%.`;

  const explanationWithLimits =
    recommendation === "WATCH" && buyBlockedBy.length
      ? `${finalExplanation} Not eligible for BUY: ${buyBlockedBy.join("; ")}.`
      : finalExplanation;

  const financialBreakdown = {
    dealType: isFlip ? "flip" : "repair",
    faultType: analysis.faultType,
    referencePartsCost,
    partsReferenceChecked: REPAIR_PARTS_CHECKED,
    buyBlockedBy,
    comparisonSearchQuery: analysis.comparisonSearchQuery,
    searchQueriesTried: comps.searchQueriesTried || [],
    comparableCount: comps.count,
    comparableLowConfidence: comps.lowConfidence,
    comparablePriceSpread: comps.priceSpread || 0,
    comparablePrices: comps.prices.slice(0, 10),
    purchaseCost: listing.total_buy_cost,
    estimatedPartsCost: partsCost,
    riskReserve,
    modelSoldReference: modelResale
      ? {
          model: modelResale.model,
          typicalSoldPrice: modelResale.resale,
          checked: modelResale.checked || MODEL_RESALE_CHECKED,
          source: modelResale.source || "BagSpec sold-price table",
          sales: modelResale.sales ?? null,
        }
      : null,
    ebayResale,
    localResale,
    ebayFee,
    outboundShipping,
    packingCost,
    ebayProfit,
    localProfit,
    recommendedChannel,
    estimatedProfit,
    roiPercent,
    suggestedOffer,
    repairDifficulty: analysis.repairDifficulty,
    repairRisk,
    repairSuccessProbability: successProbability,
    redFlags: analysis.redFlags,
    finalVerification: verification,
    explanation: explanationWithLimits,
    rejectReason: analysis.rejectReason,
  };

  await env.DB.prepare(`
    UPDATE listings
    SET
      likely_issue = ?,
      estimated_parts_cost = ?,
      estimated_resale_local = ?,
      estimated_resale_ebay = ?,
      estimated_profit = ?,
      roi_percent = ?,
      repair_risk = ?,
      deal_score = ?,
      suggested_offer = ?,
      recommended_channel = ?,
      recommendation = ?,
      reasoning = ?,
      status = ?,
      analysis_status = 'complete'
    WHERE id = ?
  `).bind(
    analysis.likelyIssue,
    partsCost,
    localResale,
    ebayResale,
    estimatedProfit,
    roiPercent,
    repairRisk,
    dealScore,
    suggestedOffer,
    recommendedChannel,
    recommendation,
    JSON.stringify(financialBreakdown),
    newStatus,
    listing.id
  ).run();

  return {
    status: "Analysis completed",
    listing: {
      title: listing.title,
      link: listing.item_url,
      category: listing.category,
      totalPurchaseCost: listing.total_buy_cost,
    },
    repair: {
      likelyIssue: analysis.likelyIssue,
      difficulty: analysis.repairDifficulty,
      risk: repairRisk,
      successProbability,
      estimatedPartsCost: partsCost,
    },
    resale: {
      comparisonSearchQuery: analysis.comparisonSearchQuery,
      searchQueriesTried: comps.searchQueriesTried || [],
      comparableCount: comps.count,
      lowConfidence: comps.lowConfidence,
      priceSpread: comps.priceSpread || 0,
      ebay: ebayResale,
      local: localResale,
      comparableSamples: (comps.comparables || [])
        .slice(0, 5)
        .map((item) => ({
          title: item.title,
          total: item.total,
        })),
    },
    decision: {
      recommendation,
      dealScore,
      recommendedChannel,
      estimatedProfit,
      roiPercent,
      suggestedOffer,
      finalVerification: verification,
    },
    redFlags: analysis.redFlags,
    explanation: explanationWithLimits,
  };
}

async function verifyPotentialBuy(env, context) {
  const result = await env.AI.run(
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    {
      messages: [
        {
          role: "system",
          content: `
You are the final safety reviewer for an electronics repair purchase.
Approve only when the listing evidence supports the diagnosis, the repair is
realistic for a DIY flipper, the parts estimate is conservative, the working
comparables match the actual device, and the stated profit has adequate room
for uncertainty. Reject locks, liquid damage, corrosion, unknown no-power or
board-level faults, suspicious comparables, and unsupported assumptions.
For a listing whose dealType is "flip", no repair is planned: approve only
when the listing describes a complete, working unit with no stated faults
and the comparables match its exact model and configuration.
Do not redo arithmetic. Return concise JSON only.
          `.trim(),
        },
        {
          role: "user",
          content:
            "Verify this potential BUY:\n" +
            JSON.stringify(context).slice(0, 10000),
        },
      ],
      temperature: 0,
      max_tokens: 300,
      response_format: {
        type: "json_schema",
        json_schema: {
          type: "object",
          properties: {
            approved: { type: "boolean" },
            reason: { type: "string" },
            redFlags: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["approved", "reason", "redFlags"],
        },
      },
    }
  );

  await recordAiUsage(env, "verification_calls");
  const verification = parseAiResponse(result);

  return {
    approved: verification.approved === true,
    reason: String(verification.reason || "No verification reason supplied"),
    redFlags: Array.isArray(verification.redFlags)
      ? verification.redFlags.map(String).slice(0, 8)
      : [],
  };
}

async function screenRepairWithAi(env, listing, listingData, savedDetails) {
  const aiResult = await env.AI.run(
    "@cf/ibm-granite/granite-4.0-h-micro",
    {
      messages: [
        {
          role: "system",
          content: `
You are a conservative electronics repair screener.

Evaluate damaged or nonworking electronics for a DIY repair flipper.
Never invent facts that are not in the listing.
Treat liquid damage, device locks, missing motherboards, severe corrosion,
and unknown board-level failures as high risk.
Simple replaceable components such as batteries, RAM, storage drives,
fans, power supplies, lamps, and external adapters are preferable.

Parts estimates must include likely replacement parts and small supplies.
The comparison search query must identify the exact configuration, not merely
the broad model family. Include the brand, model number, and any known year,
generation, processor tier, RAM, or storage capacity needed to avoid mixing
materially different versions. Use 3 to 10 words. Do not include condition or
marketplace words such as used, broken, parts, repair, working, or eBay.

repairDifficulty and repairRisk must be numbers from 1 to 10. Do not add
words or explanations to either number. For example, use 5, not "Moderate",
and use 8, not "8 - high risk".
Repair success probability must be an integer percentage from 0 to 100.
For example, 80 means an 80 percent probability, not 0.80.

Use these approximate repair-success ranges:
- Missing RAM, SSD, battery, charger, lamp, fan, or another easily
  replaceable part: 70 to 90
- A clearly identified minor repair: 65 to 85
- Powers on but is otherwise untested: 50 to 70
- No power with an unknown cause: 20 to 45
- Liquid damage, corrosion, device locks, or suspected board failure: 5 to 25

Only use 0 when the item is effectively irreparable or is missing a critical
motherboard or main assembly. Do not assume a motherboard failure merely
because RAM, storage, a battery, or a charger is missing. Do not include an
expensive speculative motherboard unless the listing provides evidence that
the motherboard failed.

The explanation must discuss only the actual item, likely repair, evidence,
repair difficulty, and uncertainty. Do not estimate resale value or profit.
Never explain how the comparison query was constructed or refer to these
instructions.

faultType names the repair and must be exactly one of: missing_storage,
missing_ram, missing_storage_and_ram, battery, charger, software,
fan_or_thermal, keyboard, screen, hinge, port, joycon_drift, disc_drive,
lamp, earpads, other. Use other when the listing does not plainly state the
fault, or when it states more than one unrelated fault.

Return only one valid JSON object with these keys:
itemName, comparisonSearchQuery, likelyIssue, faultType, repairDifficulty,
repairRisk, repairSuccessProbability, partsCostLow, partsCostHigh, laborHours,
redFlags, reject, rejectReason, explanation. Do not use Markdown.
          `.trim(),
        },
        {
          role: "user",
          content:
            "Analyze this listing:\n" +
            JSON.stringify(listingData).slice(0, 7000),
        },
      ],
      temperature: 0.1,
      max_tokens: 650,
    }
  );

  await recordAiUsage(env, "screening_calls");

  let analysis;
  try {
    analysis = applyDeterministicRepairRules(
      normalizeRepairAnalysis(validateRepairAnalysis(parseAiResponse(aiResult))),
      listing,
      savedDetails
    );
  } catch (error) {
    await env.DB.prepare(`
      UPDATE listings
      SET analysis_status = 'needs_review',
          reasoning = ?
      WHERE id = ?
    `).bind(JSON.stringify({
      error: 'AI screening response could not be trusted',
      details: String(error.message || error).slice(0, 800),
    }), listing.id).run();
    throw error;
  }

  return analysis;
}

function getFlipAnalysis(listing) {
  return {
    itemName: listing.title,
    comparisonSearchQuery: String(listing.title || "")
      .trim().split(/\s+/).slice(0, 10).join(" "),
    likelyIssue: "None: listed as working (resale flip)",
    faultType: "none",
    repairDifficulty: 1,
    repairRisk: 2,
    repairSuccessProbability: 90,
    partsCostLow: 0,
    partsCostHigh: 0,
    laborHours: 0,
    redFlags: [],
    reject: false,
    rejectReason: "",
    explanation: "Listed as used and working; resell without repair.",
  };
}

function parseAiResponse(result) {
  let value = result?.response ?? result;

  if (value?.choices?.[0]?.message?.content !== undefined) {
    value = value.choices[0].message.content;
  }

  if (typeof value === "object" && value !== null) {
    return value;
  }

  if (typeof value !== "string") {
    throw new Error("AI returned an unsupported response");
  }

  value = value
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  const objectStart = value.indexOf("{");
  const objectEnd = value.lastIndexOf("}");

  if (objectStart >= 0 && objectEnd > objectStart) {
    value = value.slice(objectStart, objectEnd + 1);
  }

  return JSON.parse(value);
}

function validateRepairAnalysis(value) {
  const validNumber = (key) =>
    value?.[key] !== null && value?.[key] !== undefined &&
    value?.[key] !== '' && Number.isFinite(Number(value[key]));
  const validText = (key) =>
    typeof value?.[key] === 'string' && value[key].trim().length > 0;
  const valid = value && typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.reject === 'boolean' &&
    (value.reject === true
      ? validText('rejectReason')
      : validText('comparisonSearchQuery') && validText('likelyIssue') &&
        Number.isFinite(parseRepairScore(value.repairDifficulty)) &&
        Number.isFinite(parseRepairScore(value.repairRisk)) &&
        validNumber('repairSuccessProbability') &&
        validNumber('partsCostHigh') &&
        parseRepairScore(value.repairDifficulty) >= 1 &&
        parseRepairScore(value.repairDifficulty) <= 10 &&
        parseRepairScore(value.repairRisk) >= 1 &&
        parseRepairScore(value.repairRisk) <= 10 &&
        Number(value.repairSuccessProbability) >= 0 &&
        Number(value.repairSuccessProbability) <= 100 &&
        Number(value.partsCostHigh) >= 0);

  if (!valid) {
    const shape = value && typeof value === 'object'
      ? Object.keys(value).slice(0, 18).join(',')
      : typeof value;
    const preview = JSON.stringify(value).slice(0, 350);
    throw new Error(
      `Invalid AI screening response; keys: ${shape}; sample: ${preview}`
    );
  }
  return value;
}

function parseRepairScore(value) {
  const labels = {
    easy: 2,
    low: 2,
    simple: 2,
    moderate: 5,
    medium: 5,
    difficult: 8,
    hard: 8,
    high: 8,
    severe: 10,
  };
  const label = String(value ?? '').trim().toLowerCase();
  if (Object.hasOwn(labels, label)) return labels[label];
  if (!label) return NaN;
  const riskWarning = /\b(liquid|water damage|corrosion|locked|board failure|high risk|severe)\b/.test(label);
  const leadingLabel = label.match(/^(easy|low|simple|moderate|medium|difficult|hard|high|severe)\b/);
  if (leadingLabel) {
    return riskWarning ? Math.max(8, labels[leadingLabel[1]]) : labels[leadingLabel[1]];
  }
  const leadingNumber = label.match(/^(\d+(?:\.\d+)?)\s*(?:%|\b|\s*-)/);
  if (!leadingNumber) return NaN;
  const numeric = Number(leadingNumber[1]);
  if (!Number.isFinite(numeric) || numeric < 1) return NaN;
  const score = numeric <= 10 ? numeric :
    numeric <= 100 ? Math.ceil(numeric / 10) : NaN;
  if (riskWarning) return Math.max(8, score);
  return score;
}

function normalizeRepairAnalysis(value) {
  const analysis = value && typeof value === "object" ? value : {};

  return {
    itemName: String(analysis.itemName || "Unknown item"),
    comparisonSearchQuery: String(
      analysis.comparisonSearchQuery || analysis.itemName || ""
    )
      .trim()
      .split(/\s+/)
      .slice(0, 10)
      .join(" "),
    likelyIssue: String(analysis.likelyIssue || "Unknown fault"),
    faultType: Object.hasOwn(REPAIR_PARTS, String(analysis.faultType || "").trim().toLowerCase())
      ? String(analysis.faultType).trim().toLowerCase()
      : "other",
    repairDifficulty: Math.round(
      clamp(parseRepairScore(analysis.repairDifficulty), 1, 10)
    ),
    repairRisk: Math.round(
      clamp(parseRepairScore(analysis.repairRisk), 1, 10)
    ),
    repairSuccessProbability: Math.round(
      clamp(Number(analysis.repairSuccessProbability) || 0, 0, 100)
    ),
    partsCostLow: Math.max(Number(analysis.partsCostLow) || 0, 0),
    partsCostHigh: Math.max(Number(analysis.partsCostHigh) || 0, 0),
    laborHours: Math.max(Number(analysis.laborHours) || 0, 0),
    redFlags: Array.isArray(analysis.redFlags)
      ? analysis.redFlags.map(String).slice(0, 10)
      : [],
    reject: analysis.reject === true,
    rejectReason: String(analysis.rejectReason || ""),
    explanation: String(analysis.explanation || ""),
  };
}

function isLaptopCategory(category) {
  return category === "Business Laptops" || category === "Laptops";
}

function normalizeModelText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getVerifiedLaptopModel(listing, savedDetails) {
  if (!isLaptopCategory(listing.category)) return null;
  const aspects = savedDetails.itemSpecifics || {};
  const sellerModel = Object.entries(aspects).find(([key]) => key.toLowerCase() === "model")?.[1];
  const family = /\b(?:latitude|inspiron|precision|vostro|xps|alienware|thinkpad|ideapad|yoga|elitebook|probook|zbook|envy|spectre|pavilion|macbook|aspire|swift|nitro|zenbook|vivobook|surface)\b/i;
  for (const source of [listing.title, sellerModel]) {
    const text = String(source || "");
    const match = family.exec(text);
    if (!match) continue;
    const context = text.slice(match.index + match[0].length, match.index + match[0].length + 32);
    const tokens = context.match(/\b(?:[a-z]{1,4}\d{2,5}[a-z0-9-]*|\d{3,5}[a-z0-9-]*)\b/gi) || [];
    const valid = tokens.filter((token) =>
      !/^20\d{2}$/.test(token) &&
      !/^x360$/i.test(token) &&
      !/^(?:i[3579]|m[1357]|ryzen\d?|xeon)\d*[a-z0-9-]*$/i.test(token) &&
      !/^\d+(?:gb|tb|mhz|ghz|wh)$/i.test(token) &&
      !/^win\d+$/i.test(token)
    );
    if (valid.length) return normalizeModelText(valid[0]);
  }
  return null;
}

async function invalidateUnderpricedProjectorLeads(env) {
  // Earlier AI estimates priced a genuine PowerLite 118 lamp below Epson's
  // $76 retail price. Remove those stale leads before sending more alerts.
  await env.DB.prepare(`
    UPDATE listings
    SET status = 'rejected', analysis_status = 'needs_review',
        recommendation = 'PASS', estimated_parts_cost = 76,
        estimated_profit = NULL, roi_percent = NULL,
        suggested_offer = 0, deal_score = 0,
        reasoning = '{"rejectReason":"Lamp price was underestimated; repair diagnosis unconfirmed. Re-evaluate before buying."}'
    WHERE category = 'Projectors'
      AND LOWER(title) LIKE '%powerlite 118%'
      AND LOWER(COALESCE(likely_issue, '')) LIKE '%lamp%'
      AND COALESCE(estimated_parts_cost, 0) < 76
      AND recommendation IN ('BUY', 'WATCH')
  `).run();
}

function applyDeterministicRepairRules(
  analysis,
  listing,
  savedDetails
) {
  const evidence = [
    listing.title,
    listing.condition,
    savedDetails.shortDescription,
    savedDetails.conditionDescription,
    savedDetails.fullDescription,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const bootsToBios = /\bboot(?:s|ed|ing)?\s+to\s+bios\b/.test(
    evidence
  );
  const missingStorage =
    /\b(?:no|missing|without)\s+(?:ssd|hdd|hard drive|storage)\b/.test(
      evidence
    );
  const additionalMissingParts =
    /\b(?:no|missing|without)\s+(?:ram|memory|battery|charger|adapter)\b/.test(
      evidence
    );
  const seriousDamage =
    /\b(?:liquid damage|water damage|corrosion|activation locked|icloud locked|mdm locked|no power|motherboard|logic board|broken screen|damaged screen|broken hinge)\b/.test(
      evidence
    );
  const untested = /\b(?:untested|not tested|unable to test|as[- ]is)\b/.test(evidence);
  const missingPower = /\b(?:no charger|charger not included|no charging cord|no power cord|no (?:ac |power )?adapter|adapter not included)\b/.test(evidence);
  const demonstratedPower = /\b(?:boots? to bios|tested working|powers? on|turns? on)\b/.test(evidence);

  const likelyIssue = String(analysis.likelyIssue || "").toLowerCase();
  const simpleReplaceableIssue =
    /\b(?:battery|ram|memory|ssd|hdd|hard drive|storage|charger|adapter|fan|lamp)\b/.test(
      likelyIssue
    );

  if (
    bootsToBios &&
    missingStorage &&
    !additionalMissingParts &&
    !seriousDamage && (!untested || demonstratedPower)
  ) {
    analysis.likelyIssue = "Missing SSD; system reaches BIOS";
    analysis.faultType = "missing_storage";
    analysis.repairDifficulty = Math.min(
      Number(analysis.repairDifficulty) || 3,
      3
    );
    analysis.repairRisk = Math.min(
      Number(analysis.repairRisk) || 3,
      3
    );
    analysis.repairSuccessProbability = Math.max(
      Number(analysis.repairSuccessProbability) || 0,
      80
    );
    analysis.partsCostLow = Math.min(
      Number(analysis.partsCostLow) || 35,
      35
    );
    analysis.partsCostHigh = Math.min(
      Number(analysis.partsCostHigh) || 60,
      60
    );
  }

  // Keep the model's risk score internally consistent. A straightforward,
  // replaceable-part repair cannot reasonably be both high probability and
  // maximum risk unless the listing contains separate serious-damage evidence.
  if (simpleReplaceableIssue && !seriousDamage && (!untested || demonstratedPower)) {
    const successProbability = Number(
      analysis.repairSuccessProbability
    ) || 0;

    if (successProbability >= 75) {
      analysis.repairRisk = Math.min(
        Number(analysis.repairRisk) || 4,
        4
      );
    } else if (successProbability >= 60) {
      analysis.repairRisk = Math.min(
        Number(analysis.repairRisk) || 6,
        6
      );
    }
  }

  if (untested && !demonstratedPower) {
    analysis.repairRisk = Math.max(Number(analysis.repairRisk) || 0, missingPower ? 8 : 7);
    analysis.repairSuccessProbability = Math.min(Number(analysis.repairSuccessProbability) || 0, missingPower ? 40 : 55);
    if (/\bbattery\b/i.test(analysis.likelyIssue || "")) {
      analysis.likelyIssue = "Untested device; battery failure not confirmed";
    }
    analysis.redFlags = [...new Set([...(analysis.redFlags || []), "Untested; no proof of power", ...(missingPower ? ["Power adapter missing"] : [])])];
  }

  if (listing.category === "Projectors") {
    const noLight = /\b(?:did not produce any light|no light|no light output|lamp (?:does not|doesn't|won't) (?:light|turn on))\b/.test(evidence);
    const powerLite118 = /\bpowerlite[\s-]*118\b/.test(evidence);
    const suspectedLamp = /\b(?:lamp|bulb)\b/.test(evidence + " " + likelyIssue);

    if (powerLite118 && suspectedLamp) {
      // Verified against Epson's ELPLP97 price on 2026-10-01.
      analysis.partsCostHigh = Math.max(Number(analysis.partsCostHigh) || 0, 76);
    }

    if (noLight) {
      // Powering on does not prove the lamp is the only failed component.
      analysis.repairRisk = Math.max(Number(analysis.repairRisk) || 0, 7);
      analysis.repairSuccessProbability = Math.min(Number(analysis.repairSuccessProbability) || 0, 55);
      analysis.redFlags = [...new Set([...(analysis.redFlags || []), "No light output; cause unconfirmed"])];
    }
  }

  return analysis;
}

async function findWorkingComparables(
  env,
  searchQuery,
  category = "",
  requiredModel = null
) {
  const accessToken = await getEbayToken(env);
  const categoryProfile = getCategoryProfile(category);

  const originalWords = String(searchQuery || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const searchQueries = [
    buildComparableSearchQuery(originalWords, category),
  ];

  const itemSummaries = [];
  const seenItemIds = new Set();

  for (const query of searchQueries) {
    const searchUrl = new URL(
      "https://api.ebay.com/buy/browse/v1/item_summary/search"
    );

    searchUrl.searchParams.set("q", query);
    searchUrl.searchParams.set("limit", "100");
    searchUrl.searchParams.set("sort", "price");

    if (categoryProfile?.ebayCategoryId) {
      searchUrl.searchParams.set(
        "category_ids",
        categoryProfile.ebayCategoryId
      );
    }

    searchUrl.searchParams.set(
      "filter",
      "conditions:{USED},itemLocationCountry:US"
    );

    const response = await fetch(searchUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Comparable search failed ${response.status}: ${await response.text()}`
      );
    }

    const data = await response.json();

    for (const item of data.itemSummaries || []) {
      const itemId = item.itemId || item.itemWebUrl || item.title;

      if (!seenItemIds.has(itemId)) {
        seenItemIds.add(itemId);
        itemSummaries.push(item);
      }
    }
  }

  const minimumComparablePrices = {
    laptops: 35,
    "business laptops": 80,
    "mini pcs": 70,
    "game consoles": 60,
    projectors: 20,
    "premium audio": 55,
    "label printers": 65,
    speakers: 15,
    "graphics cards": 20,
  };

  const minimumComparablePrice =
    categoryProfile?.minimumComparablePrice ||
    minimumComparablePrices[String(category).toLowerCase()] ||
    15;

  const normalize = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

  // Validate against the original configuration, even though the eBay
  // search itself uses fewer words to retrieve enough whole devices.
  const matchingQuery = originalWords.join(" ");

  const queryWords = matchingQuery
    .toLowerCase()
    .split(/\s+/)
    .map(normalize)
    .filter(Boolean);

  // Model numbers such as 15m-eu0013dx, 7510, SCPH-30001, etc.
  const modelTokens = queryWords
    .filter(
      (word) =>
        word.length >= 3 &&
        /\d/.test(word) &&
        !/^20\d{2}$/.test(word) &&
        !/^\d+(?:gb|tb|inch|in)$/.test(word) &&
        !/^(?:i[3579]|m[1357]|ryzen\d?|xeon)\d*[a-z0-9]*$/.test(word)
    )
    .sort((a, b) => {
      const aMixed = /[a-z]/.test(a) && /\d/.test(a) ? 1 : 0;
      const bMixed = /[a-z]/.test(b) && /\d/.test(b) ? 1 : 0;

      return bMixed - aMixed || b.length - a.length;
    });

  const strongestModelToken = modelTokens[0] || null;
  const configurationTokens = queryWords.filter(
    (word) =>
      word !== strongestModelToken &&
      ((String(category).toLowerCase() !== 'game consoles' && /^20\d{2}$/.test(word)) ||
        /^\d+(?:gb|tb)$/.test(word) ||
        /^(?:i[3579]|m[1357]|ryzen\d?|xeon)\d*[a-z0-9]*$/.test(word))
  );

  const ignoredWords = new Set([
    "the",
    "and",
    "with",
    "used",
    "working",
    "laptop",
    "computer",
    "console",
    "speaker",
    "projector",
    "printer",
    "label",
    "mini",
    "graphics",
    "card",
  ]);

  const productTokens = queryWords.filter(
    (word) =>
      word.length >= 3 &&
      !ignoredWords.has(word) &&
      !/^(?:parts|repair|broken|notworking|ntscuc)$/.test(word)
  );

  const excludedTitlePattern =
    /\b(for parts|parts only|not working|broken|repair|untested|as[- ]is|no power|does not power|doesn't power|read description|read desc|salvage|defective|damaged|lot of|bulk lot)\b/i;

  const incompletePattern =
    /\b(no ram|no memory|no ssd|no hard drive|no hdd|no battery|no charger|no adapter|missing ram|missing memory|missing ssd|missing hard drive|missing battery|missing charger)\b/i;

  const accessoryPattern =
    /\b(charger|power adapter|ac adapter|battery only|screen only|lcd screen|display assembly|digitizer|keyboard|palmrest|touchpad|trackpad|motherboard|mainboard|logic board|hinge|bezel|base cover|bottom cover|top cover|housing|shell|case|sleeve|skin|cable|heatsink|cooling fan|replacement part|manual|dock|docking station|empty box|box only|webcam|wifi card|wireless card|optical drive|dvd drive|dc jack|power jack|usb board|daughterboard|rubber foot|rubber feet|screw set|screws|keycap|key cap|drive caddy|hdd caddy|ssd caddy|bracket|antenna|speaker set|internal speakers|hard drive hdd|hdd hard drive|memory ram|ram memory|ram ddr|replacement lcd)\b/i;

  const componentForDevicePattern =
    /\b(?:memory|ram|hdd|ssd|hard drive|lcd|screen|display|battery|keyboard|charger|adapter)\b.{0,70}\b(?:for|compatible with)\b/i;

  const categoryPatterns = {
    laptops: /\b(laptop|notebook|2-in-1|ultrabook|chromebook|pc)\b/i,
    "business laptops":
      /\b(laptop|notebook|2-in-1|ultrabook|thinkpad|latitude|elitebook|probook|macbook|ideapad|vivobook|zenbook)\b/i,
    "mini pcs":
      /\b(mini\s*pc|mini computer|nuc|optiplex micro|prodesk mini|elitedesk mini|thinkcentre tiny)\b/i,
    "game consoles": /\b(console|system|playstation|xbox|nintendo|switch|game boy|psp|genesis)\b/i,
    projectors: /\b(projector)\b/i,
    speakers: /\b(speaker|soundbar|boombox)\b/i,
    "premium audio":
      /\b(speaker|soundbar|boombox|sonos|soundlink|charge|flip|xtreme)\b/i,
    "label printers":
      /\b(label printer|thermal printer|label maker|labelwriter|zebra|rollo)\b/i,
    "graphics cards": /\b(graphics card|video card|gpu|geforce|radeon)\b/i,
  };

  const requiredCategoryPattern =
    categoryPatterns[String(category).toLowerCase()] ||
    categoryProfile?.requiredTitle || null;

  const comparableItems = itemSummaries
    .filter((item) => {
      const title = String(item.title || "");
      const normalizedTitle = normalize(title);
      if (requiredModel && !normalizedTitle.includes(requiredModel)) return false;
      const condition = String(item.condition || "").toLowerCase();
      const buyingOptions = item.buyingOptions || [];

      const isWorkingCondition =
        !condition.includes("parts") &&
        !condition.includes("not working");

      const isFixedPrice =
        buyingOptions.includes("FIXED_PRICE") ||
        buyingOptions.includes("BEST_OFFER");

      const hasBadTitle =
        excludedTitlePattern.test(title) ||
        incompletePattern.test(title) ||
        accessoryPattern.test(title) ||
        componentForDevicePattern.test(title);

      if (
        !isWorkingCondition ||
        !isFixedPrice ||
        hasBadTitle
      ) {
        return false;
      }

      if (
        requiredCategoryPattern &&
        !requiredCategoryPattern.test(title) &&
        !(
          strongestModelToken &&
          normalizedTitle.includes(strongestModelToken)
        )
      ) {
        return false;
      }

      // Require the strongest exact model number when available.
      if (
        strongestModelToken &&
        !normalizedTitle.includes(strongestModelToken)
      ) {
        return false;
      }

      if (configurationTokens.length > 0) {
        const configurationMatches = configurationTokens.filter(
          (token) => normalizedTitle.includes(token)
        );
        const requiredConfigurationMatches = Math.min(
          2,
          configurationTokens.length
        );

        if (
          configurationMatches.length < requiredConfigurationMatches
        ) {
          return false;
        }
      }

      // Apple M1/M2 models can share a chassis and year with Intel models.
      // Keep the chip generation as a required match when specified.
      const appleChip = queryWords.find((word) => /^m[1-4]$/.test(word));
      if (appleChip && !normalizedTitle.includes(appleChip)) return false;

      // If there is no usable model number, require at least
      // two meaningful product-name matches.
      if (!strongestModelToken && productTokens.length) {
        const matchingTokens = productTokens.filter((token) =>
          normalizedTitle.includes(token)
        );

        const requiredMatches = Math.min(
          2,
          productTokens.length
        );

        if (matchingTokens.length < requiredMatches) {
          return false;
        }
      }

      return true;
    })
    .map((item) => {
      const price = Number(item.price?.value || 0);

      const shippingValues = (item.shippingOptions || [])
        .map((option) =>
          Number(option.shippingCost?.value || 0)
        )
        .filter(Number.isFinite);

      const shipping = shippingValues.length
        ? Math.min(...shippingValues)
        : 0;

      return {
        itemId: item.itemId || null,
        title: item.title,
        price: roundMoney(price),
        shipping: roundMoney(shipping),
        total: roundMoney(price + shipping),
        link: item.itemWebUrl || "",
      };
    })
    .filter(
      (item) =>
        Number.isFinite(item.total) &&
        item.total >= minimumComparablePrice
    )
    .sort((a, b) => a.total - b.total);

  // Remove extreme low and high prices after filtering.
  let cleanedItems = comparableItems;

  if (comparableItems.length >= 5) {
    const middleIndex = Math.floor(
      comparableItems.length / 2
    );

    const median = comparableItems[middleIndex].total;

    cleanedItems = comparableItems.filter(
      (item) =>
        item.total >= median * 0.5 &&
        item.total <= median * 1.75
    );
  }

  const prices = cleanedItems.map((item) => item.total);

  if (prices.length < 3) {
    return {
      count: prices.length,
      prices,
      comparables: cleanedItems.slice(0, 10),
      searchQueriesTried: searchQueries,
      conservativeResale: 0,
      lowConfidence: true,
      priceSpread: 0,
    };
  }

  const lowerQuartileIndex = Math.floor(
    (prices.length - 1) * 0.25
  );

  const upperQuartileIndex = Math.floor(
    (prices.length - 1) * 0.75
  );

  const lowerQuartile = prices[lowerQuartileIndex];
  const upperQuartile = prices[upperQuartileIndex];
  const priceSpread =
    lowerQuartile > 0
      ? roundMoney(upperQuartile / lowerQuartile)
      : 99;
  const lowConfidence = priceSpread > 1.65;

  return {
    count: prices.length,
    prices,
    comparables: cleanedItems.slice(0, 10),
    searchQueriesTried: searchQueries,
    lowConfidence,
    priceSpread,
    conservativeResale: lowConfidence
      ? 0
      : roundMoney(lowerQuartile * 0.9),
    salesSample: pickSpread(cleanedItems, SOLD_EVIDENCE_LISTINGS_PER_MODEL),
  };
}

function pickSpread(items, count) {
  if (items.length <= count) return items.slice();
  return Array.from({ length: count }, (_, index) =>
    items[Math.floor((index * (items.length - 1)) / (count - 1))]);
}

// Multi-quantity fixed-price listings report how many units sold at their
// price, which is real sales evidence available through the Browse API.
// Results are cached per comparison query so each model costs only a few
// item lookups every two weeks.
async function getSoldEvidence(env, category, comps) {
  const query = String(comps.searchQueriesTried?.[0] || "").toLowerCase();
  const sample = (comps.salesSample || []).filter((item) => item.itemId);
  if (!query || !sample.length) return null;
  const evidenceKey = `${category}|${query}`;

  const cached = await env.DB.prepare(`
    SELECT sold_price, sales_count, listing_count, checked_at
    FROM sold_evidence
    WHERE evidence_key = ?
      AND checked_at >= datetime('now',
        CASE WHEN sold_price IS NULL THEN '-7 days' ELSE '-14 days' END)
  `).bind(evidenceKey).first();
  if (cached) return soldEvidenceReference(query, cached);

  const usage = await env.DB.prepare(`
    SELECT sold_lookups FROM ebay_usage WHERE usage_day = date('now')
  `).first();
  if (Number(usage?.sold_lookups || 0) + sample.length > SOLD_EVIDENCE_DAILY_LOOKUPS) {
    return null;
  }

  await env.DB.prepare(`
    INSERT INTO ebay_usage (usage_day, sold_lookups) VALUES (date('now'), ?)
    ON CONFLICT(usage_day) DO UPDATE SET sold_lookups = sold_lookups + excluded.sold_lookups
  `).bind(sample.length).run();

  const accessToken = await getEbayToken(env);
  const sales = (await Promise.all(sample.map(async (item) => {
    const response = await fetch(
      "https://api.ebay.com/buy/browse/v1/item/" + encodeURIComponent(item.itemId),
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
          "X-EBAY-C-ENDUSERCTX": ebayBuyerContext(env),
        },
      }
    );
    if (!response.ok) return null;
    const details = await response.json();
    const sold = Math.max(0, ...(details.estimatedAvailabilities || [])
      .map((availability) => Number(availability.estimatedSoldQuantity) || 0));
    // Cap each listing's weight so one large refurbisher cannot set the price.
    return sold > 0 ? { total: item.total, sold: Math.min(sold, 20) } : null;
  }))).filter(Boolean).sort((a, b) => a.total - b.total);

  const salesCount = sales.reduce((sum, sale) => sum + sale.sold, 0);
  let soldPrice = null;
  if (salesCount >= SOLD_EVIDENCE_MIN_SALES && sales.length >= SOLD_EVIDENCE_MIN_LISTINGS) {
    // Sales-weighted lower quartile of the prices units actually sold at.
    let cumulative = 0;
    const lowerQuartile = sales.find((sale) =>
      (cumulative += sale.sold) >= salesCount * 0.25).total;
    soldPrice = roundMoney(lowerQuartile * SOLD_EVIDENCE_RATE);
  }

  await env.DB.prepare(`
    INSERT INTO sold_evidence (evidence_key, category, query, sold_price,
      sales_count, listing_count, checked_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(evidence_key) DO UPDATE SET
      sold_price = excluded.sold_price, sales_count = excluded.sales_count,
      listing_count = excluded.listing_count, checked_at = excluded.checked_at
  `).bind(evidenceKey, category, query, soldPrice, salesCount, sales.length).run();

  return soldEvidenceReference(query, {
    sold_price: soldPrice, sales_count: salesCount, listing_count: sales.length,
    checked_at: new Date().toISOString().slice(0, 10),
  });
}

function soldEvidenceReference(query, row) {
  if (row.sold_price === null || row.sold_price === undefined) return null;
  return {
    model: query,
    resale: Number(row.sold_price),
    sales: Number(row.sales_count),
    listings: Number(row.listing_count),
    checked: String(row.checked_at).slice(0, 10),
    source: "eBay sold quantities on comparable listings",
  };
}

function buildComparableSearchQuery(words, category) {
  const clean = words.filter((word) =>
    !/^(?:parts?|repair|broken|working|used|notebook|black|white|silver|gold|ntsc[-/]?[a-z/]*|\d+(?:-inch|inch|in))$/i.test(word)
  );
  const isGameConsole = String(category).toLowerCase() === 'game consoles';
  const modelIndex = clean.findIndex((word, index) =>
    index >= 1 &&
    ((/[a-z]/i.test(word) && /\d/.test(word) &&
      !/^(?:i[3579]|m[1357]|ryzen\d?|xeon)\d*/i.test(word) &&
      !/^\d+(?:gb|tb)/i.test(word)) ||
      (!isGameConsole && index >= 2 && /^\d{4,5}$/.test(word) &&
        !/^20\d{2}$/.test(word)))
  );
  const width = modelIndex >= 0
    ? Math.min(modelIndex + 1, 6)
    : isGameConsole ? 4 : 5;
  return clean.slice(0, width).join(' ') || words.slice(0, 4).join(' ');
}

function getOutboundShippingEstimate(category) {
  const profile = getCategoryProfile(category);

  if (profile) {
    return profile.outboundShipping;
  }

  const estimates = {
    Laptops: 18,
    "Game Consoles": 20,
    Projectors: 24,
    Speakers: 22,
    "Graphics Cards": 10,
  };

  return estimates[category] || 20;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}
