// Боеприпасы, оружие и прицелы
import { prepareAmmo } from '../physics/ballistics.js';

export const AMMO = {
  '545_7n10': {
    id: '545_7n10', name: '5,45×39 7Н10 (повышенной пробиваемости)', short: '7Н10', cls: 'std', kind: 'bullet', model: 'G7', bc: 0.168,
    mass: 0.0036, caliber: 0.00545, v0: 900, spin: { sg: 1.6, dir: 1 }, pen: 7, dmgK: 1.0,
  },
  '762x39_ps': {
    id: '762x39_ps', name: '7,62×39 ПС 57-Н-231', short: 'ПС', cls: 'std', kind: 'bullet', model: 'G7', bc: 0.143,
    mass: 0.0079, caliber: 0.00762, v0: 715, spin: { sg: 1.5, dir: 1 }, pen: 6, dmgK: 1.1,
  },
  '762x54_7n1': {
    id: '762x54_7n1', name: '7,62×54R 7Н1 (снайперский)', short: '7Н1', cls: 'sniper', kind: 'bullet', model: 'G7', bc: 0.205,
    mass: 0.0098, caliber: 0.00762, v0: 830, spin: { sg: 1.7, dir: 1 }, pen: 10, dmgK: 1.15,
  },
  '762x54_lps': {
    id: '762x54_lps', name: '7,62×54R ЛПС', short: 'ЛПС', cls: 'std', kind: 'bullet', model: 'G7', bc: 0.187,
    mass: 0.0096, caliber: 0.00762, v0: 825, spin: { sg: 1.6, dir: 1 }, pen: 11, dmgK: 1.15, tracerEvery: 4,
  },
  // Специальные патроны для снаряжения магазинов
  '545_7t3': {
    id: '545_7t3', name: '5,45×39 7Т3М (трассирующий)', short: '7Т3М', cls: 'tracer', kind: 'bullet', model: 'G7', bc: 0.15,
    mass: 0.00323, caliber: 0.00545, v0: 880, spin: { sg: 1.5, dir: 1 }, pen: 4, dmgK: 0.95, tracer: true, tracerColor: [1, 0.25, 0.12],
  },
  '545_7n24': {
    id: '545_7n24', name: '5,45×39 7Н24 (бронебойный)', short: '7Н24', cls: 'ap', kind: 'bullet', model: 'G7', bc: 0.18,
    mass: 0.0041, caliber: 0.00545, v0: 840, spin: { sg: 1.7, dir: 1 }, pen: 14, dmgK: 0.95,
  },
  '762x39_t45': {
    id: '762x39_t45', name: '7,62×39 Т-45М (трассирующий)', short: 'Т-45', cls: 'tracer', kind: 'bullet', model: 'G7', bc: 0.13,
    mass: 0.0075, caliber: 0.00762, v0: 715, spin: { sg: 1.4, dir: 1 }, pen: 4, dmgK: 1.05, tracer: true, tracerColor: [1, 0.3, 0.1],
  },
  '762x39_bp': {
    id: '762x39_bp', name: '7,62×39 БП 7Н23 (бронебойный)', short: 'БП', cls: 'ap', kind: 'bullet', model: 'G7', bc: 0.15,
    mass: 0.0079, caliber: 0.00762, v0: 740, spin: { sg: 1.6, dir: 1 }, pen: 13, dmgK: 1.05,
  },
  '762x54_t46': {
    id: '762x54_t46', name: '7,62×54R Т-46 (трассирующий)', short: 'Т-46', cls: 'tracer', kind: 'bullet', model: 'G7', bc: 0.18,
    mass: 0.0096, caliber: 0.00762, v0: 800, spin: { sg: 1.6, dir: 1 }, pen: 7, dmgK: 1.1, tracer: true, tracerColor: [1, 0.22, 0.1],
  },
  '762x54_b32': {
    id: '762x54_b32', name: '7,62×54R Б-32 (бронебойно-зажигательный)', short: 'Б-32', cls: 'ap', kind: 'bullet', model: 'G7', bc: 0.2,
    mass: 0.01, caliber: 0.00762, v0: 810, spin: { sg: 1.7, dir: 1 }, pen: 16, dmgK: 1.15,
  },
  // 14,5×114 для ПТРД-41
  'ptrd_b32': {
    id: 'ptrd_b32', name: '14,5×114 Б-32 (бронебойно-зажигательный)', short: 'Б-32', cls: 'ap', kind: 'bullet', model: 'G7', bc: 0.45,
    mass: 0.064, caliber: 0.0145, v0: 1000, spin: { sg: 1.8, dir: 1 }, pen: 38, dmgK: 1.0,
  },
  'ptrd_mdz': {
    id: 'ptrd_mdz', name: '14,5×114 МДЗ (мгновенного действия, фугасно-зажигательный)', short: 'МДЗ', cls: 'he', kind: 'bullet', model: 'G7', bc: 0.4,
    mass: 0.0596, caliber: 0.0145, v0: 1005, spin: { sg: 1.7, dir: 1 }, pen: 8, dmgK: 1.0,
    explosive: { pen: 8, radius: 1.6, frag: 4, dmg: 170, fxSize: 0.6 },
  },
  'pg7vm': {
    id: 'pg7vm', name: 'ПГ-7ВМ (кумулятивная)', kind: 'rocket', model: 'const', cd: 0.24,
    mass: 2.0, caliber: 0.07, v0: 140,
    motor: { ignite: 0.08, burn: 0.42, thrust: 860, vane: 0.42 },
    fuse: 4.6, armDist: 2.5,
    explosive: { pen: 300, radius: 3.5, frag: 10, dmg: 180 },
  },
  'vog25': {
    id: 'vog25', name: 'ВОГ-25 (осколочная)', kind: 'grenade', model: 'const', cd: 0.32,
    mass: 0.25, caliber: 0.04, v0: 76, armDist: 10,
    explosive: { pen: 0, radius: 3.8, frag: 10, dmg: 200 },
  },
  'f1': {
    id: 'f1', name: 'Ф-1 (ручная)', kind: 'hand', model: 'const', cd: 0.5,
    mass: 0.6, caliber: 0.055, v0: 17,
    explosive: { pen: 0, radius: 5, frag: 22, dmg: 220 },
  },
  'rgd5': {
    id: 'rgd5', name: 'РГД-5 (ручная)', kind: 'hand', model: 'const', cd: 0.5,
    mass: 0.31, caliber: 0.058, v0: 20,
    explosive: { pen: 0, radius: 4, frag: 15, dmg: 190 },
  },
};
Object.values(AMMO).forEach(prepareAmmo);

