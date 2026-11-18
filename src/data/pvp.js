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
