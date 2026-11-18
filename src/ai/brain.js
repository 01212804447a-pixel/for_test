// ИИ бойцов: восприятие (зрение/слух), память о противнике, обмен данными в группе,
// выбор укрытий, огонь на подавление, экономия боекомплекта, фланговые манёвры,
// гранаты, приказы для своего отделения.
import * as THREE from 'three';
import { clamp, rand, randn, randInt, wrapAngle, lerp } from '../core/math.js';
import { WEAPONS } from '../data/weapons.js';
import { solverFor } from '../entities/soldier.js';

const V = () => new THREE.Vector3();
const _a = V(), _b = V(), _c = V(), _d = V();

function yawTo(dx, dz) { return Math.atan2(-dx, -dz); }
function dirFrom(yaw, pitch, out) {
  return out.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
}

export class Group {
  constructor(game, team, name = '') {
    this.game = game; this.team = team; this.name = name;
    this.members = [];
    this.reports = [];
    this.flankT = rand(8, 14);
    this.inCombat = false;
    this.alerted = false;
    this.onAlert = null;
  }
  add(s) { this.members.push(s); if (s.brain) s.brain.group = this; }
  alive() { return this.members.filter((m) => m.alive); }
  report(from, target, pos) {
    const now = this.game.time;
    for (const m of this.members) {
      if (m === from || !m.alive || !m.brain) continue;
      const d = m.pos.distanceTo(from.pos);
      if (d > 400) continue;
      this.reports.push({ m, target, pos: pos.clone(), at: now + (d < 30 ? rand(0.3, 0.8) : rand(1, 2.5)) });
    }
    if (!this.alerted) { this.alerted = true; if (this.onAlert) this.onAlert(this); }
  }
  update(dt) {
    const now = this.game.time;
    for (let i = this.reports.length - 1; i >= 0; i--) {
      const r = this.reports[i];
      if (r.at > now) continue;
      this.reports.splice(i, 1);
      if (r.m.alive && r.m.brain) r.m.brain.learn(r.target, r.pos, 0.75, false);
    }
    const alive = this.alive();
    this.inCombat = alive.some((m) => m.brain && m.brain.state === 'combat');
    if (!this.inCombat || this.team !== 'denter') return;
    this.flankT -= dt;
    if (this.flankT <= 0) {
      this.flankT = rand(16, 28);
      if (alive.length < 3 || alive.some((m) => m.brain.flankTask)) return;
      const cands = alive.filter((m) => !m.static && (m.role === 'rifleman' || m.role === 'leader') && m.health > 50 && m.ammoFrac > 0.35);
      if (!cands.length) return;
      const f = cands[randInt(0, cands.length - 1)];
      f.brain.planFlank(alive);
    }
  }
  get flanking() { return this.members.some((m) => m.alive && m.brain && m.brain.flankTask); }
}

export class Brain {
  constructor(s, game, opts = {}) {
    this.s = s; this.game = game;
    s.brain = this;
    this.mode = opts.mode || 'guard';
    this.route = opts.route || null; this.routeIdx = 0; this.waitT = 0;
    this.post = opts.post || { x: s.pos.x, z: s.pos.z, yaw: s.yaw };
    this.group = null;
    this.state = 'idle';
    this.memory = new Map();
    this.thinkT = rand(0, 0.3);
    this.path = null; this.pathIdx = 0; this.dest = null; this.moveSpeed = 1.4;
    this.cover = null; this.coverT = 0; this.coverPhase = 'hide'; this.phaseT = 0;
    this.fire = { mode: null, target: null, point: V(), burst: 0, pause: rand(0.5, 1.2), aimT: 0, shotIdx: 0, rangeErr: 1, rangeErrT: 0, lastTarget: null };
    this.aiming = false;
    this.grenadeCD = rand(5, 12);
    this.flankTask = null;
    this.order = opts.order || (s.team === 'negs' || this.mode === 'squad' ? { type: 'follow' } : null);
    this.leaderId = opts.leaderId ?? null; // сетевая игра: командир-игрок этого бойца
    this.prevOrder = null;
    this.slot = opts.slot ?? 0;
    this.investigate = null;
    this.alertT = 0; this.searchT = 0;
    this.lookT = 0; this.lookYaw = s.yaw;
    this.healTarget = null; this.healT = 0;
    this.ammoTarget = null;
    this.atTarget = null; this.atAimT = 0;
    this.lastThink = game.time;
    this.speech = 0;
    this.forced = null;
    this.lastHeard = game.time;
  }

  // командир отделения: свой игрок или (сеть) удалённый игрок
  get leader() {
    const g = this.game;
    if (this.leaderId == null || !g.net || this.leaderId === g.net.net.id) return g.player.body;
    const p = g.net.peers.get(this.leaderId);
    return p && p.soldier ? p.soldier : null;
  }

  // после возрождения
  reset() {
    this.memory.clear(); this.state = 'idle'; this.path = null; this.dest = null;
    this.releaseCover(); this.fire.mode = null; this.fire.target = null; this.fire.burst = 0;
    this.healTarget = null; this.atTarget = null; this.order = { type: 'follow' }; this.prevOrder = null; this.forced = null;
  }

  // ----- знания -----
  learn(target, pos, detect, seen) {
    if (!target || !target.alive) return;
    let m = this.memory.get(target);
    if (!m) { m = { pos: V(), vel: V(), time: -99, lastSeen: -99, detect: 0, seen: false, reported: false }; this.memory.set(target, m); }
    m.pos.copy(pos);
    m.time = this.game.time;
    m.detect = Math.max(m.detect, detect);
    if (seen) { m.seen = true; m.lastSeen = this.game.time; }
    if (this.state === 'idle' || this.state === 'alert' || this.state === 'search') {
      if (m.detect >= 0.7) this.enterCombat();
      else { this.state = 'alert'; this.alertT = rand(15, 25); this.investigate = pos.clone(); }
    }
  }

