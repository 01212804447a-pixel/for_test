// Оружие от первого лица. Система координат «прицельной линии»: начало — прорезь
// целика (или оптическая ось прицела), -Z вдоль линии прицеливания.
// Ствол (группа bore) повёрнут относительно линии прицеливания на угол прицеливания θ
// вокруг вершины мушки — ровно так, как это делает поднятый целик.
import * as THREE from 'three';
import { flashTexture, camoTexture } from '../world/textures.js';

const M = {};
function mats() {
  if (M.metal) return M;
  M.metal = new THREE.MeshStandardMaterial({ color: 0x2c2e32, roughness: 0.38, metalness: 0.55 });
  M.metalWorn = new THREE.MeshStandardMaterial({ color: 0x45474c, roughness: 0.45, metalness: 0.6 });
  M.plum = new THREE.MeshStandardMaterial({ color: 0x4e302a, roughness: 0.6, metalness: 0.05 });
  M.blackPoly = new THREE.MeshStandardMaterial({ color: 0x29292b, roughness: 0.65 });
  M.bakelite = new THREE.MeshStandardMaterial({ color: 0x6e3518, roughness: 0.55 });
  M.wood = new THREE.MeshStandardMaterial({ color: 0x6a3a1c, roughness: 0.55 });
  M.olive = new THREE.MeshStandardMaterial({ color: 0x45522f, roughness: 0.65, metalness: 0.15 });
  M.olive2 = new THREE.MeshStandardMaterial({ color: 0x5a6640, roughness: 0.6, metalness: 0.15 });
  M.green = new THREE.MeshStandardMaterial({ color: 0x3e4a33, roughness: 0.7 });
  M.lens = new THREE.MeshStandardMaterial({ color: 0x0a1220, roughness: 0.05, metalness: 0.9 });
  M.rubber = new THREE.MeshStandardMaterial({ color: 0x0e0e0e, roughness: 0.9 });
  M.sleeve = new THREE.MeshStandardMaterial({ map: camoTexture(['#e9edf0', '#c6ced6', '#a9b3bc', '#f7f9fa'], 'negsSleeve', 3), roughness: 0.95 });
  M.glove = new THREE.MeshStandardMaterial({ color: 0x34363a, roughness: 0.85 });
  M.flash = new THREE.MeshBasicMaterial({ map: flashTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  M.white = new THREE.MeshStandardMaterial({ color: 0xcfd3d6, roughness: 0.6 });
  return M;
}

function box(g, w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  g.add(m); return m;
}
function cylZ(g, r, z0, z1, mat, x = 0, y = 0, seg = 14, r1 = r) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r, Math.abs(z1 - z0), seg), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, (z0 + z1) / 2);
  g.add(m); return m;
}
function cylY(g, r, h, mat, x, y, z, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
  m.position.set(x, y, z); g.add(m); return m;
}
function limb(g, a, b, r, mat) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, len - r * 2), 4, 10), mat);
  m.position.addVectors(A, B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  g.add(m); return m;
}
function hand(g, p, mat, rx = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.085, 0.1), mat);
  m.position.set(...p); m.rotation.x = rx; g.add(m);
  return m;
}

// Механический прицел АК: возвращает объект с подвижной планкой
function akSights(bore, R, mm) {
  // колодка прицела
  box(bore, 0.03, 0.03, 0.07, mm.metal, 0, -0.03, -0.02);
  const leaf = new THREE.Group();
  box(leaf, 0.026, 0.004, 0.065, mm.metal, 0, -0.007, -0.025);
  // целик с прорезью (размеры немного увеличены для читаемости на экране)
  box(leaf, 0.011, 0.0065, 0.005, mm.metal, -0.0095, -0.00325, 0);
  box(leaf, 0.011, 0.0065, 0.005, mm.metal, 0.0095, -0.00325, 0);
  box(leaf, 0.008, 0.0025, 0.005, mm.metal, 0, -0.00525, 0);
  // хомутик
  const slider = box(leaf, 0.03, 0.007, 0.008, mm.metalWorn, 0, -0.008, -0.03);
  bore.add(leaf);
  // основание мушки + мушка + предохранительные «уши»
  box(bore, 0.024, 0.04, 0.03, mm.metal, 0, -0.045, -R);
  box(bore, 0.0045, 0.016, 0.004, mm.metal, 0, -0.008, -R);
  box(bore, 0.003, 0.022, 0.012, mm.metal, -0.0125, -0.007, -R);
  box(bore, 0.003, 0.022, 0.012, mm.metal, 0.0125, -0.007, -R);
  return { leaf, slider };
}

