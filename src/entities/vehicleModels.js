// Детализированные модели техники: корпус по боковому профилю (выдавливание с фаской),
// колёсные арки, остекление, решётки, фары, бамперы, запаска, турели, гусеницы.
// Колесо = группа поворота (ось Y) → группа вращения (ось X): руль и качение не смешиваются.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { camoTexture } from '../world/textures.js';
import { texture as texAsset } from '../core/assets.js';

const cache = {};
function tex(key, w, h, draw, repeat = true) {
  if (cache[key]) return cache[key];
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  cache[key] = t;
  return t;
}

function treadTexture() {
  return tex('tread', 128, 64, (g, w, h) => {
    g.fillStyle = '#1b1b1c'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#0c0c0c';
    for (let i = 0; i < 8; i++) {
      const x = i * 16;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 8, h / 2); g.lineTo(x, h); g.lineTo(x + 5, h); g.lineTo(x + 13, h / 2); g.lineTo(x + 5, 0); g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, h * 0.45, w, 2);
    for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(230,235,240,${Math.random() * 0.25})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  });
}
function trackTexture() {
  return tex('track', 64, 64, (g, w, h) => {
    g.fillStyle = '#26282a'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) {
      g.fillStyle = '#3a3c3f'; g.fillRect(0, y + 1, w, 11);
      g.fillStyle = '#18191a'; g.fillRect(0, y + 12, w, 4);
      g.fillStyle = '#4b4d50'; g.fillRect(w * 0.42, y + 3, w * 0.16, 7);
    }
    for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(235,240,245,${Math.random() * 0.35})`; g.fillRect(Math.random() * w, Math.random() * h, 3, 2); }
  });
}
function grilleTexture() {
  return tex('grille', 128, 64, (g, w, h) => {
    g.fillStyle = '#121314'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#3a3d40';
    for (let x = 4; x < w; x += 10) g.fillRect(x, 4, 4, h - 8);
  }, false);
}
function plateTexture(text) {
  return tex('plate' + text, 256, 64, (g, w, h) => {
    g.fillStyle = '#f0f0ea'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#111'; g.lineWidth = 4; g.strokeRect(3, 3, w - 6, h - 6);
    g.fillStyle = '#111'; g.font = 'bold 40px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 2);
  }, false);
}

// Боковой профиль: точки [l, h] (l — вдоль корпуса, + назад) → выдавливание на ширину
function hullFromProfile(pts, width, bevel, mat) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(-Math.PI / 2);
  // UV по мировым метрам для камуфляжа
  const p = g.attributes.position, uv = g.attributes.uv, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    if (ax > 0.6) uv.setXY(i, p.getZ(i) / 2.2, p.getY(i) / 2.2);
    else if (ay > 0.6) uv.setXY(i, p.getX(i) / 2.2, p.getZ(i) / 2.2);
    else uv.setXY(i, p.getX(i) / 2.2, p.getY(i) / 2.2);
  }
  const m = new THREE.Mesh(g, mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

// Колёсная арка: дуга точек вокруг (cz, cy) от l0 к l1 по верху
function arch(cz, cy, r, bottom) {
  const pts = [];
  const a0 = Math.asin(Math.min(1, (bottom - cy) / r));
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI - a0 - (i / 10) * (Math.PI - 2 * a0);
    pts.push([cz - Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts; // от задней кромки арки к передней (l убывает)
}

function makeWheel(parent, r, w, x, y, z, M, { hubs = 6, mirror = false } = {}) {
  const steer = new THREE.Group(); steer.position.set(x, y, z);
  const spin = new THREE.Group(); steer.add(spin);
  // шина с протектором
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 28, 1, true), M.tread);
  tire.rotation.z = Math.PI / 2; tire.castShadow = true; spin.add(tire);
  const side = new THREE.Mesh(new THREE.TorusGeometry(r * 0.86, r * 0.16, 8, 26), M.tire);
  for (const sx of [-1, 1]) { const t = side.clone(); t.rotation.y = Math.PI / 2; t.position.x = sx * w * 0.42; spin.add(t); }
  const disk = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, w * 0.86, 20), M.rim);
  disk.rotation.z = Math.PI / 2; spin.add(disk);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.24, r * 0.3, w * 0.98, 12), M.metal);
  hub.rotation.z = Math.PI / 2; spin.add(hub);
  for (let i = 0; i < hubs; i++) {
    const a = (i / hubs) * Math.PI * 2;
    const b = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.04, r * 0.04, w + 0.01, 6), M.metal);
    b.rotation.z = Math.PI / 2; b.position.set(0, Math.sin(a) * r * 0.42, Math.cos(a) * r * 0.42); spin.add(b);
  }
  parent.add(steer);
  return { steer, spin, r };
}

function box(parent, w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0, rad = 0) {
  const g = rad > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(rad, w / 2, h / 2, d / 2) * 0.99) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m); return m;
}
function cyl(parent, r0, r1, h, mat, x, y, z, axis = 'y', seg = 16) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), mat);
  if (axis === 'x') m.rotation.z = Math.PI / 2; else if (axis === 'z') m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
}

function materials(type, camoCols) {
  const camo = new THREE.MeshStandardMaterial({ map: camoTexture(camoCols, 'veh2' + type, 2.2), roughness: 0.62, metalness: 0.28 });
  // потёртости и вмятины: нормали и шероховатость от реального листового металла
  const nm = texAsset('green_metal_rust_nor.jpg', { srgb: false, repeat: 1 }), rm = texAsset('green_metal_rust_rough.jpg', { srgb: false, repeat: 1 });
  if (nm) { camo.normalMap = nm; camo.normalScale = new THREE.Vector2(0.6, 0.6); camo.roughnessMap = rm; camo.roughness = 0.9; }
  return {
    camo,
    dark: new THREE.MeshStandardMaterial({ color: 0x1d1f21, roughness: 0.75, metalness: 0.3, normalMap: texAsset('rusty_metal_02_nor.jpg', { srgb: false }) || null }),
    metal: new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.4, metalness: 0.8 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.2, metalness: 0.95 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0f1a24, roughness: 0.05, metalness: 0.9, envMapIntensity: 1.6 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x171718, roughness: 0.92 }),
    tread: new THREE.MeshStandardMaterial({ map: treadTexture(), roughness: 0.95 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x3e4a33, roughness: 0.55, metalness: 0.5 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff0c0, emissiveIntensity: 1.4, roughness: 0.1 }),
    red: new THREE.MeshStandardMaterial({ color: 0x8a0f0a, emissive: 0x400000, roughness: 0.3 }),
    grille: new THREE.MeshStandardMaterial({ map: grilleTexture(), roughness: 0.6, metalness: 0.4 }),
    track: new THREE.MeshStandardMaterial({ map: (() => { const t = trackTexture().clone(); t.needsUpdate = true; return t; })(), roughness: 0.85, metalness: 0.45 }),
    snow: new THREE.MeshStandardMaterial({ color: 0xf2f5fa, roughness: 0.9 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.95 }),
  };
}

// Окно на боковой поверхности: стекло + рамка
function sideWindow(parent, M, x, y, z, w, h, side) {
  box(parent, 0.04, h + 0.08, w + 0.08, M.dark, x + side * 0.005, y, z);
  box(parent, 0.04, h, w, M.glass, x + side * 0.02, y, z);
}

export function buildTigr(camoCols) {
  const M = materials('tigr', camoCols);
  const g = new THREE.Group();
  const res = { group: g, wheels: [], turret: null, gun: null, mats: Object.values(M) };
  const bottom = 0.62;
  const rear = arch(1.65, 0.56, 0.72, bottom), front = arch(-1.65, 0.56, 0.72, bottom);
  const prof = [[2.85, bottom], [2.4, bottom], ...rear.slice(1, -1), [0.9, bottom], [-0.9, bottom], ...front.slice(1, -1), [-2.4, bottom], [-2.86, bottom + 0.05],
    [-2.88, 1.12], [-2.72, 1.36], [-1.3, 1.46], [-0.92, 2.22], [-0.7, 2.32], [2.7, 2.34], [2.86, 2.22], [2.88, 0.75]];
  g.add(hullFromProfile(prof.reverse(), 2.26, 0.07, M.camo));
  // лобовое стекло (две половины), боковые окна
  for (const sx of [-0.48, 0.48]) {
    const ws = box(g, 0.9, 0.62, 0.04, M.glass, sx, 1.86, -1.11, -0.6);
    box(g, 0.94, 0.68, 0.03, M.dark, sx, 1.86, -1.105, -0.6);
    ws.position.z -= 0.012;
  }
  for (const s of [-1, 1]) {
    sideWindow(g, M, s * 1.13, 1.92, -0.35, 0.62, 0.42, s);
    sideWindow(g, M, s * 1.13, 1.92, 0.65, 0.62, 0.42, s);
    sideWindow(g, M, s * 1.13, 1.92, 1.75, 0.55, 0.36, s);
    // двери, ручки, подножки
    box(g, 0.02, 1.2, 0.02, M.dark, s * 1.14, 1.55, 0.12);
    box(g, 0.02, 1.2, 0.02, M.dark, s * 1.14, 1.55, 1.25);
    box(g, 0.05, 0.04, 0.16, M.metal, s * 1.15, 1.55, -0.1);
    box(g, 0.05, 0.04, 0.16, M.metal, s * 1.15, 1.55, 1.0);
    box(g, 0.26, 0.05, 1.6, M.dark, s * 1.16, 0.62, 0.0);
    // расширители арок
    for (const az of [-1.65, 1.65]) {
      const fl = new THREE.Mesh(new THREE.TorusGeometry(0.74, 0.06, 6, 16, Math.PI), M.dark);
      fl.rotation.y = Math.PI / 2; fl.position.set(s * 1.13, 0.56, az); g.add(fl);
    }
    // зеркала
    box(g, 0.05, 0.22, 0.16, M.dark, s * 1.32, 1.95, -0.85);
    box(g, 0.25, 0.03, 0.03, M.dark, s * 1.2, 1.9, -0.85);
  }
  // решётка, фары, бампер, лебёдка
  const gr = box(g, 1.2, 0.42, 0.04, M.grille, 0, 1.08, -2.885); gr.castShadow = false;
  for (const s of [-1, 1]) {
    cyl(g, 0.11, 0.11, 0.06, M.dark, s * 0.86, 1.13, -2.87, 'z', 18);
    cyl(g, 0.09, 0.09, 0.07, M.lamp, s * 0.86, 1.13, -2.88, 'z', 18);
    box(g, 0.12, 0.06, 0.04, M.lamp, s * 0.6, 0.86, -2.89);
    box(g, 0.14, 0.18, 0.04, M.red, s * 1.0, 1.0, 2.9);
    box(g, 0.08, 0.3, 0.12, M.metal, s * 0.65, 0.68, -3.0);
  }
  box(g, 2.3, 0.22, 0.2, M.dark, 0, 0.68, -2.98, 0, 0, 0, 0.04);
  cyl(g, 0.11, 0.11, 0.7, M.metal, 0, 0.78, -3.02, 'x');
  box(g, 2.3, 0.2, 0.16, M.dark, 0, 0.66, 2.95, 0, 0, 0, 0.04);
  const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.12), new THREE.MeshStandardMaterial({ map: plateTexture('2741 ВН'), roughness: 0.6 }));
  pl.position.set(0, 0.86, -2.92); pl.rotation.y = Math.PI; g.add(pl);
  // запаска на задней двери
  const sp = makeWheel(g, 0.48, 0.32, 0, 1.55, 3.08, M);
  sp.steer.rotation.y = Math.PI / 2;
  // крыша: багажник, антенна, люк и турель с ПКП
  box(g, 1.7, 0.05, 1.3, M.dark, 0, 2.39, 1.6);
  for (const s of [-1, 1]) box(g, 0.04, 0.08, 1.3, M.metal, s * 0.85, 2.42, 1.6);
  cyl(g, 0.012, 0.006, 2.2, M.dark, 0.95, 3.4, 2.4);
  const tur = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.07, 10, 28), M.dark); ring.rotation.x = Math.PI / 2; tur.add(ring);
  const gun = new THREE.Group();
  box(gun, 0.08, 0.12, 0.5, M.dark, 0, 0, -0.12);
  cyl(gun, 0.018, 0.018, 0.75, M.dark, 0, 0.01, -0.7, 'z', 10);
  cyl(gun, 0.026, 0.022, 0.1, M.dark, 0, 0.01, -1.08, 'z', 10);
  box(gun, 0.12, 0.14, 0.14, new THREE.MeshStandardMaterial({ color: 0x3e4a33, roughness: 0.7 }), 0.1, -0.08, -0.05);
  const shield = box(gun, 0.62, 0.42, 0.03, M.camo, 0, 0.06, -0.42, -0.12);
  box(gun, 0.16, 0.1, 0.035, M.glass, 0, 0.16, -0.43, -0.12);
  shield.castShadow = true;
  gun.position.set(0, 0.35, -0.2);
  tur.add(gun);
  tur.position.set(0, 2.36, 0.55);
  g.add(tur);
  res.turret = tur; res.gun = gun;
  for (const [x, z] of [[-1.05, -1.65], [1.05, -1.65], [-1.05, 1.65], [1.05, 1.65]]) res.wheels.push(makeWheel(g, 0.56, 0.38, x, 0.56, z, M));
  res.steerWheels = [res.wheels[0], res.wheels[1]];
  return res;
}

export function buildNiva(camoCols) {
  const M = materials('niva', camoCols);
  M.camo.metalness = 0.45; M.camo.roughness = 0.4;
  const g = new THREE.Group();
  const res = { group: g, wheels: [], turret: null, gun: null, mats: Object.values(M) };
  const bottom = 0.42;
  const rear = arch(1.1, 0.34, 0.43, bottom), front = arch(-1.1, 0.34, 0.43, bottom);
  const prof = [[1.86, bottom + 0.04], [1.55, bottom], ...rear.slice(1, -1), [0.65, bottom], [-0.65, bottom], ...front.slice(1, -1), [-1.55, bottom], [-1.86, bottom + 0.05],
    [-1.87, 0.84], [-1.8, 0.93], [-0.78, 0.99], [-0.3, 1.52], [-0.18, 1.58], [1.62, 1.6], [1.8, 1.52], [1.86, 1.0]];
  g.add(hullFromProfile(prof.reverse(), 1.64, 0.05, M.camo));
  box(g, 1.44, 0.56, 0.04, M.glass, 0, 1.27, -0.54, -0.86);
  box(g, 1.3, 0.42, 0.04, M.glass, 0, 1.3, 1.85, 0.25);
  for (const s of [-1, 1]) {
    sideWindow(g, M, s * 0.82, 1.3, 0.12, 0.85, 0.38, s);
    sideWindow(g, M, s * 0.82, 1.3, 1.05, 0.65, 0.36, s);
    box(g, 0.02, 0.85, 0.02, M.dark, s * 0.83, 0.95, 0.62);
    box(g, 0.04, 0.03, 0.14, M.chrome, s * 0.84, 1.05, 0.48);
    box(g, 0.05, 0.16, 3.2, M.dark, s * 0.83, 0.52, 0);
    cyl(g, 0.09, 0.09, 0.05, M.chrome, s * 0.55, 0.82, -1.875, 'z', 18);
    cyl(g, 0.075, 0.075, 0.06, M.lamp, s * 0.55, 0.82, -1.885, 'z', 18);
    box(g, 0.1, 0.16, 0.03, M.red, s * 0.7, 0.85, 1.87);
    box(g, 0.04, 0.14, 0.11, M.dark, s * 0.92, 1.18, -0.42);
    for (const az of [-1.1, 1.1]) {
      const fl = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.035, 6, 16, Math.PI), M.dark);
      fl.rotation.y = Math.PI / 2; fl.position.set(s * 0.82, 0.34, az); g.add(fl);
    }
  }
  const gr = box(g, 0.75, 0.2, 0.03, M.grille, 0, 0.82, -1.875); gr.castShadow = false;
  box(g, 1.7, 0.14, 0.14, M.chrome, 0, 0.5, -1.92, 0, 0, 0, 0.03);
  box(g, 1.7, 0.14, 0.14, M.chrome, 0, 0.5, 1.92, 0, 0, 0, 0.03);
  const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.11), new THREE.MeshStandardMaterial({ map: plateTexture('А 117 МР'), roughness: 0.6 }));
  pl.position.set(0, 0.62, -1.995); pl.rotation.y = Math.PI; g.add(pl);
  // багажник на крыше с канистрой и снегом
  for (const s of [-1, 1]) box(g, 0.03, 0.06, 1.5, M.dark, s * 0.62, 1.66, 0.6);
  for (let i = 0; i < 4; i++) box(g, 1.26, 0.03, 0.03, M.dark, 0, 1.68, 0.0 + i * 0.4);
  box(g, 0.32, 0.22, 0.44, new THREE.MeshStandardMaterial({ color: 0x3f5a2a, roughness: 0.6, metalness: 0.3 }), -0.25, 1.81, 0.5, 0, 0, 0, 0.03);
  box(g, 0.6, 0.1, 0.5, M.snow, 0.25, 1.73, 1.0, 0, 0.3, 0, 0.05);
  box(g, 0.12, 0.05, 0.3, M.dark, 0, 1.59, -0.15);
  for (const [x, z] of [[-0.72, -1.1], [0.72, -1.1], [-0.72, 1.1], [0.72, 1.1]]) res.wheels.push(makeWheel(g, 0.34, 0.21, x, 0.34, z, M, { hubs: 5 }));
  res.steerWheels = [res.wheels[0], res.wheels[1]];
  return res;
}

export function buildMTLB(camoCols) {
  const M = materials('mtlb', camoCols);
  const g = new THREE.Group();
  const res = { group: g, wheels: [], turret: null, gun: null, mats: Object.values(M) };
  // корпус между гусеницами и надгусеничные полки
  const hull = [[-3.2, 0.42], [-3.22, 0.78], [-2.55, 1.42], [-2.05, 1.5], [-1.95, 1.72], [-0.6, 1.76], [-0.5, 1.6], [3.1, 1.6], [3.22, 1.45], [3.22, 0.5], [2.9, 0.4]];
  g.add(hullFromProfile(hull.reverse(), 2.0, 0.05, M.camo));
  for (const s of [-1, 1]) {
    // полки над гусеницами
    box(g, 0.48, 0.07, 6.2, M.camo, s * 1.2, 0.98, 0.05);
    box(g, 0.48, 0.5, 0.06, M.camo, s * 1.2, 0.75, -3.05, -0.6);
    // гусеница: лента по контуру
    const tr = new THREE.Shape();
    tr.moveTo(-3.05, 0.62); tr.lineTo(-2.7, 0.9); tr.lineTo(2.85, 0.9); tr.lineTo(3.05, 0.62); tr.lineTo(2.85, 0.06); tr.lineTo(-2.7, 0.06); tr.closePath();
    const tg = new THREE.ExtrudeGeometry(tr, { depth: 0.42, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.05, bevelSegments: 2 });
    tg.translate(0, 0, -0.21); tg.rotateY(-Math.PI / 2);
    const uv = tg.attributes.uv, p = tg.attributes.position;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * 2, (p.getZ(i) + p.getY(i)) * 2.4);
    const track = new THREE.Mesh(tg, M.track); track.position.x = s * 1.2; track.castShadow = true; g.add(track);
    res.track = res.track || []; res.track.push(track);
    // катки, ленивец, ведущее колесо
    for (let i = 0; i < 7; i++) {
      const w = makeWheel(g, 0.27, 0.12, s * (1.2 + 0.24), 0.33, -2.35 + i * 0.78, M, { hubs: 5 });
      res.wheels.push(w);
    }
    res.wheels.push(makeWheel(g, 0.24, 0.12, s * 1.44, 0.66, -2.85, M, { hubs: 8 }));
    res.wheels.push(makeWheel(g, 0.24, 0.12, s * 1.44, 0.6, 2.88, M, { hubs: 5 }));
    // фары, ящики ЗИП, буксирные тросы
    box(g, 0.18, 0.13, 0.16, M.dark, s * 0.85, 1.52, -2.25);
    cyl(g, 0.06, 0.06, 0.04, M.lamp, s * 0.85, 1.52, -2.34, 'z');
    box(g, 0.3, 0.35, 1.2, M.camo, s * 1.22, 1.2, 1.6, 0, 0, 0, 0.03);
    const cable = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 6, 16), M.metal);
    cable.position.set(s * 1.0, 1.66, -1.2); cable.rotation.x = Math.PI / 2; g.add(cable);
  }
  // смотровые приборы водителя, люки десанта, выхлоп
  for (let i = 0; i < 3; i++) box(g, 0.2, 0.09, 0.07, M.glass, -0.75 + i * 0.32, 1.7, -1.98, -0.3);
  box(g, 0.75, 0.08, 0.55, M.camo, -0.6, 1.8, -1.3, 0, 0, 0, 0.03);
  for (const s of [-1, 1]) box(g, 0.85, 0.07, 0.65, M.camo, s * 0.5, 1.65, 1.6, 0, 0, 0, 0.03);
  box(g, 1.6, 0.05, 0.05, M.metal, 0, 1.65, 2.3);
  cyl(g, 0.07, 0.07, 0.6, M.dark, 0.85, 1.4, 0.4, 'x');
  // тонкий снег на крыше
  box(g, 1.7, 0.04, 2.0, M.snow, 0, 1.64, 0.6, 0, 0, 0, 0.02);
  // башня с ПКТ
  const tur = new THREE.Group();
  const tb = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.36, 22), M.camo); tb.castShadow = true; tur.add(tb);
  const tt = new THREE.Mesh(new THREE.SphereGeometry(0.4, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.camo); tt.scale.y = 0.45; tt.position.y = 0.17; tt.castShadow = true; tur.add(tt);
  box(tur, 0.14, 0.12, 0.14, M.glass, -0.18, 0.26, -0.2);
  const gun = new THREE.Group();
  const mant = box(gun, 0.26, 0.2, 0.22, M.camo, 0, 0, -0.08, 0, 0, 0, 0.05);
  cyl(gun, 0.022, 0.022, 0.9, M.dark, 0, 0, -0.62, 'z', 10);
  cyl(gun, 0.03, 0.028, 0.12, M.dark, 0, 0, -1.05, 'z', 10);
  mant.castShadow = true;
  gun.position.set(0, 0.06, -0.32);
  tur.add(gun);
  tur.position.set(0.55, 1.78, -1.45);
  g.add(tur);
  res.turret = tur; res.gun = gun;
  res.steerWheels = [];
  res.trackTex = M.track.map;
  return res;
}