  onHit(source, dir) {
    const s = this.s;
    if (source && source.pos && source.team !== s.team) {
      const err = source.pos.distanceTo(s.pos) * 0.12;
      _a.copy(source.pos).add(_b.set(randn() * err, 0, randn() * err));
      this.learn(source, _a, 0.8, false);
    }
    if (this.cover) this.coverT = Math.max(this.coverT, 0); // переоценить укрытие
    this.coverPhase = 'hide'; this.phaseT = rand(1.5, 3);
  }

  onSuppress(amount, shooter) {
    const s = this.s;
    s.suppression = Math.min(1, s.suppression + amount * (1 - s.skill.nerve * 0.55));
    if (shooter && shooter.alive && shooter.team !== s.team) {
      const d = shooter.pos.distanceTo(s.pos);
      const err = d * 0.15;
      _a.copy(shooter.pos).add(_b.set(randn() * err, 0, randn() * err));
      const m = this.memory.get(shooter);
      if (!m || !m.seen || this.game.time - m.lastSeen > 2) this.learn(shooter, _a, 0.6, false);
    }
  }

  hear(n) {
    const s = this.s;
    const d = n.pos.distanceTo(s.pos);
    if (d > n.radius) return;
    if (n.team !== s.team && n.src && n.src.alive) {
      const err = Math.max(3, d * 0.1);
      _a.copy(n.pos).add(_b.set(randn() * err, 0, randn() * err));
      const det = d < n.radius * 0.35 ? 0.75 : 0.5;
      const m = this.memory.get(n.src);
      if (!m || this.game.time - m.lastSeen > 1.5) this.learn(n.src, _a, det, false);
    } else if (n.team === s.team && this.state === 'idle' && d < n.radius * 0.7) {
      this.state = 'alert'; this.alertT = rand(15, 25); this.investigate = n.pos.clone();
    }
  }

  enterCombat() {
    if (this.state !== 'combat') {
      this.state = 'combat';
      this.coverT = 0;
      if (this.s.team === 'denter' && this.speech <= 0) {
        this.speech = 6;
        this.game.shout(this.s, ['Контакт!', 'Противник!', 'Вижу их!', 'К бою!'][randInt(0, 3)]);
      }
    }
  }

