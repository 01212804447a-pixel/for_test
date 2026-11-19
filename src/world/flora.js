// Растительность и мелочь на поверхности: пучки сухой травы и карликовые кустарники,
// торчащие из снега, полузанесённые камни, снежные надувы, ели и карликовые берёзы.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/math.js';
import { addTreeSway, swayInstanced } from './shaders.js';

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

const texCache = {};
function grassTex() {
  return texCache.grass || (texCache.grass = canvasTex(128, 128, (g, w, h) => {
    const r = mulberry32(5);
    for (let i = 0; i < 46; i++) {
      const x = w * 0.5 + (r() - 0.5) * w * 0.55, top = h * (0.1 + r() * 0.55);
      const hue = 30 + r() * 12, l = 28 + r() * 26;
      g.strokeStyle = `hsl(${hue},${12 + r() * 18}%,${l}%)`; g.lineWidth = 0.8 + r() * 1.2;
      g.beginPath(); g.moveTo(x, h); g.quadraticCurveTo(x + (r() - 0.5) * 20, (h + top) / 2, x + (r() - 0.5) * 30, top); g.stroke();
    }
  }));
}
function shrubTex() {
  return texCache.shrub || (texCache.shrub = canvasTex(128, 128, (g, w, h) => {
    const r = mulberry32(9);
    const branch = (x, y, a, len, d) => {
      if (d > 4 || len < 4) return;
      const x2 = x + Math.cos(a) * len, y2 = y - Math.sin(a) * len;
      g.strokeStyle = `rgb(${50 + d * 10},${32 + d * 6},${26 + d * 4})`; g.lineWidth = Math.max(1, 4 - d);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
      if (d >= 2 && r() < 0.5) { g.fillStyle = r() < 0.5 ? 'rgba(120,40,30,0.9)' : 'rgba(90,70,40,0.9)'; g.fillRect(x2 - 2, y2 - 2, 4, 4); }
      branch(x2, y2, a + 0.4 + r() * 0.3, len * 0.7, d + 1);
      branch(x2, y2, a - 0.4 - r() * 0.3, len * 0.7, d + 1);
    };
    for (let i = 0; i < 5; i++) branch(w * (0.3 + r() * 0.4), h, Math.PI / 2 + (r() - 0.5) * 0.9, 30 + r() * 15, 0);
    // снег на ветках
    g.fillStyle = 'rgba(245,248,252,0.9)';
    for (let i = 0; i < 25; i++) g.fillRect(r() * w, r() * h * 0.8, 4 + r() * 6, 2);
  }));
}

function crossedPlanes(w, h, n = 3) {
  const gs = [];
  for (let i = 0; i < n; i++) {
    const g = new THREE.PlaneGeometry(w, h);
    g.translate(0, h / 2, 0);
    g.rotateY((i / n) * Math.PI);
    gs.push(g);
  }
  return mergeGeometries(gs);
}

