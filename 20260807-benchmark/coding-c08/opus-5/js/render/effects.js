// ============================================================================
// render/effects.js — particles, decals, tracers, casings and camera shake.
//
// Everything is instanced and pooled: three GPU programs (billboard sprite,
// oriented quad, view-aligned beam) draw every effect in the game from a
// handful of draw calls, fed by struct-of-arrays typed-array stores so the
// per-frame cost is a few buffer writes and zero allocations.
//
// All artwork is generated procedurally into two canvas atlases (4x4 cells).
// When `document` is missing (Node tests) a 2x2 DataTexture stands in, so the
// whole module can be exercised headlessly.
// ============================================================================

import * as THREE from 'three';
import { SURFACE } from '../core/constants.js';
import {
  TAU, clamp, clamp01, lerp, smoothstep, easeOut, rand, randInt, chance, pick, makeRng, Pool,
} from '../core/util.js';

// --- sprite atlas cells (4x4) ---------------------------------------------
const C_SMOKE_A = 0, C_SMOKE_B = 1, C_SMOKE_C = 2, C_SMOKE_D = 3;
const C_FLASH_A = 4;               // cells 4,5 = the two muzzle-flash frames
const C_GLOW = 6, C_STREAK = 7, C_FIREBALL = 8, C_FLAME = 9, C_RING = 10;
const C_BLOOD = 11, C_CHUNK = 12, C_SPLINTER = 13, C_SHARD = 14, C_EMBER = 15;
const SMOKE_CELLS = [C_SMOKE_A, C_SMOKE_B, C_SMOKE_C, C_SMOKE_D];

// --- decal atlas cells (4x4) ----------------------------------------------
const D_BULLET = [0, 1, 2];
const D_BLOOD = [3, 4, 5];
const D_SCORCH = [6, 9];
const D_BURN = [7];

// --- particle behaviour flags --------------------------------------------
const F_COLLIDE = 1;       // trace against the world and bounce
const F_STICK = 2;         // die on the first surface hit
const F_ALIGN_VEL = 4;     // rotate the sprite along screen-space velocity
const F_EASE_SIZE = 8;     // grow fast then settle (puffs, fireballs)
const F_BLOOD_DECAL = 16;  // leave a small blood decal where it lands
const F_TURB = 32;         // noise wander (drifting smoke, embers)

const L_ADD = 0, L_ALPHA = 1;   // which sprite layer a particle draws into

// Authored in sRGB; converted to the renderer working space on construction.
const PAL = {
  dustWarm: 0xbfb49b, dustPale: 0xd9d0bb, dustDark: 0x8a8070,
  smokeLit: 0xa9abb2, smokeMid: 0x75777e, smokeDark: 0x3f424a, smokeBlack: 0x191a1c,
  flashCore: 0xfff7e2, flashWarm: 0xffb35e,
  sparkHot: 0xfff2b0, sparkMid: 0xffa42c, sparkCold: 0xff5a12,
  fireCore: 0xffe49a, fireMid: 0xff9426, fireDeep: 0xcf4207,
  blood: 0x6e1111, bloodDark: 0x380707, bloodMist: 0x9c1c17,
  wood: 0xa8834e, woodDust: 0xcbb794, dirt: 0x5b4733, dirtDark: 0x33281c,
  glass: 0xdff0ff, concrete: 0xb5aea1, sand: 0xd3c29c, white: 0xffffff,
  metalGlow: 0xffb055,
};
// ============================================================================
// Procedural artwork
// ============================================================================

/** True when a 2D canvas can be created (browser); false under bare Node. */
function canCanvas() {
  if (typeof document === 'undefined' || !document.createElement) return false;
  try {
    const c = document.createElement('canvas');
    return !!(c && c.getContext && c.getContext('2d'));
  } catch (e) { return false; }
}

/** 2x2 white stand-in used when no canvas exists, so Node can import/run. */
function fallbackTexture() {
  const d = new Uint8Array(16);
  for (let i = 0; i < 16; i++) d[i] = 255;
  const t = new THREE.DataTexture(d, 2, 2, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
}

/**
 * Paint `painters` into a cols x cols atlas of `cell`-sized tiles.
 * Every painter draws inside one tile (origin 0,0, size `cell`) and must keep
 * its artwork inside radius 0.47*cell so mip levels never bleed across cells.
 */
function buildAtlasCanvas(cols, cell, painters) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = cols * cell;
  const ctx = cv.getContext('2d');
  const scratch = document.createElement('canvas');
  scratch.width = scratch.height = cell;
  const sctx = scratch.getContext('2d');
  for (let i = 0; i < painters.length; i++) {
    if (!painters[i]) continue;
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.globalCompositeOperation = 'source-over';
    sctx.globalAlpha = 1;
    sctx.clearRect(0, 0, cell, cell);
    painters[i](sctx, cell, makeRng(9173 + i * 977));
    ctx.drawImage(scratch, (i % cols) * cell, Math.floor(i / cols) * cell);
  }
  return cv;
}

/** Soft radial alpha mask applied to the whole tile (keeps rims transparent). */
function maskSoft(ctx, S, inner = 0.6, mid = 0.86) {
  const h = S / 2, R = h * 0.96;
  ctx.globalCompositeOperation = 'destination-in';
  const g = ctx.createRadialGradient(h, h, 0, h, h, R);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(inner, 'rgba(255,255,255,0.97)');
  g.addColorStop(mid, 'rgba(255,255,255,0.42)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = 'source-over';
}
/** One soft round dab of `col` at (x,y). */
function dab(ctx, x, y, r, col, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${col},${a})`);
  g.addColorStop(0.55, `rgba(${col},${a * 0.55})`);
  g.addColorStop(1, `rgba(${col},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

/** Soft-edged smoke/dust puff, white so it can be tinted; 4 noise variants. */
function paintPuff(variant) {
  return (ctx, S, rng) => {
    const h = S / 2, R = h * 0.94;
    const g = ctx.createRadialGradient(h, h, 0, h, h, R);
    g.addColorStop(0, 'rgba(255,255,255,0.96)');
    g.addColorStop(0.42, 'rgba(255,255,255,0.78)');
    g.addColorStop(0.74, 'rgba(255,255,255,0.34)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    // billowing lumps
    const lumps = 13 + variant * 5;
    for (let i = 0; i < lumps; i++) {
      const a = rng() * TAU, d = Math.pow(rng(), 0.55) * R * 0.6;
      dab(ctx, h + Math.cos(a) * d, h + Math.sin(a) * d,
        R * (0.13 + rng() * 0.3), '255,255,255', 0.09 + rng() * 0.15);
    }
    // torn holes so no two puffs read the same
    ctx.globalCompositeOperation = 'destination-out';
    const holes = 7 + variant * 3;
    for (let i = 0; i < holes; i++) {
      const a = rng() * TAU, d = Math.pow(rng(), 0.4) * R * 0.72;
      dab(ctx, h + Math.cos(a) * d, h + Math.sin(a) * d,
        R * (0.1 + rng() * 0.26), '0,0,0', 0.1 + rng() * 0.22);
    }
    ctx.globalCompositeOperation = 'source-over';
    maskSoft(ctx, S, 0.58 + variant * 0.03, 0.85);
  };
}

/** Pure soft glow — cores, flash pops, heat haze, blood mist. */
function paintGlow(ctx, S) {
  const h = S / 2, R = h * 0.95;
  const g = ctx.createRadialGradient(h, h, 0, h, h, R);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.78)');
  g.addColorStop(0.42, 'rgba(255,255,255,0.34)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
}
/** Muzzle-flash star burst; frame 0 = long thin spikes, frame 1 = fat bloom. */
function paintFlash(frame) {
  return (ctx, S, rng) => {
    const h = S / 2, R = h * 0.95;
    let g = ctx.createRadialGradient(h, h, 0, h, h, R * (frame ? 0.95 : 0.7));
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.13, 'rgba(255,247,216,0.9)');
    g.addColorStop(0.34, 'rgba(255,191,112,0.42)');
    g.addColorStop(0.66, 'rgba(255,141,60,0.13)');
    g.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    const n = frame ? 10 : 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rng() * 0.34;
      const len = R * (frame ? 0.5 + rng() * 0.32 : 0.74 + rng() * 0.22);
      const w = R * (frame ? 0.08 + rng() * 0.09 : 0.04 + rng() * 0.06);
      ctx.save();
      ctx.translate(h, h);
      ctx.rotate(a);
      const lg = ctx.createLinearGradient(0, 0, len, 0);
      lg.addColorStop(0, 'rgba(255,253,240,0.95)');
      lg.addColorStop(0.45, 'rgba(255,208,132,0.5)');
      lg.addColorStop(1, 'rgba(255,158,66,0)');
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.moveTo(0, -w);
      ctx.lineTo(len, 0);
      ctx.lineTo(0, w);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    dab(ctx, h, h, R * (frame ? 0.3 : 0.2), '255,255,255', 1);
    maskSoft(ctx, S, 0.8, 0.94);
  };
}

/** Comet-shaped spark streak; the hot head points along +X (screen right). */
function paintStreak(ctx, S) {
  const h = S / 2, len = h * 0.9, w = S * 0.05;
  ctx.save();
  ctx.translate(h, h);
  ctx.scale(1, w / len);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, len);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, len, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.globalCompositeOperation = 'destination-in';
  const lg = ctx.createLinearGradient(h - len, 0, h + len, 0);
  lg.addColorStop(0, 'rgba(255,255,255,0)');
  lg.addColorStop(0.5, 'rgba(255,255,255,0.3)');
  lg.addColorStop(0.86, 'rgba(255,255,255,1)');
  lg.addColorStop(1, 'rgba(255,255,255,0.85)');
  ctx.fillStyle = lg;
  ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = 'source-over';
  dab(ctx, h + len * 0.62, h, S * 0.1, '255,255,255', 0.95);
}
/** Turbulent fireball — baked warm ramp, tinted brighter/darker per particle. */
function paintFireball(ctx, S, rng) {
  const h = S / 2, R = h * 0.94;
  const g = ctx.createRadialGradient(h, h, 0, h, h, R);
  g.addColorStop(0, 'rgba(255,252,232,0.98)');
  g.addColorStop(0.22, 'rgba(255,214,126,0.92)');
  g.addColorStop(0.48, 'rgba(255,138,42,0.74)');
  g.addColorStop(0.74, 'rgba(190,58,12,0.4)');
  g.addColorStop(1, 'rgba(90,26,8,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 20; i++) {
    const a = rng() * TAU, d = Math.pow(rng(), 0.5) * R * 0.66;
    const bright = rng() < 0.45;
    dab(ctx, h + Math.cos(a) * d, h + Math.sin(a) * d, R * (0.12 + rng() * 0.26),
      bright ? '255,236,178' : '146,48,12', 0.1 + rng() * 0.24);
  }
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 9; i++) {
    const a = rng() * TAU, d = Math.pow(rng(), 0.4) * R * 0.8;
    dab(ctx, h + Math.cos(a) * d, h + Math.sin(a) * d, R * (0.1 + rng() * 0.2), '0,0,0', 0.14 + rng() * 0.2);
  }
  ctx.globalCompositeOperation = 'source-over';
  maskSoft(ctx, S, 0.62, 0.88);
}

/** Upward flame tongue: hot white base, orange body, transparent wavy tip. */
function paintFlame(ctx, S, rng) {
  const h = S / 2, baseY = S * 0.93, tipY = S * 0.06;
  for (let pass = 0; pass < 4; pass++) {
    const k = 1 - pass * 0.2;              // nested copies soften the rim
    const w = S * 0.2 * k;
    const g = ctx.createLinearGradient(0, baseY, 0, tipY);
    const a = 0.3 + pass * 0.2;
    g.addColorStop(0, `rgba(255,250,226,${a})`);
    g.addColorStop(0.22, `rgba(255,206,110,${a})`);
    g.addColorStop(0.55, `rgba(255,132,36,${a * 0.8})`);
    g.addColorStop(0.85, `rgba(196,54,10,${a * 0.3})`);
    g.addColorStop(1, 'rgba(120,28,6,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(h - w, baseY);
    const wob = (rng() - 0.5) * S * 0.06;
    ctx.bezierCurveTo(h - w * 1.5, baseY - (baseY - tipY) * 0.45,
      h - w * 0.35 + wob, tipY + (baseY - tipY) * 0.28, h + wob * 0.4, tipY + pass * S * 0.02);
    ctx.bezierCurveTo(h + w * 0.4 + wob, tipY + (baseY - tipY) * 0.3,
      h + w * 1.5, baseY - (baseY - tipY) * 0.45, h + w, baseY);
    ctx.closePath();
    ctx.fill();
  }
  dab(ctx, h, baseY - S * 0.06, S * 0.16, '255,244,206', 0.8);
}
/** Expanding shockwave ring (hollow, bright rim, dusty inner haze). */
function paintRing(ctx, S, rng) {
  const h = S / 2, R = h * 0.95;
  const g = ctx.createRadialGradient(h, h, 0, h, h, R);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.04)');
  g.addColorStop(0.72, 'rgba(255,255,255,0.3)');
  g.addColorStop(0.86, 'rgba(255,255,255,0.92)');
  g.addColorStop(0.94, 'rgba(255,255,255,0.3)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 26; i++) {
    const a = rng() * TAU, d = R * (0.78 + rng() * 0.14);
    dab(ctx, h + Math.cos(a) * d, h + Math.sin(a) * d, R * (0.03 + rng() * 0.07),
      '255,255,255', 0.1 + rng() * 0.2);
  }
}

/** Blood droplet / mist blob: ragged core with a couple of tendrils. */
function paintBloodBlob(ctx, S, rng) {
  const h = S / 2, R = h * 0.9;
  dab(ctx, h, h, R * 0.62, '255,255,255', 0.95);
  for (let i = 0; i < 9; i++) {
    const a = rng() * TAU, d = R * (0.2 + rng() * 0.5);
    dab(ctx, h + Math.cos(a) * d, h + Math.sin(a) * d, R * (0.1 + rng() * 0.22), '255,255,255', 0.5 + rng() * 0.4);
  }
  for (let i = 0; i < 3; i++) {
    const a = rng() * TAU, d = R * 0.8;
    dab(ctx, h + Math.cos(a) * d, h + Math.sin(a) * d, R * 0.07, '255,255,255', 0.7);
  }
  maskSoft(ctx, S, 0.72, 0.95);
}

