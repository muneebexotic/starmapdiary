const express = require("express");
const { baseClient, getBearerToken, getUserFromToken } = require("../lib/supabase");

const router = express.Router();

router.post("/signup", async (req, res) => {
  const email = String(req.body?.email || "").trim();
  const password = String(req.body?.password || "");

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const { data, error } = await baseClient.auth.signUp({ email, password });
  if (error) return res.status(400).json({ error: error.message });

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
    return res.status(401).json({ error: error?.message || "Invalid credentials." });
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
