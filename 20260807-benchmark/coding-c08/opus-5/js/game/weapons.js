// ============================================================================
// game/weapons.js — the complete weapon / equipment table plus ballistics maths.
//
// Pure data + pure functions: no DOM, no three.js, no engine imports.  Every id
// in core/api.js WEAPON_IDS is defined here; every `vmArchetype` / `sound`
// string used below comes from the VM_ARCHETYPES / SOUNDS registries there.
//
// Units — damage: HP, distance: metres, time: seconds, rpm: rounds/minute,
// spread: radians at the muzzle (fed straight into the bullet cone),
// recoil: "recoil units" (actor.js scales them by 0.0016 rad ≈ 0.092°/unit).
// ============================================================================

import { WEAPON_IDS, VM_ARCHETYPES } from '../core/api.js';
import { SLOT, HIT_MULT, HITBOX, PLAYER, MONEY } from '../core/constants.js';
import { clamp, clamp01, lerp, gauss, makeRng } from '../core/util.js';

/** Bullets are discarded past this distance. */
export const BULLET_MAX_RANGE = 120;
/** CS armour soaks half of the damage it stops (ArmorBonusRatio). */
export const ARMOR_BONUS = 0.5;
/** Grenades a player may carry at once, plus the per-type cap. */
export const MAX_GRENADES = 4;
export const GRENADE_LIMITS = { flash: 2, he: 1, smoke: 1, molotov: 1, incendiary: 1, decoy: 1 };
export const GRENADE_IDS = ['he', 'flash', 'smoke', 'molotov', 'incendiary', 'decoy'];
export const GEAR_IDS = ['kevlar', 'kevlarhelmet', 'defusekit'];
/** Kevlar+helmet only charges for the helmet when a vest is already worn. */
export const HELMET_UPGRADE_PRICE = 350;

// ---------------------------------------------------------------------------
// Recoil patterns — 30 authored shots each.  `y` is upward kick in 0..1 of
// recoil.v, `x` sideways drift in -1..1 of recoil.h.  getRecoil() scales them
// and adds a little noise so no two sprays come out identical.
// ---------------------------------------------------------------------------
const PAT_LEN = 30;

/** AK-47: fast climb, the classic left pull, then a wide sweep right. */
const PAT_AK = [
  [0.00, 0.30], [0.05, 0.62], [-0.06, 0.82], [0.10, 0.92], [-0.14, 1.00],
  [-0.30, 0.96], [-0.46, 0.88], [-0.58, 0.80], [-0.62, 0.72], [-0.50, 0.66],
  [-0.28, 0.62], [0.02, 0.58], [0.30, 0.56], [0.54, 0.54], [0.70, 0.52],
  [0.76, 0.50], [0.70, 0.50], [0.52, 0.48], [0.26, 0.48], [-0.02, 0.46],
  [-0.26, 0.46], [-0.44, 0.44], [-0.52, 0.44], [-0.46, 0.42], [-0.30, 0.42],
  [-0.06, 0.40], [0.20, 0.40], [0.42, 0.38], [0.56, 0.38], [0.60, 0.36],
];

/** M4A4: tighter vertical climb, a modest drift right, then a soft S curve. */
const PAT_M4 = [
  [0.00, 0.26], [0.03, 0.52], [-0.04, 0.70], [0.06, 0.82], [0.12, 0.88],
  [0.20, 0.90], [0.28, 0.86], [0.34, 0.80], [0.36, 0.74], [0.32, 0.68],
  [0.22, 0.62], [0.08, 0.58], [-0.08, 0.54], [-0.22, 0.52], [-0.30, 0.50],
  [-0.32, 0.48], [-0.26, 0.46], [-0.14, 0.46], [0.02, 0.44], [0.18, 0.44],
  [0.30, 0.42], [0.38, 0.42], [0.40, 0.40], [0.34, 0.40], [0.22, 0.38],
  [0.08, 0.38], [-0.06, 0.36], [-0.18, 0.36], [-0.26, 0.34], [-0.28, 0.34],
];

/** Bullpup family (FAMAS / AUG): almost pure vertical, tiny right lean. */
const PAT_BULLPUP = [
  [0.00, 0.24], [0.02, 0.50], [0.05, 0.68], [0.09, 0.80], [0.13, 0.88],
  [0.16, 0.92], [0.18, 0.88], [0.17, 0.82], [0.13, 0.76], [0.07, 0.70],
  [0.00, 0.64], [-0.07, 0.60], [-0.13, 0.56], [-0.17, 0.54], [-0.18, 0.52],
  [-0.15, 0.50], [-0.10, 0.48], [-0.03, 0.46], [0.05, 0.46], [0.12, 0.44],
  [0.17, 0.44], [0.19, 0.42], [0.17, 0.42], [0.12, 0.40], [0.05, 0.40],
  [-0.02, 0.38], [-0.09, 0.38], [-0.14, 0.36], [-0.17, 0.36], [-0.16, 0.34],
];

/** Re-shape an authored pattern for a relative (scale + a slow sine twist). */
function shapePat(src, sx, sy, twist = 0) {
  return src.map(([x, y], i) => [
    x * sx + Math.sin((i / PAT_LEN) * Math.PI * 2) * twist,
    y * sy,
  ]);
}

/** Deterministic small-random pattern: SMGs, auto shotguns, machine guns. */
function noisyPat(seed, h = 0.55, tail = 0.6, rise = 0.34) {
  const rng = makeRng(seed);
  const out = [];
  for (let i = 0; i < PAT_LEN; i++) {
    const t = i / (PAT_LEN - 1);
    const climb = Math.min(1, rise + t * 1.9) * lerp(1, tail, t);
    out.push([(rng() * 2 - 1) * h, climb]);
  }
  return out;
}

