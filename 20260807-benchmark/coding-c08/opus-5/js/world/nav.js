// ============================================================================
// world/nav.js — the bot navigation graph.
//
// Map files declare a handful of named nodes; the links between them are
// discovered at load time by asking the world whether a player could actually
// walk from one to the other.  That keeps the map files short and makes the
// graph impossible to author wrong (a link only exists if it is walkable).
// ============================================================================

import * as THREE from 'three';
import { AREA } from '../core/constants.js';

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item, pri) {
    this.a.push({ item, pri });
    let i = this.a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.a[p].pri <= this.a[i].pri) break;
      [this.a[p], this.a[i]] = [this.a[i], this.a[p]];
      i = p;
    }
  }
  pop() {
    const top = this.a[0];
    const last = this.a.pop();
    if (this.a.length) {
      this.a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this.a.length && this.a[l].pri < this.a[m].pri) m = l;
        if (r < this.a.length && this.a[r].pri < this.a[m].pri) m = r;
        if (m === i) break;
        [this.a[m], this.a[i]] = [this.a[i], this.a[m]];
        i = m;
      }
    }
    return top ? top.item : undefined;
  }
}

export class NavGraph {
  constructor(mapDef, world) {
    this.map = mapDef;
    this.world = world;
    this.nodes = [];
    this.byIdMap = new Map();
    this.build();
  }

  build() {
    const def = this.map.nav || { nodes: [] };
    this.nodes = def.nodes.map((n, i) => ({
      id: n.id, idx: i, pos: new THREE.Vector3(n.p[0], n.p[1], n.p[2]),
      area: n.area || AREA.CONNECT, tags: n.tags || [], r: n.r ?? 1.6,
      links: [], cost: [],
    }));
    for (const n of this.nodes) this.byIdMap.set(n.id, n);

    const maxDist = def.autoLink?.maxDist ?? 15;
    const w = this.world;
    // auto-link everything that is genuinely walkable
    for (let i = 0; i < this.nodes.length; i++) {
      const a = this.nodes[i];
      for (let j = i + 1; j < this.nodes.length; j++) {
        const b = this.nodes[j];
        const d = a.pos.distanceTo(b.pos);
        if (d > maxDist) continue;
        if (Math.abs(a.pos.y - b.pos.y) > 3.2) continue;
        // both directions must be walkable: a one-way drop is not a link
        if (!w.canWalkBetween(a.pos, b.pos)) continue;
        if (!w.canWalkBetween(b.pos, a.pos)) continue;
        this._link(a, b, d);
      }
    }
    // explicit links (stairs, drops, boosts the walk probe cannot see)
    for (const [x, y] of def.links || []) {
      const a = this.byIdMap.get(x), b = this.byIdMap.get(y);
      if (a && b) this._link(a, b, a.pos.distanceTo(b.pos) * (def.linkCost ?? 1));
    }
    for (const [x, y] of def.noLink || []) {
      const a = this.byIdMap.get(x), b = this.byIdMap.get(y);
      if (a && b) this._unlink(a, b);
    }
    this.stats = {
      nodes: this.nodes.length,
      links: this.nodes.reduce((s, n) => s + n.links.length, 0) / 2,
      isolated: this.nodes.filter((n) => !n.links.length).map((n) => n.id),
    };
  }

  _link(a, b, cost) {
    if (a.links.includes(b.idx)) return;
    a.links.push(b.idx); a.cost.push(cost);
    b.links.push(a.idx); b.cost.push(cost);
  }

  _unlink(a, b) {
    let i = a.links.indexOf(b.idx);
    if (i >= 0) { a.links.splice(i, 1); a.cost.splice(i, 1); }
    i = b.links.indexOf(a.idx);
    if (i >= 0) { b.links.splice(i, 1); b.cost.splice(i, 1); }
  }

  byId(id) { return this.byIdMap.get(id) || null; }
  nodesWithTag(tag) { return this.nodes.filter((n) => n.tags.includes(tag)); }
  nodesInArea(area) { return this.nodes.filter((n) => n.area === area); }

