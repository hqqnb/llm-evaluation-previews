// ============================================================================
// game/actor.js — one player (human or bot).
//
// Both the human controller and the bot AI drive an Actor exclusively through
// `actor.cmd` + `actor.yaw/pitch`, so movement, shooting, reloading, recoil and
// footsteps behave identically for everyone.
// ============================================================================

import * as THREE from 'three';
import {
  PLAYER, PHYS, SLOT, SLOT_ORDER, TEAM, SOUND_RANGE, SURFACE, HITBOX,
} from '../core/constants.js';
import { clamp, damp, angleWrap, rand, gauss } from '../core/util.js';
import { WEAPONS, getWeapon, spreadFor, getRecoil, isGear } from './weapons.js';

let NEXT_ID = 1;

export function makeCmd() {
  return {
    forward: 0, right: 0, jump: false, crouch: false, walk: false, sprint: false,
    attack: false, attack2: false, reload: false, use: false, drop: false,
    switchTo: null, buy: null, inspect: false,
  };
}

export class Actor {
  constructor(game, opts = {}) {
    this.game = game;
    this.id = opts.id || `p${NEXT_ID++}`;
    this.name = opts.name || 'Player';
    this.team = opts.team || TEAM.CT;
    this.isBot = !!opts.isBot;
    this.difficulty = opts.difficulty || null;
    this.bot = null;
    this.model = null;

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.eye = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.height = PLAYER.standHeight;
    this.radius = PLAYER.radius;
    this.cmd = makeCmd();
    this.wish = { x: 0, z: 0 };

    this.alive = false;
    this.health = 100;
    this.armor = 0;
    this.helmet = false;
    this.kit = false;
    this.money = 800;
    this.onGround = true;
    this.crouching = false;
    this.walking = false;
    this.sprinting = false;
    this.stamina = PHYS.sprintStamina;
    this.inBuyZone = false;

    this.inv = { primary: null, secondary: null, knife: null, grenades: [], bomb: false };
    this.active = null;
    this.activeSlot = SLOT.KNIFE;
    this.lastSlot = SLOT.KNIFE;
    this.grenadeIndex = 0;

    this.reloading = false;
    this.reloadT = 0;
    this.reloadDur = 0;
    this.nextFire = 0;
    this.shotIndex = 0;
    this.sinceShot = 99;
    this.ads = 0;              // 0..1 sight blend
    this.zoom = 0;             // scope level
    this.deployT = 0;
    this.punch = { x: 0, y: 0 };
    this.punchVel = { x: 0, y: 0 };
    this.recoilAim = { x: 0, y: 0 };   // recoil actually added to the view
    this.spread = 0.001;
    this.nadeWind = 0;         // grenade wind-up timer
    this.nadePending = null;
    this.flashAmount = 0;
    this.flashTime = 0;
    this.plantingT = 0;
    this.defusingT = 0;
    this.hasDefuseTarget = false;

    this.kills = 0; this.deaths = 0; this.assists = 0; this.score = 0;
    this.mvp = 0; this.damageDealt = 0; this.headshots = 0;
    this.roundKills = 0; this.roundDamage = 0;
    this.lastHurtBy = null; this.lastHurtTime = -99;
    this.damagedBy = new Map();       // for assists
    this.spotted = false; this.spottedTime = -99;
    this.stepDist = 0;
    this.deathTime = 0;
    this.killedBy = null; this.killedWith = null; this.killedHeadshot = false;
    this._scratch = new THREE.Vector3();
  }

  // --- lifecycle ------------------------------------------------------------
  spawn(spawnDef) {
    this.pos.set(spawnDef.pos[0], spawnDef.pos[1], spawnDef.pos[2]);
    this.game.world.settle(this.pos);
    this.vel.set(0, 0, 0);
    this.yaw = spawnDef.yaw ?? 0;
    this.pitch = 0;
    this.alive = true;
    this.health = PLAYER.maxHealth;
    this.height = PLAYER.standHeight;
    this.onGround = true;
    this.crouching = false;
    this.flashAmount = 0;
    this.reloading = false;
    this.shotIndex = 0;
    this.punch.x = this.punch.y = 0;
    this.recoilAim.x = this.recoilAim.y = 0;
    this.zoom = 0; this.ads = 0;
    this.plantingT = 0; this.defusingT = 0;
    this.roundKills = 0; this.roundDamage = 0;
    this.damagedBy.clear();
    this.stamina = PHYS.sprintStamina;
    this.spotted = false;
    Object.assign(this.cmd, makeCmd());
    // top up magazines between rounds
    for (const w of this.allGuns()) { w.ammo = w.def.mag; w.reserve = w.def.reserve; }
    this.selectBest();
    this.updateEye();
  }

