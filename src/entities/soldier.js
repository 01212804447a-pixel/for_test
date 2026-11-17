// Боец (общий класс для своих, противника и тела игрока)
import * as THREE from 'three';
import { SoldierModel } from './soldierModel.js';
import { blobShadow } from '../world/flora.js';
import { WEAPONS, AMMO } from '../data/weapons.js';
import { BallisticSolver } from '../physics/ballistics.js';
import { clamp } from '../core/math.js';

const solverCache = new Map();
export function solverFor(weaponId, env) {
  const key = weaponId + '|' + Math.round(env.tempC);
  if (!solverCache.has(key)) {
    const w = WEAPONS[weaponId];
    const a = AMMO[w.ammo];
    const max = a.kind === 'bullet' ? 1500 : a.kind === 'rocket' ? 700 : 420;
    const maxAng = a.kind === 'grenade' ? 0.75 : 0.35;
    solverCache.set(key, new BallisticSolver(a, env, w.sight.h || 0.06, max, 25, maxAng));
  }
  return solverCache.get(key);
}

const VM_KIND = { ak74m: 'ak', ak74m_gp: 'ak', ak74m_1p78: 'ak', akm: 'akm', svd: 'svd', pkm: 'pkm', rpg7: 'rpg' };

let _id = 1;
export class Soldier {
  constructor(game, opts) {
    this.game = game;
    this.id = _id++;
    this.team = opts.team; // 'negs' | 'denter'
    this.name = opts.name || 'Боец';
    this.callsign = opts.callsign || '';
    this.role = opts.role || 'rifleman';
    this.isPlayer = !!opts.isPlayer;
    this.skill = { aim: 0.5, reaction: 0.5, nerve: 0.5, stamina: 0.5, ...(opts.skill || {}) };
    this.pos = new THREE.Vector3(opts.x || 0, 0, opts.z || 0);
    this.pos.y = game.world ? game.world.groundAt(this.pos.x, this.pos.z) : 0;
    if (opts.y !== undefined) this.pos.y = opts.y;
    this.vel = new THREE.Vector3();
    this.yaw = opts.yaw || 0; // тело
    this.aimYaw = this.yaw; this.aimPitch = 0;
    this.stance = opts.stance || 'stand';
    this.maxHealth = opts.health || 100;
    this.health = this.maxHealth;
    this.armor = opts.armor ?? 0.6; // защита туловища 0..1
    this.helmet = opts.helmet ?? 0.4;
    // класс защиты (мм-эквивалент): плиты и шлем
    this.armorClass = opts.armorClass ?? this.armor * (this.team === 'negs' ? 10 : 8);
    this.helmetClass = opts.helmetClass ?? this.helmet * 6;
    this.shockT = 0;
    this.alive = true;
    this.suppression = 0;
    this.morale = 1;
    this.bleeding = 0;
    this.lastHitTime = -10;
    this.static = !!opts.static; // часовой на вышке и т.п.
    this.hidden = false; // в машине
    this.vehicle = null;
    this.kills = 0;
    this.grenades = opts.grenades ?? (this.team === 'denter' ? 1 : 2);
    this.medkits = opts.medkits ?? (this.role === 'medic' ? 8 : 1);
    this.setWeapon(opts.weapon || 'ak74m', opts.mags);
    if (opts.secondary) { this.secondary = { id: opts.secondary, def: WEAPONS[opts.secondary], mag: 1, mags: WEAPONS[opts.secondary].mags }; }
    this.faction = opts.faction || (this.team === 'negs' ? 'negs' : 'denter');
    if (!this.isPlayer) {
      this.model = new SoldierModel(this.faction, VM_KIND[this.weaponId] || 'ak', { scale: opts.scale || 1 });
      game.scene.add(this.model.root);
      this.blob = blobShadow(0.9, 0.9, 0.45); game.scene.add(this.blob);
    }
    this.hitboxes = [];
    this.moveDir = new THREE.Vector3();
    this.speed = 0;
    this.brain = null;
    this.eye = new THREE.Vector3();
    this.chest = new THREE.Vector3();
    this.fireFlash = 0;
    this.shotsFired = 0;
    this.footT = 0;
    this.updateEye();
  }

