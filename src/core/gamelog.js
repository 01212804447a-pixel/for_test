// Журнал игры и зависаний — для разбора тормозов и ошибок (Настройки → «Журнал игры и
// зависаний», по умолчанию выключен; выключенный журнал ничего не делает и не стоит ни такта).
//
// Что пишется (каждая строка файла — отдельный JSON-объект, поле k — вид записи):
//  • head    — система: браузер, ОС, ядра, память, видеокарта, WebGL, экран, разрешение рендера, сборка;
//  • set     — настройки (при старте и при каждом изменении);
//  • ev      — события: режимы (меню/штаб/задание), загрузка и компиляция шейдеров, этапы,
//              гибель техники, смена вида (пешком/техника/прицел/орудие), сеть, адаптивное разрешение;
//  • s       — раз в секунду: FPS, время кадра (среднее/медиана/95 %/макс), ЦП по участкам кадра,
//              время видеокарты (если браузер даёт таймер), вызовы отрисовки, шейдеры, память,
//              бойцы/техника/снаряды/частицы/звуки, сеть (пинг, трафик, провалы), позиция;
//  • hitch   — каждый рывок ≥ 50 мс: на какие участки ушло время, «вне кадра» (браузер, видеокарта,
//              сборка мусора), новые шейдеры, освобождённая память, последние события до рывка
//              и «длинный кадр» браузера (LoAF) с функциями-виновниками и позициями в game.js;
//  • hang    — зависание > 1 с: его фиксирует отдельный поток (Web Worker), пока главный стоит, —
//              и на каком участке кадра встало; запись попадает на диск, даже если вкладку закрыли;
//  • err     — ошибки и предупреждения со стеком (одинаковые — счётчиком);
//  • mark    — метка игрока (F8: «вот тут лагнуло») с последними 300 кадрами.
// Журнал сохраняется в базу браузера (IndexedDB) каждые 2 с: после вылета или закрытия при
// зависании он доступен при следующем запуске (Настройки → Журналы…). Хранятся 10 последних сессий.
import { BUILD } from '../version.js';

const HITCH_MS = 50;
const KEEP = 10;

// Сторожевой поток: принимает «пульс» главного потока (фаза кадра), пишет журнал в IndexedDB
const WORKER = `
let db = null, dbp = null, sid = '', t0 = 0, seq = 0, meta = null, lastHb = 0, ph = '', crumb = '', hidden = false, hang = null;
const now = () => Date.now();
function open() {
  return new Promise((res) => {
    try {
      const r = indexedDB.open('negs-log', 1);
      r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('chunks')) d.createObjectStore('chunks', { keyPath: ['sid', 'seq'] }); if (!d.objectStoreNames.contains('sessions')) d.createObjectStore('sessions', { keyPath: 'sid' }); };
      r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null);
    } catch (e) { res(null); }
  });
}
function req(store, mode, fn) {
  return new Promise((res) => {
    if (!db) { res(null); return; }
    try { const t = db.transaction(store, mode); const r = fn(t.objectStore(store)); t.oncomplete = () => res(r ? r.result : true); t.onerror = t.onabort = () => res(null); } catch (e) { res(null); }
  });
}
function put(text) {
  if (!meta) return;
  meta.last = now();
  if (!db) return;
  try {
    const t = db.transaction(['chunks', 'sessions'], 'readwrite');
    if (text) { meta.size = (meta.size || 0) + text.length; t.objectStore('chunks').put({ sid, seq: seq++, text }); }
    t.objectStore('sessions').put(meta);
  } catch (e) {}
}
function line(o) {
  o.t = +((now() - t0) / 1000).toFixed(3);
  const s = JSON.stringify(o);
  postMessage({ t: 'wline', line: s });
  put(s + '\\n');
}
const range = (s) => IDBKeyRange.bound([s, -Infinity], [s, Infinity]);
async function list() { const a = (await req('sessions', 'readonly', (s) => s.getAll())) || []; return a.sort((x, y) => y.start - x.start); }
async function read(s) { const a = (await req('chunks', 'readonly', (st) => st.getAll(range(s)))) || []; a.sort((x, y) => x.seq - y.seq); return a.map((c) => c.text).join(''); }
async function drop(s) { await req('chunks', 'readwrite', (st) => st.delete(range(s))); await req('sessions', 'readwrite', (st) => st.delete(s)); }
async function prune(keep) { const a = await list(); let n = 0, size = 0; for (const m of a) { if (m.sid === sid) continue; n++; size += m.size || 0; if (n >= keep || size > 150e6) await drop(m.sid); } }
setInterval(() => {
  if (!lastHb || hidden || !meta) return;
  const d = now() - lastHb;
  if (!hang && d > 1000) { hang = { st: lastHb, ph, crumb, n: 0 }; meta.hangOpen = true; line({ k: 'hang', st: 'start', ph, crumb, ms: d }); }
  else if (hang && d > 3000 * (hang.n + 1)) { hang.n++; line({ k: 'hang', st: 'still', ph: hang.ph, ms: d }); }
}, 250);
onmessage = async (e) => {
  const m = e.data;
  if (m.t === 'hb') {
    lastHb = now();
    if (hang) { const ms = lastHb - hang.st; meta.hangs = (meta.hangs || 0) + 1; meta.hangOpen = false; line({ k: 'hang', st: 'end', ms, ph: hang.ph, crumb: hang.crumb }); hang = null; }
    ph = m.ph; if (m.c) crumb = m.c;
    return;
  }
  if (m.t === 'vis') { hidden = m.hidden; lastHb = now(); return; }
  if (m.t === 'init') { sid = m.sid; t0 = m.t0; meta = m.meta; dbp = open().then(async (d) => { db = d; if (db) { await prune(${KEEP}); put(''); } }); await dbp; postMessage({ t: 'ready', db: !!db, sessions: await list() }); return; }
  if (!dbp) dbp = open().then((d) => { db = d; }); // только чтение (журнал выключен)
  await dbp;
  if (m.t === 'lines') { if (m.meta) Object.assign(meta, m.meta); put(m.text); }
  else if (m.t === 'close') { lastHb = 0; hang = null; if (meta) { meta.closed = true; put(''); } }
  else if (m.t === 'list') postMessage({ t: 'reply', id: m.id, data: await list() });
  else if (m.t === 'read') postMessage({ t: 'reply', id: m.id, data: await read(m.sid) });
  else if (m.t === 'clear') { for (const x of await list()) if (x.sid !== sid) await drop(x.sid); postMessage({ t: 'reply', id: m.id, data: true }); }
};
`;

