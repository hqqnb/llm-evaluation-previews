// ============================================================================
// maps/kit.js — the brush construction kit every map file is written with.
//
// Everything a map is made of ends up as an axis-aligned `box`, a walkable
// `ramp` wedge, or a `cyl`.  Rooms are built from a rectangle plus per-side
// wall runs with gaps, which guarantees the world is sealed: a doorway only
// exists where a gap was explicitly cut.
//
// Plan-view convention used by every map file:
//   x0 < x1 (west → east), z0 < z1 (north → south), y up.
//   side keys: 'n' = -Z wall, 's' = +Z wall, 'w' = -X wall, 'e' = +X wall.
// ============================================================================

import { MAT } from '../core/constants.js';

const V = (x, y, z) => ({ x, y, z });

export class BrushSet {
  constructor() { this.brushes = []; this.groupTag = null; }

  /** Tag every brush pushed from now on (callout/debug name). */
  group(tag) { this.groupTag = tag; return this; }

  add(b) {
    if (b.tag === undefined && this.groupTag) b.tag = this.groupTag;
    // normalise so min < max on every axis
    const mn = b.min, mx = b.max;
    for (const k of ['x', 'y', 'z']) {
      if (mn[k] > mx[k]) { const t = mn[k]; mn[k] = mx[k]; mx[k] = t; }
    }
    this.brushes.push(b);
    return b;
  }

  /** Axis-aligned box. */
  box(x0, z0, x1, z1, y0, y1, mat = MAT.SAND_WALL, o = {}) {
    return this.add({
      kind: 'box', min: V(x0, y0, z0), max: V(x1, y1, z1), mat,
      solid: o.solid !== false, sight: o.sight !== false, visible: o.visible !== false,
      uv: o.uv, tint: o.tint, tag: o.tag, climb: !!o.climb, surface: o.surface,
    });
  }

  /** Invisible collision-only volume (clip brush / player blocker). */
  clip(x0, z0, x1, z1, y0, y1, o = {}) {
    return this.box(x0, z0, x1, z1, y0, y1, MAT.CONCRETE, { ...o, visible: false, sight: o.sight === true });
  }

  /** Visual-only detail: drawn, never blocks movement or bullets. */
  detail(x0, z0, x1, z1, y0, y1, mat, o = {}) {
    return this.box(x0, z0, x1, z1, y0, y1, mat, { ...o, solid: false, sight: false });
  }

  /**
   * Walkable slope. The top surface goes from `yLo` to `yHi` along `axis`
   * ('x' → rises west→east, 'z' → rises north→south; negate by swapping yLo/yHi).
   */
  ramp(x0, z0, x1, z1, yLo, yHi, axis = 'x', mat = MAT.SAND_FLOOR, o = {}) {
    const base = Math.min(yLo, yHi) - (o.thick ?? 0.6);
    return this.add({
      kind: 'ramp', min: V(x0, base, z0), max: V(x1, Math.max(yLo, yHi), z1), mat,
      ramp: { axis, lo: yLo, hi: yHi },
      solid: true, sight: o.sight !== false, visible: o.visible !== false,
      uv: o.uv, tint: o.tint, tag: o.tag, surface: o.surface,
    });
  }

  /** Vertical cylinder (barrels, pillars, pipes). `axis` may be x/y/z. */
  cyl(cx, cz, y0, y1, r, mat = MAT.METAL_RUST, o = {}) {
    return this.add({
      kind: 'cyl', min: V(cx - r, y0, cz - r), max: V(cx + r, y1, cz + r), mat,
      cyl: { r, seg: o.seg ?? 14, axis: o.axis ?? 'y' },
      solid: o.solid !== false, sight: o.sight !== false, visible: o.visible !== false,
      uv: o.uv, tint: o.tint, tag: o.tag, surface: o.surface,
    });
  }

  /** Floor slab whose walking surface is at `y`. */
  floor(x0, z0, x1, z1, y = 0, mat = MAT.SAND_FLOOR, o = {}) {
    return this.box(x0, z0, x1, z1, y - (o.thick ?? 0.8), y, mat, o);
  }

  /** Ceiling slab hanging with its underside at `y`. */
  ceiling(x0, z0, x1, z1, y, mat = MAT.CONCRETE, o = {}) {
    return this.box(x0, z0, x1, z1, y, y + (o.thick ?? 0.6), mat, o);
  }

