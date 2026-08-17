// weapons_data.js — weapon catalog, grenade defs, equipment prices
// cat: pistol|smg|rifle|sniper|shotgun|knife|grenade|gear
// dmg is base body damage at close range; hs multiplier applied for headshots
export const WEAPONS = {
  knife:   { name:'刀', cat:'knife', price:0, dmg:55, rate:2.2, mag:0, reserve:0, reload:0, snd:'pistol', move:1.0, slot:3 },

  // Pistols
  glock:   { name:'Glock-18', cat:'pistol', price:0, dmg:28, rate:6.5, mag:20, reserve:120, reload:2.0, spread:0.012, recoil:0.9, adsFov:70, snd:'pistol', move:1.0, kill:300, armorPen:0.55, team:'T', slot:1 },
  usp:     { name:'USP-S', cat:'pistol', price:0, dmg:35, rate:5.5, mag:12, reserve:100, reload:2.1, spread:0.009, recoil:0.85, adsFov:70, snd:'pistol', move:1.0, kill:300, armorPen:0.5, team:'CT', slot:1 },
  p250:    { name:'P250', cat:'pistol', price:300, dmg:38, rate:6.0, mag:13, reserve:26, reload:2.2, spread:0.011, recoil:1.0, adsFov:70, snd:'pistol', move:1.0, kill:300, armorPen:0.64, slot:1 },
  fiveseven:{name:'Five-SeveN', cat:'pistol', price:500, dmg:32, rate:6.2, mag:20, reserve:100, reload:2.3, spread:0.010, recoil:0.9, adsFov:70, snd:'pistol', move:1.0, kill:300, armorPen:0.85, slot:1 },
  deagle:  { name:'沙鹰', cat:'pistol', price:700, dmg:63, rate:3.1, mag:7, reserve:35, reload:2.3, spread:0.02, recoil:2.6, adsFov:65, snd:'pistol', move:0.98, kill:300, armorPen:0.93, slot:1 },

  // SMGs
  mp9:     { name:'MP9', cat:'smg', price:1250, dmg:26, rate:13.3, mag:30, reserve:120, reload:2.1, spread:0.02, recoil:1.0, adsFov:75, snd:'smg', move:1.02, kill:600, armorPen:0.6, auto:true, slot:1 },
  mp5:     { name:'MP5-SD', cat:'smg', price:1500, dmg:27, rate:12.5, mag:30, reserve:120, reload:2.3, spread:0.018, recoil:1.05, adsFov:75, snd:'smg', move:1.0, kill:600, armorPen:0.6, auto:true, slot:1 },
  p90:     { name:'P90', cat:'smg', price:2350, dmg:26, rate:14.3, mag:50, reserve:100, reload:3.3, spread:0.024, recoil:1.1, adsFov:75, snd:'smg', move:1.0, kill:300, armorPen:0.69, auto:true, slot:1 },

  // Rifles
  galil:   { name:'Galil AR', cat:'rifle', price:1800, dmg:30, rate:11.1, mag:35, reserve:90, reload:3.0, spread:0.02, recoil:1.5, adsFov:60, snd:'rifle', move:0.97, kill:300, armorPen:0.775, auto:true, team:'T', slot:2 },
  famas:   { name:'FAMAS', cat:'rifle', price:2050, dmg:30, rate:10.6, mag:25, reserve:90, reload:3.3, spread:0.019, recoil:1.4, adsFov:60, snd:'rifle', move:0.97, kill:300, armorPen:0.7, auto:true, team:'CT', slot:2 },
  ak47:    { name:'AK-47', cat:'rifle', price:2700, dmg:36, rate:10.0, mag:30, reserve:90, reload:2.5, spread:0.018, recoil:2.0, adsFov:58, snd:'rifle', move:0.95, kill:300, armorPen:0.775, auto:true, hs:4.0, team:'T', slot:2 },
  m4a4:    { name:'M4A4', cat:'rifle', price:2900, dmg:33, rate:10.9, mag:30, reserve:90, reload:3.1, spread:0.016, recoil:1.7, adsFov:58, snd:'rifle', move:0.95, kill:300, armorPen:0.7, auto:true, hs:4.0, team:'CT', slot:2 },
  aug:     { name:'AUG', cat:'rifle', price:3300, dmg:33, rate:10.0, mag:30, reserve:90, reload:3.0, spread:0.014, recoil:1.5, adsFov:40, scoped:true, snd:'rifle', move:0.95, kill:300, armorPen:0.9, auto:true, slot:2 },

  // Snipers
  ssg08:   { name:'SSG 08', cat:'sniper', price:1700, dmg:88, rate:1.6, mag:10, reserve:90, reload:3.0, spread:0.002, recoil:2.0, adsFov:28, scoped:true, snd:'sniper', move:1.0, kill:300, armorPen:0.85, slot:2 },
  awp:     { name:'AWP', cat:'sniper', price:4750, dmg:115, rate:0.9, mag:10, reserve:30, reload:3.7, spread:0.001, recoil:3.5, adsFov:20, scoped:true, snd:'sniper', move:0.86, kill:100, armorPen:0.975, oneshot:true, slot:2 },

  // Shotguns
  nova:    { name:'Nova', cat:'shotgun', price:1050, dmg:26, rate:1.2, mag:8, reserve:32, reload:0.5, spread:0.06, recoil:2.2, adsFov:70, snd:'shotgun', move:0.94, kill:900, armorPen:0.5, pellets:9, slot:2 },
  xm1014:  { name:'XM1014', cat:'shotgun', price:2000, dmg:20, rate:3.3, mag:7, reserve:32, reload:0.5, spread:0.055, recoil:1.8, adsFov:70, snd:'shotgun', move:0.94, kill:900, armorPen:0.5, pellets:6, auto:true, slot:2 },
};

// Grenades (thrown). fuse: seconds until effect (0 => impact for molotov handled specially)
export const GRENADES = {
  he:     { name:'高爆手雷', price:300, fuse:1.6, radius:8, dmg:98, kind:'he', color:0x2e5d34, key:'4' },
  flash:  { name:'闪光弹', price:200, fuse:1.5, radius:11, kind:'flash', color:0xd8d8d8, key:'5' },
  smoke:  { name:'烟雾弹', price:300, fuse:1.5, radius:7, kind:'smoke', color:0xcccccc, key:'6' },
  molotov:{ name:'燃烧瓶', price:400, fuse:0, radius:6, dmg:8, kind:'fire', color:0xdd5522, key:'7' },
};

export const GEAR = {
  kevlar:   { name:'防弹衣', price:650, kind:'armor', armor:100 },
  kevlarhelm:{ name:'防弹衣+头盔', price:1000, kind:'armorhelm', armor:100 },
  defuse:   { name:'拆弹器', price:400, kind:'defuse' },
};

export function defaultPistol(team) { return team === 'T' ? 'glock' : 'usp'; }

// Buy menu categories -> item lists (per team where relevant)
export function buyCatalog(team) {
  return [
    { title:'手枪', items:['p250','fiveseven','deagle'] },
    { title:'冲锋枪', items:['mp9','mp5','p90'] },
    { title: team==='T' ? '步枪 / 狙击' : '步枪 / 狙击', items: team==='T' ? ['galil','ak47','ssg08','awp'] : ['famas','m4a4','aug','ssg08','awp'] },
    { title:'霰弹 / 装备 / 投掷', items:['nova','xm1014','kevlar','kevlarhelm','defuse','he','flash','smoke','molotov'] },
  ];
}
