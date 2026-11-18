// Рантайм миссии: мир, бойцы, техника, снаряды, камера, прицелы, задачи и скрипты
import * as THREE from 'three';
import { Terrain } from '../world/terrain.js';
import { World } from '../world/world.js';
import { makeLighting } from '../world/sky.js';
import { Snowfall } from '../world/weather.js';
import * as ST from '../world/structures.js';
import { Effects } from '../fx/effects.js';
import * as POI from '../world/poi.js';
import { scatterGround, GroundCover, snowify } from '../world/flora.js';
import { Props } from '../world/props.js';
import { hdr as hdrAsset, texture as texAsset, hasAssets, model as modelAsset } from '../core/assets.js';
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
import { Howitzer } from '../artillery/howitzer.js';
import { pvpMap, NET_ROLES, kitOf } from '../data/pvp.js';
import { grenadeModel } from '../weapons/guns.js';
import { Drone, DRONE_RESPAWN } from '../entities/drone.js';
import { crewItems } from '../artillery/crew.js';

const QUALITY = { low: { seg: 256, shadow: 1024, snow: 0.5, wseg: 416 }, medium: { seg: 384, shadow: 2048, snow: 1, wseg: 576 }, high: { seg: 480, shadow: 4096, snow: 1.4, wseg: 704 } };
// Расширенная карта для миссий без собственного размера местности: район задачи (±1,2 км)
// с подробной сеткой, вокруг — 3,3 км холмистой тундры до горного кольца (место для артиллерии)
const WIDE = { size: 8000, core: 2400, boundary: 3300, mountain: 260 };
const OUTSKIRT_NAMES = ['д. Каменка (нежил.)', 'пос. Лесной (нежил.)', 'д. Ручьи (нежил.)', 'д. Озерки (нежил.)', 'пос. Кварцевый (нежил.)'];

function distPoly(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1);
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

// Дороги и долины, упиравшиеся в край старой карты, продолжаются до гор
function extendRoads(feats, R) {
  for (const f of feats) {
    if ((f.type !== 'road' && f.type !== 'valley') || !f.pts || f.pts.length < 2) continue;
    const ext = (a, b) => {
      if (Math.hypot(a[0], a[1]) < 850) return [];
      let dx = a[0] - b[0], dz = a[1] - b[1];
      const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
      const out = []; let x = a[0], z = a[1];
      for (let k = 0; k < 14 && Math.hypot(x, z) < R; k++) {
        // плавный изгиб и лёгкое стремление наружу
        const r = Math.hypot(x, z) || 1, t = Math.sin((k + 1) * 1.7 + a[0] * 0.013 + a[1] * 0.007) * 0.22;
        let nx = dx * Math.cos(t) - dz * Math.sin(t) + (x / r) * 0.35, nz = dx * Math.sin(t) + dz * Math.cos(t) + (z / r) * 0.35;
        const n = Math.hypot(nx, nz); dx = nx / n; dz = nz / n;
        x += dx * 280; z += dz * 280;
        out.push([Math.round(x), Math.round(z)]);
      }
      return out;
    };
    const P = f.pts, head = ext(P[0], P[1]).reverse(), tail = ext(P[P.length - 1], P[P.length - 2]);
    f.pts = [...head, ...P, ...tail];
  }
}

// План окраин (до генерации рельефа): холмы и замёрзшие озёра для разнообразия местности,
// площадки под посёлок, развалины и стойбище — их выравниваем
function planOutskirts(seed, feats, boundary) {
  const rnd = mulberry32(seed * 977 + 13);
  const roads = feats.filter((f) => f.pts);
  const coasts = feats.filter((f) => f.type === 'coast');
  const onLand = (x, z, m) => !coasts.some((c) => x * c.nx + z * c.nz - c.d > -m);
  const nearRoad = (x, z, m) => roads.some((f) => distPoly(x, z, f.pts) < m);
  const ring = (r0, r1) => { const a = rnd() * Math.PI * 2, d = r0 + rnd() * (r1 - r0); return [Math.cos(a) * d, Math.sin(a) * d]; };
  const sites = [], hills = [], lakes = [];
  for (let tries = 0; tries < 400 && sites.length < 4; tries++) {
    const [x, z] = ring(1700, boundary - 500);
    if (!onLand(x, z, 220) || nearRoad(x, z, 110)) continue;
    if (sites.some((s) => Math.hypot(s.x - x, s.z - z) < 900)) continue;
    sites.push({ x: Math.round(x), z: Math.round(z), yaw: rnd() * Math.PI * 2 });
  }
  for (let tries = 0; tries < 300 && hills.length < 9; tries++) {
    const r = 220 + rnd() * 280, [x, z] = ring(1250 + r * 1.6, boundary - 150);
    if (!onLand(x, z, 100)) continue;
    if (hills.some((h) => Math.hypot(h.x - x, h.z - z) < (h.r + r) * 0.9)) continue;
    hills.push({ type: 'hill', x: Math.round(x), z: Math.round(z), r: Math.round(r), h: Math.round(18 + rnd() * 40) });
  }
  for (let tries = 0; tries < 300 && lakes.length < 4; tries++) {
    const r = 60 + rnd() * 110, [x, z] = ring(1500 + r, boundary - 400);
    if (!onLand(x, z, 250) || nearRoad(x, z, r + 90)) continue;
    if (sites.some((s) => Math.hypot(s.x - x, s.z - z) < r + 200)) continue;
    if (lakes.some((l) => Math.hypot(l.x - x, l.z - z) < l.r + r + 300)) continue;
    lakes.push({ type: 'lake', x: Math.round(x), z: Math.round(z), r: Math.round(r), fall: 30 });
  }
  return { sites, hills, lakes };
}

