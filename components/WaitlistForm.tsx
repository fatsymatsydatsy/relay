"use client";

import { useEffect, useId, useState } from "react";
import { getSupabaseClient, WAITLIST_TABLE } from "@/lib/integrations/supabase-browser";
import { submitToNetlifyForms } from "@/lib/netlify";
import { capture } from "@/lib/analytics";

type Status = "idle" | "submitting" | "success" | "error";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface WaitlistFormProps {
  /** Reserved so multiple forms on one page get unique ids/analytics tags. */
  variant?: "hero" | "footer";
  onJoined?: () => void;
}

export default function WaitlistForm({
  variant = "hero",
  onJoined,
}: WaitlistFormProps) {
  const inputId = useId();
  const errorId = useId();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (status === "success") capture("waitlist_joined", { variant });
  }, [status, variant]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = email.trim();

    if (!EMAIL_RE.test(value)) {
      setStatus("error");
      setMessage("Please enter a valid email address.");
      return;
    }

    setStatus("submitting");
    setMessage("");

    // Best-effort Netlify Forms capture (see lib/netlify.ts). Started but not
    // awaited when Supabase is configured — it must never delay or gate the
    // primary path on Vercel, where it 405s and is ignored.
    const netlifyCapture = submitToNetlifyForms(value);

    const supabase = getSupabaseClient();

    // No Supabase configured: Netlify Forms is the only backend. Confirm only
    // if it actually stored the email — never show success when nothing
    // persisted anywhere (codex P2-4).
    if (!supabase) {
      if (await netlifyCapture) {
        setStatus("success");
        onJoined?.();
      } else {
        setStatus("error");
        setMessage("We couldn't save your signup — please try again in a moment.");
      }
      return;
    }

    const { error } = await supabase
      .from(WAITLIST_TABLE)
      .insert({ email: value });

    if (error) {
      // 23505 = unique_violation: the email is already on the list.
      if (error.code === "23505") {
        setStatus("success");
        setMessage("You're already on the list — we'll be in touch.");
        onJoined?.();
        return;
      }
      setStatus("error");
      setMessage("Something went wrong. Please try again.");
      return;
    }

    setStatus("success");
    onJoined?.();
  }

  if (status === "success") {
    return (
      <div
        role="status"
        className="flex items-start gap-3 rounded-card border border-teal/25 bg-mist px-4 py-3.5"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-teal"
        >
          <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M6 10.2 8.8 13 14 6.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div>
          <p className="font-medium text-ink">You&apos;re on the list.</p>
          <p className="text-sm text-muted">
            {message || "We'll email you the moment Relay launches in your area."}
          </p>
        </div>
      </div>
    );
  }

  const isError = status === "error";

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="w-full"
      aria-label="Join the Relay waitlist"
    >
      <div className="flex flex-col gap-2.5 sm:flex-row">
        <div className="flex-1">
          <label htmlFor={inputId} className="sr-only">
            Email address
          </label>
          <input
            id={inputId}
            type="email"
            inputMode="email"
            autoComplete="email"
            name={`email-${variant}`}
            placeholder="you@email.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (status === "error") setStatus("idle");
            }}
            aria-invalid={isError}
            aria-describedby={isError ? errorId : undefined}
            disabled={status === "submitting"}
            className="field w-full px-4 py-3.5 text-[15px]"
          />
        </div>
        <button
          type="submit"
          disabled={status === "submitting"}
          className="btn-primary px-6 py-3.5 text-[15px] whitespace-nowrap"
        >
          {status === "submitting" ? "Joining…" : "Join the waitlist"}
        </button>
      </div>
      {isError && (
        <p id={errorId} role="alert" className="mt-2 text-sm text-coral-deep">
          {message}
        </p>
      )}
    </form>
  );
}
