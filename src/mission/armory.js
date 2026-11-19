// Склад вооружения на точке появления (PvP): деревянная пирамида с оружием под навесом и ящики
// с боеприпасами. Подойти к образцу и зажать E — взять его вместо своего основного (или
// тяжёлого) оружия, с полным боекомплектом; у ящиков — пополнить патроны и гранаты, сдать
// тяжёлое оружие. Выбранное оружие остаётся и после возрождения. Остальные игроки видят
// новую модель в руках (её передаёт обычное состояние игрока).
import * as THREE from 'three';
import { thirdPersonGun } from '../weapons/guns.js';
import { TP_KIND } from '../entities/character.js';
import { WEAPONS, PRIMARY_CHOICES } from '../data/weapons.js';
import { makeState } from '../entities/player.js';

const HEAVY = ['rpg7', 'ptrd'];

export function buildArmory(m, { x, z, yaw = 0, team }) {
  const T = m.terrain, W = m.world;
  const y0 = T.heightAt(x, z);
  const root = new THREE.Group();
  root.position.set(x, y0, z); root.rotation.y = yaw;
  m.scene.add(root);
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b5634, roughness: 0.88 });
  const woodD = new THREE.MeshStandardMaterial({ color: 0x4a3b24, roughness: 0.92 });
  const tarp = new THREE.MeshStandardMaterial({ color: 0x4e5a3c, roughness: 0.95, side: THREE.DoubleSide });
  const green = new THREE.MeshStandardMaterial({ color: 0x3f4b33, roughness: 0.7, metalness: 0.2 });
  const box = (w, h, d, px, py, pz, mat, ry = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); b.position.set(px, py, pz); b.rotation.y = ry; b.castShadow = true; b.receiveShadow = true; root.add(b); return b; };
  const all = [...PRIMARY_CHOICES, ...HEAVY];
  const L = 0.42 * all.length + 0.6;
  // пирамида: основание с гнёздами для прикладов, стойки, верхний брус с вырезами
  box(L, 0.08, 0.55, 0, 0.04, 0, woodD);
  box(L, 0.05, 0.12, 0, 0.13, 0.16, wood);
  for (const sx of [-1, 1]) { box(0.08, 1.45, 0.08, sx * (L / 2 - 0.04), 0.72, -0.18, wood); box(0.08, 1.45, 0.08, sx * (L / 2 - 0.04), 0.72, 0.2, wood); }
  box(L, 0.07, 0.07, 0, 1.18, -0.18, wood);
  box(L, 0.05, 0.05, 0, 0.62, -0.18, woodD);
  // навес из брезента
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(L + 0.8, 1.6), tarp);
  roof.position.set(0, 2.05, 0.05); roof.rotation.x = -Math.PI / 2 + 0.18; roof.castShadow = true; root.add(roof);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.07, sz < 0 ? 2.2 : 1.9, 0.07, sx * (L / 2 + 0.3), sz < 0 ? 1.1 : 0.95, sz * 0.75, woodD);
  // табличка команды
  const sign = box(0.9, 0.28, 0.03, 0, 1.55, -0.2, new THREE.MeshStandardMaterial({ color: team === 'denter' ? 0x7a2a20 : 0x2a3e5c, roughness: 0.7 }));
  void sign;
  // ящики с патронами и гранатами справа
  box(1.0, 0.42, 0.55, L / 2 + 1.0, 0.21, 0.2, green, 0.1);
  box(0.8, 0.36, 0.5, L / 2 + 1.0, 0.6, 0.15, green, -0.05);
  box(0.62, 0.3, 0.42, L / 2 + 1.9, 0.15, 0.1, wood, 0.3);
  W.addBoxCollider({ x, z, y0, w: L + 0.2, d: 0.7, h: 1.5, yaw, mat: 'wood', pen: 4, cover: true });
  const toWorld = (lx, ly, lz) => new THREE.Vector3(lx, ly, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(new THREE.Vector3(x, y0, z));
  const ok = () => { const p = m.player; return p.body.alive && p.body.team === team && !p.carry && !p.gun && !p.vehicle; };
  const loads = () => (m.app && m.app.save && m.app.save.loads) || null;
  // образцы оружия: стоят прикладом вниз, стволом вверх, с лёгким наклоном к брусу
  all.forEach((id, i) => {
    const lx = -L / 2 + 0.5 + i * 0.42;
    const gun = thirdPersonGun(TP_KIND[id] || 'ak74');
    const o = gun.object;
    o.rotation.set(Math.PI / 2 - 0.12, 0, 0);
    o.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(o);
    o.position.set(lx, 0.1 - bb.min.y, 0.1 - (bb.min.z + bb.max.z) / 2 + 0.02);
    o.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    root.add(o);
    const heavy = HEAVY.includes(id);
    const def = WEAPONS[id];
    m.interactables.push({
      pos: toWorld(lx, 1.0, 0.35), r: 0.5, hold: 0.45,
      get label() { const p = m.player, cur = heavy ? p.slots[1] : p.slots[0]; return cur && cur.id === id ? `${def.name} — у вас (E — пополнить)` : `Взять ${def.name} вместо ${cur ? cur.def.name : 'пустого слота'}`; },
      enabled: ok,
      action: () => {
        const p = m.player, k = heavy ? 1 : 0;
        p.slots[k] = makeState(id, loads());
        p.cur = k; p.switchT = 0.8; p.reloadT = 0; p.uglMode = false; p.aim = false;
        m.audio.mech('reload');
        m.hud.message(`Взято: ${def.name}${def.desc ? ' — ' + def.desc : ''}`, 3.5);
      },
    });
  });
  // боеприпасы и гранаты; сдать тяжёлое оружие
  m.interactables.push({ pos: toWorld(L / 2 + 1.0, 0.7, 0.4), r: 1.0, hold: 0.5, label: 'Пополнить боекомплект и гранаты', enabled: ok, action: () => { m.player.resupply(); m.audio.mech('reload'); } });
  m.interactables.push({
    pos: toWorld(L / 2 + 1.9, 0.5, 0.35), r: 0.7, hold: 0.5,
    get label() { const s = m.player.slots[1]; return s ? `Сдать ${s.def.name} (быстрее бег)` : 'Тяжёлого оружия нет'; },
    enabled: () => ok() && !!m.player.slots[1],
    action: () => { const p = m.player; p.slots[1] = null; if (p.cur === 1) { p.cur = 0; p.switchT = 0.5; } m.hud.message('Тяжёлое оружие сдано', 2); m.audio.mech('switch'); },
  });
  return root;
}
