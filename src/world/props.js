// Подвижные предметы (твёрдые тела): ящики, бочки, канистры, банки, стулья…
// Отлетают от попаданий пуль, наезда техники, ударной волны; сталкиваются с землёй,
// постройками и друг другом; засыпают в покое.
import * as THREE from 'three';
import { model } from '../core/assets.js';
import { clamp } from '../core/math.js';

// масса (кг), материал, пробиваемость (пуля летит дальше), отскок, трение
export const PROP_TYPES = {
  barrel: { model: 'barrel_03', mass: 28, mat: 'metal', thin: true, e: 0.25, mu: 0.5 },
  crate: { model: 'wooden_crate_01', mass: 22, mat: 'wood', thin: true, e: 0.15, mu: 0.6 },
  milcrate: { model: 'old_military_crate', mass: 30, mat: 'wood', thin: false, e: 0.15, mu: 0.6 },
  milcrate2: { model: 'wooden_military_crate', mass: 38, mat: 'wood', thin: false, e: 0.15, mu: 0.6 },
  ammobox: { model: 'ammo_box', mass: 7, mat: 'metal', thin: false, e: 0.2, mu: 0.5 },
  jerrycan: { model: 'metal_jerrycan_green', mass: 5, mat: 'metal', thin: true, e: 0.3, mu: 0.45 },
  propane: { model: 'propane_tank', mass: 14, mat: 'metal', thin: false, e: 0.3, mu: 0.45 },
  generator: { model: 'portable_generator', mass: 65, mat: 'metal', thin: false, e: 0.1, mu: 0.7 },
  cans: { model: 'russian_food_cans_01', mass: 0.4, mat: 'metal', thin: true, e: 0.35, mu: 0.4 },
  can: { model: 'can_rusted', mass: 0.25, mat: 'metal', thin: true, e: 0.35, mu: 0.4 },
  chair: { model: 'painted_wooden_chair_01', mass: 5, mat: 'wood', thin: true, e: 0.2, mu: 0.6 },
};

const protoCache = new Map();
function proto(type) {
  if (protoCache.has(type)) return protoCache.get(type);
  const T = PROP_TYPES[type];
  const g = model(T.model);
  let obj, box;
  if (g) {
    obj = g.scene.clone(true);
    box = new THREE.Box3().setFromObject(obj);
  } else {
    obj = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshStandardMaterial({ color: 0x6b5a40 }));
    box = new THREE.Box3().setFromObject(obj);
  }
  const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  obj.position.sub(center);
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const res = { obj, half: size.multiplyScalar(0.5) };
  protoCache.set(type, res);
  return res;
}

const _v = new THREE.Vector3(), _r = new THREE.Vector3(), _n = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const CORNERS = [];
for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) CORNERS.push(new THREE.Vector3(x, y, z));

export class Props {
  constructor(game) {
    this.game = game;
    this.list = [];
  }

  spawn(type, x, z, { yaw = 0, y = null, scale = 1 } = {}) {
    const T = PROP_TYPES[type];
    if (!T) return null;
    const P = proto(type);
    const g = new THREE.Group();
    g.add(P.obj.clone(true));
    g.scale.setScalar(scale);
    this.game.scene.add(g);
    const half = P.half.clone().multiplyScalar(scale);
    const gy = y !== null ? y : this.game.world.groundAt(x, z, 1e9);
    const b = {
      type, T, mesh: g, half, mass: T.mass * scale ** 3,
      p: new THREE.Vector3(x, gy + half.y + 0.002, z), q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
      v: new THREE.Vector3(), w: new THREE.Vector3(),
      r: Math.max(half.x, half.z) * 0.9, sleep: 0, asleep: true,
    };
    b.inertia = b.mass * (half.x * half.x + half.y * half.y + half.z * half.z) * 0.4;
    this._sync(b);
    this.list.push(b);
    return b;
  }

  _sync(b) {
    b.mesh.position.copy(b.p);
    b.mesh.quaternion.copy(b.q);
  }

  wake(b) { b.asleep = false; b.sleep = 0; }

  // Импульс J (Н·с) в точке pt
  impulse(b, pt, J) {
    this.wake(b);
    b.v.addScaledVector(J, 1 / b.mass);
    _r.subVectors(pt, b.p);
    _c.crossVectors(_r, J).divideScalar(b.inertia);
    b.w.add(_c);
    if (b.v.length() > 40) b.v.setLength(40);
    if (b.w.length() > 30) b.w.setLength(30);
  }

