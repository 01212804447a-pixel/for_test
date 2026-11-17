// Игрок (сержант Кей): передвижение, стойки, выносливость, раскачка оружия и дыхание,
// отдача, прицеливание через целик/мушку и оптику, гранаты, бинокль, техника.
// Никакой точки прицеливания: пуля летит из дульного среза по оси ствола.
import * as THREE from 'three';
import { Soldier, solverFor } from './soldier.js';
import { WEAPONS, SCOPES, AMMO, defaultPattern } from '../data/weapons.js';
import { clamp, lerp, randn, rand, MIL, wrapAngle } from '../core/math.js';
import { MODEL_INFO } from '../weapons/viewmodel.js';

const VM_KIND = { ak74m: 'ak74', ak74m_gp: 'ak74gp', ak74m_1p78: 'ak74scope', akm: 'akm', svd: 'svd', pkm: 'pkm', rpg7: 'rpg7', pkp_mount: 'pkm' };

export function makeState(id, loads = null) {
  const def = WEAPONS[id];
  const st = { def, id, mag: def.mag, spare: Array(def.mags).fill(def.mag), sightIdx: 0, mode: def.modes[0], optic: true };
  // порядок патронов в магазине/ленте: [0] — первый выстрел
  const pat = loads && loads[id];
  st.pattern = pat && pat.length === def.mag ? pat.slice() : (def.ammo.startsWith('545') || def.ammo.startsWith('762') ? defaultPattern(id) : null);
  if (def.ugl) { const u = WEAPONS[def.ugl]; st.ugl = { def: u, id: def.ugl, mag: 1, spare: Array(u.mags).fill(1), sightIdx: 3 }; }
  if (def.sight.type === 'scope' && def.sight.scope === 'pso1') st.sightIdx = 2;
  if (def.sight.type === 'iron') st.sightIdx = 0;
  return st;
}

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');

export class Player {
  constructor(game, loadout = {}) {
    this.game = game;
    const primary = loadout.primary || 'ak74m';
    this.body = new Soldier(game, { team: 'negs', isPlayer: true, name: 'Кей', callsign: 'Кей', weapon: primary, armor: 0.8, helmet: 0.6, x: loadout.x || 0, z: loadout.z || 0, grenades: 3, medkits: 2, health: 100 });
    this.body.isPlayer = true;
    this.yaw = loadout.yaw || 0; this.pitch = 0;
    this.body.yaw = this.yaw;
    this.eyeH = 1.62;
    this.stamina = 1; this.breath = 1; this.breathLock = 0; this.holding = false;
    const loads = (game.app && game.app.save && game.app.save.loads) || null;
    this.slots = [makeState(primary, loads)];
    this.slots.push(loadout.launcher ? makeState('rpg7') : null);
    this.slots.push({ id: 'grenade', grenade: true, count: 3 });
    this.slots.push({ id: 'b8', binocular: true });
    this.cur = 0;
    this.aim = false; this.aimT = 0;
    this.uglMode = false;
    this.sway = { x: 0, y: 0, phase: 0, t: Math.random() * 100 };
    this.inertia = { x: 0, y: 0, vx: 0, vy: 0 };
    this.rec = { p: 0, y: 0, vp: 0, vy: 0, kick: 0 };
    this.walkPhase = 0;
    this.switchT = 0; this.reloadT = 0; this.reloadTotal = 0;
    this.medT = 0;
    this.fireCD = 0; this.flashT = 0;
    this.vehicle = null; this.seat = -1; this.camThird = true; this.camYaw = 0; this.camPitch = -0.15;
    this.gunnerSight = true;
    this.sprintT = 0;
    this.shake = 0;
    this.suppression = 0;
    this.interact = null; this.holdE = 0;
    this.vel = this.body.vel;
    this.onGround = true; this.vy = 0;
    this.sightPos = new THREE.Vector3(); this.sightQuat = new THREE.Quaternion();
    this.scoped = false;
    this.lookQuat = new THREE.Quaternion();
    this.thetaCache = new Map();
    this.hb = [];
    for (let i = 0; i < 5; i++) this.hb.push({ a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0, zone: '' });
    this.body.hitboxes = this.hb;
    this.fallStart = null;
    this.nextFoot = 0;
  }

  get pos() { return this.body.pos; }
  get state() { return this.slots[this.cur]; }
  get activeWeapon() {
    if (this.vehicle && this.seat === 1 && this.vehicle.type.gunExposed) return this.mountState || (this.mountState = makeState('pkp_mount', (this.game.app && this.game.app.save.loads) || null));
    const s = this.state;
    if (!s || s.grenade || s.binocular) return null;
    if (this.uglMode && s.ugl) return s.ugl;
    return s;
  }

