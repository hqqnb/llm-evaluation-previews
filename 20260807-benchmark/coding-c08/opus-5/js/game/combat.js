// ============================================================================
// game/combat.js — hitscan resolution, hitboxes, wall penetration, damage.
// ============================================================================

import * as THREE from 'three';
import { HITBOX, HIT_MULT, SURFACE, SOUND_RANGE, MAT_SURFACE } from '../core/constants.js';
import { rayBox, clamp, gauss, rand } from '../core/util.js';
import { damageAtRange, armorDamage } from './weapons.js';

const _dir = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _n = { x: 0, y: 0, z: 0 };
const _boxes = [];

export class Combat {
  constructor(game) {
    this.game = game;
    this.lastHitTime = 0;
  }

  /** Fire the actor's current weapon (all pellets). */
  shoot(actor) {
    const game = this.game;
    const def = actor.active.def;
    actor.aimDir(_dir);
    const spread = actor.spread;
    const pellets = def.pellets || 1;
    game.muzzlePos(actor, _muzzle);
    for (let i = 0; i < pellets; i++) {
      const s = pellets > 1 ? (def.pelletSpread ?? spread * 3) : spread;
      this.bullet(actor, _dir, def, s, _muzzle, i);
    }
    // audio + noise + fx
    game.audio?.play(def.sound || 'shoot_rifle', { pos: actor.pos, vol: 1, pitch: 0.97 + Math.random() * 0.06 });
    game.emitSound(actor.pos, 'shoot', actor.team, SOUND_RANGE.shoot);
    game.fx?.muzzle(_muzzle, _dir, { scale: def.kind === 'sniper' ? 1.5 : def.kind === 'pistol' ? 0.8 : 1.1 });
    if (def.shellEject !== false) game.fx?.casing(_muzzle, _dir, _up);
    game.bus.emit('shot', { actor, weapon: def.id });
  }

  /** One hitscan bullet with cone spread and wall penetration. */
  bullet(actor, baseDir, def, spread, muzzle, index = 0) {
    const game = this.game, world = game.world;
    // cone spread around the aim direction
    _dir.copy(baseDir);
    if (spread > 0) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.abs(gauss()) * 0.5 * spread;
      _tmp.set(-_dir.z, 0, _dir.x);
      if (_tmp.lengthSq() < 1e-6) _tmp.set(1, 0, 0);
      _tmp.normalize();
      const up = _tmp.clone().cross(_dir).normalize();
      _dir.addScaledVector(_tmp, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
    }
    _origin.copy(actor.eye);
    let remaining = def.range ?? 100;
    let pen = def.penetration ?? 1;
    let dmgScale = 1;
    let travelled = 0;
    let guard = 0;

    while (remaining > 0.5 && guard++ < 4) {
      const wh = world.trace(_origin, _dir, remaining, {});
      const ah = this.traceActors(_origin, _dir, wh.hit ? wh.dist : remaining, actor);
      if (ah) {
        const dist = travelled + ah.dist;
        const base = damageAtRange(def, dist) * dmgScale;
        this.hitActor(actor, ah.actor, ah.hitbox, base, def, ah.point, _dir);
        if (index === 0 || def.pellets) game.fx?.tracer(muzzle, ah.point, { width: def.kind === 'sniper' ? 0.05 : 0.03 });
        return;
      }
      if (!wh.hit) {
        _tmp.copy(_origin).addScaledVector(_dir, remaining);
        if (index === 0) game.fx?.tracer(muzzle, _tmp, {});
        return;
      }
      // world impact
      if (index === 0 || def.pellets) game.fx?.tracer(muzzle, wh.point, { width: def.kind === 'sniper' ? 0.05 : 0.03 });
      game.fx?.impact(wh.point, wh.normal, wh.surface);
      game.audio?.play(`impact_${wh.surface === SURFACE.SAND ? 'dirt' : wh.surface}`, { pos: wh.point, vol: 0.55 });
      // can the bullet punch through?
      const brush = wh.brush;
      const thin = brush ? Math.min(brush.max.x - brush.min.x, brush.max.z - brush.min.z, brush.max.y - brush.min.y) : 9;
      if (pen <= 0.05 || thin > 0.62 * pen) return;
      world.exitPoint(brush, wh.point, _dir, _tmp);
      const through = _tmp.distanceTo(wh.point);
      pen -= 0.6 + through * 0.8;
      dmgScale *= 0.62;
      travelled += wh.dist + through;
      remaining -= wh.dist + through;
      _origin.copy(_tmp);
      game.audio?.play('penetrate', { pos: wh.point, vol: 0.4 });
      if (dmgScale < 0.18) return;
    }
  }

