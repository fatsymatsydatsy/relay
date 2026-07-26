import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 4.6.3 (audit P1-2) — the browser client must be ONE cached instance with a
 * persisted session. The old factory built a fresh `persistSession:false`
 * client per call, so every search signed in as a new anonymous uid and the
 * one-active-search index (4.4) never bound.
 */
describe("browser supabase client", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("returns the SAME client across calls (one session per tab)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55521");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-for-test");
    const { getSupabaseClient } = await import("@/lib/integrations/supabase-browser");

    const first = getSupabaseClient();
    const second = getSupabaseClient();
    expect(first).not.toBeNull();
    expect(second).toBe(first); // identity, not just equality
  });

  it("still returns null when env is unconfigured (graceful demo fallback)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const { getSupabaseClient } = await import("@/lib/integrations/supabase-browser");
    expect(getSupabaseClient()).toBeNull();
  });
});
