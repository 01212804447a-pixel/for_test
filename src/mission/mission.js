// Рантайм миссии: мир, бойцы, техника, снаряды, камера, прицелы, задачи и скрипты
import * as THREE from 'three';
import { Terrain } from '../world/terrain.js';
import { World } from '../world/world.js';
import { makeLighting } from '../world/sky.js';
import { Snowfall } from '../world/weather.js';
import * as ST from '../world/structures.js';
import { Effects } from '../fx/effects.js';
import * as POI from '../world/poi.js';
import { scatterGround, GroundCover } from '../world/flora.js';
import { Props } from '../world/props.js';
import { hdr as hdrAsset, texture as texAsset, hasAssets } from '../core/assets.js';
import { Soldier, solverFor } from '../entities/soldier.js';
import { Player, makeState } from '../entities/player.js';
import { Vehicle, VEHICLE_TYPES } from '../entities/vehicle.js';
import { Projectiles } from '../entities/projectiles.js';
import { Brain, Group } from '../ai/brain.js';
import { ViewModel } from '../weapons/viewmodel.js';
import { drawScope } from '../weapons/reticles.js';
import { makeEnv } from '../physics/ballistics.js';
import { ZERO_ENV } from '../physics/firingTable.js';
import { WEAPONS, SCOPES, PRIMARY_CHOICES } from '../data/weapons.js';
import { ROSTER, toSkill } from '../data/squad.js';
import { mulberry32, clamp, lerp, rand, randn, MIL, wrapAngle } from '../core/math.js';

const QUALITY = { low: { seg: 256, shadow: 1024, snow: 0.5 }, medium: { seg: 384, shadow: 2048, snow: 1 }, high: { seg: 480, shadow: 4096, snow: 1.4 } };

