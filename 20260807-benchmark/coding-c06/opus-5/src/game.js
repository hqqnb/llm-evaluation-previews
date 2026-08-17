import {
  MAX_POWER, CHARGE_TIME, GRAVITY,
  chargePower, aimAngle, launch, integrate, simulatePath,
  segmentPointDistance, segmentCircleHit, targetCenter, ringScore,
  formatTime, insertScore, rank,
} from './core.js';

const STORAGE_KEY = 'archery.leaderboard.v1';
const MAX_FLYING = 3;      // 同时在空中的箭数上限
const MAX_DEBRIS = 14;     // 保留的落地/命中箭矢数量

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;
const GROUND_Y = 470;
const BOW = { x: 120, y: 392 };

const TARGET_DEFS = [
  { x: 520, y: 372, r: 44, amp: 0,  axis: 'y', period: 1 },
  { x: 668, y: 250, r: 38, amp: 62, axis: 'y', period: 3.2 },
  { x: 792, y: 402, r: 32, amp: 0,  axis: 'y', period: 1 },
  { x: 872, y: 176, r: 28, amp: 46, axis: 'x', period: 2.6 },
];

const el = {
  time: document.getElementById('hud-time'),
  shots: document.getElementById('hud-shots'),
  hits: document.getElementById('hud-hits'),
  score: document.getElementById('hud-score'),
  power: document.getElementById('power-fill'),
  board: document.getElementById('board'),
  result: document.getElementById('result'),
  resultText: document.getElementById('result-text'),
  name: document.getElementById('player-name'),
  save: document.getElementById('save-score'),
  restart: document.getElementById('restart'),
  live: document.getElementById('live'),
};

let board = loadBoard();
let state;
let lastFrame = 0;

function loadBoard() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveBoard(next) {
  board = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* 隐私模式下忽略写入失败 */
  }
  renderBoard();
}

function renderBoard() {
  el.board.innerHTML = '';
  if (board.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '暂无成绩，快来创造纪录！';
    el.board.append(li);
    return;
  }
  board.forEach((entry, i) => {
    const li = document.createElement('li');
    li.innerHTML =
      `<span class="pos">${i + 1}</span>` +
      `<span class="who"></span>` +
      `<span class="t">${formatTime(entry.time)}</span>` +
      `<span class="sc">${entry.score ?? 0} 环</span>`;
    li.querySelector('.who').textContent = entry.name; // 防止 XSS
    el.board.append(li);
  });
}

function reset() {
  state = {
    phase: 'ready',           // ready | running | done
    elapsed: 0,               // 毫秒
    shots: 0,
    score: 0,
    arrows: [],
    targets: TARGET_DEFS.map((d, i) => ({ ...d, index: i, hit: false, ring: 0 })),
    aim: { angle: -0.45, pointer: null },
    holding: false,
    holdStart: 0,
    finalTime: null,
  };
  el.result.hidden = true;
  el.save.disabled = false;
  announce('准备就绪：按住鼠标或空格蓄力，松开发射。');
  updateHud();
}

function announce(msg) {
  el.live.textContent = msg;
}

function updateHud() {
  el.time.textContent = state.phase === 'ready' ? '0.00s' : formatTime(state.elapsed);
  el.shots.textContent = String(state.shots);
  el.hits.textContent = `${state.targets.filter((t) => t.hit).length}/4`;
  el.score.textContent = `${state.score} 环`;
}

/* ---------- 输入 ---------- */

function pointerPos(evt) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((evt.clientX - rect.left) / rect.width) * W,
    y: ((evt.clientY - rect.top) / rect.height) * H,
  };
}

function startHold() {
  if (state.phase === 'done' || state.holding) return;
  if (state.arrows.filter((a) => !a.stuck).length >= MAX_FLYING) return;
  state.holding = true;
  state.holdStart = performance.now();
}

function releaseHold() {
  if (!state.holding) return;
  const held = (performance.now() - state.holdStart) / 1000;
  state.holding = false;
  shoot(chargePower(held));
}

function shoot(power) {
  if (state.phase === 'ready') {
    state.phase = 'running';
    state.elapsed = 0;
  }
  if (state.phase !== 'running') return;
  const a = launch(BOW, state.aim.angle, power);
  state.arrows.push({ ...a, stuck: false, host: -1, ox: 0, oy: 0, angle: state.aim.angle });
  state.shots += 1;
  updateHud();
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  canvas.focus();
  state.aim.pointer = pointerPos(e);
  state.aim.angle = aimAngle(BOW, state.aim.pointer);
  startHold();
});
canvas.addEventListener('pointermove', (e) => {
  state.aim.pointer = pointerPos(e);
  state.aim.angle = aimAngle(BOW, state.aim.pointer);
});
window.addEventListener('pointerup', releaseHold);
canvas.addEventListener('pointerleave', releaseHold);

