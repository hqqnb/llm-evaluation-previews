export const TEAM = Object.freeze({
  T: "T",
  CT: "CT",
  SPECTATOR: "SPECTATOR",
});

export const PHASE = Object.freeze({
  MENU: "menu",
  FREEZE: "freeze",
  LIVE: "live",
  POST_PLANT: "postPlant",
  ROUND_END: "roundEnd",
  MATCH_END: "matchEnd",
  PAUSED: "paused",
});

export const ECONOMY = Object.freeze({
  startMoney: 800,
  maxMoney: 16000,
  tWin: 3250,
  ctEliminationWin: 3250,
  ctDefuseWin: 3500,
  bombDetonationWin: 3500,
  plantTeamBonus: 800,
  planterBonus: 300,
  defuserBonus: 300,
  lossBonuses: [1400, 1900, 2400, 2900, 3400],
});

const firearm = ({
  id,
  name,
  class: weaponClass,
  price,
  slot,
  damage,
  fireRate,
  magazine,
  reserve,
  reload,
  spread,
  recoil,
  range,
  moveSpeed,
  killReward,
  armorRatio = 0.65,
  headMultiplier = 4,
  pellets = 1,
  zoom = 1,
  automatic = false,
  team = "both",
}) => ({
  id,
  name,
  class: weaponClass,
  price,
  slot,
  damage,
  fireRate,
  magazine,
  reserve,
  reload,
  spread,
  recoil,
  range,
  moveSpeed,
  killReward,
  armorRatio,
  headMultiplier,
  pellets,
  zoom,
  automatic,
  team,
});

const grenade = ({ id, name, price, effect }) => ({
  id,
  name,
  class: "grenade",
  price,
  slot: 4,
  damage: effect === "frag" ? 98 : 0,
  fireRate: 0,
  magazine: 1,
  reserve: 0,
  reload: 0,
  spread: 0,
  recoil: 0,
  range: 24,
  moveSpeed: 1.04,
  killReward: 300,
  armorRatio: 0.5,
  headMultiplier: 1,
  pellets: 1,
  zoom: 1,
  automatic: false,
  team: "both",
  effect,
});

