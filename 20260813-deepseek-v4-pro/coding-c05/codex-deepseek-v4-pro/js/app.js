/**
 * WatchApp — 3D 双时区腕表渲染层。
 * 依赖：vendor/three.min.js（r128 UMD）、vendor/OrbitControls.js、js/core.js。
 * 所有时间/时区计算都委托给 WatchCore（纯函数），本文件只负责场景与交互。
 */
(function () {
  'use strict';

  if (typeof THREE === 'undefined' || !window.WatchCore) {
    var fatalEl = document.getElementById('error-overlay');
    if (fatalEl) {
      fatalEl.textContent = '缺少依赖脚本：请确认 vendor/three.min.js、vendor/OrbitControls.js、js/core.js 与 index.html 位于同一目录结构下（三个文件均需存在）。';
      fatalEl.style.display = 'block';
    }
    return;
  }

  var W = window.WatchCore;

  /* ============================== 状态 ============================== */
  var params = new URLSearchParams(window.location.search);
  var defaultTz = (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC';
  var zones = W.listTimeZones();

  function sanitizeZone(name) {
    return zones.indexOf(name) >= 0 ? name : defaultTz;
  }

  var state = {
    tz1: sanitizeZone(params.get('tz1') || defaultTz),
    tz2: sanitizeZone(params.get('tz2') || (defaultTz === 'UTC' ? 'Asia/Shanghai' : 'UTC')),
    speed: clamp(parseFloat(params.get('speed') || '1'), 0.0001, 86400),
    paused: false,
    locale: (navigator.language || 'zh-CN'),
    simMs: Date.now(),
    autoRotate: false,
    lastDayLabel: null,
    lastWeekday: null,
    lastClock: { tz1: '', tz2: '' }
  };

  var anchor = W.createAnchor(performance.now(), state.simMs);
  var mainHands = { second: 0, minute: 0, hour: 0 };
  var subHands = { second: 0, minute: 0, hour: 0 };
  var transitions = { main: null, sub: null };

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  /* ======================== 画布纹理辅助 ======================== */
  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  function canvasTexture(c) {
    var t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 8;
    return t;
  }

  function px(cx, cy, r, degClockwise) {
    var rad = degClockwise * Math.PI / 180;
    return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
  }

  var FONT = '"SF Pro Display","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Helvetica Neue",Arial,sans-serif';

  function drawDial(tzLabel) {
    var S = 1024;
    var c = makeCanvas(S, S);
    var g = c.getContext('2d');
    var cx = S / 2;
    var cy = S / 2;

    var bg = g.createRadialGradient(cx, cy, 40, cx, cy, 512);
    bg.addColorStop(0, '#182338');
    bg.addColorStop(0.72, '#101828');
    bg.addColorStop(1, '#0a0f1c');
    g.fillStyle = bg;
    g.beginPath();
    g.arc(cx, cy, 512, 0, Math.PI * 2);
    g.fill();

    // 分钟轨道
    g.strokeStyle = 'rgba(214,226,244,0.28)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, cy, 472, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = 'rgba(214,226,244,0.18)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, 440, 0, Math.PI * 2);
    g.stroke();

    // 60 个刻度，整 5 分钟加粗
    for (var i = 0; i < 60; i++) {
      var deg = i * 6;
      var major = i % 5 === 0;
      var p1 = px(cx, cy, major ? 436 : 446, deg);
      var p2 = px(cx, cy, 466, deg);
      g.strokeStyle = major ? 'rgba(244,248,255,0.95)' : 'rgba(214,226,244,0.5)';
      g.lineWidth = major ? 7 : 2.5;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(p1.x, p1.y);
      g.lineTo(p2.x, p2.y);
      g.stroke();
    }

    // 5 分钟数字
    g.font = '500 30px ' + FONT;
    g.fillStyle = 'rgba(158,178,210,0.9)';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (var m = 5; m <= 55; m += 5) {
      var pm = px(cx, cy, 338, m * 6);
      g.fillText(String(m), pm.x, pm.y);
    }

    // 12 个小时数字
    g.font = '600 82px Georgia,"Times New Roman",serif';
    g.fillStyle = '#eef3fb';
    for (var h = 1; h <= 12; h++) {
      var ph = px(cx, cy, 396, h * 30);
      g.fillText(String(h), ph.x, ph.y);
    }

    // 品牌与主时区标签
    g.font = '500 30px ' + FONT;
    g.fillStyle = 'rgba(190,205,228,0.85)';
    g.fillText('A U T O M A T I C', cx, cy - 258);
    g.font = '600 36px ' + FONT;
    g.fillStyle = '#ffd98a';
    g.fillText(tzLabel || 'LOCAL', cx, cy - 216);
    g.font = '500 26px ' + FONT;
    g.fillStyle = 'rgba(190,205,228,0.7)';
    g.fillText('D U A L  T I M E', cx, cy + 300);

    // 小表盘凹陷
    var sub = g.createRadialGradient(cx, cy + 298, 8, cx, cy + 298, 165);
    sub.addColorStop(0, '#05080f');
    sub.addColorStop(1, '#0b1220');
    g.fillStyle = sub;
    g.beginPath();
    g.arc(cx, cy + 298, 165, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(214,226,244,0.35)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, cy + 298, 165, 0, Math.PI * 2);
    g.stroke();

    return c;
  }

  function drawDate(dayLabel) {
    var c = makeCanvas(256, 192);
    var g = c.getContext('2d');
    g.clearRect(0, 0, 256, 192);
    roundRectPath(g, 5, 5, 246, 182, 24);
    var bg = g.createLinearGradient(0, 0, 0, 192);
    bg.addColorStop(0, '#fdfaf1');
    bg.addColorStop(1, '#e9e2d0');
    g.fillStyle = bg;
    g.fill();
    g.strokeStyle = 'rgba(24,30,42,0.55)';
    g.lineWidth = 4;
    g.stroke();
    g.font = '700 108px ' + FONT;
    g.fillStyle = '#11151d';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(dayLabel, 128, 104);
    return c;
  }

  function drawWeekday(label) {
    var c = makeCanvas(320, 192);
    var g = c.getContext('2d');
    g.clearRect(0, 0, 320, 192);
    roundRectPath(g, 5, 5, 310, 182, 24);
    var bg = g.createLinearGradient(0, 0, 0, 192);
    bg.addColorStop(0, '#16233c');
    bg.addColorStop(1, '#0c1424');
    g.fillStyle = bg;
    g.fill();
    g.strokeStyle = 'rgba(214,226,244,0.45)';
    g.lineWidth = 3;
    g.stroke();
    g.font = '600 62px ' + FONT;
    g.fillStyle = '#f2f6fd';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, 160, 96);
    return c;
  }

  function drawSubdial(zoneLabel, isPM) {
    var S = 256;
    var c = makeCanvas(S, S);
    var g = c.getContext('2d');
    var cx = S / 2;
    var bg = g.createRadialGradient(cx, cx, 8, cx, cx, 128);
    bg.addColorStop(0, '#0d1526');
    bg.addColorStop(1, '#060a12');
    g.fillStyle = bg;
    g.beginPath();
    g.arc(cx, cx, 128, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(205,215,234,0.7)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, cx, 119, 0, Math.PI * 2);
    g.stroke();
    for (var i = 0; i < 60; i++) {
      var major = i % 5 === 0;
      var p1 = px(cx, cx, major ? 102 : 108, i * 6);
      var p2 = px(cx, cx, 114, i * 6);
      g.strokeStyle = major ? 'rgba(240,246,255,0.95)' : 'rgba(200,215,238,0.45)';
      g.lineWidth = major ? 4 : 1.5;
      g.beginPath();
      g.moveTo(p1.x, p1.y);
      g.lineTo(p2.x, p2.y);
      g.stroke();
    }
    g.font = '600 34px Georgia,serif';
    g.fillStyle = '#eef3fb';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    var marks = [[12, 0], [3, 90], [6, 180], [9, 270]];
    for (var k = 0; k < marks.length; k++) {
      var p = px(cx, cx, 76, marks[k][1]);
      g.fillText(String(marks[k][0]), p.x, p.y);
    }
    // 日/夜点
    g.fillStyle = isPM ? '#ffd98a' : '#8fb4ff';
    g.beginPath();
    g.arc(cx, cx + 52, 6, 0, Math.PI * 2);
    g.fill();
    g.font = '600 22px ' + FONT;
    g.fillStyle = '#ffd98a';
    g.fillText(zoneLabel || '', cx, cx + 88);
    return c;
  }

  function drawCaseback() {
    var S = 512;
    var c = makeCanvas(S, S);
    var g = c.getContext('2d');
    var cx = S / 2;
    var bg = g.createRadialGradient(cx, cx, 20, cx, cx, 256);
    bg.addColorStop(0, '#2b3442');
    bg.addColorStop(1, '#151a23');
    g.fillStyle = bg;
    g.beginPath();
    g.arc(cx, cx, 256, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cx, 230, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(cx, cx, 120, 0, Math.PI * 2);
    g.stroke();
    g.font = '500 26px ' + FONT;
    g.fillStyle = 'rgba(230,238,250,0.75)';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('SAPPHIRE CRYSTAL', cx, cx - 20);
    g.fillText('AUTOMATIC · DUAL TIME', cx, cx + 12);
    g.fillText('20 ATM · 316L STEEL', cx, cx + 44);
    return c;
  }

  function drawStrap() {
    var Wpx = 256;
    var Hpx = 768;
    var c = makeCanvas(Wpx, Hpx);
    var g = c.getContext('2d');
    var bg = g.createLinearGradient(0, 0, Wpx, 0);
    bg.addColorStop(0, '#4a2f1e');
    bg.addColorStop(0.5, '#68422a');
    bg.addColorStop(1, '#422a1a');
    g.fillStyle = bg;
    g.fillRect(0, 0, Wpx, Hpx);
    // 皮革纹理噪点
    for (var i = 0; i < 1200; i++) {
      var x = Math.random() * Wpx;
      var y = Math.random() * Hpx;
      g.fillStyle = 'rgba(0,0,0,' + (Math.random() * 0.10).toFixed(2) + ')';
      g.fillRect(x, y, 1, 3);
    }
    // 缝线
    g.strokeStyle = 'rgba(236,224,200,0.8)';
    g.lineWidth = 3;
    g.setLineDash([14, 10]);
    g.beginPath();
    g.moveTo(20, 0);
    g.lineTo(20, Hpx);
    g.moveTo(Wpx - 20, 0);
    g.lineTo(Wpx - 20, Hpx);
    g.stroke();
    // 表带孔
    g.setLineDash([]);
    g.fillStyle = 'rgba(20,12,8,0.8)';
    for (var h = 0; h < 5; h++) {
      g.beginPath();
      g.arc(Wpx / 2, Hpx - 90 - h * 38, 9, 0, Math.PI * 2);
      g.fill();
    }
    return c;
  }

  function roundRectPath(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  /* ============================== 材质 ============================== */
  var steelMat = new THREE.MeshStandardMaterial({ color: 0xe7ebf2, metalness: 0.95, roughness: 0.28 });
  var steelDarkMat = new THREE.MeshStandardMaterial({ color: 0xb9c1cf, metalness: 0.9, roughness: 0.4 });
  var lumeMat = new THREE.MeshStandardMaterial({
    color: 0xf2f7ff, emissive: 0xbfe8ff, emissiveIntensity: 0.28, metalness: 0.1, roughness: 0.6
  });
  var redMat = new THREE.MeshStandardMaterial({ color: 0xe03131, metalness: 0.55, roughness: 0.35 });
  var leatherMat = null; // 纹理完成后创建

  /* ============================ 指针几何 ============================ */
  function taperedHand(points, depth) {
    var shape = new THREE.Shape();
    shape.moveTo(points[0][0], points[0][1]);
    for (var i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
    shape.closePath();
    var geo = new THREE.ExtrudeGeometry(shape, {
      depth: depth,
      bevelEnabled: true,
      bevelThickness: depth * 0.18,
      bevelSize: depth * 0.18,
      bevelSegments: 2
    });
    geo.center();
    return geo;
  }

  var HOUR_POINTS = [[0, 0.52], [0.055, 0.40], [0.075, -0.16], [0.030, -0.22], [-0.030, -0.22], [-0.075, -0.16], [-0.055, 0.40]];
  var MINUTE_POINTS = [[0, 0.74], [0.045, 0.56], [0.062, -0.20], [0.026, -0.28], [-0.026, -0.28], [-0.062, -0.20], [-0.045, 0.56]];

  function makeHandSet(size) {
    var group = new THREE.Group();
    var hourPts = HOUR_POINTS.map(function (p) { return [p[0] * size, p[1] * size]; });
    var minutePts = MINUTE_POINTS.map(function (p) { return [p[0] * size, p[1] * size]; });

    var hour = new THREE.Mesh(taperedHand(hourPts, 0.016 * size), steelMat);
    hour.position.z = 0.004;
    group.add(hour);
    var minute = new THREE.Mesh(taperedHand(minutePts, 0.016 * size), steelMat);
    minute.position.z = 0.008;
    group.add(minute);

    // 夜光条
    var lumeInset = new THREE.Mesh(taperedHand(hourPts.map(function (p) { return [p[0] * 0.45, p[1] * 0.94]; }), 0.006 * size), lumeMat);
    lumeInset.position.z = 0.012;
    group.add(lumeInset);
    var lumeInsetMin = new THREE.Mesh(taperedHand(minutePts.map(function (p) { return [p[0] * 0.45, p[1] * 0.94]; }), 0.006 * size), lumeMat);
    lumeInsetMin.position.z = 0.016;
    group.add(lumeInsetMin);

    var second = new THREE.Group();
    var bar = new THREE.Mesh(new THREE.BoxGeometry(0.018 * size, 0.62 * size, 0.012 * size), steelMat);
    bar.position.y = 0.26 * size;
    second.add(bar);
    var tip = new THREE.Mesh(new THREE.BoxGeometry(0.018 * size, 0.16 * size, 0.012 * size), redMat);
    tip.position.y = 0.63 * size;
    second.add(tip);
    var cw = new THREE.Mesh(new THREE.CylinderGeometry(0.045 * size, 0.045 * size, 0.012 * size, 24), steelMat);
    cw.position.y = -0.27 * size;
    second.add(cw);
    second.position.z = 0.02;
    group.add(second);

    var cap = new THREE.Mesh(new THREE.CylinderGeometry(0.038 * size, 0.038 * size, 0.026 * size, 32), steelMat);
    cap.position.z = 0.026;
    group.add(cap);
    return { group: group, hour: hour, minute: minute, second: second };
  }

  /* ============================== 场景 ============================== */
  var stageEl = document.getElementById('stage');
  var errorEl = document.getElementById('error-overlay');
  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true // 便于截图/像素级自动化验证
    });
  } catch (err) {
    showError('当前浏览器无法创建 WebGL 上下文，3D 腕表无法渲染。请换用现代浏览器。');
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  stageEl.appendChild(renderer.domElement);

  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0d14);
  scene.fog = new THREE.Fog(0x0a0d14, 9, 24);

  var camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 60);
  var HOME_CAMERA = new THREE.Vector3(3.1, 2.0, 3.9);
  camera.position.copy(HOME_CAMERA);
  camera.lookAt(0, 0, 0);

  var controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 3.1;
  controls.maxDistance = 10;
  controls.maxPolarAngle = Math.PI * 0.74;
  controls.autoRotateSpeed = 0.8;
  controls.update();

  // 灯光
  scene.add(new THREE.HemisphereLight(0xe8efff, 0x0b0e14, 0.5));
  scene.add(new THREE.AmbientLight(0xffffff, 0.22));
  var keyLight = new THREE.DirectionalLight(0xffffff, 1.35);
  keyLight.position.set(3.2, 5.0, 2.4);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.left = -3.6;
  keyLight.shadow.camera.right = 3.6;
  keyLight.shadow.camera.top = 3.6;
  keyLight.shadow.camera.bottom = -3.6;
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 18;
  keyLight.shadow.bias = -0.0004;
  scene.add(keyLight);
  var fillLight = new THREE.DirectionalLight(0xbfd4ff, 0.4);
  fillLight.position.set(-4.0, 1.2, 3.0);
  scene.add(fillLight);
  var rimLight = new THREE.PointLight(0x6f86ff, 0.9, 14, 2);
  rimLight.position.set(0, 1.6, -4.2);
  scene.add(rimLight);

  // 地面（仅接收阴影）
  var ground = new THREE.Mesh(
    new THREE.CircleGeometry(6.5, 64),
    new THREE.MeshStandardMaterial({ color: 0x141924, roughness: 1, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.07;
  ground.receiveShadow = true;
  scene.add(ground);

  var watch = new THREE.Group();
  scene.add(watch);

  function addCase() {
    var mid = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.22, 96), steelMat);
    mid.position.z = 0.02;
    mid.castShadow = true;
    watch.add(mid);
    var back = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.1, 96), steelDarkMat);
    back.position.z = -0.14;
    back.castShadow = true;
    watch.add(back);
    var backPlate = new THREE.Mesh(
      new THREE.CircleGeometry(0.94, 96),
      new THREE.MeshStandardMaterial({ map: canvasTexture(drawCaseback()), metalness: 0.55, roughness: 0.5 })
    );
    backPlate.rotation.x = Math.PI;
    backPlate.position.z = -0.192;
    watch.add(backPlate);

    var bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 1.0, 0.11, 96, 1, true), steelMat);
    bezel.position.z = 0.175;
    bezel.castShadow = true;
    watch.add(bezel);
    var crystal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.845, 0.845, 0.032, 96),
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff, metalness: 0, roughness: 0.05,
        transparent: true, opacity: 0.18, clearcoat: 1, clearcoatRoughness: 0.08
      })
    );
    crystal.position.z = 0.16;
    watch.add(crystal);

    // 表冠
    var crown = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.1, 28, 1, false), steelMat);
    crown.rotation.z = Math.PI / 2;
    crown.position.set(1.06, 0, 0.02);
    crown.castShadow = true;
    watch.add(crown);
    for (var i = -1; i <= 1; i += 2) {
      var knurl = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.008, 8, 28), steelDarkMat);
      knurl.rotation.y = Math.PI / 2;
      knurl.position.set(1.05 + i * 0.028, 0, 0.02);
      watch.add(knurl);
    }
    var stem = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.14, 24), steelDarkMat);
    stem.rotation.z = Math.PI / 2;
    stem.position.set(0.98, 0, 0.02);
    watch.add(stem);
  }

  function addLugsAndStrap() {
    var lugGeo = new THREE.BoxGeometry(0.27, 0.34, 0.14);
    [[-0.28, 0.95], [0.28, 0.95], [-0.28, -0.95], [0.28, -0.95]].forEach(function (p) {
      var lug = new THREE.Mesh(lugGeo, steelMat);
      lug.position.set(p[0], p[1], 0.02);
      lug.castShadow = true;
      watch.add(lug);
    });

    leatherMat = new THREE.MeshStandardMaterial({ map: canvasTexture(drawStrap()), roughness: 0.92, metalness: 0.02 });
    var strapShape = new THREE.Shape();
    strapShape.moveTo(-0.31, 0);
    strapShape.lineTo(-0.31, 1.70);
    strapShape.quadraticCurveTo(-0.31, 2.04, 0, 2.04);
    strapShape.quadraticCurveTo(0.31, 2.04, 0.31, 1.70);
    strapShape.lineTo(0.31, 0);
    strapShape.closePath();
    var strapGeo = new THREE.ExtrudeGeometry(strapShape, { depth: 0.1, bevelEnabled: false });
    strapGeo.translate(0, 0, -0.05);
    [[0.85, -0.42], [-0.85, 0.42]].forEach(function (p) {
      var strap = new THREE.Mesh(strapGeo, leatherMat);
      strap.position.set(0, p[0], 0.03);
      strap.rotation.x = p[1];
      strap.castShadow = true;
      watch.add(strap);
    });
  }

  function addDial() {
    var dialMat = new THREE.MeshStandardMaterial({ map: canvasTexture(drawDial(W.getZoneLabel(state.tz1, state.locale))), roughness: 0.55, metalness: 0.25 });
    dialMat.map.needsUpdate = true;
    state.dialMat = dialMat;
    var dial = new THREE.Mesh(new THREE.CircleGeometry(0.86, 96), dialMat);
    dial.position.z = 0.128;
    dial.receiveShadow = true;
    watch.add(dial);

    // 3D 时标
    for (var h = 0; h < 12; h++) {
      var deg = h * 30;
      var pos = px(0, 0, 0.70, deg);
      var marker = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.17, 0.016), steelMat);
      marker.position.set(pos.x, pos.y, 0.138);
      marker.rotation.z = -deg * Math.PI / 180;
      watch.add(marker);
      var insert = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.11, 0.02), lumeMat);
      insert.position.set(pos.x, pos.y, 0.146);
      insert.rotation.z = -deg * Math.PI / 180;
      watch.add(insert);
    }
  }

  function addWindowsAndSubdial() {
    state.dateMat = new THREE.MeshStandardMaterial({
      map: canvasTexture(drawDate('13')), transparent: true, roughness: 0.45, emissive: 0xffffff, emissiveIntensity: 0.08
    });
    state.weekdayMat = new THREE.MeshStandardMaterial({
      map: canvasTexture(drawWeekday('周四')), transparent: true, roughness: 0.5, emissive: 0x88aaff, emissiveIntensity: 0.05
    });
    var dateWin = new THREE.Mesh(new THREE.PlaneGeometry(0.30, 0.21), state.dateMat);
    dateWin.position.set(0.50, 0, 0.143);
    watch.add(dateWin);
    var weekdayWin = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.21), state.weekdayMat);
    weekdayWin.position.set(-0.50, 0, 0.143);
    watch.add(weekdayWin);

    // 小表盘
    var subBase = new THREE.Mesh(
      new THREE.CircleGeometry(0.235, 64),
      new THREE.MeshStandardMaterial({
        map: canvasTexture(drawSubdial(
          W.getZoneLabel(state.tz2, state.locale),
          W.getHandAngles(state.simMs, state.tz2).isPM
        )),
        roughness: 0.6,
        metalness: 0.2
      })
    );
    subBase.position.set(0, -0.50, 0.141);
    watch.add(subBase);
    state.subdialMat = subBase.material;
    var subRing = new THREE.Mesh(new THREE.TorusGeometry(0.228, 0.012, 12, 64), steelMat);
    subRing.position.set(0, -0.50, 0.147);
    watch.add(subRing);
  }

  function addHands() {
    var main = makeHandSet(1.0);
    main.group.position.z = 0.151;
    watch.add(main.group);
    var sub = makeHandSet(0.30);
    sub.group.position.set(0, -0.50, 0.153);
    sub.group.scale.set(1, 1, 0.8);
    watch.add(sub.group);
    state.handMeshes = { main: main, sub: sub };
  }

  addCase();
  addDial();
  addWindowsAndSubdial();
  addHands();
  addLugsAndStrap();

  /* ============================== 动画 ============================== */
  function applyTransition(key, target, nowMs) {
    var tr = transitions[key];
    var cur = key === 'main' ? mainHands : subHands;
    if (tr) {
      var t = clamp((nowMs - tr.start) / tr.duration, 0, 1);
      var k = W.easeInOutCubic(t);
      cur.second = tr.from.second + W.shortestAngleDelta(tr.from.second, target.second) * k;
      cur.minute = tr.from.minute + W.shortestAngleDelta(tr.from.minute, target.minute) * k;
      cur.hour = tr.from.hour + W.shortestAngleDelta(tr.from.hour, target.hour) * k;
      if (t >= 1) transitions[key] = null;
    } else {
      cur.second = target.second;
      cur.minute = target.minute;
      cur.hour = target.hour;
    }
    return cur;
  }

  function updateHands(nowMs) {
    var targetMain = W.getHandAngles(state.simMs, state.tz1);
    var targetSub = W.getHandAngles(state.simMs, state.tz2);
    var aMain = applyTransition('main', targetMain, nowMs);
    var aSub = applyTransition('sub', targetSub, nowMs);

    var m = state.handMeshes.main;
    m.hour.rotation.z = -aMain.hour * Math.PI / 180;
    m.minute.rotation.z = -aMain.minute * Math.PI / 180;
    m.second.rotation.z = -aMain.second * Math.PI / 180;
    var s = state.handMeshes.sub;
    s.hour.rotation.z = -aSub.hour * Math.PI / 180;
    s.minute.rotation.z = -aSub.minute * Math.PI / 180;
    s.second.rotation.z = -aSub.second * Math.PI / 180;
  }

  function updateReadouts() {
    var clock1 = W.formatClock(state.simMs, state.tz1);
    var clock2 = W.formatClock(state.simMs, state.tz2);
    if (clock1 !== state.lastClock.tz1) {
      state.lastClock.tz1 = clock1;
      document.getElementById('clock-tz1').textContent = clock1;
      document.getElementById('offset-tz1').textContent = W.getZoneOffsetLabel(state.simMs, state.tz1);
    }
    if (clock2 !== state.lastClock.tz2) {
      state.lastClock.tz2 = clock2;
      document.getElementById('clock-tz2').textContent = clock2;
      document.getElementById('offset-tz2').textContent = W.getZoneOffsetLabel(state.simMs, state.tz2);
    }
    var d1 = W.getDateInfo(state.simMs, state.tz1, state.locale);
    var d2 = W.getDateInfo(state.simMs, state.tz2, state.locale);
    if (d1.dateKey !== state.lastDateKeyTz1) {
      state.lastDateKeyTz1 = d1.dateKey;
      document.getElementById('date-tz1').textContent = d1.dateKey + ' · ' + d1.weekdayLong;
    }
    if (d2.dateKey !== state.lastDateKeyTz2) {
      state.lastDateKeyTz2 = d2.dateKey;
      document.getElementById('date-tz2').textContent = d2.dateKey + ' · ' + d2.weekdayLong;
    }
    if (d1.dayLabel !== state.lastDayLabel) {
      state.lastDayLabel = d1.dayLabel;
      state.dateMat.map = canvasTexture(drawDate(d1.dayLabel));
      state.dateMat.map.needsUpdate = true;
    }
    if (d1.weekdayShort !== state.lastWeekday) {
      state.lastWeekday = d1.weekdayShort;
      state.weekdayMat.map = canvasTexture(drawWeekday(d1.weekdayShort));
      state.weekdayMat.map.needsUpdate = true;
    }
    var tz2PM = W.getHandAngles(state.simMs, state.tz2).isPM;
    if (tz2PM !== state.lastTz2PM) {
      state.lastTz2PM = tz2PM;
      state.subdialMat.map = canvasTexture(drawSubdial(W.getZoneLabel(state.tz2, state.locale), tz2PM));
      state.subdialMat.map.needsUpdate = true;
    }
  }

  function tick(nowMs) {
    requestAnimationFrame(tick);
    if (!state.paused) {
      state.simMs = W.advance(anchor, nowMs, state.speed);
    }
    updateHands(nowMs);
    updateReadouts();
    controls.update();
    renderer.render(scene, camera);
  }
  requestAnimationFrame(tick);

  /* ============================== 交互 ============================== */
  function setAnchorNow(nowMs) {
    W.reAnchor(anchor, nowMs, state.simMs);
  }

  function setSpeed(speed) {
    state.speed = speed;
    state.paused = false;
    setAnchorNow(performance.now());
    document.getElementById('btn-pause').textContent = '暂停';
    document.querySelectorAll('[data-speed]').forEach(function (b) {
      b.classList.toggle('active', parseFloat(b.dataset.speed) === speed);
    });
  }

  function togglePause() {
    state.paused = !state.paused;
    setAnchorNow(performance.now());
    document.getElementById('btn-pause').textContent = state.paused ? '继续' : '暂停';
  }

  function setZone(which, zone) {
    zone = sanitizeZone(zone);
    if (state[which] === zone) return;
    state[which] = zone;
    var key = which === 'tz1' ? 'main' : 'sub';
    var cur = key === 'main' ? mainHands : subHands;
    transitions[key] = {
      start: performance.now(),
      duration: 900,
      from: { second: cur.second, minute: cur.minute, hour: cur.hour }
    };
    if (which === 'tz1') {
      state.dialMat.map = canvasTexture(drawDial(W.getZoneLabel(zone, state.locale)));
      state.dialMat.map.needsUpdate = true;
      document.getElementById('name-tz1').textContent = W.getZoneLabel(zone, state.locale);
    } else {
      state.subdialMat.map = canvasTexture(drawSubdial(W.getZoneLabel(zone, state.locale), W.getHandAngles(state.simMs, zone).isPM));
      state.subdialMat.map.needsUpdate = true;
      state.subZone = zone;
      document.getElementById('name-tz2').textContent = W.getZoneLabel(zone, state.locale);
    }
  }

  function bindUI() {
    var sel1 = document.getElementById('sel-tz1');
    var sel2 = document.getElementById('sel-tz2');
    var frag1 = document.createDocumentFragment();
    var frag2 = document.createDocumentFragment();
    zones.forEach(function (zone) {
      var label = zone + '（' + W.getZoneOffsetLabel(Date.now(), zone) + '）';
      var o1 = document.createElement('option');
      o1.value = zone;
      o1.textContent = label;
      frag1.appendChild(o1);
      var o2 = document.createElement('option');
      o2.value = zone;
      o2.textContent = label;
      frag2.appendChild(o2);
    });
    sel1.appendChild(frag1);
    sel2.appendChild(frag2);
    sel1.value = state.tz1;
    sel2.value = state.tz2;
    sel1.addEventListener('change', function () { setZone('tz1', sel1.value); });
    sel2.addEventListener('change', function () { setZone('tz2', sel2.value); });
    document.getElementById('name-tz1').textContent = W.getZoneLabel(state.tz1, state.locale);
    document.getElementById('name-tz2').textContent = W.getZoneLabel(state.tz2, state.locale);

    document.querySelectorAll('[data-speed]').forEach(function (b) {
      b.addEventListener('click', function () { setSpeed(parseFloat(b.dataset.speed)); });
    });
    document.getElementById('btn-pause').addEventListener('click', togglePause);
    document.getElementById('btn-autorotate').addEventListener('click', function () {
      state.autoRotate = !state.autoRotate;
      controls.autoRotate = state.autoRotate;
      this.classList.toggle('active', state.autoRotate);
    });
    document.getElementById('btn-reset').addEventListener('click', function () {
      camera.position.copy(HOME_CAMERA);
      controls.target.set(0, 0, 0);
      controls.update();
    });
  }

  bindUI();

  window.addEventListener('resize', function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  document.getElementById('btn-pause').textContent = '暂停';
  document.querySelector('[data-speed="1"]').classList.add('active');
  document.getElementById('offset-tz1').textContent = W.getZoneOffsetLabel(state.simMs, state.tz1);
  document.getElementById('offset-tz2').textContent = W.getZoneOffsetLabel(state.simMs, state.tz2);

  function showError(msg) {
    if (errorEl) {
      errorEl.textContent = msg;
      errorEl.style.display = 'block';
    }
  }

  /* ============================== 自检 ============================== */
  var testResults = [];
  function recordTest(name, pass, detail) {
    testResults.push({ name: name, pass: !!pass, detail: detail || '' });
    var el = document.getElementById('test-panel');
    if (!el) return;
    var line = document.createElement('div');
    line.className = 'test-line ' + (pass ? 'ok' : 'fail');
    line.textContent = (pass ? '✔ ' : '✘ ') + name + (detail ? ' — ' + detail : '');
    el.appendChild(line);
  }
  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  async function runSelfTest() {
    var panel = document.getElementById('test-panel');
    if (panel) panel.style.display = 'block';
    recordTest('WebGL 上下文创建', !!renderer, renderer ? 'Three.js r128' : '失败');
    recordTest('画布已挂载到页面', !!renderer && !!renderer.domElement.parentNode, '');

    await sleep(600);
    var frame0 = renderer.info.render.frame;
    await sleep(2000);
    var frame1 = renderer.info.render.frame;
    recordTest('渲染循环持续运行（2s 内新增帧 ≥10）', frame1 - frame0 >= 10, '新增 ' + (frame1 - frame0) + ' 帧');

    // 秒针连续性：真实时间 1x 下 600ms 应转动约 3.6°
    var r0 = state.handMeshes.main.second.rotation.z;
    await sleep(600);
    var r1 = state.handMeshes.main.second.rotation.z;
    var moved = Math.abs((r1 - r0) * 180 / Math.PI);
    var expectMove = 600 / 1000 * 6;
    recordTest('秒针平滑连续转动', Math.abs(moved - expectMove) < 1.0, '600ms 转动 ' + moved.toFixed(2) + '°（期望 ≈' + expectMove.toFixed(1) + '°）');

    var target = W.getHandAngles(state.simMs, state.tz1);
    var mm = state.handMeshes.main;
    var ma = -mm.minute.rotation.z * 180 / Math.PI;
    var ha = -mm.hour.rotation.z * 180 / Math.PI;
    recordTest('分针角度与目标一致', Math.abs(((ma - target.minute + 540) % 360) - 180) < 0.05, ma.toFixed(2) + '° vs ' + target.minute.toFixed(2) + '°');
    recordTest('时针角度与目标一致', Math.abs(((ha - target.hour + 540) % 360) - 180) < 0.05, ha.toFixed(2) + '° vs ' + target.hour.toFixed(2) + '°');

    var d1 = W.getDateInfo(state.simMs, state.tz1, state.locale);
    var dateWinLabel = state.lastDayLabel;
    recordTest('日期窗口显示当天日期', dateWinLabel === d1.dayLabel, dateWinLabel + '（今天 ' + d1.dateKey + '）');
    recordTest('星期窗口显示当天星期', state.lastWeekday === d1.weekdayShort, state.lastWeekday + '（' + d1.weekdayLong + '）');

    // 时区切换过渡
    var oldTz2 = state.tz2;
    var newTz2 = oldTz2 === 'UTC' ? 'Asia/Shanghai' : 'UTC';
    var beforeHour = -state.handMeshes.sub.hour.rotation.z * 180 / Math.PI;
    setZone('tz2', newTz2);
    document.getElementById('sel-tz2').value = newTz2;
    var mid = -state.handMeshes.sub.hour.rotation.z * 180 / Math.PI;
    await sleep(300);
    var during = -state.handMeshes.sub.hour.rotation.z * 180 / Math.PI;
    await sleep(900);
    var tSub = W.getHandAngles(state.simMs, newTz2);
    var after = -state.handMeshes.sub.hour.rotation.z * 180 / Math.PI;
    var diffBefore = Math.abs((((beforeHour - mid) % 360) + 540) % 360 - 180);
    var diffDuring = Math.abs((((during - mid) % 360) + 540) % 360 - 180);
    var diffAfter = Math.abs((((after - tSub.hour) % 360) + 540) % 360 - 180);
    recordTest('第二时区切换后走针平滑过渡', diffDuring > 0.5, '过渡中转动 ' + diffDuring.toFixed(1) + '°');
    recordTest('第二时区最终指向正确时间', diffAfter < 0.2, newTz2 + ' ' + after.toFixed(2) + '° vs 目标 ' + tSub.hour.toFixed(2) + '°');

    // 倍速
    setSpeed(60);
    var s0 = state.simMs;
    await sleep(500);
    var ratio = (state.simMs - s0) / (500 * 60);
    recordTest('60× 加速模拟时间推进', Math.abs(ratio - 1) < 0.1, '实际倍速 ' + ratio.toFixed(2) + '×');
    setSpeed(1);
    setZone('tz2', oldTz2);
    document.getElementById('sel-tz2').value = oldTz2;
    await sleep(1000);

    var passCount = testResults.filter(function (t) { return t.pass; }).length;
    var total = testResults.length;
    var head = document.getElementById('test-summary');
    if (head) head.textContent = '自检结果：' + passCount + '/' + total + (passCount === total ? ' 全部通过' : ' 存在失败项');
    if (panel) panel.classList.add('done');
    window.__watchSelfTest = testResults;
    console.log('[watch-selftest]', JSON.stringify(testResults));
  }

  if (params.get('test') !== null) {
    runSelfTest().catch(function (err) {
      recordTest('自检异常', false, String(err && err.message ? err.message : err));
    });
  }

  window.__watchApp = {
    state: state,
    core: W,
    setZone: setZone,
    setSpeed: setSpeed,
    togglePause: togglePause,
    hands: function () {
      return {
        main: Object.assign({}, mainHands),
        sub: Object.assign({}, subHands),
        simMs: state.simMs
      };
    }
  };
})();
