import WaitlistForm from "./WaitlistForm";
import { shouldShowCount } from "@/lib/waitlist";

export default function BottomCTA({ count }: { count: number | null }) {
  return (
    <section className="pb-24">
      <div className="shell">
        <div className="mx-auto max-w-2xl rounded-[16px] border border-teal/20 bg-mist px-6 py-12 text-center sm:px-12 sm:py-14">
          <h2 className="display text-[2rem] text-ink sm:text-[2.5rem]">
            Never call 30 pharmacies again.
          </h2>
          <p className="mx-auto mt-4 max-w-md text-[1.05rem] leading-relaxed text-muted">
            Join the waitlist and we&apos;ll let you know the moment Relay is
            available in your area.
          </p>
          <div className="mx-auto mt-8 max-w-md text-left">
            <WaitlistForm variant="footer" />
            <p className="mt-3 text-center text-sm text-muted">
              {shouldShowCount(count) && (
                <>
                  <span className="font-medium text-ink">
                    {count.toLocaleString("en-GB")} people
                  </span>{" "}
                  already joined ·{" "}
                </>
              )}
              No spam, ever.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