export const WEAPONS = Object.freeze({
  knife: firearm({
    id: "knife",
    name: "战术刀",
    class: "melee",
    price: 0,
    slot: 3,
    damage: 42,
    fireRate: 1.8,
    magazine: 1,
    reserve: 0,
    reload: 0,
    spread: 0,
    recoil: 0,
    range: 2.1,
    moveSpeed: 1.12,
    killReward: 1500,
  }),
  glock: firearm({
    id: "glock",
    name: "K17",
    class: "pistol",
    price: 200,
    slot: 2,
    damage: 28,
    fireRate: 6.6,
    magazine: 20,
    reserve: 100,
    reload: 2.25,
    spread: 0.014,
    recoil: 0.72,
    range: 46,
    moveSpeed: 1.04,
    killReward: 300,
    armorRatio: 0.47,
    team: "T",
  }),
  usp: firearm({
    id: "usp",
    name: "USP-S",
    class: "pistol",
    price: 200,
    slot: 2,
    damage: 35,
    fireRate: 5.7,
    magazine: 12,
    reserve: 48,
    reload: 2.2,
    spread: 0.009,
    recoil: 0.58,
    range: 55,
    moveSpeed: 1.04,
    killReward: 300,
    armorRatio: 0.5,
    team: "CT",
  }),
  deagle: firearm({
    id: "deagle",
    name: "Raptor .50",
    class: "pistol",
    price: 700,
    slot: 2,
    damage: 63,
    fireRate: 4.1,
    magazine: 7,
    reserve: 35,
    reload: 2.2,
    spread: 0.012,
    recoil: 1.65,
    range: 70,
    moveSpeed: 0.96,
    killReward: 300,
    armorRatio: 0.82,
  }),
  mp7: firearm({
    id: "mp7",
    name: "MP7",
    class: "smg",
    price: 1500,
    slot: 1,
    damage: 29,
    fireRate: 12.5,
    magazine: 30,
    reserve: 120,
    reload: 2.4,
    spread: 0.023,
    recoil: 0.56,
    range: 42,
    moveSpeed: 1.02,
    killReward: 600,
    armorRatio: 0.62,
    automatic: true,
  }),
  p90: firearm({
    id: "p90",
    name: "P90",
    class: "smg",
    price: 2350,
    slot: 1,
    damage: 27,
    fireRate: 14.2,
    magazine: 50,
    reserve: 100,
    reload: 3.15,
    spread: 0.028,
    recoil: 0.48,
    range: 40,
    moveSpeed: 1,
    killReward: 300,
    armorRatio: 0.69,
    automatic: true,
  }),
  nova: firearm({
    id: "nova",
    name: "M590",
    class: "shotgun",
    price: 1050,
    slot: 1,
    damage: 22,
    fireRate: 1.05,
    magazine: 8,
    reserve: 32,
    reload: 0.58,
    spread: 0.08,
    recoil: 1.7,
    range: 19,
    moveSpeed: 0.97,
    killReward: 900,
    armorRatio: 0.5,
    pellets: 8,
  }),
  galil: firearm({
    id: "galil",
    name: "GR-21",
    class: "rifle",
    price: 1800,
    slot: 1,
    damage: 30,
    fireRate: 11,
    magazine: 35,
    reserve: 90,
    reload: 3,
    spread: 0.018,
    recoil: 0.87,
    range: 72,
    moveSpeed: 0.95,
    killReward: 300,
    armorRatio: 0.77,
    automatic: true,
    team: "T",
  }),
  famas: firearm({
    id: "famas",
    name: "FAMAS",
    class: "rifle",
    price: 2050,
    slot: 1,
    damage: 30,
    fireRate: 11.1,
    magazine: 25,
    reserve: 90,
    reload: 3.15,
    spread: 0.016,
    recoil: 0.79,
    range: 73,
    moveSpeed: 0.95,
    killReward: 300,
    armorRatio: 0.7,
    automatic: true,
    team: "CT",
  }),
  ak47: firearm({
    id: "ak47",
    name: "AK-47",
    class: "rifle",
    price: 2700,
    slot: 1,
    damage: 36,
    fireRate: 10,
    magazine: 30,
    reserve: 90,
    reload: 2.45,
    spread: 0.015,
    recoil: 1.08,
    range: 82,
    moveSpeed: 0.93,
    killReward: 300,
    armorRatio: 0.78,
    automatic: true,
    team: "T",
  }),
  m4a1: firearm({
    id: "m4a1",
    name: "M4A1-S",
    class: "rifle",
    price: 2900,
    slot: 1,
    damage: 33,
    fireRate: 10,
    magazine: 25,
    reserve: 75,
    reload: 3.1,
    spread: 0.011,
    recoil: 0.78,
    range: 86,
    moveSpeed: 0.93,
    killReward: 300,
    armorRatio: 0.7,
    automatic: true,
    team: "CT",
  }),
  scout: firearm({
    id: "scout",
    name: "S-08",
    class: "sniper",
    price: 1700,
    slot: 1,
    damage: 88,
    fireRate: 1.15,
    magazine: 10,
    reserve: 90,
    reload: 3.1,
    spread: 0.003,
    recoil: 1.75,
    range: 130,
    moveSpeed: 0.92,
    killReward: 300,
    armorRatio: 0.85,
    zoom: 2.1,
  }),
  awp: firearm({
    id: "awp",
    name: "AWP",
    class: "sniper",
    price: 4750,
    slot: 1,
    damage: 115,
    fireRate: 0.75,
    magazine: 10,
    reserve: 30,
    reload: 3.65,
    spread: 0.001,
    recoil: 2.4,
    range: 160,
    moveSpeed: 0.82,
    killReward: 100,
    armorRatio: 0.97,
    zoom: 2.65,
  }),
  frag: grenade({ id: "frag", name: "破片手雷", price: 300, effect: "frag" }),
  flashbang: grenade({
    id: "flashbang",
    name: "闪光弹",
    price: 200,
    effect: "flash",
  }),
  smoke: grenade({ id: "smoke", name: "烟雾弹", price: 300, effect: "smoke" }),
  incendiary: grenade({
    id: "incendiary",
    name: "燃烧瓶",
    price: 500,
    effect: "fire",
  }),
});

