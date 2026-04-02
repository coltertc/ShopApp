"""
One-time copy of shop.db into Supabase Postgres.
Requires: pip install 'psycopg[binary]'

Prefer the Supabase *direct* connection string (host db.<ref>.supabase.co, port 5432)
for this script — bulk COPY-style inserts are more reliable than the transaction pooler (:6543).

Usage (PowerShell):
  $env:DATABASE_URL = "postgresql://postgres:YOUR_PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres"
  python scripts/migrate_sqlite_to_supabase.py C:\\path\\to\\shop.db

Run supabase/migrations/20260402120000_shop_schema.sql in the Supabase SQL editor first.
"""
from __future__ import annotations

import os
import sqlite3
import sys

try:
    import psycopg
except ImportError:
    print("Install: pip install 'psycopg[binary]'", file=sys.stderr)
    raise SystemExit(1)


def main() -> int:
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("Set DATABASE_URL to your Supabase connection string.", file=sys.stderr)
        return 1
    sqlite_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(os.path.dirname(__file__)), "..", "shop.db"
    )
    if not os.path.isfile(sqlite_path):
        print(f"SQLite file not found: {sqlite_path}", file=sys.stderr)
        return 1

    src = sqlite3.connect(sqlite_path)
    src.row_factory = sqlite3.Row

    with psycopg.connect(db_url) as pg:
        with pg.cursor() as cur:
            cur.execute(
                """
                TRUNCATE TABLE
                  order_predictions,
                  product_reviews,
                  shipments,
                  order_items,
                  orders,
                  products,
                  customers
                RESTART IDENTITY CASCADE;
                """
            )
        pg.commit()

        def copy_table(table: str, columns: list[str]) -> None:
            rows = src.execute(f"SELECT {', '.join(columns)} FROM {table}").fetchall()
            if not rows:
                print(f"  {table}: 0 rows")
                return
            placeholders = ", ".join(["%s"] * len(columns))
            cols = ", ".join(columns)
            with pg.cursor() as cur:
                cur.executemany(
                    f"INSERT INTO {table} ({cols}) VALUES ({placeholders})",
                    [tuple(r[c] for c in columns) for r in rows],
                )
            pg.commit()
            print(f"  {table}: {len(rows)} rows")

        print("Importing…")
        copy_table(
            "customers",
            [
                "customer_id",
                "full_name",
                "email",
                "gender",
                "birthdate",
                "created_at",
                "city",
                "state",
                "zip_code",
                "customer_segment",
                "loyalty_tier",
                "is_active",
            ],
        )
        copy_table(
            "products",
            ["product_id", "sku", "product_name", "category", "price", "cost", "is_active"],
        )
        copy_table(
            "orders",
            [
                "order_id",
                "customer_id",
                "order_datetime",
                "billing_zip",
                "shipping_zip",
                "shipping_state",
                "payment_method",
                "device_type",
                "ip_country",
                "promo_used",
                "promo_code",
                "order_subtotal",
                "shipping_fee",
                "tax_amount",
                "order_total",
                "risk_score",
                "is_fraud",
            ],
        )
        copy_table(
            "order_items",
            ["order_item_id", "order_id", "product_id", "quantity", "unit_price", "line_total"],
        )
        copy_table(
            "shipments",
            [
                "shipment_id",
                "order_id",
                "ship_datetime",
                "carrier",
                "shipping_method",
                "distance_band",
                "promised_days",
                "actual_days",
                "late_delivery",
            ],
        )
        copy_table(
            "product_reviews",
            [
                "review_id",
                "customer_id",
                "product_id",
                "rating",
                "review_datetime",
                "review_text",
            ],
        )

        seq_sql = [
            ("customers", "customer_id"),
            ("products", "product_id"),
            ("orders", "order_id"),
            ("order_items", "order_item_id"),
            ("shipments", "shipment_id"),
            ("product_reviews", "review_id"),
        ]
        with pg.cursor() as cur:
            for table, col in seq_sql:
                cur.execute(
                    f"SELECT setval(pg_get_serial_sequence('{table}', '{col}'), "
                    f"COALESCE((SELECT MAX({col}) FROM {table}), 1));"
                )
        pg.commit()

    src.close()
    print("Done. order_predictions is empty until you run scoring.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
