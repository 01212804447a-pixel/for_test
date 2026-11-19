// ПТРК 9К11 «Малютка»: пусковая установка 9П111 на крышке чемодана, пульт управления 9С415
// с перископическим прицелом 9Ш16 (8×) и ручкой управления. Наведение ручное, трёхточечное
// (как у настоящей «Малютки» первых выпусков): оператор видит в прицел трассер ракеты и ручкой
// (здесь — W/A/S/D) сам выводит его на цель; команды идут по проводу, который разматывается
// с катушки ракеты (до 3000 м). Ракета 115–120 м/с: до 3 км — ≈26 с полёта. Первые доли
// секунды после старта она неуправляема и «вываливается» из поля зрения — её надо поймать.
// Ракеты: 9М14М (кумулятивная, ≈460 мм) и тандемная (модернизация «Малютка-2», ≈600 мм за
// динамической защитой — лидирующий заряд снимает «Контакт-1»).
// Комплект переносится и перевозится как миномёт и КПВ (E — переместить, погрузить, выгрузить).
import * as THREE from 'three';
import { AMMO, WEAPONS } from '../data/weapons.js';
import { prepareAmmo } from '../physics/ballistics.js';
import { MIL } from './d30.js';
import { clamp, rand, randn } from '../core/math.js';
import { setupEmplace } from './emplace.js';

AMMO['9m14m'] = prepareAmmo({
  id: '9m14m', name: '9М14М (кумулятивная)', short: '9М14М', kind: 'missile', model: 'const', cd: 0.3,
  mass: 10.9, caliber: 0.125, v0: 60, maxT: 34, armDist: 25,
  explosive: { pen: 460, radius: 3.5, frag: 10, dmg: 230, fxSize: 1.7 },
});
AMMO['9m14_2m'] = prepareAmmo({
  id: '9m14_2m', name: 'Тандемная («Малютка-2»)', short: 'тандем', kind: 'missile', model: 'const', cd: 0.3,
  mass: 13.0, caliber: 0.125, v0: 60, maxT: 34, armDist: 25,
  explosive: { pen: 600, tandem: true, radius: 3.5, frag: 10, dmg: 250, fxSize: 1.8 },
});
WEAPONS.malyutka = { id: 'malyutka', name: '9К11 «Малютка»', cls: 'ПТРК', ammo: '9m14m', mag: 1, mags: 6, rpm: 2, modes: ['single'], disp: 0.4, sound: 'rpg', atgm: true };

const MISSILES = { m: { id: '9m14m', name: '9М14М', long: 'кумулятивная, ≈460 мм' }, t: { id: '9m14_2m', name: 'тандемная', long: 'тандемная, ≈600 мм за ДЗ' } };
const Y = new THREE.Vector3(0, 1, 0);
const WIRE = 3000, ACC = 30, V_MARCH = 118;
const PANEL = new THREE.Vector3(-0.9, 0, 1.5);      // пульт относительно пусковой (влево-назад)

// модель ракеты 9М14 (нос к +Z — так её разворачивает lookAt снаряда): корпус Ø125 мм, длина 0,86 м, крестообразные крылья, трассер
export function missileModel() {
  const g = new THREE.Group();
  const olive = new THREE.MeshStandardMaterial({ color: 0x4d5a3a, roughness: 0.6, metalness: 0.2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2c2a, roughness: 0.6, metalness: 0.5 });
  const body = new THREE.CylinderGeometry(0.0625, 0.0625, 0.5, 18); body.rotateX(Math.PI / 2); body.translate(0, 0, 0.08);
  const nose = new THREE.ConeGeometry(0.0625, 0.3, 18); nose.rotateX(-Math.PI / 2); nose.translate(0, 0, -0.32);
  const tip = new THREE.CylinderGeometry(0.008, 0.012, 0.06, 8); tip.rotateX(Math.PI / 2); tip.translate(0, 0, -0.49);
  g.add(new THREE.Mesh(body, olive), new THREE.Mesh(nose, olive), new THREE.Mesh(tip, dark));
  for (let i = 0; i < 4; i++) {
    const w = new THREE.BoxGeometry(0.006, 0.14, 0.17); w.translate(0, 0.13, 0.25); w.rotateZ((i / 4) * Math.PI * 2 + Math.PI / 4);
    g.add(new THREE.Mesh(w, olive));
  }
  const tr = new THREE.CylinderGeometry(0.02, 0.03, 0.04, 10); tr.rotateX(Math.PI / 2); tr.translate(0, 0.0, 0.35);
  g.add(new THREE.Mesh(tr, dark));
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.rotation.y = Math.PI;
  const outer = new THREE.Group(); outer.add(g);
  return outer;
}