  vmKind() {
    if (this.vehicle && this.seat === 1 && this.vehicle.type.gunExposed) return 'pkm';
    const s = this.state;
    if (!s) return 'ak74';
    if (s.grenade) return 'grenade';
    if (s.binocular) return 'b8';
    if (this.uglMode && s.ugl) return 'gp25';
    if (s.id === 'rpg7') return s.optic ? 'rpg7' : 'rpg7iron';
    return VM_KIND[s.id] || 'ak74';
  }

  // Описание прицела текущего оружия
  sightOf(ws) {
    const def = ws.def;
    let sight = def.sight;
    if (ws.id === 'rpg7' && !ws.optic) sight = def.altSight;
    return sight;
  }

  // Угол прицеливания θ (ствол относительно линии прицеливания) для текущей установки
  theta(ws) {
    const sight = this.sightOf(ws);
    const solver = solverFor(ws.id === 'pkp_mount' ? 'pkm' : ws.id, this.game.zeroEnv);
    if (sight.type === 'iron') {
      const st = sight.settings[clamp(ws.sightIdx, 0, sight.settings.length - 1)];
      return solver.angleFor(st.range);
    }
    const sc = SCOPES[sight.scope];
    if (sc.drum) return solver.angleFor(sc.drum[clamp(ws.sightIdx, 0, sc.drum.length - 1)]);
    return solver.angleFor(sc.zero);
  }

  scopeMarks(ws) {
    const sight = this.sightOf(ws);
    if (sight.type !== 'scope') return { marks: [], extra: [] };
    const key = ws.id + sight.scope;
    if (this.thetaCache.has(key)) return this.thetaCache.get(key);
    const sc = SCOPES[sight.scope];
    const solver = solverFor(ws.id, this.game.zeroEnv);
    const res = { marks: [], extra: [] };
    if (sc.marks) { const z = solver.angleFor(sc.zero); res.marks = sc.marks.map((r) => ({ range: r, ang: solver.angleFor(r) - z })); }
    if (sc.extra) { const z = solver.angleFor(1000); res.extra = sc.extra.map((r) => solver.angleFor(r) - z); }
    this.thetaCache.set(key, res);
    return res;
  }

  sightLabel(ws) {
    if (!ws) return '';
    const sight = this.sightOf(ws);
    if (sight.type === 'iron') {
      const st = sight.settings[ws.sightIdx];
      return sight.quadrant ? `Квадрант: ${st.label} м` : `Прицел: ${st.label}`;
    }
    const sc = SCOPES[sight.scope];
    if (sc.drum) return `${sc.name}: маховичок ${ws.sightIdx + 1}`;
    return `${sc.name} (пристрелка ${sc.zero} м)`;
  }

  changeSight(ws, d) {
    const sight = this.sightOf(ws);
    let n;
    if (sight.type === 'iron') n = sight.settings.length;
    else { const sc = SCOPES[sight.scope]; if (!sc.drum) return; n = sc.drum.length; }
    const ni = clamp(ws.sightIdx + d, 0, n - 1);
    if (ni !== ws.sightIdx) { ws.sightIdx = ni; this.game.audio.mech('sight'); }
  }

  // ================= обновление =================
  update(dt) {
    const g = this.game, inp = g.input, b = this.body;
    if (!b.alive) return;
    const sens = g.settings.sens * 0.001;
    // обзор мышью
    const fovK = this.scoped ? (g.camera.fov / g.settings.fov) : this.aimT > 0.5 ? 0.75 : 1;
    const mdx = inp.dx * sens * fovK, mdy = inp.dy * sens * fovK * (g.settings.invertY ? -1 : 1);
    if (this.vehicle) { this.updateVehicle(dt, mdx, mdy); return; }
    this.yaw -= mdx; this.pitch = clamp(this.pitch - mdy, -1.45, 1.45);
    // инерция оружия: ствол отстаёт от поворота головы
    const In = this.inertia;
    In.x += mdx * 0.22; In.y += mdy * 0.22;
    In.vx += (-In.x * 140 - In.vx * 17) * dt; In.vy += (-In.y * 140 - In.vy * 17) * dt;
    In.x += In.vx * dt; In.y += In.vy * dt;
    In.x = clamp(In.x, -0.04, 0.04); In.y = clamp(In.y, -0.04, 0.04);
    this.handleStance(inp);
    this.handleMove(dt, inp);
    this.handleWeapons(dt, inp);
    this.handleMisc(dt, inp);
    b.yaw = this.yaw; b.aimYaw = this.yaw; b.aimPitch = this.pitch;
    this.updateHitboxes();
  }

  handleStance(inp) {
    const b = this.body;
    if (inp.bh('crouch')) b.stance = b.stance === 'crouch' ? 'stand' : 'crouch';
    if (inp.bh('prone')) { b.stance = b.stance === 'prone' ? 'crouch' : 'prone'; this.switchT = Math.max(this.switchT, 0.7); }
  }

