// ============================================================================
// render/mapmesh.js — turns a MapDef brush soup into renderable geometry.
//
// One THREE.Mesh per material: every brush is triangulated on its own, then all
// brushes sharing a material are merged into a single buffer.  Two things make
// the result read like a real level instead of a box collection:
//
//   * world scaled UVs — every face's UV comes from its world position divided
//     by MATERIAL_INFO[mat].texScale (or the brush's `uv` override), so a 20 m
//     wall shows ~8 tiles of brick and neighbouring brushes line up seamlessly.
//   * baked vertex AO — vertices near the ground and on downward facing faces
//     are darkened into the `color` attribute (which also carries `tint`), so
//     the materials must run with `vertexColors = true`.
//
// buildRadarCanvas() is pure canvas 2D: no WebGL, no assets.
// ============================================================================

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAT, TEAM_COLOR, QUALITY } from '../core/constants.js';
import { clamp01, lerp, smoothstep, TAU } from '../core/util.js';
import { MATERIAL_INFO } from './materials.js';

const FALLBACK_MAT = MAT.SAND_WALL;
const AO_CONTACT = 0.58;      // vertical faces where they meet the floor
const AO_DOWN = 0.55;         // downward facing faces
const AO_GROUND_H = 0.62;     // metres over which the ground contact fades
const AO_BASE_H = 0.5;        // metres over which a brush's own base fades
const JITTER_PROP = 0.5;      // UV jitter (tiles) for prop sized textures
const JITTER_WALL = 0.06;     // UV jitter (tiles) for walls and floors

const hasDOM = () => typeof document !== 'undefined' && typeof document.createElement === 'function';

/** World-space bounds of a brush list. */
export function brushBounds(brushes) {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  const list = brushes || [];
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (!b || !b.min || !b.max) continue;
    if (b.min.x < min.x) min.x = b.min.x;
    if (b.min.y < min.y) min.y = b.min.y;
    if (b.min.z < min.z) min.z = b.min.z;
    if (b.max.x > max.x) max.x = b.max.x;
    if (b.max.y > max.y) max.y = b.max.y;
    if (b.max.z > max.z) max.z = b.max.z;
  }
  if (!isFinite(min.x)) { min.x = min.y = min.z = 0; max.x = max.y = max.z = 0; }
  return { min, max };
}

// ---------------------------------------------------------------------------
// geometry construction
// ---------------------------------------------------------------------------
/** Signed world axis ids used for UV projection: ±X, ±Y, ±Z. */
const AX = { PX: 0, NX: 1, PY: 2, NY: 3, PZ: 4, NZ: 5 };
/** Component of `p` along a signed axis. */
function axisVal(p, a) {
  switch (a) {
    case AX.PX: return p[0];
    case AX.NX: return -p[0];
    case AX.PY: return p[1];
    case AX.NY: return -p[1];
    case AX.PZ: return p[2];
    default: return -p[2];
  }
}

/** Deterministic 0..1 hash of a brush position — drives the UV jitter. */
function hash3(x, y, z, salt) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + salt * 3.14159) * 43758.5453;
  return n - Math.floor(n);
}

/** Cheap AO for one vertex: contact darkening plus dark undersides. */
function aoAt(y, baseY, ny) {
  if (ny > 0.45) return 1;
  if (ny < -0.45) return AO_DOWN;
  const t = Math.min(smoothstep(y / AO_GROUND_H), smoothstep((y - baseY) / AO_BASE_H));
  return lerp(AO_CONTACT, 1, t);
}

/** Accumulates triangles for a single brush. */
class FaceBuilder {
  constructor(ts, uOff, vOff, baseY, tint) {
    this.pos = []; this.nrm = []; this.uv = []; this.col = [];
    this.ts = ts > 0 ? ts : 1;
    this.uOff = uOff; this.vOff = vOff;
    this.baseY = baseY;
    this.tint = tint;         // [r,g,b] linear multipliers
  }

