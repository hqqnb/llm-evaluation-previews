// ============================================================================
// maps/refinery.js — 炼油厂 · Refinery
//
// Tactical identity: tight, vertical and fast.  Two storeys of steel connected
// by stairs and a catwalk ring, hard corners everywhere, and a CT pipe corridor
// that rotates A↔B in about seven seconds — the opposite of Dust II's long
// sight lines.  Only the mid corridor offers a real duel lane.
//
//   CT 控制室 (+1.6) ──┬── A 斜坡 ──┐
//        管廊 ─────────┴───────── A 包点 反应炉大厅 (catwalk +3.2)
//          │                        │        ↑
//      B 包点 装卸区            中央通道   排水沟 (−1.2)
//          │                        │        │
//      B 通道 ───────── 泵房 ───────┴────────┘
//                         │
//                    T 出生点
// ============================================================================

import { brushes, N, HOLD, NADE } from './kit.js';
import { MAT, AREA } from '../core/constants.js';

const B = brushes();
const W = MAT.CONCRETE;
const FLOOR = MAT.ASPHALT;
const H = 6.0;
const CT_Y = 1.6;
const CAT_Y = 3.2;
const PLAT_Y = 1.4;
const TRENCH_Y = -1.2;

// --- 1. T 出生点 -------------------------------------------------------------
B.group('T 出生点');
B.room({
  x0: -34, z0: 14, x1: -18, z1: 30, y: 0, h: H, mat: MAT.BRICK, floorMat: FLOOR,
  sides: { e: { gaps: [[18, 26, 0, 4.2]] }, n: { gaps: [[-30, -24, 0, 4.2]] } },
});
B.crateStack(-32, 28, 0, [[1.5, 1.5], [1.2, 1.2]]);
B.barrel(-20, 16.6, 0); B.barrel(-20.8, 17.4, 0);
B.pipe(-34, 20, 4.6, 16, 'x', 0.16);
B.band(-34.3, 13.7, -17.7, 30.3, 4.2, 0.3);
B.lamp(-33.4, 22, 3.2);

// --- 2. 泵房 (the T fork: mid corridor, or the trench flank) -----------------
B.group('泵房');
B.room({
  x0: -18, z0: 12, x1: -2, z1: 30, y: 0, h: 5.0, mat: W, floorMat: MAT.CONCRETE,
  ceiling: true, ceilMat: MAT.METAL,
  sides: {
    w: false,
    n: { gaps: [[-12, -6, 0, 3.6]] },          // → 中央通道
    e: { gaps: [[16, 24, 0, 3.6]] },           // → 排水沟
  },
});
B.cyl(-15, 18, 0, 4.2, 1.1, MAT.METAL_RUST, { seg: 16 });   // pump tanks
B.cyl(-15, 24, 0, 4.2, 1.1, MAT.METAL_RUST, { seg: 16 });
B.crate(-5.4, 14.4, 0, 1.4, 1.4);
B.parapet(-11, 26.4, -6, 27, 0, 1.1, MAT.METAL);
B.pipe(-17.4, 13, 3.9, 16, 'z', 0.14);
B.lamp(-17.4, 20, 3.4); B.lamp(-2.6, 20, 3.4);

// --- 3. B 通道 (west lane, T route to B) -------------------------------------
B.group('B 通道');
B.room({
  x0: -34, z0: -4, x1: -22, z1: 14, y: 0, h: 4.6, mat: W, floorMat: MAT.CONCRETE,
  ceiling: true, ceilMat: MAT.GRATE,
  sides: { s: false, n: false },               // T 出生点 / B 包点 own those
});
B.crate(-24, 10.4, 0, 1.3, 1.3);
B.barrel(-33, 2, 0); B.barrel(-32.2, 2.8, 0);
B.pipe(-33.4, -3, 3.6, 16, 'z', 0.13);
B.lamp(-23, 6, 3.2);

