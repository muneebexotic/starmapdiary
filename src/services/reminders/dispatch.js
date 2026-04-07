const { DateTime } = require("luxon");
const { getAdminClient } = require("../../lib/supabase-admin");
const { coerceSettingsRow, hasCompletedEntryToday } = require("./status");
const { getDueSlots } = require("./time");
const { sendPushToSubscriptions } = require("./push");

async function insertDispatchLogUnique(adminClient, row) {
  const { data, error } = await adminClient
    .from("reminder_dispatch_log")
    .insert(row)
    .select("id")
    .single();

  if (!error) {
    return { inserted: true, id: data.id };
  }

  if (error.code === "23505") {
    return { inserted: false, id: null };
  }

  throw new Error(error.message);
}

async function updateDispatchLog(adminClient, id, updates) {
  const { error } = await adminClient
    .from("reminder_dispatch_log")
    .update(updates)
    .eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}

async function getActivePushSubscriptions(adminClient, userId) {
  const { data, error } = await adminClient
    .from("push_subscriptions")
    .select("id,endpoint,p256dh,auth")
    .eq("user_id", userId)
    .eq("enabled", true);

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
}

async function disableStaleSubscriptions(adminClient, endpoints) {
  if (!endpoints.length) return;

  const { error } = await adminClient
    .from("push_subscriptions")
    .update({ enabled: false, updated_at: new Date().toISOString() })
    .in("endpoint", endpoints);

  if (error) {
    throw new Error(error.message);
  }
}

function makePushPayload(localDate) {
  return {
    title: "Star Map Diary Reminder",
    body: `You have not added your entry for ${localDate} yet.`,
    data: { url: "/" }
  };
}

async function processSlot({
  adminClient,
  userId,
  timezone,
  localDate,
  slotTime,
  completedToday,
  subscriptions
}) {
  const nowIso = DateTime.utc().toISO();

  if (completedToday) {
    const inserted = await insertDispatchLogUnique(adminClient, {
      user_id: userId,
      local_date: localDate,
      slot_time: slotTime,
      channel: "web_push",
      status: "skipped_done",
      created_at: nowIso
    });
    return inserted.inserted ? "skipped" : "duplicate";
  }

  if (!subscriptions.length) {
    const inserted = await insertDispatchLogUnique(adminClient, {
      user_id: userId,
      local_date: localDate,
      slot_time: slotTime,
      channel: "web_push",
      status: "skipped_no_permission",
      created_at: nowIso
    });
    return inserted.inserted ? "skipped" : "duplicate";
  }

  const reservation = await insertDispatchLogUnique(adminClient, {
    user_id: userId,
    local_date: localDate,
    slot_time: slotTime,
    channel: "web_push",
    status: "failed",
    error: "Reserved",
    created_at: nowIso
  });

  if (!reservation.inserted) {
    return "duplicate";
  }

  const payload = makePushPayload(localDate);
  const result = await sendPushToSubscriptions({ subscriptions, payload });
  await disableStaleSubscriptions(adminClient, result.staleEndpoints);

  if (result.sentCount > 0) {
    await updateDispatchLog(adminClient, reservation.id, {
      status: "sent",
      error: null
    });
    return "sent";
  }

  const failureMessage =
    result.failedCount > 0 ? result.lastError || "Push send failed." : "No valid subscriptions.";

  await updateDispatchLog(adminClient, reservation.id, {
    status: result.failedCount > 0 ? "failed" : "skipped_no_permission",
    error: failureMessage
  });

  return result.failedCount > 0 ? "failed" : "skipped";
}

async function dispatchDueReminders() {
  const adminClient = getAdminClient();

  const { data: settingsRows, error } = await adminClient
    .from("reminder_settings")
    .select("user_id,timezone,enabled,reminder_times")
    .eq("enabled", true);

  if (error) {
    throw new Error(error.message);
  }

  const counters = {
    scannedUsers: 0,
    sent: 0,
    skipped: 0,
    failed: 0
  };

  const now = DateTime.utc();
  const rows = settingsRows || [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    counters.scannedUsers += 1;

    const { timezone, reminderTimes } = coerceSettingsRow(row);
    const { localDate, dueSlots } = getDueSlots(timezone, reminderTimes, now);
    if (!dueSlots.length) continue;

    const completedToday = await hasCompletedEntryToday({
      client: adminClient,
      userId: row.user_id,
      timezone
    });

    const subscriptions = completedToday
      ? []
      : await getActivePushSubscriptions(adminClient, row.user_id);

    for (let j = 0; j < dueSlots.length; j += 1) {
      const slotTime = dueSlots[j];

      const outcome = await processSlot({
        adminClient,
        userId: row.user_id,
        timezone,
        localDate,
        slotTime,
        completedToday,
        subscriptions
      });

      if (outcome === "sent") counters.sent += 1;
      if (outcome === "skipped") counters.skipped += 1;
      if (outcome === "failed") counters.failed += 1;
    }
  }

  return counters;
}

module.exports = {
  dispatchDueReminders
};
