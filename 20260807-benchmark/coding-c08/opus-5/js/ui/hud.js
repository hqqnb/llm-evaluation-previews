// ============================================================================
// ui/hud.js — the complete in-game HUD (health, ammo, timer, killfeed, scope,
// overlays, scoreboard).  One DOM subtree, built inside the element handed to
// the constructor.  Nothing touches `document` at module scope so the file can
// be imported under Node (the automated tests do exactly that).
//
// All animation lives in css/hud.css; this file only toggles classes and
// writes a handful of inline values (crosshair geometry, bar widths, opacity).
//
// Public API used by the integrator:
//   attach(game) detach() update(dt, game) dispose()
//   killfeed({killer,victim,weapon,headshot,teamKill,penetrated})
//   banner(title, sub, ms, kind)  hitmarker(dmg, headshot, kill)
//   damageFrom(angleRad, amount)  setFlash(v)  subtitle(text, ms)
//   progress(label, t, opts)  prompt(text)  defusePrompt(text)  toast(text)
//   setCrosshair(cfg)  setScope(level)  setVisible(bool)
//   showDeath(info)  hideDeath()  showScoreboard(bool)  bombIndicator(on)
//   get radarSlot  -> the empty 200x200 #hud-radar div another module fills
// ============================================================================

import {
  TEAM, TEAM_LABEL, PHASE, CFG, DIFFICULTY, HITBOX_LABEL, ROUND, PLAYER,
} from '../core/constants.js';
import { RADIO } from '../core/api.js';
import { fmtTime, fmtMoney, clamp, clamp01, Rolling, angleWrap, DEG } from '../core/util.js';

// --- tiny DOM helpers ------------------------------------------------------
/** createElement + className + textContent in one call. */
function el(tag, cls, txt) {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (txt != null) d.textContent = txt;
  return d;
}
/** Write text only when it actually changed (avoids per-frame layout churn). */
function setText(n, v) {
  const s = v == null ? '' : String(v);
  if (n.__t !== s) { n.__t = s; n.textContent = s; }
}
function setCls(n, c, on) { n.classList.toggle(c, !!on); }
/** Cached inline style write. */
function setStyle(n, k, v) {
  const key = '__s_' + k;
  if (n[key] !== v) { n[key] = v; n.style[k] = v; }
}
/** Cached innerHTML write (used only for the authored inline SVG icons). */
function setHTML(n, h) { if (n.__h !== h) { n.__h = h; n.innerHTML = h; } }
/** Restart a CSS animation on a persistent node. */
function restart(n, cls) { n.classList.remove(cls); void n.offsetWidth; n.classList.add(cls); }

// --- authored inline SVG icon set (no external assets) ---------------------
const SVG = (body, w = 24, h = 24) =>
  `<svg class="hud-svg" viewBox="0 0 ${w} ${h}" width="100%" height="100%"` +
  ` preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">` +
  `<g fill="currentColor">${body}</g></svg>`;

const ICON = {
  // weapon families (killfeed + team list + equipment strip)
  rifle: SVG('<path d="M1 10.1h4.3v2.5H1z"/><path d="M4.7 8.7h9.5v3.9H4.7z"/>' +
    '<path d="M8.3 12.6h2.9l-.7 4.9H8.8z"/><path d="M14 9.9h8.9v1.7H14z"/>' +
    '<path d="M20.3 8.3h1.3v1.7h-1.3z"/><path d="M5.7 12.6h1.7v2.5H5.7z"/>'),
  smg: SVG('<path d="M2 9.5h3.3v2.7H2z"/><path d="M5 8.6h8.1v3.7H5z"/>' +
    '<path d="M9.7 12.3h2.3v4.4H9.7z"/><path d="M13 9.7h6.6v1.6H13z"/>' +
    '<path d="M6.1 12.3h1.6v2.3H6.1z"/>'),
  pistol: SVG('<path d="M6 8.5h11.2v3.3H6z"/><path d="M6 11.8h3.5l1.7 5.6H7.5z"/>' +
    '<path d="M15.1 11.8h1.9v1.7h-1.9z"/><path d="M10.9 11.8h3.1v1.1h-3.1z"/>'),
  sniper: SVG('<path d="M1 10.5h4v2.7H1z"/><path d="M4 9.3h8.7v3.5H4z"/>' +
    '<path d="M6.5 6.6h6.6v2H6.5z"/><path d="M5.6 7.4h1.2v2.1H5.6z"/>' +
    '<path d="M12.3 7.4h1.2v2.1h-1.2z"/><path d="M12.4 10.4h10.4v1.6H12.4z"/>' +
    '<path d="M8.5 12.8h2.3v3.7H8.5z"/>'),
  shotgun: SVG('<path d="M1 10.3h4.2v2.7H1z"/><path d="M4.4 9.5h7v3.3h-7z"/>' +
    '<path d="M11 10h11.8v1.6H11z"/><path d="M11.4 11.7h4.7v1.9h-4.7z"/>' +
    '<path d="M6 12.8h1.7v2.3H6z"/>'),
  lmg: SVG('<path d="M1 9.7h3.7v2.7H1z"/><path d="M4.3 8.5h9.1v3.9H4.3z"/>' +
    '<path d="M7 12.4h5.5v4.5H7z"/><path d="M13 9.6h9.7v1.7H13z"/>' +
    '<path d="M5 12.4h1.7v2.3H5z"/>'),
  knife: SVG('<path d="M20.8 3.1l-9.5 9.5 2.1 2.1 8.5-9.7z"/>' +
    '<path d="M10.4 13.5l-6.9 6.9 2.2 2.2 6.9-6.9z"/>' +
    '<path d="M9.5 12.7l3.9 3.9-1.2 1.2-3.9-3.9z"/>'),
  grenade: SVG('<path d="M9 3.9h6v2.4H9z"/><path d="M15 4.5h3.3v1.5H15z"/>' +
    '<path d="M12 6.1c3.6 0 6.5 3 6.5 6.7S15.6 20 12 20s-6.5-3-6.5-7.2S8.4 6.1 12 6.1z"/>'),
  c4: SVG('<path fill="none" stroke="currentColor" stroke-width="1.7" d="M4 7.4h16v9.9H4z"/>' +
    '<path d="M6.2 9.5h4.8v5.7H6.2z"/><path d="M12.4 9.6h5.5v1.6h-5.5z"/>' +
    '<path d="M12.4 12.2h5.5v1.5h-5.5z"/><path d="M11.3 3.3h1.4v3.7h-1.4z"/>'),
  world: SVG('<path d="M12 2l2.2 5.2L19.6 4l-1.8 5.7L23 12l-5.2 2.3L19.6 20l-5.4-3.2L12 22' +
    'l-2.2-5.2L4.4 20l1.8-5.7L1 12l5.2-2.3L4.4 4l5.4 3.2z"/>'),
};

// grenade sub-types, gear and small markers
Object.assign(ICON, {
  he: ICON.grenade,
  flash: SVG('<path d="M9.4 4.6h5.2v2.2H9.4z"/>' +
    '<path d="M8.5 6.8h7c1 2.7 1.6 4.8 1.6 6.9 0 3.1-2.3 5.7-5.1 5.7s-5.1-2.6-5.1-5.7c0-2.1.6-4.2 1.6-6.9z"/>' +
    '<path d="M2.6 9.4l2.6 1-.5 1.6-2.6-1z"/><path d="M21.4 9.4l-2.6 1 .5 1.6 2.6-1z"/>'),
  smoke: SVG('<path d="M8.8 4.4h6.4v2.3H8.8z"/>' +
    '<path d="M8 6.9h8v8.6a4 4 0 0 1-8 0z"/><circle cx="18.6" cy="6.2" r="2.3"/>' +
    '<circle cx="4.8" cy="17.6" r="1.7"/>'),
  molotov: SVG('<path d="M9.7 6.4c0-.7 1-1.1 1-1.9h2.9c0 .8 1 1.2 1 1.9v10.9a2.5 2.5 0 0 1-2.5 2.5h-.4' +
    'a2.5 2.5 0 0 1-2.5-2.5z"/><path d="M10.7 2.2h2.8v2.2h-2.8z"/>' +
    '<path d="M16.6 2c1.7 1.3 2.1 2.7 1 4.2-1 1.2-1 2 .1 2.7-2.3.2-3.4-1.3-2.7-3.1.3-1 .9-2.1 1.6-3.8z"/>'),
  incendiary: SVG('<path d="M9 3.9h6v2.4H9z"/>' +
    '<path d="M12 6.1c3.6 0 6.5 3 6.5 6.7S15.6 20 12 20s-6.5-3-6.5-7.2S8.4 6.1 12 6.1z"/>' +
    '<path d="M15.9 1.9c1.6 1.3 2 2.7.9 4.1-.9 1.2-.9 2 .2 2.7-2.3.2-3.4-1.3-2.7-3.1.3-1 .9-2 1.6-3.7z"/>'),
  decoy: SVG('<path d="M9 3.9h6v2.4H9z"/><path d="M16.6 2.4h1.4v4.2h-1.4z"/>' +
    '<path d="M12 6.1c3.6 0 6.5 3 6.5 6.7S15.6 20 12 20s-6.5-3-6.5-7.2S8.4 6.1 12 6.1z"/>'),
  kit: SVG('<path d="M3 4.1l1.9-1.7 7.5 8.8-1.7 1.9z"/><path d="M19.5 2.4l1.8 1.7-7.7 9-1.7-1.9z"/>' +
    '<path d="M9.4 12.5h2v8.4h-2z"/><path d="M12.8 12.5h2v8.4h-2z"/>'),
  armor: SVG('<path d="M12 2.4l8.2 2.9v6.3c0 4.9-3.4 8.4-8.2 10-4.8-1.6-8.2-5.1-8.2-10V5.3z"/>'),
  helmet: SVG('<path d="M3.4 15.6a8.6 8.6 0 0 1 17.2 0z"/><path d="M2.4 16.6h19.2v2.2H2.4z"/>'),
  health: SVG('<path d="M9.3 2.8h5.4v6.5h6.5v5.4h-6.5v6.5H9.3v-6.5H2.8V9.3h6.5z"/>'),
  hs: SVG('<circle cx="14.6" cy="9.2" r="5" fill="none" stroke="currentColor" stroke-width="2.1"/>' +
    '<path d="M1.6 8.3h7.2v1.9H1.6z"/><path d="M8.4 6.4l3.6 2.8-3.6 2.8z"/>'),
  wall: SVG('<path d="M4 3.4h4.6v6H4z"/><path d="M4 14.6h4.6v6H4z"/>' +
    '<path d="M15.4 3.4H20v6h-4.6z"/><path d="M15.4 14.6H20v6h-4.6z"/>' +
    '<path d="M2 11h15v2H2z"/><path d="M16.2 8.4L22.4 12l-6.2 3.6z"/>'),
  star: SVG('<path d="M12 2.4l2.9 6.1 6.7.9-4.9 4.8 1.2 6.6L12 17.5 6.1 20.8l1.2-6.6L2.4 9.4l6.7-.9z"/>'),
  bomb: SVG('<circle cx="10.6" cy="14.2" r="7.1"/><path d="M14.9 6l2.1-2.1 1.5 1.5-2.1 2.1z"/>' +
    '<path d="M18.4 2h1.6v3.6h-1.6z"/><path d="M20.6 5.4h3.1V7h-3.1z"/>'),
  arrow: SVG('<path d="M12 2.2l7.6 17.2-7.6-4.3-7.6 4.3z"/>'),
});

