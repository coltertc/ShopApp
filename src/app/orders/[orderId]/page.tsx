import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getSelectedCustomerId } from "@/lib/customer";
import { getSql } from "@/lib/db";

type Props = { params: Promise<{ orderId: string }> };

export default async function OrderDetailPage(props: Props) {
  const customerId = await getSelectedCustomerId();
  if (!customerId) redirect("/select-customer");

  const { orderId: raw } = await props.params;
  const orderId = parseInt(raw, 10);
  if (!Number.isFinite(orderId)) notFound();

  const sql = getSql();
  const ord = await sql`
    SELECT order_id, customer_id, order_datetime, order_total
    FROM orders WHERE order_id = ${orderId}
  `;
  const order = ord[0] as
    | { order_id: number; customer_id: number; order_datetime: string; order_total: number }
    | undefined;

  if (!order) notFound();
  if (order.customer_id !== customerId) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Not your order</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          This order belongs to another customer. Admins can open it from{" "}
          <Link href="/admin/orders" className="text-sky-600 hover:underline dark:text-sky-400">
            Admin orders
          </Link>
          .
        </p>
      </div>
    );
  }

  const items = (await sql`
    SELECT p.product_name, oi.quantity, oi.unit_price, oi.line_total
    FROM order_items oi
    JOIN products p ON p.product_id = oi.product_id
    WHERE oi.order_id = ${orderId}
    ORDER BY oi.order_item_id
  `) as { product_name: string; quantity: number; unit_price: number; line_total: number }[];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/orders" className="text-sm text-sky-600 hover:underline dark:text-sky-400">
          ← Back to orders
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Order #{order.order_id}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{order.order_datetime}</p>
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
