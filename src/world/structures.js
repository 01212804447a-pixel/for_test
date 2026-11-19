// Строения и объекты уровня: казармы, вышки, мешки, контейнеры, цистерны,
// камни, ели, РЛС, бункеры, мишени полигона.
import * as THREE from 'three';
import { woodTexture, concreteTexture, metalTexture, rockTexture, textTexture, targetTexture, logTexture, brickTexture } from './textures.js';
import { boxGeo, SNOW_MAT } from './world.js';
import { mulberry32 } from '../core/math.js';
import { spruceGeometry, birchGeometry, spruceMaterial } from './flora.js';
import { pbr, hasAssets } from '../core/assets.js';

export function makeMats() {
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...o });
  const P = (name, o, fb) => pbr(name, o) || fb;
  const base = makeMatsProc(std);
  if (!hasAssets()) return base;
  return {
    ...base,
    wood: P('brown_planks_05', {}, base.wood),
    woodDark: P('brown_planks_05', { color: 0x8a7a6c }, base.woodDark),
    woodLight: P('wood_peeling_paint_weathered', {}, base.woodLight),
    concrete: P('chipped_concrete', {}, base.concrete),
    concreteDark: P('chipped_concrete', { color: 0x9a9a9a }, base.concreteDark),
    metalGreen: P('green_metal_rust', { metalness: 0.5 }, base.metalGreen),
    metalRust: P('rusty_metal_02', { metalness: 0.6 }, base.metalRust),
    metalGrey: P('corrugated_iron_02', { metalness: 0.6 }, base.metalGrey),
    contRed: P('corrugated_iron_02', { color: 0xb5503c, metalness: 0.45 }, base.contRed),
    contBlue: P('corrugated_iron_02', { color: 0x46709c, metalness: 0.45 }, base.contBlue),
    contGreen: P('corrugated_iron_02', { color: 0x5b7a52, metalness: 0.45 }, base.contGreen),
    white: P('corrugated_iron_02', { color: 0xf0f2f4, metalness: 0.3 }, base.white),
    roofTin: P('corrugated_iron_02', { color: 0xc8c8c8, metalness: 0.55 }, base.roofTin),
    sandbag: P('gravel', { color: 0xd8cca8, normalScale: 1.5 }, base.sandbag),
    rock: P('aerial_rocks_02', { vertexColors: true }, base.rock),
  };
}

function brickMat(kind) {
  const t = brickTexture(kind);
  const m = new THREE.MeshStandardMaterial({ map: t.map, bumpMap: t.bump, bumpScale: 1.6, roughness: 0.92, metalness: 0 });
  m.map = t.map.clone(); m.map.needsUpdate = true; m.map.repeat.set(1 / 1.5, 1 / 1.5);
  m.bumpMap = t.bump.clone(); m.bumpMap.needsUpdate = true; m.bumpMap.repeat.set(1 / 1.5, 1 / 1.5);
  return m;
}

function makeMatsProc(std) {
  return {
    wood: std({ map: woodTexture(0) }),
    woodDark: std({ map: woodTexture(1) }),
    woodLight: std({ map: woodTexture(2) }),
    concrete: std({ map: concreteTexture(), roughness: 0.95 }),
    concreteDark: std({ map: concreteTexture(), color: 0x8a8a8a, roughness: 0.95 }),
    metalGreen: std({ map: metalTexture('#55623f', 0.25), metalness: 0.4, roughness: 0.6 }),
    metalRust: std({ map: metalTexture('#6b5444', 0.7, 'r'), metalness: 0.35, roughness: 0.75 }),
    metalGrey: std({ map: metalTexture('#7d8288', 0.15, 'g'), metalness: 0.5, roughness: 0.5 }),
    contRed: std({ map: metalTexture('#8a3a2c', 0.35, 'c1'), metalness: 0.3, roughness: 0.7 }),
    contBlue: std({ map: metalTexture('#2f4f72', 0.35, 'c2'), metalness: 0.3, roughness: 0.7 }),
    contGreen: std({ map: metalTexture('#3f5a3a', 0.35, 'c3'), metalness: 0.3, roughness: 0.7 }),
    white: std({ map: metalTexture('#d8dcdf', 0.1, 'w'), metalness: 0.2, roughness: 0.6 }),
    sandbag: std({ map: concreteTexture(), color: 0xc9bd98, roughness: 1 }),
    rock: std({ map: rockTexture(), vertexColors: true, roughness: 0.95 }),
    spruce: spruceMaterial(),
    log: std({ map: logTexture() }),
    roofTin: std({ map: metalTexture('#5d6266', 0.45, 'tin'), metalness: 0.45, roughness: 0.6 }),
    hide: std({ color: 0x6b5a48, roughness: 1, side: THREE.DoubleSide }),
    dark: std({ color: 0x1b1d20, roughness: 0.8 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x1a2430, roughness: 0.1, metalness: 0.6 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xfff1c0, emissive: 0xffd890, emissiveIntensity: 2 }),
    snow: SNOW_MAT(),
    wire: new THREE.MeshStandardMaterial({ color: 0x444444, transparent: true, opacity: 0.35, roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide }),
    brick: brickMat('red'),
    brickWhite: brickMat('white'),
    plaster: std({ map: concreteTexture(), color: 0xd9d2c2, roughness: 0.95 }),
  };
}

