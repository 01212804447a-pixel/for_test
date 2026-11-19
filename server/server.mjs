// Игровой сервер N.E.G.S: Заполярье
// — раздаёт саму игру (index.html, dist/…) по HTTP;
// — WebSocket /ws: комнаты кооператива и PvP, ретрансляция состояния игроков и мира,
//   проверка попаданий и счёт в PvP, время матча.
// Запуск: node server/server.mjs   (порт — переменная PORT, по умолчанию 8080). Зависимостей нет — нужен только Node.js 18+.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WSServer } from './ws-lite.mjs';

const VER = 2;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_ROOMS = 40;

// ---------------------------------------------------------------- статика
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const ALLOW = [/^\/index\.html$/, /^\/style\.css$/, /^\/dist\/game\.js$/, /^\/dist\/assets\/pack_\d+\.js$/, /^\/favicon\.ico$/];
const gzCache = new Map();

function serveStatic(req, res) {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/') url = '/index.html';
  if (url === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(`ok ${rooms.size} rooms, ${clients.size} players`); return; }
  if (!ALLOW.some((r) => r.test(url))) { res.writeHead(404); res.end('not found'); return; }
  const file = path.join(ROOT, url);
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('not found'); return; }
    const type = TYPES[path.extname(file)] || 'application/octet-stream';
    const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    const headers = { 'content-type': type, 'cache-control': url.endsWith('.html') || url.endsWith('game.js') || url.endsWith('.css') ? 'no-cache' : 'public, max-age=3600', 'last-modified': st.mtime.toUTCString() };
    if (!gz) { headers['content-length'] = st.size; res.writeHead(200, headers); fs.createReadStream(file).pipe(res); return; }
    const key = file + ':' + st.mtimeMs;
    const buf = gzCache.get(key);
    if (!buf) {
      // сжатая копия ещё не готова — отдаём как есть и сжимаем в фоне
      precompress(file, st);
      headers['content-length'] = st.size; res.writeHead(200, headers); fs.createReadStream(file).pipe(res); return;
    }
    headers['content-encoding'] = 'gzip'; headers['content-length'] = buf.length; headers.vary = 'accept-encoding';
    res.writeHead(200, headers); res.end(buf);
  });
}

const pending = new Set();
function precompress(file, st) {
  const key = file + ':' + st.mtimeMs;
  if (gzCache.has(key) || pending.has(key)) return;
  pending.add(key);
  fs.readFile(file, (err, data) => {
    if (err) { pending.delete(key); return; }
    zlib.gzip(data, { level: 6 }, (e, out) => { pending.delete(key); if (!e) { for (const k of gzCache.keys()) if (k.startsWith(file + ':')) gzCache.delete(k); gzCache.set(key, out); } });
  });
}
// заранее сжать игру и ресурсы (в фоне, сервер сразу отвечает)
function warm() {
  const list = ['index.html', 'style.css', 'dist/game.js', ...fs.readdirSync(path.join(ROOT, 'dist/assets')).filter((f) => /^pack_\d+\.js$/.test(f)).map((f) => 'dist/assets/' + f)];
  for (const f of list) { const file = path.join(ROOT, f); fs.stat(file, (e, st) => { if (!e) precompress(file, st); }); }
}

const server = http.createServer((req, res) => {
  try { serveStatic(req, res); } catch (e) { res.writeHead(500); res.end('error'); }
});

// ---------------------------------------------------------------- игроки и комнаты
const clients = new Map(); // id → client
const rooms = new Map();   // id → room
let nextId = 1, nextRoom = 1;

