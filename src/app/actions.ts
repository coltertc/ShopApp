"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { CUSTOMER_COOKIE } from "@/lib/customer";
import { getSql } from "@/lib/db";

export async function selectCustomerAction(formData: FormData) {
  const id = formData.get("customer_id");
  if (typeof id !== "string" || !id) return;
  const n = parseInt(id, 10);
  if (!Number.isFinite(n)) return;
  const jar = await cookies();
  jar.set(CUSTOMER_COOKIE, String(n), {
    path: "/",
    maxAge: 60 * 60 * 24 * 120,
    sameSite: "lax",
  });
  redirect("/dashboard");
}

export type LineInput = { productId: number; quantity: number };

export async function placeOrderAction(lines: LineInput[]) {
  if (!lines.length) {
    return { error: "Add at least one line item." };
  }
  const jar = await cookies();
  const raw = jar.get(CUSTOMER_COOKIE)?.value;
  const customerId = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(customerId)) {
    redirect("/select-customer");
  }

  const sql = getSql();

  type PreparedLine = {
    productId: number;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  };

  const prepared: PreparedLine[] = [];
  for (const line of lines) {
    if (line.quantity < 1) continue;
    const pr = await sql`
      SELECT product_id, price FROM products
      WHERE product_id = ${line.productId} AND is_active = 1
    `;
    const p = pr[0] as { product_id: number; price: number } | undefined;
    if (!p) continue;
    prepared.push({
      productId: line.productId,
      quantity: line.quantity,
      unitPrice: p.price,
      lineTotal: p.price * line.quantity,
    });
  }

  if (!prepared.length) {
    return { error: "No valid products in the cart." };
  }

  const subtotal = prepared.reduce((s, x) => s + x.lineTotal, 0);
  const shippingFee = subtotal >= 100 ? 0 : 5.99;
  const taxAmount = Math.round(subtotal * 0.075 * 100) / 100;
  const orderTotal = Math.round((subtotal + shippingFee + taxAmount) * 100) / 100;

  const billingZip = "00000";
  const shippingZip = "00000";
  const shippingState = "NA";
  const paymentMethod = "card";
  const deviceType = "desktop";
  const ipCountry = "US";
  const orderDatetime = new Date().toISOString();

  let orderId: number;
  try {
    // postgres.js: TransactionSql typings omit the template-tag call signature; safe at runtime.
    orderId = await sql.begin(async (tx) => {
      const t = tx as unknown as typeof sql;
      const inserted = await t`
        INSERT INTO orders (
          customer_id, order_datetime, billing_zip, shipping_zip, shipping_state,
          payment_method, device_type, ip_country, promo_used,
          order_subtotal, shipping_fee, tax_amount, order_total, risk_score, is_fraud
        ) VALUES (
          ${customerId}, ${orderDatetime}, ${billingZip}, ${shippingZip}, ${shippingState},
          ${paymentMethod}, ${deviceType}, ${ipCountry}, 0,
          ${subtotal}, ${shippingFee}, ${taxAmount}, ${orderTotal}, 50, 0
        )
        RETURNING order_id
      `;
      const row = inserted[0] as { order_id: number };
      const id = Number(row.order_id);
      for (const item of prepared) {
        await t`
          INSERT INTO order_items (order_id, product_id, quantity, unit_price, line_total)
          VALUES (${id}, ${item.productId}, ${item.quantity}, ${item.unitPrice}, ${item.lineTotal})
        `;
      }
      return id;
    });
  } catch {
    return { error: "Could not save order. Check database permissions." };
  }

  redirect(`/orders?placed=${orderId}`);
}

/** Admin / warehouse: create a shipment row so the order leaves the unshipped priority queue. */
export async function fulfillOrderFromQueueAction(
  orderId: number,
): Promise<{ ok: true } | { error: string }> {
  if (!Number.isFinite(orderId) || orderId < 1) {
    return { error: "Invalid order." };
  }

  const sql = getSql();

  const existing = await sql`
    SELECT o.order_id FROM orders o
    LEFT JOIN shipments s ON s.order_id = o.order_id
    WHERE o.order_id = ${orderId} AND s.shipment_id IS NULL
  `;
  if (!existing.length) {
    return { error: "Order not found or already fulfilled." };
  }

  const shipDatetime = new Date().toISOString();
  try {
    await sql`
      INSERT INTO shipments (
        order_id, ship_datetime, carrier, shipping_method, distance_band,
        promised_days, actual_days, late_delivery
      ) VALUES (
        ${orderId}, ${shipDatetime}, ${"UPS"}, ${"ground"}, ${"regional"},
        ${5}, ${5}, ${0}
      )
    `;
  } catch {
    return { error: "Could not record shipment. Check database permissions." };
  }

  revalidatePath("/warehouse/priority");
  revalidatePath("/admin/orders");
  revalidatePath("/orders");
  revalidatePath("/dashboard");
  return { ok: true };
}
