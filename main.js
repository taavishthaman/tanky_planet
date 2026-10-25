import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ---------------------------------------------------------------------------
// Tanky Planet — tiny gravity-well planet, tanks duke it out on the surface.
// Shots are fired flat (tangent to the surface); the planet's own gravity
// bends them into a Newton's-cannonball arc that can sweep most of the way
// around the world, same spirit as the original napkin sketch.
// ---------------------------------------------------------------------------

const PLANET_RADIUS = 26;
// Projectiles fly ~1.7x faster than before. Scaling launch speed by k and
// gravity by k^2 keeps the arc *shape* (and ranges) identical while cutting
// the flight time — so shots feel snappy instead of floaty.
const SPEED_SCALE = 1.7;
const GRAVITY = 9.5 * SPEED_SCALE * SPEED_SCALE;
const TANK_GROUND_CLEARANCE = 0.05;
const TANK_HIT_RADIUS = 2.1;
const TANK_BODY_RADIUS = 1.2;
const TANK_MODEL_SIZE = 3.1;
const TREE_MODEL_SIZE = 2.3;
const TREE_COLLIDER_RADIUS = 0.95;
const BARREL_MODEL_SIZE = 1.15;
const BARREL_COLLIDER_RADIUS = 0.85;
const MOVE_SPEED = 9.5;
const TURN_SPEED = 2.5;
const MIN_POWER = 13 * SPEED_SCALE;
const MAX_POWER = 38 * SPEED_SCALE;
const CHARGE_RATE = (MAX_POWER - MIN_POWER) / 1.1;
const SPLASH_RADIUS = 4.5;
const SPLASH_DAMAGE = 32;
const DIRECT_DAMAGE = 24;
const MAX_HP = 100;
const ENEMY_COUNT = 3;
const MUZZLE_HEIGHT = 0.95;
const MUZZLE_FORWARD = 1.5;
const FIRE_COOLDOWN = 0.35; // min seconds between the player's shots

// Terrain: a smooth sum-of-bumps height field gives rolling hills and craters.
const TERRAIN_AMP = 1.35;
const TERRAIN_BUMPS = 15;

// Repair pickups
const REPAIR_HEAL = 32;
const REPAIR_PICK_RADIUS = 2.2;
const REPAIR_RESPAWN = 9;
const REPAIR_COUNT = 2;

// Per-enemy colour tints (multiplied over the shared player tank model).
const ENEMY_TINTS = [0xff5a5a, 0xc26bff, 0xff9a3c, 0x5ad1ff, 0x6bd97a];

const ASSET_PATHS = {
  tankPlayer: 'assets/models/tank_player.glb',
  barrel: 'assets/models/barrel.glb',
  treePine: 'assets/models/tree_pine.glb',
  treeRound: 'assets/models/tree_round.glb',
  treeOak: 'assets/models/tree_oak.glb',
};

// ------------------------------- renderer -----------------------------------

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 2000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ------------------------------- skybox -----------------------------------

function buildSkyTexture() {
  // A soft deep-space nebula gradient so the sky reads as "space at dusk"
  // rather than flat black. Warm glow low, cool indigo up top.
  const w = 512, h = 512;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0.0, '#0a1230');
  grad.addColorStop(0.45, '#17224d');
  grad.addColorStop(0.72, '#2a2f66');
  grad.addColorStop(1.0, '#4a3a72');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // a couple of faint nebula clouds for depth
  const clouds = [
    ['#5e6bd8', 0.16, 0.35, 0.28, 0.22],
    ['#8b5fd0', 0.75, 0.70, 0.30, 0.18],
    ['#3fa9c9', 0.55, 0.20, 0.22, 0.14],
  ];
  for (const [col, cx, cy, rad, alpha] of clouds) {
    const g = ctx.createRadialGradient(cx * w, cy * h, 0, cx * w, cy * h, rad * w);
    g.addColorStop(0, col);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const skyDome = new THREE.Mesh(
  new THREE.SphereGeometry(1400, 32, 32),
  new THREE.MeshBasicMaterial({ map: buildSkyTexture(), side: THREE.BackSide, depthWrite: false })
);
scene.add(skyDome);

// ------------------------------- starfield -----------------------------------

function buildStarfield() {
  const count = 2500;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 400 + Math.random() * 500;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.4, sizeAttenuation: false });
  scene.add(new THREE.Points(geo, mat));
}
buildStarfield();

// ------------------------------- lighting -----------------------------------

scene.add(new THREE.AmbientLight(0x9fb4e0, 1.05));
scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x4a5a46, 0.9));
const sun = new THREE.DirectionalLight(0xfff4e0, 1.7);
sun.position.set(70, 55, 35);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -40;
sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40;
sun.shadow.camera.bottom = -40;
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 250;
scene.add(sun);

// ------------------------------- planet texture -----------------------------------

