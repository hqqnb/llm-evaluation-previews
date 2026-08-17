// ============================================================================
// maps/bazaar.js — 沙漠集市 · Bazaar
//
// Tactical identity: long lanes and utility.  A 36 m alley to A, a 40 m back
// street to B and an open market square in the middle mean nothing is crossed
// without smoke; CT rotations are long, so map control decides rounds instead
// of reflexes — the opposite of Refinery.
//
//        CT 出生点 ─────────┬──── CT→B 通道 ────┐
//   A 包点 露天广场 ── 民居 ┘                   │
//        │  (balcony +2.6)                B 包点 车站货仓 (+2.4)
//      长巷 (36 m)          拱廊 ── 集市中心      │
//        │                        │            B 后门
//      T 广场 ────────────────────┘              │
//        │                                   后巷 (40 m)
//      T 出生点 ─────────────────────────────────┘
// ============================================================================

import { brushes, N, HOLD, NADE } from './kit.js';
import { MAT, AREA } from '../core/constants.js';

const B = brushes();
const W = MAT.SAND_WALL;
const FLOOR = MAT.SAND_FLOOR;
const H = 6.8;
const BAL_Y = 2.6;     // A 包点 阳台
const MEZ_Y = 2.4;     // B 包点 夹层

// --- 1. T 出生点 -------------------------------------------------------------
B.group('T 出生点');
B.room({
  x0: -40, z0: 16, x1: -26, z1: 32, y: 0, h: H, mat: MAT.PLASTER, floorMat: FLOOR,
  sides: { e: { gaps: [[20, 28, 0, 4.4]] }, s: { gaps: [[-36, -30, 0, 4.4]] } },
});
B.crateStack(-38, 18.4, 0, [[1.5, 1.5], [1.2, 1.2]]);
B.crate(-28, 30, 0, 1.4, 1.4);
B.awning(-40, 20, -35, 26, 3.8, 0.9, 'x');
B.band(-40.3, 15.7, -25.7, 32.3, 4.6, 0.34);
B.lamp(-39.4, 24, 3.6); B.lamp(-26.6, 20, 3.6);

// --- 2. T 广场 (the fork: north to 长巷, east to 集市中心) --------------------
B.group('T 广场');
B.room({
  x0: -26, z0: 18, x1: -12, z1: 32, y: 0, h: H, mat: W, floorMat: FLOOR,
  sides: {
    w: false,
    n: { gaps: [[-24, -14, 0, H]] },             // → 长巷
    e: { gaps: [[19, 23, 0, 4.4]] },             // → 集市中心
  },
});
B.crate(-24, 30.4, 0, 1.5, 1.5);
B.sandbags(-16.4, 28, -13, 30.4, 0, 0.95);
B.arch(-12, 21, 4.4, 4.4, 'z', MAT.SAND_TRIM);
B.band(-26.3, 17.7, -11.7, 32.3, 4.6, 0.34);
B.lamp(-25.4, 26, 3.6);

// --- 3. 长巷 (the 36 m lane to A — the map's main duel) ----------------------
B.group('长巷');
B.room({
  x0: -24, z0: -18, x1: -14, z1: 18, y: 0, h: H, mat: W, floorMat: FLOOR,
  sides: { s: false, n: false },                 // T 广场 / A 包点 own those
});
B.crateStack(-22.6, 12, 0, [[1.5, 1.5]]);
B.crate(-15.4, 4, 0, 1.4, 1.4);
B.parapet(-23.6, -4, -20, -3.4, 0, 1.1, W);      // waist-high market stall
B.barrel(-15, -10, 0); B.barrel(-15.8, -10.8, 0);
B.awning(-24, 6, -20.6, 11, 4.2, 0.9, 'x');
B.awning(-17.4, -14, -14, -9, 4.2, 0.9, 'x');
B.band(-24.3, -18.3, -13.7, 18.3, 4.5, 0.32);
B.lamp(-23.4, 8, 3.4); B.lamp(-14.6, -2, 3.4); B.lamp(-23.4, -12, 3.4);

