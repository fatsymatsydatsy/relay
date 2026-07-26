"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";

if (typeof window !== "undefined" && POSTHOG_KEY) {
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    // App Router navigations don't trigger a full load, so we capture
    // pageviews manually below instead of relying on the automatic one.
    capture_pageview: false,
    capture_pageleave: true,
    // Health search context: no DOM autocapture, no session recording —
    // events are exclusively the explicit, allowlisted capture() calls.
    autocapture: false,
    disable_session_recording: true,
    // Logs event activity to the browser console during local development.
    debug: process.env.NODE_ENV === "development",
  });
}

function PageviewTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!POSTHOG_KEY) return;
    // Pathname only — query strings could carry user input (codex P1-2).
    posthog.capture("$pageview", {
      $current_url: window.location.origin + pathname,
    });
  }, [pathname]);

  return null;
}

export default function PostHogProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Without a key configured, render children untouched (no analytics).
  if (!POSTHOG_KEY) {
    return <>{children}</>;
  }

  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PageviewTracker />
      </Suspense>
      {children}
    </PHProvider>
  );
}
