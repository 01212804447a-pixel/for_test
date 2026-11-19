// Т-72Б: экипаж из трёх (командир — игрок, наводчик и механик-водитель — ИИ), 125-мм пушка
// 2А46М с автоматом заряжания (22 выстрела в карусели, 23 в немеханизированной укладке),
// СУО 1А40-1: лазерный дальномер и баллистический вычислитель (поправка на дальность для
// выбранного снаряда), двухплоскостной стабилизатор 2Э42-4 (линия прицеливания держится
// в пространстве, башня 24°/с, пушка 3,5°/с, −6…+14°). Командир наводит сам (дублированное
// управление), его команды механику-водителю (стрелки) выполняются с задержкой на реакцию.
// Виды — только изнутри: прицел наводчика 1А40-1, командирский ТКН-3, приборы командирской
// башенки (панорама), прибор механика ТНПО-168В, командир высунулся из люка (НСВТ).
// Броня — по зонам и направлениям с разными стойкостями к подкалиберным (КЭ) и кумулятивным
// (ХЭ) боеприпасам; заброневое действие — по экипажу и модулям, детонация боекомплекта
// в карусели — башню срывает.
import * as THREE from 'three';
import { AMMO, WEAPONS } from '../data/weapons.js';
import { prepareAmmo } from '../physics/ballistics.js';
import { fly, NORMAL_ENV } from '../artillery/d30.js';
import { Soldier } from './soldier.js';
import { clamp, rand, randn, wrapAngle } from '../core/math.js';
import { T72 } from './t72Model.js';

// ---------- боеприпасы 2А46М ----------
// 3БМ42 «Манго»: ведущая часть 4,85 кг, V₀ 1715 м/с, ≈ 560 мм у дула, ≈ 500 мм на 2 км
AMMO['3bm42'] = prepareAmmo({
  id: '3bm42', name: '3БМ42 «Манго» (БОПС)', short: '3БМ42', kind: 'shell', model: 'G7', bc: 4.2,
  mass: 4.85, caliber: 0.03, v0: 1715, pen: 560, apfsds: true, spin: { sg: 1.2, dir: 1 }, v0sd: 0.0012, maxT: 10,
  tracer: true, tracerColor: [1, 0.6, 0.25],
});
// 3БК18М: кумулятивный, 19 кг, V₀ 905 м/с, бронепробиваемость ≈ 550 мм на любой дальности
AMMO['3bk18m'] = prepareAmmo({
  id: '3bk18m', name: '3БК18М (кумулятивный)', short: '3БК18М', kind: 'shell', model: 'G1', bc: 2.6,
  mass: 19.0, caliber: 0.125, v0: 905, spin: { sg: 1.2, dir: 1 }, v0sd: 0.0015, maxT: 20, armDist: 15,
  explosive: { pen: 550, radius: 4.5, frag: 22, dmg: 300, fxSize: 2.2 },
});
// 3ОФ26: осколочно-фугасный, 23 кг, ВВ 3,4 кг, V₀ 850 м/с
AMMO['3of26'] = prepareAmmo({
  id: '3of26', name: '3ОФ26 (осколочно-фугасный)', short: '3ОФ26', kind: 'shell', model: 'G1', bc: 3.0,
  mass: 23.0, caliber: 0.125, v0: 850, spin: { sg: 1.2, dir: 1 }, v0sd: 0.0015, maxT: 40, armDist: 30,
  explosive: { pen: 50, radius: 12, frag: 46, dmg: 410, fxSize: 3.2 },
});
AMMO['127_b32'] = prepareAmmo({
  id: '127_b32', name: '12,7×108 Б-32', short: 'Б-32', cls: 'ap', kind: 'bullet', model: 'G7', bc: 0.4,
  mass: 0.048, caliber: 0.0127, v0: 845, spin: { sg: 1.8, dir: 1 }, pen: 20, dmgK: 1.0, tracerEvery: 4, tracerColor: [1, 0.35, 0.15],
});
WEAPONS['2a46m'] = { id: '2a46m', name: '2А46М', cls: '125-мм гладкоствольная пушка', ammo: '3bm42', mag: 1, mags: 45, rpm: 8, modes: ['single'], disp: 0.1, sound: 'rpg', tankGun: true };
WEAPONS.nsvt = { id: 'nsvt', name: 'НСВТ «Утёс»', cls: '12,7-мм пулемёт', ammo: '127_b32', mag: 50, mags: 5, rpm: 750, modes: ['auto'], disp: 0.7, sound: 'ptrd', reload: 8 };

export const ROUNDS = {
  bm: { id: '3bm42', name: '3БМ42', long: 'бронебойный подкалиберный «Манго»', lamp: 'БР' },
  bk: { id: '3bk18m', name: '3БК18М', long: 'кумулятивный', lamp: 'КС' },
  of: { id: '3of26', name: '3ОФ26', long: 'осколочно-фугасный', lamp: 'ОФ' },
};
const RKEYS = ['bm', 'bk', 'of'];
const MIL = (Math.PI * 2) / 6000;
const TRAV = (24 * Math.PI) / 180, ELEV = (3.5 * Math.PI) / 180;
const EL_MIN = (-6 * Math.PI) / 180, EL_MAX = (14 * Math.PI) / 180;
const LOAD_T = 7.1;                              // цикл АЗ
const GEARS = [-4, 0, 12, 25, 40, 60];           // скорости по командам, км/ч (−4 — задний ход)
const GEAR_NAMES = ['назад', 'стой', 'малый вперёд', 'средний', 'быстрее', 'полный'];
const VIEWS = ['gunner', 'tkn', 'pano', 'driver'];
const VIEW_NAMES = { gunner: 'Прицел наводчика', tkn: 'Командирский ТКН-3', pano: 'Приборы командирской башенки', driver: 'Прибор механика ТНПО-168В', hatch: 'Командир в люке (НСВТ)' };

// ---------- броня (мм стальной брони, эквивалент по линии прицеливания) ----------
// [КЭ — подкалиберный/бронебойный, ХЭ — кумулятивный, вклад ДЗ «Контакт-1» в ХЭ — его снимает
// тандемная боевая часть (лидирующий заряд подрывает блок, основной бьёт по броне)]
export const T72_ARMOR = {
  turretFront: [520, 900, 250], turretSide: [270, 380, 0], turretRear: [70, 70, 0], turretRoof: [40, 60, 0],
  hullUpper: [480, 700, 220], hullLower: [250, 260, 0], hullSide: [80, 200, 0], hullSideLow: [80, 90, 0],
  hullRear: [40, 45, 0], hullRoof: [20, 20, 0], hullBottom: [20, 20, 0],
};
// Т-80БВ: комбинированная лобовая броня корпуса и литая башня с наполнителем, «Контакт-1»
export const T80_ARMOR = {
  turretFront: [500, 850, 250], turretSide: [260, 360, 0], turretRear: [70, 70, 0], turretRoof: [40, 60, 0],
  hullUpper: [470, 690, 220], hullLower: [250, 260, 0], hullSide: [80, 200, 0], hullSideLow: [80, 90, 0],
  hullRear: [40, 45, 0], hullRoof: [20, 20, 0], hullBottom: [20, 20, 0],
};
// паспортные отличия: СУО, прицел, боекомплект
export const TANK_SPECS = {
  t72b: {
    name: 'Т-72Б', fcs: '1А40-1', sight: 'Прицел наводчика 1А40-1', lead: false, armor: T72_ARMOR,
    car: { bm: 10, bk: 6, of: 6 }, rack: { bm: 9, bk: 6, of: 8 },
    fcsNote: 'лазерный дальномер, ввод дальности в баллистический вычислитель — автоматически; упреждение — по шкалам',
  },
  t80bv: {
    name: 'Т-80БВ', fcs: '1А33', sight: 'Прицел-дальномер 1Г42', lead: true, armor: T80_ARMOR,
    car: { bm: 12, bk: 8, of: 8 }, rack: { bm: 4, bk: 3, of: 3 },
    fcsNote: 'дальность, угол прицеливания и упреждение по скорости слежения — автоматически (баллистический вычислитель 1В517)',
  },
};
const ZONE_NAMES = {
  turretFront: 'лоб башни', turretSide: 'борт башни', turretRear: 'корма башни', turretRoof: 'крыша башни',
  hullUpper: 'ВЛД', hullLower: 'НЛД', hullSide: 'борт', hullSideLow: 'борт (ходовая)', hullRear: 'корма', hullRoof: 'крыша МТО', hullBottom: 'днище',
};

const _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

