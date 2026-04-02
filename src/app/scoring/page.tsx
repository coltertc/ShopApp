import { RunScoringClient } from "./ui";

export default function ScoringPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Run scoring</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Triggers the batch inference job that refreshes <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">order_predictions</code>{" "}
          for every <strong>unshipped</strong> order, then you can reload the priority queue.
        </p>
      </div>
      <RunScoringClient />
    </div>
  );
}
