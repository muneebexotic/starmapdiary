import { API_BASE, AUTH_TOKEN_KEY, ENTRY_MAX_LENGTH } from "./config/constants.js";
import { SENTIMENT_CONFIG } from "./config/sentiment.js";
import { classifySentiment } from "./features/sentiment.js";
import { ReminderManager } from "./features/reminders.js";
import { ApiClient } from "./services/api-client.js";
import { formatDate } from "./utils/formatters.js";
import { SceneManager } from "./three/scene-manager.js";

const elements = {
  app: document.getElementById("app"),
  tooltip: document.getElementById("tooltip"),
  authPanel: document.getElementById("auth-panel"),
  entryCompose: document.getElementById("entry-compose"),
  input: document.getElementById("entry-input"),
  submitBtn: document.getElementById("submit-btn"),
  emailInput: document.getElementById("email-input"),
  passwordInput: document.getElementById("password-input"),
  signupBtn: document.getElementById("signup-btn"),
  loginBtn: document.getElementById("login-btn"),
  logoutBtn: document.getElementById("logout-btn"),
  authStatus: document.getElementById("auth-status"),
  reminderBanner: document.getElementById("reminder-banner"),
  reminderText: document.getElementById("reminder-text"),
  enablePushBtn: document.getElementById("enable-push-btn"),
  iosInstallHint: document.getElementById("ios-install-hint"),
  modal: document.getElementById("modal"),
  closeModalBtn: document.getElementById("close-modal"),
  entryMeta: document.getElementById("entry-meta"),
  entryFull: document.getElementById("entry-full")
};

const api = new ApiClient({ baseUrl: API_BASE, authTokenKey: AUTH_TOKEN_KEY });
const defaultInputPlaceholder = elements.input?.getAttribute("placeholder") || "Write a journal entry and create a star...";
const state = {
  activeUser: null
};

const scene = new SceneManager({
  container: elements.app,
  tooltip: elements.tooltip,
  onStarSelected: openModalForEntry
});

const reminders = new ReminderManager({
  api,
  elements,
  setStatus
});

wireEvents();
bootstrap();

function wireEvents() {
  elements.submitBtn.addEventListener("click", handleSubmit);
  elements.signupBtn.addEventListener("click", handleSignup);
  elements.loginBtn.addEventListener("click", handleLogin);
  elements.logoutBtn.addEventListener("click", handleLogout);

  elements.input.addEventListener("keydown", (event) => {
    if (!api.token && isWriteIntent(event)) {
      event.preventDefault();
      showLockedComposerFeedback();
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      handleSubmit();
    }
  });
  elements.input.addEventListener("input", syncEntryInputHeight);
  elements.input.addEventListener("pointerdown", handleLockedComposerIntent);
  elements.input.addEventListener("focus", handleLockedComposerIntent);

  elements.closeModalBtn.addEventListener("click", closeModal);
  elements.modal.addEventListener("click", (event) => {
    if (event.target === elements.modal) closeModal();
  });
}

async function bootstrap() {
  setSignedInState(false);
  syncEntryInputHeight();

  if (!api.token) return;

  try {
    const me = await api.get("/auth/me");
    state.activeUser = me;
    setSignedInState(true);
    await loadEntriesFromServer();
    await reminders.start();
  } catch (_error) {
    api.clearToken();
    state.activeUser = null;
    reminders.stop();
    setStatus("Session expired. Please log in.");
  }
}

async function handleSignup() {
  const email = elements.emailInput.value.trim();
  const password = elements.passwordInput.value;

  if (!email || !password) {
    setStatus("Email and password are required.");
    return;
  }

  try {
    const response = await api.post("/auth/signup", { email, password }, { auth: false });

    if (!response.session?.access_token) {
      setStatus("Signup succeeded. Check email confirmation before login.");
      return;
    }

    api.token = response.session.access_token;
    state.activeUser = response.user || null;
    setSignedInState(true);
    await loadEntriesFromServer();
    await reminders.start();
    setStatus("Signed up and logged in.");
  } catch (error) {
    setStatus(error.message);
  }
}

async function handleLogin() {
  const email = elements.emailInput.value.trim();
  const password = elements.passwordInput.value;

  if (!email || !password) {
    setStatus("Email and password are required.");
    return;
  }

  try {
    const response = await api.post("/auth/login", { email, password }, { auth: false });
    api.token = response.session.access_token;
    state.activeUser = response.user || null;

    setSignedInState(true);
    await loadEntriesFromServer();
    await reminders.start();
    setStatus("Logged in.");
  } catch (error) {
    setStatus(error.message);
  }
}

function handleLogout() {
  api.clearToken();
  state.activeUser = null;
  scene.clearEntries();
  reminders.stop();
  setSignedInState(false);
  setStatus("Logged out.");
}

