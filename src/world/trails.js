// Следы на снегу: колея техники (протектор «Тигра» и «Нивы», траки МТ-ЛБ) и отпечатки
// подошв бойцов. Колея — непрерывные ленты по рельефу, отпечатки — инстансы. Глубина —
// картой нормалей из карты высот (вдавленная колея с бортиками выдавленного снега,
// рисунок протектора и грунтозацепов, подошва с рифлением), низ следа чуть темнее и
// синее — как утоптанный снег в тени. В снегопад следы постепенно заметает.
import * as THREE from 'three';

// ---------- текстуры из карты высот ----------
function bake(W, H, heightFn, { tint = [0.80, 0.84, 0.92], alphaFn }) {
  const h = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) h[y * W + x] = heightFn((x + 0.5) / W, (y + 0.5) / H);
  const cc = document.createElement('canvas'); cc.width = W; cc.height = H;
  const cn = document.createElement('canvas'); cn.width = W; cn.height = H;
  const gc = cc.getContext('2d'), gn = cn.getContext('2d');
  const ic = gc.createImageData(W, H), inn = gn.createImageData(W, H);
  const at = (x, y) => h[((y + H) % H) * W + ((x + W) % W)];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, v = h[y * W + x];
    // нормаль (касательное пространство): u — поперёк, v — вдоль
    const dx = (at(x + 1, y) - at(x - 1, y)) * 6, dy = (at(x, y + 1) - at(x, y - 1)) * 6;
    const l = Math.hypot(dx, dy, 1);
    inn.data[i] = (-dx / l * 0.5 + 0.5) * 255; inn.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; inn.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; inn.data[i + 3] = 255;
    // цвет: глубже — темнее и синее (тень в выемке, утоптанный снег)
    const d = Math.max(0, Math.min(1, -v));
    const k = 1 - d * 0.42;
    ic.data[i] = 255 * k * (1 - d * (1 - tint[0]) * 0.6); ic.data[i + 1] = 255 * k * (1 - d * (1 - tint[1]) * 0.6); ic.data[i + 2] = 255 * k * (1 - d * (1 - tint[2]) * 0.3);
    ic.data[i + 3] = 255 * alphaFn((x + 0.5) / W, (y + 0.5) / H, v);
  }
  gc.putImageData(ic, 0, 0); gn.putImageData(inn, 0, 0);
  const map = new THREE.CanvasTexture(cc); map.colorSpace = THREE.SRGBColorSpace;
  const nrm = new THREE.CanvasTexture(cn);
  for (const t of [map, nrm]) { t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; }
  return { map, nrm };
}
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// поперечный профиль колеи: дно, стенки, бортики выдавленного снега по краям
const rut = (u, depth) => {
  const c = Math.abs(u - 0.5) * 2;               // 0 — середина, 1 — край ленты
  return -depth * (1 - smooth(0.6, 0.74, c)) + 0.3 * depth * smooth(0.7, 0.8, c) * (1 - smooth(0.86, 1, c));
};
let TEX = null;
function textures() {
  if (TEX) return TEX;
  TEX = {
    // шина: «ёлочка» внедорожного протектора, на одну текстуру — 0,5 м пути
    tire: bake(64, 128, (u, v) => {
      const side = u < 0.5 ? -1 : 1, c = Math.abs(u - 0.5) * 2;
      const lug = Math.sin((v * 8 + side * c * 0.9) * Math.PI * 2);
      return rut(u, 0.75) + (c < 0.7 ? 0.28 * smooth(0.2, 0.5, lug) : 0);
    }, { alphaFn: (u) => { const c = Math.abs(u - 0.5) * 2; return 0.92 * (1 - smooth(0.85, 1, c)); } }),
    // гусеница: поперечные грунтозацепы (шаг трака ~0,12 м, на текстуру — 2 трака) и паз гребня
    track: bake(64, 64, (u, v) => {
      const c = Math.abs(u - 0.5) * 2;
      const bar = smooth(0.12, 0.02, Math.abs(((v * 2) % 1) - 0.5) - 0.32);
      const horn = c < 0.12 ? -0.25 : 0;
      return rut(u, 0.85) - 0.3 * bar + horn;
    }, { alphaFn: (u) => { const c = Math.abs(u - 0.5) * 2; return 0.95 * (1 - smooth(0.86, 1, c)); } }),
    // подошва армейского ботинка: носок вверх текстуры (v=0), каблук отдельно, рифление
    boot: bake(32, 80, (u, v) => {
      const x = (u - 0.5) * 2, y = v;
      const sole = y < 0.66 ? (x * x) / (0.85 * 0.85) + ((y - 0.36) * (y - 0.36)) / (0.34 * 0.34) : 9;
      const heel = y > 0.7 ? (x * x) / (0.7 * 0.7) + ((y - 0.84) * (y - 0.84)) / (0.13 * 0.13) : 9;
      const inS = Math.min(sole, heel);
      if (inS > 1.25) return 0;
      const ridge = Math.sin(y * 70) > 0.2 ? 0.25 : 0;
      return -0.9 * (1 - smooth(0.75, 1.15, inS)) + ridge * (inS < 0.9 ? 1 : 0);
    }, { alphaFn: (u, v, h) => Math.min(0.95, Math.max(0, -h) * 2.2) }),
  };
  TEX.boot.map.wrapT = TEX.boot.nrm.wrapT = THREE.ClampToEdgeWrapping;
  return TEX;
}

