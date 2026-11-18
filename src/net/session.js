// Сетевая сессия внутри задания: удалённые игроки (куклы с интерполяцией), выстрелы,
// урон через владельца цели, снимки мира от хоста кооператива (ИИ, техника, задачи),
// возрождение, лента убийств, таблица счёта.
//
// Принцип: каждый клиент считает свои выстрелы и попадания (как в большинстве шутеров),
// урон по чужой цели отправляется её владельцу: по игроку — самому игроку (в PvP сервер
// проверяет попадание), по ИИ и технике — хосту. Хост считает ИИ, технику без водителя-
// игрока, разрушаемые объекты и задачи и рассылает снимок мира 10 раз в секунду.
import * as THREE from 'three';
import { Soldier } from '../entities/soldier.js';
import { WEAPONS } from '../data/weapons.js';
import { pvpMap, TEAM_NAMES } from '../data/pvp.js';

const STANCES = ['stand', 'crouch', 'prone'];
const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

// Буфер интерполяции. Снимки ставятся на шкалу времени ОТПРАВИТЕЛЯ (ts — его performance.now),
// переведённую в местное время по наименьшей наблюдавшейся задержке: так пачки пакетов,
// пришедшие «гурьбой» после подвисшего кадра или сетевой задержки, не дают рывков.
// Задержка показа подстраивается под частоту снимков и разброс доставки (в LAN ~50–70 мс);
// если новых данных нет, движение коротко продолжается по последней скорости (≤ 0,12 с).
class Interp {
  constructor(angles = [], delay = 0.1) {
    this.buf = []; this.angles = angles; this.base = delay;
    this.off = null; this.gap = 0.05; this.jit = 0.012; this.lastTs = null;
  }
  push(v, ts) {
    const now = performance.now() / 1000;
    if (ts == null || !isFinite(ts)) ts = now;
    const o = now - ts;
    if (this.off == null || o < this.off) this.off = o;
    else this.off += Math.min(o - this.off, 0.0004); // медленный дрейф часов
    if (this.lastTs != null) {
      const g = ts - this.lastTs;
      if (g <= 0) return; // устаревший или повторный снимок
      if (g < 1) { this.gap += (g - this.gap) * 0.1; this.jit += (Math.max(0, o - this.off) - this.jit) * 0.1; }
    }
    this.lastTs = ts;
    const b = this.buf;
    b.push({ t: ts + this.off, v });
    if (b.length > 32) b.shift();
  }
  reset() { this.buf.length = 0; this.lastTs = null; }
  get delay() { return Math.min(0.25, Math.max(0.04, this.gap * 1.25 + this.jit * 2 + 0.012)); }
  sample(out = []) {
    const b = this.buf;
    if (!b.length) return null;
    const rt = performance.now() / 1000 - this.delay;
    let i = b.length - 1;
    while (i > 0 && b[i].t > rt) i--;
    const a = b[i], n = b[i + 1];
    if (!n) {
      // данных новее нет — продолжаем по последней скорости, недолго
      const p = b[i - 1];
      const ex = p ? Math.min(0.12, Math.max(0, rt - a.t)) : 0;
      const dt = p ? Math.max(1e-3, a.t - p.t) : 1;
      for (let k = 0; k < a.v.length; k++) {
        const x = a.v[k];
        out[k] = ex > 0 ? x + (this.angles.includes(k) ? wrap(x - p.v[k]) : x - p.v[k]) * (ex / dt) : x;
      }
      return out;
    }
    if (rt <= a.t) { for (let k = 0; k < a.v.length; k++) out[k] = a.v[k]; return out; }
    const f = Math.min(1, (rt - a.t) / Math.max(1e-3, n.t - a.t));
    for (let k = 0; k < a.v.length; k++) {
      const x = a.v[k], y = n.v[k];
      out[k] = this.angles.includes(k) ? x + wrap(y - x) * f : x + (y - x) * f;
    }
    return out;
  }
}

// Удалённый игрок: обычный боец-модель без ИИ; урон по нему уходит его владельцу
class RemoteSoldier extends Soldier {
  constructor(game, peer, x, y, z) {
    super(game, { team: peer.team, faction: peer.team === 'denter' ? 'denter' : 'negs', weapon: WEAPONS[peer.weapon] ? peer.weapon : 'ak74m', name: peer.name, callsign: peer.name, x, z, y, armor: 0.8, helmet: 0.6, grenades: 0 });
    this.peer = peer; this.isRemote = true;
  }
  damage(amount, zone, source, dir, opts = {}) {
    if (!this.alive) return;
    this.game.net.sendPlayerHit(this.peer.id, amount, zone, source, dir, opts);
    if (this.model && this.model.hit) this.model.hit(dir);
    this.lastHitTime = this.game.time;
  }
  netDie() {
    if (!this.alive) return;
    this.alive = false; this.health = 0; this.stance = 'prone';
    if (this.vehicle) { this.vehicle.removeOccupant(this); this.vehicle = null; this.hidden = false; }
  }
}

