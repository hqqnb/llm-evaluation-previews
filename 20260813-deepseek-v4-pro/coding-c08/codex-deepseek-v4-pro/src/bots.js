// ============================================================================
// Bot AI：路径、视野索敌、战斗、投掷物、下包/拆包、架点、回防、难度
// ============================================================================

import * as THREE from "three";
import { DIFFICULTY, G } from "./config.js";
import { Player } from "./player.js";
import { WeaponController, attachBotWeapon } from "./weapons.js";
import { clamp, lerp, rand, dist2d, angleLerp } from "./util.js";
import { buildSoldier } from "./viewmodel.js";

export class Bot extends Player {
  constructor(opts) {
    super({ ...opts, isBot: true, model: buildSoldier(opts.team) });
    this.diffName = opts.difficulty;
    this.brain = null;
    this.weaponCtrl = null;
    this.bombCarrier = false;
    this.ai = null;
  }
  eyePos() { return new THREE.Vector3(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z); }
}

export class BotBrain {
  constructor(game) {
    this.game = game;
    this.planT = 0;
    this.fields = new Map();
  }

  fieldTo(x, z) {
    const key = Math.round(x) + "," + Math.round(z);
    if (this.fields.size > 40) this.fields.clear();
    if (!this.fields.has(key)) {
      const nav = this.game.map.nav;
      this.fields.set(key, nav.fieldTo(x, z));
    }
    return this.fields.get(key);
  }

  setupRound() {
    this.fields.clear();
    const { game } = this;
    const tac = game.map.tactical;
    const diffT = DIFFICULTY[game.settings.difficulty];
    const ts = game.players.filter((p) => p.team === "T" && p.isBot && p.alive);
    const cts = game.players.filter((p) => p.team === "CT" && p.isBot && p.alive);

    // ---- T：分路进攻 ----
    const routes = tac.routes;
    const weights = routes.map((r) => r.weight);
    const assigned = {};
    ts.forEach((bot, i) => {
      let pickI = 0;
      if (diffT.tactics > 0.3) {
        // 按权重挑选，避免过度集中
        let best = -1, bestScore = -1;
        for (let k = 0; k < routes.length; k++) {
          const cnt = assigned[k] || 0;
          const score = weights[k] * (1 - cnt * 0.9) * rand(0.75, 1.25) -
            (cnt > 0 ? 0.8 : 0);
          if (score > bestScore) { bestScore = score; best = k; }
        }
        pickI = best >= 0 ? best : 0;
      } else {
        const total = weights.reduce((a, b) => a + b, 0);
        let r = Math.random() * total;
        for (let k = 0; k < routes.length; k++) { r -= weights[k]; if (r <= 0) { pickI = k; break; } }
      }
      assigned[pickI] = (assigned[pickI] || 0) + 1;
      const route = routes[pickI];
      const entry = route.entries[Math.floor(Math.random() * route.entries.length)];
      bot.ai = makeAI(bot, diffT);
      bot.ai.role = "attack";
      bot.ai.route = route;
      bot.ai.waypoints = route.entries.map((e) => ({ ...e }));
      bot.ai.wpIndex = 0;
      bot.ai.site = route.site;
      bot.ai.phase = "travel";
    });

    // ---- CT：分点架防 ----
    const holds = tac.holds;
    const siteBots = { A: 0, B: 0, mid: 0 };
    cts.forEach((bot, i) => {
      bot.ai = makeAI(bot, diffT);
      bot.ai.role = "defend";
      // 简单分配：轮流 A/B，1 人看中路
      let target = null;
      const midAssigned = siteBots.mid === 0 && cts.length >= 3 && Math.random() < 0.6;
      if (midAssigned) {
        siteBots.mid++;
        const hs = holds.find((h) => h.site === "mid");
        target = hs.spots[Math.floor(Math.random() * hs.spots.length)];
        bot.ai.site = "mid";
      } else {
        const wantA = siteBots.A <= siteBots.B;
        const site = wantA ? "A" : "B";
        siteBots[site]++;
        const hs = holds.find((h) => h.site === site);
        target = hs.spots[Math.floor(Math.random() * hs.spots.length)];
        bot.ai.site = site;
      }
      bot.ai.holdSpot = { ...target.pos, ry: target.ry, name: target.name };
      bot.ai.phase = "hold";
    });
  }

