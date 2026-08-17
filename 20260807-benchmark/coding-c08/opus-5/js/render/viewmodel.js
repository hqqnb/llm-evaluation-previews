// ============================================================================
// render/viewmodel.js — first-person weapon models + handling animation.
//
// 100% procedural: boxes, cylinders, lathes and bevelled extrusions merged per
// material so a whole gun costs a handful of draw calls.  Model space:
//   -Z = muzzle direction, +X = right, +Y = up,
//   origin = web of the shooting hand (top rear of the pistol grip).
// `stats.restPos` places that origin at ~(0.18,-0.20,-0.45) in front of the
// overlay camera; `stats.adsPos` lines the sights up with the camera axis.
//
// Integration (after the world pass):
//   renderer.autoClear = false;
//   renderer.clearDepth();
//   renderer.render(vm.scene, vm.camera);
// ============================================================================

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { WEAPON_IDS, VM_ARCHETYPES } from '../core/api.js';
import { TEAM_COLOR_HEX } from '../core/constants.js';
import { clamp, clamp01, lerp, damp, smoothstep, easeOut, rand, TAU } from '../core/util.js';

// ---------------------------------------------------------------------------
// Cached geometry primitives — one BoxGeometry per distinct size, shared by
// every gun and every character that asks for it.
// ---------------------------------------------------------------------------
const GEO = new Map();
const kk = (...a) => a.join('_');

export function gBox(w, h, d) {
  const key = kk('b', w, h, d);
  let g = GEO.get(key);
  if (!g) { g = new THREE.BoxGeometry(w, h, d); GEO.set(key, g); }
  return g;
}
export function gCyl(rt, rb, h, seg = 10, open = false) {
  const key = kk('c', rt, rb, h, seg, open);
  let g = GEO.get(key);
  if (!g) { g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, !!open); GEO.set(key, g); }
  return g;
}
export function gSphere(r, ws = 10, hs = 7) {
  const key = kk('s', r, ws, hs);
  let g = GEO.get(key);
  if (!g) { g = new THREE.SphereGeometry(r, ws, hs); GEO.set(key, g); }
  return g;
}
/** Revolved profile (points are [radius, y]) — muzzle brakes, bottles, scopes. */
export function gLathe(pts, seg = 12) {
  const key = kk('l', seg, pts.map((p) => p.join(':')).join(','));
  let g = GEO.get(key);
  if (!g) {
    g = new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(Math.max(1e-4, p[0]), p[1])), seg);
    GEO.set(key, g);
  }
  return g;
}
/** Chamfered box extruded along Z — the workhorse for receivers and bodies. */
export function gBevel(w, h, d, r = 0.005) {
  const key = kk('v', w, h, d, r);
  let g = GEO.get(key);
  if (!g) {
    r = Math.min(r, w * 0.45, h * 0.45);
    const hw = w / 2 - r, hh = h / 2 - r, sh = new THREE.Shape();
    sh.moveTo(-hw, -h / 2 + 0); sh.lineTo(hw, -h / 2);
    sh.quadraticCurveTo(w / 2, -h / 2, w / 2, -hh);
    sh.lineTo(w / 2, hh); sh.quadraticCurveTo(w / 2, h / 2, hw, h / 2);
    sh.lineTo(-hw, h / 2); sh.quadraticCurveTo(-w / 2, h / 2, -w / 2, hh);
    sh.lineTo(-w / 2, -hh); sh.quadraticCurveTo(-w / 2, -h / 2, -hw, -h / 2);
    const bev = Math.min(r * 0.7, d * 0.2);
    let e = new THREE.ExtrudeGeometry(sh, {
      depth: Math.max(1e-4, d - bev * 2), bevelEnabled: bev > 1e-4, bevelThickness: bev,
      bevelSize: bev, bevelSegments: 1, curveSegments: 2, steps: 1,
    });
    e.translate(0, 0, -d / 2 + bev);
    e.deleteAttribute('uv2');
    g = mergeVertices(e, 1e-5);
    GEO.set(key, g);
  }
  return g;
}
/** Box whose top face is scaled — cheap tapered limbs / grips / stocks. */
export function gTaper(w, h, d, tx = 0.8, tz = 0.8) {
  const key = kk('t', w, h, d, tx, tz);
  let g = GEO.get(key);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = p.getY(i) > 0 ? 1 : 0;
      if (t) { p.setX(i, p.getX(i) * tx); p.setZ(i, p.getZ(i) * tz); }
    }
    g.computeVertexNormals(); GEO.set(key, g);
  }
  return g;
}
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _eu = new THREE.Euler();
const _v3 = new THREE.Vector3(), _sc = new THREE.Vector3();

/** Clone `g` transformed into model space (used before merging). */
function xform(g, x, y, z, rx, ry, rz, sx, sy, sz) {
  _eu.set(rx || 0, ry || 0, rz || 0); _q.setFromEuler(_eu);
  _v3.set(x || 0, y || 0, z || 0);
  _sc.set(sx === undefined ? 1 : sx, sy === undefined ? 1 : sy, sz === undefined ? 1 : sz);
  _m4.compose(_v3, _q, _sc);
  return g.clone().applyMatrix4(_m4);
}

// ---------------------------------------------------------------------------
// Rig — collects geometry per (part, material) and bakes one mesh for each.
// Coordinates handed to add() are always MODEL space; the part pivot offset is
// subtracted automatically so animated groups rotate around the right point.
// ---------------------------------------------------------------------------
class Rig {
  constructor(M) {
    this.M = M;
    this.root = new THREE.Group();
    this.parts = {};
    this.pivots = new Map();
    this.acc = new Map();
    this.part('body', 0, 0, 0);
  }
  part(name, px = 0, py = 0, pz = 0, parent = null) {
    let g = this.parts[name];
    if (!g) {
      g = new THREE.Group(); g.name = name;
      const par = parent ? this.parts[parent] : this.root;
      const po = parent ? this.pivots.get(parent) : [0, 0, 0];
      g.position.set(px - po[0], py - po[1], pz - po[2]);
      par.add(g);
      this.parts[name] = g;
      this.pivots.set(name, [px, py, pz]);
    }
    this.cur = name;
    return g;
  }
  use(name) { this.cur = name; return this.parts[name]; }
  /** add() but the coordinates are already local to the current part. */
  local(mat, geom, x, y, z, rx, ry, rz, sx, sy, sz) {
    const key = this.cur + '|' + mat;
    let list = this.acc.get(key);
    if (!list) { list = []; this.acc.set(key, list); }
    list.push(xform(geom, x || 0, y || 0, z || 0, rx, ry, rz, sx, sy, sz));
    return this;
  }
  add(mat, geom, x, y, z, rx, ry, rz, sx, sy, sz) {
    const p = this.pivots.get(this.cur), key = this.cur + '|' + mat;
    let list = this.acc.get(key);
    if (!list) { list = []; this.acc.set(key, list); }
    list.push(xform(geom, (x || 0) - p[0], (y || 0) - p[1], (z || 0) - p[2], rx, ry, rz, sx, sy, sz));
    return this;
  }
  /** Marker Object3D (muzzle tip, grip point…) inside the current part. */
  node(name, x, y, z) {
    const p = this.pivots.get(this.cur), o = new THREE.Object3D();
    o.name = name; o.position.set(x - p[0], y - p[1], z - p[2]);
    this.parts[this.cur].add(o);
    return o;
  }
  bake(owned, shadows = false) {
    for (const [key, list] of this.acc) {
      const i = key.indexOf('|'), pname = key.slice(0, i), mkey = key.slice(i + 1);
      const geo = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, this.M[mkey] || this.M.metal);
      mesh.castShadow = shadows; mesh.receiveShadow = false;
      mesh.frustumCulled = !shadows ? false : true;
      this.parts[pname].add(mesh);
      if (owned) owned.push(geo);
    }
    this.acc.clear();
    return this.root;
  }
}
// ---------------------------------------------------------------------------
// Materials — tiny canvas textures only, all created lazily inside functions
// so this module still imports cleanly in Node (no `document`).
// ---------------------------------------------------------------------------
const TEX = new Map();
const hasDOM = () => typeof document !== 'undefined' && !!document.createElement;

function canvasTex(key, w, h, draw, repeat = 1) {
  if (TEX.has(key)) return TEX.get(key);
  let tex = null;
  if (hasDOM()) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const c = cv.getContext('2d');
    if (c) {
      draw(c, w, h);
      tex = new THREE.CanvasTexture(cv);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeat, repeat);
      tex.colorSpace = THREE.SRGBColorSpace;
    }
  }
  TEX.set(key, tex);
  return tex;
}

/** Walnut grain: warm base + drifting darker streaks + a few pores. */
function woodTex() {
  return canvasTex('wood', 128, 128, (c, w, h) => {
    c.fillStyle = '#6d4a2b'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const y = Math.random() * h, amp = 2 + Math.random() * 7;
      c.strokeStyle = `rgba(${40 + Math.random() * 40 | 0},${22 + Math.random() * 22 | 0},8,${0.06 + Math.random() * 0.22})`;
      c.lineWidth = 0.6 + Math.random() * 2.2;
      c.beginPath();
      for (let x = 0; x <= w; x += 8) c.lineTo(x, y + Math.sin(x * 0.09 + i) * amp);
      c.stroke();
    }
    for (let i = 0; i < 40; i++) {
      c.fillStyle = 'rgba(30,16,6,0.35)';
      c.fillRect(Math.random() * w, Math.random() * h, 1, 1 + Math.random() * 2);
    }
  }, 2);
}
/** C4 keypad: dark panel, green 7-segment style digits, key grid. */
function keypadTex() {
  return canvasTex('keypad', 128, 128, (c, w, h) => {
    c.fillStyle = '#16181a'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#04140a'; c.fillRect(8, 8, w - 16, 34);
    c.fillStyle = '#3dff86'; c.font = 'bold 26px monospace'; c.textBaseline = 'top';
    c.fillText('7:35', 16, 12);
    c.fillStyle = '#2b2f33';
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) c.fillRect(14 + x * 36, 52 + y * 24, 30, 19);
    c.fillStyle = '#9aa2a8'; c.font = 'bold 12px monospace';
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) c.fillText(String(1 + y * 3 + x), 26 + x * 36, 56 + y * 24);
  });
}
const MATS = new Map();
const std = (o) => new THREE.MeshStandardMaterial(o);

/** Shared (team independent) material set. */
function baseMats() {
  let M = MATS.get('base');
  if (M) return M;
  const wt = woodTex(), kp = keypadTex();
  M = {
    metal: std({ color: 0x43464b, metalness: 0.85, roughness: 0.35 }),
    steel: std({ color: 0x8d939a, metalness: 0.92, roughness: 0.18 }),
    blued: std({ color: 0x24272b, metalness: 0.8, roughness: 0.42 }),
    poly: std({ color: 0x2b2d31, metalness: 0.12, roughness: 0.62 }),
    polyLt: std({ color: 0x3a3d42, metalness: 0.1, roughness: 0.68 }),
    tan: std({ color: 0xa8865a, metalness: 0.06, roughness: 0.7 }),
    olive: std({ color: 0x4a5241, metalness: 0.08, roughness: 0.66 }),
    wood: std({ color: wt ? 0xffffff : 0x6d4a2b, map: wt, metalness: 0.04, roughness: 0.58 }),
    bakelite: std({ color: 0x8a4526, metalness: 0.1, roughness: 0.46 }),
    brass: std({ color: 0xc19a3e, metalness: 0.95, roughness: 0.26 }),
    copper: std({ color: 0xa5642f, metalness: 0.9, roughness: 0.32 }),
    rubber: std({ color: 0x191b1d, metalness: 0.02, roughness: 0.94 }),
    glass: std({ color: 0x08111c, metalness: 0.3, roughness: 0.06, transparent: true, opacity: 0.82 }),
    lens: std({
      color: 0x0d2136, metalness: 0.6, roughness: 0.05, emissive: 0x14304f,
      emissiveIntensity: 0.55, transparent: true, opacity: 0.7,
    }),
    explosive: std({ color: 0xbfa877, metalness: 0.02, roughness: 0.82 }),
    tape: std({ color: 0x2c2c30, metalness: 0.05, roughness: 0.7 }),
    keypad: std({ color: kp ? 0xffffff : 0x16181a, map: kp, metalness: 0.2, roughness: 0.5 }),
    wireRed: std({ color: 0x9a2020, metalness: 0.1, roughness: 0.6 }),
    wireGreen: std({ color: 0x1c7a37, metalness: 0.1, roughness: 0.6 }),
    wireYellow: std({ color: 0xb09422, metalness: 0.1, roughness: 0.6 }),
    ledRed: std({ color: 0xff2a2a, emissive: 0xff1010, emissiveIntensity: 2.4, roughness: 0.4 }),
    ledGreen: std({ color: 0x39ff7a, emissive: 0x18c04e, emissiveIntensity: 2.0, roughness: 0.4 }),
    white: std({ color: 0xd8d4c8, metalness: 0.05, roughness: 0.8 }),
    fire: std({ color: 0xd8721f, metalness: 0.1, roughness: 0.5 }),
    nadeOlive: std({ color: 0x3f4a35, metalness: 0.25, roughness: 0.55 }),
    nadeGrey: std({ color: 0x6a6f74, metalness: 0.55, roughness: 0.45 }),
    nadeBlue: std({ color: 0x2f5b86, metalness: 0.25, roughness: 0.55 }),
    flash: new THREE.MeshBasicMaterial({
      color: 0xffe2a0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide,
    }),
  };
  MATS.set('base', M);
  return M;
}
/** Team flavoured set: glove leather + faction accent. */
export function weaponMats(team = 'T') {
  const t = team === 'CT' ? 'CT' : 'T';
  let M = MATS.get('team_' + t);
  if (M) return M;
  const b = baseMats();
  const tan = t === 'T';
  M = Object.assign({}, b, {
    glove: std({ color: tan ? 0xb09472 : 0x22252a, metalness: 0.03, roughness: 0.82 }),
    gloveDark: std({ color: tan ? 0x7e6547 : 0x14161a, metalness: 0.05, roughness: 0.7 }),
    gloveGrip: std({ color: tan ? 0x5c4a33 : 0x0e1013, metalness: 0.02, roughness: 0.95 }),
    sleeve: std({ color: tan ? 0x8b8358 : 0x2d3540, metalness: 0.02, roughness: 0.88 }),
    accent: std({ color: TEAM_COLOR_HEX[t], metalness: 0.1, roughness: 0.7 }),
  });
  MATS.set('team_' + t, M);
  return M;
}

