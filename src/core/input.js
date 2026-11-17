// Клавиатура и мышь с захватом указателя
const GAME_KEYS = new Set(['Tab', 'Space', 'F1', 'F2', 'F3', 'F4', 'AltLeft', 'AltRight', 'KeyF', 'Quote', 'Slash']);

export class Input {
  constructor(el) {
    this.el = el;
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mb = [false, false, false];
    this.mbPressed = [false, false, false];
    this.mbReleased = [false, false, false];
    this.dx = 0; this.dy = 0; this.wheel = 0;
    this.locked = false;
    this.fallbackLook = false; // если Pointer Lock недоступен
    this.wantLock = false;
    this.onLockChange = null;

    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if ((this.locked || this.fallbackLook) && (GAME_KEYS.has(e.code) || e.code.startsWith('Digit'))) e.preventDefault();
      if (e.code === 'Tab') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear(); this.mb = [false, false, false];
    });
    document.addEventListener('mousemove', (e) => {
      if (this.locked || (this.fallbackLook && this.wantLock)) {
        this.dx += e.movementX || 0;
        this.dy += e.movementY || 0;
      }
    });
    el.addEventListener('mousedown', (e) => {
      if (this.wantLock && !this.locked && !this.fallbackLook) this.requestLock();
      this.mb[e.button] = true; this.mbPressed[e.button] = true;
    });
    window.addEventListener('mouseup', (e) => {
      this.mb[e.button] = false; this.mbReleased[e.button] = true;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => {
      if (this.locked || this.fallbackLook) this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => {
      // Во встроенном фрейме без доступа к захвату — запасной режим обзора.
      // Ошибку из-за отсутствия жеста пользователя (обычная страница) игнорируем.
      let framed = false;
      try { framed = window.top !== window; } catch (e) { framed = true; }
      if (!framed) return;
      this.fallbackLook = true;
      if (this.onLockChange) this.onLockChange(true);
    });
  }

  requestLock() {
    this.wantLock = true;
    if (this.fallbackLook) return;
    try {
      const p = this.el.requestPointerLock && this.el.requestPointerLock();
      if (p && p.catch) p.catch(() => {
        let framed = false;
        try { framed = window.top !== window; } catch (e) { framed = true; }
        if (framed) { this.fallbackLook = true; if (this.onLockChange) this.onLockChange(true); }
      });
    } catch (e) {
      this.fallbackLook = true;
    }
  }
  releaseLock() {
    this.wantLock = false;
    if (document.pointerLockElement) document.exitPointerLock();
  }
  get active() { return this.locked || (this.fallbackLook && this.wantLock); }

  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }
  up(code) { return this.released.has(code); }
  mouse(b) { return this.mb[b]; }
  mouseHit(b) { return this.mbPressed[b]; }
  mouseUp(b) { return this.mbReleased[b]; }

  endFrame() {
    this.pressed.clear(); this.released.clear();
    this.mbPressed = [false, false, false]; this.mbReleased = [false, false, false];
    this.dx = 0; this.dy = 0; this.wheel = 0;
  }
}
