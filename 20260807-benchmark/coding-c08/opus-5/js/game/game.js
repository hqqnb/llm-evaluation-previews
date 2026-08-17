// ============================================================================
// game/game.js — the simulation hub.
//
// Owns the world, the actors, the match state machine and every subsystem.
// Presentation modules (scene, fx, audio, hud, viewmodel) are optional, so the
// exact same simulation can be run headless by the test suite.
// ============================================================================

import * as THREE from 'three';
import {
  TEAM, OTHER_TEAM, PHASE, SLOT, ROUND, MONEY, AREA, SOUND_RANGE, PLAYER, DIFFICULTY,
} from '../core/constants.js';
import { clamp, pick, shuffle, rand, EventBus } from '../core/util.js';
import { World } from '../world/world.js';
import { NavGraph } from '../world/nav.js';
import { Actor, makeCmd } from './actor.js';
import { Combat } from './combat.js';
import { Match } from './round.js';
import { GrenadeSystem } from './grenades.js';
import { Bot } from './bot.js';
import { TeamCoordinator } from './botteam.js';
import { botBuyPlan, buy as buyItem, canBuy } from './economy.js';
import { WEAPONS, getWeapon, killReward as killRewardFor } from './weapons.js';

const BOT_NAMES = [
  'Ivan', 'Vitaly', 'Yasin', 'Omar', 'Karim', 'Dmitri', 'Bohdan', 'Rashid',
  'Cooper', 'Mueller', 'Laurent', 'Nilsson', 'Tanaka', 'Silva', 'Novak', 'Ferrari',
  'Kowalski', 'Ahmadi', 'Boone', 'Duncan', 'Reyes', 'Okafor', 'Bishop', 'Vega',
];

export class Game {
  constructor(opts = {}) {
    this.cfg = opts.cfg;
    this.map = opts.map;
    this.bus = new EventBus();
    this.world = new World(this.map);
    this.nav = new NavGraph(this.map, this.world);
    this.world.nav = this.nav;
    this.combat = new Combat(this);
    this.grenades = new GrenadeSystem(this);
    this.actors = [];
    this.local = null;
    this.time = 0;
    this.frame = 0;
    this.paused = false;
    this.headless = !opts.scene;
    this.scene = opts.scene || null;
    this.fx = opts.fx || null;
    this.audio = opts.audio || null;
    this.hud = opts.hud || null;
    this.vm = opts.vm || null;
    this.makeCharacter = opts.makeCharacter || null;
    this.makeWorldWeapon = opts.makeWorldWeapon || null;

    this.sounds = [];
    this.killfeed = [];
    this.pickups = [];
    this.bomb = {
      state: 'carried', pos: new THREE.Vector3(), site: null, timer: ROUND.bombTime,
      planter: null, defuser: null, carrier: null, defuseProgress: 0, plantProgress: 0,
      mesh: null,
    };
    this.spectate = { target: null, mode: 'follow' };
    this.aimOnEnemy = false;
    this.match = new Match(this);
    this.coordinator = { T: new TeamCoordinator(this, TEAM.T), CT: new TeamCoordinator(this, TEAM.CT) };
    this._spotTimer = 0;
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this.normaliseNadeLines();
    this.createRoster(opts);
  }

  /**
   * Scripted utility lines are authored with an eye-height origin; bots walk to
   * `from` on foot, so snap it down to the floor there (and drop any line whose
   * origin turns out to be unreachable geometry).
   */
  normaliseNadeLines() {
    const lines = this.map.tactics?.nades;
    if (!lines) return;
    for (let i = lines.length - 1; i >= 0; i--) {
      const n = lines[i];
      const g = this.world.groundY(n.from[0], n.from[2], n.from[1] + 2.2);
      if (!g.brush || !this.world.fits(n.from[0], g.y + 0.05, n.from[2], PLAYER.radius, PLAYER.crouchHeight)) {
        lines.splice(i, 1);
        continue;
      }
      n.from = [n.from[0], g.y, n.from[2]];
    }
  }

