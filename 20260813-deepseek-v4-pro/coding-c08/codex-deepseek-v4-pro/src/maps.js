// ============================================================================
// 地图系统：3 张完整爆破地图 + 几何构建、碰撞、导航场、战术点
// 坐标约定：X 东、Y 上、+Z 为北（T 区在南，CT 区在北）；yaw=0 面向 -Z（南）
// ============================================================================

import * as THREE from "three";
import { AABB, clamp, MinHeap, texBrickSand, texBrickPlaster, texConcrete, texWoodPlanks,
  texMetal, texSandGround, texAsphalt, texTileFloor, texCrate, texCamo } from "./util.js";

// ---------------------------------------------------------------------------
// 地图数据 DSL
// ---------------------------------------------------------------------------
function newMapData(meta) {
  return { meta, floors: [], ramps: [], walls: [], decor: [], spawns: { T: [], CT: [] },
    buyZones: { T: [], CT: [] }, tactical: null, steps: [] };
}

// 平面地面；pri=-1 表示基底（被任何显式地面覆盖）
function F(d, x1, z1, x2, z2, y, mat, pri = 0) {
  d.floors.push({ x1: Math.min(x1, x2), z1: Math.min(z1, z2), x2: Math.max(x1, x2), z2: Math.max(z1, z2), y, mat, pri });
}
// 实心墙体/箱体（doorGap: x 向开口；doorGapZ: z 向开口；windowGap: 开窗；railGap: 栏杆缺口）
function W(d, x1, z1, x2, z2, y1, y2, mat, opts = {}) {
  d.walls.push({ x1: Math.min(x1, x2), z1: Math.min(z1, z2), x2: Math.max(x1, x2), z2: Math.max(z1, z2),
    y1: Math.min(y1, y2), y2: Math.max(y1, y2), mat, ...opts });
}
// 斜坡（axis: 沿该轴从起点升到终点）
function R(d, x1, z1, x2, z2, y1, y2, axis, mat, pri = 0) {
  d.ramps.push({ x1: Math.min(x1, x2), z1: Math.min(z1, z2), x2: Math.max(x1, x2), z2: Math.max(z1, z2),
    y1, y2, axis, mat, pri });
}
// 台阶（axis: 'x'/'z'，沿该轴方向上升/下降）
function S(d, x1, z1, x2, z2, y1, y2, axis, mat) {
  d.steps.push({ x1, z1, x2, z2, y1, y2, axis, mat });
}
// 箱体（居中放置）
function CRATE(d, x, z, y, w = 1.4, h = 1.15, ry = 0, mat = "crate") {
  const hw = w / 2, r = Math.abs(Math.sin(ry)) + Math.abs(Math.cos(ry));
  d.walls.push({ x1: x - hw * r, z1: z - hw * r, x2: x + hw * r, z2: z + hw * r, y1: y, y2: y + h, mat });
}
function CYL(d, x, z, y, r = 0.34, h = 0.95, mat = "barrel") {
  d.decor.push({ type: "cyl", x, z, y, r, h, mat });
  d.walls.push({ x1: x - r, z1: z - r, x2: x + r, z2: z + r, y1: y, y2: y + h, mat });
}

