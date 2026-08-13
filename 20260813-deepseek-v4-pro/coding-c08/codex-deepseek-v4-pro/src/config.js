// ============================================================================
// 全局配置：武器、经济、游戏规则、难度
// ============================================================================

export const G = {
  gravity: 20,
  playerRadius: 0.38,
  standHeight: 1.8,
  crouchHeight: 1.2,
  eyeStand: 1.62,
  eyeCrouch: 1.02,
  stepUp: 0.5,
  maxSpeed: 4.76,          // CS 跑步 250u/s
  walkMult: 0.52,          // 静步
  crouchMult: 0.48,        // 下蹲
  accelGround: 55,
  accelAir: 12,
  friction: 9,
  jumpVel: 6.45,
  roundTime: 115,          // 回合时长（秒）
  bombTime: 40,
  plantTime: 3.2,
  defuseTime: 5,
  defuseNoKit: 10,
  buyTime: 15,
  endTime: 6,
  startMoney: 800,
  maxMoney: 16000,
  winMoney: 3250,
  lossMoneyBase: 1400,
  lossMoneyInc: 500,
  lossMoneyCap: 3400,
  bombExplodeBonus: 3500,
  plantBonus: 300,
  tickRate: 64,
};

// 命中部位倍率
export const HITGROUPS = { head: 4, chest: 1, stomach: 1.25, arms: 1, legs: 0.75 };

// 爆头判定区（占身体上段比例）
export const HEAD_RATIO = 0.86;
export const LEGS_RATIO = 0.35;

const PISTOL_SOUND = { shot: "glock", reload: "pistol", draw: "pistol" };

