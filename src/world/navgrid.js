// Навигационная сетка и поиск пути A*
export class NavGrid {
  constructor(cx, cz, size, cell = 1) {
    this.cx = cx; this.cz = cz; this.size = size; this.cell = cell;
    this.n = Math.ceil(size / cell);
    this.x0 = cx - size / 2; this.z0 = cz - size / 2;
    const N = this.n * this.n;
    this.blocked = new Uint8Array(N);
    this.cost = new Uint8Array(N); // доп. стоимость (рядом с препятствиями)
    this.g = new Float32Array(N);
    this.from = new Int32Array(N);
    this.stamp = new Uint32Array(N);
    this.closed = new Uint32Array(N);
    this.curStamp = 1;
    this.heap = new Int32Array(N);
    this.f = new Float32Array(N);
  }

  idx(x, z) {
    const ix = Math.floor((x - this.x0) / this.cell), iz = Math.floor((z - this.z0) / this.cell);
    if (ix < 0 || iz < 0 || ix >= this.n || iz >= this.n) return -1;
    return iz * this.n + ix;
  }
  center(i, out) {
    const ix = i % this.n, iz = (i / this.n) | 0;
    out.x = this.x0 + (ix + 0.5) * this.cell; out.z = this.z0 + (iz + 0.5) * this.cell;
    return out;
  }
  walkable(x, z) {
    const i = this.idx(x, z);
    return i < 0 ? true : !this.blocked[i];
  }

