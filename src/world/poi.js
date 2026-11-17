// Точки интереса: заброшенные посёлки с избами, ЛЭП, трубопровод на опорах,
// остовы грузовиков, чумы оленеводов, руины, торосы, вешки вдоль дорог.
import * as THREE from 'three';
import { building, l2w, crates, barrels, wreck } from './structures.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/math.js';

const H = (world, x, z) => world.terrain.heightAt(x, z);

export function woodpile(world, m, { x, z, yaw = 0 }) {
  const y0 = H(world, x, z);
  world.addBox({ x, z, y0, w: 2.4, d: 1.0, h: 1.15, yaw, material: m.woodDark, mat: 'wood', pen: 80, snowTop: true });
  const ends = [];
  for (let i = 0; i < 18; i++) {
    const g = new THREE.CircleGeometry(0.12, 8);
    const lx = -1.1 + (i % 9) * 0.27, ly = 0.15 + Math.floor(i / 9) * 0.28 + (i % 2) * 0.05;
    const c = l2w(x, z, yaw, lx, 0.505);
    g.rotateY(yaw); g.translate(c.x, y0 + ly + (i > 8 ? 0.42 : 0), c.z);
    ends.push(g);
  }
  world.addStaticGeometry(m.woodLight, mergeGeometries(ends), false);
}

export function picketFence(world, m, { pts, h = 1.2 }) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az), yaw = -Math.atan2(bz - az, bx - ax);
    const n = Math.max(2, Math.round(len / 0.25));
    const gs = [];
    for (let k = 0; k <= n; k++) {
      if (k % 7 === 3 && Math.random() < 0.5) continue; // выпавшие штакетины
      const px = ax + ((bx - ax) * k) / n, pz = az + ((bz - az) * k) / n;
      const hh = h * (0.85 + Math.random() * 0.2);
      const g = new THREE.BoxGeometry(0.08, hh, 0.025); g.rotateY(yaw); g.translate(px, H(world, px, pz) + hh / 2 - 0.1, pz);
      gs.push(g);
    }
    for (const yy of [0.35, 0.85]) {
      const g = new THREE.BoxGeometry(len, 0.06, 0.04); g.rotateY(yaw);
      g.translate((ax + bx) / 2, (H(world, ax, az) + H(world, bx, bz)) / 2 + yy, (az + bz) / 2);
      gs.push(g);
    }
    world.addStaticGeometry(m.woodLight, mergeGeometries(gs), true);
    world.addBoxCollider({ x: (ax + bx) / 2, z: (az + bz) / 2, y0: Math.min(H(world, ax, az), H(world, bx, bz)) - 0.3, w: len, d: 0.1, h: h + 0.3, yaw, mat: 'wood', blocksBullet: false, blocksSight: false, cover: false });
  }
}

export function izba(world, m, { x, z, yaw = 0, w = 7, d = 5.5, seed = 1, smoke = true }) {
  const rnd = mulberry32(seed);
  const b = building(world, m, { x, z, yaw, w, d, h: 2.7, material: 'log', doors: [{ side: 's', at: -w / 4, width: 1.3 }], windows: 2, roof: 'gable', roofMat: rnd() < 0.5 ? m.roofTin : m.woodDark, interior: rnd() < 0.5 ? 'barracks' : 'office' });
  // наличники, печная труба, крыльцо
  const y0 = b.y0;
  const ch = l2w(x, z, yaw, w * 0.22, -0.4);
  world.addBox({ x: ch.x, z: ch.z, y0: y0 + 2.7, w: 0.6, d: 0.6, h: 2.4, yaw, material: m.brick || m.concreteDark, mat: 'concrete', snowTop: true, cover: false });
  const pc = l2w(x, z, yaw, -w / 4, d / 2 + 0.6);
  world.addBox({ x: pc.x, z: pc.z, y0: y0 - 0.3, w: 1.6, d: 1.1, h: 0.55, yaw, material: m.woodDark, mat: 'wood', pen: 30, snowTop: true });
  if (smoke && rnd() < 0.7) world.smokes.push(new THREE.Vector3(ch.x, y0 + 5.2, ch.z));
  const wp = l2w(x, z, yaw, w / 2 + 1.6, 0.5);
  woodpile(world, m, { x: wp.x, z: wp.z, yaw: yaw + Math.PI / 2 });
  return b;
}

