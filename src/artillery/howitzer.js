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
import { ClipActor, charAvailable } from '../entities/charRig.js';
import { Parts } from '../weapons/gunkit.js';
import { GunUI } from './gunUI.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const EL_MIN = -117, EL_MAX = 1167; // −7° … +70°
const LOAD_TIME = 5.5;
const TRANS_TIME = 16;   // перевод из боевого в походное и обратно силами расчёта, с
const AXLE = 0.15;       // ось колёс от оси вращения лафета (к проушине — +Z)
const TRAVEL_EL = -0.045; // ствол в походном положении, рад
const wrapA = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const ease = (t) => t * t * (3 - 2 * t);
const VIEWS = ['eye', 'pano', 'op4m', 'side'];
export const VIEW_NAMES = { eye: 'Обзор', pano: 'Панорама ПГ-1М', op4m: 'Прицел прямой наводки ОП4М-45', side: 'Вид со стороны' };

export class Howitzer {
  constructor(m, { x, z, dir = 0, name = 'Д-30 № 1', mode = 'combat', heading = null, towBy = null }) {
    this.m = m; this.name = name;
    this.model = buildD30();
    const y0 = m.terrain.heightAt(x, z);
    this.pos = new THREE.Vector3(x, y0, z);
    this.model.root.position.copy(this.pos);
    m.scene.add(this.model.root);
    // положение: tr = 0 — боевое, 1 — походное; лафет: курс и наклоны (при буксировке)
    this.tr = mode === 'travel' ? 1 : 0; this.trTarget = this.tr;
    this.rootYaw = heading ?? 0; this.rootPitch = 0; this.rootRoll = 0;
    this.towBy = null; this.snapT = 0;
    this.az = dir;          // угломер (тыс.)
    this.elM = 0;           // возвышение ствола (тыс.)
    this.drum = 0;          // прицел на барабане (тыс.)
    this.level = 3000;      // уровень (тыс.)
    this.ci = 5;            // заряд (индекс в CHARGES), по умолчанию — четвёртый
    this.fuze = 'О';        // взрыватель РГМ-2: «О» — осколочное, «Ф» — фугасное
    this.loaded = null; this.loadT = 0; this.recoilT = 9; this.breech = 1; this.shots = 0;
    this.view = 'pano';
    this.orbit = { yaw: 0.6, pitch: 0.25, dist: 7.5 };
    this.reports = [];
    this.collider = null;
    if (this.tr === 0) this._makeCollider();
    // расчёт
    this.crew = [];
    if (charAvailable('negs')) {
      for (const [clip, lx, lz, ry] of [['Standing_Idle', 0.9, 1.9, 0.4], ['Idle_Crouching', -1.3, 2.2, -0.3], ['Looking_Around', 1.8, 0.9, 1.2]]) {
        const a = new ClipActor('negs', clip);
        a.local = new THREE.Vector3(lx, 0, lz); a.ry = ry;
        a.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        m.scene.add(a.root);
        this.crew.push(a);
      }
    }
    // снаряд для заряжания
    const SP = new Parts(); shellGeometry(SP);
    this.loadShell = SP.build({ shell: new THREE.MeshStandardMaterial({ color: 0x4e5a38, roughness: 0.55, metalness: 0.3 }), copper: new THREE.MeshStandardMaterial({ color: 0x9a6a3a, metalness: 1, roughness: 0.35 }), metal: new THREE.MeshStandardMaterial({ color: 0x5a5d61, metalness: 0.9, roughness: 0.35 }), red: new THREE.MeshStandardMaterial({ color: 0x8a1a12, roughness: 0.6 }) });
    this.loadShell.visible = false;
    this.model.root.add(this.loadShell);
    this.casing = { t: 9, p: new THREE.Vector3(), v: new THREE.Vector3() };
    // взаимодействие
    // место наводчика (слева у маховиков) и работа с орудием (справа у колеса / у проушины)
    this.gunIt = {
      pos: new THREE.Vector3(x, y0 + 1.0, z), r: 1.7, label: `Занять место наводчика: ${name}`, hold: 0.25,
      enabled: () => !m.player.gun && !this.netUser && m.player.body.alive && this.ready, action: () => this.mount(m.player),
    };
    const self = this;
    this.towIt = {
      pos: new THREE.Vector3(x, y0 + 1.0, z), r: 1.6, hold: 1.0,
      get label() { return self.towLabel(); },
      enabled: () => m.player.body.alive && !m.player.gun && !m.player.vehicle && !this.netUser && this.tr === this.trTarget && !!this.towLabel(),
      action: () => this.towAction(),
    };
    m.interactables.push(this.gunIt, this.towIt);
    this.ui = null;
    if (towBy) this.hitch(towBy, true);
    this._place();
  }

