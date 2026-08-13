// ============================================================================
// 程序化模型：第一人称枪械视图模型、士兵角色、炸弹与投掷物
// ============================================================================

import * as THREE from "three";
import { getMaterial } from "./materials.js";

// ---------- 材质 ----------
const MAT = {
  steel: new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.42, metalness: 0.85 }),
  steelDark: new THREE.MeshStandardMaterial({ color: 0x1a1d21, roughness: 0.5, metalness: 0.8 }),
  steelLight: new THREE.MeshStandardMaterial({ color: 0x6a7076, roughness: 0.35, metalness: 0.9 }),
  polymer: new THREE.MeshStandardMaterial({ color: 0x25282c, roughness: 0.62, metalness: 0.25 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x6d4a28, roughness: 0.7, metalness: 0.05 }),
  woodDark: new THREE.MeshStandardMaterial({ color: 0x4a3320, roughness: 0.7, metalness: 0.05 }),
  glove: new THREE.MeshStandardMaterial({ color: 0x33383a, roughness: 0.9, metalness: 0 }),
  sleeve: new THREE.MeshStandardMaterial({ map: getMaterial("camoT").map, color: 0xffffff, roughness: 0.95 }),
  scope: new THREE.MeshStandardMaterial({ color: 0x0a0c0e, roughness: 0.25, metalness: 0.9 }),
  red: new THREE.MeshStandardMaterial({ color: 0x9a2820, roughness: 0.5, metalness: 0.4 }),
  green: new THREE.MeshStandardMaterial({ color: 0x3a5a28, roughness: 0.5, metalness: 0.4 }),
  olive: new THREE.MeshStandardMaterial({ color: 0x4c4a32, roughness: 0.55, metalness: 0.3 }),
  tan: new THREE.MeshStandardMaterial({ color: 0x8a7448, roughness: 0.6, metalness: 0.2 }),
  skin: new THREE.MeshStandardMaterial({ map: getMaterial("skin").map, color: 0xffffff, roughness: 0.85 }),
  black: new THREE.MeshStandardMaterial({ color: 0x101214, roughness: 0.5, metalness: 0.6 }),
};

const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
  cyl8: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
  sph: new THREE.SphereGeometry(0.5, 12, 10),
};