  setWeapon(id, mags) {
    this.weaponId = id;
    this.weapon = WEAPONS[id];
    this.ammo = AMMO[this.weapon.ammo];
    this.mag = this.weapon.mag;
    this.mags = mags ?? this.weapon.mags;
    this.ammoTotal0 = this.weapon.mag * (1 + this.mags);
    this.reloadT = 0;
    this.cooldown = 0;
  }

  get ammoFrac() { return (this.mag + this.mags * this.weapon.mag) / this.ammoTotal0; }

  eyeHeight() {
    return this.stance === 'stand' ? 1.62 : this.stance === 'crouch' ? 1.1 : 0.38;
  }
  updateEye() {
    this.eye.set(this.pos.x, this.pos.y + this.eyeHeight(), this.pos.z);
    this.chest.set(this.pos.x, this.pos.y + this.eyeHeight() * 0.78, this.pos.z);
  }

  get solver() { return solverFor(this.weaponId, this.game.zeroEnv); }

  // Получение урона: zone — head|torso|pelvis|leg|arm
  damage(amount, zone, source, dir, { raw = false, penetrating = true } = {}) {
    if (!this.alive) return;
    let d = amount;
    if (!raw) {
      if (zone === 'head') d *= 3.2;
      else if (zone === 'pelvis') d *= 0.9;
      else if (zone === 'leg') d *= 0.55;
      else if (zone === 'arm') d *= 0.45;
    }
    if (penetrating) {
      if (zone === 'leg') this.bleeding += 1.4;
      else if (zone === 'arm') this.bleeding += 0.8;
      else if (zone === 'torso' || zone === 'pelvis') this.bleeding += 2.2;
      // болевой шок: короткое выведение из строя
      if (d > 25 && zone !== 'arm') this.shockT = Math.max(this.shockT || 0, zone === 'leg' ? 1.5 : 2.6);
    }
    this.health -= d;
    this.lastHitTime = this.game.time;
    this.suppression = Math.min(1, this.suppression + 0.6);
    this.morale -= 0.08;
    if (this.brain) this.brain.onHit(source, dir);
    if (this.isPlayer && this.game.onPlayerHit) this.game.onPlayerHit(d, dir, zone);
    if (this.health <= 0) this.die(source);
  }

  die(source) {
    if (!this.alive) return;
    this.alive = false;
    this.health = 0;
    this.stance = 'prone';
    if (source && source.kills !== undefined && source.team !== this.team) source.kills++;
    if (this.vehicle) this.vehicle.removeOccupant(this);
    if (this.game.onSoldierDeath) this.game.onSoldierDeath(this, source);
  }

  heal(n) {
    if (!this.alive) return;
    this.health = Math.min(this.maxHealth, this.health + n);
    this.bleeding = 0;
  }

