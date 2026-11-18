// Минимальный сервер WebSocket (RFC 6455) на стандартных модулях Node.js — без npm-зависимостей.
// Текстовые и двоичные кадры, фрагментация, ping/pong, закрытие, ограничение размера сообщения.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_BUFFERED = 4 * 1024 * 1024; // медленный клиент: больше 4 МБ в очереди — отключаем

export class WSServer extends EventEmitter {
  constructor({ server, path = '/ws', maxPayload = 256 * 1024 }) {
    super();
    this.clients = new Set();
    server.on('upgrade', (req, socket, head) => {
      const url = (req.url || '').split('?')[0];
      const key = req.headers['sec-websocket-key'];
      if (url !== path || String(req.headers.upgrade || '').toLowerCase() !== 'websocket' || !key) { socket.destroy(); return; }
      const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
      socket.setNoDelay(true);
      socket.setKeepAlive(true, 30000);
      const ws = new WSConn(socket, maxPayload);
      this.clients.add(ws);
      ws.on('close', () => this.clients.delete(ws));
      this.emit('connection', ws, req);
      if (head && head.length) ws._onData(head);
    });
  }
}

class WSConn extends EventEmitter {
  constructor(socket, maxPayload) {
    super();
    this.socket = socket; this.max = maxPayload;
    this.buf = Buffer.alloc(0); this.frag = null; this.fragLen = 0;
    this.readyState = 1; // 1 — открыт, 2 — закрывается, 3 — закрыт
    socket.on('data', (d) => this._onData(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
  }

  _closed() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close');
  }

  _onData(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0, op = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) {
        if (b.length < 10) return;
        if (b.readUInt32BE(2) !== 0) { this.close(1009); return; }
        len = b.readUInt32BE(6); off = 10;
      }
      if (len > this.max) { this.close(1009); return; }
      if (!masked) { this.close(1002); return; } // кадры клиента обязаны быть замаскированы
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4);
      off += 4;
      const payload = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) payload[i] = b[off + i] ^ mask[i & 3];
      this.buf = b.subarray(off + len);
      if (op === 0x8) { this.close(); return; }
      if (op === 0x9) { this._send(0xA, payload); continue; }
      if (op === 0xA) continue;
      if (op === 0x1 || op === 0x2) {
        if (fin) this.emit('message', payload);
        else { this.frag = [payload]; this.fragLen = len; }
      } else if (op === 0x0 && this.frag) {
        this.frag.push(payload); this.fragLen += len;
        if (this.fragLen > this.max) { this.close(1009); return; }
        if (fin) { const all = Buffer.concat(this.frag); this.frag = null; this.emit('message', all); }
      }
    }
  }

  _send(op, data) {
    if (this.readyState !== 1) return;
    if (this.socket.writableLength > MAX_BUFFERED) { this.socket.destroy(); return; }
    const len = data.length;
    let h;
    if (len < 126) { h = Buffer.alloc(2); h[1] = len; }
    else if (len < 65536) { h = Buffer.alloc(4); h[1] = 126; h.writeUInt16BE(len, 2); }
    else { h = Buffer.alloc(10); h[1] = 127; h.writeUInt32BE(0, 2); h.writeUInt32BE(len, 6); }
    h[0] = 0x80 | op;
    this.socket.write(Buffer.concat([h, data]));
  }

  send(text) { this._send(0x1, Buffer.from(String(text), 'utf8')); }
  ping() { this._send(0x9, Buffer.alloc(0)); }
  close(code = 1000) {
    if (this.readyState !== 1) return;
    const b = Buffer.alloc(2); b.writeUInt16BE(code);
    this._send(0x8, b);
    this.readyState = 2;
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 1000).unref();
    this._closed();
  }
}
