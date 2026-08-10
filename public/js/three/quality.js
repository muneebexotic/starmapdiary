// Mobile is the primary way this app is used, so quality is budgeted per device rather than
// rendered at full cost and hoped for. Phones get a lower pixel-ratio cap, half-resolution
// bloom and a thinner starfield — the look survives, the battery does too.

const MOBILE_QUERY = "(max-width: 640px), (hover: none) and (pointer: coarse)";

export function detectQuality() {
  const mobile = window.matchMedia(MOBILE_QUERY).matches;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Above ~2 the cost grows quadratically for pixels nobody can resolve.
  const pixelRatioCap = mobile ? 1.5 : 2;

  return {
    mobile,
    reducedMotion,
    pixelRatio: Math.min(window.devicePixelRatio || 1, pixelRatioCap),
    // Bloom is the single most expensive pass; half-res on phones is nearly indistinguishable.
    bloom: mobile
      ? { strength: 0.55, radius: 0.4, threshold: 0.62, scale: 0.5 }
      : { strength: 0.62, radius: 0.55, threshold: 0.62, scale: 1 },
    grain: mobile ? 0.018 : 0.028,
    vignette: 0.55,
    backgroundStars: mobile ? 900 : 1800,
    // Skip the intro flight and idle drift when motion is unwelcome.
    cameraMotion: !reducedMotion
  };
}