const keys = new Set();
canvas.addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    startHold();
    return;
  }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    e.preventDefault();
    keys.add(e.key);
  }
  if (e.key.toLowerCase() === 'r') reset();
});
canvas.addEventListener('keyup', (e) => {
  if (e.key === ' ' || e.key === 'Enter') releaseHold();
  keys.delete(e.key);
});

el.restart.addEventListener('click', () => {
  reset();
  canvas.focus();
});

el.save.addEventListener('click', () => {
  if (state.finalTime == null) return;
  const name = (el.name.value || '匿名弓手').trim().slice(0, 16);
  const entry = { name, time: state.finalTime, score: state.score, ts: Date.now() };
  saveBoard(insertScore(board, entry, 10));
  el.save.disabled = true;
  announce(`成绩已保存，第 ${rank(board, state.finalTime)} 名。`);
});

/* ---------- 更新 ---------- */

function step(dt) {
  // 键盘微调瞄准
  const rate = 1.1 * dt;
  if (keys.has('ArrowUp')) state.aim.angle -= rate;
  if (keys.has('ArrowDown')) state.aim.angle += rate;
  if (keys.has('ArrowLeft')) state.aim.angle -= rate * 0.4;
  if (keys.has('ArrowRight')) state.aim.angle += rate * 0.4;
  state.aim.angle = Math.max(-Math.PI / 2, Math.min(Math.PI / 3, state.aim.angle));

  if (state.phase === 'running') state.elapsed += dt * 1000;
  const t = state.elapsed / 1000;

  const sub = 1 / 240;
  let remain = dt;
  while (remain > 0) {
    const h = Math.min(sub, remain);
    remain -= h;
    for (const arrow of state.arrows) {
      if (arrow.stuck) continue;
      const prev = { x: arrow.x, y: arrow.y };
      const next = integrate(arrow, h);
      arrow.angle = Math.atan2(next.vy, next.vx);

      let landed = false;
      for (const target of state.targets) {
        if (target.hit) continue;
        const c = targetCenter(target, t);
        if (segmentCircleHit(prev, next, c, target.r)) {
          const d = segmentPointDistance(prev.x, prev.y, next.x, next.y, c.x, c.y);
          target.hit = true;
          target.ring = ringScore(d, target.r);
          state.score += target.ring;
          arrow.stuck = true;
          arrow.host = target.index;
          arrow.ox = next.x - c.x;
          arrow.oy = next.y - c.y;
          arrow.x = next.x;
          arrow.y = next.y;
          landed = true;
          announce(`命中第 ${target.index + 1} 个靶子，${target.ring} 环。`);
          break;
        }
      }
      if (landed) continue;

      if (next.y >= GROUND_Y) {
        arrow.stuck = true;
        arrow.x = next.x;
        arrow.y = GROUND_Y;
      } else {
        Object.assign(arrow, next);
      }
    }
  }

  // 清理越界与过多残留
  state.arrows = state.arrows.filter(
    (a) => a.stuck || (a.x < W + 120 && a.y < H + 200)
  );
  const debris = state.arrows.filter((a) => a.stuck);
  if (debris.length > MAX_DEBRIS) {
    const drop = new Set(debris.slice(0, debris.length - MAX_DEBRIS));
    state.arrows = state.arrows.filter((a) => !drop.has(a));
  }

  if (state.phase === 'running' && state.targets.every((tg) => tg.hit)) {
    state.phase = 'done';
    state.finalTime = state.elapsed;
    const place = rank(board, state.finalTime);
    el.resultText.textContent =
      `全部命中！用时 ${formatTime(state.finalTime)}，${state.shots} 箭，${state.score} 环。` +
      `当前可排第 ${place} 名。`;
    el.result.hidden = false;
    el.name.focus();
    announce(`完成！用时 ${formatTime(state.finalTime)}。`);
  }
  updateHud();
}

/* ---------- 渲染 ---------- */