// ---------------------------------------------------------------------------
// 地图 1：沙漠之镇 II —— 经典 Dust2 结构复刻
// ---------------------------------------------------------------------------
function mapDust2() {
  const d = newMapData({
    id: "dust2", name: "沙漠之镇 II", desc: "经典 Dust2 复刻",
    sky: 0xc7b489, fog: 0xd9c49a, sun: new THREE.Vector3(0.55, 0.62, 0.3).normalize(),
    amb: 0xd8c9a5, sunColor: 0xffe2ad, ambientKind: "wind",
    bounds: { x1: -40, z1: -52, x2: 44, z2: 52 },
  });
  const BR = "sandBrick", SA = "sand", CR = "crate", BAR = "barrel";

  F(d, -40, -52, 44, 52, -0.35, SA, -1);            // 全图沙地基底
  W(d, -40, -52, 44, -51.2, -0.35, 6, BR);
  W(d, -40, 51.2, 44, 52, -0.35, 6, BR);
  W(d, -40.8, -52, -40, 52, -0.35, 6, BR);
  W(d, 43.2, -52, 44, 52, -0.35, 6, BR);

  // ==================== T 出生点（南侧横廊，y=1.6） ====================
  F(d, -20, -46, 22, -38, 1.6, SA);
  W(d, -20, -46, 22, -45.2, 1.6, 4.9, BR);          // 南墙
  W(d, -14, -38.8, -2, -38, 1.6, 4.9, BR);          // 北墙（长/中之间）
  W(d, 4, -38.8, 15, -38, 1.6, 4.9, BR);            // 北墙（中/洞之间）
  W(d, -20, -46, -19.2, -38, 1.6, 4.9, BR);         // 西墙
  W(d, 21.2, -46, 22, -38, 1.6, 4.9, BR);           // 东墙
  CRATE(d, -16, -42.5, 1.6, 1.5, 1.1);
  CRATE(d, 16.8, -42.5, 1.6, 1.5, 1.1);
  for (let i = 0; i < 9; i++) d.spawns.T.push({ x: -18 + i * 4.5, z: -43.4, y: 1.6, ry: Math.PI });
  d.buyZones.T.push(new AABB(-20, -46, 22, -38));

  // ---------- T→A长：西侧连接走廊 + 长门 ----------
  R(d, -20, -38, -14, -18, 1.6, 0, "z", SA);
  W(d, -22, -38, -21.2, -18, 0, 3.4, BR);
  W(d, -15.8, -38, -15, -18, 0, 3.4, BR);
  W(d, -22, -20.8, -15, -20, 0, 3.4, BR, { doorGap: [-20, -17] });
  d.decor.push({ type: "door", x1: -20, z: -20, w: 1.5, h: 3.0, open: -0.75, mat: "wood" });
  d.decor.push({ type: "door", x1: -17, z: -20, w: 1.5, h: 3.0, open: 0.75, mat: "wood" });

  // ---------- A 长道（长走廊，40m 直线对枪线） ----------
  F(d, -22, -18, -15, 24, 0, SA);
  W(d, -22, -18, -21.2, 24, 0, 3.4, BR);
  W(d, -22, 24, -21.2, 26, 0, 3.4, BR);            // A 区西北角封闭
  W(d, -15.8, -18, -15, 18, 0, 3.4, BR);            // 东墙（坑段南）
  W(d, -15.8, 18, -15, 24, 0, 0.6, BR);             // 坑侧矮护墙
  CRATE(d, -20.2, -6, 0, 1.6, 1.2, 0, CR);
  CRATE(d, -20.2, 18.5, 0, 1.6, 1.2, 0, CR);        // 长角掩体

  // ---------- A 坑（下沉 0.7m） ----------
  F(d, -16, 18, -9, 24, -0.7, SA);
  W(d, -16, 18, -15.2, 24, -0.7, 0.6, BR);
  W(d, -16, 23.2, -9, 24, -0.7, 0.6, BR);
  W(d, -9.8, 18, -9, 24, -0.7, 0.6, BR);
  R(d, -12, 23, -10, 25, -0.7, 0, "z", SA);         // 坑北坡道
  CRATE(d, -14.5, 19.5, -0.7, 1.2, 0.9, 0, CR);

  // ---------- A 包点前庭 ----------
  F(d, -22, 24, -6, 26, 0, SA);

  // ---------- 中路（南起双门，北至 Xbox 路口） ----------
  F(d, -6, -20, 4, 26, 0, SA);
  W(d, -6, -20, -5.2, 22, 0, 4.2, BR);
  W(d, 3.2, -20, 4, -14, 0, 4.2, BR);               // 东墙（留低洞口）
  W(d, 3.2, -8, 4, 26, 0, 4.2, BR);
  W(d, -6, -20.8, 4, -20, 0, 4.2, BR, { doorGap: [-1, 3] }); // 中门（双门）
  d.decor.push({ type: "door", x1: -1, z: -20, w: 1.9, h: 3.1, open: -0.6, mat: "metal" });
  d.decor.push({ type: "door", x1: 3, z: -20, w: 1.9, h: 3.1, open: 0.6, mat: "metal" });
  CRATE(d, 2.2, -5, 0, 1.6, 1.3, 0, CR);
  CRATE(d, -3.8, 12, 0, 1.6, 1.3, 0, CR);

  // ---------- T→中门：自杀坡 ----------
  R(d, -2, -38, 4, -20, 1.6, 0, "z", SA);
  W(d, -2.8, -38, -2, -20, 0, 3.4, BR);
  W(d, 3.2, -38, 4, -20, 0, 3.4, BR);

  // ---------- B 洞（隧道群） ----------
  R(d, 15, -38, 21, -24, 1.6, 2.2, "z", SA);
  W(d, 15, -38, 15.8, -24, 0, 5.2, BR);
  W(d, 20.2, -38, 21, -24, 0, 5.2, BR);
  F(d, 15, -24, 27, -18, 2.2, SA);
  W(d, 21, -24.8, 27, -24, 0, 5.2, BR);
  W(d, 27, -24, 27.8, -18, 0, 5.2, BR);
  W(d, 15, -18.8, 16.6, -18, 0, 5.2, BR);
  W(d, 19.4, -18.8, 21.8, -18, 0, 5.2, BR);
  W(d, 24.2, -18.8, 27, -18, 0, 5.2, BR);
  // 低洞 → 中路
  R(d, 4, -14, 19, -8, 0, 2.2, "x", SA);
  W(d, 4, -14.8, 19, -14, 0, 4.0, BR);
  W(d, 4, -8.8, 19, -8, 0, 4.0, BR);
  // 高洞北段
  F(d, 22, -18, 26, 2, 2.2, SA);
  W(d, 22, -18, 22.8, 2, 0, 5.2, BR);
  W(d, 25.2, -18, 26, 2, 0, 5.2, BR);
  W(d, 22, 1.2, 26, 2, 2.2, 5.2, BR, { doorGap: [22, 24.5] });
  // 高洞东段
  F(d, 22, 2, 28, 6, 2.2, SA);
  W(d, 27.2, 2, 28, 6, 0, 5.2, BR);
  // 上黑段 → B 门
  R(d, 24, 6, 28, 24, 2.2, 0, "z", SA);
  W(d, 24, 6, 24.8, 24, 0, 4.5, BR);
  W(d, 27.2, 6, 28, 24, 0, 4.5, BR);
  W(d, 24, 23.2, 28, 24, 0, 4.5, BR, { doorGap: [24.5, 27.5] });
  d.decor.push({ type: "door", x1: 24.5, z: 24, w: 1.4, h: 3.0, open: -0.7, mat: "metal" });
  d.decor.push({ type: "door", x1: 27.5, z: 24, w: 1.4, h: 3.0, open: 0.7, mat: "metal" });
  CRATE(d, 25.2, 15, 1.15, 1.5, 1.2, 0, CR);

  // ==================== B 包点 ====================
  F(d, 20, 24, 34, 40, 0, SA);
  W(d, 20, 24, 24.5, 24.8, 0, 4.2, BR);             // 南墙（B门西）
  W(d, 27.5, 24, 34, 24.8, 0, 4.2, BR);             // 南墙（B门东）
  W(d, 20, 39.2, 34, 40, 0, 4.2, BR);               // 北墙
  W(d, 33.2, 24, 34, 40, 0, 4.2, BR);               // 东墙
  W(d, 20, 24, 20.8, 30, 0, 4.2, BR);               // 西墙（CT口南）
  W(d, 20, 34, 20.8, 40, 0, 4.2, BR);               // 西墙（CT口北）
  // B 平台
  F(d, 22, 28, 30, 36, 0.45, SA);
  W(d, 22, 28, 30, 36, 0, 0.45, BR);
  CRATE(d, 23.2, 30.5, 0.45, 1.5, 1.2, 0, CR);
  CRATE(d, 23.2, 31.7, 1.65, 1.5, 1.2, 0, CR);
  CRATE(d, 28.6, 33.5, 0.45, 1.5, 1.2, 0, CR);
  // 后平台
  F(d, 30, 36, 34, 40, 0.5, SA);
  W(d, 30, 36, 34, 40, 0, 0.5, BR);
  W(d, 30, 36, 30.8, 40, 0.5, 3.0, BR);
  d.decor.push({ type: "car", x: 28.5, z: 26.3, ry: Math.PI * 0.5 });
  CYL(d, 21.8, 32, 0, 0.36, 1.0, BAR);
  CYL(d, 21.8, 33.2, 0, 0.36, 1.0, BAR);

  // ---------- CT→B 连接道 + 后窗房 ----------
  F(d, 16, 24, 20, 40, 0, SA);
  W(d, 16, 24, 16.8, 40, 0, 3.6, BR);
  F(d, 16, 40, 30, 44, 0, SA);
  W(d, 16, 39.2, 30, 40, 0, 4.0, BR, { windowGap: [24, 27] });
  W(d, 16, 43.2, 30, 44, 0, 4.0, BR);
  W(d, 29.2, 40, 30, 44, 0, 4.0, BR);
  CRATE(d, 18, 38, 0, 1.4, 1.1, 0, CR);

  // ==================== 中路顶 / Xbox 路口 ====================
  F(d, -6, 22, 20, 28, 0, SA);
  W(d, 4, 21.2, 20, 22, 0, 4.2, BR);                // 路口南墙（中路开口 x-6..4）
  CRATE(d, 2.5, 23.5, 0, 2.6, 2.25, 0, "xbox");
  CRATE(d, 0.6, 23.2, 0, 0.9, 0.42, 0, "concrete");
  // CT 中路坡
  R(d, 10, 22, 14, 26, 0, 2.2, "z", "concrete");
  W(d, 10, 22, 10.8, 26, 0, 3.2, "concrete");

  // ==================== 短梯（猫道） ====================
  S(d, -2, 22, -6, 25, 0, 2.4, "x", "concrete");
  F(d, -13, 22, -6, 25, 2.4, "concrete");
  W(d, -13, 21.2, -6, 22, 2.4, 4.8, BR);            // 南护栏
  W(d, -10, 24.2, -6, 25, 2.4, 4.8, BR);            // 北护栏（留台阶口）
  S(d, -13, 25, -10, 28, 2.4, 0, "z", "concrete");
  CRATE(d, -11.5, 23.2, 2.4, 1.3, 1.0, 0, CR);

  // ==================== A 包点 ====================
  F(d, -22, 26, -6, 38, 0, SA);
  W(d, -22, 25.2, -13, 26, 0, 3.8, BR);             // A 南墙西
  W(d, -10, 25.2, -2, 26, 0, 3.8, BR);              // A 南墙东
  W(d, -22, 37.2, -20, 38, 0, 4.0, BR);             // A 北墙西
  W(d, -13, 37.2, -6, 38, 0, 4.0, BR);              // A 北墙东
  W(d, -6.8, 26, -6, 38, 0, 4.0, BR);               // A 东墙
  W(d, -22, 26, -21.2, 38, 0, 4.0, BR);             // A 西墙
  W(d, -10, 30, -9.2, 38, 0, 3.6, BR);              // 鹅位墙
  CRATE(d, -14.5, 33, 0, 1.7, 1.3, 0, CR);
  CRATE(d, -16, 33, 0, 1.7, 1.3, 0, CR);
  CYL(d, -12.5, 35.5, 0, 0.34, 0.95, BAR);
  CYL(d, -11.8, 36.2, 0, 0.34, 0.95, BAR);
  CRATE(d, -9.5, 28.5, 0, 1.4, 1.1, 0, CR);

  // ---------- A 坡（A 区 → CT 平台） ----------
  R(d, -20, 38, -13, 42, 0, 2.2, "z", "concrete");
  F(d, -20, 42, -13, 44, 2.2, "concrete");
  W(d, -20, 38, -19.2, 44, 0, 3.4, "concrete");
  W(d, -13.8, 38, -13, 42, 0, 3.4, "concrete");
  W(d, -20, 43.2, -13, 44, 2.2, 4.6, "concrete");

  // ==================== CT 平台（警家 + 中庭） ====================
  F(d, -13, 26, 14, 44, 2.2, "concrete");
  W(d, -10, 25.2, 10, 26, 0, 2.2, "concrete");      // 南挡土墙
  W(d, -10, 25.2, 10, 26, 2.2, 4.8, "concrete");    // 南护栏
  W(d, 14, 26, 14.8, 44, 2.2, 4.6, "concrete");     // 东墙
  W(d, 14.8, 27.2, 16, 28, 0, 4.2, "concrete");     // 路口东北角封闭
  W(d, -13, 43.2, 14, 44, 2.2, 4.6, "concrete");    // 北墙
  W(d, -6.8, 26, -6, 38, 2.2, 3.0, "concrete");     // A区东墙顶
  CRATE(d, -2, 29, 2.2, 1.5, 1.2, 0, CR);
  CRATE(d, 5, 33, 2.2, 1.5, 1.2, 0, CR);
  CYL(d, 7.5, 30, 2.2, 0.34, 0.95, BAR);
  for (let i = 0; i < 10; i++) d.spawns.CT.push({ x: -6 + i * 2.2, z: 41.5, y: 2.2, ry: 0 });
  d.buyZones.CT.push(new AABB(-13, 26, 14, 44));

  // ---------- 战术数据 ----------
  d.tactical = {
    sites: {
      A: { name: "A 包点", center: { x: -14, z: 32 }, plantArea: new AABB(-21, 27, -7, 37) },
      B: { name: "B 包点", center: { x: 26, z: 32 }, plantArea: new AABB(21, 25, 33, 39) },
    },
    routes: [
      { name: "A 长", site: "A", entries: [{ x: -19, z: 0 }, { x: -19, z: 15 }], weight: 1 },
      { name: "A 短", site: "A", entries: [{ x: -1, z: 12 }, { x: -1, z: 20 }, { x: -11, z: 23 }], weight: 0.8 },
      { name: "中路控图", site: "A", entries: [{ x: 0, z: 18 }, { x: 2, z: 22 }], weight: 0.7 },
      { name: "B 洞", site: "B", entries: [{ x: 24, z: -5 }, { x: 26, z: 8 }, { x: 26, z: 18 }], weight: 1 },
      { name: "低洞转中", site: "B", entries: [{ x: 9, z: -11 }, { x: 0, z: -11 }], weight: 0.6 },
    ],
    holds: [
      { site: "A", spots: [
        { name: "长角", pos: { x: -20.5, z: 20.5, y: 0 }, ry: 0 },
        { name: "A 坑", pos: { x: -13.5, z: 20.5, y: -0.7 }, ry: Math.PI * 0.5 },
        { name: "鹅位", pos: { x: -8.3, z: 36.2, y: 0 }, ry: Math.PI * 0.5 },
        { name: "默认箱", pos: { x: -13.5, z: 29.5, y: 0 }, ry: 0 },
        { name: "短梯", pos: { x: -10.8, z: 29.5, y: 0 }, ry: -Math.PI * 0.25 },
      ]},
      { site: "mid", spots: [
        { name: "Xbox 上", pos: { x: 2.5, z: 24.6, y: 2.25 }, ry: 0 },
        { name: "CT 中路", pos: { x: 12, z: 23.5, y: 0 }, ry: 0 },
        { name: "中门远架", pos: { x: -4.5, z: -16, y: 0 }, ry: 0 },
      ]},
      { site: "B", spots: [
        { name: "平台", pos: { x: 26, z: 31.5, y: 0.45 }, ry: 0 },
        { name: "车后", pos: { x: 27, z: 25.5, y: 0 }, ry: 0 },
        { name: "后窗", pos: { x: 25.5, z: 41.5, y: 0 }, ry: 0 },
        { name: "后台", pos: { x: 31.8, z: 38.5, y: 0.5 }, ry: Math.PI * 0.25 },
      ]},
    ],
    plants: {
      A: [{ x: -13.5, z: 33.5 }, { x: -15, z: 35.5 }, { x: -10.5, z: 32 }],
      B: [{ x: 25, z: 31.5 }, { x: 28, z: 33.5 }, { x: 24, z: 34.5 }],
    },
    nades: [
      { name: "T 中门烟", team: "T", pos: { x: 1.5, z: -22 }, target: { x: 0, z: 4 }, type: "smoke" },
      { name: "CT 中门烟", team: "CT", pos: { x: -3, z: -18 }, target: { x: -1, z: -12 }, type: "smoke" },
      { name: "T 闪 A 长", team: "T", pos: { x: -19, z: -2 }, target: { x: -18, z: 12 }, type: "flash" },
      { name: "T 火 B 平台", team: "T", pos: { x: 25, z: 22 }, target: { x: 26, z: 31 }, type: "molotov" },
      { name: "CT 火 A 长", team: "CT", pos: { x: -18, z: 22 }, target: { x: -19, z: 8 }, type: "molotov" },
      { name: "CT 炸 B 洞", team: "CT", pos: { x: 24, z: 26 }, target: { x: 25, z: 19 }, type: "he" },
    ],
  };
  return d;
}