  /**
   * Wall running along X at a fixed Z, with doorways cut out of it.
   * gaps: [[x0, x1, yBottom, yTop], …] — the hole is open between yBottom..yTop,
   * so `[[4, 7, 0, 2.2]]` is a 3 m wide, 2.2 m high doorway with a lintel above.
   */
  wallX(z, x0, x1, y0, y1, mat = MAT.SAND_WALL, o = {}) {
    const t = o.thick ?? 0.5, za = z - t / 2, zb = z + t / 2;
    const gaps = (o.gaps || []).slice().sort((a, b) => a[0] - b[0]);
    let cur = x0;
    for (const g of gaps) {
      const [gx0, gx1, gy0 = y0, gy1 = y1] = g;
      if (gx0 > cur) this.box(cur, za, gx0, zb, y0, y1, mat, o);
      if (gy0 > y0) this.box(gx0, za, gx1, zb, y0, gy0, mat, o);           // under the hole
      if (gy1 < y1) this.box(gx0, za, gx1, zb, gy1, y1, mat, o);           // lintel above
      cur = Math.max(cur, gx1);
    }
    if (cur < x1) this.box(cur, za, x1, zb, y0, y1, mat, o);
    return this;
  }

  /** Wall running along Z at a fixed X. gaps use Z coordinates. */
  wallZ(x, z0, z1, y0, y1, mat = MAT.SAND_WALL, o = {}) {
    const t = o.thick ?? 0.5, xa = x - t / 2, xb = x + t / 2;
    const gaps = (o.gaps || []).slice().sort((a, b) => a[0] - b[0]);
    let cur = z0;
    for (const g of gaps) {
      const [gz0, gz1, gy0 = y0, gy1 = y1] = g;
      if (gz0 > cur) this.box(xa, cur, xb, gz0, y0, y1, mat, o);
      if (gy0 > y0) this.box(xa, gz0, xb, gz1, y0, gy0, mat, o);
      if (gy1 < y1) this.box(xa, gz0, xb, gz1, gy1, y1, mat, o);
      cur = Math.max(cur, gz1);
    }
    if (cur < z1) this.box(xa, cur, xb, z1, y0, y1, mat, o);
    return this;
  }

  /**
   * A sealed rectangular space: floor, four walls (each optionally pierced by
   * gaps) and an optional ceiling.  Walls are centred on the rectangle edge so
   * two rooms sharing an edge line up exactly.
   *
   * @param {Object} p {x0,z0,x1,z1, y=0, h=5, mat, floorMat, thick=0.5,
   *                    ceiling=false, floor=true, sides:{n,s,e,w}}
   *        each side is `false` (no wall), or `{gaps:[[a,b,y0,y1]], h, mat, thick}`
   */
  room(p) {
    const { x0, z0, x1, z1 } = p;
    const y = p.y ?? 0, h = p.h ?? 5, thick = p.thick ?? 0.5;
    const mat = p.mat ?? MAT.SAND_WALL;
    if (p.floor !== false) this.floor(x0, z0, x1, z1, y, p.floorMat ?? MAT.SAND_FLOOR, { thick: p.floorThick, uv: p.floorUv, tag: p.tag });
    const sides = p.sides || {};
    const ext = thick / 2;
    const sideDef = (s) => (s === undefined ? {} : s);
    if (sides.n !== false) {
      const s = sideDef(sides.n);
      this.wallX(z0, x0 - ext, x1 + ext, y, y + (s.h ?? h), s.mat ?? mat, { gaps: s.gaps, thick: s.thick ?? thick, uv: s.uv, tag: s.tag });
    }
    if (sides.s !== false) {
      const s = sideDef(sides.s);
      this.wallX(z1, x0 - ext, x1 + ext, y, y + (s.h ?? h), s.mat ?? mat, { gaps: s.gaps, thick: s.thick ?? thick, uv: s.uv, tag: s.tag });
    }
    if (sides.w !== false) {
      const s = sideDef(sides.w);
      this.wallZ(x0, z0 + ext, z1 - ext, y, y + (s.h ?? h), s.mat ?? mat, { gaps: s.gaps, thick: s.thick ?? thick, uv: s.uv, tag: s.tag });
    }
    if (sides.e !== false) {
      const s = sideDef(sides.e);
      this.wallZ(x1, z0 + ext, z1 - ext, y, y + (s.h ?? h), s.mat ?? mat, { gaps: s.gaps, thick: s.thick ?? thick, uv: s.uv, tag: s.tag });
    }
    if (p.ceiling) this.ceiling(x0 - ext, z0 - ext, x1 + ext, z1 + ext, y + h, p.ceilMat ?? MAT.CONCRETE, { thick: p.ceilThick });
    return this;
  }

