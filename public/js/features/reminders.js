// Reminders are a switch in the log, not a banner over the sky. The nudge itself lives in the
// composer's placeholder, so nothing here repeats it.

const DEFAULT_REMINDER_TIMES = ["01:00:00", "13:00:00", "19:00:00", "23:00:00"];
const STATUS_REFRESH_MS = 5 * 60 * 1000;

function isPushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent || "");
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function base64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export class ReminderManager {
  constructor({ api, elements, setStatus }) {
    this.api = api;
    this.elements = elements;
    this.setStatus = setStatus;

    this.status = null;
    this.enabled = false;
    this.timer = null;
    this.registration = null;

    this.handleSwitchClick = this.handleSwitchClick.bind(this);
  }

  async start() {
    this.stop();
    if (!this.api.token) return;

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    try {
      await this.api.put("/reminders/settings", { timezone });
    } catch (_error) {
      // Non-blocking: the diary works without reminders.
    }

    this.elements.reminderSwitch.addEventListener("click", this.handleSwitchClick);
    await this.refreshStatus();
    this.timer = window.setInterval(() => this.refreshStatus(), STATUS_REFRESH_MS);
  }

  stop() {
    this.status = null;
    this.enabled = false;
    this.elements.reminderSwitch.removeEventListener("click", this.handleSwitchClick);

    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = null;
    }

    this.elements.iosInstallHint.hidden = true;
  }

  async onEntrySaved() {
    await this.refreshStatus();
  }

  async refreshStatus() {
    if (!this.api.token) return;
    try {
      this.status = await this.api.get("/reminders/status");
    } catch (_error) {
      this.status = null;
    }
    this.render();
  }

  // On = the server has reminders enabled AND this browser is actually subscribed. Either half
  // missing means no notification would arrive, so the switch must not claim otherwise.
  async syncSubscribed() {
    if (!isPushSupported() || Notification.permission !== "granted") return false;
    try {
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      if (!registration) return false;
      return Boolean(await registration.pushManager.getSubscription());
    } catch (_error) {
      return false;
    }
  }

  async render() {
    const serverEnabled = this.status?.enabled !== false;
    this.enabled = serverEnabled && (await this.syncSubscribed());

    this.elements.reminderSwitch.setAttribute("aria-checked", String(this.enabled));
    this.elements.reminderHint.textContent = this.enabled
      ? "One notification, late evening."
      : "Off. Nothing will interrupt you.";

    // Only worth mentioning while they are trying to turn it on.
    this.elements.iosInstallHint.hidden = !(this.enabled === false && isIos() && !isStandalone());
  }

  async handleSwitchClick() {
    if (this.enabled) return this.disable();
    return this.enable();
  }

  async enable() {
    if (!isPushSupported()) {
      this.setStatus("This browser cannot deliver reminders.");
      return;
    }

    if (Notification.permission === "denied") {
      this.setStatus("Notifications are blocked in your browser settings.");
      return;
    }

    if (isIos() && !isStandalone()) {
      this.elements.iosInstallHint.hidden = false;
      this.setStatus("Add Star Map Diary to your Home Screen first.");
      return;
    }

    try {
      this.registration = this.registration || (await navigator.serviceWorker.register("/sw.js"));

      let permission = Notification.permission;
      if (permission !== "granted") permission = await Notification.requestPermission();
      if (permission !== "granted") {
        this.setStatus("Reminders stay off until notifications are allowed.");
        return;
      }

      const keyPayload = await this.api.get("/reminders/push/public-key");
      let subscription = await this.registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await this.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64ToUint8Array(keyPayload.publicKey)
        });
      }

      await this.api.post("/reminders/push/subscribe", { subscription: subscription.toJSON() });
      await this.api.put("/reminders/settings", { enabled: true });
      await this.refreshStatus();
      this.setStatus("Reminders on. One notification, late evening.");
    } catch (error) {
      this.setStatus(error.message || "Could not turn reminders on.");
    }
  }

  async disable() {
    try {
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      const subscription = registration ? await registration.pushManager.getSubscription() : null;

      if (subscription) {
        await this.api.post("/reminders/push/unsubscribe", { endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }

      await this.api.put("/reminders/settings", { enabled: false });
      await this.refreshStatus();
      this.setStatus("Reminders off. Nothing will interrupt you.");
    } catch (error) {
      this.setStatus(error.message || "Could not turn reminders off.");
    }
  }
}

export { DEFAULT_REMINDER_TIMES };
