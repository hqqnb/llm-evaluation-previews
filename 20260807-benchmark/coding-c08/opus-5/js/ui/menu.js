// ============================================================================
// ui/menu.js — the front-end shell: main menu + match setup, settings,
// controls reference, pause overlay, end-of-match stats and loading screen.
// The whole DOM subtree is built inside the class (nothing DOM-ish runs at
// module scope) so the module stays importable in plain Node for the tests.
// ============================================================================

import {
  CFG, DIFFICULTY, DIFFICULTY_ORDER, TEAM, TEAM_LABEL, TEAM_COLOR, QUALITY, PHASE,
} from '../core/constants.js';
import { clamp, clamp01, fmtMoney } from '../core/util.js';

/** localStorage key holding the persisted settings block. */
export const CFG_STORE_KEY = 'cs_cfg';

const VERSION_LINE = 'v1.0.0 · WebGL 战术射击 · 单机人机对战';
const SCREEN_KEYS = ['main', 'settings', 'controls', 'pause', 'end', 'loading'];

// Fallback card metadata — overridden by whatever hooks.onMapPreview() returns.
const MAP_CARDS = [
  {
    id: 'dust2', cn: '炙热沙城 II', name: 'Dust II',
    desc: '经典三线沙漠图，中路视野直接决定长 A 与 B 通道的节奏。',
    tags: ['爆破模式', '5v5', '中远距离'],
  },
  {
    id: 'mirage', cn: '荒漠迷城', name: 'Mirage',
    desc: '中路控图为核心，A 点匪窟与 B 拱门互相牵制，封烟收益极高。',
    tags: ['爆破模式', '5v5', '道具封锁'],
  },
  {
    id: 'inferno', cn: '炼狱小镇', name: 'Inferno',
    desc: '狭窄街巷与香蕉道，卡点与燃烧瓶的价值远高于开阔对枪。',
    tags: ['爆破模式', '5v5', '近距离巷战'],
  },
];

// Hand-drawn schematics for the fallback previews. All values are normalised
// 0..1 inside the preview canvas: lanes are [x, y, w, h] corridors.
const MAP_SCHEMATIC = {
  dust2: {
    lanes: [
      [0.10, 0.28, 0.14, 0.34], [0.16, 0.58, 0.32, 0.14], [0.44, 0.22, 0.12, 0.62],
      [0.38, 0.44, 0.24, 0.08], [0.46, 0.24, 0.22, 0.13], [0.56, 0.34, 0.18, 0.09],
      [0.76, 0.20, 0.15, 0.54], [0.64, 0.60, 0.18, 0.10],
    ],
    sites: [{ k: 'A', x: 0.70, y: 0.07, w: 0.25, h: 0.16 }, { k: 'B', x: 0.06, y: 0.09, w: 0.23, h: 0.18 }],
    spawns: [{ t: 'T', x: 0.50, y: 0.90 }, { t: 'CT', x: 0.57, y: 0.30 }],
  },
  mirage: {
    lanes: [
      [0.10, 0.20, 0.17, 0.17], [0.26, 0.28, 0.12, 0.32], [0.42, 0.16, 0.12, 0.64],
      [0.52, 0.34, 0.17, 0.10], [0.60, 0.19, 0.15, 0.11], [0.72, 0.26, 0.14, 0.26],
      [0.30, 0.58, 0.26, 0.10], [0.62, 0.58, 0.22, 0.10],
    ],
    sites: [{ k: 'A', x: 0.06, y: 0.07, w: 0.26, h: 0.17 }, { k: 'B', x: 0.70, y: 0.07, w: 0.24, h: 0.17 }],
    spawns: [{ t: 'T', x: 0.48, y: 0.90 }, { t: 'CT', x: 0.48, y: 0.28 }],
  },
  inferno: {
    lanes: [
      [0.66, 0.24, 0.16, 0.44], [0.44, 0.32, 0.12, 0.36], [0.20, 0.32, 0.19, 0.24],
      [0.34, 0.20, 0.14, 0.16], [0.44, 0.13, 0.13, 0.14], [0.30, 0.62, 0.34, 0.11],
      [0.14, 0.44, 0.10, 0.24], [0.56, 0.44, 0.12, 0.09],
    ],
    sites: [{ k: 'A', x: 0.14, y: 0.06, w: 0.28, h: 0.17 }, { k: 'B', x: 0.62, y: 0.05, w: 0.28, h: 0.17 }],
    spawns: [{ t: 'T', x: 0.52, y: 0.91 }, { t: 'CT', x: 0.42, y: 0.24 }],
  },
};

// Short Chinese blurbs for the four bot difficulties.
const DIFF_DESC = {
  easy: '反应迟缓、枪法粗糙，用来熟悉地图与手感。',
  normal: '会架点也会轮转，压枪一般，接近路人局水平。',
  hard: '预瞄常见点位，压枪稳定，团队沟通积极。',
  expert: '近乎瞬狙、极限压枪，投掷物与包夹全开。',
};

// maxRounds === 0 means "no round limit" for the match module.
const ROUND_OPTIONS = [
  { id: 'mr8', label: 'MR8', rounds: 16, note: '先到 9 分' },
  { id: 'mr12', label: 'MR12', rounds: 24, note: '先到 13 分' },
  { id: 'mr15', label: 'MR15', rounds: 30, note: '先到 16 分' },
  { id: 'inf', label: '无限', rounds: 0, note: '不限回合' },
];

const QUALITY_LABEL = { low: '低', medium: '中', high: '高' };
const CROSSHAIR_SWATCHES = [
  '#39ff7a', '#00ffe1', '#ffffff', '#ffd23f', '#ff5964', '#7cc4ff', '#b688ff', '#ff9f1c',
];

const PHASE_LABEL = {
  [PHASE.MENU]: '主菜单', [PHASE.FREEZE]: '准备阶段', [PHASE.LIVE]: '战斗中',
  [PHASE.PLANTED]: '炸弹已安放', [PHASE.ROUND_END]: '回合结束',
  [PHASE.HALFTIME]: '中场交换', [PHASE.MATCH_END]: '比赛结束',
};
// Controls reference — only keys the game actually implements.
const KEY_GROUPS = [
  {
    title: '移动',
    rows: [
      { k: 'W A S D', d: '前后左右移动' },
      { k: '空格', d: '跳跃（落地会发出较大声响）' },
      { k: 'Ctrl', d: '下蹲（更精准、身位更低）' },
      { k: 'Shift', d: '静步（完全消除脚步声）' },
      { k: 'Alt', d: '战术冲刺（收枪加速，体力有限）' },
    ],
  },
  {
    title: '战斗',
    rows: [
      { k: '鼠标左键', d: '射击' },
      { k: '鼠标右键', d: '开镜 / 副功能' },
      { k: 'R', d: '换弹' },
      { k: '1 - 5', d: '切换武器：主武器 / 副武器 / 匕首 / 投掷物 / C4' },
      { k: 'Q', d: '切回上一把武器' },
      { k: 'G', d: '丢弃当前武器' },
    ],
  },
  {
    title: '交互与界面',
    rows: [
      { k: 'E', d: '使用 · 拆弹 · 拾取物品' },
      { k: 'B', d: '购买菜单（回合开始的购买时间内）' },
      { k: 'Tab', d: '记分板' },
      { k: 'M', d: '地图信息与点位名称' },
      { k: 'Esc', d: '暂停菜单' },
    ],
  },
];

const TACTICAL_TIPS = [
  { t: '控住中路', d: '中路视野等于同时威胁 A、B 两点，进攻选择和回防速度都会快对手一步。' },
  { t: '贴边架点', d: '紧贴掩体边缘架枪，只露出最小身位，被反打时一步就能缩回掩体。' },
  { t: '预瞄常见点', d: '过弯之前把准星提前放在敌人常站的位置和头线高度，先开枪的人赢下大半对枪。' },
  { t: '道具先进点', d: '烟雾封视野、闪光晃视角、燃烧逼位置，投掷物永远比身体先进点。' },
  { t: '经济纪律', d: '钱不够时全队一起 eco、一起买。凑出完整的枪加甲远比单人买枪有价值。' },
  { t: '听声辨位', d: '自己用 Shift 静步消音，同时把对手的跑动、换弹、下包声当成免费雷达。' },
];

const LOADING_TIPS = [
  '按住 Shift 静步不会发出脚步声，但移动速度会明显下降。',
  '移动中射击精度大幅下降，先停下、再点射。',
  '连发时缓慢向下压枪，可以抵消大部分后坐力。',
  'AWP 一枪致命，但拉栓与换弹期间几乎没有还手之力。',
  '头部伤害是胸部的 4 倍，把准星保持在头线高度。',
  '拆弹需要 10 秒，带拆弹器只要 5 秒——CT 值得优先购买。',
  '按 B 打开购买菜单，回合开始后的购买时间内才能下单。',
  '按 Tab 查看记分板，随时掌握敌我存活人数与经济。',
];
// --- inline SVG art (authored here, no external assets) --------------------
const SVG_T = '<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">'
  + '<path class="f1" d="M24 5c-6.3 0-10.6 4.4-10.6 10.8 0 2.3.5 4.3 1.5 6-1 .8-1.5 1.9-1.5 3.1V27h21.2v-2.1c0-1.2-.5-2.3-1.5-3.1 1-1.7 1.5-3.7 1.5-6C34.6 9.4 30.3 5 24 5z"/>'
  + '<rect class="f2" x="16.2" y="14.4" width="15.6" height="4.8" rx="2.4"/>'
  + '<path class="f1" d="M7 43c0-7 5.7-12.1 12.6-12.1h8.8C35.3 30.9 41 36 41 43z"/>'
  + '<path class="f3" d="M31.5 27l6.5 3.4-2.2 3.1-5.8-4z"/></svg>';
const SVG_CT = '<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">'
  + '<path class="f1" d="M24 4c-7.6 0-13.2 5.5-13.2 13.1V22h26.4v-4.9C37.2 9.5 31.6 4 24 4z"/>'
  + '<rect class="f2" x="13" y="16.8" width="22" height="5.6" rx="2.6"/>'
  + '<path class="f3" d="M11.4 24h25.2l-2.6 5.4H14z"/>'
  + '<path class="f1" d="M7 43c0-7 5.7-12.1 12.6-12.1h8.8C35.3 30.9 41 36 41 43z"/></svg>';
