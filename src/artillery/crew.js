// Расчёт Д-30: номера расчёта — настоящие бойцы (здоровье, хитбоксы по костям, их можно ранить
// и убить), со скелетной анимацией. Каждый кадр орудие выдаёт номеру «задачу»: точку, позу,
// скорость, что держать в руках (снаряд, гильзу с зарядом) и куда положить руки. Номер идёт,
// бежит или несёт груз, переключает клипы motion capture с плавным переходом, а руки двухзвенной
// IK кладёт на сошник, крепление ствола, колесо, снаряд или казённик.
import * as THREE from 'three';
import { CharRig } from '../entities/charRig.js';
import { Soldier } from '../entities/soldier.js';
import { shellGeometry } from './d30model.js';
import { Parts } from '../weapons/gunkit.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _pole = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const smooth = (cur, tgt, rate, dt) => cur + (tgt - cur) * (1 - Math.exp(-rate * dt));
const Z = new THREE.Vector3(0, 0, 1);

// поза → клип на месте
const STILL = { stand: 'Standing_Idle', look: 'Looking_Around', crouch: 'Idle_Crouching', kneel: 'Male_Crouch_Pose', work: 'Crouch_Idle' };

// Снаряд ОФ-462 и гильза с зарядом — то, что носит расчёт (ось предмета — Z)
let ITEMS = null;
export function crewItems() {
  if (ITEMS) return ITEMS;
  const P = new Parts(); shellGeometry(P);
  const shell = P.build({
    shell: new THREE.MeshStandardMaterial({ color: 0x4e5a38, roughness: 0.55, metalness: 0.3 }), copper: new THREE.MeshStandardMaterial({ color: 0x9a6a3a, metalness: 1, roughness: 0.35 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x5a5d61, metalness: 0.9, roughness: 0.35 }), red: new THREE.MeshStandardMaterial({ color: 0x8a1a12, roughness: 0.6 }),
  });
  shell.children.forEach((o) => o.geometry.translate(0, 0, 0.27)); // центр масс — посередине
  const brass = new THREE.MeshStandardMaterial({ color: 0xb08a3e, metalness: 0.95, roughness: 0.3 });
  const charge = new THREE.Group();
  const cg = new THREE.CylinderGeometry(0.064, 0.066, 0.44, 18); cg.rotateX(Math.PI / 2);
  charge.add(new THREE.Mesh(cg, brass));
  const lid = new THREE.CylinderGeometry(0.06, 0.06, 0.02, 18); lid.rotateX(Math.PI / 2); lid.translate(0, 0, -0.22);
  charge.add(new THREE.Mesh(lid, new THREE.MeshStandardMaterial({ color: 0x3a3a30, roughness: 0.8 })));
  // 82-мм мина О-832ДУ: корпус каплевидный, взрыватель М-12, хвостовик с перьями (ось — Z, нос к −Z)
  const mine = new THREE.Group();
  const olive = new THREE.MeshStandardMaterial({ color: 0x4a5636, roughness: 0.55, metalness: 0.3 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x5a5d61, metalness: 0.85, roughness: 0.4 });
  const bodyP = [[0.0, -0.17], [0.008, -0.168], [0.016, -0.155], [0.03, -0.12], [0.039, -0.07], [0.041, -0.03], [0.04, 0.0], [0.034, 0.04], [0.02, 0.07], [0.012, 0.08], [0.0, 0.08]];
  const bg = new THREE.LatheGeometry(bodyP.map(([r, z]) => new THREE.Vector2(Math.max(r, 1e-4), z)), 18); bg.rotateX(Math.PI / 2);
  mine.add(new THREE.Mesh(bg, olive));
  const fz = new THREE.CylinderGeometry(0.004, 0.014, 0.035, 12); fz.rotateX(-Math.PI / 2); fz.translate(0, 0, -0.185);
  mine.add(new THREE.Mesh(fz, steel));
  const tail = new THREE.CylinderGeometry(0.011, 0.011, 0.1, 10); tail.rotateX(Math.PI / 2); tail.translate(0, 0, 0.12);
  mine.add(new THREE.Mesh(tail, steel));
  for (let i = 0; i < 6; i++) { const f = new THREE.BoxGeometry(0.002, 0.04, 0.06); f.translate(0, 0.028, 0.14); f.rotateZ((i / 6) * Math.PI * 2); mine.add(new THREE.Mesh(f, steel)); }
  // дополнительные заряды — пучки между перьями
  const ring = new THREE.TorusGeometry(0.016, 0.006, 6, 14); ring.translate(0, 0, 0.1);
  mine.add(new THREE.Mesh(ring, new THREE.MeshStandardMaterial({ color: 0xc8b88a, roughness: 0.8 })));
  ITEMS = { shell, charge, mine };
  return ITEMS;
}

