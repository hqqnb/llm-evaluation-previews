// weapon_view.js — first-person viewmodel, animations, muzzle flash, ballistics helpers
import * as THREE from 'three';
import { WEAPONS } from './weapons_data.js';
import { rand } from './math.js';

const BLACK = new THREE.MeshStandardMaterial({ color: 0x1c1c20, roughness: 0.6, metalness: 0.4 });
const DARK = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.5, metalness: 0.5 });
const WOOD = new THREE.MeshStandardMaterial({ color: 0x6e4a24, roughness: 0.7, metalness: 0.05 });
const STEEL = new THREE.MeshStandardMaterial({ color: 0x555860, roughness: 0.35, metalness: 0.8 });
const TAN = new THREE.MeshStandardMaterial({ color: 0x8a7a56, roughness: 0.6, metalness: 0.2 });

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); return m;
}
function cyl(r, h, mat, x = 0, y = 0, z = 0, seg = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
  m.position.set(x, y, z); m.rotation.z = Math.PI / 2; return m;
}

function buildModel(cat) {
  const g = new THREE.Group();
  const hands = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.8 });
  if (cat === 'knife') {
    g.add(box(0.03, 0.03, 0.34, STEEL, 0, 0, -0.18));
    g.add(box(0.05, 0.05, 0.1, BLACK, 0, 0, 0.02));
    g.add(box(0.09, 0.11, 0.1, skin, 0.01, -0.05, 0.05));
    return g;
  }
  // common: receiver body along -z (forward)
  let bodyLen = 0.5, barrelLen = 0.22, barrelR = 0.018;
  if (cat === 'pistol') { bodyLen = 0.22; barrelLen = 0.02; }
  if (cat === 'smg') { bodyLen = 0.4; barrelLen = 0.12; }
  if (cat === 'rifle') { bodyLen = 0.5; barrelLen = 0.26; }
  if (cat === 'sniper') { bodyLen = 0.62; barrelLen = 0.42; barrelR = 0.02; }
  if (cat === 'shotgun') { bodyLen = 0.55; barrelLen = 0.34; barrelR = 0.024; }

  const bodyMat = cat === 'rifle' ? WOOD : (cat === 'shotgun' ? WOOD : BLACK);
  g.add(box(0.06, 0.075, bodyLen, bodyMat, 0, 0, -bodyLen / 2));
  g.add(box(0.05, 0.05, barrelLen, DARK, 0, 0.005, -bodyLen - barrelLen / 2 + 0.02));
  // barrel
  const barrel = cyl(barrelR, barrelLen, STEEL, 0, 0.01, -bodyLen - barrelLen / 2 + 0.02);
  barrel.rotation.z = 0; barrel.rotation.x = Math.PI / 2;
  g.add(barrel);
  // grip + magazine
  const grip = box(0.05, 0.16, 0.06, BLACK, 0, -0.11, -0.03); grip.rotation.x = 0.25; g.add(grip);
  if (cat !== 'pistol') g.add(box(0.045, 0.16, 0.05, DARK, 0, -0.12, -bodyLen * 0.55));
  // stock for rifle/sniper/shotgun
  if (cat === 'rifle' || cat === 'sniper' || cat === 'shotgun' || cat === 'smg') {
    g.add(box(0.05, 0.06, 0.16, bodyMat, 0, -0.01, 0.08));
  }
  // scope for sniper
  if (cat === 'sniper') {
    const sc = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 12), BLACK);
    sc.rotation.x = Math.PI / 2; sc.position.set(0, 0.07, -0.2); g.add(sc);
  }
  // sight
  g.add(box(0.01, 0.02, 0.01, STEEL, 0, 0.05, -bodyLen + 0.05));
  // hands
  hands.add(box(0.07, 0.07, 0.1, skin, 0.005, -0.09, -0.02));
  const fh = box(0.06, 0.06, 0.09, skin, 0.005, -0.06, -bodyLen * 0.7); g.add(fh);
  g.add(hands);
  return g;
}

