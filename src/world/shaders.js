// Общие шейдерные доработки: ветер (качание елей, берёз, травы и кустов), выветренные стены
// построек (снег на подоконниках, карнизах и сколах, потёки, сырой низ), иней на стёклах.
import * as THREE from 'three';

// Общие на всю сцену: время и ветер (м/с, по осям X/Z). Обновляет задание каждый кадр.
export const WIND = { uTime: { value: 0 }, uWind: { value: new THREE.Vector3(3, 0, 0) } };

const NOISE = `
float wz_h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wz_n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(wz_h(i), wz_h(i+vec2(1,0)), f.x), mix(wz_h(i+vec2(0,1)), wz_h(i+vec2(1,1)), f.x), f.y); }
`;

// Качание по ветру для деревьев из слитой геометрии: атрибут aSway = (размах, фаза).
// Размах растёт к вершине (у комля ноль), есть постоянный наклон по ветру, порывы и
// поперечная «восьмёрка» — дерево не ходит маятником.
export function addTreeSway(sh) {
  sh.uniforms.uTime = WIND.uTime; sh.uniforms.uWind = WIND.uWind;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>
attribute vec2 aSway; uniform float uTime; uniform vec3 uWind;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  float wS = length(uWind.xz);
  vec2 wd = wS > 0.01 ? uWind.xz / wS : vec2(1.0, 0.0);
  float ph = aSway.y + uTime * (0.9 + 0.12 * sin(aSway.y * 3.1));
  float gust = 0.55 + 0.45 * sin(uTime * 0.31 + aSway.y * 0.17) * sin(uTime * 0.13 + 1.3);
  float a = aSway.x * (0.3 + wS * 0.09) * gust;
  transformed.xz += wd * a * (0.55 + 0.45 * sin(ph)) + vec2(-wd.y, wd.x) * a * 0.3 * sin(ph * 1.63 + 0.7);
}`);
}

// Качание травы и кустов (инстансы): фаза от положения куста, смещение в мире по ветру,
// переводится в систему инстанса (поворот вокруг вертикали + масштаб)
export function swayInstanced(mat, amp, key) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = WIND.uTime; sh.uniforms.uWind = WIND.uWind;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec3 uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
{
  vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  float wS = length(uWind.xz);
  vec2 wd = wS > 0.01 ? uWind.xz / wS : vec2(1.0, 0.0);
  float k = max(position.y, 0.0); k *= k;
  float ph = dot(ip.xz, vec2(0.21, 0.17)) + uTime * (1.7 + 0.4 * fract(ip.x * 0.37));
  float gust = 0.6 + 0.4 * sin(uTime * 0.5 + dot(ip.xz, wd) * 0.05);
  vec2 off = (wd * (0.5 + 0.5 * sin(ph)) + vec2(-wd.y, wd.x) * 0.25 * sin(ph * 1.9)) * k * ${amp.toFixed(3)} * (0.4 + wS * 0.12) * gust;
  mat3 im = mat3(instanceMatrix);
  float s2 = max(dot(im[0], im[0]), 1e-4);
  transformed += transpose(im) * vec3(off.x, 0.0, off.y) / s2;
}
#endif`);
  };
  mat.customProgramCacheKey = () => 'sway' + key;
  return mat;
}

// Выветренная стена: снег на всём, что смотрит вверх (подоконники, обломанный верх стен,
// карнизы), вертикальные потёки сверху вниз, сырой тёмный низ стены. Высота над основанием —
// из развёртки стены (uv.y × масштаб текстуры), так что работает на любом рельефе.
const wallCache = new Map();
export function weatheredWall(mat, texScale, kind) {
  const key = mat.uuid + ':' + texScale;
  if (wallCache.has(key)) return wallCache.get(key);
  const m = mat.clone();
  const streak = kind === 'wood' ? 0.1 : kind === 'brick' ? 0.13 : 0.16;
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWwN; varying vec3 vWwP; varying float vWwH;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vWwN = normalize(mat3(modelMatrix) * normal);
vWwP = (modelMatrix * vec4(position, 1.0)).xyz;
vWwH = uv.y * ${texScale.toFixed(3)};`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWwN; varying vec3 vWwP; varying float vWwH;
${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  float wwSide = 1.0 - abs(vWwN.y);
  // потёки: шум, вытянутый по вертикали, сильнее под верхом стены
  vec2 sp = vec2(dot(vWwP.xz, vec2(0.707, 0.707)) * 7.0, vWwP.y * 0.6);
  float st = smoothstep(0.55, 0.95, wz_n(sp) * 0.7 + wz_n(sp * vec2(2.3, 1.1) + 7.0) * 0.3);
  diffuseColor.rgb *= 1.0 - st * ${streak.toFixed(3)} * wwSide;
  // сырой и грязный низ: до ~0,6 м над основанием
  float damp = (1.0 - smoothstep(0.0, 0.55 + wz_n(vWwP.xz * 3.0) * 0.25, vWwH)) * wwSide;
  diffuseColor.rgb *= 1.0 - damp * 0.28;
  // снег на горизонтальных гранях с рваным краем
  float snK = smoothstep(0.55, 0.85, vWwN.y + (wz_n(vWwP.xz * 4.0) - 0.5) * 0.35);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 0.98), snK);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = mix(roughnessFactor, 0.82, snK);
  roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.75, damp);`);
  };
  m.customProgramCacheKey = () => 'wall' + texScale + streak;
  wallCache.set(key, m);
  return m;
}

// Иней на стекле: от краёв рамы к середине — «папоротник» из шума, мутно-белый
export function frostGlass(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
#ifdef USE_UV
  {
    vec2 e = min(vUv, 1.0 - vUv);
    float edge = min(e.x * 1.4, e.y);
    float fern = wz_n(vUv * 23.0) * 0.6 + wz_n(vUv * 61.0 + 3.0) * 0.4;
    float fr = (1.0 - smoothstep(0.015, 0.09 + fern * 0.12, edge)) * (0.55 + 0.45 * fern);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.93, 0.97), fr * 0.8);
    diffuseColor.a = mix(diffuseColor.a, 0.8, fr);
  }
#endif`);
  };
  // нужен vUv: включаем через карту-пустышку альфы? проще — define
  mat.defines = { ...(mat.defines || {}), USE_UV: '' };
  mat.customProgramCacheKey = () => 'frostglass';
  return mat;
}
