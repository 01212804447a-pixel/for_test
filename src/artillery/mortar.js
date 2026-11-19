// 82-мм миномёт 2Б14-1 «Поднос» на огневой позиции. Наводчик (игрок) работает прицелом
// МПМ-44М: угломер — поворотным механизмом, прицел (возвышение 45–85°) и уровень — как у Д-30,
// пузырёк на середину — подъёмным механизмом. Расчёт: заряжающий держит мину у дульного среза,
// подносчик носит мины из ящика (в 6 м за миномётом). Выстрел — заряжающий опускает мину в
// ствол, она скользит вниз и накалывается на боёк. «Серия» (C): после выстрела сразу следующую.
// Если расчёт выбит — мину из ящика берёт сам игрок и опускает в ствол (E у дульного среза).
import * as THREE from 'three';
import { buildMortar, MORTAR } from './mortarModel.js';
import { MIL, fmtDiv } from './d30.js';
import { CHARGES82, mortarTable, EL82_MIN, EL82_MAX } from './mortar82.js';
import { WEAPONS } from '../data/weapons.js';
import { charAvailable } from '../entities/charRig.js';
import { CrewSoldier, crewItems } from './crew.js';
import { GunUI } from './gunUI.js';
import { Howitzer } from './howitzer.js';
import { massBlast } from './ammoPile.js';
import { setupEmplace } from './emplace.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const BOX_DIST = 6;
const V_RUN = 3.4, V_CARRY = 2.9;
const VIEWS = ['pano', 'eye', 'side'];
const Y = new THREE.Vector3(0, 1, 0);

export const MORTAR_SPEC = {
  title: '2Б14', charges: CHARGES82, table: mortarTable, panoFov: 9, panoName: 'МПМ-44М',
  shell: (h) => (h.shellType === 'd' ? 'Д-832ДУ (дымовая)' : 'О-832ДУ (осколочная)'),
  fuzeRow: (h) => `<div class="gr"><span>Мина (Z)</span><b>${h.shellType === 'd' ? 'дымовая' : 'осколочная'}</b></div>
    <div class="gr"><span>В ящике</span><b>осколочных ${h.mines} · дымовых ${h.smokes}</b></div>
    <div class="gr"><span>Серия (C)</span><b>${h.auto ? 'следующая — сразу' : 'по команде R'}</b></div>`,
  loadedText: (L) => `${L.shell === 'd' ? 'дымовая' : 'осколочная'}, заряд ${CHARGES82[L.ci].name}`,
  views: { pano: 'МПМ-44М', eye: 'обзор', side: 'со стороны' },
  keysExtra: ' · Z — мина · C — серия',
  tableTitle: 'Таблица стрельбы 82-мм миномёта 2Б14-1',
  tableNote: (T) => `Мина О-832ДУ (у дымовой Д-832ДУ — та же таблица). Заряд <b>${T.charge.name}</b> (V₀ = ${T.charge.v0} м/с): дальность ${Math.round(T.minRange).toLocaleString('ru')}–${Math.round(T.maxRange).toLocaleString('ru')} м. Стрельба навесная, возвышение 45–85° (750–1417 тыс.): <b>чем больше прицел, тем ближе разрыв</b>.`,
  guide: (m) => m.app.ui.show(`<h1>Миномёт 2Б14-1 «Поднос»</h1><div class="opc">82-мм миномёт: навесная стрельба на 85 м – 4 км, мина О-832ДУ (осколочная) и Д-832ДУ (дымовая).</div>
    <ol class="guide">
    <li><b>Цель и дальность.</b> M — карта огня: щёлкните по цели, получите дальность, дирекционный угол и превышение (угол места).</li>
    <li><b>Заряд.</b> 1–6 — основной и 1–5 дополнительных. T — таблица: для каждого заряда свой диапазон дальностей; выберите заряд, на котором дальность до цели — в середине диапазона.</li>
    <li><b>Угломер.</b> A/D или мышь — поворотный механизм, пока угломер на МПМ-44М не совпадёт с дирекционным углом на цель.</li>
    <li><b>Прицел.</b> Колесо или [ ] — установка прицела по таблице (возвышение в тысячных). Внимание: у миномёта прицел <b>больше — разрыв ближе</b>.</li>
    <li><b>Уровень.</b> − / = — угол места цели (3000 + превышение в тыс.). W/S или мышь — подъёмный механизм: выведите пузырёк на середину.</li>
    <li><b>Огонь.</b> R — заряжающий берёт мину (подносчик носит из ящика). Пробел/ЛКМ — опускает мину в ствол. C — серия: следующая мина сразу после выстрела.</li>
    <li><b>Корректировка.</b> По докладу наблюдателя: перелёт — увеличить прицел, недолёт — уменьшить; правее — угломер меньше.</li>
    <li><b>Дым.</b> Z — дымовая мина: завеса ≈ 1 мин, сносится ветром; ставьте с наветренной стороны от цели.</li>
    <li><b>Смена позиции.</b> Вне прицела: E у миномёта — переместить (несёте перед собой), рядом с машиной — погрузить; E у машины — выгрузить.</li>
    </ol><div class="row"><button class="btn" data-close>Закрыть (Esc)</button></div>`, { wide: true }),
};

