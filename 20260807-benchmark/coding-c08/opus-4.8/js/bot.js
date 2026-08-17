// bot.js — bot combatant: humanoid model, navigation, combat, plant/defuse, grenades
import * as THREE from 'three';
import { WEAPONS, GRENADES } from './weapons_data.js';
import { dist, angleTo, angleLerp, angleDiff, clamp, rand, choice } from './math.js';

export const DIFFS = {
  easy:   { react: 0.55, aimErr: 0.10, aimSpeed: 4.5, range: 55, hsChance: 0.05, grenade: 0.05, hitBase: 0.55, aggression: 0.4 },
  normal: { react: 0.34, aimErr: 0.055, aimSpeed: 7.5, range: 75, hsChance: 0.12, grenade: 0.18, hitBase: 0.72, aggression: 0.6 },
  hard:   { react: 0.20, aimErr: 0.028, aimSpeed: 10.5, range: 95, hsChance: 0.24, grenade: 0.35, hitBase: 0.85, aggression: 0.78 },
  expert: { react: 0.11, aimErr: 0.014, aimSpeed: 14, range: 130, hsChance: 0.40, grenade: 0.5, hitBase: 0.94, aggression: 0.9 },
};

const T_COL = 0x8a5a3a, CT_COL = 0x3a5a7a;

