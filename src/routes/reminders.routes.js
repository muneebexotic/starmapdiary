const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { env } = require("../config/env");
const { DEFAULT_REMINDER_TIMES } = require("../services/reminders/constants");
const { computeReminderStatus, coerceSettingsRow } = require("../services/reminders/status");
const { normalizeReminderTimes, validateTimezone } = require("../services/reminders/time");

const router = express.Router();

router.use(requireAuth);

async function getReminderSettingsRow(scopedClient, userId) {
  const { data, error } = await scopedClient
    .from("reminder_settings")
    .select("user_id,timezone,enabled,reminder_times")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

router.get("/status", async (req, res) => {
  if (!env.remindersEnabled) {
    return res.json({
      completedToday: false,
      nextDueAt: null,
      timezone: "UTC",
      enabled: false
    });
  }

  try {
    const settingsRow = await getReminderSettingsRow(req.auth.scopedClient, req.auth.user.id);
    const status = await computeReminderStatus({
      scopedClient: req.auth.scopedClient,
      userId: req.auth.user.id,
      settingsRow: settingsRow || {
        timezone: "UTC",
        enabled: true,
        reminder_times: DEFAULT_REMINDER_TIMES
      }
    });

    return res.json(status);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Failed to load reminder status." });
  }
});

router.put("/settings", async (req, res) => {
  if (!env.remindersEnabled) {
    return res.status(503).json({ error: "Reminders are currently disabled." });
  }

  try {
    const existing = await getReminderSettingsRow(req.auth.scopedClient, req.auth.user.id);
    const existingSettings = coerceSettingsRow(existing || {});

    const timezone = req.body?.timezone ?? existingSettings.timezone;
    const enabled = typeof req.body?.enabled === "boolean" ? req.body.enabled : existingSettings.enabled;
    const reminderTimesInput = req.body?.reminderTimes ?? existingSettings.reminderTimes;

    if (!validateTimezone(timezone)) {
      return res.status(400).json({ error: "Invalid timezone." });
    }

    const reminderTimes = normalizeReminderTimes(reminderTimesInput);

    const { data, error } = await req.auth.scopedClient
      .from("reminder_settings")
      .upsert(
        {
          user_id: req.auth.user.id,
          timezone,
          enabled,
          reminder_times: reminderTimes,
          updated_at: new Date().toISOString()
        },
        { onConflict: "user_id" }
      )
      .select("timezone,enabled,reminder_times")
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({
      settings: {
        timezone: data.timezone,
        enabled: data.enabled,
        reminderTimes: data.reminder_times
      }
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Failed to save reminder settings." });
  }
});

router.get("/push/public-key", (_req, res) => {
  if (!env.remindersEnabled) {
    return res.status(503).json({ error: "Reminders are currently disabled." });
  }

  if (!env.vapidPublicKey) {
    return res.status(503).json({ error: "Push notifications are not configured." });
  }
  return res.json({ publicKey: env.vapidPublicKey });
});

router.post("/push/subscribe", async (req, res) => {
  if (!env.remindersEnabled) {
    return res.status(503).json({ error: "Reminders are currently disabled." });
  }

  const subscription = req.body?.subscription;
  const endpoint = subscription?.endpoint;
  const p256dh = subscription?.keys?.p256dh;
  const auth = subscription?.keys?.auth;

  if (!endpoint || !p256dh || !auth) {
    return res.status(400).json({ error: "Invalid push subscription payload." });
  }

  const { error } = await req.auth.scopedClient
    .from("push_subscriptions")
    .upsert(
      {
        user_id: req.auth.user.id,
        endpoint,
        p256dh,
        auth,
        user_agent: String(req.headers["user-agent"] || ""),
        enabled: true,
        updated_at: new Date().toISOString()
      },
      { onConflict: "endpoint" }
    );

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  return res.json({ ok: true });
});

router.post("/push/unsubscribe", async (req, res) => {
  if (!env.remindersEnabled) {
    return res.status(503).json({ error: "Reminders are currently disabled." });
  }

  const endpoint = String(req.body?.endpoint || "").trim();
  if (!endpoint) {
    return res.status(400).json({ error: "endpoint is required." });
  }

  const { error } = await req.auth.scopedClient
    .from("push_subscriptions")
    .update({ enabled: false, updated_at: new Date().toISOString() })
    .eq("user_id", req.auth.user.id)
    .eq("endpoint", endpoint);

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  return res.json({ ok: true });
});

module.exports = router;
