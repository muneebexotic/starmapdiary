self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  const fallback = {
    title: "Star Map Diary Reminder",
    body: "Your entry for today is still pending.",
    data: { url: "/" }
  };

  let payload = fallback;

  try {
    payload = event.data ? { ...fallback, ...event.data.json() } : fallback;
  } catch (_error) {
    payload = fallback;
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      badge: "/favicon.ico",
      icon: "/favicon.ico",
      data: payload.data || { url: "/" }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (let i = 0; i < clients.length; i += 1) {
        const client = clients[i];
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return null;
    })
  );
});