// ---------------------------------------------------------------------------
// 地图 2：熔铸厂 —— 工业厂房（A 室内立体 / B 开阔货场）
// ---------------------------------------------------------------------------
function mapFoundry() {
  const d = newMapData({
    id: "foundry", name: "熔铸厂", desc: "工业厂区 · 立体夹层",
    sky: 0x8a8f94, fog: 0x9ba0a5, sun: new THREE.Vector3(0.35, 0.6, 0.25).normalize(),
    amb: 0x9aa1a8, sunColor: 0xf2e6c8, ambientKind: "hum",
    bounds: { x1: -44, z1: -50, x2: 44, z2: 44 },
  });
  const CO = "concrete", MT = "metal", CR = "crate", BAR = "barrel", AS = "asphalt";

  F(d, -44, -50, 44, 44, -0.3, AS, -1);
  W(d, -44, -50, 44, -49.2, -0.3, 6, CO);
  W(d, -44, 43.2, 44, 44, -0.3, 6, CO);
  W(d, -44.8, -50, -44, 44, -0.3, 6, CO);
  W(d, 43.2, -50, 44, 44, -0.3, 6, CO);

  // ====== 主厂房（北侧，A 点在内，含夹层） ======
  F(d, -36, -16, 20, 36, 0, CO);
  W(d, -36, -16, -35.2, 36, 0, 6.5, CO);
  W(d, 19.2, -16, 20, 24, 0, 6.5, CO);
  W(d, 19.2, 28, 20, 36, 0, 6.5, CO);
  W(d, -36, 35.2, 20, 36, 0, 6.5, CO);
  W(d, -36, -16.8, -26, -16, 0, 6.5, CO);           // 南墙西段
  W(d, -32, -16.8, 4, -16, 0, 6.5, CO);             // 南墙中段（A门）
  W(d, 10, -16.8, 20, -16, 0, 6.5, CO);             // 南墙东段（中门）
  // 内部隔墙（A 区 / 东厅）
  W(d, -2, -16, -1.2, 36, 0, 5.5, CO, { doorGapZ: [10, 16] });
  // 夹层
  F(d, -36, 26, -20, 30, 3, CO);
  F(d, -32, -8, -28, 26, 3, CO);
  W(d, -36, 26, -20, 26.8, 3, 4.2, MT);
  W(d, -28.8, -8, -28, 26, 3, 4.2, MT);
  S(d, -34, 22, -30, 26, 0, 3, "z", CO);
  S(d, -32, -8, -28, -4, 0, 3, "x", CO);
  // A 点陈设
  W(d, -34, 30, -28, 35, 0, 3.8, "furnace");
  CRATE(d, -31, 22, 0, 2.2, 1.6, 0.15, CR);
  CRATE(d, -33, 21, 0, 2.2, 1.6, -0.1, CR);
  CRATE(d, -28, 19, 0, 1.6, 1.3, 0, CR);
  CYL(d, -25, 32, 0, 0.36, 1.0, BAR);
  CYL(d, -23.5, 32.5, 0, 0.36, 1.0, BAR);
  d.decor.push({ type: "pipe", x1: -26, z1: 34, x2: -22, z2: 34, y: 2.4, r: 0.18 });
  d.decor.push({ type: "pipe", x1: -22, z1: 30, x2: -22, z2: 34, y: 2.4, r: 0.18 });

  // ====== 东厅（厂房东半，中路战场） ======
  CRATE(d, 6, 2, 0, 1.8, 1.4, 0.3, CR);
  CRATE(d, 6, 14, 0, 1.6, 1.2, 0, CR);
  CRATE(d, 14, 8, 0, 1.6, 1.2, 0, CR);

  // ====== 南侧货场（B 点，开阔长线） ======
  F(d, -36, -44, 40, -16, 0, AS);
  W(d, -36, -44, -35.2, -16, 0, 4.5, CO);
  W(d, 39.2, -44, 40, -16, 0, 4.5, CO);
  W(d, -36, -44.8, 40, -44, 0, 5.5, CO);
  W(d, 2, -40, 10, -34, 0, 2.9, "container");
  W(d, 12, -36, 20, -30, 0, 2.9, "containerR");
  W(d, 22, -42, 30, -36, 0, 2.9, "container");
  CRATE(d, 6, -30, 0, 1.6, 1.3, 0, CR);
  CYL(d, 18, -42, 0, 0.36, 1.0, BAR);
  CYL(d, 19, -43, 0, 0.36, 1.0, BAR);
  d.decor.push({ type: "pipe", x1: -18, z1: -30, x2: -18, z2: -20, y: 1.2, r: 0.22 });
  d.decor.push({ type: "pipe", x1: -18, z1: -30, x2: -6, z2: -30, y: 1.2, r: 0.22 });

  // ====== T 出生（货场西南角） ======
  F(d, -36, -42, -24, -34, 0, AS);
  W(d, -36, -42, -35.2, -34, 0, 4.5, CO);
  W(d, -36, -34.8, -30, -34, 0, 4.5, CO);           // 北墙（口西）
  W(d, -34, -34.8, -24, -34, 0, 4.5, CO);           // 北墙（口东）
  W(d, -24.8, -42, -24, -38, 0, 4.5, CO);           // 东墙南
  W(d, -24.8, -36, -24, -34, 0, 4.5, CO);           // 东墙北
  CRATE(d, -33, -39, 0, 1.6, 1.3, 0, CR);
  d.spawns.T.push({ x: -33, z: -40, y: 0, ry: Math.PI }, { x: -30, z: -40, y: 0, ry: Math.PI },
    { x: -27, z: -40, y: 0, ry: Math.PI }, { x: -33, z: -37, y: 0, ry: Math.PI },
    { x: -30, z: -37, y: 0, ry: Math.PI }, { x: -27, z: -37, y: 0, ry: Math.PI },
    { x: -32, z: -35, y: 0, ry: Math.PI }, { x: -28, z: -35, y: 0, ry: Math.PI });
  d.buyZones.T.push(new AABB(-36, -42, -24, -34));

  // ====== CT 出生（东北办公楼） ======
  F(d, 20, 20, 40, 36, 0, CO);
  W(d, 20, 20, 20.8, 24, 0, 4.5, CO);               // 西门南
  W(d, 20, 28, 20.8, 36, 0, 4.5, CO);               // 西门北
  W(d, 39.2, 20, 40, 36, 0, 4.5, CO);
  W(d, 20, 35.2, 40, 36, 0, 4.5, CO);
  W(d, 20, 20, 28, 20.8, 0, 4.5, CO);               // 南墙西
  W(d, 34, 20, 40, 20.8, 0, 4.5, CO);               // 南墙东
  W(d, 20, 20, 40, 20.8, 0, 4.5, CO, { windowGap: [28, 34] });
  CRATE(d, 25, 30, 0, 1.6, 1.3, 0, CR);
  CYL(d, 36, 24, 0, 0.36, 1.0, BAR);
  d.spawns.CT.push({ x: 24, z: 33, y: 0, ry: Math.PI * 0.5 }, { x: 28, z: 33, y: 0, ry: Math.PI * 0.5 },
    { x: 32, z: 33, y: 0, ry: Math.PI * 0.5 }, { x: 25, z: 29, y: 0, ry: Math.PI * 0.5 },
    { x: 29, z: 29, y: 0, ry: Math.PI * 0.5 }, { x: 33, z: 29, y: 0, ry: Math.PI * 0.5 },
    { x: 36, z: 32, y: 0, ry: Math.PI }, { x: 36, z: 28, y: 0, ry: Math.PI });
  d.buyZones.CT.push(new AABB(20, 20, 40, 36));

  d.tactical = {
    sites: {
      A: { name: "A 熔炉区", center: { x: -29, z: 24 }, plantArea: new AABB(-35, 18, -22, 35) },
      B: { name: "B 货场", center: { x: 12, z: -36 }, plantArea: new AABB(-8, -43, 32, -18) },
    },
    routes: [
      { name: "西侧夹层", site: "A", entries: [{ x: -30, z: -2 }, { x: -30, z: 10 }], weight: 1 },
      { name: "A 门主攻", site: "A", entries: [{ x: -28, z: -14 }, { x: -20, z: -8 }], weight: 0.9 },
      { name: "中路过厂房", site: "A", entries: [{ x: 7, z: -14 }, { x: 7, z: 2 }, { x: 7, z: 14 }], weight: 0.8 },
      { name: "货场包抄", site: "B", entries: [{ x: -5, z: -38 }, { x: 5, z: -38 }], weight: 1 },
      { name: "东路夹击", site: "B", entries: [{ x: 16, z: -28 }, { x: 30, z: -32 }], weight: 0.8 },
    ],
    holds: [
      { site: "A", spots: [
        { name: "夹层瞭望", pos: { x: -30, z: 28.5, y: 3 }, ry: 0 },
        { name: "熔炉角", pos: { x: -26.5, z: 31.5, y: 0 }, ry: 0 },
        { name: "料堆", pos: { x: -31.5, z: 20.5, y: 0 }, ry: 0 },
        { name: "隔墙门", pos: { x: -5.5, z: 8, y: 0 }, ry: -Math.PI * 0.5 },
      ]},
      { site: "mid", spots: [
        { name: "东厅北", pos: { x: 7, z: 22, y: 0 }, ry: 0 },
        { name: "东厅南", pos: { x: 7, z: -13, y: 0 }, ry: Math.PI },
      ]},
      { site: "B", spots: [
        { name: "集箱北", pos: { x: 7, z: -32, y: 0 }, ry: 0 },
        { name: "办公楼窗", pos: { x: 31, z: 21.5, y: 0 }, ry: 0 },
        { name: "东墙角", pos: { x: 37, z: -22, y: 0 }, ry: Math.PI * 0.5 },
        { name: "集装箱后", pos: { x: 25, z: -38.5, y: 0 }, ry: Math.PI },
      ]},
    ],
    plants: {
      A: [{ x: -30, z: 26 }, { x: -33, z: 23 }, { x: -26, z: 20 }],
      B: [{ x: 7, z: -34 }, { x: 14, z: -38 }, { x: 25, z: -39 }],
    },
    nades: [
      { name: "T 闪厂房", team: "T", pos: { x: -28, z: -18 }, target: { x: -25, z: -6 }, type: "flash" },
      { name: "T 烟东厅", team: "T", pos: { x: 8, z: -18 }, target: { x: 7, z: 0 }, type: "smoke" },
      { name: "CT 火夹层梯", team: "CT", pos: { x: -25, z: 27 }, target: { x: -31, z: 24 }, type: "molotov" },
      { name: "CT 烟货场", team: "CT", pos: { x: 24, z: 22 }, target: { x: 12, z: -34 }, type: "smoke" },
    ],
  };
  return d;
}