const SVG_RANDOM = '<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">'
  + '<path class="f1" d="M24 6a18 18 0 000 36z"/><path class="f4" d="M24 6a18 18 0 010 36z"/>'
  + '<path class="f2" d="M18.6 20.4c0-3 2.4-5.2 5.4-5.2s5.4 2.1 5.4 5c0 2.4-1.3 3.4-2.9 4.4-1.2.8-1.7 1.3-1.7 2.4v.8h-2.6v-1.2c0-2 .9-3 2.5-4 1.2-.8 1.8-1.3 1.8-2.3 0-1.3-1-2.2-2.5-2.2s-2.5 1-2.6 2.5z"/>'
  + '<circle class="f2" cx="24" cy="32.4" r="1.7"/></svg>';
const SVG_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
  + '<path d="M5 3.5l15 8.5-15 8.5z"/></svg>';
const SVG_GEAR = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
  + '<path d="M12 8.4A3.6 3.6 0 1012 15.6 3.6 3.6 0 0012 8.4zm9 3.6c0-.6-.05-1.2-.14-1.75l2.02-1.4-2-3.46-2.3.98a8.9 8.9 0 00-3-1.74L15.2 2h-4l-.38 2.63a8.9 8.9 0 00-3 1.74l-2.3-.98-2 3.46 2.02 1.4a9.6 9.6 0 000 3.5L3.52 15.2l2 3.46 2.3-.98a8.9 8.9 0 003 1.74L11.2 22h4l.38-2.58a8.9 8.9 0 003-1.74l2.3.98 2-3.46-2.02-1.4c.09-.55.14-1.15.14-1.8z"/></svg>';
const SVG_KEYS = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
  + '<path d="M3 6.5h18v11H3zm2.2 2.2v2.1h2.1V8.7zm3.6 0v2.1h2.1V8.7zm3.6 0v2.1h2.1V8.7zm3.6 0v2.1h2.1V8.7zM5.2 12.4v2.1h2.1v-2.1zm3.6 0v2.1h6.3v-2.1zm7.8 0v2.1h2.1v-2.1z"/></svg>';

let _seq = 0;
const nextId = (p) => `${p}${++_seq}`;
const isEl = (v) => !!v && typeof v === 'object' && (v.nodeType === 1 || typeof v.getContext === 'function');
const numOr = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
/**
 * The whole menu system. One instance owns one DOM subtree under `root`.
 *
 * hooks = {
 *   onStart(config), onResume(), onRestart(), onQuitToMenu(),
 *   onSettingsChange(cfg), onMapPreview(mapId), onSound(name)
 * }
 */
export class Menu {
  constructor(root, cfg, hooks = {}) {
    this.hooks = hooks || {};
    this.root = root || null;
    this.doc = (root && root.ownerDocument)
      || (typeof document !== 'undefined' ? document : null);
    this.win = (this.doc && this.doc.defaultView)
      || (typeof window !== 'undefined' ? window : null);

    // Work on the caller's object so the game sees every change live.
    this.cfg = (cfg && typeof cfg === 'object') ? cfg : {};
    for (const k of Object.keys(CFG)) {
      if (this.cfg[k] === undefined) this.cfg[k] = CFG[k];
    }
    Object.assign(this.cfg, Menu.loadCfg());

    this._state = 'closed';
    this._returnTo = 'main';
    this._teamChoice = this.cfg.team === TEAM.T ? TEAM.T : TEAM.CT;
    this._previewsReady = false;
    this._tipTimer = null;
    this._tipIndex = 0;
    this._game = null;
    this._result = null;
    this._syncers = [];
    this._focusSink = [];
    this.els = {};
    this.screens = {};
    this.mapCards = [];
    this.teamBtns = [];
    // Optional roster override: hooks.maps may be ['dust2', …] or
    // [{id, cn, name, desc, tags}, …]. Defaults to the built-in three.
    this.mapDefs = Menu._mapDefs(this.hooks.maps);

    this._build();
    this._bindKeys();
    this._applyAll();
    this._showState('closed');
  }

  get isOpen() { return this._state !== 'closed'; }
  get state() { return this._state; }
  // ==========================================================================
  // tiny DOM layer — every call guards for a minimal / fake document so the
  // class can be unit-tested outside a browser.
  // ==========================================================================
  _el(tag, cls, text) {
    const el = this.doc && typeof this.doc.createElement === 'function'
      ? this.doc.createElement(tag) : Menu._shim(tag);
    if (cls) this._cls(el, cls, true);
    if (text != null) el.textContent = String(text);
    return el;
  }

  _cls(el, cls, on) {
    if (!el || !cls) return;
    const parts = String(cls).split(/\s+/).filter(Boolean);
    if (el.classList && typeof el.classList.add === 'function') {
      for (const p of parts) (on ? el.classList.add(p) : el.classList.remove(p));
    } else {
      const cur = new Set(String(el.className || '').split(/\s+/).filter(Boolean));
      for (const p of parts) (on ? cur.add(p) : cur.delete(p));
      el.className = [...cur].join(' ');
    }
  }

  _attr(el, k, v) {
    if (!el) return;
    if (typeof el.setAttribute === 'function') el.setAttribute(k, String(v));
    else el[k] = v;
  }

  _cssVar(el, name, value) {
    if (!el || !el.style) return;
    if (typeof el.style.setProperty === 'function') el.style.setProperty(name, value);
    else el.style[name] = value;
  }

  _on(el, ev, fn) {
    if (el && typeof el.addEventListener === 'function') el.addEventListener(ev, fn);
  }

  _add(parent, ...kids) {
    if (!parent || typeof parent.appendChild !== 'function') return parent;
    for (const k of kids) if (k) parent.appendChild(k);
    return parent;
  }
  _clear(el) {
    if (!el) return;
    if (typeof el.replaceChildren === 'function') { el.replaceChildren(); return; }
    if (typeof el.innerHTML === 'string') el.innerHTML = '';
    if (Array.isArray(el.children)) el.children.length = 0;
  }

  _icon(svg, cls) {
    const s = this._el('span', cls || 'menu-ico');
    s.innerHTML = svg;                       // authored constant, never user data
    this._attr(s, 'aria-hidden', 'true');
    return s;
  }

  _canvas(w, h, cls) {
    const c = this._el('canvas', cls);
    c.width = w; c.height = h;
    return c;
  }

  _ctx(canvas) {
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    let ctx = null;
    try { ctx = canvas.getContext('2d'); } catch (e) { ctx = null; }
    return ctx || null;
  }

  static _shim(tag) {
    // Used only when there is no document at all (bare Node import smoke test).
    const noop = () => {};
    return {
      nodeType: 1, tagName: String(tag).toUpperCase(), children: [], style: {},
      dataset: {}, className: '', textContent: '', innerHTML: '', value: '',
      classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
      appendChild(c) { this.children.push(c); return c; },
      replaceChildren() { this.children.length = 0; },
      addEventListener: noop, removeEventListener: noop, setAttribute: noop,
      removeAttribute: noop, focus: noop, blur: noop, remove: noop,
      getContext: () => null,
    };
  }

  _call(name, ...args) {
    const fn = this.hooks && this.hooks[name];
    return typeof fn === 'function' ? fn(...args) : undefined;
  }

  _sfx(name) { this._call('onSound', name); }
  // ==========================================================================
  // widget factories — every interactive node is a real <button>/<input> so
  // native focus rings and keyboard activation work.
  // ==========================================================================
  /** @param {{cls?:string,icon?:string,sound?:string,aria?:string,sub?:string}} [o] */
  _button(label, onClick, o = {}) {
    const b = this._el('button', `menu-btn ${o.cls || ''}`);
    this._attr(b, 'type', 'button');
    if (o.icon) this._add(b, this._icon(o.icon, 'menu-btn-ico'));
    if (label != null) {
      const t = this._el('span', 'menu-btn-text', label);
      b._textEl = t;
      this._add(b, t);
    }
    if (o.sub) this._add(b, this._el('span', 'menu-btn-sub', o.sub));
    if (o.aria) this._attr(b, 'aria-label', o.aria);
    this._on(b, 'click', (e) => {
      this._sfx(o.sound || 'ui_click');
      if (onClick) onClick(e);
    });
    this._on(b, 'mouseenter', () => this._sfx('ui_hover'));
    this._on(b, 'focus', () => this._sfx('ui_hover'));
    this._focusSink.push(b);
    return b;
  }

  /** Row with a label, a value readout and an <input type=range>. */
  _slider(o) {
    const row = this._el('div', 'menu-row menu-row--slider');
    const head = this._el('div', 'menu-row-head');
    const id = nextId('mn-sl-');
    const lab = this._el('label', 'menu-row-label', o.label);
    lab.htmlFor = id;
    this._attr(lab, 'for', id);
    const val = this._el('span', 'menu-row-value');
    const hint = o.hint ? this._el('div', 'menu-row-hint') : null;
    const input = this._el('input', 'menu-slider');
    input.type = 'range';
    this._attr(input, 'type', 'range');
    input.min = String(o.min); input.max = String(o.max); input.step = String(o.step);
    this._attr(input, 'min', o.min); this._attr(input, 'max', o.max);
    this._attr(input, 'step', o.step);
    input.id = id;
    this._attr(input, 'id', id);
    this._attr(input, 'aria-label', o.label);

    const paint = (v) => {
      val.textContent = o.format ? o.format(v) : String(v);
      if (hint) hint.textContent = o.hint(v);
      this._cssVar(input, '--fill', `${(clamp01((v - o.min) / (o.max - o.min)) * 100).toFixed(1)}%`);
      this._attr(input, 'aria-valuetext', val.textContent);
    };
    this._on(input, 'input', (e) => {
      const raw = (e && e.target ? e.target.value : input.value);
      const v = clamp(numOr(Number(raw), o.min), o.min, o.max);
      o.set(v);
      paint(v);
      this._commit();
    });
    this._on(input, 'change', () => this._sfx('ui_click'));

    this._syncers.push(() => {
      const v = clamp(numOr(Number(o.get()), o.min), o.min, o.max);
      input.value = String(v);
      paint(v);
    });
    this._add(head, lab, val);
    this._add(row, head, input);
    if (hint) this._add(row, hint);
    this._focusSink.push(input);
    return row;
  }