const clean = (s, n = 24) => String(s || '').replace(/[<>&"'`\u0000-\u001f]/g, '').trim().slice(0, n);
const now = () => Date.now();

function send(c, msg) { if (c.ws.readyState === 1) c.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); }
// Снаряжение игрока (выбирает сам в комнате): проверяем и обрезаем
const KIT_WEAPONS = ['ak74m', 'ak74m_gp', 'ak74m_1p78', 'akm', 'svd', 'pkm'];
const KIT_HEAVY = ['rpg7', 'ptrd'];
const KIT_ROLES = ['rifleman', 'rifleman_akm', 'mg', 'sniper', 'at', 'gp', 'medic'];
const KIT_TOW = ['tigr', 'niva', 'mtlb', 't72b'];
function cleanKit(k) {
  if (!k || typeof k !== 'object') return null;
  return {
    weapon: KIT_WEAPONS.includes(k.weapon) ? k.weapon : 'ak74m',
    heavy: KIT_HEAVY.includes(k.heavy) ? k.heavy : null,
    grenades: Math.max(0, Math.min(4, Math.round(+k.grenades || 0))),
    squad: Array.isArray(k.squad) ? k.squad.filter((x) => KIT_ROLES.includes(x)).slice(0, 6) : [],
    howitzer: !!k.howitzer,
    tow: KIT_TOW.includes(k.tow) ? k.tow : 'tigr',
    smokes: Math.max(0, Math.min(4, Math.round(+(k.smokes ?? 2) || 0))),
    mortar: !!k.mortar,
    kpv: !!k.kpv,
    tank: !!k.tank,
    atgm: !!k.atgm,
  };
}

function roomPublic(r) {
  return {
    id: r.id, name: r.name, mode: r.mode, mission: r.mission, max: r.max, state: r.state, owner: r.owner, host: r.host,
    scoreLimit: r.scoreLimit, timeLimit: r.timeLimit, endsAt: r.endsAt, howitzer: r.howitzer, squad: r.squad,
    players: [...r.players].map((id) => { const c = clients.get(id); return c ? { id, name: c.name, team: c.team, weapon: c.weapon, kit: c.kit || null, ready: c.ready, ping: c.ping, kills: c.kills, deaths: c.deaths } : null; }).filter(Boolean),
    score: r.score,
  };
}
function broadcast(r, msg, except = null) {
  const s = typeof msg === 'string' ? msg : JSON.stringify(msg);
  for (const id of r.players) { if (id === except) continue; const c = clients.get(id); if (c) send(c, s); }
}
function roomUpdate(r) { broadcast(r, { t: 'room', room: roomPublic(r) }); }
function roomList() { return [...rooms.values()].map((r) => ({ id: r.id, name: r.name, mode: r.mode, mission: r.mission, max: r.max, state: r.state, n: r.players.size })); }

function leaveRoom(c) {
  const r = rooms.get(c.room);
  c.room = null;
  if (!r) return;
  r.players.delete(c.id);
  if (!r.players.size) { rooms.delete(r.id); return; }
  if (r.owner === c.id) r.owner = [...r.players][0];
  if (r.state === 'play') {
    broadcast(r, { t: 'left', id: c.id, name: c.name });
    if (r.mode === 'coop' && r.host === c.id) {
      // хост держит ИИ и задачи: без него миссию продолжить нельзя
      endMatch(r, false, 'Хост покинул игру');
    }
  }
  roomUpdate(r);
}

function teamBalance(r) {
  const n = { negs: 0, denter: 0 };
  for (const id of r.players) { const c = clients.get(id); if (c && n[c.team] !== undefined) n[c.team]++; }
  return n.negs <= n.denter ? 'negs' : 'denter';
}

function startMatch(r) {
  r.state = 'play';
  r.seed = (Math.random() * 1e9) | 0;
  r.host = r.owner;
  r.startedAt = now();
  r.endsAt = r.mode === 'pvp' ? now() + r.timeLimit * 60000 : 0;
  r.score = { negs: 0, denter: 0 };
  for (const id of r.players) { const c = clients.get(id); if (c) { c.kills = 0; c.deaths = 0; c.alive = true; c.spawnT = now(); c.hitBucket = 30; c.last = null; } }
  broadcast(r, { t: 'start', room: roomPublic(r), seed: r.seed, host: r.host, time: now() });
}

function endMatch(r, ok, reason) {
  if (r.state !== 'play') return;
  r.state = 'lobby';
  for (const id of r.players) { const c = clients.get(id); if (c) c.ready = false; }
  broadcast(r, { t: 'end', ok, reason, room: roomPublic(r) });
}

// ---------------------------------------------------------------- проверка попаданий (PvP)
function validHit(r, from, to, m) {
  if (r.state !== 'play') return false;
  if (!to.alive || !from.alive && !m.late) return false;
  if (now() - to.spawnT < 2000) return false;                 // защита после возрождения
  const dmg = +m.dmg;
  if (!(dmg > 0) || dmg > 600) return false;
  // не более ~30 попаданий в секунду (очередь ПКМ по нескольким целям, осколки)
  from.hitBucket = Math.min(30, from.hitBucket + (now() - (from.hitT || now())) * 0.03);
  from.hitT = now();
  if (from.hitBucket < 1) return false;
  from.hitBucket -= 1;
  // дальность: по последним известным позициям
  if (from.last && to.last) {
    const dx = from.last.p[0] - to.last.p[0], dz = from.last.p[2] - to.last.p[2];
    if (Math.hypot(dx, dz) > (m.ex ? 2500 : 2000)) return false;
  }
  return true;
}

function onKill(r, victim, killerId, weapon) {
  victim.deaths = (victim.deaths || 0) + 1;
  victim.alive = false;
  const k = killerId ? clients.get(killerId) : null;
  if (r.mode === 'pvp') {
    if (k && k !== victim && r.players.has(k.id)) {
      if (k.team === victim.team) { k.kills = (k.kills || 0) - 1; r.score[k.team] = Math.max(0, r.score[k.team] - 1); }
      else { k.kills = (k.kills || 0) + 1; r.score[k.team]++; }
    }
  } else if (k && k !== victim) k.kills = (k.kills || 0) + 1;
  broadcast(r, { t: 'kill', killer: k ? k.id : null, kname: k ? k.name : (killerId ? '?' : null), victim: victim.id, vname: victim.name, w: clean(weapon, 20), score: r.score, stats: [...r.players].map((id) => { const c = clients.get(id); return c ? [id, c.kills || 0, c.deaths || 0] : null; }).filter(Boolean) });
  if (r.mode === 'pvp' && (r.score.negs >= r.scoreLimit || r.score.denter >= r.scoreLimit)) {
    const w = r.score.negs >= r.scoreLimit ? 'negs' : 'denter';
    endMatch(r, true, `Победа: ${w === 'negs' ? 'N.E.G.S' : '«Дентер»'} (${r.score.negs}:${r.score.denter})`);
  }
}

// ---------------------------------------------------------------- сообщения
function onMessage(c, raw) {
  let m;
  try { m = JSON.parse(raw); } catch { return; }
  if (!m || typeof m.t !== 'string') return;
  const r = c.room ? rooms.get(c.room) : null;
  switch (m.t) {
    case 'hello':
      c.name = clean(m.name) || `Боец ${c.id}`;
      if (m.ver !== VER) send(c, { t: 'err', msg: 'Версия игры не совпадает с сервером — обновите страницу.' });
      send(c, { t: 'rooms', list: roomList() });
      break;
    case 'ping': send(c, { t: 'pong', c: m.c, s: now() }); if (typeof m.rtt === 'number') c.ping = Math.round(m.rtt); break;
    case 'list': send(c, { t: 'rooms', list: roomList() }); break;
    case 'create': {
      if (rooms.size >= MAX_ROOMS) { send(c, { t: 'err', msg: 'Сервер заполнен' }); break; }
      if (c.room) leaveRoom(c);
      const mode = m.mode === 'pvp' ? 'pvp' : 'coop';
      const id = 'r' + nextRoom++;
      const room = {
        id, name: clean(m.name, 32) || `${c.name}: ${mode === 'pvp' ? 'PvP' : 'кооп'}`, mode, mission: clean(m.mission, 24) || 'm1',
        max: Math.max(2, Math.min(mode === 'pvp' ? 16 : 4, +m.max || (mode === 'pvp' ? 12 : 4))), state: 'lobby', owner: c.id, host: c.id,
        players: new Set(), howitzer: m.howitzer !== false, squad: Math.max(0, Math.min(6, m.squad ?? 3)), score: { negs: 0, denter: 0 }, scoreLimit: Math.max(5, Math.min(200, +m.scoreLimit || 30)), timeLimit: Math.max(3, Math.min(60, +m.timeLimit || 15)), endsAt: 0,
      };
      rooms.set(id, room);
      room.players.add(c.id); c.room = id; c.team = mode === 'pvp' ? 'negs' : 'negs'; c.ready = false;
      roomUpdate(room);
      break;
    }
    case 'join': {
      const room = rooms.get(m.room);
      if (!room) { send(c, { t: 'err', msg: 'Комната не найдена' }); break; }
      if (room.players.size >= room.max) { send(c, { t: 'err', msg: 'Комната заполнена' }); break; }
      if (room.state === 'play' && room.mode === 'coop') { send(c, { t: 'err', msg: 'Кооператив уже идёт — дождитесь конца задания' }); break; }
      if (c.room) leaveRoom(c);
      room.players.add(c.id); c.room = room.id; c.ready = false;
      c.team = room.mode === 'pvp' ? teamBalance(room) : 'negs';
      c.kills = 0; c.deaths = 0;
      roomUpdate(room);
      if (room.state === 'play') {
        // PvP: вход в идущий матч
        c.alive = true; c.spawnT = now(); c.hitBucket = 30; c.last = null;
        send(c, { t: 'start', room: roomPublic(room), seed: room.seed, host: room.host, time: now(), late: true });
        broadcast(room, { t: 'joined', id: c.id, name: c.name, team: c.team }, c.id);
      }
      break;
    }
    case 'leave': leaveRoom(c); send(c, { t: 'rooms', list: roomList() }); break;
    case 'set': {
      if (!r) break;
      if (m.team && r.mode === 'pvp' && (m.team === 'negs' || m.team === 'denter') && r.state === 'lobby') c.team = m.team;
      if (m.weapon) c.weapon = clean(m.weapon, 16);
      if (m.kit && r.state === 'lobby') { c.kit = cleanKit(m.kit); if (c.kit) c.weapon = c.kit.weapon; }
      if (m.ready !== undefined) c.ready = !!m.ready;
      if (r.owner === c.id && r.state === 'lobby') {
        if (m.mission) r.mission = clean(m.mission, 24);
        if (m.scoreLimit) r.scoreLimit = Math.max(5, Math.min(200, +m.scoreLimit));
        if (m.timeLimit) r.timeLimit = Math.max(3, Math.min(60, +m.timeLimit));
        if (m.howitzer !== undefined) r.howitzer = !!m.howitzer;
        if (m.squad !== undefined) r.squad = Math.max(0, Math.min(6, +m.squad || 0));
      }
      roomUpdate(r);
      break;
    }
    case 'start':
      if (r && r.owner === c.id && r.state === 'lobby') startMatch(r);
      break;
    case 'st': {
      // состояние своего бойца → остальным в комнате
      if (!r || r.state !== 'play') break;
      c.last = m;
      if (m.alive && !c.alive) { c.alive = true; c.spawnT = now(); }
      m.id = c.id;
      broadcast(r, m, c.id);
      break;
    }
    case 'ws': // снимок мира от хоста кооператива
      if (r && r.state === 'play' && r.host === c.id) { broadcast(r, raw, c.id); }
      break;
    case 'ev': {
      if (!r || r.state !== 'play' || !Array.isArray(m.list) || m.list.length > 200) break;
      const out = { t: 'ev', from: c.id, list: m.list };
      if (m.to === 'host') { const h = clients.get(r.host); if (h && h !== c) send(h, out); }
      else if (m.to) { const tc = clients.get(m.to); if (tc && r.players.has(tc.id)) send(tc, out); }
      else broadcast(r, out, c.id);
      break;
    }
    case 'hit': {
      if (!r) break;
      const to = clients.get(m.to);
      if (!to || !r.players.has(to.id)) break;
      if (r.mode === 'pvp' && !validHit(r, c, to, m)) break;
      m.from = c.id;
      send(to, m);
      break;
    }
    case 'died': {
      if (!r || r.state !== 'play' || !c.alive) break;
      onKill(r, c, m.by && r.players.has(m.by) ? m.by : null, m.w);
      break;
    }
    case 'aikill': {
      // гибель бойца ИИ из отделения (сообщает хост): очки команде убийцы в PvP
      if (!r || r.state !== 'play' || r.host !== c.id) break;
      const k = m.by ? clients.get(m.by) : null;
      const vt = m.team === 'denter' ? 'denter' : 'negs';
      if (r.mode === 'pvp' && k && r.players.has(k.id)) {
        if (k.team !== vt) { k.kills = (k.kills || 0) + 1; r.score[k.team]++; }
        else { k.kills = (k.kills || 0) - 1; r.score[k.team] = Math.max(0, r.score[k.team] - 1); }
      }
      broadcast(r, { t: 'kill', killer: k ? k.id : null, kname: k ? k.name : null, victim: null, vname: clean(m.vname, 40), vteam: vt, w: clean(m.w, 20), score: r.score, stats: [...r.players].map((id) => { const q = clients.get(id); return q ? [id, q.kills || 0, q.deaths || 0] : null; }).filter(Boolean) });
      if (r.mode === 'pvp' && (r.score.negs >= r.scoreLimit || r.score.denter >= r.scoreLimit)) {
        const w = r.score.negs >= r.scoreLimit ? 'negs' : 'denter';
        endMatch(r, true, `Победа: ${w === 'negs' ? 'N.E.G.S' : '«Дентер»'} (${r.score.negs}:${r.score.denter})`);
      }
      break;
    }
    case 'end':
      if (r && r.mode === 'coop' && r.host === c.id) endMatch(r, !!m.ok, clean(m.reason, 80));
      break;
    case 'abort':
      if (r && r.owner === c.id) endMatch(r, false, 'Матч остановлен создателем комнаты');
      break;
    case 'chat':
      if (r) broadcast(r, { t: 'chat', id: c.id, name: c.name, text: clean(m.text, 160) });
      break;
  }
}

// ---------------------------------------------------------------- WebSocket
const wss = new WSServer({ server, path: '/ws', maxPayload: 256 * 1024 });
wss.on('connection', (ws, req) => {
  const c = { id: 'p' + nextId++, ws, name: 'Боец', room: null, team: 'negs', weapon: 'ak74m', ready: false, ping: 0, alive: false, kills: 0, deaths: 0, hitBucket: 30, msgT: now(), msgN: 0 };
  clients.set(c.id, c);
  send(c, { t: 'welcome', id: c.id, ver: VER, time: now() });
  ws.on('message', (data) => {
    // защита от флуда: не больше 200 сообщений в секунду
    const t = now();
    if (t - c.msgT > 1000) { c.msgT = t; c.msgN = 0; }
    if (++c.msgN > 200) return;
    onMessage(c, data.toString());
  });
  ws.on('close', () => { leaveRoom(c); clients.delete(c.id); });
  ws.on('error', () => {});
});

// таймер матчей PvP и обновление списков
setInterval(() => {
  for (const r of rooms.values()) {
    if (r.state === 'play' && r.mode === 'pvp') {
      if (now() >= r.endsAt) {
        const s = r.score;
        endMatch(r, true, s.negs === s.denter ? `Время вышло: ничья ${s.negs}:${s.denter}` : `Время вышло. Победа: ${s.negs > s.denter ? 'N.E.G.S' : '«Дентер»'} (${s.negs}:${s.denter})`);
      } else broadcast(r, { t: 'score', score: r.score, left: Math.max(0, Math.round((r.endsAt - now()) / 1000)) });
    }
  }
}, 1000);
setInterval(() => { for (const ws of wss.clients) if (ws.readyState === 1) ws.ping(); }, 20000);

server.listen(PORT, HOST, () => {
  try { warm(); } catch {}
  const ips = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
  console.log(`N.E.G.S сервер запущен, порт ${PORT}`);
  console.log('Откройте в браузере:');
  console.log(`  на этом компьютере:   http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  в локальной сети:     http://${ip}:${PORT}`);
});
