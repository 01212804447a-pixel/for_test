// Загрузка встроенных ассетов (base64-пакеты dist/assets/pack_*.js)
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

const urls = new Map();
const tex = new Map();
const gltfs = new Map();
const hdrs = new Map();

function blobURL(name) {
  if (urls.has(name)) return urls.get(name);
  const store = window.NEGS_ASSETS || {};
  const b64 = store[name];
  if (!b64) return null;
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const type = name.endsWith('.jpg') ? 'image/jpeg' : name.endsWith('.png') ? 'image/png' : 'application/octet-stream';
  const url = URL.createObjectURL(new Blob([arr], { type }));
  urls.set(name, url);
  return url;
}

export function hasAssets() { return (!!window.NEGS_ASSETS && Object.keys(window.NEGS_ASSETS).length > 0) || !!window.NEGS_ASSET_JSON; }

export async function preload(onProgress) {
  // веб-версия: пакеты лежат рядом как JSON
  if (window.NEGS_ASSET_JSON) {
    window.NEGS_ASSETS = window.NEGS_ASSETS || {};
    for (const u of window.NEGS_ASSET_JSON) {
      try { Object.assign(window.NEGS_ASSETS, await (await fetch(u)).json()); } catch (e) { console.warn('pack', u, e); }
    }
    window.NEGS_ASSET_JSON = null;
  }
  const store = window.NEGS_ASSETS || {};
  const names = Object.keys(store);
  let done = 0;
  const step = () => { done++; if (onProgress) onProgress(done / names.length); };
  const texLoader = new THREE.TextureLoader();
  const gl = new GLTFLoader();
  const hl = new RGBELoader();
  await Promise.all(names.map(async (n) => {
    try {
      const url = blobURL(n);
      if (n.startsWith('tex/')) tex.set(n, await texLoader.loadAsync(url));
      else if (n.startsWith('models/')) { const g = await gl.loadAsync(url); cheapGlass(g.scene); gltfs.set(n, g); }
      else if (n.startsWith('hdr/')) hdrs.set(n, await hl.loadAsync(url));
    } catch (e) { console.warn('asset', n, e); }
    step();
  }));
}

// Стекло моделей Poly Haven (transmission) заставляет three.js рисовать всю непрозрачную сцену
// ещё раз в отдельную цель — на GTX 1050 Ti это −8,6 мс за кадр в штабе. Заменяем обычной
// прозрачностью до первой компиляции шейдеров
export function cheapGlass(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material || [])) {
      if (!m || !(m.transmission > 0)) continue;
      m.transmission = 0; m.thickness = 0;
      m.transparent = true; m.opacity = Math.min(m.opacity ?? 1, 0.25); m.depthWrite = false;
      m.forceSinglePass = true;
    }
  });
}

// Прозрачные двусторонние материалы three.js рисует в два прохода и каждый раз помечает
// изменёнными (material.needsUpdate) — лишняя перепроверка шейдера на каждом объекте каждый
// кадр. Один проход — дешевле и без этого
export function singlePassTransparent(root) {
  root.traverse((o) => {
    for (const m of [].concat(o.material || [])) if (m && m.transparent && m.side === THREE.DoubleSide) m.forceSinglePass = true;
  });
}

// Текстура (клон с собственными настройками повторения)
export function texture(name, { srgb = true, repeat = 1, aniso = 8 } = {}) {
  const base = tex.get('tex/' + name);
  if (!base) return null;
  const t = base.clone();
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

// PBR-материал из набора Poly Haven: name_diff/nor/rough
export function pbr(name, { repeat = 1, color = 0xffffff, normalScale = 1, roughness = 1, metalness = 0, ...rest } = {}) {
  const map = texture(name + '_diff.jpg', { repeat });
  if (!map) return null;
  return new THREE.MeshStandardMaterial({
    map, color,
    normalMap: texture(name + '_nor.jpg', { srgb: false, repeat }), normalScale: new THREE.Vector2(normalScale, normalScale),
    roughnessMap: texture(name + '_rough.jpg', { srgb: false, repeat }), roughness, metalness, ...rest,
  });
}

export function registerModel(name, g) { gltfs.set('models/' + name + '.glb', g); }
export function model(name) { return gltfs.get('models/' + name + '.glb') || null; }
export function hdr(name) { return hdrs.get('hdr/' + name + '.hdr') || null; }
