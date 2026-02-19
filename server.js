const path = require("path");
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY in environment.");
  process.exit(1);
}

const origin = process.env.FRONTEND_ORIGIN || true;
const baseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false }
});

app.use(cors({ origin, credentials: false }));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.resolve(__dirname)));

function getBearerToken(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return null;
  return auth.slice("Bearer ".length).trim();
}

async function getUserFromToken(token) {
  if (!token) return null;
  const { data, error } = await baseClient.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

function createUserScopedClient(token) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
}

function normalizeEntry(row) {
  return {
    id: row.id,
    text: row.text,
    sentiment: row.sentiment,
    createdAt: row.created_at,
    position: row.position
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/auth/signup", async (req, res) => {
  const email = String(req.body?.email || "").trim();
  const password = String(req.body?.password || "");
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const { data, error } = await baseClient.auth.signUp({ email, password });
  if (error) return res.status(400).json({ error: error.message });

  res.json({
    user: data.user ? { id: data.user.id, email: data.user.email } : null,
    session: data.session
  });
});

app.post("/api/auth/login", async (req, res) => {
  const email = String(req.body?.email || "").trim();
  const password = String(req.body?.password || "");
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const { data, error } = await baseClient.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    return res.status(401).json({ error: error?.message || "Invalid credentials." });
  }

  res.json({
    user: data.user ? { id: data.user.id, email: data.user.email } : null,
    session: data.session
  });
});

app.get("/api/auth/me", async (req, res) => {
  const token = getBearerToken(req);
  const user = await getUserFromToken(token);
  if (!user) return res.status(401).json({ error: "Unauthorized." });
  res.json({ id: user.id, email: user.email });
});

app.get("/api/entries", async (req, res) => {
  const token = getBearerToken(req);
  const user = await getUserFromToken(token);
  if (!user) return res.status(401).json({ error: "Unauthorized." });

  const scopedClient = createUserScopedClient(token);
  const { data, error } = await scopedClient
    .from("diary_entries")
    .select("id,text,sentiment,created_at,position")
    .order("created_at", { ascending: true });

  if (error) return res.status(400).json({ error: error.message });
  res.json({ entries: (data || []).map(normalizeEntry) });
});

app.post("/api/entries", async (req, res) => {
  const token = getBearerToken(req);
  const user = await getUserFromToken(token);
  if (!user) return res.status(401).json({ error: "Unauthorized." });

  const text = String(req.body?.text || "").trim();
  const sentiment = String(req.body?.sentiment || "");
  const createdAt = String(req.body?.createdAt || "");
  const position = req.body?.position;

  const validSentiment = ["positive", "neutral", "negative", "reflective"].includes(sentiment);
  const validPosition =
    position &&
    Number.isFinite(position.x) &&
    Number.isFinite(position.y) &&
    Number.isFinite(position.z);

  if (!text || text.length > 4000 || !validSentiment || !validPosition || !createdAt) {
    return res.status(400).json({ error: "Invalid entry payload." });
  }

  const scopedClient = createUserScopedClient(token);
  const { data, error } = await scopedClient
    .from("diary_entries")
    .insert({
      user_id: user.id,
      text,
      sentiment,
      created_at: createdAt,
      position: { x: position.x, y: position.y, z: position.z }
    })
    .select("id,text,sentiment,created_at,position")
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ entry: normalizeEntry(data) });
});

app.use((_req, res) => {
  res.sendFile(path.resolve(__dirname, "index.html"));
});

app.listen(port, () => {
  console.log(`Star Map Diary server listening on http://localhost:${port}`);
});
