// ============================================================================
// render/characters.js — third-person player models.
//
// Fully procedural, joint-driven humanoids: hips → spine → chest → arms and
// hips → thighs → shins → feet, so every pose is real bone rotation.  Geometry
// and materials are cached module-wide, so ten players cost ten draw batches
// of shared boxes rather than ten unique meshes.
//
// Model space: origin at the FEET, facing +X at yaw 0 (matching the game's
// yaw convention where yaw increases toward +Z).  Total height 1.82 m.
// ============================================================================

import * as THREE from 'three';
import { TEAM, TEAM_COLOR_HEX, PLAYER } from '../core/constants.js';
import { clamp, clamp01, lerp, damp, rand, pick, TAU } from '../core/util.js';
import { buildWorldWeapon } from './viewmodel.js';

const GEO = new Map();
const MAT = new Map();
const kk = (...a) => a.join('_');

function box(w, h, d) {
  const k = kk('b', w, h, d);
  let g = GEO.get(k);
  if (!g) { g = new THREE.BoxGeometry(w, h, d); GEO.set(k, g); }
  return g;
}
function caps(r, len) {
  const k = kk('c', r, len);
  let g = GEO.get(k);
  if (!g) { g = new THREE.CapsuleGeometry(r, Math.max(0.01, len), 4, 8); GEO.set(k, g); }
  return g;
}
function sph(r) {
  const k = kk('s', r);
  let g = GEO.get(k);
  if (!g) { g = new THREE.SphereGeometry(r, 10, 8); GEO.set(k, g); }
  return g;
}
/** Tapered box (top face scaled) — limbs and torsos. */
function taper(w, h, d, tx = 0.82, tz = 0.86) {
  const k = kk('t', w, h, d, tx, tz);
  let g = GEO.get(k);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > 0) { p.setX(i, p.getX(i) * tx); p.setZ(i, p.getZ(i) * tz); }
    }
    g.computeVertexNormals();
    GEO.set(k, g);
  }
  return g;
}

function mat(key, opts) {
  let m = MAT.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial(opts); MAT.set(key, m); }
  return m;
}

// Three loadout variants per faction, all realistic military colours with the
// faction tint kept to the armband/patch so it reads at distance without neon.
const SKINS = {
  T: [
    { cloth: 0x6f6244, vest: 0x4a4130, gear: 0x2e2a22, head: 0x2b2823, skin: 0x9c7554, boots: 0x3a3128, hat: 'balaclava' },
    { cloth: 0x7d6b46, vest: 0x53442f, gear: 0x33302a, head: 0x8d7a4e, skin: 0xa87c58, boots: 0x40362b, hat: 'keffiyeh' },
    { cloth: 0x5d5a45, vest: 0x413f33, gear: 0x2a2822, head: 0x2f2c28, skin: 0x8f6a4c, boots: 0x352e26, hat: 'cap' },
  ],
  CT: [
    { cloth: 0x2f3947, vest: 0x22262c, gear: 0x191d22, head: 0x2c3340, skin: 0xb08a68, boots: 0x1d1f22, hat: 'helmet' },
    { cloth: 0x3a4250, vest: 0x272b31, gear: 0x1c2026, head: 0x333a45, skin: 0x9e7c5e, boots: 0x22242a, hat: 'helmet' },
    { cloth: 0x38403a, vest: 0x252a26, gear: 0x1a1e1b, head: 0x2f342e, skin: 0xa9835f, boots: 0x212420, hat: 'cap' },
  ],
};

/** Add a mesh to a joint. */
function put(parent, g, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  parent.add(mesh);
  return mesh;
}

function joint(parent, name, x, y, z) {
  const j = new THREE.Group();
  j.name = name;
  j.position.set(x, y, z);
  parent.add(j);
  return j;
}

export class CharacterModel {
  /**
   * @param {'T'|'CT'} team
   * @param {{skinIndex?:number, name?:string}} [opts]
   */
  constructor(team, opts = {}) {
    this.team = team === TEAM.T ? TEAM.T : TEAM.CT;
    const list = SKINS[this.team];
    this.skin = list[(opts.skinIndex ?? 0) % list.length];
    this.name = opts.name || '';
    this.group = new THREE.Group();
    this.group.name = `char_${this.team}`;
    this.weaponId = null;
    this.weapon = null;
    this.alive = true;
    this.t = Math.random() * 10;
    this.stride = 0;
    this.lean = 0;
    this.crouch = 0;
    this.pitch = 0;
    this.death = null;
    this.flinch = 0;
    this.pose = { plant: 0, defuse: 0, reload: 0, fire: 0 };
    this._build();
  }

