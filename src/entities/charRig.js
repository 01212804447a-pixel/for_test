// Скелетная анимация бойцов.
// Клипы motion capture (Mixamo) заранее перенесены на эталонный скелет (tools/prep/characters.html).
// Поверх клипов работают процедурные слои: разворот ног по направлению шага, доворот корпуса
// так, чтобы ствол смотрел точно в точку прицеливания, оружие в правой руке, IK левой руки
// на цевьё, отдача, выпадение оружия при гибели, стопы по рельефу.
import * as THREE from 'three';
import { clone as skClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { model } from '../core/assets.js';

const FPS = 30;
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _m = new THREE.Matrix4(), _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const smooth = (cur, tgt, rate, dt) => cur + (tgt - cur) * (1 - Math.exp(-rate * dt));

const LOWER = /Hips$|UpLeg$|Leg$|Foot$|ToeBase$/;
const LOOPS = ['Rifle_Idle', 'Rifle_Aiming_Idle', 'Rifle_Walk', 'Rifle_Run', 'Walking_While_Aiming_Rifle', 'Rifle_Crouch_Walk', 'Firing_Rifle_Crouch_Walking', 'Crawling', 'Crouched_Walking', 'Sprint_Forward', 'Running', 'Walking', 'Sneaking_Forward', 'Reloading_Walking'];

// ---------- библиотека клипов ----------
class AnimLib {
  constructor(gltf) {
    const rig = gltf.scene.getObjectByName('Rig') || gltf.scene;
    rig.updateMatrixWorld(true);
    const hips = rig.getObjectByName('mixamorigHips');
    const names = [], parent = [], objs = [];
    const walk = (o, pi) => {
      let me = pi;
      if (/^mixamorig/.test(o.name) && !/_End$|4$/.test(o.name)) { me = names.length; names.push(o.name); parent.push(pi); objs.push(o); }
      for (const c of o.children) walk(c, me);
    };
    walk(hips, -1);
    this.rig = rig; this.objs = objs;
    this.names = names; this.parent = parent; this.n = names.length;
    this.index = new Map(names.map((n, i) => [n, i]));
    const rigInvQ = rig.getWorldQuaternion(new THREE.Quaternion()).invert();
    const rigInvM = new THREE.Matrix4().copy(rig.matrixWorld).invert();
    this.restL = objs.map((o) => o.quaternion.clone());
    this.restW = objs.map((o) => o.getWorldQuaternion(new THREE.Quaternion()).premultiply(rigInvQ));
    this.parentW = hips.parent.getWorldQuaternion(new THREE.Quaternion()).premultiply(rigInvQ);
    this.hipsRest = hips.position.clone();
    this.hipsScale = hips.parent.getWorldScale(new THREE.Vector3()).x / rig.getWorldScale(new THREE.Vector3()).x;
    this.hipsRestY = hips.getWorldPosition(new THREE.Vector3()).applyMatrix4(rigInvM).y;
    this.lower = new Float32Array(this.n); this.upper = new Float32Array(this.n);
    this.fingers = new Float32Array(this.n);
    names.forEach((n, i) => { const lo = LOWER.test(n); this.lower[i] = lo ? 1 : 0; this.upper[i] = lo ? 0 : 1; this.fingers[i] = /Hand(Thumb|Index|Middle|Ring|Pinky)/.test(n) ? 1 : 0; });
    this.noFingersUpper = this.upper.map((u, i) => (this.fingers[i] ? 0 : u));
    this.armsMask = new Float32Array(this.n); this.spineMask = new Float32Array(this.n);
    names.forEach((n, i) => { if (/Shoulder|Arm|Hand/.test(n)) this.armsMask[i] = 1; else if (!LOWER.test(n)) this.spineMask[i] = 1; });
    const meta = rig.userData.meta || {};
    this.clips = new Map();
    for (const c of gltf.animations) this.clips.set(c.name, this._compile(c, meta[c.name] || {}));
    for (const n of LOOPS) { const c = this.clips.get(n); if (c) c.loop = true; }
    this._phases();
  }

  _compile(clip, meta) {
    let N = 1;
    for (const t of clip.tracks) N = Math.max(N, t.times.length);
    const n = this.n;
    const q = new Float32Array(n * N * 4);
    for (let f = 0; f < N; f++) for (let i = 0; i < n; i++) this.restL[i].toArray(q, (f * n + i) * 4);
    const hd = new Float32Array(N * 3);
    for (const t of clip.tracks) {
      const dot = t.name.lastIndexOf('.');
      const bn = t.name.slice(0, dot), prop = t.name.slice(dot + 1);
      const i = this.index.get(bn);
      if (i === undefined) continue;
      const v = t.values;
      if (prop === 'quaternion') {
        for (let f = 0; f < N; f++) {
          const k = Math.min(f, t.times.length - 1) * 4;
          const o = (f * n + i) * 4;
          q[o] = v[k]; q[o + 1] = v[k + 1]; q[o + 2] = v[k + 2]; q[o + 3] = v[k + 3];
        }
      } else if (prop === 'position' && i === 0) {
        for (let f = 0; f < N; f++) {
          const k = Math.min(f, t.times.length - 1) * 3;
          hd[f * 3] = (v[k] - this.hipsRest.x) * this.hipsScale;
          hd[f * 3 + 1] = (v[k + 1] - this.hipsRest.y) * this.hipsScale;
          hd[f * 3 + 2] = (v[k + 2] - this.hipsRest.z) * this.hipsScale;
        }
      }
    }
    return { name: clip.name, dur: clip.duration, N, q, hd, speed: meta.speed || 0, phase0: 0, loop: false };
  }

  // Фаза шага: начало цикла — левая стопа впереди (для синхронного смешивания клипов)
  _phases() {
    const iL = this.index.get('mixamorigLeftFoot'), iR = this.index.get('mixamorigRightFoot');
    for (const c of this.clips.values()) {
      if (!c.loop || c.speed <= 0) continue;
      let best = -1e9, bf = 0;
      for (let f = 0; f < c.N; f++) {
        this.poseObjs(c, f);
        const zl = this.objs[iL].getWorldPosition(_v).z, zr = this.objs[iR].getWorldPosition(_v2).z;
        if (zl - zr > best) { best = zl - zr; bf = f; }
      }
      c.phase0 = bf / Math.max(1, c.N - 1);
    }
    for (let i = 0; i < this.n; i++) this.objs[i].quaternion.copy(this.restL[i]);
    this.objs[0].position.copy(this.hipsRest);
    this.rig.updateMatrixWorld(true);
  }

  poseObjs(c, f) {
    const n = this.n;
    for (let i = 0; i < n; i++) this.objs[i].quaternion.fromArray(c.q, (f * n + i) * 4);
    this.objs[0].position.set(this.hipsRest.x + c.hd[f * 3] / this.hipsScale, this.hipsRest.y + c.hd[f * 3 + 1] / this.hipsScale, this.hipsRest.z + c.hd[f * 3 + 2] / this.hipsScale);
    this.rig.updateMatrixWorld(true);
  }

  // Добавить готовую позу (локальные повороты эталона + смещение таза)
  add(pose, poseP, w, accQ, accP, mask) {
    if (w <= 1e-4) return;
    for (let i = 0; i < this.n; i++) {
      const m = mask ? mask[i] : 1;
      if (!m) continue;
      const o = i * 4, s = w * m;
      accQ[o] += pose[o] * s; accQ[o + 1] += pose[o + 1] * s; accQ[o + 2] += pose[o + 2] * s; accQ[o + 3] += pose[o + 3] * s;
    }
    if (accP && (!mask || mask[0])) { accP[0] += poseP[0] * w; accP[1] += poseP[1] * w; accP[2] += poseP[2] * w; accP[3] += w; }
  }

  // Поза «лёжа» (повороты задаются в системе стоящего бойца: +X — влево, +Y — вверх, +Z — вперёд).
  // crawl — доля переползания, ph — фаза
  prone(out, outP, crawl, ph) {
    const n = this.n;
    for (let i = 0; i < n; i++) this.restL[i].toArray(out, i * 4);
    const R = new THREE.Quaternion(), T = new THREE.Quaternion();
    const set = (name, ...rots) => {
      const i = this.index.get(name);
      if (i === undefined) return;
      R.identity();
      for (const [ax, a] of rots) R.multiply(T.setFromAxisAngle(ax === 'x' ? _v.set(1, 0, 0) : ax === 'y' ? _v.set(0, 1, 0) : _v.set(0, 0, 1), a));
      const pi = this.parent[i];
      const P = pi < 0 ? this.parentW : this.restW[pi];
      _q.copy(P).invert().multiply(R).multiply(this.restW[i]).toArray(out, i * 4);
    };
    const sL = Math.max(0, Math.sin(ph * Math.PI * 2)) * crawl, sR = Math.max(0, -Math.sin(ph * Math.PI * 2)) * crawl;
    const roll = (sL - sR) * 0.12;
    set('mixamorigHips', ['x', Math.PI / 2], ['z', 0.04 + roll]);
    set('mixamorigSpine', ['x', -0.2], ['z', -roll * 0.5]);
    set('mixamorigSpine1', ['x', -0.2]);
    set('mixamorigSpine2', ['x', -0.22]);
    set('mixamorigNeck', ['x', -0.45]);
    set('mixamorigHead', ['x', -0.38]);
    // ноги врозь, стопы на внутренней стороне; при переползании колено подтягивается вбок
    set('mixamorigLeftUpLeg', ['z', 0.13 + sL * 0.55], ['x', -sL * 0.7]);
    set('mixamorigRightUpLeg', ['z', -0.16 - sR * 0.55], ['x', -sR * 0.7]);
    set('mixamorigLeftLeg', ['x', 0.05 + sL * 1.3]);
    set('mixamorigRightLeg', ['x', 0.08 + sR * 1.3]);
    set('mixamorigLeftFoot', ['y', 0.9], ['x', 0.35]);
    set('mixamorigRightFoot', ['y', -0.9], ['x', 0.35]);
    outP[0] = 0; outP[1] = 0.16 - this.hipsRestY; outP[2] = -0.5 + Math.sin(ph * Math.PI * 4) * 0.02 * crawl;
  }

  // Накопление позы клипа c в момент t с весом w по маске
  sample(c, t, w, accQ, accP, mask) {
    if (w <= 1e-4 || !c) return;
    const N = c.N, n = this.n, q = c.q;
    let fi = t * FPS;
    if (c.loop) { fi %= N - 1; if (fi < 0) fi += N - 1; } else fi = clamp(fi, 0, N - 1);
    const i0 = Math.floor(fi), i1 = Math.min(N - 1, i0 + 1), a = fi - i0, b = 1 - a;
    for (let i = 0; i < n; i++) {
      const m = mask ? mask[i] : 1;
      if (!m) continue;
      const o0 = (i0 * n + i) * 4, o1 = (i1 * n + i) * 4;
      let x = q[o0] * b + q[o1] * a, y = q[o0 + 1] * b + q[o1 + 1] * a, z = q[o0 + 2] * b + q[o1 + 2] * a, ww = q[o0 + 3] * b + q[o1 + 3] * a;
      const r = this.restL[i];
      const s = (x * r.x + y * r.y + z * r.z + ww * r.w < 0 ? -1 : 1) * w * m;
      const o = i * 4;
      accQ[o] += x * s; accQ[o + 1] += y * s; accQ[o + 2] += z * s; accQ[o + 3] += ww * s;
    }
    if (accP && (!mask || mask[0])) {
      const p0 = i0 * 3, p1 = i1 * 3;
      accP[0] += (c.hd[p0] * b + c.hd[p1] * a) * w;
      accP[1] += (c.hd[p0 + 1] * b + c.hd[p1 + 1] * a) * w;
      accP[2] += (c.hd[p0 + 2] * b + c.hd[p1 + 2] * a) * w;
      accP[3] += w;
    }
  }
}

let LIB = null;
export function animLib() {
  if (LIB) return LIB;
  const g = model('anims');
  if (!g) return null;
  LIB = new AnimLib(g);
  return LIB;
}
export function charAvailable(kind) { return !!animLib() && !!model(CHAR_MODEL[kind] || 'char_negs'); }

const CHAR_MODEL = { negs: 'char_negs', denter1: 'char_denter1', denter2: 'char_denter2', denter3: 'char_denter3', denter4: 'char_denter4', officer: 'char_negs', krandi: 'char_denter1' };

// ---------- калибровка хвата ----------
// Положение оружия относительно правой кисти определяется по позе «прицеливание» клипа:
// ось оружия — от ладони правой руки к ладони левой, без завала.
const gripCache = new Map();
function palm(lib, side) {
  const h = lib.objs[lib.index.get(`mixamorig${side}Hand`)], m = lib.objs[lib.index.get(`mixamorig${side}HandMiddle1`)];
  const hp = h.getWorldPosition(new THREE.Vector3()), mp = m.getWorldPosition(new THREE.Vector3());
  const hq = h.getWorldQuaternion(new THREE.Quaternion());
  return { pos: hp.clone().lerp(mp, 0.5).addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(hq), 0.022), hp, hq };
}
export function gripOffset(gun) {
  const key = gun.key;
  if (gripCache.has(key)) return gripCache.get(key);
  const lib = animLib();
  const c = lib.clips.get('Rifle_Aiming_Idle');
  lib.poseObjs(c, 0);
  const R = palm(lib, 'Right'), L = palm(lib, 'Left');
  // ось в системе оружия (−Z вперёд) и в мире
  const vw = _v.subVectors(gun.gripL, gun.gripR).normalize();
  const vr = _v2.subVectors(L.pos, R.pos).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(vw, vr);
  // крен: верх оружия как можно ближе к вертикали
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const want = new THREE.Vector3(0, 1, 0).addScaledVector(vr, -vr.y).normalize();
  up.addScaledVector(vr, -up.dot(vr)).normalize();
  let ang = Math.acos(clamp(up.dot(want), -1, 1));
  if (new THREE.Vector3().crossVectors(up, want).dot(vr) < 0) ang = -ang;
  q.premultiply(new THREE.Quaternion().setFromAxisAngle(vr, ang));
  const pos = R.pos.clone().sub(gun.gripR.clone().applyQuaternion(q));
  // относительно кисти (без масштаба)
  const hInv = R.hq.clone().invert();
  const res = {
    pos: pos.sub(R.hp).applyQuaternion(hInv).multiplyScalar(1 / lib.hipsRestY),
    quat: hInv.multiply(q),
    // поворот левой кисти относительно оружия в этой позе
    lq: new THREE.Quaternion().copy(q).invert().multiply(L.hq),
  };
  gripCache.set(key, res);
  for (let i = 0; i < lib.n; i++) lib.objs[i].quaternion.copy(lib.restL[i]);
  lib.objs[0].position.copy(lib.hipsRest);
  lib.rig.updateMatrixWorld(true);
  return res;
}

