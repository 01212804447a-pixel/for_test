// Техника: бронеавтомобиль «Тигр», ВАЗ-2121 «Нива», МТ-ЛБ.
// Простая, но «честная» динамика: сцепление со снегом, уклоны, подвеска по 4 точкам,
// столкновения (OBB), бронирование по проекциям, турели, места десанта.
import * as THREE from 'three';
import { buildTigr, buildNiva, buildMTLB } from './vehicleModels.js';
import { blobShadow } from '../world/flora.js';
import { WEAPONS } from '../data/weapons.js';
import { clamp, rand, randn, wrapAngle } from '../core/math.js';
import { solverFor } from './soldier.js';

export const VEHICLE_TYPES = {
  tigr: {
    id: 'tigr', name: 'ГАЗ-233014 «Тигр»', cls: 'Бронеавтомобиль', len: 5.7, width: 2.4, height: 2.4,
    wheelbase: 3.3, track: 1.84, wheelR: 0.56, maxSpeed: 23, accel: 3.6, brake: 7, steerMax: 0.55, grip: 3.4,
    seats: 9, gun: 'pkp_mount', gunExposed: true, armor: { front: 7, side: 6, top: 3 }, hp: 300,
    engine: 'diesel', camo: ['#e7eaed', '#b6bdc4', '#8e979e'],
    desc: 'Бронированный автомобиль повышенной проходимости. Защита от 5,45 и 7,62×39. Турель с ПКП, 9 мест.',
  },
  niva: {
    id: 'niva', name: 'ВАЗ-2121 «Нива»', cls: 'Лёгкий внедорожник', len: 3.74, width: 1.68, height: 1.64,
    wheelbase: 2.2, track: 1.4, wheelR: 0.34, maxSpeed: 27, accel: 3.4, brake: 7.5, steerMax: 0.62, grip: 2.8,
    seats: 4, gun: null, armor: { front: 1, side: 0.8, top: 0.6 }, hp: 120,
    engine: 'car', camo: ['#3e4d33', '#34422b', '#4a5a3d'],
    desc: 'Быстрая и манёвренная, но не защищена: кузов пробивается любой пулей. 4 места.',
  },
  mtlb: {
    id: 'mtlb', name: 'МТ-ЛБ', cls: 'Многоцелевой тягач (гусеничный)', len: 6.45, width: 2.85, height: 1.87,
    wheelbase: 4.6, track: 2.4, wheelR: 0.3, maxSpeed: 15, accel: 2.4, brake: 6, turnRate: 0.85, grip: 7,
    tracked: true, seats: 13, gun: 'pkt', turret: true, armor: { front: 11, side: 7, top: 5 }, hp: 460,
    engine: 'tracked', camo: ['#55613f', '#dde1e3', '#3e4a31'],
    desc: 'Гусеничный бронетранспортёр-тягач. Отличная проходимость по глубокому снегу, башня с ПКТ и прицелом ПП-61АМ, 11 мест десанта.',
  },
};

