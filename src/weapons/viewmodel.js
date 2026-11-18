// Оружие от первого лица. Система координат «прицельной линии»: начало — прорезь
// целика (или оптическая ось прицела), −Z вдоль линии прицеливания.
// Ствол (группа bore) повёрнут относительно линии прицеливания на угол прицеливания θ
// вокруг вершины мушки — ровно так, как это делает поднятая прицельная планка.
import * as THREE from 'three';
import { flashTexture } from '../world/textures.js';
import { buildGun, GUN_INFO, thirdPersonGun } from './guns.js';
import { gunMats } from './gunkit.js';
import { FPArms, fpArmsAvailable } from './fpArms.js';

const MODEL_INFO = GUN_INFO;
// длина прицельной планки от шарнира до прорези (для подъёма поворотом)
const LEAF = { ak74: 0.081, ak74gp: 0.081, akm: 0.081, pkm: 0.055 };
// окно выброса гильз (система канала)
const PORT = { ak74: [0.03, 0.006, 0.11], ak74gp: [0.03, 0.006, 0.11], akm: [0.03, 0.006, 0.11], ak74scope: [0.03, 0.006, 0.11], svd: [0.03, 0.006, 0.04], pkm: [0.03, -0.04, 0.09], ptrd: [0.04, 0.01, 0.12] };
const CASE = { ak74: [0.0052, 0.039], akm: [0.0056, 0.038], svd: [0.0063, 0.054], pkm: [0.0063, 0.054], ptrd: [0.013, 0.114] };

