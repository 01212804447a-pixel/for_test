// Внешняя баллистика: точечная модель с сопротивлением воздуха (стандартные
// функции G1/G7), ветром, силой Кориолиса, деривацией и реактивным двигателем.
// Одна и та же функция шага используется и в игре, и при расчёте таблиц стрельбы.

export const GRAV = 9.81;
export const EARTH_OMEGA = 7.2921e-5;

// Стандартная функция сопротивления G7 (Mach, Cd)
const G7 = [
  [0.0, 0.1198], [0.5, 0.1194], [0.6, 0.1194], [0.7, 0.1202], [0.75, 0.1215], [0.8, 0.1242],
  [0.85, 0.1306], [0.875, 0.1368], [0.9, 0.1464], [0.925, 0.166], [0.95, 0.2054], [0.975, 0.2993],
  [1.0, 0.3803], [1.025, 0.4015], [1.05, 0.4043], [1.075, 0.4034], [1.1, 0.4014], [1.15, 0.3955],
  [1.2, 0.3884], [1.3, 0.3732], [1.4, 0.358], [1.5, 0.344], [1.6, 0.3315], [1.7, 0.3209],
  [1.8, 0.3117], [1.9, 0.3042], [2.0, 0.298], [2.2, 0.2864], [2.4, 0.2752], [2.6, 0.2643],
  [2.8, 0.2533], [3.0, 0.2424], [3.5, 0.2154], [4.0, 0.1935], [5.0, 0.165],
];
// Стандартная функция сопротивления G1
const G1 = [
  [0.0, 0.2629], [0.5, 0.2032], [0.6, 0.2034], [0.7, 0.2165], [0.8, 0.2546], [0.85, 0.2901],
  [0.9, 0.3415], [0.95, 0.4084], [1.0, 0.4805], [1.05, 0.5427], [1.1, 0.5883], [1.2, 0.6393],
  [1.3, 0.6589], [1.4, 0.6621], [1.5, 0.6572], [1.6, 0.6484], [1.8, 0.6247], [2.0, 0.5934],
  [2.2, 0.5621], [2.5, 0.5181], [3.0, 0.4632], [3.5, 0.4223], [4.0, 0.3909], [5.0, 0.3467],
];

function cdLookup(table, m) {
  if (m <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (m < table[i][0]) {
      const a = table[i - 1], b = table[i];
      const t = (m - a[0]) / (b[0] - a[0]);
      return a[1] + (b[1] - a[1]) * t;
    }
  }
  return table[table.length - 1][1];
}

// Параметры атмосферы
export function makeEnv({ tempC = -20, pressureHPa = 1000, wind = { x: 0, y: 0, z: 0 }, latitudeDeg = 69, coriolis = true } = {}) {
  const T = tempC + 273.15;
  const rho = (pressureHPa * 100) / (287.05 * T);
  const c = 331.3 * Math.sqrt(T / 273.15);
  const phi = (latitudeDeg * Math.PI) / 180;
  return {
    tempC, pressureHPa, rho, c,
    wind: { x: wind.x || 0, y: wind.y || 0, z: wind.z || 0 },
    // Ω в локальной системе: X=восток, Y=вверх, -Z=север
    Oy: coriolis ? EARTH_OMEGA * Math.sin(phi) : 0,
    Oz: coriolis ? -EARTH_OMEGA * Math.cos(phi) : 0,
  };
}

// Подготовка боеприпаса: перевод BC (lb/in²) в кг/м², площадь миделя и т.п.
export function prepareAmmo(a) {
  if (a._prepared) return a;
  if (a.model === 'G7' || a.model === 'G1') {
    a.bcSI = a.bc * 703.07;
    a.table = a.model === 'G7' ? G7 : G1;
  } else {
    a.area = Math.PI * (a.caliber * a.caliber) / 4;
  }
  // коэффициент деривации (формула Литца), м
  a.driftK = a.spin ? 0.0254 * 1.25 * (a.spin.sg + 1.2) * (a.spin.dir || 1) : 0;
  a._prepared = true;
  return a;
}

