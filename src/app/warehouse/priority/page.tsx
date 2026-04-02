import { getSql } from "@/lib/db";

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Fraud verification priority queue</h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          Before fulfilling <strong>unshipped</strong> orders, the warehouse team reviews this queue.
          Rows are ranked by model-estimated <strong>fraud probability</strong> (highest first). Only
          orders with <strong>no shipment row</strong> appear here (sample data may already be fully
          shipped—place a new order to populate this queue). Run scoring after new orders arrive so{" "}
          <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">order_predictions</code> stays current.
          When your teammate wires in the real classifier from Part 2, replace or extend{" "}
          <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">jobs/run_inference.py</code> to load
          their joblib artifact into the same table.
        </p>
      </div>
      {err ? (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {err}
        </p>
      ) : null}
      <div className="overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-800/90">
            <tr>
              <th className="px-3 py-2">Order</th>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Total</th>
              <th className="px-3 py-2">Fraud prob.</th>
              <th className="px-3 py-2">Pred. fraud</th>
              <th className="px-3 py-2">Scored at</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
            {rows.map((r) => (
              <tr key={r.order_id}>
                <td className="px-3 py-2 font-mono">#{r.order_id}</td>
                <td className="px-3 py-2 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                  {r.order_datetime}
                </td>
                <td className="px-3 py-2">
                  #{r.customer_id} {r.customer_name}
                </td>
                <td className="px-3 py-2">
                  {Number(r.order_total).toLocaleString(undefined, { style: "currency", currency: "USD" })}
                </td>
                <td className="px-3 py-2 font-mono">{(Number(r.fraud_probability) * 100).toFixed(1)}%</td>
                <td className="px-3 py-2">{r.predicted_fraud ? "Yes" : "No"}</td>
                <td className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">
                  {r.prediction_timestamp}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && !err ? (
        <p className="text-sm text-zinc-500">
          No unshipped orders with predictions yet. Place an order, then use{" "}
          <strong>Run Scoring</strong> to populate this list.
        </p>
      ) : null}
    </div>
  );
}
