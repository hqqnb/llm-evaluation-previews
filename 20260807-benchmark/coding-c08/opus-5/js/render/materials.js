// ============================================================================
// render/materials.js — procedural material library + sky / sun rig.
//
// Every surface in the game is painted at runtime with canvas 2D and uploaded
// as a THREE.CanvasTexture: a seamlessly tiling colour map, a normal map
// derived from a matching height field, and a packed roughness/metalness map.
// Nothing is ever loaded from disk or network.
//
// UV convention: mapmesh.js writes *world scaled* UVs (metres / texScale), so
// every texture keeps `repeat = (1,1)` and relies on RepeatWrapping instead.
// Materials are created with `vertexColors = true` because mapmesh bakes cheap
// ambient occlusion and the per-brush tint into the geometry colour attribute.
//
// `document` is only touched inside functions, so this module imports cleanly
// in Node — headless callers simply get flat-colour materials.
// ============================================================================

import * as THREE from 'three';
import { MAT, QUALITY } from '../core/constants.js';
import { clamp, clamp01, lerp, TAU, makeRng } from '../core/util.js';

/**
 * Per-material look-up used by both this module and mapmesh.js.
 *   texScale  world metres covered by one texture tile
 *   roughness / metalness   mean PBR values (the maps modulate around these)
 *   color     representative albedo — the flat colour used when no canvas is
 *             available; with textures the material tint is white
 *   bump      normal map strength multiplier
 * @type {Object<string,{texScale:number,roughness:number,metalness:number,color:number,bump:number}>}
 */
export const MATERIAL_INFO = {
  [MAT.SAND_WALL]: { texScale: 2.4, roughness: 0.92, metalness: 0.0, color: 0xc9b189, bump: 0.9 },
  [MAT.SAND_TRIM]: { texScale: 1.2, roughness: 0.88, metalness: 0.0, color: 0xb0894e, bump: 1.0 },
  [MAT.SAND_FLOOR]: { texScale: 4.0, roughness: 0.96, metalness: 0.0, color: 0xc6aa7c, bump: 0.75 },
  [MAT.STONE]: { texScale: 2.6, roughness: 0.9, metalness: 0.0, color: 0x9c9384, bump: 1.15 },
  [MAT.CONCRETE]: { texScale: 3.0, roughness: 0.86, metalness: 0.0, color: 0x8e8d88, bump: 0.85 },
  [MAT.BRICK]: { texScale: 2.0, roughness: 0.9, metalness: 0.0, color: 0xa87a55, bump: 1.25 },
  [MAT.PLASTER]: { texScale: 2.8, roughness: 0.8, metalness: 0.0, color: 0xd8d1bd, bump: 0.55 },
  [MAT.WOOD]: { texScale: 1.6, roughness: 0.78, metalness: 0.0, color: 0x8a6236, bump: 0.8 },
  [MAT.CRATE]: { texScale: 1.2, roughness: 0.8, metalness: 0.02, color: 0x9a7038, bump: 0.9 },
  [MAT.METAL]: { texScale: 1.4, roughness: 0.42, metalness: 0.85, color: 0x8f9499, bump: 0.5 },
  [MAT.METAL_RUST]: { texScale: 1.3, roughness: 0.7, metalness: 0.5, color: 0x7d6552, bump: 0.85 },
  [MAT.DOOR]: { texScale: 1.5, roughness: 0.74, metalness: 0.12, color: 0x7d5c38, bump: 1.0 },
  [MAT.GRATE]: { texScale: 1.0, roughness: 0.55, metalness: 0.6, color: 0x6f6c66, bump: 1.2 },
  [MAT.TILE]: { texScale: 2.0, roughness: 0.55, metalness: 0.03, color: 0xb9ac96, bump: 0.7 },
  [MAT.ROOF]: { texScale: 1.8, roughness: 0.82, metalness: 0.0, color: 0xa25436, bump: 1.3 },
  [MAT.CANVAS]: { texScale: 1.6, roughness: 0.95, metalness: 0.0, color: 0xb49b72, bump: 0.8 },
  [MAT.SANDBAG]: { texScale: 0.9, roughness: 0.96, metalness: 0.0, color: 0xa89268, bump: 1.4 },
  [MAT.RUG]: { texScale: 1.4, roughness: 0.94, metalness: 0.0, color: 0x8d3b2e, bump: 0.5 },
  [MAT.GLASS]: { texScale: 2.2, roughness: 0.09, metalness: 0.1, color: 0xcfe0e4, bump: 0.25 },
  [MAT.DIRT]: { texScale: 3.2, roughness: 0.97, metalness: 0.0, color: 0x54412e, bump: 1.1 },
  [MAT.ASPHALT]: { texScale: 3.4, roughness: 0.88, metalness: 0.0, color: 0x4e4e50, bump: 0.9 },
  [MAT.PAINT_RED]: { texScale: 2.6, roughness: 0.72, metalness: 0.0, color: 0x9c3a30, bump: 0.7 },
  [MAT.PAINT_BLUE]: { texScale: 2.6, roughness: 0.72, metalness: 0.0, color: 0x2f5f8c, bump: 0.7 },
};

// Spread of the packed rough/metal map around each material's mean value:
// the map is normalised so its average is exactly MATERIAL_INFO.roughness /
// .metalness, which lets the material keep 1.0 in those slots.
const DEFAULT_ROUGH_SPREAD = 0.2;
const DEFAULT_METAL_SPREAD = 0.16;

// ---------------------------------------------------------------------------
// canvas plumbing — every `document` touch lives inside a function
// ---------------------------------------------------------------------------
const hasDOM = () => typeof document !== 'undefined' && typeof document.createElement === 'function';

function makeCanvas(w, h) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h === undefined ? w : h;
  return cv;
}
function ctxOf(cv) { return cv && cv.getContext ? cv.getContext('2d') : null; }

const rgba = (r, g, b, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;
/** Neutral height grey is 128; brighter = higher. */
const grey = (v, a = 1) => `rgba(${v | 0},${v | 0},${v | 0},${a})`;
/** Blend two 0xrrggbb values into a css colour. */
function mixHex(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return rgba(lerp(ar, br, t), lerp(ag, bg, t), lerp(ab, bb, t), 1);
}

/**
 * Call `fn(px,py)` once per wrapped copy of a primitive of radius `r` centred
 * at (x,y): anything crossing a tile border is drawn again on the opposite
 * side, which is what keeps every texture seamless.  Callers must not consume
 * randomness inside `fn` — every copy has to be identical.
 */
function tiled(W, H, x, y, r, fn) {
  const xs = [x], ys = [y];
  if (x - r < 0) xs.push(x + W);
  if (x + r > W) xs.push(x - W);
  if (y - r < 0) ys.push(y + H);
  if (y + r > H) ys.push(y - H);
  for (let i = 0; i < xs.length; i++) for (let j = 0; j < ys.length; j++) fn(xs[i], ys[j]);
}

/** Wrapped soft radial blob — the workhorse for mottling and stains. */
function blob(c, W, H, x, y, r, cr, cg, cb, a) {
  tiled(W, H, x, y, r, (px, py) => {
    const g = c.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, rgba(cr, cg, cb, a));
    g.addColorStop(0.6, rgba(cr, cg, cb, a * 0.42));
    g.addColorStop(1, rgba(cr, cg, cb, 0));
    c.fillStyle = g;
    c.beginPath(); c.arc(px, py, r, 0, TAU); c.fill();
  });
}

/** Wrapped filled rect (x,y = top-left). */
function rectT(c, W, H, x, y, w, h) {
  const r = Math.max(w, h) * 0.5 + 1;
  tiled(W, H, x + w * 0.5, y + h * 0.5, r, (px, py) => c.fillRect(px - w * 0.5, py - h * 0.5, w, h));
}

/** Wrapped circle. */
function discT(c, W, H, x, y, r) {
  tiled(W, H, x, y, r + 1, (px, py) => { c.beginPath(); c.arc(px, py, r, 0, TAU); c.fill(); });
}

/**
 * Wrapped free-form drawing: `draw()` paints in absolute canvas coordinates
 * anchored around (ax,ay) and is replayed translated for each wrapped copy.
 */
function pathT(c, W, H, ax, ay, rad, draw) {
  tiled(W, H, ax, ay, rad, (px, py) => {
    c.save(); c.translate(px - ax, py - ay); draw(); c.restore();
  });
}

/** Bounding radius of a point list around (ax,ay) — feeds pathT's wrap test. */
function pathRadius(pts, ax, ay, pad = 3) {
  let r = 0;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - ax, pts[i][1] - ay);
    if (d > r) r = d;
  }
  return r + pad;
}

/** Wobbly radii for a lump, precomputed so colour and height agree exactly. */
function lumpR(r, R, wob = 0.42, n = 11) {
  const a = [];
  for (let i = 0; i < n; i++) a.push(r * (1 - wob + R() * wob * 2));
  return a;
}

/** Irregular closed lump (chips, clods, rust blooms) from shared radii. */
function lump(c, W, H, x, y, radii, fill) {
  const n = radii.length;
  let max = 0;
  for (let i = 0; i < n; i++) if (radii[i] > max) max = radii[i];
  tiled(W, H, x, y, max + 2, (px, py) => {
    c.fillStyle = fill;
    c.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU, k = radii[i % n];
      const qx = px + Math.cos(a) * k, qy = py + Math.sin(a) * k;
      if (i === 0) c.moveTo(qx, qy); else c.lineTo(qx, qy);
    }
    c.closePath(); c.fill();
  });
}

