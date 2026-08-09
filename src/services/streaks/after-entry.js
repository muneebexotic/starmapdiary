const { getReminderSettingsRow } = require("../reminders/status");
const { getStreakForUser, getReachedMilestone } = require("./service");
const { getStreakSettings, recordCelebratedMilestone } = require("./settings");

const DEFAULT_SETTINGS = { visible: true, celebratedMilestones: [] };

// Returned inline with a saved entry so the client can play the reward beat without a second
// round trip. Callers must treat a throw here as cosmetic — the entry is already saved.
async function buildStreakAfterEntry({ scopedClient, userId, headerTimezone, graceEnabled, now }) {
  const [settingsRow, streakSettings] = await Promise.all([
    getReminderSettingsRow(scopedClient, userId),
    getStreakSettings(scopedClient, userId).catch(() => DEFAULT_SETTINGS)
  ]);

  const streak = await getStreakForUser({
    scopedClient,
    settingsRow,
    headerTimezone,
    graceEnabled,
    visible: streakSettings.visible,
    ...(now ? { now } : {})
  });

  const reached = getReachedMilestone(streak.current);
  const alreadyCelebrated = streakSettings.celebratedMilestones.includes(reached?.days);

  if (!reached || !streak.visible || alreadyCelebrated) {
    return { ...streak, milestoneReached: null };
  }

  try {
    await recordCelebratedMilestone(scopedClient, userId, streakSettings.celebratedMilestones, reached.days);
  } catch (_error) {
    // If the celebration cannot be recorded, do not show it — it would fire again tomorrow.
    return { ...streak, milestoneReached: null };
  }

  return { ...streak, milestoneReached: reached };
}

module.exports = { buildStreakAfterEntry };