// --- 4. A 包点 · 露天广场 ----------------------------------------------------
B.group('A 包点');
B.room({
  x0: -30, z0: -32, x1: -8, z1: -18, y: 0, h: H, mat: MAT.PLASTER, floorMat: MAT.TILE,
  sides: {
    s: { gaps: [[-24, -14, 0, H]] },             // ← 长巷
    e: { gaps: [[-31, -27, 0, 4.4], [-24, -19, BAL_Y, BAL_Y + 3.0]] },  // ← CT / ← 阳台
  },
});
B.box(-20, -26, -15, -22, 0, 1.0, MAT.STONE, { uv: 1.2 });        // fountain block
B.cyl(-17.5, -24, 1.0, 1.9, 1.0, MAT.STONE, { seg: 14 });
B.crateStack(-27, -22, 0, [[1.6, 1.6], [1.3, 1.2]]);              // market stalls
B.crate(-12, -29.4, 0, 1.5, 1.5);
B.crate(-27.4, -30, 0, 1.4, 1.4);
B.sandbags(-11.6, -24.6, -8.6, -22, 0, 1.0);
B.awning(-30, -30, -25, -25, 4.4, 1.0, 'x');
B.awning(-14, -31.4, -8.6, -27, 4.4, 1.0, 'z');
B.band(-30.3, -32.3, -7.7, -17.7, 4.6, 0.34);
B.lamp(-29.4, -24, 3.6); B.lamp(-9, -30, 3.6); B.lamp(-20, -18.6, 3.6);

// --- 5. 民居 (apartments: the interior route with a balcony over A) ----------
B.group('民居');
B.room({
  x0: -8, z0: -26, x1: 8, z1: -6, y: 0, h: 5.6, mat: MAT.BRICK, floorMat: MAT.RUG,
  ceiling: true, ceilMat: MAT.WOOD, ceilThick: 0.5,
  sides: {
    w: false,                                    // A 包点 owns that wall
    s: { gaps: [[-4, 2, 0, 4.0]] },              // → 集市中心
    n: { gaps: [[-2, 4, 0, 4.0]] },              // → CT 出生点
  },
});
B.stairs(-7.6, -12, -4, -8, 0, BAL_Y, 'x', 7, MAT.WOOD);
B.platform(-8, -24, -4, -12, BAL_Y, MAT.WOOD, { base: BAL_Y - 0.3, lip: false });
B.parapet(-4.5, -24, -4, -12.4, BAL_Y, 1.05, MAT.BRICK);
B.crate(-6, -23.4, BAL_Y, 1.3, 1.3);
B.crate(6, -24.4, 0, 1.4, 1.4);
B.crate(2, -8, 0, 1.4, 1.4);
B.planks(0, -20, 3.4, -17, 0, 3, MAT.WOOD);
B.pipe(7.4, -25, 4.4, 18, 'z', 0.12);
B.lamp(7.4, -16, 3.8); B.lamp(-7.4, -16, 3.8);

// --- 6. 集市中心 (the contested market square) -------------------------------
B.group('集市中心');
B.room({
  x0: -12, z0: 4, x1: 8, z1: 24, y: 0, h: H, mat: W, floorMat: FLOOR,
  sides: {
    w: { gaps: [[19, 23, 0, 4.4]] },             // ← T 广场
    n: false,                                    // 民居 owns it
    e: { gaps: [[8, 18, 0, 4.4]] },              // → 拱廊
  },
});
// market stalls: the cover that has to be smoked to cross
B.parapet(-9, 9, -4, 9.6, 0, 1.15, MAT.STONE);
B.awning(-10, 8, -3, 12, 3.4, 0.8, 'x');
B.parapet(0, 17, 5, 17.6, 0, 1.15, MAT.STONE);
B.awning(-1, 16, 6, 20, 3.4, 0.8, 'x');
B.crateStack(-6, 20, 0, [[1.6, 1.6], [1.3, 1.2]]);
B.crate(4, 6.6, 0, 1.5, 1.5);
B.barrel(-11, 14, 0); B.barrel(-10.2, 14.8, 0); B.barrel(-11.4, 15.2, 0);
B.cyl(-2, 13, 0, 1.2, 1.1, MAT.STONE, { seg: 14 });               // well head
B.band(-12.3, 3.7, 8.3, 24.3, 4.6, 0.34);
B.lamp(-11.4, 20, 3.6); B.lamp(7.4, 8, 3.6);

// --- 7. 拱廊 (pillared arcade linking mid to B) -------------------------------
B.group('拱廊');
B.room({
  x0: 8, z0: 4, x1: 18, z1: 20, y: 0, h: 5.4, mat: MAT.PLASTER, floorMat: MAT.TILE,
  ceiling: true, ceilMat: MAT.ROOF, ceilThick: 0.5,
  sides: { w: false, e: { gaps: [[8, 16, 0, 4.2]] } },             // → B 包点
});
for (let i = 0; i < 3; i++) B.pillar(11, 7 + i * 5, 0, 4.9, 0.7, MAT.STONE);
for (let i = 0; i < 3; i++) B.pillar(15.4, 7 + i * 5, 0, 4.9, 0.7, MAT.STONE);
B.crate(13, 18.4, 0, 1.4, 1.4);
B.barrel(9, 5.4, 0);
B.lamp(9, 12, 3.8); B.lamp(17, 12, 3.8);

