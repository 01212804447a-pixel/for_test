// Техника: бронеавтомобиль «Тигр», ВАЗ-2121 «Нива», МТ-ЛБ.
// Простая, но «честная» динамика: сцепление со снегом, уклоны, подвеска по 4 точкам,
// столкновения (OBB), бронирование по проекциям, турели, места десанта.
import * as THREE from 'three';
import { buildTigr, buildNiva, buildMTLB } from './vehicleModels.js';
import { buildT72 } from './t72Model.js';
import { Tank, tankZone as tankZoneOf, T72_ARMOR as TANK_ARMOR } from './tank.js';
import { blobShadow } from '../world/flora.js';
import { WEAPONS } from '../data/weapons.js';
import { clamp, rand, randn, wrapAngle } from '../core/math.js';
import { solverFor } from './soldier.js';
import { VehicleDamage } from './vehicleDamage.js';

const _tc = new THREE.Vector3();

// Грунт под машиной (маска рельефа: 0 снег, 1 накатанная дорога, 2 лёд, 3 берег/наст).
// μ — коэффициент сцепления, crr — сопротивление качению; crrTow — для колёс прицепа.
const SURF = {
  wheel: [{ mu: 0.38, crr: 0.05 }, { mu: 0.48, crr: 0.025 }, { mu: 0.13, crr: 0.015 }, { mu: 0.34, crr: 0.065 }],
  track: [{ mu: 0.62, crr: 0.07 }, { mu: 0.68, crr: 0.05 }, { mu: 0.26, crr: 0.035 }, { mu: 0.56, crr: 0.08 }],
  tow: [0.06, 0.03, 0.015, 0.075],
};

export const VEHICLE_TYPES = {
  tigr: {
    id: 'tigr', name: 'ГАЗ-233014 «Тигр»', cls: 'Бронеавтомобиль', len: 5.7, width: 2.4, height: 2.4,
    wheelbase: 3.3, track: 1.84, wheelR: 0.56, maxSpeed: 23, brake: 7, steerMax: 0.55, grip: 3.4,
    mass: 7400, power: 158, eta: 0.8, cda: 3.0, tyre: 1.1, // ЯМЗ-534 215 л. с., полная масса 7,4 т
    seats: 9, gun: 'pkp_mount', gunExposed: true, armor: { front: 7, side: 6, top: 3 }, hp: 300,
    engine: 'diesel', camo: ['#e7eaed', '#b6bdc4', '#8e979e'],
    susp: { droop: 0.15, comp: 0.17, zeta: 0.38, hcg: 0.95 }, hitch: 3.05,
    desc: 'Бронированный автомобиль повышенной проходимости. Защита от 5,45 и 7,62×39. Турель с ПКП, 9 мест.',
  },
  niva: {
    id: 'niva', name: 'ВАЗ-2121 «Нива»', cls: 'Лёгкий внедорожник', len: 3.74, width: 1.68, height: 1.64,
    wheelbase: 2.2, track: 1.4, wheelR: 0.34, maxSpeed: 27, brake: 7.5, steerMax: 0.62, grip: 2.8,
    mass: 1450, power: 59, eta: 0.82, cda: 1.35, tyre: 1.0, // ВАЗ-2121: 80 л. с., 1,15 т + экипаж
    seats: 4, gun: null, armor: { front: 1, side: 0.8, top: 0.6 }, hp: 120,
    engine: 'car', camo: ['#3e4d33', '#34422b', '#4a5a3d'],
    susp: { droop: 0.13, comp: 0.14, zeta: 0.34, hcg: 0.62 }, hitch: 2.0,
    desc: 'Быстрая и манёвренная, но не защищена: кузов пробивается любой пулей. 4 места.',
  },
  mtlb: {
    id: 'mtlb', name: 'МТ-ЛБ', cls: 'Многоцелевой тягач (гусеничный)', len: 6.45, width: 2.85, height: 1.87,
    wheelbase: 4.6, track: 2.4, wheelR: 0.3, maxSpeed: 16.5, brake: 6, turnRate: 0.85, grip: 7,
    mass: 11900, power: 176, eta: 0.66, cda: 5.0, // ЯМЗ-238В 240 л. с., боевая масса 11,9 т, крюк до 6,5 т
    tracked: true, seats: 13, gun: 'pkt', turret: true, armor: { front: 11, side: 7, top: 5 }, hp: 460,
    engine: 'tracked', camo: ['#55613f', '#dde1e3', '#3e4a31'],
    susp: { droop: 0.08, comp: 0.13, zeta: 0.55, hcg: 0.8 }, hitch: 3.35,
    desc: 'Гусеничный бронетранспортёр-тягач. Отличная проходимость по глубокому снегу, башня с ПКТ и прицелом ПП-61АМ, 11 мест десанта.',
  },
  // Т-72Б (1985): боевая масса 44,5 т, В-84-1 840 л. с. (618 кВт), 60 км/ч по шоссе, назад 4 км/ч,
  // длина корпуса 6,86 м, ширина 3,59 м, высота 2,19 м, колея 2,79 м, гусеница 580 мм
  t72b: {
    id: 't72b', name: 'Т-72Б', cls: 'Основной боевой танк', len: 6.86, width: 3.46, height: 2.19,
    wheelbase: 4.3, track: 2.79, wheelR: 0.375, maxSpeed: 60 / 3.6, reverse: 4 / 3.6, brake: 5, turnRate: 0.36, grip: 8,
    mass: 44500, power: 618, eta: 0.68, cda: 7.0,
    tracked: true, tank: true, seats: 3, troop: 1, ctrlSeat: 2, gun: '2a46m', turret: true,
    armor: { front: 520, side: 80, top: 40 }, hp: 1500,
    engine: 'tracked', camo: ['#56603f', '#e2e5e7', '#3c4630'],
    susp: { droop: 0.1, comp: 0.16, zeta: 0.6, hcg: 1.05 }, hitch: 3.6,
    desc: 'Экипаж 3: вы — командир, наводчик и мехвод — ИИ. 125-мм 2А46М с АЗ (22 в карусели), СУО 1А40-1 с дальномером, ДЗ «Контакт-1». Только виды изнутри: прицелы, приборы, люк. Командам мехводу (стрелки) нужна секунда. Может тянуть Д-30.',
  },
};