  update(dt) {
    this.planT -= dt;
    if (this.planT <= 0) {
      this.planT = 0.25;
      this.coordinate();
    }
    for (const p of this.game.players) {
      if (p.isBot && p.alive && p.ai) this.updateBot(dt, p);
    }
  }

  // 简单协同：同路人数限制、残局决策
  coordinate() {
    const { game } = this;
    const bomb = game.bomb;
    const tsAlive = game.players.filter((p) => p.team === "T" && p.alive);
    const ctsAlive = game.players.filter((p) => p.team === "CT" && p.alive);
    // CT 残局：人数占优且时间不多时前压搜索
    for (const c of ctsAlive) {
      if (!c.isBot || !c.ai) continue;
      const ai = c.ai;
      if (bomb.state === "planted") continue;
      if (ai.phase === "hold") {
        const pressure = (game.timeLeft < 35 ? 0.6 : 0) + (ctsAlive.length >= tsAlive.length + 2 ? 0.3 : 0);
        if (Math.random() < pressure * 0.12) {
          ai.phase = "search";
          ai.searchTarget = pickSitePoint(game, "A");
        }
      }
    }
    // T 残局：时间不足强攻
    for (const t of tsAlive) {
      if (!t.isBot || !t.ai || t.ai.phase === "defend" || t.ai.phase === "plant") continue;
      if (game.timeLeft < 25 && t.ai.phase === "travel") {
        t.ai.phase = "attack";
        t.ai.wpIndex = 999;
      }
    }
  }

