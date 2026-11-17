// Интерфейс в бою: компас, задачи, рация, оружие (без прицельной точки!), состояние,
// отделение, техника, карта, эффекты подавления и ранений, оптика.
import * as THREE from 'three';
import { CARDINALS, formatMil, TAU, clamp } from '../core/math.js';
import { WEAPONS, AMMO } from '../data/weapons.js';

const el = (tag, cls, parent, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; if (parent) parent.appendChild(e); return e; };

function magWord(n, cap) {
  if (cap <= 1) return n > 0 ? 'заряжен' : 'пусто';
  const f = n / cap;
  if (n === 0) return 'пусто';
  if (f >= 0.97) return 'полный';
  if (f > 0.6) return 'больше половины';
  if (f > 0.35) return 'около половины';
  if (f > 0.12) return 'меньше половины';
  return 'почти пуст';
}

export class HUD {
  constructor(root) {
    this.root = root;
    this.scopeCanvas = el('canvas', 'scope', root);
    this.vig = el('div', 'vig', root);
    this.dmg = el('div', 'dmg', root);
    this.compass = el('canvas', 'compass', root); this.compass.width = 720; this.compass.height = 56;
    this.obj = el('div', 'objectives', root);
    this.radioBox = el('div', 'radio', root);
    this.squad = el('div', 'squad', root);
    this.status = el('div', 'status', root);
    this.weapon = el('div', 'weapon', root);
    this.veh = el('div', 'veh', root);
    this.prompt = el('div', 'prompt', root);
    this.msg = el('div', 'msg', root);
    this.big = el('div', 'bigmsg', root);
    this.gren = el('div', 'gren', root, '💣 ГРАНАТА');
    this.weather = el('div', 'weather', root);
    this.mapBox = el('div', 'mapbox', root);
    this.mapCanvas = el('canvas', '', this.mapBox); this.mapCanvas.width = this.mapCanvas.height = 760;
    this.tab = el('div', 'tabbox', root);
    this.hint = el('div', 'hint', root);
    this.msgT = 0; this.bigT = 0; this.dmgT = 0; this.grenT = 0;
    this.radioLines = [];
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    this.scopeCanvas.width = innerWidth; this.scopeCanvas.height = innerHeight;
  }
  show() { this.root.style.display = 'block'; }
  hide() { this.root.style.display = 'none'; }

  reset() {
    this.radioLines = []; this.radioBox.innerHTML = ''; this.msgT = 0; this.bigT = 0;
    this.big.style.opacity = 0; this.msg.style.opacity = 0;
  }

  message(text, dur = 2.5, big = false) {
    if (big) { this.big.textContent = text; this.bigT = dur; this.big.style.opacity = 1; return; }
    this.msg.textContent = text; this.msgT = dur; this.msg.style.opacity = 1;
  }

  radio(from, text, important = false, enemy = false) {
    const line = el('div', 'rl' + (important ? ' imp' : '') + (enemy ? ' enemy' : ''), null, `<b>${from}:</b> ${text}`);
    this.radioBox.appendChild(line);
    this.radioLines.push({ e: line, t: important ? 12 : 7 });
    while (this.radioLines.length > 7) { const r = this.radioLines.shift(); r.e.remove(); }
  }

  setObjectives(m) {
    const st = m.stages[m.stageIdx];
    if (!st) { this.obj.innerHTML = ''; return; }
    let h = `<div class="ot">${m.def.title.toUpperCase()} · этап ${m.stageIdx + 1}/${m.stages.length}</div>`;
    for (const o of st.objs) h += `<div class="oi ${o.done ? 'done' : ''}">${o.done ? '☑' : '☐'} ${o.text}<span class="opg" data-k="${st.objs.indexOf(o)}"></span></div>`;
    this.obj.innerHTML = h;
  }

