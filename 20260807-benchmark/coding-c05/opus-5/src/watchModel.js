/**
 * 3D 腕表几何建模：表壳、表圈、镜面、表盘（带星期/日期视窗）、
 * 星期盘 + 日期盘、时/分/秒针 + 24 小时第二时区指针、表冠、表耳、金属链带。
 *
 * 坐标约定：表盘位于 XY 平面、法线朝 +Z；12 点方向为 +Y；手腕轴向为 X。
 */
import * as THREE from 'three';

export const DIAL_R = 1.58;

const Z = {
  backOuter: -0.62,
  caseBottom: -0.36,
  caseTop: 0.4,
  basePlate: 0.2,
  discs: 0.26,
  dial: 0.3,
  dialDepth: 0.04,
  frame: 0.29,
  markers: 0.34,
  gmtHand: 0.375,
  hourHand: 0.405,
  minuteHand: 0.435,
  secondHand: 0.465,
  cap: 0.48,
  crystal: 0.56,
  bezel: 0.46,
};

// 视窗（holes）参数：星期在 12 点（外圈），日期在 3 点（内圈），径向不重叠
const DAY_WINDOW = { cx: 0, cy: 1.18, w: 0.52, h: 0.26, r: 0.05 };
const DATE_WINDOW = { cx: 0.8, cy: 0, w: 0.32, h: 0.26, r: 0.05 };
const DAY_RING = { inner: 1.0, outer: 1.38, textRadius: 1.18 };
const DATE_RING = { inner: 0.6, outer: 0.98, textRadius: 0.8 };

const COLORS = {
  steel: 0xd9dee6,
  steelDark: 0x9aa2ad,
  gold: 0xe8b563,
  dialA: '#16233c',
  dialB: '#050810',
  flangeDay: '#e6e9ef',
  flangeNight: '#1d2a44',
  discFace: '#0b111d',
  discText: '#f2f5fa',
  gmtHand: 0x4fc3f7,
  secondHand: 0xd8443a,
  lume: 0xcfeee0,
  lumeEmissive: 0x7ef2c8,
};

/* ---------------- 工具 ---------------- */

function roundedRect(path, cx, cy, w, h, r) {
  const x = cx - w / 2;
  const y = cy - h / 2;
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + h - r);
  path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  path.lineTo(x + r, y + h);
  path.quadraticCurveTo(x, y + h, x, y + h - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
  return path;
}

function shapeFromPoints(points) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  return shape;
}

function canvasTexture(size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return { canvas, ctx, texture };
}

/* ---------------- 表盘贴图 ---------------- */

