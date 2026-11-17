// Полёт снарядов: пули, гранаты ГП-25, реактивные гранаты РПГ, ручные гранаты.
// Попадания по зонам тела, бронежилеты, пробитие преград, рикошеты, взрывы,
// подавление (пролёт пуль рядом с головой).
import * as THREE from 'three';
import { stepProjectile, SIM_DT } from '../physics/ballistics.js';
import { AMMO, HAND_GRENADES } from '../data/weapons.js';
import { randn, rand, clamp } from '../core/math.js';

const _p0 = new THREE.Vector3(), _d = new THREE.Vector3(), _t = new THREE.Vector3();

// Ближайшее сближение двух отрезков: возвращает {d2, s} (s — параметр на первом)
function segSeg(p1, q1, p2, q2) {
  const d1x = q1.x - p1.x, d1y = q1.y - p1.y, d1z = q1.z - p1.z;
  const d2x = q2.x - p2.x, d2y = q2.y - p2.y, d2z = q2.z - p2.z;
  const rx = p1.x - p2.x, ry = p1.y - p2.y, rz = p1.z - p2.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z, e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s, t;
  if (e <= 1e-9) { s = a > 1e-9 ? clamp(-(d1x * rx + d1y * ry + d1z * rz) / a, 0, 1) : 0; t = 0; }
  else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    const b = d1x * d2x + d1y * d2y + d1z * d2z;
    const den = a * e - b * b;
    s = den > 1e-9 ? clamp((b * f - c * e) / den, 0, 1) : 0;
    t = (b * s + f) / e;
    if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
  }
  const cx = p1.x + d1x * s - (p2.x + d2x * t), cy = p1.y + d1y * s - (p2.y + d2y * t), cz = p1.z + d1z * s - (p2.z + d2z * t);
  return { d2: cx * cx + cy * cy + cz * cz, s };
}

