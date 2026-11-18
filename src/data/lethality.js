// Поражающее действие боеприпасов — расчёт по той же модели урона, что в бою
// (Projectiles.explode и _hitSoldier, Soldier.damage): фугасное действие, осколки с учётом
// бронежилета и шлема, энергия и пробитие пуль на дальности.
import { AMMO, WEAPONS, ammoChoices } from './weapons.js';
import '../artillery/d30.js';
import { prepareAmmo, stepProjectile } from '../physics/ballistics.js';
import { ZERO_ENV } from '../physics/firingTable.js';

const ZM = { head: 3.2, torso: 1, pelvis: 0.9, leg: 0.55, arm: 0.45 };
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Вероятность вывести бойца из строя сразу (здоровье ≤ 0) на горизонтальной дальности r от разрыва
// на грунте; боец стоит (грудь на 1,26 м) или лежит (0,3 м)
function killProb(ex, r, { armor, helmet, prone = false, n = 1500, seed = 1 }) {
  const R = rng(seed + Math.round(r * 100));
  const d = Math.hypot(r, prone ? 0.3 : 1.26);
  if (d > ex.frag) return { kill: 0, hurt: 0, inc: 0 };
  let kills = 0, hurt = 0, inc = 0;
  for (let i = 0; i < n; i++) {
    let hp = 100, any = false;
    if (d < ex.radius) { hp -= ex.dmg * Math.pow(1 - d / ex.radius, 1.3); any = true; }
    const expected = 4 * Math.pow(1 - d / ex.frag, 2) * (prone ? 0.45 : 1);
    for (let k = 0; k < 6 && hp > 0; k++) {
      if (R() < expected / 6) {
        const z = R();
        const zone = z < 0.08 ? 'head' : z < 0.5 ? 'torso' : z < 0.75 ? 'leg' : 'arm';
        let fd = 14 + R() * 16;
        if (zone === 'torso') fd *= 1 - armor * 0.65;
        if (zone === 'head') fd *= 1 - helmet * 0.6;
        hp -= fd * ZM[zone]; any = true;
      }
    }
    if (hp <= 0) kills++;
    if (hp <= 30) inc++;
    if (any) hurt++;
  }
  return { kill: kills / n, hurt: hurt / n, inc: inc / n };
}

// Радиусы: сплошного (≥ 99 %) и 50 % поражения, ранения (≥ 50 %), предельный разлёт осколков
export function blastRadii(ex, prot) {
  let r100 = 0, r50 = 0, rHurt = 0, rInc = 0;
  let solid = true;
  for (let r = 0; r <= ex.frag + 0.01; r += 0.25) {
    const p = killProb(ex, r, prot);
    if (solid && p.kill >= 0.99) r100 = r; else solid = false;
    if (p.kill >= 0.5) r50 = r;
    if (p.inc >= 0.5) rInc = r;
    if (p.hurt >= 0.5) rHurt = r;
  }
  return { r100, r50, rInc, rHurt, rMax: Math.sqrt(Math.max(0, ex.frag * ex.frag - 1.26 * 1.26)) };
}

export const EXPLOSIVES = [
  { id: 'rgd5', name: 'РГД-5', kind: 'ручная наступательная', ammo: 'rgd5' },
  { id: 'f1', name: 'Ф-1', kind: 'ручная оборонительная', ammo: 'f1' },
  { id: 'vog25', name: 'ВОГ-25', kind: '40-мм выстрел ГП-25', ammo: 'vog25' },
  { id: 'pg7vm', name: 'ПГ-7ВМ', kind: 'кумулятивная граната РПГ-7', ammo: 'pg7vm' },
  { id: 'of462o', name: 'ОФ-462, взрыватель «О»', kind: '122-мм снаряд Д-30, осколочное действие', ammo: 'of462_full' },
  { id: 'of462f', name: 'ОФ-462, взрыватель «Ф»', kind: '122-мм снаряд Д-30, фугасное (замедление)', ammo: 'of462_full', ex: { pen: 140, radius: 9, frag: 20, dmg: 520 } },
];

const NEGS = { armor: 0.8, helmet: 0.6 }, DENTER = { armor: 0.45, helmet: 0.3 }, NONE = { armor: 0, helmet: 0 };

let cache = null;
export function lethalityTable() {
  if (cache) return cache;
  const ex = EXPLOSIVES.map((e) => {
    const X = e.ex || AMMO[e.ammo].explosive;
    return { ...e, X, mass: AMMO[e.ammo].mass, none: blastRadii(X, NONE), negs: blastRadii(X, NEGS), prone: blastRadii(X, { ...NEGS, prone: true }) };
  });
  // пули: энергия на дальности, урон при попадании в корпус, пробитие бронеплит
  const bullets = [];
  const seen = new Set();
  for (const wid of ['ak74m', 'akm', 'svd', 'pkm']) {
    const w = WEAPONS[wid];
    for (const aid of ammoChoices(wid)) {
      if (seen.has(aid) || !AMMO[aid] || AMMO[aid].kind !== 'bullet') continue;
      seen.add(aid);
      const a = prepareAmmo({ ...AMMO[aid] });
      const at = speedsAt(a, [0, 100, 300, 500, 800]);
      const row = { id: aid, name: a.name, short: a.short || a.name, w: w.name, v0: a.v0 };
      row.E = at.map((v) => 0.5 * a.mass * v * v);
      row.torso = row.E.map((E) => 60 * Math.pow(E / 1000, 0.6) * (a.dmgK || 1) * 1.5);
      row.hits = row.torso.map((d) => Math.max(1, Math.ceil(100 / d)));
      // пробитие плиты: способность a.pen·(v/v0)² против класса защиты
      const penAt = (v) => a.pen * (v / a.v0) * (v / a.v0);
      row.plateNegs = rangeWhile(a, (v) => penAt(v) > NEGS.armor * 10);
      row.plateDenter = rangeWhile(a, (v) => penAt(v) > DENTER.armor * 8);
      bullets.push(row);
    }
  }
  cache = { ex, bullets };
  return cache;
}

function flatSim(a, onStep) {
  const s = { p: { x: 0, y: 0, z: 0 }, v: { x: a.v0, y: 0, z: 0 }, t: 0, rx: 0, rz: 1 };
  const env = { ...ZERO_ENV, Oy: 0, Oz: 0, wind: { x: 0, y: 0, z: 0 } };
  while (s.t < 4 && s.p.x < 1500) {
    stepProjectile(s, a, env, 1 / 400);
    s.p.y = 0; // интересует только скорость по дальности
    if (onStep(s)) break;
  }
}
function speedsAt(a, ranges) {
  const out = [];
  let i = 0;
  if (ranges[0] === 0) { out.push(a.v0); i = 1; }
  flatSim(a, (s) => { while (i < ranges.length && s.p.x >= ranges[i]) { out.push(Math.hypot(s.v.x, s.v.y)); i++; } return i >= ranges.length; });
  while (out.length < ranges.length) out.push(0);
  return out;
}
function rangeWhile(a, ok) {
  if (!ok(a.v0)) return 0;
  let last = 0;
  flatSim(a, (s) => { const v = Math.hypot(s.v.x, s.v.y); if (!ok(v)) return true; last = s.p.x; return false; });
  return last >= 1499 ? 1500 : Math.round(last / 10) * 10;
}
