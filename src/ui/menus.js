// Экранные меню: главное меню, брифинги, таблицы стрельбы, личный состав, оружейная,
// автопарк, пауза, настройки, итоги задания, финал.
import { STORY } from '../data/story.js';
import { MISSIONS } from '../data/missions.js';
import { ROSTER, STAT_NAMES } from '../data/squad.js';
import { WEAPONS, AMMO, PRIMARY_CHOICES } from '../data/weapons.js';
import { VEHICLE_TYPES } from '../entities/vehicle.js';
import { buildFiringTable, handGrenadeTable, TABLE_WEAPONS } from '../physics/firingTable.js';
import { drawChart } from './charts.js';
import { CARDINALS } from '../core/math.js';

const CONTROLS = [
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
        <button class="btn" id="tables">Таблицы стрельбы</button>
        <button class="btn" id="set">Настройки</button>
        <button class="btn" id="ctl">Управление</button>
      </div>
      <div class="foot">Реалистичная баллистика: сопротивление воздуха (G7), ветер, температура, деривация, сила Кориолиса, реактивные гранаты.<br>Нет прицельной точки — только целик и мушка или сетка оптического прицела.</div>`, { cls: 'mainmenu' });
    this.bind('#cont', () => { this.close(); this.app.toHQ(); });
    this.bind('#new', () => { this.app.newCampaign(); this.intro(); });
    this.bind('#range', () => { this.close(); this.app.startMission('range'); });
    this.bind('#tables', () => this.firingTables(() => this.mainMenu()));
    this.bind('#set', () => this.settings(() => this.mainMenu()));
    this.bind('#ctl', () => this.controls(() => this.mainMenu()));
  }

  intro() {
    this.show(`<h1>Заполярье</h1>${STORY.intro.map((p) => `<p class="story">${p}</p>`).join('')}<div class="row"><button class="btn" id="go">В штаб</button></div>`);
    this.bind('#go', () => { this.close(); this.app.toHQ(); });
  }

  controls(back) {
    this.show(`<h1>Управление</h1><table class="ctl">${CONTROLS.map(([k, v]) => `<tr><td><b>${k}</b></td><td>${v}</td></tr>`).join('')}</table>
      <p class="note">Прицеливания «точкой» нет: совместите вершину мушки с серединой прорези целика («ровная мушка») и подведите под цель. Установите прицел по дальности. Пуля вылетает из дульного среза по оси ствола — при раскачке и неровной мушке она уйдёт туда, куда смотрит ствол.</p>
      <div class="row"><button class="btn" id="b">Назад</button></div>`);
    this.bind('#b', () => (back ? back() : this.close()));
  }

  settings(back) {
    const st = this.app.settings;
    this.show(`<h1>Настройки</h1>
      <label>Чувствительность мыши <input type="range" id="sens" min="0.5" max="6" step="0.1" value="${st.sens}"><span id="sv">${st.sens}</span></label>
      <label>Поле зрения (FOV) <input type="range" id="fov" min="55" max="95" step="1" value="${st.fov}"><span id="fv">${st.fov}</span></label>
      <label>Громкость <input type="range" id="vol" min="0" max="1" step="0.05" value="${st.volume}"></label>
      <label>Качество графики <select id="q"><option value="low">Низкое</option><option value="medium">Среднее</option><option value="high">Высокое</option></select></label>
      <label><input type="checkbox" id="inv" ${st.invertY ? 'checked' : ''}> Инвертировать ось Y</label>
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
      <div id="ft"></div><div class="row"><button class="btn" id="b">Закрыть</button></div>`, { wide: true });
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

  // ---------------- операции ----------------
  operations() {
    const s = this.app.save;
    const avail = (i) => i <= 1 || s.completed[MISSIONS[i - 1].id];
    this.show(`<h1>Карта операций</h1><div class="ops">${MISSIONS.map((m, i) => `
      <div class="op ${avail(i) ? '' : 'locked'} ${s.completed[m.id] ? 'done' : ''}" data-i="${i}">
        <div class="opt">${m.training ? '◆' : i + '.'} ${m.title}</div><div class="opc">${m.code}</div>
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
    const seats = (s.vehicles || []).reduce((a, v) => a + VEHICLE_TYPES[v].seats, 0);
    this.show(`<h1>${m.title}</h1><div class="opc">${m.code}</div>
      <div class="brief">${m.brief.split('\n').map((p) => `<p>${p}</p>`).join('')}</div>
      <div class="cond"><b>Условия:</b> ${timeName}; t = ${e.tempC} °C; ветер ${CARDINALS[Math.round(e.windFrom / 45) % 8]} (${e.windFrom}°), ${e.wind} м/с; видимость ~${e.visibility} м${e.snow > 0.3 ? '; снегопад' : ''}${e.aurora ? '; северное сияние' : ''}.</div>
      ${m.noSquad ? '' : `<div class="cond"><b>Отделение:</b> ${squad.map((id) => '«' + ROSTER.find((r) => r.id === id).callsign + '»').join(', ') || 'Кей идёт один'}.<br><b>Оружие Кея:</b> ${WEAPONS[s.primary].name}${s.launcher ? ' + РПГ-7В' : ''}. <b>Техника:</b> ${(s.vehicles || []).map((v) => VEHICLE_TYPES[v].name).join(', ') || 'пешком'} (мест: ${seats}, нужно ${squad.length + 1}).</div>
      <p class="note">Изменить состав, оружие и технику — у стендов в штабе.</p>`}
      <div class="row"><button class="btn" id="go">Выход на задание</button><button class="btn sec" id="back">Назад</button></div>`, { wide: true });
    this.bind('#go', () => { this.close(); this.app.startMission(m.id); });
    this.bind('#back', () => this.operations());
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
      this.bind('.card', (e) => {
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
      <label class="chk"><input type="checkbox" id="rpg" ${s.launcher ? 'checked' : ''}> Взять РПГ-7В (3 выстрела ПГ-7ВМ, слот 2) — ${WEAPONS.rpg7.desc}</label>
      <div class="row"><button class="btn" id="b">Готово</button></div>`, { wide: true });
      this.bind('.card', (e) => { s.primary = e.dataset.id; this.app.persist(); render(); });
      this.panel.querySelector('#rpg').onchange = (e) => { s.launcher = e.target.checked; this.app.persist(); };
      this.bind('#b', () => this.close());
    };
    render();
  }

  motorPool() {
    const s = this.app.save;
    const render = () => {
      const seats = (s.vehicles || []).reduce((a, v) => a + VEHICLE_TYPES[v].seats, 0);
      this.show(`<h1>Автопарк</h1><p class="note">Выберите до двух машин для выдвижения (мест: ${seats}, нужно ${s.squad.length + 1}). На задании: подойдите к машине и нажмите E. Отделение по команде «за мной» (F) рассаживается само; в МТ-ЛБ один из бойцов садится за ПКТ.</p>
        <div class="arm">${Object.values(VEHICLE_TYPES).map((v) => `<div class="card ${s.vehicles.includes(v.id) ? 'on' : ''}" data-id="${v.id}"><div class="ct">${v.name}</div><div class="cr">${v.cls}</div>
          <div class="cn">Скорость до ${(v.maxSpeed * 3.6).toFixed(0)} км/ч · мест ${v.seats} · броня ${v.armor.front}/${v.armor.side} мм${v.gun ? ' · ' + WEAPONS[v.gun].name : ''}</div><div class="cb">${v.desc}</div></div>`).join('')}</div>
        <div class="row"><button class="btn" id="b">Готово</button></div>`, { wide: true });
      this.bind('.card', (e) => {
        const id = e.dataset.id;
        const i = s.vehicles.indexOf(id);
        if (i >= 0) s.vehicles.splice(i, 1); else { s.vehicles.push(id); if (s.vehicles.length > 2) s.vehicles.shift(); }
        this.app.persist(); render();
      });
      this.bind('#b', () => this.close());
    };
    render();
  }

  commanderTalk() {
    const s = this.app.save;
    const next = MISSIONS.find((m, i) => i > 0 && !s.completed[m.id]);
    this.show(`<h1>${STORY.commander}</h1><p class="story">${next ? `«Сержант, следующая задача — <b>${next.title}</b>. Подробности на карте операций. Перед выходом загляните к стенду с таблицами стрельбы: в такой мороз пули идут ниже, чем на летнем стрельбище, а ветер у побережья не прощает ошибок».` : '«Кранди ликвидирован. Отличная работа, Кей. Можете тренироваться на полигоне или переиграть любую операцию».'}</p>
      <p class="story">«Помните: противник не дурак. Пока у них есть патроны — будут давить огнём и обходить с флангов. Когда БК кончается, они стреляют реже, но точнее. Держитесь укрытий и не стойте на месте».</p>
      <div class="row"><button class="btn" data-close>Есть!</button></div>`);
  }

  // ---------------- пауза и итоги ----------------
  pause(m) {
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

  clickToPlay(text = 'Нажмите, чтобы продолжить') {
    this.hqHint.innerHTML = text;
    this.hqHint.style.display = 'block';
  }
}
