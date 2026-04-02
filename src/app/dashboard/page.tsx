import Link from "next/link";
import { redirect } from "next/navigation";

import { getSelectedCustomerId } from "@/lib/customer";
import { getSql } from "@/lib/db";

export default async function DashboardPage() {
  const customerId = await getSelectedCustomerId();
  if (!customerId) redirect("/select-customer");

  const sql = getSql();
  const custRows = await sql`
    SELECT full_name, email FROM customers WHERE customer_id = ${customerId}
  `;
  const customer = custRows[0] as { full_name: string; email: string } | undefined;

  if (!customer) redirect("/select-customer");

  const countRows = await sql`
    SELECT
      COUNT(*)::int AS order_count,
      COALESCE(SUM(order_total), 0)::float8 AS spend
    FROM orders WHERE customer_id = ${customerId}
  `;
  const counts = countRows[0] as { order_count: number; spend: number };

  const recent = (await sql`
    SELECT o.order_id, o.order_datetime, o.order_total,
           CASE WHEN s.shipment_id IS NULL THEN 0 ELSE 1 END AS shipped
    FROM orders o
    LEFT JOIN shipments s ON s.order_id = o.order_id
    WHERE o.customer_id = ${customerId}
    ORDER BY o.order_datetime DESC
    LIMIT 5
  `) as { order_id: number; order_datetime: string; order_total: number; shipped: number }[];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {customer.full_name} · {customer.email}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Orders</p>
          <p className="text-2xl font-semibold">{counts.order_count}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Lifetime spend</p>
          <p className="text-2xl font-semibold">
            {Number(counts.spend).toLocaleString(undefined, { style: "currency", currency: "USD" })}
          </p>
        </div>
      </div>
      <div>
        <h2 className="mb-2 text-lg font-medium">Recent orders</h2>
        <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-800/80">
              <tr>
                <th className="px-3 py-2">Order</th>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Total</th>
                <th className="px-3 py-2">Shipped</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
              {recent.map((r) => (
                <tr key={r.order_id}>
                  <td className="px-3 py-2">
                    <Link href={`/orders/${r.order_id}`} className="text-sky-600 hover:underline dark:text-sky-400">
                      #{r.order_id}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{r.order_datetime}</td>
                  <td className="px-3 py-2">
                    {Number(r.order_total).toLocaleString(undefined, { style: "currency", currency: "USD" })}
                  </td>
                  <td className="px-3 py-2">{r.shipped ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {recent.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">
            No orders yet.{" "}
            <Link href="/place-order" className="text-sky-600 hover:underline dark:text-sky-400">
              Place one
            </Link>
            .
          </p>
        ) : null}
      </div>
    </div>
  );
}