function buildModel(type) {
  const T = VEHICLE_TYPES[type];
  return type === 'tigr' ? buildTigr(T.camo) : type === 'niva' ? buildNiva(T.camo) : type === 't72b' ? buildT72(T.camo) : buildMTLB(T.camo);
}

export class Vehicle {
  constructor(game, type, { x, z, yaw = 0, team = 'negs' } = {}) {
    this.game = game;
    this.type = VEHICLE_TYPES[type];
    this.typeId = type;
    this.isVehicle = true;
    this.team = team;
    this.alive = true;
    this.hp = this.type.hp;
    this.pos = new THREE.Vector3(x, game.world.terrain.heightAt(x, z), z);
    this.vel = new THREE.Vector3();
    this.yaw = yaw; this.speed = 0; this.steer = 0; this.pitch = 0; this.roll = 0;
    this.yVel = 0; this.pVel = 0; this.rVel = 0; this.contact = 1; this.airT = 0; this._settle = true;
    const mdl = buildModel(type);
    this.model = mdl;
    this.mesh = mdl.group;
    game.scene.add(this.mesh);
    this.blob = blobShadow(this.type.width * 1.5, this.type.len * 1.25, 0.6);
    game.scene.add(this.blob);
    this.seats = [];
    for (let i = 0; i < this.type.seats; i++) this.seats.push(null);
    this.turretYaw = 0; this.gunPitch = 0;
    this.gunWeapon = this.type.gun ? WEAPONS[this.type.gun] : null;
    this.gunAmmo = this.gunWeapon ? this.gunWeapon.mag : 0;
    this.gunMags = this.gunWeapon ? this.gunWeapon.mags : 0;
    this.gunCooldown = 0; this.gunReload = 0;
    this.shotsFired = 0;
    this.lastShotTime = -9;
    this.fireFlash = 0;
    this.stance = 'stand';
    this.eye = new THREE.Vector3(); this.chest = new THREE.Vector3();
    const T = this.type;
    this.collider = { kind: 0, x, z, y0: 0, y1: 0, hx: T.width / 2, hz: T.len / 2, cos: 1, sin: 0, yaw, mat: 'metal', blocksMove: true, blocksBullet: true, blocksSight: true, owner: this, pen: 0, minX: 0, maxX: 0, minZ: 0, maxZ: 0, stamp: 0 };
    this.engine = null;
    this.controls = { throttle: 0, steer: 0, brake: 0 };
    this.ai = null; // { route, idx, speed, stopped }
    this.burnT = 0;
    this.wheelRot = 0;
    this.dmg = new VehicleDamage(this);
    this._updateCollider();
    this.tank = this.type.tank ? new Tank(this) : null;
  }

  get driver() { return this.seats[0]; }
  get gunner() { return this.gunWeapon ? this.seats[1] : null; }
  get turret() { return !!this.model.turret; }
  get crewTeam() { const o = this.seats.find((s) => s && s.alive); return o ? o.team : null; }

  hasFreeSeat() { if (this.tank) return false; return this.alive && this.seats.some((s, i) => !s && i >= 2) || (this.alive && !this.gunWeapon && this.seats.some((s, i) => !s && i >= 1)); }

  board(s, seatIdx = -1) {
    if (!this.alive) return false;
    if (this.tank && seatIdx < 0) return false; // в танк — только экипаж и командир-игрок
    let idx = seatIdx;
    if (idx < 0) idx = this.seats.findIndex((x, i) => !x && i >= (this.gunWeapon ? 2 : 1));
    if (idx < 0 || this.seats[idx]) return false;
    this.seats[idx] = s;
    s.vehicle = this; s.seat = idx;
    s.hidden = !(idx === 1 && this.type.gunExposed);
    s.vel.set(0, 0, 0);
    if (s.brain) { s.brain.path = null; s.brain.releaseCover(); }
    return true;
  }
  unboard(s) {
    const i = this.seats.indexOf(s);
    if (i >= 0) this.seats[i] = null;
    s.vehicle = null; s.hidden = false;
    // выход сбоку
    const side = (i % 2 ? 1 : -1);
    const c = Math.cos(this.yaw), sn = Math.sin(this.yaw);
    const lx = side * (this.type.width / 2 + 0.8), lz = -this.type.len / 4 + (i % 4) * 0.9;
    s.pos.set(this.pos.x + c * lx + sn * lz, 0, this.pos.z - sn * lx + c * lz);
    if (this.game.world.nav) { const f = this.game.world.nav.nearestFree(s.pos.x, s.pos.z); s.pos.x = f.x; s.pos.z = f.z; }
    s.pos.y = this.game.world.groundAt(s.pos.x, s.pos.z);
  }
  removeOccupant(s) { const i = this.seats.indexOf(s); if (i >= 0) this.seats[i] = null; }

  armorAt(n) {
    // n — нормаль поверхности в мировых координатах
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const f = n.x * fx + n.z * fz;
    if (n.y > 0.7) return this.type.armor.top;
    if (Math.abs(f) > 0.7) return f > 0 ? this.type.armor.front : this.type.armor.side;
    return this.type.armor.side;
  }