export const EQUIPMENT = Object.freeze({
  kevlar: { id: "kevlar", name: "防弹衣", price: 650, slot: 0 },
  kevlarHelmet: {
    id: "kevlarHelmet",
    name: "防弹衣 + 头盔",
    price: 1000,
    slot: 0,
  },
  defuseKit: { id: "defuseKit", name: "拆弹器", price: 400, slot: 0, team: "CT" },
});

export const BOT_DIFFICULTIES = Object.freeze({
  recruit: Object.freeze({
    name: "新兵",
    reactionMs: 760,
    aimError: 0.16,
    hearingRange: 13,
    utilityChance: 0.12,
    teamwork: 0.28,
    burst: 2,
  }),
  regular: Object.freeze({
    name: "常规",
    reactionMs: 480,
    aimError: 0.095,
    hearingRange: 18,
    utilityChance: 0.3,
    teamwork: 0.48,
    burst: 4,
  }),
  veteran: Object.freeze({
    name: "老兵",
    reactionMs: 285,
    aimError: 0.052,
    hearingRange: 24,
    utilityChance: 0.55,
    teamwork: 0.72,
    burst: 6,
  }),
  elite: Object.freeze({
    name: "精英",
    reactionMs: 145,
    aimError: 0.023,
    hearingRange: 31,
    utilityChance: 0.82,
    teamwork: 0.92,
    burst: 9,
  }),
});

const node = (id, callout, x, z, y = 0, radius = 2.3) => ({
  id,
  callout,
  position: [x, y, z],
  radius,
});

const cover = (id, x, z, w, d, h = 2, y = 0, kind = "crate") => ({
  id,
  position: [x, y, z],
  size: [w, h, d],
  kind,
});

const route = (id, label, team, nodes, purpose) => ({
  id,
  label,
  team,
  nodes,
  purpose,
});

export const DUST2_REQUIRED_AREAS = Object.freeze([
  { id: "tSpawn", callout: "T 出生点" },
  { id: "ctSpawn", callout: "CT 出生点" },
  { id: "aSite", callout: "A 包点" },
  { id: "bSite", callout: "B 包点" },
  { id: "mid", callout: "中路" },
  { id: "aLong", callout: "A 大" },
  { id: "aShort", callout: "A 小" },
  { id: "aPit", callout: "A 坑" },
  { id: "aRamp", callout: "A 斜坡" },
  { id: "midDoors", callout: "中门" },
  { id: "doubleDoors", callout: "双门" },
  { id: "xbox", callout: "Xbox" },
  { id: "bTunnels", callout: "B 洞" },
  { id: "bDoors", callout: "B 门" },
  { id: "bPlatform", callout: "B 平台" },
  { id: "ctMid", callout: "警家" },
  { id: "longDoors", callout: "长门" },
  { id: "aBoxes", callout: "箱体掩体" },
  { id: "sniperLaneMid", callout: "狙击对枪线" },
  { id: "aPlant", callout: "下包点位" },
  { id: "aAnchor", callout: "防守架点" },
  { id: "attackLane", callout: "进攻推进路线" },
  { id: "ctRetake", callout: "CT 回防路线" },
  { id: "tFlank", callout: "T 方绕后路线" },
]);

const dustNodes = [
  node("tSpawn", "T 出生点", 0, 42, 0, 4),
  node("tRamp", "T 斜坡", -2, 34, 1),
  node("longDoors", "长门", -26, 27),
  node("doubleDoors", "双门", -25, 22),
  node("aLong", "A 大", -34, 7),
  node("aPit", "A 坑", -39, -1, -1.5),
  node("attackLane", "进攻推进路线", -29, -12, 0.6),
  node("aRamp", "A 斜坡", -20, -23, 2),
  node("aSite", "A 包点", -10, -28, 4, 4),
  node("aPlant", "下包点位", -9, -28, 4, 2),
  node("aBoxes", "箱体掩体", -4, -27, 4),
  node("aAnchor", "防守架点", -13, -35, 4),
  node("midDoors", "中门", 1, 25),
  node("sniperLaneMid", "狙击对枪线", 1, 17),
  node("mid", "中路", 1, 6, 0.4),
  node("xbox", "Xbox", -7, 8, 1.4),
  node("aShort", "A 小", -12, -7, 2.3),
  node("shortStairs", "A 小楼梯", -14, -16, 3.1),
  node("lowerTunnels", "下层 B 洞", 11, 17, -0.8),
  node("upperTunnels", "上层 B 洞", 24, 29, 1),
  node("bTunnels", "B 洞", 27, 17, 1),
  node("bPlatform", "B 平台", 29, 2, 2.1),
  node("bSite", "B 包点", 25, -5, 2.1, 4),
  node("bPlant", "B 下包点位", 25, -5, 2.1, 2),
  node("bBoxes", "B 箱体掩体", 31, -8, 2.1),
  node("bDoors", "B 门", 13, -2, 0.6),
  node("ctMid", "警家", 2, -10, 1),
  node("ctSpawn", "CT 出生点", 1, -25, 1.6, 4),
  node("ctRetake", "CT 回防路线", 10, -16, 1.4),
  node("tFlank", "T 方绕后路线", 8, 29, -0.2),
];

