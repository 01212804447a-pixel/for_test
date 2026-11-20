// Осветительные факелы на парашюте (снаряд С-463, в будущем — ракеты и мины).
// Факел снижается и сносится ветром, горит заданное время; один общий источник света
// (заранее в сцене, чтобы не перекомпилировать шейдеры) ставится на самый яркий факел рядом
// с камерой, остальные — только свечение. ИИ ночью под факелом видит намного дальше.
import * as THREE from 'three';

const I0 = 200000; // сила света в единицах сцены (≈ 1 у земли под факелом на 450 м; луна — 0,35)

export function flareModel() {
  const g = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.9, side: THREE.DoubleSide });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.4, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2.4), cloth);
  dome.position.y = 4.2; g.add(dome);
  const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(
    Array.from({ length: 8 }, (_, i) => { const a = (i / 8) * Math.PI * 2; return [new THREE.Vector3(0, 0.3, 0), new THREE.Vector3(Math.sin(a) * 1.1, 4.6, Math.cos(a) * 1.1)]; }).flat()),
  new THREE.LineBasicMaterial({ color: 0x888880 }));
  g.add(lines);
  const torch = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.45, 10), new THREE.MeshBasicMaterial({ color: 0xfffbe8 }));
  g.add(torch);
  return g;
}

export class Flares {
  constructor(m) {
    this.m = m;
    this.list = [];
    this.light = new THREE.PointLight(0xfff0d8, 0, 1700, 2);
    this.light.position.set(0, -1000, 0);
    m.scene.add(this.light);
    this._proto = null;
  }

  add(pos, { dur = 50, fall = 5 } = {}) {
    if (!this._proto) this._proto = flareModel();
    const mesh = this._proto.clone();
    mesh.position.copy(pos);
    this.m.scene.add(mesh);
    const f = { p: pos.clone(), t: 0, dur, fall, mesh, flick: Math.random() * 10 };
    this.list.push(f);
    while (this.list.length > 8) this._remove(this.list.shift());
    return f;
  }

  _remove(f) { this.m.scene.remove(f.mesh); }

  // яркость факела 0..1: разгорается за 1,5 с, к концу тускнеет и мерцает
  _k(f) {
    const a = Math.min(1, f.t / 1.5), b = Math.min(1, (f.dur - f.t) / 4);
    return Math.max(0, a * b) * (0.88 + 0.12 * Math.sin(f.t * 23 + f.flick) * Math.sin(f.t * 7.3));
  }

  update(dt) {
    const m = this.m, wind = m.wind, fx = m.fx, cam = m.camPos;
    let best = null, bestS = 0;
    for (const f of this.list) {
      f.t += dt;
      const gy = m.terrain.heightAt(f.p.x, f.p.z);
      if (f.p.y > gy + 0.3) {
        f.p.y -= f.fall * dt;
        if (wind) { f.p.x += wind.x * 0.9 * dt; f.p.z += wind.z * 0.9 * dt; }
      } else { f.p.y = gy + 0.3; f.mesh.children[0].visible = false; }
      f.mesh.position.copy(f.p);
      const k = this._k(f);
      if (fx && k > 0) {
        // свечение и дымный след
        fx.glow.emit(f.p.x, f.p.y, f.p.z, 0, 0, 0, 0.06, 9 * k, 9 * k, 1, 0.96, 0.86, 1, 0);
        fx.glow.emit(f.p.x, f.p.y, f.p.z, 0, 0, 0, 0.06, 2.2, 2.2, 1, 1, 1, 1, 0);
        if (Math.random() < dt * 6) fx.smoke.emit(f.p.x, f.p.y - 0.2, f.p.z, 0, -0.3, 0, 6, 0.4, 3, 0.8, 0.8, 0.8, 0.25, 0, 0.3, 0);
      }
      const d2 = cam ? Math.max(1, f.p.distanceToSquared(cam)) : 1;
      const score = k / Math.sqrt(d2);
      if (score > bestS) { bestS = score; best = f; }
    }
    if (best) { this.light.position.copy(best.p); this.light.intensity = I0 * this._k(best); }
    else this.light.intensity = 0;
    for (const f of this.list) if (f.t >= f.dur + 8) this._remove(f);
    this.list = this.list.filter((f) => f.t < f.dur + 8);
  }

  // освещённость точки факелами (0 — темно, 1 — как днём для глаза наблюдателя)
  lightAt(pos) {
    let L = 0;
    for (const f of this.list) {
      const k = this._k(f);
      if (k <= 0) continue;
      const d2 = Math.max(100, f.p.distanceToSquared(pos));
      L += (I0 * k) / d2;
    }
    return Math.min(1, L / 0.6);
  }
}
