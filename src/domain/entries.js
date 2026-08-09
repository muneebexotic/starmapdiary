const VALID_SENTIMENTS = new Set(["positive", "neutral", "negative", "reflective"]);

// Entry timestamps drive the streak, so a client-supplied createdAt is no longer harmless:
// without a bound, a caller could fabricate any streak by back-dating entries, and a device
// with a wrong clock would corrupt its own history by accident. inserted_at remains the
// server-side audit column.
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function normalizeEntry(row) {
  return {
    id: row.id,
    text: row.text,
    sentiment: row.sentiment,
    createdAt: row.created_at,
    position: row.position
  };
}

function validateCreateEntryPayload(body, { now = Date.now() } = {}) {
  const text = String(body?.text || "").trim();
  const sentiment = String(body?.sentiment || "");
  const createdAt = String(body?.createdAt || "");
  const position = body?.position;

  const validPosition =
    position &&
    Number.isFinite(position.x) &&
    Number.isFinite(position.y) &&
    Number.isFinite(position.z);

  const createdAtMs = createdAt ? Date.parse(createdAt) : Number.NaN;

  if (
    !text ||
    text.length > 4000 ||
    !VALID_SENTIMENTS.has(sentiment) ||
    !validPosition ||
    Number.isNaN(createdAtMs)
  ) {
    return { valid: false, error: "Invalid entry payload." };
  }

  if (Math.abs(createdAtMs - now) > MAX_CLOCK_SKEW_MS) {
    return { valid: false, error: "Entry timestamp is out of range. Check your device clock." };
  }

  return {
    valid: true,
    value: {
      text,
      sentiment,
      createdAt: new Date(createdAtMs).toISOString(),
      position: {
        x: position.x,
        y: position.y,
        z: position.z
      }
    }
  };
}

module.exports = {
  MAX_CLOCK_SKEW_MS,
  normalizeEntry,
  validateCreateEntryPayload
};