// --- 8. B 包点 · 车站货仓 (warehouse with a mezzanine) -----------------------
B.group('B 包点');
B.room({
  x0: 18, z0: 6, x1: 34, z1: 28, y: 0, h: 7.4, mat: MAT.BRICK, floorMat: MAT.CONCRETE,
  ceiling: true, ceilMat: MAT.METAL, ceilThick: 0.5,
  sides: {
    w: { gaps: [[8, 16, 0, 4.2]] },              // ← 拱廊
    n: { gaps: [[22, 28, 0, 4.2]] },             // ← CT→B 通道
    s: { gaps: [[21, 25, 0, 4.2]] },             // ← B 后门 (T flank)
  },
});
B.platform(28, 6, 34, 16, MEZ_Y, MAT.WOOD, { base: MEZ_Y - 0.35, lip: false });
B.stairs(24.4, 6.4, 28, 9.4, 0, MEZ_Y, 'x', 7, MAT.WOOD);
B.parapet(27.6, 9.6, 28.1, 16, MEZ_Y, 0.88, MAT.WOOD);
B.parapet(28, 15.6, 34, 16.1, MEZ_Y, 1.05, MAT.WOOD);
B.crateStack(22, 20, 0, [[2.0, 1.7], [1.5, 1.3]]);                // freight stack
B.crate(31, 22.4, 0, 1.6, 1.6);
B.crate(20.4, 12, 0, 1.5, 1.5);
B.crate(31.4, 10, MEZ_Y, 1.4, 1.4);
B.barrel(26, 26.4, 0); B.barrel(26.8, 25.6, 0); B.barrel(25.4, 25.4, 0);
B.sandbags(18.6, 24, 21.4, 26.4, 0, 1.0);
B.pipe(18.4, 7, 5.4, 22, 'z', 0.16);
B.band(17.7, 5.7, 34.3, 28.3, 5.0, 0.34);
B.lamp(18.6, 12, 4.4); B.lamp(33.4, 22, 4.4); B.lamp(26, 27.4, 4.4);

// --- 9. CT 出生点 + CT→B 通道 -----------------------------------------------
B.group('CT 出生点');
B.room({
  x0: -8, z0: -36, x1: 20, z1: -26, y: 0, h: 6.0, mat: MAT.PLASTER, floorMat: MAT.TILE,
  sides: {
    w: { gaps: [[-31, -27, 0, 4.4]] },           // → A 包点
    s: { gaps: [[-2, 4, 0, 4.0], [13, 19, 0, 4.2]] },   // → 民居 / → CT→B 通道
  },
});
B.crateStack(-5, -34, 0, [[1.5, 1.5]]);
B.crate(18, -28.4, 0, 1.4, 1.4);
B.awning(-8, -34, -3, -29, 4.2, 0.9, 'x');
B.band(-8.3, -36.3, 20.3, -25.7, 4.6, 0.34);
B.lamp(-7.4, -30, 3.8); B.lamp(19.4, -30, 3.8);

B.group('CT→B 通道');
B.room({
  x0: 13, z0: -26, x1: 21, z1: 6, y: 0, h: 5.4, mat: W, floorMat: MAT.CONCRETE,
  sides: { n: false, s: false },                  // CT 出生点 / B 包点 own those
});
B.crate(14.6, -20, 0, 1.4, 1.4);
B.crate(19.4, -6, 0, 1.4, 1.4);
B.arch(17, -25, 6, 4.2, 'x', MAT.SAND_TRIM);
B.lamp(13.6, -14, 3.6); B.lamp(20.4, -2, 3.6);

// --- 10. 后巷 (40 m back street: the T flank to B) ---------------------------
B.group('后巷');
B.room({
  x0: -40, z0: 32, x1: 26, z1: 40, y: 0, h: H, mat: MAT.BRICK, floorMat: FLOOR,
  sides: { n: { gaps: [[-36, -30, 0, 4.4], [20, 24, 0, 4.4]] } },   // ← T 出生点 / → B 后门
});
B.crate(-20, 38.4, 0, 1.5, 1.5);
B.crate(-6, 33.6, 0, 1.4, 1.4);
B.parapet(-14, 35.4, -9, 36, 0, 1.1, MAT.STONE);
B.barrel(2, 38.4, 0); B.barrel(2.8, 37.6, 0);
B.crate(14, 34, 0, 1.4, 1.4);
B.awning(-34, 32, -29, 36, 4.2, 0.9, 'x');
B.awning(-4, 36, 2, 39.6, 4.2, 0.9, 'x');
B.band(-40.3, 31.7, 26.3, 40.3, 4.6, 0.34);
B.lamp(-30, 32.6, 3.6); B.lamp(-10, 39.4, 3.6); B.lamp(18, 32.6, 3.6);