// --- 4. B 包点 · 装卸区 -------------------------------------------------------
B.group('B 包点');
B.room({
  x0: -34, z0: -22, x1: -14, z1: -4, y: 0, h: H, mat: MAT.BRICK, floorMat: FLOOR,
  sides: {
    s: { gaps: [[-30, -24, 0, 4.2]] },          // ← B 通道 (T entry)
    n: { gaps: [[-28, -22, 0, 4.2]] },          // ← 管廊 (CT entry)
    e: { gaps: [[-14, -8, 0, 4.2]] },           // ← 管廊 east arm
  },
});
B.platform(-34, -22, -26, -14, PLAT_Y, MAT.CONCRETE, { base: 0 });   // loading dock
B.ramp(-26, -20, -23.4, -16, PLAT_Y, 0, 'x', MAT.CONCRETE);
B.parapet(-26.6, -22, -26, -17, PLAT_Y, 0.95, MAT.METAL);
B.crateStack(-20, -12, 0, [[2.0, 1.7], [1.5, 1.3]]);                 // container block
B.crate(-17, -18.4, 0, 1.5, 1.5);
B.barrel(-30, -6.6, PLAT_Y); B.barrel(-29.2, -7.4, PLAT_Y);
B.sandbags(-16.4, -8.6, -14.6, -6, 0, 1.0);
B.band(-34.3, -22.3, -13.7, -3.7, 4.4, 0.32);
B.lamp(-33.4, -12, 3.6); B.lamp(-14.6, -14, 3.6);

// --- 5. 管廊 (the CT pipe corridor: the fast A↔B rotation) -------------------
B.group('管廊');
B.room({
  x0: -30, z0: -30, x1: 2, z1: -22, y: 0, h: 4.4, mat: W, floorMat: MAT.CONCRETE,
  ceiling: true, ceilMat: MAT.GRATE,
  sides: {
    s: { gaps: [[-28, -22, 0, 4.2], [-14, -8, 0, 4.2]] },   // → B 包点 / → 中央通道 window arm
    e: false,                                                // CT 控制室 owns it
  },
});
B.pipe(-29, -24, 3.5, 30, 'x', 0.18);
B.pipe(-29, -28, 2.6, 30, 'x', 0.14);
B.crate(-6, -28.4, 0, 1.3, 1.3);
B.barrel(-20, -28.6, 0); B.barrel(-19.2, -27.8, 0);
B.lamp(-24, -22.6, 3.0); B.lamp(-8, -29.4, 3.0);

// --- 6. 中央通道 (mid: the one real duel lane, with a window into 管廊) ------
B.group('中央通道');
B.room({
  x0: -14, z0: -22, x1: -2, z1: 12, y: 0, h: 5.0, mat: W, floorMat: MAT.CONCRETE,
  ceiling: true, ceilMat: MAT.METAL,
  sides: {
    s: false,                                    // 泵房 owns it
    n: false,                                    // 管廊 owns it
    e: { gaps: [[-16, -6, 0, 4.0]] },            // → A 包点
  },
});
B.crate(-12.4, 6, 0, 1.4, 1.4);
B.parapet(-13.6, -4, -8, -3.4, 0, 1.15, MAT.METAL);          // waist-high cover
B.crate(-3.6, -14, 0, 1.4, 1.4);
B.pipe(-13.4, -21, 4.0, 32, 'z', 0.15);
B.lamp(-13.4, -8, 3.6); B.lamp(-2.6, 2, 3.6);

// --- 7. 排水沟 (sunken trench: the T flank into A from the south) -----------
B.group('排水沟');
B.room({
  x0: -2, z0: 14, x1: 14, z1: 26, y: TRENCH_Y, h: 5.2, mat: W, floorMat: MAT.CONCRETE,
  sides: { w: { gaps: [[16, 24, TRENCH_Y, TRENCH_Y + 3.6]] }, n: false },
});
B.ramp(8, 8, 13, 14, 0, TRENCH_Y, 'z', MAT.CONCRETE);        // climbs north into A
B.wallX(14, -2.25, 8, TRENCH_Y, TRENCH_Y + 5.2, W);          // north wall except the ramp
B.wallZ(8, 8, 14, 0, 5.2, W);                                 // ramp side wall
B.floor(8, 8, 14, 8.4, 0, MAT.CONCRETE);
B.crate(1, 24, TRENCH_Y, 1.3, 1.3);
B.barrel(12, 24.6, TRENCH_Y); B.barrel(11.2, 23.8, TRENCH_Y);
B.pipe(-1.4, 15, TRENCH_Y + 3.4, 14, 'x', 0.13);
B.lamp(0, 25.4, TRENCH_Y + 2.8);

