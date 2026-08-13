import * as THREE from "three";

export const V3 = THREE.Vector3;

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function rand(a, b) { return a + Math.random() * (b - a); }
export function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
export function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
export function smoothstep(t) { return t * t * (3 - 2 * t); }
export function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
export function dist2d(a, b) {
  const dx = a.x - b.x, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export class AABB {
  constructor(x1, z1, x2, z2, y1 = -100, y2 = 100) {
    this.x1 = Math.min(x1, x2); this.z1 = Math.min(z1, z2);
    this.x2 = Math.max(x1, x2); this.z2 = Math.max(z1, z2);
    this.y1 = Math.min(y1, y2); this.y2 = Math.max(y1, y2);
  }
  expand(r) {
    return new AABB(this.x1 - r, this.z1 - r, this.x2 + r, this.z2 + r, this.y1, this.y2);
  }
  containsPoint(x, y, z, pad = 0) {
    return x > this.x1 + pad && x < this.x2 - pad && z > this.z1 + pad && z < this.z2 - pad &&
      y > this.y1 + pad && y < this.y2 - pad;
  }
  intersects(other) {
    return this.x1 < other.x2 && this.x2 > other.x1 &&
      this.z1 < other.z2 && this.z2 > other.z1 &&
      this.y1 < other.y2 && this.y2 > other.y1;
  }
  center() {
    return { x: (this.x1 + this.x2) / 2, z: (this.z1 + this.z2) / 2, y: (this.y1 + this.y2) / 2 };
  }
  // 圆柱体碰撞检测（用于玩家/投掷物）
  intersectsCylinder(cx, cy, cz, r, h, feetY) {
    const nx = clamp(cx, this.x1, this.x2);
    const nz = clamp(cz, this.z1, this.z2);
    const dx = cx - nx, dz = cz - nz;
    if (dx * dx + dz * dz > r * r) return false;
    const top = feetY + h;
    return top > this.y1 && feetY < this.y2;
  }
  // 射线与AABB相交
  rayHit(origin, dir, maxDist) {
    let tmin = 0, tmax = maxDist;
    const o = origin, d = dir;
    const bounds = [
      [this.x1, this.x2, "x"], [this.z1, this.z2, "z"], [this.y1, this.y2, "y"],
    ];
    for (const [lo, hi, k] of bounds) {
      const od = d[k];
      if (Math.abs(od) < 1e-9) {
        if (o[k] < lo || o[k] > hi) return null;
      } else {
        let t1 = (lo - o[k]) / od, t2 = (hi - o[k]) / od;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return null;
      }
    }
    return { t: tmin, point: o.clone().addScaledVector(d, tmin) };
  }
}

// ---------------------------------------------------------------------------
// 程序化纹理工厂
// ---------------------------------------------------------------------------
export function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return [c, c.getContext("2d")];
}

function noiseFill(ctx, w, h, base, varAmt) {
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = base + (Math.random() - 0.5) * varAmt;
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function toTex(c, repeatX = 1, repeatY = 1) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 4;
  return tex;
}

export function texBrickSand() {
  const [c, ctx] = makeCanvas(256, 256);
  noiseFill(ctx, 256, 256, 190, 26);
  const mortar = "#8a7a58";
  const brick = (x, y) => {
    ctx.fillStyle = `rgb(${178 + randInt(-12, 12)},${142 + randInt(-12, 12)},${86 + randInt(-12, 12)})`;
    ctx.fillRect(x + 1, y + 1, 62, 28);
  };
  ctx.fillStyle = mortar;
  ctx.fillRect(0, 0, 256, 256);
  for (let row = 0; row < 8; row++) {
    const off = (row % 2) * 32;
    for (let col = -1; col < 5; col++) {
      const x = col * 64 + off;
      const y = row * 32;
      if (x >= -64 && x < 256) brick(x, y);
    }
  }
  // 风化的裂纹与污渍
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = `rgba(90,70,40,${rand(0.05, 0.18)})`;
    ctx.fillRect(randInt(0, 250), randInt(0, 250), randInt(2, 22), randInt(2, 8));
  }
  return toTex(c, 1, 1);
}

export function texBrickPlaster() {
  const [c, ctx] = makeCanvas(256, 256);
  noiseFill(ctx, 256, 256, 168, 20);
  ctx.fillStyle = "#77705f";
  ctx.fillRect(0, 0, 256, 256);
  for (let row = 0; row < 6; row++) {
    const off = (row % 2) * 42;
    for (let col = -1; col < 7; col++) {
      const x = col * 84 + off, y = row * 44;
      if (x < 256 && y < 256) {
        ctx.fillStyle = `rgb(${132 + randInt(-10, 10)},${126 + randInt(-10, 10)},${112 + randInt(-10, 10)})`;
        ctx.fillRect(x + 1, y + 1, 80, 40);
      }
    }
  }
  return toTex(c, 1, 1);
}

export function texConcrete() {
  const [c, ctx] = makeCanvas(256, 256);
  noiseFill(ctx, 256, 256, 128, 22);
  ctx.fillStyle = "rgba(60,60,58,0.25)";
  for (let i = 0; i < 60; i++) ctx.fillRect(randInt(0, 255), randInt(0, 255), randInt(2, 10), randInt(2, 10));
  ctx.strokeStyle = "rgba(40,40,40,0.5)";
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, 256, 256);
  ctx.beginPath();
  for (let i = 1; i < 4; i++) { ctx.moveTo(i * 64, 0); ctx.lineTo(i * 64, 256); ctx.moveTo(0, i * 64); ctx.lineTo(256, i * 64); }
  ctx.stroke();
  return toTex(c, 2, 2);
}

