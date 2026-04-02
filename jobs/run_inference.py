"""
Batch scoring for unshipped orders → order_predictions.

- If DATABASE_URL is set (Supabase): uses psycopg.
- Else: uses SQLite at ../shop.db (local-only legacy).

Without artifacts/fraud_model.joblib: heuristic matches src/lib/inference.ts.
"""
from __future__ import annotations

import os
import sqlite3
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARTIFACT_DIR = os.path.join(ROOT, "artifacts")
MODEL_PATH = os.path.join(ARTIFACT_DIR, "fraud_model.joblib")

CREATE_SQL_PG = """
CREATE TABLE IF NOT EXISTS order_predictions (
  order_id INTEGER PRIMARY KEY REFERENCES orders(order_id) ON DELETE CASCADE,
  fraud_probability DOUBLE PRECISION NOT NULL,
  predicted_fraud INTEGER NOT NULL,
  prediction_timestamp TEXT NOT NULL
);
"""

CREATE_SQL_SQLITE = """
CREATE TABLE IF NOT EXISTS order_predictions (
  order_id INTEGER PRIMARY KEY,
  fraud_probability REAL NOT NULL,
  predicted_fraud INTEGER NOT NULL,
  prediction_timestamp TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(order_id)
);
"""

UNSHIPPED_SQL = """
SELECT o.order_id, o.risk_score, o.order_total, o.payment_method, o.promo_used, o.ip_country
FROM orders o
LEFT JOIN shipments s ON s.order_id = o.order_id
WHERE s.shipment_id IS NULL
"""

UPSERT_PG = """
INSERT INTO order_predictions (order_id, fraud_probability, predicted_fraud, prediction_timestamp)
VALUES (%s, %s, %s, %s)
ON CONFLICT (order_id) DO UPDATE SET
  fraud_probability = EXCLUDED.fraud_probability,
  predicted_fraud = EXCLUDED.predicted_fraud,
  prediction_timestamp = EXCLUDED.prediction_timestamp
"""

UPSERT_SQLITE = """
INSERT INTO order_predictions (order_id, fraud_probability, predicted_fraud, prediction_timestamp)
VALUES (?, ?, ?, ?)
ON CONFLICT(order_id) DO UPDATE SET
  fraud_probability = excluded.fraud_probability,
  predicted_fraud = excluded.predicted_fraud,
  prediction_timestamp = excluded.prediction_timestamp
"""


def db_path_sqlite() -> str:
    return os.environ.get("SHOP_DB_PATH", os.path.join(ROOT, "..", "shop.db"))


def fraud_probability_heuristic(
    risk_score: float,
    order_total: float,
    payment_method: str,
    promo_used: int,
    ip_country: str,
) -> float:
    p = max(0.0, min(1.0, float(risk_score) / 100.0))
    if order_total > 500:
        p = min(1.0, p + 0.08)
    if order_total > 1200:
        p = min(1.0, p + 0.07)
    if str(payment_method).lower() == "crypto":
        p = min(1.0, p + 0.12)
    if promo_used:
        p = min(1.0, p + 0.03)
    if ip_country and ip_country != "US":
        p = min(1.0, p + 0.05)
    return round(p, 3)


def score_with_model(model, row: tuple) -> tuple[float, int] | None:
    return None


def run_pg() -> int:
    import psycopg

    url = os.environ["DATABASE_URL"]
    ts = datetime.now(timezone.utc).isoformat()
    model = None
    if os.path.isfile(MODEL_PATH):
        try:
            import joblib  # type: ignore

            model = joblib.load(MODEL_PATH)
        except Exception as e:
            print(f"WARN: could not load model: {e}", file=sys.stderr)

    with psycopg.connect(url) as conn:
        conn.execute(CREATE_SQL_PG)
        rows = conn.execute(UNSHIPPED_SQL).fetchall()
        n = 0
        for row in rows:
            oid = row[0]
            prob = None
            pred = None
            if model is not None:
                try:
                    out = score_with_model(model, row)
                    if out is not None:
                        prob, pred = out
                except Exception as e:
                    print(f"WARN: model score failed for order {oid}: {e}", file=sys.stderr)
            if prob is None:
                prob = fraud_probability_heuristic(row[1], row[2], row[3], row[4], row[5])
                pred = 1 if prob >= 0.5 else 0
            conn.execute(UPSERT_PG, (oid, prob, pred, ts))
            n += 1
    print(f"SCORED_COUNT={n}")
    return 0


def run_sqlite() -> int:
    path = db_path_sqlite()
    if not os.path.isfile(path):
        print(f"ERROR: database not found at {path}", file=sys.stderr)
        return 1

    conn = sqlite3.connect(path)
    conn.execute(CREATE_SQL_SQLITE)
    conn.commit()
    rows = conn.execute(UNSHIPPED_SQL).fetchall()

    model = None
    if os.path.isfile(MODEL_PATH):
        try:
            import joblib  # type: ignore

            model = joblib.load(MODEL_PATH)
        except Exception as e:
            print(f"WARN: could not load model: {e}", file=sys.stderr)

    ts = datetime.now(timezone.utc).isoformat()
    n = 0
    for row in rows:
        oid = row[0]
        prob = None
        pred = None
        if model is not None:
            try:
                out = score_with_model(model, row)
                if out is not None:
                    prob, pred = out
            except Exception as e:
                print(f"WARN: model score failed for order {oid}: {e}", file=sys.stderr)
        if prob is None:
            prob = fraud_probability_heuristic(row[1], row[2], row[3], row[4], row[5])
            pred = 1 if prob >= 0.5 else 0
        conn.execute(UPSERT_SQLITE, (oid, prob, pred, ts))
        n += 1
    conn.commit()
    conn.close()
    print(f"SCORED_COUNT={n}")
    return 0


def main() -> int:
    if os.environ.get("DATABASE_URL"):
        try:
            return run_pg()
        except ImportError:
            print("Install: pip install 'psycopg[binary]'", file=sys.stderr)
            return 1
    return run_sqlite()


if __name__ == "__main__":
    raise SystemExit(main())