const _a = { x: 0, y: 0, z: 0 };
function accel(ammo, env, vx, vy, vz, t, out, thrustDir) {
  const rx = vx - env.wind.x, ry = vy - env.wind.y, rz = vz - env.wind.z;
  const vr = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1e-6;
  let k;
  if (ammo.table) {
    const cd = cdLookup(ammo.table, vr / env.c);
    k = (env.rho * vr * cd * Math.PI) / (8 * ammo.bcSI);
  } else {
    k = (0.5 * env.rho * vr * ammo.cd * ammo.area) / ammo.mass;
  }
  let ax = -k * rx, ay = -k * ry - GRAV, az = -k * rz;
  const m = ammo.motor;
  if (m && t >= m.ignite && t < m.ignite + m.burn) {
    // Оперённая граната ориентируется по набегающему потоку (флюгирование),
    // поэтому тяга направлена вдоль относительной скорости → снос ПРОТИВ ветра.
    const f = m.thrust / ammo.mass;
    const vg = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1e-6;
    const w = m.vane ?? 1; // степень флюгирования оси по набегающему потоку
    let dx = (rx / vr) * w + (vx / vg) * (1 - w);
    let dy = (ry / vr) * w + (vy / vg) * (1 - w);
    let dz = (rz / vr) * w + (vz / vg) * (1 - w);
    if (thrustDir) { dx += thrustDir.x; dy += thrustDir.y; dz += thrustDir.z; }
    ax += f * dx; ay += f * dy; az += f * dz;
  }
  // Кориолис: a = -2 Ω × v
  const Oy = env.Oy, Oz = env.Oz;
  ax += -2 * (Oy * vz - Oz * vy);
  ay += -2 * (Oz * vx);
  az += -2 * (-Oy * vx);
  out.x = ax; out.y = ay; out.z = az;
  return out;
}

const _a1 = { x: 0, y: 0, z: 0 }, _a2 = { x: 0, y: 0, z: 0 };
// s: { p:{x,y,z}, v:{x,y,z}, t, rx, rz (правый вектор для деривации), thrustErr? }
export function stepProjectile(s, ammo, env, dt) {
  const p = s.p, v = s.v;
  accel(ammo, env, v.x, v.y, v.z, s.t, _a1, s.thrustErr);
  const hx = dt * 0.5;
  const mvx = v.x + _a1.x * hx, mvy = v.y + _a1.y * hx, mvz = v.z + _a1.z * hx;
  accel(ammo, env, mvx, mvy, mvz, s.t + hx, _a2, s.thrustErr);
  p.x += mvx * dt; p.y += mvy * dt; p.z += mvz * dt;
  v.x += _a2.x * dt; v.y += _a2.y * dt; v.z += _a2.z * dt;
  if (ammo.driftK) {
    const d0 = Math.pow(s.t, 1.83), d1 = Math.pow(s.t + dt, 1.83);
    const dd = ammo.driftK * (d1 - d0);
    p.x += s.rx * dd; p.z += s.rz * dd;
  }
  s.t += dt;
}

export const SIM_DT = 1 / 240;

// Двумерная симуляция для таблиц: ось X вниз по полю, Y вверх, Z вправо.
// Линия прицеливания горизонтальна на высоте 0, ствол на h ниже.
export function simulate(ammo, env, angle, { h = 0, maxX = 1000, maxT = 60, dt = SIM_DT, sampleEvery = 0, windCross = 0, drift = true } = {}) {
  prepareAmmo(ammo);
  // В таблицах Кориолис не учитываем (он зависит от азимута стрельбы)
  const e = { ...env, Oy: 0, Oz: 0, wind: { x: 0, y: 0, z: windCross } };
  // Направление стрельбы: +X. Правый вектор: +Z.
  const v0 = ammo.v0;
  const s = {
    p: { x: 0, y: -h, z: 0 },
    v: { x: v0 * Math.cos(angle), y: v0 * Math.sin(angle), z: 0 },
    t: 0, rx: 0, rz: drift ? 1 : 0,
  };
  // в 2D-системе деривация вдоль +Z; подменяем driftK при необходимости
  const pts = [];
  let next = 0;
  let px = 0, py = -h, pz = 0, pt = 0, pv = v0;
  if (sampleEvery) { pts.push({ x: 0, y: -h, z: 0, t: 0, v: v0 }); next = sampleEvery; }
  const ammoUse = drift ? ammo : { ...ammo, driftK: 0 };
  while (s.t < maxT) {
    px = s.p.x; py = s.p.y; pz = s.p.z; pt = s.t; pv = Math.hypot(s.v.x, s.v.y, s.v.z);
    stepProjectile(s, ammoUse, e, dt);
    const vNow = Math.hypot(s.v.x, s.v.y, s.v.z);
    if (sampleEvery) {
      while (s.p.x >= next && next <= maxX) {
        const f = (next - px) / (s.p.x - px);
        pts.push({ x: next, y: py + (s.p.y - py) * f, z: pz + (s.p.z - pz) * f, t: pt + (s.t - pt) * f, v: pv + (vNow - pv) * f });
        next += sampleEvery;
      }
    }
    if (s.p.x >= maxX) {
      const f = (maxX - px) / (s.p.x - px);
      return { reached: true, y: py + (s.p.y - py) * f, z: pz + (s.p.z - pz) * f, t: pt + (s.t - pt) * f, v: pv + (vNow - pv) * f, pts };
    }
    if (s.p.y < -3000) break;
    if (ammo.fuse && s.t > ammo.fuse) break;
  }
  return { reached: false, y: -1e9, z: 0, t: s.t, v: 0, pts };
}

