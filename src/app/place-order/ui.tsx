"use client";

import { useState } from "react";

import { placeOrderAction, type LineInput } from "@/app/actions";

type Product = {
  product_id: number;
  product_name: string;
  price: number;
  category: string;
};

export function PlaceOrderForm({ products }: { products: Product[] }) {
  const [rows, setRows] = useState<{ productId: number; quantity: number }[]>([
    { productId: products[0]?.product_id ?? 0, quantity: 1 },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function addRow() {
    setRows((r) => [...r, { productId: products[0]?.product_id ?? 0, quantity: 1 }]);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const lines: LineInput[] = rows
      .filter((x) => x.productId > 0 && x.quantity > 0)
      .map((x) => ({ productId: x.productId, quantity: x.quantity }));
    if (!lines.length) {
      setError("Select at least one product with quantity ≥ 1.");
      return;
    }
    setPending(true);
    try {
      const res = await placeOrderAction(lines);
      if (res && "error" in res && res.error) {
        setError(res.error);
        setPending(false);
      }
    } catch {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-4">
      {error ? (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      ) : null}
      <div className="space-y-3">
        {rows.map((row, idx) => (
          <div key={idx} className="flex flex-wrap items-end gap-3">
            <label className="min-w-[200px] flex-1 text-sm">
              Product
              <select
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-2 dark:border-zinc-600 dark:bg-zinc-900"
                value={row.productId || ""}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  setRows((prev) => {
                    const next = [...prev];
                    next[idx] = { ...next[idx], productId: v };
                    return next;
                  });
                }}
              >
                {products.map((p) => (
                  <option key={p.product_id} value={p.product_id}>
                    {p.product_name} — {p.price.toFixed(2)} ({p.category})
                  </option>
                ))}
              </select>
            </label>
            <label className="w-28 text-sm">
              Qty
              <input
                type="number"
                min={1}
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-2 dark:border-zinc-600 dark:bg-zinc-900"
                value={row.quantity}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10) || 1;
                  setRows((prev) => {
                    const next = [...prev];
                    next[idx] = { ...next[idx], quantity: Math.max(1, v) };
                    return next;
                  });
                }}
              />
            </label>
            <button
              type="button"
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600"
              onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))}
              disabled={rows.length <= 1}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={addRow}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-600"
        >
          Add line
        </button>
        <button
          type="submit"
          disabled={pending || !products.length}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-200 dark:text-zinc-900"
        >
          {pending ? "Saving…" : "Submit order"}
        </button>
      </div>
    </form>
  );
}
