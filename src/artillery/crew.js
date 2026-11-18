// Расчёт Д-30: номера расчёта со скелетной анимацией. Каждый кадр орудие выдаёт каждому номеру
// «задачу» — точку, куда встать, позу и (если нужно) точки для рук. Номер подходит шагом,
// переключает клипы motion capture с плавным переходом, а руки двухзвенной IK кладёт
// на сошник станины, походное крепление ствола или колесо — так видно, как расчёт
// разводит и сводит станины, снимает ствол с крепления и вывешивает колёса.
import * as THREE from 'three';
import { CharRig } from '../entities/charRig.js';

const _a = new THREE.Vector3(), _c = new THREE.Vector3(), _pole = new THREE.Vector3();
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const smooth = (cur, tgt, rate, dt) => cur + (tgt - cur) * (1 - Math.exp(-rate * dt));

// поза → клип на месте
const STILL = { stand: 'Standing_Idle', look: 'Looking_Around', crouch: 'Idle_Crouching', kneel: 'Male_Crouch_Pose', work: 'Crouch_Idle' };

export class CrewMan {
  constructor(m) {
    this.m = m;
    this.rig = new CharRig('negs');
    this.root = new THREE.Group();
    this.root.add(this.rig.holder);
    this.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    m.scene.add(this.root);
    this.pos = new THREE.Vector3(); this.yaw = 0; this.speed = 0;
    this.placed = false;
    this.cur = null; this.curName = ''; this.tc = Math.random() * 10;
    this.prev = null; this.prevT = 0; this.fade = 1;
    this.ikW = 0; this.tick = 0;
  }

  get visible() { return this.root.visible; }
  set visible(v) { this.root.visible = v; if (!v) this.placed = false; }

  _clip(name) { const L = this.rig.lib.clips; return L.get(name) || L.get('Standing_Idle'); }

  // tg: { p (Vector3, на грунте), yaw, pose, still?, hands?: [левая, правая] (мир), carry? }
  update(dt, tg) {
    const T = this.m.terrain, rig = this.rig, lib = rig.lib;
    if (!this.placed) { this.pos.copy(tg.from || tg.p); this.yaw = tg.yaw; this.placed = true; }
    // шаг к цели
    const dx = tg.p.x - this.pos.x, dz = tg.p.z - this.pos.z, d = Math.hypot(dx, dz);
    const vmax = tg.carry ? 1.7 : 2.1;
    let v = 0;
    if (d > 0.02) { const st = Math.min(d, vmax * dt); this.pos.x += (dx / d) * st; this.pos.z += (dz / d) * st; v = st / Math.max(dt, 1e-4); }
    this.pos.y = T.heightAt(this.pos.x, this.pos.z);
    this.speed = smooth(this.speed, v, 10, dt);
    // разворот: издалека — по ходу, вблизи и с грузом — как требует задача
    const yawWant = d > 0.6 && !tg.carry ? Math.atan2(-dx, -dz) : tg.yaw;
    this.yaw += wrap(yawWant - this.yaw) * (1 - Math.exp(-7 * dt));
    // дальних не анимируем каждый кадр
    const cam = this.m.camPos, far = cam ? this.pos.distanceToSquared(cam) > 150 * 150 : false;
    this.root.position.copy(this.pos); this.root.rotation.y = this.yaw;
    if (far && (this.tick++ % 4)) { this.root.updateMatrixWorld(true); return; }
    // клип
    const low = tg.pose !== 'stand' && tg.pose !== 'look';
    const walking = this.speed > 0.3;
    const name = walking ? (low ? 'Crouched_Walking' : 'Walking') : (tg.still || STILL[tg.pose] || 'Standing_Idle');
    if (name !== this.curName) {
      if (this.cur) { this.prev = this.cur; this.prevT = this.tc; this.fade = 0; }
      this.cur = this._clip(name); this.curName = name; this.tc = walking ? 0 : Math.random() * 3;
    }
    const c = this.cur;
    const rate = walking && c.speed > 0 ? this.speed / c.speed : 1;
    this.tc += dt * rate;
    this.fade = Math.min(1, this.fade + dt / 0.35);
    rig.resetAcc();
    const at = (cl, t) => (cl.loop ? t : t % cl.dur);
    if (this.prev && this.fade < 1) { this.prevT += dt; lib.sample(this.prev, at(this.prev, this.prevT), 1 - this.fade, rig.accQ, rig.accP, null); }
    lib.sample(c, at(c, this.tc), this.prev && this.fade < 1 ? this.fade : 1, rig.accQ, rig.accP, null);
    rig.applyPose();
    this.root.updateMatrixWorld(true);
    // руки
    this.ikW = smooth(this.ikW, tg.hands && d < 0.45 ? 1 : 0, 6, dt);
    if (this.ikW > 0.02 && tg.hands) {
      const b = rig.b, k = rig.heightK * this.root.scale.x;
      const right = _c.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); // вправо от бойца
      ['Left', 'Right'].forEach((side, i) => {
        const arm = b[side + 'Arm'], fore = b[side + 'ForeArm'], hand = b[side + 'Hand'];
        const target = hand.getWorldPosition(_a).lerp(tg.hands[i], this.ikW);
        const s = i === 0 ? -1 : 1;
        _pole.set(right.x * s * 0.8, -0.8, right.z * s * 0.8).normalize();
        rig.ik(arm, fore, hand, target.clone(), _pole.clone(), rig.len.upper * k, rig.len.fore * k);
      });
    }
  }
}
