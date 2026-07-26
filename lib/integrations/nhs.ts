import type { NhsOrganisation } from "@/lib/domain/nhs";

/**
 * NHS Directory of Healthcare Services API v3 client (5.0).
 * Spec: https://digital.nhs.uk/developer/api-catalogue/directory-of-healthcare-services
 * (OAS 474338; predecessor "Service Search API" v1/v2 retired 2 Feb 2026).
 *
 * Application-restricted: `apikey` header. Keys come from the NHS Digital
 * Onboarding Service — the `int` environment key is self-service, `prod`
 * requires onboarding approval. `sandbox` is keyless canned data (shape
 * checks only — it ignores filters).
 *
 * Read-only, seed-time only: this client is called by
 * scripts/seed-nhs-pharmacies.ts, never from the request path.
 */

export type NhsEnv = "sandbox" | "int" | "prod";

const BASE_URLS: Record<NhsEnv, string> = {
  sandbox: "https://sandbox.api.service.nhs.uk/service-search-api",
  int: "https://int.api.service.nhs.uk/service-search-api",
  prod: "https://api.service.nhs.uk/service-search-api",
};

export interface NhsSearchOptions {
  lat: number;
  lng: number;
  /** server-side radius trim, km (client re-checks with our own distance) */
  radiusKm: number;
  top?: number;
  env: NhsEnv;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

const SELECT_FIELDS = [
  "ODSCode",
  "OrganisationName",
  "OrganisationTypeId",
  "OrganisationSubType",
  "OrganisationStatus",
  "Address1",
  "Address2",
  "Address3",
  "City",
  "County",
  "Postcode",
  "Latitude",
  "Longitude",
  "OpeningTimes",
  "Contacts",
].join(",");

/** Community pharmacies near a point, nearest first. */
export async function searchPharmaciesNear(
  options: NhsSearchOptions,
): Promise<NhsOrganisation[]> {
  const { lat, lng, radiusKm, env, apiKey } = options;
  const top = Math.min(options.top ?? 50, 50); // API page cap
  const doFetch = options.fetchImpl ?? fetch;
  if (env !== "sandbox" && !apiKey) {
    throw new Error(`NHS DoHS ${env} needs an API key (NHS_DOHS_API_KEY)`);
  }

  const point = `geography'POINT(${lng} ${lat})'`; // OData: lng THEN lat
  const params = new URLSearchParams({
    "api-version": "3",
    $filter: `OrganisationTypeId eq 'PHA' and OrganisationSubType eq 'Community' and geo.distance(Geocode, ${point}) le ${radiusKm}`,
    $orderby: `geo.distance(Geocode, ${point})`,
    $select: SELECT_FIELDS,
    $top: String(top),
  });

  const res = await doFetch(`${BASE_URLS[env]}/?${params.toString()}`, {
    headers: {
      Accept: "application/json",
      ...(apiKey ? { apikey: apiKey } : {}),
    },
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`NHS DoHS ${env} search failed: HTTP ${res.status} ${body}`);
  }
  const data = (await res.json()) as { value?: NhsOrganisation[] };
  return data.value ?? [];
}
