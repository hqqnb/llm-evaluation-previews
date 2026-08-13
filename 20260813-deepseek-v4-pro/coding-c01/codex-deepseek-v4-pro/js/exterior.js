// ---------- 飞船外部模型：主轴 + 双生态环 + 辐条 + 舰桥 + 发动机 + 减速磁场 ----------
import * as THREE from 'three';
import { SHIP, BIOMES, PARTS } from './config.js';
import { TAU, rng, clamp, buildTubeSurface, gradientTexture, radialGlowTexture, disposeObject } from './utils.js';

const DEG = Math.PI / 180;

function annulusGeometry(R, r, f0, f1, segs = 40, side = 48) {
  const positions = [];
  const indices = [];
  for (let i = 0; i <= segs; i++) {
    const f = f0 + ((f1 - f0) * i) / segs;
    for (let j = 0; j <= side; j++) {
      const th = (TAU * j) / side;
      positions.push(
        R * Math.cos(0) * 0 + r * f * Math.cos(th), // x 暂以 ρ̂ 为 x
        r * f * Math.sin(th),
        0
      );
    }
  }
  // 上式为局部（ρ̂,k̂,t̂）坐标系：x=径向、y=k、z=切向
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < side; j++) {
      const a = i * (side + 1) + j;
      const b = a + side + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// 把局部（x=ρ̂, y=k, z=t̂）坐标放置到环上角度 a 处
function orientToRingAngle(mesh, angle, ringY, R = 0) {
  const rho = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
  const k = new THREE.Vector3(0, 1, 0);
  const t = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
  const m = new THREE.Matrix4().makeBasis(rho, k, t);
  mesh.quaternion.setFromRotationMatrix(m);
  mesh.position.copy(rho.multiplyScalar(R)).add(k.multiplyScalar(ringY));
}

export function buildShip() {
  const root = new THREE.Group();
  const navLights = [];
  const pickables = [];       // 用于 hover/点击
  const byPart = {};          // partId -> {meshes, baseEmissive}
  const biomeMeshes = new Map(); // biomeId -> {meshes, focus}
  const partFocus = {};

  const hullMat = () => new THREE.MeshStandardMaterial({
    color: 0x9aa3b2, metalness: 0.82, roughness: 0.42,
  });
  const darkMat = () => new THREE.MeshStandardMaterial({
    color: 0x56606e, metalness: 0.85, roughness: 0.55,
  });

  const register = (partId, mesh, matList = null) => {
    if (matList) mesh.userData.mats = matList;
    mesh.userData.partId = partId;
    pickables.push(mesh);
    if (!byPart[partId]) byPart[partId] = { meshes: [], mats: new Set() };
    byPart[partId].meshes.push(mesh);
    (matList || (mesh.material ? [mesh.material] : [])).forEach(m => byPart[partId].mats.add(m));
  };

  const highlightMesh = (m, on) => {
    if (m.userData.mats) {
      for (const mat of m.userData.mats) {
        if (!mat.userData._baseEmissive) {
          mat.userData._baseEmissive = mat.emissive.getHex();
          mat.userData._baseEmInt = mat.emissiveIntensity;
        }
        mat.emissive.setHex(on ? 0x4a9de8 : mat.userData._baseEmissive);
        mat.emissiveIntensity = on ? 0.28 : mat.userData._baseEmInt;
      }
    } else if (m.material && m.material.isMeshStandardMaterial) {
      if (!m.material.userData._baseEmissive) {
        m.material.userData._baseEmissive = m.material.emissive.getHex();
        m.material.userData._baseEmInt = m.material.emissiveIntensity;
      }
      m.material.emissive.setHex(on ? 0x4a9de8 : m.material.userData._baseEmissive);
      m.material.emissiveIntensity = on ? 0.28 : m.material.userData._baseEmInt;
    }
  };

  // ---------- 主轴 ----------
  const spineGroup = new THREE.Group();
  root.add(spineGroup);
  const spine = new THREE.Mesh(
    new THREE.CylinderGeometry(SHIP.spineRadius, SHIP.spineRadius, SHIP.spineLength, 24, 1),
    new THREE.MeshStandardMaterial({ color: 0x7d8694, metalness: 0.85, roughness: 0.38 })
  );
  register('spine', spine);
  spineGroup.add(spine);

  const ribGeo = new THREE.TorusGeometry(SHIP.spineRadius + 3, 5, 8, 32);
  for (let y = -4400; y <= 4400; y += 550) {
    const rib = new THREE.Mesh(ribGeo, darkMat());
    rib.position.y = y;
    rib.rotation.x = Math.PI / 2;
    spineGroup.add(rib);
  }
  // 服务轨道
  const railGeo = new THREE.BoxGeometry(2.2, SHIP.spineLength, 2.2);
  for (const ang of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const rail = new THREE.Mesh(railGeo, new THREE.MeshStandardMaterial({ color: 0x2c3440, metalness: 0.7, roughness: 0.6 }));
    rail.position.set(Math.cos(ang) * (SHIP.spineRadius - 4), 0, Math.sin(ang) * (SHIP.spineRadius - 4));
    spineGroup.add(rail);
  }

  // ---------- 舰桥 ----------
  const bridgeGroup = new THREE.Group();
  bridgeGroup.position.y = SHIP.spineLength / 2;
  root.add(bridgeGroup);
  const bridgeBody = new THREE.Mesh(new THREE.CylinderGeometry(70, 72, 260, 24), hullMat());
  bridgeBody.position.y = 130;
  register('bridge', bridgeBody);
  bridgeGroup.add(bridgeBody);
  const bridgeNose = new THREE.Mesh(new THREE.CylinderGeometry(10, 72, 180, 24), hullMat());
  bridgeNose.position.y = 350;
  register('bridge', bridgeNose);
  bridgeGroup.add(bridgeNose);
  const bridgeWin = new THREE.Mesh(
    new THREE.CylinderGeometry(73, 73, 26, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x9fd8ff })
  );
  bridgeWin.position.y = 60;
  bridgeGroup.add(bridgeWin);
  // 对地通信天线
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 160, 8), darkMat());
  boom.position.set(40, 430, 0);
  bridgeGroup.add(boom);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(26, 20, 12, 0, TAU, 0, Math.PI / 2), darkMat());
  dish.position.set(40, 500, 0);
  dish.rotation.x = Math.PI / 2;
  bridgeGroup.add(dish);
  // 航行灯
  const navLight = (x, color) => {
    const l = new THREE.Mesh(new THREE.SphereGeometry(3.2, 10, 10),
      new THREE.MeshBasicMaterial({ color }));
    l.position.set(x, 300, 0);
    l.userData.navPhase = Math.random() * TAU;
    bridgeGroup.add(l);
    navLights.push(l);
  };
  navLight(64, 0xff4433);
  navLight(-64, 0x33ff77);

  // ---------- 发动机 ----------
  const engineGroup = new THREE.Group();
  engineGroup.position.y = -SHIP.spineLength / 2;
  root.add(engineGroup);
  const engineBody = new THREE.Mesh(new THREE.CylinderGeometry(64, 66, 200, 24), darkMat());
  engineBody.position.y = -100;
  register('engine', engineBody);
  engineGroup.add(engineBody);

  const nozzleGeo = (r0, r1, h) => new THREE.CylinderGeometry(r0, r1, h, 20, 1, true);
  const bells = [];
  const bellSpecs = [
    { r0: 10, r1: 48, h: 210, dx: 0, dz: 0 },
    { r0: 8, r1: 34, h: 170, dx: 46, dz: 0 },
    { r0: 8, r1: 34, h: 170, dx: -46, dz: 0 },
    { r0: 8, r1: 34, h: 170, dx: 0, dz: 46 },
    { r0: 8, r1: 34, h: 170, dx: 0, dz: -46 },
  ];
  for (const s of bellSpecs) {
    const bell = new THREE.Mesh(nozzleGeo(s.r0, s.r1, s.h),
      new THREE.MeshStandardMaterial({ color: 0x333b47, metalness: 0.9, roughness: 0.35 }));
    bell.position.set(s.dx, -200 - s.h / 2, s.dz);
    bells.push(bell);
    engineGroup.add(bell);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(s.r1 * 0.86, 20),
      new THREE.MeshBasicMaterial({ color: 0xbfe8ff }));
    glow.position.set(s.dx, -200 - s.h - 0.5, s.dz);
    glow.rotation.x = -Math.PI / 2;
    glow.userData.plasmaGlow = true;
    engineGroup.add(glow);
  }
  // 尾焰等离子锥
  const plasmaTex = gradientTexture([[0, 'rgba(255,255,255,0.9)'], [0.25, 'rgba(120,190,255,0.55)'], [1, 'rgba(40,80,160,0)']], 256, false);
  const plasma = new THREE.Mesh(
    new THREE.CylinderGeometry(330, 3, 7200, 24, 1, true),
    new THREE.MeshBasicMaterial({
      map: plasmaTex, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })
  );
  plasma.position.y = -3600;
  engineGroup.add(plasma);

  // 尾焰粒子
  const jetN = 600;
  const jetPos = new Float32Array(jetN * 3);
  const jetData = new Float32Array(jetN); // 生命进度
  const jetRand = rng(4242);
  for (let i = 0; i < jetN; i++) {
    const a = jetRand() * TAU;
    const rr = jetRand() * 40;
    jetPos.set([Math.cos(a) * rr, -200 - jetRand() * 3000, Math.sin(a) * rr], i * 3);
    jetData[i] = jetRand();
  }
  const jetGeo = new THREE.BufferGeometry();
  jetGeo.setAttribute('position', new THREE.BufferAttribute(jetPos, 3));
  const jetMat = new THREE.PointsMaterial({
    color: 0x8fc8ff, size: 19, sizeAttenuation: true,
    transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const jet = new THREE.Points(jetGeo, jetMat);
  jet.frustumCulled = false;
  engineGroup.add(jet);

  // ---------- 减速磁场（Decel） ----------
  const decelRoot = new THREE.Group();
  decelRoot.position.y = SHIP.spineLength / 2 + 460;
  root.add(decelRoot);
  const decelState = { deploy: 0, target: 0 };

  const sailR = 2800, sailDepth = 1500;
  const lineGeo = new THREE.BufferGeometry();
  const linePts = [];
  const addLine = (p0, p1) => { linePts.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z); };
  const paraboloid = s => {
    const v = new THREE.Vector3(0, -sailDepth * s, 0);
    const rad = sailR * Math.sqrt(s);
    return { y: -sailDepth * s, rad };
  };
  // 经线
  for (let k = 0; k < 30; k++) {
    const ang = (TAU * k) / 30;
    let prev = new THREE.Vector3(0, 0, 0);
    for (let s = 0.02; s <= 1.001; s += 0.05) {
      const { y, rad } = paraboloid(s);
      const p = new THREE.Vector3(Math.cos(ang) * rad, y, Math.sin(ang) * rad);
      addLine(prev, p);
      prev = p;
    }
  }
  // 纬线
  for (let s = 0.2; s <= 0.95; s += 0.075) {
    const { y, rad } = paraboloid(s);
    for (let k = 0; k < 48; k++) {
      const a0 = (TAU * k) / 48, a1 = (TAU * (k + 1)) / 48;
      addLine(
        new THREE.Vector3(Math.cos(a0) * rad, y, Math.sin(a0) * rad),
        new THREE.Vector3(Math.cos(a1) * rad, y, Math.sin(a1) * rad)
      );
    }
  }
  lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(linePts), 3));
  const decelLines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({
    color: 0x5fd8ff, transparent: true, opacity: 0.58, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  decelRoot.add(decelLines);

  // 磁场壳（LatheGeometry 抛物面）
  const profile = [];
  for (let s = 0; s <= 1.001; s += 0.02) {
    profile.push(new THREE.Vector2(sailR * Math.sqrt(s), -sailDepth * s));
  }
  const shell = new THREE.Mesh(
    new THREE.LatheGeometry(profile, 48),
    new THREE.MeshBasicMaterial({
      color: 0x3fa8e0, transparent: true, opacity: 0.09,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })
  );
  decelRoot.add(shell);

  // 场粒子
  const fieldN = 500;
  const fieldPos = new Float32Array(fieldN * 3);
  const fieldAng = new Float32Array(fieldN);
  const fieldSpeed = new Float32Array(fieldN);
  const fr = rng(991);
  for (let i = 0; i < fieldN; i++) {
    const s = fr();
    const ang = fr() * TAU;
    const { y, rad } = paraboloid(s);
    fieldPos.set([Math.cos(ang) * rad, y, Math.sin(ang) * rad], i * 3);
    fieldAng[i] = ang;
    fieldSpeed[i] = 0.2 + fr() * 1.2;
  }
  const fieldGeo = new THREE.BufferGeometry();
  fieldGeo.setAttribute('position', new THREE.BufferAttribute(fieldPos, 3));
  const fieldPts = new THREE.Points(fieldGeo, new THREE.PointsMaterial({
    color: 0x7fe0ff, size: 9, sizeAttenuation: true, transparent: true, opacity: 0.8,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  fieldPts.frustumCulled = false;
  decelRoot.add(fieldPts);
  decelRoot.scale.set(1, 0.001, 1);
  decelRoot.visible = false;
  register('decel', decelLines);

  // ---------- 生态环 ----------
  const ringGroups = { A: new THREE.Group(), B: new THREE.Group() };
  function buildBiomeRing(letter, ringY, offsetDeg, spinDir) {
    const ring = new THREE.Group();
    ring.position.y = ringY;
    ring.userData.spinDir = spinDir;
    const biomes = BIOMES.filter(b => b.ring === letter);
    const R = SHIP.ringMajorRadius;

    // 轴承环（固定）在 root 上
    const bearing = new THREE.Mesh(
      new THREE.TorusGeometry(SHIP.bearingRadius, SHIP.bearingTube, 12, 48),
      darkMat()
    );
    bearing.position.y = ringY;
    bearing.rotation.x = Math.PI / 2;
    root.add(bearing);

    // 内结构环（随环旋转）
    const hub = new THREE.Mesh(
      new THREE.TorusGeometry(SHIP.hubRingRadius, SHIP.hubRingTube, 12, 48),
      new THREE.MeshStandardMaterial({ color: 0x9aa3b0, metalness: 0.85, roughness: 0.4 })
    );
    hub.rotation.x = Math.PI / 2;
    ring.add(hub);
    register('spokes', hub);

    // 辐条
    const spokeLen = R - SHIP.biomeRadius - SHIP.hubRingRadius;
    const spokeGeo = new THREE.CylinderGeometry(26, 26, spokeLen, 10);
    const spokeMat = new THREE.MeshStandardMaterial({ color: 0x9aa3b0, metalness: 0.85, roughness: 0.45 });
    const stripGeo = new THREE.BoxGeometry(2.5, spokeLen, 2.5);
    const stripMat = new THREE.MeshBasicMaterial({ color: 0x5f8fbe });
    for (let k = 0; k < SHIP.spokeCount; k++) {
      const ang = (TAU * k) / SHIP.spokeCount + offsetDeg * DEG;
      const spoke = new THREE.Mesh(spokeGeo, spokeMat);
      const mid = (SHIP.hubRingRadius + R - SHIP.biomeRadius) / 2;
      orientToRingAngle(spoke, ang, 0, mid);
      ring.add(spoke);
      register('spokes', spoke, [spokeMat]);
      const strip = new THREE.Mesh(stripGeo, stripMat);
      strip.position.set(Math.cos(ang) * (mid + 22), 0, Math.sin(ang) * (mid + 22));
      strip.lookAt(0, 0, 0);
      ring.add(strip);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(5, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xfff2cc }));
      tip.position.set(Math.cos(ang) * (R - SHIP.biomeRadius), 0, Math.sin(ang) * (R - SHIP.biomeRadius));
      tip.userData.navPhase = k * 1.7;
      navLights.push(tip);
      ring.add(tip);
    }

    // 生态舱
    const span = (TAU / SHIP.biomeCountPerRing) / 2; // 每段 ±15°
    biomes.forEach((biome, i) => {
      const c = (TAU * i) / SHIP.biomeCountPerRing; // 中心角
      const segGroup = new THREE.Group();
      segGroup.name = `biome-${biome.id}`;
      ring.add(segGroup);

      // 舱体外壳（整段环形管）
      const hull = new THREE.Mesh(
        buildTubeSurface({ R, r: SHIP.biomeRadius, a0: c - span, a1: c + span, th0: 0, th1: TAU, tubeSegs: 36, sideSegs: 44 }),
        hullMat()
      );
      hull.userData.biomeId = biome.id;
      hull.userData.isBiome = true;
      hull.userData.ringY = ringY;
      hull.userData.centerAngle = c;
      register('biomes', hull);
      segGroup.add(hull);

      // 采光面（朝向主轴，颜色随生态舱光照）
      const lightColor = new THREE.Color(getBiomeLight(biome));
      const win = new THREE.Mesh(
        buildTubeSurface({ R, r: SHIP.biomeRadius + 1.5, a0: c - span, a1: c + span, th0: 150 * DEG, th1: 210 * DEG, tubeSegs: 36, sideSegs: 16 }),
        new THREE.MeshBasicMaterial({ color: lightColor })
      );
      win.userData.biomeId = biome.id;
      win.userData.isBiome = true;
      win.userData.ringY = ringY;
      win.userData.centerAngle = c;
      segGroup.add(win);

      // 光晕
      const haloTex = gradientTexture([[0, 'rgba(0,0,0,0)'], [0.5, 'rgba(255,255,255,1)'], [1, 'rgba(0,0,0,0)']], 128, false);
      const halo = new THREE.Mesh(
        buildTubeSurface({ R, r: SHIP.biomeRadius + 2.2, a0: c - span, a1: c + span, th0: 126 * DEG, th1: 234 * DEG, tubeSegs: 30, sideSegs: 12 }),
        new THREE.MeshBasicMaterial({
          map: haloTex, color: lightColor, transparent: true, opacity: 0.28,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        })
      );
      segGroup.add(halo);
    });

    // 舱间闸门（30° 相接处）
    for (let i = 0; i < SHIP.biomeCountPerRing; i++) {
      const b = ((i + 0.5) * TAU) / SHIP.biomeCountPerRing; // 边界角
      // 舱壁
      const wall = new THREE.Mesh(annulusGeometry(R, SHIP.biomeRadius, 0.13, 1.0), darkMat());
      orientToRingAngle(wall, b, 0, R);
      ring.add(wall);
      // 外接缝环
      const seam = new THREE.Mesh(new THREE.TorusGeometry(SHIP.biomeRadius + 1, 7, 10, 48), darkMat());
      seam.position.set(R * Math.cos(b), 0, R * Math.sin(b));
      const t = new THREE.Vector3(-Math.sin(b), 0, Math.cos(b));
      seam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), t);
      ring.add(seam);
      // 闸门锁（连通隧道，两端斜置 15°）
      const lock = new THREE.Mesh(new THREE.CylinderGeometry(64, 64, 720, 18, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x3c4654, metalness: 0.8, roughness: 0.5, side: THREE.DoubleSide }));
      lock.position.set(R * Math.cos(b), 0, R * Math.sin(b));
      lock.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-Math.sin(b), 0, Math.cos(b)));
      ring.add(lock);
      const rimGeo = new THREE.TorusGeometry(66, 4, 8, 20);
      const rimMat = new THREE.MeshBasicMaterial({ color: 0xffd27f });
      [-1, 1].forEach(sgn => {
        const rim = new THREE.Mesh(rimGeo, rimMat);
        rim.position.set(R * Math.cos(b) + Math.cos(b) * 0, 0, R * Math.sin(b));
        orientToRingAngle(rim, b, 0, R);
        rim.translateZ(sgn * 360);
        rim.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), t);
        ring.add(rim);
      });
    }
    return ring;
  }

  const ringA = buildBiomeRing('A', SHIP.ringAY, 0, 1);
  const ringB = buildBiomeRing('B', SHIP.ringBY, 30, -1);
  ringGroups.A = ringA;
  ringGroups.B = ringB;
  root.add(ringA, ringB);

  // 环整体焦点
  partFocus.spine = { pos: new THREE.Vector3(SHIP.spineLength * 0.72, SHIP.spineLength * 0.42, SHIP.spineLength * 0.78), tgt: new THREE.Vector3(0, 0, 0) };
  partFocus.ringA = { pos: new THREE.Vector3(0, SHIP.ringAY + 3600, SHIP.ringMajorRadius + 3600), tgt: new THREE.Vector3(0, SHIP.ringAY, 0) };
  partFocus.ringB = { pos: new THREE.Vector3(0, SHIP.ringBY + 3600, SHIP.ringMajorRadius + 3600), tgt: new THREE.Vector3(0, SHIP.ringBY, 0) };
  partFocus.spokes = { pos: new THREE.Vector3(0, SHIP.ringAY + 2600, SHIP.ringMajorRadius + 2200), tgt: new THREE.Vector3(0, SHIP.ringAY, SHIP.ringMajorRadius * 0.45) };
  partFocus.bridge = { pos: new THREE.Vector3(3000, 5900, 2800), tgt: new THREE.Vector3(0, 5200, 0) };
  partFocus.engine = { pos: new THREE.Vector3(2400, -5350, 2200), tgt: new THREE.Vector3(0, -5150, 0) };
  partFocus.decel = { pos: new THREE.Vector3(4200, 6800, 4200), tgt: new THREE.Vector3(0, 5500, 0) };
  partFocus.biomes = { pos: new THREE.Vector3(0, SHIP.ringAY + 2500, SHIP.ringMajorRadius + 2200), tgt: new THREE.Vector3(0, SHIP.ringAY, SHIP.ringMajorRadius * 0.9) };

  for (const biome of BIOMES) {
    const idx = BIOMES.findIndex(b => b.id === biome.id) % 12;
    const c = (TAU * idx) / 12;
    const R = SHIP.ringMajorRadius;
    const y = biome.ring === 'A' ? SHIP.ringAY : SHIP.ringBY;
    biomeMeshes.set(biome.id, { centerAngle: c, ringY: y, meshes: [] });
    partFocus[`biome:${biome.id}`] = {
      pos: new THREE.Vector3(Math.cos(c) * (R + 1300), y + 1000, Math.sin(c) * (R + 1300)),
      tgt: new THREE.Vector3(Math.cos(c) * R, y, Math.sin(c) * R),
    };
  }

  // 收集 biome mesh 引用
  for (const m of pickables) {
    if (m.userData.isBiome) {
      const entry = biomeMeshes.get(m.userData.biomeId);
      if (entry) entry.meshes.push(m);
    }
  }

  const api = {
    root, pickables, biomeMeshes, byPart, partFocus,
    ringGroups, decelState, navLights, plasma, jet, jetGeo, jetPos, jetData, jetN, fieldPts, fieldGeo, fieldPos, fieldSpeed, fieldN,
    decelRoot,
    ringAY: SHIP.ringAY, ringBY: SHIP.ringBY,

    update(dt, t, opts = {}) {
      const { spinSpeed = 0.1047, travelSpeed = 0, decel = false } = opts;
      ringA.rotation.y += spinSpeed * dt * ringA.userData.spinDir;
      ringB.rotation.y += spinSpeed * dt * ringB.userData.spinDir;

      // 尾焰脉动
      const thrust = 0.55 + travelSpeed / 9000;
      const pulse = 1 + Math.sin(t * 2.1) * 0.045;
      plasma.scale.set(1, 1 * (0.85 + thrust * 0.35) * pulse, 1);
      plasma.material.opacity = 0.55 + thrust * 0.45;
      for (const g of engineGroup.children) {
        if (g.userData.plasmaGlow) {
          const s = 1 + Math.sin(t * 3.3 + g.position.x) * 0.1;
          g.scale.setScalar(s);
        }
      }
      const jpos = jetGeo.attributes.position;
      for (let i = 0; i < jetN; i++) {
        let y = jpos.getY(i) - (700 + travelSpeed * 0.25) * dt;
        if (y < -3200) {
          const a = Math.random() * TAU, rr = Math.random() * 40;
          jpos.setX(i, Math.cos(a) * rr);
          jpos.setY(i, -200);
          jpos.setZ(i, Math.sin(a) * rr);
        } else jpos.setY(i, y);
      }
      jpos.needsUpdate = true;

      // 航行灯闪烁
      for (const l of navLights) {
        const on = Math.sin(t * 3 + (l.userData.navPhase || 0)) > 0.25;
        l.visible = on;
      }

      // 减速磁场展开
      decelState.target = decel ? 1 : 0;
      decelState.deploy += (decelState.target - decelState.deploy) * Math.min(1, dt * 1.6);
      const d = decelState.deploy;
      decelRoot.visible = d > 0.01;
      decelRoot.scale.set(1, Math.max(0.001, d), 1);
      decelLines.material.opacity = 0.58 * d;
      shell.material.opacity = 0.09 * d;
      fieldPts.material.opacity = 0.8 * d;
      const fpos = fieldGeo.attributes.position;
      for (let i = 0; i < fieldN; i++) {
        const s = (fpos.getY(i) / -sailDepth);
        const ns = s + fieldSpeed[i] * dt * 0.12;
        if (ns > 1) {
          fieldAng[i] = Math.random() * TAU;
          fpos.setX(i, 0); fpos.setY(i, 0); fpos.setZ(i, 0);
        } else {
          const { y, rad } = paraboloid(ns);
          const ang = fieldAng[i];
          fpos.setX(i, Math.cos(ang) * rad);
          fpos.setY(i, y);
          fpos.setZ(i, Math.sin(ang) * rad);
        }
      }
      fpos.needsUpdate = true;
    },

    setPartHighlight(partId, on) {
      const entry = byPart[partId];
      if (!entry) return;
      for (const m of entry.meshes) highlightMesh(m, on);
    },

    setBiomeHighlight(id, on) {
      const entry = this.biomeMeshes.get(id);
      if (!entry) return;
      for (const m of entry.meshes) highlightMesh(m, on);
    },

    getBiomeWorld(id) {
      const e = this.biomeMeshes.get(id);
      if (!e) return null;
      const ring = e.ringY > 0 ? ringA : ringB;
      const ang = e.centerAngle + ring.rotation.y;
      const R = SHIP.ringMajorRadius;
      return {
        pos: new THREE.Vector3(Math.cos(ang) * R, e.ringY, Math.sin(ang) * R),
        cam: new THREE.Vector3(Math.cos(ang) * (R + 1800), e.ringY + 900, Math.sin(ang) * (R + 1800)),
        ang, R, y: e.ringY,
      };
    },

    dispose() { disposeObject(root); },
  };
  return api;
}

function getBiomeLight(biome) {
  const map = {
    coast: '#ffe9b8', farm: '#ffe0a0', alpine: '#eaf6ff', taiga: '#dcecff',
    river: '#eaffdc', plateau: '#ffedc8', steppe: '#fff0c8', med: '#fff0d0',
    savanna: '#ffe9b0', jungle: '#d4ffcc', tropical: '#d8ffd0', alpine2: '#e8f4ff',
    prairie: '#fff2cc', boreal: '#e6f2ff', pampa: '#fff2d0', desert: '#ffecc0',
    forest: '#ffefcc', rainforest: '#d8ffec', patagonia: '#eef6ff', generic: '#f0f6e0',
  };
  return map[biome.type] || '#fff0d0';
}

export { DEG };
