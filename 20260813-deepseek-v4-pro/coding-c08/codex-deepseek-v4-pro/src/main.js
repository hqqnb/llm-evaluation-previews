// ============================================================================
// 入口：输入、主循环、启动
// ============================================================================

import * as THREE from "three";
import { Game } from "./game.js";
import { HUD } from "./hud.js";
import { AudioSys } from "./audio.js";

const canvas = document.getElementById("gl");
const game = new Game({ canvas, hud: null });
const hud = new HUD(game);
game.hud = hud;

// ---------------------------------------------------------------------------
// 输入
// ---------------------------------------------------------------------------
const keys = new Set();
let sens = 1.0;
let mouseDX = 0, mouseDY = 0;
let fireHeld = false, aimHeld = false;
let firePressed = false;
let crouchToggled = false;

hud.onSensChange = (v) => { sens = v; };
hud.onVolumeChange = (v) => { AudioSys.setVolume(v); };
hud.onBuyToggle = (open) => {
  if (open) document.exitPointerLock?.();
  else if (game.phase === "live" && game.human?.alive) game.requestLock();
};

window.addEventListener("keydown", (ev) => {
  if (ev.repeat) return;
  keys.add(ev.code);
  const p = game.human;
  if (!p || game.phase === "menu" || game.phase === "matchEnd") {
    if (ev.code === "Enter" && game.phase === "matchEnd") { hud.hide(document.getElementById("match-end")); game.restartMatch(); }
    return;
  }
  switch (ev.code) {
    case "KeyB":
      if (game.phase === "buy") hud.toggleBuyMenu();
      break;
    case "Tab":
      ev.preventDefault();
      hud.showScoreboard(game);
      break;
    case "Digit1": p.switchTo("primary"); refreshVM(); break;
    case "Digit2": p.switchTo("secondary"); refreshVM(); break;
    case "Digit3": p.nades.he > 0 && p.switchTo("nade:he"), refreshVM(); break;
    case "Digit4": p.nextNade(), refreshVM(); break;
    case "Digit5": p.nades.smoke > 0 && p.switchTo("nade:smoke"), refreshVM(); break;
    case "Digit6": p.nades.molotov > 0 && p.switchTo("nade:molotov"), refreshVM(); break;
    case "KeyQ": case "KeyX":
      p.switchTo(p.current === "primary" ? "secondary" : p.current === "secondary" ? "knife" : p.weapons.primary ? "primary" : "secondary");
      refreshVM();
      break;
    case "KeyR": p.weaponCtrl.startReload(); break;
    case "ControlLeft": case "KeyC": crouchToggled = !crouchToggled; break;
    case "Space": if (!p.alive) game.cycleSpectator(); break;
  }
});

window.addEventListener("keyup", (ev) => {
  keys.delete(ev.code);
  if (ev.code === "Tab") hud.hideScoreboard();
});

window.addEventListener("mousedown", (ev) => {
  AudioSys.ensure();
  if (game.phase === "menu" || game.phase === "matchEnd" || game.phase === "loading") return;
  if (!game.human?.alive) {
    game.cycleSpectator();
    return;
  }
  if (document.pointerLockElement === canvas) {
    if (ev.button === 0) { fireHeld = true; firePressed = true; }
    if (ev.button === 2) aimHeld = true;
  } else if (game.phase === "live") {
    game.requestLock();
  }
});

window.addEventListener("mouseup", (ev) => {
  if (ev.button === 0) fireHeld = false;
  if (ev.button === 2) aimHeld = false;
});

window.addEventListener("contextmenu", (ev) => ev.preventDefault());

window.addEventListener("mousemove", (ev) => {
  if (document.pointerLockElement === canvas) {
    mouseDX += ev.movementX * sens;
    mouseDY += ev.movementY * sens;
  }
});

window.addEventListener("wheel", (ev) => {
  const p = game.human;
  if (!p || !p.alive) return;
  const order = ["primary", "secondary", "knife", "nade:he", "nade:flash", "nade:smoke", "nade:molotov"];
  const cur = order.indexOf(p.current);
  const dir = ev.deltaY > 0 ? 1 : -1;
  for (let i = 1; i <= order.length; i++) {
    const idx = (cur + dir * i + order.length) % order.length;
    const slot = order[idx];
    if (slot === "primary" && !p.weapons.primary) continue;
    if (slot.startsWith("nade:") && !p.nades[slot.slice(5)]) continue;
    p.switchTo(slot);
    refreshVM();
    break;
  }
});

