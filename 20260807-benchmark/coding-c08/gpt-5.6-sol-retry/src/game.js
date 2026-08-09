import * as THREE from "../vendor/three.module.js";
import {
  BOT_DIFFICULTIES,
  ECONOMY,
  EQUIPMENT,
  MAPS,
  PHASE,
  RoundRules,
  TEAM,
  WEAPONS,
  applyRoundEconomy,
  calculateLaneWallSpan,
  calculateDamage,
  clampMoney,
  findRoute,
  formatRoundTime,
  nodeById,
  roundWinReward,
  spawnFacingYaw,
} from "./game-core.mjs";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (min, max) => min + Math.random() * (max - min);
const choose = (items) => items[Math.floor(Math.random() * items.length)];
const distance2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const otherTeam = (team) => (team === TEAM.T ? TEAM.CT : TEAM.T);

const ui = {
  canvas: $("#game-canvas"),
  hud: $("#hud"),
  start: $("#start-screen"),
  loading: $("#loading-screen"),
  loadingLabel: $("#loading-label"),
  loadingProgress: $("#loading-progress"),
  buy: $("#buy-menu"),
  pause: $("#pause-menu"),
  scoreboard: $("#scoreboard"),
  death: $("#death-screen"),
  banner: $("#round-banner"),
  result: $("#result-screen"),
  radar: $("#radar"),
  radarCallout: $("#radar-callout"),
  scoreT: $("#score-t"),
  scoreCT: $("#score-ct"),
  tAlive: $("#t-alive"),
  ctAlive: $("#ct-alive"),
  roundNumber: $("#round-number"),
  roundTime: $("#round-time"),
  phaseLabel: $("#phase-label"),
  bombStatus: $("#bomb-status"),
  bombLabel: $("#bomb-label"),
  squadPanel: $("#squad-panel"),
  killFeed: $("#kill-feed"),
  objectiveTitle: $("#objective-title"),
  objectiveDetail: $("#objective-detail"),
  objectiveProgress: $("#objective-progress-bar"),
  interaction: $("#interaction-prompt"),
  interactionTitle: $("#interaction-title"),
  interactionDetail: $("#interaction-detail"),
  cash: $("#cash-value"),
  economyState: $("#economy-state"),
  health: $("#health-value"),
  armor: $("#armor-value"),
  armorLabel: $("#armor-label"),
  weaponName: $("#weapon-name"),
  weaponMode: $("#weapon-mode"),
  ammoMag: $("#ammo-mag"),
  ammoReserve: $("#ammo-reserve"),
  equipment: $("#equipment-strip"),
  crosshair: $("#crosshair"),
  hitMarker: $("#hit-marker"),
  centerMessage: $("#center-message"),
  spectator: $("#spectator-label"),
  spectatorName: $("#spectator-name"),
  damage: $("#damage-vignette"),
  flash: $("#flash-overlay"),
  scope: $("#scope-overlay"),
  letterbox: $("#letterbox"),
  buyCash: $("#buy-cash"),
  buyItems: $("#buy-items"),
  buyDetailClass: $("#buy-detail-class"),
  buyDetailName: $("#buy-detail-name"),
  buyDetailPrice: $("#buy-detail-price"),
  buySelected: $("#buy-selected"),
  statDamage: $("#stat-damage"),
  statRate: $("#stat-rate"),
  statControl: $("#stat-control"),
  statMobility: $("#stat-mobility"),
  scoreboardMap: $("#scoreboard-map"),
  scoreboardScore: $("#scoreboard-score"),
  scoreboardRows: $("#scoreboard-rows"),
  deathKiller: $("#death-killer"),
  deathWeapon: $("#death-weapon"),
  deathDistance: $("#death-distance"),
  bannerKicker: $("#round-banner-kicker"),
  bannerTitle: $("#round-banner-title"),
  bannerDetail: $("#round-banner-detail"),
  resultKicker: $("#result-kicker"),
  resultTitle: $("#result-title"),
  resultSummary: $("#result-summary"),
  resultKills: $("#result-kills"),
  resultDeaths: $("#result-deaths"),
  resultHeadshots: $("#result-headshots"),
  resultEconomy: $("#result-economy"),
};

const rules = new RoundRules();
const clock = new THREE.Clock();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(76, innerWidth / innerHeight, 0.05, 260);
camera.rotation.order = "YXZ";

const renderer = new THREE.WebGLRenderer({
  canvas: ui.canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const world = new THREE.Group();
const effects = new THREE.Group();
const characters = new THREE.Group();
scene.add(world, effects, characters, camera);

const hemisphere = new THREE.HemisphereLight(0xcfe4e8, 0x59452f, 1.8);
scene.add(hemisphere);
const sun = new THREE.DirectionalLight(0xffe1af, 4.4);
sun.position.set(-24, 46, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -65;
sun.shadow.camera.right = 65;
sun.shadow.camera.top = 65;
sun.shadow.camera.bottom = -65;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 120;
sun.shadow.bias = -0.00045;
scene.add(sun);

const state = {
  started: false,
  paused: false,
  audioEnabled: true,
  mapId: "dust2",
  map: MAPS.dust2,
  selectedTeam: TEAM.T,
  botCount: 8,
  difficulty: "regular",
  phase: PHASE.MENU,
  phaseBeforePause: PHASE.MENU,
  phaseTime: 0,
  round: 0,
  score: { T: 0, CT: 0 },
  lossStreak: { T: 0, CT: 0 },
  roundPlanted: false,
  roundWinner: null,
  roundReason: "",
  buyTime: 0,
  worldTime: 0,
  agents: [],
  player: null,
  spectator: null,
  bomb: {
    state: "carried",
    carrier: null,
    site: null,
    position: new THREE.Vector3(),
    timer: rules.bombTime,
    progress: 0,
    beep: 0,
    mesh: null,
  },
  controls: {
    yaw: 0,
    pitch: 0,
    locked: false,
    fire: false,
    aim: false,
    use: false,
    reload: false,
  },
  stats: {
    kills: 0,
    deaths: 0,
    shots: 0,
    hits: 0,
    headshots: 0,
    spent: 0,
  },
  selectedBuyCategory: "rifle",
  selectedBuyItem: "ak47",
  shotSounds: [],
  droppedWeapons: [],
  grenades: [],
  smokeZones: [],
  fireZones: [],
  particles: [],
  casings: [],
  tracers: [],
  damageFlash: 0,
  flashAmount: 0,
  flashDecay: 0,
  centerMessageTimer: 0,
};

const keys = new Set();
const worldMeshes = [];
const groundMeshes = [];
const solidMeshes = [];
const hitMeshes = [];
const colliders = [];
const nodeMarkers = new Map();
const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();
const tmpRay = new THREE.Raycaster();
const downRay = new THREE.Raycaster();
const radarContext = ui.radar.getContext("2d");

function makeNoiseTexture(base, fleck, size = 256, scale = 2) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  context.fillStyle = base;
  context.fillRect(0, 0, size, size);
  for (let index = 0; index < size * 9; index += 1) {
    const alpha = rand(0.025, 0.16);
    context.fillStyle = `rgba(${fleck[0]},${fleck[1]},${fleck[2]},${alpha})`;
    const radius = rand(0.35, 2.7);
    context.fillRect(rand(0, size), rand(0, size), radius, radius);
  }
  for (let index = 0; index < 22; index += 1) {
    context.strokeStyle = `rgba(${fleck[0]},${fleck[1]},${fleck[2]},${rand(0.03, 0.1)})`;
    context.lineWidth = rand(0.4, 1.4);
    context.beginPath();
    context.moveTo(rand(0, size), rand(0, size));
    context.lineTo(rand(0, size), rand(0, size));
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(scale, scale);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function makeSignTexture(text, color = "#eee0bd", background = "#754827") {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 180;
  const context = canvas.getContext("2d");
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "rgba(255,255,255,.35)";
  context.lineWidth = 8;
  context.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);
  context.fillStyle = color;
  context.font = '700 72px "Avenir Next Condensed", sans-serif';
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 3);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function makeRadialTexture(inner, outer) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.36, inner);
  gradient.addColorStop(1, outer);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function mapMaterials(map) {
  const desert = map.architecture === "desert";
  const industrial = map.architecture === "industrial";
  const wallTexture = makeNoiseTexture(
    desert ? "#b99762" : industrial ? "#505452" : "#68736d",
    desert ? [78, 54, 35] : industrial ? [12, 14, 13] : [24, 34, 31],
    256,
    2.4,
  );
  const groundTexture = makeNoiseTexture(
    desert ? "#866645" : industrial ? "#343738" : "#40534f",
    desert ? [222, 192, 145] : industrial ? [150, 91, 52] : [130, 155, 145],
    256,
    7,
  );
  const crateTexture = makeNoiseTexture(
    industrial ? "#564434" : "#745636",
    [224, 176, 99],
    128,
    1,
  );
  return {
    wall: new THREE.MeshStandardMaterial({
      map: wallTexture,
      color: map.palette.wall,
      roughness: desert ? 0.94 : 0.72,
      metalness: industrial ? 0.18 : 0,
    }),
    wallDark: new THREE.MeshStandardMaterial({
      map: wallTexture,
      color: map.palette.trim,
      roughness: 0.88,
      metalness: industrial ? 0.24 : 0.02,
    }),
    ground: new THREE.MeshStandardMaterial({
      map: groundTexture,
      color: map.palette.ground,
      roughness: 0.98,
      metalness: industrial ? 0.08 : 0,
    }),
    crate: new THREE.MeshStandardMaterial({
      map: crateTexture,
      color: industrial ? 0x5e4935 : 0x81613c,
      roughness: 0.82,
      metalness: 0.03,
    }),
    metal: new THREE.MeshStandardMaterial({
      color: industrial ? 0x32393a : 0x4c4a41,
      roughness: 0.48,
      metalness: 0.72,
    }),
    accent: new THREE.MeshStandardMaterial({
      color: map.palette.accent,
      roughness: 0.65,
      metalness: industrial ? 0.35 : 0,
    }),
    glass: new THREE.MeshPhysicalMaterial({
      color: industrial ? 0x6f8f98 : 0x7ba1a6,
      transparent: true,
      opacity: 0.28,
      roughness: 0.18,
      metalness: 0,
    }),
  };
}

function clearGroup(group) {
  while (group.children.length) {
    const child = group.children[0];
    group.remove(child);
    child.traverse?.((item) => {
      if (item.geometry) item.geometry.dispose();
      if (item.material && !Array.isArray(item.material)) item.material.dispose();
    });
  }
}

function addMesh(
  geometry,
  material,
  position,
  {
    rotation = [0, 0, 0],
    castShadow = true,
    receiveShadow = true,
    parent = world,
    solid = false,
    ground = false,
  } = {},
) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  parent.add(mesh);
  worldMeshes.push(mesh);
  if (solid) solidMeshes.push(mesh);
  if (ground) groundMeshes.push(mesh);
  return mesh;
}

function addCollider(x, y, z, width, height, depth, angle = 0, tag = "wall") {
  colliders.push({ x, y, z, width, height, depth, angle, tag });
}

function pointInsideCollider(x, y, z, collider, radius = 0.38) {
  if (y > collider.y + collider.height / 2 || y + 1.1 < collider.y - collider.height / 2) {
    return false;
  }
  const cos = Math.cos(-collider.angle);
  const sin = Math.sin(-collider.angle);
  const dx = x - collider.x;
  const dz = z - collider.z;
  const localX = dx * cos - dz * sin;
  const localZ = dx * sin + dz * cos;
  const halfW = collider.width / 2;
  const halfD = collider.depth / 2;
  const nearX = clamp(localX, -halfW, halfW);
  const nearZ = clamp(localZ, -halfD, halfD);
  return Math.hypot(localX - nearX, localZ - nearZ) < radius;
}

function addBox(
  position,
  size,
  material,
  { angle = 0, solid = true, ground = false, tag = "wall", parent = world } = {},
) {
  const [x, y, z] = position;
  const [width, height, depth] = size;
  const mesh = addMesh(
    new THREE.BoxGeometry(width, height, depth),
    material,
    position,
    { rotation: [0, angle, 0], solid, ground, parent },
  );
  if (solid) addCollider(x, y, z, width, height, depth, angle, tag);
  return mesh;
}

function addLane(start, end, width, materials, architecture, startDegree, endDegree) {
  const dx = end.position[0] - start.position[0];
  const dz = end.position[2] - start.position[2];
  const dy = end.position[1] - start.position[1];
  const horizontal = Math.hypot(dx, dz);
  if (horizontal < 0.1) return;
  const angle = Math.atan2(dx, dz);
  const slope = -Math.atan2(dy, horizontal);
  const floorCenter = [
    (start.position[0] + end.position[0]) / 2,
    (start.position[1] + end.position[1]) / 2 - 0.22,
    (start.position[2] + end.position[2]) / 2,
  ];
  const floor = addMesh(
    new THREE.BoxGeometry(width, 0.38, horizontal),
    materials.ground,
    floorCenter,
    { ground: true, castShadow: false },
  );
  floor.rotation.order = "YXZ";
  floor.rotation.y = angle;
  floor.rotation.x = slope;

  const wallSpan = calculateLaneWallSpan(start, end, startDegree, endDegree);
  if (!wallSpan) return;
  const center = [
    lerp(start.position[0], end.position[0], wallSpan.centerT),
    lerp(start.position[1], end.position[1], wallSpan.centerT) - 0.22,
    lerp(start.position[2], end.position[2], wallSpan.centerT),
  ];
  const wallLength = wallSpan.wallLength;
  const dirX = dx / horizontal;
  const dirZ = dz / horizontal;
  const sideX = dirZ;
  const sideZ = -dirX;
  const wallHeight = architecture === "industrial" ? 4.5 : architecture === "coastal" ? 4.1 : 4.8;
  const offset = width / 2 + 0.28;
  const wallY = center[1] + wallHeight / 2 - 0.05;
  for (const side of [-1, 1]) {
    const wallX = center[0] + sideX * offset * side;
    const wallZ = center[2] + sideZ * offset * side;
    addBox(
      [wallX, wallY, wallZ],
      [0.56, wallHeight, wallLength],
      side > 0 ? materials.wall : materials.wallDark,
      { angle, solid: true, tag: "lane-wall" },
    );
    if (horizontal > 13 && Math.random() > 0.38) {
      const cap = addBox(
        [wallX - sideX * side * 0.16, wallY + wallHeight * 0.4, wallZ - sideZ * side * 0.16],
        [0.8, 0.28, wallLength],
        materials.accent,
        { angle, solid: false },
      );
      cap.castShadow = false;
    }
  }
}

function addCrateStack(item, materials) {
  const [x, y, z] = item.position;
  const [width, height, depth] = item.size;
  const material =
    item.kind === "stone"
      ? materials.wallDark
      : item.kind === "machine" || item.kind === "vehicle" || item.kind === "container"
        ? materials.metal
        : materials.crate;
  const base = addBox(
    [x, y + height / 2, z],
    [width, height, depth],
    material,
    { solid: true, tag: "cover" },
  );
  if (item.kind === "crate" || item.kind === "wood") {
    const slatMaterial = materials.wallDark;
    const slatThickness = 0.1;
    for (const side of [-1, 1]) {
      addBox(
        [x + side * (width / 2 + 0.055), y + height / 2, z],
        [slatThickness, height * 0.82, depth * 0.86],
        slatMaterial,
        { solid: false },
      );
    }
    addBox(
      [x, y + height + 0.05, z],
      [width * 0.9, 0.1, depth * 0.9],
      slatMaterial,
      { solid: false },
    );
  } else if (item.kind === "vehicle") {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        addMesh(
          new THREE.CylinderGeometry(0.42, 0.42, 0.32, 16),
          materials.wallDark,
          [x + sx * width * 0.31, y + 0.42, z + sz * depth * 0.48],
          { rotation: [0, 0, Math.PI / 2], solid: false },
        );
      }
    }
    addBox(
      [x, y + height * 0.82, z - depth * 0.08],
      [width * 0.58, height * 0.46, depth * 0.7],
      materials.glass,
      { solid: false },
    );
  } else if (item.kind === "tank" || item.kind === "machine") {
    addMesh(
      new THREE.CylinderGeometry(width * 0.32, width * 0.36, height * 0.76, 18),
      materials.metal,
      [x, y + height * 0.72, z],
      { solid: false },
    );
    addBox(
      [x, y + height * 0.23, z],
      [width * 0.88, height * 0.18, depth * 0.88],
      materials.accent,
      { solid: false },
    );
  } else if (item.kind === "container") {
    for (let offset = -width * 0.36; offset <= width * 0.36; offset += width * 0.18) {
      addBox(
        [x + offset, y + height / 2, z + depth / 2 + 0.04],
        [0.07, height * 0.9, 0.08],
        materials.wallDark,
        { solid: false },
      );
    }
  }
  base.userData.coverId = item.id;
}

