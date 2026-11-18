// БПЛА-корректировщик — тяжёлый квадрокоптер с камерой на гиростабилизированном подвесе.
// Летает по кругу вокруг точки облёта, камера смотрит в её центр со стороны. Два режима:
// «высоко» (190 м, радиус 320 м — противник почти не слышит) и «низко» (90 м, 170 м — видно
// лучше и ближе, но дрон слышно и его сбивают). Замеченного камерой противника (прямая
// видимость, в поле зрения камеры) дрон передаёт отметками на карту и карту огня.
// Полётом управляет хост (в одиночной игре — сама игра), остальные получают положение по сети.
import * as THREE from 'three';

export const ORBIT = { high: { alt: 190, r: 320 }, low: { alt: 90, r: 170 } }; // высота над центром и радиус облёта, м
export const R_ORBIT = ORBIT.high.r;
const V_ORBIT = 13;     // скорость на круге, м/с
const V_MAX = 17;       // скорость перелёта, м/с
const ACC = 5;          // ускорение, м/с²
const HP = 40;
export const DRONE_FOV = 24;      // поле зрения камеры по вертикали, град
export const DRONE_RANGE = 650;   // дальность распознавания цели камерой, м
export const DRONE_RESPAWN = 120; // резервный дрон, с

const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

let MATS = null;
function mats() {
  if (MATS) return MATS;
  MATS = {
    olive: new THREE.MeshStandardMaterial({ color: 0x4b5338, roughness: 0.7, metalness: 0.1 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.55, metalness: 0.4 }),
    lens: new THREE.MeshStandardMaterial({ color: 0x0a0c14, roughness: 0.08, metalness: 0.9 }),
    blade: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.5 }),
    disc: new THREE.MeshBasicMaterial({ color: 0x202020, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
    red: new THREE.MeshBasicMaterial({ color: 0xff2a1a }),
    green: new THREE.MeshBasicMaterial({ color: 0x30ff60 }),
  };
  return MATS;
}

export function buildDroneModel() {
  const M = mats();
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.11, 0.42), M.olive); g.add(body);
  const bat = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.3), M.dark); bat.position.y = 0.085; g.add(bat);
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.16, 5), M.dark); ant.position.set(0.08, 0.18, 0.12); g.add(ant);
  const rotors = [];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const ax = Math.sin(a) * 0.42, az = Math.cos(a) * 0.42;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.6, 6), M.dark);
    arm.rotation.z = Math.PI / 2; arm.rotation.y = a + Math.PI / 2;
    arm.position.set(ax / 2, 0.02, az / 2); g.add(arm);
    const mot = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.07, 10), M.dark); mot.position.set(ax, 0.05, az); g.add(mot);
    const rot = new THREE.Group(); rot.position.set(ax, 0.095, az);
    const bl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.006, 0.035), M.blade); rot.add(bl);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.21, 18), M.disc); disc.rotation.x = -Math.PI / 2; rot.add(disc);
    g.add(rot); rotors.push(rot);
    // навигационные огни: красные спереди, зелёные сзади
    const nl = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 4), az < 0 ? M.red : M.green); nl.position.set(ax, -0.0, az); g.add(nl);
    // опоры
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 5), M.dark); leg.position.set(Math.sin(a) * 0.14, -0.14, Math.cos(a) * 0.17); g.add(leg);
  }
  // подвес с камерой
  const gimbal = new THREE.Group(); gimbal.position.set(0, -0.11, -0.14); g.add(gimbal);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 8), M.dark); gimbal.add(ball);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.03, 12), M.lens); lens.rotation.x = Math.PI / 2; lens.position.z = -0.06; gimbal.add(lens);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: g, rotors, gimbal };
}