export class NetSession {
  constructor(app, net, start) {
    this.app = app; this.net = net;
    this.room = start.room; this.mode = start.room.mode; this.missionId = start.room.mission;
    this.seed = start.seed; this.hostId = start.host; this.late = !!start.late;
    const me = start.room.players.find((p) => p.id === net.id) || { id: net.id, team: 'negs', name: 'Я', weapon: 'ak74m' };
    this.me = me; this.team = this.mode === 'pvp' ? me.team : 'negs';
    this.slot = Math.max(0, start.room.players.findIndex((p) => p.id === net.id));
    this.nPlayers = start.room.players.length;
    this.peers = new Map();
    for (const p of start.room.players) if (p.id !== net.id) this.addPeer(p);
    this.m = null;
    this.out = []; this.hostOut = [];
    this.stT = 0; this.wsT = 0; this.allDeadT = 0;
    this.feed = []; this.score = start.room.score || { negs: 0, denter: 0 }; this.timeLeft = null;
    this.stats = new Map(); for (const p of start.room.players) this.stats.set(p.id, [p.kills || 0, p.deaths || 0]);
    this.respawnAt = 0; this.deathBy = '';
    this.aiInterp = []; this.vehInterp = [];
    this.ended = false;
    const on = (t, fn) => net.on(t, fn);
    this.unsub = [
      on('st', (m) => this.onState(m)),
      on('ws', (m) => this.onWorld(m)),
      on('ev', (m) => this.onEvents(m)),
      on('hit', (m) => this.onHit(m)),
      on('kill', (m) => this.onKill(m)),
      on('score', (m) => { this.score = m.score; this.timeLeft = m.left; }),
      on('end', (m) => this.onEnd(m)),
      on('left', (m) => this.removePeer(m.id, m.name)),
      on('joined', (m) => { this.addPeer({ id: m.id, name: m.name, team: m.team, weapon: 'ak74m' }); this.msg(`${m.name} вошёл в игру`); }),
      on('room', (m) => { for (const p of m.room.players) { const q = this.peers.get(p.id); if (q) { q.ping = p.ping; q.name = p.name; } else if (p.id === this.net.id) this.myPing = p.ping; } }),
      on('chat', (m) => this.msg(`<b>${esc(m.name)}:</b> ${esc(m.text)}`)),
      on('close', () => { if (!this.ended && this.m) { this.ended = true; this.m.netEnd(false, 'Соединение с сервером потеряно', true); } }),
    ];
  }

  get isHost() { return this.net.id === this.hostId; }
  get pvp() { return this.mode === 'pvp'; }

  addPeer(p) {
    if (this.peers.has(p.id) || p.id === this.net.id) return;
    this.peers.set(p.id, { id: p.id, name: p.name, team: this.mode === 'pvp' ? p.team : 'negs', weapon: p.weapon || 'ak74m', last: null, interp: new Interp([3, 4]), soldier: null, ping: p.ping || 0 });
  }
  removePeer(id, name) {
    const p = this.peers.get(id);
    if (!p) return;
    if (p.soldier) this.dropSoldier(p);
    if (p.tag) p.tag.remove();
    this.peers.delete(id);
    this.msg(`${esc(name || p.name)} покинул игру`);
  }
  dropSoldier(p) {
    const s = p.soldier, m = this.m;
    if (!s || !m) return;
    if (s.vehicle) s.vehicle.removeOccupant(s);
    s.removeFromScene(); if (s.blob) m.scene.remove(s.blob);
    const i = m.soldiers.indexOf(s); if (i >= 0) m.soldiers.splice(i, 1);
    p.soldier = null;
  }

  // ---------------------------------------------------------------- точка появления
  spawnPoint(def) {
    if (this.pvp) {
      const sp = pvpMap(def.id).spawns[this.team] || def.start;
      const a = Math.random() * 6.28, r = 2 + Math.random() * 7;
      return { x: sp.x + Math.cos(a) * r, z: sp.z + Math.sin(a) * r, yaw: sp.yaw };
    }
    const st = def.start, i = this.slot;
    const off = [[0, 0], [-2.5, 2], [2.5, 2], [0, 4]][i % 4];
    const c = Math.cos(st.yaw), s = Math.sin(st.yaw);
    return { x: st.x + c * off[0] + s * off[1], z: st.z - s * off[0] + c * off[1], yaw: st.yaw };
  }

  attach(m) { this.m = m; m.net = this; }