// ---------------------------------------------------------------------------
// Shared sub-assemblies
// ---------------------------------------------------------------------------

/** Picatinny rail: base + slots, running along Z on top of `y`. */
function rail(R, z0, z1, y, w = 0.020, mat = 'blued') {
  const len = Math.abs(z1 - z0), cz = (z0 + z1) / 2;
  R.add(mat, gBox(w, 0.005, len), 0, y, cz);
  R.add(mat, gBox(w * 0.62, 0.006, len), 0, y + 0.005, cz);
  const n = Math.max(2, Math.round(len / 0.017));
  for (let i = 0; i < n; i++) {
    const z = z0 + (i + 0.5) * (z1 - z0) / n;
    R.add('poly', gBox(w * 0.66, 0.0075, 0.0055), 0, y + 0.0052, z);
  }
}

/** Front sight post inside a hooded block. */
function frontSight(R, z, y, mat = 'blued') {
  R.add(mat, gBox(0.019, 0.020, 0.016), 0, y + 0.012, z);
  R.add(mat, gBox(0.0075, 0.026, 0.010), 0, y + 0.026, z);
  R.add('blued', gBox(0.0035, 0.020, 0.006), 0, y + 0.030, z);
  R.add(mat, gBox(0.0045, 0.030, 0.008), -0.0075, y + 0.030, z);
  R.add(mat, gBox(0.0045, 0.030, 0.008), 0.0075, y + 0.030, z);
}
/** Rear notch / aperture sight. */
function rearSight(R, z, y, aperture = true, mat = 'blued') {
  R.add(mat, gBox(0.024, 0.010, 0.014), 0, y + 0.005, z);
  if (aperture) {
    R.add(mat, gBox(0.007, 0.016, 0.008), -0.0075, y + 0.016, z);
    R.add(mat, gBox(0.007, 0.016, 0.008), 0.0075, y + 0.016, z);
    R.add(mat, gBox(0.022, 0.005, 0.008), 0, y + 0.023, z);
  } else {
    R.add(mat, gBox(0.008, 0.013, 0.008), -0.008, y + 0.013, z);
    R.add(mat, gBox(0.008, 0.013, 0.008), 0.008, y + 0.013, z);
  }
}
/** Barrel along -Z from z0 to z1 (z1 more negative) + optional muzzle device. */
function barrel(R, r, z0, z1, y, device = 'brake', mat = 'blued') {
  const len = Math.abs(z1 - z0);
  R.add(mat, gCyl(r, r * 1.06, len, 12), 0, y, (z0 + z1) / 2, Math.PI / 2, 0, 0);
  if (device === 'brake') {
    R.add('metal', gLathe([[r * 1.5, 0], [r * 1.5, 0.006], [r * 1.75, 0.008], [r * 1.75, 0.026], [r * 1.35, 0.030], [r * 0.55, 0.030]], 12),
      0, y, z1, Math.PI / 2, 0, 0);
    for (let i = 0; i < 3; i++) R.add('poly', gBox(r * 3.6, 0.0035, 0.004), 0, y, z1 - 0.010 - i * 0.007);
  } else if (device === 'slant') {
    R.add('metal', gCyl(r * 1.7, r * 1.7, 0.030, 12), 0, y, z1 - 0.013, Math.PI / 2, 0, 0);
    R.add('poly', gBox(r * 3.6, r * 3.6, 0.010), 0, y + r * 0.5, z1 - 0.026, 0.42, 0, 0);
  } else if (device === 'a2') {
    R.add('metal', gLathe([[r * 1.55, 0], [r * 1.55, 0.030], [r * 0.6, 0.030]], 12), 0, y, z1, Math.PI / 2, 0, 0);
    for (let i = 0; i < 4; i++) {
      const a = (-0.9 + i * 0.6);
      R.add('poly', gBox(0.0035, r * 1.4, 0.020), Math.sin(a) * r * 1.3, y + Math.cos(a) * r * 1.3, z1 - 0.014, 0, 0, a);
    }
  } else if (device === 'crown') {
    R.add('metal', gCyl(r * 1.15, r * 1.15, 0.012, 12), 0, y, z1 - 0.005, Math.PI / 2, 0, 0);
  } else if (device === 'thread') {
    R.add('poly', gCyl(r * 1.1, r * 1.1, 0.014, 10), 0, y, z1 - 0.006, Math.PI / 2, 0, 0);
  }
  // dark bore
  R.add('rubber', gCyl(r * 0.55, r * 0.55, 0.012, 10), 0, y, z1 - 0.004, Math.PI / 2, 0, 0);
}

/** Suppressor can with knurled rings. */
function suppressor(R, r, z0, z1, y) {
  const len = Math.abs(z1 - z0);
  R.add('poly', gCyl(r, r, len, 14), 0, y, (z0 + z1) / 2, Math.PI / 2, 0, 0);
  for (let i = 0; i < 5; i++) {
    R.add('blued', gCyl(r * 1.06, r * 1.06, 0.004, 14), 0, y, z0 - 0.012 - i * (len - 0.02) / 5, Math.PI / 2, 0, 0);
  }
  R.add('rubber', gCyl(r * 0.45, r * 0.45, 0.010, 10), 0, y, z1 - 0.004, Math.PI / 2, 0, 0);
}

/** Vented handguard / heat shield: shell plus a row of cooling slots. */
function vents(R, w, h, z0, z1, y, mat = 'poly', rows = 2) {
  const len = Math.abs(z1 - z0);
  R.add(mat, gBevel(w, h, len, 0.006), 0, y, (z0 + z1) / 2);
  const n = Math.max(2, Math.round(len / 0.026));
  for (let i = 0; i < n; i++) {
    const z = z0 - (i + 0.6) * len / (n + 0.2);
    for (let rw = 0; rw < rows; rw++) {
      const yy = y + (rows === 1 ? 0 : (rw - (rows - 1) / 2) * h * 0.42);
      R.add('rubber', gBox(w * 1.04, h * 0.18, 0.012), 0, yy, z);
    }
  }
}
/** Trigger guard loop + trigger (own pivot) + hammer (own pivot). */
function triggerGroup(R, z, y, mat = 'blued') {
  R.use('body');
  R.add(mat, gBox(0.014, 0.006, 0.062), 0, y - 0.030, z - 0.004);          // guard bottom
  R.add(mat, gBox(0.014, 0.024, 0.006), 0, y - 0.018, z + 0.026);          // guard rear
  R.add(mat, gBox(0.014, 0.020, 0.006), 0, y - 0.020, z - 0.032);          // guard front
  R.part('trigger', 0, y - 0.004, z);
  R.add('steel', gBox(0.007, 0.024, 0.008), 0, y - 0.016, z, 0.12, 0, 0);
  R.add('steel', gBox(0.007, 0.006, 0.012), 0, y - 0.004, z + 0.002);
  R.part('hammer', 0, y + 0.012, z + 0.040);
  R.add('steel', gBox(0.008, 0.020, 0.007), 0, y + 0.022, z + 0.040);
  R.add('steel', gBox(0.010, 0.008, 0.010), 0, y + 0.031, z + 0.042);
  R.use('body');
}

/** Pistol grip: raked tapered block with stippling panels and a grip cap.
 *  `rake` > 0 leans the bottom of the grip rearwards (+Z). */
function pistolGrip(R, x, y, z, w, h, d, rake = 0.24, mat = 'poly') {
  const ca = Math.cos(rake), sa = Math.sin(rake), rx = -rake;
  const at = (s) => [x, y - s * ca, z + s * sa];
  let p = at(h / 2);
  R.add(mat, gTaper(w, h, d, 0.86, 0.78), p[0], p[1], p[2], rx, 0, 0);
  R.add('gloveGrip', gBox(w * 0.34, h * 0.6, 0.004), p[0] - w * 0.5, p[1], p[2] + d * 0.12, rx, 0, 0);
  R.add('gloveGrip', gBox(w * 0.34, h * 0.6, 0.004), p[0] + w * 0.5, p[1], p[2] + d * 0.12, rx, 0, 0);
  for (let i = 0; i < 4; i++) {                       // finger grooves on the front
    p = at(0.014 + i * 0.015);
    R.add(mat, gBox(w * 0.99, 0.005, 0.009), p[0], p[1], p[2] - d * 0.44, rx, 0, 0);
  }
  p = at(h);
  R.add('blued', gBox(w * 1.06, 0.008, d * 0.92), p[0], p[1], p[2], rx, 0, 0);
  return at(h * 0.42);
}

/** Straight box magazine (own pivot at the magwell mouth).
 *  `tilt` > 0 leans the bottom forward (-Z). */
function magStraight(R, x, y, z, w, h, d, tilt = 0, mat = 'blued', name = 'mag') {
  R.part(name, x, y, z);
  const ca = Math.cos(tilt), sa = Math.sin(tilt);
  const at = (s) => [x, y - s * ca, z - s * sa];
  let p = at(h / 2);
  R.add(mat, gBevel(w, h, d, 0.004), p[0], p[1], p[2], tilt, 0, 0);
  for (let i = 0; i < 3; i++) {
    p = at(0.020 + i * 0.021);
    R.add('rubber', gBox(w * 1.03, 0.003, d * 0.72), p[0], p[1], p[2], tilt, 0, 0);
  }
  p = at(h);
  R.add('poly', gBox(w * 1.12, 0.009, d * 1.06), p[0], p[1], p[2], tilt, 0, 0);
  R.add('brass', gBox(w * 0.5, 0.006, d * 0.5), x, y + 0.003, z, tilt, 0, 0);
  R.use('body');
}

