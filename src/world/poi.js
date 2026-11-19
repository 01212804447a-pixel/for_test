// Точки интереса: заброшенные посёлки с избами, ЛЭП, трубопровод на опорах,
// остовы грузовиков, чумы оленеводов, руины, торосы, вешки вдоль дорог.
import * as THREE from 'three';
import { building, l2w, crates, barrels, wreck } from './structures.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/math.js';

const H = (world, x, z) => world.terrain.heightAt(x, z);

export function woodpile(world, m, { x, z, yaw = 0 }) {
  const y0 = H(world, x, z);
  world.addBox({ x, z, y0, w: 2.4, d: 1.0, h: 1.15, yaw, material: m.woodDark, mat: 'wood', pen: 16, snowTop: true });
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
  // штакетник: пролёты валятся от взрыва и наезда
  world.destr.addFence(pts, { kind: 'picket', h, secLen: 2.4, terrain: world.terrain, mats: { post: m.woodDark, board: m.woodLight } });
}

export function izba(world, m, { x, z, yaw = 0, w = 7, d = 5.5, seed = 1, smoke = true }) {
  const rnd = mulberry32(seed);
  const b = building(world, m, { x, z, yaw, w, d, h: 2.7, material: 'log', doors: [{ side: 's', at: -w / 4, width: 1.3 }], windows: 2, roof: 'gable', roofMat: rnd() < 0.5 ? m.roofTin : m.woodDark, interior: rnd() < 0.5 ? 'barracks' : 'office' });
  // наличники, печная труба, крыльцо
  const y0 = b.y0;
  const ch = l2w(x, z, yaw, w * 0.22, -0.4);
  world.addBox({ x: ch.x, z: ch.z, y0: y0 + 2.7, w: 0.6, d: 0.6, h: 2.4, yaw, material: m.brick || m.concreteDark, mat: 'concrete', snowTop: true, cover: false });
  const pc = l2w(x, z, yaw, -w / 4, d / 2 + 0.6);
  world.addBox({ x: pc.x, z: pc.z, y0: y0 - 0.3, w: 1.6, d: 1.1, h: 0.55, yaw, material: m.woodDark, mat: 'wood', pen: 5, snowTop: true });
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
  // кирпичные дома в конце улицы: целый и полуразрушенный (если место свободно)
  for (const [k, sgn] of [[0, 1], [1, -1]]) {
    const c = l2w(x, z, yaw, sgn * (n / 4 + 1.3) * 19, 13);
    if (freeSpot(world, c.x, c.z, 7)) brickHouse(world, m, { x: c.x, z: c.z, yaw: yaw + Math.PI, w: 8.5, d: 6.5, seed: seed * 7 + k, ruin: k ? 0.6 + rnd() * 0.25 : rnd() * 0.3 });
  }
  // сарай, колодец, брошенный транспорт
  const sh = l2w(x, z, yaw, (n / 4 + 0.6) * 19, -12);
  building(world, m, { x: sh.x, z: sh.z, yaw, w: 5, d: 4, h: 2.2, material: 'wood', doors: [{ side: 's', at: 0, width: 2.2 }], windows: 0, roof: 'flat', interior: 'warehouse' });
  const wl = l2w(x, z, yaw, 0, 0);
  world.addCyl({ x: wl.x + 3, z: wl.z, y0: H(world, wl.x + 3, wl.z), r: 0.55, h: 0.9, material: m.log, mat: 'wood', pen: 8, snowTop: true, segments: 12 });
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
    world.addCylCollider({ x, z, y0, r: 0.16, h: 7, mat: 'wood', pen: 14, cover: false });
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
      world.addBoxCollider({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, y0: y0, w: len / n, d: r * 2, h: r * 2, yaw, mat: 'metal', pen: 8 });
      // опора
      const gy = H(world, x0, z0);
      const sup = new THREE.BoxGeometry(0.25, y0 - gy + 0.3, 1.6); sup.rotateY(yaw); sup.translate(x0, (y0 + gy) / 2, z0);
      world.addStaticGeometry(m.metalRust, sup, true);
      world.addBoxCollider({ x: x0, z: z0, y0: gy, w: 0.25, d: 1.6, h: y0 - gy, yaw, mat: 'metal', pen: 4, cover: false });
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
    world.addBox({ x: c.x, z: c.z, y0: y0 + 1.3, w: 4.6, d: 0.06, h: 0.7, yaw, material: m.woodDark, mat: 'wood', pen: 3 });
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
  world.addCylCollider({ x, z, y0, r: 2.3, h: 3, mat: 'wood', pen: 1, blocksBullet: false });
  // нарты
  const sl = l2w(x, z, rnd() * 6, 4.5, 0);
  world.addBox({ x: sl.x, z: sl.z, y0, w: 2.6, d: 0.9, h: 0.45, yaw: rnd() * 3, material: m.woodLight, mat: 'wood', pen: 4 });
  world.smokes.push(new THREE.Vector3(x, y0 + 4.5, z));
}

