// Модель основного танка Т-72Б (обр. 1985 г.) по чертёжным размерам: корпус 6,86 м, ширина
// 3,59 м по экранам, высота 2,19 м по крыше башни, клиренс 0,47 м. Ходовая: 6 сдвоенных
// обрезиненных катков Ø750 мм на борт, 3 поддерживающих ролика, ленивец спереди, ведущее
// колесо сзади, гусеница шириной 580 мм с шагом трака 137 мм (траки — инстансы, бегут по
// контуру). Лобовой лист с блоками динамической защиты «Контакт-1», бортовые резинотканевые
// экраны, литая башня с «бровями» усиленной лобовой брони, 125-мм пушка 2А46М с эжектором и
// теплозащитным кожухом, командирская башенка с ТКН-3 и 12,7-мм НСВТ, прицел наводчика 1А40-1,
// прожектор Л-4, 902Б «Туча», бочки на корме, бревно, ОПВТ. Ось вперёд — −Z.
import * as THREE from 'three';
import { side, lathe, cylZ, cylX, cylY, rbox, torus, xf, Parts } from '../weapons/gunkit.js';
import { materials, buildTracks, paintMaterial } from './vehicleModels.js';

export const T72 = {
  ring: new THREE.Vector3(0, 1.47, -0.25),      // центр погона башни (корпус)
  trunnion: new THREE.Vector3(0, 0.36, -0.86),  // цапфы пушки (башня)
  muzzle: -5.0,                                 // дульный срез по оси ствола от цапф
  gunnerSight: new THREE.Vector3(-0.5, 0.86, -0.5),   // головка 1А40-1 (башня)
  cupola: new THREE.Vector3(0.5, 0.66, 0.12),          // командирская башенка (башня)
  driver: new THREE.Vector3(0, 1.5, -1.98),            // ТНПО-168В (корпус)
  wheelY: 0.41, wheelR: 0.375, trackX: 1.395,
};

// сдвоенный опорный каток: два диска с резиновыми бандажами, ступица; ось по X
function roadWheel(parent, x, y, z, r, M, { w = 0.2, gap = 0.07, spokes = 8 } = {}) {
  const steer = new THREE.Group(); steer.position.set(x, y, z);
  const spin = new THREE.Group(); steer.add(spin);
  const P = new Parts();
  for (const sx of [-1, 1]) {
    const xc = sx * (gap / 2 + w / 4);
    // бандаж (резина) и диск
    P.add('rubber', lathe([[r * 0.8, -w / 4], [r * 0.98, -w / 4], [r, -w / 4 + 0.01], [r, w / 4 - 0.01], [r * 0.98, w / 4], [r * 0.8, w / 4]], { seg: 32 }).rotateY(Math.PI / 2).translate(xc, 0, 0));
    P.add('rim', lathe([[0.0, -w / 4 + 0.012], [r * 0.82, -w / 4 + 0.01], [r * 0.82, w / 4 - 0.01], [r * 0.3, w / 4 + 0.02 * sx], [0, w / 4 + 0.03 * sx]], { seg: 28 }).rotateY(Math.PI / 2).translate(xc, 0, 0));
    // рёбра жёсткости диска
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      P.add('rim', rbox(0.02, r * 0.5, 0.035, xc + sx * (w / 4 + 0.006), Math.sin(a) * r * 0.5, Math.cos(a) * r * 0.5, 0.008, { rx: -a }));
    }
  }
  P.add('metal', lathe([[0, -gap / 2 - w / 2 - 0.03], [r * 0.16, -gap / 2 - w / 2 - 0.03], [r * 0.16, -gap / 2 - w / 2 + 0.02], [0, -gap / 2 - w / 2 + 0.02]], { seg: 16 }).rotateY(Math.PI / 2).translate(Math.sign(x) * 0, 0, 0));
  spin.add(P.build(M));
  parent.add(steer);
  return { steer, spin, r };
}