  get ready() { return this.tr === 0 && this.trTarget === 0 && !this.towBy; }

  _makeCollider() {
    if (this.collider) { this.collider.blocksMove = this.collider.blocksBullet = this.collider.blocksSight = false; this.collider.coverOk = false; }
    this.collider = this.m.world.addCylCollider({ x: this.pos.x, z: this.pos.z, y0: this.pos.y, r: 1.0, h: 1.7, mat: 'metal', pen: 15, cover: true });
  }
  _dropCollider() {
    const c = this.collider;
    if (c) { c.blocksMove = c.blocksBullet = c.blocksSight = false; c.coverOk = false; }
    this.collider = null;
  }

  // ---------- походное положение, прицеп ----------
  towLabel() {
    if (this.tr !== this.trTarget) return null;
    if (this.towBy) return Math.abs(this.towBy.speed) < 1.5 ? `Отцепить ${this.name} от «${this.towBy.type.name.replace(/^.*«|».*$/g, '')}»` : null;
    if (this.tr === 0) return `Привести ${this.name} в походное положение (≈${TRANS_TIME} с)`;
    const v = this.nearHitchVehicle();
    return v ? `Прицепить ${this.name} к ${v.type.name}` : `Привести ${this.name} в боевое положение (≈${TRANS_TIME} с)`;
  }