  updateBot(dt, bot) {
    const { game } = this;
    const ai = bot.ai;
    const diff = DIFFICULTY[bot.diffName];

    // ---------- 感知 ----------
    const vis = this.sense(bot, diff);
    if (vis) {
      if (!ai.target || ai.target.id !== vis.id) {
        ai.target = vis;
        ai.targetSeenT = 0;
        ai.reactT = diff.reaction + rand(0, diff.reactionJitter);
        ai.lastKnown = vis.pos.clone();
      } else {
        ai.lastKnown.copy(vis.pos);
      }
      ai.targetSeenT += dt;
      ai.lostT = 0;
    } else {
      ai.lostT += dt;
      if (ai.lostT > 3.2) ai.target = null;
    }

    if (ai.reactT > 0) ai.reactT -= dt;

    // 听觉
    if (!vis) {
      let heard = null, hd = 1e9;
      for (const n of game.noises) {
        const d = dist2d(n.pos, bot.pos);
        if (d < n.loud && game.time - n.t < 2.2 && d < hd) { hd = d; heard = n; }
      }
      if (heard) {
        if (!ai.hearPos) ai.hearPos = new THREE.Vector3();
        ai.hearPos.copy(heard.pos);
        ai.hearT = game.time;
        ai.investigate = true;
      }
    }

    // ---------- 目标管理 ----------
    const bomb = game.bomb;
    if (bot.team === "T") {
      if (bomb.state === "planted") {
        ai.phase = "defend";
        ai.defendPos = bomb.pos.clone();
      }
    } else {
      if (bomb.state === "planted") {
        ai.phase = "retake";
      }
    }

    // ---------- 移动 ----------
    const wish = new THREE.Vector3();
    let moveSpeed = 1;
    if (ai.phase === "plant") {
      // 下包：正在安放时站定；否则保持警戒，受压则转入交战
      if (game.bomb.planter === bot) {
        wish.set(0, 0, 0);
        moveSpeed = 0;
        bot.crouch = true;
      } else if (ai.target && ai.reactT <= 0 && dist2d(bot.pos, ai.target.pos) < 10) {
        ai.phase = "attack";
      } else {
        wish.set(0, 0, 0);
        moveSpeed = 0;
      }
    } else if (ai.target && ai.reactT <= 0) {
      const targetDist = dist2d(bot.pos, ai.target.pos);
      const pushingT = bot.team === "T" && (ai.phase === "attack" || ai.phase === "travel") &&
        targetDist > 16 && game.bomb.state !== "planted";
      if (pushingT) {
        // 远距离目标：边推进边打，不原地对枪
        this.tacticalMove(dt, bot, ai, diff, wish);
        moveSpeed = 0.8;
      } else {
        this.combatMove(dt, bot, ai, diff, wish);
        moveSpeed = 0.55 + diff.moveWhileShoot * 0.45;
      }
    } else {
      this.tacticalMove(dt, bot, ai, diff, wish);
      if (ai.phase === "travel" || ai.phase === "attack" || ai.phase === "retake") moveSpeed = 1;
    }
    if (wish.lengthSq() > 1) wish.normalize();
    bot.wishDir.set(wish.x * moveSpeed, 0, wish.z * moveSpeed);

    // 视线朝向
    if (ai.target && ai.reactT <= 0) {
      const targetEye = ai.target.eyePos();
      const err = this.aimError(bot, ai, diff, dt);
      const aimY = Math.atan2(-(targetEye.x - bot.pos.x), -(targetEye.z - bot.pos.z));
      const aimP = Math.atan2(targetEye.y - bot.eyePos().y,
        Math.hypot(targetEye.x - bot.pos.x, targetEye.z - bot.pos.z));
      const lag = diff.trackLag;
      bot.yaw = angleLerp(bot.yaw, aimY + err.yaw, clamp(dt / (lag + 0.02), 0, 1));
      bot.pitch = lerp(bot.pitch, clamp(aimP + err.pitch, -1.2, 1.2), clamp(dt / (lag + 0.02), 0, 1));
    } else {
      // 面向移动方向/架点方向
      let targetYaw = bot.yaw;
      if (wish.lengthSq() > 0.05) {
        targetYaw = Math.atan2(-wish.x, -wish.z);
      } else if (ai.phase === "hold" && ai.holdSpot) {
        targetYaw = ai.holdSpot.ry + Math.sin(game.time * 0.35 + bot.id.length) * 0.45;
      } else if (ai.phase === "defend" && ai.defendYaw !== undefined) {
        targetYaw = ai.defendYaw;
      }
      bot.yaw = angleLerp(bot.yaw, targetYaw, clamp(dt * 6, 0, 1));
      bot.pitch = lerp(bot.pitch, 0, clamp(dt * 4, 0, 1));
    }

    // ---------- 射击 ----------
    bot.triggerDown = false;
    if (bot.weaponDef()?.zoom) {
      const dist = ai.target ? bot.pos.distanceTo(ai.target.pos) : 999;
      bot.zoomed = !!ai.target && dist > 6;
    }
    if (ai.target && ai.reactT <= 0 && vis) {
      const dist = bot.pos.distanceTo(ai.target.pos);
      const aligned = this.isAligned(bot, ai.target.eyePos(), diff, dist);
      if (aligned || (ai.burstLeft > 0 && ai.targetSeenT > 0.15)) {
        bot.triggerDown = true;
      }
      // 开火节奏
      if (ai.burstLeft > 0) {
        ai.burstLeft -= dt;
        if (ai.burstLeft <= 0) ai.burstPause = rand(0.25, 0.55);
      } else {
        ai.burstPause -= dt;
        if (ai.burstPause <= 0) {
          ai.burstLeft = rand(diff.burstMin, diff.burstMax);
          ai.spray = dist < 5;
        }
      }
      if (dist > 12 && Math.random() < dt * 0.5 && bot.grounded) bot.crouch = true;
      if (dist < 4) bot.crouch = false;
    } else {
      ai.burstLeft = 0;
    }

    // ---------- 投掷物 ----------
    this.maybeThrowNade(bot, ai, diff, vis, wish);

    // ---------- 下包 / 拆包 ----------
    this.plantOrDefuse(bot, ai, vis);

    // ---------- 卡住检测 ----------
    ai.stuckT += dt;
    if (bot.pos.distanceTo(ai.lastPos) > 0.55) { ai.lastPos.copy(bot.pos); ai.stuckT = 0; }
    if (ai.stuckT > 1.4) {
      ai.stuckT = 0;
      ai.jitter = rand(0, Math.PI * 2);
      ai.jump = true;
    }

    // ---------- 移动输入 ----------
    const input = {
      moveDir: wish,
      jump: ai.jump,
      fire: bot.triggerDown,
      aim: bot.zoomed,
      walk: ai.phase === "hold" ? Math.random() < 0.15 : false,
      crouch: bot.crouch && ai.target ? true : bot.crouch,
    };
    ai.jump = false;
    // 蹲伏过渡
    if (!ai.target) bot.crouch = false;
    bot.updatePhysics(dt, game.map, input);

    // ---------- 开火执行 ----------
    if (bot.triggerDown) bot.weaponCtrl.fire(true);

    // ---------- 模型动画 ----------
    this.animateModel(dt, bot);
  }

