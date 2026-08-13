// ============================================================================
// 游戏编排：对局/回合流程、命中判定、伤害、经济、炸弹、投掷物、拾取、观战
// ============================================================================

import * as THREE from "three";
import { G, WEAPONS, NADES, HITGROUPS, killReward } from "./config.js";
import { AABB, clamp, rand, dist2d, lerp } from "./util.js";
import { AudioSys } from "./audio.js";
import { Effects } from "./effects.js";
import { Player, makeWeapon } from "./player.js";
import { WeaponController } from "./weapons.js";
import { Bot, BotBrain, makeBot } from "./bots.js";
import { buildBombModel, buildWorldGun, buildNadeWorld } from "./viewmodel.js";
import { buildMap } from "./maps.js";
import { attachBotWeapon as attachBotWeaponFn } from "./weapons.js";

const BOT_NAMES_T = ["沙狼", "毒蝎", "独眼", "锯齿", "秃鹫", "蛇吻"];
const BOT_NAMES_CT = ["猎鹰", "铁壁", "幽灵", "银狐", "哨兵", "捷豹"];

export class Game {
  constructor(opts) {
    this.canvas = opts.canvas;
    this.hud = opts.hud;
    this.paused = false;
    this.settings = null;
    this.time = 0;
    this.phase = "menu";       // menu|loading|buy|live|end|matchEnd
    this.phaseT = 0;
    this.timeLeft = G.roundTime;
    this.round = 0;
    this.score = { T: 0, CT: 0 };
    this.lossStreak = { T: 0, CT: 0 };
    this.players = [];
    this.human = null;
    this.map = null;
    this.bots = new BotBrain(this);
    this.noises = [];
    this.projectiles = [];
    this.fireZones = [];
    this.pickups = [];
    this.killfeed = [];
    this.bomb = {
      state: "idle", carrier: null, pos: new THREE.Vector3(), timer: G.bombTime,
      plantProgress: 0, defuseProgress: 0, planter: null, defuser: null,
      model: null, light: null, beepT: 0,
    };
    this.specTarget = null;
    this.specIndex = 0;
    this.cameraShakePos = new THREE.Vector3();
    this.humanDeathT = 0;
    this.lastDamage = null;
    this.matchStats = null;
    this.roundWinner = null;
    this.roundEndReason = "";
    this.freezeHint = "";
    this.stats = { kills: 0, plants: 0, defuses: 0, explodes: 0, rounds: 0 };

    this.initRenderer();
  }