// зона попадания по точке (мир) и направлению полёта (мир)
export function tankZone(v, pt, dir) {
  v.mesh.updateMatrixWorld(true);
  _m.copy(v.mesh.matrixWorld).invert();
  const lp = _v.copy(pt).applyMatrix4(_m);
  const ld = _v2.copy(dir).transformDirection(_m);
  const R = T72.ring;
  const tx = lp.x - R.x, tz = lp.z - R.z;
  let zone;
  if (lp.y > R.y - 0.02 && Math.hypot(tx, tz) < 1.45 && lp.y < R.y + 0.95) {
    // башня: по направлению прихода снаряда в системе башни
    const ty = v.turretYaw || 0;
    const c = Math.cos(ty), s = Math.sin(ty);
    const dx = ld.x * c - ld.z * s, dz = ld.x * s + ld.z * c; // поворот на −turretYaw
    const from = Math.atan2(-dx, dz);                           // 0 — снаряд летит в лоб
    const a = Math.abs(from);
    if (ld.y < -0.6) zone = 'turretRoof';
    else zone = a < 0.62 ? 'turretFront' : a < 2.3 ? 'turretSide' : 'turretRear';
  } else {
    const from = Math.atan2(-ld.x, ld.z), a = Math.abs(from);
    if (ld.y < -0.7 && lp.y > 1.3) zone = 'hullRoof';
    else if (lp.y < 0.5 && ld.y > 0.5) zone = 'hullBottom';
    else if (a < 0.7) zone = lp.y > 0.9 || lp.z < -3.2 ? (lp.z < -1.9 ? 'hullUpper' : 'hullRoof') : 'hullLower';
    else if (a > 2.45) zone = 'hullRear';
    else zone = lp.y < 1.12 ? 'hullSideLow' : 'hullSide';
    if (zone === 'hullRoof' && ld.y > -0.3) zone = a < 0.7 ? 'hullUpper' : a > 2.45 ? 'hullRear' : 'hullSide';
  }
  return { zone, lp: lp.clone(), ld: ld.clone() };
}

export class Tank {
  constructor(v) {
    this.v = v; this.m = v.game;
    this.spec = TANK_SPECS[v.typeId] || TANK_SPECS.t72b;
    const m = this.m, team = v.team;
    // экипаж: механик-водитель (место 0) и наводчик (место 1); командир (место 2) — игрок
    const mk = this._mkCrew = (name) => { const s = new Soldier(m, { team, faction: team, name, callsign: name, role: 'crew', weapon: 'ak74m', x: v.pos.x, z: v.pos.z, noModel: true, grenades: 0, armor: 0.6, helmet: 0.3, medkits: 0 }); s.isCrew = true; s.hidden = true; return s; };
    this.driver = mk('Мехвод'); this.gunner = mk('Наводчик');
    v.seats[0] = this.driver; this.driver.vehicle = v; this.driver.seat = 0;
    v.seats[1] = this.gunner; this.gunner.vehicle = v; this.gunner.seat = 1;
    // боекомплект: карусель АЗ и немеханизированная укладка
    this.car = { ...this.spec.car };
    this.rack = { ...this.spec.rack };
    this.sel = 'bm'; this.loaded = 'bm'; this.loadT = 0; this.loading = null;
    this.range = 0; this.superEl = 0; this.rangeT = 0; this.fcsT = 0;
    this.leadY = 0; this.leadP = 0; this.rateY = 0; this.rateP = 0;
    this.cmdr = null; this.ai = null;
    this.aimYaw = v.yaw; this.aimPitch = 0;
    this.lookYaw = 0; this.lookPitch = 0;          // свободный обзор (панорама, люк, мехвод) — от корпуса
    this.view = 'gunner'; this.hatch = false;
    this.gear = 0; this.steer = 0; this.queue = []; this.time = 0;
    this.mod = { engine: 1, gun: 1, sight: 1, traverse: 1, autoloader: 1 };
    this.fire = 0; this.ext = 3; this.extT = 0;
    this.coax = { ammo: 250, belts: 7, cd: 0, reload: 0 };
    this.nsvt = { ammo: 50, boxes: 5, cd: 0, reload: 0 };
    this.smokes = 8; this.smokeCD = 0;
    this.recoil = 0; this.cupYaw = 0; this.lidOpen = 0;
    this.ui = null;
    this.knocked = false;
    this._tables = {};
  }

  get commander() { return this.v.seats[2]; }
  // в танке командир-человек (игрок или игрок по сети), а не ИИ
  get humanCmd() { const c = this.v.seats[2]; return !!c && !c.isCrew; }

  // экипаж ИИ целиком (танк противника): командир на месте 2 и логика боя
  enableAI(opts = {}) {
    if (!this.cmdr) { this.cmdr = this._mkCrew('Командир'); this.v.seats[2] = this.cmdr; this.cmdr.vehicle = this.v; this.cmdr.seat = 2; }
    this.ai = new TankAI(this, opts);
    return this.ai;
  }
  get gunnerOk() { return this.gunner.alive; }
  get driverOk() { return this.driver.alive; }

  // ---------- СУО: поправка на дальность для снаряда ----------
  table(key) {
    if (this._tables[key]) return this._tables[key];
    const ammo = AMMO[ROUNDS[key].id], rows = [];
    for (let D = 100; D <= 5000; D += 100) {
      let lo = -0.002, hi = 0.15;
      for (let k = 0; k < 22; k++) { const mid = (lo + hi) / 2; if (fly(ammo, NORMAL_ENV, mid, { dt: 1 / 120 }).x < D) lo = mid; else hi = mid; }
      const a = (lo + hi) / 2;
      rows.push({ a, t: fly(ammo, NORMAL_ENV, a, { dt: 1 / 120 }).t });
    }
    this._tables[key] = rows;
    return rows;
  }
  superFor(key, D) {
    if (!D) return 0;
    const T = this.table(key), f = clamp(D / 100 - 1, 0, T.length - 1), i = Math.floor(f);
    return T[i].a + (T[Math.min(T.length - 1, i + 1)].a - T[i].a) * (f - i);
  }
  tofFor(key, D) {
    if (!D) return 0;
    const T = this.table(key), f = clamp(D / 100 - 1, 0, T.length - 1), i = Math.floor(f);
    return T[i].t + (T[Math.min(T.length - 1, i + 1)].t - T[i].t) * (f - i);
  }

  // СУО: дальномер сам замеряет дальность по линии прицеливания (≈3 раза в секунду),
  // баллистический вычислитель выставляет угол прицеливания для заряженного (заряжаемого)
  // снаряда; у 1А33 (Т-80БВ) — ещё упреждение по угловой скорости слежения за целью
  _fcs(dt) {
    this.fcsT -= dt;
    if (this.fcsT <= 0) { this.fcsT = 0.33; if (this.mod.sight > 0) this.measure(); }
    const key = this.loaded || (this.loading && this.loading.key) || this.sel;
    this.superEl = this.range ? this.superFor(key, this.range) : 0;
    if (this.spec.lead && dt > 0) {
      const wy = wrapAngle(this.aimYaw - (this._ay0 ?? this.aimYaw)) / dt, wp = (this.aimPitch - (this._ap0 ?? this.aimPitch)) / dt;
      this._ay0 = this.aimYaw; this._ap0 = this.aimPitch;
      const k = Math.min(1, dt * 2.2);
      this.rateY += (clamp(wy, -0.4, 0.4) - this.rateY) * k; this.rateP += (clamp(wp, -0.2, 0.2) - this.rateP) * k;
      const tof = this.tofFor(key, this.range || 1000);
      this.leadY = clamp(this.rateY * tof, -0.03, 0.03); this.leadP = clamp(this.rateP * tof, -0.01, 0.01);
    } else { this.leadY = 0; this.leadP = 0; }
  }

  // замер лазерным дальномером по линии прицеливания; нет отражения — дальность прежняя
  measure() {
    const m = this.m;
    const from = this.sightWorld('gunner');
    const dir = _v.set(-Math.sin(this.aimYaw) * Math.cos(this.aimPitch), Math.sin(this.aimPitch), -Math.cos(this.aimYaw) * Math.cos(this.aimPitch));
    const to = from.clone().addScaledVector(dir, 5000);
    const hit = m.world.raycast(from, to, { mask: 'sight', vehicles: true, ignore: this.v });
    const D = hit ? hit.t * 5000 : 0;
    if (D > 50 && D < 5000) { this.range = Math.round(D / 5) * 5; return true; }
    return false;
  }