// ---------------------------------------------------------------------------
// 地图 3：地下铁 —— 地铁站（A 长站台 / B 维护隧道近战）
// ---------------------------------------------------------------------------
function mapSubway() {
  const d = newMapData({
    id: "subway", name: "地下铁", desc: "地铁站 · 长线对枪",
    sky: 0x4b4f57, fog: 0x6a6f78, sun: new THREE.Vector3(0.3, 0.75, 0.4).normalize(),
    amb: 0x8d94a0, sunColor: 0xfff0d0, ambientKind: "hum",
    bounds: { x1: -50, z1: -40, x2: 44, z2: 44 },
  });
  const CO = "concrete", TI = "tile", MT = "metal", CR = "crate", BAR = "barrel", AS = "asphalt";

  F(d, -50, -40, 44, 44, -0.3, AS, -1);
  W(d, -50, -40, 44, -39.2, -0.3, 6, CO);
  W(d, -50, 43.2, 44, 44, -0.3, 6, CO);
  W(d, -50.8, -40, -50, 44, -0.3, 6, CO);
  W(d, 43.2, -40, 44, 44, -0.3, 6, CO);

  // ====== 站台层：北站台 / 轨道 / 南站台 ======
  F(d, -40, -24, 40, -6, 0, TI);                    // 北站台
  F(d, -40, -6, 40, 6, -1.2, CO);                   // 轨道
  F(d, -40, 6, 40, 40, 0, TI);                      // 南站台
  W(d, -40, -24, -28, -23.2, 0, 4.2, CO);           // 北墙（B口西）
  W(d, -24, -24, 40, -23.2, 0, 4.2, CO);            // 北墙（B口东）
  W(d, -40, -6.8, -26, -6, -1.2, 0, CO);            // 轨道北缘西
  W(d, -22, -6.8, 32, -6, -1.2, 0, CO);             // 轨道北缘中
  W(d, 36, -6.8, 40, -6, -1.2, 0, CO);              // 轨道北缘东
  W(d, -40, 5.2, -26, 6, -1.2, 0, CO);              // 轨道南缘西
  W(d, -22, 5.2, 32, 6, -1.2, 0, CO);               // 轨道南缘中
  W(d, 36, 5.2, 40, 6, -1.2, 0, CO);                // 轨道南缘东
  W(d, -40.8, -24, -40, -6, 0, 6.0, CO);            // 站西墙（北平台）
  W(d, -40.8, -6, -40, 6, -1.2, 6.0, CO);           // 站西墙（轨道）
  W(d, -40.8, 6, -40, 20, 0, 6.0, CO);              // 站西墙（南平台南）
  W(d, -40.8, 20, -40, 40, 0, 6.0, CO);             // 站西墙（南平台北）
  W(d, 39.2, -24, 40, 40, 0, 6.0, CO);              // 站东墙
  // 月台柱列
  for (let i = -3; i <= 3; i++) {
    W(d, i * 12 - 1, -14, i * 12 + 1, -10, 0, 3.6, TI);
    if (i !== 2) W(d, i * 12 - 1, 16, i * 12 + 1, 20, 0, 3.6, TI);
  }
  CRATE(d, -36, -19, 0, 1.6, 1.3, 0, CR);
  CRATE(d, -20, -19, 0, 1.6, 1.3, 0, CR);
  CRATE(d, 24, -18.5, 0, 1.6, 1.3, 0, CR);
  CYL(d, -2, -19, 0, 0.36, 1.0, BAR);
  d.decor.push({ type: "bench", x: -8, z: 17, ry: 0 });
  d.decor.push({ type: "bench", x: 8, z: 17, ry: 0 });
  // 轨道台阶（两处横跨）
  S(d, -26, -6, -22, 0, 0, -1.2, "z", CO);
  S(d, -26, 0, -22, 6, -1.2, 0, "z", CO);
  S(d, 32, -6, 36, 0, 0, -1.2, "z", CO);
  S(d, 32, 0, 36, 6, -1.2, 0, "z", CO);
  // 列车
  W(d, -21, -1.5, -5, 1.5, -0.2, 2.6, "trainBody");
  W(d, 12, -1.5, 28, 1.5, -0.2, 2.6, "trainBody");
  d.decor.push({ type: "train", x: -13, z: 0, len: 16, ry: 0 });
  d.decor.push({ type: "train", x: 20, z: 0, len: 16, ry: 0 });

  // ====== B 维护隧道（西北，近战） ======
  F(d, -44, -32, -20, -24, 0, CO);
  W(d, -44, -32, -43.2, -24, 0, 4.0, CO, { doorGapZ: [-30, -26] }); // 西墙（走廊口）
  W(d, -44, -32, -20, -31.2, 0, 4.0, CO);
  W(d, -44, -24.8, -28, -24, 0, 4.0, CO);           // 南墙西
  W(d, -24, -24.8, -20, -24, 0, 4.0, CO);           // 南墙东
  W(d, -20.8, -32, -20, -24, 0, 4.0, CO);           // 东墙
  CRATE(d, -40, -28, 0, 1.6, 1.3, 0, CR);
  CYL(d, -26, -28, 0, 0.36, 1.0, BAR);
  d.decor.push({ type: "pipe", x1: -42, z1: -26, x2: -34, z2: -26, y: 1.8, r: 0.2 });
  d.decor.push({ type: "pipe", x1: -42, z1: -29, x2: -34, z2: -29, y: 1.8, r: 0.2 });

  // ====== 西侧走廊（T→B 绕后） ======
  F(d, -44, -32, -40, 24, 0, CO);
  W(d, -44, -32, -43.2, 24, 0, 4.2, CO);
  W(d, -44, 23.2, -40, 24, 0, 4.2, CO);

  // ====== 票务大厅（二层） ======
  F(d, -16, 16, 16, 40, 3, TI);
  W(d, -16, 16, -15.2, 40, 3, 6.2, TI);
  W(d, 15.2, 16, 16, 40, 3, 6.2, TI);
  W(d, -16, 39.2, 16, 40, 3, 6.2, TI, { windowGap: [-8, 8] });
  W(d, -16, 16, -6, 16.8, 3, 6.2, TI);
  W(d, -2, 16, 2, 16.8, 3, 6.2, TI);
  W(d, 6, 16, 16, 16.8, 3, 6.2, TI);
  S(d, -6, 12, -2, 16, 0, 3, "z", CO);
  S(d, 2, 12, 6, 16, 0, 3, "z", CO);
  CRATE(d, -10, 34, 3, 1.6, 1.3, 0, CR);
  CRATE(d, 10, 36, 3, 1.6, 1.3, 0, CR);
  d.decor.push({ type: "ticket", x: 0, z: 36, ry: Math.PI });

  // ====== T 出生（东南隧道口） ======
  F(d, 24, 12, 40, 40, 0, CO);
  W(d, 24, 12, 24.8, 15, 0, 4.2, CO);
  W(d, 24, 25, 24.8, 40, 0, 4.2, CO);
  W(d, 39.2, 12, 40, 40, 0, 4.2, CO);
  W(d, 24, 39.2, 40, 40, 0, 4.2, CO);
  CRATE(d, 28, 34, 0, 1.6, 1.3, 0, CR);
  d.spawns.T.push({ x: 27, z: 36, y: 0, ry: Math.PI * 0.5 }, { x: 31, z: 36, y: 0, ry: Math.PI * 0.5 },
    { x: 35, z: 36, y: 0, ry: Math.PI * 0.5 }, { x: 28, z: 31, y: 0, ry: Math.PI * 0.5 },
    { x: 32, z: 31, y: 0, ry: Math.PI * 0.5 }, { x: 36, z: 31, y: 0, ry: Math.PI * 0.5 },
    { x: 30, z: 26, y: 0, ry: Math.PI * 0.5 }, { x: 34, z: 26, y: 0, ry: Math.PI * 0.5 });
  d.buyZones.T.push(new AABB(24, 12, 40, 40));

  // ====== CT 出生（西北站台端） ======
  F(d, -40, -24, -28, -6, 0, TI);
  W(d, -40, -24, -39.2, -6, 0, 4.2, CO);
  W(d, -28.8, -24, -28, -20, 0, 4.2, CO);
  W(d, -28.8, -10, -28, -6, 0, 4.2, CO);
  CRATE(d, -36, -19, 0, 1.6, 1.3, 0, CR);
  CYL(d, -32, -8, 0, 0.36, 1.0, BAR);
  d.spawns.CT.push({ x: -36, z: -8, y: 0, ry: Math.PI * 1.5 }, { x: -32, z: -8, y: 0, ry: Math.PI * 1.5 },
    { x: -36, z: -16, y: 0, ry: Math.PI * 1.5 }, { x: -32, z: -16, y: 0, ry: Math.PI * 1.5 },
    { x: -35, z: -12, y: 0, ry: Math.PI * 1.5 }, { x: -31, z: -12, y: 0, ry: Math.PI * 1.5 },
    { x: -35, z: -20, y: 0, ry: Math.PI * 1.5 }, { x: -31, z: -20, y: 0, ry: Math.PI * 1.5 });
  d.buyZones.CT.push(new AABB(-40, -24, -28, -6));

  d.tactical = {
    sites: {
      A: { name: "A 北站台", center: { x: 2, z: -18 }, plantArea: new AABB(-36, -23, 36, -7) },
      B: { name: "B 维护隧道", center: { x: -32, z: -28 }, plantArea: new AABB(-43, -31, -21, -25) },
    },
    routes: [
      { name: "南站台推进", site: "A", entries: [{ x: 10, z: 18 }, { x: -10, z: 18 }], weight: 1 },
      { name: "轨道突进", site: "A", entries: [{ x: 6, z: 0 }, { x: -6, z: 0 }], weight: 0.8 },
      { name: "大厅夹击", site: "A", entries: [{ x: 0, z: 30 }, { x: -2, z: 17 }], weight: 0.8 },
      { name: "西廊绕后", site: "B", entries: [{ x: -41, z: 14 }, { x: -41, z: 0 }, { x: -41, z: -20 }], weight: 1 },
    ],
    holds: [
      { site: "A", spots: [
        { name: "西端", pos: { x: -35, z: -20, y: 0 }, ry: -Math.PI * 0.5 },
        { name: "列车后", pos: { x: -23, z: -17, y: 0 }, ry: -Math.PI * 0.5 },
        { name: "柱后", pos: { x: 12, z: -16.5, y: 0 }, ry: Math.PI * 0.5 },
        { name: "北缘", pos: { x: 0, z: -19.5, y: 0 }, ry: 0 },
      ]},
      { site: "mid", spots: [
        { name: "大厅俯瞰", pos: { x: 0, z: 14.5, y: 3 }, ry: 0 },
        { name: "阶梯下", pos: { x: 0, z: 18, y: 0 }, ry: 0 },
      ]},
      { site: "B", spots: [
        { name: "西口", pos: { x: -42, z: -28, y: 0 }, ry: -Math.PI * 0.5 },
        { name: "管道后", pos: { x: -36, z: -27, y: 0 }, ry: -Math.PI * 0.5 },
        { name: "南口", pos: { x: -26, z: -25.5, y: 0 }, ry: 0 },
      ]},
    ],
    plants: {
      A: [{ x: -16, z: -18 }, { x: 0, z: -18 }, { x: 16, z: -19 }],
      B: [{ x: -33, z: -28 }, { x: -38, z: -28 }, { x: -28, z: -27 }],
    },
    nades: [
      { name: "T 烟站台", team: "T", pos: { x: 8, z: 16 }, target: { x: 0, z: -18 }, type: "smoke" },
      { name: "T 闪隧道", team: "T", pos: { x: -38, z: -20 }, target: { x: -32, z: -28 }, type: "flash" },
      { name: "CT 火轨道", team: "CT", pos: { x: -2, z: -18 }, target: { x: 0, z: 0 }, type: "molotov" },
      { name: "CT 烟南站台", team: "CT", pos: { x: 2, z: -14 }, target: { x: 6, z: 20 }, type: "smoke" },
    ],
  };
  return d;
}

