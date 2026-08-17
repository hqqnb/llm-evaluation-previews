import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildWatch } from './watchModel.js';
import {
  WEEKDAY_LABELS, approachAngle, computeHandAngles, createVirtualClock, discRotation,
  formatDate, formatDigital, formatOffset, formatOffsetDelta, getZonedParts, isValidTimeZone,
} from './timeMath.js';

/* ---------- 启动参数（便于测试）: ?speed=600&start=2026-08-17T23:59:30Z ---------- */
const params = new URLSearchParams(location.search);
const startParam = params.get('start');
const clock = createVirtualClock({
  speed: Number(params.get('speed')) || 1,
  startMs: startParam ? Date.parse(startParam) : undefined,
});

const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const state = {
  zoneA: localStorage.getItem('watch3d.zoneA') || localZone,
  zoneB: localStorage.getItem('watch3d.zoneB') || 'UTC',
  mode: localStorage.getItem('watch3d.mode') || 'sweep',
  locale: localStorage.getItem('watch3d.locale') || 'en',
  night: false,
  spin: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
};
if (!isValidTimeZone(state.zoneA)) state.zoneA = 'UTC';
if (!isValidTimeZone(state.zoneB)) state.zoneB = 'UTC';

/* ---------- 渲染器 / 场景 ---------- */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 100);
camera.up.set(0, 0, 1); // 场景的“上”是 +Z（表盘朝上）
const CAMERA_HOME = new THREE.Vector3(1.1, -6.2, 5.4);
camera.position.copy(CAMERA_HOME);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0.1);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 4;
controls.maxDistance = 22;
controls.autoRotate = state.spin;
controls.autoRotateSpeed = 0.55;
controls.update();

/* ---------- 环境贴图（用 canvas 生成等距柱状全景，无额外依赖） ---------- */
function buildEnvironment() {
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = 512;
  const ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#e8eef8');
  g.addColorStop(0.44, '#9eb0c8');
  g.addColorStop(0.54, '#39424f');
  g.addColorStop(1, '#0d1015');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 512);
  ctx.fillStyle = '#ffffff';
  for (const [x, y, w, h, a] of [[70, 40, 280, 96, 0.95], [520, 16, 210, 64, 0.8], [790, 96, 170, 46, 0.7]]) {
    ctx.globalAlpha = a;
    ctx.fillRect(x, y, w, h);
  }
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(cv);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  tex.dispose();
  return env;
}
scene.environment = buildEnvironment();

/* ---------- 灯光 ---------- */
const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x0a0d14, 0.55);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xffffff, 2.0);
key.position.set(4, -6, 10);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 0.5;
key.shadow.camera.far = 30;
Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5 });
key.shadow.camera.updateProjectionMatrix();
key.shadow.bias = -0.0008;
scene.add(key);

const rim = new THREE.DirectionalLight(0x7fb2ff, 0.7);
rim.position.set(-6, 4, 3);
scene.add(rim);

const baseIntensities = [hemi.intensity, key.intensity, rim.intensity];

/* ---------- 阴影地面 ---------- */
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.ShadowMaterial({ opacity: 0.32 }),
);
ground.position.z = -3.45;
ground.receiveShadow = true;
scene.add(ground);

/* ---------- 腕表 ---------- */
const watch = buildWatch({ weekdayLabels: WEEKDAY_LABELS[state.locale] });
watch.group.rotation.z = 0;
scene.add(watch.group);

/* ---------- UI ---------- */
const el = (id) => document.getElementById(id);
const zoneList = (() => {
  const all = typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : ['UTC', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Kolkata', 'Europe/London', 'Europe/Paris',
       'America/New_York', 'America/Los_Angeles', 'Australia/Sydney', 'Pacific/Auckland'];
  const set = new Set(['UTC', localZone, ...all]);
  return [...set];
})();