  // --- props -----------------------------------------------------------------

  /** Wooden crate standing on `y`, centred at (cx,cz). */
  crate(cx, cz, y, w = 1.4, h = 1.4, d = null, mat = MAT.CRATE, o = {}) {
    d = d ?? w;
    this.box(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, y, y + h, mat, o);
    if (o.trim !== false) {   // metal corner bands, purely visual
      const e = 0.06;
      this.detail(cx - w / 2 - e, cz - d / 2 - e, cx + w / 2 + e, cz + d / 2 + e, y + h - 0.14, y + h - 0.06, MAT.METAL, { uv: 0.5 });
      this.detail(cx - w / 2 - e, cz - d / 2 - e, cx + w / 2 + e, cz + d / 2 + e, y + 0.06, y + 0.14, MAT.METAL, { uv: 0.5 });
    }
    return this;
  }

  /** A stack/cluster of crates — the classic bombsite cover. */
  crateStack(cx, cz, y, spec = [[1.5, 1.5], [1.2, 1.1]], mat = MAT.CRATE) {
    let cur = y;
    for (let i = 0; i < spec.length; i++) {
      const [s, h] = spec[i];
      const jx = i === 0 ? 0 : (i % 2 ? 0.12 : -0.1);
      this.crate(cx + jx, cz + (i % 2 ? -0.08 : 0.09), cur, s, h, s, mat);
      cur += h;
    }
    return this;
  }

  barrel(cx, cz, y, r = 0.34, h = 1.02, mat = MAT.METAL_RUST) {
    this.cyl(cx, cz, y, y + h, r, mat, { seg: 12 });
    this.detail(cx - r - 0.02, cz - r - 0.02, cx + r + 0.02, cz + r + 0.02, y + h * 0.32, y + h * 0.4, MAT.METAL, { uv: 0.4 });
    this.detail(cx - r - 0.02, cz - r - 0.02, cx + r + 0.02, cz + r + 0.02, y + h * 0.62, y + h * 0.7, MAT.METAL, { uv: 0.4 });
    return this;
  }

  /** Sandbag emplacement filling the rectangle up to `h` in stacked rows. */
  sandbags(x0, z0, x1, z1, y, h = 0.95) {
    const rows = Math.max(1, Math.round(h / 0.32));
    for (let i = 0; i < rows; i++) {
      const inset = i * 0.06;
      this.box(x0 + inset, z0 + inset, x1 - inset, z1 - inset, y + i * (h / rows), y + (i + 1) * (h / rows) + 0.02,
        MAT.SANDBAG, { uv: 0.55 });
    }
    return this;
  }

  /**
   * Decorative arch framing an existing doorway. `dir` = 'x' when the opening
   * is pierced through a wall that runs along X, 'z' otherwise.
   */
  arch(cx, cz, width, height, dir = 'x', mat = MAT.SAND_TRIM, o = {}) {
    const t = o.thick ?? 0.34, w = width / 2;
    const seg = 7, rise = o.rise ?? 0.55;
    for (let i = 0; i < seg; i++) {
      const t0 = i / seg, t1 = (i + 1) / seg;
      const x0 = -w + width * t0, x1 = -w + width * t1;
      const yc = height + rise * Math.sin(Math.PI * (t0 + t1) / 2);
      if (dir === 'x') this.detail(cx + x0, cz - t, cx + x1, cz + t, height - 0.1, yc, mat, { uv: 0.6 });
      else this.detail(cx - t, cz + x0, cx + t, cz + x1, height - 0.1, yc, mat, { uv: 0.6 });
    }
    // jambs
    if (dir === 'x') {
      this.detail(cx - w - 0.22, cz - t, cx - w, cz + t, 0, height + 0.1, mat, { uv: 0.6 });
      this.detail(cx + w, cz - t, cx + w + 0.22, cz + t, 0, height + 0.1, mat, { uv: 0.6 });
    } else {
      this.detail(cx - t, cz - w - 0.22, cx + t, cz - w, 0, height + 0.1, mat, { uv: 0.6 });
      this.detail(cx - t, cz + w, cx + t, cz + w + 0.22, 0, height + 0.1, mat, { uv: 0.6 });
    }
    return this;
  }