export const MAP_BUILDERS = { dust2: mapDust2, foundry: mapFoundry, subway: mapSubway };

// ---------------------------------------------------------------------------
// 材质与构建器
// ---------------------------------------------------------------------------
const MATERIAL_CACHE = new Map();

function getMaterial(name) {
  if (MATERIAL_CACHE.has(name)) return MATERIAL_CACHE.get(name);
  let tex, color;
  const mk = (t, c) => new THREE.MeshStandardMaterial({ map: t, color: c, roughness: 0.95, metalness: 0.02 });
  switch (name) {
    case "sandBrick": tex = texBrickSand(); color = 0xffffff; break;
    case "plaster": tex = texBrickPlaster(); color = 0xffffff; break;
    case "concrete": tex = texConcrete(); color = 0xd8d8d4; break;
    case "wood": tex = texWoodPlanks(); color = 0xffffff; break;
    case "metal": tex = texMetal(); color = 0xb8bdc2; break;
    case "metalDark": tex = texMetal(); color = 0x6a7076; break;
    case "sand": tex = texSandGround(); color = 0xffffff; break;
    case "asphalt": tex = texAsphalt(); color = 0xffffff; break;
    case "grass": tex = texGrass(); color = 0xffffff; break;
    case "dirt": tex = texDirt(); color = 0xffffff; break;
    case "tile": tex = texTileFloor(); color = 0xffffff; break;
    case "crate": tex = texCrate("#8a6d3f"); color = 0xffffff; break;
    case "crateGreen": tex = texCrate("#6f7d45"); color = 0xffffff; break;
    case "container": tex = texMetal(); color = 0x8a3f34; break;
    case "containerR": tex = texMetal(); color = 0x3f5f8a; break;
    case "trainBody": tex = texMetal(); color = 0x9aa2aa; break;
    case "xbox": tex = texBrickPlaster(); color = 0xcbb892; break;
    case "furnace": tex = texBrickSand(); color = 0xb55a3a; break;
    case "barrel": tex = texMetal(); color = 0x4f6b3f; break;
    case "camoT": tex = texCamo("#8a7448", ["#6f5a33", "#a08a55", "#58472a"]); color = 0xffffff; break;
    case "camoCT": tex = texCamo("#54687f", ["#42536a", "#6a7f98", "#33404f"]); color = 0xffffff; break;
    case "skin": tex = texCamo("#b98a68", ["#a37758", "#c79a76"]); color = 0xffffff; break;
    default: return new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.9 });
  }
  const m = mk(tex, color);
  m.name = name;
  MATERIAL_CACHE.set(name, m);
  return m;
}

