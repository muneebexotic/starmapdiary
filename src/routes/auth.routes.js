const express = require("express");
const { env } = require("../config/env");
const { baseClient, getBearerToken, getUserFromToken } = require("../lib/supabase");

const router = express.Router();

// Supabase only honours this if the same URL is on the project's redirect allow-list; when it is
// unset the mail falls back to the project Site URL.
const emailOptions = env.publicSiteUrl ? { emailRedirectTo: env.publicSiteUrl } : undefined;

router.post("/signup", async (req, res) => {
  const email = String(req.body?.email || "").trim();
  const password = String(req.body?.password || "");

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const { data, error } = await baseClient.auth.signUp({ email, password, options: emailOptions });
  if (error) return res.status(400).json({ error: error.message });

  // No session means the account is being held until the address is confirmed. An address that
  // is already registered comes back looking exactly the same — Supabase returns a decoy user
  // with no identities — and answering both cases identically is the point: sign-up must not
  // become a way to ask which addresses have accounts here.
  if (!data.session?.access_token) {
    return res.json({ user: null, session: null, confirmationSent: true, email });
  }

  return res.json({
    user: data.user ? { id: data.user.id, email: data.user.email } : null,
    session: data.session
  });
});

router.post("/login", async (req, res) => {
  const email = String(req.body?.email || "").trim();
  const password = String(req.body?.password || "");

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const { data, error } = await baseClient.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    // An unconfirmed address is not a wrong password, and telling someone their credentials are
    // invalid when they are in fact correct is a dead end. Its own status lets the client offer
    // another confirmation mail instead.
    if (error?.code === "email_not_confirmed" || /email not confirmed/i.test(error?.message || "")) {
      return res.status(403).json({
        error: "This email hasn't been confirmed yet.",
        needsConfirmation: true,
        email
      });
    }
    return res.status(401).json({ error: error?.message || "Invalid credentials." });
  }

  return res.json({
    user: data.user ? { id: data.user.id, email: data.user.email } : null,
    session: data.session
  });
});

router.post("/resend-confirmation", async (req, res) => {
  const email = String(req.body?.email || "").trim();

  if (!email) {
    return res.status(400).json({ error: "An email is required." });
  }

  const { error } = await baseClient.auth.resend({ type: "signup", email, options: emailOptions });

  // A rate limit is the one failure worth naming: the reader is waiting on a mail and needs to
  // know that waiting, not retrying, is the fix. Everything else — already confirmed, no such
  // account — reports success, for the same reason sign-up does.
  if (error?.status === 429) {
    return res.status(429).json({ error: "Too many emails just now. Try again in a minute." });
  }
  if (error) console.error("resend-confirmation:", error.message);

  return res.json({ ok: true, email });
});

// Supabase access tokens expire after an hour. The client trades its refresh token here rather
// than making the user retype a password. Refresh tokens rotate on every use, so the response
// carries a whole new session and the old refresh token is spent.
router.post("/refresh", async (req, res) => {
  const refreshToken = String(req.body?.refreshToken || "").trim();

  if (!refreshToken) {
    return res.status(400).json({ error: "A refresh token is required." });
  }

  const { data, error } = await baseClient.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) {
    return res.status(401).json({ error: "That session has expired." });
  }

  return res.json({
    user: data.user ? { id: data.user.id, email: data.user.email } : null,
    session: data.session
  });
});

router.get("/me", async (req, res) => {
  const token = getBearerToken(req);
  const user = await getUserFromToken(token);
  if (!user) return res.status(401).json({ error: "Unauthorized." });

  return res.json({ id: user.id, email: user.email });
});

module.exports = router;