  // после постройки мира
  onBuilt() {
    const m = this.m, root = m.hud.root;
    this.el = {
      feed: document.createElement('div'), board: document.createElement('div'), top: document.createElement('div'), dead: document.createElement('div'), tags: document.createElement('div'), ping: document.createElement('div'),
    };
    this.el.ping.className = 'netping';
    this.el.feed.className = 'netfeed'; this.el.board.className = 'netboard'; this.el.top.className = 'nettop'; this.el.dead.className = 'netdead'; this.el.tags.className = 'nettags';
    for (const e of Object.values(this.el)) root.appendChild(e);
    this.msg(this.pvp ? `Противостояние: ${TEAM_NAMES.negs} против ${TEAM_NAMES.denter}. Ваша команда — <b>${TEAM_NAMES[this.team]}</b>.` : `Кооператив: ${this.nPlayers} ${this.nPlayers > 1 && this.nPlayers < 5 ? 'игрока' : 'игроков'}. ${this.isHost ? 'Вы — хост (ИИ и задачи считаются у вас).' : 'Хост — создатель комнаты.'}`);
  }

  dispose() {
    for (const u of this.unsub) u();
    if (this.el) for (const e of Object.values(this.el)) e.remove();
    for (const p of this.peers.values()) if (p.tag) p.tag.remove();
  }

  msg(html) { this.feed.unshift({ html, t: performance.now() }); if (this.feed.length > 6) this.feed.pop(); }

  // ---------------------------------------------------------------- ссылки на бойцов
  ref(s) {
    const m = this.m;
    if (!s) return null;
    if (s === m.player.body) return 'p';
    if (s.isRemote) return 'r' + s.peer.id;
    if (s.netIdx !== undefined) return 'a' + s.netIdx;
    return null;
  }
  resolve(ref, from) {
    const m = this.m;
    if (!ref || !m) return null;
    if (ref === 'p') { const p = this.peers.get(from); return p ? p.soldier : null; }
    if (ref[0] === 'r') { const id = ref.slice(1); if (id === this.net.id) return m.player.body; const p = this.peers.get(id); return p ? p.soldier : null; }
    if (ref[0] === 'a') return m.netAI[+ref.slice(1)] || null;
    return null;
  }
  ev(e) { this.out.push(e); }
  evHost(e) { if (this.isHost) this.applyHostEvent(e, this.net.id); else this.hostOut.push(e); }

  // ---------------------------------------------------------------- исходящие: выстрелы, гранаты, урон
  onLocalShot(o, p) {
    const own = o.owner === this.m.player.body;
    if (!own && !(this.isHost && o.owner && o.owner.netIdx !== undefined)) return;
    const gi = o.gun ? this.m.guns.indexOf(o.gun) : -1;
    this.ev(['s', this.ref(o.owner), o.weapon.id, o.ammoId || 0, r2(p.p.x), r2(p.p.y), r2(p.p.z), r2(p.v.x), r2(p.v.y), r2(p.v.z), gi]);
  }
  onLocalGrenade(owner, gr, type) {
    const own = owner === this.m.player.body;
    if (!own && !(this.isHost && owner && owner.netIdx !== undefined)) return;
    this.ev(['g', this.ref(owner), r2(gr.pos.x), r2(gr.pos.y), r2(gr.pos.z), r2(gr.vel.x), r2(gr.vel.y), r2(gr.vel.z), r2(gr.fuse), type]);
  }
  sendPlayerHit(peerId, amount, zone, source, dir, opts) {
    const m = this.m;
    // урон удалённому игроку засчитываем только от своих источников (свой боец, ИИ хоста)
    const src = source;
    const mine = src === m.player.body || (this.isHost && src && src.netIdx !== undefined) || !src;
    if (!mine) return;
    if (!src && !this.isHost) return;
    this.net.send({ t: 'hit', to: peerId, dmg: r2(amount), zone, raw: !!opts.raw, pen: opts.penetrating !== false, dir: dir ? [r3(dir.x), r3(dir.y), r3(dir.z)] : null, by: this.ref(src), late: !m.player.body.alive, w: src && src.weapon ? src.weapon.id : '' });
  }
  aiDamage(s, amount, zone, source, dir, opts = {}) {
    if (!s.alive) return;
    const m = this.m;
    if (source && source !== m.player.body) return; // чужие попадания по ИИ считает их владелец
    this.evHost(['h', s.netIdx, r2(amount), zone, opts.raw ? 1 : 0, opts.penetrating === false ? 0 : 1, dir ? r3(dir.x) : 0, dir ? r3(dir.y) : 0, dir ? r3(dir.z) : 0]);
    if (s.model && s.model.hit) s.model.hit(dir);
  }
  fwdVehicleHit(v, pen, pt, owner, heat, ex) {
    if (owner && owner !== this.m.player.body) return;
    this.evHost(['vh', this.m.vehicles.indexOf(v), r2(pen), r2(pt.x), r2(pt.y), r2(pt.z), heat ? 1 : 0, ex ? { pen: ex.pen, radius: ex.radius, frag: ex.frag, dmg: ex.dmg } : 0]);
  }
  fwdExplosion(pos, ex, owner, directVehicle, directDestructible) {
    if (owner && owner !== this.m.player.body) return;
    const m = this.m;
    this.evHost(['ex', r2(pos.x), r2(pos.y), r2(pos.z), { pen: ex.pen, radius: ex.radius, frag: ex.frag, dmg: ex.dmg }, directVehicle ? m.vehicles.indexOf(directVehicle) : -1, directDestructible ? m.world.destructibles.indexOf(directDestructible) : -1]);
  }
  fwdDestructible(d, amount, owner) {
    if (owner && owner !== this.m.player.body) return;
    this.evHost(['dd', this.m.world.destructibles.indexOf(d), r2(amount)]);
  }
  interactItem(idx) { this.evHost(['i', idx]); }

