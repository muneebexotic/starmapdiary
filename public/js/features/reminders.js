const DEFAULT_REMINDER_TIMES = ["01:00:00", "13:00:00", "19:00:00", "23:00:00"];

function isPushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function isIos() {
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function base64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function getTodayFirstSlotDate() {
  const now = new Date();
  const first = DEFAULT_REMINDER_TIMES[0];
  const [hh, mm, ss] = first.split(":").map(Number);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, ss || 0);
}

function shouldShowReminderBanner(status) {
  if (!status || !status.enabled) return false;
  if (status.completedToday) return false;

  const now = new Date();
  const firstSlot = getTodayFirstSlotDate();
  return now >= firstSlot;
}

export class ReminderManager {
  constructor({ api, elements, setStatus }) {
    this.api = api;
    this.elements = elements;
    this.setStatus = setStatus;
    this.status = null;
    this.timers = [];
    this.serviceWorkerRegistration = null;

    this.handleEnablePushClick = this.handleEnablePushClick.bind(this);
  }

  async start() {
    this.stop();
    if (!this.api.token) return;

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    try {
      await this.api.put("/reminders/settings", { timezone });
    } catch (_err) {
      // Non-blocking: user can still use the app without reminders.
    }

    await this.refreshStatus();
    this.attachEvents();
    this.startTimers();
  }

  stop() {
    this.status = null;
    this.detachEvents();
    this.stopTimers();
    this.hideBanner();
  }

  async onEntrySaved() {
    await this.refreshStatus();
  }

  attachEvents() {
    this.elements.enablePushBtn.addEventListener("click", this.handleEnablePushClick);
  }

  detachEvents() {
    this.elements.enablePushBtn.removeEventListener("click", this.handleEnablePushClick);
  }

  startTimers() {
    this.stopTimers();

    this.timers.push(
      window.setInterval(() => this.render(), 60 * 1000),
      window.setInterval(() => this.refreshStatus(), 5 * 60 * 1000)
    );
  }

  stopTimers() {
    while (this.timers.length) {
      window.clearInterval(this.timers.pop());
    }
  }

  async refreshStatus() {
    if (!this.api.token) return;
    try {
      this.status = await this.api.get("/reminders/status");
      this.render();
    } catch (_err) {
      this.hideBanner();
    }
  }

  render() {
    if (!shouldShowReminderBanner(this.status)) {
      this.hideBanner();
      return;
    }

    this.elements.reminderText.textContent = "Today's entry is still pending. Add one entry to stop reminders for today.";
    this.elements.reminderBanner.classList.add("open");

    const pushSupported = isPushSupported();
    const permission = pushSupported ? Notification.permission : "denied";
    const shouldShowEnablePush = pushSupported && permission !== "granted";

    this.elements.enablePushBtn.hidden = !shouldShowEnablePush;
    this.elements.enablePushBtn.disabled = !shouldShowEnablePush;

    const iosNeedsInstallHint = isIos() && !isStandalone();
    this.elements.iosInstallHint.hidden = !iosNeedsInstallHint;
  }

  hideBanner() {
    this.elements.reminderBanner.classList.remove("open");
  }

  async registerServiceWorker() {
    if (this.serviceWorkerRegistration) return this.serviceWorkerRegistration;
    if (!("serviceWorker" in navigator)) {
      throw new Error("Service workers are not supported on this browser.");
    }

    this.serviceWorkerRegistration = await navigator.serviceWorker.register("/sw.js");
    return this.serviceWorkerRegistration;
  }

  async handleEnablePushClick() {
    if (!isPushSupported()) {
      this.setStatus("Push notifications are not supported on this browser.");
      return;
    }

    if (Notification.permission === "denied") {
      this.setStatus("Push permission is blocked in browser settings.");
      return;
    }

    try {
      const registration = await this.registerServiceWorker();

      let permission = Notification.permission;
      if (permission !== "granted") {
        permission = await Notification.requestPermission();
      }

      if (permission !== "granted") {
        this.setStatus("Notification permission not granted.");
        return;
      }

      const keyPayload = await this.api.get("/reminders/push/public-key");
      const applicationServerKey = base64ToUint8Array(keyPayload.publicKey);

      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey
        });
      }

      await this.api.post("/reminders/push/subscribe", { subscription: subscription.toJSON() });
      this.setStatus("Push reminders enabled.");
      this.render();
    } catch (error) {
      this.setStatus(error.message || "Failed to enable push reminders.");
    }
  }
}