// ---------- персонаж ----------
const armGeoCache = new Map();
function armsOnly(mesh) {
  if (armGeoCache.has(mesh.geometry)) return armGeoCache.get(mesh.geometry);
  const g = mesh.geometry;
  const bones = mesh.skeleton.bones;
  const nm = bones.map((b) => b.name.replace(/_\d+$/, ''));
  const arm = nm.map((n) => (/(Left|Right)(Arm|ForeArm|Hand)/.test(n) ? 1 : 0));
  // положения костей в позе привязки и отрезки «кость → дочерняя кость»
  const head = mesh.skeleton.boneInverses.map((m) => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(m).invert()));
  const tail = bones.map((b, i) => { const c = b.children.find((x) => x.isBone); return c ? head[bones.indexOf(c)] : head[i]; });
  const fore = nm.indexOf('mixamorigLeftForeArm'), hand = nm.indexOf('mixamorigLeftHand');
  const unit = head[fore].distanceTo(head[hand]); // длина предплечья в единицах модели
  const maxD = unit * 0.42;
  const si = g.attributes.skinIndex, sw = g.attributes.skinWeight, pos = g.attributes.position;
  const bm = mesh.bindMatrix;
  const keep = new Uint8Array(si.count);
  const v = new THREE.Vector3(), seg = new THREE.Line3(), cp = new THREE.Vector3();
  for (let i = 0; i < si.count; i++) {
    let w = 0, best = -1, bw = 0;
    for (let k = 0; k < 4; k++) { const bi = si.getComponent(i, k), ww = sw.getComponent(i, k); if (arm[bi]) w += ww; if (ww > bw) { bw = ww; best = bi; } }
    if (w <= 0.55) continue;
    v.fromBufferAttribute(pos, i).applyMatrix4(bm);
    seg.set(head[best], tail[best]);
    seg.closestPointToPoint(v, true, cp);
    keep[i] = cp.distanceTo(v) < maxD ? 1 : 0;
  }
  const idx = g.index.array;
  const tri = new Int32Array(idx.length / 3);
  for (const gr of g.groups) for (let t = gr.start / 3; t < (gr.start + gr.count) / 3; t++) tri[t] = gr.materialIndex;
  const by = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (!(keep[a] && keep[b] && keep[c])) continue;
    const m = tri[t / 3];
    if (!by.has(m)) by.set(m, []);
    by.get(m).push(a, b, c);
  }
  const ng = g.clone();
  ng.clearGroups();
  const all = [];
  for (const [m, list] of by) { ng.addGroup(all.length, list.length, m); for (const x of list) all.push(x); }
  ng.setIndex(all);
  armGeoCache.set(mesh.geometry, ng);
  return ng;
}

