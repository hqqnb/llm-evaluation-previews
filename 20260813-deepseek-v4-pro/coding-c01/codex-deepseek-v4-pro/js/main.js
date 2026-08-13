// ---------- 主控制器：渲染、模式切换、轨道/舱内交互、拾取、HUD ----------
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { DeepSpace } from './stars.js';
import { buildShip } from './exterior.js';
import { Interior } from './interior.js';
import { BIOMES, PARTS } from './config.js';
import { initUI } from './ui.js';
import { clamp, easeInOutCubic } from './utils.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.22;
document.querySelector('#app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x01030a);

const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 1.5, 200000);
camera.position.set(9800, 7400, 13800);

const space = new DeepSpace(scene);
const ship = buildShip();
scene.add(ship.root);
const interior = new Interior(scene, camera);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 220;
controls.maxDistance = 90000;
controls.target.set(0, 0, 0);

let mode = 'exterior';
let spinMode = 'demo';
let decelOn = false;
let travelPct = 35;
let travelSpeed = 900;
let spinSpeed = Math.PI * 2 / 60;
let selectedPart = null;
let hovered = null;

const input = {
  keys: new Set(),
  dx: 0, dy: 0,
  get sprint() { return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'); },
};

const ui = initUI({
  onPartClick(partId) { focusPart(partId); },
  onBiomeClick(id) { enterBiome(id); },
  onMode(m) {
    if (m === 'exterior') toExterior();
    else if (m === 'interior') enterBiome('nova_scotia');
    else if (m === 'spine') enterSpine();
  },
  onDecel(v) { decelOn = v; },
  onSpinMode(v) {
    spinMode = v;
    spinSpeed = v === 'demo' ? Math.PI * 2 / 60 : v === 'real' ? Math.sqrt(0.83 * 9.81 / (48000 / TAU2())) : Math.PI * 2 / 240;
    if (v === 'real') ui.showToast('已切换真实转速：≈193 秒/圈（0.83g）');
  },
  onSpeed(v) {
    travelPct = v;
    travelSpeed = Math.pow(v / 100, 2) * 6800;
  },
  onLockRequest() { lockPointer(); },
});

function TAU2() { return Math.PI * 2; }

// ---------- 模式切换 ----------
function toExterior() {
  if (mode === 'exterior') return;
  ui.fade(() => {
    document.exitPointerLock?.();
    mode = 'exterior';
    interior.root.visible = false;
    scene.fog = null;
    camera.near = 1.5; camera.far = 200000; camera.updateProjectionMatrix();
    camera.position.set(9800, 7400, 13800);
    controls.enabled = true;
    controls.target.set(0, 0, 0);
    ui.setMode('exterior');
    ui.showLockHint(false);
  });
}

function enterBiome(id, dir = 1) {
  ui.fade(() => {
    document.exitPointerLock?.();
    const { biome, arch } = interior.enterBiome(id, { dir });
    mode = 'biome';
    scene.fog = new THREE.FogExp2(new THREE.Color(arch.fog), arch.fogD);
    camera.near = 0.1; camera.far = 40000; camera.updateProjectionMatrix();
    controls.enabled = false;
    ui.setMode('biome');
    ui.setBiomeActive(id);
    const ringName = biome.ring === 'A' ? '环 A · 旧世界生态' : '环 B · 新世界生态';
    ui.setHUD(
      `${biome.name} · ${biome.en}`,
      `${ringName}｜${biome.note}｜旋转 0.83g｜舱内约三百居民`,
      'WASD 移动 · Shift 疾走 · 鼠标环顾 · 走向两端闸门穿越 · ESC 释放鼠标 · 按 3 进入主轴'
    );
    ui.showLockHint(true);
  });
}

function enterSpine() {
  ui.fade(() => {
    document.exitPointerLock?.();
    interior.enterSpine();
    mode = 'spine';
    camera.near = 0.1; camera.far = 40000; camera.updateProjectionMatrix();
    controls.enabled = false;
    ui.setMode('spine');
    ui.setHUD(
      '主轴内部 · 零重力',
      '贯穿全舰 10 公里的中央舱道｜舰桥 · AI 核心“波琳” · 发动机舱',
      'WASD 漂浮 · Shift 加速/上浮 · Ctrl 下潜 · J 舰桥 · K 核心 · L 发动机舱 · ESC 释放鼠标'
    );
    ui.showLockHint(true);
    ui.showToast('已进入主轴舱道（零重力区）');
  });
}

// ---------- 部件聚焦 ----------
let focusAnim = null;
function focusPart(partId) {
  selectedPart = partId;
  ui.setPartActive(partId);
  const focus = ship.partFocus[partId];
  if (!focus) return;
  focusAnim = {
    fromPos: camera.position.clone(),
    toPos: focus.pos.clone(),
    fromTgt: controls.target.clone(),
    toTgt: focus.tgt.clone(),
    t: 0, dur: 1.25,
  };
  const meta = PARTS.find(p => p.id === partId);
  if (meta) ui.showToast(`${meta.name}`);
}

function focusBiome(id) {
  const w = ship.getBiomeWorld(id);
  if (!w) return;
  selectedPart = null;
  ui.setPartActive(null);
  focusAnim = {
    fromPos: camera.position.clone(),
    toPos: w.cam.clone(),
    fromTgt: controls.target.clone(),
    toTgt: w.pos.clone(),
    t: 0, dur: 1.25,
  };
}

function updateFocus(dt) {
  if (!focusAnim) return;
  focusAnim.t += dt;
  const k = easeInOutCubic(clamp(focusAnim.t / focusAnim.dur, 0, 1));
  camera.position.lerpVectors(focusAnim.fromPos, focusAnim.toPos, k);
  controls.target.lerpVectors(focusAnim.fromTgt, focusAnim.toTgt, k);
  if (focusAnim.t >= focusAnim.dur) focusAnim = null;
}

// ---------- 拾取与提示 ----------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let lastPickTime = 0;
let downPos = null;

function pickAt(clientX, clientY) {
  ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(ship.pickables, false);
  if (!hits.length) return null;
  const m = hits[0].object;
  if (!m.userData.partId) return null;
  return {
    partId: m.userData.partId,
    biomeId: m.userData.biomeId || null,
  };
}

function updateHover(clientX, clientY) {
  const now = performance.now();
  if (now - lastPickTime < 55) return;
  lastPickTime = now;
  const hit = pickAt(clientX, clientY);
  if (hovered && (!hit || hit.partId !== hovered.partId || hit.biomeId !== hovered.biomeId)) {
    if (hovered.biomeId) ship.setBiomeHighlight(hovered.biomeId, false);
    else ship.setPartHighlight(hovered.partId, false);
  }
  hovered = hit;
  if (!hit) { ui.hideTooltip(); return; }
  if (hit.biomeId) {
    ship.setBiomeHighlight(hit.biomeId, true);
    const b = BIOMES.find(x => x.id === hit.biomeId);
    const ringName = b.ring === 'A' ? '环 A · 旧世界生态' : '环 B · 新世界生态';
    ui.showTooltip(
      `<div class="tt-title">${b.name} · ${b.en}</div>
       <div class="tt-desc">${ringName}｜${b.note}<br>舱直径 1 km · 长 4 km</div>
       <div class="tt-act">🖱 点击进入舱内探索</div>`,
      clientX, clientY
    );
  } else {
    ship.setPartHighlight(hit.partId, true);
    const p = PARTS.find(x => x.id === hit.partId);
    if (p) {
      ui.showTooltip(
        `<div class="tt-title">${p.name}</div>
         <div class="tt-desc">${p.desc}</div>`,
        clientX, clientY
      );
    }
  }
}

// ---------- 指针锁定 ----------
function lockPointer() {
  if (mode === 'exterior') return;
  renderer.domElement.requestPointerLock?.();
}

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (mode !== 'exterior') ui.showLockHint(!locked);
});