  _build() {
    const S = this.skin;
    const cloth = mat(`cloth${S.cloth}`, { color: S.cloth, roughness: 0.88, metalness: 0.02 });
    const vest = mat(`vest${S.vest}`, { color: S.vest, roughness: 0.72, metalness: 0.08 });
    const gear = mat(`gear${S.gear}`, { color: S.gear, roughness: 0.6, metalness: 0.18 });
    const head = mat(`head${S.head}`, { color: S.head, roughness: 0.85 });
    const skin = mat(`skin${S.skin}`, { color: S.skin, roughness: 0.72 });
    const boots = mat(`boot${S.boots}`, { color: S.boots, roughness: 0.65 });
    const accent = mat(`acc${this.team}`, { color: TEAM_COLOR_HEX[this.team], roughness: 0.7 });
    this.mats = { cloth, vest, gear, head, skin, boots, accent };

    // --- skeleton ---------------------------------------------------------
    const root = this.group;
    const hips = joint(root, 'hips', 0, 0.95, 0);
    this.hips = hips;
    const spine = joint(hips, 'spine', 0, 0.12, 0);
    const chest = joint(spine, 'chest', 0, 0.28, 0);
    const neck = joint(chest, 'neck', 0, 0.22, 0);
    const headJ = joint(neck, 'head', 0, 0.11, 0);
    this.spine = spine; this.chest = chest; this.neck = neck; this.head = headJ;

    // --- torso ------------------------------------------------------------
    put(hips, taper(0.30, 0.16, 0.20, 1.05, 1.0), cloth, 0, 0.04, 0);
    put(hips, box(0.32, 0.05, 0.22), gear, 0, -0.02, 0);                    // belt
    put(chest, taper(0.34, 0.30, 0.22, 0.92, 0.92), cloth, 0, -0.06, 0);
    put(chest, box(0.30, 0.26, 0.15), vest, 0, -0.04, 0.005);               // plate carrier
    put(chest, box(0.31, 0.05, 0.16), gear, 0, 0.08, 0.005);
    for (let i = 0; i < 3; i++) put(chest, box(0.07, 0.09, 0.05), gear, -0.09 + i * 0.09, -0.06, 0.10);
    put(chest, box(0.05, 0.07, 0.04), gear, 0.13, 0.04, 0.09);              // radio
    put(chest, box(0.03, 0.10, 0.02), accent, -0.175, 0.02, 0.02);          // faction armband
    put(neck, caps(0.055, 0.05), skin, 0, 0.02, 0);

    // --- head + headgear --------------------------------------------------
    put(headJ, sph(0.098), head, 0, 0.02, 0);
    put(headJ, box(0.13, 0.07, 0.02), mat('visor', { color: 0x14181c, roughness: 0.35, metalness: 0.3 }), 0, 0.02, 0.088);
    if (this.skin.hat === 'helmet') {
      put(headJ, sph(0.112), gear, 0, 0.035, 0, 0, 0, 0).scale.set(1, 0.82, 1.06);
      put(headJ, box(0.20, 0.03, 0.10), gear, 0, 0.045, 0.06);
      put(headJ, box(0.09, 0.05, 0.03), mat('goggle', { color: 0x2a3a44, roughness: 0.2, metalness: 0.5 }), 0, 0.075, 0.075);
    } else if (this.skin.hat === 'cap') {
      put(headJ, box(0.19, 0.06, 0.19), cloth, 0, 0.075, 0);
      put(headJ, box(0.18, 0.02, 0.09), cloth, 0, 0.055, 0.11);
    } else if (this.skin.hat === 'keffiyeh') {
      put(headJ, sph(0.112), cloth, 0, 0.03, -0.01).scale.set(1.05, 0.9, 1.1);
      put(headJ, box(0.16, 0.14, 0.05), cloth, 0, -0.03, -0.07);
    } else {
      put(headJ, sph(0.104), mat('balac', { color: 0x1e1c1a, roughness: 0.9 }), 0, 0.02, 0);
    }

    // --- arms -------------------------------------------------------------
    const mkArm = (side) => {
      const sx = side * 0.175;
      const sh = joint(chest, side > 0 ? 'shoulderR' : 'shoulderL', sx, 0.13, 0);
      put(sh, box(0.10, 0.10, 0.13), vest, side * 0.015, 0.0, 0);
      const up = joint(sh, 'upperArm', 0, -0.03, 0);
      put(up, caps(0.045, 0.16), cloth, 0, -0.10, 0);
      const lo = joint(up, 'foreArm', 0, -0.21, 0);
      put(lo, caps(0.040, 0.15), cloth, 0, -0.09, 0);
      put(lo, box(0.075, 0.05, 0.075), mat('glove', { color: this.team === TEAM.T ? 0x8a6f45 : 0x1d1e20, roughness: 0.8 }), 0, -0.19, 0.01);
      return { sh, up, lo };
    };
    this.armR = mkArm(1);
    this.armL = mkArm(-1);

    // --- legs -------------------------------------------------------------
    const mkLeg = (side) => {
      const hip = joint(hips, side > 0 ? 'hipR' : 'hipL', side * 0.085, -0.06, 0);
      const th = joint(hip, 'thigh', 0, 0, 0);
      put(th, caps(0.062, 0.30), cloth, 0, -0.19, 0);
      const sh = joint(th, 'shin', 0, -0.42, 0);
      put(sh, caps(0.052, 0.26), cloth, 0, -0.16, 0);
      put(sh, box(0.10, 0.09, 0.09), gear, 0, 0.02, 0.035);                 // knee pad
      const ft = joint(sh, 'foot', 0, -0.38, 0);
      put(ft, box(0.095, 0.07, 0.24), boots, 0, -0.04, 0.05);
      return { hip, th, sh, ft };
    };
    this.legR = mkLeg(1);
    this.legL = mkLeg(-1);

    // --- weapon mount (in the right hand, aimed with the chest) -----------
    this.mount = joint(this.armR.lo, 'weaponMount', 0, -0.20, 0.03);
    this.group.rotation.order = 'YXZ';
  }

