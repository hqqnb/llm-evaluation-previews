(function () {
  const THREE = window.THREE;
  const U = window.TFPS.U;
  const W = window.TFPS.W;
  const DIFF = window.TFPS.DIFF;
  const PlayerEntity = window.TFPS.PlayerEntity;

  function yawTo(dx, dz) { return Math.atan2(-dx, -dz); }
  function forwardYaw(yaw) { return new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)); }

  class Bot extends PlayerEntity {
    constructor(game, opts) {
      super(game, opts);
      this.isBot = true;
      this.state = "idle";
      this.path = [];
      this.pathIdx = 0;
      this.waypoint = null;
      this.enemy = null;
      this.reactionT = 0;
      this.nextThinkT = U.rand(0, 0.3);
      this.strafeDir = 1;
      this.strafeT = 0;
      this.lastKnownEnemy = null;
      this.lastKnownT = -99;
      this.stuckT = 0;
      this.lastPos = this.pos.clone();
      this.plan = null; // t route or ct hold
      this.role = "soldier";
      this.nadePlan = null;
      this.holdAngle = 0;
      this.aimError = new THREE.Vector3();
      this.diffCfg = DIFF[this.diff] || DIFF.normal;
      this.burstLeft = 0;
      this.burstT = 0;
      this.wantPlant = false;
      this.wantDefuse = false;
      this.avoidShots = 0;
      this.repathT = 0;
      this.noiseT = 0;
    }
    setPath(nodeIds) {
      this.path = nodeIds || [];
      this.pathIdx = 0;
      this.waypoint = this.path.length ? this.game.map.nav.byId.get(this.path[0]) : null;
    }
    pathToNode(id) {
      const nav = this.game.map.nav;
      const p = nav.pathFrom(this.pos.x, this.pos.z, id);
      this.setPath(p);
    }
    pathToNearest(filter) {
      const nav = this.game.map.nav;
      const n = nav.nearest(this.pos.x, this.pos.z, filter);
      if (!n) return null;
      this.pathToNode(n.id);
      return n;
    }
    think(dt) {
      const game = this.game;
      if (!this.alive || game.roundState === "freeze") { this.state = "idle"; return; }
      if (game.roundState === "over" || game.roundState === "warmup") { this.state = "idle"; return; }
      this.nextThinkT -= dt;
      if (this.nextThinkT <= 0) {
        this.nextThinkT = U.rand(0.15, 0.35);
        this.updateSight();
        this.chooseAction();
      }
      this.updateCombat(dt);
      this.updateMovement(dt);
      this.updateAction(dt);
      this.updateNades(dt);
      this.updateModel(dt);
    }
    updateSight() {
      const game = this.game;
      const eye = this.getEyePos();
      let best = null, bestD = 1e9;
      for (const e of game.players) {
        if (!e.alive || e.team === this.team) continue;
        const targetEye = e.getEyePos();
        const dx = targetEye.x - eye.x, dy = targetEye.y - eye.y, dz = targetEye.z - eye.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist > 48) continue;
        const yaw = yawTo(dx, dz);
        const ang = Math.abs(U.angleDiff(this.yaw, yaw));
        if (ang > 1.35) continue;
        if (game.raycastWorld(eye, targetEye, e)) continue;
        if (game.effects.smokeBlocked(eye, targetEye)) continue;
        if (dist < bestD) { bestD = dist; best = e; }
      }
      this.enemy = best;
      if (best) {
        this.lastKnownEnemy = best.pos.clone();
        this.lastKnownT = game.time;
        game.lastSeen = { pos: best.pos.clone(), team: this.team, t: game.time };
      }
    }
    chooseAction() {
      const game = this.game;
      if (this.enemy && this.enemy.alive) { this.state = "combat"; return; }
      // bomb knowledge
      const bomb = game.bomb;
      if (this.state === "idle") this.state = this.team === "T" ? "attack" : "defend";
      if (this.team === "T" && bomb && bomb.dropped && !this.bomb) {
        this.state = "search";
        const n = game.map.nav.nearest(bomb.pos.x, bomb.pos.z);
        if (n) this.pathToNode(n.id);
        return;
      }
      if (this.team === "CT" && bomb && bomb.planted) {
        this.state = "retake";
        if (!this.retakeTarget || this.retakeTarget !== bomb.site) {
          const path = game.map.plans.retake[bomb.site] || game.map.plans.retake.a;
          this.retakeTarget = bomb.site;
          const nav = game.map.nav;
          const p = nav.pathFrom(this.pos.x, this.pos.z, path[path.length - 1]);
          this.setPath(p);
        }
        return;
      }
      if (this.state === "combat") { this.state = "move"; }
      // team shared intel
      if (game.lastSeen && game.lastSeen.team === this.team && game.time - game.lastSeen.t < 2) {
        if (!this.lastKnownEnemy || game.lastSeen.t > this.lastKnownT) {
          this.lastKnownEnemy = game.lastSeen.pos.clone();
          this.lastKnownT = game.lastSeen.t;
          this.state = "search";
        }
      }
      if (this.lastKnownEnemy && game.time - this.lastKnownT < 3.5) {
        this.state = "search";
        if (!this.waypoint || this.path.length === 0) {
          const nav = game.map.nav;
          const n = nav.nearest(this.lastKnownEnemy.x, this.lastKnownEnemy.z);
          if (n) { this.pathToNode(n.id); }
        }
        return;
      }
      if (this.state === "search" && game.time - this.lastKnownT >= 3.5) {
        this.state = this.team === "T" ? "attack" : "defend";
      }
      if (!this.plan) this.assignPlan();
      if (this.state === "plant" || this.state === "defuse") return;
      // plant / defuse priority
      if (this.team === "T" && this.bomb && this.nearSite()) { this.state = "plant"; return; }
      if (this.team === "CT" && game.bomb && game.bomb.planted && this.nearBomb()) { this.state = "defuse"; return; }
      if (this.state === "attack" || this.state === "defend") {
        if (!this.waypoint && this.path.length === 0) this.assignPlan();
        if (!this.waypoint && this.path.length === 0 && this.team === "T" && this.plan && this.plan.nodes) {
          this.pathToNode(this.plan.nodes[this.plan.nodes.length - 1]);
        }
        if (!this.waypoint && this.path.length === 0 && this.team === "CT" && this.plan && this.plan.node) {
          this.pathToNode(this.plan.node);
        }
      }
    }
    nearSite() {
      const game = this.game;
      for (const id in game.map.sites) {
        const s = game.map.sites[id];
        if (U.dist(this.pos.x, this.pos.z, s.x, s.z) < s.radius) return true;
      }
      return false;
    }
    nearBomb() {
      const game = this.game, b = game.bomb;
      if (!b) return false;
      return U.dist(this.pos.x, this.pos.z, b.pos.x, b.pos.z) < 2.2;
    }
    assignPlan() {
      const game = this.game;
      if (this.team === "T") {
        if (this.plan && this.plan.site) return;
        const routes = game.map.plans.tRoutes;
        const route = routes[U.randInt(0, routes.length - 1)];
        this.plan = route;
        this.setPath(route.nodes);
        this.state = "attack";
      } else {
        const holds = game.map.plans.ctHolds;
        const idx = this.holdIdx || U.randInt(0, holds.length - 1);
        this.holdIdx = idx;
        this.plan = holds[idx];
        this.pathToNearest(n => n.flags && n.flags.hold);
        if (!this.path.length) this.pathToNode(holds[idx].node);
        this.state = "defend";
        const n = game.map.nav.byId.get(holds[idx].node);
        if (n) this.holdAngle = yawTo(n.x - this.pos.x, n.z - this.pos.z);
      }
    }
    updateCombat(dt) {
      if (this.state !== "combat" || !this.enemy || !this.enemy.alive) {
        this.burstLeft = 0;
        return;
      }
      const e = this.enemy;
      const eye = this.getEyePos();
      const tEye = e.getEyePos();
      const dx = tEye.x - eye.x, dy = tEye.y - eye.y, dz = tEye.z - eye.z;
      const dist = Math.hypot(dx, dy, dz);
      const targetYaw = yawTo(dx, dz);
      const targetPitch = Math.atan2(dy, Math.hypot(dx, dz));
      const err = this.diffCfg.aimError * (1 + Math.min(1.5, dist / 35));
      // reaction
      if (this.reactionT <= 0) {
        this.reactionT = U.rand(this.diffCfg.reaction[0], this.diffCfg.reaction[1]) * (this.enemy.sprinting ? 0.7 : 1);
        this.aimError.set(U.rand(-err, err), U.rand(-err * 0.7, err * 0.7), U.rand(-err, err));
      } else {
        this.reactionT -= dt;
        this.yaw = U.damp(this.yaw, targetYaw, 8, dt);
        this.pitch = U.damp(this.pitch, targetPitch, 8, dt);
        this.strafe(dt);
        return;
      }
      const fy = targetYaw + this.aimError.x;
      const fp = targetPitch + this.aimError.y;
      this.yaw = U.angleLerp(this.yaw, fy, Math.min(1, dt * (this.diffCfg.keepDistance > 0.9 ? 14 : 8)));
      this.pitch = U.angleLerp(this.pitch, fp, Math.min(1, dt * (this.diffCfg.keepDistance > 0.9 ? 14 : 8)));
      // fire control
      const def = this.getWeaponDef();
      const interval = 60 / (def.rpm || 300);
      this.weapon.lastShot -= dt;
      if (this.burstLeft > 0) {
        if (this.weapon.lastShot <= 0) {
          this.fireAt(e);
          this.burstLeft--;
          this.weapon.lastShot = interval;
        }
      } else {
        this.burstT -= dt;
        if (this.burstT <= 0) {
          const b = U.rand(this.diffCfg.burst[0], this.diffCfg.burst[1]) | 0;
          this.burstLeft = b;
          this.burstT = U.rand(this.diffCfg.burstDelay[0], this.diffCfg.burstDelay[1]);
        }
      }
      this.strafe(dt);
      // keep distance
      const want = 18 - this.diffCfg.keepDistance * 8;
      if (dist < want - 4 && this.diffCfg.movePeek > 0.5) {
        const back = new THREE.Vector3(eye.x - tEye.x, 0, eye.z - tEye.z).normalize();
        this.vel.x += back.x * 20 * dt; this.vel.z += back.z * 20 * dt;
      }
    }
    strafe(dt) {
      this.strafeT -= dt;
      if (this.strafeT <= 0) {
        this.strafeT = U.rand(0.35, 0.9);
        this.strafeDir = Math.random() < 0.5 ? -1 : 1;
      }
      if (this.diffCfg.strafe > 0.2) {
        const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
        this.vel.x += right.x * this.strafeDir * 12 * this.diffCfg.strafe * dt;
        this.vel.z += right.z * this.strafeDir * 12 * this.diffCfg.strafe * dt;
      }
    }
    fireAt(target) {
      const game = this.game;
      const def = this.getWeaponDef();
      if (def.slot === "grenade") { this.throwCurrentAt(target.pos); return; }
      if (this.weapon.ammo <= 0 || this.weapon.reloading || this.weapon.switchT > 0) { this.startReload(); return; }
      const eye = this.getEyePos();
      const dir = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
      // add inaccuracy based on difficulty
      const err = this.diffCfg.aimError * (this.weapon.recoilIdx > 3 ? 1.5 : 1);
      dir.x += U.rand(-err, err); dir.y += U.rand(-err * 0.6, err * 0.6); dir.z += U.rand(-err, err);
      dir.normalize();
      game.fireFrom(this, dir, true);
      if (def.slot === "sniper" || def.slot === "pistol") this.burstLeft = 0;
    }
    updateMovement(dt) {
      const game = this.game;
      if (this.state === "combat") return; // strafe handled
      if (this.state === "plant" || this.state === "defuse") { this.vel.x *= 0.7; this.vel.z *= 0.7; return; }
      let target = null;
      if (this.waypoint) {
        const n = this.waypoint;
        const d = Math.hypot(n.x - this.pos.x, n.z - this.pos.z);
        if (d < 0.55 || (this.pathIdx > 0 && d < 1.2 && this.repathT > 0.4)) {
          this.pathIdx++;
          this.waypoint = this.path[this.pathIdx] ? this.game.map.nav.byId.get(this.path[this.pathIdx]) : null;
          this.repathT = 0;
        }
      }
      if (!this.waypoint && this.path.length) { this.waypoint = this.game.map.nav.byId.get(this.path[this.path.length - 1]); }
      if (this.waypoint) {
        target = this.waypoint;
      } else if (this.state === "hold" || this.state === "defend") {
        // stand and scan
        this.yaw += Math.sin(performance.now() / 1000 * 0.5) * 0.3 * dt;
        this.vel.x *= 0.6; this.vel.z *= 0.6;
        if (this.diffCfg.useCover > 0.5 && Math.random() < dt * 0.5) this.crouching = true;
        return;
      } else if (this.state === "search" && this.lastKnownEnemy) {
        target = { x: this.lastKnownEnemy.x, z: this.lastKnownEnemy.z, y: 0 };
      } else {
        this.vel.x *= 0.6; this.vel.z *= 0.6;
        return;
      }
      const dx = target.x - this.pos.x, dz = target.z - this.pos.z;
      const dist = Math.hypot(dx, dz);
      const ty = yawTo(dx, dz);
      this.yaw = U.angleLerp(this.yaw, ty, Math.min(1, dt * 10));
      // movement speed
      let speed = 5.0;
      if (this.team === "T" && this.plan && this.plan.site && (this.plan.name || "").includes("快攻") && this.state === "attack") speed = 6.3;
      if (this.quiet || (this.lastKnownEnemy && game.time - this.lastKnownT < 3)) speed = 2.1;
      const dir = forwardYaw(ty);
      this.vel.x = U.damp(this.vel.x, dir.x * speed, 12, dt);
      this.vel.z = U.damp(this.vel.z, dir.z * speed, 12, dt);
      // stuck detection
      const moved = Math.hypot(this.pos.x - this.lastPos.x, this.pos.z - this.lastPos.z);
      if (moved < 0.04) {
        this.stuckT += dt;
        if (this.stuckT > 0.45 && dist > 0.01) {
          const perpX = -dz / dist, perpZ = dx / dist;
          this.vel.x += perpX * this.strafeDir * 8 * dt;
          this.vel.z += perpZ * this.strafeDir * 8 * dt;
        }
        if (this.stuckT > 0.45) {
          if (!this.jumping) { this.vel.y = 6.5; this.jumping = true; }
          if (this.stuckT > 0.9) {
            this.stuckT = 0;
            this.repathT = 0;
            this.path.length = 0;
            if (this.plan && this.plan.nodes) this.setPath(this.plan.nodes);
            else this.assignPlan();
          }
        }
      } else {
        this.stuckT = Math.max(0, this.stuckT - dt * 2);
      }
      this.lastPos.copy(this.pos);
      this.repathT += dt;
    }
    updateAction(dt) {
      const game = this.game;
      if (this.state === "plant" && this.bomb && this.nearSite()) {
        if (!this.action) {
          const s = this.findSite();
          const spot = s.spots[U.randInt(0, s.spots.length - 1)];
          this.action = { type: "plant", t: 0, total: 3.2, target: spot };
        }
        if (this.action && this.action.type === "plant") {
          this.yaw = Math.PI; // face site
          if (this.action.t >= this.action.total) {
            game.plantBomb(this, this.action.target);
            this.action = null;
            this.state = "attack";
            this.assignPostPlant();
          }
        }
      } else if (this.state === "defuse" && this.team === "CT" && this.nearBomb()) {
        if (!this.action) this.action = { type: "defuse", t: 0, total: this.defuseKit ? 5 : 10 };
        if (this.action.type === "defuse" && this.action.t >= this.action.total) {
          game.defuseBomb(this);
          this.action = null;
        }
      }
      if (this.action) {
        const was = this.action.t;
        this.action.t += dt;
        const step = Math.floor(was * 4) !== Math.floor(this.action.t * 4);
        if (step) window.TFPS.SFX.pos(this.action.type === "plant" ? "plant_beep" : "defuse_beep", this.pos, { vol: 0.5, dur: 0.2 });
      }
    }
    assignPostPlant() {
      const game = this.game;
      const site = game.bomb ? game.bomb.site : "a";
      const holds = site === "a" ? ["as4", "as3", "asw5"] : ["bs2", "bs3", "bs1"];
      const n = game.map.nav.byId.get(U.pick(holds));
      if (n) this.pathToNode(n.id);
      this.state = "attack";
      this.plan = { site, nodes: [n.id] };
      // smoke for retake block
      if (this.inventory.smoke && this.diffCfg.nadeChance > Math.random()) {
        const target = game.map.nav.byId.get(site === "a" ? "as4" : "bs1");
        if (target) this.nadePlan = { type: "smoke", target: target, t: U.rand(1, 3) };
      }
    }
    findSite() {
      const game = this.game;
      for (const id in game.map.sites) {
        const s = game.map.sites[id];
        if (U.dist(this.pos.x, this.pos.z, s.x, s.z) < s.radius) return s;
      }
      return game.map.sites.a;
    }
    updateNades(dt) {
      const game = this.game;
      if (!this.nadePlan) return;
      this.nadePlan.t -= dt;
      if (this.nadePlan.t <= 0) {
        if (this.inventory[this.nadePlan.type] > 0 && this.equipSlot(this.nadePlan.type, true)) {
          game.throwGrenadeAt(this, this.nadePlan.type, this.nadePlan.target);
          this.inventory[this.nadePlan.type]--;
          this.refreshSlots();
          this.equipSlot(this.lastSlot || "pistol", true);
        }
        this.nadePlan = null;
      }
      // combat HE
      if (this.state === "combat" && this.enemy && this.inventory.he > 0 && this.weapon.lastShot < -4) {
        const d = U.dist(this.pos.x, this.pos.z, this.enemy.pos.x, this.enemy.pos.z);
        if (d > 6 && d < 22 && this.diffCfg.nadeChance > Math.random() * 1.4) {
          if (this.equipSlot("he", true)) {
            game.throwGrenadeAt(this, "he", this.enemy.pos);
            this.inventory.he--;
            this.refreshSlots();
            this.equipSlot(this.lastSlot || "pistol", true);
            this.weapon.lastShot = 0;
          }
        }
      }
    }
    throwCurrentAt(target) {
      const game = this.game;
      const id = this.getWeaponId();
      if (this.inventory[id] > 0) {
        game.throwGrenadeAt(this, id, target);
        this.inventory[id]--;
        this.refreshSlots();
        this.equipSlot(this.lastSlot || "pistol", true);
      }
    }
    startReload() {
      if (this.weapon.reloading || this.weapon.ammo >= this.getWeaponDef().mag || this.weapon.reserve <= 0) return;
      this.weapon.reloading = true;
      this.weapon.reloadT = this.getWeaponDef().reload || 2.5;
    }
    hear(pos, radius, loud) {
      if (!this.alive) return;
      const d = Math.hypot(this.pos.x - pos.x, this.pos.z - pos.z);
      if (d < radius) {
        this.lastKnownEnemy = pos.clone();
        this.lastKnownT = this.game.time;
        if (this.state === "defend" || this.state === "attack") this.state = "search";
      }
    }
  }

  window.TFPS.Bot = Bot;
})();
