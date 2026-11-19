// 14,5-мм пулемёт КПВ (пехотный вариант ПКП) на колёсном станке Харыкина. Станок: ось с двумя
// колёсами, две раздвинутые станины с сошниками, поворотная часть со щитом, люлька. Пулемёт:
// короб, ствол в дырчатом кожухе, дульный пламегаситель, рукоятки с гашеткой, коробка на 40
// патронов слева. Наводка — в секторе ±35° от направления станка и −7…+25° по высоте; дальше —
// переставить станок (E — переместить, как миномёт; можно погрузить в машину).
// Прицел: целик со шкалой 1–20 (сотни метров) и мушка; колесо — установка дальности.
import * as THREE from 'three';
import { lathe, cylZ, cylX, cylY, rbox, torus, gunMats, Parts } from '../weapons/gunkit.js';
import { MIL, fly, NORMAL_ENV } from './d30.js';
import { prepareAmmo } from '../physics/ballistics.js';
import { AMMO, WEAPONS } from '../data/weapons.js';
import { setupEmplace } from './emplace.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const TRAV = 35 * Math.PI / 180, EL_LO = -7 * Math.PI / 180, EL_HI = 25 * Math.PI / 180;
const TRUN = new THREE.Vector3(0, 0.6, 0);  // цапфы люльки
const MUZ = -1.5, R_SIGHT = 1.12;             // дульный срез; база прицела (целик z 0.24 → мушка z −0.88)
const Y = new THREE.Vector3(0, 1, 0);

// углы прицеливания для дальностей 100…2000 м (по той же модели полёта, что и пуля)
let SIGHT = null;
function sightAngles() {
  if (SIGHT) return SIGHT;
  const a = prepareAmmo({ ...AMMO.ptrd_b32 });
  SIGHT = [0];
  for (let D = 100; D <= 2000; D += 100) {
    let lo = 0, hi = 0.06;
    for (let k = 0; k < 22; k++) { const mid = (lo + hi) / 2; if (fly(a, NORMAL_ENV, mid, { dt: 1 / 240 }).x < D) lo = mid; else hi = mid; }
    SIGHT.push((lo + hi) / 2);
  }
  return SIGHT;
}