export const l2w = (cx, cz, yaw, lx, lz) => ({
  x: cx + Math.cos(yaw) * lx + Math.sin(yaw) * lz,
  z: cz - Math.sin(yaw) * lx + Math.cos(yaw) * lz,
});

// Стена с проёмами вдоль локальной оси X от a до b, на смещении lz.
// Участки стены — разрушаемые (плитки), в окнах — стёкла.
function wall(world, cx, cz, yaw, y0, a, b, lz, h, th, openings, mat, opts, frameMat) {
  const ops = openings.slice().sort((p, q) => p.at - q.at);
  const D = world.destr;
  let cur = a;
  const seg = (from, to, yb, yt) => {
    const len = to - from;
    if (len < 0.05 || yt - yb < 0.05) return;
    const c = l2w(cx, cz, yaw, (from + to) / 2, lz);
    if (D && D.cur) D.addWall({ cx: c.x, cz: c.z, yaw, y0, len, yb: Math.max(yb, -0.4), yt, th, material: mat, mat: opts.dmat || opts.mat, pen: opts.pen, u0: from - a, texScale: opts.texScale || 2 });
    else world.addBox({ x: c.x, z: c.z, y0: y0 + yb, w: len, d: th, h: yt - yb, yaw, material: mat, ...opts });
  };
  for (const o of ops) {
    const s = o.at - o.width / 2, e = o.at + o.width / 2;
    seg(cur, s, -1, h);
    seg(s, e, -1, o.bottom);
    seg(s, e, o.top, h);
    if (frameMat) {
      // наличники/рамы проёмов
      const fw = 0.07, fd = th + 0.06;
      const fr = (lx, yb, w, hh) => { const c = l2w(cx, cz, yaw, lx, lz); world.addBox({ x: c.x, z: c.z, y0: y0 + yb, w, d: fd, h: hh, yaw, material: frameMat, collide: false, castShadow: false }); };
      fr(s - fw / 2, Math.max(0, o.bottom), fw, o.top - Math.max(0, o.bottom));
      fr(e + fw / 2, Math.max(0, o.bottom), fw, o.top - Math.max(0, o.bottom));
      fr((s + e) / 2, o.top, e - s + fw * 2, fw);
      if (o.bottom > 0) { fr((s + e) / 2, o.bottom - fw, e - s + fw * 2, fw); fr((s + e) / 2, (o.bottom + o.top) / 2, fw * 0.6, o.top - o.bottom); }
    }
    // стекло (окна; в разрушенных домах — уже выбито)
    if (o.bottom > 0 && D && D.cur && !o.noGlass) {
      const c = l2w(cx, cz, yaw, (s + e) / 2, lz);
      D.addPane({ cx: c.x, cz: c.z, yaw, y0: y0 + o.bottom, w: e - s - 0.04, h: o.top - o.bottom });
    }
    cur = e;
  }
  seg(cur, b, -1, h);
}

