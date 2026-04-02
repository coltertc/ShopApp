import Link from "next/link";
import { notFound } from "next/navigation";

import { getSql } from "@/lib/db";

type Props = { params: Promise<{ orderId: string }> };

export default async function AdminOrderDetailPage(props: Props) {
  const { orderId: raw } = await props.params;
  const orderId = parseInt(raw, 10);
  if (!Number.isFinite(orderId)) notFound();

  const sql = getSql();
  const orows = await sql`
    SELECT o.order_id, o.customer_id, o.order_datetime, o.order_total, o.risk_score, o.is_fraud,
           c.full_name AS customer_name, c.email
    FROM orders o
    JOIN customers c ON c.customer_id = o.customer_id
    WHERE o.order_id = ${orderId}
  `;
  const order = orows[0] as
    | {
        order_id: number;
        customer_id: number;
        order_datetime: string;
        order_total: number;
        risk_score: number;
        is_fraud: number;
        customer_name: string;
        email: string;
      }
    | undefined;

  if (!order) notFound();

  const items = (await sql`
    SELECT p.product_name, oi.quantity, oi.unit_price, oi.line_total
    FROM order_items oi
    JOIN products p ON p.product_id = oi.product_id
    WHERE oi.order_id = ${orderId}
    ORDER BY oi.order_item_id
  `) as { product_name: string; quantity: number; unit_price: number; line_total: number }[];

  return (
    <div className="space-y-6">
      <Link href="/admin/orders" className="text-sm text-sky-600 hover:underline dark:text-sky-400">
        ← Admin orders
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">Order #{order.order_id} (admin)</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {order.customer_name} · {order.email} · {order.order_datetime}
        </p>
        <p className="mt-2 text-sm">
          DB risk_score: <span className="font-mono">{order.risk_score}</span> · is_fraud:{" "}
          {order.is_fraud ? "1" : "0"}
        </p>
      </div>
      <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-800/80">
            <tr>
              <th className="px-3 py-2">Product</th>
              <th className="px-3 py-2">Qty</th>
              <th className="px-3 py-2">Unit</th>
              <th className="px-3 py-2">Line</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
            {items.map((it, i) => (
              <tr key={i}>
                <td className="px-3 py-2">{it.product_name}</td>
                <td className="px-3 py-2">{it.quantity}</td>
                <td className="px-3 py-2">
                  {Number(it.unit_price).toLocaleString(undefined, { style: "currency", currency: "USD" })}
                </td>
                <td className="px-3 py-2">
                  {Number(it.line_total).toLocaleString(undefined, { style: "currency", currency: "USD" })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-lg font-medium">
        Total:{" "}
        {Number(order.order_total).toLocaleString(undefined, { style: "currency", currency: "USD" })}
      </p>
    </div>
  );
}