  /** Row with a label and an on/off switch button. */
  _switch(o) {
    const row = this._el('div', 'menu-row menu-row--switch');
    const box = this._el('div', 'menu-row-head');
    const lab = this._el('span', 'menu-row-label', o.label);
    const btn = this._el('button', 'menu-switch');
    this._attr(btn, 'type', 'button');
    this._attr(btn, 'role', 'switch');
    this._attr(btn, 'aria-label', o.label);
    this._add(btn, this._el('span', 'menu-switch-track', ''), this._el('span', 'menu-switch-knob', ''));
    const state = this._el('span', 'menu-switch-state');
    const paint = (on) => {
      this._cls(btn, 'is-on', !!on);
      this._attr(btn, 'aria-checked', on ? 'true' : 'false');
      state.textContent = on ? '开' : '关';
    };
    this._on(btn, 'click', () => {
      const next = !o.get();
      o.set(next);
      paint(next);
      this._sfx('ui_click');
      this._commit();
    });
    this._on(btn, 'mouseenter', () => this._sfx('ui_hover'));
    this._syncers.push(() => paint(!!o.get()));
    this._add(box, lab, state, btn);
    this._add(row, box);
    if (o.hint) this._add(row, this._el('div', 'menu-row-hint', o.hint));
    this._focusSink.push(btn);
    return row;
  }
  /** Row of mutually exclusive chips (radiogroup). */
  _chips(o) {
    const row = this._el('div', `menu-row menu-row--chips ${o.cls || ''}`);
    if (o.label) this._add(row, this._el('div', 'menu-row-label', o.label));
    const group = this._el('div', 'menu-chips');
    this._attr(group, 'role', 'radiogroup');
    if (o.label) this._attr(group, 'aria-label', o.label);
    const desc = o.showDesc ? this._el('div', 'menu-row-hint menu-row-hint--desc') : null;
    const items = [];
    for (const opt of o.options) {
      const b = this._el('button', 'menu-chip');
      this._attr(b, 'type', 'button');
      this._attr(b, 'role', 'radio');
      this._add(b, this._el('span', 'menu-chip-label', opt.label));
      if (opt.sub) this._add(b, this._el('span', 'menu-chip-sub', opt.sub));
      this._on(b, 'click', () => {
        o.set(opt.value);
        this._sfx('ui_click');
        paint();
        this._commit();
      });
      this._on(b, 'mouseenter', () => this._sfx('ui_hover'));
      this._focusSink.push(b);
      items.push({ opt, b });
      this._add(group, b);
    }
    const paint = () => {
      const cur = o.get();
      let hit = null;
      for (const it of items) {
        const on = it.opt.value === cur;
        if (on) hit = it.opt;
        this._cls(it.b, 'is-active', on);
        this._attr(it.b, 'aria-checked', on ? 'true' : 'false');
      }
      if (desc) desc.textContent = (hit && hit.desc) || '';
    };
    this._syncers.push(paint);
    this._add(row, group);
    if (desc) this._add(row, desc);
    return row;
  }

  _panel(title, hint, cls) {
    const sec = this._el('section', `menu-panel ${cls || ''}`);
    const head = this._el('div', 'menu-panel-head');
    this._add(head, this._el('h2', 'menu-panel-title', title));
    if (hint) this._add(head, this._el('p', 'menu-panel-hint', hint));
    this._add(sec, head);
    const body = this._el('div', 'menu-panel-body');
    this._add(sec, body);
    return { sec, body };
  }
  // ==========================================================================
  // build
  // ==========================================================================
  _build() {
    const wrap = this._el('div', 'menu-root menu-hidden');
    this._attr(wrap, 'role', 'dialog');
    this._attr(wrap, 'aria-modal', 'true');
    this._attr(wrap, 'aria-label', '战术射击 主菜单');
    this.els.wrap = wrap;
    this._add(wrap, this._buildBackdrop());

    const build = { main: '_buildMain', settings: '_buildSettings', controls: '_buildControls',
      pause: '_buildPause', end: '_buildEnd', loading: '_buildLoading' };
    for (const key of SCREEN_KEYS) {
      this._focusSink = [];
      const el = this[build[key]]();
      this.screens[key] = { el, focus: this._focusSink, key };
      this._add(wrap, el);
    }
    this._focusSink = [];
    if (this.root && typeof this.root.appendChild === 'function') this.root.appendChild(wrap);
  }

  _buildBackdrop() {
    const bg = this._el('div', 'menu-bg');
    this._attr(bg, 'aria-hidden', 'true');
    this._add(bg,
      this._el('div', 'menu-bg-grad'),
      this._el('div', 'menu-bg-stripe'),
      this._el('div', 'menu-bg-grain'),
      this._el('div', 'menu-bg-scan'),
      this._el('div', 'menu-bg-vignette'));
    return bg;
  }

  _screen(key, cls) {
    const s = this._el('section', `menu-screen menu-screen--${key} menu-hidden ${cls || ''}`);
    this._attr(s, 'aria-hidden', 'true');
    return s;
  }

  _buildMain() {
    const s = this._screen('main');
    const inner = this._el('div', 'menu-main');

    const header = this._el('header', 'menu-title-block');
    const logo = this._el('div', 'menu-logo');
    this._add(logo,
      this._el('span', 'menu-logo-cn', '战术射击'),
      this._el('span', 'menu-logo-en', 'TACTICAL STRIKE'),
      this._el('span', 'menu-logo-tex'));
    this._add(header, logo, this._el('p', 'menu-version', VERSION_LINE));

    // --- map selection ---
    const maps = this._panel('选择地图', '点击卡片切换战场', 'menu-panel--maps');
    const grid = this._el('div', 'menu-map-grid');
    this._attr(grid, 'role', 'radiogroup');
    this._attr(grid, 'aria-label', '选择地图');
    for (const def of this.mapDefs) this._add(grid, this._buildMapCard(def));
    this._add(maps.body, grid);

    // --- team + match rules ---
    const cols = this._el('div', 'menu-cols');
    const team = this._panel('选择阵营', '随机会在开局时抽签决定', 'menu-panel--team');
    const teamRow = this._el('div', 'menu-team-row');
    this._attr(teamRow, 'role', 'radiogroup');
    this._attr(teamRow, 'aria-label', '选择阵营');
    this._add(teamRow,
      this._buildTeamBtn(TEAM.T, TEAM_LABEL[TEAM.T], SVG_T, '进攻 · 下包'),
      this._buildTeamBtn(TEAM.CT, TEAM_LABEL[TEAM.CT], SVG_CT, '防守 · 拆弹'),
      this._buildTeamBtn('random', '随机', SVG_RANDOM, '抽签分配'));
    this.els.teamHint = this._el('p', 'menu-team-hint');
    this._add(team.body, teamRow, this.els.teamHint);

    const rules = this._panel('对局设置', '影响 AI 数量、强度与赛制', 'menu-panel--rules');
    this._add(rules.body, this._buildBotRow(), this._buildDiffRow(),
      this._buildRoundsRow(), this._buildFfRow());
    this._add(cols, team.sec, rules.sec);

    // --- actions ---
    const actions = this._el('div', 'menu-actions');
    const start = this._button('开始对局', () => this._startMatch(),
      { cls: 'menu-btn--primary menu-btn--start', icon: SVG_PLAY, sub: 'ENTER' });
    this._add(actions, start,
      this._button('设置', () => this.showSettings(), { cls: 'menu-btn--ghost', icon: SVG_GEAR }),
      this._button('操作说明', () => this.showControls(), { cls: 'menu-btn--ghost', icon: SVG_KEYS }));

    this._add(inner, header, maps.sec, cols, actions,
      this._el('p', 'menu-foot-note', '游戏中按 Esc 暂停 · Tab 记分板 · B 购买 · 鼠标锁定后开始射击'));
    this._add(s, inner);
    this.els.primary_main = start;
    return s;
  }
  _buildMapCard(def) {
    const card = this._el('button', 'menu-map-card');
    this._attr(card, 'type', 'button');
    this._attr(card, 'role', 'radio');
    if (card.dataset) card.dataset.map = def.id;
    this._attr(card, 'data-map', def.id);

    const shot = this._el('span', 'menu-map-preview');
    const canvas = this._canvas(480, 270, 'menu-map-canvas');
    this._attr(canvas, 'aria-hidden', 'true');
    this._add(shot, canvas, this._el('span', 'menu-map-gloss'));

    const body = this._el('span', 'menu-map-body');
    const nameRow = this._el('span', 'menu-map-name');
    const cn = this._el('b', 'menu-map-cn', def.cn);
    const en = this._el('i', 'menu-map-en', def.name);
    this._add(nameRow, cn, en);
    const desc = this._el('span', 'menu-map-desc', def.desc);
    const tags = this._el('span', 'menu-map-tags');
    this._add(body, nameRow, desc, tags);
    this._add(card, shot, body, this._el('span', 'menu-map-check', '已选择'));

    this._on(card, 'click', () => { this._sfx('ui_click'); this._setMap(def.id); });
    this._on(card, 'mouseenter', () => this._sfx('ui_hover'));
    this._focusSink.push(card);

    const rec = { def, card, canvas, shot, cn, en, desc, tags, custom: false, idx: this.mapCards.length };
    this._fillTags(rec, def.tags);
    this.mapCards.push(rec);
    this._syncers.push(() => {
      const on = this.cfg.map === def.id;
      this._cls(card, 'is-active', on);
      this._attr(card, 'aria-checked', on ? 'true' : 'false');
    });
    return card;
  }

  _fillTags(rec, list) {
    this._clear(rec.tags);
    const arr = Array.isArray(list) && list.length ? list : rec.def.tags;
    for (const t of arr) this._add(rec.tags, this._el('em', 'menu-map-tag', String(t)));
  }

  _buildTeamBtn(value, label, svg, sub) {
    const b = this._el('button', 'menu-team-btn');
    this._attr(b, 'type', 'button');
    this._attr(b, 'role', 'radio');
    this._attr(b, 'data-team', value);
    if (b.dataset) b.dataset.team = value;
    this._add(b, this._icon(svg, 'menu-team-art'),
      this._el('span', 'menu-team-name', label),
      this._el('span', 'menu-team-sub', sub));
    if (value === TEAM.T || value === TEAM.CT) {
      this._cssVar(b, '--team-color', TEAM_COLOR[value]);
    }
    this._on(b, 'click', () => { this._sfx('ui_click'); this._setTeam(value); });
    this._on(b, 'mouseenter', () => this._sfx('ui_hover'));
    this._focusSink.push(b);
    this.teamBtns.push({ value, b });
    this._syncers.push(() => {
      const on = this._teamChoice === value;
      this._cls(b, 'is-active', on);
      this._attr(b, 'aria-checked', on ? 'true' : 'false');
    });
    return b;
  }