export function building(world, m, { x, z, yaw = 0, w = 10, d = 6, h = 3, material = 'wood', doors = [{ side: 's', at: 0 }], windows = 2, roof = 'gable', interior = 'barracks', groundY, roofMat, ruin = 0, seed = 0 }) {
  const y0 = groundY ?? world.terrain.heightAt(x, z);
  const D = world.destr;
  if (D) D.beginBuilding();
  const isWood = material === 'wood' || material === 'log';
  const isBrick = material === 'brick' || material === 'brickWhite';
  const mat = material === 'log' ? m.log : isWood ? m.wood : isBrick ? (material === 'brick' ? m.brick : m.brickWhite) : m.concrete;
  const frameMat = isWood ? m.woodLight : m.white;
  const th = material === 'log' ? 0.26 : isWood ? 0.22 : isBrick ? 0.38 : 0.32;
  // стойкость стены к пробитию, мм брони-эквивалента: дощатая ~3, бревенчатая ~7, кирпич 1,5 кирпича ~30, бетон ~38
  const pen = material === 'log' ? 7 : isWood ? 3 : isBrick ? th * 1000 * 0.08 : th * 1000 * 0.12;
  const opts = { mat: isWood ? 'wood' : isBrick ? 'brick' : 'concrete', dmat: material === 'log' ? 'log' : isWood ? 'wood' : isBrick ? 'brick' : 'concrete', pen, texScale: isBrick ? 1.5 : 2 };
  const sides = { s: [], n: [], e: [], w: [] };
  for (const dr of doors) sides[dr.side].push({ at: dr.at || 0, width: dr.width || 1.9, bottom: -1, top: 2.15 });
  // окна: по этажу на каждые ~2,8 м высоты (двухэтажные коробки — развалины без перекрытий)
  const floors = h > 5 ? 2 : 1;
  const addWins = (side, len) => {
    for (let f = 0; f < floors; f++) for (let i = 0; i < windows; i++) {
      const at = ((i + 1) / (windows + 1) - 0.5) * len;
      if (f === 0 && sides[side].some((o) => Math.abs(o.at - at) < 1.8)) continue;
      sides[side].push({ at, width: 1.2, bottom: 1.0 + f * 2.8, top: 1.9 + f * 2.8, noGlass: ruin > 0.15 });
    }
  };
  addWins('s', w); addWins('n', w);
  if (d > 7) { addWins('e', d); addWins('w', d); } else { sides.e.push(...[]); }
  // южная (+z) и северная (-z) стены — вдоль X
  wall(world, x, z, yaw, y0, -w / 2, w / 2, d / 2 - th / 2, h, th, sides.s, mat, opts, frameMat);
  wall(world, x, z, yaw, y0, -w / 2, w / 2, -d / 2 + th / 2, h, th, sides.n, mat, opts, frameMat);
  // восточная и западная — вдоль Z: поворот на 90°
  const yaw2 = yaw + Math.PI / 2;
  const ce = l2w(x, z, yaw, w / 2 - th / 2, 0), cw = l2w(x, z, yaw, -w / 2 + th / 2, 0);
  wall(world, ce.x, ce.z, yaw2, y0, -d / 2 + th, d / 2 - th, 0, h, th, sides.e.map((o) => ({ ...o, at: -o.at })), mat, opts, frameMat);
  wall(world, cw.x, cw.z, yaw2, y0, -d / 2 + th, d / 2 - th, 0, h, th, sides.w.map((o) => ({ ...o, at: -o.at })), mat, opts, frameMat);
  // пол
  world.addBox({ x, z, y0: y0 - 0.6, w: w - 0.1, d: d - 0.1, h: 0.62, yaw, material: m.woodDark, mat: 'wood', cover: false, castShadow: false });
  // крыша (в разрушенном доме её нет)
  const roofPiece = (material2, g, col) => { if (D && D.cur) D.addRoof(material2, g, col); else world.addStaticGeometry(material2, g, material2 !== m.snow); };
  if (ruin > 0.5) roof = 'none';
  if (roof === 'flat') {
    const g = boxGeo(w + 0.4, 0.25, d + 0.4, 2); g.rotateY(yaw); g.translate(x, y0 + h + 0.125, z);
    const col = world.addBoxCollider({ x, z, y0: y0 + h, w: w + 0.4, d: d + 0.4, h: 0.25, yaw, mat: opts.mat, pen: isWood ? 4 : 20, cover: false });
    roofPiece(isWood ? m.woodDark : m.concreteDark, g, col);
    const sg = boxGeo(w + 0.46, 0.08, d + 0.46, 2); sg.rotateY(yaw); sg.translate(x, y0 + h + 0.29, z);
    roofPiece(m.snow, sg);
  } else if (roof !== 'none') {
    const rh = Math.min(2.2, d * 0.35);
    const ang = Math.atan2(rh, d / 2);
    const slopeLen = Math.hypot(rh, d / 2) + 0.35;
    for (const sgn of [1, -1]) {
      const g = boxGeo(w + 0.6, 0.12, slopeLen, 2);
      g.rotateX(sgn * ang);
      const c = l2w(x, z, yaw, 0, sgn * d / 4);
      g.rotateY(yaw);
      g.translate(c.x, y0 + h + rh / 2, c.z);
      roofPiece(roofMat || m.metalGrey, g);
      const sg = boxGeo(w + 0.62, 0.06, slopeLen, 2);
      sg.translate(0, 0.08, 0);
      sg.rotateX(sgn * ang); sg.rotateY(yaw); sg.translate(c.x, y0 + h + rh / 2 + 0.02, c.z);
      roofPiece(m.snow, sg);
    }
    // фронтоны и коллайдер под крышей
    const col = world.addBoxCollider({ x, z, y0: y0 + h, w, d, h: rh * 0.6, yaw, mat: 'metal', pen: 1, cover: false, blocksMove: true });
    if (D && D.cur) D.cur.roofCols.push(col);
    for (const sgn of [1, -1]) {
      const shape = new THREE.Shape();
      shape.moveTo(-d / 2, 0); shape.lineTo(d / 2, 0); shape.lineTo(0, rh); shape.lineTo(-d / 2, 0);
      const g = new THREE.ExtrudeGeometry(shape, { depth: th, bevelEnabled: false });
      g.rotateY(Math.PI / 2);
      const c = l2w(x, z, yaw, sgn * (w / 2) - (sgn > 0 ? th : 0), 0);
      g.rotateY(yaw); g.translate(c.x, y0 + h, c.z);
      roofPiece(mat, g);
    }
  }
  const B = D ? D.endBuilding() : null;
  // развалины: выкрошенный неровный верх стен, проломы, кирпичный бой внутри и вокруг
  if (B && ruin > 0) {
    const rnd = mulberry32(seed * 977 + Math.floor(x * 3 + z * 7));
    for (const wl of B.walls) {
      // профиль обрушения: общий скат (один угол выше), плавные волны и редкие выбоины,
      // сглаженные по соседним столбцам — без «зубцов крепостной стены»
      const ph = rnd() * 10, tilt = (rnd() - 0.5) * 1.2, raw = [];
      for (let i = 0; i < wl.cols; i++) {
        const u = wl.cols > 1 ? i / (wl.cols - 1) - 0.5 : 0;
        raw.push(ruin * (0.55 + tilt * u + 0.35 * Math.sin(i * 0.45 + ph) * Math.sin(i * 0.17 + ph * 2)) + (rnd() < 0.15 ? rnd() * 0.3 : 0));
      }
      for (let i = 0; i < wl.cols; i++) {
        const a = raw[Math.max(0, i - 1)], b = raw[i], c = raw[Math.min(wl.cols - 1, i + 1)];
        const loss = Math.max(0, Math.min(0.95, (a + 2 * b + c) / 4));
        const cut = wl.rows - Math.round(loss * wl.rows);
        for (let j = Math.max(1, cut); j < wl.rows; j++) D.destroyTile(wl, j * wl.cols + i, null, 0, true);
      }
      const holes = Math.floor(ruin * 3 * rnd());
      for (let k = 0; k < holes; k++) {
        const ci = Math.floor(rnd() * wl.cols), cj = 1 + Math.floor(rnd() * Math.max(1, wl.rows - 2));
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const ii = ci + di, jj = cj + dj; if (ii >= 0 && ii < wl.cols && jj >= 0 && jj < wl.rows && rnd() < 0.8) D.destroyTile(wl, jj * wl.cols + ii, null, 0, true); }
      }
    }
    B.collapsed = true;
    const deb = isBrick ? (material === 'brick' ? m.brick : m.brickWhite) : isWood ? m.woodDark : m.concreteDark;
    for (let k = 0; k < 10 + ruin * 26; k++) {
      const inside = rnd() < 0.6;
      const lx = (rnd() - 0.5) * (inside ? w - 1 : w + 4), lz = (rnd() - 0.5) * (inside ? d - 1 : d + 4);
      const c = l2w(x, z, yaw, lx, lz);
      const big = rnd() < 0.3;
      world.addBox({ x: c.x, z: c.z, y0: world.terrain.heightAt(c.x, c.z) - 0.1, w: big ? 0.9 + rnd() : 0.3 + rnd() * 0.4, d: big ? 0.7 + rnd() * 0.8 : 0.2 + rnd() * 0.3, h: big ? 0.25 + rnd() * 0.35 : 0.12 + rnd() * 0.15, yaw: rnd() * 3, material: deb, collide: big, mat: opts.mat, pen: 20, snowTop: big && rnd() < 0.6, cover: false });
    }
  }
  // интерьер
  const rnd = mulberry32(Math.floor(x * 13 + z * 7));
  const furn = (lx, lz, fw, fd, fh, fm) => {
    const c = l2w(x, z, yaw, lx, lz);
    world.addBox({ x: c.x, z: c.z, y0: y0 + 0.02, w: fw, d: fd, h: fh, yaw, material: fm, mat: 'wood', pen: 4 });
  };
  if (interior === 'barracks') {
    const n = Math.floor((w - 2) / 1.6);
    for (let i = 0; i < n; i++) {
      const lx = -w / 2 + 1.4 + i * 1.6;
      if (rnd() < 0.8) furn(lx, -d / 2 + 1.2, 0.8, 1.9, 0.55, m.woodDark);
    }
    furn(0, 0.4, 1.8, 0.9, 0.78, m.wood);
  } else if (interior === 'office') {
    furn(-w / 4, -d / 2 + 0.8, 1.6, 0.8, 0.78, m.wood);
    furn(w / 4, -d / 2 + 0.5, 1.0, 0.5, 1.9, m.metalGrey);
    furn(w / 2 - 1, d / 4, 0.6, 1.2, 1.1, m.metalGreen);
  } else if (interior === 'warehouse') {
    for (let i = 0; i < 5; i++) furn(-w / 2 + 1.5 + rnd() * (w - 3), -d / 2 + 1 + rnd() * (d - 2), 1.2, 0.8, 0.8 + (rnd() > 0.5 ? 0.8 : 0), m.woodLight);
  }
  return { y0, x, z, yaw, w, d, h };
}

