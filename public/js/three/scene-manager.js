import { SENTIMENT_CONFIG } from "../config/sentiment.js";
import { buildEntryPreview, escapeHtml, formatDate } from "../utils/formatters.js";
import { createBackgroundStarfield, createGlowTexture, randomPositionInGalaxy } from "./galaxy-utils.js";

export class SceneManager {
  constructor({ container, tooltip, onStarSelected }) {
    this.container = container;
    this.tooltip = tooltip;
    this.onStarSelected = onStarSelected;

    this.THREE = globalThis.THREE;
    this.OrbitControls = this.THREE?.OrbitControls || globalThis.OrbitControls;

    if (!this.THREE || !this.OrbitControls) {
      throw new Error("Three.js or OrbitControls failed to load.");
    }

    this.scene = new this.THREE.Scene();
    this.camera = new this.THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1200);
    this.camera.position.set(0, 22, 170);

    this.renderer = new this.THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.container.appendChild(this.renderer.domElement);

    this.controls = new this.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 38;
    this.controls.maxDistance = 360;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.22;

    const ambient = new this.THREE.AmbientLight(0xffffff, 0.75);
    const pointLight = new this.THREE.PointLight(0x9cc3ff, 0.4, 700);
    pointLight.position.set(70, 80, 80);

    this.scene.add(ambient);
    this.scene.add(pointLight);

    this.pointer = new this.THREE.Vector2();
    this.raycaster = new this.THREE.Raycaster();

    this.diaryEntries = [];
    this.diaryStars = [];
    this.hoveredStar = null;

    this.constellationGroup = new this.THREE.Group();
    this.scene.add(this.constellationGroup);

    this.starTexture = createGlowTexture(this.THREE);
    this.backgroundField = createBackgroundStarfield(this.THREE);
    this.scene.add(this.backgroundField);

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

  clearEntries() {
    this.hoveredStar = null;
    this.tooltip.style.opacity = "0";

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

    star.userData = {
      entry,
      baseScale: size,
      pulseOffset: Math.random() * Math.PI * 2
    };

    this.diaryEntries.push(entry);
    this.diaryStars.push(star);
    this.scene.add(star);
    this.addConstellationLinks(star);
  }

  handleResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
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
    this.pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const intersects = this.raycaster.intersectObjects(this.diaryStars, false);
    if (intersects.length > 0 && this.onStarSelected) {
      this.onStarSelected(intersects[0].object.userData.entry);
    }
  }

  updateHoverState() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersects = this.raycaster.intersectObjects(this.diaryStars, false);

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

  animate() {
    requestAnimationFrame(() => this.animate());

    const t = performance.now() * 0.001;
    this.backgroundField.rotation.y += 0.00018;
    this.backgroundField.rotation.x = Math.sin(t * 0.03) * 0.02;

    for (let i = 0; i < this.diaryStars.length; i += 1) {
      const star = this.diaryStars[i];
      const pulse = 1 + Math.sin(t * 1.5 + star.userData.pulseOffset) * 0.08;
      star.scale.setScalar(star.userData.baseScale * pulse);
    }

    this.updateHoverState();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
