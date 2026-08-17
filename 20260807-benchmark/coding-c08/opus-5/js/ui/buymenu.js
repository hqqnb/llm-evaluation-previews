// ============================================================================
// ui/buymenu.js — CS-style two-level buy menu (keyboard driven + full mouse).
//
// The whole overlay is built in JS inside the element handed to the
// constructor; nothing touches `document` at module scope so the file imports
// cleanly under Node (the automated tests do exactly that).
//
// Weapon data comes from game/weapons.js and the affordability rules from
// game/economy.js.  Both are pulled in through a guarded dynamic import so this
// module still loads while those siblings are being written in parallel;
// `setDataSource()` performs the same injection by hand (tests use it).
//
// Public API:
//   open(game)  close()  get isOpen  update(game)  onKey(event)->bool  dispose()
// Callbacks the integrator assigns:
//   onBuy(id) -> {ok, reason}     actually performs the purchase
//   onAutoBuy(mode) -> {ok,reason,bought?}   mode: 'auto' | 'rebuy'
//   onCloseRequest()             fired after the menu closed itself (re-lock)
//   onSound(name)                'buy' | 'buy_fail' | 'ui_click' | ...
// ============================================================================

import { TEAM, TEAM_LABEL, TEAM_COLOR, PHASE, CFG, MONEY, ROUND } from '../core/constants.js';
import { WEAPON_IDS } from '../core/api.js';
import { fmtMoney, fmtTime, clamp01, invLerp } from '../core/util.js';

/** game/weapons.js — resolved lazily; null while that file does not exist yet. */
let WMOD = null;
/** game/economy.js — same treatment. */
let EMOD = null;
try { WMOD = await import('../game/weapons.js'); } catch (err) { WMOD = null; }
try { EMOD = await import('../game/economy.js'); } catch (err) { EMOD = null; }

const PHASE_LABEL = {
  [PHASE.MENU]: '主菜单',
  [PHASE.FREEZE]: '准备阶段',
  [PHASE.LIVE]: '回合进行中',
  [PHASE.PLANTED]: '炸弹已安放',
  [PHASE.ROUND_END]: '回合结束',
  [PHASE.HALFTIME]: '中场休息',
  [PHASE.MATCH_END]: '比赛结束',
};

// Reason codes economy.js (or onBuy) may return, mapped to player facing text.
// Anything already written in Chinese is shown verbatim.
const REASON_TEXT = {
  money: '钱不够', nomoney: '钱不够', no_money: '钱不够', poor: '钱不够',
  cash: '钱不够', afford: '钱不够', price: '钱不够',
  time: '购买时间已结束', buytime: '购买时间已结束', buy_time: '购买时间已结束',
  timeout: '购买时间已结束', phase: '购买时间已结束', late: '购买时间已结束',
  zone: '必须在出生区购买', buyzone: '必须在出生区购买', buy_zone: '必须在出生区购买',
  area: '必须在出生区购买', spawn: '必须在出生区购买', position: '必须在出生区购买',
  team: '该阵营无法购买', wrongteam: '该阵营无法购买', wrong_team: '该阵营无法购买',
  side: '该阵营无法购买', restricted: '该阵营无法购买',
  owned: '已经拥有了', have: '已经拥有了', duplicate: '已经拥有了',
  limit: '数量已达上限', grenade_limit: '数量已达上限', max: '数量已达上限',
  full: '装备栏已满', slot: '装备栏已满', dead: '阵亡后无法购买',
  unknown: '无法购买', error: '购买失败', unavailable: '购买功能未就绪',
};
function reasonText(reason) {
  if (!reason) return '无法购买';
  const s = String(reason);
  if (/[^\x00-\x7F]/.test(s)) return s;                 // already Chinese
  return REASON_TEXT[s.toLowerCase()] || REASON_TEXT[s.toLowerCase().replace(/[\s-]+/g, '_')] || '无法购买';
}

// Fallback category layout, used only until game/weapons.js exposes its own
// BUY_CATEGORIES.  Ids are taken from the api.js registry, never invented.
const DEFAULT_CATEGORIES = [
  { id: 'pistol', label: '手枪', key: '1', items: ['glock', 'usp', 'p250', 'tec9', 'fiveseven', 'deagle', 'dualies'] },
  { id: 'smg', label: '冲锋枪', key: '2', items: ['mac10', 'mp9', 'mp5', 'ump45', 'p90'] },
  { id: 'rifle', label: '步枪', key: '3', items: ['galil', 'famas', 'ak47', 'm4a4', 'm4a1s', 'aug', 'sg553', 'ssg08', 'awp'] },
  { id: 'heavy', label: '重型', key: '4', items: ['nova', 'xm1014', 'mag7', 'negev'] },
  { id: 'gear', label: '装备', key: '5', items: ['kevlar', 'kevlarhelmet', 'defusekit'] },
  { id: 'grenade', label: '投掷物', key: '6', items: ['he', 'flash', 'smoke', 'molotov', 'incendiary', 'decoy'] },
].map((c) => ({ ...c, items: c.items.filter((id) => WEAPON_IDS.includes(id)) }));

// --- tiny DOM helpers (never run at module scope) --------------------------
function el(tag, cls, txt) {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (txt != null) d.textContent = txt;
  return d;
}
function setText(n, v) {
  const s = v == null ? '' : String(v);
  if (n && n.__t !== s) { n.__t = s; n.textContent = s; }
}
function setHTML(n, h) { if (n && n.__h !== h) { n.__h = h; n.innerHTML = h; } }
function setCls(n, c, on) { if (n && n.classList) n.classList.toggle(c, !!on); }
function setStyle(n, k, v) {
  const key = '__s_' + k;
  if (n && n[key] !== v) { n[key] = v; n.style[k] = v; }
}
const nowSec = () =>
  (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) / 1000;

// ---------------------------------------------------------------------------
// Procedurally authored inline SVG icon set.  Every silhouette is drawn in a
// 64x32 box pointing right; `dk` sub-shapes are punch-through details and `ln`
// are thin lines (both coloured by css/buy.css).  No external assets.
// ---------------------------------------------------------------------------
const R = (x, y, w, h, rx) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"${rx ? ` rx="${rx}"` : ''}/>`;
const DK = (m) => `<g class="dk">${m}</g>`;
const LN = (d, w = 1.2) => `<path class="ln" d="${d}" stroke-width="${w}"/>`;

