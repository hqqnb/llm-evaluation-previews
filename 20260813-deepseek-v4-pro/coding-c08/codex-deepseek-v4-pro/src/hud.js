// ============================================================================
// HUD / UI：雷达、准星、状态、击杀提示、购买菜单、计分板、菜单、结算
// ============================================================================

import { WEAPONS, NADES, TEAM_COLORS } from "./config.js";
import { clamp, lerp } from "./util.js";
import { minimapLines } from "./maps.js";
import { AudioSys } from "./audio.js";

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(game) {
    this.game = game;
    this.e = {};
    for (const id of ["gl", "flash-overlay", "damage-vignette", "lowhp-vignette", "scope-overlay", "crosshair",
      "hitmarker", "hud", "radar", "radar-bomb", "timer", "bomb-status", "score-t", "score-ct", "round-info",
      "team-strip", "hp-fill", "hp-num", "armor-fill", "armor-num", "ammo-weapon", "ammo-count", "money",
      "inv-box", "killfeed", "killpanel", "killpanel-name", "killpanel-detail", "center-message", "alert-message",
      "spectate-bar", "spec-name", "c4-hud", "c4-state", "hint-line", "damage-dir", "buy-menu", "buy-money",
      "buy-error", "pause-menu", "main-menu", "scoreboard", "sb-t", "sb-ct", "match-end", "match-end-title",
      "match-end-stats", "loading", "loading-msg", "set-sens", "sens-val", "set-vol", "vol-val"]) {
      this.e[id] = $(id);
    }
    this.radarCtx = this.e.radar.getContext("2d");
    this.radarBg = null;
    this.radarLines = null;
    this.radarBounds = null;
    this.lastHitT = 0;
    this.dmgFlashT = 0;
    this.killPanelT = 0;
    this.centerMsgT = 0;
    this.alertT = 0;
    this.flashTarget = 0;
    this.currentSettings = { map: "dust2", team: "T", botCount: 2, difficulty: "normal", roundsWin: 8 };
    this.wireEvents();
  }

  // -------------------------------------------------------------------------
  wireEvents() {
    // 主菜单选择
    const bindGroup = (sel, key, cb) => {
      document.querySelectorAll(sel).forEach((btn) => btn.addEventListener("click", () => {
        document.querySelectorAll(sel).forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        cb(btn);
      }));
    };
    bindGroup("#map-cards .map-card", "map", (b) => { this.currentSettings.map = b.dataset.map; });
    bindGroup("#team-select button", "team", (b) => { this.currentSettings.team = b.dataset.team; });
    bindGroup("#bot-count button", "botCount", (b) => { this.currentSettings.botCount = parseInt(b.dataset.n); });
    bindGroup("#bot-diff button", "difficulty", (b) => { this.currentSettings.difficulty = b.dataset.d; });
    bindGroup("#rounds-win button", "roundsWin", (b) => { this.currentSettings.roundsWin = parseInt(b.dataset.r); });
    $("start-btn").addEventListener("click", () => this.onStart());
    // 购买
    document.querySelectorAll("[data-buy]").forEach((btn) => btn.addEventListener("click", () => {
      const ok = this.game.buy(this.game.human, btn.dataset.buy);
      if (!ok) {
        this.e["buy-error"].textContent = "无法购买：金钱不足 / 已拥有 / 不在购买区";
        setTimeout(() => { this.e["buy-error"].textContent = ""; }, 1400);
      }
      this.refreshBuyMenu();
      AudioSys.click();
    }));
    $("buy-close").addEventListener("click", () => this.toggleBuyMenu(false));
    // 暂停
    $("resume-btn").addEventListener("click", () => this.onResume());
    $("restart-btn").addEventListener("click", () => { this.onResume(); this.game.restartMatch(); });
    $("quit-btn").addEventListener("click", () => this.onQuit());
    // 结算
    $("rematch-btn").addEventListener("click", () => { this.hide($("match-end")); this.game.restartMatch(); });
    $("menu-btn").addEventListener("click", () => this.onQuit());
    // 设置
    $("set-sens").addEventListener("input", (ev) => {
      const v = parseFloat(ev.target.value);
      $("sens-val").textContent = v.toFixed(1);
      this.onSensChange?.(v);
    });
    $("set-vol").addEventListener("input", (ev) => {
      const v = parseFloat(ev.target.value);
      $("vol-val").textContent = v.toFixed(2);
      this.onVolumeChange?.(v);
    });
  }

  onStart() {
    this.hide($("main-menu"));
    this.game.startWithSettings(this.currentSettings);
  }
  onResume() {
    this.hide($("pause-menu"));
    this.game.setPaused(false);
    if (!this.game.matchEnded()) this.game.requestLock();
  }
  onQuit() {
    this.hide($("pause-menu"));
    this.hide($("match-end"));
    this.hide($("scoreboard"));
    this.game.setPaused(false);
    this.game.backToMenu();
  }

  toggleBuyMenu(force) {
    const open = force !== undefined ? force : this.e["buy-menu"].classList.contains("hidden");
    this.e["buy-menu"].classList.toggle("hidden", !open);
    if (open) this.refreshBuyMenu();
    this.onBuyToggle?.(open);
  }
  refreshBuyMenu() {
    const p = this.game.human;
    this.e["buy-money"].textContent = p ? p.money : 0;
    document.querySelectorAll("[data-buy]").forEach((btn) => {
      const id = btn.dataset.buy;
      const def = WEAPONS[id];
      let owned = false, affordable = false;
      if (!p) { affordable = false; }
      else if (def) {
        const slot = def.slot;
        owned = p.weapons[slot]?.id === id;
        affordable = p.money >= def.price;
      } else if (id === "kevlar") { owned = p.armor >= 100; affordable = p.money >= 650; }
      else if (id === "helmet") { owned = p.helmet && p.armor >= 100; affordable = p.money >= (p.armor >= 100 ? 350 : 1000); }
      else if (id === "kit") { owned = p.kit; affordable = p.money >= 400 && p.team === "CT"; }
      else { owned = (p.nades[id] || 0) >= NADES[id].max; affordable = p.money >= NADES[id].price; }
      btn.classList.toggle("owned", owned);
      btn.disabled = owned || !affordable;
    });
  }

  // -------------------------------------------------------------------------
  showHUD(v) { this.e.hud.classList.toggle("hidden", !v); }
  hideMenus() { this.hide($("main-menu")); this.hide($("pause-menu")); this.hide($("match-end")); }
  showLoading(msg) { this.e.loading.classList.remove("hidden"); this.e["loading-msg"].textContent = msg || ""; }
  hideLoading() { this.e.loading.classList.add("hidden"); }
  show(msg) { msg.classList.remove("hidden"); }
  hide(el) { el.classList.add("hidden"); }

  setupRadar(map) {
    this.radarBounds = map.bounds;
    this.radarLines = minimapLines(map);
    const off = document.createElement("canvas");
    off.width = this.e.radar.width;
    off.height = this.e.radar.height;
    const ctx = off.getContext("2d");
    const s = this.radarScale();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = "rgba(150,150,140,0.55)";
    ctx.beginPath();
    for (let i = 0; i < this.radarLines.length; i += 4) {
      const [x1, z1, x2, z2] = this.radarLines.slice(i, i + 4);
      const a = this.worldToRadar(x1, z1, s), b = this.worldToRadar(x2, z2, s);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    this.radarBg = off;
  }
  radarScale() {
    const w = this.radarBounds.x2 - this.radarBounds.x1;
    const d = this.radarBounds.z2 - this.radarBounds.z1;
    return (this.e.radar.width - 18) / Math.max(w, d);
  }
  worldToRadar(x, z, s) {
    const cx = (this.radarBounds.x1 + this.radarBounds.x2) / 2;
    const cz = (this.radarBounds.z1 + this.radarBounds.z2) / 2;
    return {
      x: this.e.radar.width / 2 + (x - cx) * s,
      y: this.e.radar.height / 2 + (z - cz) * s,
    };
  }

  drawRadar(game) {
    const ctx = this.radarCtx;
    const W = this.e.radar.width, H = this.e.radar.height;
    ctx.clearRect(0, 0, W, H);
    if (this.radarBg) ctx.drawImage(this.radarBg, 0, 0);
    const me = game.human.alive ? game.human : game.specTarget;
    if (!me) return;
    const s = this.radarScale();
    const center = this.worldToRadar(me.pos.x, me.pos.z, s);
    const forward = me.forward();
    const right = me.right();
    const drawDot = (p, color, size) => {
      const dx = p.pos.x - me.pos.x, dz = p.pos.z - me.pos.z;
      const u = -(dx * forward.x + dz * forward.z); // 前
      const r = dx * right.x + dz * right.z;        // 右
      const x = center.x + r * s;
      const y = center.y - u * s;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const p of game.players) {
      if (!p.alive) continue;
      if (p === me) {
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(center.x, center.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      if (p.team === me.team) {
        drawDot(p, p.team === "T" ? "#e8b04a" : "#6fb4ff", 2.6);
      } else {
        const d = me.pos.distanceTo(p.pos);
        if (d < 14 || (game.human.lastDamage?.attacker === p && game.time - this.dmgFlashT < 1.2)) {
          drawDot(p, "#ff5545", 2.6);
        }
      }
    }
    // 炸弹
    const b = game.bomb;
    if (b.state === "dropped" || b.state === "planted") {
      const dx = b.pos.x - me.pos.x, dz = b.pos.z - me.pos.z;
      const u = -(dx * forward.x + dz * forward.z);
      const r = dx * right.x + dz * right.z;
      ctx.fillStyle = "#ff3b30";
      ctx.font = "bold 10px sans-serif";
      ctx.fillText("C4", center.x + r * s - 6, center.y - u * s + 3);
    }
    this.e["radar-bomb"].classList.toggle("hidden", !(b.state === "dropped" || b.state === "planted"));
  }

  // -------------------------------------------------------------------------
  update(game) {
    const p = game.human;
    const phase = game.phase;
    // 计时
    if (phase === "buy") {
      this.e.timer.textContent = Math.ceil(game.phaseT) + "s";
      this.e.timer.style.color = "#ffb03a";
    } else if (phase === "live") {
      if (game.bomb.state === "planted") {
        this.e.timer.textContent = Math.max(0, game.bomb.timer).toFixed(1);
        this.e.timer.style.color = "#ff5a4a";
      } else {
        const t = Math.max(0, Math.ceil(game.timeLeft));
        this.e.timer.textContent = Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0");
        this.e.timer.style.color = t <= 10 ? "#ff5a4a" : "#e8e4d8";
      }
    } else {
      this.e.timer.textContent = phase === "end" ? game.roundEndReason : "—";
    }
    this.e["score-t"].textContent = game.score.T;
    this.e["score-ct"].textContent = game.score.CT;
    this.e["round-info"].textContent = `第 ${game.round} 回合 · 先到 ${game.settings?.roundsWin ?? 8} 胜`;

    // 炸弹状态
    const b = game.bomb;
    if (b.state === "planted") {
      this.e["bomb-status"].classList.remove("hidden");
      this.e["bomb-status"].innerHTML = "💣 C4 已安放";
      this.e["c4-hud"].classList.remove("hidden");
      this.e["c4-state"].textContent = game.bomb.defuser ? "拆除中…" : `爆炸倒计时 ${Math.max(0, b.timer).toFixed(0)}s`;
    } else if (b.state === "carried" || b.state === "dropped") {
      this.e["bomb-status"].classList.remove("hidden");
      this.e["bomb-status"].innerHTML = b.state === "carried" ? `💣 ${b.carrier === p ? "你携带 C4" : b.carrier?.name + " 携带 C4"}` : "💣 C4 掉落";
      this.e["c4-hud"].classList.add("hidden");
    } else {
      this.e["bomb-status"].classList.add("hidden");
      this.e["c4-hud"].classList.add("hidden");
    }
    if (p && p.bombCarrier) this.e["c4-hud"].classList.remove("hidden");
    if (p && p.bombCarrier && b.state === "carried") this.e["c4-state"].textContent = "按 E 在包点安放";

    // 生命/护甲
    if (p) {
      this.e["hp-fill"].style.width = p.hp + "%";
      this.e["hp-num"].textContent = Math.round(p.hp);
      this.e["armor-fill"].style.width = (p.armor || 0) + "%";
      this.e["armor-num"].textContent = Math.round(p.armor || 0);
      this.e.money.textContent = p.money;
      const ammo = p.getAmmoText();
      const wName = p.weaponDef()?.name ?? (p.current === "knife" ? "战术刀" : NADES[p.weaponId()]?.name ?? "");
      this.e["ammo-weapon"].textContent = wName;
      this.e["ammo-count"].textContent = `${ammo.mag} / ${ammo.reserve}`;
      this.e["ammo-count"].classList.toggle("low", typeof ammo.mag === "number" && ammo.mag < 8);
      // 道具栏
      this.renderInv(p);
    }

    // 队友栏
    this.renderTeamStrip(game);

    // 闪光
    const blind = p ? p.flashBlind : 0;
    this.e["flash-overlay"].style.opacity = clamp(blind / 4, 0, 0.96);

    // 受伤/低血
    const dmgAge = game.time - this.dmgFlashT;
    this.e["damage-vignette"].style.opacity = clamp(1 - dmgAge / 0.6, 0, 0.9);
    const lowHp = p && p.hp > 0 && p.hp <= 25 && p.alive;
    this.e["lowhp-vignette"].style.opacity = lowHp ? 0.5 + Math.sin(game.time * 5) * 0.3 : 0;

    // 开镜
    const def = p?.weaponDef();
    const scoped = p && def?.zoom && p.zoomT > 0.6 && p.alive;
    document.body.classList.toggle("scoped", !!scoped);
    // 准星扩散
    if (p && p.alive && !scoped) {
      const spd = Math.hypot(p.vel.x, p.vel.z);
      const spread = clamp(p.bloom * 1.6 + spd * 0.14, 0, 1);
      this.e.crosshair.style.transform = `translate(-50%,-50%) scale(${1 + spread * 1.4})`;
      this.e.crosshair.classList.toggle("ch-spread", spread > 0.6);
      this.e.crosshair.style.display = "";
    } else {
      this.e.crosshair.style.display = "none";
    }

    // 命中反馈
    if (game.time - this.lastHitT < 0.12) {
      this.e.hitmarker.style.opacity = 1;
    } else this.e.hitmarker.style.opacity = 0;
    if (game.time - this.killPanelT < 2.8) {
      this.e.killpanel.classList.remove("hidden");
    } else this.e.killpanel.classList.add("hidden");

    // 中心/提示消息
    this.e["center-message"].classList.toggle("show", game.time - this.centerMsgT < this.centerMsgDur);
    this.e["alert-message"].classList.toggle("show", game.time - this.alertT < 2.6);

    // 观战
    if (!p.alive && phase === "live") {
      this.e["spectate-bar"].classList.remove("hidden");
      this.e["spec-name"].textContent = "观战：" + (game.specTarget?.name ?? "—");
    } else this.e["spectate-bar"].classList.add("hidden");

    // 提示行
    let hint = "";
    if (phase === "buy") {
      hint = "按 B 打开购买菜单 · 冻结时间结束前购买";
      this.e["hint-line"].classList.add("show");
    } else if (phase === "live" && p.alive) {
      hint = "";
      if (b.state === "carried" && p.bombCarrier) hint = "到达包点后按 E 安放 C4";
      else if (b.state === "planted" && p.team === "CT") hint = "靠近 C4 按 E 拆除炸弹";
      this.e["hint-line"].classList.toggle("show", !!hint);
    } else {
      this.e["hint-line"].classList.remove("show");
    }
    this.e["hint-line"].textContent = hint;

    // 雷达
    this.drawRadar(game);
  }

  renderInv(p) {
    const slots = [];
    const mk = (key, label, sel) => ({ key, label, sel });
    if (p.weapons.primary) slots.push(mk("primary", WEAPONS[p.weapons.primary.id].name, p.current === "primary"));
    slots.push(mk("secondary", WEAPONS[p.weapons.secondary.id].name, p.current === "secondary"));
    slots.push(mk("knife", "刀", p.current === "knife"));
    for (const t of ["he", "flash", "smoke", "molotov"]) {
      if (p.nades[t] > 0) slots.push(mk("nade:" + t, `${NADES[t].name}×${p.nades[t]}`, p.current === "nade:" + t));
    }
    this.e["inv-box"].innerHTML = "";
    slots.forEach((s) => {
      const div = document.createElement("div");
      div.className = "inv-slot" + (s.sel ? " sel" : "");
      div.textContent = s.label;
      this.e["inv-box"].appendChild(div);
    });
  }

  renderTeamStrip(game) {
    const mine = game.players.filter((p) => p.team === game.human.team);
    this.e["team-strip"].innerHTML = "";
    for (const p of mine) {
      const chip = document.createElement("div");
      chip.className = "team-chip" + (p === game.human ? " me" : "") + (p.alive ? "" : " dead");
      const col = TEAM_COLORS[p.team].ui;
      chip.innerHTML = `<span class="tname" style="color:${p === game.human ? "#9df0a8" : col}">${p.name}${p.bombCarrier ? " 💣" : ""}</span>
        <span class="k">K ${p.kills}</span><span class="d">D ${p.deaths}</span>
        <span class="hp">${p.alive ? Math.round(p.hp) + "HP" : "阵亡"}</span>`;
      this.e["team-strip"].appendChild(chip);
    }
  }

  // -------------------------------------------------------------------------
  killfeed(msg) {
    const item = document.createElement("div");
    item.className = "kf-item" + (msg.head ? " hs" : "");
    item.innerHTML = `<span class="killer">${escapeHtml(msg.killer)}</span>
      <span class="wep">[${escapeHtml(msg.weapon)}${msg.head ? " ☠" : ""}]</span>
      <span class="victim">${escapeHtml(msg.victim)}</span>`;
    this.e.killfeed.prepend(item);
    while (this.e.killfeed.children.length > 6) this.e.killfeed.lastChild.remove();
  }
  clearKillfeed() { this.e.killfeed.innerHTML = ""; }
  centerMessage(text, dur = 2) {
    this.e["center-message"].textContent = text;
    this.centerMsgT = this.game.time;
    this.centerMsgDur = dur;
  }
  alert(text) {
    if (!text) return;
    this.e["alert-message"].textContent = text;
    this.alertT = this.game.time;
  }
  damageFlash() { this.dmgFlashT = this.game.time; }
  hitmarker(head) {
    this.lastHitT = this.game.time;
    this.e.hitmarker.classList.toggle("kill", !!head);
  }
  damageDir(fromPos, myPos) {
    const p = this.game.human;
    const dx = fromPos.x - myPos.x, dz = fromPos.z - myPos.z;
    // 转换到玩家局部坐标系：right=(cos yaw,0,-sin yaw)，前方=-Z
    const rx = dx * Math.cos(p.yaw) + dz * -Math.sin(p.yaw);
    const rz = dx * -Math.sin(p.yaw) + dz * -Math.cos(p.yaw);
    const dir = Math.atan2(rx, -rz);
    this.e["damage-dir"].style.transform = `translate(-50%,-50%) rotate(${dir}rad)`;
    this.e["damage-dir"].style.opacity = 1;
    setTimeout(() => { this.e["damage-dir"].style.opacity = 0; }, 350);
  }
  killPanel(victim, head, dmg) {
    this.e["killpanel-name"].textContent = `${victim.name} ${head ? "爆头击杀" : "击杀"} · 造成 ${Math.round(dmg)} 伤害`;
    this.e["killpanel-detail"].textContent = `剩余生命 0 · +$${victim.money}`;
    this.killPanelT = this.game.time;
  }
  showSpectate(name) { this.e["spec-name"].textContent = "观战：" + name; }

  showScoreboard(game) {
    this.e.scoreboard.classList.remove("hidden");
    const fill = (el, team) => {
      const rows = game.players.filter((p) => p.team === team)
        .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
      let html = "<tr><td>玩家</td><td class='num'>击杀</td><td class='num'>死亡</td><td class='num'>金钱</td></tr>";
      for (const p of rows) {
        html += `<tr class="${p === game.human ? "me" : ""} ${p.alive ? "" : "dead"}">
          <td>${p === game.human ? "▶ " : ""}${escapeHtml(p.name)}${p.bombCarrier ? " 💣" : ""}</td>
          <td class="num">${p.kills}</td><td class="num">${p.deaths}</td><td class="num">$${p.money}</td></tr>`;
      }
      el.querySelector("table").innerHTML = html;
    };
    fill($("sb-t"), "T");
    fill($("sb-ct"), "CT");
  }
  hideScoreboard() { this.e.scoreboard.classList.add("hidden"); }

  showMatchEnd(game) {
    const s = game.matchStats;
    this.e["match-end-title"].textContent = (s.winner === game.human.team ? "胜利！" : "战败") +
      ` — ${s.winner === "T" ? "恐怖分子" : "反恐精英"} 获胜`;
    const rows = [...game.players].sort((a, b) => b.mvpScore - a.mvpScore);
    let html = `<div>MVP：<span class="mvp">${s.mvp.name}</span>（评分 ${s.mvp.mvpScore}）</div><div>`;
    html += rows.map((p, i) => `${i + 1}. ${escapeHtml(p.name)} — ${p.kills} 杀 ${p.deaths} 死`).join("<br>");
    html += "</div>";
    this.e["match-end-stats"].innerHTML = html;
    this.e["match-end"].classList.remove("hidden");
    document.exitPointerLock?.();
  }

  showPause() {
    this.e["pause-menu"].classList.remove("hidden");
  }
  showMainMenu() {
    this.show($("main-menu"));
    this.hide($("pause-menu"));
    this.hide($("match-end"));
    this.e.hud.classList.add("hidden");
    document.body.classList.remove("scoped");
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