function addDoorFrame(nodeItem, materials, doubleDoor = false) {
  const [x, y, z] = nodeItem.position;
  const width = doubleDoor ? 5.8 : 4.4;
  addBox([x - width / 2, y + 2.2, z], [0.65, 4.4, 1.1], materials.wallDark, {
    solid: true,
    tag: "door-frame",
  });
  addBox([x + width / 2, y + 2.2, z], [0.65, 4.4, 1.1], materials.wallDark, {
    solid: true,
    tag: "door-frame",
  });
  addBox([x, y + 4.35, z], [width + 0.65, 0.55, 1.1], materials.wallDark, {
    solid: true,
    tag: "door-frame",
  });
  const leafWidth = doubleDoor ? 2.15 : 1.4;
  const leafOffset = doubleDoor ? 1.58 : 1.18;
  for (const side of [-1, 1]) {
    addBox(
      [x + side * leafOffset, y + 1.65, z + side * 0.28],
      [leafWidth, 3.2, 0.24],
      materials.crate,
      { angle: side * 0.23, solid: true, tag: "door" },
    );
  }
}

function addArch(nodeItem, materials) {
  const [x, y, z] = nodeItem.position;
  const arch = new THREE.Group();
  const sideGeometry = new THREE.BoxGeometry(1.05, 4.2, 1.3);
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(sideGeometry, materials.wallDark);
    pillar.position.set(side * 2.55, 2.1, 0);
    pillar.castShadow = pillar.receiveShadow = true;
    arch.add(pillar);
    addCollider(x + side * 2.55, y + 2.1, z, 1.05, 4.2, 1.3, 0, "arch");
  }
  const curve = new THREE.Mesh(
    new THREE.TorusGeometry(2.55, 0.55, 12, 30, Math.PI),
    materials.wallDark,
  );
  curve.rotation.z = Math.PI;
  curve.position.y = 3.55;
  curve.castShadow = true;
  arch.add(curve);
  arch.position.set(x, y, z);
  world.add(arch);
}

function addSite(site, map, materials) {
  const siteNode = nodeById(map, site.node);
  if (!siteNode) return;
  const [x, y, z] = siteNode.position;
  const color = site.id === "A" ? 0xd86b36 : 0xd5a140;
  const ringMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });
  const ring = addMesh(
    new THREE.RingGeometry(site.radius * 0.63, site.radius * 0.72, 40),
    ringMaterial,
    [x, y + 0.08, z],
    { rotation: [-Math.PI / 2, 0, 0], castShadow: false, receiveShadow: false },
  );
  ring.userData.site = site.id;
  const textTexture = makeSignTexture(site.id, "#f8e4b8", site.id === "A" ? "#943a25" : "#85641f");
  const marker = addMesh(
    new THREE.PlaneGeometry(2.6, 0.95),
    new THREE.MeshBasicMaterial({ map: textTexture, transparent: true }),
    [x, y + 0.11, z],
    { rotation: [-Math.PI / 2, 0, 0], castShadow: false, receiveShadow: false },
  );
  marker.renderOrder = 2;
  const light = new THREE.PointLight(color, 3, 12, 2);
  light.position.set(x, y + 2.4, z);
  world.add(light);
}

function addNodeMarker(nodeItem, map, materials) {
  const [x, y, z] = nodeItem.position;
  const marker = new THREE.Object3D();
  marker.position.set(x, y, z);
  marker.userData.node = nodeItem;
  nodeMarkers.set(nodeItem.id, marker);
  world.add(marker);
  if (
    ["aSite", "bSite", "tSpawn", "ctSpawn"].includes(nodeItem.id) ||
    nodeItem.callout.includes("中路")
  ) {
    const sign = addMesh(
      new THREE.PlaneGeometry(3.6, 1.24),
      new THREE.MeshBasicMaterial({
        map: makeSignTexture(nodeItem.callout, "#f1e5c8", nodeItem.id.includes("Site") ? "#8b3f2c" : "#5d4b35"),
      }),
      [x, y + 2.75, z],
      { castShadow: false, receiveShadow: false },
    );
    sign.rotation.y = Math.PI;
  }
}

function distanceToLane(x, z, start, end) {
  const ax = start.position[0];
  const az = start.position[2];
  const bx = end.position[0];
  const bz = end.position[2];
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq ? clamp(((x - ax) * dx + (z - az) * dz) / lengthSq, 0, 1) : 0;
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
}

function seededGenerator(text) {
  let seed = [...text].reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 2166136261);
  return (min, max) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return min + (seed / 4294967296) * (max - min);
  };
}

function addArchitecture(map, materials) {
  const mapRand = seededGenerator(map.id);
  const nodesById = new Map(map.nodes.map((item) => [item.id, item]));
  const nearLane = (x, z, clearance) =>
    map.links.some(([startId, endId]) => distanceToLane(x, z, nodesById.get(startId), nodesById.get(endId)) < clearance);
  if (map.architecture === "desert") {
    for (let index = 0; index < 19; index += 1) {
      const x = mapRand(map.bounds[0] + 3, map.bounds[1] - 3);
      const z = mapRand(map.bounds[2] + 3, map.bounds[3] - 3);
      const nearNode = map.nodes.some((item) => Math.hypot(item.position[0] - x, item.position[2] - z) < 5.5);
      if (nearNode || nearLane(x, z, 6.2)) continue;
      const width = mapRand(4.5, 9);
      const depth = mapRand(4.5, 8);
      const height = mapRand(4, 9);
      addBox([x, height / 2 - 0.1, z], [width, height, depth], index % 3 ? materials.wall : materials.wallDark, {
        solid: true,
        tag: "building",
      });
      if (index % 2 === 0) {
        addBox([x, height + 0.18, z], [width * 0.88, 0.3, depth * 0.88], materials.accent, {
          solid: false,
        });
      }
    }
    ["longDoors", "doubleDoors", "midDoors"].forEach((id) => {
      const target = nodeById(map, id);
      if (target) addDoorFrame(target, materials, id !== "longDoors");
    });
    const archTarget = nodeById(map, "bDoors");
    if (archTarget) addArch(archTarget, materials);
  } else if (map.architecture === "industrial") {
    for (let index = 0; index < 8; index += 1) {
      const x = -32 + index * 9;
      addMesh(
        new THREE.CylinderGeometry(0.45, 0.55, mapRand(9, 16), 12),
        materials.metal,
        [x, mapRand(4.5, 8), -29],
        { solid: false },
      );
    }
    for (let index = 0; index < 12; index += 1) {
      const x = mapRand(map.bounds[0], map.bounds[1]);
      const z = mapRand(map.bounds[2], map.bounds[3]);
      const nearNode = map.nodes.some((item) => Math.hypot(item.position[0] - x, item.position[2] - z) < 5);
      if (nearNode || nearLane(x, z, 5.8)) continue;
      addBox([x, 3.2, z], [mapRand(4, 8), 6.4, mapRand(4, 8)], materials.wallDark, {
        solid: true,
        tag: "factory-block",
      });
    }
  } else {
    for (let index = 0; index < 16; index += 1) {
      const x = mapRand(map.bounds[0], map.bounds[1]);
      const z = mapRand(map.bounds[2], map.bounds[3]);
      const nearNode = map.nodes.some((item) => Math.hypot(item.position[0] - x, item.position[2] - z) < 5);
      if (nearNode || nearLane(x, z, 6)) continue;
      addBox([x, 2.8, z], [mapRand(4, 7), 5.6, mapRand(4, 7)], index % 2 ? materials.wall : materials.wallDark, {
        solid: true,
        tag: "coastal-block",
      });
    }
    const water = addMesh(
      new THREE.PlaneGeometry(90, 24),
      new THREE.MeshPhysicalMaterial({
        color: 0x304b52,
        roughness: 0.18,
        metalness: 0.08,
        transparent: true,
        opacity: 0.82,
      }),
      [-32, -1.8, 9],
      { rotation: [-Math.PI / 2, 0, Math.PI / 2], castShadow: false, receiveShadow: false },
    );
    water.userData.water = true;
  }
}

function buildMap(map) {
  clearGroup(world);
  clearGroup(effects);
  clearGroup(characters);
  worldMeshes.length = 0;
  groundMeshes.length = 0;
  solidMeshes.length = 0;
  hitMeshes.length = 0;
  colliders.length = 0;
  nodeMarkers.clear();
  state.grenades.length = 0;
  state.smokeZones.length = 0;
  state.fireZones.length = 0;
  state.particles.length = 0;
  state.casings.length = 0;
  state.tracers.length = 0;
  state.droppedWeapons.length = 0;

  scene.background = new THREE.Color(map.palette.sky);
  scene.fog = new THREE.FogExp2(map.palette.fog, map.architecture === "desert" ? 0.009 : 0.013);
  hemisphere.color.set(map.palette.sky);
  hemisphere.groundColor.set(map.palette.ground);
  sun.color.set(map.palette.light);
  sun.intensity = map.architecture === "industrial" ? 2.5 : 4.4;

  const materials = mapMaterials(map);
  state.materials = materials;
  const width = map.bounds[1] - map.bounds[0] + 28;
  const depth = map.bounds[3] - map.bounds[2] + 28;
  const centerX = (map.bounds[0] + map.bounds[1]) / 2;
  const centerZ = (map.bounds[2] + map.bounds[3]) / 2;
  addMesh(
    new THREE.PlaneGeometry(width, depth, 1, 1),
    materials.ground,
    [centerX, -0.35, centerZ],
    { rotation: [-Math.PI / 2, 0, 0], castShadow: false, ground: true },
  );

  const nodes = new Map(map.nodes.map((item) => [item.id, item]));
  const nodeDegrees = new Map(map.nodes.map((item) => [item.id, 0]));
  for (const [startId, endId] of map.links) {
    nodeDegrees.set(startId, (nodeDegrees.get(startId) ?? 0) + 1);
    nodeDegrees.set(endId, (nodeDegrees.get(endId) ?? 0) + 1);
  }
  for (const [startId, endId] of map.links) {
    const start = nodes.get(startId);
    const end = nodes.get(endId);
    if (start && end) {
      const laneWidth = map.architecture === "industrial" ? 7.2 : map.architecture === "coastal" ? 7.8 : 8.2;
      addLane(
        start,
        end,
        laneWidth,
        materials,
        map.architecture,
        nodeDegrees.get(startId),
        nodeDegrees.get(endId),
      );
    }
  }

  for (const item of map.nodes) {
    const [x, y, z] = item.position;
    const pad = addMesh(
      new THREE.CylinderGeometry(item.radius + 1.1, item.radius + 1.1, 0.32, 24),
      materials.ground,
      [x, y - 0.16, z],
      { ground: true, castShadow: false },
    );
    pad.receiveShadow = true;
    addNodeMarker(item, map, materials);
  }

  for (const item of map.cover) addCrateStack(item, materials);
  for (const site of map.sites) addSite(site, map, materials);
  addArchitecture(map, materials);

  const perimeterHeight = 5.5;
  const xMid = (map.bounds[0] + map.bounds[1]) / 2;
  const zMid = (map.bounds[2] + map.bounds[3]) / 2;
  const xSize = map.bounds[1] - map.bounds[0] + 4;
  const zSize = map.bounds[3] - map.bounds[2] + 4;
  addBox([xMid, perimeterHeight / 2, map.bounds[2] - 2], [xSize, perimeterHeight, 1], materials.wallDark, { tag: "perimeter" });
  addBox([xMid, perimeterHeight / 2, map.bounds[3] + 2], [xSize, perimeterHeight, 1], materials.wallDark, { tag: "perimeter" });
  addBox([map.bounds[0] - 2, perimeterHeight / 2, zMid], [1, perimeterHeight, zSize], materials.wallDark, { tag: "perimeter" });
  addBox([map.bounds[1] + 2, perimeterHeight / 2, zMid], [1, perimeterHeight, zSize], materials.wallDark, { tag: "perimeter" });

  if (map.architecture === "coastal") createRain();
  createAtmosphere(map);
  renderer.shadowMap.needsUpdate = true;
}

function createAtmosphere(map) {
  const count = map.architecture === "desert" ? 600 : 320;
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = rand(map.bounds[0] - 10, map.bounds[1] + 10);
    positions[index * 3 + 1] = rand(0.4, 14);
    positions[index * 3 + 2] = rand(map.bounds[2] - 10, map.bounds[3] + 10);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const dustTexture = makeRadialTexture("rgba(255,238,196,.52)", "rgba(255,238,196,0)");
  const material = new THREE.PointsMaterial({
    map: dustTexture,
    size: map.architecture === "desert" ? 0.28 : 0.18,
    transparent: true,
    opacity: map.architecture === "desert" ? 0.4 : 0.18,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.userData.atmosphere = true;
  effects.add(points);
  state.atmosphere = points;
}

function createRain() {
  const count = 900;
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = rand(-50, 50);
    positions[index * 3 + 1] = rand(0, 25);
    positions[index * 3 + 2] = rand(-42, 54);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xaec8cb,
    size: 0.08,
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
  });
  const rain = new THREE.Points(geometry, material);
  rain.userData.rain = true;
  effects.add(rain);
  state.rain = rain;
}

function groundHeightAt(x, z, fallback = 0) {
  downRay.set(new THREE.Vector3(x, 22, z), new THREE.Vector3(0, -1, 0));
  downRay.far = 40;
  const hit = downRay.intersectObjects(groundMeshes, false)[0];
  return hit ? hit.point.y : fallback;
}

function currentNode(position) {
  let closest = null;
  let closestDistance = Infinity;
  for (const item of state.map.nodes) {
    const distance = Math.hypot(item.position[0] - position.x, item.position[2] - position.z);
    if (distance < closestDistance) {
      closest = item;
      closestDistance = distance;
    }
  }
  return closest;
}

class TacticalAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.noiseBuffer = null;
    this.ambient = null;
  }

  ensure() {
    if (this.context) {
      if (this.context.state === "suspended") this.context.resume();
      return;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = state.audioEnabled ? 0.36 : 0;
    this.master.connect(this.context.destination);
    const length = this.context.sampleRate * 2;
    this.noiseBuffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) data[index] = Math.random() * 2 - 1;
  }

  setEnabled(enabled) {
    state.audioEnabled = enabled;
    this.ensure();
    if (this.master) this.master.gain.setTargetAtTime(enabled ? 0.36 : 0, this.context.currentTime, 0.03);
  }

  tone(frequency, duration, volume = 0.1, type = "sine", slide = null) {
    this.ensure();
    if (!this.context || !state.audioEnabled) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    if (slide) oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, slide), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  noise(duration, volume, filterFrequency = 1200, detune = 0) {
    this.ensure();
    if (!this.context || !state.audioEnabled || !this.noiseBuffer) return;
    const now = this.context.currentTime;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.noiseBuffer;
    source.playbackRate.value = 1 + detune;
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(filterFrequency, now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(120, filterFrequency * 0.24), now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(now);
    source.stop(now + duration);
  }

  gun(weapon) {
    const sniper = weapon.class === "sniper";
    const shotgun = weapon.class === "shotgun";
    this.noise(sniper ? 0.48 : shotgun ? 0.35 : 0.18, sniper ? 0.36 : 0.25, sniper ? 1900 : 2600, rand(-0.08, 0.08));
    this.tone(sniper ? 74 : shotgun ? 92 : weapon.class === "pistol" ? 142 : 108, sniper ? 0.34 : 0.13, sniper ? 0.25 : 0.12, "sawtooth", 42);
    if (weapon.id === "usp") this.tone(420, 0.05, 0.035, "square", 280);
  }

  step(surface = "stone", quiet = false) {
    this.noise(0.075, quiet ? 0.018 : 0.045, surface === "metal" ? 1600 : 800, rand(-0.12, 0.08));
    this.tone(surface === "metal" ? 310 : 120, 0.045, quiet ? 0.008 : 0.018, "triangle", 80);
  }

  reload() {
    this.noise(0.08, 0.05, 2100);
    setTimeout(() => this.tone(840, 0.045, 0.028, "square", 520), 250);
    setTimeout(() => this.noise(0.07, 0.04, 1600), 530);
  }

  throw() {
    this.noise(0.1, 0.04, 700);
    this.tone(210, 0.08, 0.018, "triangle", 120);
  }

  explosion(kind = "frag") {
    this.noise(kind === "frag" ? 0.9 : 0.55, kind === "frag" ? 0.5 : 0.28, kind === "frag" ? 1800 : 950);
    this.tone(kind === "frag" ? 48 : 72, 0.6, 0.28, "sawtooth", 24);
  }

  hit(headshot = false) {
    this.tone(headshot ? 1220 : 720, 0.045, 0.04, "square", headshot ? 880 : 510);
  }

  beep(urgent = false) {
    this.tone(urgent ? 1040 : 820, urgent ? 0.09 : 0.07, 0.08, "square");
  }

  objective(success = true) {
    this.tone(success ? 420 : 230, 0.18, 0.09, "triangle", success ? 680 : 170);
    setTimeout(() => this.tone(success ? 620 : 180, 0.26, 0.075, "triangle", success ? 920 : 120), 150);
  }

  ambientFor(map) {
    this.ensure();
    if (!this.context || !this.noiseBuffer) return;
    if (this.ambient) {
      try {
        this.ambient.stop();
      } catch {
        // The previous one-shot source may already have stopped.
      }
    }
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    filter.type = map.ambient === "rain" ? "highpass" : "lowpass";
    filter.frequency.value = map.ambient === "rain" ? 3200 : map.ambient === "factory" ? 260 : 520;
    gain.gain.value = map.ambient === "rain" ? 0.028 : 0.015;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start();
    this.ambient = source;
  }
}