  _buildBotRow() {
    const row = this._slider({
      label: '对局人数',
      min: 2, max: 10, step: 1,
      get: () => clamp(Math.round(numOr(this.cfg.botCount, CFG.botCount)) + 1, 2, 10),
      set: (v) => { this.cfg.botCount = Math.round(v) - 1; },
      format: (v) => `${Math.round(v)} 人`,
      hint: (v) => {
        const total = Math.round(v);
        return `你 + ${total - 1} 名 AI · ${Math.ceil(total / 2)} v ${Math.floor(total / 2)}`;
      },
    });
    return row;
  }

  _buildDiffRow() {
    return this._chips({
      label: 'AI 难度',
      showDesc: true,
      options: DIFFICULTY_ORDER.map((id) => ({
        value: id,
        label: (DIFFICULTY[id] && DIFFICULTY[id].label) || id,
        desc: DIFF_DESC[id] || '',
      })),
      get: () => (DIFFICULTY[this.cfg.difficulty] ? this.cfg.difficulty : CFG.difficulty),
      set: (v) => { this.cfg.difficulty = v; },
    });
  }
  _buildRoundsRow() {
    return this._chips({
      label: '赛制',
      showDesc: true,
      options: ROUND_OPTIONS.map((r) => ({
        value: r.rounds, label: r.label, sub: r.note,
        desc: r.rounds ? `最多 ${r.rounds} 回合，${r.note}，第 ${r.rounds / 2} 回合后交换阵营。`
          : '不限回合，双方一直打下去，可随时从暂停菜单退出。',
      })),
      get: () => this._roundsValue(),
      set: (v) => { this.cfg.maxRounds = v; },
    });
  }

  /** Snap cfg.maxRounds onto one of the offered presets for display. */
  _roundsValue() {
    const v = numOr(this.cfg.maxRounds, CFG.maxRounds);
    if (!v || v <= 0) return 0;
    let best = ROUND_OPTIONS[1].rounds, bestD = Infinity;
    for (const r of ROUND_OPTIONS) {
      if (!r.rounds) continue;
      const d = Math.abs(r.rounds - v);
      if (d < bestD) { bestD = d; best = r.rounds; }
    }
    return best;
  }

  _buildFfRow() {
    return this._switch({
      label: '友军伤害',
      hint: '开启后队友的子弹与手雷同样会造成伤害，误杀会扣钱。',
      get: () => !!this.cfg.friendlyFire,
      set: (v) => { this.cfg.friendlyFire = !!v; },
    });
  }

  // ==========================================================================
  // settings screen
  // ==========================================================================
  _buildSettings() {
    const s = this._screen('settings');
    const inner = this._el('div', 'menu-sheet');
    const head = this._el('header', 'menu-sheet-head');
    this._add(head, this._el('h1', 'menu-sheet-title', '设置'),
      this._el('p', 'menu-sheet-sub', '所有改动即时生效并自动保存到本地'));
    const back = this._button('返回', () => this._back(), { cls: 'menu-btn--ghost menu-btn--back', sound: 'ui_back' });
    this.els.settingsBack = back;
    this._add(head, back);

    const grid = this._el('div', 'menu-settings-grid');
    this._add(grid, this._buildAimPanel(), this._buildAudioPanel(),
      this._buildCrosshairPanel(), this._buildVideoPanel());
    const foot = this._el('div', 'menu-sheet-foot');
    this._add(foot,
      this._button('重置默认', () => this._resetDefaults(), { cls: 'menu-btn--warn' }),
      this._el('p', 'menu-foot-note', '配置保存在浏览器本地存储（cs_cfg），清理站点数据会恢复默认。'));
    this._add(inner, head, grid, foot);
    this._add(s, inner);
    this.els.primary_settings = back;
    return s;
  }

  _buildAimPanel() {
    const p = this._panel('鼠标与视角', '灵敏度按 800 DPI 换算');
    this._add(p.body,
      this._slider({
        label: '鼠标灵敏度', min: 0.5, max: 6, step: 0.05,
        get: () => this.cfg.sensitivity,
        set: (v) => { this.cfg.sensitivity = v; },
        format: (v) => v.toFixed(2),
        hint: (v) => `转身 360° 需要 ${Menu.cmPer360(v).toFixed(1)} cm（@800 DPI）`,
      }),
      this._slider({
        label: '视野 FOV', min: 75, max: 110, step: 1,
        get: () => this.cfg.fov,
        set: (v) => { this.cfg.fov = Math.round(v); },
        format: (v) => `${Math.round(v)}°`,
        hint: (v) => (v >= 100 ? '视野开阔，边缘畸变更明显' : v <= 82 ? '视野收窄，远距离目标更大' : '标准竞技视野'),
      }),
      this._switch({
        label: '垂直反转',
        hint: '开启后向上推鼠标视角向下。',
        get: () => !!this.cfg.invertY,
        set: (v) => { this.cfg.invertY = !!v; },
      }),
      this._slider({
        label: '武器晃动幅度', min: 0, max: 2, step: 0.05,
        get: () => this.cfg.bobScale,
        set: (v) => { this.cfg.bobScale = v; },
        format: (v) => `${Math.round(v * 100)}%`,
        hint: (v) => (v === 0 ? '完全关闭视角与枪身晃动' : '影响跑动时枪身的摆动强度'),
      }));
    return p.sec;
  }
  _buildAudioPanel() {
    const p = this._panel('音频', '脚步声是最重要的信息来源');
    const pct = (v) => `${Math.round(v * 100)}%`;
    this._add(p.body,
      this._slider({
        label: '主音量', min: 0, max: 1, step: 0.01,
        get: () => this.cfg.masterVolume,
        set: (v) => { this.cfg.masterVolume = v; },
        format: pct,
        hint: (v) => (v === 0 ? '已静音' : '控制所有声音的总输出'),
      }),
      this._slider({
        label: '音效音量', min: 0, max: 1, step: 0.01,
        get: () => this.cfg.sfxVolume,
        set: (v) => { this.cfg.sfxVolume = v; },
        format: pct,
        hint: () => '枪声、脚步、爆炸与语音',
      }),
      this._slider({
        label: '音乐音量', min: 0, max: 1, step: 0.01,
        get: () => this.cfg.musicVolume,
        set: (v) => { this.cfg.musicVolume = v; },
        format: pct,
        hint: () => '菜单与回合结束的氛围音乐',
      }));
    return p.sec;
  }

  _buildCrosshairPanel() {
    const p = this._panel('准星', '实时预览，改动立刻同步到游戏内', 'menu-panel--xhair');
    const preview = this._el('div', 'menu-xhair-preview');
    const canvas = this._canvas(640, 360, 'menu-xhair-canvas');
    this._attr(canvas, 'aria-hidden', 'true');
    this._add(preview, canvas, this._el('span', 'menu-xhair-tag', '预览'));
    this.els.xhairCanvas = canvas;

    const sw = this._el('div', 'menu-row menu-row--swatches');
    this._add(sw, this._el('div', 'menu-row-label', '颜色'));
    const swBox = this._el('div', 'menu-swatches');
    this._attr(swBox, 'role', 'radiogroup');
    this._attr(swBox, 'aria-label', '准星颜色');
    const swItems = [];
    for (const color of CROSSHAIR_SWATCHES) {
      const b = this._el('button', 'menu-swatch');
      this._attr(b, 'type', 'button');
      this._attr(b, 'role', 'radio');
      this._attr(b, 'aria-label', `准星颜色 ${color}`);
      this._cssVar(b, '--sw', color);
      this._on(b, 'click', () => {
        this.cfg.crosshairColor = color;
        this._sfx('ui_click');
        paintSw();
        this._commit();
      });
      this._on(b, 'mouseenter', () => this._sfx('ui_hover'));
      this._focusSink.push(b);
      swItems.push({ color, b });
      this._add(swBox, b);
    }
    const paintSw = () => {
      for (const it of swItems) {
        const on = String(this.cfg.crosshairColor).toLowerCase() === it.color.toLowerCase();
        this._cls(it.b, 'is-active', on);
        this._attr(it.b, 'aria-checked', on ? 'true' : 'false');
      }
    };
    this._syncers.push(paintSw);
    this._add(sw, swBox);

    this._add(p.body, preview, sw,
      this._slider({
        label: '长度', min: 1, max: 20, step: 1,
        get: () => this.cfg.crosshairSize,
        set: (v) => { this.cfg.crosshairSize = Math.round(v); },
        format: (v) => String(Math.round(v)),
      }),
      this._slider({
        label: '间隙', min: 0, max: 12, step: 1,
        get: () => this.cfg.crosshairGap,
        set: (v) => { this.cfg.crosshairGap = Math.round(v); },
        format: (v) => String(Math.round(v)),
      }),
      this._slider({
        label: '粗细', min: 1, max: 6, step: 1,
        get: () => this.cfg.crosshairThickness,
        set: (v) => { this.cfg.crosshairThickness = Math.round(v); },
        format: (v) => String(Math.round(v)),
      }),
      this._switch({
        label: '中心点',
        get: () => !!this.cfg.crosshairDot,
        set: (v) => { this.cfg.crosshairDot = !!v; },
      }),
      this._switch({
        label: '动态扩散',
        hint: '开启后准星会随移动与射击扩散，直观反映当前精度。',
        get: () => !!this.cfg.crosshairDynamic,
        set: (v) => { this.cfg.crosshairDynamic = !!v; },
      }));
    return p.sec;
  }
  _buildVideoPanel() {
    const p = this._panel('画面与界面', '帧数不足时优先降低画质');
    const qKeys = Object.keys(QUALITY);
    this._add(p.body,
      this._chips({
        label: '画质', showDesc: true,
        options: qKeys.map((id) => {
          const q = QUALITY[id] || {};
          return {
            value: id, label: QUALITY_LABEL[id] || id,
            desc: `阴影 ${q.shadowMap ? `${q.shadowMap}px` : '关闭'} · 粒子 ${q.particles}× `
              + `· 弹孔 ${q.decals} · 渲染倍率 ${q.pixelRatio}×`,
          };
        }),
        get: () => (QUALITY[this.cfg.quality] ? this.cfg.quality : CFG.quality),
        set: (v) => { this.cfg.quality = v; },
      }),
      this._switch({
        label: '动态阴影',
        hint: '关闭可显著提升帧数，但会失去阴影提供的位置线索。',
        get: () => !!this.cfg.shadows,
        set: (v) => { this.cfg.shadows = !!v; },
      }),
      this._switch({
        label: '显示帧数',
        get: () => !!this.cfg.showFps,
        set: (v) => { this.cfg.showFps = !!v; },
      }));
    return p.sec;
  }

