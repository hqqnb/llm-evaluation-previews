// game.js — match/round manager, bomb logic, combat resolution, spectate
import * as THREE from 'three';
import { buildMap, makeTextSprite } from './map_builder.js';
import { NavGraph } from './nav.js';
import { MAPS } from './maps.js';
import { Player } from './player.js';
import { Bot, DIFFS } from './bot.js';
import { GrenadeSystem } from './grenades.js';
import { recoilOffset, currentSpread } from './weapon_view.js';
import { WEAPONS, GRENADES } from './weapons_data.js';
import * as Econ from './economy.js';
import { Input, pressed, down } from './input.js';
import * as Audio from './audio.js';
import { dist, clamp, choice, rand, now, fmtTime, angleTo, angleDiff } from './math.js';

const FREEZE = 4, ROUND_TIME = 115, BOMB_TIME = 40, END_DELAY = 5, BUY_WINDOW = 18;
const BOT_NAMES = ['Zeus','Neo','GeT_RiGhT','f0rest','coldzera','s1mple','device','NiKo','ZywOo','shroud','kennyS','GuardiaN','olofmeister','dupreeh','Xyp9x','FalleN','KRIMZ','flusha','JW','TACO','electronic','Perfecto','b1t','sh1ro'];

export class Game {
  constructor(stage, hud) {
    this.stage = stage; this.hud = hud;
    this.raycaster = new THREE.Raycaster();
    this.running = false; this.paused = false;
    this.bots = []; this.decals = []; this.tracers = [];
    this.state = 'menu'; this.buyMenuOpen = false; this.specTarget = null;
  }

  configure(cfg) { this.cfg = cfg; }

  start() {
    this.cleanup();
    const mapDef = MAPS[this.cfg.map] || MAPS.dust2;
    this.mapData = mapDef.build();
    const built = buildMap(this.stage.scene, this.mapData);
    this.world = built.world; this.mapGroup = built.group;
    this.nav = new NavGraph(this.mapData.nav.nodes, this.mapData.nav.edges, this.world);
    this.grenades = new GrenadeSystem(this.stage.scene, this.world);
    this.wireGrenades();

    // teams
    let playerTeam = this.cfg.team;
    if (playerTeam === 'AUTO') playerTeam = choice(['T', 'CT']);
    this.playerTeam = playerTeam;
    this.player = new Player(this.stage, this.hud.vm);
    this.player.team = playerTeam; this.player.money = Econ.START_MONEY;
    this.player.kills = 0; this.player.deaths = 0;

    // bots: (count-1) allies + count enemies
    const perTeam = this.cfg.count;
    this.bots = [];
    const usedNames = new Set();
    const pick = () => { let n; do { n = choice(BOT_NAMES); } while (usedNames.has(n)); usedNames.add(n); return n; };
    const mkBot = (team) => {
      const b = new Bot(this.stage.scene, 'bot' + this.bots.length, pick(), team, this.cfg.diff);
      b.money = Econ.START_MONEY; b.kills = 0; b.deaths = 0; this.bots.push(b);
    };
    for (let i = 0; i < perTeam - 1; i++) mkBot(playerTeam);         // allies
    const enemyTeam = playerTeam === 'T' ? 'CT' : 'T';
    for (let i = 0; i < perTeam; i++) mkBot(enemyTeam);              // enemies

    this.entities = [this.player, ...this.bots];
    this.scoreT = 0; this.scoreCT = 0; this.roundNum = 0;
    this.lossStreak = { T: 0, CT: 0 };
    this.createBombMesh();
    this.running = true; this.state = 'live';
    this.startRound(true);
  }

  team(e) { return e.team; }
  aliveOf(team) { return this.entities.filter(e => e.team === team && e.alive); }
  enemiesOf(e) { return this.entities.filter(x => x.team !== e.team); }
  alliesOf(e) { return this.entities.filter(x => x.team === e.team && x !== e); }