// Атлас для деревьев: слева — кора (u 0…0.2), справа — еловая лапа с хвоей на прозрачном фоне (u 0.25…1)
let treeAtlas = null;
export function spruceAtlas() {
  if (treeAtlas) return treeAtlas;
  const W = 1024, H = 512;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const r = mulberry32(17);
  // кора
  const bw = W * 0.2;
  g.fillStyle = '#3d2f25'; g.fillRect(0, 0, bw, H);
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${20 + r() * 40},${14 + r() * 30},${10 + r() * 20},${0.3 + r() * 0.5})`; g.fillRect(r() * bw, r() * H, 1 + r() * 3, 6 + r() * 30); }
  for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(${90 + r() * 40},${80 + r() * 30},${70 + r() * 20},0.35)`; g.fillRect(r() * bw, r() * H, 2 + r() * 8, 2 + r() * 6); }
  // береста
  g.fillStyle = '#e8e6df'; g.fillRect(bw, 0, W * 0.05, H);
  for (let i = 0; i < 140; i++) { g.fillStyle = `rgba(30,28,26,${0.4 + r() * 0.5})`; g.fillRect(bw + r() * W * 0.05, r() * H, 3 + r() * 14, 1 + r() * 3); }
  // лапа: две полосы — без снега (v 0…0.5) и со снегом (v 0.5…1)
  const drawBranch = (y0, rowH, snow) => {
    const x0 = W * 0.255, x1 = W * 0.995, cy = y0 + rowH * 0.5;
    const L = x1 - x0 - 20;
    const pts = [];
    const needle = (x, y, a, len, light) => {
      const k = light ? 1.25 : 1;
      const l = (14 + r() * 13) * k, sat = 22 + r() * 18, hue = 130 + r() * 25;
      g.strokeStyle = `hsl(${hue},${sat}%,${l}%)`;
      g.lineWidth = 1.5 + r() * 0.6; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
    };
    // веточка: густая «ёршиком» хвоя
    const twig = (sx, sy, ang, len, depth) => {
      const steps = Math.max(4, Math.floor(len / 5));
      let x = sx, y = sy;
      for (let i = 0; i < steps; i++) {
        const t = i / steps;
        const nx = x + Math.cos(ang) * (len / steps), ny = y + Math.sin(ang) * (len / steps) + (r() - 0.5) * 1.0;
        g.strokeStyle = `rgb(${60 + r() * 20},${46 + r() * 14},${34 + r() * 10})`;
        g.lineWidth = Math.max(1, (depth ? 1.8 : 4) * (1 - t * 0.7));
        g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
        const nl = (depth ? 9 : 11) * (1 - t * 0.3);
        for (let k = 0; k < 3; k++) {
          const px = x + (nx - x) * (k / 3), py = y + (ny - y) * (k / 3);
          const light = t > 0.75 && depth === 0;
          needle(px, py, ang - 0.8 - r() * 0.7, nl * (0.6 + r() * 0.5), light);
          needle(px, py, ang + 0.8 + r() * 0.7, nl * (0.6 + r() * 0.5), light);
        }
        pts.push([nx, ny, t, depth]);
        x = nx; y = ny;
      }
      return [x, y];
    };
    // основная ветвь и боковые веточки с огибающей «пёрышком» (шире к середине)
    const n = 22;
    let x = x0, y = cy;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const [nx, ny] = twig(x, y, -0.01, L / n, 0);
      const env = Math.sin(Math.min(1, t * 1.25 + 0.08) * Math.PI) * (1 - t * 0.35);
      const sl = rowH * 0.5 * env * (0.8 + r() * 0.25);
      if (sl > 6) {
        for (const sgn of [-1, 1]) {
          const a = sgn * (0.75 + r() * 0.3) - 0.01;
          const [ex, ey] = twig(nx, ny, a, sl, 1);
          if (sl > 30 && r() < 0.6) twig(nx + (ex - nx) * 0.5, ny + (ey - ny) * 0.5, a - sgn * 0.6, sl * 0.35, 2);
        }
      }
      x = nx; y = ny;
    }
    if (snow) {
      // снежные «подушки» на веточках
      for (let i = 0; i < 95; i++) {
        const p = pts[(r() * pts.length) | 0];
        const rad = 9 + r() * 18 * (1 - p[2] * 0.3);
        const cx = p[0], cy2 = p[1] - rad * 0.2;
        const gr = g.createRadialGradient(cx, cy2, 0, cx, cy2, rad);
        gr.addColorStop(0, 'rgba(252,253,255,1)'); gr.addColorStop(0.7, 'rgba(236,241,248,0.95)'); gr.addColorStop(1, 'rgba(220,230,242,0)');
        g.fillStyle = gr; g.beginPath(); g.ellipse(cx, cy2, rad * 1.5, rad * 0.9, (r() - 0.5) * 0.4, 0, Math.PI * 2); g.fill();
      }
    }
  };
  drawBranch(0, H / 2, false);
  drawBranch(H / 2, H / 2, true);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  treeAtlas = t;
  return t;
}

