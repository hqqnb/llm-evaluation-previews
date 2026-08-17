/**
 * 纯计算层：时区解析、指针角度、转盘角度、虚拟时钟。
 * 不依赖 DOM 或 Three.js，可在 Node 中直接单元测试。
 */

export const TAU = Math.PI * 2;

export const WEEKDAY_LABELS = {
  en: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
  zh: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
};

const formatterCache = new Map();

function getPartsFormatter(timeZone) {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
}

export function isValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * 把某个瞬间换算到指定时区，返回日历字段 + 该时刻的真实 UTC 偏移（自动处理夏令时）。
 * @param {Date|number} date
 * @param {string} timeZone IANA 时区名，如 "Asia/Shanghai"
 */
export function getZonedParts(date, timeZone) {
  const ms = typeof date === 'number' ? date : date.getTime();
  const parts = getPartsFormatter(timeZone).formatToParts(new Date(ms));
  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }

  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  const hour = Number(map.hour) % 24;
  const minute = Number(map.minute);
  const second = Number(map.second);
  const millisecond = ((ms % 1000) + 1000) % 1000;

  // 星期：用该时区的 Y/M/D 反推，避免受本机时区影响
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  const asUTC = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMinutes = Math.round((asUTC - (ms - millisecond)) / 60000);

  return { timeZone, year, month, day, hour, minute, second, millisecond, weekday, offsetMinutes };
}

/**
 * 指针角度（弧度，绕 +Z 轴）。0 = 指向 12 点，顺时针为负方向。
 * 时针/分针始终连续走时；秒针可选 sweep(平滑扫秒) / beat8(每秒 8 跳) / tick(每秒一跳)。
 */
export function computeHandAngles(parts, options = {}) {
  const mode = options.mode || 'sweep';
  const continuousSeconds = parts.second + parts.millisecond / 1000;

  let displaySeconds = continuousSeconds;
  if (mode === 'tick') displaySeconds = Math.floor(continuousSeconds);
  else if (mode === 'beat8') displaySeconds = Math.floor(continuousSeconds * 8) / 8;

  const minutes = parts.minute + continuousSeconds / 60;
  const hours12 = (parts.hour % 12) + minutes / 60;
  const hours24 = parts.hour + minutes / 60;

  return {
    second: -(displaySeconds / 60) * TAU,
    minute: -(minutes / 60) * TAU,
    hour: -(hours12 / 12) * TAU,
    hour24: -(hours24 / 24) * TAU,
  };
}

/**
 * 日期/星期转盘的目标转角：让第 index 个字符对齐视窗方向 windowAngle。
 */
export function discRotation(index, count, windowAngle) {
  return windowAngle - (index * TAU) / count;
}

export function shortestAngleDelta(from, to) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** 指数阻尼趋近，帧率无关；用于日期盘换日时的快速过渡 */
export function approachAngle(current, target, dt, lambda = 12) {
  const d = shortestAngleDelta(current, target);
  return current + d * (1 - Math.exp(-lambda * dt));
}

export function formatOffset(offsetMinutes) {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return `UTC${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/** 两个时区的时差，如 "+8:00" / "-4:30" / "0:00" */
export function formatOffsetDelta(offsetMinutesA, offsetMinutesB) {
  const diff = offsetMinutesB - offsetMinutesA;
  const sign = diff < 0 ? '-' : diff > 0 ? '+' : '';
  const abs = Math.abs(diff);
  return `${sign}${Math.floor(abs / 60)}:${pad2(abs % 60)}`;
}

export function formatDigital(parts) {
  return `${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`;
}

export function formatDate(parts, locale = 'en') {
  const wd = (WEEKDAY_LABELS[locale] || WEEKDAY_LABELS.en)[parts.weekday];
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)} ${wd}`;
}

/**
 * 虚拟时钟：默认就是真实时间；可用于测试（指定起点/加速倍率）。
 */
export function createVirtualClock(options = {}) {
  const speed = Number.isFinite(options.speed) && options.speed > 0 ? options.speed : 1;
  const monotonic =
    options.monotonic ||
    (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const hasStart = options.startMs !== undefined && options.startMs !== null;
  const realtime = speed === 1 && !hasStart;
  const startMs = hasStart ? Number(options.startMs) : Date.now();
  const t0 = monotonic();

  return {
    speed,
    isRealtime: realtime,
    nowMs() {
      return realtime ? Date.now() : startMs + (monotonic() - t0) * speed;
    },
    now() {
      return new Date(this.nowMs());
    },
  };
}