const matCache = new Map();
function factionMaterial(kind, m) {
  if (kind !== 'officer') return m;
  const key = kind + m.uuid;
  if (!matCache.has(key)) { const c = m.clone(); c.color = new THREE.Color(0.62, 0.7, 0.5); matCache.set(key, c); }
  return matCache.get(key);
}

export class CharRig {
  constructor(kind = 'negs', { fpArms = false } = {}) {
    const lib = animLib();
    this.lib = lib;
    this.kind = kind;
    const g = model(CHAR_MODEL[kind] || 'char_negs');
    const sc = skClone(g.scene);
    // у бойца N.E.G.S в файле две копии: тело и руки для вида от первого лица
    const drop = [];
    sc.traverse((o) => { if (o.name === (fpArms ? 'SWAT_Body' : 'SWAT_ViewArms')) drop.push(o); });
    for (const o of drop) o.parent.remove(o);
    sc.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = !fpArms; o.receiveShadow = true; o.frustumCulled = false;
        if (o.material) o.material = Array.isArray(o.material) ? o.material.map((m) => factionMaterial(kind, m)) : factionMaterial(kind, o.material);
      }
    });
    // для рук от первого лица оставляем только треугольники рук (без ремней, шланга и частей разгрузки)
    if (fpArms) sc.traverse((o) => { if (o.isSkinnedMesh) o.geometry = armsOnly(o); });
    this.scene = sc;
    this.holder = new THREE.Group();
    this.holder.rotation.y = Math.PI; // Mixamo смотрит в +Z, у нас «вперёд» — −Z
    this.holder.add(sc);
    // имена костей могут иметь суффикс _1 (вторая копия скелета в файле)
    const byName = new Map();
    sc.traverse((o) => { const k = o.name.replace(/_\d+$/, ''); if (!byName.has(k)) byName.set(k, o); });
    this.bones = lib.names.map((n) => byName.get(n) || null);
    this.b = {};
    for (const n of ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase', 'LeftHandMiddle1', 'RightHandMiddle1']) this.b[n] = byName.get('mixamorig' + n);
    // поправки ретаргета: L' = A·L·B (A, B постоянны для пары скелетов)
    sc.updateMatrixWorld(true);
    const scInvQ = sc.getWorldQuaternion(new THREE.Quaternion()).invert();
    const scInvM = new THREE.Matrix4().copy(sc.matrixWorld).invert();
    const tW = this.bones.map((b) => (b ? b.getWorldQuaternion(new THREE.Quaternion()).premultiply(scInvQ) : null));
    this.restL = this.bones.map((b) => (b ? b.quaternion.clone() : null));
    const hipsB = this.bones[0];
    const tParentW = hipsB.parent.getWorldQuaternion(new THREE.Quaternion()).premultiply(scInvQ);
    this.A = []; this.B = [];
    const near = (q) => Math.abs(Math.abs(q.w) - 1) < 1e-5;
    for (let i = 0; i < lib.n; i++) {
      if (!tW[i]) { this.A.push(null); this.B.push(null); continue; }
      const pi = lib.parent[i];
      const tp = pi < 0 ? tParentW : tW[pi], rp = pi < 0 ? lib.parentW : lib.restW[pi];
      const A = tp.clone().invert().multiply(rp), B = lib.restW[i].clone().invert().multiply(tW[i]);
      this.A.push(near(A) ? null : A); this.B.push(near(B) ? null : B);
    }
    this.hipsRest = hipsB.position.clone();
    const hipsW = hipsB.getWorldPosition(new THREE.Vector3()).applyMatrix4(scInvM);
    this.hipsScale = hipsB.parent.getWorldScale(new THREE.Vector3()).x / sc.getWorldScale(new THREE.Vector3()).x;
    this.heightK = hipsW.y / lib.hipsRestY; // рост относительно эталона
    this.posK = this.heightK / this.hipsScale;
    this.accQ = new Float32Array(lib.n * 4);
    this.accP = new Float32Array(4);
    // длины звеньев (м)
    const d = (a, b) => this.b[a].getWorldPosition(_v).distanceTo(this.b[b].getWorldPosition(_v2)) / sc.getWorldScale(_s).x;
    this.len = { upper: d('LeftArm', 'LeftForeArm'), fore: d('LeftForeArm', 'LeftHand'), thigh: d('LeftUpLeg', 'LeftLeg'), shin: d('LeftLeg', 'LeftFoot') };
  }

  resetAcc() { this.accQ.fill(0); this.accP.fill(0); }

  // Записать накопленную позу в кости
  applyPose() {
    const lib = this.lib, acc = this.accQ;
    for (let i = 0; i < lib.n; i++) {
      const bone = this.bones[i];
      if (!bone) continue;
      const o = i * 4;
      const x = acc[o], y = acc[o + 1], z = acc[o + 2], w = acc[o + 3];
      const l = Math.hypot(x, y, z, w);
      if (l < 1e-6) { bone.quaternion.copy(this.restL[i]); continue; }
      _q.set(x / l, y / l, z / l, w / l);
      if (this.A[i]) _q.premultiply(this.A[i]);
      if (this.B[i]) _q.multiply(this.B[i]);
      bone.quaternion.copy(_q);
    }
    const p = this.accP, hb = this.bones[0];
    if (p[3] > 1e-4) {
      const k = this.posK / p[3];
      hb.position.set(this.hipsRest.x + p[0] * k, this.hipsRest.y + p[1] * k, this.hipsRest.z + p[2] * k);
    } else hb.position.copy(this.hipsRest);
  }

  // Повернуть кость в мировой системе: Qw' = R·Qw
  rotateWorld(bone, R) {
    bone.getWorldQuaternion(_q2);
    bone.parent.getWorldQuaternion(_q3);
    bone.quaternion.copy(_q3.invert().multiply(R).multiply(_q2));
    bone.updateMatrixWorld(true);
  }

  // Задать мировой поворот кости
  setWorldQuat(bone, Qw) {
    bone.parent.getWorldQuaternion(_q3);
    bone.quaternion.copy(_q3.invert().multiply(Qw));
    bone.updateMatrixWorld(true);
  }

  // Двухзвенная IK: кость a → b → c, цель для c — target (мир), pole — желаемое направление колена/локтя
  ik(a, b, c, target, pole, la, lb) {
    const A = a.getWorldPosition(_v), B0 = b.getWorldPosition(_v2);
    const u = _v3.subVectors(target, A);
    let L = u.length();
    if (L < 1e-4) return;
    u.divideScalar(L);
    const Lc = clamp(L, Math.abs(la - lb) + 0.01, la + lb - 0.002);
    const cosA = clamp((la * la + Lc * Lc - lb * lb) / (2 * la * Lc), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const w = _v4.copy(pole).addScaledVector(u, -pole.dot(u));
    if (w.lengthSq() < 1e-8) w.copy(B0).sub(A).addScaledVector(u, -B0.clone().sub(A).dot(u));
    w.normalize();
    const E = new THREE.Vector3().copy(A).addScaledVector(u, la * cosA).addScaledVector(w, la * sinA);
    // верхнее звено: повернуть так, чтобы b попал в E
    const cur = new THREE.Vector3().subVectors(B0, A).normalize();
    const want = new THREE.Vector3().subVectors(E, A).normalize();
    this.rotateWorld(a, _q.setFromUnitVectors(cur, want));
    // нижнее звено
    const Bn = b.getWorldPosition(new THREE.Vector3()), Cn = c.getWorldPosition(new THREE.Vector3());
    const cur2 = Cn.sub(Bn).normalize();
    const T = new THREE.Vector3().copy(A).addScaledVector(u, Lc);
    const want2 = T.sub(Bn).normalize();
    this.rotateWorld(b, _q.setFromUnitVectors(cur2, want2));
  }
}

