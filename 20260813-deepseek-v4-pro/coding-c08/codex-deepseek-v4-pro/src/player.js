// ============================================================================
// 玩家实体：移动、物理碰撞、生命、护甲、武器槽
// ============================================================================

import * as THREE from "three";
import { G, WEAPONS, NADES } from "./config.js";
import { clamp, lerp, V3 } from "./util.js";
import { AudioSys } from "./audio.js";

export function makeWeapon(id) {
  if (!id) return null;
  const w = WEAPONS[id];
  return { id, mag: w.mag, reserve: w.reserve };
}

export class Player {
  constructor(opts) {
    this.name = opts.name;
    this.team = opts.team;
    this.isBot = !!opts.isBot;
    this.id = opts.id ?? Math.random().toString(36).slice(2);
    this.pos = new V3(opts.spawn.x, opts.spawn.y, opts.spawn.z);
    this.vel = new V3();
    this.yaw = opts.spawn.ry ?? 0;
    this.pitch = 0;
    this.crouch = false;
    this.walk = false;
    this.alive = true;
    this.hp = 100;
    this.armor = 0;
    this.helmet = false;
    this.kit = false;
    this.money = G.startMoney;
    this.kills = 0;
    this.deaths = 0;
    this.assists = 0;
    this.damageDone = 0;
    this.mvpScore = 0;
    this.weapons = { primary: null, secondary: makeWeapon(opts.team === "T" ? "glock" : "usp"), knife: { id: "knife", mag: Infinity, reserve: Infinity } };
    this.nades = { he: 0, flash: 0, smoke: 0, molotov: 0 };
    this.current = "secondary";
    this.grounded = true;
    this.crouchAmt = 0;          // 0=站 1=蹲
    this.height = G.standHeight;
    this.groundedY = opts.spawn.y;
    // 射击状态
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.recoilKick = 0;
    this.bloom = 0;
    this.recoilIndex = 0;
    this.lastShot = -10;
    this.reloading = false;
    this.reloadT = 0;
    this.reloadTotal = 1;
    this.drawT = 0.35;
    this.drawTotal = 0.35;
    this.weaponAnim = { fireT: 0, reloadT: 0, pumpT: 0, boltT: 0 };
    this.zoomT = 0;              // 0~1 开镜过渡
    this.zoomed = false;
    this.triggerDown = false;
    this.wishDir = new V3();     // 期望移动方向（xz）
    this.stepAccum = 0;
    this.flashBlind = 0;
    this.model = opts.model ?? null;
    this.bobPhase = 0;
    this.corpse = null;
    this.footstepT = 0;
  }

  get eyeHeight() { return lerp(G.eyeStand, G.eyeCrouch, this.crouchAmt); }
  eyePos() { return new V3(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z); }
  forward() { return new V3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  right() { return new V3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); }

  weaponId() {
    if (this.current === "primary") return this.weapons.primary?.id ?? null;
    if (this.current === "secondary") return this.weapons.secondary?.id ?? null;
    if (this.current === "knife") return "knife";
    if (this.current.startsWith("nade:")) return this.current.slice(5);
    return null;
  }
  weaponDef() {
    const id = this.weaponId();
    if (!id || id === "knife") return null;
    return WEAPONS[id] ?? null;
  }
  weaponInst() {
    if (this.current === "primary") return this.weapons.primary;
    if (this.current === "secondary") return this.weapons.secondary;
    if (this.current === "knife") return this.weapons.knife;
    return null;
  }

  canSwitch() { return !this.reloading; }

  switchTo(slot) {
    if (slot === this.current) return;
    if (slot === "primary" && !this.weapons.primary) return;
    if (slot.startsWith("nade:")) {
      const t = slot.slice(5);
      if (!this.nades[t]) return;
    }
    this.current = slot;
    const def = this.weaponDef();
    if (def?.sound?.draw) AudioSys.draw(def.sound.draw);
    this.drawT = 0;
    this.drawTotal = def?.draw ?? 0.4;
    this.zoomed = false;
    this.recoilIndex = 0;
    this.bloom = Math.min(this.bloom, 0.5);
  }

  nextNade() {
    const order = ["he", "flash", "smoke", "molotov"];
    if (this.current.startsWith("nade:")) {
      const cur = order.indexOf(this.current.slice(5));
      for (let i = 1; i <= 4; i++) {
        const t = order[(cur + i) % 4];
        if (this.nades[t]) { this.switchTo("nade:" + t); return true; }
      }
    } else {
      for (const t of order) if (this.nades[t]) { this.switchTo("nade:" + t); return true; }
    }
    return false;
  }

  getSpeedMult() {
    const w = this.weaponDef();
    return w ? w.moveSpeedMult : 1;
  }
  currentMaxSpeed() {
    let m = G.maxSpeed * this.getSpeedMult();
    if (this.walk) m *= G.walkMult;
    if (this.crouch) m *= G.crouchMult;
    return m;
  }