export class Bot {
  constructor(scene, id, name, team, diffName) {
    this.scene = scene; this.id = id; this.name = name; this.isBot = true;
    this.pos = new THREE.Vector3(); this.yaw = 0; this.pitch = 0;
    this.diffName = diffName; this.d = DIFFS[diffName] || DIFFS.normal;
    this.buildModel();
    this.team = team;
    this.alive = false;
    this.path = []; this.pathIdx = 0; this.repathT = 0;
    this.state = 'idle'; this.target = null; this.reactionT = 0; this.fireT = 0; this.reloadT = 0;
    this.plantT = 0; this.defuseT = 0; this.hasBomb = false; this.defuseKit = false;
    this.strafeDir = 1; this.strafeT = 0; this.flash = 0; this.stuckT = 0; this.lastPos = new THREE.Vector3();
    this.grenadeCD = rand(2, 6); this.holdSpot = null; this.searchT = 0;
  }
  buildModel() {
    this.group = new THREE.Group();
    const skin = new THREE.MeshLambertMaterial({ color: 0x000000 });
    this.bodyMat = skin;
    // torso
    this.torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.3), skin);
    this.torso.position.y = 1.05; this.torso.castShadow = true;
    this.torso.userData = { bot: this, part: 'body' };
    // pelvis
    this.pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.35, 0.28), skin);
    this.pelvis.position.y = 0.62; this.pelvis.userData = { bot: this, part: 'body' };
    // head
    this.head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.26),
      new THREE.MeshLambertMaterial({ color: 0xcaa98a }));
    this.head.position.y = 1.58; this.head.castShadow = true;
    this.head.userData = { bot: this, part: 'head' };
    // legs
    const legMat = new THREE.MeshLambertMaterial({ color: 0x2a2a2e });
    this.legL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.62, 0.2), legMat); this.legL.position.set(-0.13, 0.31, 0);
    this.legR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.62, 0.2), legMat); this.legR.position.set(0.13, 0.31, 0);
    this.legL.userData = this.legR.userData = { bot: this, part: 'leg' };
    // arms + gun
    const armMat = skin;
    this.arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), armMat); this.arm.position.set(0.16, 1.05, -0.18); this.arm.rotation.x = -1.2;
    this.gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.6), new THREE.MeshLambertMaterial({ color: 0x1a1a1e }));
    this.gun.position.set(0.16, 1.05, -0.4);
    // muzzle flash
    this.flashMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4),
      new THREE.MeshBasicMaterial({ color: 0xffcc55, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.flashMesh.position.set(0.16, 1.05, -0.72);
    this.group.add(this.torso, this.pelvis, this.head, this.legL, this.legR, this.arm, this.gun, this.flashMesh);
    this.hitMeshes = [this.head, this.torso, this.pelvis, this.legL, this.legR];
    this.scene.add(this.group);
    this.group.visible = false;
  }
  setColor() {
    const c = this.team === 'T' ? T_COL : CT_COL;
    this.torso.material = this.pelvis.material = this.arm.material = new THREE.MeshLambertMaterial({ color: c });
    this.torso.userData = this.pelvis.userData = { bot: this, part: 'body' };
    this.arm.userData = { bot: this, part: 'body' };
  }
  reset(spawn, team, loadout) {
    this.team = team; this.pos.set(spawn.x, 0, spawn.z);
    this.yaw = spawn.angle ?? (team === 'T' ? 0 : Math.PI); this.pitch = 0;
    this.alive = true; this.health = 100; this.armor = loadout.armor || 0; this.helmet = !!loadout.helmet;
    this.weaponId = loadout.weapon || 'glock';
    this.w = WEAPONS[this.weaponId];
    this.ammo = this.w.mag; this.reserve = this.w.reserve;
    this.grenades = (loadout.grenades || []).slice();
    this.defuseKit = !!loadout.defuse;
    this.hasBomb = false; this.state = 'idle'; this.target = null; this.path = []; this.pathIdx = 0;
    this.plantT = 0; this.defuseT = 0; this.flash = 0; this.reloadT = 0; this.fireT = 0;
    this.group.visible = true; this.setColor();
    this.updateModel(0);
  }
  eyeY() { return this.pos.y + 1.5; }
  eyePos() { return new THREE.Vector3(this.pos.x, this.eyeY(), this.pos.z); }

  setDestination(x, z, ctx) {
    this.dest = { x, z };
    this.path = ctx.nav.findPath(this.pos.x, this.pos.z, x, z);
    this.pathIdx = 0; this.repathT = rand(1.5, 3);
  }

  takeDamage(dmg, weapon, headshot) {
    let d = headshot ? dmg * (weapon.hs || 4) : dmg;
    const pen = weapon.armorPen ?? 0.5;
    const headExposed = headshot && !this.helmet;
    if (this.armor > 0 && !headExposed) {
      const toHealth = d * pen; this.armor = Math.max(0, this.armor - (d - toHealth) * 0.5); d = toHealth;
    }
    this.health -= d;
    if (this.health <= 0) { this.health = 0; this.alive = false; }
    return this.health <= 0;
  }
  die() { this.alive = false; this.group.visible = false; }

  update(dt, ctx) {
    if (!this.alive) { this.group.visible = false; return; }
    this.group.visible = true;
    if (this.flash > 0) this.flash -= dt;
    if (this.fireT > 0) this.fireT -= dt;
    if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) { const t = Math.min(this.w.mag - this.ammo, this.reserve); this.ammo += t; this.reserve -= t; } }
    this.flashMesh.material.opacity = Math.max(0, this.flashMesh.material.opacity - dt * 25);

    // perceive
    const seen = this.perceive(ctx);
    this.think(dt, ctx, seen);
    this.updateModel(dt);
  }

  perceive(ctx) {
    let best = null, bd = Infinity;
    const blind = this.flash > 0.3;
    for (const e of ctx.enemies) {
      if (!e.alive) continue;
      const d = dist(this.pos.x, this.pos.z, e.pos.x, e.pos.z);
      if (d > this.d.range) continue;
      if (ctx.world.segmentBlocked(this.pos.x, this.pos.z, e.pos.x, e.pos.z)) continue;
      if (ctx.grenades.smokeBlocks(this.pos.x, this.pos.z, e.pos.x, e.pos.z)) continue;
      // field of view (bots have ~150° awareness, ignore if blind)
      if (blind) continue;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  think(dt, ctx, seen) {
    // combat overrides movement when enemy visible
    if (seen) {
      this.target = seen; this.lastSeen = { x: seen.pos.x, z: seen.pos.z, t: ctx.time };
      if (this.reactionT <= 0) this.reactionT = this.d.react;
      this.reactionT -= dt;
      this.combat(dt, ctx, seen);
      return;
    }
    this.target = null;
    this.reactionT = this.d.react;
    // objective behaviour
    this.objective(dt, ctx);
  }

  combat(dt, ctx, e) {
    // aim toward enemy (lead a touch)
    const desired = angleTo(this.pos.x, this.pos.z, e.pos.x, e.pos.z);
    this.yaw = angleLerp(this.yaw, desired, Math.min(1, dt * this.d.aimSpeed));
    const dy = (e.pos.y + 1.4) - this.eyeY();
    const d = dist(this.pos.x, this.pos.z, e.pos.x, e.pos.z);
    this.pitch = Math.atan2(dy, d);
    // strafe a little for dodging (hard+)
    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafeT = rand(0.4, 1.1); this.strafeDir = choice([-1, 0, 1]); }
    if (this.d.aggression > 0.6 && d > 8) this.strafeMove(dt, ctx, this.strafeDir);
    else this.vel = null;

    // consider grenade
    if (this.grenades.length && this.grenadeCD <= 0 && Math.random() < this.d.grenade * dt && d > 10 && d < 30) {
      this.throwGrenade(ctx, e); return;
    }
    this.grenadeCD -= dt;

    if (this.reloadT > 0) return;
    if (this.ammo <= 0) { this.reloadT = this.w.reload; return; }
    // fire when reaction elapsed and roughly aimed
    const aimOff = Math.abs(angleDiff(this.yaw, desired));
    if (this.reactionT <= 0 && aimOff < 0.18 && this.fireT <= 0) {
      this.fire(ctx, e, d, aimOff);
    }
  }

  fire(ctx, e, d, aimOff) {
    this.fireT = 1 / this.w.rate;
    this.ammo--;
    this.flashMesh.material.opacity = 0.9;
    // hit probability
    let p = this.d.hitBase * (1 - aimOff) * clamp(1 - (d - 10) / this.d.range, 0.25, 1);
    if (this.w.cat === 'sniper') p *= 0.9;
    const hit = Math.random() < p;
    ctx.onShoot(this, e, hit, d);
    if (this.ammo <= 0) this.reloadT = this.w.reload;
  }

  throwGrenade(ctx, e) {
    const type = this.grenades.shift();
    this.grenadeCD = rand(6, 12);
    const origin = this.eyePos();
    const dir = new THREE.Vector3(e.pos.x - origin.x, 2, e.pos.z - origin.z).normalize();
    ctx.grenades.throw(type, origin, dir, 16, this.team, this.id);
  }

  objective(dt, ctx) {
    const bomb = ctx.bomb;
    // T behaviour
    if (this.team === 'T') {
      if (bomb.planted) {
        // defend bomb / hold near it
        this.gotoTag(ctx, bomb.site === 'A' ? 'asite' : 'bsite', 6);
        this.moveAlongPath(dt, ctx);
        return;
      }
      if (this.hasBomb) {
        const site = ctx.objectiveSite;
        const s = ctx.bombsites[site];
        const dd = dist(this.pos.x, this.pos.z, s.x, s.z);
        if (dd < s.r - 0.5) { this.plant(dt, ctx, site); return; }
        this.setDest(ctx, s.x, s.z); this.moveAlongPath(dt, ctx); return;
      }
      // push toward objective site
      this.gotoTag(ctx, ctx.objectiveSite === 'A' ? 'asite' : 'bsite', 5);
      this.moveAlongPath(dt, ctx);
      return;
    }
    // CT behaviour
    if (bomb.planted) {
      const s = ctx.bombsites[bomb.site];
      const dd = dist(this.pos.x, this.pos.z, s.x, s.z);
      if (dd < 2.0) { this.defuse(dt, ctx); return; }
      this.setDest(ctx, s.x, s.z); this.moveAlongPath(dt, ctx); return;
    }
    // hold / patrol a defensive spot
    if (!this.holdSpot || dist(this.pos.x, this.pos.z, this.holdSpot.x, this.holdSpot.z) < 2) {
      if (this.searchT <= 0) {
        const tag = choice(['asite', 'bsite', 'mid', 'plantA', 'plantB']);
        const n = ctx.nav.randomByTag(tag) || ctx.nav.randomByTag('mid');
        if (n) { this.holdSpot = { x: n.x, z: n.z }; this.setDest(ctx, n.x, n.z); }
        this.searchT = rand(4, 9);
      }
    }
    this.searchT -= dt;
    this.moveAlongPath(dt, ctx);
  }

  gotoTag(ctx, tag, closeR) {
    if (!this.dest || (this.destTag !== tag) || this.repathT <= 0) {
      const n = ctx.nav.randomByTag(tag);
      if (n) { this.destTag = tag; this.setDest(ctx, n.x, n.z); }
    }
  }
  setDest(ctx, x, z) {
    if (this.dest && this.dest.x === x && this.dest.z === z && this.path.length) return;
    this.dest = { x, z };
    this.path = ctx.nav.findPath(this.pos.x, this.pos.z, x, z);
    this.pathIdx = 0; this.repathT = rand(2, 4);
  }

  plant(dt, ctx, site) {
    this.plantT += dt; this.state = 'planting';
    if (this.plantT >= 3.2) { ctx.onPlant(this, site); this.hasBomb = false; this.plantT = 0; }
  }
  defuse(dt, ctx) {
    this.defuseT += dt; this.state = 'defusing';
    const need = this.defuseKit ? 5 : 10;
    if (this.defuseT >= need) { ctx.onDefuse(this); this.defuseT = 0; }
  }

  strafeMove(dt, ctx, dir) {
    if (dir === 0) return;
    const right = { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) };
    this.tryMove(dt, right.x * dir, right.z * dir, ctx.world, 4.5);
  }
  moveAlongPath(dt, ctx) {
    this.repathT -= dt;
    if (!this.path || this.pathIdx >= this.path.length) return;
    const wp = this.path[this.pathIdx];
    const d = dist(this.pos.x, this.pos.z, wp.x, wp.z);
    if (d < 1.6) { this.pathIdx++; return; }
    const ang = angleTo(this.pos.x, this.pos.z, wp.x, wp.z);
    this.yaw = angleLerp(this.yaw, ang, Math.min(1, dt * 6));
    const spd = this.w.move * 8.0;
    const dirx = -Math.sin(ang), dirz = -Math.cos(ang);
    const moved = this.tryMove(dt, dirx, dirz, ctx.world, spd);
    // stuck detection
    if (moved < spd * dt * 0.3) { this.stuckT += dt; if (this.stuckT > 0.8) { this.repathT = 0; this.pathIdx++; this.stuckT = 0; } }
    else this.stuckT = 0;
  }
  tryMove(dt, dx, dz, world, spd) {
    const nx = this.pos.x + dx * spd * dt, nz = this.pos.z + dz * spd * dt;
    const res = world.resolveCircle(nx, nz, 0.42, this.pos.y, 1.7);
    const moved = dist(this.pos.x, this.pos.z, res.x, res.z);
    // gravity / floor
    const floor = world.floorAt(res.x, res.z, this.pos.y + 0.4);
    this.pos.set(res.x, floor, res.z);
    return moved;
  }
  updateModel(dt) {
    this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.group.rotation.y = this.yaw;
    // leg walk animation
    const spd = dist(this.pos.x, this.pos.z, this.lastPos.x, this.lastPos.z) / Math.max(dt, 0.001);
    this.walkPhase = (this.walkPhase || 0) + Math.min(spd, 10) * dt * 1.6;
    const sw = Math.sin(this.walkPhase) * 0.4 * Math.min(1, spd / 4);
    this.legL.rotation.x = sw; this.legR.rotation.x = -sw;
    this.lastPos.copy(this.pos);
  }
}
