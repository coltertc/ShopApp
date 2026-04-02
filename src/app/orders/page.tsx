import Link from "next/link";
import { redirect } from "next/navigation";

import { getSelectedCustomerId } from "@/lib/customer";
import { getSql } from "@/lib/db";

type Props = { searchParams?: Promise<{ placed?: string }> };

export default async function OrdersPage(props: Props) {
  const customerId = await getSelectedCustomerId();
  if (!customerId) redirect("/select-customer");

  const sp = (await props.searchParams) ?? {};
  const placed = sp.placed;

  const sql = getSql();
  const rows = (await sql`
    SELECT o.order_id, o.order_datetime, o.order_total,
           CASE WHEN s.shipment_id IS NULL THEN 0 ELSE 1 END AS shipped
    FROM orders o
    LEFT JOIN shipments s ON s.order_id = o.order_id
    WHERE o.customer_id = ${customerId}
    ORDER BY o.order_datetime DESC
  `) as { order_id: number; order_datetime: string; order_total: number; shipped: number }[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">My orders</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Order history for the selected customer.
        </p>
      </div>
      {placed ? (
        <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100">
          Order #{placed} was placed successfully.
        </p>
      ) : null}
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
            {rows.map((r) => (
              <tr key={r.order_id}>
                <td className="px-3 py-2">
                  <Link href={`/orders/${r.order_id}`} className="text-sky-600 hover:underline dark:text-sky-400">
                    #{r.order_id}
                  </Link>
                </td>
                <td className="px-3 py-2">{r.order_datetime}</td>
                <td className="px-3 py-2">
                  {Number(r.order_total).toLocaleString(undefined, { style: "currency", currency: "USD" })}
                </td>
                <td className="px-3 py-2">{r.shipped ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? <p className="text-sm text-zinc-500">No orders yet.</p> : null}
    </div>
  );
}