/** Curved AK/MP5 style magazine built from progressively rotated slabs. */
function magCurved(R, x, y, z, w, h, d, bend = 0.10, mat = 'bakelite') {
  R.part('mag', x, y, z);
  const n = 6, seg = h / n;
  let cy = y, cz = z, a = 0;
  for (let i = 0; i < n; i++) {
    a += bend;
    const sw = w * (1 - i * 0.012);
    R.add(mat, gBox(sw, seg * 1.06, d - i * 0.0015), x, cy - seg / 2, cz, a, 0, 0);
    if (i % 2 === 1) R.add('rubber', gBox(sw * 1.04, 0.003, d * 0.62), x, cy - seg / 2, cz, a, 0, 0);
    cy -= Math.cos(a) * seg; cz -= Math.sin(a) * seg * 0.75;
  }
  R.add('poly', gBox(w * 1.1, 0.008, d * 1.04), x, cy + 0.002, cz, a, 0, 0);
  R.add('brass', gBox(w * 0.5, 0.006, d * 0.5), x, y + 0.003, z);
  R.use('body');
}
/** Fixed rifle stock (wood or polymer) with comb, wrist and butt pad. */
function stockFixed(R, z0, len, y, mat = 'wood') {
  const z1 = z0 + len;
  R.add(mat, gBevel(0.036, 0.048, len * 0.7, 0.008), 0, y - 0.006, z0 + len * 0.35, 0, 0, 0);
  R.add(mat, gBevel(0.038, 0.062, len * 0.42, 0.008), 0, y + 0.004, z1 - len * 0.21);
  R.add(mat, gBox(0.034, 0.026, len * 0.5), 0, y + 0.030, z0 + len * 0.5, -0.06, 0, 0);   // comb
  R.add('rubber', gBevel(0.036, 0.070, 0.012, 0.006), 0, y + 0.006, z1 + 0.004);          // butt pad
  R.add('blued', gBox(0.040, 0.004, 0.030), 0, y - 0.020, z0 + 0.014);                     // toe plate
}
/** Collapsible / telescoping stock on a buffer tube. */
function stockTele(R, z0, len, y, mat = 'poly') {
  R.add('blued', gCyl(0.0135, 0.0135, len * 0.95, 12), 0, y, z0 + len * 0.48, Math.PI / 2, 0, 0);
  for (let i = 0; i < 4; i++) R.add('blued', gBox(0.031, 0.006, 0.006), 0, y - 0.014, z0 + 0.03 + i * 0.028);
  R.add(mat, gBevel(0.036, 0.052, len * 0.42, 0.008), 0, y - 0.002, z0 + len * 0.74);
  R.add(mat, gBox(0.030, 0.030, len * 0.3), 0, y + 0.026, z0 + len * 0.72, -0.05, 0, 0);
  R.add('rubber', gBevel(0.034, 0.066, 0.011, 0.005), 0, y - 0.004, z0 + len * 0.95);
  R.add('blued', gBox(0.016, 0.010, 0.014), 0, y - 0.026, z0 + len * 0.62);   // adjust latch
}
/** Skeletonised sniper stock: frame rails, thumbhole, cheek riser. */
function stockSkeleton(R, z0, len, y, mat = 'olive') {
  R.add(mat, gBevel(0.030, 0.030, len, 0.008), 0, y + 0.030, z0 + len / 2);        // top rail
  R.add(mat, gBevel(0.028, 0.024, len * 0.86, 0.008), 0, y - 0.038, z0 + len * 0.5); // bottom rail
  R.add(mat, gBevel(0.028, 0.070, 0.026, 0.008), 0, y - 0.004, z0 + len - 0.014);  // rear post
  R.add(mat, gBevel(0.028, 0.052, 0.024, 0.008), 0, y + 0.006, z0 + 0.014);        // front post
  R.add('rubber', gBevel(0.032, 0.084, 0.012, 0.005), 0, y - 0.002, z0 + len + 0.004);
  R.add(mat, gBevel(0.034, 0.020, 0.075, 0.006), 0, y + 0.050, z0 + len * 0.56);   // cheek riser
  R.add('blued', gBox(0.012, 0.014, 0.012), 0, y + 0.038, z0 + len * 0.30);
  R.add('blued', gBox(0.012, 0.014, 0.012), 0, y + 0.038, z0 + len * 0.80);
}
/** Sling loop (thin ring approximated by 4 bars). */
function slingLoop(R, x, y, z, r = 0.010, mat = 'metal') {
  R.add(mat, gBox(0.004, r * 2, 0.004), x, y + r, z);
  R.add(mat, gBox(0.004, r * 2, 0.004), x, y - r, z);
  R.add(mat, gBox(0.004, 0.004, r * 2), x, y, z + r);
  R.add(mat, gBox(0.004, 0.004, r * 2), x, y, z - r);
}
/** Telescopic sight: rings, tube, bells, turrets, dark glass + blue sheen. */
function scope(R, z, y, len = 0.20, r = 0.022, mountH = 0.030) {
  R.part('scope', 0, y, z);
  const zr = z + len / 2, zf = z - len / 2;
  R.add('blued', gCyl(r, r, len * 0.62, 14), 0, y, z, Math.PI / 2, 0, 0);
  R.add('blued', gLathe([[r, 0], [r * 1.02, 0.006], [r * 1.34, 0.016], [r * 1.34, 0.05], [r * 1.30, 0.056], [r * 0.2, 0.058]], 14),
    0, y, zf + 0.058, -Math.PI / 2, 0, 0);                                   // objective bell
  R.add('blued', gLathe([[r, 0], [r * 1.02, 0.005], [r * 1.22, 0.014], [r * 1.22, 0.036], [r * 1.16, 0.042], [r * 0.2, 0.044]], 14),
    0, y, zr - 0.044, Math.PI / 2, 0, 0);                                    // ocular bell
  R.add('rubber', gCyl(r * 1.24, r * 1.24, 0.010, 14), 0, y, zr - 0.004, Math.PI / 2, 0, 0);
  R.add('glass', gCyl(r * 1.20, r * 1.20, 0.003, 16), 0, y, zf + 0.004, Math.PI / 2, 0, 0);
  R.add('lens', gCyl(r * 1.04, r * 1.04, 0.002, 16), 0, y, zf + 0.008, Math.PI / 2, 0, 0);
  R.add('glass', gCyl(r * 1.08, r * 1.08, 0.003, 16), 0, y, zr - 0.010, Math.PI / 2, 0, 0);
  R.add('lens', gCyl(r * 0.92, r * 0.92, 0.002, 16), 0, y, zr - 0.014, Math.PI / 2, 0, 0);
  R.add('blued', gCyl(r * 0.44, r * 0.44, 0.016, 10), 0, y + r + 0.006, z + 0.006);          // elevation turret
  R.add('blued', gCyl(r * 0.40, r * 0.40, 0.014, 10), -r - 0.005, y, z + 0.006, 0, 0, Math.PI / 2);
  R.add('blued', gCyl(r * 0.52, r * 0.52, 0.012, 10), 0, y, z - len * 0.22, Math.PI / 2, 0, 0); // zoom ring
  for (let s = -1; s <= 1; s += 2) {                                          // rings + mount
    R.add('metal', gCyl(r * 1.12, r * 1.12, 0.012, 12), 0, y, z + s * len * 0.17, Math.PI / 2, 0, 0);
    R.add('metal', gBox(0.026, mountH, 0.014), 0, y - r - mountH / 2, z + s * len * 0.17);
    R.add('blued', gBox(0.030, 0.006, 0.016), 0, y - r - mountH + 0.002, z + s * len * 0.17);
  }
  R.use('body');
  return y;
}

/** Muzzle flash: crossed additive quads + forward cone + a brief point light. */
function flashNode(R, x, y, z, name = 'muzzle') {
  const g = R.part(name, x, y, z);
  for (let i = 0; i < 3; i++) {
    R.add('flash', new THREE.PlaneGeometry(0.16, 0.16), x, y, z + 0.010, 0, 0, i * (Math.PI / 3));
  }
  R.add('flash', gCyl(0.004, 0.055, 0.075, 10, true), x, y, z - 0.030, -Math.PI / 2, 0, 0);
  R.use('body');
  g.visible = false;
  const light = new THREE.PointLight(0xffcc77, 0, 4.2, 2);
  light.position.set(0, 0, -0.03);
  g.add(light);
  g.userData.light = light;
  return g;
}

/** Ejected case (hidden until fired). */
function shellNode(R, x, y, z, r = 0.0045, len = 0.019) {
  const g = R.part('shell', x, y, z);
  R.add('brass', gCyl(r, r * 1.02, len, 10), x, y, z, 0, 0, Math.PI / 2);
  R.add('brass', gCyl(r * 1.14, r * 1.14, 0.003, 10), x - len / 2, y, z, 0, 0, Math.PI / 2);
  R.add('copper', gCyl(r * 0.5, r * 0.5, 0.003, 8), x - len / 2 - 0.002, y, z, 0, 0, Math.PI / 2);
  R.use('body');
  g.visible = false;
  return g;
}
// ---------------------------------------------------------------------------
// Gloved hands.  Hand local space: the gripped bar lies on the X axis through
// the origin, the palm and forearm run toward +Z, fingers wrap in the YZ plane
// (θ=0 top, θ=90° front/-Z) and the thumb opposes them.  `sx` (+1/-1) mirrors
// right/left.  Callers position/rotate the part group only.
// ---------------------------------------------------------------------------
function wrapFinger(R, mat, x, radius, angles, w = 0.0165, th = 0.0135) {
  for (let i = 0; i < angles.length - 1; i++) {
    const a = angles[i], b = angles[i + 1], rr = radius - i * 0.0016;
    const ay = rr * Math.cos(a), az = -rr * Math.sin(a);
    const by = (rr - 0.0012) * Math.cos(b), bz = -(rr - 0.0012) * Math.sin(b);
    const dy = by - ay, dz = bz - az, len = Math.hypot(dy, dz);
    const phi = Math.atan2(-dy, dz);
    R.local(mat, gBox(w - i * 0.001, th - i * 0.0012, len + 0.004), x, (ay + by) / 2, (az + bz) / 2, phi, 0, 0);
    if (i < angles.length - 2) R.local(mat, gBox(w * 0.95, th * 0.92, 0.0075), x, by, bz, phi, 0, 0);
  }
}

/**
 * Build a gloved hand (+ forearm) as a part of the rig.  The outer group is
 * returned for the caller to position/orient; `roll` spins the hand around the
 * gripped bar (inner group) so palm and thumb land on the right side.
 * @param {'open'|'grip'|'pinch'} style
 */
function hand(R, name, sx, style = 'grip', roll = 0, parent = 'hands') {
  const outer = R.part(name, 0, 0, 0, parent);
  const inner = R.part(name + '_in', 0, 0, 0, name);
  inner.rotation.x = roll;
  const g = inner;
  const gl = 'glove', dk = 'gloveDark';
  // palm, heel, wrist, forearm
  R.local(gl, gBevel(0.077, 0.028, 0.058, 0.010), sx * 0.002, 0.001, 0.044);
  R.local(dk, gBevel(0.070, 0.024, 0.020, 0.008), sx * 0.002, -0.004, 0.020);      // palm pad
  R.local(gl, gBevel(0.064, 0.033, 0.030, 0.010), sx * 0.001, 0.000, 0.081);       // heel/wrist
  R.local(dk, gCyl(0.031, 0.029, 0.016, 12), 0, 0, 0.098, Math.PI / 2, 0, 0);      // cuff
  R.local('sleeve', gCyl(0.033, 0.041, 0.145, 12), 0, 0, 0.178, Math.PI / 2, 0, 0);
  R.local('sleeve', gBox(0.070, 0.010, 0.026), 0, 0.030, 0.140);                   // sleeve fold
  R.local(dk, gBox(0.058, 0.007, 0.028), sx * 0.004, 0.016, 0.062);                // knuckle guard
  R.local(dk, gBox(0.013, 0.008, 0.028), sx * 0.036, 0.004, 0.052);                // side seam
  // four fingers
  const spread = [-0.028, -0.0095, 0.0095, 0.028];
  const curl = style === 'open' ? [-0.35, 0.15, 0.6, 0.95] : style === 'pinch' ? [-0.3, 0.5, 1.35, 2.0] : [-0.32, 0.62, 1.62, 2.42];
  for (let i = 0; i < 4; i++) {
    const t = Math.abs(i - 1.4) * 0.055;
    wrapFinger(R, gl, sx * spread[i], 0.0295 - t * 0.16, curl.map((c, j) => c + (j > 0 ? t : 0)), 0.0165 - t * 0.03, 0.0138 - t * 0.02);
  }
  // thumb: two phalanges opposing the fingers, angled along the bar
  const tx = sx * 0.040, ty = -0.014;
  R.local(gl, gBox(0.019, 0.018, 0.034), tx, ty + 0.004, 0.030, 0.35, sx * -0.55, 0);
  R.local(gl, gBox(0.016, 0.015, 0.030), tx - sx * 0.012, ty - 0.004, 0.006, 0.9, sx * -0.75, 0);
  R.local(dk, gBox(0.014, 0.013, 0.010), tx - sx * 0.020, ty - 0.010, -0.007, 1.1, sx * -0.8, 0);
  R.use('body');
  return outer;
}

/** Two-handed layout: shooting hand on the grip, support hand on the forend. */
function placeHands(R, cfg) {
  R.part('hands', 0, 0, 0);
  const rear = hand(R, 'handRear', 1, cfg.rearStyle || 'grip', cfg.rearRoll ?? 0.40);
  rear.position.set(cfg.grip[0], cfg.grip[1], cfg.grip[2]);
  rear.rotation.set(-(cfg.rake ?? 0.26), cfg.rearYaw ?? 0.0, -Math.PI / 2);
  R.parts.handRear = rear;
  if (cfg.fore) {
    const fore = hand(R, 'handFront', -1, cfg.foreStyle || 'grip', cfg.foreRoll ?? 0.50);
    fore.position.set(cfg.fore[0], cfg.fore[1], cfg.fore[2]);
    fore.rotation.set(cfg.forePitch ?? 0.10, -Math.PI / 2, cfg.foreTilt ?? 0);
    R.parts.handFront = fore;
  }
  R.use('body');
}
// ---------------------------------------------------------------------------
// Archetype builders.  Each fills the rig and returns the handling data:
//   aim  – point on the sight line / optic axis (model space)
//   pull – how far the weapon is drawn back toward the eye when aiming
//   cycle– 'auto' | 'pump' | 'bolt' (what fire() has to work after each shot)
// ---------------------------------------------------------------------------