const dustLinks = [
  ["tSpawn", "tRamp"],
  ["tRamp", "longDoors"],
  ["longDoors", "doubleDoors"],
  ["doubleDoors", "aLong"],
  ["aLong", "aPit"],
  ["aPit", "attackLane"],
  ["attackLane", "aRamp"],
  ["aRamp", "aSite"],
  ["aSite", "aPlant"],
  ["aSite", "aBoxes"],
  ["aSite", "aAnchor"],
  ["tSpawn", "midDoors"],
  ["midDoors", "sniperLaneMid"],
  ["sniperLaneMid", "mid"],
  ["midDoors", "xbox"],
  ["xbox", "aShort"],
  ["aShort", "shortStairs"],
  ["shortStairs", "aSite"],
  ["tSpawn", "upperTunnels"],
  ["upperTunnels", "bTunnels"],
  ["bTunnels", "bPlatform"],
  ["bPlatform", "bSite"],
  ["bSite", "bPlant"],
  ["bSite", "bBoxes"],
  ["tSpawn", "tFlank"],
  ["tFlank", "lowerTunnels"],
  ["lowerTunnels", "mid"],
  ["mid", "bDoors"],
  ["bDoors", "bSite"],
  ["mid", "ctMid"],
  ["ctMid", "ctSpawn"],
  ["ctMid", "aRamp"],
  ["ctSpawn", "aRamp"],
  ["ctSpawn", "ctRetake"],
  ["ctRetake", "bDoors"],
  ["ctSpawn", "bDoors"],
  ["ctSpawn", "aSite"],
];

const dustRoutes = [
  route(
    "aLongExecute",
    "A 大推进",
    "T",
    ["tSpawn", "tRamp", "longDoors", "doubleDoors", "aLong", "aPit", "attackLane", "aRamp", "aSite"],
    "long-range entry and pit control",
  ),
  route(
    "aShortExecute",
    "A 小夹击",
    "T",
    ["tSpawn", "midDoors", "xbox", "aShort", "shortStairs", "aSite"],
    "mid control into elevated A split",
  ),
  route(
    "bTunnelExecute",
    "B 洞爆弹",
    "T",
    ["tSpawn", "upperTunnels", "bTunnels", "bPlatform", "bSite"],
    "close-range tunnel execute",
  ),
  route(
    "midToBSplit",
    "中路夹 B",
    "T",
    ["tSpawn", "midDoors", "sniperLaneMid", "mid", "bDoors", "bSite"],
    "sniper duel into B split",
  ),
  route(
    "ctRetakeA",
    "警家回防 A",
    "CT",
    ["ctSpawn", "ctMid", "aRamp", "aSite"],
    "fast A retake",
  ),
  route(
    "ctRetakeB",
    "警家回防 B",
    "CT",
    ["ctSpawn", "bDoors", "bSite"],
    "door and window crossfire",
  ),
  route(
    "tFlank",
    "T 方绕后",
    "T",
    ["tSpawn", "tFlank", "lowerTunnels", "mid", "ctMid", "ctSpawn"],
    "late CT spawn flank",
  ),
];

const makeMap = ({
  id,
  name,
  subtitle,
  scale,
  palette,
  nodes,
  links,
  routes,
  cover: coverItems,
  sites,
  spawns,
  bounds,
  architecture,
  ambient,
}) => ({
  id,
  name,
  subtitle,
  scale,
  palette,
  nodes,
  links,
  routes,
  cover: coverItems,
  sites,
  spawns,
  bounds,
  architecture,
  ambient,
});

