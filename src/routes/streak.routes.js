const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { env } = require("../config/env");
const { getReminderSettingsRow } = require("../services/reminders/status");
const { getStreakForUser } = require("../services/streaks/service");
const { getStreakSettings, setStreakVisibility } = require("../services/streaks/settings");

const router = express.Router();

router.use(requireAuth);

function getClientTimezone(req) {
  return String(req.headers["x-client-timezone"] || "").trim();
}

// A missing streak_settings table (schema not applied yet) must not break the streak
// endpoint — it only means nobody has opted out.
async function readVisibility(scopedClient, userId) {
  try {
    const settings = await getStreakSettings(scopedClient, userId);
    return settings.visible;
  } catch (_error) {
    return true;
  }
}

router.get("/", async (req, res) => {
  try {
    const [settingsRow, visible] = await Promise.all([
      getReminderSettingsRow(req.auth.scopedClient, req.auth.user.id),
      readVisibility(req.auth.scopedClient, req.auth.user.id)
    ]);

    const streak = await getStreakForUser({
      scopedClient: req.auth.scopedClient,
      settingsRow,
      headerTimezone: getClientTimezone(req),
      graceEnabled: env.streakGraceEnabled,
      visible
    });

    return res.json(streak);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Failed to load streak." });
  }
});

router.put("/settings", async (req, res) => {
  if (typeof req.body?.visible !== "boolean") {
    return res.status(400).json({ error: "visible must be a boolean." });
  }

  try {
    const settings = await setStreakVisibility(
      req.auth.scopedClient,
      req.auth.user.id,
      req.body.visible
    );

    return res.json({ settings: { visible: settings.visible } });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Failed to save streak settings." });
  }
});

module.exports = router;
