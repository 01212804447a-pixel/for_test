// Ландшафт Заполярья: тундра, сопки, дороги, озёра, побережье
import * as THREE from 'three';
import { Noise2D } from '../core/noise.js';
import { clamp, lerp, smoothstep } from '../core/math.js';
import { snowTexture, snowNormal, rockTexture } from './textures.js';
import { texture as texAsset } from '../core/assets.js';

function distToPolyline(x, z, pts) {
  let best = 1e9, bestT = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz;
    let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
    t = clamp(t, 0, 1);
    const cx = ax + dx * t - x, cz = az + dz * t - z;
    const d = Math.sqrt(cx * cx + cz * cz);
    if (d < best) { best = d; bestT = i + t; }
  }
  return best;
}

export class Terrain {
  constructor({ size = 2400, seg = 384, seed = 1, amp = 30, features = [], boundary = 1050, mountain = 150 } = {}) {
    this.size = size; this.seg = seg; this.half = size / 2; this.cell = size / seg;
    this.amp = amp; this.features = features; this.boundary = boundary; this.mountain = mountain;
    this.noise = new Noise2D(seed);
    this.n = seg + 1;
    this.h = new Float32Array(this.n * this.n);
    this.mask = new Uint8Array(this.n * this.n); // 1 — дорога, 2 — лёд, 3 — пляж
    this.hasSea = features.some((f) => f.type === 'coast');
    // на приморских картах суша гарантированно выше уровня моря
    this.landOffset = this.hasSea ? amp * 0.6 + 6 : 0;
    this._generate();
  }

  largeScale(x, z) {
    const n = this.noise, a = this.amp;
    return n.fbm(x / 900, z / 900, 4) * a + n.ridged(x / 450 + 3, z / 450 - 7, 3) * a * 0.55 - a * 0.3 + this.landOffset;
  }

  baseHeight(x, z) {
    const n = this.noise;
    let h = this.largeScale(x, z);
    h += n.fbm(x / 70, z / 70, 3) * 1.8 + n.noise(x / 16, z / 16) * 0.3;
    const r = Math.sqrt(x * x + z * z);
    if (r > this.boundary) {
      const t = smoothstep(this.boundary, this.boundary + 320, r);
      h += t * this.mountain * (0.55 + 0.45 * n.ridged(x / 180, z / 180, 4));
    }
    return h;
  }

  heightFn(x, z, maskOut, upto = 1e9) {
    let h = this.baseHeight(x, z);
    let m = 0;
    for (let fi = 0; fi < this.features.length && fi < upto; fi++) {
      const f = this.features[fi];
      switch (f.type) {
        case 'flat': {
          const d = Math.hypot(x - f.x, z - f.z);
          if (d < f.r + f.fall) {
            if (f._h === undefined) f._h = f.h !== undefined ? f.h : this.heightFn(f.x, f.z, null, fi) + (f.dh || 0);
            const w = 1 - smoothstep(f.r, f.r + f.fall, d);
            h = lerp(h, f._h + this.noise.noise(x / 9, z / 9) * 0.08, w);
          }
          break;
        }
        case 'hill': {
          const d2 = ((x - f.x) ** 2 + (z - f.z) ** 2) / (f.r * f.r);
          h += f.h * Math.exp(-d2 * 2);
          break;
        }
        case 'road': {
          const d = distToPolyline(x, z, f.pts);
          const hw = f.w / 2;
          if (d < hw + f.fall) {
            const w = 1 - smoothstep(hw, hw + f.fall, d);
            h = lerp(h, this.largeScale(x, z) + (f.dh || 0), w);
            if (d < hw) m = 1;
          }
          break;
        }
        case 'valley': {
          const d = distToPolyline(x, z, f.pts);
          if (d < f.w) h -= f.depth * (1 - smoothstep(0, f.w, d)) ** 1.5;
          break;
        }
        case 'lake': {
          const d = Math.hypot(x - f.x, z - f.z) + this.noise.noise(x / 60, z / 60) * f.r * 0.15;
          if (d < f.r + f.fall) {
            const w = 1 - smoothstep(f.r, f.r + f.fall, d);
            if (f._lv === undefined) f._lv = f.level !== undefined ? f.level : this.heightFn(f.x, f.z, null, fi) - 1.2;
            h = lerp(h, f._lv, w);
            if (d < f.r) m = 2;
          }
          break;
        }
        case 'coast': {
          // f.nx, f.nz — нормаль в сторону моря; f.d — расстояние линии от центра
          const s = x * f.nx + z * f.nz - f.d + this.noise.noise(x / 160, z / 160) * 45 + this.noise.noise(x / 40, z / 40) * 8;
          if (s > -40) {
            const w = smoothstep(-40, 50, s);
            h = lerp(h, -f.depth, w);
            if (s > -25 && s < 10) m = 3;
          }
          break;
        }
        default: break;
      }
    }
    if (maskOut) maskOut.m = m;
    return h;
  }