const ICONS = {
  pistol:
    '<path d="M15 9H45l3 2v4H30l-2 4h-2l-2 11H14l3-12-2-3z"/>' +
    R(41, 6.6, 3, 2.4) + R(17, 6.6, 3, 2.4) +
    LN('M26 19c-1 5-4 6-6 6') + DK(R(31, 11, 12, 1.6, 0.6)),
  deagle:
    '<path d="M13 8h33l3 2v6H31l-2 4h-3l-2 11H13l3-13-3-3z"/>' +
    '<path d="M28.6 15.4a3.8 3.8 0 1 0 7.6 0z"/>' +
    R(43, 5.4, 3, 2.6) + R(16, 5.6, 3, 2.4) +
    LN('M27 20c-1 5-4 6-6 6') + DK(R(32, 10.4, 13, 1.8, 0.6)),
  dualies:
    '<path d="M24 5h18l2 2v3H32l-1 2h-2l-2 6h-7l2-7 2-2z"/>' +
    '<path d="M18 17h18l2 2v3H26l-1 2h-2l-2 6h-7l2-7 2-2z"/>' +
    LN('M29 12c-.6 3-2.4 3.6-3.6 3.6') + LN('M23 24c-.6 3-2.4 3.6-3.6 3.6'),
  smg:
    R(7, 11.6, 6, 4.6, 1) + '<path d="M10 14h4.5v3.6H10z"/>' +
    R(12, 10.6, 32, 6.4, 1.2) + R(44, 12.4, 9, 3) + R(53, 11.8, 2.2, 4.2, 0.6) +
    '<path d="M19 17h6l-3 12h-6z"/>' + '<path d="M28 17h6l-1 13h-6z"/>' +
    R(20, 7.8, 10, 2.2, 1) + R(16, 7.4, 3, 2.6) +
    DK(R(30, 12.4, 12, 1.6, 0.6)) + LN('M46 13.6h6'),
  rifle:
    '<path d="M4 11.6h12v5.8h-6l-6-1.4z"/>' +
    R(16, 10.6, 25, 6.6, 1.2) + R(41, 11.8, 10, 4.6, 1) + R(41, 13, 17, 2.6) +
    R(57, 11.6, 2.4, 4.6, 0.6) + R(43, 9.6, 4, 3.6, 0.8) + R(44.6, 6.4, 1.8, 3.6) +
    R(18, 7.6, 16, 2.2, 1) + '<path d="M28 17.2h6l-1 12h-6z"/>' +
    '<path d="M20 17.2h6l-3 11h-6z"/>' + DK(R(34, 12, 6, 1.6, 0.6)) + LN('M6 13h9'),
  ak:
    '<path d="M14 11.4L5 15v3.2l9-.8z"/>' +
    R(14, 10.6, 26, 6.6, 1.2) + R(41, 11.6, 9, 4.6, 1) + R(40, 12.6, 16, 2.6) +
    R(56, 11.4, 2.6, 4.4, 0.6) + R(45, 9.2, 3.6, 3.2, 0.6) +
    '<path d="M26 17.2c-2.6 4-1.6 9 4 11.8l5-2c-4-2.6-4.6-6.6-3.6-9.8z"/>' +
    '<path d="M19 17.2h6l-3 11h-6z"/>' + R(17, 7.8, 3, 2.8) +
    DK(R(31.6, 12, 7, 1.6, 0.6)) + LN('M42 13.8h7'),
  sniper:
    '<path d="M4 13h12v6.2h-7l-5-2z"/>' + R(14, 12.6, 26, 6.6, 1.2) +
    R(40, 15, 20, 2.4) + R(58, 13.6, 4, 4.6, 1) +
    R(22, 5.8, 20, 4.8, 2.2) + R(19.4, 6.4, 3, 3.8, 1) + R(41.4, 6.4, 3.4, 3.8, 1) +
    R(25, 10.2, 3, 2.8) + R(36, 10.2, 3, 2.8) +
    '<path d="M17 11l4-2 1 2-4 2z"/>' + '<path d="M28 19.2h6l-1 6.2h-5z"/>' +
    '<path d="M20 19.2h6l-3 10h-6z"/>' + DK(R(24, 7.4, 16, 1.6, 0.6)) + LN('M44 16.2h13'),
  shotgun:
    '<path d="M4 12h11.4v7.2H9l-5-2z"/>' + R(13, 11.8, 24, 7, 1.2) +
    R(37, 12.2, 22, 3.2) + R(37, 16.6, 20, 2.2) + R(41, 16, 10, 4, 1) +
    R(58.4, 11.4, 2.4, 4.6, 0.6) + '<path d="M18 18.8h6l-3 10h-6z"/>' +
    R(16, 9.4, 3, 2.4) + DK(R(20, 13.2, 12, 1.6, 0.6)) + LN('M43 18h6'),
  lmg:
    R(4, 11, 9, 5.6, 1) + R(12, 9.6, 30, 8, 1.4) +
    '<path d="M22 17.6h16l-2 11.4H24z"/>' + R(42, 12.4, 17, 3) + R(59, 11.4, 3, 4.8, 0.8) +
    '<path d="M18 17.6h6l-3 10h-6z"/>' + R(20, 6.2, 12, 3, 1.2) +
    LN('M50 15.4L47 28M50 15.4L55 28', 1.6) + DK(R(26, 19.4, 8, 1.8, 0.6)),
  knife:
    '<path d="M20 12l28-4 8 6-8 4-28-1z"/>' + R(16.6, 7.6, 3.6, 12, 1) +
    '<path d="M5 11.6h11.6v6.4H5a3.2 3.2 0 0 1 0-6.4z"/>' +
    LN('M24 13.2l22-2.6') + DK(R(8, 13.4, 6, 1.6, 0.6)),
  c4:
    R(16, 6.6, 30, 20, 2.6) + DK(R(20, 9.6, 12, 6.4, 1) + R(20, 19.4, 22, 3, 1.2)) +
    '<circle cx="37" cy="11" r="1.7"/><circle cx="42" cy="11" r="1.7"/>' +
    '<circle cx="37" cy="15.6" r="1.7"/><circle cx="42" cy="15.6" r="1.7"/>' +
    LN('M24 6.6C24 2.6 30 1.6 33 3.8') + LN('M38 6.6c0-3 4-4 6-2.4'),
  he:
    '<path d="M32 8c6 0 9 5.4 9 11.4C41 26 37 30 32 30s-9-4-9-10.6C23 13.4 26 8 32 8z"/>' +
    R(27.6, 4.6, 8.8, 4, 1.2) + LN('M36.4 5.6c5 .6 6 4 5 7', 1.6) +
    DK(R(24, 16.6, 16, 1.6) + R(24, 22, 16, 1.6)) + LN('M32 10v19'),
  flash:
    R(25, 9.6, 14, 20.4, 3.4) + R(27.6, 4.6, 8.8, 4.4, 1.4) +
    LN('M36.4 5.6c5 .8 6 4 5 7', 1.6) + DK(R(25, 16, 14, 2.6)) +
    LN('M8 19.6h9M11 11.4l6 3.4M11 27.8l6-3.4', 1.4) +
    LN('M56 19.6h-9M53 11.4l-6 3.4M53 27.8l-6-3.4', 1.4),
  smoke:
    R(24, 9.6, 16, 20.4, 3.4) + R(27.6, 4.6, 8.8, 4.4, 1.4) +
    LN('M36.4 5.6c5 .8 6 4 5 7', 1.6) + DK(R(24, 15.4, 16, 2.4) + R(24, 21, 16, 2.4)) +
    '<g opacity=".5"><circle cx="16" cy="12.6" r="3.6"/><circle cx="48" cy="13.6" r="4"/>' +
    '<circle cx="50" cy="22.6" r="3"/><circle cx="14" cy="23" r="2.6"/></g>',
  molotov:
    '<path d="M28 7h8l1 6c3 3 4 7 4 12 0 3-2 5-5 5h-8c-3 0-5-2-5-5 0-5 1-9 4-12z"/>' +
    R(28.6, 3.4, 6.8, 3.4, 1) +
    '<path d="M32 0c2.4 2.4 4.6 3.6 3.4 5.8-1.2 1.8-5.4 1.6-6.4-.2C28 3.8 30 2.8 32 0z"/>' +
    DK(R(25.4, 18, 13, 5.4, 1)) + LN('M27 14c-1.6 2.6-2 5.4-2 8'),
  incendiary:
    R(25, 9.6, 14, 20.4, 3.4) + R(27.6, 4.6, 8.8, 4.4, 1.4) +
    '<path d="M32 0c2 2.2 4 3.4 3 5.2h-6.2C27.8 3.4 30 2.2 32 0z"/>' +
    LN('M36.4 5.6c5 .8 6 4 5 7', 1.6) + DK(R(25, 15.4, 14, 2.6)) +
    LN('M29 20.6c-1.4 2.6-1 5 1 6.4M35 20.6c1.4 2.6 1 5-1 6.4', 1.4),
  decoy:
    R(25, 10.6, 14, 19.4, 3.4) + R(27.6, 5.6, 8.8, 4.4, 1.4) +
    '<circle cx="36.4" cy="2.4" r="1.8"/>' + LN('M36.4 5.6V3.4', 1.6) +
    DK(R(25, 16.4, 14, 2.4)) +
    LN('M45 13.6c3.4 3.6 3.4 9.6 0 13.2M50 10.4c5.4 5.4 5.4 15.4 0 20.8', 1.4),
  kevlar:
    '<path d="M22 5h5c2 3.4 8 3.4 10 0h5c4 2 6 6.4 6 11.4V26c0 2-1 3-3 3H19c-2 0-3-1-3-3v-9.6C16 11.4 18 7 22 5z"/>' +
    LN('M27 5l4 7.4M37 5l-4 7.4') + LN('M32 13v16') + DK(R(19.6, 21, 24.8, 2.4, 1)),
  kevlarhelmet:
    '<path d="M32 1c7 0 12 4.6 12 10.4H20C20 5.6 25 1 32 1z"/>' + R(18.6, 11.6, 26.8, 3.2, 1.2) +
    '<path d="M23 17h4c2 2.6 8 2.6 10 0h4c4 2 5 5.4 5 9.4V30H18v-3.6c0-4 1-7.4 5-9.4z"/>' +
    LN('M32 17.6V30') + DK(R(21, 24.6, 22, 2.2, 1)),
  defusekit:
    R(13, 11.6, 26, 16.4, 2.6) + DK(R(13, 11.6, 26, 5, 2.6)) + LN('M16 20.6h20') +
    '<path d="M39 12.6l11 6 6-4 1.4 2-7 5-11.4-6.4z"/>' +
    '<path d="M39 25.4l11-6 6 4-1.4 2-6-3.4-9.6 5.4z"/>' +
    '<circle cx="35" cy="24.6" r="1.8"/>' + LN('M18 28c4 3.6 10 2 14 0'),
  gear:
    R(16, 9.6, 32, 14, 2) + DK(R(20, 12.6, 24, 8, 1)) + LN('M20 26.6h24'),
};

