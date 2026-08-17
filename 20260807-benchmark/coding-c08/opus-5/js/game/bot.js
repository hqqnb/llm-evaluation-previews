// ============================================================================
// bot.js — the bot brain.  One Bot drives one Actor and touches the world only
// through `actor.cmd`, `actor.yaw` and `actor.pitch`.  Pure logic, no DOM.
//
// Frame budget: perception 10 Hz · target LOS 20 Hz · think 7 Hz · path 4 Hz
// utility 3 Hz — all staggered per bot.  Aim / fire / steering run every frame.
// ============================================================================

import * as THREE from 'three';
import {
  DIFFICULTY, ROLE, BOT_STATE, AREA, SOUND_RANGE, PHASE, TEAM, OTHER_TEAM,
  PLAYER, PHYS, SLOT, ROUND,
} from '../core/constants.js';
import { RADIO } from '../core/api.js';
import {
  angleWrap, angleDiff, gauss, chance, clamp, clamp01, damp, rand, randInt, DEG,
} from '../core/util.js';

// --- module scratch (single threaded, never retained across a call) ---------
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3();
const _v7 = new THREE.Vector3(), _v8 = new THREE.Vector3();
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const vecOk = (v) => !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

// --- weapon taxonomy (ids come from api.js WEAPON_IDS, so no def guessing) --
const W_PISTOL = new Set(['glock', 'usp', 'p250', 'deagle', 'tec9', 'fiveseven', 'dualies']);
const W_SMG = new Set(['mac10', 'mp9', 'mp5', 'ump45', 'p90']);
const W_RIFLE = new Set(['galil', 'famas', 'ak47', 'm4a4', 'm4a1s', 'aug', 'sg553']);
const W_SNIPER = new Set(['ssg08', 'awp']);
const W_HEAVY = new Set(['nova', 'xm1014', 'mag7', 'negev']);
const W_SCOPED = new Set(['ssg08', 'awp', 'aug', 'sg553']);
const W_TAP = new Set(['deagle', 'ssg08', 'awp', 'usp', 'p250', 'fiveseven', 'glock']);
const NADE_IDS = ['he', 'flash', 'smoke', 'molotov', 'incendiary', 'decoy'];
const MAG_FALLBACK = {
  glock: 20, usp: 12, p250: 13, deagle: 7, tec9: 18, fiveseven: 20, dualies: 30,
  mac10: 30, mp9: 30, mp5: 30, ump45: 25, p90: 50,
  galil: 35, famas: 25, ak47: 30, m4a4: 30, m4a1s: 20, aug: 30, sg553: 30,
  ssg08: 10, awp: 10, nova: 8, xm1014: 7, mag7: 5, negev: 150,
};
// Blast radii used for friendly-fire safety (grenades.js SPECS mirror).
const NADE_BLAST = { he: 5.5, flash: 8, smoke: 4.6, molotov: 3.2, incendiary: 3.2, decoy: 2.6 };
const NADE_SPEED = { he: 21, flash: 21, smoke: 21, molotov: 20, incendiary: 20, decoy: 20 };

const itemId = (x) => (typeof x === 'string' ? x : (x && x.id) || null);
const EMPTY_OPT = Object.freeze({});
const WALK_OPT = Object.freeze({ walk: true });
const RUN_OPT = Object.freeze({ sprint: true });
const PUSH_OPT = Object.freeze({ sprint: true, jiggle: 0.35 });
const CREEP_OPT = Object.freeze({ walk: true, noWalkCheck: true });
const FIGHT_OPT = Object.freeze({ ignoreStop: false, noWalkCheck: true });
/** Copy an array `[x,y,z]` or a vector-like into `out`.  Returns null on junk. */
function toVec(out, v) {
  if (Array.isArray(v)) {
    if (!Number.isFinite(v[0])) return null;
    return out.set(v[0], num(v[1], 0), num(v[2], 0));
  }
  if (vecOk(v)) return out.set(v.x, v.y, v.z);
  return null;
}

