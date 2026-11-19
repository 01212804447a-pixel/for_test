// Штабели боеприпасов: снаряды, гильзы с зарядами и мины можно вынести из ящика (или взять у
// орудия) и сложить где угодно — рядом положенные складываются в один штабель. Из штабеля
// можно снова взять и зарядить орудие. Попадание (пули, осколки, соседний взрыв) подрывает
// штабель целиком, и сила взрыва растёт с количеством: радиус фугасного действия — как
// кубический корень из массы ВВ (закон подобия Хопкинсона — Кранца), осколков — больше и дальше;
// пороховые заряды не детонируют, а сгорают вспышкой и поджигают всё вокруг.
// В сети: укладка и взятие — события 'ap' всем; подрыв — через разрушаемые объекты хоста.
import * as THREE from 'three';
import { crewItems } from './crew.js';

const POOL = 16;
// масса ВВ на единицу, кг ТНТ-эквивалента
const TNT = { shell: 3.67, charge: 0.45, mine: 0.4 };
const NAME = { shell: 'снаряд', charge: 'заряд', mine: 'мина' };
const SHELL_NAME = { of: 'ОФ-462', d: 'Д-462', s: 'С-463', bk: 'БК-6М', bm: '«лом»' };

// Взрыв N боеприпасов разом: { shells, charges, mines } → параметры взрыва
export function massBlastParams({ shells = 0, charges = 0, mines = 0 }) {
  const W = shells * TNT.shell + charges * TNT.charge + mines * TNT.mine;
  if (W <= 0) return null;
  const k = Math.cbrt(W / TNT.shell);                   // относительно одного 122-мм снаряда
  const fragN = shells + mines * 0.25;                   // осколочные корпуса
  return {
    W, k,
    ex: {
      radius: 12 * k, dmg: 420 * k, pen: 60 * Math.min(4, k),
      frag: fragN > 0 ? 48 * Math.pow(Math.max(fragN, 0.25), 0.22) : 6 * k,
      fxSize: Math.min(6, 2.2 + k * 1.2),
    },
  };
}

// Подрыв (картинка у всех, урон — у хоста/одиночной игры)
export function massBlast(m, P, counts, by = null) {
  const B = massBlastParams(counts);
  if (!B) return;
  const { ex, k } = B;
  const n = (counts.shells || 0) + (counts.mines || 0);
  m.fx.shellBurst(P);
  m.audio.explosion(P, Math.min(4, 1.2 + k));
  // детонация по цепочке: отдельные разрывы вокруг, чем больше боеприпасов — тем больше и шире
  const bursts = Math.min(9, Math.ceil(n / 3));
  for (let i = 1; i <= bursts; i++) m.after(0.08 * i + Math.random() * 0.15, () => {
    const s = 2 + k * 1.6;
    const Q = P.clone().add(new THREE.Vector3((Math.random() - 0.5) * s, 0, (Math.random() - 0.5) * s));
    Q.y = m.terrain.heightAt(Q.x, Q.z) + 0.3;
    if (k > 1.4) m.fx.shellBurst(Q); else m.fx.explosion(Q, 1.4 + k, true);
    m.audio.explosion(Q, Math.min(3, 0.8 + k * 0.6));
  });
  if (counts.charges > 0) m.fx.addFire(P.clone(), Math.min(3.5, 0.8 + counts.charges * 0.08), 60 + counts.charges * 3);
  m.fx.addDecal(new THREE.Vector3(P.x, m.terrain.heightAt(P.x, P.z), P.z), new THREE.Vector3(0, 1, 0), Math.min(22, 3 + ex.radius * 0.45), 0x141210);
  m.noise(P, 1500 + ex.radius * 60, null, by || null);
  m.player.shake = Math.max(m.player.shake, Math.min(3, k * 1.2) * Math.max(0, 1 - P.distanceTo(m.camPos) / (60 + ex.radius * 8)));
  if (!m.netVisual) m.projectiles.explode(P, ex, by, null, null, { fx: false });
}