export function village(world, m, { x, z, yaw = 0, n = 6, seed = 3, name }) {
  const rnd = mulberry32(seed);
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 1 : -1;
    const along = (Math.floor(i / 2) - (n / 4)) * 19;
    const c = l2w(x, z, yaw, along + (rnd() - 0.5) * 3, side * (11 + rnd() * 3));
    const hy = yaw + (side > 0 ? Math.PI : 0) + (rnd() - 0.5) * 0.15;
    izba(world, m, { x: c.x, z: c.z, yaw: hy, w: 6 + rnd() * 2.5, d: 5 + rnd() * 1.5, seed: seed * 10 + i, smoke: rnd() < 0.5 });
    // палисадник
    const f0 = l2w(c.x, c.z, hy, -5.5, 4.5), f1 = l2w(c.x, c.z, hy, 5.5, 4.5), f2 = l2w(c.x, c.z, hy, 5.5, 8.5), f3 = l2w(c.x, c.z, hy, -5.5, 8.5);
    if (rnd() < 0.8) picketFence(world, m, { pts: [[f3.x, f3.z], [f0.x, f0.z], [f1.x, f1.z], [f2.x, f2.z]] });
  }
  // сарай, колодец, брошенный транспорт
  const sh = l2w(x, z, yaw, (n / 4 + 0.6) * 19, -12);
  building(world, m, { x: sh.x, z: sh.z, yaw, w: 5, d: 4, h: 2.2, material: 'wood', doors: [{ side: 's', at: 0, width: 2.2 }], windows: 0, roof: 'flat', interior: 'warehouse' });
  const wl = l2w(x, z, yaw, 0, 0);
  world.addCyl({ x: wl.x + 3, z: wl.z, y0: H(world, wl.x + 3, wl.z), r: 0.55, h: 0.9, material: m.log, mat: 'wood', pen: 40, snowTop: true, segments: 12 });
  const wr = l2w(x, z, yaw, -(n / 4 + 0.8) * 19, 5);
  wreck(world, m, { x: wr.x, z: wr.z, yaw: yaw + 0.4 });
  if (name) {
    const sg = l2w(x, z, yaw, -(n / 4 + 1.5) * 19, -6);
    world.signs.push({ x: sg.x, z: sg.z, yaw: yaw + Math.PI / 2, text: name });
  }
}

export function powerLine(world, m, { pts, spacing = 45, broken = 0.15 }) {
  const poles = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / spacing));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) poles.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  const top = [];
  const rnd = mulberry32(poles.length * 7);
  poles.forEach(([x, z], i) => {
    const next = poles[Math.min(poles.length - 1, i + 1)], prev = poles[Math.max(0, i - 1)];
    const yaw = -Math.atan2(next[1] - prev[1], next[0] - prev[0]) + Math.PI / 2;
    const y0 = H(world, x, z);
    const fallen = rnd() < broken;
    const tilt = fallen ? 0.35 : (rnd() - 0.5) * 0.06;
    const pole = new THREE.CylinderGeometry(0.11, 0.15, 8.5, 8);
    pole.translate(0, 4.25, 0); pole.rotateX(tilt); pole.rotateY(yaw); pole.translate(x, y0 - 0.3, z);
    const arm = new THREE.BoxGeometry(2.2, 0.14, 0.14); arm.translate(0, 7.8, 0); arm.rotateX(tilt); arm.rotateY(yaw); arm.translate(x, y0 - 0.3, z);
    world.addStaticGeometry(m.woodDark, mergeGeometries([pole, arm]), true);
    world.addCylCollider({ x, z, y0, r: 0.16, h: 7, mat: 'wood', pen: 90, cover: false });
    top.push(fallen ? null : new THREE.Vector3(x, y0 + 7.5, z).add(new THREE.Vector3(0, 0, 0)), yaw);
  });
  // провода с провисом
  const segs = [];
  for (let i = 0; i < top.length - 2; i += 2) {
    const a = top[i], b = top[i + 2];
    if (!a || !b) continue;
    const ya = top[i + 1], yb = top[i + 3];
    for (const off of [-0.95, 0, 0.95]) {
      const A = a.clone().add(new THREE.Vector3(Math.cos(ya) * off, 0.3, -Math.sin(ya) * off));
      const B = b.clone().add(new THREE.Vector3(Math.cos(yb) * off, 0.3, -Math.sin(yb) * off));
      const L = A.distanceTo(B);
      let prevP = A;
      for (let k = 1; k <= 10; k++) {
        const t = k / 10;
        const P = A.clone().lerp(B, t); P.y -= Math.sin(t * Math.PI) * L * 0.035;
        segs.push(prevP.x, prevP.y, prevP.z, P.x, P.y, P.z); prevP = P;
      }
    }
  }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
  const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x1c1c1c }));
  world.scene.add(lines);
}