const audio = new TacticalAudio();

function createWeaponModel(weapon, team = TEAM.T) {
  const group = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d2220, roughness: 0.38, metalness: 0.72 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x4d5653, roughness: 0.3, metalness: 0.86 });
  const wood = new THREE.MeshStandardMaterial({
    color: team === TEAM.T ? 0x805131 : 0x303c3f,
    roughness: 0.66,
    metalness: 0.04,
  });
  const accent = new THREE.MeshStandardMaterial({
    color: team === TEAM.T ? 0x9e672d : 0x426b7e,
    roughness: 0.45,
    metalness: 0.24,
  });

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(
      weapon.class === "pistol" ? 0.14 : 0.18,
      weapon.class === "pistol" ? 0.18 : 0.2,
      weapon.class === "sniper" ? 1.15 : weapon.class === "shotgun" ? 1.02 : weapon.class === "rifle" ? 0.92 : 0.72,
    ),
    steel,
  );
  body.castShadow = true;
  group.add(body);

  const barrelLength =
    weapon.class === "sniper" ? 0.92 : weapon.class === "shotgun" ? 0.75 : weapon.class === "pistol" ? 0.28 : 0.52;
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.045, barrelLength, 10),
    dark,
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = -body.geometry.parameters.depth / 2 - barrelLength / 2 + 0.04;
  barrel.castShadow = true;
  group.add(barrel);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, barrel.position.z - barrelLength / 2);
  group.add(muzzle);
  group.userData.muzzle = muzzle;

  if (!["pistol", "grenade", "melee"].includes(weapon.class)) {
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 0.42), wood);
    stock.position.set(0, -0.02, body.geometry.parameters.depth / 2 + 0.17);
    stock.rotation.x = -0.12;
    stock.castShadow = true;
    group.add(stock);
    const magazine = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.34, 0.2), accent);
    magazine.position.set(0, -0.24, 0.05);
    magazine.rotation.x = -0.17;
    magazine.castShadow = true;
    group.add(magazine);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.3), dark);
    sight.position.set(0, 0.15, -0.08);
    group.add(sight);
  }

  if (weapon.class === "sniper") {
    const scopeBody = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.48, 14), dark);
    scopeBody.rotation.x = Math.PI / 2;
    scopeBody.position.set(0, 0.21, -0.08);
    group.add(scopeBody);
    for (const z of [-0.17, 0.17]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.018, 8, 16), accent);
      ring.position.set(0, 0.21, z - 0.08);
      group.add(ring);
    }
  }

  if (weapon.class === "pistol") {
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.32, 0.2), wood);
    grip.position.set(0, -0.24, 0.12);
    grip.rotation.x = -0.13;
    group.add(grip);
  }

  if (weapon.class === "grenade") {
    group.clear();
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 14, 10),
      new THREE.MeshStandardMaterial({
        color: weapon.effect === "flash" ? 0xc7c4ad : weapon.effect === "smoke" ? 0x6b756e : weapon.effect === "fire" ? 0x6d3b25 : 0x4e5844,
        roughness: 0.56,
        metalness: 0.46,
      }),
    );
    shell.scale.y = 1.18;
    group.add(shell);
    const pin = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 12), steel);
    pin.position.set(0.08, 0.13, 0);
    pin.rotation.x = Math.PI / 2;
    group.add(pin);
    const grenadeMuzzle = new THREE.Object3D();
    grenadeMuzzle.position.z = -0.18;
    group.add(grenadeMuzzle);
    group.userData.muzzle = grenadeMuzzle;
  }

  if (weapon.class === "melee") {
    group.clear();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.58), steel);
    blade.position.z = -0.22;
    group.add(blade);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, 0.28), dark);
    handle.position.z = 0.2;
    group.add(handle);
    const knifeMuzzle = new THREE.Object3D();
    knifeMuzzle.position.z = -0.55;
    group.add(knifeMuzzle);
    group.userData.muzzle = knifeMuzzle;
  }

  return group;
}

function createBombMesh() {
  const group = new THREE.Group();
  const packMaterial = new THREE.MeshStandardMaterial({ color: 0x27302a, roughness: 0.82 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x59615b, roughness: 0.38, metalness: 0.76 });
  const displayMaterial = new THREE.MeshBasicMaterial({ color: 0xe54f35 });
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.38), packMaterial);
  pack.castShadow = true;
  group.add(pack);
  const display = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.035), displayMaterial);
  display.position.set(0, 0.05, -0.21);
  group.add(display);
  for (let index = -1; index <= 1; index += 1) {
    const charge = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.36, 10), metal);
    charge.rotation.z = Math.PI / 2;
    charge.position.set(index * 0.13, -0.12, 0);
    group.add(charge);
  }
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.26, 6), metal);
  antenna.position.set(0.18, 0.26, 0.08);
  antenna.rotation.z = -0.25;
  group.add(antenna);
  group.userData.display = display;
  return group;
}

const BOT_NAMES = [
  "Viper",
  "Nomad",
  "Rook",
  "Atlas",
  "Mako",
  "Echo",
  "Hawk",
  "Sable",
  "Cinder",
  "Knox",
  "Rivet",
  "Ghost",
];

function makeWeaponState(id) {
  const config = WEAPONS[id];
  return {
    id,
    ammo: config.magazine,
    reserve: config.reserve,
    cooldown: 0,
    reloading: 0,
    reloadStart: 0,
    shotIndex: 0,
  };
}

function giveWeapon(agent, id, equip = true) {
  const config = WEAPONS[id];
  if (!config) return;
  if (config.class === "grenade") {
    agent.grenades.set(id, Math.min(id === "flashbang" ? 2 : 1, (agent.grenades.get(id) ?? 0) + 1));
    if (equip) switchWeapon(agent, id);
    return;
  }
  if (config.slot === 1 && config.class !== "melee") {
    for (const [weaponId] of agent.weapons) {
      const owned = WEAPONS[weaponId];
      if (owned?.slot === 1) agent.weapons.delete(weaponId);
    }
  }
  if (config.slot === 2) {
    for (const [weaponId] of agent.weapons) {
      if (WEAPONS[weaponId]?.slot === 2) agent.weapons.delete(weaponId);
    }
  }
  agent.weapons.set(id, makeWeaponState(id));
  if (equip) switchWeapon(agent, id);
}

function defaultLoadout(agent) {
  agent.weapons.clear();
  agent.grenades.clear();
  giveWeapon(agent, "knife", false);
  giveWeapon(agent, agent.team === TEAM.T ? "glock" : "usp", true);
  agent.armor = 0;
  agent.helmet = false;
  agent.kit = false;
}

function availableWeaponIds(agent) {
  const firearms = [...agent.weapons.keys()]
    .filter((id) => WEAPONS[id].class !== "melee")
    .sort((a, b) => WEAPONS[a].slot - WEAPONS[b].slot);
  return [...firearms, "knife", ...agent.grenades.keys()];
}

function switchWeapon(agent, id) {
  if (WEAPONS[id]?.class === "grenade" && !agent.grenades.has(id)) return;
  if (WEAPONS[id]?.class !== "grenade" && !agent.weapons.has(id)) return;
  agent.currentWeaponId = id;
  agent.reloadLocked = false;
  if (agent.isPlayer) rebuildViewModel();
  else rebuildBotWeapon(agent);
}

function weaponState(agent) {
  const config = WEAPONS[agent.currentWeaponId];
  if (!config) return null;
  if (config.class === "grenade") {
    return {
      id: config.id,
      ammo: agent.grenades.get(config.id) ?? 0,
      reserve: 0,
      cooldown: agent.grenadeCooldown ?? 0,
      reloading: 0,
    };
  }
  return agent.weapons.get(config.id) ?? null;
}

function createCharacter(agent) {
  const root = new THREE.Group();
  const uniform = new THREE.MeshStandardMaterial({
    color: agent.team === TEAM.T ? 0x6d5538 : 0x334f5f,
    roughness: 0.78,
    metalness: 0.02,
  });
  const armor = new THREE.MeshStandardMaterial({
    color: agent.team === TEAM.T ? 0x323428 : 0x202b32,
    roughness: 0.62,
    metalness: 0.18,
  });
  const skin = new THREE.MeshStandardMaterial({ color: 0xa77859, roughness: 0.82 });

  const legs = new THREE.Group();
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.62, 5, 8), uniform);
    leg.position.set(side * 0.18, 0.55, 0);
    leg.castShadow = true;
    legs.add(leg);
  }
  root.add(legs);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.62, 6, 10), armor);
  torso.position.y = 1.35;
  torso.scale.z = 0.72;
  torso.castShadow = true;
  root.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), skin);
  head.position.y = 2.05;
  head.castShadow = true;
  root.add(head);

  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.27, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.58),
    armor,
  );
  helmet.position.y = 2.1;
  helmet.rotation.x = -0.08;
  root.add(helmet);

  const bodyHit = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.42, 0.8, 4, 8),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  bodyHit.position.y = 1.25;
  bodyHit.userData.agent = agent;
  bodyHit.userData.hitZone = "body";
  root.add(bodyHit);
  hitMeshes.push(bodyHit);

  const headHit = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 10, 8),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  headHit.position.y = 2.06;
  headHit.userData.agent = agent;
  headHit.userData.hitZone = "head";
  root.add(headHit);
  hitMeshes.push(headHit);

  const weaponMount = new THREE.Group();
  weaponMount.position.set(0.32, 1.45, -0.28);
  weaponMount.rotation.set(0.08, 0, -0.04);
  root.add(weaponMount);

  const marker = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeRadialTexture(
        agent.team === TEAM.T ? "rgba(225,161,67,.95)" : "rgba(117,183,222,.95)",
        "rgba(0,0,0,0)",
      ),
      transparent: true,
      depthWrite: false,
    }),
  );
  marker.position.y = 2.75;
  marker.scale.set(0.45, 0.45, 0.45);
  marker.visible = false;
  root.add(marker);

  root.userData = { agent, torso, head, legs, weaponMount, marker, materials: { uniform, armor } };
  characters.add(root);
  agent.mesh = root;
  agent.bodyHit = bodyHit;
  agent.headHit = headHit;
  rebuildBotWeapon(agent);
  return root;
}

function rebuildBotWeapon(agent) {
  if (!agent.mesh || agent.isPlayer) return;
  const mount = agent.mesh.userData.weaponMount;
  clearGroup(mount);
  const weapon = WEAPONS[agent.currentWeaponId];
  if (!weapon) return;
  const model = createWeaponModel(weapon, agent.team);
  model.scale.setScalar(0.72);
  model.rotation.y = Math.PI;
  mount.add(model);
  mount.userData.model = model;
}

function updateCharacterTeam(agent) {
  if (!agent.mesh) return;
  agent.mesh.userData.materials.uniform.color.set(agent.team === TEAM.T ? 0x6d5538 : 0x334f5f);
  agent.mesh.userData.materials.armor.color.set(agent.team === TEAM.T ? 0x323428 : 0x202b32);
  agent.mesh.userData.marker.material.map = makeRadialTexture(
    agent.team === TEAM.T ? "rgba(225,161,67,.95)" : "rgba(117,183,222,.95)",
    "rgba(0,0,0,0)",
  );
  rebuildBotWeapon(agent);
}

function createAgent({ id, name, team, isPlayer = false }) {
  const agent = {
    id,
    name,
    team,
    isPlayer,
    alive: true,
    health: 100,
    armor: 0,
    helmet: false,
    kit: false,
    money: ECONOMY.startMoney,
    kills: 0,
    deaths: 0,
    assists: 0,
    lossStreak: 0,
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    yaw: team === TEAM.T ? Math.PI : 0,
    pitch: 0,
    crouched: false,
    onGround: true,
    groundY: 0,
    viewHeight: 1.72,
    stepTimer: 0,
    weapons: new Map(),
    grenades: new Map(),
    currentWeaponId: null,
    mesh: null,
    role: "support",
    targetNode: null,
    path: [],
    pathIndex: 0,
    decisionTimer: rand(0.1, 0.4),
    aimTimer: 0,
    burstRemaining: 0,
    lastSeen: null,
    heardPosition: null,
    perceptionTimer: rand(0.02, 0.12),
    visibleTarget: null,
    visibleDistance: Infinity,
    plantProgress: 0,
    defuseProgress: 0,
    boughtThisRound: false,
    survivedLastRound: false,
    deathTime: 0,
    grenadeCooldown: 0,
  };
  defaultLoadout(agent);
  if (!isPlayer) createCharacter(agent);
  return agent;
}

const viewModel = new THREE.Group();
viewModel.position.set(0.32, -0.29, -0.62);
viewModel.rotation.set(-0.04, 0.08, 0);
camera.add(viewModel);

function rebuildViewModel() {
  clearGroup(viewModel);
  const player = state.player;
  if (!player) return;
  const weapon = WEAPONS[player.currentWeaponId];
  if (!weapon) return;
  const model = createWeaponModel(weapon, player.team);
  model.rotation.y = Math.PI;
  model.scale.setScalar(weapon.class === "pistol" ? 0.88 : weapon.class === "grenade" ? 1.05 : 0.76);
  viewModel.add(model);
  viewModel.userData.model = model;
  viewModel.userData.weapon = weapon;
  viewModel.userData.recoil = 0;
  viewModel.userData.sway = 0;
  viewModel.userData.reload = 0;

  const sleeve = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.075, 0.42, 5, 8),
    new THREE.MeshStandardMaterial({
      color: player.team === TEAM.T ? 0x5e4d34 : 0x283e49,
      roughness: 0.82,
    }),
  );
  sleeve.position.set(0.18, -0.12, 0.24);
  sleeve.rotation.x = Math.PI / 2.4;
  sleeve.rotation.z = 0.18;
  viewModel.add(sleeve);
  const hand = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 12, 9),
    new THREE.MeshStandardMaterial({ color: 0x9f7357, roughness: 0.88 }),
  );
  hand.scale.set(0.8, 0.62, 1.3);
  hand.position.set(0.14, -0.08, -0.02);
  viewModel.add(hand);
}

function makeAgents() {
  clearGroup(characters);
  hitMeshes.length = 0;
  state.agents.length = 0;
  const player = createAgent({
    id: "player",
    name: "YOU",
    team: state.selectedTeam,
    isPlayer: true,
  });
  state.player = player;
  state.agents.push(player);

  const sameTeamBots = Math.floor(state.botCount / 2);
  const enemyBots = state.botCount - sameTeamBots;
  let nameIndex = 0;
  for (let index = 0; index < sameTeamBots; index += 1) {
    const agent = createAgent({
      id: `ally-${index}`,
      name: `BOT ${BOT_NAMES[nameIndex++]}`,
      team: player.team,
    });
    state.agents.push(agent);
  }
  for (let index = 0; index < enemyBots; index += 1) {
    const agent = createAgent({
      id: `enemy-${index}`,
      name: `BOT ${BOT_NAMES[nameIndex++]}`,
      team: otherTeam(player.team),
    });
    state.agents.push(agent);
  }
  assignRoles();
  rebuildViewModel();
}

function assignRoles() {
  const roles = ["entry", "support", "lurk", "anchor", "rotator"];
  for (const team of [TEAM.T, TEAM.CT]) {
    state.agents
      .filter((agent) => agent.team === team)
      .forEach((agent, index) => {
        agent.role = roles[index % roles.length];
      });
  }
}

function spawnAgent(agent, indexInTeam) {
  const spawnId = state.map.spawns[agent.team];
  const spawn = nodeById(state.map, spawnId);
  const angle = (indexInTeam / Math.max(1, state.agents.filter((item) => item.team === agent.team).length)) * Math.PI * 2;
  const radius = indexInTeam === 0 ? 0 : 1.15 + Math.floor(indexInTeam / 5) * 0.8;
  agent.position.set(
    spawn.position[0] + Math.cos(angle) * radius,
    spawn.position[1],
    spawn.position[2] + Math.sin(angle) * radius,
  );
  agent.groundY = spawn.position[1];
  agent.velocity.set(0, 0, 0);
  agent.yaw = spawnFacingYaw(state.map, agent.team);
  agent.pitch = 0;
  agent.alive = true;
  agent.health = 100;
  agent.plantProgress = 0;
  agent.defuseProgress = 0;
  agent.decisionTimer = rand(0.05, 0.35);
  agent.targetNode = null;
  agent.path = [];
  agent.pathIndex = 0;
  if (agent.mesh) {
    agent.mesh.visible = true;
    agent.mesh.position.copy(agent.position);
    agent.mesh.rotation.y = agent.yaw;
  }
  if (agent.isPlayer) {
    state.controls.yaw = agent.yaw;
    state.controls.pitch = 0;
    camera.position.set(agent.position.x, agent.position.y + agent.viewHeight, agent.position.z);
  }
}