// материал следа: свой цвет и рельеф, прозрачность угасает со временем (заметает снегом)
function trailMat(t, U) {
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.94, 0.95, 0.97), map: t.map, normalMap: t.nrm, normalScale: new THREE.Vector2(1.4, 1.4), roughness: 0.9, metalness: 0,
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime; sh.uniforms.uLife = U.uLife;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aFade;\nuniform float uTime, uLife;\nvarying float vFade;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = aFade.y * clamp(1.0 - (uTime - aFade.x) / uLife, 0.0, 1.0);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vFade;')
      .replace('#include <alphatest_fragment>', 'diffuseColor.a *= vFade;\n#include <alphatest_fragment>');
  };
  return m;
}

// Лента колеи: кольцевой буфер четырёхугольников
class Strips {
  constructor(scene, mat, cap) {
    this.cap = cap; this.n = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(cap * 12), 3).setUsage(THREE.DynamicDrawUsage);
    this.nrm = new THREE.BufferAttribute(new Float32Array(cap * 12), 3).setUsage(THREE.DynamicDrawUsage);
    this.uv = new THREE.BufferAttribute(new Float32Array(cap * 8), 2).setUsage(THREE.DynamicDrawUsage);
    this.fade = new THREE.BufferAttribute(new Float32Array(cap * 8), 2).setUsage(THREE.DynamicDrawUsage);
    const idx = new Uint32Array(cap * 6);
    for (let i = 0; i < cap; i++) { const a = i * 4; idx.set([a, a + 2, a + 1, a + 1, a + 2, a + 3], i * 6); }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setAttribute('position', this.pos); g.setAttribute('normal', this.nrm); g.setAttribute('uv', this.uv); g.setAttribute('aFade', this.fade);
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false; this.mesh.receiveShadow = true; this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }
  // L0,R0 → L1,R1 (края ленты), v0/v1 — координата вдоль, n — нормаль грунта
  push(L0, R0, L1, R1, v0, v1, n, t, k) {
    const i = this.n % this.cap; this.n++;
    const P = this.pos.array, N = this.nrm.array, U = this.uv.array, F = this.fade.array;
    // лицевая сторона — вверх при любом направлении движения (задний ход меняет обход)
    const cy = (L1.z - L0.z) * (R0.x - L0.x) - (L1.x - L0.x) * (R0.z - L0.z);
    const flip = cy < 0;
    const pts = flip ? [R0, L0, R1, L1] : [L0, R0, L1, R1];
    for (let j = 0; j < 4; j++) {
      const o = (i * 4 + j) * 3, p = pts[j];
      P[o] = p.x; P[o + 1] = p.y; P[o + 2] = p.z;
      N[o] = n.x; N[o + 1] = n.y; N[o + 2] = n.z;
      const q = (i * 4 + j) * 2;
      U[q] = (j & 1) ^ (flip ? 1 : 0); U[q + 1] = j < 2 ? v0 : v1;
      F[q] = t; F[q + 1] = k;
    }
    for (const a of [this.pos, this.nrm]) { a.addUpdateRange(i * 12, 12); a.needsUpdate = true; }
    for (const a of [this.uv, this.fade]) { a.addUpdateRange(i * 8, 8); a.needsUpdate = true; }
  }
}