// ---------- аниматор бойца ----------
const DEATHS = ['Death', 'Rifle_Death', 'Falling_Back_Death'];

export class CharAnimator {
  constructor(kind, gun) {
    this.rig = new CharRig(kind);
    this.root = new THREE.Group();
    this.root.add(this.rig.holder);
    this.gun = gun;
    if (gun) { gun.object.matrixAutoUpdate = false; this.root.add(gun.object); this.grip = gripOffset(gun); }
    this.wS = 1; this.wC = 0; this.wP = 0;
    this.spd = 0; this.phase = Math.random(); this.idleT = Math.random() * 8;
    this.legYaw = 0; this.dirSign = 1;
    this.aimW = 0; this.relaxYaw = 0;
    this.fireT = 9; this.hitT = 9; this.reloadW = 0;
    this.rec = 0; this.recV = 0;
    this.deadT = -1; this.deathClip = null;
    this.gunWorld = new THREE.Matrix4();
    this.gunDrop = null;
    this.lhW = 1;
    this.lod = 0;
    this.time = 0;
    this.pose = new Float32Array(this.rig.lib.n * 4); this.poseP = new Float32Array(3);
  }

  get bones() { return this.rig.b; }

  hit(dir) { this.hitT = 0; }
  shot() { this.fireT = 0; this.recV += 1; }