function akBody(bore, mm, { wood = false, h = 0.062, gp = false } = {}) {
  const furn = wood ? mm.wood : mm.plum;
  box(bore, 0.048, 0.07, 0.24, mm.metal, 0, -0.083, 0.1);
  cylZ(bore, 0.022, 0.02, 0.215, mm.metalWorn, 0, -0.052, 10);
  cylZ(bore, 0.0105, -0.05, -0.34, mm.metal, 0, -0.032);
  box(bore, 0.038, 0.026, 0.2, furn, 0, -0.033, -0.145);
  box(bore, 0.052, 0.05, 0.22, furn, 0, -0.076, -0.13);
  cylZ(bore, 0.0085, -0.24, -0.5, mm.metal, 0, -h);
  cylZ(bore, 0.014, -0.365, -0.395, mm.metal, 0, -h);
  if (wood) cylZ(bore, 0.012, -0.5, -0.56, mm.metal, 0, -h, 8, 0.011);
  else cylZ(bore, 0.0125, -0.5, -0.585, mm.metal, 0, -h, 10);
  // магазин
  const magMat = wood ? mm.metalWorn : mm.bakelite;
  box(bore, 0.026, 0.1, 0.075, magMat, 0, -0.165, 0.03, 0.2);
  box(bore, 0.026, 0.1, 0.072, magMat, 0, -0.255, 0.0, 0.42);
  box(bore, 0.026, 0.06, 0.07, magMat, 0, -0.32, -0.04, 0.6);
  box(bore, 0.008, 0.006, 0.075, mm.metal, 0, -0.124, 0.11);
  box(bore, 0.03, 0.1, 0.042, wood ? mm.wood : mm.blackPoly, 0, -0.165, 0.175, -0.35);
  box(bore, 0.02, 0.012, 0.015, mm.metal, 0.033, -0.066, 0.1);
  box(bore, 0.002, 0.012, 0.09, mm.metal, 0.026, -0.078, 0.14);
  if (wood) {
    box(bore, 0.038, 0.07, 0.25, mm.wood, 0, -0.112, 0.35, 0.12);
    box(bore, 0.04, 0.12, 0.03, mm.wood, 0, -0.14, 0.48);
  } else {
    box(bore, 0.032, 0.055, 0.23, mm.blackPoly, 0, -0.108, 0.34, 0.08);
    box(bore, 0.04, 0.125, 0.025, mm.blackPoly, 0, -0.13, 0.46);
  }
  if (gp) {
    // ГП-25 под стволом
    cylZ(bore, 0.024, -0.06, -0.3, mm.metalWorn, 0, -h - 0.047, 16);
    box(bore, 0.03, 0.06, 0.07, mm.metal, 0, -h - 0.075, -0.04);
    box(bore, 0.026, 0.08, 0.035, mm.blackPoly, 0, -h - 0.12, -0.05, -0.3);
    box(bore, 0.012, 0.03, 0.08, mm.metal, -0.03, -h - 0.04, -0.12);
  }
}

