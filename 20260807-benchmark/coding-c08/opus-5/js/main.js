// ============================================================================
// main.js — bootstrap, render loop and glue between the simulation and the UI.
// ============================================================================

import * as THREE from 'three';
import { CFG, QUALITY, PHASE, TEAM, TEAM_LABEL, SLOT, DIFFICULTY } from './core/constants.js';
import { RADIO } from './core/api.js';
import { clamp, damp, lerp, Rolling, fmtTime } from './core/util.js';
import { MAPS, MAP_LIST, getMap } from './maps/index.js';
import { Game } from './game/game.js';
import { Input, BINDINGS } from './engine/input.js';
import { AudioEngine } from './engine/audio.js';
import { MaterialLibrary, createSky } from './render/materials.js';
import { buildMapMeshes, buildRadarCanvas } from './render/mapmesh.js';
import { Effects } from './render/effects.js';
import { ViewModel, buildWeaponModel } from './render/viewmodel.js';
import { CharacterModel } from './render/characters.js';
import { HUD } from './ui/hud.js';
import { Radar } from './ui/radar.js';
import { BuyMenu } from './ui/buymenu.js';
import { Menu } from './ui/menu.js';
import { canBuy, buy as buyEconomy, botBuyPlan } from './game/economy.js';
import { Bot } from './game/bot.js';

const app = {
  cfg: null, renderer: null, scene: null, camera: null, game: null, input: null,
  audio: null, fx: null, hud: null, radar: null, buy: null, menu: null, vm: null,
  matlib: null, sky: null, mapGroup: null, radarCanvas: null,
  running: false, paused: false, last: 0, fpsAvg: new Rolling(45), accum: 0,
  scoreboard: false, mapinfo: false, autotest: null,
};
window.__app = app;

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
function boot() {
  const canvas = document.getElementById('view');
  app.cfg = { ...CFG, ...(Menu.loadCfg?.() || {}) };
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, powerPreference: 'high-performance', stencil: false,
  });
  renderer.setClearColor(0x0a0c0e, 1);
  renderer.autoClear = false;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  app.renderer = renderer;
  applyQuality();

  app.camera = new THREE.PerspectiveCamera(app.cfg.fov, window.innerWidth / window.innerHeight, 0.06, 400);
  app.audio = new AudioEngine(app.cfg);
  app.input = new Input(canvas, app.cfg);
  app.input.bind();
  app.input.onUnlock = () => { if (app.running && !app.menu.isOpen && !app.buy.isOpen) pause(true); };

  const hudRoot = document.getElementById('hud-root');
  const uiRoot = document.getElementById('ui-root');
  app.hud = new HUD(hudRoot, app.cfg);
  app.radar = new Radar(app.hud.radarSlot || hudRoot, app.cfg);
  app.buy = new BuyMenu(uiRoot, app.cfg);
  app.buy.onBuy = (id) => buyFromMenu(id);
  app.buy.onAutoBuy = () => autoBuy();
  app.buy.onCloseRequest = () => closeBuy();
  app.buy.onSound = (n) => app.audio?.play(n, {});
  app.menu = new Menu(uiRoot, app.cfg, {
    maps: MAP_LIST.map((m) => ({ id: m.id, cn: m.cn, name: m.name, desc: m.desc, tags: m.tags })),
    onStart: (cfg) => startMatch(cfg),
    onResume: () => pause(false),
    onRestart: () => restart(),
    onQuitToMenu: () => quitToMenu(),
    onSettingsChange: (cfg) => applySettings(cfg),
    onMapPreview: (id) => mapPreview(id),
    onSound: (n) => app.audio?.play(n, {}),
  });
  buildMapInfoPanel(uiRoot);
  app.hud.setCrosshair(app.cfg);
  // the buy menu owns the keyboard while it is open
  app.input.claim((e, down) => {
    if (!app.buy.isOpen || !down) return false;
    return !!app.buy.onKey(e);
  });

  window.addEventListener('resize', onResize);
  // clicking the viewport re-captures the mouse after a lost pointer lock
  canvas.addEventListener('mousedown', () => {
    if (app.running && !app.paused && !app.buy.isOpen && !app.menu.isOpen && !app.input.locked) app.input.lock();
  });
  onResize();
  document.getElementById('boot')?.classList.add('hidden');
  app.menu.showMain();

  const params = new URLSearchParams(location.search);
  if (params.get('autotest')) startAutotest(params);
  requestAnimationFrame(frame);
}

