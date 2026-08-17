// ============================================================================
// world/world.js — collision, ray casting, visibility and player physics.
//
// The world is a soup of axis-aligned brushes (plus walkable ramp wedges and
// cylinders) held in a flat XZ spatial hash.  Everything the gameplay needs —
// movement, bullets, line of sight, footstep surfaces — is answered from here,
// so both the human player and the bots use exactly the same physics.
// ============================================================================

import * as THREE from 'three';
import { PLAYER, PHYS, MAT_SURFACE, SURFACE, AREA } from '../core/constants.js';
import { rayBox, clamp } from '../core/util.js';
import { brushBounds } from '../maps/kit.js';

const CELL = 5;                       // spatial hash cell size in metres
const EPS = 1e-4;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _n = { x: 0, y: 1, z: 0 };
const _boxA = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };

export class World {
  constructor(mapDef) {
    this.mapDef = mapDef;
    this.brushes = mapDef.brushes;
    this.solids = this.brushes.filter((b) => b.solid);
    this.blockers = this.brushes.filter((b) => b.sight);      // stops bullets & vision
    this.climbs = this.brushes.filter((b) => b.climb);
    const bb = brushBounds(this.brushes);
    this.bounds = {
      min: new THREE.Vector3(bb.min.x, bb.min.y, bb.min.z),
      max: new THREE.Vector3(bb.max.x, bb.max.y, bb.max.z),
    };
    this.smokes = [];      // filled by GrenadeSystem: {pos, radius, until, kind}
    this.fires = [];
    this.areas = mapDef.areas || null;
    this._buildGrid();
  }

  // --- spatial hash ---------------------------------------------------------
  _buildGrid() {
    this.grid = new Map();
    this.gridSight = new Map();
    for (const b of this.solids) this._insert(this.grid, b);
    for (const b of this.blockers) this._insert(this.gridSight, b);
  }