function svdModel(bore, mm, h) {
  // оптика ПСО-1 (ось — y=0)
  cylZ(bore, 0.016, 0.1, -0.2, mm.blackPoly, 0, 0, 18);
  cylZ(bore, 0.022, -0.17, -0.26, mm.blackPoly, 0, 0, 18, 0.018);
  cylZ(bore, 0.02, 0.06, 0.14, mm.rubber, 0, 0, 18);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.019, 20), mm.lens);
  lens.position.z = -0.262; lens.rotation.y = Math.PI; bore.add(lens);
  cylY(bore, 0.012, 0.02, mm.blackPoly, 0, 0.022, -0.04);
  const w = cylY(bore, 0.011, 0.018, mm.blackPoly, -0.024, 0, -0.04); w.rotation.z = Math.PI / 2;
  box(bore, 0.02, 0.035, 0.08, mm.metal, -0.012, -0.035, -0.02);
  // винтовка
  box(bore, 0.045, 0.07, 0.3, mm.metal, 0, -h - 0.02, 0.1);
  box(bore, 0.05, 0.05, 0.26, mm.wood, 0, -h - 0.005, -0.18);
  cylZ(bore, 0.009, -0.3, -0.78, mm.metal, 0, -h);
  cylZ(bore, 0.012, -0.78, -0.86, mm.metal, 0, -h);
  box(bore, 0.024, 0.08, 0.06, mm.blackPoly, 0, -h - 0.09, 0.05, 0.15);
  box(bore, 0.03, 0.1, 0.035, mm.wood, 0, -h - 0.1, 0.2, -0.4);
  // скелетный приклад
  box(bore, 0.035, 0.025, 0.3, mm.wood, 0, -h - 0.015, 0.42, 0.05);
  box(bore, 0.035, 0.025, 0.3, mm.wood, 0, -h - 0.11, 0.44, -0.12);
  box(bore, 0.038, 0.14, 0.03, mm.wood, 0, -h - 0.08, 0.6);
  box(bore, 0.03, 0.04, 0.08, mm.wood, 0, -h + 0.02, 0.38);
}

function pkmModel(bore, mm, R, h) {
  const leaf = new THREE.Group();
  box(leaf, 0.03, 0.004, 0.06, mm.metal, 0, -0.008, -0.025);
  box(leaf, 0.012, 0.008, 0.005, mm.metal, -0.0105, -0.004, 0);
  box(leaf, 0.012, 0.008, 0.005, mm.metal, 0.0105, -0.004, 0);
  box(leaf, 0.009, 0.003, 0.005, mm.metal, 0, -0.0065, 0);
  bore.add(leaf);
  box(bore, 0.04, 0.03, 0.08, mm.metal, 0, -0.03, -0.02);
  box(bore, 0.06, 0.09, 0.3, mm.metal, 0, -h - 0.03, 0.12);
  box(bore, 0.062, 0.02, 0.18, mm.metalWorn, 0, -h + 0.02, 0.14);
  cylZ(bore, 0.012, -0.05, -0.7, mm.metal, 0, -h);
  cylZ(bore, 0.016, -0.7, -0.78, mm.metal, 0, -h, 10);
  box(bore, 0.02, 0.05, 0.03, mm.metal, 0, -0.035, -R);
  box(bore, 0.0055, 0.02, 0.004, mm.metal, 0, -0.01, -R);
  box(bore, 0.003, 0.03, 0.012, mm.metal, -0.016, -0.012, -R);
  box(bore, 0.003, 0.03, 0.012, mm.metal, 0.016, -0.012, -R);
  box(bore, 0.012, 0.012, 0.55, mm.metal, 0.005, -h - 0.03, -0.35);
  box(bore, 0.012, 0.012, 0.55, mm.metal, -0.005, -h - 0.03, -0.35);
  box(bore, 0.08, 0.13, 0.13, mm.green, 0.07, -h - 0.15, 0.13);
  box(bore, 0.03, 0.1, 0.04, mm.blackPoly, 0, -h - 0.1, 0.27, -0.3);
  box(bore, 0.03, 0.03, 0.3, mm.blackPoly, 0, -h - 0.04, 0.42, 0.05);
  box(bore, 0.03, 0.03, 0.3, mm.blackPoly, 0, -h - 0.14, 0.43, -0.18);
  box(bore, 0.04, 0.15, 0.03, mm.blackPoly, 0, -h - 0.11, 0.58);
  box(bore, 0.02, 0.025, 0.12, mm.metalWorn, 0, -h + 0.045, -0.08);
  return { leaf };
}

