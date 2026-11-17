// Таблицы стрельбы и графики траекторий — считаются той же моделью, что и полёт в игре
import { simulate, solveAngle, makeEnv, maxRangeAngle, prepareAmmo } from './ballistics.js';
import { WEAPONS, AMMO, SCOPES } from '../data/weapons.js';
import { MIL } from '../core/math.js';

export const ZERO_ENV = makeEnv({ tempC: -20, pressureHPa: 1000, coriolis: false });
const cache = new Map();

function directShot(a, env, h, H, maxX) {
  // угол, при котором вершина траектории = H; дальность прямого выстрела = точка возврата на ЛП
  let lo = 0, hi = 0.05;
  let R = 0;
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) / 2;
    const r = simulate(a, env, mid, { h, maxX, sampleEvery: 2, drift: false });
    let maxY = -1e9, cross = 0, peaked = false;
    for (const p of r.pts) {
      if (p.y > maxY) maxY = p.y;
      if (p.y < maxY - 1e-4) peaked = true;
      if (peaked && p.y < 0 && !cross) cross = p.x;
    }
    if (maxY > H) hi = mid; else { lo = mid; R = cross; }
  }
  return R;
}

export function buildFiringTable(weaponId, opts = {}) {
  const key = weaponId + (opts.optic === false ? ':iron' : '');
  if (cache.has(key)) return cache.get(key);
  const w = WEAPONS[weaponId];
  const a = prepareAmmo(AMMO[w.ammo]);
  const env = ZERO_ENV;
  const sight = opts.optic === false && w.altSight ? w.altSight : w.sight;
  const h = sight.h || 0.06;
  const res = { weapon: w, ammo: a, h, env, kind: a.kind, columns: [], rows: [], charts: [], notes: [] };
  if (a.kind === 'bullet') {
    const maxR = weaponId === 'pkm' || weaponId === 'pkt' ? 1500 : weaponId === 'svd' ? 1300 : 1000;
    res.columns = ['Дальность, м', 'Прицел, тыс.', 'Снижение отн. оси ствола, см', 'Время полёта, с', 'Скорость, м/с', 'Энергия, Дж', 'Боковой ветер 10 м/с, см', 'Деривация, см', 'Поправка на −40 °C, тыс.'];
    const cold = makeEnv({ tempC: -40, pressureHPa: 1000, coriolis: false });
    for (let D = 100; D <= maxR; D += 100) {
      const th = solveAngle(a, env, D, h);
      const r = simulate(a, env, th, { h, maxX: D, drift: false });
      const rw = simulate(a, env, th, { h, maxX: D, windCross: 10, drift: false });
      const rd = simulate(a, env, th, { h, maxX: D, drift: true });
      const thc = solveAngle(a, cold, D, h);
      // снижение относительно линии бросания (оси ствола)
      const drop = (Math.tan(th) * D - h) - r.y;
      res.rows.push({
        D, mil: th / MIL, tof: r.t, v: r.v, E: 0.5 * a.mass * r.v * r.v,
        cells: [D, (th / MIL).toFixed(1), (drop * 100).toFixed(0), r.t.toFixed(2), r.v.toFixed(0), (0.5 * a.mass * r.v * r.v).toFixed(0), (rw.z * 100).toFixed(0), (rd.z * 100).toFixed(0), '+' + ((thc - th) / MIL).toFixed(1)],
      });
    }
    // превышение траекторий над линией прицеливания для установок прицела
    const settings = sight.type === 'iron' ? sight.settings.filter((s, i) => i % (weaponId === 'pkm' ? 3 : 2) === 0 || s.label === 'П') : (SCOPES[sight.scope].drum || [100, 300, 500, 700, 900]).filter((_, i) => i % 2 === 0).map((r) => ({ label: String(r / 100), range: r }));
    const chart = { title: 'Траектории относительно линии прицеливания', xLabel: 'Дальность, м', yLabel: 'Превышение, м', series: [], xMax: Math.min(maxR, 1000) };
    for (const s of settings) {
      const th = solveAngle(a, env, s.range, h);
      const r = simulate(a, env, th, { h, maxX: chart.xMax, sampleEvery: 10, drift: false });
      chart.series.push({ label: `Прицел ${s.label}`, pts: r.pts.map((p) => [p.x, p.y]) });
    }
    res.charts.push(chart);
    const vchart = { title: 'Скорость пули и энергия', xLabel: 'Дальность, м', yLabel: 'м/с', series: [], xMax: maxR };
    const thv = solveAngle(a, env, 300, h);
    const rv = simulate(a, env, thv, { h, maxX: maxR, sampleEvery: 20, drift: false });
    vchart.series.push({ label: 'Скорость, м/с', pts: rv.pts.map((p) => [p.x, p.v]) });
    vchart.series.push({ label: 'Энергия /4, Дж', pts: rv.pts.map((p) => [p.x, 0.5 * a.mass * p.v * p.v / 4]) });
    res.charts.push(vchart);
    // прямой выстрел
    const ds = [['головная фигура (0,3 м)', 0.3], ['грудная фигура (0,5 м)', 0.5], ['ростовая фигура (1,5 м)', 1.5]];
    res.direct = ds.map(([n, H]) => ({ name: n, R: directShot(a, env, h, H, 1500) }));
    res.notes.push(`Начальная скорость V₀ = ${a.v0} м/с, масса пули ${(a.mass * 1000).toFixed(1)} г, БК (G7) = ${a.bc}.`);
    res.notes.push(`Нормальные условия пристрелки: t = −20 °C, P = 1000 гПа (750 мм рт. ст.), безветрие. Высота линии прицеливания над осью ствола ${(h * 100).toFixed(1)} см.`);
    res.notes.push('При понижении температуры плотность воздуха растёт — пуля теряет скорость быстрее, нужна поправка прицела вверх.');
    res.notes.push('Деривация (правый шаг нарезов) уводит пулю вправо; ветер 10 м/с слева сносит вправо на указанную величину.');
  } else if (a.kind === 'rocket') {
    res.columns = ['Дальность, м', 'Угол прицеливания, тыс.', 'Время полёта, с', 'Скорость, м/с', 'Ветер 10 м/с: снос, м', 'Ветер 10 м/с: поправка, тыс.'];
    for (let D = 100; D <= 700; D += 100) {
      const th = solveAngle(a, env, D, h, 0.3);
      const r = simulate(a, env, th, { h, maxX: D, drift: false });
      const rw = simulate(a, env, th, { h, maxX: D, windCross: 10, drift: false });
      res.rows.push({ D, cells: [D, (th / MIL).toFixed(1), r.t.toFixed(2), r.v.toFixed(0), rw.z.toFixed(2), (rw.z / D * 1000 / 1.047).toFixed(1)] });
    }
    const chart = { title: 'Траектории ПГ-7ВМ (марки 2–5)', xLabel: 'Дальность, м', yLabel: 'Превышение, м', series: [], xMax: 600 };
    for (const D of [200, 300, 400, 500]) {
      const th = solveAngle(a, env, D, h, 0.3);
      const r = simulate(a, env, th, { h, maxX: 600, sampleEvery: 5, drift: false });
      chart.series.push({ label: `Марка ${D / 100}`, pts: r.pts.map((p) => [p.x, p.y]) });
    }
    res.charts.push(chart);
    const vchart = { title: 'Скорость гранаты: стартовый заряд → реактивный двигатель', xLabel: 'Дальность, м', yLabel: 'м/с', series: [], xMax: 900 };
    const r = simulate(a, env, 0.02, { h, maxX: 1200, sampleEvery: 5, drift: false });
    vchart.series.push({ label: 'Скорость, м/с', pts: r.pts.filter((p) => p.t <= a.fuse).map((p) => [p.x, p.v]) });
    res.charts.push(vchart);
    const fuseR = r.pts.filter((p) => p.t <= a.fuse).pop();
    res.direct = [{ name: 'цель высотой 2 м (бронетехника)', R: directShot(a, env, h, 2, 800) }];
    res.notes.push(`V₀ = ${a.v0} м/с (стартовый заряд), реактивный двигатель включается на ${(a.motor.ignite * 140).toFixed(0)} м и разгоняет гранату до ~300 м/с.`);
    res.notes.push(`Самоликвидация через ${a.fuse} с — на дальности ≈ ${fuseR ? fuseR.x.toFixed(0) : '—'} м. Взведение взрывателя: ${a.armDist} м.`);
    res.notes.push('ВАЖНО: оперённая граната на активном участке разворачивается носом к ветру — при боковом ветре её уводит ПРОТИВ ветра. Выносить точку прицеливания по ветру!');
  } else if (a.kind === 'grenade') {
    res.columns = ['Дальность, м', 'Угол возвышения, °', 'Угол, тыс.', 'Время полёта, с', 'Макс. высота, м', 'Угол падения, °'];
    for (let D = 50; D <= 400; D += 50) {
      const th = solveAngle(a, env, D, h, 0.72);
      const r = simulate(a, env, th, { h, maxX: D, sampleEvery: 2, drift: false });
      const maxY = Math.max(...r.pts.map((p) => p.y));
      const last = r.pts[r.pts.length - 1], prev = r.pts[r.pts.length - 2] || last;
      const fall = Math.atan2(prev.y - last.y, last.x - prev.x) * 180 / Math.PI;
      res.rows.push({ D, cells: [D, (th * 180 / Math.PI).toFixed(1), (th / MIL).toFixed(0), r.t.toFixed(2), maxY.toFixed(1), fall.toFixed(0)] });
    }
    const chart = { title: 'Траектории ВОГ-25 (навесная стрельба)', xLabel: 'Дальность, м', yLabel: 'Высота, м', series: [], xMax: 420, equal: true };
    for (const D of [100, 200, 300, 400]) {
      const th = solveAngle(a, env, D, h, 0.72);
      const r = simulate(a, env, th, { h, maxX: D, sampleEvery: 4, drift: false });
      chart.series.push({ label: `${D} м`, pts: r.pts.map((p) => [p.x, p.y]) });
    }
    res.charts.push(chart);
    const mr = maxRangeAngle(a, env, 0);
    res.notes.push(`V₀ = ${a.v0} м/с. Наибольшая дальность ≈ ${mr.range.toFixed(0)} м при угле ${(mr.angle * 180 / Math.PI).toFixed(0)}°. Взведение на ${a.armDist} м — ближе граната не взрывается.`);
    res.notes.push('Квадрантный прицел ГП-25: выставьте дальность — ствол поднимется на нужный угол. Сопротивление воздуха укорачивает и делает круче нисходящую ветвь.');
  }
  // ручная граната
  cache.set(key, res);
  return res;
}

export function handGrenadeTable() {
  const a = prepareAmmo(AMMO.f1);
  const env = ZERO_ENV;
  const chart = { title: 'Бросок Ф-1 (V₀ = 17 м/с) под разными углами', xLabel: 'Дальность, м', yLabel: 'Высота, м', series: [], xMax: 32, equal: true };
  const rows = [];
  for (const deg of [15, 30, 45, 60]) {
    const th = deg * Math.PI / 180;
    const r = simulate(a, env, th, { h: -1.7, maxX: 40, sampleEvery: 0.5, drift: false });
    const pts = [];
    for (const p of r.pts) { pts.push([p.x, p.y]); if (p.y < 0 && pts.length > 2) break; }
    chart.series.push({ label: `${deg}°`, pts });
    rows.push({ cells: [deg, pts[pts.length - 1][0].toFixed(1)] });
  }
  return { chart, rows, columns: ['Угол броска, °', 'Дальность, м'], notes: ['Радиус разлёта осколков Ф-1 — до 200 м, бросать только из укрытия! Замедлитель 3,2–4,2 с.'] };
}

export const TABLE_WEAPONS = ['ak74m', 'akm', 'svd', 'pkm', 'rpg7', 'gp25'];