  // st: { speed, mx, mz, stance, aimYaw (мир), aimPitch, aiming, dead, reload (0..1 или −1), shock }
  update(dt, st) {
    const lib = this.rig.lib, rig = this.rig;
    this.time += dt;
    const k8 = 1 - Math.exp(-8 * dt);
    const tS = st.stance === 'stand' ? 1 : 0, tC = st.stance === 'crouch' ? 1 : 0, tP = st.stance === 'prone' ? 1 : 0;
    this.wS += (tS - this.wS) * k8 * 0.8; this.wC += (tC - this.wC) * k8 * 0.8; this.wP += (tP - this.wP) * k8 * 0.6;
    const sum = this.wS + this.wC + this.wP; this.wS /= sum; this.wC /= sum; this.wP /= sum;
    this.spd = smooth(this.spd, st.speed || 0, 7, dt);
    const sp = this.spd;
    const reloadOn = st.reload >= 0;
    const aiming = (!!st.aiming || this.fireT < 0.6) && !reloadOn;
    this.aimW = smooth(this.aimW, aiming ? 1 : 0, 6, dt);
    this.fireT += dt; this.hitT += dt;
    // направление шага относительно корпуса
    let ang = 0, back = false;
    if ((st.speed || 0) > 0.2) { ang = Math.atan2(st.mx || 0, -(st.mz ?? -1)); back = Math.abs(ang) > 1.95; }
    const legT = (st.speed || 0) > 0.2 ? clamp(back ? wrap(ang - Math.PI * Math.sign(ang)) : ang, -1.0, 1.0) : 0;
    this.legYaw = smooth(this.legYaw, legT * (1 - this.wP), 6, dt);
    if ((st.speed || 0) > 0.2) this.dirSign = back ? -1 : 1;
    rig.resetAcc();
    const acc = rig.accQ, accP = rig.accP;
    const C = lib.clips;
    const b = rig.b;

    // ---- гибель ----
    if (st.dead) {
      if (this.deadT < 0) {
        this.deadT = 0;
        this.deadProne = this.wP > 0.5;
        this.deathClip = C.get(DEATHS[(Math.random() * DEATHS.length) | 0]);
      }
      this.deadT += dt;
      if (this.deadProne) {
        lib.prone(this.pose, this.poseP, 0, 0);
        lib.add(this.pose, this.poseP, 1, acc, accP, null);
        lib.sample(this.deathClip, this.deathClip.dur - 0.01, 2, acc, null, lib.armsMask);
      } else lib.sample(this.deathClip, Math.min(this.deadT, this.deathClip.dur - 0.01), 1, acc, accP, null);
      rig.applyPose();
      this.root.updateMatrixWorld(true);
      this._dropGun(dt, st);
      return;
    }

    // ---- нижний слой: передвижение ----
    const sets = [];
    if (this.wS > 0.01) {
      const idle = C.get(aiming ? 'Rifle_Aiming_Idle' : 'Rifle_Idle');
      const walk = C.get(this.aimW > 0.5 ? 'Walking_While_Aiming_Rifle' : 'Rifle_Walk'), run = C.get('Rifle_Run');
      const mw = clamp(sp / 0.5, 0, 1), rw = clamp((sp - walk.speed * 1.15) / (run.speed * 0.75 - walk.speed * 1.15), 0, 1);
      sets.push([idle, this.wS * (1 - mw), 'idle', idle], [walk, this.wS * mw * (1 - rw), 'loop', walk], [run, this.wS * mw * rw, 'loop', run]);
    }
    if (this.wC > 0.01) {
      const kneel = C.get('Idle_Crouching'), walk = C.get(this.aimW > 0.5 ? 'Firing_Rifle_Crouch_Walking' : 'Rifle_Crouch_Walk'), run = C.get('Crouched_Walking');
      const relaxedUp = C.get('Rifle_Crouch_Walk');
      const mw = clamp(sp / 0.35, 0, 1), rw = clamp((sp - walk.speed * 1.1) / (run.speed - walk.speed * 1.1), 0, 1);
      sets.push([kneel, this.wC * (1 - mw), 'idle', relaxedUp], [walk, this.wC * mw * (1 - rw), 'loop', walk], [run, this.wC * mw * rw, 'loop', relaxedUp]);
    }
    // фаза: шаг цикла по пройденному пути
    let stride = 0, sw = 0;
    for (const [c, w, mode] of sets) if (mode === 'loop' && w > 0) { stride += w * c.speed * c.dur; sw += w; }
    if (sw > 0.01) this.phase += (dt * Math.max(sp, 0.25) / (stride / sw)) * this.dirSign;
    if (this.wP > 0.5 && sp > 0.1) this.phase += dt * sp / 0.9;
    this.phase -= Math.floor(this.phase);
    this.idleT += dt;
    const tOf = (c, mode) => (mode === 'loop' ? ((this.phase + c.phase0) % 1) * c.dur : mode === 'freeze' ? c.phase0 * c.dur : this.idleT % c.dur);
    for (const [c, w, mode] of sets) lib.sample(c, tOf(c, mode), w, acc, accP, lib.lower);
    if (this.wP > 0.01) {
      lib.prone(this.pose, this.poseP, clamp(sp / 0.3, 0, 1), this.phase);
      lib.add(this.pose, this.poseP, this.wP, acc, accP, lib.lower);
    }

    // ---- верхний слой ----
    const up = lib.upper;
    this.reloadW = smooth(this.reloadW, reloadOn ? 1 : 0, 8, dt);
    const rest = 1 - this.reloadW;
    for (const [c, w, mode, uc] of sets) {
      if (w <= 0) continue;
      lib.sample(uc, tOf(uc, mode === 'idle' && uc !== c ? 'freeze' : mode), w * rest * (1 - this.aimW), acc, null, up);
    }
    const moving = clamp(sp / 0.6, 0, 1);
    if (this.aimW > 0.01) {
      const aimIdle = C.get('Rifle_Aiming_Idle'), aimWalk = this.wC > 0.5 ? C.get('Firing_Rifle_Crouch_Walking') : C.get('Walking_While_Aiming_Rifle');
      const ws = (this.wS + this.wC) * rest * this.aimW;
      lib.sample(aimIdle, this.idleT % aimIdle.dur, ws * (1 - moving), acc, null, up);
      lib.sample(aimWalk, ((this.phase + aimWalk.phase0) % 1) * aimWalk.dur, ws * moving, acc, null, up);
    }
    if (this.wP > 0.01) {
      // лёжа: корпус и голова из позы, руки потом ставятся на оружие
      lib.add(this.pose, this.poseP, this.wP * rest, acc, null, lib.spineMask);
      lib.sample(C.get('Rifle_Aiming_Idle'), 0, this.wP * rest, acc, null, lib.armsMask);
    }
    if (this.reloadW > 0.01) {
      const rc = C.get(sp > 0.6 && this.wS > 0.5 ? 'Reloading_Walking' : 'Reloading_Rifle');
      const prog = reloadOn ? st.reload : 1;
      lib.sample(rc, clamp(prog, 0, 1) * rc.dur * 0.98, this.reloadW, acc, null, this.wP > 0.5 ? lib.armsMask : up);
    }
    // выстрел: короткий клип с отдачей поверх
    const fc = C.get('Firing_Rifle');
    if (this.fireT < fc.dur && this.wP < 0.5) lib.sample(fc, this.fireT, 0.9 * (1 - this.fireT / fc.dur) * rest, acc, null, lib.noFingersUpper);
    const hc = C.get('Hit_Reaction');
    if (this.hitT < hc.dur && this.wP < 0.5) lib.sample(hc, this.hitT, 0.8 * (1 - this.hitT / hc.dur), acc, null, up);
    rig.applyPose();

    // ---- разворот ног по направлению шага, корпус остаётся на цель ----
    const ly = this.legYaw;
    if (Math.abs(ly) > 1e-3) b.Hips.quaternion.premultiply(_q.setFromAxisAngle(UP, -ly));
    this.root.updateMatrixWorld(true);
    if (Math.abs(ly) > 1e-3) {
      rig.rotateWorld(b.Spine, _q.setFromAxisAngle(UP, ly * 0.5));
      rig.rotateWorld(b.Spine1, _q.setFromAxisAngle(UP, ly * 0.5));
    }
    if (!this.gun) return;

    // ---- доворот корпуса: ствол — в точку прицеливания ----
    const Dv = _v4.set(-Math.sin(st.aimYaw) * Math.cos(st.aimPitch), Math.sin(st.aimPitch), -Math.cos(st.aimYaw) * Math.cos(st.aimPitch)).clone();
    const standW = 1 - this.wP;
    const yawW = (0.55 + 0.45 * this.aimW) * standW;
    const pitchW = this.aimW * (1 - this.reloadW * 0.8) * standW;
    for (let it = 0; it < 2 && standW > 0.01; it++) {
      this._gunMatrix();
      const F = new THREE.Vector3(0, 0, -1).transformDirection(this.gunWorld);
      const eY = wrap(Math.atan2(-Dv.x, -Dv.z) - Math.atan2(-F.x, -F.z)) * yawW;
      const eP = (Math.asin(clamp(Dv.y, -1, 1)) - Math.asin(clamp(F.y, -1, 1))) * pitchW;
      if (Math.abs(eY) < 1e-4 && Math.abs(eP) < 1e-4) break;
      const axP = new THREE.Vector3().crossVectors(F, UP);
      if (axP.lengthSq() < 1e-6) axP.set(1, 0, 0);
      axP.normalize();
      const R = new THREE.Quaternion().setFromAxisAngle(UP, clamp(eY, -1.2, 1.2)).multiply(new THREE.Quaternion().setFromAxisAngle(axP, clamp(eP, -1.2, 1.2)));
      const half = new THREE.Quaternion().slerp(R, 0.45);
      rig.rotateWorld(b.Spine1, half);
      rig.rotateWorld(b.Spine2, half.invert().multiply(R));
    }
    // отдача корпуса
    this.recV += (-this.rec * 180 - this.recV * 16) * dt;
    this.rec += this.recV * dt;
    if (Math.abs(this.rec) > 1e-4 && standW > 0.01) {
      const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(this.root.quaternion);
      rig.rotateWorld(b.Spine2, _q.setFromAxisAngle(ax, -this.rec * 0.035 * standW));
    }
    this._gunMatrix();
    // лёжа: оружие прикладом в плечо, обе руки — на оружие
    if (this.wP > 0.01) this._proneGun(Dv, sp);
    if (Math.abs(this.rec) > 1e-4) this.gunWorld.multiply(_m.makeTranslation(0, this.rec * 0.004, this.rec * 0.018));
    if (this.wP > 0.5) this._arm('Right', this.gun.gripR, this.gripHandQ('Right'), 1);
    // левая рука на цевьё
    const lw = 1 - this.reloadW;
    this.lhW = smooth(this.lhW, lw, 10, dt);
    if (this.lhW > 0.02) this._arm('Left', this.gun.gripL, this.gripHandQ('Left'), this.lhW);
    // голова: при прицеливании — на прицел, иначе в сторону цели
    if (this.aimW < 0.9 && standW > 0.5) {
      const hq = b.Head.getWorldQuaternion(new THREE.Quaternion());
      const hf = new THREE.Vector3(0, 0, 1).applyQuaternion(hq);
      const eY = clamp(wrap(Math.atan2(-Dv.x, -Dv.z) - Math.atan2(-hf.x, -hf.z)), -1, 1) * (1 - this.aimW) * 0.8;
      const eP = clamp(Math.asin(clamp(Dv.y, -1, 1)) - Math.asin(clamp(hf.y, -1, 1)), -0.6, 0.6) * (1 - this.aimW) * 0.7;
      const axP = new THREE.Vector3().crossVectors(hf, UP).normalize();
      const R = new THREE.Quaternion().setFromAxisAngle(UP, eY).multiply(new THREE.Quaternion().setFromAxisAngle(axP, eP));
      const half = new THREE.Quaternion().slerp(R, 0.5);
      rig.rotateWorld(b.Neck, half);
      rig.rotateWorld(b.Head, half);
    }
    // оружие: матрица относительно root
    _m.copy(this.root.matrixWorld).invert().multiply(this.gunWorld);
    this.gun.object.matrix.copy(_m);
    this.gun.object.matrixWorldNeedsUpdate = true;
    this.gun.object.visible = true;
  }

