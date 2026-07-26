import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Relay uses a single public table (`waitlist_signups`) reachable with the
 * anon key, so one browser-safe client covers both server reads and client
 * inserts. When the env vars are absent (e.g. a fresh clone before secrets
 * are wired up) we return null and callers fall back to a graceful demo mode
 * rather than throwing.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
  });
}

export const WAITLIST_TABLE = "waitlist_signups";
