// ============================================================================
// maps/dust2.js — 炙热沙城 II (de_dust2 recreation)
//
// Plan view (+X east, +Z south, y up).  The topology mirrors the original:
//
//                     ┌── CT SPAWN (y+2.4) ──┐
//        B-CT 通道 ───┤                      ├─── A 斜坡
//            │        └──── CT 中路 ─────────┘        │
//        B 门通道           │ (ramp down)             │
//            │              │                         │
//   ┌── B 包点 ──┐      ┌── 中路 ──┐            ┌── A 包点 ──┐
//   │  B 平台    │      │  Xbox    │            │ 平台/箱体  │
//   └──── ↑ ─────┘      │  中门    │            └──── ↑ ─────┘
//     B 洞(上层)        └── ↑ ─────┘   A 小(过道) ─┘   A 坑 ← A 大
//         │              下层通道 ─┐        │              │
//   ┌── 通道口 ──┐            └── T 广场 ──┴── 长门 ───────┘
//   └──── T 出生点 ────────────────┘
//
// Heights: 场地 y0, CT 家 +2.4, A 平台 +1.3, A 小过道 +1.3, B 平台 +1.5, A 坑 −1.4
// ============================================================================

import { brushes, N, HOLD, NADE } from './kit.js';
import { MAT, AREA, TEAM } from '../core/constants.js';

const B = brushes();
const WALL = MAT.SAND_WALL;
const SAND = MAT.SAND_FLOOR;
const H = 6.5;          // outdoor wall height
const CT_Y = 2.4;       // CT spawn level
const PLAT_Y = 1.3;     // A site platform / catwalk level
const BPLAT_Y = 1.5;    // B platform
const PIT_Y = -0.9;     // A 坑

// ---------------------------------------------------------------------------
// 1. T 出生点 (T Spawn) — south-west, opens east to the plaza and north to 通道
// ---------------------------------------------------------------------------
B.group('T 出生点');
B.room({
  x0: -38, z0: 28, x1: -20, z1: 44, y: 0, h: H, mat: WALL, floorMat: SAND,
  sides: {
    n: { gaps: [[-34, -28, 0, 3.6]] },      // → 通道口 (tunnels)
    e: { gaps: [[31, 41, 0, 4.2]] },        // → T 广场
  },
});
B.crateStack(-35, 42, 0, [[1.5, 1.5], [1.2, 1.2]]);
B.crate(-23, 30, 0, 1.4, 1.4);
B.barrel(-31.4, 30.6, 0); B.barrel(-30.6, 31.4, 0); B.barrel(-32, 31.6, 0);
B.awning(-38, 33, -34.4, 38, 3.4, 0.7, 'x');
B.band(-38.3, 27.7, -19.7, 44.3, 4.3, 0.3);
B.lamp(-37.4, 36, 3.2); B.lamp(-20.6, 36, 3.2);

// ---------------------------------------------------------------------------
// 2. T 广场 (T plaza) — the fork: north to 中路, east to 长门
// ---------------------------------------------------------------------------
B.group('T 广场');
B.room({
  x0: -20, z0: 26, x1: -4, z1: 44, y: 0, h: H, mat: WALL, floorMat: SAND,
  sides: {
    w: false,                                // T 出生点 owns that wall
    n: false,                                // built explicitly below
    e: { gaps: [[33, 41, 0, 4.2]] },         // → 长门
  },
});
// north wall of the plaza: only the stretch that 中路 does not own
B.wallX(26, -20.25, -14, 0, H, WALL);
B.arch(-14.5, 26, 6.6, 4.2, 'x');
B.arch(-4, 37, 8, 4.2, 'z');
B.crateStack(-18, 28.5, 0, [[1.5, 1.5]]);
B.crate(-6.5, 29, 0, 1.5, 1.5);
B.sandbags(-19.6, 41, -16.4, 43.4, 0, 0.95);
B.barrel(-8, 42.6, 0); B.barrel(-8.8, 41.9, 0);
B.band(-20.3, 25.7, -3.7, 44.3, 4.3, 0.3);

// ---------------------------------------------------------------------------
// 3. 长门 (Long Doors) — the double doors corridor into A 大
// ---------------------------------------------------------------------------
B.group('长门');
B.room({
  x0: -4, z0: 32, x1: 11, z1: 42, y: 0, h: 5.4, mat: WALL, floorMat: SAND,
  sides: { w: false, e: false },             // A 大 owns the east wall
});
B.doubleDoor(2.5, 37, 8.4, 3.4, 'z', 3.0);
B.arch(2.5, 37, 8.6, 3.6, 'z', MAT.SAND_TRIM, { thick: 0.5 });
B.detail(2.1, 32.4, 2.9, 41.6, 3.4, 3.9, MAT.SAND_TRIM, { uv: 0.6 });
B.crate(-2, 33.4, 0, 1.3, 1.3);
B.barrel(9.6, 41, 0);

// ---------------------------------------------------------------------------
// 4. A 大 (Long A) — the 30 m sniper lane running north to the site
// ---------------------------------------------------------------------------
B.group('A 大');
B.room({
  x0: 11, z0: 10, x1: 21, z1: 42, y: 0, h: H, mat: WALL, floorMat: SAND,
  sides: {
    w: { gaps: [[34, 40, 0, 4.2]] },         // ← 长门
    n: false,                                // open into 长道北段
    e: { h: H },
  },
});
// cover along the lane: the classic crates + barrels, and the long corner jut
B.crateStack(12.4, 30, 0, [[1.6, 1.6], [1.3, 1.2]]);
B.crate(19.4, 24.6, 0, 1.5, 1.5);
B.barrel(12.2, 18.6, 0); B.barrel(12.9, 19.3, 0); B.barrel(12.2, 20, 0);
B.parapet(18.6, 13.6, 21.3, 16.4, 0, 1.15, WALL);       // 长道掩体
B.awning(11.3, 34, 14, 39, 4.4, 0.8, 'x');
B.band(10.7, 9.7, 21.3, 42.3, 4.4, 0.32);
B.lamp(11.6, 28, 3.4); B.lamp(20.4, 34, 3.4); B.lamp(20.4, 14, 3.4);

