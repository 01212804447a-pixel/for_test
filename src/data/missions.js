// Миссии. build(ctx) расставляет объекты, противника и этапы задач.
import { rand } from '../core/math.js';

const PI = Math.PI;

export const MISSIONS = [
  // ================================================================ ПОЛИГОН
  {
    id: 'range', title: 'Полигон «Норд»', code: 'Учебно-тренировочные стрельбы', training: true,
    brief: 'Стрельбище ПВД. Мишени на 50–1000 м, остовы техники для РПГ, валы для ГП-25. На огневом рубеже — пирамида с оружием (E) и ящик с боеприпасами. Корректировщик сообщает отклонение каждого попадания от центра мишени. Здесь же можно опробовать «Тигр», «Ниву» и МТ-ЛБ.',
    env: { time: 'day', sunElev: 9, sunAz: 200, overcast: 0.05, snow: 0.05, tempC: -20, windFrom: 270, wind: 3, visibility: 1500, fog: 0.0003 },
    terrain: { seed: 5, amp: 7, features: [
      { type: 'flat', x: 0, z: -450, r: 520, fall: 120, dh: 0 },
    ] },
    start: { x: 0, z: 6, yaw: 0 },
    navSize: 300, navCenter: { x: 0, z: 0 },
    noSquad: true,
    vehicles: [{ type: 'tigr', x: -30, z: 30, yaw: PI / 2 }, { type: 'niva', x: -30, z: 42, yaw: PI / 2 }, { type: 'mtlb', x: -32, z: 58, yaw: PI / 2 }],
    build(ctx) {
      const { S } = ctx;
      // огневой рубеж
      for (let i = -3; i <= 3; i++) {
        S.sandbags({ x: i * 4, z: -1.5, yaw: 0, len: 2.4, h: 0.65 });
      }
      S.building({ x: 0, z: 18, w: 14, d: 6, h: 2.6, material: 'wood', doors: [{ side: 'n', at: 0, width: 3 }], windows: 2, roof: 'gable', interior: 'office' });
      S.sign({ x: 10, z: 2, text: 'ОГНЕВОЙ РУБЕЖ', sub: 'Полигон «Норд»' });
      const dists = [[50, 'chest', 0.5, 0.5, -6], [100, 'chest', 0.5, 0.5, 6], [200, 'chest', 0.5, 0.5, -10], [300, 'rings', 1, 1, 10], [400, 'rings', 1, 1, -14], [500, 'rings', 1.5, 1.5, 14], [600, 'rings', 1.5, 1.5, -18], [800, 'rings', 2, 2, 18], [1000, 'rings', 2.5, 2.5, 0]];
      for (const [d, k, w, h, x] of dists) {
        S.target({ x, z: -d, kind: k, w, h, facing: 0, label: d + ' м' });
        S.berm({ x, z: -d - 3, len: Math.max(4, w * 3), h: h + 0.8 });
      }
      for (const [x, z] of [[40, -150], [60, -300], [-45, -250], [-70, -420]]) { S.wreck({ x, z, yaw: rand(0, 3) }); S.sign({ x: x + 4, z: z + 4, text: `${-z} м` }); }
      for (const d of [100, 200, 300]) { S.berm({ x: 90, z: -d, len: 10, h: 1.6 }); S.target({ x: 90, z: -d + 2, kind: 'chest', w: 1.5, h: 1, label: `ГП ${d} м` }); }
      // флажки ветра
      for (const d of [100, 300, 500, 700]) ctx.windFlag(-25, -d);
      ctx.scatter({ x: 0, z: -300, r: 900, rocks: 40, trees: 60, avoid: [{ x: 0, z: -500, r: 140 }, { x: 0, z: 0, r: 60 }] });
      ctx.poi.ruin({ x: -160, z: -260, yaw: 0.2 }); ctx.poi.chum({ x: 140, z: 80, seed: 1 }); ctx.forest({ x: 200, z: -100, r: 120, trees: 22, seed: 2 }); ctx.forest({ x: -220, z: 60, r: 100, trees: 18, seed: 3 });
      // «плинкинг»: банки на полке 25 м, канистры и ящики на 50 м, бочки на 75 м
      S.box({ x: -12, z: -25, w: 6, d: 0.5, h: 1.0, material: 'woodLight', mat: 'wood', pen: 5 });
      const sy = ctx.ground(-12, -25) + 1.0;
      for (let i = 0; i < 9; i++) ctx.prop(i % 3 ? 'can' : 'cans', -14.6 + i * 0.65, -25, { y: sy + 0.08 });
      for (let i = 0; i < 4; i++) ctx.prop(['jerrycan', 'crate', 'ammobox', 'propane'][i], -16 + i * 2.2, -50);
      for (let i = 0; i < 3; i++) ctx.prop('barrel', -15 + i * 2.5, -75);
      ctx.weaponRack(-6, 4);
      ctx.ammoCrate(6, 4);
      ctx.stage([ctx.objCustom('Свободная стрельба. Таблицы стрельбы — в штабе. Esc → «Вернуться в штаб»', () => false)]);
      ctx.radio('Руководитель стрельб: Рубеж открыт. Ветер западный 3 м/с, температура −20. Корректировщик на связи.', 'РС', 1);
    },
  },
  // ================================================================ АРТИЛЛЕРИЯ
  {
    id: 'artillery', title: 'Огневая позиция «Кедр»', code: 'Боевые стрельбы 122-мм гаубицы Д-30', training: true, guide: 'd30',
    brief: 'Огневая позиция батареи на сопке «Кедр». Вы — наводчик гаубицы Д-30 (подойдите к орудию, E). Пять целей на удалении 3–12 км, координаты — на карте огня (M). Наблюдатель на НП докладывает о каждом разрыве: перелёт/недолёт и отклонение в метрах. Порядок работы — в гайде (G на месте наводчика или кнопка в брифинге): подготовьте установки по карте и таблице стрельбы, учтите мороз и ветер, пристреляйтесь и подавите цели.',
    env: { time: 'day', sunElev: 8, sunAz: 195, overcast: 0.15, snow: 0, tempC: -22, windFrom: 300, wind: 5, visibility: 14000, fog: 0.000045 },
    terrain: { seed: 31, amp: 46, size: 16000, seg: 448, boundary: 7300, mountain: 420, features: [
      { type: 'flat', x: 0, z: 5600, r: 75, fall: 280, h: 58 }, // сопка «Кедр»: ОП на плоской вершине
      { type: 'flat', x: -700, z: 2600, r: 70, fall: 60, dh: 0 },
      { type: 'flat', x: 1100, z: 400, r: 60, fall: 60, dh: 0 },
      { type: 'flat', x: -1900, z: -1700, r: 50, fall: 60, dh: 0 },
      { type: 'flat', x: 2100, z: -4300, r: 70, fall: 60, dh: 0 },
      { type: 'flat', x: -1200, z: -6300, r: 70, fall: 60, dh: 0 },
    ] },
    far: 16000, gunDir: 0, groundCenter: { x: 0, z: 5600 },
    start: { x: -3, z: 5609, yaw: 0 },
    navSize: 260, navCenter: { x: 0, z: 5600 },
    noSquad: true,
    build(ctx) {
      const { S } = ctx;
      // огневая позиция: орудийный окоп с бруствером, ниши для боеприпасов, блиндаж расчёта
      const gun = ctx.howitzer({ x: 0, z: 5600, dir: 0, name: 'Д-30 № 1' });
      // бруствер подковой, открытой назад (ниши и подход расчёта — с тыла)
      for (let i = 0; i < 9; i++) { const a = Math.PI - 2.3 + i * 0.575; S.berm({ x: Math.sin(a) * 7.5, z: 5600 + Math.cos(a) * 7.5, yaw: a, len: 4.6, h: 0.8 }); }
      for (const [x, z] of [[-4.5, 5605.5], [4.6, 5605]]) { ctx.prop('ammobox', x, z); ctx.prop('ammobox', x + 0.7, z + 0.2); ctx.prop('crate', x, z + 1.1); }
      S.bunker({ x: -16, z: 5618, yaw: 0.3, w: 6, d: 5 });
      S.sandbags({ x: 12, z: 5612, yaw: -0.4, len: 4, h: 0.8 });
      S.sign({ x: 5, z: 5614, text: 'ОП «КЕДР»', sub: 'основное направление 0-00' });
      S.antenna({ x: -22, z: 5626, h: 9 });
      ctx.vehicle('mtlb', { x: -24, z: 5640, yaw: 0.6 });
      ctx.ammoCrate(9, 5606);
      ctx.windFlag(14, 5596);
      // цели
      const T = [];
      // 1. Колонна на марше: техника и остовы на дороге
      T.push(ctx.artTarget({ name: 'Цель 101 «Колонна»', short: '101', desc: 'техника на привале', x: -700, z: 2600, r: 22, hp: 560 }));
      ctx.vehicle('tigr', { x: -712, z: 2594, yaw: 1.2, team: 'denter' });
      ctx.vehicle('niva', { x: -690, z: 2610, yaw: 1.4, team: 'denter' });
      S.wreck({ x: -726, z: 2606, yaw: 0.4 }); ctx.poi.truckWreck({ x: -680, z: 2588, yaw: 1.3 });
      ctx.forest({ x: -820, z: 2520, r: 90, trees: 10, seed: 41 });
      // 2. Опорный пункт: ДЗОТ, окопы, вышка
      T.push(ctx.artTarget({ name: 'Цель 102 «Опорный пункт»', short: '102', desc: 'ДЗОТ, окопы, пулемётная вышка', x: 1100, z: 400, r: 18, hp: 620 }));
      S.bunker({ x: 1100, z: 400, yaw: Math.PI, w: 6, d: 5 });
      for (let i = 0; i < 5; i++) S.sandbags({ x: 1086 + i * 7, z: 412 + Math.sin(i) * 3, yaw: 0.1 * i, len: 5, h: 0.9 });
      S.tower({ x: 1120, z: 388, h: 6 });
      S.crates({ x: 1090, z: 392, n: 4, seed: 5 });
      ctx.forest({ x: 1250, z: 520, r: 120, trees: 14, seed: 42 });
      // 3. Наблюдательный пункт на высоте: вышка, антенна, блиндаж
      T.push(ctx.artTarget({ name: 'Цель 103 «НП»', short: '103', desc: 'наблюдательный пункт, антенна связи', x: -1900, z: -1700, r: 15, hp: 480 }));
      S.tower({ x: -1904, z: -1696, h: 8 });
      S.antenna({ x: -1892, z: -1708, h: 16 });
      S.bunker({ x: -1912, z: -1690, yaw: 0.5, w: 5, d: 4 });
      // 4. Миномётная батарея: позиции, ящики, машина
      T.push(ctx.artTarget({ name: 'Цель 104 «Батарея»', short: '104', desc: 'миномётная батарея, 4 позиции', x: 2100, z: -4300, r: 26, hp: 700 }));
      for (let i = 0; i < 4; i++) { S.sandbags({ x: 2070 + i * 20, z: -4300, yaw: 0, len: 3.2, h: 0.7, curve: 1 }); S.crates({ x: 2072 + i * 20, z: -4292, n: 2, seed: 10 + i }); }
      ctx.vehicle('tigr', { x: 2100, z: -4278, yaw: 0.2, team: 'denter' });
      ctx.forest({ x: 2000, z: -4460, r: 150, trees: 16, seed: 43 });
      // 5. Склад ГСМ: цистерны
      T.push(ctx.artTarget({ name: 'Цель 105 «Склад ГСМ»', short: '105', desc: 'цистерны с топливом, обвалование', x: -1200, z: -6300, r: 24, hp: 600 }));
      S.fuelTank({ x: -1210, z: -6304, r: 4, h: 7, id: 'gsm1' }); S.fuelTank({ x: -1192, z: -6292, r: 4, h: 7, id: 'gsm2' });
      S.berm({ x: -1200, z: -6280, len: 26, h: 1.6 }); S.berm({ x: -1200, z: -6322, len: 26, h: 1.6 });
      // местность: перелески, валуны, деревни, ЛЭП
      ctx.scatter({ x: 0, z: 5600, r: 600, rocks: 50, trees: 40, avoid: [{ x: 0, z: 5600, r: 45 }], seed: 3 });
      for (const [x, z, r, n, sd] of [[-2600, 4200, 400, 16, 1], [2400, 3300, 500, 18, 2], [-300, 1200, 380, 14, 3], [3000, -1200, 520, 16, 4], [-3200, -3600, 600, 16, 5], [600, -2600, 420, 12, 6], [-200, -5000, 500, 14, 7], [3600, 1800, 360, 10, 8], [-4200, 1000, 500, 14, 9]]) ctx.forest({ x, z, r, trees: n, seed: 50 + sd });
      ctx.poi.village({ x: -2600, z: 600, yaw: 0.4, n: 7, seed: 9, name: 'Кылъярв' });
      ctx.poi.village({ x: 2900, z: -2900, yaw: -0.3, n: 5, seed: 11, name: 'Мурдозеро' });
      ctx.poi.powerLine({ pts: [[-2600, 2300], [-300, 1500], [2000, 400]], spacing: 80 });
      ctx.poi.ruin({ x: 800, z: 4300, yaw: 0.3 });
      ctx.stage([ctx.objDestroy('Подавить цели 101–105 (карта огня — M, таблица — T, гайд — G)', T)], null, () => ctx.radio('Все цели подавлены. Стрельбу окончить, орудие — в походное. Отличная работа, наводчик!', 'Командир батареи'));
      ctx.radio('Командир батареи: Наводчик, к орудию! Основное направление 0-00. Цели 101–105 на карте огня. Метео: −22, ветер с северо-запада 5 м/с. Огонь — по готовности, о разрывах докладывает НП.', 'КБ', 1.5);
      void gun;
    },
  },
  // ================================================================ 1
  {
    id: 'm1', title: 'Тихая станция', code: 'Операция «Северный ветер»',
    brief: 'Группа «Дентера» заняла метеостанцию «Полярная-7» и использует её ретранслятор для связи с побережьем. По данным разведки — до 10 боевиков, пулемётная точка у ворот, наблюдатель на вышке.\n\nЗадача: скрытно выдвинуться, уничтожить противника, забрать жёсткий диск ретранслятора и вернуться к точке эвакуации.',
    env: { time: 'day', sunElev: 6, sunAz: 205, overcast: 0.3, snow: 0.18, tempC: -22, windFrom: 270, wind: 4, visibility: 750, fog: 0.0008 },
    terrain: { seed: 11, amp: 26, features: [
      { type: 'hill', x: 320, z: -320, r: 220, h: 26 }, { type: 'hill', x: -380, z: 120, r: 200, h: 30 },
      { type: 'lake', x: -260, z: -380, r: 85, fall: 25 },
      { type: 'road', pts: [[10, 760], [70, 520], [25, 320], [-30, 120], [0, -95]], w: 7, fall: 7 },
      { type: 'flat', x: 0, z: -150, r: 72, fall: 40 },
      { type: 'flat', x: -230, z: 420, r: 60, fall: 35 }, { type: 'flat', x: 210, z: -40, r: 16, fall: 12 }, { type: 'flat', x: -150, z: 120, r: 14, fall: 12 }, { type: 'flat', x: 337, z: 160, r: 25, fall: 15 },
    ] },
    start: { x: 10, z: 690, yaw: 0 }, navCenter: { x: 0, z: 150 }, navSize: 900,
    build(ctx) {
      const { S } = ctx;
      S.building({ x: -15, z: -152, w: 12, d: 8, h: 3.2, material: 'concrete', doors: [{ side: 's', at: -3 }], windows: 2, roof: 'flat', interior: 'office' });
      S.building({ x: 16, z: -142, yaw: 0.1, w: 10, d: 6, h: 2.8, material: 'wood', doors: [{ side: 'w', at: 0 }], windows: 2, roof: 'gable', interior: 'barracks' });
      S.container({ x: 22, z: -178, yaw: PI / 2, color: 'blue' });
      S.container({ x: 28, z: -178, yaw: PI / 2, color: 'red' });
      S.antenna({ x: -4, z: -178, h: 22 });
      const tw = S.tower({ x: 36, z: -110, h: 5 });
      S.sandbags({ x: 0, z: -105, yaw: 0, len: 4.5, curve: 0.6 });
      S.sandbags({ x: -30, z: -121, yaw: 0.8, len: 3 });
      S.crates({ x: 5, z: -162, n: 4 }); S.crates({ x: -30, z: -168, n: 3 }); S.barrels({ x: 10, z: -188, n: 5 });
      for (const [x, z] of [[-34, -140], [-38, -146]]) S.box({ x, z, w: 1, d: 1, h: 1.4, mat: 'wood', material: 'white' });
      S.sign({ x: 7, z: -94, text: 'Метеостанция', sub: '«Полярная-7»' });
      S.fence({ pts: [[-45, -100], [-6, -100]] });
      S.fence({ pts: [[6, -100], [45, -100], [45, -205], [-45, -205], [-45, -100]] });
      S.wreck({ x: 40, z: 40, yaw: 1 });
      ctx.scatter({ x: 0, z: 250, r: 560, rocks: 110, trees: 40, avoid: [{ x: 0, z: -150, r: 80 }], road: true });
      ctx.scatter({ x: 0, z: -200, r: 900, rocks: 60, trees: 80, avoid: [{ x: 0, z: -150, r: 90 }] });
      ctx.poi.village({ x: -230, z: 420, yaw: 0.3, n: 6, seed: 11, name: 'пос. Верхний Кильдин' });
      ctx.poi.powerLine({ pts: [[-230, 400], [-120, 330], [-48, 150], [-50, -60], [-30, -100]] });
      ctx.poi.truckWreck({ x: 92, z: 430, yaw: 1.2 });
      ctx.poi.chum({ x: 330, z: 150, seed: 4 }); ctx.poi.chum({ x: 346, z: 170, seed: 5 });
      ctx.poi.ruin({ x: 210, z: -40, yaw: 0.4 }); ctx.poi.ruin({ x: -150, z: 120, yaw: -0.2, w: 10, d: 7, seed: 6 });
      ctx.forest({ x: -200, z: 230, r: 110, trees: 26, seed: 3 }); ctx.forest({ x: 260, z: 420, r: 100, trees: 22, seed: 4 }); ctx.forest({ x: 170, z: -300, r: 130, trees: 28, seed: 5 });
      const g = ctx.group('station');
      ctx.enemy({ x: 36, z: -110, y: tw.top, yaw: PI, weapon: 'svd', role: 'sniper', static: true, group: g, skill: { aim: 0.6, reaction: 0.5 } });
      ctx.enemy({ x: 0, z: -107.5, yaw: PI, weapon: 'pkm', role: 'mg', mode: 'guard', group: g });
      ctx.enemy({ x: -9, z: -96, yaw: PI, mode: 'guard', group: g, weapon: 'akm' });
      ctx.enemy({ x: 9, z: -97, yaw: PI - 0.4, mode: 'guard', group: g, weapon: 'akm' });
      const route = [{ x: -55, z: -90 }, { x: 55, z: -90 }, { x: 55, z: -215 }, { x: -55, z: -215 }];
      ctx.enemy({ x: -55, z: -90, mode: 'patrol', route, group: g, weapon: 'akm' });
      ctx.enemy({ x: -52, z: -92, mode: 'patrol', route, group: g, weapon: 'ak74m' });
      ctx.enemy({ x: -15, z: -154, yaw: PI, mode: 'guard', group: g, weapon: 'ak74m' });
      ctx.enemy({ x: 14, z: -141, yaw: 1.2, mode: 'guard', group: g, weapon: 'akm' });
      ctx.enemy({ x: 22, z: -167, yaw: PI, mode: 'guard', group: g, weapon: 'akm' });
      ctx.enemy({ x: -31, z: -124, yaw: PI - 0.6, mode: 'guard', group: g, weapon: 'ak74m', grenades: 2 });
      const drive = ctx.item({ x: -18, z: -154, label: 'Забрать жёсткий диск ретранслятора', hold: 3 });
      ctx.stage([ctx.objReach('Скрытно выдвинуться к метеостанции «Полярная-7»', 0, -150, 170)], null, () => ctx.radio('Кей, вы в зоне. Наблюдатель на вышке в северо-восточном углу, пулемёт у ворот. Работайте.', 'Штаб'));
      ctx.stage([
        ctx.objEliminate('Уничтожить группу «Дентера» на станции', [g], 0.9),
        ctx.objInteract('Найти данные ретранслятора (жёсткий диск в здании станции)', drive),
      ], null, () => ctx.radio('Данные у нас. На диске — график колонны «Дентера» через Белый перевал. Возвращайтесь.', 'Штаб'));
      ctx.stage([ctx.objReach('Вернуться к точке эвакуации', 10, 690, 35)]);
      g.onAlert = () => ctx.radio('Нас обнаружили! Работаем!', 'Кей', 0.5);
      ctx.radio('Кей, приём. Цель — метеостанция в 850 м к северу по дороге. Ветер западный 4 м/с, −22. Удачи.', 'Штаб', 1);
    },
  },
  // ================================================================ 2
  {
    id: 'm2', title: 'Белый перевал', code: 'Операция «Капкан»',
    brief: 'По данным с метеостанции, через Белый перевал пройдёт колонна «Дентера»: две «Нивы» и трофейный МТ-ЛБ с десантом и оружием. На восточном выходе из перевала — их блокпост.\n\nЗадача: занять гребень южнее дороги, устроить засаду, уничтожить технику и сопровождение, найти планшет командира колонны. Снегопад, видимость ~350 м. Не дайте колонне уйти на восток!',
    env: { time: 'day', sunElev: 4, sunAz: 190, overcast: 0.85, snow: 0.7, tempC: -27, windFrom: 90, wind: 7, visibility: 380, fog: 0.0024 },
    terrain: { seed: 23, amp: 18, features: [
      { type: 'hill', x: 0, z: 185, r: 170, h: 30 }, { type: 'hill', x: 320, z: 210, r: 150, h: 24 }, { type: 'hill', x: -330, z: 195, r: 160, h: 26 },
      { type: 'hill', x: 0, z: -210, r: 190, h: 36 }, { type: 'hill', x: 420, z: -230, r: 160, h: 30 }, { type: 'hill', x: -430, z: -220, r: 170, h: 32 },
      { type: 'valley', pts: [[-1200, 0], [-500, 20], [0, 0], [500, -30], [1200, -10]], w: 70, depth: 7 },
      { type: 'road', pts: [[-1200, 0], [-500, 20], [0, 0], [500, -30], [1200, -10]], w: 8, fall: 8 },
      { type: 'flat', x: 460, z: -30, r: 30, fall: 20 },
      { type: 'flat', x: -480, z: 330, r: 50, fall: 30 }, { type: 'flat', x: -160, z: 250, r: 16, fall: 12 }, { type: 'flat', x: 280, z: 380, r: 15, fall: 10 },
    ] },
    start: { x: 30, z: 470, yaw: 0 }, navCenter: { x: 100, z: 120 }, navSize: 900,
    build(ctx) {
      const { S } = ctx;
      const road = [[-1050, 3], [-500, 20], [0, 0], [500, -30], [1150, -10]].map(([x, z]) => ({ x, z }));
      // блокпост
      S.sandbags({ x: 452, z: -38, yaw: 0, len: 5 }); S.sandbags({ x: 468, z: -22, yaw: 0, len: 5 });
      S.container({ x: 470, z: -46, yaw: 0.1, color: 'green' });
      S.box({ x: 460, z: -30, w: 0.2, d: 7, h: 1.1, yaw: 0, material: 'contRed', mat: 'metal', cover: false });
      S.crates({ x: 448, z: -48, n: 3 }); S.barrels({ x: 476, z: -36, n: 4 });
      S.sign({ x: 440, z: -40, text: 'СТОЙ!', sub: 'Проезд закрыт' });
      ctx.scatter({ x: 0, z: 180, r: 450, rocks: 120, trees: 50, avoid: [{ x: 460, z: -30, r: 40 }], road: true });
      ctx.scatter({ x: 0, z: -220, r: 700, rocks: 80, trees: 90, road: true });
      ctx.poi.powerLine({ pts: [[-1000, 42], [-500, 62], [0, 42], [500, 12], [1000, 30]] });
      ctx.poi.truckWreck({ x: -220, z: 30, yaw: -0.2 }); ctx.poi.truckWreck({ x: 262, z: -55, yaw: 2.9, burnt: false });
      ctx.poi.ruin({ x: -160, z: 250, yaw: 0.3 });
      ctx.poi.chum({ x: 280, z: 380, seed: 2 });
      ctx.poi.village({ x: -480, z: 330, yaw: 0, n: 4, seed: 21, name: 'Рудник «Белый»' });
      ctx.forest({ x: 150, z: 300, r: 120, trees: 24, seed: 8 }); ctx.forest({ x: -300, z: -320, r: 150, trees: 30, seed: 9 }); ctx.forest({ x: 400, z: -380, r: 120, trees: 22, seed: 10 });
      const cp = ctx.group('checkpoint');
      ctx.enemy({ x: 452, z: -41, yaw: -PI / 2, mode: 'guard', group: cp, weapon: 'pkm', role: 'mg' });
      ctx.enemy({ x: 468, z: -19, yaw: PI / 2, mode: 'guard', group: cp, weapon: 'akm' });
      ctx.enemy({ x: 462, z: -36, yaw: PI / 2, mode: 'guard', group: cp, weapon: 'ak74m' });
      ctx.enemy({ x: 474, z: -48, yaw: 0, mode: 'guard', group: cp, weapon: 'akm', secondary: 'rpg7', role: 'at' });
      const convoy = ctx.group('convoy');
      let vehs = [];
      let tablet = null;
      const spawnConvoy = () => {
        const n1 = ctx.vehicle('niva', { x: road[0].x, z: road[0].z, yaw: -PI / 2, team: 'denter', ai: { route: road.slice(1), speed: 9 }, crew: [{ weapon: 'akm' }, { weapon: 'ak74m' }, { weapon: 'akm' }], group: convoy });
        const mt = ctx.vehicle('mtlb', { x: road[0].x - 28, z: road[0].z, yaw: -PI / 2, team: 'denter', ai: { route: road.slice(1), speed: 9, leader: n1 }, crew: [{ weapon: 'ak74m' }, { weapon: 'ak74m', role: 'rifleman' }, { weapon: 'pkm', role: 'mg' }, { weapon: 'akm' }, { weapon: 'akm', secondary: 'rpg7', role: 'at' }, { weapon: 'ak74m' }, { weapon: 'akm' }, { weapon: 'ak74m', role: 'leader' }], group: convoy });
        const n2 = ctx.vehicle('niva', { x: road[0].x - 56, z: road[0].z, yaw: -PI / 2, team: 'denter', ai: { route: road.slice(1), speed: 9, leader: mt }, crew: [{ weapon: 'akm' }, { weapon: 'akm' }, { weapon: 'ak74m' }], group: convoy });
        vehs = [n1, mt, n2];
        ctx.radio('Колонна прошла западный вход в перевал. Три машины, МТ-ЛБ в середине. Ждите их у поворота.', 'Штаб');
        return vehs;
      };
      ctx.stage([ctx.objReach('Занять позицию для засады на гребне южнее дороги', 0, 150, 45)], () => ctx.radio('Выдвигайтесь на гребень. Колонна будет минут через пять.', 'Штаб'));
      const destroyObj = ctx.objCustom('Уничтожить технику колонны (3)', () => vehs.length > 0 && vehs.every((v) => !v.alive), () => { const v = vehs.find((x) => x.alive); return v ? v.pos : null; });
      ctx.stage([destroyObj, ctx.objEliminate('Уничтожить сопровождение колонны', [convoy], 0.85)], () => spawnConvoy(), () => {
        tablet = ctx.item({ x: vehs[1].pos.x + 3.5, z: vehs[1].pos.z + 1, label: 'Обыскать МТ-ЛБ: планшет командира', hold: 3 });
      });
      ctx.stage([ctx.objInteract('Найти планшет командира колонны у МТ-ЛБ', () => tablet)], null, () => ctx.radio('Планшет у нас. Координаты РЛС «Глаз Севера» — это их радар на побережье. Отличная работа.', 'Штаб'));
      ctx.onUpdate(() => {
        if (!vehs.length) return;
        const alert = convoy.members.some((m) => m.alive && m.brain && m.brain.state === 'combat') || vehs.some((v) => v.hp < v.type.hp);
        if (alert) for (const v of vehs) if (v.ai) v.ai.alerted = true;
        for (const v of vehs) if (v.alive && v.ai && !v.ai.alerted && v.pos.x > 950) ctx.fail('Колонна «Дентера» прошла перевал.');
      });
      ctx.radio('Кей, перевал под снегопадом, видимость 300–400 м. Ветер восточный 7 м/с. Занимайте гребень.', 'Штаб', 1);
    },
  },
  // ================================================================ 3
  {
    id: 'm3', title: 'Глаз Севера', code: 'Операция «Слепота»',
    brief: 'РЛС «Дентера» на сопке контролирует подходы к побережью. Два снайпера-наблюдателя на вышках, пулемёт, до 14 бойцов. Подход — открытая тундра около 900 м.\n\nЗадача: снять наблюдателей с дальней дистанции, уничтожить антенну РЛС (РПГ, ВОГ или гранаты) и зачистить пост. Ожидается контратака с севера на технике. Полярные сумерки, сильный западный ветер 9 м/с — учитывайте снос!',
    env: { time: 'dusk', sunElev: -2, sunAz: 175, overcast: 0.15, snow: 0.08, tempC: -30, windFrom: 270, wind: 9, visibility: 700, fog: 0.0011 },
    terrain: { seed: 37, amp: 18, features: [
      { type: 'hill', x: 0, z: -330, r: 300, h: 70 },
      { type: 'flat', x: 0, z: -330, r: 58, fall: 28 },
      { type: 'road', pts: [[0, -1150], [30, -800], [10, -560], [0, -390]], w: 7, fall: 6 },
      { type: 'hill', x: 380, z: 260, r: 170, h: 20 }, { type: 'hill', x: -400, z: 300, r: 190, h: 22 },
      { type: 'flat', x: -140, z: 220, r: 16, fall: 12 }, { type: 'flat', x: 170, z: 90, r: 14, fall: 12 },
    ] },
    start: { x: 0, z: 660, yaw: 0 }, navCenter: { x: 0, z: 0 }, navSize: 1000,
    build(ctx) {
      const { S } = ctx;
      const c = { x: 0, z: -330 };
      S.dome({ x: -14, z: -338, r: 6 });
      const yb = ctx.ground(14, -330);
      S.box({ x: 14, z: -330, w: 5, d: 5, h: 3, material: 'concrete', mat: 'concrete' });
      const radar = S.radarDish({ x: 14, z: -330, y: yb + 3, id: 'radar' });
      S.building({ x: 2, z: -362, w: 12, d: 6, h: 2.8, material: 'wood', doors: [{ side: 's', at: 2 }], windows: 2, roof: 'gable', interior: 'barracks' });
      S.bunker({ x: -28, z: -305, yaw: 0.3 });
      const t1 = S.tower({ x: -38, z: -290, h: 6 }), t2 = S.tower({ x: 38, z: -293, h: 6 });
      S.sandbags({ x: 0, z: -282, yaw: 0, len: 5, curve: 0.7 });
      S.sandbags({ x: 22, z: -300, yaw: -0.5, len: 3 }); S.sandbags({ x: -18, z: -280, yaw: 0.4, len: 3 });
      S.antenna({ x: 30, z: -350, h: 26 });
      S.crates({ x: 10, z: -345, n: 4 }); S.barrels({ x: -20, z: -352, n: 4 });
      S.fence({ pts: [[-55, -275], [-6, -275]] }); S.fence({ pts: [[6, -275], [55, -275], [55, -385], [-55, -385], [-55, -275]] });
      for (let i = 0; i < 6; i++) S.berm({ x: rand(-260, 260), z: rand(-120, 450), yaw: rand(0, 3), len: rand(5, 9), h: 1 });
      ctx.scatter({ x: 0, z: 200, r: 650, rocks: 140, trees: 20, avoid: [c] });
      ctx.scatter({ x: 0, z: -400, r: 900, rocks: 60, trees: 40, avoid: [{ ...c, r: 90 }], road: true });
      ctx.poi.pipeline({ pts: [[-650, 360], [-200, 330], [-14, 338]] }); ctx.poi.pipeline({ pts: [[14, 339], [250, 345], [650, 300]] });
      ctx.poi.ruin({ x: -140, z: 220, yaw: 0.2 }); ctx.poi.ruin({ x: 170, z: 90, yaw: -0.4, seed: 7, w: 10, d: 8 });
      ctx.poi.truckWreck({ x: 60, z: 470, yaw: 0.8 });
      ctx.poi.chum({ x: -320, z: 520, seed: 3 });
      ctx.poi.powerLine({ pts: [[12, -470], [30, -800], [0, -1100]] });
      ctx.forest({ x: -380, z: 120, r: 130, trees: 26, seed: 12 }); ctx.forest({ x: 400, z: 520, r: 110, trees: 20, seed: 13 });
      const g = ctx.group('post');
      const s1 = ctx.enemy({ x: -38, z: -290, y: t1.top, yaw: 0.2 + PI, weapon: 'svd', role: 'sniper', static: true, group: g, skill: { aim: 0.72, reaction: 0.6 } });
      const s2 = ctx.enemy({ x: 38, z: -293, y: t2.top, yaw: PI - 0.2, weapon: 'svd', role: 'sniper', static: true, group: g, skill: { aim: 0.72, reaction: 0.6 } });
      ctx.enemy({ x: 0, z: -284.5, yaw: PI, weapon: 'pkm', role: 'mg', mode: 'guard', group: g });
      ctx.enemy({ x: -9, z: -272, yaw: PI, mode: 'guard', group: g, weapon: 'akm' });
      ctx.enemy({ x: 9, z: -272, yaw: PI, mode: 'guard', group: g, weapon: 'ak74m' });
      ctx.enemy({ x: 22, z: -303, yaw: PI - 0.5, mode: 'guard', group: g, weapon: 'akm' });
      ctx.enemy({ x: -18, z: -283, yaw: PI + 0.4, mode: 'guard', group: g, weapon: 'ak74m', secondary: 'rpg7', role: 'at' });
      ctx.enemy({ x: -28, z: -307, yaw: PI, mode: 'guard', group: g, weapon: 'akm' });
      ctx.enemy({ x: 2, z: -362, yaw: 0, mode: 'guard', group: g, weapon: 'akm' });
      ctx.enemy({ x: 12, z: -342, yaw: 1, mode: 'guard', group: g, weapon: 'ak74m', role: 'leader' });
      const route = [{ x: -65, z: -265 }, { x: 65, z: -265 }, { x: 65, z: -395 }, { x: -65, z: -395 }];
      ctx.enemy({ x: -65, z: -265, mode: 'patrol', route, group: g, weapon: 'akm' });
      ctx.enemy({ x: -62, z: -268, mode: 'patrol', route, group: g, weapon: 'ak74m' });
      const counter = ctx.group('counter');
      ctx.stage([ctx.objCustom('Ликвидировать снайперов-наблюдателей на вышках (2)', () => !s1.alive && !s2.alive, () => (s1.alive ? s1.pos : s2.alive ? s2.pos : null))],
        () => ctx.radio('Вышки на западном и восточном краю поста. Дальность от вас около 900 м — подойдите на 400–600 и работайте с упора. Снос ветром большой!', 'Штаб'));
      ctx.stage([ctx.objDestroy('Уничтожить антенну РЛС', [radar]), ctx.objEliminate('Зачистить пост РЛС', [g], 0.8)]);
      ctx.stage([ctx.objEliminate('Отразить контратаку с севера', [counter], 0.85)], () => {
        ctx.radio('Внимание! С севера по дороге идут МТ-ЛБ и «Нива» с десантом. Занимайте оборону на посту!', 'Штаб');
        const route2 = [{ x: 30, z: -800 }, { x: 10, z: -560 }, { x: 0, z: -430 }];
        const mt = ctx.vehicle('mtlb', { x: 0, z: -1100, yaw: PI, team: 'denter', ai: { route: route2, speed: 8 }, crew: [{}, {}, { role: 'mg', weapon: 'pkm' }, {}, { secondary: 'rpg7', role: 'at' }, {}, {}], group: counter });
        ctx.vehicle('niva', { x: 10, z: -1140, yaw: PI, team: 'denter', ai: { route: route2, speed: 8, leader: mt }, crew: [{}, { weapon: 'akm' }, { weapon: 'akm' }], group: counter });
        ctx.onUpdate(() => { for (const v of ctx.mission.vehicles) if (v.ai && v.ai.done) v.ai.alerted = true; });
      });
      ctx.radio('Кей, РЛС на сопке в 950 м. Сумерки, ветер западный 9 м/с, −30. Снайперы на вышках — первоочерёдные цели.', 'Штаб', 1);
    },
  },
  // ================================================================ 4
  {
    id: 'm4', title: 'Ледяной порт', code: 'Операция «Полярная ночь»',
    brief: 'Ослепив РЛС, мы открыли подход к порту Ледяной. Здесь топливный склад «Дентера» и штаб логистики. Полярная ночь, северное сияние, освещены только причалы.\n\nЗадача: проникнуть в порт, уничтожить три топливные цистерны, забрать документы логиста в здании управления порта и уйти к точке сбора. После тревоги ждите подкрепление с востока.',
    env: { time: 'night', sunElev: -20, sunAz: 0, overcast: 0.1, snow: 0.25, tempC: -33, windFrom: 315, wind: 5, visibility: 280, fog: 0.0026, aurora: 1 },
    terrain: { seed: 51, amp: 14, features: [
      { type: 'coast', nx: 0, nz: -1, d: 335, depth: 8 },
      { type: 'flat', x: 20, z: -240, r: 170, fall: 60, h: 3 },
      { type: 'hill', x: -300, z: 300, r: 220, h: 24 }, { type: 'hill', x: 350, z: 350, r: 200, h: 20 },
      { type: 'road', pts: [[1100, -150], [500, -170], [150, -200]], w: 8, fall: 6 },
      { type: 'flat', x: -330, z: 330, r: 60, fall: 35 },
    ] },
    start: { x: -150, z: 600, yaw: 0.3 }, navCenter: { x: 0, z: 0 }, navSize: 1000,
    build(ctx) {
      const { S } = ctx;
      S.pier({ x: -60, z: -350, len: 130, w: 12, top: 3 });
      S.ship({ x: -70, z: -372, len: 62, w: 11 });
      S.building({ x: -90, z: -255, w: 26, d: 14, h: 6, material: 'concrete', doors: [{ side: 's', at: -6, width: 4 }, { side: 'e', at: 0 }], windows: 3, roof: 'flat', interior: 'warehouse' });
      S.building({ x: -15, z: -200, w: 12, d: 8, h: 3.2, material: 'concrete', doors: [{ side: 's', at: 2 }], windows: 2, roof: 'flat', interior: 'office' });
      S.building({ x: 65, z: -190, w: 11, d: 6, h: 2.8, material: 'wood', doors: [{ side: 'w', at: 0 }], windows: 2, roof: 'gable', interior: 'barracks' });
      const cols = ['red', 'blue', 'green'];
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) S.container({ x: 30 + i * 9, z: -265 - j * 4, yaw: PI / 2, color: cols[(i + j) % 3], stack: (i + j) % 3 === 0 ? 2 : 1 });
      const tanks = [S.fuelTank({ x: 150, z: -262, r: 5, h: 8, id: 'tank1' }), S.fuelTank({ x: 166, z: -238, r: 5, h: 8, id: 'tank2' }), S.fuelTank({ x: 182, z: -268, r: 5, h: 8, id: 'tank3' })];
      S.sandbags({ x: 135, z: -225, yaw: 0.3, len: 6, h: 1.1 }); S.sandbags({ x: 195, z: -225, yaw: -0.3, len: 6, h: 1.1 });
      S.crates({ x: -40, z: -230, n: 5 }); S.crates({ x: 100, z: -300, n: 4 }); S.barrels({ x: 120, z: -280, n: 6 }); S.barrels({ x: -50, z: -320, n: 5 });
      S.crane({ x: 0, z: -330 });
      for (const [x, z, l] of [[-40, -320, true], [40, -320, true], [-15, -215, true], [160, -215, true], [100, -230, false], [-90, -235, false]]) S.lamp({ x, z, light: l });
      S.fence({ pts: [[-140, -160], [-10, -160]] }); S.fence({ pts: [[10, -160], [230, -160], [230, -320]] });
      S.sign({ x: 14, z: -155, text: 'ПОРТ «ЛЕДЯНОЙ»', sub: 'Въезд по пропускам' });
      ctx.scatter({ x: -100, z: 250, r: 600, rocks: 100, trees: 60, avoid: [{ x: 20, z: -240, r: 190 }] });
      ctx.poi.village({ x: -330, z: 330, yaw: -0.2, n: 6, seed: 41, name: 'пос. Ледяной' });
      ctx.poi.powerLine({ pts: [[-330, 310], [-150, 100], [-70, -150]] });
      ctx.poi.hummocks({ x0: -900, x1: 900, z: -365, n: 160 });
      ctx.poi.truckWreck({ x: 118, z: -172, yaw: 0.1 });
      ctx.poi.pipeline({ pts: [[200, -236], [400, -206], [700, -214]] });
      ctx.forest({ x: 150, z: 300, r: 140, trees: 28, seed: 14 }); ctx.forest({ x: -520, z: 120, r: 120, trees: 24, seed: 15 });
      const g = ctx.group('port');
      ctx.enemy({ x: -6, z: -156, yaw: PI, mode: 'guard', group: g, weapon: 'akm' });
      ctx.enemy({ x: 6, z: -156, yaw: PI, mode: 'guard', group: g, weapon: 'ak74m' });
      ctx.enemy({ x: -17, z: -202, yaw: PI, mode: 'guard', group: g, weapon: 'ak74m', role: 'leader' });
      ctx.enemy({ x: -12, z: -197, yaw: 0, mode: 'guard', group: g, weapon: 'akm' });
      ctx.enemy({ x: 140, z: -228, yaw: PI, mode: 'guard', group: g, weapon: 'pkm', role: 'mg' });
      ctx.enemy({ x: 190, z: -228, yaw: PI, mode: 'guard', group: g, weapon: 'akm' });
      ctx.enemy({ x: 165, z: -285, yaw: 0, mode: 'guard', group: g, weapon: 'akm' });
      ctx.enemy({ x: 48, z: -262, y: ctx.ground(48, -262) + 5.1, yaw: PI, static: true, group: g, weapon: 'svd', role: 'sniper' });
      ctx.enemy({ x: -80, z: -260, yaw: PI, mode: 'guard', group: g, weapon: 'akm' });
      ctx.enemy({ x: -60, z: -345, yaw: PI, mode: 'guard', group: g, weapon: 'ak74m' });
      ctx.enemy({ x: 64, z: -190, yaw: 1.2, mode: 'guard', group: g, weapon: 'akm' });
      const r1 = [{ x: -130, z: -170 }, { x: 220, z: -170 }, { x: 220, z: -310 }, { x: 100, z: -320 }];
      const r2 = [{ x: -120, z: -300 }, { x: 20, z: -300 }, { x: 20, z: -220 }, { x: -120, z: -220 }];
      ctx.enemy({ x: -130, z: -170, mode: 'patrol', route: r1, group: g, weapon: 'akm' });
      ctx.enemy({ x: -127, z: -172, mode: 'patrol', route: r1, group: g, weapon: 'ak74m', secondary: 'rpg7', role: 'at' });
      ctx.enemy({ x: -120, z: -300, mode: 'patrol', route: r2, group: g, weapon: 'akm' });
      ctx.enemy({ x: -118, z: -297, mode: 'patrol', route: r2, group: g, weapon: 'akm' });
      const docs = ctx.item({ x: -18, z: -203, label: 'Забрать документы логиста', hold: 3 });
      const reinf = ctx.group('reinf');
      ctx.stage([ctx.objReach('Проникнуть на территорию порта', 0, -220, 130)]);
      ctx.stage([ctx.objDestroy('Уничтожить топливные цистерны (3)', tanks), ctx.objInteract('Забрать документы логиста (здание управления порта)', docs)], null,
        () => ctx.radio('В документах — «Объект-17», старая база на мысе. Там Кранди! Уходите к точке сбора, к вам идёт подкрепление противника.', 'Штаб'));
      ctx.stage([ctx.objReach('Отойти к точке сбора', -400, 520, 40)], () => {
        const route = [{ x: 500, z: -170 }, { x: 150, z: -200 }, { x: 0, z: -150 }];
        const n = ctx.vehicle('niva', { x: 1000, z: -152, yaw: PI / 2, team: 'denter', ai: { route, speed: 10 }, crew: [{}, { weapon: 'akm' }, { weapon: 'akm' }], group: reinf });
        const mtr = ctx.vehicle('mtlb', { x: 1040, z: -150, yaw: PI / 2, team: 'denter', ai: { route, speed: 10, leader: n }, crew: [{}, {}, {}, { role: 'mg', weapon: 'pkm' }, {}, {}], group: reinf });
        // с колонной — Т-80БВ «Дентера»
        ctx.vehicle('t80bv', { x: 1090, z: -150, yaw: PI / 2, team: 'denter', ai: { route, speed: 8, leader: mtr } });
        ctx.radio('С колонной идёт танк Т-80БВ! В лоб его не взять — уходите к точке сбора, бейте только в борт или корму.', 'Штаб', 4);
        ctx.onUpdate(() => { for (const v of ctx.mission.vehicles) if (v.ai && v.ai.done) v.ai.alerted = true; });
      });
      g.onAlert = () => ctx.radio('Тревога в порту! Работайте быстро.', 'Штаб', 0.5);
      ctx.radio('Кей, полярная ночь, видимость ~250 м, на причалах свет. Цистерны на восточной стороне порта. −33, ветер северо-западный 5 м/с.', 'Штаб', 1);
    },
  },
  // ================================================================ 5
  {
    id: 'm5', title: 'Объект-17', code: 'Операция «Последний рубеж»',
    brief: 'Лойд Кранди скрывается на «Объекте-17» — бывшей военной базе на мысе. Периметр, три вышки, бункеры, у ворот — трофейный МТ-ЛБ, в центре базы — танк Т-80БВ. В командном бункере — Кранди с личной охраной в тяжёлой броне. У северного причала его ждёт катер.\n\nЗадача: прорвать периметр, ликвидировать Лойда Кранди до того, как он уйдёт к причалу, зачистить объект. Это последняя операция.',
    env: { time: 'day', sunElev: 3, sunAz: 165, overcast: 0.1, snow: 0.06, tempC: -36, windFrom: 180, wind: 6, visibility: 800, fog: 0.0008 },
    terrain: { seed: 77, amp: 16, features: [
      { type: 'coast', nx: 0, nz: -1, d: 520, depth: 8 },
      { type: 'flat', x: 0, z: -260, r: 185, fall: 60 },
      { type: 'hill', x: -380, z: 250, r: 200, h: 26 }, { type: 'hill', x: 360, z: 200, r: 190, h: 22 },
      { type: 'road', pts: [[0, 900], [40, 500], [0, 150], [0, -100]], w: 8, fall: 7 },
      { type: 'flat', x: -230, z: 20, r: 16, fall: 12 }, { type: 'flat', x: 210, z: -40, r: 16, fall: 12 },
    ] },
    start: { x: 30, z: 640, yaw: 0 }, navCenter: { x: 0, z: 0 }, navSize: 1000,
    build(ctx) {
      const { S } = ctx;
      S.fence({ pts: [[-150, -100], [-9, -100]] }); S.fence({ pts: [[9, -100], [150, -100], [150, -420], [8, -420]] }); S.fence({ pts: [[-8, -420], [-150, -420], [-150, -100]] });
      const towers = [S.tower({ x: -140, z: -110, h: 6 }), S.tower({ x: 140, z: -110, h: 6 }), S.tower({ x: 140, z: -410, h: 6 })];
      S.bunker({ x: -60, z: -160, yaw: 0 }); S.bunker({ x: 60, z: -170, yaw: 0 });
      S.building({ x: -90, z: -260, w: 14, d: 7, h: 3, material: 'wood', roof: 'gable', interior: 'barracks', doors: [{ side: 'e', at: 0 }] });
      S.building({ x: -90, z: -300, w: 14, d: 7, h: 3, material: 'wood', roof: 'gable', interior: 'barracks', doors: [{ side: 'e', at: 0 }] });
      S.building({ x: 90, z: -280, w: 14, d: 7, h: 3, material: 'wood', roof: 'gable', interior: 'barracks', doors: [{ side: 'w', at: 0 }] });
      S.building({ x: 0, z: -335, w: 16, d: 11, h: 3.4, material: 'concrete', doors: [{ side: 's', at: 0, width: 2.2 }, { side: 'n', at: 4 }], windows: 2, roof: 'flat', interior: 'office' });
      for (const [x, z, yaw] of [[-20, -140, 0], [20, -140, 0], [0, -220, 0], [-40, -300, 1.2], [40, -310, -1.2], [0, -385, 0]]) S.sandbags({ x, z, yaw, len: 4, curve: 0.5 });
      S.container({ x: 45, z: -230, yaw: 0.2, color: 'green' }); S.container({ x: -45, z: -225, yaw: -0.1, color: 'red', stack: 2 });
      S.crates({ x: 30, z: -360, n: 5 }); S.crates({ x: -30, z: -200, n: 4 }); S.barrels({ x: 70, z: -360, n: 5 });
      S.antenna({ x: 20, z: -350, h: 24 });
      S.pier({ x: 0, z: -530, len: 14, w: 40, yaw: PI / 2, top: 1.6 });
      S.sign({ x: 14, z: -96, text: 'ОБЪЕКТ-17', sub: 'Запретная зона' });
      ctx.scatter({ x: 0, z: 300, r: 600, rocks: 110, trees: 50, avoid: [{ x: 0, z: -260, r: 200 }], road: true });
      ctx.poi.pipeline({ pts: [[-600, 60], [-14, 78]] }); ctx.poi.pipeline({ pts: [[14, 78], [600, 40]] });
      ctx.poi.ruin({ x: -230, z: 20, yaw: 0.5 }); ctx.poi.ruin({ x: 210, z: -40, yaw: -0.3, seed: 9 });
      ctx.poi.truckWreck({ x: 70, z: 260, yaw: 1.4 }); ctx.poi.truckWreck({ x: -40, z: 150, yaw: -0.4 });
      ctx.poi.powerLine({ pts: [[60, 600], [70, 300], [26, 0], [16, -95]] });
      ctx.poi.hummocks({ x0: -900, x1: 900, z: -548, n: 160 });
      ctx.forest({ x: -350, z: 320, r: 140, trees: 28, seed: 16 }); ctx.forest({ x: 380, z: 260, r: 120, trees: 24, seed: 17 });
      const g = ctx.group('base');
      const gate = ctx.vehicle('mtlb', { x: 0, z: -122, yaw: PI, team: 'denter', crew: [{}, { weapon: 'akm' }], group: g, parked: true });
      // Т-80БВ в окопе посреди базы: держит южный сектор
      ctx.vehicle('t80bv', { x: -24, z: -262, yaw: PI, team: 'denter', tankAI: { hold: true, skill: 0.65 } });
      towers.forEach((t, i) => ctx.enemy({ x: [-140, 140, 140][i], z: [-110, -110, -410][i], y: t.top, yaw: PI * (i === 2 ? 0.5 : 1), static: true, group: g, weapon: i === 0 ? 'svd' : 'pkm', role: i === 0 ? 'sniper' : 'mg' }));
      const pos = [[-20, -142, PI, 'pkm', 'mg'], [20, -142, PI, 'akm'], [0, -222, PI, 'ak74m'], [-60, -163, PI, 'akm'], [60, -173, PI, 'ak74m', 'at'], [-42, -302, PI, 'akm'], [42, -312, PI, 'akm'], [-90, -262, 1, 'akm'], [-90, -302, 1, 'ak74m'], [90, -282, -1, 'akm'], [-45, -228, PI, 'akm'], [45, -233, PI, 'ak74m'], [0, -388, 0, 'pkm', 'mg']];
      for (const [x, z, yaw, w, role] of pos) ctx.enemy({ x, z, yaw, mode: 'guard', group: g, weapon: w, role: role || 'rifleman', secondary: role === 'at' ? 'rpg7' : undefined, skill: { aim: 0.6, reaction: 0.6, nerve: 0.65 } });
      const pr = [{ x: -160, z: -95 }, { x: 160, z: -95 }, { x: 160, z: -425 }, { x: -160, z: -425 }];
      ctx.enemy({ x: -160, z: -95, mode: 'patrol', route: pr, group: g, weapon: 'akm' });
      ctx.enemy({ x: -157, z: -97, mode: 'patrol', route: pr, group: g, weapon: 'ak74m' });
      const hq = ctx.group('krandi');
      const krandi = ctx.enemy({ x: 0, z: -338, yaw: PI, mode: 'hvt', group: hq, weapon: 'ak74m', faction: 'krandi', role: 'hvt', name: 'Лойд Кранди', health: 220, armor: 0.85, helmet: 0, skill: { aim: 0.78, reaction: 0.7, nerve: 0.9 }, scale: 1.04 });
      const guards = [[-4, -333], [4, -333], [-3, -342], [3, -343]].map(([x, z]) => ctx.enemy({ x, z, yaw: PI, mode: 'guard', group: hq, weapon: 'ak74m', armor: 0.8, health: 130, skill: { aim: 0.75, reaction: 0.75, nerve: 0.85 }, grenades: 2 }));
      const escape = { x: 0, z: -515 };
      let fleeing = false;
      ctx.stage([ctx.objDestroy('Уничтожить МТ-ЛБ у ворот', [gate]), ctx.objReach('Прорвать периметр через южные ворота', 0, -150, 55)],
        () => ctx.radio('Кей, у ворот МТ-ЛБ с ПКТ — гранатомётчик вперёд. Кранди в командном бункере в центре.', 'Штаб'));
      ctx.stage([ctx.objKill('Ликвидировать Лойда Кранди', krandi)], () => {
        ctx.radio('Кранди уходит к северному причалу! Не дайте ему сесть в катер!', 'Штаб', 6);
        ctx.after(7, () => { fleeing = true; });
      }, () => ctx.radio('Кранди ликвидирован! Повторяю: цель ликвидирована. Добейте остатки охраны.', 'Штаб'));
      ctx.stage([ctx.objEliminate('Зачистить «Объект-17»', [g, hq], 0.75)]);
      let t = 0;
      ctx.onUpdate((dt) => {
        t += dt;
        if (!fleeing && krandi.alive && ctx.anyPlayerNear(krandi.pos, 90)) fleeing = true;
        if (fleeing && krandi.alive) {
          krandi.brain.forced = { x: escape.x, z: escape.z, speed: 2.8 };
          guards.forEach((gd, i) => { if (gd.alive && gd.brain) gd.brain.forced = { x: krandi.pos.x + (i - 1.5) * 2.5, z: krandi.pos.z + 3, speed: 3.2 }; });
          if (Math.hypot(krandi.pos.x - escape.x, krandi.pos.z - escape.z) < 9) ctx.fail('Лойд Кранди ушёл на катере.');
        }
      });
      ctx.radio('Кей, это финал. «Объект-17» в 750 м к северу. −36, ветер южный 6 м/с — в спину. Кранди нужен любой ценой.', 'Штаб', 1);
      ctx.radio('В центре базы Т-80БВ, держит южный сектор. Обходите с флангов, гранатомёт — в борт, или ПТРК.', 'Штаб', 9);
    },
  },
];

export function missionById(id) { return MISSIONS.find((m) => m.id === id); }
