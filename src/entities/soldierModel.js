// Процедурная модель бойца: скелет из опорных точек + двухзвенная IK для рук/ног.
// Позы: стоя, присев, лёжа, гибель. Хитбоксы считаются из тех же точек.
import * as THREE from 'three';
import { camoTexture } from '../world/textures.js';
import { clamp, lerp } from '../core/math.js';

const FACTIONS = {
  negs: { camo: ['#e9edf0', '#c6ced6', '#a9b3bc', '#f7f9fa'], vest: 0x9aa3a9, helmet: 0xd9dee2, face: 0xc8cdd2, pack: 0xb2bac0, glove: 0x3b3d40, boot: 0x2a2b2d, band: null, goggles: true },
  denter: { camo: ['#3c3f39', '#2a2c29', '#55594d', '#1e1f1d'], vest: 0x2c2d29, helmet: 0x26282a, face: 0x161616, pack: 0x34362f, glove: 0x1d1d1d, boot: 0x1a1a1a, band: 0xa01818, goggles: false },
  krandi: { camo: ['#181818', '#121212', '#202020', '#0e0e0e'], vest: 0x1a1a1a, helmet: null, face: 0xc89c80, pack: null, glove: 0x111111, boot: 0x101010, band: 0x8a0c0c, goggles: false, coat: true },
  officer: { camo: ['#56604a', '#4a5340', '#626d54', '#3f4737'], vest: 0x4c5544, helmet: null, face: 0xd6b096, pack: null, glove: 0x2a2a2a, boot: 0x1a1a1a, band: null, goggles: false, cap: true },
};

const matCache = new Map();
function mats(fid) {
  if (matCache.has(fid)) return matCache.get(fid);
  const f = FACTIONS[fid];
  const m = {
    uniform: new THREE.MeshStandardMaterial({ map: camoTexture(f.camo, fid + 'uni', 4), roughness: 0.95 }),
    vest: new THREE.MeshStandardMaterial({ color: f.vest, roughness: 0.9 }),
    helmet: f.helmet !== null ? new THREE.MeshStandardMaterial({ color: f.helmet, roughness: 0.8 }) : null,
    face: new THREE.MeshStandardMaterial({ color: f.face, roughness: 0.9 }),
    pack: f.pack !== null ? new THREE.MeshStandardMaterial({ color: f.pack, roughness: 0.95 }) : null,
    glove: new THREE.MeshStandardMaterial({ color: f.glove, roughness: 0.8 }),
    boot: new THREE.MeshStandardMaterial({ color: f.boot, roughness: 0.7 }),
    band: f.band !== null ? new THREE.MeshStandardMaterial({ color: f.band, roughness: 0.8 }) : null,
    goggles: new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.15, metalness: 0.6 }),
    gun: new THREE.MeshStandardMaterial({ color: 0x1d1e20, roughness: 0.5, metalness: 0.6 }),
    gunWood: new THREE.MeshStandardMaterial({ color: 0x5a3018, roughness: 0.6 }),
    tube: new THREE.MeshStandardMaterial({ color: 0x3d4a2f, roughness: 0.7, metalness: 0.2 }),
  };
  matCache.set(fid, m);
  return m;
}

const G = {
  limb: new THREE.CapsuleGeometry(1, 1, 3, 8),
  sphere: new THREE.SphereGeometry(1, 14, 10),
  half: new THREE.SphereGeometry(1, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2),
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
};

function mesh(geo, mat, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  return m;
}