function drawDialTexture(ctx, size) {
  const half = size / 2;
  const S = half / DIAL_R; // 世界单位 -> 像素
  const X = (x) => half + x * S;
  const Y = (y) => half - y * S;
  const worldAngleToCanvas = (a) => -a;

  ctx.clearRect(0, 0, size, size);

  // 底色 + 渐晕
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0, COLORS.dialA);
  grad.addColorStop(0.72, '#0c1424');
  grad.addColorStop(1, COLORS.dialB);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(half, half, half, 0, Math.PI * 2);
  ctx.fill();

  // 放射太阳纹
  ctx.save();
  ctx.translate(half, half);
  for (let i = 0; i < 480; i++) {
    ctx.rotate((Math.PI * 2) / 480);
    ctx.strokeStyle = i % 2 ? 'rgba(255,255,255,0.030)' : 'rgba(0,0,0,0.045)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -half);
    ctx.stroke();
  }
  ctx.restore();

  // 分钟刻度轨 (r 1.36 ~ 1.43)
  for (let i = 0; i < 60; i++) {
    const a = Math.PI / 2 - (i / 60) * Math.PI * 2;
    const isFive = i % 5 === 0;
    const r0 = isFive ? 1.355 : 1.395;
    const r1 = 1.432;
    ctx.strokeStyle = isFive ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.45)';
    ctx.lineWidth = isFive ? 7 : 3;
    ctx.beginPath();
    ctx.moveTo(X(Math.cos(a) * r0), Y(Math.sin(a) * r0));
    ctx.lineTo(X(Math.cos(a) * r1), Y(Math.sin(a) * r1));
    ctx.stroke();
  }

  // 24 小时内圈（第二时区刻度）：昼 6-18 亮，夜 18-6 暗
  const bandIn = 1.44;
  const bandOut = 1.57;
  const drawBand = (fromHour, toHour, color) => {
    const a0 = worldAngleToCanvas(Math.PI / 2 - (fromHour / 24) * Math.PI * 2);
    const a1 = worldAngleToCanvas(Math.PI / 2 - (toHour / 24) * Math.PI * 2);
    ctx.beginPath();
    ctx.arc(half, half, bandOut * S, a0, a1, false);
    ctx.arc(half, half, bandIn * S, a1, a0, true);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };
  drawBand(6, 18, COLORS.flangeDay);
  drawBand(18, 30, COLORS.flangeNight);

  // 24 小时刻度与数字
  for (let h = 0; h < 24; h++) {
    const a = Math.PI / 2 - (h / 24) * Math.PI * 2;
    const daytime = h >= 6 && h < 18;
    ctx.strokeStyle = daytime ? 'rgba(20,26,38,0.75)' : 'rgba(230,236,245,0.7)';
    ctx.lineWidth = h % 2 === 0 ? 5 : 3;
    ctx.beginPath();
    ctx.moveTo(X(Math.cos(a) * (bandIn + 0.005)), Y(Math.sin(a) * (bandIn + 0.005)));
    ctx.lineTo(X(Math.cos(a) * (bandIn + 0.035)), Y(Math.sin(a) * (bandIn + 0.035)));
    ctx.stroke();

    if (h % 2 !== 0) continue;
    const rt = 1.512;
    ctx.save();
    ctx.translate(X(Math.cos(a) * rt), Y(Math.sin(a) * rt));
    ctx.rotate(-(a - Math.PI / 2));
    ctx.fillStyle = daytime ? '#141a26' : '#e6ecf5';
    ctx.font = '600 52px "Segoe UI", Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(h === 0 ? '24' : String(h), 0, 0);
    ctx.restore();
  }

  // 品牌字样
  ctx.fillStyle = 'rgba(240,244,250,0.94)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 88px "Segoe UI", Helvetica, Arial, sans-serif';
  ctx.fillText('KIRO', X(0), Y(0.58));
  ctx.fillStyle = COLORS.gold;
  ctx.font = '500 40px "Segoe UI", Helvetica, Arial, sans-serif';
  ctx.fillText('GMT  ·  DUAL TIME', X(0), Y(0.4));
  ctx.fillStyle = 'rgba(200,210,225,0.8)';
  ctx.font = '400 34px "Segoe UI", Helvetica, Arial, sans-serif';
  ctx.fillText('AUTOMATIC', X(0), Y(-0.62));
}

/* ---------------- 转盘贴图（星期 / 日期） ---------------- */