/** Horizontal wavy band across the whole tile (integer wave count ⇒ wraps). */
function bandH(c, W, H, y, w, col, k, amp) {
  c.strokeStyle = col; c.lineWidth = w;
  const draw = (yy) => {
    c.beginPath();
    for (let x = 0; x <= W; x += 8) c.lineTo(x, yy + Math.sin((x / W) * TAU * k) * amp);
    c.stroke();
  };
  draw(y);
  if (y - w * 0.5 - amp < 0) draw(y + H);
  if (y + w * 0.5 + amp > H) draw(y - H);
}

/** Vertical wavy band across the whole tile. */
function bandV(c, W, H, x, w, col, k, amp) {
  c.strokeStyle = col; c.lineWidth = w;
  const draw = (xx) => {
    c.beginPath();
    for (let y = 0; y <= H; y += 8) c.lineTo(xx + Math.sin((y / H) * TAU * k) * amp, y);
    c.stroke();
  };
  draw(x);
  if (x - w * 0.5 - amp < 0) draw(x + W);
  if (x + w * 0.5 + amp > W) draw(x - W);
}

/**
 * Fine grain overlay: one small noise tile blitted as a repeating pattern, so
 * it costs a few thousand pixels instead of W*H.  `tile` must divide W and H.
 */
function grain(c, W, H, tile, lo, hi, alpha, R, mode = 'overlay') {
  const cv = makeCanvas(tile, tile);
  const tc = ctxOf(cv);
  if (!tc) return;
  const img = tc.createImageData(tile, tile);
  const d = img.data;
  for (let i = 0; i < tile * tile; i++) {
    const v = (lo + R() * (hi - lo)) | 0;
    d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
  }
  tc.putImageData(img, 0, 0);
  const pat = c.createPattern(cv, 'repeat');
  if (!pat) return;
  c.save();
  c.globalAlpha = alpha;
  c.globalCompositeOperation = mode;
  c.fillStyle = pat;
  c.fillRect(0, 0, W, H);
  c.restore();
}

/**
 * Scattered wrapped specks (pebbles, aggregate, grit).  Every context in
 * `ctxs` gets the same speck at the same place, so the colour map and the
 * height field stay in register; `colFns[i]` maps a shared 0..1 tone to a fill.
 */
function specks(ctxs, W, H, n, sMin, sMax, colFns, R) {
  for (let i = 0; i < n; i++) {
    const x = R() * W, y = R() * H;
    const w = sMin + R() * (sMax - sMin);
    const hh = w * (0.7 + R() * 0.6);
    const t = R();
    for (let k = 0; k < ctxs.length; k++) {
      ctxs[k].fillStyle = colFns[k](t, i);
      rectT(ctxs[k], W, H, x, y, w, hh);
    }
  }
}

// ---------------------------------------------------------------------------
// height field → normal / roughness
// ---------------------------------------------------------------------------
/**
 * Sobel a greyscale height canvas into an OpenGL-style tangent space normal
 * map canvas.  Sampling wraps, so a seamless height field yields a seamless
 * normal map.  Green is +Y in UV space, which with three.js' default
 * `flipY = true` means +dHeight/dy in canvas space.
 * @param {HTMLCanvasElement} canvas greyscale height field
 * @param {number} [strength] slope multiplier
 * @returns {HTMLCanvasElement} RGB normal map
 */
export function heightToNormal(canvas, strength = 1) {
  const W = canvas.width, H = canvas.height;
  const src = ctxOf(canvas).getImageData(0, 0, W, H).data;
  const lum = new Float32Array(W * H);
  for (let i = 0, n = W * H; i < n; i++) {
    lum[i] = (src[i * 4] * 0.299 + src[i * 4 + 1] * 0.587 + src[i * 4 + 2] * 0.114) / 255;
  }
  const out = makeCanvas(W, H);
  const oc = ctxOf(out);
  const img = oc.createImageData(W, H);
  const d = img.data;
  const k = strength * 1.2;
  for (let y = 0; y < H; y++) {
    const yUp = (y === 0 ? H - 1 : y - 1) * W;
    const yDn = (y === H - 1 ? 0 : y + 1) * W;
    const yc = y * W;
    for (let x = 0; x < W; x++) {
      const xl = x === 0 ? W - 1 : x - 1;
      const xr = x === W - 1 ? 0 : x + 1;
      // 3x3 sobel for a smoother field than a plain central difference
      const dx = (lum[yUp + xr] + 2 * lum[yc + xr] + lum[yDn + xr])
        - (lum[yUp + xl] + 2 * lum[yc + xl] + lum[yDn + xl]);
      const dy = (lum[yDn + xl] + 2 * lum[yDn + x] + lum[yDn + xr])
        - (lum[yUp + xl] + 2 * lum[yUp + x] + lum[yUp + xr]);
      let nx = -dx * k, ny = dy * k, nz = 1;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      nx *= inv; ny *= inv; nz *= inv;
      const i = (yc + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  oc.putImageData(img, 0, 0);
  return out;
}

/**
 * Pack roughness (green) and metalness (blue) from the same height field:
 * raised, polished spots read smoother and more metallic, crevices rougher and
 * duller (rust, dust and mortar collect there).  The channels are centred on
 * the material's mean values, so the material itself keeps roughness /
 * metalness at 1.0 and the map alone decides the look.  Rendered at half
 * resolution — gloss variation never needs the detail the colour map does.
 */
function packRoughMetal(heightCanvas, size, rTarget, rSpread, mTarget, mSpread) {
  const small = makeCanvas(size, size);
  const sc = ctxOf(small);
  sc.drawImage(heightCanvas, 0, 0, size, size);
  const img = sc.getImageData(0, 0, size, size);
  const d = img.data;
  const n = size * size;
  const lum = new Float32Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) {
    const l = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) / 255;
    lum[i] = l; mean += l;
  }
  mean /= n || 1;
  for (let i = 0; i < n; i++) {
    const k = mean - lum[i];                             // >0 in crevices
    d[i * 4] = 255;                                      // unused (red)
    d[i * 4 + 1] = clamp(rTarget + k * rSpread * 2, 0.02, 1) * 255;
    d[i * 4 + 2] = clamp(mTarget - k * mSpread * 2, 0, 1) * 255;
    d[i * 4 + 3] = 255;
  }
  sc.putImageData(img, 0, 0);
  return small;
}

// ---------------------------------------------------------------------------
// painters — each fills the colour context `c` and the height context `h`
// with the same features so the normal map always agrees with the albedo.
// `R()` is a deterministic 0..1 generator: textures look identical every run.
// ---------------------------------------------------------------------------

/** Pale sand plaster with trowel bands and chips showing mud brick beneath. */
function paintSandWall(c, h, W, H, R) {
  c.fillStyle = '#c9b189'; c.fillRect(0, 0, W, H);
  h.fillStyle = grey(142); h.fillRect(0, 0, W, H);
  for (let i = 0; i < 74; i++) {                        // mottled patches
    const x = R() * W, y = R() * H, r = 24 + R() * 76, up = R() < 0.5, a = 0.05 + R() * 0.15;
    blob(c, W, H, x, y, r, up ? 219 : 163, up ? 202 : 141, up ? 170 : 108, a);
    blob(h, W, H, x, y, r, up ? 176 : 110, up ? 176 : 110, up ? 176 : 110, a * 0.85);
  }
  for (let i = 0; i < 15; i++) {                        // trowel bands
    const y = (i + 0.15 + R() * 0.7) * (H / 15), w = 4 + R() * 15;
    const k = 1 + ((i * 7) % 3), amp = 1.5 + R() * 5, dark = R() < 0.55;
    bandH(c, W, H, y, w, rgba(dark ? 152 : 214, dark ? 134 : 199, dark ? 104 : 168, 0.09 + R() * 0.07), k, amp);
    bandH(h, W, H, y, w, grey(dark ? 118 : 168, 0.16), k, amp);
  }
  for (let i = 0; i < 9; i++) {                         // chips showing mud brick
    const x = R() * W, y = R() * H, r = 7 + R() * 17;
    const outer = lumpR(r, R, 0.5), inner = lumpR(r * 0.62, R, 0.45);
    lump(h, W, H, x, y, outer, grey(88));
    lump(c, W, H, x, y, outer, mixHex(0x9c7548, 0x7f5c38, R()));
    lump(c, W, H, x + 1, y + 1.5, inner, rgba(120, 88, 54, 0.75));
    lump(h, W, H, x + 1, y + 1.5, inner, grey(70, 0.8));
    pathT(c, W, H, x, y, r + 3, () => {                 // bright chipped rim
      c.strokeStyle = 'rgba(233,220,192,0.55)'; c.lineWidth = 1.4;
      c.beginPath(); c.arc(x, y - 1, r * 0.92, Math.PI * 1.05, Math.PI * 1.95); c.stroke();
    });
  }
  grain(c, W, H, 64, 96, 158, 0.4, R);
  grain(h, W, H, 64, 108, 148, 0.5, R);
}

/** Darker ochre trim: stacked bands separated by shallow grooves. */
function paintSandTrim(c, h, W, H, R) {
  c.fillStyle = '#b0894e'; c.fillRect(0, 0, W, H);
  h.fillStyle = grey(150); h.fillRect(0, 0, W, H);
  const rows = 4, bh = H / rows;
  for (let i = 0; i < rows; i++) {
    const y = i * bh, t = R();
    c.fillStyle = mixHex(0xbd9558, 0x96712f, t);
    rectT(c, W, H, 0, y + 3, W, bh - 6);
    h.fillStyle = grey(168 + t * 20);
    rectT(h, W, H, 0, y + 3, W, bh - 6);
    c.fillStyle = 'rgba(255,238,198,0.13)'; rectT(c, W, H, 0, y + 3, W, 3);
    c.fillStyle = 'rgba(50,32,12,0.30)'; rectT(c, W, H, 0, y + bh - 6, W, 3);
    h.fillStyle = grey(96); rectT(h, W, H, 0, y - 3, W, 6);   // groove
    c.fillStyle = 'rgba(58,38,16,0.42)'; rectT(c, W, H, 0, y - 3, W, 6);
  }
  for (let i = 0; i < 30; i++) {                        // weathering
    const x = R() * W, y = R() * H, r = 12 + R() * 40, up = R() < 0.45;
    blob(c, W, H, x, y, r, up ? 206 : 118, up ? 178 : 92, up ? 120 : 50, 0.06 + R() * 0.12);
    blob(h, W, H, x, y, r, up ? 172 : 122, up ? 172 : 122, up ? 172 : 122, 0.1);
  }
  grain(c, W, H, 64, 100, 156, 0.36, R);
  grain(h, W, H, 64, 112, 146, 0.42, R);
}

/** Compacted desert sand: soft patches, pebbles, dark grains, drag marks. */
function paintSandFloor(c, h, W, H, R) {
  c.fillStyle = '#c6aa7c'; c.fillRect(0, 0, W, H);
  h.fillStyle = grey(138); h.fillRect(0, 0, W, H);
  for (let i = 0; i < 60; i++) {                        // wind-blown patches
    const x = R() * W, y = R() * H, r = 30 + R() * 90, up = R() < 0.5;
    blob(c, W, H, x, y, r, up ? 214 : 158, up ? 194 : 134, up ? 152 : 96, 0.05 + R() * 0.13);
    blob(h, W, H, x, y, r, up ? 162 : 116, up ? 162 : 116, up ? 162 : 116, 0.12);
  }
  for (let i = 0; i < 14; i++) {                        // drag marks
    const y = R() * H, k = 1 + ((i * 5) % 3), amp = 3 + R() * 10, w = 2 + R() * 5;
    bandH(c, W, H, y, w, rgba(150, 126, 92, 0.10 + R() * 0.08), k, amp);
    bandH(h, W, H, y, w, grey(112, 0.2), k, amp);
  }
  specks([c, h], W, H, 210, 1.6, 4.4,                                        // pebbles
    [(t) => mixHex(0xa89272, 0x6d5c46, t), () => grey(196)], R);
  specks([c], W, H, 520, 0.8, 1.9,                                           // dark grains
    [(t) => (t < 0.6 ? 'rgba(74,58,38,0.7)' : 'rgba(226,208,172,0.6)')], R);
  grain(c, W, H, 64, 92, 162, 0.46, R);
  grain(h, W, H, 64, 104, 152, 0.55, R);
}

/**
 * Hand-made brick / block courses with mortar joints — shared by MAT.BRICK
 * (small warm mud bricks) and MAT.STONE (bigger, cooler blocks).
 */
function paintBricks(c, h, W, H, R, o) {
  const rows = o.rows, cols = o.cols, gap = o.gap;
  c.fillStyle = o.mortar; c.fillRect(0, 0, W, H);
  h.fillStyle = grey(o.mortarH); h.fillRect(0, 0, W, H);
  grain(c, W, H, 64, 108, 150, 0.3, R);
  const bh = H / rows, bw = W / cols;
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < cols; i++) {
      const t = R();
      const jx = (R() - 0.5) * o.jitter, jy = (R() - 0.5) * o.jitter;
      const bx = i * bw + (r % 2) * bw * 0.5 + gap * 0.5 + jx;
      const by = r * bh + gap * 0.5 + jy;
      const bwi = bw - gap, bhi = bh - gap;
      c.fillStyle = mixHex(o.c0, o.c1, t);
      rectT(c, W, H, bx, by, bwi, bhi);
      c.fillStyle = rgba(255, 246, 226, 0.09); rectT(c, W, H, bx, by, bwi, 2.5);
      c.fillStyle = rgba(0, 0, 0, 0.16); rectT(c, W, H, bx, by + bhi - 3, bwi, 3);
      const hv = lerp(o.brickH0, o.brickH1, t);
      h.fillStyle = grey(hv); rectT(h, W, H, bx, by, bwi, bhi);
      h.fillStyle = grey(hv + 18, 0.55); rectT(h, W, H, bx + 2.5, by + 2.5, bwi - 5, bhi - 5);
    }
  }
  for (let i = 0; i < 46; i++) {                         // dirt wash + chipped bricks
    const x = R() * W, y = R() * H, r = 9 + R() * 34, up = R() < 0.4;
    blob(c, W, H, x, y, r, up ? 224 : 92, up ? 210 : 74, up ? 182 : 52, 0.05 + R() * 0.12);
    blob(h, W, H, x, y, r, up ? 158 : 116, up ? 158 : 116, up ? 158 : 116, 0.1);
  }
  for (let i = 0; i < 7; i++) {
    const x = R() * W, y = R() * H, r = 3 + R() * 7;
    const rr = lumpR(r, R, 0.5);
    lump(c, W, H, x, y, rr, 'rgba(96,74,52,0.8)');
    lump(h, W, H, x, y, rr, grey(92, 0.9));
  }
  grain(h, W, H, 64, 116, 142, 0.4, R);
}

