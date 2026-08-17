// 纯逻辑模块：不依赖 DOM，可直接被 Node 测试
export const GRAVITY = 900;          // px/s^2
export const MAX_POWER = 1250;       // px/s
export const MIN_POWER_RATIO = 0.28; // 最小蓄力比例
export const CHARGE_TIME = 0.85;     // 秒，蓄满所需时间

/** 蓄力时长 -> 初速度（超过 CHARGE_TIME 后维持满力） */
export function chargePower(heldSeconds, maxPower = MAX_POWER) {
  const t = Math.max(0, Math.min(1, heldSeconds / CHARGE_TIME));
  return maxPower * (MIN_POWER_RATIO + (1 - MIN_POWER_RATIO) * t);
}

/** 从弓位指向准星的角度（canvas 坐标系，y 向下） */
export function aimAngle(bow, pointer) {
  return Math.atan2(pointer.y - bow.y, pointer.x - bow.x);
}

/** 生成一支箭的初始状态 */
export function launch(origin, angle, power) {
  return {
    x: origin.x,
    y: origin.y,
    vx: Math.cos(angle) * power,
    vy: Math.sin(angle) * power,
  };
}

/** 显式欧拉积分一步（返回新对象，便于做线段碰撞） */
export function integrate(arrow, dt, gravity = GRAVITY) {
  return {
    x: arrow.x + arrow.vx * dt,
    y: arrow.y + arrow.vy * dt,
    vx: arrow.vx,
    vy: arrow.vy + gravity * dt,
  };
}

/** 预测弹道，用于瞄准辅助线，也便于测试 */
export function simulatePath(origin, angle, power, opts = {}) {
  const { steps = 90, dt = 1 / 60, groundY = Infinity, gravity = GRAVITY } = opts;
  let a = launch(origin, angle, power);
  const pts = [{ x: a.x, y: a.y }];
  for (let i = 0; i < steps; i++) {
    a = integrate(a, dt, gravity);
    pts.push({ x: a.x, y: a.y });
    if (a.y >= groundY) break;
  }
  return pts;
}

/** 点到线段的最短距离：避免高速箭矢“穿透”靶子 */
export function segmentPointDistance(ax, ay, bx, by, px, py) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

export function segmentCircleHit(a, b, center, radius) {
  return segmentPointDistance(a.x, a.y, b.x, b.y, center.x, center.y) <= radius;
}

/** 靶心随时间做确定性往复运动：所有玩家条件一致，排行榜可比 */
export function targetCenter(target, t) {
  if (!target.amp) return { x: target.x, y: target.y };
  const off = Math.sin((2 * Math.PI * t) / target.period) * target.amp;
  return target.axis === 'x'
    ? { x: target.x + off, y: target.y }
    : { x: target.x, y: target.y + off };
}

/** 环数（仅作展示，排名只看时间） */
export function ringScore(distance, radius) {
  const r = distance / radius;
  if (r <= 0.2) return 10;
  if (r <= 0.45) return 8;
  if (r <= 0.7) return 5;
  if (r <= 1) return 2;
  return 0;
}

export function formatTime(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '--';
  const total = ms / 1000;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return m > 0
    ? `${m}:${s.toFixed(2).padStart(5, '0')}`
    : `${s.toFixed(2)}s`;
}

/** 插入成绩：按用时升序，同分先到先得，截断到 limit */
export function insertScore(board, entry, limit = 10) {
  const next = [...board, entry].sort(
    (a, b) => a.time - b.time || (a.ts ?? 0) - (b.ts ?? 0)
  );
  return next.slice(0, limit);
}

/** 该用时在榜单中的名次（1 起） */
export function rank(board, time) {
  return board.filter((e) => e.time < time).length + 1;
}