/** AK-47 / Galil — stamped receiver, wood furniture, banana magazine. */
function bRifleAK(R, o) {
  const galil = o.variant === 'galil';
  const wood = galil ? 'polyLt' : 'wood', sy = 0.098;
  R.use('body');
  R.add('blued', gBevel(0.046, 0.070, 0.250, 0.008), 0, 0.046, -0.085);        // receiver
  R.add('blued', gBevel(0.043, 0.022, 0.196, 0.007), 0, 0.086, -0.100);        // dust cover
  for (let i = 0; i < 4; i++) R.add('metal', gSphere(0.0032, 6, 4), 0.023, 0.052 + (i % 2) * 0.026, -0.02 - i * 0.045);
  R.add('blued', gBox(0.040, 0.016, 0.062), 0, 0.008, -0.045);                 // magwell
  R.add('rubber', gBox(0.032, 0.016, 0.044), 0.024, 0.064, -0.075);            // ejection port
  R.add('blued', gBox(0.008, 0.040, 0.056), 0.026, 0.062, -0.030);             // selector lever
  R.add('blued', gBox(0.012, 0.010, 0.028), 0.028, 0.078, -0.012, 0, 0, 0.5);
  barrel(R, 0.0076, -0.205, -0.478, 0.048, galil ? 'brake' : 'slant');
  R.add('blued', gCyl(0.0058, 0.0058, 0.185, 10), 0, 0.072, -0.300, Math.PI / 2, 0, 0);   // gas tube
  R.add('blued', gBevel(0.026, 0.032, 0.026, 0.005), 0, 0.064, -0.392, 0.35, 0, 0);       // gas block
  R.add(wood, gBevel(0.040, 0.038, 0.118, 0.010), 0, 0.028, -0.272);           // lower handguard
  vents(R, 0.036, 0.026, -0.218, -0.320, 0.074, wood, 1);                      // upper handguard
  R.add('blued', gBox(0.030, 0.006, 0.030), 0, 0.010, -0.218);
  frontSight(R, -0.464, sy - 0.038);
  rearSight(R, -0.176, sy - 0.0165, false);
  R.add('blued', gBevel(0.040, 0.018, 0.030, 0.005), 0, 0.088, -0.176);        // rear sight base
  const gp = pistolGrip(R, 0, -0.004, 0.014, 0.035, 0.084, 0.048, 0.30, galil ? 'poly' : 'bakelite');
  triggerGroup(R, -0.004, 0.004);
  stockFixed(R, 0.058, 0.215, 0.034, wood);
  slingLoop(R, 0.019, 0.026, -0.300);
  slingLoop(R, 0.000, -0.004, 0.086);
  magCurved(R, 0, 0.004, -0.045, 0.035, 0.108, 0.058, 0.085, galil ? 'poly' : 'bakelite');
  R.part('bolt', 0.030, 0.078, -0.050);                                        // charging handle
  R.add('metal', gBox(0.013, 0.013, 0.062), 0.030, 0.078, -0.050);
  R.add('metal', gBox(0.019, 0.017, 0.014), 0.032, 0.078, -0.018);
  R.use('body');
  flashNode(R, 0, 0.048, -0.505);
  shellNode(R, 0.032, 0.064, -0.072);
  placeHands(R, {
    grip: [gp[0], gp[1] + 0.006, gp[2]], rake: 0.30, rearRoll: 0.42,
    fore: [0, 0.036, -0.272], foreRoll: 0.62, forePitch: 0.06,
  });
  return { aim: [0, sy, -0.176], pull: 0.055, cycle: 'auto', length: 0.72, kickZ: 0.030, kickP: 0.055 };
}
/** M4A4 / M4A1-S / FAMAS — flat-top upper, quad rail, tele stock. */
function bRifleM4(R, o) {
  const sil = o.variant === 'm4a1s', famas = o.variant === 'famas', sy = 0.104;
  R.use('body');
  R.add('poly', gBevel(0.042, 0.050, 0.205, 0.007), 0, 0.062, -0.090);          // upper receiver
  R.add('poly', gBevel(0.040, 0.058, 0.140, 0.006), 0, 0.014, -0.040);          // lower receiver
  R.add('poly', gBevel(0.044, 0.028, 0.050, 0.006), 0, 0.078, 0.020);           // rear of upper
  rail(R, -0.196, 0.010, 0.088);
  R.add('poly', gBox(0.036, 0.020, 0.062), 0, 0.006, -0.052);                   // magwell
  R.add('rubber', gBox(0.030, 0.018, 0.048), 0.023, 0.062, -0.062);             // ejection port
  R.add('blued', gBox(0.008, 0.026, 0.026), 0.024, 0.062, -0.038, 0, 0, 0.2);   // dust cover
  R.add('metal', gCyl(0.009, 0.009, 0.016, 8), 0.024, 0.082, -0.030, 0, 0, Math.PI / 2); // fwd assist
  R.add('blued', gBox(0.010, 0.014, 0.010), 0.026, 0.030, -0.014);              // mag release
  R.add('blued', gBox(0.030, 0.008, 0.014), 0, 0.036, -0.006);                  // bolt catch
  if (famas) {
    R.add('poly', gBevel(0.028, 0.052, 0.150, 0.008), 0, 0.118, -0.070);        // carry handle
    R.add('poly', gBox(0.024, 0.014, 0.030), 0, 0.092, -0.140);
  }
  vents(R, 0.045, 0.045, -0.196, -0.330, 0.062, 'poly', 2);                     // handguard
  rail(R, -0.196, -0.330, 0.088, 0.020, 'poly');
  barrel(R, 0.0070, -0.300, sil ? -0.400 : -0.470, 0.062, sil ? 'thread' : 'a2');
  if (sil) suppressor(R, 0.0165, -0.372, -0.545, 0.062);
  else {
    R.add('blued', gBevel(0.024, 0.052, 0.028, 0.005), 0, 0.078, -0.352);       // FSB
    R.add('blued', gCyl(0.011, 0.011, 0.022, 10), 0, 0.062, -0.340, Math.PI / 2, 0, 0);
  }
  frontSight(R, -0.352, sy - 0.038);
  rearSight(R, -0.020, sy - 0.0165, true);
  const gp = pistolGrip(R, 0, -0.010, 0.010, 0.033, 0.080, 0.046, 0.26, 'poly');
  triggerGroup(R, -0.012, 0.000);
  stockTele(R, 0.036, 0.190, 0.052, 'poly');
  slingLoop(R, 0.018, 0.040, -0.320);
  magStraight(R, 0, 0.000, -0.052, 0.034, 0.104, 0.058, 0.07, 'poly');
  R.part('bolt', 0, 0.086, 0.030);                                              // charging handle
  R.add('metal', gBox(0.014, 0.012, 0.048), 0, 0.086, 0.030);
  R.add('metal', gBox(0.048, 0.010, 0.014), 0, 0.086, 0.052);
  R.use('body');
  flashNode(R, 0, 0.062, sil ? -0.552 : -0.496);
  shellNode(R, 0.030, 0.062, -0.062);
  placeHands(R, {
    grip: [gp[0], gp[1] + 0.006, gp[2]], rake: 0.26, rearRoll: 0.40,
    fore: [0, 0.050, -0.268], foreRoll: 0.58, forePitch: 0.05,
  });
  return { aim: [0, sy, -0.020], pull: 0.055, cycle: 'auto', length: sil ? 0.78 : 0.74, kickZ: 0.024, kickP: 0.042 };
}
/** AUG / SG553 — bullpup shell, magazine behind the grip, low optic. */
function bBullpup(R, o) {
  const sg = o.variant === 'sg553', shell = sg ? 'poly' : 'olive', sy = 0.112;
  R.use('body');
  R.add(shell, gBevel(0.048, 0.092, 0.330, 0.012), 0, 0.040, -0.110);           // main shell
  R.add(shell, gBevel(0.052, 0.040, 0.120, 0.010), 0, 0.078, 0.030);            // butt / cheek
  R.add('rubber', gBevel(0.048, 0.070, 0.012, 0.006), 0, 0.062, 0.094);         // butt pad
  R.add(shell, gBevel(0.040, 0.052, 0.070, 0.010), 0, -0.006, -0.020);          // trigger housing
  R.add('rubber', gBox(0.034, 0.016, 0.044), 0.025, 0.060, 0.010);              // ejection port
  R.add(shell, gBevel(0.044, 0.034, 0.062, 0.008), 0, -0.010, -0.196);          // fore grip housing
  R.add(shell, gTaper(0.030, 0.078, 0.042, 0.9, 0.9), 0, -0.052, -0.208, 0.10, 0, 0);   // vertical grip
  R.add('gloveGrip', gBox(0.032, 0.052, 0.004), 0, -0.056, -0.230);
  vents(R, 0.034, 0.030, -0.238, -0.330, 0.070, 'poly', 1);
  barrel(R, 0.0074, -0.250, -0.452, 0.062, 'brake');
  R.add('blued', gCyl(0.013, 0.013, 0.030, 10), 0, 0.062, -0.256, Math.PI / 2, 0, 0);
  rail(R, -0.230, -0.010, 0.086, 0.022, shell);
  scope(R, -0.116, sy + 0.012, 0.155, 0.019, 0.026);
  R.add(shell, gBox(0.026, 0.020, 0.070), 0, 0.096, 0.020);                     // rear optic bridge
  const gp = pistolGrip(R, 0, -0.010, 0.006, 0.033, 0.078, 0.046, 0.24, 'poly');
  triggerGroup(R, -0.012, 0.000);
  slingLoop(R, 0.020, 0.028, -0.240);
  slingLoop(R, 0.020, 0.052, 0.060);
  magStraight(R, 0, 0.006, 0.048, 0.032, 0.098, 0.056, -0.05, 'poly');
  R.part('bolt', -0.028, 0.070, -0.130);                                        // side charger
  R.add('metal', gBox(0.012, 0.011, 0.070), -0.028, 0.070, -0.130);
  R.add('metal', gBox(0.016, 0.016, 0.014), -0.030, 0.070, -0.166);
  R.use('body');
  flashNode(R, 0, 0.062, -0.478);
  shellNode(R, 0.032, 0.060, 0.010);
  placeHands(R, {
    grip: [gp[0], gp[1] + 0.006, gp[2]], rake: 0.24, rearRoll: 0.40,
    fore: [0, -0.036, -0.212], rake2: 0.1, foreStyle: 'grip', foreRoll: 0.30, forePitch: -0.05,
  });
  R.parts.handFront.rotation.set(-0.10, 0, -Math.PI / 2 + 0.10);                // holds the vertical grip
  return { aim: [0, sy + 0.012, -0.030], pull: 0.10, cycle: 'auto', length: 0.70, kickZ: 0.022, kickP: 0.038 };
}
/** AWP — heavy fluted barrel, big glass, skeleton stock, side bolt. */
function bSniperAWP(R, o) {
  const sy = 0.130;
  R.use('body');
  R.add('metal', gBevel(0.046, 0.062, 0.230, 0.008), 0, 0.052, -0.110);         // receiver
  R.add('olive', gBevel(0.052, 0.048, 0.150, 0.010), 0, 0.014, -0.060);         // chassis / bedding
  R.add('olive', gBevel(0.050, 0.040, 0.170, 0.012), 0, 0.004, -0.240);         // fore-end
  R.add('olive', gBox(0.036, 0.012, 0.120), 0, -0.014, -0.250);                 // fore-end rail
  for (let i = 0; i < 4; i++) R.add('rubber', gBox(0.052, 0.010, 0.010), 0, 0.010, -0.190 - i * 0.030);
  barrel(R, 0.0105, -0.235, -0.585, 0.058, 'brake');
  for (let i = 0; i < 6; i++) {                                                 // flutes
    const a = i * (Math.PI / 3);
    R.add('blued', gBox(0.0035, 0.0035, 0.190), Math.sin(a) * 0.0105, 0.058 + Math.cos(a) * 0.0105, -0.330);
  }
  R.add('metal', gCyl(0.017, 0.017, 0.034, 12), 0, 0.058, -0.246, Math.PI / 2, 0, 0);   // barrel shank
  scope(R, -0.130, sy, 0.250, 0.024, 0.036);
  R.add('metal', gBox(0.030, 0.010, 0.190), 0, 0.088, -0.130);                  // scope base
  stockSkeleton(R, 0.010, 0.230, 0.040, 'olive');
  const gp = pistolGrip(R, 0, 0.008, 0.028, 0.036, 0.086, 0.050, 0.20, 'olive');
  triggerGroup(R, 0.004, 0.014);
  slingLoop(R, 0, -0.020, -0.300);
  slingLoop(R, 0, 0.002, 0.180);
  magStraight(R, 0, 0.014, -0.084, 0.036, 0.058, 0.062, 0, 'metal');
  R.part('bolt', 0.026, 0.058, -0.012);                                         // bolt handle
  R.add('metal', gCyl(0.008, 0.008, 0.040, 10), 0.044, 0.058, -0.012, 0, 0, Math.PI / 2);
  R.add('metal', gSphere(0.0105, 8, 6), 0.066, 0.058, -0.012);
  R.add('metal', gBox(0.020, 0.020, 0.030), 0.030, 0.058, -0.012);
  R.use('body');
  flashNode(R, 0, 0.058, -0.612);
  shellNode(R, 0.032, 0.060, -0.030);
  placeHands(R, {
    grip: [gp[0], gp[1] + 0.006, gp[2]], rake: 0.20, rearRoll: 0.44,
    fore: [0, -0.006, -0.256], foreRoll: 0.60, forePitch: 0.04,
  });
  return { aim: [0, sy, -0.014], pull: 0.145, cycle: 'bolt', length: 0.84, kickZ: 0.055, kickP: 0.105 };
}
/** SSG08 — slim bolt action, polymer skeleton stock, compact scope. */
function bSniperBolt(R, o) {
  const sy = 0.120;
  R.use('body');
  R.add('blued', gBevel(0.040, 0.054, 0.200, 0.008), 0, 0.048, -0.100);
  R.add('poly', gBevel(0.046, 0.044, 0.130, 0.010), 0, 0.012, -0.056);
  R.add('poly', gBevel(0.042, 0.036, 0.155, 0.012), 0, 0.006, -0.220);          // fore-end
  R.add('poly', gBox(0.030, 0.010, 0.100), 0, -0.010, -0.230);
  for (let i = 0; i < 3; i++) R.add('rubber', gBox(0.044, 0.008, 0.010), 0, 0.012, -0.180 - i * 0.034);
  barrel(R, 0.0086, -0.220, -0.520, 0.054, 'crown');
  R.add('metal', gCyl(0.014, 0.014, 0.028, 12), 0, 0.054, -0.230, Math.PI / 2, 0, 0);
  scope(R, -0.110, sy, 0.200, 0.020, 0.032);
  R.add('metal', gBox(0.026, 0.010, 0.150), 0, 0.082, -0.110);
  stockSkeleton(R, 0.008, 0.205, 0.036, 'poly');
  const gp = pistolGrip(R, 0, 0.004, 0.024, 0.034, 0.082, 0.048, 0.22, 'poly');
  triggerGroup(R, 0.000, 0.010);
  slingLoop(R, 0, -0.012, -0.276);
  magStraight(R, 0, 0.010, -0.076, 0.032, 0.052, 0.058, 0, 'blued');
  R.part('bolt', 0.024, 0.054, -0.010);
  R.add('metal', gCyl(0.0075, 0.0075, 0.036, 10), 0.040, 0.054, -0.010, 0, 0, Math.PI / 2);
  R.add('metal', gSphere(0.0095, 8, 6), 0.060, 0.054, -0.010);
  R.add('metal', gBox(0.018, 0.018, 0.028), 0.028, 0.054, -0.010);
  R.use('body');
  flashNode(R, 0, 0.054, -0.532);
  shellNode(R, 0.030, 0.056, -0.028);
  placeHands(R, {
    grip: [gp[0], gp[1] + 0.006, gp[2]], rake: 0.22, rearRoll: 0.44,
    fore: [0, -0.002, -0.232], foreRoll: 0.60, forePitch: 0.04,
  });
  return { aim: [0, sy, -0.010], pull: 0.135, cycle: 'bolt', length: 0.76, kickZ: 0.040, kickP: 0.078 };
}

