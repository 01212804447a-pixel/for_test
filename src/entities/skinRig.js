// Скелетная модель бойца (Mixamo-риг). Кости выставляются по опорным точкам позы
// из SoldierModel: таз и корпус — по базису туловища, руки и ноги — двухзвенной IK
// с длинами костей самой модели. Хитбоксы берутся из положения костей.
import * as THREE from 'three';
import { clone as skClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { model, texture } from '../core/assets.js';

const B = (n) => 'mixamorig' + n;
const NAMES = {
  hips: 'Hips', spine: 'Spine', spine1: 'Spine1', spine2: 'Spine2', neck: 'Neck', head: 'Head',
  shL: 'LeftShoulder', armL: 'LeftArm', foreL: 'LeftForeArm', handL: 'LeftHand',
  shR: 'RightShoulder', armR: 'RightArm', foreR: 'RightForeArm', handR: 'RightHand',
  upL: 'LeftUpLeg', legL: 'LeftLeg', footL: 'LeftFoot', toeL: 'LeftToeBase',
  upR: 'RightUpLeg', legR: 'RightLeg', footR: 'RightFoot', toeR: 'RightToeBase',
};

const matCache = new Map();
function materials(faction) {
  if (matCache.has(faction)) return matCache.get(faction);
  const map = texture('soldier_' + faction + '.jpg') || texture('soldier_negs.jpg');
  const nor = texture('soldier_nor.jpg', { srgb: false });
  for (const t of [map, nor]) if (t) { t.flipY = false; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; }
  const body = new THREE.MeshStandardMaterial({ map, normalMap: nor, roughness: 0.75, metalness: 0.1 });
  const visor = new THREE.MeshStandardMaterial({ color: faction === 'negs' ? 0x2a1a08 : 0x0c0c0e, roughness: 0.08, metalness: 0.85 });
  const r = { body, visor };
  matCache.set(faction, r);
  return r;
}

export function skinAvailable() { return !!model('soldier'); }

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _u = new THREE.Vector3(), _w = new THREE.Vector3();

export class SkinRig {
  constructor(faction) {
    const g = model('soldier');
    this.holder = new THREE.Group();
    this.holder.rotation.y = Math.PI; // Mixamo смотрит в +Z, наш боец — в −Z
    const sc = skClone(g.scene);
    this.holder.add(sc);
    const m = materials(faction);
    sc.traverse((o) => {
      if (o.isSkinnedMesh || o.isMesh) {
        o.material = /visor/i.test(o.name) ? m.visor : m.body;
        o.castShadow = true; o.receiveShadow = true;
        o.frustumCulled = false;
      }
    });
    this.bones = {};
    for (const [k, n] of Object.entries(NAMES)) this.bones[k] = sc.getObjectByName(B(n)) || sc.getObjectByName(B(':' + n)) || sc.getObjectByName('mixamorig:' + n);
    this.ok = Object.values(this.bones).every(Boolean);
    this.scene = sc;
    this.rest = null;
  }

  // Снимок позы привязки в системе root (вызывается, когда root ещё в нуле)
  _captureRest(root) {
    root.updateMatrixWorld(true);
    const rootQ = root.getWorldQuaternion(new THREE.Quaternion()).invert();
    const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    this.rest = {};
    for (const [k, b] of Object.entries(this.bones)) {
      const q = b.getWorldQuaternion(new THREE.Quaternion()).premultiply(rootQ);
      const y = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      const p = b.getWorldPosition(new THREE.Vector3()).applyMatrix4(rootInv);
      this.rest[k] = { q, y, p };
    }
    const len = (a, b) => this.rest[a].p.distanceTo(this.rest[b].p);
    this.len = { thigh: len('upL', 'legL'), shin: len('legL', 'footL'), upper: len('armL', 'foreL'), fore: len('foreL', 'handL') };
    this.footH = this.rest.footL.p.y;
  }

  _setWorld(bone, qWorld) {
    bone.parent.getWorldQuaternion(_q2);
    bone.quaternion.copy(_q2.invert().multiply(qWorld));
    bone.updateWorldMatrix(false, false);
  }

  // Повернуть кость так, чтобы её ось Y смотрела вдоль dir (мир), с минимальным закручиванием от позы привязки
  _aim(key, dir, rootQ) {
    const r = this.rest[key];
    _v.copy(r.y).applyQuaternion(rootQ);
    _q.setFromUnitVectors(_v.normalize(), dir.clone().normalize());
    const qw = _q.clone().multiply(rootQ.clone().multiply(r.q));
    this._setWorld(this.bones[key], qw);
  }

  _ik(upKey, midKey, endKey, target, pole, la, lb, rootQ) {
    const S = this.bones[upKey].getWorldPosition(new THREE.Vector3());
    _u.subVectors(target, S);
    let L = _u.length();
    if (L < 1e-4) return;
    _u.divideScalar(L);
    const Lc = Math.min(Math.max(L, 0.05), la + lb - 0.003);
    const cosA = Math.max(-1, Math.min(1, (la * la + Lc * Lc - lb * lb) / (2 * la * Lc)));
    const sinA = Math.sqrt(1 - cosA * cosA);
    _w.copy(pole).addScaledVector(_u, -pole.dot(_u));
    if (_w.lengthSq() < 1e-6) _w.set(0, 0, 1);
    _w.normalize();
    const E = S.clone().addScaledVector(_u, la * cosA).addScaledVector(_w, la * sinA);
    this._aim(upKey, E.clone().sub(S), rootQ);
    const E2 = this.bones[midKey].getWorldPosition(new THREE.Vector3());
    const T = S.clone().addScaledVector(_u, Lc);
    this._aim(midKey, T.sub(E2), rootQ);
  }

  // m — SoldierModel с рассчитанной позой
  apply(m, torsoQ, headPitchQ, wP, dw) {
    const root = m.root;
    if (!this.rest) {
      const p = root.position.clone(), q = root.quaternion.clone(), s = root.scale.clone();
      root.position.set(0, 0, 0); root.quaternion.identity(); root.scale.set(1, 1, 1);
      this._captureRest(root);
      root.position.copy(p); root.quaternion.copy(q); root.scale.copy(s);
    }
    root.updateMatrixWorld(true);
    const rootQ = root.getWorldQuaternion(new THREE.Quaternion());
    const toW = (v) => v.clone().applyMatrix4(root.matrixWorld);
    const P = m.P;
    const torsoW = rootQ.clone().multiply(torsoQ);
    // таз
    const hips = this.bones.hips;
    const Hw = toW(P.H);
    hips.parent.updateWorldMatrix(true, false);
    hips.position.copy(hips.parent.worldToLocal(Hw.clone()));
    for (const k of ['hips', 'spine', 'spine1', 'spine2', 'neck', 'shL', 'shR']) {
      this._setWorld(this.bones[k], torsoW.clone().multiply(this.rest[k].q));
    }
    this._setWorld(this.bones.head, torsoW.clone().multiply(headPitchQ).multiply(this.rest.head.q));
    // руки
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(torsoW);
    const down = new THREE.Vector3(0, -1, 0);
    const poleL = down.clone().addScaledVector(right, -0.7).add(new THREE.Vector3(0, 0, 0.2).applyQuaternion(rootQ)).normalize();
    const poleR = down.clone().addScaledVector(right, 0.7).add(new THREE.Vector3(0, 0, 0.2).applyQuaternion(rootQ)).normalize();
    this._ik('armL', 'foreL', 'handL', toW(P.hdL), poleL, this.len.upper, this.len.fore, rootQ);
    this._ik('armR', 'foreR', 'handR', toW(P.hdR), poleR, this.len.upper, this.len.fore, rootQ);
    for (const [hk, fk] of [['handL', 'foreL'], ['handR', 'foreR']]) {
      const f = this.bones[fk].getWorldQuaternion(new THREE.Quaternion());
      this._setWorld(this.bones[hk], f.multiply(this.rest[fk].q.clone().invert()).multiply(this.rest[hk].q));
    }
    // ноги
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(rootQ);
    const kneePole = fwd.clone().multiplyScalar(1 - wP - dw * 0.8).add(new THREE.Vector3(0, -(wP + dw * 0.8), 0)).normalize();
    const ankL = toW(P.anL), ankR = toW(P.anR);
    ankL.y += this.footH - 0.08; ankR.y += this.footH - 0.08;
    this._ik('upL', 'legL', 'footL', ankL, kneePole, this.len.thigh, this.len.shin, rootQ);
    this._ik('upR', 'legR', 'footR', ankR, kneePole, this.len.thigh, this.len.shin, rootQ);
    // стопы: стоя — горизонтально по направлению тела, лёжа — носками вниз
    const flat = rootQ.clone();
    const lying = torsoW.clone();
    for (const k of ['footL', 'footR']) {
      const qa = flat.clone().multiply(this.rest[k].q), qb = lying.clone().multiply(this.rest[k].q);
      this._setWorld(this.bones[k], qa.slerp(qb, Math.min(1, wP + dw)));
    }
  }

  // Хитбоксы по костям (мир)
  hitboxes(out) {
    const b = this.bones;
    const W = (k, o) => b[k].getWorldPosition(o);
    if (out.length < 9) for (let i = out.length; i < 9; i++) out.push({ a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0, zone: '' });
    W('head', out[0].a); out[0].a.add(_v.set(0, 0.08, 0).applyQuaternion(b.head.getWorldQuaternion(_q))); out[0].b.copy(out[0].a); out[0].r = 0.12; out[0].zone = 'head';
    W('spine', out[1].a); W('neck', out[1].b); out[1].r = 0.17; out[1].zone = 'torso';
    W('upL', out[2].a); W('legL', out[2].b); out[2].r = 0.085; out[2].zone = 'leg';
    W('upR', out[3].a); W('legR', out[3].b); out[3].r = 0.085; out[3].zone = 'leg';
    W('legL', out[4].a); W('footL', out[4].b); out[4].r = 0.07; out[4].zone = 'leg';
    W('legR', out[5].a); W('footR', out[5].b); out[5].r = 0.07; out[5].zone = 'leg';
    W('armL', out[6].a); W('handL', out[6].b); out[6].r = 0.06; out[6].zone = 'arm';
    W('armR', out[7].a); W('handR', out[7].b); out[7].r = 0.06; out[7].zone = 'arm';
    W('hips', out[8].a); out[8].b.copy(out[8].a); out[8].r = 0.16; out[8].zone = 'pelvis';
    return out;
  }
}