  update(dt) {
    if (this.alive) {
      this.suppression = Math.max(0, this.suppression - dt * (0.18 + this.skill.nerve * 0.25));
      if (this.shockT > 0) this.shockT -= dt;
      if (this.bleeding > 0) {
        this.health -= this.bleeding * dt * 0.6;
        this.bleeding = Math.max(0, this.bleeding - dt * 0.03);
        if (this.health <= 0) this.die(null);
      }
      if (this.brain && !this.isPlayer) this.brain.update(dt);
      this.cooldown -= dt;
      if (this.reloadT > 0) {
        this.reloadT -= dt;
        if (this.reloadT <= 0 && this.mags > 0) { this.mags--; this.mag = this.weapon.mag; }
      }
      this.fireFlash = Math.max(0, this.fireFlash - dt);
    }
    this.updateEye();
    if (this.model) {
      const m = this.model;
      m.root.visible = !this.hidden;
      if (this.blob) this.blob.visible = !this.hidden;
      if (!this.hidden) {
        m.root.position.copy(this.pos);
        if (this.blob) { this.blob.position.set(this.pos.x, this.pos.y + 0.04, this.pos.z); this.blob.scale.set(this.stance === 'prone' || !this.alive ? 1.3 : 1, this.stance === 'prone' || !this.alive ? 2.2 : 1, 1); this.blob.rotation.z = this.yaw; }
        m.root.rotation.y = this.yaw;
        // направление движения в локальной системе тела
        const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
        const vx = this.vel.x, vz = this.vel.z;
        const sp = Math.hypot(vx, vz);
        const lx = c * vx - s * vz, lz = s * vx + c * vz;
        // скелет: вблизи каждый кадр, вдали — реже; тела после падения не трогаем
        const camD2 = this.game.camPos ? this.pos.distanceToSquared(this.game.camPos) : 0;
        this._skinTick = (this._skinTick || 0) + 1;
        const done = !this.alive && m.deadT > 1.2 && this._skinFrozen;
        m.skinUpdate = !done && (camD2 < 6400 || this._skinTick % (camD2 < 90000 ? 2 : 4) === 0);
        if (!this.alive && m.deadT > 1.2) this._skinFrozen = true;
        m.update(dt, {
          speed: sp, mx: sp > 0.05 ? lx / sp : 0, mz: sp > 0.05 ? lz / sp : 0,
          stance: this.stance, aimPitch: this.aimPitch, aiming: this.brain ? this.brain.aiming : false, dead: !this.alive,
        });
        m.root.updateMatrixWorld(true);
        if (this.game.camPos) m.setDetail(this.pos.distanceToSquared(this.game.camPos) < 3600);
        if (this.alive) m.hitboxes(this.hitboxes);
        // шаги
        if (sp > 0.6 && this.alive) {
          this.footT += dt * sp * 0.75;
          if (this.footT > 1) { this.footT = 0; this.game.audio.footstep(this.pos, false, this.stance === 'stand' ? 0.1 : 0.05); }
        }
      }
    }
  }

  // Желаемый поворот тела/прицела
  turnTowards(yaw, pitch, dt, rate = 4) {
    let dy = yaw - this.aimYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const st = rate * dt;
    this.aimYaw += clamp(dy, -st, st);
    this.aimPitch += clamp(pitch - this.aimPitch, -st, st);
    let by = this.aimYaw - this.yaw;
    while (by > Math.PI) by -= Math.PI * 2;
    while (by < -Math.PI) by += Math.PI * 2;
    this.yaw += clamp(by, -st * 1.2, st * 1.2);
    return Math.abs(dy) + Math.abs(pitch - this.aimPitch);
  }

  muzzlePos(out) {
    if (this.model && !this.hidden) {
      this.model.root.updateMatrixWorld(true);
      return this.model.muzzleWorld(out);
    }
    return out.copy(this.eye).addScaledVector(new THREE.Vector3(-Math.sin(this.aimYaw), 0, -Math.cos(this.aimYaw)), 0.7);
  }

  canFire() {
    return this.alive && this.reloadT <= 0 && this.cooldown <= 0 && this.mag > 0;
  }

  startReload() {
    if (this.reloadT > 0 || this.mags <= 0 || this.mag === this.weapon.mag) return false;
    this.reloadT = this.mag === 0 ? this.weapon.reloadEmpty : this.weapon.reload;
    return true;
  }

  // Выстрел в заданном направлении (с учётом рассеивания оружия)
  fire(dir, weaponOverride) {
    const w = weaponOverride || this.weapon;
    if (!weaponOverride) {
      if (!this.canFire()) return false;
      this.mag--;
      this.cooldown = 60 / w.rpm;
    }
    const mp = this.muzzlePos(new THREE.Vector3());
    this.game.fireProjectile({ weapon: w, pos: mp, dir, owner: this, team: this.team });
    this.fireFlash = 0.06;
    this.shotsFired++;
    if (this.model) this.model.kick = 1;
    return true;
  }

  removeFromScene() {
    if (this.model) this.game.scene.remove(this.model.root);
  }
}
