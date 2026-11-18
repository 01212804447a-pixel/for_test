// Соединение с игровым сервером (WebSocket): сообщения, пинг, оценка времени сервера
export const NET_VER = 1;

// Адрес сервера по умолчанию: если игра открыта с самого игрового сервера — он же
export function defaultServer() {
  const l = location;
  if ((l.protocol === 'http:' || l.protocol === 'https:') && !/claude\.ai|claudeusercontent|github\.io/.test(l.hostname)) return l.host;
  return '';
}

export function wsUrl(addr) {
  let a = String(addr || '').trim();
  if (!a) return null;
  if (/^wss?:\/\//.test(a)) return a.replace(/\/?$/, a.endsWith('/ws') ? '' : '');
  a = a.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const secure = location.protocol === 'https:';
  return `${secure ? 'wss' : 'ws'}://${a}/ws`;
}

export class NetClient {
  constructor() {
    this.ws = null; this.id = null; this.handlers = new Map();
    this.connected = false; this.rtt = 0; this.offset = 0; this.rooms = []; this.room = null;
    this._pingT = null;
  }

  on(type, fn) { if (!this.handlers.has(type)) this.handlers.set(type, new Set()); this.handlers.get(type).add(fn); return () => this.handlers.get(type).delete(fn); }
  emit(type, m) { const hs = this.handlers.get(type); if (hs) for (const fn of [...hs]) { try { fn(m); } catch (e) { console.error(e); } } }

  connect(addr, name) {
    return new Promise((resolve, reject) => {
      const url = wsUrl(addr);
      if (!url) { reject(new Error('Не указан адрес сервера')); return; }
      this.close();
      let ws;
      try { ws = new WebSocket(url); } catch (e) { reject(e); return; }
      this.ws = ws;
      const to = setTimeout(() => { reject(new Error('Сервер не отвечает')); try { ws.close(); } catch {} }, 8000);
      ws.onopen = () => { this.send({ t: 'hello', name, ver: NET_VER }); };
      ws.onmessage = (e) => {
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === 'welcome') { clearTimeout(to); this.id = m.id; this.connected = true; this.offset = m.time - Date.now(); this._startPing(); resolve(this); }
        else if (m.t === 'pong') {
          const rtt = Date.now() - m.c;
          this.rtt = this.rtt ? this.rtt * 0.7 + rtt * 0.3 : rtt;
          this.offset = m.s + rtt / 2 - Date.now();
        } else if (m.t === 'rooms') this.rooms = m.list;
        else if (m.t === 'room' || m.t === 'start' || m.t === 'end') this.room = m.room;
        this.emit(m.t, m);
      };
      ws.onclose = () => { clearTimeout(to); const was = this.connected; this.connected = false; this.room = null; clearInterval(this._pingT); if (was) this.emit('close', {}); else reject(new Error('Не удалось подключиться')); };
      ws.onerror = () => {};
    });
  }

  _startPing() {
    clearInterval(this._pingT);
    this._pingT = setInterval(() => this.send({ t: 'ping', c: Date.now(), rtt: this.rtt }), 2000);
    this.send({ t: 'ping', c: Date.now() });
  }

  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  get serverTime() { return Date.now() + this.offset; }
  close() { clearInterval(this._pingT); if (this.ws) { this.ws.onclose = null; try { this.ws.close(); } catch {} } this.ws = null; this.connected = false; this.room = null; }
}