// --- 8. A 包点 · 反应炉大厅 (two storeys, catwalk ring at +3.2) --------------
B.group('A 包点');
B.room({
  x0: -2, z0: -16, x1: 24, z1: 8, y: 0, h: 8.4, mat: MAT.BRICK, floorMat: MAT.CONCRETE,
  ceiling: true, ceilMat: MAT.METAL, ceilThick: 0.5,
  sides: {
    w: { gaps: [[-16, -6, 0, 4.0]] },            // ← 中央通道
    n: { gaps: [[6, 16, 0, 4.2]] },              // ← A 斜坡 (CT)
    s: { gaps: [[8, 14, 0, 4.2]] },              // ← 排水沟 ramp
  },
});
// central reactor block: the default plant sits against it
B.box(8, -8, 16, 0, 0, 2.6, MAT.METAL_RUST, { uv: 1.6 });
B.cyl(12, -4, 2.6, 6.6, 2.2, MAT.METAL, { seg: 18 });
B.pipe(8, -6, 3.4, 8, 'x', 0.22); B.pipe(8, -2, 3.4, 8, 'x', 0.22);
// catwalk ring on the north and east walls, reached by two stairways
B.platform(-2, -16, 24, -13.4, CAT_Y, MAT.GRATE, { base: CAT_Y - 0.3, lip: false });
B.platform(21.4, -13.4, 24, 8, CAT_Y, MAT.GRATE, { base: CAT_Y - 0.3, lip: false });
B.parapet(2.6, -13.9, 21.4, -13.4, CAT_Y, 1.05, MAT.METAL);
B.parapet(21.4, -13.4, 21.9, 8, CAT_Y, 1.05, MAT.METAL);
B.stairs(-1.6, 4, 2.4, 7.6, 0, CAT_Y, 'x', 9, MAT.GRATE);
B.wallZ(2.6, 4, 8, 0, CAT_Y + 0.4, MAT.METAL, { thick: 0.3 });
B.platform(-2, -13.4, 2.6, 4, CAT_Y, MAT.GRATE, { base: CAT_Y - 0.3, lip: false });
B.parapet(2.1, -13.4, 2.6, 1.6, CAT_Y, 1.05, MAT.METAL);
B.parapet(-2, 3.4, -0.2, 4, CAT_Y, 1.05, MAT.METAL);
B.stairs(18, 5.6, 21.6, 7.6, 0, CAT_Y, 'x', 9, MAT.GRATE);
// ground cover
B.crateStack(4, -12, 0, [[1.6, 1.6], [1.3, 1.2]]);
B.crate(18.6, -4, 0, 1.6, 1.6);
B.crate(20, -10.4, 0, 1.5, 1.5);
B.barrel(5.4, 4, 0); B.barrel(6.2, 4.8, 0); B.barrel(4.8, 5, 0);
B.sandbags(15, 5, 18.4, 7.4, 0, 1.0);
B.band(-2.3, -16.3, 24.3, 8.3, 5.4, 0.34);
B.lamp(-1.4, -6, 5.2); B.lamp(23.4, -6, 5.2); B.lamp(12, 7.4, 5.2);

// --- 9. A 斜坡 + CT 控制室 ---------------------------------------------------
B.group('A 斜坡');
B.ramp(6, -22, 16, -16, CT_Y, 0, 'z', MAT.CONCRETE);
B.wallZ(6, -22, -16, 0, CT_Y + 4.4, W);
B.wallZ(16, -22, -16, 0, CT_Y + 4.4, W);

B.group('CT 出生点');
B.room({
  x0: 2, z0: -34, x1: 22, z1: -22, y: CT_Y, h: 5.4, mat: W, floorMat: MAT.TILE,
  sides: {
    s: { gaps: [[6, 16, CT_Y, CT_Y + 4.2]] },     // → A 斜坡
    w: { gaps: [[-30, -24, CT_Y, CT_Y + 3.8]] },  // → 管廊 (via the step ramp below)
  },
});
B.ramp(-1, -30, 2, -24, 0, CT_Y, 'x', MAT.CONCRETE);          // 管廊 → control room
B.crate(20, -32.4, CT_Y, 1.4, 1.4);
B.crate(5, -24.4, CT_Y, 1.4, 1.4);
B.parapet(2.4, -33.6, 3, -28, CT_Y, 1.0, MAT.METAL);
B.detail(8, -33.4, 16, -32.6, CT_Y + 0.9, CT_Y + 2.1, MAT.GLASS, { uv: 1.2 });
B.lamp(3, -28, CT_Y + 3.4); B.lamp(21, -28, CT_Y + 3.4);

