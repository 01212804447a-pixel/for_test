// Экранные меню: главное меню, брифинги, таблицы стрельбы, личный состав, оружейная,
// автопарк, пауза, настройки, итоги задания, финал.
import { STORY } from '../data/story.js';
import { MISSIONS } from '../data/missions.js';
import { ROSTER, STAT_NAMES } from '../data/squad.js';
import { WEAPONS, AMMO, PRIMARY_CHOICES, ammoChoices, defaultPattern, LOADABLE, loadCount, HEAVY_CHOICES } from '../data/weapons.js';
import { VEHICLE_TYPES } from '../entities/vehicle.js';
import { buildFiringTable, handGrenadeTable, TABLE_WEAPONS } from '../physics/firingTable.js';
import { drawChart } from './charts.js';
import { CARDINALS } from '../core/math.js';
import { ACTIONS, DEFAULT_BINDS, keyName } from '../core/input.js';
import { CHARGES, MIL, firingTable, sightFor, fmtDiv, fmtSigned } from '../artillery/d30.js';
import { PVP_MAPS, PVP_WEAPONS, TEAM_NAMES, pvpMap, NET_ROLES, TOW_CHOICES, defaultKit, kitOf } from '../data/pvp.js';
import { defaultServer } from '../net/net.js';
import { lethalityTable } from '../data/lethality.js';

