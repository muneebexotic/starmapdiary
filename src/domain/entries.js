const VALID_SENTIMENTS = new Set(["positive", "neutral", "negative", "reflective"]);

function normalizeEntry(row) {
  return {
    id: row.id,
    text: row.text,
    sentiment: row.sentiment,
    createdAt: row.created_at,
    position: row.position
  };
}

function validateCreateEntryPayload(body) {
  const text = String(body?.text || "").trim();
  const sentiment = String(body?.sentiment || "");
  const createdAt = String(body?.createdAt || "");
  const position = body?.position;

  const validPosition =
    position &&
    Number.isFinite(position.x) &&
    Number.isFinite(position.y) &&
    Number.isFinite(position.z);

  if (!text || text.length > 4000 || !VALID_SENTIMENTS.has(sentiment) || !validPosition || !createdAt) {
    return { valid: false, error: "Invalid entry payload." };
  }

  return {
    valid: true,
    value: {
      text,
      sentiment,
      createdAt,
      position: {
        x: position.x,
        y: position.y,
        z: position.z
      }
    }
  };
}

module.exports = {
  normalizeEntry,
  validateCreateEntryPayload
};