  // --- roster ---------------------------------------------------------------
  createRoster(opts) {
    const cfg = this.cfg;
    const total = clamp(cfg.botCount ?? 8, 1, 10) + (opts.spectatorOnly ? 0 : 1);
    const humanTeam = cfg.team === 'random' ? pick([TEAM.T, TEAM.CT]) : (cfg.team || TEAM.CT);
    const perTeam = Math.max(1, Math.round(total / 2));
    const names = shuffle(BOT_NAMES.slice());
    const counts = { T: 0, CT: 0 };

    if (!opts.spectatorOnly) {
      this.local = new Actor(this, { team: humanTeam, name: cfg.playerName || '你', isBot: false, id: 'human' });
      this.actors.push(this.local);
      counts[humanTeam]++;
    }
    let guard = 0;
    while ((counts.T + counts.CT) < total && guard++ < 32) {
      const team = counts.T <= counts.CT && counts.T < perTeam ? TEAM.T
        : counts.CT < perTeam ? TEAM.CT : (counts.T <= counts.CT ? TEAM.T : TEAM.CT);
      const a = new Actor(this, {
        team, name: `${names.pop() || 'Bot'}`, isBot: true, difficulty: cfg.difficulty || 'normal',
      });
      a.bot = new Bot(a, this, cfg.difficulty || 'normal');
      this.actors.push(a);
      counts[team]++;
    }
    this.teamSize = counts;
  }

  alive(team) {
    const out = [];
    for (const a of this.actors) if (a.alive && (!team || a.team === team)) out.push(a);
    return out;
  }

  team(t) { return this.actors.filter((a) => a.team === t); }
  enemiesOf(actor) { return this.actors.filter((a) => a.team !== actor.team); }
  aliveEnemiesOf(actor) { return this.actors.filter((a) => a.alive && a.team !== actor.team); }

  // --- round lifecycle ------------------------------------------------------
  resetRound() {
    const map = this.map;
    this.grenades.clear();
    this.fx?.clear();
    for (const p of this.pickups) if (p.mesh) this.scene?.remove(p.mesh);
    this.pickups.length = 0;
    this.sounds.length = 0;
    this.bomb.state = 'carried';
    this.bomb.site = null;
    this.bomb.planter = null;
    this.bomb.defuser = null;
    this.bomb.defuseProgress = 0;
    this.bomb.plantProgress = 0;
    this.bomb.timer = ROUND.bombTime;
    if (this.bomb.mesh) { this.scene?.remove(this.bomb.mesh); this.bomb.mesh = null; this.bomb.light = null; }

    // spawns, in order, cycling if there are more players than spawn points
    const idx = { T: 0, CT: 0 };
    for (const a of this.actors) {
      const list = map.spawns[a.team];
      const sp = list[idx[a.team]++ % list.length];
      // equipment: survivors keep their guns, the dead re-buy from scratch
      if (a.lostGear) {
        a.clearInventory();
        a.armor = 0; a.helmet = false;
        if (a.team === TEAM.CT) a.kit = false;
      }
      if (!a.inv.knife) a.giveWeapon('knife', { silent: true });
      if (!a.inv.secondary && !a.inv.primary) a.giveWeapon(a.team === TEAM.T ? 'glock' : 'usp', { silent: true });
      a.inv.bomb = false;
      a.lostGear = false;
      a.spawn(sp);
      a.model?.setVisible(true);
      a.bot?.onRoundStart?.(null);
    }
    // hand the bomb to a T
    const ts = this.alive(TEAM.T);
    if (ts.length) {
      const carrier = ts[(Math.random() * ts.length) | 0];
      carrier.giveWeapon('c4', { silent: true });
      this.bomb.carrier = carrier;
    }
    this.coordinator.T.onRoundStart(this.match);
    this.coordinator.CT.onRoundStart(this.match);
    for (const a of this.actors) if (a.bot) a.bot.onRoundStart(this.coordinator[a.team].assignmentFor(a));
    this.spectate.target = null;
    this.aimOnEnemy = false;
  }