/** vmArchetype / kind / id → icon key. */
const ARCH_ICON = {
  pistol: 'pistol', pistol_silenced: 'pistol', pistol_big: 'deagle',
  smg: 'smg', smg_boxy: 'smg', rifle_ak: 'ak', rifle_m4: 'rifle', rifle_bullpup: 'rifle',
  sniper_bolt: 'sniper', sniper_awp: 'sniper', shotgun_pump: 'shotgun', shotgun_auto: 'shotgun',
  lmg: 'lmg', knife: 'knife', grenade: 'he', c4: 'c4',
};
const ID_ICON = {
  ak47: 'ak', deagle: 'deagle', dualies: 'dualies', awp: 'sniper', ssg08: 'sniper',
  nova: 'shotgun', xm1014: 'shotgun', mag7: 'shotgun', negev: 'lmg', knife: 'knife', c4: 'c4',
  he: 'he', flash: 'flash', smoke: 'smoke', molotov: 'molotov', incendiary: 'incendiary',
  decoy: 'decoy', kevlar: 'kevlar', kevlarhelmet: 'kevlarhelmet', defusekit: 'defusekit',
};
const KIND_ICON = {
  pistol: 'pistol', smg: 'smg', rifle: 'rifle', sniper: 'sniper', shotgun: 'shotgun',
  heavy: 'shotgun', lmg: 'lmg', mg: 'lmg', knife: 'knife', grenade: 'he', gear: 'gear',
  equipment: 'gear', armor: 'kevlar', armour: 'kevlar', bomb: 'c4',
};

/** Pick the best silhouette for a weapon definition (id-first, then family). */
function iconKey(def, id) {
  const key = id || def?.id;
  if (def?.grenade?.kind && ICONS[def.grenade.kind]) return def.grenade.kind;
  if (key && ID_ICON[key]) return ID_ICON[key];
  if (def?.vmArchetype && ARCH_ICON[def.vmArchetype]) return ARCH_ICON[def.vmArchetype];
  if (def?.kind && KIND_ICON[def.kind]) return KIND_ICON[def.kind];
  if (def?.slot && KIND_ICON[def.slot]) return KIND_ICON[def.slot];
  return 'gear';
}
/** Wrap authored paths into a self-contained inline <svg>. */
function iconSvg(def, id, cls) {
  const body = ICONS[iconKey(def, id)] || ICONS.gear;
  return `<svg class="buy-svg${cls ? ' ' + cls : ''}" viewBox="0 0 64 32" width="100%" height="100%"` +
    ' preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">' +
    `<g fill="currentColor" stroke="none">${body}</g></svg>`;
}

// ---------------------------------------------------------------------------
// Tolerant readers for the shared game/actor objects.  The integrator's exact
// field names are not pinned by the contract, so every getter probes the
// plausible spellings and degrades to a neutral value instead of throwing.
// ---------------------------------------------------------------------------
function firstNum(obj, keys, dflt) {
  if (!obj) return dflt;
  for (let i = 0; i < keys.length; i++) {
    const v = obj[keys[i]];
    if (typeof v === 'number' && isFinite(v)) return v;
  }
  return dflt;
}
function localActor(game) {
  if (!game) return null;
  return game.player || game.localPlayer || game.local || game.me || game.actor ||
    (game.match && (game.match.player || game.match.localPlayer)) || null;
}
function matchOf(game) {
  if (!game) return null;
  const m = game.match || game.state;
  return m && typeof m === 'object' ? m : game;
}
const moneyOf = (a) => firstNum(a, ['money', 'cash', 'funds', 'dollars'], 0);
const armorOf = (a) => firstNum(a, ['armor', 'armour', 'kevlar', 'vest'], 0);
const helmetOf = (a) => !!(a && (a.helmet || a.hasHelmet || a.kevlarhelmet));
const kitOf = (a) => !!(a && (a.defusekit || a.defuseKit || a.hasKit || a.hasDefuseKit || a.kit));
const teamOf = (a) => (a && (a.team || a.side)) || TEAM.CT;