let flashMat = null;
function flashMaterial() {
  if (!flashMat) flashMat = new THREE.MeshBasicMaterial({ map: flashTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  return flashMat;
}

export class ViewModel {
  constructor(scene) {
    this.scene = scene;
    this.models = new Map();
    this.cur = null;
    this.kind = null;
    this.theta = 0;
    this._m = new THREE.Matrix4();
    this.arms = null;
    try { if (fpArmsAvailable()) { this.arms = new FPArms(); scene.add(this.arms.root); this.arms.root.visible = false; } } catch (e) { console.warn('fp arms', e); this.arms = null; }
    // гильзы
    this.cases = [];
    this.lastShot = 0;
  }

  info(kind) { return MODEL_INFO[kind]; }

  _build(kind, display = false) {
    const G = buildGun(kind, { shadow: false });
    const info = MODEL_INFO[kind];
    const root = new THREE.Group();
    const bore = new THREE.Group();
    root.add(bore);
    bore.add(G.root);
    // вспышка
    const flash = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), flashMaterial());
      p.rotation.set(i === 0 ? 0 : Math.PI / 2, i === 2 ? Math.PI / 2 : 0, 0);
      if (i > 0) p.scale.set(1, 2.2, 1);
      flash.add(p);
    }
    flash.position.set(info.muzzle[0], info.muzzle[1], info.muzzle[2] - 0.06);
    flash.visible = false;
    bore.add(flash);
    root.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    const parts = G.parts;
    const rest = {};
    for (const [k, v] of Object.entries(parts)) rest[k] = { p: v.position.clone(), q: v.quaternion.clone() };
    return { root, bore, parts, rest, info, flash, kind, display };
  }

  setKind(kind) {
    if (this.kind === kind) return;
    if (this.cur) this.scene.remove(this.cur.root);
    if (!this.models.has(kind)) this.models.set(kind, this._build(kind));
    this.cur = this.models.get(kind);
    this.kind = kind;
    this.scene.add(this.cur.root);
  }

  // pos/quat — положение прицельной системы в пространстве камеры; theta — угол прицеливания
  // st — { dt, shotAge, reload (0..1 или −1), empty, sprint }
  update(pos, quat, theta, visible, flashOn, st = {}) {
    const c = this.cur;
    if (!c) return;
    c.root.visible = visible;
    c.root.position.copy(pos);
    c.root.quaternion.copy(quat);
    // поворот ствола вокруг вершины мушки P=(0,0,-R)
    const R = c.info.R;
    const P = new THREE.Vector3(0, 0, -R);
    c.bore.rotation.set(theta, 0, 0);
    const rp = P.clone().applyEuler(c.bore.rotation);
    c.bore.position.copy(P).sub(rp);
    const parts = c.parts, rest = c.rest;
    // прицельная планка: поднимается поворотом на шарнире так, чтобы прорезь оставалась на линии прицеливания
    if (parts.leaf) {
      const rise = R * Math.sin(theta);
      if (LEAF[this.kind]) {
        parts.leaf.rotation.x = -Math.asin(Math.min(0.9, rise / LEAF[this.kind]));
      } else parts.leaf.position.y = rest.leaf.p.y + rise;
    }
    if (parts.slider) {
      const z = Math.min(0.05, theta * 2.4);
      parts.slider.position.z = rest.slider.p.z + z;
      parts.slider.position.y = rest.slider.p.y + R * Math.sin(theta) * ((0.081 - 0.021 + z) / 0.081) * 0.6;
    }
    c.flash.visible = !!flashOn;
    if (flashOn) { c.flash.rotation.z = Math.random() * 6.28; const s = 0.8 + Math.random() * 0.6; c.flash.scale.set(s, s, s); }
    // затворная рама: откат при выстреле, взведение при перезарядке
    const age = st.shotAge ?? 9;
    const cyc = age < 0.02 ? age / 0.02 : age < 0.085 ? 1 - (age - 0.02) / 0.065 : 0;
    const pull = this.arms ? this.arms.boltPull || 0 : 0;
    if (parts.bolt) parts.bolt.position.z = rest.bolt.p.z + Math.max(cyc, pull) * (this.kind === 'pkm' ? 0.08 : 0.1);
    // гильза
    if (age < this.lastShot && CASE[this.kind.replace(/gp|scope/, '')] && visible) this._eject(c);
    this.lastShot = age;
    this.theta = theta;
    c.root.updateMatrixWorld(true);
    // руки
    if (this.arms) {
      const show = visible && !c.display;
      this.arms.root.visible = show;
      if (show) {
        this.arms.update(c.bore.matrixWorld, { kind: this.kind, reload: st.reload ?? -1, empty: !!st.empty, sprint: st.sprint || 0, dt: st.dt || 1 / 60 });
        // магазин в руке
        if (parts.mag) {
          const ms = this.arms.magState;
          parts.mag.position.copy(rest.mag.p).add(ms.off);
          parts.mag.rotation.x = ms.rot;
        }
      }
    }
    this._cases(st.dt || 1 / 60);
  }

  _eject(c) {
    const port = PORT[this.kind];
    if (!port) return;
    const cs = CASE[this.kind.replace(/gp|scope/, '')] || CASE.ak74;
    let m = this.cases.find((x) => !x.alive);
    if (!m) {
      if (this.cases.length > 10) return;
      const M = gunMats();
      const g = new THREE.CylinderGeometry(cs[0], cs[0] * 1.05, cs[1], 10);
      g.rotateZ(Math.PI / 2);
      m = { mesh: new THREE.Mesh(g, M.brass), v: new THREE.Vector3(), w: new THREE.Vector3(), t: 0, alive: false };
      m.mesh.frustumCulled = false;
      this.scene.add(m.mesh);
      this.cases.push(m);
    }
    // окно выброса — в системе канала (ось канала на −h ниже линии прицеливания)
    const p = new THREE.Vector3(port[0], port[1] - (c.info.h || 0), port[2]).applyMatrix4(c.bore.matrixWorld);
    m.mesh.position.copy(p);
    const q = c.root.quaternion;
    m.v.set(1.6 + Math.random() * 0.8, 0.9 + Math.random() * 0.6, 0.25 + Math.random() * 0.3).applyQuaternion(q);
    m.w.set(Math.random() * 20, 15 + Math.random() * 15, Math.random() * 10);
    m.mesh.quaternion.copy(q);
    m.t = 0; m.alive = true; m.mesh.visible = true;
  }

  _cases(dt) {
    for (const m of this.cases) {
      if (!m.alive) continue;
      m.t += dt;
      m.v.y -= 9.8 * dt;
      m.mesh.position.addScaledVector(m.v, dt);
      m.mesh.rotation.x += m.w.x * dt; m.mesh.rotation.y += m.w.y * dt; m.mesh.rotation.z += m.w.z * dt;
      if (m.t > 0.7) { m.alive = false; m.mesh.visible = false; }
    }
  }

  // Дульный срез и направление ствола в пространстве камеры
  muzzleCam(outPos, outDir, pos, quat, theta) {
    const c = this.cur;
    const info = c ? c.info : MODEL_INFO.ak74;
    const R = info.R;
    const rootM = new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1, 1, 1));
    const e = new THREE.Euler(theta, 0, 0);
    const P = new THREE.Vector3(0, 0, -R);
    const bq = new THREE.Quaternion().setFromEuler(e);
    const bp = P.clone().sub(P.clone().applyQuaternion(bq));
    const boreM = new THREE.Matrix4().compose(bp, bq, new THREE.Vector3(1, 1, 1));
    const M = rootM.multiply(boreM);
    outPos.set(...info.muzzle).applyMatrix4(M);
    outDir.set(0, 0, -1).transformDirection(M);
  }
}

export { MODEL_INFO, thirdPersonGun };
