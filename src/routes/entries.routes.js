const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { normalizeEntry, validateCreateEntryPayload } = require("../domain/entries");

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
  return res.status(201).json({ entry: normalizeEntry(data) });
});

module.exports = router;
