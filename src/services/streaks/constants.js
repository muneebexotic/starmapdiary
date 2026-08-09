// Milestones start at 3 days on purpose: the research behind the FRD (docs/streaks-frd.md
// section 3.1) found the 1-day to 2-day transition is the largest retention step, so the
// first celebration has to land long before day 30.
const MILESTONES = [
  { days: 3, name: "First Light" },
  { days: 7, name: "The Arc" },
  { days: 14, name: "Fortnight" },
  { days: 30, name: "Lunar Cycle" },
  { days: 50, name: "Meridian" },
  { days: 100, name: "Centaurus" },
  { days: 200, name: "Deep Field" },
  { days: 365, name: "Full Orbit" }
];

// Rest days (grace) may not be used more often than once per this many qualifying days
// within the same run. See rule R-2.
const GRACE_WINDOW_DAYS = 7;

// Size of the history grid returned to the client.
const RECENT_DAYS_WINDOW = 60;

module.exports = {
  MILESTONES,
  GRACE_WINDOW_DAYS,
  RECENT_DAYS_WINDOW
};