/** Grey concrete: aggregate speckle, pitting and hairline cracks. */
function paintConcrete(c, h, W, H, R, base = '#8e8d88', hbase = 148) {
  c.fillStyle = base; c.fillRect(0, 0, W, H);
  h.fillStyle = grey(hbase); h.fillRect(0, 0, W, H);
  for (let i = 0; i < 56; i++) {                         // pour patches / stains
    const x = R() * W, y = R() * H, r = 22 + R() * 84, up = R() < 0.5;
    blob(c, W, H, x, y, r, up ? 178 : 106, up ? 177 : 105, up ? 172 : 100, 0.05 + R() * 0.13);
    blob(h, W, H, x, y, r, up ? 166 : 126, up ? 166 : 126, up ? 166 : 126, 0.1);
  }
  specks([c, h], W, H, 380, 1.2, 3.6, [
    (t) => (t < 0.5 ? 'rgba(214,212,204,0.55)' : 'rgba(78,77,74,0.5)'),
    (t) => grey(t < 0.5 ? 186 : 120),
  ], R);
  for (let i = 0; i < 34; i++) {                         // pitting
    const x = R() * W, y = R() * H, r = 1.6 + R() * 4.4;
    c.fillStyle = 'rgba(52,52,50,0.55)'; discT(c, W, H, x, y, r);
    h.fillStyle = grey(84); discT(h, W, H, x, y, r);
    h.fillStyle = grey(178, 0.5); discT(h, W, H, x - r * 0.4, y - r * 0.5, r * 0.6);
  }
  for (let i = 0; i < 8; i++) {                          // hairline cracks
    const sx = R() * W, sy = R() * H, seg = 8 + ((R() * 7) | 0);
    const pts = [[sx, sy]];
    let a = R() * TAU;
    for (let s = 0; s < seg; s++) {
      a += (R() - 0.5) * 1.1;
      const l = 5 + R() * 16;
      const p = pts[pts.length - 1];
      pts.push([p[0] + Math.cos(a) * l, p[1] + Math.sin(a) * l]);
    }
    const rad = pathRadius(pts, sx, sy);
    const stroke = (ctx, col, w) => pathT(ctx, W, H, sx, sy, rad, () => {
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      for (let s = 1; s < pts.length; s++) ctx.lineTo(pts[s][0], pts[s][1]);
      ctx.stroke();
    });
    stroke(c, 'rgba(46,46,44,0.5)', 1.3);
    stroke(h, grey(78, 0.85), 1.6);
  }
  grain(c, W, H, 64, 100, 156, 0.38, R);
  grain(h, W, H, 64, 112, 146, 0.45, R);
}

/** Asphalt: dark bitumen with a dense gravel speckle and faded patches. */
function paintAsphalt(c, h, W, H, R) {
  c.fillStyle = '#4e4e50'; c.fillRect(0, 0, W, H);
  h.fillStyle = grey(132); h.fillRect(0, 0, W, H);
  for (let i = 0; i < 40; i++) {
    const x = R() * W, y = R() * H, r = 26 + R() * 80, up = R() < 0.55;
    blob(c, W, H, x, y, r, up ? 122 : 44, up ? 122 : 44, up ? 124 : 46, 0.06 + R() * 0.14);
    blob(h, W, H, x, y, r, up ? 156 : 116, up ? 156 : 116, up ? 156 : 116, 0.12);
  }
  specks([c, h], W, H, 900, 1.2, 3.8, [
    (t) => (t < 0.4 ? 'rgba(150,148,142,0.6)' : t < 0.75 ? 'rgba(96,94,92,0.6)' : 'rgba(30,30,32,0.6)'),
    (t) => grey(t < 0.4 ? 182 : t < 0.75 ? 140 : 104),
  ], R);
  for (let i = 0; i < 5; i++) {                          // tar seams
    const y = R() * H, k = 1 + ((i * 3) % 2);
    bandH(c, W, H, y, 3 + R() * 4, 'rgba(24,24,26,0.55)', k, 2 + R() * 5);
    bandH(h, W, H, y, 3 + R() * 4, grey(150, 0.4), k, 3);
  }
  grain(c, W, H, 64, 104, 150, 0.5, R);
  grain(h, W, H, 64, 116, 142, 0.5, R);
}