// --- 10. 厂区天际线 (decorative, outside every wall) -------------------------
B.group('skyline');
let seed = 771103;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
for (const r of [
  { x0: -70, x1: -40, z0: -48, z1: 46 }, { x0: 30, x1: 62, z0: -48, z1: 46 },
  { x0: -70, x1: 62, z0: -64, z1: -40 }, { x0: -70, x1: 62, z0: 36, z1: 58 },
]) {
  for (let i = 0; i < 16; i++) {
    const w = 6 + rnd() * 10, d = 6 + rnd() * 10;
    const x = r.x0 + rnd() * (r.x1 - r.x0 - w), z = r.z0 + rnd() * (r.z1 - r.z0 - d);
    const h = 5 + rnd() * 12;
    B.detail(x, z, x + w, z + d, 0, h, rnd() < 0.5 ? MAT.METAL_RUST : MAT.CONCRETE, { uv: 3 });
    if (rnd() < 0.5) {
      B.detail(x + w * 0.35, z + d * 0.35, x + w * 0.35 + 2.4, z + d * 0.35 + 2.4, h, h + 6 + rnd() * 8, MAT.METAL, { uv: 2 });
    }
  }
}
// distillation towers on the horizon
for (const [tx, tz] of [[-52, 10], [44, -18], [-16, -52], [10, 46]]) {
  B.detail(tx - 2.6, tz - 2.6, tx + 2.6, tz + 2.6, 0, 26, MAT.METAL_RUST, { uv: 3 });
  B.detail(tx - 3.4, tz - 3.4, tx + 3.4, tz + 3.4, 26, 27.4, MAT.METAL, { uv: 2 });
}

// --- 11. Navigation ----------------------------------------------------------
const NODES = [
  N('t_spawn', -26, 0, 22, AREA.T_SPAWN), N('t_spawn_n', -27, 0, 16, AREA.T_SPAWN, ['door']),
  N('t_east', -19, 0, 23, AREA.T_SPAWN, ['door']),
  N('pump_s', -14, 0, 26, AREA.CONNECT), N('pump_c', -9, 0, 20, AREA.CONNECT, ['cover']),
  N('pump_n', -9, 0, 14, AREA.CONNECT, ['door']), N('pump_e', -3, 0, 20, AREA.CONNECT, ['door']),
  N('blane_s', -28, 0, 12, AREA.TUNNEL), N('blane_m', -28, 0, 5, AREA.TUNNEL),
  N('blane_n', -28, 0, -2, AREA.TUNNEL, ['entry']),
  N('b_tun_in', -27, 0, -6, AREA.B_SITE, ['entry']), N('b_center', -22, 0, -12, AREA.B_SITE, ['plant']),
  N('b_dock_ramp', -24.6, 0.7, -18, AREA.B_SITE), N('b_dock', -30, 1.4, -18, AREA.B_SITE, ['hold', 'plant']),
  N('b_dock_n', -31, 1.4, -16, AREA.B_SITE, ['hold']),
  N('b_box', -18, 0, -9, AREA.B_SITE, ['cover']), N('b_east', -15.4, 0, -20.4, AREA.B_SITE, ['cover']),
  N('b_door_n', -24.6, 0, -21, AREA.B_SITE, ['door']), N('b_east_gate', -15, 0, -11, AREA.B_SITE, ['door']),
  N('pipe_w', -25, 0, -26, AREA.CONNECT, ['hold']), N('pipe_m', -16, 0, -26, AREA.CONNECT),
  N('pipe_e', -6, 0, -26, AREA.CONNECT), N('pipe_ramp', 0.5, 0.8, -27, AREA.CONNECT),
  N('mid_s', -8, 0, 8, AREA.MID), N('mid_c', -8, 0, -2, AREA.MID, ['cover']),
  N('mid_n', -8, 0, -12, AREA.MID, ['sniper']), N('mid_e', -3, 0, -11, AREA.MID, ['door']),
  N('trench_w', 0, -1.2, 20, AREA.SHORT, ['entry']), N('trench_e', 11, -1.2, 20, AREA.SHORT),
  N('trench_ramp', 10.5, -0.6, 12, AREA.SHORT), N('a_south', 11, 0, 6, AREA.A_SITE, ['entry']),
  N('a_west', 0, 0, -11, AREA.A_SITE, ['entry']), N('a_center', 12, 0, -11.6, AREA.A_SITE, ['plant']),
  N('a_reactor_e', 19.4, 0, -7, AREA.A_SITE, ['plant', 'cover']), N('a_reactor_s', 12, 0, 3, AREA.A_SITE, ['cover']),
  N('a_crates', 6, 0, -13, AREA.A_SITE, ['cover']), N('a_ne', 20.4, 0, -13.4, AREA.A_SITE, ['cover']),
  N('a_stair_w', 0.85, 2.13, 5.8, AREA.A_SITE), N('cat_w', 0.3, CAT_Y, -4, AREA.A_SITE, ['hold', 'sniper']),
  N('cat_n', 10, CAT_Y, -14.6, AREA.A_SITE, ['hold', 'sniper']), N('cat_cw', 0.6, CAT_Y, -14.6, AREA.A_SITE), N('cat_ce', 22.7, CAT_Y, -14.6, AREA.A_SITE), N('cat_e', 22.7, CAT_Y, -6, AREA.A_SITE, ['hold']),
  N('a_stair_e', 19.8, 2.13, 6.6, AREA.A_SITE),
  N('a_ramp_bot', 11, 0.2, -16.6, AREA.A_SITE, ['hold']), N('a_ramp_top', 11, CT_Y, -21, AREA.CT_SPAWN),
  N('ct_a', 11, CT_Y, -25, AREA.CT_SPAWN), N('ct_c', 16, CT_Y, -29, AREA.CT_SPAWN),
  N('ct_w', 4, CT_Y, -27, AREA.CT_SPAWN, ['door']),
];

