import { execFile } from "child_process";
import { promisify } from "util";

import { NextResponse } from "next/server";

import { ensureOrderPredictionsTable } from "@/lib/db";
import { runInlineScoring } from "@/lib/inference";

const execFileAsync = promisify(execFile);

function parseScored(stdout: string): number | null {
  const m = stdout.match(/SCORED_COUNT=(\d+)/);
  if (m) return parseInt(m[1], 10);
  return null;
}

/** Set USE_PYTHON_SCORING=1 locally if you want jobs/run_inference.py (sklearn) instead of TS. */
function usePythonScoring(): boolean {
  const v = process.env.USE_PYTHON_SCORING;
  return v === "1" || v === "true";
}

/**
 * When set (e.g. on Vercel production), never run the TypeScript heuristic — it would overwrite
 * sklearn scores written by the nightly GitHub Action. See README for DISABLE_INLINE_SCORING.
 */
function disableInlineScoring(): boolean {
  const v = process.env.DISABLE_INLINE_SCORING;
  return v === "1" || v === "true";
}

export async function POST() {
  await ensureOrderPredictionsTable();
  const at = new Date().toISOString();

  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      {
        ok: false,
        scored: 0,
        mode: "failed",
        at,
        error: "DATABASE_URL is not configured.",
      },
      { status: 500 },
    );
  }

  if (usePythonScoring()) {
    const python = process.env.PYTHON_PATH || "python";
    const script = `${process.cwd()}/jobs/run_inference.py`;
    try {
      const { stdout, stderr } = await execFileAsync(python, [script], {
        cwd: process.cwd(),
        timeout: 120_000,
        env: { ...process.env },
      });
      const scored = parseScored(stdout) ?? 0;
      return NextResponse.json({
        ok: true,
        scored,
        mode: "python",
        at,
        stdout: stdout.slice(-4000),
        stderr: stderr?.slice(-2000),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (disableInlineScoring()) {
        return NextResponse.json(
          {
            ok: false,
            scored: 0,
            mode: "failed",
            at,
            error:
              "USE_PYTHON_SCORING is set but Python did not complete; DISABLE_INLINE_SCORING prevents TypeScript fallback. " +
              msg.slice(0, 400),
          },
          { status: 500 },
        );
      }
      try {
        const scored = await runInlineScoring();
        return NextResponse.json({
          ok: true,
          scored,
          mode: "typescript-fallback",
          at,
          message:
            "USE_PYTHON_SCORING is set but Python did not complete; used TypeScript scorer. " +
            msg.slice(0, 200),
        });
      } catch (inner) {
        const innerMsg = inner instanceof Error ? inner.message : String(inner);
        return NextResponse.json(
          {
            ok: false,
            scored: 0,
            mode: "failed",
            at,
            error: `${msg}\n${innerMsg}`,
          },
          { status: 500 },
        );
      }
    }
  }

  if (disableInlineScoring()) {
    return NextResponse.json({
      ok: true,
      scored: 0,
      mode: "external-only",
      at,
      message:
        "Scoring is handled by the nightly GitHub Action (sklearn → order_predictions). " +
        "This API does not run the TypeScript heuristic when DISABLE_INLINE_SCORING=1.",
    });
  }

  try {
    const scored = await runInlineScoring();
    return NextResponse.json({
      ok: true,
      scored,
      mode: "typescript",
      at,
    });
  } catch (inner) {
    const innerMsg = inner instanceof Error ? inner.message : String(inner);
    return NextResponse.json(
      {
        ok: false,
        scored: 0,
        mode: "failed",
        at,
        error: innerMsg,
      },
      { status: 500 },
    );
  }
}