function canMoveTo(position, currentY, radius = 0.38) {
  for (const collider of colliders) {
    if (pointInsideCollider(position.x, currentY + 0.8, position.z, collider, radius)) return false;
  }
  return true;
}

function moveWithCollisions(agent, displacement) {
  const nextX = agent.position.clone();
  nextX.x += displacement.x;
  if (canMoveTo(nextX, agent.position.y)) agent.position.x = nextX.x;
  else agent.velocity.x = 0;

  const nextZ = agent.position.clone();
  nextZ.z += displacement.z;
  if (canMoveTo(nextZ, agent.position.y)) agent.position.z = nextZ.z;
  else agent.velocity.z = 0;
}

function updatePlayerMovement(dt) {
  const player = state.player;
  if (!player || !player.alive || state.phase === PHASE.MENU || state.paused) return;
  const freezeLocked = state.phase === PHASE.FREEZE;
  const forwardInput = Number(keys.has("KeyW")) - Number(keys.has("KeyS"));
  const sideInput = Number(keys.has("KeyD")) - Number(keys.has("KeyA"));
  const crouch = keys.has("ControlLeft") || keys.has("ControlRight");
  const walk = keys.has("ShiftLeft") || keys.has("ShiftRight");
  const sprint = (keys.has("AltLeft") || keys.has("AltRight")) && !walk && !crouch;
  player.crouched = crouch;
  const targetHeight = crouch ? 1.18 : 1.72;
  player.viewHeight = lerp(player.viewHeight, targetHeight, 1 - Math.exp(-dt * 12));

  const input = new THREE.Vector3(sideInput, 0, -forwardInput);
  if (input.lengthSq() > 1) input.normalize();
  input.applyAxisAngle(new THREE.Vector3(0, 1, 0), state.controls.yaw);
  const weapon = WEAPONS[player.currentWeaponId] ?? WEAPONS.knife;
  let speed = crouch ? 2.05 : walk ? 2.75 : sprint ? 6.8 : 4.85;
  speed *= weapon.moveSpeed;
  if (state.controls.aim) speed *= 0.72;
  if (freezeLocked) speed = 0;

  const acceleration = player.onGround ? 16 : 4.5;
  player.velocity.x = lerp(player.velocity.x, input.x * speed, 1 - Math.exp(-dt * acceleration));
  player.velocity.z = lerp(player.velocity.z, input.z * speed, 1 - Math.exp(-dt * acceleration));

  if (keys.has("Space") && player.onGround && !crouch && !freezeLocked) {
    player.velocity.y = 5.4;
    player.onGround = false;
    keys.delete("Space");
  }
  player.velocity.y -= 14.5 * dt;
  moveWithCollisions(player, tmpVec.set(player.velocity.x * dt, 0, player.velocity.z * dt));
  player.position.y += player.velocity.y * dt;
  const ground = groundHeightAt(player.position.x, player.position.z, player.groundY);
  player.groundY = ground;
  if (player.position.y <= ground) {
    if (!player.onGround && player.velocity.y < -3.6) {
      viewModel.userData.recoil = Math.max(viewModel.userData.recoil ?? 0, 0.25);
      audio.step(state.map.architecture === "industrial" ? "metal" : "stone", false);
    }
    player.position.y = ground;
    player.velocity.y = 0;
    player.onGround = true;
  }

  const horizontalSpeed = Math.hypot(player.velocity.x, player.velocity.z);
  if (player.onGround && horizontalSpeed > 1.1) {
    player.stepTimer -= dt;
    if (player.stepTimer <= 0) {
      const quiet = walk || crouch;
      audio.step(state.map.architecture === "industrial" ? "metal" : "stone", quiet);
      if (!quiet) {
        state.shotSounds.push({
          position: player.position.clone(),
          team: player.team,
          time: state.worldTime,
          range: sprint ? 17 : 12,
          type: "step",
        });
      }
      player.stepTimer = quiet ? 0.55 : sprint ? 0.28 : 0.38;
    }
  }

  camera.position.set(player.position.x, player.position.y + player.viewHeight, player.position.z);
  camera.rotation.y = state.controls.yaw;
  camera.rotation.x = state.controls.pitch;
  player.yaw = state.controls.yaw;
  player.pitch = state.controls.pitch;
  updateViewModel(dt, horizontalSpeed, input.lengthSq() > 0);
}

function updateViewModel(dt, speed, moving) {
  if (!state.player?.alive) {
    viewModel.visible = false;
    return;
  }
  viewModel.visible = !state.controls.aim || WEAPONS[state.player.currentWeaponId]?.class !== "sniper";
  const time = state.worldTime;
  const walkBob = moving && state.player.onGround ? Math.sin(time * (speed > 5 ? 13 : 9)) : 0;
  const sideBob = moving && state.player.onGround ? Math.cos(time * (speed > 5 ? 6.5 : 4.5)) : 0;
  const aimX = state.controls.aim ? -0.32 : 0.32;
  const aimY = state.controls.aim ? -0.22 : -0.29;
  const aimZ = state.controls.aim ? -0.46 : -0.62;
  viewModel.userData.recoil = lerp(viewModel.userData.recoil ?? 0, 0, 1 - Math.exp(-dt * 13));
  const recoil = viewModel.userData.recoil ?? 0;
  viewModel.position.x = lerp(viewModel.position.x, aimX + sideBob * 0.006, 1 - Math.exp(-dt * 12));
  viewModel.position.y = lerp(viewModel.position.y, aimY + walkBob * 0.009 - recoil * 0.05, 1 - Math.exp(-dt * 12));
  viewModel.position.z = lerp(viewModel.position.z, aimZ + Math.abs(walkBob) * 0.008 + recoil * 0.15, 1 - Math.exp(-dt * 12));
  viewModel.rotation.x = -0.04 + recoil * 0.2 + walkBob * 0.004;
  viewModel.rotation.y = 0.08 + sideBob * 0.005;
  viewModel.rotation.z = sideBob * 0.008 + recoil * 0.08;

  const current = weaponState(state.player);
  if (current?.reloading > 0) {
    const duration = WEAPONS[current.id].reload;
    const progress = 1 - current.reloading / duration;
    const arc = Math.sin(progress * Math.PI);
    viewModel.rotation.x += arc * 0.9;
    viewModel.rotation.z += arc * 0.48;
    viewModel.position.y -= arc * 0.18;
  }
}

function addMuzzleFlash(agent) {
  const weapon = WEAPONS[agent.currentWeaponId];
  const warm = weapon.class === "sniper" ? 0xffd8a6 : 0xffb34f;
  let origin;
  if (agent.isPlayer) {
    origin = new THREE.Vector3();
    const muzzle = viewModel.userData.model?.userData.muzzle;
    if (!muzzle) return;
    muzzle.getWorldPosition(origin);
  } else {
    origin = agent.position.clone().add(new THREE.Vector3(0, 1.55, 0));
    const direction = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), agent.yaw);
    origin.addScaledVector(direction, 0.7);
  }
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeRadialTexture("rgba(255,245,196,1)", "rgba(255,126,24,0)"),
      color: warm,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  sprite.position.copy(origin);
  sprite.scale.set(weapon.class === "sniper" ? 0.72 : 0.38, weapon.class === "sniper" ? 0.72 : 0.38, 1);
  effects.add(sprite);
  const light = new THREE.PointLight(warm, weapon.class === "sniper" ? 12 : 7, 7, 2);
  light.position.copy(origin);
  effects.add(light);
  state.particles.push({ mesh: sprite, life: 0.055, maxLife: 0.055, type: "flash" });
  state.particles.push({ mesh: light, life: 0.045, maxLife: 0.045, type: "light" });
}

function ejectCasing(agent) {
  const weapon = WEAPONS[agent.currentWeaponId];
  if (weapon.class === "grenade" || weapon.class === "melee") return;
  const geometry = new THREE.CylinderGeometry(0.014, 0.018, weapon.class === "sniper" ? 0.075 : 0.045, 8);
  const material = new THREE.MeshStandardMaterial({ color: 0xc59b4e, roughness: 0.34, metalness: 0.88 });
  const casing = new THREE.Mesh(geometry, material);
  const position = agent.isPlayer
    ? camera.position.clone().add(new THREE.Vector3(0.25, -0.15, -0.35).applyEuler(camera.rotation))
    : agent.position.clone().add(new THREE.Vector3(0.2, 1.5, 0));
  casing.position.copy(position);
  casing.rotation.z = Math.PI / 2;
  casing.castShadow = true;
  effects.add(casing);
  const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), agent.yaw);
  state.casings.push({
    mesh: casing,
    velocity: right.multiplyScalar(rand(1.8, 3.2)).add(new THREE.Vector3(0, rand(1.8, 3.1), 0)),
    spin: new THREE.Vector3(rand(-8, 8), rand(-8, 8), rand(-8, 8)),
    life: 4,
  });
}

function addTracer(start, end, color = 0xffd38a) {
  const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.75,
    blending: THREE.AdditiveBlending,
  });
  const line = new THREE.Line(geometry, material);
  effects.add(line);
  state.tracers.push({ mesh: line, life: 0.07, maxLife: 0.07 });
}

function addImpact(position, normal = new THREE.Vector3(0, 1, 0), flesh = false) {
  const color = flesh ? 0x9e2d24 : state.map.architecture === "desert" ? 0xd2ad72 : 0xe2bd73;
  for (let index = 0; index < (flesh ? 7 : 5); index += 1) {
    const particle = new THREE.Mesh(
      new THREE.SphereGeometry(flesh ? 0.025 : 0.018, 5, 4),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }),
    );
    particle.position.copy(position);
    effects.add(particle);
    const velocity = normal
      .clone()
      .multiplyScalar(rand(0.5, 2.4))
      .add(new THREE.Vector3(rand(-1, 1), rand(-0.2, 1.4), rand(-1, 1)));
    state.particles.push({
      mesh: particle,
      velocity,
      life: rand(0.18, 0.42),
      maxLife: 0.42,
      type: "debris",
    });
  }
}

function showHitMarker(headshot) {
  ui.hitMarker.classList.remove("is-active");
  void ui.hitMarker.offsetWidth;
  ui.hitMarker.classList.add("is-active");
  ui.hitMarker.style.filter = headshot ? "sepia(1) saturate(5) hue-rotate(330deg)" : "";
  audio.hit(headshot);
}

function fireWeapon(agent, directionOverride = null) {
  if (!agent?.alive || state.paused || ![PHASE.LIVE, PHASE.POST_PLANT].includes(state.phase)) return false;
  const config = WEAPONS[agent.currentWeaponId];
  const current = weaponState(agent);
  if (!config || !current || current.reloading > 0 || current.cooldown > 0) return false;
  if (config.class === "grenade") {
    throwGrenade(agent, config.id);
    return true;
  }
  if (current.ammo <= 0 && config.class !== "melee") {
    audio.tone(210, 0.05, 0.025, "square", 170);
    current.cooldown = 0.18;
    return false;
  }
  if (config.class !== "melee") current.ammo -= 1;
  current.cooldown = 1 / config.fireRate;
  current.shotIndex += 1;
  state.stats.shots += agent.isPlayer ? config.pellets : 0;
  addMuzzleFlash(agent);
  ejectCasing(agent);
  audio.gun(config);

  const origin = agent.isPlayer
    ? camera.position.clone()
    : agent.position.clone().add(new THREE.Vector3(0, 1.62, 0));
  const baseDirection = directionOverride
    ? directionOverride.clone()
    : camera.getWorldDirection(new THREE.Vector3());
  const movement = Math.hypot(agent.velocity.x, agent.velocity.z);
  const airbornePenalty = agent.onGround ? 0 : 0.06;
  const aimBonus = agent.isPlayer && state.controls.aim ? 0.32 : 1;
  const movingPenalty = movement > 1.2 ? movement * 0.0028 : 0;
  const burstPenalty = Math.min(0.055, current.shotIndex * config.recoil * 0.0015);
  const spread = (config.spread + movingPenalty + airbornePenalty + burstPenalty) * aimBonus;
  let playerRegisteredHit = false;

  for (let pellet = 0; pellet < config.pellets; pellet += 1) {
    const direction = baseDirection
      .clone()
      .add(new THREE.Vector3(rand(-spread, spread), rand(-spread, spread), rand(-spread, spread)))
      .normalize();
    tmpRay.set(origin, direction);
    tmpRay.far = config.range;
    const intersections = tmpRay.intersectObjects([...hitMeshes, ...solidMeshes], false);
    let endpoint = origin.clone().addScaledVector(direction, config.range);
    for (const hit of intersections) {
      const victim = hit.object.userData.agent;
      if (victim) {
        if (!victim.alive || victim === agent) continue;
        endpoint.copy(hit.point);
        if (victim.team !== agent.team) {
          const result = calculateDamage(config, {
            distance: hit.distance,
            hitZone: hit.object.userData.hitZone,
            armor: victim.armor,
            helmet: victim.helmet,
          });
          applyDamage(victim, result, agent, config, hit.distance);
          addImpact(hit.point, direction.clone().negate(), true);
          if (agent.isPlayer && !playerRegisteredHit) {
            state.stats.hits += 1;
            if (result.headshot) state.stats.headshots += 1;
            showHitMarker(result.headshot);
            playerRegisteredHit = true;
          }
        }
        break;
      }
      endpoint.copy(hit.point);
      addImpact(hit.point, hit.face?.normal?.clone().transformDirection(hit.object.matrixWorld) ?? direction.clone().negate(), false);
      break;
    }
    if (pellet === 0 || config.class === "sniper") addTracer(origin, endpoint);
  }

  state.shotSounds.push({
    position: agent.position.clone(),
    team: agent.team,
    time: state.worldTime,
    range: config.id === "usp" ? 18 : config.class === "sniper" ? 42 : 30,
    type: "gun",
  });
  if (agent.isPlayer) {
    const recoilScale = config.recoil * (state.controls.aim ? 0.7 : 1);
    state.controls.pitch = clamp(state.controls.pitch - recoilScale * 0.009, -1.48, 1.48);
    state.controls.yaw += rand(-1, 1) * recoilScale * 0.003;
    viewModel.userData.recoil = Math.min(1.4, (viewModel.userData.recoil ?? 0) + recoilScale * 0.3);
  }
  return true;
}

function applyDamage(victim, result, attacker, weapon, distance) {
  if (!victim.alive) return;
  victim.armor = Math.max(0, victim.armor - result.armorDamage);
  victim.health -= result.healthDamage;
  if (victim.isPlayer) {
    state.damageFlash = Math.min(1, state.damageFlash + result.healthDamage / 65);
    ui.damage.style.transform = `rotate(${rand(-4, 4)}deg)`;
  }
  if (victim.health <= 0) {
    killAgent(victim, attacker, weapon, result.headshot, distance);
  }
}

function killAgent(victim, attacker, weapon, headshot = false, distance = 0) {
  victim.alive = false;
  victim.health = 0;
  victim.deaths += 1;
  victim.deathTime = state.worldTime;
  victim.survivedLastRound = false;
  if (victim.mesh) {
    victim.mesh.rotation.z = rand(-1, 1) * 0.24;
    victim.mesh.rotation.x = Math.PI / 2;
    victim.mesh.position.y = victim.position.y + 0.24;
    setTimeout(() => {
      if (victim.mesh && !victim.alive) victim.mesh.visible = false;
    }, 1350);
  }
  if (attacker && attacker !== victim) {
    attacker.kills += 1;
    attacker.money = clampMoney(attacker.money + (weapon.killReward ?? 300));
    if (attacker.isPlayer) state.stats.kills += 1;
  }
  if (victim.isPlayer) {
    state.stats.deaths += 1;
    ui.deathKiller.textContent = attacker?.name ?? "未知目标";
    ui.deathWeapon.textContent = weapon.name;
    ui.deathDistance.textContent = `${Math.max(1, Math.round(distance))}m${headshot ? " · 爆头" : ""}`;
    ui.death.classList.remove("is-hidden");
    document.exitPointerLock?.();
    setTimeout(() => beginSpectating(), 2800);
  }
  if (state.bomb.carrier === victim) dropBomb(victim.position);
  dropBestWeapon(victim);
  addKillFeed(attacker, victim, weapon, headshot);
  checkElimination();
}

