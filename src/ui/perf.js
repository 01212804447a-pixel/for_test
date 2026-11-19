// Счётчик FPS (во всех режимах: меню, штаб, задание) и адаптивное разрешение рендера.
// Адаптивное разрешение: если кадров меньше ≈50 в секунду и упираемся в видеокарту (время
// работы JS заметно меньше длительности кадра), масштаб рендера плавно снижается до 50 %
// от выбранного качеством; когда запас появляется — возвращается. Если же упираемся
// в процессор (JS занимает почти весь кадр), разрешение не трогаем — толку не будет.
export class Perf {
  constructor(app) {
    this.app = app;
    const el = this.el = document.createElement('div');
    el.className = 'fps';
    el.style.cssText = 'position:fixed;right:6px;bottom:3px;font:11px/1.2 monospace;color:#cfd8dc;background:rgba(10,14,18,0.5);padding:1px 6px;border-radius:3px;pointer-events:none;z-index:9999';
    document.body.appendChild(el);
    this.n = 0; this.t0 = performance.now(); this.last = this.t0; this.max = 0; this.cpu = 0;
    this.scale = 1; this.cool = 3; this.basePR = 1;
  }

  // вызов в начале кадра
  begin() { this._b = performance.now(); }

  // вызов в конце кадра
  end() {
    const t = performance.now(), d = t - this.last;
    this.cpu += t - this._b;
    this.last = t;
    if (d > 1500) { this.n = 0; this.t0 = t; this.max = 0; this.cpu = 0; return; } // пауза, загрузка
    this.n++; this.max = Math.max(this.max, d);
    const span = t - this.t0;
    if (span < 500) return;
    const fps = (this.n * 1000) / span, cpu = this.cpu / this.n;
    this.el.textContent = `${Math.round(fps)} FPS · кадр ${(1000 / fps).toFixed(1)} мс (макс ${Math.round(this.max)}) · ЦП ${cpu.toFixed(1)} мс${this.scale < 0.99 ? ` · разрешение ${Math.round(this.scale * 100)}%` : ''}`;
    this.el.style.color = fps >= 50 ? '#b9e6a4' : fps >= 30 ? '#ecd98a' : '#f09a8a';
    this.adapt(fps, cpu, 1000 / fps, span / 1000);
    this.n = 0; this.t0 = t; this.max = 0; this.cpu = 0;
  }

  adapt(fps, cpu, frameMs, dt) {
    const app = this.app;
    this.cool -= dt;
    if (app.settings.dynRes === false || this.cool > 0 || app.mode === 'loading') return;
    const gpuBound = cpu < frameMs * 0.7;
    let s = this.scale;
    if (fps < 38 && gpuBound) s = Math.max(0.5, s * 0.85);
    else if (fps < 50 && gpuBound) s = Math.max(0.5, s * 0.93);
    else if (fps > 57 && s < 1) s = Math.min(1, s * 1.08);
    if (Math.abs(s - this.scale) > 0.01) { this.scale = s; this.cool = 2.5; this.apply(); }
  }

  apply() {
    const app = this.app;
    app.renderer.setPixelRatio(this.basePR * this.scale);
    app.renderer.setSize(innerWidth, innerHeight);
    if (app.post) app.post.resize();
  }
}
