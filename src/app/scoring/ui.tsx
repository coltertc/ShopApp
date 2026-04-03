"use client";

import { useState } from "react";

type ApiResult = {
  ok: boolean;
  scored: number;
  mode: string;
  at: string;
  stdout?: string;
  stderr?: string;
  message?: string;
};

export function RunScoringClient() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);

  async function run() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/scoring", { method: "POST" });
      const data = (await res.json()) as ApiResult & { error?: string };
      if (!res.ok) {
        setResult({
          ok: false,
          scored: 0,
          mode: "error",
          at: new Date().toISOString(),
          message: data.error || `HTTP ${res.status}`,
        });
      } else {
        setResult(data);
      }
    } catch (e) {
      setResult({
        ok: false,
        scored: 0,
        mode: "error",
        at: new Date().toISOString(),
        message: e instanceof Error ? e.message : "Request failed",
      });
    }
    setLoading(false);
  }

  return (
    <div className="max-w-xl space-y-4">
      <button
        type="button"
        onClick={run}
        disabled={loading}
        className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
      >
        {loading ? "Running…" : "Run scoring"}
      </button>
      {result ? (
        <div
          className={`rounded-md border px-3 py-3 text-sm ${
            result.ok
              ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"
              : "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100"
          }`}
        >
          <p className="font-medium">{result.ok ? "Success" : "Failed or partial"}</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-xs">
            <li>Mode: {result.mode}</li>
            <li>Orders scored: {result.scored}</li>
            <li>Timestamp: {result.at}</li>
            {result.message ? <li>{result.message}</li> : null}
          </ul>
          {result.stdout ? (
            <pre className="mt-2 max-h-40 overflow-auto rounded bg-black/5 p-2 text-xs dark:bg-white/10">
              {result.stdout}
            </pre>
          ) : null}
          {result.stderr ? (
            <pre className="mt-2 max-h-40 overflow-auto rounded bg-amber-100/50 p-2 text-xs dark:bg-amber-950/30">
              {result.stderr}
            </pre>
          ) : null}
        </div>
      ) : null}
      <p className="text-xs text-zinc-500">
        Response <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">mode</code> is usually{" "}
        <strong>typescript</strong> on Vercel. After a successful run, open <strong>Priority Queue</strong>.
      </p>
    </div>
  );
}
