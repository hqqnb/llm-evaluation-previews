// map_builder.js — World (collision, LOS, floor sampling) + builds meshes from map data
import * as THREE from 'three';
import { mat } from './textures.js';

export class World {
  constructor() {
    this.boxes = [];   // {minX,maxX,minZ,maxZ,y0,y1,tall}
    this.ramps = [];   // {minX,maxX,minZ,maxZ,y0,y1,axis,asc}
    this.stepUp = 0.65;
  }
  addBox(minX, maxX, minZ, maxZ, y0, y1) {
    this.boxes.push({ minX, maxX, minZ, maxZ, y0, y1, tall: (y1 - y0) > 1.1 && y1 > 1.3 });
  }
  addRamp(x, z, w, d, y0, y1, axis, asc) {
    this.ramps.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, y0, y1, axis, asc });
  }
  // floor height under (x,z) reachable from feetY
  floorAt(x, z, feetY) {
    let best = 0;
    for (const r of this.ramps) {
      if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) {
        let t = r.axis === 'x' ? (x - r.minX) / (r.maxX - r.minX) : (z - r.minZ) / (r.maxZ - r.minZ);
        if (!r.asc) t = 1 - t;
        const h = r.y0 + (r.y1 - r.y0) * t;
        if (h <= feetY + this.stepUp && h > best) best = h;
      }
    }
    for (const b of this.boxes) {
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) {
        if (b.y1 <= feetY + this.stepUp && b.y1 > best) best = b.y1;
      }
    }
    return best;
  }
  // ceiling above (x,z) for feetY (min y1 bottom above head) — used to prevent standing inside
  // resolve a circle (radius rad, body from feetY..feetY+height) against boxes; returns adjusted {x,z}
  resolveCircle(x, z, rad, feetY, height) {
    const top = feetY + height;
    for (let iter = 0; iter < 2; iter++) {
      for (const b of this.boxes) {
        // vertical overlap?
        if (b.y1 <= feetY + 0.05 || b.y0 >= top - 0.02) continue;
        const cx = Math.max(b.minX, Math.min(x, b.maxX));
        const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
        const dx = x - cx, dz = z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 < rad * rad) {
          if (d2 > 1e-6) {
            const d = Math.sqrt(d2); const push = rad - d;
            x += (dx / d) * push; z += (dz / d) * push;
          } else {
            // center inside box: push out along least penetration axis
            const pL = x - b.minX, pR = b.maxX - x, pB = z - b.minZ, pT = b.maxZ - z;
            const m = Math.min(pL, pR, pB, pT);
            if (m === pL) x = b.minX - rad; else if (m === pR) x = b.maxX + rad;
            else if (m === pB) z = b.minZ - rad; else z = b.maxZ + rad;
          }
        }
      }
    }
    return { x, z };
  }
  // 2D line of sight blocked by any tall box
  segmentBlocked(ax, az, bx, bz) {
    for (const b of this.boxes) {
      if (!b.tall) continue;
      if (segBox(ax, az, bx, bz, b)) return true;
    }
    return false;
  }
  // grenade wall collision — returns which axes were crossed
  grenadeCollide(from, to) {
    let hitX = false, hitZ = false;
    for (const b of this.boxes) {
      if (b.y0 > Math.max(from.y, to.y) || b.y1 < Math.min(from.y, to.y) - 0.1) continue;
      const inZ = to.z > b.minZ - 0.09 && to.z < b.maxZ + 0.09;
      const inX = to.x > b.minX - 0.09 && to.x < b.maxX + 0.09;
      if (inX && inZ) {
        // decide axis by which was outside at 'from'
        if (from.x <= b.minX || from.x >= b.maxX) hitX = true;
        if (from.z <= b.minZ || from.z >= b.maxZ) hitZ = true;
        if (!hitX && !hitZ) hitX = true;
      }
    }
    return { hitX, hitZ };
  }
  // bullet ray vs walls (2D at shoot height), returns distance to nearest wall or Infinity
  bulletWall(ox, oz, dx, dz, maxDist, shootY) {
    let best = maxDist;
    for (const b of this.boxes) {
      if (b.y1 < shootY - 0.05 || b.y0 > shootY + 0.05) continue;
      const t = rayBox(ox, oz, dx, dz, b);
      if (t >= 0 && t < best) best = t;
    }
    return best;
  }
}

function segBox(ax, az, bx, bz, b) {
  // Liang-Barsky segment vs AABB
  let t0 = 0, t1 = 1; const dx = bx - ax, dz = bz - az;
  const p = [-dx, dx, -dz, dz];
  const q = [ax - b.minX, b.maxX - ax, az - b.minZ, b.maxZ - az];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-9) { if (q[i] < 0) return false; }
    else { const r = q[i] / p[i]; if (p[i] < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; } }
  }
  return t0 <= t1;
}
function rayBox(ox, oz, dx, dz, b) {
  let tmin = 0, tmax = Infinity;
  for (const [o, d, mn, mx] of [[ox, dx, b.minX, b.maxX], [oz, dz, b.minZ, b.maxZ]]) {
    if (Math.abs(d) < 1e-9) { if (o < mn || o > mx) return -1; }
    else { let t1 = (mn - o) / d, t2 = (mx - o) / d; if (t1 > t2) [t1, t2] = [t2, t1]; tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmin > tmax) return -1; }
  }
  return tmin;
}

