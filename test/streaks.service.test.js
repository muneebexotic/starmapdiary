const test = require("node:test");
const assert = require("node:assert/strict");
const { DateTime } = require("luxon");

const { getStreakForUser, resolveTimezone, getNextMilestone } = require("../src/services/streaks/service");
const { addDays } = require("../src/services/streaks/compute");
const { RECENT_DAYS_WINDOW } = require("../src/services/streaks/constants");

function runEndingOn(endDate, count) {
  const dates = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    dates.push(addDays(endDate, -offset));
  }
  return dates;
}

// Stands in for the user-scoped Supabase client, which resolves local dates in Postgres.
function rpcClient(localDates) {
  return {
    rpc: async () => ({ data: localDates, error: null })
  };
}

// Stands in for a project where supabase/schema.sql has not been applied yet, so the
// service must fall back to scanning timestamps and converting them in Node.
function scanOnlyClient(timestamps) {
  return {
    rpc: async () => ({ data: null, error: { message: "Could not find the function" } }),
    from() {
      return {
        select() {
          return this;
        },
        order() {
          return this;
        },
        range(from, to) {
          const rows = timestamps.slice(from, to + 1).map((created_at) => ({ created_at }));
          return Promise.resolve({ data: rows, error: null });
        }
      };
    }
  };
}

const KARACHI = "Asia/Karachi"; // UTC+5, no DST

test("resolveTimezone prefers stored settings, then the client header, then UTC", () => {
  assert.equal(resolveTimezone({ settingsRow: { timezone: KARACHI }, headerTimezone: "Europe/Paris" }), KARACHI);
  assert.equal(resolveTimezone({ settingsRow: null, headerTimezone: "Europe/Paris" }), "Europe/Paris");
  assert.equal(resolveTimezone({ settingsRow: { timezone: "Mars/Olympus" }, headerTimezone: "" }), "UTC");
  assert.equal(resolveTimezone({}), "UTC");
});

test("getNextMilestone starts early and stops at the last one", () => {
  assert.deepEqual(getNextMilestone(0), { days: 3, remaining: 3, name: "First Light" });
  assert.deepEqual(getNextMilestone(11), { days: 14, remaining: 3, name: "Fortnight" });
  assert.equal(getNextMilestone(365), null);
});

test("an existing user's real streak is served on day one, in their own timezone", async () => {
  // 09:00 local in Karachi on 2026-08-10; entries on the ten days ending yesterday.
  const now = DateTime.fromISO("2026-08-10T04:00:00.000Z", { zone: "utc" });

  const streak = await getStreakForUser({
    scopedClient: rpcClient(runEndingOn("2026-08-09", 10)),
    settingsRow: { timezone: KARACHI },
    now
  });

  assert.equal(streak.timezone, KARACHI);
  assert.equal(streak.todayLocalDate, "2026-08-10");
  assert.equal(streak.current, 10);
  assert.equal(streak.state, "active_pending");
  assert.equal(streak.todayLogged, false);
  assert.deepEqual(streak.nextMilestone, { days: 14, remaining: 4, name: "Fortnight" });
  assert.equal(streak.visible, true);
});

test("a late-evening entry counts for the user's local day, not the server's", async () => {
  // 23:55 in Karachi on 2026-08-10 is already 2026-08-10T18:55Z — the same instant is
  // still 2026-08-10 in UTC here, but the reverse case is what breaks naive servers, so
  // assert the local date is the one that drives the result.
  const now = DateTime.fromISO("2026-08-10T18:55:00.000Z", { zone: "utc" });

  const streak = await getStreakForUser({
    scopedClient: rpcClient(runEndingOn("2026-08-10", 4)),
    settingsRow: { timezone: "Pacific/Auckland" }, // UTC+12: already 2026-08-11 locally
    now
  });

  assert.equal(streak.todayLocalDate, "2026-08-11");
  assert.equal(streak.state, "active_pending");
  assert.equal(streak.current, 4, "yesterday's run is intact even though today has not started");
});

