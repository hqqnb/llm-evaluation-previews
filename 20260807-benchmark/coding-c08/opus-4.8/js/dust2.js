// dust2.js — Dust2-inspired competitive layout.
// Frame: +Z = north (CT side), -Z = south (T side), +X = east (A side), -X = west (B side).
// Callouts preserved: T/CT spawn, A/B site, mid, mid doors, long (A大), long/double doors,
// A short/catwalk, A pit, Xbox, B tunnels (B洞), B doors, B platform, CT house (警家), ramps.
export function buildDust2() {
  const walls = [], covers = [], ramps = [], labels = [];
  function W(x1, z1, x2, z2, h = 6, tex = 'sand') {
    const w = Math.abs(x2 - x1), d = Math.abs(z2 - z1);
    walls.push({ x: (x1 + x2) / 2, z: (z1 + z2) / 2, w: w < 2 ? 2 : w, d: d < 2 ? 2 : d, h, tex });
  }
  function C(x, z, w, d, h, tex = 'wood', y = 0) { covers.push({ x, z, w, d, h, tex, y }); }
  function L(name, x, z) { labels.push({ name, x, z }); }

  // ---- MID divider walls ----
  W(-16, -46, -16, 24);          // west divider (mid | B side)
  W(16, -46, 16, 4);             // east divider lower (mid | long)
  W(17, 24, 17, 46);             // A west wall (mid-up | A)
  W(-16, -6, -4, -6);            // mid doors (left leaf)
  W(4, -6, 16, -6);              // mid doors (right leaf)

  // ---- LONG (A大) ----
  W(16, -38, 30, -38);           // double doors (left)
  W(40, -38, 52, -38);           // double doors (right) -> gap x[30,40] = 长门/双门
  W(46, -38, 46, 20);            // long east inner wall (lane definition)

  // ---- A SITE north / CT connection ----
  W(18, 46, 24, 46);             // A north wall left  (gap x[24,33] = A ramp to CT)
  W(33, 46, 52, 46);             // A north wall right

  // ---- B SIDE ----
  W(-52, 24, -40, 24);           // B south wall left
  W(-30, 24, -16, 24);           // B south wall right -> gap x[-40,-30] = tunnel mouth
  W(-40, -46, -40, -14);         // tunnel outer wall
  W(-24, -30, -24, 6);           // tunnel inner wall (creates the B洞 corridor)

  // ---- CT SPAWN (警家) ----
  W(-16, 48, -6, 48);            // CT south wall (gap x[-6,8] to mid/ct-mid)
  W(8, 48, 20, 48);
  W(-16, 48, -16, 64);           // CT west wall

  // ---- COVERS / crates ----
  C(9, 1, 2.6, 2.6, 1.7, 'metalcrate');      // Xbox
  C(-6, -30, 2.2, 2.2, 1.4, 'wood');         // mid T-side box
  C(34, -2, 3, 3, 1.6, 'metalcrate');        // A pit crate
  C(41, -8, 2.6, 2.6, 1.4, 'wood');
  C(44, -22, 3, 6, 2.4, 'tarp:#2a5aa0');     // long blue container
  C(30, 32, 3, 3, 1.5, 'wood');              // A default plant crates
  C(34, 30, 2.6, 2.6, 1.5, 'metalcrate');
  C(28, 37, 3, 2.2, 1.4, 'wood');
  C(22, 30, 2.5, 2.5, 1.4, 'wood');          // A goose
  C(-34, 32, 3, 3, 1.5, 'wood');             // B site crates
  C(-30, 37, 2.6, 2.6, 1.4, 'metalcrate');
  C(-38, 28, 2.5, 2.5, 1.4, 'wood');
  C(-20, 30, 2.2, 2.2, 1.4, 'wood');         // B doors cover
  C(10, 54, 2.2, 2.2, 1.4, 'wood');          // CT spawn crate
  C(16, 9, 2.2, 2.2, 1.4, 'metalcrate');     // short cover
  C(-30, -34, 2.6, 2.6, 1.4, 'wood');        // tunnel cover
  C(-38, -4, 2.6, 2.6, 1.4, 'metalcrate');
  // B platform (raised) + its ramp
  C(-44, 40, 10, 9, 1.2, 'concrete');
  C(-44, 40, 2, 2, 1.2, 'wood', 1.2);
  ramps.push({ x: -35, z: 35, w: 5, d: 6, y0: 0, y1: 1.2, axis: 'x', asc: false, tex: 'concrete' });
  // Catwalk (raised short) + ramp up from mid
  C(12, 20, 6, 8, 1.5, 'concrete');
  ramps.push({ x: 12, z: 13, w: 5, d: 6, y0: 0, y1: 1.5, axis: 'z', asc: true, tex: 'concrete' });

  L('T 出生点', 0, -58); L('CT 出生点 / 警家', 2, 58);
  L('A 包点', 32, 32); L('B 包点', -34, 34);
  L('中路', 0, -20); L('中门', 0, -6); L('A 大 / 长通', 34, -20);
  L('长门 / 双门', 35, -38); L('A 小 / 楼梯', 12, 14); L('A 坑', 36, -2);
  L('Xbox', 9, 1); L('B 洞', -34, -30); L('B 门', -20, 36);
  L('B 平台', -42, 38); L('A 斜坡', 28, 44);

  return finish(walls, covers, ramps, labels);
}

