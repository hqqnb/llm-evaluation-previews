// nav.js — waypoint navigation graph + A* pathfinding
import { dist } from './math.js';

export class NavGraph {
  constructor(nodes, edges, world) {
    this.nodes = nodes.map((n, i) => ({ id: i, x: n.x, z: n.z, tags: n.tags || [], nbr: [] }));
    this.world = world;
    for (const [a, b] of edges) {
      if (!this.nodes[a] || !this.nodes[b]) continue;
      const w = dist(this.nodes[a].x, this.nodes[a].z, this.nodes[b].x, this.nodes[b].z);
      this.nodes[a].nbr.push({ id: b, w });
      this.nodes[b].nbr.push({ id: a, w });
    }
  }
  nearest(x, z, needLOS = true) {
    let best = -1, bd = Infinity;
    for (const n of this.nodes) {
      const d = dist(x, z, n.x, n.z);
      if (d < bd) {
        if (needLOS && this.world && this.world.segmentBlocked(x, z, n.x, n.z) && d > 3) continue;
        bd = d; best = n.id;
      }
    }
    if (best < 0) { // fallback ignore LOS
      for (const n of this.nodes) { const d = dist(x, z, n.x, n.z); if (d < bd) { bd = d; best = n.id; } }
    }
    return best;
  }
  nodesByTag(tag) { return this.nodes.filter(n => n.tags.includes(tag)); }
  randomByTag(tag) { const a = this.nodesByTag(tag); return a.length ? a[Math.floor(Math.random() * a.length)] : null; }

  // A* returns array of {x,z} waypoints from start node to goal node
  path(startId, goalId) {
    if (startId < 0 || goalId < 0) return [];
    if (startId === goalId) return [{ x: this.nodes[goalId].x, z: this.nodes[goalId].z }];
    const open = new Set([startId]);
    const came = {}, g = {}, f = {};
    for (const n of this.nodes) { g[n.id] = Infinity; f[n.id] = Infinity; }
    g[startId] = 0; f[startId] = this._h(startId, goalId);
    while (open.size) {
      let cur = -1, cf = Infinity;
      for (const id of open) if (f[id] < cf) { cf = f[id]; cur = id; }
      if (cur === goalId) return this._recon(came, cur);
      open.delete(cur);
      for (const e of this.nodes[cur].nbr) {
        const tg = g[cur] + e.w;
        if (tg < g[e.id]) { came[e.id] = cur; g[e.id] = tg; f[e.id] = tg + this._h(e.id, goalId); open.add(e.id); }
      }
    }
    return [];
  }
  _h(a, b) { return dist(this.nodes[a].x, this.nodes[a].z, this.nodes[b].x, this.nodes[b].z); }
  _recon(came, cur) {
    const out = [{ x: this.nodes[cur].x, z: this.nodes[cur].z }];
    while (came[cur] !== undefined) { cur = came[cur]; out.unshift({ x: this.nodes[cur].x, z: this.nodes[cur].z }); }
    return out;
  }
  // pathfind between two world points
  findPath(sx, sz, gx, gz) {
    const s = this.nearest(sx, sz), gl = this.nearest(gx, gz);
    const p = this.path(s, gl);
    if (p.length) p.push({ x: gx, z: gz });
    return p;
  }
}
