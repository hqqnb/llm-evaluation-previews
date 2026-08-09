(function () {
  class NavGraph {
    constructor() {
      this.nodes = [];
      this.byId = new Map();
      this.edges = [];
      this.adj = new Map();
    }
    add(id, x, z, y, flags) {
      const n = { id, x, z, y: y || 0, flags: flags || {} };
      this.nodes.push(n);
      this.byId.set(id, n);
      this.adj.set(id, []);
      return n;
    }
    link(a, b, oneWay) {
      const na = this.byId.get(a), nb = this.byId.get(b);
      if (!na || !nb) { console.warn("nav link missing", a, b); return; }
      this.edges.push([a, b]);
      this.adj.get(a).push({ to: b, cost: Math.hypot(na.x - nb.x, na.z - nb.z) + Math.abs(na.y - nb.y) * 0.8 });
      if (!oneWay) this.adj.get(b).push({ to: a, cost: Math.hypot(na.x - nb.x, na.z - nb.z) + Math.abs(na.y - nb.y) * 0.8 });
    }
    nearest(x, z, filter) {
      let best = null, bd = 1e9;
      for (const n of this.nodes) {
        if (filter && !filter(n)) continue;
        const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
        if (d < bd) { bd = d; best = n; }
      }
      return best;
    }
    path(aId, bId) {
      if (aId === bId) return [aId];
      if (!this.byId.has(aId) || !this.byId.has(bId)) return null;
      const open = new Set([aId]);
      const came = new Map();
      const g = new Map([[aId, 0]]);
      const f = new Map([[aId, 0]]);
      const close = new Set();
      const target = this.byId.get(bId);
      while (open.size) {
        let cur = null, cf = 1e9;
        for (const id of open) { const v = f.get(id); if (v < cf) { cf = v; cur = id; } }
        if (cur === bId) {
          const path = [bId];
          while (path[path.length - 1] !== aId) path.push(came.get(path[path.length - 1]));
          return path.reverse();
        }
        open.delete(cur); close.add(cur);
        for (const e of this.adj.get(cur) || []) {
          if (close.has(e.to)) continue;
          const ng = g.get(cur) + e.cost;
          if (ng < (g.get(e.to) ?? 1e9)) {
            g.set(e.to, ng);
            const n = this.byId.get(e.to);
            if (!n) continue;
            f.set(e.to, ng + Math.hypot(n.x - target.x, n.z - target.z) + Math.abs(n.y - target.y));
            came.set(e.to, cur);
            open.add(e.to);
          }
        }
      }
      return null;
    }
    // Path from arbitrary position to target id, nearest node first
    pathFrom(x, z, bId) {
      const a = this.nearest(x, z);
      return a ? this.path(a.id, bId) : null;
    }
  }
  window.TFPS.NavGraph = NavGraph;
})();
