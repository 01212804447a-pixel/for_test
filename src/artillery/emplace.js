// Переносимое оружие (миномёт, КПВ на станке): переместить на новое место, погрузить в машину,
// выгрузить из машины и поставить куда нужно. Пока игрок «несёт/катит» оружие, оно стоит перед
// ним (видно, куда встанет); E — поставить, G — поставить здесь же; рядом с машиной — погрузить.
// В сети: начало переноса прячет оружие у остальных, установка — сообщает место.
import * as THREE from 'three';

const CAP = { tigr: 1, niva: 1, mtlb: 2 };                 // сколько такого оружия влезает
const NIVA_OK = { mortar: true, kpv: false };              // в «Ниву» КПВ на станке не влезает

export function canCarry(v, kind) { return v.alive && (v.cargo || []).length < (CAP[v.typeId] || 1) && (v.typeId !== 'niva' || NIVA_OK[kind]); }

function rearOf(v, out = new THREE.Vector3()) {
  const T = v.type, d = T.len / 2 + 0.9;
  return out.set(v.pos.x + Math.sin(v.yaw) * d, v.pos.y + 0.9, v.pos.z + Math.cos(v.yaw) * d);
}

export function setupEmplace(E, m, { kind, name, speed = 2.0, front = 1.7 }) {
  E.emKind = kind; E.moving = false; E.stowedIn = null; E.mover = null;
  const P = () => m.player;
  const freeHands = () => { const p = P(); return p.body.alive && !p.carry && !p.gun && !p.vehicle; };
  const canHold = (v) => canCarry(v, kind);
  const nearVeh = () => {
    const p = P().body; let best = null, bd = 4.2;
    for (const v of m.vehicles) { if (!canHold(v)) continue; const d = rearOf(v).distanceTo(p.pos.clone().setY(p.pos.y + 0.9)); if (d < bd) { bd = d; best = v; } }
    return best;
  };
  E.moveIt = {
    pos: new THREE.Vector3(), r: 1.7, hold: 0.8,
    get label() { return `Переместить ${name} (E — поставить, рядом с машиной — погрузить)`; },
    enabled: () => freeHands() && !E.moving && !E.stowedIn && !E.netUser && !E.busy(),
    action: () => E.startMove(P()),
  };
  // пока несёте: E — поставить здесь; рядом с машиной — погрузить в неё
  E.stowIt = {
    pos: new THREE.Vector3(), r: 3.0, hold: 0.5,
    get label() { const v = nearVeh(); return v ? `Погрузить ${name} в ${v.type.name}` : `Поставить ${name} здесь`; },
    enabled: () => E.moving && E.mover === P(),
    action: () => { const v = nearVeh(); if (v) E.stow(v); else E.tryPlace(); },
  };
  E.unloadIt = {
    pos: new THREE.Vector3(), r: 3.0, hold: 0.8,
    get label() { return E.stowedIn ? `Выгрузить ${name} из ${E.stowedIn.type.name}` : ''; },
    enabled: () => !!E.stowedIn && freeHands() && E.stowedIn.alive,
    action: () => E.unload(P()),
  };
  m.interactables.push(E.moveIt, E.stowIt, E.unloadIt);

  E._emNet = (e) => { const n = m.net; if (n) n.ev(['gm', m.guns.indexOf(E), ...e]); };

  E.startMove = (p, fromNet = false) => {
    E.moving = true; E.mover = p || null;
    E._onPick();
    if (p) p.carry = { item: 'emplace', obj: E, speed, onDrop: () => E.tryPlace() };
    if (!fromNet) { m.hud.message(`${name}: несёте. E — поставить здесь, рядом с машиной — погрузить, G — поставить сразу`, 4); m.audio.mech('switch'); E._emNet(['em']); }
  };
  // поставить там, где стоит «призрак» перед игроком
  E.tryPlace = () => {
    const T = m.terrain, x = E.pos.x, z = E.pos.z;
    const n = T.normalAt(x, z);
    let bad = n.y < 0.86 || T.maskAt(x, z) === 2 || (T.hasSea && T.heightAt(x, z) < 0.5);
    if (!bad) m.world._cellsAround(x, z, 0.9, (o) => { if (!bad && o.blocksMove && o.y1 > T.heightAt(x, z) + 0.25 && m.world.pointObstacleDist(o, x, z) < 0.7) bad = true; });
    if (bad) { m.hud.message('Здесь не поставить: круто, лёд или мешает препятствие', 2); return false; }
    E.placeAt(x, z, E.yawM, false);
    return true;
  };
  E.placeAt = (x, z, yaw, fromNet = false) => {
    const p = E.mover;
    E.moving = false; E.mover = null; E.stowedIn = null;
    if (p && p.carry && p.carry.obj === E) p.carry = null;
    E.pos.set(x, m.terrain.heightAt(x, z), z);
    E._onPlace(yaw);
    if (!fromNet) { E._emNet(['ep', +x.toFixed(2), +z.toFixed(2), +yaw.toFixed(3)]); m.audio.mech('reload'); m.hud.message(`${name} установлен`, 2); }
  };
  E.stow = (v, fromNet = false) => {
    const p = E.mover;
    E.moving = false; E.mover = null; E.stowedIn = v;
    (v.cargo || (v.cargo = [])).push(E);
    if (p && p.carry && p.carry.obj === E) p.carry = null;
    E._onStow();
    if (!fromNet) { E._emNet(['es', m.vehicles.indexOf(v)]); m.audio.mech('switch'); m.hud.message(`${name} погружен в ${v.type.name}`, 2.5); }
  };
  E.unload = (p, fromNet = false) => {
    const v = E.stowedIn;
    if (v && v.cargo) v.cargo = v.cargo.filter((c) => c !== E);
    E.stowedIn = null;
    E.startMove(p, fromNet);
    if (!fromNet) E._emNet(['eu']);
  };
  E.emNetOp = (e) => {
    const op = e[2];
    if (op === 'em') { E.startMove(null, true); return true; }
    if (op === 'ep') { E.placeAt(e[3], e[4], e[5], true); return true; }
    if (op === 'es') { const v = m.vehicles[e[3]]; if (v) E.stow(v, true); return true; }
    if (op === 'eu') { const v = E.stowedIn; if (v && v.cargo) v.cargo = v.cargo.filter((c) => c !== E); E.stowedIn = null; E.startMove(null, true); return true; }
    return false;
  };
  // каждый кадр: перед несущим, в машине — вместе с машиной, точки взаимодействия
  E.emUpdate = () => {
    const p = P();
    // несущий бросил (погиб, сел в машину, груз сброшен) — оружие остаётся, где стояло
    if (E.moving && E.mover && !(E.mover.carry && E.mover.carry.obj === E)) E.placeAt(E.pos.x, E.pos.z, E.yawM);
    if (E.moving && E.mover) {
      const b = E.mover.body || E.mover;
      const yaw = E.mover.yaw ?? b.yaw;
      const x = b.pos.x - Math.sin(yaw) * front, z = b.pos.z - Math.cos(yaw) * front;
      E.pos.set(x, m.terrain.heightAt(x, z), z); E.yawM = yaw;
    }
    if (E.stowedIn) {
      const v = E.stowedIn;
      E.pos.copy(v.pos);
      // машину подбили — оружие вываливается рядом с остовом
      if (!v.alive) { v.cargo = (v.cargo || []).filter((c) => c !== E); const r = rearOf(v); E.placeAt(r.x + 1.5, r.z + 1.5, v.yaw, true); }
      else rearOf(v, E.unloadIt.pos);
    }
    E.moveIt.pos.copy(E.pos).setY(E.pos.y + 0.8);
    E.stowIt.pos.copy(p.body.pos).setY(p.body.pos.y + 0.9);
  };
  E.yawM = 0;
}
