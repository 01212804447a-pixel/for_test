// Штаб (ПВД «Полярный Лис»): 3D-помещение со стендом таблиц стрельбы, картой операций,
// стендом личного состава, оружейной пирамидой и выходом в автопарк.
import * as THREE from 'three';
import { buildFiringTable, TABLE_WEAPONS } from '../physics/firingTable.js';
import { drawChart, drawTable } from '../ui/charts.js';
import { woodTexture, textTexture } from '../world/textures.js';
import { SoldierModel } from '../entities/soldierModel.js';
import { ClipActor, CharAnimator, charAvailable } from '../entities/charRig.js';
import { thirdPersonGun, buildGun } from '../weapons/guns.js';
import { MISSIONS } from '../data/missions.js';
import { WEAPONS } from '../data/weapons.js';
import { model, pbr, hdr as hdrAsset } from '../core/assets.js';
import { ROSTER } from '../data/squad.js';
import { clamp } from '../core/math.js';

function canvasTex(c) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }

function wallTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#e9e6dc'; g.fillRect(0, 0, 512, 512);
  g.fillStyle = '#566b4f'; g.fillRect(0, 512 * 0.53, 512, 512 * 0.47);
  g.fillStyle = '#3d4b38'; g.fillRect(0, 512 * 0.53 - 6, 512, 6);
  for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.03})`; g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2); }
  const t = canvasTex(c); t.wrapS = THREE.RepeatWrapping; return t;
}

export function buildBoardCanvas() {
  const c = document.createElement('canvas'); c.width = 2400; c.height = 900;
  const g = c.getContext('2d');
  g.fillStyle = '#ece6d4'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#7a1c14'; g.font = 'bold 46px Arial'; g.textAlign = 'center';
  g.fillText('ТАБЛИЦЫ СТРЕЛЬБЫ И ТРАЕКТОРИИ ПОЛЁТА СНАРЯДОВ', c.width / 2, 58);
  g.fillStyle = '#333'; g.font = '22px Arial';
  g.fillText('Нормальные условия: t = −20 °C, P = 750 мм рт. ст., безветрие. Рассчитано по модели сопротивления воздуха G7 / реактивной модели.', c.width / 2, 92);
  const pw = 780, ph = 390;
  TABLE_WEAPONS.forEach((id, i) => {
    const t = buildFiringTable(id);
    const col = i % 3, row = Math.floor(i / 3);
    const x = 20 + col * (pw + 10), y = 112 + row * (ph + 6);
    g.fillStyle = '#fffdf6'; g.fillRect(x, y, pw, ph);
    g.strokeStyle = '#5a5a5a'; g.lineWidth = 2; g.strokeRect(x, y, pw, ph);
    g.fillStyle = '#111'; g.textAlign = 'left'; g.font = 'bold 22px Arial';
    g.fillText(`${t.weapon.name} — ${t.ammo.name}`, x + 10, y + 26);
    const ch = document.createElement('canvas'); ch.width = 420; ch.height = 340;
    drawChart(ch, t.charts[0], { font: 11, pad: { l: 46, r: 8, t: 40, b: 32 } });
    g.drawImage(ch, x + pw - 430, y + 40);
    const small = { columns: t.columns.slice(0, 4), rows: t.rows.slice(0, 10).map((r) => ({ cells: r.cells.slice(0, 4) })) };
    drawTable(g, x + 8, y + 40, pw - 450, small, { font: 13 });
  });
  return c;
}

function mapCanvas(progress) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 640;
  const g = c.getContext('2d');
  g.fillStyle = '#dfe6ea'; g.fillRect(0, 0, 1024, 640);
  // береговая линия и рельеф (стилизовано)
  g.fillStyle = '#7d98ad'; g.beginPath(); g.moveTo(0, 0); g.lineTo(1024, 0); g.lineTo(1024, 150);
  for (let x = 1024; x >= 0; x -= 32) g.lineTo(x, 140 + Math.sin(x * 0.02) * 30 + Math.cos(x * 0.05) * 12);
  g.closePath(); g.fill();
  g.strokeStyle = 'rgba(90,100,110,0.35)';
  for (let k = 0; k < 40; k++) { g.beginPath(); const cx = Math.random() * 1024, cy = 200 + Math.random() * 400, r = 20 + Math.random() * 60; for (let j = 0; j < 3; j++) g.ellipse(cx, cy, r + j * 10, (r + j * 10) * 0.6, 0, 0, Math.PI * 2); g.stroke(); }
  g.strokeStyle = 'rgba(0,0,0,0.15)';
  for (let x = 0; x < 1024; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 640); g.stroke(); }
  for (let y = 0; y < 640; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(1024, y); g.stroke(); }
  const pts = [[820, 560, 'range'], [700, 470, 'm1'], [520, 380, 'm2'], [380, 300, 'm3'], [250, 190, 'm4'], [110, 140, 'm5']];
  g.strokeStyle = '#a01810'; g.lineWidth = 4; g.setLineDash([12, 8]);
  g.beginPath(); pts.slice(1).forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); g.setLineDash([]);
  g.font = 'bold 22px Arial';
  for (const [x, y, id] of pts) {
    const m = MISSIONS.find((q) => q.id === id);
    const done = progress[id];
    g.fillStyle = done ? '#2e7d32' : id === 'range' ? '#1f5aa6' : '#a01810';
    g.beginPath(); g.arc(x, y, 12, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#111'; g.fillText(m.title, x + 18, y + 8);
  }
  g.fillStyle = '#1b2a40'; g.font = 'bold 30px Arial'; g.fillText('ОПЕРАЦИИ N.E.G.S — ЗАПОЛЯРЬЕ', 30, 610);
  return c;
}

function rosterCanvas() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 640;
  const g = c.getContext('2d');
  g.fillStyle = '#6b4b2f'; g.fillRect(0, 0, 1024, 640);
  g.fillStyle = '#efe7d2'; g.font = 'bold 40px Arial'; g.textAlign = 'center';
  g.fillText('ЛИЧНЫЙ СОСТАВ ОТДЕЛЕНИЯ', 512, 56);
  ROSTER.forEach((r, i) => {
    const x = 30 + (i % 4) * 246, y = 90 + Math.floor(i / 4) * 270;
    g.fillStyle = '#f4efe2'; g.fillRect(x, y, 226, 250);
    g.fillStyle = '#c8d0d6'; g.fillRect(x + 63, y + 14, 100, 120);
    g.fillStyle = '#7c8890'; g.beginPath(); g.arc(x + 113, y + 60, 26, 0, 6.3); g.fill(); g.fillRect(x + 78, y + 92, 70, 42);
    g.fillStyle = '#111'; g.font = 'bold 22px Arial'; g.fillText(`«${r.callsign}»`, x + 113, y + 162);
    g.font = '16px Arial'; g.fillText(r.roleName, x + 113, y + 188); g.fillText(r.rank, x + 113, y + 210);
    g.fillStyle = '#c00'; g.fillRect(x + 8, y + 8, 16, 16);
  });
  return c;
}

// Геометрия с UV в метрах (tile — размер плитки текстуры, м)
function boxUV(w, h, d, tile = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    uv.setXY(k, uv.getX(k) * dims[f][0] / tile, uv.getY(k) * dims[f][1] / tile);
  }
  return g;
}

function std(o) { return new THREE.MeshStandardMaterial(o); }

// Плакат/надпись на холсте
function poster(lines, { w = 512, h = 700, bg = '#efe6cf', fg = '#202020', title = '#8a1a12', font = 30 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(80,60,30,${Math.random() * 0.05})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  g.strokeStyle = title; g.lineWidth = 8; g.strokeRect(14, 14, w - 28, h - 28);
  g.textAlign = 'center';
  lines.forEach((l, i) => {
    g.fillStyle = i === 0 ? title : fg;
    g.font = `bold ${i === 0 ? font * 1.35 : font}px Arial`;
    g.fillText(l, w / 2, 80 + i * font * 1.6);
  });
  return canvasTex(c);
}

export class HQ {
  constructor(app) {
    this.app = app;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xb9c4cc);
    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 200);
    this.pos = new THREE.Vector3(0, 0, 4.2); this.yaw = 0; this.pitch = -0.05;
    this.colliders = [];
    this.interact = [];
    this.actors = [];
    this.current = null;
    this.t = 0;
  }

  box(w, h, d, mat, x, y, z, collide = true, ry = 0, tile = 1) {
    const m = new THREE.Mesh(boxUV(w, h, d, tile), mat);
    m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true;
    this.scene.add(m);
    if (collide) {
      const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
      const hw = (w * c + d * s) / 2, hd = (w * s + d * c) / 2;
      this.colliders.push({ x0: x - hw - 0.3, x1: x + hw + 0.3, z0: z - hd - 0.3, z1: z + hd + 0.3 });
    }
    return m;
  }

  // Модель Poly Haven (если есть): положение, поворот, масштаб; collide — радиус препятствия
  prop(name, x, y, z, ry = 0, { scale = 1, collide = 0, shadow = true } = {}) {
    const g = model(name);
    if (!g) return null;
    const o = g.scene.clone(true);
    o.position.set(x, y, z); o.rotation.y = ry; o.scale.setScalar(scale);
    o.traverse((m) => { if (m.isMesh) { m.castShadow = shadow; m.receiveShadow = true; } });
    this.scene.add(o);
    if (collide) this.colliders.push({ x0: x - collide - 0.3, x1: x + collide + 0.3, z0: z - collide - 0.3, z1: z + collide + 0.3 });
    return o;
  }

  build(progress) {
    const S = this.scene;
    const W = 18, D = 12, H = 3.2, T = 0.3;
    this.W = W; this.D = D; this.H = H;
    // ---------- материалы ----------
    const floorM = pbr('old_wood_floor', { color: 0xd6c2a8, roughness: 0.85, normalScale: 0.8 }) || std({ map: woodTexture(1), roughness: 0.8 });
    const plaster = (color) => pbr('plastered_wall_02', { color, roughness: 1, normalScale: 0.6 }) || std({ color, roughness: 0.95 });
    const wallUp = plaster(0xf1ede2);
    const wallLow = plaster(0x6f8466);
    const ceilM = pbr('white_stucco', { color: 0xf3f1ea, roughness: 1, normalScale: 0.5 }) || std({ color: 0xeeeae0 });
    const beamM = pbr('brown_planks_05', { color: 0x8a7a68, roughness: 0.9 }) || std({ color: 0x5a4430 });
    const trimM = std({ color: 0x3a2a1c, roughness: 0.6 });
    const tableTop = pbr('fine_grained_wood', { color: 0xa88a6a, roughness: 0.55 }) || std({ map: woodTexture(1) });
    const metalM = pbr('metal_plate', { color: 0x6c7a6a, roughness: 0.6, metalness: 0.6 }) || std({ color: 0x5a6a5a, metalness: 0.4 });
    const doorM = pbr('green_metal_rust', { color: 0x9aa59a, roughness: 0.7, metalness: 0.4 }) || std({ color: 0x4a5a4a });
    const carpet = pbr('dirty_carpet', { color: 0x7a4a3a, roughness: 1 });
    // ---------- пол, потолок, балки ----------
    const fl = new THREE.Mesh(boxUV(W, 0.1, D, 2.2), floorM); fl.position.y = -0.05; fl.receiveShadow = true; S.add(fl);
    const cl = new THREE.Mesh(boxUV(W, 0.1, D, 3), ceilM); cl.position.y = H + 0.05; cl.receiveShadow = true; S.add(cl);
    for (let x = -7.5; x <= 7.5; x += 3) this.box(0.22, 0.26, D, beamM, x, H - 0.13, 0, false, 0, 1.5);
    if (carpet) { const c = new THREE.Mesh(boxUV(5.2, 0.012, 3.8, 1.2), carpet); c.position.set(0, 0.006, 0.2); c.receiveShadow = true; S.add(c); }
    // ---------- стены с проёмами ----------
    // стена: длина L вдоль оси, проёмы [{c, w, y0, y1}] (c — центр вдоль стены)
    const wall = (L, along, fixed, holes, axis) => {
      const segs = [];
      const xs = [-L / 2];
      for (const h of holes.sort((a, b) => a.c - b.c)) xs.push(h.c - h.w / 2, h.c + h.w / 2);
      xs.push(L / 2);
      for (let i = 0; i < xs.length; i += 2) if (xs[i + 1] - xs[i] > 0.01) segs.push([xs[i], xs[i + 1], 0, H]);
      for (const h of holes) { if (h.y0 > 0) segs.push([h.c - h.w / 2, h.c + h.w / 2, 0, h.y0]); segs.push([h.c - h.w / 2, h.c + h.w / 2, h.y1, H]); }
      for (const [a, b, y0, y1] of segs) {
        // нижняя часть (панель) и верх — разными материалами
        const parts = [];
        if (y0 < 1.45) parts.push([y0, Math.min(y1, 1.45), wallLow]);
        if (y1 > 1.45) parts.push([Math.max(y0, 1.45), y1, wallUp]);
        for (const [p0, p1, m] of parts) {
          const len = b - a, hh = p1 - p0;
          if (hh < 0.005) continue;
          const c = (a + b) / 2;
          if (axis === 'x') this.box(len, hh, T, m, c, (p0 + p1) / 2, fixed, false, 0, 2);
          else this.box(T, hh, len, m, fixed, (p0 + p1) / 2, c, false, 0, 2);
        }
      }
      // плинтус и разделительная полоса краски
      const pieces = [];
      const xs2 = [-L / 2];
      for (const h of holes.filter((q) => q.y0 <= 0.01)) xs2.push(h.c - h.w / 2, h.c + h.w / 2);
      xs2.push(L / 2);
      for (let i = 0; i < xs2.length; i += 2) pieces.push([xs2[i], xs2[i + 1]]);
      const inward = fixed < 0 ? 1 : -1;
      for (const [a, b] of pieces) {
        const len = b - a, c = (a + b) / 2;
        if (len < 0.05) continue;
        if (axis === 'x') { this.box(len, 0.12, 0.03, trimM, c, 0.06, fixed + inward * (T / 2 + 0.015), false); }
        else this.box(0.03, 0.12, len, trimM, fixed + inward * (T / 2 + 0.015), 0.06, c, false);
      }
      if (axis === 'x') this.box(L, 0.025, 0.02, trimM, 0, 1.45, fixed + inward * (T / 2 + 0.01), false);
      else this.box(0.02, 0.025, L, trimM, fixed + inward * (T / 2 + 0.01), 1.45, 0, false);
    };
    const winH = { y0: 1.0, y1: 2.35 };
    this.windows = [{ x: -4.5, w: 1.7 }, { x: 0.6, w: 1.7 }];
    wall(W, 'x', D / 2 + T / 2, [...this.windows.map((w) => ({ c: w.x, w: w.w, ...winH })), { c: 4.5, w: 1.3, y0: 0, y1: 2.25 }], 'x');
    wall(W, 'x', -D / 2 - T / 2, [{ c: 7.2, w: 1.1, y0: 0, y1: 2.15 }], 'x');
    wall(D, 'z', -W / 2 - T / 2, [], 'z');
    wall(D, 'z', W / 2 + T / 2, [{ c: 4.2, w: 1.5, ...winH }], 'z');
    this.colliders.push({ x0: -99, x1: 99, z0: -99, z1: -D / 2 + 0.35 }, { x0: -99, x1: 99, z0: D / 2 - 0.35, z1: 99 }, { x0: -99, x1: -W / 2 + 0.35, z0: -99, z1: 99 }, { x0: W / 2 - 0.35, x1: 99, z0: -99, z1: 99 });
    // окна: рамы, переплёт, подоконник, стекло
    const frameM = std({ color: 0xe8e4da, roughness: 0.5 });
    const glassM = new THREE.MeshStandardMaterial({ color: 0xdfe8ee, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.16, depthWrite: false });
    const addWindow = (x, z, w, rot) => {
      const g = new THREE.Group();
      const h = winH.y1 - winH.y0;
      const bar = (bw, bh, bx, by) => { const m = new THREE.Mesh(boxUV(bw, bh, 0.08), frameM); m.position.set(bx, by, 0); m.castShadow = true; g.add(m); };
      bar(w, 0.07, 0, winH.y0 + 0.035); bar(w, 0.07, 0, winH.y1 - 0.035);
      bar(0.07, h, -w / 2 + 0.035, (winH.y0 + winH.y1) / 2); bar(0.07, h, w / 2 - 0.035, (winH.y0 + winH.y1) / 2);
      bar(0.05, h, 0, (winH.y0 + winH.y1) / 2); bar(w, 0.05, 0, winH.y0 + h * 0.62);
      const gl = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassM); gl.position.set(0, (winH.y0 + winH.y1) / 2, 0); g.add(gl);
      const sill = new THREE.Mesh(boxUV(w + 0.16, 0.04, 0.32), frameM); sill.position.set(0, winH.y0 - 0.02, -0.12); sill.castShadow = true; sill.receiveShadow = true; g.add(sill);
      // батарея под окном
      for (let i = 0; i < 9; i++) { const r = new THREE.Mesh(boxUV(0.06, 0.55, 0.09), std({ color: 0xd8d4c8, roughness: 0.4, metalness: 0.3 })); r.position.set(-0.4 + i * 0.1, 0.55, -0.22); r.castShadow = true; g.add(r); }
      g.position.set(x, 0, z); g.rotation.y = rot;
      S.add(g);
    };
    for (const w of this.windows) addWindow(w.x, D / 2, w.w, Math.PI);
    addWindow(W / 2, 4.2, 1.5, -Math.PI / 2);
    // снаружи — снег до горизонта (фон — HDRI)
    const outside = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), std({ color: 0xf2f5f7, roughness: 0.95 }));
    outside.rotation.x = -Math.PI / 2; outside.position.y = -0.3; S.add(outside);
    // ---------- освещение ----------
    S.add(new THREE.HemisphereLight(0xe6eef6, 0x6a5a48, 0.75));
    const hdri = hdrAsset('snowy_field');
    if (hdri) {
      hdri.mapping = THREE.EquirectangularReflectionMapping;
      const pm = new THREE.PMREMGenerator(this.app.renderer);
      const env = pm.fromEquirectangular(hdri).texture;
      S.environment = env; S.environmentIntensity = 0.32;
      S.background = hdri; S.backgroundIntensity = 1.0;
      pm.dispose();
    }
    // низкое полярное солнце через южные окна
    const sun = new THREE.DirectionalLight(0xffe2bf, 3.2);
    sun.position.set(-7, 6.5, 16); sun.target.position.set(1, 0, 0);
    sun.castShadow = true; sun.shadow.mapSize.set(this.app.settings.quality === 'high' ? 2048 : 1024, this.app.settings.quality === 'high' ? 2048 : 1024);
    Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 10, bottom: -10, near: 1, far: 50 });
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
    S.add(sun, sun.target);
    // люминесцентные светильники: светятся сами (свечение — через bloom), зал освещают 3 точечных источника
    const tubeM = std({ color: 0xffffff, emissive: 0xf4f8ff, emissiveIntensity: 3 });
    for (const [x, z] of [[-1.5, -3.2], [-1.5, 0.8], [1.5, -3.2], [1.5, 0.8], [6, -3], [6, 2], [-1.5, 4.2], [1.5, 4.2]]) {
      const f = this.prop('mounted_fluorescent_lights', x, H - 0.06, z, Math.PI / 2, { shadow: false });
      if (f) f.traverse((m) => { if (m.isMesh && /tube|light|bulb|glass/i.test(m.material.name || m.name)) m.material = tubeM; });
      else this.box(1.2, 0.05, 0.22, tubeM, x, H - 0.05, z, false);
    }
    for (const [x, z, i] of [[0, -2.0, 9], [0, 2.6, 7], [6, -0.5, 7]]) {
      const l = new THREE.PointLight(0xf2f2ec, i, 11, 1.3); l.position.set(x, H - 0.45, z); S.add(l);
    }
    this.hangLamp(0, 0.2, H);
    // ---------- стенд таблиц стрельбы ----------
    const board = buildBoardCanvas();
    this.boardCanvas = board;
    const bm = new THREE.Mesh(new THREE.PlaneGeometry(8, 3), std({ map: canvasTex(board), color: 0xd2cfc8, roughness: 0.9 }));
    bm.position.set(0, 1.75, -D / 2 + 0.05); S.add(bm);
    this.box(8.3, 3.25, 0.05, trimM, 0, 1.75, -D / 2 + 0.02, false);
    this.prop('industrial_wall_lamp', -4.4, 2.6, -D / 2 + 0.05, 0);
    this.prop('industrial_wall_lamp', 4.4, 2.6, -D / 2 + 0.05, 0);
    this.interact.push({ pos: new THREE.Vector3(0, 1.6, -D / 2 + 1.2), r: 3.2, label: 'Изучить таблицы стрельбы и графики траекторий', act: () => this.app.ui.firingTables() });
    // ---------- стол с картой операций ----------
    this.box(4.1, 0.07, 2.7, tableTop, 0, 0.8, 0.2, true, 0, 1.5);
    for (const [x, z] of [[-1.9, -1.0], [1.9, -1.0], [-1.9, 1.4], [1.9, 1.4]]) this.box(0.09, 0.77, 0.09, trimM, x, 0.385, z, false);
    this.box(3.7, 0.08, 0.05, trimM, 0, 0.2, -1.0, false); this.box(3.7, 0.08, 0.05, trimM, 0, 0.2, 1.4, false);
    const mapT = canvasTex(mapCanvas(progress));
    const mp = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.25), std({ map: mapT, color: 0xd8d4c8, roughness: 0.95 }));
    mp.rotation.x = -Math.PI / 2; mp.position.set(0, 0.837, 0.2); mp.receiveShadow = true; S.add(mp);
    this.prop('binoculars', -1.2, 0.84, 1.1, 0.6);
    this.prop('clipboard', 1.5, 0.84, -0.6, -0.3);
    this.prop('office_notepads', 1.25, 0.835, 0.9, 0.2, { scale: 0.5 });
    this.prop('tea_set_01', -1.4, 0.835, -0.65, 0.4, { scale: 0.7 });
    for (const [x, z, r] of [[-1.1, -1.55, 0], [0.9, -1.55, 0.1], [-2.55, 0.2, Math.PI / 2], [2.55, 0.5, -Math.PI / 2], [-0.8, 1.95, Math.PI], [1.0, 1.95, Math.PI + 0.2]]) this.prop('SchoolChair_01', x, 0, z, r);
    this.interact.push({ pos: new THREE.Vector3(0, 0.9, 0.2), r: 2.8, label: 'Карта операций — выбор задания и брифинг', act: () => this.app.ui.operations() });
    // ---------- личный состав, эмблема (восточная стена) ----------
    const rm = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.6), std({ map: canvasTex(rosterCanvas()), roughness: 0.9 }));
    rm.position.set(W / 2 - 0.05, 1.7, -1.5); rm.rotation.y = -Math.PI / 2; S.add(rm);
    this.box(0.04, 2.75, 4.35, trimM, W / 2 - 0.02, 1.7, -1.5, false);
    this.interact.push({ pos: new THREE.Vector3(W / 2 - 1, 1.6, -1.5), r: 3, label: 'Личный состав — характеристики и состав отделения', act: () => this.app.ui.roster() });
    const em = document.createElement('canvas'); em.width = em.height = 512;
    const eg = em.getContext('2d');
    eg.fillStyle = '#1b2a40'; eg.beginPath(); eg.moveTo(256, 20); eg.lineTo(480, 120); eg.lineTo(440, 380); eg.lineTo(256, 492); eg.lineTo(72, 380); eg.lineTo(32, 120); eg.closePath(); eg.fill();
    eg.strokeStyle = '#e8eef4'; eg.lineWidth = 12; eg.stroke();
    eg.fillStyle = '#e8eef4'; eg.font = 'bold 108px Arial'; eg.textAlign = 'center'; eg.fillText('N.E.G.S', 256, 240);
    eg.font = 'bold 40px Arial'; eg.fillText('ЗАПОЛЯРЬЕ', 256, 320);
    eg.strokeStyle = '#7fd0ff'; eg.lineWidth = 6; for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; eg.beginPath(); eg.moveTo(256, 400); eg.lineTo(256 + Math.cos(a) * 44, 400 + Math.sin(a) * 44); eg.stroke(); }
    const emm = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), std({ map: canvasTex(em), transparent: true, roughness: 0.6 }));
    emm.position.set(W / 2 - 0.05, 2.0, 1.9); emm.rotation.y = -Math.PI / 2; S.add(emm);
    // ---------- пост дежурного: стол, радиостанция, лампа ----------
    this.prop('metal_office_desk', 6.2, 0, -4.75, 0, { collide: 0.8 }) || this.box(1.8, 0.78, 0.8, metalM, 6.2, 0.39, -4.75);
    this.prop('vintage_radio_transceiver', 5.6, 0.79, -5.05, 0.15, { scale: 0.9 });
    this.prop('Television_01', 6.85, 0.79, -5.05, -0.2, { scale: 0.85 });
    this.prop('desk_lamp_arm_01', 7.0, 0.79, -4.5, -0.8);
    this.prop('office_notepads', 6.3, 0.795, -4.55, 0.1, { scale: 0.45 });
    this.prop('SchoolChair_01', 6.2, 0, -3.95, 0);
    this.prop('wall_clock', 6.2, 2.55, -D / 2 + 0.03, 0, { scale: 1.2 });
    this.prop('power_box_01', 8.6, 1.4, -5.2, -Math.PI / 2, { scale: 0.8 });
    // дверь в коридор (закрыта)
    this.door(7.2, -D / 2 + 0.02, 1.1, 2.15, 0, doorM, trimM, ['КОРИДОР', 'посторонним вход воспрещён']);
    // доска брифинга
    const bc = this.prop('standing_chalkboard_01', 4.9, 0, -4.9, -0.25);
    // ---------- печка-буржуйка, дрова, ящики ----------
    this.prop('barrel_stove', 7.9, 0, 5.1, -0.6, { collide: 0.45 });
    const pipeM = std({ color: 0x2a2a2a, roughness: 0.6, metalness: 0.6 });
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, H - 0.9, 14), pipeM); pipe.position.set(7.9, 0.9 + (H - 0.9) / 2, 5.1); pipe.castShadow = true; S.add(pipe);
    const fire = new THREE.PointLight(0xff8a3a, 2.5, 4, 2); fire.position.set(7.9, 0.45, 4.7); S.add(fire);
    this.fire = fire;
    const logM = pbr('bark_brown_02', { roughness: 1 }) || std({ color: 0x5a4030 });
    for (let i = 0; i < 12; i++) { const lg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.5, 9), logM); lg.rotation.z = Math.PI / 2; lg.position.set(8.55, 0.08 + Math.floor(i / 4) * 0.14, 3.9 + (i % 4) * 0.16 + (Math.floor(i / 4) % 2) * 0.07); lg.castShadow = true; lg.receiveShadow = true; S.add(lg); }
    this.prop('drawer_cabinet', 8.6, 0, 2.6, -Math.PI / 2, { collide: 0.5 });
    this.prop('korean_fire_extinguisher_01', 5.55, 0, 5.75, Math.PI);
    this.prop('metal_jerrycan', 3.4, 0, 5.7, 0.2);
    this.prop('metal_jerrycan', 3.75, 0, 5.72, -0.1);
    this.prop('cardboard_box_01', -2.0, 0, -5.55, 0.1);
    this.prop('cardboard_box_01', -2.0, 0.34, -5.5, 0.4, { scale: 0.85 });
    this.prop('wooden_military_crate', -3.2, 0, -5.4, 0.05, { collide: 0.4 });
    this.prop('old_tyre', 2.9, 0.08, 5.65, 0, { scale: 1 }) && null;
    // плакаты
    const pst = (tex, x, y, z, ry, w = 0.75, h = 1.02) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), std({ map: tex, roughness: 0.9 })); m.position.set(x, y, z); m.rotation.y = ry; S.add(m); };
    pst(poster(['БДИТЕЛЬНОСТЬ', 'Противник', 'слушает эфир!', 'Соблюдай', 'режим радиомолчания', '', 'N.E.G.S']), 2.5, 1.9, D / 2 - 0.02, Math.PI);
    pst(poster(['ПВД «ПОЛЯРНЫЙ ЛИС»', 'Распорядок дня', '06:00 подъём', '06:30 зарядка', '08:00 развод', '13:00 обед', '22:00 отбой'], { bg: '#e8eef2', title: '#1b2a40' }), -2.3, 1.9, D / 2 - 0.02, Math.PI);
    pst(poster(['ОРУЖИЕ —', 'чистить ежедневно', 'Мороз −40 °C:', 'смазка ЦИАТИМ-201', 'Затвор — в тепле', 'не держать']), -8.95, 1.9, 3.6, Math.PI / 2);
    // ---------- КХО ----------
    this.buildKHO(W, D, H, trimM, metalM, doorM);
    // ---------- дверь в автопарк ----------
    this.door(4.5, D / 2 - 0.02, 1.3, 2.25, Math.PI, doorM, trimM, ['АВТОПАРК', '«Тигр» · «Нива» · МТ-ЛБ'], '#1b2a40');
    this.interact.push({ pos: new THREE.Vector3(4.5, 1.2, D / 2 - 0.5), r: 2.4, label: 'Автопарк — выбрать технику на задание', act: () => this.app.ui.motorPool() });
    // ---------- люди ----------
    this.buildPeople();
  }

  hangLamp(x, z, H) {
    const m = std({ color: 0x2c3a2c, roughness: 0.5, metalness: 0.5 });
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.2, 20, 1, true), m); shade.position.set(x, H - 0.55, z); shade.material.side = THREE.DoubleSide; this.scene.add(shade);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.45, 6), std({ color: 0x111111 })); cord.position.set(x, H - 0.225, z); this.scene.add(cord);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), std({ color: 0xffffff, emissive: 0xffe0b0, emissiveIntensity: 4 })); bulb.position.set(x, H - 0.66, z); this.scene.add(bulb);
  }

  door(x, z, w, h, ry, doorM, trimM, lines, bg = '#7a1c14') {
    const g = new THREE.Group();
    const leaf = new THREE.Mesh(boxUV(w - 0.06, h - 0.04, 0.05), doorM); leaf.position.set(0, h / 2, 0.03); leaf.castShadow = true; leaf.receiveShadow = true; g.add(leaf);
    for (const [bw, bh, bx, by] of [[0.08, h, -w / 2, h / 2], [0.08, h, w / 2, h / 2], [w + 0.16, 0.08, 0, h + 0.04]]) { const f = new THREE.Mesh(boxUV(bw, bh, 0.1), trimM); f.position.set(bx, by, 0.02); g.add(f); }
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.14, 10), new THREE.MeshStandardMaterial({ color: 0xb0b0b0, metalness: 1, roughness: 0.3 }));
    handle.rotation.z = Math.PI / 2; handle.position.set(w / 2 - 0.15, 1.0, 0.08); g.add(handle);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.9, 0.32), new THREE.MeshStandardMaterial({ map: textTexture(lines, { w: 512, h: 160, bg, fg: '#f3efe2', font: 'bold 40px Arial' }), roughness: 0.6 }));
    sign.position.set(0, h + 0.3, 0.02); g.add(sign);
    g.position.set(x, 0, z); g.rotation.y = ry;
    this.scene.add(g);
  }

  buildKHO(W, D, H, trimM, metalM, doorM) {
    const S = this.scene;
    const KX = -4.6, KZ = 2.2;
    const wallM = pbr('plastered_wall_02', { color: 0xd8d4c6, roughness: 1, normalScale: 0.6 }) || std({ color: 0xd8d4c6 });
    const lowM = pbr('plastered_wall_02', { color: 0x6f8466, roughness: 1, normalScale: 0.6 }) || std({ color: 0x6f8466 });
    // перегородки с дверным проёмом z∈[-1.6,-0.2]
    const part = (w, h, d, x, y, z, coll = true) => { this.box(w, Math.min(h, 1.45 - (y - h / 2)), d, lowM, x, (y - h / 2) + Math.min(h, 1.45 - (y - h / 2)) / 2, z, coll, 0, 2); if (y + h / 2 > 1.45) this.box(w, y + h / 2 - Math.max(1.45, y - h / 2), d, wallM, x, (Math.max(1.45, y - h / 2) + y + h / 2) / 2, z, false, 0, 2); };
    part(0.18, H, 6 - 1.6, KX, H / 2, (-6 + -1.6) / 2);
    part(0.18, H, KZ + 0.2, KX, H / 2, (-0.2 + KZ) / 2);
    this.box(0.18, H - 2.2, 1.4, wallM, KX, 2.2 + (H - 2.2) / 2, -0.9, false, 0, 2);
    part(W / 2 + KX, H, 0.18, (-W / 2 + KX) / 2, H / 2, KZ);
    // решётчатая дверь (открыта)
    const bars = new THREE.Group();
    const barM = std({ color: 0x3a3d40, metalness: 0.8, roughness: 0.35 });
    for (let i = 0; i < 8; i++) { const bb = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 2.1, 8), barM); bb.position.set(0, 1.05, -0.65 + i * 0.18); bb.castShadow = true; bars.add(bb); }
    for (const y of [0.15, 1.05, 2.0]) { const bb = new THREE.Mesh(boxUV(0.03, 0.04, 1.4), barM); bb.position.set(0, y, 0); bars.add(bb); }
    bars.position.set(KX + 0.7, 0, -1.6); bars.rotation.y = 1.2; S.add(bars);
    const khoSign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.35), std({ map: textTexture(['КХО', 'комната хранения оружия'], { w: 512, h: 150, bg: '#7a1c14', fg: '#f3efe2', font: 'bold 38px Arial' }), roughness: 0.6 }));
    khoSign.position.set(KX + 0.1, 2.5, -0.9); khoSign.rotation.y = Math.PI / 2; S.add(khoSign);
    const lampK = new THREE.PointLight(0xfff0d8, 5, 8, 1.6); lampK.position.set(-6.8, H - 0.35, -2); S.add(lampK);
    const tubeM = std({ color: 0xffffff, emissive: 0xf4f8ff, emissiveIntensity: 3 });
    if (!this.prop('mounted_fluorescent_lights', -6.8, H - 0.06, -2, 0, { shadow: false })) this.box(1.2, 0.05, 0.22, tubeM, -6.8, H - 0.05, -2, false);
    // оружейный щит: доска с крюками, оружие горизонтально
    const KINDS = [['ak74m', 'ak74'], ['ak74m_gp', 'ak74gp'], ['ak74m_1p78', 'ak74scope'], ['akm', 'akm'], ['svd', 'svd'], ['pkm', 'pkm']];
    const rackMat = pbr('fine_grained_wood', { color: 0x8a6a4a, roughness: 0.6 }) || std({ map: woodTexture(0) });
    this.box(0.08, 2.0, 5.4, rackMat, -W / 2 + 0.04, 1.3, -2.8, false, 0, 1.2);
    this.colliders.push({ x0: -99, x1: -W / 2 + 0.8, z0: -6, z1: 0.3 });
    this.khoLabels = [];
    KINDS.forEach(([id, kind], i) => {
      const z = i % 2 ? -1.6 : -4.1, y = [2.05, 1.5, 0.95][Math.floor(i / 2)];
      const G = buildGun(kind, { shadow: true }).root;
      G.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      G.position.set(-W / 2 + 0.17, y + 0.04, z + (kind === 'svd' || kind === 'pkm' ? 0.32 : 0.22));
      S.add(G);
      for (const dz of [-0.28, 0.24]) { const hk = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 6), metalM); hk.rotation.z = Math.PI / 2; hk.position.set(-W / 2 + 0.13, y - 0.11, z + dz); S.add(hk); }
      const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.13), std({ map: textTexture([WEAPONS[id].name], { w: 384, h: 90, bg: '#efe9d8', fg: '#111', font: 'bold 40px Arial' }), roughness: 0.8 }));
      lbl.position.set(-W / 2 + 0.09, y - 0.21, z); lbl.rotation.y = Math.PI / 2; S.add(lbl);
      const mark = new THREE.Mesh(new THREE.CircleGeometry(0.035, 16), new THREE.MeshBasicMaterial({ color: 0x40ff60 }));
      mark.position.set(-W / 2 + 0.09, y - 0.21, z + 0.38); mark.rotation.y = Math.PI / 2; S.add(mark);
      this.khoLabels.push({ id, mark });
      this.interact.push({ pos: new THREE.Vector3(-W / 2 + 0.6, y, z), r: 1.6, label: `Взять ${WEAPONS[id].name} (${WEAPONS[id].cls})`, act: () => { this.app.save.primary = id; this.app.persist(); this.updateKho(); this.app.ui.toast(`Основное оружие: ${WEAPONS[id].name}`); } });
    });
    // РПГ-7В на северной стене
    const rpg = buildGun('rpg7', { shadow: true }).root;
    rpg.position.set(-7.4, 1.5, -D / 2 + 0.22); rpg.rotation.y = -Math.PI / 2; rpg.rotation.z = 0; rpg.rotation.order = 'YXZ';
    rpg.rotation.set(0, Math.PI / 2, 0);
    S.add(rpg);
    this.box(1.6, 0.05, 0.22, rackMat, -7.4, 1.3, -D / 2 + 0.16, false);
    this.rpgMark = new THREE.Mesh(new THREE.CircleGeometry(0.05, 16), new THREE.MeshBasicMaterial({ color: 0x40ff60 }));
    this.rpgMark.position.set(-6.5, 1.28, -D / 2 + 0.28); this.scene.add(this.rpgMark);
    this.interact.push({ pos: new THREE.Vector3(-7.4, 1.45, -D / 2 + 0.5), r: 1.8, label: 'Взять / сдать РПГ-7В (3 выстрела ПГ-7ВМ)', act: () => { this.app.save.launcher = !this.app.save.launcher; this.app.persist(); this.updateKho(); this.app.ui.toast(this.app.save.launcher ? 'РПГ-7В взят' : 'РПГ-7В сдан'); } });
    // стеллажи с ящиками, инструментальный ящик
    this.prop('worn_metal_rack', -5.3, 0, -5.55, 0, { collide: 0.4 });
    this.prop('steel_frame_shelves_02', -8.6, 0, 1.4, Math.PI / 2, { collide: 0.35 });
    this.prop('metal_tool_chest', -5.3, 0, 1.75, Math.PI, { collide: 0.35 });
    this.prop('ammo_box', -5.45, 0.98, -5.5, 0.1, { scale: 0.9 });
    this.prop('old_military_crate', -6.3, 0, -5.4, 0.05, { collide: 0.4 });
    this.prop('old_gas_mask', -5.2, 1.35, -5.5, 0.4);
    // стол снаряжения магазинов
    this.box(1.6, 0.06, 0.8, rackMat, -6.4, 0.8, -1.6, true, 0, 1);
    for (const [x, z] of [[-7.1, -1.9], [-5.7, -1.9], [-7.1, -1.3], [-5.7, -1.3]]) this.box(0.06, 0.8, 0.06, trimM, x, 0.4, z, false);
    const amb = model('ammo_box');
    if (amb) for (const [x, z, ry] of [[-6.9, -1.7, 0.3], [-6.3, -1.45, -0.2]]) { const o = amb.scene.clone(true); o.position.set(x, 0.83, z); o.rotation.y = ry; o.traverse((m) => { if (m.isMesh) m.castShadow = true; }); S.add(o); }
    const magM = std({ color: 0x5c2a1c, roughness: 0.45 });
    for (let i = 0; i < 4; i++) { const mg = new THREE.Mesh(boxUV(0.027, 0.21, 0.075), magM); mg.position.set(-5.95 + i * 0.05, 0.94, -1.75); mg.rotation.z = 0.2; mg.castShadow = true; S.add(mg); }
    this.interact.push({ pos: new THREE.Vector3(-6.4, 0.9, -1.6), r: 1.8, label: 'Снаряжение магазинов и ленты (трассеры, бронебойные…)', act: () => this.app.ui.magLoader() });
    this.updateKho();
  }

  buildPeople() {
    const S = this.scene;
    if (!charAvailable('negs')) {
      const cmd = new SoldierModel('officer', 'ak');
      cmd.weapon.visible = false;
      cmd.root.position.set(2.6, 0, -0.9); cmd.root.rotation.y = 0.4;
      cmd.update(0.5, { speed: 0, stance: 'stand', aimPitch: -0.1, aiming: false });
      S.add(cmd.root);
      this.interact.push({ pos: new THREE.Vector3(2.6, 1.5, -0.9), r: 2, label: 'Майор Волков — доклад', act: () => this.app.ui.commanderTalk() });
      return;
    }
    const add = (a, x, z, ry) => { a.root.position.set(x, 0, z); a.root.rotation.y = ry; a.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } }); S.add(a.root); this.actors.push(a); return a; };
    // командир у карты
    add(new ClipActor('officer', 'Talking'), 2.75, -1.35, 0.55);
    this.interact.push({ pos: new THREE.Vector3(2.75, 1.5, -1.35), r: 2, label: 'Майор Волков — доклад', act: () => this.app.ui.commanderTalk() });
    // дежурный за радиостанцией
    add(new ClipActor('negs', 'Typing'), 6.2, -4.02, 0);
    // бойцы отделения: двое на скамье, двое стоят с оружием
    this.prop('painted_wooden_bench', -2.9, 0, 5.45, Math.PI, { collide: 0.6 });
    this.prop('painted_wooden_bench', -6.2, 0, 5.45, Math.PI, { collide: 0.6 });
    add(new ClipActor('negs', 'Sitting_Idle'), -3.2, 5.33, Math.PI);
    add(new ClipActor('negs', 'Sitting_Idle', { t0: 1.3 }), -6.0, 5.33, Math.PI);
    const g1 = new CharAnimator('negs', thirdPersonGun('ak74'));
    const g2 = new CharAnimator('negs', thirdPersonGun('svd'));
    for (const [g, x, z, ry] of [[g1, -1.2, 4.6, Math.PI + 0.5], [g2, -4.6, 4.5, Math.PI - 0.4]]) {
      g.hq = { yaw: ry };
      add(g, x, z, ry);
    }
    this.colliders.push({ x0: -1.6, x1: -0.8, z0: 4.2, z1: 5.0 }, { x0: -5.0, x1: -4.2, z0: 4.1, z1: 4.9 }, { x0: 2.4, x1: 3.1, z0: -1.7, z1: -1.0 });
  }

  updateKho() {
    const s = this.app.save;
    for (const l of this.khoLabels || []) l.mark.visible = l.id === s.primary;
    if (this.rpgMark) this.rpgMark.visible = !!s.launcher;
  }

  enter() {
    this.pos.set(0, 0, 4.2); this.yaw = 0; this.pitch = -0.05;
  }

  update(dt) {
    const inp = this.app.input, s = this.app.settings;
    this.t += dt;
    // живые люди и огонь в печке
    for (const a of this.actors) {
      if (a.hq) {
        a.root.updateMatrixWorld(true);
        a.update(dt, { speed: 0, stance: 'stand', aimYaw: a.hq.yaw + Math.sin(this.t * 0.3 + a.hq.yaw) * 0.25, aimPitch: -0.15, aiming: false, dead: false, reload: -1 });
      } else a.update(dt);
    }
    if (this.fire) this.fire.intensity = 2.2 + Math.sin(this.t * 13) * 0.3 + Math.sin(this.t * 7.3) * 0.4;
    if (this.app.ui.isOpen()) return;
    const sens = s.sens * 0.001;
    this.yaw -= inp.dx * sens; this.pitch = clamp(this.pitch - inp.dy * sens * (s.invertY ? -1 : 1), -1.3, 1.3);
    let ix = 0, iz = 0;
    if (inp.bd('moveF')) iz -= 1; if (inp.bd('moveB')) iz += 1; if (inp.bd('moveL')) ix -= 1; if (inp.bd('moveR')) ix += 1;
    const l = Math.hypot(ix, iz) || 1;
    const sp = (inp.bd('sprint') ? 3.6 : 2.2) * dt;
    const c = Math.cos(this.yaw), sn = Math.sin(this.yaw);
    const nx = this.pos.x + ((c * ix + sn * iz) / l) * sp, nz = this.pos.z + ((-sn * ix + c * iz) / l) * sp;
    const blocked = (x, z) => this.colliders.some((b) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1);
    if (!blocked(nx, this.pos.z)) this.pos.x = nx;
    if (!blocked(this.pos.x, nz)) this.pos.z = nz;
    this.camera.position.set(this.pos.x, 1.65 + Math.sin(this.t * 7) * 0.008 * (ix || iz ? 1 : 0), this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    // ближайший объект взаимодействия
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    let best = null, bs = -1;
    for (const it of this.interact) {
      const to = it.pos.clone().sub(this.camera.position);
      const d = to.length();
      if (d > it.r + 1) continue;
      const dot = to.normalize().dot(fwd);
      if (dot > 0.75 && dot > bs) { bs = dot; best = it; }
    }
    this.current = best;
    this.app.ui.hqPrompt(best ? best.label : null);
    if (best && inp.bh('use')) best.act();
  }

  render() {
    const r = this.app.renderer;
    r.autoClear = true;
    r.toneMappingExposure = 1.12;
    if (this.camera.aspect !== innerWidth / innerHeight) { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }
    this.app.post.preset('day');
    this.app.post.bloom.enabled = this.app.settings.quality !== 'low';
    this.app.post.setAO(true);
    // помещение неподвижно: тени пересчитываем не каждый кадр
    r.shadowMap.autoUpdate = false;
    this._shadowTick = (this._shadowTick || 0) + 1;
    if (this._shadowTick % 4 === 1) r.shadowMap.needsUpdate = true;
    this.app.post.render(this.scene, this.camera, null, null);
  }
}