  // --- main tick ------------------------------------------------------------
  update(dt) {
    if (this.paused) return;
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.frame++;
    this.match.update(dt);

    const frozen = this.match.phase === PHASE.FREEZE || this.match.phase === PHASE.ROUND_END
      || this.match.phase === PHASE.HALFTIME || this.match.phase === PHASE.MATCH_END;

    // buy-zone flags (drives the buy menu and the bots' shopping)
    for (const a of this.actors) {
      const bz = this.map.buyzones[a.team];
      a.inBuyZone = !!bz && a.pos.x >= bz.x0 && a.pos.x <= bz.x1 && a.pos.z >= bz.z0 && a.pos.z <= bz.z1;
    }

    // bots think (their own code handles the freeze/buy phase), then everyone integrates
    for (const a of this.actors) {
      if (a.alive && a.bot) a.bot.update(dt);
      if (frozen && a.alive) {
        a.cmd.forward = 0; a.cmd.right = 0; a.cmd.jump = false;
        a.cmd.attack = false; a.cmd.attack2 = false;
        a.vel.x = 0; a.vel.z = 0;
      }
      if (a.cmd.buy && this.match.isBuyTime) this.runBuy(a);
      a.update(dt);
    }

    this.grenades.update(dt);
    this.updateObjective(dt);
    this.updatePickups(dt);
    this.updateSpotting(dt);
    this.updateCoordinators(dt);
    // prune stale audible events
    for (let i = this.sounds.length - 1; i >= 0; i--) if (this.time - this.sounds[i].t > 2.2) this.sounds.splice(i, 1);
    if (this.killfeed.length > 8) this.killfeed.splice(0, this.killfeed.length - 8);
  }

  updateCoordinators(dt) {
    this.coordinator.T.update(dt);
    this.coordinator.CT.update(dt);
  }

  runBuy(actor) {
    const list = actor.cmd.buy;
    actor.cmd.buy = null;
    if (!Array.isArray(list)) return;
    for (const id of list) {
      const chk = canBuy(actor, id, this.match);
      if (!chk.ok) continue;
      buyItem(actor, id, this);
      this.bus.emit('buy', { actor, id });
    }
  }

  // --- objective: planting and defusing -------------------------------------
  updateObjective(dt) {
    const m = this.match, bomb = this.bomb;
    if (m.phase === PHASE.LIVE) {
      for (const a of this.alive(TEAM.T)) {
        const inSite = this.siteAt(a.pos);
        const can = a.hasBomb && inSite && a.onGround && a.cmd.use;
        if (can) {
          if (a.plantingT === 0) {
            this.audio?.play('bomb_plant_start', { pos: a.pos });
            a.switchTo(SLOT.BOMB, true);
            this.emitSound(a.pos, 'plant', a.team, SOUND_RANGE.plant);
            a.bot?.onPlantStart?.();
          }
          a.plantingT += dt;
          bomb.plantProgress = clamp(a.plantingT / ROUND.plantTime, 0, 1);
          if (a === this.local) this.hud?.progress('正在安放炸弹', 1 - bomb.plantProgress, {});
          if (a.plantingT >= ROUND.plantTime) { a.plantingT = 0; m.plantBomb(a, inSite); }
        } else if (a.plantingT > 0) {
          a.plantingT = 0;
          bomb.plantProgress = 0;
          if (a === this.local) this.hud?.progress(null, null);
          if (a.activeSlot === SLOT.BOMB) a.selectBest();
        }
      }
    } else if (m.phase === PHASE.PLANTED) {
      let anyDefusing = false;
      for (const a of this.alive(TEAM.CT)) {
        const near = a.pos.distanceTo(bomb.pos) < 1.5 && Math.abs(a.pos.y - bomb.pos.y) < 1.6;
        a.hasDefuseTarget = near;
        if (near && a.cmd.use && a.onGround) {
          if (a.defusingT === 0) {
            this.audio?.play('defuse_loop', { pos: a.pos });
            this.emitSound(a.pos, 'defuse', a.team, SOUND_RANGE.defuse);
            bomb.defuser = a;
            a.bot?.onDefuseStart?.();
          }
          a.defusingT += dt;
          a.defuseGrace = 0;
          anyDefusing = true;
          const need = a.kit ? ROUND.defuseKitTime : ROUND.defuseTime;
          bomb.defuseProgress = clamp(a.defusingT / need, 0, 1);
          if (a === this.local) this.hud?.progress(a.kit ? '正在拆弹（拆弹器）' : '正在拆弹', 1 - bomb.defuseProgress, { danger: true });
          if (a.defusingT >= need) { a.defusingT = 0; m.defuseComplete(a); return; }
        } else if (a.defusingT > 0) {
          // a very short interruption is forgiven; anything longer resets, as in CS
          a.defuseGrace = (a.defuseGrace || 0) + dt;
          if (a.defuseGrace > 0.2) {
            a.defusingT = 0;
            a.defuseGrace = 0;
            if (bomb.defuser === a) { bomb.defuser = null; bomb.defuseProgress = 0; }
            if (a === this.local) this.hud?.progress(null, null);
          }
        }
      }
      if (!anyDefusing) { bomb.defuseProgress = 0; bomb.defuser = null; }
    }
  }

