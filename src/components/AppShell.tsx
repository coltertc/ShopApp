import Link from "next/link";

import { getSelectedCustomerId } from "@/lib/customer";
import { getSql } from "@/lib/db";

const nav = [
  { href: "/select-customer", label: "Select Customer" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/place-order", label: "Place Order" },
  { href: "/orders", label: "My Orders" },
  { href: "/admin/orders", label: "Admin Orders" },
  { href: "/warehouse/priority", label: "Priority Queue" },
  { href: "/scoring", label: "Run Scoring" },
  { href: "/debug/schema", label: "DB Schema" },
];

export async function AppShell({ children }: { children: React.ReactNode }) {
  const customerId = await getSelectedCustomerId();
  let banner: string | null = null;
  if (customerId) {
    const sql = getSql();
    const rs = await sql`
      SELECT full_name, email FROM customers WHERE customer_id = ${customerId}
    `;
    const row = rs[0] as { full_name: string; email: string } | undefined;
    if (row) banner = `${row.full_name} (${row.email})`;
  }

  return (
    <>
      <header className="border-b border-zinc-800/10 bg-zinc-900 text-zinc-100 dark:border-zinc-100/10">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link href="/" className="text-lg font-semibold tracking-tight text-white">
              Shop Ops — ML Pipeline Demo
            </Link>
            <p className="text-xs text-zinc-400">IS455 · Chapter 17</p>
          </div>
          <nav className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-zinc-300 hover:text-white"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        {banner ? (
          <div className="border-t border-white/10 bg-zinc-800/60 px-4 py-2 text-sm text-zinc-200">
            Acting as customer #{customerId}: {banner}
          </div>
        ) : (
          <div className="border-t border-white/10 bg-amber-950/40 px-4 py-2 text-sm text-amber-100">
            No customer selected — choose one on{" "}
            <Link href="/select-customer" className="underline">
              Select Customer
            </Link>
            .
          </div>
        )}
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
      {process.env.VERCEL_GIT_COMMIT_SHA ? (
        <footer className="mx-auto max-w-5xl px-4 py-3 text-center text-[10px] text-zinc-500 dark:text-zinc-500">
          <span className="text-zinc-400">Build</span>{" "}
          <code className="rounded bg-zinc-200/20 px-1 font-mono text-zinc-600 dark:bg-zinc-700/40 dark:text-zinc-300">
            {process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)}
          </code>
          {process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production" ? (
            <span className="ml-1.5 text-zinc-400">({process.env.VERCEL_ENV})</span>
          ) : null}
        </footer>
      ) : null}
    </>
  );
}
