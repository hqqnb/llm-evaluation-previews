// ============================================================================
// constants.js — shared enums, tunables and balance tables.
// Every module imports from here; nothing here imports anything else.
// Units: metres, seconds, radians. World axes: +X east, +Y up, +Z south.
// ============================================================================

export const TEAM = { T: 'T', CT: 'CT' };
export const TEAM_LABEL = { T: '恐怖分子', CT: '反恐精英' };
export const TEAM_SHORT = { T: 'T', CT: 'CT' };
export const TEAM_COLOR = { T: '#e0a24c', CT: '#5b9bdd' };
export const TEAM_COLOR_HEX = { T: 0xe0a24c, CT: 0x5b9bdd };
export const OTHER_TEAM = { T: 'CT', CT: 'T' };

export const SLOT = {
  PRIMARY: 'primary',
  SECONDARY: 'secondary',
  KNIFE: 'knife',
  GRENADE: 'grenade',
  BOMB: 'bomb',
};
// Slot order used by the 1..5 number keys and by "next weapon".
export const SLOT_ORDER = [SLOT.PRIMARY, SLOT.SECONDARY, SLOT.KNIFE, SLOT.GRENADE, SLOT.BOMB];

export const PHASE = {
  MENU: 'menu',
  FREEZE: 'freeze',
  LIVE: 'live',
  PLANTED: 'planted',
  ROUND_END: 'round_end',
  HALFTIME: 'halftime',
  MATCH_END: 'match_end',
};

export const HITBOX = {
  HEAD: 'head',
  CHEST: 'chest',
  STOMACH: 'stomach',
  ARM: 'arm',
  LEG: 'leg',
};
// Damage multiplier per hitbox (mirrors CS behaviour).
export const HIT_MULT = { head: 4.0, chest: 1.0, stomach: 1.25, arm: 1.0, leg: 0.75 };
export const HITBOX_LABEL = { head: '头部', chest: '胸部', stomach: '腹部', arm: '手臂', leg: '腿部' };

// --- player body / movement ------------------------------------------------
export const PLAYER = {
  radius: 0.42,
  standHeight: 1.82,
  crouchHeight: 1.24,
  eyeDrop: 0.19,        // eye height = height - eyeDrop
  stepHeight: 0.44,     // auto step-up
  maxHealth: 100,
  maxArmor: 100,
  crouchSpeed: 6.5,     // height lerp speed
};

export const PHYS = {
  gravity: 15.2,
  jumpVel: 5.55,
  groundAccel: 62,
  airAccel: 14,
  friction: 8.2,
  stopSpeed: 0.9,
  maxFallDamageSpeed: 12.5,   // below this: no fall damage
  fallDamageScale: 9.0,
  airMaxWish: 1.4,            // classic air-control cap
  runSpeed: 4.35,             // base; scaled per weapon
  walkMul: 0.52,              // ⇧ silent walk
  crouchMul: 0.34,
  sprintMul: 1.42,            // ⌥ tactical sprint (weapon lowered)
  sprintStamina: 4.2,         // seconds of sprint
  sprintRecover: 2.4,
  ladderSpeed: 3.0,
};

// Noise radius (metres) other actors can hear.
export const SOUND_RANGE = {
  run: 15, walk: 0, crouch: 4, sprint: 22, land: 14, jump: 8,
  shoot: 60, reload: 12, plant: 22, defuse: 14, nade_bounce: 16, pickup: 8,
};

// --- match / round timing --------------------------------------------------
export const ROUND = {
  freezeTime: 12,
  roundTime: 115,
  bombTime: 40,
  defuseTime: 10,
  defuseKitTime: 5,
  plantTime: 3.2,
  roundEndTime: 5.5,
  halftimeTime: 8,
  buyTime: 20,           // buy window after round start (freeze + this)
  c4DropRadius: 0.6,
};