  allGuns() {
    const out = [];
    if (this.inv.primary) out.push(this.inv.primary);
    if (this.inv.secondary) out.push(this.inv.secondary);
    return out;
  }

  /** Give a weapon / gear by id. Returns the dropped weapon id, if any. */
  giveWeapon(id, opts = {}) {
    const def = getWeapon(id);
    if (!def) return null;
    let dropped = null;
    if (id === 'kevlar') { this.armor = PLAYER.maxArmor; return null; }
    if (id === 'kevlarhelmet') { this.armor = PLAYER.maxArmor; this.helmet = true; return null; }
    if (id === 'defusekit') { this.kit = true; return null; }
    if (def.slot === SLOT.GRENADE) {
      const have = this.inv.grenades.find((g) => g.id === id);
      const total = this.inv.grenades.reduce((s, g) => s + g.count, 0);
      if (total >= 4) return null;
      if (have) have.count++;
      else this.inv.grenades.push({ id, def, count: 1, ammo: 1, reserve: 0 });
      if (!opts.silent) this.game?.audio?.play('pickup', { pos: this.pos });
      if (this.activeSlot === SLOT.GRENADE) this.switchTo(SLOT.GRENADE);
      return null;
    }
    if (def.slot === SLOT.BOMB) { this.inv.bomb = true; return null; }
    const inst = { id, def, ammo: opts.ammo ?? def.mag, reserve: opts.reserve ?? def.reserve };
    if (def.slot === SLOT.KNIFE) { this.inv.knife = inst; return null; }
    const slot = def.slot === SLOT.SECONDARY ? SLOT.SECONDARY : SLOT.PRIMARY;
    if (this.inv[slot]) dropped = this.inv[slot];
    this.inv[slot] = inst;
    if (dropped && this.game?.dropPickup) this.game.dropPickup(this, dropped);
    if (!opts.keepSlot) this.switchTo(slot);
    return dropped ? dropped.id : null;
  }

  clearInventory() {
    this.inv.primary = null;
    this.inv.secondary = null;
    this.inv.grenades = [];
    this.inv.bomb = false;
    this.armor = 0; this.helmet = false;
    this.inv.knife = { id: 'knife', def: getWeapon('knife'), ammo: 1, reserve: 0 };
    // every round starts with the free side pistol, exactly like CS
    this.giveWeapon(this.team === TEAM.T ? 'glock' : 'usp', { silent: true, keepSlot: true });
    this.switchTo(SLOT.SECONDARY, true) || this.switchTo(SLOT.KNIFE, true);
  }

  /** Auto-select the strongest thing we own. */
  selectBest() {
    if (this.inv.primary) this.switchTo(SLOT.PRIMARY);
    else if (this.inv.secondary) this.switchTo(SLOT.SECONDARY);
    else this.switchTo(SLOT.KNIFE);
  }

  switchTo(slotOrId, silent = false) {
    let slot = slotOrId, inst = null;
    if (typeof slotOrId === 'string' && !SLOT_ORDER.includes(slotOrId)) {
      // a weapon id: find where it lives
      const g = this.inv.grenades.find((x) => x.id === slotOrId);
      if (g) { slot = SLOT.GRENADE; this.grenadeIndex = this.inv.grenades.indexOf(g); }
      else if (this.inv.primary?.id === slotOrId) slot = SLOT.PRIMARY;
      else if (this.inv.secondary?.id === slotOrId) slot = SLOT.SECONDARY;
      else if (slotOrId === 'knife') slot = SLOT.KNIFE;
      else if (slotOrId === 'c4' && this.inv.bomb) slot = SLOT.BOMB;
      else return false;
    }
    if (slot === SLOT.PRIMARY) inst = this.inv.primary;
    else if (slot === SLOT.SECONDARY) inst = this.inv.secondary;
    else if (slot === SLOT.KNIFE) inst = this.inv.knife;
    else if (slot === SLOT.GRENADE) {
      if (!this.inv.grenades.length) return false;
      this.grenadeIndex = clamp(this.grenadeIndex, 0, this.inv.grenades.length - 1);
      inst = this.inv.grenades[this.grenadeIndex];
    } else if (slot === SLOT.BOMB) {
      if (!this.inv.bomb) return false;
      inst = { id: 'c4', def: getWeapon('c4'), ammo: 1, reserve: 0 };
    }
    if (!inst) return false;
    if (this.active === inst && this.activeSlot === slot) return false;
    if (this.activeSlot !== slot) this.lastSlot = this.activeSlot;
    this.activeSlot = slot;
    this.active = inst;
    this.reloading = false;
    this.shotIndex = 0;
    this.zoom = 0; this.ads = 0;
    this.deployT = inst.def.deployTime ?? 0.55;
    this.nextFire = Math.max(this.nextFire, this.deployT);
    if (!silent) this.game?.audio?.play('deploy', { pos: this.pos, vol: 0.5 });
    this.game?.onWeaponChange?.(this);
    return true;
  }