  /** Closest node to a position, optionally filtered, preferring visible ones. */
  nearest(pos, filter = null) {
    let best = null, bestD = Infinity;
    for (const n of this.nodes) {
      if (filter && !filter(n)) continue;
      const d = n.pos.distanceToSquared(pos);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  /** Closest node the entity can actually reach in a straight line. */
  nearestReachable(pos, filter = null) {
    const cands = [];
    for (const n of this.nodes) {
      if (filter && !filter(n)) continue;
      cands.push([n.pos.distanceToSquared(pos), n]);
    }
    cands.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < Math.min(6, cands.length); i++) {
      const n = cands[i][1];
      if (this.world.canWalkBetween(pos, n.pos)) return n;
    }
    return cands.length ? cands[0][1] : null;
  }

  /** A* over the node graph. @returns {Array} node list or null */
  pathNodes(from, to, opts = {}) {
    const a = from.isVector3 ? this.nearestReachable(from) : from;
    const b = to.isVector3 ? this.nearestReachable(to) : to;
    if (!a || !b) return null;
    if (a === b) return [a];
    const n = this.nodes.length;
    const g = new Float64Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const open = new Heap();
    g[a.idx] = 0;
    open.push(a.idx, a.pos.distanceTo(b.pos));
    const fires = opts.avoidFire === false ? null : this.world.fires;
    while (open.size) {
      const cur = open.pop();
      if (cur === b.idx) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const node = this.nodes[cur];
      for (let k = 0; k < node.links.length; k++) {
        const ni = node.links[k];
        if (closed[ni]) continue;
        const other = this.nodes[ni];
        let c = node.cost[k];
        if (fires && fires.length) {
          for (const f of fires) if (other.pos.distanceTo(f.pos) < f.radius + 1.2) { c += 60; break; }
        }
        if (opts.penalty) c += opts.penalty(other) || 0;
        const t = g[cur] + c;
        if (t < g[ni]) { g[ni] = t; came[ni] = cur; open.push(ni, t + other.pos.distanceTo(b.pos)); }
      }
    }
    if (came[b.idx] < 0 && a.idx !== b.idx) return null;
    const out = [];
    let cur = b.idx;
    let guard = 0;
    while (cur >= 0 && guard++ < 512) { out.push(this.nodes[cur]); cur = came[cur]; }
    out.reverse();
    return out[0] === a ? out : null;
  }

  /**
   * Waypoint path between two world positions, string-pulled so bots do not
   * zig-zag between node centres.
   * @returns {THREE.Vector3[]|null}
   */
  path(fromVec, toVec, opts = {}) {
    // already a clear straight shot?
    if (this.world.canWalkBetween(fromVec, toVec) && fromVec.distanceTo(toVec) < 26) {
      return [toVec.clone()];
    }
    const nodes = this.pathNodes(fromVec, toVec, opts);
    if (!nodes) return null;
    const pts = nodes.map((n) => n.pos.clone());
    pts.push(toVec.clone());
    // string pulling: drop waypoints we can skip
    const out = [];
    let cur = fromVec;
    let i = 0;
    let guard = 0;
    while (i < pts.length && guard++ < 256) {
      let far = i;
      for (let j = pts.length - 1; j > i; j--) {
        if (this.world.canWalkBetween(cur, pts[j])) { far = j; break; }
      }
      out.push(pts[far]);
      cur = pts[far];
      i = far + 1;
    }
    return out.length ? out : [toVec.clone()];
  }

  /** Total travel distance of a path (used for rotation timing decisions). */
  pathLength(from, to) {
    const nodes = this.pathNodes(from, to);
    if (!nodes) return Infinity;
    let d = from.isVector3 ? from.distanceTo(nodes[0].pos) : 0;
    for (let i = 1; i < nodes.length; i++) d += nodes[i - 1].pos.distanceTo(nodes[i].pos);
    if (to.isVector3) d += nodes[nodes.length - 1].pos.distanceTo(to);
    return d;
  }

  randomInArea(area, rng = Math.random) {
    const list = this.nodesInArea(area);
    return list.length ? list[(rng() * list.length) | 0] : null;
  }
}