export function watchtower(world, m, { x, z, h = 5, yaw = 0 }) {
  const y0 = world.terrain.heightAt(x, z);
  const s = 1.4;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const c = l2w(x, z, yaw, sx * s, sz * s);
    world.addBox({ x: c.x, z: c.z, y0: y0 - 0.5, w: 0.2, d: 0.2, h: h + 0.5, yaw, material: m.woodDark, mat: 'wood', cover: false, blocksBullet: false, blocksSight: false });
  }
  // раскосы (визуально)
  for (let k = 0; k < 2; k++) {
    const g = boxGeo(0.08, 0.08, s * 2.9, 2);
    g.rotateX(Math.atan2(h * 0.8, s * 2) * (k ? 1 : -1));
    g.rotateY(yaw); const c = l2w(x, z, yaw, k ? s : -s, 0);
    g.translate(c.x, y0 + h * 0.45, c.z);
    world.addStaticGeometry(m.woodDark, g, true);
  }
  world.addBox({ x, z, y0: y0 + h, w: s * 2 + 0.6, d: s * 2 + 0.6, h: 0.15, yaw, material: m.wood, mat: 'wood', pen: 4, snowTop: false, cover: false });
  // бортики
  const bw = s * 2 + 0.6, rh = 1.05;
  for (const [lx, lz, ww, dd] of [[0, -bw / 2, bw, 0.08], [0, bw / 2, bw, 0.08], [-bw / 2, 0, 0.08, bw], [bw / 2, 0, 0.08, bw]]) {
    const c = l2w(x, z, yaw, lx, lz);
    world.addBox({ x: c.x, z: c.z, y0: y0 + h + 0.15, w: ww, d: dd, h: rh, yaw, material: m.wood, mat: 'wood', pen: 5, cover: false });
  }
  world.addBox({ x, z, y0: y0 + h + 2.3, w: bw + 0.4, d: bw + 0.4, h: 0.15, yaw, material: m.metalGrey, snowTop: true, mat: 'metal', cover: false });
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const c = l2w(x, z, yaw, sx * (bw / 2 - 0.05), sz * (bw / 2 - 0.05));
    world.addBox({ x: c.x, z: c.z, y0: y0 + h + 1.2, w: 0.1, d: 0.1, h: 1.1, yaw, material: m.woodDark, collide: false });
  }
  return { top: y0 + h + 0.15, x, z };
}