async function loadEntriesFromServer() {
  const payload = await api.get("/entries");

  scene.clearEntries();

  for (let i = 0; i < payload.entries.length; i += 1) {
    const entry = payload.entries[i];
    if (!entry.position || typeof entry.position.x !== "number") {
      entry.position = scene.getSuggestedPosition(entry.sentiment, entry.createdAt);
    }
    scene.addEntry(entry);
  }
}

async function handleSubmit() {
  if (!api.token) {
    showLockedComposerFeedback();
    return;
  }

  const text = elements.input.value.trim();
  if (!text) return;

  if (text.length > ENTRY_MAX_LENGTH) {
    setStatus(`Entry must be at most ${ENTRY_MAX_LENGTH} characters.`);
    return;
  }

  const sentiment = classifySentiment(text);
  const createdAt = new Date().toISOString();

  const draftEntry = {
    text,
    sentiment,
    createdAt,
    position: scene.getSuggestedPosition(sentiment, createdAt)
  };

  try {
    const response = await api.post("/entries", draftEntry);
    scene.addEntry(response.entry);
    await reminders.onEntrySaved();
    setStatus("Entry saved.");
    elements.input.value = "";
    syncEntryInputHeight();
  } catch (error) {
    setStatus(error.message);
  }
}

function openModalForEntry(entry) {
  const sentimentMeta = SENTIMENT_CONFIG[entry.sentiment] || SENTIMENT_CONFIG.neutral;
  elements.entryMeta.textContent = `${sentimentMeta.label} | ${formatDate(entry.createdAt)}`;
  elements.entryFull.textContent = entry.text;
  elements.modal.classList.add("open");
}

function closeModal() {
  elements.modal.classList.remove("open");
}

function setSignedInState(signedIn) {
  const wasSignedIn = elements.authPanel.classList.contains("signed-in");

  elements.authPanel.classList.toggle("signed-in", signedIn);
  elements.entryCompose.classList.toggle("locked", !signedIn);
  elements.submitBtn.disabled = false;
  elements.input.disabled = false;
  elements.input.readOnly = !signedIn;
  elements.input.setAttribute("aria-disabled", String(!signedIn));
  elements.submitBtn.setAttribute("aria-label", signedIn ? "Add Star" : "Locked. Sign in or sign up to add a star");
  elements.input.placeholder = signedIn ? defaultInputPlaceholder : "Sign in or sign up to unlock journaling...";
  elements.emailInput.disabled = signedIn;
  elements.passwordInput.disabled = signedIn;
  elements.signupBtn.disabled = signedIn;
  elements.loginBtn.disabled = signedIn;
  elements.logoutBtn.disabled = !signedIn;

  if (signedIn && !wasSignedIn) {
    runTransientAnimation(elements.entryCompose, "unlock-burst", 520);
    runTransientAnimation(elements.authPanel, "snap-collapse", 500);
  }

  if (signedIn && state.activeUser?.email) {
    setStatus(`Signed in as ${state.activeUser.email}`);
  } else if (!signedIn) {
    setStatus("Not signed in.");
  }
}

function setStatus(message) {
  elements.authStatus.textContent = message;
}

function syncEntryInputHeight() {
  const input = elements.input;
  if (!input) return;

  const computed = window.getComputedStyle(input);
  const composeHeight = Number.parseFloat(computed.getPropertyValue("--compose-height")) || 64;
  const maxHeight = Number.parseFloat(computed.maxHeight) || 180;

  input.style.height = `${composeHeight}px`;
  const nextHeight = Math.min(maxHeight, Math.max(composeHeight, input.scrollHeight));
  input.style.height = `${nextHeight}px`;
  input.style.overflowY = input.scrollHeight > maxHeight ? "auto" : "hidden";
}

function handleLockedComposerIntent(event) {
  if (api.token) return;

  if (event.type === "pointerdown") {
    event.preventDefault();
  }

  if (event.type === "focus") {
    elements.input.blur();
  }

  showLockedComposerFeedback();
}

function showLockedComposerFeedback() {
  setStatus("Composer is locked. Sign up or log in to add today’s entry.");
  runTransientAnimation(elements.entryCompose, "locked-shake", 380);
  runTransientAnimation(elements.authPanel, "auth-pulse", 420);

  if (!elements.emailInput.disabled) {
    elements.emailInput.focus({ preventScroll: true });
  }
}

function runTransientAnimation(element, className, durationMs) {
  if (!element) return;
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
  window.setTimeout(() => {
    element.classList.remove(className);
  }, durationMs);
}

function isWriteIntent(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  const passiveKeys = new Set([
    "Shift",
    "Control",
    "Meta",
    "Alt",
    "CapsLock",
    "Escape",
    "Tab",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Home",
    "End",
    "PageUp",
    "PageDown"
  ]);
  return !passiveKeys.has(event.key);
}