export function texWoodPlanks() {
  const [c, ctx] = makeCanvas(256, 128);
  noiseFill(ctx, 256, 128, 128, 14);
  for (let i = 0; i < 5; i++) {
    const y = i * 26;
    ctx.fillStyle = `rgb(${118 + randInt(-14, 14)},${88 + randInt(-14, 14)},${58 + randInt(-12, 12)})`;
    ctx.fillRect(0, y, 256, 24);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, y + 22, 256, 2);
    ctx.fillStyle = "rgba(40,25,10,0.5)";
    for (let x = 32; x < 256; x += randInt(28, 64)) ctx.fillRect(x, y, 2, 24);
  }
  return toTex(c, 1, 1);
}

export function texMetal() {
  const [c, ctx] = makeCanvas(128, 128);
  noiseFill(ctx, 128, 128, 96, 16);
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    ctx.moveTo(randInt(0, 128), 0); ctx.lineTo(randInt(0, 128), 128);
    ctx.stroke();
  }
  return toTex(c, 1, 1);
}

export function texSandGround() {
  const [c, ctx] = makeCanvas(256, 256);
  noiseFill(ctx, 256, 256, 168, 30);
  for (let i = 0; i < 700; i++) {
    const v = randInt(0, 40) > 20 ? 0 : 255;
    ctx.fillStyle = `rgba(${v},${v},${v},${rand(0.04, 0.16)})`;
    ctx.fillRect(randInt(0, 255), randInt(0, 255), 1, 1);
  }
  return toTex(c, 6, 6);
}

export function texAsphalt() {
  const [c, ctx] = makeCanvas(256, 256);
  noiseFill(ctx, 256, 256, 72, 22);
  for (let i = 0; i < 400; i++) {
    const v = randInt(0, 3) === 0 ? 180 : 40;
    ctx.fillStyle = `rgba(${v},${v},${v},${rand(0.05, 0.2)})`;
    ctx.fillRect(randInt(0, 255), randInt(0, 255), 1, 1);
  }
  ctx.strokeStyle = "rgba(180,170,90,0.4)";
  ctx.lineWidth = 3; ctx.setLineDash([18, 12]);
  ctx.strokeRect(4, 4, 248, 248);
  ctx.setLineDash([]);
  return toTex(c, 3, 3);
}

export function texGrass() {
  const [c, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = "#5d7248";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    ctx.strokeStyle = `rgba(${randInt(70, 150)},${randInt(110, 170)},${randInt(50, 80)},${rand(0.25, 0.7)})`;
    ctx.beginPath();
    const x = randInt(0, 255), y = randInt(0, 255);
    ctx.moveTo(x, y); ctx.lineTo(x + rand(-1.5, 1.5), y - rand(2, 6));
    ctx.stroke();
  }
  return toTex(c, 5, 5);
}

export function texDirt() {
  const [c, ctx] = makeCanvas(256, 256);
  noiseFill(ctx, 256, 256, 105, 20);
  for (let i = 0; i < 900; i++) {
    const v = randInt(0, 3) === 0 ? 190 : 50;
    ctx.fillStyle = `rgba(${v},${v * 0.8},${v * 0.55},${rand(0.05, 0.22)})`;
    ctx.fillRect(randInt(0, 255), randInt(0, 255), randInt(1, 3), randInt(1, 3));
  }
  return toTex(c, 4, 4);
}

export function texTileFloor() {
  const [c, ctx] = makeCanvas(256, 256);
  noiseFill(ctx, 256, 256, 110, 12);
  ctx.fillStyle = "#56534a";
  for (let i = 0; i <= 4; i++) { ctx.fillRect(i * 64 - 1, 0, 2, 256); ctx.fillRect(0, i * 64 - 1, 256, 2); }
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  for (let i = 0; i < 40; i++) ctx.fillRect(randInt(0, 255), randInt(0, 255), randInt(3, 12), randInt(2, 4));
  return toTex(c, 2, 2);
}

// 中文字符贴纸（用于木箱等）
export function texCrate(paint) {
  const [c, ctx] = makeCanvas(256, 256);
  noiseFill(ctx, 256, 256, 116, 14);
  for (let i = 0; i < 4; i++) {
    ctx.strokeStyle = "rgba(30,22,12,0.8)";
    ctx.lineWidth = 8;
    ctx.strokeRect(8, 8, 240, 240);
  }
  ctx.strokeStyle = "rgba(20,15,8,0.85)";
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(8, 8); ctx.lineTo(248, 248); ctx.moveTo(248, 8); ctx.lineTo(8, 248); ctx.stroke();
  ctx.fillStyle = paint;
  ctx.fillRect(48, 56, 160, 144);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = "bold 72px 'PingFang SC','Microsoft YaHei',sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("补 给", 128, 128);
  return toTex(c, 1, 1);
}

export function texCamo(base, spots) {
  const [c, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 256);
  const cols = spots;
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = cols[randInt(0, cols.length - 1)];
    ctx.beginPath();
    ctx.ellipse(rand(0, 256), rand(0, 256), rand(10, 42), rand(7, 24), rand(0, Math.PI), 0, Math.PI * 2);
    ctx.fill();
  }
  return toTex(c, 2, 2);
}

// ---------------------------------------------------------------------------
// 小堆（优先队列），用于寻路
// ---------------------------------------------------------------------------
export class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item) {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}
