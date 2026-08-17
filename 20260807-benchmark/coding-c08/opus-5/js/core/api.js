// ============================================================================
// api.js — the integration contract for the whole game.
//
// It holds the two registries that several modules must agree on (sound names
// and weapon ids) plus the JSDoc typedefs describing every cross-module
// interface.  Tests assert that audio.js implements every SOUND and that
// weapons.js defines every WEAPON_ID, which is what keeps the modules honest.
// ============================================================================

export const API_VERSION = 1;

/** Every sound name the game may ask for. engine/audio.js must synthesize all. */
export const SOUNDS = [
  // gunfire (per archetype) + distance variants are handled inside audio.js
  'shoot_pistol', 'shoot_pistol_big', 'shoot_silenced', 'shoot_smg', 'shoot_rifle',
  'shoot_ak', 'shoot_m4', 'shoot_awp', 'shoot_scout', 'shoot_shotgun', 'shoot_auto',
  'dryfire', 'knife_swing', 'knife_hit', 'knife_stab',
  // handling
  'reload_mag_out', 'reload_mag_in', 'reload_bolt', 'reload_shell', 'reload_pump',
  'deploy', 'holster', 'zoom_in', 'zoom_out',
  // movement
  'step_sand', 'step_concrete', 'step_metal', 'step_wood', 'step_dirt', 'step_tile',
  'land_soft', 'land_hard', 'jump', 'ladder',
  // impacts / flesh
  'hit_flesh', 'hit_kevlar', 'hit_helmet', 'headshot', 'death', 'death_headshot',
  'impact_concrete', 'impact_metal', 'impact_wood', 'impact_dirt', 'impact_glass',
  'ricochet', 'whizz', 'penetrate',
  // grenades
  'nade_pin', 'nade_throw', 'nade_bounce', 'explode_he', 'explode_flash', 'flash_ring',
  'smoke_pop', 'smoke_hiss', 'molly_ignite', 'fire_loop',
  // objective
  'bomb_plant_start', 'bomb_plant_done', 'bomb_beep', 'bomb_beep_fast', 'bomb_pickup',
  'defuse_loop', 'defuse_done', 'bomb_explode', 'c4_drop',
  // match / ui
  'round_start', 'round_freeze', 'ten_seconds', 'ct_win', 't_win', 'match_win', 'match_lose',
  'buy', 'buy_fail', 'pickup', 'ui_click', 'ui_hover', 'ui_back',
  'hitmarker', 'killsound', 'radio_beep', 'tinnitus', 'ambient_wind', 'ambient_room',
];

/** Every weapon / equipment id. game/weapons.js must define all of them. */
export const WEAPON_IDS = [
  // knife + bomb
  'knife', 'c4',
  // pistols
  'glock', 'usp', 'p250', 'deagle', 'tec9', 'fiveseven', 'dualies',
  // smg
  'mac10', 'mp9', 'mp5', 'ump45', 'p90',
  // rifles
  'galil', 'famas', 'ak47', 'm4a4', 'm4a1s', 'aug', 'sg553',
  // snipers
  'ssg08', 'awp',
  // heavy
  'nova', 'xm1014', 'mag7', 'negev',
  // grenades
  'he', 'flash', 'smoke', 'molotov', 'incendiary', 'decoy',
  // gear (bought, not held)
  'kevlar', 'kevlarhelmet', 'defusekit',
];

/** Viewmodel archetypes render/viewmodel.js must be able to build. */
export const VM_ARCHETYPES = [
  'pistol', 'pistol_big', 'pistol_silenced', 'smg', 'smg_boxy', 'rifle_ak', 'rifle_m4',
  'rifle_bullpup', 'sniper_bolt', 'sniper_awp', 'shotgun_pump', 'shotgun_auto', 'lmg',
  'knife', 'grenade', 'c4',
];

