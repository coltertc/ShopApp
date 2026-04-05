"""
Batch scoring for unshipped orders → order_predictions.

- If DATABASE_URL is set (Supabase): uses psycopg + pandas.
- Else: uses SQLite at ../shop.db (local-only legacy).

Loads the Part 2 sklearn pipeline from (first match):
  FRAUD_MODEL_PATH, ../models.joblib, ../model.joblib, ../artifacts/fraud_model.joblib

Expects ../artifacts/feature_names.json (written when you run pipeline_sklearn.py).
If the model or feature list is missing, falls back to the same heuristic as src/lib/inference.ts.
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARTIFACT_DIR = os.path.join(ROOT, "artifacts")
MODEL_PATH_LEGACY = os.path.join(ARTIFACT_DIR, "fraud_model.joblib")
MODEL_PATH_ROOT = os.path.join(ROOT, "model.joblib")
FEATURE_NAMES_PATH = os.path.join(ARTIFACT_DIR, "feature_names.json")

if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

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

# Same features as pipeline_sklearn training query, plus unshipped filter.
UNSHIPPED_FEATURES_SQL = """
SELECT
  o.order_id,
  o.customer_id,
  o.order_datetime,
  o.billing_zip,
  o.shipping_zip,
  o.shipping_state,
  o.payment_method,
  o.device_type,
  o.ip_country,
  o.promo_used,
  o.promo_code,
  o.order_subtotal,
  o.shipping_fee,
  o.tax_amount,
  o.order_total,
  o.risk_score,
  o.is_fraud,
  c.gender,
  c.city,
  c.state,
  c.customer_segment,
  c.loyalty_tier,
  c.birthdate,
  c.created_at AS customer_created_at
FROM orders o
JOIN customers c ON c.customer_id = o.customer_id
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
    return os.environ.get("SHOP_DB_PATH", os.path.join(ROOT, "shop.db"))


def resolve_model_path() -> str | None:
    envp = os.environ.get("FRAUD_MODEL_PATH")
    if envp and os.path.isfile(envp):
        return envp
    for p in (MODEL_PATH_PRIMARY, MODEL_PATH_ROOT, MODEL_PATH_LEGACY):
        if os.path.isfile(p):
            return p
    return None


def load_feature_names() -> list[str] | None:
    if not os.path.isfile(FEATURE_NAMES_PATH):
        return None
    try:
        with open(FEATURE_NAMES_PATH, encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list) and data:
            return data
    except (OSError, json.JSONDecodeError):
        pass
    return None


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


def try_sklearn_batch(
    model,
    feature_names: list[str],
    rows: list[tuple],
    col_names: list[str],
) -> dict[int, tuple[float, int]] | None:
    """Returns order_id → (prob, pred) for rows the preprocessor kept; None to use heuristics."""
    try:
        import numpy as np
        import pandas as pd
    except ImportError:
        print("WARN: pandas/numpy not available for sklearn batch", file=sys.stderr)
        return None

    try:
        from pipeline_sklearn import preprocess_orders_features
    except Exception as e:
        print(f"WARN: could not import preprocess_orders_features: {e}", file=sys.stderr)
        return None

    if not rows:
        return {}

    df = pd.DataFrame.from_records(rows, columns=col_names)
    if "order_id" not in df.columns:
        return None

    oid_series = df.pop("order_id")
    df.index = oid_series

    try:
        X = preprocess_orders_features(df, for_inference=True, messages=False)
    except Exception as e:
        print(f"WARN: preprocess failed: {e}", file=sys.stderr)
        return None

    if X.shape[0] == 0:
        return {}

    X = X.reindex(columns=feature_names)

    try:
        probs = model.predict_proba(X)[:, 1]
        preds = model.predict(X)
    except Exception as e:
        print(f"WARN: model predict failed: {e}", file=sys.stderr)
        return None

    out: dict[int, tuple[float, int]] = {}
    for oid, prob, pred in zip(X.index, probs, preds):
        p = float(np.clip(prob, 0.0, 1.0))
        out[int(oid)] = (round(p, 4), int(pred))
    return out


def run_pg() -> int:
    import psycopg

    url = os.environ["DATABASE_URL"]
    ts = datetime.now(timezone.utc).isoformat()

    model = None
    feature_names = load_feature_names()
    mpath = resolve_model_path()
    if mpath:
        try:
            import joblib  # type: ignore

            model = joblib.load(mpath)
        except Exception as e:
            print(f"WARN: could not load model from {mpath}: {e}", file=sys.stderr)

    with psycopg.connect(url) as conn:
        conn.execute(CREATE_SQL_PG)
        cur = conn.execute(UNSHIPPED_FEATURES_SQL)
        col_names = [d.name for d in cur.description] if cur.description else []
        rows = cur.fetchall()

        sklearn_scores: dict[int, tuple[float, int]] | None = None
        if model is not None and feature_names:
            sklearn_scores = try_sklearn_batch(model, feature_names, list(rows), col_names)

        n = 0
        colmap = {name: i for i, name in enumerate(col_names)}
        for row in rows:
            oid = int(row[colmap["order_id"]])
            prob = None
            pred = None
            if sklearn_scores and oid in sklearn_scores:
                prob, pred = sklearn_scores[oid]
            if prob is None:
                prob = fraud_probability_heuristic(
                    row[colmap["risk_score"]],
                    row[colmap["order_total"]],
                    row[colmap["payment_method"]],
                    row[colmap["promo_used"]],
                    row[colmap["ip_country"]],
                )
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

    model = None
    feature_names = load_feature_names()
    mpath = resolve_model_path()
    if mpath:
        try:
            import joblib  # type: ignore

            model = joblib.load(mpath)
        except Exception as e:
            print(f"WARN: could not load model from {mpath}: {e}", file=sys.stderr)

    conn = sqlite3.connect(path)
    conn.execute(CREATE_SQL_SQLITE)
    conn.commit()
    cur = conn.execute(UNSHIPPED_FEATURES_SQL)
    col_names = [d[0] for d in cur.description]
    rows = cur.fetchall()
    ts = datetime.now(timezone.utc).isoformat()

    sklearn_scores: dict[int, tuple[float, int]] | None = None
    if model is not None and feature_names:
        sklearn_scores = try_sklearn_batch(model, feature_names, list(rows), col_names)

    n = 0
    colmap = {name: i for i, name in enumerate(col_names)}
    for row in rows:
        oid = int(row[colmap["order_id"]])
        prob = None
        pred = None
        if sklearn_scores and oid in sklearn_scores:
            prob, pred = sklearn_scores[oid]
        if prob is None:
            prob = fraud_probability_heuristic(
                row[colmap["risk_score"]],
                row[colmap["order_total"]],
                row[colmap["payment_method"]],
                row[colmap["promo_used"]],
                row[colmap["ip_country"]],
            )
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