B.group('B 后门');
B.room({
  x0: 20, z0: 28, x1: 26, z1: 32, y: 0, h: 4.6, mat: MAT.PLASTER, floorMat: MAT.CONCRETE,
  ceiling: true, ceilMat: MAT.WOOD,
  sides: { s: false, n: false },                  // 后巷 / B 包点 own those
});
B.doubleDoor(23, 28.4, 4.4, 3.4, 'x', 2.0, MAT.DOOR);
B.lamp(25.4, 30, 3.4);

// --- 11. 城镇天际线 ----------------------------------------------------------
B.group('skyline');
let seed = 419203;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
for (const r of [
  { x0: -78, x1: -46, z0: -54, z1: 56 }, { x0: 38, x1: 70, z0: -54, z1: 56 },
  { x0: -78, x1: 70, z0: -70, z1: -44 }, { x0: -78, x1: 70, z0: 46, z1: 70 },
]) {
  for (let i = 0; i < 18; i++) {
    const w = 6 + rnd() * 10, d = 6 + rnd() * 10;
    const x = r.x0 + rnd() * (r.x1 - r.x0 - w), z = r.z0 + rnd() * (r.z1 - r.z0 - d);
    const h = 4 + rnd() * 14;
    B.detail(x, z, x + w, z + d, 0, h, rnd() < 0.4 ? MAT.BRICK : MAT.PLASTER, { uv: 2.6 });
    B.detail(x - 0.3, z - 0.3, x + w + 0.3, z + d + 0.3, h, h + 0.5, MAT.SAND_TRIM, { uv: 1.2 });
  }
}
for (const [mx, mz] of [[-60, 6], [52, -12], [-24, -60], [6, 58]]) {
  B.detail(mx - 2.2, mz - 2.2, mx + 2.2, mz + 2.2, 0, 22, MAT.PLASTER, { uv: 2.2 });
  B.detail(mx - 3, mz - 3, mx + 3, mz + 3, 22, 23.4, MAT.SAND_TRIM, { uv: 1.2 });
  B.detail(mx - 1.5, mz - 1.5, mx + 1.5, mz + 1.5, 23.4, 27, MAT.PLASTER, { uv: 1.6 });
}

// --- 12. Navigation ----------------------------------------------------------
const NODES = [
  N('t_spawn', -33, 0, 24, AREA.T_SPAWN), N('t_east', -27, 0, 24, AREA.T_SPAWN, ['door']),
  N('t_south', -33, 0, 30, AREA.T_SPAWN, ['door']),
  N('plaza_c', -19, 0, 27, AREA.T_SPAWN, ['cover']), N('plaza_n', -19, 0, 20, AREA.LONG, ['entry']),
  N('plaza_e', -13, 0, 21, AREA.MID, ['door']),
  N('long_s', -19, 0, 13, AREA.LONG, ['sniper']), N('long_m', -19, 0, 4, AREA.LONG),
  N('long_m2', -21.6, 0, -2.2, AREA.LONG, ['cover']), N('long_n', -19, 0, -11, AREA.LONG),
  N('long_mouth', -19, 0, -17, AREA.LONG, ['entry']),
  N('a_south', -19, 0, -21, AREA.A_SITE, ['entry']), N('a_center', -17, 0, -28.6, AREA.A_SITE, ['plant']),
  N('a_fountain', -22, 0, -27, AREA.A_SITE, ['plant', 'cover']), N('a_stalls', -27, 0, -25.4, AREA.A_SITE, ['cover']),
  N('a_east', -11, 0, -25.6, AREA.A_SITE, ['cover']), N('a_ct_gate', -9, 0, -29, AREA.A_SITE, ['door']),
  N('a_bal_drop', -20, 0, -20, AREA.A_SITE),
  N('bal_a', -6, BAL_Y, -20, AREA.A_SITE, ['hold', 'sniper']), N('bal_s', -6, BAL_Y, -14, AREA.A_SITE),
  N('apt_stair', -5.3, 1.86, -10, AREA.CONNECT), N('apt_w', -6, 0, -16, AREA.CONNECT),
  N('apt_c', 1, 0, -16, AREA.CONNECT, ['cover']), N('apt_s', -1, 0, -8, AREA.CONNECT, ['door']),
  N('apt_n', 1, 0, -24, AREA.CONNECT, ['door']),
  N('mid_w', -10, 0, 12, AREA.MID, ['cover']), N('mid_c', -4.6, 0, 14, AREA.MID, ['cover']),
  N('mid_n', -2, 0, 6, AREA.MID, ['entry']), N('mid_s', -6, 0, 22, AREA.MID),
  N('mid_e', 6, 0, 12, AREA.MID, ['door']),
  N('arc_w', 9.4, 0, 12, AREA.SHORT), N('arc_c', 13.2, 0, 12, AREA.SHORT, ['cover']),
  N('arc_e', 17, 0, 12, AREA.SHORT, ['entry']),
  N('b_west', 19.2, 0, 14, AREA.B_SITE, ['entry']), N('b_center', 25, 0, 15, AREA.B_SITE, ['plant']),
  N('b_freight', 24, 0, 17.6, AREA.B_SITE, ['cover']), N('b_north', 23.4, 0, 9.6, AREA.B_SITE, ['plant']),
  N('b_south', 22, 0, 24, AREA.B_SITE, ['cover']), N('b_east', 31.4, 0, 19, AREA.B_SITE, ['cover']),
  N('b_stair', 26, 1.2, 8, AREA.B_SITE), N('b_mez', 31, MEZ_Y, 12, AREA.B_SITE, ['hold', 'sniper']),
  N('b_mez_n', 31, MEZ_Y, 8, AREA.B_SITE, ['hold']),
  N('b_back_door', 23, 0, 30, AREA.B_SITE, ['door']),
  N('alley_w', -33, 0, 36, AREA.CONNECT), N('alley_m', -14, 0, 33.6, AREA.CONNECT),
  N('alley_e', 6, 0, 36, AREA.CONNECT), N('alley_b', 22, 0, 36, AREA.CONNECT),
  N('ct_a', -5, 0, -31, AREA.CT_SPAWN), N('ct_c', 4, 0, -31, AREA.CT_SPAWN),
  N('ct_e', 16, 0, -30, AREA.CT_SPAWN), N('ct_apt', 1, 0, -28, AREA.CT_SPAWN, ['door']),
  N('ctb_n', 17, 0, -22, AREA.CONNECT), N('ctb_m', 17, 0, -10, AREA.CONNECT),
  N('ctb_s', 17, 0, 2, AREA.CONNECT, ['hold']),
];