export class AmmoPiles {
  constructor(m) {
    this.m = m;
    this.pool = [];
    // заранее — одинаковые номера разрушаемых объектов у всех игроков
    for (let i = 0; i < POOL; i++) {
      const g = new THREE.Group(); g.visible = false; m.scene.add(g);
      const d = { kind: 'pile', hp: 4, maxHp: 4, mesh: g, pos: new THREE.Vector3(), alive: true, r: 0.7, stowed: true, collider: null, items: [], idx: i, pile: true };
      m.world.destructibles.push(d);
      this.pool.push(d);
    }
    this.takeIt = {
      pos: new THREE.Vector3(0, -999, 0), r: 1.5, hold: 0.4,
      get label() { const d = this.d; return d ? `Взять из штабеля: ${AmmoPiles.describe(d)}` : ''; },
      enabled: () => { const p = m.player; this.takeIt.d = this.near(); return !!this.takeIt.d && p.body.alive && !p.carry && !p.gun && !p.vehicle; },
      action: () => this.take(this.takeIt.d),
    };
    m.interactables.push(this.takeIt);
  }

  static describe(d) {
    const c = { shell: 0, charge: 0, mine: 0 };
    for (const it of d.items) c[it.item]++;
    const parts = [];
    if (c.shell) parts.push(`снарядов ${c.shell}`);
    if (c.charge) parts.push(`зарядов ${c.charge}`);
    if (c.mine) parts.push(`мин ${c.mine}`);
    return parts.join(', ');
  }

  counts(d) {
    const c = { shells: 0, charges: 0, mines: 0 };
    for (const it of d.items) c[it.item === 'shell' ? 'shells' : it.item === 'charge' ? 'charges' : 'mines']++;
    return c;
  }

  near() {
    const b = this.m.player.body;
    let best = null, bd = 1.9;
    for (const d of this.pool) {
      if (d.stowed || !d.alive || !d.items.length) continue;
      const dd = Math.hypot(d.pos.x - b.pos.x, d.pos.z - b.pos.z);
      if (dd < bd) { bd = dd; best = d; }
    }
    if (best) this.takeIt.pos.set(best.pos.x, best.pos.y + 0.4, best.pos.z);
    return best;
  }

  // положить предмет на землю (x, z): рядом лежащий штабель растёт
  drop(x, z, item, shell = 'of', fromNet = false) {
    const m = this.m;
    let d = this.pool.find((q) => !q.stowed && q.alive && q.items.length && Math.hypot(q.pos.x - x, q.pos.z - z) < 1.6);
    if (!d) {
      d = this.pool.find((q) => q.stowed && q.alive);
      if (!d) { if (!fromNet) m.hud.message('Слишком много штабелей — сложите к уже лежащим', 2.5); return null; }
      const y = m.terrain.heightAt(x, z);
      d.pos.set(x, y + 0.2, z); d.yaw = m.player.yaw || 0; d.stowed = false; d.items = []; d.hp = d.maxHp;
    }
    d.items.push({ item, shell });
    this._rebuild(d);
    if (!fromNet) {
      m.audio.mech('reload');
      m.hud.message(`Положено: ${NAME[item]}${item === 'shell' ? ' ' + (SHELL_NAME[shell] || '') : ''}. В штабеле: ${AmmoPiles.describe(d)}`, 2.5);
      if (m.net) m.net.ev(['ap', 'd', +x.toFixed(2), +z.toFixed(2), item, shell]);
    }
    return d;
  }

  take(d, fromNet = false) {
    const m = this.m;
    if (!d || !d.items.length) return;
    // сначала снаряд, затем гильзу (порядок заряжания)
    let i = d.items.map((q) => q.item).lastIndexOf('shell');
    if (i < 0) i = d.items.length - 1;
    const it = d.items.splice(i, 1)[0];
    this._rebuild(d);
    if (!d.items.length) this._clear(d);
    if (fromNet) return;
    const p = m.player;
    p.carry = { item: it.item, gun: null, free: true, shell: it.shell, speed: it.item === 'mine' ? 2.6 : null, onDrop: () => this.dropCarry() };
    m.audio.mech('reload');
    m.hud.message(`${NAME[it.item][0].toUpperCase() + NAME[it.item].slice(1)} в руках: к орудию (E — зарядить) или G — положить`, 3);
    if (m.net) m.net.ev(['ap', 't', d.idx]);
  }