// Отпечатки: инстансы квадрата 1×1 в плоскости XZ, носок — к −Z
class Prints {
  constructor(scene, mat, cap) {
    this.cap = cap; this.n = 0;
    const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
    this.fade = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aFade', this.fade);
    this.mesh = new THREE.InstancedMesh(g, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const z = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < cap; i++) this.mesh.setMatrixAt(i, z);
    this.mesh.frustumCulled = false; this.mesh.receiveShadow = true; this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }
  push(m4, t, k) {
    const i = this.n % this.cap; this.n++;
    this.mesh.setMatrixAt(i, m4);
    this.mesh.instanceMatrix.addUpdateRange(i * 16, 16); this.mesh.instanceMatrix.needsUpdate = true;
    this.fade.array[i * 2] = t; this.fade.array[i * 2 + 1] = k;
    this.fade.addUpdateRange(i * 2, 2); this.fade.needsUpdate = true;
  }
}

const _n = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// ширина следа и колея (полуколея), продольное положение задней оси
const RUT = { tigr: { w: 0.42, half: 0.92, z: 1.65 }, niva: { w: 0.22, half: 0.7, z: 1.1 }, mtlb: { w: 0.44, half: 1.24, z: 0 } };

export class SnowTrails {
  constructor(m) {
    this.m = m;
    const snow = (m.def.env && m.def.env.snow) || 0;
    // в снегопад следы заметает за несколько минут, без снегопада — держатся (кольцевой буфер)
    this.U = { uTime: { value: 0 }, uLife: { value: snow > 0.12 ? 240 : snow > 0.03 ? 700 : 1e6 } };
    const T = textures();
    this.tire = new Strips(m.scene, trailMat(T.tire, this.U), 4000);
    this.track = new Strips(m.scene, trailMat(T.track, this.U), 3000);
    this.boots = new Prints(m.scene, trailMat(T.boot, this.U), 5000);
    this.vs = new Map(); this.ss = new Map();
    this.time = 0;
  }

  // грунт под точкой: следы только на рельефе (не на крыше, настиле, валу); μ-маска — плотность следа
  _ground(x, z, y) {
    const T = this.m.terrain, h = T.heightAt(x, z);
    if (y !== undefined && Math.abs(y - h) > 0.12) return null;
    const mk = T.maskAt(x, z);
    if (mk === 2) return null;                      // лёд озера — следа нет
    if (T.hasSea && h < 0.3) return null;
    return { h, k: mk === 1 ? 0.55 : 1 };           // накатанная дорога — след бледнее
  }

