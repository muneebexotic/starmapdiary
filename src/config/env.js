const dotenv = require("dotenv");

dotenv.config();

const env = {
  port: Number(process.env.PORT || 3000),
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  frontendOrigin: process.env.FRONTEND_ORIGIN || true,
  // Where a confirmation link should put the browser back down. Without it Supabase falls back
  // to the project's Site URL, which ships as http://localhost:3000 — the reason confirmation
  // mails used to point at a machine the reader isn't sitting at. Trailing slashes are trimmed
  // because Supabase matches this against its redirect allow-list literally.
  publicSiteUrl: String(process.env.PUBLIC_SITE_URL || process.env.FRONTEND_ORIGIN || "")
    .trim()
    .replace(/\/+$/, ""),
  cronSecret: process.env.CRON_SECRET || "",
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY || "",
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || "",
  vapidSubject: process.env.VAPID_SUBJECT || "mailto:admin@example.com",
  remindersEnabled: String(process.env.REMINDERS_ENABLED || "true").toLowerCase() !== "false",
  streakGraceEnabled: String(process.env.STREAK_GRACE_ENABLED || "true").toLowerCase() !== "false"
};

if (!env.supabaseUrl || !env.supabaseAnonKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY in environment.");
}

module.exports = { env };