  hit(d, dir, yaw) {
    this.dmgT = Math.min(1, this.dmgT + d / 40 + 0.3);
    if (dir) {
      // направление, откуда прилетело
      const a = Math.atan2(-dir.x, -dir.z) - yaw;
      const ang = -a + Math.PI;
      this.dmg.style.background = `radial-gradient(ellipse at ${50 + Math.sin(ang) * 45}% ${50 - Math.cos(ang) * 45}%, rgba(160,0,0,0.55), rgba(120,0,0,0) 45%), radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(120,0,0,0.5))`;
    } else this.dmg.style.background = 'radial-gradient(ellipse at center, rgba(0,0,0,0) 50%, rgba(140,0,0,0.6))';
  }

  grenade() { this.grenT = 2.5; }

  update(m, dt) {
    const p = m.player, b = p.body;
    // таймеры
    this.msgT -= dt; if (this.msgT <= 0) this.msg.style.opacity = 0;
    this.bigT -= dt; if (this.bigT <= 0) this.big.style.opacity = 0;
    this.dmgT = Math.max(0, this.dmgT - dt * 0.6); this.dmg.style.opacity = this.dmgT;
    this.grenT -= dt; this.gren.style.opacity = this.grenT > 0 ? (Math.sin(this.grenT * 12) > 0 ? 1 : 0.5) : 0;
    for (const r of this.radioLines) { r.t -= dt; r.e.style.opacity = clamp(r.t, 0, 1); }
    // подавление и ранения
    const sup = p.suppression, hp = b.health / b.maxHealth;
    const v = Math.max(sup * 0.75, (1 - hp) * 0.55);
    this.vig.style.opacity = v;
    m.renderer.domElement.style.filter = sup > 0.35 ? `blur(${((sup - 0.35) * 2.2).toFixed(2)}px) saturate(${(1 - sup * 0.4).toFixed(2)})` : (hp < 0.3 ? 'saturate(0.6)' : '');
    this.drawCompass(m);
    // задачи — прогресс
    const st = m.stages[m.stageIdx];
    if (st) this.obj.querySelectorAll('.opg').forEach((e) => { const o = st.objs[+e.dataset.k]; if (o && o.progress) e.textContent = ' ' + o.progress(); });
    // оружие
    const ws = p.state;
    let wh = '';
    if (p.vehicle && p.seat === 1 && p.vehicle.type.turret) {
      const vv = p.vehicle;
      wh = `<div class="wn">ПКТ (башня МТ-ЛБ)</div><div>Лента: ${magWord(vv.gunAmmo, vv.gunWeapon.mag)} · коробов: ${vv.gunMags}</div><div class="ws">Прицел ПП-61АМ, пристрелка 200 м${p.gunnerSight ? '' : ' (ПКМ — прицел)'}</div>`;
    } else if (p.vehicle && p.seat !== 1) {
      wh = '';
    } else if (ws && ws.grenade) wh = `<div class="wn">Ручная граната Ф-1</div><div>Осталось: ${ws.count}</div><div class="ws">ЛКМ — бросок, ПКМ — катнуть. Удерживайте для «выдержки».</div>`;
    else if (ws && ws.binocular) wh = `<div class="wn">Бинокль Б-8 (8×)</div><div class="ws">ПКМ — смотреть. Угломерная сетка: D = H×1000 / тыс.${m.squadGroup && m.squadGroup.members.some((x) => x.role === 'sniper' && x.alive) ? '<br>ЛКМ — запросить дальность у наблюдателя' : ''}</div>`;
    else {
      const aw = p.activeWeapon;
      if (aw) {
        const def = aw.def;
        const mags = aw.spare.map((n) => `<i style="--f:${(n / def.mag).toFixed(2)}"></i>`).join('');
        wh = `<div class="wn">${p.uglMode ? 'ГП-25 (подствольник)' : def.name}${def.modes.length > 1 ? ` · ${aw.mode === 'auto' ? 'АВ' : 'ОД'}` : ''}</div>` +
          `<div>${def.mag > 1 ? 'Магазин' : 'Ствол'}: ${magWord(aw.mag, def.mag)}${p.reloadT > 0 ? ' · <b>перезарядка</b>' : ''}</div>` +
          `<div class="mags">${def.mag > 1 ? mags : `запас: ${aw.spare.length}`}</div>` +
          `<div class="ws">${p.sightLabel(aw)}</div>` +
          (aw.pattern && !p.uglMode ? `<div class="ws">Патрон: ${AMMO[p.nextRound(aw)].short || ''}</div>` : '') +
          (ws.ugl && !p.uglMode && aw === ws ? `<div class="ws">ГП-25: ${ws.ugl.mag + ws.ugl.spare.length} ВОГ (X)</div>` : '');
      }
    }
    if (!p.vehicle || p.seat === 1) wh += `<div class="ws">Гранаты: ${p.slots[2].count} · ИПП: ${b.medkits}${p.slots[1] ? ` · РПГ: ${p.slots[1].mag + p.slots[1].spare.length}` : ''}</div>`;
    if (this._wh !== wh) { this.weapon.innerHTML = wh; this._wh = wh; }
    // состояние
    const stance = b.stance === 'stand' ? 'стоя' : b.stance === 'crouch' ? 'с колена' : 'лёжа';
    const cond = hp > 0.85 ? 'норма' : hp > 0.6 ? 'лёгкое ранение' : hp > 0.3 ? 'ранен' : 'тяжело ранен';
    const sh = `<div>Состояние: <b class="${hp < 0.6 ? 'bad' : ''}">${cond}</b>${b.bleeding > 0.05 ? ' · <b class="bad">кровотечение (K)</b>' : ''}</div>` +
      `<div class="bar"><i style="width:${(hp * 100).toFixed(0)}%;background:${hp > 0.6 ? '#9fc79a' : hp > 0.3 ? '#e0b050' : '#d0503c'}"></i></div>` +
      `<div class="sm">Положение: ${stance} · выносливость</div><div class="bar thin"><i style="width:${(p.stamina * 100).toFixed(0)}%"></i></div>` +
      (p.aimT > 0.5 ? `<div class="sm">Дыхание (Shift)</div><div class="bar thin"><i style="width:${(p.breath * 100).toFixed(0)}%;background:${p.breathLock > 0 ? '#d0503c' : '#8fb4d8'}"></i></div>` : '');
    if (this._sh !== sh) { this.status.innerHTML = sh; this._sh = sh; }
    // техника
    if (p.vehicle) {
      const vv = p.vehicle;
      const vh = `<div class="wn">${vv.type.name}</div><div>${p.seatName()} · ${(Math.abs(vv.speed) * 3.6).toFixed(0)} км/ч</div><div class="bar"><i style="width:${(Math.max(0, vv.hp) / vv.type.hp * 100).toFixed(0)}%"></i></div><div class="sm">W/S — газ/тормоз, A/D — руль, Space — стояночный, C — камера, 1/2 — место, E — выход${p.seat > 1 ? ', R — пополнить БК' : ''}</div>`;
      if (this._vh !== vh) { this.veh.innerHTML = vh; this._vh = vh; }
      this.veh.style.display = 'block';
    } else this.veh.style.display = 'none';
    // взаимодействие
    if (p.interact && !p.vehicle) {
      const it = p.interact;
      const prog = it.hold ? clamp(p.holdE / it.hold, 0, 1) : 0;
      this.prompt.innerHTML = `<b>E</b> — ${it.label}${it.hold ? `<div class="bar thin"><i style="width:${(prog * 100).toFixed(0)}%"></i></div>` : ''}`;
      this.prompt.style.display = 'block';
    } else this.prompt.style.display = 'none';
    // погода (сводка, как в боевом распоряжении)
    const e = m.def.env;
    const wtxt = `t ${e.tempC} °C · ветер ${CARDINALS[Math.round(e.windFrom / 45) % 8]} ${e.wind} м/с · видимость ~${e.visibility} м`;
    if (this._wt !== wtxt) { this.weather.textContent = wtxt; this._wt = wtxt; }
    // отделение
    if (m.squadGroup) {
      let qh = '';
      for (const s of m.squadGroup.members) {
        const hpf = s.alive ? s.health / s.maxHealth : 0;
        const br = s.brain;
        let stt = !s.alive ? 'выбыл' : s.vehicle ? 'в машине' : br.healTarget ? 'помогает раненому' : s.reloadT > 0 ? 'перезаряжается' : br.fire.mode === 'suppress' ? 'подавляет' : br.fire.mode === 'aimed' ? 'ведёт огонь' : br.cover ? 'в укрытии' : br.state === 'combat' ? 'в бою' : (br.order ? { follow: 'следует', hold: 'держит', move: 'выдвигается', suppress: 'подавляет' }[br.order.type] : '');
        qh += `<div class="sq ${s.alive ? '' : 'dead'}"><b>${s.callsign}</b> <span>${stt}</span><div class="bar thin"><i style="width:${(hpf * 100).toFixed(0)}%;background:${hpf > 0.6 ? '#9fc79a' : '#e0b050'}"></i></div></div>`;
      }
      if (this._qh !== qh) { this.squad.innerHTML = qh; this._qh = qh; }
    }
    // Tab — подробно
    if (m.squadVisible && m.squadGroup) {
      let th = '<div class="ot">ОТДЕЛЕНИЕ</div><table><tr><th>Позывной</th><th>Роль</th><th>Здоровье</th><th>БК</th><th>Приказ</th><th>Убито</th></tr>';
      for (const s of m.squadGroup.members) {
        th += `<tr class="${s.alive ? '' : 'dead'}"><td>${s.callsign}</td><td>${s.role}</td><td>${Math.max(0, s.health).toFixed(0)}</td><td>${(s.ammoFrac * 100).toFixed(0)}%</td><td>${s.brain.order ? s.brain.order.type : ''}</td><td>${s.kills}</td></tr>`;
      }
      th += '</table><div class="sm">F — за мной · H — стоять · T — к точке взгляда · V — огонь на подавление по точке взгляда</div>';
      this.tab.innerHTML = th; this.tab.style.display = 'block';
    } else this.tab.style.display = 'none';
    // карта
    if (m.mapVisible) { this.mapBox.style.display = 'block'; this.drawMap(m); } else this.mapBox.style.display = 'none';
  }

