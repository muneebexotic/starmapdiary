import { API_BASE, AUTH_TOKEN_KEY, ENTRY_MAX_LENGTH } from "./config/constants.js";
import { SENTIMENT_CONFIG } from "./config/sentiment.js";
import { classifySentiment } from "./features/sentiment.js";
import { ReminderManager } from "./features/reminders.js";
import { StreakManager } from "./features/streaks.js";
import { ApiClient } from "./services/api-client.js";
import { formatDate } from "./utils/formatters.js";
import { SceneManager } from "./three/scene-manager.js";

const elements = {
  app: document.getElementById("app"),
  tooltip: document.getElementById("tooltip"),
  deck: document.getElementById("deck"),
  messageLine: document.getElementById("message-line"),
  milestoneLine: document.getElementById("milestone-line"),
  metaRow: document.getElementById("meta-row"),
  metaDate: document.getElementById("meta-date"),
  metaStreak: document.getElementById("meta-streak"),
  metaStreakDot: document.getElementById("meta-streak-dot"),
  input: document.getElementById("entry-input"),
  submitBtn: document.getElementById("submit-btn"),
  focusToggleBtn: document.getElementById("focus-toggle-btn"),
  reminderBanner: document.getElementById("reminder-banner"),
  reminderText: document.getElementById("reminder-text"),
  enablePushBtn: document.getElementById("enable-push-btn"),
  iosInstallHint: document.getElementById("ios-install-hint"),
  authPanel: document.getElementById("auth-panel"),
  emailInput: document.getElementById("email-input"),
  passwordInput: document.getElementById("password-input"),
  authPrimaryBtn: document.getElementById("auth-primary-btn"),
  authModeBtn: document.getElementById("auth-mode-btn"),
  authStatus: document.getElementById("auth-status"),
  logoutBtn: document.getElementById("logout-btn"),
  logScrim: document.getElementById("log-scrim"),
  log: document.getElementById("log"),
  logRange: document.getElementById("log-range"),
  logCalendar: document.getElementById("log-calendar"),
  logCaption: document.getElementById("log-caption"),
  logAccount: document.getElementById("log-account"),
  streakBlock: document.getElementById("streak-block"),
  streakHeadline: document.getElementById("streak-headline"),
  streakSub: document.getElementById("streak-sub"),
  streakNext: document.getElementById("streak-next"),
  streakSwitch: document.getElementById("streak-switch"),
  streakSwitchHint: document.getElementById("streak-switch-hint"),
  streakLive: document.getElementById("streak-live"),
  modal: document.getElementById("modal"),
  closeModalBtn: document.getElementById("close-modal"),
  entryMeta: document.getElementById("entry-meta"),
  entryFull: document.getElementById("entry-full")
};

const api = new ApiClient({ baseUrl: API_BASE, authTokenKey: AUTH_TOKEN_KEY });

const DIM_STORAGE_KEY = "star_map_diary_focus_mode_v1";
const FIRST_RUN_KEY = "star_map_diary_focus_tip_seen_v1";
const MESSAGE_HOLD_MS = 5200;

const state = {
  activeUser: null,
  dimmed: false,
  logOpen: false,
  authMode: "signup"
};

let messageTimer = null;
let firstRunTimers = [];

const scene = new SceneManager({
  container: elements.app,
  tooltip: elements.tooltip,
  onStarSelected: openModalForEntry
});

const reminders = new ReminderManager({
  api,
  elements,
  setStatus: setMessage
});

const streaks = new StreakManager({
  api,
  elements,
  setMessage,
  // The constellation trail is the primary reward; the counts are only the readout.
  trail: {
    setData: (status) => scene.setStreakData(status),
    playDraw: () => scene.playTrailDraw(),
    playSweep: () => scene.playMilestoneSweep()
  },
  onSelectNight: handleSelectNight
});

wireEvents();
bootstrap();

