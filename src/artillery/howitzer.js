// Гаубица Д-30 на огневой позиции: место наводчика, механизмы наводки, прицелы, заряжание
// расчётом, выстрел с откатом, доклады наблюдателя о разрывах.
//
// Углы: «угломер» — дирекционный угол оси ствола (панорама ориентирована по основному
// направлению, отсчёт от севера по часовой стрелке) в делениях угломера (6000 на окружность).
// Возвышение ствола = прицел + (уровень − 30-00). Подъёмным механизмом наводчик выводит
// пузырёк уровня на середину — тогда ствол стоит на нужном возвышении.
import * as THREE from 'three';
import { buildD30, D30, shellGeometry } from './d30model.js';
import { MIL, CHARGES, firingTable, fmtDiv, fmtSigned, dirAngle, toGrid } from './d30.js';
import { WEAPONS } from '../data/weapons.js';
import { charAvailable } from '../entities/charRig.js';
import { CrewSoldier, crewItems as crewItemsLazy } from './crew.js';
import { Parts } from '../weapons/gunkit.js';
import { GunUI, D30_SPEC } from './gunUI.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const EL_MIN = -117, EL_MAX = 1167; // −7° … +70°
const BOX_DIST = 11;    // ящик с боеприпасами — в 11 м за орудием (по наставлению 10–15 м)
const BOX_N = 50;       // в ящике 50 снарядов и 50 зарядов
const V_RUN = 3.4, V_CARRY = 2.3; // скорость номера расчёта налегке и со снарядом 22 кг, м/с
const TRANS_TIME = 16;
const HITCH_R = 4.0;     // фаркоп у проушины ближе этого — можно прицепить   // перевод из боевого в походное и обратно силами расчёта, с
const AXLE = 0.15;       // ось колёс от оси вращения лафета (к проушине — +Z)
const TRAVEL_EL = -0.045; // ствол в походном положении, рад
const wrapA = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const ease = (t) => t * t * (3 - 2 * t);
const VIEWS = ['eye', 'pano', 'op4m', 'side'];
export const VIEW_NAMES = { eye: 'Обзор', pano: 'Панорама ПГ-1М', op4m: 'Прицел прямой наводки ОП4М-45', side: 'Вид со стороны' };

export class Howitzer {
  constructor(m, { x, z, dir = 0, name = 'Д-30 № 1', mode = 'combat', heading = null, towBy = null, team = 'negs' }) {
    this.m = m; this.name = name; this.team = team;
    this.model = buildD30();
    const y0 = m.terrain.heightAt(x, z);
    this.pos = new THREE.Vector3(x, y0, z);
    this.model.root.position.copy(this.pos);
    m.scene.add(this.model.root);
    // положение: tr = 0 — боевое, 1 — походное; лафет: курс и наклоны (при буксировке)
    this.tr = mode === 'travel' ? 1 : 0; this.trTarget = this.tr;
    this.rootYaw = heading ?? 0; this.rootPitch = 0; this.rootRoll = 0;
    this.towBy = null; this.snapT = 0;
    this.mass = 3210; // боевая масса Д-30, кг
    this.az = dir;          // угломер (тыс.)
    this.elM = 0;           // возвышение ствола (тыс.)
    this.drum = 0;          // прицел на барабане (тыс.)
    this.level = 3000;      // уровень (тыс.)
    this.ci = 5;            // заряд (индекс в CHARGES), по умолчанию — четвёртый
    this.fuze = 'О';        // взрыватель РГМ-2: «О» — осколочное, «Ф» — фугасное
    this.shellType = 'of';  // снаряд: «of» — ОФ-462, «d» — Д-462 дымовой (Z)
    this.loaded = null; this.load = null; this.recoilT = 9; this.breech = 1; this.shots = 0;
    this.shells = BOX_N; this.charges = BOX_N;
    this.view = 'pano';
    this.orbit = { yaw: 0.6, pitch: 0.25, dist: 7.5 };
    this.reports = [];
    this.collider = null;
    if (this.tr === 0) this._makeCollider();
    // расчёт — три номера (замковый, снарядный, зарядный): бойцы, которых можно ранить и убить.
    // В боевом положении стоят у орудия и заряжают, при переводе — работают со станинами,
    // креплением ствола и колёсами; в походном едут в тягаче
    this.crew = [];
    if (charAvailable('negs')) {
      [['замковый', 'stand', 0.75, 1.75, 0.4], ['снарядный', 'crouch', 1.8, 2.7, 0.2], ['зарядный', 'look', 0.3, 3.1, -0.3]].forEach(([role, pose, lx, lz, ry], i) => {
        const s = new CrewSoldier(m, { team, name: `${name}: ${role}`, callsign: `${role} ${name.replace(/^Д-30\s*/, '')}`.trim(), x, z });
        s.idle = { pose, local: new THREE.Vector3(lx, 0, lz), ry };
        s.crewRole = role; s.gunRef = this; s.job = null;
        m.soldiers.push(s);
        s.netIdx = m.netAI.length; m.netAI.push(s);
        if (m.net && !m.net.isHost) s.damage = (amount, zone, source, dir, opts) => m.net.aiDamage(s, amount, zone, source, dir, opts);
        this.crew.push(s);
      });
    }
    // ящик с боеприпасами (разрушаемый: попадание — взрыв боекомплекта)
    this.box = this._makeBox();
    if (this.tr === 0) this._placeBox();
    this.casing = { t: 9, p: new THREE.Vector3(), v: new THREE.Vector3() };
    // взаимодействие
    // место наводчика (слева у маховиков) и работа с орудием (справа у колеса / у проушины)
    this.gunIt = {
      pos: new THREE.Vector3(x, y0 + 1.0, z), r: 1.7, label: `Занять место наводчика: ${name}`, hold: 0.25,
      enabled: () => !m.player.gun && !m.player.carry && !this.netUser && m.player.body.alive && this.ready, action: () => this.mount(m.player),
    };
    const self = this;
    const can = () => m.player.body.alive && !m.player.gun && !m.player.vehicle && !m.player.carry && !this.netUser && this.tr === this.trTarget;
    // справа у колеса: боевое ↔ походное положение
    this.posIt = {
      pos: new THREE.Vector3(x, y0 + 1.0, z), r: 1.7, hold: 1.0,
      get label() { return self.tr === 0 ? `Привести ${self.name} в походное положение (≈${Math.round(self.transTime)} с)` : `Привести ${self.name} в боевое положение (≈${Math.round(self.transTime)} с)`; },
      enabled: () => can() && !this.towBy,
      action: () => { if (this.tr === 0) this.startTravel(); else this.startDeploy(); },
    };
    // у буксирной проушины: прицепить / отцепить
    this.towIt = {
      pos: new THREE.Vector3(x, y0 + 1.0, z), r: 2.2, hold: 0.8,
      get label() { return self.towLabel(); },
      enabled: () => can() && this.tr === 1,
      action: () => this.towAction(),
    };
    // ручное заряжание, когда расчёт выбыл: взять снаряд/заряд из ящика, дослать у казённика
    this.boxIt = {
      pos: new THREE.Vector3(x, y0 + 0.8, z), r: 1.8, hold: 0.5,
      get label() { return self._boxLabel(); },
      enabled: () => m.player.body.alive && !m.player.gun && !m.player.vehicle && !m.player.carry && this.box.alive && !this.box.stowed && !this.crewAlive(),
      action: () => this.manualPick(m.player),
    };
    this.breechIt = {
      pos: new THREE.Vector3(x, y0 + 1.0, z), r: 1.7, hold: 0.6,
      get label() { return m.player.carry && m.player.carry.item === 'shell' ? `Дослать снаряд в ${self.name}` : `Вставить гильзу с зарядом в ${self.name}`; },
      enabled: () => { const c = m.player.carry; return !!c && c.gun === this && this.ready && !this.loaded && this.breech > 0.9 && (c.item === 'shell' ? !(this.load && this.load.shellIn) : !!(this.load && this.load.shellIn && !this.load.chargeIn)); },
      action: () => this.manualInsert(m.player),
    };
    m.interactables.push(this.gunIt, this.posIt, this.towIt, this.boxIt, this.breechIt);
    this.ui = null;
    if (towBy) this.hitch(towBy, true);
    this._place();
  }