  /** One vertex: world position, normal, signed UV axes. */
  vert(p, n, ua, va) {
    const ao = aoAt(p[1], this.baseY, n[1]);
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.uv.push(axisVal(p, ua) / this.ts + this.uOff, axisVal(p, va) / this.ts + this.vOff);
    this.col.push(ao * this.tint[0], ao * this.tint[1], ao * this.tint[2]);
  }

  /**
   * Quad given in counter-clockwise order seen from outside (a→b→c→d), split
   * into two triangles.  `ua`/`va` are the signed world axes the UVs project
   * on; they must satisfy ua × va = n so the tangent frame stays right handed.
   */
  quad(a, b, c, d, n, ua, va) {
    this.vert(a, n, ua, va); this.vert(b, n, ua, va); this.vert(c, n, ua, va);
    this.vert(a, n, ua, va); this.vert(c, n, ua, va); this.vert(d, n, ua, va);
  }

  /** Triangle with an explicit normal (cylinder caps). */
  tri(a, b, c, n, ua, va) {
    this.vert(a, n, ua, va); this.vert(b, n, ua, va); this.vert(c, n, ua, va);
  }

  /** Quad whose UVs come from a callback, in world metres (sloped faces). */
  quadUV(a, b, c, d, n, f) {
    const ua = f(a), ub = f(b), uc = f(c), ud = f(d);
    this.vertUV(a, n, ua[0], ua[1]); this.vertUV(b, n, ub[0], ub[1]); this.vertUV(c, n, uc[0], uc[1]);
    this.vertUV(a, n, ua[0], ua[1]); this.vertUV(c, n, uc[0], uc[1]); this.vertUV(d, n, ud[0], ud[1]);
  }

  /** Free-UV vertex used by cylinder walls, where u follows the arc length. */
  vertUV(p, n, u, v) {
    const ao = aoAt(p[1], this.baseY, n[1]);
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.uv.push(u / this.ts + this.uOff, v / this.ts + this.vOff);
    this.col.push(ao * this.tint[0], ao * this.tint[1], ao * this.tint[2]);
  }

  finish() {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
}

const N_PX = [1, 0, 0], N_NX = [-1, 0, 0], N_PY = [0, 1, 0];
const N_NY = [0, -1, 0], N_PZ = [0, 0, 1], N_NZ = [0, 0, -1];

/** Axis aligned box: six quads with outward normals. */
function buildBox(B, b) {
  const x0 = b.min.x, y0 = b.min.y, z0 = b.min.z;
  const x1 = b.max.x, y1 = b.max.y, z1 = b.max.z;
  // +X (u = -Z, v = +Y)
  B.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], N_PX, AX.NZ, AX.PY);
  // -X (u = +Z, v = +Y)
  B.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], N_NX, AX.PZ, AX.PY);
  // +Y (u = +X, v = -Z)
  B.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], N_PY, AX.PX, AX.NZ);
  // -Y (u = +X, v = +Z)
  B.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], N_NY, AX.PX, AX.PZ);
  // +Z (u = +X, v = +Y)
  B.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], N_PZ, AX.PX, AX.PY);
  // -Z (u = -X, v = +Y)
  B.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], N_NZ, AX.NX, AX.PY);
}

/**
 * Walkable wedge.  The top face rises from `ramp.lo` at min[axis] to `ramp.hi`
 * at max[axis]; the remaining five faces close the solid down to `min.y`.
 * Top-face UVs are stretched by the slope length so tiles stay square.
 */