  sense(bot, diff) {
    const { game } = this;
    if (bot.flashBlind > 0.45) return null;
    let best = null, bd = 1e9;
    for (const other of game.players) {
      if (other === bot || !other.alive || other.team === bot.team) continue;
      const d = bot.pos.distanceTo(other.pos);
      if (d > 58) continue;
      // 视野角
      const to = new THREE.Vector3(other.pos.x - bot.pos.x, 0, other.pos.z - bot.pos.z).normalize();
      const f = bot.forward();
      const dot = to.dot(f);
      const fov = bot.ai?.phase === "hold" ? 0.55 : 0.35; // cos(56°)~0.56, 更敏锐时更窄
      if (dot < fov) continue;
      const eye = bot.eyePos();
      const targetEye = other.eyePos();
      if (!game.map.los(eye, targetEye)) continue;
      const smoke = game.fx.smokeDensity(eye, targetEye);
      if (smoke > 0.55) continue;
      if (d < bd) { bd = d; best = other; }
    }
    return best;
  }

  aimError(bot, ai, diff, dt) {
    const d = bot.pos.distanceTo(ai.target.pos);
    const distFactor = clamp(d / 25, 0.35, 1.6);
    const errBase = diff.aimErr * distFactor;
    const moving = Math.hypot(bot.vel.x, bot.vel.z) > 1.5;
    const err = errBase * (moving ? 2.2 : 1) * (bot.crouch ? 0.75 : 1);
    ai.errWander += dt * rand(0.5, 2);
    return {
      yaw: Math.sin(ai.errWander) * err * 0.8 + rand(-err, err) * 0.4,
      pitch: Math.cos(ai.errWander * 0.8) * err * 0.7 + rand(-err, err) * 0.4,
    };
  }

  isAligned(bot, targetEye, diff, dist) {
    const aimY = Math.atan2(-(targetEye.x - bot.pos.x), -(targetEye.z - bot.pos.z));
    const aimP = Math.atan2(targetEye.y - bot.eyePos().y,
      Math.hypot(targetEye.x - bot.pos.x, targetEye.z - bot.pos.z));
    let dy = Math.abs(angleDiff(bot.yaw, aimY));
    let dp = Math.abs(bot.pitch - aimP);
    const tol = diff.aimErr * clamp(dist / 20, 0.5, 2.5) * 2.2;
    return dy < tol && dp < tol * 1.4;
  }

