// Модель 82-мм миномёта 2Б14-1 «Поднос»: круглая опорная плита с рёбрами и шаровой пятой,
// ствол 1,21 м с казёнником и дульным утолщением, обойма с двумя амортизаторами, двунога
// (ноги, цепь, подъёмный механизм), поворотный механизм и прицел МПМ-44М слева.
// Ноги двуноги и колонка строятся каждый кадр по углу возвышения (обойма скользит вверх).
import * as THREE from 'three';
import { lathe, cylZ, cylY, rbox, torus, gunMats, Parts } from '../weapons/gunkit.js';

export const MORTAR = {
  pivot: new THREE.Vector3(0, 0.09, 0), // шаровая пята на плите
  len: 1.21, muzzle: -1.15, collar: -0.72,
};

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _y = new THREE.Vector3(0, 1, 0);

// стержень между точками a и b (цилиндр единичной длины, ось Y)
function rodTo(mesh, a, b) {
  _a.subVectors(b, a);
  const L = _a.length();
  mesh.position.copy(a).addScaledVector(_a, 0.5);
  mesh.scale.set(1, Math.max(L, 1e-3), 1);
  mesh.quaternion.setFromUnitVectors(_y, _a.normalize());
}

export function buildMortar() {
  const M = gunMats();
  const root = new THREE.Group();
  // плита
  const PP = new Parts();
  PP.add('olive', lathe([[0.0, -0.01], [0.25, -0.01], [0.255, 0.0], [0.25, 0.025], [0.07, 0.05], [0.0, 0.05]], { seg: 32 }).rotateX(-Math.PI / 2));
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; PP.add('olive', rbox(0.02, 0.045, 0.17, Math.sin(a) * 0.14, 0.03, Math.cos(a) * 0.14, 0.004, { ry: a })); }
  PP.add('steel', torus(0.24, 0.008, { y: 0.012, axis: 'y', seg: 32 }));
  PP.add('steelDark', new THREE.SphereGeometry(0.045, 16, 12).translate(0, 0.07, 0));
  for (const a of [0.6, 2.6, 4.6]) PP.add('steel', rbox(0.06, 0.012, 0.03, Math.sin(a) * 0.235, 0.03, Math.cos(a) * 0.235, 0.003, { ry: a })); // ручки
  const plate = PP.build(M);
  root.add(plate);
  // ствол (группа на шаровой пяте, вращается по возвышению)
  const tube = new THREE.Group();
  tube.position.copy(MORTAR.pivot);
  const TP = new Parts();
  TP.add('olive', lathe([[0.0, 0.07], [0.032, 0.07], [0.056, 0.04], [0.058, -0.02], [0.054, -0.1], [0.049, -0.12], [0.0, -0.12]], { seg: 24 }));
  TP.add('olive', cylZ(0.049, -0.12, -1.11, { seg: 24 }));
  TP.add('olive', lathe([[0.0, -1.105], [0.054, -1.105], [0.056, -1.12], [0.054, -1.15], [0.0, -1.15]], { seg: 24 }));
  TP.add('black', cylZ(0.0412, -1.149, -1.152, { seg: 22 }));
  // обойма и амортизаторы
  TP.add('steel', cylZ(0.062, -0.68, -0.77, { seg: 22 }));
  for (const sx of [-1, 1]) {
    TP.add('steel', cylZ(0.017, -0.6, -0.86, { x: sx * 0.052, y: 0.052, seg: 12 }));
    TP.add('steelDark', cylZ(0.012, -0.86, -0.92, { x: sx * 0.052, y: 0.052, seg: 10 }));
  }
  // белая полоса и маркировка
  TP.add('paintWhite', cylZ(0.0495, -0.95, -0.965, { seg: 24 }));
  const tm = TP.build(M);
  tube.add(tm);
  root.add(tube);
  // двунога: ноги, колонка, цепь — стержни, перестраиваются по углу
  const rodG = new THREE.CylinderGeometry(0.016, 0.016, 1, 10);
  const colG = new THREE.CylinderGeometry(0.022, 0.026, 1, 12);
  const legL = new THREE.Mesh(rodG, M.olive), legR = new THREE.Mesh(rodG, M.olive), column = new THREE.Mesh(colG, M.steel);
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 1, 6), M.steelDark);
  const shoes = [];
  for (let i = 0; i < 2; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.1), M.steelDark); shoes.push(s); root.add(s); }
  root.add(legL, legR, column, chain);
  // поворотный механизм и прицел — на верху колонки
  const head = new THREE.Group();
  const HP = new Parts();
  HP.add('steel', rbox(0.24, 0.05, 0.07, 0, 0, 0, 0.012));
  for (const sx of [-1, 1]) HP.add('steelDark', cylY(0.006, -0.02, 0.06, { x: sx * 0.08, seg: 8 }));
  HP.add('steel', cylY(0.02, -0.02, 0.0, { x: 0.13, seg: 14 }));                 // маховик поворотного
  // прицел МПМ-44М слева: корпус, окуляр, головка, уровни
  HP.add('olive', rbox(0.05, 0.08, 0.07, -0.15, 0.06, 0.0, 0.008));
  HP.add('steelDark', cylY(0.016, 0.1, 0.14, { x: -0.15, z: 0.0, seg: 16 }));
  HP.add('lens', cylZ(0.011, 0.04, 0.05, { x: -0.15, y: 0.08, seg: 14 }));
  HP.add('rubber', cylZ(0.015, 0.05, 0.085, { x: -0.15, y: 0.08, seg: 14 }));
  HP.add('lens', rbox(0.03, 0.02, 0.004, -0.15, 0.125, -0.017, 0.002));
  HP.add('steelBright', cylZ(0.006, -0.02, 0.02, { x: -0.122, y: 0.03, seg: 8 }));
  head.add(HP.build(M));
  root.add(head);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  const T = { root, plate, tube, legL, legR, column, chain, shoes, head };
  // поза по возвышению (рад)
  T.pose = (el) => {
    tube.rotation.set(el, 0, 0);
    const C = _b.set(0, Math.sin(el) * -MORTAR.collar, Math.cos(el) * MORTAR.collar).add(MORTAR.pivot); // обойма
    const top = C.clone().add(new THREE.Vector3(0, -0.085, 0));
    const J = new THREE.Vector3(0, 0.32, top.z + 0.03);
    const FL = new THREE.Vector3(-0.3, 0.02, top.z - 0.2), FR = new THREE.Vector3(0.3, 0.02, top.z - 0.2);
    rodTo(legL, FL, J); rodTo(legR, FR, J); rodTo(column, J, top);
    rodTo(chain, FL.clone().setY(0.14).lerp(J, 0.25), FR.clone().setY(0.14).lerp(J, 0.25));
    shoes[0].position.copy(FL).setY(0.01); shoes[1].position.copy(FR).setY(0.01);
    head.position.copy(top).add(new THREE.Vector3(0, -0.02, 0));
  };
  T.sightEye = () => new THREE.Vector3(-0.15, 0.135, 0.07).add(T.head.position);
  T.pose(Math.PI / 4);
  return T;
}