  _vehicle(v) {
    const R = RUT[v.typeId];
    if (!R) return;
    let st = this.vs.get(v);
    if (!st) { st = { lines: [null, null], vacc: [0, 0] }; this.vs.set(v, st); }
    if (!v.alive || (v.contact ?? 1) < 0.5 || v.airT > 0.1) { st.lines[0] = st.lines[1] = null; return; }
    const c = Math.cos(v.yaw), s = Math.sin(v.yaw);
    const strips = v.type.tracked ? this.track : this.tire;
    const rep = v.type.tracked ? 0.236 : 0.5;
    for (let k = 0; k < 2; k++) {
      const side = k ? 1 : -1;
      // точка оси колеса/гусеницы на грунте (у колёсных — задняя ось, она идёт по следу передней)
      const lx = side * R.half, lz = R.z;
      const x = v.pos.x + c * lx + s * lz, z = v.pos.z - s * lx + c * lz;
      const gr = this._ground(x, z);
      const L = st.lines[k];
      if (!gr) { st.lines[k] = null; continue; }
      if (L && Math.hypot(x - L.x, z - L.z) > 4) { st.lines[k] = null; continue; } // скачок (телепорт, сеть)
      const hw = R.w * 0.72;                         // лента шире колеса: бортики выдавленного снега
      const ex = c * hw, ez = -s * hw;               // поперёк машины
      const y = gr.h + 0.025;
      const Lp = new THREE.Vector3(x - ex, this.m.terrain.heightAt(x - ex, z - ez) + 0.025, z - ez);
      const Rp = new THREE.Vector3(x + ex, this.m.terrain.heightAt(x + ex, z + ez) + 0.025, z + ez);
      if (!L) { st.lines[k] = { x, z, y, Lp, Rp, v: 0 }; continue; }
      const d = Math.hypot(x - L.x, z - L.z);
      if (d < 0.42) continue;
      const v1 = L.v + d / rep;
      this.m.terrain.normalAt(x, z, _n);
      strips.push(L.Lp, L.Rp, Lp, Rp, L.v, v1, _n, this.time, gr.k);
      st.lines[k] = { x, z, y, Lp, Rp, v: v1 >= 64 ? v1 - 64 : v1 };
    }
  }

  _soldier(s, dt) {
    let st = this.ss.get(s);
    if (!st) { st = { x: s.pos.x, z: s.pos.z, acc: 0, foot: 1 }; this.ss.set(s, st); }
    const dx = s.pos.x - st.x, dz = s.pos.z - st.z, d = Math.hypot(dx, dz);
    st.x = s.pos.x; st.z = s.pos.z;
    if (!s.alive || s.hidden || s.vehicle || s.stance === 'prone' || d > 2.5 || d < 1e-4) return;
    const gr = this._ground(s.pos.x, s.pos.z, s.pos.y);
    if (!gr) return;
    st.acc += d;
    const sp = dt > 0 ? d / dt : 0;
    // шаг: присед — короче, бег — длиннее (отпечаток каждой ноги — через полшага)
    const stride = s.stance === 'crouch' ? 0.5 : sp > 4.5 ? 0.95 : sp > 2.6 ? 0.82 : 0.68;
    if (st.acc < stride) return;
    st.acc -= stride;
    st.foot = -st.foot;
    const yaw = s.yaw, c = Math.cos(yaw), sn = Math.sin(yaw);
    const off = st.foot * 0.11;
    const x = s.pos.x + c * off, z = s.pos.z - sn * off;
    const h = this.m.terrain.heightAt(x, z);
    this.m.terrain.normalAt(x, z, _n);
    _q.setFromUnitVectors(UP, _n); _q2.setFromAxisAngle(UP, yaw + (Math.random() - 0.5) * 0.12); _q.multiply(_q2);
    _s.set(0.13, 1, 0.31);                         // подошва симметрична — без зеркала (лицевая сторона вверх)
    _m.compose(_p.set(x, h + 0.02, z), _q, _s);
    this.boots.push(_m, this.time, gr.k * (sp > 4.5 ? 1 : 0.9));
  }

  update(dt) {
    this.time += dt;
    this.U.uTime.value = this.time;
    const cam = this.m.camPos;
    const near = (p, r) => !cam || (p.x - cam.x) ** 2 + (p.z - cam.z) ** 2 < r * r;
    for (const v of this.m.vehicles) if (near(v.pos, 600)) this._vehicle(v);
    for (const s of this.m.soldiers) if (near(s.pos, 260)) this._soldier(s, dt); else this.ss.delete(s);
  }
}
