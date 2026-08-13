/**
 * WatchCore — 纯逻辑层（UMD，浏览器与 Node 通用，无 DOM 依赖）。
 *
 * 职责：时区列表、墙钟时间分解、时区偏移、指针角度、日期/星期标签、
 * 最短角差与缓动、仿真时钟锚点。渲染层只消费这里的纯函数，因此可以
 * 在不启动浏览器的情况下做自动化测试。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.WatchCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MS_PER_SECOND = 1000;
  var MS_PER_MINUTE = 60 * MS_PER_SECOND;
  var MS_PER_HOUR = 60 * MS_PER_MINUTE;
  var MS_PER_DAY = 24 * MS_PER_HOUR;
  var DAYS_PER_400_YEARS = 146097; // 格里高利历每 400 年周期的精确天数
  var MS_PER_400_YEARS = DAYS_PER_400_YEARS * MS_PER_DAY;

  var DEG_PER_HOUR = 30;
  var DEG_PER_MINUTE = 6;
  var DEG_PER_SECOND = 6;

  var FALLBACK_TIME_ZONES = [
    'UTC',
    'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Seoul', 'Asia/Kolkata',
    'Asia/Dubai', 'Asia/Singapore', 'Asia/Bangkok',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow',
    'Africa/Cairo', 'Africa/Johannesburg',
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Sao_Paulo', 'America/Mexico_City', 'America/Anchorage',
    'Australia/Sydney', 'Australia/Perth', 'Pacific/Auckland', 'Pacific/Honolulu'
  ];

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /**
   * 可用的 IANA 时区列表。优先使用 Intl.supportedValuesOf，
   * 不可用时回退到一个常见时区集合。
   * 注意：部分运行时的 supportedValuesOf 返回值不含 "UTC"，这里统一保证其存在。
   */
  function listTimeZones() {
    if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
      try {
        var zones = Intl.supportedValuesOf('timeZone');
        if (zones && zones.length) return ensureUTC(zones.slice());
      } catch (err) {
        /* 回退 */
      }
    }
    return ensureUTC(FALLBACK_TIME_ZONES.slice());
  }

  function ensureUTC(zones) {
    var idx = zones.indexOf('UTC');
    if (idx > 0) zones.splice(idx, 1);
    if (idx !== 0) zones.unshift('UTC');
    return zones;
  }

  var wallFormatterCache = Object.create(null);
  function wallFormatter(timeZone) {
    var key = timeZone || 'UTC';
    if (!wallFormatterCache[key]) {
      wallFormatterCache[key] = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
        timeZone: key,
        hourCycle: 'h23',
        era: 'short',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3
      });
    }
    return wallFormatterCache[key];
  }

  /**
   * 把某个绝对时刻（epoch ms）换算成指定时区的墙钟字段。
   * weekday 采用 0=周日 … 6=周六，与 Date#getDay 一致。
   */
  function getWallParts(epochMs, timeZone) {
    var parts = Object.create(null);
    var list = wallFormatter(timeZone).formatToParts(new Date(epochMs));
    for (var i = 0; i < list.length; i++) {
      var part = list[i];
      if (part.type !== 'literal') parts[part.type] = part.value;
    }
    var year = parseInt(parts.year, 10);
    var month = parseInt(parts.month, 10);
    var day = parseInt(parts.day, 10);
    var hour = parseInt(parts.hour, 10);
    var minute = parseInt(parts.minute, 10);
    var second = parseInt(parts.second, 10);
    var millisecond = parts.fractionalSecond !== undefined
      ? parseInt(parts.fractionalSecond, 10)
      : ((epochMs % 1000) + 1000) % 1000;
    // 星期由墙钟日期独立计算，避免受语言区域/格式化器影响
    var weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return {
      year: year,
      month: month,
      day: day,
      hour: hour,
      minute: minute,
      second: second,
      millisecond: millisecond,
      weekday: weekday,
      era: parts.era || ''
    };
  }

  /**
   * 指定时区在给定时刻相对 UTC 的偏移（毫秒），东区为正。
   * 用 +400 年规避 Date.UTC 对 0–99 年份的特殊解释（400 年周期天数恒定）。
   */
  function getZoneOffsetMs(epochMs, timeZone) {
    var p = getWallParts(epochMs, timeZone);
    var wallAsUTC = Date.UTC(
      p.year + 400, p.month - 1, p.day, p.hour, p.minute, p.second, p.millisecond
    ) - MS_PER_400_YEARS;
    return wallAsUTC - epochMs;
  }

  /**
   * 由墙钟时间直接计算三根指针的角度（度，顺时针，0=12 点方向）。
   * 秒/分/时全部连续，秒针包含毫秒分量，因此呈现无跳动的平滑扫动。
   */
  function getHandAngles(epochMs, timeZone) {
    var p = getWallParts(epochMs, timeZone);
    var secondFrac = p.second + p.millisecond / 1000;
    var minuteFrac = p.minute + secondFrac / 60;
    var hour12 = p.hour % 12;
    return {
      second: secondFrac * DEG_PER_SECOND,
      minute: minuteFrac * DEG_PER_MINUTE,
      hour: (hour12 + minuteFrac / 60) * DEG_PER_HOUR,
      hour12: hour12,
      minuteOfHour: p.minute,
      secondOfMinute: p.second,
      isPM: p.hour >= 12,
      wallParts: p
    };
  }

  var labelFormatterCache = Object.create(null);
  function labelFormatter(kind, locale, timeZone) {
    var key = kind + '|' + (locale || 'en') + '|' + (timeZone || 'UTC');
    if (!labelFormatterCache[key]) {
      var options = { timeZone: timeZone };
      if (kind === 'weekdayShort') options.weekday = 'short';
      else if (kind === 'weekdayLong') options.weekday = 'long';
      else if (kind === 'monthShort') options.month = 'short';
      else if (kind === 'zoneShort') options.timeZoneName = 'short';
      labelFormatterCache[key] = new Intl.DateTimeFormat(locale, options);
    }
    return labelFormatterCache[key];
  }

  /**
   * 日期与星期标签。dateKey 形如 "2026-08-13"，可用于判断是否跨天。
   */
  function getDateInfo(epochMs, timeZone, locale) {
    var p = getWallParts(epochMs, timeZone);
    var d = new Date(epochMs);
    return {
      dayLabel: String(p.day),
      dayNumber: p.day,
      weekdayShort: labelFormatter('weekdayShort', locale, timeZone).format(d),
      weekdayLong: labelFormatter('weekdayLong', locale, timeZone).format(d),
      monthName: labelFormatter('monthShort', locale, timeZone).format(d),
      dateKey: p.year + '-' + pad2(p.month) + '-' + pad2(p.day),
      year: p.year,
      month: p.month,
      day: p.day,
      weekday: p.weekday
    };
  }

  /** 数字时钟字符串 "HH:mm:ss"（24 小时制）。 */
  function formatClock(epochMs, timeZone) {
    var p = getWallParts(epochMs, timeZone);
    return pad2(p.hour) + ':' + pad2(p.minute) + ':' + pad2(p.second);
  }

  /** 时区短标签，如 "GMT+8"、"UTC"、"GMT-4"。 */
  function getZoneLabel(timeZone, locale) {
    try {
      var parts = labelFormatter('zoneShort', locale || 'zh-CN', timeZone)
        .formatToParts(new Date());
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].type === 'timeZoneName') return parts[i].value;
      }
    } catch (err) {
      /* 回退 */
    }
    return timeZone;
  }

  /** 数值化偏移标签，如 "UTC+08:00"，适合数字面板展示。 */
  function getZoneOffsetLabel(epochMs, timeZone) {
    var off = getZoneOffsetMs(epochMs, timeZone);
    if (off === 0) return 'UTC±00:00';
    var sign = off > 0 ? '+' : '-';
    var abs = Math.abs(off);
    var hours = Math.floor(abs / MS_PER_HOUR);
    var minutes = Math.round((abs % MS_PER_HOUR) / MS_PER_MINUTE);
    if (minutes === 60) {
      hours += 1;
      minutes = 0;
    }
    return 'UTC' + sign + pad2(hours) + ':' + pad2(minutes);
  }

  /** 两角度间的最短角差，范围 (-180, 180]，始终走最短路径。 */
  function shortestAngleDelta(fromDeg, toDeg) {
    var delta = (toDeg - fromDeg) % 360;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    return delta;
  }

  /** 三次缓入缓出，t 会被钳制到 [0,1]。 */
  function easeInOutCubic(t) {
    t = Math.min(1, Math.max(0, t));
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  /**
   * 仿真时钟锚点：以真实时间 realMs 为基准，以 speed 倍速推进模拟时间。
   * speed<=0 视为暂停（冻结当前模拟时间）。
   */
  function createAnchor(realMs, simMs) {
    return { realMs: realMs, simMs: simMs };
  }

  function advance(anchor, realMs, speed) {
    if (!(speed > 0)) return anchor.simMs;
    return anchor.simMs + (realMs - anchor.realMs) * speed;
  }

  function reAnchor(anchor, realMs, simMs) {
    anchor.realMs = realMs;
    anchor.simMs = simMs;
    return anchor;
  }

  return {
    MS_PER_SECOND: MS_PER_SECOND,
    MS_PER_MINUTE: MS_PER_MINUTE,
    MS_PER_HOUR: MS_PER_HOUR,
    MS_PER_DAY: MS_PER_DAY,
    FALLBACK_TIME_ZONES: FALLBACK_TIME_ZONES,
    listTimeZones: listTimeZones,
    getWallParts: getWallParts,
    getZoneOffsetMs: getZoneOffsetMs,
    getHandAngles: getHandAngles,
    getDateInfo: getDateInfo,
    formatClock: formatClock,
    getZoneLabel: getZoneLabel,
    getZoneOffsetLabel: getZoneOffsetLabel,
    shortestAngleDelta: shortestAngleDelta,
    easeInOutCubic: easeInOutCubic,
    createAnchor: createAnchor,
    advance: advance,
    reAnchor: reAnchor
  };
});
