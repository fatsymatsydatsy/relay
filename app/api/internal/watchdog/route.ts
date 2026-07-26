import { NextResponse } from "next/server";
import { isAuthorizedInternal } from "@/lib/domain/internal-auth";
import { watchdog } from "@/lib/commands/watchdog";
import { extractResult } from "@/lib/commands/extract_result";
import { dispatch } from "@/lib/commands/dispatch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/internal/watchdog — the 60s tick (4.2), called by pg_cron via
 * pg_net (scripts/setup-watchdog.sql). Guarded by INTERNAL_SECRET (4.4):
 * fail-closed 401 when the secret is unset, weak, or wrong.
 */
export async function POST(req: Request) {
  if (
    !isAuthorizedInternal(
      req.headers.get("x-internal-secret"),
      process.env.INTERNAL_SECRET,
    )
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await watchdog({
      extractFn: (callId) => extractResult(callId, { dispatchFn: () => dispatch() }),
      dispatchFn: () => dispatch(),
    });
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[watchdog] tick failed", err);
    return NextResponse.json({ error: "watchdog_failed" }, { status: 500 });
  }
}