  // ---------- точки и направления ----------
  sightWorld(view, out = new THREE.Vector3()) {
    const M = this.v.model;
    M.turret.updateMatrixWorld(true);
    if (view === 'gunner') return out.set(T72.gunnerSight.x, T72.gunnerSight.y - 0.05, T72.gunnerSight.z - 0.2).applyMatrix4(M.turret.matrixWorld);
    if (view === 'tkn') return out.set(0, 0.21, -0.47).applyMatrix4(M.cupola.matrixWorld);
    if (view === 'pano') return out.set(0.24, 0.1, -0.44).applyMatrix4(M.cupola.matrixWorld); // у смотрового прибора справа от ТКН-3
    if (view === 'hatch') return out.set(-0.05, 1.0, 0.3).applyMatrix4(M.cupola.matrixWorld);
    this.v.mesh.updateMatrixWorld(true);
    return out.set(T72.driver.x, T72.driver.y + 0.03, T72.driver.z - 0.08).applyMatrix4(this.v.mesh.matrixWorld);
  }
  muzzle(outPos, outDir) {
    const g = this.v.model.gun;
    g.updateMatrixWorld(true);
    outPos.set(0, 0, T72.muzzle).applyMatrix4(g.matrixWorld);
    outDir.set(0, 0, -1).transformDirection(g.matrixWorld);
  }
  // мировое направление ствола (yaw, pitch)
  gunWorldAngles() {
    const p = _v, d = _v2;
    this.muzzle(p, d);
    return { yaw: Math.atan2(-d.x, -d.z), pitch: Math.asin(clamp(d.y, -1, 1)) };
  }

  // ---------- кадр (у того, кто управляет: в одиночной игре — всегда) ----------
  update(dt, local) {
    const v = this.v, m = this.m;
    this.time += dt;
    // экипаж едет внутри
    for (const s of [this.driver, this.gunner]) if (s.alive) { s.pos.set(v.pos.x, v.pos.y + 0.8, v.pos.z); s.vel.copy(v.vel); s.updateEye(); }
    // пожар в МТО: автоматическая ППО 3ЭЦ13, три баллона
    if (this.fire > 0 && v.alive) {
      this.fire += dt;
      this.extT -= dt;
      if (Math.random() < dt * 4) { const p = v.toWorld(rand(-0.8, 0.8), 1.6, rand(1.4, 3.0)); m.fx.smoke.emit(p.x, p.y, p.z, rand(-0.3, 0.3), rand(1.5, 2.5), rand(-0.3, 0.3), rand(4, 7), 0.6, 3.5, 0.15, 0.14, 0.13, 0.7, 0, 0.3, -0.2); }
      if (this.extT <= 0 && this.ext > 0) {
        this.ext--; this.extT = 3;
        if (Math.random() < 0.65) { this.fire = 0; if (this._mine()) m.hud.radio('Мехвод', 'Пожар в МТО потушен системой ППО!', true); }
        else if (this._mine()) m.hud.radio('Мехвод', `Пожар в МТО! Сработал баллон ППО, осталось ${this.ext}`, true);
      }
      if (this.fire > 40 && (!m.net || m.net.isHost)) this.catastrophic(null);
    }
    if (!v.alive) return;
    // откат ствола
    this.recoil = Math.max(0, this.recoil - dt * 2.2);
    v.model.gun.position.z = T72.trunnion.z + Math.min(0.32, this.recoil * 0.9) * (this.recoil > 0.7 ? 1 : this.recoil / 0.7);
    // люк командира
    this.lidOpen += ((this.hatch ? 1 : 0) - this.lidOpen) * Math.min(1, dt * 5);
    v.model.lid.rotation.x = this.lidOpen * 1.9;
    v.model.cupola.rotation.y = this.cupYaw;
    if (!local) return;
    // автомат заряжания
    this._autoload(dt);
    // команды механику-водителю: исполнение с задержкой
    while (this.queue.length && this.queue[0].t <= this.time) { const c = this.queue.shift(); c.run(); }
    // экипаж ИИ (танк противника) сам ищет цели и стреляет; едет по маршруту (Vehicle._aiDrive)
    if (this.ai && !this.humanCmd) this.ai.update(dt);
    if (!v.ai) this._drive(dt);
    // СУО: дальность, угол прицеливания, упреждение
    this._fcs(dt);
    // приводы наведения: башня и пушка догоняют линию прицеливания (стабилизатор)
    this._lay(dt);
    this.coax.cd -= dt; this.nsvt.cd -= dt; this.smokeCD -= dt;
    if (this.coax.reload > 0) { this.coax.reload -= dt; if (this.coax.reload <= 0) { this.coax.belts--; this.coax.ammo = 250; } }
    if (this.nsvt.reload > 0) { this.nsvt.reload -= dt; if (this.nsvt.reload <= 0) { this.nsvt.boxes--; this.nsvt.ammo = 50; } }
  }

  _mine() { return this.m.player.vehicle === this.v; }

  _autoload(dt) {
    if (this.loaded || !this.v.alive) return;
    if (!this.loading) {
      const k = this.sel;
      const fromCar = this.car[k] > 0 && this.mod.autoloader > 0;
      const any = this.car[k] + this.rack[k] > 0;
      if (!any) { const alt = RKEYS.find((q) => this.car[q] + this.rack[q] > 0); if (!alt) return; this.sel = alt; if (this._mine()) this.m.hud.message(`${ROUNDS[k].name} кончились — заряжаю ${ROUNDS[alt].name}`, 2.5); return; }
      // АЗ работает и без наводчика; из немеханизированной укладки досылает наводчик вручную
      const manual = !fromCar;
      if (manual && !this.gunnerOk) { if (!this._noMan) { this._noMan = true; if (this._mine()) this.m.hud.message('Наводчик выбыл — из укладки заряжать некому, в карусели этого снаряда нет', 3); } return; }
      this._noMan = false;
      this.loading = { key: k, t: manual ? 16 + rand(0, 4) : LOAD_T, manual };
      if (fromCar) this.car[k]--; else this.rack[k]--;
      if (this._mine()) this.m.audio.mech('reload');
      return;
    }
    this.loading.t -= dt;
    if (this.loading.t <= 0) {
      this.loaded = this.loading.key; this.loading = null;
      if (this._mine()) { this.m.audio.mech('switch'); this.m.hud.radio('Наводчик', `${ROUNDS[this.loaded].name} — готов!`); }
    }
  }

  // механик-водитель держит скорость по команде и курс по команде поворота
  _drive(dt) {
    const v = this.v, c = v.controls;
    if (!this.driverOk || this.mod.engine <= 0) { c.throttle = 0; c.steer = 0; c.brake = 1; return; }
    const want = GEARS[this.gear + 1] / 3.6;
    const sp = v.speed;
    c.steer = this.steer === 0 ? 0 : clamp(this.steer, -2, 2) * 0.5 * -1;
    // «стой» с командой поворота — разворот на месте
    if (this.gear === 0) { c.throttle = 0; c.brake = 1; return; }
    c.brake = 0;
    const err = want - sp;
    if (want > 0) c.throttle = err > 0.2 ? clamp(err * 0.7 + 0.3, 0.2, 1) : err < -1 ? -0.4 : 0;
    else c.throttle = sp > 0.3 ? -1 : err < -0.05 ? -1 : 0;
  }

  // команда механику: выполнится через время реакции
  order(kind) {
    const m = this.m;
    if (!this.driverOk) { m.hud.message('Механик-водитель выбыл — танк без управления', 2.5); return; }
    const delay = rand(0.55, 1.0) * (this.driver.health < 60 ? 1.7 : 1);
    const g0 = this.gearCmd ?? this.gear, s0 = this.steerCmd ?? this.steer;
    let g = g0, st = s0, say, reply;
    if (kind === 'up') { g = clamp(g0 + 1, -1, 4); say = g === 0 ? 'Стой!' : g === 1 ? 'Вперёд!' : g === 4 ? 'Полный вперёд!' : 'Быстрее!'; reply = g === 0 ? 'Стою' : g === 4 ? 'Есть полный' : 'Есть вперёд'; }
    else if (kind === 'down') { g = clamp(g0 - 1, -1, 4); say = g === -1 ? 'Назад!' : g === 0 ? 'Стой!' : 'Тише!'; reply = g === -1 ? 'Есть назад' : g === 0 ? 'Стою' : 'Есть тише'; }
    else if (kind === 'stop') { g = 0; st = 0; say = 'Стой! Короткая!'; reply = 'Есть короткая'; }
    else {
      st = clamp(s0 + (kind === 'left' ? -1 : 1), -2, 2);
      say = st === 0 ? 'Прямо!' : st < 0 ? (st === -2 ? 'Круто влево!' : 'Левее!') : (st === 2 ? 'Круто вправо!' : 'Правее!');
      reply = st === 0 ? 'Прямо' : st < 0 ? 'Есть левее' : 'Есть правее';
    }
    this.gearCmd = g; this.steerCmd = st;
    m.hud.radio('Командир', say);
    this.queue.push({ t: this.time + delay, run: () => { this.gear = g; this.steer = st; if (this._mine()) m.hud.radio('Мехвод', reply); } });
    m.audio.radio();
  }