// Оружие от третьего лица: приклад в начале координат, ствол по -Z
export function buildThirdPersonWeapon(kind, mm) {
  const g = new THREE.Group();
  const add = (geo, mat, sx, sy, sz, x, y, z, rx = 0) => {
    const m = mesh(geo, mat, sx, sy, sz); m.position.set(x, y, z); m.rotation.x = rx; g.add(m); return m;
  };
  if (kind === 'rpg') {
    add(G.cyl, mm.tube, 0.022, 0.95, 0.022, 0, 0, -0.35, Math.PI / 2);
    add(G.cyl, mm.tube, 0.045, 0.32, 0.045, 0, 0, -0.98, Math.PI / 2);
    add(G.sphere, mm.tube, 0.045, 0.045, 0.1, 0, 0, -1.16);
    add(G.box, mm.gun, 0.03, 0.1, 0.04, 0, -0.07, -0.25);
    return g;
  }
  const long = kind === 'svd' ? 1.2 : kind === 'pkm' ? 1.15 : 0.92;
  add(G.box, kind === 'svd' || kind === 'akm' ? mm.gunWood : mm.gun, 0.04, 0.09, 0.28, 0, -0.03, -0.12);
  add(G.box, mm.gun, 0.05, 0.08, 0.34, 0, 0, -0.42);
  add(G.cyl, mm.gun, 0.011, long - 0.55, 0.011, 0, 0.01, -0.58 - (long - 0.55) / 2, Math.PI / 2);
  if (kind === 'pkm') {
    add(G.box, mm.gun, 0.09, 0.12, 0.12, 0.06, -0.08, -0.42);
  } else if (kind !== 'svd') {
    add(G.box, mm.gun, 0.03, 0.2, 0.07, 0, -0.13, -0.42, 0.35);
  } else {
    add(G.box, mm.gun, 0.03, 0.12, 0.06, 0, -0.09, -0.42, 0.2);
    add(G.cyl, mm.gun, 0.02, 0.3, 0.02, 0, 0.07, -0.42, Math.PI / 2);
  }
  return g;
}

const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpU = new THREE.Vector3(), tmpW = new THREE.Vector3();
const _rz90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
const UP = new THREE.Vector3(0, 1, 0);

