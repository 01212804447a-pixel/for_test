// Объединение неподвижных объектов сцены: сотни отдельных сеток с одним материалом
// превращаются в одну. Видеокарте — то же число треугольников, но в разы меньше вызовов
// отрисовки (у браузера каждый вызов дорог, особенно на слабых ПК и встроенной графике).
// Не трогаем: скиннинг, инстансы, всё, что помечено userData.dyn (и их потомков), зеркальные.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const groups = new Map();
  const dyn = (o) => { for (let p = o; p; p = p.parent) if (p.userData && p.userData.dyn) return true; return false; };
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || !o.geometry || Array.isArray(o.material)) return;
    if (o.morphTargetInfluences || o.geometry.morphAttributes && Object.keys(o.geometry.morphAttributes).length) return;
    if (!o.visible || dyn(o) || o.matrixWorld.determinant() < 0) return;
    const g = o.geometry;
    if (!g.attributes.position) return;
    const attrs = Object.keys(g.attributes).sort().join(',');
    const key = `${o.material.uuid}|${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0}|${attrs}|${g.index ? 'i' : 'n'}|${o.renderOrder}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  });
  let before = 0, after = 0;
  for (const list of groups.values()) {
    before += list.length;
    if (list.length < 2) { after += list.length; continue; }
    const geos = list.map((o) => { const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); for (const k of Object.keys(g.attributes)) if (g.attributes[k].isInterleavedBufferAttribute) g.setAttribute(k, g.attributes[k].clone()); return g; });
    let merged = null;
    try { merged = mergeGeometries(geos, false); } catch (e) { merged = null; }
    if (!merged) { after += list.length; continue; }
    const src = list[0];
    const mesh = new THREE.Mesh(merged, src.material);
    mesh.castShadow = src.castShadow; mesh.receiveShadow = src.receiveShadow; mesh.renderOrder = src.renderOrder;
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    for (const o of list) o.parent && o.parent.remove(o);
    for (const g of geos) g.dispose();
    after += 1;
  }
  return { before, after };
}