  get ready() { return this.tr === 0 && this.trTarget === 0 && !this.towBy; }
  get spec() { return D30_SPEC; }

  // Препятствия орудия: щит (впереди наводчика, тонкая броня) и верхний станок с люлькой.
  // Наводчик слева-сзади и расчёт стоят СНАРУЖИ — их можно поразить сбоку, сзади и сверху.
  _makeCollider() {
    this._dropCollider();
    const W = this.m.world, P = this.pos, yaw = -this.az * MIL;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const at = (lx, lz) => ({ x: P.x + lx * c + lz * s, z: P.z - lx * s + lz * c });
    const sh = at(0, -0.6);
    this.colliders = [
      W.addBoxCollider({ x: sh.x, z: sh.z, y0: P.y + 0.55, w: 2.1, d: 0.12, h: 1.08, yaw, mat: 'armor', pen: 18, cover: true, owner: { kind: 'gun', gun: this } }), // щит: противопульная броня — 5,45/7,62 не берут, 14,5 прошивает
      W.addCylCollider({ x: P.x, z: P.z, y0: P.y, r: 0.42, h: 1.35, mat: 'armor', pen: 60, cover: true, owner: { kind: 'gun', gun: this } }),
    ];
    this.collider = this.colliders[1];
    this._colAz = this.az;
  }
  _dropCollider() {
    for (const o of this.colliders || []) this.m.world.removeObstacle(o);
    this.colliders = []; this.collider = null;
  }

  // ---------- походное положение, прицеп ----------
  towLabel() {
    if (this.towBy) return `Отцепить ${this.name} от ${this.towBy.type.name}`;
    const v = this.nearHitchVehicle();
    return v ? `Прицепить ${this.name} к ${v.type.name}` : `Буксирная проушина: подгоните тягач задом (фаркоп ближе 4 м)`;
  }

