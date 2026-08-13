// ============================================================================
// 武器系统：射击、后坐力、散布、换弹、切枪、开镜、近战、视图模型动画
// ============================================================================

import * as THREE from "three";
import { WEAPONS, G } from "./config.js";
import { clamp, lerp, rand } from "./util.js";
import { AudioSys } from "./audio.js";
import { buildViewModel, buildWorldGun } from "./viewmodel.js";

const VM_BASE = new THREE.Vector3(0.205, -0.185, -0.42);

export class WeaponController {
  constructor(player, game) {
    this.player = player;
    this.game = game;
    this.group = null;
    this.parts = null;
    this.muzzleLocal = new THREE.Vector3();
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
    this.lastFireT = -10;
    this.lastDrawSound = -10;
    this.buildFor(player.weaponId());
  }

  buildFor(id) {
    if (this.group) {
      this.group.parent?.remove(this.group);
      disposeGroup(this.group);
    }
    const vm = buildViewModel(id);
    this.group = vm.group;
    this.parts = vm.parts;
    this.muzzleLocal = (vm.muzzle ?? vm.parts?.muzzle).clone();
    this.group.visible = false;
    this.game.scene.add(this.group);
    this.applyPose(0, true);
  }

  destroy() {
    if (this.group) {
      this.game.scene.remove(this.group);
      disposeGroup(this.group);
      this.group = null;
    }
  }

  muzzleWorld() {
    return this.muzzleLocal.clone().applyMatrix4(this.group.matrixWorld);
  }

  update(dt) {
    const p = this.player;
    const def = p.weaponDef();
    const id = p.weaponId();
    // 开镜过渡
    const targetZoom = (p.zoomed && def?.zoom) ? 1 : 0;
    p.zoomT = lerp(p.zoomT, targetZoom, clamp(dt * 8, 0, 1));

    // 后坐力恢复
    const recRate = 5.5;
    p.recoilPitch = lerp(p.recoilPitch, 0, clamp(dt * recRate, 0, 1));
    p.recoilYaw = lerp(p.recoilYaw, 0, clamp(dt * recRate, 0, 1));
    p.bloom = Math.max(0, p.bloom - dt * 2.4);
    p.recoilKick = Math.max(0, p.recoilKick - dt * 9);

    // 计时器
    p.drawT = Math.min(p.drawTotal, p.drawT + dt);
    const t = p.weaponAnim;
    t.fireT = Math.max(0, t.fireT - dt * 7);
    t.pumpT = Math.max(0, t.pumpT - dt * 4);
    t.boltT = Math.max(0, t.boltT - dt * 3);

    // 换弹推进
    if (p.reloading) {
      p.reloadT += dt;
      const def2 = p.weaponDef();
      const per = def2?.reloadPer;
      const inst = p.weaponInst();
      if (per && def2) {
        // 霰弹枪逐发
        if (p.reloadT >= per && inst.mag < def2.mag && inst.reserve > 0) {
          p.reloadT -= per;
          inst.mag++;
          inst.reserve--;
          AudioSys.reload("shotgun", 1);
        }
        if (inst.mag >= def2.mag || inst.reserve <= 0) {
          p.reloading = false;
          AudioSys.reload("shotgun", 0);
        }
      } else if (p.reloadT >= p.reloadTotal) {
        p.reloading = false;
        if (def2 && inst) {
          const need = def2.mag - inst.mag;
          const take = Math.min(need, inst.reserve);
          inst.mag += take;
          inst.reserve -= take;
        }
      }
    }

    this.lookDeltaX = lerp(this.lookDeltaX, 0, clamp(dt * 8, 0, 1));
    this.lookDeltaY = lerp(this.lookDeltaY, 0, clamp(dt * 8, 0, 1));
    this.applyPose(dt);
  }