// Свободное ровное место под постройку: нет препятствий, не дорога и не лёд, перепад невелик
export function freeSpot(world, x, z, r) {
  const T = world.terrain, mk = T.maskAt(x, z);
  if (mk === 1 || mk === 2) return false;
  if (T.hasSea && T.heightAt(x, z) < 1.5) return false;
  let ok = true;
  world._cellsAround(x, z, r, (o) => { if (ok && o.blocksMove !== false && world.pointObstacleDist(o, x, z) < r) ok = false; });
  if (!ok) return false;
  let lo = 1e9, hi = -1e9;
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) { const h = T.heightAt(x + dx * r * 0.7, z + dz * r * 0.7); lo = Math.min(lo, h); hi = Math.max(hi, h); }
  return hi - lo < Math.max(1.2, r * 0.18);
}

// Развалины кирпичного дома: стены с выкрошенным верхом и проломами (разрушаемые дальше),
// без крыши и перекрытий, кирпичный бой и упавшие плиты
export function ruin(world, m, { x, z, yaw = 0, w = 14, d = 9, seed = 2, level, material }) {
  const rnd = mulberry32(seed * 7 + 3);
  const lv = level ?? 0.55 + rnd() * 0.35;
  const two = w >= 12 && rnd() < 0.6;
  const mat = material || (rnd() < 0.7 ? 'brick' : 'brickWhite');
  const b = building(world, m, { x, z, yaw, w, d, h: two ? 5.6 : 3.0, material: mat, doors: [{ side: 's', at: -w / 4, width: 1.6 }, { side: 'n', at: w / 5, width: 1.4 }], windows: w > 11 ? 3 : 2, roof: 'none', interior: 'none', ruin: lv, seed });
  // обрушившиеся плиты перекрытия внутри
  for (let i = 0; i < (two ? 3 : 1); i++) {
    const c = l2w(x, z, yaw, (rnd() - 0.5) * (w - 3), (rnd() - 0.5) * (d - 3));
    world.addBox({ x: c.x, z: c.z, y0: b.y0 - 0.1, w: 2.6 + rnd() * 1.4, d: 1.0 + rnd() * 0.4, h: 0.22 + rnd() * 0.3, yaw: yaw + (rnd() - 0.5) * 0.8, material: m.concreteDark, mat: 'concrete', pen: 25, snowTop: true });
  }
  return b;
}