// комплект на позиции: пусковая с ракетой, пульт с прицелом и ручкой, кабель
function buildATGM() {
  const root = new THREE.Group();
  const olive = new THREE.MeshStandardMaterial({ color: 0x46533a, roughness: 0.75, metalness: 0.15 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x232524, roughness: 0.7, metalness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.1, metalness: 0.6 });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.rotation.set(rx, ry, 0); o.castShadow = true; o.receiveShadow = true; root.add(o); return o; };
  // нижняя половина чемодана на снегу и крышка-пусковая под углом, на ней направляющая
  add(new THREE.BoxGeometry(0.48, 0.11, 0.62), olive, 0, 0.055, 0);
  const lid = new THREE.Group(); lid.position.set(0, 0.11, 0.31); lid.rotation.x = 0.18; root.add(lid);
  const L = (geo, mat, x, y, z) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.castShadow = true; lid.add(o); return o; };
  L(new THREE.BoxGeometry(0.48, 0.05, 0.62), olive, 0, 0.03, -0.31);
  L(new THREE.BoxGeometry(0.05, 0.05, 0.5), dark, 0, 0.08, -0.33);
  for (const sx of [-1, 1]) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 6), dark); st.position.set(sx * 0.2, -0.05, -0.5); st.rotation.x = 0.5; lid.add(st); }
  const rail = new THREE.Group(); rail.position.set(0, 0.18, -0.33); lid.add(rail);
  const msl = missileModel(); msl.rotation.y = Math.PI; rail.add(msl);
  // пульт 9С415 с прицелом 9Ш16 и ручкой
  const panel = new THREE.Group(); panel.position.copy(PANEL); root.add(panel);
  const P = (geo, mat, x, y, z) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.castShadow = true; panel.add(o); return o; };
  P(new THREE.BoxGeometry(0.36, 0.2, 0.3), olive, 0, 0.1, 0);
  P(new THREE.CylinderGeometry(0.035, 0.035, 0.28, 12), dark, 0, 0.34, -0.04);
  P(new THREE.BoxGeometry(0.1, 0.08, 0.14), dark, 0, 0.5, -0.06);
  P(new THREE.BoxGeometry(0.06, 0.05, 0.01), glass, 0, 0.5, -0.135);
  P(new THREE.CylinderGeometry(0.02, 0.025, 0.07, 10), dark, 0, 0.47, 0.03).rotation.x = Math.PI / 2;
  const stick = new THREE.Group(); stick.position.set(0.12, 0.2, 0.06); panel.add(stick);
  const sk = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.12, 8), dark); sk.position.y = 0.06; stick.add(sk);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), dark); knob.position.y = 0.12; stick.add(knob);
  // кабель от пульта к пусковой
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1, 5), dark);
  const a = PANEL.clone().setY(0.02), b = new THREE.Vector3(0, 0.03, 0.2);
  cable.position.copy(a).lerp(b, 0.5); cable.scale.y = a.distanceTo(b);
  cable.quaternion.setFromUnitVectors(Y, b.clone().sub(a).normalize());
  root.add(cable);
  return { root, lid, rail, msl, panel, stick };
}