// --- economy ---------------------------------------------------------------
export const MONEY = {
  start: 800,
  max: 16000,
  winElimination: 3250,
  winBombDetonate: 3500,
  winBombDefuse: 3500,
  winTimeout: 3250,
  plantReward: 300,        // to the planter
  defuseReward: 300,       // to the defuser
  lossBonus: [1400, 1900, 2400, 2900, 3400],
  tLossWithPlant: 800,     // extra for T when they planted but lost
  teamKillPenalty: -300,
  suicidePenalty: -300,
  hostage: 0,
};

// --- surfaces (footsteps, impact fx, bullet decals) ------------------------
export const SURFACE = {
  SAND: 'sand',
  CONCRETE: 'concrete',
  METAL: 'metal',
  WOOD: 'wood',
  DIRT: 'dirt',
  TILE: 'tile',
  FABRIC: 'fabric',
  GLASS: 'glass',
  WATER: 'water',
};

// Material ids understood by render/materials.js. Every brush carries one.
export const MAT = {
  SAND_WALL: 'sandwall',      // dust2 plaster/sand walls
  SAND_TRIM: 'sandtrim',      // darker banding / trim
  SAND_FLOOR: 'sandfloor',    // sandy ground
  STONE: 'stone',
  CONCRETE: 'concrete',
  BRICK: 'brick',
  PLASTER: 'plaster',
  WOOD: 'wood',
  CRATE: 'crate',
  METAL: 'metal',
  METAL_RUST: 'metalrust',
  DOOR: 'door',
  GRATE: 'grate',
  TILE: 'tile',
  ROOF: 'roof',
  CANVAS: 'canvas',
  SANDBAG: 'sandbag',
  RUG: 'rug',
  GLASS: 'glass',
  DIRT: 'dirt',
  ASPHALT: 'asphalt',
  PAINT_RED: 'paintred',
  PAINT_BLUE: 'paintblue',
};

// Which footstep / impact family a material belongs to.
export const MAT_SURFACE = {
  sandwall: SURFACE.CONCRETE, sandtrim: SURFACE.CONCRETE, sandfloor: SURFACE.SAND,
  stone: SURFACE.CONCRETE, concrete: SURFACE.CONCRETE, brick: SURFACE.CONCRETE,
  plaster: SURFACE.CONCRETE, wood: SURFACE.WOOD, crate: SURFACE.WOOD,
  metal: SURFACE.METAL, metalrust: SURFACE.METAL, door: SURFACE.WOOD,
  grate: SURFACE.METAL, tile: SURFACE.TILE, roof: SURFACE.TILE,
  canvas: SURFACE.FABRIC, sandbag: SURFACE.FABRIC, rug: SURFACE.FABRIC,
  glass: SURFACE.GLASS, dirt: SURFACE.DIRT, asphalt: SURFACE.CONCRETE,
  paintred: SURFACE.CONCRETE, paintblue: SURFACE.CONCRETE,
};