const dustCover = [
  cover("longCrates", -31, 4, 4, 3, 2.4),
  cover("pitWall", -40, -3, 5, 2, 1.3, -1.2, "stone"),
  cover("aGoose", -15, -35, 5, 2, 2.6, 4, "stone"),
  cover("aTriple", -5, -28, 4.8, 4.8, 3.2, 4, "crate"),
  cover("aRampBox", -18, -21, 2.8, 2.8, 2.6, 2, "crate"),
  cover("xboxCover", -7, 8, 3.8, 3.8, 2.7, 0, "crate"),
  cover("midDoorWing", 5, 17, 2, 6, 3, 0, "stone"),
  cover("bCar", 20, -11, 4.8, 2.2, 1.5, 2.1, "vehicle"),
  cover("bDoubleStack", 31, -8, 4, 4, 3.8, 2.1, "crate"),
  cover("bPlatformCrate", 29, 1, 3, 3, 2.6, 2.1, "crate"),
  cover("ctBoxes", 7, -18, 3.4, 3.4, 2.8, 1.4, "crate"),
  cover("tSpawnBoxes", -7, 39, 4, 3, 2.6, 0, "crate"),
];

const ironNodes = [
  node("tSpawn", "T 装卸区", 0, 38),
  node("fork", "运输岔路", 0, 26),
  node("aLobby", "A 厅", -18, 21),
  node("aSqueaky", "A 铁门", -25, 10),
  node("aCatwalk", "A 天桥", -13, 5, 3),
  node("aSite", "A 熔炉点", -24, -7, 0, 4),
  node("aPlant", "A 下包区", -24, -7),
  node("mid", "传送带中路", 0, 11, 1),
  node("midBridge", "中路吊桥", 3, 0, 3),
  node("vents", "通风管", 12, 8, 2),
  node("bHall", "B 锻造厅", 19, 18),
  node("bRamp", "B 斜道", 25, 6, 1),
  node("bSite", "B 铁轨点", 25, -10, 0, 4),
  node("bPlant", "B 下包区", 25, -10),
  node("ctLink", "CT 连廊", 1, -8, 2),
  node("ctSpawn", "CT 控制室", 0, -24, 1, 4),
  node("aRetake", "A 回防门", -13, -16),
  node("bRetake", "B 回防门", 14, -18),
];

const ironLinks = [
  ["tSpawn", "fork"],
  ["fork", "aLobby"],
  ["aLobby", "aSqueaky"],
  ["aSqueaky", "aSite"],
  ["aLobby", "aCatwalk"],
  ["aCatwalk", "aSite"],
  ["fork", "mid"],
  ["mid", "midBridge"],
  ["midBridge", "ctLink"],
  ["fork", "bHall"],
  ["bHall", "bRamp"],
  ["bRamp", "bSite"],
  ["mid", "vents"],
  ["vents", "bHall"],
  ["ctSpawn", "ctLink"],
  ["ctSpawn", "aRetake"],
  ["aRetake", "aSite"],
  ["ctSpawn", "bRetake"],
  ["bRetake", "bSite"],
  ["ctLink", "aSite"],
  ["ctLink", "bSite"],
  ["aSite", "aPlant"],
  ["bSite", "bPlant"],
];

const monsoonNodes = [
  node("tSpawn", "T 渔港", 0, 42),
  node("harborFork", "渔港岔路", 0, 31),
  node("aLong", "滨海长廊", -25, 23),
  node("aArch", "A 石拱", -32, 10),
  node("aTerrace", "A 露台", -28, -2, 2),
  node("aSite", "A 灯塔点", -26, -14, 2, 4),
  node("aPlant", "A 下包区", -26, -14, 2),
  node("canal", "运河中路", 0, 15, -1),
  node("canalBridge", "运河桥", -1, 2, 2),
  node("marketLink", "市场连接", 10, 4),
  node("bAlley", "B 雨巷", 23, 24),
  node("bMarket", "B 市场", 27, 9),
  node("bBalcony", "B 阳台", 19, 1, 3),
  node("bSite", "B 广场点", 25, -12, 0, 4),
  node("bPlant", "B 下包区", 25, -12),
  node("ctCanal", "CT 运河口", 0, -9),
  node("ctSpawn", "CT 城门", 0, -25, 1, 4),
  node("aRetake", "A 回廊", -14, -18, 1),
  node("bRetake", "B 回廊", 13, -19, 1),
  node("seaFlank", "海堤绕后", -11, 30),
];

