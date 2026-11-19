// Разрушаемость: стены зданий собраны из «плиток» (у каждой — прочность), окна — из стёкол,
// заборы — из пролётов. Пули выбивают плитки постепенно, взрывы — сразу, по радиусу, который
// зависит от материала (дерево ломается легко, кирпич — хуже, бетон — с трудом). Пробоины —
// настоящие: через них летят пули, видно и можно пролезть. Если выбита большая часть стен —
// крыша проваливается. Стёкла бьются от попаданий и ударной волны, пролёты заборов падают от
// взрыва и наезда техники. Обломки (доски, кирпичи, осколки стекла) разлетаются и лежат.
//
// Геометрия каждого здания — один меш на материал; плитка «удаляется» схлопыванием её вершин,
// без перестройки буфера. Препятствие стены остаётся одно на участок, но знает, какие плитки
// выбиты: луч и движение проходят сквозь пробоины.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/math.js';
import { frostGlass } from './shaders.js';

// hp — прочность плитки; tile — её размер, м; blast — радиус пролома от взрыва (доля радиуса
// фугасного действия); blastK — какая доля фугасного удара достаётся плитке; debris — цвет обломков
export const WALL_MATS = {
  wood: { hp: 40, tile: 0.55, blast: 0.28, blastK: 1.0, debris: 0x6a4a2c, fx: 'wood', piece: [0.45, 0.05, 0.12] },
  log: { hp: 110, tile: 0.6, blast: 0.24, blastK: 0.75, debris: 0x5c3f24, fx: 'wood', piece: [0.5, 0.18, 0.18] },
  brick: { hp: 160, tile: 0.5, blast: 0.2, blastK: 0.55, debris: 0x8e4a36, fx: 'concrete', piece: [0.24, 0.07, 0.12] },
  concrete: { hp: 260, tile: 0.6, blast: 0.15, blastK: 0.48, debris: 0x8c8c88, fx: 'concrete', piece: [0.3, 0.2, 0.25] },
};
const GLASS_COL = 0xb8d4e0;

