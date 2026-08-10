// Where a star sits is derived from *when* it was written, not from a stored coordinate.
//
// The old layout scattered entries randomly inside a per-sentiment zone, which meant two
// consecutive days could land in opposite corners of the galaxy. That made the streak trail —
// which joins consecutive days — a mess of long lines crossing the whole scene. Here time runs
// along a spiral arm, so consecutive days are neighbours and a streak reads as a curve.
//
// Every value is a pure function of the entry's own timestamp, so a star never moves when
// later entries arrive: the sky grows outward instead of rearranging itself.

const MS_PER_DAY = 86400000;
const TAU = Math.PI * 2;

// One turn per ~4.4 months. Chosen so the gap between successive turns stays wider than the
// arc between consecutive days — otherwise neighbouring turns tangle and we are back to
// crossing lines.
const DAYS_PER_TURN = 96;

const RADIUS_MIN = 22;
// Sub-linear growth: early days spread out, later days pack in, the way a real arm thins
// outward. ~1 year lands near r=177, ~5 years near r=325.
const RADIUS_K = 13;
// Gentler than sqrt so a five-year history still fits inside the camera's reach.
const RADIUS_EXP = 0.42;

const WAVE_AMPLITUDE = 5.5;
const WAVE_PERIOD_DAYS = 47;
const JITTER = 2.6;

// Sentiment nudges height rather than owning position, so mood still reads spatially without
// tearing the timeline apart.
const SENTIMENT_LIFT = {
  positive: 5.5,
  reflective: 2,
  neutral: 0,
  negative: -5.5
};

// Deterministic 0..1 from a string, so jitter is stable across reloads and devices.
function hash01(value) {
  let h = 2166136261;
  const str = String(value);
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * @param {object}  entry
 * @param {string}  entry.createdAt  ISO timestamp — also the jitter seed, so a draft entry and
 *                                   the saved row it becomes land in exactly the same place.
 * @param {string}  entry.sentiment
 * @param {number}  epochMs          Timestamp of the user's earliest entry.
 */
export function galaxyPosition({ createdAt, sentiment }, epochMs) {
  const created = Date.parse(createdAt);
  // Fractional days, so several entries on one day sit slightly apart along the arm, ordered
  // by the time of day they were written.
  const t = Math.max(0, (created - epochMs) / MS_PER_DAY);

  const angle = t * (TAU / DAYS_PER_TURN);
  const radialJitter = (hash01(createdAt) - 0.5) * 2 * JITTER;
  const radius = RADIUS_MIN + RADIUS_K * Math.pow(t, RADIUS_EXP) + radialJitter;

  return {
    x: Math.cos(angle) * radius,
    z: Math.sin(angle) * radius,
    y:
      Math.sin(t * (TAU / WAVE_PERIOD_DAYS)) * WAVE_AMPLITUDE +
      (SENTIMENT_LIFT[sentiment] ?? 0) +
      (hash01(`${createdAt}|y`) - 0.5) * 2 * JITTER
  };
}

export function distanceFromCentre(position) {
  return Math.hypot(position.x, position.y, position.z);
}
