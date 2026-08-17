// ============================================================================
// botteam.js — TeamCoordinator: one per team.  It owns the round plan (strat,
// lanes, roles, hold angles, rotations, retakes) and the shared enemy intel.
//
// Cheap by construction: the planner runs at 5 Hz, every bot only ever reads a
// small assignment object that is mutated in place (`rev` tells it to re-adopt).
// ============================================================================

import * as THREE from 'three';
import {
  DIFFICULTY, ROLE, AREA, PHASE, TEAM, OTHER_TEAM, ROUND, MONEY,
} from '../core/constants.js';
import { RADIO } from '../core/api.js';
import { clamp, clamp01, chance, rand, pick, weightedPick } from '../core/util.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const vecOk = (v) => !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

const CONTACT_LIFE = 6;          // seconds a shared contact stays actionable
const PLAN_HZ = 5;
const EMPTY = Object.freeze({});

function toVec(out, v) {
  if (Array.isArray(v)) {
    if (!Number.isFinite(v[0])) return null;
    return out.set(v[0], num(v[1], 0), num(v[2], 0));
  }
  if (vecOk(v)) return out.set(v.x, v.y, v.z);
  return null;
}

/** Split `n` players over weighted groups, biggest remainder first. */
function distribute(n, weights) {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map((w) => (n * w) / total);
  const out = raw.map((r) => Math.floor(r));
  let left = n - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k][1]]++;
  for (let k = 0; left > 0; k = (k + 1) % out.length, left--) out[k]++;
  return out;
}

/** The bot brain behind an actor, when there is one (humans have none). */
const brainOf = (a) => (a && a.bot && typeof a.bot.update === 'function' ? a.bot : null);

export class TeamCoordinator {
  constructor(game, team) {
    this.game = game;
    this.team = team === TEAM.T ? TEAM.T : TEAM.CT;
    this.enemyTeam = OTHER_TEAM[this.team];
    this.isT = this.team === TEAM.T;

    /** @type {Map<Object, Object>} actor -> assignment (mutated in place) */
    this.assignments = new Map();
    /** shared contacts: {enemy, pos, t, area, by, shared, shareAt} */
    this.contacts = [];
    this._pool = [];
    this._byEnemy = new Map();

    this.strategy = null;
    this.site = 'A';
    this.phase = 'setup';           // setup | exec | postplant | defend | retake
    this.history = [];              // {name, site, won}
    this.areaKnown = Object.create(null);
    this.enemiesKnown = 0;
    this.rev = 0;

    this.t0 = num(game && game.time, 0);
    this.liveSeen = false;
    this.execCalled = false;
    this.execAt = 0;
    this.switchCalled = false;
    this.bombPlanted = false;
    this.bombSite = null;
    this.bombPos = new THREE.Vector3();
    this.hasBombPos = false;
    this.bombDropped = false;
    this.retakeGo = false;
    this.retakeStage = new THREE.Vector3();
    this.hasRetakeStage = false;
    this.defuser = null;
    this.carrier = null;
    this.losses = 0;                // teammates down this round
    this.sitesClear = Object.create(null);
    this._tPlan = Math.random() * (1 / PLAN_HZ);
    this._radioT = 0;
    this._lastPlanT = 0;
    this._disposed = false;
  }

  // =========================================================================
  // small helpers
  // =========================================================================
  get strat() { return this.strategy; }

  get intel() {
    return {
      contacts: this.contacts,
      byArea: this.areaKnown,
      enemiesKnown: this.enemiesKnown,
      site: this.site,
      phase: this.phase,
      bombPlanted: this.bombPlanted,
      bombSite: this.bombSite,
    };
  }

  _now() { return num(this.game && this.game.time, 0); }

