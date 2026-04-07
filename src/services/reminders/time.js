const { DateTime } = require("luxon");
const { DEFAULT_REMINDER_TIMES } = require("./constants");

function normalizeTimeValue(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();

  const hhmm = /^(\d{2}):(\d{2})$/;
  const hhmmss = /^(\d{2}):(\d{2}):(\d{2})$/;

  let match = trimmed.match(hhmm);
  if (match) {
    const [, h, m] = match;
    const hours = Number(h);
    const minutes = Number(m);
    if (hours > 23 || minutes > 59) return null;
    return `${h}:${m}:00`;
  }

  match = trimmed.match(hhmmss);
  if (match) {
    const [, h, m, s] = match;
    const hours = Number(h);
    const minutes = Number(m);
    const seconds = Number(s);
    if (hours > 23 || minutes > 59 || seconds > 59) return null;
    return `${h}:${m}:${s}`;
  }

  return null;
}

function normalizeReminderTimes(times) {
  if (times == null) return [...DEFAULT_REMINDER_TIMES];
  if (!Array.isArray(times) || times.length === 0) {
    throw new Error("reminderTimes must be a non-empty array.");
  }

  const normalized = times.map(normalizeTimeValue);
  if (normalized.some((value) => !value)) {
    throw new Error("Each reminder time must be in HH:MM or HH:MM:SS format.");
  }

  const uniqueSorted = [...new Set(normalized)].sort();
  return uniqueSorted;
}

function validateTimezone(timezone) {
  if (!timezone || typeof timezone !== "string") return false;
  return DateTime.now().setZone(timezone).isValid;
}

function getLocalNow(timezone, now = DateTime.utc()) {
  return now.setZone(timezone);
}

function toUtcBoundsForLocalDate(timezone, localDate) {
  const startLocal = DateTime.fromISO(`${localDate}T00:00:00`, { zone: timezone });
  const endLocal = startLocal.plus({ days: 1 });
  return {
    startUtcIso: startLocal.toUTC().toISO(),
    endUtcIso: endLocal.toUTC().toISO()
  };
}

function getNextDueAt(timezone, reminderTimes, now = DateTime.utc()) {
  const localNow = getLocalNow(timezone, now);
  const date = localNow.toISODate();

  for (let i = 0; i < reminderTimes.length; i += 1) {
    const slot = reminderTimes[i];
    const slotAt = DateTime.fromISO(`${date}T${slot}`, { zone: timezone });
    if (slotAt > localNow) {
      return slotAt.toUTC().toISO();
    }
  }

  return null;
}

function getDueSlots(timezone, reminderTimes, now = DateTime.utc()) {
  const localNow = getLocalNow(timezone, now);
  const date = localNow.toISODate();
  const dueSlots = [];

  for (let i = 0; i < reminderTimes.length; i += 1) {
    const slot = reminderTimes[i];
    const slotAt = DateTime.fromISO(`${date}T${slot}`, { zone: timezone });
    if (slotAt <= localNow) {
      dueSlots.push(slot);
    }
  }

  return {
    localDate: date,
    dueSlots
  };
}

module.exports = {
  normalizeReminderTimes,
  validateTimezone,
  getNextDueAt,
  getDueSlots,
  toUtcBoundsForLocalDate
};