function applyQuality() {
  const q = QUALITY[app.cfg.quality] || QUALITY.high;
  app.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
  app.renderer.shadowMap.enabled = !!app.cfg.shadows && q.shadowMap > 0;
}

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  app.renderer.setSize(w, h, false);
  app.camera.aspect = w / h;
  app.camera.updateProjectionMatrix();
  if (app.vm) app.vm.resize?.(w / h);
  app.radar?.resize?.();
}

// ---------------------------------------------------------------------------
// match setup / teardown
// ---------------------------------------------------------------------------
async function startMatch(cfg) {
  // Start Web Audio while the click still counts as a user gesture, but never
  // let procedural sound generation block map loading.
  const audioReady = app.audio.init().catch((e) => {
    console.warn('[audio] disabled:', e);
    return false;
  });
  Object.assign(app.cfg, cfg);
  app.menu.showLoading('正在建立地图与导航网格…', 0.1);
  await new Promise((r) => setTimeout(r, 16));
  disposeMatch();

  const map = getMap(app.cfg.map);
  const q = QUALITY[app.cfg.quality] || QUALITY.high;
  app.scene = new THREE.Scene();
  app.matlib = new MaterialLibrary(q);
  app.sky = createSky(app.scene, map.env, q);
  app.renderer.toneMappingExposure = map.env.exposure ?? 1;
  app.menu.showLoading('正在编译地图几何体…', 0.4);
  await new Promise((r) => setTimeout(r, 16));

  const built = buildMapMeshes(map, app.matlib, q);
  app.mapGroup = built.group;
  app.scene.add(app.mapGroup);
  app.radarCanvas = buildRadarCanvas(map, 512).canvas;

  app.fx = new Effects(app.scene, q);
  app.vm = new ViewModel({ fov: app.cfg.viewmodelFov, team: app.cfg.team });
  app.menu.showLoading('正在部署人员…', 0.75);
  await new Promise((r) => setTimeout(r, 16));

  app.game = new Game({
    cfg: app.cfg, map, scene: app.scene, fx: app.fx, audio: app.audio, hud: app.hud, vm: app.vm,
    makeCharacter: (actor) => new CharacterModel(actor.team, { skinIndex: (actor.id.charCodeAt(1) || 0) % 3, name: actor.name }),
    makeWorldWeapon: (id) => { const m = buildWeaponModel(id, { world: true }); return m?.group || null; },
  });
  app.fx.setWorld(app.game.world);
  app.game.combat.game = app.game;
  app.hud.attach(app.game);
  app.radar.setMap(map, app.radarCanvas);
  wireEvents(app.game);
  for (const a of app.game.actors) ensureModel(a);

  app.audio.setVolumes({ master: app.cfg.masterVolume, sfx: app.cfg.sfxVolume, music: app.cfg.musicVolume });
  void audioReady.then((ready) => {
    if (ready && app.game?.map === map && map.env.ambience) {
      app.ambience = app.audio.loop(map.env.ambience, { vol: 0.35 });
    }
  });

  app.game.match.start();
  app.running = true;
  app.paused = false;
  app.menu.hide();
  app.hud.setVisible(true);
  app.input.lock();
  app.last = performance.now();
}

function ensureModel(actor) {
  if (actor.model || !app.game?.makeCharacter) return;
  actor.model = app.game.makeCharacter(actor);
  if (actor.model) {
    app.scene.add(actor.model.group);
    actor.model.setWeapon?.(actor.active?.id || 'knife');
    if (actor === app.game.local) actor.model.setVisible(false);
  }
}