// ведущее колесо (сзади): два зубчатых венца по 12 зубьев, ступица с бортовой передачей
function sprocket(parent, x, y, z, r, M) {
  const steer = new THREE.Group(); steer.position.set(x, y, z);
  const spin = new THREE.Group(); steer.add(spin);
  const P = new Parts();
  for (const sx of [-1, 1]) {
    const xc = sx * 0.085;
    P.add('rim', lathe([[0, -0.025], [r * 0.86, -0.025], [r * 0.86, 0.025], [0, 0.025]], { seg: 28 }).rotateY(Math.PI / 2).translate(xc, 0, 0));
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      P.add('metal', rbox(0.05, 0.1, 0.07, xc, 0, 0, 0.012).translate(0, r * 0.9, 0).applyMatrix4(new THREE.Matrix4().makeRotationX(a)));
    }
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; P.add('dark', cylX(r * 0.14, xc - 0.03, xc + 0.03, { y: Math.sin(a) * r * 0.5, z: Math.cos(a) * r * 0.5, seg: 10 })); }
  }
  P.add('metal', cylX(r * 0.3, -0.16, 0.16, { seg: 18 }));
  P.add('rim', cylX(r * 0.42, -0.24, -0.12, { seg: 20 }).translate(Math.sign(x) > 0 ? 0.36 : 0, 0, 0));
  spin.add(P.build(M));
  parent.add(steer);
  return { steer, spin, r };
}

// башня: литой купол, в плане шире спереди («брови» усиленной лобовой брони), сзади скруглена
function turretShell() {
  const g = lathe([[1.0, 0.0], [1.02, 0.1], [0.99, 0.26], [0.9, 0.42], [0.74, 0.56], [0.48, 0.65], [0.0, 0.68]], { seg: 56 });
  // lathe строит вдоль −Z; повернуть ось вверх
  g.rotateX(-Math.PI / 2);
  const a = g.attributes.position;
  for (let i = 0; i < a.count; i++) {
    let x = a.getX(i), y = a.getY(i), z = a.getZ(i);
    if (y < 0) y = -y;
    const phi = Math.atan2(x, -z); // 0 — вперёд
    const ap = Math.abs(phi);
    // радиус по азимуту: лоб с «бровями» по обе стороны от амбразуры, борт, корма
    let R = 1.12;
    if (ap < 0.22) R = 1.14 + 0.16 * (ap / 0.22);
    else if (ap < 1.15) R = 1.3 - 0.18 * ((ap - 0.22) / 0.93);
    else if (ap < 2.2) R = 1.12 + 0.04 * Math.sin((ap - 1.15) * 3);
    else R = 1.12 + 0.12 * ((ap - 2.2) / 0.94);
    // лоб и «брови» — ниже и площе, корма — выше
    const hk = ap < 1.0 ? 0.86 + 0.14 * (ap / 1.0) : 1;
    a.setXYZ(i, x * R, y * hk * 1.06, z * R);
  }
  g.computeVertexNormals();
  return g;
}