export function pipeline(world, m, { pts, r = 0.55, height = 1.1 }) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az), yaw = -Math.atan2(bz - az, bx - ax);
    const n = Math.max(1, Math.round(len / 12));
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
      const y0 = Math.max(H(world, x0, z0), H(world, x1, z1)) + height;
      const seg = new THREE.CylinderGeometry(r, r, len / n + 0.02, 14);
      seg.rotateZ(Math.PI / 2); seg.rotateY(yaw); seg.translate((x0 + x1) / 2, y0 + r, (z0 + z1) / 2);
      world.addStaticGeometry(m.white, seg, true);
      const cap = new THREE.BoxGeometry(len / n, 0.08, r * 1.3); cap.rotateY(yaw); cap.translate((x0 + x1) / 2, y0 + r * 2 + 0.02, (z0 + z1) / 2);
      world.addStaticGeometry(m.snow, cap, false);
      world.addBoxCollider({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, y0: y0, w: len / n, d: r * 2, h: r * 2, yaw, mat: 'metal', pen: 12 });
      // опора
      const gy = H(world, x0, z0);
      const sup = new THREE.BoxGeometry(0.25, y0 - gy + 0.3, 1.6); sup.rotateY(yaw); sup.translate(x0, (y0 + gy) / 2, z0);
      world.addStaticGeometry(m.metalRust, sup, true);
      world.addBoxCollider({ x: x0, z: z0, y0: gy, w: 0.25, d: 1.6, h: y0 - gy, yaw, mat: 'metal', pen: 6, cover: false });
    }
  }
}

export function truckWreck(world, m, { x, z, yaw = 0, burnt = true }) {
  const mat = burnt ? m.metalRust : m.metalGreen;
  const y0 = H(world, x, z);
  const P = (lx, lz) => l2w(x, z, yaw, lx, lz);
  let c = P(-2.6, 0);
  world.addBox({ x: c.x, z: c.z, y0: y0 + 0.9, w: 1.6, d: 2.3, h: 1.4, yaw, material: mat, mat: 'metal', pen: 3, snowTop: true });
  c = P(-3.7, 0);
  world.addBox({ x: c.x, z: c.z, y0: y0 + 0.8, w: 0.9, d: 2.0, h: 0.9, yaw, material: mat, mat: 'metal', pen: 3, snowTop: true });
  c = P(0.9, 0);
  world.addBox({ x: c.x, z: c.z, y0: y0 + 1.1, w: 4.6, d: 2.4, h: 0.2, yaw, material: mat, mat: 'metal', pen: 3, snowTop: true });
  for (const s of [-1, 1]) {
    c = P(0.9, s * 1.17);
    world.addBox({ x: c.x, z: c.z, y0: y0 + 1.3, w: 4.6, d: 0.06, h: 0.7, yaw, material: m.woodDark, mat: 'wood', pen: 15 });
    for (const lx of [-3.3, 0.2, 1.6]) {
      const w = l2w(x, z, yaw, lx, s * 1.0);
      const g = new THREE.CylinderGeometry(0.55, 0.55, 0.4, 14); g.rotateX(Math.PI / 2); g.rotateY(yaw); g.translate(w.x, y0 + 0.45, w.z);
      world.addStaticGeometry(m.dark, g, true);
    }
  }
  c = P(-0.5, 0);
  world.addBoxCollider({ x: c.x, z: c.z, y0, w: 7, d: 2.4, h: 2.3, yaw, mat: 'metal', pen: 3 });
}