function disposeMatch() {
  app.ambience?.stop?.();
  app.ambience = null;
  if (app.game) { app.game.dispose(); app.game = null; }
  if (app.fx) { app.fx.dispose?.(); app.fx = null; }
  if (app.vm) { app.vm.dispose?.(); app.vm = null; }
  if (app.mapGroup) { app.scene?.remove(app.mapGroup); app.mapGroup = null; }
  app.sky?.dispose?.();
  app.matlib?.dispose?.();
  app.scene = null;
  app.running = false;
}

function restart() {
  if (!app.game) return;
  app.game.match.start();
  app.paused = false;
  app.menu.hide();
  app.input.lock();
  app.hud.banner('重新开始', '比分已重置', 2200, 'info');
}

function quitToMenu() {
  disposeMatch();
  app.hud.setVisible(false);
  app.hud.detach?.();
  app.input.unlock();
  app.menu.showMain();
}

function pause(on) {
  if (!app.running) return;
  app.paused = on;
  if (on) { app.input.unlock(); app.menu.showPause(app.game); app.audio?.suspend?.(); }
  else { app.menu.hide(); app.input.lock(); app.audio?.resume?.(); }
}

function applySettings(cfg) {
  Object.assign(app.cfg, cfg);
  app.camera.fov = app.cfg.fov;
  app.camera.updateProjectionMatrix();
  applyQuality();
  app.audio?.setVolumes({ master: cfg.masterVolume, sfx: cfg.sfxVolume, music: cfg.musicVolume });
  app.hud?.setCrosshair(app.cfg);
  onResize();
}

function mapPreview(id) {
  const map = MAPS[id];
  if (!map) return null;
  const r = buildRadarCanvas(map, 320);
  return { canvas: r.canvas, name: map.name, cn: map.cn, desc: map.desc, tags: map.tags };
}

// ---------------------------------------------------------------------------
// events → UI feedback
// ---------------------------------------------------------------------------
// The HUD subscribes to the bus itself (kills, damage, banners, radio, flash…),
// so this only wires what lives outside the HUD: models and the end screen.
function wireEvents(game) {
  const hud = app.hud;
  game.bus.on('round_start', () => {
    hud.hideDeath?.();
    for (const a of game.actors) ensureModel(a);
  });
  game.bus.on('match_end', (res) => {
    app.running = false;
    app.input.unlock();
    setTimeout(() => app.menu.showEnd({
      winner: res.winner, score: res.score, draw: res.draw,
      actors: game.actors.map((a) => ({
        name: a.name, team: a.team, kills: a.kills, deaths: a.deaths, assists: a.assists,
        damage: Math.round(a.damageDealt), mvp: a.mvp, score: a.score, isLocal: a === game.local,
        adr: Math.round(a.damageDealt / Math.max(1, game.match.round)),
      })),
    }), 1400);
  });
  game.bus.on('sides_swapped', () => { for (const a of game.actors) ensureModel(a); });
  // the planted bomb gets a real model with a blinking indicator
  game.bus.on('plant', ({ pos }) => {
    const built = buildWeaponModel('c4', { world: true });
    const m = built?.group;
    if (!m || !app.scene) return;
    m.position.copy(pos);
    m.position.y += 0.05;
    m.rotation.y = Math.random() * Math.PI * 2;
    app.scene.add(m);
    game.bomb.mesh = m;
    const light = new THREE.PointLight(0xff2a18, 0, 7, 2);
    light.position.set(0, 0.25, 0);
    m.add(light);
    game.bomb.light = light;
  });
}

// ---------------------------------------------------------------------------
// buy menu
// ---------------------------------------------------------------------------
function openBuy() {
  if (!app.game?.local?.alive) return;
  app.buy.open(app.game);
  app.input.unlock();
}
function closeBuy() {
  app.buy.close();
  if (app.running && !app.paused) app.input.lock();
}
function buyFromMenu(id) {
  const g = app.game, a = g?.local;
  if (!a) return { ok: false, reason: 'time' };
  const chk = canBuy(a, id, g.match);
  if (!chk.ok) return chk;
  buyEconomy(a, id, g);
  g.bus.emit('buy', { actor: a, id });
  return { ok: true };
}
function autoBuy() {
  const g = app.game, a = g?.local;
  if (!a) return;
  for (const id of botBuyPlan(a, g)) {
    const chk = canBuy(a, id, g.match);
    if (chk.ok) { buyEconomy(a, id, g); g.bus.emit('buy', { actor: a, id }); }
  }
}