  handleMove(dt, inp) {
    const g = this.game, b = this.body, w = g.world;
    let ix = 0, iz = 0;
    if (inp.bd('moveF')) iz -= 1;
    if (inp.bd('moveB')) iz += 1;
    if (inp.bd('moveL')) ix -= 1;
    if (inp.bd('moveR')) ix += 1;
    const len = Math.hypot(ix, iz);
    if (len > 0) { ix /= len; iz /= len; }
    const wantSprint = inp.bd('sprint') && iz < 0 && !this.aim && b.stance !== 'prone' && this.stamina > 0.05 && this.medT <= 0;
    if (wantSprint && b.stance === 'crouch') b.stance = 'stand';
    let speed = b.stance === 'prone' ? 0.55 : b.stance === 'crouch' ? 1.5 : 2.5;
    if (wantSprint) speed = 5.3;
    if (this.aimT > 0.5) speed *= 0.55;
    if (iz > 0) speed *= 0.75;
    if (b.health < 40) speed *= 0.8;
    if (this.reloadT > 0) speed *= 0.85;
    this.sprintT = lerp(this.sprintT, wantSprint && len > 0 ? 1 : 0, 1 - Math.exp(-8 * dt));
    // выносливость
    if (wantSprint && len > 0) this.stamina = Math.max(0, this.stamina - dt * 0.11);
    else this.stamina = Math.min(1, this.stamina + dt * (b.stance === 'prone' ? 0.12 : b.stance === 'crouch' ? 0.09 : 0.065) * (len > 0 ? 0.6 : 1));
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const wx = (c * ix + s * iz) * speed, wz = (-s * ix + c * iz) * speed;
    const acc = this.onGround ? 10 : 1.5;
    b.vel.x += (wx - b.vel.x) * Math.min(1, acc * dt);
    b.vel.z += (wz - b.vel.z) * Math.min(1, acc * dt);
    // прыжок и гравитация
    if (inp.bh('jump') && this.onGround && b.stance === 'stand') { this.vy = 3.8; this.onGround = false; this.stamina = Math.max(0, this.stamina - 0.06); }
    this.vy -= 9.81 * dt;
    _v.set(b.pos.x + b.vel.x * dt, b.pos.y, b.pos.z + b.vel.z * dt);
    const height = b.stance === 'prone' ? 0.5 : b.stance === 'crouch' ? 1.2 : 1.75;
    w.collideCircle(_v, 0.32, b.pos.y, height);
    // граница района
    const R = Math.hypot(_v.x, _v.z);
    if (R > 1120) { _v.x *= 1120 / R; _v.z *= 1120 / R; }
    let gy = w.groundAt(_v.x, _v.z, b.pos.y);
    if (gy - b.pos.y > 0.6) { _v.x = b.pos.x; _v.z = b.pos.z; gy = w.groundAt(_v.x, _v.z, b.pos.y); }
    if (w.terrain.hasSea && gy < -0.9) { _v.x = b.pos.x; _v.z = b.pos.z; gy = w.groundAt(_v.x, _v.z, b.pos.y); } // вода
    b.pos.x = _v.x; b.pos.z = _v.z;
    b.pos.y += this.vy * dt;
    if (b.pos.y <= gy) {
      if (!this.onGround && this.fallStart !== null && this.fallStart - gy > 4) b.damage((this.fallStart - gy - 4) * 12, 'leg', null, null);
      b.pos.y = gy; this.vy = 0; this.onGround = true; this.fallStart = null;
    } else if (b.pos.y > gy + 0.25) { if (this.onGround) this.fallStart = b.pos.y; this.onGround = false; }
    else { b.pos.y = gy; this.vy = Math.min(this.vy, 0); this.onGround = true; }
    const sp = Math.hypot(b.vel.x, b.vel.z);
    b.speed = sp;
    this.walkPhase += dt * sp * 2.2;
    if (sp > 0.6 && this.onGround) {
      this.nextFoot -= dt * sp;
      if (this.nextFoot <= 0) { this.nextFoot = 1.6; this.game.audio.footstep(null, true, b.stance === 'stand' ? (wantSprint ? 0.16 : 0.1) : 0.05); }
    }
    const tH = b.stance === 'prone' ? 0.38 : b.stance === 'crouch' ? 1.1 : 1.62;
    this.eyeH = lerp(this.eyeH, tH, 1 - Math.exp(-10 * dt));
  }