  /** Nearest actor hit along a ray. */
  traceActors(origin, dir, maxDist, ignoreActor, teamFilter = null) {
    let best = null, bestT = maxDist;
    for (const a of this.game.actors) {
      if (!a.alive || a === ignoreActor) continue;
      if (teamFilter && a.team !== teamFilter) continue;
      // cheap reject: distance to the ray
      const dx = a.pos.x - origin.x, dy = a.pos.y + 0.9 - origin.y, dz = a.pos.z - origin.z;
      const along = dx * dir.x + dy * dir.y + dz * dir.z;
      if (along < -1 || along > bestT + 1.2) continue;
      const px = dx - dir.x * along, py = dy - dir.y * along, pz = dz - dir.z * along;
      if (px * px + py * py + pz * pz > 1.6) continue;
      a.hitboxes(_boxes);
      for (const b of _boxes) {
        const t = rayBox(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, b, bestT, _n);
        if (t >= 0 && t < bestT) {
          bestT = t;
          best = best || {};
          best.actor = a; best.hitbox = b.kind; best.dist = t;
          best.point = (best.point || new THREE.Vector3()).set(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t);
        }
      }
    }
    return best;
  }

  /** Apply one bullet's worth of damage with armour and hitbox scaling. */
  hitActor(attacker, victim, hitbox, baseDamage, def, point, dir) {
    const game = this.game;
    const friendly = attacker && attacker.team === victim.team && attacker !== victim;
    if (friendly && !game.cfg.friendlyFire) {
      game.fx?.blood(point, dir, 0.3);
      return 0;
    }
    const mult = HIT_MULT[hitbox] ?? 1;
    let dmg = baseDamage * mult * (hitbox === HITBOX.HEAD ? (def.hsMult ?? 1) : 1);
    const armored = victim.armor > 0 && hitbox !== HITBOX.LEG;
    const helmetSaves = hitbox === HITBOX.HEAD && victim.helmet;
    const split = armorDamage(def, dmg, armored, victim.helmet, hitbox);
    dmg = split.health;
    if (armored || helmetSaves) victim.armor = Math.max(0, victim.armor - split.armor);
    const dealt = victim.hurt(dmg, attacker, hitbox, def.id, dir);
    // feedback
    const sound = hitbox === HITBOX.HEAD ? (victim.helmet ? 'hit_helmet' : 'headshot') : (armored ? 'hit_kevlar' : 'hit_flesh');
    game.audio?.play(sound, { pos: point, vol: 0.9 });
    game.fx?.blood(point, dir, hitbox === HITBOX.HEAD ? 1.4 : 1);
    if (attacker) {
      if (hitbox === HITBOX.HEAD) attacker.headshots++;
      if (attacker === game.local) game.hud?.hitmarker(Math.round(dealt), hitbox === HITBOX.HEAD, !victim.alive);
      attacker.bot?.onHitConfirm?.(victim, dealt);
    }
    if (victim === game.local) game.hud?.damageFrom(Math.atan2(-(dir.z), -(dir.x)), dealt);
    return dealt;
  }

  /** Knife swing: short cone, back-stab bonus. */
  knifeAttack(actor, secondary = false) {
    const game = this.game;
    const def = actor.active.def;
    actor.aimDir(_dir);
    game.audio?.play('knife_swing', { pos: actor.pos, vol: 0.7 });
    const reach = secondary ? 1.35 : 1.15;
    const hit = this.traceActors(actor.eye, _dir, reach, actor);
    if (!hit) return;
    // stabbing someone in the back is lethal, as in CS
    const back = Math.cos(hit.actor.yaw - actor.yaw) > 0.35;
    let dmg = secondary ? (back ? 195 : 65) : (back ? 90 : 40);
    game.audio?.play('knife_hit', { pos: hit.point, vol: 0.9 });
    this.hitActor(actor, hit.actor, back ? HITBOX.CHEST : hit.hitbox, dmg, def, hit.point, _dir);
  }

  /** Radius damage used by HE grenades and the bomb. */
  explode(pos, radius, maxDamage, attacker, weaponId, opts = {}) {
    const game = this.game;
    for (const a of game.actors) {
      if (!a.alive) continue;
      const d = Math.hypot(a.pos.x - pos.x, a.pos.y + 0.9 - pos.y, a.pos.z - pos.z);
      if (d > radius) continue;
      // three probes so cover matters
      let vis = 0;
      _tmp.set(a.pos.x, a.pos.y + a.height * 0.55, a.pos.z);
      if (game.world.los(pos, _tmp, { smoke: false })) vis += 0.6;
      _tmp.set(a.pos.x, a.pos.y + a.height - 0.2, a.pos.z);
      if (game.world.los(pos, _tmp, { smoke: false })) vis += 0.25;
      _tmp.set(a.pos.x, a.pos.y + 0.2, a.pos.z);
      if (game.world.los(pos, _tmp, { smoke: false })) vis += 0.15;
      if (vis <= 0.01) continue;
      const falloff = Math.pow(clamp(1 - d / radius, 0, 1), 1.6);
      let dmg = maxDamage * falloff * vis;
      const friendly = attacker && attacker.team === a.team && attacker !== a;
      if (friendly && !game.cfg.friendlyFire) continue;
      if (a.armor > 0) { dmg *= 0.72; a.armor = Math.max(0, a.armor - dmg * 0.35); }
      _tmp.set(a.pos.x - pos.x, 0, a.pos.z - pos.z).normalize();
      a.hurt(dmg, attacker, HITBOX.CHEST, weaponId, _tmp);
    }
  }
}


