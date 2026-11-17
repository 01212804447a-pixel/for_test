// Процедурная модель бойца: скелет из опорных точек + двухзвенная IK для рук/ног.
// Позы: стоя, присев, лёжа, гибель. Хитбоксы считаются из тех же точек.
import * as THREE from 'three';
import { camoTexture, snowNormal } from '../world/textures.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, lerp } from '../core/math.js';

const FACTIONS = {
  negs: { camo: ['#e9edf0', '#c6ced6', '#a9b3bc', '#f7f9fa'], vest: 0x8f989e, helmet: 0xd9dee2, face: 0xc9ced3, skin: 0xc79f86, pack: 0xb5bdc3, glove: 0x3b3d40, boot: 0x2a2b2d, band: null, goggles: true, helmetCamo: true },
  denter: { camo: ['#3c3f39', '#2a2c29', '#55594d', '#1e1f1d'], vest: 0x2e302a, helmet: 0x26282a, face: 0x141414, skin: 0xb88a70, pack: 0x37392f, glove: 0x1d1d1d, boot: 0x1a1a1a, band: 0xa01818, goggles: false, beanie: true },
  krandi: { camo: ['#181818', '#121212', '#202020', '#0e0e0e'], vest: 0x1a1a1a, helmet: null, face: 0xc89c80, skin: 0xc89c80, pack: null, glove: 0x111111, boot: 0x101010, band: 0x8a0c0c, goggles: false, coat: true, bare: true },
  officer: { camo: ['#56604a', '#4a5340', '#626d54', '#3f4737'], vest: 0x4c5544, helmet: null, face: 0xd6b096, skin: 0xd6b096, pack: null, glove: 0x2a2a2a, boot: 0x1a1a1a, band: null, goggles: false, cap: true, bare: true },
};

const matCache = new Map();
function mats(fid) {
  if (matCache.has(fid)) return matCache.get(fid);
  const f = FACTIONS[fid];
  const nm = snowNormal();
  const fabric = (o) => new THREE.MeshStandardMaterial({ roughness: 0.95, normalMap: nm, normalScale: new THREE.Vector2(0.55, 0.55), ...o });
  const m = {
    uniform: fabric({ map: camoTexture(f.camo, fid + 'uni', 4) }),
    vest: fabric({ color: f.vest, roughness: 0.9 }),
    strap: new THREE.MeshStandardMaterial({ color: new THREE.Color(f.vest).multiplyScalar(0.7), roughness: 0.9 }),
    helmet: f.helmet !== null ? (f.helmetCamo ? fabric({ map: camoTexture(f.camo, fid + 'helm', 2) }) : new THREE.MeshStandardMaterial({ color: f.helmet, roughness: 0.6, metalness: 0.1 })) : null,
    face: fabric({ color: f.face }),
    skin: new THREE.MeshStandardMaterial({ color: f.skin, roughness: 0.7 }),
    pack: f.pack !== null ? fabric({ color: f.pack }) : null,
    glove: new THREE.MeshStandardMaterial({ color: f.glove, roughness: 0.8 }),
    boot: new THREE.MeshStandardMaterial({ color: f.boot, roughness: 0.65 }),
    sole: new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.9 }),
    band: f.band !== null ? new THREE.MeshStandardMaterial({ color: f.band, roughness: 0.8 }) : null,
    goggles: new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.1, metalness: 0.7 }),
    lens: new THREE.MeshStandardMaterial({ color: 0xd88a28, roughness: 0.05, metalness: 0.9 }),
    gun: new THREE.MeshStandardMaterial({ color: 0x232427, roughness: 0.45, metalness: 0.6 }),
    gunPoly: new THREE.MeshStandardMaterial({ color: 0x2c2b2a, roughness: 0.7 }),
    gunWood: new THREE.MeshStandardMaterial({ color: 0x6a3a1c, roughness: 0.55 }),
    mag: new THREE.MeshStandardMaterial({ color: 0x6e3518, roughness: 0.55 }),
    tube: new THREE.MeshStandardMaterial({ color: 0x3d4a2f, roughness: 0.7, metalness: 0.2 }),
    hair: new THREE.MeshStandardMaterial({ color: 0x9a9a98, roughness: 0.9 }),
  };
  matCache.set(fid, m);
  return m;
}

