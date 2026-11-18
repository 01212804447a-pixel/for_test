// Интерфейс наводчика Д-30: панель приборов, сетки панорамы ПГ-1М и прицела ОП4М-45,
// карта огня с измерением дальности и дирекционного угла, таблица стрельбы, гайд.
import { MIL, CHARGES, firingTable, fmtDiv, fmtSigned, dirAngle, toGrid, GRID } from './d30.js';

const CARD = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];

export class GunUI {
  constructor(h) {
    this.h = h; this.m = h.m;
    const root = this.m.hud.root;
    this.panel = document.createElement('div'); this.panel.className = 'gunpanel';
    this.ret = document.createElement('canvas'); this.ret.className = 'gunret';
    root.appendChild(this.ret); root.appendChild(this.panel);
    this.acc = 0;
    this.mapImg = null;
  }

  show(on) { this.panel.style.display = on ? 'block' : 'none'; this.ret.style.display = on ? 'block' : 'none'; this.m.hud.root.classList.toggle('gunner', on); if (on) this.update(1); }

  update(dt) {
    this.acc += dt;
    this.drawReticle();
    if (this.acc < 0.12) return;
    this.acc = 0;
    const h = this.h;
    const ch = h.charge;
    const diff = h.elM - h.wantEl;
    const bub = Math.max(-1, Math.min(1, diff / 12));
    const ok = Math.abs(diff) < 0.6;
    const ls = h.loadStatus();
    const st = h.loaded ? `<b class="ok">ЗАРЯЖЕНО</b> (заряд ${CHARGES[h.loaded.ci].name}, ${h.loaded.fuze === 'О' ? 'оск.' : 'фуг.'})` : ls ? `заряжают: ${ls}` : '<span class="warn">не заряжено</span> — R';
    this.panel.innerHTML = `
      <div class="gt">${h.name} · наводчик</div>
      <div class="gr"><span>Снаряд</span><b>ОФ-462</b></div>
      <div class="gr"><span>Заряд (1–6)</span><b>${ch.name}</b></div>
      <div class="gr"><span>Взрыватель (X)</span><b>${h.fuze === 'О' ? 'осколочное' : 'фугасное'}</b></div>
      <div class="gr"><span>Орудие</span>${st}</div>
      <hr>
      <div class="gr big"><span>Угломер</span><b>${fmtDiv(h.az)}</b></div>
      <div class="gr big"><span>Прицел ([ ])</span><b>${Math.round(h.drum)}</b></div>
      <div class="gr big"><span>Уровень (− =)</span><b>${fmtDiv(h.level)}</b></div>
      <div class="vial"><div class="vial-c"></div><div class="vial-b ${ok ? 'ok' : ''}" style="left:${50 + bub * 44}%"></div></div>
      <div class="gr"><span>Пузырёк</span><b>${ok ? 'на середине' : diff > 0 ? 'ствол выше — S' : 'ствол ниже — W'}</b></div>
      <div class="gr"><span>Возвышение ствола</span><b>${fmtDiv(h.elM)}</b></div>
      <hr>
      <div class="gk">A/D, мышь — поворотный маховик · W/S, мышь — подъёмный · Shift — быстро<br>
      ЛКМ/Пробел — выстрел · R — заряжать · V — вид (${{ eye: 'обзор', pano: 'ПГ-1М', op4m: 'ОП4М-45', side: 'со стороны' }[h.view]})<br>
      M — карта огня · T — таблица стрельбы · G — гайд · E — выйти</div>`;
  }