  // ---------------------------------------------------------------- входящие
  onState(st) {
    let p = this.peers.get(st.id);
    if (!p) { this.addPeer({ id: st.id, name: '?', team: 'negs' }); p = this.peers.get(st.id); }
    p.last = st;
    if (st.w && st.w !== p.weapon && WEAPONS[st.w] && WEAPONS[st.w].sight) p.weapon = st.w;
    const ts = st.ts != null ? st.ts / 1000 : null;
    p.interp.push([st.p[0], st.p[1], st.p[2], st.yaw, st.ay, st.ap, st.v[0], st.v[1]], ts);
    if (st.vs && st.veh >= 0) {
      const vi = this.vehInterp[st.veh] || (this.vehInterp[st.veh] = { src: null, buf: new Interp([3]) });
      if (vi.src !== st.id) { vi.src = st.id; vi.buf.reset(); }
      vi.buf.push(st.vs, ts);
    }
  }

  onWorld(w) {
    if (this.isHost || !this.m) return;
    const m = this.m;
    this.lastWorld = w;
    const wts = w.ts != null ? w.ts / 1000 : null;
    // ИИ
    for (const a of w.ai || []) {
      const i = a[0], s = m.netAI[i];
      if (!s) continue;
      if (a.length < 3) { if (s.alive) { s.die(null); } continue; }
      if (s._deadSent) s._deadSent = 0;
      if ((a[10] & 1) && !s.alive) { s.revive(a[1], a[2], a[3], a[4]); if (this.aiInterp[i]) this.aiInterp[i].reset(); }
      if (!(a[10] & 1)) { if (s.alive) { if (s.vehicle) { s.vehicle.removeOccupant(s); s.vehicle = null; s.hidden = false; } s.pos.set(a[1], a[2], a[3]); s.yaw = a[4]; s.die(null); } continue; }
      const it = this.aiInterp[i] || (this.aiInterp[i] = new Interp([3, 4]));
      it.push([a[1], a[2], a[3], a[4], a[5], a[6], a[8], a[9]], wts);
      s._net = a;
    }
    // техника: прочность и положение (если ею управляет хост)
    for (const v of w.vh || []) {
      const veh = m.vehicles[v[0]];
      if (!veh) continue;
      veh.hp = v[9];
      if (!v[10] && veh.alive) { m.netVisual = true; veh.destroy(null); m.netVisual = false; }
      if (v[11]) {
        const vi = this.vehInterp[v[0]] || (this.vehInterp[v[0]] = { src: null, buf: new Interp([3]) });
        if (vi.src !== 'host') { vi.src = 'host'; vi.buf.reset(); }
        vi.buf.push([v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8], v[12] || 0, v[13] || 0], wts);
      }
    }
    // БПЛА
    if (w.dr) w.dr.forEach((a, i) => { const d = m.drones && m.drones[i]; if (d) d.applyNet(a); });
    // разрушаемые объекты
    if (w.dd) for (let i = 0; i < w.dd.length; i++) {
      const d = m.world.destructibles[i];
      if (d && d.alive && w.dd[i] === '0') { m.netVisual = true; m.onDestructible(d, null); m.netVisual = false; }
    }
    // предметы задач
    if (w.it) for (let i = 0; i < w.it.length; i++) { const it = m.netItems[i]; if (it && !it.done && w.it[i] === '1') it.localTake(); }
    // этапы и задачи
    if (typeof w.st === 'number') {
      let guard = 0;
      while (m.stageIdx < w.st && m.stageIdx < m.stages.length && guard++ < 10) m.nextStage();
      const st = m.stages[m.stageIdx];
      if (st && w.od) { let ch = false; st.objs.forEach((o, k) => { const d = w.od[k] === '1'; if (o.done !== d) { o.done = d; ch = true; } }); if (ch) m.hud.setObjectives(m); }
    }
  }

  onEvents(msg) {
    if (!this.m) return;
    for (const e of msg.list) {
      try {
        if (e[0] === 's') this.applyShot(e, msg.from);
        else if (e[0] === 'g') this.applyGrenade(e, msg.from);
        else if (e[0] === 'gm') { const h = this.m.guns[e[1]]; if (h) h.netOp(e); }
        else if (e[0] === 'mk') this.m.addMark({ team: e[1], x: e[2], z: e[3], label: e[4], kind: e[5], by: e[6], ttl: e[7], fromNet: true });
        else if (this.isHost) this.applyHostEvent(e, msg.from);
      } catch (err) { console.warn('net ev', e, err); }
    }
  }

  applyShot(e, from) {
    const m = this.m;
    const owner = this.resolve(e[1], from);
    const w = WEAPONS[e[2]];
    if (!w) return;
    const pos = new THREE.Vector3(e[4], e[5], e[6]), vel = new THREE.Vector3(e[7], e[8], e[9]);
    if (e[2] === 'd30') {
      const gun = m.guns[e[10]];
      const p = m.projectiles.spawn({ weapon: w, pos, dir: vel.clone().normalize(), owner: owner || m.player.body, team: owner ? owner.team : 'negs', ammoId: e[3] || undefined, visual: true, vel });
      if (gun) gun.remoteFire(p);
      return;
    }
    m.fireProjectile({ weapon: w, pos, dir: vel.clone().normalize(), owner: owner || null, team: owner ? owner.team : 'denter', ammoId: e[3] || undefined, visual: true, vel });
    if (owner) { owner.fireFlash = 0.06; if (owner.model) owner.model.kick = 1; owner.shotsFired++; owner.lastShotTime = m.time; }
  }

  applyGrenade(e, from) {
    const m = this.m;
    const owner = this.resolve(e[1], from);
    m.projectiles.throwGrenade(owner || null, new THREE.Vector3(e[2], e[3], e[4]), new THREE.Vector3(e[5], e[6], e[7]), e[9] || 'f1', { visual: true, fuse: e[8] });
  }

  // события, которые выполняет хост
  applyHostEvent(e, from) {
    const m = this.m;
    const peer = this.peers.get(from);
    const src = from === this.net.id ? m.player.body : peer ? peer.soldier : null;
    switch (e[0]) {
      case 'h': {
        const s = m.netAI[e[1]];
        if (!s || !s.alive) return;
        Soldier.prototype.damage.call(s, e[2], e[3], src, new THREE.Vector3(e[6], e[7], e[8]), { raw: !!e[4], penetrating: !!e[5] });
        if (!s.alive && src && src.kills !== undefined && src.isRemote) src.kills++;
        break;
      }
      case 'vh': {
        const v = m.vehicles[e[1]];
        if (v && v.alive) v.damageHit(e[2], new THREE.Vector3(e[3], e[4], e[5]), src, !!e[6], e[7] || null, true);
        break;
      }
      case 'ex': {
        const pos = new THREE.Vector3(e[1], e[2], e[3]);
        m.projectiles.explode(pos, e[4], src, m.vehicles[e[5]] || null, m.world.destructibles[e[6]] || null, { fx: false, soldiers: false, props: false, world: true, net: true });
        break;
      }
      case 'dd': {
        const d = m.world.destructibles[e[1]];
        if (d && d.alive) { d.hp -= e[2]; if (d.hp <= 0) m.onDestructible(d, src); }
        break;
      }
      case 'i': {
        const it = m.netItems[e[1]];
        if (it && !it.done) it.localTake();
        break;
      }
      case 'dg': {
        const d = m.drones && m.drones[e[1]];
        if (d) d.setCenter(e[2], e[3], e[4] === undefined || e[4] < 0 ? null : !!e[4]);
        break;
      }
      case 'dh': {
        const d = m.drones && m.drones[e[1]];
        if (d && d.alive) d.damage(e[2], src);
        break;
      }
      case 'o': {
        const grp = m.netSquads && m.netSquads.get(from);
        if (grp) m.squadOrder(e[1], e[5] ? new THREE.Vector3(e[2], e[3], e[4]) : null, grp, true);
        break;
      }
    }
  }

  onHit(h) {
    const m = this.m;
    if (!m || !m.player.body.alive) return;
    const source = this.resolve(h.by, h.from);
    const dir = h.dir ? new THREE.Vector3(h.dir[0], h.dir[1], h.dir[2]) : null;
    this._lastHitBy = { id: h.by === 'p' ? h.from : null, w: h.w };
    m.player.body.damage(h.dmg, h.zone, source, dir, { raw: h.raw, penetrating: h.pen });
  }

  onKill(k) {
    for (const [id, kk, dd] of k.stats || []) this.stats.set(id, [kk, dd]);
    if (k.score) this.score = k.score;
    const team = (id) => (id === this.net.id ? this.team : (this.peers.get(id) || {}).team);
    const col = (id) => ((id ? team(id) : k.vteam) === 'denter' ? '#e08a6a' : '#8fc0e8');
    const wn = k.w && WEAPONS[k.w] ? WEAPONS[k.w].name : '';
    if (k.killer && k.killer !== k.victim) this.msg(`<b style="color:${col(k.killer)}">${esc(k.kname)}</b> ✕ <b style="color:${col(k.victim)}">${esc(k.vname)}</b>${wn ? ` <span class="w">${esc(wn)}</span>` : ''}`);
    else this.msg(`<b style="color:${col(k.victim)}">${esc(k.vname)}</b> погиб`);
  }

  onEnd(e) {
    if (this.ended || !this.m) return;
    this.ended = true;
    this.endInfo = e;
    this.m.netEnd(!!e.ok, e.reason || '', false);
  }

  // ---------------------------------------------------------------- смерть и возрождение своего бойца
  onLocalDeath(src) {
    const m = this.m;
    const by = src && src.isRemote ? src.peer.id : (this._lastHitBy && this._lastHitBy.id) || null;
    const w = src && src.weapon ? src.weapon.id : (this._lastHitBy && this._lastHitBy.w) || '';
    this.net.send({ t: 'died', by, w });
    this.respawnAt = m.time + (this.pvp ? 5 : 20);
    this.deathBy = src && src.isRemote ? src.peer.name : src && src.netIdx !== undefined ? 'противник' : '';
    m.hud.message('Вы погибли', 3, true);
  }

  respawn() {
    const m = this.m;
    const sp = this.spawnPoint(m.def);
    m.player.respawn(sp.x, sp.z, sp.yaw);
    if (this.isHost) m.reviveSquad(this.net.id, m.player.body.pos, sp.yaw);
    this.respawnAt = 0;
    this._lastHitBy = null;
    m.hud.message(this.pvp ? 'В бой!' : 'Вы снова в строю', 2);
  }

  // ---------------------------------------------------------------- кадр
  preUpdate(dt) {
    const m = this.m;
    if (!m) return;
    const tmp = [];
    // удалённые игроки
    for (const p of this.peers.values()) {
      const st = p.last;
      if (!st) continue;
      if (!p.soldier && st.alive) {
        p.soldier = new RemoteSoldier(m, p, st.p[0], st.p[1], st.p[2]);
        m.soldiers.push(p.soldier);
      }
      const s = p.soldier;
      if (!s) continue;
      if (!st.alive && s.alive) s.netDie();
      else if (st.alive && !s.alive) { if (this.isHost) m.reviveSquad(p.id, new THREE.Vector3(st.p[0], st.p[1], st.p[2]), st.yaw); this.dropSoldier(p); p.interp.reset(); p.interp.push([st.p[0], st.p[1], st.p[2], st.yaw, st.ay, st.ap, 0, 0]); p.soldier = new RemoteSoldier(m, p, st.p[0], st.p[1], st.p[2]); m.soldiers.push(p.soldier); continue; }
      const v = p.interp.sample(tmp);
      if (v && s.alive) {
        s.pos.set(v[0], v[1], v[2]);
        s.yaw = v[3]; s.aimYaw = v[4]; s.aimPitch = v[5]; s.vel.set(v[6], 0, v[7]);
        s.stance = STANCES[st.s] || 'stand';
        s.netAiming = !!st.aim;
        if (st.rl && !(s.reloadT > 0)) { s.reloadT = s.reloadTotal = 2.5; } else if (!st.rl) s.reloadT = 0;
        s.health = st.hp;
      }
      this.applySeat(s, st.veh, st.seat);
      // турель у стрелка-игрока
      if (st.tg && st.veh >= 0) { const veh = m.vehicles[st.veh]; if (veh) { veh.turretYaw = st.tg[0]; veh.gunPitch = st.tg[1]; veh.netTurret = true; } }
    }
    // Д-30: кто за орудием
    m.guns.forEach((h, gi) => {
      let user = null;
      for (const p of this.peers.values()) if (p.last && p.last.alive && p.last.gun === gi) user = p;
      h.netUser = user ? user.id : null;
      if (user && user.last.gs) { h.az = user.last.gs[0]; h.elM = user.last.gs[1]; }
    });
    // техника: кто считает движение
    m.vehicles.forEach((veh, i) => {
      let driver = null;
      for (const p of this.peers.values()) if (p.last && p.last.alive && p.last.veh === i && p.last.seat === 0) driver = p;
      const localDriver = m.player.vehicle === veh && m.player.seat === 0;
      const vi = this.vehInterp[i];
      if (localDriver || (!driver && this.isHost)) { veh.netPuppet = null; }
      else if (vi && ((driver && vi.src === driver.id) || (!driver && vi.src === 'host'))) veh.netPuppet = vi.buf;
      else veh.netPuppet = veh.netPuppet || (vi ? vi.buf : null);
      veh.netLocalGunner = m.player.vehicle === veh && m.player.seat === 1;
    });
    // ИИ на клиентах
    if (!this.isHost) {
      for (let i = 0; i < m.netAI.length; i++) {
        const s = m.netAI[i], it = this.aiInterp[i], a = s._net;
        if (!it || !a || !s.alive) continue;
        const v = it.sample(tmp);
        if (!v) continue;
        if (!s.vehicle) s.pos.set(v[0], v[1], v[2]);
        s.yaw = v[3]; s.aimYaw = v[4]; s.aimPitch = v[5]; s.vel.set(v[6], 0, v[7]);
        s.stance = STANCES[a[7]] || 'stand';
        s.netAiming = !!(a[10] & 2);
        if (a[10] & 4) { if (!(s.reloadT > 0)) s.reloadT = s.reloadTotal = 2.5; } else s.reloadT = 0;
        this.applySeat(s, a[11], a[12]);
      }
    }
    // своё возрождение
    if (!m.player.body.alive && this.respawnAt && m.time >= this.respawnAt && !m.finished) this.respawn();
  }

  applySeat(s, vi, seat) {
    const m = this.m;
    const want = vi >= 0 ? m.vehicles[vi] : null;
    if (s.vehicle && (s.vehicle !== want || s.seat !== seat)) { s.vehicle.removeOccupant(s); s.vehicle = null; s.hidden = false; }
    if (want && want.alive && !s.vehicle && s.alive) {
      const cur = want.seats[seat];
      if (cur && cur !== s) { if (cur === m.player.body) return; cur.vehicle = null; cur.hidden = false; }
      want.seats[seat] = s; s.vehicle = want; s.seat = seat;
      s.hidden = !(seat === 1 && want.type.gunExposed);
    }
  }

  postUpdate(dt) {
    const m = this.m;
    if (!m) return;
    this.stT += dt; this.wsT += dt;
    if (this.stT >= 1 / 30) { this.stT = 0; this.sendState(); }
    if (this.isHost && this.wsT >= 1 / 15) { this.wsT = 0; this.sendWorld(); }
    if (this.out.length) { this.net.send({ t: 'ev', list: this.out }); this.out = []; }
    if (this.hostOut.length) { this.net.send({ t: 'ev', to: 'host', list: this.hostOut }); this.hostOut = []; }
    // кооператив: вся группа погибла — задание провалено
    if (this.isHost && !this.pvp && !m.finished) {
      let any = m.player.body.alive;
      for (const p of this.peers.values()) if (p.last && p.last.alive) any = true;
      this.allDeadT = any ? 0 : this.allDeadT + dt;
      if (this.allDeadT > 1.5) m.fail('Группа погибла');
    }
    this.updateHud(dt);
  }

  sendState() {
    const m = this.m, p = m.player, b = p.body;
    const aw = p.activeWeapon, ws = p.state;
    const st = {
      t: 'st', ts: Math.round(performance.now()), p: [r2(b.pos.x), r2(b.pos.y), r2(b.pos.z)], v: [r2(b.vel.x), r2(b.vel.z)],
      yaw: r3(p.yaw), ay: r3(p.yaw), ap: r3(p.pitch), s: Math.max(0, STANCES.indexOf(b.stance)),
      w: aw ? aw.def.id : ws ? ws.id : '', aim: p.aimT > 0.5 ? 1 : 0, rl: p.reloadT > 0 ? 1 : 0,
      hp: Math.max(0, Math.round(b.health)), alive: b.alive ? 1 : 0,
      veh: p.vehicle ? m.vehicles.indexOf(p.vehicle) : -1, seat: p.vehicle ? p.seat : -1,
      gun: p.gun ? m.guns.indexOf(p.gun) : -1,
    };
    if (p.vehicle && p.seat === 0) { const v = p.vehicle; st.vs = [r2(v.pos.x), r2(v.pos.y), r2(v.pos.z), r3(v.yaw), r2(v.speed), r3(v.steer), r3(v.turretYaw), r3(v.gunPitch), r3(v.pitch), r3(v.roll)]; }
    if (p.vehicle && p.seat === 1) st.tg = [r3(p.vehicle.turretYaw), r3(p.vehicle.gunPitch)];
    if (p.gun) st.gs = [r2(p.gun.az), r2(p.gun.elM)];
    this.net.send(st);
  }

  sendWorld() {
    const m = this.m;
    const ai = [];
    for (let i = 0; i < m.netAI.length; i++) {
      const s = m.netAI[i];
      if (!s.alive) { s._deadSent = (s._deadSent || 0) + 1; if (s._deadSent > 3) { if (s._deadSent % 20 === 0) ai.push([i]); continue; } }
      const fl = (s.alive ? 1 : 0) | (s.brain && s.brain.aiming ? 2 : 0) | (s.reloadT > 0 ? 4 : 0) | (s.hidden ? 8 : 0);
      ai.push([i, r2(s.pos.x), r2(s.pos.y), r2(s.pos.z), r3(s.yaw), r3(s.aimYaw), r3(s.aimPitch), Math.max(0, STANCES.indexOf(s.stance)), r2(s.vel.x), r2(s.vel.z), fl, s.vehicle ? m.vehicles.indexOf(s.vehicle) : -1, s.vehicle ? s.seat : -1]);
    }
    const vh = m.vehicles.map((v, i) => [i, r2(v.pos.x), r2(v.pos.y), r2(v.pos.z), r3(v.yaw), r2(v.speed), r3(v.steer), r3(v.turretYaw), r3(v.gunPitch), Math.round(v.hp), v.alive ? 1 : 0, v.netPuppet ? 0 : 1, r3(v.pitch), r3(v.roll)]);
    const st = m.stages[m.stageIdx];
    this.net.send({
      t: 'ws', ts: Math.round(performance.now()), st: m.stageIdx, od: st ? st.objs.map((o) => (o.done ? '1' : '0')).join('') : '',
      ai, vh, dd: m.world.destructibles.map((d) => (d.alive === false ? '0' : '1')).join(''), it: m.netItems.map((it) => (it.done ? '1' : '0')).join(''),
      dr: (m.drones || []).map((d) => d.netState()),
    });
  }

  // ---------------------------------------------------------------- интерфейс
  updateHud(dt) {
    const m = this.m, el = this.el;
    if (!el) return;
    const now = performance.now();
    // лента событий
    const fh = this.feed.filter((f) => now - f.t < 9000).map((f) => `<div>${f.html}</div>`).join('');
    if (fh !== this._fh) { el.feed.innerHTML = fh; this._fh = fh; }
    // счёт PvP
    if (this.pvp) {
      const tl = this.timeLeft != null ? `${Math.floor(this.timeLeft / 60)}:${String(this.timeLeft % 60).padStart(2, '0')}` : '';
      const th = `<span class="tn">${TEAM_NAMES.negs}</span> <b>${this.score.negs}</b> : <b>${this.score.denter}</b> <span class="td">${TEAM_NAMES.denter}</span>${tl ? ` · ${tl}` : ''} · до ${this.room.scoreLimit}`;
      if (th !== this._th) { el.top.innerHTML = th; this._th = th; }
    } else {
      const th = `Кооператив · ${this.isHost ? 'хост' : 'клиент'}`;
      if (th !== this._th) { el.top.innerHTML = th; this._th = th; }
    }
    // пинг до сервера (раз в 2 с)
    const pg = `пинг ${Math.round(this.net.rtt || 0)} мс`;
    if (pg !== this._pg) { el.ping.textContent = pg; el.ping.className = 'netping' + (this.net.rtt > 120 ? ' bad' : this.net.rtt > 60 ? ' mid' : ''); this._pg = pg; }
    // экран гибели
    if (!m.player.body.alive && this.respawnAt) {
      const left = Math.max(0, this.respawnAt - m.time);
      el.dead.style.display = 'block';
      el.dead.innerHTML = `<b>Вы погибли</b>${this.deathBy ? ` · ${esc(this.deathBy)}` : ''}<br>${this.pvp ? 'Возрождение' : 'Возвращение в строй у точки высадки'} через ${left.toFixed(0)} с`;
    } else el.dead.style.display = 'none';
    // таблица (Tab)
    if (m.input.bd('squad')) {
      const rows = [[this.net.id, this.me.name, this.team, m.player.body.alive, Math.round(this.net.rtt) || this.myPing]].concat([...this.peers.values()].map((p) => [p.id, p.name, p.team, p.last ? !!p.last.alive : false, p.ping]));
      const teams = this.pvp ? ['negs', 'denter'] : ['negs'];
      let h = '';
      for (const t of teams) {
        h += `<div class="ot">${this.pvp ? `${TEAM_NAMES[t]} — ${this.score[t]}` : 'ГРУППА'}</div><table><tr><th>Боец</th><th>Убито</th><th>Гибель</th><th>Пинг</th></tr>`;
        for (const r of rows.filter((x) => x[2] === t)) { const s = this.stats.get(r[0]) || [0, 0]; h += `<tr class="${r[3] ? '' : 'dead'} ${r[0] === this.net.id ? 'me' : ''}"><td>${esc(r[1])}</td><td>${s[0]}</td><td>${s[1]}</td><td>${r[4] || '—'}</td></tr>`; }
        h += '</table>';
      }
      el.board.innerHTML = h; el.board.style.display = 'block';
    } else el.board.style.display = 'none';
    // таблички над своими
    const cam = m.camera, W = innerWidth, H = innerHeight, v = new THREE.Vector3();
    for (const p of this.peers.values()) {
      const s = p.soldier;
      const show = s && s.alive && !s.hidden && (!this.pvp || p.team === this.team);
      if (!p.tag) { p.tag = document.createElement('div'); p.tag.className = 'nettag'; el.tags.appendChild(p.tag); }
      if (!show) { p.tag.style.display = 'none'; continue; }
      v.set(s.pos.x, s.pos.y + 2.05, s.pos.z);
      const d = v.distanceTo(cam.position);
      v.project(cam);
      if (v.z > 1 || d > 400) { p.tag.style.display = 'none'; continue; }
      p.tag.style.display = 'block';
      p.tag.style.transform = `translate(${((v.x + 1) / 2 * W).toFixed(0)}px, ${((1 - v.y) / 2 * H).toFixed(0)}px) translate(-50%, -100%)`;
      const txt = `${esc(p.name)}${d > 40 ? ` · ${d.toFixed(0)} м` : ''}`;
      if (p.tag._t !== txt) { p.tag.innerHTML = txt; p.tag._t = txt; }
    }
  }
}
