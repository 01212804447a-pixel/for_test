// Небо: низкое полярное солнце, сумерки, полярная ночь со звёздами и северным сиянием
import * as THREE from 'three';

const vert = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const frag = /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform float uNight;
uniform float uAurora;
uniform float uOvercast;
uniform float uTime;
varying vec3 vDir;

float hash(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float vnoise(vec2 p){
  vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash2(i),hash2(i+vec2(1,0)),u.x), mix(hash2(i+vec2(0,1)),hash2(i+vec2(1,1)),u.x), u.y);
}
float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<4;i++){ s+=a*vnoise(p); p*=2.03; a*=.5;} return s; }

void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h,0.0,1.0), 0.5));
  if (h < 0.0) col = mix(uHorizon, uGround, clamp(-h*5.0, 0.0, 1.0));
  float sd = max(dot(d, uSunDir), 0.0);
  float sunVis = 1.0 - uOvercast*0.85;
  col += uSunColor * (pow(sd, 6.0)*0.25 + pow(sd, 48.0)*0.5) * sunVis;
  col += uSunColor * smoothstep(0.99955, 0.9998, sd) * 6.0 * sunVis * (1.0 - uNight);
  // облачность
  if (uOvercast > 0.0 && h > -0.05) {
    vec2 cp = d.xz / (h + 0.15) * 1.6 + vec2(uTime*0.004, 0.0);
    float c = fbm(cp);
    col = mix(col, mix(uHorizon*0.92, vec3(0.62,0.65,0.7)*(1.0-uNight*0.9), 0.5), clamp(uOvercast*(0.6+c*0.6),0.0,1.0));
  }
  // звёзды
  if (uNight > 0.01 && h > 0.0) {
    vec3 sp = d * 420.0;
    vec3 id = floor(sp);
    float s = hash(id);
    float star = step(0.9965, s) * smoothstep(0.6, 0.0, length(fract(sp)-0.5)) ;
    star *= 0.6 + 0.4*sin(uTime*3.0 + s*100.0);
    col += vec3(0.9,0.95,1.0) * star * uNight * (1.0 - uOvercast) * smoothstep(0.0, 0.15, h) * 1.6;
    // млечная полоса
    float mw = fbm(d.xz*3.0 + d.y) * smoothstep(0.35, 0.0, abs(d.x*0.6 + d.y*0.5 - 0.3));
    col += vec3(0.25,0.28,0.35) * mw * uNight * 0.25 * (1.0-uOvercast);
  }
  // северное сияние: слои «занавесей»
  if (uAurora > 0.01 && h > 0.0) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 18; i++) {
      float fi = float(i);
      float layer = 1.0 + fi * 0.06;
      vec2 p = d.xz / (h + 0.05) * (0.35 / layer);
      p += vec2(0.0, uTime*0.012);
      float band = sin(p.x*2.2 + fbm(p*1.5 + uTime*0.03)*4.0 + uTime*0.05);
      float curtain = smoothstep(0.55, 1.0, band) * fbm(p*vec2(1.0,6.0) + fi*0.1 - uTime*0.02);
      vec3 c = mix(vec3(0.1,1.0,0.45), vec3(0.6,0.2,0.9), fi/18.0);
      acc += c * curtain * (1.0 - fi/18.0) * 0.12;
    }
    col += acc * uAurora * smoothstep(0.02, 0.3, h) * (1.0 - uOvercast*0.8);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Sky {
  constructor(preset) {
    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(0, 0.1, -1).normalize() },
      uSunColor: { value: new THREE.Color(1, 0.8, 0.6) },
      uZenith: { value: new THREE.Color(0.25, 0.4, 0.65) },
      uHorizon: { value: new THREE.Color(0.8, 0.82, 0.86) },
      uGround: { value: new THREE.Color(0.7, 0.72, 0.76) },
      uNight: { value: 0 },
      uAurora: { value: 0 },
      uOvercast: { value: 0 },
      uTime: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(3000, 48, 24), mat);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
    if (preset) this.apply(preset);
  }

  // Пресет освещения: day | dusk | night
  apply(p) {
    const u = this.uniforms;
    const elev = (p.sunElev ?? 6) * Math.PI / 180, az = (p.sunAz ?? 180) * Math.PI / 180;
    // азимут от севера (-Z) по часовой стрелке
    u.uSunDir.value.set(Math.sin(az) * Math.cos(elev), Math.sin(elev), -Math.cos(az) * Math.cos(elev)).normalize();
    u.uOvercast.value = p.overcast ?? 0;
    u.uAurora.value = p.aurora ?? 0;
    if (p.time === 'night') {
      u.uNight.value = 1;
      u.uZenith.value.setRGB(0.01, 0.018, 0.04);
      u.uHorizon.value.setRGB(0.05, 0.07, 0.11);
      u.uGround.value.setRGB(0.04, 0.05, 0.07);
      u.uSunColor.value.setRGB(0.2, 0.25, 0.35);
    } else if (p.time === 'dusk') {
      u.uNight.value = 0.45;
      u.uZenith.value.setRGB(0.07, 0.12, 0.26);
      u.uHorizon.value.setRGB(0.55, 0.42, 0.42);
      u.uGround.value.setRGB(0.3, 0.3, 0.36);
      u.uSunColor.value.setRGB(1.0, 0.45, 0.25);
    } else {
      u.uNight.value = 0;
      u.uZenith.value.setRGB(0.18, 0.34, 0.62);
      u.uHorizon.value.setRGB(0.78, 0.8, 0.84);
      u.uGround.value.setRGB(0.72, 0.74, 0.78);
      u.uSunColor.value.setRGB(1.0, 0.78, 0.55);
    }
    if (u.uOvercast.value > 0.3) {
      u.uHorizon.value.lerp(new THREE.Color(0.7, 0.72, 0.76).multiplyScalar(1 - u.uNight.value * 0.9), u.uOvercast.value * 0.7);
      u.uZenith.value.lerp(new THREE.Color(0.5, 0.53, 0.58).multiplyScalar(1 - u.uNight.value * 0.9), u.uOvercast.value * 0.8);
    }
  }

  update(dt, camPos) {
    this.uniforms.uTime.value += dt;
    this.mesh.position.copy(camPos);
  }
}

