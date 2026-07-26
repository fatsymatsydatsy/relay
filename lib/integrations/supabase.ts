import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side client with full access — for commands only.
 * The browser never sees this key; it uses the anon client + RLS (step 4.3).
 */
export function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase env vars missing — set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local",
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