export class Atgm {
  constructor(m, { x, z, yaw = 0, name = 'ПТРК № 1', team = 'negs', stowIn = null }) {
    this.m = m; this.name = name; this.team = team; this.kind = 'atgm';
    this.model = buildATGM();
    m.scene.add(this.model.root);
    this.pos = new THREE.Vector3(x, m.terrain.heightAt(x, z), z);
    this.mountYaw = yaw;
    this.syaw = yaw; this.spitch = 0;   // линия прицела 9Ш16 (мир)
    this.zoom = true;
    this.stock = { m: 4, t: 2 }; this.sel = 'm'; this.onRail = 'm'; this.stock.m--;
    this.reloadT = 0;
    this.missile = null; this.netMissile = null;
    this.stick = { x: 0, y: 0 }; this.gust = new THREE.Vector3();
    this.colliders = []; this.crew = []; this.reports = [];
    this.ui = null;
    this.gunIt = {
      pos: new THREE.Vector3(), r: 1.4, hold: 0.25, label: `Лечь за пульт ПТРК: ${name}`,
      enabled: () => this.ready && !m.player.gun && !m.player.carry && !m.player.vehicle && !this.netUser && m.player.body.alive,
      action: () => this.mount(m.player),
    };
    m.interactables.push(this.gunIt);
    setupEmplace(this, m, { kind: 'atgm', name: `ПТРК ${name}`, speed: 2.4, front: 1.5 });
    if (stowIn) this.stow(stowIn, true); else this._onPlace(yaw);
  }
  get ready() { return !this.moving && !this.stowedIn; }
  canHitch() { return false; }
  busy() { return this.m.player.gun === this || !!this.missile; }
  get az() { return ((-this.syaw / MIL) % 6000 + 6000) % 6000; }
  set az(v) { this.syaw = -v * MIL; }
  get elM() { return this.spitch / MIL; }
  set elM(v) { this.spitch = v * MIL; }

  _onPick() { for (const o of this.colliders) this.m.world.removeObstacle(o); this.colliders = []; this.model.root.visible = !!this.mover; }
  _onStow() { this._onPick(); this.model.root.visible = false; }
  _onPlace(yaw) {
    this.mountYaw = yaw; this.syaw = yaw; this.spitch = 0;
    this.model.root.visible = true;
    this._place();
    this.colliders = [this.m.world.addBoxCollider({ x: this.pos.x, z: this.pos.z, y0: this.pos.y, w: 0.5, d: 0.65, h: 0.22, yaw, mat: 'metal', pen: 3, cover: false, blocksBullet: false, blocksSight: false, owner: { kind: 'gun', gun: this } })];
  }
  _place() {
    const g = this.model;
    g.root.position.copy(this.pos);
    g.root.rotation.set(0, this.mountYaw, 0);
    // пусковая смотрит по линии прицела (в пределах ±30° от установки)
    const rel = clamp(Math.atan2(Math.sin(this.syaw - this.mountYaw), Math.cos(this.syaw - this.mountYaw)), -0.5, 0.5);
    g.lid.rotation.y = rel;
    g.rail.visible = !!this.onRail;
    g.stick.rotation.set(-this.stick.y * 0.35, 0, -this.stick.x * 0.35);
    g.root.updateMatrixWorld(true);
  }

  panelWorld(out = new THREE.Vector3()) { return out.copy(PANEL).applyAxisAngle(Y, this.mountYaw).add(this.pos); }
  railWorld(out = new THREE.Vector3()) { this.model.root.updateMatrixWorld(true); return out.set(0, 0, -0.45).applyMatrix4(this.model.rail.matrixWorld); }

  mount(p) {
    if (!this.ready) return;
    p.gun = this; p.body.stance = 'prone';
    this.syaw = this.mountYaw; this.spitch = 0;
    this.m.hud.message(`${this.name}: мышь — прицел 9Ш16, ЛКМ/Пробел — пуск, W/A/S/D — ручка управления (Shift — точнее), V — увеличение, Z — ракета, E — встать`, 6);
  }
  dismount(p) {
    p.gun = null;
    if (this.ui) this.ui.show(false);
    if (this.missile) this.m.hud.message('Ракета без управления!', 2);
    const q = this.panelWorld().add(new THREE.Vector3(0.6, 0, 0.6).applyAxisAngle(Y, this.mountYaw));
    p.body.pos.set(q.x, this.m.terrain.heightAt(q.x, q.z), q.z);
    p.yaw = this.syaw;
  }
  seatWorld() { return this.panelWorld().add(new THREE.Vector3(0, 0, 0.75).applyAxisAngle(Y, this.mountYaw)); }

