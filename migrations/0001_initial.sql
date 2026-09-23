CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ebay_item_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  item_url TEXT NOT NULL,
  image_url TEXT,
  condition TEXT,
  category TEXT,
  price REAL NOT NULL DEFAULT 0,
  shipping_cost REAL NOT NULL DEFAULT 0,
  estimated_tax REAL NOT NULL DEFAULT 0,
  total_buy_cost REAL NOT NULL DEFAULT 0,
  item_end_date TEXT,
  first_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'new',
  analysis_status TEXT DEFAULT 'pending',
  likely_issue TEXT,
  estimated_parts_cost REAL,
  estimated_resale_local REAL,
  estimated_resale_ebay REAL,
  estimated_profit REAL,
  roi_percent REAL,
  repair_risk INTEGER,
  deal_score INTEGER DEFAULT 0,
  suggested_offer REAL,
  recommended_channel TEXT,
  recommendation TEXT,
  reasoning TEXT,
  alerted_at TEXT
);

CREATE TABLE IF NOT EXISTS searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  query TEXT NOT NULL,
  category TEXT NOT NULL,
  max_price REAL NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS scan_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  searches_run INTEGER DEFAULT 0,
  listings_found INTEGER DEFAULT 0,
  new_listings INTEGER DEFAULT 0,
  duplicates_ignored INTEGER DEFAULT 0,
  status TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER,
  purchase_price REAL,
  parts_cost REAL DEFAULT 0,
  other_cost REAL DEFAULT 0,
  sale_price REAL,
  selling_fees REAL DEFAULT 0,
  shipping_cost REAL DEFAULT 0,
  purchased_at TEXT,
  sold_at TEXT,
  status TEXT DEFAULT 'considering',
  notes TEXT,
  FOREIGN KEY (listing_id) REFERENCES listings(id)
);

INSERT OR IGNORE INTO searches
  (id, name, query, category, max_price, enabled)
VALUES
  (1, 'Laptops', 'laptop', 'Laptops', 150, 1),
  (2, 'Game Consoles', 'game console', 'Game Consoles', 150, 1),
  (3, 'Projectors', 'projector', 'Projectors', 100, 1),
  (4, 'Speakers', 'bluetooth speaker', 'Speakers', 100, 1),
  (5, 'Graphics Cards', 'graphics card', 'Graphics Cards', 175, 1);