function buildPlanetTexture() {
  const w = 1024, h = 512;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#2aa7e8');
  grad.addColorStop(0.5, '#1f8fd8');
  grad.addColorStop(1, '#176fb0');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  function blob(cx, cy, r) {
    ctx.fillStyle = `hsl(${95 + Math.random() * 30}, 45%, ${32 + Math.random() * 14}%)`;
    ctx.beginPath();
    const pts = 10 + Math.floor(Math.random() * 5);
    for (let i = 0; i <= pts; i++) {
      const a = (i / pts) * Math.PI * 2;
      const rr = r * (0.7 + Math.random() * 0.6);
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr * 0.6;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.filter = 'blur(7px)';
  for (let i = 0; i < 9; i++) {
    const cx = Math.random() * w;
    const cy = 60 + Math.random() * (h - 120);
    const r = 40 + Math.random() * 70;
    blob(cx, cy, r);
    blob(cx - w, cy, r);
    blob(cx + w, cy, r);
  }
  ctx.filter = 'none';

  const capTop = ctx.createLinearGradient(0, 0, 0, 22);
  capTop.addColorStop(0, 'rgba(255,255,255,0.95)');
  capTop.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = capTop;
  ctx.fillRect(0, 0, w, 22);
  const capBottom = ctx.createLinearGradient(0, h - 22, 0, h);
  capBottom.addColorStop(0, 'rgba(255,255,255,0)');
  capBottom.addColorStop(1, 'rgba(255,255,255,0.95)');
  ctx.fillStyle = capBottom;
  ctx.fillRect(0, h - 22, w, 22);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ------------------------------- terrain height field -----------------------------------

const terrainBumps = [];
function buildTerrain() {
  terrainBumps.length = 0;
  for (let i = 0; i < TERRAIN_BUMPS; i++) {
    const v = new THREE.Vector3(
      THREE.MathUtils.randFloatSpread(2),
      THREE.MathUtils.randFloatSpread(2),
      THREE.MathUtils.randFloatSpread(2)
    );
    if (v.lengthSq() < 1e-4) v.set(0, 1, 0);
    v.normalize();
    terrainBumps.push({
      dir: v,
      amp: (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random()) * TERRAIN_AMP,
      width: 0.16 + Math.random() * 0.3, // angular radius in radians
    });
  }
}
buildTerrain();

// Height above the base sphere at a given (unit) direction.
function terrainHeight(dir) {
  let h = 0;
  for (const b of terrainBumps) {
    const a = dir.angleTo(b.dir);
    h += b.amp * Math.exp(-(a * a) / (b.width * b.width));
  }
  return h;
}

function surfaceRadius(dir) {
  return PLANET_RADIUS + terrainHeight(dir);
}

function applyTerrainDisplacement(geo) {
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const r = surfaceRadius(v);
    pos.setXYZ(i, v.x * r, v.y * r, v.z * r);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

const planetGroup = new THREE.Group();
scene.add(planetGroup);

const planetGeo = new THREE.SphereGeometry(PLANET_RADIUS, 128, 128);
applyTerrainDisplacement(planetGeo);
const planetMesh = new THREE.Mesh(
  planetGeo,
  new THREE.MeshStandardMaterial({ map: buildPlanetTexture(), roughness: 0.9, metalness: 0.0 })
);
planetMesh.receiveShadow = true;
planetGroup.add(planetMesh);

// ------------------------------- surface helpers -----------------------------------

function randomPointOnSphere() {
  const v = new THREE.Vector3(
    THREE.MathUtils.randFloatSpread(2),
    THREE.MathUtils.randFloatSpread(2),
    THREE.MathUtils.randFloatSpread(2)
  );
  if (v.lengthSq() < 1e-4) v.set(0, 1, 0);
  return v.normalize();
}

function orientToSurface(obj, normal, forward) {
  const up = normal.clone();
  let fwd = forward.clone();
  fwd.sub(up.clone().multiplyScalar(fwd.dot(up)));
  if (fwd.lengthSq() < 1e-6) fwd = new THREE.Vector3(1, 0, 0).sub(up.clone().multiplyScalar(up.x)).normalize();
  fwd.normalize();
  const right = up.clone().cross(fwd).normalize();
  const m = new THREE.Matrix4().makeBasis(right, up, fwd);
  obj.quaternion.setFromRotationMatrix(m);
}

function anyPerpendicular(n) {
  const a = Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  return a.sub(n.clone().multiplyScalar(a.dot(n))).normalize();
}

// ------------------------------- asset loading -----------------------------------

const loader = new GLTFLoader();

function loadGLTF(path) {
  return new Promise((resolve, reject) => loader.load(path, resolve, undefined, reject));
}

// Scales + recenters a loaded gltf scene so its footprint matches targetSize
// and its base sits exactly on local y=0. Returns a wrapper holding it, which
// becomes the clonable template (scale/offset baked into the child transform).
function buildTemplate(rawScene, targetSize, correctionY = 0) {
  const holder = new THREE.Group();
  rawScene.rotation.y = correctionY;
  holder.add(rawScene);
  holder.updateMatrixWorld(true);

  let box = new THREE.Box3().setFromObject(holder);
  let size = new THREE.Vector3();
  box.getSize(size);
  const scale = targetSize / Math.max(size.x, size.z, 0.0001);
  rawScene.scale.setScalar(scale);
  holder.updateMatrixWorld(true);

  box = new THREE.Box3().setFromObject(holder);
  const center = new THREE.Vector3();
  box.getCenter(center);
  rawScene.position.x -= center.x;
  rawScene.position.z -= center.z;
  rawScene.position.y -= box.min.y;
  holder.updateMatrixWorld(true);

  holder.traverse((c) => {
    if (c.isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });

  return holder;
}

async function loadAssets() {
  const [playerGltf, barrelGltf, pineGltf, roundGltf, oakGltf] = await Promise.all([
    loadGLTF(ASSET_PATHS.tankPlayer),
    loadGLTF(ASSET_PATHS.barrel),
    loadGLTF(ASSET_PATHS.treePine),
    loadGLTF(ASSET_PATHS.treeRound),
    loadGLTF(ASSET_PATHS.treeOak),
  ]);

  return {
    // Enemies reuse the player's tank model (just recolored) so the fleet looks
    // consistent — see tintTank() at the enemy spawn in init().
    tankPlayer: buildTemplate(playerGltf.scene, TANK_MODEL_SIZE),
    barrel: buildTemplate(barrelGltf.scene, BARREL_MODEL_SIZE),
    trees: [
      buildTemplate(pineGltf.scene, TREE_MODEL_SIZE),
      buildTemplate(roundGltf.scene, TREE_MODEL_SIZE * 1.05),
      buildTemplate(oakGltf.scene, TREE_MODEL_SIZE * 1.1),
    ],
  };
}

// Recolor a cloned tank by multiplying each material's color by a tint. Materials
// are shared after .clone(true), so we clone them first to avoid tinting the
// player and the other enemies too.
function tintTank(root, tint) {
  const tintColor = new THREE.Color(tint);
  root.traverse((c) => {
    if (!c.isMesh || !c.material) return;
    const mats = Array.isArray(c.material) ? c.material : [c.material];
    const recolored = mats.map((m) => {
      const nm = m.clone();
      if (nm.color) nm.color.multiply(tintColor);
      return nm;
    });
    c.material = Array.isArray(c.material) ? recolored : recolored[0];
  });
}

// ------------------------------- scenery: trees + barrels -----------------------------------

const scenery = [];
const barrels = [];
const obstacles = []; // { dir, radius, barrel } — barrel set => only blocks while alive

function scatterScenery(count, factory, opts, avoidPoints) {
  const { isBarrel = false, colliderRadius = 1 } = opts;
  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < count * 30) {
    attempts++;
    const n = randomPointOnSphere();
    if (avoidPoints.some((p) => n.angleTo(p) < 0.22)) continue;
    // don't stack scenery on top of each other
    if (obstacles.some((o) => n.angleTo(o.dir) * PLANET_RADIUS < colliderRadius + o.radius + 0.8)) continue;
    const obj = factory();
    const jitter = 0.85 + Math.random() * 0.4;
    obj.scale.multiplyScalar(jitter);
    obj.position.copy(n.clone().multiplyScalar(surfaceRadius(n)));
    orientToSurface(obj, n, anyPerpendicular(n));
    obj.rotateY(Math.random() * Math.PI * 2);
    planetGroup.add(obj);
    obj.userData.normal = n;
    scenery.push(obj);
    const collider = { dir: n.clone(), radius: colliderRadius * jitter, barrel: null };
    if (isBarrel) {
      barrels.push(obj);
      collider.barrel = obj;
    }
    obstacles.push(collider);
    obj.userData.collider = collider;
    placed++;
  }
}

// Great-circle (surface) distance between two unit directions.
function surfaceDistance(a, b) {
  return a.angleTo(b) * PLANET_RADIUS;
}

// True if a tank body centered at unit dir `n` would overlap any solid obstacle.
function blockedByObstacle(n) {
  for (const o of obstacles) {
    if (o.barrel && !o.barrel.userData.alive) continue;
    if (surfaceDistance(n, o.dir) < TANK_BODY_RADIUS + o.radius) return true;
  }
  return false;
}

// ------------------------------- repair pickups -----------------------------------

const repairPickups = [];

function buildMedkit() {
  const g = new THREE.Group();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.7, 1.1),
    new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.5, emissive: 0x335544, emissiveIntensity: 0.3 })
  );
  box.castShadow = true;
  g.add(box);
  const crossMat = new THREE.MeshStandardMaterial({ color: 0xff3b3b, emissive: 0xff2222, emissiveIntensity: 0.7, roughness: 0.4 });
  const barV = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.72, 0.62), crossMat);
  const barH = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.22), crossMat);
  g.add(barV, barH);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: projGlowTexture, color: 0x6effa8, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6 }));
  halo.scale.setScalar(3.2);
  g.add(halo);
  return g;
}