const monsoonLinks = [
  ["tSpawn", "harborFork"],
  ["harborFork", "aLong"],
  ["aLong", "aArch"],
  ["aArch", "aTerrace"],
  ["aTerrace", "aSite"],
  ["harborFork", "canal"],
  ["canal", "canalBridge"],
  ["canalBridge", "ctCanal"],
  ["canal", "marketLink"],
  ["marketLink", "bMarket"],
  ["harborFork", "bAlley"],
  ["bAlley", "bMarket"],
  ["bMarket", "bBalcony"],
  ["bBalcony", "bSite"],
  ["ctSpawn", "ctCanal"],
  ["ctSpawn", "aRetake"],
  ["aRetake", "aSite"],
  ["ctSpawn", "bRetake"],
  ["bRetake", "bSite"],
  ["ctCanal", "aSite"],
  ["ctCanal", "bSite"],
  ["harborFork", "seaFlank"],
  ["seaFlank", "aLong"],
  ["aSite", "aPlant"],
  ["bSite", "bPlant"],
];

export const MAPS = Object.freeze({
  dust2: makeMap({
    id: "dust2",
    name: "Dust II 测试场",
    subtitle: "经典双点结构 / 长短线夹击 / 中路控制",
    scale: 1,
    palette: {
      sky: 0xb9c9ce,
      fog: 0xc9b58b,
      ground: 0x9a7950,
      wall: 0xc6a36d,
      trim: 0x5f4a34,
      accent: 0xc85f32,
      light: 0xffd9a1,
    },
    nodes: dustNodes,
    links: dustLinks,
    routes: dustRoutes,
    cover: dustCover,
    sites: [
      { id: "A", node: "aPlant", radius: 5.3 },
      { id: "B", node: "bPlant", radius: 5.1 },
    ],
    spawns: { T: "tSpawn", CT: "ctSpawn" },
    bounds: [-47, 38, -41, 49],
    architecture: "desert",
    ambient: "wind",
  }),
  ironworks: makeMap({
    id: "ironworks",
    name: "钢铁工厂",
    subtitle: "垂直交叉火力 / 快速转点 / 近距爆弹",
    scale: 0.96,
    palette: {
      sky: 0x5e6970,
      fog: 0x42484a,
      ground: 0x353638,
      wall: 0x55585a,
      trim: 0x16191b,
      accent: 0xe1702f,
      light: 0xffb767,
    },
    nodes: ironNodes,
    links: ironLinks,
    routes: [
      route("aHall", "A 厅强攻", "T", ["tSpawn", "fork", "aLobby", "aSqueaky", "aSite"], "tight execute"),
      route("aHigh", "A 天桥夹击", "T", ["tSpawn", "fork", "aLobby", "aCatwalk", "aSite"], "vertical split"),
      route("bRail", "B 铁轨推进", "T", ["tSpawn", "fork", "bHall", "bRamp", "bSite"], "open yard fight"),
      route("midSplit", "中路分割", "T", ["tSpawn", "fork", "mid", "midBridge", "ctLink"], "fast rotation denial"),
      route("ctRetake", "控制室回防", "CT", ["ctSpawn", "ctLink", "aSite"], "short retake"),
    ],
    cover: [
      cover("aFurnace", -26, -4, 6, 4, 4, 0, "machine"),
      cover("aTank", -19, -11, 4, 4, 3, 0, "tank"),
      cover("aCrates", -29, -12, 4, 3, 3),
      cover("midConveyor", 0, 8, 4, 12, 2, 1, "machine"),
      cover("midPallets", 7, 1, 4, 3, 2.4),
      cover("bRailCar", 24, -4, 4, 11, 3, 0, "vehicle"),
      cover("bCoils", 31, -11, 4, 4, 2.2, 0, "machine"),
      cover("bBoxes", 19, -13, 3.5, 3.5, 2.8),
      cover("ctConsole", -4, -21, 5, 2, 2, 1, "machine"),
      cover("forkContainer", -8, 25, 5, 9, 3, 0, "container"),
    ],
    sites: [
      { id: "A", node: "aPlant", radius: 5.2 },
      { id: "B", node: "bPlant", radius: 5.4 },
    ],
    spawns: { T: "tSpawn", CT: "ctSpawn" },
    bounds: [-38, 38, -31, 47],
    architecture: "industrial",
    ambient: "factory",
  }),
  monsoon: makeMap({
    id: "monsoon",
    name: "季风港",
    subtitle: "烟墙控图 / 中距交火 / 慢速绕后",
    scale: 1,
    palette: {
      sky: 0x6a7d84,
      fog: 0x637177,
      ground: 0x3f5552,
      wall: 0x727b74,
      trim: 0x2c3937,
      accent: 0xd1a44a,
      light: 0xb9d4cd,
    },
    nodes: monsoonNodes,
    links: monsoonLinks,
    routes: [
      route("aCoast", "滨海长廊", "T", ["tSpawn", "harborFork", "aLong", "aArch", "aTerrace", "aSite"], "long sightline"),
      route("bMarket", "市场推进", "T", ["tSpawn", "harborFork", "bAlley", "bMarket", "bBalcony", "bSite"], "layered close fight"),
      route("canalSplit", "运河夹击", "T", ["tSpawn", "harborFork", "canal", "marketLink", "bMarket"], "smoke-heavy split"),
      route("seaFlank", "海堤绕后", "T", ["tSpawn", "harborFork", "seaFlank", "aLong"], "slow information flank"),
      route("ctRetake", "城门回防", "CT", ["ctSpawn", "ctCanal", "aSite"], "central retake"),
    ],
    cover: [
      cover("aBoat", -30, 15, 7, 3, 1.8, 0, "vehicle"),
      cover("aFountain", -23, -10, 4, 4, 1.4, 2, "stone"),
      cover("aBoxes", -31, -17, 4, 4, 3, 2),
      cover("canalWall", 1, 8, 3, 11, 1.5, -1, "stone"),
      cover("marketStalls", 26, 8, 8, 3, 2.6, 0, "wood"),
      cover("bStatue", 24, -8, 3, 3, 3.2, 0, "stone"),
      cover("bBoxes", 30, -14, 4, 4, 3),
      cover("bAwning", 18, -1, 5, 3, 2, 3, "wood"),
      cover("ctGate", -5, -21, 4, 3, 2.8, 1, "stone"),
      cover("harborCargo", 8, 33, 5, 8, 3, 0, "container"),
    ],
    sites: [
      { id: "A", node: "aPlant", radius: 5.5 },
      { id: "B", node: "bPlant", radius: 5.3 },
    ],
    spawns: { T: "tSpawn", CT: "ctSpawn" },
    bounds: [-39, 39, -32, 50],
    architecture: "coastal",
    ambient: "rain",
  }),
});

