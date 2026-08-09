const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { env } = require("../config/env");
const { getReminderSettingsRow } = require("../services/reminders/status");
const { getStreakForUser } = require("../services/streaks/service");

const router = express.Router();

function getClientTimezone(req) {
  return String(req.headers["x-client-timezone"] || "").trim();
}

router.get("/", requireAuth, async (req, res) => {
  try {
    const settingsRow = await getReminderSettingsRow(req.auth.scopedClient, req.auth.user.id);

    const streak = await getStreakForUser({
      scopedClient: req.auth.scopedClient,
      settingsRow,
      headerTimezone: getClientTimezone(req),
      graceEnabled: env.streakGraceEnabled
    });

    return res.json(streak);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Failed to load streak." });
  }
});

module.exports = router;
