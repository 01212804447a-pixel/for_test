// Повреждения техники: следы попаданий на корпусе (по характеру: рикошет — ободранная до
// металла краска, пробитие — отверстие с ободком, кумулятивная струя/снаряд — рваная дыра с
// копотью, разрыв рядом — копоть и вмятины), деформация корпуса, пробитые и оторванные колёса,
// разорванная гусеница, сгоревший остов. Следы — дочерние плоскости модели (едут вместе с ней),
// вмятины — смещение вершин самой модели. Состояние ходовой (колёса/гусеницы) решает хост и
// раздаёт битовой маской в снимке техники; следы и вмятины каждый рисует сам.
import * as THREE from 'three';
import { paintMaterial } from './vehicleModels.js';
import { rand, clamp } from '../core/math.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const Z = new THREE.Vector3(0, 0, 1);

// ---------- текстуры следов ----------
const texCache = {};
function canvasTex(key, draw, size = 128) {
  if (texCache[key]) return texCache[key];
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache[key] = t;
  return t;
}
function blot(g, x, y, r, col, a, n = 14, jag = 0.35) {
  g.beginPath();
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2, rr = r * (1 - jag / 2 + Math.random() * jag);
    const px = x + Math.cos(t) * rr, py = y + Math.sin(t) * rr;
    if (i) g.lineTo(px, py); else g.moveTo(px, py);
  }
  g.closePath(); g.globalAlpha = a; g.fillStyle = col; g.fill(); g.globalAlpha = 1;
}
function radial(g, x, y, r0, r1, c0, c1) {
  const gr = g.createRadialGradient(x, y, r0, x, y, r1);
  gr.addColorStop(0, c0); gr.addColorStop(1, c1);
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, r1, 0, Math.PI * 2); g.fill();
}
const TEX = {
  // рикошет/непробитие: краска сбита до блестящего металла, вокруг — сколы
  scuff: () => canvasTex('scuff', (g, S) => {
    const c = S / 2;
    for (let i = 0; i < 9; i++) blot(g, c + rand(-14, 14), c + rand(-14, 14), rand(5, 12), '#3a3b36', 0.55, 9, 0.6);
    g.save(); g.translate(c, c); g.rotate(rand(0, 3)); g.scale(1, 0.45);
    radial(g, 0, 0, 2, 26, 'rgba(225,228,230,1)', 'rgba(150,152,150,0)');
    g.restore();
    radial(g, c, c, 1, 9, 'rgba(250,250,250,1)', 'rgba(200,200,200,0)');
  }),
  // пробитие пулей: отверстие, ободок голого металла, лёгкий нагар
  hole: () => canvasTex('hole', (g, S) => {
    const c = S / 2;
    radial(g, c, c, 6, 44, 'rgba(30,26,22,0.75)', 'rgba(30,26,22,0)');
    blot(g, c, c, 22, '#b9bcbd', 0.95, 12, 0.3);
    blot(g, c, c, 14, '#5a5c5c', 1, 10, 0.25);
    radial(g, c, c, 2, 12, 'rgba(0,0,0,1)', 'rgba(5,5,5,1)');
  }),
  // кумулятивная струя / снаряд: рваная дыра, лепестки, широкий ореол копоти
  breach: () => canvasTex('breach', (g, S) => {
    const c = S / 2;
    radial(g, c, c, 10, S / 2, 'rgba(14,12,10,0.95)', 'rgba(14,12,10,0)');
    for (let i = 0; i < 7; i++) blot(g, c + rand(-30, 30), c + rand(-30, 30), rand(10, 26), '#1b1916', 0.6, 10, 0.6);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + rand(-0.2, 0.2), l = rand(22, 40);
      g.save(); g.translate(c, c); g.rotate(a);
      g.fillStyle = '#6b6a66'; g.beginPath(); g.moveTo(8, -6); g.lineTo(l, rand(-3, 3)); g.lineTo(8, 6); g.closePath(); g.fill();
      g.restore();
    }
    blot(g, c, c, 15, '#000', 1, 12, 0.5);
  }, 256),
  // копоть от разрыва рядом
  soot: () => canvasTex('soot', (g, S) => {
    const c = S / 2;
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * S * 0.3;
      radial(g, c + Math.cos(a) * d, c + Math.sin(a) * d, 0, rand(14, 36), 'rgba(12,11,10,0.38)', 'rgba(12,11,10,0)');
    }
    for (let i = 0; i < 26; i++) { const a = Math.random() * Math.PI * 2, d = rand(8, S * 0.42); blot(g, c + Math.cos(a) * d, c + Math.sin(a) * d, rand(1.5, 4), Math.random() < 0.5 ? '#b0b3b4' : '#050505', 0.85, 6, 0.5); }
  }, 128),
  // след от колеса/резины
  rubber: () => canvasTex('rubber', (g, S) => {
    const c = S / 2;
    blot(g, c, c, 18, '#0a0a0a', 0.9, 10, 0.4);
    radial(g, c, c, 2, 8, 'rgba(0,0,0,1)', 'rgba(0,0,0,0.6)');
  }),
};
const matCache = {};
function decalMat(kind) {
  if (matCache[kind]) return matCache[kind];
  const metal = kind === 'scuff' || kind === 'hole';
  const m = new THREE.MeshStandardMaterial({
    map: TEX[kind](), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    roughness: metal ? 0.42 : 0.95, metalness: metal ? 0.7 : 0.1,
  });
  matCache[kind] = m;
  return m;
}
const PLANE = new THREE.PlaneGeometry(1, 1);

