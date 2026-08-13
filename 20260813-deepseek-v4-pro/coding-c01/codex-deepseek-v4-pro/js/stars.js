// ---------- 深空背景：星空、银河、星云、恒星、流星、航速尘埃 ----------
import * as THREE from 'three';
import { TAU, rng, clamp, radialGlowTexture, gradientTexture } from './utils.js';

const STAR_VERT = /* glsl */ `
attribute float aSize;
attribute float aPhase;
attribute vec3 aColor;
varying vec3 vColor;
varying float vPhase;
void main() {
  vColor = aColor;
  vPhase = aPhase;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (110000.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const STAR_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vPhase;
uniform float uTime;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p);
  float a = smoothstep(0.5, 0.04, d);
  float tw = 0.5 + 0.5 * sin(uTime * (0.4 + vPhase * 2.2) + vPhase * 47.0);
  gl_FragColor = vec4(vColor, a * (0.35 + 0.65 * tw));
}`;

function makeStars(count, seed, spread) {
  const rand = rng(seed);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const phase = new Float32Array(count);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const v = new THREE.Vector3();
    if (spread === 'band') {
      // 银河带：绕一个倾斜大圆的窄带
      const along = rand() * TAU;
      const off = (rand() * 2 - 1) * 0.16;
      const tilt = 0.55;
      v.set(Math.cos(along), off, Math.sin(along));
      v.applyEuler(new THREE.Euler(tilt, 0.35, 0));
    } else {
      v.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
    }
    v.multiplyScalar(125000 + rand() * 25000);
    pos.set([v.x, v.y, v.z], i * 3);
    const t = rand();
    if (t < 0.72) c.setHex(0xffffff);
    else if (t < 0.84) c.setHex(0xaac4ff);
    else if (t < 0.93) c.setHex(0xffe2b8);
    else c.setHex(0xffc8c8);
    col.set([c.r, c.g, c.b], i * 3);
    size[i] = 0.6 + rand() * 2.1;
    phase[i] = rand();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  return geo;
}

export class DeepSpace {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this.root = new THREE.Group();
    scene.add(this.root);

    this.starMat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const stars = new THREE.Points(makeStars(5200, 101, 'sphere'), this.starMat);
    stars.renderOrder = -2;
    this.root.add(stars);

    const bandMat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const band = new THREE.Points(makeStars(3600, 222, 'band'), bandMat);
    band.renderOrder = -2;
    this.root.add(band);
    this.starMats = [this.starMat, bandMat];

