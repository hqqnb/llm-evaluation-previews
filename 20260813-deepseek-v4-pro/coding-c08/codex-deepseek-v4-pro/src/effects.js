// ============================================================================
// 特效系统：枪口焰、曳光、弹壳、火花、弹痕、烟雾、爆炸、燃烧
// ============================================================================

import * as THREE from "three";
import { makeCanvas, rand, clamp } from "./util.js";

function glowTexture(inner = "rgba(255,255,255,1)", outer = "rgba(255,255,255,0)") {
  const [c, ctx] = makeCanvas(128, 128);
  const grd = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.35, inner.replace(",1)", ",0.8)"));
  grd.addColorStop(1, outer);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  return t;
}

function smokeTexture() {
  const [c, ctx] = makeCanvas(128, 128);
  const grd = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
  grd.addColorStop(0, "rgba(210,210,205,0.85)");
  grd.addColorStop(0.6, "rgba(170,170,168,0.5)");
  grd.addColorStop(1, "rgba(150,150,150,0)");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

const TEX = {
  glow: glowTexture(),
  glowOrange: glowTexture("rgba(255,220,120,1)", "rgba(255,120,20,0)"),
  glowRed: glowTexture("rgba(255,180,90,1)", "rgba(255,60,10,0)"),
  smoke: smokeTexture(),
  spark: glowTexture("rgba(255,255,220,1)", "rgba(255,180,60,0)"),
};

class Pool {
  constructor(make, size) {
    this.items = [];
    this.free = [];
    this.make = make;
    for (let i = 0; i < size; i++) {
      const it = make();
      it.visible = false;
      this.items.push(it);
      this.free.push(it);
    }
  }
  get() { return this.free.pop() || null; }
  release(it) { it.visible = false; this.free.push(it); }
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.frustumCulled = false;
    scene.add(this.group);
    this.shake = 0;
    this.shakeAmt = 0;

    this.tracers = new Pool(() => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
      const m = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
      const l = new THREE.Line(g, m);
      l.frustumCulled = false;
      this.group.add(l);
      l.userData.life = 0;
      return l;
    }, 40);

    this.casings = new Pool(() => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.045, 6),
        new THREE.MeshStandardMaterial({ color: 0xc9a84a, roughness: 0.35, metalness: 0.9 }));
      this.group.add(m);
      m.userData.vel = new THREE.Vector3();
      m.userData.life = 0;
      return m;
    }, 50);

    this.sparks = new Pool(() => {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.spark, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.scale.setScalar(0.1);
      this.group.add(m);
      m.userData.vel = new THREE.Vector3();
      m.userData.life = 0;
      return m;
    }, 60);

    this.debris = new Pool(() => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08),
        new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.9 }));
      m.castShadow = true;
      this.group.add(m);
      m.userData.vel = new THREE.Vector3();
      m.userData.rot = new THREE.Vector3();
      m.userData.life = 0;
      return m;
    }, 40);

    this.smokes = new Pool(() => {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.smoke, transparent: true, depthWrite: false, opacity: 0.55 }));
      this.group.add(m);
      m.userData.life = 0;
      m.userData.max = 1;
      m.userData.drift = new THREE.Vector3();
      return m;
    }, 90);

    this.flashes = new Pool(() => {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
      this.group.add(m);
      m.userData.life = 0;
      return m;
    }, 20);

    this.decalGeom = new THREE.CircleGeometry(1, 12);
    this.decals = [];
    this.decalMat = new THREE.MeshBasicMaterial({ color: 0x141210, transparent: true, opacity: 0.62, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });

    // 爆炸光环
    this.rings = new Pool(() => {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 28),
        new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.group.add(m);
      m.userData.life = 0;
      return m;
    }, 8);

    this.pointLight = new THREE.PointLight(0xffc070, 0, 14, 1.8);
    this.group.add(this.pointLight);
    this.lightT = 0;
    this.heatLight = new THREE.PointLight(0xff6a20, 0, 12, 1.5);
    this.group.add(this.heatLight);

    // 烟雾遮挡体积（供 AI 视线）
    this.smokeVolumes = [];
  }

  update(dt) {
    this.shake = Math.max(0, this.shake - dt * 2.2);
    for (const t of this.tracers.items) {
      if (!t.visible) continue;
      t.userData.life -= dt;
      t.material.opacity = clamp(t.userData.life * 12, 0, 1);
      if (t.userData.life <= 0) this.tracers.release(t);
    }
    for (const c of this.casings.items) {
      if (!c.visible) continue;
      c.userData.life -= dt;
      c.userData.vel.y -= 14 * dt;
      c.position.addScaledVector(c.userData.vel, dt);
      c.rotation.x += dt * 12;
      if (c.position.y < 0.015) { c.position.y = 0.015; c.userData.vel.set(0, 0, 0); }
      if (c.userData.life <= 0) this.casings.release(c);
    }
    for (const s of this.sparks.items) {
      if (!s.visible) continue;
      s.userData.life -= dt;
      s.userData.vel.y -= 9 * dt;
      s.position.addScaledVector(s.userData.vel, dt);
      s.material.opacity = clamp(s.userData.life * 5, 0, 1);
      if (s.userData.life <= 0) this.sparks.release(s);
    }
    for (const db of this.debris.items) {
      if (!db.visible) continue;
      db.userData.life -= dt;
      db.userData.vel.y -= 16 * dt;
      db.position.addScaledVector(db.userData.vel, dt);
      db.rotation.x += db.userData.rot.x * dt;
      db.rotation.y += db.userData.rot.y * dt;
      if (db.userData.life <= 0) this.debris.release(db);
    }
    for (const s of this.smokes.items) {
      if (!s.visible) continue;
      s.userData.life -= dt;
      const t = 1 - s.userData.life / s.userData.max;
      s.position.addScaledVector(s.userData.drift, dt);
      s.scale.setScalar(s.userData.size * (1 + t * 1.4));
      const fadeIn = clamp(t * 4, 0, 1);
      const fadeOut = clamp(s.userData.life / 3, 0, 1);
      s.material.opacity = 0.5 * Math.min(fadeIn, fadeOut) * s.userData.opacity;
      if (s.userData.life <= 0) this.smokes.release(s);
    }
    for (const f of this.flashes.items) {
      if (!f.visible) continue;
      f.userData.life -= dt;
      f.material.opacity = clamp(f.userData.life * 10, 0, 1);
      if (f.userData.life <= 0) this.flashes.release(f);
    }
    for (const r of this.rings.items) {
      if (!r.visible) continue;
      r.userData.life -= dt;
      const t = 1 - r.userData.life / 0.45;
      r.scale.setScalar(1 + t * 7);
      r.material.opacity = clamp(r.userData.life * 2.5, 0, 0.9);
      if (r.userData.life <= 0) this.rings.release(r);
    }
    this.lightT = Math.max(0, this.lightT - dt);
    this.pointLight.intensity = this.lightT > 0 ? 22 : 0;
    for (let i = this.smokeVolumes.length - 1; i >= 0; i--) {
      const v = this.smokeVolumes[i];
      v.t += dt;
      if (v.t > v.life) this.smokeVolumes.splice(i, 1);
    }
  }

  muzzle(pos, dir, color = 0xffd27a) {
    const f = this.flashes.get();
    if (!f) return;
    f.position.copy(pos);
    f.position.addScaledVector(dir, 0.12);
    f.scale.setScalar(0.35);
    f.material.map = TEX.glow;
    f.material.color.setHex(color);
    f.userData.life = 0.055;
    f.visible = true;
    this.pointLight.position.copy(f.position);
    this.lightT = 0.045;
    this.pointLight.color.setHex(color);
  }

  tracer(from, to, color = 0xffd27a) {
    const t = this.tracers.get();
    if (!t) return;
    const arr = t.geometry.attributes.position.array;
    arr[0] = from.x; arr[1] = from.y; arr[2] = from.z;
    arr[3] = to.x; arr[4] = to.y; arr[5] = to.z;
    t.geometry.attributes.position.needsUpdate = true;
    t.material.color.setHex(color);
    t.userData.life = 0.09;
    t.visible = true;
  }

  casing(pos, dir, right) {
    const c = this.casings.get();
    if (!c) return;
    c.position.copy(pos);
    c.userData.vel.copy(right).multiplyScalar(rand(1.4, 2.4));
    c.userData.vel.add(dir.clone().multiplyScalar(rand(-0.3, 0.2)));
    c.userData.vel.y = rand(1.4, 2.4);
    c.userData.life = 1.1;
    c.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
    c.visible = true;
  }

  impact(pos, normal, hard = true) {
    for (let i = 0; i < (hard ? 4 : 2); i++) {
      const s = this.sparks.get();
      if (!s) break;
      s.position.copy(pos);
      s.userData.vel.copy(normal).multiplyScalar(rand(1.2, 3.4));
      s.userData.vel.x += rand(-1.4, 1.4);
      s.userData.vel.y += rand(-0.6, 1.6);
      s.userData.vel.z += rand(-1.4, 1.4);
      s.userData.life = rand(0.1, 0.3);
      s.scale.setScalar(rand(0.05, 0.12));
      s.visible = true;
    }
    // 弹痕
    if (this.decals.length > 120) {
      const old = this.decals.shift();
      this.group.remove(old);
      old.geometry.dispose();
    }
    const d = new THREE.Mesh(this.decalGeom, this.decalMat);
    d.position.copy(pos).addScaledVector(normal, 0.015);
    d.lookAt(pos.clone().add(normal));
    const sz = rand(0.12, 0.24);
    d.scale.setScalar(sz);
    d.userData.life = 30;
    this.decals.push(d);
    this.group.add(d);
  }

  blood(pos, dir) {
    for (let i = 0; i < 5; i++) {
      const s = this.sparks.get();
      if (!s) break;
      s.position.copy(pos);
      s.userData.vel.copy(dir).multiplyScalar(rand(0.5, 1.6));
      s.userData.vel.x += rand(-1, 1);
      s.userData.vel.y += rand(0.2, 1.8);
      s.userData.vel.z += rand(-1, 1);
      s.userData.life = rand(0.18, 0.4);
      s.scale.setScalar(rand(0.05, 0.1));
      s.material.map = TEX.glowRed;
      s.material.color.setHex(0x8a1810);
      s.visible = true;
    }
  }

  flash(pos, normal) {
    const f = this.flashes.get();
    if (!f) return;
    f.position.copy(pos).addScaledVector(normal, 0.05);
    f.scale.setScalar(0.2);
    f.material.map = TEX.glow;
    f.material.color.setHex(0xffffff);
    f.userData.life = 0.08;
    f.visible = true;
    this.pointLight.position.copy(f.position);
    this.pointLight.color.setHex(0xffffff);
    this.lightT = 0.05;
  }

  explosion(pos) {
    // 大闪光 + 光环 + 碎屑 + 烟雾
    const f = this.flashes.get();
    if (f) {
      f.position.copy(pos);
      f.scale.setScalar(2.6);
      f.material.map = TEX.glowOrange;
      f.material.color.setHex(0xffffff);
      f.userData.life = 0.28;
      f.visible = true;
    }
    const r = this.rings.get();
    if (r) {
      r.position.copy(pos);
      r.position.y += 0.15;
      r.rotation.x = -Math.PI / 2;
      r.scale.setScalar(1);
      r.userData.life = 0.45;
      r.visible = true;
    }
    this.pointLight.position.copy(pos);
    this.pointLight.color.setHex(0xffa040);
    this.lightT = 0.22;
    for (let i = 0; i < 14; i++) {
      const db = this.debris.get();
      if (!db) break;
      db.position.copy(pos);
      const a = rand(0, Math.PI * 2), up = rand(0.4, 1);
      db.userData.vel.set(Math.cos(a) * rand(2, 8), rand(3, 8) * up, Math.sin(a) * rand(2, 8));
      db.userData.rot.set(rand(-8, 8), rand(-8, 8), rand(-8, 8));
      db.userData.life = rand(0.5, 1.1);
      db.visible = true;
    }
    for (let i = 0; i < 10; i++) this.smokePuff(pos, rand(0.7, 1.5), rand(2.5, 4.5), rand(0.16, 0.3));
    this.shake = 1;
    this.shakeAmt = 0.22;
  }

  smokePuff(pos, size, life, opacity = 0.5, color = 0xffffff) {
    const s = this.smokes.get();
    if (!s) return;
    s.position.copy(pos).add(new THREE.Vector3(rand(-0.4, 0.4), rand(-0.2, 0.4), rand(-0.4, 0.4)));
    s.scale.setScalar(size);
    s.material.color.setHex(color);
    s.userData.size = size;
    s.userData.max = life;
    s.userData.life = life;
    s.userData.opacity = opacity;
    s.userData.drift.set(rand(-0.5, 0.5), rand(0.4, 0.9), rand(-0.5, 0.5));
    s.visible = true;
  }

  smokeGrenade(pos) {
    for (let i = 0; i < 12; i++) {
      const s = this.smokes.get();
      if (!s) break;
      const off = new THREE.Vector3(rand(-1, 1), rand(0, 1.8), rand(-1, 1));
      s.position.copy(pos).add(off);
      s.scale.setScalar(rand(1.2, 2.2));
      s.material.color.setHex(0xb8b8b4);
      s.userData.size = rand(1.4, 2.6);
      s.userData.max = rand(14, 18);
      s.userData.life = s.userData.max;
      s.userData.opacity = 0.5;
      s.userData.drift.set(rand(-0.8, 0.8), rand(0.4, 1.0), rand(-0.8, 0.8));
      s.visible = true;
    }
    // 阻挡 AI 视线的体积
    this.smokeVolumes.push({ pos: pos.clone(), r: 3.2, t: 0, life: 16, max: 16 });
    this.smokeVolumes.push({ pos: pos.clone().add(new THREE.Vector3(0, 1.2, 0)), r: 2.6, t: 0, life: 18, max: 18 });
  }

  fireZone(pos, life = 7) {
    for (let i = 0; i < 8; i++) {
      const s = this.smokes.get();
      if (!s) break;
      s.position.copy(pos).add(new THREE.Vector3(rand(-1.3, 1.3), 0.25, rand(-1.3, 1.3)));
      s.scale.setScalar(rand(0.4, 0.8));
      s.material.map = TEX.glowOrange;
      s.material.color.setHex(0xff7a20);
      s.userData.size = rand(0.4, 0.9);
      s.userData.max = rand(0.5, 1.1);
      s.userData.life = s.userData.max;
      s.userData.opacity = 0.75;
      s.userData.drift.set(rand(-0.4, 0.4), rand(1.2, 2.6), rand(-0.4, 0.4));
      s.visible = true;
    }
    this.heatLight.position.copy(pos).add(new THREE.Vector3(0, 0.5, 0));
    this.heatLight.intensity = 8;
    this.fireLife = life;
    this._fireFade = 0;
  }

  smokeDensity(a, b) {
    let d = 0;
    for (const v of this.smokeVolumes) {
      const t = v.t / v.max;
      const dens = (1 - t * t) * (t < 0.25 ? t / 0.25 : 1);
      // 线段到球心距离
      const ab = new THREE.Vector3().subVectors(b, a);
      const len = ab.length();
      if (len < 0.01) continue;
      const ap = new THREE.Vector3().subVectors(v.pos, a);
      const tProj = clamp(ap.dot(ab) / (len * len), 0, 1);
      const closest = a.clone().addScaledVector(ab, tProj);
      const dist = closest.distanceTo(v.pos);
      if (dist < v.r * (0.5 + 0.5 * (1 - t))) d += dens * (1 - dist / v.r);
    }
    return d;
  }
}