export class Mortar {
  constructor(m, { x, z, dir = 0, name = '2Б14 № 1', team = 'negs', stowIn = null }) {
    this.m = m; this.name = name; this.team = team; this.kind = 'mortar';
    this.model = buildMortar();
    m.scene.add(this.model.root);
    this.pos = new THREE.Vector3(x, m.terrain.heightAt(x, z), z);
    this.az = dir; this.elM = 1000; this.drum = 1000; this.level = 3000;
    this.ci = 3; this.shellType = 'o'; this.auto = true;
    this.loaded = null; this.load = null; this.recoilT = 9; this.shots = 0; this.dropT = -1;
    this.mines = 40; this.smokes = 10;
    this.view = 'pano'; this.orbit = { yaw: 0.8, pitch: 0.35, dist: 5 };
    this.reports = []; this.colliders = []; this.ui = null;
    // расчёт: заряжающий у дульного среза, подносчик — между ящиком и миномётом
    this.crew = [];
    if (charAvailable('negs')) {
      [['заряжающий', 'crouch', 0.55, -0.45, -0.6], ['подносчик', 'kneel', 1.1, 1.5, 0.3]].forEach(([role, pose, lx, lz, ry]) => {
        const s = new CrewSoldier(m, { team, name: `${name}: ${role}`, callsign: `${role} ${name}`, x, z });
        s.idle = { pose, local: new THREE.Vector3(lx, 0, lz), ry };
        s.crewRole = role; s.gunRef = this; s.job = null;
        m.soldiers.push(s);
        s.netIdx = m.netAI.length; m.netAI.push(s);
        if (m.net && !m.net.isHost) s.damage = (amount, zone, source, dir, opts) => m.net.aiDamage(s, amount, zone, source, dir, opts);
        this.crew.push(s);
      });
    }
    this.box = this._makeBox();
    // взаимодействие
    const self = this;
    this.gunIt = {
      pos: new THREE.Vector3(), r: 1.6, hold: 0.25, label: `Занять место наводчика: ${name}`,
      enabled: () => this.ready && !m.player.gun && !m.player.carry && !m.player.vehicle && !this.netUser && m.player.body.alive,
      action: () => this.mount(m.player),
    };
    this.boxIt = {
      pos: new THREE.Vector3(), r: 1.6, hold: 0.4,
      get label() { return `Взять мину ${self.shellType === 'd' ? 'Д-832ДУ (дымовую)' : 'О-832ДУ'} — заряд ${CHARGES82[self.ci].name} (осталось ${self.shellType === 'd' ? self.smokes : self.mines})`; },
      enabled: () => this.ready && this.box.alive && m.player.body.alive && !m.player.carry && !m.player.gun && !m.player.vehicle,
      action: () => this.manualPick(m.player),
    };
    this.muzzleIt = {
      pos: new THREE.Vector3(), r: 1.4, hold: 0.3, label: 'Опустить мину в ствол — выстрел!',
      enabled: () => { const c = m.player.carry; return this.ready && !!c && c.item === 'mine' && (c.gun === this || c.free); },
      action: () => this.manualDrop(m.player),
    };
    m.interactables.push(this.gunIt, this.boxIt, this.muzzleIt);
    setupEmplace(this, m, { kind: 'mortar', name: `миномёт ${name}`, speed: 2.2, front: 1.6 });
    if (stowIn) this.stow(stowIn, true); else this._onPlace(-dir * MIL);
  }

