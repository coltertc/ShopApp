import Link from "next/link";

import { getSql } from "@/lib/db";

export default async function AdminOrdersPage() {
  const sql = getSql();
  const rows = (await sql`
    SELECT o.order_id, o.order_datetime, o.order_total, o.risk_score, o.is_fraud,
           c.customer_id, c.full_name AS customer_name, c.email,
           CASE WHEN s.shipment_id IS NULL THEN 0 ELSE 1 END AS shipped
    FROM orders o
    JOIN customers c ON c.customer_id = o.customer_id
    LEFT JOIN shipments s ON s.order_id = o.order_id
    ORDER BY o.order_datetime DESC
    LIMIT 500
  `) as {
    order_id: number;
    order_datetime: string;
    order_total: number;
    risk_score: number;
    is_fraud: number;
    customer_id: number;
    customer_name: string;
    email: string;
    shipped: number;
  }[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Administrator — order history</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          All recent orders across customers (last 500). Use this for operational oversight without
          logging in.
        </p>
      </div>
      <div className="overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-800/90">
            <tr>
              <th className="px-3 py-2">Order</th>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Total</th>
              <th className="px-3 py-2">Risk</th>
              <th className="px-3 py-2">Fraud label</th>
              <th className="px-3 py-2">Shipped</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
            {rows.map((r) => (
              <tr key={r.order_id}>
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/orders/${r.order_id}`}
                    className="font-mono text-sky-600 hover:underline dark:text-sky-400"
                  >
                    #{r.order_id}
                  </Link>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                  {r.order_datetime}
                </td>
                <td className="px-3 py-2">
                  <span className="font-medium">{r.customer_name}</span>
                  <span className="block text-xs text-zinc-500">{r.email}</span>
                </td>
                <td className="px-3 py-2">
                  {Number(r.order_total).toLocaleString(undefined, { style: "currency", currency: "USD" })}
                </td>
                <td className="px-3 py-2">{Number(r.risk_score).toFixed(1)}</td>
                <td className="px-3 py-2">{r.is_fraud ? "Yes" : "No"}</td>
                <td className="px-3 py-2">{r.shipped ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? <p className="text-sm text-zinc-500">No orders in database.</p> : null}
    </div>
  );
}