export class Drone {
  constructor(m, { team, x, z, name = 'БПЛА «Сова»', index = 0 }) {
    this.m = m; this.team = team; this.name = name; this.index = index;
    this.isDrone = true; this.alive = true; this.hp = HP;
    const y = m.terrain.heightAt(x, z) + 1.2;
    this.pos = new THREE.Vector3(x, y, z); this.vel = new THREE.Vector3();
    this.chest = this.pos; this.eye = this.pos;           // для ИИ — точка прицеливания
    this.center = new THREE.Vector3(x, 0, z); this.centerSet = false;
    this.low = false;
    this.look = new THREE.Vector3(x, 0, z);               // куда смотрит камера (точка на грунте)
    this.yaw = 0; this.tiltX = 0; this.tiltZ = 0; this.spin = 0;
    const md = buildDroneModel();
    this.model = md; this.mesh = md.group;
    this.mesh.scale.setScalar(1.25);
    m.scene.add(this.mesh);
    this.cam = new THREE.PerspectiveCamera(DRONE_FOV, 1.5, 0.5, 6000);
    this.seen = new Map();   // цель → время последнего наблюдения камерой
    this.detT = 1; this.reportT = 4;
    this.fall = null; this.downAt = -1;
    this.sound = null;
    this.netBuf = null;
  }

  // --- управление ---
  get orbit() { return this.low ? ORBIT.low : ORBIT.high; }
  setCenter(x, z, low = null) {
    this.center.set(x, 0, z); this.centerSet = true;
    if (low !== null) this.low = !!low;
  }

  // точка облёта по умолчанию: текущая задача, иначе 350 м вперёд от старта
  _defaultCenter() {
    const m = this.m;
    const st = m.stages && m.stages[m.stageIdx];
    const o = st && st.objs.find((q) => !q.done && q.marker && q.marker());
    if (o) { const mk = o.marker(); return [mk.x, mk.z]; }
    const s = m.def.start;
    return [s.x - Math.sin(s.yaw || 0) * 350, s.z - Math.cos(s.yaw || 0) * 350];
  }

  // --- урон ---
  damage(dmg, src) {
    if (!this.alive) return;
    this.hp -= dmg;
    this.m.fx.impact(this.pos, _v.set(0, 1, 0), 'metal', 0.6);
    if (this.hp <= 0) this.destroy(src);
  }