// ---------------------------------------------------------------------------
// 5. 长道北段 + A 坑 (Long north end and the Pit)
//    The pit is a sunken box that watches straight back down 长道.
// ---------------------------------------------------------------------------
B.group('A 坑');
B.room({
  x0: 11, z0: -2, x1: 26, z1: 10, y: 0, h: H, mat: WALL, floorMat: SAND,
  floor: false,                              // floored by hand around the pit
  sides: {
    s: { gaps: [[11, 21, 0, H]] },           // ← 长道
    n: false,                                // A 包点 owns its south wall
  },
});
// raised ground around the pit (1.6 m thick so the pit walls are solid)
B.floor(11, -2, 18, 10, 0, SAND, { thick: 1.6 });
B.floor(18, -2, 20, 0, 0, SAND, { thick: 1.6 });
B.floor(24, -2, 26, 0, 0, SAND, { thick: 1.6 });
B.floor(18, 8, 26, 10, 0, SAND, { thick: 1.6 });
// the pit floor itself + the ramp that climbs north into A 包点
B.floor(18, 0, 26, 8, PIT_Y, MAT.CONCRETE, { thick: 1.0 });
B.ramp(20, -2, 24, 0, 0, PIT_Y, 'z', MAT.CONCRETE);
B.detail(17.9, -0.3, 18.3, 8.3, PIT_Y, 0.06, MAT.SAND_TRIM, { uv: 0.5 });   // pit edge trim
B.barrel(24.6, 6.6, PIT_Y); B.barrel(25, 5.7, PIT_Y);
B.crate(19.4, 6.6, PIT_Y, 1.2, 1.2);
B.band(10.7, -2.3, 26.3, 10.3, 4.4, 0.32);

// ---------------------------------------------------------------------------
// 6. A 包点 (A Bombsite) — platform, triple stack, goose, 3 entrances
// ---------------------------------------------------------------------------
B.group('A 包点');
B.room({
  x0: 11, z0: -26, x1: 34, z1: -2, y: 0, h: H, mat: WALL, floorMat: SAND,
  sides: {
    s: { gaps: [[11, 17, 0, H], [20, 24, 0, H]] },     // ← A 大 / ← A 坑
    w: { gaps: [[-20, -14, PLAT_Y, PLAT_Y + 3.2]] },   // ← A 小 (raised catwalk)
    n: { gaps: [[13, 20, 0, 4.4]] },                   // ← A 斜坡 (CT)
  },
});
// the concrete platform in the back of the site (classic default plant)
B.platform(24, -25, 33, -17, PLAT_Y, MAT.CONCRETE, { base: 0 });
B.ramp(22, -24, 24, -18, 0, PLAT_Y, 'x', MAT.CONCRETE);
B.stairs(24, -16.6, 27, -15.4, 0, PLAT_Y, 'x', 4, MAT.CONCRETE);
B.parapet(24, -17.3, 33.3, -16.7, PLAT_Y, 0.95, WALL);
// triple stack + long crate: the cover T uses after entering from 长道
B.crateStack(16.6, -8.4, 0, [[1.6, 1.6], [1.6, 1.5], [1.3, 1.2]]);
B.crate(18.6, -10.2, 0, 1.6, 1.6);
B.crate(14.2, -5.6, 0, 1.5, 1.5);
// 小屋 / goose: waist-high L cover next to the 长道 mouth
B.parapet(27, -9, 33.4, -8.4, 0, 1.2, WALL);
B.parapet(27, -8.4, 27.6, -4, 0, 1.2, WALL);
B.crate(32.4, -6.4, 0, 1.4, 1.4);
B.barrel(28.6, -11.4, 0); B.barrel(29.4, -12, 0); B.barrel(28.4, -12.4, 0);
B.sandbags(12, -24, 15.4, -21, 0, 0.9);
B.awning(28, -3.6, 33.4, -2.4, 4.6, 0.9, 'z');
B.band(10.7, -26.3, 34.3, -1.7, 4.5, 0.34);
B.lamp(33.4, -20, 3.6); B.lamp(11.6, -12, 3.6); B.lamp(33.4, -6, 3.6);

// ---------------------------------------------------------------------------
// 7. A 斜坡 (A Ramp) — CT spawn drops 2.4 m into the site
// ---------------------------------------------------------------------------
B.group('A 斜坡');
B.ramp(13, -34, 20, -26, CT_Y, 0, 'z', MAT.CONCRETE);
B.wallZ(13, -34, -26, 0, CT_Y + 4.4, WALL);
B.wallZ(20, -34, -26, 0, CT_Y + 4.4, WALL);
B.parapet(13.3, -34, 13.9, -26.6, PLAT_Y, 0.7, MAT.SAND_TRIM);
B.band(12.7, -34.3, 20.3, -25.7, CT_Y + 2.6, 0.3);

// ---------------------------------------------------------------------------
// 8. CT 出生点 / 警家 (CT Spawn) — elevated, three exits
// ---------------------------------------------------------------------------
B.group('CT 出生点');
B.room({
  x0: -10, z0: -46, x1: 21, z1: -34, y: CT_Y, h: 6, mat: WALL, floorMat: MAT.CONCRETE,
  sides: {
    s: { gaps: [[13, 20, CT_Y, CT_Y + 4.4], [-8, -1, CT_Y, CT_Y + 4.4]] },
    w: { gaps: [[-42, -36, CT_Y, CT_Y + 4.4]] },
  },
});
B.crateStack(-6, -44, CT_Y, [[1.6, 1.6], [1.4, 1.3]]);
B.crate(18.4, -44.4, CT_Y, 1.5, 1.5);
B.crate(6, -36.4, CT_Y, 1.5, 1.5);
B.barrel(1.6, -44.6, CT_Y); B.barrel(2.4, -45.2, CT_Y); B.barrel(0.9, -45.3, CT_Y);
B.sandbags(9, -36.4, 12.4, -34.6, CT_Y, 0.95);
B.awning(-10, -42, -5, -37, CT_Y + 3.4, 0.8, 'x');
B.planks(15, -40, 17.4, -37.6, CT_Y, 3);
B.band(-10.3, -46.3, 21.3, -33.7, CT_Y + 4.5, 0.34);
B.lamp(-9.4, -40, CT_Y + 3.2); B.lamp(20.4, -40, CT_Y + 3.2);