/** Held weapon id for a slot ('primary' | 'secondary' | 'knife'). */
function slotId(actor, slot) {
  if (!actor) return null;
  const cand = [actor[slot], actor.weapons && actor.weapons[slot], actor.inv && actor.inv[slot],
    actor.loadout && actor.loadout[slot], actor.slots && actor.slots[slot]];
  for (let i = 0; i < cand.length; i++) {
    const v = cand[i];
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') {
      if (typeof v.id === 'string') return v.id;
      if (v.def && typeof v.def.id === 'string') return v.def.id;
      if (typeof v.weapon === 'string') return v.weapon;
    }
  }
  // last resort: scan an array style inventory
  const list = Array.isArray(actor.weapons) ? actor.weapons : Array.isArray(actor.inventory) ? actor.inventory : null;
  if (list) {
    for (let i = 0; i < list.length; i++) {
      const w = list[i];
      const id = typeof w === 'string' ? w : w && w.id;
      if (!id) continue;
      if (slot === 'knife' && id === 'knife') return id;
    }
  }
  return null;
}

/** How many of grenade `id` the actor carries (handles array/map/Map shapes). */
function grenadeCount(actor, id) {
  if (!actor) return 0;
  const g = actor.grenades || actor.nades || actor.utility;
  let n = 0;
  if (Array.isArray(g)) {
    for (let i = 0; i < g.length; i++) {
      const it = g[i];
      const gid = typeof it === 'string' ? it : it && (it.id || it.kind);
      if (gid === id) n += typeof it === 'object' && typeof it.count === 'number' ? it.count : 1;
    }
  } else if (g && typeof g.get === 'function') {
    n = g.get(id) || 0;
  } else if (g && typeof g === 'object') {
    const v = g[id];
    n = typeof v === 'number' ? v : v ? 1 : 0;
  }
  if (!n && Array.isArray(actor.inventory)) {
    for (let i = 0; i < actor.inventory.length; i++) {
      const it = actor.inventory[i];
      if ((typeof it === 'string' ? it : it && it.id) === id) n++;
    }
  }
  return n;
}
/** Owned count for any buyable id (0 = not owned). */
function ownedCount(actor, id, def) {
  if (!actor || !id) return 0;
  if (id === 'kevlar') return armorOf(actor) > 0 ? 1 : 0;
  if (id === 'kevlarhelmet') return armorOf(actor) > 0 && helmetOf(actor) ? 1 : 0;
  if (id === 'defusekit') return kitOf(actor) ? 1 : 0;
  const slot = def && def.slot;
  if (slot === 'grenade' || (def && def.grenade) || ID_ICON[id] === 'he' ||
      ['he', 'flash', 'smoke', 'molotov', 'incendiary', 'decoy'].indexOf(id) >= 0) {
    return grenadeCount(actor, id);
  }
  if (slotId(actor, 'primary') === id || slotId(actor, 'secondary') === id) return 1;
  if (id === 'knife') return 1;
  return 0;
}

// --- stat strip normalisation ---------------------------------------------
const ACC_BY_ICON = { sniper: 0.98, ak: 0.76, rifle: 0.82, smg: 0.56, pistol: 0.58, deagle: 0.66, dualies: 0.42, shotgun: 0.3, lmg: 0.44, knife: 0.5 };
/** 0..1 bars for the four card stats; `accuracy` is derived when not supplied. */
function statBars(def, out) {
  const dmg = firstNum(def, ['damage'], 0);
  const rpm = firstNum(def, ['rpm'], 0);
  let acc = firstNum(def, ['accuracy'], -1);
  if (acc < 0) {
    const sp = firstNum(def, ['spread', 'inaccuracy'], -1);
    acc = sp >= 0 ? clamp01(1 - sp / 3) : (ACC_BY_ICON[iconKey(def, def && def.id)] ?? 0.5);
    if (def && def.ads) acc = clamp01(acc + 0.06);
  }
  const ms = firstNum(def, ['moveSpeed', 'movespeed', 'speed'], -1);
  const mob = ms < 0 ? 0.55 : ms > 3 ? clamp01(invLerp(140, 260, ms)) : clamp01(invLerp(0.55, 1.02, ms));
  out[0] = clamp01(dmg / 120);
  out[1] = clamp01(rpm / 1000);
  out[2] = clamp01(acc);
  out[3] = mob;
  return out;
}

/** Seconds of buy window left, or null when the game does not expose it. */
function buyTimeLeft(match) {
  const v = firstNum(match, ['buyTimeLeft', 'buyTimeRemaining', 'buyLeft', 'buyTimer'], NaN);
  if (isFinite(v)) return Math.max(0, v);
  const e = firstNum(match, ['roundElapsed', 'elapsed', 'roundTimeElapsed'], NaN);
  if (isFinite(e)) return Math.max(0, ROUND.freezeTime + ROUND.buyTime - e);
  const bt = firstNum(match, ['buyTime'], NaN);
  return isFinite(bt) ? Math.max(0, bt) : null;
}
/** Walk up from `node` until an element carrying `prop` is found. */
function findUp(node, prop, stop) {
  let n = node;
  while (n && n !== stop) {
    if (n[prop] !== undefined) return n;
    n = n.parentNode;
  }
  return null;
}

const LOAD_ROWS = [
  { key: 'primary', label: '主武器' },
  { key: 'secondary', label: '副武器' },
  { key: 'knife', label: '近战' },
  { key: 'armor', label: '护甲' },
  { key: 'kit', label: '拆弹器' },
];
const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const HINT_BASE = '数字键 购买 · B/ESC 关闭 · 鼠标点击 · 空格 自动购买';

// ===========================================================================
export class BuyMenu {
  /**
   * @param {HTMLElement} root host element the overlay is appended to
   * @param {Object} [cfg] settings object (CFG); may carry `weaponsApi`/`economyApi`
   */
  constructor(root, cfg) {
    this.cfg = cfg || CFG;
    this.root = root || (typeof document !== 'undefined' ? document.body : null);
    /** @type {(id:string)=>{ok:boolean,reason?:string}|null} */
    this.onBuy = null;
    /** @type {(mode:string)=>{ok:boolean,reason?:string,bought?:string[]}|null} */
    this.onAutoBuy = null;
    /** @type {()=>void} */
    this.onCloseRequest = null;
    /** @type {(name:string)=>void} */
    this.onSound = null;

    this._open = false;
    this._level = 0;          // 0 = choosing a category, 1 = choosing an item
    this._cat = 0;
    this._sel = 0;
    this._game = null;
    this._team = null;
    this._cards = [];
    this._catEls = [];
    this._flashes = [];
    this._toastUntil = 0;
    this._sig = '';
    this._bars = [0, 0, 0, 0];
    this._api = null;
    this.setDataSource((this.cfg && this.cfg.weaponsApi) || WMOD, (this.cfg && this.cfg.economyApi) || EMOD);
    this._build();
  }

