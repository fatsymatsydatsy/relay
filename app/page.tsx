import { serviceClient } from "@/lib/integrations/supabase";

export const dynamic = "force-dynamic";

async function pharmacyCount(): Promise<number | null> {
  try {
    const supabase = serviceClient();
    const { count, error } = await supabase
      .from("pharmacies")
      .select("*", { count: "exact", head: true });
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

export default async function Home() {
  const count = await pharmacyCount();
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ color: "#0b63b8" }}>MedFind</h1>
      <p>We make the phone calls so you don&apos;t have to.</p>
      <p data-testid="db-status">
        {count === null
          ? "Database not connected yet (step 0.3 pending)."
          : `${count} pharmacies loaded.`}
      </p>
    </main>
  );
}
