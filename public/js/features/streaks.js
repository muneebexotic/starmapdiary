import { formatDayLabel, formatNights, formatWeekday } from "../utils/formatters.js";

const GRID_DAYS = 28;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

// Copy is deliberately invitational. No "don't", "lose", "missed", "broke", or exclamation
// marks — see docs/streaks-frd.md section 8.4.
function buildHeadline(status) {
  const nights = formatNights(status.current);

  switch (status.state) {
    case "active_today":
      return `${nights} · tonight's star is placed`;
    case "active_pending":
      return `${nights} · today is still open`;
    case "at_risk":
      return `${nights} · there's still time tonight`;
    case "grace_used":
      return status.graceUsedOn
        ? `You took a rest day on ${formatWeekday(status.graceUsedOn)} — your streak carried over`
        : `${nights} · a rest day carried your streak over`;
    case "broken":
      return `Longest: ${formatNights(status.longest)}`;
    default:
      return nights;
  }
}

function buildSubline(status) {
  if (status.state === "broken") return "Tonight starts the next one.";
  if (status.longest > status.current) return `Longest: ${formatNights(status.longest)}`;
  if (status.current > 1) return "This is your longest run so far.";
  return "";
}

function buildDayLabel(day, isToday) {
  const date = formatDayLabel(day.date);
  if (day.logged) return `${date}: entry written`;
  if (day.rested) return `${date}: rest day`;
  return isToday ? `${date}: today, still open` : `${date}: no entry`;
}

function buildPillLabel(status) {
  const headline = buildHeadline(status);
  return status.state === "broken"
    ? `Streaks. ${headline}. Open streak details.`
    : `Streak: ${headline}. Open streak details.`;
}

export class StreakManager {
  constructor({ api, elements, setStatus, onOpen }) {
    this.api = api;
    this.elements = elements;
    this.setStatus = setStatus;
    this.onOpen = onOpen;
    this.status = null;
    this.cardOpen = false;
    this.timer = null;
    this.lastAnnouncedCount = null;

    this.handlePillClick = this.handlePillClick.bind(this);
    this.handleHideClick = this.handleHideClick.bind(this);
    this.handleShowClick = this.handleShowClick.bind(this);
    this.handleDocumentClick = this.handleDocumentClick.bind(this);
    this.handleKeydown = this.handleKeydown.bind(this);
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
  }

  async start() {
    this.stop();
    if (!this.api.token) return;

    this.attachEvents();
    await this.refresh();

    this.timer = window.setInterval(() => this.refresh(), REFRESH_INTERVAL_MS);
  }

  stop() {
    this.status = null;
    this.lastAnnouncedCount = null;
    this.detachEvents();

    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = null;
    }