  // -------------------------------------------------------------------------
  initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0d0f);
    this.scene.fog = new THREE.Fog(0x0b0d0f, 60, 260);
    this.camera = new THREE.PerspectiveCamera(90, 1, 0.08, 400);
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera);
    this.fx = new Effects(this.scene);
    this.sun = new THREE.DirectionalLight(0xffe2ad, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -70; this.sun.shadow.camera.right = 70;
    this.sun.shadow.camera.top = 70; this.sun.shadow.camera.bottom = -70;
    this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 220;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun);
    this.hemi = new THREE.HemisphereLight(0xd8c9a5, 0x4a4030, 0.85);
    this.scene.add(this.hemi);
    this.onResize();
    window.addEventListener("resize", () => this.onResize());
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // -------------------------------------------------------------------------
  loadMap(id, onReady) {
    this.phase = "loading";
    this.hud.showLoading("生成地形与导航网格…");
    // 让 UI 先渲染
    setTimeout(() => {
      try {
        if (this.map) {
          this.scene.remove(this.map.group);
          this.map.group.traverse((o) => {
            if (o.isInstancedMesh) o.dispose();
            if (o.material) o.material.dispose();
          });
        }
        this.map = buildMap(id);
        this.map.group.updateMatrixWorld(true);
        this.scene.add(this.map.group);
        const nav = this.map.buildNav();
        // 光照与环境
        const meta = this.map.data.meta;
        this.scene.background = new THREE.Color(meta.sky);
        this.scene.fog.color.setHex(meta.fog);
        this.hemi.color.setHex(meta.amb);
        this.hemi.groundColor.setHex(0x3a352a);
        this.sun.color.setHex(meta.sunColor);
        this.sun.position.copy(meta.sun).multiplyScalar(90);
        this.sun.target.position.set(0, 0, 0);
        this.scene.add(this.sun.target);
        this.camera.far = 420;
        this.camera.updateProjectionMatrix();
        AudioSys.startAmbient(meta.ambientKind);
        this.hud.setupRadar(this.map);
        this.hud.hideLoading();
        console.log(`[map] ${id} nav cells: ${nav.nx * nav.nz}, walkable: ${nav.walk.reduce((a, b) => a + b, 0)}`);
        onReady?.();
      } catch (e) {
        console.error("map/start failed", e?.stack || e);
        this.hud.hideLoading();
      }
    }, 30);
  }

  startWithSettings(settings) {
    this.loadMap(settings.map, () => this.startMatch(settings));
  }

  setPaused(v) { this.paused = v; }
  matchEnded() { return this.phase === "matchEnd"; }
  requestLock() {
    try { this.canvas.requestPointerLock(); } catch (e) {}
  }
  backToMenu() {
    this.phase = "menu";
    this.paused = false;
    for (const p of this.players) {
      if (p.model) this.scene.remove(p.model.group);
      if (p.weaponCtrl) p.weaponCtrl.destroy();
    }
    for (const pk of this.pickups) this.scene.remove(pk.group);
    for (const pr of this.projectiles) this.scene.remove(pr.model);
    if (this.bomb.model) this.scene.remove(this.bomb.model.group);
    if (this.map) this.scene.remove(this.map.group);
    this.players = [];
    this.pickups = [];
    this.projectiles = [];
    this.fireZones = [];
    this.map = null;
    AudioSys.stopAmbient();
    this.hud.showMainMenu();
  }

  startMatch(settings) {
    // 清理上一局实体
    for (const p of this.players) {
      if (p.model) this.scene.remove(p.model.group);
      if (p.weaponCtrl) p.weaponCtrl.destroy();
    }
    for (const pk of this.pickups) this.scene.remove(pk.group);
    for (const pr of this.projectiles) this.scene.remove(pr.model);
    if (this.bomb.model) this.scene.remove(this.bomb.model.group);
    this.bomb.model = null;
    this.bomb.carrier = null;
    this.settings = settings;
    this.score = { T: 0, CT: 0 };
    this.lossStreak = { T: 0, CT: 0 };
    this.round = 0;
    this.players = [];
    this.pickups = [];
    this.projectiles = [];
    this.fireZones = [];
    this.killfeed = [];
    const humanTeam = settings.team === "random" ? (Math.random() < 0.5 ? "T" : "CT") : settings.team;
    const diff = settings.difficulty;
    const mkBot = (team, i) => {
      const name = team === "T" ? BOT_NAMES_T[i % BOT_NAMES_T.length] : BOT_NAMES_CT[i % BOT_NAMES_CT.length];
      const spawns = this.map.data.spawns[team];
      const sp = spawns[(i + 1) % spawns.length];
      return makeBot({ game: this, name: `BOT ${name}`, team, spawn: { ...sp }, difficulty: diff });
    };
    // 人类玩家
    const hSpawns = this.map.data.spawns[humanTeam];
    const hsp = hSpawns[0];
    this.human = new Player({ name: "你", team: humanTeam, spawn: { ...hsp } });
    this.human.onStep = () => this.noise(this.human.pos, 9);
    this.human.weaponCtrl = new WeaponController(this.human, this);
    this.players.push(this.human);
    // Bot
    for (let i = 0; i < settings.botCount; i++) {
      this.players.push(mkBot("T", i));
      this.players.push(mkBot("CT", i));
    }
    // 人类阵营的额外 bot 会顶掉一个出生点，无妨
    this.phase = "buy";
    this.hud.hideMenus();
    this.hud.showHUD(true);
    this.startRound();
  }

  startRound() {
    this.round++;
    this.stats.rounds++;
    this.phase = "buy";
    this.phaseT = G.buyTime;
    this.timeLeft = G.roundTime;
    this.projectiles = [];
    this.fireZones = [];
    this.pickups = [];
    this.noises = [];
    this.killfeed = [];
    this.hud.clearKillfeed();
    this.bomb.state = "idle";
    this.bomb.plantProgress = 0;
    this.bomb.defuseProgress = 0;
    this.bomb.planter = null;
    this.bomb.defuser = null;
    this.roundWinner = null;
    this.roundEndReason = "";
    if (this.bomb.model) { this.bomb.model.group.visible = false; }

    // 重置玩家
    for (const p of this.players) {
      const spawns = this.map.data.spawns[p.team];
      const sp = spawns[(this.players.indexOf(p)) % spawns.length];
      p.pos.set(sp.x, sp.y, sp.z);
      p.vel.set(0, 0, 0);
      p.yaw = sp.ry;
      p.pitch = 0;
      p.alive = true;
      p.hp = 100;
      p.armor = 0;
      p.helmet = false;
      p.kit = false;
      p.weapons = { primary: null, secondary: makeWeapon(p.team === "T" ? "glock" : "usp"), knife: { id: "knife", mag: Infinity, reserve: Infinity } };
      p.nades = { he: 0, flash: 0, smoke: 0, molotov: 0 };
      p.current = "secondary";
      p.reloading = false;
      p.zoomed = false;
      p.crouch = false;
      p.crouchAmt = 0;
      p.groundedY = sp.y;
      p.recoilPitch = 0; p.recoilYaw = 0; p.bloom = 0;
      p.flashBlind = 0;
      p.ai = null;
      p.bombCarrier = false;
      p.corpse = null;
      if (p.model) {
        p.model.group.visible = true;
        p.model.group.rotation.set(0, 0, 0);
        p.model.group.position.y = 0;
      }
      if (p.isBot) attachBotWeapon2(p);
      p.drawT = p.drawTotal = 0.35;
    }

    // 指派炸弹携带者
    const ts = this.players.filter((p) => p.team === "T");
    const carrier = ts[Math.floor(Math.random() * ts.length)];
    this.giveBomb(carrier);

    // Bot 购买
    for (const p of this.players) if (p.isBot) this.botBuy(p);
    // Bot 切主武器
    for (const p of this.players) if (p.isBot && p.weapons.primary) p.switchTo("primary");

    this.bots.setupRound();
    this.hud.centerMessage(`回合 ${this.round}`, 1.6);
    this.hud.alert(`冻结时间 — 按 B 购买装备`);
  }

  giveBomb(p) {
    if (!this.bomb.model) {
      const b = buildBombModel();
      this.bomb.model = b;
      this.scene.add(b.group);
      b.group.visible = false;
    }
    if (this.bomb.carrier) this.bomb.carrier.bombCarrier = false;
    this.bomb.carrier = p;
    p.bombCarrier = true;
    this.bomb.state = "carried";
    this.bomb.model.group.visible = false; // 背包状态不显示模型
  }

  // -------------------------------------------------------------------------
  botBuy(p) {
    const settings = this.settings;
    let budget = p.money;
    const buy = (id) => {
      const def = WEAPONS[id];
      if (!def || budget < def.price) return false;
      budget -= def.price;
      this.equipWeapon(p, id, false);
      return true;
    };
    const buyNade = (t) => {
      if (p.nades[t] >= NADES[t].max || budget < NADES[t].price) return;
      budget -= NADES[t].price;
      p.nades[t]++;
    };
    const rich = budget > 3700;
    const poor = budget < 2200;
    if (budget >= 1000) {
      p.helmet = true;
      p.armor = 100;
      budget -= 1000;
    } else if (budget >= 650) {
      p.armor = 100;
      budget -= 650;
    }
    // 主武器优先级
    if (rich) {
      if (!p.weapons.primary) buy("ak47") || buy("m4a4");
    } else if (!poor) {
      buy("mp9") || buy("mac10");
    }
    if (settings.difficulty === "expert" || settings.difficulty === "hard") {
      if (rich) buy("deagle");
      buyNade("he"); buyNade("flash"); buyNade("smoke");
      if (budget >= 400 && Math.random() < 0.7) buyNade("molotov");
    } else if (settings.difficulty === "normal") {
      if (Math.random() < 0.6) buyNade("flash");
      if (Math.random() < 0.5) buyNade("smoke");
      if (Math.random() < 0.4) buyNade("he");
    }
    if (p.team === "CT" && budget >= 400 && Math.random() < 0.8) {
      p.kit = true;
      budget -= 400;
    }
  }

  // -------------------------------------------------------------------------
  buy(player, id) {
    if (this.phase !== "buy") return false;
    if (!this.inBuyZone(player)) return false;
    const def = WEAPONS[id];
    if (def) {
      if (player.money < def.price) return false;
      const slot = def.slot === "primary" ? "primary" : "secondary";
      if (player.weapons[slot]?.id === id) return false;
      player.money -= def.price;
      this.equipWeapon(player, id, true);
      AudioSys.buy();
      return true;
    }
    if (id === "kevlar") {
      if (player.money < 650 || player.armor >= 100) return false;
      player.money -= 650;
      player.armor = 100;
      AudioSys.buy();
      return true;
    }
    if (id === "helmet") {
      if (player.money < 1000) return false;
      player.money -= player.armor >= 100 ? 350 : 1000;
      player.armor = 100;
      player.helmet = true;
      AudioSys.buy();
      return true;
    }
    if (id === "kit") {
      if (player.team !== "CT" || player.kit || player.money < 400) return false;
      player.money -= 400;
      player.kit = true;
      AudioSys.buy();
      return true;
    }
    const nade = NADES[id];
    if (nade) {
      if (player.money < nade.price || player.nades[id] >= nade.max) return false;
      player.money -= nade.price;
      player.nades[id]++;
      AudioSys.buy();
      return true;
    }
    return false;
  }

  equipWeapon(player, id, dropOld) {
    const def = WEAPONS[id];
    const slot = def.slot === "primary" ? "primary" : "secondary";
    if (dropOld && player.weapons[slot]) {
      this.dropPickup(player, player.weapons[slot].id);
    }
    player.weapons[slot] = makeWeapon(id);
    if (player.isBot) attachBotWeapon2(player);
    if (player === this.human && (player.current !== slot || player.current === "knife")) {
      player.switchTo(slot);
      if (player.weaponCtrl) player.weaponCtrl.buildFor(id);
    }
  }

  dropPickup(player, weaponId) {
    const g = buildWorldGun(weaponId);
    const pos = player.pos.clone().add(new THREE.Vector3(rand(-0.4, 0.4), 0.06, rand(-0.4, 0.4)));
    g.position.copy(pos);
    g.rotation.y = rand(0, Math.PI * 2);
    this.scene.add(g);
    this.pickups.push({ type: "weapon", id: weaponId, pos, group: g, t: 0, slot: WEAPONS[weaponId]?.slot });
  }

  inBuyZone(player) {
    const zones = this.map.data.buyZones[player.team];
    return zones.some((z) => z.containsPoint(player.pos.x, player.pos.y, player.pos.z));
  }

  // -------------------------------------------------------------------------
  // 射击
  shootRay(shooter, origin, dir, def, muzzle, isFirst) {
    const maxDist = 400;
    // 玩家命中
    let best = null, bestT = maxDist;
    for (const p of this.players) {
      if (p === shooter || !p.alive) continue;
      const hit = rayHitPlayer(origin, dir, p);
      if (hit && hit.t < bestT) { bestT = hit.t; best = { p, ...hit }; }
    }
    // 世界碰撞
    let wallT = null;
    {
      const t = this.map.spatial.raycast(origin, dir, bestT);
      if (t !== null) wallT = t;
    }
    const end = origin.clone().addScaledVector(dir, wallT ?? bestT);
    if (isFirst) {
      this.fx.tracer(origin, end, def?.tracer ? parseInt(def.tracer.slice(1), 16) : 0xffd27a);
      this.noise(shooter.pos, 42);
    }
    if (wallT !== null) {
      const point = origin.clone().addScaledVector(dir, wallT);
      const normal = approxNormal(this.map, point, dir);
      this.fx.impact(point, normal, true);
      AudioSys.wallHit();
      return;
    }
    if (best) {
      const point = origin.clone().addScaledVector(dir, bestT);
      this.applyHit(shooter, best.p, point, dir, def, best.head);
    }
  }

  applyHit(shooter, victim, point, dir, def, head) {
    const dist = shooter.pos.distanceTo(victim.pos);
    const rangeMod = def ? def.rangeMod ** (dist / 50) : 1;
    let dmg = def ? def.damage : 55;
    let group = "chest";
    if (head) group = "head";
    const dmgFinal = Math.max(1, Math.round(dmg * (HITGROUPS[group] ?? 1) * rangeMod));
    const real = victim.applyDamage(dmgFinal, group);
    shooter.damageDone += real;
    this.fx.blood(point, dir);
    if (victim === this.human) {
      this.lastDamage = { attacker: shooter, dmg: real, head };
      this.hud.damageFlash();
      this.hud.damageDir(shooter.pos, victim.pos);
    }
    if (shooter === this.human) {
      AudioSys.hit(head);
      this.hud.hitmarker(head);
      if (head && !victim.alive) AudioSys.headshotKill();
      if (!victim.alive) {
        AudioSys.kill();
        this.hud.killPanel(victim, head, real);
      }
    } else {
      // Bot 射击音反馈（第三人称）
    }
    if (!victim.alive) this.onKill(shooter, victim, head, shooter.weaponId());
    if (victim.alive && victim.hp < 40 && victim === this.human) AudioSys.hurt();
  }

  melee(player) {
    const eye = player.eyePos();
    const dir = player.forward().clone();
    dir.y += player.pitch * 0.2;
    dir.normalize();
    for (const p of this.players) {
      if (p === player || !p.alive) continue;
      const hit = rayHitPlayer(eye, dir, p, 2.2);
      if (hit) {
        const point = eye.clone().addScaledVector(dir, hit.t);
        const real = p.applyDamage(hit.head ? 120 : 55, hit.head ? "head" : "chest");
        this.fx.blood(point, dir);
        if (!p.alive) this.onKill(player, p, hit.head, "knife");
        break;
      }
    }
  }

  onKill(killer, victim, head, weaponId) {
    this.stats.kills++;
    victim.deaths++;
    killer.kills++;
    killer.mvpScore += head ? 2 : 1;
    killer.money = Math.min(G.maxMoney, killer.money + killReward(weaponId));
    const msg = { killer: killer.name, victim: victim.name, weapon: weaponLabel(weaponId), head, team: killer.team, t: this.time };
    this.killfeed.push(msg);
    this.hud.killfeed(msg);
    AudioSys.bodyHit();
    // 掉枪与炸弹
    if (victim.weapons.primary) this.dropPickup(victim, victim.weapons.primary.id);
    if (victim.weapons.secondary && victim.weapons.secondary.id) this.dropPickup(victim, victim.weapons.secondary.id);
    if (victim.bombCarrier) {
      this.bomb.state = "dropped";
      this.bomb.carrier = null;
      victim.bombCarrier = false;
      this.bomb.pos.copy(victim.pos);
      this.bomb.pos.y += 0.05;
      this.bomb.model.group.position.copy(this.bomb.pos);
      this.bomb.model.group.visible = true;
      this.hud.alert("炸弹已掉落！");
    }
    if (victim.model) {
      BotBrain.corpseFall(victim, this);
    }
    if (victim === this.human) this.humanDeathT = this.time;
  }

  // -------------------------------------------------------------------------
  // 投掷物
  throwNade(player, type, fromBot = false) {
    if (!player.nades[type] || player.nades[type] <= 0) return;
    player.nades[type]--;
    const eye = player.eyePos();
    const dir = player.forward().clone();
    const pitch = player.pitch + rand(-0.01, 0.01);
    dir.set(-Math.sin(player.yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(player.yaw) * Math.cos(pitch)).normalize();
    const speed = type === "flash" ? 16 : 17.5;
    const pos = eye.clone().addScaledVector(dir, 0.3);
    const model = buildNadeWorld(type);
    model.position.copy(pos);
    this.scene.add(model);
    AudioSys.nadeThrow();
    this.projectiles.push({
      type, pos, vel: dir.clone().multiplyScalar(speed), model, fuse: NADES[type].fuse, t: 0,
      owner: player, bounces: 0, groundedT: 0,
    });
    // 切回主武器
    if (player.weapons.primary) player.switchTo("primary");
    else player.switchTo("secondary");
    if (player === this.human && player.weaponCtrl) player.weaponCtrl.buildFor(player.weaponId());
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.t += dt;
      if (pr.fuse !== Infinity && pr.t >= pr.fuse) {
        this.detonate(pr);
        this.scene.remove(pr.model);
        this.projectiles.splice(i, 1);
        continue;
      }
      pr.vel.y -= G.gravity * dt;
      const r = 0.08;
      // 分步移动与反弹
      for (const axis of ["x", "y", "z"]) {
        pr.pos[axis] += pr.vel[axis] * dt;
        const solids = this.map.spatial.query(pr.pos.x, pr.pos.z, 0.6);
        for (const s of solids) {
          if (s.intersectsCylinder(pr.pos.x, pr.pos.y, pr.pos.z, r, 0.02, pr.pos.y)) {
            if (axis === "x") {
              pr.pos.x = pr.vel.x > 0 ? s.x1 - r - 0.001 : s.x2 + r + 0.001;
              pr.vel.x = -pr.vel.x * 0.42;
            } else if (axis === "z") {
              pr.pos.z = pr.vel.z > 0 ? s.z1 - r - 0.001 : s.z2 + r + 0.001;
              pr.vel.z = -pr.vel.z * 0.42;
            } else {
              pr.pos.y = pr.vel.y > 0 ? s.y1 - r - 0.001 : s.y2 + r + 0.001;
              pr.vel.y = -pr.vel.y * 0.42;
              pr.vel.x *= 0.75; pr.vel.z *= 0.75;
              if (Math.abs(pr.vel.y) < 2) { pr.vel.y = 0; pr.groundedT += dt; }
            }
            if (Math.abs(pr.vel[axis]) > 2.2) {
              AudioSys.nadeBounce();
              pr.bounces++;
              if (pr.type === "molotov" && pr.bounces >= 2 && axis === "y") {
                // 燃烧瓶撞击即碎
                this.detonate(pr);
                this.scene.remove(pr.model);
                this.projectiles.splice(i, 1);
                return;
              }
            }
          }
        }
      }
      pr.model.position.copy(pr.pos);
      pr.model.rotation.x += dt * 7;
      pr.model.rotation.y += dt * 5;
    }
  }

  detonate(pr) {
    const pos = pr.pos;
    if (pr.type === "he") {
      this.fx.explosion(pos);
      AudioSys.explosion(this.audioListenerPos().distanceTo(pos));
      this.noise(pos, 90);
      for (const p of this.players) {
        if (!p.alive || p.team === pr.owner.team) continue;
        const d = p.pos.distanceTo(pos);
        const dmg = Math.round(98 * clamp(1 - d / 5.2, 0, 1));
        if (dmg > 0) {
          p.applyDamage(dmg, "chest");
          if (!p.alive) this.onKill(pr.owner, p, false, "he");
        }
      }
    } else if (pr.type === "flash") {
      this.fx.flash(pos, new THREE.Vector3(0, 1, 0));
      AudioSys.flashbang(this.audioListenerPos().distanceTo(pos));
      this.noise(pos, 70);
      for (const p of this.players) {
        if (!p.alive) continue;
        const eye = p.eyePos();
        const d = eye.distanceTo(pos);
        if (d > 30 || !this.map.los(eye, pos)) continue;
        const toFlash = pos.clone().sub(eye).normalize();
        const f = p.forward();
        const facing = clamp(toFlash.dot(f), -1, 1);
        const angleDeg = Math.acos(facing) * 180 / Math.PI;
        const blind = 4.5 * (1 - d / 26) * clamp(1 - angleDeg / 100, 0, 1);
        if (blind > 0.25) {
          p.flashBlind = Math.max(p.flashBlind, blind);
        }
      }
    } else if (pr.type === "smoke") {
      this.fx.smokeGrenade(pos);
      AudioSys.smokePop();
    } else if (pr.type === "molotov") {
      this.fx.fireZone(pos, 7);
      AudioSys.molotov();
      AudioSys.fireLoop();
      this.fireZones.push({ pos: pos.clone(), t: 0, life: 7, owner: pr.owner, tick: 0 });
    }
  }

  updateFireZones(dt) {
    for (let i = this.fireZones.length - 1; i >= 0; i--) {
      const fz = this.fireZones[i];
      fz.t += dt;
      if (fz.t >= fz.life) { this.fireZones.splice(i, 1); continue; }
      fz.tick -= dt;
      if (fz.tick <= 0) {
        fz.tick = 0.45;
        for (const p of this.players) {
          if (!p.alive || p.team === fz.owner.team) continue;
          const d = Math.hypot(p.pos.x - fz.pos.x, p.pos.z - fz.pos.z);
          if (d < 2.6 && p.pos.y < fz.pos.y + 0.9) {
            const real = p.applyDamage(rand(7, 12), "legs", true);
            fz.owner.damageDone += real;
            if (!p.alive) this.onKill(fz.owner, p, false, "molotov");
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // 炸弹
  startPlant(p) {
    if (this.bomb.state !== "carried" || this.bomb.carrier !== p) return;
    const site = this.plantSiteOf(p);
    if (!site) return;
    if (!this.bomb.planter) {
      this.bomb.planter = p;
      this.bomb.plantProgress = 0;
      this.hud.alert("正在安放炸弹…");
    }
  }

  plantSiteOf(p) {
    const sites = this.map.tactical.sites;
    for (const key of ["A", "B"]) {
      if (sites[key].plantArea.containsPoint(p.pos.x, p.pos.y, p.pos.z, 0.1)) return sites[key];
    }
    return null;
  }

  startDefuse(p) {
    if (this.bomb.state !== "planted") return;
    if (dist2d(p.pos, this.bomb.pos) > 1.6) return;
    if (!this.bomb.defuser) {
      this.bomb.defuser = p;
      this.bomb.defuseProgress = 0;
      this.hud.alert(p.kit ? "正在拆除炸弹…" : "正在拆除炸弹（无拆弹器）…");
    }
  }

  updateBomb(dt) {
    const b = this.bomb;
    // 安放
    if (b.state === "carried" && b.planter) {
      const p = b.planter;
      const site = this.plantSiteOf(p);
      const moving = Math.hypot(p.vel.x, p.vel.z) > 0.6;
      if (!p.alive || !site || moving || b.carrier !== p) {
        b.planter = null;
        b.plantProgress = 0;
      } else {
        b.plantProgress += dt;
        if (b.plantProgress >= G.plantTime) {
          b.state = "planted";
          this.stats.plants++;
          b.planter = null;
          b.plantProgress = 0;
          b.carrier = null;
          p.bombCarrier = false;
          b.pos.copy(p.pos);
          b.timer = G.bombTime;
          b.model.group.position.copy(b.pos);
          b.model.group.visible = true;
          b.model.light.intensity = 1.2;
          AudioSys.bombPlant();
          this.noise(b.pos, 120);
          this.hud.centerMessage("炸弹已安放", 2.2);
          this.hud.alert("T 必须在 40 秒内阻止拆除！");
          // T 方团队奖励
          for (const pl of this.players) if (pl.team === "T" && pl.alive) {
            pl.money = Math.min(G.maxMoney, pl.money + G.plantBonus);
          }
        }
      }
    }
    // 拆除
    if (b.state === "planted" && b.defuser) {
      const p = b.defuser;
      if (!p.alive || dist2d(p.pos, b.pos) > 1.6) {
        b.defuser = null;
        b.defuseProgress = 0;
      } else {
        b.defuseProgress += dt;
        const need = p.kit ? G.defuseTime : G.defuseNoKit;
        if (b.defuseProgress >= need) {
          b.state = "defused";
          this.stats.defuses++;
          b.defuser = null;
          b.model.group.visible = false;
          AudioSys.bombDefuse();
          this.endRound("CT", "炸弹已拆除");
        }
      }
    }
    // 倒计时
    if (b.state === "planted") {
      b.timer -= dt;
      b.beepT -= dt;
      const stage = b.timer > 10 ? 0 : b.timer > 5 ? 1 : 2;
      const interval = stage === 0 ? 1.0 : stage === 1 ? 0.5 : 0.25;
      if (b.beepT <= 0) {
        b.beepT = interval;
        AudioSys.bombBeep(stage);
        b.model.light.intensity = 1.2 + Math.random() * 1.2;
      }
      if (b.timer <= 0) {
        b.state = "exploded";
        this.stats.explodes++;
        this.fx.explosion(b.pos.clone().add(new THREE.Vector3(0, 0.5, 0)));
        AudioSys.explosion(this.audioListenerPos().distanceTo(b.pos));
        // 爆炸杀死附近所有人
        for (const p of this.players) {
          if (!p.alive) continue;
          const d = p.pos.distanceTo(b.pos);
          if (d < 18) {
            p.hp = 0;
            p.alive = false;
            if (p.model) p.corpse = { t: 0, axis: rand(0, Math.PI * 2) };
          }
        }
        this.endRound("T", "炸弹爆炸");
      }
    }
    // 掉落拾取
    if (b.state === "dropped") {
      b.model.group.position.copy(b.pos);
      b.model.light.intensity = 0.7 + Math.sin(this.time * 5) * 0.3;
      for (const p of this.players) {
        if (p.alive && p.team === "T" && !p.bombCarrier && dist2d(p.pos, b.pos) < 1.0) {
          this.giveBomb(p);
          this.hud.alert(`${p.name} 捡起了炸弹`);
          break;
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // 回合与胜负
  checkWin() {
    if (this.roundWinner) return;
    const ts = this.players.filter((p) => p.team === "T" && p.alive);
    const cts = this.players.filter((p) => p.team === "CT" && p.alive);
    if (this.bomb.state === "planted") {
      if (cts.length === 0) this.endRound("T", "反恐精英全灭");
      // T 全灭但炸弹已下：继续，等爆炸或拆除
    } else {
      if (ts.length === 0) this.endRound("CT", "恐怖分子全灭");
      else if (cts.length === 0) this.endRound("T", "反恐精英全灭");
      else if (this.timeLeft <= 0 && this.bomb.state !== "planted") this.endRound("CT", "时间耗尽");
    }
  }

  endRound(winner, reason) {
    if (this.roundWinner) return;
    this.roundWinner = winner;
    this.roundEndReason = reason;
    this.score[winner]++;
    this.phase = "end";
    this.phaseT = G.endTime;
    // 经济结算
    for (const p of this.players) {
      if (p.team === winner) {
        const bonus = this.bomb.state === "exploded" && winner === "T" ? G.bombExplodeBonus : G.winMoney;
        p.money = Math.min(G.maxMoney, p.money + bonus);
      } else {
        this.lossStreak[p.team] = (this.lossStreak[p.team] || 0) + 1;
        const amt = Math.min(G.lossMoneyBase + (this.lossStreak[p.team] - 1) * G.lossMoneyInc, G.lossMoneyCap);
        p.money = Math.min(G.maxMoney, p.money + amt);
      }
    }
    this.lossStreak[winner] = 0;
    AudioSys.roundWin(this.human && this.human.team === winner);
    this.hud.centerMessage(winner === "T" ? "恐怖分子获胜" : "反恐精英获胜", 2.4);
    this.hud.alert(reason);
  }

  // -------------------------------------------------------------------------
  update(dt, humanInput) {
    if (this.paused) return;
    this.time += dt;
    const step = Math.min(dt, 0.05);
    if (this.phase === "menu" || this.phase === "loading") {
      this.fx.update(dt);
      this.renderer.render(this.scene, this.camera);
      return;
    }
    // 闪光衰减
    for (const p of this.players) p.flashBlind = Math.max(0, p.flashBlind - dt * 0.85);

    if (this.phase === "buy") {
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        this.phase = "live";
        this.hud.centerMessage("开始行动", 1.4);
        this.hud.alert("");
        AudioSys.roundStart();
      }
    } else if (this.phase === "live") {
      this.timeLeft -= dt;
      if (Math.ceil(this.timeLeft) === 10 && Math.floor(this.timeLeft + dt) === 11) AudioSys.tenSecond();
      this.simulate(step, humanInput);
      this.updateBomb(step);
      this.checkWin();
    } else if (this.phase === "end") {
      this.simulate(step, null); // 死亡观战动画继续
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        if (this.score.T >= this.settings.roundsWin || this.score.CT >= this.settings.roundsWin) {
          this.endMatch();
        } else {
          this.startRound();
        }
      }
    }
    this.updateCamera(dt);
    this.fx.update(dt);
    this.hud.update(this);
    this.renderer.render(this.scene, this.camera);
  }

  simulate(dt, humanInput) {
    humanInput = humanInput || {
      moveDir: new THREE.Vector3(), jump: false, fire: false, firePressed: false,
      aim: false, walk: false, crouch: false, reload: false, use: false,
    };
    // 人类移动
    if (this.human.alive) {
      if (this.phase === "live") {
        this.human.walk = humanInput.walk;
        this.human.crouch = humanInput.crouch;
        const input = {
          moveDir: humanInput.moveDir,
          jump: humanInput.jump,
          fire: humanInput.fire,
          aim: humanInput.aim,
          walk: humanInput.walk,
          crouch: humanInput.crouch,
        };
        this.human.updatePhysics(dt, this.map, input);
        this.human.weaponCtrl.update(dt);
        // 开镜
        const def = this.human.weaponDef();
        if (def?.zoom) this.human.zoomed = humanInput.aim && !this.human.reloading;
        else this.human.zoomed = false;
        if (humanInput.fire) {
          this.human.weaponCtrl.fire(humanInput.firePressed);
        }
        if (humanInput.reload) this.human.weaponCtrl.startReload();
        // 下包/拆包
        if (humanInput.use) {
          if (this.human.team === "T" && this.bomb.state === "carried") this.startPlant(this.human);
          else if (this.human.team === "CT" && this.bomb.state === "planted") this.startDefuse(this.human);
        }
        this.collectPickups(this.human);
        this.human.triggerDown = humanInput.fire;
      }
    } else {
      this.human.weaponCtrl.group.visible = false;
    }
    // Bot
    if (this.phase === "live") this.bots.update(dt);
    for (const p of this.players) {
      if (p.isBot && p.alive) {
        p.weaponCtrl.update(dt);
        this.collectPickups(p);
      }
      if (!p.alive && p.corpse && p.model) {
        const c = p.corpse;
        c.t += dt;
        const k = Math.min(1, c.t / 0.55);
        p.model.group.rotation.set(0, 0, 0);
        p.model.group.rotation.x = k * 1.45;
        p.model.group.rotation.z = Math.sin(c.axis) * 0.2;
        p.model.group.position.y = Math.sin(k * Math.PI) * 0.05;
      }
    }
    this.updateProjectiles(dt);
    this.updateFireZones(dt);
    // 噪音清理
    this.noises = this.noises.filter((n) => this.time - n.t < 3);
    // 拾取实体寿命
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.t += dt;
      if (pk.t > 90) {
        this.scene.remove(pk.group);
        this.pickups.splice(i, 1);
      }
    }
  }

  collectPickups(p) {
    if (!p.alive) return;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      if (dist2d(p.pos, pk.pos) > 0.9) continue;
      if (pk.type === "weapon") {
        if (!p.weapons[pk.slot]) {
          p.weapons[pk.slot] = makeWeapon(pk.id);
          if (p.isBot) attachBotWeapon2(p);
          if (p === this.human) {
            p.switchTo(pk.slot);
            p.weaponCtrl.buildFor(pk.id);
          }
          AudioSys.pickup();
          this.scene.remove(pk.group);
          this.pickups.splice(i, 1);
        }
      }
    }
  }

  noise(pos, loud) {
    this.noises.push({ pos: pos.clone(), loud, t: this.time });
    if (this.noises.length > 40) this.noises.shift();
  }

  autoReload(p) {
    p.weaponCtrl?.startReload();
  }

  // -------------------------------------------------------------------------
  // 相机
  updateCamera(dt) {
    const cam = this.camera;
    let target = null;
    if (this.human.alive) {
      target = this.human;
      const p = this.human;
      const eye = p.eyePos();
      cam.position.copy(eye);
      const shake = this.fx.shake * this.fx.shakeAmt;
      if (shake > 0.001) {
        cam.position.x += rand(-shake, shake);
        cam.position.y += rand(-shake, shake);
        cam.position.z += rand(-shake, shake);
      }
      cam.rotation.set(p.pitch + p.recoilPitch, p.yaw + p.recoilYaw, 0);
      // FOV
      const def = p.weaponDef();
      const zoomFov = def?.zoom ? (def.zoom + (def.zoomAlt ?? def.zoom) * 0) : 1;
      const baseFov = 90;
      const targetFov = def?.zoom ? lerp(baseFov, baseFov * def.zoom, p.zoomT) : baseFov;
      cam.fov = lerp(cam.fov, targetFov, clamp(dt * 10, 0, 1));
      cam.updateProjectionMatrix();
      // 视图模型挂载
      if (p.weaponCtrl?.group) {
        const vm = p.weaponCtrl.group;
        if (vm.parent !== cam) {
          if (vm.parent) vm.parent.remove(vm);
          cam.add(vm);
        }
        vm.visible = p.alive && !(p.zoomed && p.zoomT > 0.85 && def?.view === "sniper");
      }
    } else {
      // 观战
      this.updateSpectator(dt);
    }
  }

  updateSpectator(dt) {
    const alive = this.players.filter((p) => p.alive && p.team === this.human.team);
    if (!alive.length) {
      const anyAlive = this.players.filter((p) => p.alive);
      if (anyAlive.length) this.specTarget = anyAlive[0];
    } else {
      if (!this.specTarget || !this.specTarget.alive) {
        this.specTarget = alive[this.specIndex % alive.length];
      }
    }
    if (this.specTarget) {
      const t = this.specTarget;
      const eye = t.eyePos();
      const back = t.forward().multiplyScalar(-2.8).add(new THREE.Vector3(0, 0.9, 0));
      const want = eye.clone().add(back);
      this.camera.position.lerp(want, clamp(dt * 6, 0, 1));
      this.camera.rotation.set(lerp(this.camera.rotation.x, t.pitch, clamp(dt * 5, 0, 1)),
        angleLerpYaw(this.camera.rotation.y, t.yaw), 0);
      this.hud.showSpectate(t.name);
    }
    if (this.human.weaponCtrl?.group) {
      this.camera.remove(this.human.weaponCtrl.group);
    }
  }

  cycleSpectator() {
    const alive = this.players.filter((p) => p.alive && p.team === this.human.team);
    if (!alive.length) return;
    this.specIndex = (this.specIndex + 1) % alive.length;
    this.specTarget = alive[this.specIndex];
  }

  audioListenerPos() {
    if (this.human.alive) return this.human.eyePos();
    if (this.specTarget) return this.specTarget.eyePos();
    return new THREE.Vector3(0, 0, 0);
  }

  // -------------------------------------------------------------------------
  endMatch() {
    this.phase = "matchEnd";
    const winner = this.score.T >= this.settings.roundsWin ? "T" : "CT";
    const mvp = [...this.players].sort((a, b) => b.mvpScore - a.mvpScore)[0];
    this.matchStats = { winner, mvp };
    AudioSys.matchEnd(this.human.team === winner);
    this.hud.showMatchEnd(this);
  }

  restartMatch() {
    this.startMatch(this.settings);
  }

  dispose() {
    this.fx.group.traverse((o) => { if (o.material) o.material.dispose(); if (o.geometry) o.geometry.dispose(); });
    this.map?.group.traverse((o) => { if (o.material) o.material.dispose(); if (o.geometry) o.geometry.dispose(); });
    this.renderer.dispose();
  }
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------
function rayHitPlayer(origin, dir, p, maxT = 400) {
  const r = 0.34;
  const h = p.height;
  const feetY = p.pos.y;
  // 身体圆柱
  const body = rayCylinder(origin, dir, new THREE.Vector3(p.pos.x, feetY, p.pos.z), h, r);
  // 头部球
  const headCenter = new THREE.Vector3(p.pos.x, feetY + p.eyeHeight + 0.05, p.pos.z);
  const head = raySphere(origin, dir, headCenter, 0.18);
  let best = null;
  if (body && body < maxT) best = { t: body, head: false };
  if (head && head < (best?.t ?? maxT)) best = { t: head, head: true };
  return best;
}

function rayCylinder(o, d, base, h, r) {
  // 直立圆柱：轴 x=base.x, z=base.z, y∈[base.y, base.y+h]
  const a = d.x * d.x + d.z * d.z;
  const ox = o.x - base.x, oz = o.z - base.z;
  const b = 2 * (ox * d.x + oz * d.z);
  const c = ox * ox + oz * oz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
    if (t < 0.02) continue;
    const y = o.y + d.y * t;
    if (y >= base.y && y <= base.y + h) return t;
  }
  return null;
}

function raySphere(o, d, c, r) {
  const oc = new THREE.Vector3().subVectors(o, c);
  const b = oc.dot(d);
  const cc = oc.lengthSq() - r * r;
  if (cc > 0 && b > 0) return null;
  const disc = b * b - cc;
  if (disc < 0) return null;
  let t = -b - Math.sqrt(disc);
  if (t < 0.02) t = -b + Math.sqrt(disc);
  return t > 0.02 ? t : null;
}

function approxNormal(map, point, dir) {
  // 采样周围判断法线
  const eps = 0.25;
  const inside = (p) => {
    for (const s of map.spatial.query(p.x, p.z, 0.6)) {
      if (s.containsPoint(p.x, p.y, p.z)) return true;
    }
    return false;
  };
  const n = new THREE.Vector3();
  n.x = inside(point.clone().add(new THREE.Vector3(eps, 0, 0))) ? -1 : inside(point.clone().add(new THREE.Vector3(-eps, 0, 0))) ? 1 : 0;
  n.y = inside(point.clone().add(new THREE.Vector3(0, eps, 0))) ? -1 : inside(point.clone().add(new THREE.Vector3(0, -eps, 0))) ? 1 : 0;
  n.z = inside(point.clone().add(new THREE.Vector3(0, 0, eps))) ? -1 : inside(point.clone().add(new THREE.Vector3(0, 0, -eps))) ? 1 : 0;
  if (n.lengthSq() < 0.1) n.copy(dir).multiplyScalar(-1);
  return n.normalize();
}

function weaponLabel(id) {
  if (!id) return "刀";
  if (WEAPONS[id]) return WEAPONS[id].name;
  if (NADES[id]) return NADES[id].name;
  return id;
}

function angleLerpYaw(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * 0.2;
}

function attachBotWeapon2(p) { attachBotWeaponFn(p); }
