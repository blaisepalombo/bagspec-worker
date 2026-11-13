// Checks the live eBay purchase lookup that "Connect eBay" relies on, using a
// User access token you generate yourself in the eBay Developers Program
// (Application Keys > User Tokens > production > OAuth). The token is read
// from the EBAY_USER_TOKEN environment variable and is never printed.
//
//   PowerShell:  $env:EBAY_USER_TOKEN = "<paste token>"; node scripts/check-ebay-purchases.mjs
import { fetchWonPurchases } from "../src/ebay-account.js";

const token = String(process.env.EBAY_USER_TOKEN || "").trim();
if (!token) {
  console.error("Set EBAY_USER_TOKEN to an eBay User access token first.");
  process.exit(1);
}

try {
  const purchases = await fetchWonPurchases(token);
  console.log(`eBay accepted the token. Won items in the last 60 days: ${purchases.length}`);
  for (const p of purchases) {
    console.log(`- ${String(p.purchasedAt || "").slice(0, 10)}  $${p.price.toFixed(2)} + $${p.shipping.toFixed(2)} shipping  ${p.title}  (item ${p.itemId})`);
  }
} catch (error) {
  console.error("eBay check failed:", error.message);
  process.exit(1);
}