// Мёллер — Трумбор, двусторонний; a — массив вершин, o — смещение треугольника
function rayTri(O, D, a, o) {
  const e1x = a[o + 3] - a[o], e1y = a[o + 4] - a[o + 1], e1z = a[o + 5] - a[o + 2];
  const e2x = a[o + 6] - a[o], e2y = a[o + 7] - a[o + 1], e2z = a[o + 8] - a[o + 2];
  const px = D.y * e2z - D.z * e2y, py = D.z * e2x - D.x * e2z, pz = D.x * e2y - D.y * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (det > -1e-10 && det < 1e-10) return -1;
  const inv = 1 / det;
  const tx = O.x - a[o], ty = O.y - a[o + 1], tz = O.z - a[o + 2];
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return -1;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (D.x * qx + D.y * qy + D.z * qz) * inv;
  if (v < 0 || u + v > 1) return -1;
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
}

// материалы остова (общие на все машины)
let WRECK = null;
function wreckMats() {
  if (WRECK) return WRECK;
  WRECK = {
    hull: paintMaterial(['#26231f', '#3f2b1e', '#131211'], { scale: 1.3, snow: 0.55, gloss: 0.95, metal: 0.35, dirtTop: 1.0, dirtAmt: 0.5 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x2c2420, roughness: 0.9, metalness: 0.5 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x0e0d0c, roughness: 1 }),
    links: new THREE.MeshStandardMaterial({ color: 0x2a221d, roughness: 0.95, metalness: 0.4 }),
  };
  return WRECK;
}

// ---------- отлетевшие части (колёса, башня): баллистика, отскок, остановка ----------
const PARTS = [];
export function updateFlyingParts(game, dt) {
  const T = game.world.terrain;
  for (const p of PARTS) {
    if (p.rest) continue;
    p.v.y -= 9.81 * dt;
    p.obj.position.addScaledVector(p.v, dt);
    p.obj.rotation.x += p.w.x * dt; p.obj.rotation.y += p.w.y * dt; p.obj.rotation.z += p.w.z * dt;
    const gy = T.heightAt(p.obj.position.x, p.obj.position.z) + p.r;
    if (p.obj.position.y < gy) {
      p.obj.position.y = gy;
      if (Math.abs(p.v.y) > 1.5) { p.v.y = -p.v.y * 0.3; p.v.x *= 0.6; p.v.z *= 0.6; p.w.multiplyScalar(0.5); if (game.audio && p.bounces++ < 2) game.audio.impact(p.obj.position, 'metal'); }
      else {
        p.v.multiplyScalar(Math.exp(-4 * dt)); p.w.multiplyScalar(Math.exp(-5 * dt)); p.v.y = 0;
        // ложится плашмя
        if (p.flat) { p.obj.rotation.z += (p.flat - p.obj.rotation.z) * Math.min(1, dt * 4); }
        if (p.v.lengthSq() < 0.04) p.rest = true;
      }
    }
  }
}
function launch(game, obj, v, w, r, flat) {
  obj.updateMatrixWorld(true);
  obj.matrixWorld.decompose(obj.position, obj.quaternion, obj.scale);
  obj.rotation.setFromQuaternion(obj.quaternion);
  if (obj.parent) obj.parent.remove(obj);
  game.scene.add(obj);
  PARTS.push({ obj, v, w, r, flat, rest: false, bounces: 0 });
  while (PARTS.length > 16) { const o = PARTS.shift(); if (o.obj.parent) o.obj.parent.remove(o.obj); }
}
export function clearFlyingParts() { for (const o of PARTS) if (o.obj.parent) o.obj.parent.remove(o.obj); PARTS.length = 0; }