function randomFreeDirection() {
  for (let i = 0; i < 60; i++) {
    const n = randomPointOnSphere();
    if (!blockedByObstacle(n)) return n;
  }
  return randomPointOnSphere();
}

function createRepairPickups() {
  for (let i = 0; i < REPAIR_COUNT; i++) {
    const mesh = buildMedkit();
    planetGroup.add(mesh);
    const pickup = { mesh, dir: randomFreeDirection(), active: true, respawn: 0, phase: Math.random() * Math.PI * 2 };
    repairPickups.push(pickup);
    seatRepair(pickup);
  }
}

function seatRepair(pickup) {
  const hover = 1.3 + Math.sin(pickup.phase) * 0.25;
  pickup.mesh.position.copy(pickup.dir.clone().multiplyScalar(surfaceRadius(pickup.dir) + hover));
  orientToSurface(pickup.mesh, pickup.dir, anyPerpendicular(pickup.dir));
}

function updateRepairs(dt) {
  for (const pk of repairPickups) {
    if (pk.active) {
      pk.phase += dt * 2.2;
      seatRepair(pk);
      pk.mesh.rotateY(dt * 1.4);
      if (player.alive && player.hp < MAX_HP && surfaceDistance(player.normal, pk.dir) < REPAIR_PICK_RADIUS) {
        player.hp = Math.min(MAX_HP, player.hp + REPAIR_HEAL);
        burstAt(pk.mesh.position, 0x6effa8, 22);
        pk.active = false;
        pk.respawn = REPAIR_RESPAWN;
        pk.mesh.visible = false;
      }
    } else {
      pk.respawn -= dt;
      if (pk.respawn <= 0) {
        pk.dir = randomFreeDirection();
        pk.active = true;
        pk.mesh.visible = true;
        seatRepair(pk);
      }
    }
  }
}

