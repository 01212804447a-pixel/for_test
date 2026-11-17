// Инструменты моделирования оружия: профили с фасками, лофт по сечениям, тела вращения,
// материалы с мелкой фактурой (шум в системе объекта), сборка деталей по материалам.
// Система координат: −Z — вперёд по стволу, +Y — вверх, +X — вправо.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// ---------- 2D-контуры со скруглениями ----------
// pts: [[z, y, r?], ...] — вершины многоугольника в боковой проекции; r — радиус скругления угла
function fillet(pts, seg = 4) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], r = p[2] || 0;
    if (!r) { out.push([p[0], p[1]]); continue; }
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const d1 = [a[0] - p[0], a[1] - p[1]], d2 = [b[0] - p[0], b[1] - p[1]];
    const l1 = Math.hypot(...d1), l2 = Math.hypot(...d2);
    const t = Math.min(r, l1 * 0.48, l2 * 0.48);
    const s = [p[0] + (d1[0] / l1) * t, p[1] + (d1[1] / l1) * t], e = [p[0] + (d2[0] / l2) * t, p[1] + (d2[1] / l2) * t];
    for (let k = 0; k <= seg; k++) {
      const u = k / seg;
      // квадратичная кривая Безье через вершину
      out.push([(1 - u) * (1 - u) * s[0] + 2 * u * (1 - u) * p[0] + u * u * e[0], (1 - u) * (1 - u) * s[1] + 2 * u * (1 - u) * p[1] + u * u * e[1]]);
    }
  }
  return out;
}

function shapeOf(pts, holes = []) {
  const f = fillet(pts);
  const sh = new THREE.Shape(f.map(([z, y]) => new THREE.Vector2(-z, y)));
  for (const h of holes) sh.holes.push(new THREE.Path(fillet(h).map(([z, y]) => new THREE.Vector2(-z, y))));
  return sh;
}