const escH = (t) => String(t ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

const CONTROLS_STATIC = [
  ['W A S D', 'движение'], ['Shift', 'бег / задержка дыхания при прицеливании'], ['Space', 'прыжок'], ['C', 'присесть'], ['Z', 'лечь'],
  ['ЛКМ', 'выстрел'], ['ПКМ (удерживать)', 'прицеливание через целик и мушку / оптику'], ['Колесо / [ ] / PgUp PgDn', 'установка прицела (целик, маховичок, квадрант)'],
  ['R', 'перезарядка'], ['B', 'режим огня (АВ/ОД)'], ['X', 'подствольный ГП-25'], ['O', 'РПГ: оптика ПГО-7 / механический прицел'],
  ['1 2 3 4', 'автомат / гранатомёт / гранаты / бинокль'], ['K', 'перевязка (ИПП)'], ['E', 'взаимодействие / сесть в технику'],
  ['F', 'отделению: за мной'], ['H', 'отделению: стоять, занять оборону'], ['T', 'отделению: выдвинуться в точку взгляда'], ['V', 'отделению: огонь на подавление по точке взгляда'],
  ['Tab', 'состояние отделения'], ['M', 'карта'], ['Esc', 'пауза'],
  ['Техника', 'W/S газ-тормоз, A/D руль, Space — тормоз, C — камера, 1/2 — водитель/стрелок, E — выход'],
];

export class UI {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.panel = document.createElement('div'); this.panel.className = 'panel'; root.appendChild(this.panel);
    this.hqHint = document.createElement('div'); this.hqHint.className = 'hqhint'; document.body.appendChild(this.hqHint);
    this.openState = false;
    this.onClose = null;
  }

  isOpen() { return this.openState; }

  show(html, { onClose = null, wide = false, cls = '' } = {}) {
    this.panel.className = 'panel' + (wide ? ' wide' : '') + (cls ? ' ' + cls : '');
    this.panel.innerHTML = html;
    this.root.style.display = 'flex';
    this.openState = true;
    this.onClose = onClose;
    this.app.input.releaseLock();
    this.panel.scrollTop = 0;
    this.panel.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => this.close()));
    this.app.audio.click();
  }

  close() {
    this.root.style.display = 'none';
    this.openState = false;
    const cb = this.onClose; this.onClose = null;
    if (cb) cb();
    // вернуть управление сразу (клик по кнопке — пользовательский жест для захвата мыши)
    const a = this.app;
    const gesture = !navigator.userActivation || navigator.userActivation.isActive;
    if (gesture && (a.mode === 'hq' || (a.mode === 'mission' && !a.paused)) && !this.openState) {
      a.input.requestLock();
      this.hqPrompt(null);
    }
  }

  bind(sel, fn) { this.panel.querySelectorAll(sel).forEach((e) => e.addEventListener('click', (ev) => { this.app.audio.click(); fn(e, ev); })); }

  hqPrompt(label) {
    if (!label) { this.hqHint.style.display = 'none'; return; }
    this.hqHint.innerHTML = `<b>E</b> — ${label}`;
    this.hqHint.style.display = 'block';
  }

  // ---------------- главное меню ----------------
  mainMenu() {
    const s = this.app.save;
    this.show(`
      <div class="logo">${STORY.title}</div>
      <div class="sub">${STORY.subtitle}</div>
      <div class="menu">
        ${s.started ? '<button class="btn" id="cont">Продолжить (штаб)</button>' : ''}
        <button class="btn" id="new">${s.started ? 'Новая кампания' : 'Начать кампанию'}</button>
        <button class="btn" id="range">Полигон «Норд» (стрельбы)</button>
        <button class="btn" id="net">Сетевая игра (кооператив / PvP)</button>
        <button class="btn" id="tables">Таблицы стрельбы</button>
        <button class="btn" id="set">Настройки</button>
        <button class="btn" id="ctl">Управление</button>
      </div>
      <div class="foot">Реалистичная баллистика: сопротивление воздуха (G7), ветер, температура, деривация, сила Кориолиса, реактивные гранаты.<br>Нет прицельной точки — только целик и мушка или сетка оптического прицела.</div>`, { cls: 'mainmenu' });
    this.bind('#cont', () => { this.close(); this.app.toHQ(); });
    this.bind('#new', () => { this.app.newCampaign(); this.intro(); });
    this.bind('#range', () => { this.close(); this.app.startMission('range'); });
    this.bind('#net', () => this.netMenu());
    this.bind('#tables', () => this.firingTables(() => this.mainMenu()));
    this.bind('#set', () => this.settings(() => this.mainMenu()));
    this.bind('#ctl', () => this.controls(() => this.mainMenu()));
  }

  intro() {
    this.show(`<h1>Заполярье</h1>${STORY.intro.map((p) => `<p class="story">${p}</p>`).join('')}<div class="row"><button class="btn" id="go">В штаб</button></div>`);
    this.bind('#go', () => { this.close(); this.app.toHQ(); });
  }

  controls(back) {
    const inp = this.app.input;
    const rows = ACTIONS.map(([a, label]) => [keyName(inp.code(a)), label]).concat([['Колесо мыши', 'при прицеливании — установка прицела, иначе смена оружия'], ['Esc', 'пауза']]);
    this.show(`<h1>Управление</h1><table class="ctl">${rows.map(([k, v]) => `<tr><td><b>${k}</b></td><td>${v}</td></tr>`).join('')}</table>
      <div class="row"><button class="btn sec" id="keys">Назначить клавиши</button></div>
      <p class="note">Прицеливания «точкой» нет: совместите вершину мушки с серединой прорези целика («ровная мушка») и подведите под цель. Установите прицел по дальности. Пуля вылетает из дульного среза по оси ствола — при раскачке и неровной мушке она уйдёт туда, куда смотрит ствол.</p>
      <div class="row"><button class="btn" id="b">Назад</button></div>`);
    this.bind('#b', () => (back ? back() : this.close()));
    this.bind('#keys', () => this.keybinds(() => this.controls(back)));
  }

  settings(back) {
    const st = this.app.settings;
    this.show(`<h1>Настройки</h1>
      <label>Чувствительность мыши <input type="range" id="sens" min="0.5" max="6" step="0.1" value="${st.sens}"><span id="sv">${st.sens}</span></label>
      <label>Поле зрения (FOV) <input type="range" id="fov" min="55" max="95" step="1" value="${st.fov}"><span id="fv">${st.fov}</span></label>
      <label>Громкость <input type="range" id="vol" min="0" max="1" step="0.05" value="${st.volume}"></label>
      <label>Качество графики <select id="q"><option value="low">Низкое</option><option value="medium">Среднее</option><option value="high">Высокое</option></select></label>
      <label><input type="checkbox" id="inv" ${st.invertY ? 'checked' : ''}> Инвертировать ось Y</label>
      <div class="row"><button class="btn sec" id="keys">Управление: назначить клавиши</button></div>
      <p class="note">Качество применяется при следующей загрузке задания.</p>
      <div class="row"><button class="btn" id="b">Готово</button></div>`);
    const p = this.panel;
    p.querySelector('#q').value = st.quality;
    p.querySelector('#sens').oninput = (e) => { st.sens = +e.target.value; p.querySelector('#sv').textContent = st.sens; };
    p.querySelector('#fov').oninput = (e) => { st.fov = +e.target.value; p.querySelector('#fv').textContent = st.fov; };
    p.querySelector('#vol').oninput = (e) => { st.volume = +e.target.value; this.app.audio.setVolume(st.volume); };
    p.querySelector('#q').onchange = (e) => { st.quality = e.target.value; };
    p.querySelector('#inv').onchange = (e) => { st.invertY = e.target.checked; };
    this.bind('#b', () => { this.app.persist(); back ? back() : this.close(); });
    this.bind('#keys', () => this.keybinds(() => this.settings(back)));
  }

  // Переназначение клавиш: клик по кнопке → нажать новую клавишу или кнопку мыши
  keybinds(back) {
    const inp = this.app.input, st = this.app.settings;
    const render = () => {
      this.show(`<h1>Назначение клавиш</h1><p class="note">Нажмите на действие, затем — новую клавишу или кнопку мыши. Esc — отмена.</p>
        <table class="ctl keys">${ACTIONS.map(([a, label]) => `<tr><td>${label}</td><td><button class="btn key" data-a="${a}">${keyName(inp.code(a))}</button></td></tr>`).join('')}</table>
        <div class="row"><button class="btn" id="b">Готово</button><button class="btn sec" id="def">Сбросить по умолчанию</button></div>`, { wide: true });
      this.panel.querySelectorAll('.key').forEach((btn) => btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        btn.textContent = '…нажмите…';
        const finish = (code) => {
          removeEventListener('keydown', onKey, true); removeEventListener('mousedown', onMouse, true);
          if (code) { inp.binds[btn.dataset.a] = code; st.binds = { ...inp.binds }; this.app.persist(); }
          setTimeout(render, 0);
        };
        const onKey = (e) => { e.preventDefault(); e.stopPropagation(); finish(e.code === 'Escape' ? null : e.code); };
        const onMouse = (e) => { if (e.target === btn) return; e.preventDefault(); e.stopPropagation(); finish('Mouse' + e.button); };
        addEventListener('keydown', onKey, true);
        setTimeout(() => addEventListener('mousedown', onMouse, true), 50);
      }));
      this.bind('#b', () => (back ? back() : this.close()));
      this.bind('#def', () => { inp.binds = { ...DEFAULT_BINDS }; st.binds = { ...DEFAULT_BINDS }; this.app.persist(); render(); });
    };
    render();
  }

  loading(text) {
    this.show(`<h1>${text}</h1><div class="loadbar"><i></i></div><p class="note">Генерация ландшафта, расчёт баллистических таблиц и навигации ИИ…</p>`, { cls: 'loading' });
  }

  // ---------------- таблицы стрельбы ----------------
  firingTables(back) {
    const tabs = [...TABLE_WEAPONS, 'f1'];
    const names = { f1: 'Ф-1' };
    this.show(`<h1>Таблицы стрельбы и траектории</h1>
      <div class="tabs">${tabs.map((id, i) => `<button class="tab ${i ? '' : 'on'}" data-id="${id}">${names[id] || WEAPONS[id].name}</button>`).join('')}</div>
      <div id="ft"></div><div class="row"><button class="btn" id="b">Закрыть</button><button class="btn sec" id="leth">Поражающее действие боеприпасов</button></div>`, { wide: true });
    this.bind('#leth', () => this.lethality(() => this.firingTables(back)));
    const render = (id) => {
      const box = this.panel.querySelector('#ft');
      if (id === 'f1') {
        const t = handGrenadeTable();
        box.innerHTML = `<div class="ftgrid"><div><table class="ft"><tr>${t.columns.map((c) => `<th>${c}</th>`).join('')}</tr>${t.rows.map((r) => `<tr>${r.cells.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>${t.notes.map((n) => `<p class="note">${n}</p>`).join('')}</div><canvas width="900" height="380"></canvas></div>`;
        drawChart(box.querySelector('canvas'), t.chart);
        return;
      }
      const t = buildFiringTable(id);
      const ammo = t.ammo;
      let h = `<div class="ammo">${t.weapon.name} — ${ammo.name}. ${t.weapon.desc}</div>`;
      h += `<table class="ft"><tr>${t.columns.map((c) => `<th>${c}</th>`).join('')}</tr>${t.rows.map((r) => `<tr>${r.cells.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
      if (t.direct) h += `<div class="direct"><b>Дальность прямого выстрела:</b> ${t.direct.map((d) => `${d.name} — <b>${d.R.toFixed(0)} м</b>`).join('; ')}</div>`;
      h += t.charts.map(() => '<canvas width="920" height="360"></canvas>').join('');
      h += t.notes.map((n) => `<p class="note">${n}</p>`).join('');
      box.innerHTML = h;
      box.querySelectorAll('canvas').forEach((cv, i) => drawChart(cv, t.charts[i]));
    };
    this.panel.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
      this.panel.querySelectorAll('.tab').forEach((x) => x.classList.remove('on'));
      b.classList.add('on'); render(b.dataset.id);
    }));
    render(tabs[0]);
    this.bind('#b', () => (back ? back() : this.close()));
  }


  // ---------------- поражающее действие боеприпасов ----------------
  lethality(back = null) {
    const T = lethalityTable();
    const f = (x) => (x < 0.3 ? '—' : x.toFixed(x < 10 ? 1 : 0).replace('.', ','));
    const exRows = T.ex.map((e) => `<tr><td><b>${e.name}</b><br><small>${e.kind}</small></td>
      <td>${f(e.none.r100)} / ${f(e.negs.r100)}</td><td>${f(e.none.r50)} / ${f(e.negs.r50)}</td><td>${f(e.none.rInc)} / ${f(e.negs.rInc)}</td>
      <td>${f(e.none.rHurt)} / ${f(e.negs.rHurt)}</td><td>${f(e.prone.r50)} / ${f(e.prone.rHurt)}</td><td>${f(e.none.rMax)}</td><td>${e.X.pen ? e.X.pen + ' мм' : '—'}</td></tr>`).join('');
    const bRows = T.bullets.map((b) => `<tr><td><b>${b.short}</b><br><small>${b.w}</small></td>
      <td>${b.E.map((x) => Math.round(x)).join(' · ')}</td><td>${b.torso.map((x) => Math.round(x)).join(' · ')}</td><td>${b.hits.join(' · ')}</td>
      <td>${b.plateDenter ? (b.plateDenter >= 1500 ? '> 1500' : b.plateDenter) + ' м' : 'не пробивает'}</td><td>${b.plateNegs ? (b.plateNegs >= 1500 ? '> 1500' : b.plateNegs) + ' м' : 'не пробивает'}</td></tr>`).join('');
    this.show(`<h1>Поражающее действие боеприпасов</h1><div class="opc">Рассчитано по модели урона игры: фугасное действие, осколки с учётом бронежилета и шлема, энергия пуль на дальности</div>
      <h2 class="nh">Взрывчатые боеприпасы — радиусы при разрыве на грунте, м</h2>
      <div class="tblwrap"><table class="ft leth"><tr><th>Боеприпас</th><th>Сплошное поражение (≥ 99 % убит)<br>без защиты / в броне</th><th>50 % убит</th><th>50 % выведен из строя<br>(тяжёлое ранение)</th><th>50 % ранен</th><th>Лёжа: 50 % убит / ранен</th><th>Предельный разлёт осколков</th><th>Пробитие брони</th></tr>${exRows}</table></div>
      <p class="note">«Без защиты / в броне» — боец стоит, грудь на высоте 1,26 м; броня — бронежилет и шлем бойца N.E.G.S. Лёжа поражение резко меньше: осколки идут над землёй, поэтому при разрывах — ложись. Кровотечение после ранения здесь не учтено: раненый без перевязки (K) со временем теряет силы. Взрыватель «Ф» у ОФ-462 даёт меньше осколков, но сильнее бьёт по укрытиям и технике.</p>
      <h2 class="nh">Пули — энергия и действие по дальности 0 · 100 · 300 · 500 · 800 м</h2>
      <div class="tblwrap"><table class="ft leth"><tr><th>Патрон</th><th>Энергия, Дж</th><th>Урон при попадании в корпус (без брони), ед. здоровья из 100</th><th>Попаданий в корпус для поражения</th><th>Пробивает бронеплиту боевика «Дентера» до</th><th>Пробивает бронеплиту бойца N.E.G.S до</th></tr>${bRows}</table></div>
      <p class="note">Бронеплита закрывает ~72 % попаданий в корпус; непробитая плита — запреградная травма (6 ед. + доля энергии). Попадание в голову — урон ×4, в шлем — может срикошетить. Попадание в ногу ×0,6, в руку ×0,45. Сквозное ранение: пуля летит дальше с потерей скорости.</p>
      <div class="row"><button class="btn" id="b">${back ? 'Назад' : 'Закрыть'}</button></div>`, { wide: true, cls: 'fttable' });
    this.bind('#b', () => (back ? back() : this.close()));
  }

  // ---------------- операции ----------------
  operations() {
    const s = this.app.save;
    // учебные выходы доступны всегда; операция открывается после предыдущей боевой
    const avail = (i) => {
      if (MISSIONS[i].training) return true;
      let j = i - 1; while (j >= 0 && MISSIONS[j].training) j--;
      return j < 0 || !!s.completed[MISSIONS[j].id];
    };
    const num = (i) => MISSIONS.slice(0, i + 1).filter((q) => !q.training).length;
    this.show(`<h1>Карта операций</h1><div class="ops">${MISSIONS.map((m, i) => `
      <div class="op ${avail(i) ? '' : 'locked'} ${s.completed[m.id] ? 'done' : ''}" data-i="${i}">
        <div class="opt">${m.training ? '◆' : num(i) + '.'} ${m.title}</div><div class="opc">${m.code}</div>
        <div class="ops2">${s.completed[m.id] ? '✔ выполнено' : avail(i) ? 'доступно' : '🔒 нужна предыдущая операция'}</div>
      </div>`).join('')}</div><div class="row"><button class="btn" id="b">Закрыть</button></div>`, { wide: true });
    this.bind('.op', (e) => { const i = +e.dataset.i; if (avail(i)) this.briefing(MISSIONS[i]); });
    this.bind('#b', () => this.close());
  }

  briefing(m) {
    const s = this.app.save;
    const e = m.env;
    const timeName = { day: 'день (низкое солнце)', dusk: 'полярные сумерки', night: 'полярная ночь' }[e.time];
    const squad = m.noSquad ? [] : s.squad.filter((id) => !(s.hospital[id] > 0));
    const seats = (s.vehicles || []).reduce((a, v) => a + (VEHICLE_TYPES[v].troop ?? VEHICLE_TYPES[v].seats), 0);
    this.show(`<h1>${m.title}</h1><div class="opc">${m.code}</div>
      <div class="brief">${m.brief.split('\n').map((p) => `<p>${p}</p>`).join('')}</div>
      <div class="cond"><b>Условия:</b> ${timeName}; t = ${e.tempC} °C; ветер ${CARDINALS[Math.round(e.windFrom / 45) % 8]} (${e.windFrom}°), ${e.wind} м/с; видимость ~${e.visibility} м${e.snow > 0.3 ? '; снегопад' : ''}${e.aurora ? '; северное сияние' : ''}.</div>
      ${m.noSquad ? '' : `<div class="cond"><b>Отделение:</b> ${squad.map((id) => '«' + ROSTER.find((r) => r.id === id).callsign + '»').join(', ') || 'Кей идёт один'}.<br><b>Оружие Кея:</b> ${WEAPONS[s.primary].name}${s.launcher ? ' + ' + WEAPONS[s.launcher === true ? 'rpg7' : s.launcher].name : ''}. <b>Техника:</b> ${(s.vehicles || []).map((v) => VEHICLE_TYPES[v].name).join(', ') || 'пешком'} (мест: ${seats}, нужно ${squad.length + 1}).</div>
      <p class="note">Изменить состав, оружие и технику — у стендов в штабе.</p>`}
      <div class="row"><button class="btn" id="go">Выход на задание</button>${m.guide ? '<button class="btn sec" id="gd">Гайд: Д-30</button>' : ''}<button class="btn sec" id="back">Назад</button></div>`, { wide: true });
    this.bind('#go', () => { this.close(); this.app.startMission(m.id); });
    this.bind('#gd', () => this.d30Guide(() => this.briefing(m)));
    this.bind('#back', () => this.operations());
  }

  // ---------------- гайд: гаубица Д-30 ----------------
  d30Guide(back = null) {
    // расчётный пример по той же таблице стрельбы, что и в игре
    const ci = 0, T = firingTable(ci);
    const row = (D) => {
      const R = T.rows; let i = R.findIndex((r) => r.D >= D); if (i <= 0) i = 1;
      const a = R[i - 1], b = R[i], f = (D - a.D) / (b.D - a.D), o = {};
      for (const k of Object.keys(a)) o[k] = a[k] + (b[k] - a[k]) * f;
      return o;
    };
    const Dt = 7500, al = 60, dh = 40, tC = -22, wFrom = 5000, W = 5;
    const r = row(Dt);
    const eps = Math.atan2(dh, Dt) / MIL;
    const Aw = (wFrom - al) * MIL, Wx = W * Math.cos(Aw), Wz = W * Math.sin(Aw);
    const kT = (tC - 15) / -10;
    const dT = r.dXt * kT, dW = r.dXw * (Wx / 10);
    const Di1 = Dt - dT - dW;
    // второе приближение: поправки из строки исчисленной дальности
    const r2 = row(Di1);
    const dT2 = r2.dXt * kT, dW2 = r2.dXw * (Wx / 10);
    const Di = Dt - dT2 - dW2;
    const P = sightFor(ci, Di);
    const dUw = r.dZw * (Wz / 10);
    const Zk = 0.05 * r.t;
    const U = al - r.drift + dUw - Zk;
    const n0 = (x) => Math.round(x).toLocaleString('ru');
    const sg = (x, d = 0) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d).replace('.', ',');
    const charges = CHARGES.map((c, i) => { const t = firingTable(i); return `<tr><td>${c.name}</td><td>${c.v0} м/с</td><td>${n0(t.maxRange)} м</td><td>${n0(t.rows[0].D)}–${n0(t.rows[t.rows.length - 1].D)} м</td></tr>`; }).join('');
    const K = [
      ['E (у орудия)', 'занять / покинуть место наводчика'],
      ['A / D, мышь ←→', 'поворотный механизм (угломер); Shift — быстро'],
      ['W / S, мышь ↑↓', 'подъёмный механизм (возвышение ствола); Shift — быстро'],
      ['[ / ], колесо', 'барабан прицела ±1 тыс.; с Shift ±10'],
      ['− / =', 'барабан уровня ±1 тыс.; с Shift ±10'],
      ['1 … 6', 'заряд: полный, уменьшенный, 1-й … 4-й (до заряжания)'],
      ['X', 'установка взрывателя РГМ-2: осколочное / фугасное'],
      ['R', 'команда «Заряжай!» (≈5,5 с)'],
      ['ЛКМ / Пробел', 'выстрел (спуск)'],
      ['V', 'вид: панорама ПГ-1М → ОП4М-45 → со стороны → обзор'],
      ['M', 'карта огня: координаты целей, измерение Д, α, превышения'],
      ['T', 'таблица стрельбы по зарядам'],
      ['G', 'этот гайд'],
    ];
    this.show(`<h1>Гайд: 122-мм гаубица Д-30</h1>
      <div class="opc">Наводка, подготовка установок по карте и таблице, пристрелка по докладам наблюдателя</div>

      <h2>1. Орудие</h2>
      <p>Д-30 (2А18) — 122-мм буксируемая гаубица на трёх станинах с круговым обстрелом. Возвышение ствола −7° … +70°. Снаряд <b>ОФ-462</b> (21,76 кг, ВВ 3,67 кг), раздельно-гильзовое заряжание, переменный заряд Ж-463. В игре вы — <b>наводчик</b>: устанавливаете угломер, прицел и уровень и наводите ствол, а заряжающий и замковый работают по вашим командам. После выстрела ствол откатывается на ~0,9 м, накатывается, клин открывается и выбрасывает гильзу.</p>
      <table><tr><td><b>Заряд</b></td><td><b>V₀</b></td><td><b>Наиб. дальность</b></td><td><b>В таблице</b></td></tr>${charges}</table>
      <p>Чем меньше заряд, тем круче траектория (удобно бить за укрытия и высоты) и меньше рассеивание по дальности на ближних дистанциях; дальние цели — только полным и уменьшенным.</p>

      <h2>1а. Походное положение и буксировка</h2>
      <p>Д-30 буксируется любой машиной («Тигр», «Нива», МТ-ЛБ) за буксирную проушину на дульном тормозе: в походном положении ствол развёрнут над сведёнными станинами, лафет поднят на колёса. Масса орудия 3,2 т — тягач разгоняется медленнее, максимальная скорость ниже («Ниве» особенно тяжело).</p>
      <ol>
        <li><b>Отцепить:</b> остановите тягач, подойдите к проушине у машины — <b>E</b> (удерживать).</li>
        <li><b>Боевое положение:</b> <b>E</b> справа у колеса — расчёт разводит станины, опускает орудие на опорную плиту и снимает ствол с походного крепления (≈16 с). Ствол смотрит туда, куда смотрел на прицепе, — разворачивайтесь к цели заранее.</li>
        <li><b>Огонь:</b> место наводчика — слева у маховиков (<b>E</b>).</li>
        <li><b>Свернуться:</b> <b>E</b> справа у колеса — расчёт приводит орудие в походное положение (≈16 с).</li>
        <li><b>Прицепить:</b> орудие в походном положении; сдайте тягач задом так, чтобы фаркоп оказался ближе 4 м от проушины, остановитесь — на экране появится подсказка, жмите <b>E</b> прямо с места водителя. Можно и пешком: <b>E</b> у проушины («Прицепить … к …»).</li>
        <li><b>Где разгуляться:</b> карты операций — 8×8 км; на карте (<b>M</b>, колесо мыши — вся карта) видны холмы, озёра, леса и ориентиры окраин — удобно выбирать огневую позицию за обратным скатом в 2–3 км от цели.</li>
      </ol>
      <p>Орудие есть: в штабе (автопарк — «Д-30 на прицепе у первой машины»), в сетевом кооперативе и PvP (настройка комнаты; в PvP — у каждой команды свой тягач с Д-30). Цели для карты огня передаёт БПЛА-корректировщик, а пока дрона нет — разведчик отделения (раздел 9).</p>

      <h2>2. Деления угломера (тысячные)</h2>
      <p>Все углы — в <b>тысячных</b>: полная окружность = 60-00 (6000 тыс.), 1 тыс. ≈ 0,06°, 15-00 = 90°. Записываются через дефис: <b>12-35</b> = 1235 тыс., <b>0-07</b> = 7 тыс. <b>Формула тысячной:</b> отклонение 1 тыс. на дальности Д равно Д/1000 м. Пример: разрыв левее цели на 40 м при Д = 5 000 м → 40 / 5 = 8 тыс. = 0-08.</p>

      <h2>3. Управление</h2>
      <table>${K.map(([k, v]) => `<tr><td><b>${k}</b></td><td>${v}</td></tr>`).join('')}</table>

      <h2>4. Приборы наводки</h2>
      <ul>
        <li><b>Панорама ПГ-1М</b> (вид по умолчанию) — увеличение 4×, поле ≈10,7°. Перекрестие со шкалой по 0-05 (оцифровка: 1 = 0-10). Внизу окуляра — отсчёт <b>угломера</b>. Орудие ориентировано по основному направлению, поэтому угломер равен дирекционному углу оси ствола (север 0-00, восток 15-00, юг 30-00, запад 45-00) и растёт при повороте вправо.</li>
        <li><b>Механический прицел</b> — барабан <b>прицела</b> (угол прицеливания из таблицы, тыс.) и барабан <b>уровня</b> (30-00 — цель на высоте орудия). Ствол наведён, когда <b>пузырёк уровня на середине</b>: возвышение ствола = прицел + (уровень − 30-00). Ставите отсчёты на барабанах, затем подъёмным механизмом (W/S) выводите пузырёк на середину. Подсказка «ствол выше — S / ствол ниже — W» показывает, куда крутить.</li>
        <li><b>ОП4М-45</b> — прицел прямой наводки (5,5×). Угольник — точка прицеливания при прицеле 0; под ним шкала дальностей для выбранного заряда (цифры — сотни метров), слева/справа — боковая шкала по 0-05 для выноса точки прицеливания.</li>
      </ul>

      <h2>5. Стрельба с закрытой огневой позиции — по шагам</h2>
      <ol>
        <li><b>M — карта огня.</b> На карте отмечены ОП и цели с координатами (X — на север, Y — на восток, сетка 1 км, изолинии через 10 м). Щёлкните по цели: получите <b>топографическую дальность Д<sub>т</sub></b>, <b>дирекционный угол α<sub>ц</sub></b>, <b>превышение</b> цели над орудием и <b>угол места ε</b> с готовым отсчётом уровня (30-00 + ε).</li>
        <li><b>Выберите заряд</b> (1–6) — наименьший, на котором дальность уверенно перекрывается. Взрыватель (X): осколочное — по живой силе и технике открыто, фугасное — по укрытиям.</li>
        <li><b>T — таблица стрельбы</b> для этого заряда. Найдите строки, между которыми лежит дальность, и интерполируйте. Таблица дана для нормальных условий (+15 °C, 750 мм рт. ст., без ветра).</li>
        <li><b>Учтите поправки</b> (раздел 6): температура, продольный и боковой ветер, деривация, вращение Земли. Получите <b>исчисленную дальность Д<sub>и</sub></b> и <b>исчисленный угломер</b>.</li>
        <li><b>Прицел</b> — по таблице для Д<sub>и</sub>, ставится клавишами [ ] (Shift — по 10). <b>Уровень</b> — 30-00 + ε, клавишами − =.</li>
        <li><b>Угломер</b> — A/D или мышью в панораме до нужного отсчёта (Shift — грубо, без Shift — точно).</li>
        <li><b>Подъёмным механизмом</b> (W/S) выведите пузырёк на середину (зелёный).</li>
        <li><b>R</b> — «Заряжай!». Снарядный и зарядный бегут к ящику с боеприпасами (11 м за орудием, 50 снарядов и 50 зарядов), несут снаряд (22 кг — шагом) и гильзу с зарядом; сначала досылается снаряд, потом гильза, замковый закрывает клин — «Готово!». Обычно 9–10 с; если кто-то из расчёта убит, остальные бегают за двоих, дольше. Если расчёт выбит — заряжайте сами: у ящика <b>E</b> — взять снаряд, у казённика справа <b>E</b> — дослать, затем так же гильзу (G — бросить груз). Попадание в ящик — взрыв всего боекомплекта.</li>
        <li><b>ЛКМ</b> — «Выстрел!». Справа откроется <b>камера снаряда</b>: она ведёт снаряд и показывает дальность, скорость, время полёта и высоту над рельефом, после падения — место разрыва крупным планом и доклад наблюдателя.</li>
      </ol>

      <h2>6. Поправки</h2>
      <ul>
        <li><b>Температура.</b> ΔT = t − 15. Графа ΔX<sub>T</sub> дана на понижение на 10° (в мороз снаряд <b>недолетает</b> — воздух плотнее). Отклонение дальности: ΔД<sub>T</sub> = ΔX<sub>T</sub> · (ΔT / −10).</li>
        <li><b>Ветер.</b> Угол ветра A<sub>w</sub> = α<sub>ветра</sub> − α<sub>стрельбы</sub> (α<sub>ветра</sub> — откуда дует). Продольная составляющая W<sub>x</sub> = W·cos A<sub>w</sub> (плюс — встречный), боковая W<sub>z</sub> = W·sin A<sub>w</sub> (плюс — справа, минус — слева). ΔД<sub>w</sub> = ΔX<sub>w</sub> · W<sub>x</sub>/10; боковой снос Z<sub>w</sub> в таблице — на ветер 10 м/с слева (сносит вправо), поправка угломера ΔУ<sub>w</sub> = Z<sub>w</sub> · W<sub>z</sub>/10.</li>
        <li><b>Исчисленная дальность:</b> Д<sub>и</sub> = Д<sub>т</sub> − ΔД<sub>T</sub> − ΔД<sub>w</sub>.</li>
        <li><b>Деривация.</b> Снаряд вращается вправо и уходит вправо на Z тыс. (графа «деривация») — угломер <b>уменьшить</b> на Z.</li>
        <li><b>Вращение Земли.</b> На 69° с. ш. снаряд дополнительно уходит вправо примерно на 0,05 тыс. за каждую секунду полёта: Z<sub>к</sub> ≈ 0,05 · t<sub>c</sub> (t<sub>c</sub> — из таблицы; 37 с → ≈ 0-02). Угломер уменьшить.</li>
        <li><b>Исчисленный угломер:</b> У = α<sub>ц</sub> − Z + ΔУ<sub>w</sub> − Z<sub>к</sub>.</li>
        <li><b>Второе приближение.</b> Поправки растут с дальностью, поэтому на больших дальностях (от ~8 км) пересчитайте ΔД<sub>T</sub> и ΔД<sub>w</sub> ещё раз по строке таблицы для полученной Д<sub>и</sub>. Без этого на 10–12 км первый разрыв ляжет с недолётом 100–150 м.</li>
        <li>Остаток — рассеивание и неучтённые мелочи — снимает пристрелка.</li>
      </ul>
      <div class="ex"><b>Пример (заряд полный).</b> Д<sub>т</sub> = ${n0(Dt)} м, α<sub>ц</sub> = ${fmtDiv(al)}, превышение +${dh} м, t = ${tC} °C, ветер ${W} м/с с направления ${fmtDiv(wFrom)}.<br>
        Угол места ε = ${fmtSigned(eps)} → уровень <b>${fmtDiv(3000 + eps)}</b>.<br>
        Из таблицы на ${n0(Dt)} м: ΔX<sub>T</sub> = ${sg(r.dXt)} м, ΔX<sub>w</sub> = ${sg(r.dXw)} м, Z = ${r.drift.toFixed(0)} тыс., Z<sub>w</sub> = ${r.dZw.toFixed(1).replace('.', ',')} тыс.<br>
        ΔT = ${tC - 15}° → ΔД<sub>T</sub> = ${sg(r.dXt)} · ${kT.toFixed(1).replace('.', ',')} = <b>${sg(dT)} м</b>.<br>
        A<sub>w</sub> = ${fmtDiv(wFrom - al)} → W<sub>x</sub> = ${sg(Wx, 1)} м/с (${Wx >= 0 ? 'встречный' : 'попутный'}), W<sub>z</sub> = ${sg(Wz, 1)} м/с (${Wz >= 0 ? 'справа' : 'слева'}) → ΔД<sub>w</sub> = <b>${sg(dW)} м</b>, ΔУ<sub>w</sub> = <b>${sg(dUw, 1)} тыс.</b><br>
        Первое приближение: Д<sub>и</sub> = ${n0(Dt)} ${dT >= 0 ? '−' : '+'} ${n0(Math.abs(dT))} ${dW >= 0 ? '−' : '+'} ${n0(Math.abs(dW))} = ${n0(Di1)} м.<br>
        Второе приближение (строка ${n0(Di1)} м: ΔX<sub>T</sub> = ${sg(r2.dXt)}, ΔX<sub>w</sub> = ${sg(r2.dXw)}): Д<sub>и</sub> = ${n0(Dt)} ${dT2 >= 0 ? '−' : '+'} ${n0(Math.abs(dT2))} ${dW2 >= 0 ? '−' : '+'} ${n0(Math.abs(dW2))} = <b>${n0(Di)} м</b> → прицел <b>${P ? Math.round(P) : '—'}</b>.<br>
        t<sub>c</sub> ≈ ${r.t.toFixed(0)} с → Z<sub>к</sub> ≈ ${Zk.toFixed(1).replace('.', ',')} тыс.<br>
        Угломер = ${fmtDiv(al)} − ${r.drift.toFixed(0)} ${dUw >= 0 ? '+' : '−'} ${Math.abs(dUw).toFixed(0)} − ${Zk.toFixed(0)} = <b>${fmtDiv(U)}</b>.<br>
        Установки: <b>заряд полный, угломер ${fmtDiv(U)}, прицел ${P ? Math.round(P) : '—'}, уровень ${fmtDiv(3000 + eps)}</b>, затем пузырёк на середину.</div>

      <h2>7. Пристрелка по докладам наблюдателя</h2>
      <p>После каждого разрыва наблюдатель докладывает, например: «Выстрел 2. Цель 103: <b>перелёт 120, левее 40</b>».</p>
      <ul>
        <li><b>По направлению:</b> ΔУ = отклонение (м) / (Д/1000). Разрыв <b>левее</b> — угломер <b>увеличить</b> (довернуть вправо), <b>правее</b> — уменьшить. «Левее 40» на 7 500 м → 40 / 7,5 ≈ 5 → угломер +0-05.</li>
        <li><b>По дальности:</b> ΔП = отклонение (м) / ΔX<sub>тыс</sub> (графа таблицы — сколько метров даёт 1 тыс. прицела). <b>Перелёт</b> — прицел уменьшить, <b>недолёт</b> — увеличить. На ${n0(Dt)} м ΔX<sub>тыс</sub> ≈ ${r.dXmil.toFixed(0)} м → «перелёт 120» → прицел −${Math.max(1, Math.round(120 / r.dXmil))}.</li>
        <li><b>Вилка.</b> Получив перелёт и недолёт, цель «в вилке»: каждый следующий выстрел — на середину вилки (половиньте), пока разрыв не ляжет в пределах цели («накрытие»).</li>
        <li><b>Огонь на поражение.</b> После накрытия не меняйте установки — дайте 2–4 выстрела: рассеивание само накроет площадь цели. Цель подавлена, когда её объекты получили достаточно попаданий (огонь и дым на месте цели).</li>
      </ul>
      <p>Все разрывы с номерами выстрелов наносятся на карту огня (M) — по ним видно, куда «гуляет» серия.</p>

      <h2>8. Стрельба прямой наводкой (ОП4М-45)</h2>
      <p>Для целей в прямой видимости (до ~3–4 км): V → ОП4М-45, выберите заряд (шкала дальностей перестроится под него), поворотным механизмом выведите угольник на цель по направлению, затем подъёмным — совместите с целью штрих нужной дальности (цифры — сотни метров). Боковой ветер и движение цели выносите по боковой шкале (0-05 на деление). Уровень и барабан прицела при этом не используются.</p>

      <h2>9. БПЛА-корректировщик и разведчик</h2>
      <p><b>Дрон «Сова»</b> взлетает в начале операции и уходит на облёт текущей задачи. Камера на подвесе смотрит в центр облёта; всё, что она видит, дрон передаёт отметками «Цель 2xx» с точностью до нескольких метров. <b>Y</b> — окно камеры сбоку экрана (видно и с места наводчика: удобно смотреть разрывы); <b>U</b> — облёт точки, куда вы смотрите (глазами, в бинокль или в прицел орудия); <b>Shift+U</b> — высота: «высоко» (190 м, круг 320 м — противник почти не слышит) или «низко» (90 м, круг 170 м — видно лучше, но дрон слышно, по нему стреляют). Дрон сбивается пулями и осколками; резервный взлетает рядом с вами через 2 минуты, а пока его нет, цели докладывает разведчик.</p>
      <p>Разведчик (снайпер) отделения, пока нет дрона, сам докладывает о замеченном противнике: «Цель 201: пехота противника (3). X 61 091, Y 33 943». Такие цели появляются на карте (<b>M</b>) и в списке карты огня Д-30 с координатами — щёлкните по ним на карте огня, чтобы получить дальность, дирекционный угол и уровень. Ориентир можно указать и самому: бинокль (<b>B</b>), навести, <b>ЛКМ</b> — разведчик передаст его координаты. Отметки живут 2–5 минут; в сетевой игре они общие для всей команды. Наблюдатель докладывает разрывы относительно ближайшей такой цели.</p>

      <h2>10. Советы</h2>
      <ul>
        <li>В мороз −20…−25 °C поправка на температуру даёт сотни метров — без неё первые разрывы лягут с большим недолётом.</li>
        <li>Не забывайте менять уровень при стрельбе по высотам: 40 м превышения на 5 км — это 0-08, то есть ~100 м по дальности.</li>
        <li>Заряд и взрыватель выбираются <b>до</b> заряжания. Время полёта на 10 км — около полуминуты: следите за камерой снаряда.</li>
        <li>Вид «со стороны» (V) показывает работу орудия и расчёта; мышь — облёт, колесо — приближение.</li>
      </ul>
      <div class="row"><button class="btn" id="gb">${back ? 'Назад' : 'Закрыть (Esc)'}</button></div>`, { wide: true, cls: 'guide' });
    this.bind('#gb', () => (back ? back() : this.close()));
  }


  // ================================================================ сетевая игра
  _netClear() { for (const f of this._netOff || []) f(); this._netOff = []; clearInterval(this._netTimer); }
  _netOn(type, fn) { (this._netOff || (this._netOff = [])).push(this.app.net.on(type, fn)); }

  netMenu(err = '') {
    this._netClear();
    const st = this.app.settings;
    const def = st.netServer || defaultServer();
    this.show(`<h1>Сетевая игра</h1><div class="opc">Кооператив до 4 игроков по операциям и противостояние N.E.G.S против «Дентера» до 16 игроков</div>
      <label>Позывной <input id="nn" maxlength="20" value="${escH(st.netName || '')}" placeholder="например, Кей"></label>
      <label>Сервер <input id="ns" value="${escH(def)}" placeholder="72.56.236.95 или 192.168.1.10:8080"></label>
      <p class="note">Если игра открыта с игрового сервера, адрес уже подставлен. Для игры по локальной сети укажите адрес компьютера, на котором запущен сервер (он печатается при запуске).</p>
      <div id="nerr" class="bad">${escH(err)}</div>
      <div class="row"><button class="btn" id="conn">Подключиться</button><button class="btn sec" id="lan">Локальная сеть: инструкция</button><button class="btn sec" id="b">Назад</button></div>`, { wide: true });
    this.bind('#b', () => { if (this.app.net) this.app.net.close(); this.mainMenu(); });
    this.bind('#lan', () => this.lanHelp(() => this.netMenu()));
    this.bind('#conn', async () => {
      const name = this.panel.querySelector('#nn').value.trim() || 'Боец';
      const addr = this.panel.querySelector('#ns').value.trim();
      st.netName = name; st.netServer = addr; this.app.persist();
      this.panel.querySelector('#nerr').textContent = 'Подключение…';
      try { await this.app.netConnect(addr, name); this.netLobby(); }
      catch (e) {
        const el = this.panel.querySelector('#nerr');
        const https = location.protocol === 'https:' && !/^wss:/.test(addr);
        if (el) el.textContent = ((e && e.message) || 'Не удалось подключиться') + (https ? '. Страница открыта по https, а сервер без сертификата — откройте игру прямо с сервера: http://' + addr.replace(/^https?:\/\//, '') : '');
      }
    });
  }

  lanHelp(back) {
    this.show(`<h1>Игра по локальной сети</h1>
      <div class="brief">
      <p><b>1. Один компьютер — сервер.</b> На нём должен быть установлен <b>Node.js</b> (версия 18 или новее, nodejs.org) и папка с игрой (скачать с GitHub: «Code» → «Download ZIP», ветка с игрой).</p>
      <p><b>2. Запуск сервера.</b> В папке игры откройте терминал (Windows: в адресной строке проводника наберите <code>cmd</code>) и выполните:<br><code>node server/server.mjs</code> (Windows: двойной щелчок по <code>server\\start-lan.bat</code>). Ничего устанавливать через npm не нужно.<br>Сервер напишет адреса, например <code>http://192.168.1.10:8080</code>.</p>
      <p><b>3. Все игроки</b> (и на самом сервере тоже) открывают в браузере этот адрес. Адрес сервера в меню «Сетевая игра» подставится сам.</p>
      <p><b>4. Брандмауэр.</b> Если другие компьютеры не открывают страницу — разрешите Node.js в брандмауэре Windows для частной сети (окно появляется при первом запуске) или откройте порт 8080.</p>
      <p><b>5.</b> Один игрок создаёт комнату, остальные входят. В кооперативе создатель комнаты — хост: у него считаются противник и задачи, поэтому лучше создавать комнату на самом мощном компьютере.</p>
      <p class="note">Другой порт: <code>PORT=9000 node server/server.mjs</code> (Linux/macOS) или <code>set PORT=9000 &amp;&amp; node server\\server.mjs</code> (Windows).</p>
      </div><div class="row"><button class="btn" id="b">Назад</button></div>`, { wide: true });
    this.bind('#b', () => back());
  }

  netLobby(msg = '') {
    this._netClear();
    const net = this.app.net;
    const mTitle = (r) => (r.mode === 'pvp' ? pvpMap(r.mission).title : (MISSIONS.find((q) => q.id === r.mission) || {}).title || r.mission);
    this.show(`<h1>Комнаты</h1><div class="opc">Сервер: ${escH(this.app.settings.netServer || location.host)} · пинг <span id="png">—</span> мс</div>
      <div id="nerr" class="bad">${escH(msg)}</div>
      <div id="rl" class="netrooms"></div>
      <h2 class="nh">Создать комнату</h2>
      <div class="netform">
        <label>Режим <select id="md"><option value="coop">Кооператив (операции, до 4)</option><option value="pvp">Противостояние PvP (до 16)</option></select></label>
        <label>Карта <select id="ms"></select></label>
        <label class="pv">Побед до <input id="sl" type="number" min="5" max="200" value="30"></label>
        <label class="pv">Минут <input id="tl" type="number" min="3" max="60" value="15"></label>
      </div>
      <div class="row"><button class="btn" id="cr">Создать</button><button class="btn sec" id="rf">Обновить</button><button class="btn sec" id="dc">Отключиться</button></div>`, { wide: true });
    const fillMaps = () => {
      const mode = this.panel.querySelector('#md').value;
      const opts = mode === 'pvp' ? PVP_MAPS.map((m) => `<option value="${m.id}">${m.title} — ${m.note}</option>`) : MISSIONS.map((m) => `<option value="${m.id}">${m.training ? '◆ ' : ''}${m.title}</option>`);
      this.panel.querySelector('#ms').innerHTML = opts.join('');
      this.panel.querySelectorAll('.pv').forEach((e) => { e.style.display = mode === 'pvp' ? '' : 'none'; });
    };
    fillMaps();
    this.panel.querySelector('#md').addEventListener('change', fillMaps);
    const draw = () => {
      const el = this.panel.querySelector('#rl');
      if (!el) return;
      const list = net.rooms || [];
      el.innerHTML = list.length ? `<table class="ctl"><tr><th>Комната</th><th>Режим</th><th>Карта</th><th>Игроки</th><th></th></tr>${list.map((r) => `<tr><td>${escH(r.name)}</td><td>${r.mode === 'pvp' ? 'PvP' : 'кооп'}</td><td>${escH(mTitle(r))}</td><td>${r.n}/${r.max}${r.state === 'play' ? ' · идёт бой' : ''}</td><td><button class="btn" data-j="${r.id}" ${r.n >= r.max || (r.state === 'play' && r.mode === 'coop') ? 'disabled' : ''}>Войти</button></td></tr>`).join('')}</table>` : '<p class="note">Комнат пока нет — создайте свою.</p>';
      el.querySelectorAll('[data-j]').forEach((b) => b.addEventListener('click', () => { this.app.audio.click(); net.send({ t: 'join', room: b.dataset.j }); }));
      const pg = this.panel.querySelector('#png'); if (pg) pg.textContent = net.rtt ? Math.round(net.rtt) : '—';
    };
    draw();
    this._netOn('rooms', draw);
    this._netOn('room', () => this.netRoom());
    this._netOn('err', (m) => { const e = this.panel.querySelector('#nerr'); if (e) e.textContent = m.msg; });
    this._netOn('close', () => this.netMenu('Соединение с сервером потеряно'));
    this._netTimer = setInterval(() => net.send({ t: 'list' }), 2500);
    net.send({ t: 'list' });
    this.bind('#rf', () => net.send({ t: 'list' }));
    this.bind('#dc', () => { this._netClear(); net.close(); this.netMenu(); });
    this.bind('#cr', () => {
      const q = (id) => this.panel.querySelector(id).value;
      net.send({ t: 'create', mode: q('#md'), mission: q('#ms'), scoreLimit: +q('#sl'), timeLimit: +q('#tl') });
    });
  }

  netRoom() {
    this._netClear();
    const net = this.app.net;
    const r = net.room;
    if (!r) { this.netLobby(); return; }
    const me = r.players.find((p) => p.id === net.id) || {};
    const owner = r.owner === net.id, pvp = r.mode === 'pvp';
    const title = pvp ? pvpMap(r.mission).title : (MISSIONS.find((q) => q.id === r.mission) || {}).title || r.mission;
    // своё снаряжение — хранится в сохранении и уходит на сервер
    const sv = this.app.save;
    const kit = sv.netKit = { ...defaultKit(sv, r), ...(sv.netKit || {}) };
    const sendKit = () => { this.app.persist(); net.send({ t: 'set', kit }); };
    const lobby = r.state === 'lobby';
    const sel = (id, opts, cur) => `<select id="${id}" ${lobby ? '' : 'disabled'}>${opts.map(([v, n]) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
    const roleOpts = [['', '—'], ...Object.entries(NET_ROLES).map(([k, v]) => [k, v.name])];
    const summary = (p) => {
      const k = kitOf(p, r);
      const w = (WEAPONS[k.weapon] || {}).name || '';
      return `${escH(w)}${k.heavy ? ' + ' + WEAPONS[k.heavy].name : ''} · отделение ${k.squad.length}${k.howitzer ? ` · Д-30 (${VEHICLE_TYPES[k.tow] ? VEHICLE_TYPES[k.tow].name.replace(/ГАЗ-233014 /, '') : k.tow})` : ''}${k.mortar ? ' · миномёт' : ''}${k.kpv ? ' · КПВ' : ''}${k.tank ? ' · Т-72Б' : ''}`;
    };
    this.show(`<h1>${escH(r.name)}</h1><div class="opc">${pvp ? `Противостояние · ${escH(title)} · до ${r.scoreLimit} побед или ${r.timeLimit} мин` : `Кооператив · ${escH(title)}`}</div>
      <div id="nerr" class="bad"></div>
      <div id="pl" class="netrooms"></div>
      ${pvp ? `<div class="netform"><label>Команда <span><button class="btn ${me.team === 'negs' ? '' : 'sec'}" id="tn">${TEAM_NAMES.negs}</button> <button class="btn ${me.team === 'denter' ? '' : 'sec'}" id="td">${TEAM_NAMES.denter}</button></span></label></div>` : ''}
      <h2 class="nh">Моё снаряжение${lobby ? '' : ' (меняется до начала боя)'}</h2>
      <div class="netform kit">
        <label>Оружие ${sel('kw', PVP_WEAPONS.map((w) => [w, WEAPONS[w].name]), kit.weapon)}</label>
        <label>Тяжёлое оружие ${sel('kh', [['', 'нет'], ['rpg7', WEAPONS.rpg7.name], ['ptrd', WEAPONS.ptrd.name + ' (тяжёлое, медленнее ходьба)']], kit.heavy || '')}</label>
        <label>Гранаты Ф-1 ${sel('kg', [0, 1, 2, 3, 4].map((n) => [n, n]), kit.grenades)}</label>
        <label>Дымовые РДГ-2 ${sel('ksm', [0, 1, 2, 3, 4].map((n) => [n, n]), kit.smokes ?? 2)}</label>
        <label>Патроны <button class="btn sec" id="kl">Снаряжение магазинов…</button></label>
        <label>Отделение ИИ <span class="sq">${[0, 1, 2, 3, 4, 5].map((i) => sel('ks' + i, roleOpts, kit.squad[i] || '')).join('')}</span></label>
        <label><input type="checkbox" id="kd" ${kit.howitzer ? 'checked' : ''} ${lobby ? '' : 'disabled'}> Д-30 с расчётом на прицепе — тягач ${sel('kt', TOW_CHOICES.map((t) => [t, VEHICLE_TYPES[t].name]), kit.tow)}</label>
        <label><input type="checkbox" id="kmo" ${kit.mortar ? 'checked' : ''} ${lobby ? '' : 'disabled'}> 82-мм миномёт 2Б14 с расчётом</label>
        <label><input type="checkbox" id="kkp" ${kit.kpv ? 'checked' : ''} ${lobby ? '' : 'disabled'}> 14,5-мм КПВ на станке</label>
        <label><input type="checkbox" id="ktk" ${kit.tank ? 'checked' : ''} ${lobby ? '' : 'disabled'}> Танк Т-72Б (вы — командир, наводчик и мехвод — ИИ)</label>
      </div>
      ${owner ? `<div class="netform"><label>Карта <select id="ms">${(pvp ? PVP_MAPS : MISSIONS).map((m) => `<option value="${m.id}" ${m.id === r.mission ? 'selected' : ''}>${m.title}</option>`).join('')}</select></label></div>` : ''}
      <p class="note">${pvp ? 'Каждый выбирает своё: оружие, РПГ или ПТРД, гранаты, состав отделения ИИ, нужна ли ему Д-30 и на каком тягаче.' : `На старте у всех — «Тигр»${r.players.length > 2 ? ' и «Нива»' : ''}; Д-30 — у тех, кто её взял. Хост (создатель комнаты) считает противника и задачи.`}</p>
      <div class="row">${owner ? `<button class="btn" id="go">Начать${r.state === 'play' ? ' (идёт бой)' : ''}</button>` : `<span class="note">${r.state === 'play' ? 'Идёт бой' : 'Ждём, когда создатель комнаты начнёт'}</span>`}<button class="btn sec" id="lv">Покинуть комнату</button></div>`, { wide: true });
    const draw = () => {
      const rr = net.room; const el = this.panel.querySelector('#pl');
      if (!rr || !el) return;
      el.innerHTML = `<table class="ctl"><tr><th>Боец</th>${pvp ? '<th>Команда</th>' : ''}<th>Снаряжение</th><th>Пинг</th><th></th></tr>${rr.players.map((p) => `<tr class="${p.id === net.id ? 'me' : ''}"><td>${escH(p.name)}</td>${pvp ? `<td>${TEAM_NAMES[p.team] || ''}</td>` : ''}<td>${summary(p)}</td><td>${p.ping || '—'}</td><td>${p.id === rr.owner ? (pvp ? 'создатель' : 'хост') : ''}</td></tr>`).join('')}</table>`;
    };
    draw();
    this._netOn('room', (m) => { const was = r; if (m.room.owner !== was.owner || m.room.mission !== was.mission || m.room.mode !== was.mode || m.room.state !== was.state || (m.room.players.find((p) => p.id === net.id) || {}).team !== me.team) this.netRoom(); else draw(); });
    this._netOn('err', (m) => { const e = this.panel.querySelector('#nerr'); if (e) e.textContent = m.msg; });
    this._netOn('close', () => this.netMenu('Соединение с сервером потеряно'));
    if (pvp) {
      this.bind('#tn', () => net.send({ t: 'set', team: 'negs' }));
      this.bind('#td', () => net.send({ t: 'set', team: 'denter' }));
    }
    const on = (id, fn) => { const e = this.panel.querySelector(id); if (e) e.addEventListener('change', () => { fn(e); sendKit(); draw(); }); };
    on('#kw', (e) => { kit.weapon = e.value; });
    on('#kh', (e) => { kit.heavy = e.value || null; });
    on('#kg', (e) => { kit.grenades = +e.value; });
    on('#ksm', (e) => { kit.smokes = +e.value; });
    for (let i = 0; i < 6; i++) on('#ks' + i, () => { kit.squad = [0, 1, 2, 3, 4, 5].map((k) => this.panel.querySelector('#ks' + k).value).filter(Boolean); });
    on('#kd', (e) => { kit.howitzer = e.checked; });
    on('#kmo', (e) => { kit.mortar = e.checked; });
    on('#kkp', (e) => { kit.kpv = e.checked; });
    on('#ktk', (e) => { kit.tank = e.checked; });
    on('#kt', (e) => { kit.tow = e.value; });
    this.bind('#kl', () => { this._netClear(); this.magLoader(LOADABLE.includes(kit.weapon) ? kit.weapon : null, () => this.netRoom()); });
    if (lobby) sendKit();
    const ms = this.panel.querySelector('#ms'); if (ms) ms.addEventListener('change', () => net.send({ t: 'set', mission: ms.value }));
    this.bind('#go', () => net.send({ t: 'start' }));
    this.bind('#lv', () => { net.send({ t: 'leave' }); net.room = null; this.netLobby(); });
  }

  netDebrief(ok, reason, m, lost) {
    const net = this.app.net, s = m.net;
    let h = '';
    if (m.pvp && s) {
      const rows = [[net.id, s.me.name, s.team]].concat([...s.peers.values()].map((p) => [p.id, p.name, p.team]));
      for (const t of ['negs', 'denter']) {
        h += `<h2 class="nh">${TEAM_NAMES[t]} — ${s.score[t]}</h2><table class="ctl"><tr><th>Боец</th><th>Убито</th><th>Гибель</th></tr>`;
        for (const r of rows.filter((x) => x[2] === t).sort((a, b) => (s.stats.get(b[0]) || [0])[0] - (s.stats.get(a[0]) || [0])[0])) { const k = s.stats.get(r[0]) || [0, 0]; h += `<tr class="${r[0] === net.id ? 'me' : ''}"><td>${escH(r[1])}</td><td>${k[0]}</td><td>${k[1]}</td></tr>`; }
        h += '</table>';
      }
    } else {
      const st = m.stats;
      const min = Math.floor(st.time / 60), sec = Math.floor(st.time % 60);
      h = `<table class="ctl"><tr><td>Время</td><td>${min} мин ${sec} с</td></tr><tr><td>Выстрелов</td><td>${st.shots}</td></tr><tr><td>Попаданий</td><td>${st.hits}</td></tr><tr><td>Уничтожено противников (лично)</td><td>${st.kills}</td></tr></table>`;
    }
    this.show(`<h1>${m.pvp ? 'Матч окончен' : ok ? 'Задание выполнено' : 'Задание провалено'}</h1><div class="opc">${m.def.title} — ${m.pvp ? 'противостояние' : 'кооператив'}</div>
      ${reason ? `<p class="story ${ok ? '' : 'bad'}">${escH(reason)}</p>` : ''}${h}
      <div class="row">${lost ? '<button class="btn" id="mn">В меню</button>' : '<button class="btn" id="rm">В комнату</button><button class="btn sec" id="lv">Выйти</button>'}</div>`, { wide: true });
    this.bind('#rm', () => { this.app.backToRoom(); });
    this.bind('#lv', () => { net.send({ t: 'leave' }); net.room = null; this.app.backToRoom(true); });
    this.bind('#mn', () => { this.app.backToRoom(true, true); });
  }

  // ---------------- личный состав ----------------
  roster() {
    const s = this.app.save;
    const sel = new Set(s.squad);
    const render = () => {
      this.show(`<h1>Личный состав</h1><p class="note">Выберите до 6 бойцов для выхода на задание (выбрано: ${sel.size}/6). Сержант Кей командует отделением.</p>
        <div class="roster">${ROSTER.map((r) => {
          const hosp = s.hospital[r.id] > 0;
          return `<div class="card ${sel.has(r.id) ? 'on' : ''} ${hosp ? 'hosp' : ''}" data-id="${r.id}">
            <div class="ct">«${r.callsign}» <span>${r.rank}</span></div>
            <div class="cn">${r.name}, ${r.age} лет</div>
            <div class="cr">${r.roleName} · ${WEAPONS[r.weapon].name}${r.secondary ? ' + ' + WEAPONS[r.secondary].name : ''}</div>
            ${Object.entries(r.stats).map(([k, v]) => `<div class="st"><span>${STAT_NAMES[k]}</span><div class="bar"><i style="width:${v}%"></i></div><b>${v}</b></div>`).join('')}
            <div class="cb">${r.bio}</div>
            <div class="cx">Операций: ${s.xp[r.id] || 0}${hosp ? ' · <b class="bad">в госпитале</b>' : ''}</div>
          </div>`;
        }).join('')}</div><div class="row"><button class="btn" id="b">Готово</button></div>`, { wide: true });
      this.bind('.card[data-id]', (e) => {
        const id = e.dataset.id;
        if (s.hospital[id] > 0) return;
        if (sel.has(id)) sel.delete(id); else if (sel.size < 6) sel.add(id);
        s.squad = [...sel]; this.app.persist(); render();
      });
      this.bind('#b', () => this.close());
    };
    render();
  }

  armory() {
    const s = this.app.save;
    const render = () => {
      this.show(`<h1>Оружейная</h1><div class="arm">${PRIMARY_CHOICES.map((id) => {
        const w = WEAPONS[id], a = AMMO[w.ammo];
        return `<div class="card ${s.primary === id ? 'on' : ''}" data-id="${id}"><div class="ct">${w.name}</div><div class="cr">${w.cls} · ${a.name}</div>
          <div class="cn">V₀ ${a.v0} м/с · ${w.rpm > 60 ? w.rpm + ' выстр/мин · ' : ''}магазин ${w.mag} · масса ${w.weight} кг</div><div class="cb">${w.desc}</div></div>`;
      }).join('')}</div>
      <div class="netform"><label>Тяжёлое оружие (слот 2) <select id="rpg">${HEAVY_CHOICES.map((h) => `<option value="${h.id || ''}" ${(s.launcher === true ? 'rpg7' : s.launcher || '') === (h.id || '') ? 'selected' : ''}>${h.name}</option>`).join('')}</select></label></div>
      <p class="note">${WEAPONS.rpg7.name}: ${WEAPONS.rpg7.desc}<br>${WEAPONS.ptrd.name}: ${WEAPONS.ptrd.desc}</p>
      <div class="row"><button class="btn" id="b">Готово</button></div>`, { wide: true });
      this.bind('.card', (e) => { s.primary = e.dataset.id; this.app.persist(); render(); });
      this.panel.querySelector('#rpg').onchange = (e) => { s.launcher = e.target.value || null; this.app.persist(); };
      this.bind('#b', () => this.close());
    };
    render();
  }

  motorPool() {
    const s = this.app.save;
    const render = () => {
      const seats = (s.vehicles || []).reduce((a, v) => a + (VEHICLE_TYPES[v].troop ?? VEHICLE_TYPES[v].seats), 0);
      this.show(`<h1>Автопарк</h1><p class="note">Выберите до двух машин для выдвижения (мест: ${seats}, нужно ${s.squad.length + 1}). На задании: подойдите к машине и нажмите E. Отделение по команде «за мной» (F) рассаживается само; в МТ-ЛБ один из бойцов садится за ПКТ.</p>
        <div class="arm">${Object.values(VEHICLE_TYPES).map((v) => `<div class="card ${s.vehicles.includes(v.id) ? 'on' : ''}" data-id="${v.id}"><div class="ct">${v.name}</div><div class="cr">${v.cls}</div>
          <div class="cn">Скорость до ${(v.maxSpeed * 3.6).toFixed(0)} км/ч${v.reverse ? `, назад ${(v.reverse * 3.6).toFixed(0)}` : ''} · ${v.tank ? 'экипаж 3, мест для отделения нет' : `мест ${v.seats}`} · броня ${v.armor.front}/${v.armor.side} мм${v.gun ? ' · ' + WEAPONS[v.gun].name : ''}${v.tank ? ` · ${(v.mass / 1000).toFixed(1)} т, ${Math.round(v.power * 1.36)} л. с.` : ''}</div><div class="cb">${v.desc}</div></div>`).join('')}
          <div class="card ${s.howitzer ? 'on' : ''}" id="d30"><div class="ct">122-мм гаубица Д-30</div><div class="cr">Буксируемое орудие</div>
          <div class="cn">Масса 3,2 т · дальность до 15,2 км · ${s.vehicles.length ? 'на прицепе у ' + VEHICLE_TYPES[s.vehicles[0]].name : 'нужен тягач — выберите машину'}</div>
          <div class="cb">Выезжает в походном положении на прицепе у первой машины. На огневой позиции: отцепить (E у проушины), привести в боевое положение (E справа у колеса, ≈16 с), затем E слева — место наводчика.</div></div>
          <div class="card ${s.mortar ? 'on' : ''}" id="mor"><div class="ct">82-мм миномёт 2Б14-1 «Поднос»</div><div class="cr">Переносной, с расчётом из двух номеров</div>
          <div class="cn">Масса 42 кг · дальность 85 м – 4 км · 40 осколочных и 10 дымовых мин</div>
          <div class="cb">Едет в кузове ${s.vehicles.length ? VEHICLE_TYPES[s.vehicles[0]].name : '(без машины — стоит у места выдвижения)'}. E у кормы — выгрузить и нести, E — поставить. Наводчик — слева у прицела МПМ-44М (E), R — заряжать, Пробел — мину в ствол.</div></div>
          <div class="card ${s.kpv ? 'on' : ''}" id="kpv"><div class="ct">14,5-мм КПВ на станке</div><div class="cr">Пулемёт на колёсном станке со щитом</div>
          <div class="cn">600 выстр./мин · Б-32 пробивает «Тигр» и кирпич · 8 лент по 40 патронов</div>
          <div class="cb">Едет в кузове «Тигра» или МТ-ЛБ (в «Ниву» не входит). E у кормы — выгрузить и катить, E — поставить где нужно, E у пулемёта — лечь за него.</div></div></div>
        <div class="row"><button class="btn" id="b">Готово</button></div>`, { wide: true });
      this.bind('.card[data-id]', (e) => {
        const id = e.dataset.id;
        const i = s.vehicles.indexOf(id);
        if (i >= 0) s.vehicles.splice(i, 1); else { s.vehicles.push(id); if (s.vehicles.length > 2) s.vehicles.shift(); }
        this.app.persist(); render();
      });
      this.bind('#d30', () => { s.howitzer = !s.howitzer; this.app.persist(); render(); });
      this.bind('#mor', () => { s.mortar = !s.mortar; this.app.persist(); render(); });
      this.bind('#kpv', () => { s.kpv = !s.kpv; this.app.persist(); render(); });
      this.bind('#b', () => this.close());
    };
    render();
  }

  // Снаряжение магазинов/ленты: порядок патронов, [0] — первый выстрел
  magLoader(weaponId = null, back = null) {
    const s = this.app.save;
    s.loads = s.loads || {};
    let wid = weaponId || (LOADABLE.includes(s.primary) ? s.primary : 'ak74m');
    let sel = null;
    const CLS = { std: '#9aa3a8', tracer: '#d8402a', ap: '#202020', sniper: '#c9c2a0', he: '#c8a020' };
    const render = () => {
      const w = WEAPONS[wid];
      const fam = ammoChoices(wid);
      if (!sel || !fam.includes(sel)) sel = fam[0];
      const n = loadCount(wid);
      let pat = s.loads[wid];
      if (!pat || pat.length !== n) pat = defaultPattern(wid);
      const per = n > 30 ? 25 : n;
      const mark = (c) => (c === 'tracer' ? 'Т' : c === 'ap' ? 'Б' : c === 'sniper' ? 'С' : c === 'he' ? 'М' : '');
      const cells = pat.map((a, i) => `<i class="rnd" data-i="${i}" title="${i + 1}: ${AMMO[a].name}" style="--c:${CLS[AMMO[a].cls] || '#999'}">${mark(AMMO[a].cls)}</i>`);
      const rows = [];
      for (let i = 0; i < cells.length; i += per) rows.push(`<div class="rrow"><span>${i + 1}</span>${cells.slice(i, i + per).join('')}</div>`);
      const trc = fam.find((a) => AMMO[a].cls === 'tracer');
      this.show(`<h1>Снаряжение ${w.pouch ? 'патронов (по порядку заряжания)' : w.mag > 30 ? 'ленты' : 'магазинов'}</h1>
        <div class="tabs">${LOADABLE.map((id) => `<button class="tab ${id === wid ? 'on' : ''}" data-w="${id}">${WEAPONS[id].name}</button>`).join('')}</div>
        <p class="note">Порядок слева направо — от первого выстрела к последнему (верхний патрон в магазине — первый). Выберите патрон и нажимайте на ячейки (можно провести с зажатой кнопкой). Схема применяется ко всем магазинам этого оружия.</p>
        <div class="pal">${fam.map((a) => `<button class="btn pa ${a === sel ? 'on' : ''}" data-a="${a}"><i style="--c:${CLS[AMMO[a].cls]}"></i>${AMMO[a].name}<small>V₀ ${AMMO[a].v0} м/с · пробитие ${AMMO[a].pen} мм</small></button>`).join('')}</div>
        <div class="strip">${rows.join('')}</div>
        <div class="row">
          <button class="btn sec" data-p="all">Все — ${AMMO[fam[0]].short}</button>
          ${trc ? `<button class="btn sec" data-p="first3">Трассеры: первые 3</button><button class="btn sec" data-p="last3">Трассеры: последние 3 (сигнал)</button><button class="btn sec" data-p="every4">Каждый 4-й трассер</button><button class="btn sec" data-p="every3">Каждый 3-й трассер</button>` : ''}
          <button class="btn sec" data-p="fillSel">Все — выбранным</button>
          ${w.pouch ? '<button class="btn sec" data-p="alt">Чередовать (по умолчанию)</button>' : ''}
        </div>
        <div class="row"><button class="btn" id="b">Готово</button></div>`, { wide: true });
      const save = () => { s.loads[wid] = pat; this.app.persist(); };
      this.panel.querySelectorAll('[data-w]').forEach((b) => b.addEventListener('click', () => { wid = b.dataset.w; render(); }));
      this.panel.querySelectorAll('.pa').forEach((b) => b.addEventListener('click', () => { sel = b.dataset.a; render(); }));
      let painting = false;
      const paint = (el) => { const i = +el.dataset.i; pat[i] = sel; el.style.setProperty('--c', CLS[AMMO[sel].cls]); el.textContent = mark(AMMO[sel].cls); save(); };
      this.panel.querySelectorAll('.rnd').forEach((el) => {
        el.addEventListener('mousedown', (e) => { e.preventDefault(); painting = true; paint(el); });
        el.addEventListener('mouseenter', () => { if (painting) paint(el); });
      });
      addEventListener('mouseup', () => { painting = false; }, { once: true });
      this.panel.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => {
        const base = fam[0];
        const P = b.dataset.p;
        pat = P === 'alt' ? defaultPattern(wid) : Array.from({ length: n }, (_, i) => {
          if (P === 'fillSel') return sel;
          if (P === 'first3' && i < 3) return trc;
          if (P === 'last3' && i >= n - 3) return trc;
          if (P === 'every4' && i % 4 === 3) return trc;
          if (P === 'every3' && i % 3 === 2) return trc;
          return base;
        });
        save(); render();
      }));
      this.bind('#b', () => (back ? back() : this.close()));
    };
    render();
  }

  commanderTalk() {
    const s = this.app.save;
    const next = MISSIONS.find((m) => !m.training && !s.completed[m.id]);
    this.show(`<h1>${STORY.commander}</h1><p class="story">${next ? `«Сержант, следующая задача — <b>${next.title}</b>. Подробности на карте операций. Перед выходом загляните к стенду с таблицами стрельбы: в такой мороз пули идут ниже, чем на летнем стрельбище, а ветер у побережья не прощает ошибок».` : '«Кранди ликвидирован. Отличная работа, Кей. Можете тренироваться на полигоне или переиграть любую операцию».'}</p>
      <p class="story">«Помните: противник не дурак. Пока у них есть патроны — будут давить огнём и обходить с флангов. Когда БК кончается, они стреляют реже, но точнее. Держитесь укрытий и не стойте на месте».</p>
      <div class="row"><button class="btn" data-close>Есть!</button></div>`);
  }

  // ---------------- пауза и итоги ----------------
  pause(m) {
    if (m.net) {
      const owner = this.app.net && this.app.net.room && this.app.net.room.owner === this.app.net.id;
      this.show(`<h1>Меню</h1><div class="opc">${m.def.title} · ${m.pvp ? 'противостояние' : 'кооператив'} — игра продолжается</div><div class="menu">
        <button class="btn" id="r">Продолжить</button><button class="btn" id="c">Управление</button><button class="btn" id="s">Настройки</button>
        ${owner ? '<button class="btn sec" id="ab">Остановить матч для всех</button>' : ''}<button class="btn sec" id="q">Покинуть матч</button></div>`, { onClose: () => this.app.resume() });
      this.bind('#r', () => this.close());
      this.bind('#c', () => this.controls(() => this.pause(m)));
      this.bind('#s', () => this.settings(() => this.pause(m)));
      this.bind('#ab', () => { this.app.net.send({ t: 'abort' }); this.close(); });
      this.bind('#q', () => { this.onClose = null; this.close(); this.app.leaveNetMatch(); });
      return;
    }
    this.show(`<h1>Пауза</h1><div class="opc">${m.def.title}</div><div class="menu">
      <button class="btn" id="r">Продолжить</button><button class="btn" id="t">Таблицы стрельбы</button><button class="btn" id="c">Управление</button>
      <button class="btn" id="s">Настройки</button><button class="btn" id="re">Начать заново</button><button class="btn sec" id="q">${m.def.training ? 'Вернуться в штаб' : 'Прервать задание (в штаб)'}</button></div>`, { onClose: () => this.app.resume() });
    this.bind('#r', () => this.close());
    this.bind('#t', () => this.firingTables(() => this.pause(m)));
    this.bind('#c', () => this.controls(() => this.pause(m)));
    this.bind('#s', () => this.settings(() => this.pause(m)));
    this.bind('#re', () => { this.onClose = null; this.close(); this.app.startMission(m.def.id); });
    this.bind('#q', () => { this.onClose = null; this.close(); this.app.abortMission(); });
  }

  debrief(ok, reason, m) {
    const st = m.stats;
    const acc = st.shots ? ((st.hits / st.shots) * 100).toFixed(0) : '—';
    const min = Math.floor(st.time / 60), sec = Math.floor(st.time % 60);
    const lost = st.lost.map((id) => { const r = ROSTER.find((x) => x.id === id); return r ? '«' + r.callsign + '»' : id; });
    this.show(`<h1>${ok ? 'Задание выполнено' : 'Задание провалено'}</h1><div class="opc">${m.def.title} — ${m.def.code}</div>
      ${reason ? `<p class="story bad">${reason}</p>` : ''}
      <table class="ctl"><tr><td>Время</td><td>${min} мин ${sec} с</td></tr><tr><td>Выстрелов</td><td>${st.shots}</td></tr><tr><td>Попаданий</td><td>${st.hits} (${acc}%)</td></tr>
      <tr><td>Уничтожено противников (лично)</td><td>${st.kills}</td></tr><tr><td>Выбыли из строя</td><td>${lost.length ? lost.join(', ') + ' — в госпиталь на одну операцию' : 'нет'}</td></tr></table>
      <div class="row">${ok && m.def.id === 'm5' ? '<button class="btn" id="end">Далее</button>' : '<button class="btn" id="hq">В штаб</button>'}<button class="btn sec" id="again">Повторить</button></div>`);
    this.bind('#hq', () => { this.close(); this.app.toHQ(); });
    this.bind('#end', () => this.ending());
    this.bind('#again', () => { this.close(); this.app.startMission(m.def.id); });
  }

  ending() {
    this.show(`<h1>Конец операции</h1>${STORY.ending.map((p) => `<p class="story">${p}</p>`).join('')}<p class="note">Спасибо за службу, сержант. Все операции открыты для повторного прохождения.</p>
      <div class="row"><button class="btn" id="hq">В штаб</button></div>`);
    this.bind('#hq', () => { this.close(); this.app.toHQ(); });
  }

  toast(text, t = 2.2) {
    if (!this.toastEl) { this.toastEl = document.createElement('div'); this.toastEl.className = 'toast'; document.body.appendChild(this.toastEl); }
    this.toastEl.textContent = text; this.toastEl.style.opacity = 1;
    clearTimeout(this._tt); this._tt = setTimeout(() => { this.toastEl.style.opacity = 0; }, t * 1000);
    this.app.audio.mech('switch');
  }

  clickToPlay(text = 'Нажмите, чтобы продолжить') {
    this.hqHint.innerHTML = text;
    this.hqHint.style.display = 'block';
  }
}