export function chum(world, m, { x, z, seed = 1 }) {
  const rnd = mulberry32(seed);
  const y0 = H(world, x, z);
  const cone = new THREE.CylinderGeometry(0.25, 2.7, 4.3, 14, 1, true); cone.translate(x, y0 + 2.15, z);
  world.addStaticGeometry(m.hide, cone, true);
  const poles = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const g = new THREE.CylinderGeometry(0.03, 0.04, 6, 5);
    g.translate(0, 3, 0); g.rotateZ(0.55); g.rotateY(a); g.translate(x + Math.cos(a) * 1.6, y0 - 0.2, z - Math.sin(a) * 1.6);
    poles.push(g);
  }
  world.addStaticGeometry(m.woodDark, mergeGeometries(poles), true);
  world.addCylCollider({ x, z, y0, r: 2.3, h: 3, mat: 'wood', pen: 10, blocksBullet: false });
  // нарты
  const sl = l2w(x, z, rnd() * 6, 4.5, 0);
  world.addBox({ x: sl.x, z: sl.z, y0, w: 2.6, d: 0.9, h: 0.45, yaw: rnd() * 3, material: m.woodLight, mat: 'wood', pen: 20 });
  world.smokes.push(new THREE.Vector3(x, y0 + 4.5, z));
}

export function ruin(world, m, { x, z, yaw = 0, w = 14, d = 9, seed = 2 }) {
  const rnd = mulberry32(seed);
  const y0 = H(world, x, z);
  const walls = [[-w / 2, -d / 2, w / 2, -d / 2], [w / 2, -d / 2, w / 2, d / 2], [w / 2, d / 2, -w / 2, d / 2], [-w / 2, d / 2, -w / 2, -d / 2]];
  for (const [ax, az, bx, bz] of walls) {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.round(len / 1.5);
    for (let k = 0; k < n; k++) {
      if (rnd() < 0.18) continue;
      const t = (k + 0.5) / n;
      const lx = ax + (bx - ax) * t, lz = az + (bz - az) * t;
      const c = l2w(x, z, yaw, lx, lz);
      const hh = 0.6 + rnd() * rnd() * 3.4;
      const wy = yaw - Math.atan2(bz - az, bx - ax);
      world.addBox({ x: c.x, z: c.z, y0: y0 - 0.3, w: len / n + 0.02, d: 0.35, h: hh + 0.3, yaw: wy, material: m.concrete, mat: 'concrete', snowTop: true });
    }
  }
  for (let i = 0; i < 7; i++) {
    const c = l2w(x, z, yaw, (rnd() - 0.5) * w, (rnd() - 0.5) * d);
    world.addBox({ x: c.x, z: c.z, y0: y0 - 0.2, w: 0.6 + rnd() * 1.4, d: 0.5 + rnd(), h: 0.3 + rnd() * 0.7, yaw: rnd() * 3, material: m.concreteDark, mat: 'concrete', snowTop: true });
  }
}

export function hummocks(world, m, { x0, x1, z, n = 40, seed = 4 }) {
  const rnd = mulberry32(seed);
  const ice = m.iceBlock || (m.iceBlock = new THREE.MeshStandardMaterial({ color: 0xcfe2ee, roughness: 0.25, metalness: 0.05 }));
  for (let i = 0; i < n; i++) {
    const x = x0 + rnd() * (x1 - x0), zz = z + (rnd() - 0.5) * 30;
    if (world.terrain.heightAt(x, zz) > 0.5) continue;
    const g = new THREE.BoxGeometry(1 + rnd() * 3, 0.5 + rnd() * 2, 1 + rnd() * 2.5);
    g.rotateX((rnd() - 0.5) * 0.9); g.rotateZ((rnd() - 0.5) * 0.9); g.rotateY(rnd() * 3);
    g.translate(x, 0.2, zz);
    world.addStaticGeometry(ice, g, true);
  }
}

// Полосатые вешки вдоль дороги — характерная примета северных дорог
export function roadPoles(world, m, { pts, step = 30, offset = 5.5 }) {
  const mat = m.pole || (m.pole = new THREE.MeshStandardMaterial({ map: (() => {
    const c = document.createElement('canvas'); c.width = 8; c.height = 64; const g = c.getContext('2d');
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#f0f0f0' : '#c02018'; g.fillRect(0, i * 8, 8, 8); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })(), roughness: 0.7 }));
  const gs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const nx = -(bz - az) / len, nz = (bx - ax) / len;
    for (let d = 0; d < len; d += step) {
      for (const s of [-1, 1]) {
        const x = ax + ((bx - ax) * d) / len + nx * offset * s, z = az + ((bz - az) * d) / len + nz * offset * s;
        if (Math.hypot(x, z) > 1080) continue;
        const g = new THREE.CylinderGeometry(0.04, 0.04, 2, 5); g.translate(x, H(world, x, z) + 0.9, z);
        gs.push(g);
      }
    }
  }
  if (gs.length) world.addStaticGeometry(mat, mergeGeometries(gs), false);
}
