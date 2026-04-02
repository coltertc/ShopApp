import "server-only";

import { ensureOrderPredictionsTable, getSql } from "./db";

type OrderRow = {
  order_id: number;
  risk_score: number;
  order_total: number;
  payment_method: string;
  promo_used: number;
  ip_country: string;
};

/** Heuristic fraud probability (0–1) until Part 2 drops a sklearn joblib next to this app. */
function fraudProbabilityFromRow(row: OrderRow): number {
  let p = Math.min(1, Math.max(0, Number(row.risk_score) / 100));
  if (row.order_total > 500) p = Math.min(1, p + 0.08);
  if (row.order_total > 1200) p = Math.min(1, p + 0.07);
  if (row.payment_method?.toLowerCase() === "crypto") p = Math.min(1, p + 0.12);
  if (row.promo_used) p = Math.min(1, p + 0.03);
  if (row.ip_country && row.ip_country !== "US") p = Math.min(1, p + 0.05);
  return Math.round(p * 1000) / 1000;
}

/**
 * Score unshipped orders and upsert order_predictions.
 * Mirrors jobs/run_inference.py so the queue updates the same way with or without Python.
 */
export async function runInlineScoring(): Promise<number> {
  await ensureOrderPredictionsTable();
  const sql = getSql();
  const now = new Date().toISOString();
  const rows = (await sql`
    SELECT o.order_id, o.risk_score, o.order_total, o.payment_method, o.promo_used, o.ip_country
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