// ---------------------------------------------------------------------------
// 9. CT 中路 (CT mid) — the ramp from 警家 down into 中路
// ---------------------------------------------------------------------------
B.group('CT 中路');
B.ramp(-8, -34, -1, -26, CT_Y, 0, 'z', MAT.CONCRETE);
B.wallZ(-8, -34, -26, 0, CT_Y + 4.4, WALL);
B.wallZ(-1, -34, -26, 0, CT_Y + 4.4, WALL);
B.parapet(-7.7, -30.6, -7.1, -26.6, 0.9, 0.8, MAT.SAND_TRIM);
B.band(-8.3, -34.3, -0.7, -25.7, CT_Y + 2.6, 0.3);

// ---------------------------------------------------------------------------
// 10. 中路 (Mid) — 52 m north/south lane with 中门(双门) and the Xbox
// ---------------------------------------------------------------------------
B.group('中路');
B.room({
  x0: -14, z0: -26, x1: -2, z1: 26, y: 0, h: H, mat: WALL, floorMat: SAND,
  sides: {
    n: { gaps: [[-8, -1, 0, H]] },            // ← CT 中路
    s: { gaps: [[-12, -6, 0, 4.2]] },         // ← T 广场
    e: { gaps: [[-16, -10, 0, 4.2]] },        // → A 小 (catwalk)
    w: { gaps: [[20, 25.6, 0, 3.4]] },        // ← 下层通道
  },
});
// 中门 / 双门 — the wall that cuts mid in half, with the iconic doors
B.wallX(8, -14.25, -2.25, 0, 4.6, WALL, { gaps: [[-10.6, -6.4, 0, 3.4]] });
B.doubleDoor(-8.5, 8, 4.2, 3.35, 'x', 2.4);
B.arch(-8.5, 8, 4.4, 3.5, 'x', MAT.SAND_TRIM, { thick: 0.42 });
// Xbox — the box T jump on to see CT mid / A 小
B.crate(-4.6, 2.6, 0, 2.2, 1.55, 2.2, MAT.CRATE, { tag: 'Xbox' });
B.crate(-4.6, 2.6, 1.55, 1.1, 0.55, 1.1, MAT.CRATE, { trim: false, tag: 'Xbox' });
// mid cover and dressing
B.crate(-12.4, -6.6, 0, 1.5, 1.5);
B.crate(-3.4, -18.4, 0, 1.4, 1.4);
B.barrel(-13, 14.6, 0); B.barrel(-12.3, 15.3, 0);
B.sandbags(-13.6, -24, -10.6, -21.4, 0, 0.9);
B.parapet(-13.7, -1, -11.4, -0.4, 0, 1.1, WALL);
B.awning(-14, 18, -10.6, 23, 4.4, 0.8, 'x');
B.band(-14.3, -26.3, -1.7, 26.3, 4.4, 0.32);
B.lamp(-13.4, 6, 3.4); B.lamp(-2.6, -6, 3.4); B.lamp(-13.4, -14, 3.4);

// ---------------------------------------------------------------------------
// 11. A 小 / 过道 (A Short, the Catwalk) — mid up to the site's west entrance
// ---------------------------------------------------------------------------
B.group('A 小');
B.floor(-2, -20, 6.4, -10, 0, SAND);
B.stairs(3, -16, 6.2, -11, 0, PLAT_Y, 'x', 5, MAT.CONCRETE);
B.platform(6.2, -20, 11, -11, PLAT_Y, MAT.CONCRETE, { base: 0 });
B.ramp(11, -20, 14, -14, PLAT_Y, 0, 'x', MAT.CONCRETE);      // drop into the site
B.wallX(-20, -2.25, 11.25, 0, PLAT_Y + 4.2, WALL);
B.wallX(-10, -2.25, 11.25, 0, PLAT_Y + 4.2, WALL);
B.parapet(6.2, -20, 11, -19.4, PLAT_Y, 1.0, WALL);
B.parapet(6.2, -11.6, 11, -11, PLAT_Y, 1.0, WALL);
B.crate(8.6, -13, PLAT_Y, 1.3, 1.3);
B.band(-2.3, -20.3, 11.3, -9.7, PLAT_Y + 3.2, 0.3);
B.lamp(4, -10.6, 3.2);

// ---------------------------------------------------------------------------
// 12. B 洞 (Tunnels) — 通道口, 上层通道 to B, 下层通道 to 中路
// ---------------------------------------------------------------------------
B.group('通道口');
B.room({
  x0: -38, z0: 20, x1: -26, z1: 28, y: 0, h: 3.6, mat: WALL, floorMat: SAND,
  ceiling: true, ceilMat: MAT.STONE,
  sides: {
    s: false,                                  // T 出生点 owns it
    n: { gaps: [[-38, -30, 0, 3.6]] },         // → 上层通道
    e: { gaps: [[21, 26, 0, 3.2]] },           // → 下层通道
  },
});
B.crate(-27.4, 26.4, 0, 1.3, 1.3);
B.barrel(-37, 21, 0);
B.arch(-27, 23.5, 5.2, 3.2, 'z', MAT.SAND_TRIM, { thick: 0.35, rise: 0.3 });

B.group('上层通道');
B.room({
  x0: -38, z0: 2, x1: -30, z1: 20, y: 0, h: 3.6, mat: WALL, floorMat: SAND,
  ceiling: true, ceilMat: MAT.STONE,
  sides: { s: false, n: false },               // B 包点 owns the north wall
});
B.crate(-31.4, 17.4, 0, 1.2, 1.2);
// the tunnel jogs around a support pillar, so B is never visible from T spawn
B.box(-34.2, 8, -32.6, 12, 0, 3.6, MAT.STONE, { uv: 1.4 });
B.barrel(-37, 8.6, 0); B.barrel(-36.3, 9.3, 0);
B.pipe(-38, 4, 3.1, 16, 'z', 0.13);
B.lamp(-37.4, 12, 2.6); B.lamp(-30.6, 6, 2.6);

B.group('下层通道');
B.room({
  x0: -26, z0: 20, x1: -14, z1: 26, y: 0, h: 3.4, mat: WALL, floorMat: SAND,
  ceiling: true, ceilMat: MAT.STONE,
  sides: { w: false, e: false },               // 通道口 / 中路 own those
});
B.crate(-19, 21.4, 0, 1.2, 1.2);
B.pipe(-25, 22.6, 3.0, 10, 'x', 0.12);
B.lamp(-20, 25.4, 2.5);

