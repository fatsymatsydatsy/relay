import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Relay uses a single public table (`waitlist_signups`) reachable with the
 * anon key, so one browser-safe client covers both server reads and client
 * inserts. When the env vars are absent (e.g. a fresh clone before secrets
 * are wired up) we return null and callers fall back to a graceful demo mode
 * rather than throwing.
 *
 * ONE client, ONE persisted anonymous session (audit P1-2). Previously every
 * call built a fresh client with `persistSession:false`, so each search —
 * and every reload or new tab — signed in as a BRAND NEW anonymous uid. The
 * one-active-search-per-owner index (4.4) then never saw the same owner
 * twice, making the abuse guard decorative in the real browser. Persisting
 * the session also keeps a reloading patient attached to their own board.
 * (Server code must keep using `serviceClient()`; this module is client-only
 * and its module-level cache is per-tab.)
 */
let cached: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }
  if (!cached) {
    const browser = typeof window !== "undefined";
    cached = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        // storage only exists in the browser; SSR/tests get an ephemeral one
        persistSession: browser,
        autoRefreshToken: browser,
        storageKey: "relay-anon-session",
      },
    });
  }
  return cached;
}

export const WAITLIST_TABLE = "waitlist_signups";
