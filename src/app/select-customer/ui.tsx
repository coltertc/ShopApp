"use client";

import { useMemo, useState } from "react";

type Customer = { customer_id: number; full_name: string; email: string };

export function CustomerPicker({
  customers,
  formAction,
}: {
  customers: Customer[];
  formAction: (formData: FormData) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return customers;
    return customers.filter(
      (c) =>
        c.full_name.toLowerCase().includes(s) ||
        c.email.toLowerCase().includes(s) ||
        String(c.customer_id).includes(s),
    );
  }, [customers, q]);

  return (
    <div className="space-y-4">
      <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
        Search
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name, email, or ID"
          className="mt-1 w-full max-w-md rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
        />
      </label>
      <form action={formAction} className="space-y-2">
        <div className="max-h-[420px] overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-zinc-100 dark:bg-zinc-800">
              <tr className="text-blue-600 dark:text-blue-400">
                <th className="px-3 py-2 font-medium">ID</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
              {filtered.map((c) => (
                <tr key={c.customer_id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                  <td className="px-3 py-2 font-mono text-xs">{c.customer_id}</td>
                  <td className="px-3 py-2">{c.full_name}</td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{c.email}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="submit"
                      name="customer_id"
                      value={c.customer_id}
                      className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
                    >
                      Use
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 ? (
          <p className="text-sm text-amber-700 dark:text-amber-400">No customers match.</p>
        ) : null}
      </form>
    </div>
  );
}