function addKillFeed(attacker, victim, weapon, headshot) {
  const item = document.createElement("div");
  item.className = "kill-item";
  item.innerHTML = `
    <span class="${attacker?.team === TEAM.T ? "t-name" : "ct-name"}">${attacker?.name ?? "WORLD"}</span>
    <span class="weapon-icon">${headshot ? "⌖" : "•"} ${weapon.name}</span>
    <span class="${victim.team === TEAM.T ? "t-name" : "ct-name"}">${victim.name}</span>
  `;
  ui.killFeed.prepend(item);
  setTimeout(() => item.remove(), 5200);
}

function dropBestWeapon(agent) {
  const primary = [...agent.weapons.keys()].find((id) => WEAPONS[id].slot === 1);
  const weaponId = primary ?? [...agent.weapons.keys()].find((id) => WEAPONS[id].slot === 2);
  if (!weaponId) return;
  const current = agent.weapons.get(weaponId);
  const model = createWeaponModel(WEAPONS[weaponId], agent.team);
  model.position.copy(agent.position).add(new THREE.Vector3(0, 0.28, 0));
  model.rotation.set(Math.PI / 2, rand(0, Math.PI * 2), 0);
  model.scale.setScalar(0.62);
  world.add(model);
  state.droppedWeapons.push({
    id: weaponId,
    state: { ...current },
    mesh: model,
    position: model.position,
    life: 36,
  });
  agent.weapons.delete(weaponId);
  const remaining = availableWeaponIds(agent);
  agent.currentWeaponId = remaining[0] ?? "knife";
}

function dropBomb(position) {
  state.bomb.state = "dropped";
  state.bomb.carrier = null;
  state.bomb.position.copy(position);
  if (!state.bomb.mesh) state.bomb.mesh = createBombMesh();
  state.bomb.mesh.position.copy(position).add(new THREE.Vector3(0, 0.25, 0));
  state.bomb.mesh.visible = true;
  world.add(state.bomb.mesh);
  showCenterMessage("炸弹已掉落", 1.8);
}

function dropPlayerWeapon() {
  const player = state.player;
  if (!player?.alive) return;
  const config = WEAPONS[player.currentWeaponId];
  if (!config || ![1, 2].includes(config.slot)) return;
  dropBestWeapon(player);
  switchWeapon(player, availableWeaponIds(player)[0]);
}

function pickupNearby() {
  const player = state.player;
  if (!player?.alive) return;
  if (state.bomb.state === "dropped" && player.team === TEAM.T && distance2D(player.position, state.bomb.position) < 1.8) {
    state.bomb.state = "carried";
    state.bomb.carrier = player;
    if (state.bomb.mesh) state.bomb.mesh.visible = false;
    showCenterMessage("已拾取炸弹", 1.5);
  }
  const closest = state.droppedWeapons
    .filter((item) => distance2D(player.position, item.position) < 1.7)
    .sort((a, b) => distance2D(player.position, a.position) - distance2D(player.position, b.position))[0];
  if (!closest) return;
  const existing = [...player.weapons.keys()].find((id) => WEAPONS[id].slot === WEAPONS[closest.id].slot);
  if (existing && WEAPONS[existing].class !== "melee") dropBestWeapon(player);
  player.weapons.set(closest.id, { ...closest.state });
  switchWeapon(player, closest.id);
  closest.mesh.removeFromParent();
  state.droppedWeapons.splice(state.droppedWeapons.indexOf(closest), 1);
  showCenterMessage(`拾取 ${WEAPONS[closest.id].name}`, 1.3);
}

function startReload(agent) {
  const current = weaponState(agent);
  const config = current ? WEAPONS[current.id] : null;
  if (!current || !config || current.reloading > 0 || config.class === "grenade" || config.class === "melee") return;
  if (current.ammo >= config.magazine || current.reserve <= 0) return;
  current.reloading = config.reload;
  current.reloadStart = config.reload;
  current.shotIndex = 0;
  if (agent.isPlayer) audio.reload();
}

function updateWeapons(dt) {
  for (const agent of state.agents) {
    agent.grenadeCooldown = Math.max(0, (agent.grenadeCooldown ?? 0) - dt);
    for (const current of agent.weapons.values()) {
      current.cooldown = Math.max(0, current.cooldown - dt);
      if (current.cooldown <= 0) current.shotIndex = Math.max(0, current.shotIndex - dt * 9);
      if (current.reloading > 0) {
        current.reloading -= dt;
        if (current.reloading <= 0) {
          const config = WEAPONS[current.id];
          const required = config.magazine - current.ammo;
          const moved = Math.min(required, current.reserve);
          current.ammo += moved;
          current.reserve -= moved;
          current.reloading = 0;
        }
      }
    }
  }
}

function throwGrenade(agent, grenadeId) {
  if ((agent.grenades.get(grenadeId) ?? 0) <= 0 || agent.grenadeCooldown > 0) return;
  const config = WEAPONS[grenadeId];
  const mesh = createWeaponModel(config, agent.team);
  mesh.scale.setScalar(0.9);
  const start = agent.isPlayer
    ? camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(0.45))
    : agent.position.clone().add(new THREE.Vector3(0, 1.55, 0));
  let direction;
  if (agent.isPlayer) {
    direction = camera.getWorldDirection(new THREE.Vector3());
  } else {
    const target = agent.grenadeTarget ?? agent.position.clone().add(new THREE.Vector3(0, 0, -8));
    direction = target.clone().sub(start).normalize();
    direction.y += 0.22;
    direction.normalize();
  }
  mesh.position.copy(start);
  world.add(mesh);
  state.grenades.push({
    id: grenadeId,
    effect: config.effect,
    owner: agent,
    mesh,
    velocity: direction.multiplyScalar(13.5).add(new THREE.Vector3(0, 4.4, 0)),
    fuse: config.effect === "fire" ? 1.9 : 2.45,
    bounced: 0,
  });
  agent.grenades.set(grenadeId, (agent.grenades.get(grenadeId) ?? 1) - 1);
  if (agent.grenades.get(grenadeId) <= 0) agent.grenades.delete(grenadeId);
  agent.grenadeCooldown = 1;
  audio.throw();
  const next = availableWeaponIds(agent).find((id) => WEAPONS[id].class !== "grenade") ?? "knife";
  switchWeapon(agent, next);
}

function grenadeCollides(position) {
  return colliders.find((collider) => pointInsideCollider(position.x, position.y, position.z, collider, 0.16));
}

function updateGrenades(dt) {
  for (let index = state.grenades.length - 1; index >= 0; index -= 1) {
    const item = state.grenades[index];
    item.fuse -= dt;
    item.velocity.y -= 12.5 * dt;
    const previous = item.mesh.position.clone();
    item.mesh.position.addScaledVector(item.velocity, dt);
    item.mesh.rotation.x += dt * 8;
    item.mesh.rotation.z += dt * 5;
    const ground = groundHeightAt(item.mesh.position.x, item.mesh.position.z, -0.2) + 0.13;
    if (item.mesh.position.y <= ground) {
      item.mesh.position.y = ground;
      item.velocity.y = Math.abs(item.velocity.y) * (item.bounced < 2 ? 0.47 : 0.22);
      item.velocity.x *= 0.72;
      item.velocity.z *= 0.72;
      item.bounced += 1;
      if (Math.abs(item.velocity.y) > 0.8) audio.tone(240, 0.025, 0.012, "square", 170);
    }
    if (grenadeCollides(item.mesh.position)) {
      item.mesh.position.copy(previous);
      item.velocity.x *= -0.52;
      item.velocity.z *= -0.52;
      item.bounced += 1;
    }
    if (item.fuse <= 0) {
      detonateGrenade(item);
      state.grenades.splice(index, 1);
    }
  }
}

function lineOfSight(from, to) {
  const direction = to.clone().sub(from);
  const distance = direction.length();
  direction.normalize();
  tmpRay.set(from, direction);
  tmpRay.far = distance;
  return tmpRay.intersectObjects(solidMeshes, false).length === 0;
}

function detonateGrenade(item) {
  const position = item.mesh.position.clone();
  item.mesh.removeFromParent();
  if (item.effect === "frag") {
    audio.explosion("frag");
    createExplosion(position, 0xffa148, 2.5);
    for (const agent of state.agents) {
      if (!agent.alive) continue;
      const distance = agent.position.distanceTo(position);
      if (distance > 8 || !lineOfSight(position.clone().add(new THREE.Vector3(0, 0.4, 0)), agent.position.clone().add(new THREE.Vector3(0, 1, 0)))) continue;
      const raw = Math.max(3, 105 * (1 - distance / 9));
      const result = {
        healthDamage: agent.armor > 0 ? Math.round(raw * 0.62) : Math.round(raw),
        armorDamage: agent.armor > 0 ? Math.round(raw * 0.25) : 0,
        headshot: false,
      };
      applyDamage(agent, result, item.owner, WEAPONS.frag, distance);
    }
  } else if (item.effect === "flash") {
    audio.explosion("flash");
    createExplosion(position, 0xf8efcf, 1.2);
    const player = state.player;
    if (player?.alive) {
      const toFlash = position.clone().sub(camera.position);
      const distance = toFlash.length();
      const facing = camera.getWorldDirection(new THREE.Vector3()).dot(toFlash.normalize());
      if (distance < 22 && lineOfSight(camera.position, position)) {
        const exposure = clamp((1 - distance / 24) * (facing > 0.2 ? 1 : 0.36), 0, 1);
        state.flashAmount = Math.max(state.flashAmount, exposure);
        state.flashDecay = 0.45 + exposure * 3.4;
      }
    }
    for (const agent of state.agents) {
      if (agent.isPlayer || !agent.alive) continue;
      const distance = agent.position.distanceTo(position);
      if (distance < 17 && lineOfSight(agent.position.clone().add(new THREE.Vector3(0, 1.5, 0)), position)) {
        agent.blinded = clamp(1 - distance / 20, 0.2, 1);
        agent.blindTime = 1.2 + agent.blinded * 2.4;
      }
    }
  } else if (item.effect === "smoke") {
    audio.explosion("smoke");
    createSmoke(position);
  } else if (item.effect === "fire") {
    audio.explosion("fire");
    createFire(position, item.owner);
  }
}

function createExplosion(position, color, scale) {
  const light = new THREE.PointLight(color, 28, 19, 2);
  light.position.copy(position).add(new THREE.Vector3(0, 1, 0));
  effects.add(light);
  state.particles.push({ mesh: light, life: 0.22, maxLife: 0.22, type: "light" });
  for (let index = 0; index < 28; index += 1) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeRadialTexture("rgba(255,238,180,1)", "rgba(255,78,12,0)"),
        color,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    sprite.position.copy(position);
    sprite.scale.setScalar(rand(0.2, 0.7) * scale);
    effects.add(sprite);
    state.particles.push({
      mesh: sprite,
      velocity: new THREE.Vector3(rand(-5, 5), rand(1, 7), rand(-5, 5)),
      life: rand(0.3, 0.8),
      maxLife: 0.8,
      type: "explosion",
    });
  }
}

function createSmoke(position) {
  const group = new THREE.Group();
  group.position.copy(position);
  effects.add(group);
  for (let index = 0; index < 64; index += 1) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeRadialTexture("rgba(118,128,120,.88)", "rgba(70,78,73,0)"),
        color: index % 3 === 0 ? 0x7f8982 : 0x626c66,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    const angle = rand(0, Math.PI * 2);
    const radius = Math.sqrt(Math.random()) * 3.6;
    sprite.position.set(Math.cos(angle) * radius, rand(0.3, 3.5), Math.sin(angle) * radius);
    const size = rand(2.2, 4.6);
    sprite.scale.set(size, size, 1);
    sprite.userData.targetOpacity = rand(0.38, 0.72);
    group.add(sprite);
  }
  state.smokeZones.push({ position: position.clone(), group, radius: 4.2, life: 18, age: 0 });
}

function createFire(position, owner) {
  const group = new THREE.Group();
  group.position.copy(position);
  effects.add(group);
  for (let index = 0; index < 24; index += 1) {
    const flame = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeRadialTexture("rgba(255,244,126,1)", "rgba(220,42,0,0)"),
        color: index % 2 ? 0xff7a21 : 0xffc43f,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    const angle = rand(0, Math.PI * 2);
    const radius = Math.sqrt(Math.random()) * 3.5;
    flame.position.set(Math.cos(angle) * radius, rand(0.12, 0.42), Math.sin(angle) * radius);
    flame.scale.set(rand(0.55, 1.25), rand(0.8, 1.8), 1);
    flame.userData.phase = rand(0, Math.PI * 2);
    group.add(flame);
  }
  state.fireZones.push({ position: position.clone(), group, radius: 3.9, life: 8, owner, tick: 0 });
}

function updateAreaEffects(dt) {
  for (let index = state.smokeZones.length - 1; index >= 0; index -= 1) {
    const smoke = state.smokeZones[index];
    smoke.life -= dt;
    smoke.age += dt;
    const fadeIn = clamp(smoke.age / 1.2, 0, 1);
    const fadeOut = clamp(smoke.life / 2.5, 0, 1);
    for (const sprite of smoke.group.children) {
      sprite.material.opacity = sprite.userData.targetOpacity * fadeIn * fadeOut;
      sprite.position.y += dt * 0.035;
      sprite.rotation += dt * 0.06;
    }
    if (smoke.life <= 0) {
      smoke.group.removeFromParent();
      state.smokeZones.splice(index, 1);
    }
  }
  for (let index = state.fireZones.length - 1; index >= 0; index -= 1) {
    const fire = state.fireZones[index];
    fire.life -= dt;
    fire.tick -= dt;
    for (const flame of fire.group.children) {
      const pulse = 0.78 + Math.sin(state.worldTime * 12 + flame.userData.phase) * 0.22;
      flame.scale.y = pulse * 1.35;
      flame.material.opacity = clamp(fire.life / 1.2, 0, 1);
    }
    if (fire.tick <= 0) {
      fire.tick = 0.32;
      for (const agent of state.agents) {
        if (!agent.alive || distance2D(agent.position, fire.position) > fire.radius) continue;
        applyDamage(
          agent,
          { healthDamage: 8, armorDamage: 1, headshot: false },
          fire.owner,
          WEAPONS.incendiary,
          distance2D(agent.position, fire.position),
        );
      }
    }
    if (fire.life <= 0) {
      fire.group.removeFromParent();
      state.fireZones.splice(index, 1);
    }
  }
}

function updatePhysicalEffects(dt) {
  for (let index = state.particles.length - 1; index >= 0; index -= 1) {
    const item = state.particles[index];
    item.life -= dt;
    if (item.velocity) {
      item.velocity.y -= item.type === "debris" ? 5 * dt : 1.5 * dt;
      item.mesh.position.addScaledVector(item.velocity, dt);
    }
    if (item.mesh.material?.opacity !== undefined) item.mesh.material.opacity = clamp(item.life / item.maxLife, 0, 1);
    if (item.life <= 0) {
      item.mesh.removeFromParent();
      state.particles.splice(index, 1);
    }
  }
  for (let index = state.casings.length - 1; index >= 0; index -= 1) {
    const item = state.casings[index];
    item.life -= dt;
    item.velocity.y -= 9.5 * dt;
    item.mesh.position.addScaledVector(item.velocity, dt);
    item.mesh.rotation.x += item.spin.x * dt;
    item.mesh.rotation.y += item.spin.y * dt;
    item.mesh.rotation.z += item.spin.z * dt;
    const ground = groundHeightAt(item.mesh.position.x, item.mesh.position.z, -0.3) + 0.03;
    if (item.mesh.position.y < ground) {
      item.mesh.position.y = ground;
      item.velocity.multiplyScalar(0.28);
      item.velocity.y = Math.abs(item.velocity.y) * 0.18;
    }
    if (item.life <= 0) {
      item.mesh.removeFromParent();
      state.casings.splice(index, 1);
    }
  }
  for (let index = state.tracers.length - 1; index >= 0; index -= 1) {
    const item = state.tracers[index];
    item.life -= dt;
    item.mesh.material.opacity = clamp(item.life / item.maxLife, 0, 1);
    if (item.life <= 0) {
      item.mesh.removeFromParent();
      state.tracers.splice(index, 1);
    }
  }
  for (let index = state.droppedWeapons.length - 1; index >= 0; index -= 1) {
    const item = state.droppedWeapons[index];
    item.life -= dt;
    item.mesh.rotation.y += dt * 0.08;
    if (item.life <= 0) {
      item.mesh.removeFromParent();
      state.droppedWeapons.splice(index, 1);
    }
  }
}

function smokeBlocks(from, to) {
  const segment = to.clone().sub(from);
  const lengthSq = segment.lengthSq();
  if (lengthSq === 0) return false;
  for (const smoke of state.smokeZones) {
    const point = smoke.position.clone().add(new THREE.Vector3(0, 1.4, 0));
    const t = clamp(point.clone().sub(from).dot(segment) / lengthSq, 0, 1);
    const closest = from.clone().addScaledVector(segment, t);
    if (closest.distanceTo(point) < smoke.radius * 0.82) return true;
  }
  return false;
}