  _lay(dt) {
    const v = this.v;
    // желаемое направление ствола в мире: линия прицеливания + угол прицеливания
    const yaw = this.aimYaw + this.leadY, pitch = this.aimPitch + this.superEl + this.leadP;
    const d = _v.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    v.mesh.updateMatrixWorld(true);
    _q.copy(v.mesh.quaternion).invert();
    d.applyQuaternion(_q);
    const wantYaw = Math.atan2(-d.x, -d.z), wantEl = clamp(Math.asin(clamp(d.y, -1, 1)), EL_MIN, EL_MAX);
    const tr = TRAV * (this.mod.traverse > 0 ? 1 : 0.12) * (this.v.alive ? 1 : 0);
    const dy = wrapAngle(wantYaw - v.turretYaw);
    v.turretYaw = wrapAngle(v.turretYaw + clamp(dy, -tr * dt, tr * dt));
    const el = ELEV * (this.mod.traverse > 0 ? 1 : 0.4);
    v.gunPitch += clamp(wantEl - v.gunPitch, -el * dt, el * dt);
    this.layErr = Math.hypot(dy, wantEl - v.gunPitch);
    // ствол упёрся в предел возвышения — линия прицеливания дальше не идёт
    this.elLimited = Math.asin(clamp(d.y, -1, 1)) < EL_MIN - 0.002 || Math.asin(clamp(d.y, -1, 1)) > EL_MAX + 0.002;
  }

  // ---------- управление командиром ----------
  control(dt, mdx, mdy) {
    const m = this.m, inp = m.input, v = this.v, p = m.player;
    if (!this.ui) this.ui = new TankUI(this);
    this.ui.show(true); this.ui.update(dt);
    // выйти
    if (inp.bh('use')) { p.exitVehicle(); return; }
    // виды
    if (inp.bh('cmdSuppress') || inp.hit('KeyV')) { if (this.hatch) this.setHatch(false); const i = VIEWS.indexOf(this.view); this.view = VIEWS[(i + 1) % VIEWS.length]; m.hud.message(this.viewName(this.view), 1.5); if (this.view === 'pano' || this.view === 'driver') { this.lookYaw = this.view === 'pano' ? wrapAngle(v.turretYaw + this.cupYaw) : 0; this.lookPitch = 0; } }
    if (inp.bh('crouch')) this.setHatch(!this.hatch);
    // снаряд для следующего заряжания
    RKEYS.forEach((k, i) => { if (inp.hit('Digit' + (i + 1))) { this.sel = k; m.hud.message(`Следующий — ${ROUNDS[k].name} (${ROUNDS[k].long}). В карусели ${this.car[k]}, в укладке ${this.rack[k]}`, 2.5); m.audio.click(); } });
    // команды механику-водителю
    if (inp.hit('ArrowUp')) this.order('up');
    if (inp.hit('ArrowDown')) this.order('down');
    if (inp.hit('ArrowLeft')) this.order('left');
    if (inp.hit('ArrowRight')) this.order('right');
    if (inp.bh('jump')) this.order('stop');
    // дымовая завеса 902Б
    if (inp.hit('KeyG')) this.launchSmoke();
    // прицепить Д-30, если сдали кормой к проушине
    const towGun = m.guns && m.guns.find((h) => h.canHitch && h.canHitch(v));
    p.towHint = towGun ? `<b>H</b> — прицепить ${towGun.name}` : null;
    if (towGun && inp.hit('KeyH')) towGun.hitch(v);
    const sens = 1;
    const view = this.hatch ? 'hatch' : this.view;
    if (view === 'gunner' || view === 'tkn') {
      // линия прицеливания: командир наводит сам (дублированное управление)
      const k = view === 'gunner' ? 0.11 : 0.2;
      this.aimYaw = wrapAngle(this.aimYaw - mdx * k * sens);
      this.aimPitch = clamp(this.aimPitch - mdy * k * sens, -0.25, 0.4);
      this.cupYaw += (0 - this.cupYaw) * Math.min(1, dt * 4);
      // линию за пределами углов наводки ствола не пускаем
      if (this.elLimited) this.aimPitch -= (this.aimPitch - (Math.asin(clamp(Math.sin(v.gunPitch), -1, 1)) + (v.pitch || 0))) * Math.min(1, dt * 6);
    } else {
      const lim = view === 'driver' ? 0.6 : Math.PI;
      this.lookYaw = view === 'driver' ? clamp(this.lookYaw - mdx, -lim, lim) : wrapAngle(this.lookYaw - mdx);
      this.lookPitch = clamp(this.lookPitch - mdy, view === 'driver' ? -0.25 : -0.5, view === 'driver' ? 0.2 : 0.8);
      if (view !== 'driver') this.cupYaw = wrapAngle(this.lookYaw - v.turretYaw);
      // целеуказание: башня — на линию взгляда командира
      if (inp.hit('KeyQ') && view !== 'driver') { this.aimYaw = v.yaw + this.lookYaw; this.aimPitch = this.lookPitch; m.hud.radio('Командир', 'Наводчик, ориентир по моей линии!'); m.audio.click(); }
    }
    // лазерный дальномер
    if (inp.bh('reload')) this.rangefind();
    // огонь
    if (view === 'hatch') {
      if (inp.bd('fire')) this.fireNSVT();
    } else {
      if (inp.bh('fire')) this.fireGun();
      if (inp.bd('aim')) this.fireCoax();
    }
    // командир в люке открыт пулям
    const b = p.body;
    b.hidden = !this.hatch;
    p.yaw = view === 'gunner' || view === 'tkn' ? this.aimYaw : v.yaw + this.lookYaw;
    p.pitch = view === 'gunner' || view === 'tkn' ? this.aimPitch : this.lookPitch;
  }

  viewName(view) { return view === 'gunner' ? this.spec.sight : VIEW_NAMES[view]; }

  setHatch(on) {
    const m = this.m, v = this.v;
    if (on && Math.abs(v.speed) > 12) { m.hud.message('На такой скорости из люка не высунуться', 1.5); return; }
    this.hatch = on;
    if (on) { this.lookYaw = wrapAngle(v.turretYaw + this.cupYaw); this.lookPitch = 0; }
    m.hud.message(on ? 'Командир в люке: обзор, НСВТ (ЛКМ). C — закрыть люк' : 'Люк закрыт', 2);
    m.audio.mech('switch');
  }

  rangefind() {
    const m = this.m;
    if (this.mod.sight <= 0) { m.hud.message('Прицел-дальномер разбит', 1.5); return; }
    if (!this.gunnerOk && this.view !== 'gunner') { m.hud.message('Наводчик выбыл: дальность — по шкале ТКН-3', 1.5); return; }
    const ok = this.measure();
    this.rangeT = 3; this.fcsT = 0.6;
    m.audio.click();
    if (!ok) m.hud.message('Дальномер: нет отражения — дальность прежняя', 1.2);
  }

  fireGun(owner = null) {
    const m = this.m, v = this.v, p = m.player;
    const me = !owner || owner === p.body, say = (t, d) => { if (me) m.hud.message(t, d); };
    owner = owner || p.body;
    if (this.mod.gun <= 0) { say('Пушка повреждена!', 1.5); return false; }
    if (!this.loaded) { if (this.loading) say(`Заряжание… ${Math.max(0, this.loading.t).toFixed(1)} с`, 1); else say('Не заряжено', 1); if (me) m.audio.click(); return false; }
    if (this.layErr > 2.5 * MIL) { say('Пушка не согласована с линией прицеливания', 1); return false; }
    const key = this.loaded;
    this.loaded = null;
    const pos = new THREE.Vector3(), dir = new THREE.Vector3();
    this.muzzle(pos, dir);
    const ammoId = ROUNDS[key].id, w = WEAPONS['2a46m'];
    const pr = m.projectiles.spawn({ weapon: w, pos, dir, owner, team: v.team, ammoId });
    pr.ownerVehicle = v;
    if (m.net) m.net.onLocalShot({ weapon: w, owner, ammoId }, pr);
    this._blast(pos, dir, me);
    if (me) m.hud.radio('Командир', `Выстрел! ${ROUNDS[key].name}${this.range ? `, дальность ${this.range}` : ''}`);
    return true;
  }