// ------------------------------- tanks -----------------------------------

class Tank {
  constructor(mesh, isPlayer, mixer = null, clips = null) {
    this.isPlayer = isPlayer;
    this.mesh = mesh;
    this.mixer = mixer;
    this.clips = clips || {};
    this.currentAction = null;
    planetGroup.add(this.mesh);
    this.hp = MAX_HP;
    this.alive = true;
  }

  setStart(normal, forward) {
    this.normal = normal.clone();
    this.forward = forward.clone();
    this.position = this.normal.clone().multiplyScalar(surfaceRadius(this.normal) + TANK_GROUND_CLEARANCE);
    this.updateMesh();
  }

  move(dir, dt) {
    // Walk along the tangent, then re-seat on the (possibly bumpy) surface.
    const candidate = this.position.clone().add(this.forward.clone().multiplyScalar(dir * MOVE_SPEED * dt));
    const candidateNormal = candidate.clone().normalize();

    // Collision: if a tree/barrel is in the way, slide to a stop instead of passing through.
    if (!blockedByObstacle(candidateNormal)) {
      this.normal = candidateNormal;
      this.position = this.normal.clone().multiplyScalar(surfaceRadius(this.normal) + TANK_GROUND_CLEARANCE);
      this.playClip(dir > 0 ? 'forward' : 'backward');
    } else {
      this.stopClip();
    }

    this.forward.sub(this.normal.clone().multiplyScalar(this.forward.dot(this.normal)));
    this.forward.normalize();
  }

  turn(dir, dt) {
    this.forward.applyAxisAngle(this.normal, dir * TURN_SPEED * dt);
    this.playClip(dir > 0 ? 'left' : 'right');
  }

  playClip(name) {
    if (!this.mixer || !this.clips[name]) return;
    if (this.currentAction === name) return;
    const prev = this.currentAction;
    this.currentAction = name;
    this.mixer.stopAllAction();
    const action = this.mixer.clipAction(this.clips[name]);
    action.reset().play();
  }

  stopClip() {
    this.currentAction = null;
    if (this.mixer) this.mixer.stopAllAction();
  }

  updateMesh() {
    this.mesh.position.copy(this.position);
    orientToSurface(this.mesh, this.normal, this.forward);
  }

  muzzleWorldPosition() {
    return this.position.clone()
      .add(this.normal.clone().multiplyScalar(MUZZLE_HEIGHT))
      .add(this.forward.clone().multiplyScalar(MUZZLE_FORWARD));
  }

  aimDirection() {
    return this.forward.clone().normalize();
  }

  takeDamage(amount) {
    if (!this.alive) return;
    this.hp = Math.max(0, this.hp - amount);
    flashHit(this.mesh);
    if (this.hp <= 0) this.alive = false;
  }
}

function flashHit(mesh) {
  const materials = new Set();
  mesh.traverse((c) => {
    if (c.isMesh && c.material) {
      (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => {
        if (m.emissive) materials.add(m);
      });
    }
  });
  materials.forEach((mat) => {
    const orig = mat.emissive.clone();
    const origIntensity = mat.emissiveIntensity;
    mat.emissive.setHex(0xff3333);
    mat.emissiveIntensity = 1;
    setTimeout(() => {
      mat.emissive.copy(orig);
      mat.emissiveIntensity = origIntensity;
    }, 120);
  });
}

// ------------------------------- projectiles & FX -----------------------------------

const projectiles = [];
const particleBursts = [];

const projGlowTexture = (() => {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = s; c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,240,190,1)');
  g.addColorStop(0.3, 'rgba(255,170,60,0.85)');
  g.addColorStop(1, 'rgba(255,120,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
})();

// Transient additive "flash" sprites stand in for muzzle flashes and explosion
// light. Crucially they're NOT lights: adding/removing a THREE light changes the
// scene's light count, which forces three.js to recompile every material — doing
// that on every shot is what caused the frame hitches when spamming fire.
const transientFlashes = [];
function spawnFlash(position, color, scale, life = 0.15) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: projGlowTexture, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  sprite.position.copy(position);
  sprite.scale.setScalar(scale);
  planetGroup.add(sprite);
  transientFlashes.push({ sprite, age: 0, life, baseScale: scale });
}
function updateFlashes(dt) {
  for (let i = transientFlashes.length - 1; i >= 0; i--) {
    const f = transientFlashes[i];
    f.age += dt;
    const t = f.age / f.life;
    if (t >= 1) {
      planetGroup.remove(f.sprite);
      f.sprite.material.dispose();
      transientFlashes.splice(i, 1);
      continue;
    }
    f.sprite.material.opacity = 1 - t;
    f.sprite.scale.setScalar(f.baseScale * (1 + t * 0.8));
  }
}