function visibleEnemy(agent) {
  const eye = agent.position.clone().add(new THREE.Vector3(0, 1.55, 0));
  const config = BOT_DIFFICULTIES[state.difficulty];
  let best = null;
  let bestDistance = Infinity;
  for (const target of state.agents) {
    if (!target.alive || target.team === agent.team || target === agent) continue;
    const targetEye = target.position.clone().add(new THREE.Vector3(0, target.crouched ? 1.1 : 1.48, 0));
    const distance = eye.distanceTo(targetEye);
    if (distance > 48 || distance >= bestDistance) continue;
    if (smokeBlocks(eye, targetEye)) continue;
    if (!lineOfSight(eye, targetEye)) continue;
    best = target;
    bestDistance = distance;
  }
  if (best && bestDistance < config.hearingRange * 0.55) return { target: best, distance: bestDistance };
  if (!best) return null;
  const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), agent.yaw);
  const toTarget = best.position.clone().sub(agent.position).setY(0).normalize();
  const fieldOfView = forward.dot(toTarget);
  return fieldOfView > -0.18 ? { target: best, distance: bestDistance } : null;
}

function nearestSound(agent) {
  const difficulty = BOT_DIFFICULTIES[state.difficulty];
  for (let index = state.shotSounds.length - 1; index >= 0; index -= 1) {
    const sound = state.shotSounds[index];
    if (sound.team === agent.team || state.worldTime - sound.time > 2.6) continue;
    const range = Math.min(sound.range, difficulty.hearingRange);
    if (distance2D(agent.position, sound.position) <= range) return sound;
  }
  return null;
}

function chooseBotTarget(agent) {
  const nearest = currentNode(agent.position);
  if (!nearest) return;
  let targetId;
  if (agent.team === TEAM.T) {
    if (state.bomb.state === "planted") {
      const siteNode = state.map.sites.find((site) => site.id === state.bomb.site)?.node;
      const site = nodeById(state.map, siteNode);
      const nearby = state.map.nodes
        .filter((item) => Math.hypot(item.position[0] - site.position[0], item.position[2] - site.position[2]) < 13)
        .filter((item) => item.id !== site.id);
      targetId = choose(nearby)?.id ?? siteNode;
    } else if (state.bomb.carrier === agent) {
      const chosenSite = agent.role === "lurk" ? state.map.sites[0] : state.map.sites[agent.id.charCodeAt(agent.id.length - 1) % 2];
      targetId = chosenSite.node;
    } else if (state.bomb.state === "dropped") {
      const bombNode = currentNode(state.bomb.position);
      targetId = bombNode?.id ?? state.map.sites[0].node;
    } else {
      const routes = state.map.routes.filter((routeItem) => routeItem.team === TEAM.T);
      const routeItem = routes[Math.abs(agent.id.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0)) % routes.length];
      targetId = routeItem.nodes[Math.min(routeItem.nodes.length - 1, 2 + Math.floor(Math.random() * Math.max(1, routeItem.nodes.length - 2)))];
    }
  } else if (state.bomb.state === "planted") {
    targetId = state.map.sites.find((site) => site.id === state.bomb.site)?.node;
  } else {
    const defensiveTargets = [
      state.map.sites[0].node,
      state.map.sites[1].node,
      state.map.nodes.find((item) => item.id === "mid")?.id ?? state.map.nodes[Math.floor(state.map.nodes.length / 2)].id,
    ];
    const roleIndex = ["anchor", "support", "rotator", "entry", "lurk"].indexOf(agent.role);
    targetId = defensiveTargets[Math.abs(roleIndex) % defensiveTargets.length];
  }
  const sound = nearestSound(agent);
  if (sound && Math.random() < BOT_DIFFICULTIES[state.difficulty].teamwork) {
    targetId = currentNode(sound.position)?.id ?? targetId;
    agent.heardPosition = sound.position.clone();
  }
  agent.targetNode = targetId;
  agent.path = findRoute(state.map, nearest.id, targetId);
  agent.pathIndex = agent.path.length > 1 ? 1 : 0;
}

function botTryUtility(agent, target) {
  const difficulty = BOT_DIFFICULTIES[state.difficulty];
  if (agent.grenadeCooldown > 0 || Math.random() > difficulty.utilityChance * 0.16) return false;
  const grenadeOptions = [...agent.grenades.keys()];
  if (!grenadeOptions.length) return false;
  const grenadeId =
    grenadeOptions.find((id) => id === "flashbang") ??
    grenadeOptions.find((id) => id === "smoke") ??
    grenadeOptions[0];
  agent.grenadeTarget = target.position.clone().add(new THREE.Vector3(rand(-1.8, 1.8), 0.6, rand(-1.8, 1.8)));
  switchWeapon(agent, grenadeId);
  throwGrenade(agent, grenadeId);
  return true;
}

function botShoot(agent, target, distance) {
  const difficulty = BOT_DIFFICULTIES[state.difficulty];
  const weapon = WEAPONS[agent.currentWeaponId];
  if (!weapon || ["grenade", "melee"].includes(weapon.class)) {
    const firearmId = availableWeaponIds(agent).find((id) => ["pistol", "smg", "rifle", "sniper", "shotgun"].includes(WEAPONS[id].class));
    if (firearmId) switchWeapon(agent, firearmId);
    return;
  }
  const targetPoint = target.position.clone().add(new THREE.Vector3(0, distance < 13 ? 1.55 : 1.28, 0));
  const origin = agent.position.clone().add(new THREE.Vector3(0, 1.58, 0));
  const direction = targetPoint.sub(origin).normalize();
  const error =
    difficulty.aimError *
    (1 + distance / 32) *
    (agent.blinded ? 3.2 : 1) *
    (agent.velocity.lengthSq() > 1 ? 1.3 : 1);
  direction.add(new THREE.Vector3(rand(-error, error), rand(-error, error), rand(-error, error))).normalize();
  fireWeapon(agent, direction);
  agent.burstRemaining -= 1;
  if (agent.burstRemaining <= 0) {
    agent.aimTimer = rand(0.18, 0.5);
    agent.burstRemaining = difficulty.burst;
  }
}

function updateBots(dt) {
  const difficulty = BOT_DIFFICULTIES[state.difficulty];
  for (const agent of state.agents) {
    if (agent.isPlayer || !agent.alive) continue;
    if (agent.blindTime > 0) {
      agent.blindTime -= dt;
      agent.blinded = clamp(agent.blindTime / 2.5, 0, 1);
    } else {
      agent.blinded = 0;
    }
    if (![PHASE.LIVE, PHASE.POST_PLANT].includes(state.phase)) {
      agent.velocity.multiplyScalar(0.8);
      continue;
    }

    if (state.bomb.state === "dropped" && agent.team === TEAM.T && distance2D(agent.position, state.bomb.position) < 1.45) {
      state.bomb.carrier = agent;
      state.bomb.state = "carried";
      if (state.bomb.mesh) state.bomb.mesh.visible = false;
    }

    agent.perceptionTimer -= dt;
    if (agent.perceptionTimer <= 0) {
      const perception = visibleEnemy(agent);
      agent.visibleTarget = perception?.target ?? null;
      agent.visibleDistance = perception?.distance ?? Infinity;
      agent.perceptionTimer = lerp(0.22, 0.08, difficulty.teamwork);
    } else if (agent.visibleTarget?.alive) {
      agent.visibleDistance = agent.position.distanceTo(agent.visibleTarget.position);
    } else {
      agent.visibleTarget = null;
      agent.visibleDistance = Infinity;
    }
    const sight = agent.visibleTarget
      ? { target: agent.visibleTarget, distance: agent.visibleDistance }
      : null;
    if (sight) {
      const desiredYaw = Math.atan2(
        sight.target.position.x - agent.position.x,
        sight.target.position.z - agent.position.z,
      );
      agent.yaw = lerpAngle(agent.yaw, desiredYaw, 1 - Math.exp(-dt * (5.5 + difficulty.teamwork * 3)));
      agent.mesh.rotation.y = agent.yaw;
      agent.velocity.multiplyScalar(Math.exp(-dt * 8));
      if (agent.lastSeen?.id !== sight.target.id) {
        agent.aimTimer = difficulty.reactionMs / 1000;
        agent.lastSeen = sight.target;
        agent.burstRemaining = difficulty.burst;
      }
      agent.aimTimer -= dt;
      if (agent.aimTimer <= 0) {
        if (!botTryUtility(agent, sight.target)) botShoot(agent, sight.target, sight.distance);
      }
      continue;
    }
    agent.lastSeen = null;
    agent.aimTimer = 0;

    if (state.bomb.carrier === agent) {
      const site = siteAtPosition(agent.position);
      if (site && state.phase === PHASE.LIVE) {
        agent.plantProgress += dt;
        agent.velocity.set(0, 0, 0);
        if (agent.plantProgress >= rules.plantTime) plantBomb(agent, site.id);
        continue;
      }
    }

    if (agent.team === TEAM.CT && state.bomb.state === "planted" && distance2D(agent.position, state.bomb.position) < 1.9) {
      agent.defuseProgress += dt;
      agent.velocity.set(0, 0, 0);
      const required = agent.kit ? rules.kitDefuseTime : rules.defuseTime;
      if (agent.defuseProgress >= required) defuseBomb(agent);
      continue;
    }

    agent.decisionTimer -= dt;
    if (agent.decisionTimer <= 0 || !agent.path.length || agent.pathIndex >= agent.path.length) {
      chooseBotTarget(agent);
      agent.decisionTimer = rand(1.1, 2.3) * (1.2 - difficulty.teamwork * 0.28);
    }

    const targetNodeId = agent.path[agent.pathIndex];
    const targetNode = nodeById(state.map, targetNodeId);
    if (!targetNode) continue;
    const destination = new THREE.Vector3(targetNode.position[0], targetNode.position[1], targetNode.position[2]);
    const toTarget = destination.clone().sub(agent.position);
    const horizontalDistance = Math.hypot(toTarget.x, toTarget.z);
    if (horizontalDistance < Math.max(1, targetNode.radius * 0.45)) {
      agent.pathIndex += 1;
      if (agent.pathIndex >= agent.path.length) agent.decisionTimer = 0;
      continue;
    }
    const desiredYaw = Math.atan2(toTarget.x, toTarget.z);
    agent.yaw = lerpAngle(agent.yaw, desiredYaw, 1 - Math.exp(-dt * 7));
    const speed = agent.role === "entry" ? 4.25 : agent.role === "lurk" ? 3.15 : 3.7;
    const direction = toTarget.setY(0).normalize();
    agent.velocity.x = lerp(agent.velocity.x, direction.x * speed, 1 - Math.exp(-dt * 9));
    agent.velocity.z = lerp(agent.velocity.z, direction.z * speed, 1 - Math.exp(-dt * 9));
    moveWithCollisions(agent, tmpVec.set(agent.velocity.x * dt, 0, agent.velocity.z * dt));
    agent.position.y = groundHeightAt(agent.position.x, agent.position.z, agent.position.y);
    agent.mesh.position.copy(agent.position);
    agent.mesh.rotation.y = agent.yaw;
    if (agent.mesh.userData.legs) {
      agent.mesh.userData.legs.rotation.x = Math.sin(state.worldTime * 9 + agent.position.x) * 0.08;
    }
  }
}

function lerpAngle(a, b, t) {
  const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + delta * t;
}

function botBuy(agent) {
  if (agent.isPlayer || agent.boughtThisRound) return;
  const difficulty = BOT_DIFFICULTIES[state.difficulty];
  const priorities =
    agent.team === TEAM.T
      ? agent.money >= 4750 && difficulty.aimError < 0.06 && agent.role === "lurk"
        ? ["awp", "kevlarHelmet", "flashbang"]
        : agent.money >= 3700
          ? ["ak47", "kevlarHelmet", "flashbang", "smoke"]
          : agent.money >= 2500
            ? ["galil", "kevlar", "flashbang"]
            : agent.money >= 1800
              ? ["mp7", "flashbang"]
              : ["deagle"]
      : agent.money >= 5150 && difficulty.aimError < 0.06 && agent.role === "anchor"
        ? ["awp", "defuseKit"]
        : agent.money >= 4300
          ? ["m4a1", "kevlarHelmet", "defuseKit", "smoke"]
          : agent.money >= 3000
            ? ["famas", "kevlar", "flashbang"]
            : agent.money >= 1900
              ? ["mp7", "defuseKit"]
              : ["deagle"];
  for (const id of priorities) purchaseForAgent(agent, id, false);
  agent.boughtThisRound = true;
}

function purchaseForAgent(agent, id, announce = true) {
  const item = WEAPONS[id] ?? EQUIPMENT[id];
  if (!item || item.price > agent.money) return false;
  if (item.team && item.team !== "both" && item.team !== agent.team) return false;
  if (id === "kevlar") {
    if (agent.armor >= 100) return false;
    agent.armor = 100;
  } else if (id === "kevlarHelmet") {
    if (agent.armor >= 100 && agent.helmet) return false;
    agent.armor = 100;
    agent.helmet = true;
  } else if (id === "defuseKit") {
    if (agent.team !== TEAM.CT || agent.kit) return false;
    agent.kit = true;
  } else if (WEAPONS[id]?.class === "grenade") {
    const max = id === "flashbang" ? 2 : 1;
    if ((agent.grenades.get(id) ?? 0) >= max) return false;
    giveWeapon(agent, id, false);
  } else {
    giveWeapon(agent, id, true);
  }
  agent.money -= item.price;
  if (agent.isPlayer) {
    state.stats.spent += item.price;
    if (announce) showCenterMessage(`已购买 ${item.name}`, 1.1);
  }
  return true;
}

function siteAtPosition(position) {
  for (const site of state.map.sites) {
    const nodeItem = nodeById(state.map, site.node);
    if (!nodeItem) continue;
    if (Math.hypot(position.x - nodeItem.position[0], position.z - nodeItem.position[2]) <= site.radius) {
      return site;
    }
  }
  return null;
}

function updatePlayerInteraction(dt) {
  const player = state.player;
  if (!player?.alive) return;
  let title = "";
  let detail = "";
  let progress = 0;
  let visible = false;

  if (player.team === TEAM.T && state.bomb.carrier === player && state.phase === PHASE.LIVE) {
    const site = siteAtPosition(player.position);
    if (site) {
      visible = true;
      title = `在 ${site.id} 点安放炸弹`;
      detail = "按住 E 完成安放";
      if (state.controls.use) {
        player.plantProgress += dt;
        progress = player.plantProgress / rules.plantTime;
        if (player.plantProgress >= rules.plantTime) plantBomb(player, site.id);
      } else {
        player.plantProgress = Math.max(0, player.plantProgress - dt * 1.8);
        progress = player.plantProgress / rules.plantTime;
      }
    } else {
      player.plantProgress = 0;
    }
  }

  if (player.team === TEAM.CT && state.bomb.state === "planted" && distance2D(player.position, state.bomb.position) < 2.2) {
    visible = true;
    title = "拆除炸弹";
    detail = player.kit ? "拆弹器已装备 · 5 秒" : "无拆弹器 · 10 秒";
    const required = player.kit ? rules.kitDefuseTime : rules.defuseTime;
    if (state.controls.use) {
      player.defuseProgress += dt;
      progress = player.defuseProgress / required;
      if (player.defuseProgress >= required) defuseBomb(player);
    } else {
      player.defuseProgress = Math.max(0, player.defuseProgress - dt * 1.6);
      progress = player.defuseProgress / required;
    }
  }

  const nearDropped =
    state.droppedWeapons.some((item) => distance2D(player.position, item.position) < 1.7) ||
    (state.bomb.state === "dropped" && player.team === TEAM.T && distance2D(player.position, state.bomb.position) < 1.8);
  if (!visible && nearDropped) {
    visible = true;
    title = "拾取地面装备";
    detail = "按 E 拾取";
    if (state.controls.use) {
      pickupNearby();
      state.controls.use = false;
    }
  }

  ui.interaction.classList.toggle("is-hidden", !visible);
  if (visible) {
    ui.interactionTitle.textContent = title;
    ui.interactionDetail.textContent = detail;
  }
  ui.objectiveProgress.style.width = `${clamp(progress, 0, 1) * 100}%`;
}