for (const id of ['zoneA', 'zoneB']) {
  const select = el(id);
  for (const tz of zoneList) {
    const opt = document.createElement('option');
    opt.value = tz;
    opt.textContent = tz === localZone ? `${tz} (本机)` : tz;
    select.appendChild(opt);
  }
  select.value = id === 'zoneA' ? state.zoneA : state.zoneB;
  select.addEventListener('change', () => {
    if (id === 'zoneA') state.zoneA = select.value;
    else state.zoneB = select.value;
    localStorage.setItem(`watch3d.${id}`, select.value);
  });
}

function toggle(button, initial, onChange) {
  let value = initial;
  button.setAttribute('aria-pressed', String(value));
  button.addEventListener('click', () => {
    value = !value;
    button.setAttribute('aria-pressed', String(value));
    onChange(value);
  });
}

toggle(el('btnSweep'), state.mode === 'sweep', (on) => {
  state.mode = on ? 'sweep' : 'tick';
  el('btnSweep').textContent = on ? '扫秒' : '跳秒';
  localStorage.setItem('watch3d.mode', state.mode);
});
toggle(el('btnNight'), false, (on) => {
  state.night = on;
  watch.setNight(on);
  renderer.toneMappingExposure = on ? 0.34 : 1.05;
  hemi.intensity = baseIntensities[0] * (on ? 0.12 : 1);
  key.intensity = baseIntensities[1] * (on ? 0.14 : 1);
  rim.intensity = baseIntensities[2] * (on ? 0.2 : 1);
});
toggle(el('btnSpin'), state.spin, (on) => {
  controls.autoRotate = on;
});
toggle(el('btnLocale'), state.locale === 'zh', (on) => {
  state.locale = on ? 'zh' : 'en';
  watch.setWeekdayLabels(WEEKDAY_LABELS[state.locale]);
  localStorage.setItem('watch3d.locale', state.locale);
});
el('btnReset').addEventListener('click', () => {
  camera.position.copy(CAMERA_HOME);
  controls.target.set(0, 0, 0.1);
  controls.update();
});

/* ---------- 渲染循环 ---------- */
let lastFrame = performance.now();
let lastHud = 0;
// 转盘初始角度直接对齐，避免开场旋转一大圈
{
  const p = getZonedParts(clock.now(), state.zoneA);
  watch.discs.date.rotation.z = discRotation(p.day - 1, 31, 0);
  watch.discs.day.rotation.z = discRotation(p.weekday, 7, Math.PI / 2);
}

function tick(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;

  const instant = clock.now();
  const a = getZonedParts(instant, state.zoneA);
  const b = getZonedParts(instant, state.zoneB);
  const anglesA = computeHandAngles(a, { mode: state.mode });
  const anglesB = computeHandAngles(b, { mode: state.mode });

  watch.hands.hour.rotation.z = anglesA.hour;
  watch.hands.minute.rotation.z = anglesA.minute;
  watch.hands.second.rotation.z = anglesA.second;
  watch.hands.gmt.rotation.z = anglesB.hour24; // 第二时区：24 小时指针

  watch.discs.date.rotation.z = approachAngle(
    watch.discs.date.rotation.z, discRotation(a.day - 1, 31, 0), dt, 14,
  );
  watch.discs.day.rotation.z = approachAngle(
    watch.discs.day.rotation.z, discRotation(a.weekday, 7, Math.PI / 2), dt, 14,
  );

  if (now - lastHud > 100) {
    lastHud = now;
    el('clockA').textContent = formatDigital(a);
    el('metaA').textContent = `${formatDate(a, state.locale)} · ${formatOffset(a.offsetMinutes)}`;
    el('clockB').textContent = formatDigital(b);
    el('metaB').textContent = `${formatDate(b, state.locale)} · ${formatOffset(b.offsetMinutes)}`;
    el('metaDiff').textContent =
      `时差 ${formatOffsetDelta(a.offsetMinutes, b.offsetMinutes)}` +
      (clock.isRealtime ? '' : ` · 测试时钟 ×${clock.speed}`);
  }

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
});

// 便于浏览器控制台/自动化测试断言
window.__watch3d = { state, clock, watch, scene, camera, renderer, getZonedParts, computeHandAngles };