const gcache = new Map();
function geo(key, fn) { if (!gcache.has(key)) gcache.set(key, fn()); return gcache.get(key); }
const RB = (w, h, d, r = 0.02) => geo(`rb${w}|${h}|${d}|${r}`, () => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2) * 0.98));
const taper = (r0, r1) => geo(`tp${r0}|${r1}`, () => new THREE.CylinderGeometry(r1, r0, 1, 12, 1));
const sph = (rx, ry, rz) => geo(`sp${rx}|${ry}|${rz}`, () => { const g = new THREE.SphereGeometry(1, 16, 12); g.scale(rx, ry, rz); return g; });
const torsoGeo = () => geo('torso', () => {
  const pts = [[0.0, -0.28], [0.135, -0.27], [0.15, -0.2], [0.155, -0.08], [0.175, 0.04], [0.195, 0.15], [0.2, 0.21], [0.17, 0.26], [0.1, 0.29], [0.0, 0.3]].map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, 20);
  g.scale(1, 1, 0.64);
  g.computeVertexNormals();
  return g;
});
const helmetGeo = () => geo('helmet', () => { const g = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, 1.75); g.scale(0.132, 0.125, 0.142); return g; });

function mesh(g, mat, shadow = true) {
  const m = new THREE.Mesh(g, mat);
  m.castShadow = shadow;
  return m;
}

// Оружие от третьего лица: детали сливаются в несколько мешей (по материалам)
const weaponCache = new Map();
export function buildThirdPersonWeapon(kind, mm) {
  const key = kind + (mm.gun.uuid);
  if (!weaponCache.has(key)) {
    const parts = new Map();
    const add = (g, mat, x, y, z, rx = 0) => {
      g = g.clone(); if (rx) g.rotateX(rx); g.translate(x, y, z);
      if (!parts.has(mat)) parts.set(mat, []);
      parts.get(mat).push(g.index ? g.toNonIndexed() : g);
    };
    const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const C = (r0, r1, len) => { const g = new THREE.CylinderGeometry(r1, r0, len, 10); g.rotateX(Math.PI / 2); return g; };
    if (kind === 'rpg') {
      add(C(0.022, 0.022, 0.95), mm.tube, 0, 0, -0.35);
      add(C(0.022, 0.048, 0.14), mm.tube, 0, 0, 0.19);
      add(C(0.027, 0.027, 0.26), mm.gunWood, 0, 0, -0.3);
      add(C(0.024, 0.024, 0.14), mm.tube, 0, 0, -0.88);
      add(C(0.042, 0.042, 0.12), mm.tube, 0, 0, -1.0);
      add(C(0.004, 0.042, 0.14), mm.tube, 0, 0, -1.13);
      add(B(0.03, 0.1, 0.04), mm.gunWood, 0, -0.07, -0.25, -0.25);
      add(B(0.05, 0.05, 0.12), mm.gun, -0.035, 0.04, -0.35);
    } else {
      const wood = kind === 'akm' || kind === 'svd';
      const len = kind === 'svd' ? 1.22 : kind === 'pkm' ? 1.18 : 0.94;
      const stockMat = wood ? mm.gunWood : mm.gunPoly;
      add(B(0.036, 0.06, 0.24), stockMat, 0, -0.04, -0.12, 0.08);
      add(B(0.045, 0.075, 0.3), mm.gun, 0, 0, -0.38);
      add(C(0.022, 0.022, 0.26), mm.gun, 0, 0.03, -0.38);
      add(B(0.05, 0.055, 0.22), wood ? mm.gunWood : mm.gunPoly, 0, -0.005, -0.64);
      add(C(0.011, 0.011, len - 0.7), mm.gun, 0, 0.012, -0.75 - (len - 0.7) / 2);
      add(C(0.014, 0.014, 0.07), mm.gun, 0, 0.012, -len + 0.02);
      add(B(0.012, 0.04, 0.02), mm.gun, 0, 0.045, -len + 0.12);
      add(B(0.028, 0.09, 0.04), mm.gunPoly, 0, -0.08, -0.22, -0.35);
      if (kind === 'pkm') {
        add(B(0.09, 0.11, 0.12), mm.tube, 0.06, -0.08, -0.36);
        add(B(0.01, 0.01, 0.3), mm.gun, 0.02, -0.02, -0.75); add(B(0.01, 0.01, 0.3), mm.gun, -0.02, -0.02, -0.75);
      } else if (kind === 'svd') {
        add(B(0.026, 0.11, 0.06), mm.gun, 0, -0.08, -0.4, 0.15);
        add(C(0.018, 0.018, 0.32), mm.gun, -0.02, 0.085, -0.38);
        add(C(0.023, 0.023, 0.06), mm.gun, -0.02, 0.085, -0.56);
      } else {
        const mg = kind === 'akm' ? mm.gun : mm.mag;
        add(B(0.026, 0.1, 0.075), mg, 0, -0.085, -0.4, 0.2);
        add(B(0.026, 0.09, 0.07), mg, 0, -0.17, -0.37, 0.45);
      }
    }
    const grp = [];
    for (const [mat, gs] of parts) {
      const merged = mergeGeometries(gs.map((g) => { const n = new THREE.BufferGeometry(); n.setAttribute('position', g.attributes.position); n.setAttribute('normal', g.attributes.normal); return n; }));
      grp.push([merged, mat]);
    }
    weaponCache.set(key, grp);
  }
  const g = new THREE.Group();
  for (const [geom, mat] of weaponCache.get(key)) { const m = new THREE.Mesh(geom, mat); m.castShadow = true; g.add(m); }
  return g;
}

