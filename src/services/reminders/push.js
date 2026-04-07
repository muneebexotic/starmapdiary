const webpush = require("web-push");
const { env } = require("../../config/env");

let configured = false;

function ensurePushConfigured() {
  if (configured) return true;
  if (!env.vapidPublicKey || !env.vapidPrivateKey) return false;

  webpush.setVapidDetails(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey);
  configured = true;
  return true;
}

async function sendPushToSubscriptions({ subscriptions, payload }) {
  if (!ensurePushConfigured()) {
    return {
      sentCount: 0,
      failedCount: subscriptions.length,
      staleEndpoints: [],
      lastError: "VAPID keys are not configured."
    };
  }

  let sentCount = 0;
  let failedCount = 0;
  let lastError = "";
  const staleEndpoints = [];

  for (let i = 0; i < subscriptions.length; i += 1) {
    const sub = subscriptions[i];

    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth
          }
        },
        JSON.stringify(payload)
      );
      sentCount += 1;
    } catch (error) {
      failedCount += 1;
      lastError = error?.message || "Failed to send push notification.";
      if (error?.statusCode === 404 || error?.statusCode === 410) {
        staleEndpoints.push(sub.endpoint);
      }
    }
  }

  return {
    sentCount,
    failedCount,
    staleEndpoints,
    lastError
  };
}

module.exports = {
  ensurePushConfigured,
  sendPushToSubscriptions
};