  _generate() {
    const n = this.n, c = this.cell, half = this.half;
    const mo = { m: 0 };
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const x = ix * c - half, z = iz * c - half;
        this.h[iz * n + ix] = this.heightFn(x, z, mo);
        this.mask[iz * n + ix] = mo.m;
      }
    }
  }

  // Точная высота поверхности по треугольникам сетки
  heightAt(x, z) {
    const c = this.cell, n = this.n;
    let fx = (x + this.half) / c, fz = (z + this.half) / c;
    fx = clamp(fx, 0, this.seg - 1e-4); fz = clamp(fz, 0, this.seg - 1e-4);
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const u = fx - ix, v = fz - iz;
    const i = iz * n + ix;
    const ha = this.h[i], hd = this.h[i + 1], hb = this.h[i + n], hc = this.h[i + n + 1];
    if (u + v <= 1) return ha + (hd - ha) * u + (hb - ha) * v;
    return hc + (hb - hc) * (1 - u) + (hd - hc) * (1 - v);
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = this.cell * 0.5;
    const hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e), hu = this.heightAt(x, z + e);
    out.set(hl - hr, 2 * e, hd - hu).normalize();
    return out;
  }

  maskAt(x, z) {
    const c = this.cell, n = this.n;
    const ix = clamp(Math.round((x + this.half) / c), 0, this.seg), iz = clamp(Math.round((z + this.half) / c), 0, this.seg);
    return this.mask[iz * n + ix];
  }

  // Пересечение отрезка с поверхностью: возвращает долю t ∈ [0,1] или -1
  segment(p0, p1) {
    const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    const steps = Math.min(600, Math.max(1, Math.ceil(len / (this.cell * 0.45))));
    let pf = p0.y - this.heightAt(p0.x, p0.z);
    if (pf < 0) return 0;
    let pt = 0;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const f = p0.y + dy * t - this.heightAt(p0.x + dx * t, p0.z + dz * t);
      if (f < 0) {
        let a = pt, b = t;
        for (let k = 0; k < 10; k++) {
          const m = (a + b) / 2;
          const fm = p0.y + dy * m - this.heightAt(p0.x + dx * m, p0.z + dz * m);
          if (fm < 0) b = m; else a = m;
        }
        return (a + b) / 2;
      }
      pf = f; pt = t;
    }
    return -1;
  }

  buildMesh() {
    const n = this.n, c = this.cell, half = this.half;
    const pos = new Float32Array(n * n * 3);
    const col = new Float32Array(n * n * 3);
    const uv = new Float32Array(n * n * 2);
    const nor = new Float32Array(n * n * 3);
    const noise = this.noise;
    const v = new THREE.Vector3();
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const i = iz * n + ix;
        const x = ix * c - half, z = iz * c - half;
        const h = this.h[i];
        pos[i * 3] = x; pos[i * 3 + 1] = h; pos[i * 3 + 2] = z;
        uv[i * 2] = x / 3; uv[i * 2 + 1] = z / 3;
        const hl = this.h[iz * n + Math.max(0, ix - 1)], hr = this.h[iz * n + Math.min(n - 1, ix + 1)];
        const hd = this.h[Math.max(0, iz - 1) * n + ix], hu = this.h[Math.min(n - 1, iz + 1) * n + ix];
        v.set(hl - hr, 2 * c, hd - hu).normalize();
        nor[i * 3] = v.x; nor[i * 3 + 1] = v.y; nor[i * 3 + 2] = v.z;
        const slope = 1 - v.y;
        const patch = noise.noise(x / 25, z / 25) * 0.5 + noise.noise(x / 7, z / 7) * 0.25;
        let r = 0.96, g = 0.965, b = 0.985;
        // лёгкая синева в низинах
        const low = clamp((8 - h) / 30, 0, 1) * 0.04;
        r -= low; g -= low * 0.5;
        const rockT = smoothstep(0.18, 0.34, slope + patch * 0.08);
        r = lerp(r, 0.36 + patch * 0.05, rockT); g = lerp(g, 0.37 + patch * 0.05, rockT); b = lerp(b, 0.4 + patch * 0.05, rockT);
        const m = this.mask[i];
        if (m === 1) { r = 0.8; g = 0.78; b = 0.75; }
        else if (m === 2) { r = 0.66; g = 0.78; b = 0.88; }
        else if (this.hasSea && (m === 3 || h < 0.6)) { const t = clamp((0.6 - h) / 3, 0.4, 1); r = lerp(r, 0.3, t); g = lerp(g, 0.31, t); b = lerp(b, 0.34, t); }
        col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
      }
    }
    const idx = new Uint32Array(this.seg * this.seg * 6);
    let k = 0;
    for (let iz = 0; iz < this.seg; iz++) {
      for (let ix = 0; ix < this.seg; ix++) {
        const a = iz * n + ix, b = (iz + 1) * n + ix, cc = (iz + 1) * n + ix + 1, d = iz * n + ix + 1;
        idx[k++] = a; idx[k++] = b; idx[k++] = d;
        idx[k++] = b; idx[k++] = cc; idx[k++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, map: snowTexture(), normalMap: snowNormal(), normalScale: new THREE.Vector2(0.22, 0.22),
      roughness: 0.86, metalness: 0,
    });
    // Шейдер: снег в двух масштабах + макро-вариации, триплановый камень на склонах, искры снега
    const rock = texAsset('aerial_rocks_02_diff.jpg') || rockTexture();
    const snowMap = texAsset('snow_02_diff.jpg');
    if (snowMap) {
      mat.map = snowMap; mat.normalMap = texAsset('snow_02_nor.jpg', { srgb: false }); mat.roughnessMap = texAsset('snow_02_rough.jpg', { srgb: false });
      mat.normalScale.set(0.7, 0.7); mat.roughness = 1;
    }
    this.terrainUniforms = { uRock: { value: rock }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSparkle: { value: 1 }, uSnowAvg: { value: snowMap ? 0.5 : 0.93 } };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.terrainUniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNrm = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vWPos; varying vec3 vWNrm;
uniform sampler2D uRock; uniform vec3 uSunDir; uniform float uSparkle; uniform float uSnowAvg;
float tHash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
vec3 triRock(vec3 p, vec3 n){
  vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
  return texture2D(uRock, p.yz * 0.33).rgb * w.x + texture2D(uRock, p.xz * 0.33).rgb * w.y + texture2D(uRock, p.xy * 0.33).rgb * w.z;
}`)
        .replace('#include <map_fragment>', `
  vec3 sn1 = texture2D(map, vWPos.xz / 3.0).rgb;
  vec3 sn2 = texture2D(map, vWPos.xz / 23.0 + 0.37).rgb;
  float macro = texture2D(map, vWPos.xz / 380.0).r * 0.5 + texture2D(map, vWPos.xz / 97.0 + 0.5).g * 0.5;
  vec3 snowC = mix(sn1, sn2, 0.45) / uSnowAvg * 0.93 * (0.94 + (macro / uSnowAvg - 1.0) * 0.8);
  float slope = 1.0 - normalize(vWNrm).y;
  float rockW = smoothstep(0.2, 0.42, slope + (sn2.r - 0.93) * 2.0);
  vec3 rockC = triRock(vWPos, normalize(vWNrm)) * vec3(0.95, 0.97, 1.02) * 1.15;
  vec4 sampledDiffuseColor = vec4(mix(snowC, rockC / max(vColor.rgb, vec3(0.2)), rockW), 1.0);
  diffuseColor *= sampledDiffuseColor;
  float snowW = 1.0 - rockW;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  {
    vec2 cell = floor(vWPos.xz * 22.0);
    float h = tHash(cell);
    vec3 V = normalize(cameraPosition - vWPos);
    vec3 R = reflect(-V, normalize(vWNrm + vec3(tHash(cell + 1.0) - 0.5, 0.0, tHash(cell + 2.0) - 0.5) * 0.6));
    float gl = step(0.975, h) * pow(max(dot(R, uSunDir), 0.0), 24.0);
    float fadeD = 1.0 - smoothstep(10.0, 60.0, length(cameraPosition - vWPos));
    totalEmissiveRadiance += vec3(1.0, 0.97, 0.9) * gl * snowW * fadeD * 2.5 * uSparkle;
  }`);
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    return mesh;
  }

  buildSea() {
    if (!this.hasSea) return null;
    const g = new THREE.PlaneGeometry(this.size * 2, this.size * 2, 1, 1);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshStandardMaterial({ color: 0x1c2a36, roughness: 0.18, metalness: 0.2, transparent: true, opacity: 0.94 });
    const sea = new THREE.Mesh(g, m);
    sea.position.y = 0;
    sea.receiveShadow = true;
    const grp = new THREE.Group();
    grp.add(sea);
    // Плавучие льдины
    const ice = new THREE.MeshStandardMaterial({ color: 0xdfe9f2, roughness: 0.6 });
    const rnd = this.noise;
    for (let i = 0; i < 160; i++) {
      const x = (rnd.noise(i * 3.1, 1.7) * 0.5 + 0.5) * this.size - this.half;
      const z = (rnd.noise(2.3, i * 1.9) * 0.5 + 0.5) * this.size - this.half;
      if (this.heightAt(x, z) > -2) continue;
      const r = 3 + (rnd.noise(i, i) * 0.5 + 0.5) * 14;
      const fg = new THREE.CylinderGeometry(r, r * 1.05, 0.5, 7 + (i % 4));
      const f = new THREE.Mesh(fg, ice);
      f.position.set(x, 0.1, z); f.rotation.y = i;
      f.scale.set(1, 1, 0.6 + (i % 5) * 0.12);
      f.receiveShadow = true;
      grp.add(f);
    }
    return grp;
  }

  // Подложка карты
  makeMapImage(px = 512, range = 1100) {
    const c = document.createElement('canvas'); c.width = c.height = px;
    const g = c.getContext('2d');
    const img = g.createImageData(px, px);
    for (let y = 0; y < px; y++) {
      for (let x = 0; x < px; x++) {
        const wx = (x / px) * 2 * range - range, wz = (y / px) * 2 * range - range;
        const h = this.heightAt(wx, wz);
        const hx = this.heightAt(wx + 4, wz) - h, hz = this.heightAt(wx, wz + 4) - h;
        const shade = clamp(0.78 - (hx * 0.7 + hz * 0.45) * 0.25, 0.35, 1);
        let r = 228, gg = 232, b = 236;
        const m = this.maskAt(wx, wz);
        if (this.hasSea && h < 0) { r = 70; gg = 90; b = 110; } else if (m === 1) { r = 190; gg = 160; b = 120; } else if (m === 2) { r = 160; gg = 195; b = 220; }
        // изолинии через 10 м
        const iso = Math.abs(((h % 10) + 10) % 10 - 5) > 4.6 ? 0.82 : 1;
        const i = (y * px + x) * 4;
        img.data[i] = r * shade * iso; img.data[i + 1] = gg * shade * iso; img.data[i + 2] = b * shade * iso; img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }
}