const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpU = new THREE.Vector3(), tmpW = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const _rx90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);

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

// Конический сегмент конечности от A к B (геометрия единичной длины по Y)
function placeLimb(m, A, B) {
  tmpA.subVectors(B, A);
  const len = tmpA.length();
  m.position.addVectors(A, B).multiplyScalar(0.5);
  if (len > 1e-5) m.quaternion.setFromUnitVectors(UP, tmpA.divideScalar(len));
  m.scale.set(1, Math.max(0.01, len), 1);
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
    this.details = [];
    const det = (m) => { m.castShadow = false; this.details.push(m); return m; };
    // туловище
    this.torso = mesh(torsoGeo(), mm.uniform); R.add(this.torso);
    this.pelvis = mesh(sph(0.16, 0.11, 0.115), mm.uniform); R.add(this.pelvis);
    this.belt = mesh(RB(0.33, 0.06, 0.235, 0.025), mm.strap); R.add(this.belt);
    // плитник с подсумками
    this.vest = new THREE.Group(); R.add(this.vest);
    const vb = (w, h, d, x, y, z, mat = mm.vest, detail = false, rr = 0.02) => { const v = mesh(RB(w, h, d, rr), mat); v.position.set(x, y, z); this.vest.add(v); if (detail) det(v); return v; };
    if (!f.coat) {
      vb(0.32, 0.3, 0.055, 0, 0.0, -0.118);
      vb(0.32, 0.32, 0.05, 0, 0.01, 0.118);
      vb(0.06, 0.16, 0.2, -0.17, -0.05, 0, mm.vest, false, 0.02);
      vb(0.06, 0.16, 0.2, 0.17, -0.05, 0, mm.vest, false, 0.02);
      for (const x of [-0.1, 0, 0.1]) vb(0.075, 0.12, 0.06, x, -0.07, -0.168, mm.vest, true, 0.015);
      vb(0.13, 0.07, 0.045, 0.0, 0.08, -0.16, mm.strap, true, 0.01);
      vb(0.06, 0.14, 0.06, 0.2, 0.03, 0.04, mm.strap, true, 0.015);
      for (const x of [-0.11, 0.11]) vb(0.06, 0.03, 0.26, x, 0.16, 0, mm.strap, true, 0.01);
    }
    // рюкзак со скаткой
    this.pack = null;
    if (mm.pack) {
      this.pack = new THREE.Group();
      const p1 = mesh(RB(0.28, 0.34, 0.15, 0.04), mm.pack); this.pack.add(p1);
      const roll = mesh(geo('roll', () => { const g = new THREE.CylinderGeometry(0.055, 0.055, 0.34, 12); g.rotateZ(Math.PI / 2); return g; }), mm.vest);
      roll.position.set(0, 0.21, 0.01); this.pack.add(det(roll));
      const sp = mesh(RB(0.2, 0.12, 0.05, 0.02), mm.pack); sp.position.set(0, -0.06, 0.09); this.pack.add(det(sp));
      R.add(this.pack);
    }
    // голова
    this.neck = mesh(taper(0.055, 0.05), mm.face); R.add(this.neck);
    this.headG = new THREE.Group(); R.add(this.headG);
    this.head = mesh(sph(0.098, 0.117, 0.108), f.bare ? mm.skin : mm.face); this.headG.add(this.head);
    if (!f.bare) {
      const eyes = mesh(RB(0.12, 0.032, 0.03, 0.012), mm.skin); eyes.position.set(0, 0.022, -0.092); this.headG.add(det(eyes));
    } else {
      const hair = mesh(geo('hair', () => { const g = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, 1.4); g.scale(0.104, 0.11, 0.114); return g; }), mm.hair);
      hair.position.set(0, 0.012, 0.006); this.headG.add(hair);
      const nose = mesh(sph(0.018, 0.028, 0.02), mm.skin); nose.position.set(0, 0.0, -0.105); this.headG.add(det(nose));
    }
    if (mm.helmet) {
      const h = mesh(helmetGeo(), mm.helmet); h.position.set(0, 0.03, 0.005); this.headG.add(h);
      const nvg = mesh(RB(0.06, 0.035, 0.03, 0.008), mm.goggles); nvg.position.set(0, 0.11, -0.13); this.headG.add(det(nvg));
      for (const sx of [-1, 1]) { const rail = mesh(RB(0.012, 0.025, 0.09, 0.005), mm.goggles); rail.position.set(sx * 0.13, 0.03, 0.0); this.headG.add(det(rail)); }
      if (f.goggles) {
        const gg = mesh(RB(0.17, 0.045, 0.05, 0.018), mm.goggles); gg.position.set(0, 0.1, -0.1); gg.rotation.x = -0.4; this.headG.add(det(gg));
        const ln = mesh(RB(0.15, 0.03, 0.01, 0.008), mm.lens); ln.position.set(0, 0.098, -0.128); ln.rotation.x = -0.4; this.headG.add(det(ln));
      }
    } else if (f.cap) {
      const cap = mesh(geo('cap', () => new THREE.CylinderGeometry(0.115, 0.108, 0.07, 18)), mm.vest); cap.position.set(0, 0.1, 0); this.headG.add(cap);
      const top = mesh(geo('capTop', () => new THREE.CylinderGeometry(0.14, 0.115, 0.03, 18)), mm.vest); top.position.set(0, 0.145, -0.01); this.headG.add(top);
      const visor = mesh(RB(0.15, 0.012, 0.06, 0.005), mm.goggles); visor.position.set(0, 0.075, -0.115); visor.rotation.x = 0.2; this.headG.add(visor);
    }
    if (f.beanie && Math.random() < 0.5) {
      const bn = mesh(geo('beanie', () => { const g = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, 1.6); g.scale(0.108, 0.12, 0.118); return g; }), mm.face);
      bn.position.set(0, 0.025, 0.005); this.headG.add(bn);
      this.headG.children.forEach((c) => { if (c.geometry === helmetGeo()) c.visible = false; });
    }
    if (f.coat) {
      const coatMat = mm.uniform.clone(); coatMat.side = THREE.DoubleSide;
      this.coat = mesh(geo('coat', () => new THREE.CylinderGeometry(0.2, 0.33, 0.85, 16, 1, true)), coatMat); R.add(this.coat);
      this.scarf = mesh(geo('scarf', () => new THREE.TorusGeometry(0.075, 0.03, 8, 16)), mm.band); R.add(this.scarf);
    }
    // конечности: конусы + суставы
    this.uArmL = mesh(taper(0.07, 0.056), mm.uniform); this.uArmR = mesh(taper(0.07, 0.056), mm.uniform);
    this.fArmL = mesh(taper(0.056, 0.046), mm.uniform); this.fArmR = mesh(taper(0.056, 0.046), mm.uniform);
    this.thighL = mesh(taper(0.1, 0.074), mm.uniform); this.thighR = mesh(taper(0.1, 0.074), mm.uniform);
    this.shinL = mesh(taper(0.072, 0.056), mm.uniform); this.shinR = mesh(taper(0.072, 0.056), mm.uniform);
    this.joints = {};
    for (const k of ['shL', 'shR', 'elL', 'elR', 'knL', 'knR']) {
      const r = k.startsWith('sh') ? 0.075 : k.startsWith('el') ? 0.058 : 0.076;
      this.joints[k] = mesh(sph(r, r, r), mm.uniform, false); R.add(this.joints[k]);
    }
    this.padL = det(mesh(RB(0.1, 0.12, 0.05, 0.02), mm.vest)); this.padR = det(mesh(RB(0.1, 0.12, 0.05, 0.02), mm.vest));
    this.handL = mesh(RB(0.07, 0.095, 0.11, 0.025), mm.glove); this.handR = mesh(RB(0.07, 0.095, 0.11, 0.025), mm.glove);
    this.bootL = new THREE.Group(); this.bootR = new THREE.Group();
    for (const b of [this.bootL, this.bootR]) {
      const up = mesh(RB(0.12, 0.13, 0.27, 0.04), mm.boot); up.position.y = 0.01; b.add(up);
      const so = mesh(RB(0.13, 0.03, 0.29, 0.01), mm.sole); so.position.y = -0.06; b.add(so);
    }
    R.add(this.uArmL, this.uArmR, this.fArmL, this.fArmR, this.handL, this.handR, this.thighL, this.thighR, this.shinL, this.shinR, this.bootL, this.bootR, this.padL, this.padR);
    if (mm.band) { this.band = mesh(geo('band', () => new THREE.CylinderGeometry(0.073, 0.073, 0.07, 12)), mm.band); R.add(this.band); }
    this.weaponKind = weaponKind;
    this.weapon = buildThirdPersonWeapon(weaponKind, mm);
    R.add(this.weapon);
    this.detailVisible = true;

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

  // Мелкие детали скрываются на расстоянии
  setDetail(v) {
    if (v === this.detailVisible) return;
    this.detailVisible = v;
    for (const m of this.details) m.visible = v;
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
    place(this.pelvis, 0.0, 0, 0);
    place(this.belt, 0.06, 0, 0);
    place(this.torso, 0.27, 0, 0);
    place(this.vest, 0.3, 0, 0.0);
    if (this.pack) place(this.pack, 0.32, 0, -0.2);
    place(this.neck, 0.56, 0, 0); this.neck.scale.set(1, 0.12, 1);
    if (this.coat) { place(this.coat, -0.1, 0, 0); this.coat.visible = !st.dead || dw < 1; }
    // голова
    P.head.copy(P.N).addScaledVector(s, 0.16).addScaledVector(back, -0.02);
    this.headG.position.copy(P.head);
    const headQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (st.aimPitch || 0) * 0.7 * (1 - dw) + wP * 1.2 * (1 - dw));
    this.headG.quaternion.copy(q).multiply(headQ);
    if (this.scarf) { this.scarf.position.copy(P.N).addScaledVector(s, 0.04); this.scarf.quaternion.copy(q).multiply(_rx90); }

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
    placeLimb(this.thighL, P.hpL, P.knL); placeLimb(this.thighR, P.hpR, P.knR);
    placeLimb(this.shinL, P.knL, P.anL); placeLimb(this.shinR, P.knR, P.anR);
    this.joints.knL.position.copy(P.knL); this.joints.knR.position.copy(P.knR);
    for (const [boot, an, kn, pad] of [[this.bootL, P.anL, P.knL, this.padL], [this.bootR, P.anR, P.knR, this.padR]]) {
      tmpA.subVectors(an, kn).normalize();
      const fw = new THREE.Vector3(0, 0, -1).addScaledVector(tmpA, -tmpA.z * -1);
      const look = new THREE.Matrix4().lookAt(new THREE.Vector3(), fw.lengthSq() > 0.01 ? fw : new THREE.Vector3(0, 0, -1), tmpA.clone().negate());
      boot.quaternion.setFromRotationMatrix(look);
      boot.position.copy(an).add(new THREE.Vector3(0, -0.02, -0.05).applyQuaternion(boot.quaternion));
      pad.quaternion.copy(boot.quaternion);
      pad.position.copy(kn).addScaledVector(tmpA, 0.04).add(new THREE.Vector3(0, 0, -0.07).applyQuaternion(boot.quaternion));
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
    placeLimb(this.uArmL, P.shL, P.elL); placeLimb(this.uArmR, P.shR, P.elR);
    placeLimb(this.fArmL, P.elL, tL); placeLimb(this.fArmR, P.elR, tR);
    for (const k of ['shL', 'shR', 'elL', 'elR']) this.joints[k].position.copy(P[k]);
    this.handL.position.copy(tL); this.handR.position.copy(tR);
    this.handL.quaternion.copy(this.fArmL.quaternion); this.handR.quaternion.copy(this.fArmR.quaternion);
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