function draw() {
  const t = state.elapsed / 1000;

  const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  sky.addColorStop(0, '#12213a');
  sky.addColorStop(1, '#2b4a6b');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, GROUND_Y);

  ctx.fillStyle = '#1d3524';
  ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
  ctx.strokeStyle = '#2f5c3a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y);
  ctx.lineTo(W, GROUND_Y);
  ctx.stroke();

  // 距离刻度
  ctx.fillStyle = 'rgba(255,255,255,.25)';
  ctx.font = '12px system-ui, sans-serif';
  for (let x = 200; x < W; x += 200) {
    ctx.fillRect(x, GROUND_Y, 1, 10);
    ctx.fillText(`${x - BOW.x}px`, x + 4, GROUND_Y + 20);
  }

  state.targets.forEach((target, i) => drawTarget(target, t, i));

  // 瞄准辅助线
  if (state.holding && state.phase !== 'done') {
    const held = (performance.now() - state.holdStart) / 1000;
    const power = chargePower(held);
    const path = simulatePath(BOW, state.aim.angle, power, {
      steps: 70, dt: 1 / 60, groundY: GROUND_Y,
    });
    ctx.fillStyle = 'rgba(255,225,140,.55)';
    path.forEach((p, i) => {
      if (i % 4) return;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    });
    el.power.style.width = `${(power / MAX_POWER) * 100}%`;
  } else {
    el.power.style.width = '0%';
  }

  drawArcher();
  state.arrows.forEach((a) => drawArrow(a, t));
}

function drawTarget(target, t, i) {
  const c = targetCenter(target, t);
  ctx.save();
  ctx.translate(c.x, c.y);
  // 支架
  ctx.strokeStyle = '#6b4a2a';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, target.r);
  ctx.lineTo(0, GROUND_Y - c.y);
  ctx.stroke();

  const rings = [
    [1, '#f4f4f4'], [0.7, '#1b2a3a'], [0.45, '#2f7fd0'], [0.2, '#e2483c'],
  ];
  rings.forEach(([k, color]) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, target.r * k, 0, Math.PI * 2);
    ctx.fill();
  });

  if (target.hit) {
    ctx.strokeStyle = '#7dffa0';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, target.r + 7, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(String(i + 1), 0, -target.r - 12);
  ctx.restore();
}

function drawArcher() {
  ctx.save();
  ctx.strokeStyle = '#e8e8e8';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(BOW.x - 10, GROUND_Y);
  ctx.lineTo(BOW.x - 10, BOW.y - 6);      // 身体
  ctx.moveTo(BOW.x - 10, GROUND_Y);
  ctx.lineTo(BOW.x - 26, GROUND_Y);       // 腿
  ctx.stroke();
  ctx.fillStyle = '#e8e8e8';
  ctx.beginPath();
  ctx.arc(BOW.x - 10, BOW.y - 16, 9, 0, Math.PI * 2);
  ctx.fill();

  // 弓随瞄准方向旋转
  ctx.translate(BOW.x, BOW.y);
  ctx.rotate(state.aim.angle);
  ctx.strokeStyle = '#d9a04a';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, 0, 26, -Math.PI / 2.2, Math.PI / 2.2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.7)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(26 * Math.cos(-Math.PI / 2.2), 26 * Math.sin(-Math.PI / 2.2));
  ctx.lineTo(state.holding ? -12 : -2, 0);
  ctx.lineTo(26 * Math.cos(Math.PI / 2.2), 26 * Math.sin(Math.PI / 2.2));
  ctx.stroke();
  ctx.restore();
}

function drawArrow(a, t) {
  let x = a.x;
  let y = a.y;
  if (a.stuck && a.host >= 0) {
    const c = targetCenter(state.targets[a.host], t);
    x = c.x + a.ox;
    y = c.y + a.oy;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a.angle);
  ctx.strokeStyle = '#f0e6d2';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-30, 0);
  ctx.lineTo(0, 0);
  ctx.stroke();
  ctx.fillStyle = '#ffd166';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-8, -4);
  ctx.lineTo(-8, 4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#8ecae6';
  ctx.beginPath();
  ctx.moveTo(-30, 0);
  ctx.lineTo(-38, -4);
  ctx.moveTo(-30, 0);
  ctx.lineTo(-38, 4);
  ctx.stroke();
  ctx.restore();
}

function frame(now) {
  const dt = Math.min(0.05, lastFrame ? (now - lastFrame) / 1000 : 0);
  lastFrame = now;
  step(dt);
  draw();
  requestAnimationFrame(frame);
}

reset();
renderBoard();
requestAnimationFrame(frame);