  get spec() { return MORTAR_SPEC; }
  get ready() { return !this.moving && !this.stowedIn; }
  get charge() { return CHARGES82[this.ci]; }
  get wantEl() { return this.drum + (this.level - 3000); }
  canHitch() { return false; }
  crewAlive() { return this.crew.some((a) => a.alive); }
  busy() { return this.m.player.gun === this || !!this.load || this.dropT >= 0; }

  // ---------- переноска (emplace.js) ----------
  _onPick() {
    for (const o of this.colliders) this.m.world.removeObstacle(o);
    this.colliders = [];
    this.load = null; this.loaded = null; this.dropT = -1;
    for (const c of this.crew) c.job = null;
    this._stowBox();
    this.model.root.visible = !!this.mover;
  }
  _onPlace(yaw) {
    this.az = ((-yaw / MIL) % 6000 + 6000) % 6000;
    this.model.root.visible = true;
    const W = this.m.world, P = this.pos;
    this.colliders = [W.addCylCollider({ x: P.x, z: P.z, y0: P.y, r: 0.32, h: 0.9, mat: 'metal', pen: 6, cover: false, owner: { kind: 'gun', gun: this } })];
    this._placeBox();
  }
  _onStow() { this._onPick(); this.model.root.visible = false; }

  // ---------- ящик с минами ----------
  _makeBox() {
    const m = this.m, g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x55462b, roughness: 0.85 }), woodD = new THREE.MeshStandardMaterial({ color: 0x3f3320, roughness: 0.9 });
    const crate = (w, h, d, x, y, z, ry, mat) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); b.position.set(x, y, z); b.rotation.y = ry; b.castShadow = true; b.receiveShadow = true; g.add(b); };
    crate(0.62, 0.22, 0.34, 0, 0.11, 0, 0, wood); crate(0.62, 0.22, 0.34, 0, 0.11, 0.38, 0.03, woodD); crate(0.62, 0.22, 0.34, 0.02, 0.33, 0.19, -0.04, wood);
    crate(0.62, 0.22, 0.34, 0.7, 0.11, 0.15, 0.08, woodD);
    const I = crewItems();
    for (let i = 0; i < 3; i++) { const mn = I.mine.clone(); mn.rotation.y = Math.PI / 2; mn.position.set(0.7, 0.26, 0.05 + i * 0.1); g.add(mn); }
    g.visible = false; m.scene.add(g);
    const d = { kind: 'ammo', hp: 10, maxHp: 10, mesh: g, pos: new THREE.Vector3(), alive: true, r: 0.6, gun: this, stowed: true, collider: null };
    m.world.destructibles.push(d);
    return d;
  }
  _placeBox() {
    const d = this.box;
    if (!d.alive) return;
    const yaw = -this.az * MIL, c = Math.cos(yaw), s = Math.sin(yaw), lx = 1.6, lz = BOX_DIST;
    const x = this.pos.x + lx * c + lz * s, z = this.pos.z - lx * s + lz * c, y = this.m.terrain.heightAt(x, z);
    d.pos.set(x, y + 0.3, z); d.mesh.position.set(x, y, z); d.mesh.rotation.y = yaw; d.mesh.visible = true;
    if (d.collider) this.m.world.removeObstacle(d.collider);
    d.collider = this.m.world.addBoxCollider({ x, z, y0: y, w: 1.4, d: 0.8, h: 0.5, yaw, mat: 'wood', pen: 6, owner: d, cover: true });
    d.stowed = false;
  }
  _stowBox() {
    const d = this.box;
    if (d.collider) { this.m.world.removeObstacle(d.collider); d.collider = null; }
    d.stowed = true; d.mesh.visible = false;
  }
  boxExplode(by) {
    const m = this.m, d = this.box, P = d.pos.clone();
    const mines = this.mines, smokes = this.smokes;
    this.mines = 0; this.smokes = 0; this.load = null; this.loaded = null;
    for (const c of this.crew) c.job = null;
    if (d.collider) { m.world.removeObstacle(d.collider); d.collider = null; }
    d.mesh.visible = false;
    // сила взрыва — по числу оставшихся мин (дымовые — слабее, но дают завесу)
    if (mines + smokes > 0) massBlast(m, P, { mines: mines + smokes * 0.4 }, by);
    if (smokes > 0) m.smokeScreens && m.smokeScreens.add(P, { dur: 30 + smokes * 2, size: Math.min(2.2, 1 + smokes * 0.1), burst: true });
    m.hud.message(`Взрыв мин у ${this.name}: ${mines + smokes} шт.!`, 4, true);
  }

  // ---------- заряжание ----------
  orderLoad(fromNet = false, ci = null, shell = null) {
    const m = this.m;
    const say = (t, d = 1.5) => { if (!fromNet) m.hud.message(t, d); };
    if (!this.ready) return;
    if (this.loaded) return say('Мина у дульного среза — огонь!');
    if (this.load) return say('Уже несут');
    const sh = shell ?? this.shellType;
    if (!this.box.alive || (sh === 'd' ? this.smokes : this.mines) <= 0) return say(sh === 'd' ? 'Дымовые мины кончились' : 'Осколочные мины кончились', 2.5);
    this.load = { ci: ci ?? this.ci, shell: sh };
    if (!fromNet) {
      if (!this.crewAlive()) m.hud.message(`Расчёт выбыл: мину из ящика (в ${BOX_DIST} м за миномётом, E) несите сами и опустите в ствол (E у дульного среза)`, 5);
      else m.hud.radio('Командир', `${sh === 'd' ? 'Дымовой' : 'Осколочной'} миной, заряд ${CHARGES82[this.load.ci].name}!`);
      this._net(['l', this.load.ci, sh === 'd' ? 1 : 0]);
    }
  }
  loadStatus() {
    if (this.loaded) return null;
    if (this.dropT >= 0) return 'мина в стволе…';
    if (!this.load) return null;
    const c = this.crew.find((a) => a.alive && a.job);
    if (!c) return this.crewAlive() ? 'ждём' : 'несите сами';
    return { toBox: 'бежит к ящику', pick: 'берёт мину, навешивает заряды', toGun: 'несёт мину', hold: 'мина у ствола' }[c.job.phase] || '…';
  }
  _holder() { return this.crew.find((a) => a.alive && a.job && (a.job.phase === 'hold' || a.job.phase === 'drop')); }
  _loadStep() {
    for (const c of this.crew) if (c.job && !c.alive) c.job = null;
    if (!this.load || this.loaded) return;
    // кто несёт: подносчик (если жив), иначе заряжающий
    if (this.crew.some((a) => a.alive && a.job)) return;
    const order = [1, 0];
    for (const i of order) { const a = this.crew[i]; if (a && a.alive) { a.job = { phase: 'toBox', t: 0, ci: this.load.ci, shell: this.load.shell }; break; } }
  }
  // точки у ствола
  _muzzle(out = new THREE.Vector3()) { this.model.tube.updateWorldMatrix(true, false); return out.set(0, 0, MORTAR.muzzle).applyMatrix4(this.model.tube.matrixWorld); }
  boreDir(out = new THREE.Vector3()) { const q = new THREE.Quaternion(); this.model.tube.getWorldQuaternion(q); return out.set(0, 0, -1).applyQuaternion(q); }
  muzzleWorld(out) { return this._muzzle(out); }
  _stand() {
    const M = this._muzzle(), yaw = -this.az * MIL;
    const r = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const S = M.clone().addScaledVector(r, 0.55).addScaledVector(f, 0.25); S.y = this.m.terrain.heightAt(S.x, S.z);
    return { M, S, r, f, low: M.y - S.y < 0.95 };
  }
  _jobTask(a, dt) {
    const j = a.job, Mn = a.man, box = this.box;
    j.t += dt;
    const st = this._stand();
    const faceM = Math.atan2(-(st.M.x - st.S.x), -(st.M.z - st.S.z));
    if (!box.alive || box.stowed) { a.job = null; return null; }
    const bx = box.pos, toGun = new THREE.Vector3(this.pos.x - bx.x, 0, this.pos.z - bx.z).normalize();
    const boxStand = new THREE.Vector3(bx.x, 0, bx.z).addScaledVector(toGun, 0.7); boxStand.y = this.m.terrain.heightAt(boxStand.x, boxStand.z);
    const faceBox = Math.atan2(-(bx.x - boxStand.x), -(bx.z - boxStand.z));
    switch (j.phase) {
      case 'toBox':
        if (Math.hypot(Mn.pos.x - boxStand.x, Mn.pos.z - boxStand.z) < 0.25) { j.phase = 'pick'; j.t = 0; }
        return { p: boxStand, yaw: faceBox, pose: 'stand', speed: V_RUN };
      case 'pick': {
        if (j.t > 1.4) {
          const k = j.shell === 'd' ? 'smokes' : 'mines';
          if (this[k] <= 0) { a.job = null; this.load = null; this.m.hud.message(j.shell === 'd' ? 'Дымовые мины кончились' : 'Осколочные мины кончились', 2); return null; }
          this[k]--; j.phase = 'toGun'; j.t = 0;
        }
        const top = new THREE.Vector3(bx.x, bx.y + 0.15, bx.z);
        return { p: boxStand, yaw: faceBox, pose: 'work', hands: [top.clone().add(new THREE.Vector3(-0.12, 0, 0)), top.clone().add(new THREE.Vector3(0.12, 0, 0))] };
      }
      case 'toGun':
        if (Math.hypot(Mn.pos.x - st.S.x, Mn.pos.z - st.S.z) < 0.3) {
          // подносчик отдаёт мину заряжающему, если тот жив и стоит у ствола
          const loader = this.crew[0];
          if (a !== loader && loader && loader.alive) { loader.job = { phase: 'hold', t: 0, ci: j.ci, shell: j.shell }; a.job = null; }
          else { j.phase = 'hold'; j.t = 0; }
          this.loaded = { ci: j.ci, shell: j.shell }; this.load = null;
          if (this.m.player.gun === this) this.m.hud.radio(this.crew[0] && this.crew[0].alive ? 'Заряжающий' : 'Подносчик', 'Готово!');
        }
        return { p: st.S.clone(), yaw: faceM, pose: 'stand', speed: V_CARRY, carry: true, item: 'mine' };
      case 'hold': {
        // мина у дульного среза хвостовиком вниз, руки на корпусе
        const up = st.M.clone().add(new THREE.Vector3(0, 0.22, 0)).addScaledVector(st.r, 0.06);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), Y);
        return { p: st.S.clone(), yaw: faceM, pose: st.low ? 'crouch' : 'stand', carry: true, item: 'mine', itemPos: up, itemQuat: q };
      }
      case 'drop': {
        // опускает мину в ствол и отдёргивает руки
        const u = Math.min(1, j.t / 0.45), dir = this.boreDir();
        const from = st.M.clone().add(new THREE.Vector3(0, 0.22, 0)), to = st.M.clone().addScaledVector(dir, -0.3);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
        if (u >= 1) { a.job = null; return { p: st.S.clone().addScaledVector(st.r, 0.3), yaw: faceM, pose: 'crouch' }; }
        return { p: st.S.clone(), yaw: faceM, pose: st.low ? 'crouch' : 'stand', carry: true, item: 'mine', itemPos: from.lerp(to, u), itemQuat: q };
      }
    }
    return null;
  }
  _crew(dt) {
    const show = this.ready || (this.moving && this.mover);
    const yawQ = new THREE.Quaternion().setFromAxisAngle(Y, -this.az * MIL);
    for (const a of this.crew) {
      const M = a.man;
      if (!a.alive) { M.visible = true; M.update(dt, { p: M.pos, yaw: M.yaw, dead: true }); a.sync(); a.hidden = true; continue; }
      M.visible = !!show;
      if (!show) { a.sync(); continue; }
      let task = a.job && this.ready ? this._jobTask(a, dt) : null;
      if (!task) {
        const p = a.idle.local.clone().applyQuaternion(yawQ).add(this.pos); p.y = this.m.terrain.heightAt(p.x, p.z);
        task = { p, yaw: -this.az * MIL + a.idle.ry, pose: this.moving ? 'stand' : a.idle.pose, speed: this.moving ? 2.4 : undefined };
      }
      M.update(dt, task);
      a.sync();
    }
  }

  // ручное заряжание
  manualPick(p, fromNet = false, shell = null) {
    const sh = shell ?? this.shellType, k = sh === 'd' ? 'smokes' : 'mines';
    if (this[k] <= 0) { if (!fromNet) this.m.hud.message('Мины кончились', 2); return; }
    this[k]--;
    if (fromNet) return;
    p.carry = { item: 'mine', gun: this, ci: this.ci, shell: sh, speed: 2.6, onDrop: () => { if (!(this.m.ammoPiles && this.m.ammoPiles.dropCarry())) { p.carry = null; this.m.hud.message('Груз брошен', 1.5); } } };
    this.m.audio.mech('reload');
    this.m.hud.message(`Мина в руках (заряд ${CHARGES82[this.ci].name}): к дульному срезу — E, или G — положить на землю`, 3);
    this._net(['k', sh === 'd' ? 1 : 0]);
  }
  manualDrop(p) {
    const c = p.carry;
    if (!c) return;
    p.carry = null;
    this.loaded = { ci: c.ci ?? this.ci, shell: c.shell === 'd' ? 'd' : 'o' };
    this.m.audio.mech('switch');
    this.m.after(0.35, () => this._shoot(p.body));
  }

  // ---------- место наводчика ----------
  mount(p) {
    if (!this.ready) return;
    p.gun = this; this.view = 'pano';
    if (!this.ui) this.ui = new GunUI(this);
    this.ui.show(true);
    this.m.hud.message(`${this.name}: прицел МПМ-44М. G — гайд, M — карта огня, T — таблица стрельбы`, 4);
  }
  dismount(p) {
    p.gun = null;
    this.model.root.visible = true;
    if (this.ui) this.ui.show(false);
    const q = new THREE.Vector3(-1.2, 0, 0.6).applyAxisAngle(Y, -this.az * MIL).add(this.pos);
    p.body.pos.set(q.x, this.m.terrain.heightAt(q.x, q.z), q.z);
    p.yaw = -this.az * MIL;
  }
  seatWorld() { return new THREE.Vector3(-0.45, 0, 0.35).applyAxisAngle(Y, -this.az * MIL).add(this.pos); }

  control(dt) {
    const m = this.m, inp = m.input, p = m.player;
    const fast = inp.bd('sprint');
    if (inp.bh('use')) { this.dismount(p); return; }
    if (inp.hit('KeyV')) { this.view = VIEWS[(VIEWS.indexOf(this.view) + 1) % VIEWS.length]; m.hud.message(this.spec.views[this.view], 1.5); }
    if (inp.hit('KeyG')) { this.ui.guide(); return; }
    if (inp.hit('KeyM')) { this.ui.fireMap(); return; }
    if (inp.hit('KeyT')) { this.ui.table(this.ci); return; }
    for (let i = 0; i < CHARGES82.length; i++) if (inp.hit('Digit' + (i + 1))) {
      if (this.loaded || this.load) m.hud.message('Мина уже заряжена — заряд сменить нельзя', 2);
      else { this.ci = i; m.hud.message(`Заряд ${CHARGES82[i].name}`, 1.5); m.audio.click(); }
    }
    if (inp.hit('KeyZ')) {
      if (this.loaded || this.load) m.hud.message('Мину выбирают до заряжания', 2);
      else { this.shellType = this.shellType === 'd' ? 'o' : 'd'; m.hud.message(this.shellType === 'd' ? 'Дымовая мина Д-832ДУ' : 'Осколочная мина О-832ДУ', 1.5); m.audio.click(); }
    }
    if (inp.hit('KeyC')) { this.auto = !this.auto; m.hud.message(this.auto ? 'Серия: следующая мина — сразу после выстрела' : 'Заряжание по команде (R)', 2); }
    const st = fast ? 10 : 1;
    if (inp.bh('sightUp') || inp.hit('BracketRight')) { this.drum = clamp(this.drum + st, EL82_MIN, EL82_MAX); m.audio.mech('sight'); }
    if (inp.bh('sightDown') || inp.hit('BracketLeft')) { this.drum = clamp(this.drum - st, EL82_MIN, EL82_MAX); m.audio.mech('sight'); }
    if (this.view !== 'side' && inp.wheel) { this.drum = clamp(this.drum + (inp.wheel < 0 ? 1 : -1) * st, EL82_MIN, EL82_MAX); m.audio.mech('sight'); }
    if (inp.hit('Equal') || inp.hit('NumpadAdd')) { this.level = clamp(this.level + st, 2700, 3300); m.audio.mech('sight'); }
    if (inp.hit('Minus') || inp.hit('NumpadSubtract')) { this.level = clamp(this.level - st, 2700, 3300); m.audio.mech('sight'); }
    const sens = m.settings.sens * 0.25;
    const tr = ((inp.bd('moveR') ? 1 : 0) - (inp.bd('moveL') ? 1 : 0)) * (fast ? 120 : 12);
    const ev = ((inp.bd('moveF') ? 1 : 0) - (inp.bd('moveB') ? 1 : 0)) * (fast ? 60 : 6);
    if (this.view === 'side') {
      this.orbit.yaw -= inp.dx * 0.004; this.orbit.pitch = clamp(this.orbit.pitch + inp.dy * 0.003, -0.1, 1.2);
      if (inp.wheel) this.orbit.dist = clamp(this.orbit.dist + Math.sign(inp.wheel) * 0.6, 2.5, 14);
    } else {
      this.az += inp.dx * sens * (this.view === 'eye' ? 4 : 1);
      this.elM -= inp.dy * sens * (this.view === 'eye' ? 4 : 1) * (m.settings.invertY ? -1 : 1);
    }
    this.az += tr * dt; this.elM += ev * dt;
    this.az = ((this.az % 6000) + 6000) % 6000;
    this.elM = clamp(this.elM, EL82_MIN, EL82_MAX);
    if (inp.bh('reload') || inp.hit('KeyR')) this.orderLoad();
    if (inp.bh('fire') || inp.hit('Space')) this.fire();
    p.body.pos.copy(this.seatWorld());
  }

  fire() {
    const m = this.m;
    if (!this.ready || this.dropT >= 0) return;
    if (!this.loaded) { m.hud.message(this.load ? 'Мину ещё несут' : 'Мины нет (R — заряжать)', 1.5); m.audio.click(); return; }
    const h = this._holder();
    if (h) { h.job = { phase: 'drop', t: 0 }; this.dropT = 0.45; }
    else this.dropT = 0.1;
    this._dropBy = m.player.body;
  }
  // мина дошла до бойка — выстрел
  _shoot(owner) {
    const m = this.m, L = this.loaded;
    if (!L) return;
    this.loaded = null; this.dropT = -1;
    const pos = this._muzzle(), dir = this.boreDir();
    const ammoId = (L.shell === 'd' ? 'd832_' : 'o832_') + CHARGES82[L.ci].id;
    const p = m.projectiles.spawn({ weapon: WEAPONS.mortar82, pos, dir, owner: owner || m.player.body, team: this.team, ammoId });
    p.gun = this; p.shotNo = ++this.shots; p.charge = L.ci;
    p.onLand = (pp) => this.report(pp);
    if (m.net) m.net.onLocalShot({ weapon: WEAPONS.mortar82, owner: owner || m.player.body, ammoId, gun: this }, p);
    this._blast(pos, dir, true);
    if (m.player.gun === this) m.hud.radio('Наводчик', `Выстрел! Заряд ${CHARGES82[L.ci].name}, угломер ${fmtDiv(this.az)}, прицел ${Math.round(this.drum)}.`);
    if (this.auto && this.crewAlive()) m.after(0.3, () => { if (!this.load && !this.loaded && this.ready) this.orderLoad(); });
  }
  _blast(pos, dir, own) {
    const m = this.m;
    this.recoilT = 0;
    m.fx.muzzleBlast(pos, dir);
    m.fx.flashLight(pos, 40, 0.05, 0xffb050, 25);
    for (let i = 0; i < 10; i++) m.fx.smoke.emit(pos.x, pos.y, pos.z, dir.x * 3 + (Math.random() - 0.5), dir.y * 3, dir.z * 3 + (Math.random() - 0.5), 2 + Math.random(), 0.4, 2.2, 0.8, 0.8, 0.8, 0.5, 0, 1, -0.05);
    const gp = this.pos.clone(); gp.y = m.terrain.heightAt(gp.x, gp.z);
    m.fx.impact(gp, Y, 'snow', 2.5);
    m.audio.explosion(pos, 0.8);
    m.audio.shot(pos, 'gp25', own);
    if (own && m.player.gun === this) m.player.shake = Math.max(m.player.shake, 0.5);
    m.noise(pos, 1500, this.team, own ? m.player.body : null);
  }
  remoteFire(p) {
    this.shots++; this.loaded = null; this.load = null; this.dropT = -1;
    for (const c of this.crew) if (c.job && (c.job.phase === 'hold' || c.job.phase === 'drop')) c.job = null;
    const pos = this._muzzle(), dir = this.boreDir();
    this._blast(pos, dir, false);
    void p;
  }

  _net(e) { const n = this.m.net; if (n) n.ev(['gm', this.m.guns.indexOf(this), ...e]); }
  netOp(e) {
    if (this.emNetOp(e)) return;
    const op = e[2];
    if (op === 'l') this.orderLoad(true, e[3], e[4] ? 'd' : 'o');
    else if (op === 'k') this.manualPick(null, true, e[3] ? 'd' : 'o');
  }

  update(dt) {
    this.recoilT += dt;
    this.emUpdate();
    if (this.dropT >= 0) { this.dropT -= dt; if (this.dropT < 0) { this.dropT = 0; this._shoot(this._dropBy); } }
    this._loadStep();
    // модель: курс, возвышение, отскок ствола после выстрела
    const g = this.model, R = g.root;
    if (this.moving && this.mover) { this.az = ((-this.yawM / MIL) % 6000 + 6000) % 6000; }
    R.position.copy(this.pos);
    R.rotation.set(0, -this.az * MIL, 0);
    g.pose(this.elM * MIL);
    const t = this.recoilT, kick = t < 0.05 ? t / 0.05 : t < 0.5 ? 1 - (t - 0.05) / 0.45 : 0;
    g.tube.position.copy(MORTAR.pivot).addScaledVector(new THREE.Vector3(0, Math.sin(this.elM * MIL), -Math.cos(this.elM * MIL)), -0.035 * kick);
    R.updateMatrixWorld(true);
    // точки взаимодействия
    this.gunIt.pos.copy(this.seatWorld()).setY(this.pos.y + 0.8);
    if (this.box) this.boxIt.pos.copy(this.box.pos).setY(this.box.pos.y + 0.4);
    this._muzzle(this.muzzleIt.pos);
    this._crew(dt);
    if (this.ui && this.m.player.gun === this) this.ui.update(dt);
  }

  camera(cam) {
    const g = this.model, azR = -this.az * MIL;
    g.root.visible = this.view !== 'pano' && (this.ready || this.moving);
    g.root.updateMatrixWorld(true);
    if (this.view === 'side') {
      const o = this.orbit, c = this.pos.clone().add(new THREE.Vector3(0, 0.7, 0)), yaw = azR + o.yaw;
      cam.position.set(c.x + Math.sin(yaw) * Math.cos(o.pitch) * o.dist, c.y + Math.sin(o.pitch) * o.dist, c.z + Math.cos(yaw) * Math.cos(o.pitch) * o.dist);
      const gy = this.m.terrain.heightAt(cam.position.x, cam.position.z) + 0.4; if (cam.position.y < gy) cam.position.y = gy;
      cam.lookAt(c.x - Math.sin(azR), c.y, c.z - Math.cos(azR));
      return 55;
    }
    if (this.view === 'pano') {
      cam.position.copy(g.sightEye()).applyMatrix4(g.root.matrixWorld);
      cam.quaternion.setFromEuler(new THREE.Euler(0, azR, 0, 'YXZ'));
      return this.spec.panoFov;
    }
    cam.position.copy(new THREE.Vector3(-0.55, 0.95, 0.75)).applyMatrix4(g.root.matrixWorld);
    cam.quaternion.setFromEuler(new THREE.Euler(0.12, azR, 0, 'YXZ'));
    return 65;
  }
}
// доклады наблюдателя о разрывах — как у Д-30
Mortar.prototype.report = Howitzer.prototype.report;
