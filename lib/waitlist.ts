import { getSupabaseClient } from "./integrations/supabase-browser";

/**
 * REAL signup total or null — never a synthetic baseline. The upstream relay
 * repo added 214 to the count for social proof; judged submissions must not
 * show fabricated traction (runbook: honest recruitment only; codex P2-6;
 * flagged decision F2). Callers hide the social-proof line while the count is
 * null or small instead of inflating it.
 *
 * Runs on the server at request time via the `waitlist_count` RPC, which
 * returns an aggregate without exposing any emails.
 */
export async function getWaitlistCount(): Promise<number | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const { data, error } = await supabase.rpc("waitlist_count");
  if (error || typeof data !== "number") return null;

  return data;
}

/** Show "N people joined" only once it's genuinely worth saying. */
export function shouldShowCount(count: number | null): count is number {
  return count !== null && count >= 25;
}