  combatMove(dt, bot, ai, diff, wish) {
    const { game } = this;
    const toTarget = new THREE.Vector3(ai.target.pos.x - bot.pos.x, 0, ai.target.pos.z - bot.pos.z);
    const dist = toTarget.length();
    const dirT = toTarget.clone().normalize();
    const perp = new THREE.Vector3(-dirT.z, 0, dirT.x);
    ai.strafeT -= dt;
    if (ai.strafeT <= 0) {
      ai.strafeT = rand(0.35, 1.1);
      ai.strafeDir = Math.random() < 0.5 ? -1 : 1;
    }
    // 残局时间不足 → 强攻进点；否则保持交战距离
    const urgent = bot.team === "T" && game.timeLeft < 42;
    const desiredBase = { easy: 4.5, normal: 6.5, hard: 8, expert: 10 }[bot.diffName] ?? 8;
    const desired = urgent ? 0 : desiredBase;
    const push = dist > desired ? 1 : (bot.team === "CT" && dist < 2.5 ? -0.6 : 0);
    wish.copy(dirT).multiplyScalar(push * 0.8).addScaledVector(perp, ai.strafeDir * 0.65);
    ai.jitter += dt;
    // 带包者接近下包点 → 强行转入下包
    if (bot.bombCarrier && game.bomb.state === "carried" && ai.site && ai.phase !== "plant") {
      const plants = game.map.tactical.plants[ai.site];
      if (plants.some((pt) => dist2d(bot.pos, pt) < 2.4)) {
        ai.phase = "plant";
      }
    }
  }

