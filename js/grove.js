// The grove: a low-poly floating island rendered with Three.js.
// One tree per finished focus session, a lantern that burns while the streak lives,
// a sky that follows the clock, and rain for focus mode.
//
// Performance notes (phones matter):
// - Trees are drawn with InstancedMesh, one draw call per tree shape+colour, not one per tree part.
// - Static scenery (island, stones, grass, lantern body, each cloud) is merged into single meshes.
// - The camera orbits; the world stays still, so the shadow map is rendered only when something changes.
// - Resolution drops automatically if frames take too long.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hashString, seeded } from './util.js';

const MAX_TREES = 300;
const SLOT_STRIDE = 137; // coprime with MAX_TREES, so consecutive trees spread across the island
const ISLAND_R = 5;
const GROUND_Y = 0.25;
const POND = { x: 2.5, z: -1.7, r: 0.75 };
const FIREFLY_COUNT = 40;
const RAIN_DROPS = 520;
const GROW_MS = 1300;
const DEFAULT_TREE_COLOR = '#7D8C8A';
const TRUNK_COLOR = '#6B4A33';
const SLOW_FRAME_MS = 24; // average frame slower than this (~42 fps) lowers the resolution
const MIN_PIXEL_RATIO = 1;
const AUTO_ROTATE = { idle: 0.35, focus: 0.55 };
const UP = new THREE.Vector3(0, 1, 0);

const SKY = {
  dawn: { sky: '#ffd2b0', ground: '#5b5a48', hemi: 1.3, sun: '#ffb27a', sunI: 1.9, pos: [8, 4, 3], stars: 0.1 },
  day: { sky: '#dcefff', ground: '#58704a', hemi: 1.5, sun: '#fff4e2', sunI: 2.5, pos: [5, 10, 4], stars: 0 },
  dusk: { sky: '#f6b89c', ground: '#4a4560', hemi: 1.45, sun: '#ffa070', sunI: 1.8, pos: [-6, 6, 4], stars: 0.35 },
  night: { sky: '#6a80c0', ground: '#1c2438', hemi: 0.9, sun: '#b4c4ff', sunI: 0.8, pos: [-4, 9, 3], stars: 0.95 },
};

export function skyPhase(hour = new Date().getHours()) {
  if (hour >= 5 && hour < 8) return 'dawn';
  if (hour >= 8 && hour < 17) return 'day';
  if (hour >= 17 && hour < 20) return 'dusk';
  return 'night';
}

const easeOutBack = (t) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);

/* ---------- geometry helpers ---------- */

// Non-indexed copy with a flat vertex colour, so differently coloured parts can be merged into one mesh.
function paint(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const c = color instanceof THREE.Color ? color : new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

// Nudge vertices by a hash of their position, so seam duplicates move together.
function jitter(geo, amount, keep) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (keep(x, y, z)) continue;
    const r = seeded(hashString(`${Math.round(x * 40)},${Math.round(y * 40)},${Math.round(z * 40)}`));
    pos.setXYZ(i, x + (r() - 0.5) * amount, y + (r() - 0.5) * amount * 0.6, z + (r() - 0.5) * amount);
  }
  geo.computeVertexNormals();
  return geo;
}

const vertexMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92 });
const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.92, ...extra });

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,236,190,1)');
  grad.addColorStop(0.35, 'rgba(255,190,90,0.55)');
  grad.addColorStop(1, 'rgba(255,170,60,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---------- static scenery (merged) ---------- */

function buildIsland() {
  const parts = [];
  parts.push(paint(jitter(new THREE.CylinderGeometry(ISLAND_R, ISLAND_R - 0.2, 0.5, 30, 1), 0.18, (x, y) => y > 0), '#6FAE5F'));
  parts.push(paint(jitter(new THREE.CylinderGeometry(ISLAND_R - 0.2, ISLAND_R - 0.6, 0.6, 24, 1), 0.2, (x, y) => y > 0)
    .translate(0, -0.55, 0), '#7A5A3C'));
  const rock = jitter(new THREE.ConeGeometry(ISLAND_R - 0.6, 4.4, 12, 4), 0.55, (x, y) => y < -2.15);
  rock.rotateX(Math.PI).translate(0, -0.85 - 2.2, 0);
  parts.push(paint(rock, '#5D6769'));

  const r = seeded(7);
  for (let i = 0; i < 9; i++) {
    const a = r() * Math.PI * 2;
    const d = ISLAND_R - 0.5 - r() * 0.5;
    const s = 0.12 + r() * 0.18;
    const stone = new THREE.DodecahedronGeometry(s, 0);
    stone.rotateX(r() * 3).rotateY(r() * 3).rotateZ(r() * 3);
    parts.push(paint(stone.translate(Math.cos(a) * d, GROUND_Y + s * 0.4, Math.sin(a) * d), '#8C9493'));
  }
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2;
    const d = 1 + r() * (ISLAND_R - 1.4);
    parts.push(paint(new THREE.ConeGeometry(0.07, 0.22, 4).translate(Math.cos(a) * d, GROUND_Y + 0.1, Math.sin(a) * d), '#4F8F49'));
  }
  const island = new THREE.Mesh(mergeGeometries(parts), vertexMat);
  island.castShadow = true;
  island.receiveShadow = true;

  const pond = new THREE.Mesh(new THREE.CircleGeometry(POND.r, 9), mat('#5FA8C9', { roughness: 0.25, metalness: 0.1 }));
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(POND.x, GROUND_Y + 0.01, POND.z);
  pond.receiveShadow = true;
  return [island, pond];
}

function buildLantern(glowTex) {
  const body = new THREE.Mesh(mergeGeometries([
    paint(new THREE.CylinderGeometry(0.36, 0.42, 0.16, 7).translate(0, GROUND_Y + 0.08, 0), '#8C9493'),
    paint(new THREE.CylinderGeometry(0.06, 0.08, 1.3, 6).translate(0, GROUND_Y + 0.8, 0), '#3A2E25'),
    paint(new THREE.ConeGeometry(0.32, 0.24, 4).rotateY(Math.PI / 4).translate(0, GROUND_Y + 1.95, 0), '#2F2620'),
  ]), vertexMat);
  body.castShadow = true;
  const lampMat = mat('#FFD08A', { emissive: new THREE.Color('#FFB347'), emissiveIntensity: 1 });
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.34), lampMat);
  lamp.position.y = GROUND_Y + 1.62;
  const light = new THREE.PointLight('#FFB84D', 10, 8, 1.6);
  light.position.y = GROUND_Y + 1.62;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  }));
  glow.position.y = GROUND_Y + 1.62;
  const group = new THREE.Group();
  group.add(body, lamp, light, glow);
  return { group, lampMat, light, glow };
}

function buildClouds() {
  const cMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92, transparent: true, opacity: 0.92 });
  const r = seeded(21);
  return Array.from({ length: 3 }, (_, i) => {
    const puffs = Array.from({ length: 4 }, (__, j) =>
      paint(new THREE.IcosahedronGeometry(0.5 + r() * 0.4, 0).translate(j * 0.6 - 0.9, r() * 0.25, (r() - 0.5) * 0.4), '#FFFFFF'));
    const mesh = new THREE.Mesh(mergeGeometries(puffs), cMat);
    mesh.scale.setScalar(0.65);
    return { mesh, radius: 6.6 + i * 0.7, height: 2.6 + i * 0.6, angle: i * 2.1, speed: 0.025 + i * 0.008 };
  });
}

function makePoints(count, size, color, tex, opacity = 1) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const material = new THREE.PointsMaterial({
    size, color, map: tex, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geo, material);
}

/* ---------- trees (instanced) ---------- */

function slotPositions() {
  const pts = [];
  for (let k = 0; pts.length < MAX_TREES; k++) {
    const r = 1.35 + 3.35 * Math.sqrt((k + 0.5) / (MAX_TREES * 1.08));
    const a = k * 2.399963 + 0.4;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 0.35) continue;
    pts.push([x, z]);
  }
  return pts;
}

