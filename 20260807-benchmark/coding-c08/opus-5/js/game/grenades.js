// ============================================================================
// grenades.js — utility system: HE, flashbang, smoke, molotov / incendiary and
// decoy.  Owns projectile physics (swept traces against the real brush
// geometry, per-surface restitution and rolling), every detonation effect
// (LOS-scaled blast damage, blindness, smoke volumes, fire patches, decoy
// gunshots), the ballistic solver used by bots and by the trajectory preview,
// and the procedural projectile meshes.
//
// Headless safe: `game.scene`, `game.fx` and `game.audio` are all optional, so
// the whole system runs (and is unit tested) inside Node.
// ============================================================================

import * as THREE from 'three';
import { PHYS, PLAYER, SOUND_RANGE, SURFACE } from '../core/constants.js';
import { clamp, clamp01, rand, randInt, pick, smoothstep, uid, RAD } from '../core/util.js';

// weapons.js belongs to another module and may not exist yet — pull it in
// lazily and fall back to the local table so importing us can never fail.
let WEAPONS = null;
import('./weapons.js').then((m) => { if (m && m.WEAPONS) WEAPONS = m.WEAPONS; }).catch(() => {});

/** Fallback grenade tuning; any field weapons.js supplies wins over these. */
const SPEC = {
  he: { kind: 'he', fuse: 1.6, radius: 5.5, damage: 98, throwSpeed: 21, bounce: 0.45, life: 1.6 },
  flash: { kind: 'flash', fuse: 1.55, radius: 8, damage: 2, throwSpeed: 21, bounce: 0.45, life: 1.55 },
  smoke: { kind: 'smoke', fuse: 1.7, radius: 4.6, damage: 0, throwSpeed: 21, bounce: 0.3, life: 18 },
  molotov: { kind: 'fire', fuse: 2, radius: 3.2, damage: 9, throwSpeed: 20, bounce: 0.06, life: 7 },
  incendiary: { kind: 'fire', fuse: 2, radius: 3.2, damage: 9, throwSpeed: 20, bounce: 0.06, life: 7 },
  decoy: { kind: 'decoy', fuse: 1.8, radius: 2.6, damage: 10, throwSpeed: 20, bounce: 0.4, life: 10 },
};
const ALIAS = {
  hegrenade: 'he', frag: 'he', flashbang: 'flash', smokegrenade: 'smoke',
  molly: 'molotov', firebomb: 'incendiary', inc: 'incendiary',
};
// Smallest `life` (seconds) that can plausibly belong to each kind; anything
// below is treated as a missing field.
const LIFE_MIN = { he: 0.2, flash: 0.2, smoke: 6, fire: 3, decoy: 4 };

// --- per surface bounce behaviour -------------------------------------------
// restitution (normal component kept), tangential keep, rolling drag (m/s²)
const BOUNCE = {
  [SURFACE.METAL]: 0.46, [SURFACE.CONCRETE]: 0.45, [SURFACE.TILE]: 0.44,
  [SURFACE.GLASS]: 0.40, [SURFACE.WOOD]: 0.30, [SURFACE.DIRT]: 0.19,
  [SURFACE.SAND]: 0.17, [SURFACE.FABRIC]: 0.12, [SURFACE.WATER]: 0.05,
};
const TANGENT = {
  [SURFACE.METAL]: 0.84, [SURFACE.CONCRETE]: 0.80, [SURFACE.TILE]: 0.82,
  [SURFACE.GLASS]: 0.86, [SURFACE.WOOD]: 0.72, [SURFACE.DIRT]: 0.58,
  [SURFACE.SAND]: 0.52, [SURFACE.FABRIC]: 0.42, [SURFACE.WATER]: 0.35,
};
const ROLL_DRAG = {
  [SURFACE.METAL]: 1.6, [SURFACE.CONCRETE]: 2.2, [SURFACE.TILE]: 1.8,
  [SURFACE.GLASS]: 1.4, [SURFACE.WOOD]: 2.8, [SURFACE.DIRT]: 5.0,
  [SURFACE.SAND]: 6.0, [SURFACE.FABRIC]: 7.5, [SURFACE.WATER]: 9.0,
};
const BOUNCE_DEF = 0.35, TANGENT_DEF = 0.75, DRAG_DEF = 2.5;

// --- tunables ---------------------------------------------------------------
const SKIN = 0.055;                 // projectile radius used by the swept trace
const MAX_LIVE = 16;                // hard cap on simultaneous projectiles
const THROW = { full: 21, lob: 12, drop: 4, fwd: 0.35, right: 0.12, inherit: 0.4 };
// HE blast: dmg = damage * (1 - t)^falloff * vis * (armor ? kevlar : 1)
const BLAST = { core: 0.45, falloff: 1.5, kevlar: 0.75, chest: 0.45, head: 0.275, feet: 0.275 };
// Flash: s = angF^1.15 * distF   →   hold = 2.7s, fade = 2.4s at s = 1
// (calibrated so 70° off axis at 15 m ends up at ~0.4 s of total blindness)
const FLASH = { hold: 2.7, fade: 2.4, near: 5, far: 18.75, coneFull: 12, coneZero: 100, min: 0.12, maxDist: 32 };
const SMOKE = { radius: 4.6, grow: 1.4, life: 15, fade: 3, min: 0.5, hiss: 4.5 };
const FIRE = { life: 7, dps: 9, tick: 0.25, patchR: 1.15, spread: 3.2, minPatch: 4, maxPatch: 7, weakLife: 0.45, weakDps: 0.6 };
const DECOY = { gap: [0.5, 1.1], duration: 10, damage: 10, radius: 2.6 };
const PUFF = { radius: 1.6, life: 1.2 };          // HE muzzle-of-blast smoke puff
const GUNSHOTS = [
  'shoot_ak', 'shoot_m4', 'shoot_rifle', 'shoot_smg', 'shoot_pistol',
  'shoot_pistol_big', 'shoot_auto', 'shoot_scout', 'shoot_shotgun',
];
const PREVIEW_MAX = 192;
const TRAIL_LEN = 14;
const EMBER_MAX = 28;

// module scratch (single threaded; never held across a call boundary)
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
// Grenades are physical objects: they collide with movement solids (including
// invisible clip brushes) and fly straight through smoke.
const TRACE_OPTS = Object.freeze({ solidOnly: true, ignoreSmoke: true });
const NO_HIT = Object.freeze({
  hit: false, dist: Infinity, point: Object.freeze({ x: 0, y: 0, z: 0 }),
  normal: UP, brush: null, surface: SURFACE.CONCRETE,
});

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const vecOk = (v) => !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

/**
 * Forward vector for a yaw/pitch pair — same convention as game/actor.js:
 * yaw 0 looks along +X and POSITIVE pitch looks down.
 */
export function dirFromAngles(yaw, pitch, out = new THREE.Vector3()) {
  const cp = Math.cos(pitch);
  return out.set(Math.cos(yaw) * cp, -Math.sin(pitch), Math.sin(yaw) * cp);
}
/** Inverse of dirFromAngles. */
export function anglesFromDir(d) {
  return { yaw: Math.atan2(d.z, d.x), pitch: -Math.atan2(d.y, Math.hypot(d.x, d.z)) };
}

/**
 * @typedef {Object} SmokeVolume  pushed into `game.world.smokes`
 * @property {string} id
 * @property {'smoke'} kind
 * @property {THREE.Vector3} pos     cloud centre
 * @property {number} radius         LIVE radius in metres (grows / shrinks)
 * @property {number} t              age in seconds
 * @property {number} until          game.time at which it is removed
 * @property {'smoke'|'he'|'fire'} source
 */
/**
 * @typedef {Object} FireVolume  pushed into `game.world.fires`
 * @property {string} id
 * @property {'fire'} kind
 * @property {THREE.Vector3} pos     patch centre, on the floor
 * @property {number} radius         LIVE radius in metres
 * @property {number} t
 * @property {number} until
 * @property {number} dps
 */

export class GrenadeSystem {
  constructor(game) {
    this.game = game;
    this._proj = [];          // live projectiles
    this._smokes = [];        // smoke volumes we own (also in world.smokes)
    this._fires = [];         // fire patches we own (also in world.fires)
    this._fields = [];        // molotov fields (group of patches + shared audio)
    this._flash = new Map();  // actor -> { hold, fade, t }
    this._burn = new Map();   // actor -> fractional burn damage carry
    this._previews = new Map();
    this._embers = [];
    this._protos = new Map();
    this._geos = [];
    this._mats = [];
    this._fireAcc = 0;
    this._ring = null;        // tinnitus loop handle for the local player
    this._ringActor = null;
    this._disposed = false;
    this.maxLive = MAX_LIVE;
    const w = game && game.world;
    if (w) {
      if (!Array.isArray(w.smokes)) w.smokes = [];
      if (!Array.isArray(w.fires)) w.fires = [];
    }
  }