// 武器定义
export const WEAPONS = {
  glock: {
    name: "Glock-18", slot: "secondary", type: "pistol", price: 200, killReward: 300,
    damage: 30, armorPen: 0.47, rangeMod: 0.75, headshotMult: 4, rpm: 400, auto: true,
    mag: 20, reserve: 120, reload: 2.2, draw: 0.8, spread: 0.0065, moveSpread: 0.012,
    recoil: [0.5, 0.55, 0.6, 0.62, 0.64, 0.66, 0.68, 0.7, 0.72, 0.74],
    recoilYaw: [0.0, 0.06, -0.04, 0.08, -0.06, 0.03, 0.09, -0.05, 0.04, 0.0],
    moveSpeedMult: 1.0, tracer: "#ffd27a", sound: PISTOL_SOUND, view: "pistol",
  },
  usp: {
    name: "USP-S", slot: "secondary", type: "pistol", price: 200, killReward: 300,
    damage: 35, armorPen: 0.5, rangeMod: 0.79, headshotMult: 4, rpm: 352, auto: false,
    mag: 12, reserve: 24, reload: 2.2, draw: 0.8, spread: 0.0055, moveSpread: 0.010,
    recoil: [0.55, 0.6, 0.65, 0.68, 0.7, 0.72, 0.74, 0.76],
    recoilYaw: [0.0, -0.05, 0.05, -0.03, 0.06, 0.0, -0.04, 0.02],
    moveSpeedMult: 1.0, tracer: "#ffd27a", sound: PISTOL_SOUND, view: "pistol",
  },
  deagle: {
    name: "Desert Eagle", slot: "secondary", type: "pistol", price: 700, killReward: 300,
    damage: 63, armorPen: 0.93, rangeMod: 0.81, headshotMult: 4, rpm: 267, auto: false,
    mag: 7, reserve: 35, reload: 2.4, draw: 0.8, spread: 0.009, moveSpread: 0.02,
    recoil: [2.6, 2.7, 2.8, 2.9, 3.0, 3.1, 3.2],
    recoilYaw: [0.0, 0.1, -0.1, 0.12, -0.12, 0.08, -0.08],
    moveSpeedMult: 1.0, tracer: "#ffdf9a", sound: PISTOL_SOUND, view: "pistol",
  },
  mac10: {
    name: "MAC-10", slot: "primary", type: "smg", price: 1050, killReward: 600,
    damage: 29, armorPen: 0.58, rangeMod: 0.78, headshotMult: 4, rpm: 800, auto: true,
    mag: 30, reserve: 100, reload: 2.6, draw: 0.9, spread: 0.011, moveSpread: 0.017,
    recoil: [0.7, 0.72, 0.74, 0.76, 0.78, 0.8, 0.82, 0.84, 0.86, 0.88],
    recoilYaw: [0.0, 0.07, -0.06, 0.09, -0.07, 0.05, -0.09, 0.06, -0.04, 0.02],
    moveSpeedMult: 1.0, tracer: "#ffd27a", sound: { shot: "smg", reload: "rifle", draw: "rifle" }, view: "smg",
  },
  mp9: {
    name: "MP9", slot: "primary", type: "smg", price: 1250, killReward: 600,
    damage: 26, armorPen: 0.6, rangeMod: 0.76, headshotMult: 4, rpm: 857, auto: true,
    mag: 30, reserve: 120, reload: 2.1, draw: 0.85, spread: 0.009, moveSpread: 0.015,
    recoil: [0.62, 0.64, 0.66, 0.68, 0.7, 0.72, 0.74, 0.76, 0.78, 0.8],
    recoilYaw: [0.0, -0.06, 0.06, -0.08, 0.05, -0.05, 0.07, -0.03, 0.04, 0.0],
    moveSpeedMult: 1.0, tracer: "#ffd27a", sound: { shot: "smg", reload: "rifle", draw: "rifle" }, view: "smg",
  },
  p90: {
    name: "P90", slot: "primary", type: "smg", price: 2350, killReward: 300,
    damage: 26, armorPen: 0.69, rangeMod: 0.8, headshotMult: 4, rpm: 857, auto: true,
    mag: 50, reserve: 100, reload: 3.3, draw: 0.9, spread: 0.008, moveSpread: 0.013,
    recoil: [0.55, 0.57, 0.59, 0.61, 0.63, 0.65, 0.67, 0.69, 0.71, 0.73],
    recoilYaw: [0.0, 0.05, -0.05, 0.07, -0.06, 0.04, -0.07, 0.05, -0.03, 0.0],
    moveSpeedMult: 1.0, tracer: "#ffd27a", sound: { shot: "smg", reload: "rifle", draw: "rifle" }, view: "p90",
  },
  ak47: {
    name: "AK-47", slot: "primary", type: "rifle", price: 2700, killReward: 300,
    damage: 36, armorPen: 0.775, rangeMod: 0.98, headshotMult: 4, rpm: 600, auto: true,
    mag: 30, reserve: 90, reload: 2.45, draw: 1.0, spread: 0.005, moveSpread: 0.014,
    recoil: [0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.12, 1.14, 1.16, 1.18, 1.2, 1.22, 1.24, 1.26, 1.28, 1.3],
    recoilYaw: [0.0, 0.12, -0.1, 0.14, -0.12, 0.1, -0.14, 0.12, -0.1, 0.08, -0.12, 0.1, -0.06, 0.08, -0.04, 0.02],
    moveSpeedMult: 1.0, tracer: "#ffcf7e", sound: { shot: "ak", reload: "rifle", draw: "rifle" }, view: "rifle",
  },
  m4a4: {
    name: "M4A4", slot: "primary", type: "rifle", price: 3100, killReward: 300,
    damage: 33, armorPen: 0.7, rangeMod: 0.97, headshotMult: 4, rpm: 666, auto: true,
    mag: 30, reserve: 90, reload: 3.1, draw: 1.0, spread: 0.0045, moveSpread: 0.013,
    recoil: [0.72, 0.76, 0.8, 0.84, 0.88, 0.92, 0.95, 0.98, 1.0, 1.02, 1.04, 1.06, 1.08, 1.1, 1.12, 1.14],
    recoilYaw: [0.0, 0.1, -0.08, 0.12, -0.1, 0.08, -0.12, 0.1, -0.08, 0.06, -0.1, 0.08, -0.05, 0.06, -0.03, 0.02],
    moveSpeedMult: 1.0, tracer: "#ffcf7e", sound: { shot: "m4", reload: "rifle", draw: "rifle" }, view: "rifle",
  },
  awp: {
    name: "AWP", slot: "primary", type: "sniper", price: 4750, killReward: 100,
    damage: 115, armorPen: 0.975, rangeMod: 0.99, headshotMult: 4, rpm: 41, auto: false,
    mag: 5, reserve: 30, reload: 3.7, draw: 1.25, spread: 0.0008, moveSpread: 0.09,
    recoil: [7.0], recoilYaw: [0.0], zoom: 0.28, zoomAlt: 0.12,
    moveSpeedMult: 0.95, tracer: "#ffd27a", sound: { shot: "awp", reload: "sniper", draw: "sniper" }, view: "sniper",
  },
  nova: {
    name: "Nova", slot: "primary", type: "shotgun", price: 1200, killReward: 900,
    damage: 26, pellets: 9, armorPen: 0.5, rangeMod: 0.72, headshotMult: 4, rpm: 68, auto: false,
    mag: 8, reserve: 32, reload: 2.0, reloadPer: 0.55, draw: 0.9, spread: 0.025, moveSpread: 0.03,
    recoil: [1.6], recoilYaw: [0.0], moveSpeedMult: 1.0, tracer: "#ffd27a",
    sound: { shot: "shotgun", reload: "shotgun", draw: "shotgun" }, view: "shotgun",
  },
};