// ---------- 输入 ----------
window.addEventListener('keydown', e => {
  input.keys.add(e.code);
  if (mode !== 'exterior' && ['KeyW','KeyA','KeyS','KeyD','Space','ShiftLeft','ShiftRight','ControlLeft','ControlRight'].includes(e.code)) {
    e.preventDefault();
  }
  if (e.code === 'Digit1') toExterior();
  if (e.code === 'Digit2') enterBiome(interior.biome?.id || 'nova_scotia');
  if (e.code === 'Digit3' && mode !== 'spine') enterSpine();
  if (mode === 'spine') {
    if (e.code === 'KeyJ') { interior.pos.set(0, 1060, -92); interior.pitchZ = 0.9; interior.yawZ = 0; interior.vel.set(0,0,0); ui.showToast('舰桥 · 指挥与观景'); }
    if (e.code === 'KeyK') { interior.pos.y = 0; interior.vel.set(0,0,0); ui.showToast('量子核心 · 波琳（Pauline）'); }
    if (e.code === 'KeyL') { interior.pos.y = -1120; interior.vel.set(0,0,0); ui.showToast('发动机舱 · 聚变堆'); }
  }
});
window.addEventListener('keyup', e => input.keys.delete(e.code));

window.addEventListener('mousemove', e => {
  if (document.pointerLockElement === renderer.domElement) {
    input.dx += e.movementX;
    input.dy += e.movementY;
    ui.hideTooltip();
  } else if (mode === 'exterior') {
    if (e.target === renderer.domElement) updateHover(e.clientX, e.clientY);
    else { ui.hideTooltip(); if (hovered) { if (hovered.biomeId) ship.setBiomeHighlight(hovered.biomeId, false); else ship.setPartHighlight(hovered.partId, false); hovered = null; } }
  }
});