export function sandbags(world, m, { x, z, yaw = 0, len = 4, h = 1.0, curve = 0 }) {
  const n = Math.max(1, Math.round(len / 1.2));
  for (let i = 0; i < n; i++) {
    const f = (i / Math.max(1, n - 1) - 0.5) * len * (n > 1 ? 1 : 0);
    const a = yaw + curve * (i / Math.max(1, n - 1) - 0.5);
    const c = l2w(x, z, yaw, f, Math.abs(f) * Math.abs(f) * curve * 0.08);
    const y0 = world.terrain.heightAt(c.x, c.z);
    world.addBox({ x: c.x, z: c.z, y0: y0 - 0.2, w: len / n + 0.05, d: 0.6, h: h + 0.2, yaw: a, material: m.sandbag, mat: 'sandbag', pen: 30, texScale: 0.8, snowTop: true });
  }
}

export function berm(world, m, { x, z, yaw = 0, len = 6, h = 1.0 }) {
  const y0 = world.terrain.heightAt(x, z);
  const g = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(len / 2, h + 0.3, 1.3);
  g.rotateY(yaw); g.translate(x, y0 - 0.3, z);
  world.addStaticGeometry(m.snow, g, true);
  world.addBoxCollider({ x, z, y0: y0 - 0.3, w: len * 0.8, d: 1.4, h: h + 0.2, yaw, mat: 'snow' });
}

export function crates(world, m, { x, z, yaw = 0, n = 3, seed = 1 }) {
  const rnd = mulberry32(seed + Math.floor(x * 3 + z));
  if (hasAssets()) {
    const kinds = ['crate', 'milcrate', 'milcrate2', 'ammobox', 'ammobox', 'jerrycan', 'propane'];
    for (let i = 0; i < n + 1; i++) {
      const c = l2w(x, z, yaw, (rnd() - 0.5) * 3, (rnd() - 0.5) * 2);
      world.propRequests.push({ type: kinds[Math.floor(rnd() * kinds.length)], x: c.x, z: c.z, yaw: yaw + (rnd() - 0.5) * 0.8 });
    }
    return;
  }
  for (let i = 0; i < n; i++) {
    const lx = (rnd() - 0.5) * 2.4, lz = (rnd() - 0.5) * 1.6;
    const c = l2w(x, z, yaw, lx, lz);
    const big = rnd() > 0.5;
    const y0 = world.terrain.heightAt(c.x, c.z);
    const w = big ? 1.2 : 0.9, d = big ? 0.9 : 0.6, h = big ? 0.9 : 0.55;
    world.addBox({ x: c.x, z: c.z, y0, w, d, h, yaw: yaw + (rnd() - 0.5) * 0.4, material: big ? m.woodLight : m.metalGreen, mat: big ? 'wood' : 'metal', pen: big ? 6 : 3, snowTop: true });
    if (big && rnd() > 0.5) world.addBox({ x: c.x, z: c.z, y0: y0 + h, w: 0.9, d: 0.6, h: 0.55, yaw: yaw + rnd(), material: m.metalGreen, mat: 'metal', pen: 3, snowTop: true });
  }
}