// Прицелы с оптикой. fov — истинное поле зрения (град.)
export const SCOPES = {
  pso1: {
    id: 'pso1', name: 'ПСО-1', mag: 4, fov: 6, reticle: 'pso1',
    drum: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000], extra: [1100, 1200, 1300],
    rangefinder: { H: 1.7, from: 200, to: 1000 },
  },
  '1p78': {
    id: '1p78', name: '1П78 «Кашта́н»', mag: 2.8, fov: 13, reticle: 'bdc',
    zero: 100, marks: [100, 200, 300, 400], rangefinder: { H: 1.7, from: 100, to: 400 },
  },
  pgo7: {
    id: 'pgo7', name: 'ПГО-7', mag: 2.7, fov: 13, reticle: 'pgo7',
    zero: 200, marks: [200, 300, 400, 500], rangefinder: { H: 2.7, from: 200, to: 700 },
  },
  pp61: {
    id: 'pp61', name: 'ПП-61АМ', mag: 2.6, fov: 23, reticle: 'pp61',
    zero: 200, marks: [200, 400, 600, 800, 1000],
  },
  b8: { id: 'b8', name: 'Бинокль Б-8', mag: 8, fov: 7.5, reticle: 'binocular' },
};

const RIFLE_IRON = (pZero, max, h = 0.062) => {
  const s = [{ label: 'П', range: pZero }];
  for (let i = 1; i <= max; i++) s.push({ label: String(i), range: i * 100 });
  return { type: 'iron', h, settings: s, radius: 0.379 };
};