// --- display tables (local to the HUD; no dependency on weapons.js) --------
const WEAPON_NAME = {
  knife: '匕首', c4: 'C4 炸弹',
  glock: 'GLOCK-18', usp: 'USP-S', p250: 'P250', deagle: '沙漠之鹰', tec9: 'TEC-9',
  fiveseven: 'FIVE-SEVEN', dualies: '双持贝瑞塔',
  mac10: 'MAC-10', mp9: 'MP9', mp5: 'MP5-SD', ump45: 'UMP-45', p90: 'P90',
  galil: '加利尔 AR', famas: '法玛斯', ak47: 'AK-47', m4a4: 'M4A4', m4a1s: 'M4A1-S',
  aug: 'AUG', sg553: 'SG 553', ssg08: 'SSG 08', awp: 'AWP',
  nova: 'NOVA', xm1014: 'XM1014', mag7: 'MAG-7', negev: 'NEGEV',
  he: '高爆手雷', flash: '闪光弹', smoke: '烟雾弹', molotov: '燃烧瓶',
  incendiary: '燃烧弹', decoy: '诱饵弹',
  kevlar: '防弹衣', kevlarhelmet: '防弹衣 + 头盔', defusekit: '拆弹器',
  world: '环境', fall: '坠落', bomb: '炸弹', explosion: '爆炸', suicide: '自杀',
};
const WEAPON_CAT = {
  knife: 'knife', c4: 'c4',
  glock: 'pistol', usp: 'pistol', p250: 'pistol', deagle: 'pistol', tec9: 'pistol',
  fiveseven: 'pistol', dualies: 'pistol',
  mac10: 'smg', mp9: 'smg', mp5: 'smg', ump45: 'smg', p90: 'smg',
  galil: 'rifle', famas: 'rifle', ak47: 'rifle', m4a4: 'rifle', m4a1s: 'rifle',
  aug: 'rifle', sg553: 'rifle', ssg08: 'sniper', awp: 'sniper',
  nova: 'shotgun', xm1014: 'shotgun', mag7: 'shotgun', negev: 'lmg',
  he: 'grenade', flash: 'grenade', smoke: 'grenade', molotov: 'grenade',
  incendiary: 'grenade', decoy: 'grenade',
};
const NADE_ICON = { he: 'he', flash: 'flash', smoke: 'smoke', molotov: 'molotov', incendiary: 'incendiary', decoy: 'decoy' };
const SHOTGUN_MAG = { nova: 8, xm1014: 7, mag7: 5 };
/** Round-end reasons -> Chinese. Unknown ids fall through to a neutral line. */
const REASON_TEXT = {
  bomb: '炸弹爆炸', explode: '炸弹爆炸', bomb_explode: '炸弹爆炸', detonate: '炸弹爆炸',
  defuse: '炸弹被拆除', defused: '炸弹被拆除',
  elimination: '全员被淘汰', kills: '全员被淘汰', wipe: '全员被淘汰',
  timeout: '时间耗尽', time: '时间耗尽', saved: '成功守点',
  surrender: '对手投降', draw: '双方平局',
};
const MODE_TEXT = { auto: '全自动', single: '单发', burst: '三连发', bolt: '栓动', pump: '泵动', semi: '半自动' };
const SPEC_TEXT = { follow: '跟随视角', eye: '第一人称', free: '自由视角', chase: '追踪视角' };
const FALLBACK_PING = { easy: 78, normal: 54, hard: 33, expert: 17 };

/** Normalise whatever the game passes as a weapon into {id,name,cat,svg}. */
function weaponInfo(w) {
  let id = '', def = null;
  if (typeof w === 'string') id = w;
  else if (w && typeof w === 'object') {
    def = w.def || null;
    id = w.id || (def && def.id) || '';
    if (!id && typeof w.name === 'string') id = w.name;
    if (!def && (w.cat || w.category || w.cn)) def = w;
  }
  id = String(id || '').toLowerCase();
  const cat = WEAPON_CAT[id] || (def && (def.cat || def.category)) || 'world';
  const name = WEAPON_NAME[id] || (def && (def.cn || def.name)) || (id ? id.toUpperCase() : '未知');
  const key = cat === 'grenade' ? (NADE_ICON[id] || 'grenade') : cat;
  return { id, name, cat, svg: ICON[key] || ICON.world };
}

/** Normalise an actor-ish value (actor | name string | {name,team}). */
function whoInfo(x) {
  if (x == null) return { name: '', team: null, id: null };
  if (typeof x === 'string') return { name: x, team: null, id: null };
  return { name: x.name || '玩家', team: x.team === TEAM.CT ? TEAM.CT : (x.team === TEAM.T ? TEAM.T : null), id: x.id != null ? x.id : null };
}

// ============================================================================
export class HUD {
  /**
   * @param {HTMLElement} root  container the HUD fills (positioned by base.css)
   * @param {Object} cfg        settings object (CFG shape); copied, not kept
   */
  constructor(root, cfg) {
    if (!root) throw new Error('HUD: root element required');
    this.root = root;
    this.cfg = Object.assign({}, CFG, cfg || {});
    this.game = null;
    this.t = 0;                     // HUD clock, advanced by update(dt)
    this._off = [];                 // bus unsubscribe fns
    this._timers = [];              // {at, fn} processed in update()
    this._kf = [];                  // killfeed rows {el, at}
    this._subs = [];                // subtitle rows {el, at}
    this._dmg = [];                 // floating damage numbers {el, at}
    this._toasts = [];              // toast rows {el, at}
    this._teamRows = new Map();     // actor id -> row refs
    this._pips = { T: [], CT: [] };
    this._shells = [];
    this._flash = 0;
    this._arc = [0, 0, 0, 0];       // front, right, back, left intensity
    this._fpsAvg = new Rolling(45);
    this._sbOpen = false;
    this._sbAt = -1;
    this._progHold = 0;
    this._scope = 0;
    this._visible = true;
    this._death = null;
    this._bombArrow = false;
    this._money = null;
    this._chKey = '';
    this._equipSig = '';
    this._teamSig = '';
    this._phase = null;
    this._lowHp = 0;
    this.ch = {
      color: this.cfg.crosshairColor || '#39ff7a',
      size: this.cfg.crosshairSize || 7,
      gap: this.cfg.crosshairGap != null ? this.cfg.crosshairGap : 4,
      thickness: this.cfg.crosshairThickness || 2,
      dot: !!this.cfg.crosshairDot,
      dynamic: this.cfg.crosshairDynamic !== false,
    };
    this._build();
  }

  /** Build the whole tree. Called once, from the constructor. */
  _build() {
    const r = this.root;
    r.classList.add('hud-root');
    // top-left: the reserved radar rectangle another module draws into
    this.elRadar = el('div', 'hud-radar');
    this.elRadar.id = 'hud-radar';
    r.appendChild(this.elRadar);
    this._buildTop();
    this._buildRight();
    this._buildTeam();
    this._buildBottomLeft();
    this._buildBottomRight();
    this._buildCenter();
    this._buildOverlays();
    this._buildScoreboard();
  }

  /** The empty 200x200 slot ui/radar.js fills. */
  get radarSlot() { return this.elRadar; }

  _buildTop() {
    const wrap = el('div', 'hud-top');
    const score = el('div', 'hud-score');
    this.elScoreTNum = el('span', 'hud-side-num', '0');
    this.elScoreCTNum = el('span', 'hud-side-num', '0');
    const tSide = el('div', 'hud-score-side hud-side-t');
    tSide.append(el('span', 'hud-side-tag', 'T'), this.elScoreTNum);
    const ctSide = el('div', 'hud-score-side hud-side-ct');
    ctSide.append(this.elScoreCTNum, el('span', 'hud-side-tag', 'CT'));
    const clock = el('div', 'hud-clock');
    const row = el('div', 'hud-timer-row');
    this.elBeep = el('span', 'hud-beep');
    this.elTimer = el('span', 'hud-timer', '0:00');
    row.append(this.elBeep, this.elTimer);
    this.elRound = el('div', 'hud-round', '第 1 回合');
    clock.append(row, this.elRound);
    score.append(tSide, clock, ctSide);
    const pips = el('div', 'hud-pips');
    this.elPipsT = el('div', 'hud-pips-row hud-pips-t');
    this.elPipsCT = el('div', 'hud-pips-row hud-pips-ct');
    pips.append(this.elPipsT, this.elPipsCT);
    this.elPhase = el('div', 'hud-phase', '');
    wrap.append(score, pips, this.elPhase);
    this.root.appendChild(wrap);
    this.elTop = wrap;
  }

