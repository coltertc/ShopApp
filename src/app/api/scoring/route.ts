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

export async function POST() {
  await ensureOrderPredictionsTable();
  const python = process.env.PYTHON_PATH || "python";
  const script = `${process.cwd()}/jobs/run_inference.py`;
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

  try {
    const { stdout, stderr } = await execFileAsync(python, [script], {
      cwd: process.cwd(),
      timeout: 120_000,
      env: {
        ...process.env,
      },
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
    try {
      const scored = await runInlineScoring();
      return NextResponse.json({
        ok: true,
        scored,
        mode: "inline-typescript",
        at,
        message:
          "Python job did not complete; used the bundled TypeScript scorer (same heuristic as the Python fallback). " +
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
