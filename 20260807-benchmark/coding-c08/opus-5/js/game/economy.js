// ============================================================================
// game/economy.js — CS:GO money rules: round payouts, the loss-bonus ladder,
// buy validation, purchases, and the bot buy planner.
//
// Pure logic: no DOM, no rendering, no events.  Callers own the side effects —
// game.js#runBuy emits `buy`, round.js applies the deltas roundEndMoney returns.
// ============================================================================

import { MONEY, PHASE, TEAM, OTHER_TEAM, SLOT, PLAYER, ROLE } from '../core/constants.js';
import { clamp } from '../core/util.js';
import {
  getWeapon, isGrenade, killReward, GRENADE_IDS, GRENADE_LIMITS, MAX_GRENADES,
  HELMET_UPGRADE_PRICE,
} from './weapons.js';

// One implementation of the kill payout, re-exported so callers can take it
// from either module (game.js imports it from weapons.js).
export { killReward };

/** Round-win payout per end reason. */
export const WIN_REWARD = {
  elimination: MONEY.winElimination,
  detonate: MONEY.winBombDetonate,
  defuse: MONEY.winBombDefuse,
  timeout: MONEY.winTimeout,
};

// round.js reports 'elim' / 'time' / 'defuse' / 'detonate'; accept the obvious
// synonyms too so any caller lands on a real payout.
const REASON_ALIAS = {
  elim: 'elimination', elimination: 'elimination', kills: 'elimination',
  wipe: 'elimination', eliminated: 'elimination',
  detonate: 'detonate', bomb: 'detonate', explode: 'detonate',
  bomb_explode: 'detonate', exploded: 'detonate',
  defuse: 'defuse', defused: 'defuse',
  time: 'timeout', timeout: 'timeout', timeup: 'timeout', time_up: 'timeout',
};

/** Normalise a round-end reason into a WIN_REWARD key. */
export function winReason(reason) {
  return REASON_ALIAS[String(reason || '').toLowerCase()] || 'elimination';
}

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// ---------------------------------------------------------------------------
// Shape adapters — every entry point accepts a Game, a Match or a bare array so
// the module is usable from tests and tools, not just from game.js.
// ---------------------------------------------------------------------------
/** @returns {Array} the actor roster. */
function actorsOf(src) {
  if (!src) return [];
  if (Array.isArray(src)) return src;
  if (Array.isArray(src.actors)) return src.actors;
  if (Array.isArray(src.players)) return src.players;
  if (src.game) return actorsOf(src.game);
  if (src.match) return actorsOf(src.match);
  return [];
}

/** @returns {Object} the match/round state (a Game exposes it as `.match`). */
function matchOf(src) {
  if (!src || typeof src !== 'object') return {};
  if (src.match && typeof src.match === 'object') return src.match;
  return src;
}

/** Weapon id living in a slot: handles instances `{id,…}`, plain ids and null. */
function slotId(actor, slot) {
  const inv = actor && actor.inv;
  const v = inv ? inv[slot] : actor && actor[slot];
  if (!v) return null;
  return typeof v === 'string' ? v : v.id || null;
}

/** How many grenades the actor carries (of one id, or in total). */
function grenadeCount(actor, id = null) {
  const list = (actor && actor.inv && actor.inv.grenades) || (actor && actor.grenades) || null;
  let n = 0;
  if (Array.isArray(list)) {
    for (const g of list) {
      if (!g) continue;
      const gid = typeof g === 'string' ? g : g.id;
      if (id && gid !== id) continue;
      n += typeof g === 'string' ? 1 : num(g.count, 1);
    }
  } else if (list && typeof list === 'object') {
    for (const k of Object.keys(list)) {
      if (id && k !== id) continue;
      n += num(list[k], 0);
    }
  }
  return n;
}

const hasKit = (a) => !!(a && (a.kit || a.hasDefuseKit || a.defuseKit));