  _buildRight() {
    const col = el('div', 'hud-topright');
    this.elStats = el('div', 'hud-stats', '');
    this.elSubs = el('div', 'hud-subs');      // radio / subtitle lines
    this.elKF = el('div', 'hud-killfeed');
    col.append(this.elStats, this.elSubs, this.elKF);
    this.root.appendChild(col);
    this.elRight = col;
  }

  _buildTeam() {
    const box = el('div', 'hud-team');
    this.elTeamTitle = el('div', 'hud-team-title', '小队');
    this.elTeamList = el('div', 'hud-team-list');
    box.append(this.elTeamTitle, this.elTeamList);
    this.root.appendChild(box);
    this.elTeamBox = box;
  }

  _buildBottomLeft() {
    const box = el('div', 'hud-bl');
    const vit = el('div', 'hud-vitals');
    const hp = el('div', 'hud-vital hud-vital-hp');
    const hpIcon = el('div', 'hud-vital-icon');
    setHTML(hpIcon, ICON.health);
    this.elHpNum = el('div', 'hud-vital-num', '100');
    hp.append(hpIcon, this.elHpNum);
    const ar = el('div', 'hud-vital hud-vital-ar');
    const arIcon = el('div', 'hud-vital-icon');
    setHTML(arIcon, ICON.armor);
    this.elArNum = el('div', 'hud-vital-num', '0');
    this.elHelmet = el('div', 'hud-helmet');
    setHTML(this.elHelmet, ICON.helmet);
    ar.append(arIcon, this.elArNum, this.elHelmet);
    vit.append(hp, el('div', 'hud-vsep'), ar);
    this.elHpBar = el('div', 'hud-hpbar');
    this.elHpFill = el('div', 'hud-hpbar-fill');
    this.elHpBar.appendChild(this.elHpFill);
    const money = el('div', 'hud-money');
    this.elMoney = el('span', 'hud-money-num', '$0');
    this.elMoneyDeltas = el('div', 'hud-money-deltas');
    money.append(this.elMoney, this.elMoneyDeltas);
    box.append(vit, this.elHpBar, money);
    this.root.appendChild(box);
    this.elVitals = vit;
    this.elBL = box;
  }

  _buildBottomRight() {
    const box = el('div', 'hud-br');
    const ammo = el('div', 'hud-ammo');
    this.elWName = el('div', 'hud-wname', '');
    const row = el('div', 'hud-ammo-row');
    this.elMag = el('span', 'hud-mag', '0');
    this.elSep = el('span', 'hud-ammo-sep', '/');
    this.elReserve = el('span', 'hud-reserve', '0');
    row.append(this.elMag, this.elSep, this.elReserve);
    const tags = el('div', 'hud-ammo-tags');
    this.elMode = el('span', 'hud-tag hud-mode', '');
    this.elSil = el('span', 'hud-tag hud-sil');
    const silIcon = el('span', 'hud-sil-icon');
    setHTML(silIcon, SVG('<rect x="1.5" y="8.4" width="15" height="7.2" rx="3.4"/>' +
      '<rect x="16" y="10.4" width="6.5" height="3.2"/>'));
    this.elSil.append(silIcon, el('span', null, '消音'));
    this.elReload = el('span', 'hud-tag hud-reload', '换弹中');
    tags.append(this.elMode, this.elSil, this.elReload);
    this.elShells = el('div', 'hud-shells');
    ammo.append(this.elWName, row, tags, this.elShells);
    this.elEquip = el('div', 'hud-equip');
    box.append(ammo, this.elEquip);
    this.root.appendChild(box);
    this.elAmmo = ammo;
    this.elBR = box;
  }

  /** Centre cluster: crosshair, hitmarker, damage numbers, prompts, banner. */
  _buildCenter() {
    const ch = el('div', 'hud-crosshair');
    this.elChT = el('div', 'hud-ch-line hud-ch-t');
    this.elChB = el('div', 'hud-ch-line hud-ch-b');
    this.elChL = el('div', 'hud-ch-line hud-ch-l');
    this.elChR = el('div', 'hud-ch-line hud-ch-r');
    this.elChDot = el('div', 'hud-ch-dot');
    ch.append(this.elChT, this.elChB, this.elChL, this.elChR, this.elChDot);
    this.elCross = ch;
    const hit = el('div', 'hud-hitmarker');
    this.elHitTicks = [];
    for (let i = 0; i < 4; i++) {
      const tick = el('div', 'hud-hit-tick hud-hit-' + i);
      this.elHitTicks.push(tick);
      hit.appendChild(tick);
    }
    this.elHit = hit;
    this.elDmgNums = el('div', 'hud-dmgnums');
    this.root.append(ch, hit, this.elDmgNums);
    this._buildCenter2();
  }

  _buildCenter2() {
    const prog = el('div', 'hud-progress');
    this.elProgLabel = el('div', 'hud-prog-label', '');
    const track = el('div', 'hud-prog-track');
    this.elProgFill = el('div', 'hud-prog-fill');
    track.appendChild(this.elProgFill);
    this.elProgTime = el('div', 'hud-prog-time', '');
    prog.append(this.elProgLabel, track, this.elProgTime);
    this.elProg = prog;
    this.elPrompt = el('div', 'hud-prompt', '');
    this.elDefuse = el('div', 'hud-prompt hud-defuse-prompt', '');
    this.elBuyHint = el('div', 'hud-buyhint', '');
    this.elToastBox = el('div', 'hud-toasts');
    const banner = el('div', 'hud-banner');
    const inner = el('div', 'hud-banner-inner');
    this.elBanTitle = el('div', 'hud-banner-title', '');
    this.elBanSub = el('div', 'hud-banner-sub', '');
    inner.append(this.elBanTitle, this.elBanSub);
    banner.appendChild(inner);
    this.elBanner = banner;
    this.elBanInner = inner;
    this.root.append(prog, this.elPrompt, this.elDefuse, this.elBuyHint, this.elToastBox, banner);
  }

  _buildOverlays() {
    // directional damage indicators: front, right, back, left
    this.elArcs = [];
    const dirs = ['t', 'r', 'b', 'l'];
    for (let i = 0; i < 4; i++) {
      const arc = el('div', 'hud-arc hud-arc-' + dirs[i]);
      this.elArcs.push(arc);
      this.root.appendChild(arc);
    }
    // AWP / SSG scope overlay
    const sc = el('div', 'hud-scope');
    const cross = el('div', 'hud-scope-cross');
    for (let i = 0; i < 4; i++) cross.appendChild(el('div', 'hud-scope-cl hud-scope-cl' + i));
    const ticks = el('div', 'hud-scope-ticks');
    for (let i = 0; i < 11; i++) {
      const tk = el('div', 'hud-scope-tick' + (i % 5 === 0 ? ' hud-scope-tick-big' : ''));
      tk.style.left = (25 + i * 5) + '%';
      ticks.appendChild(tk);
    }
    sc.append(el('div', 'hud-scope-lens'), el('div', 'hud-scope-ring'),
      el('div', 'hud-scope-h'), el('div', 'hud-scope-v'), cross, ticks);
    this.elScope = sc;
    this.root.appendChild(sc);
    this._buildOverlays2();
  }

  _buildOverlays2() {
    this.elFlash = el('div', 'hud-flash');
    this.elBlood = el('div', 'hud-blood');
    // death / spectator overlay
    const death = el('div', 'hud-death');
    const dbox = el('div', 'hud-death-box');
    this.elDeathTitle = el('div', 'hud-death-title', '');
    this.elDeathSub = el('div', 'hud-death-sub', '空格切换视角');
    this.elDeathSpec = el('div', 'hud-death-spec', '');
    dbox.append(this.elDeathTitle, this.elDeathSub, this.elDeathSpec);
    death.appendChild(dbox);
    this.elDeath = death;
    // off-screen pointer toward the planted bomb
    const bi = el('div', 'hud-bombind');
    const arrow = el('div', 'hud-bombind-arrow');
    setHTML(arrow, ICON.arrow);
    const bicon = el('div', 'hud-bombind-icon');
    setHTML(bicon, ICON.bomb);
    this.elBombDist = el('div', 'hud-bombind-dist', '');
    bi.append(arrow, bicon, this.elBombDist);
    this.elBombInd = bi;
    this.elBombArrowEl = arrow;
    this.root.append(this.elBlood, this.elFlash, death, bi);
  }

  _buildScoreboard() {
    const sb = el('div', 'hud-sb');
    const inner = el('div', 'hud-sb-inner');
    const head = el('div', 'hud-sb-head');
    this.elSbT = el('span', 'hud-sb-num hud-side-t', '0');
    this.elSbCT = el('span', 'hud-sb-num hud-side-ct', '0');
    const sc = el('div', 'hud-sb-score');
    sc.append(el('span', 'hud-sb-tag hud-side-t', TEAM_LABEL.T), this.elSbT,
      el('span', 'hud-sb-colon', ':'), this.elSbCT,
      el('span', 'hud-sb-tag hud-side-ct', TEAM_LABEL.CT));
    this.elSbMeta = el('div', 'hud-sb-meta', '');
    head.append(el('div', 'hud-sb-title', '记分板'), sc, this.elSbMeta);
    const body = el('div', 'hud-sb-body');
    this.elSbPanels = {};
    for (const tm of [TEAM.T, TEAM.CT]) {
      const p = el('div', 'hud-sb-panel hud-sb-' + tm.toLowerCase());
      const ph = el('div', 'hud-sb-panel-head');
      const stat = el('div', 'hud-sb-panel-stat', '');
      ph.append(el('div', 'hud-sb-panel-name', TEAM_LABEL[tm]), stat);
      const cols = el('div', 'hud-sb-row hud-sb-cols');
      for (const c of ['玩家', 'K', 'A', 'D', '伤害', '金钱', '延迟']) {
        cols.appendChild(el('div', 'hud-sb-cell', c));
      }
      const rows = el('div', 'hud-sb-rows');
      p.append(ph, cols, rows);
      body.appendChild(p);
      this.elSbPanels[tm] = { rows, stat };
    }
    inner.append(head, body, el('div', 'hud-sb-foot', '按住 TAB 查看比分 · 空格切换观战视角'));
    sb.appendChild(inner);
    this.elSb = sb;
    this.root.appendChild(sb);
  }