const LINKS = [
  ['t_spawn', 't_east'], ['t_east', 'pump_s'], ['pump_s', 'pump_c'], ['pump_c', 'pump_n'],
  ['pump_c', 'pump_e'], ['t_spawn', 't_spawn_n'], ['t_spawn_n', 'blane_s'],
  ['blane_s', 'blane_m'], ['blane_m', 'blane_n'], ['blane_n', 'b_tun_in'], ['b_tun_in', 'b_center'],
  ['b_center', 'b_dock_ramp'], ['b_dock_ramp', 'b_dock'], ['b_dock', 'b_dock_n'],
  ['b_center', 'b_box'], ['b_center', 'b_east'], ['b_east', 'b_east_gate'], ['b_east_gate', 'mid_n'],
  ['b_east', 'b_door_n'], ['b_door_n', 'b_center'], ['b_door_n', 'pipe_w'], ['pipe_w', 'pipe_m'], ['pipe_m', 'pipe_e'],
  ['pipe_e', 'pipe_ramp'], ['pipe_ramp', 'ct_w'], ['pump_n', 'mid_s'], ['mid_s', 'mid_c'],
  ['mid_c', 'mid_n'], ['mid_c', 'mid_e'], ['mid_e', 'a_west'], ['a_west', 'a_center'],
  ['pump_e', 'trench_w'], ['trench_w', 'trench_e'], ['trench_e', 'trench_ramp'],
  ['trench_ramp', 'a_south'], ['a_south', 'a_reactor_s'], ['a_reactor_s', 'a_center'],
  ['a_center', 'a_crates'], ['a_center', 'a_reactor_e'], ['a_reactor_e', 'a_ne'],
  ['a_reactor_s', 'a_stair_w'], ['a_stair_w', 'cat_w'], ['cat_w', 'cat_cw'], ['cat_cw', 'cat_n'], ['cat_n', 'cat_ce'], ['cat_ce', 'cat_e'],
  ['a_reactor_e', 'a_stair_e'], ['a_stair_e', 'cat_e'],
  ['a_center', 'a_ramp_bot'], ['a_ramp_bot', 'a_ramp_top'], ['a_ramp_top', 'ct_a'],
  ['ct_a', 'ct_c'], ['ct_c', 'ct_w'],
];