/** Nova / MAG-7 — pump action. `pump` group slides on the tube / forend. */
function bShotgunPump(R, o) {
  const mag7 = o.variant === 'mag7', sy = 0.104;
  R.use('body');
  R.add('blued', gBevel(0.050, 0.072, mag7 ? 0.200 : 0.180, 0.010), 0, 0.052, -0.085);
  R.add('rubber', gBox(0.034, 0.020, 0.056), 0.026, 0.050, -0.060);             // loading/eject port
  barrel(R, 0.0125, -0.170, mag7 ? -0.380 : -0.560, 0.062, 'crown');
  if (!mag7) {
    R.add('blued', gCyl(0.0105, 0.0105, 0.300, 10), 0, 0.030, -0.310, Math.PI / 2, 0, 0);  // mag tube
    R.add('metal', gBox(0.024, 0.012, 0.020), 0, 0.044, -0.300);
    R.part('pump', 0, 0.032, -0.300);                                           // ribbed forend
    R.add('poly', gBevel(0.044, 0.048, 0.130, 0.012), 0, 0.032, -0.300);
    for (let i = 0; i < 7; i++) R.add('rubber', gBox(0.046, 0.007, 0.008), 0, 0.032, -0.246 - i * 0.017);
    R.use('body');
  } else {
    R.part('pump', 0, -0.010, -0.190);                                          // box-mag forend
    R.add('poly', gBevel(0.042, 0.100, 0.070, 0.010), 0, -0.030, -0.190);
    for (let i = 0; i < 4; i++) R.add('rubber', gBox(0.044, 0.006, 0.050), 0, -0.006 - i * 0.020, -0.190);
    R.add('poly', gBox(0.046, 0.010, 0.076), 0, -0.082, -0.190);
    R.use('body');
    rail(R, -0.180, -0.020, 0.090, 0.022, 'poly');
  }
  R.add('poly', gBox(0.030, 0.014, 0.020), 0, 0.086, -0.150);                   // bead sight base
  R.add('brass', gSphere(0.0045, 8, 6), 0, 0.098, -0.152);
  rearSight(R, -0.020, sy - 0.0165, true);
  const gp = pistolGrip(R, 0, -0.004, 0.016, 0.036, 0.084, 0.048, 0.28, 'poly');
  triggerGroup(R, -0.004, 0.004);
  if (mag7) stockTele(R, 0.048, 0.170, 0.050, 'poly');
  else stockFixed(R, 0.052, 0.210, 0.038, 'poly');
  shellNode(R, 0.032, 0.050, -0.058, 0.0088, 0.036);
  flashNode(R, 0, 0.062, mag7 ? -0.392 : -0.572);
  placeHands(R, {
    grip: [gp[0], gp[1] + 0.006, gp[2]], rake: 0.28, rearRoll: 0.42,
    fore: mag7 ? [0, -0.036, -0.192] : [0, 0.030, -0.300], foreRoll: mag7 ? 0.30 : 0.62, forePitch: 0.05,
  });
  if (mag7) R.parts.handFront.rotation.set(-0.10, 0, -Math.PI / 2 + 0.10);
  return { aim: [0, sy, -0.020], pull: 0.05, cycle: 'pump', length: mag7 ? 0.62 : 0.82, kickZ: 0.055, kickP: 0.10 };
}
/** XM1014 — semi-auto, heat-shielded barrel, ghost ring, tube magazine. */
function bShotgunAuto(R, o) {
  const sy = 0.108;
  R.use('body');
  R.add('blued', gBevel(0.050, 0.076, 0.195, 0.010), 0, 0.054, -0.090);
  R.add('rubber', gBox(0.034, 0.022, 0.060), 0.026, 0.052, -0.062);
  R.add('blued', gBox(0.014, 0.012, 0.014), 0.028, 0.024, -0.040);              // bolt release
  barrel(R, 0.0125, -0.180, -0.500, 0.064, 'crown');
  vents(R, 0.036, 0.034, -0.210, -0.420, 0.064, 'blued', 1);                    // heat shield
  R.add('blued', gCyl(0.0115, 0.0115, 0.250, 10), 0, 0.032, -0.290, Math.PI / 2, 0, 0);  // mag tube
  R.add('poly', gBevel(0.046, 0.046, 0.120, 0.012), 0, 0.030, -0.250);          // forend
  for (let i = 0; i < 6; i++) R.add('rubber', gBox(0.048, 0.006, 0.008), 0, 0.030, -0.204 - i * 0.017);
  R.add('blued', gBox(0.026, 0.016, 0.018), 0, 0.090, -0.430);
  R.add('blued', gBox(0.006, 0.020, 0.008), 0, 0.104, -0.432);
  R.add('blued', gCyl(0.011, 0.011, 0.010, 10, true), 0, sy, -0.030, Math.PI / 2, 0, 0); // ghost ring
  R.add('blued', gBox(0.024, 0.010, 0.016), 0, sy - 0.015, -0.030);
  const gp = pistolGrip(R, 0, -0.004, 0.018, 0.036, 0.086, 0.050, 0.28, 'poly');
  triggerGroup(R, -0.004, 0.004);
  stockFixed(R, 0.056, 0.205, 0.040, 'poly');
  slingLoop(R, 0.018, 0.024, -0.300);
  shellNode(R, 0.032, 0.052, -0.060, 0.0088, 0.036);
  flashNode(R, 0, 0.064, -0.512);
  R.part('bolt', 0.028, 0.056, -0.030);
  R.add('metal', gBox(0.014, 0.014, 0.030), 0.028, 0.056, -0.030);
  R.use('body');
  placeHands(R, {
    grip: [gp[0], gp[1] + 0.006, gp[2]], rake: 0.28, rearRoll: 0.42,
    fore: [0, 0.028, -0.252], foreRoll: 0.62, forePitch: 0.05,
  });
  return { aim: [0, sy, -0.030], pull: 0.05, cycle: 'auto', length: 0.80, kickZ: 0.048, kickP: 0.092 };
}

