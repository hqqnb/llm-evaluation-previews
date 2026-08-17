// ============================================================================
// ui/radar.js — CS-style rotating radar drawn with canvas 2D only.
//
// The canvas is created inside the container handed to the constructor, so the
// module stays import-safe under Node (nothing touches `document` at module
// scope).  Everything is drawn from pre-computed scratch state: no arrays or
// objects are allocated inside update(), and the map is blitted once per frame
// through drawImage.
//
// Public API:
//   setMap(mapDef, radarCanvas)   radarCanvas may be null -> schematic fallback
//   update(game)   setSpectateTarget(actor)   resize()   dispose()
// ============================================================================

import { TEAM, TEAM_COLOR, CFG } from '../core/constants.js';
import { clamp, clamp01, lerp, TAU, DEG } from '../core/util.js';

// --- look & feel -----------------------------------------------------------
const FONT = 'ui-sans-serif, system-ui, "Helvetica Neue", sans-serif';
const RANGE_M = 46;            // metres across the widget at zoom 1
const SEEN_FADE = 2.0;         // enemy blip lifetime after the last sighting
const DEATH_FADE = 3.0;        // teammate X lifetime
const SOUND_FADE = 1.3;        // heard-marker lifetime
const HEIGHT_CUE = 2.0;        // metres before the up/down badge appears
const C_BG = '#0a0d11';
const C_FLOOR = '#454d57';
const C_COVER = '#2b3138';
const C_WALL = '#14181d';
const C_WATER = '#1d3a4a';
const C_GRID = 'rgba(150,190,220,0.055)';
const C_TINT = 'rgba(14,22,34,0.42)';
const C_FRAME_HI = 'rgba(255,255,255,0.16)';
const C_FRAME_LO = 'rgba(0,0,0,0.66)';
const C_SITE = 'rgba(226,74,60,0.85)';
const C_BOMB = '#ff4a3d';
const C_DEAD = 'rgba(190,196,204,0.72)';
const C_ENEMY = '#e8483c';
const DASH = [3, 3];
const NODASH = [];
const C_SOUND = 'rgba(232,238,248,0.55)';
const NUMS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16'];

// --- tolerant readers ------------------------------------------------------
/** Alive test that copes with `alive`, `dead` and bare `health` actors. */
function isAlive(a) {
  if (!a) return false;
  if (a.alive === false || a.dead === true) return false;
  if (typeof a.health === 'number' && a.health <= 0) return false;
  return true;
}
/** All actors the game knows about, whatever the field is called. */
function actorsOf(game) {
  if (!game) return null;
  const c = game.actors || game.players || game.entities || game.bots;
  return Array.isArray(c) ? c : null;
}
function teamOf(a) { return (a && (a.team || a.side)) || TEAM.CT; }
/** Numeric yaw in radians, whatever the field is called. */
function yawOf(a) {
  if (!a) return 0;
  if (typeof a.yaw === 'number') return a.yaw;
  if (a.angles && typeof a.angles.yaw === 'number') return a.angles.yaw;
  if (a.rot && typeof a.rot.y === 'number') return a.rot.y;
  if (a.view && typeof a.view.yaw === 'number') return a.view.yaw;
  if (typeof a.rotY === 'number') return a.rotY;
  return 0;
}