  _insert(grid, b) {
    const x0 = Math.floor(b.min.x / CELL), x1 = Math.floor(b.max.x / CELL);
    const z0 = Math.floor(b.min.z / CELL), z1 = Math.floor(b.max.z / CELL);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const k = x * 73856093 ^ z * 19349663;
        let a = grid.get(k);
        if (!a) grid.set(k, (a = []));
        a.push(b);
      }
    }
  }

  /** Collect brushes whose cells overlap the XZ rectangle into `out`. */
  query(grid, minX, minZ, maxX, maxZ, out) {
    out.length = 0;
    const x0 = Math.floor(minX / CELL), x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL), z1 = Math.floor(maxZ / CELL);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const a = grid.get(x * 73856093 ^ z * 19349663);
        if (!a) continue;
        for (let i = 0; i < a.length; i++) {
          const b = a[i];
          if (b._mark === this._qid) continue;
          b._mark = this._qid;
          out.push(b);
        }
      }
    }
    return out;
  }

  _beginQuery() { this._qid = (this._qid || 0) + 1; }

  /** Effective surface height of a brush at (x,z) — handles ramps. */
  topAt(b, x, z) {
    if (b.kind !== 'ramp') return b.max.y;
    const r = b.ramp;
    const a0 = r.axis === 'x' ? b.min.x : b.min.z;
    const a1 = r.axis === 'x' ? b.max.x : b.max.z;
    const p = r.axis === 'x' ? x : z;
    const t = clamp((p - a0) / Math.max(1e-6, a1 - a0), 0, 1);
    return r.lo + (r.hi - r.lo) * t;
  }

  /** Highest surface height of a brush over an XZ rectangle. */
  topOver(b, minX, minZ, maxX, maxZ) {
    if (b.kind !== 'ramp') return b.max.y;
    const r = b.ramp;
    const a = this.topAt(b, minX, minZ), c = this.topAt(b, maxX, maxZ);
    return r.hi >= r.lo ? Math.max(a, c) : Math.max(a, c);
  }

  _overlaps(b, minX, minY, minZ, maxX, maxY, maxZ) {
    if (b.min.x >= maxX || b.max.x <= minX || b.min.z >= maxZ || b.max.z <= minZ) return false;
    const top = b.kind === 'ramp'
      ? this.topOver(b, Math.max(minX, b.min.x), Math.max(minZ, b.min.z), Math.min(maxX, b.max.x), Math.min(maxZ, b.max.z))
      : b.max.y;
    return !(b.min.y >= maxY || top <= minY);
  }

  /**
   * Highest walkable surface at (x,z) at or below `fromY` (+ a step of slack).
   * @returns {{y:number, brush:Brush|null, surface:string}}
   */
  groundY(x, z, fromY, radius = PLAYER.radius) {
    this._beginQuery();
    const cand = this.query(this.grid, x - radius, z - radius, x + radius, z + radius, this._tmpA || (this._tmpA = []));
    let best = -Infinity, bb = null;
    const minX = x - radius, maxX = x + radius, minZ = z - radius, maxZ = z + radius;
    for (let i = 0; i < cand.length; i++) {
      const b = cand[i];
      if (b.min.x >= maxX || b.max.x <= minX || b.min.z >= maxZ || b.max.z <= minZ) continue;
      // Ramps support the player at the height under their centre so slopes are
      // ridden smoothly; boxes support at their top face.
      const top = b.kind === 'ramp' ? this.topAt(b, clamp(x, b.min.x, b.max.x), clamp(z, b.min.z, b.max.z)) : b.max.y;
      if (top <= fromY + 0.02 && top > best) { best = top; bb = b; }
    }
    if (!bb) return { y: this.bounds.min.y, brush: null, surface: SURFACE.SAND };
    return { y: best, brush: bb, surface: bb.surface || MAT_SURFACE[bb.mat] || SURFACE.CONCRETE };
  }

  /** True when the point is inside any solid brush. */
  pointSolid(x, y, z) {
    this._beginQuery();
    const cand = this.query(this.grid, x, z, x, z, this._tmpB || (this._tmpB = []));
    for (const b of cand) if (this._overlaps(b, x - EPS, y - EPS, z - EPS, x + EPS, y + EPS, z + EPS)) return true;
    return false;
  }

  /** True when a player-sized box at this position fits without clipping. */
  fits(x, y, z, radius, height) {
    this._beginQuery();
    const cand = this.query(this.grid, x - radius, z - radius, x + radius, z + radius, this._tmpC || (this._tmpC = []));
    const minX = x - radius, maxX = x + radius, minZ = z - radius, maxZ = z + radius;
    const minY = y + EPS, maxY = y + height - EPS;
    for (const b of cand) {
      if (b.min.x >= maxX || b.max.x <= minX || b.min.z >= maxZ || b.max.z <= minZ) continue;
      // ramps are measured under the body centre, otherwise standing on a slope
      // would report the slope itself as an obstruction
      const top = b.kind === 'ramp' ? this.topAt(b, clamp(x, b.min.x, b.max.x), clamp(z, b.min.z, b.max.z)) : b.max.y;
      if (b.min.y < maxY && top > minY) return false;
    }
    return true;
  }

  // --- player physics -------------------------------------------------------
  /**
   * Integrate one entity for `dt`.  The caller fills in the wish direction and
   * flags; this applies acceleration, friction, gravity, jumping, ladders,
   * collision resolution, automatic step-up and ground snapping.
   *
   * ent = {pos, vel, radius, height, onGround, wish:{x,z}, wishSpeed, jump,
   *        onLadder, noclip, gravityScale}
   * @returns {{landed:boolean, landSpeed:number, hitWall:boolean, stepped:number,
   *            ground:Object|null, surface:string, onLadder:boolean}}
   */
  moveEntity(ent, dt) {
    const res = { landed: false, landSpeed: 0, hitWall: false, stepped: 0, ground: null, surface: SURFACE.SAND, onLadder: false };
    if (dt <= 0) return res;
    const vel = ent.vel, pos = ent.pos;
    const wasAir = !ent.onGround;
    const r = ent.radius, h = ent.height;

    if (ent.noclip) {
      pos.x += vel.x * dt; pos.y += vel.y * dt; pos.z += vel.z * dt;
      return res;
    }

    // ladder support: a climb volume touching the body lets us move vertically
    const ladder = this._ladderAt(pos, r, h);
    res.onLadder = !!ladder;

    const wishX = ent.wish.x, wishZ = ent.wish.z;
    const wl = Math.hypot(wishX, wishZ);
    const speedTarget = ent.wishSpeed;

    if (ladder && wl > 0.01) {
      vel.y = PHYS.ladderSpeed * (ent.wishClimb ?? 1);
      vel.x = (wishX / (wl || 1)) * speedTarget * 0.4;
      vel.z = (wishZ / (wl || 1)) * speedTarget * 0.4;
      ent.onGround = false;
    } else if (ent.onGround) {
      // friction
      const sp = Math.hypot(vel.x, vel.z);
      if (sp > 0) {
        const drop = Math.max(sp, PHYS.stopSpeed) * PHYS.friction * dt;
        const k = Math.max(0, sp - drop) / sp;
        vel.x *= k; vel.z *= k;
      }
      this._accelerate(vel, wishX, wishZ, wl, speedTarget, PHYS.groundAccel, dt);
      if (ent.jump) { vel.y = PHYS.jumpVel; ent.onGround = false; ent.jump = false; }
    } else {
      this._accelerate(vel, wishX, wishZ, wl, Math.min(speedTarget, PHYS.airMaxWish * 10), PHYS.airAccel, dt, true);
    }
    if (!ent.onGround && !ladder) vel.y -= PHYS.gravity * (ent.gravityScale ?? 1) * dt;

    // integrate in substeps small enough that nothing tunnels
    let remaining = dt;
    const maxStep = 0.2 / Math.max(0.5, Math.hypot(vel.x, vel.y, vel.z));
    let guard = 0;
    while (remaining > 1e-5 && guard++ < 24) {
      const sdt = Math.min(remaining, maxStep);
      remaining -= sdt;
      this._axis(ent, 'x', vel.x * sdt, res);
      this._axis(ent, 'z', vel.z * sdt, res);
      this._vertical(ent, vel.y * sdt, res);
    }

    // ground snap + landing detection
    const g = this.groundY(pos.x, pos.z, pos.y + 0.05, r * 0.92);
    res.ground = g.brush; res.surface = g.surface;
    if (vel.y <= 0.02 && pos.y - g.y <= (ent.onGround ? PLAYER.stepHeight * 0.5 : 0.12) && pos.y - g.y > -0.02) {
      if (wasAir) { res.landed = true; res.landSpeed = -Math.min(0, ent._lastFallVel ?? vel.y); }
      pos.y = g.y;
      vel.y = 0;
      ent.onGround = true;
    } else if (pos.y - g.y > 0.14) {
      ent.onGround = false;
    }
    ent._lastFallVel = vel.y;
    // never escape the map
    pos.x = clamp(pos.x, this.bounds.min.x + r, this.bounds.max.x - r);
    pos.z = clamp(pos.z, this.bounds.min.z + r, this.bounds.max.z - r);
    if (pos.y < this.bounds.min.y - 4) { pos.y = this.bounds.min.y + 2; vel.set(0, 0, 0); }
    return res;
  }

  _accelerate(vel, wx, wz, wl, target, accel, dt, air = false) {
    if (wl < 1e-4) return;
    const dx = wx / wl, dz = wz / wl;
    const cur = vel.x * dx + vel.z * dz;
    let add = target - cur;
    if (add <= 0) return;
    let acc = accel * target * dt;
    if (air) acc = Math.min(acc, PHYS.airMaxWish);
    if (acc > add) acc = add;
    vel.x += dx * acc; vel.z += dz * acc;
  }

  /** Horizontal axis move with push-out and automatic step-up. */
  _axis(ent, axis, amount, res) {
    if (amount === 0) return;
    const pos = ent.pos, r = ent.radius, h = ent.height;
    pos[axis] += amount;
    this._beginQuery();
    const cand = this.query(this.grid, pos.x - r, pos.z - r, pos.x + r, pos.z + r, this._tmpD || (this._tmpD = []));
    for (let i = 0; i < cand.length; i++) {
      const b = cand[i];
      if (!this._overlaps(b, pos.x - r, pos.y + 0.02, pos.z - r, pos.x + r, pos.y + h, pos.z + r)) continue;
      // can we simply step on top of it?
      const top = b.kind === 'ramp'
        ? this.topOver(b, Math.max(pos.x - r, b.min.x), Math.max(pos.z - r, b.min.z), Math.min(pos.x + r, b.max.x), Math.min(pos.z + r, b.max.z))
        : b.max.y;
      const rise = top - pos.y;
      if (rise > 0 && rise <= PLAYER.stepHeight && this.fits(pos.x, top + EPS, pos.z, r, h)) {
        pos.y = top + EPS;
        res.stepped += rise;
        ent.onGround = true;
        if (ent.vel.y < 0) ent.vel.y = 0;
        continue;
      }
      if (rise <= 0 && b.kind === 'ramp') continue;      // walking off a slope
      // blocked: push back out along the moving axis
      if (amount > 0) pos[axis] = (axis === 'x' ? b.min.x : b.min.z) - r - EPS;
      else pos[axis] = (axis === 'x' ? b.max.x : b.max.z) + r + EPS;
      ent.vel[axis] = 0;
      res.hitWall = true;
    }
  }

  /** Vertical move with head bump and floor stop. */
  _vertical(ent, amount, res) {
    if (amount === 0) return;
    const pos = ent.pos, r = ent.radius, h = ent.height;
    pos.y += amount;
    this._beginQuery();
    const cand = this.query(this.grid, pos.x - r, pos.z - r, pos.x + r, pos.z + r, this._tmpE || (this._tmpE = []));
    for (let i = 0; i < cand.length; i++) {
      const b = cand[i];
      if (!this._overlaps(b, pos.x - r, pos.y + EPS, pos.z - r, pos.x + r, pos.y + h - EPS, pos.z + r)) continue;
      const top = b.kind === 'ramp'
        ? this.topOver(b, Math.max(pos.x - r, b.min.x), Math.max(pos.z - r, b.min.z), Math.min(pos.x + r, b.max.x), Math.min(pos.z + r, b.max.z))
        : b.max.y;
      if (amount < 0) {                     // falling onto it
        pos.y = top;
        if (ent.vel.y < 0) { res.landSpeed = -ent.vel.y; ent.vel.y = 0; }
        ent.onGround = true;
      } else {                              // head bump
        pos.y = b.min.y - h - EPS;
        if (ent.vel.y > 0) ent.vel.y = 0;
      }
    }
  }

  _ladderAt(pos, r, h) {
    if (!this.climbs.length) return null;
    for (const b of this.climbs) {
      if (this._overlaps(b, pos.x - r, pos.y, pos.z - r, pos.x + r, pos.y + h, pos.z + r)) return b;
    }
    return null;
  }

  // --- ray casting ----------------------------------------------------------
  /** Slab interval of a ray against an AABB. @returns [t0,t1] or null */
  _slab(b, ox, oy, oz, dx, dy, dz, maxT) {
    let t0 = 0, t1 = maxT;
    const o = [ox, oy, oz], d = [dx, dy, dz];
    const mn = [b.min.x, b.min.y, b.min.z], mx = [b.max.x, b.max.y, b.max.z];
    let axis = -1, sgn = 1;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) { if (o[i] < mn[i] || o[i] > mx[i]) return null; continue; }
      const inv = 1 / d[i];
      let a = (mn[i] - o[i]) * inv, c = (mx[i] - o[i]) * inv, s = -1;
      if (a > c) { const t = a; a = c; c = t; s = 1; }
      if (a > t0) { t0 = a; axis = i; sgn = s; }
      if (c < t1) t1 = c;
      if (t0 > t1) return null;
    }
    return [t0, t1, axis, sgn];
  }

  _rayBrush(b, ox, oy, oz, dx, dy, dz, maxT, outN) {
    if (b.kind === 'ramp') {
      const s = this._slab(b, ox, oy, oz, dx, dy, dz, maxT);
      if (!s) return -1;
      const [t0, t1, axis, sgn] = s;
      const r = b.ramp;
      const a0 = r.axis === 'x' ? b.min.x : b.min.z;
      const a1 = r.axis === 'x' ? b.max.x : b.max.z;
      const oa = r.axis === 'x' ? ox : oz, da = r.axis === 'x' ? dx : dz;
      const k = (r.hi - r.lo) / Math.max(1e-6, a1 - a0);
      // f(t) = y(t) - surface(t)
      const A = oy - (r.lo + k * (oa - a0));
      const B = dy - k * da;
      const f0 = A + B * t0, f1 = A + B * t1;
      if (f0 <= 0) {
        if (axis === 0) { outN.x = sgn; outN.y = 0; outN.z = 0; }
        else if (axis === 1) { outN.x = 0; outN.y = sgn; outN.z = 0; }
        else if (axis === 2) { outN.x = 0; outN.y = 0; outN.z = sgn; }
        else { outN.x = 0; outN.y = 1; outN.z = 0; }
        return t0;
      }
      if (f1 > 0 || Math.abs(B) < 1e-9) return -1;
      const t = -A / B;
      if (t < t0 || t > t1) return -1;
      const len = Math.hypot(k, 1);
      if (r.axis === 'x') { outN.x = -k / len; outN.y = 1 / len; outN.z = 0; }
      else { outN.x = 0; outN.y = 1 / len; outN.z = -k / len; }
      return t;
    }
    if (b.kind === 'cyl') return this._rayCyl(b, ox, oy, oz, dx, dy, dz, maxT, outN);
    return rayBox(ox, oy, oz, dx, dy, dz, b, maxT, outN);
  }

  _rayCyl(b, ox, oy, oz, dx, dy, dz, maxT, outN) {
    const ax = b.cyl.axis || 'y';
    const cx = (b.min.x + b.max.x) / 2, cy = (b.min.y + b.max.y) / 2, cz = (b.min.z + b.max.z) / 2;
    // pick the two radial axes
    let p0, p1, d0, d1, c0, c1, along, dAlong, lo, hi;
    if (ax === 'y') { p0 = ox; p1 = oz; d0 = dx; d1 = dz; c0 = cx; c1 = cz; along = oy; dAlong = dy; lo = b.min.y; hi = b.max.y; }
    else if (ax === 'x') { p0 = oy; p1 = oz; d0 = dy; d1 = dz; c0 = cy; c1 = cz; along = ox; dAlong = dx; lo = b.min.x; hi = b.max.x; }
    else { p0 = ox; p1 = oy; d0 = dx; d1 = dy; c0 = cx; c1 = cy; along = oz; dAlong = dz; lo = b.min.z; hi = b.max.z; }
    const r = b.cyl.r;
    const ex = p0 - c0, ez = p1 - c1;
    const A = d0 * d0 + d1 * d1;
    const B = 2 * (ex * d0 + ez * d1);
    const C = ex * ex + ez * ez - r * r;
    let best = -1;
    if (A > 1e-9) {
      const disc = B * B - 4 * A * C;
      if (disc >= 0) {
        const sd = Math.sqrt(disc);
        for (const t of [(-B - sd) / (2 * A), (-B + sd) / (2 * A)]) {
          if (t < 0 || t > maxT) continue;
          const a = along + dAlong * t;
          if (a < lo || a > hi) continue;
          best = t;
          const nx = (p0 + d0 * t - c0) / r, nz = (p1 + d1 * t - c1) / r;
          if (ax === 'y') { outN.x = nx; outN.y = 0; outN.z = nz; }
          else if (ax === 'x') { outN.x = 0; outN.y = nx; outN.z = nz; }
          else { outN.x = nx; outN.y = nz; outN.z = 0; }
          break;
        }
      }
    }
    // caps
    if (Math.abs(dAlong) > 1e-9) {
      for (const cap of [lo, hi]) {
        const t = (cap - along) / dAlong;
        if (t < 0 || t > maxT || (best >= 0 && t > best)) continue;
        const q0 = p0 + d0 * t - c0, q1 = p1 + d1 * t - c1;
        if (q0 * q0 + q1 * q1 > r * r) continue;
        best = t;
        const s = cap === lo ? -1 : 1;
        if (ax === 'y') { outN.x = 0; outN.y = s; outN.z = 0; }
        else if (ax === 'x') { outN.x = s; outN.y = 0; outN.z = 0; }
        else { outN.x = 0; outN.y = 0; outN.z = s; }
      }
    }
    return best;
  }

  /**
   * Cast a ray through the world.
   * @param {THREE.Vector3} origin
   * @param {THREE.Vector3} dir       (normalised)
   * @param {number} maxDist
   * @param {{solidOnly?:boolean, ignoreSmoke?:boolean}} opts
   *        solidOnly → use movement solids instead of sight blockers
   * @returns {TraceResult}
   */
  trace(origin, dir, maxDist = 200, opts = {}) {
    const grid = opts.solidOnly ? this.grid : this.gridSight;
    const ox = origin.x, oy = origin.y, oz = origin.z;
    let dx = dir.x, dy = dir.y, dz = dir.z;
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;
    let bestT = maxDist, bestB = null;
    const n = { x: 0, y: 1, z: 0 }, nb = { x: 0, y: 1, z: 0 };

    // 2D DDA across the spatial hash
    let cx = Math.floor(ox / CELL), cz = Math.floor(oz / CELL);
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const tdx = stepX === 0 ? Infinity : CELL / Math.abs(dx);
    const tdz = stepZ === 0 ? Infinity : CELL / Math.abs(dz);
    let tmx = stepX === 0 ? Infinity : ((stepX > 0 ? (cx + 1) * CELL : cx * CELL) - ox) / dx;
    let tmz = stepZ === 0 ? Infinity : ((stepZ > 0 ? (cz + 1) * CELL : cz * CELL) - oz) / dz;
    this._beginQuery();
    let guard = 0;
    let t = 0;
    while (t <= maxDist && guard++ < 256) {
      const cell = grid.get(cx * 73856093 ^ cz * 19349663);
      if (cell) {
        for (let i = 0; i < cell.length; i++) {
          const b = cell[i];
          if (b._mark === this._qid) continue;
          b._mark = this._qid;
          const ht = this._rayBrush(b, ox, oy, oz, dx, dy, dz, bestT, nb);
          if (ht >= 0 && ht < bestT) { bestT = ht; bestB = b; n.x = nb.x; n.y = nb.y; n.z = nb.z; }
        }
      }
      const next = Math.min(tmx, tmz);
      if (bestB && bestT <= next) break;
      t = next;
      if (tmx < tmz) { cx += stepX; tmx += tdx; } else { cz += stepZ; tmz += tdz; }
      if (t === Infinity) break;
    }
    if (!bestB) {
      return { hit: false, dist: maxDist, point: new THREE.Vector3(ox + dx * maxDist, oy + dy * maxDist, oz + dz * maxDist), normal: new THREE.Vector3(0, 1, 0), brush: null, surface: SURFACE.SAND };
    }
    return {
      hit: true, dist: bestT,
      point: new THREE.Vector3(ox + dx * bestT, oy + dy * bestT, oz + dz * bestT),
      normal: new THREE.Vector3(n.x, n.y, n.z), brush: bestB,
      surface: bestB.surface || MAT_SURFACE[bestB.mat] || SURFACE.CONCRETE,
    };
  }

  /** Fast allocation-free "is there geometry between a and b" test. */
  blocked(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return false;
    _v1.set(dx / len, dy / len, dz / len);
    _v2.copy(a);
    const r = this.trace(_v2, _v1, len - 0.02, {});
    return r.hit;
  }

  /**
   * Line of sight between two eye/target points. Smoke clouds (and the smoke
   * above a molotov) block vision unless `opts.smoke === false`.
   */
  los(a, b, opts = {}) {
    if (this.blocked(a, b)) return false;
    if (opts.smoke === false) return true;
    return !this.smokeBlocks(a, b);
  }

  /** True when the segment a→b passes through any smoke volume. */
  smokeBlocks(a, b) {
    const n = this.smokes.length;
    if (!n) return false;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len2 = dx * dx + dy * dy + dz * dz;
    if (len2 < 1e-6) return false;
    for (let i = 0; i < n; i++) {
      const s = this.smokes[i];
      const r = s.radius;
      if (r <= 0.2) continue;
      const px = s.pos.x - a.x, py = s.pos.y - a.y, pz = s.pos.z - a.z;
      let t = (px * dx + py * dy + pz * dz) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = px - dx * t, qy = py - dy * t, qz = pz - dz * t;
      if (qx * qx + qy * qy + qz * qz < r * r * 0.86) return true;
    }
    return false;
  }

  fireAt(pos, feetOnly = true) {
    for (const f of this.fires) {
      const dx = pos.x - f.pos.x, dz = pos.z - f.pos.z;
      const dy = pos.y - f.pos.y;
      if (dx * dx + dz * dz < f.radius * f.radius && dy > -1.2 && dy < 2.0) return f;
    }
    return null;
  }

  /** Where a bullet leaves the brush it just entered (wall penetration). */
  exitPoint(brush, point, dir, out = new THREE.Vector3()) {
    const s = this._slab(brush, point.x - dir.x * 0.01, point.y - dir.y * 0.01, point.z - dir.z * 0.01,
      dir.x, dir.y, dir.z, 40);
    const t = s ? s[1] : 0.2;
    return out.set(point.x + dir.x * (t + 0.02), point.y + dir.y * (t + 0.02), point.z + dir.z * (t + 0.02));
  }

  /**
   * Can a player walk in a straight line from a to b? Used by the nav graph
   * builder and by bots for local steering.
   */
  canWalkBetween(a, b, radius = 0.36) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) return true;
    const steps = Math.max(2, Math.ceil(len / 0.55));
    let y = a.y;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = a.x + dx * t, z = a.z + dz * t;
      const g = this.groundY(x, z, y + PLAYER.stepHeight, radius);
      if (!g.brush) return false;                                 // no floor there at all
      if (g.y - y > PLAYER.stepHeight + 0.02) return false;      // wall / too steep
      if (y - g.y > 2.6) return false;                            // a drop that big is a cliff
      if (!this.fits(x, g.y + 0.05, z, radius, PLAYER.crouchHeight)) return false;
      y = g.y;
    }
    return Math.abs(y - b.y) < 2.8;
  }

  /** Coarse tactical area at a position (A site / mid / tunnels …). */
  areaAt(pos) {
    const boxes = this.mapDef.areaBoxes;
    if (boxes) {
      for (const a of boxes) {
        if (pos.x >= a.x0 && pos.x <= a.x1 && pos.z >= a.z0 && pos.z <= a.z1 &&
          (a.y0 === undefined || (pos.y >= a.y0 - 1 && pos.y <= a.y1 + 2))) return a.area;
      }
    }
    if (this.nav) {
      const n = this.nav.nearest(pos);
      if (n) return n.area;
    }
    return AREA.CONNECT;
  }

  /** Nudge a position to a legal standing spot (used by spawns and drops). */
  settle(pos, radius = PLAYER.radius, height = PLAYER.standHeight) {
    const g = this.groundY(pos.x, pos.z, pos.y + 1.2, radius);
    pos.y = g.y;
    if (this.fits(pos.x, pos.y + 0.05, pos.z, radius, height)) return pos;
    for (let ring = 1; ring <= 5; ring++) {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const x = pos.x + Math.cos(a) * ring * 0.7, z = pos.z + Math.sin(a) * ring * 0.7;
        const gg = this.groundY(x, z, pos.y + 1.6, radius);
        if (this.fits(x, gg.y + 0.05, z, radius, height)) { pos.set(x, gg.y, z); return pos; }
      }
    }
    return pos;
  }
}










