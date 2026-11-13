import { test } from "node:test";
import assert from "node:assert/strict";
import { matchModelResale } from "../src/index.js";

const model = (title, category) => matchModelResale(title, category)?.model ?? null;

test("sold references match the right model from real listing titles", () => {
  const cases = [
    ["Sony WH-1000XM4 Wireless Noise Canceling Over-Ear Headphones Black", "Headphones", "Sony WH-1000XM4"],
    ["SONY WH1000XM5 Wireless Headphones Silver", "Headphones", "Sony WH-1000XM5"],
    ["Sony WH-1000XM3 Wireless Noise Cancelling Headphones", "Headphones", "Sony WH-1000XM3"],
    ["Apple AirPods Max Over-Ear Wireless Headphones Space Gray", "Headphones", "Apple AirPods Max"],
    ["Bose QuietComfort Ultra Headphones Black", "Headphones", "Bose QuietComfort Ultra headphones"],
    ["Bose QC45 Wireless Noise Cancelling Headphones", "Headphones", "Bose QuietComfort 45"],
    ["Bose QuietComfort 35 II Wireless Headphones", "Headphones", "Bose QuietComfort 35"],
    ["Beats by Dr. Dre Studio3 Wireless Over-Ear Headphones", "Headphones", "Beats Studio3"],
    ["Beats Solo3 Wireless On-Ear Headphones Rose Gold", "Headphones", "Beats Solo3"],
    ["Bose SoundLink Flex Bluetooth Speaker Blue", "Premium Audio", "Bose SoundLink Flex"],
    ["Bose SoundLink Mini II Bluetooth Speaker", "Premium Audio", "Bose SoundLink Mini"],
    ["Bose SoundLink Color II Portable Speaker", "Premium Audio", "Bose SoundLink Color"],
    ["JBL Charge 5 Portable Waterproof Speaker", "Premium Audio", "JBL Charge 5"],
    ["Sony PlayStation 3 Slim 160GB Console CECH-3001A", "Game Consoles", "PlayStation 3"],
    ["Microsoft Xbox 360 S Console 250GB", "Game Consoles", "Xbox 360"],
    ["Nintendo Wii Console RVL-001 White", "Game Consoles", "Nintendo Wii"],
    ["Dell Latitude 5420 14\" i5-1145G7 16GB 256GB", "Business Laptops", "Dell Latitude 5420"],
    ["Dell Latitude 5400 i5-8365U 8GB", "Business Laptops", "Dell Latitude 5400"],
    ["HP EliteBook 850 G5 i5-8350U 8GB NO HDD", "Business Laptops", "HP EliteBook 850 G5"],
    ["HP EliteBook 840 G5 14\" i7-8650U", "Business Laptops", "HP EliteBook 840 G5"],
  ];
  for (const [title, category, expected] of cases) {
    assert.equal(model(title, category), expected, title);
  }
});

test("look-alike products are not priced as the referenced model", () => {
  const cases = [
    ["Sony WF-1000XM4 Truly Wireless Earbuds", "Headphones"], // earbuds, not WH
    ["Bose QuietComfort Ultra Earbuds Black", "Headphones"],
    ["Beats Studio Buds Wireless Earbuds", "Headphones"],
    ["Beats Solo Pro Wireless Headphones", "Headphones"],
    ["Nintendo Wii U Deluxe Console 32GB", "Game Consoles"],
    ["Dell Latitude 5420 Rugged Extreme", "Business Laptops"],
    ["HP EliteBook 850 G6 i5 16GB", "Business Laptops"],
    ["Bose SoundLink Revolve+ II", "Premium Audio"],
    // The category must match too.
    ["Sony WH-1000XM4 Wireless Headphones", "Premium Audio"],
  ];
  for (const [title, category] of cases) {
    assert.equal(model(title, category), null, title);
  }
});

test("new references carry their source and date", () => {
  const entry = matchModelResale("Sony WH-1000XM4 Headphones", "Headphones");
  assert.equal(entry.resale, 105);
  assert.equal(entry.checked, "2026-11-13");
  assert.match(entry.source, /eBay sold listings/);
  // Older references are unchanged.
  assert.equal(matchModelResale("Nintendo Switch Lite Gray", "Game Consoles").resale, 95);
});
