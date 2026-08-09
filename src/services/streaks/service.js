const { DateTime } = require("luxon");
const { DEFAULT_REMINDER_TIMES } = require("../reminders/constants");
const { coerceSettingsRow } = require("../reminders/status");
const { getLocalNow, validateTimezone } = require("../reminders/time");
const { computeStreak, normalizeLocalDates, addDays } = require("./compute");
const { MILESTONES, RECENT_DAYS_WINDOW } = require("./constants");

const LOCAL_DATES_RPC = "entry_local_dates";
const FALLBACK_PAGE_SIZE = 1000;

let rpcUnavailableLogged = false;

// Rule S-2 / section 7.2: the stored reminder timezone is authoritative because
// ReminderManager re-syncs it on every session start. The header covers a first-ever load,
// before that PUT has landed.
function resolveTimezone({ settingsRow, headerTimezone }) {
  if (validateTimezone(settingsRow?.timezone)) return settingsRow.timezone;
  if (validateTimezone(headerTimezone)) return headerTimezone;
  return "UTC";
}

function resolveReminderTimes(settingsRow) {
  try {
    return coerceSettingsRow(settingsRow || {}).reminderTimes;
  } catch (_error) {
    return [...DEFAULT_REMINDER_TIMES];
  }
}

// Converting to local dates in Postgres keeps the work close to the index and returns a
// single aggregated value, so PostgREST's row cap can never silently truncate history.
async function fetchLocalDatesViaRpc(scopedClient, timezone) {
  const { data, error } = await scopedClient.rpc(LOCAL_DATES_RPC, { tz: timezone });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

// Used until supabase/schema.sql has been applied to the project. Correct, just chattier:
// it pulls timestamps and does the timezone conversion in Node instead.
async function fetchLocalDatesViaScan(scopedClient, timezone) {
  const dates = [];

  for (let from = 0; ; from += FALLBACK_PAGE_SIZE) {
    const { data, error } = await scopedClient
      .from("diary_entries")
      .select("created_at")
      .order("created_at", { ascending: true })
      .range(from, from + FALLBACK_PAGE_SIZE - 1);

    if (error) throw new Error(error.message);

    const rows = data || [];
    for (let i = 0; i < rows.length; i += 1) {
      const localDate = DateTime.fromISO(rows[i].created_at, { zone: "utc" })
        .setZone(timezone)
        .toISODate();
      if (localDate) dates.push(localDate);
    }

    if (rows.length < FALLBACK_PAGE_SIZE) break;
  }

  return dates;
}

async function fetchLocalDates({ scopedClient, timezone }) {
  try {
    return await fetchLocalDatesViaRpc(scopedClient, timezone);
  } catch (error) {
    if (!rpcUnavailableLogged) {
      rpcUnavailableLogged = true;
      console.warn(
        `[streaks] ${LOCAL_DATES_RPC} unavailable (${error.message}); ` +
          "falling back to a client-side scan. Apply supabase/schema.sql to remove this."
      );
    }
    return fetchLocalDatesViaScan(scopedClient, timezone);
  }
}

// Section 8.4: at-risk is deliberately derived from a schedule the user already chose,
// rather than an arbitrary hour, so the nudge never arrives earlier than their own reminders.
function isAtRisk({ state, timezone, reminderTimes, now }) {
  if (state !== "active_pending") return false;
  if (!reminderTimes.length) return false;

  const localNow = getLocalNow(timezone, now);
  const lastSlot = reminderTimes[reminderTimes.length - 1];
  const lastSlotAt = DateTime.fromISO(`${localNow.toISODate()}T${lastSlot}`, { zone: timezone });

  return lastSlotAt.isValid && localNow >= lastSlotAt;
}

function getNextMilestone(current) {
  const next = MILESTONES.find((milestone) => milestone.days > current);
  if (!next) return null;

  return { days: next.days, remaining: next.days - current, name: next.name };
}

function buildRecentDays({ dates, restedDates, todayLocal }) {
  const logged = new Set(dates);
  const rested = new Set(restedDates);
  const recentDays = [];

  for (let offset = RECENT_DAYS_WINDOW - 1; offset >= 0; offset -= 1) {
    const date = addDays(todayLocal, -offset);
    recentDays.push({ date, logged: logged.has(date), rested: rested.has(date) });
  }

  return recentDays;
}

async function getStreakForUser({
  scopedClient,
  settingsRow,
  headerTimezone,
  graceEnabled = true,
  visible = true,
  now = DateTime.utc()
}) {
  const timezone = resolveTimezone({ settingsRow, headerTimezone });
  const todayLocal = getLocalNow(timezone, now).toISODate();

  const dates = normalizeLocalDates(await fetchLocalDates({ scopedClient, timezone }), todayLocal);
  const streak = computeStreak(dates, todayLocal, { graceEnabled });

  const reminderTimes = resolveReminderTimes(settingsRow);
  const state = isAtRisk({ state: streak.state, timezone, reminderTimes, now }) ? "at_risk" : streak.state;

  return {
    current: streak.current,
    longest: streak.longest,
    state,
    todayLogged: streak.todayLogged,
    lastEntryLocalDate: streak.lastEntryLocalDate,
    todayLocalDate: todayLocal,
    timezone,
    graceUsedOn: streak.graceUsedOn,
    nextMilestone: getNextMilestone(streak.current),
    recentDays: buildRecentDays({ dates, restedDates: streak.restedDates, todayLocal }),
    // Opting out hides every streak surface but never stops the streak accruing, because
    // it is derived from history — switching back on restores the true value (rule P-6).
    visible
  };
}

module.exports = {
  getStreakForUser,
  resolveTimezone,
  isAtRisk,
  getNextMilestone,
  buildRecentDays
};
