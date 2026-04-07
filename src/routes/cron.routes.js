const express = require("express");
const { env } = require("../config/env");
const { dispatchDueReminders } = require("../services/reminders/dispatch");

const router = express.Router();

function isCronAuthorized(req) {
  const querySecret = String(req.query?.secret || "");
  const headerSecret = String(req.headers["x-cron-secret"] || "");
  const authHeader = String(req.headers.authorization || "");
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";

  return Boolean(env.cronSecret) && [querySecret, headerSecret, bearerToken].includes(env.cronSecret);
}

async function handleDispatch(req, res) {
  if (!isCronAuthorized(req)) {
    return res.status(401).json({ error: "Unauthorized cron call." });
  }

  if (!env.remindersEnabled) {
    return res.json({
      ok: true,
      disabled: true,
      counters: { scannedUsers: 0, sent: 0, skipped: 0, failed: 0 }
    });
  }

  try {
    const counters = await dispatchDueReminders();
    return res.json({ ok: true, counters });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Cron dispatch failed." });
  }
}

router.post("/reminders-dispatch", handleDispatch);
router.get("/reminders-dispatch", handleDispatch);

module.exports = router;
