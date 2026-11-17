// Штаб (ПВД «Полярный Лис»): 3D-помещение со стендом таблиц стрельбы, картой операций,
// стендом личного состава, оружейной пирамидой и выходом в автопарк.
import * as THREE from 'three';
import { buildFiringTable, TABLE_WEAPONS } from '../physics/firingTable.js';
import { drawChart, drawTable } from '../ui/charts.js';
import { woodTexture, textTexture } from '../world/textures.js';
import { SoldierModel, buildThirdPersonWeapon } from '../entities/soldierModel.js';
import { MISSIONS } from '../data/missions.js';
import { WEAPONS } from '../data/weapons.js';
import { ViewModel } from '../weapons/viewmodel.js';
import { model } from '../core/assets.js';
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

export class HQ {
  constructor(app) {
    this.app = app;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1e22);
    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 80);
    this.pos = new THREE.Vector3(0, 0, 4.2); this.yaw = 0; this.pitch = -0.05;
    this.colliders = [];
    this.interact = [];
    this.current = null;
    this.t = 0;
  }

  box(w, h, d, mat, x, y, z, collide = true, ry = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true;
    this.scene.add(m);
    if (collide) this.colliders.push({ x0: x - w / 2 - 0.3, x1: x + w / 2 + 0.3, z0: z - d / 2 - 0.3, z1: z + d / 2 + 0.3 });
    return m;
  }

  build(progress) {
    const S = this.scene;
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.9 });
    const floorTex = woodTexture(1).clone(); floorTex.repeat.set(6, 4); floorTex.needsUpdate = true;
    const floor = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.75 });
    const ceil = new THREE.MeshStandardMaterial({ color: 0xdedbd2, roughness: 1 });
    const W = 18, D = 12, H = 3.2;
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floor); fl.rotation.x = -Math.PI / 2; fl.receiveShadow = true; S.add(fl);
    const cl = new THREE.Mesh(new THREE.PlaneGeometry(W, D), ceil); cl.rotation.x = Math.PI / 2; cl.position.y = H; S.add(cl);
    const wall = (w, x, z, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, H), wallMat.clone()); m.material.map = wallMat.map.clone(); m.material.map.repeat.set(w / 3, 1); m.material.map.needsUpdate = true; m.position.set(x, H / 2, z); m.rotation.y = ry; m.receiveShadow = true; S.add(m); };
    wall(W, 0, -D / 2, 0); wall(W, 0, D / 2, Math.PI); wall(D, -W / 2, 0, Math.PI / 2); wall(D, W / 2, 0, -Math.PI / 2);
    this.colliders.push({ x0: -99, x1: 99, z0: -99, z1: -D / 2 + 0.35 }, { x0: -99, x1: 99, z0: D / 2 - 0.35, z1: 99 }, { x0: -99, x1: -W / 2 + 0.35, z0: -99, z1: 99 }, { x0: W / 2 - 0.35, x1: 99, z0: -99, z1: 99 });
    // свет
    S.add(new THREE.HemisphereLight(0xfff6e8, 0x40382e, 0.9));
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e0, emissiveIntensity: 2.2 });
    for (const [x, z] of [[-5, -2], [0, -2], [5, -2], [-5, 3], [5, 3]]) {
      this.box(1.4, 0.06, 0.25, lampMat, x, H - 0.05, z, false);
      const l = new THREE.PointLight(0xfff2dc, 9, 14, 1.6); l.position.set(x, H - 0.3, z);
      if (x === 0) { l.castShadow = true; l.shadow.mapSize.set(1024, 1024); }
      S.add(l);
    }
    // окно
    const winC = document.createElement('canvas'); winC.width = 512; winC.height = 256;
    const wg = winC.getContext('2d');
    const gr = wg.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#5a7ea6'); gr.addColorStop(0.55, '#c9d6e2'); gr.addColorStop(0.56, '#eef2f6'); gr.addColorStop(1, '#ffffff');
    wg.fillStyle = gr; wg.fillRect(0, 0, 512, 256);
    wg.fillStyle = '#3a4a3a'; for (let i = 0; i < 14; i++) { const x = i * 40 + 10; wg.beginPath(); wg.moveTo(x, 150); wg.lineTo(x + 10, 110 - (i % 3) * 8); wg.lineTo(x + 20, 150); wg.fill(); }
    wg.fillStyle = '#4b5a3c'; wg.fillRect(300, 150, 90, 30); wg.fillStyle = '#222'; wg.beginPath(); wg.arc(320, 182, 9, 0, 6.3); wg.arc(372, 182, 9, 0, 6.3); wg.fill();
    const win = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.4), new THREE.MeshBasicMaterial({ map: canvasTex(winC) }));
    win.position.set(-4.5, 1.8, D / 2 - 0.02); win.rotation.y = Math.PI; S.add(win);
    this.box(3.2, 0.08, 0.1, new THREE.MeshStandardMaterial({ color: 0xffffff }), -4.5, 1.08, D / 2 - 0.05, false);
    // стенд таблиц стрельбы
    const board = buildBoardCanvas();
    this.boardCanvas = board;
    const bm = new THREE.Mesh(new THREE.PlaneGeometry(8, 3), new THREE.MeshStandardMaterial({ map: canvasTex(board), roughness: 0.85 }));
    bm.position.set(0, 1.75, -D / 2 + 0.04); S.add(bm);
    this.box(8.2, 3.2, 0.04, new THREE.MeshStandardMaterial({ color: 0x3b2a1c }), 0, 1.75, -D / 2 + 0.015, false);
    this.interact.push({ pos: new THREE.Vector3(0, 1.6, -D / 2 + 1.2), r: 3.2, label: 'Изучить таблицы стрельбы и графики траекторий', act: () => this.app.ui.firingTables() });
    // карта операций на столе
    const mapT = canvasTex(mapCanvas(progress));
    this.box(4, 0.08, 2.6, new THREE.MeshStandardMaterial({ map: woodTexture(1), roughness: 0.7 }), 0, 0.82, 0.2);
    for (const [x, z] of [[-1.85, -1.1], [1.85, -1.1], [-1.85, 1.5], [1.85, 1.5]]) this.box(0.1, 0.8, 0.1, new THREE.MeshStandardMaterial({ color: 0x3b2a1c }), x, 0.4, z, false);
    const mp = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 2.4), new THREE.MeshStandardMaterial({ map: mapT, roughness: 0.9 }));
    mp.rotation.x = -Math.PI / 2; mp.position.set(0, 0.865, 0.2); S.add(mp);
    this.interact.push({ pos: new THREE.Vector3(0, 0.9, 0.2), r: 2.8, label: 'Карта операций — выбор задания и брифинг', act: () => this.app.ui.operations() });
    // личный состав (восточная стена)
    const rm = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.6), new THREE.MeshStandardMaterial({ map: canvasTex(rosterCanvas()), roughness: 0.9 }));
    rm.position.set(W / 2 - 0.04, 1.7, -1.5); rm.rotation.y = -Math.PI / 2; S.add(rm);
    this.interact.push({ pos: new THREE.Vector3(W / 2 - 1, 1.6, -1.5), r: 3, label: 'Личный состав — характеристики и состав отделения', act: () => this.app.ui.roster() });
    // эмблема
    const em = document.createElement('canvas'); em.width = em.height = 256;
    const eg = em.getContext('2d');
    eg.fillStyle = '#1b2a40'; eg.beginPath(); eg.moveTo(128, 10); eg.lineTo(240, 60); eg.lineTo(220, 190); eg.lineTo(128, 246); eg.lineTo(36, 190); eg.lineTo(16, 60); eg.closePath(); eg.fill();
    eg.strokeStyle = '#e8eef4'; eg.lineWidth = 6; eg.stroke();
    eg.fillStyle = '#e8eef4'; eg.font = 'bold 54px Arial'; eg.textAlign = 'center'; eg.fillText('N.E.G.S', 128, 120);
    eg.font = 'bold 20px Arial'; eg.fillText('ЗАПОЛЯРЬЕ', 128, 160);
    eg.strokeStyle = '#7fd0ff'; eg.lineWidth = 3; for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; eg.beginPath(); eg.moveTo(128, 200); eg.lineTo(128 + Math.cos(a) * 22, 200 + Math.sin(a) * 22); eg.stroke(); }
    const emm = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), new THREE.MeshStandardMaterial({ map: canvasTex(em), transparent: true }));
    emm.position.set(W / 2 - 0.04, 1.9, 2.6); emm.rotation.y = -Math.PI / 2; S.add(emm);
    // КХО — комната хранения оружия (западная часть штаба): стеллажи с оружием, стол снаряжения
    const rackMat = new THREE.MeshStandardMaterial({ map: woodTexture(0) });
    const wallM = new THREE.MeshStandardMaterial({ map: wallMat.map.clone(), roughness: 0.9 });
    wallM.map.repeat.set(2.4, 1); wallM.map.needsUpdate = true;
    const KX = -4.6, KZ = 2.2;
    // перегородки с дверным проёмом z∈[-1.6,-0.2]
    this.box(0.18, H, 6 - 1.6, wallM, KX, H / 2, (-6 + -1.6) / 2);
    this.box(0.18, H, KZ + 0.2, wallM, KX, H / 2, (-0.2 + KZ) / 2);
    this.box(0.18, H - 2.2, 1.4, wallM, KX, 2.2 + (H - 2.2) / 2, -0.9, false);
    this.box(W / 2 + KX, H, 0.18, wallM, (-W / 2 + KX) / 2, H / 2, KZ);
    // решётчатая дверь (открыта)
    const bars = new THREE.Group();
    const barM = new THREE.MeshStandardMaterial({ color: 0x3a3d40, metalness: 0.7, roughness: 0.4 });
    for (let i = 0; i < 8; i++) { const bb = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 2.1, 6), barM); bb.position.set(0, 1.05, -0.65 + i * 0.18); bars.add(bb); }
    for (const y of [0.15, 1.05, 2.0]) { const bb = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 1.4), barM); bb.position.set(0, y, -0.0); bars.add(bb); }
    bars.position.set(KX + 0.7, 0, -1.6); bars.rotation.y = 1.2; S.add(bars);
    const khoSign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.35), new THREE.MeshBasicMaterial({ map: textTexture(['КХО', 'комната хранения оружия'], { w: 512, h: 150, bg: '#7a1c14', fg: '#f3efe2', font: 'bold 38px Arial' }) }));
    khoSign.position.set(KX + 0.1, 2.5, -0.9); khoSign.rotation.y = Math.PI / 2; S.add(khoSign);
    const lampK = new THREE.PointLight(0xfff0d8, 6, 9, 1.6); lampK.position.set(-6.8, H - 0.3, -2); S.add(lampK);
    this.box(1.2, 0.05, 0.22, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e0, emissiveIntensity: 2 }), -6.8, H - 0.05, -2, false);
    // стеллажи: оружие горизонтально на кронштейнах
    const vm = new ViewModel(new THREE.Scene());
    const KINDS = [['ak74m', 'ak74'], ['ak74m_gp', 'ak74gp'], ['ak74m_1p78', 'ak74scope'], ['akm', 'akm'], ['svd', 'svd'], ['pkm', 'pkm']];
    this.box(0.35, 2.1, 5.6, rackMat, -W / 2 + 0.2, 1.05, -2.8, true);
    this.khoLabels = [];
    KINDS.forEach(([id, kind], i) => {
      const z = i % 2 ? -2.0 : -4.3, y = [2.05, 1.5, 0.95][Math.floor(i / 2)];
      const g = vm._build(kind, true).root;
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      g.scale.setScalar(1.15);
      g.position.set(-W / 2 + 0.47, y, z - 0.1);
      S.add(g);
      for (const dz of [-0.3, 0.25]) this.box(0.14, 0.035, 0.035, new THREE.MeshStandardMaterial({ color: 0x222222 }), -W / 2 + 0.43, y - 0.1, z + dz, false);
      const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.14), new THREE.MeshBasicMaterial({ map: textTexture([WEAPONS[id].name], { w: 384, h: 90, bg: '#efe9d8', fg: '#111', font: 'bold 40px Arial' }) }));
      lbl.position.set(-W / 2 + 0.39, y - 0.2, z); lbl.rotation.y = Math.PI / 2; S.add(lbl);
      const mark = new THREE.Mesh(new THREE.CircleGeometry(0.04, 12), new THREE.MeshBasicMaterial({ color: 0x40ff60 }));
      mark.position.set(-W / 2 + 0.39, y - 0.2, z + 0.4); mark.rotation.y = Math.PI / 2; S.add(mark);
      this.khoLabels.push({ id, mark });
      this.interact.push({ pos: new THREE.Vector3(-W / 2 + 0.6, y, z), r: 1.6, label: `Взять ${WEAPONS[id].name} (${WEAPONS[id].cls})`, act: () => { this.app.save.primary = id; this.app.persist(); this.updateKho(); this.app.ui.toast(`Основное оружие: ${WEAPONS[id].name}`); } });
    });
    // РПГ-7В на северной стене
    const rpg = vm._build('rpg7', true).root;
    rpg.position.set(-7.6, 1.45, -D / 2 + 0.35); rpg.rotation.y = Math.PI; rpg.scale.setScalar(1.2); S.add(rpg);
    this.box(1.6, 0.06, 0.25, rackMat, -7.6, 1.25, -D / 2 + 0.25, false);
    this.rpgMark = new THREE.Mesh(new THREE.CircleGeometry(0.05, 12), new THREE.MeshBasicMaterial({ color: 0x40ff60 }));
    this.rpgMark.position.set(-6.7, 1.25, -D / 2 + 0.2); S.add(this.rpgMark);
    this.interact.push({ pos: new THREE.Vector3(-7.6, 1.45, -D / 2 + 0.5), r: 1.8, label: 'Взять / сдать РПГ-7В (3 выстрела ПГ-7ВМ)', act: () => { this.app.save.launcher = !this.app.save.launcher; this.app.persist(); this.updateKho(); this.app.ui.toast(this.app.save.launcher ? 'РПГ-7В взят' : 'РПГ-7В сдан'); } });
    // стол снаряжения магазинов: ящики с патронами
    this.box(1.6, 0.06, 0.8, rackMat, -6.4, 0.8, -1.6);
    for (const [x, z] of [[-7.1, -1.9], [-5.7, -1.9], [-7.1, -1.3], [-5.7, -1.3]]) this.box(0.06, 0.8, 0.06, new THREE.MeshStandardMaterial({ color: 0x3b2a1c }), x, 0.4, z, false);
    const amb = model('ammo_box');
    if (amb) for (const [x, z, ry] of [[-6.9, -1.7, 0.3], [-6.3, -1.45, -0.2]]) { const o = amb.scene.clone(true); o.position.set(x, 0.83, z); o.rotation.y = ry; S.add(o); }
    for (let i = 0; i < 4; i++) { const mg = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.07), new THREE.MeshStandardMaterial({ color: 0x6e3518, roughness: 0.5 })); mg.position.set(-5.95 + i * 0.05, 0.93, -1.75); mg.rotation.z = 0.2; S.add(mg); }
    this.interact.push({ pos: new THREE.Vector3(-6.4, 0.9, -1.6), r: 1.8, label: 'Снаряжение магазинов и ленты (трассеры, бронебойные…)', act: () => this.app.ui.magLoader() });
    this.updateKho();
    // дверь в автопарк
    const doorC = textTexture(['АВТОПАРК', '«Тигр» · «Нива» · МТ-ЛБ'], { w: 512, h: 160, bg: '#1b2a40', fg: '#e8eef4', font: 'bold 40px Arial' });
    this.box(1.6, 2.3, 0.08, new THREE.MeshStandardMaterial({ color: 0x4a5a4a, roughness: 0.7 }), 4.5, 1.15, D / 2 - 0.05, false);
    const ds = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.5), new THREE.MeshBasicMaterial({ map: doorC }));
    ds.position.set(4.5, 2.6, D / 2 - 0.06); ds.rotation.y = Math.PI; S.add(ds);
    this.interact.push({ pos: new THREE.Vector3(4.5, 1.2, D / 2 - 0.5), r: 2.4, label: 'Автопарк — выбрать технику на задание', act: () => this.app.ui.motorPool() });
    // стол дежурного, рация
    this.box(1.8, 0.78, 0.8, rackMat, 6, 0.39, -4.6);
    this.box(0.5, 0.25, 0.3, new THREE.MeshStandardMaterial({ color: 0x3e4a33 }), 6.3, 0.9, -4.6, false);
    this.box(0.6, 1.9, 0.5, new THREE.MeshStandardMaterial({ color: 0x5a6a5a, metalness: 0.3 }), 8.4, 0.95, 4.8);
    this.box(0.6, 1.9, 0.5, new THREE.MeshStandardMaterial({ color: 0x5a6a5a, metalness: 0.3 }), 7.7, 0.95, 4.8);
    // командир
    const cmd = new SoldierModel('officer', 'ak');
    cmd.weapon.visible = false;
    cmd.root.position.set(2.6, 0, -0.9); cmd.root.rotation.y = 0.4;
    cmd.update(0.5, { speed: 0, stance: 'stand', aimPitch: -0.1, aiming: false });
    cmd.weapon.visible = false;
    S.add(cmd.root);
    this.commander = cmd;
    this.interact.push({ pos: new THREE.Vector3(2.6, 1.5, -0.9), r: 2, label: 'Майор Волков — доклад', act: () => this.app.ui.commanderTalk() });
    // бойцы отделения у стены
    ROSTER.slice(0, 4).forEach((r, i) => {
      const s = new SoldierModel('negs', r.weapon === 'pkm' ? 'pkm' : r.weapon === 'svd' ? 'svd' : 'ak');
      s.root.position.set(-6 + i * 1.2, 0, 4.8); s.root.rotation.y = (i - 1.5) * 0.15;
      s.update(0.5, { speed: 0, stance: 'stand', aimPitch: -0.3, aiming: false });
      S.add(s.root);
    });
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
    this.commander.head.rotation.y = Math.sin(this.t * 0.4) * 0.3;
  }

  render() {
    const r = this.app.renderer;
    r.autoClear = true;
    r.toneMappingExposure = 1.0;
    if (this.camera.aspect !== innerWidth / innerHeight) { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }
    this.app.post.preset('day');
    this.app.post.bloom.enabled = true;
    this.app.post.render(this.scene, this.camera, null, null);
  }
}
