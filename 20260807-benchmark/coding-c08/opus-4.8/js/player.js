// player.js — first-person player: movement, collision, camera, weapon state
import * as THREE from 'three';
import { WEAPONS, GRENADES, defaultPistol } from './weapons_data.js';
import { clamp } from './math.js';

const EYE_STAND = 1.62, EYE_CROUCH = 1.05, BODY_STAND = 1.8, BODY_CROUCH = 1.3;
const RADIUS = 0.4;
const RUN = 8.2, WALK = 4.2, CROUCH_SPD = 3.4;

export class Player {
  constructor(stage, viewModel) {
    this.stage = stage; this.vm = viewModel;
    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.onGround = true; this.crouch = 0; // 0..1
    this.eye = EYE_STAND;
    this.team = 'CT';
    this.reset({ x: 0, z: 0 }, 'CT');
    // camera recoil
    this.recoilPitch = 0; this.recoilYaw = 0;
    this.shake = 0;
    this.isBot = false; this.name = '你'; this.id = 'player';
  }
  reset(spawn, team, keepLoadout) {
    this.team = team;
    this.pos.set(spawn.x, 0, spawn.z);
    this.yaw = spawn.angle !== undefined ? spawn.angle : (team === 'T' ? Math.PI : 0);
    this.pitch = 0; this.vel.set(0, 0, 0);
    this.health = 100; this.alive = true;
    this.crouch = 0; this.eye = EYE_STAND;
    this.hasBomb = false; this.planting = false; this.defusing = false;
    this.plantProg = 0; this.defuseProg = 0; this.flash = 0;
    this.recoilPitch = 0; this.recoilYaw = 0; this.shake = 0;
    if (keepLoadout && this.inv) {
      this.shotTimer = 0; this.reloadTimer = 0; this.recoilIndex = 0;
      this.switchTimer = 0; this.grenadeThrow = 0;
      if (this.slot === 'g') this.vm.setWeapon('knife'); else this.vm.setWeapon(this.current || this.inv[1]);
    } else {
      this.armor = 0; this.helmet = false; this.defuseKit = false;
      this.initInventory(team);
    }
  }
  initInventory(team) {
    const pistol = defaultPistol(team);
    this.inv = {
      1: pistol, 2: null, 3: 'knife',
      grenades: [], // list of grenade type ids
    };
    this.ammo = {}; this.reserve = {};
    this.addWeaponAmmo(pistol); this.addWeaponAmmo('knife');
    this.slot = 1; this.current = pistol;
    this.shotTimer = 0; this.reloadTimer = 0; this.recoilIndex = 0; this.recoilCooldown = 0;
    this.switchTimer = 0; this.grenadeThrow = 0;
    this.vm.setWeapon(this.current);
  }
  addWeaponAmmo(id) {
    const w = WEAPONS[id]; if (!w) return;
    this.ammo[id] = w.mag; this.reserve[id] = w.reserve;
  }
  giveWeapon(id) {
    const w = WEAPONS[id]; if (!w) return;
    const slot = w.slot;
    this.inv[slot] = id; this.addWeaponAmmo(id);
    this.switchTo(slot);
  }
  giveGrenade(type) {
    const count = this.inv.grenades.filter(g => g === type).length;
    const max = type === 'flash' ? 2 : 1;
    if (count >= max) return false;
    if (this.inv.grenades.length >= 4) return false;
    this.inv.grenades.push(type); return true;
  }
  giveArmor(helmet) { this.armor = 100; this.helmet = helmet; }
  weapon() { return WEAPONS[this.current] || WEAPONS.knife; }

  switchTo(slot) {
    if (slot === 'g') {
      if (!this.inv.grenades.length) return;
      this.slot = 'g'; this.current = 'nade:' + this.inv.grenades[0];
      this.curNade = this.inv.grenades[0];
      this.vm.setWeapon('knife'); // hand model for nade
      this.switchTimer = 0.3; return;
    }
    const id = this.inv[slot]; if (!id) return;
    this.slot = slot; this.current = id; this.switchTimer = 0.35;
    this.vm.setWeapon(id); this.reloadTimer = 0; this.recoilIndex = 0;
  }
  nextGrenade() {
    if (!this.inv.grenades.length) return;
    const i = this.inv.grenades.indexOf(this.curNade);
    this.curNade = this.inv.grenades[(i + 1) % this.inv.grenades.length];
    this.current = 'nade:' + this.curNade;
  }

  camDir() {
    const cp = Math.cos(this.pitch + this.recoilPitch), sp = Math.sin(this.pitch + this.recoilPitch);
    const cy = Math.cos(this.yaw + this.recoilYaw), sy = Math.sin(this.yaw + this.recoilYaw);
    return new THREE.Vector3(-sy * cp, sp, -cy * cp); // matches camera rotation.y = yaw
  }
  eyePos() { return new THREE.Vector3(this.pos.x, this.pos.y + this.eye, this.pos.z); }

  addRecoil(up, yaw) { this.recoilPitch += up; this.recoilYaw += yaw; this.recoilCooldown = 0.12; }

