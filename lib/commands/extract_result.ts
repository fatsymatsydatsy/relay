/**
 * extract_result — 3.4 lands the real transcript→verdict extractor here.
 * Until then transcript_ready rows wait (the watchdog re-invokes extraction,
 * so nothing is lost by this being a no-op for a few commits).
 */
export async function extractResult(callId: string): Promise<void> {
  console.log("[extract_result] not implemented yet (3.4):", callId);
}