function groundYAt(floors, ramps, lowBoxes, x, z) {
  let y = -Infinity, pri = -Infinity;
  for (const f of floors) {
    if (x >= f.x1 && x <= f.x2 && z >= f.z1 && z <= f.z2) {
      if (f.pri > pri || (f.pri === pri && f.y > y)) { pri = f.pri; y = f.y; }
    }
  }
  for (const r of ramps) {
    if (x >= r.x1 - 0.05 && x <= r.x2 + 0.05 && z >= r.z1 - 0.05 && z <= r.z2 + 0.05) {
      const t = r.axis === "z" ? (z - r.z1) / Math.max(1e-6, r.z2 - r.z1) : (x - r.x1) / Math.max(1e-6, r.x2 - r.x1);
      const yy = r.y1 + (r.y2 - r.y1) * clamp(t, 0, 1);
      if (r.pri > pri || (r.pri === pri && yy > y)) { pri = r.pri; y = yy; }
    }
  }
  for (const b of lowBoxes) if (x > b.x1 && x < b.x2 && z > b.z1 && z < b.z2 && b.y2 > y) y = b.y2;
  return y;
}

class NavGrid {
  constructor(map, cell) {
    this.map = map;
    this.cell = cell;
    this.minX = map.bounds.x1; this.maxX = map.bounds.x2;
    this.minZ = map.bounds.z1; this.maxZ = map.bounds.z2;
    this.nx = Math.ceil((this.maxX - this.minX) / cell);
    this.nz = Math.ceil((this.maxZ - this.minZ) / cell);
    this.gy = new Float32Array(this.nx * this.nz).fill(-999);
    this.gy2 = new Float32Array(this.nx * this.nz).fill(-999);
    this.walk = new Uint8Array(this.nx * this.nz);
    this.transZone = new Uint8Array(this.nx * this.nz);
    this.fields = new Map();
    this.build();
  }
  idx(ix, iz) { return iz * this.nx + ix; }
  cellOf(x, z) {
    return {
      ix: clamp(Math.floor((x - this.minX) / this.cell), 0, this.nx - 1),
      iz: clamp(Math.floor((z - this.minZ) / this.cell), 0, this.nz - 1),
    };
  }
  // 候选高度（从高到低去重）
  candidatesAt(x, z) {
    const set = new Set();
    let explicit = false;
    let rampH = -999;
    const inRange = (r) => x >= r.x1 - 0.05 && x <= r.x2 + 0.05 && z >= r.z1 - 0.05 && z <= r.z2 + 0.05;
    for (const r of this.map.navRamps) {
      if (inRange(r)) {
        explicit = true;
        const t = r.axis === "z" ? (z - r.z1) / Math.max(1e-6, r.z2 - r.z1) : (x - r.x1) / Math.max(1e-6, r.x2 - r.x1);
        const h = Math.round((r.y1 + (r.y2 - r.y1) * clamp(t, 0, 1)) * 100) / 100;
        rampH = Math.max(rampH, h);
        set.add(h);
      }
    }
    for (const f of this.map.floors) {
      if (x >= f.x1 && x <= f.x2 && z >= f.z1 && z <= f.z2) {
        if (f.pri >= 0) {
          explicit = true;
          const h = Math.round(f.y * 100) / 100;
          if (!(rampH > -900 && h > rampH - 2.6)) set.add(h);
        }
      }
    }
    for (const r of this.map.ramps) {
      const ext = 0.65;
      const rr = r.axis === "z"
        ? { ...r, z1: r.z1 - ext, z2: r.z2 + ext }
        : { ...r, x1: r.x1 - ext, x2: r.x2 + ext };
      if (inRange(rr)) {
        explicit = true;
        const t = r.axis === "z" ? (z - r.z1) / Math.max(1e-6, r.z2 - r.z1) : (x - r.x1) / Math.max(1e-6, r.x2 - r.x1);
        const h = Math.round((r.y1 + (r.y2 - r.y1) * clamp(t, 0, 1)) * 100) / 100;
        rampH = Math.max(rampH, h);
        set.add(h);
      }
    }
    for (const b of this.map.lowBoxes) {
      if (b.isStair) continue;
      if (x > b.x1 && x < b.x2 && z > b.z1 && z < b.z2) {
        explicit = true;
        const h = Math.round(b.y2 * 100) / 100;
        if (!(rampH > -900 && h > rampH - 2.6)) set.add(h);
      }
    }
    return [...set].sort((a, b) => b - a);
  }
  walkableAt(x, z, h) {
    const feet = h + 0.05;
    for (const s of this.map.spatial.query(x, z, 1.5)) {
      if (s.isStair) continue;
      if (s.intersectsCylinder(x, feet, z, 0.3, 1.65, feet)) return false;
    }
    for (const s of this.map.spatial.query(x, z, 1.5)) {
      if (s.y1 > h + 0.35 && s.y1 < h + 1.85 && s.x1 < x && s.x2 > x && s.z1 < z && s.z2 > z) return false;
    }
    return true;
  }
  build() {
    for (let iz = 0; iz < this.nz; iz++) {
      for (let ix = 0; ix < this.nx; ix++) {
        const x = this.minX + (ix + 0.5) * this.cell;
        const z = this.minZ + (iz + 0.5) * this.cell;
        const i = this.idx(ix, iz);
        const levels = [];
        for (const h of this.candidatesAt(x, z)) {
          if (this.walkableAt(x, z, h)) {
            levels.push(h);
            if (levels.length >= 2) break;
          }
        }
        if (!levels.length) continue;
        levels.sort((a, b) => a - b);
        this.gy[i] = levels[0];
        if (levels.length > 1 && levels[1] - levels[0] > 0.8) this.gy2[i] = levels[1];
        this.walk[i] = 1;
      }
    }
    // 过渡区：坡道/台阶覆盖的格子允许同格换层
    for (let iz = 0; iz < this.nz; iz++) {
      for (let ix = 0; ix < this.nx; ix++) {
        const x = this.minX + (ix + 0.5) * this.cell;
        const z = this.minZ + (iz + 0.5) * this.cell;
        for (const r of this.map.navRamps) {
          if (x >= r.x1 - 0.1 && x <= r.x2 + 0.1 && z >= r.z1 - 0.1 && z <= r.z2 + 0.1) {
            this.transZone[this.idx(ix, iz)] = 1;
            break;
          }
        }
        for (const r of this.map.ramps) {
          if (x >= r.x1 - 0.1 && x <= r.x2 + 0.1 && z >= r.z1 - 0.1 && z <= r.z2 + 0.1) {
            this.transZone[this.idx(ix, iz)] = 1;
            break;
          }
        }
      }
    }
  }
  fieldTo(tx, tz) {
    const key = Math.round(tx * 2) + "," + Math.round(tz * 2);
    if (this.fields.has(key)) return this.fields.get(key);
    const d0 = new Float32Array(this.nx * this.nz).fill(-1);
    const d1 = new Float32Array(this.nx * this.nz).fill(-1);
    const { ix, iz } = this.cellOf(tx, tz);
    let start = this.idx(ix, iz);
    let startLvl = 0;
    if (!this.walk[start]) {
      let best = -1, bd = 1e9;
      for (let dz = -10; dz <= 10; dz++) for (let dx = -10; dx <= 10; dx++) {
        const cx = ix + dx, cz = iz + dz;
        if (cx < 0 || cz < 0 || cx >= this.nx || cz >= this.nz) continue;
        const i2 = this.idx(cx, cz);
        if (this.walk[i2] && dx * dx + dz * dz < bd) { bd = dx * dx + dz * dz; best = i2; }
      }
      if (best < 0) { this.fields.set(key, { d0, d1 }); return { d0, d1 }; }
      start = best;
    }
    const heap = new MinHeap();
    heap.push({ f: 0, i: start, l: startLvl });
    d0[start] = 0;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const closed = new Uint8Array(this.nx * this.nz * 2);
    while (heap.size) {
      const { i: cur, l: lvl } = heap.pop();
      const cid = cur * 2 + lvl;
      if (closed[cid]) continue;
      closed[cid] = 1;
      const cx = cur % this.nx, cz = (cur / this.nx) | 0;
      const h = lvl === 0 ? this.gy[cur] : this.gy2[cur];
      for (const [dx, dz] of dirs) {
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= this.nx || nz >= this.nz) continue;
        const ni = this.idx(nx, nz);
        for (const nl of [0, 1]) {
          const h2 = nl === 0 ? this.gy[ni] : this.gy2[ni];
          if (h2 < -900) continue;
          if (h2 - h > 0.56) continue;
          const cost = h2 < h - 0.5 ? 5 : 1;
          const dcur = lvl === 0 ? d0[cur] : d1[cur];
          const darr = nl === 0 ? d0 : d1;
          const nd = dcur + cost;
          if (darr[ni] < 0 || nd < darr[ni]) {
            darr[ni] = nd;
            heap.push({ f: nd, i: ni, l: nl });
          }
        }
      }
    }
    if (this.fields.size > 24) this.fields.clear();
    this.fields.set(key, { d0, d1 });
    return { d0, d1 };
  }
  stepToward(field, x, z, refY = 0) {
    const { ix, iz } = this.cellOf(x, z);
    const cur = this.idx(ix, iz);
    let lvl = 0;
    if (this.gy2[cur] > -900 && Math.abs(this.gy2[cur] - refY) < Math.abs(this.gy[cur] - refY)) lvl = 1;
    const cd = (lvl === 0 ? field.d0 : field.d1)[cur];
    if (cd < 0) return null;
    const h = lvl === 0 ? this.gy[cur] : this.gy2[cur];
    let best = cur, bestLvl = lvl, bd = cd;
    const tryDirs = (dirs) => {
      for (const [dx, dz] of dirs) {
        const cx = ix + dx, cz = iz + dz;
        if (cx < 0 || cz < 0 || cx >= this.nx || cz >= this.nz) continue;
        const ni = this.idx(cx, cz);
        for (const nl of [0, 1]) {
          const h2 = nl === 0 ? this.gy[ni] : this.gy2[ni];
          if (h2 < -900) continue;
          if (h2 - h > 0.56 && !(h2 < h)) continue;
          const d = (nl === 0 ? field.d0 : field.d1)[ni];
          if (!(d >= 0 && d < bd)) continue;
          best = ni; bestLvl = nl; bd = d;
        }
      }
    };
    tryDirs([[1, 0], [-1, 0], [0, 1], [0, -1]]);
    if (best === cur) tryDirs([[1, 1], [1, -1], [-1, 1], [-1, -1]]);
    if (best === cur) return null;
    const bx = this.minX + ((best % this.nx) + 0.5) * this.cell;
    const bz = this.minZ + (((best / this.nx) | 0) + 0.5) * this.cell;
    return { x: bx, z: bz, d: bd };
  }
  clearLine(x1, z1, x2, z2, y1, y2) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 0.2) return true;
    const steps = Math.max(2, Math.ceil(len / 0.4));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = x1 + dx * t, z = z1 + dz * t;
      const gy = groundYAt(this.map.floors, this.map.ramps, this.map.lowBoxes, x, z);
      if (gy === -Infinity) return false;
      const yy = y1 + (y2 - y1) * t;
      if (gy - yy > 0.45) return false;
      if (yy - gy > 1.5) return false;
      for (const s of this.map.spatial.query(x, z, 1.2)) {
        if (s.intersectsCylinder(x, yy + 0.05, z, 0.3, 1.65, yy + 0.05)) return false;
      }
    }
    return true;
  }
  levelsAt(x, z) {
    const { ix, iz } = this.cellOf(x, z);
    const i = this.idx(ix, iz);
    const out = [];
    if (this.gy[i] > -900) out.push(this.gy[i]);
    if (this.gy2[i] > -900) out.push(this.gy2[i]);
    return out;
  }
}

