const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { env } = require("../config/env");
const { normalizeEntry, validateCreateEntryPayload } = require("../domain/entries");
const { buildStreakAfterEntry } = require("../services/streaks/after-entry");

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const { data, error } = await req.auth.scopedClient
    .from("diary_entries")
    .select("id,text,sentiment,created_at,position")
    .order("created_at", { ascending: true });

  if (error) return res.status(400).json({ error: error.message });
  return res.json({ entries: (data || []).map(normalizeEntry) });
});

router.post("/", requireAuth, async (req, res) => {
  const validation = validateCreateEntryPayload(req.body);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  const { text, sentiment, createdAt, position } = validation.value;

  const { data, error } = await req.auth.scopedClient
    .from("diary_entries")
    .insert({
      user_id: req.auth.user.id,
      text,
      sentiment,
      created_at: createdAt,
      position
    })
    .select("id,text,sentiment,created_at,position")
    .single();

  if (error) return res.status(400).json({ error: error.message });

  // Writing the diary is the product; the streak is decoration. A failure here must never
  // turn a saved entry into an error the user sees.
  let streak = null;
  try {
    streak = await buildStreakAfterEntry({
      scopedClient: req.auth.scopedClient,
      userId: req.auth.user.id,
      headerTimezone: String(req.headers["x-client-timezone"] || "").trim(),
      graceEnabled: env.streakGraceEnabled
    });
  } catch (streakError) {
    console.warn(`[streaks] could not build streak after entry: ${streakError.message}`);
  }

  return res.status(201).json({ entry: normalizeEntry(data), streak });
});

module.exports = router;