  // дульная волна, откат, пыль/снег, звук (свой выстрел и чужой по сети)
  _blast(pos, dir, own) {
    const m = this.m, v = this.v;
    this.recoil = 1;
    m.fx.muzzleBlast(pos, dir);
    m.fx.muzzleBlast(pos.clone().addScaledVector(dir, 0.6), dir);
    m.fx.flashLight(pos, 120, 0.08, 0xffb050, 50);
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, s = rand(4, 12);
      const gp = pos.clone().addScaledVector(dir, -1.5); gp.y = m.terrain.heightAt(gp.x, gp.z) + 0.3;
      m.fx.smoke.emit(gp.x, gp.y, gp.z, Math.cos(a) * s + dir.x * 6, rand(0.5, 2), Math.sin(a) * s + dir.z * 6, rand(1.5, 3), 0.6, 4, 0.92, 0.93, 0.95, 0.45, 0, 2, -0.1);
    }
    m.audio.explosion(pos, 1.8);
    m.audio.shot(pos, 'rpg', own);
    if (own) m.player.shake = Math.max(m.player.shake, 1.4);
    m.noise(pos, 3500, v.team, own ? m.player.body : (v.seats[2] || null));
    v.lastShotTime = m.time; v.fireFlash = 0.1;
    // ударная волна у дула оглушает пехоту рядом (не задевает своего командира в люке)
  }

  remoteFire() {
    const pos = new THREE.Vector3(), dir = new THREE.Vector3();
    this.muzzle(pos, dir);
    this._blast(pos, dir, false);
    this.loaded = null;
  }

  fireCoax(owner = null) {
    const m = this.m, c = this.coax;
    if (c.cd > 0 || c.reload > 0) return;
    if (c.ammo <= 0) { if (c.belts > 0) { c.reload = 7; if (!owner) m.hud.message('ПКТ: новая лента', 1.5); } return; }
    owner = owner || m.player.body;
    c.ammo--; c.cd = 60 / WEAPONS.pkt.rpm;
    const g = this.v.model.gun; g.updateMatrixWorld(true);
    const pos = new THREE.Vector3(0.3, 0, -0.62).applyMatrix4(g.matrixWorld), dir = new THREE.Vector3(0, 0, -1).transformDirection(g.matrixWorld);
    m.fireProjectile({ weapon: WEAPONS.pkt, pos, dir, owner, team: this.v.team, vehicleShot: this.v });
  }

  fireNSVT() {
    const m = this.m, n = this.nsvt, p = m.player;
    if (n.cd > 0 || n.reload > 0) return;
    if (n.ammo <= 0) { if (n.boxes > 0) { n.reload = WEAPONS.nsvt.reload; m.hud.message('НСВТ: новая коробка (50)', 1.5); } return; }
    n.ammo--; n.cd = 60 / WEAPONS.nsvt.rpm;
    const pos = this.sightWorld('hatch').add(new THREE.Vector3(0, -0.25, 0));
    const dir = new THREE.Vector3(-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch));
    pos.addScaledVector(dir, 1.3);
    m.fireProjectile({ weapon: WEAPONS.nsvt, pos, dir, owner: p.body, team: p.body.team, vehicleShot: this.v });
    p.shake = Math.max(p.shake, 0.12);
  }

  launchSmoke() {
    const m = this.m, v = this.v;
    if (this.smokeCD > 0) return;
    if (this.smokes <= 0) { m.hud.message('Дымовые гранаты 902Б израсходованы', 1.5); return; }
    this.smokes -= 4; this.smokeCD = 2;
    m.hud.radio('Командир', 'Дым!');
    const base = v.yaw + v.turretYaw;
    for (let i = 0; i < 4; i++) {
      const a = base + (i - 1.5) * 0.22;
      const D = rand(200, 260);
      m.after(0.6 + i * 0.1, () => {
        const x = v.pos.x - Math.sin(a) * D, z = v.pos.z - Math.cos(a) * D;
        const p = new THREE.Vector3(x, m.terrain.heightAt(x, z) + 0.5, z);
        m.fx.explosion(p, 0.6, true);
        if (m.smokeScreens) m.smokeScreens.add(p, { dur: 45, size: 1.6, burst: true });
      });
    }
    m.audio.shot(v.pos, 'gl', true);
  }

  // ---------- попадания ----------
  // разобрать попадание снаряда/пули: зона, броня, пробитие (у стрелка), затем — урон (у хоста)
  projectileHit(p, hit, pt) {
    const m = this.m, v = this.v;
    const dir = p.v.clone().normalize();
    const Z = tankZone(v, pt, dir);
    const ex = p.ammo.explosive;
    const ce = !!(ex && ex.pen >= 150);                         // кумулятивная струя
    const [ke, he, era] = this.spec.armor[Z.zone];
    // тандемная кумулятивная БЧ: лидирующий заряд снимает динамическую защиту
    const armor = ce ? he - (ex.tandem ? era || 0 : 0) : ke;
    let pen;
    if (ex) pen = ex.pen;
    else { const sp = p.v.length(), k = sp / p.ammo.v0; pen = p.ammo.pen * (p.ammo.apfsds ? k : k * k); }
    // рикошет подкалиберного по очень наклонной поверхности
    const cosI = hit.normal ? Math.abs(dir.dot(hit.normal)) : 1;
    const ric = !ex && p.ammo.apfsds && cosI < 0.16 && Math.random() < 0.6;
    const penetrated = !ric && pen > armor;
    // следы: пробоина или отметина, искры
    v.dmg.bulletMark(pt, dir, penetrated ? 'hole' : 'scuff', Math.min(0.12, p.ammo.caliber || 0.02));
    if (ex) {
      if (p.dist >= (p.ammo.armDist || 0)) m.projectiles.explode(pt, ex, p.owner, v, null, { visual: !!p.visual });
      else m.fx.impact(pt, hit.normal || dir.clone().negate(), 'metal', 1.5);
    } else {
      m.fx.impact(pt, hit.normal || dir.clone().negate(), 'metal', p.ammo.caliber > 0.02 ? 3 : 1);
      if (pt.distanceTo(m.camPos) < 120) m.audio.impact(pt, 'metal');
      if (p.ammo.caliber >= 0.02 || p.ammo.apfsds) { m.fx.flashLight(pt, 60, 0.06, 0xffd080, 20); m.audio.explosion(pt, 0.6); }
    }
    if (p.byPlayer) m.stats.hits++;
    if (p.visual) return;
    // крупные осколки/ОФ по ходовой — гусеница
    const big = (ex && ex.dmg >= 200) || (!ex && (p.ammo.caliber || 0) >= 0.02);
    const res = { zone: Z.zone, pen: Math.round(pen), armor, ce, lp: [+Z.lp.x.toFixed(2), +Z.lp.y.toFixed(2), +Z.lp.z.toFixed(2)], big, mass: p.ammo.mass, ric };
    if (m.net && !m.net.isHost) { if (p.owner === m.player.body) m.net.evHost(['tkh', m.vehicles.indexOf(v), res]); }
    else this.applyHit(res, p.owner);
    // доклад стрелку по своему попаданию
    if (p.owner === m.player.body && p.byPlayer && pen > 100) m.hud.message(penetrated ? `Пробитие: ${ZONE_NAMES[Z.zone]} (${Math.round(pen)} > ${armor} мм)` : ric ? 'Рикошет!' : `Не пробил: ${ZONE_NAMES[Z.zone]} (${Math.round(pen)} < ${armor} мм)`, 2);
  }

  // урон по результату (хост / одиночная игра)
  applyHit(r, owner) {
    const m = this.m, v = this.v;
    if (!v.alive) return;
    if (this.ai) this.ai.onHit(owner);
    const lp = new THREE.Vector3(...r.lp);
    const mine = this._mine();
    // ходовая: гусеница
    if (r.zone === 'hullSideLow' && (r.big || r.pen > 60) && Math.random() < (r.big ? 0.75 : 0.25)) v.dmg.setBit(24 + (lp.x < 0 ? 0 : 1));
    if (r.big && (r.zone === 'hullLower' || r.zone === 'hullSideLow') && Math.random() < 0.3) v.dmg.setBit(24 + (lp.x < 0 ? 0 : 1));
    if (r.ric || r.pen <= r.armor) {
      // непробитие: удар крупного снаряда оглушает экипаж, ОФ может разбить приборы
      if (r.big) {
        for (const s of [this.driver, this.gunner, this.commander]) if (s && s.alive) s.shockT = Math.max(s.shockT || 0, 1.5);
        if (mine && r.pen > 200) m.onPlayerConcussion && m.onPlayerConcussion(0.35, 2.5);
        if (r.zone.startsWith('turret') && Math.random() < 0.15) this.breakModule('sight', 'Прицел наводчика разбит!');
      }
      return;
    }
    // заброневое действие: тем сильнее, чем больше запас пробития
    const k = clamp(0.45 + (r.pen - r.armor) / 250, 0.45, 1.6) * (r.ce ? 0.9 : 1.15);
    const turret = r.zone.startsWith('turret');
    const crewHit = (s, ch) => { if (s && s.alive && Math.random() < ch * k) s.damage(rand(35, 120) * k, Math.random() < 0.25 ? 'head' : 'torso', owner, null, { raw: true }); };
    if (turret) {
      crewHit(this.gunner, 0.55); crewHit(this.commander, 0.5);
      if (Math.random() < 0.35 * k) this.breakModule('gun', 'Пушка повреждена!');
      if (Math.random() < 0.3 * k) this.breakModule('sight', 'Прицел наводчика выведен из строя!');
      if (Math.random() < 0.25 * k) this.breakModule('traverse', 'Привод башни повреждён — ручной поворот!');
      if (Math.random() < 0.1 * k && this.rack.bm + this.rack.bk + this.rack.of > 0) this.catastrophic(owner);
    } else if (lp.z > 1.25) {
      // МТО: двигатель, пожар
      if (Math.random() < 0.7 * k) this.breakModule('engine', 'Двигатель поражён! Танк обездвижен');
      if (Math.random() < 0.45 * k && !this.fire) { this.fire = 0.01; this.extT = 1.5; }
    } else {
      // отделение управления и боевое: механик, наводчик, карусель АЗ под полом, баки-стеллажи
      if (lp.z < -1.3) crewHit(this.driver, 0.7);
      else if (lp.z < 0.9) { crewHit(this.gunner, 0.45); crewHit(this.commander, 0.4); }
      const low = lp.y < 0.95;
      const carousel = this.car.bm + this.car.bk + this.car.of;
      if (low && carousel > 0 && Math.random() < 0.5 * k) { this.catastrophic(owner); return; }
      if (Math.random() < 0.18 * k && this.rack.bm + this.rack.bk + this.rack.of > 0) { this.catastrophic(owner); return; }
      if (Math.random() < 0.3 * k) this.breakModule('autoloader', 'Автомат заряжания повреждён — заряжать вручную!');
      if (Math.random() < 0.2 * k && !this.fire) { this.fire = 0.01; this.extT = 1.5; }
    }
    // экипаж выбит — танк небоеспособен
    if (!this.driver.alive && !this.gunner.alive && !(this.commander && this.commander.alive)) this.knockOut(owner);
  }

  breakModule(k, msg) {
    if (this.mod[k] <= 0) return;
    this.mod[k] = 0;
    if (k === 'engine') { this.v.speedK = 0.0001; }
    if (this._mine()) { this.m.hud.radio(k === 'engine' ? 'Мехвод' : 'Наводчик', msg, true); this.m.audio.mech('switch'); }
  }

  // взрыв боекомплекта: башню срывает, экипаж гибнет
  catastrophic(by) {
    const m = this.m, v = this.v;
    if (!v.alive) return;
    this.car = { bm: 0, bk: 0, of: 0 }; this.rack = { bm: 0, bk: 0, of: 0 };
    for (const s of [this.driver, this.gunner, this.commander]) if (s && s.alive) s.damage(500, 'torso', by, null, { raw: true });
    v.destroy(by);
    const P = v.pos.clone().add(new THREE.Vector3(0, 1.6, 0));
    m.fx.shellBurst(P); m.audio.explosion(P, 3.2);
    m.fx.addFire(P.clone(), 2.6, 260);
    for (let k = 1; k <= 5; k++) m.after(0.25 * k + Math.random() * 0.4, () => { m.fx.explosion(P.clone().add(new THREE.Vector3(rand(-1, 1), rand(0, 2), rand(-1, 1))), 1.6, false); m.audio.explosion(P, 1.4); });
  }

  // небоеспособен (экипаж выбит): стоит, без взрыва
  knockOut(by) {
    const m = this.m, v = this.v;
    if (this.knocked || !v.alive) return;
    this.knocked = true;
    v.controls.throttle = 0; v.controls.brake = 1;
    if (m.onVehicleDestroyed) m.onVehicleDestroyed(v, by);
  }

  // разрыв рядом (не прямое попадание): ходовая, приборы, оглушение экипажа
  blast(ex, d, owner, pos) {
    const v = this.v;
    if (pos) v.dmg.onBlast(pos, ex);
    if (ex.dmg >= 300 && d < ex.radius * 0.4) {
      for (const s of [this.driver, this.gunner]) if (s.alive) s.shockT = Math.max(s.shockT || 0, 1);
      if (Math.random() < 0.08) this.breakModule('sight', 'Прицел наводчика разбит осколками!');
    }
    void owner;
  }

  // ---------- сеть ----------
  // состояние повреждений (у хоста): экипаж, модули, пожар
  netState() {
    const M = this.mod;
    return [this.driver.alive ? 1 : 0, this.gunner.alive ? 1 : 0, M.engine, M.gun, M.sight, M.traverse, M.autoloader, this.fire > 0 ? 1 : 0, this.knocked ? 1 : 0, this.cmdr ? (this.cmdr.alive ? 1 : 0) : 1];
  }
  applyNet(a) {
    if (!Array.isArray(a)) return;
    if (!a[0] && this.driver.alive) { this.driver.alive = false; this.driver.health = 0; }
    if (!a[1] && this.gunner.alive) { this.gunner.alive = false; this.gunner.health = 0; }
    const ks = ['engine', 'gun', 'sight', 'traverse', 'autoloader'];
    ks.forEach((k, i) => { if (a[2 + i] === 0 && this.mod[k] > 0) this.breakModule(k, { engine: 'Двигатель поражён!', gun: 'Пушка повреждена!', sight: 'Прицел разбит!', traverse: 'Привод башни повреждён!', autoloader: 'АЗ повреждён!' }[k]); });
    if (a[7] && !this.fire) { this.fire = 0.01; this.extT = 99; } else if (!a[7] && this.fire) this.fire = 0;
    if (a[8]) this.knocked = true;
    if (a[9] === 0 && this.cmdr && this.cmdr.alive) { this.cmdr.alive = false; this.cmdr.health = 0; }
  }

  // командир: в люке — по пояс над башенкой (его можно ранить), иначе внутри
  placeCommander(s) {
    const v = this.v;
    if (this.hatch) {
      const e = this.sightWorld('hatch');
      s.pos.set(e.x, e.y - s.eyeHeight(), e.z);
      s.stance = 'stand';
    } else s.pos.set(v.pos.x, v.pos.y + 0.6, v.pos.z);
    s.vel.copy(v.vel);
  }

  dispose() { if (this.ui) this.ui.dispose(); }

  // камера (только изнутри; люк — голова над башенкой)
  camera(cam) {
    const v = this.v, view = this.hatch ? 'hatch' : this.view;
    const pos = this.sightWorld(view);
    cam.position.copy(pos);
    let yaw, pitch, fov;
    if (view === 'gunner') { yaw = v.yaw + v.turretYaw; pitch = this.aimPitch; fov = 9; }
    else if (view === 'tkn') { yaw = v.yaw + v.turretYaw + this.cupYaw; pitch = this.aimPitch; fov = 10; }
    else if (view === 'driver') {
      _e.set(this.lookPitch, this.lookYaw, 0, 'YXZ'); _q.setFromEuler(_e);
      cam.quaternion.copy(v.mesh.quaternion).multiply(_q);
      return 62;
    } else { yaw = v.yaw + this.lookYaw; pitch = this.lookPitch; fov = view === 'pano' ? 70 : this.m.settings.fov; }
    if (this.mod.sight <= 0 && view === 'gunner') fov = 9;
    cam.quaternion.setFromEuler(_e.set(pitch, yaw, 0, 'YXZ'));
    return fov;
  }
}