function solveIK(S, T, a, b, pole, outE, outT) {
  tmpU.subVectors(T, S);
  let L = tmpU.length();
  if (L < 1e-5) { tmpU.set(0, -1, 0); L = 0.01; } else tmpU.divideScalar(L);
  const Lc = clamp(L, 0.05, a + b - 0.002);
  const cosA = clamp((a * a + Lc * Lc - b * b) / (2 * a * Lc), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  tmpW.copy(pole).addScaledVector(tmpU, -pole.dot(tmpU));
  if (tmpW.lengthSq() < 1e-6) tmpW.set(0, 0, -1);
  tmpW.normalize();
  outE.copy(S).addScaledVector(tmpU, a * cosA).addScaledVector(tmpW, a * sinA);
  outT.copy(S).addScaledVector(tmpU, Lc);
}

function placeLimb(m, A, B, r) {
  tmpA.subVectors(B, A);
  const len = tmpA.length();
  m.position.addVectors(A, B).multiplyScalar(0.5);
  if (len > 1e-5) m.quaternion.setFromUnitVectors(UP, tmpA.divideScalar(len));
  // CapsuleGeometry(1,1) имеет полную высоту 3 → масштаб по Y = len/3
  m.scale.set(r, Math.max(0.01, len / 3), r);
}

export class SoldierModel {
  constructor(faction = 'negs', weaponKind = 'ak', { scale = 1 } = {}) {
    this.faction = faction;
    this.mm = mats(faction);
    const mm = this.mm;
    const f = FACTIONS[faction];
    this.root = new THREE.Group();
    this.root.scale.setScalar(scale);
    this.scale = scale;
    const R = this.root;
    this.torso = mesh(G.limb, mm.uniform, 0.175, 0.2, 0.115); R.add(this.torso);
    // разгрузка: плиты + подсумки
    this.vest = new THREE.Group(); R.add(this.vest);
    const vb = (w, h, d, x, y, z) => { const v = mesh(G.box, mm.vest, w, h, d); v.position.set(x, y, z); this.vest.add(v); return v; };
    vb(0.34, 0.3, 0.05, 0, 0, -0.12); vb(0.34, 0.32, 0.05, 0, 0.01, 0.12);
    for (const x of [-0.11, 0, 0.11]) vb(0.085, 0.11, 0.06, x, -0.07, -0.165);
    vb(0.06, 0.1, 0.05, 0.13, 0.08, -0.16);
    this.pelvis = mesh(G.limb, mm.uniform, 0.1, 0.113, 0.11); this.pelvis.rotation.z = Math.PI / 2; R.add(this.pelvis);
    this.belt = mesh(G.box, mm.vest, 0.34, 0.06, 0.24); R.add(this.belt);
    this.pack = mm.pack ? mesh(G.box, mm.pack, 0.27, 0.34, 0.14) : null; if (this.pack) R.add(this.pack);
    this.neck = mesh(G.cyl, mm.face, 0.055, 0.1, 0.055); R.add(this.neck);
    this.head = mesh(G.sphere, mm.face, 0.095, 0.115, 0.105); R.add(this.head);
    this.helmet = mm.helmet ? mesh(G.half, mm.helmet, 0.122, 0.12, 0.13) : null; if (this.helmet) R.add(this.helmet);
    this.goggles = f.goggles ? mesh(G.box, mm.goggles, 0.16, 0.04, 0.04) : null; if (this.goggles) R.add(this.goggles);
    if (f.cap) { this.helmet = mesh(G.cyl, mm.vest, 0.12, 0.07, 0.13); R.add(this.helmet); }
    if (f.coat) {
      this.coat = mesh(new THREE.CylinderGeometry(0.2, 0.34, 0.75, 12, 1, true), mm.uniform);
      this.coat.material = mm.uniform.clone(); this.coat.material.side = THREE.DoubleSide;
      R.add(this.coat);
      this.scarf = mesh(G.cyl, mm.band, 0.12, 0.08, 0.12); R.add(this.scarf);
    }
    this.uArmL = mesh(G.limb, mm.uniform); this.uArmR = mesh(G.limb, mm.uniform);
    this.fArmL = mesh(G.limb, mm.uniform); this.fArmR = mesh(G.limb, mm.uniform);
    this.handL = mesh(G.sphere, mm.glove, 0.05, 0.05, 0.06); this.handR = mesh(G.sphere, mm.glove, 0.05, 0.05, 0.06);
    this.thighL = mesh(G.limb, mm.uniform); this.thighR = mesh(G.limb, mm.uniform);
    this.shinL = mesh(G.limb, mm.uniform); this.shinR = mesh(G.limb, mm.uniform);
    this.bootL = mesh(G.box, mm.boot, 0.11, 0.1, 0.26); this.bootR = mesh(G.box, mm.boot, 0.11, 0.1, 0.26);
    R.add(this.uArmL, this.uArmR, this.fArmL, this.fArmR, this.handL, this.handR, this.thighL, this.thighR, this.shinL, this.shinR, this.bootL, this.bootR);
    if (mm.band) { this.band = mesh(G.cyl, mm.band, 0.062, 0.07, 0.062); R.add(this.band); }
    this.weaponKind = weaponKind;
    this.weapon = buildThirdPersonWeapon(weaponKind, mm);
    R.add(this.weapon);

    // опорные точки (в системе root)
    this.P = {
      H: new THREE.Vector3(), N: new THREE.Vector3(), head: new THREE.Vector3(),
      shL: new THREE.Vector3(), shR: new THREE.Vector3(), elL: new THREE.Vector3(), elR: new THREE.Vector3(),
      hdL: new THREE.Vector3(), hdR: new THREE.Vector3(),
      hpL: new THREE.Vector3(), hpR: new THREE.Vector3(), knL: new THREE.Vector3(), knR: new THREE.Vector3(),
      anL: new THREE.Vector3(), anR: new THREE.Vector3(), wO: new THREE.Vector3(), wD: new THREE.Vector3(),
    };
    this.phase = Math.random() * 6;
    this.wStand = 1; this.wCrouch = 0; this.wProne = 0;
    this.deadT = -1; this.deadDir = 1;
    this.kick = 0;
    this._tmp = { s: new THREE.Vector3(), r: new THREE.Vector3(), b: new THREE.Vector3(), m: new THREE.Matrix4(), q: new THREE.Quaternion() };
  }

  // st: { speed, mx, mz (лок. направление движения), stance, aimPitch, aiming, dead, dt }
  update(dt, st) {
    const P = this.P;
    const tS = st.stance === 'stand' ? 1 : 0, tC = st.stance === 'crouch' ? 1 : 0, tP = st.stance === 'prone' ? 1 : 0;
    const k = 1 - Math.exp(-8 * dt);
    this.wStand += (tS - this.wStand) * k; this.wCrouch += (tC - this.wCrouch) * k; this.wProne += (tP - this.wProne) * k;
    const wS = this.wStand, wC = this.wCrouch, wP = this.wProne;
    const sp = st.speed || 0;
    this.phase += dt * sp * (wP > 0.5 ? 2.2 : 3.4);
    const ph = this.phase;
    const bob = Math.abs(Math.sin(ph)) * 0.035 * Math.min(1, sp / 2) * wS;
    // таз и шея
    P.H.set(0, 0.98 * wS + 0.6 * wC + 0.17 * wP + bob, 0.0 * wS + 0.08 * wC + 0.45 * wP);
    const lean = st.aiming ? 0.06 : 0.02;
    P.N.set(P.H.x, P.H.y + 0.5 * wS + 0.42 * wC + 0.08 * wP, P.H.z - lean * wS - 0.17 * wC - 0.52 * wP);
    // смерть: плавно укладываем тело
    let dw = 0;
    if (st.dead) {
      if (this.deadT < 0) { this.deadT = 0; this.deadDir = Math.random() > 0.5 ? 1 : -1; }
      this.deadT += dt;
      dw = clamp(this.deadT / 0.75, 0, 1);
      dw = dw * dw;
      const Hd = new THREE.Vector3(0, 0.12, 0.3 * this.deadDir), Nd = new THREE.Vector3(0.1 * this.deadDir, 0.14, -0.3 * this.deadDir);
      P.H.lerp(Hd, dw); P.N.lerp(Nd, dw);
    }
    const s = this._tmp.s.subVectors(P.N, P.H).normalize();
    // базис туловища
    const back = this._tmp.b.set(0, wP * 0.9 + dw * 0.9, 1 - wP * 0.9 - dw * 0.9).normalize();
    if (dw > 0.5 && this.deadDir < 0) back.y = -back.y;
    back.addScaledVector(s, -back.dot(s)).normalize();
    const right = this._tmp.r.crossVectors(s, back).normalize();
    this._tmp.m.makeBasis(right, s, back);
    const q = this._tmp.q.setFromRotationMatrix(this._tmp.m);

    const place = (m, along, side, fwd, local) => {
      m.position.copy(P.H).addScaledVector(s, along).addScaledVector(right, side).addScaledVector(back, -fwd);
      m.quaternion.copy(q);
      if (local) m.quaternion.multiply(local);
    };
    place(this.pelvis, 0.02, 0, 0, _rz90);
    place(this.belt, 0.07, 0, 0);
    place(this.torso, 0.27, 0, 0);
    place(this.vest, 0.3, 0, 0.0);
    if (this.pack) place(this.pack, 0.3, 0, -0.21);
    place(this.neck, 0.52, 0, 0);
    if (this.coat) { place(this.coat, -0.1, 0, 0); this.coat.visible = !st.dead || dw < 1; }
    // голова
    P.head.copy(P.N).addScaledVector(s, 0.16).addScaledVector(back, -0.02);
    this.head.position.copy(P.head);
    const headQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (st.aimPitch || 0) * 0.7 * (1 - dw) + wP * 1.2 * (1 - dw));
    this.head.quaternion.copy(q).multiply(headQ);
    if (this.helmet) { this.helmet.quaternion.copy(this.head.quaternion); this.helmet.position.copy(P.head).add(new THREE.Vector3(0, 0.02, 0.005).applyQuaternion(this.head.quaternion)); }
    if (this.goggles) {
      this.goggles.quaternion.copy(this.head.quaternion);
      this.goggles.position.copy(P.head).add(new THREE.Vector3(0, 0.07, -0.1).applyQuaternion(this.head.quaternion));
    }
    if (this.scarf) { this.scarf.position.copy(P.N).addScaledVector(s, 0.03); this.scarf.quaternion.copy(q); }

    // ноги
    P.hpL.copy(P.H).addScaledVector(right, -0.1).addScaledVector(s, -0.05);
    P.hpR.copy(P.H).addScaledVector(right, 0.1).addScaledVector(s, -0.05);
    const mx = st.mx || 0, mz = st.mz || 0;
    const stride = Math.min(0.5, sp * 0.2) * (wS + wC * 0.6);
    const sL = Math.sin(ph), sR = Math.sin(ph + Math.PI);
    const liftL = Math.max(0, Math.cos(ph)) * 0.16 * Math.min(1, sp), liftR = Math.max(0, Math.cos(ph + Math.PI)) * 0.16 * Math.min(1, sp);
    const fL = new THREE.Vector3(
      -0.12 * wS - 0.16 * wC - 0.22 * wP + mx * sL * stride,
      0.08 * (wS + wC) + 0.08 * wP + liftL * (wS + wC),
      0 * wS - 0.22 * wC + 1.32 * wP + mz * sL * stride + Math.sin(ph) * 0.1 * wP * Math.min(1, sp),
    );
    const fR = new THREE.Vector3(
      0.12 * wS + 0.16 * wC + 0.22 * wP + mx * sR * stride,
      0.08 * (wS + wC) + 0.08 * wP + liftR * (wS + wC),
      0 * wS + 0.35 * wC + 1.3 * wP + mz * sR * stride - Math.sin(ph) * 0.1 * wP * Math.min(1, sp),
    );
    if (dw > 0) {
      fL.lerp(new THREE.Vector3(-0.25, 0.1, P.H.z + 0.95 * this.deadDir), dw);
      fR.lerp(new THREE.Vector3(0.2, 0.1, P.H.z + 0.9 * this.deadDir), dw);
    }
    const kneePole = new THREE.Vector3(0, -wP - dw * 0.8, -(1 - wP) * (1 - dw) + 0.01).normalize();
    solveIK(P.hpL, fL, 0.45, 0.45, kneePole, P.knL, P.anL);
    solveIK(P.hpR, fR, 0.45, 0.45, kneePole, P.knR, P.anR);
    placeLimb(this.thighL, P.hpL, P.knL, 0.085); placeLimb(this.thighR, P.hpR, P.knR, 0.085);
    placeLimb(this.shinL, P.knL, P.anL, 0.07); placeLimb(this.shinR, P.knR, P.anR, 0.07);
    for (const [boot, an, kn] of [[this.bootL, P.anL, P.knL], [this.bootR, P.anR, P.knR]]) {
      tmpA.subVectors(an, kn).normalize();
      const fw = new THREE.Vector3(0, 0, -1).addScaledVector(tmpA, -tmpA.z * -1);
      const look = new THREE.Matrix4().lookAt(new THREE.Vector3(), fw.lengthSq() > 0.01 ? fw : new THREE.Vector3(0, 0, -1), tmpA.clone().negate());
      boot.quaternion.setFromRotationMatrix(look);
      boot.position.copy(an).add(new THREE.Vector3(0, -0.03, -0.06).applyQuaternion(boot.quaternion));
    }

    // руки и оружие
    P.shL.copy(P.N).addScaledVector(right, -0.2).addScaledVector(s, -0.05);
    P.shR.copy(P.N).addScaledVector(right, 0.2).addScaledVector(s, -0.05);
    this.kick = Math.max(0, this.kick - dt * 12);
    const pitch = (st.aimPitch || 0);
    const aimW = st.aiming ? 1 : 0;
    // направление оружия
    const ready = 0.55 * (1 - aimW) * (1 - wP);
    const wp = pitch * (0.4 + 0.6 * aimW) - ready;
    P.wD.set(0, Math.sin(wp), -Math.cos(wp));
    if (this.weaponKind === 'rpg') {
      P.wO.copy(P.shR).addScaledVector(s, 0.12).addScaledVector(right, -0.08).addScaledVector(P.wD, -0.45);
    } else {
      P.wO.copy(P.shR).addScaledVector(right, -0.06).addScaledVector(s, -0.02 - ready * 0.25).addScaledVector(P.wD, 0.02 + this.kick * 0.04);
    }
    const down = new THREE.Vector3().crossVectors(P.wD, right).normalize();
    if (this.weaponKind === 'rpg') {
      P.hdR.copy(P.wO).addScaledVector(P.wD, 0.55).addScaledVector(down, 0.1);
      P.hdL.copy(P.wO).addScaledVector(P.wD, 0.85).addScaledVector(down, 0.05);
    } else {
      P.hdR.copy(P.wO).addScaledVector(P.wD, 0.22).addScaledVector(down, 0.08);
      P.hdL.copy(P.wO).addScaledVector(P.wD, this.weaponKind === 'pkm' ? 0.55 : 0.5).addScaledVector(down, 0.04);
    }
    if (dw > 0) {
      P.hdL.lerp(new THREE.Vector3().copy(P.shL).addScaledVector(right, -0.35).addScaledVector(s, 0.2), dw);
      P.hdR.lerp(new THREE.Vector3().copy(P.shR).addScaledVector(right, 0.35).addScaledVector(s, -0.1), dw);
    }
    const elbowPole = new THREE.Vector3(0, -1, 0.3).normalize();
    const eL = elbowPole.clone().addScaledVector(right, -0.6).normalize(), eR = elbowPole.clone().addScaledVector(right, 0.6).normalize();
    const tL = new THREE.Vector3(), tR = new THREE.Vector3();
    solveIK(P.shL, P.hdL, 0.29, 0.28, eL, P.elL, tL);
    solveIK(P.shR, P.hdR, 0.29, 0.28, eR, P.elR, tR);
    placeLimb(this.uArmL, P.shL, P.elL, 0.065); placeLimb(this.uArmR, P.shR, P.elR, 0.065);
    placeLimb(this.fArmL, P.elL, tL, 0.055); placeLimb(this.fArmR, P.elR, tR, 0.055);
    this.handL.position.copy(tL); this.handR.position.copy(tR);
    if (this.band) {
      this.band.position.lerpVectors(P.shL, P.elL, 0.45);
      this.band.quaternion.copy(this.uArmL.quaternion);
    }
    // оружие
    this.weapon.position.copy(P.wO);
    const wm = new THREE.Matrix4().lookAt(new THREE.Vector3(), P.wD, down.clone().negate());
    this.weapon.quaternion.setFromRotationMatrix(wm);
    this.weapon.visible = !st.dead || dw < 0.3;
  }

  muzzleWorld(out) {
    const L = this.weaponKind === 'svd' ? 1.2 : this.weaponKind === 'pkm' ? 1.15 : this.weaponKind === 'rpg' ? 0.95 : 0.92;
    return out.copy(this.P.wO).addScaledVector(this.P.wD, L).applyMatrix4(this.root.matrixWorld);
  }

  // Хитбоксы в мировых координатах: [{a, b, r, zone}]
  hitboxes(out) {
    const M = this.root.matrixWorld;
    const P = this.P;
    const w = (v, slot) => slot.copy(v).applyMatrix4(M);
    if (!out.length) {
      for (let i = 0; i < 9; i++) out.push({ a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0, zone: '' });
    }
    const sc = this.scale;
    const set = (i, A, B, r, zone) => { w(A, out[i].a); w(B, out[i].b); out[i].r = r * sc; out[i].zone = zone; };
    set(0, P.head, P.head, 0.13, 'head');
    tmpB.copy(P.H).lerp(P.N, 0.15);
    set(1, tmpB, P.N, 0.17, 'torso');
    set(2, P.hpL, P.knL, 0.085, 'leg'); set(3, P.hpR, P.knR, 0.085, 'leg');
    set(4, P.knL, P.anL, 0.07, 'leg'); set(5, P.knR, P.anR, 0.07, 'leg');
    set(6, P.shL, P.elL, 0.06, 'arm'); set(7, P.shR, P.elR, 0.06, 'arm');
    set(8, P.H, P.H, 0.16, 'pelvis');
    return out;
  }
}
