const { createClient } = require("@supabase/supabase-js");
const { env } = require("../config/env");

let adminClient = null;

function getAdminClient() {
  if (!env.supabaseServiceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  if (!adminClient) {
    adminClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
  }

  return adminClient;
}

module.exports = { getAdminClient };