  tacticalMove(dt, bot, ai, diff, wish) {
    const { game } = this;
    let target = null;
    if (ai.phase === "travel") {
      if (ai.wpIndex < ai.waypoints.length) {
        target = ai.waypoints[ai.wpIndex];
      } else {
        const site = game.map.tactical.sites[ai.site];
        target = site.center;
      }
    } else if (ai.phase === "attack") {
      const site = game.map.tactical.sites[ai.site];
      if (bot.bombCarrier && game.bomb.state === "carried") {
        const plants = game.map.tactical.plants[ai.site];
        target = plants[Math.floor(Math.random() * plants.length)];
      } else {
        target = site.center;
      }
    } else if (ai.phase === "defend") {
      const d = bot.pos.distanceTo(ai.defendPos);
      if (d > 4.5) target = ai.defendPos;
      else {
        // 守包：面向来路方向
        const toBomb = new THREE.Vector3(ai.defendPos.x - bot.pos.x, 0, ai.defendPos.z - bot.pos.z);
        if (toBomb.length() > 0.5) {
          ai.defendYaw = Math.atan2(-toBomb.x, -toBomb.z);
        }
        return;
      }
    } else if (ai.phase === "retake") {
      target = game.bomb.pos;
      ai.retakeNear = dist2d(bot.pos, game.bomb.pos) < 2.2;
    } else if (ai.phase === "hold") {
      const hs = ai.holdSpot;
      const d = dist2d(bot.pos, hs);
      if (d > 1.4) {
        target = hs;
      } else {
        if (ai.investigate && game.time - ai.hearT < 8 && ai.hearPos) {
          const hd = dist2d(ai.hearPos, hs);
          if (hd < 18) {
            target = ai.hearPos;
            ai.investigate = false;
          }
        }
      }
    } else if (ai.phase === "search") {
      if (!ai.searchTarget) ai.searchTarget = pickSitePoint(game, "A");
      if (dist2d(bot.pos, ai.searchTarget) < 3) {
        ai.searchTarget = pickSitePoint(game, "B");
      }
      target = ai.searchTarget;
    }
    if (!target) return;

    // 离路点近则推进
    if (ai.phase === "travel" && ai.wpIndex < ai.waypoints.length) {
      if (dist2d(bot.pos, target) < 2.2) {
        ai.wpIndex++;
        if (ai.wpIndex >= ai.waypoints.length) ai.phase = "attack";
      }
    }
    if (ai.phase === "attack" && bot.bombCarrier && game.bomb.state === "carried") {
      const plants = game.map.tactical.plants[ai.site];
      if (plants.some((pt) => dist2d(bot.pos, pt) < 1.5)) {
        ai.phase = "plant";
        return;
      }
    }

    // 直线可行则直奔
    const nav = game.map.nav;
    const startY = nav.gy[nav.idx(nav.cellOf(bot.pos.x, bot.pos.z).ix, nav.cellOf(bot.pos.x, bot.pos.z).iz)];
    const endY = nav.gy[nav.idx(nav.cellOf(target.x, target.z).ix, nav.cellOf(target.x, target.z).iz)];
    const off = hashOffset(bot.id);
    const tx = target.x + off.x, tz = target.z + off.z;
    if (nav.clearLine(bot.pos.x, bot.pos.z, tx, tz, startY, endY)) {
      wish.set(tx - bot.pos.x, 0, tz - bot.pos.z).normalize();
      return;
    }
    const field = this.fieldTo(tx, tz);
    // 若自身格不可导航（出生点被挤占等），向最近可行走格移动脱困
    const selfCell = nav.cellOf(bot.pos.x, bot.pos.z);
    const selfIdx = nav.idx(selfCell.ix, selfCell.iz);
    if ((field.d0[selfIdx] < 0 && field.d1[selfIdx] < 0) || !nav.walk[selfIdx]) {
      let found = null, bestD = 1e9;
      for (let r = 1; r <= 8; r++) {
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
          const cx = selfCell.ix + dx, cz = selfCell.iz + dz;
          if (cx < 0 || cz < 0 || cx >= nav.nx || cz >= nav.nz) continue;
          const ni = nav.idx(cx, cz);
          if (!nav.walk[ni]) continue;
          const d0 = field.d0[ni], d1 = field.d1[ni];
          const d = d0 >= 0 ? d0 : (d1 >= 0 ? d1 : -1);
          if (d < 0 || d >= bestD) continue;
          const h = d0 >= 0 ? nav.gy[ni] : nav.gy2[ni];
          if (h - bot.pos.y > 0.56) continue; // 上不去的层
          found = { x: nav.minX + (cx + 0.5) * nav.cell, z: nav.minZ + (cz + 0.5) * nav.cell, d };
          bestD = d;
        }
      }
      if (found) {
        wish.set(found.x - bot.pos.x, 0, found.z - bot.pos.z).normalize();
        return;
      }
    }
    const step = nav.stepToward(field, bot.pos.x, bot.pos.z, bot.pos.y);
    if (step) {
      wish.set(step.x - bot.pos.x, 0, step.z - bot.pos.z).normalize();
      // 抖动避免叠人
      const jx = Math.sin(game.time * 0.7 + bot.id.length * 3) * 0.25;
      wish.x += jx;
      wish.z += Math.cos(game.time * 0.7 + bot.id.length * 3) * 0.25;
    }
  }

  maybeThrowNade(bot, ai, diff, vis, wish) {
    const { game } = this;
    if (Math.random() > diff.nadeChance * 0.06) return; // 每帧概率→约每几秒
    const nades = game.map.tactical.nades;
    const candidates = nades.filter((n) => n.team === bot.team && bot.nades[n.type] > 0);
    if (!candidates.length) return;
    for (const n of candidates) {
      const d = dist2d(bot.pos, n.pos);
      if (d > 5) continue;
      // 情境判断
      const targetD = dist2d(bot.pos, n.target);
      if (n.type === "flash" && ai.phase !== "attack" && ai.phase !== "travel") continue;
      if (n.type === "smoke" && Math.random() < 0.5) continue;
      if (n.type === "molotov" && game.bomb.state !== "planted" && ai.phase !== "attack") continue;
      if (n.type === "he" && !vis) continue;
      if (targetD > 45) continue;
      // 走向投掷点
      if (d > 2.5) {
        ai.tempThrow = n;
        wish.set(n.pos.x - bot.pos.x, 0, n.pos.z - bot.pos.z).normalize();
      } else {
        bot.yaw = Math.atan2(-(n.target.x - n.pos.x), -(n.target.z - n.pos.z));
        game.throwNade(bot, n.type, true);
      }
      break;
    }
  }

  plantOrDefuse(bot, ai, vis) {
    const { game } = this;
    if (bot.team === "T" && bot.bombCarrier && game.bomb.state === "carried" && ai.phase === "plant") {
      const site = game.map.tactical.sites[ai.site];
      if (site.plantArea.containsPoint(bot.pos.x, bot.pos.y, bot.pos.z, 0.2)) {
        const nearEnemy = vis ? dist2d(bot.pos, ai.target.pos) : Infinity;
        if (!vis || nearEnemy > 10 || game.timeLeft < 30) game.startPlant(bot);
      } else {
        ai.phase = "attack";
      }
    }
    if (bot.team === "CT" && game.bomb.state === "planted") {
      const d = dist2d(bot.pos, game.bomb.pos);
      const enemyDist = vis ? dist2d(bot.pos, ai.target.pos) : Infinity;
      if (d < 1.6 && (!vis || enemyDist > 12)) {
        game.startDefuse(bot);
      } else if (d < 1.2) {
        // 找到包但有人打：架枪
        ai.phase = "retake";
      }
    }
  }

  animateModel(dt, bot) {
    if (!bot.model) return;
    const m = bot.model.parts;
    bot.model.group.position.set(bot.pos.x, bot.pos.y, bot.pos.z);
    bot.model.group.rotation.y = bot.yaw;
    const speed = Math.hypot(bot.vel.x, bot.vel.z);
    const swing = Math.sin(bot.bobPhase * 2.2) * clamp(speed / 3, 0, 1) * 0.55;
    if (m.legL) m.legL.rotation.x = swing;
    if (m.legR) m.legR.rotation.x = -swing;
    if (m.armL) m.armL.rotation.x = -swing * 0.7;
    // 躯干朝向
    if (m.torso) m.torso.rotation.y = 0;
    if (m.head) m.head.rotation.x = -bot.pitch * 0.4;
    // 持枪臂指向
    if (m.armR) {
      m.armR.rotation.x = -Math.PI / 2 + Math.max(-0.7, -bot.pitch);
    }
    // 蹲伏
    const crouchT = bot.crouchAmt;
    bot.model.group.position.y = -crouchT * 0.55;
    // 死亡姿态在 game 处理
  }

  // 死后的尸体保持
  static corpseFall(bot, game) {
    const g = bot.model.group;
    bot.corpse = { t: 0, axis: rand(0, Math.PI * 2) };
    g.rotation.set(0, 0, 0);
  }
}