// --- bot difficulty --------------------------------------------------------
// reaction   : seconds before a spotted enemy is engaged
// aimError   : degrees of steady-state aim cone (halved when crouched+still)
// aimSpeed   : how fast the bot slews onto the target (rad/s at 1 rad error)
// spray      : recoil compensation quality 0..1
// nadeChance : probability of using a scripted utility line during exec
// hearing    : multiplier on SOUND_RANGE
// teamwork   : share-contact probability + rotation discipline
// peek       : uses jiggle-peek / cover discipline
export const DIFFICULTY = {
  easy: {
    id: 'easy', label: '简单', reaction: [0.42, 0.68], aimError: 5.6, aimSpeed: 5.0,
    spray: 0.18, nadeChance: 0.15, hearing: 0.65, teamwork: 0.3, peek: 0.15,
    preaim: 0.15, burstLen: [3, 9], moveSkill: 0.25, hsBias: 0.05, awpSkill: 0.3,
  },
  normal: {
    id: 'normal', label: '普通', reaction: [0.26, 0.42], aimError: 3.4, aimSpeed: 8.5,
    spray: 0.42, nadeChance: 0.4, hearing: 0.85, teamwork: 0.6, peek: 0.4,
    preaim: 0.4, burstLen: [2, 6], moveSkill: 0.5, hsBias: 0.15, awpSkill: 0.55,
  },
  hard: {
    id: 'hard', label: '困难', reaction: [0.16, 0.26], aimError: 2.0, aimSpeed: 13.0,
    spray: 0.68, nadeChance: 0.7, hearing: 1.0, teamwork: 0.85, peek: 0.7,
    preaim: 0.7, burstLen: [2, 5], moveSkill: 0.75, hsBias: 0.28, awpSkill: 0.78,
  },
  expert: {
    id: 'expert', label: '专家', reaction: [0.09, 0.16], aimError: 1.15, aimSpeed: 19.0,
    spray: 0.88, nadeChance: 0.95, hearing: 1.15, teamwork: 1.0, peek: 0.9,
    preaim: 0.92, burstLen: [1, 4], moveSkill: 0.95, hsBias: 0.42, awpSkill: 0.95,
  },
};
export const DIFFICULTY_ORDER = ['easy', 'normal', 'hard', 'expert'];

// --- bot roles / high level intents ---------------------------------------
export const ROLE = {
  ENTRY: 'entry', SUPPORT: 'support', LURK: 'lurk', AWP: 'awp', CARRIER: 'carrier',
  ANCHOR_A: 'anchor_a', ANCHOR_B: 'anchor_b', MID: 'mid', ROTATOR: 'rotator',
};

export const BOT_STATE = {
  IDLE: 'idle', ADVANCE: 'advance', HOLD: 'hold', ENGAGE: 'engage', INVESTIGATE: 'investigate',
  PLANT: 'plant', DEFUSE: 'defuse', ROTATE: 'rotate', RETREAT: 'retreat', BUY: 'buy',
  NADE: 'nade', BLIND: 'blind', PICKUP: 'pickup', GUARD_BOMB: 'guard_bomb', DEAD: 'dead',
};

// --- default settings ------------------------------------------------------
export const CFG = {
  sensitivity: 2.2,
  fov: 90,
  invertY: false,
  masterVolume: 0.8,
  sfxVolume: 1.0,
  musicVolume: 0.5,
  crosshairColor: '#39ff7a',
  crosshairDynamic: true,
  crosshairSize: 7,
  crosshairGap: 4,
  crosshairThickness: 2,
  crosshairDot: false,
  showFps: true,
  viewmodelFov: 68,
  shadows: true,
  quality: 'high',        // low | medium | high
  botCount: 8,            // total bots (split across teams with the human)
  difficulty: 'normal',
  maxRounds: 24,          // MR12 → first to 13, sides swap after 12
  team: 'CT',
  map: 'dust2',
  friendlyFire: false,
  autoBuy: false,
  radarZoom: 1.0,
  mouseSmooth: 0,
  bobScale: 1.0,
};

export const QUALITY = {
  low: { shadowMap: 0, pixelRatio: 0.75, decals: 40, particles: 0.5, smokePuffs: 34, anisotropy: 2 },
  medium: { shadowMap: 1024, pixelRatio: 1.0, decals: 90, particles: 1.0, smokePuffs: 60, anisotropy: 4 },
  high: { shadowMap: 2048, pixelRatio: 1.25, decals: 160, particles: 1.4, smokePuffs: 92, anisotropy: 8 },
};

export const AREA = {
  T_SPAWN: 'T_SPAWN', CT_SPAWN: 'CT_SPAWN', A_SITE: 'A_SITE', B_SITE: 'B_SITE',
  MID: 'MID', LONG: 'LONG', SHORT: 'SHORT', TUNNEL: 'TUNNEL', CONNECT: 'CONNECT',
};