// ---------------------------------------------------------------------------
// map info overlay (M)
// ---------------------------------------------------------------------------
let mapInfoEl = null;
function buildMapInfoPanel(root) {
  const el = document.createElement('div');
  el.className = 'mapinfo hidden';
  root.appendChild(el);
  mapInfoEl = el;
}
function toggleMapInfo(on) {
  const map = app.game?.map;
  if (!map || !mapInfoEl) return;
  app.mapinfo = on;
  mapInfoEl.classList.toggle('hidden', !on);
  if (!on) return;
  const t = map.tactics;
  mapInfoEl.innerHTML = `
    <div class="mapinfo-head"><b>${map.cn}</b><span>${map.name}</span></div>
    <p class="mapinfo-desc">${map.desc}</p>
    <div class="mapinfo-cols">
      <div><h4>关键点位</h4><ul>${map.callouts.map((c) => `<li>${c.cn}<i>${c.name}</i></li>`).join('')}</ul></div>
      <div><h4>狙击对枪线</h4><ul>${(map.sniperLines || []).map((s) => `<li>${s.label}</li>`).join('')}</ul></div>
      <div><h4>进攻路线</h4><ul>${Object.keys(t.T.routes).map((k) => `<li>${k} · ${t.T.routes[k].length} 段</li>`).join('')}
        <h4>CT 回防</h4><ul>${Object.keys(t.CT.rotate).map((k) => `<li>${k.replace(/_/g, ' → ')}</li>`).join('')}</ul></div>
    </div>
    <div class="mapinfo-foot">松开 M 关闭</div>`;
}

// ---------------------------------------------------------------------------
// frame
// ---------------------------------------------------------------------------
function frame(now) {
  requestAnimationFrame(frame);
  const dt = clamp((now - app.last) / 1000, 0, 0.1) || 0;
  app.last = now;
  if (dt > 0) app.fpsAvg.push(1 / dt);
  if (app.game) app.game.fps = Math.round(app.fpsAvg.avg);

  if (app.running && !app.paused) {
    handleUiKeys();
    stepLocal(dt);
    app.game.update(dt);
    if (app.autotest) autotestTick(dt);
  } else {
    handleUiKeys();
  }
  present(dt);
  app.input.endFrame();
}

function handleUiKeys() {
  const i = app.input, g = app.game;
  if (!g) return;
  if (app.buy.isOpen) return;                     // the buy menu owns the keyboard
  if (i.pressed(BINDINGS.buy)) {
    if (g.match.isBuyTime && g.local?.alive && g.local.inBuyZone) openBuy();
    else { app.audio?.play('buy_fail', {}); app.hud.toast(g.local?.inBuyZone ? '购买时间已结束' : '必须在出生区购买'); }
  }
  const sb = i.down(BINDINGS.scoreboard);
  if (sb !== app.scoreboard) { app.scoreboard = sb; app.hud.showScoreboard(sb); }
  const mi = i.down(BINDINGS.mapinfo);
  if (mi !== app.mapinfo) toggleMapInfo(mi);
}