  // ==========================================================================
  // controls screen
  // ==========================================================================
  _buildControls() {
    const s = this._screen('controls');
    const inner = this._el('div', 'menu-sheet');
    const head = this._el('header', 'menu-sheet-head');
    this._add(head, this._el('h1', 'menu-sheet-title', '操作说明'),
      this._el('p', 'menu-sheet-sub', '键位固定，鼠标锁定后即可行动'));
    const back = this._button('返回', () => this._back(), { cls: 'menu-btn--ghost menu-btn--back', sound: 'ui_back' });
    this.els.controlsBack = back;
    this._add(head, back);

    const grid = this._el('div', 'menu-keys-grid');
    for (const g of KEY_GROUPS) this._add(grid, this._buildKeyGroup(g));
    this._add(grid, this._buildTipsBlock());
    this._add(inner, head, grid);
    this._add(s, inner);
    this.els.primary_controls = back;
    return s;
  }
  _buildKeyGroup(group) {
    const sec = this._el('section', 'menu-panel menu-panel--keys');
    const head = this._el('div', 'menu-panel-head');
    this._add(head, this._el('h2', 'menu-panel-title', group.title));
    const table = this._el('table', 'menu-keytable');
    const cap = this._el('caption', 'menu-sr', `${group.title}键位`);
    const tbody = this._el('tbody', '');
    for (const r of group.rows) {
      const tr = this._el('tr', 'menu-keyrow');
      const th = this._el('th', 'menu-key');
      this._attr(th, 'scope', 'row');
      for (const part of String(r.k).split(' ')) {
        if (!part) continue;
        // a bare dash is a range separator ("1 - 5"), not a key cap
        if (part === '-' || part === '–') {
          this._add(th, this._el('span', 'menu-key-sep', '–'));
          continue;
        }
        this._add(th, this._el('kbd', 'menu-kbd', part));
      }
      this._add(tr, th, this._el('td', 'menu-keydesc', r.d));
      this._add(tbody, tr);
    }
    this._add(table, cap, tbody);
    this._add(sec, head, table);
    return sec;
  }

  _buildTipsBlock() {
    const sec = this._el('section', 'menu-panel menu-panel--tips');
    const head = this._el('div', 'menu-panel-head');
    this._add(head, this._el('h2', 'menu-panel-title', '战术提示'),
      this._el('p', 'menu-panel-hint', '六条能立刻提升胜率的习惯'));
    const list = this._el('ol', 'menu-tips');
    for (const t of TACTICAL_TIPS) {
      const li = this._el('li', 'menu-tip');
      this._add(li, this._el('strong', 'menu-tip-title', t.t),
        this._el('span', 'menu-tip-text', t.d));
      this._add(list, li);
    }
    this._add(sec, head, list);
    return sec;
  }

  // ==========================================================================
  // pause screen
  // ==========================================================================
  _buildPause() {
    const s = this._screen('pause');
    const card = this._el('div', 'menu-pause-card');
    const head = this._el('header', 'menu-pause-head');
    this.els.pauseSub = this._el('p', 'menu-pause-sub', '');
    this._add(head, this._el('h1', 'menu-pause-title', '已暂停'), this.els.pauseSub);
    const score = this._el('div', 'menu-score');
    this.els.pauseScoreT = this._buildScorePill(TEAM.T);
    this.els.pauseScoreCT = this._buildScorePill(TEAM.CT);
    this._add(score, this.els.pauseScoreT.el,
      this._el('span', 'menu-score-sep', 'VS'), this.els.pauseScoreCT.el);

    const body = this._el('div', 'menu-pause-body');
    const nav = this._el('nav', 'menu-pause-actions');
    this._attr(nav, 'aria-label', '暂停菜单');
    const resume = this._button('继续游戏', () => this.resume(),
      { cls: 'menu-btn--primary', icon: SVG_PLAY, sub: 'ESC' });
    this._add(nav, resume,
      this._button('重新开始本局', () => { this.hide(); this._call('onRestart'); }, { cls: 'menu-btn--ghost' }),
      this._button('设置', () => this.showSettings(), { cls: 'menu-btn--ghost', icon: SVG_GEAR }),
      this._button('返回主菜单', () => { this.showMain(); this._call('onQuitToMenu'); },
        { cls: 'menu-btn--ghost menu-btn--danger', sound: 'ui_back' }));

    const board = this._el('div', 'menu-miniboard');
    this.els.miniBoard = board;
    this._add(body, nav, board);
    this._add(card, head, score, body);
    this._add(s, card);
    this.els.primary_pause = resume;
    return s;
  }

  _buildScorePill(team) {
    const el = this._el('div', 'menu-score-pill');
    this._attr(el, 'data-team', team);
    this._cssVar(el, '--team-color', TEAM_COLOR[team]);
    const name = this._el('span', 'menu-score-team', TEAM_LABEL[team]);
    const val = this._el('span', 'menu-score-value', '0');
    this._add(el, name, val);
    return { el, val, name };
  }

  // ==========================================================================
  // end screen
  // ==========================================================================
  _buildEnd() {
    const s = this._screen('end');
    const inner = this._el('div', 'menu-end');
    const banner = this._el('div', 'menu-end-banner');
    this.els.endBanner = banner;
    this.els.endWinner = this._el('h1', 'menu-end-winner', '比赛结束');
    this.els.endReason = this._el('p', 'menu-end-reason', '');
    this._add(banner, this._el('span', 'menu-end-wipe'), this.els.endWinner, this.els.endReason);
    const score = this._el('div', 'menu-score menu-score--end');
    this.els.endScoreT = this._buildScorePill(TEAM.T);
    this.els.endScoreCT = this._buildScorePill(TEAM.CT);
    this._add(score, this.els.endScoreT.el,
      this._el('span', 'menu-score-sep', ':'), this.els.endScoreCT.el);

    const main = this._el('div', 'menu-end-main');
    const mvp = this._el('div', 'menu-mvp-card');
    this.els.mvpCard = mvp;
    const table = this._el('table', 'menu-stats');
    this._add(table, this._el('caption', 'menu-sr', '本场数据统计'));
    const thead = this._el('thead', '');
    const hr = this._el('tr', '');
    for (const [t, cls] of [['玩家', 'menu-st-name'], ['K', ''], ['A', ''], ['D', ''], ['ADR', ''], ['MVP', '']]) {
      const th = this._el('th', cls, t);
      this._attr(th, 'scope', 'col');
      this._add(hr, th);
    }
    this._add(thead, hr);
    this.els.statsBody = this._el('tbody', '');
    this._add(table, thead, this.els.statsBody);
    this._add(main, mvp, table);

    const actions = this._el('div', 'menu-actions menu-actions--end');
    const again = this._button('再来一局', () => { this.hide(); this._call('onRestart'); },
      { cls: 'menu-btn--primary', icon: SVG_PLAY, sub: 'ENTER' });
    this._add(actions, again,
      this._button('返回主菜单', () => { this.showMain(); this._call('onQuitToMenu'); },
        { cls: 'menu-btn--ghost', sound: 'ui_back' }));

    this._add(inner, banner, score, main, actions);
    this._add(s, inner);
    this.els.primary_end = again;
    return s;
  }

  // ==========================================================================
  // loading screen
  // ==========================================================================
  _buildLoading() {
    const s = this._screen('loading');
    const box = this._el('div', 'menu-loading');
    this.els.loadTitle = this._el('h1', 'menu-loading-title', '正在载入战场');
    this.els.loadText = this._el('p', 'menu-loading-text', '');
    const barWrap = this._el('div', 'menu-progress');
    this._attr(barWrap, 'role', 'progressbar');
    this._attr(barWrap, 'aria-valuemin', '0');
    this._attr(barWrap, 'aria-valuemax', '100');
    this.els.loadBar = this._el('span', 'menu-progress-fill');
    this.els.loadPct = this._el('span', 'menu-progress-pct', '0%');
    this._add(barWrap, this.els.loadBar);
    this.els.loadTip = this._el('p', 'menu-loading-tip', '');
    this.els.progressWrap = barWrap;
    this._add(box, this.els.loadTitle, this.els.loadText, barWrap,
      this.els.loadPct, this.els.loadTip);
    this._add(s, box);
    return s;
  }

  // ==========================================================================
  // public screen API
  // ==========================================================================
  showMain() {
    this._ensurePreviews();
    this._applyAll();
    this._returnTo = 'main';
    this._showState('main');
    return this;
  }

  showSettings() {
    if (this._state === 'pause') this._returnTo = 'pause';
    else if (this._state !== 'settings' && this._state !== 'controls') this._returnTo = 'main';
    this._applyAll();
    this._drawCrosshair();
    if (this.els.settingsBack) {
      const t = this.els.settingsBack;
      const label = this._returnTo === 'pause' ? '返回暂停菜单' : '返回主菜单';
      this._attr(t, 'aria-label', label);
      if (t._textEl) t._textEl.textContent = label;
    }
    this._showState('settings');
    return this;
  }

  showControls() {
    if (this._state === 'pause') this._returnTo = 'pause';
    else if (this._state !== 'settings' && this._state !== 'controls') this._returnTo = 'main';
    this._showState('controls');
    return this;
  }

  showPause(game) {
    if (game) this._game = game;
    this._fillPause(this._game);
    this._returnTo = 'pause';
    this._showState('pause');
    return this;
  }
  showEnd(result) {
    this._result = result || null;
    this._fillEnd(this._result);
    this._showState('end');
    return this;
  }

  showLoading(text, progress) {
    if (this.els.loadText) {
      this.els.loadText.textContent = text == null ? '正在生成地图与导航网格…' : String(text);
    }
    this.setProgress(progress);
    this._showState('loading');
    this._startTips();
    return this;
  }

