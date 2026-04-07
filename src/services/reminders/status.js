const { DateTime } = require("luxon");
const { DEFAULT_REMINDER_TIMES } = require("./constants");
const { getNextDueAt, normalizeReminderTimes, toUtcBoundsForLocalDate, validateTimezone } = require("./time");

async function hasCompletedEntryToday({ client, userId, timezone, now = DateTime.utc(), scoped = false }) {
  const localDate = now.setZone(timezone).toISODate();
  const { startUtcIso, endUtcIso } = toUtcBoundsForLocalDate(timezone, localDate);

  let query = client
    .from("diary_entries")
    .select("id")
    .gte("created_at", startUtcIso)
    .lt("created_at", endUtcIso)
    .limit(1);

  if (!scoped) {
    query = query.eq("user_id", userId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  return Array.isArray(data) && data.length > 0;
}

function coerceSettingsRow(row) {
  const timezone = validateTimezone(row?.timezone) ? row.timezone : "UTC";
  const enabled = row?.enabled !== false;
  const reminderTimes = normalizeReminderTimes(row?.reminder_times || DEFAULT_REMINDER_TIMES);

  return {
    timezone,
    enabled,
    reminderTimes
  };
}

async function computeReminderStatus({ scopedClient, userId, settingsRow }) {
  const { timezone, enabled, reminderTimes } = coerceSettingsRow(settingsRow);
  const completedToday = await hasCompletedEntryToday({
    client: scopedClient,
    userId,
    timezone,
    scoped: true
  });

  const nextDueAt = !enabled || completedToday ? null : getNextDueAt(timezone, reminderTimes);

  return {
    completedToday,
    nextDueAt,
    timezone,
    enabled
  };
}

module.exports = {
  hasCompletedEntryToday,
  computeReminderStatus,
  coerceSettingsRow
};
