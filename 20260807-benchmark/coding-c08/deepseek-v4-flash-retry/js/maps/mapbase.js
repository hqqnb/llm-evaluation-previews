(function () {
  const THREE = window.THREE;
  const TEX = window.TFPS.TEX;
  const NavGraph = window.TFPS.NavGraph;

  class MapBuilder {
    constructor(scene, theme) {
      this.scene = scene;
      this.theme = theme || "sand";
      this.colliders = [];
      this.solidGroup = new THREE.Group();
      this.decorGroup = new THREE.Group();
      this.lightGroup = new THREE.Group();
      this.nav = new NavGraph();
      this.spawns = { T: [], CT: [] };
      this.sites = {};
      this.props = [];
      this.doors = [];
      this.bounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
      this.mats = {};
    }
    mat(kind, opts) {
      const key = kind + "_" + (opts ? JSON.stringify(opts) : "");
      if (this.mats[key]) return this.mats[key];
      const o = opts || {};
      let m;
      if (o.color !== undefined) {
        m = new THREE.MeshLambertMaterial({ color: o.color });
      } else if (kind === "sand") {
        m = new THREE.MeshLambertMaterial({ map: TEX.get("sandWall") });
      } else if (kind === "ground") {
        m = new THREE.MeshLambertMaterial({ map: TEX.get("sandGround") });
      } else {
        m = new THREE.MeshLambertMaterial({ map: TEX.get(kind) });
      }
      this.mats[key] = m;
      return m;
    }
    box(cx, cy, cz, w, h, d, mat, opts) {
      const o = opts || {};
      const geo = new THREE.BoxGeometry(w, h, d);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(cx, cy, cz);
      mesh.castShadow = o.cast !== false;
      mesh.receiveShadow = o.receive !== false;
      this.solidGroup.add(mesh);
      if (!o.noCollide) {
        this.colliders.push({
          min: { x: cx - w / 2, y: cy - h / 2, z: cz - d / 2 },
          max: { x: cx + w / 2, y: cy + h / 2, z: cz + d / 2 }
        });
      }
      mesh.userData.solid = !o.noSolid;
      return mesh;
    }
    wall(cx, cz, w, d, h, mat, opts) {
      return this.box(cx, h / 2, cz, w, h, d, mat || this.mat("sand"), opts);
    }
    // Stairs made of steps; returns meshes
    stairs(cx, cz, w, dir, steps, rise, run, mat) {
      const m = mat || this.mat("concrete");
      for (let i = 0; i < steps; i++) {
        const y = rise * (i + 0.5);
        const off = run * (i + 0.5);
        if (dir === "n") this.box(cx, y, cz - off, w, rise, run, m);
        else if (dir === "s") this.box(cx, y, cz + off, w, rise, run, m);
        else if (dir === "e") this.box(cx + off, y, cz, run, rise, w, m);
        else this.box(cx - off, y, cz, run, rise, w, m);
      }
    }
    // Arch doorway: two pillars + lintel + optional curved top
    arch(cx, cz, width, height, thickness, mat, opts) {
      const o = opts || {};
      const m = mat || this.mat("sand");
      const pw = thickness;
      const noCol = Object.assign({}, o, { noCollide: true });
      this.box(cx - width / 2 + pw / 2, height / 2 - 0.3, cz, pw, height - 0.3, thickness, m, noCol);
      this.box(cx + width / 2 - pw / 2, height / 2 - 0.3, cz, pw, height - 0.3, thickness, m, noCol);
      this.box(cx, height - 0.35, cz, width, 0.7, thickness, m, noCol);
      if (o.curve !== false) {
        const r = width / 2;
        const arc = new THREE.Mesh(
          new THREE.TorusGeometry(r, thickness / 2, 8, 12, Math.PI),
          m
        );
        arc.position.set(cx, height - 0.7, cz);
        arc.rotation.x = Math.PI / 2;
        arc.rotation.z = Math.PI;
        arc.castShadow = true;
        this.solidGroup.add(arc);
      }
    }
    crate(cx, cy, cz, w, h, d, kind, opts) {
      const m = kind === "metal" ? this.mat("crateMetal") : this.mat("crateWood");
      return this.box(cx, cy, cz, w, h, d, m, opts);
    }
    barrel(cx, cy, cz, r, h, color, opts) {
      const o = opts || {};
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 12), new THREE.MeshLambertMaterial({ color }));
      mesh.position.set(cx, cy + h / 2, cz);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.solidGroup.add(mesh);
      if (!o.noCollide) this.colliders.push({ min: { x: cx - r, y: cy, z: cz - r }, max: { x: cx + r, y: cy + h, z: cz + r } });
      return mesh;
    }
    sandbag(cx, cy, cz, w, h, d) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: 0x9a8b62 }));
      mesh.position.set(cx, cy, cz);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.solidGroup.add(mesh);
      this.colliders.push({ min: { x: cx - w / 2, y: cy - h / 2, z: cz - d / 2 }, max: { x: cx + w / 2, y: cy + h / 2, z: cz + d / 2 } });
      return mesh;
    }
    pillar(cx, cz, r, h, mat) {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 10), mat || this.mat("concrete"));
      mesh.position.set(cx, h / 2, cz);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.solidGroup.add(mesh);
      this.colliders.push({ min: { x: cx - r, y: 0, z: cz - r }, max: { x: cx + r, y: h, z: cz + r } });
      return mesh;
    }
    doubleDoor(cx, cz, width, height, mat, opts) {
      const o = opts || {};
      const m = mat || this.mat("metal");
      const half = width / 2;
      const thick = o.thick || 0.12;
      const axis = o.axis || "z";
      const pivotL = new THREE.Group(), pivotR = new THREE.Group();
      let collL, collR;
      if (axis === "x") {
        const meshL = new THREE.Mesh(new THREE.BoxGeometry(half, height, thick), m);
        const meshR = new THREE.Mesh(new THREE.BoxGeometry(half, height, thick), m);
        pivotL.position.set(cx - half, 0, cz);
        pivotR.position.set(cx + half, 0, cz);
        meshL.position.set(half / 2, height / 2, 0);
        meshR.position.set(-half / 2, height / 2, 0);
        pivotL.add(meshL); pivotR.add(meshR);
        collL = { min: { x: cx - half, y: 0, z: cz - thick / 2 }, max: { x: cx, y: height, z: cz + thick / 2 } };
        collR = { min: { x: cx, y: 0, z: cz - thick / 2 }, max: { x: cx + half, y: height, z: cz + thick / 2 } };
      } else {
        const meshL = new THREE.Mesh(new THREE.BoxGeometry(thick, height, half), m);
        const meshR = new THREE.Mesh(new THREE.BoxGeometry(thick, height, half), m);
        pivotL.position.set(cx, 0, cz - half);
        pivotR.position.set(cx, 0, cz + half);
        meshL.position.set(0, height / 2, half / 2);
        meshR.position.set(0, height / 2, -half / 2);
        pivotL.add(meshL); pivotR.add(meshR);
        collL = { min: { x: cx - thick / 2, y: 0, z: cz - half }, max: { x: cx + thick / 2, y: height, z: cz } };
        collR = { min: { x: cx - thick / 2, y: 0, z: cz }, max: { x: cx + thick / 2, y: height, z: cz + half } };
      }
      pivotL.castShadow = true; pivotR.castShadow = true;
      this.solidGroup.add(pivotL); this.solidGroup.add(pivotR);
      this.colliders.push(collL, collR);
      const door = { pivotL, pivotR, collL, collR, half, closed: true, angle: 0, targetAngle: 0, speed: 2.2, axis };
      this.doors.push(door);
      return door;
    }
    floor(cx, cz, w, d, mat, y) {
      return this.box(cx, (y || 0) - 0.08, cz, w, 0.16, d, mat || this.mat("concrete"), { cast: false });
    }
    decor(mesh, opts) {
      mesh.castShadow = opts ? opts.cast !== false : true;
      this.decorGroup.add(mesh);
      if (opts && opts.collide) {
        // simple sphere collider
        this.colliders.push({ min: { x: mesh.position.x - 0.3, y: mesh.position.y - 0.3, z: mesh.position.z - 0.3 }, max: { x: mesh.position.x + 0.3, y: mesh.position.y + 0.3, z: mesh.position.z + 0.3 } });
      }
      return mesh;
    }
    sign(cx, cy, cz, w, h, text, color, opts) {
      const c = document.createElement("canvas");
      c.width = 256; c.height = 128;
      const x = c.getContext("2d");
      x.fillStyle = color || "#1c222b"; x.fillRect(0, 0, 256, 128);
      x.strokeStyle = "#d9a94e"; x.lineWidth = 6; x.strokeRect(8, 8, 240, 112);
      x.fillStyle = "#f2e2b0"; x.font = "bold 42px sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText(text, 128, 66);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide }));
      mesh.position.set(cx, cy, cz);
      if (opts && opts.rotY) mesh.rotation.y = opts.rotY;
      this.decor(mesh, { cast: false });
      return mesh;
    }
    lamp(cx, cy, cz, color, intensity, distance) {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), new THREE.MeshBasicMaterial({ color: color || 0xfff2cc }));
      bulb.position.set(cx, cy, cz);
      this.decor(bulb, { cast: false });
      const light = new THREE.PointLight(color || 0xfff2cc, intensity || 0.8, distance || 18, 1.6);
      light.position.set(cx, cy, cz);
      this.lightGroup.add(light);
      return light;
    }
    addNav(id, x, z, y, flags) { return this.nav.add(id, x, z, y, flags); }
    linkNav(a, b, oneWay) { this.nav.link(a, b, oneWay); }
    addSpawn(team, x, z, yaw) {
      this.spawns[team.toUpperCase()].push({ x, z, yaw });
    }
    addSite(id, x, z, radius, spots, label) {
      this.sites[id] = { id, x, z, radius, spots, label };
    }
    setBounds(minX, maxX, minZ, maxZ) { this.bounds = { minX, maxX, minZ, maxZ }; }
    build() {
      return {
        solidGroup: this.solidGroup,
        decorGroup: this.decorGroup,
        lightGroup: this.lightGroup,
        colliders: this.colliders,
        nav: this.nav,
        spawns: this.spawns,
        sites: this.sites,
        bounds: this.bounds,
        theme: this.theme,
        doors: this.doors
      };
    }
  }
  window.TFPS.MapBuilder = MapBuilder;
})();