  /** Inject / replace the weapons + economy modules (also used by tests). */
  setDataSource(weapons, economy) {
    const w = weapons || {};
    const cats = Array.isArray(w.BUY_CATEGORIES) && w.BUY_CATEGORIES.length ? w.BUY_CATEGORIES : DEFAULT_CATEGORIES;
    this._api = {
      WEAPONS: w.WEAPONS && typeof w.WEAPONS === 'object' ? w.WEAPONS : {},
      CATS: cats,
      forTeam: typeof w.weaponsForTeam === 'function' ? w.weaponsForTeam : null,
      limits: w.GRENADE_LIMITS && typeof w.GRENADE_LIMITS === 'object' ? w.GRENADE_LIMITS : null,
      maxNades: typeof w.MAX_GRENADES === 'number' ? w.MAX_GRENADES : 4,
      canBuy: economy && typeof economy.canBuy === 'function' ? economy.canBuy : null,
    };
    this._allowTeam = null;
    this._allowSet = null;
    this._team = null;
    if (this._open) this._rebuild();
  }

  _def(id) { return this._api.WEAPONS[id] || null; }

  /** Set of ids the team may buy, or null when weapons.js does not tell us. */
  _allowed(team) {
    if (this._allowTeam === team) return this._allowSet;
    let set = null;
    if (this._api.forTeam) {
      let list = null;
      try { list = this._api.forTeam(team); } catch (err) { list = null; }
      if (list) {
        set = new Set();
        if (Array.isArray(list)) {
          for (let i = 0; i < list.length; i++) {
            const it = list[i];
            const id = typeof it === 'string' ? it : it && it.id;
            if (id) set.add(id);
          }
        } else if (typeof list === 'object') {
          for (const k in list) {
            const v = list[k];
            const id = typeof v === 'string' ? v : (v && v.id) || k;
            if (id) set.add(id);
          }
        }
        if (!set.size) set = null;
      }
    }
    this._allowTeam = team;
    this._allowSet = set;
    return set;
  }

  /** Can `team` buy this id? Falls back to the definition's own team field. */
  _teamOk(def, id, team) {
    const set = this._allowed(team);
    if (set) return set.has(id);
    const t = def && def.team;
    if (!t || t === 'both' || t === 'any' || t === 'all') return true;
    if (Array.isArray(t)) return t.indexOf(team) >= 0;
    return t === team;
  }

  /** Ids of one category that exist in WEAPONS and are legal for the team. */
  _items(catIndex, team) {
    const cat = this._api.CATS[catIndex];
    const out = [];
    if (!cat) return out;
    const items = cat.items || cat.ids || [];
    for (let i = 0; i < items.length; i++) {
      const raw = items[i];
      const id = typeof raw === 'string' ? raw : raw && raw.id;
      if (!id) continue;
      const def = this._def(id);
      if (!def) continue;
      if (!this._teamOk(def, id, team)) continue;
      out.push(id);
    }
    return out;
  }

  // --- DOM ----------------------------------------------------------------
  _build() {
    if (!this.root || typeof document === 'undefined') return;
    this.el = el('div', 'buy-root');
    this.el.setAttribute('aria-hidden', 'true');
    this.scrim = el('div', 'buy-scrim');
    this.panel = el('div', 'buy-panel');
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-modal', 'true');
    this.panel.setAttribute('aria-label', '购买菜单');

    const head = el('div', 'buy-head');
    const title = el('div', 'buy-title');
    title.appendChild(el('span', 'buy-title-main', '购买菜单'));
    this.teamEl = el('span', 'buy-team');
    title.appendChild(this.teamEl);
    const meta = el('div', 'buy-meta');
    this.roundEl = el('span', 'buy-chip buy-chip-round');
    this.phaseEl = el('span', 'buy-chip buy-chip-phase');
    this.timerEl = el('span', 'buy-chip buy-chip-timer');
    this.moneyEl = el('span', 'buy-chip buy-chip-money');
    this.moneyBar = el('i', 'buy-money-bar');
    this.moneyEl.appendChild(this.moneyBar);
    this.moneyTxt = el('span', 'buy-money-txt');
    this.moneyEl.appendChild(this.moneyTxt);

    meta.appendChild(this.roundEl);
    meta.appendChild(this.phaseEl);
    meta.appendChild(this.timerEl);
    meta.appendChild(this.moneyEl);
    head.appendChild(title);
    head.appendChild(meta);

    const body = el('div', 'buy-body');
    this.cats = el('nav', 'buy-cats');
    this.cats.setAttribute('role', 'tablist');
    this.cats.setAttribute('aria-label', '购买类别');
    this.grid = el('div', 'buy-grid');
    this.grid.setAttribute('role', 'group');
    this.grid.setAttribute('aria-label', '可购买物品');
    this.load = el('aside', 'buy-load');
    this._buildLoadout();
    body.appendChild(this.cats);
    body.appendChild(this.grid);
    body.appendChild(this.load);

    const foot = el('div', 'buy-foot');
    this.hintEl = el('div', 'buy-hint', HINT_BASE);
    foot.appendChild(this.hintEl);
    this.toastEl = el('div', 'buy-toast');
    this.toastEl.setAttribute('aria-live', 'polite');

    this.panel.appendChild(head);
    this.panel.appendChild(body);
    this.panel.appendChild(foot);
    this.panel.appendChild(this.toastEl);
    this.el.appendChild(this.scrim);
    this.el.appendChild(this.panel);
    this.root.appendChild(this.el);

    // Never let the overlay steal keyboard focus: the game keeps handling keys.
    this._onDown = (e) => { if (e && e.preventDefault) e.preventDefault(); };
    this._onClick = (e) => this._handleClick(e);
    this._onOver = (e) => this._handleOver(e);
    this.el.addEventListener('mousedown', this._onDown);
    this.el.addEventListener('click', this._onClick);
    this.el.addEventListener('mouseover', this._onOver);
    this._buildCats();
  }

  _buildLoadout() {
    this.load.appendChild(el('div', 'buy-load-title', '当前装备'));
    this._rows = {};
    for (let i = 0; i < LOAD_ROWS.length; i++) {
      const r = LOAD_ROWS[i];
      const row = el('div', 'buy-load-row');
      const ic = el('span', 'buy-load-ic');
      const tx = el('span', 'buy-load-tx');
      row.appendChild(el('span', 'buy-load-lb', r.label));
      row.appendChild(ic);
      row.appendChild(tx);
      this.load.appendChild(row);
      this._rows[r.key] = { row, ic, tx };
    }
    const nrow = el('div', 'buy-load-row buy-load-nades');
    nrow.appendChild(el('span', 'buy-load-lb', '投掷物'));
    this._nadeWrap = el('span', 'buy-nade-list');
    nrow.appendChild(this._nadeWrap);
    this.load.appendChild(nrow);
    this._loadSig = '';
  }