// ===========================================================================
export class Radar {
  /**
   * @param {HTMLElement} container element the canvas is appended to
   * @param {Object} [cfg] settings (CFG); reads radarZoom, radarNorthUp, fov,
   *                       radarShape ('rsquare'|'circle'), radarNames,
   *                       radarRotOffset / radarYawSign (yaw convention shims)
   */
  constructor(container, cfg) {
    this.cfg = cfg || CFG;
    this.container = container || null;
    this.canvas = null;
    this.ctx = null;
    this.map = null;
    this.img = null;            // pre-rendered top-down image (or the fallback)
    this.imgX0 = 0; this.imgZ0 = 0; this.imgX1 = 1; this.imgZ1 = 1;
    this.spectate = null;
    this.w = 0; this.h = 0; this.dpr = 1;
    this._zoom = 1;             // smoothed zoom, follows the target
    this._frame = 0;
    this._track = new Map();    // actor -> {f,alive,dx,dz,dy,dt,sx,sz,sy,st,num}
    this._box = [0, 0, 0, 0];   // scratch for site rectangles
    this._sx = 0; this._sy = 0; // scratch for world -> screen
    this._cos = 1; this._sin = 0;
    this._cx = 0; this._cy = 0; this._r = 1; this._scale = 1;
    this._vx = 0; this._vy = 0; this._vz = 0;
    this._camX = 0; this._camY = 0; this._camZ = 0;
    this._numT = 0; this._numCT = 0;
    if (typeof document !== 'undefined' && this.container) this._create();
  }

