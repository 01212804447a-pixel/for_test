// Визуальные эффекты: частицы (дым, снег, искры, огонь), декали, вспышки света, трассеры
import * as THREE from 'three';
import { rand } from '../core/math.js';

const pVert = /* glsl */`
attribute float size;
attribute vec4 pcolor;
uniform float uScale;
varying vec4 vColor;
varying float vDist;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = -mv.z;
  gl_PointSize = clamp(size * uScale / max(vDist, 0.05), 0.0, 1024.0);
  vColor = pcolor;
  gl_Position = projectionMatrix * mv;
}`;
const pFrag = /* glsl */`
uniform vec3 uFogColor; uniform float uFogDensity; uniform float uAdditive; uniform float uLight;
varying vec4 vColor; varying float vDist;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = smoothstep(0.5, 0.05, d);
  if (a * vColor.a < 0.004) discard;
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
  vec3 col = vColor.rgb;
  if (uAdditive < 0.5) { col *= uLight; col = mix(col, uFogColor, fog); gl_FragColor = vec4(col, a * vColor.a); }
  else { gl_FragColor = vec4(col * a * vColor.a * (1.0 - fog), 1.0); }
}`;

class ParticlePool {
  constructor(max, additive) {
    this.max = max; this.n = 0; this.additive = additive;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
    this.col = new Float32Array(max * 3);
    this.a0 = new Float32Array(max); this.a1 = new Float32Array(max);
    this.drag = new Float32Array(max); this.grav = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos); g.setAttribute('size', this.aSize); g.setAttribute('pcolor', this.aCol);
    this.uniforms = {
      uScale: { value: 500 }, uFogColor: { value: new THREE.Color() }, uFogDensity: { value: 0 },
      uAdditive: { value: additive ? 1 : 0 }, uLight: { value: 1 },
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: pVert, fragmentShader: pFrag,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 5 : 4;
  }
  emit(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a0, a1, drag = 0, grav = 0) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = 0; this.maxLife[i] = life; this.s0[i] = s0; this.s1[i] = s1;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.a0[i] = a0; this.a1[i] = a1; this.drag[i] = drag; this.grav[i] = grav;
  }
  _kill(i) {
    const j = --this.n;
    if (i === j) return;
    for (let k = 0; k < 3; k++) { this.pos[i * 3 + k] = this.pos[j * 3 + k]; this.vel[i * 3 + k] = this.vel[j * 3 + k]; this.col[i * 3 + k] = this.col[j * 3 + k]; }
    this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j]; this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j];
    this.a0[i] = this.a0[j]; this.a1[i] = this.a1[j]; this.drag[i] = this.drag[j]; this.grav[i] = this.grav[j];
  }
  update(dt, wind) {
    for (let i = 0; i < this.n; i++) {
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) { this._kill(i); i--; continue; }
      const dr = Math.exp(-this.drag[i] * dt);
      const k = i * 3;
      this.vel[k] = (this.vel[k] - wind.x) * dr + wind.x;
      this.vel[k + 1] = this.vel[k + 1] * dr - this.grav[i] * dt;
      this.vel[k + 2] = (this.vel[k + 2] - wind.z) * dr + wind.z;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
    }
    const P = this.aPos.array, S = this.aSize.array, C = this.aCol.array;
    for (let i = 0; i < this.n; i++) {
      const t = this.life[i] / this.maxLife[i];
      P[i * 3] = this.pos[i * 3]; P[i * 3 + 1] = this.pos[i * 3 + 1]; P[i * 3 + 2] = this.pos[i * 3 + 2];
      S[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(t);
      C[i * 4] = this.col[i * 3]; C[i * 4 + 1] = this.col[i * 3 + 1]; C[i * 4 + 2] = this.col[i * 3 + 2];
      C[i * 4 + 3] = this.a0[i] + (this.a1[i] - this.a0[i]) * t;
    }
    this.points.geometry.setDrawRange(0, this.n);
    this.aPos.needsUpdate = this.aSize.needsUpdate = this.aCol.needsUpdate = true;
  }
}

function dotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.smoke = new ParticlePool(3500, false);
    this.glow = new ParticlePool(1800, true);
    scene.add(this.smoke.points, this.glow.points);
    this.wind = new THREE.Vector3();
    this.emitters = [];
    // свет вспышек
    this.lights = [];
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffb060, 0, 30, 2);
      l.userData.t = 0; l.userData.dur = 0.1; l.userData.peak = 0;
      scene.add(l);
      this.lights.push(l);
    }
    this._li = 0;
    // декали
    const dg = new THREE.PlaneGeometry(1, 1);
    const dm = new THREE.MeshBasicMaterial({ map: dotTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, color: 0xffffff });
    this.decals = new THREE.InstancedMesh(dg, dm, 600);
    this.decals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.decals.setColorAt(0, new THREE.Color());
    scene.add(this.decals);
    this._di = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._v = new THREE.Vector3();
    // трассеры
    this.maxTracers = 300;
    const tg = new THREE.BufferGeometry();
    this.tPos = new THREE.BufferAttribute(new Float32Array(this.maxTracers * 4 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.tCol = new THREE.BufferAttribute(new Float32Array(this.maxTracers * 4 * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const idx = new Uint16Array(this.maxTracers * 6);
    for (let i = 0; i < this.maxTracers; i++) { const b = i * 4; idx.set([b, b + 1, b + 2, b + 1, b + 3, b + 2], i * 6); }
    tg.setAttribute('position', this.tPos); tg.setAttribute('color', this.tCol); tg.setIndex(new THREE.BufferAttribute(idx, 1));
    this.tracerMesh = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    this.tracerMesh.frustumCulled = false;
    this.tracerMesh.renderOrder = 6;
    scene.add(this.tracerMesh);
    this.tracers = [];
    this.light = 1;
  }

  setView(camera, height, fog) {
    const sc = height / 2 / Math.tan((camera.fov * Math.PI) / 360);
    for (const p of [this.smoke, this.glow]) {
      p.uniforms.uScale.value = sc;
      if (fog) { p.uniforms.uFogColor.value.copy(fog.color); p.uniforms.uFogDensity.value = fog.density; }
      p.uniforms.uLight.value = this.light;
    }
  }

  flashLight(pos, intensity = 60, dur = 0.06, color = 0xffb060, dist = 25) {
    const l = this.lights[this._li++ % this.lights.length];
    l.position.copy(pos); l.color.set(color); l.distance = dist;
    l.userData.t = 0; l.userData.dur = dur; l.userData.peak = intensity;
    l.intensity = intensity;
  }

  addDecal(pos, normal, size, color = 0x222222, opacity = 1) {
    const i = this._di++ % 600;
    this._v.copy(pos).addScaledVector(normal, 0.015);
    this._q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    const rq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.random() * 6.28);
    this._q.multiply(rq);
    this._s.set(size, size, size);
    this._m.compose(this._v, this._q, this._s);
    this.decals.setMatrixAt(i, this._m);
    const c = new THREE.Color(color).multiplyScalar(opacity);
    this.decals.setColorAt(i, c);
    this.decals.count = Math.min(600, Math.max(this.decals.count, i + 1));
    this.decals.instanceMatrix.needsUpdate = true;
    if (this.decals.instanceColor) this.decals.instanceColor.needsUpdate = true;
  }

  muzzle(pos, dir, scale = 1, smoke = true) {
    for (let i = 0; i < 3; i++) {
      const f = i * 0.12;
      this.glow.emit(pos.x + dir.x * f, pos.y + dir.y * f, pos.z + dir.z * f, dir.x * 8, dir.y * 8, dir.z * 8, 0.045, 0.35 * scale * (1.4 - i * 0.3), 0.5 * scale, 1, 0.75, 0.35, 1, 0, 0, 0);
    }
    if (smoke) for (let i = 0; i < 3; i++) {
      this.smoke.emit(pos.x, pos.y, pos.z, dir.x * rand(1, 3) + rand(-0.3, 0.3), dir.y * 2 + rand(0, 0.5), dir.z * rand(1, 3) + rand(-0.3, 0.3), rand(0.8, 1.6), 0.15 * scale, 1.2 * scale, 0.85, 0.85, 0.85, 0.18, 0, 1.5, -0.25);
    }
    this.flashLight(pos, 40 * scale, 0.05);
  }

  impact(pos, normal, mat, scale = 1) {
    const n = normal;
    const S = scale;
    if (mat === 'snow' || mat === 'sandbag') {
      const m = mat === 'snow' ? [0.95, 0.97, 1] : [0.8, 0.75, 0.62];
      for (let i = 0; i < 10; i++) {
        const sp = rand(1, 5);
        this.smoke.emit(pos.x, pos.y + 0.05, pos.z, n.x * sp + rand(-1.5, 1.5), n.y * sp + rand(1, 4), n.z * sp + rand(-1.5, 1.5), rand(0.6, 1.4), 0.15 * S, rand(0.6, 1.3) * S, m[0], m[1], m[2], 0.75, 0, 2.2, 3);
      }
      this.smoke.emit(pos.x, pos.y + 0.2, pos.z, 0, 0.5, 0, 1.8, 0.4 * S, 1.6 * S, m[0], m[1], m[2], 0.45, 0, 1, -0.1);
    } else if (mat === 'metal') {
      for (let i = 0; i < 8; i++) {
        const sp = rand(3, 12);
        this.glow.emit(pos.x, pos.y, pos.z, n.x * sp + rand(-4, 4), n.y * sp + rand(-2, 5), n.z * sp + rand(-4, 4), rand(0.1, 0.35), 0.05, 0.02, 1, 0.8, 0.4, 1, 0.2, 0.5, 9.8);
      }
      this.smoke.emit(pos.x, pos.y, pos.z, n.x, n.y + 0.4, n.z, 0.7, 0.1, 0.5, 0.5, 0.5, 0.5, 0.35, 0, 1, 0);
    } else if (mat === 'blood') {
      for (let i = 0; i < 6; i++) this.smoke.emit(pos.x, pos.y, pos.z, n.x * 2 + rand(-1, 1), n.y * 2 + rand(-0.5, 1), n.z * 2 + rand(-1, 1), rand(0.3, 0.7), 0.08, 0.4, 0.45, 0.04, 0.04, 0.8, 0, 2, 4);
    } else {
      const c = mat === 'wood' || mat === 'target' ? [0.55, 0.42, 0.28] : mat === 'rock' ? [0.45, 0.45, 0.47] : [0.68, 0.68, 0.66];
      for (let i = 0; i < 7; i++) {
        const sp = rand(1, 5);
        this.smoke.emit(pos.x, pos.y, pos.z, n.x * sp + rand(-1, 1), n.y * sp + rand(-0.5, 2), n.z * sp + rand(-1, 1), rand(0.4, 1.1), 0.06 * S, 0.5 * S, c[0], c[1], c[2], 0.7, 0, 2, 4);
      }
      if (mat === 'concrete' || mat === 'rock') for (let i = 0; i < 3; i++) this.glow.emit(pos.x, pos.y, pos.z, n.x * 6 + rand(-3, 3), n.y * 6 + rand(0, 3), n.z * 6 + rand(-3, 3), 0.12, 0.04, 0.02, 1, 0.85, 0.6, 1, 0, 0, 9.8);
    }
  }

  explosion(pos, size = 1, snow = true) {
    const S = size;
    this.glow.emit(pos.x, pos.y + 0.3, pos.z, 0, 0, 0, 0.14, 4 * S, 9 * S, 1, 0.85, 0.55, 1, 0, 0, 0);
    for (let i = 0; i < 16 * S; i++) {
      const a = rand(0, 6.28), e = rand(0.2, 1.4), sp = rand(4, 14) * S;
      this.glow.emit(pos.x, pos.y + 0.3, pos.z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp, Math.sin(a) * Math.cos(e) * sp, rand(0.25, 0.55), 1.2 * S, 2.6 * S, 1, rand(0.45, 0.65), 0.15, 1, 0, 4, -1);
    }
    for (let i = 0; i < 26 * S; i++) {
      const a = rand(0, 6.28), sp = rand(1, 6) * S;
      const dark = rand(0.12, 0.3);
      this.smoke.emit(pos.x + rand(-1, 1) * S, pos.y + rand(0, 1.5) * S, pos.z + rand(-1, 1) * S, Math.cos(a) * sp, rand(1.5, 5) * S, Math.sin(a) * sp, rand(3, 7), 1.5 * S, rand(5, 9) * S, dark, dark, dark * 1.05, 0.75, 0, 0.9, -0.3);
    }
    if (snow) for (let i = 0; i < 30 * S; i++) {
      const a = rand(0, 6.28), sp = rand(3, 12) * S, up = rand(4, 14) * S;
      this.smoke.emit(pos.x, pos.y + 0.2, pos.z, Math.cos(a) * sp, up, Math.sin(a) * sp, rand(1.2, 2.5), 0.3 * S, 1.6 * S, 0.93, 0.94, 0.96, 0.8, 0, 0.8, 9.8);
    }
    // осколки-искры
    for (let i = 0; i < 20; i++) {
      const a = rand(0, 6.28), e = rand(-0.1, 1.2), sp = rand(30, 70);
      this.glow.emit(pos.x, pos.y + 0.3, pos.z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp, Math.sin(a) * Math.cos(e) * sp, rand(0.08, 0.2), 0.08, 0.04, 1, 0.8, 0.5, 1, 0.3, 0, 9.8);
    }
    this.flashLight(new THREE.Vector3(pos.x, pos.y + 1.5, pos.z), 900 * S, 0.25, 0xffa040, 80 * S);
  }

  addFire(pos, scale = 1, duration = 60) {
    this.emitters.push({ pos: pos.clone(), scale, t: 0, duration, acc: 0 });
  }

  rocketSmoke(pos, vel) {
    this.smoke.emit(pos.x, pos.y, pos.z, -vel.x * 0.02 + rand(-0.3, 0.3), rand(0, 0.4), -vel.z * 0.02 + rand(-0.3, 0.3), rand(1.5, 3), 0.25, 1.6, 0.8, 0.8, 0.8, 0.45, 0, 0.6, -0.15);
  }
  rocketFlame(pos) {
    this.glow.emit(pos.x, pos.y, pos.z, 0, 0, 0, 0.04, 0.45, 0.2, 1, 0.7, 0.3, 1, 0, 0, 0);
  }

  // трассер: голова в p, хвост по скорости
  pushTracer(p, v, camPos, color = [1, 0.35, 0.18]) {
    if (this.tracers.length >= this.maxTracers) return;
    this.tracers.push({ x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z, c: color, cx: camPos.x, cy: camPos.y, cz: camPos.z });
  }

  _flushTracers() {
    const P = this.tPos.array, C = this.tCol.array;
    let n = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), toCam = new THREE.Vector3(), side = new THREE.Vector3();
    for (const t of this.tracers) {
      a.set(t.x, t.y, t.z);
      const sp = Math.hypot(t.vx, t.vy, t.vz) || 1;
      const len = Math.min(sp * 0.03, 26);
      d.set(t.vx / sp, t.vy / sp, t.vz / sp);
      b.copy(a).addScaledVector(d, -len);
      toCam.set(t.cx - a.x, t.cy - a.y, t.cz - a.z);
      const dist = toCam.length();
      const w = Math.max(0.03, dist * 0.0018);
      side.crossVectors(d, toCam).normalize().multiplyScalar(w);
      const o = n * 12;
      P[o] = a.x + side.x; P[o + 1] = a.y + side.y; P[o + 2] = a.z + side.z;
      P[o + 3] = a.x - side.x; P[o + 4] = a.y - side.y; P[o + 5] = a.z - side.z;
      P[o + 6] = b.x + side.x; P[o + 7] = b.y + side.y; P[o + 8] = b.z + side.z;
      P[o + 9] = b.x - side.x; P[o + 10] = b.y - side.y; P[o + 11] = b.z - side.z;
      const c = t.c, oc = n * 16;
      for (let k = 0; k < 2; k++) { C[oc + k * 4] = c[0] * 2.2; C[oc + k * 4 + 1] = c[1] * 2.2; C[oc + k * 4 + 2] = c[2] * 2.2; C[oc + k * 4 + 3] = 1; }
      for (let k = 2; k < 4; k++) { C[oc + k * 4] = 0; C[oc + k * 4 + 1] = 0; C[oc + k * 4 + 2] = 0; C[oc + k * 4 + 3] = 0; }
      n++;
    }
    this.tracerMesh.geometry.setDrawRange(0, n * 6);
    this.tPos.needsUpdate = this.tCol.needsUpdate = true;
    this.tracers.length = 0;
  }

  update(dt) {
    for (const e of this.emitters) {
      e.t += dt;
      const fade = Math.max(0, 1 - e.t / e.duration);
      if (fade <= 0) continue;
      e.acc += dt * 30 * e.scale * fade;
      while (e.acc > 1) {
        e.acc -= 1;
        const s = e.scale;
        this.glow.emit(e.pos.x + rand(-0.6, 0.6) * s, e.pos.y + rand(0, 0.5) * s, e.pos.z + rand(-0.6, 0.6) * s, rand(-0.3, 0.3), rand(1.5, 3) * s, rand(-0.3, 0.3), rand(0.4, 0.9), 0.9 * s, 0.3 * s, 1, rand(0.4, 0.6), 0.12, 0.9, 0, 0.5, -1);
        if (Math.random() < 0.5) {
          const dk = rand(0.08, 0.18);
          this.smoke.emit(e.pos.x, e.pos.y + 1.2 * s, e.pos.z, rand(-0.3, 0.3), rand(1.5, 3), rand(-0.3, 0.3), rand(5, 9), 1.0 * s, 6 * s, dk, dk, dk, 0.55, 0, 0.3, -0.25);
        }
      }
      if (Math.random() < 0.1 && e.t < e.duration * 0.8) this.flashLight(new THREE.Vector3(e.pos.x, e.pos.y + 1.5, e.pos.z), 40 * e.scale, 0.15, 0xff8030, 20 * e.scale);
    }
    this.emitters = this.emitters.filter((e) => e.t < e.duration);
    this.smoke.update(dt, this.wind);
    this.glow.update(dt, { x: 0, z: 0 });
    for (const l of this.lights) {
      if (l.intensity <= 0) continue;
      l.userData.t += dt;
      const k = 1 - l.userData.t / l.userData.dur;
      l.intensity = k > 0 ? l.userData.peak * k : 0;
    }
    this._flushTracers();
  }
}