export class VehicleDamage {
  constructor(v) {
    this.v = v;
    this.decals = [];
    this.state = 0;          // биты: 0..11 — колесо спущено, 12..23 — оторвано, 24/25 — гусеница слева/справа разорвана
    this.applied = 0;
    const M = v.model;
    M.wheels.forEach((wh, i) => { wh.i = i; if (wh.side === undefined) wh.side = Math.sign(wh.steer.position.x) || 1; wh.steer.userData.wheel = true; });
    // корпус для следов и вмятин: всё, кроме колёс, траков и самих следов
    this.hull = [];
    const walk = (o) => {
      if (o.userData.wheel || o.userData.decal) return;
      if (o.isMesh && !o.isInstancedMesh) this.hull.push(o);
      for (const c of o.children) walk(c);
    };
    walk(v.mesh);
  }

  // ---------- следы ----------
  // Луч по модели: сетка треугольников (ячейка 0,2 м) строится лениво для каждого меша —
  // «Тигр» это ~50 тыс. треугольников, перебор всех на каждое попадание слишком дорог.
  _grid(mesh) {
    if (mesh.userData.tgrid && !mesh.userData.tgridDirty) return mesh.userData.tgrid;
    const a = mesh.geometry.attributes.position.array, nt = (a.length / 9) | 0, cs = 0.2;
    let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
    for (let i = 0; i < a.length; i += 3) {
      const x = a[i], y = a[i + 1], z = a[i + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    x0 -= 0.01; y0 -= 0.01; z0 -= 0.01;
    const nx = Math.max(1, Math.ceil((x1 - x0) / cs) + 1), ny = Math.max(1, Math.ceil((y1 - y0) / cs) + 1), nz = Math.max(1, Math.ceil((z1 - z0) / cs) + 1);
    const cells = new Array(nx * ny * nz);
    for (let t = 0; t < nt; t++) {
      const o = t * 9;
      const ax = Math.min(a[o], a[o + 3], a[o + 6]), bx = Math.max(a[o], a[o + 3], a[o + 6]);
      const ay = Math.min(a[o + 1], a[o + 4], a[o + 7]), by = Math.max(a[o + 1], a[o + 4], a[o + 7]);
      const az = Math.min(a[o + 2], a[o + 5], a[o + 8]), bz = Math.max(a[o + 2], a[o + 5], a[o + 8]);
      const i0 = ((ax - x0) / cs) | 0, i1 = ((bx - x0) / cs) | 0, j0 = ((ay - y0) / cs) | 0, j1 = ((by - y0) / cs) | 0, k0 = ((az - z0) / cs) | 0, k1 = ((bz - z0) / cs) | 0;
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) {
        const c = (k * ny + j) * nx + i;
        (cells[c] || (cells[c] = [])).push(t);
      }
    }
    const G = { x0, y0, z0, x1, y1, z1, cs, nx, ny, nz, cells, stamp: new Uint32Array(nt), ray: 0 };
    mesh.userData.tgrid = G; mesh.userData.tgridDirty = false;
    return G;
  }
  _rayMesh(mesh, o, d, far) {
    const G = this._grid(mesh), a = mesh.geometry.attributes.position.array;
    // вход в габарит меша (slab)
    let tn = 0, tf = far;
    const lo = [G.x0, G.y0, G.z0], hi = [G.x1 + 0.01, G.y1 + 0.01, G.z1 + 0.01], O = [o.x, o.y, o.z], D = [d.x, d.y, d.z];
    for (let k = 0; k < 3; k++) {
      if (Math.abs(D[k]) < 1e-9) { if (O[k] < lo[k] || O[k] > hi[k]) return null; continue; }
      let ta = (lo[k] - O[k]) / D[k], tb = (hi[k] - O[k]) / D[k];
      if (ta > tb) { const q = ta; ta = tb; tb = q; }
      if (ta > tn) tn = ta; if (tb < tf) tf = tb;
      if (tn > tf) return null;
    }
    const ray = ++G.ray; let best = Infinity, bt = -1;
    const step = G.cs * 0.5;
    for (let t = tn; t <= tf + step; t += step) {
      const px = o.x + d.x * t, py = o.y + d.y * t, pz = o.z + d.z * t;
      const i = ((px - G.x0) / G.cs) | 0, j = ((py - G.y0) / G.cs) | 0, k = ((pz - G.z0) / G.cs) | 0;
      if (i >= 0 && j >= 0 && k >= 0 && i < G.nx && j < G.ny && k < G.nz) {
        const list = G.cells[(k * G.ny + j) * G.nx + i];
        if (list) for (const tri of list) {
          if (G.stamp[tri] === ray) continue;
          G.stamp[tri] = ray;
          const h = rayTri(o, d, a, tri * 9);
          if (h > 0 && h < best && h <= far) { best = h; bt = tri; }
        }
      }
      if (best < t + G.cs) break;
    }
    return bt < 0 ? null : { t: best, tri: bt };
  }
  _surface(origin, dir, far = 6) {
    const O = new THREE.Vector3().copy(origin), Dw = new THREE.Vector3().copy(dir);
    const lo = new THREE.Vector3(), ld = new THREE.Vector3(), inv = new THREE.Matrix4();
    let best = null;
    for (const mesh of this.hull) {
      if (!mesh.visible || !mesh.geometry.attributes.position || mesh.geometry.index) continue;
      if (!mesh.parent) continue;
      inv.copy(mesh.matrixWorld).invert();
      lo.copy(O).applyMatrix4(inv); ld.copy(Dw).transformDirection(inv);
      const h = this._rayMesh(mesh, lo, ld, far);
      if (h && (!best || h.t < best.t)) best = { t: h.t, tri: h.tri, object: mesh };
    }
    if (!best) return null;
    const a = best.object.geometry.attributes.position.array, o = best.tri * 9;
    const A = new THREE.Vector3(a[o], a[o + 1], a[o + 2]), B = new THREE.Vector3(a[o + 3], a[o + 4], a[o + 5]), C = new THREE.Vector3(a[o + 6], a[o + 7], a[o + 8]);
    const n = B.sub(A).cross(C.sub(A)).normalize().transformDirection(best.object.matrixWorld);
    if (n.dot(Dw) > 0) n.negate();
    return { point: O.clone().addScaledVector(Dw, best.t), object: best.object, normal: n };
  }
  _decal(hit, kind, size, worldN) {
    const parent = hit.object.parent || this.v.mesh;
    const n = worldN || hit.normal;
    const d = new THREE.Mesh(PLANE, decalMat(kind));
    d.userData.decal = true;
    d.renderOrder = 2;
    parent.updateMatrixWorld(true);
    _m.copy(parent.matrixWorld).invert();
    d.position.copy(hit.point).addScaledVector(n, 0.006).applyMatrix4(_m);
    const ln = n.clone().transformDirection(_m);
    d.quaternion.setFromUnitVectors(Z, ln);
    _q.setFromAxisAngle(Z, Math.random() * Math.PI * 2); d.quaternion.multiply(_q);
    d.scale.set(size, size * (kind === 'scuff' ? rand(0.6, 1) : 1), 1);
    d.castShadow = false; d.receiveShadow = true;
    parent.add(d);
    this.decals.push(d);
    if (this.decals.length > 70) { const o = this.decals.shift(); if (o.parent) o.parent.remove(o); }
    return d;
  }
  // попадание пули: kind 'scuff' | 'hole'; caliber, м
  bulletMark(pt, dir, kind, caliber = 0.0055) {
    const cam = this.v.game.camPos;
    if (cam && pt.distanceToSquared(cam) > 250 * 250) return;
    let hit = this._surface(_v.copy(pt).addScaledVector(dir, -1.2), dir, 3.5);
    if (!hit) { const c = this.v.chest; hit = this._surface(pt, _v2.copy(c).sub(pt).normalize(), 3); }
    if (!hit) return;
    const big = caliber > 0.01;
    if (kind === 'hole') this._decal(hit, 'hole', big ? rand(0.15, 0.2) : rand(0.07, 0.09));
    else this._decal(hit, 'scuff', big ? rand(0.18, 0.24) : rand(0.09, 0.13));
    if (big && kind === 'hole') this.dent(hit.point, dir, 0.18, 0.025);
  }
  tireMark(pt, dir) {
    const hit = this._surface(_v.copy(pt).addScaledVector(dir, -1.2), dir, 3.5);
    if (hit) this._decal(hit, 'rubber', 0.07);
  }
  // разрыв рядом или прямое попадание: копоть, осколочные отметины, вмятины, пролом
  blastMarks(pos, ex, direct) {
    const v = this.v, cam = v.game.camPos;
    if (cam && pos.distanceToSquared(cam) > 300 * 300) return;
    const c = _v.set(v.pos.x, v.pos.y + v.type.height * 0.5, v.pos.z);
    const dist = c.distanceTo(pos);
    const power = ex.dmg * (direct ? 1.4 : clamp(1 - dist / (ex.radius * 1.6 + 2), 0, 1));
    if (power < 25) return;
    const toC = c.clone().sub(pos).normalize();
    const main = this._surface(pos.clone().addScaledVector(toC, -0.6), toC, dist + 3);
    if (main) {
      if (direct && ex.pen > 100) this._decal(main, 'breach', clamp(0.25 + ex.dmg / 900, 0.3, 0.7));
      this._decal(main, 'soot', clamp(0.5 + power / 160, 0.7, 2.6));
      if (power > 60) this.dent(main.point, toC, clamp(0.25 + power / 500, 0.3, 1.1), clamp(power / 2400, 0.02, direct ? 0.2 : 0.12));
    }
    // осколки: отметины по стороне, обращённой к разрыву
    const nFrag = Math.round(clamp(ex.frag * (direct ? 0.4 : 0.25) * clamp(1 - dist / (ex.frag * 1.2 + 1), 0, 1), 0, 14));
    for (let i = 0; i < nFrag; i++) {
      const tgt = _v2.set(v.pos.x + rand(-1, 1) * v.type.width * 0.5, v.pos.y + rand(0.3, v.type.height), v.pos.z + rand(-1, 1) * v.type.len * 0.5);
      const d = tgt.sub(pos).normalize();
      const h = this._surface(pos, d, dist + 4);
      if (h) this._decal(h, Math.random() < 0.3 ? 'hole' : 'scuff', rand(0.05, 0.1));
    }
  }

  // ---------- вмятина: вершины в радиусе r уходят вдоль dir (мировые) на глубину depth ----------
  dent(pt, dir, r, depth) {
    this.v.mesh.updateMatrixWorld(true);
    for (const mesh of this.hull) {
      const geo = mesh.geometry, pos = geo.attributes.position;
      if (!pos || geo.index) continue;
      _m.copy(mesh.matrixWorld).invert();
      const P = _v.copy(pt).applyMatrix4(_m);
      const D = _v2.copy(dir).transformDirection(_m);
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      if (geo.boundingSphere.center.distanceTo(P) > geo.boundingSphere.radius + r) continue;
      const arr = pos.array, r2 = r * r;
      let touched = null;
      for (let i = 0; i < pos.count; i++) {
        const dx = arr[i * 3] - P.x, dy = arr[i * 3 + 1] - P.y, dz = arr[i * 3 + 2] - P.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= r2) continue;
        const k = (1 - Math.sqrt(d2) / r); const f = k * k * depth * (0.75 + 0.5 * Math.random());
        arr[i * 3] += D.x * f; arr[i * 3 + 1] += D.y * f; arr[i * 3 + 2] += D.z * f;
        (touched || (touched = new Set())).add((i / 3) | 0);
      }
      if (!touched) continue;
      mesh.userData.tgridDirty = true;
      const nrm = geo.attributes.normal;
      if (nrm) {
        const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
        for (const t of touched) {
          a.fromArray(arr, t * 9); b.fromArray(arr, t * 9 + 3); c.fromArray(arr, t * 9 + 6);
          b.sub(a); c.sub(a); b.cross(c);
          if (b.lengthSq() < 1e-12) continue;
          b.normalize();
          for (let k = 0; k < 3; k++) nrm.setXYZ(t * 3 + k, b.x, b.y, b.z);
        }
        nrm.needsUpdate = true;
      }
      pos.needsUpdate = true;
    }
  }