test("at-risk only appears after the user's own last reminder slot has passed", async () => {
  const dates = runEndingOn("2026-08-09", 6);

  const morning = await getStreakForUser({
    scopedClient: rpcClient(dates),
    settingsRow: { timezone: KARACHI },
    now: DateTime.fromISO("2026-08-10T04:00:00.000Z", { zone: "utc" }) // 09:00 local
  });
  assert.equal(morning.state, "active_pending");

  const lateEvening = await getStreakForUser({
    scopedClient: rpcClient(dates),
    settingsRow: { timezone: KARACHI },
    now: DateTime.fromISO("2026-08-10T18:30:00.000Z", { zone: "utc" }) // 23:30 local
  });
  assert.equal(lateEvening.state, "at_risk");
  assert.equal(lateEvening.current, 6, "at-risk never reduces the count");
});

test("at-risk respects a custom reminder schedule", async () => {
  const streak = await getStreakForUser({
    scopedClient: rpcClient(runEndingOn("2026-08-09", 6)),
    settingsRow: { timezone: KARACHI, reminder_times: ["08:00:00", "12:00:00"] },
    now: DateTime.fromISO("2026-08-10T08:00:00.000Z", { zone: "utc" }) // 13:00 local
  });

  assert.equal(streak.state, "at_risk");
});

test("a written day is never at risk", async () => {
  const streak = await getStreakForUser({
    scopedClient: rpcClient(runEndingOn("2026-08-10", 6)),
    settingsRow: { timezone: KARACHI },
    now: DateTime.fromISO("2026-08-10T18:30:00.000Z", { zone: "utc" })
  });

  assert.equal(streak.state, "active_today");
});

test("recentDays is a today-anchored window with rest days marked", async () => {
  const streak = await getStreakForUser({
    scopedClient: rpcClient(runEndingOn("2026-08-08", 10)), // 2026-08-09 missed
    settingsRow: { timezone: KARACHI },
    now: DateTime.fromISO("2026-08-10T04:00:00.000Z", { zone: "utc" })
  });

  assert.equal(streak.state, "grace_used");
  assert.equal(streak.current, 10);
  assert.equal(streak.graceUsedOn, "2026-08-09");

  assert.equal(streak.recentDays.length, RECENT_DAYS_WINDOW);
  assert.equal(streak.recentDays[RECENT_DAYS_WINDOW - 1].date, "2026-08-10");
  assert.equal(streak.recentDays[RECENT_DAYS_WINDOW - 1].logged, false);

  const restDay = streak.recentDays.find((day) => day.date === "2026-08-09");
  assert.deepEqual(restDay, { date: "2026-08-09", logged: false, rested: true });

  const written = streak.recentDays.find((day) => day.date === "2026-08-08");
  assert.deepEqual(written, { date: "2026-08-08", logged: true, rested: false });
});

test("grace can be disabled without changing anything else", async () => {
  const streak = await getStreakForUser({
    scopedClient: rpcClient(runEndingOn("2026-08-08", 10)),
    settingsRow: { timezone: KARACHI },
    graceEnabled: false,
    now: DateTime.fromISO("2026-08-10T04:00:00.000Z", { zone: "utc" })
  });

  assert.equal(streak.state, "broken");
  assert.equal(streak.current, 0);
  assert.equal(streak.longest, 10, "a break never erases the longest streak");
});

test("falls back to a timestamp scan when the RPC is not deployed", async () => {
  // Same ten local days, expressed as UTC instants at 20:00 local (15:00Z) in Karachi.
  const timestamps = runEndingOn("2026-08-09", 10).map((date) => `${date}T15:00:00.000Z`);

  const streak = await getStreakForUser({
    scopedClient: scanOnlyClient(timestamps),
    settingsRow: { timezone: KARACHI },
    now: DateTime.fromISO("2026-08-10T04:00:00.000Z", { zone: "utc" })
  });

  assert.equal(streak.current, 10);
  assert.equal(streak.state, "active_pending");
});

test("a user with no entries reports empty rather than a zero streak", async () => {
  const streak = await getStreakForUser({
    scopedClient: rpcClient([]),
    settingsRow: { timezone: KARACHI },
    now: DateTime.fromISO("2026-08-10T04:00:00.000Z", { zone: "utc" })
  });

  assert.equal(streak.state, "empty");
  assert.equal(streak.current, 0);
  assert.equal(streak.longest, 0);
  assert.equal(streak.lastEntryLocalDate, null);
});