// Материал хвойных: альфа-отсечение, снег на верхней стороне лап (по нормали), мягкое «объёмное» освещение
export function spruceMaterial() {
  const m = new THREE.MeshStandardMaterial({ map: spruceAtlas(), alphaTest: 0.38, side: THREE.DoubleSide, vertexColors: true, roughness: 0.92 });
  m.userData.keepAttrs = [['aSway', 2]];
  m.onBeforeCompile = (sh) => {
    addTreeSway(sh);
    // просвечивание хвои: против солнца лапы светятся тёплым по краям, обратная сторона не чернеет
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      reflectedLight.indirectDiffuse += diffuseColor.rgb * 0.12;
      #if NUM_DIR_LIGHTS > 0
      {
        vec3 Ld = directionalLights[0].direction;
        float back = pow(max(dot(-normalize(vViewPosition), Ld), 0.0), 4.0); // солнце за деревом
        reflectedLight.directDiffuse += diffuseColor.rgb * directionalLights[0].color * back * 0.35 * vec3(0.9, 1.0, 0.6);
      }
      #endif`);
  };
  m.customProgramCacheKey = () => 'spruce4';
  return m;
}

// Ель: ствол + ярусы лап-карточек (по две плоскости крест-накрест), свисающих вниз
export function spruceGeometry(h, seed, lite = false) {
  // lite — облегчённая ель для дальних лесов: меньше ярусов и лап, лапы шире
  const rnd = mulberry32(seed);
  const pos = [], nor = [], uv = [], col = [], idx = [];
  const center = new THREE.Vector3(0, h * 0.45, 0);
  // цвет вершин — множитель яркости (вариации оттенка)
  const quad = (A, B, C, D, uvs, n4, c) => {
    const base = pos.length / 3;
    for (const [P, U, N] of [[A, uvs[0], n4[0]], [B, uvs[1], n4[1]], [C, uvs[2], n4[2]], [D, uvs[3], n4[3]]]) {
      pos.push(P.x, P.y, P.z); uv.push(U[0], U[1]); nor.push(N.x, N.y, N.z); col.push(c[0], c[1], c[2]);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  // ствол: 7-гранник, UV — полоса коры
  const segs = 7, trunkH = h * 0.92, r0 = 0.05 + h * 0.022, r1 = 0.03;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
    const p = (a, y, r) => new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
    const n = (a) => new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    quad(p(a0, -0.2, r0), p(a1, -0.2, r0), p(a1, trunkH, r1), p(a0, trunkH, r1), [[(i / segs) * 0.2, 0], [((i + 1) / segs) * 0.2, 0], [((i + 1) / segs) * 0.2, trunkH / 3], [(i / segs) * 0.2, trunkH / 3]], [n(a0), n(a1), n(a1), n(a0)], [0.9, 0.9, 0.9]);
  }
  // ярусы лап
  const levels = lite ? Math.max(6, Math.round(h * 1.3)) : Math.max(8, Math.round(h * 2.4));
  const yb = Math.min(1.2, h * 0.14);
  for (let l = 0; l < levels; l++) {
    const t = l / (levels - 1);
    const y = yb + t * (h - yb) * 0.97;
    const R = (1 - t) * h * 0.27 + 0.16;
    const count = lite ? Math.max(5, Math.round(5 + (1 - t) * 4)) : Math.max(6, Math.round(7 + (1 - t) * 6));
    const a0 = rnd() * 6.28;
    for (let k = 0; k < count; k++) {
      const a = a0 + (k / count) * Math.PI * 2 + (rnd() - 0.5) * 0.4;
      const len = R * (0.75 + rnd() * 0.45);
      const droop = 0.18 + (1 - t) * 0.25 + rnd() * 0.15;
      const dir = new THREE.Vector3(Math.cos(a), -droop, Math.sin(a)).normalize();
      const side = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
      const wid = len * (0.55 + rnd() * 0.15) * (lite ? 1.35 : 1);
      const root = new THREE.Vector3(Math.cos(a) * 0.04, y + (rnd() - 0.5) * 0.15, Math.sin(a) * 0.04);
      const tip = root.clone().addScaledVector(dir, len);
      // нормали: от оси дерева вверх-наружу (объёмное освещение кроны)
      const nOf = (P) => P.clone().sub(center).setY((P.y - center.y) * 0.4 + 0.8).normalize();
      const shade = 0.8 + rnd() * 0.3;
      // снег — на верхних и внешних лапах чаще
      const sn = rnd() < 0.22 + t * 0.35;
      const v0 = sn ? 0.5 : 0.0, v1 = sn ? 1.0 : 0.5;
      // горизонтальная карточка
      const A = root.clone().addScaledVector(side, -wid * 0.3), B = tip.clone().addScaledVector(side, -wid * 0.5), C = tip.clone().addScaledVector(side, wid * 0.5), D = root.clone().addScaledVector(side, wid * 0.3);
      quad(A, B, C, D, [[0.25, v0], [1.0, v0], [1.0, v1], [0.25, v1]], [nOf(A), nOf(B), nOf(C), nOf(D)], [shade, shade, shade]);
      // вертикальная (крест-накрест), чуть меньше, без снега
      const up = new THREE.Vector3().crossVectors(side, dir).normalize();
      const A2 = root.clone().addScaledVector(up, -wid * 0.18), B2 = tip.clone().addScaledVector(up, -wid * 0.32), C2 = tip.clone().addScaledVector(up, wid * 0.32), D2 = root.clone().addScaledVector(up, wid * 0.18);
      quad(A2, B2, C2, D2, [[0.25, 0], [1.0, 0], [1.0, 0.5], [0.25, 0.5]], [nOf(A2), nOf(B2), nOf(C2), nOf(D2)], [shade * 0.92, shade * 0.92, shade * 0.92]);
    }
  }
  // макушка
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI;
    const s = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const A = new THREE.Vector3(0, h * 0.86, 0).addScaledVector(s, -0.12), B = new THREE.Vector3(0, h * 0.86, 0).addScaledVector(s, 0.12);
    const C = new THREE.Vector3(0, h * 1.02, 0).addScaledVector(s, 0.02), D = new THREE.Vector3(0, h * 1.02, 0).addScaledVector(s, -0.02);
    const n = new THREE.Vector3(0, 1, 0);
    quad(A, B, C, D, [[0.25, 0.5], [0.25, 1], [1, 1], [1, 0.5]], [n, n, n, n], [0.85, 0.85, 0.85]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g.toNonIndexed();
}

// Карликовая берёза: белый кривой ствол + голые ветви
export function birchGeometry(h, seed) {
  const rnd = mulberry32(seed);
  const parts = [];
  const seg = (a, b, r0, r1, col) => {
    const d = new THREE.Vector3().subVectors(b, a); const L = d.length();
    const g = new THREE.CylinderGeometry(r1, r0, L, 6).toNonIndexed();
    g.translate(0, L / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    g.translate(a.x, a.y, a.z);
    const n = g.attributes.position.count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const dark = rnd() < 0.15; c[i * 3] = dark ? 0.15 : col[0]; c[i * 3 + 1] = dark ? 0.14 : col[1]; c[i * 3 + 2] = dark ? 0.13 : col[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    // UV — полоса бересты в атласе (u 0.205…0.245)
    const uvA = g.attributes.uv;
    for (let i = 0; i < uvA.count; i++) uvA.setXY(i, 0.205 + uvA.getX(i) * 0.04, uvA.getY(i) * L * 0.5);
    parts.push(g);
  };
  const grow = (a, dir, len, r, depth) => {
    const b = a.clone().addScaledVector(dir, len);
    seg(a, b, r, r * 0.7, depth === 0 ? [0.85, 0.84, 0.8] : [0.35, 0.22, 0.18]);
    if (depth >= 3) return;
    const kids = depth === 0 ? 4 : 2;
    for (let i = 0; i < kids; i++) {
      const nd = dir.clone().add(new THREE.Vector3((rnd() - 0.5) * 1.4, 0.3 + rnd() * 0.4, (rnd() - 0.5) * 1.4)).normalize();
      grow(b, nd, len * 0.6, r * 0.6, depth + 1);
    }
  };
  grow(new THREE.Vector3(), new THREE.Vector3((rnd() - 0.5) * 0.4, 1, (rnd() - 0.5) * 0.4).normalize(), h * 0.45, 0.07, 0);
  return mergeGeometries(parts.map((g) => { const n = new THREE.BufferGeometry(); n.setAttribute('position', g.attributes.position); n.setAttribute('normal', g.attributes.normal); n.setAttribute('uv', g.attributes.uv); n.setAttribute('color', g.attributes.color); return n; }));
}

// Разброс мелочи по всей карте (инстансы)
export function scatterGround(scene, terrain, world, { seed = 1, radius = 1050, grass = 5000, shrubs = 1600, stones = 900, drifts = 260, wind = new THREE.Vector3(1, 0, 0), avoid = [], center = { x: 0, z: 0 } } = {}) {
  const rnd = mulberry32(seed * 977 + 13);
  const ok = (x, z, clear = 1.2) => {
    if (Math.hypot(x - center.x, z - center.z) > radius) return false;
    const m = terrain.maskAt(x, z);
    if (m === 1 || m === 2) return false;
    const h = terrain.heightAt(x, z);
    if (terrain.hasSea && h < 1) return false;
    for (const a of avoid) if ((x - a.x) ** 2 + (z - a.z) ** 2 < a.r * a.r) return false;
    const n = terrain.normalAt(x, z);
    if (n.y < 0.82) return false;
    if (world) {
      let hit = false;
      world._cellsAround(x, z, clear, (o) => { if (!hit && o.blocksMove && world.pointObstacleDist(o, x, z) < clear) hit = true; });
      if (hit) return false;
    }
    return true;
  };
  const dummy = new THREE.Object3D();
  const out = [];
  const place = (geo, mat, n, sMin, sMax, opts = {}) => {
    const im = new THREE.InstancedMesh(geo, mat, n);
    let k = 0;
    for (let tries = 0; k < n && tries < n * 4; tries++) {
      // кустарники группами
      let x, z;
      if (opts.cluster && k > 0 && rnd() < 0.85) {
        im.getMatrixAt(Math.floor(rnd() * k), dummy.matrix);
        const px = dummy.matrix.elements[12], pz = dummy.matrix.elements[14];
        x = px + (rnd() - 0.5) * 9; z = pz + (rnd() - 0.5) * 9;
      } else {
        const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * radius;
        x = center.x + Math.cos(a) * d; z = center.z + Math.sin(a) * d;
      }
      if (!ok(x, z, opts.clear || 0.8)) continue;
      const s = sMin + rnd() * (sMax - sMin);
      dummy.position.set(x, terrain.heightAt(x, z) - (opts.sink || 0) * s, z);
      dummy.rotation.set(0, opts.align ? Math.atan2(wind.x, wind.z) + (rnd() - 0.5) * 0.4 : rnd() * 6.28, 0);
      if (opts.tilt) { dummy.rotation.x = (rnd() - 0.5) * 0.3; dummy.rotation.z = (rnd() - 0.5) * 0.3; }
      dummy.scale.set(s * (opts.sx || 1), s * (opts.sy || 1), s * (opts.sz || 1));
      dummy.updateMatrix();
      im.setMatrixAt(k++, dummy.matrix);
    }
    im.count = k;
    im.castShadow = !!opts.shadow; im.receiveShadow = true;
    im.frustumCulled = false;
    scene.add(im); out.push(im);
    return im;
  };
  const grassMat = swayInstanced(new THREE.MeshStandardMaterial({ map: grassTex(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1 }), 0.55, 'g');
  const shrubMat = swayInstanced(new THREE.MeshStandardMaterial({ map: shrubTex(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1 }), 0.12, 's');
  place(crossedPlanes(0.5, 0.42, 3), grassMat, grass, 0.45, 1.0, { cluster: true, sink: 0.08 });
  place(crossedPlanes(1.1, 0.9, 3), shrubMat, shrubs, 0.6, 1.5, { cluster: true, shadow: true });
  const st = new THREE.DodecahedronGeometry(0.5, 0);
  const sp = st.attributes.position;
  const sr = mulberry32(seed + 3);
  for (let i = 0; i < sp.count; i++) sp.setY(i, sp.getY(i) * (0.55 + sr() * 0.2));
  st.computeVertexNormals();
  const stCol = new Float32Array(sp.count * 3);
  for (let i = 0; i < sp.count; i++) { const up = st.attributes.normal.getY(i) > 0.6; const c = up ? 0.95 : 0.3; stCol[i * 3] = c; stCol[i * 3 + 1] = c * 1.01; stCol[i * 3 + 2] = c * 1.05; }
  st.setAttribute('color', new THREE.BufferAttribute(stCol, 3));
  place(st, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }), stones, 0.3, 1.1, { sink: 0.25, tilt: true, shadow: true });
  // снежные надувы, вытянутые по ветру
  const dg = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  place(dg, new THREE.MeshStandardMaterial({ color: 0xf3f6fa, roughness: 0.92 }), drifts, 2, 6, { align: true, sx: 0.55, sy: 0.12, sz: 1.6, sink: 0.04, clear: 2.5 });
  return out;
}

// Густой покров вокруг камеры: тайлы 32 м, детерминированный разброс, пересборка при смене тайла
export class GroundCover {
  constructor(scene, terrain, world, { density = 1, radius = 140 } = {}) {
    this.terrain = terrain; this.world = world; this.radius = radius;
    this.tile = 32; this.key = '';
    const grassMat = swayInstanced(new THREE.MeshStandardMaterial({ map: grassTex(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1 }), 0.55, 'g');
    const shrubMat = swayInstanced(new THREE.MeshStandardMaterial({ map: shrubTex(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1 }), 0.12, 's');
    const st = new THREE.DodecahedronGeometry(0.5, 0);
    const sp = st.attributes.position;
    for (let i = 0; i < sp.count; i++) sp.setY(i, sp.getY(i) * 0.6);
    st.computeVertexNormals();
    const col = new Float32Array(sp.count * 3);
    for (let i = 0; i < sp.count; i++) { const c = st.attributes.normal.getY(i) > 0.6 ? 0.95 : 0.32; col[i * 3] = c; col[i * 3 + 1] = c; col[i * 3 + 2] = c * 1.05; }
    st.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const n = Math.ceil((radius * 2) / this.tile) ** 2;
    this.layers = [
      { mesh: new THREE.InstancedMesh(crossedPlanes(0.5, 0.42, 3), grassMat, Math.floor(n * 60 * density)), per: Math.floor(60 * density), s: [0.45, 1.0], patch: 0.55, shadow: false, sink: 0.08 },
      { mesh: new THREE.InstancedMesh(crossedPlanes(1.1, 0.9, 3), shrubMat, Math.floor(n * 16 * density)), per: Math.floor(16 * density), s: [0.6, 1.6], patch: 0.4, shadow: true },
      { mesh: new THREE.InstancedMesh(st, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }), Math.floor(n * 6 * density)), per: Math.floor(6 * density), s: [0.25, 0.9], patch: 0, shadow: true, sink: 0.22 },
    ];
    for (const L of this.layers) { L.mesh.frustumCulled = false; L.mesh.castShadow = L.shadow; L.mesh.receiveShadow = true; L.mesh.count = 0; scene.add(L.mesh); }
    this.dummy = new THREE.Object3D();
  }

  update(camPos) {
    const T = this.tile;
    const cx = Math.floor(camPos.x / T), cz = Math.floor(camPos.z / T);
    const key = cx + ',' + cz;
    if (key === this.key) return;
    this.key = key;
    const R = Math.ceil(this.radius / T);
    const t = this.terrain, w = this.world, d = this.dummy;
    for (const L of this.layers) L.k = 0;
    for (let tz = cz - R; tz <= cz + R; tz++) {
      for (let tx = cx - R; tx <= cx + R; tx++) {
        const rnd = mulberry32((tx * 73856093) ^ (tz * 19349663));
        // «пятна» растительности: в части тайлов гуще
        const lush = rnd();
        for (const L of this.layers) {
          const cnt = Math.floor(L.per * (L.patch ? (lush < L.patch ? 0.25 : 1.4) : 1));
          for (let i = 0; i < cnt && L.k < L.mesh.instanceMatrix.count; i++) {
            const x = (tx + rnd()) * T, z = (tz + rnd()) * T;
            const s = L.s[0] + rnd() * (L.s[1] - L.s[0]);
            const rot = rnd() * 6.28;
            if (Math.hypot(x, z) > 1080) continue;
            const m = t.maskAt(x, z);
            if (m === 1 || m === 2) continue;
            const h = t.heightAt(x, z);
            if (t.hasSea && h < 1) continue;
            if (t.normalAt(x, z).y < 0.8) continue;
            if (w) {
              let hit = false;
              w._cellsAround(x, z, 0.6, (o) => { if (!hit && o.blocksMove && o.y1 - h > 0.3 && w.pointObstacleDist(o, x, z) < 0.5) hit = true; });
              if (hit) continue;
            }
            d.position.set(x, h - (L.sink || 0) * s, z);
            d.rotation.set(L.sink > 0.15 ? (rnd() - 0.5) * 0.4 : 0, rot, 0);
            d.scale.setScalar(s);
            d.updateMatrix();
            L.mesh.setMatrixAt(L.k++, d.matrix);
          }
        }
      }
    }
    for (const L of this.layers) { L.mesh.count = L.k; L.mesh.instanceMatrix.needsUpdate = true; }
  }
}

// Мягкая контактная тень (пятно) под объектом
let blobTex = null;
export function blobShadow(w, d, opacity = 0.55) {
  if (!blobTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    blobTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, opacity, depthWrite: false, color: 0x1a2030, polygonOffset: true, polygonOffsetFactor: -4 }));
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 1;
  return m;
}

// Снежная шапка на моделях (камни, стволы): по мировой нормали, с пятнами
const snowyCache = new Map();
export function snowify(mat, amount = 1) {
  const key = mat.uuid + amount;
  if (snowyCache.has(key)) return snowyCache.get(key);
  const m = mat.clone();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.snAmt = { value: amount };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSnN;\nvarying vec3 vSnP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSnN = normalize(mat3(modelMatrix) * normal);\nvSnP = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vSnN; varying vec3 vSnP; uniform float snAmt;
float sn_h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sn_n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(sn_h(i), sn_h(i+vec2(1,0)), f.x), mix(sn_h(i+vec2(0,1)), sn_h(i+vec2(1,1)), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float snK = smoothstep(0.35, 0.75, vSnN.y + (sn_n(vSnP.xz * 2.3) - 0.5) * 0.5) * snAmt;
        diffuseColor.rgb = mix(diffuseColor.rgb * vec3(0.85, 0.88, 0.9), vec3(0.92, 0.94, 0.97), snK);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n        roughnessFactor = mix(roughnessFactor, 0.85, snK);');
  };
  m.customProgramCacheKey = () => 'snowy' + amount;
  snowyCache.set(key, m);
  return m;
}
