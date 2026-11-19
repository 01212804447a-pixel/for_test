// Руки от первого лица: те же руки, что у модели бойца N.E.G.S (перчатки, рукава),
// поза корпуса и пальцев — из клипа прицеливания, кисти ставятся на оружие двухзвенной IK.
// Перезарядка — по ключевым точкам: левая рука выдёргивает магазин, приносит новый,
// при пустом магазине передёргивает затворную раму.
import * as THREE from 'three';
import { CharRig, gripOffset, charAvailable } from '../entities/charRig.js';
import { GUN_INFO } from './guns.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const V = (a) => new THREE.Vector3(...a);

export function fpArmsAvailable() { return charAvailable('negs'); }

// Особые хваты (не из калибровки по клипу): бинокль, граната
const SPECIAL = {
  b8: { R: [0.07, -0.03, -0.06], L: [-0.07, -0.03, -0.06], qR: [0.3, -0.2, -1.35], qL: [0.3, 0.2, 1.35] },
  grenade: { R: [0, -0.005, 0.02], L: [-0.25, -0.45, 0.2], qR: [-0.3, 0.2, 0.0], qL: [0, 0, 0] },
  rdg2: { R: [0, -0.01, 0.0], L: [-0.25, -0.45, 0.2], qR: [-0.3, 0.2, 0.0], qL: [0, 0, 0] },
};