  control(dt) {
    const m = this.m, inp = m.input, p = m.player;
    if (!this.ui) this.ui = new AtgmUI(this);
    this.ui.show(true);
    if (inp.bh('use')) { this.dismount(p); return; }
    // прицел: мышь (поле зрения ±50° от установки)
    const sens = m.settings.sens * 0.0011 * (this.zoom ? 0.3 : 1);
    this.syaw -= inp.dx * sens;
    const rel = Math.atan2(Math.sin(this.syaw - this.mountYaw), Math.cos(this.syaw - this.mountYaw));
    this.syaw = this.mountYaw + clamp(rel, -0.9, 0.9);
    this.spitch = clamp(this.spitch - inp.dy * sens * (m.settings.invertY ? -1 : 1), -0.2, 0.3);
    if (inp.hit('KeyV')) { this.zoom = !this.zoom; m.audio.click(); }
    if (inp.hit('KeyZ')) {
      this.sel = this.sel === 'm' ? 't' : 'm';
      m.hud.message(`Следующая ракета — ${MISSILES[this.sel].name} (${MISSILES[this.sel].long}), осталось ${this.stock[this.sel]}`, 2.5); m.audio.click();
    }
    // ручка управления: клавиши дают отклонение, держать — больше (ручка «пружинит» к нулю)
    const fine = inp.bd('sprint') ? 0.4 : 1;
    const tx = ((inp.bd('moveR') ? 1 : 0) - (inp.bd('moveL') ? 1 : 0)) * fine, ty = ((inp.bd('moveF') ? 1 : 0) - (inp.bd('moveB') ? 1 : 0)) * fine;
    const ramp = (cur, tgt) => (tgt === 0 ? cur * Math.exp(-dt * 7) : cur + clamp(tgt - cur, -dt * 2.6, dt * 2.6));
    this.stick.x = ramp(this.stick.x, tx); this.stick.y = ramp(this.stick.y, ty);
    if (inp.bh('fire') || inp.hit('Space')) this.launch();
    p.body.pos.copy(this.seatWorld());
    p.body.stance = 'prone';
    this._sendStick(dt);
  }

  launch() {
    const m = this.m, p = m.player;
    if (this.missile) { m.hud.message('Ракета в полёте — ведите её до цели', 1.5); return; }
    if (!this.onRail) { m.hud.message(this.reloadT > 0 ? `Ставлю ракету на направляющую… ${this.reloadT.toFixed(0)} с` : 'Ракеты кончились', 1.5); return; }
    const key = this.onRail; this.onRail = null;
    // сход с направляющей чуть вверх: ракета набирает высоту и входит в поле зрения прицела
    const el = Math.max(this.spitch, 0) + 0.07;
    const dir = new THREE.Vector3(-Math.sin(this.syaw) * Math.cos(el), Math.sin(el), -Math.cos(this.syaw) * Math.cos(el));
    const pos = this.railWorld().addScaledVector(dir, 0.3);
    const pr = m.projectiles.spawn({ weapon: WEAPONS.malyutka, pos, dir, owner: p.body, team: p.body.team, ammoId: MISSILES[key].id });
    this._arm(pr, pos, true);
    this.missile = pr;
    this.netT = 0;
    m.fx.muzzleBlast(pos, dir);
    for (let i = 0; i < 14; i++) m.fx.smoke.emit(pos.x, pos.y, pos.z, -dir.x * rand(2, 6) + rand(-1, 1), rand(0.3, 1.5), -dir.z * rand(2, 6) + rand(-1, 1), rand(2, 4), 0.4, 2.5, 0.88, 0.88, 0.88, 0.5, 0, 1.5, -0.1);
    m.audio.shot(pos, 'rpg', true);
    m.noise(pos, 900, this.team, p.body);
    m.hud.radio(this.name, `Пуск! ${MISSILES[key].name}. Ловите трассер.`);
    this._net(['ml', key, +pos.x.toFixed(2), +pos.y.toFixed(2), +pos.z.toFixed(2), +dir.x.toFixed(3), +dir.y.toFixed(3), +dir.z.toFixed(3)]);
  }

