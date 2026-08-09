(function () {
  const THREE = window.THREE;
  const U = window.TFPS.U;

  function makeGlowTex() {
    const c = document.createElement("canvas");
    c.width = 64; c.height = 64;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }
  function makeSmokeTex() {
    const c = document.createElement("canvas");
    c.width = 128; c.height = 128;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(64, 64, 4, 64, 64, 60);
    g.addColorStop(0, "rgba(220,220,220,0.95)");
    g.addColorStop(0.5, "rgba(190,190,190,0.6)");
    g.addColorStop(1, "rgba(170,170,170,0)");
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }

  class Effects {
    constructor(scene) {
      this.scene = scene;
      this.group = new THREE.Group();
      scene.add(this.group);
      this.glowTex = makeGlowTex();
      this.smokeTex = makeSmokeTex();
      this.tracers = [];
      this.sparks = [];
      this.smokes = [];
      this.fires = [];
      this.casings = [];
      this.decals = [];
      this.muzzleFx = [];
      this.lights = [];
      this.particleCap = 220;
    }
    clear() {
      while (this.group.children.length) {
        const o = this.group.children[0];
        this.group.remove(o);
        o.geometry && o.geometry.dispose();
        if (o.material) { if (Array.isArray(o.material)) o.material.forEach(m => m.dispose()); else o.material.dispose(); }
      }
      this.tracers.length = 0; this.sparks.length = 0; this.smokes.length = 0;
      this.fires.length = 0; this.casings.length = 0; this.decals.length = 0;
      this.muzzleFx.length = 0; this.lights.length = 0;
    }
    sprite(tex, size, color, opacity, additive) {
      const m = new THREE.SpriteMaterial({
        map: tex, color: color || 0xffffff, transparent: true, opacity: opacity == null ? 1 : opacity,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false
      });
      const s = new THREE.Sprite(m);
      s.scale.set(size, size, 1);
      this.group.add(s);
      return s;
    }
    tracer(from, to, color) {
      if (this.tracers.length > 80) { const old = this.tracers.shift(); this.group.remove(old.mesh); old.mesh.geometry.dispose(); old.mesh.material.dispose(); }
      const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
      const mat = new THREE.LineBasicMaterial({ color: color || 0xffd27a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
      const line = new THREE.Line(geo, mat);
      this.group.add(line);
      this.tracers.push({ mesh: line, life: 0.09, max: 0.09 });
    }
    muzzle(pos, dir, color, scale) {
      const s = this.sprite(this.glowTex, (scale || 0.5) * U.rand(0.8, 1.3), color || 0xffcc66, 1, true);
      s.position.copy(pos);
      s.lookAt(pos.clone().add(dir));
      this.muzzleFx.push({ sprite: s, life: 0.045 });
      const light = new THREE.PointLight(color || 0xffaa44, 1.4, 7, 2);
      light.position.copy(pos);
      this.group.add(light);
      this.lights.push({ light, life: 0.05 });
    }
    spark(pos, vel, color, count, size, gravity) {
      if (this.sparks.length > this.particleCap - 20) return;
      count = count || 6;
      for (let i = 0; i < count; i++) {
        const sp = this.sprite(this.glowTex, (size || 0.06) * U.rand(0.6, 1.4), color, 1, true);
        sp.position.copy(pos);
        sp.userData.vel = vel.clone().add(new THREE.Vector3(U.rand(-2, 2), U.rand(-0.5, 2), U.rand(-2, 2))).multiplyScalar(U.rand(0.5, 1.2));
        sp.userData.life = U.rand(0.25, 0.7);
        sp.userData.grav = gravity == null ? 9 : gravity;
        this.sparks.push(sp);
      }
    }
    casing(pos, vel) {
      if (this.casings.length > 40) return;
      const g = new THREE.BoxGeometry(0.018, 0.018, 0.045);
      const m = new THREE.MeshLambertMaterial({ color: 0xd8a94e });
      const c = new THREE.Mesh(g, m);
      c.position.copy(pos);
      c.userData.vel = vel.clone();
      c.userData.life = 1.4;
      c.userData.rot = new THREE.Vector3(U.rand(-8, 8), U.rand(-8, 8), U.rand(-8, 8));
      this.group.add(c);
      this.casings.push(c);
    }
    decal(pos, normal, color) {
      if (this.decals.length > 120) {
        const old = this.decals.shift();
        this.group.remove(old.mesh); old.mesh.geometry.dispose(); old.mesh.material.dispose();
      }
      const geo = new THREE.CircleGeometry(U.rand(0.05, 0.12), 8);
      const mat = new THREE.MeshBasicMaterial({ color: color || 0x2a2a2a, transparent: true, opacity: 0.85, depthWrite: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos).addScaledVector(normal, 0.01);
      mesh.lookAt(pos.clone().add(normal));
      mesh.rotateZ(Math.random() * Math.PI);
      this.group.add(mesh);
      this.decals.push({ mesh, life: 6 });
    }
    smoke(pos, radius, duration) {
      if (this.smokes.length > 14) return;
      const parts = [];
      for (let i = 0; i < 10; i++) {
        const off = new THREE.Vector3(U.rand(-1, 1), U.rand(0, 1.2), U.rand(-1, 1)).normalize().multiplyScalar(U.rand(0, radius * 0.55));
        const s = this.sprite(this.smokeTex, U.rand(radius * 0.7, radius * 1.1), 0xcfcfcf, 0.72, false);
        s.position.copy(pos).add(off);
        s.userData.base = s.position.clone();
        s.userData.phase = Math.random() * 10;
        s.userData.scaleTarget = s.scale.x * U.rand(1.6, 2.4);
        parts.push(s);
      }
      this.smokes.push({ pos: pos.clone(), radius, duration, life: 0, parts, blocked: true });
    }
    smokeBlocked(a, b) {
      for (const s of this.smokes) {
        if (s.life > 0.4 && s.life < s.duration - 0.3) {
          const t = U.segClosestPoint(s.pos, a, b);
          const dx = t.x - s.pos.x, dy = t.y - s.pos.y, dz = t.z - s.pos.z;
          if (dx * dx + dy * dy + dz * dz < s.radius * s.radius * 0.75) return true;
        }
      }
      return false;
    }
    fire(pos, radius, duration) {
      if (this.fires.length > 8) return;
      const flames = [];
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * radius * 0.8;
        const s = this.sprite(this.glowTex, U.rand(0.5, 1.1), i % 3 === 0 ? 0xff6622 : 0xffaa22, 0.95, true);
        s.position.set(this.scene ? 0 : 0, 0, 0);
        const p = new THREE.Vector3(pos.x + Math.cos(a) * r, pos.y + U.rand(0, 0.5), pos.z + Math.sin(a) * r);
        s.position.copy(p);
        s.userData.phase = Math.random() * 10;
        s.userData.base = p.clone();
        flames.push(s);
      }
      const light = new THREE.PointLight(0xff7722, 1.6, 10, 2);
      light.position.set(pos.x, pos.y + 0.8, pos.z);
      this.group.add(light);
      this.fires.push({ pos: pos.clone(), radius, duration, life: 0, flames, light, lastCrackle: 0 });
    }
    explosion(pos, radius) {
      const flash = this.sprite(this.glowTex, radius * 1.5, 0xffcc66, 1, true);
      flash.position.copy(pos);
      this.muzzleFx.push({ sprite: flash, life: 0.12 });
      const ringGeo = new THREE.RingGeometry(0.3, 0.55, 24);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xffdd88, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.copy(pos);
      ring.lookAt(pos.clone().add(new THREE.Vector3(0, 1, 0)));
      this.group.add(ring);
      this.muzzleFx.push({ sprite: ring, life: 0.35, ring: true });
      this.spark(pos, new THREE.Vector3(0, 4, 0), 0xff8833, 18, 0.12, 6);
      this.spark(pos, new THREE.Vector3(0, 1, 0), 0x444444, 14, 0.15, 4);
      const light = new THREE.PointLight(0xffaa44, 3.2, radius * 3, 2);
      light.position.copy(pos);
      this.group.add(light);
      this.lights.push({ light, life: 0.4 });
      // shockwave dust
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = this.sprite(this.smokeTex, U.rand(1, 2.2), 0x9a8a72, 0.5, false);
        s.position.copy(pos);
        s.userData.vel = new THREE.Vector3(Math.cos(a) * U.rand(1, 3), U.rand(0.3, 1.5), Math.sin(a) * U.rand(1, 3));
        s.userData.life = U.rand(0.8, 1.5);
        s.userData.grav = 1.5;
        this.sparks.push(s);
      }
    }
    update(dt) {
      const t = performance.now() / 1000;
      for (let i = this.tracers.length - 1; i >= 0; i--) {
        const tr = this.tracers[i];
        tr.life -= dt;
        tr.mesh.material.opacity = Math.max(0, tr.life / tr.max);
        if (tr.life <= 0) { this.group.remove(tr.mesh); tr.mesh.geometry.dispose(); tr.mesh.material.dispose(); this.tracers.splice(i, 1); }
      }
      for (let i = this.muzzleFx.length - 1; i >= 0; i--) {
        const mz = this.muzzleFx[i];
        mz.life -= dt;
        if (mz.sprite.material) mz.sprite.material.opacity = Math.max(0, mz.life * 8);
        if (mz.ring) mz.sprite.scale.multiplyScalar(1 + dt * 18);
        if (mz.life <= 0) { this.group.remove(mz.sprite); if (mz.sprite.geometry) mz.sprite.geometry.dispose(); if (mz.sprite.material) mz.sprite.material.dispose(); this.muzzleFx.splice(i, 1); }
      }
      for (let i = this.sparks.length - 1; i >= 0; i--) {
        const sp = this.sparks[i];
        sp.userData.life -= dt;
        if (sp.userData.life <= 0) { this.group.remove(sp); sp.material.dispose(); this.sparks.splice(i, 1); continue; }
        sp.userData.vel.y -= sp.userData.grav * dt;
        sp.position.addScaledVector(sp.userData.vel, dt);
        if (sp.position.y < 0.02 && sp.userData.vel.y < 0) { sp.position.y = 0.02; sp.userData.vel.y *= -0.4; sp.userData.vel.x *= 0.7; sp.userData.vel.z *= 0.7; }
        sp.material.opacity = Math.min(1, sp.userData.life * 2);
      }
      for (let i = this.casings.length - 1; i >= 0; i--) {
        const c = this.casings[i];
        c.userData.life -= dt;
        if (c.userData.life <= 0) { this.group.remove(c); c.geometry.dispose(); c.material.dispose(); this.casings.splice(i, 1); continue; }
        c.userData.vel.y -= 15 * dt;
        c.position.addScaledVector(c.userData.vel, dt);
        c.rotation.x += c.userData.rot.x * dt; c.rotation.y += c.userData.rot.y * dt; c.rotation.z += c.userData.rot.z * dt;
        if (c.position.y < 0.02 && c.userData.vel.y < 0) { c.position.y = 0.02; c.userData.vel.y *= -0.35; c.userData.vel.x *= 0.6; c.userData.vel.z *= 0.6; }
      }
      for (let i = this.decals.length - 1; i >= 0; i--) {
        const d = this.decals[i];
        d.life -= dt;
        d.mesh.material.opacity = Math.max(0, Math.min(0.85, d.life * 0.2));
        if (d.life <= 0) { this.group.remove(d.mesh); d.mesh.geometry.dispose(); d.mesh.material.dispose(); this.decals.splice(i, 1); }
      }
      for (let i = this.smokes.length - 1; i >= 0; i--) {
        const s = this.smokes[i];
        s.life += dt;
        if (s.life >= s.duration) {
          for (const p of s.parts) { this.group.remove(p); p.material.dispose(); }
          this.smokes.splice(i, 1); continue;
        }
        const grow = Math.min(1, s.life / 1.2);
        for (const p of s.parts) {
          const wob = Math.sin(t * 2 + p.userData.phase) * 0.15;
          p.position.copy(p.userData.base).add(new THREE.Vector3(wob, (s.life * 0.08), Math.cos(t * 1.7 + p.userData.phase) * 0.15));
          p.scale.setScalar(U.lerp(p.scale.x, p.userData.scaleTarget, Math.min(1, dt * 3)));
          const fade = s.life > s.duration - 2.5 ? Math.max(0, (s.duration - s.life) / 2.5) : 1;
          p.material.opacity = 0.72 * grow * fade;
        }
      }
      for (let i = this.fires.length - 1; i >= 0; i--) {
        const f = this.fires[i];
        f.life += dt;
        if (f.life >= f.duration) {
          for (const p of f.flames) { this.group.remove(p); p.material.dispose(); }
          this.group.remove(f.light);
          this.fires.splice(i, 1); continue;
        }
        const fade = f.life > f.duration - 1.5 ? Math.max(0, (f.duration - f.life) / 1.5) : 1;
        f.light.intensity = 1.6 * fade;
        for (const p of f.flames) {
          const fl = Math.sin(t * 9 + p.userData.phase) * 0.25 + 0.75;
          p.scale.setScalar(Math.max(0.1, fl) * (p.userData.base ? 1 : 1));
          p.position.copy(p.userData.base).add(new THREE.Vector3(Math.sin(t * 5 + p.userData.phase) * 0.12, Math.abs(Math.sin(t * 7 + p.userData.phase)) * 0.3, Math.cos(t * 5 + p.userData.phase) * 0.12));
          p.material.opacity = 0.95 * fade;
        }
        f.lastCrackle -= dt;
        if (f.lastCrackle <= 0) {
          window.TFPS.SFX.pos("fire_crackle", f.pos, { vol: 0.5, dur: 0.4 });
          f.lastCrackle = 0.35;
        }
      }
      for (let i = this.lights.length - 1; i >= 0; i--) {
        const l = this.lights[i];
        l.life -= dt;
        l.light.intensity = Math.max(0, l.life * 8);
        if (l.life <= 0) { this.group.remove(l.light); this.lights.splice(i, 1); }
      }
    }
  }
  window.TFPS.Effects = Effects;
})();
