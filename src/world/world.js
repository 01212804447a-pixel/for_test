// Физический мир: статические препятствия (OBB/цилиндры), трассировка лучей,
// столкновения персонажей, точки укрытий, навигационная сетка.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { NavGrid } from './navgrid.js';
import { clamp } from '../core/math.js';

const CELL = 16;

// Box с UV, масштабированными по размеру (метры / texScale)
export function boxGeo(w, h, d, texScale = 2) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const spans = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * spans[f][0] / texScale, uv.getY(i) * spans[f][1] / texScale);
    }
  }
  return g;
}

export class World {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.obstacles = [];
    this.grid = new Map();
    this.vehicles = [];
    this.destructibles = [];
    this.cover = [];
    this.coverGrid = new Map();
    this.nav = null;
    this._stamp = 1;
    this._static = new Map(); // material -> {geos:[], cast:boolean}
    this.interactables = [];
    this.targets = []; // мишени полигона
  }

  // ---------- регистрация препятствий ----------
  _insert(o) {
    const i0 = Math.floor(o.minX / CELL), i1 = Math.floor(o.maxX / CELL);
    const j0 = Math.floor(o.minZ / CELL), j1 = Math.floor(o.maxZ / CELL);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = i * 4096 + j;
      let arr = this.grid.get(k);
      if (!arr) { arr = []; this.grid.set(k, arr); }
      arr.push(o);
    }
  }

  _common(o, opts) {
    o.mat = opts.mat || 'concrete';
    o.blocksMove = opts.blocksMove !== false;
    o.blocksBullet = opts.blocksBullet !== false;
    o.blocksSight = opts.blocksSight !== false;
    o.coverOk = opts.cover !== false && o.blocksBullet;
    o.pen = opts.pen || 0; // толщина для пробития (мм RHA-эквивалент)
    o.owner = opts.owner || null;
    o.stamp = 0;
    o.id = this.obstacles.length;
    this.obstacles.push(o);
    this._insert(o);
    return o;
  }

  addBoxCollider({ x, z, y0, w, d, h, yaw = 0, ...opts }) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const hx = w / 2, hz = d / 2;
    const ex = Math.abs(c) * hx + Math.abs(s) * hz, ez = Math.abs(s) * hx + Math.abs(c) * hz;
    const o = { kind: 0, x, z, y0, y1: y0 + h, hx, hz, cos: c, sin: s, yaw, minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez };
    return this._common(o, opts);
  }

  addCylCollider({ x, z, y0, r, h, ...opts }) {
    const o = { kind: 1, x, z, y0, y1: y0 + h, r, minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r };
    return this._common(o, opts);
  }

  // Видимая коробка + коллайдер
  addBox({ x, z, y0, w, d, h, yaw = 0, material, texScale = 2, collide = true, snowTop = false, castShadow = true, ...opts }) {
    if (material) {
      const g = boxGeo(w, h, d, texScale);
      g.rotateY(yaw);
      g.translate(x, y0 + h / 2, z);
      this._addStatic(material, g, castShadow);
      if (snowTop && h > 0.3) {
        const sg = boxGeo(w + 0.06, 0.08, d + 0.06, 2);
        sg.rotateY(yaw); sg.translate(x, y0 + h + 0.04, z);
        this._addStatic(SNOW_MAT(), sg, false);
      }
    }
    if (collide) return this.addBoxCollider({ x, z, y0, w, d, h, yaw, ...opts });
    return null;
  }

  addCyl({ x, z, y0, r, h, material, segments = 16, collide = true, castShadow = true, snowTop = false, ...opts }) {
    if (material) {
      const g = new THREE.CylinderGeometry(r, r, h, segments);
      g.translate(x, y0 + h / 2, z);
      this._addStatic(material, g, castShadow);
      if (snowTop) {
        const sg = new THREE.CylinderGeometry(r * 1.01, r * 1.01, 0.08, segments);
        sg.translate(x, y0 + h + 0.04, z);
        this._addStatic(SNOW_MAT(), sg, false);
      }
    }
    if (collide) return this.addCylCollider({ x, z, y0, r, h, ...opts });
    return null;
  }

  _addStatic(material, geo, cast) {
    let e = this._static.get(material);
    if (!e) { e = { geos: [], cast }; this._static.set(material, e); }
    if (geo.index) geo = geo.toNonIndexed();
    if (!geo.attributes.uv) {
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    }
    e.geos.push(geo);
  }

  addStaticGeometry(material, geo, cast = true) { this._addStatic(material, geo, cast); }

  finalize({ navCenter = { x: 0, z: 0 }, navSize = 600 } = {}) {
    for (const [mat, e] of this._static) {
      const withColor = !!mat.vertexColors;
      const merged = mergeGeometries(e.geos.map((g) => {
        // оставляем общий набор атрибутов
        const ng = new THREE.BufferGeometry();
        ng.setAttribute('position', g.attributes.position);
        ng.setAttribute('normal', g.attributes.normal);
        ng.setAttribute('uv', g.attributes.uv);
        if (withColor) {
          ng.setAttribute('color', g.attributes.color || new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
        }
        return ng;
      }), false);
      if (!merged) continue;
      const m = new THREE.Mesh(merged, mat);
      m.castShadow = e.cast; m.receiveShadow = true;
      this.scene.add(m);
    }
    this._static.clear();
    this.nav = new NavGrid(navCenter.x, navCenter.z, navSize, 1);
    this.nav.rasterize(this);
    this._buildCover();
  }

  // ---------- геометрические запросы ----------
  _cellsAround(x, z, r, fn) {
    const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL);
    const j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL);
    const st = ++this._stamp;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const arr = this.grid.get(i * 4096 + j);
      if (!arr) continue;
      for (const o of arr) { if (o.stamp === st) continue; o.stamp = st; fn(o); }
    }
  }

  obstaclesNear(x, z, r) {
    const res = [];
    this._cellsAround(x, z, r, (o) => res.push(o));
    return res;
  }

  pointObstacleDist(o, x, z) {
    if (o.kind === 1) return Math.hypot(x - o.x, z - o.z) - o.r;
    const dx = x - o.x, dz = z - o.z;
    const lx = o.cos * dx - o.sin * dz, lz = o.sin * dx + o.cos * dz;
    const qx = Math.abs(lx) - o.hx, qz = Math.abs(lz) - o.hz;
    const ox = Math.max(qx, 0), oz = Math.max(qz, 0);
    return Math.hypot(ox, oz) + Math.min(Math.max(qx, qz), 0);
  }

  // Отрезок против одного препятствия -> {t, nx, ny, nz} | null
  segObstacle(o, p0, p1) {
    if (o.kind === 0) {
      const dx0 = p0.x - o.x, dz0 = p0.z - o.z, dx1 = p1.x - o.x, dz1 = p1.z - o.z;
      const sx = o.cos * dx0 - o.sin * dz0, sz = o.sin * dx0 + o.cos * dz0;
      const ex = o.cos * dx1 - o.sin * dz1, ez = o.sin * dx1 + o.cos * dz1;
      const cy = (o.y0 + o.y1) / 2, hy = (o.y1 - o.y0) / 2;
      const sy = p0.y - cy, ey = p1.y - cy;
      let tmin = 0, tmax = 1, axis = -1, sign = 0;
      const S = [sx, sy, sz], D = [ex - sx, ey - sy, ez - sz], Hh = [o.hx, hy, o.hz];
      for (let a = 0; a < 3; a++) {
        if (Math.abs(D[a]) < 1e-9) {
          if (S[a] < -Hh[a] || S[a] > Hh[a]) return null;
        } else {
          let t1 = (-Hh[a] - S[a]) / D[a], t2 = (Hh[a] - S[a]) / D[a];
          let sg = -1;
          if (t1 > t2) { const t = t1; t1 = t2; t2 = t; sg = 1; }
          if (t1 > tmin) { tmin = t1; axis = a; sign = sg; }
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) return null;
        }
      }
      if (axis === -1) return { t: 0, nx: 0, ny: 1, nz: 0, inside: true };
      let lnx = 0, lny = 0, lnz = 0;
      if (axis === 0) lnx = sign; else if (axis === 1) lny = sign; else lnz = sign;
      return { t: tmin, nx: o.cos * lnx + o.sin * lnz, ny: lny, nz: -o.sin * lnx + o.cos * lnz };
    }
    // вертикальный цилиндр
    const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
    const fx = p0.x - o.x, fz = p0.z - o.z;
    const a = dx * dx + dz * dz, b = 2 * (fx * dx + fz * dz), c = fx * fx + fz * fz - o.r * o.r;
    let best = null;
    if (c <= 0 && p0.y >= o.y0 && p0.y <= o.y1) return { t: 0, nx: 0, ny: 1, nz: 0, inside: true };
    if (a > 1e-12) {
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const t = (-b - Math.sqrt(disc)) / (2 * a);
        if (t >= 0 && t <= 1) {
          const y = p0.y + dy * t;
          if (y >= o.y0 && y <= o.y1) {
            const hx = fx + dx * t, hz = fz + dz * t, l = Math.hypot(hx, hz) || 1;
            best = { t, nx: hx / l, ny: 0, nz: hz / l };
          }
        }
      }
    }
    if (Math.abs(dy) > 1e-9) {
      const t = (o.y1 - p0.y) / dy;
      if (t >= 0 && t <= 1 && (!best || t < best.t) && p0.y > o.y1) {
        const hx = fx + dx * t, hz = fz + dz * t;
        if (hx * hx + hz * hz <= o.r * o.r) best = { t, nx: 0, ny: 1, nz: 0 };
      }
    }
    return best;
  }

  // Ближайшее пересечение со статикой (+ техникой). mask: 'bullet' | 'sight' | 'move'
  raycast(p0, p1, { mask = 'bullet', vehicles = true, ignore = null, ignore2 = null, terrain = true } = {}) {
    let best = null;
    if (terrain) {
      const t = this.terrain.segment(p0, p1);
      if (t >= 0) best = { t, terrain: true, mat: 'snow' };
    }
    const dx = p1.x - p0.x, dz = p1.z - p0.z;
    const len = Math.hypot(dx, dz);
    const st = ++this._stamp;
    const steps = Math.max(1, Math.ceil(len / (CELL * 0.5)));
    const minx = Math.min(p0.x, p1.x), maxx = Math.max(p0.x, p1.x), minz = Math.min(p0.z, p1.z), maxz = Math.max(p0.z, p1.z);
    let lastKey = null;
    for (let s = 0; s <= steps; s++) {
      const tt = s / steps;
      if (best && tt > best.t + 0.6 / Math.max(len, 1) + 1 / steps) break;
      const x = p0.x + dx * tt, z = p0.z + dz * tt;
      const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
      for (let oj = -1; oj <= 1; oj++) for (let oi = -1; oi <= 1; oi++) {
        const k = (ci + oi) * 4096 + (cj + oj);
        if (k === lastKey) continue;
        const arr = this.grid.get(k);
        if (!arr) continue;
        for (const o of arr) {
          if (o.stamp === st) continue;
          o.stamp = st;
          if (o === ignore || (ignore && o.owner === ignore) || (ignore2 && (o === ignore2 || o.owner === ignore2))) continue;
          if (mask === 'bullet' && !o.blocksBullet) continue;
          if (mask === 'sight' && !o.blocksSight) continue;
          if (mask === 'move' && !o.blocksMove) continue;
          // быстрый отсев по AABB
          if (o.maxX < minx || o.minX > maxx || o.maxZ < minz || o.minZ > maxz) continue;
          const h = this.segObstacle(o, p0, p1);
          if (h && (!best || h.t < best.t)) { best = h; best.obstacle = o; best.mat = o.mat; best.terrain = false; }
        }
      }
    }
    if (vehicles) {
      for (const v of this.vehicles) {
        if (v === ignore || v === ignore2 || !v.collider || v.destroyedGhost) continue;
        const h = this.segObstacle(v.collider, p0, p1);
        if (h && (!best || h.t < best.t)) { best = h; best.vehicle = v; best.mat = 'metal'; best.terrain = false; best.obstacle = null; }
      }
    }
    if (best) {
      best.point = new THREE.Vector3(p0.x + (p1.x - p0.x) * best.t, p0.y + (p1.y - p0.y) * best.t, p0.z + (p1.z - p0.z) * best.t);
      if (best.terrain) best.normal = this.terrain.normalAt(best.point.x, best.point.z);
      else best.normal = new THREE.Vector3(best.nx, best.ny, best.nz);
    }
    return best;
  }

  los(a, b, ignoreVehicle = null, ignore2 = null) {
    return !this.raycast(a, b, { mask: 'sight', vehicles: true, ignore: ignoreVehicle, ignore2 });
  }

  // Высота опоры под точкой (рельеф или верх низкого препятствия)
  groundAt(x, z, yFeet = 1e9, step = 0.55) {
    let h = this.terrain.heightAt(x, z);
    this._cellsAround(x, z, 0.5, (o) => {
      if (!o.blocksMove) return;
      if (o.y1 <= h || o.y1 > yFeet + step) return;
      if (this.pointObstacleDist(o, x, z) <= 0.05) h = o.y1;
    });
    for (const v of this.vehicles) {
      if (!v.collider) continue;
      const o = v.collider;
      if (o.y1 > h && o.y1 <= yFeet + step && this.pointObstacleDist(o, x, z) <= 0) h = o.y1;
    }
    return h;
  }

  // Выталкивание окружности персонажа из препятствий
  collideCircle(pos, r, yFeet, height = 1.75) {
    const step = 0.5;
    const resolve = (o) => {
      if (!o.blocksMove) return;
      if (o.y1 <= yFeet + step || o.y0 >= yFeet + height) return;
      if (o.kind === 1) {
        const dx = pos.x - o.x, dz = pos.z - o.z, d = Math.hypot(dx, dz), m = o.r + r;
        if (d < m && d > 1e-6) { pos.x = o.x + (dx / d) * m; pos.z = o.z + (dz / d) * m; }
        return;
      }
      const dx = pos.x - o.x, dz = pos.z - o.z;
      const lx = o.cos * dx - o.sin * dz, lz = o.sin * dx + o.cos * dz;
      const cx = clamp(lx, -o.hx, o.hx), cz = clamp(lz, -o.hz, o.hz);
      let px = lx - cx, pz = lz - cz;
      const d = Math.hypot(px, pz);
      let nlx = lx, nlz = lz;
      if (d < 1e-6) {
        // центр внутри — выталкиваем по наименьшей оси
        const ox = o.hx - Math.abs(lx), oz = o.hz - Math.abs(lz);
        if (ox < oz) nlx = Math.sign(lx || 1) * (o.hx + r); else nlz = Math.sign(lz || 1) * (o.hz + r);
      } else if (d < r) {
        nlx = cx + (px / d) * r; nlz = cz + (pz / d) * r;
      } else return;
      pos.x = o.x + o.cos * nlx + o.sin * nlz;
      pos.z = o.z - o.sin * nlx + o.cos * nlz;
    };
    this._cellsAround(pos.x, pos.z, r + 1, resolve);
    for (const v of this.vehicles) if (v.collider && !v.ghost) resolve(v.collider);
  }

  // ---------- укрытия ----------
  _buildCover() {
    const pts = [];
    const t = this.terrain;
    for (const o of this.obstacles) {
      if (!o.coverOk || !o.blocksMove) continue;
      const ground = t.heightAt(o.x, o.z);
      const ch = o.y1 - Math.max(ground, o.y0);
      if (ch < 0.85 || o.y0 > ground + 0.4) continue;
      const add = (x, z, nx, nz, edge, tx, tz) => {
        if (this.nav && !this.nav.walkable(x, z)) return;
        if (t.hasSea && t.heightAt(x, z) < -0.3) return;
        let bad = false;
        this._cellsAround(x, z, 1, (q) => { if (q !== o && q.blocksMove && this.pointObstacleDist(q, x, z) < 0.35 && q.y1 > t.heightAt(x, z) + 0.5) bad = true; });
        if (bad) return;
        pts.push({ x, z, nx, nz, h: ch, full: ch >= 1.45, edge, tx, tz, obstacle: o, occupant: null });
      };
      const off = 0.62;
      if (o.kind === 1) {
        const n = Math.max(4, Math.min(10, Math.round(o.r * 3)));
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const nx = Math.cos(a), nz = Math.sin(a);
          add(o.x + nx * (o.r + off), o.z + nz * (o.r + off), nx, nz, true, -nz, nx);
        }
        continue;
      }
      // четыре стороны коробки
      const sides = [
        { lnx: 1, lnz: 0, len: o.hz * 2, ox: o.hx, oz: 0, ax: 0, az: 1 },
        { lnx: -1, lnz: 0, len: o.hz * 2, ox: -o.hx, oz: 0, ax: 0, az: 1 },
        { lnx: 0, lnz: 1, len: o.hx * 2, ox: 0, oz: o.hz, ax: 1, az: 0 },
        { lnx: 0, lnz: -1, len: o.hx * 2, ox: 0, oz: -o.hz, ax: 1, az: 0 },
      ];
      for (const s of sides) {
        if (s.len < 0.7) continue;
        const n = Math.max(1, Math.floor(s.len / 1.7));
        for (let i = 0; i < n; i++) {
          const f = n === 1 ? 0 : (i / (n - 1) - 0.5) * (s.len - 0.8);
          const lx = s.ox + s.lnx * off + s.ax * f, lz = s.oz + s.lnz * off + s.az * f;
          const wx = o.x + o.cos * lx + o.sin * lz, wz = o.z - o.sin * lx + o.cos * lz;
          const nx = o.cos * s.lnx + o.sin * s.lnz, nz = -o.sin * s.lnx + o.cos * s.lnz;
          const tx = o.cos * s.ax + o.sin * s.az, tz = -o.sin * s.ax + o.cos * s.az;
          const edge = n === 1 || i === 0 || i === n - 1;
          add(wx, wz, nx, nz, edge, tx * (i === 0 ? -1 : 1), tz * (i === 0 ? -1 : 1));
        }
      }
    }
    this.cover = pts;
    for (const p of pts) {
      const k = Math.floor(p.x / 12) * 4096 + Math.floor(p.z / 12);
      let a = this.coverGrid.get(k);
      if (!a) { a = []; this.coverGrid.set(k, a); }
      a.push(p);
    }
  }

  coverNear(x, z, r) {
    const res = [];
    const i0 = Math.floor((x - r) / 12), i1 = Math.floor((x + r) / 12);
    const j0 = Math.floor((z - r) / 12), j1 = Math.floor((z + r) / 12);
    const r2 = r * r;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const a = this.coverGrid.get(i * 4096 + j);
      if (!a) continue;
      for (const p of a) if ((p.x - x) ** 2 + (p.z - z) ** 2 <= r2) res.push(p);
    }
    return res;
  }
}

let _snowMat = null;
export function SNOW_MAT() {
  if (!_snowMat) _snowMat = new THREE.MeshStandardMaterial({ color: 0xf2f5fa, roughness: 0.9 });
  return _snowMat;
}
