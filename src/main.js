// N.E.G.S: Заполярье — точка входа: рендерер, режимы (меню / штаб / задание), цикл
import * as THREE from 'three';
import { Input } from './core/input.js';
import { AudioSys } from './core/audio.js';
import { loadSave, writeSave, resetSave } from './core/save.js';
import { HUD } from './ui/hud.js';
import { UI } from './ui/menus.js';
import { HQ } from './hq/hq.js';
import { Mission } from './mission/mission.js';
import { missionById, MISSIONS } from './data/missions.js';
import { Terrain } from './world/terrain.js';
import { makeLighting } from './world/sky.js';
import { Snowfall } from './world/weather.js';
import { PostFX } from './fx/post.js';
import { preload, hasAssets } from './core/assets.js';
import { NetClient } from './net/net.js';
import { NetSession } from './net/session.js';
import { WEAPONS } from './data/weapons.js';

class MenuScene {
  constructor(app) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.5, 4000);
    const t = new Terrain({ seed: 3, amp: 40, seg: 160, features: [{ type: 'lake', x: 0, z: -200, r: 160, fall: 40 }] });
    this.terrain = t;
    this.scene.add(t.buildMesh());
    this.l = makeLighting(this.scene, { time: 'night', aurora: 1.2, fog: 0.0011 });
    this.snow = new Snowfall(2500, 0.2, new THREE.Vector3(1, 0, 0.3));
    this.scene.add(this.snow.points);
    this.t = 0;
  }
  update(dt) {
    this.t += dt;
    const a = this.t * 0.02;
    const x = Math.sin(a) * 300, z = Math.cos(a) * 300 + 100;
    this.camera.position.set(x, this.terrain.heightAt(x, z) + 25, z);
    this.camera.lookAt(0, 30, -300);
    this.l.sky.update(dt, this.camera.position);
    this.snow.update(dt, this.camera.position);
  }
  render(r) {
    r.autoClear = true;
    r.toneMappingExposure = 1.6;
    r.shadowMap.autoUpdate = true;
    if (this.camera.aspect !== innerWidth / innerHeight) { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }
    r.render(this.scene, this.camera);
  }
}