function buildRamp(B, b) {
  const x0 = b.min.x, y0 = b.min.y, z0 = b.min.z;
  const x1 = b.max.x, z1 = b.max.z;
  const r = b.ramp || { axis: 'x', lo: b.max.y, hi: b.max.y };
  const lo = r.lo, hi = r.hi;
  const alongX = r.axis !== 'z';
  const run = alongX ? x1 - x0 : z1 - z0;
  const rise = hi - lo;
  const k = run > 1e-6 ? Math.hypot(run, rise) / run : 1;   // slope stretch
  // bottom (u = +X, v = +Z)
  B.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], N_NY, AX.PX, AX.PZ);
  if (alongX) {
    const len = Math.hypot(run, rise) || 1;
    const n = [-rise / len, run / len, 0];
    B.quadUV([x0, lo, z1], [x1, hi, z1], [x1, hi, z0], [x0, lo, z0], n,
      (p) => [x0 + (p[0] - x0) * k, -p[2]]);
    // -X end (u = +Z, v = +Y) and +X end (u = -Z, v = +Y)
    B.quad([x0, y0, z0], [x0, y0, z1], [x0, lo, z1], [x0, lo, z0], N_NX, AX.PZ, AX.PY);
    B.quad([x1, y0, z1], [x1, y0, z0], [x1, hi, z0], [x1, hi, z1], N_PX, AX.NZ, AX.PY);
    // -Z side (u = -X, v = +Y) and +Z side (u = +X, v = +Y): sloped trapezoids
    B.quad([x1, y0, z0], [x0, y0, z0], [x0, lo, z0], [x1, hi, z0], N_NZ, AX.NX, AX.PY);
    B.quad([x0, y0, z1], [x1, y0, z1], [x1, hi, z1], [x0, lo, z1], N_PZ, AX.PX, AX.PY);
  } else {
    const len = Math.hypot(run, rise) || 1;
    const n = [0, run / len, -rise / len];
    B.quadUV([x0, hi, z1], [x1, hi, z1], [x1, lo, z0], [x0, lo, z0], n,
      (p) => [p[0], -(z0 + (p[2] - z0) * k)]);
    // -Z end and +Z end
    B.quad([x1, y0, z0], [x0, y0, z0], [x0, lo, z0], [x1, lo, z0], N_NZ, AX.NX, AX.PY);
    B.quad([x0, y0, z1], [x1, y0, z1], [x1, hi, z1], [x0, hi, z1], N_PZ, AX.PX, AX.PY);
    // -X side and +X side: sloped trapezoids
    B.quad([x0, y0, z0], [x0, y0, z1], [x0, hi, z1], [x0, lo, z0], N_NX, AX.PZ, AX.PY);
    B.quad([x1, y0, z1], [x1, y0, z0], [x1, lo, z0], [x1, hi, z1], N_PX, AX.NZ, AX.PY);
  }
}

// Radial basis per cylinder axis, chosen so e0 × e1 = axis (right handed) and
// the cap UV axes match the equivalent box face.
const CYL_BASIS = {
  y: { n: N_PY, e0: [0, 0, 1], e1: [1, 0, 0], i: 1, capU: AX.PX, capV: AX.NZ, capUn: AX.PX, capVn: AX.PZ },
  x: { n: N_PX, e0: [0, 1, 0], e1: [0, 0, 1], i: 0, capU: AX.NZ, capV: AX.PY, capUn: AX.PZ, capVn: AX.PY },
  z: { n: N_PZ, e0: [1, 0, 0], e1: [0, 1, 0], i: 2, capU: AX.PX, capV: AX.PY, capUn: AX.NX, capVn: AX.PY },
};