function drawDiscTexture(ctx, size, { labels, outerRadius, textRadius, windowAngle, fontPx }) {
  const half = size / 2;
  const S = half / outerRadius;
  const count = labels.length;

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = COLORS.discFace;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = COLORS.discText;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${fontPx}px "Segoe UI", "PingFang SC", "Microsoft YaHei", Helvetica, sans-serif`;

  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2; // 贴图上的角度（世界 CCW）
    const px = half + Math.cos(a) * textRadius * S;
    const py = half - Math.sin(a) * textRadius * S;
    ctx.save();
    ctx.translate(px, py);
    // 转盘转到视窗后字符恰好竖直：贴图内预旋转 (a - windowAngle)
    ctx.rotate(-(a - windowAngle));
    ctx.fillText(labels[i], 0, 0);
    ctx.restore();
  }
}

function makeDisc({ labels, ring, windowAngle, fontPx }) {
  const { canvas, ctx, texture } = canvasTexture(1024);
  drawDiscTexture(ctx, canvas.width, {
    labels,
    outerRadius: ring.outer,
    textRadius: ring.textRadius,
    windowAngle,
    fontPx,
  });
  texture.needsUpdate = true;

  const geo = new THREE.RingGeometry(ring.inner, ring.outer, 160, 1);
  const mat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.5, metalness: 0.1 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.z = Z.discs;
  mesh.userData.redraw = (nextLabels) => {
    drawDiscTexture(ctx, canvas.width, {
      labels: nextLabels,
      outerRadius: ring.outer,
      textRadius: ring.textRadius,
      windowAngle,
      fontPx,
    });
    texture.needsUpdate = true;
  };
  return mesh;
}

/* ---------------- 指针 ---------------- */

function extrudeMesh(shape, depth, material) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 24 });
  return new THREE.Mesh(geo, material);
}

function buildHands(materials) {
  const depth = 0.022;

  const hourShape = shapeFromPoints([
    [-0.075, -0.16], [0.075, -0.16], [0.058, 0.6],
    [0.03, 0.86], [-0.03, 0.86], [-0.058, 0.6],
  ]);
  const minuteShape = shapeFromPoints([
    [-0.056, -0.18], [0.056, -0.18], [0.044, 1.06],
    [0.022, 1.32], [-0.022, 1.32], [-0.044, 1.06],
  ]);
  const gmtShape = shapeFromPoints([
    [-0.032, -0.3], [0.032, -0.3], [0.032, 1.14], [0.1, 1.14],
    [0, 1.44], [-0.1, 1.14], [-0.032, 1.14],
  ]);

  const hour = new THREE.Group();
  hour.position.z = Z.hourHand;
  hour.add(extrudeMesh(hourShape, depth, materials.handSteel));
  const hourLume = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.44, 0.012), materials.lume);
  hourLume.position.set(0, 0.52, depth + 0.006);
  hour.add(hourLume);

  const minute = new THREE.Group();
  minute.position.z = Z.minuteHand;
  minute.add(extrudeMesh(minuteShape, depth, materials.handSteel));
  const minuteLume = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.78, 0.012), materials.lume);
  minuteLume.position.set(0, 0.74, depth + 0.006);
  minute.add(minuteLume);

  const gmt = new THREE.Group();
  gmt.position.z = Z.gmtHand;
  gmt.add(extrudeMesh(gmtShape, depth, materials.gmt));

  const second = new THREE.Group();
  second.position.z = Z.secondHand;
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.022, 1.74, 0.016), materials.second);
  shaft.position.set(0, (1.42 - 0.32) / 2, 0.008);
  second.add(shaft);
  const counterweight = new THREE.Mesh(
    new THREE.CylinderGeometry(0.085, 0.085, 0.018, 28),
    materials.second,
  );
  counterweight.rotation.x = Math.PI / 2;
  counterweight.position.set(0, -0.24, 0.008);
  second.add(counterweight);

  return { hour, minute, second, gmt };
}

/* ---------------- 主构建 ---------------- */

export function buildWatch({ weekdayLabels } = {}) {
  const group = new THREE.Group();

  const materials = {
    steel: new THREE.MeshStandardMaterial({ color: COLORS.steel, metalness: 1, roughness: 0.22 }),
    steelBrushed: new THREE.MeshStandardMaterial({
      color: COLORS.steelDark, metalness: 1, roughness: 0.42,
    }),
    gold: new THREE.MeshStandardMaterial({ color: COLORS.gold, metalness: 1, roughness: 0.18 }),
    handSteel: new THREE.MeshStandardMaterial({ color: 0xf2f4f8, metalness: 1, roughness: 0.15 }),
    gmt: new THREE.MeshStandardMaterial({ color: COLORS.gmtHand, metalness: 0.55, roughness: 0.3 }),
    second: new THREE.MeshStandardMaterial({ color: COLORS.secondHand, metalness: 0.4, roughness: 0.35 }),
    lume: new THREE.MeshStandardMaterial({
      color: COLORS.lume, emissive: COLORS.lumeEmissive, emissiveIntensity: 0.18, roughness: 0.6,
    }),
    movement: new THREE.MeshStandardMaterial({ color: 0x090d15, metalness: 0.3, roughness: 0.8 }),
    crystal: new THREE.MeshPhysicalMaterial({
      color: 0xffffff, metalness: 0, roughness: 0.03, transparent: true, opacity: 0.35,
      transmission: 0.95, ior: 1.52, thickness: 0.22, clearcoat: 1, clearcoatRoughness: 0.02,
      side: THREE.DoubleSide,
    }),
  };
  const lumeMaterials = [materials.lume];

  /* 表壳侧壁 */
  const caseSide = new THREE.Mesh(
    new THREE.CylinderGeometry(2.0, 1.9, Z.caseTop - Z.caseBottom, 128, 1, true),
    materials.steelBrushed,
  );
  caseSide.rotation.x = Math.PI / 2;
  caseSide.position.z = (Z.caseTop + Z.caseBottom) / 2;
  caseSide.castShadow = true;
  caseSide.receiveShadow = true;
  group.add(caseSide);

  /* 背面圆拱（球冠压扁，法线正确） */
  const back = new THREE.Mesh(
    new THREE.SphereGeometry(1.9, 96, 32, 0, Math.PI * 2, 0, Math.PI / 2),
    materials.steelBrushed,
  );
  back.rotation.x = -Math.PI / 2; // 极点朝 -Z
  back.scale.z = 1;
  back.scale.set(1, 1, 1);
  back.position.z = Z.caseBottom;
  back.geometry.scale(1, 0.14, 1); // 压扁成表背弧度
  back.castShadow = true;
  group.add(back);

  /* 表圈 */
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(1.78, 0.16, 32, 160), materials.steel);
  bezel.position.z = Z.bezel;
  bezel.castShadow = true;
  group.add(bezel);

  /* 机芯底板 */
  const basePlate = new THREE.Mesh(new THREE.CircleGeometry(1.62, 96), materials.movement);
  basePlate.position.z = Z.basePlate;
  group.add(basePlate);

  /* 星期盘 / 日期盘 */
  const dayLabels = weekdayLabels || ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const dayDisc = makeDisc({
    labels: dayLabels, ring: DAY_RING, windowAngle: Math.PI / 2, fontPx: 116,
  });
  const dateLabels = Array.from({ length: 31 }, (_, i) => String(i + 1));
  const dateDisc = makeDisc({
    labels: dateLabels, ring: DATE_RING, windowAngle: 0, fontPx: 150,
  });
  group.add(dayDisc, dateDisc);

  /* 表盘（带两个视窗镂空） */
  const dialShape = new THREE.Shape();
  dialShape.absarc(0, 0, DIAL_R, 0, Math.PI * 2, false);
  dialShape.holes.push(
    roundedRect(new THREE.Path(), DAY_WINDOW.cx, DAY_WINDOW.cy, DAY_WINDOW.w, DAY_WINDOW.h, DAY_WINDOW.r),
  );
  dialShape.holes.push(
    roundedRect(new THREE.Path(), DATE_WINDOW.cx, DATE_WINDOW.cy, DATE_WINDOW.w, DATE_WINDOW.h, DATE_WINDOW.r),
  );

  const dialTex = canvasTexture(2048);
  drawDialTexture(dialTex.ctx, dialTex.canvas.width);
  dialTex.texture.needsUpdate = true;
  // ExtrudeGeometry 的顶面 UV = 顶点 (x, y)，用 repeat/offset 归一化到 0..1
  dialTex.texture.repeat.set(1 / (2 * DIAL_R), 1 / (2 * DIAL_R));
  dialTex.texture.offset.set(0.5, 0.5);

  const dial = new THREE.Mesh(
    new THREE.ExtrudeGeometry(dialShape, {
      depth: Z.dialDepth, bevelEnabled: false, curveSegments: 96,
    }),
    new THREE.MeshStandardMaterial({ map: dialTex.texture, roughness: 0.42, metalness: 0.18 }),
  );
  dial.position.z = Z.dial;
  group.add(dial);

  /* 视窗金属框 */
  for (const win of [DAY_WINDOW, DATE_WINDOW]) {
    const frameShape = roundedRect(
      new THREE.Shape(), win.cx, win.cy, win.w + 0.07, win.h + 0.07, win.r + 0.02,
    );
    frameShape.holes.push(roundedRect(new THREE.Path(), win.cx, win.cy, win.w, win.h, win.r));
    const frame = extrudeMesh(frameShape, 0.075, materials.gold);
    frame.position.z = Z.frame;
    group.add(frame);
  }

  /* 立体时标（12 点被星期窗占用，故省略） */
  for (let i = 1; i < 12; i++) {
    const holder = new THREE.Group();
    holder.rotation.z = -(i / 12) * Math.PI * 2;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.24, 0.036), materials.gold);
    body.position.set(0, 1.22, Z.markers + 0.018);
    const lume = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.2, 0.014), materials.lume);
    lume.position.set(0, 1.22, Z.markers + 0.04);
    holder.add(body, lume);
    group.add(holder);
  }

  /* 指针 + 中心帽 */
  const hands = buildHands(materials);
  group.add(hands.gmt, hands.hour, hands.minute, hands.second);

  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.095, 0.05, 36), materials.gold);
  cap.rotation.x = Math.PI / 2;
  cap.position.z = Z.cap;
  group.add(cap);

  /* 镜面 */
  const crystal = new THREE.Mesh(
    new THREE.CylinderGeometry(1.68, 1.68, 0.08, 128),
    materials.crystal,
  );
  crystal.rotation.x = Math.PI / 2;
  crystal.position.z = Z.crystal;
  group.add(crystal);

  /* 表冠（3 点位置） */
  const crown = new THREE.Group();
  const crownBody = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.2, 20), materials.steel);
  crownBody.rotation.z = Math.PI / 2;
  const crownRing = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 12, 24), materials.gold);
  crownRing.rotation.y = Math.PI / 2;
  crown.add(crownBody, crownRing);
  crown.position.set(2.03, 0, 0.02);
  crown.castShadow = true;
  group.add(crown);

  /* 表耳 */
  for (const sy of [1, -1]) {
    for (const sx of [1, -1]) {
      const lug = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.62, 0.4), materials.steelBrushed);
      lug.position.set(sx * 0.62, sy * 1.84, -0.04);
      lug.rotation.z = -sx * sy * 0.3;
      lug.rotation.x = sy * 0.3;
      lug.castShadow = true;
      group.add(lug);
    }
  }

  /* 链带：以 (0,0,-1.35) 为圆心、半径 1.72 的环，跳过表壳所在顶部弧段 */
  const braceletCenter = new THREE.Vector3(0, 0, -1.35);
  const braceletRadius = 1.72;
  const startDeg = 142;
  const endDeg = 398;
  const linkCount = 26;
  for (let i = 0; i < linkCount; i++) {
    const t = THREE.MathUtils.degToRad(startDeg + ((endDeg - startDeg) * i) / (linkCount - 1));
    const link = new THREE.Group();
    const isClasp = i > linkCount * 0.42 && i < linkCount * 0.58;
    const outer = new THREE.Mesh(
      new THREE.BoxGeometry(0.98, isClasp ? 0.19 : 0.14, 0.26),
      materials.steelBrushed,
    );
    const center = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.17, 0.235), materials.steel);
    center.position.y = 0.02;
    link.add(outer, center);
    link.position.set(
      0,
      braceletCenter.y + Math.cos(t) * braceletRadius,
      braceletCenter.z + Math.sin(t) * braceletRadius,
    );
    link.rotation.x = t; // 局部 +Y -> 径向, +Z -> 切向
    outer.castShadow = true;
    center.castShadow = true;
    group.add(link);
  }

  return {
    group,
    hands,
    discs: { day: dayDisc, date: dateDisc },
    materials,
    lumeMaterials,
    setWeekdayLabels(labels) {
      dayDisc.userData.redraw(labels);
    },
    setNight(on) {
      for (const m of lumeMaterials) m.emissiveIntensity = on ? 2.6 : 0.18;
    },
  };
}