// Деталь по боковому профилю: толщина w по X, центр x
export function side(pts, w, { x = 0, bevel = 0.0015, segs = 2, holes = [] } = {}) {
  const bt = Math.min(bevel, w * 0.42);
  const depth = Math.max(0.0002, w - 2 * bt);
  const g = new THREE.ExtrudeGeometry(shapeOf(pts, holes), { depth, bevelEnabled: bt > 0, bevelThickness: bt, bevelSize: bt * 0.9, bevelSegments: segs, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  g.rotateY(Math.PI / 2);
  g.translate(x, 0, 0);
  return g;
}

// Деталь по виду сверху: pts [[z, x, r?]], высота h по Y, центр y
export function top(pts, h, { y = 0, bevel = 0.0012, segs = 2 } = {}) {
  const bt = Math.min(bevel, h * 0.42);
  const depth = Math.max(0.0002, h - 2 * bt);
  const sh = new THREE.Shape(fillet(pts).map(([z, x]) => new THREE.Vector2(x, z)));
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: bt > 0, bevelThickness: bt, bevelSize: bt * 0.9, bevelSegments: segs, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  g.rotateX(Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

// Лофт: станции {p:[x,y,z], w, h, r, up?} — сечение скруглённый прямоугольник w (по «вправо») × h (по «вверх»)
export function loft(st, { seg = 3, caps = true, uvScale = 1 } = {}) {
  const ring = [];
  const n = st.length;
  const P = st.map((s) => new THREE.Vector3(...s.p));
  const pos = [], uv = [], idx = [];
  let vlen = 0;
  let prevRight = null;
  for (let i = 0; i < n; i++) {
    const s = st[i];
    const T = (i === 0 ? P[1].clone().sub(P[0]) : i === n - 1 ? P[n - 1].clone().sub(P[n - 2]) : P[i + 1].clone().sub(P[i - 1])).normalize();
    const U = new THREE.Vector3(...(s.up || [0, 1, 0]));
    let right = new THREE.Vector3().crossVectors(T, U);
    if (right.lengthSq() < 1e-6) right = prevRight ? prevRight.clone() : new THREE.Vector3(1, 0, 0);
    right.normalize();
    prevRight = right;
    const up = new THREE.Vector3().crossVectors(right, T).normalize();
    if (i > 0) vlen += P[i].distanceTo(P[i - 1]);
    const w = s.w / 2, h = s.h / 2, r = Math.min(s.r ?? Math.min(w, h) * 0.4, w * 0.999, h * 0.999);
    const pts2 = [];
    const corners = [[w - r, h - r, 0], [-(w - r), h - r, Math.PI / 2], [-(w - r), -(h - r), Math.PI], [w - r, -(h - r), Math.PI * 1.5]];
    for (const [cx, cy, a0] of corners) for (let k = 0; k <= seg; k++) { const a = a0 + (k / seg) * (Math.PI / 2); pts2.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    const base = pos.length / 3;
    const ox = s.ox || 0, oy = s.oy || 0;
    pts2.forEach(([a, b], k) => {
      const v = P[i].clone().addScaledVector(right, a + ox).addScaledVector(up, b + oy);
      pos.push(v.x, v.y, v.z);
      uv.push(k / pts2.length, vlen * uvScale);
    });
    ring.push({ base, count: pts2.length, c: P[i].clone().addScaledVector(right, ox).addScaledVector(up, oy) });
  }
  const m = ring[0].count;
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < m; k++) {
      const a = ring[i].base + k, b = ring[i].base + ((k + 1) % m), c = ring[i + 1].base + ((k + 1) % m), d = ring[i + 1].base + k;
      idx.push(a, c, b, a, d, c);
    }
  }
  if (caps) {
    for (const [ri, flip] of [[0, false], [n - 1, true]]) {
      const R = ring[ri];
      const cb = pos.length / 3;
      pos.push(R.c.x, R.c.y, R.c.z); uv.push(0.5, 0.5);
      for (let k = 0; k < m; k++) { const o = (R.base + k) * 3; pos.push(pos[o], pos[o + 1], pos[o + 2]); uv.push(0.5 + 0.5 * Math.cos((k / m) * 6.283), 0.5 + 0.5 * Math.sin((k / m) * 6.283)); }
      for (let k = 0; k < m; k++) {
        const a = cb + 1 + k, b = cb + 1 + ((k + 1) % m);
        if (flip) idx.push(cb, b, a); else idx.push(cb, a, b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Тело вращения вокруг оси Z: prof [[r, z], ...] (z по возрастанию), центр (x, y)
export function lathe(prof, { x = 0, y = 0, seg = 24, phi = 0, len = Math.PI * 2 } = {}) {
  const pts = prof.map(([r, z]) => new THREE.Vector2(Math.max(r, 1e-5), -z)).reverse();
  const g = new THREE.LatheGeometry(pts, seg, phi, len);
  g.rotateX(-Math.PI / 2);
  g.translate(x, y, 0);
  return g;
}

// Цилиндр вдоль Z от z0 до z1
export function cylZ(r, z0, z1, { x = 0, y = 0, seg = 20, r1 } = {}) {
  const g = new THREE.CylinderGeometry(r1 ?? r, r, Math.abs(z1 - z0), seg);
  g.rotateX(z1 < z0 ? -Math.PI / 2 : Math.PI / 2);
  g.translate(x, y, (z0 + z1) / 2);
  return g;
}
export function cylX(r, x0, x1, { y = 0, z = 0, seg = 16 } = {}) {
  const g = new THREE.CylinderGeometry(r, r, Math.abs(x1 - x0), seg);
  g.rotateZ(Math.PI / 2);
  g.translate((x0 + x1) / 2, y, z);
  return g;
}
export function cylY(r, y0, y1, { x = 0, z = 0, seg = 16, r1 } = {}) {
  const g = new THREE.CylinderGeometry(r1 ?? r, r, Math.abs(y1 - y0), seg);
  g.translate(x, (y0 + y1) / 2, z);
  return g;
}
export function rbox(w, h, d, x, y, z, r = 0.002, { rx = 0, ry = 0, rz = 0 } = {}) {
  const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.05, h / 2.05, d / 2.05));
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
}
export function torus(R, r, { x = 0, y = 0, z = 0, axis = 'z', arc = Math.PI * 2, seg = 16 } = {}) {
  const g = new THREE.TorusGeometry(R, r, 8, seg, arc);
  if (axis === 'x') g.rotateY(Math.PI / 2);
  else if (axis === 'y') g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}
// Трубка по точкам
export function tube(points, r, { seg = 24, radial = 8, closed = false } = {}) {
  const c = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed);
  return new THREE.TubeGeometry(c, seg, r, radial, closed);
}

export function xf(g, { rx = 0, ry = 0, rz = 0, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, pivot } = {}) {
  if (pivot) g.translate(-pivot[0], -pivot[1], -pivot[2]);
  if (sx !== 1 || sy !== 1 || sz !== 1) g.scale(sx, sy, sz);
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  if (pivot) g.translate(pivot[0], pivot[1], pivot[2]);
  if (x || y || z) g.translate(x, y, z);
  return g;
}

// ---------- материалы ----------
const NOISE_GLSL = `
float gk_h(vec3 p){ p = fract(p*0.3183099+0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float gk_n(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(gk_h(i+vec3(0,0,0)),gk_h(i+vec3(1,0,0)),f.x),mix(gk_h(i+vec3(0,1,0)),gk_h(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(gk_h(i+vec3(0,0,1)),gk_h(i+vec3(1,0,1)),f.x),mix(gk_h(i+vec3(0,1,1)),gk_h(i+vec3(1,1,1)),f.x),f.y),f.z); }
float gk_f(vec3 p){ return gk_n(p)*0.5+gk_n(p*2.03)*0.25+gk_n(p*4.11)*0.125+gk_n(p*8.3)*0.0625; }
`;

// Мелкая фактура: шум цвета и шероховатости в системе объекта + потёртости на рёбрах (по кривизне нормали)
export function textured(mat, { scale = 120, ca = 0.12, ra = 0.35, wear = 0, wearColor = 0x8a8c90, grain = 0 } = {}) {
  const wc = new THREE.Color(wearColor);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.gkScale = { value: scale }; sh.uniforms.gkCA = { value: ca }; sh.uniforms.gkRA = { value: ra };
    sh.uniforms.gkWear = { value: wear }; sh.uniforms.gkWearC = { value: wc }; sh.uniforms.gkGrain = { value: grain };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGkP;\nvarying vec3 vGkN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGkP = position;\nvGkN = normal;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vGkP;\nvarying vec3 vGkN;\nuniform float gkScale, gkCA, gkRA, gkWear, gkGrain;\nuniform vec3 gkWearC;\n${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float gkN = gk_f(vGkP * gkScale);
        float gkL = gk_f(vGkP * gkScale * 0.08 + 3.1);
        diffuseColor.rgb *= 1.0 + gkCA * (gkN - 0.5) * 2.0 + gkCA * 0.6 * (gkL - 0.5);
        if (gkGrain > 0.0) {
          // волокна древесины вдоль Z
          float g = sin((vGkP.y * 900.0 + vGkP.x * 600.0 + gk_f(vGkP * vec3(40.0, 40.0, 4.0)) * 9.0) ) * 0.5 + 0.5;
          float g2 = gk_f(vGkP * vec3(300.0, 300.0, 12.0));
          diffuseColor.rgb *= 1.0 - gkGrain * (0.55 * pow(g, 6.0) + 0.35 * g2);
        }
        // потёртости: рёбра — там, где нормаль быстро меняется
        vec3 gkDN = fwidth(normalize(vGkN));
        float gkEdge = smoothstep(0.08, 0.35, length(gkDN)) * gkWear * smoothstep(0.35, 0.75, gk_f(vGkP * gkScale * 0.5 + 7.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, gkWearC, gkEdge);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor * (1.0 + gkRA * (gk_f(vGkP * gkScale * 1.7 + 11.0) - 0.5) * 2.0) - gkEdge * 0.25, 0.04, 1.0);`);
  };
  mat.customProgramCacheKey = () => `gk${scale}|${ca}|${ra}|${wear}|${grain}`;
  return mat;
}

let MATS = null;
export function gunMats() {
  if (MATS) return MATS;
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const phy = (o) => new THREE.MeshPhysicalMaterial(o);
  MATS = {
    // воронёная/фосфатированная сталь
    steel: textured(phy({ color: 0x2c2e33, metalness: 0.8, roughness: 0.44, clearcoat: 0.15, clearcoatRoughness: 0.5 }), { scale: 180, ca: 0.1, ra: 0.3, wear: 0.9, wearColor: 0x6d7076 }),
    steelDark: textured(phy({ color: 0x141516, metalness: 0.75, roughness: 0.5 }), { scale: 200, ca: 0.1, ra: 0.3, wear: 0.5, wearColor: 0x55585d }),
    steelBright: textured(phy({ color: 0x55575c, metalness: 1, roughness: 0.28 }), { scale: 260, ca: 0.08, ra: 0.3 }),
    // чёрный полимер (АК-74М): шагрень
    poly: textured(std({ color: 0x222224, metalness: 0, roughness: 0.68 }), { scale: 900, ca: 0.14, ra: 0.25, wear: 0.25, wearColor: 0x3a3a3c }),
    // «сливовый» магазин 5,45
    plum: textured(phy({ color: 0x5c2a1c, metalness: 0, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.35 }), { scale: 400, ca: 0.16, ra: 0.25, wear: 0.3, wearColor: 0x8a4a33 }),
    // клеёная берёза под лаком (АКМ, СВД, накладки РПГ)
    wood: textured(phy({ color: 0x55220f, metalness: 0, roughness: 0.4, clearcoat: 0.55, clearcoatRoughness: 0.25 }), { scale: 60, ca: 0.18, ra: 0.2, grain: 0.55, wear: 0.35, wearColor: 0xa0623a }),
    rubber: textured(std({ color: 0x101010, roughness: 0.92 }), { scale: 500, ca: 0.15, ra: 0.1 }),
    // стекло с просветлением
    lens: phy({ color: 0x0b1a2a, metalness: 0.2, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.02, iridescence: 0.8, iridescenceIOR: 1.6, envMapIntensity: 2.2 }),
    olive: textured(phy({ color: 0x3f4a2c, metalness: 0.3, roughness: 0.55, clearcoat: 0.2 }), { scale: 150, ca: 0.12, ra: 0.3, wear: 0.6, wearColor: 0x7d7f6e }),
    green: textured(std({ color: 0x2f3a28, metalness: 0.4, roughness: 0.55 }), { scale: 150, ca: 0.12, ra: 0.3, wear: 0.6, wearColor: 0x6d705f }),
    brass: textured(phy({ color: 0xb48a42, metalness: 1, roughness: 0.3 }), { scale: 300, ca: 0.15, ra: 0.3 }),
    copper: textured(phy({ color: 0x9a6a3a, metalness: 1, roughness: 0.35 }), { scale: 300, ca: 0.12, ra: 0.3 }),
    black: std({ color: 0x050505, roughness: 0.9 }),
    paintRed: std({ color: 0x8a1a12, roughness: 0.6 }),
    paintWhite: std({ color: 0xd8d8cf, roughness: 0.6 }),
    tritium: std({ color: 0xd8e8c0, emissive: 0x334422, roughness: 0.5 }),
  };
  return MATS;
}

// ---------- сборщик ----------
export class Parts {
  constructor() { this.by = new Map(); this.movers = []; }
  add(mat, ...gs) {
    if (!this.by.has(mat)) this.by.set(mat, []);
    for (const g of gs) this.by.get(mat).push(g);
    return this;
  }
  // Подвижная деталь: группа с осью в pivot
  mover(name, pivot = [0, 0, 0]) {
    const p = new Parts();
    p.name = name; p.pivot = pivot;
    this.movers.push(p);
    return p;
  }
  static clean(g) {
    const n = g.index ? g.toNonIndexed() : g;
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', n.attributes.position);
    if (!n.attributes.normal) n.computeVertexNormals();
    out.setAttribute('normal', n.attributes.normal);
    out.setAttribute('uv', n.attributes.uv || new THREE.Float32BufferAttribute(new Float32Array((n.attributes.position.count) * 2), 2));
    return out;
  }
  build(M, { shadow = true } = {}) {
    const root = new THREE.Group();
    for (const [mk, gs] of this.by) {
      const geo = mergeGeometries(gs.map(Parts.clean));
      const m = new THREE.Mesh(geo, M[mk] || mk);
      m.castShadow = shadow; m.receiveShadow = true;
      root.add(m);
    }
    const named = {};
    for (const mv of this.movers) {
      const g = new THREE.Group();
      g.name = mv.name;
      g.position.set(...mv.pivot);
      const inner = mv.build(M, { shadow });
      inner.position.set(-mv.pivot[0], -mv.pivot[1], -mv.pivot[2]);
      g.add(inner);
      Object.assign(named, inner.userData.named || {});
      named[mv.name] = g;
      root.add(g);
    }
    root.userData.named = named;
    return root;
  }
}
