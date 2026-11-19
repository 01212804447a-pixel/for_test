// Сетевая игра: карты противостояния (PvP) на основе карт операций — без ИИ,
// с точками появления команд. Кооператив использует сами операции.
const PI = Math.PI;

export const PVP_MAPS = [
  { id: 'm1', title: 'Тихая станция', note: 'метеостанция и подступы, 400 м', spawns: { negs: { x: 10, z: 260, yaw: 0 }, denter: { x: -6, z: -168, yaw: PI } } },
  { id: 'm2', title: 'Белый перевал', note: 'гребень и блокпост в снегопад', spawns: { negs: { x: 0, z: 160, yaw: -1.2 }, denter: { x: 455, z: -30, yaw: 1.9 } } },
  { id: 'm3', title: 'Глаз Севера', note: 'пост РЛС, дальние дистанции, сильный ветер', spawns: { negs: { x: 0, z: 220, yaw: 0 }, denter: { x: 0, z: -300, yaw: PI } } },
  { id: 'm4', title: 'Ледяной порт', note: 'полярная ночь, склады и причалы', spawns: { negs: { x: -150, z: 240, yaw: 0.3 }, denter: { x: 60, z: -205, yaw: PI } } },
  { id: 'm5', title: 'Объект-17', note: 'штурм базы на мысе', spawns: { negs: { x: 30, z: 160, yaw: 0 }, denter: { x: 0, z: -345, yaw: PI } } },
  { id: 'range', title: 'Полигон «Норд»', note: 'открытое поле, снайперская дуэль', spawns: { negs: { x: 0, z: 10, yaw: 0 }, denter: { x: 0, z: -520, yaw: PI } } },
];
export const pvpMap = (id) => PVP_MAPS.find((m) => m.id === id) || PVP_MAPS[0];

// Оружие для PvP (выбирается в комнате)
export const PVP_WEAPONS = ['ak74m', 'ak74m_gp', 'ak74m_1p78', 'akm', 'svd', 'pkm'];
export const TEAM_NAMES = { negs: 'N.E.G.S', denter: '«Дентер»' };

// Состав отделения ИИ в сетевой игре — по выбору игрока
export const NET_ROLES = {
  rifleman: { role: 'rifleman', weapon: 'ak74m', name: 'стрелок' },
  rifleman_akm: { role: 'rifleman', weapon: 'akm', name: 'стрелок (АКМ)' },
  mg: { role: 'mg', weapon: 'pkm', name: 'пулемётчик' },
  sniper: { role: 'sniper', weapon: 'svd', name: 'разведчик-снайпер' },
  at: { role: 'at', weapon: 'ak74m', secondary: 'rpg7', name: 'гранатомётчик' },
  gp: { role: 'rifleman', weapon: 'ak74m_gp', name: 'стрелок с ГП-25' },
  medic: { role: 'medic', weapon: 'ak74m', name: 'медик' },
};
export const TOW_CHOICES = ['tigr', 'niva', 'mtlb', 't72b'];
// Снаряжение игрока в сетевой игре (комната): оружие, тяжёлое оружие, гранаты, отделение, Д-30 и тягач
export function defaultKit(save = {}, room = {}) {
  const sq = ['sniper', 'mg', 'rifleman', 'at', 'medic', 'rifleman_akm'].slice(0, room.squad ?? 3);
  return {
    weapon: PVP_WEAPONS.includes(save.primary) ? save.primary : 'ak74m',
    heavy: save.launcher === true ? 'rpg7' : save.launcher || null,
    grenades: 3, smokes: 2, squad: sq, howitzer: false, tow: 'tigr', mortar: false, kpv: false, tank: false,
  };
}
export function kitOf(pl, room) {
  const k = pl && pl.kit;
  if (!k) return defaultKit({ primary: pl && pl.weapon }, room || {});
  return k;
}