  /** Two heavy door leaves standing open, leaving a `gap` wide slit. */
  doubleDoor(cx, cz, width, height, dir = 'x', gap = 1.0, mat = MAT.DOOR) {
    const leaf = (width - gap) / 2, t = 0.16;
    if (dir === 'x') {
      this.box(cx - width / 2, cz - t, cx - width / 2 + leaf, cz + t, 0, height, mat, { uv: 1.2 });
      this.box(cx + width / 2 - leaf, cz - t, cx + width / 2, cz + t, 0, height, mat, { uv: 1.2 });
    } else {
      this.box(cx - t, cz - width / 2, cx + t, cz - width / 2 + leaf, 0, height, mat, { uv: 1.2 });
      this.box(cx - t, cz + width / 2 - leaf, cx + t, cz + width / 2, 0, height, mat, { uv: 1.2 });
    }
    return this;
  }

  pillar(cx, cz, y0, y1, size = 0.6, mat = MAT.STONE) {
    const h = size / 2;
    this.box(cx - h, cz - h, cx + h, cz + h, y0, y1, mat);
    this.detail(cx - h - 0.08, cz - h - 0.08, cx + h + 0.08, cz + h + 0.08, y1 - 0.22, y1, MAT.SAND_TRIM, { uv: 0.5 });
    return this;
  }

