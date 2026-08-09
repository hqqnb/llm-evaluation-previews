(function () {
  const THREE = window.THREE;
  const U = window.TFPS.U;

  function vbox(parent, w, h, d, color, x, y, z, rough) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: rough == null ? 0.55 : rough, metalness: 0.35 })
    );
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  }
  function vcyl(parent, r, len, color, x, y, z, seg) {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, len, seg || 10),
      new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.4 })
    );
    m.rotation.x = Math.PI / 2;
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  const PARTS = {
    knife: g => {
      vbox(g, 0.03, 0.035, 0.16, 0x9aa3ad, 0, 0.015, -0.12);
      vbox(g, 0.012, 0.012, 0.1, 0x2b2f35, 0, 0.025, -0.22);
      vbox(g, 0.03, 0.04, 0.09, 0x23262b, 0, -0.005, 0.0);
    },
    pistol: (g, o) => {
      vbox(g, 0.036, 0.075, 0.2, o.body || 0x2d3138, 0, 0.02, -0.09);
      vbox(g, 0.034, 0.05, 0.09, o.body || 0x2d3138, 0, 0.045, -0.19);
      vbox(g, 0.026, 0.05, 0.05, o.mag || 0x23262b, 0, -0.015, -0.03);
      vbox(g, 0.026, 0.045, 0.07, o.grip || 0x1c1e22, 0, -0.045, 0.025);
      if (o.suppressor) vcyl(g, 0.014, 0.1, 0x22262c, 0, 0.045, -0.28);
      vbox(g, 0.02, 0.02, 0.05, 0x1b1e23, 0, 0.065, -0.1);
    },
    smg: (g, o) => {
      vbox(g, 0.042, 0.08, 0.32, o.body || 0x2d3138, 0, 0.02, -0.16);
      vcyl(g, 0.013, 0.16, 0x23262b, 0, 0.045, -0.34);
      vbox(g, 0.03, 0.09, 0.09, o.mag || 0x23262b, 0, -0.05, -0.08);
      vbox(g, 0.028, 0.05, 0.09, o.grip || 0x1c1e22, 0, -0.06, 0.06);
      vbox(g, 0.05, 0.055, 0.12, o.stock || 0x23262b, 0, 0.0, 0.14);
      vbox(g, 0.018, 0.025, 0.07, 0x1b1e23, 0, 0.075, -0.16);
    },
    rifle: (g, o) => {
      vbox(g, 0.048, 0.095, 0.5, o.body || 0x2f343b, 0, 0.025, -0.24);
      vcyl(g, 0.014, 0.22, 0x24272d, 0, 0.05, -0.56);
      vbox(g, 0.03, 0.1, 0.12, o.mag || 0x23262b, 0, -0.055, -0.12);
      vbox(g, 0.03, 0.055, 0.1, o.grip || 0x1d2025, 0, -0.065, 0.08);
      vbox(g, 0.05, 0.06, 0.16, o.stock || 0x2a2e34, 0, 0.02, 0.28);
      vbox(g, 0.018, 0.03, 0.1, 0x1b1e23, 0, 0.085, -0.24);
      vbox(g, 0.03, 0.04, 0.05, o.grip2 || 0x1b1e23, 0, 0.035, -0.5);
      if (o.wood) { vbox(g, 0.034, 0.04, 0.18, 0x6b4a2b, 0, 0.045, -0.08); }
    },
    sniper: (g, o) => {
      vbox(g, 0.05, 0.1, 0.6, 0x31363d, 0, 0.03, -0.3);
      vcyl(g, 0.016, 0.35, 0x202329, 0, 0.055, -0.68);
      vbox(g, 0.03, 0.1, 0.13, 0x23262b, 0, -0.06, -0.15);
      vbox(g, 0.032, 0.06, 0.1, 0x1d2025, 0, -0.07, 0.1);
      vbox(g, 0.055, 0.065, 0.2, 0x262a30, 0, 0.02, 0.34);
      vcyl(g, 0.035, 0.24, 0x171a1e, 0, 0.075, -0.38, 10);
      vbox(g, 0.02, 0.05, 0.05, 0x111317, 0, 0.08, -0.5);
    },
    shotgun: (g, o) => {
      vbox(g, 0.05, 0.09, 0.5, 0x3a3228, 0, 0.025, -0.25);
      vcyl(g, 0.02, 0.3, 0x2a2620, 0, 0.05, -0.58);
      vbox(g, 0.03, 0.1, 0.12, 0x2a2620, 0, -0.05, -0.15);
      vbox(g, 0.03, 0.055, 0.1, 0x241f18, 0, -0.065, 0.08);
      vbox(g, 0.06, 0.06, 0.18, 0x4a3c28, 0, 0.01, 0.28);
      vbox(g, 0.014, 0.02, 0.08, 0x1b1e23, 0, 0.07, -0.24);
    },
    grenade: (g, o) => {
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), new THREE.MeshStandardMaterial({ color: o.color || 0x3a5a3a, roughness: 0.7 }));
      sphere.position.set(0, 0.02, -0.05);
      g.add(sphere);
      vbox(g, 0.012, 0.012, 0.05, 0x777777, 0, 0.09, -0.07);
      vbox(g, 0.02, 0.025, 0.03, 0x555555, 0, 0.07, -0.08);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.005, 6, 10), new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.8 }));
      ring.position.set(0, 0.075, -0.07);
      g.add(ring);
    }
  };

  const VIEW_DEFS = {
    knife: { fn: "knife" },
    glock: { fn: "pistol", body: 0x33383f, grip: 0x23262b },
    usp: { fn: "pistol", body: 0x30363d, grip: 0x1f2227, suppressor: true },
    deagle: { fn: "pistol", body: 0x4a3c28, grip: 0x2a2018, mag: 0x3a3024 },
    mp5: { fn: "smg", body: 0x3a4048, stock: 0x2c3138 },
    mp7: { fn: "smg", body: 0x353b44, stock: 0x2a2f36 },
    nova: { fn: "shotgun" },
    ak47: { fn: "rifle", body: 0x3d342b, stock: 0x5a432a, wood: true, grip2: 0x6b4a2b },
    m4a4: { fn: "rifle", body: 0x36404c, stock: 0x2d3640 },
    awp: { fn: "sniper" },
    he: { fn: "grenade", color: 0x3f5f3f },
    flash: { fn: "grenade", color: 0xd8dde2 },
    smoke: { fn: "grenade", color: 0x4f565e },
    molotov: { fn: "grenade", color: 0x8a3a2a }
  };

  class WeaponModels {
    constructor(scene) {
      this.root = new THREE.Group();
      this.root.visible = true;
      scene.add(this.root);
      this.models = {};
      for (const id in VIEW_DEFS) {
        const g = new THREE.Group();
        const def = VIEW_DEFS[id];
        PARTS[def.fn](g, def);
        g.visible = false;
        this.root.add(g);
        this.models[id] = g;
        // muzzle local position
        g.userData.muzzle = new THREE.Vector3(0, 0.05, -0.1);
      }
      this.current = null;
    }
    show(id) {
      if (this.current) this.models[this.current].visible = false;
      this.current = id;
      if (id && this.models[id]) this.models[id].visible = true;
    }
    getMuzzleWorld(out) {
      if (!this.current) return null;
      const m = this.models[this.current];
      const v = m.userData.muzzle.clone();
      return m.localToWorld(v);
    }
    applyPose(id, dt, pose) {
      const m = this.models[id];
      if (!m) return;
      m.position.set(pose.x || 0, pose.y || 0, pose.z || 0);
      m.rotation.set(pose.rx || 0, pose.ry || 0, pose.rz || 0);
    }
  }

  // Spread / recoil helpers shared by player and bots
  function getSpread(player, def) {
    let s = def.spread || 0.02;
    const speed = player.speed || 0;
    const moveRatio = speed / 5.1;
    s *= 1 + moveRatio * moveRatio * 1.6;
    if (player.crouching) s *= 0.6;
    if (player.jumping) s *= 2.4;
    if (player.ads && def.zoomFov) s *= 0.25;
    if (player.weapon && player.weapon.recoilIdx > 0) s *= 1 + Math.min(0.9, player.weapon.recoilIdx * 0.035);
    if (player.sprinting) s *= 1.8;
    if (player.quiet) s *= 1.05;
    return s;
  }
  const PATTERNS = {
    rifle: [
      [0.7, -0.5], [1.4, -1.1], [2.1, -1.7], [2.8, -2.2], [3.5, -2.7], [4.2, -3.2], [4.8, -3.7],
      [5.4, -4.2], [6.0, -4.8], [6.6, -5.4], [7.2, -6.0], [7.7, -6.7], [8.2, -7.4], [8.7, -8.1],
      [9.2, -8.8], [9.7, -9.4], [10.2, -10.0], [10.7, -10.6], [11.2, -11.2], [11.7, -11.8],
      [12.2, -12.4], [12.7, -13.0], [13.2, -13.6], [13.7, -14.2], [14.2, -14.8], [14.7, -15.4],
      [15.2, -16.0], [15.7, -16.6], [16.2, -17.2], [16.7, -17.8]
    ],
    smg: [
      [1.0, 0.6], [1.8, 1.2], [2.5, 1.8], [3.1, 2.4], [3.6, 3.0], [4.0, 3.6], [4.4, 4.2],
      [4.8, 4.8], [5.2, 5.4], [5.6, 6.0], [6.0, 6.5], [6.4, 7.0], [6.8, 7.5], [7.2, 8.0],
      [7.6, 8.5], [8.0, 9.0], [8.4, 9.5], [8.8, 10.0], [9.2, 10.5], [9.6, 11.0]
    ],
    pistol: [
      [2.2, -1.2], [3.8, -2.6], [5.2, -4.0], [6.4, -5.4], [7.4, -6.8], [8.4, -8.2], [9.2, -9.6]
    ],
    sniper: [[6.0, 0]],
    shotgun: [[5.0, 0], [6.5, 1.5]]
  };
  function getPattern(def) {
    if (def.slot === "rifle") return PATTERNS.rifle;
    if (def.slot === "smg") return PATTERNS.smg;
    if (def.slot === "sniper") return PATTERNS.sniper;
    if (def.slot === "shotgun") return PATTERNS.shotgun;
    return PATTERNS.pistol;
  }

  window.TFPS.WeaponModels = WeaponModels;
  window.TFPS.WS = { getSpread, getPattern };
})();