export class Mission {
  constructor(app, def, setup) {
    this.app = app; this.def = def; this.setup = setup;
    this.renderer = app.renderer; this.audio = app.audio; this.input = app.input; this.settings = app.settings; this.hud = app.hud;
    this.time = 0;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.1, 4200);
    this.lookCam = new THREE.PerspectiveCamera(this.settings.fov, 1, 0.1, 10);
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.01, 10);
    this.viewmodel = new ViewModel(this.vmScene);
    this.soldiers = []; this.vehicles = []; this.groups = []; this.noises = [];
    this.stages = []; this.stageIdx = -1; this.updaters = []; this.timers = []; this.interactables = [];
    this.flags = [];
    this.stats = { shots: 0, hits: 0, kills: 0, time: 0, lost: [] };
    this.camPos = this.camera.position;
    this.finished = false; this.failed = null;
    this._targetsCache = new Map(); this._targetsFrame = -1; this.frame = 0;
    this.shoutT = new Map();
    this.mapVisible = false;
  }

  // ===================== загрузка =====================
  build() {
    const def = this.def, e = def.env;
    const q = QUALITY[this.settings.quality] || QUALITY.medium;
    // окружающая среда
    const az = ((e.windFrom + 180) * Math.PI) / 180;
    this.wind = new THREE.Vector3(Math.sin(az) * e.wind, 0, -Math.cos(az) * e.wind);
    this.env = makeEnv({ tempC: e.tempC, pressureHPa: 1000, wind: { x: this.wind.x, y: 0, z: this.wind.z }, latitudeDeg: 69 });
    this.zeroEnv = ZERO_ENV;
    this.visibility = e.visibility;
    this.isNight = e.time === 'night';
    // ландшафт
    this.terrain = new Terrain({ seed: def.terrain.seed, amp: def.terrain.amp, features: def.terrain.features.map((f) => ({ ...f })), seg: q.seg });
    this.scene.add(this.terrain.buildMesh());
    const sea = this.terrain.buildSea();
    if (sea) this.scene.add(sea);
    this.lights = makeLighting(this.scene, { time: e.time, sunElev: e.sunElev, sunAz: e.sunAz, overcast: e.overcast, aurora: e.aurora, fog: e.fog });
    this.lights.sun.shadow.mapSize.set(q.shadow, q.shadow);
    this.renderer.toneMappingExposure = e.time === 'night' ? 1.5 : e.time === 'dusk' ? 1.15 : 1.08;
    // окружение для отражений (IBL) по цветам неба
    {
      const u = this.lights.sky.uniforms;
      const c = document.createElement('canvas'); c.width = 256; c.height = 128;
      const g2 = c.getContext('2d');
      const css = (col, k = 1) => `rgb(${Math.min(255, col.r * 255 * k) | 0},${Math.min(255, col.g * 255 * k) | 0},${Math.min(255, col.b * 255 * k) | 0})`;
      const gr = g2.createLinearGradient(0, 0, 0, 128);
      gr.addColorStop(0, css(u.uZenith.value, 1.2)); gr.addColorStop(0.48, css(u.uHorizon.value, 1.1));
      gr.addColorStop(0.52, css(u.uGround.value, 1.0)); gr.addColorStop(1, css(u.uGround.value, 0.8));
      g2.fillStyle = gr; g2.fillRect(0, 0, 256, 128);
      const et = new THREE.CanvasTexture(c); et.mapping = THREE.EquirectangularReflectionMapping; et.colorSpace = THREE.SRGBColorSpace;
      const pm = new THREE.PMREMGenerator(this.renderer);
      const hd = hdrAsset(e.time === 'night' ? 'rogland_moonlit_night' : e.time === 'dusk' ? 'winter_evening' : 'snowy_field');
      if (hd) hd.mapping = THREE.EquirectangularReflectionMapping;
      this.envMap = pm.fromEquirectangular(hd || et).texture;
      pm.dispose(); et.dispose();
      this.scene.environment = this.envMap;
      this.scene.environmentIntensity = hd ? (e.time === 'night' ? 0.6 : e.time === 'dusk' ? 0.7 : 0.5) : (e.time === 'night' ? 0.35 : 0.55);
      this.vmScene.environment = this.envMap;
      this.vmScene.environmentIntensity = e.time === 'night' ? 0.6 : 1.15;
      this.lights.hemi.intensity *= 0.6;
    }
    // освещение оружия от первого лица
    this.vmSun = new THREE.DirectionalLight(this.lights.sun.color, this.lights.sun.intensity * 0.9);
    this.vmScene.add(this.vmSun, new THREE.HemisphereLight(this.lights.hemi.color, this.lights.hemi.groundColor, this.lights.hemi.intensity));
    this.vmFlash = new THREE.PointLight(0xffb060, 0, 3, 2);
    this.vmScene.add(this.vmFlash);
    // мягкий заполняющий свет для оружия и рук (чтобы детали читались против солнца)
    const fill = new THREE.DirectionalLight(e.time === 'night' ? 0x8090b0 : 0xe8eef6, e.time === 'night' ? 0.35 : 0.9);
    fill.position.set(-0.6, 0.8, 0.5);
    this.vmScene.add(fill);
    this.world = new World(this.scene, this.terrain);
    this.mats = ST.makeMats();
    this.fx = new Effects(this.scene);
    this.fx.wind.copy(this.wind);
    this.fx.light = e.time === 'night' ? 0.3 : e.time === 'dusk' ? 0.65 : 1;
    this.projectiles = new Projectiles(this);
    if (e.snow > 0) {
      this.snow = new Snowfall(Math.floor((1500 + e.snow * 7000) * q.snow), e.snow, this.wind);
      if (this.isNight) this.snow.uniforms.uColor.value.setRGB(0.6, 0.65, 0.75);
      this.scene.add(this.snow.points);
    }
    // игрок
    const st = def.start;
    this.player = new Player(this, { primary: this.setup.primary || 'ak74m', launcher: !!this.setup.launcher, x: st.x, z: st.z, yaw: st.yaw });
    this.soldiers.push(this.player.body);
    // скрипт миссии
    const ctx = this.makeCtx();
    def.build(ctx);
    // вешки вдоль дорог, таблички
    for (const f of def.terrain.features) if (f.type === 'road') POI.roadPoles(this.world, this.mats, { pts: f.pts });
    for (const sg of this.world.signs) ST.sign(this.world, this.mats, sg);
    // техника на старте
    const vlist = def.vehicles || (this.setup.vehicles || []).map((t, i) => ({ type: t, x: st.x + 9 + i * 8 * Math.cos(st.yaw), z: st.z + 8 + i * 8 * Math.sin(st.yaw), yaw: st.yaw }));
    for (const v of vlist) this.addVehicle(v.type, { x: v.x, z: v.z, yaw: v.yaw, team: 'negs' });
    // отделение
    if (!def.noSquad) {
      const ids = this.setup.squad || [];
      ids.forEach((id, i) => {
        const r = ROSTER.find((x) => x.id === id);
        if (!r) return;
        const off = [[-2, 3], [2, 3], [-4, 6], [4, 6], [-6, 9], [6, 9]][i];
        const c = Math.cos(st.yaw), s = Math.sin(st.yaw);
        const s0 = new Soldier(this, { team: 'negs', name: r.name, callsign: r.callsign, role: r.role, weapon: r.weapon, secondary: r.secondary, skill: toSkill(r.stats), x: st.x + c * off[0] + s * off[1], z: st.z - s * off[0] + c * off[1], yaw: st.yaw, armor: 0.8, helmet: 0.6, grenades: 2 });
        s0.rosterId = id;
        const b = new Brain(s0, this, { mode: 'squad', slot: i });
        this.soldiers.push(s0);
        this.squadGroup = this.squadGroup || this.addGroup(new Group(this, 'negs', 'squad'));
        this.squadGroup.add(s0);
      });
    }
    this.world.finalize({ navCenter: def.navCenter || { x: 0, z: 0 }, navSize: def.navSize || 800 });
    const qk = this.settings.quality === 'low' ? 0.5 : this.settings.quality === 'high' ? 1.4 : 1;
    scatterGround(this.scene, this.terrain, this.world, { seed: def.terrain.seed, wind: this.wind, grass: Math.floor(9000 * qk), shrubs: Math.floor(3000 * qk), stones: Math.floor(1500 * qk), drifts: Math.floor(500 * qk), radius: 950, avoid: [{ x: def.start.x, z: def.start.z, r: 12 }, ...(def.clearZones || [])] });
    for (const sp of this.world.smokes) this.fx.addSmoke(sp, 1);
    this.props = new Props(this);
    for (const r of this.world.propRequests) this.props.spawn(r.type, r.x, r.z, { yaw: r.yaw, y: r.y ?? null });
    this.cover = new GroundCover(this.scene, this.terrain, this.world, { density: qk, radius: this.settings.quality === 'low' ? 100 : 150 });
    this.terrain.terrainUniforms.uSunDir.value.copy(this.lights.sunDir);
    this.terrain.terrainUniforms.uSparkle.value = e.time === 'night' ? 0.25 : e.time === 'dusk' ? 0.6 : 1;
    this.app.post.preset(e.time);
    this.app.post.bloom.enabled = this.settings.quality !== 'low';
    this.app.post.setAO(this.settings.quality === 'high', 0.7);
    this.mapImage = this.terrain.makeMapImage(512, 1100);
    const mg = this.mapImage.getContext('2d');
    mg.fillStyle = 'rgba(40,40,45,0.85)';
    for (const o of this.world.obstacles) {
      if (!o.blocksSight || o.y1 - o.y0 < 1.2) continue;
      const px = ((o.x + 1100) / 2200) * 512, pz = ((o.z + 1100) / 2200) * 512;
      const s = o.kind === 1 ? o.r : Math.max(o.hx, o.hz);
      if (s < 1.2) continue;
      mg.save(); mg.translate(px, pz); mg.rotate(-(o.yaw || 0));
      if (o.kind === 1) { mg.beginPath(); mg.arc(0, 0, Math.max(1, s / 4.3), 0, 6.3); mg.fill(); }
      else mg.fillRect(-o.hx / 4.3, -o.hz / 4.3, Math.max(1, o.hx / 2.15), Math.max(1, o.hz / 2.15));
      mg.restore();
    }
    // первый этап
    this.nextStage();
    // камера попаданий (картинка в картинке)
    const hb = document.createElement('div'); hb.className = 'hitcam';
    const hl = document.createElement('div'); hl.className = 'hclabel'; hb.appendChild(hl);
    this.hud.root.appendChild(hb);
    this.hitcam = { on: !!def.training, proj: null, hold: 0, t: 0, cam: new THREE.PerspectiveCamera(40, 3 / 2, 0.05, 3000), box: hb, label: hl };
    this.player.computePose(0.016);
    this.updateCamera(0);
    this.cover.update(this.camPos);
  }

  makeCtx() {
    const self = this, w = this.world, m = this.mats;
    const S = {};
    for (const [k, fn] of Object.entries({ building: ST.building, tower: ST.watchtower, sandbags: ST.sandbags, berm: ST.berm, crates: ST.crates, container: ST.container, barrels: ST.barrels, fence: ST.fence, rock: ST.rock, spruce: ST.spruce, antenna: ST.antenna, bunker: ST.bunker, wreck: ST.wreck, sign: ST.sign, fuelTank: ST.fuelTank, radarDish: ST.radarDish, dome: ST.domeBuilding, ship: ST.ship, pier: ST.pier, lamp: ST.lampPost, target: ST.targetBoard, crane: ST.crane, box: ST.box })) {
      S[k] = (opts) => fn(w, m, opts);
    }
    const ctx = {
      S, world: w, mats: m, mission: self, get player() { return self.player; },
      ground: (x, z) => self.terrain.heightAt(x, z),
      group: (name) => self.addGroup(new Group(self, 'denter', name)),
      enemy: (o) => self.addEnemy(o),
      vehicle: (type, o) => self.addVehicle(type, o),
      item: (o) => self.addItem(o),
      radio: (text, from = 'Штаб', delay = 0) => self.after(delay, () => self.hud.radio(from, text, true)),
      after: (t, fn) => self.after(t, fn),
      onUpdate: (fn) => self.updaters.push(fn),
      fail: (r) => self.fail(r),
      stage: (objs, onStart, onDone) => self.stages.push({ objs, onStart, onDone }),
      objReach: (text, x, z, r) => ({ text, marker: () => new THREE.Vector3(x, self.terrain.heightAt(x, z), z), check: () => { const b = self.player.body.pos; return Math.hypot(b.x - x, b.z - z) < r; } }),
      objEliminate: (text, groups, frac = 1) => ({ text, check: () => { let tot = 0, dead = 0; for (const g of groups) for (const s of g.members) { tot++; if (!s.alive) dead++; } return tot > 0 && dead / tot >= frac - 1e-6; }, marker: () => { for (const g of groups) for (const s of g.members) if (s.alive && s.brain && s.brain.state === 'combat') return null; return null; }, progress: () => { let tot = 0, dead = 0; for (const g of groups) for (const s of g.members) { tot++; if (!s.alive) dead++; } return tot ? `${dead}/${Math.ceil(tot * frac)}` : ''; } }),
      objInteract: (text, item) => ({ text, check: () => { const it = typeof item === 'function' ? item() : item; return !!(it && it.done); }, marker: () => { const it = typeof item === 'function' ? item() : item; return it && !it.done ? it.pos : null; } }),
      objDestroy: (text, targets) => ({ text, check: () => targets.every((t) => !t.alive), marker: () => { const t = targets.find((x) => x.alive); return t ? t.pos : null; }, progress: () => `${targets.filter((t) => !t.alive).length}/${targets.length}` }),
      objKill: (text, s) => ({ text, check: () => !s.alive, marker: () => null }),
      objCustom: (text, fn, marker) => ({ text, check: fn, marker: marker || (() => null) }),
      scatter: (o) => self.scatter(o),
      prop: (type, x, z, o = {}) => w.propRequests.push({ type, x, z, yaw: o.yaw || 0, y: o.y ?? null }),
      windFlag: (x, z) => self.addWindFlag(x, z),
      poi: Object.fromEntries(Object.entries(POI).map(([k, fn]) => [k, (o) => fn(w, m, o)])),
      forest: (o) => self.scatter({ rocks: 0, ...o, forest: true }),
      weaponRack: (x, z) => self.addWeaponRack(x, z),
      ammoCrate: (x, z) => self.addAmmoCrate(x, z),
    };
    return ctx;
  }

  addGroup(g) { this.groups.push(g); return g; }

  addEnemy(o) {
    const s = new Soldier(this, { team: 'denter', faction: o.faction || 'denter', weapon: o.weapon || 'akm', role: o.role || 'rifleman', x: o.x, z: o.z, y: o.y, yaw: o.yaw || 0, static: o.static, skill: { aim: rand(0.38, 0.6), reaction: rand(0.35, 0.6), nerve: rand(0.35, 0.65), ...(o.skill || {}) }, secondary: o.secondary, name: o.name || 'Боевик «Дентера»', health: o.health, armor: o.armor ?? 0.45, helmet: o.helmet ?? 0.3, grenades: o.grenades ?? (Math.random() < 0.6 ? 1 : 0), scale: o.scale });
    const b = new Brain(s, this, { mode: o.mode || 'guard', route: o.route, post: { x: o.x, z: o.z, yaw: o.yaw || 0 } });
    if (o.group) o.group.add(s);
    this.soldiers.push(s);
    return s;
  }

  addVehicle(type, o) {
    const v = new Vehicle(this, type, { x: o.x, z: o.z, yaw: o.yaw || 0, team: o.team || 'negs' });
    this.vehicles.push(v);
    this.world.vehicles.push(v);
    if (o.crew) {
      o.crew.forEach((c, i) => {
        const s = this.addEnemy({ x: o.x, z: o.z, weapon: c.weapon || 'akm', role: c.role || 'rifleman', secondary: c.secondary, group: o.group, mode: 'guard' });
        const seat = i === 0 ? 0 : (i === 1 && v.gunWeapon ? 1 : -1);
        v.board(s, seat);
      });
    }
    if (o.ai) { v.ai = { route: o.ai.route.map((p) => ({ ...p })), idx: 0, speed: o.ai.speed, leader: o.ai.leader || null, alerted: false }; }
    v._update0 = true;
    v._place(0.016);
    return v;
  }

  addItem({ x, z, y, label, hold = 2 }) {
    const gy = y ?? this.world.groundAt(x, z, 10);
    const mesh = new THREE.Group();
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.3), new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.5, metalness: 0.5 }));
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.02), new THREE.MeshBasicMaterial({ color: 0x40ff60 }));
    l.position.set(0.15, 0.07, 0.16);
    mesh.add(c, l); mesh.position.set(x, gy + 0.85, z);
    this.scene.add(mesh);
    const it = { pos: new THREE.Vector3(x, gy + 0.9, z), label, hold, done: false, mesh };
    this.interactables.push({ pos: it.pos, r: 2.2, label, hold, enabled: () => !it.done, action: () => { it.done = true; this.scene.remove(mesh); this.hud.message('Получено: ' + label.replace(/^[^:]*:\s*/, ''), 2.5); this.audio.mech('switch'); } });
    // небольшая подставка-стол
    this.world.addBox({ x, z, y0: gy, w: 1.2, d: 0.7, h: 0.78, material: this.mats.wood, mat: 'wood', pen: 20 });
    return it;
  }

  addAmmoCrate(x, z) {
    this.world.addBox({ x, z, y0: this.terrain.heightAt(x, z), w: 1.1, d: 0.6, h: 0.5, material: this.mats.metalGreen, mat: 'metal' });
    this.interactables.push({ pos: new THREE.Vector3(x, this.terrain.heightAt(x, z) + 0.6, z), r: 2, label: 'Пополнить боекомплект', hold: 0.6, enabled: () => true, action: () => this.player.resupply() });
  }

  addWeaponRack(x, z) {
    const y0 = this.terrain.heightAt(x, z);
    this.world.addBox({ x, z, y0, w: 2.6, d: 0.5, h: 1.3, material: this.mats.woodDark, mat: 'wood', pen: 15 });
    const opts = [...PRIMARY_CHOICES, 'rpg7'];
    opts.forEach((id, i) => {
      const px = x - 1.2 + (i / (opts.length - 1)) * 2.4;
      this.interactables.push({ pos: new THREE.Vector3(px, y0 + 1, z + 0.4), r: 0.9, label: `Взять ${WEAPONS[id].name}`, hold: 0.3, enabled: () => true, action: () => {
        const p = this.player;
        if (id === 'rpg7') { p.slots[1] = makeState('rpg7'); p.cur = 1; }
        else { p.slots[0] = makeState(id, this.app.save.loads); p.cur = 0; p.uglMode = false; }
        p.switchT = 0.6;
        this.hud.message(`Взят ${WEAPONS[id].name}: ${WEAPONS[id].desc}`, 4);
      } });
    });
  }

  addWindFlag(x, z) {
    const y0 = this.terrain.heightAt(x, z);
    this.world.addBox({ x, z, y0, w: 0.06, d: 0.06, h: 4, material: this.mats.metalGrey, collide: false });
    const geo = new THREE.PlaneGeometry(1.2, 0.6, 8, 1);
    geo.translate(0.6, 0, 0);
    const flag = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xd8301c, side: THREE.DoubleSide, roughness: 0.8 }));
    flag.position.set(x, y0 + 3.7, z);
    flag.rotation.y = Math.atan2(-this.wind.z, this.wind.x);
    this.scene.add(flag);
    this.flags.push({ mesh: flag, base: geo.attributes.position.array.slice() });
  }

  scatter({ x, z, r, rocks = 0, trees = 0, avoid = [], road = false, seed = 7, forest = false }) {
    const rnd = mulberry32(seed + Math.floor(x * 3 + z * 7 + r));
    const ok = (px, pz) => {
      if (Math.hypot(px, pz) > 1080) return false;
      for (const a of avoid) if (Math.hypot(px - a.x, pz - a.z) < (a.r || 60)) return false;
      const m = this.terrain.maskAt(px, pz);
      if (m === 1 || m === 2) return false;
      if (this.terrain.hasSea && this.terrain.heightAt(px, pz) < 0.8) return false;
      const st = this.def.start;
      if (Math.hypot(px - st.x, pz - st.z) < 25) return false;
      return true;
    };
    for (let i = 0; i < rocks; i++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (!ok(px, pz)) continue;
      const s = rnd() < 0.15 ? 1.6 + rnd() * 1.6 : 0.5 + rnd() * 1.1;
      ST.rock(this.world, this.mats, { x: px, z: pz, s, seed: i * 13 + seed });
    }
    for (let i = 0; i < trees; i++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (!ok(px, pz)) continue;
      // ели и карликовые берёзы растут группами
      const n = forest ? 4 + Math.floor(rnd() * 7) : 1 + Math.floor(rnd() * 4);
      const spread = forest ? 24 : 12;
      for (let k = 0; k < n; k++) {
        const qx = px + (rnd() - 0.5) * spread, qz = pz + (rnd() - 0.5) * spread;
        if (!ok(qx, qz)) continue;
        if (rnd() < 0.3) ST.birch(this.world, this.mats, { x: qx, z: qz, h: 2.5 + rnd() * 3, seed: i * 7 + k + seed });
        else ST.spruce(this.world, this.mats, { x: qx, z: qz, h: forest ? 4.5 + rnd() * 9 : 3 + rnd() * 7, seed: i * 7 + k + seed });
      }
    }
  }

  after(t, fn) { this.timers.push({ t: this.time + t, fn }); }

  nextStage() {
    const prev = this.stages[this.stageIdx];
    if (prev && prev.onDone) prev.onDone();
    this.stageIdx++;
    const st = this.stages[this.stageIdx];
    if (!st) { this.success(); return; }
    if (this.stageIdx > 0) { this.hud.message('Задача выполнена', 2.5); this.audio.radio(); }
    if (st.onStart) st.onStart();
    this.hud.setObjectives(this);
  }

  success() {
    if (this.finished) return;
    this.finished = true;
    this.hud.message('ЗАДАНИЕ ВЫПОЛНЕНО', 4, true);
    this.after(3.5, () => this.app.endMission(true, null, this));
  }

  fail(reason) {
    if (this.finished) return;
    this.finished = true; this.failed = reason;
    this.hud.message('ЗАДАНИЕ ПРОВАЛЕНО: ' + reason, 4, true);
    this.after(3.5, () => this.app.endMission(false, reason, this));
  }

  // ===================== интерфейс для сущностей =====================
  fireProjectile(o) {
    this.projectiles.spawn(o);
    const w = o.weapon;
    this.audio.shot(o.pos, w.sound, !!o.own);
    const d = o.dir.clone().normalize();
    const big = w.id === 'rpg7' ? 2 : w.id === 'svd' || w.id === 'pkm' || w.id === 'pkt' || w.id === 'pkp_mount' ? 1.3 : w.id === 'gp25' ? 0.6 : 1;
    if (!o.own || this.player.scoped) this.fx.muzzle(o.pos, d, big);
    else this.fx.flashLight(o.pos, 40, 0.05);
    if (w.id === 'rpg7') {
      // реактивная струя назад
      for (let i = 0; i < 18; i++) this.fx.smoke.emit(o.pos.x - d.x * 1.2, o.pos.y - d.y * 1.2, o.pos.z - d.z * 1.2, -d.x * rand(5, 20) + rand(-2, 2), -d.y * rand(5, 20) + rand(0, 2), -d.z * rand(5, 20) + rand(-2, 2), rand(1.5, 3), 0.5, 3, 0.85, 0.85, 0.85, 0.55, 0, 2, -0.2);
    }
    const loud = w.id === 'rpg7' ? 700 : w.id === 'svd' || w.id.startsWith('pk') ? 650 : w.id === 'gp25' ? 250 : 480;
    this.noise(o.pos, loud * (this.isNight ? 1.1 : 1), o.team, o.owner);
    if (o.owner && o.owner.isPlayer && this.squadGroup) {
      // свои слышат выстрел командира — готовность к бою
      for (const s of this.squadGroup.members) if (s.brain && s.brain.state === 'idle') { s.brain.state = 'alert'; s.brain.alertT = 15; }
    }
  }

  throwGrenade(owner, pos, vel, type) { return this.projectiles.throwGrenade(owner, pos, vel, type); }

  noise(pos, radius, team, src) {
    this.noises.push({ pos: pos.clone(), radius, team, src, time: this.time });
  }

  shout(s, text) {
    const last = this.shoutT.get(s) || -99;
    if (this.time - last < 3) return;
    const d = s.pos.distanceTo(this.player.body.pos);
    if (s.team !== 'negs' && d > 60) return;
    this.shoutT.set(s, this.time);
    this.hud.radio(s.team === 'negs' ? s.callsign : `«Дентер» (${d.toFixed(0)} м)`, text, false, s.team !== 'negs');
  }

  targetsFor(team) {
    if (this._targetsFrame !== this.frame) { this._targetsCache.clear(); this._targetsFrame = this.frame; }
    let r = this._targetsCache.get(team);
    if (r) return r;
    r = [];
    for (const s of this.soldiers) if (s.alive && !s.hidden && s.team !== team) r.push(s);
    for (const v of this.vehicles) { if (!v.alive) continue; const ct = v.crewTeam; if (ct && ct !== team) r.push(v); }
    this._targetsCache.set(team, r);
    return r;
  }

  onSoldierDeath(s, src) {
    if (s.brain) s.brain.releaseCover();
    if (s.isPlayer) { this.hud.message('Вы погибли', 3, true); this.after(2.5, () => this.fail('Сержант Кей погиб')); return; }
    if (s.team === 'negs') {
      this.stats.lost.push(s.rosterId);
      this.hud.radio('Отделение', `«${s.callsign}» тяжело ранен, выбыл!`, true);
    } else if (src && src.isPlayer) {
      if (!s._countedKill) { s._countedKill = true; this.stats.kills++; }
    }
    if (s.team === 'denter' && Math.random() < 0.4) {
      const near = this.squadGroup && this.squadGroup.members.find((m) => m.alive && m.pos.distanceTo(s.pos) < 250 && m.brain);
      if (near) this.shout(near, ['Минус один!', 'Готов!', 'Есть попадание!'][Math.floor(Math.random() * 3)]);
    }
  }

  // ---------- камера попаданий ----------
  onPlayerShot(p) {
    if (!this.hitcam || !this.hitcam.on) return;
    if (p.ammo.kind !== 'bullet' && p.ammo.kind !== 'rocket' && p.ammo.kind !== 'grenade') return;
    this.hitcam.proj = p; this.hitcam.hold = 0; this.hitcam.t = 0;
  }

  updateHitcam(dt) {
    const h = this.hitcam;
    if (this.input.bh('hitcam')) { h.on = !h.on; this.hud.message(h.on ? 'Камера попаданий: вкл. (J)' : 'Камера попаданий: выкл.', 1.5); if (!h.on) h.proj = null; }
    h.box.style.display = h.on && h.proj ? 'block' : 'none';
    if (!h.on || !h.proj) return;
    const p = h.proj, cam = h.cam;
    h.t += dt;
    if (p.alive) {
      // за пулей: чуть позади и сбоку, взгляд по скорости
      const d = p.v.clone().normalize();
      const side = new THREE.Vector3(-d.z, 0, d.x).normalize();
      cam.position.copy(p.p).addScaledVector(d, -1.6).addScaledVector(side, 0.35).add(new THREE.Vector3(0, 0.25, 0));
      cam.lookAt(p.p.clone().addScaledVector(d, 6));
      cam.fov = 40;
      h.label.textContent = `Пуля: ${(p.dist).toFixed(0)} м · ${p.v.length().toFixed(0)} м/с · ${p.t.toFixed(2)} с`;
    } else {
      h.hold += dt;
      const im = p.impact;
      if (!im || h.hold > 2.6) { h.proj = null; return; }
      const n = im.normal && im.normal.lengthSq() > 0.5 ? im.normal.clone() : p.v.clone().normalize().negate();
      if (im.target) {
        const t = im.target;
        const f = new THREE.Vector3(Math.sin(t.facing), 0, Math.cos(t.facing));
        cam.position.set(t.x, t.y, t.z).addScaledVector(f, Math.max(t.w, t.h) * 1.6 + 0.4);
        cam.lookAt(t.x, t.y, t.z);
        cam.fov = 40;
        const rx = Math.cos(t.facing), rz = -Math.sin(t.facing);
        const dx = (im.pos.x - t.x) * rx + (im.pos.z - t.z) * rz, dy = im.pos.y - t.y;
        h.label.textContent = `Мишень ${Math.hypot(t.x - p.origin.x, t.z - p.origin.z).toFixed(0)} м: ${(dy * 100).toFixed(0)} см по высоте, ${(dx * 100).toFixed(0)} см по горизонтали`;
      } else {
        cam.position.copy(im.pos).addScaledVector(n, 2.6).add(new THREE.Vector3(0, 0.8, 0));
        cam.lookAt(im.pos);
        cam.fov = 35;
        h.label.textContent = { soldier: 'Попадание в человека', vehicle: 'Попадание в технику', prop: 'Попадание в предмет', static: 'Попадание' }[im.kind] || 'Промах';
        if (im.kind === 'static' && im.normal && im.normal.y > 0.6) h.label.textContent = 'Промах: точка падения';
      }
    }
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }

  onPlayerHit(d, dir, zone) {
    this.audio.hurt();
    this.hud.hit(d, dir, this.player.yaw);
    this.player.shake = Math.max(this.player.shake, 0.4);
    this.player.pitch += 0.01 * Math.random();
  }

  onPlayerSuppressed(amount, p, dist) {
    this.player.suppression = Math.min(1, this.player.suppression + amount * 1.3);
    const sup = p.v.length() > 340;
    const rel = p.p.clone().sub(this.camPos);
    const rx = Math.cos(this.player.yaw), rz = -Math.sin(this.player.yaw);
    const pan = clamp((rel.x * rx + rel.z * rz) / Math.max(1, rel.length()), -1, 1);
    this.audio.crack(0.4 + amount * 1.2, pan, sup);
    this.player.shake = Math.max(this.player.shake, amount * 0.35);
  }

  onPlayerBlast(k) {
    this.player.shake = Math.max(this.player.shake, k * 1.3);
    this.player.suppression = Math.min(1, this.player.suppression + k);
  }

  onTargetHit(t, pt, p) {
    if (!p.byPlayer) return;
    const rx = Math.cos(t.facing), rz = -Math.sin(t.facing);
    const dx = (pt.x - t.x) * rx + (pt.z - t.z) * rz;
    const dy = pt.y - t.y;
    const D = Math.hypot(t.x - p.origin.x, t.z - p.origin.z);
    const v = (cm, a, b) => `${Math.abs(cm).toFixed(0)} см ${cm >= 0 ? a : b}`;
    this.hud.radio('Корректировщик', `Мишень ${D.toFixed(0)} м: ${v(dy * 100, 'выше', 'ниже')}, ${v(dx * 100, 'правее', 'левее')} центра. Полёт ${p.t.toFixed(2)} с, ${p.v.length().toFixed(0)} м/с.`, false);
    this.stats.hits++;
  }

  onDestructible(d, by) {
    if (!d.alive) return;
    d.alive = false;
    if (d.kind === 'fuel') {
      this.fx.explosion(d.pos.clone().add(new THREE.Vector3(0, 2, 0)), 3.2, false);
      this.audio.explosion(d.pos, 2.2);
      this.fx.addFire(new THREE.Vector3(d.pos.x, d.pos.y + d.h * 0.5, d.pos.z), 3, 400);
      d.mesh.traverse((o) => { if (o.isMesh) o.material = new THREE.MeshStandardMaterial({ color: 0x1a1817, roughness: 1 }); });
      d.mesh.scale.y = 0.75;
      // ударная волна по округе
      this.projectiles.explode(d.pos.clone(), { radius: 12, frag: 30, dmg: 200, pen: 0 }, by);
      this.hud.message('Цистерна уничтожена', 2);
    } else if (d.kind === 'radar') {
      this.fx.explosion(d.pos.clone(), 1.5, false);
      this.audio.explosion(d.pos, 1.3);
      d.head.rotation.z = 0.9; d.head.position.y -= 1.2; d.spin = 0;
      this.fx.addFire(d.pos.clone(), 0.7, 90);
      this.hud.message('Антенна РЛС уничтожена', 2.5);
    }
  }

  onVehicleDestroyed(v, by) {
    if (v.team === 'negs' && v.crewTeam !== 'denter') this.hud.message(`${v.type.name} уничтожен!`, 3);
    else this.hud.message(`Техника противника уничтожена: ${v.type.name}`, 3);
  }

  grenadeWarning(gr) {
    const near = this.squadGroup && this.squadGroup.members.find((m) => m.alive && !m.hidden && m.pos.distanceTo(gr.pos) < 30);
    if (near) { this.shoutT.delete(near); this.shout(near, 'ГРАНАТА!'); }
    this.hud.grenade(gr, this);
  }

  spotterRange() {
    const sp = this.squadGroup && this.squadGroup.members.find((m) => m.alive && m.role === 'sniper' && !m.hidden);
    const cam = this.camera;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const hit = this.world.raycast(cam.position, cam.position.clone().addScaledVector(dir, 2000), { mask: 'sight' });
    if (!sp) { this.hud.message('В отделении нет наблюдателя (снайпера)', 2); return; }
    if (!hit) { this.after(1.2, () => this.shout(sp, 'Не вижу ориентира, слишком далеко.')); return; }
    const D = hit.point.distanceTo(sp.eye) * (1 + randn() * 0.04);
    const r = Math.round(D / 10) * 10;
    this.after(1.4, () => { this.shoutT.delete(sp); this.shout(sp, `Дальность до ориентира около ${r} м.`); });
  }

  squadOrder(type, pt) {
    if (!this.squadGroup) return;
    const alive = this.squadGroup.members.filter((m) => m.alive && m.brain);
    if (!alive.length) return;
    const names = { follow: 'За мной!', hold: 'Стоять, занять оборону!', move: 'Выдвинуться к точке!', suppress: 'Огонь на подавление по ориентиру!' };
    this.hud.radio('Кей', names[type], false);
    for (const s of alive) {
      const b = s.brain;
      if (type === 'suppress') {
        if (!pt) continue;
        b.prevOrder = b.order && b.order.type !== 'suppress' ? b.order : { type: 'follow' };
        b.order = { type: 'suppress', pos: pt.clone().add(new THREE.Vector3(0, 0.8, 0)), until: this.time + 14 };
      } else if (type === 'hold') b.order = { type: 'hold', pos: s.pos.clone() };
      else if (type === 'move') {
        const i = alive.indexOf(s);
        const off = new THREE.Vector3((i % 3 - 1) * 3, 0, Math.floor(i / 3) * 3);
        b.order = { type: 'move', pos: pt.clone().add(off) };
        b.path = null;
      } else b.order = { type: 'follow' };
      if (type !== 'suppress') b.releaseCover();
    }
    this.after(0.8, () => { const s = alive[0]; this.shoutT.delete(s); this.shout(s, type === 'suppress' ? 'Есть, работаем по ориентиру!' : 'Есть!'); });
  }

  findInteraction(p) {
    const b = p.body;
    const fwd = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    let best = null, bd = 1e9;
    const eye = new THREE.Vector3(b.pos.x, b.pos.y + p.eyeH, b.pos.z);
    for (const it of this.interactables) {
      if (!it.enabled()) continue;
      const d = it.pos.distanceTo(eye);
      if (d > it.r + 0.6) continue;
      const to = it.pos.clone().sub(eye); to.y = 0; to.normalize();
      const sc = d - to.dot(fwd) * 1.5;
      if (sc < bd) { bd = sc; best = it; }
    }
    if (best) return best;
    for (const v of this.vehicles) {
      if (!v.alive || v.crewTeam === 'denter') continue;
      const dd = this.world.pointObstacleDist(v.collider, b.pos.x, b.pos.z);
      if (dd < 1.6) return { label: `Сесть: ${v.type.name}`, hold: 0, action: () => p.enterVehicle(v) };
    }
    return null;
  }

  // ===================== кадр =====================
  update(dt) {
    this.frameDt = dt;
    this.frame++;
    this.time += dt;
    this.stats.time += dt;
    const inp = this.input;
    if (inp.bh('map')) this.mapVisible = !this.mapVisible;
    this.squadVisible = inp.bd('squad');
    this.player.update(dt);
    for (const s of this.soldiers) s.update(dt);
    for (const g of this.groups) g.update(dt);
    for (const v of this.vehicles) v.update(dt);
    this.projectiles.update(dt);
    if (this.props) this.props.update(dt);
    // мишени РЛС крутятся
    for (const d of this.world.destructibles) if (d.kind === 'radar' && d.spin) d.head.rotation.y += d.spin * dt;
    for (const f of this.flags) {
      const a = f.mesh.geometry.attributes.position;
      const w = this.wind.length();
      for (let i = 0; i < a.count; i++) {
        const x0 = f.base[i * 3], y0 = f.base[i * 3 + 1];
        const droop = (1 - Math.min(1, w / 8)) * x0 * 0.9;
        a.setXYZ(i, x0 * (0.6 + Math.min(0.4, w / 15)), y0 - droop, Math.sin(this.time * (4 + w) + x0 * 5) * 0.06 * x0 * Math.min(1, w / 3));
      }
      a.needsUpdate = true;
    }
    // скрипты
    for (const fn of this.updaters) fn(dt);
    for (let i = this.timers.length - 1; i >= 0; i--) if (this.timers[i].t <= this.time) { const t = this.timers[i]; this.timers.splice(i, 1); t.fn(); }
    const st = this.stages[this.stageIdx];
    if (st && !this.finished) {
      let all = true;
      for (const o of st.objs) { if (!o.done && o.check()) { o.done = true; this.hud.setObjectives(this); } if (!o.done) all = false; }
      if (all) this.nextStage();
    }
    this.noises = this.noises.filter((n) => this.time - n.time < 1.2);
    this.updateCamera(dt);
    this.updateHitcam(dt);
    this.fx.update(dt);
    if (this.snow) this.snow.update(dt, this.camPos);
    if (this.cover) this.cover.update(this.camPos);
    this.lights.sky.update(dt, this.camPos);
    // тень вокруг камеры
    const sun = this.lights.sun;
    const snap = 2;
    const cx = Math.round(this.camPos.x / snap) * snap, cz = Math.round(this.camPos.z / snap) * snap;
    sun.target.position.set(cx, this.terrain.heightAt(cx, cz), cz);
    sun.position.copy(sun.target.position).addScaledVector(this.lights.sunDir, 220);
    this.audio.setListener(this.camPos.x, this.camPos.y, this.camPos.z, this.player.vehicle ? this.player.yaw : this.player.yaw);
    this.audio.setWind(this.wind.length() + (this.def.env.snow || 0) * 6);
    this.hud.update(this, dt);
  }

  updateCamera(dt) {
    const p = this.player, b = p.body, cam = this.camera, look = this.lookCam;
    const W = innerWidth, H = innerHeight;
    let fov = this.settings.fov;
    let vmVisible = false;
    this.scopeDraw = null;
    const v = p.vehicle;
    if (!v) {
      const bob = Math.sin(p.walkPhase * 2) * 0.025 * Math.min(1, b.speed / 3) * (1 - p.aimT * 0.8);
      look.position.set(b.pos.x, b.pos.y + p.eyeH + bob, b.pos.z);
      look.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
      look.updateMatrixWorld(true);
      cam.position.copy(look.position);
      cam.quaternion.copy(look.quaternion);
      const ws = p.state;
      const aw = p.activeWeapon;
      if (p.scoped) {
        cam.quaternion.multiply(p.sightQuat);
        const sc = ws && ws.binocular ? SCOPES.b8 : SCOPES[p.sightOf(aw).scope];
        fov = this.scopeFov(sc);
        const marks = ws && ws.binocular ? { marks: [], extra: [] } : p.scopeMarks(aw);
        this.scopeDraw = { scope: sc, marks: marks.marks, extra: marks.extra, offX: clamp(p.sightPos.x * 3500, -25, 25), offY: clamp(p.sightPos.y * 3500, -25, 25) + (1 - p.aimT) * 500 };
      } else {
        fov = lerp(this.settings.fov, this.settings.fov * 0.62, p.aimT);
        vmVisible = b.alive;
      }
    } else if (p.seat === 1 && v.type.turret) {
      // МТ-ЛБ: прицел стрелка
      const sp = v.sightPos(new THREE.Vector3());
      cam.position.copy(sp);
      const gq = new THREE.Quaternion(); v.model.gun.getWorldQuaternion(gq);
      const theta = solverFor('pkt', this.zeroEnv).angleFor(SCOPES.pp61.zero);
      cam.quaternion.copy(gq).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -theta));
      look.position.copy(cam.position); look.quaternion.copy(cam.quaternion); look.updateMatrixWorld(true);
      if (p.gunnerSight) {
        fov = this.scopeFov(SCOPES.pp61);
        if (!this._pktMarks) {
          const sv = solverFor('pkt', this.zeroEnv); const z = sv.angleFor(SCOPES.pp61.zero);
          this._pktMarks = SCOPES.pp61.marks.map((r) => ({ range: r, ang: sv.angleFor(r) - z }));
        }
        this.scopeDraw = { scope: SCOPES.pp61, marks: this._pktMarks, extra: [], offX: 0, offY: 0 };
      } else fov = 60;
    } else if (p.seat === 1) {
      // «Тигр»: стрелок в люке (сам пулемёт показан как оружие от первого лица)
      v.model.gun.visible = false;
      const tp = new THREE.Vector3(); v.model.turret.getWorldPosition(tp);
      look.position.set(tp.x, tp.y + 0.55, tp.z);
      look.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
      look.updateMatrixWorld(true);
      cam.position.copy(look.position); cam.quaternion.copy(look.quaternion);
      fov = lerp(this.settings.fov, this.settings.fov * 0.62, p.aimT);
      vmVisible = true;
    } else {
      const T = v.type;
      if (p.camThird || p.seat > 1) {
        const target = new THREE.Vector3(v.pos.x, v.pos.y + T.height * 0.9 + 0.6, v.pos.z);
        const yaw = v.yaw + p.camYaw, pitch = p.camPitch;
        const dist = T.len * 1.1 + 4;
        const dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
        const want = target.clone().addScaledVector(dir, -dist);
        const hit = this.world.raycast(target, want, { mask: 'sight', vehicles: false });
        if (hit) want.lerpVectors(target, want, Math.max(0.15, hit.t - 0.05));
        const gh = this.terrain.heightAt(want.x, want.z) + 0.6;
        if (want.y < gh) want.y = gh;
        cam.position.copy(want);
        cam.lookAt(target);
      } else {
        v.mesh.updateMatrixWorld(true);
        const sp = v.toWorld(T.id === 'mtlb' ? -0.6 : -0.42, T.height * (T.id === 'mtlb' ? 0.85 : 0.78), T.id === 'mtlb' ? -2.0 : -0.3);
        cam.position.copy(sp);
        const q = new THREE.Quaternion(); v.mesh.getWorldQuaternion(q);
        cam.quaternion.copy(q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(p.camPitch * 0.6, p.camYaw, 0, 'YXZ')));
      }
      look.position.copy(cam.position); look.quaternion.copy(cam.quaternion); look.updateMatrixWorld(true);
    }
    for (const vv of this.vehicles) if (vv.model.gun && vv.type.gunExposed && !(v === vv && p.seat === 1)) vv.model.gun.visible = true;
    // тряска
    if (p.shake > 0.001) {
      const k = p.shake * 0.012;
      cam.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(randn() * k, randn() * k, randn() * k * 0.5)));
    }
    if (Math.abs(cam.fov - fov) > 0.01 || cam.aspect !== W / H) { cam.fov = fov; cam.aspect = W / H; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld(true);
    // оружие от первого лица
    this.vmVisible = vmVisible;
    if (vmVisible) {
      this.viewmodel.setKind(p.vmKind());
      const aw = p.activeWeapon;
      const th = aw ? p.theta(aw) : 0;
      this.viewmodel.update(p.sightPos, p.sightQuat, th, true, p.flashT > 0, { dt: this.frameDt || 1 / 60, shotAge: p.shotAge ?? 9, reload: p.reloadP ?? -1, empty: !!p.reloadEmpty, sprint: p.sprintT || 0 });
      this.vmCamera.fov = cam.fov; this.vmCamera.aspect = W / H; this.vmCamera.updateProjectionMatrix();
      // солнце в системе камеры
      const sd = this.lights.sunDir.clone().applyQuaternion(look.quaternion.clone().invert());
      this.vmSun.position.copy(sd);
      this.vmFlash.position.set(0.1, -0.05, -0.6);
      this.vmFlash.intensity = p.flashT > 0 ? 3 : 0;
    } else if (this.viewmodel.cur) this.viewmodel.cur.root.visible = false;
    this.fx.setView(cam, H, this.scene.fog);
  }

  scopeFov(sc) {
    // кружок окуляра занимает 92% высоты экрана = истинное поле зрения прицела
    const t = Math.tan((sc.fov * Math.PI) / 360) / 0.92;
    return (2 * Math.atan(t) * 180) / Math.PI;
  }

  render() {
    this.app.post.render(this.scene, this.camera, this.vmVisible ? this.vmScene : null, this.vmCamera, 1 / 60);
    const hc = this.hitcam;
    if (hc && hc.on && hc.proj) {
      const r = this.renderer;
      const W = innerWidth, H = innerHeight;
      const w = Math.round(Math.min(420, W * 0.3)), h = Math.round(w / 1.5);
      const x = W - w - 18, y = H - h - 200;
      hc.box.style.cssText = `display:block;left:${x - 2}px;top:${H - y - h - 2}px;width:${w}px;height:${h}px`;
      hc.cam.aspect = w / h; hc.cam.updateProjectionMatrix();
      const fog = this.scene.fog; this.scene.fog = null;
      r.setScissorTest(true); r.setScissor(x, y, w, h); r.setViewport(x, y, w, h);
      r.autoClear = true;
      r.render(this.scene, hc.cam);
      r.setScissorTest(false); r.setViewport(0, 0, W, H);
      this.scene.fog = fog;
    }
    const sc = this.hud.scopeCanvas;
    if (this.scopeDraw) {
      const W = sc.width, H = sc.height;
      const f = (H / 2) / Math.tan((this.camera.fov * Math.PI) / 360);
      const rr = H * 0.46;
      drawScope(sc.getContext('2d'), W, H, this.scopeDraw.scope, { f, cx: W / 2, cy: H / 2, r: rr, offX: this.scopeDraw.offX, offY: this.scopeDraw.offY, night: this.isNight || this.def.env.time === 'dusk', marks: this.scopeDraw.marks, extra: this.scopeDraw.extra });
      sc.style.display = 'block';
    } else if (sc.style.display !== 'none') {
      sc.getContext('2d').clearRect(0, 0, sc.width, sc.height);
      sc.style.display = 'none';
    }
  }

  dispose() {
    if (this.hitcam) this.hitcam.box.remove();
    this.audio.stopAllEngines();
    this.projectiles.clear();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) m.dispose(); }
    });
    this.renderer.renderLists.dispose();
  }
}
