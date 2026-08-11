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
import { parseAuthHandoff } from "./services/auth-handoff.js";
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
  authBlurb: document.getElementById("auth-blurb"),
  authForm: document.getElementById("auth-form"),
  emailInput: document.getElementById("email-input"),
  passwordInput: document.getElementById("password-input"),
  passwordHint: document.getElementById("password-hint"),
  authPrimaryBtn: document.getElementById("auth-primary-btn"),
  authModeBtn: document.getElementById("auth-mode-btn"),
  authStatus: document.getElementById("auth-status"),
  authCheck: document.getElementById("auth-check"),
  authCheckEmail: document.getElementById("auth-check-email"),
  authCheckOpen: document.getElementById("auth-check-open"),
  authResendBtn: document.getElementById("auth-resend-btn"),
  authBackBtn: document.getElementById("auth-back-btn"),
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
// Matches "Minimum interval per user" in the project's SMTP settings. Counting down to zero any
// sooner would arm the button while Supabase is still refusing to send, which reads as a bug in
// the app rather than a wait. Raise both together or neither.
const RESEND_COOLDOWN_SECONDS = 60;

// Where a recognised provider keeps its inbox. The gap between "we sent a link" and reading it
// is where sign-ups are lost, so the ones we know get a door rather than an instruction.
const INBOX_LINKS = {
  "gmail.com": { label: "Open Gmail", url: "https://mail.google.com/mail/u/0/" },
  "googlemail.com": { label: "Open Gmail", url: "https://mail.google.com/mail/u/0/" },
  "outlook.com": { label: "Open Outlook", url: "https://outlook.live.com/mail/0/" },
  "hotmail.com": { label: "Open Outlook", url: "https://outlook.live.com/mail/0/" },
  "live.com": { label: "Open Outlook", url: "https://outlook.live.com/mail/0/" },
  "yahoo.com": { label: "Open Yahoo Mail", url: "https://mail.yahoo.com/" },
  "icloud.com": { label: "Open iCloud Mail", url: "https://www.icloud.com/mail/" },
  "me.com": { label: "Open iCloud Mail", url: "https://www.icloud.com/mail/" },
  "proton.me": { label: "Open Proton Mail", url: "https://mail.proton.me/" },
  "protonmail.com": { label: "Open Proton Mail", url: "https://mail.proton.me/" }
};

const state = {
  activeUser: null,
  reading: null,
  dimmed: false,
  logOpen: false,
  signedIn: false,
  authMode: "signup",
  // "form" while there is something to type, "check" while there is a link to go and open.
  authView: "form",
  authBusy: false,
  pendingEmail: ""
};

let messageTimer = null;
let firstRunTimers = [];
let resendTimer = null;
let resendRemaining = 0;

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
  elements.authResendBtn.addEventListener("click", handleResend);
  elements.authBackBtn.addEventListener("click", returnToAuthForm);
  elements.logoutBtn.addEventListener("click", handleLogout);

  elements.input.addEventListener("input", () => {
    syncEntryInputHeight();
    syncSendState();
  });

  elements.input.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") handleSubmit();
  });

  for (const field of [elements.emailInput, elements.passwordInput]) {
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter") handleAuthSubmit();
    });
  }

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

  // A confirmation link lands back here carrying the finished session. Reading it before
  // anything else is what turns "now go and sign in" into simply being signed in.
  const handoff = readAuthHandoff();
  if (handoff?.session) api.setSession(handoff.session);

  // An expired access token is no longer a reason to stay out: the refresh token alone is
  // enough for the client to renew on the first authed call below.
  if (!api.token && !api.refreshToken) {
    setSignedInState(false);
    if (handoff?.error) setMessage(handoff.error, { alert: true });
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

    const justConfirmed = handoff?.type === "signup";
    if (justConfirmed) setMessage("Email confirmed. This sky is yours — start it tonight.");
    // Otherwise the first tip would wipe that line about a second after it appeared.
    startFirstRun({ delay: justConfirmed ? MESSAGE_HOLD_MS : 0 });
  } catch (_error) {
    endSession();
    setMessage("That session has expired. Sign in to carry on.", { alert: true });
  }
}