  // фаркоп машины (сзади по оси, на высоте проушины)
  hitchPoint(v, out = new THREE.Vector3()) { return v.toWorld(0, 0.62, v.type.hitch, out); }
  lunetteWorld(out = new THREE.Vector3()) {
    this.model.recoil.updateWorldMatrix(true, false);
    return out.copy(D30.lunette).applyMatrix4(this.model.recoil.matrixWorld);
  }
  nearHitchVehicle() {
    const L = this.lunetteWorld();
    let best = null, bd = HITCH_R;
    for (const v of this.m.vehicles) {
      if (!v.alive || v.towing || Math.abs(v.speed) > 1.5 || !v.type.hitch) continue;
      const d = this.hitchPoint(v).distanceTo(L);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  towAction() {
    if (this.towBy) {
      if (Math.abs(this.towBy.speed) > 1.5) { this.m.hud.message('Сначала остановите тягач', 2); return; }
      this.unhitch(); return;
    }
    if (this.tr !== 1 || this.trTarget !== 1) return;
    const v = this.nearHitchVehicle();
    if (v) this.hitch(v);
    else this.m.hud.message('Тягач далеко: подгоните его задом так, чтобы фаркоп был у проушины (ближе 4 м), и остановитесь', 3);
  }

  // можно ли прицепить к этой машине прямо сейчас (для водителя)
  canHitch(v) {
    if (this.towBy || this.tr !== 1 || this.trTarget !== 1 || v.towing || !v.alive || Math.abs(v.speed) > 1.5) return false;
    return this.hitchPoint(v).distanceTo(this.lunetteWorld()) < HITCH_R;
  }

  _net(e) { const n = this.m.net; if (n) n.ev(['gm', this.m.guns.indexOf(this), ...e]); }

  startTravel(fromNet = false) {
    if (this.tr !== 0 || this.trTarget !== 0) return;
    if (this.m.player.gun === this) this.dismount(this.m.player);
    this.trTarget = 1; this.loaded = null; this.load = null;
    for (const c of this.crew) c.job = null;
    this._stowBox();
    this.m.hud.message(`Расчёт приводит ${this.name} в походное положение: станины сводятся, ствол на походное крепление`, 4);
    this.m.audio.mech('reload');
    if (!fromNet) this._net(['t']);
  }
  startDeploy(fromNet = false, az = null) {
    if (this.tr !== 1 || this.towBy) return;
    // ствол остаётся направленным туда, куда смотрел в походе (на машину)
    this.az = az ?? ((((-(this.rootYaw + Math.PI)) / MIL) % 6000) + 6000) % 6000;
    this.elM = 0;
    this.trTarget = 0;
    this.m.hud.message(`Расчёт приводит ${this.name} в боевое положение: станины разводятся, орудие на опорную плиту`, 4);
    this.m.audio.mech('reload');
    if (!fromNet) this._net(['c', Math.round(this.az)]);
  }
  hitch(v, silent = false, fromNet = false) {
    if (this.towBy || this.tr !== 1) return;
    this.towBy = v; v.towing = this;
    this.snapT = silent ? 0 : 0.7;
    this._snapFrom = { pos: this.pos.clone(), yaw: this.rootYaw };
    this._dropCollider();
    if (!silent) { this.m.hud.message(`${this.name} прицеплена к ${v.type.name}. Тягач медленнее — масса орудия 3,2 т`, 3); this.m.audio.mech('switch'); }
    if (!fromNet && !silent) this._net(['h', this.m.vehicles.indexOf(v)]);
  }
  unhitch(fromNet = false, pose = null) {
    const v = this.towBy;
    if (!v) return;
    v.towing = null; this.towBy = null;
    if (pose) { this.pos.x = pose[0]; this.pos.z = pose[1]; this.rootYaw = pose[2]; this.pos.y = this.m.terrain.heightAt(this.pos.x, this.pos.z); }
    this.m.hud.message(`${this.name} отцеплена`, 2);
    this.m.audio.mech('switch');
    if (!fromNet) this._net(['u', +this.pos.x.toFixed(2), +this.pos.z.toFixed(2), +this.rootYaw.toFixed(3)]);
  }

  // Сетевые события расчёта орудия
  netOp(e) {
    const op = e[2];
    if (op === 't') this.startTravel(true);
    else if (op === 'c') { if (this.towBy) this.unhitch(true); this.startDeploy(true, e[3]); }
    else if (op === 'h') { const v = this.m.vehicles[e[3]]; if (v && !this.towBy) { if (this.tr !== 1) { this.tr = this.trTarget = 1; this._dropCollider(); } this.hitch(v, false, true); } }
    else if (op === 'u') this.unhitch(true, [e[3], e[4], e[5]]);
    else if (op === 'l') this.orderLoad(true, e[3], e[4] ? 'Ф' : 'О', e[5] ? 'd' : 'of');
    else if (op === 'k') this.manualPick(null, true, e[3]);
    else if (op === 'n') this.manualInsert(null, true, e[3], e[4], e[5] ? 'Ф' : 'О');
  }

  // Геометрия походного положения: проушина относительно лафета (считается один раз)
  _travelGeom() {
    if (this._lun) return this._lun;
    const g = this.model;
    const save = { p: g.root.position.clone(), r: g.root.rotation.clone(), tr: this.tr };
    g.root.position.set(0, 0, 0); g.root.rotation.set(0, 0, 0);
    this.tr = 1; this._pose();
    g.root.updateMatrixWorld(true);
    const L = this.lunetteWorld();
    this._lun = { z: L.z, y: L.y, d: L.z - AXLE };
    g.root.position.copy(save.p); g.root.rotation.copy(save.r); this.tr = save.tr;
    return this._lun;
  }

  // Буксировка: ось колёс тянется за фаркопом на постоянном расстоянии (кинематика прицепа)
  _tow(dt) {
    const v = this.towBy, m = this.m, T = m.terrain;
    if (!v.alive) { this.unhitch(true); return; }
    const G = this._travelGeom();
    const H = this.hitchPoint(v);
    const ax = this.pos.x + Math.sin(this.rootYaw) * AXLE, az = this.pos.z + Math.cos(this.rootYaw) * AXLE;
    let ry = Math.atan2(H.x - ax, H.z - az);
    // складывание сцепки ограничено
    const base = v.yaw + Math.PI;
    ry = base + clamp(wrapA(ry - base), -1.25, 1.25);
    const Ax = H.x - Math.sin(ry) * G.d, Az = H.z - Math.cos(ry) * G.d;
    const c = Math.cos(ry), s = Math.sin(ry);
    const hL = T.heightAt(Ax - 0.95 * c, Az + 0.95 * s), hR = T.heightAt(Ax + 0.95 * c, Az - 0.95 * s);
    const ga = (hL + hR) / 2;
    let px = Ax - s * AXLE, pz = Az - c * AXLE;
    if (this.snapT > 0) {
      this.snapT = Math.max(0, this.snapT - dt);
      const k = 1 - this.snapT / 0.7, f = this._snapFrom;
      px = f.pos.x + (px - f.pos.x) * k; pz = f.pos.z + (pz - f.pos.z) * k;
      ry = f.yaw + wrapA(ry - f.yaw) * k;
    }
    this.pos.set(px, ga, pz);
    this.rootYaw = ry;
    this.rootRoll = Math.atan2(hR - hL, 1.9);
    this.rootPitch = -Math.atan2(H.y - (ga + G.y), G.z);
  }

  get charge() { return CHARGES[this.ci]; }
  // требуемое возвышение по прицелу и уровню
  get wantEl() { return this.drum + (this.level - 3000); }

  // Поза орудия по степени перевода tr (0 — боевое, 1 — походное)
  _pose() {
    const g = this.model, e = ease(this.tr);
    const lift = clamp(e / 0.35, 0, 1);                 // сначала колёса опускаются, лафет поднимается
    const trailK = ease(clamp((e - 0.25) / 0.5, 0, 1));  // станины сводятся и поднимаются к стволу
    const barK = ease(clamp((e - 0.15) / 0.6, 0, 1));    // ствол — на походное крепление над станинами
    g.body.position.y = D30.lift * lift;
    for (const w of g.wheels) w.position.y = 0.66 - (0.66 - 0.57 + D30.lift) * lift;
    const tgt = [Math.PI - 0.21, Math.PI, Math.PI + 0.21];
    g.trails.forEach((t, k) => {
      const a0 = t.a, a1 = tgt[k === 0 ? 0 : k === 1 ? 1 : 2];
      t.g.rotation.y = a0 + wrapA(a1 - a0) * trailK;
      t.g.rotation.x = 0.22 * trailK;
    });
    const relC = wrapA(-this.az * MIL - this.rootYaw);
    g.yaw.rotation.y = relC + wrapA(Math.PI - relC) * barK;
    g.pitch.rotation.x = this.elM * MIL * (1 - barK) + TRAVEL_EL * barK;
  }

  _place() {
    const g = this.model;
    g.root.position.copy(this.pos);
    g.root.rotation.set(this.rootPitch, this.rootYaw, this.rootRoll, 'YXZ');
    this._pose();
    // откат и накат
    const t = this.recoilT;
    const r = t < 0.06 ? t / 0.06 : t < 1.3 ? 1 - Math.pow((t - 0.06) / 1.24, 0.7) : 0;
    g.recoil.position.z = r * D30.recoil;
    // клин: открывается в конце наката, закрывается после заряжания
    g.wedge.position.y = -0.02 - this.breech * 0.16;
    g.root.updateMatrixWorld(true);
    // точки взаимодействия: наводчик — слева у маховиков, расчёт — справа у колеса или у проушины
    if (this.gunIt) {
      this.gunIt.pos.copy(this.seatWorld()); this.gunIt.pos.y += 1.0;
      this.posIt.pos.set(0.95, 0.7, 0.15).applyMatrix4(g.body.matrixWorld);
      this.lunetteWorld(this.towIt.pos);
      if (this.box) this.boxIt.pos.copy(this.box.pos).setY(this.box.pos.y + 0.5);
      if (this.tr === 0) { const bp = this._breechPoints(); this.breechIt.pos.copy(bp.S).setY(bp.S.y + 1.0); }
      this.towIt.pos.y = Math.max(this.towIt.pos.y, this.m.terrain.heightAt(this.towIt.pos.x, this.towIt.pos.z) + 0.9);
    }
  }

  // ---------- расчёт ----------
  // точка на станине k в мире (сошник — ручка у конца станины)
  _trailPt(k, x, y, z, out = new THREE.Vector3()) { return out.set(x, y, z).applyMatrix4(this.model.trails[k].g.matrixWorld); }

  _crew(dt) {
    if (!this.crew.length) return;
    const T = this.m.terrain, g = this.model, e = ease(this.tr);
    const moving = this.tr !== this.trTarget;
    const show = !this.towBy && (this.tr < 1 || moving);
    const P = this.pos;
    const ground = (v) => { v.y = T.heightAt(v.x, v.z); return v; };
    const faceTo = (from, to) => Math.atan2(-(to.x - from.x), -(to.z - from.z));
    const t = this.m.time;
    const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -this.az * MIL);
    const idleTask = (a) => {
      const p = ground(a.idle.local.clone().applyQuaternion(yawQ).add(P));
      return { p, yaw: -this.az * MIL + a.idle.ry, pose: a.idle.pose };
    };
    // работа со станинами, креплением ствола, колёсами (перевод из положения в положение)
    const transTask = (k) => {
      if (k < 2) {
        const tk = k === 0 ? 0 : 2;
        const H = this._trailPt(tk, 0, 0.32, -2.9), piv = this._trailPt(tk, 0, 0.32, -0.4);
        const out = new THREE.Vector3(H.x - piv.x, 0, H.z - piv.z).normalize();
        const p = ground(H.clone().addScaledVector(out, 0.62));
        const hy = H.y - p.y;
        const side = new THREE.Vector3(-out.z, 0, out.x).multiplyScalar(0.13);
        let hands = [H.clone().add(side), H.clone().sub(side)], pose, carry = false;
        if (e < 0.25) { pose = 'kneel'; const bob = Math.max(0, Math.sin(t * 7 + tk)) * 0.12; hands = hands.map((h) => h.clone().setY(h.y - 0.1 + bob)); }
        else if (e <= 0.75) { pose = hy < 0.62 ? 'crouch' : 'stand'; carry = true; }
        else pose = hy < 0.62 ? 'crouch' : 'stand';
        return { p, yaw: faceTo(p, piv), pose, hands, carry, from: p.clone().addScaledVector(out, 2.5) };
      }
      if (e > 0.3) {
        const L = new THREE.Vector3(0, -0.12, -2.35).applyMatrix4(g.recoil.matrixWorld), L2 = new THREE.Vector3(0, -0.12, -2.0).applyMatrix4(g.recoil.matrixWorld);
        const ax = new THREE.Vector3(L.x - L2.x, 0, L.z - L2.z).normalize(), sideV = new THREE.Vector3(-ax.z, 0, ax.x);
        const p = ground(L.clone().addScaledVector(sideV, 0.62));
        return { p, yaw: faceTo(p, L), pose: L.y - p.y < 0.75 ? 'crouch' : 'stand', hands: [L.clone().addScaledVector(ax, 0.16), L.clone().addScaledVector(ax, -0.16)], from: p.clone().addScaledVector(sideV, 2) };
      }
      const W = new THREE.Vector3(); g.wheels[1].getWorldPosition(W);
      const out = new THREE.Vector3(W.x - P.x, 0, W.z - P.z).normalize();
      const p = ground(W.clone().addScaledVector(out, 0.75));
      const pump = Math.sin(t * 5) * 0.09, hub = W.clone().addScaledVector(out, 0.15), fwd = new THREE.Vector3(-out.z, 0, out.x);
      return { p, yaw: faceTo(p, W), pose: 'work', hands: [hub.clone().addScaledVector(fwd, 0.18).setY(hub.y + 0.05 + pump), hub.clone().addScaledVector(fwd, -0.12).setY(hub.y + 0.05 + pump)] };
    };
    // живые номера делят работу при переводе: у кого меньше людей — тот дольше
    const alive = this.crew.filter((a) => a.alive);
    for (const a of this.crew) {
      const M = a.man;
      if (!a.alive) { M.visible = true; M.update(dt, { p: M.pos, yaw: M.yaw, dead: true }); a.sync(); a.hidden = true; continue; }
      M.visible = show;
      if (!show) { a.sync(); continue; }
      let task;
      if (moving || this.tr > 0) task = transTask(alive.indexOf(a) % 3);
      else if (a.job) task = this._jobTask(a, dt);
      else task = idleTask(a);
      M.update(dt, task);
      a.sync();
    }
  }

  get transTime() { return TRANS_TIME / [0.35, 0.5, 0.75, 1][Math.min(3, this.crew.length ? this.crew.filter((a) => a.alive).length : 3)]; }
  crewAlive() { return this.crew.some((a) => a.alive); }

  // ---------- ящик с боеприпасами ----------
  _makeBox() {
    const m = this.m, g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x5b4a2e, roughness: 0.85 });
    const woodD = new THREE.MeshStandardMaterial({ color: 0x433621, roughness: 0.9 });
    const stencil = new THREE.MeshStandardMaterial({ color: 0x1d1d18, roughness: 0.9 });
    // штабель укупорок: ящики со снарядами (длинные) и с зарядами (короткие)
    const crate = (w, h, d, x, y, z, ry, mat) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); b.position.set(x, y, z); b.rotation.y = ry; b.castShadow = true; b.receiveShadow = true; g.add(b); return b; };
    crate(1.0, 0.28, 0.42, -0.25, 0.14, 0, 0, wood); crate(1.0, 0.28, 0.42, -0.25, 0.14, 0.46, 0.02, wood); crate(1.0, 0.28, 0.42, -0.25, 0.42, 0.22, -0.03, woodD);
    crate(0.62, 0.3, 0.4, 0.62, 0.15, 0.05, 0.1, woodD); crate(0.62, 0.3, 0.4, 0.62, 0.15, 0.5, -0.05, wood);
    for (const z of [0, 0.46]) crate(0.3, 0.005, 0.12, -0.25, 0.283, z, 0, stencil);
    // открытый ящик: видны носики снарядов
    const I = crewItemsLazy();
    for (let i = 0; i < 3; i++) { const sh = I.shell.clone(); sh.rotation.y = Math.PI / 2; sh.position.set(-0.25, 0.62, 0.08 + i * 0.13); g.add(sh); }
    g.visible = false;
    m.scene.add(g);
    const d = { kind: 'ammo', hp: 14, maxHp: 14, mesh: g, pos: new THREE.Vector3(), alive: true, r: 0.8, gun: this, stowed: true, collider: null };
    m.world.destructibles.push(d);
    return d;
  }

  _boxPlace() {
    const yaw = -this.az * MIL, c = Math.cos(yaw), s = Math.sin(yaw);
    const lx = 2.2, lz = BOX_DIST;
    return { x: this.pos.x + lx * c + lz * s, z: this.pos.z - lx * s + lz * c, yaw };
  }
  _placeBox() {
    const d = this.box;
    if (!d.alive) return;
    const W = this.m.world, b = this._boxPlace();
    const y = this.m.terrain.heightAt(b.x, b.z);
    d.pos.set(b.x, y + 0.35, b.z); d.yaw = b.yaw;
    d.mesh.position.set(b.x, y, b.z); d.mesh.rotation.y = b.yaw; d.mesh.visible = true;
    if (d.collider) W.removeObstacle(d.collider);
    d.collider = W.addBoxCollider({ x: b.x, z: b.z, y0: y, w: 1.7, d: 1.0, h: 0.72, yaw: b.yaw, mat: 'wood', pen: 8, owner: d, cover: true });
    d.stowed = false;
  }
  _stowBox() {
    const d = this.box;
    if (d.collider) { this.m.world.removeObstacle(d.collider); d.collider = null; }
    d.stowed = true; d.mesh.visible = false;
  }

  // попадание в ящик: детонация боекомплекта — 50 снарядов и 50 зарядов
  boxExplode(by) {
    const m = this.m, d = this.box, P = d.pos.clone();
    this.shells = 0; this.charges = 0; this.load = null; this.loaded = null;
    for (const c of this.crew) c.job = null;
    if (m.player.carry && m.player.carry.gun === this) m.player.carry = null;
    if (d.collider) { m.world.removeObstacle(d.collider); d.collider = null; }
    d.mesh.visible = false;
    m.fx.shellBurst(P);
    m.audio.explosion(P, 3);
    for (let k = 1; k <= 4; k++) m.after(0.18 * k + Math.random() * 0.2, () => { const Q = P.clone().add(new THREE.Vector3((Math.random() - 0.5) * 8, 0, (Math.random() - 0.5) * 8)); Q.y = m.terrain.heightAt(Q.x, Q.z) + 0.3; m.fx.shellBurst(Q); m.audio.explosion(Q, 2); });
    m.fx.addFire(P, 2.4, 150);
    m.fx.addDecal(new THREE.Vector3(P.x, m.terrain.heightAt(P.x, P.z), P.z), new THREE.Vector3(0, 1, 0), 9, 0x141210);
    m.noise(P, 2500, this.team, by || null);
    m.player.shake = Math.max(m.player.shake, 2.5 * Math.max(0, 1 - P.distanceTo(m.camPos) / 300));
    if (!m.netVisual) m.projectiles.explode(P, { radius: 18, frag: 55, dmg: 700, pen: 45, fxSize: 4 }, by, null, null, { fx: false });
    m.hud.message(`Взрыв боекомплекта у ${this.name}!`, 4, true);
  }

  _boxLabel() {
    const c = this.m.player.carry;
    if (c) return 'Руки заняты';
    const needShell = !(this.load && this.load.shellIn);
    return needShell ? `Взять снаряд ОФ-462 (в ящике ${this.shells})` : `Взять гильзу с зарядом (в ящике ${this.charges})`;
  }

  // игрок сам носит из ящика (расчёт выбыл)
  manualPick(p, fromNet = false, item = null) {
    const it = item || (this.load && this.load.shellIn ? 'charge' : 'shell');
    if (it === 'shell' ? this.shells <= 0 : this.charges <= 0) { if (!fromNet) this.m.hud.message(it === 'shell' ? 'Снаряды кончились' : 'Заряды кончились', 2); return; }
    if (it === 'shell') this.shells--; else this.charges--;
    if (fromNet) return;
    p.carry = { item: it, gun: this };
    this.m.audio.mech('reload');
    this.m.hud.message(it === 'shell' ? 'Снаряд в руках (22 кг): несите к казённику справа, E — дослать' : 'Гильза с зарядом в руках: к казённику, E — вставить', 3);
    this._net(['k', it]);
  }
  manualInsert(p, fromNet = false, item = null, ci = null, fuze = null) {
    const it = item || (p.carry && p.carry.item);
    if (!it) return;
    if (!this.load) this.load = { ci: ci ?? this.ci, fuze: fuze ?? this.fuze, shell: this.shellType, shellIn: false, chargeIn: false, closeT: 0 };
    this.load[it + 'In'] = true;
    this.m.audio.mech(it === 'shell' ? 'reload' : 'switch');
    if (fromNet) return;
    p.carry = null;
    this.m.hud.message(it === 'shell' ? 'Снаряд дослан. Теперь гильза с зарядом' : 'Заряд вставлен, клин закрыт', 2.5);
    this._net(['n', it, this.load.ci, this.load.fuze === 'О' ? 0 : 1]);
  }

  // команда «Заряжай!» (наводчик, R)
  orderLoad(fromNet = false, ci = null, fuze = null, shell = null) {
    const m = this.m;
    const say = (t, d = 1.5) => { if (!fromNet) m.hud.message(t, d); };
    if (this.loaded) return say('Орудие заряжено');
    if (this.load) return say('Уже заряжают');
    if (this.recoilT < 1.4) return say('Ствол накатывается…', 1.2);
    if (!this.box.alive || this.shells <= 0 || this.charges <= 0) return say('Боеприпасы кончились', 2.5);
    this.load = { ci: ci ?? this.ci, fuze: fuze ?? this.fuze, shell: shell ?? this.shellType, shellIn: false, chargeIn: false, closeT: 0 };
    if (!fromNet) {
      if (!this.crewAlive()) m.hud.message(`Расчёт выбыл: снаряд и заряд носите сами — ящик в ${BOX_DIST} м за орудием (E), затем к казённику справа (E)`, 5);
      else m.hud.radio('Командир орудия', this.load.shell === 'd' ? `Заряжай! Дымовым, заряд ${CHARGES[this.load.ci].name}` : `Заряжай! Осколочно-фугасным, заряд ${CHARGES[this.load.ci].name}, взрыватель ${this.load.fuze === 'О' ? 'осколочный' : 'фугасный'}`);
      m.audio.mech('reload');
      this._net(['l', this.load.ci, this.load.fuze === 'О' ? 0 : 1, this.load.shell === 'd' ? 1 : 0]);
    }
  }

  loadStatus() {
    const L = this.load;
    if (this.loaded) return null;
    if (!L) return this.recoilT < 1.4 ? 'накат ствола…' : null;
    if (L.shellIn && L.chargeIn) return 'клин закрывается…';
    const job = (it) => { const c = this.crew.find((a) => a.alive && a.job && a.job.item === it); return c ? { toBox: 'бежит к ящику', pick: 'берёт из ящика', toGun: 'несёт', wait: 'ждёт у казённика', insert: 'досылает' }[c.job.phase] : null; };
    const a = L.shellIn ? 'снаряд дослан' : `снаряд: ${job('shell') || (this.crewAlive() ? 'ждём' : 'несите сами')}`;
    const b = L.chargeIn ? 'заряд вставлен' : `заряд: ${job('charge') || (this.crewAlive() ? 'ждём' : 'несите сами')}`;
    return `${a} · ${b}`;
  }

  // распределение работы при заряжании и закрывание клина
  _loadStep(dt) {
    const L = this.load;
    if (!L) return;
    for (const c of this.crew) if (c.job && !c.alive) c.job = null;
    if (this.tr !== 0) { this.load = null; return; }
    const busy = (it) => this.crew.some((a) => a.alive && a.job && a.job.item === it);
    for (const it of ['shell', 'charge']) {
      if (L[it + 'In'] || busy(it)) continue;
      if ((it === 'shell' ? this.shells : this.charges) <= 0 && !busy(it)) continue;
      for (const i of it === 'shell' ? [1, 2, 0] : [2, 1, 0]) {
        const a = this.crew[i];
        if (a && a.alive && !a.hidden && !a.job) { a.job = { item: it, phase: 'toBox', t: 0 }; break; }
      }
    }
    if (L.shellIn && L.chargeIn) {
      L.closeT += dt;
      this.breech = Math.max(0, 1 - L.closeT / 0.6);
      if (L.closeT >= 0.6) {
        this.loaded = { ci: L.ci, fuze: L.fuze, shell: L.shell || 'of' }; this.load = null; this.breech = 0;
        if (this.m.player.gun === this) this.m.hud.radio(this.crewAlive() ? 'Замковый' : this.name, 'Готово!');
        this.m.audio.mech('switch');
      }
    }
  }

  // точка у казённика справа-сзади, где номер досылает снаряд
  _breechPoints() {
    const R = this.model.recoil.matrixWorld;
    const B = new THREE.Vector3(0, 0, D30.breech + 0.02).applyMatrix4(R);
    const E = new THREE.Vector3(0, 0, D30.breech + 0.42).applyMatrix4(R);
    const S = new THREE.Vector3(0.62, 0, D30.breech + 0.5).applyMatrix4(R);
    S.y = this.m.terrain.heightAt(S.x, S.z);
    const q = new THREE.Quaternion(); this.model.recoil.getWorldQuaternion(q);
    return { B, E, S, q };
  }

  // задача номера, занятого заряжанием
  _jobTask(a, dt) {
    const j = a.job, M = a.man, L = this.load;
    if (!L) { a.job = null; return { p: M.pos.clone(), yaw: M.yaw, pose: 'stand' }; }
    j.t += dt;
    const box = this.box;
    if (!box.alive || box.stowed) { a.job = null; return { p: M.pos.clone(), yaw: M.yaw, pose: 'stand' }; }
    const bp = this._breechPoints();
    const bx = box.pos, toGun = new THREE.Vector3(this.pos.x - bx.x, 0, this.pos.z - bx.z).normalize();
    const boxStand = new THREE.Vector3(bx.x, 0, bx.z).addScaledVector(toGun, 0.85).add(new THREE.Vector3(-toGun.z, 0, toGun.x).multiplyScalar(j.item === 'shell' ? -0.35 : 0.35));
    boxStand.y = this.m.terrain.heightAt(boxStand.x, boxStand.z);
    const faceBox = Math.atan2(-(bx.x - boxStand.x), -(bx.z - boxStand.z));
    const low = bp.B.y - bp.S.y < 0.85;
    switch (j.phase) {
      case 'toBox': {
        if (Math.hypot(M.pos.x - boxStand.x, M.pos.z - boxStand.z) < 0.25) { j.phase = 'pick'; j.t = 0; }
        return { p: boxStand, yaw: faceBox, pose: 'stand', speed: V_RUN };
      }
      case 'pick': {
        if (j.t > 1.0) {
          const has = j.item === 'shell' ? this.shells : this.charges;
          if (has <= 0) { a.job = null; this.m.hud.message(j.item === 'shell' ? 'Снаряды кончились' : 'Заряды кончились', 2); return { p: boxStand, yaw: faceBox, pose: 'stand' }; }
          if (j.item === 'shell') this.shells--; else this.charges--;
          j.phase = 'toGun'; j.t = 0;
        }
        const top = new THREE.Vector3(bx.x, bx.y + 0.3, bx.z);
        return { p: boxStand, yaw: faceBox, pose: 'work', hands: [top.clone().add(new THREE.Vector3(-0.15, 0, 0)), top.clone().add(new THREE.Vector3(0.15, 0, 0))] };
      }
      case 'toGun': {
        if (Math.hypot(M.pos.x - bp.S.x, M.pos.z - bp.S.z) < 0.3) { j.phase = j.item === 'charge' && !L.shellIn ? 'wait' : 'insert'; j.t = 0; }
        return { p: bp.S.clone(), yaw: Math.atan2(-(bp.B.x - bp.S.x), -(bp.B.z - bp.S.z)), pose: 'stand', speed: V_CARRY, carry: true, item: j.item };
      }
      case 'wait': {
        if (L.shellIn) { j.phase = 'insert'; j.t = 0; }
        return { p: bp.S.clone(), yaw: Math.atan2(-(bp.B.x - bp.S.x), -(bp.B.z - bp.S.z)), pose: low ? 'crouch' : 'stand', carry: true, item: j.item };
      }
      case 'insert': {
        const dur = j.item === 'shell' ? 1.1 : 0.8;
        const u = Math.min(1, j.t / dur);
        // предмет ложится на лоток у казённика и уходит в камору по оси канала
        const pos = u < 0.45 ? M.pos.clone().setY(M.pos.y + 1.0).lerp(bp.E, u / 0.45) : bp.E.clone().lerp(bp.B, (u - 0.45) / 0.55);
        if (u >= 1) { L[j.item + 'In'] = true; a.job = null; this.m.audio.mech(j.item === 'shell' ? 'reload' : 'switch'); return { p: bp.S.clone(), yaw: M.yaw, pose: 'stand' }; }
        return { p: bp.S.clone(), yaw: Math.atan2(-(bp.B.x - bp.S.x), -(bp.B.z - bp.S.z)), pose: low ? 'crouch' : 'stand', carry: true, item: j.item, itemPos: pos, itemQuat: bp.q };
      }
    }
    return { p: M.pos.clone(), yaw: M.yaw, pose: 'stand' };
  }

  // ---------- место наводчика ----------
  mount(p) {
    if (!this.ready) { this.m.hud.message('Орудие не в боевом положении', 2); return; }
    p.gun = this;
    this.view = 'pano';
    if (!this.ui) this.ui = new GunUI(this);
    this.ui.show(true);
    this.m.hud.message(`${this.name}: место наводчика. G — гайд, M — карта огня, T — таблица стрельбы`, 4);
  }

  dismount(p) {
    p.gun = null;
    this.model.root.visible = true;
    if (this.ui) this.ui.show(false);
    const q = new THREE.Vector3(-1.4, 0, 1.6).applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.az * MIL).add(this.pos);
    p.body.pos.set(q.x, this.m.terrain.heightAt(q.x, q.z), q.z);
    p.yaw = -this.az * MIL;
  }

  // Управление (вызывается из Player.update)
  control(dt) {
    const m = this.m, inp = m.input, p = m.player;
    const fast = inp.bd('sprint');
    if (inp.bh('use')) { this.dismount(p); return; }
    // переключатели
    if (inp.hit('KeyV')) { this.view = VIEWS[(VIEWS.indexOf(this.view) + 1) % VIEWS.length]; m.hud.message(VIEW_NAMES[this.view], 1.5); }
    if (inp.hit('KeyG')) { this.ui.guide(); return; }
    if (inp.hit('KeyM')) { this.ui.fireMap(); return; }
    if (inp.hit('KeyT')) { this.ui.table(this.ci); return; }
    for (let i = 0; i < 6; i++) if (inp.hit('Digit' + (i + 1))) {
      if (this.loaded || this.load) m.hud.message('Орудие уже заряжают — заряд сменить нельзя', 2);
      else { this.ci = i; m.hud.message(`Заряд ${CHARGES[i].name}`, 1.5); m.audio.click(); }
    }
    if (inp.hit('KeyZ')) {
      if (this.loaded || this.load) m.hud.message('Снаряд выбирается до заряжания', 2);
      else { this.shellType = this.shellType === 'd' ? 'of' : 'd'; m.hud.message(this.shellType === 'd' ? 'Снаряд Д-462 — дымовой (завеса ≈ 1,5 мин)' : 'Снаряд ОФ-462 — осколочно-фугасный', 2); m.audio.click(); }
    }
    if (inp.hit('KeyX')) {
      if (this.loaded || this.load) m.hud.message('Взрыватель устанавливается до заряжания', 2);
      else { this.fuze = this.fuze === 'О' ? 'Ф' : 'О'; m.hud.message(this.fuze === 'О' ? 'Взрыватель РГМ-2: осколочное действие' : 'Взрыватель РГМ-2: фугасное действие (замедление)', 2); m.audio.click(); }
    }
    // прицел и уровень (механический прицел)
    const st = fast ? 10 : 1;
    if (inp.bh('sightUp') || inp.hit('BracketRight')) { this.drum = clamp(this.drum + st, 0, 1200); m.audio.mech('sight'); }
    if (inp.bh('sightDown') || inp.hit('BracketLeft')) { this.drum = clamp(this.drum - st, 0, 1200); m.audio.mech('sight'); }
    if (this.view !== 'side' && inp.wheel) { this.drum = clamp(this.drum + (inp.wheel < 0 ? 1 : -1) * st, 0, 1200); m.audio.mech('sight'); }
    if (inp.hit('Equal') || inp.hit('NumpadAdd')) { this.level = clamp(this.level + st, 2700, 3300); m.audio.mech('sight'); }
    if (inp.hit('Minus') || inp.hit('NumpadSubtract')) { this.level = clamp(this.level - st, 2700, 3300); m.audio.mech('sight'); }
    // маховики: поворотный (A/D, мышь по горизонтали) и подъёмный (W/S, мышь по вертикали)
    const sens = m.settings.sens * 0.25;
    const tr = ((inp.bd('moveR') ? 1 : 0) - (inp.bd('moveL') ? 1 : 0)) * (fast ? 150 : 15);
    const ev = ((inp.bd('moveF') ? 1 : 0) - (inp.bd('moveB') ? 1 : 0)) * (fast ? 70 : 6);
    if (this.view === 'side') {
      this.orbit.yaw -= inp.dx * 0.004; this.orbit.pitch = clamp(this.orbit.pitch + inp.dy * 0.003, -0.1, 1.2);
      if (inp.wheel) this.orbit.dist = clamp(this.orbit.dist + Math.sign(inp.wheel) * 0.8, 4, 20);
    } else {
      this.az += inp.dx * sens * (this.view === 'eye' ? 4 : 1);
      this.elM -= inp.dy * sens * (this.view === 'eye' ? 4 : 1) * (m.settings.invertY ? -1 : 1);
    }
    this.az += tr * dt;
    this.elM += ev * dt;
    this.az = ((this.az % 6000) + 6000) % 6000;
    this.elM = clamp(this.elM, EL_MIN, EL_MAX);
    if (Math.abs(tr) + Math.abs(ev) > 0) { this._crank = (this._crank || 0) + dt; if (this._crank > 0.35) { this._crank = 0; m.audio.mech('sight'); } }
    // заряжание
    if (inp.bh('reload') || inp.hit('KeyR')) this.orderLoad();
    if (inp.bh('fire') || inp.hit('Space')) this.fire();
    p.body.pos.copy(this.seatWorld());
  }

  seatWorld() {
    return new THREE.Vector3(-0.62, 0, 0.75).applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.az * MIL).add(this.pos);
  }

  muzzleWorld(out = new THREE.Vector3()) {
    this.model.recoil.updateWorldMatrix(true, false);
    return out.set(0, 0, D30.muzzle).applyMatrix4(this.model.recoil.matrixWorld);
  }
  boreDir(out = new THREE.Vector3()) {
    const q = new THREE.Quaternion(); this.model.pitch.getWorldQuaternion(q);
    return out.set(0, 0, -1).applyQuaternion(q);
  }

  fire() {
    const m = this.m;
    if (!this.ready) return;
    if (!this.loaded) { if (this.load) m.hud.message('Ещё не заряжено', 1); else m.hud.message('Орудие не заряжено (R — заряжать)', 1.5); m.audio.click(); return; }
    if (this.breech > 0.05) return;
    const L = this.loaded;
    this.loaded = null;
    const pos = this.muzzleWorld(), dir = this.boreDir();
    const ammoId = (L.shell === 'd' ? 'd462_' : 'of462_') + CHARGES[L.ci].id;
    const p = m.projectiles.spawn({ weapon: WEAPONS.d30, pos, dir, owner: m.player.body, team: m.player.body.team, ammoId });
    p.fuze = L.fuze; p.gun = this; p.shotNo = ++this.shots; p.charge = L.ci;
    // фугасное действие (замедление): снаряд углубляется — меньше осколков, сильнее по укрытиям
    if (L.fuze === 'Ф' && L.shell !== 'd') p.ammo = { ...p.ammo, explosive: { ...p.ammo.explosive, pen: 140, radius: 9, frag: 20, dmg: 520 } };
    p.onLand = (pp) => this.report(pp);
    if (m.net) m.net.onLocalShot({ weapon: WEAPONS.d30, owner: m.player.body, ammoId, gun: this }, p);
    this.recoilT = 0;
    // дульное пламя, ударная волна, пыль и снег с грунта
    m.fx.muzzleBlast(pos, dir);
    m.fx.flashLight(pos, 90, 0.07, 0xffb050, 40);
    const gp = this.pos.clone().addScaledVector(new THREE.Vector3(dir.x, 0, dir.z).normalize(), 3.5);
    gp.y = m.terrain.heightAt(gp.x, gp.z);
    m.fx.impact(gp, new THREE.Vector3(0, 1, 0), 'snow', 6);
    m.audio.explosion(pos, 1.6);
    m.audio.shot(pos, 'rpg', true);
    m.player.shake = Math.max(m.player.shake, this.view === 'side' ? 0.6 : 1.2);
    m.noise(pos, 3000, 'negs', m.player.body);
    const T = firingTable(L.ci);
    m.hud.radio('Наводчик', `Выстрел! Заряд ${CHARGES[L.ci].name}, угломер ${fmtDiv(this.az)}, возвышение ${fmtDiv(this.elM)}.`);
    void T;
  }

  // Выстрел этого орудия другим игроком (сеть): откат, дульная волна, звук
  remoteFire(p) {
    const m = this.m;
    this.recoilT = 0; this.shots++; this.loaded = null; this.load = null; this.breech = 0;
    for (const c of this.crew) if (c.job && c.job.phase !== 'toBox' && c.job.phase !== 'pick') c.job = null;
    const pos = this.muzzleWorld(), dir = this.boreDir();
    m.fx.muzzleBlast(pos, dir);
    m.fx.flashLight(pos, 90, 0.07, 0xffb050, 40);
    m.audio.explosion(pos, 1.6);
    m.audio.shot(pos, 'rpg', false);
    m.noise(pos, 3000, 'negs', null);
    void p;
  }

  // Доклад наблюдателя о разрыве
  report(p) {
    const m = this.m;
    const I = (p.impact && p.impact.pos) ? p.impact.pos.clone() : p.p.clone();
    const targets = [...(m.artTargets || []), ...(m.teamMarks ? m.teamMarks() : [])];
    let best = null, bd = 1e9;
    for (const t of targets) { const d = Math.hypot(t.pos.x - I.x, t.pos.z - I.z); if (d < bd) { bd = d; best = t; } }
    const D = Math.hypot(I.x - this.pos.x, I.z - this.pos.z);
    let text = `Разрыв: Д ${Math.round(D)} м`;
    let line = null;
    if (best && bd < 1500) {
      const ux = best.pos.x - this.pos.x, uz = best.pos.z - this.pos.z, ul = Math.hypot(ux, uz);
      const fx = ux / ul, fz = uz / ul;
      const dR = (I.x - best.pos.x) * fx + (I.z - best.pos.z) * fz;
      const dL = (I.x - best.pos.x) * -fz + (I.z - best.pos.z) * fx; // вправо от линии ОП — цель
      const near = bd < (best.r || 12);
      line = near ? `${best.name}: накрытие!` : `${best.name}: ${dR > 0 ? 'перелёт' : 'недолёт'} ${Math.round(Math.abs(dR))}, ${dL > 0 ? 'правее' : 'левее'} ${Math.round(Math.abs(dL))}`;
      text += ` · ${near ? 'накрытие цели' : `${dR > 0 ? 'перелёт' : 'недолёт'} ${Math.round(Math.abs(dR))} м, ${dL > 0 ? 'правее' : 'левее'} ${Math.round(Math.abs(dL))} м`} (${best.name})`;
    }
    p.report = text;
    p.nearTgt = best && bd < 600 ? best : null;
    const g = toGrid(I.x, I.z);
    this.reports.unshift({ n: p.shotNo, x: I.x, z: I.z, X: g.X, Y: g.Y, text: line || text, t: m.time });
    if (this.reports.length > 12) this.reports.pop();
    m.after(1.2, () => m.hud.radio('Наблюдатель', line ? `Выстрел ${p.shotNo}. ${line}.` : `Выстрел ${p.shotNo}: разрыв вне района целей, X ${g.X}, Y ${g.Y}.`, true));
  }

  update(dt) {
    this.recoilT += dt;
    // перевод из положения в положение
    if (this.tr !== this.trTarget) {
      const d = dt / this.transTime;
      if (this.trTarget > this.tr) this.tr = Math.min(1, this.tr + d); else this.tr = Math.max(0, this.tr - d);
      if (this.tr === 0 && this.trTarget === 0) { this.rootPitch = 0; this.rootRoll = 0; this.pos.y = this.m.terrain.heightAt(this.pos.x, this.pos.z); this._makeCollider(); this._placeBox(); this.m.hud.message(`${this.name} в боевом положении. Наводчик — слева у маховиков (E); ящик с боеприпасами — в ${BOX_DIST} м за орудием`, 3.5); this.m.audio.mech('switch'); }
      if (this.tr === 1 && this.trTarget === 1) { this._dropCollider(); this.m.hud.message(`${this.name} в походном положении. Подгоните тягач задом к буксирной проушине (E — прицепить)`, 4); this.m.audio.mech('switch'); }
      if (this.tr > 0 && this.collider && this.trTarget === 1) this._dropCollider();
    }
    // щит поворачивается вместе с верхним станком — обновляем препятствия
    if (this.collider && Math.abs(this.az - this._colAz) > 25 && (this._colT = (this._colT || 0) + dt) > 0.3) { this._colT = 0; this._makeCollider(); }
    if (this.towBy) this._tow(dt);
    else if (this.tr > 0) {
      // без тягача: проушина на походной опоре, орудие стоит на колёсах
      const G = this._travelGeom(), T = this.m.terrain;
      const s = Math.sin(this.rootYaw), c = Math.cos(this.rootYaw);
      const ax = this.pos.x + s * AXLE, az = this.pos.z + c * AXLE;
      const hL = T.heightAt(ax - 0.95 * c, az + 0.95 * s), hR = T.heightAt(ax + 0.95 * c, az - 0.95 * s);
      const ga = (hL + hR) / 2, gl = T.heightAt(this.pos.x + s * G.z, this.pos.z + c * G.z) + 0.55;
      const k = ease(this.tr);
      this.pos.y = this.pos.y + ((ga * k + T.heightAt(this.pos.x, this.pos.z) * (1 - k)) - this.pos.y) * Math.min(1, dt * 6);
      this.rootPitch = -Math.atan2(gl - (ga + G.y), G.z) * k;
      this.rootRoll = Math.atan2(hR - hL, 1.9) * k;
    }
    // после наката клин открывается и выбрасывает гильзу
    if (this.recoilT > 1.2 && this.recoilT - dt <= 1.2 && this.shots > 0) {
      this.breech = 1;
      this.m.audio.mech('reload');
      const br = new THREE.Vector3(0, 0, D30.breech + 0.1).applyMatrix4(this.model.recoil.matrixWorld);
      this.casing = { t: 0, p: br, v: this.boreDir().multiplyScalar(-2.2).add(new THREE.Vector3(0, 1.2, 0)) };
    }
    // заряжание: номера расчёта носят снаряд и заряд из ящика, замковый закрывает клин
    this._loadStep(dt);
    // гильза
    const c = this.casing;
    const cm = this.model.casing;
    if (c.t < 2.5) {
      c.t += dt;
      c.v.y -= 9.8 * dt;
      c.p.addScaledVector(c.v, dt);
      const gy = this.m.terrain.heightAt(c.p.x, c.p.z) + 0.07;
      if (c.p.y < gy) { c.p.y = gy; c.v.multiplyScalar(0.3); c.v.y = Math.abs(c.v.y) * 0.3; }
      cm.visible = true;
      const inv = new THREE.Matrix4().copy(this.model.root.matrixWorld).invert();
      cm.position.copy(c.p).applyMatrix4(inv);
      cm.rotation.set(c.t * 4, 0, c.t * 2);
    } else cm.visible = false;
    this._place();
    this._crew(dt);
    if (this.ui && this.m.player.gun === this) this.ui.update(dt);
  }

  // Камера для текущего вида; возвращает поле зрения
  camera(cam) {
    const g = this.model;
    // в оптике орудие не рисуем: головка панорамы и объектив ОП4М выше и впереди щита
    g.root.visible = this.view !== 'pano' && this.view !== 'op4m';
    g.root.updateMatrixWorld(true);
    const azR = -this.az * MIL;
    if (this.view === 'side') {
      const o = this.orbit;
      const c = this.pos.clone().add(new THREE.Vector3(0, 1.1, 0));
      const yaw = azR + o.yaw;
      cam.position.set(c.x + Math.sin(yaw) * Math.cos(o.pitch) * o.dist, c.y + Math.sin(o.pitch) * o.dist, c.z + Math.cos(yaw) * Math.cos(o.pitch) * o.dist);
      const gy = this.m.terrain.heightAt(cam.position.x, cam.position.z) + 0.5;
      if (cam.position.y < gy) cam.position.y = gy;
      cam.lookAt(c.x - Math.sin(azR) * 1.5, c.y, c.z - Math.cos(azR) * 1.5);
      return 55;
    }
    if (this.view === 'op4m') {
      const e = D30.op4m.clone().sub(D30.trunnion);
      cam.position.copy(e).applyMatrix4(g.pitch.matrixWorld);
      const q = new THREE.Quaternion(); g.pitch.getWorldQuaternion(q);
      cam.quaternion.copy(q);
      return 9;
    }
    const eye = this.view === 'pano' ? D30.pano : new THREE.Vector3(-0.62, 1.45, 0.75);
    cam.position.copy(eye).applyMatrix4(g.yaw.matrixWorld);
    cam.quaternion.setFromEuler(new THREE.Euler(this.view === 'eye' ? this.elM * MIL * 0.3 : 0, azR, 0, 'YXZ'));
    return this.view === 'pano' ? 10.7 : 65;
  }
}