// ---------- экипаж ИИ: танк противника ----------
// Обнаружение: цель должна быть в поле зрения приборов и на прямой видимости некоторое время
// (технику видно быстрее, пехоту — дольше, лежачую — ещё дольше). Командир выбирает самую
// опасную цель (танк, затем техника, гранатомётчик, пехота), даёт наводчику время на захват;
// наводчик наводит с небольшой ошибкой, дальность и угол прицеливания вводит СУО. Снаряд по
// цели: по танку — подкалиберный, по лёгкой технике и пехоте — осколочно-фугасный, по пехоте
// вблизи — спаренный ПКТ. На маршруте при обнаружении — «короткая»: стоп и огонь.
class TankAI {
  constructor(t, { hold = false, skill = 0.6 } = {}) {
    this.t = t; this.m = t.m;
    this.hold = hold; this.skill = skill;
    this.target = null; this.seen = new Map();
    this.scanT = rand(0, 0.5); this.react = 0; this.sweep = Math.random() * 6;
    this.errY = 0; this.errP = 0; this.lastSeen = -99; this.burst = 0; this.home = t.v.yaw;
  }

  aimPoint(tg, out = new THREE.Vector3()) {
    if (tg.isVehicle) return out.set(tg.pos.x, tg.pos.y + (tg.tank ? 1.25 : tg.type.height * 0.55), tg.pos.z);
    return out.copy(tg.chest || tg.pos);
  }