  /** Update the loading bar without changing screens. */
  setProgress(progress) {
    const p = clamp01(numOr(Number(progress), 0));
    const pct = `${Math.round(p * 100)}%`;
    if (this.els.loadBar && this.els.loadBar.style) this.els.loadBar.style.width = pct;
    if (this.els.loadPct) this.els.loadPct.textContent = pct;
    this._attr(this.els.progressWrap, 'aria-valuenow', String(Math.round(p * 100)));
    return this;
  }

  hide() {
    this._stopTips();
    this._showState('closed');
    return this;
  }

  /** Leave the pause overlay and hand control back to the game. */
  resume() {
    this.hide();
    this._call('onResume');
    return this;
  }

  /** Detach from the DOM and drop the global key listener. */
  destroy() {
    this._stopTips();
    if (this._keyTarget && this._keyHandler
      && typeof this._keyTarget.removeEventListener === 'function') {
      this._keyTarget.removeEventListener('keydown', this._keyHandler, true);
    }
    this._keyHandler = null;
    const w = this.els.wrap;
    if (w && typeof w.remove === 'function') w.remove();
    else if (w && this.root && typeof this.root.removeChild === 'function') this.root.removeChild(w);
  }
  // ==========================================================================
  // state
  // ==========================================================================
  _showState(state) {
    this._state = state;
    const open = state !== 'closed';
    const wrap = this.els.wrap;
    this._cls(wrap, 'menu-hidden', !open);
    this._cls(wrap, 'is-pause', state === 'pause');
    this._cls(wrap, 'is-blur', state === 'pause' || state === 'end');
    if (wrap && wrap.style) wrap.style.display = open ? '' : 'none';
    this._attr(wrap, 'aria-hidden', open ? 'false' : 'true');
    if (wrap && wrap.dataset) wrap.dataset.screen = state;

    for (const key of SCREEN_KEYS) {
      const sc = this.screens[key];
      if (!sc) continue;
      const on = open && key === state;
      this._cls(sc.el, 'menu-hidden', !on);
      if (sc.el && sc.el.style) sc.el.style.display = on ? '' : 'none';
      this._attr(sc.el, 'aria-hidden', on ? 'false' : 'true');
    }
    if (state !== 'loading') this._stopTips();
    if (open) this._focusFirst(state);
  }

  _focusFirst(state) {
    const primary = this.els[`primary_${state}`];
    const sc = this.screens[state];
    const el = primary || (sc && sc.focus && sc.focus[0]);
    if (el && typeof el.focus === 'function') {
      try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    }
  }

  _startTips() {
    if (this._tipTimer) return;
    this._showTip();
    if (typeof setInterval !== 'function') return;
    this._tipTimer = setInterval(() => this._showTip(1), 4200);
    if (this._tipTimer && typeof this._tipTimer.unref === 'function') this._tipTimer.unref();
  }

  _stopTips() {
    if (this._tipTimer && typeof clearInterval === 'function') clearInterval(this._tipTimer);
    this._tipTimer = null;
  }

  _showTip(step = 0) {
    if (step) this._tipIndex = (this._tipIndex + step) % LOADING_TIPS.length;
    if (this.els.loadTip) this.els.loadTip.textContent = `提示 · ${LOADING_TIPS[this._tipIndex]}`;
  }
  // ==========================================================================
  // config plumbing
  // ==========================================================================
  /** Push cfg → every widget. */
  _applyAll() {
    for (const fn of this._syncers) fn();
    this._syncTeamHint();
    this._drawCrosshair();
  }

  /** Persist + notify the game. Called after every single interaction. */
  _commit() {
    Menu.saveCfg(this.cfg);
    this._call('onSettingsChange', this.cfg);
    this._drawCrosshair();
  }

  _setMap(id) {
    this.cfg.map = id;
    for (const fn of this._syncers) fn();
    this._commit();
  }

  _setTeam(value) {
    this._teamChoice = value;
    if (value === TEAM.T || value === TEAM.CT) this.cfg.team = value;
    for (const fn of this._syncers) fn();
    this._syncTeamHint();
    this._commit();
  }

  _syncTeamHint() {
    const el = this.els.teamHint;
    if (!el) return;
    if (this._teamChoice === 'random') {
      el.textContent = '开局随机抽签，你可能出现在任意一方。';
    } else if (this._teamChoice === TEAM.T) {
      el.textContent = `${TEAM_LABEL[TEAM.T]}：携带 C4，抢占点位并完成安放。`;
    } else {
      el.textContent = `${TEAM_LABEL[TEAM.CT]}：守住两点，或在 40 秒内完成拆弹。`;
    }
  }

  _resetDefaults() {
    for (const k of Object.keys(CFG)) this.cfg[k] = CFG[k];
    this._teamChoice = CFG.team;
    this._applyAll();
    this._commit();
    this._sfx('ui_back');
  }

  /** Assemble the match config and hand it to the game. */
  _startMatch() {
    const choice = this._teamChoice;
    const team = (choice === TEAM.T || choice === TEAM.CT)
      ? choice : (Math.random() < 0.5 ? TEAM.T : TEAM.CT);
    this.cfg.team = team;
    const bots = clamp(Math.round(numOr(this.cfg.botCount, CFG.botCount)), 1, 9);
    this.cfg.botCount = bots;
    const maxRounds = this._roundsValue();
    this.cfg.maxRounds = maxRounds;
    const config = {
      map: (typeof this.cfg.map === 'string' && this.cfg.map) ? this.cfg.map : CFG.map,
      team,
      botCount: bots,
      totalPlayers: bots + 1,
      difficulty: DIFFICULTY[this.cfg.difficulty] ? this.cfg.difficulty : CFG.difficulty,
      maxRounds,
      unlimitedRounds: maxRounds <= 0,
      friendlyFire: !!this.cfg.friendlyFire,
      randomTeam: choice === 'random',
      cfg: this.cfg,
    };
    this._commit();
    this.showLoading('正在生成地图与导航网格…', 0);
    this._call('onStart', config);
    return config;
  }

  /** Ask the map modules for their previews once, then draw fallbacks. */
  _ensurePreviews() {
    if (this._previewsReady) return;
    this._previewsReady = true;
    for (const rec of this.mapCards) {
      let data = null;
      try { data = this._call('onMapPreview', rec.def.id); } catch (e) { data = null; }
      if (data && typeof data === 'object') {
        if (data.cn && rec.cn) rec.cn.textContent = String(data.cn);
        if (data.name && rec.en) rec.en.textContent = String(data.name);
        if (data.desc && rec.desc) rec.desc.textContent = String(data.desc);
        if (data.tags) this._fillTags(rec, data.tags);
        if (isEl(data.canvas)) {
          this._clear(rec.shot);
          this._cls(data.canvas, 'menu-map-canvas', true);
          this._add(rec.shot, data.canvas, this._el('span', 'menu-map-gloss'));
          rec.custom = true;
        }
      }
      if (!rec.custom) this._drawSchematic(rec);
    }
  }
  // ==========================================================================
  // scoreboard data — tolerant readers, the game owns the real shapes
  // ==========================================================================
  _readScore(src) {
    const s = (src && (src.score || src.scores)) || (src && src.match && src.match.score) || {};
    return { T: Math.round(numOr(s.T, 0)), CT: Math.round(numOr(s.CT, 0)) };
  }

  _readRound(src) {
    const v = src && (src.round != null ? src.round
      : src.roundNumber != null ? src.roundNumber
        : src.match && src.match.round);
    return Math.max(1, Math.round(numOr(v, 1)));
  }

  _readActors(src) {
    const list = (src && (src.actors || src.players))
      || (src && src.match && src.match.actors) || [];
    return Array.isArray(list) ? list.filter((a) => a && typeof a === 'object') : [];
  }

  /** Normalise one actor into the fields the tables need. */
  _stat(a, i, rounds) {
    const s = (a.stats && typeof a.stats === 'object') ? a.stats : {};
    const n = (...vals) => {
      for (const v of vals) if (typeof v === 'number' && Number.isFinite(v)) return v;
      return 0;
    };
    const dmg = n(a.damage, a.damageDealt, s.damage, s.damageDealt, s.dmg);
    const kills = Math.round(n(a.kills, s.kills));
    const deaths = Math.round(n(a.deaths, s.deaths));
    const team = a.team === TEAM.T ? TEAM.T : a.team === TEAM.CT ? TEAM.CT : null;
    return {
      name: String(a.name || a.displayName || a.id || `选手 ${i + 1}`),
      team,
      kills,
      deaths,
      assists: Math.round(n(a.assists, s.assists)),
      money: Math.round(n(a.money, s.money)),
      mvps: Math.round(n(a.mvps, a.mvp, s.mvps)),
      dmg,
      adr: dmg / Math.max(1, rounds),
      alive: a.alive !== false && a.dead !== true,
      isPlayer: !!(a.isPlayer || a.isHuman || a.human || a.local),
      raw: a,
    };
  }
  _fillPause(game) {
    const score = this._readScore(game);
    const round = this._readRound(game);
    const rounds = Math.max(1, score.T + score.CT || round);
    const max = numOr(game && game.maxRounds, this._roundsValue());
    const phase = (game && game.phase) || PHASE.LIVE;
    if (this.els.pauseSub) {
      this.els.pauseSub.textContent = `第 ${round} 回合${max > 0 ? ` / ${max}` : ''} · `
        + `${PHASE_LABEL[phase] || '进行中'}`;
    }
    if (this.els.pauseScoreT) this.els.pauseScoreT.val.textContent = String(score.T);
    if (this.els.pauseScoreCT) this.els.pauseScoreCT.val.textContent = String(score.CT);

    const board = this.els.miniBoard;
    if (!board) return;
    this._clear(board);
    const actors = this._readActors(game).map((a, i) => this._stat(a, i, rounds));
    if (!actors.length) {
      this._add(board, this._el('p', 'menu-empty', '暂无选手数据'));
      return;
    }
    for (const team of [TEAM.T, TEAM.CT]) {
      const rows = actors.filter((a) => a.team === team);
      if (!rows.length) continue;
      this._add(board, this._buildMiniTable(team, rows, score[team]));
    }
    const rest = actors.filter((a) => a.team !== TEAM.T && a.team !== TEAM.CT);
    if (rest.length) this._add(board, this._buildMiniTable(null, rest, 0));
  }

