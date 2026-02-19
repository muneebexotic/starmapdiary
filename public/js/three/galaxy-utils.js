export function createGlowTexture(THREE) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");

  const gradient = ctx.createRadialGradient(128, 128, 4, 128, 128, 128);
  gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
  gradient.addColorStop(0.15, "rgba(255, 255, 255, 0.95)");
  gradient.addColorStop(0.45, "rgba(255, 255, 255, 0.3)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export function createBackgroundStarfield(THREE) {
  const count = 1800;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i += 1) {
    const radius = 340 + Math.random() * 520;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);

    const x = radius * Math.sin(phi) * Math.cos(theta);
    const y = radius * Math.cos(phi);
    const z = radius * Math.sin(phi) * Math.sin(theta);

    const idx = i * 3;
    positions[idx] = x;
    positions[idx + 1] = y;
    positions[idx + 2] = z;

    const tone = 0.6 + Math.random() * 0.4;
    colors[idx] = tone;
    colors[idx + 1] = tone;
    colors[idx + 2] = tone + Math.random() * 0.08;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 1.55,
    vertexColors: true,
    transparent: true,
    opacity: 0.68,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  return new THREE.Points(geometry, material);
}

export function randomPositionInGalaxy({ THREE, sentiment, createdAt, entries }) {
  const zoneCenters = {
    positive: new THREE.Vector3(60, 40, 0),
    negative: new THREE.Vector3(-60, -40, 0),
    reflective: new THREE.Vector3(-50, 40, 0),
    neutral: new THREE.Vector3(0, 0, 0)
  };

  const zoneCenter = zoneCenters[sentiment] || zoneCenters.neutral;
  const zoneRadius = sentiment === "neutral" ? 82 : 95;

  const r = Math.cbrt(Math.random()) * zoneRadius;
  const theta = Math.random() * Math.PI * 2;
  const v = Math.random() * 2 - 1;
  const m = Math.sqrt(1 - v * v);

  const spawn = new THREE.Vector3(
    zoneCenter.x + r * m * Math.cos(theta),
    zoneCenter.y + r * v,
    zoneCenter.z + r * m * Math.sin(theta)
  );

  const createdTs = new Date(createdAt || Date.now()).getTime();
  let oldestTs = createdTs;
  let newestTs = createdTs;

  for (let i = 0; i < entries.length; i += 1) {
    const ts = new Date(entries[i] && entries[i].createdAt).getTime();
    if (!Number.isFinite(ts)) continue;
    if (ts < oldestTs) oldestTs = ts;
    if (ts > newestTs) newestTs = ts;
  }

  let timelineT = 0.5;
  if (newestTs > oldestTs) {
    timelineT = (createdTs - oldestTs) / (newestTs - oldestTs);
    timelineT = THREE.MathUtils.clamp(timelineT, 0, 1);
  }

  const zTimelineOffset = THREE.MathUtils.lerp(-45, 45, timelineT);
  spawn.z += zTimelineOffset;

  return { x: spawn.x, y: spawn.y, z: spawn.z };
}