  damageHit(pen, pt, owner, heat, ex, fromNet = false) {
    if (!this.alive) return;
    const g = this.game;
    if (this.tank) {
      // общий путь (без нормали): зона по точке, направление — к центру танка
      if (g.net && !g.net.isHost && !fromNet) { g.net.fwdVehicleHit(this, pen, pt, owner, heat, ex); return; }
      if (!pt) return;
      const dir = new THREE.Vector3(this.pos.x - pt.x, 0, this.pos.z - pt.z).normalize();
      const z = tankZoneOf(this, pt, dir);
      const arm = TANK_ARMOR[z.zone][heat ? 1 : 0];
      this.tank.applyHit({ zone: z.zone, pen: Math.round(pen), armor: arm, ce: !!heat, lp: [z.lp.x, z.lp.y, z.lp.z], big: !!(ex && ex.dmg >= 200), mass: 0, ric: false }, owner);
      return;
    }
    if (g.net && !g.net.isHost && !fromNet) { g.net.fwdVehicleHit(this, pen, pt, owner, heat, ex); return; }
    // ходовая: пробитое/оторванное колесо, перебитая гусеница
    const wi = pt ? this.dmg.onHit(pt, pen, heat, ex) : -1;
    if (wi >= 0 && !heat) {
      this.hp -= Math.min(6, pen * 0.15);
      if (this.ai) this.ai.alerted = true;
      if (this.hp <= 0) this.destroy(owner);
      return;
    }
    if (heat) {
      const armor = this.type.armor.side;
      if (pen > armor * 3) {
        this.hp -= ex.dmg * (this.typeId === 'mtlb' ? 1.6 : this.typeId === 'tigr' ? 1.4 : 3);
        for (const s of this.seats) if (s && s.alive && Math.random() < 0.7) s.damage(rand(40, 110), 'torso', owner, null);
      }
    } else {
      this.hp -= pen * 0.6;
      const occ = this.seats.filter((s) => s && s.alive);
      if (occ.length && Math.random() < 0.3) occ[Math.floor(Math.random() * occ.length)].damage(rand(20, 45), Math.random() < 0.2 ? 'head' : 'torso', owner, null);
    }
    if (this.ai) this.ai.alerted = true;
    if (this.hp <= 0) this.destroy(owner);
  }

  damageBlast(ex, d, owner, pos = null) {
    if (!this.alive) return;
    if (this.game.net && !this.game.net.isHost) return;
    if (this.tank) { this.tank.blast(ex, d, owner, pos); return; }
    if (pos) this.dmg.onBlast(pos, ex);
    const k = Math.max(0, 1 - d / (ex.radius * 2.2));
    const vuln = this.typeId === 'niva' ? 1 : 0.15;
    this.hp -= ex.dmg * k * vuln;
    if (this.typeId === 'niva' && k > 0.3) for (const s of this.seats) if (s && s.alive && Math.random() < k) s.damage(rand(10, 30) * k, 'torso', owner, null);
    if (this.ai) this.ai.alerted = true;
    if (this.hp <= 0) this.destroy(owner);
  }

  destroy(by) {
    if (!this.alive) return;
    this.alive = false;
    const g = this.game;
    g.fx.explosion(new THREE.Vector3(this.pos.x, this.pos.y + 1.2, this.pos.z), 1.6, true);
    g.audio.explosion(this.pos, 1.5);
    g.fx.addFire(new THREE.Vector3(this.pos.x, this.pos.y + this.type.height * 0.7, this.pos.z), this.typeId === 'niva' ? 0.8 : 1.2, 120);
    for (const s of [...this.seats]) {
      if (!s) continue;
      if (g.netVisual) { if (s.alive) this.unboard(s); continue; } // клиент: урон экипажу пришлёт хост
      if (s.alive && Math.random() < 0.55) { s.damage(rand(60, 140), 'torso', by, null); }
      if (s.alive) { this.unboard(s); s.damage(rand(10, 30), 'leg', by, null); }
      else { this.removeOccupant(s); s.vehicle = null; s.hidden = false; s.pos.copy(this.pos); s.pos.x += rand(-2, 2); s.pos.z += rand(-2, 2); s.pos.y = g.world.groundAt(s.pos.x, s.pos.z); }
    }
    // остов: выгоревшая краска, выбитые стёкла, сгоревшие шины, вмятины и пробоины,
    // сорванная башня, слетевшая гусеница или оторванное колесо
    this.dmg.wreck();
    if (this.engine) { this.engine.stop(); this.engine = null; }
    if (g.onVehicleDestroyed) g.onVehicleDestroyed(this, by);
  }

  _updateCollider() {
    const c = this.collider, T = this.type;
    c.x = this.pos.x; c.z = this.pos.z;
    c.y0 = this.pos.y + 0.25; c.y1 = this.pos.y + T.height;
    c.cos = Math.cos(this.yaw); c.sin = Math.sin(this.yaw); c.yaw = this.yaw;
    const ex = Math.abs(c.cos) * c.hx + Math.abs(c.sin) * c.hz, ez = Math.abs(c.sin) * c.hx + Math.abs(c.cos) * c.hz;
    c.minX = c.x - ex; c.maxX = c.x + ex; c.minZ = c.z - ez; c.maxZ = c.z + ez;
    this.eye.set(this.pos.x, this.pos.y + T.height + 0.2, this.pos.z);
    this.chest.set(this.pos.x, this.pos.y + T.height * 0.6, this.pos.z);
  }

  // Локальная точка → мировая
  toWorld(lx, ly, lz, out = new THREE.Vector3()) {
    out.set(lx, ly, lz).applyMatrix4(this.mesh.matrixWorld);
    return out;
  }