  update(dt, world, input, moveEnabled) {
    if (!this.alive) return;
    // look
    if (input) { this.yaw -= input.mouseDX; this.pitch = clamp(this.pitch - input.mouseDY, -1.5, 1.5); }
    // recoil recovery
    const rec = Math.min(1, dt * 7);
    this.recoilPitch += (0 - this.recoilPitch) * rec;
    this.recoilYaw += (0 - this.recoilYaw) * rec;
    if (this.shake > 0) this.shake -= dt;

    // crouch
    const wantCrouch = moveEnabled && input && input.keys['ControlLeft'];
    this.crouch += ((wantCrouch ? 1 : 0) - this.crouch) * Math.min(1, dt * 12);
    this.eye = EYE_STAND + (EYE_CROUCH - EYE_STAND) * this.crouch;
    const bodyH = BODY_STAND + (BODY_CROUCH - BODY_STAND) * this.crouch;

    // movement input
    let ix = 0, iz = 0, walking = false;
    if (moveEnabled && input) {
      if (input.keys['KeyW']) iz += 1; if (input.keys['KeyS']) iz -= 1;
      if (input.keys['KeyA']) ix -= 1; if (input.keys['KeyD']) ix += 1;
      walking = input.keys['ShiftLeft'];
    }
    const len = Math.hypot(ix, iz);
    let speed = this.crouch > 0.5 ? CROUCH_SPD : (walking ? WALK : RUN);
    speed *= this.weapon().move || 1;
    if (len > 0) { ix /= len; iz /= len; }
    // basis matching THREE camera (rotation.y = yaw): forward = (-sin,-cos), right = (cos,-sin)
    const fwd = { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
    const right = { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) };
    let dx = right.x * ix + fwd.x * iz;
    let dz = right.z * ix + fwd.z * iz;
    const dl = Math.hypot(dx, dz); if (dl > 0) { dx /= dl; dz /= dl; }

    // accelerate (ground) / air control
    const accel = this.onGround ? 60 : 12;
    this.vel.x += dx * accel * dt;
    this.vel.z += dz * accel * dt;
    // clamp horizontal speed
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > speed) { this.vel.x *= speed / hs; this.vel.z *= speed / hs; }
    // friction
    if (this.onGround && dl === 0) {
      const f = Math.max(0, 1 - dt * 11);
      this.vel.x *= f; this.vel.z *= f;
    }
    // jump
    if (moveEnabled && input && input.keys['Space'] && this.onGround) {
      this.vel.y = 7.4; this.onGround = false;
    }
    // gravity
    this.vel.y -= 22 * dt;

    // integrate + collide
    let nx = this.pos.x + this.vel.x * dt;
    let nz = this.pos.z + this.vel.z * dt;
    const res = world.resolveCircle(nx, nz, RADIUS, this.pos.y, bodyH);
    if (res.x !== nx) this.vel.x *= 0.2; if (res.z !== nz) this.vel.z *= 0.2;
    nx = res.x; nz = res.z;
    let ny = this.pos.y + this.vel.y * dt;
    const floor = world.floorAt(nx, nz, this.pos.y + 0.4);
    if (ny <= floor + 0.001) { ny = floor; this.vel.y = 0; this.onGround = true; }
    else this.onGround = false;
    this.pos.set(nx, ny, nz);

    // speed for bob
    this._speed = Math.hypot(this.vel.x, this.vel.z);
    this._walking = walking;

    // camera
    const cam = this.stage.camera;
    let sx = 0, sy2 = 0;
    if (this.shake > 0) { sx = (Math.random() - 0.5) * this.shake * 0.06; sy2 = (Math.random() - 0.5) * this.shake * 0.06; }
    cam.position.set(this.pos.x, this.pos.y + this.eye, this.pos.z);
    cam.rotation.order = 'YXZ';
    cam.rotation.y = this.yaw + this.recoilYaw + sx;
    cam.rotation.x = this.pitch + this.recoilPitch + sy2;

    // timers
    if (this.shotTimer > 0) this.shotTimer -= dt;
    if (this.switchTimer > 0) this.switchTimer -= dt;
    if (this.grenadeThrow > 0) this.grenadeThrow -= dt;
    if (this.recoilCooldown > 0) { this.recoilCooldown -= dt; if (this.recoilCooldown <= 0) this.recoilIndex = 0; }
    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) this.finishReload();
    }
    if (this.flash > 0) this.flash -= dt;
  }

  startReload() {
    const w = this.weapon();
    if (w.cat === 'knife' || this.reloadTimer > 0) return;
    if (this.ammo[this.current] >= w.mag || this.reserve[this.current] <= 0) return;
    this.reloadTimer = w.reload; this.vm.startReload(w.reload);
  }
  finishReload() {
    const w = this.weapon(); const id = this.current;
    const need = w.mag - this.ammo[id];
    const take = Math.min(need, this.reserve[id]);
    this.ammo[id] += take; this.reserve[id] -= take;
    this.vm.reloadDur = 0;
  }
  canFire() {
    return this.alive && this.shotTimer <= 0 && this.reloadTimer <= 0 && this.switchTimer <= 0;
  }
  takeDamage(dmg, weapon, headshot) {
    let d = headshot ? dmg * (weapon.hs || 4) : dmg;
    const pen = weapon.armorPen ?? 0.5;
    const headExposed = headshot && !this.helmet;
    if (this.armor > 0 && !headExposed) {
      const toHealth = d * pen;
      const toArmor = (d - toHealth) * 0.5;
      this.armor = Math.max(0, this.armor - toArmor);
      d = toHealth;
    }
    this.health -= d;
    this.shake = Math.min(1, this.shake + d / 55);
    if (this.health <= 0) { this.health = 0; this.alive = false; }
    return this.health <= 0;
  }
}
