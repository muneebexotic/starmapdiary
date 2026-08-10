import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SENTIMENT_CONFIG } from "../config/sentiment.js";
import { buildEntryPreview, escapeHtml, formatDate } from "../utils/formatters.js";
import { createBackgroundStarfield, createGlowTexture, randomPositionInGalaxy } from "./galaxy-utils.js";
import { detectQuality } from "./quality.js";
import { createComposer } from "./post.js";

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
    this.camera.position.set(0, 22, 170);

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
    this.controls.maxDistance = 360;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.22;

    // No lights: every material in this scene (sprites, points, lines) is unlit, so the
    // AmbientLight and PointLight that used to be here contributed nothing to any pixel.

    this.pointer = new this.THREE.Vector2();
    this.raycaster = new this.THREE.Raycaster();

    this.diaryEntries = [];
    this.diaryStars = [];
    this.hoveredStar = null;
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

    window.addEventListener("resize", this.handleResize);
    window.addEventListener("pointermove", this.handlePointerMove);
    window.addEventListener("pointerdown", this.handlePointerDown);

    this.animate();
  }

  getSuggestedPosition(sentiment, createdAt) {
    return randomPositionInGalaxy({
      THREE: this.THREE,
      sentiment,
      createdAt,
      entries: this.diaryEntries
    });
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
    const cfg = SENTIMENT_CONFIG[entry.sentiment] || SENTIMENT_CONFIG.neutral;
    const lenFactor = Math.min(String(entry.text || "").length, 800);
    const size = this.THREE.MathUtils.mapLinear(lenFactor, 1, 800, 5, 20);

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
    this.hoveredStar = null;
    this.tooltip.style.opacity = "0";
    this.tooltip.setAttribute("aria-hidden", "true");
    document.body.style.cursor = "default";
  }

  handlePointerMove(event) {
    this.pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;

    if (this.hoveredStar) {
      const text = this.hoveredStar.userData.entry.text;
      const preview = buildEntryPreview(text);
      this.tooltip.innerHTML = `<strong>${escapeHtml(preview)}</strong><br>${formatDate(this.hoveredStar.userData.entry.createdAt)}`;
      this.tooltip.style.left = `${event.clientX}px`;
      this.tooltip.style.top = `${event.clientY}px`;
    }
  }

  handlePointerDown(event) {
    if (event.target !== this.renderer.domElement) return;
    this.pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const hittable = this.diaryStars.filter(s => (s.userData.currentOpacity ?? 1) > 0.1);
    const intersects = this.raycaster.intersectObjects(hittable, false);
    if (intersects.length > 0 && this.onStarSelected) {
      this.onStarSelected(intersects[0].object.userData.entry);
    }
  }

  updateHoverState() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hittable = this.diaryStars.filter(s => (s.userData.currentOpacity ?? 1) > 0.1);
    const intersects = this.raycaster.intersectObjects(hittable, false);

    if (intersects.length > 0) {
      this.hoveredStar = intersects[0].object;
      this.tooltip.style.opacity = "1";
      this.tooltip.setAttribute("aria-hidden", "false");
      document.body.style.cursor = "pointer";
    } else {
      this.hoveredStar = null;
      this.tooltip.style.opacity = "0";
      this.tooltip.setAttribute("aria-hidden", "true");
      document.body.style.cursor = "default";
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
    if (this.quality.cameraMotion) {
      this.controls.target.y = Math.sin(t * 0.06) * 2.6;
      this.controls.target.x = Math.cos(t * 0.043) * 1.8;
    }

    this.updateCameraIntro(now);
    this.updateHoverState();
    this.controls.update();

    this.post.update(t);
    this.post.composer.render();
  }
}
