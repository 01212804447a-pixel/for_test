// Снегопад и метель вокруг камеры
import * as THREE from 'three';

export class Snowfall {
  constructor(count = 5000, intensity = 0.5, wind = new THREE.Vector3()) {
    this.box = new THREE.Vector3(70, 34, 70);
    this.count = count;
    this.intensity = intensity;
    this.wind = wind;
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * this.box.x;
      pos[i * 3 + 1] = Math.random() * this.box.y;
      pos[i * 3 + 2] = (Math.random() - 0.5) * this.box.z;
      seed[i] = Math.random();
    }
    this.base = pos.slice();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.uniforms = {
      uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: this.box },
      uWind: { value: new THREE.Vector3() }, uFall: { value: 1.2 }, uSize: { value: 1 },
      uAlpha: { value: Math.min(1, 0.35 + intensity) }, uOffset: { value: new THREE.Vector3() },
      uColor: { value: new THREE.Color(1, 1, 1) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true, depthWrite: false,
      vertexShader: /* glsl */`
        attribute float seed;
        uniform float uTime; uniform vec3 uCam; uniform vec3 uBox; uniform vec3 uOffset; uniform float uSize;
        varying float vA;
        void main(){
          vec3 p = position + uOffset * (0.7 + seed*0.6);
          p.x += sin(uTime*0.9 + seed*40.0)*0.6;
          p.z += cos(uTime*0.7 + seed*30.0)*0.6;
          // заворачиваем в коробку вокруг камеры
          vec3 rel = p - uCam;
          rel.x = mod(rel.x + uBox.x*0.5, uBox.x) - uBox.x*0.5;
          rel.z = mod(rel.z + uBox.z*0.5, uBox.z) - uBox.z*0.5;
          rel.y = mod(rel.y + uBox.y*0.5, uBox.y) - uBox.y*0.5;
          vec4 mv = modelViewMatrix * vec4(uCam + rel, 1.0);
          gl_Position = projectionMatrix * mv;
          float dist = -mv.z;
          gl_PointSize = clamp(uSize * (0.7 + seed) * 90.0 / max(dist, 0.5), 1.0, 14.0);
          vA = smoothstep(34.0, 6.0, dist) * smoothstep(0.3, 1.5, dist);
        }`,
      fragmentShader: /* glsl */`
        uniform float uAlpha; uniform vec3 uColor; varying float vA;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float a = smoothstep(0.5, 0.1, d) * vA * uAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.offset = new THREE.Vector3();
  }

  update(dt, camPos) {
    const u = this.uniforms;
    u.uTime.value += dt;
    u.uCam.value.copy(camPos);
    const fall = 1.0 + this.intensity * 0.6;
    this.offset.x += this.wind.x * dt;
    this.offset.z += this.wind.z * dt;
    this.offset.y -= fall * dt;
    u.uOffset.value.copy(this.offset);
  }
}