  createBombMesh() {
    this.bombMesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0x330000 }));
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    led.position.y = 0.14; this.bombMesh.add(led); this.bombLed = led;
    this.bombMesh.visible = false; this.stage.scene.add(this.bombMesh);
  }

  startRound(first) {
    this.roundNum++;
    this.state = 'freeze'; this.roundTimer = ROUND_TIME; this.freezeTimer = FREEZE;
    this.buyOpen = false; this.roundEndT = 0; this.roundResult = null;
    this.bomb = { planted: false, carrier: null, site: null, timer: BOMB_TIME, pos: null, defuseBy: null, exploded: false };
    // objective site for T attack
    this.objectiveSite = choice(['A', 'B']);

    // reset economy buys: give money already set. reset positions & health
    const mapS = this.mapData.spawns;
    const b = this.mapData.bounds; const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const place = (i, team) => {
      const arr = mapS[team]; const s = arr[i % arr.length];
      const x = s.x + rand(-1, 1), z = s.z + rand(-1, 1);
      return { x, z, angle: angleTo(x, z, cx, cz) };
    };
    // player (keep loadout if survived previous round)
    const survived = !first && this.player.alive;
    this.player.reset(place(0, this.playerTeam), this.playerTeam, survived);
    this.player.flash = 0;
    // bots
    const tIdx = { T: 1, CT: 1 };
    for (const b of this.bots) {
      const idx = tIdx[b.team]++;
      const spawn = place(idx, b.team);
      // bot buy
      const { loadout, spent } = Econ.botBuy(b.money, b.team, this.cfg.diff);
      b.money = Econ.clampMoney(b.money - spent);
      b.reset(spawn, b.team, loadout);
    }

    // assign bomb to a random T (prefer a bot; if player is T maybe give)
    const tTeam = this.entities.filter(e => e.team === 'T' && e.alive);
    const carrier = choice(tTeam);
    this.assignBomb(carrier);

    // open buy for player
    this.buyEndTime = now() + BUY_WINDOW;
    this.hud.showRoundBanner(`第 ${this.roundNum} 回合 · 准备`, '#ffd24a');
    this.buyMenuOpen = false; this.toggleBuy(true);
    Audio.sfxBeep(false);
    this.updateInventoryHud();
  }

  assignBomb(carrier) {
    this.bomb.carrier = carrier;
    for (const e of this.entities) e.hasBomb = false;
    if (carrier) carrier.hasBomb = true;
  }

  wireGrenades() {
    const g = this.grenades;
    g.combatants = () => this.entities;
    g.playerPos = () => this.player.pos;
    g.playerCamDir = () => this.player.camDir();
    g.onPlayerFlash = (s) => { this.player.flash = Math.max(this.player.flash, 0.4 + s * 2.4); };
    g.onFlash = (bot, s) => { bot.flash = Math.max(bot.flash, 0.3 + s * 2.2); };
    g.onExplosionShake = (s) => { this.player.shake = Math.min(1.4, this.player.shake + s); };
    g.onDamage = (e, dmg, team, ownerId, isFire) => {
      if (!e.alive) return;
      const w = { hs: 1, armorPen: 0.5 };
      const dead = e.takeDamage(dmg, w, false);
      if (e === this.player) this.hud.damageFlash();
      if (dead) {
        const attacker = this.entities.find(x => x.id === ownerId) || null;
        this.registerKill(attacker, e, isFire ? 'molotov' : 'he', false);
      }
    };
  }

  update(dt) {
    if (!this.running || this.paused) return;
    const t = now();
    // timers
    if (this.state === 'freeze') {
      this.freezeTimer -= dt;
      if (this.freezeTimer <= 0) { this.state = 'live'; this.hud.showRoundBanner('开始！', '#6fd36f'); }
    } else if (this.state === 'live') {
      if (!this.bomb.planted) {
        this.roundTimer -= dt;
        if (this.roundTimer <= 0) this.endRound('CT', '时间到 · CT 防守成功');
      }
    } else if (this.state === 'ended') {
      this.roundEndT -= dt;
      if (this.roundEndT <= 0) {
        if (this.scoreT >= this.cfg.maxwin || this.scoreCT >= this.cfg.maxwin) this.finishMatch();
        else this.startRound(false);
        return;
      }
    }

    const moveEnabled = this.state === 'live' && this.player.alive && !this.buyMenuOpen;
    // buy window auto-close
    if (this.buyMenuOpen && (t > this.buyEndTime || this.state !== 'freeze' && this.state !== 'live')) {
      if (t > this.buyEndTime && this.state === 'live') { /* keep until closed manually only in buy zone */ }
    }
    this.handleInput(dt, t);

    // player
    this.player.update(dt, this.world, Input.locked ? Input : null, moveEnabled);
    if (this.player.alive) this.playerCombat(dt, t);
    else this.spectate(dt);
    // footsteps
    this.footstep(dt);

    // bots
    for (const b of this.bots) {
      if (!b.alive) { b.update(dt, null); continue; }
      const ctx = {
        enemies: this.enemiesOf(b), world: this.world, nav: this.nav, grenades: this.grenades,
        time: t, bomb: this.bomb, bombsites: this.mapData.bombsites, objectiveSite: this.objectiveSite,
        onShoot: (bot, target, hit, d) => this.botShoot(bot, target, hit, d),
        onPlant: (bot, site) => this.doPlant(bot, site),
        onDefuse: (bot) => this.doDefuse(bot),
      };
      if (this.state !== 'live') { b.updateModel(dt); continue; }
      b.update(dt, ctx);
    }

    this.grenades.update(dt);
    this.updateBomb(dt, t);
    this.updateEffects(dt);

    // audio listener
    Audio.setListener(this.player.pos.x, this.player.pos.z, this.player.yaw);

    if (this.state === 'live') this.checkWin();
    this.updateHud(dt, t);
  }
  buyAllowed(t) { return this.state === 'freeze' || t < this.buyEndTime; }

  toggleBuy(force) {
    const open = force !== undefined ? force : !this.buyMenuOpen;
    this.buyMenuOpen = open;
    this.hud.openBuy(open, this);
    if (open) { if (document.exitPointerLock) document.exitPointerLock(); }
    else { this.stage.renderer.domElement.requestPointerLock(); }
  }
  attemptBuy(id) {
    if (!this.player.alive) return;
    if (!this.buyAllowed(now())) { this.hud.buyMsg('购买时间已结束'); return; }
    const r = Econ.buyItem(this.player, id);
    this.hud.buyMsg(r.ok ? '已购买' : r.msg);
    if (r.ok) { this.updateInventoryHud(); this.hud.refreshBuy(this); }
  }

  handleInput(dt, t) {
    if (pressed('KeyB') && this.player.alive) {
      if (!this.buyMenuOpen && !this.buyAllowed(t)) this.hud.showRoundBanner('购买时间已结束', '#e05a4f');
      else this.toggleBuy();
    }
    if (this.buyMenuOpen) {
      // number shortcuts handled by hud clicks; allow quick close
      return;
    }
    if (!Input.locked || !this.player.alive) return;
    const p = this.player;
    if (pressed('Digit1')) p.switchTo(p.inv[2] ? 2 : 1);
    if (pressed('Digit2')) p.switchTo(1);
    if (pressed('Digit3')) p.switchTo(3);
    if (pressed('Digit4')) { if (p.slot === 'g') p.nextGrenade(); else p.switchTo('g'); }
    if (Input.wheel !== 0) this.cycleWeapon(Input.wheel);
    if (pressed('KeyR')) p.startReload();
    if (pressed('KeyG')) this.dropWeapon();
    this.updateInventoryHud();
  }
  cycleWeapon(dir) {
    const p = this.player;
    const order = [];
    if (p.inv[2]) order.push(2); if (p.inv[1]) order.push(1); order.push(3);
    if (p.inv.grenades.length) order.push('g');
    let i = order.indexOf(p.slot); if (i < 0) i = 0;
    i = (i + (dir > 0 ? 1 : -1) + order.length) % order.length;
    p.switchTo(order[i]);
  }
  dropWeapon() {
    const p = this.player;
    if (p.slot === 2 && p.inv[2]) { p.inv[2] = null; p.switchTo(1); }
  }

  playerCombat(dt, t) {
    const p = this.player;
    const w = p.weapon();
    const isNade = p.slot === 'g';
    // ADS
    const canAds = !isNade && w.cat !== 'knife';
    const ads = canAds && Input.rightDown;
    p.ads = ads;
    const baseFov = 90, targetFov = ads ? (w.adsFov || 70) : baseFov;
    this.stage.setFov(clamp(this.stage.camera.fov + (targetFov - this.stage.camera.fov) * Math.min(1, dt * 12), 20, 90));
    this.hud.setScope(ads && w.scoped ? w : null);
    // viewmodel
    p.vm.show();
    p.vm.update(dt, p._speed > 1.5, ads, p._speed);

    // firing
    const fresh = Input.mouseDown && !this._mouseWas;
    this._mouseWas = Input.mouseDown;
    if (isNade) {
      if (fresh && p.grenadeThrow <= 0 && p.switchTimer <= 0) this.throwPlayerNade();
    } else if (w.cat === 'knife') {
      if (fresh && p.canFire()) this.knifeAttack();
    } else {
      const wantFire = w.auto ? Input.mouseDown : fresh;
      if (wantFire && p.canFire()) {
        if (p.ammo[p.current] > 0) this.doPlayerShot(w, ads);
        else Audio.sfxTone(200, 0.05, 0.2, 'square'); // empty click
      }
    }
    // plant / defuse (hold E)
    this.playerObjective(dt, t);
  }

  doPlayerShot(w, ads) {
    const p = this.player;
    p.ammo[p.current]--;
    p.shotTimer = 1 / w.rate;
    p.recoilIndex++; p.recoilCooldown = 0.18;
    const r = recoilOffset(w, p.recoilIndex);
    p.addRecoil(r.up * (ads ? 0.6 : 1), r.yaw * (ads ? 0.6 : 1));
    p.vm.doFire();
    Audio.sfxShot(w.snd, undefined, undefined);
    const spread = currentSpread(w, p._speed > 1.5, !p.onGround, ads, p.crouch > 0.5);
    const pellets = w.pellets || 1;
    for (let i = 0; i < pellets; i++) this.castBullet(w, spread);
    if (p.ammo[p.current] === 0) p.startReload();
  }
  castBullet(w, spread) {
    const p = this.player;
    this.stage.scene.updateMatrixWorld(true);
    const origin = p.eyePos();
    const dir = p.camDir();
    // apply spread
    dir.x += (Math.random() - 0.5) * spread * 2;
    dir.y += (Math.random() - 0.5) * spread * 2;
    dir.z += (Math.random() - 0.5) * spread * 2;
    dir.normalize();
    const range = 200;
    const enemies = this.enemiesOf(p).filter(e => e.alive && e.isBot);
    const meshes = [];
    for (const e of enemies) for (const m of e.hitMeshes) meshes.push(m);
    this.raycaster.set(origin, dir);
    this.raycaster.far = range;
    const hits = this.raycaster.intersectObjects(meshes, false);
    const wallDist = this.world.bulletWall(origin.x, origin.z, dir.x, dir.z, range, origin.y);
    let end = origin.clone().addScaledVector(dir, Math.min(wallDist, range));
    if (hits.length && hits[0].distance <= wallDist) {
      const hit = hits[0]; const bot = hit.object.userData.bot; const part = hit.object.userData.part;
      end = hit.point.clone();
      const headshot = part === 'head';
      const falloff = clamp(1 - hit.distance * 0.004, 0.5, 1);
      let dmg = w.dmg * falloff;
      if (part === 'leg') dmg *= 0.75;
      const dead = bot.takeDamage(dmg, w, headshot);
      Audio.sfxHit(headshot);
      this.hud.hitMarker(dead);
      this.bloodSpark(hit.point);
      if (dead) this.registerKill(p, bot, p.current, headshot);
    } else {
      this.impact(end);
    }
    this.spawnTracer(this.muzzleWorld(), end);
  }
  muzzleWorld() {
    const p = this.player;
    return p.eyePos().addScaledVector(p.camDir(), 0.6);
  }

  throwPlayerNade() {
    const p = this.player;
    if (!p.inv.grenades.length) return;
    const type = p.curNade || p.inv.grenades[0];
    const origin = p.eyePos().addScaledVector(p.camDir(), 0.5);
    this.grenades.throw(type, origin, p.camDir(), 20, p.team, p.id);
    const idx = p.inv.grenades.indexOf(type);
    if (idx >= 0) p.inv.grenades.splice(idx, 1);
    p.grenadeThrow = 0.9; p.vm.doFire();
    Audio.sfxTone(300, 0.05, 0.15);
    if (!p.inv.grenades.length) p.switchTo(p.inv[2] ? 2 : 1);
    else { p.curNade = p.inv.grenades[0]; p.current = 'nade:' + p.curNade; }
    this.updateInventoryHud();
  }
  knifeAttack() {
    const p = this.player; p.shotTimer = 1 / p.weapon().rate; p.vm.doFire();
    Audio.sfxTone(500, 0.06, 0.2, 'square');
    for (const e of this.enemiesOf(p)) {
      if (!e.alive) continue;
      const d = dist(p.pos.x, p.pos.z, e.pos.x, e.pos.z);
      if (d > 2.4) continue;
      const ang = angleTo(p.pos.x, p.pos.z, e.pos.x, e.pos.z);
      if (Math.abs(angleDiff(p.yaw, ang)) < 1.0) {
        const dead = e.takeDamage(55, WEAPONS.knife, false);
        this.hud.hitMarker(dead); this.bloodSpark(new THREE.Vector3(e.pos.x, e.pos.y + 1.2, e.pos.z));
        if (dead) this.registerKill(p, e, 'knife', false);
      }
    }
  }

  playerObjective(dt, t) {
    const p = this.player; let status = null;
    const holdE = down('KeyE') && Input.locked;
    // T pickup dropped bomb
    if (p.team === 'T' && !p.hasBomb && this.bomb.dropped && !this.bomb.planted) {
      if (dist(p.pos.x, p.pos.z, this.bomb.pos.x, this.bomb.pos.z) < 1.6) {
        p.hasBomb = true; this.bomb.dropped = false; this.bomb.carrier = p; this.bombMesh.visible = false;
      }
    }
    if (p.team === 'T' && p.hasBomb && !this.bomb.planted) {
      const site = this.inSite(p.pos);
      if (site && p.onGround && p._speed < 0.6 && holdE) {
        p.plantProg = (p.plantProg || 0) + dt;
        status = { txt: `安放炸弹 ${Math.floor(p.plantProg / 3.2 * 100)}%`, cls: '' };
        if (p.plantProg >= 3.2) { this.doPlant(p, site); p.plantProg = 0; }
      } else { p.plantProg = 0; if (site) status = { txt: '按住 E 安放炸弹', cls: '' }; }
    } else if (p.team === 'CT' && this.bomb.planted && !this.bomb.defused) {
      const d = dist(p.pos.x, p.pos.z, this.bomb.pos.x, this.bomb.pos.z);
      if (d < 2.2 && holdE && p._speed < 0.6) {
        const need = p.defuseKit ? 5 : 10;
        p.defuseProg = (p.defuseProg || 0) + dt;
        status = { txt: `拆除炸弹 ${Math.floor(p.defuseProg / need * 100)}%`, cls: 'defusing' };
        Audio.sfxDefuse();
        if (p.defuseProg >= need) this.doDefuse(p);
      } else { p.defuseProg = 0; if (d < 2.2) status = { txt: p.defuseKit ? '按住 E 拆弹 (有拆弹器)' : '按住 E 拆弹', cls: 'defusing' }; }
    }
    this.hud.setBombStatus(status);
  }
  inSite(pos) {
    for (const k of ['A', 'B']) { const s = this.mapData.bombsites[k]; if (s && dist(pos.x, pos.z, s.x, s.z) < s.r) return k; }
    return null;
  }
  doPlant(planter, site) {
    if (this.bomb.planted) return;
    this.bomb.planted = true; this.bomb.site = site; this.bomb.timer = BOMB_TIME;
    this.bomb.pos = new THREE.Vector3(planter.pos.x, 0, planter.pos.z);
    planter.hasBomb = false; this.bomb.carrier = null; this.bomb.dropped = false;
    this.bombMesh.position.set(this.bomb.pos.x, 0.12, this.bomb.pos.z); this.bombMesh.visible = true;
    if (planter.money !== undefined) planter.money = Econ.clampMoney(planter.money + Econ.PLANT_PERSONAL);
    Audio.sfxTone(880, 0.12, 0.35);
    this.hud.showRoundBanner(`炸弹已在 ${site} 点安放！`, '#e05a4f');
  }
  doDefuse(defuser) {
    if (this.bomb.defused) return;
    this.bomb.defused = true; this.bombMesh.visible = false;
    if (defuser.money !== undefined) defuser.money = Econ.clampMoney(defuser.money + Econ.DEFUSE_PERSONAL);
    this.endRound('CT', '炸弹已被拆除');
  }

  botShoot(bot, target, hit, d) {
    Audio.sfxShot(bot.w.snd, bot.pos.x, bot.pos.z);
    const fwd = new THREE.Vector3(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
    const from = new THREE.Vector3(bot.pos.x, bot.eyeY(), bot.pos.z).addScaledVector(fwd, 0.7);
    const to = new THREE.Vector3(target.pos.x, target.pos.y + 1.3, target.pos.z);
    this.spawnTracer(from, to);
    if (!hit) return;
    const headshot = Math.random() < bot.d.hsChance;
    const falloff = clamp(1 - d * 0.004, 0.4, 1);
    const dmg = bot.w.dmg * falloff;
    const dead = target.takeDamage(dmg, bot.w, headshot);
    if (target === this.player) { this.hud.damageFlash(); this.hud.dirIndicator(bot.pos, this.player); }
    else this.bloodSpark(to);
    if (dead) this.registerKill(bot, target, bot.weaponId, headshot);
  }
  registerKill(attacker, victim, weaponId, headshot) {
    victim.deaths = (victim.deaths || 0) + 1;
    if (victim.team === 'T' && victim.hasBomb) {
      victim.hasBomb = false; this.bomb.dropped = true; this.bomb.carrier = null;
      this.bomb.pos = new THREE.Vector3(victim.pos.x, 0, victim.pos.z);
      this.bombMesh.position.set(victim.pos.x, 0.12, victim.pos.z); this.bombMesh.visible = true;
    }
    if (victim === this.player) this.onPlayerDeath(); else victim.die();
    if (attacker && attacker.team !== victim.team) {
      attacker.kills = (attacker.kills || 0) + 1;
      const rew = (WEAPONS[weaponId] && WEAPONS[weaponId].kill) || 300;
      if (attacker.money !== undefined) attacker.money = Econ.clampMoney(attacker.money + rew);
    }
    this.hud.addKill(attacker ? attacker.name : '世界', attacker ? attacker.team : victim.team,
      victim.name, victim.team, weaponId, headshot);
  }
  onPlayerDeath() {
    this.player.alive = false; this.player.vm.hide();
    this.stage.setFov(90); this.hud.setScope(null);
    this.hud.spectateMsg('你已阵亡 · 观战中');
  }

  updateBomb(dt, t) {
    if (this.bomb.planted && !this.bomb.defused && !this.bomb.exploded) {
      this.bomb.timer -= dt;
      const per = clamp(this.bomb.timer / BOMB_TIME, 0.02, 1);
      this.bombLed.visible = Math.floor(t * (2 + (1 - per) * 8)) % 2 === 0;
      if (!this._lastBeep || t - this._lastBeep > Math.max(0.12, per * 0.9)) { this._lastBeep = t; Audio.sfxBeep(per < 0.3); }
      if (this.bomb.timer <= 0) this.explodeBomb();
    }
    if (this.bomb.dropped && !this.bomb.planted) {
      for (const e of this.entities) {
        if (e.team === 'T' && e.alive && !e.hasBomb && e !== this.player &&
          dist(e.pos.x, e.pos.z, this.bomb.pos.x, this.bomb.pos.z) < 1.4) {
          this.bomb.dropped = false; this.bombMesh.visible = false; e.hasBomb = true; this.bomb.carrier = e; break;
        }
      }
    }
  }
  explodeBomb() {
    this.bomb.exploded = true; this.bombMesh.visible = false;
    Audio.sfxExplosion(this.bomb.pos.x, this.bomb.pos.z);
    this.grenades._boom(new THREE.Vector3(this.bomb.pos.x, 1.2, this.bomb.pos.z), 0xffaa33);
    for (const e of this.entities) {
      if (!e.alive) continue;
      const d = dist(e.pos.x, e.pos.z, this.bomb.pos.x, this.bomb.pos.z);
      if (d < 14) { const dead = e.takeDamage(220 * (1 - d / 14), { armorPen: 1, hs: 1 }, false); if (dead && e === this.player) this.onPlayerDeath(); else if (dead) e.die(); }
    }
    if (dist(this.player.pos.x, this.player.pos.z, this.bomb.pos.x, this.bomb.pos.z) < 20) this.player.shake = 1.4;
    this.endRound('T', '炸弹爆炸');
  }
  checkWin() {
    if (this.bomb.defused || this.bomb.exploded) return;
    const tA = this.aliveOf('T').length, cA = this.aliveOf('CT').length;
    if (!this.bomb.planted) {
      if (tA === 0) return this.endRound('CT', '消灭所有恐怖分子');
      if (cA === 0) return this.endRound('T', '消灭所有反恐精英');
    } else {
      if (cA === 0) return this.endRound('T', '炸弹已安放 · CT 全灭');
    }
  }
  endRound(winner, reason) {
    if (this.state === 'ended' || this.state === 'over') return;
    this.state = 'ended'; this.roundEndT = END_DELAY; this.roundResult = { winner, reason };
    if (winner === 'T') this.scoreT++; else this.scoreCT++;
    const loser = winner === 'T' ? 'CT' : 'T';
    for (const e of this.entities.filter(x => x.team === winner)) e.money = Econ.clampMoney((e.money || 0) + Econ.WIN_REWARD);
    const lb = Econ.lossReward(this.lossStreak[loser]);
    for (const e of this.entities.filter(x => x.team === loser)) e.money = Econ.clampMoney((e.money || 0) + lb);
    if (this.bomb.planted && loser === 'T')
      for (const e of this.entities.filter(x => x.team === 'T')) e.money = Econ.clampMoney((e.money || 0) + Econ.PLANT_TEAM);
    this.lossStreak[loser] = Math.min(this.lossStreak[loser] + 1, 4); this.lossStreak[winner] = 0;
    const col = winner === this.playerTeam ? '#6fd36f' : '#e05a4f';
    this.hud.showRoundBanner((winner === 'T' ? '恐怖分子' : '反恐精英') + ' 获胜 · ' + reason, col);
    Audio.sfxRoundWin(winner === this.playerTeam);
    if (this.buyMenuOpen) this.toggleBuy(false);
  }
  finishMatch() {
    this.state = 'over'; this.running = false;
    const winner = this.scoreT > this.scoreCT ? 'T' : 'CT';
    if (document.exitPointerLock) document.exitPointerLock();
    this.hud.showResults(winner === this.playerTeam, this.scoreT, this.scoreCT, this.mvp(), this.playerTeam);
  }
  mvp() {
    let best = this.player, bk = this.player.kills || 0;
    for (const b of this.bots) if ((b.kills || 0) > bk) { bk = b.kills; best = b; }
    return best;
  }

  spectate(dt) {
    this.player.vm.hide();
    const cam = this.stage.camera; cam.rotation.order = 'YXZ';
    const allies = this.entities.filter(e => e.team === this.playerTeam && e.alive);
    if (allies.length) {
      if (!this.specTarget || !this.specTarget.alive || pressed('Space')) this.specTarget = choice(allies);
      const a = this.specTarget;
      cam.position.set(a.pos.x, a.pos.y + 1.5, a.pos.z);
      cam.rotation.y = a.yaw; cam.rotation.x = a.pitch || 0;
      this.hud.spectateMsg('观战: ' + a.name + '　(空格切换视角)');
    } else {
      const c = this.mapData.bounds; const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
      cam.position.set(cx, 90, cz + 1); cam.rotation.set(-Math.PI / 2, 0, 0);
      this.hud.spectateMsg('观战 · 全场视角');
    }
  }
  footstep(dt) {
    const p = this.player; if (!p.alive) return;
    if (p.onGround && p._speed > 2.5 && !p._walking && p.crouch < 0.5) {
      this._stepT = (this._stepT || 0) + dt;
      if (this._stepT > 0.34) { this._stepT = 0; Audio.sfxFootstep(); }
    } else this._stepT = 0;
    // enemy footsteps (audible when near)
    for (const b of this.bots) {
      if (!b.alive || b.team === p.team) continue;
      const d = dist(p.pos.x, p.pos.z, b.pos.x, b.pos.z);
      if (d < 16 && b._moved > 2) {
        b._stepT = (b._stepT || 0) + dt;
        if (b._stepT > 0.36) { b._stepT = 0; Audio.sfxFootstep(b.pos.x, b.pos.z); }
      }
    }
  }

  spawnTracer(from, to) {
    const g = new THREE.BufferGeometry().setFromPoints([from, to]);
    const m = new THREE.LineBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.85 });
    const line = new THREE.Line(g, m);
    this.stage.scene.add(line);
    this.tracers.push({ mesh: line, life: 0.05, max: 0.05, fade: true });
  }
  impact(pos) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffe0a0 }));
    s.position.copy(pos); this.stage.scene.add(s);
    this.tracers.push({ mesh: s, life: 0.18, max: 0.18, shrink: true });
  }
  bloodSpark(pos) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), new THREE.MeshBasicMaterial({ color: 0x991010 }));
    s.position.copy(pos); this.stage.scene.add(s);
    this.tracers.push({ mesh: s, life: 0.22, max: 0.22, shrink: true });
  }
  updateEffects(dt) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i]; tr.life -= dt;
      const k = Math.max(0, tr.life / tr.max);
      if (tr.fade) tr.mesh.material.opacity = 0.85 * k;
      if (tr.shrink) tr.mesh.scale.setScalar(0.3 + k);
      if (tr.life <= 0) { this.stage.scene.remove(tr.mesh); if (tr.mesh.geometry) tr.mesh.geometry.dispose(); this.tracers.splice(i, 1); }
    }
    // track bot movement magnitude for footsteps
    for (const b of this.bots) { if (b.alive) b._moved = dist(b.pos.x, b.pos.z, (b._lp || b.pos).x, (b._lp || b.pos).z) / Math.max(dt, 0.001); b._lp = { x: b.pos.x, z: b.pos.z }; }
  }

  updateHud(dt, t) {
    this.hud.update({
      player: this.player, state: this.state,
      timer: this.bomb.planted ? this.bomb.timer : this.roundTimer,
      bombPlanted: this.bomb.planted,
      scoreT: this.scoreT, scoreCT: this.scoreCT, playerTeam: this.playerTeam,
      entities: this.entities, bounds: this.mapData.bounds, labels: this.mapData.labels,
      bombPos: (this.bomb.planted || this.bomb.dropped) ? this.bomb.pos : null,
      bombsites: this.mapData.bombsites, freeze: this.state === 'freeze' ? this.freezeTimer : 0,
      buyOpen: this.buyMenuOpen,
    });
  }
  updateInventoryHud() {
    const p = this.player; const items = [];
    if (p.inv[2]) items.push({ key: '1', name: WEAPONS[p.inv[2]].name, active: p.slot === 2 });
    items.push({ key: '2', name: WEAPONS[p.inv[1]].name, active: p.slot === 1 });
    items.push({ key: '3', name: '刀', active: p.slot === 3 });
    if (p.inv.grenades.length) {
      const names = p.inv.grenades.map(g => GRENADES[g].name[0]).join('');
      items.push({ key: '4', name: '投掷:' + names, active: p.slot === 'g' });
    }
    this.hud.setInventory(items);
  }

  restart() { this.start(); }
  cleanup() {
    if (this.mapGroup) this.stage.scene.remove(this.mapGroup);
    for (const b of this.bots) if (b.group) this.stage.scene.remove(b.group);
    if (this.grenades) this.grenades.clear();
    if (this.bombMesh) this.stage.scene.remove(this.bombMesh);
    for (const tr of this.tracers) this.stage.scene.remove(tr.mesh);
    this.tracers = []; this.bots = [];
  }
}