const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;

// Краткое описание того, что сейчас на экране у игрока (для привязки замеров к ситуации)
function viewOf(app) {
  if (app.mode !== 'mission' || !app.mission) return app.mode;
  const m = app.mission, p = m.player;
  let s;
  if (!p) s = '?';
  else if (p.gun) s = 'орудие:' + (p.gun.kind || 'd30') + '/' + (p.gun.view || '');
  else if (p.vehicle) s = 'техника:' + (p.vehicle.type.id || '') + '/' + p.seat + (p.vehicle.tank && p.seat === 2 ? '/' + (p.vehicle.tank.hatch ? 'люк' : p.vehicle.tank.view) : '');
  else s = 'пешком' + (m.scopeDraw ? '/оптика' : '');
  if (m.mapVisible) s += '+карта';
  if (m.droneView) s += '+дрон';
  if (m.hitcam && m.hitcam.on) s += '+врезка';
  if (app.paused) s += '+пауза';
  return s;
}

class GameLog {
  constructor() {
    this.on = false;
    this.lines = []; this.size = 0;
    this.sec = {}; this._t = 0;
    this.crumbs = [];
    this.cnt = {};
    this.errs = new Map();
    this.frames = new Float32Array(300); this.fi = 0; // последние 300 интервалов кадров
    this.saved = []; // сессии в базе браузера
    this._rid = 0; this._wait = new Map();
  }