/** Off-white plaster with stains and water streaks running down. */
function paintPlaster(c, h, W, H, R) {
  c.fillStyle = '#d8d1bd'; c.fillRect(0, 0, W, H);
  h.fillStyle = grey(150); h.fillRect(0, 0, W, H);
  for (let i = 0; i < 46; i++) {                          // stains
    const x = R() * W, y = R() * H, r = 20 + R() * 92, warm = R() < 0.6;
    blob(c, W, H, x, y, r, warm ? 168 : 224, warm ? 148 : 222, warm ? 116 : 210, 0.04 + R() * 0.12);
    blob(h, W, H, x, y, r, warm ? 138 : 162, warm ? 138 : 162, warm ? 138 : 162, 0.08);
  }
  for (let i = 0; i < 16; i++) {                          // water streaks
    const x = R() * W, w = 5 + R() * 22, len = H * (0.35 + R() * 0.65), top = R() * H * 0.4;
    const rad = Math.max(w, len) * 0.5 + 3;
    pathT(c, W, H, x, top + len * 0.5, rad, () => {
      const g = c.createLinearGradient(0, top, 0, top + len);
      g.addColorStop(0, 'rgba(122,108,82,0.30)');
      g.addColorStop(0.35, 'rgba(140,124,96,0.16)');
      g.addColorStop(1, 'rgba(150,134,104,0)');
      c.fillStyle = g; c.fillRect(x - w * 0.5, top, w, len);
    });
    pathT(h, W, H, x, top + len * 0.5, rad, () => {
      h.fillStyle = grey(134, 0.25); h.fillRect(x - w * 0.5, top, w, len);
    });
  }
  for (let i = 0; i < 6; i++) {                           // flaking edges
    const x = R() * W, y = R() * H, r = 6 + R() * 20;
    const rr = lumpR(r, R, 0.5);
    lump(c, W, H, x, y, rr, 'rgba(186,172,142,0.55)');
    lump(h, W, H, x, y, rr, grey(120, 0.7));
  }
  grain(c, W, H, 64, 112, 146, 0.3, R);
  grain(h, W, H, 64, 118, 140, 0.35, R);
}

/**
 * Plank run with grain, knots and nail heads.  `vertical` swaps the plank
 * direction; shared by wood, crates and doors.
 */
function paintPlanks(c, h, W, H, R, o) {
  const n = o.planks, vert = !!o.vertical;
  const span = (vert ? W : H) / n;
  c.fillStyle = o.gapCol; c.fillRect(0, 0, W, H);
  h.fillStyle = grey(96); h.fillRect(0, 0, W, H);
  for (let i = 0; i < n; i++) {
    const t = R();
    const p0 = i * span + o.gap * 0.5, len = span - o.gap;
    const col = mixHex(o.c0, o.c1, t);
    const put = (ctx, style) => {
      ctx.fillStyle = style;
      if (vert) rectT(ctx, W, H, p0, 0, len, H); else rectT(ctx, W, H, 0, p0, W, len);
    };
    put(c, col);
    put(h, grey(lerp(o.h0, o.h1, t)));
    // grain streaks along the plank
    for (let s = 0; s < 26; s++) {
      const off = p0 + R() * len, k = 1 + ((s * 3) % 4), amp = 1 + R() * 3.5;
      const dark = R() < 0.62;
      const col2 = dark ? rgba(58, 38, 18, 0.10 + R() * 0.16) : rgba(226, 196, 148, 0.07 + R() * 0.1);
      if (vert) bandV(c, W, H, off, 0.7 + R() * 2.6, col2, k, amp);
      else bandH(c, W, H, off, 0.7 + R() * 2.6, col2, k, amp);
      if (vert) bandV(h, W, H, off, 1 + R() * 2, grey(dark ? 108 : 168, 0.2), k, amp);
      else bandH(h, W, H, off, 1 + R() * 2, grey(dark ? 108 : 168, 0.2), k, amp);
    }
    // edge shading so each plank reads as a separate board
    const lo = vert ? [p0, 0, 2.5, H] : [0, p0, W, 2.5];
    const hi = vert ? [p0 + len - 2.5, 0, 2.5, H] : [0, p0 + len - 2.5, W, 2.5];
    c.fillStyle = 'rgba(255,232,192,0.10)'; rectT(c, W, H, lo[0], lo[1], lo[2], lo[3]);
    c.fillStyle = 'rgba(28,16,6,0.28)'; rectT(c, W, H, hi[0], hi[1], hi[2], hi[3]);
    // knots
    const knots = o.knots === undefined ? 1 : o.knots;
    for (let s = 0; s < knots; s++) {
      if (R() > 0.7) continue;
      const a = p0 + 6 + R() * (len - 12), b = R() * (vert ? H : W);
      const kx = vert ? a : b, ky = vert ? b : a, kr = 3 + R() * 5;
      c.fillStyle = 'rgba(52,32,14,0.85)'; discT(c, W, H, kx, ky, kr);
      c.fillStyle = 'rgba(92,62,30,0.7)'; discT(c, W, H, kx, ky, kr * 0.55);
      h.fillStyle = grey(78); discT(h, W, H, kx, ky, kr);
      h.fillStyle = grey(140); discT(h, W, H, kx, ky, kr * 0.45);
    }
  }
  if (o.nails) {                                          // nail heads
    for (let i = 0; i < o.nails; i++) {
      const x = R() * W, y = R() * H, r = 1.8 + R() * 1.2;
      c.fillStyle = 'rgba(72,70,66,0.9)'; discT(c, W, H, x, y, r);
      c.fillStyle = 'rgba(186,186,180,0.5)'; discT(c, W, H, x - r * 0.3, y - r * 0.35, r * 0.5);
      h.fillStyle = grey(190); discT(h, W, H, x, y, r);
      h.fillStyle = grey(120); discT(h, W, H, x, y, r * 0.35);
    }
  }
  for (let i = 0; i < 26; i++) {                          // wear and dirt
    const x = R() * W, y = R() * H, r = 10 + R() * 44, up = R() < 0.4;
    blob(c, W, H, x, y, r, up ? 214 : 60, up ? 184 : 44, up ? 132 : 26, 0.05 + R() * 0.1);
  }
  grain(c, W, H, 64, 106, 152, 0.34, R);
  grain(h, W, H, 64, 116, 142, 0.4, R);
}

/** Bare timber. */
function paintWood(c, h, W, H, R) {
  paintPlanks(c, h, W, H, R, {
    planks: 4, gap: 5, gapCol: '#2c1d10', c0: 0x9a7042, c1: 0x6d4a26,
    h0: 150, h1: 178, knots: 2, nails: 10,
  });
}