// ---------------------------------------------------------------- обломки
class Debris {
  constructor(scene, max = 600) {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const m = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05 });
    this.mesh = new THREE.InstancedMesh(g, m, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.castShadow = true;
    scene.add(this.mesh);
    this.max = max; this.items = []; this.next = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._c = new THREE.Color();
  }
  spawn(p, v, size, color, life = 9) {
    const it = { p: p.clone(), v: v.clone(), w: new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6)), s: new THREE.Vector3(...size), life, life0: life, rest: false, idx: 0 };
    if (this.items.length < this.max) { it.idx = this.items.length; this.items.push(it); }
    else { it.idx = this.next; this.items[this.next] = it; this.next = (this.next + 1) % this.max; }
    this.mesh.setColorAt(it.idx, this._c.set(color).multiplyScalar(0.8 + Math.random() * 0.4));
    this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt, terrain) {
    const n = this.items.length;
    if (!n) return;
    for (const it of this.items) {
      if (it.life <= 0) { this.mesh.setMatrixAt(it.idx, this._m.makeScale(0, 0, 0)); continue; }
      it.life -= dt;
      if (!it.rest) {
        it.v.y -= 9.8 * dt;
        it.p.addScaledVector(it.v, dt);
        this._e.set(it.w.x * dt, it.w.y * dt, it.w.z * dt); this._q.setFromEuler(this._e); it.q.premultiply(this._q);
        const gy = terrain.heightAt(it.p.x, it.p.z) + it.s.y * 0.5;
        if (it.p.y < gy) {
          it.p.y = gy;
          it.v.y = Math.abs(it.v.y) * 0.25; it.v.x *= 0.5; it.v.z *= 0.5; it.w.multiplyScalar(0.5);
          if (it.v.lengthSq() < 0.15) it.rest = true;
        }
      }
      const k = it.life < 1 ? Math.max(0, it.life) : 1;
      this._m.compose(it.p, it.q, _s3.copy(it.s).multiplyScalar(k));
      this.mesh.setMatrixAt(it.idx, this._m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
const _s3 = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3();

// ---------------------------------------------------------------- разрушаемость
export class Destruction {
  constructor(world) {
    this.world = world; this.scene = world.scene;
    this.debris = new Debris(world.scene);
    this.blds = []; this.walls = []; this.panes = []; this.fences = [];
    this.cur = null; this.game = null;
    this.glassMat = frostGlass(new THREE.MeshStandardMaterial({ color: 0x9fb8c8, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.6 }));
  }

  // ---------- сборка здания ----------
  beginBuilding() { this.cur = { groups: new Map(), walls: [], panes: [], roof: [], roofCols: [], total: 0, dead: 0, collapsed: false, box: new THREE.Box3() }; return this.cur; }

  _push(B, material, geo) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    let gr = B.groups.get(material);
    if (!gr) { gr = { geos: [], count: 0, mesh: null, material }; B.groups.set(material, gr); }
    const r = { gr, start: gr.count, count: g.attributes.position.count };
    gr.geos.push(g); gr.count += r.count;
    g.computeBoundingBox(); B.box.union(g.boundingBox);
    return r;
  }

  // Участок стены [yb, yt] над y0, по оси стены — от a до b (центр — cx, cz), толщина th.
  // u0 — координата начала участка вдоль всей стены (для непрерывной текстуры)
  addWall({ cx, cz, yaw, y0, len, yb, yt, th, material, mat, pen, u0 = 0, texScale = 2 }) {
    const B = this.cur, M = WALL_MATS[mat] || WALL_MATS.wood;
    const h = yt - yb;
    const o = this.world.addBoxCollider({ x: cx, z: cz, y0: y0 + yb, w: len, d: th, h, yaw, mat, pen, cover: true });
    const cols = Math.max(1, Math.round(len / M.tile)), rows = Math.max(1, Math.round(h / M.tile));
    const tw = len / cols, thh = h / rows;
    const w = { o, B, mat, M, cols, rows, tw, thh, len, th, yaw, cx, cz, ybase: y0 + yb, alive: new Uint8Array(cols * rows).fill(1), hp: new Float32Array(cols * rows).fill(M.hp), ranges: [], dead: 0 };
    o.dw = w;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const lx = -len / 2 + (i + 0.5) * tw, ly = (j + 0.5) * thh;
      const g = new THREE.BoxGeometry(tw, thh, th);
      // текстура непрерывна по всей стене: координаты в системе стены
      const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
      for (let k = 0; k < P.count; k++) {
        const X = u0 + len / 2 + lx + P.getX(k), Y = yb + ly + P.getY(k), Zc = P.getZ(k);
        const nx = Math.abs(N.getX(k)), ny = Math.abs(N.getY(k));
        if (nx > 0.5) U.setXY(k, Zc / texScale, Y / texScale);
        else if (ny > 0.5) U.setXY(k, X / texScale, Zc / texScale);
        else U.setXY(k, X / texScale, Y / texScale);
      }
      g.translate(lx, yb + ly, 0); g.rotateY(yaw); g.translate(cx, y0, cz);
      w.ranges.push(this._push(B, material, g));
    }
    B.walls.push(w); B.total += cols * rows;
    this.walls.push(w);
    return w;
  }

  // Стекло в оконном проёме
  addPane({ cx, cz, yaw, y0, w, h }) {
    const B = this.cur;
    const g = new THREE.BoxGeometry(w, h, 0.012);
    g.translate(0, h / 2, 0); g.rotateY(yaw); g.translate(cx, y0, cz);
    const pane = { kind: 'glass', broken: false, B, pos: new THREE.Vector3(cx, y0 + h / 2, cz), w, h, yaw };
    pane.range = this._push(B, this.glassMat, g);
    pane.o = this.world.addBoxCollider({ x: cx, z: cz, y0, w, d: 0.05, h, yaw, mat: 'glass', pen: 0.4, blocksSight: false, blocksMove: true, cover: false, owner: pane });
    B.panes.push(pane); this.panes.push(pane);
    return pane;
  }

  // Крыша (геометрия и препятствие) — проваливается при обрушении
  addRoof(material, geo, collider = null) {
    const B = this.cur;
    B.roof.push(this._push(B, material, geo));
    if (collider) B.roofCols.push(collider);
  }

  endBuilding() {
    const B = this.cur;
    if (!B) return null;
    for (const gr of B.groups.values()) {
      const merged = mergeGeometries(gr.geos, false);
      if (!merged) continue;
      merged.attributes.position.setUsage(THREE.DynamicDrawUsage);
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, gr.material);
      mesh.castShadow = gr.material !== this.glassMat; mesh.receiveShadow = true;
      this.scene.add(mesh);
      gr.mesh = mesh; gr.geos = null;
      this.world.staticTiles.push({ mesh, c: merged.boundingSphere.center, r: merged.boundingSphere.radius });
    }
    B.center = B.box.getCenter(new THREE.Vector3());
    this.blds.push(B);
    this.cur = null;
    return B;
  }

  _hide(r) {
    const a = r.gr.mesh ? r.gr.mesh.geometry.attributes.position : null;
    if (!a) return;
    const x = a.getX(r.start), y = a.getY(r.start), z = a.getZ(r.start);
    for (let k = r.start; k < r.start + r.count; k++) a.setXYZ(k, x, y, z);
    a.addUpdateRange(r.start * 3, r.count * 3);
    a.needsUpdate = true;
  }

  // ---------- плитки ----------
  _tileAt(w, p) {
    const dx = p.x - w.cx, dz = p.z - w.cz;
    const lx = w.o.cos * dx - w.o.sin * dz;
    const i = Math.min(w.cols - 1, Math.max(0, Math.floor((lx + w.len / 2) / w.tw)));
    const j = Math.min(w.rows - 1, Math.max(0, Math.floor((p.y - w.ybase) / w.thh)));
    return j * w.cols + i;
  }
  _tileCenter(w, idx, out = new THREE.Vector3()) {
    const i = idx % w.cols, j = (idx / w.cols) | 0;
    const lx = -w.len / 2 + (i + 0.5) * w.tw;
    return out.set(w.cx + Math.cos(w.yaw) * lx, w.ybase + (j + 0.5) * w.thh, w.cz - Math.sin(w.yaw) * lx);
  }
  // точка внутри стены — цела ли там плитка (для лучей)
  solidAt(o, p) { const w = o.dw; return !!w.alive[this._tileAt(w, p)]; }
  // проход сквозь пролом: две соседние колонки выбиты на высоте от колена до головы
  passable(o, x, z, yFeet) {
    const w = o.dw;
    if (!w.dead) return false;
    const dx = x - w.cx, dz = z - w.cz;
    const lx = w.o.cos * dx - w.o.sin * dz;
    const i = Math.floor((lx + w.len / 2) / w.tw);
    const colFree = (ci) => {
      if (ci < 0 || ci >= w.cols) return false;
      for (let j = 0; j < w.rows; j++) {
        const y = w.ybase + (j + 0.5) * w.thh;
        if (y < yFeet + 0.35 || y > yFeet + 1.65) continue;
        if (w.alive[j * w.cols + ci]) return false;
      }
      return true;
    };
    return colFree(i) && (colFree(i - 1) || colFree(i + 1));
  }

  destroyTile(w, idx, dir = null, power = 3, silent = false) {
    if (!w.alive[idx]) return;
    w.alive[idx] = 0; w.hp[idx] = 0; w.dead++; w.B.dead++;
    this._hide(w.ranges[idx]);
    if (silent) return;
    const c = this._tileCenter(w, idx);
    const M = w.M, n = 2 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      const v = _v.set((Math.random() - 0.5) * 3, Math.random() * 3, (Math.random() - 0.5) * 3);
      if (dir) v.addScaledVector(dir, power * (0.5 + Math.random()));
      const sc = 0.7 + Math.random() * 0.6;
      this.debris.spawn(c, v, [M.piece[0] * sc, M.piece[1] * sc, M.piece[2] * sc], M.debris, 10 + Math.random() * 10);
    }
    const G = this.game;
    if (G) {
      const col = M.fx === 'wood' ? [0.55, 0.45, 0.35] : [0.7, 0.66, 0.62];
      for (let k = 0; k < 4; k++) G.fx.smoke.emit(c.x, c.y, c.z, (Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2, 1.5 + Math.random() * 2, 0.4, 1.8, col[0], col[1], col[2], 0.55, 0, 1.2, 0.3);
    }
    if (!w.B.collapsed && w.B.total > 20 && w.B.dead / w.B.total > 0.42) this.collapse(w.B);
  }

  // попадание пули: щепа/кирпичная крошка, плитка слабеет; энергия — Дж
  bulletHit(o, pt, dir, E) {
    const w = o.dw, idx = this._tileAt(w, pt);
    if (!w.alive[idx]) return;
    w.hp[idx] -= E / 400;
    if (w.hp[idx] <= 0) this.destroyTile(w, idx, dir, 2);
    else if (Math.random() < 0.25) {
      const M = w.M;
      this.debris.spawn(pt, _v.set(-dir.x * 2 + (Math.random() - 0.5) * 2, 1 + Math.random() * 2, -dir.z * 2 + (Math.random() - 0.5) * 2), [M.piece[0] * 0.3, M.piece[1] * 0.5, M.piece[2] * 0.3], M.debris, 5);
    }
  }

  shatter(pane, dir = null) {
    if (pane.broken) return;
    pane.broken = true;
    this._hide(pane.range);
    this.world.removeObstacle(pane.o);
    const n = 10;
    for (let k = 0; k < n; k++) {
      const p = pane.pos.clone().add(_w.set((Math.random() - 0.5) * pane.w * Math.cos(pane.yaw), (Math.random() - 0.5) * pane.h, -(Math.random() - 0.5) * pane.w * Math.sin(pane.yaw)));
      const v = _v.set((Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2);
      if (dir) v.addScaledVector(dir, 2 + Math.random() * 3);
      const s = 0.04 + Math.random() * 0.08;
      this.debris.spawn(p, v, [s, 0.006, s * (0.6 + Math.random() * 0.8)], GLASS_COL, 6 + Math.random() * 6);
    }
    const G = this.game;
    if (G && G.camPos && pane.pos.distanceTo(G.camPos) < 120) G.audio.impact(pane.pos, 'glass');
  }

  // Ударная волна и осколки: проломы по радиусу материала, стёкла, заборы.
  // direct — стена, в которую попал снаряд (кумулятивная граната прожигает дыру)
  blast(pos, ex, direct = null, owner = null) {
    const W = this.world;
    const R = Math.max(ex.radius * 0.9, 1) + 1;
    const seen = new Set();
    W._cellsAround(pos.x, pos.z, R, (o) => { if (o.dw && !o.removed) seen.add(o.dw); });
    for (const w of seen) {
      const M = w.M, rb = Math.max(0.4, ex.radius * M.blast);
      for (let idx = 0; idx < w.alive.length; idx++) {
        if (!w.alive[idx]) continue;
        const c = this._tileCenter(w, idx, _w);
        const d = c.distanceTo(pos);
        let dmg = 0;
        if (d < rb) dmg = ex.dmg * M.blastK * Math.pow(1 - d / rb, 1.2) * 1.2;
        if (direct === w && ex.pen > 100 && d < 0.5) dmg = 1e9; // кумулятивная струя
        if (dmg <= 0) continue;
        w.hp[idx] -= dmg;
        if (w.hp[idx] <= 0) this.destroyTile(w, idx, c.clone().sub(pos).normalize(), 6 * Math.max(0.2, 1 - d / rb));
      }
    }
    // стёкла — ударной волной на 3–4 радиуса
    const rg = ex.radius * 3.5;
    for (const p of this.panes) if (!p.broken && p.pos.distanceTo(pos) < rg) this.shatter(p, p.pos.clone().sub(pos).normalize());
    // заборы
    const rf = ex.radius * 1.3;
    for (const f of this.fences) for (const sec of f.secs) if (!sec.broken && sec.c.distanceTo(pos) < rf) this.breakFence(sec, sec.c.clone().sub(pos).setY(0).normalize());
  }

  // Обрушение: крыша проваливается внутрь, верх стен осыпается, пыль
  collapse(B) {
    if (B.collapsed) return;
    B.collapsed = true;
    for (const r of B.roof) this._hide(r);
    for (const o of B.roofCols) this.world.removeObstacle(o);
    for (const p of B.panes) this.shatter(p);
    // какие плитки осыпаются — по зерну от положения дома: у всех игроков одинаково
    const C = B.center, sz = B.box.getSize(new THREE.Vector3());
    const rnd = mulberry32((C.x * 7 + C.z * 13) | 0);
    for (const w of B.walls) for (let idx = 0; idx < w.alive.length; idx++) {
      const j = (idx / w.cols) | 0;
      if (j >= w.rows - 2 && rnd() < 0.6 && w.alive[idx]) this.destroyTile(w, idx, null, 1);
    }
    // обломки крыши — внутри коробки
    for (let k = 0; k < 40; k++) {
      const p = new THREE.Vector3(C.x + (rnd() - 0.5) * sz.x * 0.8, B.box.max.y - rnd() * 1.2, C.z + (rnd() - 0.5) * sz.z * 0.8);
      this.debris.spawn(p, _v.set((rnd() - 0.5) * 2, -rnd() * 2, (rnd() - 0.5) * 2), [0.6 + rnd() * 1.2, 0.05, 0.3 + rnd() * 0.6], rnd() < 0.5 ? 0x6e6e6a : 0x5a4630, 60 + rnd() * 60);
    }
    const G = this.game;
    if (G) {
      for (let k = 0; k < 40; k++) G.fx.smoke.emit(C.x + (rnd() - 0.5) * sz.x, B.box.min.y + rnd() * sz.y, C.z + (rnd() - 0.5) * sz.z, (rnd() - 0.5) * 3, rnd() * 2, (rnd() - 0.5) * 3, 4 + rnd() * 5, 1.2, 6, 0.62, 0.6, 0.57, 0.6, 0, 0.6, -0.05);
      G.audio.explosion(C, 0.8);
      if (G.hud && G.camPos && C.distanceTo(G.camPos) < 200) G.hud.message('Здание обрушилось', 1.5);
    }
  }

  // ---------- заборы ----------
  // pts — ломаная; kind: 'picket' (штакетник) | 'chain' (сетка на столбах) | 'board' (глухой дощатый)
  addFence(pts, { kind = 'picket', h = 1.2, mats, secLen = 2.5, terrain }) {
    const f = { kind, secs: [], groups: new Map() };
    const H = (x, z) => terrain.heightAt(x, z);
    const push = (mat, geo, sec) => {
      const g = geo.index ? geo.toNonIndexed() : geo;
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
      let gr = f.groups.get(mat);
      if (!gr) { gr = { geos: [], count: 0, mesh: null, material: mat }; f.groups.set(mat, gr); }
      const r = { gr, start: gr.count, count: g.attributes.position.count };
      gr.geos.push(g); gr.count += r.count; sec.ranges.push(r); sec.geos.push([mat, g.clone()]);
    };
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.2) continue;
      const n = Math.max(1, Math.round(L / secLen));
      const yaw = -Math.atan2(bz - az, bx - ax);
      for (let k = 0; k < n; k++) {
        const x0 = ax + ((bx - ax) * k) / n, z0 = az + ((bz - az) * k) / n, x1 = ax + ((bx - ax) * (k + 1)) / n, z1 = az + ((bz - az) * (k + 1)) / n;
        const len = L / n, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, y0 = Math.min(H(x0, z0), H(x1, z1));
        const sec = { kind: 'fence', f, broken: false, ranges: [], geos: [], c: new THREE.Vector3(cx, y0 + h / 2, cz), yaw, len, h, y0, ax: x0, az: z0, bx: x1, bz: z1 };
        const post = (px, pz, mat, r = 0.05) => { const g = new THREE.BoxGeometry(r * 2, h + 0.3, r * 2); g.translate(px, H(px, pz) + (h + 0.3) / 2 - 0.3, pz); push(mat, g, sec); };
        if (kind === 'chain') {
          post(x0, z0, mats.post, 0.04);
          const g = new THREE.PlaneGeometry(len, h); g.rotateY(yaw); g.translate(cx, y0 + h / 2 + 0.1, cz); push(mats.wire, g, sec);
        } else if (kind === 'board') {
          post(x0, z0, mats.post, 0.06);
          const g = new THREE.BoxGeometry(len, h, 0.04); g.rotateY(yaw); g.translate(cx, y0 + h / 2, cz); push(mats.board, g, sec);
        } else {
          post(x0, z0, mats.post, 0.05);
          const np = Math.max(2, Math.round(len / 0.25));
          for (let q = 0; q < np; q++) {
            if (Math.random() < 0.06) continue; // выпавшие штакетины
            const t = (q + 0.5) / np, px = x0 + (x1 - x0) * t, pz = z0 + (z1 - z0) * t;
            const hh = h * (0.85 + Math.random() * 0.2);
            const g = new THREE.BoxGeometry(0.08, hh, 0.025); g.rotateY(yaw); g.translate(px, H(px, pz) + hh / 2 - 0.1, pz); push(mats.board, g, sec);
          }
          for (const yy of [0.35, 0.85]) { const g = new THREE.BoxGeometry(len, 0.06, 0.04); g.rotateY(yaw); g.translate(cx, y0 + yy * h / 1.2, cz); push(mats.board, g, sec); }
        }
        sec.o = this.world.addBoxCollider({ x: cx, z: cz, y0: y0 - 0.3, w: len, d: 0.12, h: h + 0.3, yaw, mat: kind === 'chain' ? 'metal' : 'wood', pen: kind === 'board' ? 1.5 : 0.5, blocksBullet: kind === 'board', blocksSight: kind === 'board', cover: false, owner: sec });
        f.secs.push(sec);
      }
    }
    for (const gr of f.groups.values()) {
      const merged = mergeGeometries(gr.geos, false);
      if (!merged) continue;
      merged.attributes.position.setUsage(THREE.DynamicDrawUsage);
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, gr.material);
      mesh.castShadow = gr.material !== mats.wire; mesh.receiveShadow = true;
      this.scene.add(mesh); gr.mesh = mesh; gr.geos = null;
      this.world.staticTiles.push({ mesh, c: merged.boundingSphere.center, r: merged.boundingSphere.radius });
    }
    this.fences.push(f);
    return f;
  }

  // пролёт забора валится (взрыв, наезд): ложится на землю в сторону удара
  breakFence(sec, dir = null) {
    if (sec.broken) return;
    sec.broken = true;
    for (const r of sec.ranges) this._hide(r);
    this.world.removeObstacle(sec.o);
    // поваленный пролёт: та же геометрия, повёрнутая вокруг основания
    const ax = new THREE.Vector3(sec.bx - sec.ax, 0, sec.bz - sec.az).normalize();
    const side = new THREE.Vector3(-ax.z, 0, ax.x);
    const sgn = dir && dir.dot(side) < 0 ? -1 : 1;
    const base = new THREE.Vector3((sec.ax + sec.bx) / 2, sec.y0, (sec.az + sec.bz) / 2);
    const m4 = new THREE.Matrix4().makeTranslation(base.x, base.y, base.z)
      .multiply(new THREE.Matrix4().makeRotationAxis(ax, sgn * (1.35 + Math.random() * 0.15)))
      .multiply(new THREE.Matrix4().makeTranslation(-base.x, -base.y, -base.z));
    const grp = new THREE.Group();
    for (const [mat, g] of sec.geos) { const gg = g.clone(); gg.applyMatrix4(m4); const mesh = new THREE.Mesh(gg, mat); mesh.castShadow = true; mesh.receiveShadow = true; grp.add(mesh); }
    this.scene.add(grp);
    sec.geos = null;
    const G = this.game;
    for (let k = 0; k < 4; k++) this.debris.spawn(sec.c, _v.set((Math.random() - 0.5) * 3 + (dir ? dir.x * 3 : 0), Math.random() * 2, (Math.random() - 0.5) * 3 + (dir ? dir.z * 3 : 0)), [0.35, 0.03, 0.07], 0x8a7050, 12);
    if (G && G.camPos && sec.c.distanceTo(G.camPos) < 80) G.audio.impact(sec.c, 'wood');
  }

  update(dt) { this.debris.update(dt, this.world.terrain); }
}
