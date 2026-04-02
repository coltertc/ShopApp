import { redirect } from "next/navigation";

import { getSelectedCustomerId } from "@/lib/customer";
import { getSql } from "@/lib/db";

import { PlaceOrderForm } from "./ui";

export default async function PlaceOrderPage() {
  const customerId = await getSelectedCustomerId();
  if (!customerId) redirect("/select-customer");

  const sql = getSql();
  const products = (await sql`
    SELECT product_id, product_name, price, category FROM products
    WHERE is_active = 1
    ORDER BY product_name
  `) as { product_id: number; product_name: string; price: number; category: string }[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Place order</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Add line items. Subtotal, estimated tax (7.5%), and shipping are computed on submit.
        </p>
      </div>
      <PlaceOrderForm products={products} />
    </div>
  );
}