class App {
  constructor() {
    const canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.save = loadSave();
    this.settings = this.save.settings;
    this.input = new Input(canvas);
    this.input.binds = { ...this.input.binds, ...(this.settings.binds || {}) };
    this.audio = new AudioSys();
    this.audio.setVolume(this.settings.volume);
    this.post = new PostFX(this.renderer);
    this.applyQuality();
    this.hud = new HUD(document.getElementById('hud'));
    this.hud.hide();
    this.ui = new UI(this, document.getElementById('ui'));
    this.mode = 'menu';
    this.menuScene = new MenuScene(this);
    this.hq = null;
    this.mission = null;
    this.paused = false;
    this.last = performance.now();
    this.fps = 60;
    addEventListener('resize', () => { this.renderer.setSize(innerWidth, innerHeight); this.post.resize(); });
    // первый жест — запуск звука
    const unlock = () => { this.audio.init(); };
    addEventListener('pointerdown', unlock); addEventListener('keydown', unlock);
    canvas.addEventListener('click', () => {
      if ((this.mode === 'hq' || this.mode === 'mission') && !this.ui.isOpen() && !this.paused) { this.input.requestLock(); this.ui.hqPrompt(null); }
    });
    this.input.onLockChange = (locked) => {
      if (!locked && this.mode === 'mission' && !this.ui.isOpen() && this.mission && !this.mission.finished) this.pause();
      if (!locked && this.mode === 'hq' && !this.ui.isOpen()) this.ui.clickToPlay('Нажмите на экран, чтобы продолжить');
    };
    addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.mode === 'mission' && !this.ui.isOpen() && this.mission && !this.mission.finished) { this.input.releaseLock(); this.pause(); }
      else if (e.code === 'Escape' && this.mode === 'hq' && !this.ui.isOpen()) { this.input.releaseLock(); this.ui.clickToPlay('Нажмите на экран, чтобы продолжить'); }
      else if (e.code === 'Escape' && this.ui.isOpen() && this.mode !== 'menu' && this.mode !== 'loading' && !this.paused) this.ui.close();
    });
    window.__game = this;
    this.ready = false;
    if (hasAssets()) {
      this.ui.loading('Загрузка ресурсов');
      preload((f) => { const b = document.querySelector('.loadbar i'); if (b) { b.style.animation = 'none'; b.style.width = (f * 100).toFixed(0) + '%'; } })
        .then(() => { this.ready = true; this.ui.mainMenu(); });
    } else { this.ready = true; this.ui.mainMenu(); }
    requestAnimationFrame((t) => this.loop(t));
  }

  persist() { writeSave(this.save); this.applyQuality(); }

  // Качество графики: разрешение рендера, сглаживание, мягкость теней, фоновое затенение
  applyQuality() {
    const q = this.settings.quality || 'medium';
    if (q === this._q) return;
    this._q = q;
    const pr = q === 'low' ? Math.min(devicePixelRatio, 0.85) : q === 'medium' ? Math.min(devicePixelRatio, 1) : Math.min(devicePixelRatio, 1.5);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.type = q === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.renderer.shadowMap.needsUpdate = true;
    if (this.post) this.post.setQuality(q);
  }

  newCampaign() {
    const st = this.settings;
    this.save = resetSave();
    this.save.settings = st; this.settings = st;
    this.save.started = true;
    this.persist();
  }

  toHQ() {
    this.disposeMission();
    this.hud.hide();
    if (!this.hq) {
      this.ui.loading('Штаб «Полярный Лис»');
      setTimeout(() => {
        this.hq = new HQ(this);
        this.hq.build(this.save.completed);
        this.ui.close();
        this._enterHQ();
      }, 60);
      return;
    }
    this._enterHQ();
  }
  _enterHQ() {
    this.save.started = true; this.persist();
    this.mode = 'hq';
    this.hq.enter();
    this.ui.clickToPlay('Нажмите на экран · WASD — ходить, мышь — осмотр, E — взаимодействие');
  }

  startMission(id) {
    const def = missionById(id);
    this.disposeMission();
    this.ui.loading(def.title);
    this.mode = 'loading';
    setTimeout(() => {
      try {
        const squad = def.noSquad ? [] : this.save.squad.filter((x) => !(this.save.hospital[x] > 0));
        const m = new Mission(this, def, { squad, primary: this.save.primary, launcher: this.save.launcher, vehicles: this.save.vehicles, howitzer: !!this.save.howitzer });
        this.hud.reset();
        m.build();
        this.mission = m;
        this.ui.close();
        this.hud.show();
        this.mode = 'mission';
        this.paused = false;
        this.ui.clickToPlay(`<b>${def.title}</b>: нажмите на экран, чтобы начать<br><span style="font-size:12px;color:#9aa8b2">ЛКМ — огонь · ПКМ — прицел (целик/мушка, оптика) · колесо при прицеливании — установка прицела · Shift — задержать дыхание · F/H/T/V — приказы · Tab — отделение · M — карта · Esc — меню</span>`);
        this.hud.message(def.code, 4, true);
      } catch (e) {
        console.error(e);
        this.ui.show(`<h1>Ошибка загрузки</h1><pre>${e.stack || e}</pre><button class="btn" data-close>OK</button>`, { onClose: () => this.toHQ() });
      }
    }, 60);
  }

  pause() {
    if (!this.mission) return;
    this.paused = true;
    this.ui.pause(this.mission);
  }
  resume() {
    this.paused = false;
    this.ui.clickToPlay('Нажмите на экран, чтобы продолжить');
  }

  abortMission() { this.toHQ(); }

  // ================================================================ сетевая игра
  async netConnect(addr, name) {
    if (!this.net) {
      this.net = new NetClient();
      this.net.on('start', (m) => this.startNetMission(m));
    }
    await this.net.connect(addr, name);
  }

  startNetMission(start) {
    const room = start.room;
    const def = missionById(room.mission);
    if (!def) return;
    this.disposeMission();
    this.hq = null;
    this.ui._netClear && this.ui._netClear();
    this.ui.loading(`${def.title} — ${room.mode === 'pvp' ? 'противостояние' : 'кооператив'}`);
    this.mode = 'loading';
    setTimeout(() => {
      try {
        const session = new NetSession(this, this.net, start);
        const pvp = room.mode === 'pvp';
        const me = room.players.find((p) => p.id === this.net.id) || {};
        const primary = pvp ? (WEAPONS[me.weapon] ? me.weapon : 'ak74m') : this.save.primary;
        const n = room.players.length;
        const m = new Mission(this, def, { squad: [], primary, launcher: pvp ? false : this.save.launcher, vehicles: pvp ? [] : n > 2 ? ['tigr', 'niva'] : ['tigr'], howitzer: room.howitzer !== false, net: session });
        this.hud.reset();
        m.build();
        this.mission = m;
        this.ui.close();
        this.hud.show();
        this.mode = 'mission';
        this.paused = false;
        this.ui.clickToPlay(`<b>${def.title}</b> · ${pvp ? 'противостояние' : 'кооператив'}: нажмите на экран<br><span style="font-size:12px;color:#9aa8b2">Tab — таблица игроков · Esc — меню (игра не останавливается)</span>`);
        this.hud.message(pvp ? 'Противостояние' : def.code, 4, true);
      } catch (e) {
        console.error(e);
        this.mode = 'menu';
        this.ui.show(`<h1>Ошибка загрузки</h1><pre>${e.stack || e}</pre><button class="btn" data-close>OK</button>`, { onClose: () => { this.net.send({ t: 'leave' }); this.ui.netLobby(); } });
      }
    }, 60);
  }

  endNetMission(ok, reason, m, lost) {
    if (this.mission !== m) return;
    m.netStopped = true;
    this.input.releaseLock();
    this.paused = true;
    this.ui.netDebrief(ok, reason, m, lost);
  }

  leaveNetMatch() {
    if (this.net) { this.net.send({ t: 'leave' }); this.net.room = null; }
    this.backToRoom(true);
  }

  backToRoom(lobby = false, menu = false) {
    this.disposeMission();
    this.hud.hide();
    this.mode = 'menu';
    this.paused = false;
    if (menu || !this.net || !this.net.connected) this.ui.netMenu(menu ? 'Соединение с сервером потеряно' : '');
    else if (lobby || !this.net.room) this.ui.netLobby();
    else this.ui.netRoom();
  }

  endMission(ok, reason, m) {
    if (this.mission !== m) return;
    // госпиталь и опыт
    const s = this.save;
    for (const id of Object.keys(s.hospital)) if (s.hospital[id] > 0) s.hospital[id]--;
    for (const id of m.stats.lost) s.hospital[id] = 1;
    if (ok && !m.def.training) {
      s.completed[m.def.id] = true;
      for (const id of m.setup.squad) if (!m.stats.lost.includes(id)) s.xp[id] = (s.xp[id] || 0) + 1;
    }
    this.persist();
    if (this.hq) { this.hq = null; } // пересобрать карту операций
    this.input.releaseLock();
    this.paused = true;
    this.ui.debrief(ok, reason, m);
  }

  disposeMission() {
    if (this.mission) { this.mission.dispose(); this.mission = null; }
    this.renderer.domElement.style.filter = '';
    this.paused = false;
  }

  loop(t) {
    requestAnimationFrame((tt) => this.loop(tt));
    let dt = (t - this.last) / 1000;
    this.last = t;
    if (dt > 0.1) dt = 0.1;
    this.fps = this.fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
    if (this.mode === 'menu' || this.mode === 'loading') {
      this.menuScene.update(dt);
      this.menuScene.render(this.renderer);
    } else if (this.mode === 'hq' && this.hq) {
      if (this.input.active) this.ui.hqPrompt(this.hq.current ? this.hq.current.label : null);
      if (this.input.active || this.ui.isOpen()) this.hq.update(dt);
      this.hq.render();
    } else if (this.mode === 'mission' && this.mission) {
      const mp = !!this.mission.net;
      if (mp ? !this.mission.netStopped : (!this.paused && this.input.active)) this.mission.update(dt);
      else if (!this.paused && !this.mission.started) { this.mission.updateCamera(0); }
      if (this.input.active) this.mission.started = true;
      this.mission.render();
    }
    this.input.endFrame();
  }
}

window.addEventListener('DOMContentLoaded', () => new App());