export function container(world, m, { x, z, yaw = 0, color = 'red', stack = 1 }) {
  const mat = color === 'red' ? m.contRed : color === 'blue' ? m.contBlue : m.contGreen;
  const y0 = world.terrain.heightAt(x, z);
  for (let s = 0; s < stack; s++) {
    world.addBox({ x, z, y0: y0 - 0.1 + s * 2.6, w: 6.06, d: 2.44, h: 2.6, yaw, material: mat, mat: 'metal', pen: 2.5, texScale: 3, snowTop: s === stack - 1 });
  }
}

export function barrels(world, m, { x, z, n = 4, seed = 2 }) {
  const rnd = mulberry32(seed + Math.floor(x + z * 5));
  if (hasAssets()) {
    for (let i = 0; i < n; i++) world.propRequests.push({ type: rnd() < 0.85 ? 'barrel' : 'jerrycan', x: x + (rnd() - 0.5) * 2.4, z: z + (rnd() - 0.5) * 2.4, yaw: rnd() * 6 });
    return;
  }
  for (let i = 0; i < n; i++) {
    const bx = x + (rnd() - 0.5) * 2.2, bz = z + (rnd() - 0.5) * 2.2;
    world.addCyl({ x: bx, z: bz, y0: world.terrain.heightAt(bx, bz), r: 0.3, h: 0.9, material: rnd() > 0.5 ? m.metalRust : m.metalGreen, mat: 'metal', pen: 2, segments: 12, snowTop: true });
  }
}

export function fence(world, m, { pts, h = 2.2, kind = 'chain' }) {
  // сетка на столбах (или глухой дощатый) — пролёты валятся от взрыва и наезда техники
  world.destr.addFence(pts, { kind, h, secLen: 3, terrain: world.terrain, mats: { post: kind === 'board' ? m.woodDark : m.metalGrey, wire: m.wire, board: m.woodDark } });
}

// Камень со снежной шапкой (цвета вершин)
export function rock(world, m, { x, z, s = 1.5, seed = 1, collide = true }) {
  const rnd = mulberry32(seed);
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 0.75 + rnd() * 0.45;
    p.setXYZ(i, p.getX(i) * k * (1 + rnd() * 0.2), p.getY(i) * k * 0.75, p.getZ(i) * k);
  }
  g.scale(s, s, s);
  g.computeVertexNormals();
  const ng = g.index ? g.toNonIndexed() : g;
  ng.computeVertexNormals();
  const n = ng.attributes.normal;
  const col = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) {
    const up = n.getY(i);
    const sn = up > 0.45 ? 1 : 0;
    const c = sn ? 2.6 : 0.95;
    col[i * 3] = c; col[i * 3 + 1] = c * 1.0; col[i * 3 + 2] = c * 1.04;
  }
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const uv = new Float32Array(n.count * 2);
  const pp = ng.attributes.position;
  for (let i = 0; i < n.count; i++) { uv[i * 2] = pp.getX(i) * 0.5 + pp.getZ(i) * 0.3; uv[i * 2 + 1] = pp.getY(i) * 0.5; }
  ng.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const y0 = world.terrain.heightAt(x, z);
  ng.rotateY(rnd() * 6.28);
  ng.translate(x, y0 + s * 0.25, z);
  world.addStaticGeometry(m.rock, ng, true);
  if (collide && s > 0.6) world.addCylCollider({ x, z, y0: y0 - 0.5, r: s * 0.82, h: s * 1.05 + 0.5, mat: 'rock' });
}

// Ель со снегом (ярусы лап) и карликовая берёза
export function spruce(world, m, { x, z, h = 7, seed = 1, lite = false }) {
  const y0 = world.terrain.heightAt(x, z);
  const g = spruceGeometry(h, seed, lite);
  g.rotateY(seed * 1.7);
  g.translate(x, y0 - 0.1, z);
  world.addStaticGeometry(m.spruce, g, true);
  world.addCylCollider({ x, z, y0, r: 0.2, h: h * 0.6, mat: 'wood', pen: 12, cover: false });
}

export function birch(world, m, { x, z, h = 4, seed = 1 }) {
  const y0 = world.terrain.heightAt(x, z);
  const g = birchGeometry(h, seed);
  g.translate(x, y0 - 0.05, z);
  world.addStaticGeometry(m.spruce, g, true);
}