  setWeapon(weaponId) {
    if (weaponId === this.weaponId) return this;
    this.weaponId = weaponId;
    if (this.weapon) { this.mount.remove(this.weapon); this.weapon = null; }
    if (!weaponId) return this;
    let g = null;
    try { g = buildWorldWeapon(weaponId, { team: this.team }); } catch (e) { g = null; }
    if (!g) return this;
    g.scale.setScalar(0.92);
    // the world model lies along +X; stand it up in the hand pointing forward
    g.rotation.set(0, 0, 0);
    g.position.set(0, -0.02, 0.10);
    this.weapon = g;
    this.mount.add(g);
    return this;
  }

  setVisible(v) { this.group.visible = !!v; return this; }

  headWorldPos(out) {
    this.head.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(this.head.matrixWorld);
  }

  chestWorldPos(out) {
    this.chest.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(this.chest.matrixWorld);
  }

  /** Play a death animation; the pose settles on the ground and stays there. */
  die(dir, headshot) {
    if (this.death) return this;
    const forward = dir ? (dir.x * Math.cos(this.group.rotation.y) + dir.z * Math.sin(this.group.rotation.y)) : 0;
    this.death = {
      t: 0, dur: 0.85, kind: pick(headshot ? [0, 2] : [0, 1, 2]),
      side: Math.random() < 0.5 ? 1 : -1, headshot: !!headshot, forward,
    };
    this.alive = false;
    return this;
  }