const LINKS = [
  ['t_spawn', 't_east'], ['t_east', 'plaza_c'], ['plaza_c', 'plaza_n'], ['plaza_c', 'plaza_e'],
  ['plaza_e', 'mid_s'], ['plaza_n', 'long_s'], ['long_s', 'long_m'], ['long_m', 'long_m2'],
  ['long_m2', 'long_n'], ['long_n', 'long_mouth'], ['long_mouth', 'a_south'], ['a_south', 'a_center'],
  ['a_center', 'a_fountain'], ['a_center', 'a_stalls'], ['a_center', 'a_east'], ['a_east', 'a_ct_gate'],
  ['a_ct_gate', 'ct_a'], ['bal_a', 'a_bal_drop'], ['a_bal_drop', 'a_south'], ['bal_a', 'bal_s'],
  ['bal_s', 'apt_stair'], ['apt_stair', 'apt_w'], ['apt_w', 'apt_c'], ['apt_c', 'apt_s'],
  ['apt_c', 'apt_n'], ['apt_n', 'ct_apt'], ['apt_s', 'mid_n'], ['apt_w', 'a_east'],
  ['mid_n', 'mid_c'], ['mid_c', 'mid_w'], ['mid_c', 'mid_s'], ['mid_c', 'mid_e'],
  ['mid_e', 'arc_w'], ['arc_w', 'arc_c'], ['arc_c', 'arc_e'], ['arc_e', 'b_west'],
  ['b_west', 'b_center'], ['b_center', 'b_freight'], ['b_center', 'b_north'], ['b_center', 'b_east'],
  ['b_freight', 'b_south'], ['b_south', 'b_back_door'], ['b_back_door', 'alley_b'],
  ['b_north', 'b_stair'], ['b_stair', 'b_mez_n'], ['b_mez_n', 'b_mez'], ['b_mez', 'b_east'],
  ['t_spawn', 't_south'], ['t_south', 'alley_w'], ['alley_w', 'alley_m'], ['alley_m', 'alley_e'],
  ['alley_e', 'alley_b'],
  ['ct_a', 'ct_c'], ['ct_c', 'ct_e'], ['ct_c', 'ct_apt'], ['ct_e', 'ctb_n'],
  ['ctb_n', 'ctb_m'], ['ctb_m', 'ctb_s'], ['ctb_s', 'b_north'],
];