  // --- wiring --------------------------------------------------------------
  /** Subscribe to `game.bus`. Safe to call repeatedly (re-subscribes). */
  attach(game) {
    this.detach();
    this.game = game || null;
    if (game && game.cfg) {
      this.cfg = Object.assign({}, this.cfg, game.cfg);
      this.setCrosshair(game.cfg);
    }
    const bus = game && game.bus;
    if (!bus || typeof bus.on !== 'function') return this;
    const on = (ev, fn) => {
      const h = (d) => {
        try { fn(d || {}); } catch (e) { console.error('[hud]', ev, e); }
      };
      const off = bus.on(ev, h);
      this._off.push(typeof off === 'function'
        ? off
        : () => { try { bus.off(ev, h); } catch (e) { /* bus already gone */ } });
    };
    on('kill', (d) => this._onKill(d));
    on('damage', (d) => this._onDamage(d));
    on('plant', (d) => this._onPlant(d));
    on('defuse_done', (d) => this._onDefuseDone(d));
    on('bomb_explode', (d) => this._onExplode(d));
    on('round_start', (d) => this._onRoundStart(d));
    on('round_end', (d) => this._onRoundEnd(d));
    on('phase', (d) => this._onPhase(d));
    on('radio', (d) => this._onRadio(d));
    on('flash', (d) => this.setFlash(d.amount != null ? d.amount : (d.value != null ? d.value : d)));
    on('buy', (d) => this._onBuy(d));
    on('pickup', (d) => this._onPickup(d));
    on('match_end', (d) => this._onMatchEnd(d));
    on('halftime', (d) => this._onHalftime(d));
    return this;
  }

  /** Drop every bus subscription. */
  detach() {
    for (const off of this._off) { try { off(); } catch (e) { /* ignore */ } }
    this._off.length = 0;
    return this;
  }

  // --- event handlers ------------------------------------------------------
  /** True when `x` is the human player. */
  _isLocal(x) {
    const me = this.game && this.game.local;
    if (!me || !x) return false;
    if (x === me) return true;
    return x.id != null && me.id != null && x.id === me.id;
  }

  /** Accept {x,y,z} or [x,y,z] positions alike. */
  _pos(v) {
    if (!v) return null;
    if (Array.isArray(v)) return { x: v[0] || 0, y: v[1] || 0, z: v[2] || 0 };
    if (typeof v.x === 'number') return { x: v.x, y: v.y || 0, z: v.z || 0 };
    return null;
  }

  _onKill(d) {
    this.killfeed(d);
    if (this._isLocal(d.victim || d.target)) this.showDeath(d);
    else if (this._isLocal(d.killer || d.attacker)) this.hitmarker(0, !!d.headshot, true);
  }

  _onDamage(d) {
    const victim = d.target || d.victim || null;
    const attacker = d.attacker || d.killer || d.by || null;
    const amt = Math.max(0, Math.round(d.amount != null ? d.amount : (d.damage || 0)));
    const hs = !!(d.headshot || d.hitbox === 'head');
    if (this._isLocal(attacker) && !this._isLocal(victim)) this.hitmarker(amt, hs, false);
    if (this._isLocal(victim)) {
      this.damageFrom(this._damageAngle(attacker, d), amt);
      restart(this.elBlood, 'hud-blood-hit');
    }
  }

  /** Screen-relative angle the damage came from (0 = ahead, +PI/2 = right). */
  _damageAngle(src, d) {
    if (d && typeof d.angle === 'number') return d.angle;
    const me = this.game && this.game.local;
    const mp = this._pos(me && me.pos);
    let dx = 0, dz = 0;
    const dir = d && this._pos(d.dir);
    const sp = this._pos(src && src.pos);
    if (dir) { dx = -dir.x; dz = -dir.z; }
    else if (sp && mp) { dx = sp.x - mp.x; dz = sp.z - mp.z; }
    else return 0;
    if (!dx && !dz) return 0;
    const yaw = (me && typeof me.yaw === 'number') ? me.yaw : 0;
    return angleWrap(Math.atan2(dx, -dz) - yaw);
  }

  _onPlant(d) {
    const w = whoInfo(d.actor || d.planter || d.by);
    this.subtitle((w.name ? w.name + '：' : '') + RADIO.bombplanted, 3200);
    const site = d.site || (this.game && this.game.bomb && this.game.bomb.site) || '';
    this.banner('炸弹已安放', `${site ? site + ' 点 · ' : ''}${ROUND.bombTime} 秒后引爆`, 1700, 't');
    this.progress(null);
    this.prompt('');
  }

  _onDefuseDone(d) {
    const w = whoInfo(d.actor || d.defuser || d.by);
    this.subtitle((w.name ? w.name + '：' : '') + '炸弹已拆除', 3200);
    this.banner('炸弹已拆除', w.name || '', 1700, 'ct');
    this.progress(null);
    this.defusePrompt('');
  }

  _onExplode() {
    this.banner('炸弹已引爆', '', 1700, 't');
    restart(this.elBlood, 'hud-blood-hit');
    this.progress(null);
    this.prompt('');
    this.defusePrompt('');
    this.bombIndicator(false);
  }

  _onRoundStart(d) {
    const m = (this.game && this.game.match) || {};
    const n = d.round != null ? d.round : (m.round != null ? m.round : 1);
    this._clearKillfeed();
    this.hideDeath();
    this.progress(null);
    this.prompt('');
    this.defusePrompt('');
    this.bombIndicator(false);
    this._arc[0] = this._arc[1] = this._arc[2] = this._arc[3] = 0;
    this._flash = 0;
    this.banner('回合开始', `第 ${n} 回合`, 1500, 'round');
  }

  _onRoundEnd(d) {
    const m = (this.game && this.game.match) || {};
    const winner = d.winner || d.team || m.lastWinner || null;
    const reason = d.reason || m.lastReason || '';
    const s = m.score || {};
    const title = winner ? `${TEAM_LABEL[winner] || winner}获得胜利` : '回合结束';
    const bits = [];
    if (reason) bits.push(REASON_TEXT[String(reason).toLowerCase()] || String(reason));
    bits.push(`${s.T != null ? s.T : 0} : ${s.CT != null ? s.CT : 0}`);
    const kind = winner === TEAM.CT ? 'ct' : (winner === TEAM.T ? 't' : 'info');
    this.banner(title, bits.join(' · '), 4200, kind);
    this.prompt('');
    this.defusePrompt('');
    this.progress(null);
    this.bombIndicator(false);
  }

  _onPhase(d) {
    const p = (d && d.phase) || d || null;
    this._phase = p;
    if (p === PHASE.FREEZE || p === PHASE.ROUND_END || p === PHASE.MATCH_END) {
      this.prompt('');
      this.defusePrompt('');
      this.progress(null);
    }
    if (p === PHASE.FREEZE) { this.hideDeath(); this._flash = 0; }
  }

  _onRadio(d) {
    const w = whoInfo(d.actor || d.from || d.by);
    const id = d.msg || d.id || d.message || '';
    const text = RADIO[id] || (typeof d.text === 'string' ? d.text : String(id || ''));
    if (!text) return;
    const team = w.team || (d.team === TEAM.CT ? TEAM.CT : (d.team === TEAM.T ? TEAM.T : null));
    this.subtitle(`${w.name || '队友'}：${text}`, d.ms || 3200, team);
  }

  _onBuy(d) {
    if (!this._isLocal(d.actor || d.by)) return;
    const w = weaponInfo(d.item || d.id || d.weapon);
    if (d.ok === false || d.fail) this.toast(`购买失败 · ${w.name}`);
    else this.toast(`已购买 ${w.name}`);
  }

  _onPickup(d) {
    if (!this._isLocal(d.actor || d.by)) return;
    const w = weaponInfo(d.item || d.id || d.weapon);
    this.toast(`拾取 ${w.name}`);
  }

  _onMatchEnd(d) {
    const m = (this.game && this.game.match) || {};
    const s = m.score || {};
    const winner = d.winner || d.team || m.lastWinner || null;
    const mine = (this.game && this.game.local && this.game.local.team) || null;
    let kind = 'info';
    let title = '比赛结束';
    if (winner && mine) {
      const won = winner === mine;
      kind = won ? 'win' : 'lose';
      title = won ? '比赛胜利' : '比赛失败';
    } else if (winner) {
      kind = winner === TEAM.CT ? 'ct' : 't';
      title = `${TEAM_LABEL[winner] || winner}获得胜利`;
    }
    const sub = `${TEAM_LABEL.T} ${s.T || 0} : ${s.CT || 0} ${TEAM_LABEL.CT}`;
    this.banner(title, sub, d.ms || 9000, kind);
  }

  _onHalftime(d) {
    const m = (this.game && this.game.match) || {};
    const s = m.score || {};
    const sub = `${TEAM_LABEL.T} ${s.T || 0} : ${s.CT || 0} ${TEAM_LABEL.CT}`;
    this.banner('中场交换阵营', sub, d.ms || 5000, 'half');
    this._clearKillfeed();
    this.hideDeath();
  }