class SpatialGrid {
  constructor(cell) {
    this.cell = cell;
    this.map = new Map();
  }
  key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }
  insert(aabb) {
    const x1 = Math.floor(aabb.x1 / this.cell), x2 = Math.floor(aabb.x2 / this.cell);
    const z1 = Math.floor(aabb.z1 / this.cell), z2 = Math.floor(aabb.z2 / this.cell);
    for (let cx = x1; cx <= x2; cx++) for (let cz = z1; cz <= z2; cz++) {
      const k = this.key(cx, cz);
      if (!this.map.has(k)) this.map.set(k, []);
      this.map.get(k).push(aabb);
    }
  }
  query(x, z, radius) {
    const out = [];
    const x1 = Math.floor((x - radius) / this.cell), x2 = Math.floor((x + radius) / this.cell);
    const z1 = Math.floor((z - radius) / this.cell), z2 = Math.floor((z + radius) / this.cell);
    for (let cx = x1; cx <= x2; cx++) for (let cz = z1; cz <= z2; cz++) {
      const arr = this.map.get(this.key(cx, cz));
      if (arr) for (const a of arr) out.push(a);
    }
    return out;
  }
  raycast(origin, dir, maxDist, radius = 0.02) {
    const steps = Math.ceil(maxDist / 0.3);
    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * maxDist;
      const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = origin.z + dir.z * t;
      for (const s of this.query(x, z, 1.0)) {
        if (s.intersectsCylinder(x, y, z, radius, 0.05, y)) return t;
      }
    }
    return null;
  }
}

function buildBoxes(list, matName, group) {
  if (!list.length) return;
  const mat = getMaterial(matName);
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const inst = new THREE.InstancedMesh(geo, mat, list.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  list.forEach((b, i) => {
    s.set(b.x2 - b.x1, b.y2 - b.y1, b.z2 - b.z1);
    p.set((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, (b.z1 + b.z2) / 2);
    m4.compose(p, q, s);
    inst.setMatrixAt(i, m4);
  });
  inst.castShadow = true; inst.receiveShadow = true;
  group.add(inst);
}

function buildFloors(d, group) {
  const byMat = new Map();
  for (const f of d.floors) {
    if (!byMat.has(f.mat)) byMat.set(f.mat, []);
    byMat.get(f.mat).push(f);
  }
  for (const [matName, list] of byMat) {
    const mat = getMaterial(matName);
    const geo = new THREE.BoxGeometry(1, 0.32, 1);
    const inst = new THREE.InstancedMesh(geo, mat, list.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    list.forEach((f, i) => {
      s.set(f.x2 - f.x1, 0.32, f.z2 - f.z1);
      p.set((f.x1 + f.x2) / 2, f.y - 0.16, (f.z1 + f.z2) / 2);
      m4.compose(p, q, s);
      inst.setMatrixAt(i, m4);
    });
    inst.receiveShadow = true;
    group.add(inst);
  }
}

function buildRamps(d, group) {
  for (const r of d.ramps) {
    const w = r.axis === "z" ? r.x2 - r.x1 : r.z2 - r.z1;
    const len = Math.hypot(r.axis === "z" ? r.z2 - r.z1 : r.x2 - r.x1, r.y2 - r.y1);
    const ang = Math.atan2(r.y2 - r.y1, r.axis === "z" ? r.z2 - r.z1 : r.x2 - r.x1);
    const geo = new THREE.BoxGeometry(w, 0.3, len);
    const mesh = new THREE.Mesh(geo, getMaterial(r.mat));
    const cx = (r.x1 + r.x2) / 2, cz = (r.z1 + r.z2) / 2;
    mesh.position.set(cx, (r.y1 + r.y2) / 2, cz);
    mesh.rotation.y = r.axis === "z" ? 0 : Math.PI / 2;
    mesh.rotation.x = r.axis === "z" ? -ang : ang;
    mesh.receiveShadow = true; mesh.castShadow = true;
    group.add(mesh);
  }
}

function buildSteps(d, group) {
  const boxes = [];
  for (const st of d.steps) {
    const rise = st.y2 - st.y1;
    const run = st.axis === "x" ? st.x2 - st.x1 : st.z2 - st.z1;
    const n = Math.max(1, Math.ceil(Math.abs(rise) / 0.17));
    const sh = rise / n, sd = run / n;
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      if (st.axis === "x") {
        const x1 = st.x1 + (st.x2 - st.x1) * t0, x2 = st.x1 + (st.x2 - st.x1) * t1;
        boxes.push({ x1: x2 - Math.min(Math.abs(sd), 0.22), x2: x2, z1: st.z1, z2: st.z2,
          y1: st.y1 + sh * i, y2: st.y1 + sh * (i + 1), mat: st.mat });
      } else {
        const z1 = st.z1 + (st.z2 - st.z1) * t0, z2 = st.z1 + (st.z2 - st.z1) * t1;
        boxes.push({ x1: st.x1, x2: st.x2, z1: z2 - Math.min(Math.abs(sd), 0.22), z2: z2,
          y1: st.y1 + sh * i, y2: st.y1 + sh * (i + 1), mat: st.mat });
      }
    }
  }
  for (const b of boxes) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.x2 - b.x1, Math.max(0.02, b.y2 - b.y1), b.z2 - b.z1), getMaterial(b.mat));
    mesh.position.set((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, (b.z1 + b.z2) / 2);
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
  }
  return boxes;
}