  _create() {
    const c = document.createElement('canvas');
    c.className = 'radar-canvas';
    c.setAttribute('aria-hidden', 'true');
    this.canvas = c;
    this.ctx = c.getContext ? c.getContext('2d') : null;
    if (this.container.classList) this.container.classList.add('radar-host');
    this.container.appendChild(c);
    this._onResize = () => this.resize();
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('resize', this._onResize);
    }
    if (typeof ResizeObserver === 'function') {
      try { this._ro = new ResizeObserver(this._onResize); this._ro.observe(this.container); }
      catch (err) { this._ro = null; }
    }
    this.resize();
  }

  /** Match the backing store to the container size and devicePixelRatio. */
  resize() {
    if (!this.canvas || !this.container) return;
    let w = this.container.clientWidth || 0;
    let h = this.container.clientHeight || 0;
    if ((!w || !h) && this.container.getBoundingClientRect) {
      const r = this.container.getBoundingClientRect() || null;
      if (r) { w = w || r.width || 0; h = h || r.height || 0; }
    }
    if (!w) w = 200;
    if (!h) h = w;
    const dpr = clamp((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 1, 2);
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    if (this.canvas.style) {
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
    }
  }

  setSpectateTarget(actor) { this.spectate = actor || null; }

  /**
   * @param {Object} mapDef  MapDef (uses .radar, .brushes, .sites)
   * @param {HTMLCanvasElement|null} radarCanvas pre-rendered top-down image;
   *        when null a schematic is rendered from mapDef.brushes instead.
   */
  setMap(mapDef, radarCanvas) {
    this.map = mapDef || null;
    let x0 = 0, z0 = 0, x1 = 0, z1 = 0;
    const rd = mapDef && mapDef.radar;

    if (rd && rd.min && rd.max) {
      x0 = +(rd.min[0] !== undefined ? rd.min[0] : rd.min.x) || 0;
      z0 = +(rd.min[1] !== undefined ? rd.min[1] : rd.min.z) || 0;
      x1 = +(rd.max[0] !== undefined ? rd.max[0] : rd.max.x) || 0;
      z1 = +(rd.max[1] !== undefined ? rd.max[1] : rd.max.z) || 0;
    } else if (mapDef && Array.isArray(mapDef.brushes)) {
      x0 = z0 = Infinity; x1 = z1 = -Infinity;
      const bs = mapDef.brushes;
      for (let i = 0; i < bs.length; i++) {
        const b = bs[i];
        if (!b || !b.min || !b.max) continue;
        if (b.min.x < x0) x0 = b.min.x;
        if (b.min.z < z0) z0 = b.min.z;
        if (b.max.x > x1) x1 = b.max.x;
        if (b.max.z > z1) z1 = b.max.z;
      }
      if (isFinite(x0)) { x0 -= 2; z0 -= 2; x1 += 2; z1 += 2; }
    }
    if (!(x1 > x0)) { x0 = -32; x1 = 32; }
    if (!(z1 > z0)) { z0 = -32; z1 = 32; }
    this.imgX0 = x0; this.imgZ0 = z0; this.imgX1 = x1; this.imgZ1 = z1;
    this.img = radarCanvas || (mapDef ? this._buildFallback(mapDef) : null);
  }

  /** Schematic top-down render used when no pre-baked radar image is supplied. */
  _buildFallback(mapDef) {
    if (typeof document === 'undefined') return null;
    const wm = this.imgX1 - this.imgX0;
    const hm = this.imgZ1 - this.imgZ0;
    const sc = clamp(896 / Math.max(wm, hm), 2, 14);
    const cv = document.createElement('canvas');
    cv.width = Math.max(2, Math.round(wm * sc));
    cv.height = Math.max(2, Math.round(hm * sc));
    const g = cv.getContext ? cv.getContext('2d') : null;
    if (!g) return null;
    g.fillStyle = 'rgba(9,12,16,0.9)';
    g.fillRect(0, 0, cv.width, cv.height);
    const bs = Array.isArray(mapDef.brushes) ? mapDef.brushes : null;
    if (!bs) return cv;
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    for (let pass = 0; pass < 3; pass++) {
      g.fillStyle = pass === 0 ? C_FLOOR : pass === 1 ? C_COVER : C_WALL;
      for (let i = 0; i < bs.length; i++) {
        const b = bs[i];
        if (!b || !b.min || !b.max || b.visible === false) continue;
        const hgt = b.max.y - b.min.y;
        const p = b.water ? 0 : hgt <= 0.6 ? 0 : hgt <= 1.35 ? 1 : 2;
        if (p !== pass) continue;
        const x = (b.min.x - this.imgX0) * sc;
        const y = (b.min.z - this.imgZ0) * sc;
        const w = Math.max(1, (b.max.x - b.min.x) * sc);
        const h = Math.max(1, (b.max.z - b.min.z) * sc);
        if (b.water) { g.fillStyle = C_WATER; g.fillRect(x, y, w, h); g.fillStyle = C_FLOOR; continue; }
        g.fillRect(x, y, w, h);
        if (pass === 2) g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      }
    }
    return cv;
  }

  // --- geometry -----------------------------------------------------------
  _now(game) {
    if (game) {
      if (typeof game.time === 'number') return game.time;
      if (typeof game.now === 'number') return game.now;
      if (game.match && typeof game.match.time === 'number') return game.match.time;
      if (typeof game.clock === 'number') return game.clock;
    }
    return (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) / 1000;
  }
  /** Read any position-ish object into _vx/_vy/_vz. */
  _pos(o) {
    if (!o) return false;
    const p = o.pos || o.position || o.p;
    if (Array.isArray(p)) { this._vx = +p[0] || 0; this._vy = +p[1] || 0; this._vz = +p[2] || 0; return true; }
    if (p && typeof p === 'object') { this._vx = +p.x || 0; this._vy = +p.y || 0; this._vz = +p.z || 0; return true; }
    if (typeof o.x === 'number' && typeof o.z === 'number') {
      this._vx = o.x; this._vy = +o.y || 0; this._vz = o.z; return true;
    }
    return false;
  }
  /** World XZ -> canvas px (rotation included), result in _sx/_sy. */
  _toScreen(wx, wz) {
    const dx = (wx - this._camX) * this._scale;
    const dz = (wz - this._camZ) * this._scale;
    this._sx = this._cx + dx * this._cos - dz * this._sin;
    this._sy = this._cy + dx * this._sin + dz * this._cos;
  }
  /** Clip outline: rounded square by default, circle when cfg.radarShape says so. */
  _shapePath(g, cx, cy, r) {
    g.beginPath();
    if (this.cfg.radarShape === 'circle') { g.arc(cx, cy, r, 0, TAU); g.closePath(); return; }
    const k = r * 0.34;
    const x = cx - r, y = cy - r, s = r * 2;
    g.moveTo(x + k, y);
    g.lineTo(x + s - k, y);
    g.quadraticCurveTo(x + s, y, x + s, y + k);
    g.lineTo(x + s, y + s - k);
    g.quadraticCurveTo(x + s, y + s, x + s - k, y + s);
    g.lineTo(x + k, y + s);
    g.quadraticCurveTo(x, y + s, x, y + s - k);
    g.lineTo(x, y + k);
    g.quadraticCurveTo(x, y, x + k, y);
    g.closePath();
  }
  /** Track record for an actor (created on demand, pruned in _prune). */
  _rec(a) {
    let t = this._track.get(a);
    if (!t) {
      t = { f: 0, alive: true, dx: 0, dz: 0, dy: 0, dt: -1e9, sx: 0, sz: 0, sy: 0, st: -1e9, num: 0 };
      this._track.set(a, t);
    }
    t.f = this._frame;
    return t;
  }

  _prune() {
    if (this._frame % 180 !== 0 || this._track.size < 4) return;
    const cutoff = this._frame - 600;
    for (const [k, v] of this._track) if (v.f < cutoff) this._track.delete(k);
  }

  // --- frame --------------------------------------------------------------
  update(game) {
    const g = this.ctx;
    if (!g || !this.canvas) return;
    if (!this.w || !this.h) this.resize();
    this._frame++;
    const now = this._now(game);
    const spec = this.spectate || (game && game.spectate && game.spectate.target) || null;
    const local = (game && (game.local || game.player || game.localPlayer || game.me)) || null;
    const cam = spec || local;
    const myTeam = teamOf(local || cam);
    if (this._pos(cam)) { this._camX = this._vx; this._camY = this._vy; this._camZ = this._vz; }
    const yaw = yawOf(cam) * (this.cfg.radarYawSign || 1) + (this.cfg.radarRotOffset || 0);
    const theta = this.cfg.radarNorthUp === true ? 0 : yaw;
    this._cos = Math.cos(theta);
    this._sin = Math.sin(theta);
    const zt = clamp((this.cfg.radarZoom || 1) * (spec ? 0.7 : 1), 0.35, 3);
    this._zoom = this._zoom > 0 ? lerp(this._zoom, zt, 0.12) : zt;

    const dpr = this.dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    const cx = this._cx = Math.round(this.w * 0.5);
    const cy = this._cy = Math.round(this.h * 0.5);
    const r = this._r = Math.max(10, Math.min(this.w, this.h) * 0.5 - 3);
    this._scale = (r * 2) * this._zoom / RANGE_M;

    g.save();
    this._shapePath(g, cx, cy, r);
    g.fillStyle = C_BG;
    g.fill();
    g.clip();
    this._drawMap(g, cx, cy, r);
    this._drawGrid(g, cx, cy, r);
    this._drawSites(g);
    if (game) {
      this._drawSounds(g, game, now, myTeam);
      this._drawBomb(g, game, now);
      this._drawActors(g, game, now, myTeam, local, cam);
    }
    this._drawSelf(g, cam, yaw);
    g.restore();
    this._drawFrame(g, cx, cy, r, theta, spec);
    this._prune();
  }

  _drawMap(g, cx, cy, r) {
    const img = this.img;
    if (img) {
      const s = this._scale;
      g.save();
      g.translate(cx, cy);
      g.transform(this._cos, this._sin, -this._sin, this._cos, 0, 0);
      g.globalAlpha = 0.92;
      g.drawImage(img,
        (this.imgX0 - this._camX) * s, (this.imgZ0 - this._camZ) * s,
        (this.imgX1 - this.imgX0) * s, (this.imgZ1 - this.imgZ0) * s);
      g.globalAlpha = 1;
      g.restore();
    }
    g.fillStyle = C_TINT;
    g.fillRect(cx - r, cy - r, r * 2, r * 2);
  }

  _drawGrid(g, cx, cy, r) {
    const step = Math.max(16, r * 0.5);
    g.strokeStyle = C_GRID;
    g.lineWidth = 1;
    g.beginPath();
    for (let x = cx - r; x <= cx + r + 0.1; x += step) {
      const px = Math.round(x) + 0.5;
      g.moveTo(px, cy - r); g.lineTo(px, cy + r);
    }
    for (let y = cy - r; y <= cy + r + 0.1; y += step) {
      const py = Math.round(y) + 0.5;
      g.moveTo(cx - r, py); g.lineTo(cx + r, py);
    }
    g.stroke();
  }

  _drawSites(g) {
    const sites = this.map && this.map.sites;
    if (!sites) return;
    this._drawSite(g, sites.A, 'A');
    this._drawSite(g, sites.B, 'B');
  }
  _drawSite(g, site, label) {
    if (!site) return;
    const b = this._box;
    if (!readBox(site.area || site, b)) return;
    g.beginPath();
    this._toScreen(b[0], b[1]); g.moveTo(this._sx, this._sy);
    this._toScreen(b[2], b[1]); g.lineTo(this._sx, this._sy);
    this._toScreen(b[2], b[3]); g.lineTo(this._sx, this._sy);
    this._toScreen(b[0], b[3]); g.lineTo(this._sx, this._sy);
    g.closePath();
    g.fillStyle = 'rgba(226,74,60,0.11)';
    g.fill();
    if (g.setLineDash) g.setLineDash(DASH);
    g.lineWidth = 1.2;
    g.strokeStyle = C_SITE;
    g.stroke();
    if (g.setLineDash) g.setLineDash(NODASH);
    this._toScreen((b[0] + b[2]) * 0.5, (b[1] + b[3]) * 0.5);
    g.font = '700 12px ' + FONT;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(255,214,208,0.9)';
    g.fillText(label, this._sx, this._sy);
  }

  _drawSounds(g, game, now, myTeam) {
    const arr = game.sounds;
    if (!Array.isArray(arr) || !arr.length) return;
    g.strokeStyle = C_SOUND;
    for (let i = 0; i < arr.length; i++) {
      const s = arr[i];
      if (!s) continue;
      if (s.team && s.team === myTeam) continue;          // our own noise is not news
      const t = typeof s.t === 'number' ? s.t : -1e9;
      const age = now - t;
      if (age < 0 || age > SOUND_FADE) continue;
      if (!this._pos(s)) continue;
      const wx = this._vx, wz = this._vz;
      if (typeof s.range === 'number' && s.range > 0) {
        const dx = wx - this._camX, dz = wz - this._camZ;
        if (dx * dx + dz * dz > s.range * s.range) continue;
      }
      const k = 1 - age / SOUND_FADE;
      this._toScreen(wx, wz);
      g.globalAlpha = k * 0.5;
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(this._sx, this._sy, 2.5 + (1 - k) * 10, 0, TAU);
      g.stroke();
      g.globalAlpha = k * 0.8;
      g.fillStyle = C_SOUND;
      g.beginPath();
      g.arc(this._sx, this._sy, 1.5, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  _drawBomb(g, game, now) {
    const b = game.bomb;
    if (!b) return;
    const st = b.state || (b.planted ? 'planted' : b.dropped ? 'dropped' : b.carrier ? 'carried' : '');
    if (st === 'carried' || st === 'exploded' || !st) return;
    if (!this._pos(b)) return;
    this._toScreen(this._vx, this._vz);
    const dy = this._vy - this._camY;
    let x = this._sx, y = this._sy;
    if (this._clampToRim(x, y)) { this._chevron(g, this._sx, this._sy, C_BOMB); return; }
    x = this._sx; y = this._sy;
    if (st === 'planted') {
      const ph = (now * 1.5) % 1;
      g.strokeStyle = C_BOMB;
      g.lineWidth = 1.5;
      g.globalAlpha = 0.85 * (1 - ph);
      g.beginPath();
      g.arc(x, y, 4 + ph * 15, 0, TAU);
      g.stroke();
      g.globalAlpha = 1;
      this._c4(g, x, y, 1.2, C_BOMB);
    } else this._c4(g, x, y, 1, st === 'defused' ? 'rgba(126,208,150,0.95)' : '#e8c14a');
    this._heightBadge(g, x, y, dy);
  }

  _drawActors(g, game, now, myTeam, local, cam) {
    const list = actorsOf(game);
    this._names = this.cfg.radarNames !== false && this.w >= 150;
    const carrier = game.bomb && game.bomb.state === 'carried' ? game.bomb.carrier : null;
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a || a === local || a === cam) continue;
      const t = this._rec(a);
      if (!t.num) t.num = this._assignNum(a);
      const alive = isAlive(a);
      if (t.alive && !alive) {
        if (this._pos(a)) { t.dx = this._vx; t.dy = this._vy; t.dz = this._vz; }
        t.dt = typeof a.deathTime === 'number' ? a.deathTime : now;
      }
      t.alive = alive;
      const mate = teamOf(a) === myTeam;
      if (mate && alive) this._drawMate(g, a, t, carrier);
      else if (mate) { if (now - t.dt < DEATH_FADE) this._drawDeadX(g, t, now); }
      else if (alive) this._drawEnemy(g, a, t, now, myTeam, carrier);
    }
  }

  _assignNum(a) {
    const cand = [a.num, a.number, a.slot, a.idx, a.index];
    for (let i = 0; i < cand.length; i++) {
      if (typeof cand[i] === 'number' && cand[i] > 0 && cand[i] < 17) return cand[i];
    }
    return teamOf(a) === TEAM.T ? Math.min(16, ++this._numT) : Math.min(16, ++this._numCT);
  }

  _drawMate(g, a, t, carrier) {
    if (!this._pos(a)) return;
    const wy = this._vy;
    this._toScreen(this._vx, this._vz);
    const col = TEAM_COLOR[teamOf(a)] || '#8ab4f8';
    if (this._clampToRim(this._sx, this._sy)) { this._chevron(g, this._sx, this._sy, col); return; }
    const x = this._sx, y = this._sy;
    g.fillStyle = col;
    g.beginPath();
    g.arc(x, y, 4.6, 0, TAU);
    g.fill();
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.stroke();
    const hp = typeof a.health === 'number' ? clamp01(a.health / 100) : 1;
    if (hp < 1) {
      g.strokeStyle = hp > 0.5 ? 'rgba(120,220,140,0.95)' : 'rgba(240,170,60,0.95)';
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(x, y, 6.4, -Math.PI * 0.5, -Math.PI * 0.5 + TAU * hp);
      g.stroke();
    }
    g.fillStyle = '#0b0e12';
    g.font = '700 7px ' + FONT;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(NUMS[t.num] || '', x, y + 0.5);
    if (this._names && typeof a.name === 'string' && a.name) {
      g.fillStyle = 'rgba(226,232,240,0.7)';
      g.font = '600 8px ' + FONT;
      g.textBaseline = 'top';
      g.fillText(a.name.length > 7 ? a.name.slice(0, 7) : a.name, x, y + 7);
      g.textBaseline = 'middle';
    }
    if (carrier && (carrier === a || carrier === a.id || carrier === a.name)) this._c4(g, x + 8, y - 7, 0.85, C_BOMB);
    this._heightBadge(g, x, y, wy - this._camY);
  }

  _drawDeadX(g, t, now) {
    this._toScreen(t.dx, t.dz);
    if (this._clampToRim(this._sx, this._sy)) return;
    const x = this._sx, y = this._sy;
    g.globalAlpha = clamp01(1 - (now - t.dt) / DEATH_FADE) * 0.85 + 0.1;
    g.strokeStyle = C_DEAD;
    g.lineWidth = 1.8;
    g.beginPath();
    g.moveTo(x - 3.4, y - 3.4); g.lineTo(x + 3.4, y + 3.4);
    g.moveTo(x + 3.4, y - 3.4); g.lineTo(x - 3.4, y + 3.4);
    g.stroke();
    g.globalAlpha = 1;
  }

  _drawEnemy(g, a, t, now, myTeam, carrier) {
    if (enemyVisible(a, myTeam)) {
      if (this._pos(a)) { t.sx = this._vx; t.sy = this._vy; t.sz = this._vz; }
      t.st = now;
    }
    const age = now - t.st;
    if (age > SEEN_FADE) return;
    const k = clamp01(1 - age / SEEN_FADE);
    this._toScreen(t.sx, t.sz);
    const col = C_ENEMY;
    if (this._clampToRim(this._sx, this._sy)) {
      g.globalAlpha = 0.25 + k * 0.75;
      this._chevron(g, this._sx, this._sy, col);
      g.globalAlpha = 1;
      return;
    }
    const x = this._sx, y = this._sy;
    g.globalAlpha = 0.22 + k * 0.78;
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(x, y - 5.4); g.lineTo(x + 5, y); g.lineTo(x, y + 5.4); g.lineTo(x - 5, y);
    g.closePath();
    g.fill();
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.stroke();
    if (carrier && (carrier === a || carrier === a.id)) this._c4(g, x + 8, y - 7, 0.85, C_BOMB);
    this._heightBadge(g, x, y, t.sy - this._camY);
    g.globalAlpha = 1;
  }

  /** Local player (or spectated actor): FOV wedge + bright arrow, always centred. */
  _drawSelf(g, cam, yaw) {
    if (!cam) return;
    const x = this._cx, y = this._cy;
    this._toScreen(this._camX - Math.sin(yaw), this._camZ - Math.cos(yaw));
    let ax = this._sx - x, ay = this._sy - y;
    const len = Math.hypot(ax, ay) || 1;
    ax /= len; ay /= len;
    const ang = Math.atan2(ay, ax);
    const half = clamp((this.cfg.fov || CFG.fov || 90) * DEG * 0.5, 0.25, 1.4);
    g.beginPath();
    g.moveTo(x, y);
    g.arc(x, y, this._r * 0.66, ang - half, ang + half);
    g.closePath();
    g.fillStyle = 'rgba(226,240,255,0.075)';
    g.fill();
    const col = TEAM_COLOR[teamOf(cam)] || '#ffffff';
    const nx = -ay, ny = ax;
    g.beginPath();
    g.moveTo(x + ax * 8.5, y + ay * 8.5);
    g.lineTo(x + nx * 5 - ax * 4.5, y + ny * 5 - ay * 4.5);
    g.lineTo(x - ax * 1.6, y - ay * 1.6);
    g.lineTo(x - nx * 5 - ax * 4.5, y - ny * 5 - ay * 4.5);
    g.closePath();
    g.fillStyle = col;
    g.fill();
    g.lineWidth = 1.2;
    g.strokeStyle = 'rgba(255,255,255,0.92)';
    g.stroke();
  }

  _drawFrame(g, cx, cy, r, theta, spec) {
    g.lineWidth = 2.5;
    g.strokeStyle = C_FRAME_LO;
    this._shapePath(g, cx, cy, r + 1);
    g.stroke();
    g.lineWidth = 1;
    g.strokeStyle = C_FRAME_HI;
    this._shapePath(g, cx, cy, r - 0.5);
    g.stroke();
    const nx = cx + Math.sin(theta) * (r - 5);
    const ny = cy - Math.cos(theta) * (r - 5);
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.beginPath();
    g.arc(nx, ny, 1.8, 0, TAU);
    g.fill();
    if (spec) {
      const name = typeof spec.name === 'string' ? spec.name : '';
      g.font = '700 9px ' + FONT;
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(cx - 34, cy + r - 16, 68, 13);
      g.fillStyle = 'rgba(232,238,248,0.92)';
      g.fillText('观战 ' + (name.length > 6 ? name.slice(0, 6) : name), cx, cy + r - 6);
    }
  }

  /** Clamp a blip to the rim; true when it was outside (draw a chevron then). */
  _clampToRim(x, y) {
    const dx = x - this._cx, dy = y - this._cy;
    const lim = this._r - 5;
    const d = Math.hypot(dx, dy);
    if (d <= lim) { this._sx = x; this._sy = y; return false; }
    const k = lim / (d || 1);
    this._sx = this._cx + dx * k;
    this._sy = this._cy + dy * k;
    this._ang = Math.atan2(dy, dx);
    return true;
  }
  _chevron(g, x, y, col) {
    const a = this._ang, c = Math.cos(a), s = Math.sin(a);
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(x + c * 4.6, y + s * 4.6);
    g.lineTo(x - s * 3.6 - c * 2.2, y + c * 3.6 - s * 2.2);
    g.lineTo(x + s * 3.6 - c * 2.2, y - c * 3.6 - s * 2.2);
    g.closePath();
    g.fill();
  }
  /** Small C4 glyph (carried / dropped / planted bomb). */
  _c4(g, x, y, k, col) {
    const w = 5.6 * k, h = 7 * k;
    g.fillStyle = col;
    g.fillRect(x - w * 0.5, y - h * 0.5, w, h);
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(x - w * 0.5 + 1, y - h * 0.5 + 1.2, w - 2, 1.8);
  }
  /** ▲ / ▼ badge for entities well above or below the viewer. */
  _heightBadge(g, x, y, dy) {
    if (dy > HEIGHT_CUE) {
      g.fillStyle = 'rgba(232,238,248,0.9)';
      g.beginPath();
      g.moveTo(x + 6, y - 4.5); g.lineTo(x + 10, y - 4.5); g.lineTo(x + 8, y - 8.5);
      g.closePath(); g.fill();
    } else if (dy < -HEIGHT_CUE) {
      g.fillStyle = 'rgba(150,160,175,0.9)';
      g.beginPath();
      g.moveTo(x + 6, y + 4.5); g.lineTo(x + 10, y + 4.5); g.lineTo(x + 8, y + 8.5);
      g.closePath(); g.fill();
    }
  }

  dispose() {
    if (typeof window !== 'undefined' && window.removeEventListener && this._onResize) {
      window.removeEventListener('resize', this._onResize);
    }
    if (this._ro) { try { this._ro.disconnect(); } catch (err) { /* already gone */ } this._ro = null; }
    if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    if (this.container && this.container.classList) this.container.classList.remove('radar-host');
    this._track.clear();
    this.canvas = null; this.ctx = null; this.img = null; this.map = null;
    this.spectate = null; this.container = null;
  }
}

// --- module helpers --------------------------------------------------------
/** Read a bombsite rectangle in any of the shapes maps use, into `out`. */
function readBox(a, out) {
  if (!a) return false;
  if (typeof a.x0 === 'number') {
    out[0] = a.x0; out[1] = a.z0; out[2] = a.x1; out[3] = a.z1;
  } else if (a.min && a.max) {
    out[0] = a.min.x !== undefined ? a.min.x : a.min[0];
    out[1] = a.min.z !== undefined ? a.min.z : a.min[1];
    out[2] = a.max.x !== undefined ? a.max.x : a.max[0];
    out[3] = a.max.z !== undefined ? a.max.z : a.max[1];
  } else if (Array.isArray(a) && a.length >= 4) {
    out[0] = a[0]; out[1] = a[1]; out[2] = a[2]; out[3] = a[3];
  } else return false;
  if (out[2] < out[0]) { const t = out[0]; out[0] = out[2]; out[2] = t; }
  if (out[3] < out[1]) { const t = out[1]; out[1] = out[3]; out[3] = t; }
  return isFinite(out[0]) && isFinite(out[1]) && isFinite(out[2]) && isFinite(out[3]);
}

/** Enemy visibility: `spotted` flag, or a spottedBy list containing our team. */
function enemyVisible(a, myTeam) {
  if (!a) return false;
  if (a.spotted === true) return true;
  const sb = a.spottedBy;
  if (Array.isArray(sb)) {
    for (let i = 0; i < sb.length; i++) {
      const s = sb[i];
      if (s == null) continue;
      if (typeof s === 'object') { if (teamOf(s) === myTeam) return true; }
      else return true;                      // plain ids: the list is ours
    }
    return false;
  }
  if (sb && typeof sb.size === 'number') return sb.size > 0;
  if (Array.isArray(a.spottedTeams)) return a.spottedTeams.indexOf(myTeam) >= 0;
  if (typeof a.spottedByTeam === 'string') return a.spottedByTeam === myTeam;
  return false;
}

export default Radar;