  // положить то, что несёт игрок, перед собой
  dropCarry() {
    const m = this.m, p = m.player, c = p.carry;
    if (!c || !['shell', 'charge', 'mine'].includes(c.item)) return false;
    const b = p.body, x = b.pos.x - Math.sin(p.yaw) * 0.8, z = b.pos.z - Math.cos(p.yaw) * 0.8;
    const d = this.drop(x, z, c.item, c.shell || (c.gun && c.gun.load ? c.gun.load.shell : 'of'));
    if (!d) return false;
    p.carry = null;
    return true;
  }

  _clear(d) {
    d.stowed = true; d.items = []; d.mesh.visible = false;
    if (d.collider) { this.m.world.removeObstacle(d.collider); d.collider = null; }
  }

  // аккуратная укладка: снаряды рядами на подкладках, гильзы рядом, мины — в стороне
  _rebuild(d) {
    const m = this.m, g = d.mesh, I = crewItems();
    while (g.children.length) g.remove(g.children[0]);
    const by = { shell: [], charge: [], mine: [] };
    for (const it of d.items) by[it.item].push(it);
    const put = (proto, i, perRow, dx, dy, x0, zOff, rotY = Math.PI / 2) => {
      if (i >= 40) return;
      const row = i % perRow, layer = Math.floor(i / perRow);
      const o = proto.clone(); o.rotation.y = rotY;
      o.position.set(x0 + row * dx + (layer % 2) * dx * 0.5, 0.07 + layer * dy, zOff);
      g.add(o);
    };
    by.shell.forEach((_, i) => put(I.shell, i, 4, 0.13, 0.12, -0.2, 0));
    by.charge.forEach((_, i) => put(I.charge, i, 4, 0.135, 0.13, -0.2, 0.72));
    by.mine.forEach((_, i) => put(I.mine, i, 5, 0.09, 0.085, -0.2, by.shell.length ? -0.55 : 0));
    // подкладки-брусья
    if (!this._wood) this._wood = new THREE.MeshStandardMaterial({ color: 0x5b4a2e, roughness: 0.9 });
    for (const zz of [-0.18, 0.18, 0.55, 0.9]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.05, 0.06), this._wood); b.position.set(0, 0.025, zz); g.add(b); }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const y = m.terrain.heightAt(d.pos.x, d.pos.z);
    g.position.set(d.pos.x, y, d.pos.z); g.rotation.y = d.yaw || 0; g.visible = d.items.length > 0;
    // попадание: пуля по штабелю (мало «жизни» — подрыв от нескольких попаданий или осколков)
    if (d.collider) m.world.removeObstacle(d.collider);
    const n = d.items.length;
    d.collider = n ? m.world.addBoxCollider({ x: d.pos.x, z: d.pos.z, y0: y, w: 1.0, d: 1.4, h: 0.2 + Math.min(0.6, Math.ceil(n / 8) * 0.13), yaw: d.yaw || 0, mat: 'metal', pen: 6, owner: d, cover: true, blocksMove: false }) : null;
    d.r = 0.8;
  }

  // штабель подорван
  explode(d, by) {
    const m = this.m;
    const c = this.counts(d), P = d.pos.clone().setY(m.terrain.heightAt(d.pos.x, d.pos.z) + 0.3);
    this._clear(d);
    if (c.shells + c.charges + c.mines === 0) return;
    massBlast(m, P, c, by);
    const n = c.shells + c.charges + c.mines;
    m.hud.message(`Подрыв штабеля: ${n} шт. (≈ ${Math.round(massBlastParams(c).W)} кг ТНТ)`, 4, true);
  }

  netOp(e) {
    if (e[1] === 'd') this.drop(e[2], e[3], e[4], e[5], true);
    else if (e[1] === 't') this.take(this.pool[e[2]], true);
  }
}