export class Mission {
  constructor(app, def, setup) {
    this.app = app; this.def = def; this.setup = setup;
    this.renderer = app.renderer; this.audio = app.audio; this.input = app.input; this.settings = app.settings; this.hud = app.hud;
    this.time = 0;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.1, def.far || 4200);
    this.guns = []; this.artTargets = [];
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
    // сетевая игра
    this.net = setup.net || null;
    this.netAI = []; this.netItems = []; this.netVisual = false;
    this.marks = []; this._markN = 200; this.scoutT = 3;
    if (this.net) this.net.attach(this);
  }

  get pvp() { return !!(this.net && this.net.pvp); }

  // ===================== загрузка =====================
  build() {
    if (!this.net) this._build();
    else {
      const orig = Math.random;
      Math.random = mulberry32(this.net.seed >>> 0);
      try { this._build(); } finally { Math.random = orig; }
    }
    if (!window.__noWarmup) try { this.warmup(); } catch (e) { console.warn('warmup', e); }
  }

  // Прогрев при загрузке: шейдеры всех материалов компилируются, модели оружия от первого лица,
  // снарядов и эффекты собираются и один раз рисуются — тем же конвейером, что и в игре
  // (с постобработкой и тенями), и напрямую без тумана (окно камеры попаданий/снаряда/дрона).
  // Иначе это происходит в момент первого выстрела, взрыва или смены оружия — и кадр «подвисает».
  warmup() {
    const r = this.renderer, fx = this.fx, vm = this.viewmodel, cam = this.camera;
    // баллистические таблицы всех стволов миссии (иначе первый выстрел каждого бойца ИИ
    // с новым оружием считает таблицу ~0,1 с прямо в кадре)
    const ids = new Set(['ak74m', 'rpg7', 'pkm']);
    for (const so of this.soldiers) if (so.weaponId) ids.add(so.weaponId);
    for (const v of this.vehicles) if (v.type.gun) ids.add(v.type.gun);
    for (const id of ids) if (WEAPONS[id]) solverFor(id, this.zeroEnv);
    const pl = this.player;
    for (const ws of pl.slots) {
      if (!ws || ws.grenade || ws.binocular) continue;
      try { pl.theta(ws); pl.scopeMarks(ws); if (ws.ugl) pl.theta(ws.ugl); } catch (e) { /* нет прицела */ }
    }
    cam.updateMatrixWorld(true);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const P = cam.position.clone().addScaledVector(fwd, 12), UP = new THREE.Vector3(0, 1, 0);
    // оружие от первого лица: всё снаряжение, ГП-25, гранаты, бинокль, ПКП на турели
    const vmTemp = [];
    for (const k of this.player.allVmKinds()) {
      if (!vm.models.has(k)) vm.models.set(k, vm._build(k));
      const c = vm.models.get(k);
      if (c !== vm.cur) { vm.scene.add(c.root); vmTemp.push(c); }
      c.root.visible = true; c.flash.visible = true;
      c.root.position.set(0, -0.1, -0.6); c.root.updateMatrixWorld(true);
      try { const kind = vm.kind; vm.kind = k; vm._eject(c); vm.kind = kind; } catch (e) { /* у вида нет гильз */ }
    }
    // снаряды и эффекты — перед камерой
    const temp = [];
    const add = (o) => { o.position.copy(P); this.scene.add(o); temp.push(o); };
    const PR = this.projectiles;
    add(PR.shellMesh()); add(PR.rocketProto.clone()); add(new THREE.Mesh(PR.grenadeGeo, PR.grenadeMat));
    if (!PR._f1Proto) { try { PR._f1Proto = grenadeModel(); } catch (e) { /* запасная модель */ } }
    if (PR._f1Proto) add(PR._f1Proto.clone());
    const snap = { smoke: fx.smoke.n, glow: fx.glow.n, tracers: fx.tracers.length, emitters: fx.emitters.slice(), di: fx._di, dc: fx.decals.count };
    fx.muzzle(P, fwd); fx.impact(P, UP, 'snow'); fx.impact(P, UP, 'metal'); fx.impact(P, UP, 'concrete');
    fx.explosion(P, 1); fx.muzzleBlast(P, fwd); fx.shellBurst(P); fx.rocketSmoke(P, fwd); fx.rocketFlame(P);
    fx.pushTracer(P, fwd.clone().multiplyScalar(800), cam.position); fx.addDecal(P, UP, 0.1);
    fx.update(0.016); fx.setView(cam, innerHeight, this.scene.fog);
    // отрисовка: игровой конвейер, затем прямой вывод без тумана
    this.app.post.render(this.scene, cam, vm.scene, this.vmCamera, 0);
    const fog = this.scene.fog;
    this.scene.fog = null;
    r.setRenderTarget(null); r.render(this.scene, cam);
    this.scene.fog = fog;
    // окно камеры БПЛА: рендер в текстуру и вывод с эффектом видеокамеры
    if (this.myDrone) {
      const dvPrev = this.droneView;
      this.myDrone._aim(); this._droneRT(1e9); this._droneBlit();
      this.droneView = dvPrev; this.dv.ready = false;
    }
    // убрать временное
    for (const o of temp) this.scene.remove(o);
    for (const c of vmTemp) vm.scene.remove(c.root);
    for (const c of vm.models.values()) c.flash.visible = false;
    for (const cs of vm.cases) { cs.alive = false; cs.mesh.visible = false; }
    fx.smoke.n = snap.smoke; fx.glow.n = snap.glow; fx.tracers.length = snap.tracers; fx.emitters = snap.emitters; fx._di = snap.di; fx.decals.count = snap.dc;
    for (const l of fx.lights) l.intensity = 0;
    fx.update(0);
  }

  _build() {
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
    const tdef = def.terrain;
    const wide = this.wideMap = !tdef.size && !tdef.compact;
    const feats = tdef.features.map((f) => (f.pts ? { ...f, pts: f.pts.map((p) => [...p]) } : { ...f }));
    this.outskirts = [];
    if (wide) {
      extendRoads(feats, WIDE.boundary + 300);
      const plan = planOutskirts(tdef.seed || 1, feats, WIDE.boundary);
      this.outskirts = plan.sites;
      // холмы и озёра — до остальных особенностей (дороги и площадки миссии ложатся поверх)
      feats.unshift(...plan.hills, ...plan.lakes);
      this.outskirts.forEach((s, i) => feats.push({ type: 'flat', x: s.x, z: s.z, r: i === 0 ? 85 : 40, fall: 60, dh: 0 }));
    }
    this.terrain = new Terrain({
      seed: tdef.seed, amp: tdef.amp, features: feats,
      seg: tdef.seg || (wide ? q.wseg : q.seg), size: tdef.size || (wide ? WIDE.size : 2400), core: tdef.core || (wide ? WIDE.core : 0),
      boundary: tdef.boundary || (wide ? WIDE.boundary : 1050), mountain: tdef.mountain || (wide ? WIDE.mountain : 150),
    });
    if (!def.far) this.camera.far = wide ? 7000 : 4200;
    this.camera.updateProjectionMatrix();
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
    this.fx.night = e.time === 'night' || e.time === 'dusk';
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
    const sp = this.net ? this.net.spawnPoint(def) : st;
    this.player = new Player(this, { primary: this.setup.primary || 'ak74m', launcher: this.setup.launcher === true ? 'rpg7' : this.setup.launcher || null, grenades: this.setup.grenades, x: sp.x, z: sp.z, yaw: sp.yaw });
    if (this.pvp) this.player.setTeam(this.net.team);
    this.soldiers.push(this.player.body);
    // скрипт миссии
    const ctx = this.makeCtx();
    if (this.pvp) {
      // противостояние: карта без ИИ и сценария
      const dummy = (o) => ({ alive: false, pos: new THREE.Vector3(o.x || 0, 0, o.z || 0), brain: null, members: [], hp: 0 });
      ctx.enemy = dummy;
      const addV = ctx.vehicle;
      ctx.vehicle = (type, o) => addV(type, { x: o.x, z: o.z, yaw: o.yaw, team: 'negs' });
      ctx.radio = () => {};
      ctx.stage = () => {};
    }
    def.build(ctx);
    if (this.net) this.buildNetSquads(def);
    if (this.pvp) {
      this.updaters = [];
      const lim = this.net.room.scoreLimit;
      this.stages = [{ objs: [{ text: `Командный бой до ${lim} побед. Tab — таблица счёта`, check: () => false, marker: () => null }] }];
    }
    // окраины расширенной карты
    if (this.wideMap && !def.noOutskirts) this._buildOutskirts();
    // вешки вдоль дорог, таблички
    for (const f of this.terrain.features) if (f.type === 'road') POI.roadPoles(this.world, this.mats, { pts: f.pts.filter((p) => Math.hypot(p[0], p[1]) < this.terrain.boundary + 60) });
    for (const sg of this.world.signs) ST.sign(this.world, this.mats, sg);
    // техника на старте
    const vlist = this.pvp ? [] : def.vehicles || (this.setup.vehicles || []).map((t, i) => ({ type: t, x: st.x + 9 + i * 8 * Math.cos(st.yaw), z: st.z + 8 + i * 8 * Math.sin(st.yaw), yaw: st.yaw }));
    const startV = vlist.map((v) => this.addVehicle(v.type, { x: v.x, z: v.z, yaw: v.yaw, team: 'negs' }));
    // гаубица Д-30 на прицепе (автопарк штаба / настройка комнаты)
    const towGun = (v, name, team = 'negs') => {
      const T = v.type, hx = v.pos.x + Math.sin(v.yaw) * (T.hitch + 4.2), hz = v.pos.z + Math.cos(v.yaw) * (T.hitch + 4.2);
      const h = new Howitzer(this, { x: hx, z: hz, name, mode: 'travel', heading: v.yaw + Math.PI, towBy: v, team });
      this.guns.push(h);
      return h;
    };
    if (!this.net && this.setup.howitzer && def.id !== 'artillery' && startV.length) towGun(startV[0], 'Д-30 № 1');
    if (this.net && def.id !== 'artillery') {
      // сетевая игра: Д-30 с расчётом и выбранный тягач — у каждого, кто их взял
      const room = this.net.room;
      const perTeam = { negs: 0, denter: 0 };
      room.players.forEach((pl) => {
        const k = kitOf(pl, room);
        if (!k.howitzer) return;
        const team = this.pvp ? pl.team : 'negs';
        const sp = this.pvp ? pvpMap(def.id).spawns[team] : { x: st.x, z: st.z, yaw: st.yaw };
        const n = perTeam[team]++;
        const c = Math.cos(sp.yaw), s = Math.sin(sp.yaw);
        const ox = 14 + n * 7, oz = -6 - n * 3;
        const x = sp.x + c * ox + s * oz, z = sp.z - s * ox + c * oz;
        const v = this.addVehicle(VEHICLE_TYPES[k.tow] ? k.tow : 'tigr', { x, z, yaw: sp.yaw, team: 'negs' });
        towGun(v, `Д-30 (${pl.name})`, team);
      });
    }
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
    scatterGround(this.scene, this.terrain, this.world, { seed: def.terrain.seed, wind: this.wind, grass: Math.floor(9000 * qk), shrubs: Math.floor(3000 * qk), stones: Math.floor(1500 * qk), drifts: Math.floor(500 * qk), radius: 950, center: def.groundCenter || { x: 0, z: 0 }, avoid: [{ x: def.start.x, z: def.start.z, r: 12 }, ...(def.clearZones || [])] });
    for (const sp of this.world.smokes) this.fx.addSmoke(sp, 1);
    this.props = new Props(this);
    for (const r of this.world.propRequests) this.props.spawn(r.type, r.x, r.z, { yaw: r.yaw, y: r.y ?? null });
    this.cover = new GroundCover(this.scene, this.terrain, this.world, { density: qk, radius: this.settings.quality === 'low' ? 100 : 150 });
    this.terrain.terrainUniforms.uSunDir.value.copy(this.lights.sunDir);
    this.terrain.terrainUniforms.uSparkle.value = e.time === 'night' ? 0.25 : e.time === 'dusk' ? 0.6 : 1;
    this.app.post.preset(e.time);
    this.app.post.bloom.enabled = this.settings.quality !== 'low';
    this.app.post.setAO(this.settings.quality === 'high', 0.7);
    // карта: район задачи ±1100 м и (на больших картах) вся местность — колесо мыши переключает
    const overlay = (img, R) => {
      const mg = img.getContext('2d'), k = img.width / (2 * R), min = R > 1500 ? 0.6 : 1;
      // леса — зелёным, как на топокарте
      mg.fillStyle = 'rgba(70,140,70,0.22)';
      for (const f of this.forestAreas || []) { mg.beginPath(); mg.arc((f.x + R) * k, (f.z + R) * k, f.r * 0.85 * k, 0, 6.3); mg.fill(); }
      mg.fillStyle = 'rgba(40,40,45,0.85)';
      for (const o of this.world.obstacles) {
        if (!o.blocksSight || o.y1 - o.y0 < 1.2) continue;
        if (Math.abs(o.x) > R || Math.abs(o.z) > R) continue;
        const s = o.kind === 1 ? o.r : Math.max(o.hx, o.hz);
        if (s < 1.2) continue;
        mg.save(); mg.translate((o.x + R) * k, (o.z + R) * k); mg.rotate(-(o.yaw || 0));
        if (o.kind === 1) { mg.beginPath(); mg.arc(0, 0, Math.max(min, s * k), 0, 6.3); mg.fill(); }
        else mg.fillRect(-o.hx * k, -o.hz * k, Math.max(min, o.hx * 2 * k), Math.max(min, o.hz * 2 * k));
        mg.restore();
      }
    };
    this.mapImage = this.terrain.makeMapImage(512, 1100);
    overlay(this.mapImage, 1100);
    this.mapZoom = 0; this.mapWide = null;
    if (this.terrain.half > 1500) {
      const R = this.mapWideRange = Math.floor(Math.min(this.terrain.half - 100, this.terrain.boundary + 400) / 100) * 100;
      this.mapWide = this.terrain.makeMapImage(640, R);
      overlay(this.mapWide, R);
    }
    // первый этап
    this.nextStage();
    // БПЛА-корректировщик
    this._makeDrones();
    // камера попаданий (картинка в картинке)
    const hb = document.createElement('div'); hb.className = 'hitcam';
    const hl = document.createElement('div'); hl.className = 'hclabel'; hb.appendChild(hl);
    this.hud.root.appendChild(hb);
    this.hitcam = { on: !!def.training, shellCam: true, proj: null, hold: 0, t: 0, cam: new THREE.PerspectiveCamera(40, 3 / 2, 0.05, 3000), box: hb, label: hl };
    this.player.computePose(0.016);
    this.updateCamera(0);
    this.cover.update(this.camPos);
    if (this.net) this.net.onBuilt();
  }

  // все свои бойцы-игроки (сеть: и удалённые)
  playerBodies() {
    const r = [this.player.body];
    for (const s of this.soldiers) if (s.isRemote && (!this.pvp || s.team === this.player.body.team)) r.push(s);
    return r;
  }
  anyPlayerNear(x, z, r) {
    for (const b of this.playerBodies()) if (b.alive && Math.hypot(b.pos.x - x, b.pos.z - z) < r) return true;
    return false;
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
      objReach: (text, x, z, r) => ({ text, marker: () => new THREE.Vector3(x, self.terrain.heightAt(x, z), z), check: () => self.anyPlayerNear(x, z, r) }),
      anyPlayerNear: (pos, r) => self.anyPlayerNear(pos.x, pos.z, r),
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
      howitzer: (o) => { const h = new Howitzer(self, o); self.guns.push(h); return h; },
      artTarget: (o) => self.addArtTarget(o),
    };
    return ctx;
  }

  addGroup(g) { this.groups.push(g); return g; }

  // Цель для артиллерии: район с объектами; подавлена, когда разрушен её «центр»
  addArtTarget({ name, short, desc, x, z, r = 18, hp = 520 }) {
    const y0 = this.terrain.heightAt(x, z);
    const t = { kind: 'art', name, short, desc, pos: new THREE.Vector3(x, y0 + 1, z), r, hp, maxHp: hp, alive: true, meshes: [] };
    this.world.destructibles.push(t);
    this.artTargets.push(t);
    return t;
  }

  // Сетевая игра: отделение ИИ у каждого игрока (одинаковый порядок у всех; считает хост)
  buildNetSquads(def) {
    const net = this.net, room = net.room;
    this.netSquads = new Map();
    room.players.forEach((pl, pi) => {
      const team = this.pvp ? pl.team : 'negs';
      const sp = this.pvp ? pvpMap(def.id).spawns[team] : def.start;
      const grp = this.addGroup(new Group(this, team, 'squad-' + pl.id));
      grp.leaderId = pl.id;
      this.netSquads.set(pl.id, grp);
      const roles = kitOf(pl, room).squad.map((k) => NET_ROLES[k]).filter(Boolean);
      for (let i = 0; i < roles.length; i++) {
        const R = roles[i];
        const c = Math.cos(sp.yaw), sn = Math.sin(sp.yaw);
        const ox = ((i % 3) - 1) * 3 + (pi % 4) * 1.2, oz = 4 + Math.floor(i / 3) * 3 + Math.floor(pi / 4) * 2;
        const x = sp.x + c * ox + sn * oz, z = sp.z - sn * ox + c * oz;
        const s = new Soldier(this, { team, faction: team, name: `${pl.name}: ${R.name}`, callsign: `${pl.name}-${i + 1}`, role: R.role, weapon: R.weapon, secondary: R.secondary, x, z, yaw: sp.yaw, armor: 0.8, helmet: 0.6, grenades: 2, skill: { aim: 0.62, reaction: 0.6, nerve: 0.7 } });
        s.squadOf = pl.id;
        new Brain(s, this, { mode: 'squad', slot: i, leaderId: pl.id });
        grp.add(s);
        this.soldiers.push(s);
        s.netIdx = this.netAI.length; this.netAI.push(s);
        if (!net.isHost) { s.brain = null; s.damage = (amount, zone, source, dir, opts) => net.aiDamage(s, amount, zone, source, dir, opts); }
      }
      if (pl.id === net.net.id) this.squadGroup = grp;
    });
  }

  // Возрождение отделения вместе с командиром (хост)
  reviveSquad(leaderId, pos, yaw) {
    const grp = this.netSquads && this.netSquads.get(leaderId);
    if (!grp) return;
    grp.members.forEach((s, i) => {
      if (s.alive) return;
      const c = Math.cos(yaw), sn = Math.sin(yaw);
      const ox = ((i % 3) - 1) * 3, oz = 4 + Math.floor(i / 3) * 3;
      const x = pos.x + c * ox + sn * oz, z = pos.z - sn * ox + c * oz;
      s.revive(x, this.world.groundAt(x, z), z, yaw);
    });
  }

  addEnemy(o) {
    const s = new Soldier(this, { team: 'denter', faction: o.faction || 'denter', weapon: o.weapon || 'akm', role: o.role || 'rifleman', x: o.x, z: o.z, y: o.y, yaw: o.yaw || 0, static: o.static, skill: { aim: rand(0.38, 0.6), reaction: rand(0.35, 0.6), nerve: rand(0.35, 0.65), ...(o.skill || {}) }, secondary: o.secondary, name: o.name || 'Боевик «Дентера»', health: o.health, armor: o.armor ?? 0.45, helmet: o.helmet ?? 0.3, grenades: o.grenades ?? (Math.random() < 0.6 ? 1 : 0), scale: o.scale });
    const b = new Brain(s, this, { mode: o.mode || 'guard', route: o.route, post: { x: o.x, z: o.z, yaw: o.yaw || 0 } });
    if (o.group) o.group.add(s);
    this.soldiers.push(s);
    s.netIdx = this.netAI.length; this.netAI.push(s);
    if (this.net && !this.net.isHost) {
      s.brain = null;
      s.damage = (amount, zone, source, dir, opts) => this.net.aiDamage(s, amount, zone, source, dir, opts);
    }
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
    it.localTake = () => { if (it.done) return; it.done = true; this.scene.remove(mesh); this.hud.message('Получено: ' + label.replace(/^[^:]*:\s*/, ''), 2.5); this.audio.mech('switch'); };
    const idx = this.netItems.length; this.netItems.push(it);
    this.interactables.push({ pos: it.pos, r: 2.2, label, hold, enabled: () => !it.done, action: () => { if (this.net && !this.net.isHost) { this.net.interactItem(idx); this.hud.message('Передано хосту…', 1); } else it.localTake(); } });
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

  // Статичная модель (камни, стволы) на рельефе со снегом и препятствием
  staticModel(name, x, z, { ry = 0, scale = 1, sink = 0.15, collide = 0, snow = 1, mat = 'rock' } = {}) {
    const g = modelAsset(name);
    if (!g) return null;
    const o = g.scene.clone(true);
    const y0 = this.terrain.heightAt(x, z);
    o.position.set(x, y0 - sink * scale, z); o.rotation.y = ry; o.scale.setScalar(scale);
    o.traverse((m) => { if (m.isMesh) { m.material = snowify(m.material, snow); m.castShadow = true; m.receiveShadow = true; } });
    this.scene.add(o);
    if (collide) this.world.addCylCollider({ x, z, y0: y0 - 0.5, r: collide * scale, h: 1.2 * scale + 0.5, mat });
    return o;
  }

  scatter({ x, z, r, rocks = 0, trees = 0, avoid = [], road = false, seed = 7, forest = false, lite = false }) {
    const rnd = mulberry32(seed + Math.floor(x * 3 + z * 7 + r));
    if (forest && trees > 0) (this.forestAreas || (this.forestAreas = [])).push({ x, z, r });
    const ok = (px, pz) => {
      if (Math.hypot(px, pz) > this.terrain.boundary + 30) return false;
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
      if (rnd() < 0.12 && this.staticModel(rnd() < 0.5 ? 'rock_moss_set_01' : 'rock_moss_set_02', px, pz, { ry: rnd() * 6.28, scale: 0.45 + rnd() * 0.35, sink: 0.25, collide: 2.2, snow: 0.85 })) continue;
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
        const pick = rnd();
        if (forest && pick < 0.07) this.staticModel('dead_tree_trunk', qx, qz, { ry: rnd() * 6.28, scale: 0.9 + rnd() * 0.5, sink: 0.05, snow: 0.8, mat: 'wood' });
        else if (forest && pick < 0.13) this.staticModel('tree_stump_02', qx, qz, { ry: rnd() * 6.28, scale: 0.6 + rnd() * 0.4, sink: 0.1, collide: 0.4, snow: 0.9, mat: 'wood' });
        else if (rnd() < 0.3) ST.birch(this.world, this.mats, { x: qx, z: qz, h: 2.5 + rnd() * 3, seed: i * 7 + k + seed });
        else ST.spruce(this.world, this.mats, { x: qx, z: qz, h: forest ? 4.5 + rnd() * 9 : 3 + rnd() * 7, seed: i * 7 + k + seed, lite });
      }
    }
  }

  // Окраины расширенной карты: леса, каменистые россыпи, заброшенный посёлок, развалины, стойбище,
  // брошенная техника — ориентиры для наводки и укрытия для огневых позиций
  _buildOutskirts() {
    const T = this.terrain, W = this.world, M = this.mats, def = this.def;
    const rnd = mulberry32((def.terrain.seed || 1) * 131 + 7);
    const nrm = new THREE.Vector3();
    const land = (x, z, slope) => Math.hypot(x, z) < T.boundary - 120 && !(T.hasSea && T.heightAt(x, z) < 2) && T.maskAt(x, z) === 0 && T.normalAt(x, z, nrm).y > slope;
    const pick = (r0, r1, slope) => {
      for (let k = 0; k < 40; k++) {
        const a = rnd() * Math.PI * 2, d = r0 + (r1 - r0) * Math.sqrt(rnd());
        const x = Math.cos(a) * d, z = Math.sin(a) * d;
        if (land(x, z, slope)) return { x, z };
      }
      return null;
    };
    const sites = this.outskirts;
    const avoid = sites.map((s, i) => ({ x: s.x, z: s.z, r: i === 0 ? 110 : 45 }));
    for (let i = 0; i < 14; i++) {
      const p = pick(1350, T.boundary - 250, 0.82);
      if (p) this.scatter({ x: p.x, z: p.z, r: 130 + rnd() * 220, trees: 6 + Math.floor(rnd() * 8), rocks: 4, forest: true, lite: true, avoid, seed: 600 + i });
    }
    for (let i = 0; i < 9; i++) {
      const p = pick(1300, T.boundary - 200, 0.75);
      if (p) this.scatter({ x: p.x, z: p.z, r: 260, rocks: 18, trees: 3, lite: true, avoid, seed: 700 + i });
    }
    this.landmarks = [];
    sites.forEach((s, i) => {
      if (i === 0) {
        const name = OUTSKIRT_NAMES[(def.terrain.seed || 0) % OUTSKIRT_NAMES.length];
        POI.village(W, M, { x: s.x, z: s.z, yaw: s.yaw, n: 6, seed: 40, name });
        this.landmarks.push({ x: s.x, z: s.z, name: name.replace(' (нежил.)', '') });
      } else if (i === 1) {
        POI.ruin(W, M, { x: s.x, z: s.z, yaw: s.yaw, seed: 41 });
        POI.ruin(W, M, { x: s.x + 20, z: s.z + 9, yaw: s.yaw + 0.4, w: 9, d: 7, seed: 42 });
        this.landmarks.push({ x: s.x, z: s.z, name: 'развалины' });
      } else if (i === 2) {
        POI.chum(W, M, { x: s.x, z: s.z, seed: 43 }); POI.chum(W, M, { x: s.x + 11, z: s.z - 7, seed: 44 });
        this.landmarks.push({ x: s.x, z: s.z, name: 'стойбище' });
      } else {
        POI.truckWreck(W, M, { x: s.x, z: s.z, yaw: s.yaw });
        POI.woodpile(W, M, { x: s.x + 8, z: s.z + 3, yaw: s.yaw });
        this.landmarks.push({ x: s.x, z: s.z, name: 'брош. техника' });
      }
    });
    // брошенные грузовики на продолжениях дорог
    for (const f of T.features) {
      if (f.type !== 'road') continue;
      for (let k = 1; k < f.pts.length; k++) {
        const [x, z] = f.pts[k], [px, pz] = f.pts[k - 1];
        const r = Math.hypot(x, z);
        if (r < 1500 || r > T.boundary - 200 || rnd() > 0.3) continue;
        const L = Math.hypot(x - px, z - pz) || 1, dx = (x - px) / L, dz = (z - pz) / L, side = rnd() < 0.5 ? 1 : -1;
        const wx = x + dz * 10 * side, wz = z - dx * 10 * side;
        if (land(wx, wz, 0.9)) POI.truckWreck(W, M, { x: wx, z: wz, yaw: Math.atan2(dx, dz) + (rnd() - 0.5) * 0.8 });
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
    if (this.net) { if (this.net.isHost && !this.pvp) this.net.net.send({ t: 'end', ok: true, reason: '' }); return; }
    this.finished = true;
    this.hud.message('ЗАДАНИЕ ВЫПОЛНЕНО', 4, true);
    this.after(3.5, () => this.app.endMission(true, null, this));
  }

  fail(reason) {
    if (this.finished) return;
    if (this.net) { if (this.net.isHost && !this.pvp) this.net.net.send({ t: 'end', ok: false, reason }); return; }
    this.finished = true; this.failed = reason;
    this.hud.message('ЗАДАНИЕ ПРОВАЛЕНО: ' + reason, 4, true);
    this.after(3.5, () => this.app.endMission(false, reason, this));
  }

  // конец сетевого задания (по сообщению сервера)
  netEnd(ok, reason, lost) {
    if (this.finished) return;
    this.finished = true; this.failed = ok ? null : reason;
    this.hud.message(this.pvp ? reason || 'Матч окончен' : ok ? 'ЗАДАНИЕ ВЫПОЛНЕНО' : 'ЗАДАНИЕ ПРОВАЛЕНО: ' + reason, 4, true);
    this.after(lost ? 1.5 : 4, () => this.app.endNetMission(ok, reason, this, lost));
  }

  // ===================== интерфейс для сущностей =====================
  fireProjectile(o) {
    const pr = this.projectiles.spawn(o);
    if (this.net && !o.visual) this.net.onLocalShot(o, pr);
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

  throwGrenade(owner, pos, vel, type) {
    const gr = this.projectiles.throwGrenade(owner, pos, vel, type);
    if (this.net) this.net.onLocalGrenade(owner, gr, type || 'f1');
    return gr;
  }

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
    for (const d of this.drones || []) if (d.alive && d.team !== team) r.push(d);
    this._targetsCache.set(team, r);
    return r;
  }

  onSoldierDeath(s, src) {
    if (s.brain) s.brain.releaseCover();
    if (s.isPlayer) {
      if (this.net) { this.net.onLocalDeath(src); return; }
      this.hud.message('Вы погибли', 3, true); this.after(2.5, () => this.fail('Сержант Кей погиб')); return;
    }
    if (s.isRemote) return;
    if (s.isCrew) {
      if (s.team === this.myTeam) this.hud.radio(s.gunRef ? s.gunRef.name : 'Расчёт', `Номер расчёта (${s.crewRole}) выбыл!${s.gunRef && !s.gunRef.crewAlive() ? ' Расчёт выбит — заряжать придётся самим.' : ''}`, true);
      return;
    }
    if (s.squadOf !== undefined) {
      // сетевая игра: боец отделения игрока; хост сообщает серверу (очки PvP, лента)
      if (this.net && this.net.isHost) {
        const by = src === this.player.body ? this.net.net.id : src && src.isRemote ? src.peer.id : src && src.squadOf !== undefined ? src.squadOf : null;
        this.net.net.send({ t: 'aikill', team: s.team, vname: s.name, by, w: src && src.weapon ? src.weapon.id : '' });
      }
      return;
    }
    if (this.net && this.net.isHost && this.pvp === false && src) {
      // кооператив: убитый противник — в ленту
    }
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
    const h = this.hitcam;
    if (!h) return;
    // камера снаряда артиллерии работает на любой миссии (J — выключить)
    const shell = p.ammo.kind === 'shell';
    if (!(h.on || (shell && h.shellCam))) return;
    if (!shell && p.ammo.kind !== 'bullet' && p.ammo.kind !== 'rocket' && p.ammo.kind !== 'grenade') return;
    this.hitcam.proj = p; this.hitcam.hold = 0; this.hitcam.t = 0;
  }

  updateHitcam(dt) {
    const h = this.hitcam;
    if (this.input.bh('hitcam')) { h.on = !(h.on || (h.proj && h.shellCam)); h.shellCam = h.on; this.hud.message(h.on ? 'Камера попаданий: вкл. (J)' : 'Камера попаданий: выкл.', 1.5); if (!h.on) h.proj = null; }
    const vis = !!h.proj && (h.on || (h.shellCam && h.proj.ammo.kind === 'shell'));
    h.box.style.display = vis ? 'block' : 'none';
    if (!vis) return;
    const p = h.proj, cam = h.cam;
    h.t += dt;
    if (p.ammo.kind === 'shell') {
      // камера снаряда: за снарядом в полёте, затем — вид на место разрыва
      if (p.alive) {
        const d = p.v.clone().normalize();
        const side = new THREE.Vector3(-d.z, 0, d.x).normalize();
        // позади и чуть выше снаряда; взгляд немного вниз, чтобы в кадре была земля
        cam.position.copy(p.p).addScaledVector(d, -7).addScaledVector(side, 1.6).add(new THREE.Vector3(0, 1.8, 0));
        cam.lookAt(p.p.clone().addScaledVector(d, 30).add(new THREE.Vector3(0, -9, 0)));
        cam.fov = 50; cam.far = 20000;
        const D = Math.hypot(p.p.x - p.origin.x, p.p.z - p.origin.z);
        h.label.textContent = `Выстрел ${p.shotNo || ''}: Д ${Math.round(D)} м · V ${p.v.length().toFixed(0)} м/с · ${p.t.toFixed(1)} с · высота ${Math.round(p.p.y - this.terrain.heightAt(p.p.x, p.p.z))} м`;
      } else {
        h.hold += dt;
        if (h.hold > 6.5) { h.proj = null; return; }
        const im = p.impact ? p.impact.pos : p.p;
        const dh = new THREE.Vector3(p.v.x, 0, p.v.z).normalize();
        const side = new THREE.Vector3(-dh.z, 0, dh.x);
        // в кадре — разрыв и ближайшая цель (видно перелёт/недолёт)
        const f = im.clone();
        let back = 80, up = 24;
        if (p.nearTgt) { const tp = p.nearTgt.pos; const sep = Math.hypot(tp.x - im.x, tp.z - im.z); if (sep < 230) { f.lerp(tp, 0.5); back = Math.max(80, sep * 1.35); up = Math.max(24, sep * 0.42); } }
        cam.position.copy(f).addScaledVector(dh, -back).addScaledVector(side, back * 0.32);
        cam.position.y = Math.max(f.y + up, this.terrain.heightAt(cam.position.x, cam.position.z) + 8);
        cam.lookAt(f.x, f.y + 4, f.z);
        cam.fov = 42; cam.far = 20000;
        h.label.textContent = p.report || 'Разрыв';
      }
      cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
      return;
    }
    if (p.alive) {
      // за пулей: чуть позади и сбоку, взгляд по скорости
      const d = p.v.clone().normalize();
      const side = new THREE.Vector3(-d.z, 0, d.x).normalize();
      cam.position.copy(p.p).addScaledVector(d, -1.6).addScaledVector(side, 0.35).add(new THREE.Vector3(0, 0.25, 0));
      cam.lookAt(p.p.clone().addScaledVector(d, 6));
      cam.fov = 40; cam.far = 3000;
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
    if (d.kind === 'ammo') { d.gun.boxExplode(by); return; }
    if (d.kind === 'art') {
      this.fx.addFire(d.pos.clone(), 1.6, 300);
      this.fx.addSmoke(d.pos.clone().add(new THREE.Vector3(3, 0, 2)), 2);
      this.after(2.5, () => this.hud.radio('Наблюдатель', `${d.name} — подавлена! Огонь перенести.`, true));
      return;
    }
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

  // ---------- целеуказание: отметки противника (общие для команды) ----------
  get myTeam() { return this.player.body.team; }
  teamMarks(team = this.myTeam) { return this.marks.filter((k) => k.team === team); }

  addMark({ team, x, z, label, kind = 'enemy', by = '', ttl = 150, fromNet = false, report = true }) {
    let mk = this.marks.find((q) => q.team === team && q.kind === kind && Math.hypot(q.x - x, q.z - z) < 35);
    const fresh = !mk;
    if (!mk) { mk = { num: ++this._markN, team, kind }; this.marks.push(mk); }
    mk.x = x; mk.z = z; mk.t = this.time; mk.ttl = ttl; mk.by = by; mk.desc = label;
    mk.pos = new THREE.Vector3(x, this.terrain.heightAt(x, z) + 1, z);
    mk.alive = true; mk.name = `Цель ${mk.num}`; mk.short = String(mk.num); mk.r = 18;
    if (this.net && !fromNet) this.net.ev(['mk', team, Math.round(x), Math.round(z), label, kind, by, ttl]);
    if (report && team === this.myTeam && fresh) {
      const gx = Math.round(61000 - z), gy = Math.round(34000 + x);
      this.hud.radio(by || 'Разведчик', `${mk.name}: ${label}. X ${gx.toLocaleString('ru')}, Y ${gy.toLocaleString('ru')}`, true);
    }
    return mk;
  }

  // ---------- БПЛА ----------
  _makeDrones() {
    this.drones = [];
    this.droneView = false;
    if (this.def.noDrone) return;
    const mk = (team, x, z, name) => { const d = new Drone(this, { team, x, z, name, index: this.drones.length }); this.drones.push(d); return d; };
    if (this.pvp) {
      const pm = pvpMap(this.def.id);
      for (const team of ['negs', 'denter']) {
        const sp = pm.spawns[team], en = pm.spawns[team === 'negs' ? 'denter' : 'negs'];
        const d = mk(team, sp.x + 5, sp.z + 5, team === 'negs' ? 'БПЛА «Сова»' : 'БПЛА «Сыч»');
        d.setCenter(sp.x + (en.x - sp.x) * 0.7, sp.z + (en.z - sp.z) * 0.7);
      }
    } else {
      const st = this.def.start;
      mk('negs', st.x + 4, st.z + 5, 'БПЛА «Сова»');
    }
  }

  get myDrone() { return (this.drones || []).find((d) => d.team === this.myTeam) || null; }

  // облёт точки, куда смотрит игрок (бинокль, прицел, наводчик орудия)
  droneGoLook() {
    const d = this.myDrone;
    if (!d) return;
    if (!d.alive) { this.hud.message('Дрон сбит — резервный ещё не готов', 2); return; }
    const cam = this.camera;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const far = Math.min(9000, this.terrain.half * 1.4);
    const end = cam.position.clone().addScaledVector(dir, far);
    const hit = this.world.raycast(cam.position, end, { mask: 'sight' });
    let P = hit ? hit.point : null;
    if (!P) { this.hud.message(`Не вижу точки: посмотрите на землю (до ${Math.round(far / 1000)} км) или щёлкните по карте огня`, 2.5); return; }
    if (Math.hypot(P.x, P.z) > this.terrain.boundary) { this.hud.message('Точка за пределами района', 2); return; }
    this.droneGo(d, P.x, P.z);
    const gx = Math.round(61000 - P.z), gy = Math.round(34000 + P.x);
    this.hud.radio(d.name, `Принял, иду в район X ${gx.toLocaleString('ru')}, Y ${gy.toLocaleString('ru')}. Дальность от вас ${Math.round(Math.hypot(P.x - this.player.body.pos.x, P.z - this.player.body.pos.z))} м`, true);
  }

  droneGo(d, x, z, low = null) {
    if (this.net && !this.net.isHost) this.net.evHost(['dg', d.index, Math.round(x), Math.round(z), low === null ? -1 : low ? 1 : 0]);
    d.setCenter(x, z, low);
  }

  // попадание по дрону: считает хост
  hitDrone(d, dmg, src) {
    if (!d.alive) return;
    if (this.net && !this.net.isHost) { this.net.evHost(['dh', d.index, Math.round(dmg)]); this.fx.impact(d.pos, new THREE.Vector3(0, 1, 0), 'metal', 0.6); return; }
    d.damage(dmg, src);
  }

  onDroneDown(d, src) {
    const mine = d.team === this.myTeam;
    if (mine) {
      this.hud.message(`${d.name} сбит! Резервный дрон — через ${Math.round(DRONE_RESPAWN / 60)} мин`, 4, true);
      this.hud.radio(d.name, 'Потеря связи с бортом!', true);
    } else this.hud.message(src === this.player.body ? 'Вы сбили дрон противника' : 'Дрон противника сбит', 3);
  }

  _droneRespawn() {
    for (const d of this.drones) {
      if (d.alive || d.downAt < 0 || this.time - d.downAt < DRONE_RESPAWN) continue;
      // резервный дрон взлетает рядом с командиром своей стороны
      let base = null;
      if (d.team === this.myTeam) base = this.player.body.pos;
      else if (this.pvp && this.net) { for (const pr of this.net.peers.values()) if (pr.soldier && pr.soldier.team === d.team && pr.soldier.alive) { base = pr.soldier.pos; break; } }
      if (!base) base = this.pvp ? pvpMap(this.def.id).spawns[d.team] : this.def.start;
      d.revive(base.x + 3, base.z + 3);
      if (d.team === this.myTeam) this.hud.radio(d.name, 'Резервный борт в воздухе, выхожу в район.', true);
    }
  }

  // Разведчики отделений докладывают замеченного противника (считает хост / одиночная игра)
  updateScouts(dt) {
    this.scoutT -= dt;
    for (const mk of this.marks) if (this.time - mk.t > mk.ttl) mk.alive = false;
    this.marks = this.marks.filter((mk) => mk.alive);
    if (this.scoutT > 0) return;
    this.scoutT = 6;
    const groups = this.netSquads ? [...this.netSquads.values()] : this.squadGroup ? [this.squadGroup] : [];
    for (const grp of groups) for (const sc of grp.members) {
      if (!sc.alive || sc.role !== 'sniper' || !sc.brain) continue;
      // разведку ведёт БПЛА; разведчик докладывает сам, только пока дрона нет (сбит, ждём резервный)
      if ((this.drones || []).some((d) => d.alive && d.team === sc.team)) continue;
      const seen = [];
      for (const [t, mm] of sc.brain.memory) if (t.alive && mm.seen && this.time - mm.lastSeen < 4 && (t.isVehicle ? t.crewTeam && t.crewTeam !== sc.team : t.team !== sc.team)) seen.push(t);
      // группы по 40 м
      const used = new Set();
      for (const t of seen) {
        if (used.has(t)) continue;
        const cl = seen.filter((o) => !used.has(o) && o.pos.distanceTo(t.pos) < 40);
        cl.forEach((o) => used.add(o));
        const veh = cl.filter((o) => o.isVehicle);
        const cx = cl.reduce((a, o) => a + o.pos.x, 0) / cl.length, cz = cl.reduce((a, o) => a + o.pos.z, 0) / cl.length;
        const d = Math.hypot(cx - sc.pos.x, cz - sc.pos.z);
        const e = d * 0.012; // ошибка глазомера и дальномерной сетки
        const label = veh.length ? `${veh[0].type.name}${cl.length > 1 ? ` и пехота (${cl.length - veh.length})` : ''}` : `пехота противника (${cl.length})`;
        this.addMark({ team: sc.team, x: cx + randn() * e, z: cz + randn() * e, label, by: sc.callsign || 'Разведчик' });
      }
    }
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
    // разведчик передаёт координаты ориентира — отметка на карте и карте огня
    const P = hit.point.clone(), e = D * 0.006;
    this.after(1.4, () => {
      this.shoutT.delete(sp); this.shout(sp, `Дальность до ориентира около ${r} м, передаю координаты.`);
      this.addMark({ team: this.myTeam, x: P.x + randn() * e, z: P.z + randn() * e, label: 'ориентир, указан биноклем', kind: 'mark', by: sp.callsign || 'Разведчик', ttl: 300 });
    });
  }

  squadOrder(type, pt, group = this.squadGroup, remote = false) {
    if (!group) return;
    if (this.net && !this.net.isHost && !remote) {
      const names = { follow: 'За мной!', hold: 'Стоять, занять оборону!', move: 'Выдвинуться к точке!', suppress: 'Огонь на подавление по ориентиру!' };
      this.hud.radio(this.net.me.name, names[type], false);
      this.net.evHost(['o', type, pt ? +pt.x.toFixed(1) : 0, pt ? +pt.y.toFixed(1) : 0, pt ? +pt.z.toFixed(1) : 0, pt ? 1 : 0]);
      return;
    }
    const alive = group.members.filter((m) => m.alive && m.brain);
    if (!alive.length) return;
    if (remote) {
      // приказ удалённого командира: без радиосообщений у хоста
      for (const s of alive) this._applyOrder(s, type, pt, alive);
      return;
    }
    const names = { follow: 'За мной!', hold: 'Стоять, занять оборону!', move: 'Выдвинуться к точке!', suppress: 'Огонь на подавление по ориентиру!' };
    this.hud.radio(this.net ? this.net.me.name : 'Кей', names[type], false);
    for (const s of alive) this._applyOrder(s, type, pt, alive);
    this.after(0.8, () => { const s = alive[0]; this.shoutT.delete(s); this.shout(s, type === 'suppress' ? 'Есть, работаем по ориентиру!' : 'Есть!'); });
  }

  _applyOrder(s, type, pt, alive) {
    const b = s.brain;
    if (type === 'suppress') {
      if (!pt) return;
      b.prevOrder = b.order && b.order.type !== 'suppress' ? b.order : { type: 'follow' };
      b.order = { type: 'suppress', pos: pt.clone().add(new THREE.Vector3(0, 0.8, 0)), until: this.time + 14 };
    } else if (type === 'hold') b.order = { type: 'hold', pos: s.pos.clone() };
    else if (type === 'move') {
      if (!pt) return;
      const i = alive.indexOf(s);
      const off = new THREE.Vector3((i % 3 - 1) * 3, 0, Math.floor(i / 3) * 3);
      b.order = { type: 'move', pos: pt.clone().add(off) };
      b.path = null;
    } else b.order = { type: 'follow' };
    if (type !== 'suppress') b.releaseCover();
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
    const net = this.net, host = !net || net.isHost;
    if (net) net.preUpdate(dt);
    if (inp.bh('map') && !this.player.gun) this.mapVisible = !this.mapVisible;
    // БПЛА: Y — окно камеры, U — облёт точки, куда смотрит игрок (или прицел орудия)
    const myDrone = this.myDrone;
    if (inp.bh('drone')) {
      if (!myDrone) this.hud.message('БПЛА в этой операции нет', 2);
      else { this.droneView = !this.droneView; this.hud.message(this.droneView ? `${myDrone.name}: камера (Y — скрыть, U — облёт точки взгляда)` : 'Камера БПЛА скрыта', 2); }
    }
    if (inp.bh('droneGo') && myDrone) {
      // Shift+U — сменить высоту облёта (низко: лучше видно, но слышно и могут сбить)
      if (inp.bd('sprint')) {
        if (!myDrone.alive) this.hud.message('Дрон сбит — резервный ещё не готов', 2);
        else { this.droneGo(myDrone, myDrone.center.x, myDrone.center.z, !myDrone.low); this.hud.radio(myDrone.name, myDrone.low ? 'Снижаюсь до 90 м: вижу лучше, но меня слышно.' : 'Набираю 190 м, облёт с большим радиусом.', true); }
      } else this.droneGoLook();
    }
    if (this.mapVisible && this.mapWide) {
      // масштаб карты: колесо мыши или +/−; колесо не листает оружие, пока открыта карта
      if (inp.wheel > 0 || inp.hit('Minus') || inp.hit('NumpadSubtract')) this.mapZoom = 1;
      else if (inp.wheel < 0 || inp.hit('Equal') || inp.hit('NumpadAdd')) this.mapZoom = 0;
      inp.wheel = 0;
    }
    this.squadVisible = inp.bd('squad') && !net;
    if (!net || inp.active) this.player.update(dt);
    for (const s of this.soldiers) s.update(dt);
    if (host) for (const g of this.groups) g.update(dt);
    for (const v of this.vehicles) v.update(dt);
    for (const h of this.guns) h.update(dt);
    for (const d of this.drones) d.update(dt, host);
    if (host) this._droneRespawn();
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
    if (host) for (const fn of this.updaters) fn(dt);
    if (host) this.updateScouts(dt); else { for (const mk of this.marks) if (this.time - mk.t > mk.ttl) mk.alive = false; this.marks = this.marks.filter((mk) => mk.alive); }
    for (let i = this.timers.length - 1; i >= 0; i--) if (this.timers[i].t <= this.time) { const t = this.timers[i]; this.timers.splice(i, 1); t.fn(); }
    const st = this.stages[this.stageIdx];
    if (st && !this.finished && host) {
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
    if (net) net.postUpdate(dt);
  }

  updateCamera(dt) {
    const p = this.player, b = p.body, cam = this.camera, look = this.lookCam;
    const W = innerWidth, H = innerHeight;
    let fov = this.settings.fov;
    let vmVisible = false;
    this.scopeDraw = null;
    const v = p.vehicle;
    if (p.gun) {
      fov = p.gun.camera(cam);
      look.position.copy(cam.position); look.quaternion.copy(cam.quaternion); look.updateMatrixWorld(true);
    } else if (!v) {
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
    // снаряд или гильза с зарядом в руках (игрок заряжает сам) — вместо оружия
    const carry = p.carry && !v && !p.gun ? p.carry.item : null;
    if (!this.vmCarry && carry) {
      const I = crewItems();
      this.vmCarry = { shell: I.shell.clone(), charge: I.charge.clone() };
      for (const o of Object.values(this.vmCarry)) { o.rotation.set(0.15, Math.PI / 2, 0); this.vmScene.add(o); }
    }
    if (this.vmCarry) for (const [k, o] of Object.entries(this.vmCarry)) {
      o.visible = k === carry;
      if (o.visible) { o.position.set(0.02, -0.34 + Math.sin(p.walkPhase * 2) * 0.012, -0.52); }
    }
    if (carry) {
      if (this.viewmodel.cur) this.viewmodel.cur.root.visible = false;
      if (this.viewmodel.arms) this.viewmodel.arms.root.visible = false;
      this.vmVisible = b.alive;
      if (this.vmVisible) { const sd = this.lights.sunDir.clone().applyQuaternion(look.quaternion.clone().invert()); this.vmSun.position.copy(sd); this.vmCamera.fov = cam.fov; this.vmCamera.aspect = W / H; this.vmCamera.updateProjectionMatrix(); }
      this.fx.setView(cam, H, this.scene.fog);
      return;
    }
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
      this.vmFlash.position.set(0.1, -0.02, -0.85);
      this.vmFlash.intensity = p.flashT > 0 ? 0.55 : 0;
    } else if (this.viewmodel.cur) this.viewmodel.cur.root.visible = false;
    this.fx.setView(cam, H, this.scene.fog);
  }

  // ---------- окно камеры БПЛА ----------
  _droneViewOn() {
    const d = this.myDrone;
    if (!this.droneView || !d) return false;
    // после потери борта — несколько секунд «нет сигнала», затем окно закрывается
    if (!d.alive && this.time - d.downAt > 4) { this.droneView = false; return false; }
    return true;
  }

  _dvLayout() {
    const W = innerWidth, H = innerHeight;
    const w = Math.round(Math.max(260, Math.min(460, W * 0.3))), h = Math.round(w / 1.5);
    return { W, H, w, h, x: W - w - 16, top: 70 };
  }

  _dvInit() {
    if (this.dv) return this.dv;
    const L = this._dvLayout();
    const pr = Math.min(1.5, this.renderer.getPixelRatio());
    const rt = new THREE.WebGLRenderTarget(Math.round(L.w * pr), Math.round(L.h * pr), { type: THREE.HalfFloatType });
    const mat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: rt.texture }, uNight: { value: this.isNight ? 1 : 0 }, uTime: { value: 0 }, uLost: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; uniform float uNight, uTime, uLost; varying vec2 vUv;
        float rnd(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 7.0) * 43758.5453); }
        void main() {
          vec3 c = texture2D(tDiffuse, vUv).rgb;
          float l = dot(c, vec3(0.299, 0.587, 0.114));
          vec3 day = mix(vec3(l), c, 0.72) * 1.05;                 // приглушённые цвета видеокамеры
          vec3 nv = vec3(0.55, 1.0, 0.6) * pow(clamp(l * 6.0, 0.0, 1.0), 0.85) * 1.2; // ночью — канал низкой освещённости
          c = mix(day, nv, uNight);
          c += (rnd(vUv * 640.0) - 0.5) * 0.04;                    // шум матрицы
          c *= mix(0.72, 1.0, smoothstep(0.85, 0.3, length(vUv - 0.5)));
          c = mix(c, vec3(rnd(vUv * 300.0)) * 0.6, uLost);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      depthTest: false, depthWrite: false,
    });
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
    const box = document.createElement('div'); box.className = 'dronebox';
    box.innerHTML = '<canvas></canvas><div class="dvx"></div><div class="dvtop"></div><div class="dvbot"></div><div class="dvlost">НЕТ СИГНАЛА</div>';
    this.hud.root.appendChild(box);
    this.dv = { rt, mat, scene, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), box, cv: box.querySelector('canvas'), top: box.querySelector('.dvtop'), bot: box.querySelector('.dvbot'), lost: box.querySelector('.dvlost'), frame: 0, L };
    return this.dv;
  }

  _droneRT(fogD) {
    const dv = this._dvInit(), d = this.myDrone, r = this.renderer;
    const L = this._dvLayout();
    if (L.w !== dv.L.w) { const pr = Math.min(1.5, r.getPixelRatio()); dv.rt.setSize(Math.round(L.w * pr), Math.round(L.h * pr)); dv.L = L; }
    dv.mat.uniforms.uTime.value = this.time % 100;
    dv.mat.uniforms.uLost.value = d.alive ? 0 : 1;
    if (!d.alive) return;
    // кадр камеры — через раз (на высоком качестве каждый кадр)
    if (dv.ready && this.settings.quality !== 'high' && (dv.frame++ & 1)) return;
    const cam = d.cam;
    cam.aspect = L.w / L.h; cam.updateProjectionMatrix();
    this.world.cullStatic(cam.position, fogD);
    const sky = this.lights.sky.mesh, skyPos = sky.position.clone();
    sky.position.copy(cam.position);
    const fxU = [this.fx.smoke.uniforms, this.fx.glow.uniforms].map((u) => [u, u.uScale.value]);
    for (const [u] of fxU) u.uScale.value = (dv.rt.height / 2) / Math.tan((cam.fov * Math.PI) / 360);
    d.mesh.visible = false;
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(dv.rt); r.clear(); r.render(this.scene, cam); r.setRenderTarget(null);
    r.shadowMap.autoUpdate = true;
    d.mesh.visible = true;
    sky.position.copy(skyPos);
    for (const [u, v] of fxU) u.uScale.value = v;
    dv.ready = true;
  }

  _droneBlit() {
    const dv = this.dv, r = this.renderer, L = this._dvLayout();
    const y = L.H - L.top - L.h;
    const ac = r.autoClear;
    r.setRenderTarget(null);
    r.autoClear = false;
    r.setScissorTest(true); r.setScissor(L.x, y, L.w, L.h); r.setViewport(L.x, y, L.w, L.h);
    r.render(dv.scene, dv.cam);
    r.setScissorTest(false); r.setViewport(0, 0, L.W, L.H);
    r.autoClear = ac;
  }

  // рамка, подписи, рамки на замеченных целях
  _droneOverlay(on) {
    const dv = this.dv;
    const feed = this.net && this.net.el && this.net.el.feed;
    if (!on) { if (dv && dv.box.style.display !== 'none') { dv.box.style.display = 'none'; if (feed) feed.style.top = ''; } return; }
    const L = this._dvLayout(), d = this.myDrone, cam = d.cam;
    dv.box.style.cssText = `display:block;left:${L.x - 2}px;top:${L.top - 2}px;width:${L.w}px;height:${L.h}px`;
    if (feed) feed.style.top = `${L.top + L.h + 34}px`;
    dv.lost.style.display = d.alive ? 'none' : 'flex';
    const cv = dv.cv;
    if (cv.width !== L.w || cv.height !== L.h) { cv.width = L.w; cv.height = L.h; }
    const g = cv.getContext('2d');
    g.clearRect(0, 0, L.w, L.h);
    const P = this.player.body.pos;
    const distC = Math.round(Math.hypot(d.center.x - P.x, d.center.z - P.z));
    const agl = Math.round(d.pos.y - this.terrain.heightAt(d.pos.x, d.pos.z));
    const gx = Math.round(61000 - d.center.z), gy = Math.round(34000 + d.center.x);
    const top = `${d.name} · ВЫС ${agl} м · ${d.alive ? (d.low ? 'облёт низко' : 'облёт высоко') : 'потеря связи'}`;
    const bot = `ЦЕНТР X ${gx.toLocaleString('ru')} Y ${gy.toLocaleString('ru')} · Д ${distC} м · <b>U</b> точка · <b>Shift+U</b> высота · <b>Y</b> скрыть`;
    if (dv._t !== top) { dv.top.textContent = top; dv._t = top; }
    if (dv._b !== bot) { dv.bot.innerHTML = bot; dv._b = bot; }
    if (!d.alive) return;
    // цели, замеченные камерой за последние 1,5 с
    const v = new THREE.Vector3();
    g.lineWidth = 1.5; g.font = 'bold 11px Arial';
    for (const [t, ts] of d.seen) {
      if (!t.alive || this.time - ts > 1.5) continue;
      v.copy(t.isVehicle ? t.pos : (t.chest || t.pos)).project(cam);
      if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) continue;
      const x = (v.x * 0.5 + 0.5) * L.w, y = (-v.y * 0.5 + 0.5) * L.h;
      const s = t.isVehicle ? 12 : 7;
      g.strokeStyle = '#ff3a2a';
      g.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { g.moveTo(x + sx * s, y + sy * s * 0.4); g.lineTo(x + sx * s, y + sy * s); g.lineTo(x + sx * s * 0.4, y + sy * s); }
      g.stroke();
    }
    // отметки целей своей стороны
    g.fillStyle = '#ffb030';
    for (const mk of this.teamMarks()) {
      v.copy(mk.pos).project(cam);
      if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) continue;
      g.fillText(mk.short, (v.x * 0.5 + 0.5) * L.w + 9, (-v.y * 0.5 + 0.5) * L.h - 6);
    }
  }

  scopeFov(sc) {
    // кружок окуляра занимает 92% высоты экрана = истинное поле зрения прицела
    const t = Math.tan((sc.fov * Math.PI) / 360) / 0.92;
    return (2 * Math.atan(t) * 180) / Math.PI;
  }

  render() {
    this.renderer.shadowMap.autoUpdate = true;
    let fogD = this.scene.fog && this.scene.fog.density > 0 ? 2.0 / this.scene.fog.density : 1e9;
    if (this.wideMap) fogD = Math.min(fogD, this.settings.quality === 'low' ? 3500 : 6000);
    const dvOn = this._droneViewOn();
    if (dvOn) this._droneRT(fogD);
    this.world.cullStatic(this.camera.position, fogD);
    this.app.post.render(this.scene, this.camera, this.vmVisible ? this.vmScene : null, this.vmCamera, 1 / 60);
    this._droneOverlay(dvOn);
    if (dvOn) this._droneBlit();
    const hc = this.hitcam;
    if (hc && hc.proj && (hc.on || (hc.shellCam && hc.proj.ammo.kind === 'shell'))) {
      const r = this.renderer;
      const W = innerWidth, H = innerHeight;
      const big = hc.proj.ammo.kind === 'shell';
      const w = Math.round(big ? Math.min(620, W * 0.4) : Math.min(420, W * 0.3)), h = Math.round(w / 1.5);
      const x = W - w - 18, y = big ? H - h - 96 : H - h - 200;
      hc.box.style.cssText = `display:block;left:${x - 2}px;top:${H - y - h - 2}px;width:${w}px;height:${h}px`;
      hc.cam.aspect = w / h; hc.cam.updateProjectionMatrix();
      const fog = this.scene.fog; this.scene.fog = null;
      // небесная сфера — вокруг камеры врезки (снаряд может быть за километры от игрока)
      const sky = this.lights.sky.mesh, skyPos = sky.position.clone();
      sky.position.copy(hc.cam.position);
      // размер частиц — по полю зрения врезки, а не основной камеры (в оптике она узкая)
      const fxU = [this.fx.smoke.uniforms, this.fx.glow.uniforms].map((u) => [u, u.uScale.value, u.uFogDensity.value]);
      for (const [u] of fxU) { u.uScale.value = h / 2 / Math.tan((hc.cam.fov * Math.PI) / 360); u.uFogDensity.value = 0; }
      r.setScissorTest(true); r.setScissor(x, y, w, h); r.setViewport(x, y, w, h);
      r.autoClear = true;
      this.world.cullStatic(hc.cam.position, 3000);
      r.shadowMap.autoUpdate = false; // тени уже посчитаны основным кадром
      r.render(this.scene, hc.cam);
      r.shadowMap.autoUpdate = true;
      r.setScissorTest(false); r.setViewport(0, 0, W, H);
      sky.position.copy(skyPos);
      for (const [u, sc, fd] of fxU) { u.uScale.value = sc; u.uFogDensity.value = fd; }
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
    for (const d of this.drones || []) d.dispose();
    if (this.dv) { this.dv.rt.dispose(); this.dv.box.remove(); }
    if (this.net) this.net.dispose();
    if (this.hitcam) this.hitcam.box.remove();
    for (const h of this.guns || []) if (h.ui) { h.ui.panel.remove(); h.ui.ret.remove(); }
    this.hud.root.classList.remove('gunner');
    this.audio.stopAllEngines();
    this.projectiles.clear();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) m.dispose(); }
    });
    this.renderer.renderLists.dispose();
  }
}