/** Irregular debris chunk (rock/clod) — near-opaque, tinted per surface. */
function paintChunk(ctx, S, rng) {
  const h = S / 2, R = h * 0.44;
  ctx.beginPath();
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rng() * 0.3;
    const r = R * (0.66 + rng() * 0.5);
    const x = h + Math.cos(a) * r, y = h + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.98)';
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fill();
  dab(ctx, h - R * 0.25, h - R * 0.3, R * 0.5, '255,255,255', 0.35);
  dab(ctx, h, h, R * 1.7, '255,255,255', 0.1);
}
/** Thin sliver along +X — wood splinters. */
function paintSplinter(ctx, S, rng) {
  const h = S / 2, len = h * 0.86, w = S * 0.028;
  ctx.beginPath();
  ctx.moveTo(h - len, h + (rng() - 0.5) * w);
  ctx.lineTo(h - len * 0.2, h - w);
  ctx.lineTo(h + len, h + (rng() - 0.5) * w * 0.6);
  ctx.lineTo(h - len * 0.1, h + w);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillRect(h - len * 0.6, h - w * 0.35, len, w * 0.35);
}

/** Angular glass shard: bright edges, translucent middle. */
function paintShard(ctx, S, rng) {
  const h = S / 2, R = h * 0.8;
  ctx.beginPath();
  ctx.moveTo(h - R, h + R * 0.1 * rng());
  ctx.lineTo(h + R * 0.2, h - R * 0.24);
  ctx.lineTo(h + R, h + R * 0.06);
  ctx.lineTo(h - R * 0.1, h + R * 0.22);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fill();
  ctx.lineWidth = Math.max(1, S * 0.012);
  ctx.strokeStyle = 'rgba(255,255,255,0.98)';
  ctx.stroke();
  dab(ctx, h + R * 0.3, h, R * 0.3, '255,255,255', 0.5);
}

/** Tiny hot ember: sharp core, wide warm halo. */
function paintEmber(ctx, S) {
  const h = S / 2, R = h * 0.9;
  const g = ctx.createRadialGradient(h, h, 0, h, h, R);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.08, 'rgba(255,240,190,0.95)');
  g.addColorStop(0.2, 'rgba(255,168,60,0.42)');
  g.addColorStop(0.55, 'rgba(255,110,26,0.12)');
  g.addColorStop(1, 'rgba(200,70,10,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
}