export function antenna(world, m, { x, z, h = 18 }) {
  const y0 = world.terrain.heightAt(x, z);
  const s = 0.5;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const g = new THREE.CylinderGeometry(0.03, 0.05, h, 4);
    g.translate(x + sx * s * 0.5, y0 + h / 2, z + sz * s * 0.5);
    world.addStaticGeometry(m.metalGrey, g, true);
  }
  for (let y = 1; y < h; y += 1.5) {
    for (const [lx, lz, w, d] of [[0, -s / 2, s, 0.03], [0, s / 2, s, 0.03], [-s / 2, 0, 0.03, s], [s / 2, 0, 0.03, s]]) {
      world.addBox({ x: x + lx, z: z + lz, y0: y0 + y, w, d, h: 0.03, material: m.metalGrey, collide: false, castShadow: false });
    }
  }
  world.addBoxCollider({ x, z, y0, w: s, d: s, h, mat: 'metal', blocksBullet: false, blocksSight: false, cover: false });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2200 }));
  lamp.position.set(x, y0 + h + 0.1, z);
  world.scene.add(lamp);
}

export function bunker(world, m, { x, z, yaw = 0, w = 6, d = 5 }) {
  const y0 = world.terrain.heightAt(x, z) - 0.8;
  return building(world, m, { x, z, yaw, w, d, h: 2.6, material: 'concrete', doors: [{ side: 's', at: w / 4, width: 1.6 }], windows: 2, roof: 'flat', interior: 'office', groundY: y0 });
}

export function wreck(world, m, { x, z, yaw = 0 }) {
  const y0 = world.terrain.heightAt(x, z);
  world.addBox({ x, z, y0: y0 + 0.3, w: 4.2, d: 1.8, h: 0.9, yaw, material: m.metalRust, mat: 'metal', pen: 1.5 });
  const c = l2w(x, z, yaw, -0.4, 0);
  world.addBox({ x: c.x, z: c.z, y0: y0 + 1.2, w: 2.2, d: 1.6, h: 0.6, yaw, material: m.metalRust, mat: 'metal', pen: 1.5, snowTop: true });
}

export function sign(world, m, { x, z, yaw = 0, text, sub }) {
  const y0 = world.terrain.heightAt(x, z);
  world.addBox({ x, z, y0, w: 0.08, d: 0.08, h: 2.2, material: m.woodDark, collide: false });
  const mat = new THREE.MeshStandardMaterial({ map: textTexture(sub ? [text, sub] : [text], { font: 'bold 40px Arial' }), roughness: 0.8 });
  const p = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), mat);
  p.position.set(x, y0 + 2.0, z); p.rotation.y = yaw;
  world.scene.add(p);
  const p2 = p.clone(); p2.rotation.y = yaw + Math.PI; world.scene.add(p2);
}

export function fuelTank(world, m, { x, z, r = 3.5, h = 6, id }) {
  const y0 = world.terrain.heightAt(x, z);
  const mesh = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 28), m.white);
  body.position.y = h / 2; body.castShadow = body.receiveShadow = true;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.98, r, 0.5, 28), m.snow);
  top.position.y = h + 0.2;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.02, r + 0.02, 0.4, 28), m.contRed);
  band.position.y = h * 0.7;
  mesh.add(body, top, band);
  const ladder = new THREE.Mesh(new THREE.BoxGeometry(0.5, h, 0.08), m.metalGrey);
  ladder.position.set(0, h / 2, r + 0.05);
  mesh.add(ladder);
  mesh.position.set(x, y0, z);
  world.scene.add(mesh);
  const d = { id, kind: 'fuel', hp: 250, maxHp: 250, mesh, pos: new THREE.Vector3(x, y0 + h / 2, z), alive: true, r, h };
  d.collider = world.addCylCollider({ x, z, y0, r, h, mat: 'metal', pen: 4, owner: d });
  world.destructibles.push(d);
  return d;
}

export function radarDish(world, m, { x, z, y, id }) {
  const g = new THREE.Group();
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 3, 10), m.metalGrey);
  mast.position.y = 1.5;
  const head = new THREE.Group();
  const dish = new THREE.Mesh(new THREE.SphereGeometry(3, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.32), m.white);
  dish.rotation.x = Math.PI / 2; dish.position.z = 0.6;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.25, 0.3), m.metalGrey);
  head.add(dish, frame);
  head.position.y = 3.4;
  g.add(mast, head);
  g.position.set(x, y, z);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  world.scene.add(g);
  const d = { id, kind: 'radar', hp: 160, maxHp: 160, mesh: g, head, pos: new THREE.Vector3(x, y + 3, z), alive: true, spin: 0.6 };
  d.collider = world.addCylCollider({ x, z, y0: y, r: 1.6, h: 5.5, mat: 'metal', pen: 3, owner: d, cover: false });
  world.destructibles.push(d);
  return d;
}

export function domeBuilding(world, m, { x, z, r = 5 }) {
  const y0 = world.terrain.heightAt(x, z);
  world.addCyl({ x, z, y0: y0 - 0.5, r, h: 3.5, material: m.concrete, segments: 24, mat: 'concrete' });
  const dome = new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.translate(x, y0 + 3, z);
  world.addStaticGeometry(m.white, dome, true);
  world.addCylCollider({ x, z, y0: y0 + 3, r: r * 0.75, h: r * 0.8, mat: 'metal', cover: false });
  return y0 + 3;
}