  // --- per-frame -----------------------------------------------------------
  /** Called every frame. Read-only with respect to the game state. */
  update(dt, game) {
    if (game) this.game = game;
    dt = (typeof dt === 'number' && isFinite(dt)) ? clamp(dt, 0, 0.25) : 0;
    this.t += dt;
    this._runTimers();
    this._expire(this._kf, 'hud-kf-out', 0.5);
    this._expire(this._subs, 'hud-sub-out', 0.4);
    this._expire(this._dmg, 'hud-dmg-out', 0.05);
    this._expire(this._toasts, 'hud-toast-out', 0.35);
    const g = this.game;
    if (!g) return;
    const view = this._viewActor(g);
    this._updateTop(g);
    this._updateTeam(g, view);
    this._updateVitals(g, view);
    this._updateAmmo(g, view);
    this._updateEquip(g, view);
    this._updateCrosshair(g, view);
    this._updateFx(dt, g, view);
    this._updateObjective(dt, g, view);
    this._updateSpectate(g);
    this._updateScoreboard(g);
    this._updateStats(dt, g);
  }

  /** Whose ammo / health the bottom corners show (self, else spectated). */
  _viewActor(g) {
    const me = g.local || null;
    if (me && me.alive) return me;
    const sp = g.spectate;
    let tgt = sp && sp.target;
    if (tgt != null && typeof tgt !== 'object') tgt = this._findActor(g, tgt);
    return tgt || me || null;
  }

  _findActor(g, id) {
    const list = g.actors || [];
    for (const a of list) if (a && a.id === id) return a;
    return null;
  }

  _rm(node) { if (node && node.parentNode) node.parentNode.removeChild(node); }

  _after(sec, fn) { this._timers.push({ at: this.t + sec, fn }); }

  _runTimers() {
    if (!this._timers.length) return;
    const due = [];
    for (let i = this._timers.length - 1; i >= 0; i--) {
      if (this.t >= this._timers[i].at) due.push(this._timers.splice(i, 1)[0]);
    }
    for (const d of due) { try { d.fn(); } catch (e) { console.error('[hud]', e); } }
  }