// ── Auth ─────────────────────────────────────────────────────

// The fragment is read once and wiped from the address bar, so a live session doesn't linger in
// history or travel with a copied link.
function readAuthHandoff() {
  const handoff = parseAuthHandoff(window.location.hash);
  if (handoff) {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  return handoff;
}

function toggleAuthMode() {
  state.authMode = state.authMode === "signup" ? "login" : "signup";
  // The address carries over — retyping it is pure friction — but the password does not: it was
  // typed against the other mode's rules, and a stale one only buys a confusing failure.
  elements.passwordInput.value = "";
  renderAuth();
  clearMessage();
  // Land on whichever field is still empty, so switching modes doesn't raise a phone keyboard
  // over a field that has nothing left to type into it.
  (elements.emailInput.value.trim() ? elements.passwordInput : elements.emailInput).focus();
}

function renderAuth() {
  const waiting = state.authView === "check";
  const signup = state.authMode === "signup";

  elements.authBlurb.hidden = waiting;
  elements.authForm.hidden = waiting;
  elements.authCheck.hidden = !waiting;
  elements.authModeBtn.hidden = waiting;

  elements.authPrimaryBtn.textContent = signup ? "Begin" : "Return";
  elements.passwordHint.hidden = !signup;
  elements.authModeBtn.textContent = signup
    ? "I already have an account"
    : "Create an account instead";
  elements.passwordInput.setAttribute(
    "autocomplete",
    signup ? "new-password" : "current-password"
  );
}

async function handleAuthSubmit() {
  if (state.authBusy || state.authView === "check") return;

  const email = elements.emailInput.value.trim();
  const password = elements.passwordInput.value;

  if (!email || !password) {
    setMessage("An email and a password, and you're in.", { alert: true });
    return;
  }

  const signup = state.authMode === "signup";
  setAuthBusy(true, signup ? "Sending the link…" : "Returning…");

  try {
    const response = await api.post(
      signup ? "/auth/signup" : "/auth/login",
      { email, password },
      { auth: false }
    );

    // No session means Supabase is holding the account until the address is confirmed.
    if (!response.session?.access_token) {
      showCheckInbox(response.email || email);
      return;
    }

    api.setSession(response.session);
    state.activeUser = response.user || null;
    elements.passwordInput.value = "";

    setSignedInState(true);
    await loadEntriesFromServer();
    await reminders.start();
    await streaks.start();
    syncPlaceholder(Boolean(streaks.status?.todayLogged));
    startFirstRun();
  } catch (error) {
    // An unconfirmed address isn't a failed sign-in; it's a sign-up that never finished. Sending
    // it to the same screen as a wrong password would strand someone whose password is correct.
    if (error.payload?.needsConfirmation) {
      showCheckInbox(error.payload.email || email);
      return;
    }
    setMessage(error.message, { alert: true });
  } finally {
    setAuthBusy(false);
  }
}

function setAuthBusy(busy, label) {
  state.authBusy = busy;
  elements.authPrimaryBtn.setAttribute("aria-disabled", String(busy));
  if (busy && label) elements.authPrimaryBtn.textContent = label;
  else renderAuth();
}

// ── Waiting on the inbox ─────────────────────────────────────

function showCheckInbox(email) {
  state.authView = "check";
  state.pendingEmail = email;
  // The password has done its work, and this screen can sit open for a while.
  elements.passwordInput.value = "";

  elements.authCheckEmail.textContent = email;

  const inbox = INBOX_LINKS[email.split("@")[1]?.toLowerCase()];
  elements.authCheckOpen.hidden = !inbox;
  if (inbox) {
    elements.authCheckOpen.textContent = inbox.label;
    elements.authCheckOpen.href = inbox.url;
  }

  renderAuth();
  clearMessage();
  // A mail has just gone out, so the wait starts now rather than on the first press.
  startResendCooldown();
}

function startResendCooldown() {
  window.clearInterval(resendTimer);
  resendRemaining = RESEND_COOLDOWN_SECONDS;
  renderResendButton();

  resendTimer = window.setInterval(() => {
    resendRemaining -= 1;
    renderResendButton();
    if (resendRemaining <= 0) window.clearInterval(resendTimer);
  }, 1000);
}

function renderResendButton() {
  const waiting = resendRemaining > 0;
  elements.authResendBtn.textContent = waiting
    ? `Send it again in ${resendRemaining}s`
    : "Send it again";
  elements.authResendBtn.setAttribute("aria-disabled", String(waiting));
}

async function handleResend() {
  if (resendRemaining > 0 || !state.pendingEmail) return;

  try {
    await api.post("/auth/resend-confirmation", { email: state.pendingEmail }, { auth: false });
    setMessage("Sent again. Give it a minute.");
    startResendCooldown();
  } catch (error) {
    setMessage(error.message, { alert: true });
  }
}

function returnToAuthForm() {
  window.clearInterval(resendTimer);
  resendRemaining = 0;
  state.authView = "form";

  // The likeliest reason to be back here is a typo worth correcting, not an address worth
  // retyping — so it comes back selected.
  if (state.pendingEmail) elements.emailInput.value = state.pendingEmail;

  renderAuth();
  clearMessage();
  elements.emailInput.focus();
  elements.emailInput.select();
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
  state.signedIn = signedIn;
  elements.authPanel.hidden = signedIn;
  elements.deck.hidden = !signedIn;
  elements.focusToggleBtn.hidden = !signedIn;

  const email = state.activeUser?.email;
  elements.logAccount.textContent = email ? `Signed in as ${email}` : "";

  if (signedIn) {
    // Nothing is pending any more, and the next sign-out should open on the form.
    window.clearInterval(resendTimer);
    state.authView = "form";
    state.pendingEmail = "";
    return;
  }

  renderAuth();
  clearMessage();
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

// The deck is hidden while signed out, so anything written to its message line would land in a
// hidden element — which is how every sign-up error used to disappear without a trace. Signed
// out, the auth panel carries the same single channel.
function setMessage(message, { alert = false } = {}) {
  window.clearTimeout(messageTimer);

  if (state.signedIn) {
    elements.messageLine.textContent = message || "";
    if (message) messageTimer = window.setTimeout(clearMessage, MESSAGE_HOLD_MS);
    return;
  }

  // Signed out there is nothing else on screen to move on to, so the line holds until something
  // replaces it rather than timing out while it is still the only instruction on the page.
  elements.authStatus.textContent = message || restingAuthHint();
  elements.authStatus.classList.toggle("is-alert", Boolean(message) && alert);
}

function clearMessage() {
  window.clearTimeout(messageTimer);
  elements.messageLine.textContent = "";
  elements.authStatus.textContent = restingAuthHint();
  elements.authStatus.classList.remove("is-alert");
}

// Saying a link is coming before the button is pressed is what stops the mail being a surprise.
function restingAuthHint() {
  if (state.signedIn || state.authView === "check") return "";
  return state.authMode === "signup" ? "We'll email one link to confirm it's you." : "";
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

function startFirstRun({ delay = 0 } = {}) {
  if (readFlag(FIRST_RUN_KEY)) return;

  const touch = navigator.maxTouchPoints > 0;
  firstRunTimers = [
    window.setTimeout(
      () => setMessage(touch ? "Drag to orbit. Pinch to zoom." : "Drag to orbit. Scroll to zoom."),
      delay + 900
    ),
    window.setTimeout(
      () =>
        setMessage(
          touch ? "Tap a star to read that night." : "Hover a star to glimpse it. Click to read it."
        ),
      delay + 4600
    ),
    window.setTimeout(
      () => setMessage("Hide everything from the dot up there, and just look."),
      delay + 8600
    ),
    window.setTimeout(() => endFirstRun(), delay + 14000)
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
