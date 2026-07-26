import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createDemoSearch } from "@/lib/commands/demo_search";
import { createSearch } from "@/lib/commands/create_search";
import { seedAreaPharmacies } from "@/lib/commands/seed_area_pharmacies";
import { dispatch } from "@/lib/commands/dispatch";
import { normalizePostcode } from "@/lib/search/geocode";

/**
 * POST /api/search — thin HTTP shell over the search commands.
 * engine "live" = the REAL pipeline: create_search (portfolio queue) then
 * dispatch fills lines post-response (DEV_TEST reroutes dials to team phones;
 * DIALING_ENABLED=false parks everything queued). engine "demo" = the
 * fixture board (no dialing ever). Caller identity: the anonymous session's
 * JWT; commands write rows owned by that uid so RLS + realtime scope the
 * board to this session.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  // Resolve the uid by asking Supabase to validate the JWT — never trust a
  // client-supplied uid.
  const asCaller = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const {
    data: { user },
  } = await asCaller.auth.getUser(token);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const { medication, dose, quantity, postcode, engine } = (body ?? {}) as Record<
    string,
    unknown
  >;

  const postcodeNorm = normalizePostcode(typeof postcode === "string" ? postcode : "");
  const quantityNum = Number(quantity);
  if (
    typeof medication !== "string" ||
    medication.trim().length === 0 ||
    medication.length > 120 ||
    typeof dose !== "string" ||
    dose.length > 60 ||
    !Number.isInteger(quantityNum) ||
    quantityNum < 1 ||
    quantityNum > 20 ||
    !postcodeNorm
  ) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const engineMode = engine === "live" ? "live" : "demo";

  try {
    if (engineMode === "live") {
      const result = await createSearch(
        {
          owner: user.id,
          medication: medication.trim(),
          dose: dose.trim(),
          quantity: quantityNum,
          postcode: postcodeNorm,
        },
        // 5.2b national coverage: the live engine pulls the searched area's
        // pharmacies from the NHS directory before ranking (fail-open).
        { seedArea: seedAreaPharmacies },
      );
      // fill the lines once the searchId is on the wire
      if (!result.zeroOpen) {
        after(async () => {
          try {
            await dispatch();
          } catch (err) {
            console.error("dispatch after create_search failed:", err);
          }
        });
      }
      return NextResponse.json(result);
    }

    const { searchId } = await createDemoSearch({
      owner: user.id,
      medication: medication.trim(),
      dose: dose.trim(),
      quantity: quantityNum,
      postcode: postcodeNorm,
    });
    return NextResponse.json({ searchId });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "";
    // 4.4 abuse guard: the caller already has a live board — point back at it
    if (detail.startsWith("active_search_exists:")) {
      return NextResponse.json(
        { error: "active_search_exists", searchId: detail.split(":")[1] },
        { status: 409 },
      );
    }
    console.error(`create_search (${engineMode}) failed:`, err);
    return NextResponse.json(
      { error: detail === "geocode_failed" ? "geocode_failed" : "command_failed" },
      { status: detail === "geocode_failed" ? 422 : 500 },
    );
  }
}