  // ракета: своя (управляемая по проводу) или чужая по сети (за переданным положением)
  _arm(pr, from, own) {
    const m = this.m;
    pr.mesh = missileModel(); pr.mesh.position.copy(pr.p); m.scene.add(pr.mesh);
    pr.launchPos = from.clone();
    pr.wire = true; pr.atgm = this;
    pr.guide = own ? (p, h) => this._guide(p, h) : (p, h) => this._netGuide(p, h);
  }

  _guide(p, h) {
    p.t += h;
    const sp = p.v.length();
    // стартовый двигатель ≈0,6 с — разгон до маршевой скорости; маршевый горит ≈26 с
    const want = p.t < 0.6 ? 60 + (p.t / 0.6) * (V_MARCH - 60) : p.t < 26.5 ? V_MARCH : 0;
    const nsp = want > sp ? Math.min(want, sp + 110 * h) : Math.max(25, sp - (want ? 2 : 7) * h);
    const dir = p.v.clone().normalize();
    const right = new THREE.Vector3().crossVectors(dir, Y).normalize(), up = new THREE.Vector3().crossVectors(right, dir);
    const a = new THREE.Vector3();
    // команды по проводу — пока оператор у пульта и провод цел
    const ctl = p.wire && this.m.player.gun === this && p.t > 0.35;
    if (ctl) a.addScaledVector(right, this.stick.x * ACC).addScaledVector(up, this.stick.y * ACC);
    // тяжесть и подъёмная сила крыльев (при нейтральной ручке ракета медленно снижается)
    a.y += -9.81 + (sp > 50 && p.t < 26.5 ? 9.81 * 0.86 : 0);
    // болтанка
    this.gust.x += (randn() * 2.2 - this.gust.x) * Math.min(1, h * 1.5); this.gust.y += (randn() * 2.2 - this.gust.y) * Math.min(1, h * 1.5); this.gust.z += (randn() * 2.2 - this.gust.z) * Math.min(1, h * 1.5);
    a.add(this.gust);
    p.v.addScaledVector(a, h).setLength(nsp);
    p.p.addScaledVector(p.v, h);
    // провод кончился (3 км) — ракета неуправляема
    if (p.wire && p.p.distanceTo(p.launchPos) > WIRE) { p.wire = false; if (this.m.player.gun === this) this.m.hud.message('Провод оборвался — дальше 3 км ракета неуправляема', 2); }
  }

  _netGuide(p, h) {
    p.t += h;
    const s = this.netMissile;
    if (!s) { p.p.addScaledVector(p.v, h); return; }
    const age = (performance.now() - s.at) / 1000;
    const want = new THREE.Vector3(s.p[0] + s.v[0] * age, s.p[1] + s.v[1] * age, s.p[2] + s.v[2] * age);
    p.v.set(s.v[0], s.v[1], s.v[2]);
    p.p.addScaledVector(p.v, h).lerp(want, Math.min(1, h * 6));
  }

  _sendStick(dt) {
    const pr = this.missile;
    if (!pr || !this.m.net) return;
    this.netT = (this.netT || 0) - dt;
    if (this.netT > 0) return;
    this.netT = 0.1;
    this._net(['mp', +pr.p.x.toFixed(2), +pr.p.y.toFixed(2), +pr.p.z.toFixed(2), +pr.v.x.toFixed(2), +pr.v.y.toFixed(2), +pr.v.z.toFixed(2)]);
  }

