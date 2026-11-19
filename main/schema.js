// Database tables. Run once when the database is created (and safely re-run on every start).

const sql = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS dorms (
  id             INTEGER PRIMARY KEY,
  no             INTEGER NOT NULL UNIQUE,
  name           TEXT NOT NULL,          -- name printed on the receipt
  statement_name TEXT NOT NULL,          -- name used on the monthly statement
  vehicle        TEXT NOT NULL DEFAULT '',
  active         INTEGER NOT NULL DEFAULT 1,
  cook_name      TEXT DEFAULT ''         -- printed as "Name:" on a "Cook's name" signature line
);

CREATE TABLE IF NOT EXISTS products (
  id     INTEGER PRIMARY KEY,
  code   TEXT NOT NULL UNIQUE,
  name   TEXT NOT NULL,
  unit   TEXT NOT NULL DEFAULT 'Kg',
  series TEXT NOT NULL CHECK (series IN ('DF','INV')),   -- DF = vegetables, INV = onions & potatoes
  price  REAL NOT NULL DEFAULT 0,                        -- current price, copied into each new week
  active INTEGER NOT NULL DEFAULT 1,
  sort   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS weeks (
  id         INTEGER PRIMARY KEY,
  date       TEXT NOT NULL UNIQUE,       -- ISO date, e.g. 2026-11-27
  created_at TEXT NOT NULL
);

-- The price of each product for one week. Old weeks keep their own prices.
CREATE TABLE IF NOT EXISTS week_prices (
  week_id    INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  price      REAL NOT NULL,
  PRIMARY KEY (week_id, product_id)
);

CREATE TABLE IF NOT EXISTS invoices (
  id           INTEGER PRIMARY KEY,
  series       TEXT NOT NULL CHECK (series IN ('DF','INV')),
  number       INTEGER NOT NULL,
  week_id      INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
  dorm_id      INTEGER NOT NULL REFERENCES dorms(id),
  vehicle      TEXT NOT NULL DEFAULT '',
  part_payment REAL NOT NULL DEFAULT 0,
  printed_at   TEXT,                     -- set when printed; printed invoices are locked
  UNIQUE (series, number),               -- an invoice number can never be used twice
  UNIQUE (week_id, dorm_id, series)
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty        REAL NOT NULL CHECK (qty > 0),
  unit_price REAL NOT NULL,
  PRIMARY KEY (invoice_id, product_id)
);

-- Vegetables can only go on DF invoices, onions & potatoes only on INV.
CREATE TRIGGER IF NOT EXISTS line_series_check
BEFORE INSERT ON invoice_lines
WHEN (SELECT series FROM products WHERE id = NEW.product_id)
  <> (SELECT series FROM invoices WHERE id = NEW.invoice_id)
BEGIN
  SELECT RAISE(ABORT, 'This item belongs on the other invoice type (DF / INV).');
END;

CREATE TABLE IF NOT EXISTS payments (
  month     TEXT PRIMARY KEY,            -- 2026-11
  paid_date TEXT,
  amount    REAL,
  reference TEXT
);

CREATE TABLE IF NOT EXISTS change_log (
  id         INTEGER PRIMARY KEY,
  at         TEXT NOT NULL,
  invoice_id INTEGER,
  action     TEXT NOT NULL,
  detail     TEXT
);
`;

// Columns added after the first version: [table, column, definition]. Added on start when missing.
const added = [
  ['dorms', 'cook_name', "TEXT DEFAULT ''"],
];

module.exports = { sql, added };
