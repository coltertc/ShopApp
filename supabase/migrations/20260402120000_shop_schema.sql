-- IS455 shop operational schema (PostgreSQL / Supabase)
-- Run via Supabase SQL editor or `supabase db push` if using Supabase CLI.

CREATE TABLE IF NOT EXISTS customers (
  customer_id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  gender TEXT NOT NULL,
  birthdate TEXT NOT NULL,
  created_at TEXT NOT NULL,
  city TEXT,
  state TEXT,
  zip_code TEXT,
  customer_segment TEXT,
  loyalty_tier TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS products (
  product_id SERIAL PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  product_name TEXT NOT NULL,
  category TEXT NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  cost DOUBLE PRECISION NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS orders (
  order_id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers (customer_id),
  order_datetime TEXT NOT NULL,
  billing_zip TEXT,
  shipping_zip TEXT,
  shipping_state TEXT,
  payment_method TEXT NOT NULL,
  device_type TEXT NOT NULL,
  ip_country TEXT NOT NULL,
  promo_used INTEGER NOT NULL DEFAULT 0,
  promo_code TEXT,
  order_subtotal DOUBLE PRECISION NOT NULL,
  shipping_fee DOUBLE PRECISION NOT NULL,
  tax_amount DOUBLE PRECISION NOT NULL,
  order_total DOUBLE PRECISION NOT NULL,
  risk_score DOUBLE PRECISION NOT NULL,
  is_fraud INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS order_items (
  order_item_id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders (order_id),
  product_id INTEGER NOT NULL REFERENCES products (product_id),
  quantity INTEGER NOT NULL,
  unit_price DOUBLE PRECISION NOT NULL,
  line_total DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS product_reviews (
  review_id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers (customer_id),
  product_id INTEGER NOT NULL REFERENCES products (product_id),
  rating INTEGER NOT NULL CHECK (
    rating BETWEEN 1 AND 5
  ),
  review_datetime TEXT NOT NULL,
  review_text TEXT,
  UNIQUE (customer_id, product_id)
);

CREATE TABLE IF NOT EXISTS shipments (
  shipment_id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders (order_id),
  ship_datetime TEXT NOT NULL,
  carrier TEXT NOT NULL,
  shipping_method TEXT NOT NULL,
  distance_band TEXT NOT NULL,
  promised_days INTEGER NOT NULL,
  actual_days INTEGER NOT NULL,
  late_delivery INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS order_predictions (
  order_id INTEGER PRIMARY KEY REFERENCES orders (order_id) ON DELETE CASCADE,
  fraud_probability DOUBLE PRECISION NOT NULL,
  predicted_fraud INTEGER NOT NULL,
  prediction_timestamp TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_order ON order_items (order_id);

CREATE INDEX IF NOT EXISTS idx_items_product ON order_items (product_id);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders (customer_id);

CREATE INDEX IF NOT EXISTS idx_orders_datetime ON orders (order_datetime);

CREATE INDEX IF NOT EXISTS idx_reviews_customer ON product_reviews (customer_id);

CREATE INDEX IF NOT EXISTS idx_reviews_product ON product_reviews (product_id);

CREATE INDEX IF NOT EXISTS idx_shipments_late ON shipments (late_delivery);
