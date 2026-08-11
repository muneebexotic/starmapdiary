// Supabase verifies a confirmation link on its own domain and then bounces the reader here,
// putting the outcome in the URL fragment: either a finished session or a reason there isn't
// one. Parsing it is kept apart from the page so the awkward cases — a spent link, a link
// opened a day late — can be tested without a browser.

export function parseAuthHandoff(hash) {
  const raw = String(hash || "").replace(/^#/, "");
  // Every other visit has an empty or unrelated fragment, and must not be mistaken for one.
  if (!raw.includes("access_token") && !raw.includes("error")) return null;

  const params = new URLSearchParams(raw);
  const accessToken = params.get("access_token");

  if (accessToken) {
    return {
      session: {
        access_token: accessToken,
        refresh_token: params.get("refresh_token") || ""
      },
      // "signup" here means this is the moment the account came into being, which is worth
      // marking; a plain sign-in through the same door is not.
      type: params.get("type") || ""
    };
  }

  // A link that was already opened, or opened too late, is the failure that actually happens —
  // and it has a specific way out, so it gets its own sentence rather than Supabase's wording.
  if (params.get("error_code") === "otp_expired") {
    return { error: "That link has expired. Sign in and we'll send a fresh one." };
  }

  return {
    error: params.get("error_description") || "That link didn't work. Try signing in below."
  };
}
