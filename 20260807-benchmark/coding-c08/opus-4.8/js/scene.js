// scene.js — renderer, scene, camera, lighting, sky
import * as THREE from 'three';
import { skyTex } from './textures.js';

export class Stage {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xcdbb92, 60, 220);

    this.camera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.02, 600);

    // Sky dome
    const skyGeo = new THREE.SphereGeometry(400, 24, 16);
    const skyMat = new THREE.MeshBasicMaterial({ map: skyTex(), side: THREE.BackSide, fog: false });
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(this.sky);

    // Lighting: warm sun + sky ambient
    this.sun = new THREE.DirectionalLight(0xfff0d0, 1.15);
    this.sun.position.set(60, 120, 40);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = 90;
    this.sun.shadow.camera.left = -s; this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s; this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 300;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x8a7040, 0.85));
    this.scene.add(new THREE.AmbientLight(0x606060, 0.4));

    // viewmodel scene rendered on top (weapon never clips walls)
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 10);
    this.vmScene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 1.1));
    const vmSun = new THREE.DirectionalLight(0xffffff, 0.9); vmSun.position.set(1, 2, 2); this.vmScene.add(vmSun);

    window.addEventListener('resize', () => this.onResize());
  }
  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h; this.vmCamera.updateProjectionMatrix();
  }
  setFov(f) { this.camera.fov = f; this.camera.updateProjectionMatrix(); }
  render() {
    this.renderer.autoClear = true;
    this.renderer.render(this.scene, this.camera);
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.vmScene, this.vmCamera);
  }
}