  /** Stepped stairs (each step is a solid box, so step-up handles them). */
  stairs(x0, z0, x1, z1, yLo, yHi, axis = 'x', steps = 8, mat = MAT.STONE) {
    const dy = (yHi - yLo) / steps;
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps, t1 = (i + 1) / steps;
      const y = yLo + dy * (i + 1);
      if (axis === 'x') this.box(x0 + (x1 - x0) * t0, z0, x0 + (x1 - x0) * t1, z1, yLo - 0.8, y, mat, { uv: 0.9 });
      else this.box(x0, z0 + (z1 - z0) * t0, x1, z0 + (z1 - z0) * t1, yLo - 0.8, y, mat, { uv: 0.9 });
    }
    return this;
  }

  /** Raised platform with a solid skirt down to `base`. */
  platform(x0, z0, x1, z1, y, mat = MAT.STONE, o = {}) {
    const base = o.base ?? 0;
    this.box(x0, z0, x1, z1, base - 0.2, y, mat, { uv: o.uv, tag: o.tag });
    if (o.lip !== false) this.detail(x0 - 0.1, z0 - 0.1, x1 + 0.1, z1 + 0.1, y - 0.22, y - 0.02, MAT.SAND_TRIM, { uv: 0.5 });
    return this;
  }

  /** Low wall / parapet you can shoot over but not walk through. */
  parapet(x0, z0, x1, z1, y, h = 1.1, mat = MAT.SAND_WALL) {
    this.box(x0, z0, x1, z1, y, y + h, mat, { uv: 1.4 });
    this.detail(x0 - 0.07, z0 - 0.07, x1 + 0.07, z1 + 0.07, y + h - 0.16, y + h, MAT.SAND_TRIM, { uv: 0.5 });
    return this;
  }

  /** Ladder volume: bots and players can climb it. */
  ladder(cx, cz, y0, y1, dir = 'x', w = 0.8) {
    const t = 0.14;
    if (dir === 'x') this.add({ kind: 'box', min: V(cx - w / 2, y0, cz - t), max: V(cx + w / 2, y1, cz + t), mat: MAT.METAL, solid: false, sight: false, visible: true, climb: true });
    else this.add({ kind: 'box', min: V(cx - t, y0, cz - w / 2), max: V(cx + t, y1, cz + w / 2), mat: MAT.METAL, solid: false, sight: false, visible: true, climb: true });
    const rungs = Math.floor((y1 - y0) / 0.3);
    for (let i = 1; i < rungs; i++) {
      const y = y0 + i * 0.3;
      if (dir === 'x') this.detail(cx - w / 2, cz - 0.06, cx + w / 2, cz + 0.06, y, y + 0.06, MAT.METAL, { uv: 0.3 });
      else this.detail(cx - 0.06, cz - w / 2, cx + 0.06, cz + w / 2, y, y + 0.06, MAT.METAL, { uv: 0.3 });
    }
    return this;
  }

  // --- pure decoration (never solid) ----------------------------------------

  /** Horizontal band / moulding along a wall run, for visual rhythm. */
  band(x0, z0, x1, z1, y, h = 0.28, mat = MAT.SAND_TRIM) {
    return this.detail(x0, z0, x1, z1, y, y + h, mat, { uv: 0.7 });
  }

  /** Cloth awning sloping away from a wall. */
  awning(x0, z0, x1, z1, y, drop = 0.5, axis = 'z', mat = MAT.CANVAS) {
    this.add({
      kind: 'ramp', min: V(x0, y - drop - 0.12, z0), max: V(x1, y, z1), mat,
      ramp: { axis, lo: y, hi: y - drop }, solid: false, sight: false, visible: true, uv: 0.8,
    });
    return this;
  }

  /** Wall lamp / lantern. */
  lamp(cx, cz, y, mat = MAT.METAL) {
    this.detail(cx - 0.12, cz - 0.12, cx + 0.12, cz + 0.12, y, y + 0.3, mat, { uv: 0.3 });
    this.detail(cx - 0.16, cz - 0.16, cx + 0.16, cz + 0.16, y + 0.3, y + 0.38, MAT.SAND_TRIM, { uv: 0.3 });
    return this;
  }

  /** Pipe run along an axis. */
  pipe(cx, cz, y, len, axis = 'x', r = 0.11, mat = MAT.METAL_RUST) {
    if (axis === 'x') this.add({ kind: 'cyl', min: V(cx, y - r, cz - r), max: V(cx + len, y + r, cz + r), mat, cyl: { r, seg: 10, axis: 'x' }, solid: false, sight: false, visible: true });
    else if (axis === 'z') this.add({ kind: 'cyl', min: V(cx - r, y - r, cz), max: V(cx + r, y + r, cz + len), mat, cyl: { r, seg: 10, axis: 'z' }, solid: false, sight: false, visible: true });
    else this.cyl(cx, cz, y, y + len, r, mat, { solid: false, sight: false });
    return this;
  }

  /** Wooden planks lying about / boarded window. */
  planks(x0, z0, x1, z1, y, n = 3, mat = MAT.WOOD) {
    for (let i = 0; i < n; i++) {
      const t = i / n;
      this.detail(x0, z0 + (z1 - z0) * t, x1, z0 + (z1 - z0) * (t + 0.72 / n), y + i * 0.02, y + 0.06 + i * 0.02, mat, { uv: 0.8 });
    }
    return this;
  }

  get list() { return this.brushes; }
}

/** World-space bounds of a brush list. */
export function brushBounds(brushes) {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const b of brushes) {
    min.x = Math.min(min.x, b.min.x); min.y = Math.min(min.y, b.min.y); min.z = Math.min(min.z, b.min.z);
    max.x = Math.max(max.x, b.max.x); max.y = Math.max(max.y, b.max.y); max.z = Math.max(max.z, b.max.z);
  }
  return { min, max };
}

/** Convenience: `const B = brushes();` at the top of every map file. */
export const brushes = () => new BrushSet();

/** Shorthand for nav node definitions inside map files. */
export const N = (id, x, y, z, area, tags = [], r = 1.6) => ({ id, p: [x, y, z], area, tags, r });

/** Shorthand for a CT hold spot / T post-plant spot. */
export const HOLD = (x, y, z, lookX, lookZ, area, opts = {}) => ({
  pos: [x, y, z], look: [lookX, y + (opts.lookY ?? 0), lookZ], area,
  crouch: !!opts.crouch, prio: opts.prio ?? 1, name: opts.name,
});

/** Shorthand for a scripted utility line. */
export const NADE = (team, type, from, to, area, phase = 'exec', opts = {}) => ({
  team, type, from, to, area, phase, name: opts.name, prio: opts.prio ?? 1,
});