// ---------------------------------------------------------------------------
// 13. B 包点 (B Bombsite) — tight courtyard, 平台 at the back, 门 on the CT side
// ---------------------------------------------------------------------------
B.group('B 包点');
B.room({
  x0: -46, z0: -14, x1: -26, z1: 2, y: 0, h: 6, mat: WALL, floorMat: SAND,
  sides: {
    s: { gaps: [[-38, -30, 0, 3.6]] },         // ← 上层通道 (T entry)
    n: { gaps: [[-33, -27, 0, 4.2]] },         // ← B 门 (CT entry)
  },
});
// B 平台 — the raised back-left platform with the second plant spot
B.platform(-46, -14, -38, -6, BPLAT_Y, MAT.CONCRETE, { base: 0 });
B.ramp(-38, -12, -35.6, -7.4, BPLAT_Y, 0, 'x', MAT.CONCRETE);
B.parapet(-38.6, -14, -38, -8.6, BPLAT_Y, 0.95, WALL);
B.crate(-44.4, -8.4, BPLAT_Y, 1.4, 1.4);
B.barrel(-40, -12.6, BPLAT_Y); B.barrel(-40.8, -13.2, BPLAT_Y);
// 大箱子 (big box) and the tunnel-exit cover
B.crateStack(-32.6, -4.6, 0, [[2.0, 1.7], [1.5, 1.3]]);
B.crate(-35.6, -1.4, 0, 1.5, 1.5);
B.crate(-42.4, -2.6, 0, 1.5, 1.5);
B.sandbags(-30.4, -8.6, -26.6, -6, 0, 1.0);                  // CT anchor cover
B.barrel(-27.4, -3, 0); B.barrel(-28.2, -3.6, 0); B.barrel(-27.2, -4, 0);
B.awning(-46, -4.6, -41, -0.4, 4.4, 0.9, 'x');
B.band(-46.3, -14.3, -25.7, 2.3, 4.3, 0.34);
B.lamp(-45.4, -10, 3.4); B.lamp(-26.6, -10, 3.4); B.lamp(-36, 1.4, 3.4);

// ---------------------------------------------------------------------------
// 14. B 门 + CT 回防通道 (B doors and the CT rotation corridor)
// ---------------------------------------------------------------------------
B.group('B 门');
B.floor(-33, -26, -27, -14, 0, SAND);
B.ramp(-33, -32, -27, -26, CT_Y, 0, 'z', MAT.CONCRETE);
B.floor(-33, -36, -27, -32, CT_Y, MAT.CONCRETE);
B.wallZ(-33, -36, -14, 0, CT_Y + 4.2, WALL);
B.wallZ(-27, -36, -14, 0, CT_Y + 4.2, WALL);
B.doubleDoor(-30, -14.6, 5.2, 3.3, 'x', 2.2);
B.arch(-30, -14.6, 5.4, 3.4, 'x', MAT.SAND_TRIM, { thick: 0.4 });
B.crate(-31.6, -20.4, 0, 1.3, 1.3);
B.lamp(-32.4, -22, 3.0); B.lamp(-27.6, -30, CT_Y + 2.6);

B.group('B-CT 通道');
B.room({
  x0: -33, z0: -42, x1: -10, z1: -36, y: CT_Y, h: 4.6, mat: WALL, floorMat: MAT.CONCRETE,
  sides: { s: { gaps: [[-33, -27, CT_Y, CT_Y + 3.6]] }, e: false },
});
B.crate(-13.4, -40.6, CT_Y, 1.4, 1.4);
B.pipe(-32, -41.4, CT_Y + 3.4, 20, 'x', 0.13);
B.lamp(-24, -36.6, CT_Y + 2.8);

// ---------------------------------------------------------------------------
// 15. 城镇天际线 (skyline) — decorative only, outside every play wall
// ---------------------------------------------------------------------------
B.group('skyline');
let seed = 20031201;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const RINGS = [
  { x0: -78, x1: -50, z0: -60, z1: 58 },     // west
  { x0: 38, x1: 68, z0: -58, z1: 58 },       // east
  { x0: -78, x1: 68, z0: -78, z1: -52 },     // north
  { x0: -78, x1: 68, z0: 50, z1: 74 },       // south
];
for (const r of RINGS) {
  for (let i = 0; i < 26; i++) {
    const w = 5 + rnd() * 9, d = 5 + rnd() * 9;
    const x = r.x0 + rnd() * (r.x1 - r.x0 - w);
    const z = r.z0 + rnd() * (r.z1 - r.z0 - d);
    const h = 4 + rnd() * 13;
    B.detail(x, z, x + w, z + d, 0, h, rnd() < 0.35 ? MAT.STONE : WALL, { uv: 2.6 });
    B.detail(x - 0.3, z - 0.3, x + w + 0.3, z + d + 0.3, h, h + 0.5, MAT.SAND_TRIM, { uv: 1.2 });
    if (rnd() < 0.4) B.detail(x + w * 0.3, z + d * 0.3, x + w * 0.3 + 2.2, z + d * 0.3 + 2.2, h + 0.5, h + 3.5 + rnd() * 3, MAT.STONE, { uv: 1.6 });
  }
}
// a distant minaret on each side for silhouette interest
for (const [mx, mz] of [[-64, 20], [52, -30], [-30, -68], [10, 62]]) {
  B.detail(mx - 2, mz - 2, mx + 2, mz + 2, 0, 20, MAT.PLASTER, { uv: 2.2 });
  B.detail(mx - 2.8, mz - 2.8, mx + 2.8, mz + 2.8, 20, 21.2, MAT.SAND_TRIM, { uv: 1.2 });
  B.detail(mx - 1.4, mz - 1.4, mx + 1.4, mz + 1.4, 21.2, 25, MAT.PLASTER, { uv: 1.6 });
}

