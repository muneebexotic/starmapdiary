import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SENTIMENT_CONFIG } from "../config/sentiment.js";
import { buildEntryPreview, escapeHtml } from "../utils/formatters.js";
import { createBackgroundStarfield, createGlowTexture } from "./galaxy-utils.js";
import { detectQuality } from "./quality.js";
import { createComposer } from "./post.js";
import { galaxyPosition, distanceFromCentre } from "./layout.js";

function localDateString(iso) {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

const MS_PER_DAY = 86400000;

function toEpochDay(localDate) {
  const [y, m, d] = String(localDate).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / MS_PER_DAY;
}

function dayGap(later, earlier) {
  return toEpochDay(later) - toEpochDay(earlier);
}

function nextDay(localDate) {
  return new Date((toEpochDay(localDate) + 1) * MS_PER_DAY).toISOString().slice(0, 10);
}

const TRAIL_GOLD = "#f5c96a";
const TRAIL_FADED = "#8fa1bd";
const ACTIVE_OPACITY = 0.2;
const HISTORY_OPACITY = 0.07;
const BRIDGE_OPACITY = 0.12;
const DRAW_DURATION_MS = 600;
const FLARE_DURATION_MS = 520;
const SWEEP_DURATION_MS = 1400;
const SWEEP_WINDOW = 3;
// Sentiment links are local detail, not long-haul connections: beyond this they read as chords
// cutting across the spiral rather than as constellations.
const MAX_SENTIMENT_LINK_DISTANCE = 34;
// Picking tolerances in CSS pixels. A fingertip needs far more room than a cursor.
const MOUSE_PICK_PX = 16;
const TOUCH_PICK_PX = 28;
const LONG_PRESS_MS = 380;
const PREVIEW_HOLD_MS = 2800;

export class SceneManager {
  constructor({ container, tooltip, onStarSelected }) {
    this.container = container;
    this.tooltip = tooltip;
    this.onStarSelected = onStarSelected;

    // Held on the instance because galaxy-utils takes THREE as a parameter, and so the rest
    // of this class reads the same way it did before three.js became a module import.
    this.THREE = THREE;
    this.OrbitControls = OrbitControls;

    this.scene = new this.THREE.Scene();
    this.camera = new this.THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1200);
    // Inclined ~28 degrees: a spiral read from above is a spiral, edge-on it is a smudge.
    this.camera.position.set(0, 78, 148);

    this.quality = detectQuality();

    // antialias is off: bloom and grain hide edge stairs, and MSAA on a full-screen pass chain
    // costs more than it returns here.
    this.renderer = new this.THREE.WebGLRenderer({ antialias: false, alpha: true });
    this.renderer.setPixelRatio(this.quality.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // Filmic rolloff instead of clipping: bright star cores keep their colour instead of
    // flattening into white discs.
    this.renderer.toneMapping = this.THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new this.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 38;
    this.controls.maxDistance = 520;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.22;

    // No lights: every material in this scene (sprites, points, lines) is unlit, so the
    // AmbientLight and PointLight that used to be here contributed nothing to any pixel.

    this.diaryEntries = [];
    this.diaryStars = [];
    this.layoutEpochMs = null;
    this.contentRadius = 0;
    this.contentCentre = new this.THREE.Vector3();
    this.hoveredStar = null;
    this.hoveredEntry = null;
    this.pointerClient = { x: -9999, y: -9999 };
    this.previewTimer = null;
    this.filterDate = null;
    this.constellationTargetOpacity = 0.11;
    this._resizeTimer = null;

    this.constellationGroup = new this.THREE.Group();
    this.scene.add(this.constellationGroup);

    // The streak trail lives in its own group so it can be rebuilt, hidden by the date
    // filter, or switched off entirely without disturbing the sentiment constellations.
    this.streakGroup = new this.THREE.Group();
    this.scene.add(this.streakGroup);

    this.streakData = null;
    this.streakLines = { history: null, active: null, bridge: null, sweep: null };
    this.activeSegments = [];
    this.trailDraw = null;
    this.trailSweep = null;
    this.prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.driftEnabled = true;
    // Touch: a tap glimpses, a long press opens.
    this.touch = { pending: null, longPressed: false, timer: null };
    // Hover tracking is for pointing devices only. A tap parks the pointer on the star it hit,
    // so leaving hover enabled on touch pins the preview open until the next tap elsewhere.
    this.hoverTracking = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

    this.starTexture = createGlowTexture(this.THREE);
    this.backgroundField = createBackgroundStarfield(this.THREE, this.quality.backgroundStars);
    this.scene.add(this.backgroundField);

    this.post = createComposer({
      THREE: this.THREE,
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      quality: this.quality
    });

    // A short flight inward on load, so arriving feels like arriving somewhere.
    this.intro = this.quality.cameraMotion
      ? { start: performance.now(), duration: 2600, from: 330, to: 170 }
      : null;

    this.handleResize = this.handleResize.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);

    this.handlePointerUp = this.handlePointerUp.bind(this);

    window.addEventListener("resize", this.handleResize);
    window.addEventListener("pointermove", this.handlePointerMove);
    window.addEventListener("pointerdown", this.handlePointerDown);
    window.addEventListener("pointerup", this.handlePointerUp);
    window.addEventListener("pointercancel", this.handlePointerUp);

    this.animate();
  }

  // Positions are derived from the timestamp at render time (see layout.js). The server still
  // stores a position column because it is NOT NULL and older clients read it, but nothing here
  // depends on the stored value any more.
  getSuggestedPosition(sentiment, createdAt) {
    return galaxyPosition({ createdAt, sentiment }, this.layoutEpochMs ?? Date.parse(createdAt));
  }

  // The user's earliest entry anchors the spiral, so their history starts at the centre however
  // late they joined. Entries always arrive newest-last, so this settles on the first one.
  noteLayoutEpoch(createdAt) {
    const ms = Date.parse(createdAt);
    if (!Number.isFinite(ms)) return false;
    if (this.layoutEpochMs === null || ms < this.layoutEpochMs) {
      this.layoutEpochMs = ms;
      return true;
    }
    return false;
  }

  // Reposition every star against the current epoch. Only needed if an entry turns up older
  // than everything already loaded.
  relayoutAll() {
    for (let i = 0; i < this.diaryStars.length; i += 1) {
      const star = this.diaryStars[i];
      const next = galaxyPosition(star.userData.entry, this.layoutEpochMs);
      star.userData.entry.position = next;
      star.position.set(next.x, next.y, next.z);
    }
    this.rebuildStreakTrail();
  }

  // Frames whatever history exists, so three entries and five years both open well composed.
  updateContentFraming() {
    if (this.diaryStars.length === 0) return;

    const centre = new this.THREE.Vector3();
    for (let i = 0; i < this.diaryStars.length; i += 1) centre.add(this.diaryStars[i].position);
    centre.divideScalar(this.diaryStars.length);
    this.contentCentre.copy(centre);

    let radius = 0;
    for (let i = 0; i < this.diaryStars.length; i += 1) {
      radius = Math.max(radius, this.diaryStars[i].position.distanceTo(centre));
    }
    this.contentRadius = radius;

    // Only re-aim while the opening flight is still running; after that the view is the user's.
    if (!this.intro) return;
    this.controls.target.copy(centre);

    // Fit to how wide and how tall the galaxy actually lands on screen, measured along the
    // camera's own right and up axes. A bounding sphere would treat this thin inclined arm as
    // if it were a ball and park the camera roughly twice as far away as it needs to be.
    const forward = this.camera.position.clone().sub(centre).normalize();
    const right = new this.THREE.Vector3().crossVectors(this.camera.up, forward).normalize();
    const up = new this.THREE.Vector3().crossVectors(forward, right).normalize();

    const tanV = Math.tan(this.THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const tanH = tanV * this.camera.aspect;

    // Solved per star, because the camera is perspective and this arm has real depth: a star
    // nearer the camera projects further out, so fitting on lateral extent alone crops it.
    // For each star, |lateral| <= (distance - depthTowardCamera) * tan(halfFov).
    const offset = new this.THREE.Vector3();
    let required = 60;
    for (let i = 0; i < this.diaryStars.length; i += 1) {
      offset.copy(this.diaryStars[i].position).sub(centre);
      const towardCamera = offset.dot(forward);
      required = Math.max(
        required,
        towardCamera + Math.abs(offset.dot(up)) / tanV,
        towardCamera + Math.abs(offset.dot(right)) / tanH
      );
    }

    this.intro.to = this.THREE.MathUtils.clamp(required * 1.2, 60, 460);
  }

  filterByDate(dateStr) {
    this.filterDate = dateStr;
    this.constellationTargetOpacity = 0;
    this.updateStreakVisibility();
    for (let i = 0; i < this.diaryStars.length; i += 1) {
      const star = this.diaryStars[i];
      const entryDate = localDateString(star.userData.entry.createdAt);
      star.userData.targetOpacity = entryDate === dateStr ? 1 : 0;
    }
  }

  clearFilter() {
    this.filterDate = null;
    this.constellationTargetOpacity = 0.11;
    this.updateStreakVisibility();
    for (let i = 0; i < this.diaryStars.length; i += 1) {
      this.diaryStars[i].userData.targetOpacity = 1;
    }
  }

  clearEntries() {
    this.filterDate = null;
    this.constellationTargetOpacity = 0.11;
    this.hoveredStar = null;
    this.tooltip.style.opacity = "0";

    this.streakData = null;
    this.layoutEpochMs = null;
    this.contentRadius = 0;
    this.contentCentre.set(0, 0, 0);
    this.disposeStreakTrail();
    this.updateStreakVisibility();

    while (this.diaryStars.length > 0) {
      const star = this.diaryStars.pop();
      this.scene.remove(star);
      if (star.material?.dispose) star.material.dispose();
    }

    while (this.constellationGroup.children.length > 0) {
      const line = this.constellationGroup.children[0];
      this.constellationGroup.remove(line);
      if (line.geometry) line.geometry.dispose();
      if (line.material) line.material.dispose();
    }

    this.diaryEntries.length = 0;
  }

  addEntry(entry) {
    const epochMoved = this.noteLayoutEpoch(entry.createdAt);

    // The stored coordinate is ignored: position is a function of when the entry was written.
    entry.position = galaxyPosition(entry, this.layoutEpochMs);

    const cfg = SENTIMENT_CONFIG[entry.sentiment] || SENTIMENT_CONFIG.neutral;
    const lenFactor = Math.min(String(entry.text || "").length, 800);
    const size = this.THREE.MathUtils.mapLinear(lenFactor, 1, 800, 3, 10);

    const material = new this.THREE.SpriteMaterial({
      map: this.starTexture,
      color: new this.THREE.Color(cfg.color),
      transparent: true,
      blending: this.THREE.AdditiveBlending,
      depthWrite: false
    });

    const star = new this.THREE.Sprite(material);
    star.position.set(entry.position.x, entry.position.y, entry.position.z);
    star.scale.setScalar(size);

    const targetOpacity = this.filterDate
      ? (localDateString(entry.createdAt) === this.filterDate ? 1 : 0)
      : 1;

    star.userData = {
      entry,
      baseScale: size,
      pulseOffset: Math.random() * Math.PI * 2,
      targetOpacity,
      currentOpacity: targetOpacity
    };
    material.opacity = targetOpacity;

    this.diaryEntries.push(entry);
    this.diaryStars.push(star);
    this.scene.add(star);
    this.addConstellationLinks(star);

    // Defensive: entries normally arrive oldest-first, but if one predates the current anchor
    // the whole spiral has to shift with it.
    if (epochMoved && this.diaryStars.length > 1) this.relayoutAll();
    this.updateContentFraming();
  }

  handleResize() {
    clearTimeout(this._resizeTimer);
    this._resizeTimer = setTimeout(() => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.post.setSize(window.innerWidth, window.innerHeight);
    }, 80);
  }

  // Eases the camera's distance to the target without touching its angle, so OrbitControls
  // keeps full ownership of rotation and its damping is undisturbed.
  updateCameraIntro(now) {
    if (!this.intro) return;

    const progress = Math.min(1, (now - this.intro.start) / this.intro.duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    const distance = this.THREE.MathUtils.lerp(this.intro.from, this.intro.to, eased);

    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    this.camera.position.copy(this.controls.target).add(direction.multiplyScalar(distance));

    if (progress >= 1) this.intro = null;
  }

  clearHover() {
    window.clearTimeout(this.previewTimer);
    this.hoveredEntry = null;
    this.hoveredStar = null;
    this.tooltip.style.opacity = "0";
    this.tooltip.setAttribute("aria-hidden", "true");
    document.body.style.cursor = "default";
  }

  handlePointerMove(event) {
    if (event.pointerType === "touch") this.hoverTracking = false;
    else if (event.pointerType === "mouse") this.hoverTracking = true;

    this.pointerClient.x = event.clientX;
    this.pointerClient.y = event.clientY;

    // Moving means orbiting, not pressing.
    if (this.touch.pending) {
      const moved =
        Math.abs(event.clientX - this.touch.pending.x) + Math.abs(event.clientY - this.touch.pending.y);
      if (moved > 10) this.clearLongPress();
    }

  }

  // Screen-space picking, not a raycast. A raycast against a sprite only hits its actual
  // geometry, and stars are 3-10 world units, so most of them were effectively unhittable —
  // especially with a fingertip. Projecting every star and taking the nearest within a pixel
  // tolerance makes every star reachable, and matches what the user can actually see.
  pickEntryAt(clientX, clientY, tolerance) {
    let best = null;
    let bestDistance = Infinity;

    for (let i = 0; i < this.diaryStars.length; i += 1) {
      const star = this.diaryStars[i];
      if ((star.userData.currentOpacity ?? 1) <= 0.1) continue;

      const projected = star.position.clone().project(this.camera);
      if (projected.z > 1) continue;

      const sx = (projected.x * 0.5 + 0.5) * window.innerWidth;
      const sy = (-projected.y * 0.5 + 0.5) * window.innerHeight;
      const distance = Math.hypot(sx - clientX, sy - clientY);

      if (distance <= tolerance && distance < bestDistance) {
        bestDistance = distance;
        best = star.userData.entry;
      }
    }

    return best;
  }

  handlePointerDown(event) {
    if (event.target !== this.renderer.domElement) return;

    // Touch: a tap glimpses, a long press opens. Both are decided on the way up or on the timer,
    // never on the way down, so a drag can still orbit the sky.
    if (event.pointerType === "touch") {
      this.clearLongPress();
      this.touch.pending = { x: event.clientX, y: event.clientY };
      this.touch.longPressed = false;
      this.touch.timer = window.setTimeout(() => this.openFromLongPress(), LONG_PRESS_MS);
      return;
    }

    // Pointing device: a click opens.
    const entry = this.pickEntryAt(event.clientX, event.clientY, MOUSE_PICK_PX);
    if (entry && this.onStarSelected) this.onStarSelected(entry);
  }

  handlePointerUp(event) {
    if (event.pointerType !== "touch") return;

    const pending = this.touch.pending;
    const longPressed = this.touch.longPressed;
    this.clearLongPress();

    // The long press already opened the night; the lift means nothing more.
    if (longPressed || !pending || event.type === "pointercancel") return;

    // A tap glimpses.
    const entry = this.pickEntryAt(pending.x, pending.y, TOUCH_PICK_PX);
    if (entry) this.showPreview(entry, pending.x, pending.y, { autoHide: true });
    else this.clearHover();
  }

  openFromLongPress() {
    const pending = this.touch.pending;
    if (!pending) return;

    this.touch.longPressed = true;
    const entry = this.pickEntryAt(pending.x, pending.y, TOUCH_PICK_PX);
    if (!entry) return;

    this.clearHover();
    if (this.onStarSelected) this.onStarSelected(entry);
  }

  clearLongPress() {
    window.clearTimeout(this.touch.timer);
    this.touch.timer = null;
    this.touch.pending = null;
  }

  showLongPressPreview() {
    const pending = this.touch.pending;
    if (!pending) return;

    const entry = this.entryAt(pending.x, pending.y);
    if (!entry) return;

    this.touch.longPressed = true;
    this.showPreview(entry, pending.x, pending.y);
  }

  // Clamped so the card never hangs off either edge.
  positionPreview(clientX, clientY) {
    const clamped = Math.min(Math.max(clientX, 150), window.innerWidth - 150);
    this.tooltip.style.left = `${clamped}px`;
    this.tooltip.style.top = `${clientY}px`;
  }

  // Shared by hover and tap: first 80 characters, then the mood dot and the date.
  showPreview(entry, clientX, clientY, { autoHide = false } = {}) {
    const cfg = SENTIMENT_CONFIG[entry.sentiment] || SENTIMENT_CONFIG.neutral;
    const when = new Date(entry.createdAt).toLocaleDateString(undefined, {
      day: "numeric",
      month: "long"
    });

    this.tooltip.innerHTML =
      `<span class="preview-text">${escapeHtml(buildEntryPreview(entry.text))}</span>` +
      `<span class="preview-meta"><i style="background:${cfg.color};box-shadow:0 0 12px ${cfg.color}"></i>` +
      `${escapeHtml(when)} · ${escapeHtml(cfg.label)}</span>`;

    this.positionPreview(clientX, clientY);
    this.tooltip.style.opacity = "1";
    this.tooltip.setAttribute("aria-hidden", "false");

    window.clearTimeout(this.previewTimer);
    if (autoHide) {
      // No pointer-out on touch, so the glimpse fades on its own.
      this.previewTimer = window.setTimeout(() => this.clearHover(), PREVIEW_HOLD_MS);
    }
  }

  updateHoverState() {
    if (!this.hoverTracking) return;

    const entry = this.pickEntryAt(this.pointerClient.x, this.pointerClient.y, MOUSE_PICK_PX);

    if (entry) {
      if (entry !== this.hoveredEntry) {
        this.hoveredEntry = entry;
        this.showPreview(entry, this.pointerClient.x, this.pointerClient.y);
      } else {
        this.positionPreview(this.pointerClient.x, this.pointerClient.y);
      }
      document.body.style.cursor = "pointer";
    } else if (this.hoveredEntry) {
      this.hoveredEntry = null;
      this.clearHover();
    }
  }

  addConstellationLinks(newStar) {
    const sentiment = newStar.userData.entry.sentiment;
    const candidates = [];

    for (let i = 0; i < this.diaryStars.length; i += 1) {
      const other = this.diaryStars[i];
      if (other === newStar) continue;
      if (other.userData.entry.sentiment !== sentiment) continue;
      candidates.push(other);
    }

    if (candidates.length === 0) return;

    candidates.sort((a, b) => newStar.position.distanceToSquared(a.position) - newStar.position.distanceToSquared(b.position));

    const cfg = SENTIMENT_CONFIG[sentiment] || SENTIMENT_CONFIG.neutral;
    const linkCount = Math.min(2, candidates.length);

    for (let i = 0; i < linkCount; i += 1) {
      const target = candidates[i];
      if (newStar.position.distanceTo(target.position) > MAX_SENTIMENT_LINK_DISTANCE) break;
      const points = [newStar.position.clone(), target.position.clone()];
      const geometry = new this.THREE.BufferGeometry().setFromPoints(points);
      const material = new this.THREE.LineBasicMaterial({
        color: new this.THREE.Color(cfg.color),
        transparent: true,
        opacity: 0.11,
        depthWrite: false
      });

      const line = new this.THREE.Line(geometry, material);
      this.constellationGroup.add(line);
    }
  }

  getEntryScreenPosition(entryId) {
    const star = this.diaryStars.find((candidate) => candidate.userData.entry.id === entryId);
    if (!star) return null;

    const projected = star.position.clone().project(this.camera);
    return {
      x: (projected.x * 0.5 + 0.5) * window.innerWidth,
      y: (-projected.y * 0.5 + 0.5) * window.innerHeight,
      onScreen: projected.z < 1
    };
  }

  // Entries oldest-first, for stepping between nights in the reader.
  getEntriesChronological() {
    return [...this.diaryEntries].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }

  // The sky holds still while a night is being read.
  setDrift(enabled) {
    this.driftEnabled = enabled;
    this.controls.autoRotate = enabled;
  }

  // ── Streak trail ─────────────────────────────────────────
  // Consecutive journalling days are joined in chronological order, so a streak is a
  // constellation the user watches themselves draw rather than a number on a chip.

  setStreakData(data) {
    this.streakData = data && data.visible ? data : null;
    this.rebuildStreakTrail();
  }

  updateStreakVisibility() {
    this.streakGroup.visible = Boolean(this.streakData) && !this.filterDate;
  }

  disposeStreakTrail() {
    while (this.streakGroup.children.length > 0) {
      const line = this.streakGroup.children[0];
      this.streakGroup.remove(line);
      if (line.geometry) line.geometry.dispose();
      if (line.material) line.material.dispose();
    }

    this.streakLines = { history: null, active: null, bridge: null, sweep: null };
    this.activeSegments = [];
    this.trailDraw = null;
    this.trailSweep = null;
  }

  // A day with several entries contributes one node — its first star — so the trail tracks
  // days, not volume.
  firstStarByLocalDate() {
    const byDate = new Map();

    for (let i = 0; i < this.diaryStars.length; i += 1) {
      const star = this.diaryStars[i];
      const date = localDateString(star.userData.entry.createdAt);
      const existing = byDate.get(date);

      if (!existing || Date.parse(star.userData.entry.createdAt) < Date.parse(existing.userData.entry.createdAt)) {
        byDate.set(date, star);
      }
    }

    return byDate;
  }

  buildStreakSegments() {
    const byDate = this.firstStarByLocalDate();
    const dates = [...byDate.keys()].sort();
    const rested = new Set(this.streakData?.restedDates || []);
    const runStart = this.streakData?.currentRunStart || null;

    const history = [];
    const active = [];
    const bridge = [];

    this.activeSegments = [];

    for (let i = 1; i < dates.length; i += 1) {
      const from = byDate.get(dates[i - 1]).position;
      const to = byDate.get(dates[i]).position;
      const gap = dayGap(dates[i], dates[i - 1]);

      let bucket = null;

      if (gap === 1) {
        // Runs that have already ended stay in the sky, just dimmer and desaturated.
        bucket = runStart && dates[i - 1] >= runStart ? active : history;
      } else if (gap === 2 && rested.has(nextDay(dates[i - 1]))) {
        bucket = bridge;
      }

      if (!bucket) continue;

      bucket.push(from.x, from.y, from.z, to.x, to.y, to.z);
      if (bucket === active) {
        this.activeSegments.push([from.x, from.y, from.z, to.x, to.y, to.z]);
      }
    }

    return { history, active, bridge };
  }

  makeTrailMaterial(kind) {
    if (kind === "bridge") {
      // A bridged rest day is drawn, but drawn differently — the gap is not hidden.
      return new this.THREE.LineDashedMaterial({
        color: new this.THREE.Color(TRAIL_GOLD),
        transparent: true,
        opacity: BRIDGE_OPACITY,
        depthWrite: false,
        dashSize: 2.4,
        gapSize: 2.4
      });
    }

    return new this.THREE.LineBasicMaterial({
      color: new this.THREE.Color(kind === "active" ? TRAIL_GOLD : TRAIL_FADED),
      transparent: true,
      opacity: kind === "active" ? ACTIVE_OPACITY : HISTORY_OPACITY,
      depthWrite: false
    });
  }

  // One merged LineSegments per kind rather than an object per link: a 365-day trail stays
  // at a handful of draw calls (QA case 23).
  makeTrailLine(positions, kind) {
    if (positions.length === 0) return null;

    const geometry = new this.THREE.BufferGeometry();
    geometry.setAttribute("position", new this.THREE.Float32BufferAttribute(positions, 3));

    const line = new this.THREE.LineSegments(geometry, this.makeTrailMaterial(kind));
    if (kind === "bridge") line.computeLineDistances();

    this.streakGroup.add(line);
    return line;
  }

  makeSweepLine() {
    const geometry = new this.THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new this.THREE.Float32BufferAttribute(new Float32Array(SWEEP_WINDOW * 6), 3)
    );

    const material = new this.THREE.LineBasicMaterial({
      color: new this.THREE.Color(TRAIL_GOLD),
      transparent: true,
      opacity: 0,
      depthWrite: false
    });

    const line = new this.THREE.LineSegments(geometry, material);
    this.streakGroup.add(line);
    return line;
  }

  rebuildStreakTrail() {
    this.disposeStreakTrail();
    this.updateStreakVisibility();

    if (!this.streakData) return;

    const { history, active, bridge } = this.buildStreakSegments();

    this.streakLines.history = this.makeTrailLine(history, "history");
    this.streakLines.active = this.makeTrailLine(active, "active");
    this.streakLines.bridge = this.makeTrailLine(bridge, "bridge");

    if (this.activeSegments.length > 0) {
      this.streakLines.sweep = this.makeSweepLine();
    }
  }

  // Step 2 of the reward beat: the newest segment grows out of yesterday's star.
  playTrailDraw() {
    const line = this.streakLines.active;
    if (!line || this.prefersReducedMotion) return;

    const attribute = line.geometry.getAttribute("position");
    if (attribute.count < 2) return;

    const tailIndex = attribute.count - 1;
    const anchorIndex = attribute.count - 2;

    this.trailDraw = {
      attribute,
      index: tailIndex,
      from: {
        x: attribute.getX(anchorIndex),
        y: attribute.getY(anchorIndex),
        z: attribute.getZ(anchorIndex)
      },
      to: {
        x: attribute.getX(tailIndex),
        y: attribute.getY(tailIndex),
        z: attribute.getZ(tailIndex)
      },
      start: performance.now()
    };

    attribute.setXYZ(tailIndex, this.trailDraw.from.x, this.trailDraw.from.y, this.trailDraw.from.z);
    attribute.needsUpdate = true;
  }

  // Step 1 of the reward beat.
  flareEntry(entryId) {
    for (let i = 0; i < this.diaryStars.length; i += 1) {
      if (this.diaryStars[i].userData.entry.id === entryId) {
        this.diaryStars[i].userData.flareStart = performance.now();
        return;
      }
    }
  }

  // Milestone: a highlight travels the length of the run, once.
  playMilestoneSweep() {
    if (this.prefersReducedMotion) return;
    if (!this.streakLines.sweep || this.activeSegments.length === 0) return;

    this.trailSweep = { start: performance.now() };
  }

  updateTrailDraw(now) {
    if (!this.trailDraw) return;

    const { attribute, index, from, to, start } = this.trailDraw;
    const progress = Math.min(1, (now - start) / DRAW_DURATION_MS);
    const eased = 1 - Math.pow(1 - progress, 3);

    attribute.setXYZ(
      index,
      from.x + (to.x - from.x) * eased,
      from.y + (to.y - from.y) * eased,
      from.z + (to.z - from.z) * eased
    );
    attribute.needsUpdate = true;

    if (progress >= 1) this.trailDraw = null;
  }

  updateTrailSweep(now) {
    const sweep = this.streakLines.sweep;
    if (!this.trailSweep || !sweep) return;

    const segments = this.activeSegments;
    const progress = (now - this.trailSweep.start) / SWEEP_DURATION_MS;

    if (progress >= 1 || segments.length === 0) {
      this.trailSweep = null;
      sweep.material.opacity = 0;
      return;
    }

    const attribute = sweep.geometry.getAttribute("position");
    const head = Math.floor(progress * segments.length);

    for (let s = 0; s < SWEEP_WINDOW; s += 1) {
      const segment = segments[Math.max(0, Math.min(segments.length - 1, head - s))];
      for (let k = 0; k < 6; k += 1) {
        attribute.array[s * 6 + k] = segment[k];
      }
    }

    attribute.needsUpdate = true;
    sweep.material.opacity = 0.85 * Math.sin(Math.PI * progress);
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const now = performance.now();
    const t = now * 0.001;
    this.backgroundField.rotation.y += 0.00018;
    this.backgroundField.rotation.x = Math.sin(t * 0.03) * 0.02;

    for (let i = 0; i < this.diaryStars.length; i += 1) {
      const star = this.diaryStars[i];
      const pulse = 1 + Math.sin(t * 1.5 + star.userData.pulseOffset) * 0.08;

      const current = star.userData.currentOpacity ?? 1;
      const target = star.userData.targetOpacity ?? 1;
      if (current !== target) {
        const next = current + (target - current) * 0.07;
        star.userData.currentOpacity = Math.abs(next - target) < 0.002 ? target : next;
        star.material.opacity = star.userData.currentOpacity;
      }

      let flare = 1;
      if (star.userData.flareStart) {
        const progress = (now - star.userData.flareStart) / FLARE_DURATION_MS;
        if (progress >= 1) {
          star.userData.flareStart = null;
        } else {
          flare = 1 + 0.3 * Math.sin(Math.PI * progress);
        }
      }

      star.scale.setScalar(star.userData.baseScale * pulse * flare);
    }

    if (this.streakLines.active && !this.prefersReducedMotion) {
      this.streakLines.active.material.opacity = ACTIVE_OPACITY + Math.sin(t * 1.1) * 0.06;
    }

    this.updateTrailDraw(now);
    this.updateTrailSweep(now);

    for (let i = 0; i < this.constellationGroup.children.length; i += 1) {
      const line = this.constellationGroup.children[i];
      const curr = line.material.opacity;
      const tgt = this.constellationTargetOpacity;
      if (curr !== tgt) {
        const next = curr + (tgt - curr) * 0.07;
        line.material.opacity = Math.abs(next - tgt) < 0.001 ? tgt : next;
      }
    }

    // A very slow drift of the orbit centre keeps the composition alive when nobody is
    // touching it, without ever moving enough to feel like the page is doing something.
    if (this.quality.cameraMotion && this.driftEnabled) {
      this.controls.target.y = this.contentCentre.y + Math.sin(t * 0.06) * 2.6;
      this.controls.target.x = this.contentCentre.x + Math.cos(t * 0.043) * 1.8;
      this.controls.target.z = this.contentCentre.z;
    }

    this.updateCameraIntro(now);
    this.updateHoverState();
    this.controls.update();

    this.post.update(t);
    this.post.composer.render();
  }
}