/** Negev — belt-fed LMG: top cover, feed tray, drum box, folded bipod. */
function bLMG(R, o) {
  const sy = 0.116;
  R.use('body');
  R.add('blued', gBevel(0.056, 0.086, 0.290, 0.010), 0, 0.056, -0.110);         // receiver
  R.add('blued', gBevel(0.058, 0.026, 0.200, 0.008), 0, 0.100, -0.130);         // top cover
  rail(R, -0.220, -0.030, 0.114, 0.024);
  R.add('metal', gBevel(0.030, 0.024, 0.090, 0.006), 0, 0.100, 0.010, 0, 0, 0.5); // carry handle
  R.add('rubber', gBox(0.036, 0.026, 0.070), 0.030, 0.058, -0.070);             // feed / eject
  R.add('poly', gBevel(0.062, 0.100, 0.110, 0.012), 0, -0.032, -0.100);         // ammo box
  R.add('tape', gBox(0.064, 0.030, 0.070), 0, 0.006, -0.100);
  for (let i = 0; i < 5; i++) R.add('brass', gBox(0.008, 0.015, 0.008), -0.031, 0.030 - i * 0.007, -0.070 - i * 0.006, 0.30, 0, 0);
  vents(R, 0.044, 0.040, -0.250, -0.400, 0.066, 'blued', 2);                    // barrel shroud
  barrel(R, 0.0095, -0.240, -0.520, 0.066, 'a2');
  R.add('metal', gBevel(0.026, 0.040, 0.024, 0.005), 0, 0.086, -0.396);
  frontSight(R, -0.396, sy - 0.038);
  rearSight(R, -0.030, sy - 0.0165, true);
  R.add('poly', gBevel(0.040, 0.036, 0.110, 0.010), 0, 0.010, -0.300);          // handguard
  for (let s = -1; s <= 1; s += 2) {                                            // folded bipod legs
    R.add('metal', gBox(0.008, 0.008, 0.150), s * 0.016, -0.006, -0.330, 0.10, 0, 0);
    R.add('metal', gBox(0.012, 0.012, 0.016), s * 0.016, -0.012, -0.404);
  }
  const gp = pistolGrip(R, 0, -0.006, 0.030, 0.038, 0.088, 0.052, 0.26, 'poly');
  triggerGroup(R, -0.006, 0.010);
  stockTele(R, 0.070, 0.180, 0.056, 'poly');
  slingLoop(R, 0.022, 0.028, -0.320);
  R.part('bolt', 0.032, 0.062, -0.020);
  R.add('metal', gBox(0.014, 0.014, 0.056), 0.032, 0.062, -0.020);
  R.add('metal', gBox(0.020, 0.018, 0.016), 0.034, 0.062, 0.010);
  R.part('mag', 0, 0.010, -0.100);
  R.add('poly', gBox(0.058, 0.016, 0.096), 0, 0.012, -0.100);                   // box lid = "mag"
  R.use('body');
  flashNode(R, 0, 0.066, -0.548);
  shellNode(R, 0.034, 0.056, -0.070);
  placeHands(R, {
    grip: [gp[0], gp[1] + 0.006, gp[2]], rake: 0.26, rearRoll: 0.42,
    fore: [0, 0.012, -0.302], foreRoll: 0.62, forePitch: 0.05,
  });
  return { aim: [0, sy, -0.030], pull: 0.05, cycle: 'auto', length: 0.86, kickZ: 0.026, kickP: 0.048 };
}
/** MP5 / MP9 / MAC-10 — tubular or stamped SMG receivers. */
function bSMG(R, o) {
  const mp5 = o.variant === 'mp5', mac = o.variant === 'mac10', sy = 0.086;
  R.use('body');
  if (mp5) {
    R.add('blued', gCyl(0.021, 0.021, 0.215, 14), 0, 0.048, -0.100, Math.PI / 2, 0, 0);
    R.add('blued', gBevel(0.038, 0.030, 0.150, 0.008), 0, 0.026, -0.070);       // trigger housing top
    R.add('blued', gCyl(0.024, 0.024, 0.030, 14), 0, 0.048, -0.208, Math.PI / 2, 0, 0);
    R.add('poly', gBevel(0.040, 0.038, 0.120, 0.010), 0, 0.030, -0.250);        // handguard
    for (let i = 0; i < 5; i++) R.add('rubber', gBox(0.042, 0.006, 0.008), 0, 0.030, -0.204 - i * 0.019);
    barrel(R, 0.0068, -0.210, -0.330, 0.048, 'thread');
    R.add('blued', gCyl(0.014, 0.014, 0.016, 12), 0, 0.048, -0.322, Math.PI / 2, 0, 0);
    R.add('blued', gCyl(0.016, 0.016, 0.024, 12, true), 0, sy, -0.030, Math.PI / 2, 0, 0);  // drum rear sight
    R.add('blued', gBox(0.026, 0.014, 0.020), 0, sy - 0.020, -0.030);
    frontSight(R, -0.300, sy - 0.038);
    stockTele(R, 0.042, 0.165, 0.048, 'poly');
    R.part('bolt', -0.026, 0.062, -0.235);                                      // cocking handle
    R.add('metal', gBox(0.012, 0.011, 0.070), -0.026, 0.062, -0.235);
    R.add('metal', gBox(0.016, 0.015, 0.016), -0.028, 0.062, -0.272);
    R.use('body');
    magCurved(R, 0, 0.010, -0.086, 0.030, 0.115, 0.048, 0.055, 'poly');
  } else {
    const bw = mac ? 0.044 : 0.042;
    R.add('poly', gBevel(bw, 0.062, mac ? 0.170 : 0.185, 0.006), 0, 0.046, -0.075);
    R.add('poly', gBevel(bw * 0.9, 0.034, 0.070, 0.006), 0, 0.078, -0.030);
    rail(R, -0.140, -0.010, mac ? 0.078 : 0.080, 0.020, 'poly');
    R.add('rubber', gBox(0.030, 0.018, 0.044), 0.023, 0.052, -0.050);
    barrel(R, 0.0062, -0.150, mac ? -0.250 : -0.290, 0.046, 'thread');
    if (!mac) {
      R.add('poly', gBevel(0.034, 0.032, 0.100, 0.008), 0, 0.024, -0.210);      // handguard
      for (let i = 0; i < 4; i++) R.add('rubber', gBox(0.036, 0.006, 0.008), 0, 0.024, -0.172 - i * 0.020);
    } else {
      R.add('metal', gCyl(0.013, 0.013, 0.060, 10), 0, 0.046, -0.200, Math.PI / 2, 0, 0);
      R.add('rubber', gBox(0.024, 0.006, 0.050), 0, 0.032, -0.200);             // strap-like foregrip
    }
    frontSight(R, mac ? -0.230 : -0.270, sy - 0.038);
    rearSight(R, -0.020, sy - 0.0165, true);
    stockTele(R, 0.030, mac ? 0.130 : 0.150, 0.046, 'poly');
    R.part('bolt', mac ? 0 : -0.024, mac ? 0.082 : 0.058, mac ? -0.030 : -0.130);
    R.add('metal', gBox(0.013, 0.012, mac ? 0.030 : 0.060), mac ? 0 : -0.024, mac ? 0.082 : 0.058, mac ? -0.030 : -0.130);
    R.use('body');
    magStraight(R, 0, 0.010, mac ? -0.030 : -0.070, 0.028, 0.115, 0.044, mac ? 0 : 0.05, 'poly');
  }
  const gp = pistolGrip(R, 0, -0.006, mac ? 0.030 : 0.010, 0.032, 0.076, 0.044, 0.24, 'poly');
  triggerGroup(R, -0.008, 0.000);
  slingLoop(R, 0.016, 0.020, -0.230);
  flashNode(R, 0, 0.047, mp5 ? -0.342 : mac ? -0.262 : -0.302);
  shellNode(R, 0.030, 0.052, -0.050);
  placeHands(R, {
    grip: [gp[0], gp[1] + 0.006, gp[2]], rake: 0.24, rearRoll: 0.40,
    fore: [0, mp5 ? 0.028 : 0.022, mp5 ? -0.252 : mac ? -0.200 : -0.212], foreRoll: 0.60, forePitch: 0.06,
  });
  return { aim: [0, sy, -0.028], pull: 0.05, cycle: 'auto', length: mp5 ? 0.60 : 0.52, kickZ: 0.018, kickP: 0.034 };
}
/** UMP-45 / P90 — boxy polymer SMGs (P90 gets the horizontal top magazine). */
function bSMGBoxy(R, o) {
  const p90 = o.variant === 'p90', sy = p90 ? 0.100 : 0.090;
  R.use('body');
  if (p90) {
    R.add('poly', gBevel(0.052, 0.076, 0.320, 0.016), 0, 0.040, -0.110);        // one-piece shell
    R.add('poly', gBevel(0.056, 0.030, 0.110, 0.012), 0, 0.070, 0.020);         // cheek / butt
    R.add('rubber', gBevel(0.050, 0.062, 0.012, 0.006), 0, 0.048, 0.078);
    R.part('mag', 0, 0.084, -0.170);                                            // top magazine
    R.add('glass', gBevel(0.042, 0.024, 0.200, 0.008), 0, 0.086, -0.170);
    for (let i = 0; i < 7; i++) R.add('brass', gBox(0.030, 0.007, 0.007), 0, 0.078, -0.078 - i * 0.024);
    R.use('body');
    R.add('poly', gBox(0.046, 0.014, 0.070), 0, 0.100, -0.032);                 // rear of mag well
    R.add('poly', gBevel(0.030, 0.056, 0.046, 0.010), 0, -0.026, -0.196);       // front grip loop
    R.add('poly', gBox(0.034, 0.012, 0.052), 0, -0.056, -0.196);
    R.add('rubber', gBox(0.032, 0.020, 0.044), 0.026, 0.026, -0.060);           // ejection (downward)
    barrel(R, 0.0060, -0.240, -0.360, 0.048, 'thread');
    R.add('poly', gCyl(0.016, 0.016, 0.030, 12), 0, 0.048, -0.256, Math.PI / 2, 0, 0);
    R.add('poly', gBox(0.040, 0.030, 0.070), 0, 0.104, -0.240);                 // ring sight housing
    R.add('blued', gCyl(0.013, 0.013, 0.008, 12, true), 0, sy + 0.008, -0.252, Math.PI / 2, 0, 0);
    R.add('blued', gBox(0.006, 0.016, 0.008), 0, sy - 0.004, -0.208);
    R.part('bolt', -0.026, 0.062, -0.150);
    R.add('metal', gBox(0.012, 0.010, 0.050), -0.026, 0.062, -0.150);
    R.use('body');
  } else {
    R.add('poly', gBevel(0.046, 0.070, 0.230, 0.010), 0, 0.048, -0.095);        // upper
    R.add('poly', gBevel(0.044, 0.040, 0.140, 0.008), 0, 0.006, -0.050);        // lower
    rail(R, -0.190, -0.010, 0.086, 0.022, 'poly');
    R.add('rubber', gBox(0.032, 0.020, 0.050), 0.024, 0.054, -0.060);
    barrel(R, 0.0072, -0.200, -0.330, 0.050, 'thread');
    R.add('poly', gBevel(0.040, 0.038, 0.110, 0.010), 0, 0.024, -0.240);
    for (let i = 0; i < 4; i++) R.add('rubber', gBox(0.042, 0.006, 0.008), 0, 0.024, -0.198 - i * 0.022);
    frontSight(R, -0.300, sy - 0.038);
    rearSight(R, -0.020, sy - 0.0165, true);
    stockTele(R, 0.040, 0.170, 0.050, 'poly');
    R.part('bolt', -0.026, 0.060, -0.140);
    R.add('metal', gBox(0.012, 0.011, 0.060), -0.026, 0.060, -0.140);
    R.add('metal', gBox(0.016, 0.014, 0.016), -0.028, 0.060, -0.176);
    R.use('body');
    magStraight(R, 0, 0.006, -0.062, 0.032, 0.110, 0.052, 0.06, 'poly');
  }
  const gp = pistolGrip(R, 0, -0.006, p90 ? 0.006 : 0.008, 0.034, 0.078, 0.046, 0.26, 'poly');
  triggerGroup(R, -0.008, 0.000);
  slingLoop(R, 0.018, 0.018, -0.240);
  flashNode(R, 0, p90 ? 0.048 : 0.050, p90 ? -0.372 : -0.342);
  shellNode(R, 0.030, p90 ? 0.026 : 0.054, -0.060);
  placeHands(R, {
    grip: [gp[0], gp[1] + 0.006, gp[2]], rake: 0.26, rearRoll: 0.40,
    fore: p90 ? [0, -0.030, -0.198] : [0, 0.022, -0.242], foreRoll: p90 ? 0.30 : 0.60, forePitch: p90 ? -0.05 : 0.06,
  });
  if (p90) R.parts.handFront.rotation.set(-0.10, 0, -Math.PI / 2 + 0.10);
  return { aim: [0, sy + (p90 ? 0.008 : 0), p90 ? -0.252 : -0.020], pull: 0.05, cycle: 'auto', length: p90 ? 0.58 : 0.62, kickZ: 0.020, kickP: 0.036 };
}
/** One handgun. `sfx` suffixes the animated part names (dual elites). */
function pistolBody(R, o, X, mir, sfx, k) {
  const big = !!k.big, sil = !!k.sil, sy = big ? 0.060 : 0.053;
  const sl = 'slide' + sfx, mg = 'mag' + sfx;
  const sw = big ? 0.030 : 0.026, sh = big ? 0.036 : 0.030, slen = big ? 0.160 : 0.135;
  const bz = -(slen + 0.010);
  R.use('body');
  R.add('poly', gBevel(0.026, 0.034, 0.115, 0.006), X, -0.004, -0.040);          // frame
  R.add('poly', gBox(0.028, 0.016, 0.040), X, 0.004, -0.006);                    // frame rear / beavertail
  R.add('poly', gBox(0.030, 0.010, 0.028), X, 0.010, 0.020, -0.25, 0, 0);
  R.add('blued', gBox(0.006, 0.010, 0.024), X + mir * 0.014, 0.004, -0.010);      // slide stop
  R.add('blued', gBox(0.005, 0.012, 0.012), X + mir * 0.015, -0.004, 0.006);      // safety
  if (k.longMag) R.add('poly', gBevel(0.026, 0.100, 0.040, 0.005), X, -0.070, -0.060, 0.10, 0, 0);
  // slide + sights + barrel (cycles on fire)
  R.part(sl, X, 0.026, -0.042);
  R.add('metal', gBevel(sw, sh, slen, 0.005), X, 0.026, -0.042);
  R.add('metal', gBevel(sw * 0.7, sh * 0.5, slen * 0.35, 0.004), X, 0.026 + sh * 0.34, -0.042 - slen * 0.3);
  for (let i = 0; i < 7; i++) R.add('blued', gBox(sw * 1.02, sh * 0.8, 0.0035), X, 0.026, 0.014 - i * 0.0075);
  R.add('rubber', gBox(sw * 0.9, sh * 0.42, 0.036), X + mir * sw * 0.5, 0.030, -0.024);  // ejection port
  R.add('blued', gBox(0.0055, 0.011, 0.007), X, 0.026 + sh / 2 + 0.005, bz + 0.016);     // front blade
  R.add('blued', gBox(0.020, 0.010, 0.010), X, 0.026 + sh / 2 + 0.004, 0.014);
  R.add('blued', gBox(0.006, 0.011, 0.010), X - 0.007, 0.026 + sh / 2 + 0.008, 0.014);
  R.add('blued', gBox(0.006, 0.011, 0.010), X + 0.007, 0.026 + sh / 2 + 0.008, 0.014);
  R.add('steel', gCyl(0.0075, 0.0075, 0.020, 10), X, 0.024, bz + 0.006, Math.PI / 2, 0, 0);
  R.add('rubber', gCyl(0.0042, 0.0042, 0.012, 8), X, 0.024, bz + 0.008, Math.PI / 2, 0, 0);
  if (big) {
    R.add('metal', gBox(0.011, 0.008, slen * 0.8), X, 0.026 + sh / 2, -0.050);   // barrel rib
    for (let i = 0; i < 5; i++) R.add('blued', gBox(0.013, 0.010, 0.005), X, 0.026 + sh / 2 + 0.003, -0.020 - i * 0.018);
  }
  R.use('body');
  return { sy, bz, sl, mg, sw, sh, slen };
}
/** Glock / P250 / Tec-9 / Five-SeveN / Dual Berettas / Desert Eagle / USP-S. */
function bPistol(R, o) {
  const v = o.variant, dual = v === 'dualies', big = v === 'deagle', sil = v === 'usp';
  const tec = v === 'tec9';
  const k = { big, sil, longMag: tec };
  const A = pistolBody(R, o, 0, 1, '', k);
  const gy = -0.006, gz = 0.012;
  const gp = pistolGrip(R, 0, gy, gz, big ? 0.032 : 0.030, big ? 0.086 : 0.078, 0.044, 0.30, 'poly');
  // trigger group + hammer
  R.add('poly', gBox(0.014, 0.006, 0.044), 0, -0.036, -0.014);
  R.add('poly', gBox(0.014, 0.020, 0.006), 0, -0.026, -0.036);
  R.part('trigger', 0, -0.014, -0.018);
  R.add('blued', gBox(0.007, 0.022, 0.007), 0, -0.024, -0.018, 0.10, 0, 0);
  R.part('hammer', 0, 0.014, 0.018);
  R.add('blued', gBox(0.008, 0.018, 0.008), 0, 0.022, 0.020, -0.20, 0, 0);
  R.add('blued', gBox(0.010, 0.008, 0.010), 0, 0.030, 0.024);
  R.use('body');
  magStraight(R, 0, gy - 0.004, gz - 0.010, 0.024, 0.086, 0.036, -0.30, 'blued');
  if (tec) barrel(R, 0.0062, -0.150, -0.230, 0.024, 'thread');
  if (tec) vents(R, 0.024, 0.022, -0.150, -0.226, 0.024, 'poly', 1);
  if (sil) suppressor(R, 0.0155, -0.148, -0.278, 0.024);
  const mz = sil ? -0.286 : tec ? -0.240 : A.bz - 0.004;
  flashNode(R, 0, 0.024, mz);
  shellNode(R, 0.020, 0.032, -0.024, 0.0042, 0.016);
  if (dual) {
    const B = pistolBody(R, o, -0.300, -1, '2', k);
    pistolGrip(R, -0.300, gy, gz, 0.030, 0.078, 0.044, 0.30, 'poly');
    R.add('poly', gBox(0.014, 0.006, 0.044), -0.300, -0.036, -0.014);
    R.add('poly', gBox(0.014, 0.020, 0.006), -0.300, -0.026, -0.036);
    R.add('blued', gBox(0.007, 0.022, 0.007), -0.300, -0.024, -0.018, 0.10, 0, 0);
    magStraight(R, -0.300, gy - 0.004, gz - 0.010, 0.024, 0.086, 0.036, -0.30, 'blued');
    R.parts.mag2 = R.parts.mag; delete R.parts.mag;
    magStraight(R, 0, gy - 0.004, gz - 0.010, 0.024, 0.086, 0.036, -0.30, 'blued');
    flashNode(R, -0.300, 0.024, B.bz - 0.004);
    R.parts.muzzle2 = R.parts.muzzle; delete R.parts.muzzle;
    flashNode(R, 0, 0.024, A.bz - 0.004);
    R.part('hands', 0, 0, 0);
    const rr = hand(R, 'handRear', 1, 'grip', 0.40);
    rr.position.set(gp[0], gp[1] + 0.006, gp[2]);
    rr.rotation.set(-0.30, 0.0, -Math.PI / 2);
    const lr = hand(R, 'handFront', -1, 'grip', -0.40);
    lr.position.set(-0.300, gp[1] + 0.006, gp[2]);
    lr.rotation.set(-0.30, 0.0, Math.PI / 2);
    R.use('body');
  } else {
    R.part('hands', 0, 0, 0);
    const rr = hand(R, 'handRear', 1, 'grip', 0.40);
    rr.position.set(gp[0], gp[1] + 0.006, gp[2]);
    rr.rotation.set(-0.30, 0.0, -Math.PI / 2);
    const lr = hand(R, 'handFront', -1, 'open', 0.10);      // support hand cupped underneath
    lr.position.set(-0.016, gp[1] - 0.030, gp[2] + 0.004);
    lr.rotation.set(-0.30, -0.35, -Math.PI / 2 + 0.55);
    R.use('body');
  }
  return {
    aim: [0, A.sy, 0.014], pull: 0.06, cycle: 'auto', length: big ? 0.30 : sil ? 0.34 : 0.26,
    kickZ: big ? 0.030 : 0.016, kickP: big ? 0.075 : 0.038, slideTravel: big ? 0.028 : 0.022,
  };
}
// --- extra builders ---