// Настройка света и тумана сцены под пресет
export function makeLighting(scene, p) {
  const sky = new Sky(p);
  scene.add(sky.mesh);
  const night = p.time === 'night', dusk = p.time === 'dusk';
  const sunDir = sky.uniforms.uSunDir.value.clone();
  const sun = new THREE.DirectionalLight(
    night ? 0x9fb4ff : dusk ? 0xffb08a : 0xfff0dc,
    night ? 0.35 : dusk ? 1.1 : 3.4 * (1 - (p.overcast || 0) * 0.5),
  );
  // Ночью «луна» светит с высоты 25°; в сумерках рассеянный свет идёт чуть выше горизонта
  if (night) sunDir.set(-0.4, 0.45, 0.6).normalize();
  else if (sunDir.y < (dusk ? 0.08 : 0.19)) { sunDir.y = dusk ? 0.08 : 0.19; sunDir.normalize(); }
  sun.position.copy(sunDir).multiplyScalar(200);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 500;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  scene.add(sun); scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(
    night ? 0x2a3a66 : dusk ? 0x8a90b8 : 0xdbe4f2,
    night ? 0x0c1018 : dusk ? 0x6a6470 : 0xf2eee8,
    night ? 0.55 : dusk ? 0.9 : 1.2,
  );
  if (p.aurora && night) hemi.color.lerp(new THREE.Color(0x30ff90), 0.18 * p.aurora);
  scene.add(hemi);
  const fogCol = sky.uniforms.uHorizon.value.clone();
  scene.fog = new THREE.FogExp2(fogCol, p.fog ?? (night ? 0.0022 : 0.0007));
  return { sky, sun, hemi, sunDir, fogColor: fogCol };
}