  _roster() {
    const g = this.game;
    if (typeof g.alive === 'function') return g.alive(this.team) || [];
    const out = [];
    const list = g.actors || [];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a && a.alive && a.team === this.team) out.push(a);
    }
    return out;
  }

  /** Difficulty profile of this team (averaged over its bots). */
  _diff() {
    const list = this._roster();
    let n = 0, tw = 0, peak = null;
    for (let i = 0; i < list.length; i++) {
      const b = brainOf(list[i]);
      if (!b || !b.diff) continue;
      n++; tw += b.diff.teamwork;
      if (!peak || b.diff.teamwork > peak.teamwork) peak = b.diff;
    }
    if (!n) {
      const key = (this.game.cfg && this.game.cfg.difficulty) || 'normal';
      return DIFFICULTY[key] || DIFFICULTY.normal;
    }
    // Use the strongest profile but with the team average teamwork.
    const base = peak || DIFFICULTY.normal;
    this._teamworkAvg = tw / n;
    return base;
  }

  _teamwork() {
    if (this._teamworkAvg == null) this._diff();
    return clamp01(num(this._teamworkAvg, this._diff().teamwork));
  }

  _tactics() {
    const m = this.game.map;
    return (m && m.tactics) || null;
  }

  /** Bomb-site key ('A' | 'B') that exists on this map. */
  _otherSite(s) {
    const sites = this.game.map && this.game.map.sites;
    const a = sites && sites.A ? 'A' : null;
    const b = sites && sites.B ? 'B' : null;
    if (s === 'A' && b) return 'B';
    if (s === 'B' && a) return 'A';
    return s;
  }

  _sitePoint(key, out) {
    const sites = this.game.map && this.game.map.sites;
    const s = sites && (sites[key] || sites.A || sites.B);
    if (!s) return null;
    return toVec(out, s.center);
  }

  _asg(actor) {
    let a = this.assignments.get(actor);
    if (!a) {
      a = {
        rev: 0, role: ROLE.SUPPORT, site: this.site, lane: null, route: null,
        holdSpot: null, stack: null, goAt: -1, postPlant: null, nadeLines: null,
        rotateTo: null, defuser: false, carrier: false, group: null,
      };
      this.assignments.set(actor, a);
    }
    return a;
  }

  /** @param {Object} actor  @returns {Object} the live assignment object */
  assignmentFor(actor) {
    if (!actor) return null;
    return this._asg(actor);
  }

  _bump(a) { a.rev = ++this.rev; return a; }

  /** Alive teammates that are actually bot-driven (reuses one array). */
  _collectBots() {
    const out = this._bots || (this._bots = []);
    out.length = 0;
    const list = this._roster();
    for (let i = 0; i < list.length; i++) {
      if (brainOf(list[i])) out.push(list[i]);
    }
    return out;
  }

  // =========================================================================
  // round lifecycle
  // =========================================================================
  onRoundStart(match) {
    const now = this._now();
    // Score the previous round so the T side can repeat what worked.
    const sc = (match && match.score) || (this.game.match && this.game.match.score);
    if (this.strategy && this._lastScore) {
      const mine = num(sc && sc[this.team], 0);
      const won = mine > num(this._lastScore[this.team], 0);
      this.history.push({ name: this.strategy.name, site: this.site, won });
      if (this.history.length > 12) this.history.shift();
    }
    this._lastScore = { T: num(sc && sc.T, 0), CT: num(sc && sc.CT, 0) };

    this.t0 = now;
    this.liveSeen = !!(match && match.phase === PHASE.LIVE);
    this.execCalled = false;
    this.switchCalled = false;
    this.bombPlanted = false;
    this.bombSite = null;
    this.hasBombPos = false;
    this.bombDropped = false;
    this.retakeGo = false;
    this.hasRetakeStage = false;
    this.losses = 0;
    this.defuser = null;
    this.carrier = null;
    this.phase = 'setup';
    this.enemiesKnown = 0;
    this._teamworkAvg = null;
    this._radioT = 0;
    this.areaKnown = Object.create(null);
    this.sitesClear = Object.create(null);
    for (let i = 0; i < this.contacts.length; i++) this._pool.push(this.contacts[i]);
    this.contacts.length = 0;
    this._byEnemy.clear();
    this._dirty = false;
    if (this.isT) this._planT(true); else this._planCT(true);
  }

  update(dt) {
    if (this._disposed) return;
    if (!Number.isFinite(dt) || dt <= 0) return;
    this._tPlan -= dt;
    if (this._tPlan > 0) return;
    this._tPlan += 1 / PLAN_HZ;
    const now = this._now();
    const phase = (this.game.match && this.game.match.phase) || PHASE.LIVE;
    if (phase === PHASE.FREEZE) { this.liveSeen = false; this.t0 = now; }
    else if (!this.liveSeen) {
      this.liveSeen = true;
      this.t0 = now;                                  // exec timers start on go
      this._dirty = true;
    }
    if (phase === PHASE.ROUND_END || phase === PHASE.HALFTIME
      || phase === PHASE.MATCH_END || phase === PHASE.MENU) return;

    this._decayIntel(now);
    this._recount(now);
    const bots = this._collectBots();
    if (this._dirty || bots.length !== this._lastCount) {
      this._lastCount = bots.length;
      this._dirty = false;
      if (this.isT) this._planT(false); else this._planCT(false);
    }
    if (this.isT) this._tickT(now, bots); else this._tickCT(now, bots);
    this._lastPlanT = now;
  }

  dispose() {
    this._disposed = true;
    this.assignments.clear();
    this._byEnemy.clear();
    this.contacts.length = 0;
    this._pool.length = 0;
    if (this._bots) this._bots.length = 0;
    this.strategy = null;
  }

  // =========================================================================
  // intel
  // =========================================================================
  _contactFor(enemy) {
    if (enemy) {
      const c = this._byEnemy.get(enemy);
      if (c) return c;
    }
    const c = this._pool.pop() || { enemy: null, pos: new THREE.Vector3(), t: 0, area: null, by: null, shared: false, shareAt: 0, heard: false };
    c.enemy = enemy || null;
    c.shared = false;
    c.heard = false;
    this.contacts.push(c);
    if (enemy) this._byEnemy.set(enemy, c);
    return c;
  }

  _decayIntel(now) {
    for (let i = this.contacts.length - 1; i >= 0; i--) {
      const c = this.contacts[i];
      const dead = c.enemy && !c.enemy.alive;
      if (dead || now - c.t > CONTACT_LIFE) {
        if (c.enemy) this._byEnemy.delete(c.enemy);
        c.enemy = null;
        this.contacts.splice(i, 1);
        this._pool.push(c);
        continue;
      }
      // Comms delay: worse teams take longer to actually pass the call on.
      if (!c.shared && now >= c.shareAt) c.shared = true;
    }
  }

  /** Recount how many enemies are known per area (used for rotations). */
  _recount(now) {
    const map = this.areaKnown;
    for (const k in map) map[k] = 0;
    let n = 0;
    for (let i = 0; i < this.contacts.length; i++) {
      const c = this.contacts[i];
      if (!c.shared) continue;
      if (c.enemy) n++;
      const key = c.area || 'UNKNOWN';
      map[key] = (map[key] || 0) + 1;
    }
    this.enemiesKnown = n;
  }

  /**
   * Everything the bots tell the team.
   * @param {'contact'|'down'|'plant'|'defuse'|'bomb_dropped'|'site_clear'|'hurt'} kind
   */
  report(kind, data) {
    if (this._disposed || !kind) return;
    const now = this._now();
    const d = data || EMPTY;
    switch (kind) {
      case 'contact': {
        const c = this._contactFor(d.enemy);
        if (!toVec(c.pos, d.pos || (d.enemy && d.enemy.pos))) { this._recycle(c); return; }
        c.t = now;
        c.by = d.by || null;
        c.heard = !!d.heard;
        const w = this._teamwork();
        if (!c.shared) {
          c.shareAt = now + (0.12 + 1.35 * (1 - w)) * (d.heard ? 1.6 : 1);
          if (chance(0.3 + 0.7 * w)) c.shareAt = Math.min(c.shareAt, now + 0.25);
          else if (w < 0.4) c.shareAt = now + 2.5;      // bad teams barely call it out
        }
        const world = this.game.world;
        c.area = d.area || (world && world.areaAt ? world.areaAt(c.pos) : null);
        if (!this.isT) this._maybeRotate(now, c);
        else if (c.area) this._dirtyIf(this.phase === 'setup');
        break;
      }
      case 'down': {
        this.losses++;
        const a = d.actor;
        if (a) {
          if (a === this.defuser) this.defuser = null;
          if (a === this.carrier) { this.carrier = null; this.bombDropped = true; }
          if (vecOk(a.pos)) { this.bombPos.copy(a.pos); }
          this.assignments.delete(a);
        }
        this._dirty = true;
        break;
      }
      case 'plant': {
        this.bombPlanted = true;
        this.bombSite = d.site || this.bombSite || this.site;
        if (toVec(this.bombPos, d.pos)) this.hasBombPos = true;
        this.phase = this.isT ? 'postplant' : 'retake';
        this.bombDropped = false;
        this.carrier = null;
        this._dirty = true;
        break;
      }
      case 'defuse': {
        // T side: somebody is on the bomb — everyone contests it.
        if (toVec(this.bombPos, d.pos)) this.hasBombPos = true;
        this.contested = now;
        if (this.isT) this._dirty = true;
        break;
      }
      case 'bomb_dropped': {
        this.bombDropped = true;
        this.carrier = null;
        if (toVec(this.bombPos, d.pos)) this.hasBombPos = true;
        this._dirty = true;
        break;
      }
      case 'site_clear': {
        const key = d.site || d.area;
        if (key) this.sitesClear[key] = now;
        this._dirty = true;
        break;
      }
      case 'hurt': {
        // Being shot is a contact even when nobody saw the shooter.
        const from = d.attacker;
        if (from && from.alive) {
          const c = this._contactFor(from);
          if (toVec(c.pos, from.pos)) {
            c.t = now;
            c.by = d.actor || null;
            const world = this.game.world;
            c.area = world && world.areaAt ? world.areaAt(c.pos) : null;
            if (!c.shared) c.shareAt = now + 0.4 + (1 - this._teamwork());
            if (!this.isT) this._maybeRotate(now, c);
          } else this._recycle(c);
        }
        break;
      }
      default: break;
    }
  }

  _recycle(c) {
    const i = this.contacts.indexOf(c);
    if (i >= 0) this.contacts.splice(i, 1);
    if (c.enemy) this._byEnemy.delete(c.enemy);
    c.enemy = null;
    this._pool.push(c);
  }

  _dirtyIf(cond) { if (cond) this._dirty = true; }

  _radio(actor, key, p = 1) {
    const g = this.game;
    if (!actor || typeof g.radio !== 'function' || !RADIO[key]) return;
    const now = this._now();
    if (now < this._radioT) return;
    if (!chance(clamp01(p))) return;
    this._radioT = now + 3.2 + rand(0, 2.5);
    g.radio(actor, key);
  }

  // =========================================================================
  // T side planning
  // =========================================================================
  _nodePos(step, out) {
    if (typeof step === 'string') {
      const nav = this.game.nav;
      const n = nav && nav.byId ? nav.byId(step) : null;
      return n && vecOk(n.pos) ? out.copy(n.pos) : null;
    }
    return toVec(out, step);
  }

  /** Average money / gun state — drives eco rushes vs full-buy defaults. */
  _economy() {
    const list = this._roster();
    let money = 0, guns = 0, n = 0;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      n++;
      money += num(a.money, 0);
      const pri = a.inv && a.inv.primary;
      if (pri) guns++;
    }
    if (!n) return { avg: MONEY.start, poor: false, rich: false };
    const avg = money / n;
    return { avg, poor: guns < n * 0.5 || avg < 1800, rich: avg > 5200 && guns >= n * 0.8 };
  }

  _pickStrat() {
    const tac = this._tactics();
    const strats = tac && tac.T && tac.T.strats;
    const eco = this._economy();
    const tw = this._teamwork();
    const sc = this._lastScore || EMPTY;
    const behind = num(sc[this.team], 0) < num(sc[this.enemyTeam], 0);
    const last = this.history.length ? this.history[this.history.length - 1] : null;
    if (Array.isArray(strats) && strats.length) {
      const chosen = weightedPick(strats, (s) => {
        let w = 1;
        const lanes = s.lanes ? Object.keys(s.lanes).length : 1;
        if (eco.poor) w *= lanes <= 1 ? 2.4 : 0.65;         // stack one lane on eco
        else w *= lanes >= 2 ? 1.35 : 0.95;                 // full buy → split default
        if (last) {
          if (last.name === s.name) w *= last.won ? 1.7 : 0.5;
          else if (last.site === s.site) w *= 0.85;         // mix the sites up
        }
        if (tw < 0.5 && lanes >= 3) w *= 0.5;               // cannot execute 3 ways
        if (behind && lanes <= 1) w *= 1.25;                // chase with fast plays
        if (tw > 0.8 && lanes >= 2) w *= 1.2;
        return Math.max(0.01, w);
      });
      if (chosen) return chosen;
    }
    // No scripted strats: alternate the sites with a single lane.
    const round = num(this.game.match && this.game.match.round, this.history.length);
    let site = round % 2 === 0 ? 'A' : 'B';
    const sites = this.game.map && this.game.map.sites;
    if (sites && !sites[site]) site = sites.A ? 'A' : 'B';
    return { name: 'default_' + site, cn: site === 'B' ? '默认打 B' : '默认打 A', site, lanes: { main: 1 } };
  }

  /** Lanes of the current strat, resolved against tactics.T.routes. */
  _laneList() {
    const tac = this._tactics();
    const routes = (tac && tac.T && tac.T.routes) || null;
    const lanes = this.strategy && this.strategy.lanes;
    const out = [];
    if (lanes) {
      for (const k in lanes) {
        const w = num(lanes[k], 1);
        if (w <= 0) continue;
        out.push({ name: k, weight: w, route: (routes && routes[k]) || null, stack: null });
      }
    }
    if (!out.length) {
      const r = routes && (routes[this.site] || routes.main || routes.default);
      out.push({ name: 'main', weight: 1, route: r || null, stack: null });
    }
    // Stack point ≈ two thirds down the lane, where the team gathers.
    for (let i = 0; i < out.length; i++) {
      const r = out[i].route;
      if (Array.isArray(r) && r.length > 1) {
        const idx = clamp(Math.floor(r.length * 0.62), 0, r.length - 2);
        const v = this._nodePos(r[idx], _v1);
        if (v) out[i].stack = v.clone();
      }
    }
    return out;
  }

  /** Grenade lines the map author tagged for this phase / area. */
  _nadeLinesFor(phase, site) {
    const tac = this._tactics();
    const all = tac && tac.nades;
    if (!Array.isArray(all) || !all.length) return null;
    const siteArea = site === 'B' ? AREA.B_SITE : AREA.A_SITE;
    const out = [];
    for (let i = 0; i < all.length; i++) {
      const L = all[i];
      if (!L || (L.team && L.team !== this.team)) continue;
      if (L.phase && L.phase !== phase) continue;
      if (L.area && L.area !== siteArea && !this._areaOnRoute(L.area)) continue;
      out.push(L);
    }
    return out.length ? out : null;
  }

  _areaOnRoute(area) {
    if (!area) return false;
    if (area === AREA.MID || area === AREA.CONNECT) return true;
    const siteArea = this.site === 'B' ? AREA.B_SITE : AREA.A_SITE;
    if (area === siteArea) return true;
    return area === AREA.LONG || area === AREA.SHORT || area === AREA.TUNNEL;
  }

  _execWait() {
    const tw = this._teamwork();
    const eco = this._economy();
    const name = ((this.strategy && (this.strategy.name || '')) + '').toLowerCase();
    const rush = name.indexOf('rush') >= 0 || name.indexOf('fast') >= 0;
    if (rush) return 0.8 + rand(0, 1.4);
    if (eco.poor) return 1.5 + rand(0, 2.5);
    return (3.5 + 7 * tw) * (0.75 + Math.random() * 0.5);
  }

  _planT(fresh) {
    const bots = this._collectBots();
    if (fresh || !this.strategy) {
      this.strategy = this._pickStrat();
      this.site = (this.strategy && this.strategy.site) || this.site;
      this.execAt = this.t0 + this._execWait();
    }
    if (!bots.length) return;
    const lanes = this._laneList();
    const counts = distribute(bots.length, lanes.map((l) => l.weight));
    const tw = this._teamwork();
    const nadeLines = this._nadeLinesFor(this.bombPlanted ? 'hold' : 'exec', this.site);

    // Personality decides who takes which lane, so the split is not arbitrary.
    const order = bots.slice().sort((x, y) => {
      const bx = brainOf(x), by = brainOf(y);
      return (bx ? bx.preferredLane : 0.5) - (by ? by.preferredLane : 0.5);
    });
    // Find the specialists once.
    let carrier = null, awper = null;
    for (let i = 0; i < order.length; i++) {
      const a = order[i];
      if (a.hasBomb) carrier = a;
      const pri = a.inv && a.inv.primary;
      const id = pri && (typeof pri === 'string' ? pri : pri.id);
      if (!awper && (id === 'awp' || id === 'ssg08')) awper = a;
    }
    if (!carrier && this.bombDropped) {                 // whoever is closest fetches it
      let bd = 1e9;
      for (let i = 0; i < order.length; i++) {
        const d = this.hasBombPos ? order[i].pos.distanceTo(this.bombPos) : i;
        if (d < bd) { bd = d; carrier = order[i]; }
      }
    }
    this.carrier = carrier;
    const mainLane = counts.indexOf(Math.max.apply(null, counts));
    let entry = null, lurker = null;
    let bestAgg = -1, bestPat = -1;
    for (let i = 0; i < order.length; i++) {
      const b = brainOf(order[i]);
      if (!b) continue;
      if (order[i] !== carrier && b.aggression > bestAgg) { bestAgg = b.aggression; entry = order[i]; }
      if (order[i] !== carrier && b.patience > bestPat) { bestPat = b.patience; lurker = order[i]; }
    }
    if (order.length < 4 || lurker === entry) lurker = null;

    let k = 0;
    for (let li = 0; li < lanes.length; li++) {
      const lane = lanes[li];
      for (let c = 0; c < counts[li] && k < order.length; c++, k++) {
        const actor = order[k];
        const asg = this._asg(actor);
        const isMain = li === mainLane;
        let role = ROLE.SUPPORT;
        if (actor === carrier) role = ROLE.CARRIER;
        else if (actor === awper) role = ROLE.AWP;
        else if (actor === entry && isMain) role = ROLE.ENTRY;
        else if (actor === lurker && !isMain) role = ROLE.LURK;
        else if (actor === lurker && lanes.length === 1) role = ROLE.LURK;
        asg.role = role;
        asg.site = this.site;
        asg.lane = lane.name;
        asg.route = lane.route;
        asg.stack = tw < 0.45 ? null : lane.stack;      // low teamwork: no stacking
        asg.holdSpot = null;
        asg.rotateTo = null;
        asg.postPlant = null;
        asg.nadeLines = nadeLines;
        asg.carrier = actor === carrier;
        asg.defuser = false;
        asg.goAt = this._goAtFor(role, this.execCalled ? this._now() : this.execAt, tw);
        this._bump(asg);
      }
    }
    // Anyone left over (rounding) joins the main lane.
    for (; k < order.length; k++) {
      const asg = this._asg(order[k]);
      const lane = lanes[mainLane] || lanes[0];
      asg.role = order[k] === carrier ? ROLE.CARRIER : ROLE.SUPPORT;
      asg.site = this.site;
      asg.lane = lane.name;
      asg.route = lane.route;
      asg.stack = tw < 0.45 ? null : lane.stack;
      asg.nadeLines = nadeLines;
      asg.carrier = order[k] === carrier;
      asg.goAt = this._goAtFor(asg.role, this.execCalled ? this._now() : this.execAt, tw);
      this._bump(asg);
    }
    if (this.bombPlanted) this._postPlant(order);
  }

  /** Entry goes first, support trails, the lurker leaves late. */
  _goAtFor(role, base, tw) {
    if (tw < 0.45) return this.t0;                       // everyone freelances
    let d = 0;
    if (role === ROLE.ENTRY) d = 0;
    else if (role === ROLE.SUPPORT) d = 0.5 + rand(0, 0.5);
    else if (role === ROLE.CARRIER) d = 0.9 + rand(0, 0.7);
    else if (role === ROLE.AWP) d = 0.2 + rand(0, 0.4);
    else if (role === ROLE.LURK) d = 4 + rand(0, 5);
    return base + d;
  }

  /** Spread the team over the post-plant crossfire spots. */
  _postPlant(order) {
    const sites = this.game.map && this.game.map.sites;
    const site = sites && (sites[this.bombSite || this.site] || sites.A);
    const spots = (site && site.postPlant) || null;
    const lines = this._nadeLinesFor('hold', this.bombSite || this.site);
    for (let i = 0; i < order.length; i++) {
      const asg = this._asg(order[i]);
      asg.route = null;
      asg.stack = null;
      asg.goAt = -1;
      asg.rotateTo = null;
      asg.nadeLines = lines;
      asg.postPlant = Array.isArray(spots) && spots.length ? spots[i % spots.length] : null;
      asg.role = i === 0 ? ROLE.ANCHOR_A : (i === order.length - 1 ? ROLE.LURK : ROLE.SUPPORT);
      this._bump(asg);
    }
    this.phase = 'postplant';
  }

  _tickT(now, bots) {
    if (!bots.length) return;
    if (this.bombPlanted) {
      if (this.phase !== 'postplant') { this._postPlant(bots); }
      return;
    }
    if (!this.execCalled) {
      let ready = 0, staged = 0;
      for (let i = 0; i < bots.length; i++) {
        const asg = this.assignments.get(bots[i]);
        if (!asg || !asg.stack) { ready++; continue; }
        staged++;
        if (bots[i].pos.distanceTo(asg.stack) < 7) ready++;
      }
      const quorum = Math.max(1, Math.ceil(bots.length * 0.7));
      if (ready >= quorum || now >= this.execAt || this._teamwork() < 0.45) {
        this._callExec(now, bots);
      } else if (staged) {
        this._maybeSwitchSite(now, bots);
      }
      return;
    }
    // Executed and still nothing planted: keep the site choice under review.
    if (now - this.t0 > 22 && !this.switchCalled) this._maybeSwitchSite(now, bots);
    if (this.bombDropped && !this.carrier) this._dirty = true;
  }

  _callExec(now, bots) {
    this.execCalled = true;
    this.phase = 'exec';
    const tw = this._teamwork();
    for (let i = 0; i < bots.length; i++) {
      const asg = this._asg(bots[i]);
      asg.goAt = this._goAtFor(asg.role, now, tw);
      this._bump(asg);
    }
    const caller = bots[0];
    this._radio(caller, this.site === 'B' ? 'goingb' : 'goinga', 0.9);
  }

  /** Too many CTs home? Call the switch and re-lane the team. */
  _maybeSwitchSite(now, bots) {
    if (this.switchCalled || this._teamwork() < 0.5) return;
    const siteArea = this.site === 'B' ? AREA.B_SITE : AREA.A_SITE;
    const here = num(this.areaKnown[siteArea], 0);
    const total = this.enemiesKnown;
    if (here < 2 && !(here >= 1 && total >= 3 && this._teamwork() > 0.8)) return;
    const other = this._otherSite(this.site);
    if (other === this.site) return;
    this.switchCalled = true;
    this.site = other;
    // Keep the same style of play but aim it at the other bomb site.
    const tac = this._tactics();
    const strats = tac && tac.T && tac.T.strats;
    if (Array.isArray(strats)) {
      const alt = strats.filter((s) => s && s.site === other);
      if (alt.length) this.strategy = pick(alt);
    }
    this.execCalled = false;
    this.execAt = now + 1.5 + rand(0, 1.5);
    this._planT(false);
    this._radio(bots[0], other === 'B' ? 'goingb' : 'goinga', 1);
  }

  // =========================================================================
  // CT side planning
  // =========================================================================
  /** tactics.CT.holds is keyed by site / area — try the sensible spellings. */
  _holdsFor(group) {
    const tac = this._tactics();
    const holds = tac && tac.CT && tac.CT.holds;
    if (!holds) return null;
    const keys = group === 'A' ? ['A', 'A_SITE', AREA.A_SITE, 'a']
      : group === 'B' ? ['B', 'B_SITE', AREA.B_SITE, 'b']
        : ['MID', 'mid', AREA.MID, 'M'];
    for (let i = 0; i < keys.length; i++) {
      const v = holds[keys[i]];
      if (Array.isArray(v) && v.length) return v;
    }
    return null;
  }

  /** Fallback angles from the nav mesh when the map ships no hold list. */
  _navHolds(group) {
    const nav = this.game.nav;
    if (!nav) return null;
    const area = group === 'A' ? AREA.A_SITE : group === 'B' ? AREA.B_SITE : AREA.MID;
    let list = null;
    if (typeof nav.nodesInArea === 'function') list = nav.nodesInArea(area);
    if ((!list || !list.length) && typeof nav.nodesWithTag === 'function') list = nav.nodesWithTag('hold');
    if (!list || !list.length) return null;
    const out = [];
    for (let i = 0; i < list.length && out.length < 6; i++) {
      const n = list[i];
      if (!n || !n.pos) continue;
      const tagged = n.tags && (n.tags.indexOf('hold') >= 0 || n.tags.indexOf('cover') >= 0
        || n.tags.indexOf('sniper') >= 0);
      if (!tagged && out.length >= 3) continue;
      out.push({ pos: [n.pos.x, n.pos.y, n.pos.z], look: null, area, prio: tagged ? 2 : 1 });
    }
    return out.length ? out : null;
  }

  _planCT(fresh) {
    const bots = this._collectBots();
    if (!bots.length) return;
    const n = bots.length;
    // 2 / 1 / 2 by default, collapsing sensibly for small teams.
    const weights = n <= 2 ? [1, 0, 1] : n === 3 ? [1, 1, 1] : [2, 1, 2];
    const groups = ['A', 'MID', 'B'];
    const counts = distribute(n, weights);
    const order = bots.slice().sort((x, y) => {
      const bx = brainOf(x), by = brainOf(y);
      return (bx ? bx.preferredLane : 0.5) - (by ? by.preferredLane : 0.5);
    });
    // The kit holder defuses; otherwise the healthiest body does.
    let defuser = null, bestHp = -1;
    for (let i = 0; i < order.length; i++) {
      const a = order[i];
      if (a.kit) { defuser = a; break; }
      if (num(a.health, 100) > bestHp) { bestHp = num(a.health, 100); defuser = a; }
    }
    this.defuser = defuser;
    const lines = this._nadeLinesFor(this.bombPlanted ? 'retake' : 'hold', this.bombSite || this.site);
    let k = 0, rotator = null;
    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi];
      const holds = this._holdsFor(group) || this._navHolds(group);
      const sorted = holds ? holds.slice().sort((x, y) => num(y.prio, 1) - num(x.prio, 1)) : null;
      for (let c = 0; c < counts[gi] && k < order.length; c++, k++) {
        const actor = order[k];
        const asg = this._asg(actor);
        asg.group = group;
        asg.site = group === 'MID' ? (this.bombSite || 'A') : group;
        asg.route = null;
        asg.stack = null;
        asg.goAt = -1;
        asg.postPlant = null;
        asg.nadeLines = lines;
        asg.carrier = false;
        asg.holdSpot = sorted ? sorted[c % sorted.length] : null;
        asg.role = group === 'A' ? ROLE.ANCHOR_A : group === 'B' ? ROLE.ANCHOR_B : ROLE.MID;
        if (group === 'MID' && !rotator) { rotator = actor; asg.role = ROLE.ROTATOR; }
        asg.defuser = actor === defuser;
        if (!this.bombPlanted) asg.rotateTo = null;
        this._bump(asg);
      }
    }
    for (; k < order.length; k++) {                     // rounding leftovers
      const asg = this._asg(order[k]);
      asg.group = 'A';
      asg.site = 'A';
      asg.role = ROLE.ROTATOR;
      asg.nadeLines = lines;
      asg.defuser = order[k] === defuser;
      const holds = this._holdsFor('A') || this._navHolds('A');
      asg.holdSpot = holds ? holds[k % holds.length] : null;
      this._bump(asg);
    }
    if (!rotator) {
      // No mid player: the most aggressive anchor becomes the rotator.
      let best = null, bestAgg = -1;
      for (let i = 0; i < order.length; i++) {
        const b = brainOf(order[i]);
        if (b && b.aggression > bestAgg) { bestAgg = b.aggression; best = order[i]; }
      }
      if (best) { const asg = this._asg(best); asg.role = ROLE.ROTATOR; this._bump(asg); }
      rotator = best;
    }
    this.rotator = rotator;
    if (this.bombPlanted) this._planRetake(this._now(), order);
  }

  /** Scripted rotation path, e.g. tactics.CT.rotate['A_to_B']. */
  _rotateRoute(from, to) {
    const tac = this._tactics();
    const rot = tac && tac.CT && tac.CT.rotate;
    if (!rot || !to) return null;
    const f = String(from || '').toUpperCase(), t = String(to).toUpperCase();
    const keys = [`${f}_to_${t}`, `${f}_TO_${t}`, `${f.toLowerCase()}_to_${t.toLowerCase()}`,
      `${f}${t}`, `to_${t}`, `to${t}`, t, t.toLowerCase()];
    for (let i = 0; i < keys.length; i++) {
      const v = rot[keys[i]];
      if (Array.isArray(v) && v.length) return v;
    }
    return null;
  }

  /** Where a rotating CT should end up inside `group`. */
  _rotateTarget(group, out) {
    const holds = this._holdsFor(group) || this._navHolds(group);
    if (holds && holds.length) {
      const h = holds[0];
      const v = toVec(out, h.pos || h);
      if (v) return v;
    }
    return this._sitePoint(group === 'B' ? 'B' : 'A', out);
  }

  /** Contact in a site → send the rotator (and a spare) over. */
  _maybeRotate(now, contact) {
    if (this.bombPlanted) return;                        // the retake owns movement
    if (now - num(this._rotT, -99) < 3) return;
    const area = contact && contact.area;
    if (!area) return;
    const group = area === AREA.B_SITE ? 'B' : area === AREA.A_SITE ? 'A' : null;
    if (!group) return;
    const known = num(this.areaKnown[area], 0);
    if (known < 2 && !(known >= 1 && this.enemiesKnown >= 3)) return;
    const bots = this._collectBots();
    const dest = this._rotateTarget(group, _v2);
    if (!dest) return;
    let sent = 0;
    const want = known >= 3 ? 2 : 1;
    for (let i = 0; i < bots.length && sent < want; i++) {
      const actor = bots[i];
      const asg = this.assignments.get(actor);
      if (!asg) continue;
      if (asg.group === group) continue;                 // already home
      const isRot = asg.role === ROLE.ROTATOR;
      if (!isRot && sent === 0 && want === 1) continue;   // rotator goes first
      if (asg.rotateTo && asg.rotateTo.distanceTo && asg.rotateTo.distanceTo(dest) < 3) { sent++; continue; }
      asg.rotateTo = dest.clone();
      asg.route = this._rotateRoute(asg.group, group);
      asg.group = group;
      asg.site = group;
      const holds = this._holdsFor(group) || this._navHolds(group);
      if (holds && holds.length) asg.holdSpot = holds[(sent + 1) % holds.length];
      this._bump(asg);
      sent++;
    }
    if (sent) {
      this._rotT = now;
      this._radio(bots[0], group === 'B' ? 'rotate_b' : 'rotate_a', 0.85);
    }
  }

  /** Group up short of the site, use utility, then go in together. */
  _planRetake(now, bots) {
    this.phase = 'retake';
    const site = this.bombSite || this.site;
    if (!this.hasRetakeStage) {
      const bp = this.hasBombPos ? _v1.copy(this.bombPos) : this._sitePoint(site, _v1);
      if (bp) {
        const nav = this.game.nav;
        let stage = null;
        if (nav && typeof nav.nearest === 'function') {
          // A cover node roughly 12 m short of the bomb, on our approach.
          const spawn = this._ctSpawn(_v2);
          if (spawn) {
            _v3.copy(bp).sub(spawn);
            const l = _v3.length() || 1;
            _v3.multiplyScalar(Math.max(0, l - 12) / l).add(spawn);
            const n = nav.nearest(_v3);
            if (n && vecOk(n.pos)) stage = n.pos;
          }
          if (!stage) {
            const n = nav.nearest(bp, (nd) => nd && nd.tags && nd.tags.indexOf('cover') >= 0);
            if (n && vecOk(n.pos)) stage = n.pos;
          }
        }
        this.retakeStage.copy(stage || bp);
        this.hasRetakeStage = true;
        this.retakeAt = now + 5.5 * this._teamwork();
      }
    }
    const lines = this._nadeLinesFor('retake', site);
    const dest = this.retakeGo
      ? (this.hasBombPos ? this.bombPos : this._sitePoint(site, _v1))
      : this.retakeStage;
    if (!dest) return;
    for (let i = 0; i < bots.length; i++) {
      const asg = this._asg(bots[i]);
      asg.nadeLines = lines;
      asg.route = asg.route || this._rotateRoute(asg.group, site);
      asg.site = site;
      if (!asg.rotateTo) asg.rotateTo = dest.clone();
      else asg.rotateTo.copy(dest);
      asg.defuser = bots[i] === this.defuser;
      this._bump(asg);
    }
  }

  _ctSpawn(out) {
    const sp = this.game.map && this.game.map.spawns;
    const list = sp && (this.isT ? sp.T : sp.CT);
    if (Array.isArray(list) && list.length) {
      const v = toVec(out, list[0] && (list[0].pos || list[0]));
      if (v) return v;
    }
    return null;
  }
  _tickCT(now, bots) {
    if (!bots.length) return;
    if (this.bombPlanted) {
      if (!this.hasRetakeStage || this.phase !== 'retake') this._planRetake(now, bots);
      // Keep a live defuser at all times.
      if (!this.defuser || !this.defuser.alive) {
        let best = null, bestScore = -1e9;
        const bp = this.hasBombPos ? this.bombPos : null;
        for (let i = 0; i < bots.length; i++) {
          const a = bots[i];
          let s = num(a.health, 100) * 0.2 + (a.kit ? 60 : 0);
          if (bp) s -= a.pos.distanceTo(bp) * 1.4;
          if (s > bestScore) { bestScore = s; best = a; }
        }
        this.defuser = best;
        for (let i = 0; i < bots.length; i++) {
          const asg = this._asg(bots[i]);
          const d = bots[i] === best;
          if (asg.defuser !== d) { asg.defuser = d; this._bump(asg); }
        }
      }
      if (!this.retakeGo) {
        let ready = 0;
        for (let i = 0; i < bots.length; i++) {
          if (bots[i].pos.distanceTo(this.retakeStage) < 8) ready++;
        }
        const quorum = Math.max(1, Math.ceil(bots.length * 0.7));
        const late = now >= num(this.retakeAt, now);
        const timer = this._bombTimer();
        const need = ROUND.defuseTime + 6;
        if (ready >= quorum || late || timer < need || this._teamwork() < 0.45) {
          this.retakeGo = true;
          this._planRetake(now, bots);
          this._radio(bots[0], 'regroup', 0.5);
        }
      }
      return;
    }
    // Pre-plant: keep the site coverage honest as players die.
    this.phase = 'defend';
    let aN = 0, bN = 0;
    for (let i = 0; i < bots.length; i++) {
      const asg = this.assignments.get(bots[i]);
      if (!asg) continue;
      if (asg.group === 'A') aN++; else if (asg.group === 'B') bN++;
    }
    if ((aN === 0 || bN === 0) && bots.length > 1 && now - num(this._rotT, -99) > 4) {
      this._rotT = now;
      const group = aN === 0 ? 'A' : 'B';
      const dest = this._rotateTarget(group, _v2);
      for (let i = 0; i < bots.length; i++) {
        const asg = this.assignments.get(bots[i]);
        if (!asg || asg.role !== ROLE.ROTATOR) continue;
        asg.rotateTo = dest ? dest.clone() : null;
        asg.route = this._rotateRoute(asg.group, group);
        asg.group = group;
        asg.site = group;
        const holds = this._holdsFor(group) || this._navHolds(group);
        if (holds && holds.length) asg.holdSpot = holds[0];
        this._bump(asg);
        break;
      }
    }
  }

  _bombTimer() {
    const b = this.game.bomb;
    if (!b) return ROUND.bombTime;
    const t = b.timer != null ? b.timer : (b.time != null ? b.time : b.fuse);
    return num(t, ROUND.bombTime);
  }
}

export default TeamCoordinator;