/** FNV-1a — personality seed from the bot name (stable across rounds). */
function hash32(str) {
  let h = 0x811c9dc5;
  const s = String(str == null ? 'bot' : str);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
/** Deterministic 0..1 stream from a hash + salt. */
function h01(h, salt) {
  let t = (h ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// --- economy hook ----------------------------------------------------------
// economy.js is owned by another module; it may land after this file is loaded,
// so it is pulled in lazily and a self-contained plan covers the gap.
let _buyPlan = null;
let _buyPlanAsked = false;
function ensureBuyPlan() {
  if (_buyPlanAsked) return;
  _buyPlanAsked = true;
  import('./economy.js').then((m) => {
    if (m && typeof m.botBuyPlan === 'function') _buyPlan = m.botBuyPlan;
  }).catch(() => { /* not present yet — fallbackBuyPlan() is used instead */ });
}
ensureBuyPlan();

/** Ordered buy list used until economy.js#botBuyPlan is importable. */
function fallbackBuyPlan(actor, game) {
  const out = [];
  const money = num(actor.money, 0);
  const isT = actor.team === TEAM.T;
  const hasPrimary = !!itemId(actor.inv && actor.inv.primary);
  const loss = num(game && game.match && game.match.lossStreak, 0);
  const poor = money < 2500 && !hasPrimary;
  if (poor && money < 1400) {                       // eco: armour or a pistol
    if (money >= 650) out.push('kevlar');
    else if (money >= 300) out.push(isT ? 'tec9' : 'p250');
    return out;
  }
  if (!hasPrimary) {
    if (money >= 5600 && chance(0.22)) out.push('awp');
    else if (money >= 4700) out.push(isT ? 'ak47' : 'm4a4');
    else if (money >= 3000) out.push(isT ? 'galil' : 'famas');
    else if (money >= 2400) out.push('mp5');
    else out.push(isT ? 'tec9' : 'p250');
  }
  if (!actor.helmet) out.push(money >= 3600 || loss >= 2 ? 'kevlarhelmet' : 'kevlar');
  else if (!actor.armor) out.push('kevlar');
  if (money >= 4500) out.push('flash');
  if (money >= 5200) out.push('smoke');
  if (money >= 6000) out.push(isT ? 'molotov' : 'incendiary');
  if (money >= 6800) out.push('he');
  if (!isT && money >= 5400 && !actor.kit) out.push('defusekit');
  return out;
}

/** Normalised view of what the bot is holding — no reliance on `def` fields. */
function weaponInfo(actor, out) {
  const a = actor.active;
  const id = itemId(a) || itemId(actor.inv && actor.inv.primary) || 'knife';
  const def = (a && a.def) || null;
  const mag = num(def && (def.mag != null ? def.mag : def.magSize != null ? def.magSize : def.clip),
    MAG_FALLBACK[id] || 30);
  const isNade = NADE_IDS.indexOf(id) >= 0;
  const sniper = W_SNIPER.has(id);
  const o = out || {};
  o.id = id;
  o.ammo = num(a && a.ammo, isNade || id === 'knife' ? 1 : 0);
  o.reserve = num(a && a.reserve, 0);
  o.mag = Math.max(1, mag);
  o.isKnife = id === 'knife';
  o.isNade = isNade;
  o.isBomb = id === 'c4';
  o.isPistol = W_PISTOL.has(id);
  o.isSmg = W_SMG.has(id);
  o.isRifle = W_RIFLE.has(id);
  o.isSniper = sniper;
  o.isAwp = id === 'awp';
  o.isHeavy = W_HEAVY.has(id);
  o.scoped = W_SCOPED.has(id);
  o.tapper = W_TAP.has(id);
  // Comfortable engagement distance; beyond it the bot taps instead of sprays.
  o.good = sniper ? 60 : W_RIFLE.has(id) ? 34 : W_SMG.has(id) ? 18
    : W_HEAVY.has(id) ? (id === 'negev' ? 26 : 9) : W_PISTOL.has(id) ? 15 : 2.2;
  return o;
}

/** One remembered enemy.  Allocated once per (bot, enemy) pair, never per frame. */
class EnemyMemo {
  constructor(actor) {
    this.actor = actor;
    this.lastKnownPos = new THREE.Vector3();
    this.lastVel = new THREE.Vector3();
    this.lastSeenTime = -999;   // game.time of the last confirmed sighting
    this.firstSeenTime = -999;
    this.heardTime = -999;
    this.visible = false;
    this.spot = 0;              // 0..1 progress of the distance-scaled spot timer
    this.dist = 999;
    this.area = null;
    this.fresh = false;         // seen or shared inside the memory window
    this.viaIntel = false;
  }
}

export class Bot {
  /**
   * @param {Object} actor  the Actor this brain drives
   * @param {Object} game   the game facade (world/nav/map/actors/…)
   * @param {string} difficultyKey  key into DIFFICULTY
   */
  constructor(actor, game, difficultyKey = 'normal') {
    this.actor = actor;
    this.game = game;
    this.difficultyKey = DIFFICULTY[difficultyKey] ? difficultyKey : 'normal';
    this.diff = DIFFICULTY[this.difficultyKey];
    actor.bot = this;

    // --- personality (stable per name, so five bots never act alike) -------
    const h = hash32(actor.name || actor.id || 'bot');
    this.seed = h;
    this.aggression = 0.25 + h01(h, 1) * 0.7;     // pushes angles, entries early
    this.patience = 0.2 + h01(h, 2) * 0.8;        // holds still, waits to exec
    this.nadeLove = 0.35 + h01(h, 3) * 1.1;       // scales DIFFICULTY.nadeChance
    this.chattiness = 0.15 + h01(h, 4) * 0.85;
    this.preferredLane = h01(h, 5);               // 0..1, coordinator tie-break
    this.offAngleLove = h01(h, 6);
    // --- state machine -----------------------------------------------------
    this._state = BOT_STATE.IDLE;
    this._stateT = 0;
    this._sub = '';                 // debug detail for the overlay
    this.assignment = null;
    this.role = ROLE.SUPPORT;

    // --- perception --------------------------------------------------------
    this.mem = new Map();           // Actor -> EnemyMemo
    this.target = null;             // current EnemyMemo being engaged
    this.reactionT = 0;             // latency left before the first shot
    this.noisePos = new THREE.Vector3();
    this.noiseT = -999;
    this.noiseKind = '';
    this._lastSoundT = 0;
    this.enemiesVisible = 0;
    this.lastContactT = -999;
    this.threatDir = new THREE.Vector3(1, 0, 0);

    // --- aim ---------------------------------------------------------------
    this.aimYawVel = 0;
    this.aimPitchVel = 0;
    this.aimOffYaw = 0;
    this.aimOffPitch = 0;
    this._aimOffT = 0;
    this.aimPoint = new THREE.Vector3();
    this.lookPoint = new THREE.Vector3();   // where the bot wants to look when idle
    this.hasLookPoint = false;
    this.headshotRoll = false;
    this.recoilShots = 0;
    this.shotsFired = 0;
    this._lastShotT = -9;
    this._flickT = 0;
    this._aimErr = 9;
    this._hurtBy = null;
    this._lastAmmo = -1;
    this.aimErrDeg = this.diff.aimError;

    // --- fire discipline ---------------------------------------------------
    this.burstLeft = 0;
    this.burstPause = 0;
    this._nextPause = 0.2;
    this._wi = weaponInfo(actor, {});
    this.holdFireT = 0;
    this.scopeT = 0;
    this.repositionT = 0;
    this.stillT = 0;
    this.stopMoveT = 0;
    this._adsT = 0;
    this._knifeRush = false;
    this._reloadCover = false;

    // --- movement ----------------------------------------------------------
    this.path = null;
    this.pathIdx = 0;
    this.goal = new THREE.Vector3();
    this.hasGoal = false;
    this.goalTag = '';
    this._lastPos = new THREE.Vector3().copy(actor.pos || _v1.set(0, 0, 0));
    this._progressT = 0;
    this._stuckT = 0;
    this._sideStep = 0;
    this._sideStepT = 0;
    this._jumpT = 0;
    this._peekT = 0;
    this._peekDir = 1;
    this._moveDir = new THREE.Vector3();
    this._steer = new THREE.Vector3();
    this._routeIdx = 0;
    this._routePts = null;
    this._wantFire = false;
    this._wantMove = false;
    this._holdVec = new THREE.Vector3();
    this._holdLook = new THREE.Vector3();
    this.hasHold = false;

    // --- utility -----------------------------------------------------------
    this.nade = null;               // {type, to, from, stage, …} — see _startNade
    this._nade = {
      type: '', to: new THREE.Vector3(), from: new THREE.Vector3(), hasFrom: false,
      line: null, stage: '', t: 0, aimReady: false, yaw: 0, pitch: 0, count0: 0,
      errYaw: 0, errPitch: 0,
    };
    this._usedLines = [];
    this._clusterN = 0;
    this._fireNadeId = null;
    this.nadeCooldown = 0;
    this.nadesThrown = 0;

    // --- objective ---------------------------------------------------------
    this.bombPos = new THREE.Vector3();
    this.hasBombPos = false;
    this.bombSite = null;
    this.plantSpot = new THREE.Vector3();
    this.hasPlantSpot = false;
    this.defusing = false;
    this.fakeDefuseT = 0;
    this._planting = false;
    this._plantCall = false;
    this._defuseCall = false;
    this._ppVec = new THREE.Vector3();
    this._ppLook = new THREE.Vector3();
    this._hasPP = false;
    this._retreatVec = new THREE.Vector3();
    this._retreatSet = false;
    this._blindPlanned = false;
    this._asgRev = -1;
    this._needPath = false;
    this._arrived = false;

    // --- misc --------------------------------------------------------------
    this.buySent = false;
    this._buyClearT = 0;
    this._radioT = 0;
    this.flashT = 0;
    this.panicSpray = false;
    this.hurtT = -999;
    this.retreatT = 0;
    this.roundT = 0;
    this.kills = 0;

    // --- staggered throttles (offset by the personality hash) ---------------
    const s = h01(h, 7);
    this._tPerceive = s * 0.1;      // 10 Hz
    this._tLos = s * 0.05;          // 20 Hz — current target only
    this._tThink = s * 0.14;        // ~7 Hz
    this._tPath = s * 0.25;         // 4 Hz path upkeep
    this._tUtil = s * 0.33;         // 3 Hz utility scan
    this._resetCmd();
  }

  // =========================================================================
  // small accessors
  // =========================================================================
  get state() { return this._state; }
  get debug() {
    const a = this.actor;
    const t = this.target;
    const tn = t ? (t.actor.name || t.actor.id || 'enemy') : '-';
    const d = t ? t.dist.toFixed(1) : '-';
    const g = this.hasGoal ? `${this.goal.x.toFixed(0)},${this.goal.z.toFixed(0)}` : '-';
    return `${a.name || a.id || 'bot'}[${this.difficultyKey[0]}] ${this._state}`
      + `${this._sub ? ':' + this._sub : ''} r=${this.role} tgt=${tn}@${d}`
      + ` hp=${Math.round(num(a.health, 0))} goal=${g}`
      + ` wp=${this.path ? this.pathIdx + '/' + this.path.length : '-'}`
      + (this.nade ? ` nade=${this.nade.type}/${this.nade.stage}` : '')
      + (this.reactionT > 0 ? ` react=${this.reactionT.toFixed(2)}` : '');
  }
  get coordinator() {
    const c = this.game.coordinator;
    return (c && c[this.actor.team]) || null;
  }
  get enemyTeam() { return OTHER_TEAM[this.actor.team] || TEAM.CT; }

  _setState(s) {
    if (this._state === s) return;
    this._state = s;
    this._stateT = 0;
    this._sub = '';
  }

  _resetCmd() {
    let c = this.actor.cmd;
    if (!c) {
      c = this.actor.cmd = {
        forward: 0, right: 0, jump: false, crouch: false, walk: false, sprint: false,
        attack: false, attack2: false, reload: false, use: false, drop: false,
        switchTo: null, buy: null,
      };
      return c;
    }
    c.forward = 0; c.right = 0;
    c.jump = false; c.crouch = false; c.walk = false; c.sprint = false;
    c.attack = false; c.attack2 = false; c.reload = false; c.use = false; c.drop = false;
    c.switchTo = null;
    return c;
  }

  // =========================================================================
  // round lifecycle
  // =========================================================================
  /** @param {Object} assignment  {role, site, route, holdSpot, nadeLines, …} */
  onRoundStart(assignment) {
    this.mem.clear();
    this.target = null;
    this.path = null;
    this.pathIdx = 0;
    this.hasGoal = false;
    this.goalTag = '';
    this._routeIdx = 0;
    this.reactionT = 0;
    this.burstLeft = 0;
    this.burstPause = 0;
    this.holdFireT = 0;
    this.repositionT = 0;
    this.scopeT = 0;
    this.recoilShots = 0;
    this._lastAmmo = -1;
    this.nade = null;
    this.nadeCooldown = 1.5 + rand(0, 2.5);
    this.nadesThrown = 0;
    this._usedLines.length = 0;
    this.buySent = false;
    this.flashT = 0;
    this.panicSpray = false;
    this.hurtT = -999;
    this.retreatT = 0;
    this.noiseT = -999;
    this.lastContactT = -999;
    this.defusing = false;
    this.fakeDefuseT = 0;
    this._planting = false;
    this._plantCall = false;
    this._defuseCall = false;
    this._hasPP = false;
    this._retreatSet = false;
    this._blindPlanned = false;
    this._asgRev = -1;
    this._knifeRush = false;
    this._reloadCover = false;
    this.hasBombPos = false;
    this.bombSite = null;
    this.hasPlantSpot = false;
    this.roundT = 0;
    this._stuckT = 0;
    this._progressT = 0;
    this.enemiesVisible = 0;
    this._lastSoundT = num(this.game.time, 0);
    if (this.actor.pos) this._lastPos.copy(this.actor.pos);
    this.applyAssignment(assignment);
    this._setState(BOT_STATE.BUY);
  }

  /** Adopt (or re-adopt, mid round) a coordinator assignment. */
  applyAssignment(a) {
    if (!a) return;
    this.assignment = a;
    if (a.role) this.role = a.role;
    this.hasHold = false;
    if (a.holdSpot) {
      const p = toVec(this._holdVec, a.holdSpot.pos || a.holdSpot);
      if (p) {
        this.hasHold = true;
        const lk = toVec(this._holdLook, a.holdSpot.look);
        if (!lk) this._holdLook.set(0, 0, 0);
        // Off-angle personality: nudge the hold spot a little off the book spot.
        if (this.offAngleLove > 0.62 && chance(0.35 * this.diff.peek)) {
          const n = this._navNear(this._holdVec, 5, 'cover');
          if (n && n.pos) this._holdVec.copy(n.pos);
        }
      }
    }
    if (a.route) this._routeIdx = 0;
    this._resolveRoute(a.route);
    this.hasGoal = false;         // force the next think() to lay a fresh path
    this.path = null;
  }

  /** Nearest nav node to `v` within `r`, optionally carrying `tag`. */
  _navNear(v, r = 6, tag = null) {
    const nav = this.game.nav;
    if (!nav || typeof nav.nearest !== 'function') return null;
    const n = nav.nearest(v, tag
      ? (nd) => nd && nd.tags && nd.tags.indexOf(tag) >= 0 && nd.pos.distanceTo(v) <= r
      : null);
    if (!n || !n.pos) return null;
    if (n.pos.distanceTo(v) > r) return null;
    return n;
  }

  _say(key, p = 1) {
    if (!RADIO[key]) return;
    const g = this.game;
    if (typeof g.radio !== 'function') return;
    const t = num(g.time, 0);
    if (t < this._radioT) return;
    if (!chance(clamp01(p * (0.35 + this.chattiness * 0.9)))) return;
    this._radioT = t + 3.5 + rand(0, 5) * (1.2 - this.chattiness);
    g.radio(this.actor, key);
  }

  // =========================================================================
  // main tick
  // =========================================================================
  update(dt) {
    const a = this.actor, g = this.game;
    if (!Number.isFinite(dt) || dt <= 0) return;
    if (dt > 0.1) dt = 0.1;                       // never let a hitch snap the aim
    if (!a.alive) {
      if (this._state !== BOT_STATE.DEAD) { this._setState(BOT_STATE.DEAD); this.target = null; }
      this._resetCmd();
      return;
    }
    if (this._state === BOT_STATE.DEAD) this._setState(BOT_STATE.IDLE);
    const c = this._resetCmd();
    const now = num(g.time, 0);
    this._stateT += dt;
    this.roundT += dt;
    if (c.buy && now > this._buyClearT) c.buy = null;
    this.nadeCooldown = Math.max(0, this.nadeCooldown - dt);
    this.reactionT = Math.max(0, this.reactionT - dt);
    this.holdFireT = Math.max(0, this.holdFireT - dt);
    this.burstPause = Math.max(0, this.burstPause - dt);
    this.scopeT = this.actor.ads ? this.scopeT + dt : 0;
    this.repositionT = Math.max(0, this.repositionT - dt);
    this.stopMoveT = Math.max(0, this.stopMoveT - dt);
    this.retreatT = Math.max(0, this.retreatT - dt);
    this._sideStepT = Math.max(0, this._sideStepT - dt);
    this._jumpT = Math.max(0, this._jumpT - dt);
    this.fakeDefuseT = Math.max(0, this.fakeDefuseT - dt);
    this.flashT = Math.max(0, this.flashT - dt);
    const speed2 = a.vel ? a.vel.x * a.vel.x + a.vel.z * a.vel.z : 0;
    this.stillT = speed2 < 0.35 ? this.stillT + dt : 0;
    this._trackShots(dt);
    weaponInfo(a, this._wi);

    const phase = (g.match && g.match.phase) || PHASE.LIVE;
    if (phase === PHASE.FREEZE) { this._freeze(dt, c, now); return; }
    if (phase === PHASE.ROUND_END || phase === PHASE.HALFTIME
        || phase === PHASE.MATCH_END || phase === PHASE.MENU) {
      this._sub = 'endround';
      this._applyAim(dt);
      return;
    }

    // --- perception (10 Hz) + current-target LOS refresh (20 Hz) -----------
    this._tPerceive -= dt;
    if (this._tPerceive <= 0) {
      this._tPerceive += 0.1;
      this._perceive(now);
      this._hearSounds(now);
    }
    this._tLos -= dt;
    if (this._tLos <= 0) { this._tLos += 0.05; this._refreshTarget(now); }

    // --- decisions (7 Hz) --------------------------------------------------
    this._stuckCheck(dt, now);
    this._tThink -= dt;
    if (this._tThink <= 0) {
      this._tThink += 0.14;
      this._think(now);
    }
    this._tUtil -= dt;
    if (this._tUtil <= 0) {
      this._tUtil += 0.33;
      if (!this.nade && this.nadeCooldown <= 0) this._considerUtility(now);
    }

    // --- per-frame execution ----------------------------------------------
    this.hasLookPoint = false;
    this._wantFire = false;
    this._wantMove = false;
    switch (this._state) {
      case BOT_STATE.BLIND: this._stBlind(dt, c); break;
      case BOT_STATE.NADE: this._stNade(dt, c); break;
      case BOT_STATE.ENGAGE: this._stEngage(dt, c); break;
      case BOT_STATE.INVESTIGATE: this._stInvestigate(dt, c); break;
      case BOT_STATE.PLANT: this._stPlant(dt, c); break;
      case BOT_STATE.DEFUSE: this._stDefuse(dt, c); break;
      case BOT_STATE.GUARD_BOMB: this._stGuardBomb(dt, c); break;
      case BOT_STATE.PICKUP: this._stPickup(dt, c); break;
      case BOT_STATE.RETREAT: this._stRetreat(dt, c); break;
      case BOT_STATE.ROTATE: this._stAdvance(dt, c); break;
      case BOT_STATE.HOLD: this._stHold(dt, c); break;
      case BOT_STATE.ADVANCE: this._stAdvance(dt, c); break;
      default: this._stIdle(dt, c); break;
    }
    this._applyAim(dt);
    this._applyFire(dt, c);
    this._applyGear(dt, c);
    if (!Number.isFinite(a.yaw)) a.yaw = 0;
    if (!Number.isFinite(a.pitch)) a.pitch = 0;
    if (!Number.isFinite(c.forward)) c.forward = 0;
    if (!Number.isFinite(c.right)) c.right = 0;
  }

  /** Freeze time: buy once, look down the opening angle, never move. */
  _freeze(dt, c, now) {
    this._sub = 'freeze';
    this.hasLookPoint = false;
    if (!this.buySent) {
      this.buySent = true;
      let plan = null;
      try {
        plan = (_buyPlan || fallbackBuyPlan)(this.actor, this.game);
      } catch (e) { plan = fallbackBuyPlan(this.actor, this.game); }
      if (Array.isArray(plan) && plan.length) {
        c.buy = plan;
        this._buyClearT = now + 0.3;
      }
    }
    // Point the crosshair where the round is going to start from.
    if (this.hasHold) this._lookAlong(this._holdVec, this._holdLook);
    else if (this.assignment && this.assignment.route) this._lookAtRoute();
    this._applyAim(dt);
  }

  _lookAlong(from, look) {
    if (!look) return;
    const len = Math.hypot(look.x, look.y, look.z);
    if (len < 1e-4) return;
    // `look` is a direction when it is short (unit-ish), a world point otherwise.
    if (len <= 3.2) {
      this.lookPoint.set(look.x / len, look.y / len, look.z / len)
        .multiplyScalar(14).add(from);
      this.lookPoint.y += 1.2;
    } else {
      this.lookPoint.copy(look);
      if (Math.abs(this.lookPoint.y - from.y) < 0.05) this.lookPoint.y += 1.2;
    }
    this.hasLookPoint = true;
  }

  _lookAtRoute() {
    const p = this._routePt(this._routeIdx + 1) || this._routePt(this._routeIdx);
    if (p) { this.lookPoint.copy(p); this.lookPoint.y += 1.4; this.hasLookPoint = true; }
  }

  /** Waypoint `i` of the assigned route (resolved once per assignment). */
  _routePt(i) {
    const pts = this._routePts;
    if (!pts || !pts.length) return null;
    return pts[clamp(i | 0, 0, pts.length - 1)];
  }

  /** Resolve `assignment.route` (node ids and/or vectors) into world points. */
  _resolveRoute(route) {
    this._routePts = null;
    if (!Array.isArray(route) || !route.length) return;
    const nav = this.game.nav;
    const out = [];
    for (let i = 0; i < route.length; i++) {
      const step = route[i];
      if (typeof step === 'string') {
        const n = nav && nav.byId ? nav.byId(step) : null;
        if (n && vecOk(n.pos)) out.push(n.pos.clone());
      } else {
        const v = toVec(_v8, step);
        if (v) out.push(v.clone());
      }
    }
    if (out.length) this._routePts = out;
  }

  // =========================================================================
  // perception
  // =========================================================================
  _memo(enemy) {
    let m = this.mem.get(enemy);
    if (!m) { m = new EnemyMemo(enemy); this.mem.set(enemy, m); }
    return m;
  }

  /** True when `v` sits inside the bot's view cone (peripheral rolls widen it). */
  _inView(v, peripheral) {
    const a = this.actor;
    const eye = a.eye || a.pos;
    const dx = v.x - eye.x, dz = v.z - eye.z;
    if (dx * dx + dz * dz < 2.25) return true;                   // point blank
    const ang = Math.abs(angleDiff(a.yaw, Math.atan2(dz, dx)));
    if (ang <= 0.916) return true;                                // 105° cone
    return peripheral && ang <= 1.571;                            // 180° sweep
  }

  _perceive(now) {
    const a = this.actor, g = this.game;
    const list = typeof g.alive === 'function' ? g.alive(this.enemyTeam) : null;
    this.enemiesVisible = 0;
    const blind = num(a.flashAmount, 0) > 0.35;
    const peripheral = chance(0.1 + 0.25 * this.diff.preaim);
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!e || !e.alive || e === a || e.team === a.team) continue;
        const m = this._memo(e);
        const d = a.distTo ? a.distTo(e) : a.pos.distanceTo(e.pos);
        m.dist = d;
        let sees = false;
        if (!blind && d < 90 && this._inView(e.eye || e.pos, peripheral)) {
          sees = a.canSee ? !!a.canSee(e) : this._losTo(e);
        }
        if (sees) {
          // Distance-scaled acquisition: far targets take longer to register.
          const need = (0.02 + d * 0.006) / (0.55 + this.diff.preaim);
          m.spot = Math.min(1, m.spot + 0.1 / Math.max(0.02, need));
          if (m.spot >= 1) this._confirmSight(m, now);
        } else {
          m.visible = false;
          m.spot = Math.max(0, m.spot - 0.06);
        }
        if (m.visible) this.enemiesVisible++;
      }
    }
    this._decayMemory(now);
    this._selectTarget(now);
  }

  _losTo(e) {
    const w = this.game.world;
    if (!w || typeof w.los !== 'function') return true;
    const from = this.actor.eye || this.actor.pos;
    const to = e.eye || e.pos;
    return !!w.los(from, to, { smoke: true });
  }

  /** Register a confirmed sighting: memory, intel, radio, reaction latency. */
  _confirmSight(m, now) {
    const wasStale = now - m.lastSeenTime > 1.2;
    m.lastSeenTime = now;
    m.fresh = true;
    m.viaIntel = false;
    m.visible = true;
    const e = m.actor;
    m.lastKnownPos.copy(e.pos);
    if (e.vel) m.lastVel.copy(e.vel); else m.lastVel.set(0, 0, 0);
    const w = this.game.world;
    m.area = w && w.areaAt ? w.areaAt(e.pos) : m.area;
    if (wasStale) {
      m.firstSeenTime = now;
      this.lastContactT = now;
      const co = this.coordinator;
      if (co && typeof co.report === 'function') {
        co.report('contact', { by: this.actor, enemy: e, pos: e.pos, area: m.area, dist: m.dist });
      }
      this._say('enemyspotted', 0.45);
    }
  }

  /** Refresh only the engaged target — cheap enough to run at 20 Hz. */
  _refreshTarget(now) {
    const m = this.target;
    if (!m) return;
    const e = m.actor;
    const a = this.actor;
    if (!e.alive) {
      // Confirm the frag: if we were shooting him a moment ago, that was us.
      if (now - this._lastShotT < 0.7) { this.kills++; this._say('gotone', 0.55); }
      this.target = null;
      this.burstLeft = 0;
      return;
    }
    m.dist = a.distTo ? a.distTo(e) : a.pos.distanceTo(e.pos);
    if (num(a.flashAmount, 0) > 0.35) { m.visible = false; return; }
    const sees = this._inView(e.eye || e.pos, false)
      && (a.canSee ? !!a.canSee(e) : this._losTo(e));
    if (sees) { m.visible = true; this._confirmSight(m, now); } else m.visible = false;
  }

  _decayMemory(now) {
    for (const [e, m] of this.mem) {
      if (!e || !e.alive) { this.mem.delete(e); continue; }
      const age = now - m.lastSeenTime;
      if (age > 14) { this.mem.delete(e); continue; }
      m.fresh = age < 6;                       // memory window used for decisions
      if (!m.fresh) m.visible = false;
    }
    this._pullIntel(now);
  }

  /** Fold the team's shared contacts into memory (they never count as "seen"). */
  _pullIntel(now) {
    const co = this.coordinator;
    const intel = co && co.intel;
    const list = intel && intel.contacts;
    if (!list || !list.length) return;
    for (let i = 0; i < list.length; i++) {
      const ct = list[i];
      if (!ct || !ct.enemy || !ct.enemy.alive || !ct.shared) continue;
      if (ct.by === this.actor) continue;
      const m = this._memo(ct.enemy);
      if (ct.t > m.lastSeenTime && !m.visible) {
        m.lastKnownPos.copy(ct.pos);
        m.lastSeenTime = ct.t;
        m.area = ct.area || m.area;
        m.fresh = now - ct.t < 6;
        m.viaIntel = true;
      }
    }
  }

  /** Pick who to shoot; only *visible* memos are engageable. */
  _selectTarget(now) {
    const a = this.actor;
    let best = null, bestScore = -1e9;
    for (const m of this.mem.values()) {
      if (!m.visible || !m.actor.alive) continue;
      const e = m.actor;
      let s = 120 - Math.min(110, m.dist * 2.2);
      s += (100 - clamp(num(e.health, 100), 1, 100)) * 0.35;     // finish the wounded
      if (m.dist < 9) s += 30;                                    // knife-range panic
      const dx = a.pos.x - e.pos.x, dz = a.pos.z - e.pos.z;
      const facing = Math.cos(angleDiff(num(e.yaw, 0), Math.atan2(dz, dx)));
      if (facing > 0.86) s += 45;                                 // he is aiming at me
      if (this.target === m) s += 26;                             // target inertia
      if (now - this.hurtT < 3 && this._hurtBy === e) s += 40;
      if (s > bestScore) { bestScore = s; best = m; }
    }
    if (!best && this.target && this.target.actor.alive
      && now - this.target.lastSeenTime < 1.1) return;   // keep the angle a moment
    if (best !== this.target) {
      const stale = !best || now - best.firstSeenTime > 1.4;
      this.target = best;
      this.burstLeft = 0;
      this.recoilShots = 0;
      if (best && stale) this._rollReaction(best);
    }
  }

  /** Reaction latency, shortened when the crosshair was already on the angle. */
  _rollReaction(m) {
    const r = this.diff.reaction;
    let t = rand(r[0], r[1]);
    const e = m.actor;
    const eye = this.actor.eye || this.actor.pos;
    const ang = Math.abs(angleDiff(this.actor.yaw,
      Math.atan2(e.pos.z - eye.z, e.pos.x - eye.x)));
    if (ang < 0.14) t *= 1 - 0.45 * this.diff.preaim;             // pre-aimed
    else if (ang > 1.0) t *= 1.25;                                 // caught wide
    if (this.roundT < 4) t *= 1.1;
    this.reactionT = Math.max(0.02, t);
    this.aimYawVel *= 0.25;
    this.aimPitchVel *= 0.25;
    this._flickT = 0.07 + rand(0, 0.1);
    this.headshotRoll = chance(this.diff.hsBias * (m.dist < 22 ? 1.15 : 0.55));
  }

  /** Footsteps / gunfire / objective noises → investigate or pre-aim. */
  _hearSounds(now) {
    const g = this.game, a = this.actor;
    const sounds = g.sounds;
    if (!sounds || !sounds.length) return;
    const mul = this.diff.hearing;
    let bestT = this._lastSoundT, bestI = -1, bestPrio = -1;
    for (let i = 0; i < sounds.length; i++) {
      const s = sounds[i];
      if (!s || !s.pos) continue;
      const t = num(s.t, 0);
      if (t <= this._lastSoundT) continue;
      if (s.team && s.team === a.team) continue;                  // own team's noise
      const base = num(s.range, SOUND_RANGE[s.kind] || 12);
      if (base <= 0) continue;                                     // silent walk
      const d = a.pos.distanceTo(s.pos);
      if (d > base * mul) continue;
      const prio = s.kind === 'plant' || s.kind === 'defuse' ? 3
        : s.kind === 'shoot' ? 2 : s.kind === 'nade_bounce' ? 1.5 : 1;
      if (prio > bestPrio || (prio === bestPrio && t > bestT)) {
        bestPrio = prio; bestT = t; bestI = i;
      }
    }
    this._lastSoundT = Math.max(this._lastSoundT, now);
    if (bestI < 0) return;
    const s = sounds[bestI];
    this.noisePos.copy(s.pos);
    this.noiseT = now;
    this.noiseKind = s.kind;
    this.threatDir.subVectors(s.pos, a.pos).setY(0);
    if (this.threatDir.lengthSq() > 1e-6) this.threatDir.normalize();
    if (s.kind === 'plant' || s.kind === 'defuse') {
      const co = this.coordinator;
      if (co && typeof co.report === 'function') co.report('contact', { by: a, pos: s.pos, area: this.game.world && this.game.world.areaAt ? this.game.world.areaAt(s.pos) : null, heard: true });
    }
  }

  // =========================================================================
  // aim
  // =========================================================================
  /** Follow the magazine to know how far up the recoil pattern we are. */
  _trackShots(dt) {
    const act = this.actor.active;
    const now = num(this.game.time, 0);
    const ammo = act ? num(act.ammo, -1) : -1;
    if (ammo >= 0 && this._lastAmmo >= 0) {
      const d = this._lastAmmo - ammo;
      if (d > 0) {
        this.recoilShots += d;
        this.shotsFired += d;
        this._lastShotT = now;
        if (this.burstLeft > 0) {
          this.burstLeft -= d;
          if (this.burstLeft <= 0) this.burstPause = this._nextPause;
        }
      } else if (d < 0) {
        this.recoilShots = 0;                       // reload / weapon switch
      }
    }
    this._lastAmmo = ammo;
    if (now - this._lastShotT > 0.16) {
      this.recoilShots *= Math.exp(-4.5 * dt);      // muzzle settles back down
      if (this.recoilShots < 0.02) this.recoilShots = 0;
    }
  }

  /** Vertical recoil the pattern has accumulated, in radians. */
  _recoilRise() {
    const n = this.recoilShots;
    const rise = 0.0095 * Math.min(n, 8) + 0.0032 * Math.max(0, n - 8);
    return Math.min(rise, 0.135);
  }

  /** Where on the enemy body to point, with lead and tracking error folded in. */
  _aimPointFor(m, out) {
    const e = m.actor;
    const h = num(e.height, PLAYER.standHeight);
    const head = this.headshotRoll;
    out.copy(e.pos);
    out.y += head ? h - PLAYER.eyeDrop * 1.15 : h * 0.72;
    if (e.vel) {
      const lead = (0.02 + m.dist * 0.0025) * (0.4 + 0.7 * this.diff.moveSkill);
      out.x += e.vel.x * lead;
      out.z += e.vel.z * lead;
      out.y += clamp(e.vel.y, -4, 4) * lead * 0.5;
    }
    return out;
  }

  _applyAim(dt) {
    const a = this.actor;
    const eye = a.eye || a.pos;
    // A queued throw owns the crosshair: aim the solved ballistic angles.
    if (this.nade && this.nade.aimReady && this._state === BOT_STATE.NADE) {
      this._slew(this.nade.yaw, this.nade.pitch, dt, 1);
      return;
    }
    const m = this.target;
    let px, py, pz;
    let onEnemy = false;
    if (m && m.visible && m.actor.alive && num(a.flashAmount, 0) <= 0.35) {
      const p = this._aimPointFor(m, _v1);
      px = p.x; py = p.y; pz = p.z;
      onEnemy = true;
    } else if (m && m.fresh && this._state === BOT_STATE.ENGAGE) {
      px = m.lastKnownPos.x; py = m.lastKnownPos.y + 1.2; pz = m.lastKnownPos.z;
    } else if (this.hasLookPoint) {
      px = this.lookPoint.x; py = this.lookPoint.y; pz = this.lookPoint.z;
    } else {
      // Nothing to look at: keep the current angles (with a lazy pitch recentre).
      this._slew(a.yaw, a.pitch * 0.9, dt, 0.55);
      return;
    }
    const dx = px - eye.x, dy = py - eye.y, dz = pz - eye.z;
    const horiz = Math.hypot(dx, dz) || 1e-4;
    let wantYaw = Math.atan2(dz, dx);
    let wantPitch = -Math.atan2(dy, horiz);

    // Persistent aim error, re-rolled a few times a second.
    this._aimOffT -= dt;
    if (this._aimOffT <= 0) {
      this._aimOffT += 0.34 + rand(0, 0.12);
      let mul = 1;
      const moving = (a.vel ? a.vel.x * a.vel.x + a.vel.z * a.vel.z : 0) > 1.2;
      if (a.crouching && this.stillT > 0.2) mul = 0.5;
      if (moving || !a.onGround) mul = 2;
      if (num(a.flashAmount, 0) > 0.05) mul *= 1 + num(a.flashAmount, 0) * 2.5;
      const sigma = this.diff.aimError * DEG * mul;
      this.aimOffYaw = gauss() * sigma;
      this.aimOffPitch = gauss() * sigma * 0.7;
    }
    wantYaw += this.aimOffYaw;
    wantPitch += this.aimOffPitch;

    if (onEnemy) {
      // Tracking lag against a strafing target (skill reduces it).
      const e = m.actor;
      if (e.vel) {
        const lat = (-Math.sin(wantYaw) * e.vel.x + Math.cos(wantYaw) * e.vel.z);
        wantYaw += (lat / Math.max(4, m.dist)) * 0.3 * (1.25 - this.diff.moveSkill);
      }
      // Recoil control: pull down against the pattern, scaled by `spray`.
      const rise = this._recoilRise();
      wantPitch += rise * this.diff.spray;
      wantYaw -= Math.sin(this.recoilShots * 1.15) * 0.004
        * Math.min(this.recoilShots, 12) * this.diff.spray;
    }
    this._slew(wantYaw, wantPitch, dt, 1);
  }

  /**
   * Move the view toward (wantYaw, wantPitch).  A freshly acquired target gets
   * a fast flick that deliberately overshoots, then the aim settles smoothly.
   */
  _slew(wantYaw, wantPitch, dt, mul) {
    const a = this.actor;
    let rate = this.diff.aimSpeed * mul;
    const flash = num(a.flashAmount, 0);
    if (flash > 0.05) rate *= 1 - 0.6 * clamp01(flash);
    if (num(a.health, 100) < 35) rate *= 0.9;
    let ey = angleDiff(a.yaw, wantYaw);
    let ep = angleDiff(a.pitch, wantPitch);
    if (this._flickT > 0) {
      this._flickT = Math.max(0, this._flickT - dt);
      rate *= 2.3;
      const os = 0.09 + 0.13 * (1 - this.diff.moveSkill);   // low skill overshoots more
      ey *= 1 + os;
      ep *= 1 + os;
    }
    const f = damp(Math.max(0.5, rate), dt);
    const maxStep = (7 + this.diff.aimSpeed * 1.4) * dt;    // human wrist limit
    const sy = clamp(ey * f, -maxStep, maxStep);
    const sp = clamp(ep * f, -maxStep, maxStep);
    a.yaw = angleWrap(a.yaw + sy);
    a.pitch = clamp(a.pitch + sp, -1.54, 1.54);
    this.aimYawVel = sy / dt;
    this.aimPitchVel = sp / dt;
    this._aimErr = Math.hypot(angleDiff(a.yaw, wantYaw), angleDiff(a.pitch, wantPitch));
  }

  /** Angular radius of the target, i.e. how tight the aim has to be to fire. */
  _hitCone(m) {
    const d = Math.max(1.2, m.dist);
    let cone = Math.atan2(0.46, d);                          // torso half-width
    cone *= 1 + (1 - this.diff.moveSkill) * 1.35;            // sloppier bots fire early
    if (this.headshotRoll) cone *= 0.62;
    return clamp(cone, 0.012, 0.5);
  }

  // =========================================================================
  // fire discipline
  // =========================================================================
  /** Would a bullet leaving the muzzle right now cross a teammate? */
  _friendlyInLine(dist) {
    const g = this.game, a = this.actor;
    const list = typeof g.alive === 'function' ? g.alive(a.team) : null;
    if (!list) return false;
    const eye = a.eye || a.pos;
    const fx = Math.cos(a.yaw), fz = Math.sin(a.yaw);
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      if (f === a || !f || !f.alive) continue;
      const dx = f.pos.x - eye.x, dz = f.pos.z - eye.z;
      const along = dx * fx + dz * fz;
      if (along <= 0.4 || along > dist + 1.2) continue;
      const perp = Math.abs(-dx * fz + dz * fx);
      if (perp < PLAYER.radius + 0.24 + along * 0.018) return true;
    }
    return false;
  }

  /** How many rounds this trigger pull should send. */
  _pickBurst(w, dist) {
    const bl = this.diff.burstLen;
    if (w.isSniper) { this._nextPause = 0.55 + rand(0, 0.7); return 1; }
    if (w.isHeavy && w.id !== 'negev') { this._nextPause = 0.35 + rand(0, 0.3); return 1; }
    if (w.isPistol) {
      const n = dist > 13 ? 1 : randInt(1, 2);
      this._nextPause = (dist > 13 ? 0.2 : 0.11) + rand(0, 0.16) * (1.4 - this.diff.spray);
      return n;
    }
    if (dist < 12) {                              // close quarters: hose them
      this._nextPause = 0.1 + rand(0, 0.12);
      return randInt(Math.max(4, bl[0] + 2), bl[1] + 9);
    }
    if (dist > 26 && (w.tapper || w.scoped)) {    // long range: single taps
      this._nextPause = 0.22 + rand(0, 0.22);
      return 1;
    }
    this._nextPause = 0.13 + rand(0, 0.2) + (1 - this.diff.spray) * 0.22;
    return randInt(bl[0], bl[1]);
  }

  _applyFire(dt, c) {
    const a = this.actor, w = this._wi;
    if (this._state === BOT_STATE.NADE) return;      // the nade routine fires itself
    if (this.panicSpray && num(a.flashAmount, 0) > 0.35) {
      if (w.ammo > 0 && !w.isNade && !w.isBomb) c.attack = true;
      return;
    }
    const m = this.target;
    if (!m || !m.actor.alive) { this.burstLeft = 0; return; }
    if (!m.visible) {                                 // lost him mid-burst
      this.burstLeft = 0;
      return;
    }
    if (this._state !== BOT_STATE.ENGAGE && this._state !== BOT_STATE.HOLD
        && this._state !== BOT_STATE.PLANT && this._state !== BOT_STATE.DEFUSE
        && this._state !== BOT_STATE.ADVANCE && this._state !== BOT_STATE.ROTATE
        && this._state !== BOT_STATE.INVESTIGATE && this._state !== BOT_STATE.RETREAT
        && this._state !== BOT_STATE.GUARD_BOMB && this._state !== BOT_STATE.PICKUP) return;
    if (this.reactionT > 0 || this.holdFireT > 0) return;
    if (w.isBomb || w.isNade) return;                 // wrong thing in hand
    if (w.isKnife) {                                  // out of bullets: rush him
      if (m.dist < 2.2 && this._aimErr < 0.5) c.attack = true;
      return;
    }
    if (w.ammo <= 0) { this.burstLeft = 0; return; }
    if (this._friendlyInLine(m.dist)) {
      this.burstLeft = 0;
      this.holdFireT = 0.12 + rand(0, 0.12);
      this._sub = 'blocked';
      if (chance(0.5)) this._sideStepT = Math.max(this._sideStepT, 0.35);
      return;
    }
    // AWP / scoped rifles: plant the feet, scope in, then take the shot.
    if (w.scoped && m.dist > 13) {
      this.stopMoveT = 0.35;
      if (!a.ads) { this._pressAds(c); this._sub = 'scope'; return; }
      if (this.scopeT < 0.1 + (1 - this.diff.awpSkill) * 0.35) return;
    } else if (a.ads && (!w.scoped || m.dist < 10)) {
      this._pressAds(c);                              // unscope for close range
      return;
    }
    // Stop-and-shoot: plant the feet a moment before a ranged shot.
    const stopRange = 8 + 7 * this.diff.moveSkill;
    if (m.dist > stopRange && this.diff.moveSkill > 0.28) {
      this.stopMoveT = 0.3;
      if (this.stillT < 0.15 * this.diff.moveSkill && this.burstLeft <= 0) {
        this._sub = 'settle';
        return;
      }
    }
    const cone = this._hitCone(m);
    const tol = this.burstLeft > 0 ? cone * 2.4 : cone;
    if (this._aimErr > tol) return;
    if (this.burstLeft <= 0) {
      if (this.burstPause > 0) return;
      this.burstLeft = this._pickBurst(w, m.dist);
      if (w.ammo < this.burstLeft) this.burstLeft = Math.max(1, w.ammo);
      this.headshotRoll = chance(this.diff.hsBias * (m.dist < 22 ? 1.2 : 0.5));
    }
    c.attack = true;
    this._sub = 'fire';
    if (w.isSniper) this.repositionT = 1.0 + rand(0, 0.9);   // relocate after the shot
  }

  /** Press attack2 at most once every 0.3 s so a toggle-scope never flickers. */
  _pressAds(c) {
    const now = num(this.game.time, 0);
    if (now < this._adsT) return;
    this._adsT = now + 0.3;
    c.attack2 = true;
  }

  _applyGear(dt, c) {
    if (this._state === BOT_STATE.NADE) return;      // the nade routine owns switchTo
    const a = this.actor, w = this._wi;
    const inv = a.inv || {};
    const priId = itemId(inv.primary);
    const secId = itemId(inv.secondary);
    const priAmmo = priId ? num(inv.primary && inv.primary.ammo, 1) + num(inv.primary && inv.primary.reserve, 1) : 0;
    const secAmmo = secId ? num(inv.secondary && inv.secondary.ammo, 1) + num(inv.secondary && inv.secondary.reserve, 1) : 0;
    const planting = this._state === BOT_STATE.PLANT
      && (this._planting || num(a.plantingT, 0) > 0);
    if (planting) return;
    // Wrong item in hand (grenade left over, or the bomb) → back to a gun.
    if (w.isNade || w.isBomb) {
      if (priId && priAmmo > 0) c.switchTo = SLOT.PRIMARY;
      else if (secId && secAmmo > 0) c.switchTo = SLOT.SECONDARY;
      else c.switchTo = SLOT.KNIFE;
      return;
    }
    if (a.reloading) return;
    const fighting = !!(this.target && this.target.visible);
    // Empty magazine: swapping to the pistol beats a full reload mid-fight.
    if (w.ammo <= 0 && !w.isKnife) {
      if (fighting && !w.isPistol && secId && num(inv.secondary && inv.secondary.ammo, 1) > 0) {
        c.switchTo = SLOT.SECONDARY;
        this._sub = 'swap';
        return;
      }
      if (w.reserve > 0) { c.reload = true; this._sub = 'reload'; return; }
      if (secId && secAmmo > 0 && !w.isPistol) { c.switchTo = SLOT.SECONDARY; return; }
      if (priId && priAmmo > 0 && w.isPistol) { c.switchTo = SLOT.PRIMARY; return; }
      c.switchTo = SLOT.KNIFE;                        // completely dry
      return;
    }
    // Back to the rifle once the fight is over and it has bullets again.
    if (w.isPistol && priId && num(inv.primary && inv.primary.ammo, 0) > 0 && !fighting) {
      c.switchTo = SLOT.PRIMARY;
      return;
    }
    if (w.isKnife && !this._knifeRush) {
      if (priId && priAmmo > 0) { c.switchTo = SLOT.PRIMARY; return; }
      if (secId && secAmmo > 0) { c.switchTo = SLOT.SECONDARY; return; }
    }
    // Top the magazine up when nobody is looking.
    const low = w.ammo <= Math.max(1, Math.ceil(w.mag * 0.25));
    if (low && w.reserve > 0 && !fighting && this.reactionT <= 0) {
      const t = num(this.game.time, 0);
      const contactNear = this._freshEnemyWithin(18, t);
      if (contactNear && this.diff.teamwork > 0.7 && this._stateT > 0.2) {
        this._reloadCover = true;                     // pull back first, then reload
        if (!this._inCover()) { this._sub = 'reloadcover'; return; }
      }
      c.reload = true;
      this._sub = 'reload';
    }
  }

  /** Any remembered enemy within `r` metres whose contact is still fresh. */
  _freshEnemyWithin(r, now) {
    for (const m of this.mem.values()) {
      if (!m.fresh || !m.actor.alive) continue;
      if (this.actor.pos.distanceTo(m.lastKnownPos) <= r) return m;
    }
    return null;
  }

  _inCover() {
    const n = this._navNear(this.actor.pos, 1.6, 'cover');
    return !!n;
  }

  // =========================================================================
  // movement
  // =========================================================================
  _setGoal(v, tag) {
    if (!v) return;
    if (this.hasGoal && this.goalTag === tag && this.path
        && this.goal.distanceToSquared(v) < 2.25) return;
    this.goal.copy(v);
    this.hasGoal = true;
    this.goalTag = tag;
    this._needPath = true;
    this._arrived = false;
  }

  /** Distance (XZ) from the actor to its current goal. */
  _goalDist() {
    if (!this.hasGoal) return 0;
    const p = this.actor.pos;
    return Math.hypot(this.goal.x - p.x, this.goal.z - p.z);
  }

  /** 4 Hz: (re)build the path and keep it valid against fire and drift. */
  _pathUpkeep() {
    const g = this.game, a = this.actor;
    if (!this.hasGoal) { this.path = null; return; }
    let need = this._needPath || !this.path;
    if (!need && this.path) {
      const last = this.path[this.path.length - 1];
      if (last && last.distanceToSquared(this.goal) > 4) need = true;
      const wp = this.path[this.pathIdx];
      if (wp && Math.hypot(wp.x - a.pos.x, wp.z - a.pos.z) > 26) need = true;
      if (!need && this._firePathBlocked()) need = true;
    }
    if (!need) return;
    this._needPath = false;
    const nav = g.nav;
    let p = null;
    if (nav && typeof nav.path === 'function') {
      try { p = nav.path(a.pos, this.goal, { avoidFire: true }); } catch (e) { p = null; }
    }
    if (p && p.length) {
      this.path = p;
      this.pathIdx = 0;
      // Skip a first waypoint we are already standing on.
      while (this.pathIdx < p.length - 1
        && Math.hypot(p[this.pathIdx].x - a.pos.x, p[this.pathIdx].z - a.pos.z) < 0.9) this.pathIdx++;
    } else {
      this.path = null;                       // fall back to direct steering
      this.pathIdx = 0;
    }
  }

  /** True when a molotov sits on the next couple of waypoints. */
  _firePathBlocked() {
    const fires = this.game.world && this.game.world.fires;
    if (!fires || !fires.length || !this.path) return false;
    const end = Math.min(this.path.length, this.pathIdx + 3);
    for (let i = this.pathIdx; i < end; i++) {
      const wp = this.path[i];
      for (let k = 0; k < fires.length; k++) {
        const f = fires[k];
        if (!f || !f.pos) continue;
        const r = num(f.radius, 1.5) + 0.9;
        const dx = wp.x - f.pos.x, dz = wp.z - f.pos.z;
        if (dx * dx + dz * dz < r * r) return true;
      }
    }
    return false;
  }

  /** The point the bot is currently steering at (waypoint or raw goal). */
  _currentWaypoint() {
    const a = this.actor;
    if (this.path && this.path.length) {
      while (this.pathIdx < this.path.length) {
        const wp = this.path[this.pathIdx];
        const reach = this.pathIdx === this.path.length - 1 ? 0.75 : 1.05;
        if (Math.hypot(wp.x - a.pos.x, wp.z - a.pos.z) < reach
          && Math.abs(wp.y - a.pos.y) < 2.2) { this.pathIdx++; continue; }
        return wp;
      }
      this._arrived = true;
      return null;
    }
    if (!this.hasGoal) return null;
    if (this._goalDist() < 0.75) { this._arrived = true; return null; }
    return this.goal;
  }

  /** Push away from teammates so five bots never walk as one blob. */
  _separation(out) {
    const g = this.game, a = this.actor;
    const list = typeof g.alive === 'function' ? g.alive(a.team) : null;
    if (!list) return out;
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      if (f === a || !f || !f.alive) continue;
      const dx = a.pos.x - f.pos.x, dz = a.pos.z - f.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 2.25 || d2 < 1e-5) continue;            // 1.5 m bubble
      const d = Math.sqrt(d2);
      const w = (1.5 - d) / 1.5;
      out.x += (dx / d) * w * 1.15;
      out.z += (dz / d) * w * 1.15;
    }
    return out;
  }

  /** Steer away from burning ground (never path through world.fires). */
  _avoidFire(out) {
    const fires = this.game.world && this.game.world.fires;
    if (!fires || !fires.length) return out;
    const p = this.actor.pos;
    for (let i = 0; i < fires.length; i++) {
      const f = fires[i];
      if (!f || !f.pos) continue;
      const r = num(f.radius, 1.5) + 1.3;
      const dx = p.x - f.pos.x, dz = p.z - f.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > r * r || d2 < 1e-5) continue;
      const d = Math.sqrt(d2);
      out.x += (dx / d) * 2.6;
      out.z += (dz / d) * 2.6;
    }
    return out;
  }

  /** World-space direction → cmd.forward / cmd.right in the actor's basis. */
  _steerTo(dir, c, scale = 1) {
    const a = this.actor;
    const len = Math.hypot(dir.x, dir.z);
    if (len < 1e-5) { c.forward = 0; c.right = 0; return; }
    const nx = dir.x / len, nz = dir.z / len;
    const fx = Math.cos(a.yaw), fz = Math.sin(a.yaw);
    c.forward = clamp((nx * fx + nz * fz) * scale, -1, 1);
    c.right = clamp((-nx * fz + nz * fx) * scale, -1, 1);
  }

  /**
   * Walk toward the current goal.
   * @param {Object} o {walk, crouch, sprint, jiggle, stopOk, scale}
   */
  _moveAlong(dt, c, o) {
    const a = this.actor;
    const opt = o || EMPTY_OPT;
    this._tPath -= dt;
    if (this._tPath <= 0) { this._tPath += 0.25; this._pathUpkeep(); }
    if (opt.crouch) c.crouch = true;
    if (opt.walk) c.walk = true;
    // Accuracy discipline wins over movement.
    if (this.stopMoveT > 0 && !opt.ignoreStop) { this._wantMove = false; return; }
    const wp = this._currentWaypoint();
    const steer = this._steer.set(0, 0, 0);
    if (wp) {
      steer.x = wp.x - a.pos.x;
      steer.z = wp.z - a.pos.z;
      const l = Math.hypot(steer.x, steer.z) || 1;
      steer.x /= l; steer.z /= l;
      if (this._sideStepT > 0) {                       // unstick: strafe around it
        const s = this._sideStep >= 0 ? 1 : -1;
        const tx = steer.x, tz = steer.z;
        steer.x = tx * 0.25 - tz * s * 1.0;
        steer.z = tz * 0.25 + tx * s * 1.0;
      }
    }
    this._separation(steer);
    this._avoidFire(steer);
    if (steer.x === 0 && steer.z === 0) { this._wantMove = false; return; }
    this._wantMove = true;
    this._steerTo(steer, c, num(opt.scale, 1));
    if (opt.jiggle) this._jiggle(dt, c, opt.jiggle);

    // Silent walk when enemies are expected nearby, sprint only early and safe.
    const now = num(this.game.time, 0);
    if (!opt.noWalkCheck && !c.walk) {
      const near = this._freshEnemyWithin(15, now);
      if (near || (this.noiseT > 0 && now - this.noiseT < 3
        && a.pos.distanceTo(this.noisePos) < 16)) c.walk = true;
    }
    if (opt.sprint && !c.walk && this.roundT < 8 && !this.target
      && this.diff.moveSkill > 0.2 && this._goalDist() > 9
      && !this._freshEnemyWithin(26, now) && c.forward > 0.6) c.sprint = true;

    // Jump only when the geometry demands it (or we are wedged).
    if (wp && a.onGround) {
      const up = wp.y - a.pos.y;
      const flat = Math.hypot(wp.x - a.pos.x, wp.z - a.pos.z);
      if (up > 0.5 && up < 2.1 && flat < 2.2) c.jump = true;
      else if (this._stuckT > 0.85 && this._jumpT <= 0) { c.jump = true; this._jumpT = 0.6; }
    }
  }

  /** Corner jiggle / strafe-peek, amplitude scaled by DIFFICULTY.peek. */
  _jiggle(dt, c, amp) {
    this._peekT -= dt;
    if (this._peekT <= 0) {
      this._peekT = 0.22 + rand(0, 0.4) * (1.3 - this.diff.peek);
      this._peekDir = -this._peekDir;
    }
    const k = clamp(num(amp, 1) * (0.35 + this.diff.peek * 0.9), 0, 1);
    c.right = clamp(c.right + this._peekDir * k, -1, 1);
  }

  /** No-progress watchdog: repath, sidestep, then jump. */
  _stuckCheck(dt, now) {
    const a = this.actor;
    this._progressT += dt;
    if (this._progressT < 0.25) return;
    const moved = Math.hypot(a.pos.x - this._lastPos.x, a.pos.z - this._lastPos.z);
    this._lastPos.copy(a.pos);
    const want = this._wantMove;
    this._progressT = 0;
    if (want && moved < 0.055) {
      this._stuckT += 0.25;
      if (this._stuckT > 0.5 && this._sideStepT <= 0) {
        this._sideStep = chance(0.5) ? 1 : -1;
        this._sideStepT = 0.35 + rand(0, 0.3);
      }
      if (this._stuckT > 1.0) { this._needPath = true; this._tPath = 0; this._stuckT = 0.4; }
    } else if (moved > 0.08) {
      this._stuckT = Math.max(0, this._stuckT - 0.35);
    }
  }

  /** A nav spot that breaks line of sight to `threat` and is close by. */
  _coverSpot(threat, out) {
    const nav = this.game.nav, w = this.game.world;
    if (!nav) return null;
    let list = (typeof nav.nodesWithTag === 'function' && nav.nodesWithTag('cover')) || null;
    if (!list || !list.length) list = nav.nodes;
    if (!list || !list.length) return null;
    const p = this.actor.pos;
    const myD = threat ? p.distanceTo(threat) : 0;
    let best = null, bestScore = -1e9, losBudget = 8;
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (!n || !n.pos) continue;
      const d = p.distanceTo(n.pos);
      if (d > 17 || d < 1.2) continue;
      let s = -d * 1.5;
      if (threat) {
        const td = n.pos.distanceTo(threat);
        if (td < myD + 1.2) continue;                 // no safer than here
        s += Math.min(td, 30) * 0.8;
        if (losBudget > 0 && w && typeof w.los === 'function') {
          losBudget--;
          _v7.copy(n.pos); _v7.y += 1.4;
          if (!w.los(_v7, threat, { smoke: true })) s += 30;
        }
      }
      if (n.tags && n.tags.indexOf('cover') >= 0) s += 14;
      if (s > bestScore) { bestScore = s; best = n; }
    }
    if (!best) return null;
    return out.copy(best.pos);
  }

  _bombPlanted() {
    const g = this.game;
    if (g.bomb && g.bomb.planted) return true;
    return !!(g.match && g.match.phase === PHASE.PLANTED);
  }

  /** Best known bomb position (callback memory first, then game.bomb). */
  _bombPoint(out) {
    const g = this.game;
    if (g.bomb && vecOk(g.bomb.pos) && (g.bomb.planted || g.bomb.dropped)) return out.copy(g.bomb.pos);
    if (this.hasBombPos) return out.copy(this.bombPos);
    if (g.bomb && vecOk(g.bomb.pos)) return out.copy(g.bomb.pos);
    return null;
  }

  _bombTimer() {
    const b = this.game.bomb;
    if (!b) return ROUND.bombTime;
    const t = b.timer != null ? b.timer : (b.time != null ? b.time : b.fuse);
    return num(t, ROUND.bombTime);
  }

  /** SiteDef for 'A' / 'B' (defensive about missing map data). */
  _siteDef(key) {
    const sites = this.game.map && this.game.map.sites;
    if (!sites) return null;
    if (key && sites[key]) return sites[key];
    return sites.A || sites.B || null;
  }

  _siteKey() {
    const a = this.assignment;
    if (a && a.site) return a.site;
    if (this.bombSite) return this.bombSite;
    const g = this.game;
    if (g.bomb && g.bomb.site) return g.bomb.site;
    return 'A';
  }

  /** Centre of the objective this bot cares about. */
  _sitePoint(out) {
    const s = this._siteDef(this._siteKey());
    if (!s) return null;
    return toVec(out, s.center) || (s.area ? out.set(
      (num(s.area.min && s.area.min.x, 0) + num(s.area.max && s.area.max.x, 0)) / 2,
      num(s.area.yMin, 0),
      (num(s.area.min && s.area.min.z, 0) + num(s.area.max && s.area.max.z, 0)) / 2) : null);
  }

  /** Pick the plant spot our teammates can actually cover. */
  _choosePlantSpot() {
    const s = this._siteDef(this._siteKey());
    const g = this.game, a = this.actor;
    if (!s) return false;
    const spots = s.plantSpots;
    if (!Array.isArray(spots) || !spots.length) {
      const c = this._sitePoint(_v3);
      if (!c) return false;
      this.plantSpot.copy(c);
      this.hasPlantSpot = true;
      return true;
    }
    const mates = typeof g.alive === 'function' ? g.alive(a.team) : null;
    let best = null, bestScore = -1e9;
    for (let i = 0; i < spots.length; i++) {
      const p = toVec(_v3, spots[i]);
      if (!p) continue;
      let sc = -a.pos.distanceTo(p) * 1.1;
      if (mates) {
        for (let k = 0; k < mates.length; k++) {
          const f = mates[k];
          if (f === a || !f.alive) continue;
          const d = f.pos.distanceTo(p);
          if (d < 16) sc += 9 - d * 0.35;             // covered by a teammate
        }
      }
      // A spot nobody can shoot into from our own approach is a bad plant.
      if (this.hasHold) sc += 0;
      sc += h01(this.seed, 20 + i) * 4;               // per-bot preference
      if (sc > bestScore) { bestScore = sc; best = i; }
    }
    if (best == null) return false;
    const p = toVec(this.plantSpot, spots[best]);
    this.hasPlantSpot = !!p;
    return this.hasPlantSpot;
  }

  // =========================================================================
  // decision (7 Hz)
  // =========================================================================
  _think(now) {
    const a = this.actor, g = this.game;
    const co = this.coordinator;
    if (co && typeof co.assignmentFor === 'function') {
      const asg = co.assignmentFor(a);
      if (asg && (asg !== this.assignment || asg.rev !== this._asgRev)) {
        this._asgRev = asg.rev;
        this.applyAssignment(asg);
      }
    }
    if (num(a.flashAmount, 0) > 0.35) { this._setState(BOT_STATE.BLIND); return; }
    if (this.nade) { this._setState(BOT_STATE.NADE); return; }

    const planted = this._bombPlanted();
    const tgt = this.target;
    const seeing = !!(tgt && tgt.visible);
    const hp = num(a.health, 100);
    const isT = a.team === TEAM.T;

    // --- CT: the defuse maths outranks everything else ---------------------
    if (!isT && planted) {
      const bp = this._bombPoint(_v2);
      if (bp) {
        const timer = this._bombTimer();
        const need = (a.kit ? ROUND.defuseKitTime : ROUND.defuseTime) + 0.35;
        const d = a.pos.distanceTo(bp);
        const eta = d * 0.36;
        const canMakeIt = timer >= need + eta;
        // Out of time to trade kills: go for the bomb regardless of contact.
        const mustGo = timer < need + eta + 6;
        // Break off only for a *close* threat; a distant one is not a reason
        // for a disciplined CT to abandon the defuse.
        const dangerous = seeing && tgt.dist < 14;
        const commit = mustGo || (!dangerous
          && (!seeing || this.diff.teamwork > 0.5 || num(a.defusingT, 0) > 0));
        const mine = !this.assignment || this.assignment.defuser !== false;
        if (canMakeIt && mine && commit) {
          this._setState(BOT_STATE.DEFUSE);
          return;
        }
        if (!canMakeIt && !seeing && d < 5 && this.diff.teamwork > 0.5) {
          this._setState(BOT_STATE.HOLD);             // cannot defuse: play the retake
          return;
        }
      }
    }

    // --- T: objective states ----------------------------------------------
    if (isT) {
      if (planted) {
        this._setState(BOT_STATE.GUARD_BOMB);
        if (seeing) this._setState(BOT_STATE.ENGAGE);
        return;
      }
      if (a.hasBomb) {
        if (this._plantWanted(now, seeing)) { this._setState(BOT_STATE.PLANT); return; }
      } else if (this._bombLoose(now)) {
        this._setState(BOT_STATE.PICKUP);
        if (seeing && this._stateT > 0.3) this._setState(BOT_STATE.ENGAGE);
        return;
      }
    }

    // --- fighting ----------------------------------------------------------
    if (seeing) {
      const scared = hp < 40 - 14 * this.aggression;
      const outnumbered = this.enemiesVisible >= 2 && hp < 70;
      if ((scared || outnumbered) && this.diff.peek > 0.25 && tgt.dist > 5.5
        && this.retreatT <= 0 && this._state !== BOT_STATE.RETREAT) {
        this.retreatT = 1.6 + rand(0, 1.4);
        this._say('needbackup', 0.5);
        this._setState(BOT_STATE.RETREAT);
        return;
      }
      if (this._state === BOT_STATE.RETREAT && this.retreatT > 0) return;
      this._setState(BOT_STATE.ENGAGE);
      return;
    }
    // Just lost him: hold the angle and re-peek instead of walking away.
    if (tgt && tgt.actor.alive && now - tgt.lastSeenTime < 1.0
      && this._state === BOT_STATE.ENGAGE) return;
    if (this._state === BOT_STATE.RETREAT && this.retreatT > 0) return;

    // --- something to check out --------------------------------------------
    const memo = this._staleTarget(now);
    const heard = this.noiseT > 0 && now - this.noiseT < 4.5;
    const wantInvestigate = (memo || heard)
      && (isT || this.role === ROLE.ROTATOR || this.aggression > 0.55 || heard);
    if (wantInvestigate && this._investigateAllowed(now)) {
      this._setState(BOT_STATE.INVESTIGATE);
      return;
    }

    // --- default per side --------------------------------------------------
    if (isT) {
      this._setState(BOT_STATE.ADVANCE);
    } else {
      const asg = this.assignment;
      if (asg && asg.rotateTo) this._setState(BOT_STATE.ROTATE);
      else if (this.hasHold && a.pos.distanceTo(this._holdVec) > 1.6) this._setState(BOT_STATE.ADVANCE);
      else this._setState(BOT_STATE.HOLD);
    }
  }

  /** Freshest remembered enemy that is worth walking toward. */
  _staleTarget(now) {
    let best = null, bestT = -1e9;
    for (const m of this.mem.values()) {
      if (!m.fresh || !m.actor.alive) continue;
      if (m.lastSeenTime > bestT) { bestT = m.lastSeenTime; best = m; }
    }
    return best;
  }

  /** CT anchors do not abandon their angle for every footstep. */
  _investigateAllowed(now) {
    if (this.actor.team === TEAM.T) return true;
    if (this.role === ROLE.ROTATOR) return true;
    if (!this.hasHold) return true;
    const d = this.actor.pos.distanceTo(this.noisePos);
    return d < 9 + 8 * this.aggression;
  }

  /** Should the carrier commit to a plant right now? */
  _plantWanted(now, seeing) {
    const a = this.actor;
    if (num(a.plantingT, 0) > 0) return true;          // already down on the bomb
    if (!this.hasPlantSpot && !this._choosePlantSpot()) return false;
    const d = a.pos.distanceTo(this.plantSpot);
    const timeLeft = num(this.game.match && this.game.match.timer, 60);
    if (seeing && d > 2.2 && timeLeft > ROUND.plantTime + 8) return false;
    return d < 26 || (this.game.world && this.game.world.areaAt
      && this.game.world.areaAt(a.pos) === (this._siteKey() === 'B' ? AREA.B_SITE : AREA.A_SITE));
  }

  /** True when the bomb is on the floor and this bot is the closest T to it. */
  _bombLoose(now) {
    const g = this.game, a = this.actor;
    const b = g.bomb;
    const dropped = (b && b.dropped) || (this.hasBombPos && !this._bombPlanted() && !this._anyoneCarrying());
    if (!dropped) return false;
    const bp = this._bombPoint(_v2);
    if (!bp) return false;
    if (this._anyoneCarrying()) return false;
    const myD = a.pos.distanceTo(bp);
    const list = typeof g.alive === 'function' ? g.alive(a.team) : null;
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        if (f === a || !f.alive) continue;
        if (f.pos.distanceTo(bp) < myD - 0.5) return false;
      }
    }
    return true;
  }

  _anyoneCarrying() {
    const g = this.game, a = this.actor;
    const list = typeof g.alive === 'function' ? g.alive(a.team) : null;
    if (!list) return false;
    for (let i = 0; i < list.length; i++) if (list[i] && list[i].hasBomb) return true;
    return false;
  }

  // =========================================================================
  // states
  // =========================================================================
  /** Default look target while moving: pre-aim intel, then noise, then path. */
  _lookAhead(dt) {
    const a = this.actor;
    const now = num(this.game.time, 0);
    if (this.diff.preaim > 0.2) {
      const m = this._staleTarget(now);
      if (m && a.pos.distanceTo(m.lastKnownPos) < 42) {
        this.lookPoint.copy(m.lastKnownPos);
        this.lookPoint.y += 1.3;
        this.hasLookPoint = true;
        return;
      }
    }
    if (this.noiseT > 0 && now - this.noiseT < 3.5) {
      this.lookPoint.copy(this.noisePos);
      this.lookPoint.y += 1.3;
      this.hasLookPoint = true;
      return;
    }
    const wp = (this.path && this.path[Math.min(this.pathIdx + 1, this.path.length - 1)])
      || (this.path && this.path[this.pathIdx])
      || (this.hasGoal ? this.goal : null);
    if (wp) {
      this.lookPoint.set(wp.x, wp.y + 1.5, wp.z);
      // Push the look point out past the corner so the crosshair leads the walk.
      const dx = wp.x - a.pos.x, dz = wp.z - a.pos.z;
      const l = Math.hypot(dx, dz);
      if (l > 0.2 && l < 6) {
        this.lookPoint.x += (dx / l) * 6;
        this.lookPoint.z += (dz / l) * 6;
      }
      this.hasLookPoint = true;
    }
  }

  _stIdle(dt, c) {
    this._sub = 'idle';
    const p = this.hasHold ? this._holdVec : this._sitePoint(_v4);
    if (p) {
      this._setGoal(p, 'idle');
      this._moveAlong(dt, c, WALK_OPT);
    }
    this._lookAhead(dt);
  }

  /** Walk the lane: stack up, wait for the call, then push to the objective. */
  _stAdvance(dt, c) {
    const a = this.actor, g = this.game;
    const asg = this.assignment;
    const now = num(g.time, 0);
    const isT = a.team === TEAM.T;

    if (!isT && asg && asg.rotateTo) {                 // ordered rotation
      const p = toVec(_v4, asg.rotateTo);
      if (p) {
        this._sub = 'rotate';
        this._setGoal(p, 'rot');
        this._moveAlong(dt, c, this._goalDist() > 12 ? RUN_OPT : WALK_OPT);
        this._lookAhead(dt);
        return;
      }
    }
    if (!isT) {                                        // walk back onto the angle
      const p = this.hasHold ? this._holdVec : this._sitePoint(_v4);
      if (p) {
        this._sub = 'toangle';
        this._setGoal(p, 'hold');
        this._moveAlong(dt, c, this._goalDist() > 10 ? RUN_OPT : WALK_OPT);
      }
      this._lookAhead(dt);
      return;
    }

    // --- T: stack point, then exec ----------------------------------------
    const goAt = asg && Number.isFinite(asg.goAt) ? asg.goAt : -1;
    const stack = asg && asg.stack ? toVec(_v5, asg.stack) : null;
    if (stack && now < goAt) {
      this._setGoal(stack, 'stack');
      const d = this._goalDist();
      if (d > 2.2) {
        this._sub = 'tostack';
        this._moveAlong(dt, c, d > 12 ? RUN_OPT : WALK_OPT);
      } else {
        this._sub = 'stacked';
        c.walk = true;
        if (this.patience < 0.35 && chance(0.02)) this._say('inposition', 0.25);
        if (this.diff.peek > 0.4) this._jiggle(dt, c, 0.25);
      }
      this._lookAhead(dt);
      return;
    }

    // Follow the assigned lane, then commit to the site itself.
    let dest = null;
    if (this._routePts && this._routePts.length) {
      const cur = this._routePt(this._routeIdx);
      if (cur && Math.hypot(cur.x - a.pos.x, cur.z - a.pos.z) < 2.6
        && this._routeIdx < this._routePts.length - 1) this._routeIdx++;
      dest = this._routePt(this._routeIdx);
    }
    const lastLeg = !this._routePts || this._routeIdx >= this._routePts.length - 1;
    if (lastLeg) {
      if (a.hasBomb && (this.hasPlantSpot || this._choosePlantSpot())) dest = this.plantSpot;
      else dest = this._sitePoint(_v6) || dest;
    }
    if (!dest) { this._stIdle(dt, c); return; }
    this._sub = lastLeg ? 'exec' : 'lane' + this._routeIdx;
    this._setGoal(dest, 'lane');
    const careful = this._freshEnemyWithin(20, now) || this._nearSite(6);
    this._moveAlong(dt, c, careful ? CREEP_OPT : (this.role === ROLE.ENTRY ? PUSH_OPT : RUN_OPT));
    if (careful && this.diff.peek > 0.3) this._jiggle(dt, c, 0.3);
    this._lookAhead(dt);
  }

  _nearSite(r) {
    const p = this._sitePoint(_v7);
    return !!p && this.actor.pos.distanceTo(p) < r;
  }

  /** CT anchor: sit on the angle, pre-aim the entry, peek now and then. */
  _stHold(dt, c) {
    const a = this.actor;
    const spot = this.hasHold ? this._holdVec : null;
    if (spot) {
      const d = a.pos.distanceTo(spot);
      if (d > 1.5) {
        this._sub = 'settle';
        this._setGoal(spot, 'hold');
        this._moveAlong(dt, c, d > 9 ? RUN_OPT : CREEP_OPT);
      } else {
        this._sub = 'hold';
        this._wantMove = false;
        const hs = this.assignment && this.assignment.holdSpot;
        if (hs && hs.crouch) c.crouch = true;
        else if (this.diff.moveSkill > 0.5 && this._inCover()) c.crouch = true;
        c.walk = true;
        // Micro-peek so the silhouette is never perfectly static.
        if (this.diff.peek > 0.25 && this._stateT > 0.6) {
          this._peekT -= dt;
          if (this._peekT <= 0) {
            this._peekT = 0.9 + rand(0, 2.2) * this.patience;
            this._peekDir = -this._peekDir;
          }
          if (this._peekT > 0.55) c.right = clamp(this._peekDir * 0.5 * this.diff.peek, -1, 1);
        }
      }
    } else if (this._sitePoint(_v4)) {
      this._setGoal(_v4, 'site');
      this._moveAlong(dt, c, WALK_OPT);
    }
    this._holdLookPoint(dt);
  }

  /** Where an anchor points the crosshair while nothing is visible. */
  _holdLookPoint(dt) {
    const a = this.actor;
    const now = num(this.game.time, 0);
    if (this.diff.preaim > 0.3) {
      const m = this._staleTarget(now);
      if (m && a.pos.distanceTo(m.lastKnownPos) < 38) {
        this.lookPoint.copy(m.lastKnownPos);
        this.lookPoint.y += 1.3;
        this.hasLookPoint = true;
        return;
      }
    }
    if (this.noiseT > 0 && now - this.noiseT < 4) {
      this.lookPoint.copy(this.noisePos);
      this.lookPoint.y += 1.3;
      this.hasLookPoint = true;
      return;
    }
    if (this.hasHold && this._holdLook.lengthSq() > 1e-6) {
      this._lookAlong(this._holdVec, this._holdLook);
    } else {
      const p = this._sitePoint(_v4);
      if (!p) return;
      this.lookPoint.set(p.x, p.y + 1.4, p.z);
      this.hasLookPoint = true;
    }
    // Sloppier bots let the crosshair drift off the pre-aim line.
    const sweep = (1 - this.diff.preaim) * 0.5;
    if (sweep > 0.02) {
      const eye = a.eye || a.pos;
      const dx = this.lookPoint.x - eye.x, dz = this.lookPoint.z - eye.z;
      const ang = Math.sin(now * 0.55 + this.seed % 6.283) * sweep;
      const cs = Math.cos(ang), sn = Math.sin(ang);
      this.lookPoint.x = eye.x + dx * cs - dz * sn;
      this.lookPoint.z = eye.z + dx * sn + dz * cs;
    }
  }

  /** Gunfight footwork: hold the angle, close the gap, or reposition. */
  _stEngage(dt, c) {
    const a = this.actor, w = this._wi;
    const m = this.target;
    if (!m) { this._stIdle(dt, c); return; }
    const d = m.dist;
    this._sub = 'fight';
    if (!m.visible) {                                   // lost him: peek his angle
      this._setGoal(m.lastKnownPos, 'lastknown');
      if (this.aggression > 0.5 && d > 4) this._moveAlong(dt, c, CREEP_OPT);
      else { this._wantMove = false; c.walk = true; }
      if (this.diff.peek > 0.3) this._jiggle(dt, c, 0.45);
      return;
    }

    // Snipers relocate after every shot instead of holding the same window.
    if (w.isSniper && this.repositionT > 0) {
      this._sub = 'relocate';
      const cv = this._coverSpot(m.lastKnownPos, _v4);
      if (cv) { this._setGoal(cv, 'reloc'); this._moveAlong(dt, c, CREEP_OPT); }
      return;
    }
    if (w.isKnife) {                                    // no bullets: charge
      this._knifeRush = true;
      this._setGoal(m.lastKnownPos, 'knife');
      this._moveAlong(dt, c, RUN_OPT);
      return;
    }
    this._knifeRush = false;
    // Distance management: get inside the weapon's window, no closer.
    const want = clamp(w.good * 0.62, 3.5, 26);
    if (d > want * 1.55 && !w.isSniper && this.aggression > 0.35) {
      this._sub = 'close';
      this._setGoal(m.lastKnownPos, 'close');
      this._moveAlong(dt, c, CREEP_OPT);
    } else if (d < 4.5 && w.isSniper) {
      this._sub = 'back';
      const cv = this._coverSpot(m.lastKnownPos, _v4);
      if (cv) { this._setGoal(cv, 'back'); this._moveAlong(dt, c, CREEP_OPT); }
    } else {
      // In the pocket: stand still to shoot, strafe between bursts.
      this._wantMove = false;
      if (this.stopMoveT <= 0 && this.burstPause > 0 && this.diff.peek > 0.3 && d > 6) {
        this._jiggle(dt, c, 0.5);
      }
      if (d > 12 && this.diff.moveSkill > 0.55 && this.stillT > 0.2
        && !w.isSniper && this._inCover()) c.crouch = true;
    }
    if (this.kills > 0 && chance(0.004)) this._say('gotone', 0.3);
  }

  /** Walk onto the last known position / the noise that woke us up. */
  _stInvestigate(dt, c) {
    const a = this.actor;
    const now = num(this.game.time, 0);
    const m = this._staleTarget(now);
    let dest = null;
    if (m && (!this.noiseT || m.lastSeenTime >= this.noiseT)) dest = m.lastKnownPos;
    else if (this.noiseT > 0) dest = this.noisePos;
    if (!dest) { this._stIdle(dt, c); return; }
    this._sub = 'check';
    this._setGoal(dest, 'invest');
    const d = this._goalDist();
    if (d < 2.4) {                                      // nothing here — drop it
      this.noiseT = -999;
      if (m) m.fresh = false;
      this._wantMove = false;
      this._say('sectorclear', 0.12);
    } else {
      this._moveAlong(dt, c, CREEP_OPT);
      if (this.diff.peek > 0.35) this._jiggle(dt, c, 0.3);
    }
    this._lookAhead(dt);
  }

  /** Carrier: get on the plant spot and hold use. */
  _stPlant(dt, c) {
    const a = this.actor;
    if (!this.hasPlantSpot) this._choosePlantSpot();
    const spot = this.hasPlantSpot ? this.plantSpot : this._sitePoint(_v4);
    if (!spot) { this._stAdvance(dt, c); return; }
    const d = a.pos.distanceTo(spot);
    if (num(a.plantingT, 0) > 0 || d < 1.15) {
      this._sub = 'planting';
      this._planting = true;
      this._wantMove = false;
      c.use = true;
      c.switchTo = SLOT.BOMB;
      c.crouch = this.diff.moveSkill > 0.4;
      this.lookPoint.set(spot.x, spot.y + 0.1, spot.z);
      this.hasLookPoint = true;
      if (!this._plantCall) { this._plantCall = true; this._say('planting', 0.9); }
      return;
    }
    this._planting = false;
    this._sub = 'toplant';
    this._setGoal(spot, 'plant');
    this._moveAlong(dt, c, d > 10 ? RUN_OPT : CREEP_OPT);
    this._lookAhead(dt);
  }

  /** Defuser: reach the bomb, hold use, fake it when someone is watching. */
  _stDefuse(dt, c) {
    const a = this.actor;
    const bp = this._bombPoint(_v4);
    if (!bp) { this._stHold(dt, c); return; }
    const d = a.pos.distanceTo(bp);
    // hysteresis so `use` never flickers at the edge of the defuse radius
    if (d < 1.05 || (this.defusing && d < 1.32)) {
      this._wantMove = false;
      this.lookPoint.set(bp.x, bp.y + 0.1, bp.z);
      this.hasLookPoint = true;
      c.crouch = true;
      const timer = this._bombTimer();
      const need = a.kit ? ROUND.defuseKitTime : ROUND.defuseTime;
      const watched = this._freshEnemyWithin(26, num(this.game.time, 0));
      if (this.fakeBudget === undefined) this.fakeBudget = 1.2;
      const lastMan = this._teamAliveCount() <= 1;
      // Fake defuse to bait a peek — a short, budgeted bluff, never a habit.
      const canFake = this.fakeBudget > 0 && !lastMan && watched && timer > need + 8
        && this.diff.teamwork > 0.78 && this.diff.peek > 0.6;
      if (canFake) {
        this.fakeBudget -= dt;
        this.fakeDefuseT -= dt;
        if (this.fakeDefuseT <= 0) this.fakeDefuseT = 0.5 + rand(0, 0.4);
        c.use = this.fakeDefuseT > 0.28;
        this._sub = 'fakedefuse';
      } else {
        c.use = true;
        this._sub = 'defusing';
      }
      if (!this._defuseCall) { this._defuseCall = true; this._say('defusing', 1); }
      this.defusing = true;
      return;
    }
    this.defusing = false;
    this._sub = 'tobomb';
    this._setGoal(bp, 'defuse');
    this._moveAlong(dt, c, d > 12 ? RUN_OPT : WALK_OPT);
    this._lookAhead(dt);
  }

  /** Living teammates including me. */
  _teamAliveCount() {
    const g = this.game, a = this.actor;
    const list = typeof g.alive === 'function' ? g.alive(a.team) : null;
    return list ? list.length : 1;
  }

  /** Post-plant: crossfire the bomb from an off-angle, push if it ticks down. */
  _choosePostPlant() {
    const asg = this.assignment;
    if (asg && asg.postPlant) {
      const p = toVec(this._ppVec, asg.postPlant.pos || asg.postPlant);
      if (p) {
        this._hasPP = true;
        if (!toVec(this._ppLook, asg.postPlant.look)) this._ppLook.set(0, 0, 0);
        return true;
      }
    }
    const site = this._siteDef(this._siteKey());
    const list = site && site.postPlant;
    if (Array.isArray(list) && list.length) {
      const idx = Math.floor(h01(this.seed, 31) * list.length) % list.length;
      const e = list[idx];
      if (toVec(this._ppVec, e && (e.pos || e))) {
        this._hasPP = true;
        if (!toVec(this._ppLook, e && e.look)) this._ppLook.set(0, 0, 0);
        return true;
      }
    }
    const bp = this._bombPoint(_v5);
    if (bp) {
      const cv = this._coverSpot(bp, _v6);
      this._ppVec.copy(cv || bp);
      this._ppLook.copy(bp).sub(this._ppVec).setY(0);
      if (this._ppLook.lengthSq() < 1e-6) this._ppLook.set(1, 0, 0);
      this._ppLook.normalize();
      this._hasPP = true;
      return true;
    }
    return false;
  }

  _stGuardBomb(dt, c) {
    const a = this.actor;
    if (!this._hasPP) this._choosePostPlant();
    const bp = this._bombPoint(_v4);
    const now = num(this.game.time, 0);
    // Someone is on the bomb: forget the angle and contest it.
    const contested = (this.noiseKind === 'defuse' && now - this.noiseT < 2.5)
      || (bp && this._enemyNear(bp, 3.5, now));
    if (contested && bp) {
      this._sub = 'contest';
      this._setGoal(bp, 'contest');
      if (a.pos.distanceTo(bp) > 4) this._moveAlong(dt, c, RUN_OPT);
      else { this._wantMove = false; c.walk = true; }
      this.lookPoint.set(bp.x, bp.y + 1.0, bp.z);
      this.hasLookPoint = true;
      this._say('holdpos', 0.15);
      return;
    }
    if (this._hasPP) {
      const d = a.pos.distanceTo(this._ppVec);
      if (d > 1.5) {
        this._sub = 'topost';
        this._setGoal(this._ppVec, 'post');
        this._moveAlong(dt, c, d > 10 ? RUN_OPT : CREEP_OPT);
      } else {
        this._sub = 'post';
        this._wantMove = false;
        c.walk = true;
        if (this.diff.moveSkill > 0.5 && this._inCover()) c.crouch = true;
        if (this.diff.peek > 0.3) this._jiggle(dt, c, 0.2);
      }
      this._lookAlong(this._ppVec, this._ppLook);
      if (!this.hasLookPoint) this._lookAhead(dt);
      return;
    }
    this._stIdle(dt, c);
  }

  /** Any remembered enemy sitting within `r` of `p`. */
  _enemyNear(p, r, now) {
    for (const m of this.mem.values()) {
      if (!m.actor.alive) continue;
      if (now - m.lastSeenTime > 3) continue;
      if (m.lastKnownPos.distanceTo(p) <= r) return true;
    }
    return false;
  }

  /** Pick the dropped bomb back up. */
  _stPickup(dt, c) {
    const bp = this._bombPoint(_v4);
    if (!bp) { this._stAdvance(dt, c); return; }
    const d = this.actor.pos.distanceTo(bp);
    this._setGoal(bp, 'pickup');
    if (d < 1.5) {
      this._sub = 'grab';
      this._wantMove = false;
      c.use = true;
      this.lookPoint.set(bp.x, bp.y + 0.2, bp.z);
      this.hasLookPoint = true;
    } else {
      this._sub = 'tobomb';
      this._moveAlong(dt, c, d > 10 ? RUN_OPT : WALK_OPT);
      this._lookAhead(dt);
    }
  }

  /** Fighting retreat: break the angle but keep the crosshair on the threat. */
  _stRetreat(dt, c) {
    const a = this.actor;
    const m = this.target || this._staleTarget(num(this.game.time, 0));
    const threat = m ? m.lastKnownPos : null;
    this._sub = 'retreat';
    if (!this._retreatSet || this._stateT > 1.8) {
      const cv = this._coverSpot(threat, _v4);
      if (cv) { this._retreatVec.copy(cv); this._retreatSet = true; this._stateT = 0; }
      else if (threat) {                                // no cover: back straight off
        this._retreatVec.copy(a.pos).sub(threat).setY(0);
        if (this._retreatVec.lengthSq() < 1e-6) this._retreatVec.set(1, 0, 0);
        this._retreatVec.normalize().multiplyScalar(7).add(a.pos);
        this._retreatSet = true;
      }
    }
    if (this._retreatSet) {
      this._setGoal(this._retreatVec, 'cover');
      this._moveAlong(dt, c, FIGHT_OPT);
      if (this._goalDist() < 1.2) { this._retreatSet = false; this.retreatT = 0; }
    }
    if (m) { this.lookPoint.copy(m.lastKnownPos); this.lookPoint.y += 1.3; this.hasLookPoint = true; }
    if (num(a.health, 100) < 45) this._say('imhit', 0.1);
  }

  /** Flashed: either panic-spray the last angle or break contact. */
  _stBlind(dt, c) {
    const a = this.actor;
    this._sub = 'blind';
    const amt = num(a.flashAmount, 0);
    if (!this._blindPlanned) {
      this._blindPlanned = true;
      // Bad bots panic; good bots retreat and hold the crosshair steady.
      this.panicSpray = chance(clamp01(0.75 - this.diff.spray * 0.6 + this.aggression * 0.2));
    }
    if (this.panicSpray) {
      this._wantMove = false;
      c.crouch = chance(0.02) || a.crouching;
    } else {
      this._retreatVec.copy(this.threatDir).multiplyScalar(-6).add(a.pos);
      this._setGoal(this._retreatVec, 'blindback');
      this._moveAlong(dt, c, CREEP_OPT);
    }
    this.lookPoint.copy(this.threatDir).multiplyScalar(12).add(a.pos);
    this.lookPoint.y = (a.eye ? a.eye.y : a.pos.y + 1.6);
    this.hasLookPoint = true;
    if (amt <= 0.35) { this._blindPlanned = false; this.panicSpray = false; }
  }

  // =========================================================================
  // utility (grenades)
  // =========================================================================
  /** Inventory lookup; 'molotov' resolves to whichever fire nade we carry. */
  _nadeCount(type) {
    const list = this.actor.inv && this.actor.inv.grenades;
    if (!Array.isArray(list)) return 0;
    let want = type;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e) continue;
      const id = itemId(e);
      if (id === want && num(e.count, 1) > 0) return num(e.count, 1);
      if ((want === 'molotov' || want === 'incendiary')
        && (id === 'molotov' || id === 'incendiary') && num(e.count, 1) > 0) {
        this._fireNadeId = id;
        return num(e.count, 1);
      }
    }
    return 0;
  }

  _fireNadeType() {
    if (this._nadeCount('molotov') > 0) return this._fireNadeId || 'molotov';
    return null;
  }

  /** Would this throw catch a friend in the blast or cross one on the way? */
  _nadeSafe(type, to) {
    const g = this.game, a = this.actor;
    const list = typeof g.alive === 'function' ? g.alive(a.team) : null;
    if (!list) return true;
    const blast = (NADE_BLAST[type] || 5) + 1.2;
    const eye = a.eye || a.pos;
    const dx = to.x - eye.x, dz = to.z - eye.z;
    const len = Math.hypot(dx, dz) || 1;
    const fx = dx / len, fz = dz / len;
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      if (f === a || !f || !f.alive) continue;
      if (f.pos.distanceTo(to) < blast) return false;
      const rx = f.pos.x - eye.x, rz = f.pos.z - eye.z;
      const along = rx * fx + rz * fz;
      if (along < 0.5 || along > len) continue;
      if (Math.abs(-rx * fz + rz * fx) < 1.1) return false;     // standing in the arc
    }
    return true;
  }

  /** Which scripted phase the bot is in, for NadeLine matching. */
  _nadePhase() {
    const asg = this.assignment;
    if (this.actor.team === TEAM.T) {
      if (this._bombPlanted()) return 'hold';
      const goAt = asg && Number.isFinite(asg.goAt) ? asg.goAt : -1;
      if (goAt > 0 && num(this.game.time, 0) < goAt) return 'exec';
      return this._nearSite(24) ? 'exec' : 'exec';
    }
    if (this._bombPlanted()) return 'retake';
    return 'hold';
  }

  /** Scripted line from map.tactics.nades that fits here and now. */
  _pickNadeLine(now) {
    /** Scripted lines the coordinator handed us, else the whole map list. */
    const tactics = this.game.map && this.game.map.tactics;
    const lines = (this.assignment && this.assignment.nadeLines)
      || (tactics && tactics.nades);
    if (!Array.isArray(lines) || !lines.length) return null;
    const a = this.actor;
    const w = this.game.world;
    const myArea = w && w.areaAt ? w.areaAt(a.pos) : null;
    const phase = this._nadePhase();
    const siteArea = this._siteKey() === 'B' ? AREA.B_SITE : AREA.A_SITE;
    let best = null, bestD = 1e9;
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i];
      if (!L || (L.team && L.team !== a.team)) continue;
      if (L.phase && L.phase !== phase) continue;
      if (L.area && L.area !== myArea && L.area !== siteArea) continue;
      if (this._usedLines.indexOf(L) >= 0) continue;
      const type = L.type === 'molotov' ? (this._fireNadeType() || 'molotov') : L.type;
      if (this._nadeCount(type) <= 0) continue;
      const from = toVec(_v5, L.from);
      if (!from) continue;
      const d = a.pos.distanceTo(from);
      if (d > 26) continue;                                  // too far to walk to the line
      if (d < bestD) { bestD = d; best = L; }
    }
    return best;
  }

  _considerUtility(now) {
    const a = this.actor;
    if (this._state === BOT_STATE.BLIND || this._state === BOT_STATE.DEFUSE
      || this._state === BOT_STATE.PLANT || this._state === BOT_STATE.PICKUP) return;
    if (num(a.flashAmount, 0) > 0.2) return;
    if (this.target && this.target.visible && this.target.dist < 9) return;
    const p = clamp01(this.diff.nadeChance * this.nadeLove);
    // Scripted execute / retake utility first.
    const line = this._pickNadeLine(now);
    if (line && chance(p * 0.95)) {
      const type = line.type === 'molotov' ? (this._fireNadeType() || 'molotov') : line.type;
      const to = toVec(_v6, line.to);
      if (to && this._nadeSafe(type, to)) {
        this._usedLines.push(line);
        this._startNade(type, to, toVec(_v5, line.from), line);
        return;
      }
    }
    this._improvisedNade(now, p);
  }

  /** Centroid of two or more fresh contacts standing close together. */
  _enemyCluster(now, out) {
    let n = 0, x = 0, y = 0, z = 0, first = null;
    for (const m of this.mem.values()) {
      if (!m.fresh || !m.actor.alive || now - m.lastSeenTime > 3.5) continue;
      if (!first) first = m;
      else if (m.lastKnownPos.distanceTo(first.lastKnownPos) > 6.5) continue;
      n++; x += m.lastKnownPos.x; y += m.lastKnownPos.y; z += m.lastKnownPos.z;
    }
    this._clusterN = n;
    if (n < 2) return null;
    return out.set(x / n, y / n, z / n);
  }

  /** Read-the-game throws that are not in the map script. */
  _improvisedNade(now, p) {
    const a = this.actor;
    const planted = this._bombPlanted();
    // HE onto a group of known enemies.
    if (this._nadeCount('he') > 0 && chance(p * 0.55)) {
      const cl = this._enemyCluster(now, _v6);
      if (cl && a.pos.distanceTo(cl) > 8 && a.pos.distanceTo(cl) < 28
        && this._nadeSafe('he', cl)) { this._startNade('he', cl, null, null); return; }
    }
    // Fire onto the bomb: deny the defuse (T) or burn the plant spot (CT retake).
    const fire = this._fireNadeType();
    if (planted && fire && chance(p * 0.7)) {
      const bp = this._bombPoint(_v6);
      const d = bp ? a.pos.distanceTo(bp) : 999;
      if (bp && d > 4 && d < 26 && this._enemyNear(bp, 6, now) && this._nadeSafe(fire, bp)) {
        this._startNade(fire, bp, null, null);
        return;
      }
    }
    // Flash before entering the site.
    if (this._nadeCount('flash') > 0 && a.team === TEAM.T && !planted
      && (this._state === BOT_STATE.ADVANCE || this._state === BOT_STATE.HOLD)
      && chance(p * 0.5)) {
      const sp = this._sitePoint(_v6);
      const d = sp ? a.pos.distanceTo(sp) : 999;
      if (sp && d > 6 && d < 26) {
        sp.y += 2.4;                                        // pop it in the air
        if (this._nadeSafe('flash', sp)) { this._startNade('flash', sp, null, null); return; }
      }
    }
    // Smoke a long angle somebody is watching so we can cross.
    if (this._nadeCount('smoke') > 0 && chance(p * 0.45)) {
      const m = this._staleTarget(now);
      if (m && m.dist > 24 && !m.visible) {
        _v6.copy(m.lastKnownPos).sub(a.pos).multiplyScalar(0.72).add(a.pos);
        _v6.y = m.lastKnownPos.y;
        if (this._nadeSafe('smoke', _v6)) { this._startNade('smoke', _v6, null, null); return; }
      }
    }
  }

  /** Begin a throw: walk to `from` (optional), aim, release, re-arm. */
  _startNade(type, to, from, line) {
    if (!type || !to) return;
    const n = this._nade;
    n.type = type;
    n.to.copy(to);
    n.hasFrom = !!from;
    if (from) n.from.copy(from);
    n.line = line || null;
    n.stage = from ? 'walk' : 'aim';
    n.t = 0;
    n.aimReady = false;
    n.yaw = 0;
    n.pitch = 0;
    n.count0 = this._nadeCount(type);
    n.errYaw = gauss() * this.diff.aimError * DEG * 0.35;
    n.errPitch = gauss() * this.diff.aimError * DEG * 0.3;
    this.nade = n;
    this._setState(BOT_STATE.NADE);
  }

  _endNade(thrown) {
    this.nade = null;
    this.nadeCooldown = thrown ? 3.5 + rand(0, 5) : 1.2 + rand(0, 2);
    if (thrown) this.nadesThrown++;
    this._setState(BOT_STATE.IDLE);
    this._tThink = 0;                                   // re-decide immediately
  }

  /**
   * Solve the throw.  `game.grenades.solveThrow` is authoritative when it agrees
   * with the raw geometry; otherwise the local ballistic fallback is used so a
   * different angle convention can never make the bot throw backwards.
   */
  _solveNade(n) {
    const a = this.actor;
    const eye = a.eye || a.pos;
    const dx = n.to.x - eye.x, dz = n.to.z - eye.z;
    const flat = Math.hypot(dx, dz);
    const geoYaw = Math.atan2(dz, dx);
    const speed = NADE_SPEED[n.type] || 21;
    // Local solve: flat trajectory under gravity, low arc.
    const dy = n.to.y - eye.y;
    const g2 = PHYS.gravity;
    let pitch = -Math.atan2(dy, Math.max(0.5, flat));
    const v2 = speed * speed;
    const disc = v2 * v2 - g2 * (g2 * flat * flat + 2 * dy * v2);
    if (disc >= 0 && flat > 0.5) {
      const theta = Math.atan((v2 - Math.sqrt(disc)) / (g2 * flat));   // flat arc
      pitch = -theta;
    } else {
      pitch = -0.6;                                     // out of range: lob it
    }
    let yaw = geoYaw, ok = true;
    const gs = this.game.grenades;
    if (gs && typeof gs.solveThrow === 'function') {
      try {
        const s = gs.solveThrow(eye, n.to, speed);
        if (s && Number.isFinite(s.yaw) && Number.isFinite(s.pitch)) {
          if (Math.abs(angleDiff(s.yaw, geoYaw)) < 0.35) { yaw = s.yaw; pitch = s.pitch; }
          ok = s.ok !== false;
        }
      } catch (e) { /* fall back to the local solve */ }
    }
    n.yaw = angleWrap(yaw + n.errYaw);
    n.pitch = clamp(pitch + n.errPitch + (n.line ? num(n.line.pitchBias, 0) : 0), -1.5, 1.5);
    n.aimReady = true;
    return ok;
  }

  _sayNade(type) {
    if (type === 'flash') this._say('flashout', 0.9);
    else if (type === 'smoke') this._say('smokeout', 0.7);
    else this._say('fireinhole', 0.85);
  }

  _stNade(dt, c) {
    const n = this.nade;
    if (!n) { this._stIdle(dt, c); return; }
    const a = this.actor;
    n.t += dt;
    if (n.t > 7) { this._endNade(false); return; }             // never hang here
    if (n.stage !== 'throw' && this.target && this.target.visible
      && this.target.dist < 8) { this._endNade(false); return; }
    if (n.stage === 'walk') {
      const d = a.pos.distanceTo(n.from);
      if (d < 1.2 || n.t > 4) { n.stage = 'aim'; n.t = 0; }
      else {
        this._sub = 'nadewalk';
        this._setGoal(n.from, 'nade');
        this._moveAlong(dt, c, CREEP_OPT);
        this._lookAhead(dt);
        return;
      }
    }
    const held = itemId(a.active) === n.type;
    if (n.stage === 'aim') {
      this._sub = 'nadeaim';
      this._wantMove = false;
      c.walk = true;
      if (!held) c.switchTo = n.type;
      if (!n.aimReady && !this._solveNade(n) && n.t > 0.5) { this._endNade(false); return; }
      const err = Math.hypot(angleDiff(a.yaw, n.yaw), angleDiff(a.pitch, n.pitch));
      if (held && (err < 0.025 || n.t > 1.8)) {
        if (!this._nadeSafe(n.type, n.to)) { this._endNade(false); return; }
        n.stage = 'throw';
        n.t = 0;
        this._sayNade(n.type);
      }
      return;
    }
    // Release, then confirm from the inventory that it actually left our hand.
    this._sub = 'nadethrow';
    this._wantMove = false;
    c.attack = n.t < 0.18;
    if (n.t > 0.6) this._endNade(this._nadeCount(n.type) < n.count0);
  }

  // =========================================================================
  // event callbacks (driven by the game)
  // =========================================================================
  onDamage(info) {
    const a = this.actor;
    const now = num(this.game.time, 0);
    const attacker = info && info.attacker;
    this.hurtT = now;
    if (attacker && attacker.team !== a.team) this._hurtBy = attacker;
    // Face the shot: the direction it came from becomes the threat direction.
    if (info && vecOk(info.dir)) {
      this.threatDir.set(-info.dir.x, 0, -info.dir.z);
      if (this.threatDir.lengthSq() < 1e-6) this.threatDir.set(1, 0, 0);
      this.threatDir.normalize();
    } else if (attacker) {
      this.threatDir.subVectors(attacker.pos, a.pos).setY(0);
      if (this.threatDir.lengthSq() > 1e-6) this.threatDir.normalize();
    }
    if (attacker && attacker.alive && attacker.team !== a.team) {
      const m = this._memo(attacker);
      if (!m.visible) {
        // Shot from an unseen angle: remember roughly where, then turn on it.
        m.lastKnownPos.copy(attacker.pos);
        m.lastSeenTime = now - 0.05;
        m.fresh = true;
        m.viaIntel = true;
        m.dist = a.distTo ? a.distTo(attacker) : a.pos.distanceTo(attacker.pos);
        this.noisePos.copy(attacker.pos);
        this.noiseT = now;
        this.noiseKind = 'shoot';
        if (this.reactionT <= 0) this._rollReaction(m);
      }
    }
    const co = this.coordinator;
    if (co && typeof co.report === 'function') {
      co.report('hurt', { actor: a, amount: num(info && info.amount, 0), attacker, pos: a.pos });
    }
    if (num(a.health, 100) < 45) this._say('imhit', 0.35);
    // A bad trade forces a rethink on the next tick.
    this._tThink = 0;
  }

  onEnemySpotted(enemy, spotter) {
    if (!enemy || !enemy.alive || enemy.team === this.actor.team) return;
    const now = num(this.game.time, 0);
    if (spotter && spotter !== this.actor && !chance(0.35 + 0.65 * this.diff.teamwork)) return;
    const m = this._memo(enemy);
    if (m.visible) return;
    if (now <= m.lastSeenTime) return;
    m.lastKnownPos.copy(enemy.pos);
    m.lastSeenTime = now;
    m.fresh = true;
    m.viaIntel = spotter !== this.actor;
    m.dist = this.actor.pos.distanceTo(enemy.pos);
    const w = this.game.world;
    m.area = w && w.areaAt ? w.areaAt(enemy.pos) : m.area;
  }

  onBombPlanted(site, pos) {
    this.fakeBudget = 1.2;                    // one short bluff per planted bomb
    const now = num(this.game.time, 0);
    if (site) this.bombSite = site;
    if (toVec(this.bombPos, pos)) this.hasBombPos = true;
    this._hasPP = false;
    this._defuseCall = false;
    this._usedLines.length = 0;                    // retake / post-plant utility
    this.nadeCooldown = Math.min(this.nadeCooldown, 1.5);
    this.noiseT = now;
    if (this.hasBombPos) { this.noisePos.copy(this.bombPos); this.noiseKind = 'plant'; }
    if (this.actor.team === TEAM.T) this._say('bombplanted', 0.3);
    else this._say(site === 'B' ? 'rotate_b' : 'rotate_a', 0.4);
    const co = this.coordinator;
    if (co && typeof co.report === 'function') co.report('plant', { site, pos, by: this.actor });
    this._tThink = 0;
  }

  onBombDropped(pos) {
    if (toVec(this.bombPos, pos)) this.hasBombPos = true;
    const co = this.coordinator;
    if (co && typeof co.report === 'function') co.report('bomb_dropped', { pos, by: this.actor });
    this._tThink = 0;
  }

  onFlashed(amount) {
    const amt = num(amount, 0);
    if (amt <= 0.05) return;
    this.flashT = amt * 2.5;
    this._blindPlanned = false;
    this.burstLeft = 0;
    if (amt > 0.35) {
      this._setState(BOT_STATE.BLIND);
      this.reactionT = Math.max(this.reactionT, 0.12 + amt * 0.25);
      if (this.target) this.target.visible = false;
    }
    this._tThink = 0;
  }

  onTeammateDown(actor) {
    if (!actor || actor === this.actor) return;
    const now = num(this.game.time, 0);
    const d = this.actor.pos.distanceTo(actor.pos);
    const co = this.coordinator;
    if (co && typeof co.report === 'function') co.report('down', { actor, pos: actor.pos });
    if (d < 22) {                                  // he died to something near me
      if (now - this.noiseT > 1.5) {
        this.noisePos.copy(actor.pos);
        this.noiseT = now;
        this.noiseKind = 'shoot';
      }
      this._say('needbackup', 0.25);
    }
    if (actor.hasBomb || (this.actor.team === TEAM.T && !this._anyoneCarrying())) {
      this.hasBombPos = true;
      this.bombPos.copy(actor.pos);
    }
    this._tThink = 0;
  }
}
export default Bot;