const TACTICS = {
  CT: {
    holds: {
      A: [
        HOLD(-6, BAL_Y, -20, -19, -25, AREA.A_SITE, { name: '阳台架长巷', prio: 3 }),
        HOLD(-11, 0, -25.6, -19, -21, AREA.A_SITE, { name: '沙包架点', prio: 3, crouch: true }),
        HOLD(-27, 0, -25.4, -19, -20, AREA.A_SITE, { name: '摊位后角', prio: 2, crouch: true }),
        HOLD(-22, 0, -27, -19, -21, AREA.A_SITE, { name: '水池掩体', prio: 2 }),
        HOLD(-9, 0, -29, -20, -24, AREA.A_SITE, { name: '警家门口', prio: 1 }),
      ],
      B: [
        HOLD(31, MEZ_Y, 12, 19, 12, AREA.B_SITE, { name: '夹层架门', prio: 3 }),
        HOLD(31.4, 0, 19, 19, 12, AREA.B_SITE, { name: '东侧货架', prio: 3, crouch: true }),
        HOLD(22, 0, 24, 23, 30, AREA.B_SITE, { name: '守后门', prio: 2, crouch: true }),
        HOLD(31, MEZ_Y, 8, 19, 12, AREA.B_SITE, { name: '夹层深处', prio: 2 }),
        HOLD(17, 0, 2, 19, 14, AREA.CONNECT, { name: '通道口回防', prio: 1 }),
      ],
      MID: [
        HOLD(-2, 0, 6, -6, 22, AREA.MID, { name: '集市北口架点', prio: 3 }),
        HOLD(1, 0, -16, -6, -16, AREA.CONNECT, { name: '民居内架点', prio: 2, crouch: true }),
        HOLD(13.2, 0, 12, 6, 12, AREA.SHORT, { name: '拱廊架中路', prio: 2 }),
      ],
    },
    rotate: {
      A_to_B: ['a_ct_gate', 'ct_a', 'ct_c', 'ct_e', 'ctb_n', 'ctb_m', 'ctb_s', 'b_north', 'b_center'],
      B_to_A: ['b_north', 'ctb_s', 'ctb_m', 'ctb_n', 'ct_e', 'ct_c', 'ct_a', 'a_ct_gate', 'a_east'],
      MID_to_A: ['mid_n', 'apt_s', 'apt_c', 'apt_w', 'a_east', 'a_center'],
      MID_to_B: ['mid_e', 'arc_w', 'arc_c', 'arc_e', 'b_west', 'b_center'],
      A_to_MID: ['a_east', 'apt_w', 'apt_c', 'apt_s', 'mid_n'],
      B_to_MID: ['b_west', 'arc_e', 'arc_c', 'arc_w', 'mid_e', 'mid_c'],
    },
    defuseFrom: { A: ['a_ct_gate', 'a_east'], B: ['ctb_s', 'b_north'] },
  },
  T: {
    routes: {
      long: ['t_spawn', 't_east', 'plaza_c', 'plaza_n', 'long_s', 'long_m', 'long_m2', 'long_n', 'long_mouth', 'a_south', 'a_center'],
      mid: ['t_spawn', 't_east', 'plaza_c', 'plaza_e', 'mid_s', 'mid_c', 'mid_n', 'apt_s', 'apt_c', 'apt_w', 'a_east'],
      arcade: ['plaza_e', 'mid_s', 'mid_c', 'mid_e', 'arc_w', 'arc_c', 'arc_e', 'b_west', 'b_center'],
      alley: ['t_spawn', 't_south', 'alley_w', 'alley_m', 'alley_e', 'alley_b', 'b_back_door', 'b_south', 'b_center'],
    },
    stacks: { long: 'long_m', mid: 'mid_c', arcade: 'mid_e', alley: 'alley_m' },
    postPlant: {
      A: [HOLD(-27, 0, -25.4, -19, -21, AREA.A_SITE), HOLD(-22, 0, -27, -11, -25, AREA.A_SITE),
        HOLD(-11, 0, -25.6, -19, -21, AREA.A_SITE), HOLD(-19, 0, -21, -6, -21, AREA.A_SITE),
        HOLD(-6, BAL_Y, -20, -19, -25, AREA.A_SITE)],
      B: [HOLD(24, 0, 17.6, 19, 12, AREA.B_SITE), HOLD(31, MEZ_Y, 12, 19, 12, AREA.B_SITE),
        HOLD(31.4, 0, 19, 19, 12, AREA.B_SITE), HOLD(22, 0, 24, 19, 12, AREA.B_SITE),
        HOLD(23.4, 0, 9.6, 19, 12, AREA.B_SITE)],
    },
    strats: [
      { name: 'long_a', cn: '长巷强攻 A', site: 'A', lanes: { long: 0.65, mid: 0.35 }, weight: 1.2 },
      { name: 'split_a', cn: '民居夹击 A', site: 'A', lanes: { mid: 0.5, long: 0.5 }, weight: 1.1 },
      { name: 'arcade_b', cn: '拱廊打 B', site: 'B', lanes: { arcade: 0.7, alley: 0.3 }, weight: 1.0 },
      { name: 'alley_b', cn: '后巷绕后 B', site: 'B', lanes: { alley: 0.7, arcade: 0.3 }, weight: 1.0 },
      { name: 'default', cn: '默认分推', site: 'A', lanes: { long: 0.4, mid: 0.3, arcade: 0.3 }, weight: 1.0 },
      { name: 'eco_stack', cn: '经济局堆点', site: 'A', lanes: { long: 1 }, weight: 0.6, eco: true },
    ],
  },
  nades: [
    NADE('T', 'smoke', [-19, 1.6, 4], [-19, 0.4, -19], AREA.A_SITE, 'exec', { name: '长巷封 A 口' }),
    NADE('T', 'smoke', [-19, 1.6, -11], [-6, 2.6, -21], AREA.A_SITE, 'exec', { name: '封阳台' }),
    NADE('T', 'flash', [-19, 1.6, -16], [-17, 2.6, -25], AREA.A_SITE, 'exec', { name: '进 A 闪' }),
    NADE('T', 'molotov', [-19, 1.6, -14], [-11, 0, -25], AREA.A_SITE, 'exec', { name: '烧沙包点' }),
    NADE('T', 'flash', [1, 1.6, -14], [-11, 2.6, -24], AREA.A_SITE, 'exec', { name: '民居侧闪' }),
    NADE('T', 'smoke', [-2, 1.6, 14], [-2, 0.4, 5], AREA.MID, 'exec', { name: '集市封北口' }),
    NADE('T', 'smoke', [13.2, 1.6, 12], [24, 0.4, 12], AREA.B_SITE, 'exec', { name: '拱廊封仓门' }),
    NADE('T', 'flash', [17, 1.6, 12], [26, 2.6, 14], AREA.B_SITE, 'exec', { name: '进 B 闪' }),
    NADE('T', 'molotov', [17, 1.6, 12], [31, MEZ_Y, 12], AREA.B_SITE, 'exec', { name: '烧夹层' }),
    NADE('T', 'flash', [22, 1.6, 32], [24, 2.6, 22], AREA.B_SITE, 'exec', { name: '后门闪' }),
    NADE('CT', 'flash', [-9, 1.6, -29], [-19, 2.6, -23], AREA.A_SITE, 'retake', { name: '警家门闪' }),
    NADE('CT', 'molotov', [-9, 1.6, -28], [-17, 0, -25], AREA.A_SITE, 'retake', { name: '烧 A 下包点' }),
    NADE('CT', 'smoke', [-9, 1.6, -27], [-19, 0.4, -20], AREA.A_SITE, 'retake', { name: '封长巷口' }),
    NADE('CT', 'flash', [17, 1.6, 2], [25, 2.6, 15], AREA.B_SITE, 'retake', { name: 'B 通道闪' }),
    NADE('CT', 'molotov', [17, 1.6, 4], [24, 0, 16], AREA.B_SITE, 'retake', { name: '烧 B 下包点' }),
    NADE('CT', 'smoke', [-2, 1.6, 6], [-2, 0.4, 20], AREA.MID, 'hold', { name: '集市封烟' }),
  ],
};