export const WEAPONS = {
  ak74m: {
    id: 'ak74m', name: 'АК-74М', cls: 'Автомат', ammo: '545_7n10', mag: 30, mags: 8,
    rpm: 650, modes: ['auto', 'single'],
    sight: RIFLE_IRON(400, 10), recoil: { up: 3.6, side: 1.6, cam: 0.5 }, sway: 1.0, disp: 0.35,
    reload: 2.4, reloadEmpty: 3.0, weight: 3.4, vm: 'ak74', sound: 'r545',
    desc: 'Основное оружие отделения. Механический прицел: целик на прицельной планке (П, 1–10) и мушка.',
  },
  ak74m_gp: {
    id: 'ak74m_gp', name: 'АК-74М + ГП-25', cls: 'Автомат с подствольником', ammo: '545_7n10', mag: 30, mags: 7,
    rpm: 650, modes: ['auto', 'single'], ugl: 'gp25',
    sight: RIFLE_IRON(400, 10), recoil: { up: 3.2, side: 1.4, cam: 0.45 }, sway: 1.2, disp: 0.35,
    reload: 2.5, reloadEmpty: 3.1, weight: 4.9, vm: 'ak74gp', sound: 'r545',
    desc: 'Автомат с 40-мм подствольным гранатомётом ГП-25 (переключение — X). Квадрантный прицел 50–400 м.',
  },
  ak74m_1p78: {
    id: 'ak74m_1p78', name: 'АК-74М + 1П78', cls: 'Автомат с оптикой', ammo: '545_7n10', mag: 30, mags: 8,
    rpm: 650, modes: ['auto', 'single'],
    sight: { type: 'scope', scope: '1p78', h: 0.085 }, recoil: { up: 3.6, side: 1.6, cam: 0.5 }, sway: 1.05, disp: 0.35,
    reload: 2.4, reloadEmpty: 3.0, weight: 3.9, vm: 'ak74scope', sound: 'r545',
    desc: 'Оптический прицел 1П78 (2,8×) с дальномерной шкалой и марками на 100–400 м.',
  },
  akm: {
    id: 'akm', name: 'АКМ', cls: 'Автомат', ammo: '762x39_ps', mag: 30, mags: 8,
    rpm: 600, modes: ['auto', 'single'],
    sight: RIFLE_IRON(300, 10, 0.06), recoil: { up: 5.6, side: 2.4, cam: 0.55 }, sway: 1.0, disp: 0.45,
    reload: 2.5, reloadEmpty: 3.1, weight: 3.6, vm: 'akm', sound: 'r762',
    desc: 'Калибр 7,62×39: тяжелее пуля, круче траектория, больше отдача.',
  },
  svd: {
    id: 'svd', name: 'СВД', cls: 'Снайперская винтовка', ammo: '762x54_7n1', mag: 10, mags: 6,
    rpm: 30, modes: ['single'],
    sight: { type: 'scope', scope: 'pso1', h: 0.082 }, recoil: { up: 11, side: 3, cam: 0.6 }, sway: 0.9, disp: 0.18,
    reload: 2.7, reloadEmpty: 3.3, weight: 4.5, vm: 'svd', sound: 'r762r',
    desc: 'Оптический прицел ПСО-1 (4×): маховичок прицела 1–10, доп. угольники на 1100–1300 м, дальномер на 1,7 м.',
  },
  pkm: {
    id: 'pkm', name: 'ПКМ', cls: 'Пулемёт', ammo: '762x54_lps', mag: 100, mags: 3,
    rpm: 650, modes: ['auto'],
    sight: { type: 'iron', h: 0.07, radius: 0.66, settings: Array.from({ length: 15 }, (_, i) => ({ label: String(i + 1), range: (i + 1) * 100 })) },
    recoil: { up: 4.2, side: 2.2, cam: 0.45 }, sway: 1.6, disp: 0.6,
    reload: 5.5, reloadEmpty: 6.0, weight: 7.5, vm: 'pkm', sound: 'r762r',
    desc: 'Единый пулемёт, лента 100 патронов с трассерами. Прицельная планка 1–15. Лёжа отдача и раскачка заметно меньше.',
  },
  rpg7: {
    id: 'rpg7', name: 'РПГ-7В', cls: 'Гранатомёт', ammo: 'pg7vm', mag: 1, mags: 3,
    rpm: 10, modes: ['single'],
    sight: { type: 'scope', scope: 'pgo7', h: 0.1 },
    altSight: { type: 'iron', h: 0.075, radius: 0.5, settings: [2, 3, 4, 5].map((i) => ({ label: String(i), range: i * 100 })) },
    recoil: { up: 6, side: 2, cam: 0.3 }, sway: 1.4, disp: 1.2,
    reload: 4.2, reloadEmpty: 4.2, weight: 6.3, vm: 'rpg7', sound: 'rpg',
    desc: 'Оптика ПГО-7 (2,7×) с марками 200–500 м; механический прицел (O) — целик 2–5 и мушка. Граната флюгирует: на активном участке уходит ПРОТИВ ветра.',
  },
  ptrd: {
    id: 'ptrd', name: 'ПТРД-41', cls: 'Противотанковое ружьё', ammo: 'ptrd_b32', mag: 1, mags: 19, pouch: true, heavy: true, bipod: true,
    rpm: 20, modes: ['single'],
    sight: { type: 'iron', h: 0.09, radius: 0.92, settings: [{ label: 'до 400', range: 400 }, { label: 'св. 400', range: 1000 }] },
    recoil: { up: 24, side: 5, cam: 0.75 }, sway: 3.0, disp: 0.3,
    reload: 2.6, reloadEmpty: 2.6, weight: 17.3, vm: 'ptrd', sound: 'ptrd',
    desc: 'Однозарядное противотанковое ружьё 14,5 мм (17,3 кг): с ним медленнее ходят и быстро устают. Лёжа — на сошках, точно; стоя — сильно водит. Б-32 пробивает ~35 мм брони на 100 м (броня МТ-ЛБ и «Тигра» — насквозь), МДЗ рвётся при попадании. По умолчанию патроны чередуются: Б-32, МДЗ. Прицел: «до 400» и «свыше 400 м».',
  },
  gp25: {
    id: 'gp25', name: 'ГП-25', cls: 'Подствольный гранатомёт', ammo: 'vog25', mag: 1, mags: 10,
    rpm: 10, modes: ['single'],
    sight: { type: 'iron', h: 0.1, radius: 0.12, quadrant: true, settings: [50, 100, 150, 200, 250, 300, 350, 400].map((r) => ({ label: String(r), range: r })) },
    recoil: { up: 14, side: 2, cam: 0.4 }, sway: 1.2, disp: 2.0,
    reload: 2.2, reloadEmpty: 2.2, weight: 1.5, vm: 'gp25', sound: 'gl',
    desc: 'Навесная траектория, V₀ = 76 м/с. Квадрантный прицел: устанавливается дальность, ствол поднимается на нужный угол.',
  },
  pkt: {
    id: 'pkt', name: 'ПКТ', cls: 'Танковый пулемёт', ammo: '762x54_lps', mag: 250, mags: 8,
    rpm: 700, modes: ['auto'], sight: { type: 'scope', scope: 'pp61', h: 0.2 },
    recoil: { up: 0.8, side: 0.6, cam: 0.1 }, sway: 0.15, disp: 0.5, reload: 6, reloadEmpty: 6,
    weight: 10, vm: null, sound: 'r762r', desc: 'Пулемёт в башенной установке МТ-ЛБ.',
  },
  pkp_mount: {
    id: 'pkp_mount', name: 'ПКП (на турели)', cls: 'Пулемёт', ammo: '762x54_lps', mag: 100, mags: 6,
    rpm: 650, modes: ['auto'],
    sight: { type: 'iron', h: 0.07, radius: 0.66, settings: Array.from({ length: 15 }, (_, i) => ({ label: String(i + 1), range: (i + 1) * 100 })) },
    recoil: { up: 1.4, side: 1.0, cam: 0.15 }, sway: 0.35, disp: 0.55, reload: 5, reloadEmpty: 5.5,
    weight: 8, vm: 'pkm', sound: 'r762r', desc: 'Пулемёт на турели бронеавтомобиля «Тигр».',
  },
};