// Корпус судна у причала
export function ship(world, m, { x, z, yaw = 0, len = 40, w = 9 }) {
  const y0 = -2.5;
  world.addBox({ x, z, y0, w: len, d: w, h: 6, yaw, material: m.metalRust, mat: 'metal', pen: 14, texScale: 4 });
  const c = l2w(x, z, yaw, -len * 0.28, 0);
  world.addBox({ x: c.x, z: c.z, y0: y0 + 6, w: 8, d: w - 1.5, h: 5, yaw, material: m.white, mat: 'metal', pen: 4, snowTop: true });
  world.addBox({ x: c.x, z: c.z, y0: y0 + 11, w: 4, d: 3, h: 2.2, yaw, material: m.white, mat: 'metal', pen: 4, snowTop: true });
}

export function pier(world, m, { x, z, yaw = 0, len = 30, w = 8, top = 2.8 }) {
  world.addBox({ x, z, y0: -4, w: len, d: w, h: top + 4, yaw, material: m.concreteDark, mat: 'concrete', texScale: 3, snowTop: true });
  for (let i = -len / 2 + 2; i <= len / 2 - 2; i += 6) {
    const c = l2w(x, z, yaw, i, w / 2 - 0.3);
    world.addCyl({ x: c.x, z: c.z, y0: top, r: 0.22, h: 0.6, material: m.dark, segments: 8, mat: 'metal', cover: false });
  }
}

export function crane(world, m, { x, z, yaw = 0, h = 22 }) {
  const y0 = world.terrain.heightAt(x, z);
  for (const [lx, lz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
    const c = l2w(x, z, yaw, lx, lz);
    world.addBox({ x: c.x, z: c.z, y0, w: 0.5, d: 0.5, h, yaw, material: m.contRed, mat: 'metal', cover: false, blocksSight: false });
  }
  world.addBox({ x, z, y0: y0 + h, w: 7, d: 7, h: 1.2, yaw, material: m.contRed, mat: 'metal', cover: false });
  const b = l2w(x, z, yaw, 0, -10);
  world.addBox({ x: b.x, z: b.z, y0: y0 + h + 1.2, w: 1.2, d: 30, h: 1.2, yaw, material: m.contRed, collide: false });
  world.addBox({ x, z, y0: y0 + h + 1.2, w: 3, d: 3, h: 3, yaw, material: m.white, collide: false, snowTop: true });
}

export function box(world, m, { x, z, w = 1, d = 1, h = 1, yaw = 0, material = 'concrete', y0, ...opts }) {
  const y = y0 ?? world.terrain.heightAt(x, z);
  return world.addBox({ x, z, y0: y, w, d, h, yaw, material: m[material] || m.concrete, mat: opts.mat || 'concrete', snowTop: true, ...opts });
}

export function lampPost(world, m, { x, z, light = false }) {
  const y0 = world.terrain.heightAt(x, z);
  world.addBox({ x, z, y0, w: 0.15, d: 0.15, h: 6, material: m.metalGrey, collide: true, mat: 'metal', cover: false, blocksSight: false });
  const l = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.3), m.lamp);
  l.position.set(x, y0 + 6, z);
  world.scene.add(l);
  if (light) {
    const pl = new THREE.PointLight(0xffd890, 25, 30, 2);
    pl.position.set(x, y0 + 5.8, z);
    world.scene.add(pl);
  }
}

// Мишень полигона: щит с отметками попаданий
export function targetBoard(world, m, { x, z, kind = 'chest', w = 0.5, h = 0.5, facing = 0, label }) {
  const y0 = world.terrain.heightAt(x, z);
  const yc = y0 + 0.4 + h / 2;
  const mat = new THREE.MeshStandardMaterial({ map: targetTexture(kind === 'chest' ? 'chest' : 'rings'), roughness: 0.9 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.04), [m.woodLight, m.woodLight, m.woodLight, m.woodLight, mat, m.woodLight]);
  board.position.set(x, yc, z);
  board.rotation.y = facing;
  board.castShadow = true;
  world.scene.add(board);
  for (const s of [-1, 1]) {
    const c = l2w(x, z, facing, s * (w / 2 - 0.05), 0.05);
    world.addBox({ x: c.x, z: c.z, y0, w: 0.05, d: 0.05, h: 0.45, yaw: facing, material: m.woodDark, collide: false });
  }
  if (label) {
    const lm = new THREE.MeshBasicMaterial({ map: textTexture(label, { w: 256, h: 96, font: 'bold 56px Arial' }) });
    const lp = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(0.8, w), 0.3), lm);
    lp.position.set(x, y0 + 0.25, z + 0.1); lp.rotation.y = facing;
    world.scene.add(lp);
  }
  const t = { kind: 'target', mesh: board, x, z, y: yc, w, h, facing, hits: [] };
  t.collider = world.addBoxCollider({ x, z, y0: yc - h / 2, w, d: 0.06, h, yaw: facing, mat: 'target', owner: t, cover: false, blocksMove: false });
  world.targets.push(t);
  return t;
}