export class FPArms {
  constructor() {
    this.rig = new CharRig('negs', { fpArms: true });
    this.root = new THREE.Group();
    this.root.add(this.rig.holder);
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; o.renderOrder = 1; } });
    this.clip = this.rig.lib.clips.get('Rifle_Aiming_Idle');
    this.t = 0;
    this.eye = new THREE.Vector3();
    this.grips = new Map();
    this.magState = { off: new THREE.Vector3(), rot: 0, vis: true };
  }

  gripsFor(kind) {
    if (this.grips.has(kind)) return this.grips.get(kind);
    const I = GUN_INFO[kind] || GUN_INFO.ak74;
    let g;
    if (SPECIAL[kind]) {
      const S = SPECIAL[kind];
      g = { R: V(S.R), L: V(S.L), qR: new THREE.Quaternion().setFromEuler(new THREE.Euler(...S.qR)), qL: new THREE.Quaternion().setFromEuler(new THREE.Euler(...S.qL)), special: true };
    } else {
      const R = V(I.gripR || [0, -0.17, 0.17]), L = V(I.gripL || [0, -0.11, -0.13]);
      const off = gripOffset({ key: kind, gripR: R, gripL: L });
      g = { R, L, qR: off.quat.clone().invert(), qL: off.lq.clone() };
    }
    this.grips.set(kind, g);
    return g;
  }

  // gunM — матрица ствольной группы в системе камеры; st — { kind, reload, empty, sprint, dt, shotAge }
  update(gunM, st) {
    const rig = this.rig, b = rig.b;
    this.t += st.dt || 0;
    rig.resetAcc();
    rig.lib.sample(this.clip, (this.t * 0.6) % this.clip.dur, 1, rig.accQ, rig.accP, null);
    rig.applyPose();
    // плечо — в фиксированную точку системы камеры (приклад упирается в плечо, голова над прикладом);
    // корпус развёрнут как в клипе: левое плечо выдвинуто вперёд
    this.root.position.set(0, 0, 0);
    this.root.updateMatrixWorld(true);
    const rs = b.RightArm.getWorldPosition(new THREE.Vector3());
    const sp = st.sprint || 0;
    this.root.position.set(0.125 + 0.02 * sp, -0.168 - 0.03 * sp, 0.115 + 0.02 * sp).sub(rs);
    this.root.updateMatrixWorld(true);
    const G = this.gripsFor(st.kind);
    const gp = new THREE.Vector3(), gq = new THREE.Quaternion(), gs = new THREE.Vector3();
    gunM.decompose(gp, gq, gs);
    const toCam = (v) => v.clone().applyMatrix4(gunM);
    let tR = toCam(G.R), tL = toCam(G.L);
    let qR = gq.clone().multiply(G.qR), qL = gq.clone().multiply(G.qL);
    let wL = 1;
    // перезарядка
    const r = st.reload;
    this.magState.off.set(0, 0, 0); this.magState.rot = 0; this.magState.vis = true;
    this.boltPull = 0;
    if (r >= 0 && !G.special) {
      const magGrab = toCam(V([0, -0.2, -0.02]).add(V(GUN_INFO[st.kind]?.gripR ? [0, 0, 0] : [0, 0, 0])));
      const away = new THREE.Vector3(-0.15, -0.55, 0.1);
      const kGrab = ss(0.0, 0.12, r), kOut = ss(0.12, 0.3, r), kBack = ss(0.32, 0.55, r), kIn = ss(0.55, 0.66, r);
      // магазин: вниз-вперёд, уходит из кадра, новый возвращается
      const magOut = kOut * (1 - kBack);
      this.magState.off.set(0, -0.32 * magOut - 0.06 * ss(0.12, 0.18, r) * (1 - kIn), -0.05 * magOut);
      this.magState.rot = 0.35 * magOut + 0.25 * (kBack * (1 - kIn));
      // рука: к магазину → вниз → обратно с новым → на цевьё / к затвору
      let p = tL.clone().lerp(magGrab, kGrab);
      p.lerp(away, kOut * (1 - kBack));
      if (kBack > 0) p.copy(away).lerp(magGrab, kBack);
      let q = qL.clone().slerp(gq.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0.3, 1.2))), kGrab * (1 - kIn * 0.2));
      const kRet = ss(0.66, 0.8, r);
      if (st.empty) {
        // взвести: рукоятка затворной рамы справа
        const handle = toCam(V([0.05, -0.05, 0.05]));
        const kGo = ss(0.66, 0.76, r), kPull = ss(0.76, 0.84, r), kHome = ss(0.86, 1.0, r);
        if (kGo > 0) p.copy(magGrab).lerp(handle, kGo);
        if (kPull > 0) { this.boltPull = kPull * (1 - ss(0.84, 0.88, r)); p.copy(handle).add(new THREE.Vector3(0, 0, 0.1 * this.boltPull).applyQuaternion(gq)); }
        if (kHome > 0) p.lerp(tL, kHome);
        q = q.slerp(gq.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, -0.6, 1.6))), kGo * (1 - kHome));
        q.slerp(qL, kHome);
      } else if (kRet > 0) { p.lerp(tL, kRet); q.slerp(qL, kRet); }
      tL = p; qL = q;
    }
    if (G.special && (st.kind === 'grenade' || st.kind === 'rdg2')) wL = 0.0;
    this._arm('Right', tR, qR, 1);
    this._arm('Left', tL, qL, 1, wL < 0.5);
  }

  _arm(side, palm, handQ, w, lower) {
    const rig = this.rig, b = rig.b;
    const k = rig.heightK;
    const wrist = palm.clone().sub(new THREE.Vector3(0, 0.05, 0.022).multiplyScalar(k).applyQuaternion(handQ));
    if (lower) wrist.set(side === 'Left' ? -0.3 : 0.3, -0.6, 0.15);
    const hand = b[side + 'Hand'], fore = b[side + 'ForeArm'], arm = b[side + 'Arm'];
    const sh = arm.getWorldPosition(new THREE.Vector3()), el = fore.getWorldPosition(new THREE.Vector3());
    const pole = el.sub(sh).normalize().add(new THREE.Vector3(side === 'Right' ? 0.5 : -0.2, -0.8, 0.1)).normalize();
    rig.ik(arm, fore, hand, wrist, pole, rig.len.upper * k, rig.len.fore * k);
    rig.setWorldQuat(hand, handQ);
  }
}