  get projectiles() { return this._proj; }
  get smokes() { return this._smokes; }
  get fires() { return this._fires; }
  get time() { return num(this.game && this.game.time, 0); }

  // -------------------------------------------------------------------------
  // spec / small accessors
  // -------------------------------------------------------------------------
  /**
   * Resolve the grenade tuning for a weapon id, merging weapons.js over ours.
   * Values that cannot be right for the kind (a 1.6 s smoke, a 0 damage HE)
   * fall back to the local table so a partially filled entry can never break
   * the gameplay.
   */
  specFor(type) {
    const alias = ALIAS[type] || type;
    const id = SPEC[alias] ? alias : 'he';        // unknown ids fall back to HE
    const base = SPEC[id];
    const w = WEAPONS && WEAPONS[id] && WEAPONS[id].grenade;
    const rawKind = (w && typeof w.kind === 'string' && w.kind) || base.kind;
    const kind = rawKind === 'incendiary' || rawKind === 'molotov' ? 'fire' : rawKind;
    const dmg = num(w && w.damage, 0);
    const life = num(w && w.life, 0);
    return {
      id,
      kind,
      fuse: Math.max(0.15, num(w && w.fuse, base.fuse)),
      radius: Math.max(0.5, num(w && w.radius, base.radius)),
      damage: dmg > 0 ? dmg : base.damage,
      throwSpeed: Math.max(1, num(w && w.throwSpeed, base.throwSpeed)),
      bounce: clamp(num(w && w.bounce, base.bounce), 0, 1.5),
      life: life >= (LIFE_MIN[kind] || 0.2) ? life : base.life,
    };
  }

  /** Eye position of an actor (falls back to feet + stand height). */
  _eye(actor, out = new THREE.Vector3()) {
    if (vecOk(actor && actor.eye)) return out.set(actor.eye.x, actor.eye.y, actor.eye.z);
    const p = (actor && actor.pos) || { x: 0, y: 0, z: 0 };
    const h = num(actor && actor.height, PLAYER.standHeight);
    return out.set(num(p.x, 0), num(p.y, 0) + h - PLAYER.eyeDrop, num(p.z, 0));
  }

  /** Aim direction: actor.aimDir() when available (it folds in recoil). */
  _aimDir(actor, out = new THREE.Vector3()) {
    if (actor && typeof actor.aimDir === 'function') {
      try {
        const r = actor.aimDir(out);
        if (vecOk(r) && (r.x || r.y || r.z)) {
          if (r !== out) out.set(r.x, r.y, r.z);
          return out.normalize();
        }
      } catch (err) { /* fall back to yaw / pitch */ }
    }
    const d = actor && (actor.viewDir || actor.look);
    if (vecOk(d) && (d.x || d.y || d.z)) return out.set(d.x, d.y, d.z).normalize();
    return dirFromAngles(num(actor && actor.yaw, 0), num(actor && actor.pitch, 0), out);
  }

  _body(actor, frac, out = new THREE.Vector3()) {
    const p = (actor && actor.pos) || { x: 0, y: 0, z: 0 };
    const h = num(actor && actor.height, PLAYER.standHeight);
    return out.set(num(p.x, 0), num(p.y, 0) + h * frac, num(p.z, 0));
  }

  // -------------------------------------------------------------------------
  // throwing
  // -------------------------------------------------------------------------
  /** Spawn position + velocity a throw would produce (no side effects). */
  _spawnState(actor, type, opts = {}) {
    if (!actor || !actor.pos) return null;
    const spec = this.specFor(type);
    const fwd = this._aimDir(actor, new THREE.Vector3());
    // `right` matches the actor's strafe basis (-Z when facing +X)
    const right = new THREE.Vector3().crossVectors(UP, fwd);
    if (right.lengthSq() < 1e-6) right.set(0, 0, -1); else right.normalize();
    const pos = this._eye(actor, new THREE.Vector3())
      .addScaledVector(fwd, THROW.fwd)
      .addScaledVector(right, THROW.right);
    const base = opts.drop ? THROW.drop : opts.lob ? THROW.lob : spec.throwSpeed;
    const speed = base * clamp(num(opts.power, 1), 0.15, 1.5);
    const vel = fwd.clone().multiplyScalar(speed);
    const av = (actor.vel || actor.velocity);
    if (vecOk(av)) vel.addScaledVector(_v1.set(av.x, av.y, av.z), THROW.inherit);
    return { pos, vel, spec, fwd, right, speed };
  }