function buildKPV() {
  const M = gunMats();
  const root = new THREE.Group();
  // станок: ось, колёса, станины
  const SP = new Parts();
  SP.add('olive', cylX(0.03, -0.42, 0.42, { y: 0.28, z: 0.05, seg: 12 }));
  for (const sx of [-1, 1]) {
    SP.add('rubber', lathe([[0.17, -0.045], [0.27, -0.04], [0.28, -0.02], [0.28, 0.02], [0.27, 0.04], [0.17, 0.045]], { seg: 28 }).rotateY(Math.PI / 2).translate(sx * 0.47, 0.28, 0.05));
    SP.add('olive', lathe([[0.0, -0.035], [0.18, -0.035], [0.18, 0.035], [0.05, 0.05], [0.0, 0.05]], { seg: 22 }).rotateY(Math.PI / 2 * sx).translate(sx * 0.47, 0.28, 0.05));
    // станина: от оси назад к сошнику
    const a = new THREE.Vector3(sx * 0.12, 0.3, 0.1), b = new THREE.Vector3(sx * 0.42, 0.03, 1.25);
    const g = new THREE.CylinderGeometry(0.022, 0.026, a.distanceTo(b), 10);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, b.clone().sub(a).normalize()));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    SP.add('olive', g);
    SP.add('steelDark', rbox(0.1, 0.07, 0.03, sx * 0.43, 0.02, 1.27, 0.004, { rx: 0.4 }));
  }
  root.add(SP.build(M));
  // поворотная часть: вертлюг, щит
  const trav = new THREE.Group();
  const TP = new Parts();
  TP.add('olive', cylY(0.05, 0.28, 0.5, { seg: 16 }));
  TP.add('olive', rbox(0.2, 0.06, 0.16, 0, 0.5, 0, 0.01));
  // щит 6 мм с вырезом под ствол, отогнутые края
  const sh = new THREE.Shape();
  // вырез под ствол и для прицеливания
  sh.moveTo(-0.45, 0); sh.lineTo(0.45, 0); sh.lineTo(0.45, 0.62); sh.lineTo(0.11, 0.62); sh.lineTo(0.11, 0.24); sh.lineTo(-0.11, 0.24); sh.lineTo(-0.11, 0.62); sh.lineTo(-0.45, 0.62); sh.lineTo(-0.45, 0);
  const shg = new THREE.ExtrudeGeometry(sh, { depth: 0.008, bevelEnabled: false });
  shg.translate(0, 0.28, -0.42);
  TP.add('olive', shg);
  for (const sx of [-1, 1]) TP.add('olive', rbox(0.15, 0.62, 0.008, sx * 0.51, 0.59, -0.39, 0.002, { ry: sx * 0.5 }));
  for (const sx of [-1, 1]) TP.add('steelDark', rbox(0.03, 0.18, 0.03, sx * 0.2, 0.36, -0.36, 0.005));
  trav.add(TP.build(M));
  root.add(trav);
  // качающаяся часть: люлька и пулемёт
  const pitch = new THREE.Group();
  pitch.position.copy(TRUN);
  const GP = new Parts();
  GP.add('steel', rbox(0.17, 0.17, 0.66, 0, 0.0, 0.14, 0.012));                       // короб
  GP.add('steelDark', rbox(0.175, 0.03, 0.5, 0, 0.09, 0.12, 0.008));                  // крышка
  for (let i = 0; i < 6; i++) GP.add('steelDark', rbox(0.18, 0.004, 0.012, 0, 0.106, -0.08 + i * 0.07, 0.002));
  GP.add('steel', cylZ(0.027, -0.2, MUZ + 0.08, { seg: 16 }));                        // ствол
  GP.add('steelDark', cylZ(0.047, -0.18, -0.98, { seg: 20 }));                        // кожух
  for (let k = 0; k < 9; k++) for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + (k % 2) * 0.5; GP.add('black', rbox(0.004, 0.018, 0.04, Math.cos(a) * 0.047, Math.sin(a) * 0.047, -0.24 - k * 0.083, 0.002, { rz: a })); }
  GP.add('steel', lathe([[0.0, MUZ + 0.09], [0.034, MUZ + 0.09], [0.038, MUZ + 0.03], [0.032, MUZ], [0.0, MUZ]], { seg: 18 }));
  GP.add('black', cylZ(0.008, MUZ - 0.001, MUZ - 0.004, { seg: 10 }));
  GP.add('steelBright', torus(0.06, 0.007, { z: -0.6, y: 0.03, axis: 'z', arc: Math.PI, seg: 16 }));   // ручка переноски ствола
  // мушка с намушником и целик со шкалой
  GP.add('steel', rbox(0.04, 0.07, 0.02, 0, 0.075, -0.88, 0.004));
  GP.add('steel', rbox(0.004, 0.022, 0.004, 0, 0.12, -0.88, 0.001));
  for (const sx of [-1, 1]) GP.add('steel', rbox(0.004, 0.035, 0.016, sx * 0.016, 0.125, -0.88, 0.001));
  GP.add('steel', rbox(0.06, 0.02, 0.07, 0, 0.1, 0.24, 0.004));
  // рукоятки с гашеткой
  GP.add('steel', rbox(0.2, 0.03, 0.05, 0, -0.02, 0.5, 0.008));
  for (const sx of [-1, 1]) GP.add('rubber', cylY(0.017, -0.11, 0.01, { x: sx * 0.085, z: 0.53, seg: 12 }));
  GP.add('steelBright', rbox(0.05, 0.012, 0.025, 0, -0.035, 0.535, 0.004));
  // коробка с лентой слева
  GP.add('green', rbox(0.1, 0.19, 0.3, -0.15, -0.06, 0.08, 0.008));
  GP.add('steel', rbox(0.02, 0.02, 0.1, -0.15, 0.05, 0.08, 0.004));
  for (let i = 0; i < 4; i++) GP.add('brass', cylZ(0.008, 0.02 + i * 0.022, 0.1 + i * 0.022, { x: -0.09, y: 0.055 - i * 0.012, seg: 8 }));
  // люлька
  GP.add('olive', rbox(0.2, 0.05, 0.4, 0, -0.1, 0.05, 0.01));
  pitch.add(GP.build(M));
  // планка целика (поднимается по дальности)
  const leaf = new THREE.Group();
  const LP = new Parts();
  LP.add('steel', rbox(0.036, 0.004, 0.06, 0, 0, 0, 0.001));
  for (const sx of [-1, 1]) LP.add('steel', rbox(0.012, 0.016, 0.006, sx * 0.011, 0.008, 0.028, 0.001));
  leaf.add(LP.build(M));
  leaf.position.set(0, 0.112, 0.24);
  pitch.add(leaf);
  trav.add(pitch);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, trav, pitch, leaf };
}