function plantBomb(agent, siteId) {
  state.bomb.state = "planted";
  state.bomb.carrier = null;
  state.bomb.site = siteId;
  state.bomb.timer = rules.bombTime;
  state.bomb.progress = 0;
  state.bomb.beep = 0;
  state.roundPlanted = true;
  state.phase = PHASE.POST_PLANT;
  const site = state.map.sites.find((item) => item.id === siteId);
  const nodeItem = nodeById(state.map, site.node);
  state.bomb.position.set(nodeItem.position[0], nodeItem.position[1], nodeItem.position[2]);
  if (!state.bomb.mesh) state.bomb.mesh = createBombMesh();
  state.bomb.mesh.position.copy(state.bomb.position).add(new THREE.Vector3(0, 0.24, 0));
  state.bomb.mesh.rotation.set(0, rand(0, Math.PI * 2), 0);
  state.bomb.mesh.visible = true;
  world.add(state.bomb.mesh);
  agent.plantProgress = 0;
  agent.money = clampMoney(agent.money + ECONOMY.planterBonus);
  audio.objective(true);
  showCenterMessage(`${siteId} 点炸弹已安放`, 2.2);
}

function defuseBomb(agent) {
  if (state.bomb.state !== "planted") return;
  state.bomb.state = "defused";
  agent.defuseProgress = 0;
  agent.money = clampMoney(agent.money + ECONOMY.defuserBonus);
  audio.objective(true);
  resolveRound(TEAM.CT, "炸弹已拆除");
}

function detonateBomb() {
  if (state.bomb.state !== "planted") return;
  state.bomb.state = "detonated";
  createExplosion(state.bomb.position.clone(), 0xff8b32, 5.5);
  audio.explosion("frag");
  for (const agent of state.agents) {
    if (!agent.alive) continue;
    const distance = agent.position.distanceTo(state.bomb.position);
    if (distance < 18) {
      applyDamage(
        agent,
        { healthDamage: Math.round(200 * (1 - distance / 22)), armorDamage: 40, headshot: false },
        state.bomb.carrier,
        WEAPONS.frag,
        distance,
      );
    }
  }
  resolveRound(TEAM.T, "目标已引爆");
}

function checkElimination() {
  if (![PHASE.LIVE, PHASE.POST_PLANT].includes(state.phase)) return;
  const tAlive = state.agents.some((agent) => agent.team === TEAM.T && agent.alive);
  const ctAlive = state.agents.some((agent) => agent.team === TEAM.CT && agent.alive);
  if (!ctAlive) resolveRound(TEAM.T, "反恐精英已被肃清");
  else if (!tAlive && state.bomb.state !== "planted") resolveRound(TEAM.CT, "恐怖分子已被肃清");
}

function resolveRound(winner, reason) {
  if (state.phase === PHASE.ROUND_END || state.phase === PHASE.MATCH_END) return;
  state.phase = PHASE.ROUND_END;
  state.phaseTime = rules.roundEndTime;
  state.roundWinner = winner;
  state.roundReason = reason;
  state.score[winner] += 1;
  const winReward = roundWinReward(winner, state.bomb.state);
  for (const agent of state.agents) {
    const outcome = applyRoundEconomy(agent.money, {
      won: agent.team === winner,
      winReward,
      lossStreak: agent.lossStreak,
      planted: state.roundPlanted && agent.team === TEAM.T,
      kills: [],
    });
    agent.money = outcome.money;
    agent.lossStreak = outcome.lossStreak;
    agent.survivedLastRound = agent.alive;
  }
  ui.bannerKicker.textContent = `ROUND ${String(state.round).padStart(2, "0")}`;
  ui.bannerTitle.textContent = winner === TEAM.T ? "恐怖分子胜利" : "反恐精英胜利";
  ui.bannerTitle.style.color = winner === TEAM.T ? "var(--t)" : "var(--ct)";
  ui.bannerDetail.textContent = reason;
  ui.banner.classList.remove("is-hidden");
  ui.letterbox.classList.add("is-active");
  audio.objective(winner === state.player.team);
  document.exitPointerLock?.();
}

function swapSides() {
  for (const agent of state.agents) {
    agent.team = otherTeam(agent.team);
    agent.money = ECONOMY.startMoney;
    agent.lossStreak = 0;
    agent.survivedLastRound = false;
    defaultLoadout(agent);
    updateCharacterTeam(agent);
  }
  state.selectedTeam = state.player.team;
  assignRoles();
  showCenterMessage("半场换边", 2.2);
}

function resetBomb() {
  state.bomb.state = "carried";
  state.bomb.carrier = null;
  state.bomb.site = null;
  state.bomb.timer = rules.bombTime;
  state.bomb.progress = 0;
  if (state.bomb.mesh) {
    state.bomb.mesh.visible = false;
    state.bomb.mesh.removeFromParent();
  }
  const carrier = state.player.team === TEAM.T && state.player.alive
    ? state.player
    : state.agents.find((agent) => agent.team === TEAM.T);
  state.bomb.carrier = carrier ?? null;
}

function startRound() {
  if (state.score.T >= rules.roundsToWin || state.score.CT >= rules.roundsToWin) {
    endMatch();
    return;
  }
  if (state.round === rules.sideSwapRound) swapSides();
  state.round += 1;
  state.phase = PHASE.FREEZE;
  state.phaseTime = rules.freezeTime;
  state.buyTime = 20;
  state.roundPlanted = false;
  state.roundWinner = null;
  ui.banner.classList.add("is-hidden");
  ui.death.classList.add("is-hidden");
  ui.letterbox.classList.remove("is-active");
  ui.spectator.classList.add("is-hidden");
  state.spectator = null;
  state.controls.fire = false;
  state.controls.use = false;
  state.shotSounds.length = 0;
  state.smokeZones.forEach((item) => item.group.removeFromParent());
  state.fireZones.forEach((item) => item.group.removeFromParent());
  state.smokeZones.length = 0;
  state.fireZones.length = 0;
  state.droppedWeapons.forEach((item) => item.mesh.removeFromParent());
  state.droppedWeapons.length = 0;

  const teamIndices = { T: 0, CT: 0 };
  for (const agent of state.agents) {
    if (!agent.survivedLastRound) defaultLoadout(agent);
    agent.boughtThisRound = false;
    spawnAgent(agent, teamIndices[agent.team]++);
    if (!agent.isPlayer) botBuy(agent);
  }
  resetBomb();
  rebuildViewModel();
  showCenterMessage("购买装备并准备行动 · 点击画面控制视角", 2.8);
}

function updateRound(dt) {
  if (!state.started || state.paused) return;
  if (state.phase === PHASE.FREEZE) {
    state.phaseTime -= dt;
    state.buyTime -= dt;
    if (state.phaseTime <= 0) {
      state.phase = PHASE.LIVE;
      state.phaseTime = rules.roundTime;
      audio.tone(610, 0.16, 0.08, "square", 900);
      showCenterMessage("行动开始", 1.2);
    }
  } else if (state.phase === PHASE.LIVE) {
    state.phaseTime -= dt;
    state.buyTime -= dt;
    if (state.phaseTime <= 0) resolveRound(TEAM.CT, "回合时间耗尽");
  } else if (state.phase === PHASE.POST_PLANT) {
    state.bomb.timer -= dt;
    state.bomb.beep -= dt;
    if (state.bomb.beep <= 0) {
      const urgency = 1 - state.bomb.timer / rules.bombTime;
      state.bomb.beep = lerp(1.08, 0.18, urgency * urgency);
      audio.beep(state.bomb.timer < 10);
      if (state.bomb.mesh?.userData.display) {
        state.bomb.mesh.userData.display.visible = !state.bomb.mesh.userData.display.visible;
      }
    }
    if (state.bomb.timer <= 0) detonateBomb();
  } else if (state.phase === PHASE.ROUND_END) {
    state.phaseTime -= dt;
    if (state.phaseTime <= 0) startRound();
  }
}

function beginSpectating() {
  ui.death.classList.add("is-hidden");
  const target = state.agents.find((agent) => agent.team === state.player.team && agent.alive && !agent.isPlayer);
  state.spectator = target ?? state.agents.find((agent) => agent.alive && !agent.isPlayer) ?? null;
  if (state.spectator) {
    ui.spectator.classList.remove("is-hidden");
    ui.spectatorName.textContent = state.spectator.name;
  }
}

function updateSpectator(dt) {
  if (state.player?.alive || !state.spectator) return;
  if (!state.spectator.alive) {
    const next = state.agents.find((agent) => agent.team === state.player.team && agent.alive && !agent.isPlayer);
    state.spectator = next ?? null;
    if (!next) {
      ui.spectator.classList.add("is-hidden");
      return;
    }
    ui.spectatorName.textContent = next.name;
  }
  const target = state.spectator.position.clone().add(new THREE.Vector3(0, 1.68, 0));
  camera.position.lerp(target, 1 - Math.exp(-dt * 10));
  camera.rotation.y = lerpAngle(camera.rotation.y, state.spectator.yaw, 1 - Math.exp(-dt * 8));
  camera.rotation.x = lerp(camera.rotation.x, -0.03, 1 - Math.exp(-dt * 8));
}

function endMatch() {
  state.phase = PHASE.MATCH_END;
  state.paused = false;
  document.exitPointerLock?.();
  ui.hud.classList.add("is-hidden");
  ui.result.classList.remove("is-hidden");
  const winner = state.score.T > state.score.CT ? TEAM.T : TEAM.CT;
  ui.resultKicker.textContent = winner === state.player.team ? "任务完成" : "行动失利";
  ui.resultTitle.textContent = `${state.score.T} : ${state.score.CT}`;
  ui.resultSummary.textContent = `${winner === TEAM.T ? "T 阵营" : "CT 阵营"}赢得 ${state.map.name}`;
  ui.resultKills.textContent = state.stats.kills;
  ui.resultDeaths.textContent = state.stats.deaths;
  ui.resultHeadshots.textContent = `${Math.round((state.stats.headshots / Math.max(1, state.stats.hits)) * 100)}%`;
  ui.resultEconomy.textContent = clamp(
    Math.round(100 - (state.stats.spent / Math.max(1, state.round * 4800)) * 35 + state.stats.kills * 2),
    0,
    100,
  );
}

function showCenterMessage(message, duration = 1.4) {
  ui.centerMessage.textContent = message;
  ui.centerMessage.classList.remove("is-hidden");
  state.centerMessageTimer = duration;
}

function updateScreenEffects(dt) {
  state.damageFlash = Math.max(0, state.damageFlash - dt * 1.9);
  ui.damage.style.opacity = String(state.damageFlash);
  if (state.flashAmount > 0) {
    state.flashDecay -= dt;
    if (state.flashDecay <= 0) state.flashAmount = Math.max(0, state.flashAmount - dt * 0.42);
    ui.flash.style.opacity = String(clamp(state.flashAmount, 0, 1));
  } else {
    ui.flash.style.opacity = "0";
  }
  if (state.centerMessageTimer > 0) {
    state.centerMessageTimer -= dt;
    if (state.centerMessageTimer <= 0) ui.centerMessage.classList.add("is-hidden");
  }
}

function renderPips(element, team) {
  const teamAgents = state.agents.filter((agent) => agent.team === team);
  element.innerHTML = teamAgents
    .map((agent) => `<i class="${agent.alive ? "" : "is-dead"}"></i>`)
    .join("");
}

function renderSquad() {
  if (!state.player) return;
  const squad = state.agents.filter((agent) => agent.team === state.player.team);
  ui.squadPanel.innerHTML = squad
    .map(
      (agent) => `
        <div class="squad-row ${agent.team === TEAM.T ? "team-t" : ""} ${agent.alive ? "" : "is-dead"}">
          <span></span>
          <b>${agent.name}</b>
          <span>${agent.alive ? `${Math.max(0, Math.ceil(agent.health))} HP` : "阵亡"}</span>
        </div>
      `,
    )
    .join("");
}

function renderEquipment() {
  const player = state.player;
  if (!player) return;
  const grenadeChips = [...player.grenades.entries()].map(
    ([id, count]) => `<span class="equipment-chip ${player.currentWeaponId === id ? "is-active" : ""}">${WEAPONS[id].name.slice(0, 1)}${count > 1 ? count : ""}</span>`,
  );
  const chips = [
    player.helmet ? `<span class="equipment-chip">盔</span>` : "",
    player.kit ? `<span class="equipment-chip">钳</span>` : "",
    state.bomb.carrier === player ? `<span class="equipment-chip is-active">C4</span>` : "",
    ...grenadeChips,
  ];
  ui.equipment.innerHTML = chips.join("");
}

function updateHUD() {
  const player = state.player;
  if (!player) return;
  ui.scoreT.textContent = state.score.T;
  ui.scoreCT.textContent = state.score.CT;
  renderPips(ui.tAlive, TEAM.T);
  renderPips(ui.ctAlive, TEAM.CT);
  ui.roundNumber.textContent = `第 ${state.round} 回合`;
  ui.roundTime.textContent = formatRoundTime(
    state.phase === PHASE.POST_PLANT ? state.bomb.timer : state.phaseTime,
  );
  ui.phaseLabel.textContent =
    state.phase === PHASE.FREEZE
      ? "购买 / 准备"
      : state.phase === PHASE.POST_PLANT
        ? "炸弹已安放"
        : state.phase === PHASE.ROUND_END
          ? "回合结束"
          : "行动中";
  ui.bombStatus.classList.toggle("is-active", state.bomb.state === "planted");
  ui.bombLabel.textContent =
    state.bomb.state === "planted"
      ? `${state.bomb.site} · ${Math.max(0, state.bomb.timer).toFixed(1)}`
      : state.bomb.carrier === player
        ? "携带 C4"
        : state.bomb.state === "dropped"
          ? "C4 掉落"
          : "C4";
  ui.health.textContent = Math.max(0, Math.ceil(player.health));
  ui.armor.textContent = Math.ceil(player.armor);
  ui.armorLabel.textContent = player.helmet ? "护甲 / 头盔" : "护甲";
  ui.cash.textContent = `$${player.money}`;
  ui.economyState.textContent =
    player.money < 2000 ? "经济局" : player.money < 4200 ? "半起局" : "长枪局";
  const config = WEAPONS[player.currentWeaponId] ?? WEAPONS.knife;
  const current = weaponState(player);
  ui.weaponName.textContent = config.name;
  ui.weaponMode.textContent =
    current?.reloading > 0
      ? `换弹 ${Math.ceil(current.reloading * 10) / 10}s`
      : config.class === "grenade"
        ? "投掷物"
        : config.automatic
          ? "自动"
          : "单发";
  ui.ammoMag.textContent = config.class === "grenade" ? current?.ammo ?? 0 : config.class === "melee" ? "—" : current?.ammo ?? 0;
  ui.ammoReserve.textContent = config.class === "melee" || config.class === "grenade" ? "" : current?.reserve ?? 0;
  ui.crosshair.style.setProperty("--spread", `${8 + (current?.shotIndex ?? 0) * 1.2}px`);
  ui.scope.classList.toggle("is-active", state.controls.aim && config.class === "sniper" && player.alive);
  ui.objectiveTitle.textContent =
    player.team === TEAM.T
      ? state.bomb.state === "planted"
        ? `守住 ${state.bomb.site} 包点`
        : "突破并安放炸弹"
      : state.bomb.state === "planted"
        ? `回防 ${state.bomb.site} 包点`
        : "阻止安放炸弹";
  ui.objectiveDetail.textContent =
    state.bomb.state === "planted"
      ? player.team === TEAM.T
        ? "拖延拆包，构建交叉火力"
        : "清理包点并完成拆除"
      : player.team === TEAM.T
        ? "控制关键路线，清理包点"
        : "控图、补枪并保持回防通道";
  renderEquipment();
  renderSquad();
}

function drawRadar() {
  const context = radarContext;
  const map = state.map;
  if (!context || !map) return;
  const width = ui.radar.width;
  const height = ui.radar.height;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "rgba(12,16,13,.95)";
  context.fillRect(0, 0, width, height);
  const padding = 18;
  const mapWidth = map.bounds[1] - map.bounds[0];
  const mapDepth = map.bounds[3] - map.bounds[2];
  const scale = Math.min((width - padding * 2) / mapWidth, (height - padding * 2) / mapDepth);
  const toRadar = (x, z) => [
    padding + (x - map.bounds[0]) * scale,
    height - padding - (z - map.bounds[2]) * scale,
  ];

  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = "rgba(217,208,181,.22)";
  context.lineWidth = 5;
  for (const [startId, endId] of map.links) {
    const start = nodeById(map, startId);
    const end = nodeById(map, endId);
    const a = toRadar(start.position[0], start.position[2]);
    const b = toRadar(end.position[0], end.position[2]);
    context.beginPath();
    context.moveTo(...a);
    context.lineTo(...b);
    context.stroke();
  }
  context.fillStyle = "rgba(220,210,184,.2)";
  for (const item of map.nodes) {
    const point = toRadar(item.position[0], item.position[2]);
    context.beginPath();
    context.arc(point[0], point[1], Math.max(2, item.radius * scale * 0.22), 0, Math.PI * 2);
    context.fill();
  }
  for (const site of map.sites) {
    const item = nodeById(map, site.node);
    const point = toRadar(item.position[0], item.position[2]);
    context.fillStyle = site.id === "A" ? "#d66b40" : "#d3aa4d";
    context.font = "700 15px sans-serif";
    context.fillText(site.id, point[0] - 4, point[1] + 5);
  }
  for (const smoke of state.smokeZones) {
    const point = toRadar(smoke.position.x, smoke.position.z);
    context.fillStyle = "rgba(155,166,160,.35)";
    context.beginPath();
    context.arc(point[0], point[1], smoke.radius * scale, 0, Math.PI * 2);
    context.fill();
  }
  const playerSight = state.player?.alive ? visibleEnemy(state.player) : null;
  for (const agent of state.agents) {
    if (!agent.alive) continue;
    const point = toRadar(agent.position.x, agent.position.z);
    const friendly = agent.team === state.player.team;
    if (!friendly && playerSight?.target !== agent) continue;
    context.fillStyle = agent.isPlayer ? "#f5eee0" : agent.team === TEAM.T ? "#d79a43" : "#75a9c8";
    context.beginPath();
    context.arc(point[0], point[1], agent.isPlayer ? 4.8 : 3.5, 0, Math.PI * 2);
    context.fill();
    if (agent.isPlayer) {
      context.strokeStyle = "#f5eee0";
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(point[0], point[1]);
      context.lineTo(point[0] - Math.sin(agent.yaw) * 13, point[1] - Math.cos(agent.yaw) * 13);
      context.stroke();
    }
  }
  if (state.bomb.state === "dropped" || state.bomb.state === "planted") {
    const point = toRadar(state.bomb.position.x, state.bomb.position.z);
    context.fillStyle = "#ff583d";
    context.fillRect(point[0] - 3, point[1] - 3, 6, 6);
  }
  const nearest = currentNode(state.player.position);
  ui.radarCallout.textContent = nearest?.callout ?? state.map.name;
}