document.addEventListener("pointerlockchange", () => {
  const locked = document.pointerLockElement === canvas;
  if (!locked && (game.phase === "live" || game.phase === "buy") && !game.paused) {
    const buyOpen = !document.getElementById("buy-menu").classList.contains("hidden");
    const sbOpen = !document.getElementById("scoreboard").classList.contains("hidden");
    if (!buyOpen && !sbOpen) {
      game.setPaused(true);
      hud.showPause();
    }
  }
  if (locked) {
    game.setPaused(false);
    hud.hide(document.getElementById("pause-menu"));
  }
});

function refreshVM() {
  const p = game.human;
  if (p?.weaponCtrl) p.weaponCtrl.buildFor(p.weaponId());
}

canvas.addEventListener("click", () => {
  AudioSys.ensure();
  if (game.phase === "live" && game.human?.alive && !game.paused) game.requestLock();
});

// ---------------------------------------------------------------------------
// 主循环
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
const lastDX = { x: 0, z: 0 };

function buildInput(dt) {
  const p = game.human;
  const input = {
    moveDir: new THREE.Vector3(),
    jump: false,
    fire: false,
    firePressed: false,
    aim: false,
    walk: false,
    crouch: false,
    reload: false,
    use: false,
  };
  if (!p || !p.alive) return input;
  // 视角
  if (document.pointerLockElement === canvas) {
    const mx = mouseDX * 0.0022;
    const my = mouseDY * 0.0022;
    p.yaw -= mx;
    p.pitch -= my;
    p.pitch = Math.max(-1.5, Math.min(1.5, p.pitch));
    p.weaponCtrl.lookDeltaX += mx;
    p.weaponCtrl.lookDeltaY += my;
  }
  mouseDX = 0; mouseDY = 0;
  // 移动
  let mx = 0, mz = 0;
  if (keys.has("KeyW") || keys.has("ArrowUp")) mz -= 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) mz += 1;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) mx -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) mx += 1;
  const f = p.forward(), r = p.right();
  input.moveDir.set(
    r.x * mx + f.x * mz,
    0,
    r.z * mx + f.z * mz
  );
  if (input.moveDir.lengthSq() > 1) input.moveDir.normalize();
  input.jump = keys.has("Space");
  input.walk = keys.has("ShiftLeft") || keys.has("ShiftRight");
  input.crouch = crouchToggled;
  input.fire = fireHeld;
  input.firePressed = firePressed;
  firePressed = false;
  input.aim = aimHeld;
  input.reload = keys.has("KeyR");
  input.use = keys.has("KeyE");
  return input;
}

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  const input = buildInput(dt);
  game.update(dt, input);
  autoQuality(dt);
}

// 自适应画质：低帧率时逐步降低像素比/阴影
let qFrames = 0, qTime = 0, qStage = 0;
function autoQuality(dt) {
  qFrames++;
  qTime += dt;
  if (qTime < 2.5) return;
  const fps = qFrames / qTime;
  qFrames = 0; qTime = 0;
  if (fps < 34 && qStage === 0) {
    game.renderer.setPixelRatio(1);
    qStage = 1;
  } else if (fps < 28 && qStage === 1) {
    game.sun.shadow.mapSize.set(1024, 1024);
    qStage = 2;
  } else if (fps < 20 && qStage === 2) {
    game.renderer.shadowMap.enabled = false;
    qStage = 3;
  }
}

// 启动
AudioSys.ensure();
loop();

// 调试/测试钩子
window.__cz = {
  game, hud,
  V3: (x, y, z) => new THREE.Vector3(x, y, z),
  state() {
    return {
      phase: game.phase, timeLeft: game.timeLeft, phaseT: game.phaseT, score: game.score,
      round: game.round, bomb: game.bomb.state, paused: game.paused,
      stats: game.stats,
      players: game.players.map((p) => ({ name: p.name, team: p.team, alive: p.alive, hp: Math.round(p.hp), x: p.pos.x, z: p.pos.z })),
    };
  },
  // 无渲染快进模拟（测试用）
  step(dt) {
    simStep(game, dt);
  },
  stepN(dt, n) {
    for (let i = 0; i < n; i++) simStep(game, dt);
  },
};

function simStep(game, dt) {
  game.time += dt;
  if (game.phase === "buy") {
    game.phaseT -= dt;
    if (game.phaseT <= 0) game.phase = "live";
  } else if (game.phase === "live") {
    game.timeLeft -= dt;
    game.simulate(dt, {
      moveDir: new THREE.Vector3(), jump: false, fire: false, firePressed: false,
      aim: false, walk: false, crouch: false, reload: false, use: false,
    });
    game.updateBomb(dt);
    game.checkWin();
  } else if (game.phase === "end") {
    game.simulate(dt, null);
    game.phaseT -= dt;
    if (game.phaseT <= 0) {
      if (game.score.T >= game.settings.roundsWin || game.score.CT >= game.settings.roundsWin) {
        game.endMatch();
      } else game.startRound();
    }
  }
}
