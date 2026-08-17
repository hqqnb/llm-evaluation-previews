// ui.js — HUD overlay, radar, killfeed, buy menu, scoreboard, results
import { ViewModel } from './weapon_view.js';
import { WEAPONS, GRENADES, GEAR, buyCatalog } from './weapons_data.js';
import { fmtTime, dist } from './math.js';

const $ = id => document.getElementById(id);

export class HUD {
  constructor(stage) {
    this.stage = stage;
    this.vm = new ViewModel(stage.vmScene);
    this.el = {
      hud: $('hud'), scoreT: $('score-t'), scoreCT: $('score-ct'), timer: $('round-timer'),
      hp: $('hp-val'), armor: $('armor-val'), magAmmo: $('ammo-mag'), resAmmo: $('ammo-reserve'),
      wname: $('weapon-name'), money: $('money-val'), moneyHud: $('money-hud'), killfeed: $('kill-feed'),
      radar: $('radar-canvas'), inv: $('inventory-bar'), banner: $('round-banner'),
      bomb: $('bomb-status'), center: $('center-msg'), flash: $('flash-overlay'),
      vig: $('damage-vignette'), hit: $('hit-marker'), crosshair: $('crosshair'),
      hpStat: document.querySelector('.stat.health'), armorStat: document.querySelector('.stat.armor'),
    };
    this.rctx = this.el.radar.getContext('2d');
    this.buyKeyHandler = null;
    this._bannerT = 0;
  }
  show() { this.el.hud.classList.remove('hidden'); }
  hide() { this.el.hud.classList.add('hidden'); }

  showRoundBanner(text, color) {
    const b = this.el.banner; b.textContent = text; b.style.color = color || '#fff';
    b.classList.add('show'); clearTimeout(this._bt);
    this._bt = setTimeout(() => b.classList.remove('show'), 2600);
  }
  hitMarker(kill) {
    const h = this.el.hit; h.classList.remove('show', 'kill'); void h.offsetWidth;
    h.classList.add('show'); if (kill) h.classList.add('kill');
  }
  damageFlash() { this.el.vig.style.opacity = '1'; clearTimeout(this._vt); this._vt = setTimeout(() => this.el.vig.style.opacity = '0', 130); }
  dirIndicator() { /* damage vignette already shown; kept for extensibility */ }
  spectateMsg(t) { this.el.center.innerHTML = `<div class="spectate">${t}</div>`; this._specMsg = true; }
  clearCenter() { if (this._specMsg) { this.el.center.innerHTML = ''; this._specMsg = false; } }

  setBombStatus(s) {
    const b = this.el.bomb;
    if (!s) { b.classList.add('hidden'); return; }
    b.classList.remove('hidden'); b.textContent = s.txt;
    b.className = 'bomb-status' + (s.cls === 'defusing' ? ' defusing' : '');
    b.id = 'bomb-status';
    if (s.cls === 'defusing') b.classList.add('defusing'); else b.classList.remove('defusing');
    b.classList.remove('hidden');
  }
  setScope(w) {
    this.scoped = !!w;
    if (w) { this.el.crosshair.style.opacity = '0'; this.stage.renderer.domElement.style.cursor = 'none'; document.body.classList.add('scoped'); }
    else { this.el.crosshair.style.opacity = '1'; document.body.classList.remove('scoped'); }
  }

  addKill(aName, aTeam, vName, vTeam, weaponId, hs) {
    const row = document.createElement('div'); row.className = 'kf-row';
    const wn = WEAPONS[weaponId] ? WEAPONS[weaponId].name : (GRENADES[weaponId] ? GRENADES[weaponId].name : weaponId);
    row.innerHTML = `<span class="kf-${aTeam === 'T' ? 't' : 'ct'}">${aName}</span>` +
      `<span class="kf-wep">▸${wn}${hs ? ' <span class="kf-hs">HS</span>' : ''}</span>` +
      `<span class="kf-${vTeam === 'T' ? 't' : 'ct'}">${vName}</span>`;
    this.el.killfeed.appendChild(row);
    setTimeout(() => row.remove(), 5000);
    while (this.el.killfeed.children.length > 6) this.el.killfeed.firstChild.remove();
  }

