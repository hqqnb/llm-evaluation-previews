// economy.js — money, rewards, purchase validation, bot buy logic
import { WEAPONS, GRENADES, GEAR } from './weapons_data.js';
import { choice } from './math.js';

export const START_MONEY = 800;
export const MAX_MONEY = 16000;
export const WIN_REWARD = 3250;
export const PLANT_TEAM = 800;        // team-wide (applied to T on plant)
export const PLANT_PERSONAL = 300;
export const DEFUSE_PERSONAL = 300;
export const LOSS_BONUS = [1400, 1900, 2400, 2900, 3400];

export function lossReward(streak) { return LOSS_BONUS[Math.min(streak, LOSS_BONUS.length - 1)]; }
export function clampMoney(m) { return Math.max(0, Math.min(MAX_MONEY, m)); }

export function priceOf(id) {
  if (WEAPONS[id]) return WEAPONS[id].price;
  if (GRENADES[id]) return GRENADES[id].price;
  if (GEAR[id]) return GEAR[id].price;
  return 0;
}

// Attempt a purchase for the human player. Returns {ok, msg}
export function buyItem(p, id) {
  const price = priceOf(id);
  if (WEAPONS[id]) {
    const w = WEAPONS[id];
    if (w.team && w.team !== p.team) return { ok: false, msg: '该武器不属于你的阵营' };
    if (p.inv[w.slot] === id) return { ok: false, msg: '已拥有' };
    if (p.money < price) return { ok: false, msg: '金钱不足' };
    p.money -= price; p.giveWeapon(id);
    return { ok: true };
  }
  if (GEAR[id]) {
    const g = GEAR[id];
    if (g.kind === 'defuse') {
      if (p.team !== 'CT') return { ok: false, msg: '仅 CT 可购买拆弹器' };
      if (p.defuseKit) return { ok: false, msg: '已拥有' };
      if (p.money < price) return { ok: false, msg: '金钱不足' };
      p.money -= price; p.defuseKit = true; return { ok: true };
    }
    // armor
    const wantHelm = g.kind === 'armorhelm';
    if (p.armor >= 100 && p.helmet === wantHelm) return { ok: false, msg: '已拥有' };
    if (p.money < price) return { ok: false, msg: '金钱不足' };
    p.money -= price; p.giveArmor(wantHelm); return { ok: true };
  }
  if (GRENADES[id]) {
    if (p.money < price) return { ok: false, msg: '金钱不足' };
    if (!p.giveGrenade(id)) return { ok: false, msg: '该投掷物已达上限' };
    p.money -= price; return { ok: true };
  }
  return { ok: false, msg: '未知物品' };
}

// Bot auto-buy: choose a loadout given money & difficulty. Returns {loadout, spent}
export function botBuy(money, team, diffName) {
  const l = { weapon: team === 'T' ? 'glock' : 'usp', armor: 0, helmet: false, grenades: [], defuse: false };
  let spent = 0;
  const buy = (id) => { const c = priceOf(id); if (money - spent >= c) { spent += c; return true; } return false; };

  const rich = money >= 4000;
  const eco = money < 2200;
  if (eco) {
    // light buy: maybe armor + pistol upgrade
    if (money >= 1650 && buy('kevlar')) l.armor = 100;
    if (money - spent >= 700 && Math.random() < 0.5 && buy('deagle')) l.weapon = 'deagle';
    return { loadout: l, spent };
  }
  // full buy: armor+helmet first
  if (buy('kevlarhelm')) { l.armor = 100; l.helmet = true; }
  // primary
  const rifles = team === 'T' ? ['ak47', 'galil'] : ['m4a4', 'famas'];
  let primary = null;
  if (rich && Math.random() < 0.22 && buy('awp')) primary = 'awp';
  else if (buy(rifles[0])) primary = rifles[0];
  else if (buy(rifles[1])) primary = rifles[1];
  else if (buy('mp9')) primary = 'mp9';
  if (primary) l.weapon = primary;
  // secondary pistol upgrade
  if (money - spent >= 500 && Math.random() < 0.3) buy('p250');
  // nades
  const nadePool = ['he', 'flash', 'smoke', 'flash'];
  while (money - spent >= 300 && l.grenades.length < 3 && Math.random() < 0.7) {
    const n = choice(nadePool);
    if ((n === 'he' && l.grenades.includes('he'))) break;
    if (buy(n)) l.grenades.push(n); else break;
  }
  if (team === 'CT' && money - spent >= 400 && Math.random() < 0.5 && buy('defuse')) l.defuse = true;
  return { loadout: l, spent };
}