  _net(e) { const n = this.m.net; if (n) n.ev(['gm', this.m.guns.indexOf(this), ...e]); }

  netOp(e) {
    if (this.emNetOp(e)) return;
    const m = this.m, op = e[2];
    if (op === 'ml') {
      this.onRail = null;
      const pos = new THREE.Vector3(e[4], e[5], e[6]), dir = new THREE.Vector3(e[7], e[8], e[9]);
      const pr = m.projectiles.spawn({ weapon: WEAPONS.malyutka, pos, dir, owner: m.player.body, team: this.team, ammoId: MISSILES[e[3]].id, visual: true, vel: dir.clone().multiplyScalar(60) });
      this._arm(pr, pos, false);
      this.netMissile = null; this.remoteMissile = pr;
      m.fx.muzzleBlast(pos, dir); m.audio.shot(pos, 'rpg', false);
      this.reloadT = 12;
    } else if (op === 'mp') this.netMissile = { p: [e[3], e[4], e[5]], v: [e[6], e[7], e[8]], at: performance.now() };
    else if (op === 'me') {
      const pr = this.remoteMissile;
      if (pr && pr.alive) { pr.alive = false; m.projectiles.explode(new THREE.Vector3(e[3], e[4], e[5]), pr.ammo.explosive, null, null, null, { visual: true }); }
      this.remoteMissile = null; this.netMissile = null;
    }
  }
  remoteFire() {}

  update(dt) {
    const m = this.m;
    this.emUpdate();
    if (this.moving && this.mover) { this.mountYaw = this.yawM; this.syaw = this.yawM; }
    // ракета: трассер и дымный след; конец полёта — заряжание следующей
    for (const pr of [this.missile, this.remoteMissile]) {
      if (!pr) continue;
      if (pr.alive) {
        const tail = pr.p.clone().addScaledVector(pr.v.clone().normalize(), -0.42);
        const d = m.camPos ? tail.distanceTo(m.camPos) : 50;
        const s = Math.max(0.35, d * 0.0042);
        m.fx.glow.emit(tail.x, tail.y, tail.z, 0, 0, 0, 0.05, s, s * 0.8, 1, 0.45, 0.25, 1, 0);
        if (Math.random() < dt * 30) m.fx.smoke.emit(tail.x, tail.y, tail.z, rand(-0.2, 0.2), rand(0, 0.3), rand(-0.2, 0.2), rand(1.5, 3), 0.15, 1.2, 0.85, 0.85, 0.85, 0.35, 0, 0.5, 0);
      }
    }
    if (this.missile && !this.missile.alive) {
      const pr = this.missile;
      this._net(['me', +pr.p.x.toFixed(2), +pr.p.y.toFixed(2), +pr.p.z.toFixed(2)]);
      this.missile = null;
      if (this.stock.m + this.stock.t > 0) this.reloadT = 12;
    }
    if (this.remoteMissile && !this.remoteMissile.alive) this.remoteMissile = null;
    if (!this.onRail && !this.missile && this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const k = this.stock[this.sel] > 0 ? this.sel : this.stock.m > 0 ? 'm' : this.stock.t > 0 ? 't' : null;
        if (k) { this.stock[k]--; this.onRail = k; if (m.player.gun === this) { m.audio.mech('reload'); m.hud.message(`На направляющей — ${MISSILES[k].name}. Готов к пуску`, 2); } }
      }
    }
    // ручка у остальных — к нулю
    if (m.player.gun !== this) { this.stick.x *= Math.exp(-dt * 6); this.stick.y *= Math.exp(-dt * 6); }
    this._place();
    this.gunIt.pos.copy(this.panelWorld()).setY(this.pos.y + 0.5);
    const pr = this.missile;
    this.hudText = `<div class="wn">ПТРК 9К11 «Малютка»</div><div>${pr ? `Ракета в полёте: ${pr.p.distanceTo(pr.launchPos).toFixed(0)} м, ${pr.t.toFixed(1)} с${pr.wire ? '' : ' · <b class="bad">без провода</b>'}` : this.onRail ? `На направляющей: ${MISSILES[this.onRail].name}` : this.reloadT > 0 ? `заряжание… ${this.reloadT.toFixed(0)} с` : 'ракет нет'}</div><div>Запас: 9М14М ${this.stock.m} · тандем ${this.stock.t} · следующая ${MISSILES[this.sel].name} (Z)</div><div class="ws">ЛКМ — пуск · W/A/S/D — ручка (Shift — точнее) · V — 8× / обзор · E — встать</div>`;
  }

  // прицел 9Ш16 у пульта
  camera(cam) {
    // окуляр — перед головкой прицела (камера не внутри корпуса пульта)
    const eye = this.panelWorld().add(new THREE.Vector3(-Math.sin(this.syaw) * 0.22, 0, -Math.cos(this.syaw) * 0.22));
    eye.y = this.pos.y + 0.55;
    cam.position.copy(eye);
    cam.quaternion.setFromEuler(new THREE.Euler(this.spitch, this.syaw, 0, 'YXZ'));
    if (this.ui) this.ui.draw();
    return this.zoom ? 8 : 55;
  }
}

