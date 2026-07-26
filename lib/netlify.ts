/**
 * Records a waitlist signup in Netlify Forms.
 *
 * Netlify captures submissions POSTed as URL-encoded form data to any path,
 * matched by the `form-name` field to a form it detected at build time (see
 * `public/__forms.html`). This is best-effort: outside a Netlify deployment
 * (local dev, other hosts) the request simply fails and is ignored, so the
 * primary signup flow is never blocked.
 */
const NETLIFY_FORM_NAME = "waitlist";

function encode(data: Record<string, string>): string {
  return Object.entries(data)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

export async function submitToNetlifyForms(email: string): Promise<boolean> {
  try {
    const response = await fetch("/__forms.html", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: encode({
        "form-name": NETLIFY_FORM_NAME,
        email,
        "bot-field": "",
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
