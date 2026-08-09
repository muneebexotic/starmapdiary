const test = require("node:test");
const assert = require("node:assert/strict");

const { computeStreak, normalizeLocalDates, addDays, daysBetween } = require("../src/services/streaks/compute");

// Builds `count` consecutive dates ending on `endDate` (inclusive), ascending.
function runEndingOn(endDate, count) {
  const dates = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    dates.push(addDays(endDate, -offset));
  }
  return dates;
}

test("date helpers are exact across month and year boundaries", () => {
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29"); // leap year
  assert.equal(addDays("2025-12-31", 1), "2026-01-01");
  assert.equal(daysBetween("2026-03-01", "2026-02-27"), 2);
});

test("normalizeLocalDates sorts, de-duplicates and drops future dates", () => {
  const dates = normalizeLocalDates(
    ["2026-08-03", "2026-08-01", "2026-08-03", "2026-08-99", "2026-08-11", null],
    "2026-08-10"
  );
  assert.deepEqual(dates, ["2026-08-01", "2026-08-03"]);
});

// ---------------------------------------------------------------------------
// QA case 1 + 2: the retroactive requirement (FRD section 4.1)
// ---------------------------------------------------------------------------

test("case 1: 10 consecutive days ending yesterday reads 10 before writing today", () => {
  const dates = runEndingOn("2026-08-09", 10); // 2026-07-31 .. 2026-08-09
  const result = computeStreak(dates, "2026-08-10");

  assert.equal(result.current, 10);
  assert.equal(result.state, "active_pending");
  assert.equal(result.todayLogged, false);
  assert.equal(result.longest, 10);
});

test("case 2: writing today takes the same history to 11", () => {
  const dates = runEndingOn("2026-08-10", 11);
  const result = computeStreak(dates, "2026-08-10");

  assert.equal(result.current, 11);
  assert.equal(result.state, "active_today");
  assert.equal(result.todayLogged, true);
});

test("history alone determines the streak — no launch date is involved", () => {
  // Same 200-day history evaluated on two different "launch" days one year apart.
  const dates = runEndingOn("2026-08-09", 200);
  assert.equal(computeStreak(dates, "2026-08-10").current, 200);
  assert.equal(computeStreak(runEndingOn("2027-08-09", 200), "2027-08-10").current, 200);
});

// ---------------------------------------------------------------------------
// Core definition rules
// ---------------------------------------------------------------------------

test("case 3: a user with no entries is empty, not zero-with-UI", () => {
  const result = computeStreak([], "2026-08-10");
  assert.deepEqual(result, {
    current: 0,
    longest: 0,
    state: "empty",
    todayLogged: false,
    lastEntryLocalDate: null,
    currentRunStart: null,
    graceUsedOn: null,
    restedDates: []
  });
});

test("case 4: several entries on one local date count once", () => {
  const dates = ["2026-08-08", "2026-08-09", "2026-08-09", "2026-08-09", "2026-08-10"];
  assert.equal(computeStreak(dates, "2026-08-10").current, 3);
});

test("a single entry today is a streak of 1", () => {
  const result = computeStreak(["2026-08-10"], "2026-08-10");
  assert.equal(result.current, 1);
  assert.equal(result.longest, 1);
  assert.equal(result.state, "active_today");
});

test("longest is preserved from an old run and never drops below current", () => {
  const oldRun = runEndingOn("2026-01-20", 30);
  const newRun = runEndingOn("2026-08-10", 4);
  const result = computeStreak([...oldRun, ...newRun], "2026-08-10");

  assert.equal(result.current, 4);
  assert.equal(result.longest, 30);
});

// ---------------------------------------------------------------------------
// DST — QA cases 6 and 7
// ---------------------------------------------------------------------------

test("case 6/7: DST transition days count exactly once", () => {
  // US spring-forward 2026-03-08 (23h) and fall-back 2026-11-01 (25h). Local dates are
  // already resolved by this point, so the fold must simply not lose or double them.
  const spring = ["2026-03-06", "2026-03-07", "2026-03-08", "2026-03-09"];
  assert.equal(computeStreak(spring, "2026-03-09").current, 4);

  const fall = ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"];
  assert.equal(computeStreak(fall, "2026-11-02").current, 4);
});

// ---------------------------------------------------------------------------
// Grace / rest days — QA cases 11 to 14
// ---------------------------------------------------------------------------