  update(dt) {
    const g = this.game, T = this.type, w = g.world;
    if (!this.alive) { this.vel.multiplyScalar(Math.exp(-3 * dt)); this.speed = 0; this._place(dt); return; }
    if (this.tank) this.tank.update(dt, !this.netPuppet);
    if (this.netPuppet) { this._puppet(dt); return; }
    if (this.ai) this._aiDrive(dt);
    const ctl = this.driver && this.driver.alive ? this.controls : { throttle: 0, steer: 0, brake: 1 };
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let vF = this.vel.x * fx + this.vel.z * fz;
    let vR = this.vel.x * rx + this.vel.z * rz;
    const th = ctl.throttle;
    // сцепление только у колёс, касающихся грунта: в полёте газ, тормоз и руль не работают
    const gc = this.contact ?? 1;
    // Тяговый расчёт в ньютонах по паспортным массам и мощностям:
    // тяга = min(КПД·мощность/скорость, μ·сцепной вес) против уклона, качения и воздуха.
    // Прицеп (Д-30, 3210 кг) добавляет массу, скатывающую силу и своё сопротивление качению.
    const surf = this._surface();
    const mu = surf.mu * (this.gripK ?? 1), cosP = Math.cos(this.pitch), sinP = Math.sin(this.pitch);
    const mTow = this.towing ? (this.towing.mass || 3210) : 0;
    const M = T.mass + mTow;
    const N = T.mass * 9.81 * cosP;                      // сцепной вес тягача (все оси/гусеницы ведущие)
    const v = Math.abs(vF);
    this.thrA = (this.thrA || 0) + (Math.abs(th) - (this.thrA || 0)) * Math.min(1, dt * 3.5); // отклик двигателя
    const vmax = T.maxSpeed * (this.speedK ?? 1);
    let Fd = 0, Fres = 0;                                 // движущая и тормозящая (против движения) силы
    if (th !== 0 && vF * th < -0.3) Fres += Math.abs(th) * Math.min(T.brake * T.mass, (mu + 0.15) * N); // встречный газ — торможение
    else if (th !== 0) {
      const vlim = th > 0 ? vmax : T.reverse || 6;
      const gov = clamp((vlim - v) / (0.06 * vlim + 0.4), 0, 1);   // ограничение оборотов/передачи
      const Fpow = T.eta * T.power * 1000 / Math.max(v, 0.9);
      Fd = Math.sign(th) * this.thrA * Math.min(Fpow, mu * N) * gov;
      this.slip = Fpow > mu * N ? 1 : 0;
    }
    if (ctl.brake) Fres += Math.min(T.brake * T.mass, (mu + 0.15) * N) + (mTow ? 0.5 * mu * mTow * 9.81 * cosP : 0);
    const Fg = -M * 9.81 * sinP;                          // скатывающая сила на уклоне
    const Froll = 9.81 * cosP * (surf.crr * T.mass * (this.rollK ?? 1) + (mTow ? surf.crrTow * mTow : 0));
    const Fair = 0.5 * 1.25 * T.cda * vF * v;
    const aF = (Fd + Fg - Fair) / M * gc;
    const decel = (Froll + Fres) / M * gc;
    vF += aF * dt;
    if (Math.abs(vF) <= decel * dt) vF = 0; else vF -= Math.sign(vF) * decel * dt;
    // коробка передач: задний ход — не быстрее паспортного (у Т-72Б — 4 км/ч), кроме спуска накатом
    if (T.tank && th < 0 && vF < -T.reverse) vF = Math.max(vF, -T.reverse - Math.max(0, Fg / M) * 0.5);
    // стоянка: машина на тормозах держится на склоне, пока уклон не превысит сцепление
    if ((th === 0 || ctl.brake) && v < 0.5 && Math.abs(Fg) < (mu + 0.1) * N + Froll) vF = 0;
    // боковая составляющая веса на поперечном склоне и сцепление с грунтом
    const muLat = (T.tracked ? 0.75 : 0.42) * (ctl.brake && !T.tracked ? 0.8 : 1) * Math.min(1.1, surf.mu / surf.mu0) * (this.gripK ?? 1);
    vR += -9.81 * Math.sin(this.groundRoll || 0) * dt * gc;
    const fric = Math.min(Math.abs(vR), (muLat * 9.81 * Math.cos(this.groundRoll || 0) * dt + Math.abs(vR) * (1 - Math.exp(-T.grip * dt)) * 0.6) * gc);
    vR -= Math.sign(vR) * fric;
    this.accF = aF - Math.sign(vF) * decel;
    let yawRate;
    if (T.tracked) {
      yawRate = ctl.steer * T.turnRate * (vF < -0.2 ? -1 : 1) * (1 - 0.45 * Math.min(1, Math.abs(vF) / T.maxSpeed));
    } else {
      const target = ctl.steer * T.steerMax * (1 - 0.55 * Math.min(1, Math.abs(vF) / T.maxSpeed));
      this.steer += (target - this.steer) * Math.min(1, dt * 5);
      yawRate = (vF * Math.tan(this.steer)) / T.wheelbase;
    }
    // спущенное/оторванное колесо или разорванная гусеница уводят машину в сторону
    if (this.pull) yawRate += this.pull * vF / (T.wheelbase * 3) * gc;
    // в воздухе машина сохраняет вращение по курсу
    yawRate = yawRate * gc + (this._yawRate || 0) * (1 - gc) * Math.exp(-0.5 * dt);
    this._yawRate = yawRate;
    this.yaw += yawRate * dt;
    this.accLat = (this.accLat || 0) * 0.85 + vF * yawRate * 0.15;
    // опрокидывание на слишком крутом поперечном склоне
    if (Math.abs(this.roll) > 0.85 && this.alive && Math.abs(this.groundRoll || 0) > 0.7) { this.hp -= 40 * dt; if (this.hp <= 0) this.destroy(null); }
    // лежит на боку или на крыше — дальше не едет
    if ((Math.abs(this.roll) > 1.2 || Math.abs(this.pitch) > 1.2) && gc > 0) { vF *= Math.exp(-4 * dt); this.hp -= 15 * dt; if (this.hp <= 0) this.destroy(null); }
    const nfx = -Math.sin(this.yaw), nfz = -Math.cos(this.yaw), nrx = Math.cos(this.yaw), nrz = -Math.sin(this.yaw);
    this.vel.set(nfx * vF + nrx * vR, 0, nfz * vF + nrz * vR);
    this.speed = vF;
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    this._collide(dt);
    this._place(dt);
    this._tail(dt, vF, th);
  }

