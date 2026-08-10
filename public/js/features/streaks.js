import { formatNights, formatWeekday } from "../utils/formatters.js";

const CALENDAR_DAYS = 28;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const MILESTONE_HOLD_MS = 6000;

const NO_TRAIL = { setData() {}, playDraw() {}, playSweep() {} };

// Copy is invitational throughout: no "don't", "lose", "missed", "broke", and no exclamation
// marks. See design/incoming/README.md and docs/streaks-frd.md section 8.4.
function headlineFor(status) {
  if (status.state === "broken") return `Longest: ${formatNights(status.longest)}`;
  return formatNights(status.current);
}

function sublineFor(status) {
  switch (status.state) {
    case "active_today":
      return "Tonight's star is placed.";
    case "active_pending":
      return "Today is still open.";
    case "at_risk":
      return "There's still time tonight.";
    case "grace_used":
      return status.graceUsedOn
        ? `You took a rest night on ${formatWeekday(status.graceUsedOn)}. Your streak carried over.`
        : "A rest night carried your streak over.";
    case "broken":
      return "Tonight starts the next one.";
    default:
      return "";
  }
}

function nextLineFor(status) {
  const next = status.nextMilestone;
  if (!next || status.state === "broken") return "";
  return `${next.name} at ${formatNights(next.days)}, ${formatNights(next.remaining)} away.`;
}

function parseLocalDate(dateStr) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

// Monday-first index, so the calendar's weekday letters line up with its cells.
function mondayIndex(dateStr) {
  return (parseLocalDate(dateStr).getDay() + 6) % 7;
}

function monthLabel(dateStr) {
  return parseLocalDate(dateStr).toLocaleDateString(undefined, { month: "short" });
}