test("case 11: one missed day with grace available keeps the streak intact", () => {
  // 10 consecutive days ending 2026-08-08, nothing on the 9th, today is the 10th.
  const dates = runEndingOn("2026-08-08", 10);
  const result = computeStreak(dates, "2026-08-10");

  assert.equal(result.state, "grace_used");
  assert.equal(result.current, 10, "a rest day carries the streak over, it does not extend it");
  assert.equal(result.graceUsedOn, "2026-08-09");
  assert.deepEqual(result.restedDates, ["2026-08-09"]);
});

test("case 12: two consecutive missed days break the streak but keep longest", () => {
  const dates = runEndingOn("2026-08-07", 11);
  const result = computeStreak(dates, "2026-08-10");

  assert.equal(result.state, "broken");
  assert.equal(result.current, 0);
  assert.equal(result.longest, 11);
  assert.equal(result.lastEntryLocalDate, "2026-08-07");
});

test("case 13: a second rest day inside the window is refused", () => {
  // Gap at 2026-08-05, then only 4 qualifying days, then another gap at 2026-07-31.
  const dates = [
    ...runEndingOn("2026-07-30", 6), // 07-25 .. 07-30
    // 07-31 missing
    ...runEndingOn("2026-08-04", 4), // 08-01 .. 08-04
    // 08-05 missing
    ...runEndingOn("2026-08-10", 5) // 08-06 .. 08-10
  ];

  const result = computeStreak(dates, "2026-08-10");

  // The 08-05 gap is bridged; the 07-31 gap is only 4 qualifying days later, so the run stops.
  assert.equal(result.state, "active_today");
  assert.equal(result.current, 9);
  assert.deepEqual(result.restedDates, ["2026-08-05"]);
});

test("a second rest day is allowed once the window has passed", () => {
  const dates = [
    ...runEndingOn("2026-07-27", 5), // 07-23 .. 07-27
    // 07-28 missing
    ...runEndingOn("2026-08-04", 7), // 07-29 .. 08-04
    // 08-05 missing
    ...runEndingOn("2026-08-10", 5) // 08-06 .. 08-10
  ];

  const result = computeStreak(dates, "2026-08-10");

  assert.equal(result.current, 17);
  assert.deepEqual(result.restedDates, ["2026-08-05", "2026-07-28"]);
});

test("case 14: grace disabled gives strict consecutive-day semantics", () => {
  const dates = runEndingOn("2026-08-08", 10);

  const strict = computeStreak(dates, "2026-08-10", { graceEnabled: false });
  assert.equal(strict.state, "broken");
  assert.equal(strict.current, 0);
  assert.equal(strict.longest, 10);

  const withGap = [...runEndingOn("2026-08-04", 4), ...runEndingOn("2026-08-10", 5)];
  assert.equal(computeStreak(withGap, "2026-08-10", { graceEnabled: false }).current, 5);
});

test("rest days never chain across two consecutive gaps", () => {
  const dates = [...runEndingOn("2026-08-04", 10), ...runEndingOn("2026-08-10", 4)];
  // 08-05 and 08-06 are both missing.
  const result = computeStreak(dates, "2026-08-10");

  assert.equal(result.current, 4);
  assert.deepEqual(result.restedDates, []);
});

// ---------------------------------------------------------------------------
// Self-healing and integrity — QA cases 15 and 16/17 boundary
// ---------------------------------------------------------------------------

test("case 15: deleting a mid-run entry splits the run on the next read", () => {
  const full = runEndingOn("2026-08-10", 10);
  assert.equal(computeStreak(full, "2026-08-10").current, 10);

  // Remove 2026-08-06 and 2026-08-05 so grace cannot bridge the hole.
  const withHole = full.filter((date) => date !== "2026-08-06" && date !== "2026-08-05");
  assert.equal(computeStreak(withHole, "2026-08-10").current, 4);
});

test("future-dated rows cannot inflate a streak", () => {
  const dates = [...runEndingOn("2026-08-10", 3), "2026-09-20"];
  const result = computeStreak(dates, "2026-08-10");

  assert.equal(result.current, 3);
  assert.equal(result.lastEntryLocalDate, "2026-08-10");
});

test("an invalid todayLocal is rejected rather than silently mis-counted", () => {
  assert.throws(() => computeStreak(["2026-08-10"], "not-a-date"), /YYYY-MM-DD/);
});
