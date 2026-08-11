const { createClient } = require("@supabase/supabase-js");
const { env } = require("../config/env");

// Sign-up is requested here but the confirmation link is opened over in the reader's browser,
// so the two halves of a PKCE exchange would never meet: the verifier would be stranded on this
// server. Implicit flow hands the finished session to the browser in the URL fragment instead,
// which is the half the frontend can actually pick up.
const baseClient = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: { persistSession: false, flowType: "implicit" }
});

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
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
}

module.exports = {
  baseClient,
  getBearerToken,
  getUserFromToken,
  createUserScopedClient
};