/** Capped cylinder inscribed in the brush AABB, along cyl.axis. */
function buildCyl(B, b, segScale) {
  const cy = b.cyl || { r: 0.3, seg: 12, axis: 'y' };
  const basis = CYL_BASIS[cy.axis] || CYL_BASIS.y;
  const { e0, e1, i } = basis;
  const seg = Math.max(3, Math.min(64, Math.round((cy.seg || 12) * (segScale || 1))));
  const mid = [
    (b.min.x + b.max.x) * 0.5,
    (b.min.y + b.max.y) * 0.5,
    (b.min.z + b.max.z) * 0.5,
  ];
  const lo = i === 0 ? b.min.x : i === 1 ? b.min.y : b.min.z;
  const hi = i === 0 ? b.max.x : i === 1 ? b.max.y : b.max.z;
  const r = cy.r > 0 ? cy.r : 0.25;
  const at = (theta, t) => {
    const cs = Math.cos(theta), sn = Math.sin(theta);
    const p = [
      mid[0] + r * (cs * e0[0] + sn * e1[0]),
      mid[1] + r * (cs * e0[1] + sn * e1[1]),
      mid[2] + r * (cs * e0[2] + sn * e1[2]),
    ];
    p[i] = t;
    return p;
  };
  const nrm = (theta) => {
    const cs = Math.cos(theta), sn = Math.sin(theta);
    return [cs * e0[0] + sn * e1[0], cs * e0[1] + sn * e1[1], cs * e0[2] + sn * e1[2]];
  };
  const capHi = mid.slice(); capHi[i] = hi;
  const capLo = mid.slice(); capLo[i] = lo;
  for (let s = 0; s < seg; s++) {
    const t0 = (s / seg) * TAU, t1 = ((s + 1) / seg) * TAU;
    const a = at(t0, lo), bb = at(t1, lo), c = at(t1, hi), d = at(t0, hi);
    const n0 = nrm(t0), n1 = nrm(t1);
    // side: u follows the arc length, v the world position along the axis
    B.vertUV(a, n0, t0 * r, lo); B.vertUV(bb, n1, t1 * r, lo); B.vertUV(c, n1, t1 * r, hi);
    B.vertUV(a, n0, t0 * r, lo); B.vertUV(c, n1, t1 * r, hi); B.vertUV(d, n0, t0 * r, hi);
    // caps
    B.tri(capHi, d, c, basis.n, basis.capU, basis.capV);
    B.tri(capLo, bb, a, [-basis.n[0], -basis.n[1], -basis.n[2]], basis.capUn, basis.capVn);
  }
}

const _tintColor = /* reused scratch */ new THREE.Color();

/** Build one BufferGeometry for a single brush (null when it has no volume). */
function brushGeometry(b, matId, segScale) {
  const info = MATERIAL_INFO[matId] || MATERIAL_INFO[FALLBACK_MAT];
  const ts = b.uv > 0 ? b.uv : info.texScale;
  // identical props must not look cloned: nudge the UVs by a position hash.
  // Walls and floors only get a whisker so brick courses still line up.
  const amp = ts <= 1.5 ? JITTER_PROP : JITTER_WALL;
  const uOff = (hash3(b.min.x, b.min.y, b.min.z, 1) - 0.5) * 2 * amp;
  const vOff = (hash3(b.min.z, b.min.x, b.min.y, 2) - 0.5) * 2 * amp;
  let tint = [1, 1, 1];
  if (b.tint !== undefined && b.tint !== null) {
    _tintColor.set(b.tint);
    tint = [_tintColor.r, _tintColor.g, _tintColor.b];
  }
  const B = new FaceBuilder(ts, uOff, vOff, b.min.y, tint);
  if (b.kind === 'cyl') buildCyl(B, b, segScale);
  else if (b.kind === 'ramp') buildRamp(B, b);
  else buildBox(B, b);
  return B.finish();
}

/**
 * Triangulate every visible brush and merge per material.
 *
 * @param {Object} mapDef MapDef (uses `brushes`)
 * @param {{get:function(string):THREE.Material}} matlib MaterialLibrary
 * @param {Object|string} [quality] QUALITY entry — trims cylinder segments low
 * @returns {{group:THREE.Group, meshes:THREE.Mesh[], triangles:number}}
 */
