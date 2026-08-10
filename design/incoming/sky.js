// <night-sky> — a canvas stand-in for the app's live three.js scene, so interface work can be
// judged over the real thing. Positions use public/js/three/layout.js verbatim, colours use
// public/js/config/sentiment.js, the glow falloff copies createGlowTexture() in galaxy-utils.js,
// and the background field copies createBackgroundStarfield().
(function () {
  const SENT = { positive: "#f5c96a", neutral: "#f2f4ff", negative: "#72a6ff", reflective: "#8457db" };
  const TRAIL_GOLD = "#f5c96a";
  const TRAIL_FADED = "#8fa1bd";
  const MS_PER_DAY = 86400000, TAU = Math.PI * 2;
  const DAYS_PER_TURN = 96, RADIUS_MIN = 22, RADIUS_K = 13, RADIUS_EXP = 0.42;
  const WAVE_AMPLITUDE = 5.5, WAVE_PERIOD_DAYS = 47, JITTER = 2.6;
  const SENTIMENT_LIFT = { positive: 5.5, reflective: 2, neutral: 0, negative: -5.5 };

  function hash01(value) {
    let h = 2166136261; const str = String(value);
    for (let i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 100000) / 100000;
  }

  function galaxyPosition(createdAt, sentiment, epochMs) {
    const created = Date.parse(createdAt);
    const t = Math.max(0, (created - epochMs) / MS_PER_DAY);
    const angle = t * (TAU / DAYS_PER_TURN);
    const radialJitter = (hash01(createdAt) - 0.5) * 2 * JITTER;
    const radius = RADIUS_MIN + RADIUS_K * Math.pow(t, RADIUS_EXP) + radialJitter;
    return {
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      y: Math.sin(t * (TAU / WAVE_PERIOD_DAYS)) * WAVE_AMPLITUDE +
        (SENTIMENT_LIFT[sentiment] ?? 0) + (hash01(createdAt + "|y") - 0.5) * 2 * JITTER
    };
  }

  function localDate(iso) { return String(iso).slice(0, 10); }

  class NightSky extends HTMLElement {
    connectedCallback() {
      if (this._built) return;
      this._built = true;
      const root = this.attachShadow({ mode: "open" });
      root.innerHTML = '<style>:host{display:block;position:relative;overflow:hidden;background:radial-gradient(circle at 20% 18%,#07122e 0%,#03050f 38%,#000 100%)}canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none}</style><canvas></canvas>';
      this.canvas = root.querySelector("canvas");
      this.ctx = this.canvas.getContext("2d");
      this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.yaw = 0.62; this.pitch = 0.58; this.zoom = 1;
      this.entries = []; this.projected = []; this.focusDay = null; this.dim = 0;
      this.hovered = null; this.flares = new Map(); this.pulse = 0;
      this.pointer = null; this.w = 0; this.h = 0; this.t0 = performance.now();

      this._makeField();
      this._noise();
      this._bind();
      this._ro = new ResizeObserver(() => this._resize());
      this._ro.observe(this);
      this._resize();
      if (window.DIARY_ENTRIES && !this.entries.length) this.setEntries(window.DIARY_ENTRIES);
      this._loop = this._loop.bind(this);
      requestAnimationFrame(this._loop);
    }

    disconnectedCallback() { if (this._ro) this._ro.disconnect(); this._stopped = true; }

    _makeField() {
      const mobile = matchMedia("(max-width: 640px)").matches;
      const count = this.hasAttribute("stars") ? Number(this.getAttribute("stars")) : (mobile ? 420 : 760);
      const bg = [];
      for (let i = 0; i < count; i += 1) {
        const radius = 340 + Math.random() * 520;
        const theta = Math.random() * TAU;
        const phi = Math.acos(2 * Math.random() - 1);
        const tone = 0.6 + Math.random() * 0.4;
        bg.push({
          x: radius * Math.sin(phi) * Math.cos(theta), y: radius * Math.cos(phi),
          z: radius * Math.sin(phi) * Math.sin(theta),
          a: tone * 0.68, s: 0.6 + Math.random() * 0.9, tw: Math.random() * TAU
        });
      }
      this.bg = bg;
      const dust = [];
      const dustCount = mobile ? 520 : 900;
      for (let i = 0; i < dustCount; i += 1) {
        const t = Math.pow(Math.random(), 0.72) * 460;
        const angle = t * (TAU / DAYS_PER_TURN) + (Math.random() - 0.5) * 0.22;
        const radius = RADIUS_MIN + RADIUS_K * Math.pow(t, RADIUS_EXP) + (Math.random() - 0.5) * 13;
        dust.push({
          x: Math.cos(angle) * radius, z: Math.sin(angle) * radius,
          y: Math.sin(t * (TAU / WAVE_PERIOD_DAYS)) * WAVE_AMPLITUDE + (Math.random() - 0.5) * 9,
          a: 0.1 + Math.random() * 0.26, s: 0.5 + Math.random() * 0.7
        });
      }
      this.dust = dust;
    }

    _noise() {
      const n = document.createElement("canvas"); n.width = n.height = 72;
      const c = n.getContext("2d"); const img = c.createImageData(72, 72);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 120 + Math.random() * 135;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
      }
      c.putImageData(img, 0, 0);
      this.grain = n;
    }

    _bind() {
      const el = this.canvas;
      el.addEventListener("pointerdown", (e) => {
        el.setPointerCapture(e.pointerId);
        this.pointer = { x: e.clientX, y: e.clientY, moved: 0, t: performance.now(), id: e.pointerId };
        this._pressTimer = setTimeout(() => {
          const hit = this._hit(e);
          if (hit && this.pointer && this.pointer.moved < 6) this._emitHover(hit, e);
        }, 380);
      });
      el.addEventListener("pointermove", (e) => {
        if (this.pointer && e.pointerId === this.pointer.id) {
          const dx = e.clientX - this.pointer.x, dy = e.clientY - this.pointer.y;
          this.pointer.moved += Math.abs(dx) + Math.abs(dy);
          this.yaw += dx * 0.005; this.pitch = Math.max(-1.15, Math.min(1.15, this.pitch + dy * 0.004));
          this.pointer.x = e.clientX; this.pointer.y = e.clientY;
          if (this.pointer.moved > 8) { clearTimeout(this._pressTimer); this._emitHover(null); }
          return;
        }
        if (e.pointerType === "mouse") {
          const hit = this._hit(e);
          if (hit !== this.hovered) this._emitHover(hit, e);
          else if (hit) this._emitHover(hit, e);
        }
      });
      const end = (e) => {
        clearTimeout(this._pressTimer);
        const p = this.pointer;
        this.pointer = null;
        if (!p || p.moved > 8) return;
        const hit = this._hit(e);
        if (hit) this.dispatchEvent(new CustomEvent("star-open", { detail: hit, bubbles: true, composed: true }));
        else this.dispatchEvent(new CustomEvent("sky-tap", { bubbles: true, composed: true }));
        if (e.pointerType !== "mouse") this._emitHover(null);
      };
      el.addEventListener("pointerup", end);
      el.addEventListener("pointercancel", () => { clearTimeout(this._pressTimer); this.pointer = null; });
      el.addEventListener("pointerleave", () => this._emitHover(null));
      el.addEventListener("wheel", (e) => {
        e.preventDefault();
        this.zoom = Math.max(0.55, Math.min(2.6, this.zoom * (1 - e.deltaY * 0.0012)));
      }, { passive: false });
    }

    _emitHover(hit, e) {
      this.hovered = hit;
      const detail = hit ? { entry: hit, x: hit._sx, y: hit._sy, pointer: e ? { x: e.clientX, y: e.clientY } : null } : null;
      this.dispatchEvent(new CustomEvent("star-hover", { detail, bubbles: true, composed: true }));
    }

    _hit(e) {
      const r = this.canvas.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      let best = null, bestD = 26;
      for (const p of this.projected) {
        const d = Math.hypot(p._sx - px, p._sy - py);
        if (d < bestD) { bestD = d; best = p; }
      }
      return best;
    }

    setEntries(list) {
      this.entries = (list || []).slice().sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
      this.epoch = this.entries.length ? Date.parse(this.entries[0].createdAt) : Date.now();
      for (const en of this.entries) en._p = galaxyPosition(en.createdAt, en.sentiment, this.epoch);
      this._buildTrail();
    }

    addEntry(entry) {
      entry._p = galaxyPosition(entry.createdAt, entry.sentiment, this.epoch || Date.parse(entry.createdAt));
      this.entries.push(entry);
      this._buildTrail();
      this.flare(entry.id);
      this.pulse = performance.now();
    }

    _buildTrail() {
      const byDay = new Map();
      for (const en of this.entries) { const d = localDate(en.createdAt); if (!byDay.has(d)) byDay.set(d, en); }
      const days = Array.from(byDay.keys()).sort();
      const rest = new Set(window.DIARY_REST_DAYS || []);
      const last = days.length ? Date.parse(days[days.length - 1]) : 0;
      const segs = [];
      for (let i = 1; i < days.length; i += 1) {
        const a = Date.parse(days[i - 1]);
        const b = Date.parse(days[i]);
        const gap = Math.round((b - a) / MS_PER_DAY);
        let kind = null;
        if (gap === 1) kind = "active";
        else if (gap === 2 && rest.has(new Date(a + MS_PER_DAY).toISOString().slice(0, 10))) kind = "bridge";
        if (!kind) continue;
        if (last - b > 9 * MS_PER_DAY && kind === "active") kind = "history";
        segs.push({ a: byDay.get(days[i - 1]), b: byDay.get(days[i]), kind: kind });
      }
      this.segments = segs;
    }

    flare(id) { this.flares.set(id, performance.now()); }
    setFrozen(v) { this.frozen = !!v; }
    focusDate(day) { this.focusDay = day || null; }
    setDim(v) { this.dimTarget = v; }
    screenPosOf(id) { const p = this.projected.find((e) => e.id === id); return p ? { x: p._sx, y: p._sy } : null; }

    _resize() {
      const r = this.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, matchMedia("(max-width:640px)").matches ? 1.5 : 2);
      this.w = r.width; this.h = r.height;
      this.canvas.width = Math.max(1, Math.round(r.width * dpr));
      this.canvas.height = Math.max(1, Math.round(r.height * dpr));
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    _project(p, cx, cy, k, cosY, sinY, cosP, sinP) {
      const x1 = p.x * cosY - p.z * sinY;
      const z1 = p.x * sinY + p.z * cosY;
      const y2 = p.y * cosP - z1 * sinP;
      const z2 = p.y * sinP + z1 * cosP;
      const d = 520 + z2;
      if (d < 40) return null;
      const s = (640 / d) * k;
      return { sx: cx + x1 * s, sy: cy - y2 * s, s, z: z2 };
    }

    _glow(ctx, x, y, r, color, alpha) {
      const g = ctx.createRadialGradient(x, y, Math.max(0.4, r * 0.03), x, y, r);
      g.addColorStop(0, "rgba(255,255,255," + alpha + ")");
      g.addColorStop(0.15, "rgba(255,255,255," + alpha * 0.95 + ")");
      g.addColorStop(0.45, this._rgba(color, alpha * 0.3));
      g.addColorStop(1, this._rgba(color, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    }

    _rgba(hex, a) {
      const n = parseInt(hex.slice(1), 16);
      return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
    }

    _loop(now) {
      if (this._stopped) return;
      requestAnimationFrame(this._loop);
      if (!this.w || !this.h) return;
      const ctx = this.ctx, w = this.w, h = this.h;
      const t = (now - this.t0) / 1000;
      if (!this.reduced && !this.pointer && !this.frozen) this.yaw += 0.00022;

      this.dim += ((this.dimTarget || 0) - this.dim) * 0.12;

      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2;
      const k = (Math.min(w, h) / 285) * this.zoom;
      const kbg = (Math.min(w, h) / 620) * this.zoom * 0.38;
      const cosY = Math.cos(this.yaw), sinY = Math.sin(this.yaw);
      const cosP = Math.cos(this.pitch), sinP = Math.sin(this.pitch);

      ctx.globalCompositeOperation = "lighter";
      for (const s of this.bg) {
        const p = this._project(s, cx, cy, kbg, cosY, sinY, cosP, sinP);
        if (!p || p.sx < -20 || p.sx > w + 20 || p.sy < -20 || p.sy > h + 20) continue;
        const tw = this.reduced ? 1 : 0.72 + Math.sin(t * 1.3 + s.tw) * 0.28;
        ctx.fillStyle = "rgba(226,234,255," + (s.a * tw * (1 - this.dim * 0.55)).toFixed(3) + ")";
        ctx.fillRect(p.sx, p.sy, s.s, s.s);
      }
      for (const d of this.dust) {
        const p = this._project(d, cx, cy, k, cosY, sinY, cosP, sinP);
        if (!p || p.sx < -20 || p.sx > w + 20 || p.sy < -20 || p.sy > h + 20) continue;
        ctx.fillStyle = "rgba(198,214,255," + (d.a * (1 - this.dim * 0.6)).toFixed(3) + ")";
        ctx.fillRect(p.sx, p.sy, d.s * p.s * 0.9, d.s * p.s * 0.9);
      }

      this.projected = [];
      for (const en of this.entries) {
        const p = this._project(en._p, cx, cy, k, cosY, sinY, cosP, sinP);
        if (!p) continue;
        en._sx = p.sx; en._sy = p.sy; en._ss = p.s;
        this.projected.push(en);
      }

      const pulseAge = this.pulse ? (now - this.pulse) / 900 : 2;
      ctx.lineCap = "round";
      for (const seg of this.segments || []) {
        if (seg.a._sx === undefined || seg.b._sx === undefined) continue;
        const active = seg.kind === "active";
        const col = active || seg.kind === "bridge" ? TRAIL_GOLD : TRAIL_FADED;
        let a = (active ? 0.62 : seg.kind === "bridge" ? 0.34 : 0.22) * (1 - this.dim * 0.7);
        if (this.focusDay) a *= 0.25;
        if (seg.kind === "bridge") ctx.setLineDash([4, 6]); else ctx.setLineDash([]);
        if (pulseAge < 1 && active) a += (1 - pulseAge) * 0.5;
        ctx.strokeStyle = this._rgba(col, a);
        ctx.lineWidth = active ? 1.4 : 1.1;
        ctx.beginPath(); ctx.moveTo(seg.a._sx, seg.a._sy); ctx.lineTo(seg.b._sx, seg.b._sy); ctx.stroke();
      }
      ctx.setLineDash([]);

      for (const en of this.projected) {
        const color = SENT[en.sentiment] || SENT.neutral;
        const focused = !this.focusDay || localDate(en.createdAt) === this.focusDay;
        let alpha = (focused ? 0.95 : 0.13) * (1 - this.dim * 0.45);
        let radius = Math.max(6, 4.2 * en._ss);
        const fl = this.flares.get(en.id);
        if (fl !== undefined) {
          const age = (now - fl) / 1400;
          if (age > 1) this.flares.delete(en.id);
          else { alpha = Math.min(1, alpha + (1 - age) * 0.6); radius *= 1 + (1 - age) * 1.5; }
        }
        if (this.hovered === en) { radius *= 1.35; alpha = Math.min(1, alpha + 0.15); }
        this._glow(ctx, en._sx, en._sy, radius, color, alpha);
      }
      ctx.globalCompositeOperation = "source-over";

      const vg = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.28, cx, cy, Math.max(w, h) * 0.78);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,0,0,0.55)");
      ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);

      if (!this._pattern) this._pattern = ctx.createPattern(this.grain, "repeat");
      ctx.globalAlpha = 0.022; ctx.fillStyle = this._pattern; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1;
    }
  }

  if (!customElements.get("night-sky")) customElements.define("night-sky", NightSky);
})();