const TREE_PARTS = {
  trunk: new THREE.CylinderGeometry(0.06, 0.09, 0.5, 6).translate(0, 0.25, 0),
  pine: [
    new THREE.ConeGeometry(0.42, 0.75, 7).translate(0, 0.72, 0),
    new THREE.ConeGeometry(0.32, 0.6, 7).translate(0, 1.05, 0),
    new THREE.ConeGeometry(0.21, 0.45, 7).translate(0, 1.34, 0),
  ],
  round: [
    new THREE.IcosahedronGeometry(0.44, 0).translate(0, 0.86, 0),
    new THREE.IcosahedronGeometry(0.27, 0).translate(0.2, 1.16, 0.06),
  ],
  bush: [new THREE.IcosahedronGeometry(0.3, 0).translate(0, 0.26, 0)],
};

const treeGeoCache = new Map();
function treeGeometry(kind, hex, variant) {
  const key = `${kind}:${hex}:${variant}`;
  if (!treeGeoCache.has(key)) {
    const leaf = new THREE.Color(hex);
    leaf.offsetHSL(0, 0, (variant - 1) * 0.05);
    const parts = TREE_PARTS[kind].map((g) => paint(g, leaf));
    if (kind !== 'bush') parts.unshift(paint(TREE_PARTS.trunk, TRUNK_COLOR));
    treeGeoCache.set(key, mergeGeometries(parts));
  }
  return treeGeoCache.get(key);
}

function treeLayout(tree, [sx, sz]) {
  const r = seeded(hashString(tree.id));
  return {
    kind: tree.minutes < 20 ? 'bush' : r() < 0.55 ? 'pine' : 'round',
    variant: Math.floor(r() * 3),
    x: sx + (r() - 0.5) * 0.25,
    z: sz + (r() - 0.5) * 0.25,
    rotY: r() * Math.PI * 2,
    scale: 0.7 + (Math.min(tree.minutes, 120) / 120) * 0.8,
  };
}

const tmpMatrix = new THREE.Matrix4();
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
function treeMatrix(L, scale) {
  tmpPos.set(L.x, GROUND_Y, L.z);
  tmpQuat.setFromAxisAngle(UP, L.rotY);
  tmpScale.setScalar(Math.max(0.001, scale));
  return tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
}

/* ---------- the scene ---------- */