export class CrewMan {
  constructor(m) {
    this.m = m;
    this.rig = new CharRig('negs');
    this.root = new THREE.Group();
    this.root.add(this.rig.holder);
    this.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    m.scene.add(this.root);
    this.pos = new THREE.Vector3(); this.yaw = 0; this.speed = 0; this.vel = new THREE.Vector3();
    this.placed = false;
    this.cur = null; this.curName = ''; this.tc = Math.random() * 10;
    this.prev = null; this.prevT = 0; this.fade = 1;
    this.ikW = 0; this.tick = 0; this.dying = false;
    // предметы в руках
    const I = crewItems();
    this.items = { shell: I.shell.clone(), charge: I.charge.clone(), mine: I.mine.clone() };
    for (const o of Object.values(this.items)) { o.visible = false; o.traverse((q) => { if (q.isMesh) q.castShadow = true; }); m.scene.add(o); }
  }

  get visible() { return this.root.visible; }
  set visible(v) { this.root.visible = v; if (!v) { this.placed = false; for (const o of Object.values(this.items)) o.visible = false; } }

  _clip(name) { const L = this.rig.lib.clips; return L.get(name) || L.get('Standing_Idle'); }

  // tg: { p (на грунте), yaw, pose, still?, hands?: [левая, правая], speed?, carry?, item?: 'shell'|'charge',
  //       itemPos?, itemQuat?, dead? }
  update(dt, tg) {
    const T = this.m.terrain, rig = this.rig, lib = rig.lib;
    if (!this.placed) { this.pos.copy(tg.from || tg.p); this.yaw = tg.yaw; this.placed = true; }
    if (tg.dead) { this._dead(dt); return; }
    if (this.dying) { this.dying = false; this.curName = ''; }
    // шаг к цели
    const dx = tg.p.x - this.pos.x, dz = tg.p.z - this.pos.z, d = Math.hypot(dx, dz);
    const vmax = tg.speed || (tg.carry ? 1.7 : 2.1);
    let v = 0;
    const ox = this.pos.x, oz = this.pos.z;
    if (d > 0.02) { const st = Math.min(d, vmax * dt); this.pos.x += (dx / d) * st; this.pos.z += (dz / d) * st; v = st / Math.max(dt, 1e-4); }
    this.vel.set((this.pos.x - ox) / Math.max(dt, 1e-4), 0, (this.pos.z - oz) / Math.max(dt, 1e-4));
    this.pos.y = T.heightAt(this.pos.x, this.pos.z);
    this.speed = smooth(this.speed, v, 10, dt);
    // разворот: издалека — по ходу, вблизи и с грузом — как требует задача
    const yawWant = d > 0.6 && !tg.carry ? Math.atan2(-dx, -dz) : d > 0.6 && tg.item ? Math.atan2(-dx, -dz) : tg.yaw;
    this.yaw += wrap(yawWant - this.yaw) * (1 - Math.exp(-7 * dt));
    const cam = this.m.camPos, far = cam ? this.pos.distanceToSquared(cam) > 150 * 150 : false;
    this.root.position.copy(this.pos); this.root.rotation.y = this.yaw;
    // предмет в руках: перед грудью поперёк корпуса, либо там, где требует задача (у казённика)
    const it = tg.item ? this.items[tg.item] : null;
    for (const [k, o] of Object.entries(this.items)) if (o !== it) o.visible = false;
    if (far && (this.tick++ % 4)) { this.root.updateMatrixWorld(true); if (it) this._placeItem(it, tg); return; }
    // клип
    const low = tg.pose !== 'stand' && tg.pose !== 'look';
    const walking = this.speed > 0.3, running = this.speed > 2.5 && !it;
    const name = running ? 'Running' : walking ? (low ? 'Crouched_Walking' : 'Walking') : (tg.still || STILL[tg.pose] || 'Standing_Idle');
    if (name !== this.curName) {
      if (this.cur) { this.prev = this.cur; this.prevT = this.tc; this.fade = 0; }
      this.cur = this._clip(name); this.curName = name; this.tc = walking ? 0 : Math.random() * 3;
    }
    const c = this.cur;
    const rate = walking && c.speed > 0 ? this.speed / c.speed : 1;
    this.tc += dt * rate;
    this.fade = Math.min(1, this.fade + dt / 0.3);
    rig.resetAcc();
    const at = (cl, t) => (cl.loop ? t : t % cl.dur);
    if (this.prev && this.fade < 1) { this.prevT += dt; lib.sample(this.prev, at(this.prev, this.prevT), 1 - this.fade, rig.accQ, rig.accP, null); }
    lib.sample(c, at(c, this.tc), this.prev && this.fade < 1 ? this.fade : 1, rig.accQ, rig.accP, null);
    rig.applyPose();
    this.root.updateMatrixWorld(true);
    // руки: на предмет (по его концам) или в точки задачи
    let hands = tg.hands;
    if (it) {
      this._placeItem(it, tg);
      const ax = _b.copy(Z).applyQuaternion(it.quaternion);
      const len = tg.item === 'shell' ? 0.2 : tg.item === 'mine' ? 0.09 : 0.17;
      hands = [it.position.clone().addScaledVector(ax, len).add(_a.set(0, -0.05, 0)), it.position.clone().addScaledVector(ax, -len).add(_a.set(0, -0.05, 0))];
      // левая рука — ближе к левому боку
      const right = _c.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      if (hands[0].clone().sub(this.pos).dot(right) > hands[1].clone().sub(this.pos).dot(right)) hands.reverse();
    }
    this.ikW = smooth(this.ikW, hands && (d < 0.45 || it) ? 1 : 0, it ? 12 : 6, dt);
    if (this.ikW > 0.02 && hands) {
      const b = rig.b, k = rig.heightK * this.root.scale.x;
      const right = _c.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      ['Left', 'Right'].forEach((side, i) => {
        const arm = b[side + 'Arm'], fore = b[side + 'ForeArm'], hand = b[side + 'Hand'];
        const target = hand.getWorldPosition(_a).lerp(hands[i], this.ikW);
        const s = i === 0 ? -1 : 1;
        _pole.set(right.x * s * 0.8, -0.8, right.z * s * 0.8).normalize();
        rig.ik(arm, fore, hand, target.clone(), _pole.clone(), rig.len.upper * k, rig.len.fore * k);
      });
    }
  }