export class Projectiles {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.grenades = [];
    const rg = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.022, 0.5, 10), new THREE.MeshStandardMaterial({ color: 0x4c5636, roughness: 0.6 }));
    body.rotation.x = Math.PI / 2;
    rg.add(body);
    this.rocketProto = rg;
    this.grenadeGeo = new THREE.DodecahedronGeometry(0.035, 1);
    this.grenadeMat = new THREE.MeshStandardMaterial({ color: 0x4a5532, roughness: 0.7 });
  }

  spawn({ weapon, pos, dir, owner, team }) {
    const ammo = AMMO[weapon.ammo];
    const d = _d.copy(dir).normalize();
    // механическое рассеивание оружия
    const disp = (weapon.disp || 0.3) * 0.001;
    const up = Math.abs(d.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const r1 = new THREE.Vector3().crossVectors(d, up).normalize();
    const r2 = new THREE.Vector3().crossVectors(r1, d).normalize();
    d.addScaledVector(r1, randn() * disp).addScaledVector(r2, randn() * disp).normalize();
    // разброс начальной скорости (партия патронов)
    const v0 = ammo.v0 * (1 + randn() * 0.004);
    const hl = Math.hypot(d.x, d.z) || 1;
    const p = {
      ammo, owner, team, weapon,
      p: pos.clone(), v: d.clone().multiplyScalar(v0), t: 0,
      rx: -d.z / hl, rz: d.x / hl,
      tracer: ammo.tracerEvery ? owner && owner.shotsFired % ammo.tracerEvery === 0 : false,
      alive: true, dist: 0, supp: new Set(), mesh: null, origin: pos.clone(),
      thrustErr: ammo.motor ? new THREE.Vector3(randn() * 0.012, randn() * 0.012, randn() * 0.012) : null,
      ownerVehicle: owner && owner.vehicle ? owner.vehicle : null,
      byPlayer: owner && owner.isPlayer,
    };
    if (owner && owner.vehicle && owner.vehicle.vel) p.v.add(owner.vehicle.vel);
    if (ammo.kind === 'rocket' || ammo.kind === 'grenade') {
      p.mesh = ammo.kind === 'rocket' ? this.rocketProto.clone() : new THREE.Mesh(this.grenadeGeo, this.grenadeMat);
      p.mesh.position.copy(pos);
      this.game.scene.add(p.mesh);
    }
    this.list.push(p);
    if (p.byPlayer) this.game.stats.shots++;
    return p;
  }

  update(dt) {
    const g = this.game;
    const env = g.env;
    for (const p of this.list) {
      let rem = dt;
      while (rem > 1e-6 && p.alive) {
        const h = Math.min(SIM_DT, rem);
        rem -= h;
        _p0.copy(p.p);
        stepProjectile(p, p.ammo, env, h);
        p.dist += _p0.distanceTo(p.p);
        this._collide(p, _p0, p.p);
        if (p.ammo.fuse && p.t > p.ammo.fuse && p.alive) { this.explode(p.p.clone(), p.ammo.explosive, p.owner); p.alive = false; }
        const sp = p.v.length();
        if (p.alive && (p.t > 6 || sp < 60 && p.ammo.kind === 'bullet' || p.p.y < -50)) p.alive = false;
      }
      if (!p.alive) continue;
      if (p.tracer) g.fx.pushTracer(p.p, p.v, g.camPos);
      if (p.mesh) {
        p.mesh.position.copy(p.p);
        _t.copy(p.p).add(p.v);
        p.mesh.lookAt(_t);
        if (p.ammo.kind === 'rocket') {
          const m = p.ammo.motor;
          if (p.t > m.ignite && p.t < m.ignite + m.burn) {
            g.fx.rocketFlame(_t.copy(p.p).addScaledVector(p.v, -0.0015));
            for (let i = 0; i < 2; i++) g.fx.rocketSmoke(p.p, p.v);
          } else if (Math.random() < 0.5) g.fx.rocketSmoke(p.p, p.v);
        }
      }
    }
    this.list = this.list.filter((p) => {
      if (!p.alive && p.mesh) g.scene.remove(p.mesh);
      return p.alive;
    });
    this.updateGrenades(dt);
  }

  _collide(p, a, b) {
    const g = this.game;
    const hit = g.world.raycast(a, b, { mask: 'bullet', vehicles: true, ignore: p.ownerVehicle });
    let best = hit ? { t: hit.t, kind: hit.vehicle ? 'vehicle' : 'static', hit } : null;
    // бойцы
    const segLen = a.distanceTo(b);
    for (const s of g.soldiers) {
      if (!s.alive || s.hidden) continue;
      if (s === p.owner && p.t < 0.2) continue;
      const cx = s.pos.x, cy = s.pos.y + 0.9, cz = s.pos.z;
      // грубый отсев
      const mx = (a.x + b.x) / 2 - cx, my = (a.y + b.y) / 2 - cy, mz = (a.z + b.z) / 2 - cz;
      const rr = segLen / 2 + 5;
      if (mx * mx + my * my + mz * mz > rr * rr) continue;
      // подавление: пролёт рядом с головой
      if (s.team !== p.team && !p.supp.has(s)) {
        const r = segSeg(a, b, s.eye, s.eye);
        if (r.d2 < 12.25) {
          p.supp.add(s);
          const dd = Math.sqrt(r.d2);
          const k = p.ammo.kind === 'bullet' ? (p.ammo.caliber > 0.007 ? 0.42 : 0.34) : 0.6;
          const amount = (1 - dd / 3.5) * k;
          if (s.brain) s.brain.onSuppress(amount, p.owner);
          if (s.isPlayer) g.onPlayerSuppressed(amount, p, dd);
        }
      }
      const hb = s.hitboxes;
      for (let i = 0; i < hb.length; i++) {
        const box = hb[i];
        const r = segSeg(a, b, box.a, box.b);
        if (r.d2 < box.r * box.r) {
          if (!best || r.s < best.t) best = { t: r.s, kind: 'soldier', s, zone: box.zone };
        }
      }
    }
    if (!best) return;
    const pt = new THREE.Vector3().lerpVectors(a, b, best.t);
    if (best.kind === 'soldier') this._hitSoldier(p, best.s, best.zone, pt);
    else if (best.kind === 'vehicle') this._hitVehicle(p, best.hit.vehicle, best.hit, pt);
    else this._hitStatic(p, best.hit, pt, a);
  }

  energy(p) { const v = p.v.length(); return 0.5 * p.ammo.mass * v * v; }

  _hitSoldier(p, s, zone, pt) {
    const g = this.game;
    if (p.ammo.explosive) {
      if (p.dist >= (p.ammo.armDist || 0)) { this.explode(pt, p.ammo.explosive, p.owner); }
      else s.damage(35, zone, p.owner, p.v.clone().normalize());
      p.alive = false; return;
    }
    const E = this.energy(p);
    let dmg = 52 * Math.sqrt(E / 1400) * (p.ammo.dmgK || 1);
    if (zone === 'torso' && s.armor > 0) {
      const stop = 1900 * s.armor;
      if (E < stop) { dmg *= 0.16; if (s.isPlayer) g.hud && g.hud.message('Пуля остановлена бронежилетом', 1.5); }
      else dmg *= 1 - s.armor * 0.25;
    } else if (zone === 'head' && s.helmet > 0 && Math.random() < 0.55) {
      if (E < 1100 * s.helmet) dmg *= 0.1; // рикошет от шлема
    }
    const dir = p.v.clone().normalize();
    s.damage(dmg, zone, p.owner, dir);
    g.fx.impact(pt, dir.clone().negate(), 'blood');
    if (p.byPlayer) { g.stats.hits++; if (!s.alive && s.team !== 'negs') g.stats.kills++; }
    p.alive = false;
  }

  _hitVehicle(p, v, hit, pt) {
    const g = this.game;
    const dir = p.v.clone().normalize();
    if (p.ammo.explosive) {
      if (p.dist >= (p.ammo.armDist || 0)) {
        const pen = p.ammo.explosive.pen || 0;
        v.damageHit(pen, pt, p.owner, true, p.ammo.explosive);
        this.explode(pt, p.ammo.explosive, p.owner, v);
      } else g.fx.impact(pt, hit.normal, 'metal');
      p.alive = false; return;
    }
    const sp = p.v.length();
    const cap = p.ammo.pen * (sp / p.ammo.v0) * (sp / p.ammo.v0);
    const cosI = Math.abs(dir.dot(hit.normal));
    const armor = v.armorAt(hit.normal) / Math.max(0.3, cosI);
    if (cap > armor) {
      v.damageHit(cap, pt, p.owner, false);
      g.fx.impact(pt, hit.normal, 'metal');
      g.audio.impact(pt, 'metal');
      if (p.byPlayer) g.stats.hits++;
      p.alive = false;
    } else {
      g.fx.impact(pt, hit.normal, 'metal');
      g.audio.impact(pt, 'metal');
      if (cosI < 0.35 && Math.random() < 0.6) this._ricochet(p, hit.normal, pt);
      else p.alive = false;
    }
  }

  _ricochet(p, n, pt) {
    const v = p.v;
    const dn = v.dot(n);
    v.addScaledVector(n, -2 * dn).multiplyScalar(rand(0.35, 0.6));
    v.x += randn() * 15; v.y += Math.abs(randn()) * 10; v.z += randn() * 15;
    p.p.copy(pt).addScaledVector(n, 0.02);
    p.tracer = p.tracer && Math.random() < 0.7;
    this.game.audio.ricochet(pt);
  }

  _hitStatic(p, hit, pt, from) {
    const g = this.game;
    const dir = p.v.clone().normalize();
    let mat = hit.mat;
    if (hit.terrain) {
      const m = g.world.terrain.maskAt(pt.x, pt.z);
      mat = m === 2 ? 'ice' : (hit.normal && hit.normal.y < 0.75 ? 'rock' : 'snow');
      if (pt.y < 0.05 && g.world.terrain.hasSea && g.world.terrain.heightAt(pt.x, pt.z) < 0) mat = 'water';
    }
    const o = hit.obstacle;
    const camD = pt.distanceTo(g.camPos);
    if (p.ammo.explosive) {
      if (p.dist >= (p.ammo.armDist || 0) && mat !== 'water') this.explode(pt.clone().addScaledVector(hit.normal, 0.1), p.ammo.explosive, p.owner, null, o && o.owner);
      else { g.fx.impact(pt, hit.normal, mat === 'water' ? 'snow' : mat, 1.5); }
      p.alive = false; return;
    }
    const n = hit.normal;
    // мишень полигона
    if (o && o.owner && o.owner.kind === 'target') {
      const t = o.owner;
      g.fx.addDecal(pt, n.dot(dir) < 0 ? n : n.clone().negate(), 0.012, 0x050505);
      t.hits.push({ x: pt.x, y: pt.y, z: pt.z, t: g.time });
      g.audio.impact(pt, 'target');
      if (g.onTargetHit) g.onTargetHit(t, pt, p);
      p.alive = false; return;
    }
    if (o && o.owner && o.owner.hp !== undefined && o.owner.kind !== 'target') {
      o.owner.hp -= this.energy(p) / 1400 * 2;
      if (o.owner.hp <= 0 && g.onDestructible) g.onDestructible(o.owner, p.owner);
    }
    const cosI = Math.abs(dir.dot(n));
    // рикошет от твёрдых поверхностей по касательной
    if ((mat === 'metal' || mat === 'concrete' || mat === 'rock' || mat === 'ice' || mat === 'water') && cosI < 0.2 && Math.random() < 0.65) {
      if (mat === 'water' || mat === 'ice') g.fx.impact(pt, n, 'snow', 0.7);
      else g.fx.impact(pt, n, mat, 0.6);
      this._ricochet(p, n, pt);
      return;
    }
    // пробитие
    if (o && o.pen > 0) {
      const sp = p.v.length();
      const cap = p.ammo.pen * 5 * (sp / p.ammo.v0) * (sp / p.ammo.v0);
      if (cap > o.pen) {
        p.v.multiplyScalar(Math.sqrt(1 - o.pen / cap));
        p.v.x += randn() * 8; p.v.y += randn() * 8; p.v.z += randn() * 8;
        p.p.copy(pt).addScaledVector(dir, 0.35);
        g.fx.impact(pt, n, mat, 0.8);
        if (camD < 150) g.fx.addDecal(pt, n, 0.02, 0x150f08);
        return;
      }
    }
    g.fx.impact(pt, n, mat === 'water' ? 'snow' : mat, mat === 'snow' ? 1 + Math.min(1.5, camD / 300) : 1);
    if (camD < 60) g.audio.impact(pt, mat);
    if (camD < 180 && mat !== 'snow' && mat !== 'water') g.fx.addDecal(pt, n, mat === 'metal' ? 0.018 : 0.03, mat === 'metal' ? 0x2a2a2a : 0x1a1612);
    p.alive = false;
  }

  // Взрыв: фугасное действие + осколки (с учётом укрытий)
  explode(pos, ex, owner, directVehicle = null, directDestructible = null) {
    const g = this.game;
    const size = clamp(ex.radius / 4, 0.6, 2.2);
    const ground = g.world.terrain.heightAt(pos.x, pos.z);
    g.fx.explosion(pos, size, pos.y - ground < 2);
    g.audio.explosion(pos, size);
    g.noise(pos, 800, owner ? owner.team : null, owner);
    if (pos.y - ground < 0.6) g.fx.addDecal(new THREE.Vector3(pos.x, ground, pos.z), g.world.terrain.normalAt(pos.x, pos.z), ex.radius * 0.9, 0x202020);
    const src = new THREE.Vector3(pos.x, pos.y + 0.25, pos.z);
    for (const s of g.soldiers) {
      if (!s.alive || s.hidden) continue;
      const d = s.chest.distanceTo(pos);
      if (d > ex.frag * 1.6) continue;
      if (s.brain) s.brain.onSuppress(1 - d / (ex.frag * 1.6), owner);
      if (s.isPlayer) g.onPlayerBlast(1 - d / (ex.frag * 1.6));
      if (d > ex.frag) continue;
      const blocked = !!g.world.raycast(src, s.chest, { mask: 'bullet' });
      let dmg = 0;
      if (d < ex.radius) dmg += ex.dmg * Math.pow(1 - d / ex.radius, 1.3) * (blocked ? 0.15 : 1);
      if (!blocked) {
        const expected = 4 * Math.pow(1 - d / ex.frag, 2) * (s.stance === 'prone' ? 0.45 : 1);
        for (let k = 0; k < 6; k++) {
          if (Math.random() < expected / 6) {
            const z = Math.random();
            const zone = z < 0.08 ? 'head' : z < 0.5 ? 'torso' : z < 0.75 ? 'leg' : 'arm';
            let fd = rand(14, 30);
            if (zone === 'torso') fd *= 1 - s.armor * 0.65;
            if (zone === 'head') fd *= 1 - s.helmet * 0.6;
            s.damage(fd, zone, owner, null);
            if (!s.alive) break;
          }
        }
      }
      if (dmg > 0 && s.alive) s.damage(dmg, 'torso', owner, null);
      if (owner && owner.isPlayer && !s.alive && s.team !== 'negs' && !s._countedKill) { s._countedKill = true; g.stats.kills++; }
    }
    for (const v of g.vehicles) {
      if (!v.alive || v === directVehicle) continue;
      const d = v.pos.distanceTo(pos);
      if (d < ex.radius * 2.2) v.damageBlast(ex, d, owner);
    }
    for (const dd of g.world.destructibles) {
      if (!dd.alive) continue;
      const d = Math.max(0, dd.pos.distanceTo(pos) - (dd.r || 1));
      if (dd === directDestructible) { dd.hp -= ex.dmg * (ex.pen > 100 ? 3 : 1.2); }
      else if (d < ex.radius * 1.5) dd.hp -= ex.dmg * (1 - d / (ex.radius * 1.5)) * 0.8;
      if (dd.hp <= 0 && g.onDestructible) g.onDestructible(dd, owner);
    }
  }

  // ----- ручные гранаты -----
  throwGrenade(owner, pos, vel, type = 'f1') {
    const def = HAND_GRENADES[type];
    const mesh = new THREE.Mesh(this.grenadeGeo, this.grenadeMat);
    mesh.scale.setScalar(1.3);
    mesh.position.copy(pos);
    mesh.castShadow = true;
    this.game.scene.add(mesh);
    const gr = { owner, pos: pos.clone(), vel: vel.clone(), fuse: rand(def.fuse[0], def.fuse[1]), mesh, ammo: AMMO[def.ammo], rest: false, warned: false, spin: new THREE.Vector3(rand(-10, 10), rand(-10, 10), rand(-10, 10)) };
    this.grenades.push(gr);
    this.game.audio.pin();
    return gr;
  }

  updateGrenades(dt) {
    const g = this.game;
    for (const gr of this.grenades) {
      gr.fuse -= dt;
      if (!gr.rest) {
        const steps = 4, h = dt / steps;
        for (let i = 0; i < steps; i++) {
          _p0.copy(gr.pos);
          gr.vel.y -= 9.81 * h;
          gr.vel.multiplyScalar(1 - 0.02 * h);
          gr.pos.addScaledVector(gr.vel, h);
          const hit = g.world.raycast(_p0, gr.pos, { mask: 'move', vehicles: true });
          if (hit) {
            const n = hit.normal;
            const soft = hit.terrain && g.world.terrain.maskAt(hit.point.x, hit.point.z) !== 2;
            const e = soft ? 0.18 : 0.42;
            const vn = gr.vel.dot(n);
            gr.vel.addScaledVector(n, -(1 + e) * vn);
            gr.vel.multiplyScalar(soft ? 0.45 : 0.7);
            gr.pos.copy(hit.point).addScaledVector(n, 0.04);
            if (gr.vel.length() < 0.6 && n.y > 0.6) { gr.rest = true; gr.vel.set(0, 0, 0); }
          }
        }
        gr.mesh.rotation.x += gr.spin.x * dt; gr.mesh.rotation.y += gr.spin.y * dt;
      }
      gr.mesh.position.copy(gr.pos);
      // предупреждение
      if (!gr.warned && gr.fuse < 2.5 && gr.owner && gr.owner.team === 'denter') {
        const pd = g.player.body.pos.distanceTo(gr.pos);
        if (pd < 18) { gr.warned = true; g.grenadeWarning(gr); }
      }
      if (gr.fuse <= 0) {
        g.scene.remove(gr.mesh);
        this.explode(gr.pos.clone().add(new THREE.Vector3(0, 0.1, 0)), gr.ammo.explosive, gr.owner);
        gr.done = true;
      }
    }
    this.grenades = this.grenades.filter((x) => !x.done);
  }

  clear() {
    for (const p of this.list) if (p.mesh) this.game.scene.remove(p.mesh);
    for (const gr of this.grenades) this.game.scene.remove(gr.mesh);
    this.list = []; this.grenades = [];
  }
}
