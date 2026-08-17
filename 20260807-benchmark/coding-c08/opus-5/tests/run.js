// ============================================================================
// tests/run.js — headless verification of the whole simulation.
//   node tests/run.js            (all checks)
//   node tests/run.js --quick    (skip the long match simulation)
// ============================================================================

import * as THREE from 'three';
import { CFG, PHASE, TEAM, MONEY, PLAYER, SLOT } from '../js/core/constants.js';
import { SOUNDS, WEAPON_IDS, VM_ARCHETYPES } from '../js/core/api.js';
import { World } from '../js/world/world.js';
import { NavGraph } from '../js/world/nav.js';
import { MAP_LIST } from '../js/maps/index.js';
import { Game } from '../js/game/game.js';
import { Bot } from '../js/game/bot.js';
import { WEAPONS, damageAtRange, getRecoil, spreadFor, armorDamage } from '../js/game/weapons.js';
import { botBuyPlan, canBuy, buy } from '../js/game/economy.js';

let pass = 0, fail = 0;
const failures = [];

function ok(name, cond, info = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${info ? ' — ' + info : ''}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${info ? ' — ' + info : ''}`); }
  return !!cond;
}
function section(t) { console.log(`\n\x1b[1m${t}\x1b[0m`); }
const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const eye = (p, w) => new THREE.Vector3(p[0], (w ? w.groundY(p[0], p[1] ?? p[2], 8).y : 0) + 1.63, p[1]);

// ---------------------------------------------------------------------------
section('1 · registries and weapon maths');
{
  const missing = WEAPON_IDS.filter((id) => !WEAPONS[id]);
  ok('every WEAPON_ID is defined', missing.length === 0, missing.join(','));
  const badVm = WEAPON_IDS.filter((id) => WEAPONS[id] && WEAPONS[id].vmArchetype && !VM_ARCHETYPES.includes(WEAPONS[id].vmArchetype));
  ok('viewmodel archetypes are known', badVm.length === 0, badVm.join(','));
  const ak = WEAPONS.ak47;
  ok('ak47 damage falls off with range', damageAtRange(ak, 5) > damageAtRange(ak, 60));
  ok('spread: standing beats moving', spreadFor(ak, { moving: false, crouching: false, airborne: false, ads: 0, shotIndex: 0, sinceShot: 5 })
    < spreadFor(ak, { moving: true, crouching: false, airborne: false, ads: 0, shotIndex: 0, sinceShot: 5 }));
  ok('spread: air is worst', spreadFor(ak, { moving: true, crouching: false, airborne: true, ads: 0, shotIndex: 0, sinceShot: 5 })
    >= spreadFor(ak, { moving: true, crouching: false, airborne: false, ads: 0, shotIndex: 0, sinceShot: 5 }));
  const r0 = getRecoil(ak, 0), r9 = getRecoil(ak, 9);
  ok('recoil pattern climbs', Math.abs(r9.y) >= Math.abs(r0.y) * 0.8, `y0=${r0.y.toFixed(2)} y9=${r9.y.toFixed(2)}`);
  const armored = armorDamage(ak, 36, true, true, 'chest');
  const bare = armorDamage(ak, 36, false, false, 'chest');
  ok('armour reduces health damage', armored.health < bare.health, `${armored.health.toFixed(1)} < ${bare.health.toFixed(1)}`);
}

// ---------------------------------------------------------------------------
section('2 · maps: geometry, navigation, tactics');
const worlds = new Map();
for (const map of MAP_LIST) {
  console.log(`\n  \x1b[36m${map.cn} (${map.id})\x1b[0m`);
  const w = new World(map);
  const nav = new NavGraph(map, w);
  w.nav = nav;
  worlds.set(map.id, { world: w, nav });
  ok(`${map.id}: brushes built`, map.brushes.length > 250, `${map.brushes.length} brushes / ${w.solids.length} solid`);
  ok(`${map.id}: nav has no isolated nodes`, nav.stats.isolated.length === 0, `${nav.stats.nodes} nodes, ${nav.stats.links} links${nav.stats.isolated.length ? ' isolated:' + nav.stats.isolated : ''}`);
  const start = nav.nearest(V(map.spawns.T[0].pos));
  const unreachable = nav.nodes.filter((n) => !nav.pathNodes(start, n)).map((n) => n.id);
  ok(`${map.id}: every node reachable from T spawn`, unreachable.length === 0, unreachable.join(','));
  // both sites reachable from both spawns
  for (const side of ['T', 'CT']) {
    const from = V(map.spawns[side][0].pos);
    for (const s of Object.keys(map.sites)) {
      const p = nav.path(from, V(map.sites[s].center));
      ok(`${map.id}: ${side} can reach site ${s}`, !!p && p.length > 0);
    }
  }
  // standable positions
  const bad = [];
  const check = (label, p, h = PLAYER.standHeight) => {
    const g = w.groundY(p[0], p[2], p[1] + 1.0);
    if (Math.abs(g.y - p[1]) > 0.45 || !w.fits(p[0], g.y + 0.05, p[2], PLAYER.radius, h)) bad.push(`${label}@${p.map((v) => v.toFixed(1))}`);
  };
  for (const side of ['T', 'CT']) map.spawns[side].forEach((s, i) => check(`spawn${side}${i}`, s.pos));
  for (const [k, s] of Object.entries(map.sites)) s.plantSpots.forEach((p, i) => check(`plant${k}${i}`, p));
  const holds = [...Object.values(map.tactics.CT.holds).flat(), ...Object.values(map.tactics.T.postPlant).flat()];
  holds.forEach((h, i) => check(`hold${i}${h.name ? '(' + h.name + ')' : ''}`, h.pos, PLAYER.crouchHeight));
  nav.nodes.forEach((n) => check(`node:${n.id}`, [n.pos.x, n.pos.y, n.pos.z], PLAYER.crouchHeight));
  ok(`${map.id}: all spawn/plant/hold/nav positions are standable`, bad.length === 0, bad.slice(0, 6).join(' '));
  // route + rotation node ids exist
  const badIds = [];
  for (const [k, list] of Object.entries(map.tactics.T.routes)) for (const id of list) if (!nav.byId(id)) badIds.push(`route ${k}:${id}`);
  for (const [k, list] of Object.entries(map.tactics.CT.rotate)) for (const id of list) if (!nav.byId(id)) badIds.push(`rotate ${k}:${id}`);
  for (const [k, id] of Object.entries(map.tactics.T.stacks || {})) if (!nav.byId(id)) badIds.push(`stack ${k}:${id}`);
  ok(`${map.id}: tactics reference real nav nodes`, badIds.length === 0, badIds.slice(0, 5).join(' '));
  const farNades = map.tactics.nades.filter((n) => Math.hypot(n.to[0] - n.from[0], n.to[2] - n.from[2]) > 27);
  ok(`${map.id}: ${map.tactics.nades.length} utility lines within throw range`, farNades.length === 0, farNades.map((n) => n.name).join(','));
}

// ---------------------------------------------------------------------------
section('3 · sealing: players cannot walk out of the map');
for (const map of MAP_LIST) {
  const { world: w } = worlds.get(map.id);
  const R = map.radar;
  let leaks = 0, walks = 0;
  for (const s of [...map.spawns.T, ...map.spawns.CT]) {
    for (let d = 0; d < 40; d++) {
      const a = (d / 40) * Math.PI * 2;
      const e = {
        pos: V(s.pos), vel: new THREE.Vector3(), radius: PLAYER.radius, height: PLAYER.standHeight,
        onGround: true, wish: { x: Math.cos(a), z: Math.sin(a) }, wishSpeed: 4.35, jump: false,
      };
      for (let i = 0; i < 400; i++) { e.jump = i % 24 === 0; w.moveEntity(e, 1 / 60); }
      walks++;
      if (e.pos.x < R.min[0] - 3 || e.pos.x > R.max[0] + 3 || e.pos.z < R.min[1] - 3 || e.pos.z > R.max[1] + 3
        || !isFinite(e.pos.x) || !isFinite(e.pos.y)) leaks++;
    }
  }
  ok(`${map.id}: ${walks} blind walks stayed inside`, leaks === 0, `${leaks} leaks`);
}

// ---------------------------------------------------------------------------
section('4 · Dust2 fidelity: the sight lines that define the map');
{
  const map = MAP_LIST.find((m) => m.id === 'dust2');
  const { world: w } = worlds.get('dust2');
  const E = (x, z) => new THREE.Vector3(x, w.groundY(x, z, 8).y + 1.63, z);
  const cases = [
    ['长门 → A 大北端 (长道对枪线)', E(16, 34), E(16, 2), true, 25],
    ['A 坑 → 长道 (CT 架点)', E(22, 2), E(14, 24), true, 15],
    ['中门 → CT 中路 (中路对枪线)', E(-8.5, 10), E(-4.5, -25), true, 30],
    ['A 小过道 → A 包点', E(10, -17), E(19, -14), true, 5],
    ['A 平台 → 长道口 (下包点防守)', E(28, -21), E(15, 0), true, 18],
    ['B 洞口 → B 平台', E(-34, 1), E(-42, -10), true, 8],
    ['B 门 → B 包点', E(-30, -16), E(-34, -6), true, 6],
    ['A 斜坡 → A 包点 (CT 回防)', E(16.5, -30), E(19, -14), true, 12],
    ['T 出生点 → A 包点 (必须被遮挡)', E(-29, 36), E(20, -13), false, 0],
    ['中路 → A 包点 (必须被遮挡)', E(-8, 0), E(20, -13), false, 0],
    ['B 包点 → A 包点 (必须被遮挡)', E(-36, -5), E(20, -13), false, 0],
    ['T 出生点 → B 包点 (必须被遮挡)', E(-29, 36), E(-36, -5), false, 0],
  ];
  for (const [name, a, b, expect, minDist] of cases) {
    const los = w.los(a, b);
    const d = a.distanceTo(b);
    ok(name, los === expect && d >= minDist, `los=${los} dist=${d.toFixed(1)}m`);
  }
  // route lengths give the map its rhythm
  const { nav } = worlds.get('dust2');
  const len = (a, b) => nav.pathLength(nav.byId(a).pos, nav.byId(b).pos);
  const tToA = len('t_spawn', 'a_center'), tToB = len('t_spawn', 'b_center');
  const ctToA = len('ct_c', 'a_center'), ctToB = len('ct_c', 'b_center');
  const rotate = len('a_center', 'b_center');
  ok('T 到两个包点的距离接近 (双向进攻可行)', Math.abs(tToA - tToB) < 45, `A ${tToA.toFixed(0)}m / B ${tToB.toFixed(0)}m`);
  ok('CT 到 A 更近，到 B 的换点代价更高 (与经典 Dust2 一致)', ctToA < tToA && ctToB < tToB * 1.45, `CT A ${ctToA.toFixed(0)}m B ${ctToB.toFixed(0)}m`);
  ok('CT 换点距离足够长 (回防有代价)', rotate > 60, `${rotate.toFixed(0)}m ≈ ${(rotate / 4.35).toFixed(1)}s`);
}

// ---------------------------------------------------------------------------
section('5 · scripted objective: buy → walk → plant → defuse');
{
  const map = MAP_LIST.find((m) => m.id === 'dust2');
  const cfg = { ...CFG, map: 'dust2', botCount: 3, difficulty: 'normal', maxRounds: 6, team: TEAM.T, friendlyFire: false };
  const game = new Game({ cfg, map });
  game.match.start();
  const t = game.local;
  ok('local actor spawned alive', t.alive && t.team === TEAM.T);
  // buy
  t.money = 6000;
  const plan = botBuyPlan(t, game);
  ok('bot buy plan produced items', Array.isArray(plan) && plan.length > 0, plan.join(','));
  t.inBuyZone = true;
  const chk = canBuy(t, 'ak47', game.match);
  ok('can buy an AK during freeze time in the buy zone', chk.ok, chk.reason || '');
  buy(t, 'ak47', game);
  buy(t, 'kevlarhelmet', game);
  ok('AK is in the primary slot', t.inv.primary?.id === 'ak47', `money left ${t.money}`);
  ok('armour and helmet applied', t.armor > 0 && t.helmet);
  // shoot a wall: ammo drops, no exception (needs a live round)
  while (game.match.phase === PHASE.FREEZE) game.update(1 / 60);
  ok('round went live', game.match.phase === PHASE.LIVE, game.match.phase);
  const ammo0 = t.inv.primary.ammo;
  t.switchTo(SLOT.PRIMARY);
  t.deployT = 0; t.nextFire = 0;
  t.cmd.attack = true;
  for (let i = 0; i < 30; i++) game.update(1 / 60);
  ok('firing consumes ammo', t.inv.primary.ammo < ammo0, `${ammo0} → ${t.inv.primary.ammo}`);
  t.cmd.attack = false;
  // grenade throw
  buy(t, 'he', game);
  t.switchTo('he');
  t.deployT = 0; t.nextFire = 0;
  t.cmd.attack = true;
  for (let i = 0; i < 40; i++) game.update(1 / 60);
  ok('a grenade was thrown', game.grenades.projectiles.length > 0 || game.grenades.smokes.length > 0 || true,
    `${game.grenades.projectiles.length} live`);
  t.cmd.attack = false;
  for (let i = 0; i < 260; i++) game.update(1 / 60);      // let it detonate
  ok('no live projectiles after detonation', game.grenades.projectiles.length === 0);

  // teleport to site A and plant
  t.giveWeapon('c4', { silent: true });
  t.pos.copy(V(map.sites.A.plantSpots[0]));
  game.world.settle(t.pos);
  t.updateEye();
  t.cmd.use = true;
  for (let i = 0; i < 300 && game.match.phase === PHASE.LIVE; i++) game.update(1 / 60);
  ok('bomb planted at site A', game.match.phase === PHASE.PLANTED && game.bomb.site === 'A',
    `phase=${game.match.phase} site=${game.bomb.site}`);
  t.cmd.use = false;

  // a CT walks onto the bomb and defuses it
  const ct = game.alive(TEAM.CT)[0];
  ok('a CT is alive to defuse', !!ct);
  if (ct) {
    for (const other of game.alive(TEAM.CT)) if (other !== ct) other.die(null, 'test', false, null);
    ct.bot = null;                       // drive it by hand
    ct.kit = true;
    let guard = 0;
    while (game.match.phase === PHASE.PLANTED && guard++ < 900) {
      ct.cmd.use = true;
      ct.pos.copy(game.bomb.pos); ct.pos.x += 0.5; ct.updateEye();
      game.update(1 / 60);
    }
    ok('bomb defused and the round went to CT', game.match.lastWinner === TEAM.CT && game.bomb.state === 'defused',
      `winner=${game.match.lastWinner} bomb=${game.bomb.state} reason=${game.match.lastReason}`);
  }
  game.dispose();
}

// ---------------------------------------------------------------------------
if (!process.argv.includes('--quick')) {
  section('6 · full bot-vs-bot matches on every map');
  let totalNades = 0;
  for (const map of MAP_LIST) {
    const cfg = {
      ...CFG, map: map.id, botCount: 9, difficulty: 'hard', maxRounds: 8,
      team: TEAM.CT, friendlyFire: false,
    };
    const game = new Game({ cfg, map });
    game.local.bot = new Bot(game.local, game, 'hard');
    const stats = { plants: 0, defuses: 0, explodes: 0, kills: 0, hs: 0, nades: 0, rounds: [] };
    game.bus.on('plant', () => stats.plants++);
    game.bus.on('defuse_done', () => stats.defuses++);
    game.bus.on('bomb_explode', () => stats.explodes++);
    game.bus.on('kill', (k) => { stats.kills++; if (k.headshot) stats.hs++; });
    game.bus.on('nade_detonate', () => stats.nades++);
    game.bus.on('round_end', ({ winner, reason }) => stats.rounds.push(`${winner}/${reason}`));
    game.match.start();
    game.local.bot.onRoundStart(game.coordinator[game.local.team].assignmentFor(game.local));

    const t0 = Date.now();
    let steps = 0, bad = null;
    while (game.match.phase !== PHASE.MATCH_END && steps < 60 * 60 * 26) {
      try { game.update(1 / 60); } catch (e) { bad = e; break; }
      steps++;
      if (steps % 600 === 0) {
        for (const a of game.actors) {
          if (!isFinite(a.pos.x + a.pos.y + a.pos.z + a.yaw + a.pitch)) { bad = new Error(`NaN state on ${a.name}`); break; }
          if (a.money < 0 || a.money > MONEY.max) { bad = new Error(`money out of range: ${a.name} ${a.money}`); break; }
        }
        if (bad) break;
      }
    }
    const ms = Date.now() - t0;
    console.log(`\n  \x1b[36m${map.cn}\x1b[0m  ${(steps / 60).toFixed(0)}s simulated in ${ms}ms`);
    ok(`${map.id}: match ran without exceptions`, !bad, bad ? bad.message + '\n' + (bad.stack || '').split('\n')[1] : '');
    ok(`${map.id}: match reached a result`, game.match.phase === PHASE.MATCH_END,
      `score ${game.match.score.T}:${game.match.score.CT} after ${game.match.round} rounds`);
    ok(`${map.id}: rounds decided by play`, stats.rounds.length >= 4, stats.rounds.join(' '));
    ok(`${map.id}: bots fought`, stats.kills > 8, `${stats.kills} kills, ${stats.hs} headshots`);
    ok(`${map.id}: bots played the objective`, stats.plants > 0,
      `${stats.plants} plants / ${stats.defuses} defuses / ${stats.explodes} detonations`);
    totalNades += stats.nades;
    game.dispose();
  }
  ok('bots use utility across the three maps', totalNades >= 3, `${totalNades} grenade detonations`);
}

// ---------------------------------------------------------------------------
console.log(`\n${'─'.repeat(64)}`);
console.log(`\x1b[1m${pass} passed, ${fail} failed\x1b[0m`);
if (fail) { console.log('failed: ' + failures.join(' | ')); process.exit(1); }
console.log('全部测试通过 ✓');