  _placeItem(it, tg) {
    it.visible = this.root.visible;
    if (tg.itemPos) { it.position.copy(tg.itemPos); if (tg.itemQuat) it.quaternion.copy(tg.itemQuat); return; }
    // несёт перед собой поперёк корпуса, на уровне пояса-груди
    const f = _a.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    it.position.copy(this.pos).addScaledVector(f, 0.36); it.position.y += tg.pose === 'stand' ? 1.08 : 0.72;
    _q.setFromAxisAngle(_s.set(0, 1, 0), this.yaw + Math.PI / 2);
    it.quaternion.copy(_q);
  }

  // гибель: клип падения один раз, затем лежит
  _dead(dt) {
    const rig = this.rig, lib = rig.lib;
    for (const o of Object.values(this.items)) o.visible = false;
    if (!this.dying) { this.dying = true; this.cur = this._clip(Math.random() < 0.5 ? 'Falling_Back_Death' : 'Death'); this.tc = 0; this.prev = null; }
    this.tc = Math.min(this.tc + dt, this.cur.dur - 0.01);
    this.root.position.copy(this.pos); this.root.rotation.y = this.yaw;
    rig.resetAcc();
    lib.sample(this.cur, this.tc, 1, rig.accQ, rig.accP, null);
    rig.applyPose();
    this.root.updateMatrixWorld(true);
  }
}