// ---------------------------------------------------------------------------
// 16. Navigation nodes — links are discovered by walk probes at load time
// ---------------------------------------------------------------------------
const NODES = [
  // T side
  N('t_spawn', -29, 0, 36, AREA.T_SPAWN), N('t_spawn_e', -22, 0, 36, AREA.T_SPAWN),
  N('t_tun_door', -31, 0, 29.5, AREA.T_SPAWN, ['door']),
  N('plaza_s', -12, 0, 40, AREA.T_SPAWN), N('plaza_c', -14, 0, 34, AREA.T_SPAWN),
  N('plaza_mid', -9, 0, 28, AREA.MID, ['entry']), N('plaza_long', -6, 0, 37, AREA.LONG),
  // 长门 + A 大
  N('ld_w', -1, 0, 37, AREA.LONG, ['door']), N('ld_e', 7, 0, 37, AREA.LONG, ['door']),
  N('long_s', 16, 0, 38, AREA.LONG, ['sniper']), N('long_m', 16, 0, 30, AREA.LONG),
  N('long_m2', 15, 0, 22, AREA.LONG, ['cover']), N('long_n', 16, 0, 15, AREA.LONG),
  N('long_corner', 15, 0, 7, AREA.LONG, ['cover']), N('long_mouth', 14, 0, 0, AREA.LONG, ['entry']),
  // A 坑
  N('pit_s', 22, -0.9, 6.5, AREA.LONG, ['hold', 'sniper']), N('pit_n', 22, -0.9, 2, AREA.LONG, ['hold']),
  N('pit_ramp', 22, -0.45, -1, AREA.LONG),
  // A 包点
  N('a_long_in', 14, 0, -4, AREA.A_SITE, ['entry']), N('a_pit_in', 22, 0, -3.5, AREA.A_SITE),
  N('a_crates', 17, 0, -6.5, AREA.A_SITE, ['cover']), N('a_center', 20, 0, -13, AREA.A_SITE, ['plant']),
  N('a_default', 19, 0, -16, AREA.A_SITE, ['plant']), N('a_goose', 29, 0, -7.4, AREA.A_SITE, ['hold', 'cover']),
  N('a_goose_s', 31.4, 0, -3.2, AREA.A_SITE), N('a_barrels', 31.4, 0, -13.6, AREA.A_SITE, ['cover']),
  N('a_ninja', 17.4, 0, -20.4, AREA.A_SITE, ['cover']),
  N('a_plat_ramp', 23, 0.65, -21, AREA.A_SITE), N('a_plat', 28, 1.3, -21, AREA.A_SITE, ['hold', 'plant']),
  N('a_plat_e', 31.6, 1.3, -20, AREA.A_SITE, ['hold']), N('a_ramp_in', 16.5, 0, -24, AREA.A_SITE),
  N('a_short_in', 14.5, 0, -17, AREA.A_SITE, ['entry']),
  // A 斜坡 + 警家
  N('aramp_bot', 16.5, 0.15, -26.5, AREA.A_SITE, ['hold']), N('aramp_mid', 16.5, 1.2, -30, AREA.CT_SPAWN),
  N('aramp_top', 16.5, 2.4, -33, AREA.CT_SPAWN),
  N('ct_a', 16, 2.4, -37, AREA.CT_SPAWN), N('ct_c', 5, 2.4, -40, AREA.CT_SPAWN),
  N('ct_mid', -4.5, 2.4, -36.5, AREA.CT_SPAWN), N('ct_w', -8, 2.4, -41, AREA.CT_SPAWN),
  N('ct_b', -12, 2.4, -39, AREA.CT_SPAWN),
  // CT 中路 + 中路
  N('ctmid_top', -4.5, 2.4, -33, AREA.MID), N('ctmid_mid', -4.5, 1.2, -30, AREA.MID),
  N('ctmid_bot', -4.5, 0.15, -26.5, AREA.MID, ['hold', 'sniper']),
  N('mid_n', -8, 0, -22, AREA.MID, ['hold', 'sniper']), N('mid_c', -8, 0, -14, AREA.MID),
  N('mid_cw', -3.6, 0, -13, AREA.SHORT), N('mid_x', -6.4, 0, 0.6, AREA.MID, ['cover']),
  N('mid_door_n', -8.5, 0, 5, AREA.MID, ['door']), N('mid_door_s', -8.5, 0, 11, AREA.MID, ['door']),
  N('mid_s', -9, 0, 18, AREA.MID), N('mid_low', -13, 0, 22.8, AREA.TUNNEL),
  // A 小
  N('cw_bot', -0.6, 0, -13, AREA.SHORT), N('cw_pocket', 0.6, 0, -18, AREA.SHORT, ['cover']),
  N('cw_stairs', 4.6, 0.65, -13.5, AREA.SHORT), N('cw_mid', 8.6, 1.3, -15.6, AREA.SHORT, ['cover']),
  N('cw_end', 10.4, 1.3, -17, AREA.SHORT, ['entry']),
];
NODES.push(
  // 通道 (tunnels)
  N('tun_room', -32, 0, 24, AREA.TUNNEL), N('tun_room_e', -27.5, 0, 23, AREA.TUNNEL),
  N('lowtun_w', -24, 0, 23, AREA.TUNNEL), N('lowtun_e', -17, 0, 23, AREA.TUNNEL),
  N('uptun_s', -34, 0, 18, AREA.TUNNEL), N('uptun_m', -36, 0, 11, AREA.TUNNEL),
  N('uptun_n', -34, 0, 4, AREA.TUNNEL, ['entry']),
  // B 包点
  N('b_tun_in', -34, 0, 0, AREA.B_SITE, ['entry']), N('b_center', -36, 0, -4, AREA.B_SITE, ['plant']),
  N('b_default', -38.5, 0, -3.5, AREA.B_SITE, ['plant']), N('b_bigbox', -31, 0, -2.6, AREA.B_SITE, ['cover']),
  N('b_back', -44.4, 0, -2.4, AREA.B_SITE, ['cover']), N('b_plat_ramp', -36.8, 0.75, -9.6, AREA.B_SITE),
  N('b_plat', -42, 1.5, -10, AREA.B_SITE, ['hold', 'plant']), N('b_plat_w', -44.4, 1.5, -12.4, AREA.B_SITE, ['hold']),
  N('b_anchor', -28.6, 0, -10.6, AREA.B_SITE, ['hold', 'cover']),
  N('b_door_in', -30, 0, -12, AREA.B_SITE, ['entry']),
  // B 门 + 回防通道
  N('bd_s', -30, 0, -17, AREA.CONNECT, ['hold']), N('bd_m', -30, 0, -23, AREA.CONNECT),
  N('bd_ramp', -30, 1.2, -29, AREA.CONNECT), N('bd_top', -30, 2.4, -34, AREA.CONNECT),
  N('bct_w', -30, 2.4, -39, AREA.CONNECT), N('bct_e', -14, 2.4, -39, AREA.CONNECT),
);