  // ---------- ходовая ----------
  // колесо, в которое пришлась точка (мировые координаты) — или -1
  wheelAt(pt, pad = 0.06) {
    const M = this.v.model;
    if (this.v.type.tracked) return -1;
    this.v.mesh.updateMatrixWorld(true);
    let best = -1, bd = 1e9;
    for (const wh of M.wheels) {
      if (this.state & (1 << (12 + wh.i))) continue;
      wh.steer.getWorldPosition(_v);
      const d = _v.distanceTo(pt);
      if (d < wh.r + pad + 0.15 && d < bd) {
        // точка снаружи от середины колеса (с борта), не со стороны днища
        _m.copy(this.v.mesh.matrixWorld).invert();
        const lp = _v2.copy(pt).applyMatrix4(_m);
        if (Math.abs(lp.y - wh.steer.position.y) < wh.r + pad && Math.abs(lp.z - wh.steer.position.z) < wh.r + pad) { bd = d; best = wh.i; }
      }
    }
    return best;
  }
  // решение хоста/одиночной игры: что стало с ходовой от попадания
  onHit(pt, pen, heat, ex) {
    const v = this.v;
    if (v.type.tracked) {
      if (heat && ex && ex.dmg >= 150) this._trackNear(pt, 1.2);
      return -1;
    }
    const wi = this.wheelAt(pt);
    if (wi < 0) return -1;
    if (heat || pen > 60) this.setBit(12 + wi);
    else this.setBit(wi);
    return wi;
  }
  onBlast(pos, ex) {
    const v = this.v;
    if (v.type.tracked) {
      if (ex.dmg >= 200) this._trackNear(pos, Math.min(2.6, ex.radius * 0.3));
      return;
    }
    v.mesh.updateMatrixWorld(true);
    for (const wh of v.model.wheels) {
      wh.steer.getWorldPosition(_v);
      const d = _v.distanceTo(pos);
      const k = ex.dmg * Math.max(0, 1 - d / Math.max(1, ex.radius * 0.55));
      if (k > 150) this.setBit(12 + wh.i);
      else if (d < ex.radius * 0.8 && Math.random() < 0.75) this.setBit(wh.i);
    }
  }
  _trackNear(p, r) {
    const v = this.v;
    _m.copy(v.mesh.matrixWorld).invert();
    const lp = _v.copy(p).applyMatrix4(_m);
    if (lp.y > 1.3) return;
    const side = lp.x < 0 ? 0 : 1;
    if (Math.abs(Math.abs(lp.x) - 1.24) < r + 0.3 && Math.abs(lp.z) < 3.4 + r) this.setBit(24 + side);
  }
  setBit(b) { this.state |= 1 << b; this.apply(); }