export const NADES = {
  he: { name: "高爆手雷", price: 300, max: 1, fuse: 1.55 },
  flash: { name: "闪光弹", price: 200, max: 2, fuse: 1.45 },
  smoke: { name: "烟雾弹", price: 300, max: 1, fuse: 1.5 },
  molotov: { name: "燃烧瓶", price: 400, max: 1, fuse: 1.1 },
};

// 经济：击杀奖励
export function killReward(weaponId) {
  if (!weaponId) return 1500; // 刀
  return WEAPONS[weaponId] ? WEAPONS[weaponId].killReward : 300;
}

// Bot 难度参数
export const DIFFICULTY = {
  easy: {
    label: "简单", reaction: 0.65, reactionJitter: 0.2, aimErr: 0.075, burstMin: 2, burstMax: 5,
    trackLag: 0.45, nadeChance: 0.25, tactics: 0.3, moveWhileShoot: 0.5, hp: 1.0, wallSense: 0.25,
  },
  normal: {
    label: "普通", reaction: 0.42, reactionJitter: 0.12, aimErr: 0.042, burstMin: 3, burstMax: 7,
    trackLag: 0.28, nadeChance: 0.45, tactics: 0.55, moveWhileShoot: 0.65, hp: 1.0, wallSense: 0.45,
  },
  hard: {
    label: "困难", reaction: 0.28, reactionJitter: 0.07, aimErr: 0.023, burstMin: 4, burstMax: 10,
    trackLag: 0.17, nadeChance: 0.7, tactics: 0.8, moveWhileShoot: 0.8, hp: 1.0, wallSense: 0.65,
  },
  expert: {
    label: "专家", reaction: 0.16, reactionJitter: 0.04, aimErr: 0.010, burstMin: 5, burstMax: 14,
    trackLag: 0.09, nadeChance: 0.9, tactics: 1.0, moveWhileShoot: 0.92, hp: 1.0, wallSense: 0.85,
  },
};

export const TEAM_COLORS = {
  T: { ui: "#f0b45a", cloth: 0x9a7a45, clothDark: 0x6f5630, accent: 0xd8a34a },
  CT: { ui: "#6fb4ff", cloth: 0x4a6484, clothDark: 0x33485f, accent: 0x7fa8d8 },
};

export const MAP_LIST = ["dust2", "foundry", "subway"];