  applyPose(dt, hard = false) {
    const p = this.player;
    const g = this.group;
    if (!g) return;
    const def = p.weaponDef();
    const speed = Math.hypot(p.vel.x, p.vel.z);
    const bobAmp = clamp(speed / G.maxSpeed, 0, 1) * (p.crouch ? 0.4 : 0.65);
    const bobX = Math.sin(p.bobPhase * 2) * 0.008 * bobAmp;
    const bobY = Math.abs(Math.cos(p.bobPhase * 2)) * 0.010 * bobAmp;
    const t = p.weaponAnim;

    // 开镜姿态
    let base = VM_BASE.clone();
    if (def?.zoom && p.zoomT > 0.02) {
      base.set(0, -0.012, -0.1);
    }
    base.x += bobX;
    base.y += bobY + this.lookDeltaY * -0.004;
    base.z += this.lookDeltaX * -0.004;

    // 开火后坐
    const kick = p.recoilKick * 0.028;
    base.z += kick;
    let rx = p.recoilPitch * 1.1 + kick * 1.4;
    let ry = p.recoilYaw * 0.5;
    let rz = 0;

    // 换弹动画
    if (p.reloading) {
      const def2 = p.weaponDef();
      const total = def2?.reloadPer ? 1.6 : p.reloadTotal;
      const rt = p.reloadT / total;
      if (rt < 0.35) {
        const k = rt / 0.35;
        base.y -= k * 0.17;
        rx += k * 0.55;
        base.z += k * 0.05;
      } else if (rt < 0.72) {
        base.y -= 0.17;
        rx += 0.55;
        base.z += 0.05;
        // 换弹细节：弹匣/枪栓
        if (def2?.view === "sniper") t.boltT = Math.max(t.boltT, 0.7);
        if (def2?.view === "shotgun") t.pumpT = Math.max(t.pumpT, 0.6);
      } else {
        const k = (rt - 0.72) / 0.28;
        base.y -= 0.17 * (1 - k);
        rx += 0.55 * (1 - k);
        base.z += 0.05 * (1 - k);
      }
    } else {
      // 开火动画
      const fk = t.fireT;
      base.z += fk * 0.055;
      rx += fk * 0.13;
      if (def?.view === "shotgun") {
        base.z += t.pumpT * 0.09;
        rx += t.pumpT * 0.2;
        if (this.parts?.pump) this.parts.pump.position.z = -0.28 - t.pumpT * 0.1;
      }
      if (def?.view === "sniper" && this.parts?.bolt) {
        this.parts.bolt.position.z = 0.1 - t.boltT * 0.07;
        this.parts.bolt.position.x = 0.02 - t.boltT * 0.03;
      }
    }

    // 拔枪动画
    if (p.drawT < p.drawTotal) {
      const k = 1 - p.drawT / p.drawTotal;
      rx += Math.sin(k * Math.PI) * 0.65;
      base.y -= Math.sin(k * Math.PI) * 0.16;
    }

    g.position.copy(base);
    g.rotation.set(rx, ry, rz);
    g.visible = p.alive;
  }

  // ---------- 射击 ----------
  canFire() {
    const p = this.player;
    if (!p.alive || p.reloading || p.drawT < p.drawTotal * 0.7) return false;
    const def = p.weaponDef();
    if (!def) return true; // 刀/无武器由上层处理
    const inst = p.weaponInst();
    if (!inst) return false;
    if (inst.mag <= 0) return false;
    const interval = 60 / def.rpm;
    return this.game.time - this.lastFireT >= interval;
  }

