// ============================================================================
// util.js — small dependency-free helpers (math, events, pools, formatting).
// ============================================================================

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
export const easeOut = (t) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeIn = (t) => clamp01(t) * clamp01(t);
export const sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);
export const sq = (v) => v * v;

/** Move `cur` toward `tgt` by at most `step`. */
export function approach(cur, tgt, step) {
  if (cur < tgt) return Math.min(cur + step, tgt);
  if (cur > tgt) return Math.max(cur - step, tgt);
  return tgt;
}

/** Wrap radians into (-PI, PI]. */
export function angleWrap(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}
export const angleDiff = (a, b) => angleWrap(b - a);
export function angleLerp(a, b, t) { return a + angleDiff(a, b) * clamp01(t); }
export function angleApproach(a, b, step) { return a + clamp(angleDiff(a, b), -step, step); }

/** Frame-rate independent exponential smoothing factor. */
export const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

export const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
export function fmtTime(sec) {
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}
export const fmtMoney = (m) => `$${Math.round(m)}`;

// --- random ----------------------------------------------------------------
export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const chance = (p) => Math.random() < p;
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
/** Box-Muller normal distribution, mean 0 sigma 1 (clamped to ±3). */
export function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return clamp(Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v), -3, 3);
}
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
export function weightedPick(items, weightFn) {
  let total = 0;
  for (const it of items) total += Math.max(0, weightFn(it));
  if (total <= 0) return pick(items);
  let r = Math.random() * total;
  for (const it of items) { r -= Math.max(0, weightFn(it)); if (r <= 0) return it; }
  return items[items.length - 1];
}

let _uid = 0;
export const uid = (p = 'id') => `${p}_${++_uid}`;

// --- geometry helpers on plain {x,y,z} / AABB ------------------------------
export const aabbOverlap = (a, b) =>
  a.min.x < b.max.x && a.max.x > b.min.x &&
  a.min.y < b.max.y && a.max.y > b.min.y &&
  a.min.z < b.max.z && a.max.z > b.min.z;

export const pointInBox2D = (x, z, b) => x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z;
export const pointInBox = (p, b) =>
  p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y && p.z >= b.min.z && p.z <= b.max.z;

/** Squared distance from a point to an AABB (0 inside). */
export function distSqToBox(p, b) {
  const dx = Math.max(b.min.x - p.x, 0, p.x - b.max.x);
  const dy = Math.max(b.min.y - p.y, 0, p.y - b.max.y);
  const dz = Math.max(b.min.z - p.z, 0, p.z - b.max.z);
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Ray vs AABB slab test.
 * @returns {number} entry distance, or -1 when there is no hit within maxT.
 *          `outNormal` (if given) receives the face normal.
 */
export function rayBox(ox, oy, oz, dx, dy, dz, b, maxT, outNormal) {
  let tmin = 0, tmax = maxT, axis = -1, sgn = 1;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  const bmin = [b.min.x, b.min.y, b.min.z], bmax = [b.max.x, b.max.y, b.max.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < bmin[i] || o[i] > bmax[i]) return -1;
      continue;
    }
    const inv = 1 / d[i];
    let t1 = (bmin[i] - o[i]) * inv, t2 = (bmax[i] - o[i]) * inv, s = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = i; sgn = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (outNormal) {
    outNormal.x = outNormal.y = outNormal.z = 0;
    if (axis === 0) outNormal.x = sgn; else if (axis === 1) outNormal.y = sgn; else if (axis === 2) outNormal.z = sgn;
    if (axis === -1) outNormal.y = 1;
  }
  return tmin;
}

export class EventBus {
  constructor() { this.map = new Map(); }
  on(ev, fn) {
    if (!this.map.has(ev)) this.map.set(ev, new Set());
    this.map.get(ev).add(fn);
    return () => this.off(ev, fn);
  }
  off(ev, fn) { this.map.get(ev)?.delete(fn); }
  emit(ev, data) {
    const s = this.map.get(ev);
    if (s) for (const fn of [...s]) { try { fn(data); } catch (e) { console.error('[bus]', ev, e); } }
    const any = this.map.get('*');
    if (any) for (const fn of [...any]) { try { fn(ev, data); } catch (e) { console.error(e); } }
  }
}

// --- pooling ---------------------------------------------------------------
/** Fixed-capacity object pool; `create()` builds, `reset(obj)` recycles. */
export class Pool {
  constructor(create, reset, size = 64) {
    this.create = create; this.reset = reset;
    this.free = []; this.used = new Set();
    for (let i = 0; i < size; i++) this.free.push(create());
  }
  get() {
    const o = this.free.pop() || this.create();
    this.used.add(o);
    return o;
  }
  put(o) {
    if (!this.used.delete(o)) return;
    this.reset?.(o);
    this.free.push(o);
  }
  get activeCount() { return this.used.size; }
}

/** Deterministic PRNG (mulberry32) — used by the automated match test. */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rolling average, used for the fps counter. */
export class Rolling {
  constructor(n = 30) { this.n = n; this.buf = []; this.sum = 0; }
  push(v) {
    this.buf.push(v); this.sum += v;
    if (this.buf.length > this.n) this.sum -= this.buf.shift();
    return this.sum / this.buf.length;
  }
  get avg() { return this.buf.length ? this.sum / this.buf.length : 0; }
}