  destroy(src) {
    if (!this.alive) return;
    this.alive = false; this.downAt = this.m.time;
    this.fall = { w: new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 6) };
    this.vel.y = Math.max(this.vel.y, 1.5);
    this.m.fx.explosion(this.pos, 0.25, false);
    this.m.audio.explosion(this.pos, 0.3);
    if (this.m.onDroneDown) this.m.onDroneDown(this, src);
  }

  revive(x, z) {
    this.alive = true; this.hp = HP; this.fall = null; this.downAt = -1;
    this.pos.set(x, this.m.terrain.heightAt(x, z) + 1.2, z); this.vel.set(0, 0, 0);
    this.mesh.visible = true; this.seen.clear();
  }

  // --- полёт (хост / одиночная игра) ---
  _fly(dt) {
    const T = this.m.terrain, p = this.pos, v = this.vel;
    if (!this.centerSet) { const [cx, cz] = this._defaultCenter(); this.setCenter(cx, cz); }
    const C = this.center;
    const dx = p.x - C.x, dz = p.z - C.z, dh = Math.hypot(dx, dz);
    const O = this.orbit;
    const want = _v;
    if (dh > O.r + 60) {
      // перелёт к району
      want.set(-dx / dh, 0, -dz / dh).multiplyScalar(V_MAX);
    } else {
      // облёт по часовой: точка чуть впереди на круге
      const a = Math.atan2(dz, dx) + 0.35;
      const tx = C.x + Math.cos(a) * O.r, tz = C.z + Math.sin(a) * O.r;
      want.set(tx - p.x, 0, tz - p.z);
      const l = want.length() || 1;
      want.multiplyScalar(Math.min(V_ORBIT, l * 0.8 + 4) / l);
    }
    // высота: над центром ALT, над рельефом под собой не ниже 60 м
    const hC = T.heightAt(C.x, C.z) + O.alt, hHere = T.heightAt(p.x, p.z) + 45;
    const hAhead = T.heightAt(p.x + v.x * 4, p.z + v.z * 4) + 45;
    const hT = Math.max(hC, hHere, hAhead);
    want.y = Math.max(-4, Math.min(6, (hT - p.y) * 0.5));
    // ограничение ускорения
    _w.subVectors(want, v);
    const al = _w.length(), amax = ACC * dt;
    if (al > amax) _w.multiplyScalar(amax / al);
    v.add(_w);
    p.addScaledVector(v, dt);
    // наклон корпуса по ускорению (визуально)
    const ca = Math.cos(this.yaw), sa = Math.sin(this.yaw);
    const ax = _w.x / Math.max(dt, 1e-4), az = _w.z / Math.max(dt, 1e-4);
    const fwdA = -(ax * sa + az * ca), sideA = ax * ca - az * sa;
    this.tiltX += (Math.max(-0.35, Math.min(0.35, -fwdA * 0.05 - Math.hypot(v.x, v.z) * 0.012)) - this.tiltX) * Math.min(1, dt * 3);
    this.tiltZ += (Math.max(-0.35, Math.min(0.35, -sideA * 0.05)) - this.tiltZ) * Math.min(1, dt * 3);
    const hs = Math.hypot(v.x, v.z);
    if (hs > 0.5) this.yaw += wrap(Math.atan2(-v.x, -v.z) - this.yaw) * Math.min(1, dt * 2);
  }

  // --- падение сбитого ---
  _fallStep(dt) {
    const p = this.pos, v = this.vel, T = this.m.terrain;
    if (!this.fall) return;
    if (this.fall.done) return;
    v.y -= 9.8 * dt; v.x *= 1 - dt * 0.3; v.z *= 1 - dt * 0.3;
    p.addScaledVector(v, dt);
    this.tiltX += this.fall.w.x * dt; this.tiltZ += this.fall.w.z * dt; this.yaw += this.fall.w.y * dt;
    const gy = T.heightAt(p.x, p.z) + 0.15;
    if (p.y <= gy) {
      p.y = gy; this.fall.done = true;
      this.m.fx.impact(p, _v.set(0, 1, 0), 'snow', 1.5);
      this.m.fx.addFire(p, 0.18, 20);
      if (p.distanceTo(this.m.camPos) < 400) this.m.audio.impact(p, 'metal');
    }
  }

  // --- камера: что видит подвес ---
  _aim() {
    const T = this.m.terrain;
    this.look.set(this.center.x, T.heightAt(this.center.x, this.center.z) + 1, this.center.z);
    const c = this.cam;
    c.position.copy(this.pos); c.position.y -= 0.2;
    c.lookAt(this.look);
    c.updateMatrixWorld(true);
  }

  // --- распознавание целей камерой (хост) ---
  _detect() {
    const m = this.m, now = m.time;
    const c = this.cam;
    const fwd = _w.set(0, 0, -1).applyQuaternion(c.quaternion);
    const cosLim = Math.cos(((DRONE_FOV * 0.5 * 1.45) * Math.PI) / 180);
    for (const t of m.targetsFor(this.team)) {
      if (t.isDrone) continue;
      const tp = t.isVehicle ? _v.copy(t.pos).setY(t.pos.y + 1.2) : (t.chest || t.pos);
      const d = c.position.distanceTo(tp);
      if (d > DRONE_RANGE) continue;
      const dir = _v.copy(tp).sub(c.position).divideScalar(d);
      if (dir.dot(fwd) < cosLim) continue;
      // в снегопад и ночью камера видит хуже (тепловизор ночью — почти как днём)
      const vis = m.visibility * (m.isNight ? 1.4 : 1.6);
      if (d > vis) continue;
      if (!m.world.los(c.position, t.isVehicle ? t.pos.clone().setY(t.pos.y + 1.2) : (t.chest || t.pos), t.isVehicle ? t : t.vehicle || null)) continue;
      this.seen.set(t, now);
    }
    for (const [t, ts] of this.seen) if (!t.alive || now - ts > 6) this.seen.delete(t);
  }

  _report() {
    const m = this.m, now = m.time;
    const list = [...this.seen].filter(([t, ts]) => t.alive && now - ts < 3).map(([t]) => t);
    const used = new Set();
    for (const t of list) {
      if (used.has(t)) continue;
      const cl = list.filter((o) => !used.has(o) && o.pos.distanceTo(t.pos) < 40);
      cl.forEach((o) => used.add(o));
      const veh = cl.filter((o) => o.isVehicle);
      const cx = cl.reduce((a, o) => a + o.pos.x, 0) / cl.length, cz = cl.reduce((a, o) => a + o.pos.z, 0) / cl.length;
      const e = 2.5; // лазерный дальномер и GPS — ошибка единицы метров
      const label = veh.length ? `${veh[0].type.name}${cl.length > 1 ? ` и пехота (${cl.length - veh.length})` : ''}` : `пехота противника (${cl.length})`;
      m.addMark({ team: this.team, x: cx + (Math.random() - 0.5) * e, z: cz + (Math.random() - 0.5) * e, label, by: this.name });
    }
  }

  // --- сеть: снимок и применение ---
  netState() {
    const r2 = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000;
    return [r2(this.pos.x), r2(this.pos.y), r2(this.pos.z), r3(this.yaw), this.alive ? 1 : 0, Math.round(this.center.x), Math.round(this.center.z), r3(this.tiltX), r3(this.tiltZ), r2(this.vel.x), r2(this.vel.y), r2(this.vel.z), this.low ? 1 : 0];
  }
  applyNet(a) {
    if (a[4] && !this.alive) this.revive(a[0], a[2]);
    if (!a[4] && this.alive) { this.vel.set(a[9] || 0, a[10] || 0, a[11] || 0); this.destroy(null); }
    this.netBuf = a;
    this.center.set(a[5], 0, a[6]); this.centerSet = true; this.low = !!a[12];
  }

  update(dt, sim) {
    const m = this.m;
    this.spin += dt * (this.alive ? 70 : (this.fall && !this.fall.done ? 20 : 0));
    if (!this.alive) this._fallStep(dt);
    else if (sim) {
      this._fly(dt);
      this.detT -= dt; this.reportT -= dt;
      this._aim();
      if (this.detT <= 0) { this.detT = 0.5; this._detect(); }
      if (this.reportT <= 0) { this.reportT = 5; this._report(); }
    } else if (this.netBuf) {
      // клиент: плавно к снимку хоста с упреждением по скорости
      const a = this.netBuf;
      _v.set(a[0] + (a[9] || 0) * 0.1, a[1] + (a[10] || 0) * 0.1, a[2] + (a[11] || 0) * 0.1);
      this.pos.lerp(_v, 1 - Math.exp(-6 * dt));
      this.vel.set(a[9] || 0, a[10] || 0, a[11] || 0);
      this.yaw += wrap(a[3] - this.yaw) * (1 - Math.exp(-6 * dt));
      this.tiltX += (a[7] - this.tiltX) * (1 - Math.exp(-6 * dt)); this.tiltZ += (a[8] - this.tiltZ) * (1 - Math.exp(-6 * dt));
      this._aim();
      // клиент тоже видит цели (для рамок в окне камеры), отметки ставит хост
      this.detT -= dt; if (this.detT <= 0) { this.detT = 0.5; this._detect(); }
    }
    if (this.alive && !sim && !this.netBuf) this._aim();
    // модель
    const g = this.mesh;
    g.position.copy(this.pos);
    g.rotation.set(this.tiltX, this.yaw, this.tiltZ, 'YXZ');
    this.model.rotors.forEach((r, i) => { r.rotation.y = this.spin * (i % 2 ? 1 : -1); });
    if (this.alive) {
      // подвес смотрит на центр облёта
      g.updateMatrixWorld(true);
      // объектив смотрит по −Z подвеса, lookAt направляет +Z — разворачиваем на противоположную точку
      const gb = this.model.gimbal;
      const gw = gb.getWorldPosition(_w);
      gb.lookAt(_v.copy(gw).multiplyScalar(2).sub(this.look));
    }
    if (this.fall && this.fall.done && m.time - this.downAt > 30) g.visible = false;
    // звук винтов
    const d = m.camPos ? this.pos.distanceTo(m.camPos) : 1e9;
    if (this.alive && d < 260) {
      if (!this.sound) this.sound = m.audio.createEngine('drone');
      this.sound.set(0.6 + Math.min(0.4, this.vel.length() / 40), 0.05, this.pos);
    } else if (this.sound) { this.sound.stop(); this.sound = null; }
  }

  dispose() {
    if (this.sound) { this.sound.stop(); this.sound = null; }
    this.m.scene.remove(this.mesh);
  }
}
