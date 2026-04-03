"use client";

import { fulfillOrderFromQueueAction } from "@/app/actions";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function FulfillOrderButton({ orderId }: { orderId: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      const result = await fulfillOrderFromQueueAction(orderId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.push("/warehouse/priority?fulfilled=1");
    });
  }

  return (
    <div className="flex flex-col gap-1">
      {error ? (
        <p
          className="max-w-[14rem] text-xs text-amber-800 dark:text-amber-200"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className="rounded-md bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-60"
      >
        {isPending ? "Working…" : "Fulfill"}
      </button>
    </div>
  );
}
