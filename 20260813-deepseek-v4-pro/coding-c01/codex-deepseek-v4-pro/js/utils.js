// ---------- 通用工具：随机、噪声、缓动、几何 ----------
import * as THREE from 'three';

export const TAU = Math.PI * 2;

export function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
export function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32 确定性随机数
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 2D 值噪声（可叠频）
export function makeNoise(seed) {
  const rand = rng(seed);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad = (ix, iy) => {
    const h = perm[(perm[ix & 255] + iy) & 255];
    return (h / 255) * 2 - 1;
  };
  const fade = t => t * t * (3 - 2 * t);
  return function (x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const a = grad(xi, yi), b = grad(xi + 1, yi);
    const c = grad(xi, yi + 1), d = grad(xi + 1, yi + 1);
    const u = fade(xf), v = fade(yf);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  };
}

export function fbm(noise, x, y, octaves = 4, lacunarity = 2.1, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= gain; freq *= lacunarity;
  }
  return sum / norm;
}

// 极坐标下的管段参数曲面（用于环形体 / 生态舱 / 舱壁）
// center(angle) -> Vector3；rho(angle) 与 k 为单位方向；位置 = center + r * (rho*cos(th) + k*sin(th))
export function buildTubeSurface({
  R,            // 环大半径
  r,            // 管半径
  a0, a1,       // 大圆角度范围（弧度）
  th0, th1,     // 截面角范围
  tubeSegs = 64, sideSegs = 40,
  radiusFn = null,     // (a, th) => 相对 r 的半径倍率
  colorFn = null,      // (a, th) => [r,g,b] 线性色
  flattenNormals = false,
} = {}) {
  const positions = [], normals = [], colors = [], uvs = [], indices = [];
  const P = new Float32Array((tubeSegs + 1) * (sideSegs + 1) * 3);
  const C = new Float32Array((tubeSegs + 1) * (sideSegs + 1) * 3);
  const put = (i, j, x, y, z, cx, cy, cz) => {
    const k = i * (sideSegs + 1) + j;
    P[k * 3] = x; P[k * 3 + 1] = y; P[k * 3 + 2] = z;
    C[k * 3] = cx; C[k * 3 + 1] = cy; C[k * 3 + 2] = cz;
  };
  for (let i = 0; i <= tubeSegs; i++) {
    const a = a0 + ((a1 - a0) * i) / tubeSegs;
    const cx = R * Math.cos(a), cz = R * Math.sin(a);
    const rx = Math.cos(a), rz = Math.sin(a); // rho
    for (let j = 0; j <= sideSegs; j++) {
      const th = th0 + ((th1 - th0) * j) / sideSegs;
      const factor = radiusFn ? radiusFn(a, th) : 1;
      const rr = r * factor;
      const cth = Math.cos(th), sth = Math.sin(th);
      const x = cx + rr * rx * cth;
      const y = rr * sth;
      const z = cz + rr * rz * cth;
      put(i, j, x, y, z, cx, 0, cz);
      uvs.push(i / tubeSegs, j / sideSegs);
      if (colorFn) {
        const c = colorFn(a, th);
        colors.push(c[0], c[1], c[2]);
      }
    }
  }
  for (let i = 0; i < tubeSegs; i++) {
    for (let j = 0; j < sideSegs; j++) {
      const a = i * (sideSegs + 1) + j;
      const b = a + sideSegs + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
  if (colors.length) geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// 渐变光晕贴图（canvas）
export function radialGlowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function gradientTexture(stops, size = 256, horizontal = true) {
  const c = document.createElement('canvas');
  c.width = horizontal ? size : 1;
  c.height = horizontal ? 1 : size;
  const g = c.getContext('2d');
  const grad = horizontal
    ? g.createLinearGradient(0, 0, size, 0)
    : g.createLinearGradient(0, 0, 0, size);
  for (const [p, col] of stops) grad.addColorStop(p, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function disposeObject(root) {
  root.traverse(obj => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        for (const k of Object.keys(m)) {
          const v = m[k];
          if (v && v.isTexture) v.dispose();
        }
        m.dispose();
      }
    }
  });
}
