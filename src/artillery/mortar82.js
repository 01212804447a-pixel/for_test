// 82-мм миномёт 2Б14-1 «Поднос»: мины О-832ДУ (осколочная) и Д-832ДУ (дымовая),
// основной заряд и пять дополнительных; стрельба только навесная — возвышение 45–85°.
// Таблица считается той же моделью полёта, что и мина в игре, на нисходящей ветви:
// чем больше возвышение, тем ближе разрыв.
import { makeEnv, prepareAmmo } from '../physics/ballistics.js';
import { AMMO, WEAPONS } from '../data/weapons.js';
import { MIL, NORMAL_ENV, fly } from './d30.js';

export const EL82_MIN = 750, EL82_MAX = 1417; // 45° … 85°

// основной заряд + 1…5 дополнительных (пучки пороха между перьями стабилизатора)
export const CHARGES82 = [
  { id: '0', name: 'основной', short: 'ОСН', v0: 70 },
  { id: '1', name: 'первый', short: '1-й', v0: 105 },
  { id: '2', name: 'второй', short: '2-й', v0: 137 },
  { id: '3', name: 'третий', short: '3-й', v0: 165 },
  { id: '4', name: 'четвёртый', short: '4-й', v0: 192 },
  { id: '5', name: 'пятый', short: '5-й', v0: 218 },
];

// О-832ДУ: 3,1 кг, ВВ 0,4 кг, сплошное поражение ~6 м, осколки до 25 м
// Д-832ДУ: 3,6 кг, завеса ≈ 1 мин
for (const c of CHARGES82) {
  AMMO['o832_' + c.id] = prepareAmmo({
    id: 'o832_' + c.id, name: `О-832ДУ, заряд ${c.name}`, short: 'О-832ДУ', kind: 'shell',
    model: 'G1', bc: 2.5, mass: 3.1, caliber: 0.082, v0: c.v0, spin: null, v0sd: 0.004, maxT: 90, armDist: 20,
    explosive: { pen: 14, radius: 6, frag: 26, dmg: 260, fxSize: 1.9 },
  });
  AMMO['d832_' + c.id] = prepareAmmo({
    id: 'd832_' + c.id, name: `Д-832ДУ (дымовая), заряд ${c.name}`, short: 'Д-832ДУ', kind: 'shell',
    model: 'G1', bc: 2.5, mass: 3.1, caliber: 0.082, v0: c.v0, spin: null, v0sd: 0.004, maxT: 90, armDist: 20,
    explosive: { pen: 0, radius: 1.5, frag: 0, dmg: 10, fxSize: 0.7, smoke: { dur: 60, size: 1.5 } },
  });
}
WEAPONS.mortar82 = {
  id: 'mortar82', name: '2Б14-1 «Поднос»', cls: '82-мм миномёт', ammo: 'o832_3', mag: 1, mags: 60,
  rpm: 15, modes: ['single'], disp: 0.4, sound: 'mortar', artillery: true,
};

const tables = new Map();
export function primeMortarTable(ci, T) {
  if (tables.has(ci)) return;
  tables.set(ci, { ...T, ammo: prepareAmmo({ ...AMMO['o832_' + CHARGES82[ci].id] }) });
}

export function mortarTable(ci) {
  if (tables.has(ci)) return tables.get(ci);
  const ch = CHARGES82[ci];
  const ammo = prepareAmmo({ ...AMMO['o832_' + ch.id] });
  const env = NORMAL_ENV;
  const at = (m) => fly(ammo, env, m * MIL, { dt: 1 / 60 }).x;
  const xMax = at(EL82_MIN), xMin = at(EL82_MAX);
  // возвышение для дальности: на 45–85° дальность монотонно убывает с ростом угла
  const solve = (D) => {
    let lo = EL82_MIN, hi = EL82_MAX;
    for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (at(mid) > D) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  };
  const step = xMax > 2000 ? 100 : 50;
  const rows = [];
  for (let D = Math.ceil(xMin / step) * step; D <= xMax; D += step) {
    const m = solve(D), a = m * MIL;
    const r = fly(ammo, env, a), r1 = fly(ammo, env, a + MIL);
    const rCold = fly(ammo, makeEnv({ tempC: -25, pressureHPa: 1000, coriolis: false }), a);
    const rHead = fly(ammo, env, a, { windX: -10 });
    const rCross = fly(ammo, env, a, { windZ: 10 });
    rows.push({
      D, sight: m, dXmil: r1.x - r.x, t: r.t, top: r.top, fall: r.fall / MIL, drift: 0,
      dXt: (rCold.x - r.x) / 4, dXw: rHead.x - r.x, dZw: (rCross.z - r.z) / D / MIL,
    });
  }
  const T = { charge: ch, ci, rows, maxRange: xMax, minRange: xMin, maxSight: EL82_MIN, ammo };
  tables.set(ci, T);
  return T;
}
