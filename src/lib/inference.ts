import "server-only";

import { ensureOrderPredictionsTable, getSql } from "./db";

type OrderRow = {
  order_id: number;
  risk_score: number;
  order_total: number;
  payment_method: string;
  promo_used: number;
  ip_country: string;
  device_type: string | null;
  shipping_state: string | null;
};

/**
 * Deployed-site fraud score (0–1). TypeScript rules aligned with the same signals the lab
 * uses in orders + heuristic fallback in jobs/run_inference.py — not sklearn predict_proba.
 * Trained models from pipeline_sklearn.py are for the notebook and nightly GitHub training only.
 */
function fraudProbabilityFromRow(row: OrderRow): number {
  let p = Math.min(1, Math.max(0, Number(row.risk_score) / 100));
  if (row.order_total > 500) p = Math.min(1, p + 0.08);
  if (row.order_total > 1200) p = Math.min(1, p + 0.07);
  const pm = row.payment_method?.toLowerCase() ?? "";
  if (pm === "crypto") p = Math.min(1, p + 0.12);
  if (row.promo_used) p = Math.min(1, p + 0.03);
  if (row.ip_country && row.ip_country !== "US") p = Math.min(1, p + 0.05);
  const dev = row.device_type?.toLowerCase() ?? "";
  if (dev === "mobile") p = Math.min(1, p + 0.04);
  const st = row.shipping_state?.trim() ?? "";
  if (!st) p = Math.min(1, p + 0.03);
  return Math.round(p * 1000) / 1000;
}

/**
 * Score unshipped orders and upsert order_predictions (production path on Vercel).
 */
export async function runInlineScoring(): Promise<number> {
  await ensureOrderPredictionsTable();
  const sql = getSql();
  const now = new Date().toISOString();
  const rows = (await sql`
    SELECT
      o.order_id,
      o.risk_score,
      o.order_total,
      o.payment_method,
      o.promo_used,
      o.ip_country,
      o.device_type,
      o.shipping_state
    FROM orders o
    LEFT JOIN shipments s ON s.order_id = o.order_id
    WHERE s.shipment_id IS NULL
  `) as OrderRow[];

  await sql.begin(async (tx) => {
    const t = tx as unknown as typeof sql;
    for (const row of rows) {
      const fraud_probability = fraudProbabilityFromRow(row);
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

  return rows.length;
}