// Кирпичный дом: целый (ruin 0), повреждённый (0,15–0,45 — выбиты стёкла, проломы)
// или полуразрушенный (> 0,5 — без крыши). Стены разрушаемые, стёкла бьются.
export function brickHouse(world, m, { x, z, yaw = 0, w = 8, d = 6.5, seed = 1, ruin = 0, material }) {
  const rnd = mulberry32(seed * 31 + 5);
  const mat = material || (rnd() < 0.35 ? 'brickWhite' : 'brick');
  const b = building(world, m, { x, z, yaw, w, d, h: 2.9, material: mat, doors: [{ side: 's', at: -w / 4, width: 1.3 }], windows: w > 9 ? 3 : 2, roof: ruin > 0.5 ? 'none' : 'gable', roofMat: rnd() < 0.6 ? m.roofTin : m.metalGrey, interior: ruin > 0.5 ? 'none' : rnd() < 0.5 ? 'office' : 'barracks', ruin, seed });
  if (ruin <= 0.5) {
    const ch = l2w(x, z, yaw, w * 0.25, -0.6);
    world.addBox({ x: ch.x, z: ch.z, y0: b.y0 + 2.9, w: 0.55, d: 0.55, h: 2.1, yaw, material: m.brick || m.concreteDark, mat: 'brick', pen: 30, snowTop: true, cover: false });
  }
  const st = l2w(x, z, yaw, -w / 4, d / 2 + 0.55);
  world.addBox({ x: st.x, z: st.z, y0: b.y0 - 0.4, w: 1.8, d: 0.9, h: 0.55, yaw, material: m.concrete, mat: 'concrete', pen: 30, snowTop: true });
  return b;
}

// Дощатый забор (сплошной): пролёты падают от разрыва или наезда техники
export function boardFence(world, m, { pts, h = 1.8 }) {
  world.destr.addFence(pts, { kind: 'board', h, secLen: 2.5, terrain: world.terrain, mats: { post: m.woodDark, board: m.wood } });
}
export function chainFence(world, m, { pts, h = 2.0 }) {
  world.destr.addFence(pts, { kind: 'chain', h, secLen: 3, terrain: world.terrain, mats: { post: m.metalGrey, board: m.metalGrey } });
}

// Прямоугольник забора вокруг участка (с проёмом-воротами на южной стороне)
function yardFence(world, m, x, z, yaw, w, d, kind, rnd) {
  const c = (lx, lz) => { const p = l2w(x, z, yaw, lx, lz); return [p.x, p.z]; };
  const gate = (rnd() - 0.5) * (w - 6);
  const runs = [[c(gate - 2, d / 2), c(-w / 2, d / 2), c(-w / 2, -d / 2), c(w / 2, -d / 2), c(w / 2, d / 2), c(gate + 2, d / 2)]];
  for (const pts of runs) {
    // часть пролётов уже повалена временем
    if (kind === 'board') boardFence(world, m, { pts });
    else if (kind === 'chain') chainFence(world, m, { pts });
    else picketFence(world, m, { pts });
  }
}

// Хутор: 1–2 дома (изба или кирпичный), двор с забором, сарай, поленница
export function hamlet(world, m, { x, z, yaw = 0, seed = 1 }) {
  const rnd = mulberry32(seed * 131 + 17);
  const brick = rnd() < 0.5;
  const ruin = rnd() < 0.35 ? 0.55 + rnd() * 0.3 : rnd() < 0.5 ? 0.2 + rnd() * 0.2 : 0;
  if (brick) brickHouse(world, m, { x, z, yaw, w: 7.5 + rnd() * 2.5, d: 6 + rnd(), seed, ruin });
  else if (ruin > 0.5) ruin_(world, m, x, z, yaw, seed);
  else izba(world, m, { x, z, yaw, w: 6.5 + rnd() * 2, d: 5.5 + rnd(), seed, smoke: false });
  const sh = l2w(x, z, yaw, 9 + rnd() * 3, -4);
  building(world, m, { x: sh.x, z: sh.z, yaw: yaw + Math.PI / 2, w: 4.5, d: 3.6, h: 2.2, material: 'wood', doors: [{ side: 's', at: 0, width: 2.0 }], windows: 0, roof: 'flat', interior: 'warehouse', ruin: ruin > 0.5 ? 0.4 : 0, seed: seed + 3 });
  yardFence(world, m, x + 0, z + 0, yaw, 26 + rnd() * 6, 20 + rnd() * 4, rnd() < 0.5 ? 'board' : 'picket', rnd);
  const wp = l2w(x, z, yaw, -8, -5);
  woodpile(world, m, { x: wp.x, z: wp.z, yaw: yaw + 0.3 });
  if (rnd() < 0.5) { const wr = l2w(x, z, yaw, 4, 14); wreck(world, m, { x: wr.x, z: wr.z, yaw: yaw + rnd() * 2 }); }
}
function ruin_(world, m, x, z, yaw, seed) { return ruin(world, m, { x, z, yaw, w: 9, d: 7, seed }); }