function buildModel(type) {
  const T = VEHICLE_TYPES[type];
  return type === 'tigr' ? buildTigr(T.camo) : type === 'niva' ? buildNiva(T.camo) : buildMTLB(T.camo);
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
    this.yVel = 0;
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
    this._updateCollider();
  }

  get driver() { return this.seats[0]; }
  get gunner() { return this.gunWeapon ? this.seats[1] : null; }
  get turret() { return !!this.model.turret; }
  get crewTeam() { const o = this.seats.find((s) => s && s.alive); return o ? o.team : null; }

  hasFreeSeat() { return this.alive && this.seats.some((s, i) => !s && i >= 2) || (this.alive && !this.gunWeapon && this.seats.some((s, i) => !s && i >= 1)); }

  board(s, seatIdx = -1) {
    if (!this.alive) return false;
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
    if (g.net && !g.net.isHost && !fromNet) { g.net.fwdVehicleHit(this, pen, pt, owner, heat, ex); return; }
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

  damageBlast(ex, d, owner) {
    if (!this.alive) return;
    if (this.game.net && !this.game.net.isHost) return;
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
    const burnt = new THREE.MeshStandardMaterial({ color: 0x1c1b1a, roughness: 0.95 });
    this.mesh.traverse((o) => { if (o.isMesh) o.material = burnt; });
    this.mesh.rotation.z += rand(-0.05, 0.05);
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
    if (this.netPuppet) { this._puppet(dt); return; }
    if (this.ai) this._aiDrive(dt);
    const ctl = this.driver && this.driver.alive ? this.controls : { throttle: 0, steer: 0, brake: 1 };
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let vF = this.vel.x * fx + this.vel.z * fz;
    let vR = this.vel.x * rx + this.vel.z * rz;
    let aF = 0;
    const th = ctl.throttle;
    const deep = T.tracked ? 0.15 : 0.45;
    if (th > 0) aF = vF < -0.3 ? th * T.brake : th * T.accel * Math.max(0, 1 - Math.max(0, vF) / T.maxSpeed);
    else if (th < 0) aF = vF > 0.3 ? th * T.brake : th * T.accel * 0.6 * Math.max(0, 1 - Math.max(0, -vF) / 6);
    aF += -9.81 * Math.sin(this.pitch) * 0.85;
    const roll = (deep + 0.0011 * vF * vF) * Math.sign(vF);
    if (ctl.brake) aF -= Math.sign(vF) * T.brake;
    const before = vF;
    vF += aF * dt;
    vF -= roll * dt;
    if (th === 0 && Math.sign(vF) !== Math.sign(before) && Math.abs(before) < 1) vF = 0;
    if (ctl.brake && Math.abs(vF) < 0.5) vF = 0;
    // боковая составляющая веса на поперечном склоне и сцепление со снегом
    const muLat = (T.tracked ? 0.75 : 0.42) * (ctl.brake && !T.tracked ? 0.8 : 1);
    vR += -9.81 * Math.sin(this.groundRoll || 0) * dt;
    const fric = Math.min(Math.abs(vR), muLat * 9.81 * Math.cos(this.groundRoll || 0) * dt + Math.abs(vR) * (1 - Math.exp(-T.grip * dt)) * 0.6);
    vR -= Math.sign(vR) * fric;
    this.accF = aF;
    let yawRate;
    if (T.tracked) {
      yawRate = ctl.steer * T.turnRate * (vF < -0.2 ? -1 : 1) * (1 - 0.45 * Math.min(1, Math.abs(vF) / T.maxSpeed));
    } else {
      const target = ctl.steer * T.steerMax * (1 - 0.55 * Math.min(1, Math.abs(vF) / T.maxSpeed));
      this.steer += (target - this.steer) * Math.min(1, dt * 5);
      yawRate = (vF * Math.tan(this.steer)) / T.wheelbase;
    }
    this.yaw += yawRate * dt;
    this.accLat = (this.accLat || 0) * 0.85 + vF * yawRate * 0.15;
    // опрокидывание на слишком крутом поперечном склоне
    if (Math.abs(this.roll) > 0.85 && this.alive && Math.abs(this.groundRoll || 0) > 0.7) { this.hp -= 40 * dt; if (this.hp <= 0) this.destroy(null); }
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
    for (const wh of this.model.wheels) wh.spin.rotation.x = -this.wheelRot / wh.r;
    for (const wh of this.model.steerWheels) wh.steer.rotation.y = this.steer;
    if (this.model.trackTex) this.model.trackTex.offset.y -= vF * dt * 0.42;
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
      if (!s.alive) { this.seats[i] = null; s.vehicle = null; s.hidden = false; continue; }
      if (i === 1 && this.gunWeapon) {
        const tp = this.toWorld(this.model.turret.position.x, this.model.turret.position.y, this.model.turret.position.z);
        s.pos.set(tp.x, tp.y - (T.gunExposed ? 1.0 : 0.3), tp.z);
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
      if (!this.netLocalGunner && !this.netTurret) { this.turretYaw = v[6]; this.gunPitch = v[7]; }
      if (dt > 0) this.vel.set((this.pos.x - ox) / dt, 0, (this.pos.z - oz) / dt);
      if (this.vel.lengthSq() > 900) this.vel.set(-Math.sin(this.yaw) * this.speed, 0, -Math.cos(this.yaw) * this.speed);
    }
    this.accF = 0; this.accLat = 0;
    this._place(dt);
    this._tail(dt, this.speed, Math.abs(this.speed) > 0.5 ? 0.5 : 0);
  }

  _place(dt) {
    const T = this.type, w = this.game.world;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const hl = T.len * 0.4, hw = T.width * 0.45;
    const H = (lx, lz) => w.terrain.heightAt(this.pos.x + c * lx + s * lz, this.pos.z - s * lx + c * lz);
    const fl = H(-hw, -hl), fr = H(hw, -hl), rl = H(-hw, hl), rr = H(hw, hl);
    const gy = (fl + fr + rl + rr) / 4;
    // плоскость опоры по четырём точкам + динамика кузова на подвеске
    this.groundPitch = Math.atan2((fl + fr) / 2 - (rl + rr) / 2, hl * 2);
    this.groundRoll = Math.atan2((fr + rr) / 2 - (fl + rl) / 2, hw * 2);
    const soft = T.tracked ? 0.35 : 1;
    const tp = this.groundPitch + clamp((this.accF || 0) * 0.006 * soft, -0.06, 0.06);
    const tr = this.groundRoll + clamp(-(this.accLat || 0) * 0.012 * soft, -0.09, 0.09);
    if (dt > 0.2) { this.pitch = tp; this.roll = tr; this.pVel = 0; this.rVel = 0; }
    else {
      const K = 90, C = 13;
      this.pVel = (this.pVel || 0) + ((tp - this.pitch) * K - (this.pVel || 0) * C) * dt;
      this.rVel = (this.rVel || 0) + ((tr - this.roll) * K - (this.rVel || 0) * C) * dt;
      this.pitch += this.pVel * dt; this.roll += this.rVel * dt;
    }
    // ход колёс: каждое колесо прижимается к земле под собой
    if (!T.tracked && this.model.wheels.length >= 4) {
      for (let i = 0; i < 4; i++) {
        const wh = this.model.wheels[i];
        if (wh.baseY === undefined) wh.baseY = wh.steer.position.y;
        const lx = wh.steer.position.x, lz = wh.steer.position.z;
        const ground = H(lx, lz);
        const plane = gy + Math.sin(this.pitch) * -lz + Math.sin(this.roll) * lx;
        const target = clamp(wh.baseY + (ground - plane), wh.baseY - 0.14, wh.baseY + 0.14);
        wh.steer.position.y += (target - wh.steer.position.y) * Math.min(1, dt * 18);
      }
    }
    // вертикаль: пружина + гравитация
    if (this.pos.y > gy + 0.05) { this.yVel -= 9.81 * dt; this.pos.y += this.yVel * dt; if (this.pos.y < gy) { this.pos.y = gy; this.yVel = 0; } }
    else { this.pos.y += (gy - this.pos.y) * Math.min(1, dt * 14); this.yVel = 0; }
    if (w.terrain.hasSea && gy < -1.2 && this.alive) { this.game.hud && this.game.hud.message(`${T.name} провалился под воду`); this.destroy(null); }
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(0, 0, 0);
    this.mesh.rotation.order = 'YXZ';
    this.mesh.rotation.y = this.yaw; this.mesh.rotation.x = this.pitch; this.mesh.rotation.z = this.roll;
    this.mesh.updateMatrixWorld(true);
    this._updateCollider();
    if (this.blob) { this.blob.position.set(this.pos.x, gy + 0.06, this.pos.z); this.blob.rotation.z = this.yaw; }
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
    const R = Math.hypot(this.pos.x, this.pos.z);
    if (R > 1150) { this.pos.x *= 1150 / R; this.pos.z *= 1150 / R; this.vel.multiplyScalar(0.5); }
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