    // 星云
    this.nebulaGroup = new THREE.Group();
    this.root.add(this.nebulaGroup);
    const palette = ['#2b6f9e', '#5d3f8f', '#9e4f6b', '#2f7f6f', '#3a5a8f'];
    const rand = rng(777);
    for (let i = 0; i < 10; i++) {
      const tex = radialGlowTexture(
        `rgba(${parseInt(palette[i % palette.length].slice(1, 3), 16)},${parseInt(palette[i % palette.length].slice(3, 5), 16)},${parseInt(palette[i % palette.length].slice(5, 7), 16)},0.8)`,
        'rgba(0,0,0,0)',
        256
      );
      const mat = new THREE.SpriteMaterial({
        map: tex, transparent: true, opacity: 0.05 + rand() * 0.07,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const sp = new THREE.Sprite(mat);
      const dir = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
      sp.position.copy(dir.multiplyScalar(90000 + rand() * 25000));
      const s = 18000 + rand() * 42000;
      sp.scale.set(s, s * (0.6 + rand() * 0.5), 1);
      sp.material.rotation = rand() * TAU;
      this.nebulaGroup.add(sp);
    }

    // 恒星（太阳方向光 + 光晕）
    this.sunDir = new THREE.Vector3(0.45, 0.7, 0.38).normalize();
    this.sun = new THREE.DirectionalLight(0xfff2dd, 3.5);
    this.sun.position.copy(this.sunDir).multiplyScalar(50000);
    this.root.add(this.sun);
    this.rim = new THREE.DirectionalLight(0x3355aa, 0.85);
    this.rim.position.set(-0.4, -0.25, -0.5).multiplyScalar(30000);
    this.root.add(this.rim);
    this.hemi = new THREE.HemisphereLight(0x33415e, 0x060810, 0.5);
    this.root.add(this.hemi);

    const sunSpriteTex = radialGlowTexture('rgba(255,244,220,1)', 'rgba(255,210,140,0)', 256);
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sunSpriteTex, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    }));
    this.sunSprite.position.copy(this.sunDir).multiplyScalar(180000);
    this.sunSprite.scale.set(14000, 14000, 1);
    this.sunSprite.renderOrder = -1;
    this.root.add(this.sunSprite);

    // 航速尘埃
    this.dustN = 700;
    const dpos = new Float32Array(this.dustN * 3);
    for (let i = 0; i < this.dustN; i++) {
      const v = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize()
        .multiplyScalar(4000 + rand() * 22000);
      dpos.set([v.x, v.y, v.z], i * 3);
    }
    const dgeo = new THREE.BufferGeometry();
    dgeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
    this.dust = new THREE.Points(dgeo, new THREE.PointsMaterial({
      color: 0x8fb7d8, size: 1.6, sizeAttenuation: true,
      transparent: true, opacity: 0.65, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.dust.frustumCulled = false;
    this.root.add(this.dust);

    // 超光速航迹线（高速时才显示）
    this.streakN = 160;
    const spos = new Float32Array(this.streakN * 3);
    for (let i = 0; i < this.streakN; i++) {
      spos[i * 3] = rand() * 30000 - 15000;
      spos[i * 3 + 1] = rand() * 60000 - 30000;
      spos[i * 3 + 2] = rand() * 30000 - 15000;
    }
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.BufferAttribute(spos, 3));
    this.streakMat = new THREE.PointsMaterial({
      color: 0x9fd0ff, size: 1.8, sizeAttenuation: true, transparent: true,
      opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.streaks = new THREE.Points(sgeo, this.streakMat);
    this.streaks.frustumCulled = false;
    this.root.add(this.streaks);

    // 流星
    this.meteors = [];
    this.nextMeteor = 5;
  }

  spawnMeteor() {
    const rand = rng((Math.random() * 1e9) | 0);
    const origin = new THREE.Vector3(rand() * 2 - 1, rand() * 0.5 + 0.1, rand() * 2 - 1)
      .normalize().multiplyScalar(80000);
    const dir = new THREE.Vector3(-0.4, -0.7, 0.3).normalize();
    const geo = new THREE.CylinderGeometry(0.5, 4, 2600, 5, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xcfe6ff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(origin);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    this.root.add(m);
    this.meteors.push({ mesh: m, dir, life: 0, max: 1.3, speed: 18000 + rand() * 9000 });
  }

  update(dt, travelSpeed) {
    this.time += dt;
    for (const m of this.starMats) m.uniforms.uTime.value = this.time;

    this.nebulaGroup.rotation.y += dt * 0.0016;
    this.nebulaGroup.rotation.x += dt * 0.0007;

    // 航速尘埃（沿主轴方向 = 视线中的 Y 轴反向漂移，模拟飞船前进）
    const sp = travelSpeed * 3.2;
    const dpos = this.dust.geometry.attributes.position;
    for (let i = 0; i < this.dustN; i++) {
      let y = dpos.getY(i) - sp * dt;
      if (y < -26000) y += 52000;
      dpos.setY(i, y);
    }
    dpos.needsUpdate = true;

    // 高速航迹
    const target = clamp((travelSpeed - 2500) / 4500, 0, 1);
    this.streakMat.opacity += (target * 0.35 - this.streakMat.opacity) * Math.min(1, dt * 3);
    const spos = this.streaks.geometry.attributes.position;
    for (let i = 0; i < this.streakN; i++) {
      let y = spos.getY(i) - (2000 + travelSpeed * 1.2) * dt;
      if (y < -32000) y += 64000;
      spos.setY(i, y);
    }
    spos.needsUpdate = true;

    // 流星
    this.nextMeteor -= dt;
    if (this.nextMeteor <= 0 && this.meteors.length < 3) {
      this.spawnMeteor();
      this.nextMeteor = 7 + Math.random() * 10;
    }
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const mt = this.meteors[i];
      mt.life += dt;
      mt.mesh.position.addScaledVector(mt.dir, mt.speed * dt);
      const t = mt.life / mt.max;
      mt.mesh.material.opacity = t < 0.15 ? t / 0.15 * 0.9 : (1 - t) * 0.9;
      if (mt.life >= mt.max) {
        this.root.remove(mt.mesh);
        mt.mesh.geometry.dispose();
        mt.mesh.material.dispose();
        this.meteors.splice(i, 1);
      }
    }
  }
}