/** Shipping crate: planks, edge banding and a stencilled marking. */
function paintCrate(c, h, W, H, R) {
  paintPlanks(c, h, W, H, R, {
    planks: 5, gap: 4, gapCol: '#33220f', c0: 0xb2854a, c1: 0x8a6027,
    h0: 152, h1: 176, knots: 1, nails: 16,
  });
  const b = 11;                                           // edge band frame
  c.fillStyle = 'rgba(58,50,40,0.55)';
  rectT(c, W, H, 0, 0, W, b); rectT(c, W, H, 0, H - b, W, b);
  rectT(c, W, H, 0, 0, b, H); rectT(c, W, H, W - b, 0, b, H);
  h.fillStyle = grey(176, 0.8);
  rectT(h, W, H, 0, 0, W, b); rectT(h, W, H, 0, H - b, W, b);
  rectT(h, W, H, 0, 0, b, H); rectT(h, W, H, W - b, 0, b, H);
  const cx = W * 0.5, cy = H * 0.5, s = W * 0.30;
  pathT(c, W, H, cx, cy, s * 1.5, () => {
    c.save();
    c.globalAlpha = 0.5;
    c.strokeStyle = '#2f2a22'; c.lineWidth = 4;
    c.strokeRect(cx - s, cy - s * 0.66, s * 2, s * 1.32);
    c.fillStyle = '#2f2a22';
    c.font = `bold ${Math.round(s * 0.5)}px sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('军械', cx, cy - s * 0.2);
    c.font = `bold ${Math.round(s * 0.26)}px sans-serif`;
    c.fillText('7.62 NATO', cx, cy + s * 0.34);
    c.beginPath();                                        // this-way-up arrows
    c.moveTo(cx - s * 0.78, cy + s * 0.98); c.lineTo(cx - s * 0.58, cy + s * 0.62);
    c.lineTo(cx - s * 0.38, cy + s * 0.98); c.closePath(); c.fill();
    c.restore();
  });
}

/** Brushed steel with faint scratches. */
function paintMetal(c, h, W, H, R) {
  c.fillStyle = '#8f9499'; c.fillRect(0, 0, W, H);
  h.fillStyle = grey(150); h.fillRect(0, 0, W, H);
  for (let i = 0; i < 260; i++) {                          // brushed streaks
    const y = R() * H, up = R() < 0.5;
    bandH(c, W, H, y, 0.6 + R() * 2.2, rgba(up ? 208 : 96, up ? 214 : 100, up ? 222 : 106, 0.05 + R() * 0.13), 1, 0.6);
    if (i % 3 === 0) bandH(h, W, H, y, 1 + R() * 2, grey(up ? 168 : 132, 0.16), 1, 0.6);
  }
  for (let i = 0; i < 22; i++) {                           // scratches
    const y = R() * H, k = 1 + ((i * 5) % 3);
    bandH(c, W, H, y, 0.8 + R() * 1.1, rgba(232, 238, 244, 0.16 + R() * 0.2), k, 2 + R() * 7);
    bandH(h, W, H, y, 1.2, grey(96, 0.4), k, 2 + R() * 7);
  }
  for (let i = 0; i < 20; i++) {                           // grime + dents
    const x = R() * W, y = R() * H, r = 8 + R() * 40;
    blob(c, W, H, x, y, r, 62, 62, 60, 0.04 + R() * 0.1);
    if (i % 2) { h.fillStyle = grey(122, 0.5); discT(h, W, H, x, y, 2 + R() * 4); }
  }
  const seam = H * 0.5;                                    // panel seam + bolts
  c.fillStyle = 'rgba(40,44,48,0.6)'; rectT(c, W, H, 0, seam - 1.5, W, 3);
  h.fillStyle = grey(104); rectT(h, W, H, 0, seam - 1.5, W, 3);
  for (let i = 0; i < 8; i++) {
    const x = (i + 0.5) * (W / 8);
    c.fillStyle = 'rgba(58,62,66,0.9)'; discT(c, W, H, x, seam, 3.2);
    c.fillStyle = 'rgba(196,204,212,0.45)'; discT(c, W, H, x - 0.9, seam - 1, 1.8);
    h.fillStyle = grey(196); discT(h, W, H, x, seam, 3.2);
  }
  grain(c, W, H, 64, 118, 140, 0.28, R);
  grain(h, W, H, 64, 122, 136, 0.3, R);
}

/** Steel plus orange rust blooms and downward streaks. */
function paintMetalRust(c, h, W, H, R) {
  paintMetal(c, h, W, H, R);
  c.save(); c.globalAlpha = 0.55; c.fillStyle = '#6b5a4c'; c.fillRect(0, 0, W, H); c.restore();
  for (let i = 0; i < 24; i++) {                           // blooms
    const x = R() * W, y = R() * H, r = 10 + R() * 42;
    const t = R();
    const outer = lumpR(r, R, 0.45, 13), inner = lumpR(r * 0.58, R, 0.5, 13);
    lump(c, W, H, x, y, outer, mixHex(0xa8552a, 0x6d3a1c, t));
    lump(c, W, H, x, y, inner, mixHex(0xc2762f, 0x8f4a1e, t));
    lump(h, W, H, x, y, outer, grey(112, 0.7));
    lump(h, W, H, x, y, inner, grey(168, 0.6));
    const len = 20 + R() * 90, w = r * (0.5 + R() * 0.5);   // streak below
    pathT(c, W, H, x, y + len * 0.5, Math.max(w, len) * 0.6 + 4, () => {
      const g = c.createLinearGradient(0, y, 0, y + len);
      g.addColorStop(0, 'rgba(150,82,36,0.5)');
      g.addColorStop(1, 'rgba(122,68,30,0)');
      c.fillStyle = g; c.fillRect(x - w * 0.5, y, w, len);
    });
  }
  grain(c, W, H, 64, 104, 152, 0.4, R);
  grain(h, W, H, 64, 114, 144, 0.4, R);
}

/** Heavy door: vertical planks, iron braces and rivets. */
function paintDoor(c, h, W, H, R) {
  paintPlanks(c, h, W, H, R, {
    planks: 5, gap: 5, gapCol: '#1f1409', c0: 0x8a6238, c1: 0x5f4022,
    h0: 148, h1: 172, knots: 1, nails: 0, vertical: true,
  });
  for (const by of [H * 0.18, H * 0.72]) {                 // iron braces
    const bh = H * 0.1;
    c.fillStyle = '#4a4b4d'; rectT(c, W, H, 0, by, W, bh);
    c.fillStyle = 'rgba(150,154,158,0.28)'; rectT(c, W, H, 0, by, W, 3);
    c.fillStyle = 'rgba(14,14,16,0.4)'; rectT(c, W, H, 0, by + bh - 4, W, 4);
    h.fillStyle = grey(196); rectT(h, W, H, 0, by, W, bh);
    h.fillStyle = grey(214, 0.6); rectT(h, W, H, 0, by + 2, W, bh - 6);
    for (let i = 0; i < 7; i++) {                           // rivets
      const x = (i + 0.5) * (W / 7), y = by + bh * 0.5, r = 3.4;
      c.fillStyle = 'rgba(96,98,100,0.95)'; discT(c, W, H, x, y, r);
      c.fillStyle = 'rgba(206,212,218,0.4)'; discT(c, W, H, x - 1, y - 1.1, r * 0.5);
      h.fillStyle = grey(232); discT(h, W, H, x, y, r);
    }
  }
  for (let i = 0; i < 16; i++) {                            // rust bleed + wear
    const x = R() * W, y = R() * H, r = 6 + R() * 26;
    blob(c, W, H, x, y, r, 128, 74, 34, 0.05 + R() * 0.12);
  }
}

/** Dark metal grid over a light backdrop. */
function paintGrate(c, h, W, H, R) {
  c.fillStyle = '#b6ae9c'; c.fillRect(0, 0, W, H);          // light backdrop
  h.fillStyle = grey(70); h.fillRect(0, 0, W, H);
  for (let i = 0; i < 30; i++) {
    const x = R() * W, y = R() * H, r = 14 + R() * 50;
    blob(c, W, H, x, y, r, 92, 86, 74, 0.06 + R() * 0.14);
  }
  const cells = 8, step = W / cells, bar = step * 0.3;
  for (let i = 0; i < cells; i++) {
    const p = i * step;
    c.fillStyle = '#2b2d2f'; rectT(c, W, H, p, 0, bar, H); rectT(c, W, H, 0, p, W, bar);
    h.fillStyle = grey(206); rectT(h, W, H, p, 0, bar, H); rectT(h, W, H, 0, p, W, bar);
    c.fillStyle = 'rgba(154,160,166,0.35)';                 // top-left highlight
    rectT(c, W, H, p, 0, 1.6, H); rectT(c, W, H, 0, p, W, 1.6);
    c.fillStyle = 'rgba(8,8,10,0.5)';
    rectT(c, W, H, p + bar - 1.6, 0, 1.6, H); rectT(c, W, H, 0, p + bar - 1.6, W, 1.6);
    h.fillStyle = grey(228, 0.7); rectT(h, W, H, p + 1.5, 1.5, bar - 3, H - 3);
  }
  for (let i = 0; i < 40; i++) {                            // rust flecks on the bars
    const x = R() * W, y = R() * H;
    c.fillStyle = 'rgba(126,72,34,0.4)'; discT(c, W, H, x, y, 1.2 + R() * 3);
  }
  grain(c, W, H, 64, 110, 148, 0.3, R);
}

/** Glazed floor tiles with grout joints. */
function paintTile(c, h, W, H, R) {
  const n = 4, step = W / n, grout = 9;
  c.fillStyle = '#8d8474'; c.fillRect(0, 0, W, H);
  h.fillStyle = grey(96); h.fillRect(0, 0, W, H);
  grain(c, W, H, 64, 104, 152, 0.35, R);
  for (let ry = 0; ry < n; ry++) {
    for (let rx = 0; rx < n; rx++) {
      const t = R();
      const x = rx * step + grout * 0.5, y = ry * step + grout * 0.5;
      const s = step - grout;
      c.fillStyle = mixHex(0xc9bda4, 0xa8997c, t);
      rectT(c, W, H, x, y, s, s);
      h.fillStyle = grey(lerp(178, 196, t)); rectT(h, W, H, x, y, s, s);
      c.fillStyle = 'rgba(255,252,238,0.16)'; rectT(c, W, H, x, y, s, 3);
      c.fillStyle = 'rgba(40,32,20,0.2)'; rectT(c, W, H, x, y + s - 3, s, 3);
      for (let i = 0; i < 5; i++) {                          // glaze mottling
        blob(c, W, H, x + R() * s, y + R() * s, 6 + R() * 22, 236, 228, 208, 0.05 + R() * 0.09);
      }
      if (R() < 0.22) {                                      // chipped corner
        const cxp = x + (R() < 0.5 ? 0 : s), cyp = y + (R() < 0.5 ? 0 : s);
        const rr = lumpR(3 + R() * 5, R, 0.5);
        lump(c, W, H, cxp, cyp, rr, 'rgba(120,110,92,0.85)');
        lump(h, W, H, cxp, cyp, rr, grey(104, 0.9));
      }
    }
  }
}

/** Clay roof tiles: overlapping half-round rows. */
function paintRoof(c, h, W, H, R) {
  const rows = 6, cols = 8;
  const rh = H / rows, cw = W / cols;
  c.fillStyle = '#5d3221'; c.fillRect(0, 0, W, H);
  h.fillStyle = grey(80); h.fillRect(0, 0, W, H);
  for (let ry = 0; ry < rows; ry++) {
    for (let cx0 = 0; cx0 < cols; cx0++) {
      const t = R();
      const x = cx0 * cw + (ry % 2) * cw * 0.5, y = ry * rh;
      const put = (ctx, mkGrad) => tiled(W, H, x + cw * 0.5, y + rh * 0.5, cw + rh, (px, py) => {
        const gx = px - cw * 0.5;
        ctx.fillStyle = mkGrad(ctx, gx);
        ctx.beginPath();
        ctx.moveTo(gx, py + rh * 0.5);
        ctx.bezierCurveTo(gx, py - rh * 0.62, gx + cw, py - rh * 0.62, gx + cw, py + rh * 0.5);
        ctx.lineTo(gx + cw, py + rh * 0.52);
        ctx.lineTo(gx, py + rh * 0.52);
        ctx.closePath(); ctx.fill();
      });
      put(c, (ctx, gx) => {
        const g = ctx.createLinearGradient(gx, 0, gx + cw, 0);
        g.addColorStop(0, mixHex(0x6b3620, 0x8d472a, t));
        g.addColorStop(0.42, mixHex(0xc06a3c, 0xa9542c, t));
        g.addColorStop(1, mixHex(0x5d2d1a, 0x74391f, t));
        return g;
      });
      put(h, (ctx, gx) => {
        const g = ctx.createLinearGradient(gx, 0, gx + cw, 0);
        g.addColorStop(0, grey(78));
        g.addColorStop(0.42, grey(lerp(196, 214, t)));
        g.addColorStop(1, grey(70));
        return g;
      });
    }
  }
  for (let i = 0; i < 34; i++) {                             // sun bleach + moss
    const x = R() * W, y = R() * H, r = 10 + R() * 40, up = R() < 0.6;
    blob(c, W, H, x, y, r, up ? 218 : 96, up ? 186 : 104, up ? 150 : 64, 0.05 + R() * 0.12);
  }
  grain(c, W, H, 64, 108, 150, 0.34, R);
  grain(h, W, H, 64, 118, 140, 0.3, R);
}

/** Burlap weave — over/under threads, used by canvas and sandbags. */
function weave(c, h, W, H, R, o) {
  const step = o.step, tw = step * 0.5;
  c.fillStyle = o.dark; c.fillRect(0, 0, W, H);
  h.fillStyle = grey(112); h.fillRect(0, 0, W, H);
  const cells = Math.round(W / step);
  for (let iy = 0; iy < cells; iy++) {
    for (let ix = 0; ix < cells; ix++) {
      const vertOnTop = (ix + iy) % 2 === 0;
      const x = ix * step, y = iy * step, t = R();
      const col = mixHex(o.c0, o.c1, t);
      // pathT (not rectT) so the shading gradient travels with the wrapped copy
      const thread = (ctx, hx, hy, w, hh, light) => {
        pathT(ctx, W, H, hx + w * 0.5, hy + hh * 0.5, Math.max(w, hh) * 0.5 + 1, () => {
          const across = w < hh;
          const g = ctx.createLinearGradient(hx, hy, across ? hx + w : hx, across ? hy : hy + hh);
          g.addColorStop(0, light ? grey(96) : 'rgba(0,0,0,0.35)');
          g.addColorStop(0.45, light ? grey(206) : col);
          g.addColorStop(1, light ? grey(96) : 'rgba(0,0,0,0.35)');
          ctx.fillStyle = g;
          ctx.fillRect(hx, hy, w, hh);
        });
      };
      if (vertOnTop) {
        thread(c, x + tw * 0.5, y, tw, step, false);
        thread(h, x + tw * 0.5, y, tw, step, true);
      } else {
        thread(c, x, y + tw * 0.5, step, tw, false);
        thread(h, x, y + tw * 0.5, step, tw, true);
      }
    }
  }
  grain(c, W, H, 64, 104, 152, 0.34, R);
  grain(h, W, H, 64, 116, 142, 0.3, R);
}

/** Awning / tarp canvas: burlap plus faded stripes and stains. */
function paintCanvas(c, h, W, H, R) {
  weave(c, h, W, H, R, { step: 16, dark: '#6f5c3c', c0: 0xc4a97c, c1: 0x9a8054 });
  for (let i = 0; i < 3; i++) {                              // faded stripes
    const y = (i + 0.5) * (H / 3) + (R() - 0.5) * 14, w = 16 + R() * 26;
    bandH(c, W, H, y, w, i % 2 ? 'rgba(150,72,54,0.28)' : 'rgba(72,86,104,0.24)', 1, 2);
  }
  for (let i = 0; i < 22; i++) {
    const x = R() * W, y = R() * H, r = 12 + R() * 46;
    blob(c, W, H, x, y, r, R() < 0.5 ? 78 : 214, R() < 0.5 ? 66 : 200, 50, 0.05 + R() * 0.1);
  }
}

/** Hessian sacking: rows of bulging bags with seams. */
function paintSandbag(c, h, W, H, R) {
  weave(c, h, W, H, R, { step: 20, dark: '#6d5b3a', c0: 0xb8a071, c1: 0x8d7647 });
  const rows = 3, cols = 2;
  const bw = W / cols, bh = H / rows;
  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      const x = rx * bw + (ry % 2) * bw * 0.5 + bw * 0.5, y = ry * bh + bh * 0.5;
      const rr = Math.min(bw, bh) * 0.62, t = R();
      tiled(W, H, x, y, bw, (px, py) => {                    // bulge shading
        const g = c.createRadialGradient(px - rr * 0.25, py - rr * 0.3, rr * 0.1, px, py, rr * 1.25);
        g.addColorStop(0, rgba(226, 206, 164, 0.5));
        g.addColorStop(0.55, rgba(176, 154, 112, 0.16));
        g.addColorStop(1, 'rgba(38,28,14,0.45)');
        c.fillStyle = g;
        c.beginPath(); c.ellipse(px, py, bw * 0.52, bh * 0.5, 0, 0, TAU); c.fill();
        const gh = h.createRadialGradient(px - rr * 0.2, py - rr * 0.25, rr * 0.1, px, py, rr * 1.3);
        gh.addColorStop(0, grey(lerp(220, 240, t), 0.9));
        gh.addColorStop(0.6, grey(150, 0.5));
        gh.addColorStop(1, grey(48, 0.85));
        h.fillStyle = gh;
        h.beginPath(); h.ellipse(px, py, bw * 0.52, bh * 0.5, 0, 0, TAU); h.fill();
      });
      pathT(c, W, H, x, y, bw, () => {                       // stitched seam
        c.strokeStyle = 'rgba(60,44,22,0.6)'; c.lineWidth = 2.2;
        c.setLineDash([5, 4]);
        c.beginPath(); c.ellipse(x, y, bw * 0.42, bh * 0.36, 0, 0, TAU); c.stroke();
        c.setLineDash([]);
      });
    }
  }
  for (let i = 0; i < 18; i++) {
    const x = R() * W, y = R() * H, r = 8 + R() * 30;
    blob(c, W, H, x, y, r, 96, 80, 52, 0.05 + R() * 0.1);
  }
}

/** Kilim rug: red ground with ochre / cream geometric banding. */
function paintRug(c, h, W, H, R) {
  const RED = '#7f2a22', OCH = '#c98f3a', CRM = '#ded0b0', NAV = '#2b3040';
  c.fillStyle = RED; c.fillRect(0, 0, W, H);
  h.fillStyle = grey(140); h.fillRect(0, 0, W, H);
  const rows = 8, rh = H / rows;
  for (let i = 0; i < rows; i++) {
    const y = i * rh;
    if (i % 2 === 0) {                                       // diamond band
      const n = 6, dw = W / n;
      for (let j = 0; j < n; j++) {
        const cx = (j + 0.5) * dw, cy = y + rh * 0.5;
        const col = j % 2 ? OCH : CRM;
        tiled(W, H, cx, cy, dw, (px, py) => {
          c.fillStyle = col;
          c.beginPath();
          c.moveTo(px, py - rh * 0.42); c.lineTo(px + dw * 0.42, py);
          c.lineTo(px, py + rh * 0.42); c.lineTo(px - dw * 0.42, py);
          c.closePath(); c.fill();
          c.fillStyle = NAV;
          c.beginPath();
          c.moveTo(px, py - rh * 0.19); c.lineTo(px + dw * 0.19, py);
          c.lineTo(px, py + rh * 0.19); c.lineTo(px - dw * 0.19, py);
          c.closePath(); c.fill();
        });
      }
    } else {                                                 // zigzag band
      const n = 16, dw = W / n;
      c.strokeStyle = i % 4 === 1 ? CRM : OCH;
      c.lineWidth = rh * 0.16;
      c.beginPath();
      for (let j = 0; j <= n; j++) c.lineTo(j * dw, y + rh * (j % 2 ? 0.24 : 0.76));
      c.stroke();
      c.fillStyle = NAV;
      rectT(c, W, H, 0, y + rh * 0.44, W, rh * 0.1);
    }
  }
  for (let i = 0; i < 26; i++) {                             // wear and dust
    const x = R() * W, y = R() * H, r = 12 + R() * 44, up = R() < 0.5;
    blob(c, W, H, x, y, r, up ? 226 : 40, up ? 210 : 26, up ? 176 : 18, 0.05 + R() * 0.12);
  }
  grain(c, W, H, 64, 108, 150, 0.36, R);
  grain(h, W, H, 32, 112, 146, 0.55, R);
}

/** Dirty window glass: mostly clear, smeared and dusty. */
function paintGlass(c, h, W, H, R) {
  c.fillStyle = '#d5e3e8'; c.fillRect(0, 0, W, H);
  h.fillStyle = grey(140); h.fillRect(0, 0, W, H);
  for (let i = 0; i < 18; i++) {                             // tint variation
    const x = R() * W, y = R() * H, r = 40 + R() * 120, up = R() < 0.5;
    blob(c, W, H, x, y, r, up ? 236 : 168, up ? 244 : 196, up ? 244 : 208, 0.06 + R() * 0.1);
  }
  for (let i = 0; i < 14; i++) {                             // smears
    const x = R() * W, y = R() * H, r = 20 + R() * 70;
    blob(c, W, H, x, y, r, 236, 240, 236, 0.06 + R() * 0.1);
    blob(h, W, H, x, y, r, 152, 152, 152, 0.1);
  }
  for (let i = 0; i < 8; i++) {                              // wiped streaks
    const y = R() * H;
    bandH(c, W, H, y, 3 + R() * 9, 'rgba(255,255,255,0.16)', 1 + (i % 2), 3 + R() * 6);
  }
  for (let i = 0; i < 90; i++) {                             // dust specks
    const x = R() * W, y = R() * H;
    c.fillStyle = 'rgba(120,124,120,0.28)'; discT(c, W, H, x, y, 0.6 + R() * 1.4);
  }
  grain(c, W, H, 64, 122, 134, 0.2, R);
  grain(h, W, H, 64, 124, 132, 0.2, R);
}

/** Dark earth with clods and small stones. */
function paintDirt(c, h, W, H, R) {
  c.fillStyle = '#54412e'; c.fillRect(0, 0, W, H);
  h.fillStyle = grey(126); h.fillRect(0, 0, W, H);
  for (let i = 0; i < 90; i++) {                             // clods
    const x = R() * W, y = R() * H, r = 6 + R() * 26, t = R();
    const rr = lumpR(r, R, 0.4, 9);
    lump(c, W, H, x, y, rr, mixHex(0x6b5238, 0x3a2c1e, t));
    lump(h, W, H, x, y, rr, grey(lerp(178, 108, t), 0.85));
  }
  for (let i = 0; i < 40; i++) {
    const x = R() * W, y = R() * H, r = 18 + R() * 60, up = R() < 0.45;
    blob(c, W, H, x, y, r, up ? 130 : 32, up ? 108 : 24, up ? 76 : 16, 0.06 + R() * 0.14);
  }
  specks([c, h], W, H, 260, 1.4, 4, [
    (t) => (t < 0.5 ? 'rgba(146,138,120,0.6)' : 'rgba(24,18,12,0.6)'),
    (t) => grey(t < 0.5 ? 196 : 96),
  ], R);
  grain(c, W, H, 64, 96, 160, 0.46, R);
  grain(h, W, H, 64, 104, 152, 0.5, R);
}

/** Painted concrete — colour coat worn through to the grey underneath. */
function paintPainted(c, h, W, H, R, hex, dark) {
  paintConcrete(c, h, W, H, R, '#8b8a86', 148);
  c.save(); c.globalAlpha = 0.82; c.fillStyle = hex; c.fillRect(0, 0, W, H); c.restore();
  for (let i = 0; i < 40; i++) {                             // roller streaks
    const y = R() * H;
    bandH(c, W, H, y, 4 + R() * 16, R() < 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.09)', 1 + (i % 3), 2 + R() * 5);
  }
  for (let i = 0; i < 22; i++) {                             // worn patches
    const x = R() * W, y = R() * H, r = 4 + R() * 14;
    const rr = lumpR(r, R, 0.5, 9), ri = lumpR(r * 0.55, R, 0.5, 9);
    lump(c, W, H, x, y, rr, 'rgba(140,138,132,0.75)');
    lump(c, W, H, x, y, ri, dark);
    lump(h, W, H, x, y, rr, grey(138, 0.5));
  }
  for (let i = 0; i < 26; i++) {
    const x = R() * W, y = R() * H;
    c.fillStyle = 'rgba(90,88,84,0.5)'; discT(c, W, H, x, y, 1 + R() * 2.6);
  }
  grain(c, W, H, 64, 112, 146, 0.3, R);
}

// ---------------------------------------------------------------------------
// texture recipe per material id
//   paint  (colourCtx, heightCtx, W, H, rand)
//   seed   deterministic RNG seed
//   rs     roughness spread around MATERIAL_INFO.roughness
//   ms     metalness spread around MATERIAL_INFO.metalness
// ---------------------------------------------------------------------------
const RECIPE = {
  [MAT.SAND_WALL]: { seed: 1101, paint: paintSandWall, rs: 0.16 },
  [MAT.SAND_TRIM]: { seed: 1202, paint: paintSandTrim, rs: 0.18 },
  [MAT.SAND_FLOOR]: { seed: 1303, paint: paintSandFloor, rs: 0.14 },
  [MAT.STONE]: {
    seed: 1404, rs: 0.24,
    paint: (c, h, W, H, R) => paintBricks(c, h, W, H, R, {
      rows: 4, cols: 3, gap: 11, mortar: '#9a9184', mortarH: 96,
      c0: 0xafa694, c1: 0x847b6c, brickH0: 168, brickH1: 200, jitter: 3,
    }),
  },
  [MAT.BRICK]: {
    seed: 1505, rs: 0.26,
    paint: (c, h, W, H, R) => paintBricks(c, h, W, H, R, {
      rows: 8, cols: 4, gap: 8, mortar: '#ad9a80', mortarH: 92,
      c0: 0xba8055, c1: 0x8e5a39, brickH0: 170, brickH1: 204, jitter: 2.4,
    }),
  },
  [MAT.CONCRETE]: { seed: 1606, paint: paintConcrete, rs: 0.22 },
  [MAT.PLASTER]: { seed: 1707, paint: paintPlaster, rs: 0.2 },
  [MAT.WOOD]: { seed: 1808, paint: paintWood, rs: 0.24 },
  [MAT.CRATE]: { seed: 1909, paint: paintCrate, rs: 0.24, ms: 0.02 },
  [MAT.METAL]: { seed: 2010, paint: paintMetal, rs: 0.3, ms: 0.22 },
  [MAT.METAL_RUST]: { seed: 2111, paint: paintMetalRust, rs: 0.34, ms: 0.4 },
  [MAT.DOOR]: { seed: 2212, paint: paintDoor, rs: 0.26, ms: 0.12 },
  [MAT.GRATE]: { seed: 2313, paint: paintGrate, rs: 0.3, ms: 0.4 },
  [MAT.TILE]: { seed: 2414, paint: paintTile, rs: 0.3 },
  [MAT.ROOF]: { seed: 2515, paint: paintRoof, rs: 0.2 },
  [MAT.CANVAS]: { seed: 2616, paint: paintCanvas, rs: 0.1 },
  [MAT.SANDBAG]: { seed: 2717, paint: paintSandbag, rs: 0.1 },
  [MAT.RUG]: { seed: 2818, paint: paintRug, rs: 0.12 },
  [MAT.GLASS]: { seed: 2919, paint: paintGlass, rs: 0.07 },
  [MAT.DIRT]: { seed: 3020, paint: paintDirt, rs: 0.1 },
  [MAT.ASPHALT]: { seed: 3121, paint: paintAsphalt, rs: 0.2 },
  [MAT.PAINT_RED]: {
    seed: 3222, rs: 0.26,
    paint: (c, h, W, H, R) => paintPainted(c, h, W, H, R, '#a83e33', 'rgba(120,116,108,0.8)'),
  },
  [MAT.PAINT_BLUE]: {
    seed: 3323, rs: 0.26,
    paint: (c, h, W, H, R) => paintPainted(c, h, W, H, R, '#33648f', 'rgba(116,118,120,0.8)'),
  },
};

// ---------------------------------------------------------------------------
// quality
// ---------------------------------------------------------------------------
/** Accept a QUALITY entry, a quality name, or nothing at all. */
function normQuality(q) {
  if (typeof q === 'string') q = QUALITY[q];
  const base = QUALITY.high;
  const s = q && typeof q === 'object' ? q : base;
  return {
    shadowMap: s.shadowMap === undefined ? base.shadowMap : s.shadowMap,
    anisotropy: Math.max(1, s.anisotropy || 1),
    particles: s.particles === undefined ? 1 : s.particles,
  };
}

// ---------------------------------------------------------------------------
// MaterialLibrary
// ---------------------------------------------------------------------------
/**
 * Lazily bakes and caches one MeshStandardMaterial per MAT id.  Materials are
 * shared by every brush of that material and carry `vertexColors = true`
 * because mapmesh.js writes baked AO / tint into the colour attribute.
 */
export class MaterialLibrary {
  /** @param {Object|string} quality a QUALITY entry or its name */
  constructor(quality) {
    this.q = normQuality(quality);
    // low quality halves every texture; colour and normal share a resolution
    this.res = this.q.shadowMap > 0 ? 512 : 256;
    this.roughRes = this.res >> 1;
    this.cache = new Map();
    this.textures = [];
  }

  /**
   * @param {string} matId MAT.* id (unknown ids fall back to sand wall)
   * @returns {THREE.MeshStandardMaterial} cached, shared instance
   */
  get(matId) {
    const id = MATERIAL_INFO[matId] ? matId : MAT.SAND_WALL;
    let m = this.cache.get(id);
    if (!m) { m = this._build(id); this.cache.set(id, m); }
    return m;
  }

  /** Build (if needed) and return every material, keyed by MAT id. */
  all() {
    const out = {};
    for (const id of Object.keys(MATERIAL_INFO)) out[id] = this.get(id);
    return out;
  }

  /** Number of materials baked so far. */
  get size() { return this.cache.size; }

  _build(id) {
    const info = MATERIAL_INFO[id];
    const mat = new THREE.MeshStandardMaterial({
      color: info.color,
      roughness: clamp01(info.roughness),
      metalness: clamp01(info.metalness),
      side: THREE.FrontSide,
      vertexColors: true,
      dithering: true,
    });
    mat.name = `mat_${id}`;
    if (id === MAT.GLASS) {
      mat.transparent = true;
      mat.opacity = 0.25;
      mat.depthWrite = false;
    }
    const maps = this._bake(id, info);
    if (maps) {
      // the painted map already carries the albedo, so the material tint goes
      // white — MATERIAL_INFO.color stays the flat fallback for headless use
      mat.color.setHex(0xffffff);
      mat.map = maps.color;
      mat.normalMap = maps.normal;
      mat.normalScale = new THREE.Vector2(info.bump, info.bump);
      // the packed map already averages to the intended values
      mat.roughnessMap = maps.rm;
      mat.roughness = 1;
      if (info.metalness > 0.03) {
        mat.metalnessMap = maps.rm;
        mat.metalness = 1;
      }
    }
    return mat;
  }

  /** Paint the colour + height canvases and upload the three textures. */
  _bake(id, info) {
    if (!hasDOM()) return null;
    const rec = RECIPE[id];
    if (!rec) return null;
    const W = this.res, H = this.res;
    const colCv = makeCanvas(W, H), hCv = makeCanvas(W, H);
    const c = ctxOf(colCv), h = ctxOf(hCv);
    if (!c || !h) return null;
    rec.paint(c, h, W, H, makeRng(rec.seed));
    const color = this._tex(colCv, true);
    const normal = this._tex(heightToNormal(hCv, 1), false);
    const rm = this._tex(packRoughMetal(hCv, this.roughRes,
      clamp01(info.roughness), rec.rs === undefined ? DEFAULT_ROUGH_SPREAD : rec.rs,
      clamp01(info.metalness), rec.ms === undefined ? DEFAULT_METAL_SPREAD : rec.ms), false);
    color.name = `${id}_map`; normal.name = `${id}_nrm`; rm.name = `${id}_rm`;
    return { color, normal, rm };
  }

  /** CanvasTexture with the tiling / filtering the world UVs expect. */
  _tex(canvas, srgb) {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, 1);                      // world scaled UVs do the tiling
    t.anisotropy = this.q.anisotropy;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    this.textures.push(t);
    return t;
  }

  /** Free every texture and material this library owns. */
  dispose() {
    for (const t of this.textures) t.dispose();
    this.textures.length = 0;
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
  }
}

// ---------------------------------------------------------------------------
// sky / sun rig
// ---------------------------------------------------------------------------
const SKY_RADIUS = 240;      // well inside the 400 m camera far plane
const SUN_DIST = 190;        // directional light stand-off from the origin
const SHADOW_HALF = 92;      // ortho half extent — covers a 180 m map + skyline

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

const SKY_FRAG = /* glsl */`
uniform vec3 uTop;
uniform vec3 uBottom;
uniform vec3 uHaze;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uComp;
uniform float uBand;
varying vec3 vDir;

void main() {
  vec3 d = normalize( vDir );
  // vertical gradient, warm near the ground
  float up = pow( clamp( d.y, 0.0, 1.0 ), 0.55 );
  vec3 col = mix( uBottom, uTop, up );
  // dusty horizon haze that matches the scene fog colour
  float haze = exp( - abs( d.y ) / uBand );
  col = mix( col, uHaze, haze * 0.82 );
  float below = clamp( - d.y * 3.5, 0.0, 1.0 );
  col = mix( col, uHaze * 0.42, below * 0.85 );
  // sun disc plus a broad glow
  float sd = max( dot( d, uSunDir ), 0.0 );
  float disc = smoothstep( 0.99903, 0.99972, sd );
  float glow = pow( sd, 260.0 ) * 0.5 + pow( sd, 24.0 ) * 0.15 + pow( sd, 5.0 ) * 0.045;
  float mask = smoothstep( -0.04, 0.09, d.y );
  col += uSunColor * ( disc * 5.5 + glow ) * mask;
  gl_FragColor = vec4( col * uComp, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const MOTE_VERT = /* glsl */`
uniform float uTime;
uniform float uSize;
attribute float aPhase;
varying float vFade;
void main() {
  vec3 p = position;
  float ph = aPhase * 6.2831853;
  p.x += sin( uTime * 0.21 + ph ) * 1.2;
  p.y += sin( uTime * 0.13 + ph * 2.7 ) * 0.6;
  p.z += cos( uTime * 0.17 + ph * 1.9 ) * 1.2;
  vec4 mv = modelViewMatrix * vec4( p, 1.0 );
  float dist = - mv.z;
  vFade = ( 1.0 - smoothstep( 8.0, 16.0, dist ) ) * ( 0.3 + 0.7 * abs( sin( uTime * 0.8 + ph ) ) );
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp( uSize * ( 9.0 / max( dist, 0.4 ) ), 1.0, 5.0 );
}
`;

const MOTE_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
varying float vFade;
void main() {
  float r = length( gl_PointCoord - vec2( 0.5 ) );
  float a = ( 1.0 - smoothstep( 0.16, 0.5, r ) ) * vFade * uOpacity;
  if ( a <= 0.002 ) discard;
  gl_FragColor = vec4( uColor, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Airborne dust: a camera-following point cloud that animates itself. */
function buildMotes(q, sunColor) {
  const max = 900;
  const pos = new Float32Array(max * 3);
  const phase = new Float32Array(max);
  const R = makeRng(7717);
  for (let i = 0; i < max; i++) {
    pos[i * 3] = (R() - 0.5) * 34;
    pos[i * 3 + 1] = R() * 9 - 1;
    pos[i * 3 + 2] = (R() - 0.5) * 34;
    phase[i] = R();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geo.setDrawRange(0, moteCount(q, max));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: 2.4 },
      uColor: { value: new THREE.Color(sunColor) },
      uOpacity: { value: 0.18 },
    },
    vertexShader: MOTE_VERT,
    fragmentShader: MOTE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 20;
  pts.castShadow = false; pts.receiveShadow = false;
  return pts;
}
/** How many motes a quality tier gets. */
function moteCount(q, max = 900) {
  return Math.max(0, Math.min(max, Math.round(max * (q.particles || 1) * 0.8)));
}

/**
 * Build the outdoor lighting rig: fog, gradient sky dome with a sun disc, a
 * shadow casting directional sun, hemisphere bounce light and a dust layer.
 * The dome and the dust follow the camera through `onBeforeRender`, so callers
 * do not have to tick anything.
 *
 * @param {THREE.Scene} scene
 * @param {Object} env  MapDef.env — sunDir, sunColor, sunIntensity, skyTop,
 *        skyBottom, fog{color,near,far}, ambient, hemiSky, hemiGround
 * @param {Object|string} quality QUALITY entry or name
 * @returns {{sky:THREE.Mesh, sun:THREE.DirectionalLight, hemi:THREE.HemisphereLight,
 *           motes:THREE.Points|null, setQuality:Function, dispose:Function}}
 */
export function createSky(scene, env, quality) {
  const q = normQuality(quality);
  const e = env || {};
  const fog = e.fog || {};
  const fogColor = fog.color === undefined ? 0xdccaa6 : fog.color;
  const skyTop = e.skyTop === undefined ? 0x3f7fc4 : e.skyTop;
  const skyBottom = e.skyBottom === undefined ? 0xe2cda6 : e.skyBottom;
  const sunColor = e.sunColor === undefined ? 0xfff2d6 : e.sunColor;
  const dir = new THREE.Vector3(
    e.sunDir ? e.sunDir[0] : -0.42,
    e.sunDir ? e.sunDir[1] : -0.8,
    e.sunDir ? e.sunDir[2] : 0.36,
  );
  if (dir.lengthSq() < 1e-6) dir.set(-0.42, -0.8, 0.36);
  dir.normalize();
  const toSun = dir.clone().negate();

  scene.fog = new THREE.Fog(fogColor, fog.near === undefined ? 45 : fog.near,
    fog.far === undefined ? 210 : fog.far);

  // --- sky dome ---
  const geo = new THREE.SphereGeometry(SKY_RADIUS, 32, 20);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(skyTop) },
      uBottom: { value: new THREE.Color(skyBottom) },
      uHaze: { value: new THREE.Color(fogColor) },
      uSunColor: { value: new THREE.Color(sunColor) },
      uSunDir: { value: toSun.clone() },
      uComp: { value: 1.26 },      // compensates the ACES tone curve
      uBand: { value: 0.115 },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.name = 'sky';
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  sky.castShadow = false; sky.receiveShadow = false;
  sky.onBeforeRender = (renderer, s0, camera) => {
    sky.position.copy(camera.position);
    sky.updateMatrixWorld(true);
  };
  scene.add(sky);

  // --- sun ---
  const sun = new THREE.DirectionalLight(sunColor, e.sunIntensity === undefined ? 2.5 : e.sunIntensity);
  sun.name = 'sun';
  sun.position.copy(toSun).multiplyScalar(SUN_DIST);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = q.shadowMap > 0;
  const shCam = sun.shadow.camera;
  shCam.left = -SHADOW_HALF; shCam.right = SHADOW_HALF;
  shCam.top = SHADOW_HALF; shCam.bottom = -SHADOW_HALF;
  shCam.near = 1; shCam.far = SUN_DIST * 2.4;
  shCam.updateProjectionMatrix();
  sun.shadow.mapSize.set(Math.max(512, q.shadowMap || 1024), Math.max(512, q.shadowMap || 1024));
  // ~11 shadow texels per metre at 2048: a small constant bias kills the acne
  // and the normal offset (roughly one texel) avoids visible peter-panning.
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.055;
  sun.shadow.radius = 2;
  scene.add(sun);
  scene.add(sun.target);

  // --- ambient bounce ---
  const hemi = new THREE.HemisphereLight(
    e.hemiSky === undefined ? 0x9fc4ee : e.hemiSky,
    e.hemiGround === undefined ? 0xb59a6c : e.hemiGround,
    e.ambient === undefined ? 0.6 : e.ambient,
  );
  hemi.name = 'hemi';
  hemi.position.set(0, 40, 0);
  scene.add(hemi);

  // --- airborne dust ---
  let motes = null;
  if (moteCount(q) > 0) {
    motes = buildMotes(q, sunColor);
    const anchor = new THREE.Vector3();
    motes.onBeforeRender = (renderer, s2, camera) => {
      motes.material.uniforms.uTime.value = (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.001;
      // snap to an 8 m grid so the cloud does not feel glued to the player
      anchor.set(Math.round(camera.position.x / 8) * 8, 0, Math.round(camera.position.z / 8) * 8);
      if (!motes.position.equals(anchor)) {
        motes.position.copy(anchor);
        motes.updateMatrixWorld(true);
      }
    };
    scene.add(motes);
  }

  return {
    sky, sun, hemi, motes,
    /** Re-apply shadow resolution / particle budget after a settings change. */
    setQuality(nq) {
      const q2 = normQuality(nq);
      sun.castShadow = q2.shadowMap > 0;
      if (q2.shadowMap > 0) {
        sun.shadow.mapSize.set(q2.shadowMap, q2.shadowMap);
        if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      }
      if (motes) motes.geometry.setDrawRange(0, moteCount(q2));
    },
    dispose() {
      scene.remove(sky); geo.dispose(); mat.dispose();
      scene.remove(sun); scene.remove(sun.target);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      scene.remove(hemi);
      if (motes) {
        scene.remove(motes);
        motes.geometry.dispose();
        motes.material.dispose();
        motes = null;
      }
      scene.fog = null;
    },
  };
}