// Модель для Soldier: скелет ведёт CrewMan, отсюда только хитбоксы по костям
class CrewModel {
  constructor(man) { this.man = man; this.root = man.root; this.skinUpdate = true; }
  get deadT() { return this.man.dying ? 9 : -1; }
  set kick(v) { /* отдача — нет оружия */ }
  get kick() { return 0; }
  update() { /* анимацию ведёт орудие через CrewMan */ }
  setDetail() {}
  hit() {}
  shot() {}
  muzzleWorld(out) { return out.copy(this.man.pos).setY(this.man.pos.y + 1.4); }
  hitboxes(out) {
    const b = this.man.rig.b, k = this.man.rig.heightK * this.root.scale.x;
    if (out.length < 9) for (let i = out.length; i < 9; i++) out.push({ a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0, zone: '' });
    const W = (n, o) => b[n].getWorldPosition(o);
    W('Head', out[0].a); out[0].a.add(_a.set(0, 0.085 * k, 0.02 * k).applyQuaternion(b.Head.getWorldQuaternion(_q))); out[0].b.copy(out[0].a); out[0].r = 0.115 * k; out[0].zone = 'head';
    W('Spine', out[1].a); W('Neck', out[1].b); out[1].b.lerp(out[1].a, 0.12); out[1].r = 0.165 * k; out[1].zone = 'torso';
    W('LeftUpLeg', out[2].a); W('LeftLeg', out[2].b); out[2].r = 0.085 * k; out[2].zone = 'leg';
    W('RightUpLeg', out[3].a); W('RightLeg', out[3].b); out[3].r = 0.085 * k; out[3].zone = 'leg';
    W('LeftLeg', out[4].a); W('LeftFoot', out[4].b); out[4].r = 0.065 * k; out[4].zone = 'leg';
    W('RightLeg', out[5].a); W('RightFoot', out[5].b); out[5].r = 0.065 * k; out[5].zone = 'leg';
    W('LeftArm', out[6].a); W('LeftHand', out[6].b); out[6].r = 0.055 * k; out[6].zone = 'arm';
    W('RightArm', out[7].a); W('RightHand', out[7].b); out[7].r = 0.055 * k; out[7].zone = 'arm';
    W('Hips', out[8].a); out[8].b.copy(out[8].a); out[8].r = 0.155 * k; out[8].zone = 'pelvis';
    return out;
  }
}

// Номер расчёта как боец: урон, гибель, цель для противника. Движется по задачам орудия.
export class CrewSoldier extends Soldier {
  constructor(m, { team, name, callsign, x, z }) {
    super(m, { team, faction: team, name, callsign, role: 'crew', weapon: 'ak74m', x, z, noModel: true, grenades: 0, armor: 0.5, helmet: 0.6, medkits: 0 });
    this.isCrew = true;
    this.man = new CrewMan(m);
    this.model = new CrewModel(this.man);
    this.hidden = true;
  }
  revive(x, y, z, yaw) {
    const md = this.model; this.model = null;
    super.revive(x, y, z, yaw);
    this.model = md; this.man.dying = false;
  }
  // орудие двигает CrewMan; положение и стойку бойца берём оттуда
  sync() {
    const M = this.man;
    this.pos.copy(M.pos); this.yaw = this.aimYaw = M.yaw; this.vel.copy(M.vel);
    this.hidden = !M.visible;
    if (this.alive) this.stance = M.curName === 'Idle_Crouching' || M.curName === 'Male_Crouch_Pose' || M.curName === 'Crouch_Idle' || M.curName === 'Crouched_Walking' ? 'crouch' : 'stand';
    this.updateEye();
  }
}