function spawnProjectile(position, velocity, owner) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0xffdd66, emissive: 0xff7a1a, emissiveIntensity: 1.6, roughness: 0.3 })
  );
  mesh.position.copy(position);
  mesh.castShadow = true;
  planetGroup.add(mesh);

  // additive glow sprite so the shell reads as a hot tracer, not a dull dot
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: projGlowTexture, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.scale.setScalar(2.4);
  mesh.add(glow);

  const trailGeo = new THREE.BufferGeometry();
  const trailPositions = new Float32Array(60 * 3);
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
  const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.85 }));
  planetGroup.add(trail);

  projectiles.push({
    mesh, trail, trailPoints: [], velocity: velocity.clone(), owner, age: 0, dead: false,
  });
}

function burstAt(position, color = 0xffaa33, count = 18) {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const velocities = [];
  for (let i = 0; i < count; i++) {
    positions[i * 3] = position.x;
    positions[i * 3 + 1] = position.y;
    positions[i * 3 + 2] = position.z;
    velocities.push(new THREE.Vector3(THREE.MathUtils.randFloatSpread(2), THREE.MathUtils.randFloatSpread(2), THREE.MathUtils.randFloatSpread(2)).normalize().multiplyScalar(4 + Math.random() * 6));
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color, size: 0.5, transparent: true, opacity: 1 });
  const pts = new THREE.Points(geo, mat);
  planetGroup.add(pts);

  spawnFlash(position, color, count > 22 ? 6 : 4.5, 0.22);

  particleBursts.push({ points: pts, velocities, age: 0, life: 0.6 });
}

function destroyBarrel(barrel) {
  if (!barrel.userData.alive) return;
  barrel.userData.alive = false;
  burstAt(barrel.position, 0xff6622, 26);
  planetGroup.remove(barrel);
  shakeCamera(0.35, 6);
  allTanks().forEach((t) => {
    if (t.alive && t.position.distanceTo(barrel.position) < SPLASH_RADIUS) t.takeDamage(SPLASH_DAMAGE);
  });
}

function explodeProjectile(p, hitPosition) {
  if (p.dead) return;
  p.dead = true;
  burstAt(hitPosition, 0xffaa33, 20);
  planetGroup.remove(p.mesh);
  planetGroup.remove(p.trail);
}

function allTanks() {
  return [player, ...enemies];
}

function updateProjectiles(dt) {
  for (const p of projectiles) {
    if (p.dead) continue;
    p.age += dt;

    const toCenter = p.mesh.position.clone().negate().normalize();
    p.velocity.add(toCenter.multiplyScalar(GRAVITY * dt));
    p.mesh.position.add(p.velocity.clone().multiplyScalar(dt));

    p.trailPoints.push(p.mesh.position.clone());
    if (p.trailPoints.length > 60) p.trailPoints.shift();
    const posAttr = p.trail.geometry.attributes.position;
    for (let i = 0; i < 60; i++) {
      const pt = p.trailPoints[i] || p.trailPoints[0] || p.mesh.position;
      posAttr.setXYZ(i, pt.x, pt.y, pt.z);
    }
    posAttr.needsUpdate = true;
    p.trail.geometry.setDrawRange(0, p.trailPoints.length);

    const dist = p.mesh.position.length();

    if (p.age > 14 || dist > PLANET_RADIUS * 6) {
      explodeProjectile(p, p.mesh.position);
      continue;
    }

    const targets = p.owner === player ? enemies : [player];
    let hit = false;
    for (const t of targets) {
      if (t.alive && p.mesh.position.distanceTo(t.position) < TANK_HIT_RADIUS) {
        t.takeDamage(DIRECT_DAMAGE);
        explodeProjectile(p, p.mesh.position);
        if (t === player) shakeCamera(0.4, 8);
        hit = true;
        break;
      }
    }
    if (hit) continue;

    for (const b of barrels) {
      if (b.userData.alive && p.mesh.position.distanceTo(b.position) < 1.6) {
        destroyBarrel(b);
        explodeProjectile(p, p.mesh.position);
        hit = true;
        break;
      }
    }
    if (hit) continue;

    // trees block shots too (indestructible — the shell just detonates on the trunk)
    const projDir = p.mesh.position.clone().normalize();
    const projHeight = dist - surfaceRadius(projDir);
    for (const o of obstacles) {
      if (o.barrel) continue;
      if (projHeight < 2.6 && surfaceDistance(projDir, o.dir) < o.radius + 0.3) {
        explodeProjectile(p, p.mesh.position);
        hit = true;
        break;
      }
    }
    if (hit) continue;

    if (projHeight <= 0.3) {
      explodeProjectile(p, p.mesh.position);
    }
  }
  for (let i = projectiles.length - 1; i >= 0; i--) {
    if (projectiles[i].dead) projectiles.splice(i, 1);
  }
}

