// Пост-обработка: MSAA, мягкое свечение (bloom), цветокоррекция по времени суток,
// виньетка, лёгкое зерно. Оружие от первого лица рисуется вторым проходом поверх.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uVignette: { value: 0.32 },
    uLift: { value: new THREE.Vector3(0, 0, 0) }, uGain: { value: new THREE.Vector3(1, 1, 1) },
    uSat: { value: 1.0 }, uContrast: { value: 1.06 }, uGrain: { value: 0.025 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
uniform sampler2D tDiffuse; uniform float uTime, uVignette, uSat, uContrast, uGrain; uniform vec3 uLift, uGain;
varying vec2 vUv;
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime) * 43758.5453); }
void main(){
  vec4 c = texture2D(tDiffuse, vUv);
  vec3 col = c.rgb * uGain + uLift;
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSat);
  col = (col - 0.18) * uContrast + 0.18;
  vec2 d = vUv - 0.5;
  col *= 1.0 - uVignette * smoothstep(0.25, 0.85, length(d * vec2(1.25, 1.0)));
  col += (h(vUv * 1000.0) - 0.5) * uGrain * (0.4 + l);
  gl_FragColor = vec4(max(col, 0.0), c.a);
}`,
};

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.main = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    this.vm = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    this.vm.clear = false; this.vm.clearDepth = true;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.32, 0.55, 0.88);
    this.grade = new ShaderPass(GradeShader);
    this.out = new OutputPass();
    this.composer.addPass(this.main);
    this.composer.addPass(this.vm);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.grade);
    this.composer.addPass(this.out);
    this.t = 0;
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const s = this.renderer.getSize(new THREE.Vector2());
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(s.x, s.y);
  }

  // Пресет цветокоррекции по времени суток
  preset(time) {
    const u = this.grade.uniforms;
    if (time === 'night') { u.uLift.value.set(0.0, 0.004, 0.012); u.uGain.value.set(0.92, 1.0, 1.12); u.uSat.value = 0.85; u.uContrast.value = 1.08; this.bloom.strength = 0.6; this.bloom.threshold = 0.6; }
    else if (time === 'dusk') { u.uLift.value.set(0.006, 0.0, 0.01); u.uGain.value.set(1.04, 0.97, 1.02); u.uSat.value = 1.05; u.uContrast.value = 1.06; this.bloom.strength = 0.4; this.bloom.threshold = 0.8; }
    else { u.uLift.value.set(0.0, 0.0, 0.004); u.uGain.value.set(1.04, 1.01, 0.96); u.uSat.value = 1.0; u.uContrast.value = 1.12; this.bloom.strength = 0.28; this.bloom.threshold = 0.9; }
  }

  render(scene, camera, vmScene, vmCamera, dt = 0.016) {
    this.t += dt;
    this.grade.uniforms.uTime.value = this.t % 100;
    this.main.scene = scene; this.main.camera = camera;
    this.vm.enabled = !!vmScene;
    if (vmScene) { this.vm.scene = vmScene; this.vm.camera = vmCamera; }
    this.composer.render(dt);
  }
}
