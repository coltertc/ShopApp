"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { fulfillOrderFromQueueAction } from "@/app/actions";

export type PriorityRow = {
  order_id: number;
  order_datetime: string;
  order_total: number;
  customer_id: number;
  customer_name: string;
  fraud_probability: number;
  predicted_fraud: number;
  prediction_timestamp: string;
};

export function PriorityQueueTable({ rows }: { rows: PriorityRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function fulfill(orderId: number) {
    setMessage(null);
    setBusyId(orderId);
    const result = await fulfillOrderFromQueueAction(orderId);
    setBusyId(null);
    if ("error" in result) {
      setMessage(result.error);
      return;
    }
    router.refresh();
  }

  if (rows.length === 0) {
    return null;
  }

  return (
    <>
      {message ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          {message}
        </p>
      ) : null}
      <p className="text-xs text-zinc-500">
        On a narrow screen, scroll the table sideways if needed — <strong>Fulfill</strong> is in the first columns.
      </p>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-800/90">
            <tr>
              <th className="px-3 py-2">Order</th>
              <th className="px-3 py-2">Fulfill</th>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Total</th>
              <th className="px-3 py-2">Fraud prob.</th>
              <th className="px-3 py-2">Pred. fraud</th>
              <th className="px-3 py-2">Scored at</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
            {rows.map((r) => (
              <tr key={r.order_id}>
                <td className="px-3 py-2 font-mono">#{r.order_id}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => void fulfill(r.order_id)}
                    className="rounded-md bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
                  >
                    {busyId === r.order_id ? "…" : "Fulfill"}
                  </button>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                  {r.order_datetime}
                </td>
                <td className="px-3 py-2">
                  #{r.customer_id} {r.customer_name}
                </td>
                <td className="px-3 py-2">
                  {Number(r.order_total).toLocaleString(undefined, {
                    style: "currency",
                    currency: "USD",
                  })}
                </td>
                <td className="px-3 py-2 font-mono">
                  {(Number(r.fraud_probability) * 100).toFixed(1)}%
                </td>
                <td className="px-3 py-2">{r.predicted_fraud ? "Yes" : "No"}</td>
                <td className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">
                  {r.prediction_timestamp}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