export function createGrove(container, { onTreeClick, reducedMotion = false } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: window.devicePixelRatio < 2, // high-density phone screens don't need MSAA
      alpha: true,
      powerPreference: 'high-performance',
    });
  } catch {
    container.innerHTML = '<p class="grove-fallback">Your browser could not start 3D graphics, so the grove is hidden. Everything else works.</p>';
    const noop = () => {};
    return { setTrees: noop, setStreak: noop, setRain: noop, setFocus: noop, setActive: noop, refreshSky: noop };
  }
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  let pixelRatio = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false; // the world never moves, so shadows only change with the trees or the sun
  const markShadows = () => { renderer.shadowMap.needsUpdate = true; };
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  Object.assign(controls, {
    enableDamping: true, enablePan: false, minDistance: 10, maxDistance: 28, maxPolarAngle: Math.PI * 0.47,
    autoRotate: !reducedMotion, autoRotateSpeed: AUTO_ROTATE.idle,
  });
  controls.target.set(0, 0.4, 0);

  const hemi = new THREE.HemisphereLight('#dcefff', '#58704a', 1.5);
  const sun = new THREE.DirectionalLight('#fff4e2', 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 40 });
  scene.add(hemi, sun);

  scene.add(...buildIsland());
  const glowTex = glowTexture();
  const lantern = buildLantern(glowTex);
  scene.add(lantern.group);
  const treeRoot = new THREE.Group();
  scene.add(treeRoot);

  const stars = makePoints(420, 0.35, '#FFFFFF', glowTex, 0);
  const starPos = stars.geometry.attributes.position;
  const sr = seeded(99);
  for (let i = 0; i < starPos.count; i++) {
    const a = sr() * Math.PI * 2, el = 0.08 + sr() * 1.35;
    starPos.setXYZ(i, Math.cos(a) * Math.cos(el) * 60, Math.sin(el) * 60 - 8, Math.sin(a) * Math.cos(el) * 60);
  }
  scene.add(stars);

  const fireflies = makePoints(FIREFLY_COUNT, 0.16, '#FFD36B', glowTex);
  const flySeeds = Array.from({ length: FIREFLY_COUNT }, (_, i) => {
    const r = seeded(500 + i);
    return { a: r() * Math.PI * 2, d: 1 + r() * 3.6, h: 0.5 + r() * 1.6, s: 0.3 + r() * 0.6, p: r() * 10 };
  });
  scene.add(fireflies);

  const clouds = buildClouds();
  clouds.forEach((c) => scene.add(c.mesh));

  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RAIN_DROPS * 6), 3));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: '#A9C4D8', transparent: true, opacity: 0.55 }));
  const rainY = new Float32Array(RAIN_DROPS);
  const rainXZ = new Float32Array(RAIN_DROPS * 2);
  const rr = seeded(3);
  for (let i = 0; i < RAIN_DROPS; i++) {
    rainXZ[i * 2] = (rr() - 0.5) * 14;
    rainXZ[i * 2 + 1] = (rr() - 0.5) * 14;
    rainY[i] = rr() * 11 - 2;
  }
  rain.visible = false;
  scene.add(rain);

  const slots = slotPositions();
  let treeSignature = '';
  const growing = [];
  const sparks = [];
  let streakGlow = 0;
  let flyCount = 0;
  let focus = false;
  let active = true;
  let inView = true;
  let spin = 0;
  let raf = 0;
  let phase = '';

  /* ---------- sky ---------- */
  function refreshSky() {
    const next = skyPhase();
    if (next === phase) return;
    phase = next;
    const s = SKY[phase];
    container.dataset.sky = phase;
    hemi.color.set(s.sky);
    hemi.groundColor.set(s.ground);
    hemi.intensity = s.hemi;
    sun.color.set(s.sun);
    sun.intensity = s.sunI;
    sun.position.set(...s.pos);
    stars.material.opacity = s.stars;
    stars.visible = s.stars > 0;
    markShadows();
    wake();
  }

  /* ---------- trees ---------- */
  function sparkle(x, z) {
    const pts = makePoints(24, 0.12, '#FFF3C4', glowTex);
    const p = pts.geometry.attributes.position;
    const vel = [];
    for (let i = 0; i < 24; i++) {
      p.setXYZ(i, x, GROUND_Y + 0.6, z);
      const a = Math.random() * Math.PI * 2;
      vel.push([Math.cos(a) * 0.9, 1.2 + Math.random() * 1.4, Math.sin(a) * 0.9]);
    }
    scene.add(pts);
    sparks.push({ pts, vel, t0: performance.now() });
  }

  function setTrees(trees, colors, { animate = false } = {}) {
    const shown = trees.slice(-MAX_TREES);
    const offset = trees.length - shown.length;
    const colorOf = (t) => colors[t.subjectId] ?? DEFAULT_TREE_COLOR;
    const signature = `${trees.length}|${shown.map((t) => `${t.id}:${colorOf(t)}`).join(',')}`;
    if (signature === treeSignature) return;
    treeSignature = signature;

    treeRoot.children.slice().forEach((m) => { treeRoot.remove(m); m.dispose(); });
    growing.length = 0;

    const groups = new Map();
    shown.forEach((t, j) => {
      const L = treeLayout(t, slots[((offset + j) * SLOT_STRIDE) % MAX_TREES]);
      const key = `${L.kind}:${colorOf(t)}:${L.variant}`;
      if (!groups.has(key)) groups.set(key, { geo: treeGeometry(L.kind, colorOf(t), L.variant), items: [] });
      groups.get(key).items.push({ tree: t, L });
    });

    const newest = animate ? shown[shown.length - 1] : null;
    for (const { geo, items } of groups.values()) {
      const mesh = new THREE.InstancedMesh(geo, vertexMat, items.length);
      items.forEach(({ tree, L }, i) => {
        const isNew = tree === newest;
        mesh.setMatrixAt(i, treeMatrix(L, isNew ? 0.001 : L.scale));
        if (isNew) {
          growing.push({ mesh, index: i, L, t0: performance.now() });
          if (!reducedMotion) sparkle(L.x, L.z);
        }
      });
      mesh.castShadow = true;
      mesh.frustumCulled = false; // instances spread over the island; the group is always on screen
      mesh.userData.trees = items.map((it) => it.tree);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      treeRoot.add(mesh);
    }
    markShadows();
    wake();
  }

  function setStreak(streak, studiedToday) {
    const k = streak > 0 ? Math.min(1, 0.5 + streak * 0.06) * (studiedToday ? 1 : 0.7) : 0.06;
    streakGlow = k;
    lantern.lampMat.emissiveIntensity = 0.15 + 2.2 * k;
    lantern.light.intensity = 14 * k;
    lantern.glow.material.opacity = Math.min(1, k * 1.1);
    lantern.glow.scale.setScalar(0.9 + 1.8 * k);
    flyCount = reducedMotion ? 0 : streak >= 3 ? Math.min(FIREFLY_COUNT, 6 + streak * 2) : 0;
    fireflies.geometry.setDrawRange(0, flyCount);
    wake();
  }

  /* ---------- camera & sizing ---------- */
  // Resizes keep the viewer's orbit; the camera is re-placed only when portrait/landscape flips
  // (the phone address bar hiding changes the height but shouldn't snap the view back).
  let framedPortrait = null;
  function frame() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const portrait = camera.aspect < 1.1;
    if (portrait !== framedPortrait) {
      framedPortrait = portrait;
      camera.fov = portrait ? 50 : 34;
      const dist = portrait ? 15.5 : 19;
      camera.position.copy(controls.target).add(new THREE.Vector3(0.62, 0.58, 0.62).normalize().multiplyScalar(dist));
    }
    camera.updateProjectionMatrix();
    controls.update();
    wake();
  }
  new ResizeObserver(frame).observe(container);

  const orbitOffset = new THREE.Vector3();
  function orbit(angle) {
    orbitOffset.copy(camera.position).sub(controls.target).applyAxisAngle(UP, angle);
    camera.position.copy(controls.target).add(orbitOffset);
  }

  // Phones: page scroll keeps working; a sideways swipe spins the view instead of full orbit controls.
  function setTouchMode() {
    const full = !coarse || focus;
    controls.enabled = full;
    renderer.domElement.style.touchAction = full ? 'none' : 'pan-y';
  }
  setTouchMode();

  let down = null;
  const canvas = renderer.domElement;
  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, last: e.clientX, moved: false };
    wake();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!down) return;
    if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) down.moved = true;
    if (!controls.enabled && e.pointerType !== 'mouse') {
      spin = -(e.clientX - down.last) * 0.008;
      orbit(spin);
      down.last = e.clientX;
      wake();
    }
  });
  canvas.addEventListener('pointerup', (e) => {
    const wasTap = down && !down.moved;
    down = null;
    if (!wasTap) return;
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(treeRoot.children, false)[0];
    const tree = hit ? hit.object.userData.trees?.[hit.instanceId] : null;
    onTreeClick?.(tree ?? null, e.clientX - rect.left, e.clientY - rect.top);
  });
  canvas.addEventListener('pointercancel', () => { down = null; });

  /* ---------- loop ---------- */
  const clock = new THREE.Clock();
  let perfSum = 0;
  let perfFrames = 0;

  function adaptResolution(rawDt) {
    if (rawDt <= 0 || rawDt > 0.25) return; // ignore pauses (hidden tab, idle)
    perfSum += rawDt * 1000;
    perfFrames += 1;
    if (perfFrames < 45) return;
    const avg = perfSum / perfFrames;
    perfSum = 0;
    perfFrames = 0;
    if (avg > SLOW_FRAME_MS && pixelRatio > MIN_PIXEL_RATIO) {
      pixelRatio = Math.max(MIN_PIXEL_RATIO, pixelRatio - 0.25);
      renderer.setPixelRatio(pixelRatio);
    }
  }

  function animateRain(dt) {
    const p = rainGeo.attributes.position.array;
    for (let i = 0; i < RAIN_DROPS; i++) {
      rainY[i] -= dt * 9;
      if (rainY[i] < -1.5) rainY[i] = 9;
      const o = i * 6, x = rainXZ[i * 2], z = rainXZ[i * 2 + 1], y = rainY[i];
      p[o] = x; p[o + 1] = y; p[o + 2] = z;
      p[o + 3] = x - 0.03; p[o + 4] = y + 0.35; p[o + 5] = z;
    }
    rainGeo.attributes.position.needsUpdate = true;
  }

  let tickCount = 0;
  function tick() {
    raf = 0;
    tickCount += 1;
    if (!active || !inView || document.hidden) return;
    const rawDt = clock.getDelta();
    const dt = Math.min(rawDt, 0.05);
    const t = clock.elapsedTime;
    const now = performance.now();
    adaptResolution(rawDt);

    if (!reducedMotion) {
      if (!down && Math.abs(spin) > 0.0002) { orbit(spin); spin *= 0.92; }
      for (const c of clouds) {
        c.angle += dt * c.speed;
        c.mesh.position.set(Math.cos(c.angle) * c.radius, c.height, Math.sin(c.angle) * c.radius);
        c.mesh.rotation.y = -c.angle;
      }
      lantern.glow.material.opacity = Math.min(1, streakGlow * (1.02 + Math.sin(t * 2.3) * 0.08));
    }
    if (flyCount) {
      const p = fireflies.geometry.attributes.position;
      for (let i = 0; i < flyCount; i++) {
        const f = flySeeds[i];
        const a = f.a + t * f.s * 0.25;
        p.setXYZ(i, Math.cos(a) * f.d + Math.sin(t * f.s + f.p) * 0.3, f.h + Math.sin(t * f.s * 1.7 + f.p) * 0.25, Math.sin(a) * f.d);
      }
      p.needsUpdate = true;
    }
    for (let i = growing.length - 1; i >= 0; i--) {
      const g = growing[i];
      const k = Math.min(1, (now - g.t0) / GROW_MS);
      g.mesh.setMatrixAt(g.index, treeMatrix(g.L, g.L.scale * (reducedMotion ? k : easeOutBack(k))));
      g.mesh.instanceMatrix.needsUpdate = true;
      markShadows();
      if (k >= 1) { g.mesh.computeBoundingSphere(); growing.splice(i, 1); }
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      const age = (now - s.t0) / 1600;
      const p = s.pts.geometry.attributes.position;
      for (let j = 0; j < s.vel.length; j++) {
        const v = s.vel[j];
        p.setXYZ(j, p.getX(j) + v[0] * dt, p.getY(j) + v[1] * dt, p.getZ(j) + v[2] * dt);
      }
      p.needsUpdate = true;
      s.pts.material.opacity = Math.max(0, 1 - age);
      if (age >= 1) {
        scene.remove(s.pts);
        s.pts.geometry.dispose();
        s.pts.material.dispose();
        sparks.splice(i, 1);
      }
    }
    if (rain.visible) animateRain(dt);
    controls.update();
    renderer.render(scene, camera);
    const idle = reducedMotion && !down && !growing.length && !sparks.length && !rain.visible && !flyCount;
    // controls.update() above may already have queued the next frame through wake(); queue at most one,
    // otherwise every camera move doubles the render loops (this was the source of the drag lag).
    if (!idle) wake();
  }

  // The only place a frame is requested, so there is never more than one loop running.
  function wake() {
    if (!raf) raf = requestAnimationFrame(tick);
  }
  controls.addEventListener('change', wake);
  document.addEventListener('visibilitychange', () => { clock.getDelta(); wake(); });
  new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; clock.getDelta(); wake(); }).observe(container);

  refreshSky();
  setInterval(refreshSky, 60000);

  if (new URLSearchParams(location.search).has('debug')) {
    window.__grove = () => ({
      drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      pixelRatio: renderer.getPixelRatio(), treeMeshes: treeRoot.children.length, ticks: tickCount,
    });
  }

  return {
    setTrees,
    setStreak,
    refreshSky,
    setRain(on) { rain.visible = on; wake(); },
    setFocus(on) {
      focus = on;
      controls.autoRotateSpeed = on ? AUTO_ROTATE.focus : AUTO_ROTATE.idle;
      setTouchMode();
      wake();
    },
    setActive(on) { active = on; clock.getDelta(); wake(); },
  };
}
