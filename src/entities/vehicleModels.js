// Модели техники: кузов из лофтов со скруглёнными сечениями (не «коробка»), капот, наклонное
// лобовое стекло, кенгурятник, фары с линзами, двери со швами и петлями, днище с мостами,
// колёса с грунтозацепами. Камуфляж, грязь снизу и снег на горизонтальных поверхностях —
// процедурно в шейдере (в системе модели, без растяжения текстур).
// Колесо = группа поворота (ось Y) → группа вращения (ось X): руль и качение не смешиваются.
import * as THREE from 'three';
import { side, loft, lathe, cylZ, cylX, cylY, rbox, torus, tube, xf, Parts } from '../weapons/gunkit.js';

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
function plateTexture(text) {
  return tex('plate' + text, 256, 64, (g, w, h) => {
    g.fillStyle = '#f0f0ea'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#111'; g.lineWidth = 4; g.strokeRect(3, 3, w - 6, h - 6);
    g.fillStyle = '#111'; g.font = 'bold 40px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 2);
  }, false);
}

// ---------- окраска: камуфляж в системе модели, грязь снизу, снег сверху, потёртости ----------
const PAINT_GLSL = `
float vp_h(vec3 p){ p = fract(p*0.3183099+0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vp_n(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(vp_h(i),vp_h(i+vec3(1,0,0)),f.x),mix(vp_h(i+vec3(0,1,0)),vp_h(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(vp_h(i+vec3(0,0,1)),vp_h(i+vec3(1,0,1)),f.x),mix(vp_h(i+vec3(0,1,1)),vp_h(i+vec3(1,1,1)),f.x),f.y),f.z); }
float vp_f(vec3 p){ return vp_n(p)*0.5+vp_n(p*2.07)*0.25+vp_n(p*4.13)*0.125+vp_n(p*8.4)*0.0625; }
`;
function paintMaterial(cols, { scale = 0.55, dirtTop = 1.0, snow = 0.85, gloss = 0.5, metal = 0.25, camo = true } = {}) {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: gloss, metalness: metal, clearcoat: 0.25, clearcoatRoughness: 0.55 });
  const C = cols.map((c) => new THREE.Color(c));
  while (C.length < 3) C.push(C[C.length - 1]);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.vpC0 = { value: C[0] }; sh.uniforms.vpC1 = { value: C[1] }; sh.uniforms.vpC2 = { value: C[2] };
    sh.uniforms.vpScale = { value: scale }; sh.uniforms.vpDirt = { value: dirtTop }; sh.uniforms.vpSnow = { value: snow }; sh.uniforms.vpCamo = { value: camo ? 1 : 0 };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vVpP;\nvarying vec3 vVpN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvVpP = position;\nvVpN = normal;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vVpP;\nvarying vec3 vVpN;\nuniform vec3 vpC0, vpC1, vpC2;\nuniform float vpScale, vpDirt, vpSnow, vpCamo;\n${PAINT_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 P = vVpP;
        // камуфляж: пятна с чёткими краями
        float n1 = vp_f(P * vpScale * vec3(1.0, 1.4, 0.7) + 3.0);
        float n2 = vp_f(P * vpScale * vec3(0.8, 1.6, 0.9) + 17.0);
        vec3 col = vpC0;
        col = mix(col, vpC1, smoothstep(0.5, 0.53, n1) * vpCamo);
        col = mix(col, vpC2, smoothstep(0.56, 0.59, n2) * vpCamo);
        // мелкая неоднородность краски
        col *= 0.93 + 0.12 * vp_f(P * 9.0);
        // грязь и брызги снизу
        float dirt = (1.0 - smoothstep(0.25, vpDirt, P.y + (vp_f(P * vec3(2.0, 6.0, 2.0)) - 0.5) * 0.35)) * 0.85;
        col = mix(col, vec3(0.30, 0.27, 0.22), dirt);
        // потёртости на рёбрах
        float edge = smoothstep(0.1, 0.35, length(fwidth(normalize(vVpN)))) * smoothstep(0.55, 0.8, vp_f(P * 14.0));
        col = mix(col, col * 0.55 + vec3(0.12), edge * 0.6);
        // снег на горизонтальных поверхностях
        float snowK = smoothstep(0.72, 0.92, normalize(vVpN).y) * smoothstep(0.35, 0.6, vp_f(P * 2.5 + 9.0)) * vpSnow;
        col = mix(col, vec3(0.93, 0.95, 0.98), snowK);
        diffuseColor.rgb *= col;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + dirt * 0.35 + snowK * 0.3, 0.05, 1.0);`);
  };
  m.customProgramCacheKey = () => 'vpaint' + cols.join() + scale + dirtTop + snow + camo;
  return m;
}

function materials(cols, opts) {
  const std = (o) => new THREE.MeshStandardMaterial(o);
  return {
    paint: paintMaterial(cols, opts),
    dark: paintMaterial(['#1e2022'], { camo: false, snow: 0.4, gloss: 0.7, metal: 0.4, dirtTop: 0.9 }),
    plastic: std({ color: 0x18191a, roughness: 0.8 }),
    metal: std({ color: 0x55585c, roughness: 0.4, metalness: 0.85 }),
    chrome: new THREE.MeshPhysicalMaterial({ color: 0xc8ccd0, roughness: 0.12, metalness: 1, clearcoat: 0.6 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x1a2632, roughness: 0.04, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 2.2, reflectivity: 0.9 }),
    lens: new THREE.MeshPhysicalMaterial({ color: 0xe8eef2, roughness: 0.08, metalness: 0.2, clearcoat: 1, emissive: 0xfff2d0, emissiveIntensity: 0.25 }),
    reflector: std({ color: 0xd8dde2, roughness: 0.15, metalness: 1 }),
    tire: std({ color: 0x1a1a1b, roughness: 0.93 }),
    rim: paintMaterial(['#3e4a33'], { camo: false, snow: 0.3, gloss: 0.55, metal: 0.5, dirtTop: 0.8 }),
    red: std({ color: 0x9a1810, emissive: 0x3a0000, roughness: 0.3 }),
    amber: std({ color: 0xd88a20, emissive: 0x301800, roughness: 0.3 }),
    track: std({ map: (() => { const t = trackTexture().clone(); t.needsUpdate = true; return t; })(), roughness: 0.85, metalness: 0.45 }),
    rubber: std({ color: 0x101010, roughness: 0.95 }),
    canvas: std({ color: 0x4a5236, roughness: 0.95 }),
  };
}

// Колесо: шина (тело вращения со скруглёнными плечами) + грунтозацепы + диск со ступицей
function makeWheel(parent, r, w, x, y, z, M, { hubs = 8, lugs = 22, rimR = 0.55, mt = false } = {}) {
  const steer = new THREE.Group(); steer.position.set(x, y, z);
  const spin = new THREE.Group(); steer.add(spin);
  const P = new Parts();
  // шина: профиль в плоскости (r, z) → ось колеса по X
  const prof = [[r * rimR, -w / 2 + 0.01], [r * 0.82, -w / 2], [r * 0.95, -w / 2 + w * 0.06], [r * 0.99, -w / 2 + w * 0.2], [r, -w * 0.25], [r, w * 0.25], [r * 0.99, w / 2 - w * 0.2], [r * 0.95, w / 2 - w * 0.06], [r * 0.82, w / 2], [r * rimR, w / 2 - 0.01]];
  P.add('tire', lathe(prof, { seg: 40 }).rotateY(Math.PI / 2));
  // грунтозацепы (ёлочка)
  for (let i = 0; i < lugs; i++) {
    const a = (i / lugs) * Math.PI * 2;
    for (const sgn of [-1, 1]) {
      const g = rbox(w * 0.36, mt ? 0.035 : 0.022, r * 0.16, sgn * w * 0.2, 0, 0, 0.008, { ry: sgn * 0.45 });
      g.translate(0, r + (mt ? 0.012 : 0.006), 0);
      g.applyMatrix4(new THREE.Matrix4().makeRotationX(a + sgn * 0.07));
      P.add('tire', g);
    }
  }
  // диск, ступица, болты
  P.add('rim', lathe([[0.0, -w * 0.42], [r * rimR * 0.98, -w * 0.42], [r * rimR, -w * 0.34], [r * rimR, w * 0.3], [r * rimR * 0.4, w * 0.36], [0.0, w * 0.36]], { seg: 28 }).rotateY(Math.PI / 2));
  P.add('rim', lathe([[0, -w * 0.5], [r * 0.2, -w * 0.5], [r * 0.24, -w * 0.42], [0, -w * 0.42]], { seg: 20 }).rotateY(Math.PI / 2));
  P.add('metal', lathe([[0, w * 0.36], [r * 0.15, w * 0.36], [r * 0.15, w * 0.44], [0, w * 0.47]], { seg: 16 }).rotateY(Math.PI / 2));
  P.add('metal', lathe([[0, -w * 0.5], [r * 0.12, -w * 0.5], [r * 0.12, -w * 0.56], [0, -w * 0.58]], { seg: 16 }).rotateY(Math.PI / 2));
  for (let i = 0; i < hubs; i++) {
    const a = (i / hubs) * Math.PI * 2;
    P.add('metal', cylX(r * 0.025, -w * 0.52, -w * 0.47, { y: Math.sin(a) * r * 0.32, z: Math.cos(a) * r * 0.32, seg: 6 }));
    P.add('metal', cylX(r * 0.025, w * 0.35, w * 0.4, { y: Math.sin(a) * r * 0.32, z: Math.cos(a) * r * 0.32, seg: 6 }));
  }
  spin.add(P.build(M));
  parent.add(steer);
  return { steer, spin, r };
}

// Стекло с рамкой (плоскость в плоскости XY, нормаль вдоль Z), w×h, повороты
function glassPane(P, w, h, x, y, z, { rx = 0, ry = 0, frame = 0.03 } = {}) {
  const T = (g) => g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, 0, 'YXZ'))).translate(x, y, z);
  P.add('plastic', T(rbox(w + frame * 2, h + frame * 2, 0.03, 0, 0, 0, 0.02)));
  P.add('glass', T(rbox(w, h, 0.012, 0, 0, 0.012, 0.015)));
}

// Шов двери: тонкая тёмная полоска по контуру на борту
function doorSeam(P, sx, x, y0, y1, z0, z1) {
  const t = 0.006;
  P.add('dark', rbox(t, y1 - y0, t, x + sx * 0.002, (y0 + y1) / 2, z0, 0.002));
  P.add('dark', rbox(t, y1 - y0, t, x + sx * 0.002, (y0 + y1) / 2, z1, 0.002));
  if (z1 - z0 > 0.01) P.add('dark', rbox(t, t, z1 - z0, x + sx * 0.002, y1, (z0 + z1) / 2, 0.002));
}

// ---------- ГАЗ-233014 «Тигр» ----------
export function buildTigr(camoCols) {
  const M = materials(camoCols, { scale: 0.42, dirtTop: 1.15 });
  const g = new THREE.Group();
  const res = { group: g, wheels: [], turret: null, gun: null, mats: Object.values(M) };
  const P = new Parts();
  const b = 0.62; // низ кузова
  const arch = (cz, cy, r) => { const pts = []; const a0 = Math.asin(Math.min(1, (b - cy) / r)); for (let i = 0; i <= 12; i++) { const a = Math.PI - a0 - (i / 12) * (Math.PI - 2 * a0); pts.push([cz - Math.cos(a) * r, cy + Math.sin(a) * r]); } return pts; };
  const rearA = arch(1.65, 0.56, 0.68), frontA = arch(-1.65, 0.56, 0.68);
  // нижняя часть борта с арками колёс (профиль [z, y]: от кормы к носу по низу, затем верх)
  const lower = [[2.9, b + 0.06, 0.05], ...rearA, [-0.88, b], ...frontA, [-2.92, b + 0.06, 0.05], [-2.94, 1.3, 0.06], [2.92, 1.3, 0.06]];
  P.add('paint', side(lower.map(([z, y, r]) => [z, y, r || 0]), 2.28, { bevel: 0.05, segs: 3 }));
  // капот (лофт): чуть сужается и опускается вперёд
  P.add('paint', loft([
    { p: [0, 1.28, -2.95], w: 2.18, h: 0.2, r: 0.08 },
    { p: [0, 1.3, -2.85], w: 2.24, h: 0.24, r: 0.1 },
    { p: [0, 1.33, -1.9], w: 2.26, h: 0.3, r: 0.1 },
    { p: [0, 1.34, -1.25], w: 2.26, h: 0.3, r: 0.1 },
  ], { seg: 4 }));
  // кабина-кузов (лофт): наклонное лобовое стекло, плоская крыша со скруглением
  P.add('paint', loft([
    { p: [0, 1.38, -1.3], w: 2.22, h: 0.36, r: 0.1 },
    { p: [0, 1.62, -1.2], w: 2.2, h: 0.84, r: 0.12 },
    { p: [0, 1.73, -0.95], w: 2.2, h: 1.1, r: 0.14 },
    { p: [0, 1.75, -0.85], w: 2.22, h: 1.14, r: 0.15 },
    { p: [0, 1.75, 2.8], w: 2.22, h: 1.14, r: 0.15 },
    { p: [0, 1.73, 2.93], w: 2.18, h: 1.08, r: 0.13 },
  ], { seg: 5 }));
  // лобовое стекло (две половины, наклон), боковые окна
  for (const sx of [-0.49, 0.49]) glassPane(P, 0.9, 0.6, sx, 1.93, -1.08, { rx: -0.82, frame: 0.035 });
  for (const s of [-1, 1]) {
    for (const [z, w] of [[-0.42, 0.66], [0.72, 0.66], [1.85, 0.6]]) glassPane(P, w, 0.44, s * 1.112, 1.98, z, { ry: s * Math.PI / 2, frame: 0.04 });
    // двери: швы, петли, ручки
    doorSeam(P, s, s * 1.14, 0.7, 2.24, -0.85, 0.15);
    doorSeam(P, s, s * 1.14, 0.7, 2.24, 0.25, 1.25);
    for (const [z, y] of [[-0.8, 1.0], [-0.8, 1.9], [0.3, 1.0], [0.3, 1.9]]) P.add('metal', rbox(0.03, 0.12, 0.06, s * 1.15, y, z, 0.01));
    for (const z of [0.0, 1.1]) { P.add('metal', rbox(0.04, 0.04, 0.18, s * 1.155, 1.6, z, 0.012)); P.add('dark', rbox(0.02, 0.05, 0.2, s * 1.14, 1.6, z, 0.01)); }
    // подножка, расширители арок
    P.add('dark', rbox(0.3, 0.05, 1.7, s * 1.18, 0.64, 0.2, 0.02));
    for (let i = 0; i < 6; i++) P.add('metal', rbox(0.26, 0.012, 0.02, s * 1.18, 0.67, -0.5 + i * 0.28, 0.004));
    for (const az of [-1.65, 1.65]) P.add('dark', torus(0.7, 0.06, { x: s * 1.13, y: 0.56, z: az, axis: 'x', arc: Math.PI, seg: 18 }));
    // зеркала на кронштейнах
    P.add('dark', tube([[s * 1.12, 1.8, -1.0], [s * 1.3, 1.82, -1.02], [s * 1.36, 1.86, -1.0]], 0.012, { seg: 8, radial: 6 }));
    P.add('dark', rbox(0.06, 0.26, 0.18, s * 1.38, 1.92, -1.0, 0.02));
    P.add('glass', rbox(0.01, 0.22, 0.14, s * 1.38, 1.92, -1.09, 0.004));
    // бак, ящики на бортах
    P.add('dark', rbox(0.14, 0.32, 0.6, s * 1.08, 0.82, -0.5, 0.04));
  }
  // решётка радиатора: рамка + вертикальные ламели
  P.add('dark', rbox(1.3, 0.5, 0.06, 0, 1.06, -2.93, 0.03));
  for (let i = 0; i < 13; i++) P.add('metal', rbox(0.03, 0.42, 0.05, -0.54 + i * 0.09, 1.06, -2.955, 0.008));
  // фары в квадратных корпусах, повторители, габариты, крюки
  for (const s of [-1, 1]) {
    P.add('dark', rbox(0.3, 0.26, 0.1, s * 0.85, 1.08, -2.93, 0.03));
    P.add('reflector', lathe([[0, -2.98], [0.095, -2.98], [0.1, -2.95], [0, -2.93]], { x: s * 0.85, y: 1.08, seg: 20 }));
    P.add('lens', lathe([[0, -3.0], [0.088, -2.995], [0.092, -2.985], [0.0, -2.984]], { x: s * 0.85, y: 1.08, seg: 20 }));
    P.add('amber', rbox(0.1, 0.05, 0.03, s * 1.02, 1.28, -2.96, 0.01));
    P.add('lens', rbox(0.14, 0.06, 0.03, s * 0.6, 0.88, -2.98, 0.01));
    P.add('red', rbox(0.16, 0.22, 0.04, s * 0.98, 1.0, 2.94, 0.02));
    P.add('amber', rbox(0.16, 0.08, 0.04, s * 0.98, 1.19, 2.94, 0.02));
    P.add('metal', torus(0.05, 0.015, { x: s * 0.75, y: 0.72, z: -3.08, axis: 'x' }));
  }
  // бампер, лебёдка, кенгурятник
  P.add('dark', rbox(2.34, 0.24, 0.24, 0, 0.72, -3.0, 0.05));
  P.add('metal', cylX(0.12, -0.38, 0.38, { y: 0.79, z: -3.06, seg: 18 }));
  P.add('dark', rbox(0.9, 0.16, 0.2, 0, 0.79, -3.04, 0.03));
  for (const s of [-1, 1]) {
    P.add('dark', tube([[s * 0.95, 0.82, -3.05], [s * 1.0, 1.25, -3.12], [s * 0.85, 1.42, -3.1], [s * 0.4, 1.44, -3.1]], 0.035, { seg: 16, radial: 8 }));
    P.add('dark', tube([[s * 0.4, 0.82, -3.08], [s * 0.4, 1.13, -3.09], [s * 0.4, 1.44, -3.1]], 0.03, { seg: 6, radial: 8 }));
  }
  P.add('dark', tube([[-0.4, 1.44, -3.1], [0, 1.445, -3.1], [0.4, 1.44, -3.1]], 0.03, { seg: 4, radial: 8 }));
  P.add('dark', rbox(2.3, 0.2, 0.18, 0, 0.7, 2.98, 0.04));
  const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.12), new THREE.MeshStandardMaterial({ map: plateTexture('2741 ВН'), roughness: 0.6 }));
  pl.position.set(0, 0.95, -3.13); pl.rotation.y = Math.PI; g.add(pl);
  // днище: рама, мосты, редукторы, выхлоп
  for (const s of [-1, 1]) P.add('dark', rbox(0.12, 0.16, 5.4, s * 0.55, 0.52, 0, 0.02));
  for (const az of [-1.65, 1.65]) {
    P.add('dark', cylX(0.07, -1.0, 1.0, { y: 0.48, z: az, seg: 12 }));
    P.add('dark', xf(new THREE.SphereGeometry(0.2, 16, 10), { sx: 1.1, sy: 0.9, sz: 1, y: 0.5, z: az }));
    for (const s of [-1, 1]) P.add('dark', rbox(0.16, 0.28, 0.3, s * 0.88, 0.56, az, 0.05));
  }
  P.add('dark', cylZ(0.04, -1.0, 2.6, { x: 0.4, y: 0.5, seg: 10 }));
  // задняя дверь с запаской, багажник на крыше, антенна
  doorSeam(P, 1, 0.55, 0.75, 2.2, 2.95, 2.95);
  const sp = makeWheel(g, 0.5, 0.34, 0, 1.6, 3.1, M, { lugs: 20 });
  sp.steer.rotation.y = Math.PI / 2;
  P.add('dark', rbox(1.7, 0.04, 1.4, 0, 2.36, 1.7, 0.02));
  for (const s of [-1, 1]) P.add('metal', rbox(0.04, 0.08, 1.4, s * 0.85, 2.4, 1.7, 0.015));
  for (let i = 0; i < 5; i++) P.add('metal', rbox(1.7, 0.025, 0.03, 0, 2.39, 1.1 + i * 0.3, 0.008));
  P.add('dark', cylY(0.012, 2.32, 4.4, { x: 0.98, z: 2.5, seg: 6, r1: 0.005 }));
  P.add('dark', cylY(0.03, 2.3, 2.42, { x: 0.98, z: 2.5, seg: 10 }));
  g.add(P.build(M));
  // турель с ПКП: погон, щит, пулемёт
  const tur = new THREE.Group();
  const TP = new Parts();
  TP.add('dark', torus(0.44, 0.07, { axis: 'y', seg: 30 }));
  TP.add('dark', cylY(0.46, -0.05, 0.05, { seg: 30 }));
  tur.add(TP.build(M));
  const gun = new THREE.Group();
  const GP = new Parts();
  GP.add('dark', rbox(0.09, 0.13, 0.55, 0, 0, -0.1, 0.015));
  GP.add('metal', cylZ(0.016, -0.35, -1.0, { y: 0.01, seg: 12 }));
  GP.add('dark', lathe([[0, -1.1], [0.026, -1.1], [0.024, -0.98], [0, -0.98]], { y: 0.01, seg: 12 }));
  GP.add('dark', rbox(0.04, 0.1, 0.18, 0, -0.1, 0.08, 0.01));
  GP.add('paint', rbox(0.66, 0.46, 0.03, 0, 0.06, -0.42, 0.02).rotateX(-0.12));
  GP.add('glass', rbox(0.18, 0.11, 0.035, 0, 0.17, -0.425, 0.01).rotateX(-0.12));
  GP.add('canvas', rbox(0.13, 0.15, 0.15, 0.11, -0.09, -0.05, 0.02));
  gun.add(GP.build(M));
  gun.position.set(0, 0.35, -0.2);
  tur.add(gun);
  tur.position.set(0, 2.36, 0.55);
  g.add(tur);
  res.turret = tur; res.gun = gun;
  for (const [x, z] of [[-1.05, -1.65], [1.05, -1.65], [-1.05, 1.65], [1.05, 1.65]]) res.wheels.push(makeWheel(g, 0.56, 0.4, x, 0.56, z, M, { mt: true }));
  res.steerWheels = [res.wheels[0], res.wheels[1]];
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return res;
}

// ---------- ВАЗ-2121 «Нива» ----------
export function buildNiva(camoCols) {
  const M = materials(camoCols, { scale: 0.7, dirtTop: 0.8, gloss: 0.38, metal: 0.4, snow: 0.9 });
  const g = new THREE.Group();
  const res = { group: g, wheels: [], turret: null, gun: null, mats: Object.values(M) };
  const P = new Parts();
  const b = 0.42;
  const arch = (cz, cy, r) => { const pts = []; const a0 = Math.asin(Math.min(1, (b - cy) / r)); for (let i = 0; i <= 12; i++) { const a = Math.PI - a0 - (i / 12) * (Math.PI - 2 * a0); pts.push([cz - Math.cos(a) * r, cy + Math.sin(a) * r]); } return pts; };
  const rearA = arch(1.1, 0.34, 0.45), frontA = arch(-1.1, 0.34, 0.45);
  const lower = [[1.86, b + 0.05, 0.04], ...rearA, [-0.62, b], ...frontA, [-1.86, b + 0.05, 0.04], [-1.88, 0.9, 0.05], [1.88, 0.9, 0.05]];
  P.add('paint', side(lower.map(([z, y, r]) => [z, y, r || 0]), 1.66, { bevel: 0.04, segs: 3 }));
  // капот
  P.add('paint', loft([
    { p: [0, 0.9, -1.9], w: 1.6, h: 0.12, r: 0.05 },
    { p: [0, 0.92, -1.84], w: 1.64, h: 0.16, r: 0.06 },
    { p: [0, 0.95, -0.8], w: 1.65, h: 0.2, r: 0.06 },
  ], { seg: 4 }));
  // салон
  P.add('paint', loft([
    { p: [0, 0.97, -0.82], w: 1.62, h: 0.2, r: 0.06 },
    { p: [0, 1.12, -0.7], w: 1.58, h: 0.5, r: 0.08 },
    { p: [0, 1.25, -0.3], w: 1.54, h: 0.76, r: 0.1 },
    { p: [0, 1.26, -0.2], w: 1.54, h: 0.78, r: 0.1 },
    { p: [0, 1.26, 1.62], w: 1.54, h: 0.78, r: 0.1 },
    { p: [0, 1.2, 1.88], w: 1.5, h: 0.62, r: 0.08 },
  ], { seg: 5 }));
  glassPane(P, 1.34, 0.5, 0, 1.31, -0.5, { rx: -0.92, frame: 0.03 });
  glassPane(P, 1.24, 0.42, 0, 1.34, 1.86, { rx: Math.PI + 0.2, frame: 0.03 });
  for (const s of [-1, 1]) {
    glassPane(P, 0.82, 0.38, s * 0.775, 1.38, 0.15, { ry: s * Math.PI / 2, frame: 0.03 });
    glassPane(P, 0.62, 0.34, s * 0.775, 1.38, 1.08, { ry: s * Math.PI / 2, frame: 0.03 });
    doorSeam(P, s, s * 0.83, 0.48, 1.6, -0.7, 0.66);
    P.add('chrome', rbox(0.03, 0.03, 0.14, s * 0.84, 1.0, 0.5, 0.01));
    P.add('dark', rbox(0.04, 0.16, 3.4, s * 0.835, 0.5, 0, 0.02));
    for (const az of [-1.1, 1.1]) P.add('dark', torus(0.46, 0.035, { x: s * 0.82, y: 0.34, z: az, axis: 'x', arc: Math.PI, seg: 18 }));
    // зеркало, фары круглые в хромированных ободках, повороты, задние фонари
    P.add('dark', rbox(0.05, 0.12, 0.12, s * 0.9, 1.18, -0.6, 0.02));
    P.add('chrome', lathe([[0, -1.9], [0.1, -1.9], [0.1, -1.88], [0, -1.86]], { x: s * 0.56, y: 0.78, seg: 22 }));
    P.add('lens', lathe([[0, -1.92], [0.08, -1.915], [0.085, -1.905], [0, -1.905]], { x: s * 0.56, y: 0.78, seg: 20 }));
    P.add('amber', rbox(0.1, 0.05, 0.03, s * 0.66, 0.62, -1.92, 0.01));
    P.add('red', rbox(0.12, 0.18, 0.03, s * 0.66, 0.78, 1.9, 0.01));
  }
  // решётка, бамперы, номер
  P.add('dark', rbox(0.8, 0.2, 0.03, 0, 0.8, -1.9, 0.01));
  for (let i = 0; i < 5; i++) P.add('chrome', rbox(0.76, 0.012, 0.035, 0, 0.73 + i * 0.035, -1.905, 0.004));
  P.add('chrome', rbox(1.72, 0.12, 0.14, 0, 0.5, -1.94, 0.03));
  P.add('chrome', rbox(1.72, 0.12, 0.14, 0, 0.5, 1.94, 0.03));
  const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.11), new THREE.MeshStandardMaterial({ map: plateTexture('А 117 МР'), roughness: 0.6 }));
  pl.position.set(0, 0.6, -2.02); pl.rotation.y = Math.PI; g.add(pl);
  // днище
  for (const az of [-1.1, 1.1]) P.add('dark', cylX(0.05, -0.7, 0.7, { y: 0.32, z: az, seg: 10 }));
  P.add('dark', cylZ(0.035, -1.0, 1.9, { x: 0.3, y: 0.3, seg: 8 }));
  // багажник на крыше с канистрой и брезентом
  for (const s of [-1, 1]) P.add('dark', rbox(0.03, 0.05, 1.5, s * 0.62, 1.68, 0.6, 0.01));
  for (let i = 0; i < 4; i++) P.add('dark', rbox(1.26, 0.025, 0.03, 0, 1.7, 0.0 + i * 0.4, 0.008));
  P.add('rim', rbox(0.32, 0.22, 0.44, -0.25, 1.82, 0.5, 0.03));
  P.add('canvas', rbox(0.56, 0.14, 0.5, 0.28, 1.76, 1.0, 0.06));
  g.add(P.build(M));
  for (const [x, z] of [[-0.72, -1.1], [0.72, -1.1], [-0.72, 1.1], [0.72, 1.1]]) res.wheels.push(makeWheel(g, 0.34, 0.2, x, 0.34, z, M, { hubs: 5, lugs: 18, rimR: 0.6 }));
  res.steerWheels = [res.wheels[0], res.wheels[1]];
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return res;
}

// ---------- МТ-ЛБ ----------
export function buildMTLB(camoCols) {
  const M = materials(camoCols, { scale: 0.32, dirtTop: 1.05, snow: 0.95, gloss: 0.75, metal: 0.35 });
  const g = new THREE.Group();
  const res = { group: g, wheels: [], turret: null, gun: null, mats: Object.values(M) };
  const P = new Parts();
  // корпус: наклонный лоб, плоская крыша, корма
  P.add('paint', side([[-3.22, 0.42, 0.04], [-3.24, 0.82, 0.05], [-2.55, 1.44, 0.06], [-2.0, 1.52, 0.04], [-1.92, 1.74, 0.04], [-0.62, 1.78, 0.04], [-0.52, 1.62, 0.03], [3.12, 1.62, 0.05], [3.24, 1.46, 0.05], [3.24, 0.52, 0.04], [2.92, 0.4, 0.04]], 2.0, { bevel: 0.04, segs: 2 }));
  for (const s of [-1, 1]) {
    // надгусеничные полки и борт
    P.add('paint', rbox(0.5, 0.06, 6.3, s * 1.22, 0.99, 0.05, 0.02));
    P.add('paint', rbox(0.5, 0.06, 0.6, s * 1.22, 0.78, -3.1, 0.02).rotateX(-0.62));
    P.add('paint', rbox(0.04, 0.32, 6.2, s * 1.46, 0.84, 0.05, 0.015));
    // ящики ЗИП, буксирный трос, фары с решёткой
    P.add('paint', rbox(0.32, 0.36, 1.2, s * 1.22, 1.2, 1.6, 0.03));
    P.add('paint', rbox(0.32, 0.3, 0.8, s * 1.22, 1.17, -0.3, 0.03));
    P.add('metal', torus(0.22, 0.022, { x: s * 1.0, y: 1.66, z: -1.2, axis: 'y', seg: 20 }));
    P.add('dark', rbox(0.2, 0.15, 0.14, s * 0.85, 1.54, -2.25, 0.02));
    P.add('lens', lathe([[0, -2.34], [0.05, -2.335], [0.055, -2.32], [0, -2.32]], { x: s * 0.85, y: 1.54, seg: 16 }));
    for (let i = 0; i < 3; i++) P.add('metal', cylY(0.006, 1.46, 1.64, { x: s * 0.85 - 0.06 + i * 0.06, z: -2.35, seg: 5 }));
    // гусеница
    const tr = new THREE.Shape();
    tr.moveTo(-3.05, 0.62); tr.lineTo(-2.7, 0.9); tr.lineTo(2.85, 0.9); tr.lineTo(3.05, 0.62); tr.lineTo(2.85, 0.06); tr.lineTo(-2.7, 0.06); tr.closePath();
    const tg = new THREE.ExtrudeGeometry(tr, { depth: 0.42, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.05, bevelSegments: 2 });
    tg.translate(0, 0, -0.21); tg.rotateY(-Math.PI / 2);
    const uv = tg.attributes.uv, p = tg.attributes.position;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * 2, (p.getZ(i) + p.getY(i)) * 2.4);
    const track = new THREE.Mesh(tg, M.track); track.position.x = s * 1.2; track.castShadow = true; g.add(track);
    res.track = res.track || []; res.track.push(track);
    // траки-грунтозацепы поверх ленты (рельеф)
    for (let i = 0; i < 46; i++) P.add('dark', rbox(0.44, 0.03, 0.05, s * 1.2, 0.045, -2.65 + i * 0.12, 0.008));
    for (let i = 0; i < 46; i++) P.add('dark', rbox(0.44, 0.03, 0.05, s * 1.2, 0.915, -2.65 + i * 0.12, 0.008));
    // катки, ленивец, ведущее колесо
    for (let i = 0; i < 6; i++) res.wheels.push(makeWheel(g, 0.28, 0.14, s * 1.43, 0.33, -2.2 + i * 0.88, M, { hubs: 6, lugs: 0, rimR: 0.84 }));
    res.wheels.push(makeWheel(g, 0.25, 0.13, s * 1.43, 0.66, -2.85, M, { hubs: 10, lugs: 0, rimR: 0.8 }));
    res.wheels.push(makeWheel(g, 0.25, 0.13, s * 1.43, 0.6, 2.88, M, { hubs: 6, lugs: 0, rimR: 0.84 }));
  }
  // приборы наблюдения водителя, люки, кормовые двери, выхлоп
  for (let i = 0; i < 3; i++) P.add('glass', rbox(0.2, 0.08, 0.07, -0.75 + i * 0.32, 1.72, -1.98, 0.01).rotateX(-0.3));
  P.add('paint', rbox(0.75, 0.08, 0.55, -0.6, 1.82, -1.3, 0.03));
  for (const s of [-1, 1]) { P.add('paint', rbox(0.85, 0.07, 0.65, s * 0.5, 1.67, 1.6, 0.03)); P.add('metal', cylX(0.025, s * 0.5 - 0.3, s * 0.5 + 0.3, { y: 1.71, z: 1.25, seg: 8 })); }
  for (const s of [-1, 1]) { P.add('paint', rbox(0.7, 1.0, 0.06, s * 0.45, 1.0, 3.25, 0.03)); P.add('metal', rbox(0.04, 0.04, 0.12, s * 0.2, 1.05, 3.3, 0.01)); }
  P.add('dark', cylX(0.07, 0.6, 1.1, { y: 1.42, z: 0.4, seg: 14 }));
  P.add('metal', rbox(1.6, 0.05, 0.05, 0, 1.67, 2.3, 0.01));
  // бревно для самовытаскивания на корме
  P.add('canvas', cylX(0.1, -1.0, 1.0, { y: 1.75, z: 3.0, seg: 12 }));
  g.add(P.build(M));
  // башня с ПКТ
  const tur = new THREE.Group();
  const TP = new Parts();
  TP.add('paint', xf(new THREE.CylinderGeometry(0.42, 0.5, 0.36, 26), { y: 0 }));
  TP.add('paint', xf(new THREE.SphereGeometry(0.42, 26, 10, 0, Math.PI * 2, 0, Math.PI / 2), { sy: 0.42, y: 0.17 }));
  TP.add('glass', rbox(0.14, 0.1, 0.14, -0.18, 0.26, -0.22, 0.02));
  TP.add('paint', cylY(0.16, 0.24, 0.32, { x: 0.12, z: 0.1, seg: 18 }));
  tur.add(TP.build(M));
  const gun = new THREE.Group();
  const GP = new Parts();
  GP.add('paint', rbox(0.26, 0.2, 0.22, 0, 0, -0.08, 0.05));
  GP.add('metal', cylZ(0.02, -0.2, -1.0, { seg: 10 }));
  GP.add('dark', lathe([[0, -1.1], [0.028, -1.1], [0.03, -0.98], [0, -0.98]], { seg: 12 }));
  gun.add(GP.build(M));
  gun.position.set(0, 0.06, -0.32);
  tur.add(gun);
  tur.position.set(0.55, 1.8, -1.45);
  g.add(tur);
  res.turret = tur; res.gun = gun;
  res.steerWheels = [];
  res.trackTex = M.track.map;
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return res;
}