function stepLocal(dt) {
  const g = app.game, a = g.local, i = app.input;
  if (!a || app.autotest) return;
  if (!a.alive) {
    // spectator: follow a teammate, jump cycles
    if (i.pressed(BINDINGS.jump)) g.cycleSpectate(1);
    Object.assign(a.cmd, { forward: 0, right: 0, attack: false, attack2: false, use: false, jump: false });
    return;
  }
  const look = i.consumeLook();
  const zoomScale = a.zoom && a.active?.def?.ads?.fov ? (a.active.def.ads.fov[a.zoom] / app.cfg.fov) : 1;
  a.yaw += look.dx * zoomScale;
  a.pitch = clamp(a.pitch + look.dy * zoomScale, -1.54, 1.54);
  i.fillCmd(a.cmd, a);

  const wheel = i.consumeWheel();
  if (wheel) {
    const order = [SLOT.PRIMARY, SLOT.SECONDARY, SLOT.KNIFE, SLOT.GRENADE];
    const cur = order.indexOf(a.activeSlot);
    for (let k = 1; k <= order.length; k++) {
      const s = order[(cur + k * (wheel > 0 ? 1 : -1) + order.length * 2) % order.length];
      if (a.switchTo(s)) break;
    }
  }
  if (a.cmd.switchTo === SLOT.GRENADE && a.activeSlot === SLOT.GRENADE) { a.nextGrenade(); a.cmd.switchTo = null; }
  if (i.pressed(BINDINGS.drop)) dropCurrent(a);
  if (a.cmd.inspect) app.vm?.inspect?.();
  // grenade arc preview while a grenade is out
  if (a.activeSlot === SLOT.GRENADE) g.grenades.setPreview?.(a, a.active.id, true);
  else g.grenades.setPreview?.(a, null, false);
  // pickup / defuse prompt
  const p = g.pickupNear(a);
  if (p && !(p.def.slot === SLOT.PRIMARY && a.inv.primary)) app.hud.prompt(`按 E 拾取 ${p.def.cn || p.def.name}`);
  else if (a.hasDefuseTarget && g.match.phase === PHASE.PLANTED) app.hud.prompt(a.kit ? '按住 E 拆除炸弹（5 秒）' : '按住 E 拆除炸弹（10 秒）');
  else if (a.hasBomb && g.siteAt(a.pos) && g.match.phase === PHASE.LIVE) app.hud.prompt('按住 E 安放炸弹');
  else app.hud.prompt(null);
}

function dropCurrent(a) {
  const g = app.game;
  const inst = a.activeSlot === SLOT.PRIMARY ? a.inv.primary : a.activeSlot === SLOT.SECONDARY ? a.inv.secondary : null;
  if (!inst) return;
  g.dropPickup(a, inst);
  if (a.activeSlot === SLOT.PRIMARY) a.inv.primary = null; else a.inv.secondary = null;
  a.selectBest();
}

// ---------------------------------------------------------------------------
// presentation
// ---------------------------------------------------------------------------
const _camTarget = new THREE.Vector3();
function present(dt) {
  const g = app.game;
  if (!g || !app.scene) return;
  const view = g.local?.alive ? g.local : (g.spectate.target?.alive ? g.spectate.target : g.local);
  if (view) updateCamera(view, dt);

  // third person models
  for (const a of g.actors) {
    if (!a.model) continue;
    const hide = a === view && view === g.local && g.local.alive;
    a.model.setVisible(!hide && (a.alive || a.deathTime > 0));
    a.model.update(dt, {
      pos: a.pos, yaw: a.yaw, pitch: a.pitch, speed: Math.hypot(a.vel.x, a.vel.z),
      crouching: a.crouching, onGround: a.onGround, alive: a.alive, firing: a.sinceShot < 0.09,
      reloading: a.reloading, planting: a.plantingT > 0, defusing: a.defusingT > 0,
      weaponId: a.active?.id || 'knife', hurt: g.time - a.lastHurtTime < 0.25,
    });
  }

  // first person weapon
  if (app.vm && view === g.local && g.local.alive) {
    app.vm.setVisible(true);
    app.vm.update(dt, {
      moveSpeed: Math.hypot(g.local.vel.x, g.local.vel.z), crouch: g.local.crouching ? 1 : 0,
      onGround: g.local.onGround, walking: g.local.walking, sprinting: g.local.sprinting,
      yawDelta: app._lastYawDelta || 0, pitchDelta: app._lastPitchDelta || 0,
      ads: g.local.ads, reloading: g.local.reloading, health: g.local.health,
    });
  } else app.vm?.setVisible(false);

  app.fx?.update(dt, app.camera);
  // planted C4: blink faster as the timer runs out
  if (g.bomb.light && g.match.phase === PHASE.PLANTED) {
    const period = clamp(g.bomb.timer / 40 * 1.05, 0.14, 1.0);
    const t = (g.time % period) / period;
    g.bomb.light.intensity = t < 0.18 ? 5.5 : 0.15;
  } else if (g.bomb.light) g.bomb.light.intensity = 0;
  if (app.audio?.ready) {
    app.camera.getWorldDirection(_camTarget);
    app.audio.setListener(app.camera.position, _camTarget, app.camera.up);
  }
  app.hud?.update(dt, g);
  app.radar?.update(g);

  const r = app.renderer;
  r.clear();
  r.render(app.scene, app.camera);
  if (app.vm?.scene && app.vm.visible !== false && g.local?.alive && view === g.local && !g.local.zoom) {
    r.clearDepth();
    r.render(app.vm.scene, app.vm.camera);
  }
}