/** One violent kick that settles slightly: semis, shotguns, bolt snipers. */
function kickPat(h = 0.2) {
  const out = [];
  for (let i = 0; i < PAT_LEN; i++) {
    const t = i / (PAT_LEN - 1);
    out.push([(i % 2 ? h : -h) * (0.5 + t), lerp(1, 0.64, t)]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-class base cones, in radians at the muzzle.  `stand`/`crouch` are the
// steady-state accuracy; `move`/`air`/`jump` are the (much larger) cones while
// the shooter is not planted.  spreadFor() blends them.
// ---------------------------------------------------------------------------
const SPREAD = {
  pistol:    { stand: 0.00210, crouch: 0.00160, move: 0.0140, air: 0.036, jump: 0.045 },
  pistolBig: { stand: 0.00170, crouch: 0.00130, move: 0.0200, air: 0.045, jump: 0.056 },
  smg:       { stand: 0.00240, crouch: 0.00180, move: 0.0100, air: 0.030, jump: 0.038 },
  rifle:     { stand: 0.00090, crouch: 0.00065, move: 0.0200, air: 0.050, jump: 0.062 },
  bullpup:   { stand: 0.00085, crouch: 0.00060, move: 0.0190, air: 0.047, jump: 0.058 },
  sniper:    { stand: 0.00070, crouch: 0.00050, move: 0.0550, air: 0.090, jump: 0.110 },
  shotgun:   { stand: 0.00600, crouch: 0.00480, move: 0.0160, air: 0.040, jump: 0.050 },
  lmg:       { stand: 0.00260, crouch: 0.00190, move: 0.0380, air: 0.070, jump: 0.085 },
  none:      { stand: 0, crouch: 0, move: 0, air: 0, jump: 0 },
};

/** Fallbacks merged under every `grenade` block (grenades.js reads these). */
const GRENADE_DEFAULTS = {
  kind: 'he', fuse: 1.6, radius: 5, damage: 0, throwSpeed: 21, bounce: 0.4, life: 1.6,
};

/** Every field a definition carries; each weapon overrides what it needs. */
const DEFAULTS = {
  team: null, price: 0, killReward: 300,
  damage: 0, armorPen: 0.5, falloff: 0.85, range: 40, penetration: 1,
  rpm: 300, auto: false, burst: false,
  mag: 0, reserve: 0, reloadTime: 0, reloadType: 'mag',
  spread: SPREAD.rifle, firstShotMult: 1, recovery: 0.30,
  recoil: { v: 40, h: 20, pattern: null },
  hsMult: 1, moveSpeed: 1,
  // `speed` is an exponential damp RATE (1/s) — actor.js feeds it to damp().
  ads: { type: 'none', fov: [90], speed: 14, moveSpeed: 1 },
  adsSpreadMult: 1,      // steady-cone multiplier while aiming / scoped
  hipMult: 1,            // steady-cone multiplier while a scoped gun is hip-fired
  bloom: 0.32,           // extra steady cone per shot already in the spray
  unscopeAfterShot: false,
  pellets: 1, pelletSpread: 0,
  tracer: true, shellEject: true, silenced: false,
  vmArchetype: null, sound: 'shoot_rifle', deploySound: 'deploy', killIcon: null,
  deployTime: 0.55, grenade: null, desc: '',
};

/**
 * Build one definition: merge over DEFAULTS, deep-copy the nested blocks so no
 * two weapons share tables, derive `cycle`, then assert the contract.
 */
function W(id, o) {
  const d = {
    id,
    ...DEFAULTS,
    ...o,
    spread: { ...(o.spread || DEFAULTS.spread) },
    recoil: { ...DEFAULTS.recoil, ...(o.recoil || {}) },
    ads: {
      ...DEFAULTS.ads,
      ...(o.ads || {}),
      fov: [...((o.ads && o.ads.fov) || DEFAULTS.ads.fov)],
    },
    grenade: o.grenade ? { ...GRENADE_DEFAULTS, ...o.grenade } : null,
  };
  if (!d.recoil.pattern) d.recoil.pattern = kickPat(0.2);
  d.cycle = 60 / Math.max(1, d.rpm);          // seconds between shots
  for (const k of ['name', 'cn', 'slot', 'kind', 'price', 'damage']) {
    if (d[k] === undefined) throw new Error(`weapons.js: ${id} is missing "${k}"`);
  }
  if (d.recoil.pattern.length !== PAT_LEN) {
    throw new Error(`weapons.js: ${id} recoil pattern must hold ${PAT_LEN} shots`);
  }
  return d;
}

// ---------------------------------------------------------------------------
// The table.  Prices / kill rewards / damage follow CS:GO; `cn` is what the UI
// shows.  Kill rewards: rifles & pistols 300, SMGs 600 (P90 300), shotguns 900,
// AWP 100, knife 1500.
// ---------------------------------------------------------------------------
export const WEAPONS = {
  // --- knife + objective ---------------------------------------------------
  knife: W('knife', {
    name: 'Knife', cn: '匕首 · 近战', slot: SLOT.KNIFE, kind: 'knife',
    price: 0, killReward: 1500, damage: 42, armorPen: 0.85, falloff: 1.0,
    range: 1.4, penetration: 0, rpm: 150, mag: 0, reserve: 0,
    spread: SPREAD.none, recovery: 0.20, recoil: { v: 0, h: 0, pattern: kickPat(0) },
    moveSpeed: 1.0, tracer: false, shellEject: false, deployTime: 0.4,
    vmArchetype: 'knife', sound: 'knife_swing', killIcon: 'knife',
    // combat.js#knifeAttack owns the numbers; kept here for the HUD / bots.
    stab: { damage: 65, backDamage: 195, slashBack: 90, time: 1.1, sound: 'knife_stab' },
    desc: '默认近战武器，背后捅刺一击致命，持刀移动速度最快。',
  }),

  c4: W('c4', {
    name: 'C4 Explosive', cn: 'C4 炸药 · 爆破目标', slot: SLOT.BOMB, kind: 'bomb',
    team: 'T', price: 0, killReward: 0, damage: 0, armorPen: 1, range: 15,
    penetration: 0, rpm: 60, mag: 1, reserve: 0, spread: SPREAD.none,
    recoil: { v: 0, h: 0, pattern: kickPat(0) }, moveSpeed: 0.98,
    tracer: false, shellEject: false, deployTime: 0.7,
    vmArchetype: 'c4', sound: 'bomb_plant_start', killIcon: 'c4',
    grenade: { kind: 'he', fuse: 40, radius: 22, damage: 500, throwSpeed: 0, bounce: 0.1, life: 40 },
    desc: '恐怖分子的爆破目标：安放需 3.2 秒，引爆倒计时 40 秒。',
  }),

  // --- pistols -------------------------------------------------------------
  glock: W('glock', {
    name: 'Glock-18', cn: 'Glock-18 · 手枪', slot: SLOT.SECONDARY, kind: 'pistol',
    team: 'T', price: 200, killReward: 300, damage: 30, armorPen: 0.50,
    falloff: 0.78, range: 22, penetration: 1.0, rpm: 400, auto: false, burst: 3,
    mag: 20, reserve: 120, reloadTime: 2.2, spread: SPREAD.pistol,
    firstShotMult: 0.92, recovery: 0.26, bloom: 0.30,
    recoil: { v: 30, h: 16, pattern: noisyPat(1101, 0.42, 0.7, 0.42) },
    moveSpeed: 0.96, deployTime: 0.5, vmArchetype: 'pistol',
    sound: 'shoot_pistol', killIcon: 'glock',
    desc: 'T 方起始手枪，可切三连发，伤害偏低但弹匣大、开火快。',
  }),

  usp: W('usp', {
    name: 'USP-S', cn: 'USP-S · 消音手枪', slot: SLOT.SECONDARY, kind: 'pistol',
    team: 'CT', price: 200, killReward: 300, damage: 35, armorPen: 0.505,
    falloff: 0.78, range: 25, penetration: 1.0, rpm: 352, mag: 12, reserve: 24,
    reloadTime: 2.2, spread: SPREAD.pistol, firstShotMult: 0.80, recovery: 0.28,
    recoil: { v: 34, h: 12, pattern: kickPat(0.18) }, moveSpeed: 0.96,
    silenced: true, deployTime: 0.5, vmArchetype: 'pistol_silenced',
    sound: 'shoot_silenced', killIcon: 'usp',
    desc: 'CT 方起始手枪，消音精准，无头盔一枪爆头。',
  }),

  p250: W('p250', {
    name: 'P250', cn: 'P250 · 手枪', slot: SLOT.SECONDARY, kind: 'pistol',
    price: 300, killReward: 300, damage: 38, armorPen: 0.645, falloff: 0.70,
    range: 18, penetration: 1.1, rpm: 400, mag: 13, reserve: 26, reloadTime: 2.2,
    spread: SPREAD.pistol, firstShotMult: 0.84, recovery: 0.28,
    recoil: { v: 38, h: 14, pattern: kickPat(0.2) }, moveSpeed: 0.96,
    deployTime: 0.5, vmArchetype: 'pistol', sound: 'shoot_pistol', killIcon: 'p250',
    desc: '经济局常客：近距离对有甲目标伤害可观，但衰减很快。',
  }),

  deagle: W('deagle', {
    name: 'Desert Eagle', cn: '沙漠之鹰 · 手枪', slot: SLOT.SECONDARY, kind: 'pistol',
    price: 700, killReward: 300, damage: 63, armorPen: 0.925, falloff: 0.88,
    range: 32, penetration: 2.2, rpm: 267, mag: 7, reserve: 35, reloadTime: 2.2,
    spread: SPREAD.pistolBig, firstShotMult: 0.72, recovery: 0.42, bloom: 0.55,
    recoil: { v: 92, h: 26, pattern: kickPat(0.26) }, moveSpeed: 0.92,
    deployTime: 0.6, vmArchetype: 'pistol_big', sound: 'shoot_pistol_big',
    killIcon: 'deagle',
    desc: '一枪爆头的大口径手枪，后坐力巨大，必须站定点射。',
  }),

  tec9: W('tec9', {
    name: 'Tec-9', cn: 'Tec-9 · 手枪', slot: SLOT.SECONDARY, kind: 'pistol',
    team: 'T', price: 500, killReward: 300, damage: 33, armorPen: 0.75,
    falloff: 0.68, range: 16, penetration: 1.1, rpm: 500, mag: 18, reserve: 90,
    reloadTime: 2.3, spread: SPREAD.pistol, firstShotMult: 0.90, recovery: 0.26,
    bloom: 0.34, recoil: { v: 40, h: 22, pattern: noisyPat(1203, 0.5, 0.72, 0.44) },
    moveSpeed: 0.96, deployTime: 0.5, vmArchetype: 'pistol',
    sound: 'shoot_pistol', killIcon: 'tec9',
    desc: 'T 方连发手枪：射速极快、跑打不虚，强起局的近身利器。',
  }),

  fiveseven: W('fiveseven', {
    name: 'Five-SeveN', cn: 'FN 57 · 手枪', slot: SLOT.SECONDARY, kind: 'pistol',
    team: 'CT', price: 500, killReward: 300, damage: 32, armorPen: 0.96,
    falloff: 0.80, range: 26, penetration: 1.5, rpm: 353, mag: 20, reserve: 100,
    reloadTime: 2.7, spread: SPREAD.pistol, firstShotMult: 0.84, recovery: 0.28,
    recoil: { v: 36, h: 14, pattern: kickPat(0.16) }, moveSpeed: 0.96,
    deployTime: 0.5, vmArchetype: 'pistol', sound: 'shoot_pistol',
    killIcon: 'fiveseven',
    desc: 'CT 方高穿甲手枪：护甲几乎挡不住，对穿甲目标伤害最稳。',
  }),

  dualies: W('dualies', {
    name: 'Dual Berettas', cn: '双持贝瑞塔 · 手枪', slot: SLOT.SECONDARY, kind: 'pistol',
    price: 300, killReward: 300, damage: 38, armorPen: 0.68, falloff: 0.72,
    range: 16, penetration: 1.0, rpm: 400, mag: 30, reserve: 120, reloadTime: 4.6,
    spread: SPREAD.pistol, firstShotMult: 1.0, recovery: 0.30, bloom: 0.36,
    recoil: { v: 42, h: 26, pattern: noisyPat(1307, 0.62, 0.7, 0.4) },
    pellets: 2, pelletSpread: 0.010, moveSpeed: 0.96, deployTime: 0.7,
    vmArchetype: 'pistol', sound: 'shoot_pistol', killIcon: 'dualies',
    desc: '每次击发左右各吐一发，近距离弹雨凶猛，换弹极慢。',
  }),

  // --- submachine guns -----------------------------------------------------
  mac10: W('mac10', {
    name: 'MAC-10', cn: 'MAC-10 · 冲锋枪', slot: SLOT.PRIMARY, kind: 'smg',
    team: 'T', price: 1050, killReward: 600, damage: 29, armorPen: 0.675,
    falloff: 0.74, range: 20, penetration: 1.3, rpm: 800, auto: true,
    mag: 30, reserve: 100, reloadTime: 2.7, spread: SPREAD.smg,
    firstShotMult: 0.95, recovery: 0.28, bloom: 0.26,
    recoil: { v: 46, h: 30, pattern: noisyPat(2101, 0.66, 0.62) },
    moveSpeed: 0.96, deployTime: 0.55, vmArchetype: 'smg',
    sound: 'shoot_smg', killIcon: 'mac10',
    desc: 'T 方廉价冲锋枪：射速高、跑打稳，强起与突入的首选。',
  }),

  mp9: W('mp9', {
    name: 'MP9', cn: 'MP9 · 冲锋枪', slot: SLOT.PRIMARY, kind: 'smg',
    team: 'CT', price: 1250, killReward: 600, damage: 26, armorPen: 0.615,
    falloff: 0.75, range: 22, penetration: 1.3, rpm: 857, auto: true,
    mag: 30, reserve: 120, reloadTime: 2.1, spread: SPREAD.smg,
    firstShotMult: 0.95, recovery: 0.26, bloom: 0.24,
    recoil: { v: 34, h: 22, pattern: noisyPat(2203, 0.55, 0.66) },
    moveSpeed: 0.96, deployTime: 0.5, vmArchetype: 'smg',
    sound: 'shoot_smg', killIcon: 'mp9',
    desc: 'CT 方轻量冲锋枪：机动性极佳，前压和残局清人都好用。',
  }),

  mp5: W('mp5', {
    name: 'MP5-SD', cn: 'MP5-SD · 消音冲锋枪', slot: SLOT.PRIMARY, kind: 'smg',
    price: 1500, killReward: 600, damage: 27, armorPen: 0.675, falloff: 0.78,
    range: 26, penetration: 1.4, rpm: 750, auto: true, mag: 30, reserve: 120,
    reloadTime: 2.6, spread: SPREAD.smg, firstShotMult: 0.92, recovery: 0.26,
    bloom: 0.22, recoil: { v: 32, h: 20, pattern: noisyPat(2307, 0.48, 0.7) },
    moveSpeed: 0.94, silenced: true, deployTime: 0.55, vmArchetype: 'smg',
    sound: 'shoot_smg', killIcon: 'mp5',
    desc: '消音冲锋枪：枪声小、弹道稳，中距离也能压制。',
  }),

  ump45: W('ump45', {
    name: 'UMP-45', cn: 'UMP-45 · 冲锋枪', slot: SLOT.PRIMARY, kind: 'smg',
    price: 1200, killReward: 600, damage: 35, armorPen: 0.65, falloff: 0.66,
    range: 17, penetration: 1.5, rpm: 666, auto: true, mag: 25, reserve: 100,
    reloadTime: 3.5, spread: SPREAD.smg, firstShotMult: 0.92, recovery: 0.30,
    bloom: 0.28, recoil: { v: 42, h: 24, pattern: noisyPat(2411, 0.58, 0.6) },
    moveSpeed: 0.94, deployTime: 0.6, vmArchetype: 'smg_boxy',
    sound: 'shoot_smg', killIcon: 'ump45',
    desc: '低价高伤冲锋枪：近距离两枪带走无甲目标，远距离衰减明显。',
  }),

  p90: W('p90', {
    name: 'P90', cn: 'P90 · 冲锋枪', slot: SLOT.PRIMARY, kind: 'smg',
    price: 2350, killReward: 300, damage: 26, armorPen: 0.69, falloff: 0.81,
    range: 26, penetration: 1.4, rpm: 857, auto: true, mag: 50, reserve: 100,
    reloadTime: 3.4, spread: SPREAD.smg, firstShotMult: 0.95, recovery: 0.28,
    bloom: 0.24, recoil: { v: 34, h: 24, pattern: noisyPat(2513, 0.6, 0.64) },
    moveSpeed: 0.92, deployTime: 0.6, vmArchetype: 'smg_boxy',
    sound: 'shoot_smg', killIcon: 'p90',
    desc: '50 发大弹匣扫射机器：容错极高，但击杀奖励只有 300。',
  }),

  // --- assault rifles ------------------------------------------------------
  galil: W('galil', {
    name: 'Galil AR', cn: '加利尔 · 突击步枪', slot: SLOT.PRIMARY, kind: 'rifle',
    team: 'T', price: 1800, killReward: 300, damage: 30, armorPen: 0.7775,
    falloff: 0.85, range: 40, penetration: 1.9, rpm: 666, auto: true,
    mag: 35, reserve: 90, reloadTime: 3.0, spread: SPREAD.rifle,
    firstShotMult: 0.78, recovery: 0.36, bloom: 0.34,
    recoil: { v: 56, h: 32, pattern: shapePat(PAT_AK, 1.18, 0.94, 0.06) },
    moveSpeed: 0.86, deployTime: 0.65, vmArchetype: 'rifle_ak',
    sound: 'shoot_rifle', killIcon: 'galil',
    desc: 'T 方廉价步枪：弹匣 35 发，弹道比 AK 更飘，强起性价比之王。',
  }),

  famas: W('famas', {
    name: 'FAMAS', cn: '法玛斯 · 突击步枪', slot: SLOT.PRIMARY, kind: 'rifle',
    team: 'CT', price: 2050, killReward: 300, damage: 30, armorPen: 0.70,
    falloff: 0.85, range: 38, penetration: 1.85, rpm: 666, auto: true, burst: 3,
    mag: 25, reserve: 90, reloadTime: 3.3, spread: SPREAD.bullpup,
    firstShotMult: 0.76, recovery: 0.34, bloom: 0.32,
    recoil: { v: 52, h: 28, pattern: shapePat(PAT_BULLPUP, 1.5, 0.96, 0.08) },
    moveSpeed: 0.88, deployTime: 0.65, vmArchetype: 'rifle_bullpup',
    sound: 'shoot_rifle', killIcon: 'famas',
    desc: 'CT 方廉价步枪：可切三连发精确点射，强起局的稳定选择。',
  }),

  ak47: W('ak47', {
    name: 'AK-47', cn: 'AK-47 · 突击步枪', slot: SLOT.PRIMARY, kind: 'rifle',
    team: 'T', price: 2700, killReward: 300, damage: 36, armorPen: 0.775,
    falloff: 0.85, range: 45, penetration: 2.0, rpm: 600, auto: true,
    mag: 30, reserve: 90, reloadTime: 2.4, spread: SPREAD.rifle,
    firstShotMult: 0.72, recovery: 0.34, bloom: 0.34,
    recoil: { v: 62, h: 34, pattern: PAT_AK },
    moveSpeed: 0.86, deployTime: 0.65, vmArchetype: 'rifle_ak',
    sound: 'shoot_ak', killIcon: 'ak47',
    desc: 'T 方主力步枪：戴头盔也能一枪爆头，弹道先上抬再左拉右扫。',
  }),

  m4a4: W('m4a4', {
    name: 'M4A4', cn: 'M4A4 · 突击步枪', slot: SLOT.PRIMARY, kind: 'rifle',
    team: 'CT', price: 2900, killReward: 300, damage: 33, armorPen: 0.70,
    falloff: 0.85, range: 45, penetration: 1.95, rpm: 666, auto: true,
    mag: 30, reserve: 90, reloadTime: 3.07, spread: SPREAD.rifle,
    firstShotMult: 0.74, recovery: 0.32, bloom: 0.30,
    recoil: { v: 50, h: 24, pattern: PAT_M4 },
    moveSpeed: 0.90, deployTime: 0.65, vmArchetype: 'rifle_m4',
    sound: 'shoot_m4', killIcon: 'm4a4',
    desc: 'CT 方主力步枪：后坐力柔和易压枪，但打不穿头盔。',
  }),

  m4a1s: W('m4a1s', {
    name: 'M4A1-S', cn: 'M4A1-S · 消音步枪', slot: SLOT.PRIMARY, kind: 'rifle',
    team: 'CT', price: 2900, killReward: 300, damage: 38, armorPen: 0.70,
    falloff: 0.86, range: 48, penetration: 1.90, rpm: 600, auto: true,
    mag: 20, reserve: 80, reloadTime: 3.1, spread: SPREAD.rifle,
    firstShotMult: 0.68, recovery: 0.30, bloom: 0.26,
    recoil: { v: 44, h: 18, pattern: shapePat(PAT_M4, 0.62, 0.86) },
    moveSpeed: 0.90, silenced: true, deployTime: 0.65, vmArchetype: 'rifle_m4',
    sound: 'shoot_silenced', killIcon: 'm4a1s',
    desc: '消音精确步枪：单发伤害更高、弹道更收，但弹匣只有 20 发。',
  }),

  aug: W('aug', {
    name: 'AUG', cn: 'AUG · 倍镜步枪', slot: SLOT.PRIMARY, kind: 'rifle',
    team: 'CT', price: 3300, killReward: 300, damage: 28, armorPen: 0.70,
    falloff: 0.86, range: 50, penetration: 2.0, rpm: 400, auto: true,
    mag: 30, reserve: 90, reloadTime: 3.8, spread: SPREAD.bullpup,
    firstShotMult: 0.60, recovery: 0.30, bloom: 0.28,
    recoil: { v: 44, h: 18, pattern: shapePat(PAT_BULLPUP, 1.0, 0.88) },
    moveSpeed: 0.88, deployTime: 0.7, vmArchetype: 'rifle_bullpup',
    ads: { type: 'scope', fov: [90, 40], speed: 16, moveSpeed: 0.55 },
    adsSpreadMult: 0.30, hipMult: 2.2,
    sound: 'shoot_rifle', killIcon: 'aug',
    desc: 'CT 方倍镜步枪：开镜后当轻狙用，站定首发几乎无散布。',
  }),

  sg553: W('sg553', {
    name: 'SG 553', cn: 'SG 553 · 倍镜步枪', slot: SLOT.PRIMARY, kind: 'rifle',
    team: 'T', price: 3000, killReward: 300, damage: 30, armorPen: 0.75,
    falloff: 0.86, range: 50, penetration: 2.05, rpm: 545, auto: true,
    mag: 30, reserve: 90, reloadTime: 3.0, spread: SPREAD.bullpup,
    firstShotMult: 0.62, recovery: 0.32, bloom: 0.28,
    recoil: { v: 48, h: 22, pattern: shapePat(PAT_AK, 0.8, 0.9, 0.05) },
    moveSpeed: 0.86, deployTime: 0.7, vmArchetype: 'rifle_m4',
    ads: { type: 'scope', fov: [90, 40], speed: 16, moveSpeed: 0.55 },
    adsSpreadMult: 0.30, hipMult: 2.0,
    sound: 'shoot_rifle', killIcon: 'sg553',
    desc: 'T 方倍镜步枪：穿甲高、开镜控枪极稳，专治远距离对枪。',
  }),

  // --- snipers -------------------------------------------------------------
  ssg08: W('ssg08', {
    name: 'SSG 08', cn: 'SSG 08 · 轻狙', slot: SLOT.PRIMARY, kind: 'sniper',
    price: 1700, killReward: 300, damage: 88, armorPen: 0.85, falloff: 0.95,
    range: 70, penetration: 2.0, rpm: 48, mag: 10, reserve: 90,
    reloadTime: 2.6, reloadType: 'bolt', spread: SPREAD.sniper,
    firstShotMult: 0.35, recovery: 0.55, bloom: 0.9,
    recoil: { v: 120, h: 14, pattern: kickPat(0.12) },
    moveSpeed: 0.92, deployTime: 0.8, vmArchetype: 'sniper_bolt',
    ads: { type: 'scope', fov: [90, 40, 15], speed: 12, moveSpeed: 0.55 },
    adsSpreadMult: 0.022, hipMult: 16, unscopeAfterShot: true,
    sound: 'shoot_scout', killIcon: 'ssg08',
    desc: '轻狙：爆头必杀且移动速度快，适合跳狙与打野点。',
  }),

  awp: W('awp', {
    name: 'AWP', cn: 'AWP · 大狙', slot: SLOT.PRIMARY, kind: 'sniper',
    price: 4750, killReward: 100, damage: 115, armorPen: 0.9725, falloff: 0.99,
    range: 90, penetration: 2.5, rpm: 41, mag: 5, reserve: 30,
    reloadTime: 3.7, reloadType: 'bolt', spread: SPREAD.sniper,
    firstShotMult: 0.30, recovery: 0.75, bloom: 1.0,
    recoil: { v: 165, h: 18, pattern: kickPat(0.1) },
    moveSpeed: 0.80, deployTime: 1.0, vmArchetype: 'sniper_awp',
    ads: { type: 'scope', fov: [90, 40, 10], speed: 11, moveSpeed: 0.34 },
    adsSpreadMult: 0.015, hipMult: 22, unscopeAfterShot: true,
    sound: 'shoot_awp', killIcon: 'awp',
    desc: '一枪毙命的大狙：除腿部外命中即死，但腰射几乎打不中人。',
  }),

  // --- heavy ---------------------------------------------------------------
  nova: W('nova', {
    name: 'Nova', cn: 'Nova · 霰弹枪', slot: SLOT.PRIMARY, kind: 'shotgun',
    price: 1050, killReward: 900, damage: 26, armorPen: 0.50, falloff: 0.42,
    range: 13, penetration: 0.5, rpm: 68, mag: 8, reserve: 32,
    reloadTime: 5.7, reloadType: 'shell', spread: SPREAD.shotgun,
    recovery: 0.45, bloom: 0.18, recoil: { v: 95, h: 20, pattern: kickPat(0.24) },
    pellets: 9, pelletSpread: 0.030, moveSpeed: 0.88, deployTime: 0.75,
    vmArchetype: 'shotgun_pump', sound: 'shoot_shotgun', killIcon: 'nova',
    shellTime: 0.55,
    desc: '泵动霰弹枪：9 颗弹丸贴身一枪带走，超过 13 米几乎无威胁。',
  }),

  xm1014: W('xm1014', {
    name: 'XM1014', cn: 'XM1014 · 自动霰弹枪', slot: SLOT.PRIMARY, kind: 'shotgun',
    price: 2000, killReward: 900, damage: 20, armorPen: 0.40, falloff: 0.45,
    range: 14, penetration: 0.45, rpm: 171, auto: true, mag: 7, reserve: 32,
    reloadTime: 5.0, reloadType: 'shell', spread: SPREAD.shotgun,
    recovery: 0.42, bloom: 0.20, recoil: { v: 70, h: 26, pattern: noisyPat(3101, 0.6, 0.8, 0.7) },
    pellets: 8, pelletSpread: 0.033, moveSpeed: 0.86, deployTime: 0.75,
    vmArchetype: 'shotgun_auto', sound: 'shoot_shotgun', killIcon: 'xm1014',
    shellTime: 0.5,
    desc: '全自动霰弹枪：近身连发压制力极强，弹药消耗也极快。',
  }),

  mag7: W('mag7', {
    name: 'MAG-7', cn: 'MAG-7 · 霰弹枪', slot: SLOT.PRIMARY, kind: 'shotgun',
    team: 'CT', price: 1300, killReward: 900, damage: 30, armorPen: 0.50,
    falloff: 0.36, range: 11, penetration: 0.5, rpm: 80, mag: 5, reserve: 32,
    reloadTime: 4.7, reloadType: 'pump', spread: SPREAD.shotgun,
    recovery: 0.45, bloom: 0.18, recoil: { v: 88, h: 18, pattern: kickPat(0.2) },
    pellets: 8, pelletSpread: 0.026, moveSpeed: 0.90, deployTime: 0.7,
    vmArchetype: 'shotgun_pump', sound: 'shoot_shotgun', killIcon: 'mag7',
    desc: 'CT 专属霰弹枪：弹丸集中、机动性好，守近点门口的噩梦。',
  }),

  negev: W('negev', {
    name: 'Negev', cn: '内格夫 · 轻机枪', slot: SLOT.PRIMARY, kind: 'heavy',
    price: 1700, killReward: 300, damage: 35, armorPen: 0.7475, falloff: 0.81,
    range: 40, penetration: 1.9, rpm: 800, auto: true, mag: 150, reserve: 200,
    reloadTime: 5.7, spread: SPREAD.lmg, firstShotMult: 1.6, recovery: 0.40,
    bloom: 0.10, recoil: { v: 40, h: 34, pattern: noisyPat(3307, 0.9, 0.28, 0.9) },
    moveSpeed: 0.78, deployTime: 1.1, vmArchetype: 'lmg',
    sound: 'shoot_auto', killIcon: 'negev', spinUp: 12,
    desc: '150 发机枪：前十几发弹道狂野，架住不动后就是死亡射线。',
  }),

  // --- grenades ------------------------------------------------------------
  he: W('he', {
    name: 'HE Grenade', cn: '高爆手雷', slot: SLOT.GRENADE, kind: 'grenade',
    price: 300, killReward: 300, damage: 0, armorPen: 0.5, range: 8,
    penetration: 0, rpm: 60, mag: 1, reserve: 0, spread: SPREAD.none,
    recoil: { v: 0, h: 0, pattern: kickPat(0) }, moveSpeed: 0.98,
    tracer: false, shellEject: false, deployTime: 0.45,
    vmArchetype: 'grenade', sound: 'nade_throw', killIcon: 'hegrenade',
    grenade: { kind: 'he', fuse: 1.75, radius: 7.5, damage: 98, throwSpeed: 21, bounce: 0.45, life: 1.75 },
    desc: '高爆手雷：满血目标炸不死，但配合队友火力可以清点、封位。',
  }),

  flash: W('flash', {
    name: 'Flashbang', cn: '闪光弹', slot: SLOT.GRENADE, kind: 'grenade',
    price: 200, killReward: 0, damage: 0, armorPen: 0.5, range: 9,
    penetration: 0, rpm: 60, mag: 1, reserve: 0, spread: SPREAD.none,
    recoil: { v: 0, h: 0, pattern: kickPat(0) }, moveSpeed: 0.98,
    tracer: false, shellEject: false, deployTime: 0.45,
    vmArchetype: 'grenade', sound: 'nade_throw', killIcon: 'flashbang',
    grenade: { kind: 'flash', fuse: 1.55, radius: 9, damage: 2, throwSpeed: 21, bounce: 0.45, life: 1.55, blind: 3.4 },
    desc: '闪光弹：正面直视最长致盲 3.4 秒，进攻与回防都靠它开路。',
  }),

  smoke: W('smoke', {
    name: 'Smoke Grenade', cn: '烟雾弹', slot: SLOT.GRENADE, kind: 'grenade',
    price: 300, killReward: 0, damage: 0, armorPen: 0.5, range: 9,
    penetration: 0, rpm: 60, mag: 1, reserve: 0, spread: SPREAD.none,
    recoil: { v: 0, h: 0, pattern: kickPat(0) }, moveSpeed: 0.98,
    tracer: false, shellEject: false, deployTime: 0.45,
    vmArchetype: 'grenade', sound: 'nade_throw', killIcon: 'smokegrenade',
    grenade: { kind: 'smoke', fuse: 1.7, radius: 4.6, damage: 0, throwSpeed: 21, bounce: 0.3, life: 18 },
    desc: '烟雾弹：18 秒的视线封锁，封点、封狙、掩护拆弹全靠它。',
  }),

  molotov: W('molotov', {
    name: 'Molotov', cn: '燃烧瓶', slot: SLOT.GRENADE, kind: 'grenade',
    team: 'T', price: 400, killReward: 300, damage: 0, armorPen: 1.0, range: 8,
    penetration: 0, rpm: 60, mag: 1, reserve: 0, spread: SPREAD.none,
    recoil: { v: 0, h: 0, pattern: kickPat(0) }, moveSpeed: 0.98,
    tracer: false, shellEject: false, deployTime: 0.45,
    vmArchetype: 'grenade', sound: 'nade_throw', killIcon: 'molotov',
    grenade: { kind: 'fire', fuse: 2.0, radius: 3.4, damage: 11, throwSpeed: 20, bounce: 0.06, life: 7 },
    desc: 'T 方燃烧瓶：落地即碎，7 秒火海逼人离开掩体或延缓拆弹。',
  }),

  incendiary: W('incendiary', {
    name: 'Incendiary Grenade', cn: '燃烧弹', slot: SLOT.GRENADE, kind: 'grenade',
    team: 'CT', price: 600, killReward: 300, damage: 0, armorPen: 1.0, range: 8,
    penetration: 0, rpm: 60, mag: 1, reserve: 0, spread: SPREAD.none,
    recoil: { v: 0, h: 0, pattern: kickPat(0) }, moveSpeed: 0.98,
    tracer: false, shellEject: false, deployTime: 0.45,
    vmArchetype: 'grenade', sound: 'nade_throw', killIcon: 'incgrenade',
    grenade: { kind: 'fire', fuse: 2.0, radius: 3.6, damage: 11, throwSpeed: 20, bounce: 0.04, life: 7.2 },
    desc: 'CT 方燃烧弹：封锁进攻路线、烧包点，比燃烧瓶更贵一点。',
  }),

  decoy: W('decoy', {
    name: 'Decoy Grenade', cn: '诱饵弹', slot: SLOT.GRENADE, kind: 'grenade',
    price: 50, killReward: 0, damage: 0, armorPen: 0.5, range: 8,
    penetration: 0, rpm: 60, mag: 1, reserve: 0, spread: SPREAD.none,
    recoil: { v: 0, h: 0, pattern: kickPat(0) }, moveSpeed: 0.98,
    tracer: false, shellEject: false, deployTime: 0.45,
    vmArchetype: 'grenade', sound: 'nade_throw', killIcon: 'decoy',
    grenade: { kind: 'decoy', fuse: 1.8, radius: 2.6, damage: 10, throwSpeed: 21, bounce: 0.4, life: 15 },
    desc: '诱饵弹：模拟枪声骗雷达与听声位，最后小爆一下。',
  }),

  // --- gear (bought, never held: slot is null on purpose) ------------------
  kevlar: W('kevlar', {
    name: 'Kevlar Vest', cn: '防弹衣', slot: null, kind: 'gear',
    price: 650, killReward: 0, damage: 0, rpm: 60, spread: SPREAD.none,
    recoil: { v: 0, h: 0, pattern: kickPat(0) }, tracer: false, shellEject: false,
    sound: 'buy', deploySound: 'buy', armor: PLAYER.maxArmor, helmet: false,
    desc: '防弹衣：100 点护甲，大幅降低躯干与手臂受到的伤害。',
  }),

  kevlarhelmet: W('kevlarhelmet', {
    name: 'Kevlar + Helmet', cn: '防弹衣 + 头盔', slot: null, kind: 'gear',
    price: 1000, killReward: 0, damage: 0, rpm: 60, spread: SPREAD.none,
    recoil: { v: 0, h: 0, pattern: kickPat(0) }, tracer: false, shellEject: false,
    sound: 'buy', deploySound: 'buy', armor: PLAYER.maxArmor, helmet: true,
    upgradePrice: HELMET_UPGRADE_PRICE,
    desc: '防弹衣 + 头盔：挡下手枪与部分步枪的爆头，已有甲时只需 $350。',
  }),

  defusekit: W('defusekit', {
    name: 'Defuse Kit', cn: '拆弹器', slot: null, kind: 'gear', team: 'CT',
    price: 400, killReward: 0, damage: 0, rpm: 60, spread: SPREAD.none,
    recoil: { v: 0, h: 0, pattern: kickPat(0) }, tracer: false, shellEject: false,
    sound: 'buy', deploySound: 'buy',
    desc: '拆弹器：拆弹时间从 10 秒缩短到 5 秒，CT 必备。',
  }),
};

// ---------------------------------------------------------------------------
// Registry integrity — fail at import time rather than mid-round.
// ---------------------------------------------------------------------------
for (const id of WEAPON_IDS) {
  if (!WEAPONS[id]) throw new Error(`weapons.js: no definition for "${id}"`);
}
for (const id of Object.keys(WEAPONS)) {
  if (!WEAPON_IDS.includes(id)) throw new Error(`weapons.js: "${id}" is not in WEAPON_IDS`);
  const vm = WEAPONS[id].vmArchetype;
  if (vm && !VM_ARCHETYPES.includes(vm)) throw new Error(`weapons.js: ${id} bad vmArchetype`);
}

/** Every definition, in api.js registry order. */
export const WEAPON_LIST = WEAPON_IDS.map((id) => WEAPONS[id]);

const GUN_KINDS = new Set(['pistol', 'smg', 'rifle', 'sniper', 'shotgun', 'heavy']);

/** @returns {Object|null} the definition, or null for an unknown id. */
export function getWeapon(id) {
  return (id && WEAPONS[id]) || null;
}

/** True for anything that fires bullets (knife / grenades / gear are not guns). */
export function isGun(def) {
  const d = typeof def === 'string' ? WEAPONS[def] : def;
  return !!d && GUN_KINDS.has(d.kind);
}

/** True for kevlar / kevlar+helmet / defuse kit: bought, never held in a slot. */
export function isGear(id) {
  const d = typeof id === 'string' ? WEAPONS[id] : id;
  return !!d && d.kind === 'gear';
}

/** True for the six throwables. */
export function isGrenade(id) {
  const d = typeof id === 'string' ? WEAPONS[id] : id;
  return !!d && d.kind === 'grenade';
}

/** Ids a team is allowed to buy (null `team` field = both sides). */
export function weaponsForTeam(team) {
  return WEAPON_IDS.filter((id) => {
    const d = WEAPONS[id];
    if (!d || d.price <= 0) return false;            // knife and C4 are issued
    return !d.team || d.team === team;
  });
}

/**
 * Damage one bullet (one pellet for shotguns) still carries at `dist` metres.
 * `falloff` is the multiplier per 100 m; past the weapon's useful `range` the
 * round bleeds energy fast and it is gone at BULLET_MAX_RANGE.
 */
export function damageAtRange(def, dist) {
  const d = typeof def === 'string' ? WEAPONS[def] : def;
  if (!d || !d.damage) return 0;
  const m = Math.max(0, dist || 0);
  if (m >= BULLET_MAX_RANGE) return 0;
  let dmg = d.damage * Math.pow(d.falloff ?? 0.85, m / 100);
  const range = d.range || 40;
  if (m > range) {
    const over = clamp01((m - range) / Math.max(1, BULLET_MAX_RANGE - range));
    dmg *= lerp(1, 0.35, over);
  }
  return dmg;
}

/** Cash for a kill; killing a team mate costs MONEY.teamKillPenalty instead. */
export function killReward(def, victimTeam, killerTeam) {
  if (victimTeam && killerTeam && victimTeam === killerTeam) return MONEY.teamKillPenalty;
  const d = typeof def === 'string' ? WEAPONS[def] : def;
  const r = d && typeof d.killReward === 'number' ? d.killReward : 300;
  return r;
}

/**
 * Split incoming damage into health / armour with the CS formula.
 *
 * `dmg` is the damage AFTER the hitbox multiplier — that is what combat.js
 * hands us (it applies HIT_MULT[hitbox] and def.hsMult itself).  Pass
 * `{applyHitbox: true}` to have this function do that step instead (handy for
 * bot damage estimates and tests).
 *
 * Kevlar covers chest / stomach / arms, the head needs a helmet, and legs are
 * never protected.  `hasArmor` may be a boolean (assume a full vest) or the
 * victim's remaining armour points for an exact plate break.
 *
 * @returns {{health:number, armor:number}} HP and armour points to subtract.
 */
export function armorDamage(def, dmg, hasArmor, hasHelmet, hitbox = HITBOX.CHEST, opts = {}) {
  const d = (typeof def === 'string' ? WEAPONS[def] : def) || {};
  const hb = HIT_MULT[hitbox] !== undefined ? hitbox : HITBOX.CHEST;
  let out = Math.max(0, dmg || 0);
  if (opts.applyHitbox) {
    out *= HIT_MULT[hb];
    if (hb === HITBOX.HEAD) out *= d.hsMult ?? 1;
  }
  const covered = hb === HITBOX.HEAD ? !!hasHelmet : hb !== HITBOX.LEG;
  const points = typeof hasArmor === 'number' ? Math.max(0, hasArmor)
    : (hasArmor ? PLAYER.maxArmor : 0);
  if (!covered || points <= 0 || out <= 0) return { health: out, armor: 0 };
  const pen = clamp01(d.armorPen ?? 0.5);
  let health = out * pen;
  let armor = (out - health) * ARMOR_BONUS;
  if (armor > points) {                      // the plate breaks and lets the rest through
    health = Math.max(0, out - points / ARMOR_BONUS);
    armor = points;
  }
  return { health, armor: Math.min(points, Math.ceil(armor)) };
}

/**
 * View kick for shot #`shotIndex` (0 based) of a spray, in recoil units — the
 * caller scales them (actor.js uses 0.0016 rad per unit).  Past the authored 30
 * shots the tail is looped with more noise so long sprays stay unpredictable.
 *
 * @returns {{x:number, y:number}} x = drift right (+) / left (-), y = up.
 */
export function getRecoil(def, shotIndex = 0) {
  const d = (typeof def === 'string' ? WEAPONS[def] : def) || null;
  const r = d && d.recoil;
  if (!r || !r.pattern || !r.pattern.length) return { x: 0, y: 0 };
  const pat = r.pattern;
  const n = pat.length;
  const i = Math.max(0, Math.floor(shotIndex || 0));
  let p, jitter;
  if (i < n) { p = pat[i]; jitter = 0.07; }
  else {
    const tail = Math.max(0, n - 8);
    p = pat[tail + ((i - n) % Math.max(1, n - tail))];
    jitter = 0.20;
  }
  const v = r.v || 0, h = r.h || 0;
  return {
    x: p[0] * h + gauss() * h * jitter,
    y: p[1] * v + gauss() * v * jitter * 0.55,
  };
}

/**
 * Bullet cone in radians for the next shot.  combat.js samples a radius of
 * |gauss()| * 0.5 * spread inside it, so this is the outer cone.
 *
 * @param {Object|string} def
 * @param {Object} [st]
 * @param {boolean} [st.moving]      moving faster than a walk
 * @param {boolean} [st.crouching]
 * @param {boolean} [st.airborne]    feet off the ground
 * @param {boolean} [st.jumping]     the moment a jump starts (worst case)
 * @param {number|boolean} [st.ads]  0..1 sight blend (actor.js sends zoom || ads)
 * @param {number} [st.shotIndex]    shots already fired in this spray
 * @param {number} [st.sinceShot]    seconds since the last shot (large = settled)
 * @param {number} [st.recovery]     alternative to sinceShot: 0..1 recovered
 * @returns {number} radians
 */
export function spreadFor(def, st = {}) {
  const d = (typeof def === 'string' ? WEAPONS[def] : def) || null;
  const s = d && d.spread;
  if (!s) return 0;
  const aim = typeof st.ads === 'number' ? clamp01(st.ads) : (st.ads ? 1 : 0);
  const base = st.crouching ? s.crouch : s.stand;
  const shots = clamp(Math.floor(st.shotIndex || 0), 0, 14);
  // steady cone: scopes tighten it, hip-firing a scoped gun ruins it
  const aimed = base * lerp(1, d.adsSpreadMult ?? 1, aim);
  const hipPen = base * Math.max(0, (d.hipMult ?? 1) - 1) * (1 - aim);
  let steady = aimed * (shots === 0 ? (d.firstShotMult ?? 1) : 1) + hipPen;
  // stance penalties are additive and a scope does not fix them
  let penalty = 0;
  const moveCone = st.crouching ? lerp(s.crouch, s.move, 0.5) : s.move;
  if (st.moving) penalty = Math.max(penalty, moveCone - base);
  if (st.airborne) penalty = Math.max(penalty, s.air - base);
  if (st.jumping) penalty = Math.max(penalty, s.jump - base);
  penalty = Math.max(0, penalty) * lerp(1, 0.8, aim);
  // spray bloom, decaying over `recovery` seconds since the last shot
  let decay = 0;
  if (typeof st.sinceShot === 'number') {
    decay = clamp01(1 - st.sinceShot / Math.max(0.05, (d.recovery ?? 0.3) * 1.6));
  } else if (typeof st.recovery === 'number') decay = clamp01(1 - st.recovery);
  else if (shots > 0) decay = 1;
  const bloom = (aimed + hipPen) * (d.bloom ?? 0.32) * shots * decay;
  return steady + bloom + penalty;
}

// ---------------------------------------------------------------------------
// Buy menu layout (CS style: category key, then item key).  ui/buymenu.js reads
// this directly and resolves each item per team, so a T sees glock / tec9 /
// mac10 / galil / ak47 / sg553 / molotov while a CT sees usp / fiveseven / mp9 /
// famas / m4a4 / m4a1s / aug / mag7 / incendiary / defusekit.
// ---------------------------------------------------------------------------
export const BUY_CATEGORIES = [
  {
    id: 'pistols', label: '手枪', key: '1',
    items: ['glock', 'usp', 'p250', 'tec9', 'fiveseven', 'deagle', 'dualies'],
  },
  {
    id: 'smg', label: '冲锋枪', key: '2',
    items: ['mac10', 'mp9', 'mp5', 'ump45', 'p90'],
  },
  {
    id: 'rifle', label: '步枪', key: '3',
    items: ['galil', 'famas', 'ak47', 'm4a4', 'm4a1s', 'aug', 'sg553', 'ssg08', 'awp'],
  },
  {
    id: 'heavy', label: '重型武器', key: '4',
    items: ['nova', 'xm1014', 'mag7', 'negev'],
  },
  {
    id: 'gear', label: '装备', key: '5',
    items: ['kevlar', 'kevlarhelmet', 'defusekit'],
  },
  {
    id: 'grenade', label: '投掷物', key: '6',
    items: ['he', 'flash', 'smoke', 'molotov', 'incendiary', 'decoy'],
  },
];

/** BUY_CATEGORIES with every item the team cannot buy stripped out. */
export function buyCategoriesForTeam(team) {
  const allow = new Set(weaponsForTeam(team));
  return BUY_CATEGORIES
    .map((c) => ({ ...c, items: c.items.filter((id) => allow.has(id)) }))
    .filter((c) => c.items.length > 0);
}

/** Ids grouped by `kind` — lets bots ask for "any rifle" without a table. */
export const WEAPONS_BY_KIND = WEAPON_IDS.reduce((acc, id) => {
  const k = WEAPONS[id].kind;
  (acc[k] || (acc[k] = [])).push(id);
  return acc;
}, {});

