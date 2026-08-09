export function formatDate(iso) {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

// Local calendar dates (YYYY-MM-DD) must not go through `new Date(str)`, which parses them
// as UTC midnight and can render as the previous day west of Greenwich.
function parseLocalDate(dateStr) {
  const [year, month, day] = String(dateStr || "").split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

export function formatDayLabel(dateStr) {
  return parseLocalDate(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatWeekday(dateStr) {
  return parseLocalDate(dateStr).toLocaleDateString(undefined, { weekday: "long" });
}

export function formatNights(count) {
  return `${count} ${count === 1 ? "night" : "nights"}`;
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function buildEntryPreview(text, max = 80) {
  const value = String(text || "");
  return value.length > max ? `${value.slice(0, max)}...` : value;
}
