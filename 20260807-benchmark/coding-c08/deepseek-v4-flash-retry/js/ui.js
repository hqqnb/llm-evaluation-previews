(function () {
  const THREE = window.THREE;
  const U = window.TFPS.U;
  const W = window.TFPS.W;
  const SFX = window.TFPS.SFX;
  const CATS = window.TFPS.CATS;
  const BUYS = window.TFPS.BUYS;

  function el(id) { return document.getElementById(id); }

  class UI {
    constructor(game) {
      this.game = game;
      this.buyCat = "pistols";
      this.buyOpen = false;
      this.radar = el("radar");
      this.rctx = this.radar.getContext("2d");
      this.dmgNumbers = [];
      this.flashEl = el("flash-overlay");
      this.flashOpacity = 0;
      this.hitT = 0;
      this.damageT = 0;
      this.bannerT = 0;
      this.bindMenuButtons();
      this.bindBuyKeys();
    }
    bindMenuButtons() {
      el("btn-start").onclick = () => { this.showSetup(); SFX.play("ui"); };
      el("btn-controls").onclick = () => { this.showOnly("controls-menu"); SFX.play("ui"); };
      el("btn-about").onclick = () => { this.showOnly("about-menu"); SFX.play("ui"); };
      el("btn-controls-back").onclick = () => { this.showOnly("main-menu"); SFX.play("ui"); };
      el("btn-about-back").onclick = () => { this.showOnly("main-menu"); SFX.play("ui"); };
      el("btn-setup-back").onclick = () => { this.showOnly("main-menu"); SFX.play("ui"); };
      el("btn-setup-start").onclick = () => {
        const settings = {
          map: this.selectedMap || "dust2",
          team: el("setup-team").value,
          bots: parseInt(el("setup-bots").value, 10),
          diff: el("setup-diff").value,
          winScore: parseInt(el("setup-win").value, 10)
        };
        SFX.play("buy");
        this.game.startMatch(settings);
      };
      el("btn-resume").onclick = () => { this.resume(); SFX.play("ui"); };
      el("btn-restart").onclick = () => {
        this.resume();
        this.game.startMatch(this.game.settings);
      };
      el("btn-restart-round").onclick = () => {
        this.resume();
        this.game.roundNumber = Math.max(1, this.game.roundNumber);
        this.game.score = { T: 0, CT: 0 };
        this.game.startRound();
      };
      el("btn-pause-menu").onclick = () => {
        this.game.state = "menu";
        this.game.paused = false;
        document.exitPointerLock && document.exitPointerLock();
        this.hideAllMenus();
        this.hideHUD();
        this.showOnly("main-menu");
      };
      el("btn-rematch").onclick = () => { this.game.startMatch(this.game.settings); };
      el("btn-matchend-menu").onclick = () => {
        this.game.state = "menu";
        this.hideAllMenus();
        this.hideHUD();
        this.showOnly("main-menu");
      };
    }
    bindBuyKeys() {
      document.addEventListener("keydown", e => {
        if (!this.buyOpen) return;
        if (e.code === "KeyB") { this.toggleBuy(); return; }
        if (e.code.startsWith("Digit")) {
          const n = parseInt(e.code.slice(5), 10);
          const cat = CATS[n - 1];
          if (cat) { this.buyCat = cat[0]; this.renderBuy(); SFX.play("ui"); }
        }
        if (e.code === "Escape") this.toggleBuy();
      });
    }
    showOnly(id) {
      ["main-menu", "setup-menu", "controls-menu", "about-menu", "pause-menu", "scoreboard", "match-end", "buy-menu"].forEach(x => {
        el(x).classList.toggle("hidden", x !== id);
      });
    }
    hideAllMenus() {
      ["main-menu", "setup-menu", "controls-menu", "about-menu", "pause-menu", "scoreboard", "match-end", "buy-menu"].forEach(x => el(x).classList.add("hidden"));
      this.buyOpen = false;
    }
    showHUD() { el("hud").classList.remove("hidden"); }
    hideHUD() { el("hud").classList.add("hidden"); }
    showSetup() {
      this.renderMapCards();
      this.showOnly("setup-menu");
    }
    renderMapCards() {
      const wrap = el("map-cards");
      wrap.innerHTML = "";
      const maps = [
        { id: "dust2", name: "Dust2 复刻", desc: "经典结构：A大/A小/中路/B洞/双门/Xbox，完整攻防与回防节奏" },
        { id: "factory", name: "工业堡垒", desc: "夜间工业区：双层垂直结构、近距离转角战、中央走廊" },
        { id: "outpost", name: "霜线前哨", desc: "雪地远距离图：中央高地、冰湖开阔带、超长狙击线" }
      ];
      for (const m of maps) {
        const card = document.createElement("div");
        card.className = "map-card" + (m.id === (this.selectedMap || "dust2") ? " selected" : "");
        const cv = document.createElement("canvas");
        cv.width = 260; cv.height = 120;
        card.appendChild(cv);
        const name = document.createElement("div");
        name.className = "map-name"; name.textContent = m.name;
        const desc = document.createElement("div");
        desc.className = "map-desc"; desc.textContent = m.desc;
        card.appendChild(name); card.appendChild(desc);
        card.onclick = () => {
          this.selectedMap = m.id;
          this.renderMapCards();
          SFX.play("ui");
        };
        wrap.appendChild(card);
        this.drawMapPreview(cv, m.id);
      }
    }
    drawMapPreview(cv, mapId) {
      const game = this.game;
      const x = cv.getContext("2d");
      // build temporary map for preview if not current
      let map = game.mapId === mapId ? game.map : null;
      if (!map) {
        const tempScene = new THREE.Scene();
        try { map = window.TFPS.MAPS[mapId](tempScene); } catch (e) { return; }
      }
      x.fillStyle = map.theme === "snow" ? "#2b3440" : map.theme === "night" ? "#12161c" : "#2a2418";
      x.fillRect(0, 0, cv.width, cv.height);
      const b = map.bounds;
      const scale = Math.min(cv.width / (b.maxX - b.minX), cv.height / (b.maxZ - b.minZ)) * 0.92;
      const ox = (cv.width - (b.maxX - b.minX) * scale) / 2 - b.minX * scale;
      const oy = (cv.height - (b.maxZ - b.minZ) * scale) / 2 - b.minZ * scale;
      x.strokeStyle = "rgba(255,255,255,0.28)";
      x.lineWidth = 1;
      for (const c of map.colliders) {
        x.strokeRect(ox + c.min.x * scale, oy + c.min.z * scale, (c.max.x - c.min.x) * scale, (c.max.z - c.min.z) * scale);
      }
      for (const id in map.sites) {
        const s = map.sites[id];
        x.fillStyle = id === "a" ? "#d98a3d" : "#5da8d6";
        x.beginPath(); x.arc(ox + s.x * scale, oy + s.z * scale, 3.5, 0, Math.PI * 2); x.fill();
      }
      x.fillStyle = "#e8d9b0"; x.font = "10px sans-serif"; x.textAlign = "center";
      x.fillText(map.shortName || map.name, cv.width / 2, 12);
    }
    updateHUD() {
      const g = this.game;
      const p = g.player;
      if (!p) return;
      // score
      el("score-left").textContent = g.score.T;
      el("score-right").textContent = g.score.CT;
      const roundLabel = g.overtime ? "加时" : "回合";
      el("round-info").innerHTML = `<div style="font-weight:800">${roundLabel} ${g.roundNumber}</div><div>${g.map ? g.map.shortName : ""}</div>`;
      // timer
      const t = g.bomb.planted ? g.bomb.timer : g.roundTime;
      const total = g.bomb.planted ? 40 : 115;
      el("timer-fill").style.width = (U.clamp(t / total, 0, 1) * 100) + "%";
      el("timer-fill").style.background = g.bomb.planted ? "linear-gradient(90deg,#b33,#e55)" : "linear-gradient(90deg,#3d7a4f,#5ba06a)";
      el("timer-text").textContent = U.fmtTime(t);
      // bomb timer
      el("bomb-timer").classList.toggle("hidden", !g.bomb.planted);
      if (g.bomb.planted) el("bomb-timer").textContent = "💣 " + U.fmtTime(g.bomb.timer);
      // health / armor
      const hp = Math.max(0, Math.round(p.health));
      el("health-bar").style.width = hp + "%";
      el("health-bar").style.background = hp > 50 ? "linear-gradient(90deg,#3a7a4f,#5fae6e)" : hp > 25 ? "linear-gradient(90deg,#a07830,#d0a040)" : "linear-gradient(90deg,#a03030,#e05555)";
      el("health-num").textContent = hp;
      el("armor-bar").style.width = Math.max(0, Math.round(p.armor)) + "%";
      el("lowhp-vignette").style.opacity = hp < 40 ? (0.35 + (1 - hp / 40) * 0.65) : 0;
      // money
      el("money").textContent = U.money(p.money);
      // weapon
      const def = p.getWeaponDef();
      el("weapon-name").textContent = def.name + (p.team === "CT" && p.defuseKit ? " · 拆弹器" : "");
      if (def.slot === "melee") el("ammo").textContent = "—";
      else if (def.slot === "grenade") el("ammo").textContent = p.inventory[p.currentSlot] || 0;
      else el("ammo").textContent = (p.weapon.reloading ? "装弹中 " : "") + p.weapon.ammo + " / " + p.weapon.reserve;
      // crosshair spread
      const spread = Math.min(22, 5 + (def.spread || 0.02) * 700 + p.speed * 2.2 + (p.weapon.recoilIdx * 0.25));
      document.documentElement.style.setProperty("--ch-gap", "0px");
      const cs = el("crosshair");
      cs.querySelector(".ch-top").style.height = 9 + spread * 0.35 + "px";
      cs.querySelector(".ch-bottom").style.height = 9 + spread * 0.35 + "px";
      cs.querySelector(".ch-left").style.width = 9 + spread * 0.35 + "px";
      cs.querySelector(".ch-right").style.width = 9 + spread * 0.35 + "px";
      cs.querySelector(".ch-top").style.top = -(13 + spread) + "px";
      cs.querySelector(".ch-bottom").style.top = 5 + spread + "px";
      cs.querySelector(".ch-left").style.left = -(13 + spread) + "px";
      cs.querySelector(".ch-right").style.left = 5 + spread + "px";
      // interact hint
      let hint = "";
      if (p.alive) {
        if (p.team === "T" && p.bomb) {
          const s = g.findPlantSite(p);
          if (s) hint = "按住 E 安放炸弹（A/B 包点）";
        } else if (p.team === "CT" && g.bomb.planted && U.dist(p.pos.x, p.pos.z, g.bomb.pos.x, g.bomb.pos.z) < 2.2) {
          hint = "按住 E 拆除炸弹" + (p.defuseKit ? "（拆弹器 5 秒）" : "（10 秒）");
        } else if (g.nearDrop(p)) hint = "按 E 拾取武器";
        else if (g.bomb.dropped && p.team === "T" && U.dist(p.pos.x, p.pos.z, g.bomb.pos.x, g.bomb.pos.z) < 1.5) hint = "按 E 拾取炸弹";
      }
      el("interact-hint").classList.toggle("hidden", !hint);
      el("interact-hint").textContent = hint;
      // spectate
      el("spectate-info").classList.toggle("hidden", p.alive || !g.spectateTarget);
      if (!p.alive && g.spectateTarget) el("spectate-info").textContent = "观战中：" + g.spectateTarget.name + "（左键切换）";
      // bottom hint
      el("hint-bottom").textContent = p.alive ? "B 购买 · R 换弹 · 1-7 切枪 · Shift 静步 · Alt 冲刺 · E 互动 · G 丢弃" : "左键切换观战视角";
      this.drawRadar();
      this.updateDamageNumbers();
    }
    drawRadar() {
      const g = this.game;
      if (!g.map) return;
      const x = this.rctx;
      const W = this.radar.width, H = this.radar.height;
      x.clearRect(0, 0, W, H);
      const b = g.map.bounds;
      const scale = Math.min(W * 0.92 / (b.maxX - b.minX), H * 0.92 / (b.maxZ - b.minZ));
      const ox = (W - (b.maxX - b.minX) * scale) / 2 - b.minX * scale;
      const oy = (H - (b.maxZ - b.minZ) * scale) / 2 - b.minZ * scale;
      x.strokeStyle = "rgba(140,170,190,0.30)";
      x.lineWidth = 1;
      for (const c of g.map.colliders) {
        x.strokeRect(ox + c.min.x * scale, oy + c.min.z * scale, (c.max.x - c.min.x) * scale, (c.max.z - c.min.z) * scale);
      }
      for (const id in g.map.sites) {
        const s = g.map.sites[id];
        x.fillStyle = id === "a" ? "rgba(230,140,60,0.75)" : "rgba(80,160,220,0.75)";
        x.beginPath(); x.arc(ox + s.x * scale, oy + s.z * scale, 4, 0, Math.PI * 2); x.fill();
        x.fillStyle = "#fff"; x.font = "9px sans-serif"; x.textAlign = "center";
        x.fillText(id.toUpperCase(), ox + s.x * scale, oy + s.z * scale - 6);
      }
      if (g.bomb.planted) {
        x.fillStyle = "#ff4444";
        x.beginPath(); x.arc(ox + g.bomb.pos.x * scale, oy + g.bomb.pos.z * scale, 4, 0, Math.PI * 2); x.fill();
      } else if (g.bomb.dropped) {
        x.fillStyle = "#ffaa44";
        x.beginPath(); x.arc(ox + g.bomb.pos.x * scale, oy + g.bomb.pos.z * scale, 3, 0, Math.PI * 2); x.fill();
      }
      for (const p of g.players) {
        if (!p.alive) continue;
        const px = ox + p.pos.x * scale, py = oy + p.pos.z * scale;
        if (p === g.player) {
          x.save();
          x.translate(px, py);
          x.rotate(-p.yaw);
          x.fillStyle = "#7dff7a";
          x.beginPath(); x.moveTo(0, -5); x.lineTo(4, 4); x.lineTo(-4, 4); x.closePath(); x.fill();
          x.restore();
        } else {
          x.fillStyle = p.team === "T" ? "#d89b3d" : "#4d9fd6";
          x.beginPath(); x.arc(px, py, 2.4, 0, Math.PI * 2); x.fill();
        }
      }
    }
    banner(text, sub, dur) {
      const elb = el("round-banner");
      elb.classList.remove("hidden");
      elb.innerHTML = text + (sub ? `<span class="sub">${sub}</span>` : "");
      elb.style.animation = "none";
      void elb.offsetWidth;
      elb.style.animation = "banner " + (dur || 2.4) + "s ease-out forwards";
      this.bannerT = dur || 2.4;
    }
    addKill(victim, killer, weapon, headshot, team) {
      const feed = el("killfeed");
      const div = document.createElement("div");
      div.className = "kill-item " + (team === "T" ? "t" : "ct");
      div.innerHTML = `<span class="killer">${killer}</span><span class="wpn">[${weapon}${headshot ? " ☠" : ""}]</span><span class="victim">${victim}</span>`;
      feed.appendChild(div);
      while (feed.children.length > 6) feed.removeChild(feed.firstChild);
      setTimeout(() => { if (div.parentNode) div.parentNode.removeChild(div); }, 5000);
    }
    clearKillfeed() { el("killfeed").innerHTML = ""; }
    showHitmarker(head) {
      const hm = el("hitmarker");
      hm.classList.toggle("head", !!head);
      hm.classList.remove("show");
      void hm.offsetWidth;
      hm.classList.add("show");
      SFX.play(head ? "hitmarker_head" : "hitmarker");
    }
    showDamage() {
      el("damage-vignette").style.opacity = 1;
      clearTimeout(this.damageTO);
      this.damageTO = setTimeout(() => { el("damage-vignette").style.opacity = 0; }, 350);
    }
    flash(dur) { this.flashTarget = Math.min(1, dur / 3.5); this.flashT = dur; }
    setFlash(op) {
      this.flashOpacity = Math.max(op, this.flashOpacity * 0.94);
      this.flashEl.style.opacity = this.flashOpacity;
      if (op <= 0.01 && this.flashOpacity < 0.02) this.flashOpacity = 0;
    }
    addDamageNumber(pos, dmg, head) {
      const div = document.createElement("div");
      div.style.cssText = "position:absolute;color:#fff;font-weight:800;font-size:15px;text-shadow:0 1px 3px #000;pointer-events:none;transform:translate(-50%,-50%);z-index:30";
      div.textContent = "-" + Math.round(dmg);
      el("hud").appendChild(div);
      this.dmgNumbers.push({ pos, dmg, head, t: 0.9, el: div });
    }
    updateDamageNumbers() {
      const g = this.game;
      const canvas = g.canvas;
      for (let i = this.dmgNumbers.length - 1; i >= 0; i--) {
        const d = this.dmgNumbers[i];
        d.t -= 0.016;
        if (d.t <= 0) { d.el.remove(); this.dmgNumbers.splice(i, 1); continue; }
        const v = d.pos.clone().add(new THREE.Vector3(0, 0.2 + (0.9 - d.t) * 0.4, 0));
        v.project(g.camera);
        if (v.z > 1) continue;
        const x = (v.x * 0.5 + 0.5) * canvas.clientWidth;
        const y = (-v.y * 0.5 + 0.5) * canvas.clientHeight;
        d.el.style.left = x + "px";
        d.el.style.top = y + "px";
        d.el.style.color = d.head ? "#ff5a4e" : "#fff";
        d.el.style.opacity = Math.min(1, d.t * 2);
      }
    }
    toggleBuy() {
      if (!this.game.player || !this.game.player.alive || this.game.roundState !== "freeze") return;
      this.buyOpen = !this.buyOpen;
      el("buy-menu").classList.toggle("hidden", !this.buyOpen);
      if (this.buyOpen) this.renderBuy();
      SFX.play("ui");
    }
    renderBuy() {
      const g = this.game, p = g.player;
      if (!p) return;
      el("buy-round").textContent = "回合 " + g.roundNumber + " · 阵营 " + (p.team === "T" ? "T" : "CT");
      el("buy-money").textContent = U.money(p.money);
      const cats = el("buy-cats");
      cats.innerHTML = "";
      for (const c of CATS) {
        const b = document.createElement("div");
        b.className = "buy-cat" + (c[0] === this.buyCat ? " active" : "");
        b.textContent = c[1] + " (" + c[2] + ")";
        b.onclick = () => { this.buyCat = c[0]; this.renderBuy(); SFX.play("ui"); };
        cats.appendChild(b);
      }
      const grid = el("buy-grid");
      grid.innerHTML = "";
      for (const item of BUYS[this.buyCat] || []) {
        const def = W[item.id];
        const price = item.price != null ? item.price : (def ? def.price : 0);
        const own = this.ownsItem(item.id);
        const teamOk = !item.team || item.team === p.team;
        const div = document.createElement("div");
        div.className = "buy-item" + ((!teamOk || p.money < price || own) ? " disabled" : "");
        div.innerHTML = `<div class="bi-name">${def ? def.name : item.id}</div><div class="bi-desc">${item.desc || ""}</div><div class="bi-price">${U.money(price)}</div>`;
        div.onclick = () => {
          if (!teamOk || p.money < price || own) { SFX.play("deny"); return; }
          const ok = item.id === "kevlar" || item.id === "helmet" || item.id === "defuse" ? p.buyEquip(item.id) : p.buyWeapon(item.id);
          if (ok) { SFX.play("buy"); this.renderBuy(); }
          else SFX.play("deny");
        };
        grid.appendChild(div);
      }
    }
    ownsItem(id) {
      const p = this.game.player;
      if (id === "kevlar") return p.armor >= 100;
      if (id === "helmet") return p.helmet;
      if (id === "defuse") return p.defuseKit;
      if (W[id].slot === "pistol") return p.inventory.pistol === id;
      if (["rifle", "smg", "sniper", "shotgun"].includes(W[id].slot)) return p.inventory.primary === id;
      if (W[id].slot === "grenade") return p.inventory[id] > 0;
      return false;
    }
    showScoreboard(show) {
      if (show && this.game.state === "playing") {
        this.renderScoreboard();
        el("scoreboard").classList.remove("hidden");
      } else {
        el("scoreboard").classList.add("hidden");
      }
    }
    renderScoreboard() {
      const g = this.game;
      el("scoreboard-title").textContent = `记分板 · ${g.map ? g.map.name : ""} · ${g.score.T} : ${g.score.CT} · 回合 ${g.roundNumber}`;
      const tbl = el("scoreboard-table");
      tbl.innerHTML = "";
      const mkTable = team => {
        const rows = g.players.filter(p => p.team === team).sort((a, b) => b.stats.kills - a.stats.kills || b.stats.damage - a.stats.damage);
        const t = document.createElement("table");
        t.innerHTML = `<tr class="team-hdr ${team === "T" ? "t" : "ct"}"><td colspan="6">${team === "T" ? "恐怖分子" : "反恐精英"} (${team}) — ${g.score[team]} 胜</td></tr>
          <tr><th>玩家</th><th>击杀</th><th>死亡</th><th>爆头</th><th>伤害</th><th>金钱</th></tr>`;
        for (const p of rows) {
          const tr = document.createElement("tr");
          if (p === g.player) tr.className = "row-self";
          tr.innerHTML = `<td>${p.name}${p === g.player ? " ★" : ""}${p.bomb ? " 💣" : ""}${p.alive ? "" : " ☠"}</td><td>${p.stats.kills}</td><td>${p.stats.deaths}</td><td>${p.stats.hs}</td><td>${Math.round(p.stats.damage)}</td><td>${U.money(p.money)}</td>`;
          t.appendChild(tr);
        }
        tbl.appendChild(t);
      };
      mkTable("T");
      mkTable("CT");
    }
    handleEscape() {
      const g = this.game;
      if (this.buyOpen) { this.toggleBuy(); return; }
      if (el("scoreboard").classList.contains("hidden") === false) { this.showScoreboard(false); return; }
      if (g.state !== "playing") return;
      if (document.pointerLockElement === g.canvas) {
        document.exitPointerLock();
        this.showPause();
      } else if (!this.pauseShown) {
        this.showPause();
      } else {
        this.resume();
      }
    }
    showPause() {
      const g = this.game;
      this.pauseShown = true;
      g.paused = true;
      this.showOnly("pause-menu");
    }
    resume() {
      this.pauseShown = false;
      this.game.paused = false;
      this.hideAllMenus();
      if (this.game.state === "playing" && this.game.player && this.game.player.alive) {
        this.game.canvas.requestPointerLock();
      }
    }
    setMatchEnd(winner) {
      const g = this.game;
      el("match-end-title").textContent = (winner === "T" ? "恐怖分子胜利" : "反恐精英胜利") + "！";
      el("match-end-score").textContent = g.score.T + " : " + g.score.CT;
      const rows = g.players.slice().sort((a, b) => b.stats.kills - a.stats.kills);
      const mvp = rows[0];
      let html = `<div>MVP：${mvp ? mvp.name : "-"}（${mvp ? mvp.stats.kills : 0} 击杀）</div><div style="margin-top:8px">`;
      for (const p of rows.slice(0, 6)) {
        html += `<div>${p.name}${p === g.player ? " ★" : ""} — ${p.stats.kills} 击杀 / ${p.stats.deaths} 死亡 / ${p.stats.hs} 爆头 / ${Math.round(p.stats.damage)} 伤害</div>`;
      }
      html += "</div>";
      el("match-end-stats").innerHTML = html;
    }
    showMatchEnd() {
      this.showOnly("match-end");
      el("hud").classList.add("hidden");
    }
    showSpectate() { el("spectate-info").classList.remove("hidden"); }
    spectateName(name) {
      el("spectate-info").textContent = "观战中：" + name + "（左键切换）";
    }
    scopeActive(on) {
      document.body.classList.toggle("scope-active", !!on);
    }
  }

  window.TFPS.UI = UI;
})();
