const test = require("node:test");
const assert = require("node:assert/strict");
const { DateTime } = require("luxon");

const { computeStreak, addDays } = require("../src/services/streaks/compute");
const { getReachedMilestone } = require("../src/services/streaks/service");
const { buildStreakAfterEntry } = require("../src/services/streaks/after-entry");

const TODAY = "2026-08-10";
const NOW = DateTime.fromISO("2026-08-10T04:00:00.000Z", { zone: "utc" }); // 09:00 in Karachi
const KARACHI = "Asia/Karachi";

function runEndingOn(endDate, count) {
  const dates = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) dates.push(addDays(endDate, -offset));
  return dates;
}

function fakeClient({ localDates, streakSettingsRow = null, upsertFails = false }) {
  const upserts = [];

  return {
    upserts,
    rpc: async () => ({ data: localDates, error: null }),
    from(table) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () =>
          table === "reminder_settings"
            ? { data: { timezone: KARACHI }, error: null }
            : { data: streakSettingsRow, error: null },
        upsert: (payload) => {
          upserts.push({ table, payload });
          return Promise.resolve(
            upsertFails ? { error: { message: "write failed" } } : { data: payload, error: null }
          );
        }
      };
      return builder;
    }
  };
}

// ---------------------------------------------------------------------------
// currentRunStart — the trail needs to know where the live run begins
// ---------------------------------------------------------------------------

test("currentRunStart marks the first day of the live run", () => {
  const result = computeStreak(runEndingOn("2026-08-09", 10), TODAY);
  assert.equal(result.currentRunStart, "2026-07-31");
  assert.equal(result.current, 10);
});

test("currentRunStart ignores older runs", () => {
  const dates = [...runEndingOn("2026-06-10", 30), ...runEndingOn(TODAY, 4)];
  const result = computeStreak(dates, TODAY);

  assert.equal(result.currentRunStart, "2026-08-07");
  assert.equal(result.longest, 30, "the old run still holds the record");
});

test("currentRunStart spans a bridged rest day", () => {
  const dates = [...runEndingOn("2026-08-05", 6), ...runEndingOn(TODAY, 4)]; // 2026-08-06 missed
  const result = computeStreak(dates, TODAY);

  assert.equal(result.currentRunStart, "2026-07-31");
  assert.deepEqual(result.restedDates, ["2026-08-06"]);
});

test("currentRunStart stops at a gap two rest days cannot cover", () => {
  const dates = [...runEndingOn("2026-08-04", 6), ...runEndingOn(TODAY, 4)]; // 08-05 and 08-06 missed
  const result = computeStreak(dates, TODAY);

  assert.equal(result.currentRunStart, "2026-08-07", "rest days never chain");
  assert.equal(result.current, 4);
});

test("a broken streak has no run start", () => {
  assert.equal(computeStreak(runEndingOn("2026-07-20", 5), TODAY).currentRunStart, null);
  assert.equal(computeStreak([], TODAY).currentRunStart, null);
});

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

test("milestones match exactly, so long-standing history is not retro-celebrated", () => {
  assert.deepEqual(getReachedMilestone(3), { days: 3, name: "First Light" });
  assert.deepEqual(getReachedMilestone(14), { days: 14, name: "Fortnight" });
  assert.equal(getReachedMilestone(13), null);
  assert.equal(getReachedMilestone(201), null, "crossing 200 in the past is not a celebration today");
});

test("reaching a milestone fires it once and records it", async () => {
  const client = fakeClient({ localDates: runEndingOn(TODAY, 7) });

  const result = await buildStreakAfterEntry({
    scopedClient: client,
    userId: "user-1",
    graceEnabled: true,
    now: NOW
  });

  assert.equal(result.current, 7);
  assert.deepEqual(result.milestoneReached, { days: 7, name: "The Arc" });
  assert.equal(client.upserts.length, 1);
  assert.deepEqual(client.upserts[0].payload.celebrated_milestones, [7]);
});

test("case 24: reaching the same milestone again does not celebrate twice", async () => {
  const client = fakeClient({
    localDates: runEndingOn(TODAY, 7),
    streakSettingsRow: { visible: true, celebrated_milestones: [3, 7] }
  });

  const result = await buildStreakAfterEntry({
    scopedClient: client,
    userId: "user-1",
    graceEnabled: true,
    now: NOW
  });

  assert.equal(result.current, 7);
  assert.equal(result.milestoneReached, null);
  assert.equal(client.upserts.length, 0, "nothing to record");
});

test("an ordinary day reports no milestone", async () => {
  const client = fakeClient({ localDates: runEndingOn(TODAY, 5) });

  const result = await buildStreakAfterEntry({
    scopedClient: client,
    userId: "user-1",
    graceEnabled: true,
    now: NOW
  });

  assert.equal(result.milestoneReached, null);
  assert.equal(client.upserts.length, 0);
});

test("hidden streaks never celebrate", async () => {
  const client = fakeClient({
    localDates: runEndingOn(TODAY, 7),
    streakSettingsRow: { visible: false, celebrated_milestones: [] }
  });

  const result = await buildStreakAfterEntry({
    scopedClient: client,
    userId: "user-1",
    graceEnabled: true,
    now: NOW
  });

  assert.equal(result.visible, false);
  assert.equal(result.milestoneReached, null);
  assert.equal(client.upserts.length, 0, "and the milestone stays unspent for when they switch back on");
});

test("a milestone that cannot be recorded is not shown", async () => {
  // Otherwise it would fire again on the next entry, and the one after that.
  const client = fakeClient({ localDates: runEndingOn(TODAY, 7), upsertFails: true });

  const result = await buildStreakAfterEntry({
    scopedClient: client,
    userId: "user-1",
    graceEnabled: true,
    now: NOW
  });

  assert.equal(result.current, 7);
  assert.equal(result.milestoneReached, null);
});

test("the post-entry payload carries what the trail needs", async () => {
  const client = fakeClient({ localDates: runEndingOn(TODAY, 7) });

  const result = await buildStreakAfterEntry({
    scopedClient: client,
    userId: "user-1",
    graceEnabled: true,
    now: NOW
  });

  assert.equal(result.currentRunStart, "2026-08-04");
  assert.deepEqual(result.restedDates, []);
  assert.equal(result.todayLocalDate, TODAY);
  assert.equal(result.visible, true);
  assert.ok(Array.isArray(result.recentDays));
});