  rasterize(world) {
    const n = this.n, c = this.cell;
    const inflate = 0.42;
    for (const o of world.obstacles) {
      if (!o.blocksMove) continue;
      if (o.y1 - world.terrain.heightAt(o.x, o.z) < 0.5) continue; // можно перешагнуть
      const ext = (o.kind === 1 ? o.r : Math.hypot(o.hx, o.hz)) + inflate + 1;
      const i0 = Math.max(0, Math.floor((o.x - ext - this.x0) / c)), i1 = Math.min(n - 1, Math.floor((o.x + ext - this.x0) / c));
      const j0 = Math.max(0, Math.floor((o.z - ext - this.z0) / c)), j1 = Math.min(n - 1, Math.floor((o.z + ext - this.z0) / c));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = this.x0 + (i + 0.5) * c, z = this.z0 + (j + 0.5) * c;
          const d = world.pointObstacleDist(o, x, z);
          const k = j * n + i;
          if (d < inflate) this.blocked[k] = 1;
          else if (d < inflate + 0.8) this.cost[k] = Math.max(this.cost[k], 2);
        }
      }
    }
    // склоны и вода
    const t = world.terrain;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = this.x0 + (i + 0.5) * c, z = this.z0 + (j + 0.5) * c;
        const h = t.heightAt(x, z);
        if (t.hasSea && h < -0.6) { this.blocked[j * n + i] = 1; continue; }
        const s = Math.abs(t.heightAt(x + 0.6, z) - t.heightAt(x - 0.6, z)) + Math.abs(t.heightAt(x, z + 0.6) - t.heightAt(x, z - 0.6));
        if (s > 1.9) this.blocked[j * n + i] = 1;
      }
    }
  }

  // Прямая проходимость по сетке
  lineClear(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const steps = Math.ceil(len / (this.cell * 0.5));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const i = this.idx(ax + dx * t, az + dz * t);
      if (i >= 0 && this.blocked[i]) return false;
    }
    return true;
  }

  nearestFree(x, z, maxR = 6) {
    const i = this.idx(x, z);
    if (i < 0 || !this.blocked[i]) return { x, z };
    const out = { x: 0, z: 0 };
    for (let r = 1; r <= maxR / this.cell; r++) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const xx = x + Math.cos(ang) * r * this.cell, zz = z + Math.sin(ang) * r * this.cell;
        const k = this.idx(xx, zz);
        if (k >= 0 && !this.blocked[k]) { this.center(k, out); return { x: out.x, z: out.z }; }
      }
    }
    return { x, z };
  }

  findPath(ax, az, bx, bz, maxNodes = 25000) {
    if (this.lineClear(ax, az, bx, bz)) return [{ x: bx, z: bz }];
    let s = this.idx(ax, az), e = this.idx(bx, bz);
    if (s < 0 || e < 0) return [{ x: bx, z: bz }];
    if (this.blocked[e]) { const f = this.nearestFree(bx, bz); e = this.idx(f.x, f.z); bx = f.x; bz = f.z; if (e < 0) return null; }
    if (this.blocked[s]) { const f = this.nearestFree(ax, az); s = this.idx(f.x, f.z); if (s < 0) return null; }
    const n = this.n;
    const stamp = ++this.curStamp;
    const ex = e % n, ez = (e / n) | 0;
    const heap = this.heap; let hs = 0;
    const g = this.g, f = this.f, from = this.from, st = this.stamp, cl = this.closed;
    const H = (i) => { const dx = Math.abs((i % n) - ex), dz = Math.abs(((i / n) | 0) - ez); return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz); };
    const push = (i) => {
      let k = hs++; heap[k] = i;
      while (k > 0) { const p = (k - 1) >> 1; if (f[heap[p]] <= f[heap[k]]) break; const t = heap[p]; heap[p] = heap[k]; heap[k] = t; k = p; }
    };
    const pop = () => {
      const top = heap[0]; heap[0] = heap[--hs];
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1; let m = k;
        if (l < hs && f[heap[l]] < f[heap[m]]) m = l;
        if (r < hs && f[heap[r]] < f[heap[m]]) m = r;
        if (m === k) break;
        const t = heap[m]; heap[m] = heap[k]; heap[k] = t; k = m;
      }
      return top;
    };
    g[s] = 0; f[s] = H(s); st[s] = stamp; from[s] = -1; push(s);
    let expanded = 0, found = false;
    const DX = [1, -1, 0, 0, 1, 1, -1, -1], DZ = [0, 0, 1, -1, 1, -1, 1, -1], DC = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
    while (hs > 0) {
      const cur = pop();
      if (cl[cur] === stamp) continue;
      cl[cur] = stamp;
      if (cur === e) { found = true; break; }
      if (++expanded > maxNodes) break;
      const cx = cur % n, cz = (cur / n) | 0;
      for (let d = 0; d < 8; d++) {
        const nx = cx + DX[d], nz = cz + DZ[d];
        if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
        const ni = nz * n + nx;
        if (this.blocked[ni] || cl[ni] === stamp) continue;
        if (d >= 4 && (this.blocked[cz * n + nx] || this.blocked[nz * n + cx])) continue; // не срезаем углы
        const ng = g[cur] + DC[d] * (1 + this.cost[ni] * 0.5);
        if (st[ni] !== stamp || ng < g[ni]) {
          st[ni] = stamp; g[ni] = ng; from[ni] = cur; f[ni] = ng + H(ni); push(ni);
        }
      }
    }
    if (!found) return null;
    // восстановление и сглаживание
    const raw = [];
    for (let i = e; i !== -1; i = from[i]) raw.push(i);
    raw.reverse();
    const pts = raw.map((i) => this.center(i, { x: 0, z: 0 }));
    pts[pts.length - 1] = { x: bx, z: bz };
    const out = [];
    let ax2 = ax, az2 = az, k = 0;
    while (k < pts.length - 1) {
      let far = k + 1;
      for (let j = Math.min(pts.length - 1, k + 48); j > k + 1; j--) {
        if (this.lineClear(ax2, az2, pts[j].x, pts[j].z)) { far = j; break; }
      }
      out.push(pts[far]); ax2 = pts[far].x; az2 = pts[far].z; k = far;
    }
    if (!out.length) out.push({ x: bx, z: bz });
    return out;
  }
}
