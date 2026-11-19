// 122-мм гаубица Д-30 (2А18): заряды, снаряд ОФ-462, расчёт таблицы стрельбы.
// Таблица считается той же моделью полёта, что и снаряд в игре (точечная масса, закон
// сопротивления G1, деривация), для нормальных условий: +15 °C, 750 мм рт. ст., без ветра.
import { makeEnv, prepareAmmo, stepProjectile } from '../physics/ballistics.js';
import { AMMO, WEAPONS } from '../data/weapons.js';

// 1 деление угломера (тысячная) = 1/6000 окружности
export const MIL = (Math.PI * 2) / 6000;

// Переменный заряд Ж-463: полный, уменьшенный и четыре номерных
export const CHARGES = [
  { id: 'full', name: 'полный', short: 'ПОЛН', v0: 690 },
  { id: 'red', name: 'уменьшенный', short: 'УМ', v0: 565 },
  { id: '1', name: 'первый', short: '1-й', v0: 498 },
  { id: '2', name: 'второй', short: '2-й', v0: 428 },
  { id: '3', name: 'третий', short: '3-й', v0: 366 },
  { id: '4', name: 'четвёртый', short: '4-й', v0: 276 },
];

// Снаряд ОФ-462: 21,76 кг, калибр 121,9 мм, ВВ 3,67 кг ТНТ
for (const c of CHARGES) {
  AMMO['of462_' + c.id] = prepareAmmo({
    id: 'of462_' + c.id, name: `ОФ-462, заряд ${c.name}`, short: 'ОФ-462', kind: 'shell',
    model: 'G1', bc: 4.2, mass: 21.76, caliber: 0.1219, v0: c.v0,
    spin: { sg: 1.6, dir: 1 }, v0sd: 0.0022, maxT: 120, armDist: 60,
    explosive: { pen: 60, radius: 12, frag: 48, dmg: 420, fxSize: 3.4 },
  });
}
// Дымовой снаряд Д-462: та же баллистика (таблица общая), разрыв — дымовая завеса ≈ 1,5 мин
for (const c of CHARGES) {
  AMMO['d462_' + c.id] = prepareAmmo({
    ...AMMO['of462_' + c.id], id: 'd462_' + c.id, name: `Д-462 (дымовой), заряд ${c.name}`, short: 'Д-462',
    explosive: { pen: 0, radius: 2, frag: 0, dmg: 20, fxSize: 1.2, smoke: { dur: 90, size: 2.2 } },
  });
}
// Осветительный С-463: та же баллистика, дистанционная трубка Т-7 — расчёт ставит её по таблице
// на разрыв ≈ 450 м над целью; факел на парашюте горит ≈ 50 с, снижается ≈ 5 м/с
for (const c of CHARGES) {
  AMMO['s463_' + c.id] = prepareAmmo({
    ...AMMO['of462_' + c.id], id: 's463_' + c.id, name: `С-463 (осветительный), заряд ${c.name}`, short: 'С-463',
    illum: { h: 450, dur: 50, fall: 5 }, explosive: null,
  });
}
// Кумулятивный БК-6М: 21,6 кг, специальный заряд, V₀ 740 м/с, бронепробиваемость ≈ 460 мм
// по нормали на любой дальности (кумулятивной струе скорость не важна); прямой наводкой до 2 км
AMMO.bk6m = prepareAmmo({
  id: 'bk6m', name: 'БК-6М (кумулятивный), заряд специальный', short: 'БК-6М', kind: 'shell',
  model: 'G1', bc: 3.1, mass: 21.63, caliber: 0.1219, v0: 740,
  spin: { sg: 1.6, dir: 1 }, v0sd: 0.0015, maxT: 30, armDist: 25,
  explosive: { pen: 460, radius: 5, frag: 22, dmg: 300, fxSize: 2.2 },
});
// «Лом» — подкалиберный бронебойный (БПС) с отделяющимся поддоном. Для Д-30 штатного БПС нет:
// это игровое допущение по образцу 125-мм «ломов», с поправкой на низкое давление гаубицы:
// стреловидный сердечник 4,6 кг, V₀ 1050 м/с, ≈ 340 мм у дула, падает со скоростью
AMMO.bm122 = prepareAmmo({
  id: 'bm122', name: '«Лом» — БПС (условный), заряд специальный', short: '«Лом»', kind: 'shell',
  model: 'G7', bc: 1.6, mass: 4.6, caliber: 0.032, v0: 1050,
  spin: { sg: 1.2, dir: 1 }, v0sd: 0.001, maxT: 12, pen: 340, apfsds: true, tracer: true, tracerColor: [1, 0.55, 0.2],
});
// снаряды Д-30: порядок переключения (Z)
export const SHELLS = {
  of: { name: 'ОФ-462', long: 'осколочно-фугасный', short: 'оск.', id: (c) => 'of462_' + c },
  d: { name: 'Д-462', long: 'дымовой (завеса ≈ 1,5 мин)', short: 'дым.', id: (c) => 'd462_' + c },
  s: { name: 'С-463', long: 'осветительный (факел на парашюте ≈ 50 с, разрыв ≈ 450 м над целью)', short: 'осв.', id: (c) => 's463_' + c },
  bk: { name: 'БК-6М', long: 'кумулятивный, прямой наводкой (ОП4М-45), 460 мм брони', short: 'кум.', id: () => 'bk6m', special: true },
  bm: { name: '«Лом»', long: 'подкалиберный БПС (условный), прямой наводкой, 340 мм у дула', short: 'БПС', id: () => 'bm122', special: true },
};
export const SHELL_ORDER = ['of', 'd', 's', 'bk', 'bm'];
export const SPECIAL_CHARGE = { id: 'sp', name: 'специальный', short: 'СПЕЦ' };
export function shellAmmoId(shell, ci) { const S = SHELLS[shell] || SHELLS.of; return S.id(CHARGES[ci].id); }