function wireEvents() {
  elements.submitBtn.addEventListener("click", handleSubmit);
  elements.metaRow.addEventListener("click", toggleLog);
  elements.logScrim.addEventListener("click", closeLog);
  elements.focusToggleBtn.addEventListener("click", handleDimToggle);

  elements.authPrimaryBtn.addEventListener("click", handleAuthSubmit);
  elements.authModeBtn.addEventListener("click", toggleAuthMode);
  elements.logoutBtn.addEventListener("click", handleLogout);

  elements.input.addEventListener("input", () => {
    syncEntryInputHeight();
    syncSendState();
  });

  elements.input.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") handleSubmit();
  });

  elements.passwordInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") handleAuthSubmit();
  });

  elements.closeModalBtn.addEventListener("click", closeModal);
  elements.modal.addEventListener("click", (event) => {
    if (event.target === elements.modal) closeModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (elements.modal.classList.contains("open")) return closeModal();
    if (state.logOpen) return closeLog();
    if (state.dimmed) return applyDim(false);
  });

  if (window.visualViewport) {
    const onViewportChange = () => {
      const offset = Math.max(
        0,
        window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop
      );
      document.documentElement.style.setProperty("--keyboard-offset", `${offset}px`);
    };
    window.visualViewport.addEventListener("resize", onViewportChange);
    window.visualViewport.addEventListener("scroll", onViewportChange);
  }
}

async function bootstrap() {
  initializeDim();
  syncEntryInputHeight();
  syncSendState();
  renderMetaDate();

  if (!api.token) {
    setSignedInState(false);
    return;
  }

  try {
    const me = await api.get("/auth/me");
    state.activeUser = me;
    setSignedInState(true);
    await loadEntriesFromServer();
    await reminders.start();
    await streaks.start();
    startFirstRun();
  } catch (_error) {
    api.clearToken();
    state.activeUser = null;
    reminders.stop();
    streaks.stop();
    setSignedInState(false);
    setMessage("That session has expired. Sign in to carry on.");
  }
}

// ── Auth ─────────────────────────────────────────────────────

function toggleAuthMode() {
  state.authMode = state.authMode === "signup" ? "login" : "signup";
  renderAuthMode();
}

function renderAuthMode() {
  const signup = state.authMode === "signup";
  elements.authPrimaryBtn.textContent = signup ? "Begin" : "Return";
  elements.authModeBtn.textContent = signup
    ? "I already have an account"
    : "Create an account instead";
  elements.passwordInput.setAttribute(
    "autocomplete",
    signup ? "new-password" : "current-password"
  );
}

async function handleAuthSubmit() {
  const email = elements.emailInput.value.trim();
  const password = elements.passwordInput.value;

  if (!email || !password) {
    setMessage("An email and a password, and you're in.");
    return;
  }

  const path = state.authMode === "signup" ? "/auth/signup" : "/auth/login";

  try {
    const response = await api.post(path, { email, password }, { auth: false });

    if (!response.session?.access_token) {
      setMessage("Confirm your email, then return here to sign in.");
      return;
    }

    api.token = response.session.access_token;
    state.activeUser = response.user || null;
    elements.passwordInput.value = "";

    setSignedInState(true);
    await loadEntriesFromServer();
    await reminders.start();
    await streaks.start();
    startFirstRun();
  } catch (error) {
    setMessage(error.message);
  }
}

function handleLogout() {
  api.clearToken();
  state.activeUser = null;
  closeLog();
  scene.clearEntries();
  reminders.stop();
  streaks.stop();
  setSignedInState(false);
}

function setSignedInState(signedIn) {
  elements.authPanel.hidden = signedIn;
  elements.deck.hidden = !signedIn;
  elements.focusToggleBtn.hidden = !signedIn;

  const email = state.activeUser?.email;
  elements.authStatus.textContent = signedIn && email ? `Signed in as ${email}` : "Not signed in.";
  elements.logAccount.textContent = email ? `Signed in as ${email}` : "";

  if (!signedIn) {
    renderAuthMode();
    clearMessage();
  }
}

// ── Entries ──────────────────────────────────────────────────

async function loadEntriesFromServer() {
  const payload = await api.get("/entries");

  streaks.clearFilter();
  scene.clearEntries();

  for (let i = 0; i < payload.entries.length; i += 1) {
    scene.addEntry(payload.entries[i]);
  }
}

async function handleSubmit() {
  if (!api.token) return;

  const text = elements.input.value.trim();
  if (!text) return;

  if (text.length > ENTRY_MAX_LENGTH) {
    setMessage(`That's longer than ${ENTRY_MAX_LENGTH} characters — trim it a little.`);
    return;
  }

  const sentiment = classifySentiment(text);
  const createdAt = new Date().toISOString();

  try {
    const response = await api.post("/entries", {
      text,
      sentiment,
      createdAt,
      position: scene.getSuggestedPosition(sentiment, createdAt)
    });

    scene.addEntry(response.entry);
    scene.flareEntry(response.entry.id);

    elements.input.value = "";
    syncEntryInputHeight();
    syncSendState();
    renderMetaDate();

    await reminders.onEntrySaved();
    await streaks.onEntrySaved(response.streak);
  } catch (error) {
    setMessage(error.message);
  }
}