  // Поворот кисти, держащей оружие (из калибровочной позы)
  gripHandQ(side) {
    const gq = _q3.setFromRotationMatrix(_m.extractRotation(this.gunWorld));
    return side === 'Right' ? gq.clone().multiply(this.grip.quat.clone().invert()) : gq.clone().multiply(this.grip.lq);
  }

  // Оружие лёжа: затыльник приклада у правого плеча, ствол — по направлению прицеливания
  _proneGun(D, sp) {
    const b = this.rig.b;
    const rs = b.RightArm.getWorldPosition(new THREE.Vector3()), ls = b.LeftArm.getWorldPosition(new THREE.Vector3());
    const right = rs.clone().sub(ls).normalize();
    const fwd = D.clone();
    const upv = new THREE.Vector3().crossVectors(right, fwd).normalize();
    if (upv.y < 0) upv.negate();
    const k = this.rig.heightK * this.root.scale.x;
    const crawl = clamp(sp / 0.3, 0, 1);
    const pocket = rs.addScaledVector(right, -0.055 * k).addScaledVector(fwd, (0.02 - crawl * 0.25) * k).addScaledVector(upv, (-0.01 - crawl * 0.06) * k);
    const z = fwd.clone().negate(), x = new THREE.Vector3().crossVectors(upv, z).normalize(), y = new THREE.Vector3().crossVectors(z, x);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    const p = pocket.sub(this.gun.butt.clone().multiplyScalar(this.root.scale.x).applyQuaternion(q));
    const M = new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1).multiplyScalar(this.root.scale.x));
    const w = clamp((this.wP - 0.3) / 0.6, 0, 1);
    if (w >= 0.999) this.gunWorld.copy(M);
    else {
      const p0 = new THREE.Vector3(), q0 = new THREE.Quaternion(), s0 = new THREE.Vector3();
      this.gunWorld.decompose(p0, q0, s0);
      this.gunWorld.compose(p0.lerp(p, w), q0.slerp(q, w), s0);
    }
  }

  // IK руки на точку хвата оружия
  _arm(side, gripLocal, handQ, w) {
    const rig = this.rig, b = rig.b;
    const target = gripLocal.clone().applyMatrix4(this.gunWorld);
    const k = rig.heightK * this.root.scale.x;
    const wrist = target.sub(new THREE.Vector3(0, 0.05, 0.022).multiplyScalar(k).applyQuaternion(handQ));
    const hand = b[side + 'Hand'], fore = b[side + 'ForeArm'], arm = b[side + 'Arm'];
    if (w < 0.999) wrist.lerp(hand.getWorldPosition(new THREE.Vector3()), 1 - w);
    const sh = arm.getWorldPosition(new THREE.Vector3()), el = fore.getWorldPosition(new THREE.Vector3());
    const pole = el.sub(sh).normalize().add(new THREE.Vector3(0, -0.4 - this.wP * 1.5, 0)).normalize();
    rig.ik(arm, fore, hand, wrist, pole, rig.len.upper * k, rig.len.fore * k);
    const cq = hand.getWorldQuaternion(new THREE.Quaternion());
    rig.setWorldQuat(hand, cq.slerp(handQ, w));
  }

  // Мировая матрица оружия от правой кисти
  _gunMatrix() {
    const h = this.rig.b.RightHand;
    h.updateWorldMatrix(true, false);
    h.matrixWorld.decompose(_v, _q, _s);
    const g = this.grip;
    const k = this.rig.heightK * this.root.scale.x;
    _v2.copy(g.pos).multiplyScalar(k * this.rig.lib.hipsRestY).applyQuaternion(_q).add(_v);
    _q2.copy(_q).multiply(g.quat);
    this.gunWorld.compose(_v2, _q2, _s.set(1, 1, 1).multiplyScalar(this.root.scale.x));
    return this.gunWorld;
  }

  _dropGun(dt, st) {
    if (!this.gun) return;
    const o = this.gun.object;
    if (!this.gunDrop) {
      this._gunMatrix();
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      this.gunWorld.decompose(p, q, s);
      this.gunDrop = { p, q, v: new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.6, (Math.random() - 0.5) * 1.2), w: new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 6), rest: false, s };
    }
    const d = this.gunDrop;
    if (!d.rest) {
      d.v.y -= 9.8 * dt;
      d.p.addScaledVector(d.v, dt);
      _q.setFromEuler(new THREE.Euler(d.w.x * dt, d.w.y * dt, d.w.z * dt));
      d.q.premultiply(_q);
      const gy = (st.groundY !== undefined ? st.groundY : this.root.position.y) + 0.04;
      if (d.p.y < gy) {
        d.p.y = gy; d.rest = true;
        // лечь на бок: ствол горизонтально, правый бок вверх
        const f = new THREE.Vector3(0, 0, -1).applyQuaternion(d.q); f.y = 0;
        if (f.lengthSq() < 1e-4) f.set(1, 0, 0);
        f.normalize();
        const z = f.clone().negate(), x = new THREE.Vector3(0, 1, 0), y = new THREE.Vector3().crossVectors(z, x);
        d.q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
      }
    }
    this.gunWorld.compose(d.p, d.q, d.s);
    _m.copy(this.root.matrixWorld).invert().multiply(this.gunWorld);
    o.matrix.copy(_m); o.matrixWorldNeedsUpdate = true;
  }

  muzzleWorld(out) {
    if (!this.gun) return out.set(0, 1.4, -0.5).applyMatrix4(this.root.matrixWorld);
    return out.copy(this.gun.muzzle).applyMatrix4(this.gunWorld);
  }

  // Хитбоксы по костям (мир)
  hitboxes(out) {
    const b = this.rig.b;
    const k = this.rig.heightK * this.root.scale.x;
    if (out.length < 9) for (let i = out.length; i < 9; i++) out.push({ a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0, zone: '' });
    const W = (n, o) => b[n].getWorldPosition(o);
    W('Head', out[0].a); out[0].a.add(_v.set(0, 0.085 * k, 0.02 * k).applyQuaternion(b.Head.getWorldQuaternion(_q))); out[0].b.copy(out[0].a); out[0].r = 0.115 * k; out[0].zone = 'head';
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

// ---------- персонаж, проигрывающий один клип (штаб, массовка) ----------
export class ClipActor {
  constructor(kind, clipName, { t0 = Math.random() * 10, speed = 1 } = {}) {
    this.rig = new CharRig(kind);
    this.root = new THREE.Group();
    this.root.add(this.rig.holder);
    this.clip = this.rig.lib.clips.get(clipName) || this.rig.lib.clips.get('Standing_Idle');
    this.t = t0; this.speed = speed;
    this.update(0);
  }
  play(name) { const c = this.rig.lib.clips.get(name); if (c) { this.clip = c; this.t = 0; } }
  update(dt) {
    const rig = this.rig;
    this.t += dt * this.speed;
    rig.resetAcc();
    rig.lib.sample(this.clip, this.clip.loop ? this.t : this.t % this.clip.dur, 1, rig.accQ, rig.accP, null);
    rig.applyPose();
  }
}