function nightLabel(day, isToday) {
  const date = parseLocalDate(day.date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
  if (day.logged) return `${date}: entry written`;
  if (day.rested) return `${date}: rest night`;
  return isToday ? `${date}: today, still open` : `${date}: no entry`;
}

export class StreakManager {
  constructor({ api, elements, setMessage, trail = NO_TRAIL, onSelectNight }) {
    this.api = api;
    this.elements = elements;
    this.setMessage = setMessage;
    this.trail = trail;
    this.onSelectNight = onSelectNight;

    this.status = null;
    this.filterDay = null;
    this.timer = null;
    this.milestoneTimer = null;
    this.lastAnnouncedCount = null;

    this.handleSwitchClick = this.handleSwitchClick.bind(this);
    this.handleCalendarClick = this.handleCalendarClick.bind(this);
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
    this.filterDay = null;
    this.lastAnnouncedCount = null;
    this.detachEvents();

    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = null;
    }

    window.clearTimeout(this.milestoneTimer);
    this.hideMilestone();
    this.trail.setData(null);
    this.clearMeta();
  }

  attachEvents() {
    this.elements.streakSwitch.addEventListener("click", this.handleSwitchClick);
    this.elements.logCalendar.addEventListener("click", this.handleCalendarClick);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  detachEvents() {
    this.elements.streakSwitch.removeEventListener("click", this.handleSwitchClick);
    this.elements.logCalendar.removeEventListener("click", this.handleCalendarClick);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
  }

  handleVisibilityChange() {
    if (document.visibilityState === "visible") this.refresh();
  }

  /**
   * The reward beat. `streak` is what POST /api/entries returns alongside the entry, so the
   * trail and the counts update without a second round trip; a refetch covers the case where
   * the server could not build it.
   */
  async onEntrySaved(streak = null) {
    await this.refresh({ announce: true, status: streak });

    if (!this.status || !this.status.visible) return;

    this.trail.playDraw();

    if (this.status.milestoneReached) {
      this.showMilestone(this.status.milestoneReached);
      this.trail.playSweep();
    }
  }

  async refresh({ announce = false, status = null } = {}) {
    if (!this.api.token) return;

    try {
      this.status = status || (await this.api.get("/streak"));
      this.render({ announce });
      this.trail.setData(this.status);
    } catch (_error) {
      // A streak failure is never worth interrupting the diary for.
      this.clearMeta();
    }
  }

  clearMeta() {
    this.elements.metaStreak.textContent = "";
    this.elements.metaStreakDot.hidden = true;
  }

  render({ announce = false } = {}) {
    const status = this.status;
    if (!status) return;

    this.renderMeta(status);
    this.renderLog(status);

    if (announce && status.visible && status.current !== this.lastAnnouncedCount) {
      this.elements.streakLive.textContent = `Streak: ${formatNights(status.current)}.`;
      this.lastAnnouncedCount = status.current;
    }
  }

  // Rules S-8 and P-3: an empty history shows nothing at all, and a break leads with the
  // longest run rather than a bare zero.
  renderMeta(status) {
    const hide = !status.visible || status.state === "empty";
    this.elements.metaStreakDot.hidden = hide || status.state === "broken";

    if (hide) {
      this.elements.metaStreak.textContent = "";
      return;
    }

    this.elements.metaStreak.textContent =
      status.state === "broken"
        ? `Longest ${formatNights(status.longest)}`
        : formatNights(status.current);
  }

  renderLog(status) {
    const { elements } = this;

    elements.log.classList.toggle("streaks-off", !status.visible);
    elements.streakSwitch.setAttribute("aria-checked", String(status.visible));
    elements.streakSwitchHint.textContent = status.visible
      ? "Counts, trail and milestones."
      : "Hidden. They keep counting quietly.";

    const showBlock = status.visible && status.state !== "empty";
    elements.streakBlock.hidden = !showBlock;

    if (showBlock) {
      elements.streakHeadline.textContent = headlineFor(status);
      elements.streakSub.textContent = sublineFor(status);
      elements.streakNext.textContent = nextLineFor(status);
    }

    this.renderCalendar(status);
  }

  renderCalendar(status) {
    const grid = this.elements.logCalendar;
    const days = (status.recentDays || []).slice(-CALENDAR_DAYS);

    grid.textContent = "";
    if (days.length === 0) return;

    const first = days[0].date;
    const last = days[days.length - 1].date;
    this.elements.logRange.textContent =
      monthLabel(first) === monthLabel(last)
        ? monthLabel(last)
        : `${monthLabel(first)} – ${monthLabel(last)}`;

    // Blank leading cells so week one starts on a Monday.
    for (let pad = mondayIndex(first); pad > 0; pad -= 1) {
      const filler = document.createElement("span");
      filler.className = "night";
      filler.setAttribute("aria-hidden", "true");
      grid.appendChild(filler);
    }

    for (let i = 0; i < days.length; i += 1) {
      const day = days[i];
      const isToday = day.date === status.todayLocalDate;

      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "night";
      cell.dataset.date = day.date;
      cell.setAttribute("aria-label", nightLabel(day, isToday));

      if (day.logged) cell.classList.add("written");
      if (day.rested) cell.classList.add("rested");
      if (isToday) cell.classList.add("today");
      if (day.date === this.filterDay) cell.classList.add("filtered");
      if (!day.logged) cell.disabled = true;

      const dot = document.createElement("span");
      dot.className = "night-dot";
      cell.appendChild(dot);
      grid.appendChild(cell);
    }

    this.elements.logCaption.textContent = this.filterDay
      ? "Showing one night. Tap it again for the whole sky."
      : "Tap a night to show only its stars.";
  }

  // The date filter and the streak grid were always the same list — "your recent nights" — so
  // tapping a night here is what filters the sky.
  handleCalendarClick(event) {
    const cell = event.target.closest(".night[data-date]");
    if (!cell || cell.disabled) return;

    const date = cell.dataset.date;
    this.filterDay = this.filterDay === date ? null : date;

    if (this.onSelectNight) this.onSelectNight(this.filterDay);
    if (this.status) this.renderCalendar(this.status);
  }

  clearFilter() {
    if (!this.filterDay) return;
    this.filterDay = null;
    if (this.status) this.renderCalendar(this.status);
  }

  showMilestone(milestone) {
    const line = this.elements.milestoneLine;
    line.textContent = `${milestone.name} · ${formatNights(milestone.days)}`;
    line.hidden = false;

    window.clearTimeout(this.milestoneTimer);
    this.milestoneTimer = window.setTimeout(() => this.hideMilestone(), MILESTONE_HOLD_MS);
  }

  hideMilestone() {
    this.elements.milestoneLine.hidden = true;
    this.elements.milestoneLine.textContent = "";
  }

  async handleSwitchClick() {
    if (!this.status) return;
    const visible = !this.status.visible;

    try {
      await this.api.put("/streak/settings", { visible });
    } catch (error) {
      this.setMessage(error.message || "Could not update streak settings.");
      return;
    }

    // The streak kept counting while hidden, so switching back on shows the real number.
    this.status.visible = visible;
    this.render();
    this.trail.setData(this.status);
    if (!visible) this.hideMilestone();
  }
}