function rpgModel(bore, mm, optic) {
  const tx = optic ? 0.055 : 0.03, ty = optic ? -0.1 : -0.075;
  cylZ(bore, 0.02, 0.5, -0.45, mm.olive, tx, ty, 18);
  cylZ(bore, 0.045, 0.5, 0.64, mm.olive, tx, ty, 18, 0.02);
  cylZ(bore, 0.027, -0.06, 0.22, mm.wood, tx, ty, 14);
  box(bore, 0.03, 0.11, 0.04, mm.wood, tx, ty - 0.08, 0.06, -0.25);
  box(bore, 0.03, 0.1, 0.04, mm.wood, tx, ty - 0.075, -0.18, -0.15);
  // граната ПГ-7ВМ
  cylZ(bore, 0.022, -0.45, -0.58, mm.olive2, tx, ty, 14);
  cylZ(bore, 0.035, -0.58, -0.7, mm.olive2, tx, ty, 18);
  cylZ(bore, 0.003, -0.7, -0.83, mm.olive2, tx, ty, 8, 0.035);
  if (optic) {
    // ПГО-7 слева сверху
    cylZ(bore, 0.017, -0.1, 0.12, mm.blackPoly, 0, 0, 16);
    cylZ(bore, 0.021, 0.1, 0.18, mm.rubber, 0, 0, 16);
    box(bore, 0.05, 0.05, 0.12, mm.blackPoly, 0.025, -0.045, 0.0);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.016, 18), mm.lens);
    lens.position.z = -0.102; lens.rotation.y = Math.PI; bore.add(lens);
    return {};
  }
  const leaf = new THREE.Group();
  box(leaf, 0.008, 0.012, 0.004, mm.metal, -0.009, -0.006, 0);
  box(leaf, 0.008, 0.012, 0.004, mm.metal, 0.009, -0.006, 0);
  box(leaf, 0.01, 0.004, 0.004, mm.metal, 0, -0.01, 0);
  box(leaf, 0.026, 0.04, 0.004, mm.metal, 0, -0.032, 0);
  bore.add(leaf);
  box(bore, 0.004, 0.06, 0.004, mm.metal, 0, -0.03, -0.5);
  box(bore, 0.0055, 0.012, 0.004, mm.metal, 0, -0.006, -0.5);
  return { leaf };
}

const MODEL_INFO = {
  ak74: { R: 0.379, h: 0.062, muzzle: [0, -0.062, -0.585], hip: [0.16, -0.19, -0.42], ads: [0, 0, -0.33] },
  ak74gp: { R: 0.379, h: 0.062, muzzle: [0, -0.062, -0.585], hip: [0.16, -0.19, -0.42], ads: [0, 0, -0.33] },
  ak74scope: { R: 0.3, h: 0.085, muzzle: [0, -0.085, -0.6], hip: [0.15, -0.19, -0.36], ads: [0, 0, -0.14] },
  akm: { R: 0.378, h: 0.06, muzzle: [0, -0.06, -0.56], hip: [0.16, -0.19, -0.42], ads: [0, 0, -0.33] },
  svd: { R: 0.3, h: 0.082, muzzle: [0, -0.082, -0.86], hip: [0.15, -0.19, -0.33], ads: [0, 0, -0.17] },
  pkm: { R: 0.663, h: 0.07, muzzle: [0, -0.07, -0.78], hip: [0.16, -0.2, -0.34], ads: [0, 0, -0.34] },
  rpg7: { R: 0.5, h: 0.1, muzzle: [0.055, -0.1, -0.45], hip: [0.13, -0.08, -0.25], ads: [0, 0, -0.2] },
  rpg7iron: { R: 0.5, h: 0.075, muzzle: [0.03, -0.075, -0.45], hip: [0.13, -0.08, -0.25], ads: [0, 0, -0.2] },
  gp25: { R: 0.06, h: 0.1, muzzle: [0.055, -0.1, -0.3], hip: [0.15, -0.17, -0.34], ads: [0, 0, -0.26], quadrant: true },
  b8: { R: 0.1, h: 0, muzzle: [0, 0, -0.3], hip: [0.0, -0.22, -0.3], ads: [0, 0, -0.06] },
  grenade: { R: 0.1, h: 0, muzzle: [0, 0, -0.3], hip: [0.17, -0.2, -0.35], ads: [0.17, -0.2, -0.35] },
};