  // ----- главный цикл -----
  update(dt) {
    const s = this.s;
    if (!s.alive) return;
    this.speech -= dt;
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      const tdt = this.game.time - this.lastThink;
      this.lastThink = this.game.time;
      this.thinkT = rand(0.22, 0.38);
      this.perceive(Math.min(tdt, 0.6));
      this.think(Math.min(tdt, 0.6));
    }
    this.act(dt);
  }

  visRange() {
    return this.game.visibility * (0.75 + this.s.skill.reaction * 0.35);
  }

  perceive(tdt) {
    const s = this.s, g = this.game;
    const vr = this.visRange();
    const fwdX = -Math.sin(s.aimYaw), fwdZ = -Math.cos(s.aimYaw);
    for (const t of g.targetsFor(s.team)) {
      let m = this.memory.get(t);
      const dx = t.pos.x - s.pos.x, dz = t.pos.z - s.pos.z;
      // дрон в небе: считаем полное расстояние; слышно его метров за 200, глазом — маленькая точка
      const d = t.isDrone ? t.pos.distanceTo(s.eye) : Math.hypot(dx, dz);
      const flashBoost = t.fireFlash > 0 || (g.time - (t.lastShotTime || -9) < 0.8) ? (g.isNight ? 3.5 : 1.8) : 1;
      const range = t.isDrone ? Math.min(270, vr) : vr * (flashBoost > 1 ? 1.6 : 1) * (t.isVehicle ? 1.5 : 1);
      if (d > range) { if (m) { m.seen = false; m.detect = Math.max(0, m.detect - tdt * 0.1); } continue; }
      const hd = Math.hypot(dx, dz);
      const cosA = hd > 0.1 ? (dx * fwdX + dz * fwdZ) / hd : 1;
      let fov = cosA > 0.55 ? 1 : cosA > -0.1 ? 0.35 : (d < 7 ? 0.4 : 0);
      if (t.isDrone) fov = Math.max(fov, d < 220 ? 0.5 : 0); // жужжание винтов — поднимают голову
      if (this.state === 'combat' && fov < 0.35) fov = 0.2;
      if (fov === 0) { if (m) m.seen = false; continue; }
      const head = t.eye || t.pos, chest = t.chest || t.pos;
      const ig = t.isVehicle ? t : (t.vehicle || null);
      const vis = g.world.los(s.eye, head, ig, s.vehicle) || g.world.los(s.eye, chest, ig, s.vehicle);
      if (!vis) { if (m) { m.seen = false; m.detect = Math.max(0, m.detect - tdt * 0.12); } continue; }
      if (!m) { m = { pos: V(), vel: V(), time: -99, lastSeen: -99, detect: 0, seen: false, reported: false }; this.memory.set(t, m); }
      const stanceF = t.stance === 'prone' ? 0.3 : t.stance === 'crouch' ? 0.6 : 1;
      const sp = t.vel ? Math.hypot(t.vel.x, t.vel.z) : 0;
      const moveF = sp > 3 ? 2 : sp > 0.6 ? 1.4 : 1;
      const camoF = t.team === 'negs' && !t.isVehicle ? (g.isNight ? 0.85 : 0.7) : 1;
      const distF = Math.pow(clamp(1 - d / range, 0, 1), 2) * 2.2 + (d < 40 ? 1.5 : 0);
      const alertF = this.state === 'combat' ? 2.8 : this.state === 'alert' || this.state === 'search' ? 1.7 : 1;
      const rate = distF * stanceF * moveF * camoF * fov * flashBoost * alertF * (t.isVehicle ? 2 : t.isDrone ? 0.6 : 1) * (0.55 + s.skill.reaction * 0.8) * (1 - s.suppression * 0.5);
      m.detect = Math.min(1.5, m.detect + rate * tdt);
      if (d < 5) m.detect = 1.5;
      if (m.detect >= 1) {
        const first = !m.seen && g.time - m.lastSeen > 4;
        m.seen = true; m.lastSeen = g.time; m.time = g.time;
        m.pos.copy(t.pos); if (t.vel) m.vel.copy(t.vel);
        if (first && this.group) this.group.report(s, t, t.pos);
        if (this.state !== 'combat') this.enterCombat();
      } else if (m.detect > 0.35 && this.state === 'idle') {
        this.state = 'alert'; this.alertT = rand(12, 20); this.investigate = t.pos.clone();
        m.pos.copy(t.pos); m.time = g.time;
      } else m.seen = false;
    }
    // слух
    for (const n of g.noises) {
      if (n.time <= this.lastHeard) continue;
      this.hear(n);
    }
    this.lastHeard = g.time;
  }

  bestThreat() {
    const s = this.s, now = this.game.time;
    let best = null, bestScore = -1e9, bestT = null;
    for (const [t, m] of this.memory) {
      if (!t.alive || (t.isVehicle && !t.crewTeam)) { this.memory.delete(t); continue; }
      // дрон замечают постепенно (маленький): накопленное обнаружение не сбрасываем
      if (now - m.time > 60 && !(t.isDrone && m.detect > 0)) { this.memory.delete(t); continue; }
      if (m.detect < 0.5 && !m.seen) continue;
      const d = m.pos.distanceTo(s.pos);
      let sc = (m.seen ? 200 : 0) - d * 0.3 - (now - m.time) * 3;
      if (t.isPlayer) sc += 5;
      if (t.isDrone) sc -= 150; // по дрону — когда нет целей на земле
      if (t.isVehicle) sc += this.s.secondary && this.s.secondary.mag + this.s.secondary.mags > 0 ? 60 : -40;
      if (sc > bestScore) { bestScore = sc; best = m; bestT = t; }
    }
    return best ? { t: bestT, m: best } : null;
  }

  // ----- решения -----
  think(tdt) {
    const s = this.s, g = this.game, now = g.time;
    const th = this.bestThreat();
    const known = th && now - th.m.time < 25;
    if (known) { if (this.state !== 'combat') this.enterCombat(); }
    else if (this.state === 'combat') { this.state = 'search'; this.searchT = rand(15, 25); this.investigate = th ? th.m.pos.clone() : null; this.fire.mode = null; }

    if (s.team === 'negs' || this.mode === 'squad') { this.thinkSquad(th, known); return; }

    if (this.state === 'combat') this.thinkCombat(th);
    else if (this.state === 'search') {
      this.fire.mode = null;
      this.searchT -= tdt;
      if (this.investigate && !this.path && !s.static) this.goTo(this.investigate.x, this.investigate.z, 1.8);
      if (this.searchT <= 0) { this.state = 'alert'; this.alertT = 15; this.investigate = null; }
    } else if (this.state === 'alert') {
      this.fire.mode = null;
      this.alertT -= tdt;
      if (this.investigate && !s.static) {
        const d = Math.hypot(this.investigate.x - s.pos.x, this.investigate.z - s.pos.z);
        if (d > 6 && !this.path) this.goTo(this.investigate.x, this.investigate.z, 1.6);
        this.lookYaw = yawTo(this.investigate.x - s.pos.x, this.investigate.z - s.pos.z);
      }
      if (this.alertT <= 0) { this.state = 'idle'; this.investigate = null; this.returnToPost(); }
    } else {
      this.thinkIdle(tdt);
    }
  }

  returnToPost() {
    if (this.s.static) return;
    if (this.mode === 'guard' || this.mode === 'hvt') this.goTo(this.post.x, this.post.z, 1.4);
  }

  thinkIdle(tdt) {
    const s = this.s;
    this.fire.mode = null;
    if (s.static) return;
    if (this.forced) {
      if (!this.path || (this.dest && Math.hypot(this.dest.x - this.forced.x, this.dest.z - this.forced.z) > 3)) this.goTo(this.forced.x, this.forced.z, this.forced.speed || 3);
      return;
    }
    if (this.mode === 'patrol' && this.route && this.route.length) {
      if (!this.path) {
        if (this.waitT > 0) { this.waitT -= tdt; return; }
        const p = this.route[this.routeIdx];
        if (Math.hypot(p.x - s.pos.x, p.z - s.pos.z) < 1.5) {
          this.routeIdx = (this.routeIdx + 1) % this.route.length; this.waitT = rand(2, 6);
          this.lookYaw = s.yaw + rand(-1, 1);
        } else this.goTo(p.x, p.z, 1.35);
      }
    } else if (this.mode === 'assault' && this.dest0) {
      if (!this.path && Math.hypot(this.dest0.x - s.pos.x, this.dest0.z - s.pos.z) > 5) this.goTo(this.dest0.x, this.dest0.z, 3.2);
    } else if (this.mode === 'guard' || this.mode === 'hvt') {
      if (!this.path && Math.hypot(this.post.x - s.pos.x, this.post.z - s.pos.z) > 2) this.goTo(this.post.x, this.post.z, 1.4);
    }
  }

  thinkCombat(th) {
    const s = this.s, g = this.game, now = g.time;
    if (!th) return;
    const m = th.m, t = th.t;
    const dist = m.pos.distanceTo(s.pos);
    const visibleNow = m.seen && now - m.lastSeen < 0.6;
    const ammo = s.ammoFrac;
    const economy = ammo < 0.45;
    const critical = ammo < 0.12;

    // перезарядка
    if (s.reloadT <= 0 && (s.mag === 0 || (s.mag < s.weapon.mag * 0.3 && !visibleNow))) {
      if (s.startReload()) { this.coverPhase = 'hide'; this.phaseT = s.reloadT + 0.3; }
    }

    // противотанкист против техники
    if (t.isVehicle && s.secondary && s.secondary.mag + s.secondary.mags > 0 && visibleNow && dist < 380) {
      this.atTarget = t;
    } else this.atTarget = null;

    // выбор режима огня
    const f = this.fire;
    const supAllowed = s.role !== 'sniper' && s.role !== 'hvt';
    const groupFlank = this.group && this.group.flanking && !this.flankTask;
    if (visibleNow) {
      f.mode = 'aimed'; f.target = t;
    } else if (supAllowed && now - m.time < 9 && (ammo > 0.5 || (groupFlank && ammo > 0.32)) && s.suppression < 0.85) {
      f.mode = 'suppress'; f.target = t;
      f.point.copy(m.pos); f.point.y += t.isVehicle ? 1.2 : 0.9;
    } else f.mode = null;
    this.economy = economy;

    if (s.static) { this.coverPhase = s.suppression > 0.6 ? 'hide' : 'peek'; return; }
    if (s.vehicle) return;
    if (this.forced) {
      if (!this.path || (this.dest && Math.hypot(this.dest.x - this.forced.x, this.dest.z - this.forced.z) > 3)) { this.releaseCover(); this.goTo(this.forced.x, this.forced.z, this.forced.speed || 3); }
      return;
    }

    // гранаты
    this.grenadeCD -= 0.3;
    if (s.grenades > 0 && this.grenadeCD <= 0 && !visibleNow && dist > 9 && dist < 32 && now - m.time < 6 && !t.isVehicle) {
      this.throwGrenade(m.pos);
      this.grenadeCD = rand(14, 25);
      return;
    }

    // нет патронов — ищем у погибших или отходим
    if (critical && s.reloadT <= 0) {
      if (!this.ammoTarget) {
        let best = null, bd = 40;
        for (const o of g.soldiers) {
          if (o.alive || o.team !== s.team || o.looted) continue;
          const d = o.pos.distanceTo(s.pos);
          if (d < bd) { bd = d; best = o; }
        }
        if (best) { this.ammoTarget = best; this.releaseCover(); this.goTo(best.pos.x, best.pos.z, 3.4); }
      }
      if (this.ammoTarget) {
        if (this.ammoTarget.pos.distanceTo(s.pos) < 1.6) {
          this.ammoTarget.looted = true; s.mags += 3; this.ammoTarget = null;
          g.shout(s, 'Пополнил БК!');
        }
        return;
      }
    }

    // манёвр во фланг
    if (this.flankTask) {
      if (!this.path && this.cover && Math.hypot(this.cover.x - s.pos.x, this.cover.z - s.pos.z) < 1) this.flankTask = null;
      else if (!this.path) this.flankTask = null;
      return;
    }

    // укрытие
    this.coverT -= 0.3;
    const atCover = this.cover && Math.hypot(this.cover.x - s.pos.x, this.cover.z - s.pos.z) < 1.2;
    let need = !this.cover || this.coverT <= 0;
    if (atCover && !need) {
      // укрытие скомпрометировано: противник видит нас в положении «укрыт»
      _a.set(s.pos.x, s.pos.y + 0.75, s.pos.z);
      const te = t.eye || t.pos;
      if (visibleNow && g.world.los(te, _a)) need = true;
    }
    if (need && !this.path) {
      const c = this.pickCover(m.pos, t);
      if (c) this.takeCover(c, 3.4);
      else if (!this.cover) { this.coverT = 4; }
    }
  }

  pickCover(threat, t, { center = null, radius = null, flank = false } = {}) {
    const s = this.s, g = this.game;
    const c0 = center || s.pos;
    const R = radius || (s.role === 'mg' || s.role === 'sniper' ? 45 : 32);
    const cands = g.world.coverNear(c0.x, c0.z, R);
    const pref = s.role === 'sniper' ? 250 : s.role === 'mg' ? 140 : s.role === 'assault' ? 40 : 90;
    const te = _d.set(threat.x, threat.y + 1.5, threat.z);
    let best = null, bestS = -1e9;
    let checks = 0;
    for (const p of cands) {
      if (p.occupant && p.occupant !== s && p.occupant.alive) continue;
      const tx = threat.x - p.x, tz = threat.z - p.z;
      const td = Math.hypot(tx, tz);
      if (td < 5) continue;
      const facing = (p.nx * tx + p.nz * tz) / td;
      if (facing > -0.35) continue;
      const travel = Math.hypot(p.x - s.pos.x, p.z - s.pos.z);
      let sc = 4 - travel * 0.12 - Math.abs(td - pref) * 0.012 + (p.full ? 0.4 : 0) - facing * 1.5;
      if (s.team === 'negs' && center) sc -= Math.hypot(p.x - center.x, p.z - center.z) * 0.15;
      // скученность
      for (const o of g.soldiers) {
        if (o === s || !o.alive || o.team !== s.team || !o.brain || !o.brain.cover) continue;
        const dd = Math.hypot(o.brain.cover.x - p.x, o.brain.cover.z - p.z);
        if (dd < 4) sc -= 2.5 * (1 - dd / 4);
      }
      if (sc < bestS - 3) continue;
      if (++checks > 28) break;
      const y = g.world.terrain.heightAt(p.x, p.z);
      _a.set(p.x, y + (p.full ? 1.4 : 0.7), p.z);
      if (!g.world.raycast(te, _a, { mask: 'bullet' })) continue; // не защищает
      // можно ли вести огонь
      const px = p.full ? (p.edge ? p.x + p.tx * 0.8 : p.x) : p.x, pz = p.full ? (p.edge ? p.z + p.tz * 0.8 : p.z) : p.z;
      _b.set(px, y + (p.full ? 1.55 : (p.h < 1.2 ? 1.05 : 1.55)), pz);
      _c.set(threat.x, threat.y + 1.1, threat.z);
      const canFire = (!p.full || p.edge) && !g.world.raycast(_b, _c, { mask: 'sight', vehicles: false });
      sc += canFire ? 3 : (s.role === 'hvt' ? 1 : -1);
      if (sc > bestS) { bestS = sc; best = p; }
    }
    return best;
  }

  takeCover(c, speed) {
    this.releaseCover();
    this.cover = c; c.occupant = this.s;
    this.coverT = rand(10, 22);
    this.coverPhase = 'hide'; this.phaseT = rand(0.5, 1.5);
    this.goTo(c.x, c.z, speed);
  }
  releaseCover() {
    if (this.cover && this.cover.occupant === this.s) this.cover.occupant = null;
    this.cover = null;
  }

  planFlank(members) {
    const s = this.s;
    const th = this.bestThreat();
    if (!th) return;
    const tp = th.m.pos;
    // центр группы
    _a.set(0, 0, 0); let n = 0;
    for (const m of members) { _a.add(m.pos); n++; }
    _a.divideScalar(n);
    const dx = _a.x - tp.x, dz = _a.z - tp.z, d = Math.hypot(dx, dz) || 1;
    const side = Math.random() > 0.5 ? 1 : -1;
    const px = -dz / d * side, pz = dx / d * side;
    const fx = tp.x + px * d * 0.7 + (dx / d) * d * 0.45, fz = tp.z + pz * d * 0.7 + (dz / d) * d * 0.45;
    const c = this.pickCover(tp, th.t, { center: { x: fx, z: fz }, radius: 25, flank: true });
    if (!c) return;
    this.flankTask = { x: c.x, z: c.z };
    this.takeCover(c, 3.8);
    this.game.shout(s, 'Обхожу слева!'.replace('слева', side > 0 ? 'справа' : 'слева'));
  }

  throwGrenade(target) {
    const s = this.s;
    s.grenades--;
    const dx = target.x - s.pos.x, dz = target.z - s.pos.z;
    const D = Math.hypot(dx, dz);
    const err = 1 + D * 0.08 * (1.2 - s.skill.aim);
    const tx = target.x + randn() * err, tz = target.z + randn() * err;
    const ddx = tx - s.pos.x, ddz = tz - s.pos.z, DD = Math.hypot(ddx, ddz);
    const ang = 0.6;
    const v = Math.min(21, Math.sqrt((DD * 9.81 * 1.12) / Math.sin(2 * ang)));
    const vel = V().set((ddx / DD) * v * Math.cos(ang), v * Math.sin(ang), (ddz / DD) * v * Math.cos(ang));
    const pos = V().copy(s.eye); pos.y += 0.2;
    s.yaw = yawTo(dx, dz);
    this.game.throwGrenade(s, pos, vel, 'f1');
    this.game.shout(s, s.team === 'denter' ? 'Граната!' : 'Граната пошла!');
  }

  // ----- отделение игрока -----
  thinkSquad(th, known) {
    const s = this.s, g = this.game, now = g.time;
    const lead = this.leader;
    const o = this.order || { type: 'follow' };
    // командир погиб или ещё не появился — держать позицию и отбиваться
    if (!lead || !lead.alive) { if (o.type === 'follow') this.order = { type: 'hold', pos: s.pos.clone() }; }
    else if (this._leadDead) this.order = { type: 'follow' };
    this._leadDead = !lead || !lead.alive;
    const lv = lead && lead.alive ? lead.vehicle : null;
    // медик
    if (s.role === 'medic' && s.medkits > 0 && !this.healTarget) {
      let best = null, bh = 60;
      for (const a of g.soldiers) {
        if (a === s || !a.alive || a.team !== s.team || a.hidden) continue;
        if (a.health < bh && a.pos.distanceTo(s.pos) < 45) { bh = a.health; best = a; }
      }
      if (best && (!th || th.m.pos.distanceTo(best.pos) > 15 || s.suppression < 0.5)) {
        this.healTarget = best; this.healT = 0; this.releaseCover();
        g.shout(s, best.isPlayer ? 'Кей, держись, иду!' : `${best.callsign}, иду к тебе!`);
      }
    }
    if (this.healTarget) {
      const h = this.healTarget;
      if (!h.alive || h.health >= h.maxHealth * 0.95 || s.medkits <= 0) { this.healTarget = null; }
      else {
        const d = h.pos.distanceTo(s.pos);
        if (d > 1.6) { if (!this.path || this.pathTarget !== h) { this.goTo(h.pos.x, h.pos.z, 3.6); this.pathTarget = h; } }
        else {
          this.path = null;
          this.healT += 0.3;
          if (this.healT > 2.8) { h.heal(45); s.medkits--; this.healTarget = null; g.shout(s, 'Перевязал. Работаем!'); if (h.isPlayer && g.hud) g.hud.message('Медик оказал помощь (+45)'); }
        }
        this.fire.mode = null;
        return;
      }
    }

    // приказ «огонь на подавление»
    if (o.type === 'suppress') {
      if (now > o.until || s.ammoFrac < 0.15) { this.order = this.prevOrder || { type: 'follow' }; }
      else {
        this.fire.mode = 'suppress'; this.fire.target = null;
        this.fire.point.copy(o.pos);
        if (s.mag === 0) s.startReload();
        this.coverPhase = 'peek';
        return;
      }
    }

    // огонь
    const f = this.fire;
    if (th && known) {
      const visibleNow = th.m.seen && now - th.m.lastSeen < 0.6;
      const ammo = s.ammoFrac;
      this.economy = ammo < 0.4;
      if (s.reloadT <= 0 && (s.mag === 0 || (s.mag < s.weapon.mag * 0.3 && !visibleNow))) s.startReload();
      if (th.t.isVehicle && s.secondary && s.secondary.mag + s.secondary.mags > 0 && visibleNow && th.m.pos.distanceTo(s.pos) < 380) this.atTarget = th.t;
      else this.atTarget = null;
      if (visibleNow) { f.mode = 'aimed'; f.target = th.t; }
      else if (s.role === 'mg' && now - th.m.time < 7 && ammo > 0.4) { f.mode = 'suppress'; f.target = th.t; f.point.copy(th.m.pos); f.point.y += 0.9; }
      else f.mode = null;
    } else { f.mode = null; this.atTarget = null; if (s.mag < s.weapon.mag * 0.6 && s.reloadT <= 0) s.startReload(); }

    // посадка в технику
    if (lv && o.type === 'follow') {
      const v = lv;
      if (!s.vehicle && (v.hasFreeSeat() || (v.gunWeapon && !v.seats[1]))) {
        const d = s.pos.distanceTo(v.pos);
        if (d < 4.5) { if (v.gunWeapon && !v.seats[1] && v.type.turret) v.board(s, 1); else v.board(s); this.path = null; return; }
        if (!this.path || this.pathTarget !== v) { this.goTo(v.pos.x, v.pos.z, 4); this.pathTarget = v; }
        return;
      }
      if (s.vehicle) return;
    }
    if (s.vehicle && (!lv || lv !== s.vehicle)) s.vehicle.unboard(s);
    if (s.vehicle) return;

    // позиция
    let anchor;
    if (o.type === 'follow') {
      const offs = [[-3, 4], [3, 4], [-6, 8], [6, 8], [-9, 11], [9, 11]][this.slot % 6];
      const ld = lead && lead.alive ? lead : s;
      const py = ld.yaw;
      const c = Math.cos(py), sn = Math.sin(py);
      anchor = { x: ld.pos.x + c * offs[0] + sn * offs[1], z: ld.pos.z - sn * offs[0] + c * offs[1] };
      const nf = g.world.nav ? g.world.nav.nearestFree(anchor.x, anchor.z) : anchor;
      anchor = nf;
    } else {
      anchor = o.pos;
    }
    if (o.type === 'move' && !this.path && Math.hypot(anchor.x - s.pos.x, anchor.z - s.pos.z) < 2) {
      this.order = { type: 'hold', pos: o.pos.clone ? o.pos.clone() : { ...o.pos } };
    }
    const distAnchor = Math.hypot(anchor.x - s.pos.x, anchor.z - s.pos.z);
    if (th && known && this.state === 'combat') {
      // укрытие рядом с назначенной позицией
      this.coverT -= 0.3;
      const coverFar = this.cover && Math.hypot(this.cover.x - anchor.x, this.cover.z - anchor.z) > 18;
      if ((!this.cover || this.coverT <= 0 || coverFar) && !this.path) {
        const c = this.pickCover(th.m.pos, th.t, { center: anchor, radius: 14 });
        if (c) this.takeCover(c, 4);
        else { this.releaseCover(); if (distAnchor > 3) this.goTo(anchor.x, anchor.z, 3.6); }
      }
    } else {
      if (this.cover) this.releaseCover();
      const run = distAnchor > 15 ? 4.2 : distAnchor > 6 ? 2.6 : 1.6;
      if (distAnchor > (o.type === 'follow' ? 3 : 1.5)) {
        if (!this.path || (this.dest && Math.hypot(this.dest.x - anchor.x, this.dest.z - anchor.z) > 4)) this.goTo(anchor.x, anchor.z, run);
      } else if (o.type !== 'follow') this.path = null;
    }
  }

  // ----- движение -----
  goTo(x, z, speed) {
    const g = this.game, s = this.s;
    const path = g.world.nav ? g.world.nav.findPath(s.pos.x, s.pos.z, x, z) : [{ x, z }];
    this.path = path && path.length ? path : [{ x, z }];
    this.pathIdx = 0; this.dest = { x, z }; this.moveSpeed = speed; this.pathTarget = null;
  }

  act(dt) {
    const s = this.s, g = this.game;
    if (s.vehicle) { this.actVehicleGunner(dt); return; }
    // перемещение
    let vx = 0, vz = 0;
    const moving = this.path && !s.static;
    if (moving) {
      const wp = this.path[this.pathIdx];
      const dx = wp.x - s.pos.x, dz = wp.z - s.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.45) {
        this.pathIdx++;
        if (this.pathIdx >= this.path.length) { this.path = null; }
      } else {
        let sp = this.moveSpeed * (this.healTarget ? 1 : 1) * (s.health < 40 ? 0.7 : 1);
        if (this.pathIdx === this.path.length - 1) sp = Math.min(sp, d * 2 + 0.4);
        vx = (dx / d) * sp; vz = (dz / d) * sp;
      }
    }
    // разведение с соседями
    for (const o of g.soldiers) {
      if (o === s || !o.alive || o.hidden) continue;
      const dx = s.pos.x - o.pos.x, dz = s.pos.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 0.64 && d2 > 1e-6) { const d = Math.sqrt(d2); vx += (dx / d) * (0.8 - d) * 4; vz += (dz / d) * (0.8 - d) * 4; }
    }
    const k = 1 - Math.exp(-8 * dt);
    s.vel.x += (vx - s.vel.x) * k; s.vel.z += (vz - s.vel.z) * k;
    if (!s.static) {
      const nx = s.pos.x + s.vel.x * dt, nz = s.pos.z + s.vel.z * dt;
      _a.set(nx, s.pos.y, nz);
      g.world.collideCircle(_a, 0.3, s.pos.y, 1.7);
      const gy = g.world.groundAt(_a.x, _a.z, s.pos.y);
      if (gy - s.pos.y < 0.65) { s.pos.x = _a.x; s.pos.z = _a.z; s.pos.y += (gy - s.pos.y) * Math.min(1, dt * 12); }
      else { this.path = null; s.vel.set(0, 0, 0); }
    }
    s.speed = Math.hypot(s.vel.x, s.vel.z);

    // стойка
    const atCover = this.cover && !this.path && Math.hypot(this.cover.x - s.pos.x, this.cover.z - s.pos.z) < 1.3;
    this.phaseT -= dt;
    if (atCover) {
      if (this.phaseT <= 0) {
        if (this.coverPhase === 'hide') {
          if ((this.fire.mode || this.atTarget) && s.suppression < 0.7 && s.reloadT <= 0) { this.coverPhase = 'peek'; this.phaseT = rand(2, 4.5); }
          else this.phaseT = rand(0.8, 1.6);
        } else { this.coverPhase = 'hide'; this.phaseT = rand(1.2, 2.8) * (1 + s.suppression * 1.5); }
      }
      if (s.suppression > 0.75 && this.coverPhase === 'peek' && !this.economy && Math.random() < 0.5) { this.coverPhase = 'hide'; this.phaseT = rand(1.5, 3); }
      const c = this.cover;
      if (this.coverPhase === 'hide') s.stance = c.full ? 'crouch' : (c.h < 1.25 ? 'prone' : 'crouch');
      else {
        s.stance = c.full ? 'stand' : (c.h < 1.25 ? 'crouch' : 'stand');
        if (c.full && c.edge) {
          // выглядываем из-за угла
          const px = c.x + c.tx * 0.8, pz = c.z + c.tz * 0.8;
          s.pos.x += (px - s.pos.x) * Math.min(1, dt * 4); s.pos.z += (pz - s.pos.z) * Math.min(1, dt * 4);
        }
      }
    } else if (s.static) {
      s.stance = this.state === 'combat' ? (this.coverPhase === 'hide' ? 'crouch' : 'stand') : 'stand';
      if (this.state === 'combat' && s.suppression > 0.6) s.stance = 'crouch';
    } else if (moving) {
      s.stance = this.state === 'combat' && this.moveSpeed < 2 ? 'crouch' : 'stand';
    } else if (this.state === 'combat') {
      s.stance = s.role === 'mg' || s.role === 'sniper' ? 'prone' : 'crouch';
    } else if (this.healTarget) s.stance = 'crouch';
    else s.stance = this.state === 'alert' ? 'crouch' : 'stand';

    // болевой шок: падает и не стреляет
    if (s.shockT > 0) { s.stance = s.static ? 'crouch' : 'prone'; this.aiming = false; return; }
    // огонь
    const canShoot = !(atCover && this.coverPhase === 'hide') || (s.static && this.coverPhase !== 'hide');
    this.aiming = false;
    if (this.atTarget && canShoot) { this.fireAT(dt); return; }
    if (this.fire.mode && canShoot && s.reloadT <= 0 && !(moving && this.moveSpeed > 3)) {
      this.shoot(dt);
    } else {
      // взгляд по движению / осмотр
      let yaw;
      if (moving && s.speed > 0.3) yaw = Math.atan2(-s.vel.x, -s.vel.z);
      else if (this.state === 'combat' || this.state === 'search') {
        const th = this.bestThreat();
        yaw = th ? yawTo(th.m.pos.x - s.pos.x, th.m.pos.z - s.pos.z) : s.yaw;
      } else {
        this.lookT -= dt;
        if (this.lookT <= 0) { this.lookT = rand(3, 7); this.lookYaw = (this.mode === 'guard' || s.static ? this.post.yaw : s.yaw) + rand(-1.1, 1.1); }
        yaw = this.lookYaw;
      }
      s.turnTowards(yaw, 0, dt, 3);
    }
  }

  // Прицеливание и стрельба (единая баллистика с игроком)
  shoot(dt) {
    const s = this.s, g = this.game, f = this.fire;
    let aimP;
    const tgt = f.target;
    if (f.mode === 'aimed' && tgt && tgt.alive) {
      aimP = _a.copy(tgt.chest || tgt.pos);
      if (tgt.isVehicle) aimP.y = tgt.pos.y + 1.1;
      const d = s.eye.distanceTo(aimP);
      if (d < 30 && s.skill.aim > 0.6 && s.suppression < 0.3 && !tgt.isVehicle) aimP.copy(tgt.eye || aimP);
    } else if (f.mode === 'suppress') {
      aimP = _a.copy(f.point);
    } else { f.mode = null; return; }
    if (f.lastTarget !== tgt) { f.lastTarget = tgt; f.aimT = 0; f.rangeErrT = 0; f.shotIdx = 0; }
    this.aiming = true;
    const org = s.muzzlePos(_c);
    const dx = aimP.x - org.x, dz = aimP.z - org.z;
    const D = Math.hypot(dx, dz);
    f.rangeErrT -= dt;
    if (f.rangeErrT <= 0) { f.rangeErrT = rand(2.5, 5); f.rangeErr = 1 + randn() * lerp(0.16, 0.05, s.skill.aim); }
    const solver = s.solver;
    const air = f.mode === 'aimed' && tgt && tgt.isDrone;
    // по дрону: наклонная дальность, упреждение по полной скорости, превышение — «правило стрелка» (cos угла места)
    const Dr = air ? Math.hypot(D, aimP.y - org.y) : D;
    const De = Math.max(5, Dr * f.rangeErr);
    // упреждение
    if (f.mode === 'aimed' && tgt.vel) {
      const tof = solver.tofFor(De);
      const lead = air ? lerp(0.85, 1.0, s.skill.aim) : lerp(0.55, 1.0, s.skill.aim);
      aimP.x += tgt.vel.x * tof * lead; aimP.z += tgt.vel.z * tof * lead;
      if (air) aimP.y += tgt.vel.y * tof * lead;
    }
    const yawD = yawTo(aimP.x - org.x, aimP.z - org.z);
    const losPitch = Math.atan2(aimP.y - org.y, D);
    const pitchD = losPitch + solver.angleFor(De) * (air ? Math.cos(losPitch) : 1) - (solver.h || 0) / Math.max(De, 5);
    const err = s.turnTowards(yawD, pitchD, dt, 2.5 + s.skill.reaction * 4.5);
    if (err < 0.05) f.aimT += dt; else f.aimT = Math.max(0, f.aimT - dt * 2);
    f.pause -= dt;
    const moving = s.speed > 0.5;
    const minAim = (this.economy ? 0.9 : 0.25) * (1.4 - s.skill.reaction) + (f.mode === 'suppress' ? -0.15 : 0);
    if (err > 0.08 || f.pause > 0 || f.aimT < minAim || !s.canFire()) return;
    // дружественные на линии огня
    if (this.friendlyInLine(aimP)) { f.pause = 0.6; return; }
    if (f.burst <= 0) {
      const mg = s.role === 'mg';
      const auto = s.weapon.modes.includes('auto');
      if (f.mode === 'suppress') f.burst = mg ? randInt(7, 14) : auto ? randInt(3, 6) : 1;
      else if (this.economy || !auto || s.role === 'sniper') f.burst = mg ? randInt(2, 4) : 1;
      else f.burst = D < 40 ? randInt(3, 6) : D < 150 ? randInt(2, 4) : (mg ? randInt(4, 7) : randInt(1, 2));
      f.shotIdx = 0;
    }
    // ошибка прицеливания
    const st = s.stance === 'prone' ? 0.6 : s.stance === 'crouch' ? 0.8 : 1;
    const settle = 1 + 2.2 * Math.exp(-f.aimT * (1 + s.skill.reaction * 2));
    const base = lerp(0.0065, 0.0016, s.skill.aim);
    let sigma = base * st * (moving ? 2.5 : 1) * (1 + 2.5 * s.suppression) * settle * (1 + 0.35 * f.shotIdx) * (this.economy ? 0.6 : 1);
    if (g.isNight) sigma *= 1.35;
    if (f.mode === 'suppress') {
      const spread = 1.2 + D * 0.015;
      aimP.x += randn() * spread; aimP.z += randn() * spread * 0.6; aimP.y += randn() * 0.5;
    }
    const yawS = s.aimYaw + randn() * sigma;
    const pitchS = s.aimPitch + randn() * sigma * 0.8;
    // при подавлении целимся заново в разброс точки
    const dir = dirFrom(yawS, pitchS, _b);
    if (s.fire(dir.clone())) {
      s.lastShotTime = g.time;
      f.burst--; f.shotIdx++;
      if (f.burst <= 0) {
        if (f.mode === 'suppress') f.pause = s.role === 'mg' ? rand(0.6, 1.6) : rand(1.0, 2.6);
        else f.pause = this.economy ? rand(1.0, 2.2) : rand(0.25, 0.75);
        if (this.economy) f.aimT = 0;
      }
    } else if (s.mag === 0) s.startReload();
  }

  friendlyInLine(aimP) {
    const s = this.s, g = this.game;
    const ex = aimP.x - s.eye.x, ey = aimP.y - s.eye.y, ez = aimP.z - s.eye.z;
    const L = Math.hypot(ex, ey, ez);
    for (const o of g.soldiers) {
      if (o === s || !o.alive || o.team !== s.team || o.hidden) continue;
      const ox = o.chest.x - s.eye.x, oy = o.chest.y - s.eye.y, oz = o.chest.z - s.eye.z;
      const t = (ox * ex + oy * ey + oz * ez) / (L * L);
      if (t < 0 || t > 1) continue;
      const cx = ox - ex * t, cy = oy - ey * t, cz = oz - ez * t;
      if (cx * cx + cy * cy + cz * cz < 1.4) return true;
    }
    return false;
  }

  fireAT(dt) {
    const s = this.s, g = this.game, t = this.atTarget;
    if (!t.alive) { this.atTarget = null; return; }
    const sec = s.secondary;
    if (sec.mag <= 0) { if (sec.mags > 0) { sec.mags--; sec.mag = 1; this.atAimT = -sec.def.reload; } return; }
    this.aiming = true;
    const aimP = _a.copy(t.pos); aimP.y += 1.1;
    const D = Math.hypot(aimP.x - s.eye.x, aimP.z - s.eye.z);
    const solver = solverFor('rpg7', g.zeroEnv);
    const tof = solver.tofFor(D);
    if (t.vel) { aimP.x += t.vel.x * tof * 0.8; aimP.z += t.vel.z * tof * 0.8; }
    const yawD = yawTo(aimP.x - s.eye.x, aimP.z - s.eye.z);
    const pitchD = Math.atan2(aimP.y - s.eye.y, D) + solver.angleFor(D * (1 + randn() * 0.06));
    const err = s.turnTowards(yawD, pitchD, dt, 2);
    s.stance = 'crouch';
    if (err < 0.03) this.atAimT += dt; else this.atAimT = Math.min(this.atAimT, 0);
    if (this.atAimT > 1.8) {
      const sig = 0.004 * (1 + s.suppression * 2);
      const dir = dirFrom(s.aimYaw + randn() * sig, s.aimPitch + randn() * sig, V());
      s.fire(dir, WEAPONS.rpg7);
      g.shout(s, s.team === 'negs' ? 'Выстрел!' : 'РПГ!');
      sec.mag--; this.atAimT = -2;
    }
  }

  actVehicleGunner(dt) {
    // экипаж/десант стреляет только из турели (если сидит за ней)
    const s = this.s, v = s.vehicle;
    if (!v || v.gunner !== s || !v.turret) return;
    const th = this.bestThreat();
    if (!th || !th.m.seen || this.game.time - th.m.lastSeen > 1) return;
    v.aiTurretAim(dt, th.t, s);
  }
}