  handleWeapons(dt, inp) {
    const g = this.game, b = this.body;
    this.fireCD -= dt; this.flashT -= dt;
    this.shotAge = (this.shotAge ?? 9) + dt;
    // смена оружия
    let want = -1;
    for (let i = 0; i < 4; i++) if (inp.bh('slot' + (i + 1))) want = i;
    if (!this.aim && inp.wheel !== 0 && want < 0) {
      let n = this.cur;
      for (let k = 0; k < 4; k++) { n = (n + (inp.wheel > 0 ? 1 : 3)) % 4; if (this.slots[n]) break; }
      want = n;
    }
    if (want >= 0 && want !== this.cur && this.slots[want] && this.reloadT <= 0) {
      this.cur = want; this.switchT = 0.6; this.uglMode = false; this.binocQuick = false; this.game.audio.mech('switch');
    }
    // бинокль одной клавишей: достать и сразу смотреть / убрать и вернуть оружие
    if (inp.bh('binoc') && this.reloadT <= 0) {
      if (this.cur === 3 && this.binocQuick) { this.cur = this.prevSlot ?? 0; this.binocQuick = false; this.switchT = 0.35; }
      else { this.prevSlot = this.cur === 3 ? 0 : this.cur; this.cur = 3; this.binocQuick = true; this.switchT = 0.25; this.uglMode = false; }
      this.game.audio.mech('switch');
    }
    if (this.switchT > 0) this.switchT -= dt;
    const ws = this.state;
    // прицеливание
    const canAim = this.sprintT < 0.3 && this.switchT <= 0 && this.medT <= 0 && !(ws && ws.grenade) && !(b.shockT > 0);
    this.aim = (inp.bd('aim') || (this.binocQuick && this.cur === 3)) && canAim && this.reloadT <= 0;
    this.aimT = lerp(this.aimT, this.aim ? 1 : 0, 1 - Math.exp(-(this.aim ? 11 : 14) * dt));
    // задержка дыхания
    const wantHold = this.aim && inp.bd('sprint') && this.breathLock <= 0 && this.breath > 0;
    this.holding = wantHold;
    if (wantHold) { this.breath = Math.max(0, this.breath - dt / 6); if (this.breath <= 0) this.breathLock = 3; }
    else { this.breath = Math.min(1, this.breath + dt * 0.22); this.breathLock = Math.max(0, this.breathLock - dt); }

    if (!ws) return;
    if (ws.grenade) { this.handleGrenade(dt, inp, ws); this.computePose(dt); return; }
    if (ws.binocular) { this.computePose(dt); if (this.aim && inp.bh('fire')) g.spotterRange(); if (this.binocQuick && inp.bd('moveF') && inp.bd('sprint')) { this.cur = this.prevSlot ?? 0; this.binocQuick = false; } return; }
    const aw = this.activeWeapon;
    // переключатели
    if (inp.bh('ugl') && ws.ugl) { this.uglMode = !this.uglMode; this.switchT = 0.45; g.audio.mech('switch'); }
    if (inp.bh('firemode') && aw.def.modes.length > 1) { const i = aw.def.modes.indexOf(aw.mode); aw.mode = aw.def.modes[(i + 1) % aw.def.modes.length]; g.audio.click(); g.hud.message(aw.mode === 'auto' ? 'Автоматический огонь' : 'Одиночный огонь', 1.2); }
    if (inp.bh('optic') && ws.id === 'rpg7') { ws.optic = !ws.optic; this.switchT = 0.8; g.hud.message(ws.optic ? 'Оптический прицел ПГО-7' : 'Механический прицел', 1.5); }
    if (inp.bh('sightUp') || inp.hit('PageUp') || (this.aim && inp.wheel < 0)) this.changeSight(aw, 1);
    if (inp.bh('sightDown') || inp.hit('PageDown') || (this.aim && inp.wheel > 0)) this.changeSight(aw, -1);
    // перезарядка
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.finishReload(aw);
    } else if (inp.bh('reload') && aw.spare.length && aw.mag < aw.def.mag + (aw.def.mag > 1 ? 1 : 0)) {
      this.reloadTotal = this.reloadT = aw.mag === 0 ? aw.def.reloadEmpty : aw.def.reload;
      this.reloadEmpty = aw.mag === 0;
      this.aim = false;
      g.audio.mech('reload');
    }
    this.computePose(dt);
    // огонь
    const trig = aw.mode === 'auto' ? (inp.bd('fire') || inp.bh('fire')) : inp.bh('fire');
    if (trig && this.fireCD <= 0 && this.reloadT <= 0 && this.switchT <= 0 && this.sprintT < 0.3 && this.medT <= 0 && !(b.shockT > 0)) {
      if (aw.mag > 0) this.fire(aw);
      else if (inp.bh('fire')) { g.audio.click(); }
    }
  }

  finishReload(aw) {
    const keep = aw.mag;
    if (!aw.spare.length) return;
    // берём самый полный магазин, частичный убираем в подсумок
    aw.spare.sort((a, b) => b - a);
    const nm = aw.spare.shift();
    if (keep > 0 && aw.def.mag > 1) { aw.spare.push(keep - 1); aw.mag = nm + 1; }
    else aw.mag = nm;
    aw.spare = aw.spare.filter((x) => x > 0);
  }

  // Положение прицельной линии в пространстве камеры (с раскачкой и отдачей)
  computePose(dt) {
    const g = this.game, b = this.body;
    const aw = this.activeWeapon;
    const def = aw ? aw.def : null;
    const kind = this.vmKind();
    const info = MODEL_INFO[kind];
    // раскачка
    const sw = this.sway;
    sw.t += dt;
    const stanceF = b.stance === 'prone' ? (def && def.id === 'pkm' ? 0.2 : 0.33) : b.stance === 'crouch' ? 0.62 : 1;
    const mounted = this.vehicle ? 0.35 : 1;
    let A = 0.0017 * (def ? def.sway : 1) * stanceF * mounted * (1 + (1 - this.stamina) * 2.2) * (1 + this.suppression * 1.6) * (b.health < 50 ? 1.4 : 1);
    if (this.holding) A *= 0.18;
    if (this.breathLock > 0) A *= 1.8;
    const period = lerp(4.2, 1.5, 1 - this.stamina);
    sw.phase += (dt * Math.PI * 2) / period * (this.holding ? 0.15 : 1);
    const n1 = Math.sin(sw.t * 1.7) * 0.5 + Math.sin(sw.t * 2.9 + 1.3) * 0.3 + Math.sin(sw.t * 5.3 + 0.7) * 0.2;
    const n2 = Math.sin(sw.t * 1.3 + 2.1) * 0.5 + Math.sin(sw.t * 3.7 + 0.4) * 0.3 + Math.sin(sw.t * 6.1 + 2.7) * 0.2;
    let sx = A * (0.5 * Math.sin(sw.phase * 0.5 + 1.3) + 0.55 * n1);
    let sy = A * (0.9 * Math.sin(sw.phase) + 0.5 * n2);
    // ходьба
    const sp = b.speed;
    if (sp > 0.3) {
      const k = this.aimT > 0.5 ? 0.005 : 0.014;
      sx += Math.sin(this.walkPhase) * k * Math.min(1, sp / 2.5);
      sy += Math.abs(Math.cos(this.walkPhase)) * k * 0.7 * Math.min(1, sp / 2.5);
    }
    // отдача (пружина)
    const r = this.rec;
    r.vp += (-r.p * 160 - r.vp * 19) * dt; r.p += r.vp * dt;
    r.vy += (-r.y * 160 - r.vy * 19) * dt; r.y += r.vy * dt;
    r.kick = Math.max(0, r.kick - dt * 10);
    const ox = sx + this.inertia.x + r.y;
    const oy = sy + this.inertia.y + r.p;
    // позиция
    const a = this.aimT * this.aimT * (3 - 2 * this.aimT);
    const hip = info.hip, ads = info.ads;
    const pos = this.sightPos.set(lerp(hip[0], ads[0], a), lerp(hip[1], ads[1], a), lerp(hip[2], ads[2], a) + r.kick * 0.025);
    const hipRot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.03, 0.05, 0.02));
    const q = this.sightQuat.copy(hipRot).slerp(new THREE.Quaternion(), a);
    // вращение вокруг плеча
    const pivot = new THREE.Vector3(0.02, -0.12, 0.16);
    const rq = new THREE.Quaternion().setFromEuler(new THREE.Euler(oy, ox, 0, 'YXZ'));
    pos.sub(pivot).applyQuaternion(rq).add(pivot);
    q.premultiply(rq);
    // бег / перезарядка / смена
    const sprint = this.sprintT;
    let low = 0, tilt = 0;
    const ssf = (a, b2, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b2 - a))); return t * t * (3 - 2 * t); };
    if (this.reloadT > 0) {
      const pr = 1 - this.reloadT / this.reloadTotal;
      // магазинное оружие — наклон к левой руке, гранатомёт — опускается
      if (def && def.mag > 1 && kind !== 'gp25') tilt = ssf(0, 0.1, pr) * (1 - ssf(0.86, 1, pr));
      else low = Math.sin(Math.PI * pr);
    }
    if (this.switchT > 0) low = Math.max(low, Math.min(1, this.switchT / 0.3));
    if (this.medT > 0) low = 1;
    this.reloadP = this.reloadT > 0 ? 1 - this.reloadT / this.reloadTotal : -1;
    if (sprint > 0.01 || low > 0.01) {
      pos.x += 0.06 * sprint + 0.02 * low; pos.y -= 0.06 * sprint + 0.12 * low; pos.z += 0.03 * sprint;
      q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.55 * sprint - 0.45 * low, 0.6 * sprint + 0.2 * low, 0.35 * sprint + 0.5 * low)));
    }
    if (tilt > 0.001) {
      // поворот вокруг пистолетной рукоятки: магазином к левой руке, дульной частью чуть вверх
      const grip = new THREE.Vector3(...(info.gripR || [0, -0.17, 0.17]));
      const before = grip.clone().applyQuaternion(q);
      q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.22 * tilt, 0.12 * tilt, -0.62 * tilt)));
      pos.add(before.sub(grip.applyQuaternion(q)));
      pos.x -= 0.08 * tilt; pos.y += 0.075 * tilt; pos.z += 0.03 * tilt;
    }
    if (kind === 'b8' || kind === 'grenade') {
      // бинокль/граната: проще
      if (kind === 'b8') pos.set(0, lerp(-0.22, 0, a), lerp(-0.3, -0.06, a));
    }
    this.weaponOffset = { ox, oy };
    // оптика?
    const ws = this.state;
    const sight = aw ? this.sightOf(aw) : null;
    this.scoped = this.aimT > 0.93 && ((sight && sight.type === 'scope') || (ws && ws.binocular));
  }

  // Патрон, который сейчас будет выстрелен
  nextRound(aw) {
    if (!aw.pattern) return aw.def.ammo;
    const cap = aw.def.mag;
    const i = Math.max(0, Math.min(cap - 1, cap - aw.mag));
    return aw.pattern[i] || aw.def.ammo;
  }

  fire(aw) {
    const g = this.game, b = this.body;
    const def = aw.def;
    const ammoId = this.nextRound(aw);
    aw.mag--;
    this.fireCD = 60 / def.rpm;
    const theta = this.theta(aw);
    const mp = new THREE.Vector3(), md = new THREE.Vector3();
    g.viewmodel.setKind(this.vmKind());
    g.viewmodel.muzzleCam(mp, md, this.sightPos, this.sightQuat, theta);
    // в мир: положение головы на текущий кадр
    const cam = g.lookCam;
    if (this.vehicle) {
      const tp = new THREE.Vector3(); this.vehicle.model.turret.getWorldPosition(tp);
      cam.position.set(tp.x, tp.y + 0.55, tp.z);
    } else cam.position.set(b.pos.x, b.pos.y + this.eyeH, b.pos.z);
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    cam.updateMatrixWorld(true);
    mp.applyMatrix4(cam.matrixWorld);
    md.transformDirection(cam.matrixWorld);
    // не стрелять «сквозь» стену у лица
    const eye = cam.position;
    const block = g.world.raycast(eye, mp, { mask: 'bullet', vehicles: true, ignore: this.vehicle });
    if (block) mp.copy(eye).lerp(mp, Math.max(0, block.t - 0.05));
    b.shotsFired++;
    g.fireProjectile({ weapon: def, pos: mp, dir: md, owner: b, team: 'negs', own: true, ammoId });
    b.lastShotTime = g.time; b.fireFlash = 0.06;
    this.flashT = 0.045;
    this.shotAge = 0;
    // отдача
    const sf = b.stance === 'prone' ? (def.id === 'pkm' ? 0.35 : 0.55) : b.stance === 'crouch' ? 0.8 : 1;
    const mount = this.vehicle ? 0.4 : 1;
    const up = def.recoil.up * 0.001 * sf * mount, side = def.recoil.side * 0.001 * sf * mount;
    this.rec.vp += up * 55; this.rec.vy += randn() * side * 45; this.rec.kick = 1;
    this.pitch += up * def.recoil.cam * (0.8 + Math.random() * 0.4);
    this.yaw += randn() * side * def.recoil.cam * 0.6;
    this.shake = Math.max(this.shake, def.id === 'rpg7' ? 0.6 : def.id === 'svd' ? 0.25 : 0.08);
    if (def.mag === 1 && aw.spare.length) {
      // одноразовая перезарядка гранатомёта
      this.reloadTotal = this.reloadT = def.reload + 0.3;
    }
  }

  handleGrenade(dt, inp, ws) {
    const g = this.game, b = this.body;
    if (ws.count <= 0 || this.switchT > 0) return;
    const long = inp.bu('fire'), short = inp.bu('aim');
    if (inp.bd('fire') || inp.bd('aim')) this.cook = (this.cook || 0) + dt; else if (!long && !short) this.cook = 0;
    if (long || short) {
      const v = long ? 17 : 8;
      const pitch = this.pitch + (long ? 0.18 : 0.05);
      const dir = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(this.yaw) * Math.cos(pitch));
      const pos = g.lookCam.position.clone().add(new THREE.Vector3(Math.cos(this.yaw) * 0.25, -0.1, -Math.sin(this.yaw) * 0.25));
      const gr = g.projectiles.throwGrenade(b, pos, dir.multiplyScalar(v).add(b.vel), 'f1');
      gr.fuse -= Math.min(2.2, this.cook || 0);
      ws.count--; b.grenades = ws.count;
      this.switchT = 0.8; this.cook = 0;
      g.hud.message(long ? 'Граната — бросок' : 'Граната — катнул', 1);
    }
  }

  handleMisc(dt, inp) {
    const g = this.game, b = this.body;
    // аптечка
    if (inp.bh('medkit') && b.medkits > 0 && b.health < b.maxHealth && this.medT <= 0) { this.medT = 4; g.hud.message('Перевязка... (4 с)', 4); }
    if (this.medT > 0) {
      this.medT -= dt;
      if (this.medT <= 0) { b.medkits--; b.heal(35); g.hud.message('Ранение перевязано (+35)', 2); }
    }
    // команды отделению
    if (inp.bh('cmdFollow')) g.squadOrder('follow');
    if (inp.bh('cmdHold')) g.squadOrder('hold');
    if (inp.bh('cmdMove') || inp.bh('cmdSuppress')) {
      const cam = g.lookCam;
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      const end = cam.position.clone().addScaledVector(dir, 600);
      const hit = g.world.raycast(cam.position, end, { mask: 'sight' });
      const pt = hit ? hit.point : end;
      g.squadOrder(inp.bh('cmdMove') ? 'move' : 'suppress', pt);
    }
    // взаимодействие
    this.interact = g.findInteraction(this);
    if (this.interact) {
      if (inp.bd('use')) {
        this.holdE += dt;
        if (this.holdE >= (this.interact.hold || 0)) { const it = this.interact; this.holdE = -999; it.action(); }
      } else this.holdE = 0;
    } else this.holdE = 0;
    this.suppression = Math.max(0, this.suppression - dt * 0.3);
    this.shake = Math.max(0, this.shake - dt * 2.5);
  }

  updateHitboxes() {
    const b = this.body, hb = this.hb;
    const p = b.pos;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    if (b.hidden) { hb.length = 0; return; }
    if (hb.length < 5) for (let i = hb.length; i < 5; i++) hb.push({ a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0, zone: '' });
    if (b.stance === 'prone') {
      hb[0].a.set(p.x + fx * 0.25, p.y + 0.3, p.z + fz * 0.25); hb[0].b.copy(hb[0].a); hb[0].r = 0.13; hb[0].zone = 'head';
      hb[1].a.set(p.x, p.y + 0.22, p.z); hb[1].b.set(p.x - fx * 0.55, p.y + 0.2, p.z - fz * 0.55); hb[1].r = 0.18; hb[1].zone = 'torso';
      hb[2].a.set(p.x - fx * 0.6, p.y + 0.15, p.z - fz * 0.6); hb[2].b.set(p.x - fx * 1.5, p.y + 0.1, p.z - fz * 1.5); hb[2].r = 0.14; hb[2].zone = 'leg';
      hb[3].a.copy(hb[0].a); hb[3].b.copy(hb[0].a); hb[3].r = 0.01; hb[3].zone = 'arm';
      hb[4].a.copy(hb[1].b); hb[4].b.copy(hb[1].b); hb[4].r = 0.16; hb[4].zone = 'pelvis';
    } else {
      const e = this.eyeH;
      const k = e / 1.62;
      hb[0].a.set(p.x, p.y + e + 0.05, p.z); hb[0].b.copy(hb[0].a); hb[0].r = 0.13; hb[0].zone = 'head';
      hb[1].a.set(p.x, p.y + e - 0.22, p.z); hb[1].b.set(p.x, p.y + 0.95 * k + 0.05, p.z); hb[1].r = 0.18; hb[1].zone = 'torso';
      hb[2].a.set(p.x + 0.1, p.y + 0.85 * k, p.z); hb[2].b.set(p.x + 0.1, p.y + 0.08, p.z); hb[2].r = 0.09; hb[2].zone = 'leg';
      hb[3].a.set(p.x - 0.1, p.y + 0.85 * k, p.z); hb[3].b.set(p.x - 0.1, p.y + 0.08, p.z); hb[3].r = 0.09; hb[3].zone = 'leg';
      hb[4].a.set(p.x, p.y + 0.95 * k, p.z); hb[4].b.copy(hb[4].a); hb[4].r = 0.16; hb[4].zone = 'pelvis';
    }
  }

  // ================= техника =================
  enterVehicle(v) {
    const b = this.body;
    let seat = -1;
    if (!v.seats[0]) seat = 0;
    else if (v.gunWeapon && !v.seats[1]) seat = 1;
    else seat = v.seats.findIndex((s, i) => !s && i >= 2);
    if (seat < 0) { this.game.hud.message('Нет свободных мест'); return; }
    v.seats[seat] = b; b.vehicle = v; b.seat = seat; this.vehicle = v; this.seat = seat;
    b.hidden = !(seat === 1 && v.type.gunExposed);
    this.camYaw = 0; this.camPitch = -0.12;
    this.aim = false; this.aimT = 0;
    this.game.hud.message(`${v.type.name}: ${this.seatName()}. E — выйти, 1/2 — сменить место`, 3);
  }

  seatName() {
    return this.seat === 0 ? 'место водителя' : this.seat === 1 ? 'место стрелка' : 'место десанта';
  }

  exitVehicle() {
    const v = this.vehicle;
    if (!v) return;
    if (Math.abs(v.speed) > 4) { this.game.hud.message('Слишком высокая скорость для высадки'); return; }
    v.unboard(this.body);
    this.vehicle = null; this.seat = -1;
    this.yaw = v.yaw + this.camYaw; this.pitch = 0;
    v.controls.throttle = 0; v.controls.steer = 0; v.controls.brake = 1;
  }

  switchSeat(n) {
    const v = this.vehicle;
    if (!v || n === this.seat) return;
    if (n === 1 && !v.gunWeapon) return;
    if (v.seats[n]) { this.game.hud.message('Место занято'); return; }
    v.seats[this.seat] = null; v.seats[n] = this.body; this.seat = n; this.body.seat = n;
    this.body.hidden = !(n === 1 && v.type.gunExposed);
    if (n !== 0) { v.controls.throttle = 0; v.controls.brake = 1; v.controls.steer = 0; }
    this.game.hud.message(this.seatName(), 1.5);
  }

  updateVehicle(dt, mdx, mdy) {
    const g = this.game, inp = g.input, v = this.vehicle, b = this.body;
    if (!v.alive) { this.vehicle = null; this.seat = -1; b.vehicle = null; b.hidden = false; return; }
    if (inp.bh('use')) { this.exitVehicle(); return; }
    if (inp.bh('slot1')) this.switchSeat(0);
    if (inp.bh('slot2')) this.switchSeat(1);
    if (inp.bh('crouch')) this.camThird = !this.camThird;
    if (inp.bh('cmdFollow')) g.squadOrder('follow');
    if (inp.bh('cmdHold')) g.squadOrder('hold');
    if (this.seat === 0) {
      v.controls.throttle = (inp.bd('moveF') ? 1 : 0) - (inp.bd('moveB') ? 1 : 0);
      v.controls.steer = (inp.bd('moveL') ? 1 : 0) - (inp.bd('moveR') ? 1 : 0);
      v.controls.brake = inp.bd('jump') ? 1 : 0;
      this.camYaw = wrapAngle(this.camYaw - mdx);
      this.camPitch = clamp(this.camPitch - mdy, -0.8, 0.5);
      if (!inp.locked && Math.abs(mdx) < 1e-4) this.camYaw *= Math.exp(-dt * 0.8);
      this.yaw = v.yaw + this.camYaw; this.pitch = this.camPitch;
      this.scoped = false;
    } else if (this.seat === 1 && v.type.turret) {
      // МТ-ЛБ: башня
      v.turretYaw = wrapAngle(v.turretYaw - mdx);
      v.gunPitch = clamp(v.gunPitch - mdy, -0.09, 0.5);
      if (inp.bh('aim')) this.gunnerSight = !this.gunnerSight;
      this.scoped = this.gunnerSight;
      if (inp.bd('fire')) { if (v.fireGun(b)) { this.shake = Math.max(this.shake, 0.04); } }
      if (inp.bh('reload') && v.gunAmmo < v.gunWeapon.mag && v.gunMags > 0) v.gunReload = v.gunWeapon.reload;
      this.yaw = v.yaw + v.turretYaw; this.pitch = v.gunPitch + v.pitch;
    } else if (this.seat === 1) {
      // «Тигр»: ПКП на турели — как ручное оружие, но с упором
      this.yaw -= mdx; this.pitch = clamp(this.pitch - mdy, -0.35, 0.8);
      v.turretYaw = wrapAngle(this.yaw - v.yaw); v.gunPitch = this.pitch;
      const ms = this.activeWeapon;
      this.aim = inp.bd('aim');
      this.aimT = lerp(this.aimT, this.aim ? 1 : 0, 1 - Math.exp(-11 * dt));
      this.fireCD -= dt;
      if (inp.bh('sightUp') || (this.aim && inp.wheel < 0)) this.changeSight(ms, 1);
      if (inp.bh('sightDown') || (this.aim && inp.wheel > 0)) this.changeSight(ms, -1);
      if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) this.finishReload(ms); }
      else if (inp.bh('reload') && ms.spare.length) { this.reloadTotal = this.reloadT = ms.def.reload; }
      this.computePose(dt);
      if (inp.bd('fire') && this.fireCD <= 0 && this.reloadT <= 0 && ms.mag > 0) this.fire(ms);
      this.scoped = false;
    } else {
      this.camYaw = wrapAngle(this.camYaw - mdx);
      this.camPitch = clamp(this.camPitch - mdy, -0.8, 0.5);
      this.yaw = v.yaw + this.camYaw; this.pitch = this.camPitch;
      if (inp.bh('reload')) this.resupply();
      this.scoped = false;
    }
    b.yaw = this.yaw;
    this.updateHitboxes();
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.suppression = Math.max(0, this.suppression - dt * 0.3);
  }

  resupply() {
    for (const s of this.slots) {
      if (!s || s.grenade || s.binocular) continue;
      s.spare = Array(s.def.mags).fill(s.def.mag);
      if (s.ugl) s.ugl.spare = Array(s.ugl.def.mags).fill(1);
    }
    this.slots[2].count = 3; this.body.grenades = 3;
    this.body.medkits = Math.max(this.body.medkits, 2);
    this.game.hud.message('Боекомплект пополнен');
  }
}