  onHit(owner) {
    // по танку стреляют: развернуть башню к стрелку, быстрый захват
    if (!owner) return;
    const tg = owner.vehicle && owner.vehicle.alive ? owner.vehicle : owner;
    if (tg.team === this.t.v.team || tg.alive === false) return;
    this.seen.set(tg, 5);
    if (this.target !== tg) { this.target = tg; this.react = rand(1.2, 2.2); }
    this.lastSeen = this.m.time;
  }

  _pick() {
    const t = this.t, v = t.v, m = this.m;
    const S = t.sightWorld('gunner');
    const vr = clamp((m.visibility || 800) * (m.isNight ? 1.6 : 2.2), 350, 2400);
    let best = null, bs = 0;
    const P = new THREE.Vector3();
    for (const tg of m.targetsFor(v.team)) {
      if (tg.isDrone || tg.alive === false) continue;
      this.aimPoint(tg, P);
      const d = P.distanceTo(S);
      if (d > vr) { this.seen.delete(tg); continue; }
      // поле зрения: по ходу башни и корпуса шире, сзади — плохо (перископы командира)
      const ang = Math.abs(wrapAngle(Math.atan2(-(P.x - S.x), -(P.z - S.z)) - (v.yaw + v.turretYaw)));
      const fov = ang < 0.6 ? 1 : ang < 1.6 ? 0.55 : 0.25;
      const vis = m.world.los(S, P, tg.isVehicle ? tg : tg.vehicle || null, v);
      if (!vis) { this.seen.set(tg, Math.max(0, (this.seen.get(tg) || 0) - 0.25)); continue; }
      const flash = tg.lastShotTime !== undefined && m.time - tg.lastShotTime < 1 ? 3 : 1;
      let base;
      if (tg.isVehicle) base = 1.0 * clamp(1000 / d, 0.25, 2);
      else {
        // одиночного бойца в маскхалате из танка заметить трудно: дальше — дольше, лёжа — ещё дольше
        const stance = tg.stance === 'prone' ? 0.35 : tg.stance === 'crouch' ? 0.65 : 1;
        const mv = tg.vel && Math.hypot(tg.vel.x, tg.vel.z) > 1 ? 1.5 : 1;
        base = clamp(180 / d, 0.06, 1.5) * stance * mv * (tg.team === 'negs' ? 0.7 : 1);
      }
      const rate = 0.5 * fov * flash * base * (0.6 + this.skill) * (t.cmdr && t.cmdr.alive ? 1 : 0.5);
      const sv = Math.min(6, (this.seen.get(tg) || 0) + rate);
      this.seen.set(tg, sv);
      if (sv < 1) continue;
      const threat = tg.tank ? 6 : tg.isVehicle ? 3 : tg.secondary && (tg.secondary.id === 'rpg7') ? 2.2 : tg.isPlayer ? 1.4 : 1;
      const sc = threat * 1000 / (d + 150) + (tg === this.target ? 1.5 : 0);
      if (sc > bs) { bs = sc; best = tg; }
    }
    // новая цель: доклад командира, целеуказание, захват наводчиком — несколько секунд
    if (best && best !== this.target) { this.react = rand(3.5, 6.5) * (1.3 - this.skill * 0.5); }
    this.target = best;
    if (best) this.lastSeen = m.time;
  }

  update(dt) {
    const t = this.t, v = t.v, m = this.m;
    if (!t.gunner.alive && !(t.cmdr && t.cmdr.alive)) { this.target = null; return; }
    this.scanT -= dt;
    if (this.scanT <= 0) { this.scanT = 0.5; this._pick(); }
    const tg = this.target;
    // на маршруте: увидели противника — стоп («короткая»), потеряли надолго — дальше
    if (v.ai) v.ai.alerted = m.time - this.lastSeen < 14;
    if (!tg || tg.alive === false) {
      this.target = null;
      // поиск: башня медленно ходит по сектору вокруг направления движения/обороны
      this.sweep += dt * 0.22;
      const base = this.hold ? this.home : v.yaw;
      t.aimYaw = wrapAngle(base + Math.sin(this.sweep) * 0.95);
      t.aimPitch += (0.0 - t.aimPitch) * Math.min(1, dt);
      return;
    }
    const S = t.sightWorld('gunner'), P = this.aimPoint(tg);
    const dx = P.x - S.x, dz = P.z - S.z, D = Math.hypot(dx, dz);
    // ошибка наводки: медленный дрейф, к выстрелу наводчик её выбирает
    const sig = (0.25 + D / 1000 * 0.18) * MIL * (1.5 - this.skill) * (t.gunner.alive ? 1 : 1.8);
    const k = Math.min(1, dt * 0.7);
    this.errY += (randn() * sig - this.errY) * k; this.errP += (randn() * sig * 0.7 - this.errP) * k;
    t.aimYaw = Math.atan2(-dx, -dz) + this.errY;
    t.aimPitch = Math.atan2(P.y - S.y, D) + this.errP;
    // снаряд для следующего заряжания
    const want = tg.tank ? 'bm' : tg.isVehicle ? (tg.type.armor.front > 8 ? 'bk' : 'of') : 'of';
    t.sel = (t.car[want] + t.rack[want] > 0) ? want : t.sel;
    this.react -= dt;
    if (this.react > 0) return;
    const owner = t.cmdr && t.cmdr.alive ? t.cmdr : t.gunner;
    // пехота вблизи — очередями из ПКТ
    if (!tg.isVehicle && D < 550 && t.layErr < 4 * MIL) {
      this.burst -= dt;
      if (this.burst < -1.2) this.burst = rand(0.6, 1.4);
      if (this.burst > 0) t.fireCoax(owner);
      if (D < 220 || t.loaded !== 'of') return;
    }
    // пушка: заряжено, ствол согласован, дальномер «видит» цель
    const onTarget = t.range > 0 && Math.abs(t.range - D) < Math.max(30, D * 0.06);
    if (t.loaded && t.layErr < 0.8 * MIL && onTarget) {
      if (t.fireGun(owner)) this.react = rand(0.8, 1.8);
    }
  }
}

// ---------- интерфейс: прицелы, панель, подсказки ----------
class TankUI {
  constructor(t) {
    this.t = t; this.m = t.m;
    const root = this.m.hud.root;
    this.ret = document.createElement('canvas'); this.ret.className = 'gunret';
    this.panel = document.createElement('div'); this.panel.className = 'gunpanel tankpanel';
    root.appendChild(this.ret); root.appendChild(this.panel);
    this.acc = 1;
  }
  show(on) { this.panel.style.display = on ? 'block' : 'none'; this.ret.style.display = on ? 'block' : 'none'; this.m.hud.root.classList.toggle('gunner', on); }
  dispose() { this.ret.remove(); this.panel.remove(); }