let _prevYaw = 0, _prevPitch = 0;
function updateCamera(actor, dt) {
  const cam = app.camera;
  const shake = app.fx?.shakeOffset || { pitch: 0, yaw: 0, roll: 0 };
  cam.position.set(actor.eye.x, actor.eye.y, actor.eye.z);
  const yaw = actor.yaw + actor.recoilAim.x + shake.yaw;
  const pitch = clamp(actor.pitch + actor.recoilAim.y + shake.pitch, -1.55, 1.55);
  cam.rotation.order = 'YXZ';
  cam.rotation.set(-pitch, -yaw - Math.PI / 2, shake.roll);
  app._lastYawDelta = yaw - _prevYaw;
  app._lastPitchDelta = pitch - _prevPitch;
  _prevYaw = yaw; _prevPitch = pitch;

  // fov: scope levels snap, iron sights blend
  const def = actor.active?.def;
  let fov = app.cfg.fov;
  if (def?.ads?.fov && actor.zoom > 0) fov = def.ads.fov[Math.min(actor.zoom, def.ads.fov.length - 1)];
  else if (def?.ads?.type === 'iron') fov = lerp(app.cfg.fov, app.cfg.fov * 0.86, actor.ads);
  if (actor.sprinting) fov = lerp(fov, fov * 1.06, 0.6);
  if (Math.abs(cam.fov - fov) > 0.01) { cam.fov += (fov - cam.fov) * damp(22, dt); cam.updateProjectionMatrix(); }
  app.hud?.setScope?.(actor.zoom && def?.ads?.type === 'scope' ? actor.zoom : 0);
}

// ---------------------------------------------------------------------------
// automated self test:  index.html?autotest=3&speed=6
// ---------------------------------------------------------------------------
function startAutotest(params) {
  const rounds = parseInt(params.get('autotest'), 10) || 2;
  const speed = parseInt(params.get('speed'), 10) || 6;
  app.autotest = { rounds, speed, log: [], startRound: 0, errors: [], done: false };
  window.__TEST = app.autotest;
  const cfg = {
    ...app.cfg, map: params.get('map') || 'dust2', botCount: 9, difficulty: params.get('diff') || 'hard',
    maxRounds: rounds * 2, team: params.get('team') || 'CT',
  };
  window.addEventListener('error', (e) => app.autotest.errors.push(String(e.message)));
  startMatch(cfg).then(() => {
    app.game.bus.on('round_end', ({ winner, reason }) => {
      app.autotest.log.push({ round: app.game.match.round, winner, reason, score: { ...app.game.match.score } });
      console.log('[autotest] round', app.game.match.round, winner, reason, JSON.stringify(app.game.match.score));
    });
    app.game.bus.on('match_end', (r) => {
      app.autotest.done = true;
      app.autotest.result = r;
      console.log('[autotest] MATCH END', JSON.stringify(r.score), 'errors', app.autotest.errors.length);
    });
    // let the AI play both sides
    if (app.game.local) {
      app.game.local.isBot = true;
      app.game.local.bot = new Bot(app.game.local, app.game, cfg.difficulty);
      app.game.local.bot.onRoundStart(app.game.coordinator[app.game.local.team].assignmentFor(app.game.local));
    }
  });
}

function autotestTick(dt) {
  // run extra simulation steps so a full match completes in seconds
  const t = app.autotest;
  if (t.done) return;
  for (let i = 1; i < t.speed; i++) app.game.update(1 / 60);
}

boot();







