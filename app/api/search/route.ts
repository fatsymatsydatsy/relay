import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSearchStub } from "@/lib/commands/create_search";
import { normalizePostcode } from "@/lib/search/geocode";

/**
 * POST /api/search — thin HTTP shell over the create_search command (stub).
 * Caller identity: the anonymous session's JWT; the command writes rows owned
 * by that uid so RLS + realtime scope the board to this session.
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
  const { medication, dose, quantity, postcode } = (body ?? {}) as Record<
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

  try {
    const { searchId } = await createSearchStub({
      owner: user.id,
      medication: medication.trim(),
      dose: dose.trim(),
      quantity: quantityNum,
      postcode: postcodeNorm,
    });
    return NextResponse.json({ searchId });
  } catch (err) {
    console.error("create_search stub failed:", err);
    return NextResponse.json({ error: "command_failed" }, { status: 500 });
  }
}