function openModalForEntry(entry) {
  const sentimentMeta = SENTIMENT_CONFIG[entry.sentiment] || SENTIMENT_CONFIG.neutral;
  elements.entryMeta.textContent = `${formatDate(entry.createdAt)} · ${sentimentMeta.label}`;
  elements.entryFull.textContent = entry.text;
  elements.modal.classList.add("open");
  closeLog();
  scene.clearHover();
}

function closeModal() {
  elements.modal.classList.remove("open");
}

// ── The log ──────────────────────────────────────────────────

function toggleLog() {
  if (state.logOpen) closeLog();
  else openLog();
}

function openLog() {
  if (state.logOpen) return;
  state.logOpen = true;
  elements.log.hidden = false;
  elements.logScrim.hidden = false;
  elements.metaRow.setAttribute("aria-expanded", "true");
}

function closeLog() {
  if (!state.logOpen) return;
  state.logOpen = false;
  elements.log.hidden = true;
  elements.logScrim.hidden = true;
  elements.metaRow.setAttribute("aria-expanded", "false");
}

function handleSelectNight(date) {
  if (date) scene.filterByDate(date);
  else scene.clearFilter();
}

// ── Composer ─────────────────────────────────────────────────

function syncEntryInputHeight() {
  const input = elements.input;
  if (!input) return;

  const computed = window.getComputedStyle(input);
  const base = Number.parseFloat(computed.getPropertyValue("--compose-height")) || 60;
  const maxHeight = Number.parseFloat(computed.maxHeight) || 168;

  input.style.height = `${base}px`;
  const next = Math.min(maxHeight, Math.max(base, input.scrollHeight));
  input.style.height = `${next}px`;
  input.style.overflowY = input.scrollHeight > maxHeight ? "auto" : "hidden";
}

function syncSendState() {
  const ready = elements.input.value.trim().length > 0;
  elements.submitBtn.classList.toggle("ready", ready);
  elements.submitBtn.setAttribute("aria-disabled", String(!ready));
}

function renderMetaDate() {
  elements.metaDate.textContent = new Date().toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "long"
  });
}

// ── The single message channel ────────────────────────────────

function setMessage(message) {
  elements.messageLine.textContent = message || "";
  window.clearTimeout(messageTimer);
  if (message) messageTimer = window.setTimeout(clearMessage, MESSAGE_HOLD_MS);
}

function clearMessage() {
  window.clearTimeout(messageTimer);
  elements.messageLine.textContent = "";
}

// ── Hide the interface ───────────────────────────────────────

function initializeDim() {
  applyDim(readFlag(DIM_STORAGE_KEY), { persist: false });
}

function handleDimToggle() {
  applyDim(!state.dimmed);
  endFirstRun();
}

function applyDim(dimmed, { persist = true } = {}) {
  state.dimmed = dimmed;
  document.body.classList.toggle("composer-hidden", dimmed);
  elements.focusToggleBtn.setAttribute("aria-pressed", String(dimmed));
  elements.focusToggleBtn.setAttribute(
    "aria-label",
    dimmed ? "Show the interface" : "Hide the interface and just look"
  );

  if (dimmed) closeLog();
  if (persist) writeFlag(DIM_STORAGE_KEY, dimmed);
}

// ── First run ────────────────────────────────────────────────
// Three beats through the shared message line. Nothing permanent, nothing that can collide.

function startFirstRun() {
  if (readFlag(FIRST_RUN_KEY)) return;

  const touch = navigator.maxTouchPoints > 0;
  firstRunTimers = [
    window.setTimeout(
      () => setMessage(touch ? "Drag to orbit. Pinch to zoom." : "Drag to orbit. Scroll to zoom."),
      900
    ),
    window.setTimeout(
      () =>
        setMessage(
          touch ? "Tap a star to read that night." : "Hover a star to glimpse it. Click to read it."
        ),
      4600
    ),
    window.setTimeout(() => setMessage("Hide everything from the dot up there, and just look."), 8600),
    window.setTimeout(() => endFirstRun(), 14000)
  ];
}

function endFirstRun() {
  while (firstRunTimers.length) window.clearTimeout(firstRunTimers.pop());
  writeFlag(FIRST_RUN_KEY, true);
}

function readFlag(key) {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch (_error) {
    return false;
  }
}

function writeFlag(key, enabled) {
  try {
    if (enabled) window.localStorage.setItem(key, "1");
    else window.localStorage.removeItem(key);
  } catch (_error) {
    // Ignore storage failures in restricted browser modes.
  }
}
