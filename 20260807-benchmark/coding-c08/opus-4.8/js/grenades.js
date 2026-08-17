// grenades.js — projectile physics, HE/flash/smoke/molotov effects & visuals
import * as THREE from 'three';
import { GRENADES } from './weapons_data.js';
import { sfxExplosion, sfxFlash } from './audio.js';
import { rand, angleTo, angleDiff } from './math.js';

const GRAV = 22;

export class GrenadeSystem {
  constructor(scene, world) {
    this.scene = scene; this.world = world;
    this.projectiles = [];
    this.smokes = [];   // {pos, r, tEnd, mesh, growth}
    this.fires = [];    // {pos, r, tEnd, group, lastTick}
    this.effects = [];  // transient explosion visuals
    this.onDamage = null;   // (entity, dmg, attackerTeam, ownerId, isFire)
    this.onFlash = null;    // (entity, strength)
    this.combatants = () => [];
    this.playerCamDir = () => new THREE.Vector3(0,0,-1);
    this.playerPos = () => new THREE.Vector3();
    this.onPlayerFlash = null; // (strength)
    this.onExplosionShake = null;
  }
  throw(type, origin, dir, power, ownerTeam, ownerId) {
    const def = GRENADES[type];
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8),
      new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.5, metalness: 0.3 }));
    mesh.position.copy(origin);
    this.scene.add(mesh);
    const v = dir.clone().normalize().multiplyScalar(power);
    v.y += power * 0.28;
    this.projectiles.push({ type, def, pos: origin.clone(), vel: v, mesh, fuse: def.fuse, armed: 0, ownerTeam, ownerId, bounces: 0 });
  }
  update(dt) {
    // projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.vel.y -= GRAV * dt;
      const np = p.pos.clone().addScaledVector(p.vel, dt);
      p.armed += dt;
      // floor
      if (np.y < 0.09) { np.y = 0.09; p.vel.y = -p.vel.y * 0.42; p.vel.x *= 0.7; p.vel.z *= 0.7; p.bounces++; }
      // walls
      const hit = this.world.grenadeCollide(p.pos, np);
      if (hit.hitX) { p.vel.x = -p.vel.x * 0.5; np.x = p.pos.x; p.bounces++; }
      if (hit.hitZ) { p.vel.z = -p.vel.z * 0.5; np.z = p.pos.z; p.bounces++; }
      p.pos.copy(np); p.mesh.position.copy(np);
      p.mesh.rotation.x += dt * 6; p.mesh.rotation.y += dt * 5;

      if (p.type === 'molotov') {
        if (p.armed > 0.25 && (p.bounces > 0 || np.y <= 0.1)) { this.detonate(p); this._removeProj(i); continue; }
      }
      p.fuse -= dt;
      if (p.fuse <= 0) { this.detonate(p); this._removeProj(i); }
    }
    // smokes
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.age = (s.age || 0) + dt;
      const grow = Math.min(1, s.age / 0.8);
      s.rNow = s.r * grow;
      s.mesh.scale.setScalar(Math.max(0.05, s.rNow));
      const rem = s.tEnd - performance.now() / 1000;
      s.mesh.material.opacity = rem < 1.2 ? Math.max(0, rem / 1.2) * 0.85 : 0.85;
      s.mesh.rotation.y += dt * 0.15;
      if (rem <= 0) { this.scene.remove(s.mesh); this.smokes.splice(i, 1); }
    }
    // fires
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.group.children.forEach((fl, k) => {
        fl.position.y = 0.3 + Math.abs(Math.sin(performance.now() / 200 + k)) * 0.5;
        fl.material.opacity = 0.5 + Math.random() * 0.4;
        fl.scale.setScalar(0.7 + Math.random() * 0.5);
      });
      const t = performance.now() / 1000;
      if (t - f.lastTick > 0.35) {
        f.lastTick = t;
        for (const c of this.combatants()) {
          if (!c.alive) continue;
          const dx = c.pos.x - f.pos.x, dz = c.pos.z - f.pos.z;
          if (dx * dx + dz * dz < f.r * f.r && this.onDamage) this.onDamage(c, 9, f.ownerTeam, f.ownerId, true);
        }
      }
      if (t > f.tEnd) { this.scene.remove(f.group); this.fires.splice(i, 1); }
    }
    // explosion visuals
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i]; e.t += dt;
      e.mesh.scale.setScalar(1 + e.t * 14);
      e.mesh.material.opacity = Math.max(0, 0.9 - e.t * 3);
      if (e.t > 0.4) { this.scene.remove(e.mesh); this.effects.splice(i, 1); }
    }
  }
  _removeProj(i) { this.scene.remove(this.projectiles[i].mesh); this.projectiles.splice(i, 1); }

  detonate(p) {
    const pos = p.pos.clone();
    if (p.type === 'he') {
      sfxExplosion(pos.x, pos.z);
      this._boom(pos, 0xffaa44);
      for (const c of this.combatants()) {
        if (!c.alive) continue;
        const d = Math.sqrt((c.pos.x - pos.x) ** 2 + (c.pos.z - pos.z) ** 2 + (c.pos.y + 1 - pos.y) ** 2);
        if (d < p.def.radius && !this.world.segmentBlocked(pos.x, pos.z, c.pos.x, c.pos.z)) {
          const dmg = p.def.dmg * (1 - d / p.def.radius);
          if (this.onDamage && dmg > 3) this.onDamage(c, dmg, p.ownerTeam, p.ownerId, false);
        }
      }
      const pd = Math.sqrt((this.playerPos().x - pos.x) ** 2 + (this.playerPos().z - pos.z) ** 2);
      if (pd < p.def.radius && this.onExplosionShake) this.onExplosionShake(1 - pd / p.def.radius);
    } else if (p.type === 'flash') {
      sfxFlash(pos.x, pos.z);
      this._boom(pos, 0xffffff);
      // player
      const pp = this.playerPos(); const pdir = this.playerCamDir();
      const toG = new THREE.Vector3(pos.x - pp.x, 0, pos.z - pp.z);
      const pd = toG.length();
      if (pd < p.def.radius && !this.world.segmentBlocked(pos.x, pos.z, pp.x, pp.z)) {
        toG.normalize();
        const facing = Math.max(0, toG.dot(new THREE.Vector3(pdir.x, 0, pdir.z).normalize()));
        const strength = (1 - pd / p.def.radius) * (0.35 + 0.65 * facing);
        if (this.onPlayerFlash) this.onPlayerFlash(strength);
      }
      for (const c of this.combatants()) {
        if (!c.alive || !c.isBot) continue;
        const d = Math.sqrt((c.pos.x - pos.x) ** 2 + (c.pos.z - pos.z) ** 2);
        if (d < p.def.radius && !this.world.segmentBlocked(pos.x, pos.z, c.pos.x, c.pos.z)) {
          const facing = Math.max(0, Math.cos(angleDiff(c.yaw, angleTo(c.pos.x, c.pos.z, pos.x, pos.z))));
          if (this.onFlash) this.onFlash(c, (1 - d / p.def.radius) * (0.4 + 0.6 * facing));
        }
      }
    } else if (p.type === 'smoke') {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12),
        new THREE.MeshStandardMaterial({ color: 0xdedede, transparent: true, opacity: 0, roughness: 1, flatShading: true }));
      mesh.position.set(pos.x, Math.max(1.4, pos.y + 0.6), pos.z);
      this.scene.add(mesh);
      this.smokes.push({ pos: mesh.position.clone(), r: p.def.radius * 0.5, rNow: 0, tEnd: performance.now() / 1000 + 15, mesh, age: 0 });
    } else if (p.type === 'molotov' || p.type === 'fire') {
      this._boom(pos, 0xff6622);
      const group = new THREE.Group(); group.position.set(pos.x, 0, pos.z);
      for (let i = 0; i < 14; i++) {
        const fl = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.1),
          new THREE.MeshBasicMaterial({ color: i % 2 ? 0xff7722 : 0xffcc33, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
        const a = rand(0, 6.28), rr = rand(0, p.def.radius * 0.85);
        fl.position.set(Math.cos(a) * rr, 0.4, Math.sin(a) * rr);
        group.add(fl);
      }
      this.scene.add(group);
      this.fires.push({ pos: pos.clone(), r: p.def.radius, group, tEnd: performance.now() / 1000 + 7, lastTick: 0, ownerTeam: p.ownerTeam, ownerId: p.ownerId });
    }
  }
  _boom(pos, color) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.copy(pos); this.scene.add(m);
    this.effects.push({ mesh: m, t: 0 });
  }
  // LOS blocked by any active smoke between a and b
  smokeBlocks(ax, az, bx, bz) {
    for (const s of this.smokes) {
      if (s.rNow < 0.5) continue;
      // distance from smoke center to segment
      const dx = bx - ax, dz = bz - az;
      const l2 = dx * dx + dz * dz || 1;
      let t = ((s.pos.x - ax) * dx + (s.pos.z - az) * dz) / l2;
      t = Math.max(0, Math.min(1, t));
      const cx = ax + t * dx, cz = az + t * dz;
      const dd = (cx - s.pos.x) ** 2 + (cz - s.pos.z) ** 2;
      if (dd < s.rNow * s.rNow * 0.85) return true;
    }
    return false;
  }
  clear() {
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    for (const s of this.smokes) this.scene.remove(s.mesh);
    for (const f of this.fires) this.scene.remove(f.group);
    for (const e of this.effects) this.scene.remove(e.mesh);
    this.projectiles = []; this.smokes = []; this.fires = []; this.effects = [];
  }
}