  _buildMiniTable(team, rows, teamScore) {
    const box = this._el('div', 'menu-mini-team');
    if (team) {
      this._attr(box, 'data-team', team);
      this._cssVar(box, '--team-color', TEAM_COLOR[team]);
    }
    const head = this._el('div', 'menu-mini-head');
    this._add(head, this._el('span', 'menu-mini-name', team ? TEAM_LABEL[team] : '观战'),
      this._el('span', 'menu-mini-score', team ? `${teamScore} 分` : ''));
    const table = this._el('table', 'menu-mini-table');
    const thead = this._el('thead', '');
    const hr = this._el('tr', '');
    for (const t of ['玩家', 'K / D', '金钱']) {
      const th = this._el('th', '', t);
      this._attr(th, 'scope', 'col');
      this._add(hr, th);
    }
    this._add(thead, hr);
    const tbody = this._el('tbody', '');
    const sorted = rows.slice().sort((a, b) => (b.kills - a.kills)
      || (a.deaths - b.deaths) || (b.dmg - a.dmg));
    for (const a of sorted) {
      const tr = this._el('tr', 'menu-mini-row');
      if (a.isPlayer) this._cls(tr, 'is-you', true);
      if (!a.alive) this._cls(tr, 'is-dead', true);
      const nameCell = this._el('td', 'menu-mini-cell menu-mini-cell--name');
      this._add(nameCell, this._el('span', 'menu-mini-dot'),
        this._el('span', 'menu-mini-label', a.isPlayer ? `${a.name}（你）` : a.name));
      this._add(tr, nameCell,
        this._el('td', 'menu-mini-cell', `${a.kills} / ${a.deaths}`),
        this._el('td', 'menu-mini-cell menu-mini-cell--money', fmtMoney(a.money)));
      this._add(tbody, tr);
    }
    this._add(table, thead, tbody);
    this._add(box, head, table);
    return box;
  }

  _fillEnd(result) {
    const r = result || {};
    const score = this._readScore(r);
    const rounds = Math.max(1, Math.round(numOr(r.rounds, score.T + score.CT)));
    const winner = r.winner === TEAM.T || r.winner === TEAM.CT ? r.winner
      : r.winnerTeam === TEAM.T || r.winnerTeam === TEAM.CT ? r.winnerTeam
        : (score.T === score.CT ? null : (score.T > score.CT ? TEAM.T : TEAM.CT));
    const color = winner ? TEAM_COLOR[winner] : 'var(--accent)';
    this._cssVar(this.els.endBanner, '--win-color', color);
    this._attr(this.els.endBanner, 'data-team', winner || 'draw');
    if (this.els.endWinner) {
      this.els.endWinner.textContent = winner ? `${TEAM_LABEL[winner]} 获胜` : '双方平局';
    }
    if (this.els.endReason) {
      const you = r.playerTeam || this.cfg.team;
      const tail = winner && you ? (winner === you ? '恭喜，这局你赢了。' : '再来一局，找回节奏。') : '';
      this.els.endReason.textContent = [String(r.reason || r.reasonText || ''), tail]
        .filter(Boolean).join(' · ') || `${rounds} 回合结束`;
    }
    if (this.els.endScoreT) this.els.endScoreT.val.textContent = String(score.T);
    if (this.els.endScoreCT) this.els.endScoreCT.val.textContent = String(score.CT);
    this._cls(this.els.endScoreT && this.els.endScoreT.el, 'is-winner', winner === TEAM.T);
    this._cls(this.els.endScoreCT && this.els.endScoreCT.el, 'is-winner', winner === TEAM.CT);

    const actors = this._readActors(r).map((a, i) => this._stat(a, i, rounds));
    const sorted = actors.slice().sort((a, b) => (b.kills - a.kills)
      || (b.adr - a.adr) || (a.deaths - b.deaths));
    this._fillStatsTable(sorted);
    this._fillMvp(this._pickMvp(r, sorted), rounds);
  }
  _pickMvp(result, sorted) {
    if (!sorted.length) return null;
    const want = result && result.mvp;
    if (want) {
      const key = typeof want === 'string' ? want : String(want.name || want.id || '');
      const hit = sorted.find((a) => a.name === key || a.raw === want
        || (want && a.raw && a.raw.id != null && a.raw.id === want.id));
      if (hit) return hit;
    }
    let best = sorted[0];
    let bestScore = -Infinity;
    for (const a of sorted) {
      const sc = a.kills * 2 + a.mvps * 3 + a.adr * 0.05 + a.assists - a.deaths * 0.5;
      if (sc > bestScore) { bestScore = sc; best = a; }
    }
    return best;
  }

  _fillStatsTable(rows) {
    const body = this.els.statsBody;
    if (!body) return;
    this._clear(body);
    if (!rows.length) {
      const tr = this._el('tr', '');
      const td = this._el('td', 'menu-empty', '本场没有统计数据');
      this._attr(td, 'colspan', '6');
      this._add(tr, td);
      this._add(body, tr);
      return;
    }
    for (const a of rows) {
      const tr = this._el('tr', 'menu-st-row');
      if (a.team) {
        this._attr(tr, 'data-team', a.team);
        this._cssVar(tr, '--team-color', TEAM_COLOR[a.team]);
      }
      if (a.isPlayer) this._cls(tr, 'is-you', true);
      const th = this._el('th', 'menu-st-name');
      this._attr(th, 'scope', 'row');
      this._add(th, this._el('span', 'menu-st-flag', a.team || '—'),
        this._el('span', 'menu-st-label', a.isPlayer ? `${a.name}（你）` : a.name));
      this._add(tr, th,
        this._el('td', 'menu-st-num', String(a.kills)),
        this._el('td', 'menu-st-num', String(a.assists)),
        this._el('td', 'menu-st-num', String(a.deaths)),
        this._el('td', 'menu-st-num', a.adr.toFixed(1)),
        this._el('td', 'menu-st-num', String(a.mvps)));
      this._add(body, tr);
    }
  }
  _fillMvp(mvp, rounds) {
    const card = this.els.mvpCard;
    if (!card) return;
    this._clear(card);
    if (!mvp) {
      this._add(card, this._el('p', 'menu-empty', '无 MVP'));
      return;
    }
    if (mvp.team) {
      this._attr(card, 'data-team', mvp.team);
      this._cssVar(card, '--team-color', TEAM_COLOR[mvp.team]);
    }
    const kd = mvp.deaths ? (mvp.kills / mvp.deaths) : mvp.kills;
    const head = this._el('div', 'menu-mvp-head');
    this._add(head, this._el('span', 'menu-mvp-badge', 'MVP'),
      this._el('span', 'menu-mvp-team', mvp.team ? TEAM_LABEL[mvp.team] : ''));
    const name = this._el('h2', 'menu-mvp-name', mvp.isPlayer ? `${mvp.name}（你）` : mvp.name);
    const grid = this._el('div', 'menu-mvp-grid');
    const cell = (label, value) => {
      const c = this._el('div', 'menu-mvp-cell');
      this._add(c, this._el('b', 'menu-mvp-value', value), this._el('span', 'menu-mvp-key', label));
      return c;
    };
    this._add(grid,
      cell('击杀', String(mvp.kills)),
      cell('助攻', String(mvp.assists)),
      cell('死亡', String(mvp.deaths)),
      cell('K/D', kd.toFixed(2)),
      cell('ADR', mvp.adr.toFixed(1)),
      cell('总伤害', String(Math.round(mvp.dmg))));
    this._add(card, head, name, grid,
      this._el('p', 'menu-mvp-foot', `${rounds} 回合 · 场均 ${(mvp.kills / Math.max(1, rounds)).toFixed(2)} 杀`));
  }

  // ==========================================================================
  // keyboard: Esc back, Enter confirm, arrows move focus
  // ==========================================================================
  _bindKeys() {
    const target = this.win || this.doc;
    if (!target || typeof target.addEventListener !== 'function') return;
    this._keyHandler = (e) => this._onKey(e);
    this._keyTarget = target;
    target.addEventListener('keydown', this._keyHandler, true);
  }