  nextGrenade() {
    if (this.inv.grenades.length < 2) return;
    this.grenadeIndex = (this.grenadeIndex + 1) % this.inv.grenades.length;
    this.active = this.inv.grenades[this.grenadeIndex];
    this.game?.onWeaponChange?.(this);
  }

  // --- per frame ------------------------------------------------------------
  update(dt) {
    const game = this.game, cmd = this.cmd;
    this.pitch = clamp(this.pitch, -1.54, 1.54);
    this.yaw = angleWrap(this.yaw);
    if (!this.alive) { this.updateEye(); return; }

    // flash blindness decays on its own curve (set by the grenade system)
    if (this.flashAmount > 0) this.flashAmount = Math.max(0, this.flashAmount - dt / Math.max(0.25, this.flashTime));

    // --- crouch / stance -----------------------------------------------------
    const wantCrouch = cmd.crouch;
    const targetH = wantCrouch ? PLAYER.crouchHeight : PLAYER.standHeight;
    if (targetH > this.height) {
      // only stand up when there is room
      if (game.world.fits(this.pos.x, this.pos.y + 0.02, this.pos.z, this.radius, targetH)) {
        this.height = Math.min(targetH, this.height + PLAYER.crouchSpeed * dt);
      }
    } else if (targetH < this.height) {
      this.height = Math.max(targetH, this.height - PLAYER.crouchSpeed * dt);
    }
    this.crouching = this.height < (PLAYER.standHeight + PLAYER.crouchHeight) / 2;

    // --- movement ------------------------------------------------------------
    const def = this.active?.def;
    let speed = PHYS.runSpeed * (def?.moveSpeed ?? 1);
    this.walking = !!cmd.walk;
    const canSprint = cmd.sprint && !cmd.walk && !this.crouching && this.stamina > 0.1 && this.onGround && !this.zoom;
    this.sprinting = canSprint && (Math.abs(cmd.forward) > 0.1 || Math.abs(cmd.right) > 0.1);
    if (this.sprinting) { speed *= PHYS.sprintMul; this.stamina = Math.max(0, this.stamina - dt); }
    else this.stamina = Math.min(PHYS.sprintStamina, this.stamina + dt * (PHYS.sprintStamina / PHYS.sprintRecover) * 0.5);
    if (this.walking) speed *= PHYS.walkMul;
    if (this.crouching) speed *= PHYS.crouchMul;
    if (this.zoom) speed *= def?.ads?.moveSpeed ?? 0.55;
    if (this.plantingT > 0 || this.defusingT > 0) speed = 0;

    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    let fx = cmd.forward, rx = cmd.right;
    const wl = Math.hypot(fx, rx);
    if (wl > 1) { fx /= wl; rx /= wl; }
    // forward = (cos yaw, sin yaw), right = (-sin yaw, cos yaw)
    this.wish.x = cy * fx - sy * rx;
    this.wish.z = sy * fx + cy * rx;
    this.wishSpeed = speed * Math.min(1, wl > 0 ? 1 : 0);
    this.jump = cmd.jump && this.onGround && !this.crouching;
    const res = game.world.moveEntity(this, dt);
    if (this.jump) { this.jump = false; cmd.jump = false; }
    this.onLadder = res.onLadder;
    this.groundSurface = res.surface;
    if (res.landed) this.onLand(res.landSpeed, res.surface);
    this.footsteps(dt, res.surface);
    this.updateEye();

    // --- weapon handling -----------------------------------------------------
    this.nextFire -= dt;
    this.sinceShot += dt;
    this.deployT = Math.max(0, this.deployT - dt);
    if (cmd.switchTo) { this.switchTo(cmd.switchTo); cmd.switchTo = null; }

    // aim-down-sights / scope
    const adsDef = def?.ads;
    if (adsDef && adsDef.type === 'scope') {
      const levels = Math.max(1, (adsDef.fov?.length ?? 3) - 1);
      if (cmd.attack2 && !this._adsHeld) {
        this.zoom = (this.zoom + 1) % (levels + 1);
        this.game?.audio?.play(this.zoom ? 'zoom_in' : 'zoom_out', { vol: 0.45 });
      }
      this.ads = this.zoom ? 1 : 0;
    } else if (adsDef && adsDef.type === 'iron') {
      this.zoom = cmd.attack2 ? 1 : 0;
      this.ads += (this.zoom - this.ads) * damp(adsDef.speed ?? 12, dt);
    } else { this.zoom = 0; this.ads = 0; }
    this._adsHeld = cmd.attack2;

    // reload
    if (this.reloading) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.finishReload();
    } else if (cmd.reload) {
      this.startReload();
      cmd.reload = false;
    }