  // ---------- 移动与物理 ----------
  updatePhysics(dt, map, input) {
    if (!this.alive) {
      this.vel.set(0, this.vel.y, 0);
      this.vel.y -= G.gravity * dt;
      this.pos.y = Math.max(this.groundedY, this.pos.y + this.vel.y * dt);
      if (this.pos.y <= this.groundedY) { this.pos.y = this.groundedY; this.vel.y = 0; }
      return;
    }
    const targetCrouch = this.crouch ? 1 : 0;
    this.crouchAmt = lerp(this.crouchAmt, targetCrouch, clamp(dt * 10, 0, 1));
    this.height = lerp(G.standHeight, G.crouchHeight, this.crouchAmt);

    // 期望速度
    const speed = this.currentMaxSpeed();
    const wish = input.moveDir.clone();
    if (wish.lengthSq() > 1) wish.normalize();
    const wishVel = wish.multiplyScalar(speed);
    const accel = this.grounded ? G.accelGround : G.accelAir;
    // 水平加速
    const hv = new V3(this.vel.x, 0, this.vel.z);
    const d = new V3(wishVel.x - hv.x, 0, wishVel.z - hv.z);
    const dl = d.length();
    if (dl > 0.001) {
      const amt = Math.min(dl, accel * dt);
      d.normalize().multiplyScalar(amt);
      this.vel.x += d.x;
      this.vel.z += d.z;
      // 超速截断
      const hlen = Math.hypot(this.vel.x, this.vel.z);
      if (hlen > speed + 0.01) {
        this.vel.x *= (speed + 0.01) / hlen;
        this.vel.z *= (speed + 0.01) / hlen;
      }
    } else if (this.grounded) {
      // 地面摩擦
      const fr = G.friction * dt;
      const hl = Math.hypot(this.vel.x, this.vel.z);
      if (hl > 0.001) {
        const ns = Math.max(0, hl - fr);
        this.vel.x *= ns / hl;
        this.vel.z *= ns / hl;
      }
    }

    // 跳跃
    if (input.jump && this.grounded && !this.crouch) {
      this.vel.y = G.jumpVel;
      this.grounded = false;
      AudioSys.land();
    }

    // 重力
    this.vel.y -= G.gravity * dt;
    this.vel.y = Math.max(this.vel.y, -35);

    // 水平移动 + 碰撞（分轴）
    this.moveAxis(map, "x", this.vel.x * dt);
    this.moveAxis(map, "z", this.vel.z * dt);

    // 垂直
    this.pos.y += this.vel.y * dt;
    const gy = map.groundY(this.pos.x, this.pos.z, this.pos.y);
    if (gy > -Infinity && this.pos.y <= gy + 0.02 && this.vel.y <= 0) {
      this.pos.y = gy;
      this.vel.y = 0;
      if (!this.grounded) this.grounded = true;
    } else {
      this.grounded = false;
    }
    this.groundedY = gy;

    // 脚步声
    const hspd = Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded && hspd > 1.2) {
      this.stepAccum += hspd * dt;
      const stride = this.crouch ? 2.2 : 2.6;
      if (this.stepAccum >= stride) {
        this.stepAccum = 0;
        AudioSys.step("concrete", hspd > G.maxSpeed * 0.75);
      }
    } else this.stepAccum = 0;

    this.bobPhase += hspd * dt * (this.grounded ? 1.7 : 0.3);
  }

  moveAxis(map, axis, delta) {
    if (delta === 0) return;
    const r = G.playerRadius;
    const h = this.height;
    const startY = this.pos.y;
    const p = axis === "x" ? "x" : "z";
    this.pos[p] += delta;
    const solids = map.spatial.query(this.pos.x, this.pos.z, 1.6);
    let blocked = null;
    for (const s of solids) {
      if (s.intersectsCylinder(this.pos.x, this.pos.y + 0.03, this.pos.z, r, h, this.pos.y + 0.03)) {
        blocked = s;
        break;
      }
    }
    if (blocked) {
      // 尝试自动跨步
      const gy = map.groundY(this.pos.x, this.pos.z, startY);
      if (this.grounded && gy > -Infinity && gy - startY <= G.stepUp && gy - startY > 0.001) {
        this.pos.y = gy;
        let still = false;
        for (const s of map.spatial.query(this.pos.x, this.pos.z, 1.6)) {
          if (s.intersectsCylinder(this.pos.x, this.pos.y + 0.03, this.pos.z, r, h, this.pos.y + 0.03)) { still = true; break; }
        }
        if (!still) return;
        this.pos.y = startY;
      }
      // 推回
      if (delta > 0) this.pos[p] = blocked[p + "1"] - r - 0.001;
      else this.pos[p] = blocked[p + "2"] + r + 0.001;
      this.vel[p] = 0;
    }
  }

  // 承受伤害，返回实际伤害
  applyDamage(raw, hitGroup, isFire = false) {
    if (!this.alive) return 0;
    let dmg = raw;
    const armored = this.armor > 0;
    if (!isFire) {
      if (armored) {
        if (hitGroup === "head" && !this.helmet) {
          this.hp -= dmg;
        } else {
          const toArmor = dmg * 0.5;
          const absorbed = Math.min(this.armor, toArmor);
          this.armor -= absorbed;
          this.hp -= dmg - absorbed;
        }
      } else {
        this.hp -= dmg;
      }
    } else {
      // 火焰伤害：护甲减半
      if (armored) {
        const a = Math.min(this.armor, dmg * 0.5);
        this.armor -= a;
        this.hp -= dmg - a;
      } else this.hp -= dmg;
    }
    if (this.hp <= 0) this.hp = 0;
    if (this.hp <= 0 && this.alive) {
      this.alive = false;
      AudioSys.death();
    }
    return dmg;
  }

  getAmmoText() {
    if (this.current === "knife") return { mag: "—", reserve: "—" };
    if (this.current.startsWith("nade:")) {
      const t = this.current.slice(5);
      return { mag: this.nades[t], reserve: NADES[t].max };
    }
    const w = this.weaponInst();
    return w ? { mag: w.mag, reserve: w.reserve } : { mag: 0, reserve: 0 };
  }
}

// 输入结构
export function makeInput() {
  return {
    moveDir: new V3(),
    jump: false,
    fire: false,
    aim: false,
    walk: false,
    crouch: false,
  };
}