const SPRITE_PAINTERS = [
  paintPuff(0), paintPuff(1), paintPuff(2), paintPuff(3),
  paintFlash(0), paintFlash(1), paintGlow, paintStreak,
  paintFireball, paintFlame, paintRing, paintBloodBlob,
  paintChunk, paintSplinter, paintShard, paintEmber,
];
/** Bullet hole: dust halo, dark crater ring, black hole, cracked rim. */
function paintBulletHole(variant) {
  return (ctx, S, rng) => {
    const h = S / 2, R = h * 0.46;
    // pale impact dust ring around the hole
    let g = ctx.createRadialGradient(h, h, R * 0.8, h, h, R * 2.05);
    g.addColorStop(0, 'rgba(226,220,206,0.42)');
    g.addColorStop(0.45, 'rgba(214,206,190,0.2)');
    g.addColorStop(1, 'rgba(200,192,176,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    // radial cracks / chipping
    const cracks = 7 + variant * 3;
    ctx.lineCap = 'round';
    for (let i = 0; i < cracks; i++) {
      const a = rng() * TAU, len = R * (0.9 + rng() * 1.5);
      ctx.strokeStyle = `rgba(24,20,17,${0.3 + rng() * 0.4})`;
      ctx.lineWidth = Math.max(1, S * (0.004 + rng() * 0.008));
      ctx.beginPath();
      ctx.moveTo(h + Math.cos(a) * R * 0.7, h + Math.sin(a) * R * 0.7);
      let x = h + Math.cos(a) * R * 0.7, y = h + Math.sin(a) * R * 0.7, aa = a;
      const steps = 3;
      for (let s = 0; s < steps; s++) {
        aa += (rng() - 0.5) * 0.9;
        x += Math.cos(aa) * (len / steps);
        y += Math.sin(aa) * (len / steps);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // crater + hole
    g = ctx.createRadialGradient(h, h, 0, h, h, R * 1.25);
    g.addColorStop(0, 'rgba(4,4,4,0.98)');
    g.addColorStop(0.4, 'rgba(14,12,11,0.94)');
    g.addColorStop(0.66, 'rgba(44,38,33,0.7)');
    g.addColorStop(0.85, 'rgba(78,70,60,0.32)');
    g.addColorStop(1, 'rgba(90,82,70,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(h, h, R * 1.25, 0, TAU);
    ctx.fill();
    // rim highlight, offset per variant so the three read differently
    const ox = Math.cos(variant * 2.1) * R * 0.16, oy = Math.sin(variant * 2.1) * R * 0.16;
    dab(ctx, h + ox, h + oy, R * 0.62, '196,188,172', 0.24);
    maskSoft(ctx, S, 0.66, 0.92);
  };
}
/** Blood splat: ragged core, satellite droplets, a few runs. White mask. */
function paintBloodSplat(variant) {
  return (ctx, S, rng) => {
    const h = S / 2, R = h * 0.9;
    const core = R * (0.3 + variant * 0.06);
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.beginPath();
    const n = 11;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const r = core * (0.7 + rng() * 0.75);
      const x = h + Math.cos(a) * r, y = h + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    // satellites + drips
    const drops = 16 + variant * 6;
    for (let i = 0; i < drops; i++) {
      const a = rng() * TAU, d = core + Math.pow(rng(), 0.7) * (R - core) * 0.95;
      const r = R * (0.02 + Math.pow(rng(), 2) * 0.1);
      ctx.fillStyle = `rgba(255,255,255,${0.55 + rng() * 0.4})`;
      ctx.beginPath();
      ctx.ellipse(h + Math.cos(a) * d, h + Math.sin(a) * d, r, r * (0.6 + rng() * 0.8), a, 0, TAU);
      ctx.fill();
    }
    for (let i = 0; i < 3 + variant; i++) {
      const a = rng() * TAU, len = R * (0.3 + rng() * 0.55);
      ctx.strokeStyle = `rgba(255,255,255,${0.4 + rng() * 0.4})`;
      ctx.lineWidth = Math.max(1, S * (0.008 + rng() * 0.014));
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(h + Math.cos(a) * core * 0.8, h + Math.sin(a) * core * 0.8);
      ctx.lineTo(h + Math.cos(a) * (core * 0.8 + len), h + Math.sin(a) * (core * 0.8 + len));
      ctx.stroke();
    }
    dab(ctx, h, h, R * 0.55, '255,255,255', 0.35);
    maskSoft(ctx, S, 0.8, 0.97);
  };
}
/** Soot patch. `charred` adds burnt-orange edges for molotov burn marks. */
function paintScorch(charred, seedShift = 0) {
  return (ctx, S, rng) => {
    const h = S / 2, R = h * 0.92;
    for (let i = 0; i < 2 + seedShift; i++) rng();
    const g = ctx.createRadialGradient(h, h, 0, h, h, R);
    g.addColorStop(0, 'rgba(10,9,8,0.92)');
    g.addColorStop(0.35, 'rgba(20,18,16,0.8)');
    g.addColorStop(0.62, charred ? 'rgba(48,32,18,0.55)' : 'rgba(38,35,32,0.48)');
    g.addColorStop(0.84, charred ? 'rgba(66,38,16,0.24)' : 'rgba(52,48,44,0.2)');
    g.addColorStop(1, 'rgba(40,36,32,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    // soot lobes and blast streaks
    for (let i = 0; i < 22; i++) {
      const a = rng() * TAU, d = Math.pow(rng(), 0.6) * R * 0.8;
      dab(ctx, h + Math.cos(a) * d, h + Math.sin(a) * d, R * (0.1 + rng() * 0.26),
        rng() < 0.25 ? '58,40,20' : '8,8,8', 0.1 + rng() * 0.3);
    }
    ctx.lineCap = 'round';
    for (let i = 0; i < 14; i++) {
      const a = rng() * TAU;
      ctx.strokeStyle = `rgba(12,11,10,${0.1 + rng() * 0.22})`;
      ctx.lineWidth = S * (0.01 + rng() * 0.03);
      ctx.beginPath();
      ctx.moveTo(h + Math.cos(a) * R * 0.25, h + Math.sin(a) * R * 0.25);
      ctx.lineTo(h + Math.cos(a) * R * (0.6 + rng() * 0.35), h + Math.sin(a) * R * (0.6 + rng() * 0.35));
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 10; i++) {
      const a = rng() * TAU, d = Math.pow(rng(), 0.4) * R * 0.85;
      dab(ctx, h + Math.cos(a) * d, h + Math.sin(a) * d, R * (0.08 + rng() * 0.2), '0,0,0', 0.12 + rng() * 0.25);
    }
    ctx.globalCompositeOperation = 'source-over';
    maskSoft(ctx, S, 0.6, 0.9);
  };
}

const DECAL_PAINTERS = [
  paintBulletHole(0), paintBulletHole(1), paintBulletHole(2),
  paintBloodSplat(0), paintBloodSplat(1), paintBloodSplat(2),
  paintScorch(false), paintScorch(true), paintBloodSplat(1), paintScorch(false, 3),
];
// ============================================================================
// GPU programs — one for billboards, one for oriented quads, one for beams.
// ============================================================================

const SPRITE_VERT = /* glsl */`
attribute vec3 iPos;
attribute vec4 iAttr;      // size, rotation, alpha, atlas cell
attribute vec3 iColor;
uniform vec2 uAtlas;       // (cols, 1/cols)
varying vec2 vUv;
varying vec3 vCol;
varying float vAlpha;
#include <fog_pars_vertex>
void main() {
  float c = cos(iAttr.y), s = sin(iAttr.y);
  vec2 q = position.xy * iAttr.x;
  vec2 r = vec2(q.x * c - q.y * s, q.x * s + q.y * c);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 world = iPos + right * r.x + up * r.y;
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float col = mod(iAttr.w, uAtlas.x);
  float row = floor(iAttr.w / uAtlas.x + 0.0001);
  vUv = (uv + vec2(col, uAtlas.x - 1.0 - row)) * uAtlas.y;
  vCol = iColor;
  vAlpha = iAttr.z;
  #include <fog_vertex>
}`;

const QUAD_VERT = /* glsl */`
attribute vec3 iPos;
attribute vec3 iRight;
attribute vec3 iUp;
attribute vec4 iAttr;      // width, height, alpha, atlas cell
attribute vec3 iColor;
uniform vec2 uAtlas;
varying vec2 vUv;
varying vec3 vCol;
varying float vAlpha;
#include <fog_pars_vertex>
void main() {
  vec3 world = iPos + iRight * (position.x * iAttr.x) + iUp * (position.y * iAttr.y);
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float col = mod(iAttr.w, uAtlas.x);
  float row = floor(iAttr.w / uAtlas.x + 0.0001);
  vUv = (uv + vec2(col, uAtlas.x - 1.0 - row)) * uAtlas.y;
  vCol = iColor;
  vAlpha = iAttr.z;
  #include <fog_vertex>
}`;
const ATLAS_FRAG = /* glsl */`
uniform sampler2D uMap;
varying vec2 vUv;
varying vec3 vCol;
varying float vAlpha;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(t.rgb * vCol, a);
  #include <fog_fragment>
}`;

const BEAM_VERT = /* glsl */`
attribute vec3 iA;
attribute vec3 iB;
attribute vec4 iAttr;      // width, alpha, taper, unused
attribute vec3 iColor;
varying float vAlong;
varying float vAcross;
varying vec3 vCol;
varying float vAlpha;
varying float vTaper;
void main() {
  vec3 p = mix(iA, iB, position.x);
  vec3 axis = iB - iA;
  float len = length(axis);
  axis = len > 1e-4 ? axis / len : vec3(0.0, 1.0, 0.0);
  vec3 toCam = normalize(cameraPosition - p);
  vec3 side = cross(axis, toCam);
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
  vec3 world = p + side * (position.y * iAttr.x);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  vAlong = position.x;
  vAcross = position.y * 2.0;
  vCol = iColor;
  vAlpha = iAttr.y;
  vTaper = iAttr.z;
}`;

const BEAM_FRAG = /* glsl */`
varying float vAlong;
varying float vAcross;
varying vec3 vCol;
varying float vAlpha;
varying float vTaper;
void main() {
  float across = clamp(1.0 - abs(vAcross), 0.0, 1.0);
  float a = pow(across, 1.7) * mix(vTaper, 1.0, pow(vAlong, 1.6)) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(mix(vCol, vec3(1.0), pow(across, 5.0) * 0.85), a);
}`;
// ============================================================================
// Instanced draw layers
// ============================================================================

/** Unit quad (x0..x1, y0..y1) prepared for instancing. */
function quadGeometry(x0, x1, y0, y1) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(
    [x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.instanceCount = 0;
  return g;
}

/** Shared bookkeeping for every instanced layer: write cursor + flush. */
class InstLayer {
  constructor(cap, material, quad, renderOrder, name) {
    this.cap = cap;
    this.n = 0;
    this.geo = quadGeometry(quad[0], quad[1], quad[2], quad[3]);
    this.mat = material;
    this.attrs = [];
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = renderOrder;
  }

  /** Declare an instanced attribute and return its backing Float32Array. */
  band(name, size) {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * size), size);
    a.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute(name, a);
    this.attrs.push(a);
    return a.array;
  }

  reset() { this.n = 0; }

  flush() {
    this.geo.instanceCount = this.n;
    for (let i = 0; i < this.attrs.length; i++) this.attrs[i].needsUpdate = true;
  }

  dispose() {
    this.geo.dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}
/** Camera-facing sprites (all particles, smoke puffs, flames). */
class SpriteLayer extends InstLayer {
  constructor(cap, material, renderOrder, name) {
    super(cap, material, [-0.5, 0.5, -0.5, 0.5], renderOrder, name);
    this.bPos = this.band('iPos', 3);
    this.bAttr = this.band('iAttr', 4);
    this.bCol = this.band('iColor', 3);
  }

  push(x, y, z, size, rot, alpha, cell, r, g, b) {
    if (this.n >= this.cap) return false;
    const i = this.n++, i3 = i * 3, i4 = i * 4;
    this.bPos[i3] = x; this.bPos[i3 + 1] = y; this.bPos[i3 + 2] = z;
    this.bAttr[i4] = size; this.bAttr[i4 + 1] = rot;
    this.bAttr[i4 + 2] = alpha; this.bAttr[i4 + 3] = cell;
    this.bCol[i3] = r; this.bCol[i3 + 1] = g; this.bCol[i3 + 2] = b;
    return true;
  }
}

/** Surface-oriented quads (decals, ground shockwave rings). */
class QuadLayer extends InstLayer {
  constructor(cap, material, renderOrder, name) {
    super(cap, material, [-0.5, 0.5, -0.5, 0.5], renderOrder, name);
    this.bPos = this.band('iPos', 3);
    this.bRight = this.band('iRight', 3);
    this.bUp = this.band('iUp', 3);
    this.bAttr = this.band('iAttr', 4);
    this.bCol = this.band('iColor', 3);
  }

  push(px, py, pz, rx, ry, rz, ux, uy, uz, w, h, alpha, cell, r, g, b) {
    if (this.n >= this.cap) return false;
    const i = this.n++, i3 = i * 3, i4 = i * 4;
    this.bPos[i3] = px; this.bPos[i3 + 1] = py; this.bPos[i3 + 2] = pz;
    this.bRight[i3] = rx; this.bRight[i3 + 1] = ry; this.bRight[i3 + 2] = rz;
    this.bUp[i3] = ux; this.bUp[i3 + 1] = uy; this.bUp[i3 + 2] = uz;
    this.bAttr[i4] = w; this.bAttr[i4 + 1] = h;
    this.bAttr[i4 + 2] = alpha; this.bAttr[i4 + 3] = cell;
    this.bCol[i3] = r; this.bCol[i3 + 1] = g; this.bCol[i3 + 2] = b;
    return true;
  }
}
/** View-aligned beams (bullet tracers). */
class BeamLayer extends InstLayer {
  constructor(cap, material, renderOrder, name) {
    super(cap, material, [0, 1, -0.5, 0.5], renderOrder, name);
    this.bA = this.band('iA', 3);
    this.bB = this.band('iB', 3);
    this.bAttr = this.band('iAttr', 4);
    this.bCol = this.band('iColor', 3);
  }

  push(ax, ay, az, bx, by, bz, width, alpha, taper, r, g, b) {
    if (this.n >= this.cap) return false;
    const i = this.n++, i3 = i * 3, i4 = i * 4;
    this.bA[i3] = ax; this.bA[i3 + 1] = ay; this.bA[i3 + 2] = az;
    this.bB[i3] = bx; this.bB[i3 + 1] = by; this.bB[i3 + 2] = bz;
    this.bAttr[i4] = width; this.bAttr[i4 + 1] = alpha; this.bAttr[i4 + 2] = taper;
    this.bCol[i3] = r; this.bCol[i3 + 1] = g; this.bCol[i3 + 2] = b;
    return true;
  }
}

// ============================================================================
// Handles returned by smoke() / fire()
// ============================================================================

class FxHandle {
  constructor(owner, kind) {
    this._owner = owner;
    this.kind = kind;
    this.pos = new THREE.Vector3();
    this.radius = 1;
    this.life = 1;
    this.t = 0;
    this.alive = false;
    this.slot = -1;
  }

  get progress() { return this.life > 0 ? clamp01(this.t / this.life) : 1; }

  /** Start the quick dissipate; the cloud/fire is gone within ~1s. */
  kill() {
    if (this.alive) this._owner._killHandle(this, false);
    return this;
  }
}
// ============================================================================
// Effects — the public FX service.
// ============================================================================

export class Effects {
  /**
   * @param {THREE.Scene} scene
   * @param {{decals:number,particles:number,smokePuffs:number,anisotropy:number}} quality
   *        one QUALITY[...] entry from core/constants.js
   */
  constructor(scene, quality) {
    this.scene = scene;
    this.q = Object.assign(
      { decals: 90, particles: 1, smokePuffs: 60, anisotropy: 4, shadowMap: 1024 },
      quality || {});
    const pScale = clamp(this.q.particles || 1, 0.25, 2);
    this.pScale = pScale;

    // --- budgets ---
    this.budget = Math.max(180, Math.round(700 * pScale));            // live particles
    this.decalBudget = Math.max(16, Math.round(this.q.decals || 90));
    this.cloudMax = pScale <= 0.5 ? 2 : 3;
    this.puffBudget = Math.max(12, Math.round(this.q.smokePuffs || 60)) * this.cloudMax;
    this.fireMax = pScale <= 0.5 ? 2 : 3;
    this.tonguesPerFire = Math.round(clamp(16 * pScale, 7, 20));
    this.flameBudget = this.tonguesPerFire * this.fireMax + this.fireMax; // +1 haze each
    this.tracerMax = Math.round(clamp(48 * pScale, 16, 64));
    this.casingMax = Math.round(clamp(24 * pScale, 10, 28));
    this.ringMax = 10;

    // Integrator-facing tunable: scales every pooled PointLight intensity.
    this.lightScale = 1;
    this.time = 0;
    this.world = null;
    this._traceFails = 0;
    this._traceOpts = {};
    this._recentShots = 0;

    // --- palette in the renderer working colour space ---
    this.col = {};
    const cc = new THREE.Color();
    for (const k in PAL) {
      cc.setHex(PAL[k]);
      this.col[k] = new Float32Array([cc.r, cc.g, cc.b]);
    }
    this._tmpCol = new Float32Array(3);
    this._colA = new Float32Array(3);
    this._colB = new Float32Array(3);
    // --- scratch objects (never allocate inside update) ---
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._sv1 = new THREE.Vector3();
    this._sv2 = new THREE.Vector3();
    this._tv1 = new THREE.Vector3();
    this._tv2 = new THREE.Vector3();
    this._nrm = new THREE.Vector3();
    this._tan1 = new THREE.Vector3();
    this._tan2 = new THREE.Vector3();
    this._camR = new THREE.Vector3(1, 0, 0);
    this._camU = new THREE.Vector3(0, 1, 0);
    this._camP = new THREE.Vector3();
    this._q1 = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._q3 = new THREE.Quaternion();
    this._m4 = new THREE.Matrix4();
    this._tr = {
      hit: false, px: 0, py: 0, pz: 0, nx: 0, ny: 1, nz: 0, dist: 0, surface: SURFACE.CONCRETE,
    };
    this._shake = { pitch: 0, yaw: 0, roll: 0 };
    this._now = 0;
    this._sk = { amp: 0, dec: 8, ph: 0 };

    // --- container groups ---
    this.root = new THREE.Group();
    this.root.name = 'fx';
    this.root.matrixAutoUpdate = false;
    this.gDecals = new THREE.Group();
    this.gDecals.name = 'fx_decals';
    this.gDecals.matrixAutoUpdate = false;
    this.gParticles = new THREE.Group();
    this.gParticles.name = 'fx_particles';
    this.gParticles.matrixAutoUpdate = false;
    this.gSmoke = new THREE.Group();
    this.gSmoke.name = 'fx_smoke';
    this.gSmoke.matrixAutoUpdate = false;
    this.gLights = new THREE.Group();
    this.gLights.name = 'fx_lights';
    this.gLights.matrixAutoUpdate = false;
    this.root.add(this.gDecals, this.gParticles, this.gSmoke, this.gLights);
    if (scene && scene.add) scene.add(this.root);

    this._buildTextures();
    this._buildMaterials();
    this._buildLayers();
    this._buildStores();
    this._buildLights();
    this._buildCasings();
  }
  // --------------------------------------------------------------------
  // construction helpers
  // --------------------------------------------------------------------

  _atlas(painters, cell, aniso) {
    if (!canCanvas()) return fallbackTexture();
    const tex = new THREE.CanvasTexture(buildAtlasCanvas(4, cell, painters));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = aniso;
    tex.needsUpdate = true;
    return tex;
  }

  _buildTextures() {
    const cell = this.pScale <= 0.5 ? 128 : 256;
    this.spriteTex = this._atlas(SPRITE_PAINTERS, cell, 1);
    this.decalTex = this._atlas(DECAL_PAINTERS, cell, Math.max(1, this.q.anisotropy || 1));
  }

  /** One ShaderMaterial per (atlas, blend mode) pair — five programs total. */
  _atlasMat(vert, tex, additive, fog) {
    const uniforms = Object.assign(
      THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      { uMap: { value: tex }, uAtlas: { value: new THREE.Vector2(4, 0.25) } });
    return new THREE.ShaderMaterial({
      uniforms,
      vertexShader: vert,
      fragmentShader: ATLAS_FRAG,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
      fog: !!fog,
    });
  }

  _buildMaterials() {
    this.mAdd = this._atlasMat(SPRITE_VERT, this.spriteTex, true, false);
    this.mAlpha = this._atlasMat(SPRITE_VERT, this.spriteTex, false, true);
    this.mSmoke = this._atlasMat(SPRITE_VERT, this.spriteTex, false, true);
    this.mRing = this._atlasMat(QUAD_VERT, this.spriteTex, true, false);
    this.mDecal = this._atlasMat(QUAD_VERT, this.decalTex, false, true);
    this.mDecal.polygonOffset = true;
    this.mDecal.polygonOffsetFactor = -4;
    this.mDecal.polygonOffsetUnits = -4;
    this.mBeam = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
  }
  _buildLayers() {
    this.lDecal = new QuadLayer(this.decalBudget, this.mDecal, 1, 'fx_decal_layer');
    this.lAlpha = new SpriteLayer(this.budget, this.mAlpha, 5, 'fx_alpha_layer');
    this.lSmoke = new SpriteLayer(this.puffBudget, this.mSmoke, 6, 'fx_smoke_layer');
    this.lRing = new QuadLayer(this.ringMax, this.mRing, 7, 'fx_ring_layer');
    this.lAdd = new SpriteLayer(this.budget, this.mAdd, 8, 'fx_add_layer');
    this.lFlame = new SpriteLayer(this.flameBudget, this.mAdd, 9, 'fx_flame_layer');
    this.lBeam = new BeamLayer(this.tracerMax, this.mBeam, 10, 'fx_beam_layer');
    this.gDecals.add(this.lDecal.mesh);
    this.gSmoke.add(this.lSmoke.mesh);
    this.gParticles.add(this.lAlpha.mesh, this.lRing.mesh, this.lAdd.mesh,
      this.lFlame.mesh, this.lBeam.mesh);
    this._layers = [this.lDecal, this.lAlpha, this.lSmoke, this.lRing, this.lAdd,
      this.lFlame, this.lBeam];
  }

  _buildStores() {
    const cap = this.budget;
    const F = (n) => new Float32Array(cap * n);
    // Particles: struct-of-arrays, free-list + swap-remove live list.
    this.p = {
      x: F(1), y: F(1), z: F(1), vx: F(1), vy: F(1), vz: F(1),
      life: F(1), max: F(1), s0: F(1), s1: F(1), rot: F(1), rv: F(1),
      c0: F(3), c1: F(3), a: F(1), fadeK: F(1), fin: F(1),
      grav: F(1), drag: F(1), turb: F(1), seed: F(1), bounce: F(1),
      cell: F(1), frames: new Uint8Array(cap), layer: new Uint8Array(cap),
      flags: new Uint8Array(cap),
    };
    this._pFree = new Int32Array(cap);
    this._pSlot = new Int32Array(cap);
    this._pLive = new Int32Array(cap);
    this._pFreeN = cap;
    this._pLiveN = 0;
    for (let i = 0; i < cap; i++) { this._pFree[i] = cap - 1 - i; this._pSlot[i] = -1; }
    // Reusable spawn descriptor (filled then emitted; never allocated).
    this._sp = {
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, s0: 0.2, s1: 0.3,
      rot: 0, rv: 0, a: 1, fadeK: 1.4, fin: 0.06, grav: 0, drag: 0, turb: 0,
      bounce: 0.32, cell: C_GLOW, frames: 1, layer: L_ALPHA, flags: 0,
      c0: null, c1: null, mul: 1,
    };
    this._buildDecalStore();
    this._buildSmokeStore();
    this._buildFireStore();
    this._buildTracerStore();
    this._buildRingStore();
  }
  _buildDecalStore() {
    const cap = this.decalBudget;
    const F = (n) => new Float32Array(cap * n);
    this.dc = {
      x: F(1), y: F(1), z: F(1), rx: F(1), ry: F(1), rz: F(1),
      ux: F(1), uy: F(1), uz: F(1), w: F(1), h: F(1),
      life: F(1), fade: F(1), a: F(1), cell: F(1), col: F(3), birth: F(1),
    };
    this._dFree = new Int32Array(cap);
    this._dSlot = new Int32Array(cap);
    this._dLive = new Int32Array(cap);
    this._dFreeN = cap;
    this._dLiveN = 0;
    for (let i = 0; i < cap; i++) { this._dFree[i] = cap - 1 - i; this._dSlot[i] = -1; }
  }

  _buildSmokeStore() {
    const cap = this.puffBudget;
    const F = (n) => new Float32Array(cap * n);
    this.pf = {
      ox: F(1), oy: F(1), oz: F(1), sz: F(1), ph: F(1), sp: F(1),
      rot: F(1), rv: F(1), cell: F(1), stag: F(1), vf: F(1), a: F(1),
      x: F(1), y: F(1), z: F(1), depth: F(1), ci: new Int8Array(cap),
    };
    this._fFree = new Int32Array(cap);
    this._fSlot = new Int32Array(cap);
    this._fLive = new Int32Array(cap);
    this._fFreeN = cap;
    this._fLiveN = 0;
    for (let i = 0; i < cap; i++) { this._fFree[i] = cap - 1 - i; this._fSlot[i] = -1; }
    this._clouds = new Array(this.cloudMax).fill(null);
    this._cloudPool = new Pool(() => new FxHandle(this, 'smoke'), null, this.cloudMax);
  }

  _buildFireStore() {
    const cap = this.flameBudget;
    const F = (n) => new Float32Array(cap * n);
    this.fl = {
      ox: F(1), oz: F(1), ph: F(1), sp: F(1), hgt: F(1), wid: F(1),
      rotb: F(1), kind: F(1), fi: new Int8Array(cap),
    };
    this._lFree = new Int32Array(cap);
    this._lSlot = new Int32Array(cap);
    this._lLive = new Int32Array(cap);
    this._lFreeN = cap;
    this._lLiveN = 0;
    for (let i = 0; i < cap; i++) { this._lFree[i] = cap - 1 - i; this._lSlot[i] = -1; }
    this._fires = new Array(this.fireMax).fill(null);
    this._firePool = new Pool(() => new FxHandle(this, 'fire'), null, this.fireMax);
  }
  _buildTracerStore() {
    const cap = this.tracerMax;
    const F = (n) => new Float32Array(cap * n);
    this.tc = {
      x: F(1), y: F(1), z: F(1), dx: F(1), dy: F(1), dz: F(1),
      total: F(1), travel: F(1), speed: F(1), trail: F(1), width: F(1),
      life: F(1), max: F(1), col: F(3), live: new Uint8Array(cap),
    };
    this._tcN = 0;   // number of slots in use (compacted each frame)
  }

  _buildRingStore() {
    const cap = this.ringMax;
    const F = (n) => new Float32Array(cap * n);
    this.rg = {
      x: F(1), y: F(1), z: F(1), r0: F(1), r1: F(1), rot: F(1),
      life: F(1), max: F(1), a: F(1), col: F(3), live: new Uint8Array(cap),
    };
  }

  _buildLights() {
    const n = this.pScale <= 0.5 ? 2 : (this.pScale < 1.2 ? 3 : 4);
    const make = () => {
      const l = new THREE.PointLight(0xffffff, 0, 8, 2);
      l.castShadow = false;
      l.visible = true;               // stays visible: keeps the light count
      l.intensity = 0;                // stable so materials never recompile
      l._fx = { life: 0, max: 1, i0: 0, kind: '' };
      this.gLights.add(l);
      return l;
    };
    this._lightPool = new Pool(make, (l) => { l.intensity = 0; l._fx.kind = ''; }, n);
    this._fireLights = [];
    for (let i = 0; i < this.fireMax; i++) {
      const l = new THREE.PointLight(0xff8a30, 0, 9, 2);
      l.castShadow = false;
      l.intensity = 0;
      l._fx = { life: 0, max: 1, i0: 0, kind: 'fire' };
      this.gLights.add(l);
      this._fireLights.push(l);
    }
  }

  _buildCasings() {
    const cap = this.casingMax;
    const geo = new THREE.CylinderGeometry(0.0054, 0.0049, 0.0235, 7, 1, false);
    geo.rotateZ(Math.PI * 0.5);            // long axis along +X
    this.casingGeo = geo;
    this.casingMat = new THREE.MeshStandardMaterial({
      color: 0xd9a638, metalness: 0.42, roughness: 0.38,
      emissive: 0x241703, emissiveIntensity: 1,
    });
    this.casingMesh = new THREE.InstancedMesh(geo, this.casingMat, cap);
    this.casingMesh.name = 'fx_casings';
    this.casingMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.casingMesh.frustumCulled = false;
    this.casingMesh.castShadow = false;
    this.casingMesh.receiveShadow = false;
    this.gParticles.add(this.casingMesh);
    const F = (n) => new Float32Array(cap * n);
    this.cs = {
      x: F(1), y: F(1), z: F(1), vx: F(1), vy: F(1), vz: F(1),
      wx: F(1), wy: F(1), wz: F(1), quat: F(4),
      life: F(1), rest: F(1), bounces: new Uint8Array(cap), live: new Uint8Array(cap),
    };
    this._csDirty = true;
    for (let i = 0; i < cap; i++) this._csHide(i);
  }

  /** Collapse a casing instance to zero scale (invisible without a draw hole). */
  _csHide(i) {
    this._m4.makeScale(0, 0, 0);
    this.casingMesh.setMatrixAt(i, this._m4);
    this._csDirty = true;
  }

  // --------------------------------------------------------------------
  // world hookup + tracing
  // --------------------------------------------------------------------

  /** Optional: give debris, casings and blood real geometry to bounce off. */
  setWorld(world) {
    this.world = world || null;
    this._traceFails = 0;
    return this;
  }

  /**
   * Ray cast helper. Uses world.trace when available, otherwise the y=0 plane.
   * @returns {object|null} shared trace record — copy what you need immediately.
   */
  _trace(ox, oy, oz, dx, dy, dz, dist) {
    const tr = this._tr;
    const w = this.world;
    if (w && typeof w.trace === 'function' && this._traceFails < 4) {
      try {
        const r = w.trace(this._tv1.set(ox, oy, oz), this._tv2.set(dx, dy, dz), dist, this._traceOpts);
        if (r && r.hit && r.point && r.normal) {
          tr.hit = true;
          tr.px = r.point.x; tr.py = r.point.y; tr.pz = r.point.z;
          tr.nx = r.normal.x; tr.ny = r.normal.y; tr.nz = r.normal.z;
          tr.dist = r.dist || 0;
          tr.surface = r.surface || SURFACE.CONCRETE;
          return tr;
        }
        return null;
      } catch (e) { this._traceFails++; }
    }
    if (dy < 0 && oy > 0) {                 // fallback: flat ground at y = 0
      const t = -oy / dy;
      if (t >= 0 && t <= dist) {
        tr.hit = true;
        tr.px = ox + dx * t; tr.py = 0; tr.pz = oz + dz * t;
        tr.nx = 0; tr.ny = 1; tr.nz = 0;
        tr.dist = t;
        tr.surface = SURFACE.CONCRETE;
        return tr;
      }
    }
    return null;
  }

  /** Orthonormal basis around a unit direction; results in _tan1 / _tan2. */
  _basis(dx, dy, dz) {
    const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
    let ux = 0, uy = 0, uz = 0;
    if (ax <= ay && ax <= az) ux = 1; else if (ay <= az) uy = 1; else uz = 1;
    const t1 = this._tan1.set(uy * dz - uz * dy, uz * dx - ux * dz, ux * dy - uy * dx);
    if (t1.lengthSq() < 1e-8) t1.set(1, 0, 0); else t1.normalize();
    this._tan2.set(dy * t1.z - dz * t1.y, dz * t1.x - dx * t1.z, dx * t1.y - dy * t1.x).normalize();
  }

  /** Random unit vector inside a cone of half-angle `spread` (radians). */
  _cone(dx, dy, dz, spread, out) {
    this._basis(dx, dy, dz);
    const a = Math.acos(1 - Math.random() * (1 - Math.cos(spread)));
    const phi = Math.random() * TAU;
    const sa = Math.sin(a), ca = Math.cos(a);
    const t1 = this._tan1, t2 = this._tan2;
    out.set(
      dx * ca + (t1.x * Math.cos(phi) + t2.x * Math.sin(phi)) * sa,
      dy * ca + (t1.y * Math.cos(phi) + t2.y * Math.sin(phi)) * sa,
      dz * ca + (t1.z * Math.cos(phi) + t2.z * Math.sin(phi)) * sa);
    return out;
  }

  /** Safe normalize of a caller-supplied direction into _v3 (never mutates it). */
  _dirOf(dir, fx, fy, fz) {
    const v = this._v3;
    if (dir && (dir.x || dir.y || dir.z)) {
      v.set(dir.x, dir.y, dir.z);
      const l = v.length();
      if (l > 1e-6) { v.multiplyScalar(1 / l); return v; }
    }
    return v.set(fx, fy, fz);
  }
  // --------------------------------------------------------------------
  // particle store
  // --------------------------------------------------------------------

  _alloc() {
    if (this._pFreeN > 0) {
      const i = this._pFree[--this._pFreeN];
      this._pSlot[i] = this._pLiveN;
      this._pLive[this._pLiveN++] = i;
      return i;
    }
    if (this._pLiveN === 0) return -1;
    // Saturated: recycle whichever of 8 random live particles is closest to death.
    let best = -1, bl = Infinity;
    for (let k = 0; k < 8; k++) {
      const j = this._pLive[(Math.random() * this._pLiveN) | 0];
      if (this.p.life[j] < bl) { bl = this.p.life[j]; best = j; }
    }
    return best;
  }

  _freeParticle(i) {
    const s = this._pSlot[i];
    if (s < 0) return;
    const last = this._pLive[--this._pLiveN];
    this._pLive[s] = last;
    this._pSlot[last] = s;
    this._pSlot[i] = -1;
    this._pFree[this._pFreeN++] = i;
  }

  /** Reset the shared spawn descriptor to defaults and return it. */
  _spReset() {
    const s = this._sp;
    s.x = s.y = s.z = 0;
    s.vx = s.vy = s.vz = 0;
    s.life = 1; s.s0 = 0.2; s.s1 = 0.3; s.rot = Math.random() * TAU; s.rv = 0;
    s.a = 1; s.fadeK = 1.4; s.fin = 0.06;
    s.grav = 0; s.drag = 0; s.turb = 0; s.bounce = 0.32;
    s.cell = C_GLOW; s.frames = 1; s.layer = L_ALPHA; s.flags = 0;
    s.c0 = this.col.white; s.c1 = this.col.white; s.mul = 1;
    return s;
  }
  /** Commit the shared descriptor as a live particle. */
  _emit() {
    const s = this._sp, p = this.p;
    const i = this._alloc();
    if (i < 0) return -1;
    p.x[i] = s.x; p.y[i] = s.y; p.z[i] = s.z;
    p.vx[i] = s.vx; p.vy[i] = s.vy; p.vz[i] = s.vz;
    p.life[i] = s.life; p.max[i] = s.life > 1e-3 ? s.life : 1e-3;
    p.s0[i] = s.s0; p.s1[i] = s.s1;
    p.rot[i] = s.rot; p.rv[i] = s.rv;
    p.a[i] = s.a; p.fadeK[i] = s.fadeK; p.fin[i] = s.fin;
    p.grav[i] = s.grav; p.drag[i] = s.drag; p.turb[i] = s.turb;
    p.bounce[i] = s.bounce; p.seed[i] = Math.random();
    p.cell[i] = s.cell; p.frames[i] = s.frames;
    p.layer[i] = s.layer; p.flags[i] = s.flags;
    const i3 = i * 3, m = s.mul, a = s.c0, b = s.c1;
    p.c0[i3] = a[0] * m; p.c0[i3 + 1] = a[1] * m; p.c0[i3 + 2] = a[2] * m;
    p.c1[i3] = b[0] * m; p.c1[i3 + 1] = b[1] * m; p.c1[i3 + 2] = b[2] * m;
    return i;
  }

  /** Convert a 0xrrggbb tint (or null) into a working-space colour triple. */
  _tint(hex, fallback) {
    if (hex === undefined || hex === null) return fallback;
    if (hex instanceof Float32Array) return hex;
    const c = this._colScratch || (this._colScratch = new THREE.Color());
    c.setHex(hex | 0);
    this._tmpCol[0] = c.r; this._tmpCol[1] = c.g; this._tmpCol[2] = c.b;
    return this._tmpCol;
  }

  // --------------------------------------------------------------------
  // public FX API
  // --------------------------------------------------------------------

  /**
   * Muzzle flash: two-frame star burst + hot core + brief PointLight + smoke.
   * @param {THREE.Vector3} pos barrel tip
   * @param {THREE.Vector3} dir firing direction (unit-ish)
   */
  muzzle(pos, dir, opts) {
    const scale = (opts && opts.scale !== undefined) ? opts.scale : 1;
    const wantLight = !opts || opts.light !== false;
    const d = this._dirOf(dir, 0, 0, -1);
    const px = pos.x + d.x * 0.05, py = pos.y + d.y * 0.05, pz = pos.z + d.z * 0.05;
    this._recentShots = Math.min(6, this._recentShots + 1);

    let s = this._spReset();
    s.x = px; s.y = py; s.z = pz;
    s.layer = L_ADD; s.cell = C_FLASH_A; s.frames = 2;
    s.life = 0.075; s.s0 = 0.34 * scale; s.s1 = 0.52 * scale;
    s.a = 1; s.fadeK = 0.9; s.fin = 0;
    s.c0 = this.col.flashCore; s.c1 = this.col.flashWarm;
    this._emit();
    s = this._spReset();                       // hot core just off the muzzle
    s.x = px + d.x * 0.03; s.y = py + d.y * 0.03; s.z = pz + d.z * 0.03;
    s.layer = L_ADD; s.cell = C_GLOW;
    s.life = 0.06; s.s0 = 0.2 * scale; s.s1 = 0.09 * scale;
    s.a = 0.95; s.fadeK = 1.1; s.fin = 0;
    s.c0 = this.col.flashCore; s.c1 = this.col.flashWarm;
    this._emit();

    const n = Math.round(clamp(3 * this.pScale, 1, 5));
    for (let i = 0; i < n; i++) {              // powder smoke drifting forward
      this._cone(d.x, d.y, d.z, 0.5, this._v1);
      const sp = rand(0.5, 1.5) * scale;
      s = this._spReset();
      s.x = px + d.x * rand(0.02, 0.16); s.y = py + d.y * rand(0.02, 0.16) + rand(-0.02, 0.03);
      s.z = pz + d.z * rand(0.02, 0.16);
      s.vx = this._v1.x * sp; s.vy = this._v1.y * sp + 0.25; s.vz = this._v1.z * sp;
      s.cell = pick(SMOKE_CELLS);
      s.life = rand(0.45, 0.85); s.s0 = 0.07 * scale; s.s1 = rand(0.3, 0.5) * scale;
      s.a = rand(0.12, 0.22); s.fadeK = 1.5; s.fin = 0.18;
      s.drag = 3.4; s.grav = -0.35; s.turb = 0.5; s.flags = F_EASE_SIZE | F_TURB;
      s.rv = rand(-1.4, 1.4);
      s.c0 = this.col.smokeLit; s.c1 = this.col.smokeMid;
      this._emit();
    }
    if (wantLight) {
      this._light('muzzle', 0xffd9a0, 16 * scale, 7.5 * scale, 0.055);
    }
    return this;
  }

  /**
   * Bullet tracer travelling from → to. Segments under 1 m are skipped.
   * @param {{width?:number,speed?:number,tint?:number}} [opts]
   */
  tracer(from, to, opts) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const total = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (total < 1) return this;
    const width = (opts && opts.width) || 0.035;
    const speed = (opts && opts.speed) || 260;
    const col = this._tint(opts ? opts.tint : null, this.col.sparkHot);
    const tc = this.tc, cap = this.tracerMax;
    let i = -1;
    for (let k = 0; k < cap; k++) if (!tc.live[k]) { i = k; break; }
    if (i < 0) {                                  // steal the shortest-lived beam
      let bl = Infinity;
      for (let k = 0; k < cap; k++) if (tc.life[k] < bl) { bl = tc.life[k]; i = k; }
    }
    const inv = 1 / total;
    tc.live[i] = 1;
    tc.x[i] = from.x; tc.y[i] = from.y; tc.z[i] = from.z;
    tc.dx[i] = dx * inv; tc.dy[i] = dy * inv; tc.dz[i] = dz * inv;
    tc.total[i] = total; tc.travel[i] = 0; tc.speed[i] = speed;
    tc.trail[i] = clamp(total * 0.45, 2.5, 14);
    tc.width[i] = width;
    tc.max[i] = tc.life[i] = total / speed + 0.06;
    const i3 = i * 3;
    tc.col[i3] = col[0]; tc.col[i3 + 1] = col[1]; tc.col[i3 + 2] = col[2];
    // Faint powder wisps hanging in the first shots' flight path.
    if (this._recentShots <= 2 && this.pScale > 0.6) {
      const wisps = 3;
      for (let k = 0; k < wisps; k++) {
        const d = rand(0.6, 4.5);
        const s = this._spReset();
        s.x = from.x + tc.dx[i] * d + rand(-0.05, 0.05);
        s.y = from.y + tc.dy[i] * d + rand(-0.05, 0.05);
        s.z = from.z + tc.dz[i] * d + rand(-0.05, 0.05);
        s.vy = rand(0.05, 0.3);
        s.cell = pick(SMOKE_CELLS);
        s.life = rand(0.7, 1.3); s.s0 = 0.06; s.s1 = rand(0.3, 0.55);
        s.a = rand(0.05, 0.1); s.fadeK = 1.6; s.fin = 0.25;
        s.drag = 1.6; s.turb = 0.35; s.flags = F_EASE_SIZE | F_TURB;
        s.c0 = this.col.smokeLit; s.c1 = this.col.smokeMid;
        this._emit();
      }
    }
    return this;
  }

  /**
   * Surface-specific bullet impact: particles + a bullet-hole decal.
   * @param {string} surface SURFACE.* (MAT_SURFACE maps materials to these)
   */
  impact(point, normal, surface) {
    const n = this._nrm.set(normal ? normal.x : 0, normal ? normal.y : 1, normal ? normal.z : 0);
    if (n.lengthSq() < 1e-8) n.set(0, 1, 0); else n.normalize();
    const px = point.x, py = point.y, pz = point.z;
    const k = this.pScale;
    switch (surface) {
      case SURFACE.METAL:
        this._impactSparks(px, py, pz, n, Math.round(clamp(12 * k, 5, 18)));
        this._impactGlow(px, py, pz, n, 0.3, 0.14, this.col.metalGlow);
        this._impactDust(px, py, pz, n, Math.round(clamp(2 * k, 1, 3)), this.col.smokeMid, 0.16, 0.5);
        this._impactChips(px, py, pz, n, Math.round(clamp(3 * k, 1, 5)), this.col.smokeDark, 3.4);
        break;
      case SURFACE.WOOD:
        this._impactSplinters(px, py, pz, n, Math.round(clamp(8 * k, 4, 12)));
        this._impactDust(px, py, pz, n, Math.round(clamp(4 * k, 2, 6)), this.col.woodDust, 0.2, 0.36);
        if (chance(0.35)) this._impactSparks(px, py, pz, n, 2);
        break;
      case SURFACE.DIRT:
      case SURFACE.SAND:
        this._impactDust(px, py, pz, n, Math.round(clamp(6 * k, 3, 8)),
          surface === SURFACE.SAND ? this.col.sand : this.col.dustWarm, 0.3, 0.5);
        this._impactChips(px, py, pz, n, Math.round(clamp(7 * k, 3, 10)),
          surface === SURFACE.SAND ? this.col.dustDark : this.col.dirtDark, 2.6);
        break;
      case SURFACE.GLASS:
        this._impactShards(px, py, pz, n, Math.round(clamp(12 * k, 6, 16)));
        this._impactGlow(px, py, pz, n, 0.42, 0.09, this.col.glass);
        this._impactDust(px, py, pz, n, 2, this.col.glass, 0.14, 0.4);
        break;
      case SURFACE.WATER:
        this._impactDust(px, py, pz, n, Math.round(clamp(6 * k, 3, 8)), this.col.glass, 0.26, 1.6);
        this._impactSparks(px, py, pz, n, 0);
        break;
      case SURFACE.FABRIC:
        this._impactDust(px, py, pz, n, Math.round(clamp(4 * k, 2, 5)), this.col.dustWarm, 0.2, 0.3);
        this._impactChips(px, py, pz, n, 2, this.col.dustDark, 1.8);
        break;
      default:                                     // concrete / tile / stone
        this._impactDust(px, py, pz, n, Math.round(clamp(5 * k, 3, 7)), this.col.concrete, 0.26, 0.55);
        this._impactChips(px, py, pz, n, Math.round(clamp(5 * k, 2, 7)), this.col.dustDark, 3.0);
        if (chance(0.55)) this._impactSparks(px, py, pz, n, randInt(1, 3));
        break;
    }
    if (surface !== SURFACE.WATER && surface !== SURFACE.FABRIC) {
      const size = surface === SURFACE.DIRT || surface === SURFACE.SAND
        ? rand(0.16, 0.22) : rand(0.1, 0.15);
      this.decal(point, this._nrm, 'bullet', size);
    }
    return this;
  }

  /** Grey/tan dust puff blown out of the surface. */
  _impactDust(x, y, z, n, count, col, size, speed) {
    for (let i = 0; i < count; i++) {
      this._cone(n.x, n.y, n.z, 1.0, this._v1);
      const sp = rand(0.3, 1) * speed;
      const s = this._spReset();
      s.x = x + n.x * 0.03 + this._v1.x * 0.04;
      s.y = y + n.y * 0.03 + this._v1.y * 0.04;
      s.z = z + n.z * 0.03 + this._v1.z * 0.04;
      s.vx = this._v1.x * sp; s.vy = this._v1.y * sp + 0.2; s.vz = this._v1.z * sp;
      s.cell = pick(SMOKE_CELLS);
      s.life = rand(0.4, 0.95); s.s0 = size * 0.35; s.s1 = size * rand(1.6, 2.6);
      s.a = rand(0.24, 0.42); s.fadeK = 1.5; s.fin = 0.1;
      s.drag = 3.2; s.grav = 0.9; s.turb = 0.3;
      s.flags = F_EASE_SIZE | F_TURB; s.rv = rand(-1.6, 1.6);
      s.c0 = col; s.c1 = this.col.smokeMid; s.mul = rand(0.85, 1.12);
      this._emit();
    }
  }
  /** Spall sparks: fast, gravity-bound, velocity-aligned streaks. */
  _impactSparks(x, y, z, n, count) {
    for (let i = 0; i < count; i++) {
      this._cone(n.x, n.y, n.z, 1.15, this._v1);
      const sp = rand(2.2, 7.5);
      const s = this._spReset();
      s.x = x + n.x * 0.02; s.y = y + n.y * 0.02; s.z = z + n.z * 0.02;
      s.vx = this._v1.x * sp; s.vy = this._v1.y * sp + rand(0, 1.2); s.vz = this._v1.z * sp;
      s.layer = L_ADD; s.cell = C_STREAK;
      s.life = rand(0.12, 0.4); s.s0 = rand(0.1, 0.2); s.s1 = rand(0.04, 0.08);
      s.a = 1; s.fadeK = 1.1; s.fin = 0;
      s.grav = 11; s.drag = 1.2; s.flags = F_ALIGN_VEL;
      s.c0 = this.col.sparkHot; s.c1 = this.col.sparkCold;
      this._emit();
    }
  }

  /** Short-lived hot glow right on the impact point. */
  _impactGlow(x, y, z, n, size, life, col) {
    const s = this._spReset();
    s.x = x + n.x * 0.02; s.y = y + n.y * 0.02; s.z = z + n.z * 0.02;
    s.layer = L_ADD; s.cell = C_GLOW;
    s.life = life; s.s0 = size; s.s1 = size * 0.4;
    s.a = 0.9; s.fadeK = 1.4; s.fin = 0;
    s.c0 = col; s.c1 = col;
    this._emit();
  }

  /** Fine solid debris that bounces off real geometry. */
  _impactChips(x, y, z, n, count, col, speed) {
    for (let i = 0; i < count; i++) {
      this._cone(n.x, n.y, n.z, 1.25, this._v1);
      const sp = rand(0.4, 1) * speed;
      const s = this._spReset();
      s.x = x + n.x * 0.03; s.y = y + n.y * 0.03; s.z = z + n.z * 0.03;
      s.vx = this._v1.x * sp; s.vy = this._v1.y * sp + rand(0.4, 1.8); s.vz = this._v1.z * sp;
      s.cell = C_CHUNK;
      s.life = rand(0.7, 1.6); s.s0 = rand(0.02, 0.05); s.s1 = rand(0.02, 0.045);
      s.a = 0.95; s.fadeK = 0.9; s.fin = 0;
      s.grav = 13; s.drag = 0.3; s.bounce = 0.28;
      s.flags = F_COLLIDE; s.rv = rand(-9, 9);
      s.c0 = col; s.c1 = col; s.mul = rand(0.7, 1.1);
      this._emit();
    }
  }
  /** Wood splinters — long thin slivers tumbling away from the hole. */
  _impactSplinters(x, y, z, n, count) {
    for (let i = 0; i < count; i++) {
      this._cone(n.x, n.y, n.z, 1.1, this._v1);
      const sp = rand(1.4, 4.6);
      const s = this._spReset();
      s.x = x + n.x * 0.03; s.y = y + n.y * 0.03; s.z = z + n.z * 0.03;
      s.vx = this._v1.x * sp; s.vy = this._v1.y * sp + rand(0.5, 2.2); s.vz = this._v1.z * sp;
      s.cell = C_SPLINTER;
      s.life = rand(0.6, 1.4); s.s0 = rand(0.06, 0.13); s.s1 = rand(0.06, 0.13);
      s.a = 0.95; s.fadeK = 1.1; s.fin = 0;
      s.grav = 12.5; s.drag = 0.9; s.bounce = 0.2;
      s.flags = F_ALIGN_VEL | F_COLLIDE;
      s.c0 = this.col.wood; s.c1 = this.col.wood; s.mul = rand(0.75, 1.15);
      this._emit();
    }
  }

  /** Glass shards — bright, sharp, they shatter (stick) on landing. */
  _impactShards(x, y, z, n, count) {
    for (let i = 0; i < count; i++) {
      this._cone(n.x, n.y, n.z, 1.3, this._v1);
      const sp = rand(1.6, 5.5);
      const s = this._spReset();
      s.x = x + n.x * 0.03; s.y = y + n.y * 0.03; s.z = z + n.z * 0.03;
      s.vx = this._v1.x * sp; s.vy = this._v1.y * sp + rand(0.2, 1.6); s.vz = this._v1.z * sp;
      s.cell = C_SHARD;
      s.life = rand(0.7, 1.5); s.s0 = rand(0.05, 0.12); s.s1 = rand(0.05, 0.12);
      s.a = 0.85; s.fadeK = 1.2; s.fin = 0;
      s.grav = 13.5; s.drag = 0.5; s.bounce = 0.12;
      s.flags = F_ALIGN_VEL | F_COLLIDE; s.rv = rand(-6, 6);
      s.c0 = this.col.glass; s.c1 = this.col.glass; s.mul = rand(0.85, 1.25);
      this._emit();
    }
  }

  /**
   * Blood: mist along `dir`, gravity droplets and a decal where they land.
   * @param {number} amount 0..2-ish severity multiplier
   */
  blood(point, dir, amount) {
    const amt = clamp(amount === undefined ? 1 : amount, 0.15, 3);
    const d = this._dirOf(dir, 0, 1, 0);
    const k = this.pScale;
    const mist = Math.round(clamp(5 * amt * k, 2, 10));
    for (let i = 0; i < mist; i++) {
      this._cone(d.x, d.y, d.z, 0.75, this._v1);
      const sp = rand(0.8, 3.2) * (0.6 + amt * 0.4);
      const s = this._spReset();
      s.x = point.x + this._v1.x * 0.04;
      s.y = point.y + this._v1.y * 0.04;
      s.z = point.z + this._v1.z * 0.04;
      s.vx = this._v1.x * sp; s.vy = this._v1.y * sp + 0.2; s.vz = this._v1.z * sp;
      s.cell = chance(0.5) ? C_BLOOD : pick(SMOKE_CELLS);
      s.life = rand(0.35, 0.8); s.s0 = 0.05 * amt; s.s1 = rand(0.16, 0.34) * amt;
      s.a = rand(0.45, 0.75); s.fadeK = 1.6; s.fin = 0.06;
      s.drag = 4.2; s.grav = 3.2; s.flags = F_EASE_SIZE;
      s.rv = rand(-2, 2);
      s.c0 = this.col.bloodMist; s.c1 = this.col.bloodDark; s.mul = rand(0.8, 1.15);
      this._emit();
    }
    const drops = Math.round(clamp(7 * amt * k, 3, 14));
    for (let i = 0; i < drops; i++) {
      this._cone(d.x, d.y, d.z, 1.0, this._v1);
      const sp = rand(1.2, 4.5) * (0.6 + amt * 0.4);
      const s = this._spReset();
      s.x = point.x; s.y = point.y; s.z = point.z;
      s.vx = this._v1.x * sp; s.vy = this._v1.y * sp + rand(0.3, 1.6); s.vz = this._v1.z * sp;
      s.cell = C_BLOOD;
      s.life = rand(0.7, 1.5); s.s0 = rand(0.025, 0.06); s.s1 = rand(0.02, 0.05);
      s.a = 0.92; s.fadeK = 0.8; s.fin = 0;
      s.grav = 14; s.drag = 0.4;
      s.flags = F_COLLIDE | F_STICK | F_BLOOD_DECAL;
      s.c0 = this.col.blood; s.c1 = this.col.bloodDark; s.mul = rand(0.85, 1.2);
      this._emit();
    }
    // Main splat: prefer the surface the spray is heading for, else the floor.
    let tr = this._trace(point.x, point.y, point.z, d.x, d.y, d.z, 3.2);
    if (!tr) tr = this._trace(point.x, point.y, point.z, 0, -1, 0, 2.4);
    if (tr) {
      this._sv1.set(tr.px, tr.py, tr.pz);
      this._sv2.set(tr.nx, tr.ny, tr.nz);
      this.decal(this._sv1, this._sv2, 'blood', rand(0.4, 0.85) * (0.7 + amt * 0.5));
    }
    return this;
  }

  /**
   * Eject a brass casing. `dir` is the ejection direction, `up` the weapon up.
   */
  casing(pos, dir, up) {
    const cs = this.cs, cap = this.casingMax;
    let i = -1;
    for (let k = 0; k < cap; k++) if (!cs.live[k]) { i = k; break; }
    if (i < 0) {
      let bl = Infinity;
      for (let k = 0; k < cap; k++) if (cs.life[k] < bl) { bl = cs.life[k]; i = k; }
    }
    const d = this._dirOf(dir, 1, 0, 0);
    const u = this._v1.set(up ? up.x : 0, up ? up.y : 1, up ? up.z : 0);
    if (u.lengthSq() < 1e-8) u.set(0, 1, 0); else u.normalize();
    const sp = rand(1.6, 2.9);
    cs.live[i] = 1;
    cs.x[i] = pos.x; cs.y[i] = pos.y; cs.z[i] = pos.z;
    cs.vx[i] = d.x * sp + u.x * 0.9 + rand(-0.3, 0.3);
    cs.vy[i] = d.y * sp + u.y * 0.9 + rand(0.5, 1.4);
    cs.vz[i] = d.z * sp + u.z * 0.9 + rand(-0.3, 0.3);
    cs.wx[i] = rand(-26, 26); cs.wy[i] = rand(-26, 26); cs.wz[i] = rand(-26, 26);
    const i4 = i * 4;
    this._q1.setFromAxisAngle(this._v2.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize(), rand(0, TAU));
    cs.quat[i4] = this._q1.x; cs.quat[i4 + 1] = this._q1.y;
    cs.quat[i4 + 2] = this._q1.z; cs.quat[i4 + 3] = this._q1.w;
    cs.life[i] = 4.2; cs.rest[i] = 0; cs.bounces[i] = 0;
    this._csDirty = true;
    return this;
  }

  /**
   * HE grenade / bomb blast: core flash, fireball, shockwave, plume, debris.
   * @param {number} radius visual blast radius in metres
   */
  explosion(pos, radius) {
    const R = clamp(radius || 4, 0.6, 30);
    const k = this.pScale;
    const px = pos.x, py = pos.y, pz = pos.z;

    let s = this._spReset();                       // white-hot core
    s.x = px; s.y = py + R * 0.12; s.z = pz;
    s.layer = L_ADD; s.cell = C_GLOW;
    s.life = 0.16; s.s0 = R * 0.5; s.s1 = R * 1.5;
    s.a = 1; s.fadeK = 1.6; s.fin = 0; s.flags = F_EASE_SIZE;
    s.c0 = this.col.flashCore; s.c1 = this.col.flashWarm;
    this._emit();

    const balls = Math.round(clamp(5 * k, 3, 8));  // expanding fireball
    for (let i = 0; i < balls; i++) {
      this._cone(0, 1, 0, 1.4, this._v1);
      const off = R * rand(0.05, 0.32);
      s = this._spReset();
      s.x = px + this._v1.x * off;
      s.y = py + R * 0.18 + this._v1.y * off * 0.6;
      s.z = pz + this._v1.z * off;
      s.vx = this._v1.x * R * 0.7; s.vy = Math.abs(this._v1.y) * R * 0.5 + R * 0.25;
      s.vz = this._v1.z * R * 0.7;
      s.layer = L_ADD; s.cell = C_FIREBALL;
      s.life = rand(0.28, 0.5); s.s0 = R * 0.3; s.s1 = R * rand(0.85, 1.35);
      s.a = rand(0.8, 1); s.fadeK = 1.5; s.fin = 0.05;
      s.drag = 4.5; s.rv = rand(-2.5, 2.5); s.flags = F_EASE_SIZE;
      s.c0 = this.col.white; s.c1 = this.col.fireDeep;
      this._emit();
    }
    this._ring(px, py + 0.06, pz, R * 0.25, R * 1.7, 0.5, 0.55, this.col.flashWarm);
    this._light('explode', 0xffc070, 500 * R, R * 6, 0.4);

    const plume = Math.round(clamp(9 * k, 5, 14));    // dark smoke rising
    for (let i = 0; i < plume; i++) {
      this._cone(0, 1, 0, 1.5, this._v1);
      s = this._spReset();
      s.x = px + this._v1.x * R * 0.25;
      s.y = py + R * 0.2 + Math.abs(this._v1.y) * R * 0.2;
      s.z = pz + this._v1.z * R * 0.25;
      s.vx = this._v1.x * R * 0.35; s.vy = R * rand(0.35, 0.7); s.vz = this._v1.z * R * 0.35;
      s.cell = pick(SMOKE_CELLS);
      s.life = rand(2.6, 4.2); s.s0 = R * 0.35; s.s1 = R * rand(1.1, 1.8);
      s.a = rand(0.4, 0.7); s.fadeK = 1.35; s.fin = 0.12;
      s.drag = 1.5; s.grav = -0.5; s.turb = 0.7; s.rv = rand(-0.7, 0.7);
      s.flags = F_EASE_SIZE | F_TURB;
      s.c0 = this.col.smokeDark; s.c1 = this.col.smokeBlack;
      this._emit();
    }
    this._debrisBurst(px, py + 0.1, pz, Math.round(clamp(14 * k, 6, 20)), this.col.dirtDark, R * 0.7);
    this._impactSparks(px, py + 0.15, pz, this._nrm.set(0, 1, 0), Math.round(clamp(10 * k, 4, 14)));
    this.decal(this._v3.set(px, py, pz), this._nrm.set(0, 1, 0), 'scorch', R * 0.55);
    this.shake(clamp(R / 9, 0.25, 1.3), 0.55);
    return this;
  }

  /** Ground shockwave / dissipating ring. */
  _ring(x, y, z, r0, r1, life, alpha, col) {
    const rg = this.rg, cap = this.ringMax;
    let i = -1;
    for (let k = 0; k < cap; k++) if (!rg.live[k]) { i = k; break; }
    if (i < 0) { i = 0; for (let k = 1; k < cap; k++) if (rg.life[k] < rg.life[i]) i = k; }
    rg.live[i] = 1;
    rg.x[i] = x; rg.y[i] = y; rg.z[i] = z;
    rg.r0[i] = r0; rg.r1[i] = r1;
    rg.rot[i] = Math.random() * TAU;
    rg.life[i] = life; rg.max[i] = life; rg.a[i] = alpha;
    const c = col || this.col.white, i3 = i * 3;
    rg.col[i3] = c[0]; rg.col[i3 + 1] = c[1]; rg.col[i3 + 2] = c[2];
    return this;
  }

  /** Short-lived point light. Position defaults to the last emitted particle. */
  _light(kind, hex, intensity, dist, life, x, y, z) {
    if (!this._lightPool) return this;
    const l = this._lightPool.get();
    if (!l) return this;
    l.color.setHex(hex);
    l.distance = dist;
    l.intensity = intensity;
    const s = this._sp;
    l.position.set(x !== undefined ? x : s.x, y !== undefined ? y : s.y, z !== undefined ? z : s.z);
    l._fx.kind = kind; l._fx.life = life; l._fx.max = life; l._fx.i0 = intensity;
    return this;
  }

  /** Flashbang detonation: a blinding white pop. */
  flashPop(pos) {
    let s = this._spReset();
    s.x = pos.x; s.y = pos.y; s.z = pos.z;
    s.layer = L_ADD; s.cell = C_GLOW;
    s.life = 0.34; s.s0 = 1.4; s.s1 = 7.5;
    s.a = 1; s.fadeK = 1.15; s.fin = 0; s.flags = F_EASE_SIZE;
    s.c0 = this.col.white; s.c1 = this.col.white;
    this._emit();
    s = this._spReset();
    s.x = pos.x; s.y = pos.y; s.z = pos.z;
    s.layer = L_ADD; s.cell = C_FLASH_A; s.frames = 2;
    s.life = 0.16; s.s0 = 2.2; s.s1 = 4.4;
    s.a = 1; s.fadeK = 1; s.fin = 0;
    s.c0 = this.col.white; s.c1 = this.col.flashCore;
    this._emit();
    for (let i = 0; i < Math.round(clamp(10 * this.pScale, 4, 14)); i++) {
      this._cone(0, 1, 0, 2, this._v1);
      s = this._spReset();
      s.x = pos.x; s.y = pos.y; s.z = pos.z;
      s.vx = this._v1.x * rand(4, 11); s.vy = this._v1.y * rand(4, 11); s.vz = this._v1.z * rand(4, 11);
      s.layer = L_ADD; s.cell = C_STREAK;
      s.life = rand(0.1, 0.22); s.s0 = 0.4; s.s1 = 0.06;
      s.a = 0.9; s.fadeK = 1.6; s.fin = 0; s.drag = 5; s.flags = F_ALIGN_VEL;
      s.c0 = this.col.white; s.c1 = this.col.flashWarm;
      this._emit();
    }
    this._light('flash', 0xffffff, 900, 26, 0.3, pos.x, pos.y, pos.z);
    this._ring(pos.x, pos.y, pos.z, 0.5, 5.5, 0.28, 0.5, this.col.white);
    return this;
  }

  // --------------------------------------------------------------------
  // smoke clouds
  // --------------------------------------------------------------------
  _puffAlloc() {
    if (this._fFreeN > 0) {
      const i = this._fFree[--this._fFreeN];
      this._fSlot[i] = this._fLiveN;
      this._fLive[this._fLiveN++] = i;
      return i;
    }
    return -1;
  }

  _puffFree(i) {
    const s = this._fSlot[i];
    if (s < 0) return;
    const last = this._fLive[--this._fLiveN];
    this._fLive[s] = last;
    this._fSlot[last] = s;
    this._fSlot[i] = -1;
    this._fFree[this._fFreeN++] = i;
  }

  /**
   * CS-style smoke grenade cloud: erupts to `radius` in ~1.5 s, holds, then
   * dissipates over the last ~3 s of `life`.
   * @returns {FxHandle}
   */
  smoke(pos, radius, life) {
    let slot = this._clouds.indexOf(null);
    if (slot < 0) {                                   // reuse the oldest cloud
      let best = 0;
      for (let i = 1; i < this._clouds.length; i++) {
        if (this._clouds[i].t > this._clouds[best].t) best = i;
      }
      this._killHandle(this._clouds[best], true);
      slot = this._clouds.indexOf(null);
      if (slot < 0) slot = best;
    }
    const h = this._cloudPool.get() || new FxHandle(this, 'smoke');
    h.kind = 'smoke';
    h.pos.copy(pos);
    h.radius = clamp(radius || 4.6, 1, 9);
    h.life = Math.max(3, life || 18);
    h.t = 0;
    h.alive = true;
    h.slot = slot;
    h.grow = 1.5;
    h.fade = 3;
    h.puffs = [];
    this._clouds[slot] = h;
    const want = Math.round(clamp(this.q.smokePuffs || 60, 12, 120));
    for (let i = 0; i < want; i++) {
      const p = this._puffAlloc();
      if (p < 0) break;
      const pf = this.pf;
      // sample inside a slightly squashed sphere so the cloud sits on the ground
      this._cone(0, 1, 0, 3.2, this._v1);
      const rr = Math.cbrt(Math.random()) * 0.92;
      pf.ox[p] = this._v1.x * rr;
      pf.oy[p] = Math.abs(this._v1.y) * rr * 0.72 + 0.08;
      pf.oz[p] = this._v1.z * rr;
      pf.sz[p] = rand(0.68, 1.15);
      pf.ph[p] = Math.random() * TAU;
      pf.sp[p] = rand(0.35, 0.9);
      pf.rot[p] = Math.random() * TAU;
      pf.rv[p] = rand(-0.22, 0.22);
      pf.cell[p] = pick(SMOKE_CELLS);
      pf.stag[p] = Math.random() * 0.45;
      pf.vf[p] = rand(0.85, 1.15);
      pf.a[p] = rand(0.82, 1);
      pf.ci[p] = slot;
      h.puffs.push(p);
    }
    return h;
  }

  // --------------------------------------------------------------------
  // molotov fire
  // --------------------------------------------------------------------
  _flameAlloc() {
    if (this._lFreeN > 0) {
      const i = this._lFree[--this._lFreeN];
      this._lSlot[i] = this._lLiveN;
      this._lLive[this._lLiveN++] = i;
      return i;
    }
    return -1;
  }

  _flameFree(i) {
    const s = this._lSlot[i];
    if (s < 0) return;
    const last = this._lLive[--this._lLiveN];
    this._lLive[s] = last;
    this._lSlot[last] = s;
    this._lSlot[i] = -1;
    this._lFree[this._lFreeN++] = i;
  }

  /** Burning ground patch: flame tongues, embers, black smoke and a light. */
  fire(pos, radius, life) {
    let slot = this._fires.indexOf(null);
    if (slot < 0) {
      let best = 0;
      for (let i = 1; i < this._fires.length; i++) if (this._fires[i].t > this._fires[best].t) best = i;
      this._killHandle(this._fires[best], true);
      slot = this._fires.indexOf(null);
      if (slot < 0) slot = best;
    }
    const h = this._firePool.get() || new FxHandle(this, 'fire');
    h.kind = 'fire';
    h.pos.copy(pos);
    h.radius = clamp(radius || 1.4, 0.4, 5);
    h.life = Math.max(1.5, life || 7);
    h.t = 0;
    h.alive = true;
    h.slot = slot;
    h.fade = 1.1;
    h.tongues = [];
    h.ember = 0;
    this._fires[slot] = h;
    for (let i = 0; i < this.tonguesPerFire; i++) {
      const f = this._flameAlloc();
      if (f < 0) break;
      const fl = this.fl;
      const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * 0.92;
      fl.ox[f] = Math.cos(a) * r;
      fl.oz[f] = Math.sin(a) * r;
      fl.ph[f] = Math.random() * TAU;
      fl.sp[f] = rand(5.5, 9.5);
      fl.hgt[f] = rand(0.55, 1.15);
      fl.wid[f] = rand(0.4, 0.78);
      fl.rotb[f] = rand(-0.16, 0.16);
      fl.kind[f] = Math.random() < 0.22 ? 1 : 0;      // 1 = hotter inner tongue
      fl.fi[f] = slot;
      h.tongues.push(f);
    }
    this.decal(pos, this._nrm.set(0, 1, 0), 'burn', h.radius * 1.5);
    return h;
  }

  /** Retire a cloud/fire handle: fade it out, or drop it immediately. */
  _killHandle(h, immediate) {
    if (!h || !h.alive) return;
    if (!immediate) { h.t = Math.max(h.t, h.life - (h.fade || 1)); return; }
    h.alive = false;
    if (h.kind === 'smoke') {
      for (const p of h.puffs) this._puffFree(p);
      h.puffs.length = 0;
      if (this._clouds[h.slot] === h) this._clouds[h.slot] = null;
      this._cloudPool.put(h);
    } else {
      for (const f of h.tongues) this._flameFree(f);
      h.tongues.length = 0;
      if (this._fires[h.slot] === h) {
        this._fires[h.slot] = null;
        const l = this._fireLights[h.slot];
        if (l) l.intensity = 0;
      }
      this._firePool.put(h);
    }
    h.slot = -1;
  }

  // --------------------------------------------------------------------
  // decals, dust, sparks, debris, shake
  // --------------------------------------------------------------------
  /**
   * Surface decal oriented by `normal`.
   * @param {'bullet'|'blood'|'scorch'|'burn'} kind
   */
  decal(point, normal, kind = 'bullet', size = 0.14) {
    const dc = this.dc;
    let i;
    if (this._dFreeN > 0) {
      i = this._dFree[--this._dFreeN];
      this._dSlot[i] = this._dLiveN;
      this._dLive[this._dLiveN++] = i;
    } else {
      // recycle the oldest decal in the ring
      i = this._dLive[0];
      let bt = dc.birth[i];
      for (let k = 1; k < this._dLiveN; k++) {
        const j = this._dLive[k];
        if (dc.birth[j] < bt) { bt = dc.birth[j]; i = j; }
      }
    }
    this._basis(normal.x, normal.y, normal.z);
    const t1 = this._tan1, t2 = this._tan2;
    const rot = Math.random() * TAU, cr = Math.cos(rot), sr = Math.sin(rot);
    const rx = t1.x * cr + t2.x * sr, ry = t1.y * cr + t2.y * sr, rz = t1.z * cr + t2.z * sr;
    const ux = t2.x * cr - t1.x * sr, uy = t2.y * cr - t1.y * sr, uz = t2.z * cr - t1.z * sr;
    let cell = pick(D_BULLET), life = 999, a = 0.92, w = size;
    let col = this.col.white;
    if (kind === 'blood') { cell = pick(D_BLOOD); a = 0.85; life = 40; col = this.col.blood; }
    else if (kind === 'scorch') { cell = pick(D_SCORCH); a = 0.8; life = 60; }
    else if (kind === 'burn') { cell = D_BURN[0]; a = 0.7; life = 24; }
    dc.x[i] = point.x + normal.x * 0.012;
    dc.y[i] = point.y + normal.y * 0.012;
    dc.z[i] = point.z + normal.z * 0.012;
    dc.rx[i] = rx; dc.ry[i] = ry; dc.rz[i] = rz;
    dc.ux[i] = ux; dc.uy[i] = uy; dc.uz[i] = uz;
    dc.w[i] = w; dc.h[i] = w;
    dc.life[i] = life; dc.fade[i] = Math.min(4, life * 0.25); dc.a[i] = a;
    dc.cell[i] = cell; dc.birth[i] = this._now;
    const i3 = i * 3;
    dc.col[i3] = col[0]; dc.col[i3 + 1] = col[1]; dc.col[i3 + 2] = col[2];
    return this;
  }

  /** Footstep / landing dust puff. */
  dust(pos, amount = 1) {
    const n = Math.round(clamp(3 * amount * this.pScale, 1, 6));
    for (let i = 0; i < n; i++) {
      const s = this._spReset();
      s.x = pos.x + rand(-0.16, 0.16); s.y = pos.y + 0.04; s.z = pos.z + rand(-0.16, 0.16);
      s.vx = rand(-0.5, 0.5) * amount; s.vy = rand(0.15, 0.55) * amount; s.vz = rand(-0.5, 0.5) * amount;
      s.cell = pick(SMOKE_CELLS);
      s.life = rand(0.4, 0.8); s.s0 = 0.08; s.s1 = rand(0.3, 0.55) * (0.6 + amount * 0.5);
      s.a = rand(0.1, 0.24) * amount; s.fadeK = 1.5; s.fin = 0.15;
      s.drag = 3.6; s.grav = -0.4; s.rv = rand(-1, 1); s.flags = F_EASE_SIZE;
      s.c0 = this.col.dustPale; s.c1 = this.col.dustWarm;
      this._emit();
    }
    return this;
  }

  /** Directional spark shower. */
  sparks(pos, dir, count = 8) {
    const d = this._dirOf(dir, 0, 1, 0);
    this._impactSparks(pos.x, pos.y, pos.z, d, Math.round(clamp(count * this.pScale, 2, 22)));
    return this;
  }

  /** Chunks of solid matter flung out of a surface. */
  debris(pos, count = 8, tint) {
    this._debrisBurst(pos.x, pos.y, pos.z, Math.round(clamp(count * this.pScale, 2, 24)),
      this._tint(tint, this.col.dirt), 3.2);
    return this;
  }

  _debrisBurst(x, y, z, count, col, speed) {
    for (let i = 0; i < count; i++) {
      this._cone(0, 1, 0, 1.35, this._v1);
      const sp = speed * rand(0.35, 1);
      const s = this._spReset();
      s.x = x; s.y = y + 0.05; s.z = z;
      s.vx = this._v1.x * sp; s.vy = Math.abs(this._v1.y) * sp * 1.2 + 1.2; s.vz = this._v1.z * sp;
      s.cell = Math.random() < 0.5 ? C_CHUNK : C_SPLINTER;
      s.life = rand(0.8, 1.8); s.s0 = rand(0.04, 0.11); s.s1 = rand(0.04, 0.11);
      s.a = 1; s.fadeK = 3.2; s.fin = 0;
      s.grav = 15; s.drag = 0.5; s.bounce = 0.28; s.rv = rand(-9, 9);
      s.flags = F_COLLIDE;
      s.c0 = col; s.c1 = col;
      this._emit();
    }
    return this;
  }

  // --------------------------------------------------------------------
  // camera shake
  // --------------------------------------------------------------------
  /** Kick the camera. `amount` ≈ 1 is a grenade at close range. */
  shake(amount = 0.5, duration = 0.4) {
    const sk = this._sk;
    sk.amp = Math.max(sk.amp, clamp(amount, 0, 2));
    sk.dec = 1 / Math.max(0.08, duration);
    sk.ph = Math.random() * TAU;
    return this;
  }

  /** Additive camera offset in radians; the integrator adds it to the view. */
  get shakeOffset() { return this._shake; }

  /** Retire everything instantly (round restart). */
  clear() {
    while (this._pLiveN > 0) this._freeParticle(this._pLive[this._pLiveN - 1]);
    while (this._dLiveN > 0) {
      const i = this._dLive[--this._dLiveN];
      this._dSlot[i] = -1;
      this._dFree[this._dFreeN++] = i;
    }
    for (const h of this._clouds.slice()) if (h) this._killHandle(h, true);
    for (const h of this._fires.slice()) if (h) this._killHandle(h, true);
    for (let i = 0; i < this.tracerMax; i++) this.tc.live[i] = 0;
    this._tcN = 0;
    for (let i = 0; i < this.ringMax; i++) this.rg.live[i] = 0;
    for (let i = 0; i < this.casingMax; i++) { this.cs.live[i] = 0; this._csHide(i); }
    if (this._lightPool) {
      for (const l of [...this._lightPool.used]) { l.intensity = 0; l._fx.kind = ''; this._lightPool.put(l); }
    }
    for (const l of this._fireLights) l.intensity = 0;
    this._shake.pitch = this._shake.yaw = this._shake.roll = 0;
    this._sk.amp = 0;
    this._recentShots = 0;
    for (const L of this._layers) { L.reset(); L.flush(); }
    if (this.lBeam) { this.lBeam.reset(); this.lBeam.flush(); }
    return this;
  }

  get liveCount() {
    return this._pLiveN + this._fLiveN + this._lLiveN + this._dLiveN + this._tcN;
  }

  // --------------------------------------------------------------------
  // per-frame update
  // --------------------------------------------------------------------
  /** Advance every system and rebuild the instance buffers. */
  update(dt, camera) {
    if (!(dt > 0)) dt = 0;
    dt = Math.min(dt, 0.05);
    this._now += dt;
    for (const L of this._layers) L.reset();
    this._stepParticles(dt);
    this._stepClouds(dt);
    this._stepFires(dt);
    this._stepTracers(dt);
    this._stepRings(dt);
    this._stepDecals(dt);
    this._stepCasings(dt);
    this._stepLights(dt);
    this._stepShake(dt);
    if (this._recentShots > 0) this._recentShots = Math.max(0, this._recentShots - dt * 3);
    for (const L of this._layers) L.flush();
    if (this._csDirty) { this.casingMesh.instanceMatrix.needsUpdate = true; this._csDirty = false; }
    return this;
  }

  _stepParticles(dt) {
    const p = this.p;
    for (let k = this._pLiveN - 1; k >= 0; k--) {
      const i = this._pLive[k];
      p.life[i] -= dt;
      if (p.life[i] <= 0) { this._freeParticle(i); continue; }
      const age = 1 - p.life[i] / p.max[i];
      const fl = p.flags[i];
      // motion
      if (p.drag[i] > 0) {
        const d = Math.exp(-p.drag[i] * dt);
        p.vx[i] *= d; p.vy[i] *= d; p.vz[i] *= d;
      }
      p.vy[i] -= p.grav[i] * dt;
      if (fl & F_TURB) {
        const t = this._now * 1.7 + p.seed[i] * 37;
        const tb = p.turb[i];
        p.vx[i] += Math.sin(t) * tb * dt * 2.2;
        p.vz[i] += Math.cos(t * 1.31 + 1.7) * tb * dt * 2.2;
        p.vy[i] += Math.sin(t * 0.73 + 0.4) * tb * dt * 0.9;
      }
      let nx = p.x[i] + p.vx[i] * dt, ny = p.y[i] + p.vy[i] * dt, nz = p.z[i] + p.vz[i] * dt;
      if (fl & (F_COLLIDE | F_STICK)) {
        const dx = nx - p.x[i], dy = ny - p.y[i], dz = nz - p.z[i];
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (len > 1e-5) {
          const hit = this._trace(p.x[i], p.y[i], p.z[i], dx / len, dy / len, dz / len, len + 0.02);
          if (hit) {
            if (fl & F_STICK) {
              if (fl & F_BLOOD_DECAL) this.decal(this._v2.set(hit.px, hit.py, hit.pz), this._nrm.set(hit.nx, hit.ny, hit.nz), 'blood', rand(0.12, 0.3));
              this._freeParticle(i);
              continue;
            }
            nx = hit.px + hit.nx * 0.01; ny = hit.py + hit.ny * 0.01; nz = hit.pz + hit.nz * 0.01;
            const vn = p.vx[i] * hit.nx + p.vy[i] * hit.ny + p.vz[i] * hit.nz;
            const b = p.bounce[i];
            p.vx[i] = (p.vx[i] - 2 * vn * hit.nx) * b;
            p.vy[i] = (p.vy[i] - 2 * vn * hit.ny) * b;
            p.vz[i] = (p.vz[i] - 2 * vn * hit.nz) * b;
          }
        }
      }
      p.x[i] = nx; p.y[i] = ny; p.z[i] = nz;
      p.rot[i] += p.rv[i] * dt;
      // appearance
      const eased = (fl & F_EASE_SIZE) ? 1 - Math.pow(1 - age, 2.2) : age;
      const size = p.s0[i] + (p.s1[i] - p.s0[i]) * eased;
      const fin = p.fin[i];
      let a = p.a[i];
      if (age < fin && fin > 0) a *= age / fin;
      else a *= Math.pow(1 - clamp01((age - fin) / Math.max(1e-3, 1 - fin)), p.fadeK[i]);
      if (a <= 0.002) continue;
      const i3 = i * 3, m = 1 - age;
      const r = p.c0[i3] * m + p.c1[i3] * age;
      const g = p.c0[i3 + 1] * m + p.c1[i3 + 1] * age;
      const b2 = p.c0[i3 + 2] * m + p.c1[i3 + 2] * age;
      let rot = p.rot[i];
      if (fl & F_ALIGN_VEL) rot = Math.atan2(p.vy[i], Math.hypot(p.vx[i], p.vz[i]));
      const cell = p.cell[i] + (p.frames[i] > 1 ? Math.min(p.frames[i] - 1, (age * p.frames[i]) | 0) : 0);
      const L = p.layer[i] === L_ADD ? this.lAdd : this.lAlpha;
      L.push(p.x[i], p.y[i], p.z[i], size, rot, a, cell, r, g, b2);
    }
  }

  _stepClouds(dt) {
    const pf = this.pf, L = this.lSmoke;
    for (let ci = 0; ci < this._clouds.length; ci++) {
      const h = this._clouds[ci];
      if (!h) continue;
      h.t += dt;
      if (h.t >= h.life) { this._killHandle(h, true); continue; }
      const grow = clamp01(h.t / h.grow);
      const left = h.life - h.t;
      const fade = clamp01(left / h.fade);
      const rad = h.radius * (0.22 + 0.78 * (1 - Math.pow(1 - grow, 2.4))) * (0.35 + 0.65 * fade);
      h.current = rad;
      const alpha = 0.9 * Math.pow(fade, 0.75) * Math.min(1, grow * 2.2);
      for (const i of h.puffs) {
        const stag = pf.stag[i];
        const g2 = clamp01((h.t - stag) / h.grow);
        if (g2 <= 0) continue;
        const spread = rad * (1 - Math.pow(1 - g2, 2.2));
        const t = this._now * pf.sp[i] * 0.35 + pf.ph[i];
        const wob = 0.06 * rad;
        const x = h.pos.x + pf.ox[i] * spread + Math.sin(t) * wob;
        const y = h.pos.y + pf.oy[i] * spread * 0.92 + Math.sin(t * 0.7 + 1.1) * wob * 0.5 + rad * 0.42;
        const z = h.pos.z + pf.oz[i] * spread + Math.cos(t * 1.13) * wob;
        const size = rad * pf.sz[i] * 1.15;
        const shade = 0.55 + 0.45 * clamp01((pf.oy[i] + 0.6) * 0.9);
        const c = this.col.smokeLit, d = this.col.smokeMid;
        const r = d[0] + (c[0] - d[0]) * shade;
        const g3 = d[1] + (c[1] - d[1]) * shade;
        const b = d[2] + (c[2] - d[2]) * shade;
        L.push(x, y, z, size, pf.rot[i] + this._now * pf.rv[i], alpha * pf.a[i], pf.cell[i], r, g3, b);
      }
    }
  }

  _stepFires(dt) {
    const fl = this.fl, L = this.lFlame;
    for (let fi = 0; fi < this._fires.length; fi++) {
      const h = this._fires[fi];
      if (!h) continue;
      h.t += dt;
      if (h.t >= h.life) { this._killHandle(h, true); continue; }
      const left = h.life - h.t;
      const k = Math.min(1, clamp01(h.t / 0.5)) * clamp01(left / h.fade);
      const R = h.radius * (0.5 + 0.5 * k);
      h.current = R;
      for (const i of h.tongues) {
        const t = this._now * fl.sp[i] + fl.ph[i];
        const flick = 0.62 + 0.38 * Math.sin(t) * Math.sin(t * 0.37 + 1.3);
        const hgt = fl.hgt[i] * R * flick * 1.15;
        const x = h.pos.x + fl.ox[i] * R * 0.85;
        const z = h.pos.z + fl.oz[i] * R * 0.85;
        const y = h.pos.y + hgt * 0.5;
        const hot = fl.kind[i] > 0.5;
        const c0 = hot ? this.col.fireCore : this.col.fireMid;
        const c1 = this.col.fireDeep;
        const mix = 0.35 + 0.4 * flick;
        const r = c0[0] * mix + c1[0] * (1 - mix);
        const g = c0[1] * mix + c1[1] * (1 - mix);
        const b = c0[2] * mix + c1[2] * (1 - mix);
        L.push(x, y, z, Math.max(fl.wid[i] * R * 0.9, hgt * 0.8),
          Math.sin(t * 0.6) * fl.rotb[i], 0.62 * k, C_FLAME, r, g, b);
      }
      // rising embers and black smoke
      h.ember -= dt;
      if (h.ember <= 0) {
        h.ember = 0.06 / Math.max(0.25, this.pScale);
        const a = Math.random() * TAU, rr = Math.sqrt(Math.random()) * R * 0.9;
        let s = this._spReset();
        s.x = h.pos.x + Math.cos(a) * rr; s.y = h.pos.y + 0.1; s.z = h.pos.z + Math.sin(a) * rr;
        s.vx = rand(-0.3, 0.3); s.vy = rand(1.6, 3.2); s.vz = rand(-0.3, 0.3);
        s.layer = L_ADD; s.cell = C_EMBER;
        s.life = rand(0.7, 1.5); s.s0 = rand(0.03, 0.07); s.s1 = 0.01;
        s.a = 1; s.fadeK = 1.8; s.fin = 0; s.turb = 0.8; s.flags = F_TURB; s.drag = 1.1;
        s.c0 = this.col.sparkHot; s.c1 = this.col.sparkCold;
        this._emit();
        if (Math.random() < 0.5) {
          s = this._spReset();
          s.x = h.pos.x + Math.cos(a) * rr; s.y = h.pos.y + R * 0.6; s.z = h.pos.z + Math.sin(a) * rr;
          s.vy = rand(1.1, 2.0); s.vx = rand(-0.35, 0.35); s.vz = rand(-0.35, 0.35);
          s.cell = pick(SMOKE_CELLS);
          s.life = rand(1.4, 2.6); s.s0 = R * 0.3; s.s1 = R * rand(1.1, 1.8);
          s.a = rand(0.16, 0.3); s.fadeK = 1.4; s.fin = 0.2;
          s.drag = 1.2; s.grav = -0.4; s.turb = 0.5; s.flags = F_EASE_SIZE | F_TURB;
          s.c0 = this.col.smokeDark; s.c1 = this.col.smokeBlack;
          this._emit();
        }
      }
      const light = this._fireLights[fi];
      if (light) {
        light.position.set(h.pos.x, h.pos.y + R * 0.6, h.pos.z);
        light.distance = R * 6;
        light.intensity = (26 + Math.sin(this._now * 11 + fi) * 9 + Math.sin(this._now * 27) * 4) * k * R;
      }
    }
  }

  _stepTracers(dt) {
    const tc = this.tc, L = this.lBeam;
    let live = 0;
    for (let i = 0; i < this.tracerMax; i++) {
      if (!tc.live[i]) continue;
      tc.life[i] -= dt;
      tc.travel[i] += tc.speed[i] * dt;
      const done = tc.travel[i] >= tc.total[i];
      if (tc.life[i] <= 0 || (done && tc.travel[i] > tc.total[i] + tc.trail[i])) { tc.live[i] = 0; continue; }
      live++;
      const head = Math.min(tc.travel[i], tc.total[i]);
      const tail = Math.max(0, head - tc.trail[i]);
      const i3 = i * 3;
      const a = clamp01(tc.life[i] / tc.max[i]);
      L.push(
        tc.x[i] + tc.dx[i] * tail, tc.y[i] + tc.dy[i] * tail, tc.z[i] + tc.dz[i] * tail,
        tc.x[i] + tc.dx[i] * head, tc.y[i] + tc.dy[i] * head, tc.z[i] + tc.dz[i] * head,
        tc.width[i], a, 0.35, tc.col[i3], tc.col[i3 + 1], tc.col[i3 + 2]);
    }
    this._tcN = live;
  }

  _stepRings(dt) {
    const rg = this.rg, L = this.lRing;
    for (let i = 0; i < this.ringMax; i++) {
      if (!rg.live[i]) continue;
      rg.life[i] -= dt;
      if (rg.life[i] <= 0) { rg.live[i] = 0; continue; }
      const age = 1 - rg.life[i] / rg.max[i];
      const r = rg.r0[i] + (rg.r1[i] - rg.r0[i]) * (1 - Math.pow(1 - age, 2.6));
      const a = rg.a[i] * Math.pow(1 - age, 1.5);
      const c = Math.cos(rg.rot[i]), s = Math.sin(rg.rot[i]);
      const i3 = i * 3;
      L.push(rg.x[i], rg.y[i], rg.z[i], c, 0, s, -s, 0, c, r * 2, r * 2, a, C_RING,
        rg.col[i3], rg.col[i3 + 1], rg.col[i3 + 2]);
    }
  }

  _stepDecals(dt) {
    const dc = this.dc, L = this.lDecal;
    for (let k = this._dLiveN - 1; k >= 0; k--) {
      const i = this._dLive[k];
      dc.life[i] -= dt;
      if (dc.life[i] <= 0) {
        const s = this._dSlot[i];
        const last = this._dLive[--this._dLiveN];
        this._dLive[s] = last; this._dSlot[last] = s; this._dSlot[i] = -1;
        this._dFree[this._dFreeN++] = i;
        continue;
      }
      const a = dc.a[i] * Math.min(1, dc.life[i] / Math.max(0.001, dc.fade[i]));
      const i3 = i * 3;
      L.push(dc.x[i], dc.y[i], dc.z[i], dc.rx[i], dc.ry[i], dc.rz[i], dc.ux[i], dc.uy[i], dc.uz[i],
        dc.w[i], dc.h[i], a, dc.cell[i], dc.col[i3], dc.col[i3 + 1], dc.col[i3 + 2]);
    }
  }

  _stepCasings(dt) {
    const cs = this.cs;
    for (let i = 0; i < this.casingMax; i++) {
      if (!cs.live[i]) continue;
      cs.life[i] -= dt;
      if (cs.life[i] <= 0) { cs.live[i] = 0; this._csHide(i); continue; }
      if (cs.rest[i] < 1) {
        cs.vy[i] -= 15.2 * dt;
        let nx = cs.x[i] + cs.vx[i] * dt, ny = cs.y[i] + cs.vy[i] * dt, nz = cs.z[i] + cs.vz[i] * dt;
        const dx = nx - cs.x[i], dy = ny - cs.y[i], dz = nz - cs.z[i];
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (len > 1e-5) {
          const hit = this._trace(cs.x[i], cs.y[i], cs.z[i], dx / len, dy / len, dz / len, len + 0.02);
          if (hit) {
            nx = hit.px + hit.nx * 0.008; ny = hit.py + hit.ny * 0.008; nz = hit.pz + hit.nz * 0.008;
            const vn = cs.vx[i] * hit.nx + cs.vy[i] * hit.ny + cs.vz[i] * hit.nz;
            cs.vx[i] = (cs.vx[i] - 2 * vn * hit.nx) * 0.32;
            cs.vy[i] = (cs.vy[i] - 2 * vn * hit.ny) * 0.32;
            cs.vz[i] = (cs.vz[i] - 2 * vn * hit.nz) * 0.32;
            cs.wx[i] *= 0.5; cs.wy[i] *= 0.5; cs.wz[i] *= 0.5;
            cs.bounces[i]++;
            if (cs.bounces[i] > 2 || Math.abs(cs.vy[i]) < 0.35) cs.rest[i] = 1;
          }
        }
        cs.x[i] = nx; cs.y[i] = ny; cs.z[i] = nz;
        const i4 = i * 4;
        this._q1.set(cs.quat[i4], cs.quat[i4 + 1], cs.quat[i4 + 2], cs.quat[i4 + 3]);
        this._q2 = this._q2 || new THREE.Quaternion();
        const wl = Math.hypot(cs.wx[i], cs.wy[i], cs.wz[i]);
        if (wl > 1e-4) {
          this._q2.setFromAxisAngle(this._v1.set(cs.wx[i] / wl, cs.wy[i] / wl, cs.wz[i] / wl), wl * dt);
          this._q1.multiply(this._q2).normalize();
          cs.quat[i4] = this._q1.x; cs.quat[i4 + 1] = this._q1.y;
          cs.quat[i4 + 2] = this._q1.z; cs.quat[i4 + 3] = this._q1.w;
        }
      }
      const i4b = i * 4;
      this._q1.set(cs.quat[i4b], cs.quat[i4b + 1], cs.quat[i4b + 2], cs.quat[i4b + 3]);
      const fade = Math.min(1, cs.life[i] / 0.6);
      this._m4.compose(this._v1.set(cs.x[i], cs.y[i], cs.z[i]), this._q1,
        this._v2.set(fade, fade, fade));
      this.casingMesh.setMatrixAt(i, this._m4);
      this._csDirty = true;
    }
  }

  _stepLights(dt) {
    if (!this._lightPool) return;
    for (const l of [...this._lightPool.used]) {
      const fx = l._fx;
      fx.life -= dt;
      if (fx.life <= 0) { l.intensity = 0; fx.kind = ''; this._lightPool.put(l); continue; }
      const k = clamp01(fx.life / fx.max);
      l.intensity = fx.i0 * (fx.kind === 'muzzle' ? k : Math.pow(k, 1.6));
    }
  }

  _stepShake(dt) {
    const sk = this._sk, sh = this._shake;
    if (sk.amp <= 0.0002) { sh.pitch = sh.yaw = sh.roll = 0; sk.amp = 0; return; }
    sk.amp = Math.max(0, sk.amp - sk.dec * sk.amp * dt * 2.4);
    sk.ph += dt * 42;
    const a = sk.amp * 0.022;
    sh.pitch = Math.sin(sk.ph) * a;
    sh.yaw = Math.sin(sk.ph * 0.77 + 1.9) * a * 0.85;
    sh.roll = Math.sin(sk.ph * 0.53 + 0.6) * a * 0.7;
  }
}

export default Effects;