    // grenade wind-up / throw
    if (this.nadePending) {
      this.nadeWind -= dt;
      if (this.nadeWind <= 0) this.releaseGrenade();
    } else if (this.active && this.activeSlot === SLOT.GRENADE && cmd.attack && this.nextFire <= 0 && this.deployT <= 0) {
      this.nadePending = { id: this.active.id, lob: !!cmd.attack2 };
      this.nadeWind = 0.32;
      this.game?.audio?.play('nade_pin', { pos: this.pos, vol: 0.7 });
      cmd.attack = false;
    } else if (this.active && this.activeSlot !== SLOT.GRENADE && this.activeSlot !== SLOT.BOMB) {
      if (cmd.attack && this.canFire()) this.fire();
      else if (cmd.attack && this.active.ammo <= 0 && this.nextFire <= 0 && this.activeSlot !== SLOT.KNIFE) {
        this.game?.audio?.play('dryfire', { pos: this.pos, vol: 0.6 });
        this.nextFire = 0.35;
        if (this.isBot) this.startReload();
      }
    }
    if (!cmd.attack) this._triggerHeld = false;

    // recoil recovery: the view punch springs back
    this.updatePunch(dt);
    this.spread = this.computeSpread();
  }

  updateEye() {
    this.eye.set(this.pos.x, this.pos.y + this.height - PLAYER.eyeDrop, this.pos.z);
  }

  /** Spring the view punch back toward zero (CS-style recoil recovery). */
  updatePunch(dt) {
    const rec = (this.active?.def?.recovery ?? 0.35);
    const k = damp(1 / Math.max(0.05, rec) * 2.4, dt);
    this.punch.x += (0 - this.punch.x) * k;
    this.punch.y += (0 - this.punch.y) * k;
    // the aim offset the player must fight follows the punch
    this.recoilAim.x = this.punch.x;
    this.recoilAim.y = this.punch.y;
    if (this.sinceShot > (rec + 0.25)) this.shotIndex = 0;
  }

  computeSpread() {
    const def = this.active?.def;
    if (!def || def.slot === SLOT.KNIFE) return 0.002;
    const moving = Math.hypot(this.vel.x, this.vel.z) > 1.1;
    return spreadFor(def, {
      moving, crouching: this.crouching, airborne: !this.onGround,
      ads: this.zoom > 0 ? 1 : this.ads, shotIndex: this.shotIndex, sinceShot: this.sinceShot,
    });
  }

  canFire() {
    if (!this.active || this.reloading || this.nextFire > 0 || this.deployT > 0) return false;
    const def = this.active.def;
    if (def.slot === SLOT.KNIFE) return true;
    if (this.active.ammo <= 0) return false;
    if (!def.auto && this._triggerHeld) return false;
    return true;
  }

  fire() {
    const def = this.active.def;
    this._triggerHeld = true;
    this.nextFire = 60 / (def.rpm || 600);
    if (def.slot === SLOT.KNIFE) { this.game.combat.knifeAttack(this); return; }
    this.active.ammo--;
    this.shotIndex++;
    this.sinceShot = 0;
    this.game.combat.shoot(this);
    // view punch from the authored recoil pattern
    const r = getRecoil(def, this.shotIndex - 1);
    const scale = (this.crouching ? 0.82 : 1) * (this.onGround ? 1 : 1.35);
    this.punch.y -= r.y * 0.0016 * scale;      // up
    this.punch.x += r.x * 0.0016 * scale;
    if (def.unscopeAfterShot && this.zoom) { this.zoom = 0; this.ads = 0; }
    if (this.active.ammo <= 0 && this.isBot) this.startReload();
  }

  startReload() {
    const w = this.active;
    if (!w || this.reloading) return false;
    const def = w.def;
    if (def.slot === SLOT.KNIFE || def.slot === SLOT.GRENADE || def.slot === SLOT.BOMB) return false;
    if (w.ammo >= def.mag || w.reserve <= 0) return false;
    this.reloading = true;
    this.reloadDur = def.reloadTime;
    this.reloadT = def.reloadTime;
    this.zoom = 0;
    this.game?.audio?.play(def.reloadType === 'shell' ? 'reload_shell' : 'reload_mag_out', { pos: this.pos, vol: 0.75 });
    this.game?.emitSound?.(this.pos, 'reload', this.team, SOUND_RANGE.reload);
    this.game?.onReload?.(this, def.reloadTime, def.reloadType);
    return true;
  }

  finishReload() {
    const w = this.active;
    this.reloading = false;
    if (!w) return;
    const need = w.def.mag - w.ammo;
    const take = Math.min(need, w.reserve);
    w.ammo += take;
    w.reserve -= take;
    this.shotIndex = 0;
    this.game?.audio?.play('reload_mag_in', { pos: this.pos, vol: 0.7 });
  }

  releaseGrenade() {
    const p = this.nadePending;
    this.nadePending = null;
    if (!p) return;
    const inst = this.inv.grenades.find((g) => g.id === p.id);
    if (!inst) return;
    this.game.grenades?.throwFrom(this, p.id, { power: p.lob ? 0.55 : 1, lob: p.lob });
    inst.count--;
    this.nextFire = 0.5;
    if (inst.count <= 0) {
      const i = this.inv.grenades.indexOf(inst);
      this.inv.grenades.splice(i, 1);
      this.grenadeIndex = 0;
      if (this.inv.grenades.length) this.switchTo(SLOT.GRENADE);
      else this.selectBest();
    } else {
      this.active = inst;
    }
  }

  onLand(speed, surface) {
    const hard = speed > 6.5;
    this.game?.audio?.play(hard ? 'land_hard' : 'land_soft', { pos: this.pos, vol: hard ? 0.9 : 0.5 });
    this.game?.emitSound?.(this.pos, 'land', this.team, SOUND_RANGE.land * (hard ? 1 : 0.5));
    if (speed > PHYS.maxFallDamageSpeed) {
      const dmg = (speed - PHYS.maxFallDamageSpeed) * PHYS.fallDamageScale;
      this.hurt(dmg, null, HITBOX.LEG, 'fall', null);
    }
    this.game?.fx?.dust?.(this.pos, hard ? 1 : 0.4);
  }

  footsteps(dt, surface) {
    if (!this.onGround) { this.stepDist = 1.3; return; }
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp < 0.45) return;
    this.stepDist += sp * dt;
    const stride = this.crouching ? 1.5 : this.walking ? 1.9 : this.sprinting ? 2.1 : 1.72;
    if (this.stepDist < stride) return;
    this.stepDist = 0;
    const loud = this.walking ? 0 : this.crouching ? 0.28 : this.sprinting ? 1.0 : 0.72;
    if (loud > 0) {
      this.game?.audio?.play(`step_${surface || SURFACE.SAND}`, { pos: this.pos, vol: 0.32 + loud * 0.5, pitch: 0.92 + Math.random() * 0.16 });
      const kind = this.sprinting ? 'sprint' : this.crouching ? 'crouch' : 'run';
      this.game?.emitSound?.(this.pos, kind, this.team, SOUND_RANGE[kind] ?? 12);
    }
  }

  // --- hitboxes -------------------------------------------------------------
  /**
   * Hitboxes in world space, ordered head-first so the first ray hit wins the
   * most valuable box. `head` is a small box, arms are folded into the chest.
   */
  hitboxes(out = []) {
    out.length = 0;
    const h = this.height, x = this.pos.x, y = this.pos.y, z = this.pos.z;
    const s = h / PLAYER.standHeight;
    const hr = 0.118, cr = 0.25, lr = 0.23;
    const headY = y + h - 0.145;                 // head centre, just above the eyes
    const headBot = headY - hr;
    out.push({ kind: HITBOX.HEAD, min: { x: x - hr, y: headBot, z: z - hr }, max: { x: x + hr, y: headY + hr + 0.03, z: z + hr } });
    out.push({ kind: HITBOX.CHEST, min: { x: x - cr, y: y + 1.0 * s, z: z - cr * 0.68 }, max: { x: x + cr, y: headBot, z: z + cr * 0.68 } });
    out.push({ kind: HITBOX.STOMACH, min: { x: x - cr * 0.9, y: y + 0.68 * s, z: z - cr * 0.66 }, max: { x: x + cr * 0.9, y: y + 1.0 * s, z: z + cr * 0.66 } });
    out.push({ kind: HITBOX.LEG, min: { x: x - lr, y, z: z - lr }, max: { x: x + lr, y: y + 0.68 * s, z: z + lr } });
    return out;
  }

  // --- damage ---------------------------------------------------------------
  hurt(amount, attacker, hitbox, weaponId, dir) {
    if (!this.alive || amount <= 0) return 0;
    const dealt = Math.min(this.health, amount);
    this.health -= amount;
    this.lastHurtBy = attacker || null;
    this.lastHurtTime = this.game?.time ?? 0;
    if (attacker && attacker !== this) {
      this.damagedBy.set(attacker, (this.damagedBy.get(attacker) || 0) + dealt);
      attacker.damageDealt += dealt;
      attacker.roundDamage += dealt;
    }
    this.game?.bus.emit('damage', { victim: this, attacker, amount: dealt, hitbox, weapon: weaponId, dir });
    this.bot?.onDamage?.({ attacker, amount: dealt, dir, hitbox });
    if (this.health <= 0) this.die(attacker, weaponId, hitbox === HITBOX.HEAD, dir);
    return dealt;
  }

  die(killer, weaponId, headshot, dir) {
    if (!this.alive) return;
    this.alive = false;
    this.health = 0;
    this.deaths++;
    this.deathTime = this.game?.time ?? 0;
    this.killedBy = killer || null;
    this.killedWith = weaponId || 'world';
    this.killedHeadshot = !!headshot;
    Object.assign(this.cmd, makeCmd());
    this.vel.set(0, 0, 0);
    this.game?.onDeath?.(this, killer, weaponId, !!headshot, dir);
  }

  // --- helpers --------------------------------------------------------------
  get hasBomb() { return !!this.inv.bomb; }
  get moving() { return Math.hypot(this.vel.x, this.vel.z) > 0.6; }
  get grenadeCount() { return this.inv.grenades.reduce((s, g) => s + g.count, 0); }

  aimDir(out = new THREE.Vector3()) {
    const p = clamp(this.pitch + this.recoilAim.y, -1.54, 1.54);
    const y = this.yaw + this.recoilAim.x;
    const cp = Math.cos(p);
    return out.set(Math.cos(y) * cp, -Math.sin(p), Math.sin(y) * cp).normalize();
  }

  lookAt(target, immediate = true) {
    const dx = target.x - this.eye.x, dy = target.y - this.eye.y, dz = target.z - this.eye.z;
    const yaw = Math.atan2(dz, dx);
    const pitch = -Math.atan2(dy, Math.hypot(dx, dz));
    if (immediate) { this.yaw = yaw; this.pitch = pitch; }
    return { yaw, pitch };
  }

  distTo(v) {
    const p = v.pos || v;
    return Math.hypot(this.pos.x - p.x, this.pos.y - p.y, this.pos.z - p.z);
  }

  canSee(other) {
    if (!other || !other.alive) return false;
    const w = this.game.world;
    this._scratch.set(other.pos.x, other.pos.y + other.height * 0.62, other.pos.z);
    if (w.los(this.eye, this._scratch)) return true;
    this._scratch.set(other.pos.x, other.pos.y + other.height - 0.2, other.pos.z);
    return w.los(this.eye, this._scratch);
  }

  /** True when `other` is inside our view cone (degrees). */
  inView(other, fovDeg = 105) {
    const dx = other.pos.x - this.pos.x, dz = other.pos.z - this.pos.z;
    const d = Math.atan2(dz, dx);
    return Math.abs(angleWrap(d - this.yaw)) < (fovDeg * Math.PI / 360);
  }
}