  /**
   * @param {number} dt
   * @param {{pos:THREE.Vector3, yaw:number, pitch:number, speed:number,
   *          crouching:boolean, onGround:boolean, alive:boolean, firing:boolean,
   *          reloading:boolean, planting:boolean, defusing:boolean,
   *          weaponId:string, hurt:boolean}} s
   */
  update(dt, s) {
    dt = Math.min(dt || 0, 0.05);
    this.t += dt;
    const g = this.group;
    if (s.pos) g.position.set(s.pos.x, s.pos.y, s.pos.z);
    // yaw 0 = +X, three.js yaw 0 = -Z  ⇒  rotate by -yaw - 90°
    g.rotation.y = -(s.yaw || 0) - Math.PI / 2;
    if (s.weaponId && s.weaponId !== this.weaponId) this.setWeapon(s.weaponId);
    if (s.alive === false && !this.death) this.die(null, false);

    if (this.death) { this._animateDeath(dt); return this; }

    const speed = s.speed || 0;
    const moving = speed > 0.4;
    const run = clamp01(speed / 4.4);
    this.crouch += ((s.crouching ? 1 : 0) - this.crouch) * damp(11, dt);
    this.pitch += ((s.pitch || 0) - this.pitch) * damp(14, dt);
    this.flinch = s.hurt ? 1 : Math.max(0, this.flinch - dt * 3.2);
    this.pose.plant += ((s.planting ? 1 : 0) - this.pose.plant) * damp(8, dt);
    this.pose.defuse += ((s.defusing ? 1 : 0) - this.pose.defuse) * damp(8, dt);
    this.pose.reload += ((s.reloading ? 1 : 0) - this.pose.reload) * damp(9, dt);
    this.pose.fire = s.firing ? 1 : Math.max(0, this.pose.fire - dt * 6);
    const kneel = Math.max(this.pose.plant, this.pose.defuse);

    // --- locomotion -------------------------------------------------------
    this.stride += dt * (moving ? 4.2 + run * 5.6 : 0);
    const sw = Math.sin(this.stride), sw2 = Math.sin(this.stride * 2);
    const amp = run * (this.crouch > 0.5 ? 0.55 : 1);
    const airborne = s.onGround === false;

    // hips: bob + crouch drop + kneel
    const crouchDrop = this.crouch * 0.18 + kneel * 0.24;
    this.hips.position.y = 0.95 - crouchDrop + (moving ? Math.abs(sw2) * 0.02 * amp : Math.sin(this.t * 1.6) * 0.006);
    this.hips.rotation.set(kneel * 0.25, moving ? sw * 0.08 * amp : 0, 0);

    // spine / chest: lean into the run, counter-rotate the shoulders
    const leanTarget = moving ? 0.10 + run * 0.10 : 0.03;
    this.lean += (leanTarget - this.lean) * damp(6, dt);
    this.spine.rotation.set(this.lean + kneel * 0.18, 0, 0);
    this.chest.rotation.set(this.pitch * 0.35 - this.pose.fire * 0.05, moving ? -sw * 0.12 * amp : 0, moving ? sw * 0.05 * amp : 0);
    this.neck.rotation.set(this.pitch * 0.3 - this.lean * 0.6, 0, 0);
    this.head.rotation.set(this.pitch * 0.35, 0, this.flinch * 0.2);

    // --- legs: contact-driven swing ---------------------------------------
    const swingR = moving ? sw : 0, swingL = moving ? -sw : 0;
    const kneeR = moving ? Math.max(0, -sw) : 0, kneeL = moving ? Math.max(0, sw) : 0;
    const crouchKnee = this.crouch * 1.0 + kneel * 1.15;
    this.legR.th.rotation.x = swingR * 0.62 * amp - crouchKnee * 0.6 - kneel * 0.2;
    this.legL.th.rotation.x = swingL * 0.62 * amp - crouchKnee * 0.6 + kneel * 0.5;
    this.legR.sh.rotation.x = kneeR * 0.95 * amp + crouchKnee * 1.2;
    this.legL.sh.rotation.x = kneeL * 0.95 * amp + crouchKnee * 1.2;
    this.legR.ft.rotation.x = -swingR * 0.25 * amp - crouchKnee * 0.6;
    this.legL.ft.rotation.x = -swingL * 0.25 * amp - crouchKnee * 0.6;
    if (airborne) {
      this.legR.th.rotation.x = -0.5; this.legL.th.rotation.x = 0.25;
      this.legR.sh.rotation.x = 0.9; this.legL.sh.rotation.x = 0.35;
    }

    // --- arms: hold the weapon, swing the support arm while sprinting ------
    const aimX = -1.15 + this.pitch * 0.75;
    const rl = this.pose.reload, fi = this.pose.fire;
    this.armR.sh.rotation.set(0, 0, -0.18);
    this.armR.up.rotation.set(aimX + rl * 0.35 + kneel * 0.35, -0.22, 0.34 - fi * 0.06);
    this.armR.lo.rotation.set(-0.55 + rl * 0.5 - fi * 0.1, 0.12, -0.15);
    this.armL.sh.rotation.set(0, 0, 0.18);
    if (kneel > 0.4) {                            // both hands on the bomb
      this.armL.up.rotation.set(-1.35, 0.5, -0.5);
      this.armL.lo.rotation.set(-0.9, -0.3, 0.2);
      this.armR.up.rotation.set(-1.3, -0.35, 0.4);
      this.armR.lo.rotation.set(-0.85, 0.25, -0.2);
    } else if (rl > 0.3) {                        // support hand at the magwell
      this.armL.up.rotation.set(-0.75, -0.7, 0.7);
      this.armL.lo.rotation.set(-1.5, -0.2, 0.1);
    } else {
      this.armL.up.rotation.set(aimX + 0.28, 0.62, -0.5);
      this.armL.lo.rotation.set(-0.95, -0.35, 0.28);
    }
    if (this.weapon) this.weapon.visible = kneel < 0.5;
    return this;
  }

