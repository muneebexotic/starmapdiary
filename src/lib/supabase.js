const { createClient } = require("@supabase/supabase-js");
const { env } = require("../config/env");

const baseClient = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: { persistSession: false }
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
