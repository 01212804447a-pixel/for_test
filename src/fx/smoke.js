// Дымовые завесы: ручная дымовая граната РДГ-2, дымовые мины и снаряды. Источник горит
// заданное время и выпускает клубы, которые сносит ветром, они поднимаются и разрастаются.
// Клубы — это и картинка (частицы), и препятствие для взгляда: плотное ядро клуба
// перекрывает линию видимости ИИ (обнаружение, прицельная стрельба), сквозь край видно.
import * as THREE from 'three';

const _d = new THREE.Vector3(), _w = new THREE.Vector3();

export class SmokeScreens {
  constructor(m) {
    this.m = m;
    this.list = [];
  }

  // pos — место источника; dur — время горения, с; size — масштаб клубов; burst — сразу облако
  // (разрыв дымовой мины/снаряда), иначе разгорается постепенно (шашка, граната)
  add(pos, { dur = 60, size = 1, burst = false, color = [0.86, 0.87, 0.88] } = {}) {
    const s = { p: pos.clone(), t: 0, dur, size, color, puffs: [], next: 0, burst };
    if (burst) for (let i = 0; i < 6; i++) this._puff(s, 0.6 + i * 0.25, true);
    this.list.push(s);
    while (this.list.length > 16) this.list.shift();
    return s;
  }

  _puff(s, r0 = 1, spread = false) {
    const k = s.size;
    const q = s.p.clone();
    if (spread) q.add(new THREE.Vector3((Math.random() - 0.5) * 6 * k, Math.random() * 2 * k, (Math.random() - 0.5) * 6 * k));
    s.puffs.push({ c: q, r: r0 * k, age: 0, life: 28 + Math.random() * 10 });
  }

  update(dt) {
    const m = this.m, fx = m.fx, wind = m.wind || _w.set(0, 0, 0), cam = m.camPos;
    for (const s of this.list) {
      s.t += dt;
      const burning = s.t < s.dur;
      // клубы: снос ветром, подъём, разрастание; плотность падает к концу жизни
      if (burning) {
        s.next -= dt;
        if (s.next <= 0) { s.next = s.burst ? 1.6 : 0.7; this._puff(s, 1.8); }
      }
      for (const p of s.puffs) {
        p.age += dt;
        p.c.x += wind.x * 0.85 * dt; p.c.z += wind.z * 0.85 * dt;
        p.c.y += (0.25 - 0.004 * p.age) * dt;
        const gy = m.terrain.heightAt(p.c.x, p.c.z) + p.r * 0.35;
        if (p.c.y < gy) p.c.y = gy;
        p.r = Math.min(9 * s.size, p.r + dt * (0.55 + 0.25 / (1 + p.age * 0.2)) * s.size);
      }
      s.puffs = s.puffs.filter((p) => p.age < p.life);
      // частицы — только рядом с камерой
      if (!fx || (cam && s.p.distanceToSquared(cam) > 900 * 900)) continue;
      const rate = burning ? (s.burst ? 10 : 14) : 0;
      s.acc = (s.acc || 0) + rate * dt;
      const [cr, cg, cb] = s.color;
      while (s.acc >= 1) {
        s.acc -= 1;
        const src = s.burst && s.puffs.length ? s.puffs[Math.floor(Math.random() * s.puffs.length)].c : s.p;
        const sp = s.burst ? 2.5 : 0.8;
        fx.smoke.emit(src.x + (Math.random() - 0.5) * 0.6, src.y + 0.2, src.z + (Math.random() - 0.5) * 0.6,
          wind.x * 0.8 + (Math.random() - 0.5) * sp, 0.35 + Math.random() * 0.7, wind.z * 0.8 + (Math.random() - 0.5) * sp,
          16 + Math.random() * 8, 1.6 * s.size, (8 + Math.random() * 4) * s.size, cr, cg, cb, 0.62, 0, 0.25, -0.02);
      }
    }
    this.list = this.list.filter((s) => s.t < s.dur || s.puffs.length);
  }

  // плотность дыма на отрезке a→b (0 — чисто, ≥ 1 — не видно)
  density(a, b) {
    let sum = 0;
    _d.subVectors(b, a);
    const L2 = _d.lengthSq();
    if (L2 < 1e-6) return 0;
    for (const s of this.list) {
      // густое облако у горящего источника (разгорается за 3 с)
      if (s.t < s.dur) {
        const R = 3.2 * s.size * Math.min(1, s.t / 3);
        const t = Math.max(0, Math.min(1, ((s.p.x - a.x) * _d.x + (s.p.y + 1 - a.y) * _d.y + (s.p.z - a.z) * _d.z) / L2));
        const dx = a.x + _d.x * t - s.p.x, dy = a.y + _d.y * t - s.p.y - 1, dz = a.z + _d.z * t - s.p.z, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < R * R) { sum += 2 * Math.sqrt(R * R - d2) * 0.32; if (sum >= 1) return sum; }
      }
      for (const p of s.puffs) {
      // ближайшая к центру клуба точка отрезка
      const t = Math.max(0, Math.min(1, ((p.c.x - a.x) * _d.x + (p.c.y - a.y) * _d.y + (p.c.z - a.z) * _d.z) / L2));
      const dx = a.x + _d.x * t - p.c.x, dy = a.y + _d.y * t - p.c.y, dz = a.z + _d.z * t - p.c.z;
      const r = p.r * 0.9, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= r * r) continue;
      // толщина дыма по хорде, с поправкой на возраст клуба (рассеивается)
      const chord = 2 * Math.sqrt(r * r - d2);
      const fade = Math.max(0, 1 - p.age / p.life);
      sum += chord * 0.32 * fade;
      if (sum >= 1) return sum;
      }
    }
    return sum;
  }

  blocks(a, b) { return this.list.length > 0 && this.density(a, b) >= 1; }
}
