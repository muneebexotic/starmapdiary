const { GRACE_WINDOW_DAYS } = require("./constants");

const MS_PER_DAY = 86400000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// This module is intentionally dependency-free and timezone-free.
//
// By the time dates reach here they are already *local calendar dates* in the user's own
// timezone (rule S-2), so all that is left is calendar arithmetic. Doing it on UTC epoch
// days keeps every day exactly 24h long, which is what makes DST transitions a non-event
// here rather than the classic off-by-one (QA cases 6 and 7 in docs/streaks-frd.md).

function toEpochDay(localDate) {
  const match = DATE_PATTERN.exec(String(localDate || ""));
  if (!match) return null;

  const [, year, month, day] = match;
  const utcMs = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const roundTrip = new Date(utcMs);

  // Rejects impossible dates that Date.UTC would otherwise roll over (e.g. 2026-02-31).
  if (
    roundTrip.getUTCFullYear() !== Number(year) ||
    roundTrip.getUTCMonth() !== Number(month) - 1 ||
    roundTrip.getUTCDate() !== Number(day)
  ) {
    return null;
  }

  return utcMs / MS_PER_DAY;
}

function fromEpochDay(epochDay) {
  return new Date(epochDay * MS_PER_DAY).toISOString().slice(0, 10);
}

function daysBetween(laterDate, earlierDate) {
  return toEpochDay(laterDate) - toEpochDay(earlierDate);
}

function addDays(localDate, amount) {
  return fromEpochDay(toEpochDay(localDate) + amount);
}

// Sorted, de-duplicated, valid, and never ahead of today. Future-dated rows should not
// exist once entry timestamps are clamped server-side, but legacy rows written before that
// clamp could be skewed, and they must not be able to inflate a streak.
function normalizeLocalDates(localDates, todayLocal) {
  const todayEpoch = toEpochDay(todayLocal);
  const seen = new Set();

  for (let i = 0; i < (localDates || []).length; i += 1) {
    const value = localDates[i];
    const epochDay = toEpochDay(value);
    if (epochDay === null || epochDay > todayEpoch) continue;
    seen.add(epochDay);
  }

  return [...seen].sort((a, b) => a - b).map(fromEpochDay);
}

function canBridge({ qualifyingDaysSeen, lastBridgeAt, graceEnabled }) {
  if (!graceEnabled) return false;
  if (lastBridgeAt === null) return true;
  return qualifyingDaysSeen - lastBridgeAt >= GRACE_WINDOW_DAYS;
}

// Longest run over all history, scanned forward under the same one-gap-per-window rule.
// Forward and backward scans can disagree on which gap consumes the rest day in pathological
// histories, so the caller takes max(longest, current) to keep rule S-5 (longest is never
// less than current, and never decreases) true by construction.
function computeLongest(dates, graceEnabled) {
  let longest = 0;
  let runLength = 0;
  let lastBridgeAt = null;

  for (let i = 0; i < dates.length; i += 1) {
    if (i === 0) {
      runLength = 1;
      lastBridgeAt = null;
    } else {
      const gap = daysBetween(dates[i], dates[i - 1]);

      if (gap === 1) {
        runLength += 1;
      } else if (gap === 2 && canBridge({ qualifyingDaysSeen: runLength, lastBridgeAt, graceEnabled })) {
        lastBridgeAt = runLength;
        runLength += 1;
      } else {
        runLength = 1;
        lastBridgeAt = null;
      }
    }

    if (runLength > longest) longest = runLength;
  }

  return longest;
}

/**
 * Fold a user's qualifying local dates into a streak.
 *
 * @param {string[]} localDates   Local calendar dates (YYYY-MM-DD) with at least one entry.
 *                                Order and duplicates do not matter.
 * @param {string} todayLocal     Today's local calendar date in the user's timezone.
 * @param {object} [options]
 * @param {boolean} [options.graceEnabled=true]  Rule R-6.
 */
function computeStreak(localDates, todayLocal, { graceEnabled = true } = {}) {
  if (toEpochDay(todayLocal) === null) {
    throw new Error("todayLocal must be a YYYY-MM-DD date.");
  }

  const dates = normalizeLocalDates(localDates, todayLocal);

  if (dates.length === 0) {
    return {
      current: 0,
      longest: 0,
      state: "empty",
      todayLogged: false,
      lastEntryLocalDate: null,
      graceUsedOn: null,
      restedDates: []
    };
  }

  const lastEntryLocalDate = dates[dates.length - 1];
  const gapToToday = daysBetween(todayLocal, lastEntryLocalDate);
  const longest = computeLongest(dates, graceEnabled);

  // Rules S-3 and S-4: today being unwritten never reduces the streak. It only breaks once a
  // whole local day has passed with nothing in it — and even then a rest day may bridge it.
  let state;
  let trailingBridge = false;

  if (gapToToday === 0) {
    state = "active_today";
  } else if (gapToToday === 1) {
    state = "active_pending";
  } else if (gapToToday === 2 && graceEnabled) {
    state = "grace_used";
    trailingBridge = true;
  } else {
    state = "broken";
  }

  if (state === "broken") {
    return {
      current: 0,
      longest,
      state,
      todayLogged: false,
      lastEntryLocalDate,
      graceUsedOn: null,
      restedDates: []
    };
  }

  const restedDates = [];
  let current = 1;
  let lastBridgeAt = null;

  if (trailingBridge) {
    restedDates.push(addDays(lastEntryLocalDate, 1));
    lastBridgeAt = 0;
  }

  for (let i = dates.length - 1; i > 0; ) {
    const gap = daysBetween(dates[i], dates[i - 1]);

    if (gap === 1) {
      i -= 1;
      current += 1;
      continue;
    }

    if (gap === 2 && canBridge({ qualifyingDaysSeen: current, lastBridgeAt, graceEnabled })) {
      restedDates.push(addDays(dates[i - 1], 1));
      lastBridgeAt = current;
      i -= 1;
      current += 1;
      continue;
    }

    break;
  }

  return {
    current,
    longest: Math.max(longest, current),
    state,
    todayLogged: state === "active_today",
    lastEntryLocalDate,
    graceUsedOn: restedDates.length > 0 ? restedDates[0] : null,
    restedDates
  };
}

module.exports = {
  computeStreak,
  normalizeLocalDates,
  toEpochDay,
  fromEpochDay,
  daysBetween,
  addDays
};