// Ramps, stairs and one-way drops the walk probe cannot infer.
const LINKS = [
  ['t_tun_door', 'tun_room'], ['tun_room', 'tun_room_e'], ['tun_room_e', 'lowtun_w'],
  ['lowtun_w', 'lowtun_e'], ['lowtun_e', 'mid_low'], ['mid_low', 'mid_s'],
  ['tun_room', 'uptun_s'], ['uptun_s', 'uptun_m'], ['uptun_m', 'uptun_n'], ['uptun_n', 'b_tun_in'],
  ['plaza_long', 'ld_w'], ['ld_w', 'ld_e'], ['ld_e', 'long_s'],
  ['plaza_mid', 'mid_s'], ['mid_door_s', 'mid_door_n'],
  ['long_corner', 'pit_s'], ['pit_s', 'pit_n'], ['pit_n', 'pit_ramp'], ['pit_ramp', 'a_pit_in'],
  ['long_mouth', 'a_long_in'], ['a_goose', 'a_goose_s'], ['a_goose_s', 'a_pit_in'], ['a_barrels', 'a_center'],
  ['a_center', 'a_plat_ramp'], ['a_plat_ramp', 'a_plat'], ['a_plat', 'a_plat_e'], ['a_ramp_in', 'a_plat_ramp'],
  ['a_ramp_in', 'aramp_bot'], ['aramp_bot', 'aramp_mid'], ['aramp_mid', 'aramp_top'], ['aramp_top', 'ct_a'],
  ['ctmid_bot', 'ctmid_mid'], ['ctmid_mid', 'ctmid_top'], ['ctmid_top', 'ct_mid'], ['ctmid_bot', 'mid_n'],
  ['mid_cw', 'cw_bot'], ['cw_bot', 'cw_stairs'], ['cw_stairs', 'cw_mid'], ['cw_mid', 'cw_end'],
  ['cw_end', 'a_short_in'], ['cw_bot', 'cw_pocket'],
  ['b_plat', 'b_plat_ramp'], ['b_plat_ramp', 'b_center'], ['b_plat', 'b_plat_w'], ['b_plat_w', 'b_back'],
  ['b_door_in', 'bd_s'], ['bd_s', 'bd_m'], ['bd_m', 'bd_ramp'], ['bd_ramp', 'bd_top'],
  ['bd_top', 'bct_w'], ['bct_w', 'bct_e'], ['bct_e', 'ct_b'],
];