function renderScoreboard() {
  ui.scoreboardMap.textContent = state.map.name;
  ui.scoreboardScore.textContent = `${state.score.T} : ${state.score.CT}`;
  let html = "";
  for (const team of [TEAM.T, TEAM.CT]) {
    html += `<div class="score-row team-divider ${team === TEAM.T ? "team-t" : ""}"><span>${team === TEAM.T ? "恐怖分子" : "反恐精英"}</span><span></span><span></span><span></span><span></span></div>`;
    html += state.agents
      .filter((agent) => agent.team === team)
      .sort((a, b) => b.kills - a.kills)
      .map(
        (agent) => `
          <div class="score-row">
            <span>${agent.name}${agent.isPlayer ? " 〈你〉" : ""}</span>
            <span>$${agent.money}</span>
            <span>${agent.kills}</span>
            <span>${agent.deaths}</span>
            <span>${agent.alive ? "存活" : "阵亡"}</span>
          </div>
        `,
      )
      .join("");
  }
  ui.scoreboardRows.innerHTML = html;
}

const buyCategories = {
  rifle: ["galil", "famas", "ak47", "m4a1"],
  smg: ["mp7", "p90"],
  sniper: ["scout", "awp"],
  shotgun: ["nova"],
  pistol: ["glock", "usp", "deagle"],
  grenade: ["frag", "flashbang", "smoke", "incendiary"],
  equipment: ["kevlar", "kevlarHelmet", "defuseKit"],
};

function buyItemsForCategory(category) {
  return (buyCategories[category] ?? []).filter((id) => {
    const item = WEAPONS[id] ?? EQUIPMENT[id];
    return !item.team || item.team === "both" || item.team === (state.player?.team ?? state.selectedTeam);
  });
}

function renderBuyMenu() {
  const ids = buyItemsForCategory(state.selectedBuyCategory);
  if (!ids.includes(state.selectedBuyItem)) state.selectedBuyItem = ids[0];
  ui.buyCash.textContent = `$${state.player.money}`;
  ui.buyItems.innerHTML = ids
    .map((id) => {
      const item = WEAPONS[id] ?? EQUIPMENT[id];
      return `
        <button class="buy-item ${id === state.selectedBuyItem ? "is-selected" : ""}" type="button" data-buy-item="${id}" data-mark="${item.slot === 0 ? "EQ" : item.slot}">
          <strong>${item.name}</strong>
          <small>$${item.price}</small>
        </button>
      `;
    })
    .join("");
  $$("[data-buy-item]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedBuyItem = button.dataset.buyItem;
      renderBuyMenu();
    });
    button.addEventListener("dblclick", () => buySelectedItem());
  });
  const selected = WEAPONS[state.selectedBuyItem] ?? EQUIPMENT[state.selectedBuyItem];
  if (!selected) return;
  ui.buyDetailClass.textContent =
    selected.class === "rifle"
      ? "突击步枪"
      : selected.class === "smg"
        ? "冲锋枪"
        : selected.class === "sniper"
          ? "狙击步枪"
          : selected.class === "grenade"
            ? "战术投掷物"
            : selected.slot === 0
              ? "护甲装备"
              : selected.name;
  ui.buyDetailName.textContent = selected.name;
  ui.buyDetailPrice.textContent = `$${selected.price}`;
  const damage = selected.damage ?? 0;
  const fireRate = selected.fireRate ?? 0;
  const control = selected.recoil ? 100 - selected.recoil * 32 : 78;
  const mobility = selected.moveSpeed ? selected.moveSpeed * 82 : 72;
  ui.statDamage.style.width = `${clamp(damage, 10, 100)}%`;
  ui.statRate.style.width = `${clamp(fireRate * 6.5, 12, 100)}%`;
  ui.statControl.style.width = `${clamp(control, 15, 100)}%`;
  ui.statMobility.style.width = `${clamp(mobility, 20, 100)}%`;
}

function inBuyZone(agent) {
  const spawn = nodeById(state.map, state.map.spawns[agent.team]);
  return spawn && Math.hypot(agent.position.x - spawn.position[0], agent.position.z - spawn.position[2]) < 8;
}

function buySelectedItem() {
  if (!state.player || state.buyTime <= 0 || ![PHASE.FREEZE, PHASE.LIVE].includes(state.phase) || !inBuyZone(state.player)) {
    showCenterMessage("当前无法购买", 1.2);
    audio.tone(190, 0.12, 0.045, "square", 130);
    return;
  }
  if (!purchaseForAgent(state.player, state.selectedBuyItem)) {
    showCenterMessage("资金不足或已持有", 1.2);
    audio.tone(190, 0.12, 0.045, "square", 130);
  } else {
    audio.tone(520, 0.08, 0.045, "triangle", 720);
  }
  renderBuyMenu();
}

function toggleBuy(force) {
  if (!state.started || !state.player?.alive) return;
  const shouldOpen = force ?? ui.buy.classList.contains("is-hidden");
  if (shouldOpen && (state.buyTime <= 0 || !inBuyZone(state.player))) {
    showCenterMessage("必须在购买时间内位于出生区域", 1.5);
    return;
  }
  ui.buy.classList.toggle("is-hidden", !shouldOpen);
  if (shouldOpen) {
    document.exitPointerLock?.();
    renderBuyMenu();
  } else if (!state.paused) {
    ui.canvas.requestPointerLock?.();
  }
}

function togglePause(force) {
  if (!state.started || state.phase === PHASE.MATCH_END) return;
  const shouldPause = force ?? !state.paused;
  state.paused = shouldPause;
  ui.pause.classList.toggle("is-hidden", !shouldPause);
  if (shouldPause) {
    state.phaseBeforePause = state.phase;
    document.exitPointerLock?.();
    state.controls.fire = false;
  } else {
    ui.canvas.requestPointerLock?.();
  }
}

function selectWeaponBySlot(slot) {
  const player = state.player;
  if (!player?.alive) return;
  if (slot === 4) {
    const grenades = [...player.grenades.keys()];
    if (!grenades.length) return;
    const currentIndex = grenades.indexOf(player.currentWeaponId);
    switchWeapon(player, grenades[(currentIndex + 1) % grenades.length]);
    return;
  }
  const id =
    slot === 3
      ? "knife"
      : [...player.weapons.keys()].find((weaponId) => WEAPONS[weaponId].slot === slot);
  if (id) switchWeapon(player, id);
}

function cycleWeapon(direction) {
  const ids = availableWeaponIds(state.player);
  const index = ids.indexOf(state.player.currentWeaponId);
  const next = (index + direction + ids.length) % ids.length;
  switchWeapon(state.player, ids[next]);
}

function resetMatchState() {
  state.round = 0;
  state.score.T = 0;
  state.score.CT = 0;
  state.stats = { kills: 0, deaths: 0, shots: 0, hits: 0, headshots: 0, spent: 0 };
  state.phase = PHASE.MENU;
  state.paused = false;
  state.spectator = null;
  state.bomb.mesh = null;
}

async function startMatch() {
  audio.ensure();
  state.mapId = $(".map-option.is-selected")?.dataset.map ?? "dust2";
  state.map = MAPS[state.mapId];
  state.selectedTeam = $('input[name="team"]:checked')?.value ?? TEAM.T;
  state.botCount = Number($("#bot-count").value);
  state.difficulty = $("#difficulty").value;
  ui.start.classList.add("is-hidden");
  ui.result.classList.add("is-hidden");
  ui.loading.classList.remove("is-hidden");
  const stages = [
    ["载入战术拓扑", 24],
    ["构筑掩体与交火线", 54],
    ["部署 Bot 小队", 82],
    ["同步爆破规则", 100],
  ];
  for (const [label, progress] of stages) {
    ui.loadingLabel.textContent = label;
    ui.loadingProgress.style.width = `${progress}%`;
    await new Promise((resolve) => setTimeout(resolve, 90));
  }
  resetMatchState();
  buildMap(state.map);
  makeAgents();
  audio.ambientFor(state.map);
  state.started = true;
  ui.loading.classList.add("is-hidden");
  ui.hud.classList.remove("is-hidden");
  startRound();
}

function returnToSetup() {
  state.started = false;
  state.paused = false;
  state.phase = PHASE.MENU;
  document.exitPointerLock?.();
  ui.pause.classList.add("is-hidden");
  ui.result.classList.add("is-hidden");
  ui.buy.classList.add("is-hidden");
  ui.scoreboard.classList.add("is-hidden");
  ui.death.classList.add("is-hidden");
  ui.banner.classList.add("is-hidden");
  ui.hud.classList.add("is-hidden");
  ui.start.classList.remove("is-hidden");
}

function restartCurrentMatch() {
  ui.pause.classList.add("is-hidden");
  ui.result.classList.add("is-hidden");
  state.paused = false;
  resetMatchState();
  buildMap(state.map);
  makeAgents();
  state.started = true;
  ui.hud.classList.remove("is-hidden");
  startRound();
}

function updateEnvironment(dt) {
  if (state.atmosphere?.geometry?.attributes.position) {
    const positions = state.atmosphere.geometry.attributes.position.array;
    for (let index = 0; index < positions.length; index += 3) {
      positions[index] += dt * (state.map.architecture === "desert" ? 0.32 : 0.08);
      if (positions[index] > state.map.bounds[1] + 12) positions[index] = state.map.bounds[0] - 12;
    }
    state.atmosphere.geometry.attributes.position.needsUpdate = true;
  }
  if (state.rain?.geometry?.attributes.position) {
    const positions = state.rain.geometry.attributes.position.array;
    for (let index = 1; index < positions.length; index += 3) {
      positions[index] -= dt * 18;
      if (positions[index] < 0) positions[index] = 24;
    }
    state.rain.geometry.attributes.position.needsUpdate = true;
  }
}

function bindEvents() {
  $$(".map-option").forEach((button) => {
    button.addEventListener("click", () => {
      $$(".map-option").forEach((item) => item.classList.remove("is-selected"));
      button.classList.add("is-selected");
    });
  });
  $("#bot-count").addEventListener("input", (event) => {
    $("#bot-count-output").textContent = event.target.value;
  });
  $("#start-match").addEventListener("click", startMatch);
  $("#resume-match").addEventListener("click", () => togglePause(false));
  $("#restart-match").addEventListener("click", restartCurrentMatch);
  $("#change-map").addEventListener("click", returnToSetup);
  $("#play-again").addEventListener("click", restartCurrentMatch);
  $("#result-settings").addEventListener("click", returnToSetup);
  $("#toggle-audio").addEventListener("click", (event) => {
    audio.setEnabled(!state.audioEnabled);
    event.currentTarget.textContent = `声音：${state.audioEnabled ? "开启" : "关闭"}`;
  });
  $("#sensitivity").addEventListener("input", () => {});
  ui.buySelected.addEventListener("click", buySelectedItem);
  $$("[data-category]").forEach((button) => {
    button.addEventListener("click", () => {
      $$("[data-category]").forEach((item) => item.classList.remove("is-selected"));
      button.classList.add("is-selected");
      state.selectedBuyCategory = button.dataset.category;
      renderBuyMenu();
    });
  });
  $$("[data-close='buy-menu']").forEach((button) => button.addEventListener("click", () => toggleBuy(false)));

  ui.canvas.addEventListener("click", () => {
    if (state.started && !state.paused && ui.buy.classList.contains("is-hidden")) ui.canvas.requestPointerLock?.();
  });
  document.addEventListener("pointerlockchange", () => {
    state.controls.locked = document.pointerLockElement === ui.canvas;
  });
  document.addEventListener("mousemove", (event) => {
    if (!state.controls.locked || state.paused || !state.player?.alive) return;
    const sensitivity = Number($("#sensitivity").value) * 0.00165;
    state.controls.yaw -= event.movementX * sensitivity;
    state.controls.pitch = clamp(state.controls.pitch - event.movementY * sensitivity, -1.48, 1.48);
  });
  document.addEventListener("mousedown", (event) => {
    if (!state.controls.locked || !state.player?.alive) return;
    if (event.button === 0) {
      state.controls.fire = true;
      fireWeapon(state.player);
    } else if (event.button === 2) {
      state.controls.aim = true;
    }
  });
  document.addEventListener("mouseup", (event) => {
    if (event.button === 0) state.controls.fire = false;
    if (event.button === 2) state.controls.aim = false;
  });
  document.addEventListener("contextmenu", (event) => event.preventDefault());
  document.addEventListener("wheel", (event) => {
    if (state.controls.locked && state.player?.alive) cycleWeapon(event.deltaY > 0 ? 1 : -1);
  }, { passive: true });
  document.addEventListener("keydown", (event) => {
    keys.add(event.code);
    if (event.code === "Tab" && state.started) {
      event.preventDefault();
      renderScoreboard();
      ui.scoreboard.classList.remove("is-hidden");
    }
    if (event.repeat && ["KeyB", "KeyR", "KeyG", "Digit1", "Digit2", "Digit3", "Digit4"].includes(event.code)) return;
    if (event.code === "KeyB") toggleBuy();
    if (event.code === "KeyR") startReload(state.player);
    if (event.code === "KeyG") dropPlayerWeapon();
    if (event.code === "KeyE") state.controls.use = true;
    if (event.code === "Digit1") selectWeaponBySlot(1);
    if (event.code === "Digit2") selectWeaponBySlot(2);
    if (event.code === "Digit3") selectWeaponBySlot(3);
    if (event.code === "Digit4") selectWeaponBySlot(4);
    if (event.code === "KeyQ") cycleWeapon(-1);
    if (event.code === "Escape" && state.started && ui.buy.classList.contains("is-hidden")) {
      setTimeout(() => togglePause(true), 0);
    }
  });
  document.addEventListener("keyup", (event) => {
    keys.delete(event.code);
    if (event.code === "Tab") ui.scoreboard.classList.add("is-hidden");
    if (event.code === "KeyE") state.controls.use = false;
  });
  addEventListener("blur", () => {
    state.controls.fire = false;
    state.controls.aim = false;
    keys.clear();
  });
  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
    renderer.setSize(innerWidth, innerHeight, false);
  });
}

let hudTimer = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  state.worldTime += dt;
  if (!state.paused) {
    updateRound(dt);
    updateWeapons(dt);
    updatePlayerMovement(dt);
    updateBots(dt);
    updateGrenades(dt);
    updateAreaEffects(dt);
    updatePhysicalEffects(dt);
    updatePlayerInteraction(dt);
    updateSpectator(dt);
    updateEnvironment(dt);
    updateScreenEffects(dt);
    if (state.controls.fire && state.player?.alive && WEAPONS[state.player.currentWeaponId]?.automatic) {
      fireWeapon(state.player);
    }
    if (state.bomb.state === "carried" && state.bomb.carrier) {
      state.bomb.position.copy(state.bomb.carrier.position);
    }
  }
  hudTimer -= dt;
  if (state.started && hudTimer <= 0) {
    updateHUD();
    drawRadar();
    hudTimer = 0.2;
  }
  renderer.render(scene, camera);
}

bindEvents();
scene.background = new THREE.Color(MAPS.dust2.palette.sky);
camera.position.set(0, 3.2, 47);
camera.lookAt(0, 1.5, 25);
animate();
window.__sandline = { state, MAPS, WEAPONS, startMatch, restartCurrentMatch };
window.__sandlineBoot.ready = true;