export const HAND_GRENADES = {
  f1: { id: 'f1', name: 'Ф-1', ammo: 'f1', fuse: [3.2, 4.2] },
  rgd5: { id: 'rgd5', name: 'РГД-5', ammo: 'rgd5', fuse: [3.2, 4.2] },
};

export const PRIMARY_CHOICES = ['ak74m', 'ak74m_gp', 'ak74m_1p78', 'akm', 'svd', 'pkm'];

// Звуковые профили выстрелов
export const SOUNDS = {
  r545: { crack: 0.9, body: 0.55, freq: 1800, decay: 0.16, thump: 90 },
  r762: { crack: 0.8, body: 0.8, freq: 1300, decay: 0.2, thump: 75 },
  r762r: { crack: 1.0, body: 1.0, freq: 1100, decay: 0.26, thump: 65 },
  rpg: { crack: 0.3, body: 1.3, freq: 500, decay: 0.6, thump: 45 },
  gl: { crack: 0.1, body: 0.5, freq: 400, decay: 0.15, thump: 80 },
  ptrd: { crack: 1.5, body: 1.7, freq: 650, decay: 0.5, thump: 38 },
};

// Совместимые патроны (по калибру) для снаряжения
export const AMMO_FAMILY = {
  '545_7n10': ['545_7n10', '545_7t3', '545_7n24'],
  '762x39_ps': ['762x39_ps', '762x39_t45', '762x39_bp'],
  '762x54_7n1': ['762x54_7n1', '762x54_lps', '762x54_t46', '762x54_b32'],
  '762x54_lps': ['762x54_lps', '762x54_t46', '762x54_b32', '762x54_7n1'],
  'ptrd_b32': ['ptrd_b32', 'ptrd_mdz'],
};
// число патронов в схеме снаряжения: магазин или (для однозарядных — ПТРД) весь носимый запас
export function loadCount(weaponId) { const w = WEAPONS[weaponId]; return w.pouch ? w.mag * (1 + w.mags) : w.mag; }
export function ammoChoices(weaponId) { const w = WEAPONS[weaponId]; return AMMO_FAMILY[w.ammo] || [w.ammo]; }
export function defaultPattern(weaponId) {
  const w = WEAPONS[weaponId];
  const fam = ammoChoices(weaponId);
  if (w.id === 'pkm' || w.id === 'pkp_mount') return Array.from({ length: w.mag }, (_, i) => (i % 4 === 3 ? fam.find((a) => AMMO[a].tracer) : w.ammo));
  if (w.id === 'ptrd') return Array.from({ length: loadCount('ptrd') }, (_, i) => (i % 2 ? 'ptrd_mdz' : 'ptrd_b32'));
  return Array(w.mag).fill(w.ammo);
}
export const LOADABLE = ['ak74m', 'ak74m_gp', 'ak74m_1p78', 'akm', 'svd', 'pkm', 'ptrd'];
// тяжёлое оружие во втором слоте
export const HEAVY_CHOICES = [{ id: null, name: 'Нет' }, { id: 'rpg7', name: 'РПГ-7В' }, { id: 'ptrd', name: 'ПТРД-41' }];