// ---------------------------------------------------------------------------
// 17. Tactics — CT angles, T routes, scripted utility
// ---------------------------------------------------------------------------
const TACTICS = {
  CT: {
    holds: {
      A: [
        HOLD(28, 1.3, -21, 14, 0, AREA.A_SITE, { name: '平台架点', prio: 3 }),
        HOLD(29, 0, -7.4, 14, 0, AREA.A_SITE, { name: '小屋架长道', prio: 3, crouch: true }),
        HOLD(22, -0.9, 6.2, 16, 26, AREA.LONG, { name: 'A 坑架长道', prio: 2 }),
        HOLD(15.6, 0, -11.6, 11, -17, AREA.A_SITE, { name: '三箱架 A 小', prio: 2, crouch: true }),
        HOLD(16.5, 0.15, -26, 19, -14, AREA.A_SITE, { name: '斜坡回防位', prio: 1 }),
        HOLD(31.6, 1.3, -20, 16, -4, AREA.A_SITE, { name: '平台后角', prio: 1 }),
      ],
      B: [
        HOLD(-42, 1.5, -10, -34, 1, AREA.B_SITE, { name: 'B 平台架洞口', prio: 3 }),
        HOLD(-28.6, 0, -10.6, -34, 1, AREA.B_SITE, { name: '沙包架洞口', prio: 3, crouch: true }),
        HOLD(-44.4, 0, -2.4, -34, 1, AREA.B_SITE, { name: '后点交叉火力', prio: 2 }),
        HOLD(-30, 0, -16, -33, -6, AREA.CONNECT, { name: 'B 门后架点', prio: 2 }),
        HOLD(-44.4, 1.5, -12.4, -33, -3, AREA.B_SITE, { name: '平台深处', prio: 1 }),
      ],
      MID: [
        HOLD(-4.5, 0.15, -26, -8.5, 8, AREA.MID, { name: 'CT 中路架中门', prio: 3 }),
        HOLD(-8, 0, -22, -8.5, 8, AREA.MID, { name: '中路控点', prio: 2, crouch: true }),
        HOLD(8.6, 1.3, -15.6, -2, -13, AREA.SHORT, { name: '过道架中路', prio: 2 }),
      ],
    },
    rotate: {
      A_to_B: ['aramp_bot', 'aramp_mid', 'aramp_top', 'ct_a', 'ct_c', 'ct_b', 'bct_e', 'bct_w', 'bd_top', 'bd_ramp', 'bd_m', 'bd_s', 'b_door_in'],
      B_to_A: ['b_door_in', 'bd_s', 'bd_m', 'bd_ramp', 'bd_top', 'bct_w', 'bct_e', 'ct_b', 'ct_c', 'ct_a', 'aramp_top', 'aramp_mid', 'aramp_bot'],
      MID_to_A: ['ctmid_bot', 'ctmid_mid', 'ctmid_top', 'ct_mid', 'ct_c', 'ct_a', 'aramp_top', 'aramp_mid', 'aramp_bot'],
      MID_to_B: ['ctmid_bot', 'ctmid_mid', 'ctmid_top', 'ct_mid', 'ct_w', 'ct_b', 'bct_e', 'bct_w', 'bd_top', 'bd_ramp', 'bd_m', 'bd_s'],
      A_to_MID: ['aramp_bot', 'aramp_mid', 'aramp_top', 'ct_a', 'ct_c', 'ct_mid', 'ctmid_top', 'ctmid_mid', 'ctmid_bot'],
      B_to_MID: ['bd_s', 'bd_m', 'bd_ramp', 'bd_top', 'bct_w', 'bct_e', 'ct_b', 'ct_w', 'ct_mid', 'ctmid_top', 'ctmid_mid', 'ctmid_bot'],
    },
    defuseFrom: { A: ['aramp_bot', 'a_ramp_in'], B: ['bd_s', 'b_door_in'] },
  },
  T: {
    routes: {
      long: ['plaza_s', 'plaza_long', 'ld_w', 'ld_e', 'long_s', 'long_m', 'long_m2', 'long_n', 'long_corner', 'long_mouth', 'a_long_in'],
      pit: ['ld_e', 'long_s', 'long_m', 'long_m2', 'long_n', 'long_corner', 'pit_s', 'pit_n', 'pit_ramp', 'a_pit_in'],
      short: ['plaza_mid', 'mid_s', 'mid_door_s', 'mid_door_n', 'mid_x', 'mid_c', 'mid_cw', 'cw_bot', 'cw_stairs', 'cw_mid', 'cw_end', 'a_short_in'],
      mid: ['plaza_mid', 'mid_s', 'mid_door_s', 'mid_door_n', 'mid_x', 'mid_c', 'mid_n'],
      tunnels: ['t_spawn', 't_tun_door', 'tun_room', 'uptun_s', 'uptun_m', 'uptun_n', 'b_tun_in', 'b_center'],
      lower: ['plaza_mid', 'mid_s', 'mid_low', 'lowtun_e', 'lowtun_w', 'tun_room_e', 'tun_room', 'uptun_s', 'uptun_m', 'uptun_n', 'b_tun_in'],
    },
    stacks: { long: 'long_m2', short: 'mid_x', mid: 'mid_door_n', tunnels: 'uptun_m', lower: 'lowtun_e', pit: 'long_n' },
    postPlant: {
      A: [HOLD(17, 0, -6.5, 14, 0, AREA.A_SITE), HOLD(28, 1.3, -21, 16, -6, AREA.A_SITE),
        HOLD(29, 0, -7.4, 22, -3, AREA.A_SITE), HOLD(17.4, 0, -20.4, 18, -14, AREA.A_SITE),
        HOLD(14, 0, -4, 16, -20, AREA.A_SITE)],
      B: [HOLD(-31, 0, -2.6, -34, -10, AREA.B_SITE), HOLD(-42, 1.5, -10, -30, -12, AREA.B_SITE),
        HOLD(-44.4, 0, -2.4, -30, -12, AREA.B_SITE), HOLD(-34, 0, 0.4, -30, -12, AREA.B_SITE),
        HOLD(-28.6, 0, -10.6, -30, -14, AREA.B_SITE)],
    },
    strats: [
      { name: 'long_a', cn: 'A 大强攻', site: 'A', lanes: { long: 0.6, short: 0.2, mid: 0.2 }, weight: 1.2 },
      { name: 'split_a', cn: 'A 小夹击', site: 'A', lanes: { short: 0.5, long: 0.3, mid: 0.2 }, weight: 1.0 },
      { name: 'rush_b', cn: 'B 洞快攻', site: 'B', lanes: { tunnels: 0.85, mid: 0.15 }, weight: 1.0 },
      { name: 'mid_to_b', cn: '控中转 B', site: 'B', lanes: { mid: 0.45, lower: 0.55 }, weight: 0.9 },
      { name: 'default', cn: '默认分推', site: 'A', lanes: { long: 0.35, mid: 0.35, tunnels: 0.3 }, weight: 1.1 },
      { name: 'eco_stack', cn: '经济局堆点', site: 'B', lanes: { tunnels: 1 }, weight: 0.6, eco: true },
    ],
  },
  nades: [
    NADE('T', 'smoke', [16, 1.6, 15], [22, 0, 4], AREA.A_SITE, 'exec', { name: '长道封坑' }),
    NADE('T', 'smoke', [15, 1.6, 7], [22, 0, -10], AREA.A_SITE, 'exec', { name: '长道封 A 十字' }),
    NADE('T', 'flash', [14, 1.6, 0.5], [20, 2.6, -10], AREA.A_SITE, 'exec', { name: '进 A 闪' }),
    NADE('T', 'molotov', [15, 1.6, 7], [29, 0, -6], AREA.A_SITE, 'exec', { name: '烧小屋' }),
    NADE('T', 'flash', [4.6, 2.2, -13.5], [16, 2.6, -14], AREA.A_SITE, 'exec', { name: 'A 小闪' }),
    NADE('T', 'smoke', [-8.5, 1.6, 5], [-4.5, 0.4, -20], AREA.MID, 'exec', { name: '中路烟封 CT' }),
    NADE('T', 'smoke', [-36, 1.6, 11], [-30, 0.4, -13], AREA.B_SITE, 'exec', { name: '洞里烟封 B 门' }),
    NADE('T', 'flash', [-34, 1.6, 4], [-38, 2.6, -6], AREA.B_SITE, 'exec', { name: '进 B 闪' }),
    NADE('T', 'molotov', [-34, 1.6, 4], [-42, 1.5, -10], AREA.B_SITE, 'exec', { name: '烧 B 平台' }),
    NADE('CT', 'flash', [16.5, 3.4, -30], [19, 2.6, -14], AREA.A_SITE, 'retake', { name: 'A 斜坡闪' }),
    NADE('CT', 'smoke', [16.5, 1.8, -26], [20, 0.4, -13], AREA.A_SITE, 'retake', { name: '封 A 下包点' }),
    NADE('CT', 'molotov', [28, 2.9, -21], [20, 0, -13], AREA.A_SITE, 'retake', { name: '烧 A 包点' }),
    NADE('CT', 'flash', [-30, 1.6, -23], [-34, 2.6, -6], AREA.B_SITE, 'retake', { name: 'B 门闪' }),
    NADE('CT', 'molotov', [-30, 1.6, -20], [-36, 0, -4], AREA.B_SITE, 'retake', { name: '烧 B 下包点' }),
    NADE('CT', 'smoke', [-8, 1.6, -22], [-8.5, 0.4, -2], AREA.MID, 'hold', { name: '中路封烟' }),
  ],
};