  // фаркоп машины (сзади по оси, на высоте проушины)
  hitchPoint(v, out = new THREE.Vector3()) { return v.toWorld(0, 0.62, v.type.hitch, out); }
  lunetteWorld(out = new THREE.Vector3()) {
    this.model.recoil.updateWorldMatrix(true, false);
    return out.copy(D30.lunette).applyMatrix4(this.model.recoil.matrixWorld);
  }
  nearHitchVehicle() {
    const L = this.lunetteWorld();
    let best = null, bd = 2.8;
    // только что отцепленную машину снова не предлагаем, пока она не отъедет
    if (this._noHitch && this.hitchPoint(this._noHitch).distanceTo(L) > 4.5) this._noHitch = null;
    for (const v of this.m.vehicles) {
      if (!v.alive || v.towing || Math.abs(v.speed) > 1.5 || !v.type.hitch || v === this._noHitch) continue;
      const d = this.hitchPoint(v).distanceTo(L);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  towAction(fromNet = false) {
    const m = this.m;
    if (this.towBy) { this.unhitch(); return; }
    if (this.tr === 0) { this.startTravel(); return; }
    const v = this.nearHitchVehicle();
    if (v) this.hitch(v); else this.startDeploy();
    void fromNet; void m;
  }

  _net(e) { const n = this.m.net; if (n) n.ev(['gm', this.m.guns.indexOf(this), ...e]); }

  startTravel(fromNet = false) {
    if (this.tr !== 0 || this.trTarget !== 0) return;
    if (this.m.player.gun === this) this.dismount(this.m.player);
    this.trTarget = 1; this.loaded = null; this.loadT = 0;
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
    v.towing = null; this.towBy = null; this._noHitch = v;
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
    // расчёт у орудия только в боевом положении
    const show = this.tr === 0 && !this.towBy;
    const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -this.az * MIL);
    for (const a of this.crew) {
      a.root.visible = show;
      if (!show) continue;
      const p = a.local.clone().applyQuaternion(yawQ).add(this.pos);
      p.y = this.m.terrain.heightAt(p.x, p.z);
      a.root.position.copy(p);
      a.root.rotation.y = -this.az * MIL + a.ry;
    }
    // точки взаимодействия: наводчик — слева у маховиков, расчёт — справа у колеса или у проушины
    if (this.gunIt) {
      this.gunIt.pos.copy(this.seatWorld()); this.gunIt.pos.y += 1.0;
      if (this.tr === 0 && !this.towBy) {
        this.towIt.pos.set(0.95, 0.7, 0.15).applyMatrix4(g.body.matrixWorld);
        this.towIt.r = 1.6;
      } else {
        this.lunetteWorld(this.towIt.pos);
        this.towIt.pos.y = Math.max(this.towIt.pos.y, this.m.terrain.heightAt(this.towIt.pos.x, this.towIt.pos.z) + 0.9);
        this.towIt.r = 2.0;
      }
    }
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
      if (this.loaded || this.loadT > 0) m.hud.message('Орудие уже заряжено — заряд сменить нельзя', 2);
      else { this.ci = i; m.hud.message(`Заряд ${CHARGES[i].name}`, 1.5); m.audio.click(); }
    }
    if (inp.hit('KeyX')) {
      if (this.loaded || this.loadT > 0) m.hud.message('Взрыватель устанавливается до заряжания', 2);
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
    if (inp.bh('reload') || inp.hit('KeyR')) {
      if (this.loaded) m.hud.message('Орудие заряжено', 1.5);
      else if (this.loadT > 0) {}
      else if (this.recoilT < 1.4) m.hud.message('Ствол накатывается…', 1.2);
      else { this.loadT = LOAD_TIME; this.loadInfo = { ci: this.ci, fuze: this.fuze }; m.hud.radio('Заряжающий', `Снаряд ОФ-462, заряд ${this.charge.name}, взрыватель ${this.fuze === 'О' ? 'осколочный' : 'фугасный'} — заряжаю!`); m.audio.mech('reload'); }
    }
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
    if (!this.loaded) { if (this.loadT > 0) m.hud.message('Ещё не заряжено', 1); else m.hud.message('Орудие не заряжено (R — заряжать)', 1.5); m.audio.click(); return; }
    if (this.breech > 0.05) return;
    const L = this.loaded;
    this.loaded = null;
    const pos = this.muzzleWorld(), dir = this.boreDir();
    const p = m.projectiles.spawn({ weapon: WEAPONS.d30, pos, dir, owner: m.player.body, team: 'negs', ammoId: 'of462_' + CHARGES[L.ci].id });
    p.fuze = L.fuze; p.gun = this; p.shotNo = ++this.shots; p.charge = L.ci;
    // фугасное действие (замедление): снаряд углубляется — меньше осколков, сильнее по укрытиям
    if (L.fuze === 'Ф') p.ammo = { ...p.ammo, explosive: { ...p.ammo.explosive, pen: 140, radius: 9, frag: 20, dmg: 520 } };
    p.onLand = (pp) => this.report(pp);
    if (m.net) m.net.onLocalShot({ weapon: WEAPONS.d30, owner: m.player.body, ammoId: 'of462_' + CHARGES[L.ci].id, gun: this }, p);
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
    this.recoilT = 0; this.shots++; this.loaded = null; this.breech = 0;
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
      const d = dt / TRANS_TIME;
      if (this.trTarget > this.tr) this.tr = Math.min(1, this.tr + d); else this.tr = Math.max(0, this.tr - d);
      if (this.tr === 0 && this.trTarget === 0) { this.rootPitch = 0; this.rootRoll = 0; this.pos.y = this.m.terrain.heightAt(this.pos.x, this.pos.z); this._makeCollider(); this.m.hud.message(`${this.name} в боевом положении. Наводчик — слева у маховиков (E)`, 3); this.m.audio.mech('switch'); }
      if (this.tr === 1 && this.trTarget === 1) { this._dropCollider(); this.m.hud.message(`${this.name} в походном положении. Подгоните тягач задом к буксирной проушине (E — прицепить)`, 4); this.m.audio.mech('switch'); }
      if (this.tr > 0 && this.collider && this.trTarget === 1) this._dropCollider();
    }
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
    // заряжание: снаряд досылается в камору, клин закрывается
    if (this.loadT > 0) {
      this.loadT -= dt;
      const k = 1 - this.loadT / LOAD_TIME;
      const s = this.loadShell;
      if (k > 0.35 && k < 0.85) {
        s.visible = true;
        const u = (k - 0.35) / 0.5;
        const inv = new THREE.Matrix4().copy(this.model.root.matrixWorld).invert();
        const br = new THREE.Vector3(0, 0, D30.breech + 0.9 - u * 1.4).applyMatrix4(this.model.recoil.matrixWorld).applyMatrix4(inv);
        s.position.copy(br);
        const q = new THREE.Quaternion(); this.model.pitch.getWorldQuaternion(q);
        const rq = new THREE.Quaternion(); this.model.root.getWorldQuaternion(rq);
        s.quaternion.copy(rq.invert().multiply(q));
      } else s.visible = false;
      if (k > 0.88) this.breech = Math.max(0, 1 - (k - 0.88) / 0.1);
      if (this.loadT <= 0) {
        this.loadT = 0; this.breech = 0; this.loaded = this.loadInfo;
        s.visible = false;
        this.m.hud.radio('Заряжающий', 'Готово!');
        this.m.audio.mech('switch');
      }
    }
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
    for (const a of this.crew) a.update(dt);
    this._place();
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
