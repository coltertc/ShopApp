import { getSql } from "@/lib/db";

import { PriorityQueueTable } from "./ui";

export default async function PriorityQueuePage() {
  let rows: {
    order_id: number;
    order_datetime: string;
    order_total: number;
    customer_id: number;
    customer_name: string;
    fraud_probability: number;
    predicted_fraud: number;
    prediction_timestamp: string;
  }[] = [];
  let err: string | null = null;

  try {
    const sql = getSql();
    rows = (await sql`
      SELECT
        o.order_id,
        o.order_datetime,
        o.order_total,
        c.customer_id,
        c.full_name AS customer_name,
        p.fraud_probability,
        p.predicted_fraud,
        p.prediction_timestamp
      FROM orders o
      JOIN customers c ON c.customer_id = o.customer_id
      JOIN order_predictions p ON p.order_id = o.order_id
      LEFT JOIN shipments s ON s.order_id = o.order_id
      WHERE s.shipment_id IS NULL
      ORDER BY p.fraud_probability DESC, o.order_datetime ASC
      LIMIT 50
    `) as typeof rows;
  } catch (e) {
    err = e instanceof Error ? e.message : "Query failed";
  }

  const serializableRows = rows.map((r) => ({
    order_id: Number(r.order_id),
    order_datetime: String(r.order_datetime),
    order_total: Number(r.order_total),
    customer_id: Number(r.customer_id),
    customer_name: String(r.customer_name),
    fraud_probability: Number(r.fraud_probability),
    predicted_fraud: Number(r.predicted_fraud),
    prediction_timestamp: String(r.prediction_timestamp),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Fraud verification priority queue</h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          Before fulfilling <strong>unshipped</strong> orders, the warehouse team reviews this queue. Use{" "}
          <strong>Fulfill</strong> to record a shipment and remove the order from this list (no separate login in
          this lab).
          Rows are ranked by model-estimated <strong>fraud probability</strong> (highest first). Only
          orders with <strong>no shipment row</strong> appear here (sample data may already be fully
          shipped—place a new order to populate this queue). Run scoring after new orders arrive so{" "}
          <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">order_predictions</code> stays current.
          On the deployed app, <strong>Run scoring</strong> uses the server&apos;s TypeScript rules engine
          (same broad signals as the lab heuristic). The sklearn pipeline in{" "}
          <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">pipeline_sklearn.py</code> trains on
          Supabase for the notebook and can run nightly via GitHub Actions; set{" "}
          <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">USE_PYTHON_SCORING=1</code> locally if you
          want <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">jobs/run_inference.py</code> on the API
          instead.
        </p>
      </div>
      {err ? (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {err}
        </p>
      ) : null}
      <PriorityQueueTable rows={serializableRows} />
      {rows.length === 0 && !err ? (
        <p className="text-sm text-zinc-500">
          No unshipped orders with predictions yet. Place an order, then use{" "}
          <strong>Run Scoring</strong> to populate this list.
        </p>
      ) : null}
    </div>
  );
}