export class Kpv {
  constructor(m, { x, z, yaw = 0, name = 'КПВ № 1', team = 'negs', stowIn = null }) {
    this.m = m; this.name = name; this.team = team; this.kind = 'kpv';
    this.model = buildKPV();
    m.scene.add(this.model.root);
    this.pos = new THREE.Vector3(x, m.terrain.heightAt(x, z), z);
    this.mountYaw = yaw; this.tr = 0; this.el = 0;    // наводка относительно станка, рад
    this.ammo = 40; this.belts = 8; this.reloadT = 0; this.cd = 0; this.fired = 0; this.setting = 5;
    this.colliders = []; this.recoil = 0; this.crew = []; this.reports = [];
    this.gunIt = {
      pos: new THREE.Vector3(), r: 1.5, hold: 0.25, label: `Лечь за пулемёт: ${name}`,
      enabled: () => this.ready && !m.player.gun && !m.player.carry && !m.player.vehicle && !this.netUser && m.player.body.alive,
      action: () => this.mount(m.player),
    };
    m.interactables.push(this.gunIt);
    setupEmplace(this, m, { kind: 'kpv', name: `пулемёт ${name}`, speed: 1.6, front: 1.9 });
    if (stowIn) this.stow(stowIn, true); else this._onPlace(yaw);
  }
  get ready() { return !this.moving && !this.stowedIn; }
  canHitch() { return false; }
  busy() { return this.m.player.gun === this; }
  // для сети: az/elM — мировой азимут и возвышение в тысячных (как у орудий)
  get az() { return ((-(this.mountYaw + this.tr) / MIL) % 6000 + 6000) % 6000; }
  set az(v) { let d = -v * MIL - this.mountYaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; this.tr = clamp(d, -TRAV, TRAV); }
  get elM() { return this.el / MIL; }
  set elM(v) { this.el = clamp(v * MIL, EL_LO, EL_HI); }

  _onPick() { for (const o of this.colliders) this.m.world.removeObstacle(o); this.colliders = []; this.model.root.visible = !!this.mover; }
  _onStow() { this._onPick(); this.model.root.visible = false; }
  _onPlace(yaw) {
    this.mountYaw = yaw; this.tr = 0; this.el = 0;
    this.model.root.visible = true;
    this._place();
    const W = this.m.world, P = this.pos;
    const c = Math.cos(yaw), s = Math.sin(yaw), sh = { x: P.x - s * 0.42, z: P.z - c * 0.42 };
    this.colliders = [
      W.addBoxCollider({ x: sh.x, z: sh.z, y0: P.y + 0.28, w: 0.9, d: 0.08, h: 0.62, yaw, mat: 'armor', pen: 9, cover: true, owner: { kind: 'gun', gun: this } }), // щит: 5,45 не берёт, 7Н1 — на грани
      W.addCylCollider({ x: P.x, z: P.z, y0: P.y, r: 0.35, h: 0.75, mat: 'metal', pen: 8, cover: false, owner: { kind: 'gun', gun: this } }),
    ];
  }
  _place() {
    const g = this.model;
    g.root.position.copy(this.pos);
    g.root.rotation.set(0, this.mountYaw, 0);
    g.trav.rotation.y = this.tr;
    g.pitch.rotation.x = this.el;
    // откат и подъём целика по установке прицела
    g.pitch.position.copy(TRUN).add(new THREE.Vector3(0, 0, this.recoil * 0.02));
    const th = sightAngles()[this.setting] || 0;
    g.leaf.position.y = 0.112 + Math.tan(th) * R_SIGHT * 0.8;
    g.root.updateMatrixWorld(true);
  }

  muzzleWorld(out = new THREE.Vector3()) { return out.set(0, 0, MUZ).applyMatrix4(this.model.pitch.matrixWorld); }
  boreDir(out = new THREE.Vector3()) { const q = new THREE.Quaternion(); this.model.pitch.getWorldQuaternion(q); return out.set(0, 0, -1).applyQuaternion(q); }

  mount(p) {
    if (!this.ready) return;
    p.gun = this; p.body.stance = 'crouch';
    this.m.hud.message(`${this.name}: ЛКМ — огонь, колесо — прицел (дальность), R — новая лента, E — встать`, 4);
  }
  dismount(p) {
    p.gun = null;
    const q = new THREE.Vector3(0.9, 0, 1.0).applyAxisAngle(Y, this.mountYaw).add(this.pos);
    p.body.pos.set(q.x, this.m.terrain.heightAt(q.x, q.z), q.z);
    p.yaw = this.mountYaw + this.tr;
  }
  seatWorld() { return new THREE.Vector3(0, 0, 0.95).applyAxisAngle(Y, this.mountYaw + this.tr * 0.6).add(this.pos); }

