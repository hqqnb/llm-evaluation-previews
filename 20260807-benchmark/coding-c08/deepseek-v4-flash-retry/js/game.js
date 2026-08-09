(function () {
  const THREE = window.THREE;
  const U = window.TFPS.U;
  const W = window.TFPS.W;
  const PHYS = window.TFPS.PHYS;
  const SFX = window.TFPS.SFX;
  const PlayerEntity = window.TFPS.PlayerEntity;
  const Bot = window.TFPS.Bot;
  const Effects = window.TFPS.Effects;
  const WeaponModels = window.TFPS.WeaponModels;
  const WS = window.TFPS.WS;

  class Game {
    constructor() {
      this.canvas = document.getElementById("game-canvas");
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: "high-performance" });
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.05;

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 700);
      this.camera.rotation.order = "YXZ";
      this.entityGroup = new THREE.Group();
      this.scene.add(this.entityGroup);
      this.effects = new Effects(this.scene);
      this.weaponModels = new WeaponModels(this.camera);
      this.camera.add(this.weaponModels.root);
      this.scene.add(this.camera);

      this.state = "menu";
      this.roundState = "idle";
      this.map = null;
      this.mapId = null;
      this.players = [];
      this.bots = [];
      this.player = null;
      this.settings = { map: "dust2", team: "CT", bots: 4, diff: "normal", winScore: 8 };
      this.score = { T: 0, CT: 0 };
      this.roundNumber = 1;
      this.roundTime = 115;
      this.freezeTime = 6;
      this.time = 0;
      this.roundEndT = 0;
      this.warmupT = 0;
      this.lossBonus = { T: 0, CT: 0 };
      this.bomb = { planted: false, carrier: null, pos: new THREE.Vector3(), site: null, timer: 0, defusing: null, defuseT: 0, dropped: false };
      this.grenades = [];
      this.drops = [];
      this.spectateIdx = 0;
      this.spectateTarget = null;
      this.spectateYaw = 0;
      this.spectatePitch = 0;
      this.paused = false;
      this.overtime = false;
      this.matchOver = false;
      this.keys = {};
      this.mouse = { down: false, rdown: false };
      this.sens = 0.0022;
      this.lastWeaponPen = 0.5;
      this.cameraShake = 0;
      this.flashT = 0;
      this.nextRoundReady = false;
      this.plantingSpot = null;
      this.doorDirty = false;
      this.noiseEvents = [];
      this.lastSeen = null;
      this.raycaster = new THREE.Raycaster();
      this.raycaster.far = 300;
      this.solidGroup = null;
      this.ambientLight = null;
      this.hemiLight = null;
      this.sunLight = null;
      this.skyMesh = null;
      this.lastMuzzle = new THREE.Vector3();
      this.viewBob = 0;
      this.viewBobT = 0;
      this.recoilPitch = 0;
      this.recoilYaw = 0;
      this.lastFoot = 0;
      this.killfeed = [];
      this.autoFired = false;
      this.bindEvents();
    }

    bindEvents() {
      window.addEventListener("resize", () => {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
      });
      document.addEventListener("keydown", e => {
        this.keys[e.code] = true;
        if (["Space", "Tab", "KeyB", "KeyG", "KeyR", "KeyE"].includes(e.code)) e.preventDefault();
        if (e.code === "KeyR") { const p = this.player; if (p && p.alive) this.startReload(p); }
        if (e.code === "KeyG") this.dropCurrent();
        if (e.code === "KeyB") { if (this.roundState === "freeze") this.ui.toggleBuy(); }
        if (e.code === "Tab") this.ui.showScoreboard(true);
        if (e.code === "KeyQ") { const p = this.player; if (p && p.alive) p.equipSlot(p.lastSlot); }
        if (e.code.startsWith("Digit")) {
          const n = parseInt(e.code.slice(5), 10);
          const map = { 1: "melee", 2: "pistol", 3: "primary", 4: "he", 5: "flash", 6: "smoke", 7: "molotov" };
          const slot = map[n];
          if (slot && this.player && this.player.alive) this.player.equipSlot(slot);
        }
        if (e.code === "Escape") this.ui.handleEscape();
      });
      document.addEventListener("keyup", e => {
        this.keys[e.code] = false;
        if (e.code === "Tab") this.ui.showScoreboard(false);
        if (e.code === "KeyE" && this.player && this.player.action) {
          this.player.action = null;
        }
      });
      document.addEventListener("mousemove", e => {
        if (document.pointerLockElement !== this.canvas) return;
        if (this.paused || this.state !== "playing") return;
        const p = this.player;
        if (p && p.alive && this.roundState !== "freeze") {
          p.yaw -= e.movementX * this.sens;
          p.pitch -= e.movementY * this.sens;
          p.pitch = U.clamp(p.pitch, -1.52, 1.52);
        } else if (!p || !p.alive) {
          this.spectateYaw -= e.movementX * this.sens;
          this.spectatePitch = U.clamp((this.spectatePitch || 0) - e.movementY * this.sens, -1.3, 1.3);
        }
      });
      document.addEventListener("mousedown", e => {
        if (this.state !== "playing" || this.paused) return;
        if (e.button === 0) {
          this.mouse.down = true;
          if (!this.player || !this.player.alive) this.cycleSpectate();
        }
        if (e.button === 2) this.mouse.rdown = true;
      });
      document.addEventListener("mouseup", e => {
        if (e.button === 0) this.mouse.down = false;
        if (e.button === 2) this.mouse.rdown = false;
      });
      document.addEventListener("wheel", e => {
        if (this.state !== "playing" || !this.player || !this.player.alive) return;
        const slots = this.player.slots;
        const idx = slots.indexOf(this.player.currentSlot);
        const next = e.deltaY > 0 ? (idx + 1) % slots.length : (idx - 1 + slots.length) % slots.length;
        this.player.equipSlot(slots[next]);
      });
      this.canvas.addEventListener("click", () => {
        if (this.state === "playing" && !this.paused && document.pointerLockElement !== this.canvas) {
          this.canvas.requestPointerLock();
        }
      });
    }

    setupLights(map) {
      const theme = map.theme;
      if (this.hemiLight) this.scene.remove(this.hemiLight);
      if (this.sunLight) this.scene.remove(this.sunLight);
      if (this.ambientLight) this.scene.remove(this.ambientLight);
      if (this.skyMesh) this.scene.remove(this.skyMesh);
      const skyColor = theme === "snow" ? 0xdce9f5 : theme === "night" ? 0x1c2733 : 0x8fb8d8;
      this.hemiLight = new THREE.HemisphereLight(skyColor, theme === "sand" ? 0xb89a6a : theme === "snow" ? 0xd8e5f0 : 0x3a4a62, theme === "night" ? 2.0 : 1.1);
      this.scene.add(this.hemiLight);
      this.sunLight = new THREE.DirectionalLight(theme === "night" ? 0xa8cdf0 : 0xfff2d8, theme === "night" ? 2.8 : 2.1);
      this.sunLight.position.set(40, 55, 10);
      this.sunLight.castShadow = true;
      this.sunLight.shadow.mapSize.set(2048, 2048);
      const sb = this.sunLight.shadow.camera;
      sb.left = -60; sb.right = 60; sb.top = 60; sb.bottom = -60; sb.near = 1; sb.far = 160;
      this.sunLight.shadow.bias = -0.0006;
      this.scene.add(this.sunLight);
      this.ambientLight = new THREE.AmbientLight(0xffffff, theme === "night" ? 0.8 : 0.12);
      this.scene.add(this.ambientLight);
      const skyGeo = new THREE.SphereGeometry(420, 24, 12);
      const skyMat = new THREE.MeshBasicMaterial({ map: window.TFPS.TEX.sky(theme === "night" ? "night" : theme), side: THREE.BackSide, fog: false, depthWrite: false });
      this.skyMesh = new THREE.Mesh(skyGeo, skyMat);
      this.skyMesh.position.set(32, 0, -30);
      this.scene.add(this.skyMesh);
      this.scene.fog = new THREE.Fog(map.fog || 0xd8c29a, 30, map.theme === "night" ? 90 : map.theme === "outpost" ? 130 : 95);
    }

    loadMap(id) {
      if (this.map) {
        this.scene.remove(this.map.solidGroup);
        this.scene.remove(this.map.decorGroup);
        this.scene.remove(this.map.lightGroup);
      }
      this.effects.clear();
      this.grenades.length = 0;
      this.drops.length = 0;
      const build = window.TFPS.MAPS[id];
      if (!build) throw new Error("missing map " + id);
      this.map = build(this.scene);
      this.mapId = id;
      this.solidGroup = this.map.solidGroup;
      this.scene.add(this.map.solidGroup);
      this.scene.add(this.map.decorGroup);
      this.scene.add(this.map.lightGroup);
      this.setupLights(this.map);
      SFX.stopAmbience();
      SFX.startAmbience(this.map.ambienceKind === "snow" ? "snow" : this.map.ambienceKind === "night" ? "night" : "desert");
    }

    createPlayers() {
      for (const p of this.players) {
        if (p.model) this.entityGroup.remove(p.model);
      }
      this.players = [];
      this.bots = [];
      const total = this.settings.bots * 2 + 1;
      const names = window.TFPS.NAMES.slice();
      const team = this.settings.team === "random" ? (Math.random() < 0.5 ? "T" : "CT") : this.settings.team;
      this.settings.actualTeam = team;
      let id = 0;
      const spawns = this.map.spawns;
      const used = new Set();
      const pickSpawn = (t) => {
        const list = spawns[t];
        let i = U.randInt(0, list.length - 1);
        for (let k = 0; k < 8 && used.has(t + i); k++) i = (i + 1) % list.length;
        used.add(t + i);
        return list[i];
      };
      // human
      const hs = pickSpawn(team);
      this.player = new PlayerEntity(this, { id: id++, name: "你", team, x: hs.x, z: hs.z, yaw: hs.yaw });
      this.player.isHuman = true;
      this.players.push(this.player);
      // bots
      const tCount = team === "T" ? this.settings.bots : this.settings.bots + 1;
      const ctCount = team === "CT" ? this.settings.bots : this.settings.bots + 1;
      for (let i = 0; i < tCount; i++) {
        const s = pickSpawn("T");
        const bot = new Bot(this, { id: id++, name: names.shift() || "T-Bot", team: "T", diff: this.settings.diff, x: s.x, z: s.z, yaw: s.yaw });
        this.bots.push(bot); this.players.push(bot);
      }
      for (let i = 0; i < ctCount; i++) {
        const s = pickSpawn("CT");
        const bot = new Bot(this, { id: id++, name: names.shift() || "CT-Bot", team: "CT", diff: this.settings.diff, x: s.x, z: s.z, yaw: s.yaw });
        this.bots.push(bot); this.players.push(bot);
      }
      this.players.forEach((p, i) => { p.teamIdx = i; });
    }

    startMatch(settings) {
      this.settings = Object.assign(this.settings, settings);
      this.loadMap(this.settings.map);
      this.createPlayers();
      this.score = { T: 0, CT: 0 };
      this.roundNumber = 1;
      this.lossBonus = { T: 0, CT: 0 };
      this.overtime = false;
      this.matchOver = false;
      this.state = "playing";
      this.paused = false;
      this.ui.hideAllMenus();
      this.ui.showHUD();
      this.startWarmup();
      SFX.ensure();
      SFX.play("round_start");
    }

    startWarmup() {
      this.roundState = "warmup";
      this.warmupT = 10;
      this.spawnAllForRound();
      this.ui.banner("热身阶段", "10 秒后开始第 1 回合", 2.0);
    }

    spawnAllForRound() {
      const spawns = this.map.spawns;
      const idx = { T: 0, CT: 0 };
      for (const p of this.players) {
        const list = spawns[p.team];
        const s = list[idx[p.team] % list.length];
        idx[p.team]++;
        p.respawnAt(s.x, s.z, s.yaw);
        if (this.roundState === "warmup") {
          p.money = 16000;
          p.armor = 100; p.helmet = true;
          p.inventory.primary = p.team === "T" ? "ak47" : "m4a4";
          p.inventory.he = 1; p.inventory.smoke = 1;
          p.refreshSlots();
          p.weapon.ammo = p.getWeaponDef().mag;
          p.weapon.reserve = p.getWeaponDef().reserve;
          p.equipSlot("primary", true);
        }
      }
    }

    startRound() {
      // side swap at half
      if (this.roundNumber === this.settings.winScore + 1) {
        this.swapSides();
      }
      if (this.overtime && (this.roundNumber - this.settings.winScore * 2) % 3 === 1 && this.roundNumber > this.settings.winScore * 2) {
        this.swapSides();
      }
      this.roundState = "freeze";
      this.freezeTime = 6;
      this.roundTime = 115;
      this.bomb = { planted: false, carrier: null, pos: new THREE.Vector3(), site: null, timer: 0, defusing: null, defuseT: 0, dropped: false };
      this.grenades.length = 0;
      this.drops.length = 0;
      this.effects.clear();
      this.plantingSpot = null;
      this.killfeed.length = 0;
      this.lastSeen = null;
      // reset alive/dead, keep/refill equipment
      const spawns = this.map.spawns;
      const idx = { T: 0, CT: 0 };
      for (const p of this.players) {
        const list = spawns[p.team];
        const s = list[idx[p.team] % list.length];
        idx[p.team]++;
        const wasAlive = p.alive && p.health > 0 && this.roundState !== "warmup";
        p.resetRound();
        p.pos.set(s.x, 0, s.z);
        p.yaw = s.yaw;
        if (!wasAlive) {
          p.setDefaultWeapons();
          p.armor = 0; p.helmet = false; p.defuseKit = false;
        } else {
          const def = p.getWeaponDef();
          if (p.inventory.primary && W[p.inventory.primary]) {
            p.weapon.ammo = W[p.inventory.primary].mag;
            p.weapon.reserve = W[p.inventory.primary].reserve;
          } else {
            p.weapon.ammo = def.mag; p.weapon.reserve = def.reserve;
          }
        }
        p.equipSlot(p.inventory.primary ? "primary" : "pistol", true);
        // bomb carrier
        if (p.team === "T" && !this.bomb.carrier && p.alive) {
          this.bomb.carrier = p;
          p.bomb = true;
        }
      }
      // bots buy
      for (const b of this.bots) this.buyForBot(b);
      // assign bot plans
      this.assignBotPlans();
      this.ui.clearKillfeed();
      this.ui.updateHUD();
      SFX.play("round_start");
      this.ui.banner("回合 " + this.roundNumber, "购买阶段", 1.5);
    }

    swapSides() {
      for (const p of this.players) {
        p.team = p.team === "T" ? "CT" : "T";
        if (!p.alive) p.setDefaultWeapons();
        p.inventory.pistol = p.team === "T" ? "glock" : "usp";
        p.defuseKit = false;
        p.bomb = false;
        p.setDefaultWeapons();
        if (p.inventory.primary && W[p.inventory.primary]) {
          p.weapon.ammo = W[p.inventory.primary].mag;
          p.weapon.reserve = W[p.inventory.primary].reserve;
          p.equipSlot("primary", true);
        }
      }
      this.lossBonus = { T: 0, CT: 0 };
      this.ui.banner("交换阵营", "上半场结束", 2.5);
    }

    assignBotPlans() {
      const routes = this.map.plans.tRoutes;
      let routeIdx = 0;
      let carrier = null;
      for (const p of this.players) {
        if (!p.isBot) continue;
        if (p.team === "T") {
          const route = routes[routeIdx % routes.length];
          routeIdx++;
          p.plan = route;
          p.setPath(route.nodes);
          p.state = "attack";
          if (p.bomb && !carrier) carrier = p;
        } else {
          const holds = this.map.plans.ctHolds;
          const h = holds[p.holdIdx != null ? (p.holdIdx % holds.length) : (routeIdx++ % holds.length)];
          p.holdIdx = holds.indexOf(h);
          p.plan = h;
          p.pathToNode(h.node);
          p.state = "defend";
        }
      }
      // ensure bomb carrier not leading? keep as assigned
    }

    buyForBot(b) {
      const money = b.money;
      const diff = b.diff;
      let wantPrimary = null;
      const roleRoll = Math.random();
      const aggressive = diff === "hard" || roleRoll > 0.55;
      if (money >= 4750 && roleRoll > 0.82) wantPrimary = "awp";
      else if (money >= 3100) wantPrimary = b.team === "T" ? "ak47" : "m4a4";
      else if (money >= 2700) wantPrimary = b.team === "T" ? "ak47" : (b.team === "CT" ? "m4a4" : "ak47");
      else if (money >= 1700 && aggressive) wantPrimary = "mp7";
      else if (money >= 1500) wantPrimary = "mp5";
      if (wantPrimary && money >= W[wantPrimary].price) {
        b.buyWeapon(wantPrimary);
        b.equipSlot("primary", true);
      } else {
        if (money >= 700) b.buyWeapon("deagle");
      }
      if (b.team === "CT" && money >= 400) b.buyEquip("defuse");
      if (money >= 650 + (b.inventory.primary ? W[b.inventory.primary].price : 0) + 400) {
        b.buyEquip("kevlar");
        if (money >= 1000 + (b.inventory.primary ? W[b.inventory.primary].price : 0)) b.buyEquip("helmet");
      }
      const nadeBudget = money - (b.inventory.primary ? W[b.inventory.primary].price : 200) - (b.armor ? 650 : 0) - (b.helmet ? 350 : 0);
      if (nadeBudget > 400 && Math.random() < (diff === "hard" ? 0.85 : 0.5)) b.buyWeapon("he");
      if (nadeBudget > 700 && Math.random() < (diff === "hard" ? 0.7 : 0.4)) b.buyWeapon("smoke");
      if (nadeBudget > 1000 && Math.random() < (diff === "hard" ? 0.6 : 0.3)) b.buyWeapon("flash");
      b.weapon.ammo = b.getWeaponDef().mag;
      b.weapon.reserve = b.getWeaponDef().reserve;
    }

    // ---------- per-frame ----------
    update(dt) {
      if (this.paused || this.state !== "playing") return;
      this.time += dt;
      SFX.ensure();
      if (this.roundState === "warmup") {
        this.warmupT -= dt;
        this.updateHuman(dt);
        this.updateBots(dt);
        this.updateGrenades(dt);
        this.updateEffects(dt);
        this.updateCamera(dt);
        this.ui.updateHUD();
        if (this.warmupT <= 0) { this.roundNumber = 1; this.startRound(); }
        return;
      }
      if (this.roundState === "freeze") {
        this.freezeTime -= dt;
        this.updateHuman(dt);
        this.updateBots(dt);
        this.updateEffects(dt);
        this.updateCamera(dt);
        this.ui.updateHUD();
        if (this.freezeTime <= 0) {
          this.roundState = "live";
          this.ui.banner("回合开始", "GO GO GO", 1.2);
          SFX.play("round_start");
        }
        return;
      }
      if (this.roundState === "over") {
        this.roundEndT -= dt;
        this.updateEffects(dt);
        this.updateCamera(dt);
        if (this.roundEndT <= 0 && this.nextRoundReady) {
          if (this.matchOver) { this.ui.showMatchEnd(); this.state = "over"; }
          else { this.roundNumber++; this.startRound(); }
        }
        return;
      }
      // live or bomb
      if (this.roundState === "live" || this.roundState === "bomb") {
        if (!this.bomb.planted) {
          this.roundTime -= dt;
          if (this.roundTime <= 0) { this.endRound("CT", "timeout"); return; }
        }
        this.updateHuman(dt);
        this.updateBots(dt);
        this.updateGrenades(dt);
        this.updateBomb(dt);
        this.updateDoors(dt);
        this.updateEffects(dt);
        this.updatePickups(dt);
        this.updateCamera(dt);
        this.checkRoundEnd();
        this.ui.updateHUD();
        // noise broadcast
        while (this.noiseEvents.length) {
          const n = this.noiseEvents.pop();
          for (const p of this.players) {
            if (p.isBot && p.team !== n.team && p.alive) p.hear(n.pos, n.radius, n.loud);
          }
        }
      }
    }

    updateHuman(dt) {
      const p = this.player;
      if (!p || !p.alive) return;
      const freeze = this.roundState === "freeze";
      if (!freeze) this.updateInputMove(p, dt);
      this.updateWeaponTimers(p, dt);
      this.updateInteract(p, dt);
      this.updatePlayerPhysics(p, dt);
      this.updateFootsteps(p, dt);
    }

    updateInputMove(p, dt) {
      const k = this.keys;
      let ix = 0, iz = 0;
      if (k["KeyW"]) iz -= 1;
      if (k["KeyS"]) iz += 1;
      if (k["KeyA"]) ix -= 1;
      if (k["KeyD"]) ix += 1;
      this.quiet = !!k["ShiftLeft"];
      this.sprinting = !!k["AltLeft"] && iz < 0 && !this.quiet;
      p.quiet = this.quiet;
      p.sprinting = this.sprinting;
      if (k["ControlLeft"] || k["ControlRight"]) p.crouching = true;
      else p.crouching = false;
      if (k["Space"] && p.onGround) { p.vel.y = PHYS.jump; p.onGround = false; p.jumping = true; SFX.play("footstep_concrete", { vol: 0.1 }); }
      const len = Math.hypot(ix, iz);
      if (len > 0) { ix /= len; iz /= len; }
      const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
      // forward = (-sin, -cos); right = (-cos, sin)
      const wx = -sin * iz + -cos * ix;
      const wz = -cos * iz + sin * ix;
      let speed = p.crouching ? PHYS.crouchSpeed : (this.quiet ? PHYS.walkQuietSpeed : (this.sprinting ? PHYS.sprintSpeed : PHYS.walkSpeed));
      if (p.weapon.ads && p.getWeaponDef().zoomMove) speed *= p.getWeaponDef().zoomMove;
      const accel = p.onGround ? PHYS.accel : PHYS.airAccel;
      p.vel.x = U.damp(p.vel.x, wx * speed, accel, dt);
      p.vel.z = U.damp(p.vel.z, wz * speed, accel, dt);
      // firing
      const def = p.getWeaponDef();
      if (this.mouse.down) {
        if (def.slot === "grenade" || def.slot === "melee") this.tryFire(p);
        else if (def.auto || !this.autoFired) { this.tryFire(p); if (!def.auto) this.autoFired = true; }
      } else this.autoFired = false;
      p.weapon.ads = this.mouse.rdown && def.zoomFov > 0;
      if (this.mouse.rdown && def.zoomFov === 0 && def.slot !== "melee") p.weapon.ads = true;
      if (!this.mouse.rdown) p.weapon.ads = false;
    }

    updatePlayerPhysics(p, dt) {
      p.vel.y -= PHYS.gravity * dt;
      if (p.vel.y < -30) p.vel.y = -30;
      const half = p.halfExtents();
      const res = U.moveCollide(p.pos, half, p.vel, dt, this.map.colliders, PHYS.step);
      p.onGround = res.grounded;
      if (res.grounded && p.jumping) p.jumping = false;
      p.pos.y = Math.max(0, p.pos.y);
      p.speed = Math.hypot(p.vel.x, p.vel.z);
      // entity push
      for (const o of this.players) {
        if (o === p || !o.alive) continue;
        const dx = o.pos.x - p.pos.x, dz = o.pos.z - p.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 0.45 && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          const push = (0.68 - d) * 0.5;
          p.pos.x -= dx / d * push; p.pos.z -= dz / d * push;
          o.pos.x += dx / d * push; o.pos.z += dz / d * push;
        }
      }
    }

    updateBots(dt) {
      for (const b of this.bots) {
        if (!b.alive) { b.updateModel(dt); continue; }
        if (this.roundState === "freeze") { b.state = "idle"; b.vel.set(0, 0, 0); b.updateModel(dt); continue; }
        this.updateWeaponTimers(b, dt);
        b.think(dt);
        // physics
        b.vel.y -= PHYS.gravity * dt;
        if (b.vel.y < -30) b.vel.y = -30;
        const res = U.moveCollide(b.pos, b.halfExtents(), b.vel, dt, this.map.colliders, PHYS.step);
        b.onGround = res.grounded;
        if (res.grounded) b.jumping = false;
        b.pos.y = Math.max(0, b.pos.y);
        b.speed = Math.hypot(b.vel.x, b.vel.z);
        b.footstepT -= dt;
        if (b.speed > 1 && b.onGround && b.footstepT <= 0) {
          b.footstepT = b.quiet ? 0.55 : (b.sprinting ? 0.28 : 0.38);
          this.noiseEvents.push({ pos: b.pos.clone(), radius: b.quiet ? 4 : 12, team: b.team });
          if (U.dist(this.player.pos.x, this.player.pos.z, b.pos.x, b.pos.z) < 24) {
            SFX.pos(this.map.theme === "sand" ? "footstep_sand" : this.map.theme === "snow" ? "footstep_concrete" : "footstep_metal", b.pos, { vol: 0.35, dur: 0.15 });
          }
        }
      }
    }

    updateWeaponTimers(p, dt) {
      const w = p.weapon;
      if (w.switchT > 0) w.switchT -= dt;
      if (w.reloading) {
        w.reloadT -= dt;
        if (w.reloadT <= 0) {
          const def = p.getWeaponDef();
          const need = def.mag - w.ammo;
          const take = Math.min(need, w.reserve);
          w.ammo += take; w.reserve -= take;
          w.reloading = false;
          SFX.play("reload_in");
        }
      }
      if (w.lastShot > 0) w.lastShot -= dt;
      if (w.meleeT > 0) w.meleeT -= dt;
      // recoil recovery
      this.recoilPitch *= Math.exp(-8 * dt);
      this.recoilYaw *= Math.exp(-8 * dt);
      if (w.recoilIdx > 0 && !this.mouse.down) w.recoilIdx = Math.max(0, w.recoilIdx - dt * 14);
      // auto reload
      if (w.ammo === 0 && !w.reloading && w.switchT <= 0 && p.getWeaponDef().slot !== "grenade" && p.getWeaponDef().slot !== "melee") {
        this.startReload(p);
      }
    }

    startReload(p) {
      const def = p.getWeaponDef();
      if (def.slot === "melee" || def.slot === "grenade") return;
      if (p.weapon.reloading || p.weapon.ammo >= def.mag || p.weapon.reserve <= 0 || p.weapon.switchT > 0) return;
      p.weapon.reloading = true;
      p.weapon.reloadT = def.reload;
      SFX.play("reload_out");
      if (def.slot === "shotgun") setTimeout(() => SFX.play("reload_slide"), 700);
    }

    updateInteract(p, dt) {
      const k = this.keys;
      if (k["KeyE"]) {
        if (!p.action) {
          // plant
          if (p.team === "T" && p.bomb) {
            const site = this.findPlantSite(p);
            if (site) {
              const spot = this.nearestSpot(site, p.pos);
              p.action = { type: "plant", t: 0, total: 3.2, spot };
            }
          } else if (p.team === "CT" && this.bomb.planted && U.dist(p.pos.x, p.pos.z, this.bomb.pos.x, this.bomb.pos.z) < 2.2) {
            p.action = { type: "defuse", t: 0, total: p.defuseKit ? 5 : 10 };
          } else {
            const drop = this.nearDrop(p);
            if (drop) { this.pickupDrop(p, drop); }
          }
        }
        if (p.action) {
          const was = Math.floor(p.action.t * 4);
          p.action.t += dt;
          if (Math.floor(p.action.t * 4) !== was) {
            SFX.play(p.action.type === "plant" ? "plant_beep" : "defuse_beep");
            if (p.action.type === "defuse" && this.bomb) this.bomb.defuseT = p.action.t;
          }
          if (p.action.t >= p.action.total) {
            if (p.action.type === "plant") {
              this.plantBomb(p, p.action.spot);
            } else {
              this.defuseBomb(p);
            }
            p.action = null;
          }
        }
      }
      // cancel action if not holding E
      if (!k["KeyE"] && p.action) {
        p.action = null;
        if (this.bomb.planted && this.bomb.defusing === p) this.bomb.defusing = null;
      }
    }

    findPlantSite(p) {
      for (const id in this.map.sites) {
        const s = this.map.sites[id];
        if (U.dist(p.pos.x, p.pos.z, s.x, s.z) < s.radius) return s;
      }
      return null;
    }
    nearestSpot(site, pos) {
      let best = site.spots[0], bd = 1e9;
      for (const sp of site.spots) {
        const d = U.dist(pos.x, pos.z, sp.x, sp.z);
        if (d < bd) { bd = d; best = sp; }
      }
      return best;
    }

    updateFootsteps(p, dt) {
      const speed = p.speed;
      if (speed > 0.8 && p.onGround && !this.quiet) {
        const interval = this.quiet ? 0.55 : (this.sprinting ? 0.26 : 0.36);
        if (this.time - this.lastFoot > interval) {
          this.lastFoot = this.time;
          const kind = this.map.theme === "sand" ? "footstep_sand" : this.map.theme === "snow" ? "footstep_concrete" : "footstep_metal";
          SFX.play(kind, { vol: this.quiet ? 0.08 : this.sprinting ? 0.4 : 0.24 });
          if (!this.quiet) this.noiseEvents.push({ pos: p.pos.clone(), radius: this.sprinting ? 16 : 10, team: p.team });
        }
      }
    }

    tryFire(p) {
      const def = p.getWeaponDef();
      if (p.weapon.switchT > 0 || p.weapon.reloading) return;
      if (def.slot === "melee") { this.meleeAttack(p); return; }
      if (def.slot === "grenade") {
        if (p.inventory[p.currentSlot] > 0) {
          const dir = new THREE.Vector3(-Math.sin(p.yaw), -0.15, -Math.cos(p.yaw));
          this.throwGrenade(p, p.currentSlot, dir, 16);
          p.inventory[p.currentSlot]--;
          p.refreshSlots();
          p.equipSlot(p.lastSlot || "pistol", true);
        }
        return;
      }
      if (p.weapon.lastShot > 0 || p.weapon.ammo <= 0) return;
      this.fireFrom(p, null, false);
    }

    meleeAttack(p) {
      if (p.weapon.meleeT > 0) return;
      p.weapon.meleeT = 0.5;
      SFX.play("knife_swing");
      let best = null, bd = 2.2;
      const eye = p.getEyePos();
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
      for (const e of this.players) {
        if (!e.alive || e.team === p.team) continue;
        const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
        if (d > 2.0) continue;
        const dot = ((e.pos.x - p.pos.x) * fx + (e.pos.z - p.pos.z) * fz) / (d || 1);
        if (dot < 0.45) continue;
        if (d < bd) { bd = d; best = e; }
      }
      if (best) {
        this.lastWeaponPen = 0.1;
        this.applyDamage(best, 52, p, "chest", false);
        SFX.play("knife_hit");
      }
    }

    // ---------- shooting ----------
    fireFrom(entity, dir, isBot) {
      const def = entity.getWeaponDef();
      const w = entity.weapon;
      if (w.ammo <= 0 || w.reloading || w.switchT > 0 || w.lastShot > 0) return;
      w.ammo--;
      w.lastShot = 60 / (def.rpm || 300);
      w.recoilIdx++;
      this.lastWeaponPen = def.armorPen || 0.5;
      // sound
      const sound = def.id === "usp" || def.id === "mp5" ? "shot_sil" :
        def.slot === "pistol" ? "shot_pistol" :
        def.slot === "smg" ? "shot_smg" :
        def.slot === "shotgun" ? "shot_shotgun" :
        def.slot === "sniper" ? "shot_awp" : "shot_rifle";
      if (isBot) {
        SFX.pos(sound, entity.pos, { vol: def.id === "usp" ? 0.3 : 0.8, dur: 0.6 });
      } else {
        SFX.play(sound);
      }
      this.noiseEvents.push({ pos: entity.pos.clone(), radius: def.id === "usp" || def.id === "mp5" ? 12 : 34, team: entity.team });
      // muzzle + casing
      const eye = entity.getEyePos();
      const forward = dir || this.camera.getWorldDirection(new THREE.Vector3());
      if (!dir) {
        const spread = WS.getSpread(entity, def);
        forward.x += U.rand(-spread, spread);
        forward.y += U.rand(-spread, spread);
        forward.z += U.rand(-spread, spread);
        forward.normalize();
      }
      const muzzleWorld = isBot ? eye.clone().addScaledVector(forward, 0.4) : this.weaponModels.getMuzzleWorld(new THREE.Vector3());
      if (muzzleWorld) {
        this.effects.muzzle(muzzleWorld, forward, def.id === "awp" ? 0xffcc88 : 0xffcc66, def.slot === "sniper" ? 0.7 : 0.45);
        this.lastMuzzle.copy(muzzleWorld);
      }
      if (!isBot) {
        this.effects.casing(eye.clone().add(new THREE.Vector3(-0.15, -0.1, 0)), new THREE.Vector3(-1.5, 2.4, 0.5));
      }
      // recoil
      const pat = WS.getPattern(def);
      const idx = Math.min(w.recoilIdx - 1, pat.length - 1);
      const pv = pat[idx] || [2, 0];
      if (!isBot) {
        this.recoilPitch += pv[0] * 0.0018;
        this.recoilYaw += pv[1] * 0.0009;
      } else {
        entity.pitch += pv[0] * 0.0006;
        entity.yaw += pv[1] * 0.0003;
      }
      // rays
      const pellets = def.pellets || 1;
      for (let i = 0; i < pellets; i++) {
        let rd = forward.clone();
        if (pellets > 1) {
          rd.x += U.rand(-def.spread, def.spread) * 1.5;
          rd.y += U.rand(-def.spread, def.spread) * 1.5;
          rd.z += U.rand(-def.spread, def.spread) * 1.5;
          rd.normalize();
        }
        this.fireRay(entity, eye, rd, def, isBot, pellets > 1);
      }
      // auto reload
      if (w.ammo === 0 && def.slot !== "grenade") this.startReload(entity);
      this.ui && this.ui.updateHUD();
    }

    fireRay(entity, origin, dir, def, isBot, pellet) {
      this.raycaster.set(origin, dir);
      const maxDist = 120;
      const targets = [];
      // entities first
      for (const e of this.players) {
        if (!e.alive || e === entity) continue;
        if (e.team === entity.team) continue;
        const hitboxes = [e.headBox, e.chestBox, e.stomachBox, e.legsBox];
        this.raycaster.far = maxDist;
        const hits = this.raycaster.intersectObjects(hitboxes, false);
        if (hits.length) targets.push({ hit: hits[0], entity: e });
      }
      this.raycaster.far = maxDist;
      const worldHits = this.solidGroup ? this.raycaster.intersectObjects([this.solidGroup], true) : [];
      let nearest = null;
      for (const t of targets) {
        if (!nearest || t.hit.distance < nearest.distance) nearest = { distance: t.hit.distance, entity: t.entity, part: t.hit.object.userData.part, point: t.hit.point, normal: t.hit.face ? t.hit.face.normal : null };
      }
      if (worldHits.length && worldHits[0].distance < (nearest ? nearest.distance : 1e9)) {
        nearest = { distance: worldHits[0].distance, entity: null, part: null, point: worldHits[0].point, normal: worldHits[0].face ? worldHits[0].face.normal : null, mesh: worldHits[0].object };
      }
      const end = nearest ? nearest.point : origin.clone().addScaledVector(dir, maxDist);
      const isPlayerShot = !isBot;
      if (isPlayerShot && (def.tracer || def.pellets)) {
        const from = this.lastMuzzle || origin;
        this.effects.tracer(from, end, entity.team === "T" ? 0xffaa44 : 0x66ccff);
      }
      if (nearest && nearest.entity) {
        const head = nearest.part === "head";
        const mult = head ? 4 : nearest.part === "legs" ? 0.75 : 1;
        let dmg = def.dmg * mult;
        if (def.falloff) {
          const d = nearest.distance;
          if (d > def.falloff) dmg *= Math.max(0.25, 1 - (d - def.falloff) / 50);
        }
        if (def.pellets) dmg *= 1;
        this.lastWeaponPen = def.armorPen || 0.5;
        this.applyDamage(nearest.entity, dmg, entity, nearest.part, head);
        this.effects.spark(nearest.point, dir.clone().negate(), 0xbb2222, 4, 0.05, 8);
        if (isPlayerShot) {
          this.ui.showHitmarker(head);
          SFX.play(head ? "hitmarker_head" : "hitmarker");
        }
        this.ui.addDamageNumber && this.ui.addDamageNumber(nearest.point, Math.round(dmg), head);
      } else if (nearest && nearest.mesh) {
        const matKind = nearest.mesh.material && nearest.mesh.material.map ? "decal" : "none";
        this.effects.decal(nearest.point, nearest.normal ? nearest.normal : new THREE.Vector3(0, 1, 0), 0x333333);
        this.effects.spark(nearest.point, nearest.normal ? nearest.normal.clone().multiplyScalar(3) : dir.clone().negate(), 0xffcc66, 3, 0.045, 8);
        if (isBot && !pellet) SFX.pos("bounce", nearest.point, { vol: 0.15, dur: 0.1 });
      } else {
        if (isPlayerShot) this.effects.tracer(this.lastMuzzle || origin, end, 0xffaa44);
      }
    }

    applyDamage(target, dmg, attacker, part, headshot) {
      if (!target.alive) return;
      const killed = target.applyDamage(dmg, attacker, part, headshot);
      if (!killed) {
        if (attacker && attacker.isHuman) { attacker.stats.damage += Math.round(dmg); }
        if (target.isHuman) this.ui.showDamage();
      }
    }

    onPlayerDied(victim, attacker, headshot) {
      victim.vel.set(0, 0, 0);
      victim.stats.deaths++;
      victim.deadT = 0;
      if (attacker && attacker !== victim) {
        attacker.stats.kills++;
        if (headshot) attacker.stats.hs++;
        const reward = victim.killReward(attacker.getWeaponDef());
        attacker.giveMoney(reward);
        if (attacker.isHuman) { SFX.play("kill"); this.ui.addKill(victim.name, attacker.name, attacker.getWeaponDef().name, headshot, attacker.team); }
        else if (victim.isHuman) { SFX.play("death"); this.ui.addKill(victim.name, attacker.name, attacker.getWeaponDef().name, headshot, attacker.team); }
        else this.ui.addKill(victim.name, attacker.name, attacker.getWeaponDef().name, headshot, attacker.team);
      } else {
        this.ui.addKill(victim.name, "世界", "坠落", false, victim.team);
      }
      // drop bomb
      if (victim.bomb) {
        victim.bomb = false;
        this.bomb.carrier = null;
        this.bomb.pos.copy(victim.pos);
        this.bomb.dropped = true;
        this.bomb.planted = false;
      }
      // drop primary
      if (victim.inventory.primary) {
        this.drops.push({ id: victim.inventory.primary, pos: victim.pos.clone(), team: null });
        victim.inventory.primary = null;
        victim.refreshSlots();
      }
      if (victim === this.bomb.defusing) this.bomb.defusing = null;
      if (victim.isHuman) {
        this.ui.showSpectate();
        this.spectateIdx = 0;
        this.pickSpectateTarget();
      }
      if (this.state === "playing") this.checkRoundEnd();
    }

    // ---------- grenades ----------
    throwGrenadeAt(entity, type, target) {
      const from = entity.getEyePos();
      const dx = target.x - from.x, dz = target.z - from.z;
      const dist = Math.hypot(dx, dz);
      const t = U.clamp(dist / 13, 0.9, 2.1);
      const vx = dx / t, vz = dz / t;
      const vy = 2.0 + (target.y || 0) / t + 4.9 * t;
      this.throwGrenade(entity, type, new THREE.Vector3(vx, vy, vz).normalize(), Math.hypot(vx, vy, vz));
    }

    throwGrenade(entity, type, dir, power) {
      const eye = entity.getEyePos();
      const p = eye.clone().addScaledVector(dir, 0.35);
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 8, 8),
        new THREE.MeshLambertMaterial({ color: type === "flash" ? 0xd8dde2 : type === "smoke" ? 0x4f565e : type === "molotov" ? 0x8a3a2a : 0x3f5f3f })
      );
      mesh.position.copy(p);
      this.scene.add(mesh);
      const vel = dir.clone().multiplyScalar(power || 15);
      vel.y += 2;
      const fuse = type === "he" ? 1.5 : type === "flash" ? 1.2 : type === "smoke" ? 1.0 : 0;
      const g = {
        type, pos: p, vel, mesh, fuse, t: 0, bounced: false, exploded: false,
        rot: new THREE.Vector3(U.rand(-6, 6), U.rand(-6, 6), U.rand(-6, 6)),
        team: entity.team
      };
      this.grenades.push(g);
      SFX.pos("bounce_soft", p, { vol: 0.2, dur: 0.2 });
      this.noiseEvents.push({ pos: p, radius: 12, team: entity.team });
    }

    updateGrenades(dt) {
      for (let i = this.grenades.length - 1; i >= 0; i--) {
        const g = this.grenades[i];
        g.t += dt;
        g.vel.y -= 14 * dt;
        g.pos.addScaledVector(g.vel, dt);
        g.mesh.position.copy(g.pos);
        g.mesh.rotation.x += g.rot.x * dt; g.mesh.rotation.y += g.rot.y * dt;
        // collide
        const min = { x: g.pos.x - 0.1, y: g.pos.y - 0.1, z: g.pos.z - 0.1 };
        const max = { x: g.pos.x + 0.1, y: g.pos.y + 0.1, z: g.pos.z + 0.1 };
        for (const c of this.map.colliders) {
          if (c.active === false) continue;
          if (min.x < c.max.x && max.x > c.min.x && min.y < c.max.y && max.y > c.min.y && min.z < c.max.z && max.z > c.min.z) {
            // push out along smallest penetration axis
            const px = Math.min(g.pos.x - c.min.x, c.max.x - g.pos.x);
            const py = Math.min(g.pos.y - c.min.y, c.max.y - g.pos.y);
            const pz = Math.min(g.pos.z - c.min.z, c.max.z - g.pos.z);
            if (px < py && px < pz) { g.pos.x += g.vel.x > 0 ? -(px + 0.01) : (px + 0.01); g.vel.x *= -0.35; }
            else if (py < pz) { g.pos.y += g.vel.y > 0 ? -(py + 0.01) : (py + 0.01); g.vel.y *= -0.35; if (g.vel.y < 0.5 && g.vel.y > -0.5) g.vel.y = 0; }
            else { g.pos.z += g.vel.z > 0 ? -(pz + 0.01) : (pz + 0.01); g.vel.z *= -0.35; }
            g.bounced = true;
            SFX.pos("bounce", g.pos, { vol: 0.2, dur: 0.15 });
            break;
          }
        }
        if (g.pos.y < 0.07) { g.pos.y = 0.07; g.vel.y *= -0.3; g.bounced = true; if (Math.abs(g.vel.y) < 1) g.vel.y = 0; }
        // molotov breaks on impact
        if (g.type === "molotov" && (g.bounced || g.t > 1.2)) {
          this.detonate(g);
          this.removeGrenade(i);
          continue;
        }
        if (g.type !== "molotov" && g.t >= g.fuse) {
          this.detonate(g);
          this.removeGrenade(i);
        }
      }
    }
    removeGrenade(i) {
      const g = this.grenades[i];
      this.scene.remove(g.mesh);
      g.mesh.geometry.dispose();
      g.mesh.material.dispose();
      this.grenades.splice(i, 1);
    }
    detonate(g) {
      g.exploded = true;
      if (g.type === "he") {
        SFX.pos("explosion", g.pos, { vol: 1, dur: 1.4 });
        this.effects.explosion(g.pos, 6);
        for (const p of this.players) {
          if (!p.alive) continue;
          const eye = p.getEyePos();
          const d = Math.hypot(p.pos.x - g.pos.x, p.pos.z - g.pos.z);
          if (d > 11) continue;
          if (this.raycastWorld(g.pos, eye)) continue;
          const dmg = 96 * Math.pow(1 - d / 11, 1.2);
          if (dmg > 2) {
            this.lastWeaponPen = 0.7;
            this.applyDamage(p, dmg, null, "chest", false);
            if (p.isHuman) { this.cameraShake = Math.max(this.cameraShake, (1 - d / 11) * 2); this.ui.showDamage(); }
          }
        }
      } else if (g.type === "flash") {
        SFX.pos("flash", g.pos, { vol: 1, dur: 1 });
        this.effects.spark(g.pos, new THREE.Vector3(0, 1, 0), 0xffffff, 8, 0.08, 2);
        for (const p of this.players) {
          if (!p.alive) continue;
          const eye = p.getEyePos();
          const dx = p.pos.x - g.pos.x, dz = p.pos.z - g.pos.z;
          const d = Math.hypot(dx, dz);
          if (d > 14) continue;
          let facing = 0;
          if (d > 0.01) {
            const pEye = p.getEyePos();
            const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
            facing = (dx / d * fx + dz / d * fz);
          }
          let blind = 0;
          if (this.raycastWorld(g.pos, eye)) blind = d < 3 ? 0.8 : 0;
          else if (facing > 0.6) blind = U.clamp(4.2 * (1 - d / 14) * (0.4 + facing * 0.6), 0.4, 4.2);
          else if (facing > -0.2) blind = U.clamp(1.8 * (1 - d / 14), 0.2, 1.8);
          if (blind > 0.05) {
            if (p.isHuman) { this.flashT = Math.max(this.flashT, blind); SFX.play("flash"); this.ui.flash(blind); }
            else { p.flashT = blind; }
          }
        }
      } else if (g.type === "smoke") {
        SFX.pos("smoke", g.pos, { vol: 0.7, dur: 1.5 });
        this.effects.smoke(g.pos, 2.9, 16);
      } else if (g.type === "molotov") {
        SFX.pos("molotov_break", g.pos, { vol: 0.8, dur: 0.6 });
        this.effects.fire(g.pos, 2.6, 7);
      }
    }
    updateFireDamage(dt) {
      for (const f of this.effects.fires) {
        for (const p of this.players) {
          if (!p.alive) continue;
          const d = Math.hypot(p.pos.x - f.pos.x, p.pos.z - f.pos.z);
          if (d < f.radius + 0.3) {
            this.lastWeaponPen = 0.5;
            this.applyDamage(p, 11 * dt, null, "chest", false);
            if (p.isHuman) this.ui.showDamage();
          }
        }
      }
    }

    // ---------- bomb ----------
    plantBomb(entity, spot) {
      this.bomb.planted = true;
      this.bomb.carrier = null;
      entity.bomb = false;
      this.bomb.pos.set(spot.x, 0.05, spot.z);
      this.bomb.site = this.siteAt(spot.x, spot.z);
      this.bomb.timer = 40;
      this.bomb.dropped = false;
      this.roundState = "bomb";
      SFX.play("plant_success");
      SFX.pos("bomb_planted", this.bomb.pos, { vol: 1, dur: 1 });
      this.ui.banner("炸弹已安放", this.bomb.site ? this.bomb.site.label + " · 40 秒后爆炸" : "", 2.2);
      this.ui.addKill("炸弹", entity.name, "已安放", false, "T");
      // create bomb mesh
      if (!this.bombMesh) {
        this.bombMesh = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 0.28), new THREE.MeshLambertMaterial({ color: 0x3a3f45 }));
        const light = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), new THREE.MeshBasicMaterial({ color: 0xff3333 }));
        light.position.y = 0.1;
        this.bombMesh.add(body, light);
        this.scene.add(this.bombMesh);
      }
      this.bombMesh.visible = true;
      this.bombMesh.position.copy(this.bomb.pos);
    }
    siteAt(x, z) {
      for (const id in this.map.sites) {
        const s = this.map.sites[id];
        if (U.dist(x, z, s.x, s.z) < s.radius) return s;
      }
      return null;
    }
    defuseBomb(entity) {
      if (!this.bomb.planted) return;
      this.bomb.planted = false;
      this.bomb.timer = 0;
      this.bomb.defusing = null;
      if (this.bombMesh) this.bombMesh.visible = false;
      SFX.play("defuse_success");
      this.ui.addKill(entity.name, "炸弹", "已拆除", false, "CT");
      this.endRound("CT", "defuse");
    }
    updateBomb(dt) {
      if (!this.bomb.planted) return;
      this.bomb.timer -= dt;
      if (this.bombMesh) {
        this.bombMesh.rotation.y += dt * 1.5;
        const blink = Math.sin(performance.now() / 200) > 0;
        this.bombMesh.children[1].material.color.setHex(blink ? 0xff3333 : 0x441111);
      }
      const beepInt = this.bomb.timer > 10 ? 1 : 0.5;
      if (this.bomb.beepT == null) this.bomb.beepT = 0;
      this.bomb.beepT -= dt;
      if (this.bomb.beepT <= 0) {
        this.bomb.beepT = beepInt;
        SFX.pos("bomb_beep", this.bomb.pos, { vol: 0.8, dur: 0.3 });
        if (U.dist(this.player.pos.x, this.player.pos.z, this.bomb.pos.x, this.bomb.pos.z) < 18) SFX.play("bomb_beep", { vol: 0.3 });
      }
      if (this.bomb.timer <= 0) {
        this.endRound("T", "explode");
      }
    }

    updatePickups(dt) {
      // dropped bomb pickup by T
      if (this.bomb.dropped && !this.bomb.planted) {
        for (const p of this.players) {
          if (p.team !== "T" || !p.alive || p.bomb) continue;
          if (U.dist(p.pos.x, p.pos.z, this.bomb.pos.x, this.bomb.pos.z) < 1.1) {
            p.bomb = true;
            this.bomb.carrier = p;
            this.bomb.dropped = false;
            SFX.play("pickup");
            this.ui.addKill(p.name, "炸弹", "已拾取", false, "T");
          }
        }
      }
      // weapon drops
      for (let i = this.drops.length - 1; i >= 0; i--) {
        const d = this.drops[i];
        for (const p of this.players) {
          if (!p.alive) continue;
          if (U.dist(p.pos.x, p.pos.z, d.pos.x, d.pos.z) < 1.0) {
            if (p.isHuman || (p.isBot && (!p.inventory.primary || W[p.inventory.primary].price < W[d.id].price))) {
              if (p.inventory.primary) {
                this.drops.push({ id: p.inventory.primary, pos: p.pos.clone() });
              }
              p.inventory.primary = d.id;
              p.refreshSlots();
              p.weapon.ammo = W[d.id].mag;
              p.weapon.reserve = W[d.id].reserve;
              if (p.isHuman) p.equipSlot("primary");
              SFX.play("pickup");
              this.drops.splice(i, 1);
              break;
            }
          }
        }
      }
    }

    updateDoors(dt) {
      if (!this.map.doors) return;
      for (const d of this.map.doors) {
        let near = false;
        for (const p of this.players) {
          if (!p.alive) continue;
          const cx = (d.collL.min.x + d.collR.max.x) / 2;
          const cz = d.collL.min.z;
          if (U.dist(p.pos.x, p.pos.z, cx, cz) < 3.0) { near = true; break; }
        }
        if (this.bomb && this.bomb.planted && U.dist(this.bomb.pos.x, this.bomb.pos.z, (d.collL.min.x + d.collR.max.x) / 2, d.collL.min.z) < 3) near = true;
        d.targetAngle = near ? 1.85 : 0;
        d.angle = U.damp(d.angle, d.targetAngle, 4, dt);
        if (d.axis === "x") {
          d.pivotL.rotation.y = d.angle;
          d.pivotR.rotation.y = -d.angle;
        } else {
          d.pivotL.rotation.y = -d.angle;
          d.pivotR.rotation.y = d.angle;
        }
        const open = d.angle > 1.1;
        d.collL.active = !open;
        d.collR.active = !open;
      }
    }

    // ---------- round end ----------
    checkRoundEnd() {
      if (this.roundState !== "live") return;
      const tAlive = this.players.some(p => p.alive && p.team === "T");
      const ctAlive = this.players.some(p => p.alive && p.team === "CT");
      if (!tAlive) this.endRound("CT", "elimination");
      else if (!ctAlive && !this.bomb.planted) this.endRound("T", "elimination");
    }
    endRound(winner, reason) {
      if (this.roundState === "over") return;
      this.roundState = "over";
      this.roundEndT = 5;
      this.nextRoundReady = true;
      this.score[winner]++;
      // money
      for (const p of this.players) {
        if (p.team === winner) {
          p.giveMoney(3250);
          this.lossBonus[p.team] = 0;
        } else {
          const bonus = [1400, 1900, 2400, 2900, 3400][Math.min(this.lossBonus[p.team], 4)];
          p.giveMoney(bonus);
          this.lossBonus[p.team]++;
          if (this.bomb.planted && p.team === "T") p.giveMoney(800);
        }
      }
      if (this.bomb.planted) this.bomb.planted = false;
      if (this.bombMesh) this.bombMesh.visible = false;
      this.roundTime = Math.max(0, this.roundTime);
      const reasonText = reason === "explode" ? "炸弹爆炸" : reason === "defuse" ? "炸弹被拆除" : reason === "timeout" ? "时间耗尽" : "全歼敌人";
      this.ui.banner(winner === "T" ? "恐怖分子胜利" : "反恐精英胜利", reasonText + " · " + this.score.T + " : " + this.score.CT, 3.2);
      SFX.play(winner === "T" ? "round_t_w" : "round_ct_w");
      if (winner !== (this.player ? this.player.team : "CT")) SFX.play("round_lose");
      this.ui.updateHUD();
      // match over check
      const ws = this.settings.winScore;
      if (!this.overtime && (this.score.T >= ws || this.score.CT >= ws)) {
        if (this.score.T !== this.score.CT) {
          this.matchOver = true;
          this.ui.setMatchEnd(winner);
        } else {
          this.overtime = true;
          this.ui.banner("加时赛", "率先领先 2 局者获胜", 3);
        }
      } else if (this.overtime) {
        if (Math.abs(this.score.T - this.score.CT) >= 2 && (this.score.T >= ws || this.score.CT >= ws)) {
          this.matchOver = true;
          this.ui.setMatchEnd(winner);
        }
      }
    }

    raycastWorld(from, to) {
      const dir = to.clone().sub(from);
      const dist = dir.length();
      if (dist < 0.001) return false;
      // safety: if either endpoint is embedded in geometry, treat as blocked
      for (const c of this.map.colliders) {
        if (c.active === false) continue;
        if (U.pointInAABB({ x: from.x, y: from.y, z: from.z }, c) || U.pointInAABB({ x: to.x, y: to.y, z: to.z }, c)) return true;
      }
      dir.normalize();
      this.raycaster.set(from, dir);
      this.raycaster.far = dist;
      const hits = this.solidGroup ? this.raycaster.intersectObjects([this.solidGroup], true) : [];
      return hits.length > 0 && hits[0].distance < dist;
    }

    updateCamera(dt) {
      const p = this.player;
      const cam = this.camera;
      if (p && p.alive && this.state === "playing") {
        this.weaponModels.root.visible = true;
        const wid = p.getWeaponId();
        if (this.weaponModels.current !== wid) this.weaponModels.show(wid);
        const eye = p.getEyePos();
        cam.position.copy(eye);
        // view bob
        const speed = p.speed;
        if (speed > 0.5 && p.onGround) {
          this.viewBobT += dt * (this.sprinting ? 11 : 7.5);
          this.viewBob = Math.sin(this.viewBobT) * 0.035 * Math.min(1, speed / 5);
        } else {
          this.viewBob = U.damp(this.viewBob, 0, 8, dt);
        }
        cam.rotation.y = p.yaw + this.recoilYaw;
        cam.rotation.x = p.pitch + this.recoilPitch + this.viewBob;
        // shake
        if (this.cameraShake > 0) {
          cam.rotation.x += U.rand(-1, 1) * 0.012 * this.cameraShake;
          cam.rotation.y += U.rand(-1, 1) * 0.012 * this.cameraShake;
          this.cameraShake = Math.max(0, this.cameraShake - dt * 3);
        }
        const def = p.getWeaponDef();
        const targetFov = p.weapon.ads && def.zoomFov ? def.zoomFov : 75;
        cam.fov = U.damp(cam.fov, targetFov, 12, dt);
        cam.updateProjectionMatrix();
        this.ui.scopeActive(p.weapon.ads && def.zoomFov > 0);
        // viewmodel pose
        const bobX = Math.sin(this.viewBobT * 0.5) * 0.012;
        const bobY = this.viewBob * 0.6;
        let vy = -0.28 + bobY, vz = -0.36, rx = 0;
        if (p.weapon.ads && def.zoomFov) { vy = -0.24; vz = -0.18; rx = 0.02; }
        if (p.weapon.reloading) {
          const rp = p.weapon.reloadT / def.reload;
          vy -= Math.sin((1 - rp) * Math.PI) * 0.16;
          rx = Math.sin((1 - rp) * Math.PI * 2) * 0.3;
        }
        if (p.weapon.switchT > 0) {
          const sp = p.weapon.switchT / (def.switchTime || 0.5);
          vy -= sp * 0.22;
          rx -= sp * 0.8;
        }
        if (p.weapon.meleeT > 0) {
          const mp = p.weapon.meleeT / 0.5;
          rx += Math.sin((1 - mp) * Math.PI) * 1.2;
          vz += Math.sin((1 - mp) * Math.PI) * 0.2;
        }
        if (p.weapon.lastShot > 0.028) {
          vz += 0.06; rx += 0.04;
        }
        this.weaponModels.applyPose(this.weaponModels.current, dt, { x: bobX, y: vy, z: vz, rx, ry: 0, rz: 0 });
      } else {
        this.weaponModels.root.visible = false;
        // spectate
        const t = this.spectateTarget;
        if (t && t.alive) {
          const eye = t.getEyePos();
          cam.position.lerp(eye, Math.min(1, dt * 10));
          cam.rotation.y = t.yaw;
          cam.rotation.x = t.pitch;
          cam.fov = U.damp(cam.fov, 75, 10, dt);
          cam.updateProjectionMatrix();
          this.ui.scopeActive(false);
        }
      }
    }

    cycleSpectate() {
      this.spectateIdx++;
      this.pickSpectateTarget();
    }
    pickSpectateTarget() {
      const alive = this.players.filter(p => p.alive && p.team === this.player.team);
      if (!alive.length) { this.spectateTarget = null; return; }
      const t = alive[this.spectateIdx % alive.length];
      this.spectateTarget = t;
      this.spectateYaw = t.yaw;
      this.spectatePitch = t.pitch;
      this.ui.spectateName(t.name);
    }

    updateEffects(dt) {
      this.effects.update(dt);
      this.updateFireDamage(dt);
      // flash decay
      this.flashT = Math.max(0, this.flashT - dt);
      this.ui.setFlash(Math.min(1, this.flashT));
    }

    dropCurrent() {
      const p = this.player;
      if (!p || !p.alive) return;
      const id = p.getWeaponId();
      if (p.currentSlot === "primary" && p.inventory.primary) {
        this.drops.push({ id: p.inventory.primary, pos: p.pos.clone() });
        p.inventory.primary = null;
        p.refreshSlots();
        p.equipSlot("pistol", true);
        SFX.play("pickup");
      } else if (p.currentSlot === "pistol") {
        // don't drop pistol
      } else if (p.inventory[p.currentSlot] > 0) {
        p.inventory[p.currentSlot]--;
        p.refreshSlots();
        p.equipSlot(p.lastSlot || "pistol", true);
      }
    }
    nearDrop(p) {
      for (const d of this.drops) {
        if (U.dist(p.pos.x, p.pos.z, d.pos.x, d.pos.z) < 1.1) return d;
      }
      return null;
    }
    pickupDrop(p, d) {
      if (p.inventory.primary) this.drops.push({ id: p.inventory.primary, pos: p.pos.clone() });
      p.inventory.primary = d.id;
      p.refreshSlots();
      p.weapon.ammo = W[d.id].mag; p.weapon.reserve = W[d.id].reserve;
      p.equipSlot("primary");
      this.drops.splice(this.drops.indexOf(d), 1);
      SFX.play("pickup");
    }

    render() {
      this.renderer.render(this.scene, this.camera);
    }
  }

  window.TFPS.Game = Game;
})();