  /** Fade, then remove, timed rows (killfeed / subtitles / toasts / numbers). */
  _expire(list, cls, fade) {
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (it.gone != null) {
        if (this.t >= it.gone) { this._rm(it.el); list.splice(i, 1); }
      } else if (this.t >= it.at) {
        it.el.classList.add(cls);
        it.gone = this.t + fade;
      }
    }
  }

  _vh() {
    const h = this.root.clientHeight || (typeof window !== 'undefined' && window.innerHeight) || 0;
    return h > 0 ? h : 720;
  }

  _vw() {
    const w = this.root.clientWidth || (typeof window !== 'undefined' && window.innerWidth) || 0;
    return w > 0 ? w : 1280;
  }

  /** Top centre: timer / bomb timer, score, round number, alive pips. */
  _updateTop(g) {
    const m = g.match || {};
    const s = m.score || {};
    const bomb = g.bomb || {};
    setText(this.elScoreTNum, s.T != null ? s.T : 0);
    setText(this.elScoreCTNum, s.CT != null ? s.CT : 0);
    setText(this.elRound, `第 ${m.round != null ? m.round : 1} 回合`);
    const planted = bomb.state === 'planted' || m.phase === PHASE.PLANTED;
    const raw = planted ? bomb.timer : m.timer;
    const t = Math.max(0, typeof raw === 'number' && isFinite(raw) ? raw : 0);
    setText(this.elTimer, planted ? t.toFixed(1) : fmtTime(t));
    setCls(this.elTimer, 'hud-bombtime', planted);
    setCls(this.elTimer, 'hud-warn-time', !planted && t <= 30 && t > 10);
    setCls(this.elTimer, 'hud-crit-time', planted || (t <= 10 && m.phase !== PHASE.FREEZE));
    setCls(this.elBeep, 'hud-on', planted);
    if (planted) {
      const rate = clamp(0.14 + (t / Math.max(1, ROUND.bombTime)) * 0.76, 0.14, 0.9);
      setStyle(this.elBeep, 'animationDuration', rate.toFixed(2) + 's');
    }
    let cap = '';
    if (m.phase === PHASE.FREEZE) cap = '准备阶段';
    else if (planted) cap = `炸弹已安放${bomb.site ? ' · ' + bomb.site + ' 点' : ''}`;
    else if (m.phase === PHASE.ROUND_END) cap = '回合结束';
    else if (m.phase === PHASE.HALFTIME) cap = '中场休息';
    else if (m.phase === PHASE.MATCH_END) cap = '比赛结束';
    else if (m.isBuyTime) cap = '购买阶段';
    setText(this.elPhase, cap);
    setCls(this.elPhase, 'hud-on', !!cap);
    this._updatePips(g);
  }

  /** Alive markers: filled = alive, hollow = dead. */
  _updatePips(g) {
    const list = g.actors || [];
    const count = { T: 0, CT: 0 };
    const alive = { T: 0, CT: 0 };
    for (const a of list) {
      if (!a || (a.team !== TEAM.T && a.team !== TEAM.CT)) continue;
      count[a.team]++;
      if (a.alive) alive[a.team]++;
    }
    this._syncPips(TEAM.T, this.elPipsT, count.T, alive.T);
    this._syncPips(TEAM.CT, this.elPipsCT, count.CT, alive.CT);
  }

  _syncPips(team, box, total, alive) {
    const arr = this._pips[team];
    while (arr.length > total) this._rm(arr.pop());
    while (arr.length < total) {
      const p = el('div', 'hud-pip');
      arr.push(p);
      box.appendChild(p);
    }
    for (let i = 0; i < arr.length; i++) setCls(arr[i], 'hud-pip-on', i < alive);
  }

  /** Left column: one row per team mate (CS2 style). */
  _updateTeam(g, view) {
    const me = g.local || null;
    const team = (me && me.team) || (view && view.team) || TEAM.CT;
    const mates = [];
    for (const a of (g.actors || [])) if (a && a.team === team) mates.push(a);
    mates.sort((a, b) => (a.id > b.id ? 1 : a.id < b.id ? -1 : 0));
    const sig = team + '|' + mates.map((a) => a.id).join(',');
    if (sig !== this._teamSig) {
      this._teamSig = sig;
      this.elTeamList.innerHTML = '';
      this._teamRows.clear();
      setText(this.elTeamTitle, TEAM_LABEL[team] || '小队');
      setCls(this.elTeamBox, 'hud-team-t', team === TEAM.T);
      setCls(this.elTeamBox, 'hud-team-ct', team === TEAM.CT);
      for (const a of mates) this._teamRows.set(a.id, this._makeTeamRow(a));
    }
    for (const a of mates) {
      const r = this._teamRows.get(a.id);
      if (r) this._paintTeamRow(r, a, me);
    }
    setCls(this.elTeamBox, 'hud-off', mates.length === 0);
  }

  _makeTeamRow(a) {
    const row = el('div', 'hud-tm-row');
    const name = el('div', 'hud-tm-name', a.name || '玩家');
    const hp = el('div', 'hud-tm-hp', '100');
    const wep = el('div', 'hud-tm-wep');
    const c4 = el('div', 'hud-tm-c4');
    setHTML(c4, ICON.c4);
    const dead = el('div', 'hud-tm-dead', '💀');
    const bar = el('div', 'hud-tm-bar');
    const fill = el('div', 'hud-tm-fill');
    bar.appendChild(fill);
    row.append(name, hp, wep, c4, dead, bar);
    this.elTeamList.appendChild(row);
    return { row, name, fill, hp, wep, c4, dead };
  }

  _paintTeamRow(r, a, me) {
    const max = PLAYER.maxHealth || 100;
    const hp = clamp(Math.round(a.health || 0), 0, max);
    setText(r.name, a.name || '玩家');
    setText(r.hp, a.alive ? String(hp) : '');
    setStyle(r.fill, 'width', (a.alive ? (hp / max) * 100 : 0).toFixed(1) + '%');
    setCls(r.fill, 'hud-tm-low', a.alive && hp <= 35);
    setCls(r.row, 'hud-tm-out', !a.alive);
    setCls(r.row, 'hud-tm-me', !!(me && (a === me || (me.id != null && a.id === me.id))));
    setCls(r.dead, 'hud-on', !a.alive);
    setCls(r.c4, 'hud-on', !!(a.hasBomb || (a.inv && a.inv.bomb)));
    const inv = a.inv || {};
    const w = weaponInfo(a.active || inv.primary || inv.secondary || 'knife');
    setHTML(r.wep, a.alive ? w.svg : '');
  }

  /** Bottom left: health, armour, money (+ floating delta). */
  _updateVitals(g, view) {
    const alive = !!(view && view.alive);
    const maxHp = PLAYER.maxHealth || 100;
    const maxAr = PLAYER.maxArmor || 100;
    const hp = view ? clamp(Math.round(view.health || 0), 0, maxHp) : 0;
    const ar = view ? clamp(Math.round(view.armor || 0), 0, maxAr) : 0;
    setText(this.elHpNum, alive ? hp : 0);
    setText(this.elArNum, ar);
    setCls(this.elVitals, 'hud-low', alive && hp <= 35);
    setCls(this.elVitals, 'hud-dead', !alive);
    setCls(this.elHelmet, 'hud-on', !!(view && view.helmet));
    setCls(this.elArNum.parentNode, 'hud-off', ar <= 0);
    setStyle(this.elHpFill, 'width', (alive ? (hp / maxHp) * 100 : 0).toFixed(1) + '%');
    setCls(this.elHpFill, 'hud-low', alive && hp <= 35);
    const me = g.local || null;
    const money = me && typeof me.money === 'number' ? Math.round(me.money) : null;
    setText(this.elMoney, money == null ? '' : fmtMoney(money));
    if (money != null && this._money != null && money !== this._money) {
      this._moneyDelta(money - this._money);
    }
    if (money != null) this._money = money;
  }

  /** `+$300` / `-$2700` floating text over the money readout. */
  _moneyDelta(d) {
    if (!d) return;
    const node = el('div', 'hud-money-delta ' + (d > 0 ? 'hud-plus' : 'hud-minus'),
      (d > 0 ? '+' : '-') + fmtMoney(Math.abs(d)));
    this.elMoneyDeltas.appendChild(node);
    this._after(1.15, () => this._rm(node));
    while (this.elMoneyDeltas.childNodes.length > 4) this._rm(this.elMoneyDeltas.childNodes[0]);
  }

  /** Bottom right: magazine / reserve, weapon name, mode tags, shell pips. */
  _updateAmmo(g, view) {
    const act = view && view.alive ? view.active : null;
    setCls(this.elAmmo, 'hud-off', !act);
    if (!act) { this._shellSync(0, 0); return; }
    const w = weaponInfo(act);
    const def = act.def || {};
    setText(this.elWName, w.name);
    const nade = w.cat === 'grenade';
    const noAmmo = nade || w.cat === 'knife' || w.cat === 'c4';
    let mag = typeof act.ammo === 'number' ? act.ammo : 0;
    const reserve = typeof act.reserve === 'number' ? act.reserve : 0;
    if (nade) mag = this._nadeCount(view, w.id, mag);
    setText(this.elMag, nade ? String(mag) : (noAmmo ? '—' : String(mag)));
    setText(this.elReserve, String(reserve));
    setCls(this.elSep, 'hud-off', noAmmo);
    setCls(this.elReserve, 'hud-off', noAmmo);
    const empty = !noAmmo && mag <= 0;
    if (empty && !this._wasEmpty) restart(this.elMag, 'hud-dry');
    this._wasEmpty = empty;
    setCls(this.elMag, 'hud-empty', empty);
    setCls(this.elReserve, 'hud-empty', !noAmmo && reserve <= 0);
    const modeId = String(act.mode || def.mode || def.firemode ||
      (def.auto === false ? 'single' : (w.cat === 'sniper' ? 'bolt' : 'auto'))).toLowerCase();
    const modeTxt = noAmmo ? '' : (MODE_TEXT[modeId] || '');
    setText(this.elMode, modeTxt);
    setCls(this.elMode, 'hud-off', !modeTxt);
    setCls(this.elSil, 'hud-on', !!(act.silenced || def.silenced || w.id === 'usp' || w.id === 'm4a1s'));
    setCls(this.elReload, 'hud-on', !!view.reloading);
    const size = w.cat === 'shotgun'
      ? (def.mag || def.magSize || def.clip || SHOTGUN_MAG[w.id] || 8) : 0;
    this._shellSync(size, mag);
  }

  _nadeCount(view, id, fallback) {
    const list = (view.inv && view.inv.grenades) || [];
    for (const gr of list) if (gr && gr.id === id) return gr.count != null ? gr.count : fallback;
    return fallback;
  }

  _shellSync(size, filled) {
    setCls(this.elShells, 'hud-off', size <= 0);
    const arr = this._shells;
    while (arr.length > size) this._rm(arr.pop());
    while (arr.length < size) {
      const p = el('div', 'hud-shell');
      arr.push(p);
      this.elShells.appendChild(p);
    }
    for (let i = 0; i < arr.length; i++) setCls(arr[i], 'hud-shell-on', i < filled);
  }

  /** Equipment strip: grenades (icon + count), C4, defuse kit, knife. */
  _updateEquip(g, view) {
    const inv = (view && view.alive && view.inv) || null;
    setCls(this.elEquip, 'hud-off', !inv);
    if (!inv) {
      if (this._equipSig !== '') { this._equipSig = ''; this.elEquip.innerHTML = ''; }
      return;
    }
    const nades = [];
    for (const gr of (inv.grenades || [])) {
      if (!gr) continue;
      const c = gr.count != null ? gr.count : 1;
      if (c > 0) nades.push({ id: String(gr.id || (gr.def && gr.def.id) || 'he'), count: c });
    }
    const bomb = !!(inv.bomb || view.hasBomb);
    const kit = !!view.kit;
    const activeId = view.active ? String(view.active.id || '') : '';
    const slot = view.activeSlot || '';
    const sig = nades.map((n) => n.id + n.count).join(',') + `|${bomb}|${kit}|${activeId}|${slot}`;
    if (sig === this._equipSig) return;
    this._equipSig = sig;
    this.elEquip.innerHTML = '';
    for (const n of nades) {
      this.elEquip.appendChild(this._equipItem(NADE_ICON[n.id] || 'grenade',
        n.count > 1 ? n.count : 0, activeId === n.id));
    }
    if (bomb) {
      this.elEquip.appendChild(this._equipItem('c4', 0, slot === 'bomb' || activeId === 'c4', 'hud-eq-c4'));
    }
    if (kit) this.elEquip.appendChild(this._equipItem('kit', 0, false, 'hud-eq-kit'));
    this.elEquip.appendChild(this._equipItem('knife', 0, slot === 'knife' || activeId === 'knife'));
  }

  _equipItem(iconKey, count, active, extra) {
    const box = el('div', 'hud-eq' + (extra ? ' ' + extra : '') + (active ? ' hud-eq-on' : ''));
    const ic = el('div', 'hud-eq-icon');
    setHTML(ic, ICON[iconKey] || ICON.world);
    box.appendChild(ic);
    if (count > 0) box.appendChild(el('div', 'hud-eq-count', 'x' + count));
    return box;
  }

  /** Dynamic crosshair. `actor.spread` (radians) is converted to pixels with
   *  the current FOV, so the gap tracks the real bullet cone. */
  _updateCrosshair(g, view) {
    const m = g.match || {};
    const scoped = !!(view && view.zoom > 0) || this._scope > 0;
    const hide = !this._visible || this._sbOpen || scoped || !view || !view.alive ||
      m.phase === PHASE.MENU || m.phase === PHASE.MATCH_END;
    setCls(this.elCross, 'hud-off', hide);
    if (hide) return;
    const c = this.ch;
    const fov = clamp(Number(this.cfg.fov) || 90, 40, 140);
    const h = this._vh();
    const perRad = (h * 0.5) / Math.tan(fov * 0.5 * DEG);
    const spread = Math.max(0, Number(view.spread) || 0);
    const dyn = c.dynamic ? clamp(spread * perRad, 0, h * 0.22) : 0;
    const gap = Math.round(clamp(c.gap, 0, 60) + dyn);
    const th = Math.max(1, Math.round(clamp(c.thickness, 1, 8)));
    const len = Math.max(1, Math.round(clamp(c.size, 1, 40)));
    const enemy = !!g.aimOnEnemy;
    const key = `${gap}|${th}|${len}|${c.color}|${c.dot ? 1 : 0}|${enemy ? 1 : 0}`;
    if (key === this._chKey) return;
    this._chKey = key;
    setStyle(this.elCross, 'color', enemy ? '#ff4a3d' : c.color);
    setCls(this.elCross, 'hud-ch-hot', enemy);
    for (const n of [this.elChT, this.elChB]) {
      setStyle(n, 'width', th + 'px');
      setStyle(n, 'height', len + 'px');
    }
    for (const n of [this.elChL, this.elChR]) {
      setStyle(n, 'width', len + 'px');
      setStyle(n, 'height', th + 'px');
    }
    setStyle(this.elChT, 'transform', `translate(-50%,-100%) translateY(${-gap}px)`);
    setStyle(this.elChB, 'transform', `translate(-50%,0) translateY(${gap}px)`);
    setStyle(this.elChL, 'transform', `translate(-100%,-50%) translateX(${-gap}px)`);
    setStyle(this.elChR, 'transform', `translate(0,-50%) translateX(${gap}px)`);
    setStyle(this.elChDot, 'width', th + 'px');
    setStyle(this.elChDot, 'height', th + 'px');
    setCls(this.elChDot, 'hud-on', !!c.dot);
  }

  /** Flash layer, low-health vignette + heartbeat, directional damage arcs. */
  _updateFx(dt, g, view) {
    const me = g.local || null;
    const actorFlash = me && typeof me.flashAmount === 'number' ? clamp01(me.flashAmount) : 0;
    let f = this._flash;
    if (f > 0) f = Math.max(0, f - dt * (0.5 + 2.4 * (1 - f) * (1 - f)));
    this._flash = Math.max(f, actorFlash);
    const fa = Math.pow(this._flash, 0.72);
    const lit = fa > 0.002;
    setCls(this.elFlash, 'hud-on', lit);
    setStyle(this.elFlash, 'opacity', lit ? fa.toFixed(3) : '0');
    const maxHp = PLAYER.maxHealth || 100;
    const hp = me && me.alive ? clamp(me.health || 0, 0, maxHp) : maxHp;
    const low = !!(me && me.alive && hp <= 35);
    const k = low ? clamp01((35 - hp) / 35) : 0;
    setCls(this.elBlood, 'hud-on', low);
    this._setVar(this.elBlood, '--hud-blood-a', (low ? 0.28 + k * 0.5 : 0).toFixed(3));
    this._setVar(this.elBlood, '--hud-hb', (0.98 - 0.46 * k).toFixed(2) + 's');
    for (let i = 0; i < 4; i++) {
      if (this._arc[i] > 0) this._arc[i] = Math.max(0, this._arc[i] - dt * 1.4);
      const v = this._arc[i];
      setStyle(this.elArcs[i], 'opacity', v > 0.002 ? Math.min(1, v).toFixed(3) : '0');
    }
    setCls(this.root, 'hud-scoped', this._scope > 0 || !!(view && view.zoom > 0));
  }

  /** Write a CSS custom property (cached; tolerates stub styles). */
  _setVar(node, name, v) {
    const key = '__v' + name;
    if (node[key] === v) return;
    node[key] = v;
    if (node.style && typeof node.style.setProperty === 'function') node.style.setProperty(name, v);
  }

  /** Objective bars, defuse prompt, buy hint and the bomb pointer. */
  _updateObjective(dt, g, view) {
    const m = g.match || {};
    const b = g.bomb || {};
    const me = g.local || null;
    const plant = typeof b.plantProgress === 'number' ? b.plantProgress : 0;
    const defuse = typeof b.defuseProgress === 'number' ? b.defuseProgress : 0;
    this._progHold = Math.max(0, (this._progHold || 0) - dt);
    if (this._progHold <= 0) {
      if (plant > 0 && plant < 1 && b.state !== 'planted') {
        this._showProgress('正在安放炸弹', plant, { time: ROUND.plantTime * (1 - plant) });
      } else if (defuse > 0 && defuse < 1) {
        const kit = !!(b.defuser && b.defuser.kit);
        const full = kit ? ROUND.defuseKitTime : ROUND.defuseTime;
        this._showProgress(kit ? '正在拆除炸弹 · 拆弹器' : '正在拆除炸弹', defuse,
          { danger: true, time: full * (1 - defuse) });
      } else {
        this._hideProgress();
      }
    }
    this._defuseHold = Math.max(0, (this._defuseHold || 0) - dt);
    if (this._defuseHold <= 0) {
      const can = !!(me && me.alive && me.team === TEAM.CT && b.state === 'planted' &&
        me.hasDefuseTarget && !(defuse > 0));
      const secs = me && me.kit ? ROUND.defuseKitTime : ROUND.defuseTime;
      this._setPrompt(this.elDefuse, can ? `按住 E 拆除炸弹 · ${secs} 秒` : '');
    }
    const buy = !!m.isBuyTime && !!me && !!me.alive &&
      m.phase !== PHASE.MATCH_END && m.phase !== PHASE.ROUND_END;
    if (buy) {
      const left = Math.max(0, Math.ceil(typeof m.buyTimeLeft === 'number' ? m.buyTimeLeft : 0));
      setText(this.elBuyHint, `按 B 购买装备 · 剩余 ${left} 秒`);
    }
    setCls(this.elBuyHint, 'hud-on', buy);
    this._updateBombInd(g, view);
  }

  _setPrompt(node, txt) {
    setText(node, txt || '');
    setCls(node, 'hud-on', !!txt);
  }

  /** Edge arrow pointing at the planted bomb (yaw 0 looks down -Z). */
  _updateBombInd(g, view) {
    const b = g.bomb || {};
    const me = g.local || view;
    const bp = this._pos(b.pos);
    const mp = this._pos(me && (me.eye || me.pos));
    const show = (b.state === 'planted' || this._bombArrow) && !!bp && !!mp &&
      this._visible && !this._sbOpen;
    setCls(this.elBombInd, 'hud-on', show);
    if (!show) return;
    const yaw = typeof me.yaw === 'number' ? me.yaw : 0;
    const dx = bp.x - mp.x;
    const dz = bp.z - mp.z;
    const rel = angleWrap(Math.atan2(dx, -dz) - yaw);
    const fov = clamp(Number(this.cfg.fov) || 90, 40, 140) * DEG;
    setCls(this.elBombInd, 'hud-dim', Math.abs(rel) < fov * 0.42);
    const x = Math.sin(rel) * this._vw() * 0.36;
    const y = -Math.cos(rel) * this._vh() * 0.32;
    setStyle(this.elBombInd, 'transform',
      `translate(-50%,-50%) translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`);
    setStyle(this.elBombArrowEl, 'transform', `rotate(${(rel / DEG).toFixed(1)}deg)`);
    setText(this.elBombDist, `${Math.round(Math.hypot(dx, dz))} 米`);
  }

  /** Death overlay spectator line. */
  _updateSpectate(g) {
    if (!this._death) return;
    const sp = g.spectate || {};
    let tgt = sp.target;
    if (tgt != null && typeof tgt !== 'object') tgt = this._findActor(g, tgt);
    const mode = SPEC_TEXT[String(sp.mode || 'follow')] || '';
    if (tgt && tgt.name) setText(this.elDeathSpec, `正在观战：${tgt.name}${mode ? ' · ' + mode : ''}`);
    else setText(this.elDeathSpec, '');
    setCls(this.elDeathSpec, 'hud-on', !!(tgt && tgt.name));
  }

  /** TAB scoreboard; refreshed at 8 Hz while open. */
  _updateScoreboard(g) {
    if (!this._sbOpen) return;
    if (this._sbAt >= 0 && this.t - this._sbAt < 0.125) return;
    this._sbAt = this.t;
    const m = g.match || {};
    const s = m.score || {};
    setText(this.elSbT, s.T != null ? s.T : 0);
    setText(this.elSbCT, s.CT != null ? s.CT : 0);
    const bits = [`第 ${m.round != null ? m.round : 1} 回合`];
    if (m.roundsToWin) bits.push(`${m.roundsToWin} 分获胜`);
    if (m.half) bits.push(`第 ${m.half} 半场`);
    setText(this.elSbMeta, bits.join(' · '));
    const me = g.local || null;
    for (const tm of [TEAM.T, TEAM.CT]) {
      const panel = this.elSbPanels[tm];
      const list = [];
      for (const a of (g.actors || [])) if (a && a.team === tm) list.push(a);
      list.sort((a, b) => (b.score || 0) - (a.score || 0) ||
        (b.kills || 0) - (a.kills || 0) || (a.deaths || 0) - (b.deaths || 0));
      let alive = 0;
      for (const a of list) if (a.alive) alive++;
      setText(panel.stat, `${alive}/${list.length} 存活 · ${s[tm] != null ? s[tm] : 0} 分`);
      panel.rows.innerHTML = '';
      for (const a of list) panel.rows.appendChild(this._sbRow(a, me));
    }
  }

  /** Bots have no real latency — show their difficulty label instead. */
  _pingText(a) {
    if (!a.isBot) return '本机 8';
    const raw = a.difficulty;
    const id = typeof raw === 'string' ? raw : ((raw && (raw.id || raw.label)) || 'normal');
    const d = DIFFICULTY[id] || null;
    const label = d ? d.label : ((raw && raw.label) || String(id).toUpperCase());
    return `${label} ${FALLBACK_PING[id] || 45}`;
  }

  _sbRow(a, me) {
    const mine = !!(me && (a === me || (me.id != null && a.id === me.id)));
    const row = el('div', 'hud-sb-row' + (mine ? ' hud-sb-me' : '') + (a.alive ? '' : ' hud-sb-out'));
    const name = el('div', 'hud-sb-cell hud-sb-name');
    name.append(el('span', 'hud-sb-dot' + (a.alive ? ' hud-on' : '')),
      el('span', 'hud-sb-nick', a.name || '玩家'));
    const mvp = Number(a.mvp) || 0;
    if (mvp > 0) {
      const st = el('span', 'hud-sb-star');
      setHTML(st, ICON.star);
      name.appendChild(st);
      if (mvp > 1) name.appendChild(el('span', 'hud-sb-starn', 'x' + mvp));
    }
    if (a.hasBomb) {
      const c4 = el('span', 'hud-sb-c4');
      setHTML(c4, ICON.c4);
      name.appendChild(c4);
    }
    row.append(name,
      el('div', 'hud-sb-cell', String(a.kills || 0)),
      el('div', 'hud-sb-cell', String(a.assists || 0)),
      el('div', 'hud-sb-cell', String(a.deaths || 0)),
      el('div', 'hud-sb-cell', String(Math.round(a.damageDealt || 0))),
      el('div', 'hud-sb-cell hud-sb-money', fmtMoney(a.money || 0)),
      el('div', 'hud-sb-cell hud-sb-ping', this._pingText(a)));
    return row;
  }

  /** Top-right corner fps / frame time / latency stub. */
  _updateStats(dt, g) {
    const show = !!this.cfg.showFps;
    setCls(this.elStats, 'hud-on', show);
    if (!show) return;
    if (dt > 0) this._fpsAvg.push(1 / dt);
    if (this.t - (this._statAt || 0) < 0.25) return;
    this._statAt = this.t;
    const raw = typeof g.fps === 'number' && isFinite(g.fps) && g.fps > 0 ? g.fps : this._fpsAvg.avg;
    const fps = Math.max(0, Math.round(raw));
    const ms = fps > 0 ? 1000 / fps : 0;
    setText(this.elStats, `FPS ${fps} · ${ms.toFixed(1)}MS · PING 8`);
  }

  // --- public API ----------------------------------------------------------
  _teamCls(team) {
    return team === TEAM.T ? 'hud-side-t'
      : (team === TEAM.CT ? 'hud-side-ct' : 'hud-side-neutral');
  }

  /** Push one kill feed row (newest on top, max 6, fades after 6 s). */
  killfeed(info) {
    const d = info || {};
    const k = whoInfo(d.killer || d.attacker);
    const v = whoInfo(d.victim || d.target);
    const w = weaponInfo(d.weapon || d.id);
    const kTeam = k.team || d.killerTeam || null;
    const vTeam = v.team || d.victimTeam || null;
    const tk = !!d.teamKill || !!(kTeam && vTeam && kTeam === vTeam && k.name && v.name);
    const mine = !!d.local || this._isLocal(d.killer || d.attacker);
    const row = el('div', 'hud-kf-row hud-kf-in' + (mine ? ' hud-kf-own' : '') + (tk ? ' hud-kf-tk' : ''));
    if (k.name) row.appendChild(el('span', 'hud-kf-name ' + this._teamCls(kTeam), k.name));
    const icons = el('span', 'hud-kf-icons');
    if (d.penetrated) {
      const p = el('span', 'hud-kf-mark');
      setHTML(p, ICON.wall);
      icons.appendChild(p);
    }
    const wi = el('span', 'hud-kf-wep');
    setHTML(wi, w.svg);
    icons.appendChild(wi);
    if (d.headshot) {
      const hs = el('span', 'hud-kf-mark hud-kf-hs');
      setHTML(hs, ICON.hs);
      icons.appendChild(hs);
    }
    row.appendChild(icons);
    row.appendChild(el('span', 'hud-kf-name ' + this._teamCls(vTeam), v.name || '玩家'));
    this.elKF.insertBefore(row, this.elKF.firstChild || null);
    this._kf.push({ el: row, at: this.t + 6 });
    while (this._kf.length > 6) this._rm(this._kf.shift().el);
    return this;
  }

  _clearKillfeed() {
    for (const it of this._kf) this._rm(it.el);
    this._kf.length = 0;
  }

  /** Centre banner. kind: round | t | ct | win | lose | half | info. */
  banner(title, sub, ms, kind) {
    setText(this.elBanTitle, title || '');
    setText(this.elBanSub, sub || '');
    setCls(this.elBanSub, 'hud-off', !sub);
    const k = kind || 'info';
    for (const c of ['round', 't', 'ct', 'win', 'lose', 'half', 'info']) {
      setCls(this.elBanner, 'hud-ban-' + c, c === k);
    }
    this.elBanner.classList.add('hud-on');
    restart(this.elBanInner, 'hud-ban-play');
    const tok = (this._banToken || 0) + 1;
    this._banToken = tok;
    this._after(Math.max(0.2, (Number(ms) || 2000) / 1000), () => {
      if (tok === this._banToken) this.elBanner.classList.remove('hud-on');
    });
    return this;
  }

  /** 4 ticks that flare: white = hit, red+big = kill, crunch = headshot. */
  hitmarker(dmg, headshot, kill) {
    const e = this.elHit;
    setCls(e, 'hud-hit-kill', !!kill);
    setCls(e, 'hud-hit-hs', !kill && !!headshot);
    restart(e, 'hud-hit-on');
    const n = Math.round(Number(dmg) || 0);
    if (n > 0) this._dmgNumber(n, !!headshot, !!kill);
    return this;
  }

  _dmgNumber(n, headshot, kill) {
    const cls = 'hud-dmgnum' + (kill ? ' hud-dmg-kill' : (headshot ? ' hud-dmg-hs' : ''));
    const node = el('div', cls, String(n));
    node.style.left = (50 + (Math.random() * 2 - 1) * 5.5).toFixed(2) + '%';
    node.style.top = (46 + (Math.random() * 2 - 1) * 2.6).toFixed(2) + '%';
    this.elDmgNums.appendChild(node);
    this._dmg.push({ el: node, at: this.t + 0.85 });
    while (this._dmg.length > 14) this._rm(this._dmg.shift().el);
  }

  /** angle: 0 = ahead, +PI/2 = right (already view relative). */
  damageFrom(angle, amount) {
    const a = typeof angle === 'number' && isFinite(angle) ? angle : 0;
    const amt = clamp01((Math.max(0, Number(amount) || 0) + 6) / 46);
    const w = [Math.cos(a), Math.sin(a), -Math.cos(a), -Math.sin(a)];
    for (let i = 0; i < 4; i++) {
      const v = Math.max(0, w[i]) * (0.5 + amt);
      if (v > this._arc[i]) this._arc[i] = Math.min(1.3, v);
    }
    return this;
  }

  /** Flash-bang layer. 0 clears instantly, otherwise the value is held then
   *  decays on a fast curve inside update(). */
  setFlash(v) {
    const n = clamp01(typeof v === 'number' ? v : (Number(v) || 0));
    if (n <= 0) this._flash = 0;
    else if (n > this._flash) this._flash = n;
    return this;
  }

  /** Radio / subtitle line above the kill feed. */
  subtitle(text, ms, team) {
    const t = text == null ? '' : String(text);
    if (!t) return this;
    const row = el('div', 'hud-sub hud-sub-in' + (team ? ' ' + this._teamCls(team) : ''), t);
    this.elSubs.appendChild(row);
    this._subs.push({ el: row, at: this.t + Math.max(0.3, (Number(ms) || 3000) / 1000) });
    while (this._subs.length > 3) this._rm(this._subs.shift().el);
    return this;
  }

  /** Small transient notice (purchases, pickups). */
  toast(text) {
    const t = text == null ? '' : String(text);
    if (!t) return this;
    const row = el('div', 'hud-toast hud-toast-in', t);
    this.elToastBox.appendChild(row);
    this._toasts.push({ el: row, at: this.t + 2.2 });
    while (this._toasts.length > 4) this._rm(this._toasts.shift().el);
    return this;
  }

  /**
   * Objective bar. `progress(null)` hides it. A manual call owns the bar for
   * 0.4 s, after which update() resumes driving it from game.bomb.
   */
  progress(label, t, opts) {
    this._progHold = 0.4;
    if (label == null || t == null || Number(t) < 0) this._hideProgress();
    else this._showProgress(String(label), t, opts || {});
    return this;
  }

  _showProgress(label, t, opts) {
    const o = opts || {};
    const p = clamp01(Number(t) || 0);
    setText(this.elProgLabel, label);
    setStyle(this.elProgFill, 'width', (p * 100).toFixed(1) + '%');
    setCls(this.elProg, 'hud-danger', !!o.danger);
    const time = typeof o.time === 'number' && isFinite(o.time) ? Math.max(0, o.time) : null;
    setText(this.elProgTime, time == null ? `${Math.round(p * 100)}%` : `${time.toFixed(1)} 秒`);
    setCls(this.elProg, 'hud-on', true);
  }

  _hideProgress() { setCls(this.elProg, 'hud-on', false); }

  /** Generic centre prompt, e.g. prompt('按 E 拆除炸弹'). '' clears it. */
  prompt(text) {
    this._setPrompt(this.elPrompt, text == null ? '' : String(text));
    return this;
  }

  /** Defuse-specific prompt; owns the line for 0.5 s, then auto-drives again. */
  defusePrompt(text) {
    this._defuseHold = 0.5;
    this._setPrompt(this.elDefuse, text == null ? '' : String(text));
    return this;
  }

  /** Accepts {color,size,gap,thickness,dot,dynamic} or the CFG crosshair* keys. */
  setCrosshair(cfg) {
    const c = cfg || {};
    const g = (a, b, cur) => (c[a] !== undefined ? c[a] : (c[b] !== undefined ? c[b] : cur));
    const num = (v, cur) => (isFinite(Number(v)) ? Number(v) : cur);
    this.ch.color = String(g('color', 'crosshairColor', this.ch.color) || this.ch.color);
    this.ch.size = num(g('size', 'crosshairSize', this.ch.size), this.ch.size);
    this.ch.gap = num(g('gap', 'crosshairGap', this.ch.gap), this.ch.gap);
    this.ch.thickness = num(g('thickness', 'crosshairThickness', this.ch.thickness), this.ch.thickness);
    this.ch.dot = !!g('dot', 'crosshairDot', this.ch.dot);
    this.ch.dynamic = !!g('dynamic', 'crosshairDynamic', this.ch.dynamic);
    if (c.fov !== undefined) this.cfg.fov = num(c.fov, this.cfg.fov);
    if (c.showFps !== undefined) this.cfg.showFps = !!c.showFps;
    this._chKey = '';
    return this;
  }

  /** 0 = no scope, 1 = first zoom, 2 = second zoom (AWP / SSG 08). */
  setScope(level) {
    const l = Math.max(0, Math.round(Number(level) || 0));
    this._scope = l;
    setCls(this.elScope, 'hud-on', l > 0);
    setCls(this.elScope, 'hud-scope-2', l >= 2);
    this._chKey = '';
    return this;
  }

  setVisible(on) {
    this._visible = !!on;
    setCls(this.root, 'hud-hidden', !this._visible);
    return this;
  }

  /** Death / spectator overlay: 已被 XXX 用 AK-47 淘汰. */
  showDeath(info) {
    const d = info || {};
    const k = whoInfo(d.killer || d.attacker);
    const w = weaponInfo(d.weapon || d.id);
    let title = '已阵亡';
    if (k.name) {
      const box = d.headshot ? HITBOX_LABEL.head : (d.hitbox ? HITBOX_LABEL[d.hitbox] : '');
      title = `已被 ${k.name} 用 ${w.name} 淘汰${box ? '（' + box + '）' : ''}`;
    } else if (w.id === 'fall' || d.reason === 'fall') {
      title = '坠落身亡';
    } else if (w.id === 'c4' || w.id === 'bomb' || d.reason === 'bomb') {
      title = '被炸弹炸死';
    }
    this._death = d;
    setText(this.elDeathTitle, title);
    setText(this.elDeathSub, '空格切换视角');
    setCls(this.elDeath, 'hud-tk', !!d.teamKill);
    setCls(this.elDeath, 'hud-on', true);
    return this;
  }

  hideDeath() {
    this._death = null;
    setCls(this.elDeath, 'hud-on', false);
    setCls(this.elDeathSpec, 'hud-on', false);
    return this;
  }

  /** TAB scoreboard. Takes pointer events while open. */
  showScoreboard(on) {
    this._sbOpen = !!on;
    setCls(this.elSb, 'hud-on', this._sbOpen);
    this._sbAt = -1;
    if (this._sbOpen && this.game) this._updateScoreboard(this.game);
    return this;
  }

  /** Force the off-screen bomb pointer on/off (auto-on while planted). */
  bombIndicator(on) {
    this._bombArrow = on === undefined ? true : !!on;
    if (!this._bombArrow) setCls(this.elBombInd, 'hud-on', false);
    return this;
  }

  /** Unsubscribe, drop every node this HUD created and reset the root class. */
  dispose() {
    this.detach();
    this._timers.length = 0;
    this._clearKillfeed();
    for (const list of [this._subs, this._dmg, this._toasts]) {
      for (const it of list) this._rm(it.el);
      list.length = 0;
    }
    const nodes = [this.elRadar, this.elTop, this.elRight, this.elTeamBox, this.elBL, this.elBR,
      this.elCross, this.elHit, this.elDmgNums, this.elProg, this.elPrompt, this.elDefuse,
      this.elBuyHint, this.elToastBox, this.elBanner, this.elScope, this.elBlood, this.elFlash,
      this.elDeath, this.elBombInd, this.elSb].concat(this.elArcs || []);
    for (const n of nodes) this._rm(n);
    this.root.classList.remove('hud-root');
    this.root.classList.remove('hud-hidden');
    this.root.classList.remove('hud-scoped');
    this._teamRows.clear();
    this._pips.T.length = 0;
    this._pips.CT.length = 0;
    this._shells.length = 0;
    this._death = null;
    this.game = null;
    return this;
  }
}


































