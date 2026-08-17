// main.js — bootstrap, menus, main loop
import { Stage } from './scene.js';
import { HUD } from './ui.js';
import { Game } from './game.js';
import { initInput, Input, requestLock, endFrameInput, pressed, down } from './input.js';
import { initAudio, resumeAudio, setMasterVolume } from './audio.js';
import { MAPS, MAP_ORDER } from './maps.js';

const canvas = document.getElementById('game-canvas');
const stage = new Stage(canvas);
const hud = new HUD(stage);
const game = new Game(stage, hud);

const cfg = { map: 'dust2', team: 'CT', count: 3, diff: 'normal', maxwin: 8 };
let inGame = false;

// ---- menu wiring ----
function buildMapSelector() {
  const el = document.getElementById('sel-map'); el.innerHTML = '';
  MAP_ORDER.forEach((key, i) => {
    const b = document.createElement('button'); b.dataset.v = key; b.textContent = MAPS[key].name;
    if (key === cfg.map) b.classList.add('active');
    el.appendChild(b);
  });
}
function wireSeg(id, key, parse) {
  const el = document.getElementById(id);
  el.addEventListener('click', e => {
    const btn = e.target.closest('button'); if (!btn) return;
    [...el.children].forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    cfg[key] = parse ? parse(btn.dataset.v) : btn.dataset.v;
  });
}
buildMapSelector();
wireSeg('sel-map', 'map');
wireSeg('sel-team', 'team');
wireSeg('sel-count', 'count', v => parseInt(v));
wireSeg('sel-diff', 'diff');
wireSeg('sel-maxwin', 'maxwin', v => parseInt(v));

function startMatch() {
  initAudio(); resumeAudio();
  document.getElementById('main-menu').classList.add('hidden');
  document.getElementById('results-menu').classList.add('hidden');
  hud.show();
  game.configure({ ...cfg });
  game.start();
  inGame = true; game.paused = false;
}
document.getElementById('start-btn').onclick = startMatch;

// pause menu
const pauseMenu = document.getElementById('pause-menu');
function setPaused(v) {
  if (!inGame) return;
  game.paused = v;
  if (v) { pauseMenu.classList.remove('hidden'); if (document.exitPointerLock) document.exitPointerLock(); }
  else { pauseMenu.classList.add('hidden'); if (!game.buyMenuOpen) canvas.requestPointerLock(); }
}
document.getElementById('resume-btn').onclick = () => setPaused(false);
document.getElementById('restart-btn').onclick = () => { pauseMenu.classList.add('hidden'); game.paused = false; game.restart(); };
document.getElementById('mapselect-btn').onclick = () => { toMenu(); };
document.getElementById('rematch-btn').onclick = () => { hud.hideResults(); startMatch(); };
document.getElementById('tomenu-btn').onclick = () => { hud.hideResults(); toMenu(); };
function toMenu() {
  inGame = false; game.running = false; game.paused = false;
  pauseMenu.classList.add('hidden'); hud.hide(); hud.openBuy(false);
  game.cleanup();
  document.getElementById('main-menu').classList.remove('hidden');
  if (document.exitPointerLock) document.exitPointerLock();
}

// sensitivity
const sens = document.getElementById('sens-slider');
sens.addEventListener('input', () => { Input.sensitivity = parseFloat(sens.value); document.getElementById('sens-val').textContent = parseFloat(sens.value).toFixed(1); });

// keyboard: Esc pause / close buy, Tab scoreboard
window.addEventListener('keydown', e => {
  if (e.code === 'Escape') {
    if (!inGame) return;
    if (game.buyMenuOpen) { game.toggleBuy(false); }
    else setPaused(!game.paused);
  }
  if (e.code === 'Tab' && inGame && !game.paused) { e.preventDefault(); hud.toggleScoreboard(true, game); }
});
window.addEventListener('keyup', e => { if (e.code === 'Tab' && inGame) hud.toggleScoreboard(false, game); });

// pointer lock
initInput(canvas, locked => {
  if (!inGame) return;
  if (!locked && !game.paused && !game.buyMenuOpen && game.state !== 'over' && game.player.alive) {
    // lost lock unexpectedly -> pause
    if (game.state !== 'menu') setPaused(true);
  }
});
canvas.addEventListener('click', () => {
  if (inGame && !game.paused && !game.buyMenuOpen && !Input.locked) requestLock();
});

// ---- spotted computation helper injected into game HUD update ----
const origUpdateHud = game.updateHud.bind(game);
game.updateHud = function (dt, t) {
  const spotted = new Set();
  const mates = game.entities.filter(e => e.team === game.playerTeam && e.alive);
  for (const en of game.entities) {
    if (en.team === game.playerTeam || !en.alive) continue;
    for (const mt of mates) {
      if (!game.world.segmentBlocked(mt.pos.x, mt.pos.z, en.pos.x, en.pos.z)) { spotted.add(en.id); break; }
    }
  }
  game._spotted = spotted;
  hud.update({
    player: game.player, state: game.state,
    timer: game.bomb.planted ? game.bomb.timer : game.roundTimer,
    bombPlanted: game.bomb.planted, scoreT: game.scoreT, scoreCT: game.scoreCT, playerTeam: game.playerTeam,
    entities: game.entities, bounds: game.mapData.bounds, labels: game.mapData.labels,
    bombPos: (game.bomb.planted || game.bomb.dropped) ? game.bomb.pos : null,
    bombsites: game.mapData.bombsites, freeze: game.state === 'freeze' ? game.freezeTimer : 0,
    buyOpen: game.buyMenuOpen, spotted,
  });
};

// ---- main loop ----
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.05) dt = 0.05;
  if (inGame) game.update(dt);
  endFrameInput();
  stage.render();
}
requestAnimationFrame(loop);

// expose for debugging
window.__game = game;