renderer.domElement.addEventListener('pointerdown', e => {
  downPos = { x: e.clientX, y: e.clientY };
  focusAnim = null;
});
renderer.domElement.addEventListener('pointerup', e => {
  if (!downPos) return;
  const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
  downPos = null;
  if (moved > 6) return;
  if (mode !== 'exterior') { lockPointer(); return; }
  const hit = pickAt(e.clientX, e.clientY);
  if (!hit) return;
  if (hit.biomeId) {
    const b = BIOMES.find(x => x.id === hit.biomeId);
    ui.showToast(`正穿越气闸：${b.name}（${b.en}）`);
    enterBiome(hit.biomeId);
  } else {
    focusPart(hit.partId);
  }
});

renderer.domElement.addEventListener('wheel', () => { focusAnim = null; });
renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- 主循环 ----------
const clock = new THREE.Clock();
let firstFrame = true;
let frameEma = 16;
let adaptCounter = 0;

function animate() {
  requestAnimationFrame(animate);
  const rawDt = clock.getDelta();
  frameEma = frameEma * 0.95 + rawDt * 1000 * 0.05;
  // 慢设备自适应降分辨率
  if (++adaptCounter % 90 === 0 && frameEma > 42 && renderer.getPixelRatio() > 0.75) {
    renderer.setPixelRatio(Math.max(0.75, renderer.getPixelRatio() - 0.25));
  }
  const dt = Math.min(rawDt, 0.08);
  const t = clock.elapsedTime;

  space.update(dt, travelSpeed);
  ship.update(dt, t, { spinSpeed, travelSpeed, decel: decelOn });

  if (mode === 'exterior') {
    controls.update();
    updateFocus(dt);
  } else {
    if (input.dx || input.dy) {
      interior.applyLook(input.dx, input.dy);
      input.dx = 0; input.dy = 0;
    }
    const bound = interior.update(dt, input);
    if (bound) handleBoundary(bound);
  }

  renderer.render(scene, camera);

  if (firstFrame) {
    firstFrame = false;
    ui.loadingDone();
    ui.showToast('欢迎登舰 · 拖拽旋转 / 滚轮缩放 / 点击生态舱进入内部', 4200);
  }
}

function handleBoundary(bound) {
  const from = interior.biome;
  ui.fade(() => {
    document.exitPointerLock?.();
    interior.enterBiome(bound.id, { dir: bound.dir });
    const b = interior.biome;
    const ringName = b.ring === 'A' ? '环 A · 旧世界生态' : '环 B · 新世界生态';
    ui.setBiomeActive(b.id);
    ui.setHUD(
      `${b.name} · ${b.en}`,
      `${ringName}｜${b.note}｜旋转 0.83g｜舱内约三百居民`,
      'WASD 移动 · Shift 疾走 · 鼠标环顾 · 走向两端闸门穿越 · ESC 释放鼠标 · 按 3 进入主轴'
    );
    ui.showToast(`穿过 15° 斜置闸门：${from.name} → ${b.name}`);
    ui.showLockHint(true);
  });
}

// 测试钩子（供自动化冒烟测试驱动）
window.__app = {
  enterBiome: id => enterBiome(id),
  enterSpine: () => enterSpine(),
  toExterior: () => toExterior(),
  setDecel: v => { decelOn = v; document.querySelector('#toggle-decel').checked = v; },
  setSpeed: v => { travelPct = v; travelSpeed = Math.pow(v / 100, 2) * 6800; document.querySelector('#speed-slider').value = v; },
  mode: () => mode,
  setP: (a, th) => { interior.p.a = a; interior.p.th = th ?? 0; },
  getP: () => ({ ...interior.p, biome: interior.biome?.id }),
  setSpinePos: (x, y, z) => { interior.pos.set(x, y, z); interior.vel.set(0, 0, 0); },
  dbg: () => ({
    mode,
    camPos: camera.position.toArray(),
    camNaN: Number.isNaN(camera.position.x) || Number.isNaN(camera.position.y) || Number.isNaN(camera.position.z),
    camQuat: camera.quaternion.toArray(),
    p: interior.p, a0: interior.a0, a1: interior.a1,
    relief: interior._reliefFn ? interior._reliefFn(interior.p.a, interior.p.th) : null,
    fog: scene.fog ? [scene.fog.color.getHexString(), scene.fog.density] : null,
    render: { tris: renderer.info.render.triangles, calls: renderer.info.render.calls },
    lights: interior.lights.length,
    children: interior.group ? interior.group.children.length : 0,
    doorOpen: {
      fwd: interior.doors.fwd ? Number(interior.doors.fwd.userData.open.toFixed(3)) : null,
      aft: interior.doors.aft ? Number(interior.doors.aft.userData.open.toFixed(3)) : null,
    },
    spinePos: interior.pos.toArray(),
    spineVel: interior.vel.toArray(),
    keys: Array.from(input.keys),
  }),
};

animate();