function buildDecor(d, group) {
  const barrelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.95, 12);
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 14).rotateZ(Math.PI / 2);
  for (const dec of d.decor) {
    if (dec.type === "cyl") {
      const m = new THREE.Mesh(barrelGeo, getMaterial(dec.mat));
      m.position.set(dec.x, dec.y + dec.h / 2, dec.z);
      m.castShadow = true; m.receiveShadow = true;
      group.add(m);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.04, 6, 18), getMaterial("metalDark"));
      rim.rotation.x = Math.PI / 2;
      rim.position.set(dec.x, dec.y + dec.h * 0.65, dec.z);
      group.add(rim);
    } else if (dec.type === "door") {
      const door = new THREE.Mesh(new THREE.BoxGeometry(dec.w, dec.h, 0.08), getMaterial(dec.mat));
      door.position.set(dec.x1 + dec.open * dec.w * 0.5, dec.h / 2, dec.z);
      door.rotation.y = dec.open > 0 ? -0.8 : 0.8;
      door.castShadow = true;
      group.add(door);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(dec.w + 0.3, dec.h + 0.25, 0.25), getMaterial("concrete"));
      frame.position.set(dec.x1, (dec.h + 0.25) / 2, dec.z);
      group.add(frame);
    } else if (dec.type === "car") {
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.6, 4.3), getMaterial("metalDark"));
      body.position.set(dec.x, 0.45, dec.z); body.rotation.y = dec.ry; body.castShadow = true;
      group.add(body);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.62, 2.1), getMaterial("metal"));
      cab.position.set(dec.x, 1.05, dec.z); cab.rotation.y = dec.ry; cab.castShadow = true;
      group.add(cab);
      for (const [wx, wz] of [[-0.9, 1.3], [0.9, 1.3], [-0.9, -1.3], [0.9, -1.3]]) {
        const w = new THREE.Mesh(wheelGeo, getMaterial("metalDark"));
        w.position.set(dec.x + wx, 0.42, dec.z + wz);
        w.rotation.y = dec.ry;
        group.add(w);
      }
    } else if (dec.type === "pipe") {
      const len = Math.hypot(dec.x2 - dec.x1, dec.z2 - dec.z1);
      const geo = new THREE.CylinderGeometry(dec.r, dec.r, len, 10);
      const m = new THREE.Mesh(geo, getMaterial("metalDark"));
      m.position.set((dec.x1 + dec.x2) / 2, dec.y, (dec.z1 + dec.z2) / 2);
      m.rotation.z = Math.PI / 2;
      m.rotation.y = Math.atan2(dec.z2 - dec.z1, dec.x2 - dec.x1) - Math.PI / 2;
      m.castShadow = true;
      group.add(m);
    } else if (dec.type === "bench") {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.7), getMaterial("wood"));
      seat.position.set(dec.x, 0.5, dec.z); seat.rotation.y = dec.ry; seat.castShadow = true;
      group.add(seat);
    } else if (dec.type === "train") {
      const body = new THREE.Mesh(new THREE.BoxGeometry(dec.len, 2.9, 3.0), getMaterial("trainBody"));
      body.position.set(dec.x, 0.3, dec.z); body.rotation.y = dec.ry; body.castShadow = true; body.receiveShadow = true;
      group.add(body);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(dec.len + 0.02, 0.9, 3.02), getMaterial("containerR"));
      stripe.position.set(dec.x, 1.35, dec.z); stripe.rotation.y = dec.ry;
      group.add(stripe);
      for (let i = -2; i <= 2; i++) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 0.06), getMaterial("metalDark"));
        win.position.set(dec.x + i * 3, 2.2, dec.z + 1.53);
        group.add(win);
      }
    } else if (dec.type === "ticket") {
      const booth = new THREE.Mesh(new THREE.BoxGeometry(3, 2.2, 2.4), getMaterial("concrete"));
      booth.position.set(dec.x, 1.1, dec.z); booth.castShadow = true;
      group.add(booth);
    }
  }
}

function splitWalls(w) {
  // 展开 doorGap / doorGapZ / windowGap / railGap
  const out = [];
  if (w.windowGap) {
    const [g1, g2] = w.windowGap;
    out.push({ ...w, y2: w.y1 + 0.85, windowGap: undefined });
    out.push({ ...w, y1: w.y1 + 2.0, windowGap: undefined });
    out.push({ type: "window", x1: g1, z1: w.z1 + 0.05, x2: g2, z2: w.z2 - 0.05,
      y1: w.y1 + 0.9, y2: w.y1 + 1.95, mat: "metalDark" });
    return out;
  }
  if (w.doorGap) {
    const [g1, g2] = w.doorGap;
    if (g1 > w.x1) out.push({ ...w, x2: g1, doorGap: undefined });
    if (g2 < w.x2) out.push({ ...w, x1: g2, doorGap: undefined });
    return out;
  }
  if (w.doorGapZ) {
    const [g1, g2] = w.doorGapZ;
    if (g1 > w.z1) out.push({ ...w, z2: g1, doorGapZ: undefined });
    if (g2 < w.z2) out.push({ ...w, z1: g2, doorGapZ: undefined });
    return out;
  }
  if (w.railGap) {
    const [g1, g2] = w.railGap;
    if (g1 > w.x1) out.push({ ...w, x2: g1, railGap: undefined });
    if (g2 < w.x2) out.push({ ...w, x1: g2, railGap: undefined });
    return out;
  }
  return [w];
}

export function buildMap(id) {
  const data = MAP_BUILDERS[id]();
  const group = new THREE.Group();
  buildFloors(data, group);
  buildRamps(data, group);
  const stepBoxes = buildSteps(data, group);
  const wallLists = new Map();
  const solids = [];
  const lowBoxes = [];
  const windowDecors = [];
  for (const w0 of data.walls) {
    for (const w of splitWalls(w0)) {
      if (w.type === "window") { windowDecors.push(w); continue; }
      if (!wallLists.has(w.mat)) wallLists.set(w.mat, []);
      wallLists.get(w.mat).push(w);
      const a = new AABB(w.x1, w.z1, w.x2, w.z2, w.y1, w.y2);
      solids.push(a);
      if (w.y2 - w.y1 <= 0.56) lowBoxes.push(a);
    }
  }
  for (const b of stepBoxes) {
    const a = new AABB(b.x1, b.z1, b.x2, b.z2, b.y1, b.y2);
    a.isStair = true;
    solids.push(a);
    lowBoxes.push(a);
  }
  for (const [matName, list] of wallLists) buildBoxes(list, matName, group);
  for (const wd of windowDecors) {
    const glass = new THREE.Mesh(new THREE.BoxGeometry(wd.x2 - wd.x1, wd.y2 - wd.y1, wd.z2 - wd.z1),
      new THREE.MeshStandardMaterial({ color: 0x203040, roughness: 0.2, metalness: 0.6, transparent: true, opacity: 0.45 }));
    glass.position.set((wd.x1 + wd.x2) / 2, (wd.y1 + wd.y2) / 2, (wd.z1 + wd.z2) / 2);
    group.add(glass);
  }
  buildDecor(data, group);

  const spatial = new SpatialGrid(3);
  for (const s of solids) spatial.insert(s);
  const bounds = data.meta.bounds;
  const map = {
    data, group, solids, spatial, bounds, nav: null, id,
    floors: data.floors, ramps: data.ramps, lowBoxes,
    navRamps: data.steps.map((s) => {
      const r = { x1: Math.min(s.x1, s.x2), z1: Math.min(s.z1, s.z2),
        x2: Math.max(s.x1, s.x2), z2: Math.max(s.z1, s.z2), y1: s.y1, y2: s.y2, axis: s.axis };
      // 上升方向沿轴翻转时同步翻转高度
      if (s.axis === "x" && s.x1 > s.x2) { r.y1 = s.y2; r.y2 = s.y1; }
      if (s.axis === "z" && s.z1 > s.z2) { r.y1 = s.y2; r.y2 = s.y1; }
      return r;
    }),
    groundY(x, z, refY) {
      const levels = this.nav ? this.nav.levelsAt(x, z) : [];
      if (!levels.length) {
        const y = groundYAt(this.floors, this.ramps, this.lowBoxes, x, z);
        return y;
      }
      if (refY === undefined || refY === null) return Math.max(...levels);
      let best = -Infinity;
      for (const h of levels) if (h <= refY + 0.56 && h > best) best = h;
      if (best > -Infinity) return best;
      return Math.min(...levels);
    },
    los(from, to) {
      const dir = new THREE.Vector3().subVectors(to, from);
      const len = dir.length();
      if (len < 0.01) return true;
      dir.normalize();
      return spatial.raycast(from, dir, len, 0.05) === null;
    },
    buildNav() { this.nav = new NavGrid(this, 0.6); return this.nav; },
    tactical: data.tactical,
  };
  return map;
}

export function minimapLines(map) {
  const lines = [];
  for (const s of map.solids) {
    if (s.y2 - s.y1 < 0.4) continue;
    lines.push(s.x1, s.z1, s.x2, s.z1, s.x2, s.z1, s.x2, s.z2, s.x2, s.z2, s.x1, s.z2, s.x1, s.z2, s.x1, s.z1);
  }
  return lines;
}