WEAPONS.d30 = {
  id: 'd30', name: 'Д-30 (2А18)', cls: '122-мм гаубица', ammo: 'of462_full', mag: 1, mags: 40,
  rpm: 7, modes: ['single'], disp: 0.12, sound: 'gun122', artillery: true,
};

export const NORMAL_ENV = makeEnv({ tempC: 15, pressureHPa: 1000, coriolis: false });

// Полёт по плоскости стрельбы: X — дальность, Y — высота, Z — вправо (деривация, боковой ветер)
export function fly(ammo, env, angle, { dt = 1 / 120, windX = 0, windZ = 0, until = 0 } = {}) {
  const e = { ...env, Oy: 0, Oz: 0, wind: { x: windX, y: 0, z: windZ } };
  const s = { p: { x: 0, y: 0, z: 0 }, v: { x: ammo.v0 * Math.cos(angle), y: ammo.v0 * Math.sin(angle), z: 0 }, t: 0, rx: 0, rz: 1 };
  let px = 0, py = 0, pz = 0, pt = 0, top = 0;
  while (s.t < 200) {
    px = s.p.x; py = s.p.y; pz = s.p.z; pt = s.t;
    stepProjectile(s, ammo, e, dt);
    if (s.p.y > top) top = s.p.y;
    if (s.p.y < until && s.v.y < 0) {
      const f = (py - until) / (py - s.p.y);
      const vx = s.v.x, vy = s.v.y;
      return { x: px + (s.p.x - px) * f, z: pz + (s.p.z - pz) * f, t: pt + (s.t - pt) * f, top, fall: Math.atan2(-vy, vx), vEnd: Math.hypot(vx, vy) };
    }
  }
  return { x: s.p.x, z: s.p.z, t: s.t, top, fall: 0, vEnd: 0 };
}

const tables = new Map();