function makeAI(bot, diff) {
  return {
    role: null, route: null, waypoints: [], wpIndex: 0, site: "A",
    phase: "travel", target: null, targetSeenT: 0, reactT: 0.3,
    lastKnown: new THREE.Vector3(), lostT: 0, hearPos: null, hearT: 0, investigate: false,
    holdSpot: null, searchTarget: null, defendPos: new THREE.Vector3(), defendYaw: undefined,
    burstLeft: 0, burstPause: 0, spray: false, strafeDir: 1, strafeT: 0,
    stuckT: 0, lastPos: bot.pos.clone(), jitter: 0, jump: false, errWander: rand(0, 10),
    retakeNear: false, tempThrow: null,
  };
}

function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function hashOffset(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return { x: ((h % 7) / 7 - 0.5) * 1.4, z: (((h >> 3) % 7) / 7 - 0.5) * 1.4 };
}

function pickSitePoint(game, site) {
  const plants = game.map.tactical.plants[site];
  return plants[Math.floor(Math.random() * plants.length)];
}

export function makeBot(opts) {
  const bot = new Bot(opts);
  opts.game.scene.add(bot.model.group);
  bot.weaponCtrl = new WeaponController(bot, opts.game);
  bot.weaponCtrl.group.visible = false;
  attachBotWeapon(bot);
  return bot;
}