  // ---------------------------------------------------------------- включение / выключение
  start(app) {
    if (this.on) return;
    this.app = app; this.on = true;
    const d = new Date();
    this.t0 = Date.now(); this.p0 = performance.now();
    this.sid = stamp(d).replace(/[-_]/g, '') + '-' + Math.random().toString(36).slice(2, 5);
    this.lines = []; this.size = 0; this.cnt = {}; this.errs.clear(); this.crumbs = [];
    this.meta = { sid: this.sid, start: this.t0, last: this.t0, build: BUILD, title: '', hitches: 0, hangs: 0, errors: 0, size: 0, closed: false, hangOpen: false };
    this._places = new Set();
    this.agg = this._newAgg(); this._aggT = performance.now(); this._flushT = performance.now();
    this.cur = this._newFrame(); this.prev = this._newFrame();
    this.pend = []; this.loaf = []; this._hitchN = 0; this._hitchSkip = 0;
    this._view = ''; this._mode = '';
    const R = app.renderer;
    this._autoReset = R.info.autoReset; R.info.autoReset = false;
    this._np = R.info.programs ? R.info.programs.length : 0;
    this._startWorker();
    this._hook();
    this._gpuInit();
    this.write({ k: 'head', legend: 'Журнал N.E.G.S. t — секунды от начала сессии. s — сводка за секунду, hitch — рывок, hang — зависание, ev — событие, err — ошибка, mark — метка F8. sec — мс на кадр по участкам: обн.* — обновление мира, рис.* — отрисовка; gap — время вне кадра (браузер, ожидание видеокарты, сборка мусора; outside — наша работа между кадрами: загрузка, сеть). heap — грубо (браузер округляет).', sid: this.sid, date: d.toString().replace(/\s*\(.*\)$/, ''), build: BUILD, sys: this._sys() });
    this.settings(app.settings, true);
    try {
      if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
        navigator.userAgentData.getHighEntropyValues(['platformVersion', 'architecture', 'fullVersionList', 'model']).then((h) => this.ev('система', { platformVersion: h.platformVersion, arch: h.architecture, browsers: (h.fullVersionList || []).map((b) => b.brand + ' ' + b.version).join(', ') }));
      }
    } catch {}
    this.ev('журнал включён', { mode: app.mode });
  }

  stop() {
    if (!this.on) return;
    this.ev('журнал выключен');
    this._flush(true);
    this.on = false;
    try { this.app.renderer.info.autoReset = this._autoReset; } catch {}
    this._unhook();
    if (this.w) { const w = this.w; this.w = null; w.postMessage({ t: 'close' }); setTimeout(() => w.terminate(), 3000); }
    try { localStorage.setItem('negs-log-closed', this.sid); } catch {}
  }

  // ---------------------------------------------------------------- запись
  write(o) {
    if (!this.on) return;
    if (o.t === undefined) o.t = r2((performance.now() - this.p0) / 1000);
    let s;
    try { s = JSON.stringify(o); } catch (e) { s = JSON.stringify({ k: 'err', t: o.t, msg: 'не удалось записать ' + o.k }); }
    this._push(s);
    this._out = (this._out || '') + s + '\n';
  }
  _push(s) {
    if (this.size > 60e6 && !/"k":"(head|hang|err|ev|mark)"/.test(s.slice(0, 20))) return; // предел памяти: ~60 МБ
    this.lines.push(s); this.size += s.length + 1;
  }
  ev(name, data) { if (this.on) { this.write({ k: 'ev', e: name, ...(data || {}) }); this.crumb(name); } }
  crumb(s) {
    if (!this.on) return;
    this.crumbs.push({ t: performance.now(), s });
    if (this.crumbs.length > 40) this.crumbs.shift();
    this._crumbOut = s;
  }
  count(name, n = 1) { if (this.on) this.cnt[name] = (this.cnt[name] || 0) + n; }
  settings(st, force = false) {
    if (!this.on) return;
    const s = JSON.stringify(st);
    if (!force && s === this._set) return;
    this._set = s;
    this.write({ k: 'set', settings: JSON.parse(s) });
  }
  place(name) { if (this.on && name && !this._places.has(name)) { this._places.add(name); this.meta.title = [...this._places].join(', ').slice(0, 200); } }

  // фаза для сторожевого потока: на чём встанет главный поток, если зависнет
  phase(p) {
    if (!this.on) return;
    if (p !== 'u' && p !== 'r') {
      // работа между кадрами (загрузка, сетевые сообщения): на чей счёт пойдёт время «вне кадра»
      const now = performance.now();
      if (this._oph) { const O = this.cur.out || (this.cur.out = {}); O[this._oph] = (O[this._oph] || 0) + now - this._ot; }
      this._oph = p === 'i' ? null : p; this._ot = now;
    }
    if (p === 'r') {
      this.mark('обн.прочее');
      const C = this.cur;
      C.rs = performance.now(); C.upd = C.rs - C.fs;
      this._gpuBegin();
    }
    this._hb(p);
  }
  _hb(p) {
    if (!this.w) return;
    const m = { t: 'hb', ph: p };
    if (this._crumbOut) { m.c = this._crumbOut; this._crumbOut = null; }
    this.w.postMessage(m);
  }

  // участок кадра: время с прошлой метки — на счёт участка name
  mark(name) {
    if (!this.on) return;
    const t = performance.now();
    const S = this.cur.sec;
    S[name] = (S[name] || 0) + (t - this._t);
    this._t = t;
  }

  // самый долгий объект кадра (боец и т. п.): в рывке видно, кто именно
  slowest(kind, ms, obj) {
    if (!this.on || ms < 2) return;
    const C = this.cur;
    if (ms > (C.slowMs || 0)) {
      C.slowMs = ms;
      let d = kind;
      try { if (obj) d += ` «${obj.name || ''}» ${obj.team || ''} ${obj.alive === false ? 'мёртв' : ''} ии:${obj.brain ? obj.brain.state || '' : 'нет'} ${obj.vehicle ? 'в технике' : ''} @${Math.round(obj.pos.x)},${Math.round(obj.pos.z)}`; } catch {}
      C.slow = d;
    }
  }

  // ---------------------------------------------------------------- кадр
  _newFrame() { return { f: 0, fs: 0, rs: 0, upd: 0, rnd: 0, end: 0, sec: {}, calls: 0, tris: 0, prog: 0, progNames: null, heap0: 0, heap1: 0, view: '', gpu: -1 }; }

  frameBegin() {
    if (!this.on) return;
    const now = performance.now();
    const app = this.app, R = app.renderer;
    let C = this.cur;
    if (this._oph) { const O = C.out || (C.out = {}); O[this._oph] = (O[this._oph] || 0) + now - this._ot; this._oph = null; }
    if (C.fs && !C.end) { this._gpuEnd(); C.end = now; C.rnd = C.rs ? now - C.rs : 0; C.err = true; } // кадр оборвался ошибкой
    if (C.fs) {
      const iv = now - C.fs;
      const heapNow = this._heap();
      this.frames[this.fi++ % 300] = iv;
      if (!this._skip) {
        this._agg(iv, C);
        if (iv >= HITCH_MS) this._hitch(iv, C, now, heapNow);
      }
      // две записи кадра по очереди: законченный кадр — в prev, текущая очищается
      const P = this.prev; this.prev = C; this.cur = C = P;
    }
    this._skip = document.hidden;
    C.f = (this._fno = (this._fno || 0) + 1);
    C.fs = now; C.rs = 0; C.end = 0; C.upd = 0; C.rnd = 0; C.err = false; C.gpu = -1; C.slowMs = 0; C.slow = ''; C.out = null;
    for (const k in C.sec) C.sec[k] = 0;
    C.heap0 = this._heap();
    this._t = now;
    try { R.info.reset(); } catch {}
    if (app.mode !== this._mode) { const was = this._mode; this._mode = app.mode; if (was) this.ev('режим', { from: was, to: app.mode }); }
    this._gpuPoll();
    this._hb('u');
  }

  frameEnd() {
    if (!this.on) return;
    const C = this.cur, R = this.app.renderer;
    if (!C.rs) { this.mark('обн.прочее'); C.rs = performance.now(); C.upd = C.rs - C.fs; }
    this.mark('рис.прочее');
    const now = performance.now();
    C.end = now; C.rnd = now - C.rs;
    this._gpuEnd();
    const info = R.info;
    C.calls = info.render.calls; C.tris = info.render.triangles;
    const P = info.programs || [];
    if (P.length > this._np) {
      C.prog = P.length - this._np;
      C.progNames = P.slice(this._np, this._np + 8).map((p) => (p.type || '?') + (p.name ? ':' + p.name : ''));
      this.crumb('новые шейдеры: ' + C.prog);
    } else { C.prog = 0; C.progNames = null; }
    this._np = P.length;
    C.heap1 = this._heap();
    const v = viewOf(this.app);
    if (v !== this._view) { const was = this._view; this._view = v; if (was) this.ev('вид', { v }); }
    C.view = v;
    if (now - this._aggT >= 1000) this._sample(now);
    if (now - this._flushT >= 2000) this._flush();
    this._emitPending(false);
    this._hb('i');
  }

  _heap() { const m = performance.memory; return m ? m.usedJSHeapSize : 0; }

  // ---------------------------------------------------------------- секундная сводка
  _newAgg() { return { n: 0, iv: [], upd: 0, rnd: 0, sec: {}, calls: 0, tris: 0, gpu: 0, gpuN: 0, prog: 0, max: 0, errs: 0 }; }
  _agg(iv, C) {
    const A = this.agg;
    A.n++; A.iv.push(iv); A.upd += C.upd; A.rnd += C.rnd; A.calls += C.calls; A.tris += C.tris; A.prog += C.prog;
    if (iv > A.max) A.max = iv;
    for (const k in C.sec) if (C.sec[k]) A.sec[k] = (A.sec[k] || 0) + C.sec[k];
  }
  _sample(now) {
    const A = this.agg, app = this.app;
    this._aggT = now;
    if (!A.n) { this.agg = this._newAgg(); return; }
    const iv = A.iv.sort((a, b) => a - b), n = A.n;
    const avg = iv.reduce((a, b) => a + b, 0) / n;
    const sec = {};
    for (const k in A.sec) { const v = A.sec[k] / n; if (v >= 0.05) sec[k] = r2(v); }
    const R = app.renderer, mem = R.info.memory;
    const o = {
      k: 's', mode: app.mode, v: this._view,
      fps: r1(1000 / avg), ft: [r1(avg), r1(iv[n >> 1]), r1(iv[Math.min(n - 1, Math.floor(n * 0.95))]), r1(A.max)],
      cpu: [r2(A.upd / n), r2(A.rnd / n)], sec,
      calls: Math.round(A.calls / n), tris: Math.round(A.tris / n / 1000), prog: R.info.programs ? R.info.programs.length : 0, geo: mem.geometries, tex: mem.textures,
      pr: r2(R.getPixelRatio()), dyn: app.perf ? r2(app.perf.scale) : 1,
    };
    if (A.gpuN) o.gpu = r2(A.gpu / A.gpuN);
    const pm = performance.memory;
    if (pm) o.heap = Math.round(pm.usedJSHeapSize / 1048576);
    if (A.prog) o.newProg = A.prog;
    if (this._hitchN) { o.hitches = this._hitchN; this._hitchN = 0; }
    if (this._hitchSkip) { o.hitchSkip = this._hitchSkip; this._hitchSkip = 0; }
    if (this._loafN) { o.loaf = this._loafN; o.loafMs = Math.round(this._loafMs); this._loafN = 0; this._loafMs = 0; }
    const c = this.cnt; if (Object.keys(c).length) { o.cnt = c; this.cnt = {}; }
    const m = app.mode === 'mission' && app.mission;
    if (m) {
      try {
        const sold = m.soldiers || [];
        let alive = 0; for (const s of sold) if (s.alive) alive++;
        o.ents = {
          sold: sold.length, alive, veh: (m.vehicles || []).length, guns: (m.guns || []).length,
          proj: m.projectiles ? m.projectiles.list.length : 0, gren: m.projectiles ? m.projectiles.grenades.length : 0,
          parts: m.fx ? (m.fx.smoke ? m.fx.smoke.n : 0) + (m.fx.glow ? m.fx.glow.n : 0) : 0,
          voices: app.audio && app.audio._voices ? app.audio._voices.length : 0,
        };
        if (!this._objT || now - this._objT > 30000) { this._objT = now; let objs = 0, auto = 0; m.scene.traverse((x) => { objs++; if (x.matrixWorldAutoUpdate) auto++; }); o.ents.objs = objs; o.ents.auto = auto; }
        const b = m.player && m.player.body;
        if (b) o.pos = [Math.round(b.pos.x), Math.round(b.pos.z)];
        o.mt = r1(m.time || 0);
        if (m.stageIdx !== undefined) o.stage = m.stageIdx;
      } catch (e) { o.entsErr = String(e.message || e); }
      if (m.net) o.net = this._netSample(m.net);
    }
    this.write(o);
    this.agg = this._newAgg();
  }
  _netSample(ses) {
    const nc = this.app.net, o = {};
    try {
      if (nc) {
        o.rtt = Math.round(nc.rtt || 0);
        const st = nc.stat;
        if (st) { o.inKB = r1(st.inB / 1024); o.outKB = r1(st.outB / 1024); o.inN = st.inN; o.outN = st.outN; o.gap = Math.round(st.gap); if (st.sl !== undefined) o.srvLag = st.sl; nc.stat = { inB: 0, outB: 0, inN: 0, outN: 0, gap: 0, lastIn: st.lastIn, sl: st.sl }; }
        o.conn = !!nc.connected;
      }
      o.host = !!ses.isHost;
      if (ses.peers) o.peers = ses.peers.size !== undefined ? ses.peers.size : Object.keys(ses.peers).length;
    } catch {}
    return o;
  }

  // ---------------------------------------------------------------- рывки
  _hitch(iv, C, now, heapNow) {
    this.meta.hitches++;
    // не чаще 10 записей в секунду и при устойчиво низком FPS — только заметно выбивающиеся кадры
    const A = this.agg, med = A.iv.length > 5 ? A.iv.slice().sort((a, b) => a - b)[A.iv.length >> 1] : 16;
    if ((iv < 100 && iv < med * 2) || this._hitchN >= 10) { this._hitchSkip++; return; }
    this._hitchN++;
    const top = Object.entries(C.sec).filter(([, v]) => v >= 0.5).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => [k, r1(v)]);
    const h = {
      k: 'hitch', t: r2((C.fs - this.p0) / 1000), ms: r1(iv), upd: r1(C.upd), rnd: r1(C.rnd), gap: r1(iv - C.upd - C.rnd),
      top, calls: C.calls, tris: Math.round(C.tris / 1000), v: C.view, mode: this.app.mode,
    };
    if (C.err) h.err = true;
    if (C.slowMs >= 3) h.slowest = `${r1(C.slowMs)} мс ${C.slow}`;
    if (C.out) { const o = Object.entries(C.out).filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, r1(v)]); if (o.length) h.outside = o.slice(0, 5); }
    if (C.prog) { h.prog = C.prog; h.progNames = C.progNames; }
    if (C.heap0 && C.heap1) {
      const inFrame = (C.heap0 - C.heap1) / 1048576, after = (C.heap1 - heapNow) / 1048576;
      if (inFrame > 2) h.gcIn = r1(inFrame);
      if (after > 2) h.gcGap = r1(after);
      h.heap = Math.round(C.heap1 / 1048576);
    }
    const cr = this.crumbs.filter((c) => c.t > C.fs - 3000).map((c) => `${r1((c.t - C.fs) / 1000)}с ${c.s}`);
    if (cr.length) h.before = cr.slice(-8);
    if (iv > 1000) h.hang = true;
    h._fs = C.fs; h._end = now; h._f = C.f; h._due = now + 1200;
    this.pend.push(h);
  }
  // ждём «длинный кадр» браузера и таймер видеокарты, потом пишем
  _emitPending(all) {
    const now = performance.now();
    while (this.pend.length && (all || this.pend[0]._due < now)) {
      const h = this.pend.shift();
      const L = this.loaf.filter((e) => e.startTime < h._end && e.startTime + e.duration > h._fs);
      if (L.length) h.loaf = L.slice(0, 3).map((e) => this._loafInfo(e));
      const g = this._gpuOf(h._f);
      if (g >= 0) h.gpu = r1(g);
      delete h._fs; delete h._end; delete h._f; delete h._due;
      this.write(h);
    }
    if (this.loaf.length > 60) this.loaf.splice(0, this.loaf.length - 60);
  }
  _loafInfo(e) {
    const o = { ms: Math.round(e.duration), block: Math.round(e.blockingDuration || 0) };
    if (e.renderStart) o.render = Math.round(e.startTime + e.duration - e.renderStart);
    if (e.styleAndLayoutStart) o.layout = Math.round(e.startTime + e.duration - e.styleAndLayoutStart);
    const S = (e.scripts || []).slice().sort((a, b) => b.duration - a.duration).slice(0, 4);
    if (S.length) o.scripts = S.map((s) => ({ ms: Math.round(s.duration), inv: s.invoker, type: s.invokerType, fn: s.sourceFunctionName, src: (s.sourceURL || '').split('/').pop() + ':' + s.sourceCharPosition, pause: Math.round(s.pauseDuration || 0), forced: Math.round(s.forcedStyleAndLayoutDuration || 0) }));
    return o;
  }

  // ---------------------------------------------------------------- таймер видеокарты
  _gpuInit() {
    this._tq = null;
    try {
      const gl = this.app.renderer.getContext();
      const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      if (ext) this._tq = { gl, ext, free: [], wait: [], on: null, res: new Map() };
    } catch {}
  }
  _gpuBegin() {
    const T = this._tq;
    if (!T || T.on) return;
    try { const q = T.free.pop() || T.gl.createQuery(); T.gl.beginQuery(T.ext.TIME_ELAPSED_EXT, q); T.on = { q, f: this.cur.f }; } catch { this._tq = null; }
  }
  _gpuEnd() {
    const T = this._tq;
    if (!T || !T.on) return;
    try { T.gl.endQuery(T.ext.TIME_ELAPSED_EXT); T.wait.push(T.on); } catch { this._tq = null; }
    T.on = null;
  }
  _gpuPoll() {
    const T = this._tq;
    if (!T) return;
    const gl = T.gl;
    try {
      while (T.wait.length) {
        const w = T.wait[0];
        if (!gl.getQueryParameter(w.q, gl.QUERY_RESULT_AVAILABLE)) break;
        T.wait.shift();
        const disjoint = gl.getParameter(T.ext.GPU_DISJOINT_EXT);
        if (!disjoint) {
          const ms = gl.getQueryParameter(w.q, gl.QUERY_RESULT) / 1e6;
          this.agg.gpu += ms; this.agg.gpuN++;
          T.res.set(w.f, ms);
          if (T.res.size > 200) T.res.delete(T.res.keys().next().value);
        }
        T.free.push(w.q);
      }
      if (T.wait.length > 20) T.wait.splice(0, T.wait.length - 20);
    } catch { this._tq = null; }
  }
  _gpuOf(f) { const T = this._tq; return T && T.res.has(f) ? T.res.get(f) : -1; }

  // ---------------------------------------------------------------- система
  _sys() {
    const R = this.app.renderer, gl = R.getContext();
    const o = { ua: navigator.userAgent, cores: navigator.hardwareConcurrency, memGB: navigator.deviceMemory, lang: navigator.language };
    try {
      const x = gl.getExtension('WEBGL_debug_renderer_info');
      if (x) { o.gpu = gl.getParameter(x.UNMASKED_RENDERER_WEBGL); o.gpuVendor = gl.getParameter(x.UNMASKED_VENDOR_WEBGL); }
      o.gl = gl.getParameter(gl.VERSION); o.glsl = gl.getParameter(gl.SHADING_LANGUAGE_VERSION);
      o.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE); o.maxSamples = gl.getParameter(gl.MAX_SAMPLES);
      o.parallelCompile = !!gl.getExtension('KHR_parallel_shader_compile');
      o.gpuTimer = !!this._tq || !!gl.getExtension('EXT_disjoint_timer_query_webgl2');
      const ca = gl.getContextAttributes(); o.ctx = { aa: ca.antialias, pp: ca.powerPreference };
    } catch {}
    o.screen = [screen.width, screen.height]; o.win = [innerWidth, innerHeight]; o.dpr = devicePixelRatio;
    o.pr = R.getPixelRatio(); o.canvas = [R.domElement.width, R.domElement.height];
    const pm = performance.memory; if (pm) o.heapLimitMB = Math.round(pm.jsHeapSizeLimit / 1048576);
    const l = location; o.where = l.protocol === 'file:' ? 'файл' : /claude/.test(l.hostname) ? 'артефакт' : l.protocol + ' сервер';
    o.loaf = typeof PerformanceObserver !== 'undefined' && (PerformanceObserver.supportedEntryTypes || []).includes('long-animation-frame');
    return o;
  }

  // ---------------------------------------------------------------- ошибки и наблюдатели
  err(kind, msg, stack, where) {
    if (!this.on) return;
    msg = String(msg || '').slice(0, kind === 'console' ? 2000 : 600);
    const key = kind + '|' + msg.slice(0, 160);
    const n = (this.errs.get(key) || 0) + 1;
    this.errs.set(key, n);
    if (kind !== 'warn') this.meta.errors++;
    if (n <= 3 || n === 10 || n === 100 || n % 1000 === 0) this.write({ k: 'err', kind, n, msg, stack: stack ? String(stack).split('\n').slice(0, 10).join('\n') : undefined, where, v: this._view, mode: this.app.mode });
  }
  _hook() {
    const H = this._hooks = [];
    const on = (t, type, fn, opt) => { t.addEventListener(type, fn, opt); H.push(() => t.removeEventListener(type, fn, opt)); };
    on(window, 'error', (e) => {
      if (e.target && e.target !== window && (e.target.src || e.target.href)) this.err('resource', 'не загрузился ' + (e.target.tagName || '') + ' ' + String(e.target.src || e.target.href).slice(0, 200));
      else this.err('error', e.message, e.error && e.error.stack, `${String(e.filename || '').split('/').pop()}:${e.lineno}:${e.colno}`);
    }, true);
    on(window, 'unhandledrejection', (e) => { const r = e.reason; this.err('promise', r && r.message ? r.message : String(r), r && r.stack); });
    on(document, 'visibilitychange', () => { this.ev(document.hidden ? 'вкладка скрыта' : 'вкладка видна'); if (this.w) this.w.postMessage({ t: 'vis', hidden: document.hidden }); if (document.hidden) this._flush(); this._skip = true; });
    on(window, 'blur', () => this.ev('окно без фокуса'));
    on(window, 'focus', () => this.ev('окно в фокусе'));
    on(window, 'resize', () => this.ev('размер окна', { win: [innerWidth, innerHeight], dpr: devicePixelRatio }));
    on(document, 'pointerlockchange', () => this.crumb(document.pointerLockElement ? 'мышь захвачена' : 'мышь отпущена'));
    on(document, 'fullscreenchange', () => this.ev(document.fullscreenElement ? 'полный экран' : 'оконный режим'));
    const cv = this.app.renderer.domElement;
    on(cv, 'webglcontextlost', () => { this.ev('ПОТЕРЯН КОНТЕКСТ WebGL (сброс драйвера видеокарты)'); this._flush(); });
    on(cv, 'webglcontextrestored', () => this.ev('контекст WebGL восстановлен'));
    on(window, 'pagehide', () => { this.ev('страница закрывается'); this._flush(true); try { localStorage.setItem('negs-log-closed', this.sid); } catch {} });
    // console.error / console.warn
    const ce = console.error, cw = console.warn;
    console.error = (...a) => { try { this.err('console', a.map((x) => (x && x.message) || String(x)).join(' '), a.find((x) => x && x.stack)?.stack || new Error().stack); } catch {} ce.apply(console, a); };
    console.warn = (...a) => { try { this.err('warn', a.map((x) => String(x)).join(' '), a.find((x) => x && x.stack)?.stack); } catch {} cw.apply(console, a); };
    H.push(() => { console.error = ce; console.warn = cw; });
    // «длинные кадры» браузера (Chrome 123+): какие функции заняли время
    this._loafN = 0; this._loafMs = 0;
    try {
      const types = PerformanceObserver.supportedEntryTypes || [];
      const type = types.includes('long-animation-frame') ? 'long-animation-frame' : types.includes('longtask') ? 'longtask' : null;
      if (type) {
        const po = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            if (e.duration < 50) continue;
            this.loaf.push(e); this._loafN++; this._loafMs += e.duration;
          }
        });
        po.observe({ type, buffered: false });
        H.push(() => po.disconnect());
      }
    } catch {}
  }
  _unhook() { for (const f of this._hooks || []) { try { f(); } catch {} } this._hooks = []; }

  // ---------------------------------------------------------------- сторожевой поток и хранение
  _startWorker() {
    this.dbOk = false;
    try {
      const w = this._worker();
      w.postMessage({ t: 'init', sid: this.sid, t0: this.t0, meta: this.meta });
    } catch (e) { this.w = null; this.ev('сторожевой поток не запустился', { msg: String(e.message || e) }); }
  }
  _worker() {
    if (this.w) return this.w;
    const url = URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' }));
    const w = this.w = new Worker(url);
    {
      w.onmessage = (e) => {
        const m = e.data;
        if (m.t === 'wline') { this._push(m.line); if (/"st":"start"/.test(m.line)) this.meta.hangOpen = true; else if (/"st":"end"/.test(m.line)) { this.meta.hangOpen = false; this.meta.hangs++; } }
        else if (m.t === 'ready') { this.dbOk = m.db; this._onSessions(m.sessions || []); }
        else if (m.t === 'reply') { const f = this._wait.get(m.id); if (f) { this._wait.delete(m.id); f(m.data); } }
      };
      w.onerror = (e) => { this.ev('сторожевой поток: ошибка', { msg: e.message }); };
    }
    return w;
  }
  _onSessions(list) {
    let closed = null;
    try { closed = localStorage.getItem('negs-log-closed'); } catch {}
    this.saved = list;
    const prev = list.find((s) => s.sid !== this.sid);
    if (prev && !prev.closed && prev.sid !== closed) {
      prev.crash = prev.hangOpen ? 'закрыта во время зависания' : 'завершилась без штатного выхода (вылет, сброс драйвера или закрыта вкладка)';
      this.prevCrash = prev;
      this.ev('прошлая сессия', { sid: prev.sid, crash: prev.crash, hangs: prev.hangs, errors: prev.errors, lastSec: Math.round((prev.last - prev.start) / 1000) });
      if (this.onPrevCrash) this.onPrevCrash(prev);
    }
  }
  _flush(final = false) {
    if (!this.on) return;
    this._flushT = performance.now();
    if (final) this._emitPending(true);
    const text = this._out || '';
    this._out = '';
    this.meta.last = Date.now();
    if (this.w) this.w.postMessage({ t: 'lines', text, meta: { title: this.meta.title, hitches: this.meta.hitches, errors: this.meta.errors } });
  }
  _ask(msg) {
    return new Promise((res) => {
      try { this._worker(); } catch { res(null); return; }
      const id = ++this._rid;
      this._wait.set(id, res);
      this.w.postMessage({ ...msg, id });
      setTimeout(() => { if (this._wait.has(id)) { this._wait.delete(id); res(null); } }, 8000);
    });
  }
  async sessions() {
    const l = (await this._ask({ t: 'list' })) || this.saved || [];
    this.saved = l;
    let closed = null;
    try { closed = localStorage.getItem('negs-log-closed'); } catch {}
    for (const s of l) if (s.sid !== this.sid && !s.closed && s.sid !== closed && !s.crash) s.crash = s.hangOpen ? 'закрыта во время зависания' : 'без штатного выхода';
    return l;
  }
  async clearSaved() { await this._ask({ t: 'clear' }); this.saved = this.saved.filter((s) => s.sid === this.sid); this.prevCrash = null; }

  // ---------------------------------------------------------------- метка игрока (F8)
  userMark(note = '') {
    if (!this.on) return false;
    const n = Math.min(300, this.fi), fr = [];
    for (let i = n; i > 0; i--) fr.push(Math.round(this.frames[(this.fi - i) % 300]));
    this.write({ k: 'mark', note: note || 'игрок отметил момент (F8)', v: this._view, mode: this.app.mode, frames: fr, crumbs: this.crumbs.slice(-12).map((c) => `${r1((c.t - performance.now()) / 1000)}с ${c.s}`) });
    this._flush();
    return true;
  }

  // ---------------------------------------------------------------- выгрузка
  async text(sid = this.sid) {
    if (sid === this.sid && this.on) { this._emitPending(true); this._flush(); return this.lines.join('\n') + '\n'; }
    return (await this._ask({ t: 'read', sid })) || '';
  }
  // сводка для начала файла: по ней сразу видно главное
  summarize(text) {
    const S = { k: 'summary', note: 'Сводка посчитана при выгрузке. Подробности — в строках ниже.' };
    const byView = new Map(), errs = new Map(), hitches = [], hangs = [], evs = [], marks = [];
    let head = null, secs = 0, first = null, last = 0, rtt = [], gpu = 0, gpuN = 0;
    for (const l of text.split('\n')) {
      if (!l) continue;
      let o; try { o = JSON.parse(l); } catch { continue; }
      if (o.t !== undefined) { if (first === null) first = o.t; last = Math.max(last, o.t); }
      if (o.k === 'head') head = o;
      else if (o.k === 's') {
        secs++;
        const key = o.mode === 'mission' ? (o.v || 'задание').split('+')[0] : o.mode;
        const b = byView.get(key) || { sec: 0, fps: [], cpu: 0, gpu: 0, gpuN: 0, calls: 0 };
        b.sec++; b.fps.push(o.fps); b.cpu += o.cpu[0] + o.cpu[1]; b.calls += o.calls; if (o.gpu !== undefined) { b.gpu += o.gpu; b.gpuN++; gpu += o.gpu; gpuN++; }
        byView.set(key, b);
        if (o.net && o.net.rtt) rtt.push(o.net.rtt);
      } else if (o.k === 'hitch') hitches.push(o);
      else if (o.k === 'hang' && o.st !== 'still') hangs.push(o);
      else if (o.k === 'err') errs.set(o.kind + ': ' + o.msg.slice(0, 140), Math.max(errs.get(o.kind + ': ' + o.msg.slice(0, 140)) || 0, o.n));
      else if (o.k === 'ev' && /задание|загрузка|ПОТЕРЯН|прошлая|итог/.test(o.e)) evs.push(`${o.t}с ${o.e}${o.id ? ' ' + o.id : ''}${o.ms ? ' ' + o.ms + ' мс' : ''}`);
      else if (o.k === 'mark') marks.push(o.t);
    }
    if (head) { S.build = head.build; S.gpu = head.sys && head.sys.gpu; S.cpuCores = head.sys && head.sys.cores; S.date = head.date; }
    S.minutes = r1((last - (first || 0)) / 60);
    S.views = [...byView.entries()].sort((a, b) => b[1].sec - a[1].sec).map(([k, b]) => {
      const f = b.fps.sort((x, y) => x - y);
      return { v: k, sec: b.sec, fpsAvg: r1(f.reduce((x, y) => x + y, 0) / f.length), fpsP5: f[Math.floor(f.length * 0.05)], cpuMs: r1(b.cpu / b.sec), gpuMs: b.gpuN ? r1(b.gpu / b.gpuN) : undefined, calls: Math.round(b.calls / b.sec) };
    });
    const bucket = { '50-100': 0, '100-250': 0, '250-1000': 0, '>1000': 0 };
    for (const h of hitches) bucket[h.ms < 100 ? '50-100' : h.ms < 250 ? '100-250' : h.ms < 1000 ? '250-1000' : '>1000']++;
    S.hitches = bucket;
    S.worst = hitches.sort((a, b) => b.ms - a.ms).slice(0, 12).map((h) => `${h.t}с ${h.ms}мс [${h.v}] ${h.top && h.top[0] ? h.top[0].join(' ') : ''} вне кадра ${h.gap}${h.outside ? ' (' + h.outside[0].join(' ') + ')' : ''}${h.prog ? ' шейдеры+' + h.prog : ''}${h.slowest ? ' · ' + h.slowest : ''}`);
    S.hangs = hangs.map((h) => `${h.t}с ${h.st} ${h.ms}мс фаза ${h.ph}${h.crumb ? ' после «' + h.crumb + '»' : ''}`).slice(0, 30);
    S.errors = [...errs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, n]) => `${n}× ${k}`);
    if (rtt.length) S.pingMs = { avg: Math.round(rtt.reduce((a, b) => a + b, 0) / rtt.length), max: Math.max(...rtt) };
    if (gpuN) S.gpuMsAvg = r1(gpu / gpuN);
    S.events = evs.slice(0, 60);
    if (marks.length) S.marksF8 = marks;
    return JSON.stringify(S);
  }
  async download(sid = this.sid) {
    const t = await this.text(sid);
    if (!t) return { ok: false, msg: 'Журнал пуст или недоступен.' };
    const meta = (this.saved || []).find((s) => s.sid === sid) || this.meta;
    const name = `negs-log_${stamp(new Date(meta.start || Date.now()))}.txt`;
    const blob = new Blob([this.summarize(t) + '\n' + t], { type: 'text/plain;charset=utf-8' });
    // страница на claude.ai: сохранение файла — через платформу (браузер там скачивать не даёт)
    if (window.claude && window.claude.use) {
      const d = await window.claude.use('downloads');
      if (d) {
        try { await d.save({ filename: name, data: blob }); return { ok: true, name }; }
        catch (e) { return { ok: false, msg: e && e.code === 'declined' ? 'Сохранение отменено.' : 'Не удалось сохранить: ' + ((e && (e.message || e.code)) || e) + '. Нажмите «Копировать».' }; }
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 10000);
    return { ok: true, name };
  }
  async copy(sid = this.sid) {
    const t = await this.text(sid);
    if (!t) return false;
    await navigator.clipboard.writeText(this.summarize(t) + '\n' + t);
    return true;
  }
}

export const LOG = new GameLog();
