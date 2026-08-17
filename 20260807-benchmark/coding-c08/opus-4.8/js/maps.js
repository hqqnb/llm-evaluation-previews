// maps.js — map registry: Dust2 + two original bomb maps (Refinery, Canals)
import { buildDust2 } from './dust2.js';

function mk() {
  const walls = [], covers = [], ramps = [], labels = [];
  const W = (x1, z1, x2, z2, h = 6, tex) => {
    const w = Math.abs(x2 - x1), d = Math.abs(z2 - z1);
    walls.push({ x: (x1 + x2) / 2, z: (z1 + z2) / 2, w: w < 2 ? 2 : w, d: d < 2 ? 2 : d, h, tex });
  };
  const C = (x, z, w, d, h, tex = 'wood', y = 0) => covers.push({ x, z, w, d, h, tex, y });
  const L = (name, x, z) => labels.push({ name, x, z });
  return { walls, covers, ramps, labels, W, C, L };
}

// ============ REFINERY — industrial, tight, vertical catwalks ============
export function buildRefinery() {
  const { walls, covers, ramps, labels, W, C, L } = mk();
  // central warehouse divides map into east (A) and west (B) alleys
  W(-8, -40, -8, 8, 7, 'metal');       // west warehouse wall
  W(8, -40, 8, 8, 7, 'metal');         // east warehouse wall
  W(-8, 8, 8, 8, 7, 'metal');          // warehouse north wall (mid choke below via gap)
  W(-8, -20, -20, -20, 6, 'concrete'); // west alley baffle
  W(8, -20, 20, -20, 6, 'concrete');   // east alley baffle
  W(-28, -6, -28, 30, 6, 'concrete');  // B outer
  W(28, -6, 28, 30, 6, 'concrete');    // A outer
  W(-40, 30, -14, 30, 6, 'concrete');  // B site north
  W(14, 30, 40, 30, 6, 'concrete');    // A site north
  W(-12, 40, 12, 40, 6, 'metal');      // CT spawn front (gap sides)
  // A site tanks/crates
  C(30, 24, 3.5, 3.5, 2.2, 'metalcrate'); C(24, 20, 3, 3, 1.5, 'wood'); C(34, 18, 3, 3, 1.5, 'metalcrate');
  C(28, 28, 2.5, 2.5, 1.4, 'wood');
  // B site
  C(-30, 24, 3.5, 3.5, 2.2, 'metalcrate'); C(-24, 20, 3, 3, 1.5, 'wood'); C(-34, 18, 3, 3, 1.5, 'metalcrate');
  C(-28, 28, 2.5, 2.5, 1.4, 'wood');
  // mid catwalk (raised) with ramp
  C(0, 0, 6, 10, 1.6, 'concrete'); ramps.push({ x: 0, z: -8, w: 4, d: 6, y0: 0, y1: 1.6, axis: 'z', asc: true, tex: 'metal' });
  // alley cover
  C(-18, -8, 2.5, 2.5, 1.4, 'wood'); C(18, -8, 2.5, 2.5, 1.4, 'wood');
  C(-14, 34, 2.4, 2.4, 1.4, 'metalcrate'); C(14, 34, 2.4, 2.4, 1.4, 'metalcrate');
  C(0, -30, 3, 3, 1.4, 'wood');
  L('T 出生点', 0, -44); L('CT 出生点', 0, 44); L('A 点 (东罐区)', 28, 22);
  L('B 点 (西罐区)', -28, 22); L('中央仓库', 0, -6); L('A 通道', 18, -14); L('B 通道', -18, -14);
  return {
    name: 'refinery', displayName: '炼油厂 Refinery', wallTex: 'concrete', groundTex: 'concrete',
    bounds: { minX: -44, maxX: 44, minZ: -50, maxZ: 50 },
    walls, covers, ramps, labels,
    bombsites: { A: { x: 28, z: 22, r: 6 }, B: { x: -28, z: 22, r: 6 } },
    spawns: {
      T: [ {x:0,z:-45}, {x:-6,z:-45}, {x:6,z:-45}, {x:-12,z:-42}, {x:12,z:-42} ],
      CT: [ {x:0,z:45}, {x:-6,z:45}, {x:6,z:45}, {x:-14,z:42}, {x:14,z:42} ],
    },
    nav: {
      nodes: [
        {x:0,z:-44,tags:['tspawn']},{x:-16,z:-38,tags:['tspawn']},{x:16,z:-38,tags:['tspawn']},
        {x:18,z:-24,tags:['aconn']},{x:24,z:-2,tags:['aconn']},{x:28,z:16,tags:['asite','plantA']},
        {x:32,z:24,tags:['asite','plantA']},{x:-18,z:-24,tags:['bconn']},{x:-24,z:-2,tags:['bconn']},
        {x:-28,z:16,tags:['bsite','plantB']},{x:-32,z:24,tags:['bsite','plantB']},
        {x:0,z:-14,tags:['mid']},{x:0,z:6,tags:['mid']},{x:0,z:26,tags:['mid','ctmid']},
        {x:0,z:42,tags:['ctspawn']},{x:20,z:34,tags:['asite','ctspawn']},{x:-20,z:34,tags:['bsite','ctspawn']},
      ],
      edges: [[0,1],[0,2],[0,11],[2,3],[3,4],[4,5],[5,6],[1,7],[7,8],[8,9],[9,10],
        [11,12],[12,13],[13,14],[14,15],[14,16],[15,6],[16,10],[13,4],[13,8]],
    },
  };
}