  _buildCats() {
    this.cats.innerHTML = '';
    this._catEls = [];
    const cats = this._api.CATS;
    for (let i = 0; i < cats.length; i++) {
      const c = cats[i];
      const key = c.key != null ? String(c.key) : DIGITS[Math.min(9, i + 1)];
      const b = el('button', 'buy-cat');
      b.type = 'button';
      b.__catIndex = i;
      b.setAttribute('role', 'tab');
      b.appendChild(el('span', 'buy-cat-key', key));
      b.appendChild(el('span', 'buy-cat-label', c.label || c.cn || c.id || ''));
      const n = el('span', 'buy-cat-n');
      b.appendChild(n);
      this.cats.appendChild(b);
      this._catEls.push({ el: b, key, cat: c, n });
    }
    if (this._cat >= this._catEls.length) this._cat = 0;
  }

  /** Rebuild the item grid for the current team + category. */
  _rebuild() {
    if (!this.grid) return;
    const ids = this._items(this._cat, this._team || TEAM.CT);
    this.grid.innerHTML = '';
    this._cards.length = 0;
    if (!ids.length) {
      const has = Object.keys(this._api.WEAPONS).length > 0;
      this.grid.appendChild(el('div', 'buy-empty', has ? '该类别暂无可购买项目' : '武器数据尚未就绪'));
      this._sel = 0;
      this._sig = '';
      return;
    }
    for (let i = 0; i < ids.length; i++) this._cards.push(this._makeCard(ids[i], i));
    if (this._sel >= this._cards.length) this._sel = this._cards.length - 1;
    this._sig = '';
    this._syncSel();
  }

  _makeCard(id, i) {
    const def = this._def(id) || {};
    const price = firstNum(def, ['price'], 0);
    const card = el('button', 'buy-card');
    card.type = 'button';
    card.__buyId = id;
    card.setAttribute('aria-label', `${def.name || id} ${def.cn || ''} ${fmtMoney(price)}`);
    card.appendChild(el('span', 'buy-key', i < 9 ? DIGITS[i + 1] : i === 9 ? '0' : ''));
    const ic = el('span', 'buy-icon');
    setHTML(ic, iconSvg(def, id));
    card.appendChild(ic);
    const txt = el('span', 'buy-txt');
    txt.appendChild(el('span', 'buy-name', def.name || id));
    txt.appendChild(el('span', 'buy-cn', def.cn || def.desc || ''));
    card.appendChild(txt);
    const priceEl = el('span', 'buy-price', fmtMoney(price));
    card.appendChild(priceEl);
    const stats = el('span', 'buy-stats');
    statBars(def, this._bars);
    for (let s = 0; s < STAT_LABELS.length; s++) {
      const st = el('span', 'buy-stat');
      st.appendChild(el('i', 'buy-stat-lb', STAT_LABELS[s]));
      const track = el('i', 'buy-bar');
      const fill = el('i', 'buy-bar-f');
      setStyle(fill, 'width', Math.round(this._bars[s] * 100) + '%');
      track.appendChild(fill);
      st.appendChild(track);
      stats.appendChild(st);
    }
    card.appendChild(stats);
    const ownedEl = el('span', 'buy-owned', '已拥有');
    card.appendChild(ownedEl);
    this.grid.appendChild(card);
    return { id, def, el: card, price: priceEl, owned: ownedEl, priceVal: price, reason: null };
  }

  _indexOf(id) {
    for (let i = 0; i < this._cards.length; i++) if (this._cards[i].id === id) return i;
    return -1;
  }
  _cardOf(id) {
    const i = this._indexOf(id);
    return i < 0 ? null : this._cards[i];
  }
  _syncSel() {
    for (let i = 0; i < this._cards.length; i++) setCls(this._cards[i].el, 'buy-sel', i === this._sel);
    for (let i = 0; i < this._catEls.length; i++) {
      const c = this._catEls[i];
      setCls(c.el, 'buy-cat-on', i === this._cat);
      c.el.setAttribute('aria-selected', i === this._cat ? 'true' : 'false');
    }
    setCls(this.panel, 'buy-lv1', this._level === 1);
  }

  // --- lifecycle ----------------------------------------------------------
  open(game) {
    if (game) this._game = game;
    if (this._open) { this.update(this._game); return; }
    const team = teamOf(localActor(this._game));
    this._open = true;
    this._level = 0;
    if (this._team !== team) { this._team = team; this._rebuild(); }
    else if (!this._cards.length) this._rebuild();
    setCls(this.el, 'buy-on', true);
    if (this.el) this.el.setAttribute('aria-hidden', 'false');
    this._sig = '';
    this._loadSig = '';
    this._hint();
    this._syncSel();
    this.update(this._game);
  }

  close() {
    if (!this._open) return;
    this._open = false;
    this._level = 0;
    setCls(this.el, 'buy-on', false);
    if (this.el) this.el.setAttribute('aria-hidden', 'true');
    this._clearFlashes();
    this._toastUntil = 0;
    setCls(this.toastEl, 'buy-toast-on', false);
    this._sound('ui_back');
    if (this.onCloseRequest) {
      try { this.onCloseRequest(); } catch (err) { console.error('[buymenu] onCloseRequest', err); }
    }
  }

  get isOpen() { return this._open; }

  update(game) {
    if (game) this._game = game;
    if (!this._open || !this.el) return;
    const g = this._game;
    const actor = localActor(g);
    const match = matchOf(g);
    const team = teamOf(actor);
    if (team !== this._team) { this._team = team; this._rebuild(); }

    setText(this.teamEl, TEAM_LABEL[team] || team);
    setStyle(this.teamEl, 'color', TEAM_COLOR[team] || '');
    const rn = firstNum(match, ['round', 'roundNumber', 'roundIndex', 'roundNo'], NaN);
    setText(this.roundEl, isFinite(rn) ? `第 ${Math.max(1, Math.round(rn))} 回合` : '热身回合');
    const phase = (match && match.phase) || (g && g.phase) || PHASE.FREEZE;
    setText(this.phaseEl, PHASE_LABEL[phase] || String(phase));
    const bt = buyTimeLeft(match);
    setText(this.timerEl, bt == null ? '购买时间 --' : bt > 0 ? `购买时间 ${fmtTime(bt)}` : '购买时间已结束');
    setCls(this.timerEl, 'buy-chip-warn', bt != null && bt <= 5);
    const money = moneyOf(actor);
    setText(this.moneyTxt, fmtMoney(money));
    setStyle(this.moneyBar, 'width', Math.round(clamp01(money / (MONEY.max || 16000)) * 100) + '%');

    const sig = money + '|' + phase + '|' + (bt == null ? -1 : Math.ceil(bt)) + '|' + this._cat + '|' +
      slotId(actor, 'primary') + '|' + slotId(actor, 'secondary') + '|' + armorOf(actor) + '|' +
      (helmetOf(actor) ? 1 : 0) + '|' + (kitOf(actor) ? 1 : 0) + '|' + this._nadeSig(actor);
    if (sig !== this._sig) { this._sig = sig; this._refresh(actor, match); }
    this._tick();
  }

  _nadeSig(actor) {
    let s = '';
    for (let i = 0; i < NADE_IDS.length; i++) s += grenadeCount(actor, NADE_IDS[i]);
    return s;
  }

