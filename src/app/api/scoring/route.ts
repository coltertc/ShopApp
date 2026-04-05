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

function skipPythonScoring(): boolean {
  const v = process.env.SKIP_PYTHON_SCORING;
  return v === "1" || v === "true";
}

function useTypescriptScoringFallback(): boolean {
  const v = process.env.USE_TYPESCRIPT_SCORING_FALLBACK;
  if (v === "1" || v === "true") return true;
  if (v === "0" || v === "false") return false;
  return process.env.VERCEL === "1";
}

function disableInlineScoring(): boolean {
  const v = process.env.DISABLE_INLINE_SCORING;
  return v === "1" || v === "true";
}

async function runPythonInference(): Promise<{
  stdout: string;
  stderr: string;
  scored: number;
}> {
  const python = process.env.PYTHON_PATH || "python";
  const script = `${process.cwd()}/jobs/run_inference.py`;
  const { stdout, stderr } = await execFileAsync(python, [script], {
    cwd: process.cwd(),
    timeout: 120_000,
    env: { ...process.env },
  });
  const scored = parseScored(stdout) ?? 0;
  return { stdout, stderr: stderr ?? "", scored };
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

  if (skipPythonScoring()) {
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
      return NextResponse.json({ ok: true, scored, mode: "typescript", at });
    } catch (inner) {
      const innerMsg = inner instanceof Error ? inner.message : String(inner);
      return NextResponse.json(
        { ok: false, scored: 0, mode: "failed", at, error: innerMsg },
        { status: 500 },
      );
    }
  }

  let pythonError = "";
  try {
    const { stdout, stderr, scored } = await runPythonInference();
    return NextResponse.json({
      ok: true,
      scored,
      mode: "python",
      at,
      stdout: stdout.slice(-4000),
      stderr: stderr?.slice(-2000),
    });
  } catch (e) {
    pythonError = e instanceof Error ? e.message : String(e);
    if (disableInlineScoring()) {
      return NextResponse.json(
        {
          ok: false,
          scored: 0,
          mode: "failed",
          at,
          error:
            "Python scoring did not complete; DISABLE_INLINE_SCORING prevents TypeScript fallback. " +
            pythonError.slice(0, 400),
        },
        { status: 500 },
      );
    }
    if (!useTypescriptScoringFallback()) {
      return NextResponse.json(
        {
          ok: false,
          scored: 0,
          mode: "failed",
          at,
          error:
            "Python scoring failed (jobs/run_inference.py + models.joblib). " + pythonError.slice(0, 500),
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
        message: "Python did not complete; used TypeScript scorer. " + pythonError.slice(0, 200),
      });
    } catch (inner) {
      const innerMsg = inner instanceof Error ? inner.message : String(inner);
      return NextResponse.json(
        { ok: false, scored: 0, mode: "failed", at, error: `${pythonError}\n${innerMsg}` },
        { status: 500 },
      );
    }
  }
}