  /**
   * Throw a grenade from `actor`.
   * @param {Object} actor
   * @param {string} type   'he'|'flash'|'smoke'|'molotov'|'incendiary'|'decoy'
   * @param {{power?:number,lob?:boolean,drop?:boolean}} [opts]
   * @returns {Object|null} the projectile
   */
  throwFrom(actor, type, opts = {}) {
    if (this._disposed) return null;
    const st = this._spawnState(actor, type, opts);
    if (!st) return null;
    // hard cap: drop the oldest projectile rather than growing without bound
    while (this._proj.length >= this.maxLive) this._removeProjectile(this._proj[0]);
    const spec = st.spec;
    const t = this.time;
    const p = {
      id: uid('nade'),
      type: spec.id,
      kind: spec.kind,
      spec,
      owner: actor,
      team: actor.team,
      pos: st.pos,
      vel: st.vel,
      spin: new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(7, 13)),
      born: t,
      age: 0,
      fuse: spec.fuse,
      armed: false,
      bounceScale: clamp(spec.bounce / 0.45, 0.15, 2.2),
      shatter: spec.kind === 'fire',
      surface: SURFACE.CONCRETE,
      ground: null,
      rest: false,
      restAt: 0,
      bounces: 0,
      lastBounceSnd: -1,
      decoyStart: null,
      nextChirp: 0,
      done: false,
      mesh: null, trail: null, trailPts: null, emberAt: 0,
    };
    this._proj.push(p);
    this._buildVisual(p);
    this._play('nade_pin', p.pos, 0.55, rand(0.96, 1.05));
    this._play('nade_throw', p.pos, 0.75, rand(0.95, 1.06));
    this._noise(p.pos, 'nade_throw', p.team, 11);
    this._emit('nade_throw', {
      actor, type: p.type, kind: p.kind, pos: p.pos.clone(), vel: p.vel.clone(), projectile: p,
    });
    return p;
  }

  // -------------------------------------------------------------------------
  // main tick
  // -------------------------------------------------------------------------
  update(dt) {
    if (this._disposed) return;
    dt = clamp(num(dt, 0), 0, 0.25);
    if (dt <= 0) return;
    for (let i = this._proj.length - 1; i >= 0; i--) {
      const p = this._proj[i];
      p.age += dt;
      if (!p.armed && p.age >= 0.05) p.armed = true;
      this._stepProjectile(p, dt);
      if (p.done) continue;
      this._fuseCheck(p);
      if (p.done) continue;
      this._updateVisual(p, dt);
    }
    this._updateSmokes(dt);
    this._updateFires(dt);
    this._updateFlash(dt);
    this._updateEmbers(dt);
    this.updatePreview();
  }

  /** Fuse / decoy timing. Fire grenades detonate on contact (see _impact). */
  _fuseCheck(p) {
    if (p.type === 'decoy') { this._decoyTick(p); return; }
    if (p.kind === 'fire') {
      // safety net: a bottle that somehow never touches anything still ignites
      if (p.age >= p.fuse + 2.5) this._detonate(p, p.pos, UP);
      return;
    }
    if (p.age >= p.fuse) this._detonate(p, p.pos, UP);
  }

  // -------------------------------------------------------------------------
  // physics
  // -------------------------------------------------------------------------
  /** Substep so a fast grenade never moves more than ~0.22 m per collision test. */
  _stepProjectile(p, dt) {
    if (!vecOk(p.pos) || !vecOk(p.vel)) { this._removeProjectile(p); return; }
    const speed = p.vel.length();
    const steps = clamp(Math.ceil((speed * dt) / 0.22), 1, 12);
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this._integrate(p, h);
      if (p.done) return;
    }
  }

  _integrate(p, h) {
    const g = num(PHYS.gravity, 15.2);
    p.vel.y -= g * h;
    if (p.ground) {
      // resting / rolling contact: cancel the into-surface component so gravity
      // only drives motion along the plane, then apply rolling drag.
      const n = p.ground;
      const vn = p.vel.dot(n);
      if (vn < 0) p.vel.addScaledVector(n, -vn);
      const drag = (ROLL_DRAG[p.surface] || DRAG_DEF) * (n.y > 0.999 ? 1 : 0.6);
      const sp = p.vel.length();
      const lost = drag * h;
      if (sp <= lost) p.vel.set(0, 0, 0);
      else p.vel.multiplyScalar((sp - lost) / sp);
    }
    const move = _v1.copy(p.vel).multiplyScalar(h);
    const dist = move.length();
    if (dist < 1e-6) {
      if (p.ground) { if (!p.rest) { p.rest = true; p.restAt = this.time; } }
      return;
    }
    const dir = _v2.copy(move).divideScalar(dist);
    const tr = this._trace(p.pos, dir, dist + SKIN);
    if (tr.hit && tr.dist <= dist + SKIN) {
      const n = _v3.set(tr.normal.x, tr.normal.y, tr.normal.z);
      if (n.lengthSq() < 1e-8) n.copy(UP); else n.normalize();
      p.pos.set(tr.point.x, tr.point.y, tr.point.z).addScaledVector(n, SKIN);
      this._impact(p, n, tr.surface || SURFACE.CONCRETE, tr);
      if (p.done) return;
    } else {
      p.pos.addScaledVector(dir, dist);
      if (p.ground) {
        // stay glued to the floor while rolling so it follows slopes instead
        // of micro-bouncing down them
        const probe = this._trace(p.pos, DOWN, SKIN + 0.12);
        if (probe.hit && num(probe.normal.y, 0) > 0.55) {
          const pn = _v4.set(probe.normal.x, probe.normal.y, probe.normal.z).normalize();
          p.pos.set(probe.point.x, probe.point.y, probe.point.z).addScaledVector(pn, SKIN);
          p.ground.copy(pn);
          p.surface = probe.surface || p.surface;
          const vn2 = p.vel.dot(pn);
          if (vn2 < 0) p.vel.addScaledVector(pn, -vn2);
        } else { p.ground = null; p.rest = false; }
      } else p.rest = false;
    }
    this._blockActors(p);
    this._clampBounds(p);
  }
  /** Resolve a surface hit: restitution, friction, settling, sound, shatter. */
  _impact(p, n, surface, tr) {
    p.surface = surface;
    const vn = p.vel.dot(n);
    const impact = Math.abs(Math.min(0, vn));
    // molotov / incendiary: shatters on the first real contact (floor or wall)
    if (p.shatter && p.armed && impact > 0.8) { this._detonate(p, p.pos, n); return; }
    const e = (BOUNCE[surface] === undefined ? BOUNCE_DEF : BOUNCE[surface]) * p.bounceScale;
    const keep = TANGENT[surface] === undefined ? TANGENT_DEF : TANGENT[surface];
    const vt = _v4.copy(p.vel).addScaledVector(n, -vn);
    const settle = impact < 0.9 && n.y > 0.55;
    if (settle) {
      p.vel.copy(vt).multiplyScalar(keep);
      p.ground = (p.ground || new THREE.Vector3()).copy(n);
      if (p.vel.lengthSq() < 0.02 && n.y > 0.985) {
        p.vel.set(0, 0, 0);
        if (!p.rest) { p.rest = true; p.restAt = this.time; }
      }
      return;
    }
    p.vel.copy(vt).multiplyScalar(keep).addScaledVector(n, impact * e);
    p.ground = n.y > 0.55 && impact * e < 1.1 ? (p.ground || new THREE.Vector3()).copy(n) : null;
    p.rest = false;
    p.bounces++;
    // tumble harder the harder it lands
    p.spin.set(rand(-1, 1), rand(-1, 1), rand(-1, 1));
    if (p.spin.lengthSq() < 1e-6) p.spin.set(0, 1, 0);
    p.spin.normalize().multiplyScalar(clamp(impact * 2.4 + 4, 3, 26));
    const t = this.time;
    if (impact > 1.1 && t - p.lastBounceSnd > 0.06) {
      p.lastBounceSnd = t;
      const vol = clamp01(impact / 9) * 0.85 + 0.15;
      this._play('nade_bounce', p.pos, vol, rand(0.9, 1.12));
      this._fx('impact', p.pos.clone(), n.clone(), surface);
      const range = clamp(num(SOUND_RANGE.nade_bounce, 16) * clamp01(impact / 7), 4, 22);
      this._noise(p.pos, 'nade_bounce', p.team, range);
    }
    if (tr && tr.brush && tr.brush.water) p.vel.multiplyScalar(0.55);
  }

  /** Grenades bounce off bodies (no damage). Cylinder approximation. */
  _blockActors(p) {
    const list = (this.game && this.game.actors) || [];
    const rad = num(PLAYER.radius, 0.42) + 0.07;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a || !a.alive || !a.pos) continue;
      if (a === p.owner && this.time - p.born < 0.2) continue;
      const h = num(a.height, PLAYER.standHeight);
      if (p.pos.y < a.pos.y - 0.1 || p.pos.y > a.pos.y + h + 0.1) continue;
      let dx = p.pos.x - a.pos.x, dz = p.pos.z - a.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > rad * rad) continue;
      let d = Math.sqrt(d2);
      if (d < 1e-3) { dx = 1; dz = 0; d = 1; }
      const nx = dx / d, nz = dz / d;
      p.pos.x = a.pos.x + nx * rad * 1.02;
      p.pos.z = a.pos.z + nz * rad * 1.02;
      const vn = p.vel.x * nx + p.vel.z * nz;
      if (vn < 0) {
        p.vel.x -= 1.5 * vn * nx;
        p.vel.z -= 1.5 * vn * nz;
        p.vel.multiplyScalar(0.68);
        if (this.time - p.lastBounceSnd > 0.08) {
          p.lastBounceSnd = this.time;
          this._play('nade_bounce', p.pos, 0.35, rand(0.85, 0.95));
        }
      }
      break;
    }
  }

  /** Never let a projectile escape the map. */
  _clampBounds(p) {
    const b = this.game && this.game.world && this.game.world.bounds;
    if (!vecOk(p.pos)) { this._removeProjectile(p); return; }
    if (!b || !b.min || !b.max) return;
    const m = 0.2;
    const lo = b.min, hi = b.max;
    if (p.pos.x < lo.x + m) { p.pos.x = lo.x + m; p.vel.x = Math.abs(p.vel.x) * 0.3; }
    else if (p.pos.x > hi.x - m) { p.pos.x = hi.x - m; p.vel.x = -Math.abs(p.vel.x) * 0.3; }
    if (p.pos.z < lo.z + m) { p.pos.z = lo.z + m; p.vel.z = Math.abs(p.vel.z) * 0.3; }
    else if (p.pos.z > hi.z - m) { p.pos.z = hi.z - m; p.vel.z = -Math.abs(p.vel.z) * 0.3; }
    if (p.pos.y > hi.y - m) { p.pos.y = hi.y - m; p.vel.y = -Math.abs(p.vel.y) * 0.3; }
    else if (p.pos.y < lo.y + m) {
      p.pos.y = lo.y + m;
      p.vel.y = 0;
      p.ground = (p.ground || new THREE.Vector3()).copy(UP);
      p.vel.x *= 0.6; p.vel.z *= 0.6;
    }
  }

  // -------------------------------------------------------------------------
  // detonation dispatch
  // -------------------------------------------------------------------------
  _detonate(p, at, normal) {
    if (p.done) return;
    const pos = new THREE.Vector3(at.x, at.y, at.z);
    const n = vecOk(normal) ? _v5.set(normal.x, normal.y, normal.z) : _v5.copy(UP);
    p.done = true;
    switch (p.kind) {
      case 'flash': this._flashbang(p, pos); break;
      case 'smoke': this._deploySmoke(p, pos); break;
      case 'fire': this._ignite(p, pos, n); break;
      case 'decoy':
        this._blast(pos, {
          damage: DECOY.damage, radius: DECOY.radius, owner: p.owner,
          team: p.team, type: p.type, puff: 0.7,
        });
        break;
      default: this._blast(pos, {
        damage: p.spec.damage, radius: p.spec.radius, owner: p.owner,
        team: p.team, type: p.type, puff: 1,
      });
    }
    this._emit('nade_detonate', {
      type: p.type, kind: p.kind, pos: pos.clone(), actor: p.owner, team: p.team,
    });
    this._removeProjectile(p);
  }

  // -------------------------------------------------------------------------
  // 3 — HE blast (also used by the decoy's final pop)
  // -------------------------------------------------------------------------
  /**
   * Explosive damage with 3-ray line-of-sight scaling.
   * dmg = damage * (1 - t)^1.5 * vis * (armor ? 0.75 : 1)
   * where t = (d - 0.45) / (radius - 0.45) and vis is 0.45/0.275/0.275 for a
   * clear chest / head / feet ray (fully blocked ⇒ no damage at all).
   */
  _blast(pos, o) {
    const radius = Math.max(0.5, o.radius);
    const list = (this.game && this.game.actors) || [];
    const ff = !!(this.game && this.game.cfg && this.game.cfg.friendlyFire);
    const hits = [];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a || !a.alive || !a.pos) continue;
      const chest = this._body(a, 0.62, _v1);
      const d = chest.distanceTo(pos);
      if (d > radius) continue;
      const self = a === o.owner;
      if (!self && !ff && o.owner && a.team && a.team === o.team) continue;
      let vis = 0;
      if (this._los(pos, chest, false)) vis += BLAST.chest;
      if (this._los(pos, this._body(a, 0.94, _v2), false)) vis += BLAST.head;
      if (this._los(pos, this._body(a, 0.08, _v2), false)) vis += BLAST.feet;
      if (vis <= 0) continue;
      const t = clamp01((d - BLAST.core) / Math.max(radius - BLAST.core, 0.1));
      const fall = Math.pow(1 - t, BLAST.falloff);
      const raw = o.damage * fall * vis;
      let dmg = raw;
      const armor = num(a.armor, 0);
      if (armor > 0) {
        dmg *= BLAST.kevlar;
        a.armor = Math.max(0, armor - (raw - dmg) * 0.5);   // kevlar wears down
      }
      dmg = Math.round(dmg);
      if (dmg < 1) continue;
      const dir = _v3.copy(chest).sub(pos);
      if (dir.lengthSq() < 1e-8) dir.copy(UP); else dir.normalize();
      this._hurt(a, dmg, o.owner, 'chest', o.type, dir);
      hits.push({ actor: a, dmg, dist: d, vis });
    }
    this._fx('explosion', pos, radius);
    this._play('explode_he', pos, 1, rand(0.94, 1.06));
    this._noise(pos, 'explode', o.team, num(SOUND_RANGE.shoot, 60));
    const local = this.game && this.game.local;
    if (local && local.pos) {
      const d = this._eye(local, _v4).distanceTo(pos);
      const amp = clamp01(1 - d / (radius * 3.4));
      if (amp > 0.01) this._fx('shake', amp * 0.95 * (o.puff || 1), 0.28 + amp * 0.35);
    }
    if (o.puff) {
      this._addSmoke(pos, {
        maxRadius: PUFF.radius * o.puff, grow: 0.25, life: PUFF.life, fade: 0.5,
        source: 'he', owner: o.owner, team: o.team, quiet: true,
      });
    }
    return hits;
  }

  // -------------------------------------------------------------------------
  // 4 — flashbang
  // -------------------------------------------------------------------------
  /**
   * Blindness = angF^1.15 * distF, with angF ramping 1→0 between 12° and 100°
   * off the view axis and distF ramping 1→0 between 5 m and 18 m.  A wall or a
   * smoke cloud between the blast and the eye blocks it completely.
   */
  _flashbang(p, pos) {
    const list = (this.game && this.game.actors) || [];
    const local = this.game && this.game.local;
    let localAmount = 0;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a || !a.alive || !a.pos) continue;
      const eye = this._eye(a, _v1);
      const d = eye.distanceTo(pos);
      if (d > FLASH.maxDist) continue;
      if (!this._los(pos, eye, true)) continue;
      const toBlast = _v2.copy(pos).sub(eye);
      if (toBlast.lengthSq() < 1e-8) toBlast.copy(UP); else toBlast.normalize();
      const view = this._aimDir(a, _v3);
      const ang = Math.acos(clamp(view.dot(toBlast), -1, 1)) * RAD;
      if (ang >= FLASH.coneZero) continue;
      const angF = clamp01(1 - (ang - FLASH.coneFull) / (FLASH.coneZero - FLASH.coneFull));
      const distF = d <= FLASH.near ? 1 : clamp01(1 - (d - FLASH.near) / (FLASH.far - FLASH.near));
      const s = Math.pow(angF, 1.15) * distF;
      const hold = FLASH.hold * s, fade = FLASH.fade * s;
      if (hold + fade < FLASH.min) continue;
      const prev = this._flash.get(a);
      if (prev) {
        const left = Math.max(0, prev.hold + prev.fade - prev.t);
        if (left >= hold + fade) continue;              // keep the stronger flash
      }
      this._flash.set(a, { hold, fade, t: 0, amount: s });
      a.flashAmount = 1;
      a.flashTime = hold + fade;      // actor.js reads this for its own decay
      if (a === local) localAmount = Math.max(localAmount, s);
      this._emit('flash', {
        actor: a, amount: s, hold, fade, duration: hold + fade,
        pos: pos.clone(), attacker: p.owner, dist: d, angle: ang,
      });
    }
    this._fx('flashPop', pos);
    this._play('explode_flash', pos, 1, rand(0.96, 1.05));
    this._noise(pos, 'explode', p.team, 40);
    if (localAmount > 0.05) {
      this._stopHandle(this._ring);
      this._ring = this._loop('flash_ring', pos, localAmount);
      this._ringActor = local;
    }
    if (localAmount > 0.2) this._fx('shake', localAmount * 0.35, 0.25);
  }

  /** Own the blindness decay: hold at full white, then a soft tail. */
  _updateFlash(dt) {
    if (!this._flash.size) return;
    for (const [a, f] of this._flash) {
      f.t += dt;
      if (!a || a.alive === false) {
        if (a) a.flashAmount = 0;
        this._flash.delete(a);
        if (a === this._ringActor) { this._stopHandle(this._ring); this._ring = null; this._ringActor = null; }
        continue;
      }
      const total = f.hold + f.fade;
      if (f.t >= total) {
        a.flashAmount = 0;
        this._flash.delete(a);
        if (a === this._ringActor) { this._stopHandle(this._ring); this._ring = null; this._ringActor = null; }
        continue;
      }
      const amt = f.t < f.hold ? 1 : Math.pow(1 - clamp01((f.t - f.hold) / Math.max(f.fade, 1e-3)), 1.6);
      a.flashAmount = amt;
      if (a === this._ringActor && this._ring) this._setHandleVolume(this._ring, amt * f.amount);
    }
  }

  // -------------------------------------------------------------------------
  // 5 — smoke
  // -------------------------------------------------------------------------
  _deploySmoke(p, pos) {
    // settle onto the floor it is lying on so the cloud sits at chest height
    const centre = pos.clone();
    const down = this._trace(_v1.copy(pos).addScaledVector(UP, 0.15), _v2.copy(UP).negate(), 3.2);
    if (down.hit) centre.set(down.point.x, down.point.y + 1.0, down.point.z);
    // spec.life is the total cloud time (grow + hold + dissipate)
    const total = Math.max(SMOKE.fade + 1, num(p.spec.life, SMOKE.life + SMOKE.fade));
    const vol = this._addSmoke(centre, {
      maxRadius: Math.max(1.5, p.spec.radius), grow: SMOKE.grow, life: total - SMOKE.fade,
      fade: SMOKE.fade, source: 'smoke', owner: p.owner, team: p.team,
    });
    this._noise(centre, 'smoke', p.team, 22);
    // a smoke landing on burning ground puts the fire out
    this._extinguish(vol);
    return vol;
  }

  /** Create + register a smoke volume. Returns the volume object. */
  _addSmoke(centre, o) {
    const t = this.time;
    const life = Math.max(0.2, num(o.life, SMOKE.life));
    const fade = Math.max(0.05, num(o.fade, SMOKE.fade));
    const grow = Math.max(0.05, num(o.grow, SMOKE.grow));
    const maxRadius = Math.max(0.4, num(o.maxRadius, SMOKE.radius));
    const vol = {
      id: uid('smoke'),
      kind: 'smoke',
      pos: centre.clone(),
      radius: Math.min(SMOKE.min, maxRadius),
      t: 0,
      until: t + life + fade,
      maxRadius, grow, life, fade,
      source: o.source || 'smoke',
      weak: o.source === 'fire',
      owner: o.owner || null,
      team: o.team || null,
      fx: null, loop: null,
    };
    this._smokes.push(vol);
    const w = this.game && this.game.world;
    if (w && Array.isArray(w.smokes)) w.smokes.push(vol);
    vol.fx = this._fxHandle('smoke', vol.pos, maxRadius, life + fade);
    if (!o.quiet) {
      this._play('smoke_pop', vol.pos, 0.9, rand(0.95, 1.06));
      vol.loop = this._loop('smoke_hiss', vol.pos, 0.8);
    }
    return vol;
  }

  _updateSmokes(dt) {
    const t = this.time;
    for (let i = this._smokes.length - 1; i >= 0; i--) {
      const s = this._smokes[i];
      s.t += dt;
      const total = s.life + s.fade;
      if (s.t >= total || t >= s.until) { this._removeSmoke(s); continue; }
      // grow → hold → dissipate; `radius` stays live for world.los
      if (s.t < s.grow) s.radius = Math.max(s.radius, s.maxRadius * smoothstep(s.t / s.grow));
      else if (s.t <= s.life) s.radius = s.maxRadius;
      else s.radius = s.maxRadius * clamp01(1 - (s.t - s.life) / s.fade);
      if (s.loop && s.t > SMOKE.hiss) { this._stopHandle(s.loop); s.loop = null; }
      if (s.source === 'smoke' && s.t > 0.1) this._extinguish(s);
    }
  }

  _removeSmoke(s) {
    const i = this._smokes.indexOf(s);
    if (i >= 0) this._smokes.splice(i, 1);
    const w = this.game && this.game.world;
    if (w && Array.isArray(w.smokes)) {
      const j = w.smokes.indexOf(s);
      if (j >= 0) w.smokes.splice(j, 1);
    }
    s.radius = 0;
    this._stopHandle(s.fx); s.fx = null;
    this._stopHandle(s.loop); s.loop = null;
  }

  /** Any fire patch under this cloud dies quickly. */
  _extinguish(s) {
    if (!s || !this._fires.length) return;
    for (let i = this._fires.length - 1; i >= 0; i--) {
      const f = this._fires[i];
      if (f.dying) continue;
      if (Math.abs(f.pos.y - s.pos.y) > s.radius + 1.6) continue;
      const dx = f.pos.x - s.pos.x, dz = f.pos.z - s.pos.z;
      const r = s.radius + f.radius * 0.35;
      if (dx * dx + dz * dz > r * r) continue;
      f.dying = true;
      f.until = Math.min(f.until, this.time + 0.25);
      if (f.field && !f.field.hissed) {
        f.field.hissed = true;
        this._play('smoke_hiss', f.pos, 0.7, rand(0.9, 1.1));
      }
    }
  }

  /** The smoke volume covering `pos`, or null. */
  smokeAt(pos) {
    if (!vecOk(pos)) return null;
    for (let i = 0; i < this._smokes.length; i++) {
      const s = this._smokes[i];
      if (s.radius <= 0.05) continue;
      const dx = pos.x - s.pos.x, dy = pos.y - s.pos.y, dz = pos.z - s.pos.z;
      if (dx * dx + dy * dy + dz * dz <= s.radius * s.radius) return s;
    }
    return null;
  }

  /** True when the segment a→b passes through one of our clouds. */
  _smokeBlocks(a, b) {
    if (!this._smokes.length) return false;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len2 = dx * dx + dy * dy + dz * dz;
    for (let i = 0; i < this._smokes.length; i++) {
      const s = this._smokes[i];
      const r = s.radius * 0.92;
      if (r <= 0.1) continue;
      const cx = s.pos.x - a.x, cy = s.pos.y - a.y, cz = s.pos.z - a.z;
      let t = len2 > 1e-9 ? (cx * dx + cy * dy + cz * dz) / len2 : 0;
      t = clamp01(t);
      const ex = cx - dx * t, ey = cy - dy * t, ez = cz - dz * t;
      if (ex * ex + ey * ey + ez * ez <= r * r) return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // 6 — molotov / incendiary
  // -------------------------------------------------------------------------
  _ignite(p, pos, normal) {
    const t = this.time;
    const base = pos.clone().addScaledVector(normal, 0.05);
    const floor = this._floorUnder(base, 4.2) || base.clone();
    const weak = !!this.smokeAt(floor);           // burning inside smoke is weak
    const life = Math.max(1, num(p.spec.life, FIRE.life)) * (weak ? FIRE.weakLife : 1);
    const dps = clamp(num(p.spec.damage, FIRE.dps), 1, 40) * (weak ? FIRE.weakDps : 1);
    const want = weak ? 3 : randInt(FIRE.minPatch, FIRE.maxPatch);
    const spread = Math.max(1, num(p.spec.radius, FIRE.spread));
    const field = {
      id: uid('fire'), patches: [], loop: null, smoke: null, hissed: false,
      owner: p.owner, team: p.team, type: p.type, until: t + life + 0.4,
    };
    this._fields.push(field);
    const spots = [floor.clone()];
    let guard = 0;
    while (spots.length < want && guard++ < 40) {
      const ang = rand(0, Math.PI * 2);
      const r = spread * Math.sqrt(rand(0.12, 1));
      const cand = _v1.set(floor.x + Math.cos(ang) * r, floor.y + 1.1, floor.z + Math.sin(ang) * r);
      const hit = this._floorUnder(cand, 4.5);
      if (!hit) continue;
      if (Math.abs(hit.y - floor.y) > 2.4) continue;
      // do not spill through walls: the patch must be reachable from the impact
      if (!this._clearPath(_v2.copy(floor).addScaledVector(UP, 0.45), _v3.copy(hit).addScaledVector(UP, 0.35))) continue;
      let tooClose = false;
      for (let i = 0; i < spots.length; i++) if (spots[i].distanceTo(hit) < 0.55) { tooClose = true; break; }
      if (tooClose) continue;
      spots.push(hit);
    }
    // guarantee a minimum field even in a cramped corner
    guard = 0;
    while (spots.length < Math.min(want, FIRE.minPatch) && guard++ < 24) {
      const ang = rand(0, Math.PI * 2);
      const r = rand(0.45, 0.95);
      const cand = new THREE.Vector3(floor.x + Math.cos(ang) * r, floor.y + 0.02, floor.z + Math.sin(ang) * r);
      const hit = this._floorUnder(_v4.copy(cand).addScaledVector(UP, 0.9), 2.5) || cand;
      spots.push(hit);
    }
    for (let i = 0; i < spots.length; i++) {
      const patch = {
        id: uid('firep'),
        kind: 'fire',
        pos: spots[i].clone().addScaledVector(UP, 0.02),
        radius: FIRE.patchR * rand(0.88, 1.16),
        t: 0,
        life: life * rand(0.85, 1.12),
        until: 0,
        dps,
        owner: p.owner, team: p.team, type: p.type,
        field, dying: false, fx: null,
      };
      patch.baseRadius = patch.radius;
      patch.until = t + patch.life;
      field.until = Math.max(field.until, patch.until);
      patch.fx = this._fxHandle('fire', patch.pos, patch.radius, patch.life);
      this._fires.push(patch);
      field.patches.push(patch);
      const w = this.game && this.game.world;
      if (w && Array.isArray(w.fires)) w.fires.push(patch);
    }
    // weak sight block above the flames
    field.smoke = this._addSmoke(_v5.copy(floor).addScaledVector(UP, 0.85), {
      maxRadius: 1.5, grow: 0.8, life: life * 0.9, fade: 0.8,
      source: 'fire', owner: p.owner, team: p.team, quiet: true,
    });
    this._play('molly_ignite', floor, 1, rand(0.95, 1.06));
    field.loop = this._loop('fire_loop', floor, weak ? 0.4 : 0.9);
    this._fx('explosion', floor, 0.8);
    this._noise(floor, 'fire', p.team, 26);
    return field;
  }

  _updateFires(dt) {
    const t = this.time;
    for (let i = this._fires.length - 1; i >= 0; i--) {
      const f = this._fires[i];
      f.t += dt;
      if (t >= f.until) { this._removeFire(f); continue; }
      const left = f.until - t;
      f.radius = left < 0.9 ? f.baseRadius * clamp01(left / 0.9) : f.baseRadius;
    }
    for (let i = this._fields.length - 1; i >= 0; i--) {
      const fl = this._fields[i];
      if (fl.patches.length) continue;
      this._stopHandle(fl.loop); fl.loop = null;
      if (fl.smoke) { fl.smoke.until = Math.min(fl.smoke.until, t + 0.6); fl.smoke = null; }
      this._fields.splice(i, 1);
    }
    if (!this._fires.length) { this._fireAcc = 0; return; }
    this._fireAcc += dt;
    while (this._fireAcc >= FIRE.tick) { this._fireAcc -= FIRE.tick; this._burnTick(FIRE.tick); }
  }

  /** 9 dmg/s to feet inside a patch, armour irrelevant, no stacking. */
  _burnTick(step) {
    const list = (this.game && this.game.actors) || [];
    const ff = !!(this.game && this.game.cfg && this.game.cfg.friendlyFire);
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a || !a.alive || !a.pos) continue;
      let best = null;
      for (let j = 0; j < this._fires.length; j++) {
        const f = this._fires[j];
        if (f.radius <= 0.05) continue;
        if (a.pos.y > f.pos.y + 1.3 || a.pos.y < f.pos.y - 1.0) continue;
        const dx = a.pos.x - f.pos.x, dz = a.pos.z - f.pos.z;
        if (dx * dx + dz * dz > f.radius * f.radius) continue;
        if (!best || f.dps > best.dps) best = f;
      }
      if (!best) { this._burn.delete(a); continue; }
      const self = a === best.owner;
      if (!self && !ff && best.owner && a.team && a.team === best.team) continue;
      let acc = num(this._burn.get(a), 0) + best.dps * step;
      const whole = Math.floor(acc);
      if (whole >= 1) {
        acc -= whole;
        this._hurt(a, whole, best.owner, 'chest', best.type, _v1.copy(UP));
      }
      this._burn.set(a, acc);
    }
  }

  _removeFire(f) {
    const i = this._fires.indexOf(f);
    if (i >= 0) this._fires.splice(i, 1);
    const w = this.game && this.game.world;
    if (w && Array.isArray(w.fires)) {
      const j = w.fires.indexOf(f);
      if (j >= 0) w.fires.splice(j, 1);
    }
    if (f.field) {
      const k = f.field.patches.indexOf(f);
      if (k >= 0) f.field.patches.splice(k, 1);
    }
    f.radius = 0;
    this._stopHandle(f.fx); f.fx = null;
  }

  /** The fire patch burning at `pos` (feet height), or null. */
  fireAt(pos) {
    if (!vecOk(pos)) return null;
    for (let i = 0; i < this._fires.length; i++) {
      const f = this._fires[i];
      if (f.radius <= 0.05) continue;
      if (pos.y > f.pos.y + 1.3 || pos.y < f.pos.y - 1.0) continue;
      const dx = pos.x - f.pos.x, dz = pos.z - f.pos.z;
      if (dx * dx + dz * dz <= f.radius * f.radius) return f;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // 7 — decoy
  // -------------------------------------------------------------------------
  _decoyTick(p) {
    const t = this.time;
    if (p.decoyStart == null) {
      if (!p.rest && p.age < p.fuse + 1.2) return;
      p.decoyStart = t;
      p.nextChirp = t + rand(DECOY.gap[0], DECOY.gap[1]) * 0.4;
    }
    const dur = Math.max(2, num(p.spec.life, DECOY.duration));
    if (t - p.decoyStart >= dur) {
      this._detonate(p, p.pos, p.ground || UP);
      return;
    }
    let guard = 0;
    while (t >= p.nextChirp && guard++ < 4) {
      this._play(pick(GUNSHOTS), p.pos, 0.8, rand(0.94, 1.07));
      this._noise(p.pos, 'shoot', p.team, num(SOUND_RANGE.shoot, 60) * 0.8);
      this._emit('nade_decoy', { pos: p.pos.clone(), actor: p.owner, team: p.team });
      p.nextChirp = t + rand(DECOY.gap[0], DECOY.gap[1]);
    }
  }

  // -------------------------------------------------------------------------
  // 8 — aiming helpers
  // -------------------------------------------------------------------------
  /**
   * Ballistic solve for a throw of `speed` from `from` to `to`.
   * Picks the flatter of the two arcs; `ok:false` when out of range.
   * Angles use the actor convention (positive pitch = looking down).
   * @returns {{yaw:number,pitch:number,ok:boolean}}
   */
  solveThrow(from, to, speed) {
    const g = num(PHYS.gravity, 15.2);
    const dx = to.x - from.x, dz = to.z - from.z, dy = to.y - from.y;
    const flat = Math.hypot(dx, dz);
    const yaw = Math.atan2(dz, dx);
    const v = Math.max(0.01, num(speed, THROW.full));
    if (flat < 1e-3) {
      const ok = dy <= (v * v) / (2 * g);
      return { yaw, pitch: dy >= 0 ? -Math.PI / 2 : Math.PI / 2, ok };
    }
    const v2 = v * v;
    const disc = v2 * v2 - g * (g * flat * flat + 2 * dy * v2);
    if (disc < 0) return { yaw, pitch: -Math.PI / 4, ok: false };
    const s = Math.sqrt(disc);
    const hi = Math.atan2(v2 + s, g * flat);
    const lo = Math.atan2(v2 - s, g * flat);
    const theta = Math.abs(lo) <= Math.abs(hi) ? lo : hi;   // elevation, up positive
    return { yaw, pitch: -theta, ok: true };
  }

  /**
   * Simulate a throw, including bounces, against the real geometry.
   * @returns {THREE.Vector3[]} sampled path (last point = final rest/hit point)
   */
  predictPath(from, vel, maxTime = 3.2, opts = {}) {
    const maxB = Math.max(0, num(opts.bounces, 2));
    const bounceScale = clamp(num(opts.bounceScale, 1), 0.05, 2.2);
    const g = num(PHYS.gravity, 15.2);
    const b = this.game && this.game.world && this.game.world.bounds;
    const pos = new THREE.Vector3(from.x, from.y, from.z);
    const v = new THREE.Vector3(vel.x, vel.y, vel.z);
    const out = [pos.clone()];
    const h = 1 / 90;
    let t = 0, bounces = 0, sample = 0;
    while (t < maxTime && out.length < 240) {
      v.y -= g * h;
      const move = _v1.copy(v).multiplyScalar(h);
      const dist = move.length();
      if (dist < 1e-6) break;
      const dir = _v2.copy(move).divideScalar(dist);
      const tr = this._trace(pos, dir, dist + SKIN);
      if (tr.hit && tr.dist <= dist + SKIN) {
        const n = _v3.set(tr.normal.x, tr.normal.y, tr.normal.z);
        if (n.lengthSq() < 1e-8) n.copy(UP); else n.normalize();
        pos.set(tr.point.x, tr.point.y, tr.point.z);
        out.push(pos.clone());
        if (bounces++ >= maxB) break;
        pos.addScaledVector(n, SKIN);
        const surf = tr.surface || SURFACE.CONCRETE;
        const e = (BOUNCE[surf] === undefined ? BOUNCE_DEF : BOUNCE[surf]) * bounceScale;
        const keep = TANGENT[surf] === undefined ? TANGENT_DEF : TANGENT[surf];
        const vn = v.dot(n);
        v.addScaledVector(n, -vn).multiplyScalar(keep).addScaledVector(n, Math.abs(vn) * e);
        if (v.lengthSq() < 0.05) break;
      } else {
        pos.addScaledVector(dir, dist);
        if (++sample % 2 === 0) out.push(pos.clone());
      }
      if (b && b.min && b.max) {
        if (pos.x < b.min.x || pos.x > b.max.x || pos.z < b.min.z || pos.z > b.max.z || pos.y < b.min.y) break;
      }
      t += h;
    }
    const last = out[out.length - 1];
    if (last.distanceToSquared(pos) > 1e-6) out.push(pos.clone());
    return out;
  }

  /** The arc `actor` would throw right now. */
  previewFor(actor, type, power = 1) {
    const st = this._spawnState(actor, type, { power });
    if (!st) return [];
    const bs = clamp(st.spec.bounce / 0.45, 0.15, 2.2);
    return this.predictPath(st.pos, st.vel, 4, { bounces: st.spec.kind === 'fire' ? 0 : 2, bounceScale: bs });
  }

  /** Enable / disable the dashed trajectory line for an actor. */
  setPreview(actor, type, on = true) {
    if (!actor) return;
    let e = this._previews.get(actor);
    if (!on) {
      if (e) { e.on = false; if (e.line) e.line.visible = false; }
      return;
    }
    if (!e) { e = { on: true, type, line: null, geo: null, mat: null, pos: null, dst: null }; this._previews.set(actor, e); }
    e.on = true;
    if (type) e.type = type;
  }

  /** Refresh every active preview line (called from update()). */
  updatePreview() {
    if (!this._previews.size) return;
    const scene = this.game && this.game.scene;
    for (const [actor, e] of this._previews) {
      const live = e.on && actor && actor.alive !== false;
      if (!live) { if (e.line) e.line.visible = false; continue; }
      const pts = this.previewFor(actor, e.type, 1);
      e.points = pts;
      if (!scene || !pts.length) { if (e.line) e.line.visible = false; continue; }
      if (!e.line) {
        e.pos = new Float32Array(PREVIEW_MAX * 3);
        e.dst = new Float32Array(PREVIEW_MAX);
        e.geo = new THREE.BufferGeometry();
        e.geo.setAttribute('position', new THREE.BufferAttribute(e.pos, 3));
        e.geo.setAttribute('lineDistance', new THREE.BufferAttribute(e.dst, 1));
        e.mat = new THREE.LineDashedMaterial({
          color: 0x9df5c0, dashSize: 0.22, gapSize: 0.16,
          transparent: true, opacity: 0.75, depthWrite: false,
        });
        e.line = new THREE.Line(e.geo, e.mat);
        e.line.frustumCulled = false;
        e.line.renderOrder = 3;
        scene.add(e.line);
      }
      const n = Math.min(pts.length, PREVIEW_MAX);
      let run = 0;
      for (let i = 0; i < n; i++) {
        const p = pts[i];
        e.pos[i * 3] = p.x; e.pos[i * 3 + 1] = p.y; e.pos[i * 3 + 2] = p.z;
        if (i > 0) run += p.distanceTo(pts[i - 1]);
        e.dst[i] = run;
      }
      e.geo.attributes.position.needsUpdate = true;
      e.geo.attributes.lineDistance.needsUpdate = true;
      e.geo.setDrawRange(0, n);
      e.geo.computeBoundingSphere();
      e.line.visible = true;
    }
  }

  // -------------------------------------------------------------------------
  // 9 — visuals
  // -------------------------------------------------------------------------
  _keepGeo(g) { this._geos.push(g); return g; }
  _keepMat(m) { this._mats.push(m); return m; }

  /** Procedural prototype mesh per grenade type (cloned per projectile). */
  _proto(type) {
    if (this._protos.has(type)) return this._protos.get(type);
    const g = new THREE.Group();
    const std = (color, o = {}) => this._keepMat(new THREE.MeshStandardMaterial(
      Object.assign({ color, roughness: 0.72, metalness: 0.25 }, o)));
    const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, rz = 0) => {
      const m = new THREE.Mesh(this._keepGeo(geo), mat);
      m.position.set(x, y, z); m.rotation.x = rx; m.rotation.z = rz;
      g.add(m);
      return m;
    };
    if (type === 'flash') {
      const body = std(0xcdd2c8, { roughness: 0.5, metalness: 0.45 });
      add(new THREE.CylinderGeometry(0.045, 0.045, 0.125, 12), body);
      add(new THREE.CylinderGeometry(0.047, 0.047, 0.026, 12), std(0xb4302a, { roughness: 0.5 }), 0, 0.012, 0);
      add(new THREE.CylinderGeometry(0.016, 0.016, 0.045, 8), std(0x8d9088, { metalness: 0.7 }), 0, 0.08, 0);
    } else if (type === 'smoke') {
      add(new THREE.CylinderGeometry(0.05, 0.05, 0.145, 12), std(0x4b5320));
      add(new THREE.CylinderGeometry(0.052, 0.052, 0.03, 12), std(0xd6c33c, { roughness: 0.5 }), 0, 0.02, 0);
      add(new THREE.CylinderGeometry(0.018, 0.018, 0.05, 8), std(0x8d9088, { metalness: 0.7 }), 0, 0.09, 0);
    } else if (type === 'decoy') {
      add(new THREE.CylinderGeometry(0.048, 0.048, 0.14, 12), std(0x5b5b52));
      add(new THREE.CylinderGeometry(0.05, 0.05, 0.028, 12), std(0xe07b1e, { roughness: 0.45 }), 0, 0.03, 0);
      add(new THREE.CylinderGeometry(0.05, 0.05, 0.016, 12), std(0xe07b1e, { roughness: 0.45 }), 0, -0.04, 0);
      add(new THREE.CylinderGeometry(0.016, 0.016, 0.05, 8), std(0x8d9088, { metalness: 0.7 }), 0, 0.088, 0);
    } else if (type === 'molotov' || type === 'incendiary') {
      const glass = this._keepMat(new THREE.MeshStandardMaterial({
        color: 0x7fa07a, roughness: 0.18, metalness: 0.1, transparent: true, opacity: 0.62,
      }));
      add(new THREE.CylinderGeometry(0.043, 0.048, 0.135, 12), glass);
      add(new THREE.CylinderGeometry(0.019, 0.03, 0.05, 10), glass, 0, 0.09, 0);
      add(new THREE.CylinderGeometry(0.014, 0.011, 0.055, 8), std(0xd8c9a4, { roughness: 0.95, metalness: 0 }), 0, 0.125, 0);
      const flame = new THREE.Mesh(
        this._keepGeo(new THREE.OctahedronGeometry(0.038, 0)),
        this._keepMat(new THREE.MeshBasicMaterial({ color: 0xff8b2a, transparent: true, opacity: 0.9 })));
      flame.position.set(0, 0.16, 0);
      flame.name = 'flame';
      g.add(flame);
      if (!this.game || !this.game.cfg || this.game.cfg.quality !== 'low') {
        const light = new THREE.PointLight(0xff7a22, 1.5, 3.2, 2);
        light.position.set(0, 0.15, 0);
        g.add(light);
      }
    } else {
      // he — dark olive ribbed body
      const body = std(0x3b4327, { roughness: 0.8, metalness: 0.15 });
      const s = new THREE.Mesh(this._keepGeo(new THREE.SphereGeometry(0.056, 12, 9)), body);
      s.scale.set(1, 1.22, 1);
      g.add(s);
      for (let i = 0; i < 3; i++) {
        add(new THREE.TorusGeometry(0.05, 0.007, 5, 14), body, 0, -0.026 + i * 0.026, 0, Math.PI / 2);
      }
      add(new THREE.CylinderGeometry(0.017, 0.017, 0.042, 8), std(0x8d9088, { metalness: 0.75 }), 0, 0.075, 0);
      add(new THREE.BoxGeometry(0.012, 0.05, 0.008), std(0x9aa091, { metalness: 0.7 }), 0.022, 0.07, 0);
    }
    this._protos.set(type, g);
    return g;
  }

  _buildVisual(p) {
    const scene = this.game && this.game.scene;
    if (!scene) return;
    try {
      p.mesh = this._proto(p.type).clone(true);
      p.mesh.position.copy(p.pos);
      p.mesh.castShadow = false;
      scene.add(p.mesh);
      const geo = new THREE.BufferGeometry();
      const arr = new Float32Array(TRAIL_LEN * 3);
      for (let i = 0; i < TRAIL_LEN; i++) { arr[i * 3] = p.pos.x; arr[i * 3 + 1] = p.pos.y; arr[i * 3 + 2] = p.pos.z; }
      geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const mat = new THREE.LineBasicMaterial({
        color: p.kind === 'fire' ? 0xff8a30 : 0xb9c4b0,
        transparent: true, opacity: 0.32, depthWrite: false,
      });
      p.trail = new THREE.Line(geo, mat);
      p.trail.frustumCulled = false;
      p.trailPts = arr;
      scene.add(p.trail);
    } catch (err) { p.mesh = null; p.trail = null; p.trailPts = null; }
  }

  _updateVisual(p, dt) {
    if (p.mesh) {
      p.mesh.position.copy(p.pos);
      const rate = p.spin.length();
      if (rate > 1e-4) {
        _q1.setFromAxisAngle(_v1.copy(p.spin).divideScalar(rate), rate * dt);
        p.mesh.quaternion.premultiply(_q1);
      }
      if (p.rest) p.spin.multiplyScalar(Math.max(0, 1 - 8 * dt));
    }
    if (p.trail && p.trailPts) {
      const a = p.trailPts;
      for (let i = TRAIL_LEN - 1; i > 0; i--) {
        a[i * 3] = a[(i - 1) * 3]; a[i * 3 + 1] = a[(i - 1) * 3 + 1]; a[i * 3 + 2] = a[(i - 1) * 3 + 2];
      }
      a[0] = p.pos.x; a[1] = p.pos.y; a[2] = p.pos.z;
      p.trail.geometry.attributes.position.needsUpdate = true;
      p.trail.material.opacity = clamp01(p.vel.length() / 14) * 0.34;
    }
    if (p.kind === 'fire' && this.game && this.game.scene) {
      const t = this.time;
      if (t - p.emberAt > 0.05 && p.vel.lengthSq() > 1) { p.emberAt = t; this._spawnEmber(p.pos); }
    }
  }

  /** Small glowing ember left behind by a lit molotov. */
  _spawnEmber(pos) {
    const scene = this.game && this.game.scene;
    if (!scene || this._embers.length >= EMBER_MAX) return;
    try {
      if (!this._emberGeo) {
        this._emberGeo = this._keepGeo(new THREE.OctahedronGeometry(0.026, 0));
        this._emberMat = this._keepMat(new THREE.MeshBasicMaterial({
          color: 0xff9a3c, transparent: true, opacity: 0.85, depthWrite: false,
        }));
      }
      const m = new THREE.Mesh(this._emberGeo, this._emberMat.clone());
      m.position.copy(pos);
      scene.add(m);
      this._embers.push({ mesh: m, t: 0, life: rand(0.28, 0.42) });
    } catch (err) { /* rendering is optional */ }
  }

  _updateEmbers(dt) {
    if (!this._embers.length) return;
    const scene = this.game && this.game.scene;
    for (let i = this._embers.length - 1; i >= 0; i--) {
      const e = this._embers[i];
      e.t += dt;
      const k = clamp01(e.t / e.life);
      if (k >= 1) {
        if (scene) scene.remove(e.mesh);
        if (e.mesh.material && e.mesh.material.dispose) e.mesh.material.dispose();
        this._embers.splice(i, 1);
        continue;
      }
      e.mesh.position.y += dt * 0.35;
      e.mesh.scale.setScalar(1 - k * 0.8);
      if (e.mesh.material) e.mesh.material.opacity = 0.85 * (1 - k);
    }
  }

  // -------------------------------------------------------------------------
  // 10 — bookkeeping / integration glue
  // -------------------------------------------------------------------------
  _removeProjectile(p) {
    if (!p) return;
    p.done = true;
    const scene = this.game && this.game.scene;
    if (p.mesh) {
      if (scene) scene.remove(p.mesh);
      p.mesh.traverse((o) => { if (o.isLight && o.dispose) o.dispose(); });
      p.mesh = null;
    }
    if (p.trail) {
      if (scene) scene.remove(p.trail);
      if (p.trail.geometry) p.trail.geometry.dispose();
      if (p.trail.material) p.trail.material.dispose();
      p.trail = null; p.trailPts = null;
    }
    const i = this._proj.indexOf(p);
    if (i >= 0) this._proj.splice(i, 1);
  }

  /** Wipe every live projectile, volume, handle and blindness (round reset). */
  clear() {
    for (let i = this._proj.length - 1; i >= 0; i--) this._removeProjectile(this._proj[i]);
    this._proj.length = 0;
    for (let i = this._smokes.length - 1; i >= 0; i--) this._removeSmoke(this._smokes[i]);
    this._smokes.length = 0;
    for (let i = this._fires.length - 1; i >= 0; i--) this._removeFire(this._fires[i]);
    this._fires.length = 0;
    for (let i = 0; i < this._fields.length; i++) {
      this._stopHandle(this._fields[i].loop);
      this._fields[i].loop = null;
      this._fields[i].smoke = null;
    }
    this._fields.length = 0;
    for (const [a] of this._flash) { if (a) a.flashAmount = 0; }
    this._flash.clear();
    this._burn.clear();
    this._fireAcc = 0;
    this._stopHandle(this._ring); this._ring = null; this._ringActor = null;
    const scene = this.game && this.game.scene;
    for (let i = 0; i < this._embers.length; i++) {
      const e = this._embers[i];
      if (scene) scene.remove(e.mesh);
      if (e.mesh.material && e.mesh.material.dispose) e.mesh.material.dispose();
    }
    this._embers.length = 0;
  }

  /** Free GPU resources; the system is inert afterwards. */
  dispose() {
    this.clear();
    const scene = this.game && this.game.scene;
    for (const [, e] of this._previews) {
      if (e.line && scene) scene.remove(e.line);
      if (e.geo) e.geo.dispose();
      if (e.mat) e.mat.dispose();
      e.line = null; e.geo = null; e.mat = null;
    }
    this._previews.clear();
    for (let i = 0; i < this._geos.length; i++) { try { this._geos[i].dispose(); } catch (err) { /* ignore */ } }
    for (let i = 0; i < this._mats.length; i++) { try { this._mats[i].dispose(); } catch (err) { /* ignore */ } }
    this._geos.length = 0;
    this._mats.length = 0;
    this._protos.clear();
    this._emberGeo = null;
    this._emberMat = null;
    this._disposed = true;
  }

  // -------------------------------------------------------------------------
  // low level glue — every optional integration point is guarded
  // -------------------------------------------------------------------------
  /** world.trace wrapper that always returns a usable result object. */
  _trace(origin, dir, maxDist) {
    const w = this.game && this.game.world;
    if (!w || typeof w.trace !== 'function' || !(maxDist > 0)) return NO_HIT;
    let tr;
    try {
      tr = w.trace(origin, dir, maxDist, TRACE_OPTS);
    } catch (err) { return NO_HIT; }
    if (!tr || !tr.hit || !tr.point) return NO_HIT;
    let d = num(tr.dist, -1);
    if (d < 0) d = Math.hypot(tr.point.x - origin.x, tr.point.y - origin.y, tr.point.z - origin.z);
    if (d > maxDist + 1e-4) return NO_HIT;
    return {
      hit: true, dist: d, point: tr.point,
      normal: vecOk(tr.normal) ? tr.normal : UP,
      brush: tr.brush || null, surface: tr.surface || SURFACE.CONCRETE,
    };
  }

  /**
   * Line of sight a→b. `smokeBlocks` decides whether clouds count: we also test
   * our own volumes directly so the result is right whatever `world.los` does
   * with its `{smoke}` option.
   */
  _los(a, b, smokeBlocks) {
    if (smokeBlocks && this._smokeBlocks(a, b)) return false;
    const w = this.game && this.game.world;
    if (w && typeof w.los === 'function') {
      try { return !!w.los(a, b, { smoke: !!smokeBlocks }); } catch (err) { /* fall through */ }
    }
    if (w && typeof w.trace === 'function') {
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < 1e-4) return true;
      const tr = this._trace(a, _v6.set(dx / d, dy / d, dz / d), d - 0.02);
      return !tr.hit;
    }
    return true;
  }

  /** Nearest walkable floor point below `from` (null when nothing is there). */
  _floorUnder(from, maxDist = 4) {
    const org = new THREE.Vector3(from.x, from.y, from.z);
    const dir = new THREE.Vector3(0, -1, 0);
    const tr = this._trace(org, dir, maxDist);
    if (!tr.hit) return null;
    if (num(tr.normal.y, 1) < 0.55) return null;
    return new THREE.Vector3(tr.point.x, tr.point.y, tr.point.z);
  }

  /** True when no movement solid stands between a and b. */
  _clearPath(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-4) return true;
    return !this._trace(a, _v6.set(dx / d, dy / d, dz / d), d - 0.05).hit;
  }

  _hurt(actor, dmg, attacker, hitbox, weaponId, dir) {
    if (!actor || typeof actor.hurt !== 'function' || !(dmg > 0)) return;
    try {
      actor.hurt(dmg, attacker || null, hitbox, weaponId, new THREE.Vector3(dir.x, dir.y, dir.z));
    } catch (err) { /* an actor blowing up must not take the round with it */ }
  }

  _play(name, pos, vol = 1, pitch = 1) {
    const a = this.game && this.game.audio;
    if (!a || typeof a.play !== 'function') return null;
    try { return a.play(name, { pos: new THREE.Vector3(pos.x, pos.y, pos.z), vol, pitch }); }
    catch (err) { return null; }
  }

  _loop(name, pos, vol = 1) {
    const a = this.game && this.game.audio;
    if (!a || typeof a.loop !== 'function') return null;
    try { return a.loop(name, { pos: new THREE.Vector3(pos.x, pos.y, pos.z), vol }); }
    catch (err) { return null; }
  }

  _stopHandle(h) {
    if (!h) return;
    try {
      if (typeof h.stop === 'function') { h.stop(); return; }
      if (typeof h.remove === 'function') { h.remove(); return; }
      if (typeof h.dispose === 'function') { h.dispose(); return; }
      if (typeof h === 'function') { h(); return; }
      const a = this.game && this.game.audio;
      if (a && typeof a.stop === 'function') a.stop(h);
    } catch (err) { /* ignore */ }
  }

  _setHandleVolume(h, vol) {
    if (!h) return;
    try {
      if (typeof h.setVolume === 'function') h.setVolume(vol);
      else if (h.gain && h.gain.gain && typeof h.gain.gain.value === 'number') h.gain.gain.value = vol;
      else if (typeof h.volume === 'number') h.volume = vol;
    } catch (err) { /* ignore */ }
  }

  /** fx.<name>(...) when the renderer is present. */
  _fx(name, ...args) {
    const fx = this.game && this.game.fx;
    if (!fx || typeof fx[name] !== 'function') return null;
    try { return fx[name](...args); } catch (err) { return null; }
  }

  _fxHandle(name, pos, r, life) { return this._fx(name, new THREE.Vector3(pos.x, pos.y, pos.z), r, life); }

  /** Register a noise bots can hear. */
  _noise(pos, kind, team, range) {
    const g = this.game;
    if (!g || typeof g.emitSound !== 'function' || !(range > 0)) return;
    try { g.emitSound(new THREE.Vector3(pos.x, pos.y, pos.z), kind, team || null, range); }
    catch (err) { /* ignore */ }
  }

  _emit(ev, data) {
    const bus = this.game && this.game.bus;
    if (!bus || typeof bus.emit !== 'function') return;
    try { bus.emit(ev, data); } catch (err) { /* ignore */ }
  }
}

export default GrenadeSystem;