  /** Re-evaluate every card + the loadout summary (gated by a signature). */
  _refresh(actor, match) {
    const money = moneyOf(actor);
    for (let i = 0; i < this._cards.length; i++) {
      const c = this._cards[i];
      const own = ownedCount(actor, c.id, c.def);
      const chk = this._check(c.id, actor, match);
      const price = chk.price == null ? c.priceVal : chk.price;
      c.priceVal = price;
      c.reason = chk.ok ? null : chk.reason || 'unknown';
      setText(c.price, fmtMoney(price));
      setText(c.owned, own > 1 ? '已拥有 ×' + own : '已拥有');
      setCls(c.el, 'buy-has', own > 0);
      const afford = money >= price;
      setCls(c.el, 'buy-afford', afford);
      setCls(c.el, 'buy-poor', !afford);
      setCls(c.el, 'buy-locked', !chk.ok && afford);
      c.el.setAttribute('aria-disabled', chk.ok ? 'false' : 'true');
    }
    for (let i = 0; i < this._catEls.length; i++) {
      const ids = this._items(i, this._team || TEAM.CT);
      let n = 0;
      for (let k = 0; k < ids.length; k++) {
        const d = this._def(ids[k]);
        if (d && money >= firstNum(d, ['price'], 0)) n++;
      }
      setText(this._catEls[i].n, n ? String(n) : '');
      setCls(this._catEls[i].el, 'buy-cat-none', n === 0);
    }
    this._refreshLoadout(actor);
  }

  _refreshLoadout(actor) {
    const rows = this._rows;
    if (!rows) return;
    const pid = slotId(actor, 'primary');
    const sid = slotId(actor, 'secondary');
    const pdef = pid ? this._def(pid) : null;
    const sdef = sid ? this._def(sid) : null;
    setHTML(rows.primary.ic, pid ? iconSvg(pdef, pid) : '');
    setText(rows.primary.tx, pid ? (pdef && (pdef.name || pdef.cn)) || pid : '无');
    setCls(rows.primary.row, 'buy-load-off', !pid);
    setHTML(rows.secondary.ic, sid ? iconSvg(sdef, sid) : iconSvg(this._def('glock'), 'glock'));
    setText(rows.secondary.tx, sid ? (sdef && (sdef.name || sdef.cn)) || sid : '无');
    setCls(rows.secondary.row, 'buy-load-off', !sid);
    const kdef = this._def('knife');
    setHTML(rows.knife.ic, iconSvg(kdef, 'knife'));
    setText(rows.knife.tx, (kdef && (kdef.name || kdef.cn)) || '匕首');
    const ar = armorOf(actor);
    const hl = helmetOf(actor);
    setHTML(rows.armor.ic, iconSvg(null, hl ? 'kevlarhelmet' : 'kevlar'));
    setText(rows.armor.tx, ar > 0 ? (hl ? '护甲 ' + Math.round(ar) + ' + 头盔' : '护甲 ' + Math.round(ar)) : '无');
    setCls(rows.armor.row, 'buy-load-off', !(ar > 0));
    const kit = kitOf(actor);
    setHTML(rows.kit.ic, iconSvg(null, 'defusekit'));
    setText(rows.kit.tx, kit ? '已携带' : '无');
    setCls(rows.kit.row, 'buy-load-off', !kit);
    const sig = this._nadeSig(actor);
    if (sig !== this._loadSig) {
      this._loadSig = sig;
      let h = '';
      let total = 0;
      for (let i = 0; i < NADE_IDS.length; i++) {
        const id = NADE_IDS[i];
        const n = grenadeCount(actor, id);
        if (n <= 0) continue;
        total += n;
        h += '<span class="buy-nade">' + iconSvg(this._def(id), id) +
          (n > 1 ? '<i class="buy-nade-n">' + n + '</i>' : '') + '</span>';
      }
      const max = this._api.maxNades;
      setHTML(this._nadeWrap, h || '<span class="buy-nade-none">无</span>');
      setCls(this._nadeWrap, 'buy-nade-full', total >= max);
    }
  }

  _check(id, actor, match) {
    const def = this._def(id) || {};
    const price = firstNum(def, ['price'], 0);
    if (this._api.canBuy) {
      let r = null;
      try { r = this._api.canBuy(actor, id, match); } catch (err) { r = null; }
      if (typeof r === 'boolean') return { ok: r, reason: r ? null : 'unknown', price };
      if (r && typeof r === 'object') {
        return { ok: r.ok !== false, reason: r.reason, price: typeof r.price === 'number' ? r.price : price };
      }
    }
    if (actor && price > moneyOf(actor)) return { ok: false, reason: 'money', price };
    return { ok: true, reason: null, price };
  }

  // --- purchasing ---------------------------------------------------------
  /** Attempt to buy `id`; returns true when the purchase went through. */
  buy(id) { return this._buy(id); }

  _buy(id) {
    const card = this._cardOf(id);
    const actor = localActor(this._game);
    const pre = this._check(id, actor, matchOf(this._game));
    if (!pre.ok) { this._fail(card, pre.reason); return false; }
    if (!this.onBuy) { this._fail(card, 'unavailable'); return false; }
    let res = null;
    try { res = this.onBuy(id); } catch (err) { console.error('[buymenu] onBuy', err); res = { ok: false, reason: 'error' }; }
    const ok = res == null ? true : typeof res === 'boolean' ? res : res.ok !== false;
    if (!ok) { this._fail(card, (res && res.reason) || 'unknown'); return false; }
    const def = this._def(id);
    this._sound('buy');
    if (card) this._flash(card.el, 'buy-flash-ok');
    this._toast('已购买 ' + ((def && (def.cn || def.name)) || id), 'ok');
    this._sig = '';
    this.update(this._game);
    return true;
  }

  _fail(card, reason) {
    this._sound('buy_fail');
    if (card) this._flash(card.el, 'buy-flash-no');
    this._toast(reasonText(reason), 'no');
  }

  /** `mode` is 'auto' (space) or 'rebuy' (R); both defer to the integrator. */
  _autoBuy(mode) {
    if (!this.onAutoBuy) { this._sound('buy_fail'); this._toast('自动购买未启用', 'no'); return; }
    let res = null;
    try { res = this.onAutoBuy(mode); } catch (err) { console.error('[buymenu] onAutoBuy', err); res = { ok: false, reason: 'error' }; }
    const ok = res == null ? true : typeof res === 'boolean' ? res : res.ok !== false;
    if (ok) {
      const n = res && Array.isArray(res.bought) ? res.bought.length : 0;
      this._sound('buy');
      this._toast((mode === 'rebuy' ? '已重复上次购买' : '自动购买完成') + (n ? '（' + n + ' 件）' : ''), 'ok');
    } else {
      this._sound('buy_fail');
      this._toast(reasonText(res && res.reason), 'no');
    }
    this._sig = '';
    this.update(this._game);
  }

  _sound(name) {
    if (!this.onSound) return;
    try { this.onSound(name); } catch (err) { console.error('[buymenu] onSound', err); }
  }