function part(parent, name, geo, mat, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

function hands(root, wScale = 1) {
  // 右手（握把）+ 左手（护木），均戴手套
  const g = new THREE.Group();
  const right = new THREE.Group();
  const fist = part(right, "fist", GEO.box, MAT.glove, 0, 0, 0, 0.09 * wScale, 0.12 * wScale, 0.16 * wScale);
  part(right, "sleeveR", GEO.box, MAT.sleeve, -0.02, 0.06, 0.05, 0.14, 0.22, 0.2);
  right.position.set(0.045, -0.09, 0.06);
  g.add(right);
  const left = new THREE.Group();
  part(left, "fistL", GEO.box, MAT.glove, 0, 0, 0, 0.085 * wScale, 0.115 * wScale, 0.15 * wScale);
  part(left, "sleeveL", GEO.box, MAT.sleeve, 0.02, 0.06, 0.04, 0.13, 0.2, 0.18);
  left.position.set(-0.035, -0.1, 0.24);
  g.add(left);
  root.add(g);
  return { group: g, right, left };
}

// ---------- 枪械构造 ----------
function buildPistol(id) {
  const g = new THREE.Group();
  const big = id === "deagle";
  const s = big ? 1.25 : 1;
  part(g, "slide", GEO.box, MAT.steel, 0, 0.045, 0, 0.052 * s, 0.06 * s, 0.3 * s);
  part(g, "slideTop", GEO.box, MAT.steelLight, 0, 0.062, -0.02, 0.044 * s, 0.018 * s, 0.24 * s);
  part(g, "frame", GEO.box, MAT.polymer, 0, -0.02, 0.02, 0.046 * s, 0.045 * s, 0.24 * s);
  part(g, "grip", GEO.box, MAT.polymer, 0, -0.09, 0.07, 0.05 * s, 0.12 * s, 0.09 * s, 0.28);
  part(g, "trigger", GEO.box, MAT.steelLight, 0, -0.02, -0.03, 0.008, 0.03, 0.008, 0.25);
  part(g, "barrel", GEO.cyl, MAT.steelDark, 0, 0.042, -0.17, 0.028 * s, 0.05 * s, 0.028 * s, Math.PI / 2);
  part(g, "sightF", GEO.box, MAT.steel, 0, 0.088, -0.13, 0.012, 0.018, 0.012);
  part(g, "sightR", GEO.box, MAT.steel, 0, 0.086, 0.12, 0.036, 0.016, 0.012);
  const h = hands(g, s);
  g.scale.setScalar(1.0);
  return { group: g, parts: { slide: g.getObjectByName("slide"), hands: h, muzzle: new THREE.Vector3(0, 0.042, -0.2) } };
}

function buildSMG() {
  const g = new THREE.Group();
  part(g, "receiver", GEO.box, MAT.polymer, 0, 0.02, 0, 0.06, 0.07, 0.34);
  part(g, "barrel", GEO.cyl, MAT.steelDark, 0, 0.02, -0.3, 0.024, 0.16, 0.024, Math.PI / 2);
  part(g, "suppressor", GEO.cyl, MAT.steelDark, 0, 0.02, -0.46, 0.034, 0.2, 0.034, Math.PI / 2);
  part(g, "handguard", GEO.box, MAT.polymer, 0, 0.0, -0.22, 0.052, 0.045, 0.14);
  part(g, "mag", GEO.box, MAT.steel, 0, -0.12, 0.03, 0.04, 0.16, 0.07, 0.18);
  part(g, "stock", GEO.box, MAT.polymer, 0, 0.01, 0.22, 0.044, 0.06, 0.12);
  part(g, "sightF", GEO.box, MAT.steel, 0, 0.07, -0.36, 0.014, 0.03, 0.012);
  part(g, "sightR", GEO.box, MAT.steel, 0, 0.07, 0.05, 0.04, 0.02, 0.012);
  const h = hands(g);
  return { group: g, parts: { slide: g.getObjectByName("receiver"), hands: h, muzzle: new THREE.Vector3(0, 0.02, -0.56) } };
}

function buildP90() {
  const g = new THREE.Group();
  part(g, "receiver", GEO.box, MAT.polymer, 0, 0.04, 0.05, 0.07, 0.1, 0.42);
  part(g, "barrel", GEO.cyl, MAT.steelDark, 0, 0.04, -0.28, 0.022, 0.2, 0.022, Math.PI / 2);
  part(g, "magTop", GEO.box, MAT.steel, 0, 0.1, 0.02, 0.05, 0.06, 0.34);
  part(g, "stock", GEO.box, MAT.polymer, 0, 0.02, 0.28, 0.05, 0.05, 0.1);
  part(g, "sight", GEO.box, MAT.steel, 0, 0.14, -0.05, 0.02, 0.04, 0.14);
  const h = hands(g);
  return { group: g, parts: { slide: g.getObjectByName("receiver"), hands: h, muzzle: new THREE.Vector3(0, 0.04, -0.4) } };
}

function buildRifle(id) {
  const g = new THREE.Group();
  const wood = id === "ak47";
  part(g, "receiver", GEO.box, MAT.steel, 0, 0.02, -0.02, 0.055, 0.075, 0.34);
  part(g, "barrel", GEO.cyl, MAT.steelDark, 0, 0.02, -0.42, 0.02, 0.38, 0.02, Math.PI / 2);
  part(g, "handguard", GEO.box, wood ? MAT.wood : MAT.polymer, 0, 0.005, -0.3, 0.052, 0.052, 0.24);
  part(g, "gastube", GEO.cyl, MAT.steelLight, 0, 0.045, -0.36, 0.014, 0.3, 0.014, Math.PI / 2);
  part(g, "mag", GEO.box, wood ? MAT.steel : MAT.steelLight, 0, -0.12, -0.02, 0.042, 0.16, 0.09, wood ? 0.12 : -0.08);
  part(g, "grip", GEO.box, wood ? MAT.wood : MAT.polymer, 0, -0.09, 0.12, 0.04, 0.1, 0.06, 0.2);
  part(g, "stock", GEO.box, wood ? MAT.wood : MAT.polymer, 0, 0.0, 0.2, 0.048, 0.07, 0.16);
  part(g, "sightF", GEO.box, MAT.steel, 0, 0.075, -0.45, 0.014, 0.035, 0.012);
  part(g, "sightR", GEO.box, MAT.steel, 0, 0.07, -0.02, 0.045, 0.02, 0.012);
  part(g, "carry", GEO.box, MAT.steel, 0, 0.085, -0.02, 0.03, 0.03, 0.16);
  const h = hands(g);
  return { group: g, parts: { mag: g.getObjectByName("mag"), slide: g.getObjectByName("receiver"), hands: h, muzzle: new THREE.Vector3(0, 0.02, -0.62) } };
}

function buildSniper() {
  const g = new THREE.Group();
  part(g, "receiver", GEO.box, MAT.polymer, 0, 0.01, -0.05, 0.055, 0.08, 0.4);
  part(g, "barrel", GEO.cyl, MAT.steelDark, 0, 0.01, -0.62, 0.022, 0.72, 0.022, Math.PI / 2);
  part(g, "stock", GEO.box, MAT.woodDark, 0, -0.02, 0.24, 0.055, 0.09, 0.22);
  part(g, "cheek", GEO.box, MAT.polymer, 0, 0.055, 0.22, 0.045, 0.05, 0.18);
  part(g, "grip", GEO.box, MAT.polymer, 0, -0.08, 0.12, 0.04, 0.11, 0.06, 0.22);
  part(g, "mag", GEO.box, MAT.steel, 0, -0.1, 0.04, 0.035, 0.1, 0.06);
  part(g, "scope", GEO.cyl, MAT.scope, 0, 0.09, 0.0, 0.032, 0.16, 0.032, Math.PI / 2);
  part(g, "scopeLens", GEO.cyl8, MAT.steelLight, 0, 0.09, -0.085, 0.028, 0.008, 0.028, Math.PI / 2);
  part(g, "bolt", GEO.box, MAT.steelLight, 0.02, 0.02, 0.1, 0.018, 0.045, 0.08);
  const h = hands(g);
  return { group: g, parts: { bolt: g.getObjectByName("bolt"), slide: g.getObjectByName("receiver"), hands: h, muzzle: new THREE.Vector3(0, 0.01, -0.98) } };
}

function buildShotgun() {
  const g = new THREE.Group();
  part(g, "receiver", GEO.box, MAT.steel, 0, 0.02, -0.08, 0.055, 0.075, 0.26);
  part(g, "barrel", GEO.cyl, MAT.steelDark, 0, 0.02, -0.44, 0.026, 0.5, 0.026, Math.PI / 2);
  part(g, "magTube", GEO.cyl, MAT.steelDark, 0, -0.012, -0.38, 0.022, 0.4, 0.022, Math.PI / 2);
  part(g, "pump", GEO.box, MAT.wood, 0, -0.005, -0.28, 0.056, 0.056, 0.14);
  part(g, "stock", GEO.box, MAT.wood, 0, -0.01, 0.12, 0.05, 0.08, 0.22);
  part(g, "sight", GEO.box, MAT.steel, 0, 0.065, -0.42, 0.014, 0.022, 0.012);
  const h = hands(g);
  return { group: g, parts: { pump: g.getObjectByName("pump"), slide: g.getObjectByName("receiver"), hands: h, muzzle: new THREE.Vector3(0, 0.02, -0.7) } };
}

function buildKnife() {
  const g = new THREE.Group();
  part(g, "blade", GEO.box, MAT.steelLight, 0, 0.05, -0.18, 0.018, 0.06, 0.22);
  part(g, "guard", GEO.box, MAT.polymer, 0, 0.02, -0.06, 0.06, 0.012, 0.02);
  part(g, "handle", GEO.box, MAT.polymer, 0, 0.015, 0.05, 0.03, 0.035, 0.14);
  const h = hands(g);
  return { group: g, parts: { slide: g.getObjectByName("blade"), hands: h, muzzle: new THREE.Vector3(0, 0.05, -0.3) } };
}

function buildNade(type) {
  const g = new THREE.Group();
  if (type === "he") {
    part(g, "body", GEO.sph, MAT.olive, 0, 0, 0, 0.13, 0.13, 0.13);
    part(g, "lever", GEO.box, MAT.steel, 0, 0.08, -0.05, 0.018, 0.06, 0.04, 0.4);
    part(g, "fuse", GEO.cyl, MAT.steelLight, 0, 0.13, 0, 0.02, 0.05, 0.02);
  } else if (type === "flash") {
    part(g, "body", GEO.cyl, MAT.steel, 0, 0, 0, 0.16, 0.26, 0.16);
    part(g, "top", GEO.box, MAT.steelDark, 0, 0.15, 0, 0.05, 0.04, 0.05);
  } else if (type === "smoke") {
    part(g, "body", GEO.cyl, MAT.steelDark, 0, 0, 0, 0.16, 0.28, 0.16);
    part(g, "band", GEO.cyl, MAT.green, 0, 0, 0, 0.165, 0.06, 0.165);
  } else {
    part(g, "bottle", GEO.cyl, MAT.green, 0, 0.02, 0, 0.1, 0.22, 0.1);
    part(g, "neck", GEO.cyl, MAT.steel, 0, 0.15, 0, 0.03, 0.08, 0.03);
    part(g, "rag", GEO.box, MAT.tan, 0, 0.21, 0, 0.04, 0.07, 0.04);
  }
  const h = hands(g);
  return { group: g, parts: { hands: h, muzzle: new THREE.Vector3() } };
}

export function buildViewModel(id) {
  if (id === "knife") return buildKnife();
  if (id === "he" || id === "flash" || id === "smoke" || id === "molotov") return buildNade(id);
  if (id === "glock" || id === "usp" || id === "deagle") return buildPistol(id);
  if (id === "mac10" || id === "mp9") return buildSMG();
  if (id === "p90") return buildP90();
  if (id === "ak47" || id === "m4a4") return buildRifle(id);
  if (id === "awp") return buildSniper();
  if (id === "nova") return buildShotgun();
  return buildPistol("glock");
}

// ---------- 士兵角色（第三人称） ----------
export function buildSoldier(team) {
  const g = new THREE.Group();
  const camo = getMaterial(team === "T" ? "camoT" : "camoCT");
  const gear = MAT.steelDark;

  const legs = new THREE.Group();
  const legL = part(legs, "legL", GEO.box, camo, -0.11, -0.42, 0, 0.13, 0.84, 0.17);
  const legR = part(legs, "legR", GEO.box, camo, 0.11, -0.42, 0, 0.13, 0.84, 0.17);
  part(legs, "bootL", GEO.box, gear, -0.11, -0.87, 0.015, 0.14, 0.1, 0.24);
  part(legs, "bootR", GEO.box, gear, 0.11, -0.87, 0.015, 0.14, 0.1, 0.24);
  legs.position.y = 0.86;
  g.add(legs);

  const torso = new THREE.Group();
  const vest = new THREE.MeshStandardMaterial({ color: 0x2e332f, roughness: 0.8, metalness: 0.15 });
  part(torso, "body", GEO.box, camo, 0, 0.08, 0, 0.38, 0.5, 0.24);
  part(torso, "vest", GEO.box, vest, 0, 0.06, 0.0, 0.32, 0.4, 0.26);
  part(torso, "plate", GEO.box, gear, 0, 0.12, -0.11, 0.24, 0.22, 0.04);
  part(torso, "pouchL", GEO.box, gear, -0.2, -0.1, 0.03, 0.08, 0.16, 0.14);
  part(torso, "pouchR", GEO.box, gear, 0.2, -0.1, 0.03, 0.08, 0.16, 0.14);
  torso.position.y = 1.02;
  g.add(torso);

  const armL = new THREE.Group();
  part(armL, "armL", GEO.box, camo, 0, -0.26, 0, 0.11, 0.52, 0.12);
  part(armL, "handL", GEO.box, MAT.skin, 0, -0.54, 0, 0.09, 0.1, 0.09);
  armL.position.set(-0.27, 1.32, 0);
  g.add(armL);

  const armR = new THREE.Group();
  part(armR, "armR", GEO.box, camo, 0, -0.24, 0, 0.11, 0.5, 0.12);
  part(armR, "handR", GEO.box, MAT.skin, 0, -0.52, 0, 0.09, 0.1, 0.09);
  armR.position.set(0.27, 1.32, 0);
  g.add(armR);

  const head = new THREE.Group();
  part(head, "skull", GEO.box, MAT.skin, 0, 0, 0, 0.2, 0.22, 0.2);
  part(head, "helmet", GEO.box, MAT.olive, 0, 0.1, 0, 0.24, 0.12, 0.24);
  part(head, "mask", GEO.box, MAT.steelDark, 0, -0.01, -0.11, 0.16, 0.08, 0.02);
  part(head, "cap", GEO.box, team === "T" ? MAT.tan : MAT.steelDark, 0, 0.13, 0, 0.22, 0.06, 0.22);
  head.position.y = 1.62;
  g.add(head);

  // 手中武器（简版）
  const gun = new THREE.Group();
  part(gun, "wbody", GEO.box, MAT.polymer, 0, 0, 0, 0.05, 0.07, 0.5);
  part(gun, "wbarrel", GEO.cyl, MAT.steelDark, 0, 0, -0.28, 0.018, 0.12, 0.018, Math.PI / 2);
  gun.position.set(0.28, 1.15, 0.12);
  armR.add(gun);

  return { group: g, parts: { legs, legL, legR, torso, head, armL, armR, gun, body: torso.getObjectByName("body") } };
}

export function buildBombModel() {
  const g = new THREE.Group();
  part(g, "body", GEO.box, MAT.olive, 0, 0.12, 0, 0.34, 0.2, 0.24);
  part(g, "keypad", GEO.box, MAT.black, 0, 0.24, 0.02, 0.2, 0.03, 0.18);
  part(g, "screen", GEO.box, MAT.green, 0, 0.24, 0.06, 0.12, 0.05, 0.02);
  const light = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.02), new THREE.MeshStandardMaterial({
    color: 0xff3020, emissive: 0xff1808, emissiveIntensity: 1.4, roughness: 0.4,
  }));
  light.position.set(0.1, 0.2, -0.12);
  g.add(light);
  part(g, "wire1", GEO.cyl, MAT.red, -0.08, 0.12, 0.14, 0.008, 0.12, 0.008);
  part(g, "wire2", GEO.cyl, MAT.steelLight, 0.05, 0.12, 0.16, 0.008, 0.1, 0.008);
  return { group: g, light };
}