// Заброшенная ферма (МТФ): длинный кирпичный коровник без крыши, контора из белого кирпича,
// сплошной забор, сеновал, брошенная техника
export function farm(world, m, { x, z, yaw = 0, seed = 1 }) {
  const rnd = mulberry32(seed * 57 + 9);
  ruin(world, m, { x, z, yaw, w: 26, d: 10, seed: seed + 1, level: 0.45 + rnd() * 0.25, material: 'brick' });
  const of = l2w(x, z, yaw, -6, 18);
  brickHouse(world, m, { x: of.x, z: of.z, yaw: yaw + Math.PI, w: 9, d: 6.5, seed: seed + 2, ruin: 0.2 + rnd() * 0.25, material: 'brickWhite' });
  const sh = l2w(x, z, yaw, 18, 14);
  building(world, m, { x: sh.x, z: sh.z, yaw, w: 8, d: 6, h: 3.2, material: 'wood', doors: [{ side: 's', at: 0, width: 3.0 }], windows: 0, roof: 'gable', roofMat: m.roofTin, interior: 'warehouse', ruin: 0.3, seed: seed + 4 });
  yardFence(world, m, x + 0, z + 0, yaw, 64, 52, 'board', rnd);
  const wr = l2w(x, z, yaw, 10, -12);
  wreck(world, m, { x: wr.x, z: wr.z, yaw: yaw + 1.1 });
  const tw = l2w(x, z, yaw, -20, 12);
  truckWreck(world, m, { x: tw.x, z: tw.z, yaw: yaw - 0.6, burnt: rnd() < 0.5 });
  const wp = l2w(x, z, yaw, 24, 2);
  woodpile(world, m, { x: wp.x, z: wp.z, yaw });
}

// Разрушенный посёлок: несколько кирпичных коробок разной степени разрушения
export function ruinedBlock(world, m, { x, z, yaw = 0, seed = 1 }) {
  const rnd = mulberry32(seed * 19 + 1);
  const spots = [[0, 0, 14, 9], [22, 6, 9, 7], [-20, 8, 10, 8], [6, 24, 12, 8], [-14, -18, 8, 6.5]];
  spots.forEach(([lx, lz, w, d], i) => {
    const c = l2w(x, z, yaw, lx, lz), y2 = yaw + (rnd() - 0.5) * 0.3;
    if (i === 4 || rnd() < 0.25) brickHouse(world, m, { x: c.x, z: c.z, yaw: y2, w: Math.min(w, 9), d: Math.min(d, 7), seed: seed * 10 + i, ruin: 0.25 + rnd() * 0.2 });
    else ruin(world, m, { x: c.x, z: c.z, yaw: y2, w, d, seed: seed * 10 + i, level: 0.5 + rnd() * 0.45 });
  });
  const f0 = l2w(x, z, yaw, -26, -10), f1 = l2w(x, z, yaw, -26, 22), f2 = l2w(x, z, yaw, -8, 30);
  boardFence(world, m, { pts: [[f0.x, f0.z], [f1.x, f1.z], [f2.x, f2.z]] });
  const g0 = l2w(x, z, yaw, 14, -14), g1 = l2w(x, z, yaw, 34, -10);
  chainFence(world, m, { pts: [[g0.x, g0.z], [g1.x, g1.z]] });
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