/** Deterministic 0..1 per actor per round — variety without breaking replays. */
function seedFor(actor, round) {
  const s = `${(actor && (actor.id || actor.name)) || 'a'}#${round}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

/** Round 1 of each half. */
export function isPistolRound(match) {
  const m = matchOf(match);
  const round = num(m.round, 1);
  const halfAt = num(m.halfAt, Math.floor(num(m.maxRounds, 24) / 2));
  return round <= 1 || round === halfAt + 1;
}

/** Cash everybody starts a half with. */
export function startMoney(match) {
  const m = matchOf(match);
  return clamp(num(m.startMoney, MONEY.start), 0, MONEY.max);
}

/**
 * Halftime: sides swapped, so the economy restarts.  Weapons are wiped by
 * round.js#swapSides; this only owns money and the gear flags (idempotent).
 */
export function applyHalftimeReset(actors) {
  const list = actorsOf(actors);
  const start = MONEY.start;
  for (const a of list) {
    if (!a) continue;
    a.money = start;
    a.armor = 0;
    a.helmet = false;
    a.kit = false;
    if (a.hasDefuseKit !== undefined) a.hasDefuseKit = false;
    if (a.defuseKit !== undefined) a.defuseKit = false;
    a.spent = 0;
    if (typeof a.clearInventory === 'function') a.clearInventory();
  }
  return list;
}

/** Total cash held by one side. */
export function teamMoney(game, team) {
  let sum = 0;
  for (const a of actorsOf(game)) if (a && a.team === team) sum += num(a.money, 0);
  return sum;
}

/**
 * What the side can afford this round, for the HUD and for the bots:
 *   'full'  — rifles + armour + utility for everyone
 *   'force' — rifle-less buy: SMGs / cheap rifles, armour first
 *   'eco'   — half buy: armour or a pistol, bank the rest
 *   'save'  — buy nothing, keep the cash for a real buy next round
 * A kept primary counts as ~$2000 of spending power, so a team that saved its
 * rifles does not read as an eco.
 */
export function economyState(game, team) {
  const roster = actorsOf(game).filter((a) => a && a.team === team);
  if (!roster.length) return 'save';
  let total = 0;
  for (const a of roster) {
    total += num(a.money, 0);
    if (slotId(a, SLOT.PRIMARY)) total += 2000;
  }
  const avg = total / roster.length;
  if (avg >= 4300) return 'full';
  if (avg >= 2300) return 'force';
  if (avg >= 1300) return 'eco';
  return 'save';
}

/** Price after the CS kevlar → helmet upgrade discount. */
export function priceFor(actor, id) {
  const def = getWeapon(id);
  if (!def) return 0;
  if (id === 'kevlarhelmet' && num(actor && actor.armor, 0) > 0 && !(actor && actor.helmet)) {
    return HELMET_UPGRADE_PRICE;
  }
  return num(def.price, 0);
}

/** True while the buy window is open (round.js exposes `isBuyTime`). */
export function buyWindowOpen(match) {
  const m = matchOf(match);
  if (!m || typeof m !== 'object') return true;
  if (m.buyAnywhere || m.warmup) return true;
  if (typeof m.isBuyTime === 'boolean') return m.isBuyTime;
  const live = m.phase === undefined || m.phase === PHASE.FREEZE || m.phase === PHASE.LIVE;
  if (typeof m.buyTimeLeft === 'number') return live && m.buyTimeLeft > 0;
  if (typeof m.buyLeft === 'number') return live && m.buyLeft > 0;
  return live;
}

// Buy zones are only enforced once something in the game actually maintains
// `actor.inBuyZone` (it starts false and no module sets it yet, so enforcing it
// unconditionally would make the whole buy menu dead).  `match.enforceBuyZone`
// overrides the auto-detection either way.
let _zoneFlagSeen = false;
function zoneOk(actor, match) {
  if (actor && actor.inBuyZone === true) { _zoneFlagSeen = true; return true; }
  const m = matchOf(match);
  const forced = m && typeof m.enforceBuyZone === 'boolean' ? m.enforceBuyZone : null;
  return !(forced === null ? _zoneFlagSeen : forced);
}

/**
 * May `actor` buy `id` right now?
 *
 * Buying a primary while already holding one is legal — the old gun is dropped
 * by Actor#giveWeapon — so it never reports 'slot'.
 *
 * @returns {{ok:boolean, reason:'money'|'team'|'time'|'zone'|'slot'|'limit'|null,
 *            price:number}}
 */
export function canBuy(actor, id, match) {
  const def = getWeapon(id);
  const price = priceFor(actor, id);
  const fail = (reason) => ({ ok: false, reason, price });
  if (!def || num(def.price, 0) <= 0) return fail('slot');   // knife and C4 are issued
  if (!actor) return fail('slot');
  if (actor.alive === false) return fail('time');
  if (!buyWindowOpen(match)) return fail('time');
  if (!zoneOk(actor, match)) return fail('zone');
  if (def.team && actor.team && def.team !== actor.team) return fail('team');
  const armor = num(actor.armor, 0);
  if (id === 'kevlar' && armor >= PLAYER.maxArmor) return fail('limit');
  if (id === 'kevlarhelmet' && armor >= PLAYER.maxArmor && actor.helmet) return fail('limit');
  if (id === 'defusekit' && hasKit(actor)) return fail('limit');
  if (isGrenade(id)) {
    if (grenadeCount(actor) >= MAX_GRENADES) return fail('limit');
    if (grenadeCount(actor, id) >= num(GRENADE_LIMITS[id], 1)) return fail('limit');
  }
  if (num(actor.money, 0) < price) return fail('money');
  return { ok: true, reason: null, price };
}

/**
 * Perform a purchase: deduct the money and hand the item to the actor.
 * Actor#giveWeapon owns the inventory rules (gear flags, grenade stacking, and
 * dropping the replaced gun) and reports the dropped id.  Emits nothing.
 *
 * @returns {{ok:boolean, dropped:string|null, reason:string|null, price:number}}
 */
export function buy(actor, id, game) {
  const chk = canBuy(actor, id, matchOf(game));
  if (!chk.ok) return { ok: false, dropped: null, reason: chk.reason, price: chk.price };
  const def = getWeapon(id);
  actor.money = Math.max(0, num(actor.money, 0) - chk.price);
  actor.spent = num(actor.spent, 0) + chk.price;
  let dropped = null;
  if (typeof actor.giveWeapon === 'function') {
    const res = actor.giveWeapon(id);
    dropped = typeof res === 'string' ? res : (res && res.id) || null;
  } else {
    dropped = applyItemFallback(actor, id, def);
  }
  return { ok: true, dropped, reason: null, price: chk.price };
}

/**
 * Minimal inventory application for objects that are not a full Actor (unit
 * tests, headless simulations).  Mirrors Actor#giveWeapon closely enough for
 * the economy to stay consistent.
 * @returns {string|null} the id that was dropped to make room.
 */
function applyItemFallback(actor, id, def) {
  if (id === 'kevlar' || id === 'kevlarhelmet') {
    actor.armor = PLAYER.maxArmor;
    if (id === 'kevlarhelmet') actor.helmet = true;
    return null;
  }
  if (id === 'defusekit') { actor.kit = true; return null; }
  if (!actor.inv) actor.inv = { primary: null, secondary: null, knife: null, grenades: [], bomb: false };
  if (!Array.isArray(actor.inv.grenades)) actor.inv.grenades = [];
  if (def.slot === SLOT.GRENADE) {
    const have = actor.inv.grenades.find((g) => g && g.id === id);
    if (have) have.count = num(have.count, 1) + 1;
    else actor.inv.grenades.push({ id, def, count: 1, ammo: 1, reserve: 0 });
    return null;
  }
  const slot = def.slot === SLOT.SECONDARY ? SLOT.SECONDARY : SLOT.PRIMARY;
  const old = slotId(actor, slot);
  actor.inv[slot] = { id, def, ammo: def.mag, reserve: def.reserve };
  return old && old !== id ? old : null;
}

/** Did a bomb get planted this round?  `plantedBy` is sticky, so avoid it. */
function bombWasPlanted(m, reasonKey) {
  if (reasonKey === 'detonate' || reasonKey === 'defuse') return true;
  if (!m) return false;
  if (m.bombPlanted === true || m.planted === true) return true;
  const bomb = (m.game && m.game.bomb) || m.bomb;
  if (bomb && typeof bomb.state === 'string') {
    return bomb.state === 'planted' || bomb.state === 'defused' || bomb.state === 'exploded';
  }
  if (m.phase === PHASE.PLANTED) return true;
  return false;
}

/** Resolve an actor reference that may be an object, an id or a name. */
function resolveActor(ref, list) {
  if (!ref) return null;
  if (typeof ref === 'object') return ref;
  for (const a of list) if (a && (a.id === ref || a.name === ref)) return a;
  return null;
}

/**
 * Advance the loss-bonus ladder and return the loser's step (1..5, an index+1
 * into MONEY.lossBonus).  As in CS:GO a win moves a team one step *down* the
 * ladder instead of resetting it, and each half starts a fresh ladder.
 *
 * `match.lossStreak` is stored as "consecutive losses, 1..5".  When the match
 * keeps a `history` the counters are recomputed from it, which makes this
 * idempotent: round.js bumps `lossStreak` itself just before calling us and
 * both paths land on the same numbers.
 */
function updateLossLadder(m, winner, loser) {
  const steps = MONEY.lossBonus.length;
  if (!m.lossStreak || typeof m.lossStreak !== 'object') m.lossStreak = { T: 0, CT: 0 };
  const ls = m.lossStreak;
  if (Array.isArray(m.history)) {
    const halfAt = num(m.halfAt, Math.floor(num(m.maxRounds, 24) / 2));
    const second = num(m.round, 1) > halfAt;
    const c = { T: 0, CT: 0 };
    for (const e of m.history) {
      if (!e || !e.winner) continue;
      if ((num(e.round, 0) > halfAt) !== second) continue;      // ladder resets at halftime
      const w = e.winner;
      const l = OTHER_TEAM[w] || (w === TEAM.T ? TEAM.CT : TEAM.T);
      c[w] = Math.max(0, num(c[w], 0) - 1);
      c[l] = Math.min(steps, num(c[l], 0) + 1);
    }
    ls[loser] = Math.min(steps, num(c[loser], 0) + 1);
    ls[winner] = Math.max(0, num(c[winner], 0) - 1);
  } else {
    // No history to lean on: advance the stored counters directly.
    ls[loser] = Math.min(steps, num(ls[loser], 0) + 1);
    ls[winner] = Math.max(0, num(ls[winner], 0) - 1);
  }
  return clamp(num(ls[loser], 1), 1, steps);
}

/** The payout a team on `step` consecutive losses receives. */
export function lossBonusFor(step) {
  return MONEY.lossBonus[clamp(Math.round(step) - 1, 0, MONEY.lossBonus.length - 1)];
}

/**
 * Round-end payouts.
 *
 * Returns one `{actor, delta, reason}` entry per payment; **money is not
 * mutated** — round.js applies the deltas itself — but every delta is already
 * capped so no actor can pass MONEY.max ($16000).
 *
 * Not included, because they are paid the moment they happen:
 *   • kill rewards (game.js pays them on the kill),
 *   • the planter / defuser $300 (round.js pays them on plant / defuse).
 * Set `match.payObjectiveAtRoundEnd = true` to have them batched here instead.
 *
 * `match.lossStreak` is updated (see updateLossLadder).
 *
 * @param {Object} match   the Match (or any object with round/history/lossStreak)
 * @param {'T'|'CT'|null} winner  null for a draw: nobody is paid
 * @param {string} reason  'elim' | 'time' | 'defuse' | 'detonate' (aliases ok)
 * @param {Array} actors   the full roster (a Game or Match works too)
 */
export function roundEndMoney(match, winner, reason, actors) {
  const m = match && typeof match === 'object' ? match : {};
  const list = actorsOf(actors || m);
  const out = [];
  if (!winner) return out;
  const loser = OTHER_TEAM[winner] || (winner === TEAM.T ? TEAM.CT : TEAM.T);
  const key = winReason(reason);
  const win = num(WIN_REWARD[key], MONEY.winElimination);
  const step = updateLossLadder(m, winner, loser);
  const loss = lossBonusFor(step);
  const plantedBonus = loser === TEAM.T && bombWasPlanted(m, key);

  // Track the projected balance so several payments to one actor still respect
  // the cap (and never push anybody below $0).
  const proj = new Map();
  const pay = (a, amount, why) => {
    if (!a || !amount) return;
    const cur = proj.has(a) ? proj.get(a) : num(a.money, 0);
    const delta = clamp(amount, -cur, Math.max(0, MONEY.max - cur));
    proj.set(a, cur + delta);
    if (delta !== 0) out.push({ actor: a, delta, reason: why });
  };

  for (const a of list) {
    if (!a || !a.team) continue;
    if (a.team === winner) pay(a, win, `win_${key}`);
    else if (a.team === loser) {
      pay(a, loss, 'loss_bonus');
      if (plantedBonus) pay(a, MONEY.tLossWithPlant, 'planted_bonus');
    }
  }

  if (m.payObjectiveAtRoundEnd) {
    const bomb = (m.game && m.game.bomb) || m.bomb || {};
    const planter = resolveActor(m.planter || bomb.planter, list);
    const defuser = resolveActor(m.defuser || bomb.defuser, list);
    if (planter) pay(planter, MONEY.plantReward, 'plant');
    if (defuser) pay(defuser, MONEY.defuseReward, 'defuse');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bot buying
// ---------------------------------------------------------------------------
/** Primaries a bot is happy to keep instead of re-buying on a full-buy round. */
const GOOD_PRIMARY = new Set([
  'ak47', 'm4a4', 'm4a1s', 'aug', 'sg553', 'galil', 'famas', 'awp', 'ssg08', 'p90', 'negev',
]);

function roleOf(a) {
  if (!a) return null;
  return a.role || (a.bot && a.bot.role) || (a.bot && a.bot.assignment && a.bot.assignment.role) || null;
}

/**
 * Should this bot take the AWP?  One AWPer per side: whoever already owns one
 * keeps it, otherwise the assigned AWP role — or the richest player — buys it.
 * Deterministic, so a seeded match replays the same way.
 */
function shouldBuyAwp(actor, game, money) {
  if (money < 4750 + 1000) return false;               // AWP plus armour, or not at all
  const mates = actorsOf(game).filter((a) => a && a.team === actor.team);
  for (const a of mates) {
    if (a === actor) continue;
    if (slotId(a, SLOT.PRIMARY) === 'awp') return false;
    if (roleOf(a) === ROLE.AWP && num(a.money, 0) >= 5750) return false;
  }
  if (roleOf(actor) === ROLE.AWP || actor.preferAwp) return true;
  let best = actor;
  for (const a of mates) {
    if (!a || a === actor) continue;
    const am = num(a.money, 0), bm = num(best.money, 0);
    if (am > bm || (am === bm && String(a.id || '') < String(best.id || ''))) best = a;
  }
  return best === actor;
}

/**
 * Ordered ids a bot should buy this freeze time.  game.js pushes the list
 * through canBuy/buy one at a time, so anything that turns illegal is skipped.
 * The plan never spends money the bot does not have.
 *
 * Models real CS decision making: pistol round armour (+ kit for CT), full save
 * on a broken economy, half buys, force buys, one AWP per side, rifles from
 * ~$4000, and utility bought with whatever is left (flash → smoke → fire → HE).
 */
export function botBuyPlan(actor, game) {
  const plan = [];
  if (!actor || actor.alive === false) return plan;
  const match = matchOf(game);
  const team = actor.team || TEAM.T;
  const isT = team === TEAM.T;
  const rnd = seedFor(actor, num(match.round, 1));
  const state = economyState(game, team);

  // Virtual inventory so the plan stays consistent as it grows.
  let money = num(actor.money, 0);
  let armor = num(actor.armor, 0);
  let helmet = !!actor.helmet;
  let kit = hasKit(actor);
  let primary = slotId(actor, SLOT.PRIMARY);
  let nades = grenadeCount(actor);
  const nadeHave = {};
  for (const id of GRENADE_IDS) nadeHave[id] = grenadeCount(actor, id);

  /** Queue `id` when it is legal, useful, and still leaves `keep` in the bank. */
  const take = (id, keep = 0) => {
    const def = getWeapon(id);
    if (!def || (def.team && def.team !== team)) return false;
    const price = id === 'kevlarhelmet' && armor > 0 && !helmet
      ? HELMET_UPGRADE_PRICE : num(def.price, 0);
    if (price <= 0 || money - price < keep) return false;
    if (id === 'kevlar' && armor >= PLAYER.maxArmor) return false;
    if (id === 'kevlarhelmet' && armor >= PLAYER.maxArmor && helmet) return false;
    if (id === 'defusekit' && kit) return false;
    if (isGrenade(id)) {
      if (nades >= MAX_GRENADES || nadeHave[id] >= num(GRENADE_LIMITS[id], 1)) return false;
      nades++; nadeHave[id]++;
    }
    if (id === 'kevlar' || id === 'kevlarhelmet') {
      armor = PLAYER.maxArmor;
      if (id === 'kevlarhelmet') helmet = true;
    }
    if (id === 'defusekit') kit = true;
    if (def.slot === SLOT.PRIMARY) primary = id;
    money -= price;
    plan.push(id);
    return true;
  };
  const armour = (keep = 0) => take('kevlarhelmet', keep) || take('kevlar', keep);
  // A kit turns a 10 s defuse into 5 s, which decides most post-plants, so every
  // CT wants one; only a bot saving for a rifle skips it.
  const wantKit = !isT;

  // --- pistol round: armour, a kit for CT, then cheap utility --------------
  if (isPistolRound(match)) {
    if (rnd < 0.28 && !primary) take(isT ? 'tec9' : 'p250', 200);
    take('kevlar');
    if (wantKit) take('defusekit');
    take('flash');
    take('smoke', 50);
    return plan;
  }

  // --- broken economy: save everything, at most a cheap pistol -------------
  if (state === 'save') {
    if (!primary && rnd > 0.66) take(isT ? 'tec9' : 'p250', 400);
    return plan;
  }

  // --- eco / half buy: armour or a pistol, never a rifle -------------------
  if (state === 'eco') {
    if (armor <= 0) take('kevlar', 300);
    if (!primary) {
      if (rnd > 0.55) {
        if (!take(isT ? 'mac10' : 'mp9', 300)) take(isT ? 'tec9' : 'p250', 300);
      } else take(isT ? 'tec9' : 'p250', 300);
    }
    take('flash', 500);
    return plan;
  }

  // --- force buy: armour first, then the best gun that still fits ----------
  if (state === 'force') {
    armour(0);
    if (!primary) {
      if (!take(isT ? 'ak47' : 'm4a4')
        && !take(isT ? 'galil' : 'famas')
        && !take('ump45')
        && !take(isT ? 'mac10' : 'mp9')) take(isT ? 'tec9' : 'deagle');
    }
    if (wantKit) take('defusekit');
    take('flash');
    take('smoke');
    return plan;
  }

  // --- full buy ------------------------------------------------------------
  // Short on cash for a rifle + vest? Take the vest first, it wins more duels.
  const rifleBudget = isT ? 3700 : 3900;
  if (money < rifleBudget) armour(0);
  const keepPrimary = primary && GOOD_PRIMARY.has(primary);
  if (!keepPrimary) {
    if (!primary || money >= rifleBudget) {
      if (!(shouldBuyAwp(actor, game, money) && take('awp', 1000))) {
        if (!take(isT ? 'ak47' : (rnd < 0.45 ? 'm4a1s' : 'm4a4'), 1000)
          && !take(isT ? 'galil' : 'famas', 650)
          && !take(isT ? 'mac10' : 'mp9', 300)
          && !primary) take(isT ? 'tec9' : 'p250', 200);
      }
    }
  }
  armour();
  if (wantKit) take('defusekit');
  take('flash');
  take('smoke');
  take(isT ? 'molotov' : 'incendiary');
  take('he');
  take('flash');                     // a second flash when cash and slots allow
  if (rnd > 0.82) take('decoy');
  return plan;
}