  control(dt) {
    const m = this.m, inp = m.input, p = m.player;
    if (inp.bh('use')) { this.dismount(p); return; }
    const sens = m.settings.sens * 0.0011 * (m.player.scoped ? 0.5 : 1);
    this.tr = clamp(this.tr - inp.dx * sens, -TRAV, TRAV);
    this.el = clamp(this.el - inp.dy * sens * (m.settings.invertY ? -1 : 1), EL_LO, EL_HI);
    if (inp.wheel) { this.setting = clamp(this.setting + (inp.wheel < 0 ? 1 : -1), 1, 20); m.audio.mech('sight'); m.hud.message(`Прицел ${this.setting} (${this.setting * 100} м)`, 1); }
    if ((inp.bh('reload') || inp.hit('KeyR')) && this.reloadT <= 0 && this.ammo < 40) {
      if (this.belts <= 0) m.hud.message('Ленты кончились', 2);
      else { this.reloadT = WEAPONS.kpv.reload; m.audio.mech('reload'); m.hud.message('Новая лента (≈6 с)', 2); }
    }
    if (inp.bd('fire')) this.fire();
    p.body.pos.copy(this.seatWorld());
    p.yaw = this.mountYaw + this.tr;
  }

  fire() {
    const m = this.m;
    if (this.reloadT > 0 || this.cd > 0) return;
    if (this.ammo <= 0) { m.audio.click(); this.cd = 0.3; if (this.belts > 0 && this.reloadT <= 0) { this.reloadT = WEAPONS.kpv.reload; m.audio.mech('reload'); } return; }
    this.ammo--; this.fired++;
    this.cd = 60 / WEAPONS.kpv.rpm;
    const pos = this.muzzleWorld(), dir = this.boreDir();
    const sd = WEAPONS.kpv.disp * 0.001;
    dir.x += (Math.random() - 0.5) * 2 * sd; dir.y += (Math.random() - 0.5) * 2 * sd; dir.z += (Math.random() - 0.5) * 2 * sd; dir.normalize();
    const ammoId = this.fired % 4 === 0 ? 'kpv_bzt' : 'ptrd_b32';
    m.fireProjectile({ weapon: WEAPONS.kpv, pos, dir, owner: m.player.body, team: m.player.body.team, ammoId, own: true });
    m.fx.muzzle(pos, dir, 2.2);
    m.audio.shot(pos, 'ptrd', true);
    // отдача: станок прыгает, прицел уводит вверх-вбок
    this.recoil = 1;
    this.el = clamp(this.el + 0.0016 + Math.random() * 0.001, EL_LO, EL_HI);
    this.tr = clamp(this.tr + (Math.random() - 0.5) * 0.0024, -TRAV, TRAV);
    m.player.shake = Math.max(m.player.shake, 0.35);
    // гильза вниз-вправо
    m.fx.impact(this.pos.clone().setY(this.pos.y + 0.05), Y, 'snow', 0.4);
  }

  remoteFire() {}
  netOp(e) { this.emNetOp(e); }

  update(dt) {
    this.emUpdate();
    if (this.moving && this.mover) { this.mountYaw = this.yawM; this.tr = 0; this.el = 0; }
    this.cd -= dt;
    this.recoil = Math.max(0, this.recoil - dt * 12);
    if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) { this.belts--; this.ammo = 40; this.m.audio.mech('switch'); if (this.m.player.gun === this) this.m.hud.message(`Лента вставлена (осталось ${this.belts})`, 2); } }
    this._place();
    this.gunIt.pos.copy(this.seatWorld()).setY(this.pos.y + 0.7);
    this.hudText = `<div class="wn">КПВ 14,5 мм</div><div>Лента: ${this.ammo}/40 · лент ${this.belts}${this.reloadT > 0 ? ' · заряжание…' : ''}</div><div>Прицел ${this.setting} (${this.setting * 100} м)</div><div class="ws">ЛКМ — огонь · колесо — дальность · R — лента · E — встать</div>`;
  }

  // взгляд через целик на мушку: линия прицеливания ниже оси ствола на угол прицела
  camera(cam) {
    const g = this.model;
    g.root.visible = true;
    const th = sightAngles()[this.setting] || 0;
    const q = new THREE.Quaternion(); g.pitch.getWorldQuaternion(q);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -th));
    const eye = new THREE.Vector3(0, 0.122 + Math.tan(th) * R_SIGHT * 0.8, 0.5).applyMatrix4(g.pitch.matrixWorld);
    cam.position.copy(eye);
    cam.quaternion.copy(q);
    return this.m.input.bd('aim') ? 30 : 55;
  }
}