  _flash(node, cls) {
    if (!node || !node.classList) return;
    node.classList.remove(cls);
    void node.offsetWidth;                    // restart the css animation
    node.classList.add(cls);
    this._flashes.push({ node, cls, until: nowSec() + 0.5 });
  }
  _clearFlashes() {
    for (let i = 0; i < this._flashes.length; i++) {
      const f = this._flashes[i];
      if (f.node.classList) f.node.classList.remove(f.cls);
    }
    this._flashes.length = 0;
  }
  _toast(text, kind) {
    if (!this.toastEl) return;
    setText(this.toastEl, text);
    setCls(this.toastEl, 'buy-toast-ok', kind === 'ok');
    setCls(this.toastEl, 'buy-toast-no', kind !== 'ok');
    setCls(this.toastEl, 'buy-toast-on', false);
    void this.toastEl.offsetWidth;
    setCls(this.toastEl, 'buy-toast-on', true);
    this._toastUntil = nowSec() + 2.2;
  }
  /** Expire flashes + the toast; driven from update() so no timers leak. */
  _tick() {
    const t = nowSec();
    for (let i = this._flashes.length - 1; i >= 0; i--) {
      const f = this._flashes[i];
      if (t >= f.until) {
        if (f.node.classList) f.node.classList.remove(f.cls);
        this._flashes.splice(i, 1);
      }
    }
    if (this._toastUntil && t >= this._toastUntil) {
      this._toastUntil = 0;
      setCls(this.toastEl, 'buy-toast-on', false);
    }
  }

  // --- navigation ---------------------------------------------------------
  _hint() {
    setText(this.hintEl, this._level === 0
      ? HINT_BASE + ' · ←→ 选择类别 · 回车 进入'
      : HINT_BASE + ' · R 重复上次 · 退格 返回类别');
  }
  _setCat(i) {
    const n = this._catEls.length;
    if (!n) return;
    const idx = ((i % n) + n) % n;
    if (idx !== this._cat) { this._cat = idx; this._sel = 0; this._rebuild(); }
    this._syncSel();
  }

  _setSel(i) {
    if (!this._cards.length) return;
    const n = this._cards.length;
    this._sel = ((i % n) + n) % n;
    this._syncSel();
  }
  _catByKey(d) {
    const s = String(d);
    for (let i = 0; i < this._catEls.length; i++) if (this._catEls[i].key === s) return i;
    const i = d - 1;
    return i >= 0 && i < this._catEls.length ? i : -1;
  }
  _enterCat(i) {
    if (i < 0) { this._sound('buy_fail'); return; }
    this._setCat(i);
    this._level = 1;
    this._hint();
    this._syncSel();
    this._sound('ui_click');
  }
  _back() {
    if (this._level === 1) { this._level = 0; this._hint(); this._syncSel(); this._sound('ui_back'); return true; }
    return false;
  }
  _digit(d) {
    if (this._level === 0) { this._enterCat(this._catByKey(d)); return; }
    const c = this._cards[d === 0 ? 9 : d - 1];
    if (c) { this._setSel(this._indexOf(c.id)); this._buy(c.id); }
    else { this._sound('buy_fail'); this._toast('该数字键没有对应物品', 'no'); }
  }

  /**
   * Keyboard entry point. Returns true when the key was consumed so the
   * integrator can stop it from reaching the game input layer.
   */
  onKey(event) {
    if (!this._open || !event) return false;
    const code = typeof event.code === 'string' ? event.code : '';
    const key = typeof event.key === 'string' ? event.key : '';
    const k = key.toLowerCase();
    let digit = -1;
    const m = /^(?:Digit|Numpad)([0-9])$/.exec(code);
    if (m) digit = +m[1];
    else if (/^[0-9]$/.test(key)) digit = +key;
    const eat = () => {
      if (event.preventDefault) event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
    };
    if (digit >= 0) { eat(); this._digit(digit); return true; }
    if (code === 'Escape' || k === 'escape' || k === 'esc') { eat(); if (!this._back()) this.close(); return true; }
    if (code === 'KeyB' || k === 'b') { eat(); this.close(); return true; }

    if (code === 'Backspace' || k === 'backspace') { eat(); this._back(); return true; }
    if (code === 'Space' || key === ' ' || k === 'spacebar') { eat(); this._autoBuy('auto'); return true; }
    if (code === 'KeyR' || k === 'r') { eat(); this._autoBuy('rebuy'); return true; }
    if (code === 'ArrowLeft' || k === 'arrowleft') { eat(); this._setCat(this._cat - 1); return true; }
    if (code === 'ArrowRight' || k === 'arrowright') { eat(); this._setCat(this._cat + 1); return true; }
    if (code === 'ArrowUp' || k === 'arrowup') {
      eat();
      if (this._level === 0) this._setCat(this._cat - 1); else this._setSel(this._sel - 1);
      return true;
    }
    if (code === 'ArrowDown' || k === 'arrowdown') {
      eat();
      if (this._level === 0) this._setCat(this._cat + 1); else this._setSel(this._sel + 1);
      return true;
    }
    if (code === 'Enter' || code === 'NumpadEnter' || k === 'enter') {
      eat();
      if (this._level === 0) this._enterCat(this._cat);
      else if (this._cards[this._sel]) this._buy(this._cards[this._sel].id);
      return true;
    }
    return false;
  }

  // --- mouse --------------------------------------------------------------
  _handleClick(e) {
    const t = e && (e.target || e.srcElement);
    if (!t) return;
    const cat = findUp(t, '__catIndex', this.el);
    if (cat) { this._enterCat(cat.__catIndex); return; }
    const card = findUp(t, '__buyId', this.el);
    if (card) {
      this._level = 1;
      const i = this._indexOf(card.__buyId);
      if (i >= 0) this._setSel(i);
      this._hint();
      this._buy(card.__buyId);
      return;
    }
    if (t === this.scrim || t === this.el) this.close();
  }
  _handleOver(e) {
    const t = e && (e.target || e.srcElement);
    if (!t) return;
    const card = findUp(t, '__buyId', this.el);
    if (card) {
      const i = this._indexOf(card.__buyId);
      if (i >= 0 && i !== this._sel) { this._setSel(i); this._sound('ui_hover'); }
    }
  }

  dispose() {
    this._open = false;
    this._clearFlashes();
    if (this.el) {
      this.el.removeEventListener('mousedown', this._onDown);
      this.el.removeEventListener('click', this._onClick);
      this.el.removeEventListener('mouseover', this._onOver);
      if (this.el.parentNode) this.el.parentNode.removeChild(this.el);
    }
    this._cards.length = 0;
    this._catEls = [];
    this._rows = null;
    this.el = this.panel = this.scrim = this.grid = this.cats = this.load = null;
    this.teamEl = this.roundEl = this.phaseEl = this.timerEl = this.moneyEl = null;
    this.moneyBar = this.moneyTxt = this.hintEl = this.toastEl = this._nadeWrap = null;
    this.onBuy = this.onAutoBuy = this.onCloseRequest = this.onSound = null;
    this._game = null;
  }
}

const STAT_LABELS = ['伤害', '射速', '精度', '机动'];
const NADE_IDS = ['he', 'flash', 'smoke', 'molotov', 'incendiary', 'decoy'];

export default BuyMenu;