  update(dt) {
    const t = this.t;
    this.draw();
    this.acc += dt;
    if (this.acc < 0.15) return;
    this.acc = 0;
    const v = t.v;
    const kmh = Math.round(v.speed * 3.6);
    const st = (s) => (s.alive ? (s.health < 60 ? '<span class="warn">ранен</span>' : 'в строю') : '<span class="bad">выбыл</span>');
    const md = (k, n) => (t.mod[k] > 0 ? '' : `<span class="bad">${n}</span> `);
    const tr = v.model.tracks.sides.map((s) => (s.broken ? '<span class="bad">разбита</span>' : 'цела'));
    const ld = t.loaded ? `<b class="ok">${ROUNDS[t.loaded].name} — ГОТОВ</b>` : t.loading ? `заряжание ${ROUNDS[t.loading.key].name}${t.loading.manual ? ' (вручную)' : ''} ${Math.max(0, t.loading.t).toFixed(1)} с` : '<span class="warn">не заряжено</span>';
    this.panel.innerHTML = `
      <div class="gt">${t.spec.name} · командир · ${t.viewName(t.hatch ? 'hatch' : t.view)}</div>
      <div class="gr"><span>Пушка 2А46М</span>${ld}</div>
      <div class="gr"><span>Следующий (1–3)</span><b>${ROUNDS[t.sel].name}</b></div>
      <div class="gr"><span>Карусель АЗ</span><b>БР ${t.car.bm} · КС ${t.car.bk} · ОФ ${t.car.of}</b></div>
      <div class="gr"><span>Укладка</span><b>БР ${t.rack.bm} · КС ${t.rack.bk} · ОФ ${t.rack.of}</b></div>
      <div class="gr"><span>Дальность (СУО ${t.spec.fcs})</span><b>${t.range ? t.range + ' м · авто' : '—'}</b></div>
      ${t.spec.lead ? `<div class="gr"><span>Упреждение</span><b>${(t.leadY / MIL).toFixed(1)} тыс.</b></div>` : ''}
      <div class="gr"><span>ПКТ / НСВТ</span><b>${t.coax.ammo}+${t.coax.belts}×250 · ${t.nsvt.ammo}+${t.nsvt.boxes}×50</b></div>
      <div class="gr"><span>902Б «Туча» (G)</span><b>${t.smokes}</b></div>
      <hr>
      <div class="gr big"><span>Скорость</span><b>${kmh} км/ч</b></div>
      <div class="gr"><span>Команда мехводу</span><b>${GEAR_NAMES[t.gear + 1]}${t.steer ? (t.steer < 0 ? ', влево' : ', вправо') + (Math.abs(t.steer) > 1 ? ' круто' : '') : ''}</b></div>
      <div class="gr"><span>Мехвод · наводчик</span><b>${st(t.driver)} · ${st(t.gunner)}</b></div>
      <div class="gr"><span>Гусеницы Л/П</span><b>${tr[0]} / ${tr[1]}</b></div>
      ${Object.values(t.mod).some((x) => x <= 0) || t.fire ? `<div class="gr"><span>Повреждения</span><b>${md('engine', 'двигатель')}${md('gun', 'пушка')}${md('sight', 'прицел')}${md('traverse', 'привод башни')}${md('autoloader', 'АЗ')}${t.fire ? '<span class="bad">ПОЖАР</span>' : ''}</b></div>` : ''}
      <hr>
      <div class="gk">Мышь — наводка (в прицелах) / обзор · ЛКМ — пушка · ПКМ — ПКТ · дальность и угол прицеливания — сами (R — замер сейчас) · 1–3 — снаряд<br>
      ↑ ↓ — вперёд/назад, быстрее/тише · ← → — левее/правее · Пробел — «Стой!» (мехвод выполняет с задержкой)<br>
      V — прицел наводчика / ТКН-3 / панорама / мехвод · Q — целеуказание по взгляду · C — люк (НСВТ) · G — дым · H — прицепить Д-30 · E — выйти</div>`;
  }

  draw() {
    const t = this.t, c = this.ret, m = this.m;
    const W = innerWidth, H = innerHeight;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = c.getContext('2d');
    g.clearRect(0, 0, W, H);
    const view = t.hatch ? 'hatch' : t.view;
    const cx = W / 2, cy = H / 2;
    if (view === 'hatch') return;
    if (view === 'pano' || view === 'driver') {
      // приборы наблюдения: узкие окна в темноте
      g.fillStyle = 'rgba(6,8,10,0.94)';
      g.beginPath(); g.rect(0, 0, W, H);
      if (view === 'pano') {
        const w = W * 0.22, h = H * 0.16;
        for (let i = -2; i <= 2; i++) { const x = cx + i * (w + W * 0.03) - w / 2, y = cy - h / 2 + Math.abs(i) * H * 0.03; g.moveTo(x, y); g.lineTo(x + w, y); g.lineTo(x + w * 0.96, y + h); g.lineTo(x + w * 0.04, y + h); g.closePath(); }
      } else { const w = W * 0.8, h = H * 0.3; g.moveTo(cx - w / 2, cy - h / 2); g.lineTo(cx + w / 2, cy - h / 2); g.lineTo(cx + w / 2 - 30, cy + h / 2); g.lineTo(cx - w / 2 + 30, cy + h / 2); g.closePath(); }
      g.fill('evenodd');
      g.fillStyle = '#c8d0b8'; g.font = '13px monospace'; g.textAlign = 'center';
      if (view === 'pano') {
        // азимут взгляда относительно корпуса и ствола
        const rel = Math.round(((((t.lookYaw) / MIL) % 6000) + 6000) % 6000);
        const tur = Math.round(((((t.v.turretYaw) / MIL) % 6000) + 6000) % 6000);
        g.fillText(`взгляд ${String(Math.floor(rel / 100)).padStart(2, '0')}-${String(rel % 100).padStart(2, '0')} · башня ${String(Math.floor(tur / 100)).padStart(2, '0')}-${String(tur % 100).padStart(2, '0')} · Q — целеуказание`, cx, H * 0.8);
      } else g.fillText(`${Math.round(t.v.speed * 3.6)} км/ч · ${GEAR_NAMES[t.gear + 1]}`, cx, H * 0.75);
      return;
    }
    // окуляр
    const R = Math.min(W, H) * 0.47;
    g.save();
    g.fillStyle = '#050607';
    g.beginPath(); g.rect(0, 0, W, H); g.arc(cx, cy, R, 0, Math.PI * 2, true); g.fill();
    if (t.mod.sight <= 0 && view === 'gunner') {
      // разбитый прицел: трещины, муть
      g.fillStyle = 'rgba(20,24,20,0.82)'; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(220,230,220,0.6)'; g.lineWidth = 1.2;
      for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(cx + Math.cos(i) * 20, cy + Math.sin(i * 1.7) * 20); g.lineTo(cx + Math.cos(i * 2.1) * R, cy + Math.sin(i * 1.3) * R); g.stroke(); }
      g.restore(); return;
    }
    const col = view === 'gunner' ? '#ff6a3a' : '#1a1a1a';
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1.6;
    const fov = view === 'gunner' ? 9 : 10;
    const pxPerMil = (H / 2) / Math.tan((fov / 2) * Math.PI / 180) * MIL;
    if (view === 'gunner') {
      // 1А40-1: угольник, боковые шкалы упреждения, шкала дальномера, табло
      g.beginPath(); g.moveTo(cx - 18, cy + 22); g.lineTo(cx, cy); g.lineTo(cx + 18, cy + 22); g.stroke();
      for (const s of [-1, 1]) {
        g.beginPath(); g.moveTo(cx + s * 30, cy); g.lineTo(cx + s * R * 0.6, cy); g.stroke();
        for (let k = 1; k <= 8; k++) { const x = cx + s * k * 4 * pxPerMil; if (Math.abs(x - cx) < 30) continue; g.beginPath(); g.moveTo(x, cy); g.lineTo(x, cy + (k % 2 ? 6 : 12)); g.stroke(); }
      }
      g.beginPath(); g.moveTo(cx, cy + 40); g.lineTo(cx, cy + R * 0.5); g.stroke();
      // табло дальности и готовности (внизу поля зрения)
      g.font = 'bold 20px monospace'; g.textAlign = 'center';
      g.fillText(t.range ? String(t.range).padStart(4, '0') : '----', cx, cy + R * 0.72);
      g.font = '13px monospace';
      g.fillText(`${t.loaded ? ROUNDS[t.loaded].lamp : '  '}   ${t.loaded && t.layErr < 2.5 * MIL ? 'ГОТОВ' : t.loading ? 'ЗАР' : ''}`, cx, cy + R * 0.82);
      if (t.rangeT > 0) { t.rangeT -= 1 / 60; g.beginPath(); g.arc(cx, cy, 3, 0, Math.PI * 2); g.fill(); }
      // пушка не согласована — метка ствола
      if (t.layErr > 1.2 * MIL) { g.font = '12px monospace'; g.fillText('СОГЛАСОВАНИЕ', cx, cy - R * 0.62); }
    } else {
      // ТКН-3: перекрестие и дальномерная шкала (цель высотой 2,7 м)
      g.beginPath(); g.moveTo(cx - R * 0.7, cy); g.lineTo(cx - 12, cy); g.moveTo(cx + 12, cy); g.lineTo(cx + R * 0.7, cy); g.moveTo(cx, cy + 12); g.lineTo(cx, cy + R * 0.7); g.stroke();
      g.font = '11px monospace'; g.textAlign = 'left';
      [400, 600, 800, 1000, 1500, 2000].forEach((D, i) => {
        const h = (2.7 / D) * 1000 * pxPerMil, x = cx - R * 0.62 + i * 26;
        g.beginPath(); g.moveTo(x, cy - 40 - h); g.lineTo(x, cy - 40); g.stroke();
        g.fillText(String(D / 100), x + 2, cy - 44 - h);
      });
      g.textAlign = 'center'; g.font = '13px monospace';
      g.fillText(`${t.loaded ? ROUNDS[t.loaded].name + ' готов' : 'заряжание'} · Д ${t.range || '—'}`, cx, cy + R * 0.82);
    }
    g.restore();
    void m;
  }
}
