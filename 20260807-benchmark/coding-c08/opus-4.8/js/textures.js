// textures.js — procedural canvas textures & shared materials (no external assets)
import * as THREE from 'three';

const cache = {};
function make(key, w, h, draw) {
  if (cache[key]) return cache[key];
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  cache[key] = tex;
  return tex;
}
function noise(g, w, h, amt, base) {
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amt;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}
function fill(g, w, h, col) { g.fillStyle = col; g.fillRect(0, 0, w, h); }

// Sandstone / desert plaster wall (Dust2 signature)
export function sandWall() {
  return make('sand', 256, 256, (g, w, h) => {
    fill(g, w, h, '#c9a86a');
    for (let i = 0; i < 700; i++) {
      g.fillStyle = `rgba(${180 + Math.random() * 40},${150 + Math.random() * 40},${90 + Math.random() * 40},.25)`;
      g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 4, 2 + Math.random() * 4);
    }
    // horizontal masonry banding
    g.strokeStyle = 'rgba(120,95,55,.35)'; g.lineWidth = 2;
    for (let y = 0; y < h; y += 42) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    for (let y = 0; y < h; y += 42) for (let x = ((y / 42) % 2) * 32; x < w; x += 64) {
      g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 42); g.stroke();
    }
    noise(g, w, h, 26);
  });
}
export function sandStone() {
  return make('sandstone', 256, 256, (g, w, h) => {
    fill(g, w, h, '#b89862');
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(${150 + Math.random() * 50},${120 + Math.random() * 50},${70 + Math.random() * 40},.4)`;
      const bw = 40 + Math.random() * 80, bh = 26 + Math.random() * 30;
      g.fillRect(Math.random() * w, Math.random() * h, bw, bh);
      g.strokeStyle = 'rgba(90,70,40,.5)'; g.strokeRect(Math.random() * w, Math.random() * h, bw, bh);
    }
    noise(g, w, h, 30);
  });
}
export function ground() {
  return make('ground', 256, 256, (g, w, h) => {
    fill(g, w, h, '#b59a63');
    for (let i = 0; i < 3000; i++) {
      const s = Math.random();
      g.fillStyle = `rgba(${150 + Math.random() * 60},${125 + Math.random() * 50},${75 + Math.random() * 40},${.15 + s * .2})`;
      g.fillRect(Math.random() * w, Math.random() * h, 1 + s * 3, 1 + s * 3);
    }
    // faint tile grout
    g.strokeStyle = 'rgba(100,80,50,.25)'; g.lineWidth = 1.5;
    for (let x = 0; x <= w; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y <= h; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    noise(g, w, h, 22);
  });
}
export function concrete() {
  return make('concrete', 256, 256, (g, w, h) => {
    fill(g, w, h, '#8b8d90');
    for (let i = 0; i < 1200; i++) {
      g.fillStyle = `rgba(${110 + Math.random() * 60},${110 + Math.random() * 60},${115 + Math.random() * 60},.2)`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    g.strokeStyle = 'rgba(60,60,65,.4)'; g.lineWidth = 2;
    for (let x = 0; x <= w; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y <= h; y += 128) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    noise(g, w, h, 24);
  });
}
export function metal() {
  return make('metal', 128, 128, (g, w, h) => {
    fill(g, w, h, '#5f6570');
    for (let x = 0; x < w; x += 8) { g.fillStyle = x % 16 === 0 ? '#6b7280' : '#565c66'; g.fillRect(x, 0, 8, h); }
    // rivets
    g.fillStyle = '#3a3f47';
    for (let x = 10; x < w; x += 30) for (let y = 10; y < h; y += 30) { g.beginPath(); g.arc(x, y, 2.5, 0, 7); g.fill(); }
    noise(g, w, h, 16);
  });
}
export function crateWood() {
  return make('woodcrate', 128, 128, (g, w, h) => {
    fill(g, w, h, '#9c6f3a');
    for (let y = 0; y < h; y += 16) { g.fillStyle = (y / 16) % 2 ? '#8a6032' : '#a2743d'; g.fillRect(0, y, w, 16); }
    g.strokeStyle = '#5e4020'; g.lineWidth = 4; g.strokeRect(4, 4, w - 8, h - 8);
    g.beginPath(); g.moveTo(4, 4); g.lineTo(w - 4, h - 4); g.moveTo(w - 4, 4); g.lineTo(4, h - 4); g.stroke();
    noise(g, w, h, 20);
  });
}
export function crateMetal() {
  return make('metalcrate', 128, 128, (g, w, h) => {
    fill(g, w, h, '#7a7d55');
    g.strokeStyle = '#4a4d32'; g.lineWidth = 6; g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#5c5f3e';
    for (let x = 16; x < w; x += 24) for (let y = 16; y < h; y += 24) { g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); }
    noise(g, w, h, 18);
  });
}
export function tarp(col) {
  return make('tarp' + col, 64, 64, (g, w, h) => {
    fill(g, w, h, col);
    for (let i = 0; i < 200; i++) { g.fillStyle = 'rgba(0,0,0,.06)'; g.fillRect(Math.random() * w, Math.random() * h, 6, 2); }
    noise(g, w, h, 14);
  });
}
export function brick() {
  return make('brick', 256, 256, (g, w, h) => {
    fill(g, w, h, '#7a4a3a');
    g.fillStyle = '#8a5544';
    for (let y = 0; y < h; y += 22) for (let x = ((y / 22) % 2) * 28; x < w; x += 56) g.fillRect(x + 2, y + 2, 52, 18);
    noise(g, w, h, 18);
  });
}
export function skyTex() {
  return make('sky', 512, 512, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#3a6ea5'); grad.addColorStop(0.55, '#8fb8d8'); grad.addColorStop(1, '#e8d9b0');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * w, y = Math.random() * h * 0.5, r = 20 + Math.random() * 60;
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, 'rgba(255,255,255,.55)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
  });
}

const matCache = {};
export function mat(kind, repeatX = 1, repeatY = 1, opts = {}) {
  const key = kind + repeatX + '_' + repeatY + JSON.stringify(opts);
  if (matCache[key]) return matCache[key];
  const texFns = { sand: sandWall, sandstone: sandStone, ground, concrete, metal, wood: crateWood, metalcrate: crateMetal, brick };
  let m;
  if (texFns[kind]) {
    const t = texFns[kind]().clone();
    t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeatX, repeatY);
    m = new THREE.MeshLambertMaterial({ map: t, ...opts });
  } else if (kind.startsWith('tarp:')) {
    const t = tarp(kind.slice(5)).clone(); t.repeat.set(repeatX, repeatY);
    m = new THREE.MeshLambertMaterial({ map: t, ...opts });
  } else {
    m = new THREE.MeshLambertMaterial({ color: kind, ...opts });
  }
  matCache[key] = m;
  return m;
}