export class RoundRules {
  constructor(overrides = {}) {
    this.freezeTime = overrides.freezeTime ?? 6;
    this.roundTime = overrides.roundTime ?? 115;
    this.plantTime = overrides.plantTime ?? 3.2;
    this.bombTime = overrides.bombTime ?? 40;
    this.defuseTime = overrides.defuseTime ?? 10;
    this.kitDefuseTime = overrides.kitDefuseTime ?? 5;
    this.roundEndTime = overrides.roundEndTime ?? 5;
    this.roundsToWin = overrides.roundsToWin ?? 7;
    this.sideSwapRound = overrides.sideSwapRound ?? 6;
  }
}

export function findRoute(map, startId, targetId) {
  if (startId === targetId) return [startId];
  const adjacency = new Map(map.nodes.map((item) => [item.id, []]));
  for (const [a, b] of map.links) {
    adjacency.get(a)?.push(b);
    adjacency.get(b)?.push(a);
  }
  const queue = [startId];
  const visited = new Set([startId]);
  const previous = new Map();

  while (queue.length) {
    const current = queue.shift();
    for (const neighbor of adjacency.get(current) ?? []) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      previous.set(neighbor, current);
      if (neighbor === targetId) {
        const path = [targetId];
        let cursor = targetId;
        while (previous.has(cursor)) {
          cursor = previous.get(cursor);
          path.unshift(cursor);
        }
        return path;
      }
      queue.push(neighbor);
    }
  }
  return [];
}

export function nodeById(map, id) {
  return map.nodes.find((item) => item.id === id) ?? null;
}

