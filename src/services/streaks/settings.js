const TABLE = "streak_settings";
const COLUMNS = "user_id,visible,celebrated_milestones";

// The opt-out is presentation state, so a missing row means "default on" rather than an
// error, and a read failure must never take the streak endpoint down with it.
function coerceSettingsRow(row) {
  return {
    visible: row?.visible !== false,
    celebratedMilestones: Array.isArray(row?.celebrated_milestones) ? row.celebrated_milestones : []
  };
}

async function getStreakSettings(scopedClient, userId) {
  const { data, error } = await scopedClient
    .from(TABLE)
    .select(COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return coerceSettingsRow(data);
}

async function setStreakVisibility(scopedClient, userId, visible) {
  const { data, error } = await scopedClient
    .from(TABLE)
    .upsert(
      {
        user_id: userId,
        visible,
        updated_at: new Date().toISOString()
      },
      { onConflict: "user_id" }
    )
    .select(COLUMNS)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return coerceSettingsRow(data);
}

module.exports = {
  coerceSettingsRow,
  getStreakSettings,
  setStreakVisibility
};