  // колёса, двигатель, экипаж, турель — общее для своей физики и сетевой куклы
  _tail(dt, vF, th) {
    const g = this.game, T = this.type;
    // колёса
    // колёса: качение вокруг своей оси, руль — отдельной группой
    this.wheelRot += vF * dt;
    const TR = this.model.tracks;
    if (TR) {
      // гусеницы: скорость каждого борта = скорость машины ± поворот (при развороте на месте — встречно)
      const yr = dt > 0 && this._lastYaw !== undefined ? wrapAngle(this.yaw - this._lastYaw) / dt : 0;
      const hw = T.track / 2, ts = this.trackS || (this.trackS = [0, 0]);
      ts[0] += (vF - yr * hw) * dt; ts[1] += (vF + yr * hw) * dt;
      const near = g.camPos ? this.pos.distanceToSquared(g.camPos) < 260 * 260 : true;
      for (let k = 0; k < 2; k++) {
        const sd = TR.sides[k];
        if (sd.broken || !near) continue;
        const off = -ts[k];
        if (Math.abs(off - sd.last) > 0.003) TR.place(sd, off);
      }
      for (const wh of this.model.wheels) if (!wh.lost) wh.spin.rotation.x = -(wh.side < 0 ? ts[0] : ts[1]) / (wh.r + 0.025);
    } else for (const wh of this.model.wheels) if (!wh.lost) wh.spin.rotation.x = -this.wheelRot / wh.r;
    this._lastYaw = this.yaw;
    for (const wh of this.model.steerWheels) if (!wh.lost) wh.steer.rotation.y = this.steer;
    // звук двигателя
    if (this.driver && this.driver.alive) {
      if (!this.engine) this.engine = g.audio.createEngine(T.engine);
      const rpm = clamp(Math.abs(vF) / T.maxSpeed + Math.abs(th) * 0.3, 0, 1);
      const own = g.player.vehicle === this;
      this.engine.set(rpm, own ? 0.12 : 0.1, own ? null : this.pos);
    } else if (this.engine) { this.engine.stop(); this.engine = null; }
    // пассажиры
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i];
      if (!s) continue;
      if (!s.alive) { if (this.tank && s.isCrew) continue; this.seats[i] = null; s.vehicle = null; s.hidden = false; continue; }
      if (this.tank) { if (i === 2) this.tank.placeCommander(s); continue; }
      if (i === 1 && this.gunWeapon) {
        const tp = this.toWorld(this.model.turret.position.x, this.model.turret.position.y, this.model.turret.position.z);
        s.pos.set(tp.x, tp.y - (T.gunExposed ? 1.0 : 0.3), tp.z);
        // открытая турель: стрелок стоит в люке за пулемётом
        if (T.gunExposed) { const a = this.yaw + this.turretYaw; s.pos.x += Math.sin(a) * 0.4; s.pos.z += Math.cos(a) * 0.4; }
        if (T.gunExposed) s.stance = 'stand';
        s.yaw = this.yaw + this.turretYaw; s.aimYaw = s.yaw;
      } else {
        s.pos.set(this.pos.x, this.pos.y + 0.6, this.pos.z);
      }
      s.vel.copy(this.vel);
    }
    // турель
    if (this.model.turret) {
      this.model.turret.rotation.y = this.turretYaw;
      this.model.gun.rotation.x = this.gunPitch;
    }
    this.gunCooldown -= dt;
    this.fireFlash = Math.max(0, this.fireFlash - dt);
    if (this.gunReload > 0) { this.gunReload -= dt; if (this.gunReload <= 0 && this.gunMags > 0) { this.gunMags--; this.gunAmmo = this.gunWeapon.mag; } }
  }

  // Сетевая кукла: положение от водителя-игрока или хоста, интерполяция
  _puppet(dt) {
    const v = this.netPuppet.sample(this._ns || (this._ns = []));
    if (v) {
      const ox = this.pos.x, oz = this.pos.z;
      this.pos.x = v[0]; this.pos.z = v[2]; this.yaw = v[3]; this.speed = v[4]; this.steer = v[5];
      if (v.length > 9) { this.pos.y = v[1]; this.pitch = v[8]; this.roll = v[9]; this.netPose = true; }
      if (!this.netLocalGunner && !this.netTurret) { this.turretYaw = v[6]; this.gunPitch = v[7]; }
      if (dt > 0) this.vel.set((this.pos.x - ox) / dt, 0, (this.pos.z - oz) / dt);
      if (this.vel.lengthSq() > 900) this.vel.set(-Math.sin(this.yaw) * this.speed, 0, -Math.cos(this.yaw) * this.speed);
    }
    this.accF = 0; this.accLat = 0;
    this._place(dt);
    this.netPose = false;
    this._tail(dt, this.speed, Math.abs(this.speed) > 0.5 ? 0.5 : 0);
  }

  _surface() {
    const m = this.game.world.terrain.maskAt(this.pos.x, this.pos.z) | 0;
    const tab = this.type.tracked ? SURF.track : SURF.wheel, k = m < tab.length ? m : 0;
    const r = this._surf || (this._surf = { mu: 0, crr: 0, crrTow: 0, mu0: 0 });
    r.mu = tab[k].mu * (this.type.tyre || 1); r.crr = tab[k].crr; r.crrTow = SURF.tow[k]; r.mu0 = tab[0].mu * (this.type.tyre || 1);
    return r;
  }

  // Точки опоры подвески: колёса (у гусеничной — опорные катки)
  _contacts() {
    if (this._cp) return this._cp;
    const T = this.type, cps = [];
    for (const wh of this.model.wheels) {
      if (T.tracked && wh.steer.position.y > 0.5) continue; // ленивец и звёздочка не опорные
      cps.push({ wh, lx: wh.steer.position.x, lz: wh.steer.position.z, baseY: wh.steer.position.y, x: T.susp.droop, g: 0 });
    }
    if (!cps.length) {
      const hl = T.len * 0.4, hw = T.width * 0.45;
      for (const [lx, lz] of [[-hw, -hl], [hw, -hl], [-hw, hl], [hw, hl]]) cps.push({ wh: null, lx, lz, baseY: 0, x: T.susp.droop, g: 0 });
    }
    this._cp = cps;
    return cps;
  }

  // Высота опоры под точкой: рельеф и низкие препятствия (валы, мешки, бордюры)
  _groundUnder(x, z, top) {
    const w = this.game.world;
    let g = w.terrain.heightAt(x, z);
    w._cellsAround(x, z, 0.4, (o) => {
      if (!o.blocksMove || o.y1 <= g || o.y1 > top) return;
      if (w.pointObstacleDist(o, x, z) <= 0.05) g = o.y1;
    });
    return g;
  }

  // Подвеска: пружина и амортизатор в каждой точке опоры, кузов — твёрдое тело (высота,
  // тангаж, крен) с инерцией. На гребне машина сохраняет вертикальную скорость и отрывается,
  // в воздухе летит по баллистике, при посадке — удар в упоры (сильный — повреждения).
  _place(dt) {
    const T = this.type, w = this.game.world, S = T.susp;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const hl = T.len * 0.4, hw = T.width * 0.45;
    const H = (lx, lz) => w.terrain.heightAt(this.pos.x + c * lx + s * lz, this.pos.z - s * lx + c * lz);
    const fl = H(-hw, -hl), fr = H(hw, -hl), rl = H(-hw, hl), rr = H(hw, hl);
    const gy = (fl + fr + rl + rr) / 4;
    this.groundPitch = Math.atan2((fl + fr) / 2 - (rl + rr) / 2, hl * 2);
    this.groundRoll = Math.atan2((fr + rr) / 2 - (fl + rl) / 2, hw * 2);
    const cps = this._contacts();
    if (this.netPose) {
      // сетевая кукла: положение и наклоны приходят готовыми
      for (const p of cps) p.x = S.droop;
      this.contact = 1;
    } else if (dt > 0.2 || this.yVel === undefined || this._settle) {
      // первый кадр / телепорт: ставим на грунт без колебаний
      this.pos.y = gy; this.pitch = this.groundPitch; this.roll = this.groundRoll;
      this.yVel = 0; this.pVel = 0; this.rVel = 0; this.contact = 1; this._settle = false;
      for (const p of cps) p.x = S.droop;
    } else {
      const n = Math.max(1, Math.ceil(dt / 0.006)), h = dt / n;
      const N = cps.length;
      const kS = 9.81 / (N * S.droop);                     // жёсткость на единицу массы
      const w0 = Math.sqrt(9.81 / S.droop);
      const cD = (2 * S.zeta * w0) / N;
      const rgP2 = (T.len * 0.3) ** 2, rgR2 = (T.width * 0.36) ** 2;
      // грунт под точками опоры (за кадр смещение мало)
      for (const p of cps) {
        const yA = this.pos.y - Math.sin(this.pitch) * p.lz + Math.sin(this.roll) * p.lx;
        p.g = this._groundUnder(this.pos.x + c * p.lx + s * p.lz, this.pos.z - s * p.lx + c * p.lz, yA + 0.35) - (p.wh && p.wh.drop || 0);
      }
      let contacts = 0, landV = 0;
      const wasAir = (this.contact || 0) === 0;
      for (let k = 0; k < n; k++) {
        let ay = -9.81, ap = 0, ar = 0;
        contacts = 0;
        const sp = Math.sin(this.pitch), sr = Math.sin(this.roll), cp = Math.cos(this.pitch), cr = Math.cos(this.roll);
        for (const p of cps) {
          const yA = this.pos.y - sp * p.lz + sr * p.lx;
          const vA = this.yVel - this.pVel * cp * p.lz + this.rVel * cr * p.lx;
          const x = p.g - (yA - S.droop);
          p.x = x;
          if (x <= 0) continue;
          contacts++;
          let f = kS * x - cD * vA;
          const over = x - S.droop - S.comp;
          if (over > 0) f += kS * 30 * over - cD * 6 * vA; // упор хода сжатия
          if (f < 0) f = 0;
          ay += f; ap += f * -p.lz / rgP2; ar += f * p.lx / rgR2;
        }
        if (contacts) {
          const cf = contacts / N;
          ap += clamp(this.accF || 0, -9, 9) * S.hcg / rgP2 * cf;   // клевок при торможении, приседание при разгоне
          ar += -clamp(this.accLat || 0, -9, 9) * S.hcg / rgR2 * cf; // крен в повороте
        } else {
          this.pVel *= Math.exp(-0.2 * h); this.rVel *= Math.exp(-0.2 * h);
        }
        this.yVel += ay * h; this.pVel += ap * h; this.rVel += ar * h;
        this.pos.y += this.yVel * h; this.pitch += this.pVel * h; this.roll += this.rVel * h;
        // днище не проваливается сквозь грунт: жёсткий контакт
        let deficit = 0;
        const sp2 = Math.sin(this.pitch), sr2 = Math.sin(this.roll);
        for (const p of cps) {
          const yA = this.pos.y - sp2 * p.lz + sr2 * p.lx;
          const d = p.g - S.comp - 0.04 - yA; // полностью сжатая пружина: yA = g − comp
          if (d > deficit) deficit = d;
        }
        if (deficit > 0) {
          this.pos.y += deficit;
          if (this.yVel < 0) { landV = Math.max(landV, -this.yVel); this.yVel = -this.yVel * 0.12; }
          this.pVel *= 0.6; this.rVel *= 0.6;
        }
      }
      this.contact = contacts / N;
      if (wasAir && contacts && this.airT > 0.25) {
        landV = Math.max(landV, this._fallV || 0);
        this.game.audio.impact(this.pos, 'metal');
      }
      this.airT = contacts ? 0 : (this.airT || 0) + dt;
      if (!contacts) this._fallV = Math.max(0, -this.yVel);
      // жёсткое приземление: повреждения машины и экипажа
      if (landV > 8 && this.alive) {
        const dmg = (landV - 8) * (T.tracked ? 10 : 16);
        this.hp -= dmg;
        for (const o of this.seats) if (o && o.alive && Math.random() < 0.5) o.damage((landV - 8) * 4, 'leg', null, null, { penetrating: false });
        if (this.hp <= 0) this.destroy(null);
      }
      // опрокидывание набок/на крышу
      if ((Math.abs(this.roll) > 1.35 || Math.abs(this.pitch) > 1.35) && contacts === 0 && this.airT === 0) { /* в полёте */ }
      this.pitch = clamp(this.pitch, -1.5, 1.5); this.roll = clamp(this.roll, -1.6, 1.6);
    }
    // ход колёс по сжатию подвески
    for (const p of cps) {
      if (!p.wh || p.wh.lost) continue;
      const off = clamp(p.x - S.droop, -S.droop, S.comp);
      p.wh.steer.position.y = p.baseY + off;
    }
    if (w.terrain.hasSea && gy < -1.2 && this.alive) { this.game.hud && this.game.hud.message(`${T.name} провалился под воду`); this.destroy(null); }
    this.mesh.position.copy(this.pos);
    if (this.drop) this.mesh.position.y -= this.drop; // остов осел на разбитой подвеске
    this.mesh.rotation.set(0, 0, 0);
    this.mesh.rotation.order = 'YXZ';
    this.mesh.rotation.y = this.yaw; this.mesh.rotation.x = this.pitch; this.mesh.rotation.z = this.roll;
    this.mesh.updateMatrixWorld(true);
    this._updateCollider();
    if (this.blob) { this.blob.position.set(this.pos.x, gy + 0.06, this.pos.z); this.blob.rotation.z = this.yaw; this.blob.visible = this.pos.y - gy < 3; }
  }

  _collide(dt) {
    const g = this.game, w = g.world, T = this.type;
    const me = this.collider;
    this._updateCollider();
    const sat = (o) => {
      // OBB против OBB/цилиндра в плоскости XZ; возвращает {nx,nz,depth}
      if (o.kind === 1) {
        const dx = this.pos.x - o.x, dz = this.pos.z - o.z;
        const lx = me.cos * dx - me.sin * dz, lz = me.sin * dx + me.cos * dz;
        const cx = clamp(-lx, -me.hx, me.hx), cz = clamp(-lz, -me.hz, me.hz);
        const px = -lx - cx, pz = -lz - cz; const d = Math.hypot(px, pz);
        if (d > o.r) return null;
        const wx = me.cos * px + me.sin * pz, wz = -me.sin * px + me.cos * pz;
        const L = Math.hypot(wx, wz) || 1;
        return { nx: -wx / L, nz: -wz / L, depth: o.r - d };
      }
      const axes = [[me.cos, -me.sin], [me.sin, me.cos], [o.cos, -o.sin], [o.sin, o.cos]];
      const dx = this.pos.x - o.x, dz = this.pos.z - o.z;
      let best = null;
      for (const [ax, az] of axes) {
        const ra = me.hx * Math.abs(me.cos * ax - me.sin * az) + me.hz * Math.abs(me.sin * ax + me.cos * az);
        const rb = o.hx * Math.abs(o.cos * ax - o.sin * az) + o.hz * Math.abs(o.sin * ax + o.cos * az);
        const dist = dx * ax + dz * az;
        const ov = ra + rb - Math.abs(dist);
        if (ov <= 0) return null;
        if (!best || ov < best.depth) best = { nx: ax * Math.sign(dist || 1), nz: az * Math.sign(dist || 1), depth: ov };
      }
      return best;
    };
    const handle = (o, other) => {
      if (!o.blocksMove) return;
      if (o.y1 < this.pos.y + 0.7 || o.y0 > this.pos.y + T.height) return;
      const r = sat(o);
      if (!r) return;
      const spd = Math.abs(this.speed);
      // забор: пролёт валится под машиной
      if (o.owner && o.owner.kind === 'fence') {
        if (spd > 1.2) { w.destr.breakFence(o.owner, new THREE.Vector3(-Math.sin(this.yaw) * Math.sign(this.speed || 1), 0, -Math.cos(this.yaw) * Math.sign(this.speed || 1))); this.vel.multiplyScalar(0.92); return; }
      }
      // стена с проломами: плитки в пятне контакта; деревянную стену тяжёлая машина проламывает
      if (o.dw) {
        const dw = o.dw, D = w.destr, hit = [];
        for (let idx = 0; idx < dw.alive.length; idx++) {
          if (!dw.alive[idx]) continue;
          const c = D._tileCenter(dw, idx, _tc);
          if (c.y > this.pos.y + T.height || c.y < this.pos.y + 0.15) continue;
          if (w.pointObstacleDist(me, c.x, c.z) < 0.35) hit.push(idx);
        }
        if (!hit.length) return; // в пятне контакта стены уже нет — проезжаем в пролом
        const heavy = T.tracked || this.typeId === 'tigr';
        if ((dw.mat === 'wood' && spd > (heavy ? 2.5 : 5)) || (dw.mat === 'log' && heavy && spd > 4)) {
          const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).multiplyScalar(Math.sign(this.speed || 1));
          for (const idx of hit) D.destroyTile(dw, idx, fwd, spd * 0.8);
          this.vel.multiplyScalar(dw.mat === 'log' ? 0.6 : 0.8);
          this.hp -= dw.mat === 'log' ? 6 : 2;
          return;
        }
      }
      const share = other ? 0.5 : 1;
      this.pos.x += r.nx * r.depth * share; this.pos.z += r.nz * r.depth * share;
      if (other) { other.pos.x -= r.nx * r.depth * 0.5; other.pos.z -= r.nz * r.depth * 0.5; }
      const vn = this.vel.x * r.nx + this.vel.z * r.nz;
      if (vn < 0) {
        this.vel.x -= r.nx * vn * 1.2; this.vel.z -= r.nz * vn * 1.2;
        const imp = -vn;
        if (imp > 7) { this.hp -= (imp - 7) * 10; g.audio.impact(this.pos, 'metal'); if (this.hp <= 0) this.destroy(null); }
      }
    };
    w._cellsAround(this.pos.x, this.pos.z, T.len, (o) => handle(o, null));
    for (const v of w.vehicles) if (v !== this && v.collider) handle(v.collider, v.alive ? v : null);
    // пехота
    const sp = Math.abs(this.speed);
    for (const s of g.soldiers) {
      if (!s.alive || s.hidden || s.vehicle === this) continue;
      const dx = s.pos.x - this.pos.x, dz = s.pos.z - this.pos.z;
      if (dx * dx + dz * dz > (T.len * 0.7) ** 2) continue;
      const d = w.pointObstacleDist(me, s.pos.x, s.pos.z);
      if (d < 0.35) {
        if (sp > 3) {
          s.damage(sp * sp * 0.9, 'torso', this.driver, null);
        }
        const lx = me.cos * dx - me.sin * dz, lz = me.sin * dx + me.cos * dz;
        const ox = me.hx + 0.4 - Math.abs(lx), oz = me.hz + 0.4 - Math.abs(lz);
        let nlx = lx, nlz = lz;
        if (ox < oz) nlx = Math.sign(lx || 1) * (me.hx + 0.4); else nlz = Math.sign(lz || 1) * (me.hz + 0.4);
        s.pos.x = this.pos.x + me.cos * nlx + me.sin * nlz;
        s.pos.z = this.pos.z - me.sin * nlx + me.cos * nlz;
      }
    }
    // граница карты
    const R = Math.hypot(this.pos.x, this.pos.z), Rmax = w.terrain.boundary + 100;
    if (R > Rmax) { this.pos.x *= Rmax / R; this.pos.z *= Rmax / R; this.vel.multiplyScalar(0.5); }
  }

  // Мировое положение дула и направление ствола турели
  gunMuzzle(outPos, outDir) {
    if (!this.model.gun) return null;
    this.mesh.updateMatrixWorld(true);
    const gm = this.model.gun.matrixWorld;
    outPos.set(0, 0, -1.0).applyMatrix4(gm);
    outDir.set(0, 0, -1).transformDirection(gm);
    return outPos;
  }
  // Положение прицела (для камеры стрелка)
  sightPos(out) {
    this.mesh.updateMatrixWorld(true);
    return out.set(this.type.gunExposed ? 0 : -0.15, this.type.gunExposed ? 0.45 : 0.25, this.type.gunExposed ? 0.3 : 0.05).applyMatrix4(this.model.gun.matrixWorld);
  }

  fireGun(shooter) {
    if (!this.gunWeapon || this.gunCooldown > 0 || this.gunReload > 0) return false;
    if (this.gunAmmo <= 0) { if (this.gunMags > 0) this.gunReload = this.gunWeapon.reload; return false; }
    this.gunAmmo--;
    this.gunCooldown = 60 / this.gunWeapon.rpm;
    const p = new THREE.Vector3(), d = new THREE.Vector3();
    this.gunMuzzle(p, d);
    this.shotsFired++;
    this.game.fireProjectile({ weapon: this.gunWeapon, pos: p, dir: d, owner: shooter, team: shooter.team, vehicleShot: this });
    shooter.lastShotTime = this.game.time;
    if (shooter.model && shooter.model.shot && this.type.gunExposed) shooter.model.shot();
    this.lastShotTime = this.game.time;
    this.fireFlash = 0.06;
    return true;
  }

  // Наводка турели ИИ-стрелком
  aiTurretAim(dt, target, gunner) {
    if (!this.model.turret || !this.alive) return;
    const p = new THREE.Vector3(), d = new THREE.Vector3();
    this.gunMuzzle(p, d);
    const aim = (target.chest || target.pos).clone();
    const D = Math.hypot(aim.x - p.x, aim.z - p.z);
    const solver = solverFor(this.type.gun, this.game.zeroEnv);
    const worldYaw = Math.atan2(-(aim.x - p.x), -(aim.z - p.z));
    const pitch = Math.atan2(aim.y - p.y, D) + solver.angleFor(D * (1 + randn() * 0.08));
    const wantYaw = wrapAngle(worldYaw - this.yaw);
    const dy = wrapAngle(wantYaw - this.turretYaw);
    const rate = 1.2 * dt;
    this.turretYaw += clamp(dy, -rate, rate);
    const wantPitch = clamp(pitch - this.pitch, -0.09, 0.5);
    this.gunPitch += clamp(wantPitch - this.gunPitch, -rate, rate);
    if (Math.abs(dy) < 0.02) {
      this._aiBurst = (this._aiBurst || 0) - dt;
      if (this._aiBurst < -1.2) this._aiBurst = rand(0.3, 0.7);
      if (this._aiBurst > 0) {
        const jitter = 0.004 + gunner.suppression * 0.01;
        const sy = this.turretYaw, sp = this.gunPitch;
        this.turretYaw += randn() * jitter; this.gunPitch += randn() * jitter;
        this.mesh.updateMatrixWorld(true);
        this.fireGun(gunner);
        this.turretYaw = sy; this.gunPitch = sp;
      }
    }
  }

  _aiDrive(dt) {
    const ai = this.ai;
    if (!ai || !this.driver || !this.driver.alive) { this.controls.throttle = 0; this.controls.brake = 1; return; }
    if (ai.alerted && !ai.dismounted) {
      this.controls.throttle = 0; this.controls.brake = 1; this.controls.steer = 0;
      if (Math.abs(this.speed) < 1) {
        ai.dismounted = true;
        for (const s of [...this.seats]) {
          if (!s || s === this.driver || s === this.gunner) continue;
          this.unboard(s);
          if (s.brain) { s.brain.state = 'alert'; s.brain.alertT = 20; }
        }
        if (this.game.onConvoyDismount) this.game.onConvoyDismount(this);
      }
      return;
    }
    if (ai.dismounted) { this.controls.throttle = 0; this.controls.brake = 1; return; }
    const wp = ai.route[ai.idx];
    if (!wp) { this.controls.throttle = 0; this.controls.brake = 1; return; }
    const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 6) { ai.idx++; if (ai.idx >= ai.route.length) { if (ai.loop) ai.idx = 0; else { ai.done = true; } } return; }
    const want = Math.atan2(-dx, -dz);
    const da = wrapAngle(want - this.yaw);
    this.controls.steer = clamp(da * 2.2, -1, 1);
    // дистанция до впереди идущей машины
    let slow = 1;
    if (ai.leader && ai.leader.alive) {
      const ld = ai.leader.pos.distanceTo(this.pos);
      if (ld < 22) slow = Math.max(0, (ld - 12) / 10);
    }
    const target = ai.speed * slow * (1 - Math.min(0.6, Math.abs(da)));
    this.controls.throttle = this.speed < target ? 0.8 : 0;
    this.controls.brake = this.speed > target + 2 ? 1 : 0;
  }

  dispose() {
    this.game.scene.remove(this.mesh); this.game.scene.remove(this.blob);
    if (this.engine) this.engine.stop();
  }
}