const TACTICS = {
  CT: {
    holds: {
      A: [
        HOLD(10, CAT_Y, -14.6, 0, -8, AREA.A_SITE, { name: '上层走道架点', prio: 3 }),
        HOLD(0.3, CAT_Y, -4, 12, -8, AREA.A_SITE, { name: '西侧走道', prio: 2 }),
        HOLD(19.4, 0, -7, 0, -11, AREA.A_SITE, { name: '反应炉后角', prio: 3, crouch: true }),
        HOLD(20.4, 0, -13.4, 0, -11, AREA.A_SITE, { name: '东北箱后', prio: 2, crouch: true }),
        HOLD(11, 0.2, -16.6, 12, -4, AREA.A_SITE, { name: '斜坡回防位', prio: 1 }),
      ],
      B: [
        HOLD(-30, PLAT_Y, -18, -26, -6, AREA.B_SITE, { name: '装卸台架点', prio: 3 }),
        HOLD(-31, PLAT_Y, -16, -26, -4, AREA.B_SITE, { name: '平台北角', prio: 2 }),
        HOLD(-18, 0, -9, -27, -6, AREA.B_SITE, { name: '集装箱后', prio: 3, crouch: true }),
        HOLD(-15.4, 0, -20.4, -26, -8, AREA.B_SITE, { name: '东侧交叉火力', prio: 2 }),
        HOLD(-24.6, 0, -21, -27, -8, AREA.B_SITE, { name: '管廊门口', prio: 1 }),
      ],
      MID: [
        HOLD(-8, 0, -12, -8, 8, AREA.MID, { name: '中央通道架点', prio: 3 }),
        HOLD(-8, 0, -2, -8, 12, AREA.MID, { name: '通道掩体', prio: 2, crouch: true }),
      ],
    },
    rotate: {
      A_to_B: ['a_ramp_bot', 'a_ramp_top', 'ct_a', 'ct_w', 'pipe_ramp', 'pipe_e', 'pipe_m', 'pipe_w', 'b_door_n', 'b_east'],
      B_to_A: ['b_east', 'b_door_n', 'pipe_w', 'pipe_m', 'pipe_e', 'pipe_ramp', 'ct_w', 'ct_a', 'a_ramp_top', 'a_ramp_bot'],
      MID_to_A: ['mid_n', 'mid_e', 'a_west', 'a_center'],
      MID_to_B: ['mid_n', 'b_east_gate', 'b_east', 'b_center'],
      A_to_MID: ['a_west', 'mid_e', 'mid_c', 'mid_n'],
      B_to_MID: ['b_east', 'b_east_gate', 'mid_n', 'mid_c'],
    },
    defuseFrom: { A: ['a_ramp_bot', 'a_west'], B: ['b_door_n', 'b_east'] },
  },
  T: {
    routes: {
      mid: ['t_spawn', 't_east', 'pump_s', 'pump_c', 'pump_n', 'mid_s', 'mid_c', 'mid_e', 'a_west', 'a_center'],
      trench: ['t_spawn', 't_east', 'pump_s', 'pump_c', 'pump_e', 'trench_w', 'trench_e', 'trench_ramp', 'a_south', 'a_center'],
      blane: ['t_spawn', 't_spawn_n', 'blane_s', 'blane_m', 'blane_n', 'b_tun_in', 'b_center'],
      midb: ['pump_n', 'mid_s', 'mid_c', 'mid_n', 'b_east_gate', 'b_east', 'b_center'],
    },
    stacks: { mid: 'mid_s', trench: 'trench_w', blane: 'blane_m', midb: 'mid_c' },
    postPlant: {
      A: [HOLD(6, 0, -13, 12, -8, AREA.A_SITE), HOLD(19.4, 0, -7, 12, -11, AREA.A_SITE),
        HOLD(10, CAT_Y, -14.6, 12, -6, AREA.A_SITE), HOLD(12, 0, 3, 12, -14, AREA.A_SITE),
        HOLD(20.4, 0, -13.4, 6, -8, AREA.A_SITE)],
      B: [HOLD(-18, 0, -9, -26, -18, AREA.B_SITE), HOLD(-30, PLAT_Y, -18, -20, -12, AREA.B_SITE),
        HOLD(-15.4, 0, -20.4, -24, -12, AREA.B_SITE), HOLD(-27, 0, -6, -22, -16, AREA.B_SITE),
        HOLD(-31, PLAT_Y, -16, -20, -14, AREA.B_SITE)],
    },
    strats: [
      { name: 'mid_a', cn: '中路强攻 A', site: 'A', lanes: { mid: 0.6, trench: 0.4 }, weight: 1.2 },
      { name: 'split_a', cn: '沟渠夹击 A', site: 'A', lanes: { trench: 0.55, mid: 0.45 }, weight: 1.1 },
      { name: 'rush_b', cn: 'B 通道快攻', site: 'B', lanes: { blane: 0.85, mid: 0.15 }, weight: 1.0 },
      { name: 'mid_to_b', cn: '控中转 B', site: 'B', lanes: { midb: 0.6, blane: 0.4 }, weight: 0.9 },
      { name: 'default', cn: '默认分推', site: 'A', lanes: { mid: 0.4, trench: 0.3, blane: 0.3 }, weight: 1.0 },
      { name: 'eco_stack', cn: '经济局堆点', site: 'B', lanes: { blane: 1 }, weight: 0.6, eco: true },
    ],
  },
  nades: [
    NADE('T', 'smoke', [-8, 1.6, 0], [11, 0.4, -8], AREA.A_SITE, 'exec', { name: '中路烟封反应炉' }),
    NADE('T', 'flash', [-3, 1.6, -11], [8, 2.6, -10], AREA.A_SITE, 'exec', { name: '进 A 闪' }),
    NADE('T', 'molotov', [-8, 1.6, -6], [10, 0, -14], AREA.A_SITE, 'exec', { name: '烧上层楼梯口' }),
    NADE('T', 'flash', [11, 0.4, 8], [12, 2.6, -4], AREA.A_SITE, 'exec', { name: '沟渠上闪' }),
    NADE('T', 'smoke', [-28, 1.6, 2], [-27, 0.4, -14], AREA.B_SITE, 'exec', { name: '通道烟封装卸台' }),
    NADE('T', 'flash', [-27, 1.6, -4], [-24, 2.6, -14], AREA.B_SITE, 'exec', { name: '进 B 闪' }),
    NADE('T', 'molotov', [-27, 1.6, -4], [-30, 1.4, -18], AREA.B_SITE, 'exec', { name: '烧装卸台' }),
    NADE('T', 'smoke', [-8, 1.6, -6], [-8, 0.4, -20], AREA.MID, 'exec', { name: '封管廊路口' }),
    NADE('CT', 'flash', [11, 1.2, -20], [11, 2.6, -8], AREA.A_SITE, 'retake', { name: 'A 斜坡闪' }),
    NADE('CT', 'molotov', [11, 1.2, -19], [12, 0, -11], AREA.A_SITE, 'retake', { name: '烧 A 下包点' }),
    NADE('CT', 'smoke', [0, 1.6, -11], [12, 0.4, -11], AREA.A_SITE, 'retake', { name: '封 A 中心' }),
    NADE('CT', 'flash', [-25, 1.6, -24], [-24, 2.6, -12], AREA.B_SITE, 'retake', { name: 'B 管廊闪' }),
    NADE('CT', 'molotov', [-25, 1.6, -22], [-22, 0, -12], AREA.B_SITE, 'retake', { name: '烧 B 下包点' }),
    NADE('CT', 'smoke', [-8, 1.6, -14], [-8, 0.4, 2], AREA.MID, 'hold', { name: '中路封烟' }),
  ],
};