  _stopEvent(e) {
    if (!e) return;
    if (typeof e.preventDefault === 'function') e.preventDefault();
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
  }
  _onKey(e) {
    if (!this.isOpen || !e) return;
    const key = e.key || '';
    const active = (this.doc && this.doc.activeElement) || null;
    const isRange = !!(active && String(active.type || '').toLowerCase() === 'range');
    if (key === 'Escape') {
      this._stopEvent(e);
      this._back();
      return;
    }
    if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
      // Let the browser activate whatever button already owns focus.
      const tag = active && String(active.tagName || '').toLowerCase();
      if (tag === 'button' || isRange) return;
      if (key !== 'Enter') return;
      this._stopEvent(e);
      this._confirm();
      return;
    }
    let dir = 0;
    if (key === 'ArrowDown' || key === 'ArrowRight') dir = 1;
    else if (key === 'ArrowUp' || key === 'ArrowLeft') dir = -1;
    if (!dir) return;
    // horizontal arrows belong to a focused slider
    if (isRange && (key === 'ArrowLeft' || key === 'ArrowRight')) return;
    this._stopEvent(e);
    this._moveFocus(dir, active);
  }

  _moveFocus(dir, active) {
    const sc = this.screens[this._state];
    const list = (sc && sc.focus) || [];
    if (!list.length) return;
    const usable = list.filter((el) => el && !el.disabled);
    if (!usable.length) return;
    let i = usable.indexOf(active);
    i = i < 0 ? (dir > 0 ? 0 : usable.length - 1) : (i + dir + usable.length) % usable.length;
    const el = usable[i];
    if (el && typeof el.focus === 'function') {
      try { el.focus({ preventScroll: true }); } catch (err) { el.focus(); }
    }
  }

  _back() {
    switch (this._state) {
      case 'settings':
      case 'controls':
        this._sfx('ui_back');
        if (this._returnTo === 'pause') this.showPause();
        else this.showMain();
        break;
      case 'pause':
        this._sfx('ui_back');
        this.resume();
        break;
      default:
        // main / end / loading: nothing above them to go back to.
        break;
    }
  }

  _confirm() {
    switch (this._state) {
      case 'main': this._sfx('ui_click'); this._startMatch(); break;
      case 'settings':
      case 'controls': this._back(); break;
      case 'pause': this._sfx('ui_click'); this.resume(); break;
      case 'end': this._sfx('ui_click'); this.hide(); this._call('onRestart'); break;
      default: break;
    }
  }

  // ==========================================================================
  // canvas painting — crosshair preview + fallback map schematics
  // ==========================================================================
  _drawCrosshair() {
    const canvas = this.els.xhairCanvas;
    const ctx = this._ctx(canvas);
    if (!ctx) return;
    const w = numOr(canvas.width, 640), h = numOr(canvas.height, 360);
    const s = w / 320;                       // design units → backing pixels
    ctx.save();
    ctx.clearRect(0, 0, w, h);

    // faux screenshot: sky band, sand wall, floor, a distant silhouette
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    if (sky && sky.addColorStop) {
      sky.addColorStop(0, '#6f5a3c');
      sky.addColorStop(0.42, '#3b3126');
      sky.addColorStop(1, '#191510');
    }
    ctx.fillStyle = sky || '#2a231a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(214,182,126,0.20)';
    ctx.fillRect(0, h * 0.20, w, h * 0.34);
    ctx.fillStyle = 'rgba(28,22,16,0.55)';
    ctx.fillRect(0, h * 0.60, w, h * 0.40);
    ctx.fillStyle = 'rgba(120,96,62,0.45)';
    ctx.fillRect(w * 0.06, h * 0.30, w * 0.16, h * 0.30);
    ctx.fillRect(w * 0.78, h * 0.26, w * 0.16, h * 0.34);
    // silhouette to judge contrast against
    ctx.fillStyle = 'rgba(16,14,11,0.82)';
    ctx.beginPath();
    ctx.arc(w * 0.635, h * 0.40, h * 0.055, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(w * 0.60, h * 0.455, w * 0.07, h * 0.20);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(0, h * 0.585, w, 2 * s);

    const cx = Math.round(w / 2), cy = Math.round(h / 2);
    const size = clamp(numOr(this.cfg.crosshairSize, CFG.crosshairSize), 1, 20) * s;
    const gap = clamp(numOr(this.cfg.crosshairGap, CFG.crosshairGap), 0, 12) * s;
    const th = Math.max(1, Math.round(clamp(numOr(this.cfg.crosshairThickness, 2), 1, 6) * s));
    const color = Menu.safeColor(this.cfg.crosshairColor);

    // dynamic: ghost the expanded state so the setting is legible
    if (this.cfg.crosshairDynamic) {
      ctx.globalAlpha = 0.32;
      this._strokeCross(ctx, cx, cy, size, gap + 7 * s, th, color, false);
      ctx.globalAlpha = 1;
    }
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 2 * s;
    this._strokeCross(ctx, cx, cy, size, gap, th, color, !!this.cfg.crosshairDot);
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  _strokeCross(ctx, cx, cy, size, gap, th, color, dot) {
    ctx.fillStyle = color;
    const half = th / 2;
    // left / right / top / bottom arms
    ctx.fillRect(cx - gap - size, cy - half, size, th);
    ctx.fillRect(cx + gap, cy - half, size, th);
    ctx.fillRect(cx - half, cy - gap - size, th, size);
    ctx.fillRect(cx - half, cy + gap, th, size);
    if (dot) ctx.fillRect(cx - half, cy - half, th, th);
  }

  _drawSchematic(rec) {
    const canvas = rec.canvas;
    const ctx = this._ctx(canvas);
    if (!ctx) return;
    const w = numOr(canvas.width, 480), h = numOr(canvas.height, 270);
    const keys = Object.keys(MAP_SCHEMATIC);
    const def = MAP_SCHEMATIC[rec.def.id] || MAP_SCHEMATIC[keys[(rec.idx || 0) % keys.length]];
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, w, h);
    if (g && g.addColorStop) {
      g.addColorStop(0, '#2b2419');
      g.addColorStop(0.55, '#211b13');
      g.addColorStop(1, '#15110c');
    }
    ctx.fillStyle = g || '#221c14';
    ctx.fillRect(0, 0, w, h);

    // survey grid
    ctx.strokeStyle = 'rgba(224,197,140,0.07)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= 12; x++) {
      const px = Math.round((x / 12) * w) + 0.5;
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
    }
    for (let y = 0; y <= 7; y++) {
      const py = Math.round((y / 7) * h) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();
    }

    // inset frame: extra head-room up top so the site labels never collide
    // with the card's "已选择" badge, and nothing touches the edges
    const ix = w * 0.045, iyT = h * 0.125, iyB = h * 0.055;
    const iw = w - ix * 2, ih = h - iyT - iyB;
    const px = (n) => ix + n * iw;
    const py = (n) => iyT + n * ih;

    // walkable corridors
    for (const l of def.lanes) {
      const x = px(l[0]), y = py(l[1]), lw = l[2] * iw, lh = l[3] * ih;
      ctx.fillStyle = 'rgba(206,176,120,0.20)';
      this._roundRect(ctx, x, y, lw, lh, Math.min(10, lw * 0.25, lh * 0.25));
      ctx.fill();
      ctx.strokeStyle = 'rgba(226,199,146,0.30)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    // bombsites
    for (const st of def.sites) {
      const x = px(st.x), y = py(st.y), sw = st.w * iw, sh = st.h * ih;
      ctx.fillStyle = 'rgba(224,90,66,0.24)';
      this._roundRect(ctx, x, y, sw, sh, 8);
      ctx.fill();
      ctx.strokeStyle = 'rgba(240,120,86,0.72)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,214,196,0.95)';
      ctx.font = `700 ${Math.round(h * 0.13)}px "Barlow Condensed", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(st.k, x + sw / 2, y + sh / 2 + 1);
    }

    // spawns
    for (const sp of def.spawns) {
      const x = px(sp.x), y = py(sp.y);
      ctx.fillStyle = TEAM_COLOR[sp.t] || '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, Math.max(4, h * 0.032), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(10,8,6,0.8)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = `700 ${Math.round(h * 0.06)}px "Barlow Condensed", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sp.t, x, y + h * 0.075);
    }

    // frame — the card body already names the map, so no label strip here
    ctx.strokeStyle = 'rgba(228,203,152,0.30)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
    ctx.restore();
  }

  _roundRect(ctx, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r || 0, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  // ==========================================================================
  // persistence
  // ==========================================================================
  static _storage() {
    try {
      const ls = (typeof localStorage !== 'undefined' && localStorage)
        || (typeof globalThis !== 'undefined' && globalThis.localStorage) || null;
      if (ls && typeof ls.getItem === 'function' && typeof ls.setItem === 'function') return ls;
    } catch (e) { /* blocked by privacy settings */ }
    return null;
  }

  /** cm of mousepad needed for a 360° turn at 800 DPI (yaw 0.022). */
  static cmPer360(sens) {
    const s = Math.max(0.01, numOr(Number(sens), CFG.sensitivity));
    return (360 * 2.54) / (800 * 0.022 * s);
  }
  /** Resolve the map roster: caller override first, built-in cards otherwise. */
  static _mapDefs(list) {
    if (!Array.isArray(list) || !list.length) return MAP_CARDS.slice();
    return list.slice(0, 6).map((m, i) => {
      const src = typeof m === 'string' ? { id: m } : (m && typeof m === 'object' ? m : {});
      const fb = MAP_CARDS.find((c) => c.id === src.id) || MAP_CARDS[i] || MAP_CARDS[0];
      return {
        id: String(src.id || fb.id),
        cn: String(src.cn || fb.cn),
        name: String(src.name || fb.name),
        desc: String(src.desc || fb.desc),
        tags: Array.isArray(src.tags) && src.tags.length ? src.tags.slice() : fb.tags.slice(),
      };
    });
  }

  /** Accept only #rgb / #rrggbb, else fall back to the default colour. */
  static safeColor(v) {
    return (typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim()))
      ? v.trim() : CFG.crosshairColor;
  }

  /**
   * Read the persisted settings, keeping only keys that exist in CFG and whose
   * type / range / enum membership still matches. Returns a partial object.
   */
  static loadCfg() {
    const out = {};
    const ls = Menu._storage();
    if (!ls) return out;
    let data = null;
    try {
      const raw = ls.getItem(CFG_STORE_KEY);
      if (!raw) return out;
      data = JSON.parse(raw);
    } catch (e) { return out; }
    if (!data || typeof data !== 'object') return out;

    const RANGE = {
      sensitivity: [0.1, 20], fov: [60, 130], masterVolume: [0, 1], sfxVolume: [0, 1],
      musicVolume: [0, 1], crosshairSize: [1, 40], crosshairGap: [0, 30],
      crosshairThickness: [1, 10], viewmodelFov: [40, 100], botCount: [0, 9],
      maxRounds: [0, 300], radarZoom: [0.2, 5], mouseSmooth: [0, 1], bobScale: [0, 3],
    };
    const ENUM = {
      quality: Object.keys(QUALITY),
      difficulty: DIFFICULTY_ORDER,
      team: [TEAM.T, TEAM.CT],
    };
    for (const key of Object.keys(CFG)) {
      if (!(key in data)) continue;
      const def = CFG[key];
      const v = data[key];
      if (typeof def === 'boolean') {
        if (typeof v === 'boolean') out[key] = v;
      } else if (typeof def === 'number') {
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        const r = RANGE[key];
        out[key] = r ? clamp(v, r[0], r[1]) : v;
      } else if (typeof def === 'string') {
        if (typeof v !== 'string' || !v) continue;
        if (key === 'crosshairColor') out[key] = Menu.safeColor(v);
        else if (ENUM[key]) { if (ENUM[key].includes(v)) out[key] = v; }
        else out[key] = v;
      }
    }
    return out;
  }
  /** Write the CFG-shaped subset of `cfg` to localStorage. */
  static saveCfg(cfg) {
    const ls = Menu._storage();
    if (!ls || !cfg || typeof cfg !== 'object') return false;
    const out = {};
    for (const key of Object.keys(CFG)) {
      const def = CFG[key];
      const v = cfg[key];
      if (typeof v === typeof def && (typeof v !== 'number' || Number.isFinite(v))) out[key] = v;
      else out[key] = def;
    }
    try {
      ls.setItem(CFG_STORE_KEY, JSON.stringify(out));
      return true;
    } catch (e) {
      return false;                          // quota exceeded / private mode
    }
  }
}

export default Menu;