export function spawnFacingYaw(map, team) {
  const spawnId = map.spawns?.[team];
  const spawn = nodeById(map, spawnId);
  if (!spawn) return team === TEAM.T ? Math.PI : 0;
  const exits = map.links
    .filter(([a, b]) => a === spawnId || b === spawnId)
    .map(([a, b]) => nodeById(map, a === spawnId ? b : a))
    .filter(Boolean);
  if (!exits.length) return team === TEAM.T ? Math.PI : 0;
  const direction = exits.reduce(
    (sum, exit) => {
      sum.x += exit.position[0] - spawn.position[0];
      sum.z += exit.position[2] - spawn.position[2];
      return sum;
    },
    { x: 0, z: 0 },
  );
  return Math.atan2(-direction.x, -direction.z);
}

export function calculateLaneWallSpan(
  start,
  end,
  startDegree = 2,
  endDegree = 2,
  minimumLength = 1.8,
) {
  if (startDegree > 3 || endDegree > 3) return null;
  const dx = end.position[0] - start.position[0];
  const dz = end.position[2] - start.position[2];
  const horizontal = Math.hypot(dx, dz);
  const startClearance = Math.max(2.7, start.radius + 1.1);
  const endClearance = Math.max(2.7, end.radius + 1.1);
  const wallLength = horizontal - startClearance - endClearance;
  if (wallLength < minimumLength) return null;
  return {
    horizontal,
    startClearance,
    endClearance,
    wallLength,
    centerT: (startClearance + wallLength / 2) / horizontal,
  };
}

export function itemById(id) {
  return WEAPONS[id] ?? EQUIPMENT[id] ?? null;
}

export function purchaseItems(balance, itemIds) {
  const selected = [];
  let total = 0;
  for (const id of itemIds) {
    const item = itemById(id);
    if (!item) return { ok: false, balance, items: [], reason: "unknown-item" };
    total += item.price;
    selected.push(id);
  }
  if (total > balance) {
    return { ok: false, balance, items: [], reason: "insufficient-funds" };
  }
  return { ok: true, balance: balance - total, items: selected, reason: null };
}

export function roundWinReward(winner, bombState) {
  if (winner === TEAM.T && bombState === "detonated") {
    return ECONOMY.bombDetonationWin;
  }
  if (winner === TEAM.CT && bombState === "defused") {
    return ECONOMY.ctDefuseWin;
  }
  return winner === TEAM.CT ? ECONOMY.ctEliminationWin : ECONOMY.tWin;
}

export function applyRoundEconomy(
  money,
  {
    won,
    winReward = ECONOMY.tWin,
    lossStreak = 0,
    planted = false,
    kills = [],
  },
) {
  const reward = won
    ? winReward
    : ECONOMY.lossBonuses[Math.min(lossStreak, ECONOMY.lossBonuses.length - 1)];
  const plantReward = planted && !won ? ECONOMY.plantTeamBonus : 0;
  const killReward = kills.reduce((sum, kill) => {
    const weapon = WEAPONS[kill.weaponId];
    return sum + (weapon?.killReward ?? 300);
  }, 0);
  return {
    money: Math.min(ECONOMY.maxMoney, money + reward + plantReward + killReward),
    lossStreak: won ? 0 : Math.min(lossStreak + 1, ECONOMY.lossBonuses.length - 1),
  };
}

export function calculateDamage(
  weapon,
  { distance, hitZone, armor = 0, helmet = false },
) {
  const falloff = Math.max(0.58, 1 - Math.max(0, distance - 8) / weapon.range / 2);
  const isHead = hitZone === "head";
  const raw = weapon.damage * falloff * (isHead ? weapon.headMultiplier : 1);
  const protectedHit = armor > 0 && (!isHead || helmet);
  const healthDamage = protectedHit ? raw * weapon.armorRatio : raw;
  const armorDamage = protectedHit ? Math.min(armor, raw - healthDamage) : 0;
  return {
    healthDamage: Math.max(1, Math.round(healthDamage)),
    armorDamage: Math.max(0, Math.round(armorDamage)),
    headshot: isHead,
  };
}

export function clampMoney(value) {
  return Math.max(0, Math.min(ECONOMY.maxMoney, Math.round(value)));
}

export function formatRoundTime(seconds) {
  const safe = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(safe % 60).padStart(2, "0")}`;
}