  // применить маску (своя или пришедшая от хоста): вид, просадка, ходовые качества
  apply(mask = this.state) {
    this.state = mask;
    const v = this.v, M = v.model, T = v.type;
    const add = mask & ~this.applied;
    if (!add) return;
    for (const wh of M.wheels) {
      if (T.tracked || wh.i >= 12) continue; // биты колёс — только у колёсных (у МТ-ЛБ 16 катков — своя маска гусениц)
      const fl = add & (1 << wh.i), lost = add & (1 << (12 + wh.i));
      if (lost && !wh.lost) {
        wh.lost = true; wh.drop = T.tracked ? 0 : wh.r * 0.8;
        if (v.alive || Math.random() < 0.5) {
          const part = wh.steer;
          const out = _v.set(wh.side * 1, 0, 0).transformDirection(v.mesh.matrixWorld);
          launch(v.game, part, new THREE.Vector3(out.x * rand(4, 8) + v.vel.x, rand(3, 7), out.z * rand(4, 8) + v.vel.z), new THREE.Vector3(rand(-6, 6), rand(-3, 3), rand(-4, 4)), wh.r * 0.4, Math.PI / 2);
        } else wh.steer.visible = false;
      } else if (fl && !wh.flat && !wh.lost) {
        wh.flat = true;
        const keep = T.id === 'tigr' ? 0.8 : 0.68;  // у «Тигра» — вставка для движения на спущенной
        wh.drop = wh.r * (1 - keep);
        this._flatten(wh, keep);
      }
    }
    if (M.tracks) for (let k = 0; k < 2; k++) if (add & (1 << (24 + k))) this._breakTrack(k);
    this.applied = mask;
    this._recalc();
  }
  // Спущенная шина: низ сплющен до keep·r, боковины выпячены. Шина переходит из вращающейся
  // группы в невращающуюся (диск продолжает крутиться) — пятно контакта всегда внизу.
  _flatten(wh, keep) {
    const tires = [];
    wh.spin.traverse((o) => { if (o.isMesh && o.material && o.material.color && o.material.color.getHex() === 0x1a1a1b) tires.push(o); });
    const r = wh.r, y0 = -keep * r * 0.85, sc = (0.15 * keep) / (1 - 0.85 * keep);
    for (const t of tires) {
      const geo = t.geometry.clone(), a = geo.attributes.position.array;
      for (let i = 0; i < a.length; i += 3) {
        const y = a[i + 1];
        if (y >= y0) continue;
        const k = (y0 - y) / (r + y0);
        a[i + 1] = y0 - (y - y0) * -sc;
        a[i] *= 1 + 0.2 * k;
        a[i + 2] *= 1 + 0.06 * k;
      }
      geo.attributes.position.needsUpdate = true;
      geo.computeBoundingSphere();
      t.geometry = geo;
      t.parent.remove(t);
      t.position.set(0, 0, 0); t.rotation.set(0, 0, 0);
      wh.steer.add(t);
    }
  }
  _recalc() {
    const v = this.v, M = v.model, T = v.type;
    let speedK = 1, gripK = 1, rollK = 1, pull = 0;
    for (const wh of M.wheels) {
      if (wh.lost && !T.tracked) { speedK *= 0.45; gripK -= 0.18; rollK += 3; pull -= wh.side * 0.22; }
      else if (wh.flat) { const rf = T.id === 'tigr' ? 0.92 : 0.8; speedK *= rf; gripK -= 0.06; rollK += T.id === 'tigr' ? 0.3 : 0.7; pull -= wh.side * (T.id === 'tigr' ? 0.03 : 0.08); }
      else if (wh.lost) speedK *= 0.95;
    }
    if (M.tracks) for (const sd of M.tracks.sides) if (sd.broken) { speedK = Math.min(speedK, 0.08); pull -= sd.s * 0.6; rollK += 2; }
    v.speedK = Math.max(0.06, speedK); v.gripK = clamp(gripK, 0.3, 1); v.rollK = rollK; v.pull = pull;
  }
  // гусеница слетела: траки лентой ложатся на грунт вдоль борта и за кормой
  _breakTrack(k) {
    const TR = this.v.model.tracks, sd = TR.sides[k];
    if (!sd || sd.broken) return;
    sd.broken = true;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const start = rand(-2.6, -1.6);
    for (let i = 0; i < TR.count; i++) {
      const z = start + i * TR.pitch * 0.98;
      e.set(0, (Math.random() - 0.5) * 0.08 + (z > 3.2 ? (z - 3.2) * 0.06 * sd.s : 0), 0);
      q.setFromEuler(e);
      const x = sd.x + (z > 3.2 ? (z - 3.2) * 0.25 * sd.s : 0);
      m4.compose(_v.set(x, 0.02, z), q, _v2.set(1, 1, 1));
      sd.im.setMatrixAt(i, m4);
    }
    sd.im.instanceMatrix.needsUpdate = true;
    // ленивец/ведущее колесо борта сорваны набок
    for (const wh of this.v.model.wheels) if (wh.side === sd.s && wh.steer.position.y > 0.5 && wh.steer.position.z > 0) { wh.steer.rotation.z = 0.35 * sd.s; wh.steer.position.y -= 0.2; }
  }