// ---------------------------------------------------------------------------
// 18. Map definition
// ---------------------------------------------------------------------------
export const dust2 = {
  id: 'dust2',
  name: 'Dust II',
  cn: '炙热沙城 II',
  desc: '经典沙漠城镇。A 大与中路是长距离对枪场，A 小夹击、B 洞快攻与警家回防构成整张图的攻防节奏。',
  tags: ['爆破模式', '中远距离', '经典复刻'],
  brushes: B.list,
  env: {
    sunDir: [-0.42, -0.8, 0.36],
    sunColor: 0xfff2d6,
    sunIntensity: 2.5,
    skyTop: 0x3f7fc4,
    skyBottom: 0xe2cda6,
    fog: { color: 0xdccaa6, near: 45, far: 210 },
    ambient: 1.45,
    hemiSky: 0x9fc4ee,
    hemiGround: 0xb59a6c,
    exposure: 1.05,
    ambience: 'ambient_wind',
  },
  spawns: {
    T: [
      { pos: [-31, 0, 32.5], yaw: -0.25 }, { pos: [-31, 0, 36], yaw: -0.1 },
      { pos: [-31, 0, 39.5], yaw: 0.1 }, { pos: [-34.5, 0, 34], yaw: -0.2 },
      { pos: [-34.5, 0, 38], yaw: 0.05 }, { pos: [-27.5, 0, 34.5], yaw: -0.15 },
      { pos: [-27.5, 0, 38.5], yaw: 0.08 },
    ],
    CT: [
      { pos: [4, CT_Y, -40], yaw: 1.57 }, { pos: [7.5, CT_Y, -40], yaw: 1.57 },
      { pos: [0.5, CT_Y, -40], yaw: 1.5 }, { pos: [4, CT_Y, -43.5], yaw: 1.57 },
      { pos: [7.5, CT_Y, -43.5], yaw: 1.62 }, { pos: [11, CT_Y, -41], yaw: 1.4 },
      { pos: [-2.5, CT_Y, -41.5], yaw: 1.62 },
    ],
  },
  sites: {
    A: {
      center: [20, 0, -13],
      area: { x0: 12, z0: -24.5, x1: 33, z1: -3.5, y0: -1, y1: 4 },
      plantSpots: [[20, 0, -13], [19, 0, -16.5], [28, 1.3, -21], [18.2, 0, -6.2]],
      label: 'A 包点',
    },
    B: {
      center: [-36, 0, -5],
      area: { x0: -45, z0: -13.5, x1: -28, z1: 0.5, y0: -1, y1: 4 },
      plantSpots: [[-36, 0, -4.5], [-38.5, 0, -3.5], [-42, 1.5, -10], [-31, 0, -3]],
      label: 'B 包点',
    },
  },
  buyzones: {
    T: { x0: -38, z0: 26, x1: -4, z1: 44 },
    CT: { x0: -10, z0: -46, x1: 21, z1: -33 },
  },
  radar: { min: [-48, -48], max: [36, 46] },
  nav: { nodes: NODES, links: LINKS, autoLink: { maxDist: 15 } },
  tactics: TACTICS,
  areaBoxes: [
    { area: AREA.A_SITE, x0: 11, z0: -26, x1: 34, z1: -2 },
    { area: AREA.B_SITE, x0: -46, z0: -14, x1: -26, z1: 2 },
    { area: AREA.LONG, x0: 11, z0: -2, x1: 26, z1: 42 },
    { area: AREA.SHORT, x0: -2, z0: -20, x1: 11, z1: -10 },
    { area: AREA.MID, x0: -14, z0: -26, x1: -2, z1: 26 },
    { area: AREA.TUNNEL, x0: -38, z0: 2, x1: -14, z1: 28 },
    { area: AREA.T_SPAWN, x0: -38, z0: 26, x1: -4, z1: 44 },
    { area: AREA.CT_SPAWN, x0: -10, z0: -46, x1: 21, z1: -26 },
    { area: AREA.CONNECT, x0: -33, z0: -42, x1: -26, z1: -14 },
  ],
  callouts: [
    { name: 'T Spawn', cn: 'T 出生点', pos: [-29, 0, 36] },
    { name: 'T Plaza', cn: 'T 广场', pos: [-12, 0, 36] },
    { name: 'CT Spawn', cn: '警家 · CT 出生点', pos: [5, CT_Y, -40] },
    { name: 'A Site', cn: 'A 包点', pos: [20, 0, -12] },
    { name: 'B Site', cn: 'B 包点', pos: [-36, 0, -5] },
    { name: 'Mid', cn: '中路', pos: [-8, 0, -4] },
    { name: 'Long A', cn: 'A 大 · 长道', pos: [16, 0, 26] },
    { name: 'Long Doors', cn: '长门', pos: [2.5, 0, 37] },
    { name: 'Short A', cn: 'A 小 · 过道', pos: [7, PLAT_Y, -15] },
    { name: 'Pit', cn: 'A 坑', pos: [22, PIT_Y, 4] },
    { name: 'A Ramp', cn: 'A 斜坡', pos: [16.5, 1.2, -30] },
    { name: 'Mid Doors', cn: '中门 · 双门', pos: [-8.5, 0, 8] },
    { name: 'Xbox', cn: 'Xbox 箱子', pos: [-4.6, 0, 2.6] },
    { name: 'B Tunnels', cn: 'B 洞 · 上层通道', pos: [-34, 0, 11] },
    { name: 'Lower Tunnel', cn: '下层通道', pos: [-20, 0, 23] },
    { name: 'Tunnel Entrance', cn: '通道口', pos: [-32, 0, 24] },
    { name: 'B Doors', cn: 'B 门', pos: [-30, 0, -15] },
    { name: 'B Platform', cn: 'B 平台', pos: [-42, BPLAT_Y, -10] },
    { name: 'A Platform', cn: 'A 平台 · 默认下包点', pos: [28, PLAT_Y, -21] },
    { name: 'Triple Stack', cn: '三箱掩体', pos: [17, 0, -8] },
    { name: 'Goose', cn: '小屋', pos: [29, 0, -7.4] },
    { name: 'Big Box', cn: '大箱子', pos: [-32.6, 0, -4.6] },
    { name: 'CT Mid', cn: 'CT 中路', pos: [-4.5, 1.2, -30] },
    { name: 'Long Corner', cn: '长道拐角', pos: [15, 0, 7] },
  ],
  sniperLines: [
    { from: [16, 38], to: [16, -2], label: 'A 大对枪线 · 约 40 m' },
    { from: [-8.5, 11], to: [-4.5, -26], label: '中路对枪线 · 约 37 m' },
    { from: [22, 6], to: [16, 30], label: 'A 坑架长道 · 约 25 m' },
    { from: [-34, 2], to: [-42, -11], label: 'B 洞进点线 · 约 15 m' },
    { from: [10, -17], to: [-2, -13], label: 'A 小过道线 · 约 13 m' },
  ],
};

export default dust2;