export const bazaar = {
  id: 'bazaar',
  name: 'Bazaar',
  cn: '沙漠集市',
  desc: '长巷、集市与后巷构成三条截然不同的进攻线。视野开阔、换点漫长，没有烟雾和闪光很难过点，是一张吃地图控制与道具配合的图。',
  tags: ['爆破模式', '远距离', '道具博弈'],
  brushes: B.list,
  env: {
    sunDir: [0.38, -0.78, -0.42],
    sunColor: 0xffeccb,
    sunIntensity: 2.4,
    skyTop: 0x4a86c8,
    skyBottom: 0xe8d8b4,
    fog: { color: 0xe3d3b0, near: 50, far: 220 },
    ambient: 1.35,
    hemiSky: 0xa8c8ee,
    hemiGround: 0xb0996f,
    exposure: 1.04,
    ambience: 'ambient_wind',
  },
  spawns: {
    T: [
      { pos: [-36, 0, 20], yaw: 0.2 }, { pos: [-36, 0, 24], yaw: 0.1 },
      { pos: [-36, 0, 28], yaw: 0.4 }, { pos: [-32, 0, 21], yaw: 0.1 },
      { pos: [-32, 0, 27], yaw: 0.3 }, { pos: [-29, 0, 23], yaw: 0.05 },
      { pos: [-29, 0, 28], yaw: 0.35 },
    ],
    CT: [
      { pos: [-4, 0, -32], yaw: 1.4 }, { pos: [0, 0, -32], yaw: 1.57 },
      { pos: [4, 0, -32], yaw: 1.57 }, { pos: [8, 0, -32], yaw: 1.7 },
      { pos: [12, 0, -31], yaw: 1.75 }, { pos: [0, 0, -28], yaw: 1.57 },
      { pos: [16, 0, -32], yaw: 1.75 },
    ],
  },
  sites: {
    A: {
      center: [-19, 0, -25],
      area: { x0: -29, z0: -31, x1: -9, z1: -19, y0: -1, y1: 4 },
      plantSpots: [[-17, 0, -28.6], [-22, 0, -27], [-27, 0, -25.4], [-11, 0, -25.6]],
      label: 'A 包点 · 露天广场',
    },
    B: {
      center: [25, 0, 15],
      area: { x0: 19, z0: 7, x1: 33, z1: 27, y0: -1, y1: 4 },
      plantSpots: [[25, 0, 15], [24, 0, 17.6], [23.4, 0, 9.6], [22, 0, 24]],
      label: 'B 包点 · 车站货仓',
    },
  },
  buyzones: {
    T: { x0: -40, z0: 16, x1: -26, z1: 32 },
    CT: { x0: -8, z0: -36, x1: 20, z1: -25 },
  },
  radar: { min: [-44, -40], max: [38, 44] },
  nav: { nodes: NODES, links: LINKS, autoLink: { maxDist: 15 } },
  tactics: TACTICS,
  areaBoxes: [
    { area: AREA.A_SITE, x0: -30, z0: -32, x1: -8, z1: -18 },
    { area: AREA.B_SITE, x0: 18, z0: 6, x1: 34, z1: 28 },
    { area: AREA.LONG, x0: -24, z0: -18, x1: -14, z1: 20 },
    { area: AREA.MID, x0: -12, z0: 4, x1: 8, z1: 24 },
    { area: AREA.SHORT, x0: 8, z0: 4, x1: 18, z1: 20 },
    { area: AREA.T_SPAWN, x0: -40, z0: 16, x1: -12, z1: 32 },
    { area: AREA.CT_SPAWN, x0: -8, z0: -36, x1: 20, z1: -26 },
    { area: AREA.CONNECT, x0: -8, z0: -26, x1: 8, z1: -6 },
    { area: AREA.CONNECT, x0: 13, z0: -26, x1: 21, z1: 6 },
    { area: AREA.CONNECT, x0: -40, z0: 32, x1: 26, z1: 40 },
  ],
  callouts: [
    { name: 'T Spawn', cn: 'T 出生点', pos: [-33, 0, 24] },
    { name: 'T Plaza', cn: 'T 广场', pos: [-19, 0, 27] },
    { name: 'CT Spawn', cn: '警家 · CT 出生点', pos: [4, 0, -31] },
    { name: 'A Site', cn: 'A 包点 · 露天广场', pos: [-19, 0, -25] },
    { name: 'B Site', cn: 'B 包点 · 车站货仓', pos: [25, 0, 15] },
    { name: 'Long Alley', cn: '长巷', pos: [-19, 0, 0] },
    { name: 'Market', cn: '集市中心', pos: [-2, 0, 14] },
    { name: 'Arcade', cn: '拱廊', pos: [13, 0, 12] },
    { name: 'Apartments', cn: '民居', pos: [1, 0, -16] },
    { name: 'Balcony', cn: 'A 阳台', pos: [-6, BAL_Y, -21] },
    { name: 'Mezzanine', cn: 'B 夹层', pos: [31, MEZ_Y, 12] },
    { name: 'Back Street', cn: '后巷', pos: [-14, 0, 36] },
    { name: 'Back Door', cn: 'B 后门', pos: [23, 0, 30] },
    { name: 'CT to B', cn: 'CT→B 通道', pos: [17, 0, -10] },
    { name: 'Fountain', cn: '水池', pos: [-17.5, 0, -24] },
  ],
  sniperLines: [
    { from: [-19, 13], to: [-19, -17], label: '长巷对枪线 · 约 30 m' },
    { from: [-6, -20], to: [-19, -20], label: '阳台压制长巷口 · 约 13 m' },
    { from: [-33, 36], to: [6, 36], label: '后巷对枪线 · 约 39 m' },
    { from: [17, -22], to: [17, 2], label: 'CT→B 通道线 · 约 24 m' },
    { from: [31, 12], to: [19, 12], label: 'B 夹层架仓门 · 约 12 m' },
  ],
};

export default bazaar;








