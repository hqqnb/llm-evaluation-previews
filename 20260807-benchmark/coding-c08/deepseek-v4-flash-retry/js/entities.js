(function () {
  const THREE = window.THREE;
  const U = window.TFPS.U;
  const W = window.TFPS.W;
  const PHYS = window.TFPS.PHYS;

  function boxMesh(w, h, d, color, x, y, z, parent, opts) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
    m.position.set(x, y, z);
    if (opts && opts.rot) m.rotation.set(opts.rot.x, opts.rot.y, opts.rot.z);
    m.castShadow = true;
    if (parent) parent.add(m);
    return m;
  }

  function buildSoldier(team) {
    const g = new THREE.Group();
    const ct = team === "CT";
    const top = ct ? 0x3d5a73 : 0x6b5a3a;
    const bottom = ct ? 0x2e4154 : 0x4d422c;
    const skin = 0xc99b6f;
    const legL = boxMesh(0.14, 0.62, 0.16, bottom, -0.11, 0.31, 0, g);
    const legR = boxMesh(0.14, 0.62, 0.16, bottom, 0.11, 0.31, 0, g);
    boxMesh(0.13, 0.1, 0.24, 0x17181a, -0.11, 0.05, 0.04, g);
    boxMesh(0.13, 0.1, 0.24, 0x17181a, 0.11, 0.05, 0.04, g);
    boxMesh(0.46, 0.5, 0.26, top, 0, 1.05, 0, g);
    boxMesh(0.48, 0.3, 0.3, ct ? 0x2b465c : 0x57492e, 0, 1.05, 0.02, g);
    boxMesh(0.46, 0.07, 0.28, 0x1b1d20, 0, 0.8, 0, g);
    boxMesh(0.3, 0.36, 0.12, ct ? 0x24384a : 0x4a3d28, 0, 1.05, -0.18, g);
    boxMesh(0.11, 0.5, 0.12, top, -0.31, 1.05, 0, g, { rot: { x: 0, y: 0, z: 0.2 } });
    boxMesh(0.11, 0.5, 0.12, top, 0.31, 1.05, 0, g, { rot: { x: 0, y: 0, z: -0.2 } });
    boxMesh(0.1, 0.09, 0.12, skin, -0.34, 0.78, 0.02, g);
    boxMesh(0.1, 0.09, 0.12, skin, 0.34, 0.78, 0.02, g);
    const head = boxMesh(0.22, 0.24, 0.22, skin, 0, 1.56, 0, g);
    boxMesh(0.25, 0.1, 0.24, ct ? 0x253c4f : 0x4b412b, 0, 1.66, 0, g);
    boxMesh(0.24, 0.06, 0.22, 0x111316, 0, 1.72, 0, g);
    boxMesh(0.24, 0.04, 0.1, 0x111316, 0, 1.52, -0.12, g);
    const gunAnchor = new THREE.Group();
    gunAnchor.position.set(0.2, 1.16, 0.05);
    g.add(gunAnchor);
    const gun = new THREE.Group();
    gunAnchor.add(gun);
    g.userData = { legL, legR, head, gunAnchor, gun };
    return g;
  }

  function buildGunForModel(weaponId) {
    const g = new THREE.Group();
    const dark = 0x23262b;
    const isRifle = weaponId === "ak47" || weaponId === "m4a4";
    const isSniper = weaponId === "awp";
    const isSmg = weaponId === "mp5" || weaponId === "mp7";
    const isShot = weaponId === "nova";
    if (isRifle || isSniper || isShot || isSmg) {
      boxMesh(0.045, 0.07, 0.42, 0x2f343b, 0, 0.02, -0.12, g);
      boxMesh(0.025, 0.025, 0.28, dark, 0, 0.055, -0.38, g);
      boxMesh(0.03, 0.07, 0.09, dark, 0, -0.035, -0.08, g);
      if (isSniper) boxMesh(0.03, 0.04, 0.16, 0x111317, 0, 0.07, -0.2, g);
    } else if (weaponId === "knife") {
      boxMesh(0.02, 0.02, 0.18, 0x9aa3ad, 0, 0, -0.12, g);
    } else {
      boxMesh(0.03, 0.055, 0.13, 0x3a3024, 0, 0.02, -0.08, g);
    }
    g.scale.set(0.9, 0.9, 0.9);
    g.rotation.y = Math.PI / 2;
    return g;
  }

  class PlayerEntity {
    constructor(game, opts) {
      this.game = game;
      this.id = opts.id;
      this.name = opts.name || "Player";
      this.team = opts.team || "T";
      this.isBot = !!opts.isBot;
      this.diff = opts.diff || "normal";
      this.pos = new THREE.Vector3(opts.x || 0, 0, opts.z || 0);
      this.vel = new THREE.Vector3();
      this.yaw = opts.yaw || 0;
      this.pitch = 0;
      this.health = 100;
      this.armor = 0;
      this.helmet = false;
      this.defuseKit = false;
      this.money = 800;
      this.alive = true;
      this.deadT = 0;
      this.crouching = false;
      this.quiet = false;
      this.sprinting = false;
      this.onGround = true;
      this.jumping = false;
      this.speed = 0;
      this.inventory = { melee: "knife", pistol: "glock", primary: null, he: 0, flash: 0, smoke: 0, molotov: 0 };
      this.slots = [];
      this.currentSlot = "melee";
      this.lastSlot = "pistol";
      this.weapon = { ammo: 0, reserve: 0, reloading: false, reloadT: 0, switchT: 0, recoilIdx: 0, lastShot: 0, ads: false, meleeT: 0, burst: 0, burstT: 0 };
      this.action = null;
      this.bomb = false;
      this.stats = { kills: 0, deaths: 0, assists: 0, hs: 0, damage: 0, mvp: 0 };
      this.lastDamageBy = null;
      this.lastDamageAt = -9;
      this.spotted = false;
      this.lastShotPos = null;
      this.footstepT = 0;
      this.model = buildSoldier(this.team);
      this.model.visible = false;
      game.entityGroup.add(this.model);
      this.buildHitboxes();
      this.setDefaultWeapons();
    }
    buildHitboxes() {
      const g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
      const add = (part, w, h, d, y) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        m.position.y = y;
        m.userData.part = part;
        m.userData.entity = this;
        m.name = "hitbox_" + part;
        g.add(m);
        this[part + "Box"] = m;
      };
      add("head", 0.22, 0.22, 0.22, 1.56);
      add("chest", 0.44, 0.42, 0.26, 1.18);
      add("stomach", 0.4, 0.3, 0.24, 0.95);
      add("legs", 0.32, 0.8, 0.22, 0.45);
      this.model.add(g);
      this.hitGroup = g;
    }
    setDefaultWeapons() {
      this.inventory.pistol = this.team === "T" ? "glock" : "usp";
      this.inventory.melee = "knife";
      this.inventory.primary = null;
      this.inventory.he = 0; this.inventory.flash = 0; this.inventory.smoke = 0; this.inventory.molotov = 0;
      this.defuseKit = false;
      this.refreshSlots();
      this.currentSlot = "pistol";
      this.lastSlot = "pistol";
      this.equipSlot("pistol", true);
    }
    refreshSlots() {
      const s = ["melee", "pistol"];
      if (this.inventory.primary) s.push("primary");
      if (this.inventory.he > 0) s.push("he");
      if (this.inventory.flash > 0) s.push("flash");
      if (this.inventory.smoke > 0) s.push("smoke");
      if (this.inventory.molotov > 0) s.push("molotov");
      this.slots = s;
    }
    getWeaponId() {
      if (this.currentSlot === "primary") return this.inventory.primary;
      if (this.currentSlot === "pistol") return this.inventory.pistol;
      if (this.currentSlot === "melee") return "knife";
      return this.currentSlot;
    }
    getWeaponDef() { return W[this.getWeaponId()] || W.knife; }
    equipSlot(slot, instant) {
      if (!this.slots.includes(slot) && slot !== "primary") return false;
      if (slot === "primary" && !this.inventory.primary) return false;
      if (this.currentSlot === slot) return true;
      this.lastSlot = this.currentSlot;
      this.currentSlot = slot;
      const def = this.getWeaponDef();
      this.weapon.ads = false;
      this.weapon.switchT = instant ? 0 : (def.switchTime || 0.4);
      this.weapon.reloading = false;
      this.weapon.reloadT = 0;
      this.weapon.meleeT = 0;
      this.weapon.recoilIdx = 0;
      return true;
    }
    buyWeapon(id) {
      const def = W[id];
      if (!def) return false;
      if (def.slot === "pistol") {
        if (this.inventory.pistol === id) return false;
        if (this.money < def.price) return false;
        this.money -= def.price;
        this.inventory.pistol = id;
        this.weapon.ammo = def.mag; this.weapon.reserve = def.reserve;
        return true;
      }
      if (def.slot === "primary" || ["rifle", "smg", "sniper", "shotgun"].includes(def.slot)) {
        if (this.money < def.price) return false;
        this.money -= def.price;
        this.inventory.primary = id;
        this.weapon.ammo = def.mag; this.weapon.reserve = def.reserve;
        this.refreshSlots();
        return true;
      }
      if (def.slot === "grenade") {
        if (this.inventory[id] >= 1) return false;
        if (this.money < def.price) return false;
        this.money -= def.price;
        this.inventory[id] = 1;
        this.refreshSlots();
        return true;
      }
      return false;
    }
    buyEquip(id) {
      if (id === "kevlar") {
        if (this.armor >= 100) return false;
        if (this.money < 650) return false;
        this.money -= 650; this.armor = 100; return true;
      }
      if (id === "helmet") {
        if (this.armor <= 0 || this.helmet) return false;
        if (this.money < 350) return false;
        this.money -= 350; this.helmet = true; return true;
      }
      if (id === "defuse") {
        if (this.team !== "CT" || this.defuseKit) return false;
        if (this.money < 400) return false;
        this.money -= 400; this.defuseKit = true; return true;
      }
      return false;
    }
    getEyePos(out) {
      const h = this.crouching ? PHYS.eyeCrouch : PHYS.eyeStand;
      return out ? out.set(this.pos.x, this.pos.y + h, this.pos.z) : new THREE.Vector3(this.pos.x, this.pos.y + h, this.pos.z);
    }
    halfExtents() {
      return { x: PHYS.halfW, z: PHYS.halfW };
    }
    updateModel(dt) {
      if (!this.model) return;
      const m = this.model;
      m.position.copy(this.pos);
      m.visible = this.alive;
      if (!this.alive) return;
      const speed = Math.hypot(this.vel.x, this.vel.z);
      m.rotation.y = this.yaw + Math.PI;
      const move = speed > 0.3;
      const t = performance.now() / 1000;
      const swing = move ? Math.sin(t * 9) * 0.45 * Math.min(1, speed / 4) : 0;
      m.userData.legL.rotation.x = swing;
      m.userData.legR.rotation.x = -swing;
      m.userData.gunAnchor.rotation.x = -this.pitch * 0.7;
      const gun = m.userData.gun;
      if (gun) {
        const wid = this.getWeaponId();
        if (gun.userData.wid !== wid) {
          while (gun.children.length) gun.remove(gun.children[0]);
          gun.add(buildGunForModel(wid));
          gun.userData.wid = wid;
        }
      }
      m.userData.head.rotation.x = U.clamp(this.pitch, -1.2, 1.2) * 0.8;
    }
    applyDamage(dmg, from, part, headshot) {
      if (!this.alive) return false;
      let d = dmg;
      if (part !== "head" && this.armor > 0) {
        const pen = this.game.lastWeaponPen != null ? this.game.lastWeaponPen : 0.5;
        d -= d * 0.5 * (1 - pen);
        this.armor = Math.max(0, this.armor - dmg * 0.4);
      }
      d = Math.max(1, Math.round(d));
      this.health -= d;
      if (from) { this.lastDamageBy = from; this.lastDamageAt = this.game.time; }
      if (this.health <= 0) {
        this.health = 0;
        this.alive = false;
        this.deadT = 0;
        this.onDie(from, headshot);
        return true;
      }
      return false;
    }
    onDie(attacker, headshot) {
      this.game.onPlayerDied(this, attacker, headshot);
    }
    giveMoney(n) { this.money += n; }
    resetRound() {
      this.health = 100;
      this.alive = true;
      this.vel.set(0, 0, 0);
      this.crouching = false;
      this.quiet = false;
      this.sprinting = false;
      this.weapon.reloading = false;
      this.weapon.reloadT = 0;
      this.weapon.switchT = 0;
      this.weapon.ads = false;
      this.weapon.meleeT = 0;
      this.weapon.recoilIdx = 0;
      this.action = null;
      this.spotted = false;
    }
    respawnAt(x, z, yaw) {
      this.pos.set(x, 0, z);
      this.yaw = yaw || 0;
      this.vel.set(0, 0, 0);
      this.resetRound();
    }
    killReward(def) {
      return def ? (def.killReward || 300) : 300;
    }
  }

  window.TFPS.PlayerEntity = PlayerEntity;
})();