// ============ CANALS — open, central bridge, long sniper sightlines ============
export function buildCanals() {
  const { walls, covers, ramps, labels, W, C, L } = mk();
  // canal trench walls (visual + block) running east-west at center
  W(-50, 6, -20, 6, 3, 'brick'); W(20, 6, 50, 6, 3, 'brick');
  W(-50, -6, -20, -6, 3, 'brick'); W(20, -6, 50, -6, 3, 'brick');
  // central bridge (raised) crossing the canal N-S
  C(0, 0, 10, 16, 1.4, 'concrete');
  ramps.push({ x: 0, z: -12, w: 8, d: 6, y0: 0, y1: 1.4, axis: 'z', asc: true, tex: 'concrete' });
  ramps.push({ x: 0, z: 12, w: 8, d: 6, y0: 0, y1: 1.4, axis: 'z', asc: false, tex: 'concrete' });
  // A plaza (north-east)
  W(20, 20, 20, 46, 6, 'brick'); W(20, 46, 46, 46, 6, 'brick');
  C(32, 30, 3, 3, 1.6, 'wood'); C(38, 34, 3, 3, 1.6, 'metalcrate'); C(28, 36, 2.5, 2.5, 1.4, 'wood');
  // B yard (south-west)
  W(-20, -20, -20, -46, 6, 'brick'); W(-20, -46, -46, -46, 6, 'brick');
  C(-32, -30, 3, 3, 1.6, 'wood'); C(-38, -34, 3, 3, 1.6, 'metalcrate'); C(-28, -36, 2.5, 2.5, 1.4, 'wood');
  // flank cover
  C(-14, 24, 2.5, 2.5, 1.4, 'wood'); C(14, -24, 2.5, 2.5, 1.4, 'wood');
  C(40, 0, 3, 6, 2.2, 'tarp:#7a2a2a'); C(-40, 0, 3, 6, 2.2, 'tarp:#2a5aa0');
  L('T 出生点', -38, 38); L('CT 出生点', 38, -38); L('A 广场', 34, 32); L('B 货场', -34, -32);
  L('中央大桥', 0, 0); L('狙击对枪线', 0, 20); L('东侧翼', 40, 4); L('西侧翼', -40, -4);
  return {
    name: 'canals', displayName: '运河 Canals', wallTex: 'brick', groundTex: 'concrete',
    bounds: { minX: -50, maxX: 50, minZ: -52, maxZ: 52 },
    walls, covers, ramps, labels,
    bombsites: { A: { x: 34, z: 32, r: 6 }, B: { x: -34, z: -32, r: 6 } },
    spawns: {
      T: [ {x:-38,z:40}, {x:-42,z:36}, {x:-34,z:42}, {x:-44,z:42}, {x:-38,z:34} ],
      CT: [ {x:38,z:-40}, {x:42,z:-36}, {x:34,z:-42}, {x:44,z:-42}, {x:38,z:-34} ],
    },
    nav: {
      nodes: [
        {x:-38,z:38,tags:['tspawn']},{x:-24,z:24,tags:['tspawn']},{x:-40,z:10,tags:['bconn']},
        {x:0,z:20,tags:['mid','bridge']},{x:0,z:0,tags:['mid','bridge']},{x:0,z:-20,tags:['mid','bridge']},
        {x:24,z:24,tags:['aconn']},{x:34,z:32,tags:['asite','plantA']},{x:40,z:26,tags:['asite','plantA']},
        {x:40,z:6,tags:['aconn']},{x:-40,z:-6,tags:['bconn']},{x:-24,z:-24,tags:['bconn']},
        {x:-34,z:-32,tags:['bsite','plantB']},{x:-40,z:-26,tags:['bsite','plantB']},{x:38,z:-38,tags:['ctspawn']},
        {x:24,z:-24,tags:['ctspawn']},
      ],
      edges: [[0,1],[1,2],[1,3],[3,4],[4,5],[3,6],[6,7],[7,8],[6,9],[2,10],[10,11],[11,12],[12,13],
        [5,15],[15,14],[9,15],[5,11],[9,7],[2,11]],
    },
  };
}

export const MAPS = {
  dust2: { build: buildDust2, name: 'Dust II' },
  refinery: { build: buildRefinery, name: '炼油厂' },
  canals: { build: buildCanals, name: '运河' },
};
export const MAP_ORDER = ['dust2', 'refinery', 'canals'];