export class ViewModel {
  constructor(scene) {
    this.scene = scene;
    this.mm = mats();
    this.models = new Map();
    this.cur = null;
    this.kind = null;
    this.theta = 0;
    this.flash = null;
    this._m = new THREE.Matrix4();
  }

  info(kind) { return MODEL_INFO[kind]; }

  _build(kind) {
    const mm = this.mm;
    const info = MODEL_INFO[kind];
    const root = new THREE.Group();
    const bore = new THREE.Group();
    root.add(bore);
    let parts = {};
    if (kind === 'ak74' || kind === 'akm' || kind === 'ak74gp') {
      akBody(bore, mm, { wood: kind === 'akm', h: info.h, gp: kind === 'ak74gp' });
      parts = akSights(bore, info.R, mm);
    } else if (kind === 'ak74scope') {
      akBody(bore, mm, { h: info.h });
      // 1П78 на боковом кронштейне
      cylZ(bore, 0.017, 0.08, -0.12, mm.blackPoly, 0, 0, 16);
      cylZ(bore, 0.02, -0.1, -0.16, mm.blackPoly, 0, 0, 16, 0.017);
      cylZ(bore, 0.019, 0.05, 0.12, mm.rubber, 0, 0, 16);
      box(bore, 0.04, 0.03, 0.08, mm.metal, -0.01, -0.03, 0.0);
    } else if (kind === 'svd') svdModel(bore, mm, info.h);
    else if (kind === 'pkm') parts = pkmModel(bore, mm, info.R, info.h);
    else if (kind === 'rpg7') parts = rpgModel(bore, mm, true);
    else if (kind === 'rpg7iron') parts = rpgModel(bore, mm, false);
    else if (kind === 'gp25') {
      // автомат смещён вправо, квадрантный прицел ГП-25 на линии прицеливания
      const ak = new THREE.Group();
      akBody(ak, mm, { h: 0.062, gp: true });
      akSights(ak, 0.379, mm);
      ak.position.set(0.055, -0.1 + 0.109, 0.15);
      bore.add(ak);
      const q = new THREE.Group();
      box(q, 0.0055, 0.011, 0.003, mm.metal, -0.006, -0.0055, 0);
      box(q, 0.0055, 0.011, 0.003, mm.metal, 0.006, -0.0055, 0);
      box(q, 0.0065, 0.004, 0.003, mm.metal, 0, -0.009, 0);
      box(q, 0.0035, 0.013, 0.003, mm.metal, 0, -0.0065, -0.12);
      box(q, 0.004, 0.006, 0.125, mm.metal, 0, -0.016, -0.06);
      cylZ(q, 0.009, -0.04, -0.07, mm.metalWorn, -0.012, -0.03, 16);
      root.add(q);
    } else if (kind === 'b8') {
      cylZ(bore, 0.028, 0.0, -0.16, mm.green, -0.04, 0, 16);
      cylZ(bore, 0.028, 0.0, -0.16, mm.green, 0.04, 0, 16);
      box(bore, 0.05, 0.03, 0.06, mm.green, 0, 0, -0.06);
    } else if (kind === 'grenade') {
      const g = new THREE.Mesh(new THREE.DodecahedronGeometry(0.03, 1), mm.olive);
      g.scale.set(1, 1.25, 1); bore.add(g);
      box(bore, 0.008, 0.06, 0.012, mm.metalWorn, 0.025, 0.02, 0);
    }
    // руки
    if (kind !== 'b8' && kind !== 'grenade') {
      const rgrip = kind === 'svd' ? [0, -info.h - 0.12, 0.2] : kind === 'pkm' ? [0, -info.h - 0.12, 0.27] : kind.startsWith('rpg') ? [info.muzzle[0], info.muzzle[1] - 0.09, 0.06] : kind === 'gp25' ? [0.055, -0.21, 0.32] : [0, -0.18, 0.175];
      const lgrip = kind === 'svd' ? [-0.005, -info.h - 0.03, -0.2] : kind === 'pkm' ? [0, -info.h - 0.05, -0.1] : kind.startsWith('rpg') ? [info.muzzle[0], info.muzzle[1] - 0.08, -0.18] : kind === 'gp25' ? [0.055, -0.22, 0.1] : [-0.01, -0.09, -0.15];
      hand(bore, rgrip, mm.glove, -0.3);
      hand(bore, lgrip, mm.glove, 0.2);
      limb(bore, rgrip, [rgrip[0] + 0.12, rgrip[1] - 0.16, rgrip[2] + 0.28], 0.042, mm.sleeve);
      limb(bore, [rgrip[0] + 0.12, rgrip[1] - 0.16, rgrip[2] + 0.28], [rgrip[0] + 0.2, rgrip[1] - 0.2, rgrip[2] + 0.5], 0.05, mm.sleeve);
      limb(bore, lgrip, [lgrip[0] - 0.1, lgrip[1] - 0.15, lgrip[2] + 0.25], 0.04, mm.sleeve);
      limb(bore, [lgrip[0] - 0.1, lgrip[1] - 0.15, lgrip[2] + 0.25], [lgrip[0] - 0.2, lgrip[1] - 0.22, lgrip[2] + 0.5], 0.05, mm.sleeve);
    } else {
      hand(bore, [kind === 'b8' ? -0.05 : 0.0, -0.04, 0.02], mm.glove);
      limb(bore, [0.0, -0.06, 0.04], [0.1, -0.25, 0.3], 0.045, mm.sleeve);
      if (kind === 'b8') { hand(bore, [0.05, -0.04, 0.02], mm.glove); limb(bore, [-0.04, -0.06, 0.04], [-0.12, -0.25, 0.3], 0.045, mm.sleeve); }
    }
    // вспышка
    const flash = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), mm.flash);
      p.rotation.set(i === 0 ? 0 : Math.PI / 2, i === 2 ? Math.PI / 2 : 0, 0);
      if (i > 0) p.scale.set(1, 2.2, 1);
      flash.add(p);
    }
    flash.position.set(info.muzzle[0], info.muzzle[1], info.muzzle[2] - 0.06);
    flash.visible = false;
    bore.add(flash);
    root.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; } });
    return { root, bore, parts, info, flash };
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
  update(pos, quat, theta, visible, flashOn) {
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
    if (c.parts.leaf) c.parts.leaf.position.y = R * Math.sin(theta);
    if (c.parts.slider) c.parts.slider.position.z = -0.03 + Math.min(0.03, theta * 1.6);
    c.flash.visible = !!flashOn;
    if (flashOn) { c.flash.rotation.z = Math.random() * 6.28; const s = 0.8 + Math.random() * 0.6; c.flash.scale.set(s, s, s); }
    this.theta = theta;
    c.root.updateMatrix();
    c.bore.updateMatrix();
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

export { MODEL_INFO };
