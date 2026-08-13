// ---------- 舱内探索：环形生态舱（曲面行走 + 程序化生态 + 闸门穿越）与零重力主轴 ----------
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SHIP, BIOMES, ARCHETYPES } from './config.js';
import {
  TAU, clamp, lerp, rng, hashString, makeNoise, fbm,
  buildTubeSurface, gradientTexture, disposeObject, smoothstep,
} from './utils.js';

const DEG = Math.PI / 180;
const R = SHIP.ringMajorRadius;
const TUBE = SHIP.biomeRadius;
const SPAN = TAU / 12; // 每个生态舱 30°

function annulusGeo(r, f0, f1, segs = 8, side = 40) {
  const positions = [], indices = [];
  for (let i = 0; i <= segs; i++) {
    const f = f0 + ((f1 - f0) * i) / segs;
    for (let j = 0; j <= side; j++) {
      const th = (TAU * j) / side;
      positions.push(r * f * Math.cos(th), r * f * Math.sin(th), 0);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < side; j++) {
      const a = i * (side + 1) + j, b = a + side + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function textSprite(text, opts = {}) {
  const { bg = 'rgba(6,14,28,0.85)', fg = '#cfe8ff', size = 512, h = 128, scale = 1 } = opts;
  const c = document.createElement('canvas');
  c.width = size; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  const rad = 18;
  g.beginPath();
  g.moveTo(rad, 0); g.lineTo(size - rad, 0); g.arcTo(size, 0, size, rad, rad);
  g.lineTo(size, h - rad); g.arcTo(size, h, size - rad, h, rad);
  g.lineTo(rad, h); g.arcTo(0, h, 0, h - rad, rad);
  g.lineTo(0, rad); g.arcTo(0, 0, rad, 0, rad);
  g.fill();
  g.strokeStyle = 'rgba(120,180,255,0.55)';
  g.lineWidth = 5;
  g.stroke();
  g.fillStyle = fg;
  g.font = `bold ${Math.floor(h * 0.42)}px "PingFang SC","Microsoft YaHei",sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, size / 2, h / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(scale * (size / h), scale, 1);
  return sp;
}

// 草地叶片（交叉双面）
function grassBladeGeo() {
  const half = 0.12, h = 1.7;
  const g1 = new THREE.PlaneGeometry(0.22, h);
  g1.translate(0, h / 2, 0);
  const g2 = g1.clone();
  g2.rotateY(Math.PI / 2);
  const merged = mergeGeometries([g1, g2]);
  g1.dispose(); g2.dispose();
  return merged;
}

function makeTreeGeo(type) {
  const trunk = new THREE.CylinderGeometry(0.45, 0.7, 6, 6);
  trunk.translate(0, 3, 0);
  let canopy;
  if (type === 'pine') {
    const c1 = new THREE.ConeGeometry(3.4, 5, 7); c1.translate(0, 7.5, 0);
    const c2 = new THREE.ConeGeometry(2.5, 4, 7); c2.translate(0, 10, 0);
    const c3 = new THREE.ConeGeometry(1.6, 3, 7); c3.translate(0, 12.2, 0);
    canopy = mergeGeometries([c1, c2, c3]);
    c1.dispose(); c2.dispose(); c3.dispose();
  } else if (type === 'jungle') {
    canopy = new THREE.SphereGeometry(4.4, 9, 7);
    canopy.scale(1, 1.35, 1);
    canopy.translate(0, 9.5, 0);
  } else if (type === 'acacia') {
    canopy = new THREE.SphereGeometry(3.6, 8, 5);
    canopy.scale(1.6, 0.32, 1.6);
    canopy.translate(0, 9, 0);
  } else {
    canopy = new THREE.SphereGeometry(3.2, 9, 7);
    canopy.scale(1, 1.15, 1);
    canopy.translate(0, 7, 0);
  }
  const geo = mergeGeometries([trunk, canopy]);
  trunk.dispose(); canopy.dispose();
  return geo;
}

export class Interior {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.root = new THREE.Group();
    this.root.visible = false;
    scene.add(this.root);

    this.mode = 'biome';
    this.biome = null;
    this.arch = null;
    this.a0 = 0; this.a1 = 0;
    this.offset = new THREE.Vector3();
    this.group = null;
    this.lights = [];
    this.weatherSys = null;
    this.doors = { aft: null, fwd: null };

    // 玩家（生态舱曲面行走）
    this.p = { a: 0, th: 0, yaw: 0, pitch: -0.04, bob: 0 };
    // 玩家（主轴零重力）
    this.pos = new THREE.Vector3(18, 0, 0);
    this.yawZ = Math.PI / 2;
    this.pitchZ = 0;
    this.vel = new THREE.Vector3();
    this.time = 0;

    this._reliefFn = null;
    this._waterFn = null;
  }

  // ---------- 地形函数（世界角度锚定，保证相邻舱衔接） ----------
  _makeRelief(bio, arch) {
    const seed = hashString(bio.id);
    const n1 = makeNoise(seed ^ 0x9e37);
    const n2 = makeNoise(seed ^ 0x51ab);
    const hills = arch.hills * 30;
    const waterBody = arch.waterBody;
    const meanderPhase = (seed % 10) * 0.7;
    const riverPhase = (seed % 7) * 0.9;
    const lakeA = this.a0 + SPAN * 0.52;
    return {
      relief(a, th) {
        const ath = Math.abs(th);
        const wallFade = 1 - smoothstep(58 * DEG, 92 * DEG, ath);
        let h = fbm(n1, a * 3.4, th * 2.6, 4) * hills * wallFade;
        h += fbm(n2, a * 11, th * 8, 3) * 2.2 * wallFade;
        if (waterBody === 'river') {
          const meander = 0.16 * Math.sin(a * 6 + riverPhase);
          h -= 9 * Math.exp(-((th - meander) ** 2) / (2 * 0.11 ** 2));
        } else if (waterBody === 'pond' || waterBody === 'lake') {
          h -= 13 * Math.exp(-((th / 0.48) ** 2 + ((a - lakeA) / 0.045) ** 2));
        }
        return h;
      },
      waterLevel: -3,
    };
  }

  _terrainColor(arch, relief, waterLevel, waterBody) {
    const A = new THREE.Color(arch.ground[0]);
    const B = new THREE.Color(arch.ground[1]);
    const snow = new THREE.Color('#eef4f8');
    const sand = new THREE.Color('#d6c58d');
    const rock = new THREE.Color('#8a8d92');
    const tmp = new THREE.Color();
    const snowy = arch.weather === 'snow' || arch.type === 'alpine' || arch.type === 'taiga' || arch.type === 'patagonia';
    return (a, th) => {
      const h = relief(a, th);
      const norm = clamp(h / 22, -1, 1) * 0.5 + 0.5;
      tmp.copy(A).lerp(B, norm);
      // 岩壁感（陡坡）
      const steep = smoothstep(52 * DEG, 86 * DEG, Math.abs(th));
      tmp.lerp(rock, steep * 0.75);
      if (snowy) {
        const s = smoothstep(7, 20, h);
        tmp.lerp(snow, s * 0.85);
      }
      if (waterBody !== 'none') {
        const s2 = 1 - smoothstep(waterLevel, waterLevel + 5, h);
        tmp.lerp(sand, s2 * 0.55);
      }
      // 墙侧阴影
      const shade = 1 - smoothstep(42 * DEG, 90 * DEG, Math.abs(th)) * 0.45;
      tmp.multiplyScalar(shade);
      return [tmp.r, tmp.g, tmp.b];
    };
  }

  // ---------- 进入生态舱 ----------
  enterBiome(id, { dir = 1 } = {}) {
    this.clear();
    const bio = BIOMES.find(b => b.id === id) || BIOMES[0];
    const arch = ARCHETYPES[bio.type];
    this.biome = bio;
    this.arch = arch;
    this.mode = 'biome';

    const idx = Math.max(0, BIOMES.filter(b => b.ring === bio.ring).findIndex(b => b.id === bio.id));
    const aMid = idx * SPAN;
    this.a0 = aMid - SPAN / 2;
    this.a1 = aMid + SPAN / 2;
    this.offset.set(Math.cos(aMid) * R, 0, Math.sin(aMid) * R);

    const group = new THREE.Group();
    group.position.copy(this.offset).multiplyScalar(-1);
    this.root.add(group);
    this.group = group;

    const relief = this._makeRelief(bio, arch);
    this._reliefFn = relief.relief;
    const wl = relief.waterLevel;

    // 地形
    const terrain = new THREE.Mesh(
      buildTubeSurface({
        R, r: TUBE, a0: this.a0, a1: this.a1, th0: -104 * DEG, th1: 104 * DEG,
        tubeSegs: 96, sideSegs: 56,
        radiusFn: (a, th) => 1 + relief.relief(a, th) / TUBE,
        colorFn: this._terrainColor(arch, relief.relief, wl, arch.waterBody),
      }),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0.02 })
    );
    group.add(terrain);

    // 舱壁（内侧可见壳）
    const shell = new THREE.Mesh(
      buildTubeSurface({
        R, r: TUBE, a0: this.a0, a1: this.a1, th0: 98 * DEG, th1: 262 * DEG,
        tubeSegs: 96, sideSegs: 40,
      }),
      new THREE.MeshStandardMaterial({ color: 0x39424e, roughness: 0.75, metalness: 0.55, side: THREE.DoubleSide })
    );
    group.add(shell);

    // 采光带（“太阳线”）
    const skyC = new THREE.Color(arch.sky);
    const stripTex = gradientTexture([
      [0, 'rgba(255,255,255,0.25)'], [0.5, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0.25)'],
    ], 128, false);
    const strip = new THREE.Mesh(
      buildTubeSurface({
        R, r: TUBE + 1.2, a0: this.a0, a1: this.a1, th0: 152 * DEG, th1: 208 * DEG,
        tubeSegs: 96, sideSegs: 18,
      }),
      new THREE.MeshBasicMaterial({ map: stripTex, color: skyC, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    group.add(strip);
    const halo = new THREE.Mesh(
      buildTubeSurface({
        R, r: TUBE + 1.5, a0: this.a0, a1: this.a1, th0: 118 * DEG, th1: 242 * DEG,
        tubeSegs: 72, sideSegs: 12,
      }),
      new THREE.MeshBasicMaterial({
        map: gradientTexture([[0, 'rgba(0,0,0,0)'], [0.5, 'rgba(255,255,255,0.7)'], [1, 'rgba(0,0,0,0)']], 128, false),
        color: skyC, transparent: true, opacity: 0.35,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      })
    );
    group.add(halo);

    // 水体
    if (arch.waterBody !== 'none') {
      let wa0 = this.a0, wa1 = this.a1, wth0 = -26 * DEG, wth1 = 26 * DEG;
      if (arch.waterBody === 'pond' || arch.waterBody === 'lake') {
        wa0 = this.a0 + SPAN * 0.42; wa1 = this.a0 + SPAN * 0.62;
        wth0 = -42 * DEG; wth1 = 42 * DEG;
      }
      const water = new THREE.Mesh(
        buildTubeSurface({
          R, r: TUBE + wl + 0.5, a0: wa0, a1: wa1, th0: wth0, th1: wth1,
          tubeSegs: 40, sideSegs: 14,
        }),
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(arch.water), roughness: 0.12, metalness: 0.15,
          transparent: true, opacity: 0.82,
        })
      );
      group.add(water);
    }

    this._buildVegetation(group, bio, arch, relief);
    this._buildBuildings(group, bio, arch, relief);
    this._buildDoors(group, bio);
    this._setupLights(arch);
    this._buildWeather(group, bio, arch);
    this.scene.fog = new THREE.FogExp2(new THREE.Color(arch.fog), arch.fogD);

    // 玩家起点
    this.p.a = dir > 0 ? this.a0 + 2.5 * DEG : this.a1 - 2.5 * DEG;
    this.p.th = 0;
    this.p.yaw = dir > 0 ? 0 : Math.PI;
    this.p.pitch = -0.04;
    this.root.visible = true;
    return { biome: bio, arch };
  }

  _buildVegetation(group, bio, arch, relief) {
    const rand = rng(hashString(bio.id + '-veg'));
    const treeType = arch.trees;
    const treeGeo = makeTreeGeo(treeType);
    const canopyCol = {
      pine: '#3f6b4c', broad: '#4c7c3c', jungle: '#2f6a38',
      acacia: '#7d9a4a', cactus: '#5c8a52',
    }[treeType] || '#4c7c3c';

    const treeCount = Math.round(arch.treeN * (0.8 + rand() * 0.4));
    const trees = [];
    for (let i = 0; i < treeCount; i++) {
      const a = this.a0 + rand() * SPAN;
      const th = (rand() * 2 - 1) * 48 * DEG;
      if (Math.abs(th) < 14 * DEG) continue;
      const h = relief.relief(a, th);
      if (h < -2) continue;
      const s = 0.7 + rand() * 1.1;
      trees.push({ a, th, h, s, rot: rand() * TAU });
    }
    if (treeType === 'cactus') {
      const geo = new THREE.Mesh(treeGeo, new THREE.MeshStandardMaterial({ color: 0x5c8a52, roughness: 0.8 }));
      this._placeInstanced(group, geo, trees, 0);
    } else {
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4f36, roughness: 0.9 });
      const canMat = new THREE.MeshStandardMaterial({ color: canopyCol, roughness: 0.85 });
      // 分离干/冠
      const trunkGeo = new THREE.CylinderGeometry(0.5, 0.75, 6.5, 6);
      trunkGeo.translate(0, 3.2, 0);
      const imTrunk = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
      const canopyGeo = treeGeo.clone();
      // 用简化球冠
      const cg = new THREE.SphereGeometry(3.4, 8, 6);
      cg.scale(1, 1.25, 1);
      cg.translate(0, 7.2, 0);
      const imCan = new THREE.InstancedMesh(cg, canMat, trees.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3();
      trees.forEach((t, i) => {
        const pos = this._surfacePoint(t.a, t.th, t.h);
        v.set(pos.x, pos.y, pos.z);
        q.copy(this._surfaceQuat(t.a, t.rot));
        m4.compose(v, q, new THREE.Vector3(t.s, t.s, t.s));
        imTrunk.setMatrixAt(i, m4);
        imCan.setMatrixAt(i, m4);
      });
      imTrunk.instanceMatrix.needsUpdate = true;
      imCan.instanceMatrix.needsUpdate = true;
      group.add(imTrunk, imCan);
      this._disposables.push(trunkGeo, cg, treeGeo);
    }

    // 草地
    const grassN = Math.round(arch.grass * 2600);
    const blade = grassBladeGeo();
    const grassMat = new THREE.MeshBasicMaterial({
      color: 0x6f9a4a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false,
    });
    const imGrass = new THREE.InstancedMesh(blade, grassMat, grassN);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s3 = new THREE.Vector3();
    for (let i = 0; i < grassN; i++) {
      const a = this.a0 + rand() * SPAN;
      const th = (rand() * 2 - 1) * 72 * DEG;
      const h = relief.relief(a, th);
      if (h < -2.2 || Math.abs(th) > 78 * DEG) { m4.makeScale(0, 0, 0); }
      else {
        const pos = this._surfacePoint(a, th, h);
        v.set(pos.x, pos.y, pos.z);
        q.copy(this._surfaceQuat(a, rand() * TAU));
        const sc = 0.8 + rand() * 1.5;
        s3.set(sc, sc, sc);
        m4.compose(v, q, s3);
      }
      imGrass.setMatrixAt(i, m4);
    }
    imGrass.instanceMatrix.needsUpdate = true;
    group.add(imGrass);
    this._disposables.push(blade);

    // 岩石
    const rockN = Math.round(arch.rock * 260);
    const rockGeo = new THREE.IcosahedronGeometry(3, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x83888f, roughness: 0.95 });
    const imRock = new THREE.InstancedMesh(rockGeo, rockMat, rockN);
    for (let i = 0; i < rockN; i++) {
      const a = this.a0 + rand() * SPAN;
      const th = (rand() * 2 - 1) * 80 * DEG;
      const h = relief.relief(a, th);
      const pos = this._surfacePoint(a, th, h);
      v.set(pos.x, pos.y, pos.z);
      q.copy(this._surfaceQuat(a, rand() * TAU));
      const sc = 0.5 + rand() * 2.2;
      s3.set(sc * (0.7 + rand() * 0.7), sc * (0.5 + rand() * 0.4), sc * (0.7 + rand() * 0.7));
      m4.compose(v, q, s3);
      imRock.setMatrixAt(i, m4);
    }
    imRock.instanceMatrix.needsUpdate = true;
    group.add(imRock);
    this._disposables.push(rockGeo);
  }

  _buildBuildings(group, bio, arch, relief) {
    const b = arch.building;
    if (b === 'none') return;
    const aC = this.a0 + SPAN * 0.44;
    const buildAt = (th, cb) => {
      const h = relief.relief(aC, th);
      const pos = this._surfacePoint(aC, th, h);
      const grp = new THREE.Group();
      grp.position.copy(pos);
      // 让建筑“立”在曲面上：up = -ρ̂
      const rho = new THREE.Vector3(Math.cos(aC), 0, Math.sin(aC));
      const t = new THREE.Vector3(-Math.sin(aC), 0, Math.cos(aC));
      const m = new THREE.Matrix4().makeBasis(t, rho.clone().negate(), rho);
      grp.quaternion.setFromRotationMatrix(m);
      cb(grp);
      group.add(grp);
    };

    const warmWin = new THREE.MeshBasicMaterial({ color: 0xffd98a });
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.8 });
    const white = new THREE.MeshStandardMaterial({ color: 0xe8e2d2, roughness: 0.9 });
    const stone = new THREE.MeshStandardMaterial({ color: 0x9a9488, roughness: 0.9 });

    if (b === 'farm') {
      buildAt(0, grp => {
        const base = new THREE.Mesh(new THREE.BoxGeometry(12, 5, 8), white); base.position.y = 2.5; grp.add(base);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(8.4, 4.5, 4), stone);
        roof.rotation.y = Math.PI / 4; roof.position.y = 7.2; grp.add(roof);
        const door = new THREE.Mesh(new THREE.BoxGeometry(1.8, 3, 0.2), wood); door.position.set(0, 1.5, 4.02); grp.add(door);
        const w1 = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), warmWin); w1.position.set(-3.2, 3, 4.02); grp.add(w1);
        const w2 = w1.clone(); w2.position.x = 3.2; grp.add(w2);
        const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 4, 6), stone); ch.position.set(2.5, 7.5, -2); grp.add(ch);
      });
      buildAt(8 * DEG, grp => {
        const shed = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 5), wood); shed.position.y = 2; grp.add(shed);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(5.2, 2.6, 4), stone); roof.rotation.y = Math.PI / 4; roof.position.y = 5.3; grp.add(roof);
      });
      buildAt(-8 * DEG, grp => {
        const shed = new THREE.Mesh(new THREE.BoxGeometry(5, 3.5, 4), wood); shed.position.y = 1.75; grp.add(shed);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(4.4, 2.2, 4), stone); roof.rotation.y = Math.PI / 4; roof.position.y = 4.6; grp.add(roof);
      });
      const sign = textSprite('德维的家 · 新斯科舍生态舱', { scale: 42 });
      const sp = this._surfacePoint(aC, 0, relief.relief(aC, 0));
      sign.position.copy(sp).addScaledVector(new THREE.Vector3(Math.cos(aC), 0, Math.sin(aC)), -22);
      group.add(sign);
    } else if (b === 'yurt') {
      [-9 * DEG, 0, 9 * DEG].forEach((th, i) => {
        buildAt(th + (i - 1) * 2 * DEG, grp => {
          const base = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 2.8, 12), white); base.position.y = 1.4; grp.add(base);
          const roof = new THREE.Mesh(new THREE.ConeGeometry(4.6, 2.6, 12), stone); roof.position.y = 4.1; grp.add(roof);
          const door = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2, 0.2), wood); door.position.set(0, 1, 4.12); grp.add(door);
        });
      });
      const sign = textSprite('蒙古游牧营地', { scale: 34 });
      const sp = this._surfacePoint(aC, 0, relief.relief(aC, 0));
      sign.position.copy(sp).addScaledVector(new THREE.Vector3(Math.cos(aC), 0, Math.sin(aC)), -18);
      group.add(sign);
    } else if (b === 'terrace') {
      for (let k = 0; k < 6; k++) {
        buildAt((k - 2.5) * 9 * DEG, grp => {
          const step = new THREE.Mesh(new THREE.BoxGeometry(26, 1.6, 12), stone);
          step.position.y = 1.6 * k * 0.35;
          grp.add(step);
        });
      }
      const sign = textSprite('长江生态舱 · 梯田', { scale: 34 });
      const sp = this._surfacePoint(aC, 0, relief.relief(aC, 0));
      sign.position.copy(sp).addScaledVector(new THREE.Vector3(Math.cos(aC), 0, Math.sin(aC)), -18);
      group.add(sign);
    } else if (b === 'hut') {
      [-10 * DEG, 0, 10 * DEG].forEach((th, i) => {
        buildAt(th, grp => {
          const base = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 6), wood); base.position.y = 2; grp.add(base);
          const roof = new THREE.Mesh(new THREE.ConeGeometry(5.8, 2.6, 4), stone); roof.rotation.y = Math.PI / 4; roof.position.y = 5.3; grp.add(roof);
          const door = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.2, 0.2), white); door.position.set(0, 1.1, 3.02); grp.add(door);
        });
      });
    }
  }

  _buildDoors(group, bio) {
    const mkDoor = (boundaryAngle, dir) => {
      const grp = new THREE.Group();
      const rho = new THREE.Vector3(Math.cos(boundaryAngle), 0, Math.sin(boundaryAngle));
      const k = new THREE.Vector3(0, 1, 0);
      const t = new THREE.Vector3(-Math.sin(boundaryAngle), 0, Math.cos(boundaryAngle));
      const m = new THREE.Matrix4().makeBasis(rho, k, t);
      grp.quaternion.setFromRotationMatrix(m);
      grp.position.copy(rho.multiplyScalar(R));
      grp.rotateX(-15 * DEG * dir); // 小说：闸门两端斜置 15°

      const wall = new THREE.Mesh(
        annulusGeo(TUBE, 0.125, 1.0),
        new THREE.MeshStandardMaterial({ color: 0x4a5361, metalness: 0.7, roughness: 0.55, side: THREE.DoubleSide })
      );
      wall.translateZ(-dir * 0.5);
      grp.add(wall);

      const door = new THREE.Mesh(
        new THREE.CylinderGeometry(60, 60, 5, 28),
        new THREE.MeshStandardMaterial({ color: 0x6d7888, metalness: 0.8, roughness: 0.45, side: THREE.DoubleSide })
      );
      door.rotation.x = -Math.PI / 2;
      door.position.z = -dir * 3;
      grp.add(door);

      const rimGeo = new THREE.TorusGeometry(62, 3, 8, 28);
      const rim = new THREE.Mesh(rimGeo, new THREE.MeshBasicMaterial({ color: 0xffc46b }));
      rim.position.z = -dir * 4;
      grp.add(rim);

      const label = textSprite(dir > 0 ? `闸门 → ${this._nextBiomeName(1)}` : `闸门 → ${this._nextBiomeName(-1)}`, { scale: 30 });
      label.position.set(0, 120, -dir * 2);
      grp.add(label);

      grp.userData = { door, boundaryAngle, dir, open: 0 };
      group.add(grp);
      return grp;
    };
    this.doors.aft = mkDoor(this.a0, -1);
    this.doors.fwd = mkDoor(this.a1, 1);
  }

  _nextBiomeName(dir) {
    const ring = this.biome.ring;
    const list = BIOMES.filter(b => b.ring === ring);
    let idx = list.findIndex(b => b.id === this.biome.id);
    idx = (idx + dir + list.length) % list.length;
    return list[idx].name;
  }

  _nextBiomeId(dir) {
    const ring = this.biome.ring;
    const list = BIOMES.filter(b => b.ring === ring);
    let idx = list.findIndex(b => b.id === this.biome.id);
    idx = (idx + dir + list.length) % list.length;
    return list[idx].id;
  }

  _setupLights(arch) {
    const hemi = new THREE.HemisphereLight(new THREE.Color(arch.sky), new THREE.Color('#2c3138'), 0.85);
    const dir = new THREE.DirectionalLight(new THREE.Color(arch.light), 1.35);
    // 从采光带方向向下打光（指向曲面中心的反方向）
    dir.position.set(0, 1, 0);
    const n = Math.max(6, Math.round(arch.light ? 6 : 6));
    for (let i = 0; i < n; i++) {
      const a = this.a0 + ((SPAN * (i + 0.5)) / n);
      const p = new THREE.PointLight(new THREE.Color(arch.light), 9000, 1600, 1.55);
      const rho = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      p.position.copy(rho.multiplyScalar(R - TUBE * 0.92)).sub(this.offset);
      this.group.add(p);
      this.lights.push(p);
    }
    this.group.add(hemi, dir);
    this.lights.push(hemi, dir);
  }

  _buildWeather(group, bio, arch) {
    const w = arch.weather;
    if (w === 'none') return;
    const rand = rng(hashString(bio.id + '-weather'));
    const N = w === 'snow' ? 2200 : w === 'rain' ? 1500 : 0;
    const sys = { kind: w, update: null, meshes: [] };
    if (w === 'snow' || w === 'rain') {
      const params = new Float32Array(N * 3); // a, th, seed
      for (let i = 0; i < N; i++) {
        params[i * 3] = this.a0 + rand() * SPAN;
        params[i * 3 + 1] = (150 + rand() * 25) * DEG;
        params[i * 3 + 2] = rand() * TAU;
      }
      const geo = new THREE.BufferGeometry();
      const posArr = new Float32Array(N * 3);
      geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
      const mat = new THREE.PointsMaterial({
        color: w === 'snow' ? 0xffffff : 0x9fc4dc,
        size: w === 'snow' ? 1.1 : 0.8, sizeAttenuation: true,
        transparent: true, opacity: w === 'snow' ? 0.85 : 0.5, depthWrite: false,
      });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      group.add(pts);
      const speed = w === 'snow' ? 10 : 46;
      sys.update = (dt, t) => {
        const arr = geo.attributes.position;
        for (let i = 0; i < N; i++) {
          let a = params[i * 3], th = params[i * 3 + 1];
          th -= (speed * dt) / TUBE * 1.6;
          a += Math.sin(t * 0.7 + params[i * 3 + 2]) * dt * 0.0016;
          if (th < 30 * DEG) { th = (150 + rand() * 25) * DEG; a = this.a0 + rand() * SPAN; params[i * 3] = a; }
          params[i * 3] = a; params[i * 3 + 1] = th;
          const rho = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
          const v = rho.multiplyScalar(R + TUBE * 0.92 * Math.cos(th))
            .add(new THREE.Vector3(0, TUBE * 0.92 * Math.sin(th), 0)).sub(this.offset);
          arr.setXYZ(i, v.x, v.y, v.z);
        }
        arr.needsUpdate = true;
      };
      sys.meshes.push(pts);
      this.weatherSys = sys;
    } else if (w === 'fireflies') {
      const N2 = 46;
      const anchors = new Float32Array(N2 * 3);
      for (let i = 0; i < N2; i++) {
        const a = this.a0 + rand() * SPAN;
        const th = (rand() * 2 - 1) * 40 * DEG;
        const p = this._surfacePoint(a, th, this._reliefFn(a, th));
        anchors.set([p.x, p.y, p.z], i * 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N2 * 3), 3));
      const mat = new THREE.PointsMaterial({
        color: 0xffd76a, size: 7, sizeAttenuation: true, transparent: true,
        opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const pts = new THREE.Points(geo, mat);
      group.add(pts);
      sys.update = (dt, t) => {
        const arr = geo.attributes.position;
        for (let i = 0; i < N2; i++) {
          const ph = i * 1.7;
          arr.setXYZ(
            i,
            anchors[i * 3] + Math.sin(t * 0.8 + ph) * 6,
            anchors[i * 3 + 1] + 3 + Math.sin(t * 1.3 + ph * 1.4) * 4,
            anchors[i * 3 + 2] + Math.cos(t * 0.6 + ph * 0.9) * 6
          );
        }
        arr.needsUpdate = true;
      };
      sys.meshes.push(pts);
      this.weatherSys = sys;
    } else if (w === 'mist') {
      const tex = gradientTexture([[0, 'rgba(255,255,255,0)'], [0.5, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']], 128, false);
      for (let i = 0; i < 16; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: tex, transparent: true, opacity: 0.07, depthWrite: false,
        }));
        sp.scale.set(500 + rand() * 500, 250 + rand() * 300, 1);
        const a = this.a0 + rand() * SPAN;
        const p = this._surfacePoint(a, (rand() * 2 - 1) * 30 * DEG, this._reliefFn(a, 0));
        sp.position.copy(p);
        sp.userData.drift = rand() * TAU;
        group.add(sp);
        sys.meshes.push(sp);
      }
      sys.update = (dt, t) => {
        for (const sp of sys.meshes) {
          sp.position.y += Math.sin(t * 0.12 + sp.userData.drift) * dt * 1.4;
          sp.material.rotation += dt * 0.01;
        }
      };
      this.weatherSys = sys;
    }
  }

  _surfacePoint(a, th, relief) {
    const rho = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const rr = TUBE + relief;
    return rho.multiplyScalar(R + rr * Math.cos(th))
      .add(new THREE.Vector3(0, rr * Math.sin(th), 0));
  }

  // 让物体沿曲面法线“站立”（up = -ρ̂，即朝向环中心）
  _surfaceQuat(a, rot) {
    const up = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).negate();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    return q.multiply(qy);
  }

  _placeInstanced(group, mesh, items, dummy) {
    // 单几何实例化（如仙人掌）
    const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, items.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3();
    items.forEach((t, i) => {
      const pos = this._surfacePoint(t.a, t.th, t.h);
      v.set(pos.x, pos.y, pos.z);
      q.copy(this._surfaceQuat(t.a, t.rot));
      m4.compose(v, q, new THREE.Vector3(t.s, t.s, t.s));
      im.setMatrixAt(i, m4);
    });
    im.instanceMatrix.needsUpdate = true;
    group.add(im);
  }

  // ---------- 主轴内部（零重力） ----------
  enterSpine() {
    this.clear();
    this.mode = 'spine';
    this.biome = null;
    this.scene.fog = new THREE.FogExp2(new THREE.Color('#0a1118'), 0.00075);
    const g = new THREE.Group();
    this.group = g;
    this.root.add(g);
    this.root.visible = true;

    const LEN = 2400, RAD = 60;
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(RAD, RAD, LEN, 40, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x39424e, roughness: 0.6, metalness: 0.6, side: THREE.BackSide })
    );
    g.add(wall);

    // 肋环 + 灯带
    const ribGeo = new THREE.TorusGeometry(RAD, 1.6, 8, 40);
    const ribMat = new THREE.MeshStandardMaterial({ color: 0x2a313b, metalness: 0.8, roughness: 0.5 });
    const lightGeo = new THREE.TorusGeometry(RAD - 1, 1.2, 8, 40);
    const lightMat = new THREE.MeshBasicMaterial({ color: 0x8fd0ff });
    for (let y = -LEN / 2 + 60; y <= LEN / 2 - 60; y += 150) {
      const rib = new THREE.Mesh(ribGeo, ribMat); rib.position.y = y; rib.rotation.x = Math.PI / 2; g.add(rib);
      const l = new THREE.Mesh(lightGeo, lightMat); l.position.y = y + 75; l.rotation.x = Math.PI / 2; g.add(l);
    }

    // 轨道与有轨车
    const railGeo = new THREE.CylinderGeometry(0.7, 0.7, LEN, 8);
    const railMat = new THREE.MeshStandardMaterial({ color: 0x5b6674, metalness: 0.9, roughness: 0.4 });
    [-9, 9].forEach(x => {
      const rail = new THREE.Mesh(railGeo, railMat);
      rail.position.x = x; g.add(rail);
    });
    const tram = new THREE.Group();
    const tramBody = new THREE.Mesh(new THREE.BoxGeometry(14, 8, 30),
      new THREE.MeshStandardMaterial({ color: 0xb8c2d0, metalness: 0.7, roughness: 0.35 }));
    tram.add(tramBody);
    const tramWin = new THREE.Mesh(new THREE.BoxGeometry(13.5, 2.5, 8),
      new THREE.MeshBasicMaterial({ color: 0xa8dcff }));
    tramWin.position.y = 2; tram.add(tramWin);
    tram.position.y = 0;
    g.add(tram);
    this.tram = tram;
    const headlight = new THREE.PointLight(0xcfe8ff, 2600, 500, 1.8);
    headlight.position.set(0, 0, 18);
    tram.add(headlight);

    // 辐条电梯（环A/环B）
    [-800, 800].forEach((y, i) => {
      const ringName = y > 0 ? '环 A' : '环 B';
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(28, 28, 90, 24, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x4a5361, metalness: 0.7, roughness: 0.5, side: THREE.DoubleSide }));
      tube.rotation.z = Math.PI / 2;
      tube.position.set(0, y, 0);
      g.add(tube);
      const door = new THREE.Mesh(new THREE.CylinderGeometry(27, 27, 4, 24),
        new THREE.MeshStandardMaterial({ color: 0x6d7888, metalness: 0.8, roughness: 0.45 }));
      door.rotation.z = Math.PI / 2;
      door.position.set(0, y, 0);
      g.add(door);
      const sign = textSprite(`辐条电梯 → ${ringName}（0.83g 生态环）`, { scale: 24 });
      sign.position.set(0, y + 48, 0);
      g.add(sign);
    });

    // AI 核心 · 波琳
    const ai = new THREE.Group();
    ai.position.set(0, 0, 0);
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(14, 1),
      new THREE.MeshStandardMaterial({ color: 0x0a1420, metalness: 0.9, roughness: 0.2, emissive: 0x2b8fd8, emissiveIntensity: 0.8 }));
    ai.add(core);
    for (let k = 0; k < 3; k++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(24 + k * 7, 0.7, 8, 48),
        new THREE.MeshBasicMaterial({ color: k === 0 ? 0x6fd0ff : k === 1 ? 0x9f8fff : 0x6fffd0, transparent: true, opacity: 0.8 }));
      ring.rotation.set(THREE.MathUtils.degToRad(k * 31), THREE.MathUtils.degToRad(k * 47), 0);
      ring.userData.rotSpeed = 0.4 + k * 0.25;
      ai.add(ring);
    }
    const aiSign = textSprite('量子核心 · 波琳（Pauline）', { scale: 26 });
    aiSign.position.y = 44;
    ai.add(aiSign);
    g.add(ai);
    this.ai = { core, rings: ai.children.filter(c => c.isMesh && c.geometry.type === 'TorusGeometry') };

    // 舰桥（+Y 端）
    const bridge = new THREE.Group();
    bridge.position.y = LEN / 2 - 10;
    const cap = new THREE.Mesh(new THREE.CircleGeometry(RAD, 40),
      new THREE.MeshStandardMaterial({ color: 0x2c3440, roughness: 0.6, metalness: 0.7, side: THREE.DoubleSide }));
    cap.rotation.x = Math.PI / 2;
    bridge.add(cap);
    const viewport = new THREE.Mesh(new THREE.CircleGeometry(RAD * 0.82, 40),
      new THREE.MeshBasicMaterial({ map: this._viewportTexture(), side: THREE.DoubleSide }));
    viewport.rotation.x = Math.PI / 2;
    viewport.position.y = 3;
    bridge.add(viewport);
    const console = new THREE.Mesh(new THREE.BoxGeometry(24, 3, 6),
      new THREE.MeshStandardMaterial({ color: 0x4a5361, metalness: 0.7, roughness: 0.5 }));
    console.position.set(0, -12, -30);
    bridge.add(console);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(18, 6),
      new THREE.MeshBasicMaterial({ color: 0x7fd4ff, side: THREE.DoubleSide }));
    screen.position.set(0, -6, -27.5);
    screen.rotation.x = -0.5;
    bridge.add(screen);
    const sign = textSprite('舰桥 · 指挥与观景', { scale: 24 });
    sign.position.set(0, 40, -20);
    bridge.add(sign);
    g.add(bridge);
    // 舰桥工作灯
    for (const dx of [-36, 36]) {
      const pl = new THREE.PointLight(0xcfe8ff, 2400, 320, 1.6);
      pl.position.set(dx, 1120, -40);
      g.add(pl);
      this.lights.push(pl);
    }

    // 发动机舱（-Y 端）
    const bay = new THREE.Group();
    bay.position.y = -LEN / 2 + 10;
    const cap2 = new THREE.Mesh(new THREE.CircleGeometry(RAD, 40),
      new THREE.MeshStandardMaterial({ color: 0x2c3440, roughness: 0.6, metalness: 0.7, side: THREE.DoubleSide }));
    cap2.rotation.x = -Math.PI / 2;
    bay.add(cap2);
    const reactor = new THREE.Mesh(new THREE.SphereGeometry(22, 24, 18),
      new THREE.MeshStandardMaterial({ color: 0x33220f, roughness: 0.5, metalness: 0.7, emissive: 0xff6a2a, emissiveIntensity: 0.55 }));
    reactor.position.y = -8;
    bay.add(reactor);
    const pipeGeo = new THREE.CylinderGeometry(2.2, 2.2, 60, 10);
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0x7a8694, metalness: 0.9, roughness: 0.35 });
    [-1, 0, 1].forEach((dx, i) => {
      const pipe = new THREE.Mesh(pipeGeo, pipeMat);
      pipe.position.set(dx * 20, -10, i === 0 ? 0 : dx * 18);
      pipe.rotation.z = dx * 0.4;
      bay.add(pipe);
    });
    const sign2 = textSprite('发动机舱 · 聚变堆', { scale: 24 });
    sign2.position.set(0, 40, 0);
    bay.add(sign2);
    g.add(bay);
    this.reactor = reactor;

    // 零重力尘埃
    const dustN = 420;
    const dpos = new Float32Array(dustN * 3);
    const drand = rng(31337);
    for (let i = 0; i < dustN; i++) {
      const a = drand() * TAU;
      const rr = Math.sqrt(drand()) * RAD;
      dpos.set([Math.cos(a) * rr, (drand() * 2 - 1) * (LEN / 2 - 20), Math.sin(a) * rr], i * 3);
    }
    const dgeo = new THREE.BufferGeometry();
    dgeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
    const dust = new THREE.Points(dgeo, new THREE.PointsMaterial({
      color: 0x9fc4dc, size: 1.1, sizeAttenuation: true, transparent: true, opacity: 0.5, depthWrite: false,
    }));
    dust.frustumCulled = false;
    g.add(dust);
    this.dust = { geo: dgeo, n: dustN };

    // 灯光
    const amb = new THREE.AmbientLight(0x263244, 0.85);
    g.add(amb);
    for (let y = -LEN / 2 + 150; y <= LEN / 2 - 150; y += 300) {
      const p = new THREE.PointLight(0x9fd0ff, 1400, 420, 1.7);
      p.position.y = y;
      g.add(p);
      this.lights.push(p);
    }
    this.lights.push(amb);

    this.pos.set(20, 0, 0);
    this.yawZ = Math.PI / 2;
    this.pitchZ = -0.15;
    this.vel.set(0, 0, 0);
  }

  _viewportTexture() {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = '#000208';
    g.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < 700; i++) {
      const x = Math.random() * c.width, y = Math.random() * c.height;
      const s = Math.random() * 1.6;
      g.fillStyle = `rgba(${200 + Math.random() * 55},${210 + Math.random() * 45},255,${0.3 + Math.random() * 0.7})`;
      g.fillRect(x, y, s, s);
    }
    // 天仓五的“极光”世界
    const cx = c.width * 0.66, cy = c.height * 0.36, pr = 74;
    const gr = g.createRadialGradient(cx - pr * 0.3, cy - pr * 0.3, pr * 0.2, cx, cy, pr);
    gr.addColorStop(0, '#bfe6d8');
    gr.addColorStop(0.55, '#3f8a8a');
    gr.addColorStop(1, '#173a55');
    g.fillStyle = gr;
    g.beginPath(); g.arc(cx, cy, pr, 0, TAU); g.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // ---------- 每帧更新 ----------
  update(dt, input) {
    this.time += dt;
    if (this.mode === 'biome' && this.group) {
      this._updateBiomePlayer(dt, input);
      if (this.weatherSys && this.weatherSys.update) this.weatherSys.update(dt, this.time);
      // 门状态
      for (const key of ['aft', 'fwd']) {
        const door = this.doors[key];
        if (!door) continue;
        const distFwd = this._arcDistTo(door.userData.boundaryAngle);
        const want = distFwd < 240 ? 1 : 0;
        const d = door.userData;
        d.open += (want - d.open) * Math.min(1, dt * 2.2);
        d.door.rotation.x = -Math.PI / 2 + d.open * 1.9 * d.dir;
      }
      return this._boundaryCheck();
    }
    if (this.mode === 'spine' && this.group) {
      this._updateSpinePlayer(dt, input);
      if (this.tram) {
        this.tram.position.y = Math.sin(this.time * 0.06) * 700;
      }
      if (this.ai) {
        this.ai.core.material.emissiveIntensity = 0.6 + Math.sin(this.time * 2.2) * 0.35;
        for (const r of this.ai.rings) r.rotation.y += dt * r.userData.rotSpeed;
      }
      if (this.reactor) {
        this.reactor.material.emissiveIntensity = 0.4 + Math.sin(this.time * 3.1) * 0.22;
      }
      if (this.dust) {
        const arr = this.dust.geo.attributes.position;
        for (let i = 0; i < this.dust.n; i++) {
          arr.setY(i, arr.getY(i) + Math.sin(this.time * 0.5 + i) * dt * 1.2);
        }
        arr.needsUpdate = true;
      }
    }
    return null;
  }

  _arcDistTo(boundaryAngle) {
    return Math.abs(this.p.a - boundaryAngle) * (R + TUBE);
  }

  _updateBiomePlayer(dt, input) {
    const arch = this.arch;
    const speed = input.sprint ? 12.5 : 6.2;
    const rho = new THREE.Vector3(Math.cos(this.p.a), 0, Math.sin(this.p.a));
    const up = rho.clone().negate();

    // 由相机朝向推导前进方向
    const fwdV = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const fFlat = fwdV.clone().addScaledVector(rho, -fwdV.dot(rho)).normalize();
    const rightV = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const rFlat = rightV.clone().addScaledVector(rho, -rightV.dot(rho)).normalize();

    const t = new THREE.Vector3(-Math.sin(this.p.a), 0, Math.cos(this.p.a)); // +φ 切线
    const c = rho.clone().multiplyScalar(Math.sin(this.p.th))
      .add(new THREE.Vector3(0, Math.cos(this.p.th), 0)); // 截面切线

    let wv = new THREE.Vector3();
    if (input.keys.has('KeyW') || input.keys.has('ArrowUp')) wv.add(fFlat);
    if (input.keys.has('KeyS') || input.keys.has('ArrowDown')) wv.sub(fFlat);
    if (input.keys.has('KeyD') || input.keys.has('ArrowRight')) wv.add(rFlat);
    if (input.keys.has('KeyA') || input.keys.has('ArrowLeft')) wv.sub(rFlat);
    if (wv.lengthSq() > 0) wv.normalize();

    // 涉水减速
    const reliefNow = this._reliefFn(this.p.a, this.p.th);
    let mult = 1;
    if (arch.waterBody !== 'none' && reliefNow < -2.4) mult = 0.42;
    const Reff = R + TUBE + reliefNow;
    const da = (wv.dot(t) * speed * mult * dt) / Reff;
    const dth = (wv.dot(c) * speed * mult * dt) / TUBE;
    this.p.a += da;
    this.p.th = clamp(this.p.th + dth, -48 * DEG, 48 * DEG);

    // 头部摆动（步态）
    const moving = wv.lengthSq() > 0.01;
    this.p.bob += dt * (moving ? 8 : 0);

    // 相机
    const relief = this._reliefFn(this.p.a, this.p.th);
    const rSurf = TUBE + relief;
    const posAbs = rho.multiplyScalar(R + rSurf * Math.cos(this.p.th))
      .add(new THREE.Vector3(0, rSurf * Math.sin(this.p.th), 0));
    const eye = 1.7 + Math.sin(this.p.bob) * 0.045 * (moving ? 1 : 0);
    this.camera.position.copy(posAbs).addScaledVector(up, eye).sub(this.offset);

    const f = t.clone().multiplyScalar(Math.cos(this.p.yaw))
      .add(c.clone().multiplyScalar(Math.sin(this.p.yaw)));
    f.addScaledVector(rho, -f.dot(rho)).normalize();
    const right = new THREE.Vector3().crossVectors(f, up);
    const m4 = new THREE.Matrix4().makeBasis(right, up, f.clone().negate());
    this.camera.quaternion.setFromRotationMatrix(m4);
    const qp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.p.pitch);
    this.camera.quaternion.multiply(qp);

    // 闸门关闭时挡住去路
    const lim = 0.6 * DEG;
    if (this.p.a > this.a1 - lim && (!this.doors.fwd || this.doors.fwd.userData.open < 0.55)) {
      this.p.a = this.a1 - lim;
    }
    if (this.p.a < this.a0 + lim && (!this.doors.aft || this.doors.aft.userData.open < 0.55)) {
      this.p.a = this.a0 + lim;
    }
  }

  _updateSpinePlayer(dt, input) {
    const speed = input.sprint ? 260 : 80;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitchZ, this.yawZ, 0, 'YXZ'));
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const r = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const u = new THREE.Vector3(0, 1, 0);
    const acc = new THREE.Vector3();
    if (input.keys.has('KeyW') || input.keys.has('ArrowUp')) acc.add(f);
    if (input.keys.has('KeyS') || input.keys.has('ArrowDown')) acc.sub(f);
    if (input.keys.has('KeyD') || input.keys.has('ArrowRight')) acc.add(r);
    if (input.keys.has('KeyA') || input.keys.has('ArrowLeft')) acc.sub(r);
    if (input.keys.has('ShiftLeft') || input.keys.has('ShiftRight')) acc.add(u);
    if (input.keys.has('ControlLeft') || input.keys.has('ControlRight')) acc.sub(u);
    if (acc.lengthSq() > 0) {
      acc.normalize().multiplyScalar(speed * (input.sprint ? 2.6 : 1));
      this.vel.lerp(acc, Math.min(1, dt * 5));
    } else {
      this.vel.multiplyScalar(Math.max(0, 1 - dt * 1.4));
    }
    this.pos.addScaledVector(this.vel, dt);
    const rad = Math.hypot(this.pos.x, this.pos.z);
    if (rad > 50) {
      this.pos.x *= 50 / rad;
      this.pos.z *= 50 / rad;
    }
    this.pos.y = clamp(this.pos.y, -1160, 1160);
    this.camera.position.copy(this.pos);
    this.camera.quaternion.copy(q);
  }

  applyLook(dx, dy) {
    if (this.mode === 'biome') {
      this.p.yaw -= dx * 0.0022;
      this.p.pitch = clamp(this.p.pitch - dy * 0.0022, -1.45, 1.45);
    } else {
      this.yawZ -= dx * 0.0022;
      this.pitchZ = clamp(this.pitchZ - dy * 0.0022, -1.5, 1.5);
    }
  }

  _boundaryCheck() {
    const m = 0.65 * DEG;
    if (this.p.a > this.a1 - m) {
      const door = this.doors.fwd;
      if (door && door.userData.open > 0.85) return { dir: 1, id: this._nextBiomeId(1), name: this._nextBiomeName(1) };
    }
    if (this.p.a < this.a0 + m) {
      const door = this.doors.aft;
      if (door && door.userData.open > 0.85) return { dir: -1, id: this._nextBiomeId(-1), name: this._nextBiomeName(-1) };
    }
    return null;
  }

  dispose() {
    this.clear();
    this.root.parent?.remove(this.root);
    disposeObject(this.root);
  }

  clear() {
    if (this.group) {
      this.root.remove(this.group);
      disposeObject(this.group);
      this.group = null;
    }
    this.lights = [];
    this.weatherSys = null;
    this.doors = { aft: null, fwd: null };
    this.tram = null;
    this.ai = null;
    this.reactor = null;
    this.dust = null;
    this._disposables = [];
  }
}