function finish(walls, covers, ramps, labels) {
  return {
    name: 'dust2', displayName: 'Dust II', wallTex: 'sand', groundTex: 'ground',
    bounds: { minX: -54, maxX: 54, minZ: -70, maxZ: 68 },
    walls, covers, ramps, labels,
    bombsites: { A: { x: 32, z: 32, r: 6 }, B: { x: -34, z: 34, r: 6 } },
    spawns: {
      T: [ {x:-6,z:-60}, {x:0,z:-60}, {x:6,z:-60}, {x:-10,z:-56}, {x:10,z:-56} ],
      CT: [ {x:0,z:58}, {x:6,z:58}, {x:-6,z:58}, {x:12,z:54}, {x:-10,z:54} ],
    },
    nav: DUST2_NAV,
  };
}

// nav graph: nodes with callout tags + edges (index pairs)
export const DUST2_NAV = {
  nodes: [
    { x: 0, z: -58, tags: ['tspawn'] },        // 0
    { x: 12, z: -50, tags: ['tspawn'] },        // 1
    { x: -12, z: -50, tags: ['tspawn'] },       // 2
    { x: 26, z: -44, tags: ['long', 'longdoor'] }, // 3
    { x: 35, z: -30, tags: ['long'] },          // 4
    { x: 35, z: -6, tags: ['long', 'apit'] },   // 5
    { x: 33, z: 14, tags: ['long'] },           // 6
    { x: 30, z: 24, tags: ['asite'] },          // 7
    { x: 31, z: 32, tags: ['asite', 'plantA'] },// 8
    { x: 35, z: 33, tags: ['asite', 'plantA'] },// 9
    { x: 20, z: 22, tags: ['ashort', 'asite'] },// 10
    { x: 0, z: -44, tags: ['mid'] },            // 11
    { x: 0, z: -6, tags: ['mid', 'middoor'] },  // 12
    { x: 9, z: 6, tags: ['mid', 'catwalk'] },   // 13
    { x: 0, z: 18, tags: ['mid', 'ctmid'] },    // 14
    { x: 12, z: 20, tags: ['catwalk', 'ashort'] }, // 15
    { x: 2, z: 40, tags: ['ctmid', 'ctspawn'] },// 16
    { x: 4, z: 56, tags: ['ctspawn'] },         // 17
    { x: 28, z: 50, tags: ['aramp', 'ctspawn'] }, // 18
    { x: 29, z: 44, tags: ['aramp', 'asite'] }, // 19
    { x: -13, z: -50, tags: ['btunnel'] },      // 20
    { x: -32, z: -40, tags: ['btunnel'] },      // 21
    { x: -34, z: -18, tags: ['btunnel'] },      // 22
    { x: -34, z: 18, tags: ['btunnel', 'bsite'] }, // 23
    { x: -34, z: 30, tags: ['bsite', 'plantB'] },  // 24
    { x: -42, z: 36, tags: ['bsite', 'bplat', 'plantB'] }, // 25
    { x: -20, z: 34, tags: ['bdoors', 'bsite'] },  // 26
    { x: -12, z: 40, tags: ['bdoors', 'ctspawn'] },// 27
    { x: -12, z: 16, tags: ['mid', 'bdoors'] },    // 28
  ],
  edges: [
    [0,1],[0,2],[0,11],[1,3],[3,4],[4,5],[5,6],[6,7],[7,8],[8,9],[9,19],[19,18],[18,17],
    [11,12],[12,13],[13,14],[14,16],[16,17],[13,15],[15,10],[10,7],[10,8],[14,28],
    [2,20],[20,21],[21,22],[22,23],[23,24],[24,25],[24,26],[26,27],[27,17],[28,26],[28,14],
    [18,9],[16,27],
  ],
};