// ===== build scene meshes =====
export function buildMap(scene, data) {
  const world = new World();
  const group = new THREE.Group(); scene.add(group);

  // ground
  const gsize = Math.max(data.bounds.maxX - data.bounds.minX, data.bounds.maxZ - data.bounds.minZ) + 40;
  const gcx = (data.bounds.minX + data.bounds.maxX) / 2, gcz = (data.bounds.minZ + data.bounds.maxZ) / 2;
  const groundMat = mat(data.groundTex || 'ground', gsize / 6, gsize / 6);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(gsize, gsize), groundMat);
  ground.rotation.x = -Math.PI / 2; ground.position.set(gcx, 0, gcz); ground.receiveShadow = true;
  group.add(ground);

  // perimeter walls
  const b = data.bounds, PH = 9, T = 2;
  const peri = [
    [b.minX - T / 2, b.maxX + T / 2, b.minZ - T, b.minZ], // south full
    [b.minX - T / 2, b.maxX + T / 2, b.maxZ, b.maxZ + T], // north
    [b.minX - T, b.minX, b.minZ - T, b.maxZ + T],
    [b.maxX, b.maxX + T, b.minZ - T, b.maxZ + T],
  ];
  for (const [x0, x1, z0, z1] of peri) addWallMesh(group, world, (x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, PH, 0, data.wallTex || 'sand');

  // walls
  for (const w of data.walls || []) addWallMesh(group, world, w.x, w.z, w.w, w.d, w.h, w.y || 0, w.tex || data.wallTex || 'sand');
  // covers / crates
  for (const c of data.covers || []) addCrate(group, world, c);
  // ramps
  for (const r of data.ramps || []) addRamp(group, world, r, data.wallTex);
  // decorative platforms (walkable boxes already added as covers/walls)

  // bombsite markers
  data._siteMeshes = {};
  for (const key of ['A', 'B']) {
    const s = data.bombsites[key]; if (!s) continue;
    const ring = new THREE.Mesh(new THREE.RingGeometry(s.r - 0.3, s.r, 32),
      new THREE.MeshBasicMaterial({ color: 0xffcc33, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(s.x, (s.y || 0) + 0.05, s.z);
    group.add(ring);
    // letter sprite
    const spr = makeTextSprite(key, '#ffcc33');
    spr.position.set(s.x, (s.y || 0) + 2.4, s.z); spr.scale.set(2.4, 2.4, 1);
    group.add(spr);
    data._siteMeshes[key] = ring;
  }

  world.data = data;
  return { world, group };
}

function addWallMesh(group, world, x, z, w, d, h, y, tex) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
    mat(tex, Math.max(1, w / 3), Math.max(1, h / 3)));
  m.position.set(x, y + h / 2, z); m.castShadow = true; m.receiveShadow = true;
  group.add(m);
  world.addBox(x - w / 2, x + w / 2, z - d / 2, z + d / 2, y, y + h);
}
function addCrate(group, world, c) {
  const tex = c.tex || 'wood';
  const m = new THREE.Mesh(new THREE.BoxGeometry(c.w, c.h, c.d), mat(tex, 1, 1));
  m.position.set(c.x, (c.y || 0) + c.h / 2, c.z); m.castShadow = true; m.receiveShadow = true;
  group.add(m);
  world.addBox(c.x - c.w / 2, c.x + c.w / 2, c.z - c.d / 2, c.z + c.d / 2, c.y || 0, (c.y || 0) + c.h);
}
function addRamp(group, world, r, wallTex) {
  const len = r.axis === 'x' ? r.w : r.d;
  const rise = r.y1 - r.y0;
  const angle = Math.atan2(rise, len);
  const slabLen = Math.sqrt(len * len + rise * rise);
  const geo = new THREE.BoxGeometry(r.axis === 'x' ? slabLen : r.w, 0.3, r.axis === 'x' ? r.d : slabLen);
  const m = new THREE.Mesh(geo, mat(r.tex || wallTex || 'sand', 2, 2));
  m.position.set(r.x, (r.y0 + r.y1) / 2, r.z);
  if (r.axis === 'x') m.rotation.z = r.asc ? -angle : angle;
  else m.rotation.x = r.asc ? angle : -angle;
  m.castShadow = true; m.receiveShadow = true; group.add(m);
  world.addRamp(r.x, r.z, r.w, r.d, r.y0, r.y1, r.axis, r.asc);
  // side skirt for looks / to block under-ramp
  world.addBox(r.x - r.w / 2, r.x + r.w / 2, r.z - r.d / 2, r.z + r.d / 2, 0, 0.1);
}

export function makeTextSprite(text, color) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, 128, 128);
  g.font = 'bold 96px Arial'; g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 64, 68);
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  return spr;
}
