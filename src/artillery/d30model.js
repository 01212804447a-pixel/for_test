// Модель гаубицы Д-30 в боевом положении: три станины на грунте под 120°, опорная плита,
// вывешенные колёса; верхний станок поворачивается на 360°, люлька с противооткатными
// устройствами над стволом, ствол с двухкамерным дульным тормозом и буксирной проушиной,
// щит, панорама ПГ-1М и прицел прямой наводки ОП4М-45, маховики наводки.
// Система координат: начало — ось вращения на грунте, −Z — направление ствола, +Y — вверх.
import * as THREE from 'three';
import { side, loft, lathe, cylZ, cylX, cylY, rbox, torus, tube, xf, Parts } from '../weapons/gunkit.js';
import { paintMaterial } from '../entities/vehicleModels.js';

export const D30 = {
  trunnion: new THREE.Vector3(0, 1.08, 0.25), // ось цапф (в системе верхнего станка)
  muzzle: -4.55,                              // дульный срез по оси ствола (от цапф)
  breech: 1.12,                               // казённый срез (от цапф)
  recoil: 0.85,                               // длина отката, м
  pano: new THREE.Vector3(-0.42, 1.52, 0.2),  // глаз у панорамы (верхний станок)
  op4m: new THREE.Vector3(-0.33, 1.2, 0.62),  // глаз у ОП4М-45 (качается со стволом, система люльки)
};

function mats() {
  const std = (o) => new THREE.MeshStandardMaterial(o);
  return {
    paint: paintMaterial(['#4a5535'], { scale: 0.6, snow: 0.35, gloss: 0.6, metal: 0.3, camo: false, dirtAmt: 0 }),
    trail: paintMaterial(['#4a5535'], { scale: 0.6, dirtTop: 0.42, snow: 0.6, gloss: 0.7, metal: 0.3, camo: false, dirtAmt: 0.35 }),
    dark: paintMaterial(['#1f2220'], { camo: false, snow: 0.3, gloss: 0.6, metal: 0.5, dirtAmt: 0 }),
    metal: std({ color: 0x5a5d61, roughness: 0.35, metalness: 0.9 }),
    bright: std({ color: 0x9a9da1, roughness: 0.22, metalness: 1 }),
    rubber: std({ color: 0x151515, roughness: 0.92 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x14202c, roughness: 0.03, metalness: 0.2, clearcoat: 1, envMapIntensity: 2 }),
    brass: std({ color: 0xb48a42, roughness: 0.3, metalness: 1 }),
    shell: std({ color: 0x4e5a38, roughness: 0.55, metalness: 0.3 }),
    copper: std({ color: 0x9a6a3a, roughness: 0.35, metalness: 1 }),
    red: std({ color: 0x8a1a12, roughness: 0.6 }),
    white: std({ color: 0xdedcd2, roughness: 0.6 }),
  };
}

// Снаряд ОФ-462 (для анимации заряжания и полёта)
export function shellGeometry(P) {
  const r = 0.061;
  P.add('shell', lathe([[0, -0.53], [r * 0.32, -0.52], [r * 0.6, -0.46], [r * 0.92, -0.36], [r, -0.3], [r, -0.03], [r * 0.9, 0], [0, 0]], { seg: 20 }));
  P.add('copper', lathe([[0, -0.06], [r * 1.02, -0.06], [r * 1.02, -0.04], [0, -0.04]], { seg: 20 }));
  P.add('metal', lathe([[0, -0.6], [0.016, -0.6], [0.02, -0.53], [0, -0.53]], { seg: 12 }));
  P.add('red', lathe([[0, -0.33], [r * 1.005, -0.33], [r * 1.005, -0.31], [0, -0.31]], { seg: 20 }));
}