export function buildT72(camoCols) {
  const PO = { scale: 0.3, dirtTop: 1.0, snow: 0.95, gloss: 0.7, metal: 0.38 };
  const M = materials(camoCols, PO);
  M.era = M.paint;
  // башня и пушка — своя краска (грязь снизу считается от земли, а не от погона)
  const MT = { ...M, paint: paintMaterial(camoCols, { ...PO, yOff: T72.ring.y }) }; MT.era = MT.paint;
  const MG = { ...M, paint: paintMaterial(camoCols, { ...PO, yOff: T72.ring.y + T72.trunnion.y }) };
  const g = new THREE.Group();
  const res = { group: g, wheels: [], turret: null, gun: null, mats: Object.values(M), parts: {} };
  const P = new Parts();
  // ---------- корпус ----------
  // нижняя часть между гусеницами: НЛД, ВЛД (68° от вертикали), крыша, корма
  P.add('paint', side([[-3.0, 0.47, 0.04], [-3.43, 0.88, 0.02], [-1.95, 1.47, 0.03], [3.28, 1.47, 0.03], [3.42, 1.34, 0.02], [3.42, 0.62, 0.04], [3.2, 0.47, 0.04]], 2.16, { bevel: 0.02 }));
  // ВЛД на всю ширину до надгусеничных полок
  P.add('paint', side([[-3.43, 0.88, 0.02], [-1.95, 1.47, 0.02], [-1.95, 1.4, 0.01], [-3.3, 0.86, 0.01]], 3.3, { bevel: 0.015 }));
  // надгусеничные полки, передние грязевые щитки, крылья
  for (const s of [-1, 1]) {
    P.add('paint', rbox(0.6, 0.035, 6.55, s * 1.42, 1.12, 0.05, 0.01));
    P.add('paint', rbox(0.6, 0.035, 0.5, s * 1.42, 1.0, -3.47, 0.01, { rx: 0.45 }));
    P.add('paint', rbox(0.04, 0.34, 6.5, s * 1.1, 1.3, 0.07, 0.01)); // борт корпуса над гусеницей
  }
  // резинотканевые бортовые экраны (закрывают верхнюю ветвь гусеницы)
  for (const s of [-1, 1]) {
    P.add('rubber', rbox(0.022, 0.5, 6.45, s * 1.73, 0.88, 0.02, 0.006));
    for (let i = 0; i < 6; i++) P.add('dark', rbox(0.026, 0.48, 0.012, s * 1.73, 0.88, -2.6 + i * 1.05, 0.002));
    P.add('paint', rbox(0.05, 0.04, 6.45, s * 1.715, 1.12, 0.02, 0.008)); // кромка крепления
  }
  // ДЗ «Контакт-1» на ВЛД: три ряда в шахматном порядке
  const a = Math.atan2(0.59, 1.48), nY = Math.cos(a), nZ = -Math.sin(a);
  for (let row = 0; row < 3; row++) {
    const u = 0.22 + row * 0.42; // от носа вдоль листа
    const z0 = -3.43 + u * Math.cos(a), y0 = 0.88 + u * Math.sin(a);
    const n = row % 2 ? 7 : 8;
    for (let i = 0; i < n; i++) {
      const x = -1.33 + (i + (row % 2 ? 0.5 : 0)) * 0.38;
      P.add('era', rbox(0.34, 0.075, 0.36, x, y0 + nY * 0.045, z0 + nZ * 0.045, 0.012, { rx: -a }));
    }
  }
  // отвал самоокапывания под носом, буксирные крюки
  P.add('paint', rbox(2.3, 0.1, 0.26, 0, 0.78, -3.5, 0.02, { rx: 0.5 }));
  for (const s of [-1, 1]) {
    P.add('metal', torus(0.07, 0.022, { x: s * 0.75, y: 0.74, z: -3.36, axis: 'x', seg: 12 }));
    P.add('metal', torus(0.07, 0.022, { x: s * 0.75, y: 0.7, z: 3.48, axis: 'x', seg: 12 }));
  }
  // фары и габариты на ВЛД слева
  for (const x of [-1.05, -0.8]) {
    P.add('dark', rbox(0.16, 0.12, 0.12, x, 1.27, -2.38, 0.02));
    P.add('lens', cylZ(0.05, -2.45, -2.44, { x, y: 1.27, seg: 14 }));
  }
  // люк и ТНПО-168В механика-водителя
  P.add('paint', cylY(0.3, 1.47, 1.53, { x: 0, z: -1.6, seg: 24 }));
  P.add('dark', rbox(0.26, 0.09, 0.12, 0, 1.54, -1.94, 0.015));
  P.add('glass', rbox(0.22, 0.06, 0.01, 0, 1.54, -2.0, 0.003, { rx: 0.35 }));
  // МТО: решётки воздухопритока и жалюзи над радиаторами
  for (let i = 0; i < 9; i++) P.add('dark', rbox(1.7, 0.02, 0.07, 0, 1.485, 1.25 + i * 0.2, 0.004));
  P.add('paint', rbox(1.9, 0.03, 0.6, 0, 1.49, 0.75, 0.01));
  // выхлоп слева сзади на полке
  P.add('dark', rbox(0.24, 0.2, 0.55, -1.5, 1.2, 2.2, 0.02));
  for (let i = 0; i < 4; i++) P.add('metal', rbox(0.25, 0.012, 0.012, -1.5, 1.14 + i * 0.045, 1.95, 0.002));
  // наружные топливные баки и ящики ЗИП на полках
  for (let i = 0; i < 3; i++) P.add('paint', rbox(0.48, 0.36, 0.95, 1.43, 1.32, -1.75 + i * 1.12, 0.05));
  P.add('paint', rbox(0.48, 0.32, 1.1, -1.43, 1.3, -1.6, 0.04));
  P.add('paint', rbox(0.48, 0.3, 0.8, -1.43, 1.29, -0.2, 0.04));
  P.add('paint', rbox(0.48, 0.34, 0.75, -1.43, 1.31, 0.9, 0.05));
  // бочки на корме (2×200 л) и бревно самовытаскивания
  for (const s of [-1, 1]) {
    P.add('paint', cylX(0.29, s * 0.45, s * 1.38, { y: 1.15, z: 3.62, seg: 22 }));
    P.add('metal', torus(0.29, 0.012, { x: s * 0.62, y: 1.15, z: 3.62, axis: 'x', seg: 22 }));
    P.add('metal', torus(0.29, 0.012, { x: s * 1.2, y: 1.15, z: 3.62, axis: 'x', seg: 22 }));
    P.add('metal', rbox(0.05, 0.4, 0.3, s * 0.92, 0.85, 3.52, 0.01));
  }
  P.add('canvas', cylX(0.12, -1.6, 1.6, { y: 1.62, z: 3.18, seg: 14 }));
  for (const s of [-1, 1]) P.add('metal', rbox(0.04, 0.2, 0.04, s * 1.3, 1.55, 3.18, 0.005));
  // буксирные тросы вдоль бортов
  for (const s of [-1, 1]) P.add('metal', cylZ(0.016, -2.9, 2.9, { x: s * 1.13, y: 1.5, seg: 6 }));
  // ---------- ходовая ----------
  const Y = T72.wheelY, R = T72.wheelR, X = T72.trackX;
  const WZ = [-2.0, -1.2, -0.4, 0.4, 1.2, 2.0];
  for (const s of [-1, 1]) {
    for (const z of WZ) res.wheels.push(roadWheel(g, s * X, Y, z, R, M));
    // поддерживающие ролики
    for (const z of [-1.55, 0.0, 1.55]) res.wheels.push(roadWheel(g, s * X, 0.95, z, 0.11, M, { w: 0.12, gap: 0.08, spokes: 0 }));
    // ленивец спереди
    res.wheels.push(roadWheel(g, s * X, 0.56, -2.95, 0.29, M, { w: 0.16, gap: 0.08, spokes: 6 }));
    // ведущее колесо сзади
    res.wheels.push(sprocket(g, s * X, 0.62, 2.95, 0.33, M));
    for (const w of res.wheels) if (w.side === undefined) w.side = s;
    // балансиры (торсионная подвеска)
    for (const z of WZ) P.add('metal', rbox(0.08, 0.08, 0.42, s * 1.12, Y + 0.12, z - 0.18, 0.02, { rx: 0.4 }));
  }
  res.wheels.forEach((w, i) => { w.i = i; });
  const t = 0.035;
  const C = [];
  for (let i = WZ.length - 1; i >= 0; i--) C.push({ c: [WZ[i], Y], r: R + t });
  C.push({ c: [-2.95, 0.56], r: 0.29 + t });
  for (const z of [-1.55, 0.0, 1.55]) C.push({ c: [z, 0.95], r: 0.11 + t });
  C.push({ c: [2.95, 0.62], r: 0.33 + t });
  res.tracks = buildTracks(g, M, { circles: C, pitch: 0.137, width: 0.58, x: X, ridges: 2 });
  g.add(P.build(M));

  // ---------- башня ----------
  const tur = new THREE.Group();
  tur.position.copy(T72.ring);
  const TP = new Parts();
  TP.add('paint', turretShell());
  // погон и подбашенный лист
  TP.add('paint', cylY(1.08, -0.04, 0.04, { seg: 40 }));
  // амбразура пушки
  TP.add('dark', rbox(0.46, 0.36, 0.3, 0, 0.34, -1.08, 0.08));
  // ДЗ «Контакт-1» на лбу и крыше башни: «ёлочкой» по обе стороны от пушки
  for (const s of [-1, 1]) {
    for (let k = 0; k < 2; k++) {
      for (let i = 0; i < 5; i++) {
        const phi = s * (0.32 + i * 0.17), rr = 1.12 - k * 0.27;
        const x = Math.sin(phi) * rr, z = -Math.cos(phi) * rr;
        TP.add('era', rbox(0.3, 0.075, 0.24, x, 0.6 - k * 0.04 + (k ? 0.04 : 0), z, 0.012, { ry: -phi, rx: 0.12 }));
      }
    }
    // лобовые блоки по бокам амбразуры, вертикально
    for (let i = 0; i < 2; i++) TP.add('era', rbox(0.25, 0.3, 0.075, s * (0.38 + i * 0.27), 0.3, -1.3 + i * 0.07, 0.012, { ry: s * 0.25 }));
  }
  // прицел наводчика 1А40-1 (головка с защитными створками) и 1К13 слева
  const gs = T72.gunnerSight;
  TP.add('paint', rbox(0.3, 0.24, 0.36, gs.x, gs.y - 0.08, gs.z + 0.05, 0.03));
  TP.add('glass', rbox(0.2, 0.12, 0.012, gs.x, gs.y - 0.06, gs.z - 0.135, 0.004));
  TP.add('paint', rbox(0.3, 0.035, 0.18, gs.x, gs.y + 0.05, gs.z - 0.08, 0.008, { rx: -0.35 }));
  TP.add('paint', rbox(0.2, 0.2, 0.26, gs.x - 0.3, gs.y - 0.1, gs.z + 0.12, 0.03));
  TP.add('glass', rbox(0.12, 0.1, 0.01, gs.x - 0.3, gs.y - 0.08, gs.z - 0.01, 0.003));
  // люк наводчика
  TP.add('paint', cylY(0.3, 0.62, 0.7, { x: -0.5, z: 0.22, seg: 24 }));
  TP.add('metal', rbox(0.3, 0.03, 0.03, -0.5, 0.72, 0.38, 0.005));
  // 902Б «Туча»: по 4 мортирки слева и справа на лобовой части
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) {
    const phi = s * (0.98 + i * 0.12), rr = 1.12;
    const x = Math.sin(phi) * rr, z = -Math.cos(phi) * rr;
    const tg = new THREE.CylinderGeometry(0.045, 0.045, 0.24, 12);
    tg.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-Math.PI / 2 + 0.35, -phi, 0, 'YXZ')));
    tg.translate(x * 1.03, 0.52, z * 1.03);
    TP.add('dark', tg);
  }
  // ящики ЗИП по бортам и на корме башни, ОПВТ (труба) на корме
  for (const s of [-1, 1]) TP.add('paint', rbox(0.3, 0.32, 0.8, s * 1.12, 0.22, 0.45, 0.04, { ry: s * -0.35 }));
  TP.add('paint', rbox(1.2, 0.34, 0.32, 0.15, 0.24, 1.18, 0.05));
  TP.add('paint', cylX(0.11, -1.0, 0.3, { y: 0.52, z: 1.12, seg: 16 }));
  for (const x of [-0.8, -0.2]) TP.add('metal', rbox(0.04, 0.16, 0.2, x, 0.44, 1.12, 0.005));
  // поручни
  for (const s of [-1, 1]) TP.add('metal', torus(0.35, 0.012, { x: s * 0.78, y: 0.5, z: 0.15, axis: 'x', arc: Math.PI, seg: 12 }).rotateY(0).translate(0, 0, 0));
  tur.add(TP.build(MT));
  // командирская башенка (вращается сама) с ТКН-3, приборами ТНП, люком и НСВТ
  const cup = new THREE.Group();
  cup.position.copy(T72.cupola);
  const CP = new Parts();
  CP.add('paint', cylY(0.4, 0.0, 0.12, { seg: 30 }));
  CP.add('paint', cylY(0.36, 0.12, 0.16, { seg: 30 }));
  CP.add('paint', rbox(0.3, 0.2, 0.2, 0, 0.17, -0.34, 0.03));      // ТКН-3
  CP.add('glass', rbox(0.2, 0.08, 0.01, 0, 0.21, -0.445, 0.003));
  for (const a2 of [-1.1, 1.1, 2.4, -2.4]) CP.add('glass', rbox(0.12, 0.05, 0.01, Math.sin(a2) * 0.4, 0.09, -Math.cos(a2) * 0.4, 0.002, { ry: -a2 }));
  // ОУ-3ГА2 (ИК-осветитель) слева на башенке
  CP.add('dark', cylZ(0.11, -0.2, -0.42, { x: -0.36, y: 0.22, seg: 18 }));
  CP.add('lens', cylZ(0.095, -0.42, -0.425, { x: -0.36, y: 0.22, seg: 18 }));
  // станок и НСВТ «Утёс»
  CP.add('metal', rbox(0.06, 0.3, 0.06, 0.2, 0.3, -0.12, 0.01));
  CP.add('dark', rbox(0.14, 0.14, 0.6, 0.2, 0.5, -0.1, 0.02));
  CP.add('dark', cylZ(0.022, -0.4, -1.3, { x: 0.2, y: 0.52, seg: 10 }));
  CP.add('dark', cylZ(0.035, -1.22, -1.36, { x: 0.2, y: 0.52, seg: 12 }));
  CP.add('paint', rbox(0.12, 0.2, 0.26, 0.34, 0.45, -0.05, 0.02)); // коробка с лентой
  cup.add(CP.build(MT));
  // крышка люка (открывается вверх-назад)
  const lid = new THREE.Group(); lid.position.set(0, 0.17, 0.3);
  const LP = new Parts();
  LP.add('paint', cylY(0.31, -0.02, 0.03, { z: -0.3, seg: 24 }));
  LP.add('metal', cylX(0.025, -0.15, 0.15, { seg: 8 }));
  lid.add(LP.build(MT));
  cup.add(lid);
  tur.add(cup);
  // ---------- пушка 2А46М ----------
  const gun = new THREE.Group();
  gun.position.copy(T72.trunnion);
  const GP = new Parts();
  // защитный чехол маски (брезент) и маска
  GP.add('canvas', lathe([[0.2, -0.12], [0.22, -0.2], [0.17, -0.32], [0.13, -0.38]], { seg: 22 }));
  // ствол: теплозащитный кожух сегментами с хомутами, эжектор, дульная часть
  GP.add('paint', cylZ(0.098, -0.36, -2.25, { seg: 22 }));
  for (const z of [-0.8, -1.3, -1.8]) GP.add('metal', cylZ(0.104, z, z - 0.04, { seg: 22 }));
  GP.add('paint', lathe([[0.098, -2.25], [0.128, -2.36], [0.13, -2.9], [0.1, -3.02]], { seg: 24 }));
  GP.add('paint', cylZ(0.094, -3.02, -4.62, { seg: 22 }));
  for (const z of [-3.5, -4.05]) GP.add('metal', cylZ(0.1, z, z - 0.035, { seg: 22 }));
  GP.add('steelDark' in M ? 'steelDark' : 'metal', lathe([[0.09, -4.62], [0.085, -4.98], [0.07, -5.0], [0.0, -5.0]], { seg: 22 }));
  GP.add('dark', cylZ(0.0625, -4.995, -5.002, { seg: 20 }));
  // спаренный ПКТ справа от пушки
  GP.add('dark', cylZ(0.016, -0.3, -0.6, { x: 0.3, y: 0.0, seg: 8 }));
  // прожектор Л-4 справа (качается с пушкой)
  GP.add('paint', cylZ(0.17, -0.1, -0.36, { x: 0.62, y: 0.16, seg: 22 }));
  GP.add('lens', cylZ(0.15, -0.36, -0.365, { x: 0.62, y: 0.16, seg: 22 }));
  GP.add('metal', rbox(0.08, 0.06, 0.3, 0.45, 0.12, -0.2, 0.01));
  gun.add(GP.build(MG));
  tur.add(gun);
  g.add(tur);
  res.turret = tur; res.gun = gun; res.cupola = cup; res.lid = lid;
  res.steerWheels = [];
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  void xf;
  return res;
}
