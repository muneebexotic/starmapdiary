import {
  API_BASE,
  AUTH_REFRESH_TOKEN_KEY,
  AUTH_TOKEN_KEY,
  ENTRY_MAX_LENGTH
} from "./config/constants.js";
import { SENTIMENT_CONFIG } from "./config/sentiment.js";
import { classifySentiment } from "./features/sentiment.js";
import { ReminderManager } from "./features/reminders.js";
import { StreakManager } from "./features/streaks.js";
import { ApiClient } from "./services/api-client.js";
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
  reminderSwitch: document.getElementById("reminder-switch"),
  reminderHint: document.getElementById("reminder-hint"),
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
  reader: document.getElementById("reader"),
  readerStar: document.getElementById("reader-star"),
  readerLeader: document.getElementById("reader-leader"),
  readerColumn: document.getElementById("reader-column"),
  readerMood: document.getElementById("reader-mood"),
  readerWhen: document.getElementById("reader-when"),
  readerText: document.getElementById("reader-text"),
  readerClose: document.getElementById("reader-close"),
  readerPrev: document.getElementById("reader-prev"),
  readerNext: document.getElementById("reader-next")
};

const api = new ApiClient({
  baseUrl: API_BASE,
  authTokenKey: AUTH_TOKEN_KEY,
  refreshTokenKey: AUTH_REFRESH_TOKEN_KEY,
  // Fires only once a refresh has been refused, so reaching here really is the end of the session.
  onAuthLost: () => endSession()
});

const DIM_STORAGE_KEY = "star_map_diary_focus_mode_v1";
const FIRST_RUN_KEY = "star_map_diary_focus_tip_seen_v1";
const MESSAGE_HOLD_MS = 5200;

const state = {
  activeUser: null,
  reading: null,
  dimmed: false,
  logOpen: false,
  authMode: "signup"
};

let messageTimer = null;
let firstRunTimers = [];

const scene = new SceneManager({
  container: elements.app,
  tooltip: elements.tooltip,
  onStarSelected: openReader
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

  elements.readerClose.addEventListener("click", closeReader);
  elements.readerPrev.addEventListener("click", () => stepReader(-1));
  elements.readerNext.addEventListener("click", () => stepReader(1));
  // Tapping the sky closes the reader.
  elements.reader.addEventListener("click", (event) => {
    if (event.target === elements.reader) closeReader();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (state.reading) return closeReader();
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

  // An expired access token is no longer a reason to stay out: the refresh token alone is
  // enough for the client to renew on the first authed call below.
  if (!api.token && !api.refreshToken) {
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
    syncPlaceholder(Boolean(streaks.status?.todayLogged));
    startFirstRun();
  } catch (_error) {
    endSession();
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

    api.setSession(response.session);
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
  endSession();
}

// Signing out and being signed out land in the same place; only the message differs.
function endSession() {
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
    syncPlaceholder(true);
  } catch (error) {
    setMessage(error.message);
  }
}

// ── Reading a night ──────────────────────────────────────────

function openReader(entry) {
  const mood = SENTIMENT_CONFIG[entry.sentiment] || SENTIMENT_CONFIG.neutral;
  const when = new Date(entry.createdAt);

  state.reading = entry;
  closeLog();
  scene.clearHover();
  // The sky holds still while a night is being read.
  scene.setDrift(false);

  elements.readerMood.style.background = mood.color;
  elements.readerMood.style.boxShadow = `0 0 12px ${mood.color}`;
  elements.readerWhen.textContent = `${when.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long"
  })} · ${when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} · ${mood.label}`;
  elements.readerText.textContent = entry.text;

  const nights = scene.getEntriesChronological();
  const index = nights.findIndex((candidate) => candidate.id === entry.id);
  elements.readerPrev.disabled = index <= 0;
  elements.readerNext.disabled = index < 0 || index >= nights.length - 1;

  elements.reader.hidden = false;
  positionReader(entry, mood);
  elements.readerColumn.focus?.({ preventScroll: true });
}

// Desktop pins the text beside the star with a hairline between them; phone anchors it to the
// bottom edge. Either way the star you touched stays lit.
function positionReader(entry, mood) {
  const pos = scene.getEntryScreenPosition(entry.id);
  const star = elements.readerStar;
  const leader = elements.readerLeader;
  const column = elements.readerColumn;

  if (!pos || !pos.onScreen) {
    star.classList.remove("visible");
    leader.style.width = "0px";
    column.style.left = "";
    column.style.top = "";
    return;
  }

  star.style.left = `${pos.x}px`;
  star.style.top = `${pos.y}px`;
  star.style.background =
    `radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.5) 9%, ` +
    `${mood.color}70 30%, transparent 68%)`;
  star.classList.add("visible");

  if (window.innerWidth < 900) {
    leader.style.width = "0px";
    column.style.left = "";
    column.style.top = "";
    return;
  }

  const width = 440;
  const gap = 130;
  const toRight = pos.x < window.innerWidth / 2;
  const rawLeft = toRight ? pos.x + gap : pos.x - gap - width;
  const left = Math.max(24, Math.min(rawLeft, window.innerWidth - width - 24));
  const top = Math.max(24, Math.min(pos.y - 120, window.innerHeight - 280));

  column.style.left = `${left}px`;
  column.style.top = `${top}px`;

  const from = toRight ? pos.x + 10 : left + width;
  const to = toRight ? left : pos.x - 10;
  leader.classList.toggle("to-left", !toRight);
  leader.style.left = `${Math.min(from, to)}px`;
  leader.style.top = `${pos.y}px`;
  leader.style.width = `${Math.max(0, Math.abs(to - from))}px`;
}

function stepReader(direction) {
  if (!state.reading) return;
  const nights = scene.getEntriesChronological();
  const index = nights.findIndex((candidate) => candidate.id === state.reading.id);
  const next = nights[index + direction];
  if (next) openReader(next);
}

function closeReader() {
  if (!state.reading) return;
  state.reading = null;
  elements.reader.hidden = true;
  elements.readerStar.classList.remove("visible");
  scene.setDrift(true);
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

// The placeholder is the nudge: rule N-2 of the redesign, replacing the old banner copy.
function syncPlaceholder(todayLogged) {
  elements.input.placeholder = todayLogged ? "Another line?" : "Tonight is still open.";
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