// Таблица стрельбы для заряда (ленивый расчёт, кэш); shell — для выстрелов прямой наводкой
// (БК-6М, «лом») своя таблица на специальном заряде
export function firingTable(ci, shell = 'of') {
  const special = SHELLS[shell] && SHELLS[shell].special;
  const key = special ? shell : ci;
  if (tables.has(key)) return tables.get(key);
  if (special) return directTable(shell);
  const ch = CHARGES[ci];
  const ammo = prepareAmmo({ ...AMMO['of462_' + ch.id] });
  const env = NORMAL_ENV;
  // развёртка по углу возвышения до угла наибольшей дальности
  const sweep = [];
  let best = 0;
  for (let m = 2; m <= 1000; m += 4) {
    const r = fly(ammo, env, m * MIL, { dt: 1 / 60 });
    sweep.push({ m, x: r.x });
    if (r.x > best) best = r.x; else if (r.x < best - 50) break;
  }
  const maxM = sweep.reduce((a, b) => (b.x > a.x ? b : a)).m;
  const asc = sweep.filter((s) => s.m <= maxM);
  // прицел (тыс.) для дальности: обратная интерполяция и уточнение
  const solve = (D) => {
    let i = asc.findIndex((s) => s.x >= D);
    if (i < 0) return null;
    if (i === 0) i = 1;
    const a = asc[i - 1], b = asc[i];
    let lo = a.m - 4, hi = b.m + 4;
    for (let k = 0; k < 22; k++) {
      const mid = (lo + hi) / 2;
      if (fly(ammo, env, mid * MIL).x < D) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const maxRange = Math.floor(best / 100) * 100;
  const step = maxRange > 9000 ? 400 : 200;
  const D0 = ch.v0 > 500 ? 1000 : 600;
  const rows = [];
  for (let D = D0; D <= maxRange; D += step) {
    const m = solve(D);
    if (m === null) break;
    const a = m * MIL;
    const r = fly(ammo, env, a);
    const r1 = fly(ammo, env, a + MIL);
    // поправка на температуру — секущая по диапазону +15…−25 °C, приведённая к 10° (точнее в мороз)
    const rCold = fly(ammo, makeEnv({ tempC: -25, pressureHPa: 1000, coriolis: false }), a);
    const rHead = fly(ammo, env, a, { windX: -10 });
    const rCross = fly(ammo, env, a, { windZ: 10 });
    const noDrift = fly({ ...ammo, driftK: 0 }, env, a);
    rows.push({
      D, sight: m, dXmil: r1.x - r.x, t: r.t, top: r.top, fall: r.fall / MIL,
      drift: (r.z - noDrift.z) / D / MIL,               // деривация, тыс. (вправо)
      dXt: (rCold.x - r.x) / 4,                         // изменение дальности при понижении t на 10°, м
      dXw: rHead.x - r.x,                               // на встречный ветер 10 м/с, м
      dZw: (rCross.z - r.z) / D / MIL,                  // боковое отклонение от ветра 10 м/с слева, тыс.
    });
  }
  const T = { charge: ch, ci, rows, maxRange: best, maxSight: maxM, ammo };
  tables.set(ci, T);
  return T;
}

// Таблица прямой наводки (специальный заряд): дальность 100…2000/3000 м через 100 м
function directTable(shell) {
  const ammo = prepareAmmo({ ...AMMO[SHELLS[shell].id()] });
  const env = NORMAL_ENV;
  const maxD = shell === 'bm' ? 3000 : 2000;
  const rows = [];
  for (let D = 100; D <= maxD; D += 100) {
    let lo = 0, hi = 60;
    for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (fly(ammo, env, mid * MIL, { dt: 1 / 240 }).x < D) lo = mid; else hi = mid; }
    const m = (lo + hi) / 2, r = fly(ammo, env, m * MIL, { dt: 1 / 240 });
    rows.push({ D, sight: m, dXmil: 0, t: r.t, top: r.top, fall: r.fall / MIL, drift: 0, dXt: 0, dXw: 0, dZw: 0, vEnd: r.vEnd });
  }
  const T = { charge: { ...SPECIAL_CHARGE, v0: ammo.v0 }, ci: -1, shell, rows, maxRange: maxD, maxSight: rows[rows.length - 1].sight, ammo, direct: true };
  tables.set(shell, T);
  return T;
}

// Прицел (тыс.) для дальности по таблице (линейная интерполяция)
export function sightFor(ci, D) {
  const T = firingTable(ci);
  const R = T.rows;
  if (!R.length || D < R[0].D * 0.5 || D > R[R.length - 1].D) return null;
  if (D <= R[0].D) return R[0].sight * D / R[0].D;
  for (let i = 1; i < R.length; i++) if (D <= R[i].D) { const f = (D - R[i - 1].D) / (R[i].D - R[i - 1].D); return R[i - 1].sight + (R[i].sight - R[i - 1].sight) * f; }
  return null;
}

// Форматы: угломер «31-87», прицел «245»
export function fmtDiv(m) {
  let v = Math.round(m);
  v = ((v % 6000) + 6000) % 6000;
  const big = Math.floor(v / 100), small = v % 100;
  return `${big}-${String(small).padStart(2, '0')}`;
}
export function fmtSigned(m) {
  const v = Math.round(m);
  const a = Math.abs(v);
  return `${v < 0 ? '−' : '+'}${Math.floor(a / 100)}-${String(a % 100).padStart(2, '0')}`;
}

// Дирекционный угол (от севера по часовой) в тыс. из мировых координат: север = −Z, восток = +X
export function dirAngle(dx, dz) { return ((Math.atan2(dx, -dz) / MIL) % 6000 + 6000) % 6000; }

// Прямоугольные координаты карты: X — на север, Y — на восток
export const GRID = { X0: 61000, Y0: 34000 };
export const toGrid = (x, z) => ({ X: Math.round(GRID.X0 - z), Y: Math.round(GRID.Y0 + x) });