  // ---------- остов ----------
  wreck() {
    const v = this.v, M = v.model, W = wreckMats();
    const mats = v.model.mats || [];
    v.mesh.traverse((o) => {
      if (!o.isMesh || o.userData.decal) return;
      if (o.isInstancedMesh) { o.material = W.links; return; }
      const m = o.material, name = m && m.color ? m : null;
      const glassLike = m && (m.transmission > 0 || m.clearcoat === 1 || (m.emissive && m.emissive.getHex() !== 0));
      if (glassLike) { o.visible = false; return; }        // стёкла, фары — выбиты
      if (m && m.color && m.color.getHex() === 0x1a1a1b && !v.type.tracked) { o.visible = false; return; } // шины сгорели
      if (m && m.color && m.color.getHex() === 0x4a5236) { o.visible = false; return; } // брезент сгорел
      if (m && m.metalness > 0.6) o.material = W.metal;
      else if (name && name.color.getHex() === 0x101010) o.material = W.dark;
      else o.material = W.hull;
    });
    void mats;
    // колёса без шин — на дисках
    for (const wh of M.wheels) if (!wh.lost && !v.type.tracked) wh.drop = wh.r * 0.42;
    // вмятины и пробоины
    const c = new THREE.Vector3(v.pos.x, v.pos.y + v.type.height * 0.55, v.pos.z);
    for (let i = 0; i < 5; i++) {
      const dir = new THREE.Vector3(rand(-1, 1), rand(-0.1, 0.9), rand(-1, 1)).normalize();
      const o = c.clone().addScaledVector(dir, 6);
      const h = this._surface(o, dir.clone().negate(), 8);
      if (!h) continue;
      this.dent(h.point, dir.clone().negate(), rand(0.4, 0.9), rand(0.06, 0.16));
      this._decal(h, i < 2 ? 'breach' : 'soot', i < 2 ? rand(0.35, 0.6) : rand(1.2, 2.2));
    }
    // башню МТ-ЛБ срывает детонацией боекомплекта; у колёсных — отрывает колесо-другое
    if (M.turret && v.type.tracked && Math.random() < 0.8) {
      const fwd = new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).normalize();
      launch(v.game, M.turret, new THREE.Vector3(fwd.x * rand(1.5, 4), rand(7, 12), fwd.z * rand(1.5, 4)), new THREE.Vector3(rand(-3, 3), rand(-6, 6), rand(-3, 3)), 0.3, 0);
    }
    // отлетевшие части больше не корпус
    this.hull = this.hull.filter((h) => { let o = h; while (o && o !== v.mesh) o = o.parent; return !!o; });
    if (!v.game.netVisual) { // у клиента ходовую остова пришлёт хост
      if (v.type.tracked && !(this.state & (3 << 24))) this.state |= 1 << (24 + (Math.random() < 0.5 ? 0 : 1));
      if (!v.type.tracked && Math.random() < 0.6) this.state |= 1 << (12 + Math.floor(Math.random() * M.wheels.length));
    }
    this.apply(this.state);
    v.drop = v.type.tracked ? 0.12 : 0;
  }
}
