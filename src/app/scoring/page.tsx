import { RunScoringClient } from "./ui";

export default function ScoringPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Run scoring</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Calls <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">POST /api/scoring</code>. By default
          this uses the TypeScript scorer for unshipped orders. If{" "}
          <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">DISABLE_INLINE_SCORING=1</code> is set
          (recommended on Vercel when sklearn scores come from the nightly GitHub Action), the button returns a
          message instead of overwriting those rows. Reload the priority queue after a successful run.
        </p>
      </div>
      <RunScoringClient />
    </div>
  );
}