/** Combat bayonet: grip, guard, clip-point blade with a serrated spine. */
function bKnife(R, o) {
  R.use('body');
  R.add('rubber', gBevel(0.020, 0.026, 0.098, 0.006), 0, 0, 0.046);            // grip
  for (let i = 0; i < 5; i++) R.add('poly', gBox(0.022, 0.004, 0.006), 0, -0.014, 0.014 + i * 0.017);
  R.add('blued', gBox(0.030, 0.010, 0.014), 0, 0.002, -0.006);                 // guard
  R.add('metal', gTaper(0.030, 0.008, 0.150, 0.25, 0.9), 0, 0.004, -0.086);
  for (let i = 0; i < 9; i++) R.add('metal', gBox(0.004, 0.006, 0.005), 0.006, 0.016, -0.030 - i * 0.013);
  R.add('metal', gCyl(0.004, 0.004, 0.010, 8), 0, 0.002, 0.094, 0, 0, Math.PI / 2);
  R.part('hands', 0, 0, 0);
  const rr = hand(R, 'handRear', 1, 'grip', 0.35);
  rr.position.set(0.004, -0.004, 0.048);
  rr.rotation.set(-0.55, 0.1, -Math.PI / 2);
  R.use('body');
  return { aim: [0, 0.01, 0.02], pull: 0.02, cycle: 'none', length: 0.24, kickZ: 0.02, kickP: 0.02, slideTravel: 0 };
}

/** Hand grenades — body shape and colour per type. */
function bGrenade(R, o) {
  const v = o.variant;
  R.use('body');
  if (v === 'molotov' || v === 'incendiary') {
    R.add('glass', gLathe([[0.001, -0.055], [0.030, -0.050], [0.034, 0.010], [0.030, 0.040], [0.013, 0.055], [0.012, 0.072]], 14), 0, 0.004, 0);
    R.add('fire', gCyl(0.026, 0.028, 0.070, 12), 0, -0.014, 0);
    R.add('tan', gBox(0.016, 0.052, 0.016), 0, 0.086, 0, 0.2, 0, 0.15);
    R.add('flash', gSphere(0.020, 8, 6), 0, 0.108, 0);
  } else if (v === 'smoke' || v === 'decoy') {
    R.add(v === 'decoy' ? 'nadeGrey' : 'nadeOlive', gCyl(0.030, 0.030, 0.104, 14), 0, 0.006, 0);
    R.add('nadeGrey', gCyl(0.0305, 0.0305, 0.012, 14), 0, 0.034, 0);
    R.add('metal', gCyl(0.012, 0.012, 0.016, 10), 0, 0.062, 0);
    R.add('metal', gBox(0.006, 0.038, 0.010), 0.016, 0.050, 0, 0, 0, 0.18);
  } else if (v === 'flash') {
    R.add('polyLt', gCyl(0.028, 0.030, 0.092, 14), 0, 0.004, 0);
    R.add('ledRed', gCyl(0.0305, 0.0305, 0.010, 14), 0, 0.028, 0);
    R.add('metal', gCyl(0.011, 0.011, 0.018, 10), 0, 0.056, 0);
    R.add('metal', gBox(0.006, 0.036, 0.010), 0.015, 0.046, 0, 0, 0, 0.18);
  } else {
    R.add('olive', gSphere(0.036, 12, 9), 0, 0.006, 0, 0, 0, 0, 1, 1.18, 1);   // HE body
    for (let i = 0; i < 4; i++) R.add('blued', gCyl(0.0368, 0.0368, 0.004, 14), 0, -0.012 + i * 0.014, 0);
    R.add('metal', gCyl(0.012, 0.012, 0.020, 10), 0, 0.052, 0);
    R.add('metal', gBox(0.006, 0.040, 0.010), 0.016, 0.042, 0, 0, 0, 0.18);
    R.add('metal', gCyl(0.008, 0.008, 0.003, 8), 0.024, 0.062, 0, Math.PI / 2, 0, 0);
  }
  R.part('hands', 0, 0, 0);
  const rr = hand(R, 'handRear', 1, 'grip', 0.2);
  rr.position.set(0.004, -0.010, 0.006);
  rr.rotation.set(-0.9, 0.15, -Math.PI / 2);
  R.use('body');
  return { aim: [0, 0.02, 0.02], pull: 0.02, cycle: 'none', length: 0.16, kickZ: 0.01, kickP: 0.01, slideTravel: 0 };
}

/** C4 satchel: taped blocks, wiring harness and a lit keypad. */
function bC4(R, o) {
  R.use('body');
  for (let i = 0; i < 4; i++) {
    R.add('explosive', gBevel(0.052, 0.040, 0.104, 0.004), -0.028 + (i % 2) * 0.056, -0.006 + Math.floor(i / 2) * 0.042, 0);
  }
  R.add('tape', gBox(0.120, 0.012, 0.108), 0, 0.014, 0);
  R.add('tape', gBox(0.118, 0.086, 0.012), 0, -0.004, 0.050);
  R.add('poly', gBevel(0.062, 0.044, 0.014, 0.003), 0, 0.048, -0.010);
  R.add('keypad', new THREE.PlaneGeometry(0.052, 0.034), 0, 0.071, -0.010, -Math.PI / 2, 0, 0);
  R.add('ledRed', gSphere(0.004, 6, 5), 0.026, 0.070, 0.014);
  for (const [x, m] of [[-0.02, 'wireRed'], [0, 'wireGreen'], [0.02, 'wireYellow']]) {
    R.add(m, gCyl(0.0022, 0.0022, 0.058, 6), x, 0.040, 0.028, 0.5, 0, 0);
  }
  R.add('metal', gCyl(0.010, 0.010, 0.026, 8), -0.040, 0.036, 0.030, Math.PI / 2, 0, 0);
  R.part('hands', 0, 0, 0);
  const rr = hand(R, 'handRear', 1, 'open', 0.1);
  rr.position.set(0.052, -0.030, 0.030);
  rr.rotation.set(-1.1, 0.2, -Math.PI / 2);
  const lr = hand(R, 'handFront', -1, 'open', -0.1);
  lr.position.set(-0.052, -0.030, 0.030);
  lr.rotation.set(-1.1, -0.2, Math.PI / 2);
  R.use('body');
  return { aim: [0, 0.02, 0.02], pull: 0, cycle: 'none', length: 0.2, kickZ: 0, kickP: 0, slideTravel: 0 };
}

/** Gear (armour, helmet, kit) — a small carried prop, never a weapon. */
function bGear(R, o) {
  R.use('body');
  if (o.variant === 'defusekit') {
    R.add('poly', gBevel(0.10, 0.062, 0.048, 0.005), 0, 0, 0);
    R.add('ledGreen', gSphere(0.005, 6, 5), 0.03, 0.032, -0.010);
    R.add('wireRed', gCyl(0.002, 0.002, 0.05, 6), -0.02, 0.030, 0, 0.6, 0, 0);
    R.add('metal', gBox(0.012, 0.008, 0.030), 0.038, 0.010, 0.020);
  } else {
    R.add('tan', gBevel(0.15, 0.19, 0.06, 0.012), 0, 0, 0);
    R.add('poly', gBox(0.05, 0.05, 0.014), 0, 0.02, -0.036);
    if (o.variant === 'kevlarhelmet') R.add('olive', gSphere(0.072, 12, 8), 0, 0.14, 0, 0, 0, 0, 1, 0.8, 1.1);
  }
  return { aim: [0, 0, 0], pull: 0, cycle: 'none', length: 0.2, kickZ: 0, kickP: 0, slideTravel: 0 };
}

/** weaponId → viewmodel archetype (VM_ARCHETYPES in core/api.js). */
export const WEAPON_VM_ARCHETYPE = {
  knife: 'knife', c4: 'c4',
  glock: 'pistol', usp: 'pistol_silenced', p250: 'pistol', deagle: 'pistol_big',
  tec9: 'pistol', fiveseven: 'pistol', dualies: 'pistol',
  mac10: 'smg_boxy', mp9: 'smg', mp5: 'smg', ump45: 'smg_boxy', p90: 'smg',
  galil: 'rifle_ak', famas: 'rifle_m4', ak47: 'rifle_ak', m4a4: 'rifle_m4',
  m4a1s: 'rifle_m4', aug: 'rifle_bullpup', sg553: 'rifle_bullpup',
  ssg08: 'sniper_bolt', awp: 'sniper_awp',
  nova: 'shotgun_pump', xm1014: 'shotgun_auto', mag7: 'shotgun_pump', negev: 'lmg',
  he: 'grenade', flash: 'grenade', smoke: 'grenade', molotov: 'grenade',
  incendiary: 'grenade', decoy: 'grenade',
  kevlar: 'gear', kevlarhelmet: 'gear', defusekit: 'gear',
};

const BUILDERS = {
  rifle_ak: bRifleAK, rifle_m4: bRifleM4, rifle_bullpup: bBullpup,
  sniper_awp: bSniperAWP, sniper_bolt: bSniperBolt,
  shotgun_pump: bShotgunPump, shotgun_auto: bShotgunAuto, lmg: bLMG,
  smg: bSMG, smg_boxy: bSMGBoxy,
  pistol: bPistol, pistol_big: bPistol, pistol_silenced: bPistol,
  knife: bKnife, grenade: bGrenade, c4: bC4, gear: bGear,
};

/**
 * Build one weapon.
 * @param {string} weaponId  any id from core/api.js WEAPON_IDS
 * @param {{team?:string, world?:boolean, shadows?:boolean}} [opts]
 * @returns {{group:THREE.Group, parts:Object, muzzleNode:THREE.Object3D|null,
 *            gripNode:THREE.Object3D|null, stats:Object, dispose:Function}}
 */
