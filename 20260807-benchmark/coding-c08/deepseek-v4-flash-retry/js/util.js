/* global THREE */
(function () {
  const U = {
    clamp(v, a, b) { return v < a ? a : (v > b ? b : v); },
    lerp(a, b, t) { return a + (b - a) * t; },
    damp(cur, target, lambda, dt) { return U.lerp(cur, target, 1 - Math.exp(-lambda * dt)); },
    rand(a, b) { return a + Math.random() * (b - a); },
    randInt(a, b) { return Math.floor(U.rand(a, b + 1)); },
    pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; },
    dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; },
    dist(ax, az, bx, bz) { return Math.sqrt(U.dist2(ax, az, bx, bz)); },
    angleLerp(a, b, t) {
      let d = b - a;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return a + d * t;
    },
    angleDiff(a, b) {
      let d = b - a;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return d;
    },
    fmtTime(sec) {
      const s = Math.max(0, Math.ceil(sec));
      return String(Math.floor(s / 60)) + ":" + String(s % 60).padStart(2, "0");
    },
    money(n) { return "$" + Math.max(0, Math.round(n)); },
    aabbOverlap(a, b) {
      return a.min.x < b.max.x && a.max.x > b.min.x &&
        a.min.y < b.max.y && a.max.y > b.min.y &&
        a.min.z < b.max.z && a.max.z > b.min.z;
    },
    // Move AABB entity with axis-separated collision + step up. Returns {grounded, hitX, hitZ}
    moveCollide(pos, half, vel, dt, colliders, stepUp) {
      const res = { grounded: false, hitX: false, hitZ: false };
      let stepH = stepUp || 0.32;
      let p = { x: pos.x, y: pos.y, z: pos.z };
      const tryMove = (px, py, pz, sizeY) => {
        const min = { x: px - half.x, y: py, z: pz - half.z };
        const max = { x: px + half.x, y: py + sizeY, z: pz + half.z };
        for (const c of colliders) {
          if (c.active === false) continue;
          if (min.x < c.max.x && max.x > c.min.x && min.y < c.max.y && max.y > c.min.y && min.z < c.max.z && max.z > c.min.z) return false;
        }
        return true;
      };
      // X
      let nx = p.x + vel.x * dt;
      if (!tryMove(nx, p.y, p.z, 1)) {
        const stepY = p.y + stepH;
        if (vel.x !== 0 && tryMove(nx, stepY, p.z, 1)) { p.y = stepY; p.x = nx; }
        else { p.x = p.x; res.hitX = true; }
      } else p.x = nx;
      // Z
      let nz = p.z + vel.z * dt;
      if (!tryMove(p.x, p.y, nz, 1)) {
        const stepY = p.y + stepH;
        if (vel.z !== 0 && tryMove(p.x, stepY, nz, 1)) { p.y = stepY; p.z = nz; }
        else res.hitZ = true;
      } else p.z = nz;
      // Y
      let ny = p.y + vel.y * dt;
      if (ny <= 0) { ny = 0; if (vel.y <= 0) res.grounded = true; }
      if (!tryMove(p.x, ny, p.z, 1)) {
        if (vel.y <= 0) res.grounded = true;
        vel.y = 0;
      } else p.y = ny;
      pos.x = p.x; pos.y = p.y; pos.z = p.z;
      return res;
    },
    pointInAABB(pt, box) {
      return pt.x >= box.min.x && pt.x <= box.max.x && pt.y >= box.min.y && pt.y <= box.max.y && pt.z >= box.min.z && pt.z <= box.max.z;
    },
    segClosestPoint(p, a, b) {
      const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
      const t = ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / (abx * abx + aby * aby + abz * abz || 1);
      const tt = U.clamp(t, 0, 1);
      return { x: a.x + abx * tt, y: a.y + aby * tt, z: a.z + abz * tt };
    },
    spawnRing(count, fn) { const a = []; for (let i = 0; i < count; i++) a.push(fn(i / count * Math.PI * 2)); return a; },
    addEvent(el, type, fn) { el.addEventListener(type, fn); },
    el(id) { return document.getElementById(id); }
  };
  window.TFPS = window.TFPS || {};
  window.TFPS.U = U;
  window.TFPS.V3 = (x, y, z) => new THREE.Vector3(x, y, z);
})();