function updateBursts(dt) {
  for (const b of particleBursts) {
    b.age += dt;
    const posAttr = b.points.geometry.attributes.position;
    for (let i = 0; i < b.velocities.length; i++) {
      posAttr.setX(i, posAttr.getX(i) + b.velocities[i].x * dt);
      posAttr.setY(i, posAttr.getY(i) + b.velocities[i].y * dt);
      posAttr.setZ(i, posAttr.getZ(i) + b.velocities[i].z * dt);
    }
    posAttr.needsUpdate = true;
    const t = b.age / b.life;
    b.points.material.opacity = Math.max(0, 1 - t);
  }
  for (let i = particleBursts.length - 1; i >= 0; i--) {
    const b = particleBursts[i];
    if (b.age >= b.life) {
      planetGroup.remove(b.points);
      particleBursts.splice(i, 1);
    }
  }
}

function fireTank(tank, power) {
  const origin = tank.muzzleWorldPosition();
  const dir = tank.aimDirection();
  spawnProjectile(origin, dir.multiplyScalar(power), tank);
  spawnFlash(origin, 0xffdd88, 3.2, 0.12);
  if (tank === player) shakeCamera(0.15, 3);
}

// ------------------------------- aim assist -----------------------------------

const AIM_MAX_POINTS = 140;
const aimGeo = new THREE.BufferGeometry();
aimGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(AIM_MAX_POINTS * 3), 3));
const aimLine = new THREE.Line(aimGeo, new THREE.LineDashedMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.55, dashSize: 0.6, gapSize: 0.45 }));
aimLine.visible = false;
scene.add(aimLine);

const impactRing = new THREE.Mesh(
  new THREE.TorusGeometry(1.0, 0.12, 8, 28),
  new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.8 })
);
impactRing.visible = false;
scene.add(impactRing);

// Simulate the shell under gravity so the player can see where it lands.
function predictTrajectory(origin, dir, power) {
  const pos = origin.clone();
  const vel = dir.clone().multiplyScalar(power);
  const step = 1 / 60;
  const points = [pos.clone()];
  let impact = null;
  for (let i = 0; i < AIM_MAX_POINTS - 1; i++) {
    const toCenter = pos.clone().negate().normalize();
    vel.add(toCenter.multiplyScalar(GRAVITY * step));
    pos.add(vel.clone().multiplyScalar(step));
    points.push(pos.clone());
    const pd = pos.clone().normalize();
    if (pos.length() - surfaceRadius(pd) <= 0.15) { impact = pos.clone(); break; }
  }
  return { points, impact };
}

function updateAim() {
  if (gameOver || !player.alive) {
    aimLine.visible = false;
    impactRing.visible = false;
    return;
  }
  const power = MIN_POWER + charge;
  const { points, impact } = predictTrajectory(player.muzzleWorldPosition(), player.aimDirection(), power);

  const posAttr = aimGeo.attributes.position;
  for (let i = 0; i < AIM_MAX_POINTS; i++) {
    const pt = points[Math.min(i, points.length - 1)];
    posAttr.setXYZ(i, pt.x, pt.y, pt.z);
  }
  posAttr.needsUpdate = true;
  aimGeo.setDrawRange(0, points.length);
  aimLine.computeLineDistances();
  aimLine.visible = true;
  // brighter while actively charging
  aimLine.material.opacity = keys.space ? 0.85 : 0.4;

  if (impact) {
    impactRing.position.copy(impact);
    impactRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), impact.clone().normalize());
    impactRing.material.opacity = keys.space ? 0.9 : 0.5;
    impactRing.visible = true;
  } else {
    impactRing.visible = false;
  }
}

// ------------------------------- range table (for AI aim) -----------------------------------

function simulateRange(power) {
  const pos = new THREE.Vector3(0, PLANET_RADIUS + TANK_GROUND_CLEARANCE + MUZZLE_HEIGHT, 0);
  const startNormal = pos.clone().normalize();
  const vel = new THREE.Vector3(1, 0, 0).multiplyScalar(power);
  const dt = 1 / 90;
  let t = 0;
  while (t < 16) {
    const toCenter = pos.clone().negate().normalize();
    vel.add(toCenter.multiplyScalar(GRAVITY * dt));
    pos.add(vel.clone().multiplyScalar(dt));
    t += dt;
    if (pos.length() <= PLANET_RADIUS + 0.4) {
      return startNormal.angleTo(pos.clone().normalize()) * PLANET_RADIUS;
    }
  }
  return Math.PI * PLANET_RADIUS;
}

let rangeTable = [];
function buildRangeTable() {
  rangeTable = [];
  for (let power = MIN_POWER; power <= MAX_POWER + 0.001; power += 0.75) {
    rangeTable.push({ power, range: simulateRange(power) });
  }
}

function powerForRange(targetRange) {
  let best = rangeTable[0];
  let bestDiff = Infinity;
  for (const entry of rangeTable) {
    const diff = Math.abs(entry.range - targetRange);
    if (diff < bestDiff) { bestDiff = diff; best = entry; }
  }
  return best.power;
}

// ------------------------------- input -----------------------------------