// 世界中的掉落武器
export function buildWorldGun(id) {
  const g = new THREE.Group();
  if (id === "awp") { part(g, "b", GEO.box, MAT.polymer, 0, 0, 0, 0.07, 0.08, 0.9); part(g, "t", GEO.cyl, MAT.steelDark, 0, 0, -0.5, 0.03, 0.3, 0.03, Math.PI / 2); }
  else if (id === "ak47" || id === "m4a4") { part(g, "b", GEO.box, MAT.polymer, 0, 0, 0, 0.07, 0.09, 0.62); part(g, "m", GEO.box, MAT.steel, 0, -0.1, 0, 0.05, 0.18, 0.09); }
  else if (id === "nova") { part(g, "b", GEO.box, MAT.steel, 0, 0, 0, 0.07, 0.09, 0.62); part(g, "p", GEO.box, MAT.wood, 0, 0.02, 0.12, 0.08, 0.08, 0.2); }
  else if (id === "p90") { part(g, "b", GEO.box, MAT.polymer, 0, 0.03, 0, 0.09, 0.12, 0.46); }
  else if (id === "mac10" || id === "mp9") { part(g, "b", GEO.box, MAT.polymer, 0, 0.02, 0, 0.07, 0.09, 0.4); }
  else { part(g, "b", GEO.box, MAT.steel, 0, 0.03, 0, 0.06, 0.08, 0.22); part(g, "gr", GEO.box, MAT.polymer, 0, -0.07, 0.06, 0.06, 0.12, 0.08); }
  g.scale.setScalar(0.9);
  return g;
}

export function buildNadeWorld(type) {
  const g = new THREE.Group();
  if (type === "he") part(g, "b", GEO.sph, MAT.olive, 0, 0.12, 0, 0.16, 0.16, 0.16);
  else if (type === "flash") part(g, "b", GEO.cyl, MAT.steel, 0, 0.12, 0, 0.18, 0.26, 0.18);
  else if (type === "smoke") part(g, "b", GEO.cyl, MAT.steelDark, 0, 0.12, 0, 0.18, 0.3, 0.18);
  else part(g, "b", GEO.cyl, MAT.green, 0, 0.12, 0, 0.12, 0.24, 0.12);
  return g;
}

export { MAT, GEO };