export function buildWeaponModel(weaponId, opts = {}) {
  const id = WEAPON_VM_ARCHETYPE[weaponId] ? weaponId : 'knife';
  const arch = WEAPON_VM_ARCHETYPE[id];
  const M = weaponMats(opts.team || 'T');
  const R = new Rig(M);
  const owned = [];
  const stats = (BUILDERS[arch] || bGear)(R, { variant: id, archetype: arch, team: opts.team || 'T', world: !!opts.world });
  const group = R.bake(owned, !!opts.world || !!opts.shadows);
  group.name = `wm_${id}`;
  const parts = R.parts;
  if (opts.world) {
    // a dropped weapon lies flat on the ground, barrel along +X
    if (parts.hands) parts.hands.visible = false;
    group.rotation.set(0, Math.PI / 2, Math.PI / 2 * 0.02);
    const holder = new THREE.Group();
    holder.add(group);
    holder.name = `world_${id}`;
    return {
      group: holder, parts, muzzleNode: parts.muzzle || null, gripNode: parts.grip || null,
      stats: { ...stats, archetype: arch },
      dispose: () => { for (const g of owned) g.dispose(); },
    };
  }
  return {
    group, parts, muzzleNode: parts.muzzle || null, gripNode: parts.grip || null,
    stats: { ...stats, archetype: arch },
    dispose: () => { for (const g of owned) g.dispose(); },
  };
}

/** Static world model for a gun lying on the ground / held by a character. */
export function buildWorldWeapon(weaponId, opts = {}) {
  return buildWeaponModel(weaponId, { ...opts, world: true }).group;
}

// ---------------------------------------------------------------------------
// ViewModel — the first-person weapon, rendered as an overlay pass.
// ---------------------------------------------------------------------------
const REST = { x: 0.175, y: -0.195, z: -0.44 };

export class ViewModel {
  constructor(opts = {}) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(opts.fov ?? 68, opts.aspect ?? 16 / 9, 0.008, 6);
    const key = new THREE.DirectionalLight(0xfff2dc, 2.5);
    key.position.set(0.6, 1.0, 0.4);
    const fill = new THREE.HemisphereLight(0xb9d0ea, 0x2a2622, 1.15);
    const rim = new THREE.DirectionalLight(0x9fc0ff, 1.1);
    rim.position.set(-0.8, 0.2, -1);
    this.scene.add(key, fill, rim);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.team = opts.team || 'T';
    this.model = null;
    this.parts = {};
    this.stats = null;
    this.weaponId = null;
    this.visible = true;
    this.t = 0;
    this.bob = 0;
    this.sway = { x: 0, y: 0, vx: 0, vy: 0 };
    this.kick = { z: 0, p: 0, vz: 0, vp: 0, r: 0, vr: 0 };
    this.ads = 0;
    this.lower = 0;
    this.deployT = 0;
    this.inspectT = 0;
    this.reloadT = 0;
    this.reloadDur = 0;
    this.reloadType = 'mag';
    this.slide = 0;
    this.flashT = 0;
    this.shellT = 0;
    this.landDip = 0;
    this._wasGround = true;
    this._v = new THREE.Vector3();
  }

  resize(aspect) {
    this.camera.aspect = aspect || 16 / 9;
    this.camera.updateProjectionMatrix();
    return this;
  }

  setVisible(v) { this.visible = !!v; this.root.visible = !!v; return this; }

  /** Swap the held weapon and play the deploy animation. */
  setWeapon(weaponId, opts = {}) {
    if (opts.team) this.team = opts.team;
    if (this.model) {
      this.root.remove(this.model.group);
      this.model.dispose?.();
    }
    this.model = buildWeaponModel(weaponId, { team: this.team });
    this.parts = this.model.parts;
    this.stats = this.model.stats;
    this.weaponId = weaponId;
    this.root.add(this.model.group);
    this.deployT = 0.42;
    this.reloadT = 0;
    this.inspectT = 0;
    this.slide = 0;
    this.kick.z = this.kick.p = this.kick.r = 0;
    this.kick.vz = this.kick.vp = this.kick.vr = 0;
    if (this.parts.muzzle) this.parts.muzzle.visible = false;
    if (this.parts.shell) this.parts.shell.visible = false;
    return this;
  }

  deploy() { this.deployT = 0.42; return this; }
  holster() { this.deployT = -0.25; return this; }
  inspect() { if (this.inspectT <= 0) this.inspectT = 1.5; return this; }
  setADS(on, t) { this._adsWant = on ? 1 : 0; if (t !== undefined) this.ads = t; return this; }

  /** Recoil impulse + mechanical cycle for one shot. */
  fire(kick = 1) {
    const st = this.stats || {};
    this.kick.vz += (st.kickZ ?? 0.022) * 42 * kick;
    this.kick.vp += (st.kickP ?? 0.05) * 34 * kick;
    this.kick.vr += rand(-1, 1) * 9 * kick;
    this.slide = 1;
    this.flashT = 0.045;
    this.shellT = 0.16;
    if (this.parts.muzzle) {
      this.parts.muzzle.visible = true;
      this.parts.muzzle.rotation.z = Math.random() * Math.PI;
      const l = this.parts.muzzle.userData.light;
      if (l) l.intensity = 3.2 * kick;
    }
    if (this.parts.shell) this.parts.shell.visible = true;
    if (this.parts.hammer) this.parts.hammer.rotation.x = -0.5;
    return this;
  }

  /** Full reload choreography, stretched to exactly `duration` seconds. */
  reload(duration = 2.4, type = 'mag') {
    this.reloadT = duration;
    this.reloadDur = duration;
    this.reloadType = type;
    this.inspectT = 0;
    return this;
  }

  /** World-space muzzle position (for tracers and muzzle flash in the world). */
  muzzleWorld(out) {
    const n = this.parts.muzzle;
    if (!n) return out.set(0, 0, 0);
    n.updateWorldMatrix(true, false);
    out.setFromMatrixPosition(n.matrixWorld);
    // the overlay camera sits at the origin looking down −Z, matching the view
    return out;
  }

  /**
   * @param {number} dt
   * @param {{moveSpeed?:number,crouch?:number,onGround?:boolean,walking?:boolean,
   *          sprinting?:boolean,yawDelta?:number,pitchDelta?:number,ads?:number,
   *          reloading?:boolean,health?:number}} s
   */
  update(dt, s = {}) {
    if (!this.model) return this;
    dt = Math.min(dt, 0.05);
    this.t += dt;
    const P = this.parts, st = this.stats || {};

    // --- aim-down-sights blend --------------------------------------------
    const wantAds = s.ads !== undefined ? s.ads : (this._adsWant || 0);
    this.ads += (wantAds - this.ads) * damp(14, dt);

    // --- sprint / land / crouch offsets -----------------------------------
    const wantLower = s.sprinting ? 1 : 0;
    this.lower += (wantLower - this.lower) * damp(9, dt);
    if (this._wasGround && s.onGround === false) this.landDip = 0;
    if (!this._wasGround && s.onGround) this.landDip = 1;
    this._wasGround = s.onGround !== false;
    this.landDip = Math.max(0, this.landDip - dt * 3.4);

    // --- walk bob ----------------------------------------------------------
    const spd = clamp((s.moveSpeed || 0) / 4.4, 0, 1.4);
    this.bob += dt * (5.4 + spd * 5.2) * (s.sprinting ? 1.25 : 1);
    const bobAmp = spd * (s.walking ? 0.5 : 1) * (1 - this.ads * 0.75) * 0.016;
    const bx = Math.sin(this.bob) * bobAmp * 1.1;
    const by = Math.abs(Math.cos(this.bob)) * bobAmp * -0.9;
    const bz = Math.sin(this.bob * 2) * bobAmp * 0.35;

    // --- look sway (the weapon lags the camera, then springs back) ---------
    const sw = this.sway;
    sw.vx += (-(s.yawDelta || 0) * 1.35 - sw.x * 26) * dt * 26;
    sw.vy += (-(s.pitchDelta || 0) * 1.1 - sw.y * 26) * dt * 26;
    sw.vx *= 0.86; sw.vy *= 0.86;
    sw.x = clamp(sw.x + sw.vx * dt, -0.08, 0.08);
    sw.y = clamp(sw.y + sw.vy * dt, -0.06, 0.06);

    // --- recoil springs ----------------------------------------------------
    const k = this.kick;
    k.vz += (-k.z * 620 - k.vz * 30) * dt;
    k.vp += (-k.p * 640 - k.vp * 31) * dt;
    k.vr += (-k.r * 520 - k.vr * 26) * dt;
    k.z += k.vz * dt; k.p += k.vp * dt; k.r += k.vr * dt;

    // --- mechanical parts --------------------------------------------------
    this.slide = Math.max(0, this.slide - dt * 14);
    const travel = (st.slideTravel ?? 0.02) * Math.sin(this.slide * Math.PI);
    if (P.slide) P.slide.position.z = travel;
    if (P.bolt) P.bolt.position.z = travel * 0.9;
    if (P.trigger) P.trigger.rotation.x = -0.35 * this.slide;
    if (P.hammer) P.hammer.rotation.x += (0 - P.hammer.rotation.x) * damp(18, dt);
    this.flashT = Math.max(0, this.flashT - dt);
    if (P.muzzle) {
      const on = this.flashT > 0;
      P.muzzle.visible = on;
      const l = P.muzzle.userData.light;
      if (l) l.intensity = on ? l.intensity * 0.72 : 0;
    }
    this.shellT = Math.max(0, this.shellT - dt);
    if (P.shell) {
      if (this.shellT > 0) {
        const a = 1 - this.shellT / 0.16;
        P.shell.visible = true;
        P.shell.position.set(0.03 + a * 0.20, 0.01 + a * 0.06 - a * a * 0.16, a * 0.10);
        P.shell.rotation.set(a * 9, a * 5, a * 7);
      } else if (P.shell.visible) {
        P.shell.visible = false;
        P.shell.position.set(0, 0, 0);
      }
    }

    // --- reload / inspect choreography ------------------------------------
    let rx = 0, ry = 0, rz = 0, px = 0, py = 0, pz = 0;
    if (this.reloadT > 0) {
      this.reloadT = Math.max(0, this.reloadT - dt);
      const u = 1 - this.reloadT / Math.max(0.001, this.reloadDur);   // 0..1
      const dip = Math.sin(Math.PI * clamp01(u)) ;
      py -= 0.075 * dip;
      pz += 0.05 * dip;
      rx += 0.42 * dip;
      rz += 0.30 * dip;
      if (this.reloadType === 'shell' || this.reloadType === 'pump') {
        const shells = 6;
        const ph = (u * shells) % 1;
        px += 0.02 * Math.sin(ph * Math.PI);
        if (P.pump) P.pump.position.z = (st.slideTravel ?? 0.03) * 1.4 * Math.sin(ph * Math.PI);
      } else if (P.mag) {
        // 0–35 % drop the magazine, 35–70 % insert a fresh one, 70–100 % seat it
        if (u < 0.35) { const a = u / 0.35; P.mag.position.y = -a * 0.22; P.mag.rotation.x = a * 0.5; }
        else if (u < 0.72) { const a = (u - 0.35) / 0.37; P.mag.position.y = -0.22 * (1 - a); P.mag.rotation.x = 0.5 * (1 - a); }
        else { P.mag.position.y = 0; P.mag.rotation.x = 0; }
      }
      if (u > 0.72 && u < 0.86 && this.reloadType === 'bolt') {
        const a = (u - 0.72) / 0.14;
        if (P.bolt) P.bolt.position.z = (st.slideTravel ?? 0.03) * 1.8 * Math.sin(a * Math.PI);
      }
    } else if (P.mag) { P.mag.position.y = 0; P.mag.rotation.x = 0; }
    if (this.inspectT > 0) {
      this.inspectT = Math.max(0, this.inspectT - dt);
      const u = 1 - this.inspectT / 1.5;
      const e = Math.sin(Math.PI * u);
      ry += e * 1.5; rx += e * 0.35; py += e * 0.03; pz += e * 0.06;
    }

    // --- deploy / holster --------------------------------------------------
    if (this.deployT > 0) {
      this.deployT = Math.max(0, this.deployT - dt);
      const a = this.deployT / 0.42;
      py -= 0.16 * a * a;
      rx += 0.7 * a * a;
    } else if (this.deployT < 0) {
      this.deployT = Math.min(0, this.deployT + dt);
      const a = -this.deployT / 0.25;
      py -= 0.2 * a; rx += 0.9 * a;
    }

    // --- compose the final pose -------------------------------------------
    const aim = st.aim || [0, 0.02, 0.02];
    const adsX = -REST.x + aim[0] * 0;                 // slide to the view centre
    const adsY = -aim[1] * 0.5;
    const adsZ = (st.pull ?? 0.05);
    const crouch = (s.crouch || 0) * 0.012;
    const g = this.root;
    g.position.set(
      REST.x + bx + sw.x + px + this.ads * adsX,
      REST.y + by + sw.y + py + this.ads * adsY - crouch - this.landDip * 0.05 - this.lower * 0.09,
      REST.z + bz + pz + k.z + this.ads * adsZ + this.lower * 0.06,
    );
    g.rotation.set(
      rx - k.p + sw.y * 2.2 + this.landDip * 0.25 + this.lower * 0.5,
      ry + sw.x * 2.6 - this.ads * 0.02,
      rz + k.r * 0.05 + Math.sin(this.bob) * bobAmp * 6 + this.lower * 0.4,
    );
    return this;
  }

  dispose() {
    if (this.model) {
      this.root.remove(this.model.group);
      this.model.dispose?.();
      this.model = null;
    }
    this.scene.clear();
    return this;
  }
}

export default ViewModel;