    this.closeCard({ immediate: true });
    this.elements.streak.hidden = true;
    this.elements.streakShowBtn.hidden = true;
  }

  async onEntrySaved() {
    await this.refresh({ announce: true });
  }

  attachEvents() {
    this.elements.streakBtn.addEventListener("click", this.handlePillClick);
    this.elements.streakHideBtn.addEventListener("click", this.handleHideClick);
    this.elements.streakShowBtn.addEventListener("click", this.handleShowClick);
    document.addEventListener("click", this.handleDocumentClick);
    document.addEventListener("keydown", this.handleKeydown);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  detachEvents() {
    this.elements.streakBtn.removeEventListener("click", this.handlePillClick);
    this.elements.streakHideBtn.removeEventListener("click", this.handleHideClick);
    this.elements.streakShowBtn.removeEventListener("click", this.handleShowClick);
    document.removeEventListener("click", this.handleDocumentClick);
    document.removeEventListener("keydown", this.handleKeydown);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
  }

  async refresh({ announce = false } = {}) {
    if (!this.api.token) return;

    try {
      this.status = await this.api.get("/streak");
      this.render({ announce });
    } catch (_error) {
      // A streak failure is never worth interrupting the diary for.
      this.elements.streak.hidden = true;
    }
  }

  handleVisibilityChange() {
    if (document.visibilityState === "visible") this.refresh();
  }

  render({ announce = false } = {}) {
    const status = this.status;

    // Rule S-8: a user with no history is never shown a zero.
    if (!status || !status.visible || status.state === "empty") {
      this.closeCard({ immediate: true });
      this.elements.streak.hidden = true;
      this.elements.streakShowBtn.hidden = !status || status.visible !== false;
      return;
    }

    this.elements.streak.hidden = false;
    this.elements.streakShowBtn.hidden = true;

    // Rule P-3: between a break and the next entry the pill carries the longest streak,
    // never a bare zero.
    const displayCount = status.state === "broken" ? status.longest : status.current;
    this.elements.streakCount.textContent = String(displayCount);
    this.elements.streakBtn.dataset.state = status.state;
    this.elements.streakBtn.setAttribute("aria-label", buildPillLabel(status));

    this.renderCard(status);

    if (announce && status.current !== this.lastAnnouncedCount) {
      this.elements.streakLive.textContent = `Streak: ${formatNights(status.current)}.`;
      this.lastAnnouncedCount = status.current;
    }
  }

  renderCard(status) {
    this.elements.streakHeadline.textContent = buildHeadline(status);

    const subline = buildSubline(status);
    this.elements.streakLongest.textContent = subline;
    this.elements.streakLongest.hidden = !subline;

    const next = status.nextMilestone;
    const showNext = Boolean(next) && status.state !== "broken";
    this.elements.streakNext.textContent = showNext
      ? `Next: ${next.name}, ${formatNights(next.remaining)} away`
      : "";
    this.elements.streakNext.hidden = !showNext;

    this.renderGrid(status);
  }

  renderGrid(status) {
    const grid = this.elements.streakGrid;
    const days = (status.recentDays || []).slice(-GRID_DAYS);

    grid.textContent = "";

    for (let i = 0; i < days.length; i += 1) {
      const day = days[i];
      const isToday = day.date === status.todayLocalDate;

      const cell = document.createElement("span");
      cell.className = "streak-day";
      cell.setAttribute("role", "listitem");
      cell.setAttribute("aria-label", buildDayLabel(day, isToday));

      if (day.logged) cell.classList.add("is-logged");
      if (day.rested) cell.classList.add("is-rested");
      if (isToday) cell.classList.add("is-today");

      grid.appendChild(cell);
    }
  }

  handlePillClick(event) {
    event.stopPropagation();
    if (this.cardOpen) {
      this.closeCard();
      return;
    }
    this.openCard();
  }

  openCard() {
    if (this.cardOpen) return;
    if (this.onOpen) this.onOpen();

    this.cardOpen = true;
    this.elements.streakPopover.hidden = false;
    this.elements.streakBtn.setAttribute("aria-expanded", "true");

    window.requestAnimationFrame(() => {
      this.elements.streakPopover.classList.add("open");
    });
  }

  closeCard({ immediate = false } = {}) {
    if (!this.cardOpen) return;

    this.cardOpen = false;
    this.elements.streakPopover.classList.remove("open");
    this.elements.streakBtn.setAttribute("aria-expanded", "false");

    if (immediate) {
      this.elements.streakPopover.hidden = true;
      return;
    }

    window.setTimeout(() => {
      if (!this.cardOpen) this.elements.streakPopover.hidden = true;
    }, 250);
  }

  handleDocumentClick(event) {
    if (!this.cardOpen) return;
    if (this.elements.streak.contains(event.target)) return;
    this.closeCard();
  }

  handleKeydown(event) {
    if (event.key !== "Escape" || !this.cardOpen) return;
    this.closeCard();
    this.elements.streakBtn.focus({ preventScroll: true });
  }

  async setVisibility(visible) {
    try {
      await this.api.put("/streak/settings", { visible });
      if (this.status) this.status.visible = visible;
      return true;
    } catch (error) {
      this.setStatus(error.message || "Could not update streak settings.");
      return false;
    }
  }

  async handleHideClick() {
    this.closeCard({ immediate: true });

    if (!(await this.setVisibility(false))) return;

    this.render();
    this.setStatus("Streaks hidden. Turn them back on from the date filter panel.");
  }

  async handleShowClick() {
    if (!(await this.setVisibility(true))) return;

    // The streak kept accruing while hidden, so re-enabling shows the real number.
    await this.refresh();
    this.setStatus("Streaks shown.");
  }
}