  // ---------- сетки прицелов ----------
  drawReticle() {
    const c = this.ret, h = this.h;
    const W = innerWidth, H = innerHeight;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = c.getContext('2d');
    g.clearRect(0, 0, W, H);
    if (h.view !== 'pano' && h.view !== 'op4m') return;
    const cx = W / 2, cy = H / 2, R = H * 0.46;
    // окуляр
    g.save();
    g.fillStyle = '#000';
    g.beginPath(); g.rect(0, 0, W, H); g.arc(cx, cy, R, 0, Math.PI * 2, true); g.fill();
    const vg = g.createRadialGradient(cx, cy, R * 0.82, cx, cy, R);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.85)');
    g.fillStyle = vg; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#111'; g.fillStyle = '#111'; g.lineWidth = 1.6;
    g.font = '12px Arial'; g.textAlign = 'center';
    const fov = h.view === 'pano' ? 10.7 : 9;
    const pxPerMil = (H / 2) / Math.tan((fov * Math.PI) / 360) * MIL;
    if (h.view === 'pano') {
      // ПГ-1М: перекрестие со шкалой 0-10 … 0-50 влево и вправо
      g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx - 6, cy); g.moveTo(cx + 6, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy - 6); g.moveTo(cx, cy + 6); g.lineTo(cx, cy + R); g.stroke();
      for (let k = -60; k <= 60; k += 5) {
        if (!k) continue;
        const x = cx + k * pxPerMil, big = k % 10 === 0;
        g.beginPath(); g.moveTo(x, cy - (big ? 9 : 5)); g.lineTo(x, cy + (big ? 9 : 5)); g.stroke();
        if (big && Math.abs(k) <= 50) g.fillText(String(Math.abs(k) / 10), x, cy - 13);
      }
      // отсчёт угломера на барабанах
      g.fillStyle = 'rgba(10,14,18,0.8)'; g.fillRect(cx - 90, cy + R * 0.62, 180, 42);
      g.fillStyle = '#e8f0d0'; g.font = 'bold 22px monospace'; g.fillText(fmtDiv(h.az), cx, cy + R * 0.62 + 27);
      g.font = '11px Arial'; g.fillText('угломер', cx, cy + R * 0.62 + 39);
    } else {
      // ОП4М-45: угольник, боковая шкала, шкала дальностей для выбранного заряда
      g.beginPath(); g.moveTo(cx - 14, cy + 16); g.lineTo(cx, cy); g.lineTo(cx + 14, cy + 16); g.stroke();
      for (let k = -40; k <= 40; k += 5) {
        if (!k) continue;
        const x = cx + k * pxPerMil;
        g.beginPath(); g.moveTo(x, cy); g.lineTo(x, cy + (k % 10 === 0 ? 10 : 5)); g.stroke();
        if (k % 20 === 0) g.fillText(String(Math.abs(k) / 10), x, cy + 22);
      }
      const T = firingTable(h.loaded ? h.loaded.ci : h.ci);
      g.textAlign = 'left';
      for (const r of T.rows) {
        if (r.D > 4000) break;
        if (r.D % 400 !== 0 && r.D > 1200) continue;
        const y = cy + r.sight * pxPerMil;
        if (y > cy + R - 10) break;
        g.beginPath(); g.moveTo(cx - 9, y); g.lineTo(cx + 9, y); g.stroke();
        g.fillText(String(r.D / 100), cx + 13, y + 4);
      }
      g.textAlign = 'center';
      g.fillStyle = 'rgba(10,14,18,0.75)'; g.fillRect(cx - 120, cy + R * 0.72, 240, 26);
      g.fillStyle = '#e8f0d0'; g.font = '13px Arial'; g.fillText(`шкала дальностей: заряд ${CHARGES[h.loaded ? h.loaded.ci : h.ci].name}, ×100 м`, cx, cy + R * 0.72 + 17);
    }
    g.restore();
    // окно камеры снаряда не закрываем маской окуляра
    const hb = this.m.hitcam && this.m.hitcam.box;
    if (hb && hb.style.display === 'block') { const r = hb.getBoundingClientRect(); g.clearRect(r.left - 2, r.top - 2, r.width + 4, r.height + 30); }
  }

  // ---------- карта огня ----------
  fireMap() {
    const m = this.m, h = this.h, ui = m.app.ui;
    const range = m.mapWide ? m.mapWideRange : Math.min(m.terrain.half - 100, 7600);
    if (!this.mapImg) this.mapImg = m.mapWide || m.terrain.makeMapImage(640, range);
    const targets = [...(m.artTargets || []), ...(m.teamMarks ? m.teamMarks() : [])];
    const tg = (t) => { const q = toGrid(t.pos.x, t.pos.z); return `X ${q.X.toLocaleString('ru')} · Y ${q.Y.toLocaleString('ru')} · h ${Math.round(m.terrain.heightAt(t.pos.x, t.pos.z))} м`; };
    const gp = toGrid(h.pos.x, h.pos.z);
    const e = m.def.env;
    ui.show(`<h1>Карта огня</h1>
      <div class="fm"><canvas id="fmc" width="720" height="720"></canvas>
      <div class="fmi">
        <p><b>Огневая позиция (${h.name}):</b><br>X ${gp.X.toLocaleString('ru')} · Y ${gp.Y.toLocaleString('ru')} · h ${Math.round(h.pos.y)} м<br>основное направление ${fmtDiv(m.def.gunDir || 0)}</p>
        <p><b>Цели:</b></p>${targets.map((t) => `<p class="${t.alive ? '' : 'dead'}">${t.name}${t.alive ? '' : ' — подавлена'}<br><small>${tg(t)}<br>${t.desc || ''}${t.by ? ` · доложил ${t.by}, ${Math.round(m.time - t.t)} с назад` : ''}</small></p>`).join('') || '<p class="note">Целей нет. Разведчик отделения докладывает о замеченном противнике сам; ориентир можно указать биноклем (B, ЛКМ).</p>'}
        <p><b>Метео:</b> t ${e.tempC} °C, ветер ${CARD[Math.round(e.windFrom / 45) % 8]} (${fmtDiv(e.windFrom / 360 * 6000)}) ${e.wind} м/с, давление 750 мм рт. ст.</p>
        <div id="fmm" class="fmm">Щёлкните по карте: дальность, дирекционный угол, превышение и угол места от огневой позиции.</div>
      </div></div>
      <div class="row"><button class="btn" data-close>Закрыть (Esc)</button></div>`, { wide: true, cls: 'firemap' });
    const cv = document.getElementById('fmc');
    const g = cv.getContext('2d');
    const S = cv.width, k = S / (2 * range);
    const toPx = (x, z) => [(x + range) * k, (z + range) * k];
    const draw = (mark) => {
      g.drawImage(this.mapImg, 0, 0, S, S);
      // сетка 1 км по прямоугольным координатам
      g.strokeStyle = 'rgba(30,60,120,0.35)'; g.fillStyle = 'rgba(20,40,90,0.8)'; g.font = '10px Arial'; g.lineWidth = 1;
      for (let X = Math.ceil((GRID.X0 - range) / 1000) * 1000; X <= GRID.X0 + range; X += 1000) {
        const z = GRID.X0 - X; const [, py] = toPx(0, z);
        g.beginPath(); g.moveTo(0, py); g.lineTo(S, py); g.stroke(); g.fillText(String(X / 1000), 2, py - 2);
      }
      for (let Y = Math.ceil((GRID.Y0 - range) / 1000) * 1000; Y <= GRID.Y0 + range; Y += 1000) {
        const x = Y - GRID.Y0; const [px] = toPx(x, 0);
        g.beginPath(); g.moveTo(px, 0); g.lineTo(px, S); g.stroke(); g.fillText(String(Y / 1000), px + 2, S - 3);
      }
      // свой БПЛА: круг облёта и борт
      const dr = m.myDrone;
      if (dr) {
        const [cx, cy] = toPx(dr.center.x, dr.center.z);
        g.strokeStyle = 'rgba(20,110,70,0.75)'; g.setLineDash([4, 4]); g.lineWidth = 1.5;
        g.beginPath(); g.arc(cx, cy, Math.max(4, dr.orbit.r * k), 0, 6.3); g.stroke(); g.setLineDash([]);
        if (dr.alive) { const [x, y] = toPx(dr.pos.x, dr.pos.z); g.fillStyle = '#0d6b40'; g.font = 'bold 10px Arial'; g.fillText('✕ БПЛА', x - 4, y + 4); }
      }
      // ориентиры
      g.font = 'italic 11px Arial'; g.fillStyle = 'rgba(30,30,30,0.85)';
      for (const l of m.landmarks || []) { const [px, py] = toPx(l.x, l.z); g.fillRect(px - 2, py - 2, 4, 4); g.fillText(l.name, px + 5, py - 3); }
      // цели
      for (const t of targets) {
        const [px, py] = toPx(t.pos.x, t.pos.z);
        g.strokeStyle = t.alive ? '#c01010' : '#555'; g.lineWidth = 2;
        g.strokeRect(px - 6, py - 6, 12, 12);
        g.fillStyle = t.alive ? '#a00' : '#444'; g.font = 'bold 12px Arial'; g.fillText(t.short || t.name, px + 9, py - 7);
      }
      // разрывы
      for (const r of h.reports) {
        const [px, py] = toPx(r.x, r.z);
        g.fillStyle = '#111'; g.beginPath(); g.arc(px, py, 3, 0, 6.3); g.fill();
        g.font = '10px Arial'; g.fillText(String(r.n), px + 4, py + 10);
      }
      // ОП и направление ствола
      const [gx, gy] = toPx(h.pos.x, h.pos.z);
      g.fillStyle = '#0a4a10'; g.beginPath(); g.moveTo(gx, gy - 9); g.lineTo(gx + 8, gy + 7); g.lineTo(gx - 8, gy + 7); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(10,80,20,0.7)'; g.setLineDash([6, 5]); g.beginPath(); g.moveTo(gx, gy);
      const a = h.az * MIL; g.lineTo(gx + Math.sin(a) * 2000 * k * 4, gy - Math.cos(a) * 2000 * k * 4); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#0a4a10'; g.font = 'bold 12px Arial'; g.fillText('ОП', gx + 10, gy + 4);
      if (mark) {
        const [mx, my] = toPx(mark.x, mark.z);
        g.strokeStyle = '#d06000'; g.lineWidth = 2; g.beginPath(); g.moveTo(gx, gy); g.lineTo(mx, my); g.stroke();
        g.beginPath(); g.arc(mx, my, 5, 0, 6.3); g.stroke();
      }
    };
    draw(null);
    cv.addEventListener('click', (ev) => {
      const r = cv.getBoundingClientRect();
      const px = (ev.clientX - r.left) * (S / r.width), py = (ev.clientY - r.top) * (S / r.height);
      const x = px / k - range, z = py / k - range;
      const dx = x - h.pos.x, dz = z - h.pos.z;
      const D = Math.hypot(dx, dz);
      const hh = m.terrain.heightAt(x, z), dh = hh - h.pos.y;
      const eps = Math.atan2(dh, D) / MIL;
      const q = toGrid(x, z);
      draw({ x, z });
      document.getElementById('fmm').innerHTML = `<b>Точка:</b> X ${q.X.toLocaleString('ru')} · Y ${q.Y.toLocaleString('ru')} · h ${Math.round(hh)} м<br>
        <b>Дальность:</b> ${Math.round(D).toLocaleString('ru')} м<br>
        <b>Дирекционный угол:</b> ${fmtDiv(dirAngle(dx, dz))}<br>
        <b>Превышение:</b> ${dh >= 0 ? '+' : '−'}${Math.abs(Math.round(dh))} м · <b>угол места:</b> ${fmtSigned(eps)} → уровень ${fmtDiv(3000 + eps)}
        ${m.myDrone && m.myDrone.alive ? '<br><button class="btn sec" id="fmdrone">БПЛА: облёт этой точки</button>' : ''}`;
      const b = document.getElementById('fmdrone');
      if (b) b.onclick = () => { m.droneGo(m.myDrone, x, z); m.droneView = true; b.textContent = 'БПЛА направлен — окно камеры: Y'; b.disabled = true; };
    });
  }

  // ---------- таблица стрельбы ----------
  table(ci) {
    const m = this.m, ui = m.app.ui;
    const T = firingTable(ci);
    const e = m.def.env;
    const rows = T.rows.map((r) => `<tr><td>${r.D.toLocaleString('ru')}</td><td><b>${r.sight.toFixed(0)}</b></td><td>${r.dXmil.toFixed(0)}</td><td>${r.t.toFixed(1)}</td><td>${r.drift.toFixed(0)}</td><td>${r.dZw.toFixed(1)}</td><td>${r.dXw.toFixed(0)}</td><td>${r.dXt.toFixed(0)}</td><td>${Math.round(r.top)}</td></tr>`).join('');
    ui.show(`<h1>Таблица стрельбы 122-мм гаубицы Д-30</h1>
      <div class="opc">Снаряд ОФ-462, взрыватель РГМ-2. Заряд <b>${T.charge.name}</b> (V₀ = ${T.charge.v0} м/с). Наибольшая дальность ${Math.round(T.maxRange).toLocaleString('ru')} м при прицеле ${T.maxSight}.</div>
      <div class="row chs">${CHARGES.map((c, i) => `<button class="btn ${i === ci ? '' : 'sec'}" data-ci="${i}">${c.name}</button>`).join('')}</div>
      <div class="tblwrap"><table class="ft">
      <tr><th>Д, м</th><th>Прицел, тыс.</th><th>ΔX<sub>тыс</sub>, м</th><th>t<sub>c</sub>, с</th><th>Z (деривация), тыс.</th><th>Z<sub>w</sub> (бок. ветер 10 м/с), тыс.</th><th>ΔX<sub>w</sub> (встречн. ветер 10 м/с), м</th><th>ΔX<sub>T</sub> (t на −10°), м</th><th>Y<sub>s</sub>, м</th></tr>
      ${rows}</table></div>
      <p class="note">Нормальные условия: t = +15 °C, 750 мм рт. ст., ветра нет, цель на уровне орудия. Сейчас: t = ${e.tempC} °C (ΔT = ${e.tempC - 15}°), ветер ${e.wind} м/с с направления ${fmtDiv(e.windFrom / 360 * 6000)}.<br>
      ΔX<sub>тыс</sub> — изменение дальности при изменении прицела на 1 тыс.; Z — поправка направления на деривацию (снаряд уходит вправо, угломер уменьшить); Z<sub>w</sub> — снос боковым ветром 10 м/с; ΔX<sub>w</sub>, ΔX<sub>T</sub> — изменение дальности; Y<sub>s</sub> — высота траектории.</p>
      <div class="row"><button class="btn" data-close>Закрыть (Esc)</button></div>`, { wide: true, cls: 'fttable' });
    ui.bind('[data-ci]', (b) => this.table(+b.dataset.ci));
  }

  guide() { this.m.app.ui.d30Guide(); }
}
