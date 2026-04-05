import "server-only";

import fs from "fs";
import path from "path";

import { ensureOrderPredictionsTable, getSql } from "./db";
import type { LogisticHead } from "./ml/logisticHead";
import { fraudProbFromLogisticHead } from "./ml/logisticHead";
import { preprocessOrdersFeatures, type FeatureRow } from "./ml/preprocessOrders";

type OrderRow = {
  order_id: number;
  risk_score: number;
  order_total: number;
  payment_method: string;
  promo_used: number;
  ip_country: string;
};

type FullFeatureRow = OrderRow &
  Record<string, unknown> & {
    customer_id?: number;
    order_datetime?: unknown;
    billing_zip?: unknown;
    shipping_zip?: unknown;
    shipping_state?: unknown;
    device_type?: unknown;
    promo_code?: unknown;
    order_subtotal?: number;
    shipping_fee?: number;
    tax_amount?: number;
    is_fraud?: number;
    gender?: unknown;
    city?: unknown;
    state?: unknown;
    customer_segment?: unknown;
    loyalty_tier?: unknown;
    birthdate?: unknown;
    customer_created_at?: unknown;
  };

function loadJson<T>(relativePath: string): T | null {
  try {
    const p = path.join(process.cwd(), relativePath);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

function loadLogisticHead(): LogisticHead | null {
  return loadJson<LogisticHead>("artifacts/logistic_head.json");
}

function loadFeatureNames(): string[] | null {
  const data = loadJson<string[]>("artifacts/feature_names.json");
  return data && Array.isArray(data) && data.length > 0 ? data : null;
}

function reindexFeatures(row: FeatureRow, featureNames: string[]): FeatureRow {
  const out: FeatureRow = {};
  for (const name of featureNames) {
    out[name] = name in row ? row[name] : null;
  }
  return out;
}

/**
 * Same closed-form adjustment as jobs/run_inference.fraud_probability_heuristic
 * (used when sklearn artifacts are unavailable or the tuned model is not logistic).
 */
function fraudProbabilityHeuristic(row: OrderRow): number {
  let p = Math.min(1, Math.max(0, Number(row.risk_score) / 100));
  if (row.order_total > 500) p = Math.min(1, p + 0.08);
  if (row.order_total > 1200) p = Math.min(1, p + 0.07);
  if (String(row.payment_method).toLowerCase() === "crypto") p = Math.min(1, p + 0.12);
  if (row.promo_used) p = Math.min(1, p + 0.03);
  if (row.ip_country && row.ip_country !== "US") p = Math.min(1, p + 0.05);
  return Math.round(p * 1000) / 1000;
}

/**
 * Score unshipped orders and upsert order_predictions.
 * If artifacts/logistic_head.json exists (LogisticRegression won in pipeline_sklearn.py),
 * reproduces sklearn predict_proba in Node — no Python subprocess.
 */
export async function runInlineScoring(): Promise<number> {
  await ensureOrderPredictionsTable();
  const sql = getSql();
  const now = new Date().toISOString();

  const head = loadLogisticHead();
  const featureNames = loadFeatureNames();

  const raw = (await sql`
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
  `) as FullFeatureRow[];

  const useSklearnJs = Boolean(head && featureNames);

  const scored = new Map<number, number>();
  if (useSklearnJs && head && featureNames) {
    const stripped: FeatureRow[] = raw.map((r) => {
      const { order_id: _oid, ...rest } = r;
      return rest as FeatureRow;
    });
    const orderIds = raw.map((r) => Number(r.order_id));
    try {
      const featureMatrix = preprocessOrdersFeatures(stripped, true, orderIds);
      for (let i = 0; i < featureMatrix.length; i++) {
        const aligned = reindexFeatures(featureMatrix[i]!, featureNames);
        scored.set(orderIds[i]!, round4(fraudProbFromLogisticHead(aligned, head)));
      }
    } catch {
      scored.clear();
    }
  }

  await sql.begin(async (tx) => {
    const t = tx as unknown as typeof sql;
    for (const row of raw) {
      const fraud_probability =
        scored.get(row.order_id) ?? fraudProbabilityHeuristic(row);
      const predicted_fraud = fraud_probability >= 0.5 ? 1 : 0;
      await t`
        INSERT INTO order_predictions (order_id, fraud_probability, predicted_fraud, prediction_timestamp)
        VALUES (${row.order_id}, ${fraud_probability}, ${predicted_fraud}, ${now})
        ON CONFLICT (order_id) DO UPDATE SET
          fraud_probability = excluded.fraud_probability,
          predicted_fraud = excluded.predicted_fraud,
          prediction_timestamp = excluded.prediction_timestamp
      `;
    }
  });

  return raw.length;
}

function round4(p: number): number {
  return Math.round(p * 10000) / 10000;
}
