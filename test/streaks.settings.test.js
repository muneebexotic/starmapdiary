const test = require("node:test");
const assert = require("node:assert/strict");
const { DateTime } = require("luxon");

const { coerceSettingsRow } = require("../src/services/streaks/settings");
const { getStreakForUser } = require("../src/services/streaks/service");
const { addDays } = require("../src/services/streaks/compute");

function runEndingOn(endDate, count) {
  const dates = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) dates.push(addDays(endDate, -offset));
  return dates;
}

const NOW = DateTime.fromISO("2026-08-10T04:00:00.000Z", { zone: "utc" });
const KARACHI = "Asia/Karachi";

test("a missing settings row means visible, not an error", () => {
  assert.deepEqual(coerceSettingsRow(null), { visible: true, celebratedMilestones: [] });
  assert.deepEqual(coerceSettingsRow(undefined), { visible: true, celebratedMilestones: [] });
});

test("only an explicit false hides streaks", () => {
  assert.equal(coerceSettingsRow({ visible: false }).visible, false);
  assert.equal(coerceSettingsRow({ visible: true }).visible, true);
  assert.equal(coerceSettingsRow({}).visible, true);
});

test("celebrated milestones default to an empty list", () => {
  assert.deepEqual(coerceSettingsRow({ celebrated_milestones: [3, 7] }).celebratedMilestones, [3, 7]);
  assert.deepEqual(coerceSettingsRow({ celebrated_milestones: null }).celebratedMilestones, []);
});

test("opting out hides the streak but never stops it accruing", async () => {
  const scopedClient = { rpc: async () => ({ data: runEndingOn("2026-08-09", 10), error: null }) };

  const hidden = await getStreakForUser({
    scopedClient,
    settingsRow: { timezone: KARACHI },
    visible: false,
    now: NOW
  });

  assert.equal(hidden.visible, false);
  assert.equal(hidden.current, 10, "the value is still computed, so re-enabling restores the truth");

  const shown = await getStreakForUser({
    scopedClient,
    settingsRow: { timezone: KARACHI },
    visible: true,
    now: NOW
  });

  assert.equal(shown.visible, true);
  assert.equal(shown.current, 10);
});