// Угол возвышения ствола относительно линии прицеливания для попадания на дальности D
export function solveAngle(ammo, env, D, h, maxAngle = 0.35) {
  let lo = -0.02, hi = maxAngle;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    const r = simulate(ammo, env, mid, { h, maxX: D, drift: false });
    if (r.reached && r.y >= 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

// Угол наибольшей дальности (для гранатомётов/гранат) — золотое сечение
export function maxRangeAngle(ammo, env, h = 0) {
  const range = (a) => {
    prepareAmmo(ammo);
    const e = { ...env, Oy: 0, Oz: 0, wind: { x: 0, y: 0, z: 0 } };
    const s = { p: { x: 0, y: -h, z: 0 }, v: { x: ammo.v0 * Math.cos(a), y: ammo.v0 * Math.sin(a), z: 0 }, t: 0, rx: 0, rz: 0 };
    let px = 0, py = -h;
    const am = { ...ammo, driftK: 0 };
    while (s.t < 80) {
      px = s.p.x; py = s.p.y;
      stepProjectile(s, am, e, SIM_DT * 2);
      if (s.p.y < -h && s.v.y < 0) {
        const f = (-h - py) / (s.p.y - py);
        return px + (s.p.x - px) * f;
      }
      if (ammo.fuse && s.t > ammo.fuse) return s.p.x;
    }
    return s.p.x;
  };
  let a = 0.05, b = 1.2;
  const gr = 0.618034;
  let c = b - gr * (b - a), d = a + gr * (b - a);
  for (let i = 0; i < 40; i++) {
    if (range(c) > range(d)) b = d; else a = c;
    c = b - gr * (b - a); d = a + gr * (b - a);
  }
  const ang = (a + b) / 2;
  return { angle: ang, range: range(ang) };
}

// Решение «баллистического калькулятора» для ИИ и прицельных сеток
export class BallisticSolver {
  constructor(ammo, env, h, maxRange, step = 25, maxAngle = 0.35) {
    prepareAmmo(ammo);
    this.ammo = ammo; this.h = h; this.step = step; this.maxRange = maxRange;
    this.angles = []; this.tofs = []; this.vels = [];
    for (let D = step; D <= maxRange + 1e-6; D += step) {
      const a = solveAngle(ammo, env, D, h, maxAngle);
      const r = simulate(ammo, env, a, { h, maxX: D, drift: false });
      this.angles.push(a); this.tofs.push(r.t); this.vels.push(r.v);
    }
  }
  _interp(arr, D) {
    const f = D / this.step - 1;
    if (f <= 0) {
      // экстраполяция к нулю
      const a0 = arr[0];
      return a0 * Math.max(0, D / this.step) + (arr === this.angles ? 0 : 0);
    }
    const i = Math.floor(f);
    if (i >= arr.length - 1) return arr[arr.length - 1];
    const t = f - i;
    return arr[i] + (arr[i + 1] - arr[i]) * t;
  }
  angleFor(D) {
    if (D <= this.step) {
      // на малых дальностях угол определяется высотой прицела
      return this.angles[0] + (this.h / Math.max(D, 1) - this.h / this.step);
    }
    return this._interp(this.angles, D);
  }
  tofFor(D) { return this._interp(this.tofs, D); }
  velFor(D) { return this._interp(this.vels, D); }
}