const keys = { w: false, a: false, s: false, d: false, space: false };
let charge = 0;
let playerFireCooldown = 0;
let gameOver = false;
let gameReady = false;

window.addEventListener('keydown', (e) => {
  if (gameOver || !gameReady) return;
  switch (e.code) {
    case 'KeyW': keys.w = true; break;
    case 'KeyS': keys.s = true; break;
    case 'KeyA': keys.a = true; break;
    case 'KeyD': keys.d = true; break;
    case 'Space': if (!keys.space) { keys.space = true; charge = 0; } e.preventDefault(); break;
  }
});
window.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW': keys.w = false; break;
    case 'KeyS': keys.s = false; break;
    case 'KeyA': keys.a = false; break;
    case 'KeyD': keys.d = false; break;
    case 'Space':
      if (keys.space && !gameOver && player.alive && playerFireCooldown <= 0) {
        const power = MIN_POWER + charge;
        fireTank(player, power);
        playerFireCooldown = FIRE_COOLDOWN;
      }
      keys.space = false;
      charge = 0;
      e.preventDefault();
      break;
  }
});

const powerWrap = document.getElementById('powerWrap');
const powerFill = document.getElementById('powerFill');

// ------------------------------- enemy AI -----------------------------------

function updateAI(enemy, dt) {
  if (!enemy.alive || !player.alive) return;
  enemy.aiTimer = (enemy.aiTimer ?? 0) - dt;

  const toPlayer = player.position.clone().sub(enemy.normal.clone().multiplyScalar(player.position.dot(enemy.normal)));
  toPlayer.normalize();
  const cross = enemy.normal.clone().cross(enemy.forward).dot(toPlayer);
  const alignment = enemy.forward.dot(toPlayer);

  if (enemy.aiTimer <= 0) {
    enemy.aiTimer = 1.4 + Math.random() * 1.2;
    enemy.aiMode = Math.random() < 0.75 ? 'aim' : 'wander';
  }

  if (enemy.aiMode === 'aim') {
    if (alignment < 0.995) enemy.turn(cross > 0 ? -1 : 1, dt);
    else enemy.stopClip();
    enemy.move(0.45, dt);
  } else {
    enemy.turn(Math.sin(enemy.aiTimer * 1.7), dt * 0.6);
    enemy.move(0.7, dt);
  }
  enemy.updateMesh();

  enemy.shotCooldown = (enemy.shotCooldown ?? Math.random() * 2) - dt;
  if (alignment > 0.92 && enemy.shotCooldown <= 0) {
    enemy.shotCooldown = 2.4 + Math.random() * 1.8;
    const angularDist = enemy.normal.angleTo(player.normal);
    const targetRange = angularDist * PLANET_RADIUS;
    const power = THREE.MathUtils.clamp(powerForRange(targetRange) * (0.92 + Math.random() * 0.16), MIN_POWER, MAX_POWER);
    fireTank(enemy, power);
  }
}

// ------------------------------- camera -----------------------------------

const CAM_DISTANCE = 12.5;
const CAM_HEIGHT = 8;
const camPos = new THREE.Vector3();
const camTarget = new THREE.Vector3();
let shakeTime = 0;
let shakeMag = 0;

function shakeCamera(duration, magnitude) {
  shakeTime = Math.max(shakeTime, duration);
  shakeMag = Math.max(shakeMag, magnitude);
}

function updateCamera(dt) {
  const t = player;
  const desired = t.position.clone()
    .add(t.normal.clone().multiplyScalar(CAM_HEIGHT))
    .sub(t.forward.clone().multiplyScalar(CAM_DISTANCE));
  camPos.lerp(desired, Math.min(1, dt * 6));

  let shakeOffset = new THREE.Vector3();
  if (shakeTime > 0) {
    shakeTime -= dt;
    const falloff = Math.max(0, shakeTime);
    shakeOffset = new THREE.Vector3(THREE.MathUtils.randFloatSpread(1), THREE.MathUtils.randFloatSpread(1), THREE.MathUtils.randFloatSpread(1)).multiplyScalar(shakeMag * falloff * 0.1);
    if (shakeTime <= 0) shakeMag = 0;
  }

  camera.position.copy(camPos).add(shakeOffset);
  camera.up.copy(t.normal);
  const lookAt = t.position.clone().add(t.normal.clone().multiplyScalar(1.1)).add(t.forward.clone().multiplyScalar(3));
  camTarget.lerp(lookAt, Math.min(1, dt * 8));
  camera.lookAt(camTarget);
}

// ------------------------------- radar -----------------------------------

const radarEl = document.getElementById('radar');
const radarBlips = [];

function updateRadar() {
  while (radarBlips.length < enemies.length) {
    const el = document.createElement('div');
    el.className = 'blip';
    el.style.backgroundImage = "url('assets/ui/dotRed.png')";
    radarEl.appendChild(el);
    radarBlips.push(el);
  }
  const radius = 54;
  const right = player.normal.clone().cross(player.forward).normalize();
  enemies.forEach((enemy, i) => {
    const el = radarBlips[i];
    if (!enemy.alive) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    const toEnemy = enemy.position.clone().sub(player.normal.clone().multiplyScalar(enemy.position.dot(player.normal)));
    toEnemy.normalize();
    const x = toEnemy.dot(right);
    const y = toEnemy.dot(player.forward);
    const angularDist = player.normal.angleTo(enemy.normal);
    const r = Math.min(1, angularDist / Math.PI) * radius;
    el.style.left = `${64 + x * r}px`;
    el.style.top = `${64 - y * r}px`;
  });
}