// ---------------------------------------------------------------------------
// Typedefs — the shape of every object passed between modules.
// ---------------------------------------------------------------------------
/**
 * @typedef {Object} Brush  A single convex world primitive (maps/kit.js output).
 * @property {'box'|'ramp'|'cyl'} kind
 * @property {{x:number,y:number,z:number}} min  world-space AABB lower corner
 * @property {{x:number,y:number,z:number}} max  world-space AABB upper corner
 * @property {string} mat            MAT.* id
 * @property {boolean} solid         blocks movement
 * @property {boolean} sight         blocks bullets and line of sight
 * @property {boolean} visible       drawn (false ⇒ invisible clip brush)
 * @property {{axis:'x'|'z',lo:number,hi:number}} [ramp] walkable slope: surface
 *           height goes from `lo` at min[axis] to `hi` at max[axis]
 * @property {{r:number,seg:number,axis:'x'|'y'|'z'}} [cyl]
 * @property {number} [uv]           texture scale override (world metres / tile)
 * @property {number} [tint]         0xrrggbb multiply
 * @property {string} [tag]          callout / debug label
 * @property {boolean} [climb]       ladder volume
 * @property {boolean} [water]
 */
/**
 * @typedef {Object} MapDef
 * @property {string} id, name, cn, desc
 * @property {Brush[]} brushes
 * @property {{T:Array<{pos:number[],yaw:number}>,CT:Array<{pos:number[],yaw:number}>}} spawns
 * @property {{A:SiteDef,B:SiteDef}} sites
 * @property {{T:Box2,CT:Box2}} buyzones
 * @property {{nodes:NavNodeDef[],links:string[][],autoLink:{maxDist:number}}} nav
 * @property {Array<{name:string,cn:string,pos:number[]}>} callouts
 * @property {MapTactics} tactics
 * @property {{sunDir:number[],sunColor:number,skyTop:number,skyBottom:number,
 *            fog:{color:number,near:number,far:number},ambient:number,exposure:number}} env
 * @property {{min:number[],max:number[]}} radar  world XZ extents drawn on the radar
 */
/**
 * @typedef {Object} SiteDef
 * @property {number[]} center   [x,y,z]
 * @property {Box2} area         plantable rectangle (XZ) — plus `yMin`,`yMax`
 * @property {Array<number[]>} plantSpots  favourite plant positions
 * @property {Array<{pos:number[],look:number[]}>} postPlant  T post-plant holds
 */
/**
 * @typedef {Object} NavNodeDef
 * @property {string} id
 * @property {number[]} p        [x,y,z] — y is floor height
 * @property {string} area       AREA.*
 * @property {string[]} [tags]   'plant' 'cover' 'hold' 'sniper' 'entry' 'jump' 'boost' 'door'
 * @property {number} [r]        radius hint
 */
/**
 * @typedef {Object} MapTactics
 * @property {{holds:Object<string,Array<HoldSpot>>,rotate:Object<string,string[]>}} CT
 * @property {{routes:Object<string,string[]>,strats:Array<StratDef>}} T
 * @property {Array<NadeLine>} nades
 * @typedef {{pos:number[],look:number[],crouch?:boolean,area:string,prio?:number}} HoldSpot
 * @typedef {{name:string,cn:string,site:'A'|'B',lanes:Object<string,number>,nades?:string[]}} StratDef
 * @typedef {{team:string,type:'smoke'|'flash'|'molotov'|'he',from:number[],to:number[],
 *            area:string,phase:'exec'|'hold'|'retake',pitchBias?:number}} NadeLine
 */
/**
 * @typedef {Object} TraceResult
 * @property {boolean} hit
 * @property {number} dist
 * @property {{x,y,z}} point
 * @property {{x,y,z}} normal
 * @property {Brush|null} brush
 * @property {string} surface  SURFACE.*
 */

/** Radio message ids bots use; ui/hud.js renders the text. */
export const RADIO = {
  needbackup: '需要支援！', enemyspotted: '发现敌人！', sectorclear: '区域安全',
  goinga: '打 A 点！', goingb: '打 B 点！', goingmid: '控中路！',
  rotate_a: 'A 点告急，回防！', rotate_b: 'B 点告急，回防！',
  planting: '正在下包！', bombplanted: '炸弹已安放！', defusing: '正在拆弹，掩护我！',
  fireinhole: '手雷出手！', flashout: '闪光弹！', smokeout: '烟雾弹！',
  gotone: '干掉一个！', taketheshot: '开枪！', regroup: '重新集合！',
  saveit: '这局保枪！', rushb: '冲 B 点！', holdpos: '守住位置！',
  imhit: '我中弹了！', coverme: '掩护我！', inposition: '已到位',
};