  _animateDeath(dt) {
    const d = this.death;
    d.t += dt;
    const u = clamp01(d.t / d.dur);
    const e = 1 - Math.pow(1 - u, 2.1);
    const hips = this.hips;
    if (d.kind === 0) {                                   // fall backwards
      this.group.position.y = this.group.position.y;      // owner sets ground y
      hips.position.y = lerp(0.95, 0.24, e);
      hips.rotation.set(lerp(0, -1.42, e), 0, 0);
      this.spine.rotation.set(lerp(0, -0.25, e), 0, 0);
      this.chest.rotation.set(lerp(0, 0.35, e), 0, 0);
      this.head.rotation.set(lerp(0, d.headshot ? -0.9 : 0.4, e), 0, 0);
      this.legR.th.rotation.x = lerp(0, 0.5, e); this.legL.th.rotation.x = lerp(0, 0.25, e);
      this.legR.sh.rotation.x = lerp(0, 0.7, e); this.legL.sh.rotation.x = lerp(0, 1.0, e);
    } else if (d.kind === 1) {                            // crumple forward
      hips.position.y = lerp(0.95, 0.28, e);
      hips.rotation.set(lerp(0, 1.35, e), 0, 0);
      this.spine.rotation.set(lerp(0, 0.5, e), 0, 0);
      this.chest.rotation.set(lerp(0, 0.3, e), 0, 0);
      this.head.rotation.set(lerp(0, 0.5, e), 0, 0);
      this.legR.sh.rotation.x = lerp(0, 1.5, e); this.legL.sh.rotation.x = lerp(0, 1.2, e);
    } else {                                              // spin to the side
      hips.position.y = lerp(0.95, 0.26, e);
      hips.rotation.set(lerp(0, -0.6, e), lerp(0, d.side * 0.8, e), lerp(0, d.side * 1.35, e));
      this.spine.rotation.set(0, 0, lerp(0, d.side * 0.3, e));
      this.head.rotation.set(0, lerp(0, -d.side * 0.5, e), lerp(0, d.side * 0.4, e));
      this.legR.th.rotation.x = lerp(0, 0.4, e); this.legL.th.rotation.x = lerp(0, -0.2, e);
      this.legR.sh.rotation.x = lerp(0, 0.9, e); this.legL.sh.rotation.x = lerp(0, 0.5, e);
    }
    // arms flop out
    const fa = e * 0.9;
    this.armR.up.rotation.set(-0.3 + fa * 0.6, -0.2, 0.4 + fa * 0.7);
    this.armR.lo.rotation.set(-0.2 - fa * 0.5, 0, 0);
    this.armL.up.rotation.set(-0.3 + fa * 0.5, 0.2, -0.4 - fa * 0.7);
    this.armL.lo.rotation.set(-0.2 - fa * 0.4, 0, 0);
    if (this.weapon && u > 0.25) this.weapon.visible = false;
    return this;
  }

  dispose() {
    if (this.weapon) { this.mount.remove(this.weapon); this.weapon = null; }
    this.group.clear();
    return this;
  }
}

export { buildWorldWeapon };
export default CharacterModel;