// ------------------------------- HUD -----------------------------------

const playerBarFill = document.getElementById('playerBarFill');
const enemyBarsEl = document.getElementById('enemyBars');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlayTitle');
const restartBtn = document.getElementById('restartBtn');

function buildEnemyBars() {
  enemyBarsEl.innerHTML = '';
  enemies.forEach((_, i) => {
    const row = document.createElement('div');
    row.className = 'enemy-mini';
    row.innerHTML = `
      <span class="tag">${i + 1}</span>
      <div class="bar3 shadow">
        <div class="cap"></div><div class="mid"></div><div class="cap right"></div>
        <div class="bar-fill-track"><div class="bar-fill red" data-enemy="${i}"></div></div>
      </div>`;
    enemyBarsEl.appendChild(row);
  });
}

function updateHUD() {
  playerBarFill.style.width = `${(player.hp / MAX_HP) * 100}%`;
  enemies.forEach((enemy, i) => {
    const el = enemyBarsEl.querySelector(`[data-enemy="${i}"]`);
    if (el) el.style.width = `${Math.max(0, (enemy.hp / MAX_HP) * 100)}%`;
  });
  if (keys.space) {
    powerWrap.classList.add('show');
    powerFill.style.width = `${(charge / (MAX_POWER - MIN_POWER)) * 100}%`;
  } else {
    powerWrap.classList.remove('show');
  }
  updateRadar();
}

function checkGameOver() {
  if (gameOver) return;
  const enemiesAlive = enemies.some((e) => e.alive);
  if (!player.alive || !enemiesAlive) {
    gameOver = true;
    overlayTitle.textContent = player.alive ? 'VICTORY' : 'DEFEATED';
    overlayTitle.style.color = player.alive ? '#4ee281' : '#ff5f5f';
    overlay.classList.add('show');
  }
}

restartBtn.addEventListener('click', () => window.location.reload());

// ------------------------------- setup -----------------------------------

let player;
let enemies = [];
const clock = new THREE.Clock();

function pickStartPoints() {
  const points = [new THREE.Vector3(1, 0, 0)];
  let attempts = 0;
  while (points.length < ENEMY_COUNT + 1 && attempts < 500) {
    attempts++;
    const candidate = randomPointOnSphere();
    if (points.every((p) => p.angleTo(candidate) > 0.9)) points.push(candidate);
  }
  while (points.length < ENEMY_COUNT + 1) points.push(randomPointOnSphere());
  return points;
}

async function init() {
  const assets = await loadAssets();

  player = new Tank(assets.tankPlayer.clone(true), true);

  enemies = [];
  for (let i = 0; i < ENEMY_COUNT; i++) {
    const cloned = assets.tankPlayer.clone(true);
    tintTank(cloned, ENEMY_TINTS[i % ENEMY_TINTS.length]);
    enemies.push(new Tank(cloned, false));
  }

  const starts = pickStartPoints();
  player.setStart(starts[0], anyPerpendicular(starts[0]));
  enemies.forEach((enemy, i) => {
    const n = starts[i + 1];
    enemy.setStart(n, anyPerpendicular(n));
  });

  const treeFactories = [
    () => assets.trees[0].clone(true),
    () => assets.trees[1].clone(true),
    () => assets.trees[2].clone(true),
  ];
  const avoid = starts;
  scatterScenery(16, () => treeFactories[Math.floor(Math.random() * treeFactories.length)](),
    { isBarrel: false, colliderRadius: TREE_COLLIDER_RADIUS }, avoid);
  scatterScenery(9, () => {
    const b = assets.barrel.clone(true);
    b.userData.isBarrel = true;
    b.userData.alive = true;
    return b;
  }, { isBarrel: true, colliderRadius: BARREL_COLLIDER_RADIUS }, avoid);

  createRepairPickups();
  buildRangeTable();
  buildEnemyBars();

  document.getElementById('loading').classList.remove('show');
  gameReady = true;
  clock.getDelta();
  animate();
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (playerFireCooldown > 0) playerFireCooldown -= dt;

  if (!gameOver) {
    if (player.alive) {
      let moving = false;
      if (keys.w) { player.move(1, dt); moving = true; }
      if (keys.s) { player.move(-1, dt); moving = true; }
      if (keys.a) { player.turn(1, dt); moving = true; }
      if (keys.d) { player.turn(-1, dt); moving = true; }
      if (!moving) player.stopClip();
      player.updateMesh();
      if (keys.space) charge = Math.min(MAX_POWER - MIN_POWER, charge + CHARGE_RATE * dt);
    }
    enemies.forEach((enemy) => updateAI(enemy, dt));
  }

  enemies.forEach((enemy) => { if (enemy.mixer) enemy.mixer.update(dt); });

  updateProjectiles(dt);
  updateBursts(dt);
  updateFlashes(dt);
  updateRepairs(dt);
  updateCamera(dt);
  updateAim();
  updateHUD();
  checkGameOver();

  renderer.render(scene, camera);
}

init();