  /** Which bombsite (if any) a position is standing in. */
  siteAt(pos) {
    for (const [k, s] of Object.entries(this.map.sites)) {
      const a = s.area;
      if (pos.x >= a.x0 && pos.x <= a.x1 && pos.z >= a.z0 && pos.z <= a.z1 &&
        pos.y >= (a.y0 ?? -3) && pos.y <= (a.y1 ?? 6)) return k;
    }
    return null;
  }

  // --- dropped weapons ------------------------------------------------------
  dropPickup(actor, inst, opts = {}) {
    const pos = actor ? actor.pos.clone() : (opts.pos ? opts.pos.clone() : new THREE.Vector3());
    pos.y += 0.35;
    if (actor) {
      pos.x += Math.cos(actor.yaw) * 0.6;
      pos.z += Math.sin(actor.yaw) * 0.6;
      this.world.settle(pos, 0.25, 0.3);
      pos.y += 0.12;
    }
    const p = {
      id: inst.id, def: inst.def || getWeapon(inst.id), ammo: inst.ammo ?? 30, reserve: inst.reserve ?? 0,
      pos, until: this.time + 999, mesh: null, spin: Math.random() * 6.28,
    };
    if (this.makeWorldWeapon && this.scene) {
      p.mesh = this.makeWorldWeapon(p.id);
      if (p.mesh) { p.mesh.position.copy(pos); p.mesh.rotation.y = p.spin; this.scene.add(p.mesh); }
    }
    this.pickups.push(p);
    this.audio?.play('c4_drop', { pos, vol: 0.4 });
    return p;
  }

