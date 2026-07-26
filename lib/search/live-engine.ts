import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/integrations/supabase-browser";
import {
  presentCall,
  type CallRowLike,
} from "@/lib/domain/call-presentation";
import { bearingDeg, distanceMiles, todayHoursLabel } from "@/lib/domain/geo";
import { geocodePostcode, type LatLng } from "@/lib/search/geocode";
import type {
  ConnectCallbacks,
  NominatedPharmacy,
  PharmacyResult,
  SearchCallbacks,
  SearchEngine,
  SearchHandle,
  SearchRequest,
} from "./types";

/**
 * The real engine behind the /search board: anonymous session → create_search
 * command (Phase-1 stub) → owner-scoped realtime subscription on `calls`.
 * The UI is a pure projection — this module never writes; all writes go
 * through the command behind POST /api/search.
 */

const TERMINAL: ReadonlySet<PharmacyResult["phase"]> = new Set([
  "in-stock",
  "can-order",
  "no-stock",
  "unreached",
  "unverified",
  "expired",
]);

interface CallRowWire extends CallRowLike {
  id: string;
  pharmacy_ods: string;
}

interface PharmacyWire {
  ods_code: string;
  name: string;
  address: string;
  phone: string;
  lat: number;
  lng: number;
  hours: Record<string, [string, string][]> | null;
}

export function createLiveEngine(
  serverEngine: "live" | "demo" = "live",
): SearchEngine {
  return {
    kind: "live",

    start(request: SearchRequest, callbacks: SearchCallbacks): SearchHandle {
      const supabase = getSupabaseClient();
      let cancelled = false;
      let channel: RealtimeChannel | null = null;
      let completed = false;

      const staticInfo = new Map<
        string,
        Omit<PharmacyResult, "phase" | "bucket" | "quantityAvailable" | "quantityUnit" | "eta" | "confirmedAt">
      >();
      const board = new Map<string, PharmacyResult>();

      const emit = () => {
        if (cancelled) return;
        const rows = Array.from(board.values());
        callbacks.onUpdate(rows);
        if (
          !completed &&
          rows.length > 0 &&
          rows.every((r) => TERMINAL.has(r.phase))
        ) {
          completed = true;
          callbacks.onComplete(rows);
        }
      };

      const applyRow = (row: CallRowWire, emitNow = true) => {
        const info = staticInfo.get(row.pharmacy_ods);
        if (!info) return;
        const pres = presentCall(row);
        board.set(row.pharmacy_ods, { ...info, ...pres });
        if (emitNow) emit();
      };

      const run = async () => {
        if (!supabase) {
          console.error("live engine: Supabase env not configured");
          return;
        }

        // 1. Anonymous session (owner identity for RLS + realtime).
        let {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          const { data, error } = await supabase.auth.signInAnonymously();
          if (error || !data.session) {
            console.error("live engine: anonymous sign-in failed", error);
            return;
          }
          session = data.session;
        }
        if (cancelled) return;

        // 2. The command writes the search + calls (owned by this session).
        const res = await fetch("/api/search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ ...request, engine: serverEngine }),
        });
        if (!res.ok) {
          console.error("live engine: create_search failed", res.status);
          return;
        }
        const { searchId } = (await res.json()) as { searchId: string };
        if (cancelled) return;

        const refetchCalls = async () => {
          const { data } = await supabase
            .from("calls")
            .select("id, pharmacy_ods, status, rank_bucket, verdict, verdict_at")
            .eq("search_id", searchId);
          if (cancelled || !data) return;
          for (const row of data as CallRowWire[]) applyRow(row, false);
          emit();
        };

        // 3. Subscribe BEFORE the initial fetch so no transition is missed.
        // Realtime can't deliver `calls` to clients (table-level SELECT would
        // expose transcript/dial-number columns — see the board-tick
        // migration), so the trigger-bumped OWN searches row is the tick and
        // each tick refetches the column-granted calls.
        channel = supabase
          .channel(`board-${searchId}`)
          .on(
            "postgres_changes",
            {
              event: "UPDATE",
              schema: "public",
              table: "searches",
              filter: `id=eq.${searchId}`,
            },
            () => void refetchCalls(),
          )
          .subscribe();

        // 4. Initial state: calls + their pharmacies + patient origin.
        const { data: callRows, error: callsError } = await supabase
          .from("calls")
          .select(
            "id, pharmacy_ods, status, rank_bucket, verdict, verdict_at",
          )
          .eq("search_id", searchId);
        if (callsError || !callRows) {
          console.error("live engine: calls fetch failed", callsError);
          return;
        }

        const odsList = callRows.map((r) => r.pharmacy_ods);
        const { data: pharmacies, error: pharmacyError } = await supabase
          .from("pharmacies")
          .select("ods_code, name, address, phone, lat, lng, hours")
          .in("ods_code", odsList);
        if (pharmacyError || !pharmacies) {
          console.error("live engine: pharmacies fetch failed", pharmacyError);
          return;
        }

        const origin: LatLng | null = await geocodePostcode(request.postcode);
        if (cancelled) return;

        for (const p of pharmacies as PharmacyWire[]) {
          const point = { lat: p.lat, lng: p.lng };
          staticInfo.set(p.ods_code, {
            id: p.ods_code,
            name: p.name,
            road: p.address,
            address: p.address,
            distanceMiles: origin ? distanceMiles(origin, point) : 0,
            bearing: origin ? bearingDeg(origin, point) : 0,
            hours: todayHoursLabel(p.hours),
            phone: p.phone,
          });
        }

        for (const row of callRows as CallRowWire[]) {
          const info = staticInfo.get(row.pharmacy_ods);
          if (!info) continue;
          board.set(row.pharmacy_ods, { ...info, ...presentCall(row) });
        }
        emit();
      };

      void run();

      return {
        cancel() {
          cancelled = true;
          if (channel && supabase) void supabase.removeChannel(channel);
        },
      };
    },

    // CONNECT is parked (flagged decision F3) — no live implementation yet.
    connect(
      _pharmacy: NominatedPharmacy,
      _callbacks: ConnectCallbacks,
    ): SearchHandle {
      console.warn("live engine: connect() not implemented (F3 parked)");
      return { cancel() {} };
    },
  };
}