export function buildD30() {
  const M = mats();
  const root = new THREE.Group();
  // ---------- нижний станок: опорная плита, станины, колёса ----------
  const L = new Parts();
  L.add('dark', lathe([[0, -0.45], [0.42, -0.45], [0.46, -0.4], [0.46, 0.4], [0.42, 0.45], [0, 0.45]].map(([r, z]) => [r, z * 0.12]), { seg: 28 }).rotateX(-Math.PI / 2).translate(0, 0.06, 0));
  L.add('paint', cylY(0.36, 0.08, 0.5, { seg: 24, r1: 0.3 }));
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + Math.PI / 3; // станины разведены под 120°
    const T = new Parts();
    // коробчатая балка, сужается к сошнику, лежит на грунте
    T.add('trail', loft([
      { p: [0, 0.32, -0.35], w: 0.3, h: 0.24, r: 0.03 },
      { p: [0, 0.26, -1.4], w: 0.24, h: 0.2, r: 0.03 },
      { p: [0, 0.17, -3.0], w: 0.18, h: 0.15, r: 0.025 },
    ], { seg: 2 }));
    T.add('dark', side([[-2.85, 0.2], [-3.2, 0.2, 0.02], [-3.2, -0.25, 0.02], [-3.05, -0.32]], 0.36, { bevel: 0.01 }));
    T.add('metal', torus(0.06, 0.015, { x: 0, y: 0.32, z: -2.9, axis: 'x' }));
    for (let i = 0; i < 4; i++) T.add('dark', rbox(0.2, 0.02, 0.05, 0, 0.37 - i * 0.02, -0.7 - i * 0.6, 0.006));
    const g = T.build(M);
    g.rotation.y = a;
    root.add(g);
  }
  for (const s of [-1, 1]) {
    // колёса вывешены над грунтом
    const wP = new Parts();
    wP.add('rubber', lathe([[0.36, -0.13], [0.5, -0.12], [0.56, -0.07], [0.57, 0.07], [0.5, 0.12], [0.36, 0.13]], { seg: 32 }).rotateY(Math.PI / 2));
    wP.add('paint', lathe([[0, -0.1], [0.37, -0.1], [0.37, 0.08], [0.12, 0.1], [0, 0.1]], { seg: 24 }).rotateY(Math.PI / 2));
    for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2; wP.add('rubber', rbox(0.27, 0.025, 0.06, 0, 0, 0, 0.006).translate(0, 0.575, 0).applyMatrix4(new THREE.Matrix4().makeRotationX(a))); }
    const w = wP.build(M);
    w.position.set(s * 0.95, 0.66, 0.15);
    root.add(w);
    L.add('dark', rbox(0.6, 0.12, 0.14, s * 0.55, 0.62, 0.15, 0.03));
  }
  root.add(L.build(M));

  // ---------- верхний станок (поворот по азимуту) ----------
  const yaw = new THREE.Group();
  yaw.position.y = 0;
  root.add(yaw);
  const U = new Parts();
  U.add('paint', cylY(0.42, 0.45, 0.62, { seg: 28 }));
  for (const s of [-1, 1]) U.add('paint', side([[-0.45, 0.55], [0.55, 0.55, 0.04], [0.5, 1.22, 0.06], [0.05, 1.28, 0.06], [-0.3, 0.95, 0.04]], 0.05, { x: s * 0.27, bevel: 0.012 }));
  U.add('paint', rbox(0.6, 0.06, 1.0, 0, 0.6, 0.05, 0.02));
  // щит: две половины с наклоном назад, вырез под ствол
  const shield = (x0, x1, y0, y1) => {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, 0.012);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, 0);
    g.applyMatrix4(new THREE.Matrix4().makeRotationX(-0.28));
    g.translate(0, 0.0, -0.62);
    return g;
  };
  U.add('paint', shield(-1.05, -0.2, 0.55, 1.62), shield(0.2, 1.05, 0.55, 1.62), shield(-0.2, 0.2, 0.55, 0.8), shield(-0.2, 0.2, 1.45, 1.62));
  for (const s of [-1, 1]) U.add('dark', rbox(0.04, 1.0, 0.04, s * 1.04, 1.08, -0.47, 0.01, { rx: -0.28 }));
  // окно панорамы в щите
  U.add('dark', rbox(0.18, 0.12, 0.02, -0.45, 1.5, -0.25, 0.01, { rx: -0.28 }));
  // маховики подъёмного и поворотного механизмов (слева)
  const wheel = (x, y, z, ax) => {
    const g = torus(0.13, 0.012, { seg: 24 });
    if (ax === 'x') g.rotateY(Math.PI / 2);
    g.translate(x, y, z);
    return g;
  };
  U.add('metal', wheel(-0.62, 0.95, 0.35, 'x'), wheel(-0.55, 0.75, 0.55, 'z'));
  U.add('metal', cylX(0.012, -0.62, -0.32, { y: 0.95, z: 0.35 }), cylZ(0.012, 0.55, 0.3, { x: -0.55, y: 0.75 }));
  U.add('bright', cylX(0.015, -0.66, -0.62, { y: 0.95 + 0.11, z: 0.35 }));
  // сиденье наводчика
  U.add('dark', rbox(0.28, 0.04, 0.24, -0.62, 0.62, 0.75, 0.02));
  U.add('metal', cylY(0.02, 0.45, 0.62, { x: -0.62, z: 0.75 }));
  // панорама ПГ-1М: стойка, головка, окуляр
  U.add('dark', cylY(0.035, 1.05, 1.42, { x: -0.42, z: 0.12 }));
  U.add('dark', rbox(0.1, 0.12, 0.12, -0.42, 1.48, 0.12, 0.02));
  U.add('dark', cylZ(0.035, 0.02, 0.24, { x: -0.42, y: 1.52 }));
  U.add('glass', cylZ(0.03, 0.0, 0.01, { x: -0.42, y: 1.52 }).translate(0, 0, 0.0));
  U.add('rubber', cylZ(0.03, 0.15, 0.24, { x: -0.42, y: 1.52 }).translate(0, 0, 0.04));
  U.add('metal', cylY(0.05, 1.32, 1.36, { x: -0.42, z: 0.12, seg: 24 }));
  yaw.add(U.build(M));

  // ---------- люлька и ствол (возвышение) ----------
  const pitch = new THREE.Group();
  pitch.position.copy(D30.trunnion);
  yaw.add(pitch);
  const C = new Parts();
  // обойма люльки вокруг ствола
  C.add('paint', loft([
    { p: [0, 0, 0.75], w: 0.36, h: 0.36, r: 0.08 },
    { p: [0, 0, 0.6], w: 0.38, h: 0.38, r: 0.1 },
    { p: [0, 0, -1.25], w: 0.34, h: 0.34, r: 0.1 },
    { p: [0, 0, -1.35], w: 0.3, h: 0.3, r: 0.08 },
  ], { seg: 4 }));
  // цапфы
  for (const s of [-1, 1]) C.add('metal', cylX(0.07, s * 0.19, s * 0.3, { seg: 18 }));
  // противооткатные устройства над стволом: тормоз отката и накатник
  for (const s of [-1, 1]) {
    C.add('paint', cylZ(0.072, 0.55, -2.25, { x: s * 0.09, y: 0.24, seg: 18 }));
    C.add('paint', lathe([[0, -2.33], [0.06, -2.33], [0.075, -2.27], [0.075, -2.25], [0, -2.25]], { x: s * 0.09, y: 0.24, seg: 18 }));
  }
  C.add('paint', rbox(0.36, 0.1, 0.25, 0, 0.2, -1.2, 0.03));
  // уравновешивающий механизм
  C.add('dark', cylZ(0.05, 0.3, -0.6, { x: 0.25, y: -0.12, seg: 14 }));
  // прицел прямой наводки ОП4М-45 и механический прицел (слева на люльке)
  C.add('dark', rbox(0.08, 0.2, 0.16, -0.26, 0.05, 0.25, 0.02));
  C.add('dark', cylZ(0.032, 0.62, 0.08, { x: -0.33, y: 0.12, seg: 16 }));
  C.add('rubber', cylZ(0.036, 0.62, 0.72, { x: -0.33, y: 0.12, seg: 16 }));
  C.add('glass', cylZ(0.028, 0.075, 0.07, { x: -0.33, y: 0.12, seg: 16 }));
  C.add('dark', rbox(0.06, 0.06, 0.1, -0.3, 0.2, 0.15, 0.01));
  pitch.add(C.build(M));
  // откатные части: ствол, казённик, клин, дульный тормоз
  const recoil = new THREE.Group();
  pitch.add(recoil);
  const B = new Parts();
  B.add('paint', lathe([[0, D30.muzzle + 0.45], [0.085, D30.muzzle + 0.45], [0.088, -1.4], [0.1, 0.5], [0.1, D30.breech - 0.45], [0, D30.breech - 0.45]], { seg: 28 }));
  // дульный тормоз (двухкамерный, с окнами)
  const mz = D30.muzzle;
  B.add('paint', lathe([[0, mz], [0.06, mz], [0.13, mz + 0.03], [0.13, mz + 0.16], [0.11, mz + 0.18], [0.11, mz + 0.23], [0.13, mz + 0.25], [0.13, mz + 0.38], [0.1, mz + 0.42], [0.1, mz + 0.5], [0, mz + 0.5]], { seg: 28 }));
  for (const s of [-1, 1]) for (const dz of [0.095, 0.315]) B.add('dark', rbox(0.02, 0.15, 0.1, s * 0.125, 0, mz + dz, 0.02));
  B.add('dark', cylZ(0.062, mz - 0.001, mz + 0.002, { seg: 20 }));
  // буксирная проушина под дульным тормозом
  B.add('dark', side([[mz + 0.12, -0.12], [mz + 0.35, -0.12], [mz + 0.3, -0.24, 0.03], [mz + 0.12, -0.24, 0.03]], 0.06));
  B.add('metal', torus(0.06, 0.018, { x: 0, y: -0.3, z: mz + 0.2, axis: 'x' }));
  // казённик и рукоятка
  const br = D30.breech;
  B.add('paint', rbox(0.38, 0.38, 0.48, 0, 0, br - 0.24, 0.04));
  B.add('dark', rbox(0.3, 0.06, 0.04, 0, 0.14, br + 0.005, 0.01));
  B.add('metal', cylX(0.02, 0.19, 0.32, { y: -0.05, z: br - 0.15 }));
  B.add('metal', rbox(0.04, 0.16, 0.03, 0.32, -0.12, br - 0.15, 0.01));
  recoil.add(B.build(M));
  // клин затвора (вертикальный, опускается при открывании)
  const wedgeP = new Parts();
  wedgeP.add('metal', rbox(0.24, 0.3, 0.16, 0, 0, 0, 0.02));
  wedgeP.add('dark', cylZ(0.065, 0.081, 0.083, { y: 0.0 }));
  const wedge = wedgeP.build(M);
  wedge.position.set(0, -0.02, br - 0.12);
  recoil.add(wedge);
  // гильза в каморе (видна при открытом затворе) и снаряд для заряжания
  const SP = new Parts();
  shellGeometry(SP);
  SP.add('brass', lathe([[0, 0.0], [0.062, 0.0], [0.062, 0.41], [0.066, 0.42], [0.064, 0.44], [0, 0.44]], { seg: 20 }));
  const round = SP.build(M);
  round.visible = false;
  root.add(round);
  // гильза для выброса
  const CP = new Parts();
  CP.add('brass', lathe([[0, 0.0], [0.055, 0.0], [0.062, 0.02], [0.062, 0.41], [0.066, 0.42], [0.064, 0.44], [0, 0.44]], { seg: 18 }));
  const casing = CP.build(M);
  casing.visible = false;
  root.add(casing);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, yaw, pitch, recoil, wedge, round, casing };
}