  updatePickups(dt) {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      if (p.mesh) p.mesh.rotation.y += dt * 0.6;
      for (const a of this.actors) {
        if (!a.alive) continue;
        if (a.pos.distanceTo(p.pos) > 1.7 || Math.abs(a.pos.y - p.pos.y) > 1.8) continue;
        const wantsIt = a.cmd.use || (p.id === 'c4' && a.team === TEAM.T && a.cmd.use);
        if (!wantsIt) continue;
        if (p.id === 'c4') {
          if (a.team !== TEAM.T) continue;
          a.giveWeapon('c4', { silent: true });
          this.bomb.carrier = a;
          this.audio?.play('bomb_pickup', { pos: a.pos });
        } else {
          const def = p.def;
          const slot = def.slot;
          if (slot === SLOT.PRIMARY && a.inv.primary) continue;
          if (slot === SLOT.SECONDARY && a.inv.secondary) continue;
          a.giveWeapon(p.id, { ammo: p.ammo, reserve: p.reserve });
          this.audio?.play('pickup', { pos: a.pos });
        }
        this.bus.emit('pickup', { actor: a, id: p.id });
        if (p.mesh) this.scene?.remove(p.mesh);
        this.pickups.splice(i, 1);
        break;
      }
    }
  }

  /** Nearest pickup a player could grab right now (for the "press E" prompt). */
  pickupNear(actor, range = 1.7) {
    let best = null, bd = range;
    for (const p of this.pickups) {
      const d = actor.pos.distanceTo(p.pos);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  // --- perception bookkeeping ----------------------------------------------
  updateSpotting(dt) {
    this._spotTimer -= dt;
    if (this._spotTimer > 0) return;
    this._spotTimer = 0.12;
    for (const a of this.actors) {
      if (!a.alive) { a.spotted = false; continue; }
      let seen = false;
      for (const o of this.actors) {
        if (!o.alive || o.team === a.team) continue;
        if (o.canSee(a) && o.inView(a, 140)) { seen = true; break; }
      }
      if (seen) { a.spotted = true; a.spottedTime = this.time; }
      else if (this.time - a.spottedTime > 2.2) a.spotted = false;
    }
    // is the local player's crosshair on an enemy? (used for the crosshair tint)
    if (this.local?.alive) {
      this.local.aimDir(this._tmp);
      const hit = this.combat.traceActors(this.local.eye, this._tmp, 90, this.local);
      const wall = this.world.trace(this.local.eye, this._tmp, hit ? hit.dist : 1, {});
      this.aimOnEnemy = !!hit && hit.actor.team !== this.local.team && !wall.hit;
    } else this.aimOnEnemy = false;
  }

  emitSound(pos, kind, team, range) {
    this.sounds.push({ pos: pos.clone ? pos.clone() : new THREE.Vector3(pos.x, pos.y, pos.z), kind, team, t: this.time, range });
    if (this.sounds.length > 64) this.sounds.shift();
  }

  radio(actor, key) {
    this.audio?.play('radio_beep', { vol: 0.35 });
    this.bus.emit('radio', { actor, key });
  }

  /** World-space muzzle position for tracers and flashes. */
  muzzlePos(actor, out) {
    if (actor === this.local && this.vm?.muzzleWorld) {
      this.vm.muzzleWorld(out);
      if (out.lengthSq() > 0) return out;
    }
    const d = actor.aimDir(this._tmp2);
    out.copy(actor.eye).addScaledVector(d, 0.42);
    out.x += Math.cos(actor.yaw + Math.PI / 2) * 0.12;
    out.z += Math.sin(actor.yaw + Math.PI / 2) * 0.12;
    out.y -= 0.07;
    return out;
  }

  // --- death / kill handling ------------------------------------------------
  onDeath(victim, killer, weaponId, headshot, dir) {
    victim.lostGear = true;
    const isTeamKill = killer && killer !== victim && killer.team === victim.team;
    // rewards
    if (killer && killer !== victim) {
      if (isTeamKill) {
        killer.money = clamp(killer.money + MONEY.teamKillPenalty, 0, MONEY.max);
        killer.kills--; killer.score -= 2;
      } else {
        killer.kills++;
        killer.roundKills++;
        killer.score += 2;
        killer.money = clamp(killer.money + killRewardFor(getWeapon(weaponId) || {}, victim.team, killer.team), 0, MONEY.max);
        this.audio?.play(killer === this.local ? 'killsound' : 'hitmarker', { vol: killer === this.local ? 0.8 : 0.001 });
      }
    } else if (!killer) {
      victim.money = clamp(victim.money + MONEY.suicidePenalty, 0, MONEY.max);
    }
    // assist: anyone who did ≥ 40 damage and is not the killer
    let assister = null;
    for (const [a, dmg] of victim.damagedBy) {
      if (a === killer || a.team === victim.team) continue;
      if (dmg >= 40 && (!assister || dmg > victim.damagedBy.get(assister))) assister = a;
    }
    if (assister) { assister.assists++; assister.score += 1; }

    // drop what they were carrying
    if (victim.inv.primary) { this.dropPickup(victim, victim.inv.primary); victim.inv.primary = null; }
    else if (victim.inv.secondary) { this.dropPickup(victim, victim.inv.secondary); victim.inv.secondary = null; }
    if (victim.inv.bomb) {
      victim.inv.bomb = false;
      const p = this.dropPickup(victim, { id: 'c4', def: getWeapon('c4'), ammo: 1, reserve: 0 });
      this.bomb.state = 'dropped';
      this.bomb.pos.copy(p.pos);
      this.bomb.carrier = null;
      for (const a of this.actors) a.bot?.onBombDropped?.(p.pos);
      this.coordinator.T.report('bomb_dropped', { pos: p.pos.clone() });
    }
    victim.active = null;
    victim.model?.die?.(dir || new THREE.Vector3(0, 0, 1), headshot);
    this.audio?.play(headshot ? 'death_headshot' : 'death', { pos: victim.pos, vol: 0.9 });

    const entry = {
      killer: killer ? killer.name : null, killerTeam: killer?.team || null,
      victim: victim.name, victimTeam: victim.team, weapon: weaponId, headshot: !!headshot,
      teamKill: !!isTeamKill, t: this.time, local: killer === this.local || victim === this.local,
    };
    this.killfeed.push(entry);
    this.bus.emit('kill', { victim, killer, weapon: weaponId, headshot, assist: assister, entry });
    this.coordinator[victim.team]?.report('down', { actor: victim, killer });
    this.coordinator[killer?.team || OTHER_TEAM[victim.team]]?.report('frag', { actor: killer, victim });
    for (const a of this.actors) if (a.alive && a.team === victim.team) a.bot?.onTeammateDown?.(victim);
    if (victim === this.local) {
      this.spectate.target = this.alive(victim.team)[0] || this.alive()[0] || null;
      this.hud?.showDeath?.({ killer: killer?.name, weapon: weaponId, headshot });
    }
  }

  // --- misc hooks used by the presentation layer ----------------------------
  onWeaponChange(actor) {
    if (actor === this.local) this.vm?.setWeapon?.(actor.active?.id || 'knife', { team: actor.team });
    actor.model?.setWeapon?.(actor.active?.id || 'knife');
  }

  onReload(actor, duration, type) {
    if (actor === this.local) this.vm?.reload?.(duration, type);
  }

  onSidesSwapped() {
    for (const a of this.actors) {
      if (a.model?.dispose && this.makeCharacter) {
        this.scene?.remove(a.model.group);
        a.model.dispose();
        a.model = this.makeCharacter(a);
        if (a.model && a !== this.local) this.scene?.add(a.model.group);
      }
    }
  }

  /** Next teammate to spectate after dying. */
  cycleSpectate(dir = 1) {
    const pool = this.alive(this.local?.team) .concat(this.alive().filter((a) => a.team !== this.local?.team));
    if (!pool.length) { this.spectate.target = null; return; }
    const i = pool.indexOf(this.spectate.target);
    this.spectate.target = pool[(i + dir + pool.length) % pool.length];
  }

  economyState(team) {
    const list = this.team(team);
    const avg = list.reduce((s, a) => s + a.money, 0) / Math.max(1, list.length);
    if (avg > 5200) return 'full';
    if (avg > 3200) return 'force';
    if (avg > 1800) return 'eco';
    return 'save';
  }

  dispose() {
    this.grenades.clear();
    for (const a of this.actors) { if (a.model) { this.scene?.remove(a.model.group); a.model.dispose?.(); } }
    for (const p of this.pickups) if (p.mesh) this.scene?.remove(p.mesh);
    this.pickups.length = 0;
  }
}