export function buildMapMeshes(mapDef, matlib, quality) {
  const group = new THREE.Group();
  group.name = 'mapmesh';
  const meshes = [];
  const brushes = (mapDef && mapDef.brushes) || [];
  const q = (typeof quality === 'string' ? QUALITY[quality] : quality) || QUALITY.high;
  const segScale = q.shadowMap === 0 ? 0.62 : 1;   // low tier: cheaper cylinders
  const byMat = new Map();
  for (let i = 0; i < brushes.length; i++) {
    const b = brushes[i];
    if (!b || b.visible === false || !b.min || !b.max) continue;
    const matId = MATERIAL_INFO[b.mat] ? b.mat : FALLBACK_MAT;
    const geo = brushGeometry(b, matId, segScale);
    if (!geo) continue;
    let list = byMat.get(matId);
    if (!list) { list = []; byMat.set(matId, list); }
    list.push(geo);
  }

  let triangles = 0;
  for (const [matId, list] of byMat) {
    let merged = null;
    if (list.length === 1) {
      merged = list[0];
    } else {
      merged = mergeGeometries(list, false);
      for (let i = 0; i < list.length; i++) list[i].dispose();
    }
    if (!merged) continue;
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    const mat = matlib && typeof matlib.get === 'function'
      ? matlib.get(matId)
      : new THREE.MeshStandardMaterial({ vertexColors: true });
    // the baked AO / tint live in the colour attribute
    if (mat && mat.vertexColors !== true) { mat.vertexColors = true; mat.needsUpdate = true; }
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = `map_${matId}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
    meshes.push(mesh);
    triangles += merged.getAttribute('position').count / 3;
  }
  return { group, meshes, triangles };
}

/**
 * Free everything a built map group owns.  Textures belong to the
 * MaterialLibrary, so they are only released when `opts.textures` is set.
 * @param {THREE.Object3D} group
 * @param {{materials?:boolean, textures?:boolean}} [opts]
 */
export function disposeGroup(group, opts = {}) {
  if (!group) return;
  const dropMats = opts.materials !== false;
  const mats = new Set();
  group.traverse((o) => {
    if (o.geometry && typeof o.geometry.dispose === 'function') o.geometry.dispose();
    const m = o.material;
    if (Array.isArray(m)) { for (const x of m) if (x) mats.add(x); } else if (m) mats.add(m);
  });
  if (dropMats) {
    const keys = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap',
      'bumpMap', 'emissiveMap', 'displacementMap', 'lightMap'];
    for (const m of mats) {
      if (opts.textures) {
        for (const k of keys) { const t = m[k]; if (t && typeof t.dispose === 'function') t.dispose(); }
      }
      m.dispose();
    }
  }
  if (group.parent) group.parent.remove(group);
  if (typeof group.clear === 'function') group.clear();
}

// ---------------------------------------------------------------------------
// radar image (canvas 2D only — no WebGL, no assets)
// ---------------------------------------------------------------------------
const R_BG = '#0b0e12';
const R_FLOOR_LO = [72, 78, 86];
const R_FLOOR_HI = [170, 174, 180];
const R_COVER = 'rgb(124,116,102)';
const R_COVER_LINE = 'rgba(16,18,22,0.75)';
const R_WALL = 'rgb(40,44,50)';
const R_WALL_LINE = 'rgba(158,166,176,0.32)';
const R_WATER = 'rgba(58,104,132,0.85)';

/** Read `mapDef.radar` (arrays or {x,z}) with a brush-bounds fallback. */
function radarRect(mapDef) {
  const rd = mapDef && mapDef.radar;
  const rd0 = rd && rd.min, rd1 = rd && rd.max;
  let x0, z0, x1, z1;
  if (rd0 && rd1) {
    x0 = +(rd0[0] !== undefined ? rd0[0] : rd0.x);
    z0 = +(rd0[1] !== undefined ? rd0[1] : rd0.z);
    x1 = +(rd1[0] !== undefined ? rd1[0] : rd1.x);
    z1 = +(rd1[1] !== undefined ? rd1[1] : rd1.z);
  }
  if (!(isFinite(x0) && isFinite(z0) && isFinite(x1) && isFinite(z1) && x1 > x0 && z1 > z0)) {
    const bb = brushBounds(mapDef && mapDef.brushes);
    x0 = bb.min.x - 2; z0 = bb.min.z - 2; x1 = bb.max.x + 2; z1 = bb.max.z + 2;
  }
  if (!(x1 > x0)) { x0 = -32; x1 = 32; }
  if (!(z1 > z0)) { z0 = -32; z1 = 32; }
  return { min: { x: x0, z: z0 }, max: { x: x1, z: z1 } };
}

/** Radar-relevant top height of a brush (ramps report their mid height). */
function radarTop(b) {
  if (b.kind === 'ramp' && b.ramp) return (b.ramp.lo + b.ramp.hi) * 0.5;
  return b.max.y;
}

/** Which radar layer a brush belongs to. */
function radarClass(b) {
  if (b.water) return 'water';
  if (b.solid === false) return null;               // trim, pipes, lamps, ladders
  if (b.kind === 'ramp') return 'floor';
  const dx = b.max.x - b.min.x, dy = b.max.y - b.min.y, dz = b.max.z - b.min.z;
  if (dy <= 1.25 && Math.min(dx, dz) >= 1.1) return 'floor';
  if (dy <= 1.6) return 'cover';
  return 'wall';
}

/**
 * Bake the top-down radar image.  Floors are shaded by height (higher =
 * lighter), cover and walls are darker with outlines, bombsites are tinted with
 * a big A / B glyph, spawns get a faint team tint and callouts are labelled.
 *
 * @param {Object} mapDef MapDef (radar, brushes, sites, spawns, callouts)
 * @param {number} [size] longest edge in pixels (aspect follows the world rect)
 * @returns {{canvas:HTMLCanvasElement|null, min:{x,z}, max:{x,z}, scale:number}}
 */
export function buildRadarCanvas(mapDef, size = 512) {
  const rect = radarRect(mapDef);
  const wm = rect.max.x - rect.min.x, hm = rect.max.z - rect.min.z;
  const px = Math.max(64, size || 512);
  const scale = px / Math.max(wm, hm);
  const out = { canvas: null, min: rect.min, max: rect.max, scale };
  if (!hasDOM()) return out;
  const cv = document.createElement('canvas');
  cv.width = Math.max(2, Math.round(wm * scale));
  cv.height = Math.max(2, Math.round(hm * scale));
  const g = cv.getContext ? cv.getContext('2d') : null;
  if (!g) return out;
  out.canvas = cv;
  const X = (wx) => (wx - rect.min.x) * scale;
  const Z = (wz) => (wz - rect.min.z) * scale;

  g.fillStyle = R_BG;
  g.fillRect(0, 0, cv.width, cv.height);

  // --- sort the brushes into layers ---
  const brushes = (mapDef && mapDef.brushes) || [];
  const floors = [], covers = [], walls = [], water = [];
  for (let i = 0; i < brushes.length; i++) {
    const b = brushes[i];
    if (!b || b.visible === false || !b.min || !b.max) continue;
    const cls = radarClass(b);
    if (cls === 'floor') floors.push(b);
    else if (cls === 'cover') covers.push(b);
    else if (cls === 'wall') walls.push(b);
    else if (cls === 'water') water.push(b);
  }
  floors.sort((a, b) => radarTop(a) - radarTop(b));
  // height ramp taken from the floor plates, trimmed so one odd slab cannot
  // wash the whole map out
  const tops = floors.map(radarTop).sort((a, b) => a - b);
  const lo = tops.length ? tops[Math.floor(tops.length * 0.04)] : 0;
  const hi = tops.length ? tops[Math.floor(tops.length * 0.94)] : 1;
  const span = Math.max(1.4, hi - lo);

  /** Fill (and optionally outline) one brush footprint. */
  const paint = (b, fill, line) => {
    g.fillStyle = fill;
    if (b.kind === 'cyl' && b.cyl) {
      const cx = X((b.min.x + b.max.x) * 0.5), cz = Z((b.min.z + b.max.z) * 0.5);
      const r = Math.max(1, b.cyl.r * scale);
      g.beginPath(); g.arc(cx, cz, r, 0, TAU); g.fill();
      if (line) { g.strokeStyle = line; g.lineWidth = 1; g.stroke(); }
      return;
    }
    const x = X(b.min.x), y = Z(b.min.z);
    const w = Math.max(1, (b.max.x - b.min.x) * scale);
    const h = Math.max(1, (b.max.z - b.min.z) * scale);
    g.fillRect(x, y, w, h);
    if (line) {
      g.strokeStyle = line; g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, Math.max(1, w - 1), Math.max(1, h - 1));
    }
  };

  for (const b of floors) {
    const t = clamp01((radarTop(b) - lo) / span);
    const s = 0.25 + 0.75 * t;                       // keep the lowest floor readable
    paint(b, `rgb(${Math.round(lerp(R_FLOOR_LO[0], R_FLOOR_HI[0], s))},`
      + `${Math.round(lerp(R_FLOOR_LO[1], R_FLOOR_HI[1], s))},`
      + `${Math.round(lerp(R_FLOOR_LO[2], R_FLOOR_HI[2], s))})`, null);
  }
  for (const b of water) paint(b, R_WATER, 'rgba(120,190,220,0.4)');
  for (const b of covers) paint(b, R_COVER, R_COVER_LINE);
  for (const b of walls) paint(b, R_WALL, R_WALL_LINE);

  // --- spawn zones ---
  const spawns = (mapDef && mapDef.spawns) || {};
  for (const team of ['T', 'CT']) {
    const list = spawns[team];
    if (!Array.isArray(list) || !list.length) continue;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const s of list) {
      const p = s && (s.pos || s);
      if (!p || p.length < 3) continue;
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
      z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]);
    }
    if (!isFinite(x0)) continue;
    const pad = 3.5;
    g.save();
    g.globalAlpha = 0.16;
    g.fillStyle = TEAM_COLOR[team] || '#888';
    g.fillRect(X(x0 - pad), Z(z0 - pad), (x1 - x0 + pad * 2) * scale, (z1 - z0 + pad * 2) * scale);
    g.restore();
  }

  // --- bombsites ---
  const sites = (mapDef && mapDef.sites) || {};
  const glyph = Math.max(16, Math.round(px * 0.15));
  for (const key of Object.keys(sites)) {
    const site = sites[key];
    const a = site && site.area;
    if (!a) continue;
    const ax0 = a.x0 !== undefined ? a.x0 : (a.min ? a.min.x : 0);
    const az0 = a.z0 !== undefined ? a.z0 : (a.min ? a.min.z : 0);
    const ax1 = a.x1 !== undefined ? a.x1 : (a.max ? a.max.x : 0);
    const az1 = a.z1 !== undefined ? a.z1 : (a.max ? a.max.z : 0);
    const rx = X(Math.min(ax0, ax1)), ry = Z(Math.min(az0, az1));
    const rw = Math.abs(ax1 - ax0) * scale, rh = Math.abs(az1 - az0) * scale;
    g.save();
    g.fillStyle = 'rgba(226,122,58,0.16)';
    g.fillRect(rx, ry, rw, rh);
    g.strokeStyle = 'rgba(244,158,86,0.55)';
    g.lineWidth = 1.6;
    g.setLineDash([6, 5]);
    g.strokeRect(rx + 0.8, ry + 0.8, Math.max(1, rw - 1.6), Math.max(1, rh - 1.6));
    g.setLineDash([]);
    g.font = `bold ${glyph}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = Math.max(2, glyph * 0.09);
    g.strokeStyle = 'rgba(12,10,8,0.5)';
    g.strokeText(key, rx + rw * 0.5, ry + rh * 0.5);
    g.fillStyle = 'rgba(250,186,132,0.62)';
    g.fillText(key, rx + rw * 0.5, ry + rh * 0.5);
    g.restore();
  }

  // --- callouts ---
  const callouts = (mapDef && mapDef.callouts) || [];
  const fs = Math.max(9, Math.round(px * 0.024));
  g.save();
  g.font = `bold ${fs}px sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = Math.max(2, fs * 0.28);
  g.lineJoin = 'round';
  for (const c of callouts) {
    if (!c || !c.pos || !c.name) continue;
    const tx = X(c.pos[0]), ty = Z(c.pos[2]);
    if (tx < 0 || ty < 0 || tx > cv.width || ty > cv.height) continue;
    const label = String(c.name).toUpperCase();
    g.strokeStyle = 'rgba(6,8,10,0.72)';
    g.strokeText(label, tx, ty);
    g.fillStyle = 'rgba(198,205,214,0.72)';
    g.fillText(label, tx, ty);
  }
  g.restore();

  // --- frame ---
  g.strokeStyle = 'rgba(226,232,240,0.10)';
  g.lineWidth = 1;
  g.strokeRect(0.5, 0.5, cv.width - 1, cv.height - 1);
  return out;
}