  setInventory(items) {
    this.el.inv.innerHTML = items.map(it =>
      `<div class="inv-slot${it.active ? ' active' : ''}"><span class="k">${it.key}</span>${it.name}</div>`).join('');
  }
  update(s) {
    const p = s.player;
    this.el.flash.style.opacity = p.flash > 0 ? Math.min(1, p.flash / 2.4).toFixed(2) : '0';
    if (p.alive) this.clearCenter();
    this.el.hp.textContent = Math.ceil(p.health);
    this.el.hpStat.classList.toggle('low', p.health <= 30 && p.alive);
    this.el.armor.textContent = Math.ceil(p.armor) + (p.helmet && p.armor > 0 ? '⛑' : '');
    const w = p.weapon();
    if (p.slot === 'g') { this.el.magAmmo.textContent = p.inv.grenades.length; this.el.resAmmo.textContent = ''; this.el.wname.textContent = GRENADES[p.curNade] ? GRENADES[p.curNade].name : '投掷物'; }
    else if (w.cat === 'knife') { this.el.magAmmo.textContent = '∞'; this.el.resAmmo.textContent = ''; this.el.wname.textContent = '刀'; }
    else { this.el.magAmmo.textContent = p.ammo[p.current]; this.el.resAmmo.textContent = p.reserve[p.current]; this.el.wname.textContent = w.name; }
    const money = Math.round(p.money || 0);
    if (this._lastMoney !== undefined && money > this._lastMoney) { this.el.moneyHud.classList.remove('gain'); void this.el.moneyHud.offsetWidth; this.el.moneyHud.classList.add('gain'); }
    this._lastMoney = money; this.el.money.textContent = money;
    this.el.timer.textContent = s.freeze > 0 ? fmtTime(s.freeze) : fmtTime(s.timer);
    this.el.timer.classList.toggle('low', (s.bombPlanted || s.timer < 20) && s.freeze <= 0);
    this.el.scoreT.textContent = s.scoreT; this.el.scoreCT.textContent = s.scoreCT;
    this.drawRadar(s);
  }
  drawRadar(s) {
    const ctx = this.rctx, size = this.el.radar.width, pad = 18;
    const b = s.bounds, w = b.maxX - b.minX, h = b.maxZ - b.minZ;
    const scale = (size - pad * 2) / Math.max(w, h);
    const ox = (size - w * scale) / 2, oy = (size - h * scale) / 2;
    const map = (x, z) => ({ x: ox + (x - b.minX) * scale, y: size - (oy + (z - b.minZ) * scale) });
    ctx.fillStyle = '#0e1319'; ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#1e2732'; ctx.lineWidth = 1;
    for (let gx = 0; gx <= size; gx += size / 6) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, size); ctx.moveTo(0, gx); ctx.lineTo(size, gx); ctx.stroke(); }
    ctx.textAlign = 'center';
    for (const k of ['A', 'B']) {
      const st = s.bombsites[k]; if (!st) continue; const m = map(st.x, st.z);
      ctx.beginPath(); ctx.arc(m.x, m.y, st.r * scale, 0, 7); ctx.fillStyle = '#e0a83a22'; ctx.fill();
      ctx.strokeStyle = '#e0a83a88'; ctx.stroke();
      ctx.fillStyle = '#e0a83a'; ctx.font = 'bold 13px monospace'; ctx.fillText(k, m.x, m.y + 4);
    }
    const p = s.player;
    if (s.bombPos) { const m = map(s.bombPos.x, s.bombPos.z); ctx.fillStyle = s.bombPlanted ? '#ff3322' : '#ffcc33'; ctx.fillRect(m.x - 3, m.y - 3, 6, 6); }
    for (const e of s.entities) {
      if (!e.alive || e === p) continue;
      const own = e.team === s.playerTeam;
      if (!own && !(s.spotted && s.spotted.has(e.id))) continue;
      const m = map(e.pos.x, e.pos.z);
      ctx.beginPath(); ctx.arc(m.x, m.y, 4, 0, 7);
      ctx.fillStyle = own ? '#4f9fe0' : '#e05a4f'; ctx.fill();
    }
    if (p.alive) {
      const m = map(p.pos.x, p.pos.z);
      const ahead = map(p.pos.x - Math.sin(p.yaw) * 4, p.pos.z - Math.cos(p.yaw) * 4);
      ctx.strokeStyle = '#6fe36f'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(ahead.x, ahead.y); ctx.stroke();
      ctx.fillStyle = '#6fe36f'; ctx.beginPath(); ctx.arc(m.x, m.y, 4.5, 0, 7); ctx.fill();
    }
  }
  openBuy(show, game) {
    const menu = $('buy-menu');
    if (!show) { menu.classList.add('hidden'); if (this.buyKeyHandler) { window.removeEventListener('keydown', this.buyKeyHandler); this.buyKeyHandler = null; } return; }
    menu.classList.remove('hidden');
    this.buildBuy(game);
    $('buy-close').onclick = () => game.toggleBuy(false);
  }
  buildBuy(game) {
    const p = game.player; const cats = buyCatalog(p.team);
    const cols = $('buy-columns'); cols.innerHTML = ''; this.flatBuy = [];
    for (const cat of cats) {
      const col = document.createElement('div'); col.className = 'buy-col';
      col.innerHTML = `<h4>${cat.title}</h4>`;
      for (const id of cat.items) {
        const price = this.priceLabel(id), name = this.itemName(id);
        const idx = this.flatBuy.length + 1; this.flatBuy.push(id);
        const owned = this.ownsItem(p, id), afford = (p.money || 0) >= price;
        const div = document.createElement('div');
        div.className = 'buy-item' + (owned ? ' owned' : '') + (!afford && !owned ? ' cant' : '');
        div.innerHTML = `<span class="bi-name"><span class="bi-key">${idx <= 9 ? idx : ''}</span>${name}</span><span class="bi-price">$${price}</span>`;
        div.onclick = () => game.attemptBuy(id);
        col.appendChild(div);
      }
      cols.appendChild(col);
    }
    $('buy-money').textContent = Math.round(p.money || 0);
    this.refreshOwned(p);
    if (this.buyKeyHandler) window.removeEventListener('keydown', this.buyKeyHandler);
    this.buyKeyHandler = (e) => { const n = parseInt(e.key); if (n >= 1 && n <= 9 && this.flatBuy[n - 1]) game.attemptBuy(this.flatBuy[n - 1]); };
    window.addEventListener('keydown', this.buyKeyHandler);
  }
  refreshBuy(game) { this.buildBuy(game); }
  buyMsg(t) { this._buyMsg = t; const el = $('buy-owned'); if (el) el.textContent = t; }
  refreshOwned(p) {
    const inv = []; if (p.inv[2]) inv.push(WEAPONS[p.inv[2]].name); inv.push(WEAPONS[p.inv[1]].name);
    if (p.armor > 0) inv.push(p.helmet ? '甲+盔' : '护甲'); if (p.defuseKit) inv.push('拆弹器');
    if (p.inv.grenades.length) inv.push(...p.inv.grenades.map(g => GRENADES[g].name));
    $('buy-owned').textContent = '已持有: ' + inv.join(' · ');
  }
  itemName(id) { return (WEAPONS[id] && WEAPONS[id].name) || (GRENADES[id] && GRENADES[id].name) || (GEAR[id] && GEAR[id].name) || id; }
  priceLabel(id) { const v = WEAPONS[id] ? WEAPONS[id].price : GRENADES[id] ? GRENADES[id].price : GEAR[id] ? GEAR[id].price : 0; return v; }
  ownsItem(p, id) {
    if (WEAPONS[id]) return p.inv[WEAPONS[id].slot] === id;
    if (id === 'defuse') return p.defuseKit;
    if (id === 'kevlar') return p.armor > 0 && !p.helmet;
    if (id === 'kevlarhelm') return p.armor > 0 && p.helmet;
    if (GRENADES[id]) return p.inv.grenades.includes(id);
    return false;
  }

  toggleScoreboard(show, game) {
    const sb = $('scoreboard'); if (!show) { sb.classList.add('hidden'); return; }
    sb.classList.remove('hidden'); this.buildScoreboard(game);
  }
  buildScoreboard(g) {
    $('sb-map').textContent = g.mapData.displayName;
    $('sb-score').textContent = `T ${g.scoreT} : ${g.scoreCT} CT`;
    const head = '<div class="sb-row"><span class="sb-h">玩家</span><span class="sb-h">K</span><span class="sb-h">D</span><span class="sb-h">$</span></div>';
    const rows = team => g.entities.filter(e => e.team === team).sort((a, b) => (b.kills || 0) - (a.kills || 0))
      .map(e => `<div class="sb-row ${e === g.player ? 'me' : ''} ${e.alive ? '' : 'dead'}"><span>${e.name}</span><span>${e.kills || 0}</span><span>${e.deaths || 0}</span><span>$${Math.round(e.money || 0)}</span></div>`).join('');
    $('sb-t-rows').innerHTML = head + rows('T');
    $('sb-ct-rows').innerHTML = head + rows('CT');
  }

  showResults(win, scoreT, scoreCT, mvp) {
    $('results-menu').classList.remove('hidden');
    const t = $('result-title'); t.textContent = win ? '胜利' : '失败'; t.className = win ? 'win' : 'lose';
    $('result-score').textContent = `T ${scoreT} : ${scoreCT} CT`;
    $('result-mvp').textContent = `MVP: ${mvp.name} · ${mvp.kills || 0} 击杀`;
  }
  hideResults() { $('results-menu').classList.add('hidden'); }
}