// сетка прицела 9Ш16 и индикатор ручки
class AtgmUI {
  constructor(a) {
    this.a = a; this.m = a.m;
    this.ret = document.createElement('canvas'); this.ret.className = 'gunret';
    this.m.hud.root.appendChild(this.ret);
  }
  show(on) { this.ret.style.display = on ? 'block' : 'none'; this.m.hud.root.classList.toggle('gunner', false); }
  draw() {
    const a = this.a, c = this.ret, W = innerWidth, H = innerHeight;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = c.getContext('2d');
    g.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2;
    if (a.zoom) {
      const R = Math.min(W, H) * 0.46;
      g.fillStyle = '#040505'; g.beginPath(); g.rect(0, 0, W, H); g.arc(cx, cy, R, 0, Math.PI * 2, true); g.fill();
      const pxMil = (H / 2) / Math.tan((8 / 2) * Math.PI / 180) * MIL;
      g.strokeStyle = '#111'; g.lineWidth = 1.4; g.fillStyle = '#111'; g.font = '11px monospace'; g.textAlign = 'center';
      // перекрестие с делениями через 5 тыс.
      g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx - 6, cy); g.moveTo(cx + 6, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy - 6); g.moveTo(cx, cy + 6); g.lineTo(cx, cy + R); g.stroke();
      for (let k = -40; k <= 40; k += 5) {
        if (!k) continue;
        const d = k * pxMil;
        if (Math.abs(d) > R) continue;
        const l = k % 10 === 0 ? 7 : 4;
        g.beginPath(); g.moveTo(cx + d, cy - l); g.lineTo(cx + d, cy + l); g.moveTo(cx - l, cy + d); g.lineTo(cx + l, cy + d); g.stroke();
      }
    }
    // индикатор ручки управления и состояние ракеты
    const bx = W - 130, by = H - 150, S = 46;
    g.strokeStyle = 'rgba(220,230,210,0.9)'; g.lineWidth = 1.5;
    g.strokeRect(bx - S, by - S, S * 2, S * 2);
    g.beginPath(); g.moveTo(bx - S, by); g.lineTo(bx + S, by); g.moveTo(bx, by - S); g.lineTo(bx, by + S); g.stroke();
    g.fillStyle = '#ffb060'; g.beginPath(); g.arc(bx + a.stick.x * S, by - a.stick.y * S, 6, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(220,230,210,0.95)'; g.font = '12px monospace'; g.textAlign = 'center';
    g.fillText('ручка (W/A/S/D)', bx, by + S + 16);
    const pr = a.missile;
    if (pr) g.fillText(`${pr.p.distanceTo(pr.launchPos).toFixed(0)} м · ${pr.t.toFixed(1)} с${pr.wire ? '' : ' · провод!'}`, bx, by - S - 10);
  }
}