  // Отрезок против наклонённого бокса предмета
  raycast(p0, p1) {
    let best = null;
    const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
    const L = Math.hypot(dx, dy, dz);
    for (const b of this.list) {
      // грубый отсев по сфере
      const R = b.half.length();
      const fx = p0.x - b.p.x, fy = p0.y - b.p.y, fz = p0.z - b.p.z;
      const tt = clamp(-(fx * dx + fy * dy + fz * dz) / (L * L || 1), 0, 1);
      const cx = fx + dx * tt, cy = fy + dy * tt, cz = fz + dz * tt;
      if (cx * cx + cy * cy + cz * cz > R * R) continue;
      _q.copy(b.q).invert();
      const s = _v.set(fx, fy, fz).applyQuaternion(_q);
      const d = _r.set(dx, dy, dz).applyQuaternion(_q);
      let tmin = 0, tmax = 1, axis = -1, sign = 0;
      const S = [s.x, s.y, s.z], D = [d.x, d.y, d.z], H = [b.half.x, b.half.y, b.half.z];
      let miss = false;
      for (let a = 0; a < 3; a++) {
        if (Math.abs(D[a]) < 1e-9) { if (S[a] < -H[a] || S[a] > H[a]) { miss = true; break; } continue; }
        let t1 = (-H[a] - S[a]) / D[a], t2 = (H[a] - S[a]) / D[a], sg = -1;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; sg = 1; }
        if (t1 > tmin) { tmin = t1; axis = a; sign = sg; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) { miss = true; break; }
      }
      if (miss || (best && tmin >= best.t)) continue;
      const n = new THREE.Vector3(axis === 0 ? sign : 0, axis === 1 ? sign : 0, axis === 2 ? sign : 0).applyQuaternion(b.q);
      if (axis === -1) n.set(0, 1, 0);
      best = { t: tmin, prop: b, normal: n };
    }
    return best;
  }

  explosion(pos, strength, radius) {
    for (const b of this.list) {
      const d = b.p.distanceTo(pos);
      if (d > radius) continue;
      const k = Math.pow(1 - d / radius, 1.5);
      _n.subVectors(b.p, pos).normalize();
      _n.y = Math.abs(_n.y) + 0.6;
      _n.normalize();
      const J = _n.multiplyScalar(strength * k * 0.25 * Math.sqrt(b.mass));
      const pt = b.p.clone().add(new THREE.Vector3((Math.random() - 0.5) * b.half.x, -b.half.y * 0.5, (Math.random() - 0.5) * b.half.z));
      this.impulse(b, pt, J);
    }
  }

  update(dt) {
    const w = this.game.world, g = this.game;
    const steps = 2, h = dt / steps;
    for (const b of this.list) {
      // пробуждение от техники и людей
      for (const v of g.vehicles) {
        if (!v.collider) continue;
        const dd = w.pointObstacleDist(v.collider, b.p.x, b.p.z);
        if (dd < b.r && b.p.y < v.pos.y + v.type.height && Math.hypot(v.vel.x, v.vel.z) > 0.3) {
          const push = _n.set(b.p.x - v.pos.x, 0, b.p.z - v.pos.z).normalize();
          const vv = v.vel.clone();
          const rel = vv.length();
          const J = vv.multiplyScalar(1.3 * b.mass).addScaledVector(push, b.mass * (1.5 + rel * 0.3)).add(new THREE.Vector3(0, b.mass * rel * 0.25, 0));
          this.impulse(b, b.p.clone().add(new THREE.Vector3(0, b.half.y * 0.3, 0)), J);
          b.p.addScaledVector(push, b.r - dd + 0.02);
          // машина теряет немного скорости
          v.vel.multiplyScalar(1 - Math.min(0.3, b.mass / 4000));
        }
      }
      for (const s of g.soldiers) {
        if (!s.alive || s.hidden) continue;
        const dx = b.p.x - s.pos.x, dz = b.p.z - s.pos.z, d = Math.hypot(dx, dz);
        if (d < b.r + 0.3 && b.p.y - b.half.y < s.pos.y + 1 && b.mass < 40) {
          const sp = Math.hypot(s.vel.x, s.vel.z);
          if (sp > 0.3) this.impulse(b, b.p, new THREE.Vector3(dx / d, 0.1, dz / d).multiplyScalar(Math.min(b.mass, 20) * sp * 0.6));
        }
      }
      if (b.asleep) continue;
      for (let k = 0; k < steps; k++) this._step(b, h);
      const still = b.v.lengthSq() < 0.004 && b.w.lengthSq() < 0.01;
      b.sleep = still ? b.sleep + dt : 0;
      if (b.sleep > 0.6) { b.asleep = true; b.v.set(0, 0, 0); b.w.set(0, 0, 0); }
      this._sync(b);
    }
    // предмет против предмета (сферы)
    for (let i = 0; i < this.list.length; i++) {
      const a = this.list[i];
      for (let j = i + 1; j < this.list.length; j++) {
        const c = this.list[j];
        if (a.asleep && c.asleep) continue;
        const ra = Math.min(a.half.x, a.half.y, a.half.z) + a.r * 0.3, rc = Math.min(c.half.x, c.half.y, c.half.z) + c.r * 0.3;
        _n.subVectors(c.p, a.p);
        const d = _n.length();
        if (d >= ra + rc || d < 1e-5) continue;
        _n.divideScalar(d);
        const pen = ra + rc - d, im = 1 / a.mass + 1 / c.mass;
        a.p.addScaledVector(_n, -pen * (1 / a.mass) / im); c.p.addScaledVector(_n, pen * (1 / c.mass) / im);
        const vn = _v.subVectors(c.v, a.v).dot(_n);
        if (vn < 0) { const j2 = -(1.2 * vn) / im; a.v.addScaledVector(_n, -j2 / a.mass); c.v.addScaledVector(_n, j2 / c.mass); this.wake(a); this.wake(c); }
      }
    }
  }

  _step(b, h) {
    const w = this.game.world, t = w.terrain;
    b.v.y -= 9.81 * h;
    b.v.multiplyScalar(1 - 0.05 * h);
    b.w.multiplyScalar(1 - 0.4 * h);
    b.p.addScaledVector(b.v, h);
    const wl = b.w.length();
    if (wl > 1e-6) { _q.setFromAxisAngle(_v.copy(b.w).divideScalar(wl), wl * h); b.q.premultiply(_q).normalize(); }
    // контакты углов с землёй
    let contacts = 0;
    let maxPen = 0;
    for (const c of CORNERS) {
      _c.set(c.x * b.half.x, c.y * b.half.y, c.z * b.half.z).applyQuaternion(b.q).add(b.p);
      const gy = w.groundAt(_c.x, _c.z, _c.y + 0.3);
      const pen = gy - _c.y;
      if (pen <= 0) continue;
      contacts++;
      maxPen = Math.max(maxPen, pen);
      t.normalAt(_c.x, _c.z, _n);
      if (gy > t.heightAt(_c.x, _c.z) + 0.05) _n.set(0, 1, 0);
      _r.subVectors(_c, b.p);
      const vc = _v.copy(b.w).cross(_r).add(b.v);
      const vn = vc.dot(_n);
      if (vn < 0) {
        const rn = new THREE.Vector3().crossVectors(_r, _n);
        const jn = -(1 + b.T.e) * vn / (1 / b.mass + rn.lengthSq() / b.inertia) / 4;
        const J = _n.clone().multiplyScalar(jn);
        // трение
        const vt = vc.clone().addScaledVector(_n, -vn);
        const vtl = vt.length();
        if (vtl > 1e-4) J.addScaledVector(vt, -Math.min(b.T.mu * jn, vtl * b.mass * 0.25) / vtl);
        b.v.addScaledVector(J, 1 / b.mass);
        b.w.add(new THREE.Vector3().crossVectors(_r, J).divideScalar(b.inertia));
      }
    }
    if (maxPen > 0) b.p.y += maxPen * 0.8;
    // стены и препятствия: выталкиваем центр как сферу
    w._cellsAround(b.p.x, b.p.z, b.r + 1, (o) => {
      if (!o.blocksMove || o.owner) return;
      if (o.y1 < b.p.y - b.half.y + 0.15 || o.y0 > b.p.y + b.half.y) return;
      const d = w.pointObstacleDist(o, b.p.x, b.p.z);
      if (d >= b.r) return;
      const e = 0.05;
      const gx = w.pointObstacleDist(o, b.p.x + e, b.p.z) - w.pointObstacleDist(o, b.p.x - e, b.p.z);
      const gz = w.pointObstacleDist(o, b.p.x, b.p.z + e) - w.pointObstacleDist(o, b.p.x, b.p.z - e);
      const gl = Math.hypot(gx, gz) || 1;
      const nx = gx / gl, nz = gz / gl;
      b.p.x += nx * (b.r - d); b.p.z += nz * (b.r - d);
      const vn = b.v.x * nx + b.v.z * nz;
      if (vn < 0) { b.v.x -= nx * vn * (1 + b.T.e); b.v.z -= nz * vn * (1 + b.T.e); }
    });
    if (b.p.y < t.heightAt(b.p.x, b.p.z) - 3) { b.p.y = t.heightAt(b.p.x, b.p.z) + b.half.y; b.v.set(0, 0, 0); }
  }
}