  drawCompass(m) {
    const c = this.compass, g = c.getContext('2d');
    const W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    const p = m.player;
    let yaw = p.vehicle && p.seat === 1 && p.vehicle.type.turret ? p.yaw : p.yaw;
    if (p.scoped) {
      const d = new THREE.Vector3(0, 0, -1).applyQuaternion(m.camera.quaternion);
      yaw = Math.atan2(-d.x, -d.z);
    }
    let az = -yaw; az = ((az % TAU) + TAU) % TAU;
    const span = Math.PI * 0.6;
    const px = (a) => { let d = a - az; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return W / 2 + (d / span) * W; };
    g.fillStyle = 'rgba(10,14,18,0.35)'; g.fillRect(0, 0, W, 30);
    g.strokeStyle = 'rgba(230,235,240,0.8)'; g.fillStyle = 'rgba(230,235,240,0.9)';
    g.font = '13px Arial'; g.textAlign = 'center';
    for (let deg = 0; deg < 360; deg += 5) {
      const a = (deg * Math.PI) / 180;
      const x = px(a);
      if (x < 0 || x > W) continue;
      const big = deg % 45 === 0, mid = deg % 15 === 0;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, big ? 14 : mid ? 9 : 5); g.stroke();
      if (big) { g.font = 'bold 14px Arial'; g.fillText(CARDINALS[deg / 45], x, 27); g.font = '13px Arial'; }
      else if (mid) g.fillText(String(deg), x, 25);
    }
    // задачи
    const st = m.stages[m.stageIdx];
    if (st) for (const o of st.objs) {
      if (o.done) continue;
      const mk = o.marker && o.marker();
      if (!mk) continue;
      const b = p.body.pos;
      const a = Math.atan2(mk.x - b.x, -(mk.z - b.z));
      const x = clamp(px((a + TAU) % TAU), 6, W - 6);
      g.fillStyle = '#ffd24a';
      g.beginPath(); g.moveTo(x, 30); g.lineTo(x - 6, 40); g.lineTo(x + 6, 40); g.fill();
      g.font = '11px Arial';
      g.fillText(`${Math.hypot(mk.x - b.x, mk.z - b.z).toFixed(0)} м`, x, 52);
    }
    g.fillStyle = '#fff'; g.fillRect(W / 2 - 1, 0, 2, 18);
    g.font = 'bold 12px Arial';
    g.fillText(`${((az * 180) / Math.PI).toFixed(0)}° (${formatMil(az)})`, W / 2 + 70, 46);
  }

  drawMap(m) {
    const c = this.mapCanvas, g = c.getContext('2d');
    const S = c.width;
    g.drawImage(m.mapImage, 0, 0, S, S);
    const toPx = (x, z) => [((x + 1100) / 2200) * S, ((z + 1100) / 2200) * S];
    // сетка 100 м
    g.strokeStyle = 'rgba(40,60,80,0.25)'; g.lineWidth = 1;
    g.font = '10px Arial'; g.fillStyle = 'rgba(30,40,50,0.7)';
    for (let k = -1100; k <= 1100; k += 100) {
      const [a] = toPx(k, 0); g.beginPath(); g.moveTo(a, 0); g.lineTo(a, S); g.stroke();
      const [, b] = toPx(0, k); g.beginPath(); g.moveTo(0, b); g.lineTo(S, b); g.stroke();
    }
    // задачи
    const st = m.stages[m.stageIdx];
    if (st) for (const o of st.objs) {
      const mk = !o.done && o.marker && o.marker();
      if (!mk) continue;
      const [x, y] = toPx(mk.x, mk.z);
      g.strokeStyle = '#d8a000'; g.lineWidth = 3; g.beginPath(); g.arc(x, y, 9, 0, 6.3); g.stroke();
    }
    // техника
    for (const v of m.vehicles) {
      if (!v.alive) continue;
      const known = v.team === 'negs' && v.crewTeam !== 'denter';
      if (!known) continue;
      const [x, y] = toPx(v.pos.x, v.pos.z);
      g.fillStyle = '#2a5ab0'; g.fillRect(x - 4, y - 4, 8, 8);
    }
    // противник, замеченный отделением за последние 8 с
    const seen = new Set();
    if (m.squadGroup) for (const s of m.squadGroup.members) {
      if (!s.alive || !s.brain) continue;
      for (const [t, mm] of s.brain.memory) if (t.alive && m.time - mm.lastSeen < 8) seen.add(t);
    }
    g.fillStyle = '#c02020';
    for (const t of seen) { const [x, y] = toPx(t.pos.x, t.pos.z); g.beginPath(); g.arc(x, y, t.isVehicle ? 6 : 4, 0, 6.3); g.fill(); }
    // своё отделение
    if (m.squadGroup) for (const s of m.squadGroup.members) {
      if (!s.alive) continue;
      const [x, y] = toPx(s.pos.x, s.pos.z);
      g.fillStyle = '#3070d0'; g.beginPath(); g.arc(x, y, 3.5, 0, 6.3); g.fill();
    }
    // игрок
    const b = m.player.body.pos;
    const [x, y] = toPx(b.x, b.z);
    const yaw = m.player.yaw;
    g.save(); g.translate(x, y); g.rotate(-yaw);
    g.fillStyle = '#ffffff'; g.strokeStyle = '#000';
    g.beginPath(); g.moveTo(0, -10); g.lineTo(6, 7); g.lineTo(0, 3); g.lineTo(-6, 7); g.closePath(); g.fill(); g.stroke();
    g.restore();
    g.fillStyle = 'rgba(0,0,0,0.75)'; g.font = 'bold 13px Arial';
    g.fillText('С ↑', S - 40, 22);
    g.fillText('сетка 100 м', 12, S - 12);
  }
}