export const refinery = {
  id: 'refinery',
  name: 'Refinery',
  cn: '炼油厂',
  desc: '双层钢铁厂区。转角密集、垂直落差大、CT 管廊换点只要七秒，是一张考验近距离反应和上层控制的快节奏图。',
  tags: ['爆破模式', '近距离', '双层立体'],
  brushes: B.list,
  env: {
    sunDir: [-0.35, -0.86, -0.36],
    sunColor: 0xdfe6f2,
    sunIntensity: 1.9,
    skyTop: 0x2c3a4a,
    skyBottom: 0x6d7482,
    fog: { color: 0x5c6470, near: 30, far: 130 },
    ambient: 1.6,
    hemiSky: 0x8fa2b8,
    hemiGround: 0x33363a,
    exposure: 1.0,
    ambience: 'ambient_room',
  },
  spawns: {
    T: [
      { pos: [-30, 0, 18], yaw: 0.1 }, { pos: [-30, 0, 22], yaw: 0.0 },
      { pos: [-30, 0, 26], yaw: -0.1 }, { pos: [-26, 0, 19], yaw: 0.05 },
      { pos: [-26, 0, 24], yaw: 0.0 }, { pos: [-22, 0, 21], yaw: 0.0 },
      { pos: [-22, 0, 26], yaw: -0.08 },
    ],
    CT: [
      { pos: [12, CT_Y, -30], yaw: 1.57 }, { pos: [16, CT_Y, -30], yaw: 1.57 },
      { pos: [8, CT_Y, -30], yaw: 1.5 }, { pos: [12, CT_Y, -26], yaw: 1.57 },
      { pos: [16, CT_Y, -26], yaw: 1.62 }, { pos: [19, CT_Y, -29], yaw: 1.45 },
      { pos: [6, CT_Y, -32], yaw: 1.62 },
    ],
  },
  sites: {
    A: {
      center: [12, 0, -11.6],
      area: { x0: 0, z0: -15, x1: 23, z1: 6, y0: -1, y1: 3 },
      plantSpots: [[12, 0, -11.6], [19.4, 0, -7], [12, 0, 3], [6, 0, -13]],
      label: 'A 包点 · 反应炉大厅',
    },
    B: {
      center: [-22, 0, -12],
      area: { x0: -33, z0: -21, x1: -15, z1: -5, y0: -1, y1: 3 },
      plantSpots: [[-22, 0, -12], [-30, 1.4, -18], [-18, 0, -9], [-27, 0, -6]],
      label: 'B 包点 · 装卸区',
    },
  },
  buyzones: {
    T: { x0: -34, z0: 14, x1: -18, z1: 30 },
    CT: { x0: 2, z0: -34, x1: 22, z1: -21 },
  },
  radar: { min: [-38, -36], max: [26, 32] },
  nav: { nodes: NODES, links: LINKS, autoLink: { maxDist: 14 } },
  tactics: TACTICS,
  areaBoxes: [
    { area: AREA.A_SITE, x0: -2, z0: -16, x1: 24, z1: 8 },
    { area: AREA.B_SITE, x0: -34, z0: -22, x1: -14, z1: -4 },
    { area: AREA.MID, x0: -14, z0: -22, x1: -2, z1: 12 },
    { area: AREA.SHORT, x0: -2, z0: 8, x1: 14, z1: 26 },
    { area: AREA.TUNNEL, x0: -34, z0: -4, x1: -22, z1: 14 },
    { area: AREA.T_SPAWN, x0: -34, z0: 12, x1: -2, z1: 30 },
    { area: AREA.CT_SPAWN, x0: 2, z0: -34, x1: 22, z1: -16 },
    { area: AREA.CONNECT, x0: -30, z0: -30, x1: 2, z1: -22 },
  ],
  callouts: [
    { name: 'T Spawn', cn: 'T 出生点', pos: [-26, 0, 22] },
    { name: 'Pump Room', cn: '泵房', pos: [-10, 0, 21] },
    { name: 'CT Spawn', cn: '控制室 · CT 出生点', pos: [12, CT_Y, -28] },
    { name: 'A Site', cn: 'A 包点 · 反应炉大厅', pos: [12, 0, -8] },
    { name: 'B Site', cn: 'B 包点 · 装卸区', pos: [-22, 0, -12] },
    { name: 'Mid', cn: '中央通道', pos: [-8, 0, -4] },
    { name: 'Pipe Corridor', cn: '管廊', pos: [-16, 0, -26] },
    { name: 'Trench', cn: '排水沟', pos: [6, TRENCH_Y, 20] },
    { name: 'B Lane', cn: 'B 通道', pos: [-28, 0, 5] },
    { name: 'Catwalk', cn: '上层走道', pos: [10, CAT_Y, -14] },
    { name: 'Loading Dock', cn: '装卸台', pos: [-30, PLAT_Y, -18] },
    { name: 'Reactor', cn: '反应炉', pos: [12, 0, -4] },
    { name: 'A Ramp', cn: 'A 斜坡', pos: [11, 0.8, -19] },
  ],
  sniperLines: [
    { from: [-8, 8], to: [-8, -20], label: '中央通道对枪线 · 约 28 m' },
    { from: [3, -14.6], to: [20, -14.6], label: '上层走道压制线 · 约 17 m' },
    { from: [-25, -26], to: [-1, -26], label: '管廊回防线 · 约 24 m' },
    { from: [-28, 12], to: [-27, -6], label: 'B 通道进点线 · 约 18 m' },
  ],
};

export default refinery;