export class ViewModel {
  constructor(vmScene) {
    this.vmScene = vmScene;
    this.root = new THREE.Group();
    this.vmScene.add(this.root);
    this.models = {};
    this.current = null;
    this.currentCat = null;

    // muzzle flash
    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.28, 0.28),
      new THREE.MeshBasicMaterial({ color: 0xffcc55, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    this.flashLight = new THREE.PointLight(0xffaa44, 0, 6);
    this.root.add(this.flashLight);

    // animation state
    this.kick = 0; this.kickRot = 0; this.reloadT = 0; this.reloadDur = 0;
    this.switchT = 0; this.bob = 0; this.adsAmt = 0;
    this.basePos = new THREE.Vector3(0.16, -0.16, -0.42);
    this.adsPos = new THREE.Vector3(0, -0.1, -0.28);
  }
  setWeapon(id) {
    const w = WEAPONS[id]; if (!w) return;
    const cat = w.cat;
    if (this.current) this.root.remove(this.current);
    if (!this.models[cat]) this.models[cat] = buildModel(cat);
    this.current = this.models[cat];
    this.currentCat = cat;
    this.root.add(this.current);
    // muzzle position along barrel
    let ml = 0.7; if (cat === 'pistol') ml = 0.28; if (cat === 'sniper') ml = 1.05; if (cat === 'smg') ml = 0.55; if (cat === 'shotgun') ml = 0.9;
    this.muzzleZ = -ml;
    this.current.add(this.flash); this.flash.position.set(0, 0.01, this.muzzleZ);
    this.flashLight.position.set(0, 0.01, this.muzzleZ);
    this.switchT = 0.35;
  }
  doFire() {
    this.kick = Math.min(this.kick + 0.06, 0.14);
    this.kickRot = Math.min(this.kickRot + 0.09, 0.2);
    this.flash.material.opacity = 0.9;
    this.flash.rotation.z = rand(0, 6.28);
    const sc = 0.7 + rand(0, 0.7); this.flash.scale.set(sc, sc, sc);
    this.flashLight.intensity = 3;
  }
  startReload(dur) { this.reloadT = dur; this.reloadDur = dur; }
  update(dt, moving, adsWant, speed) {
    // recover
    this.kick += (0 - this.kick) * Math.min(1, dt * 12);
    this.kickRot += (0 - this.kickRot) * Math.min(1, dt * 12);
    this.flash.material.opacity += (0 - this.flash.material.opacity) * Math.min(1, dt * 30);
    this.flashLight.intensity += (0 - this.flashLight.intensity) * Math.min(1, dt * 25);
    this.adsAmt += ((adsWant ? 1 : 0) - this.adsAmt) * Math.min(1, dt * 14);
    if (this.switchT > 0) this.switchT -= dt;
    if (this.reloadT > 0) this.reloadT -= dt;

    // bob
    if (moving && speed > 1) this.bob += dt * speed * 1.1; else this.bob += (0 - (this.bob % (Math.PI * 2))) * 0;
    const bobX = Math.cos(this.bob) * 0.008 * (moving ? 1 : 0);
    const bobY = Math.abs(Math.sin(this.bob)) * 0.012 * (moving ? 1 : 0);

    const base = this.basePos, ads = this.adsPos, a = this.adsAmt;
    let px = base.x + (ads.x - base.x) * a + bobX;
    let py = base.y + (ads.y - base.y) * a + bobY - this.kick * 0.5;
    let pz = base.z + (ads.z - base.z) * a + this.kick;
    // switch/reload dip
    const dip = (this.switchT > 0 ? this.switchT / 0.35 : 0) * 0.25 + (this.reloadDur > 0 && this.reloadT > 0 ? Math.sin(Math.PI * (1 - this.reloadT / this.reloadDur)) * 0.12 : 0);
    py -= dip;
    this.root.position.set(px, py, pz);
    this.root.rotation.x = this.kickRot + (this.reloadDur > 0 && this.reloadT > 0 ? Math.sin(Math.PI * (1 - this.reloadT / this.reloadDur)) * 0.6 : 0);
    this.root.rotation.z = this.reloadDur > 0 && this.reloadT > 0 ? -0.3 * Math.sin(Math.PI * (1 - this.reloadT / this.reloadDur)) : 0;
  }
  hide() { this.root.visible = false; }
  show() { this.root.visible = true; }
}

// Recoil pattern: returns pitch(up)/yaw(side) offset in radians for a given shot index
export function recoilOffset(weapon, idx) {
  const r = weapon.recoil || 1;
  const up = Math.min(idx, 8) * 0.006 * r + Math.max(0, idx - 8) * 0.002 * r;
  // horizontal: rises then swings (classic AK-like)
  let yaw = 0;
  if (idx > 3) yaw = Math.sin(idx * 0.7) * 0.004 * r + (idx % 3 - 1) * 0.0025 * r;
  return { up, yaw };
}
// spread in radians given movement & ads
export function currentSpread(weapon, moving, airborne, ads, crouch) {
  let s = weapon.spread || 0.01;
  if (moving) s *= 2.4;
  if (airborne) s *= 6;
  if (crouch) s *= 0.6;
  if (ads && weapon.scoped) s *= 0.15;
  else if (ads) s *= 0.7;
  return s;
}