  fire(isPressed) {
    const p = this.player;
    const game = this.game;
    const def = p.weaponDef();
    if (!def) {
      // 近战
      if (p.weaponId() === "knife" && isPressed && game.time - this.lastFireT > 0.5) {
        this.lastFireT = game.time;
        p.weaponAnim.fireT = 1;
        AudioSys.gunshot("glock", 0.2);
        game.melee(p);
      }
      // 投掷物
      if (p.current.startsWith("nade:") && isPressed && game.time - this.lastFireT > 0.35) {
        this.lastFireT = game.time;
        game.throwNade(p, p.current.slice(5), false);
      }
      return;
    }
    if (!def.auto && !isPressed) return;
    if (!this.canFire()) {
      if (isPressed && p.weaponInst() && p.weaponInst().mag <= 0 && !p.reloading) {
        AudioSys.dryFire();
      }
      return;
    }
    const inst = p.weaponInst();
    if (!inst || inst.mag <= 0) {
      if (isPressed) game.autoReload(p);
      return;
    }
    inst.mag--;
    this.lastFireT = game.time;
    p.weaponAnim.fireT = 1;
    p.lastShot = game.time;

    // 后坐力模式
    const idx = p.recoilIndex % def.recoil.length;
    p.recoilIndex++;
    p.recoilPitch += def.recoil[idx] * 0.0085;
    p.recoilYaw += def.recoilYaw[idx] * 0.026;
    p.recoilKick = Math.min(1.4, p.recoilKick + 0.55);
    p.bloom = Math.min(1.5, p.bloom + (def.auto ? 0.22 : 0.45));

    // 散布
    const speed = Math.hypot(p.vel.x, p.vel.z);
    let spread = def.spread * (1 + p.bloom * 0.8);
    spread += def.moveSpread * clamp(speed / G.maxSpeed, 0, 1);
    if (!p.grounded) spread += 0.035;
    if (p.crouch) spread *= 0.85;
    if (p.walk) spread *= 0.92;
    if (def.zoom && !p.zoomed && p.zoomT < 0.5) spread += 0.035; // AWP 不开镜极不准
    if (def.zoom && p.zoomed && speed > 0.8) spread += 0.03;

    const eye = p.eyePos();
    const muzzle = p.isBot
      ? eye.clone().addScaledVector(p.forward(), 0.6).add(new THREE.Vector3(0, 0.05, 0))
      : this.muzzleWorld();
    const pellets = def.pellets ?? 1;
    for (let i = 0; i < pellets; i++) {
      const a1 = rand(-spread, spread) + (p.recoilPitch * 0.75);
      const a2 = rand(-spread, spread) + (p.recoilYaw * 0.75);
      const dir = new THREE.Vector3();
      dir.set(
        -Math.sin(p.yaw + a2) * Math.cos(p.pitch + a1),
        Math.sin(p.pitch + a1),
        -Math.cos(p.yaw + a2) * Math.cos(p.pitch + a1)
      ).normalize();
      game.shootRay(p, eye, dir, def, muzzle, i === 0);
    }

    // 弹壳
    game.fx.casing(
      new THREE.Vector3(muzzle.x, muzzle.y + 0.04, muzzle.z),
      p.forward(), p.right()
    );
    // 枪口焰
    game.fx.muzzle(muzzle, p.forward());
    const listener = game.audioListenerPos();
    const dist = listener.distanceTo(p.pos);
    AudioSys.gunshot(def.sound.shot, dist);

    // 空仓自动换弹
    if (inst.mag <= 0) game.autoReload(p);
    if (def.zoom && !def.auto) p.weaponAnim.boltT = 1;
    if (def.view === "shotgun") p.weaponAnim.pumpT = 1;
  }

  startReload() {
    const p = this.player;
    const def = p.weaponDef();
    const inst = p.weaponInst();
    if (!def || !inst || p.reloading || inst.mag >= def.mag || inst.reserve <= 0) return;
    p.reloading = true;
    p.reloadT = 0;
    p.reloadTotal = def.reload;
    p.zoomed = false;
    AudioSys.reload(def.sound.reload, 0);
  }
}

function disposeGroup(g) {
  g.traverse((o) => {
    if (o.geometry && o.geometry.userData?.keep) return;
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material.dispose();
    }
  });
}

// 机器人手中的世界枪更新
export function attachBotWeapon(bot) {
  if (!bot.model) return;
  const gunHolder = bot.model.parts?.armR;
  const id = bot.weaponId();
  if (!gunHolder) return;
  const old = gunHolder.getObjectByName("wg");
  if (old) gunHolder.remove(old);
  if (!id || id === "knife") {
    // 刀
    const k = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.28),
      new THREE.MeshStandardMaterial({ color: 0xb8bec4, metalness: 0.9, roughness: 0.3 }));
    blade.position.set(0, 0.02, 0.14);
    k.add(blade);
    k.name = "wg";
    k.position.set(0, -0.56, 0.1);
    k.rotation.x = -1.3;
    gunHolder.add(k);
    return;
  }
  if (id.startsWith("he") || id === "flash" || id === "smoke" || id === "molotov") {
    const n = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6),
      new THREE.MeshStandardMaterial({ color: id === "molotov" ? 0x3a5a28 : 0x4c4a32, roughness: 0.6 }));
    n.name = "wg";
    n.position.set(0, -0.5, 0.16);
    gunHolder.add(n);
    return;
  }
  const g = buildWorldGun(id);
  g.name = "wg";
  g.position.set(0.03, -0.5, 0.14);
  g.rotation.y = Math.PI;
  gunHolder.add(g);
}
