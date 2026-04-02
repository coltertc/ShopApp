import "server-only";

import { cookies } from "next/headers";

export const CUSTOMER_COOKIE = "shop_customer_id";

export async function getSelectedCustomerId(): Promise<number | null> {
  const jar = await cookies();
  const raw = jar.get(CUSTOMER_COOKIE)?.value;
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}
