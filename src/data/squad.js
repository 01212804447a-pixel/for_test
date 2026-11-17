// Личный состав отделения N.E.G.S (кандидаты на выход; не более 6)
export const ROSTER = [
  {
    id: 'grom', name: 'Артём Громов', callsign: 'Гром', rank: 'мл. сержант', role: 'mg', roleName: 'Пулемётчик',
    weapon: 'pkm', age: 31, stats: { aim: 64, reaction: 58, nerve: 86, stamina: 78 },
    bio: 'Сапёр-разведчик в прошлом, перешёл в пулемётчики. Держит сектор под огнём, пока остальные маневрируют.',
  },
  {
    id: 'sova', name: 'Вера Совина', callsign: 'Сова', rank: 'ефрейтор', role: 'sniper', roleName: 'Снайпер / наблюдатель',
    weapon: 'svd', age: 27, stats: { aim: 91, reaction: 74, nerve: 70, stamina: 60 },
    bio: 'Чемпионка округа по стрельбе. В бинокль определяет дальность до цели — нажмите ЛКМ, глядя в бинокль, и она доложит.',
  },
  {
    id: 'bury', name: 'Максим Бурый', callsign: 'Бурый', rank: 'рядовой', role: 'at', roleName: 'Гранатомётчик',
    weapon: 'ak74m', secondary: 'rpg7', age: 24, stats: { aim: 60, reaction: 62, nerve: 66, stamina: 88 },
    bio: 'Носит РПГ-7В и три выстрела. Первоочерёдные цели — техника противника.',
  },
  {
    id: 'doc', name: 'Илья Доронин', callsign: 'Док', rank: 'сержант мед. службы', role: 'medic', roleName: 'Медик',
    weapon: 'ak74m', age: 35, stats: { aim: 52, reaction: 60, nerve: 77, stamina: 64 },
    bio: 'Сам подойдёт к раненому и перевяжет (+45 к здоровью). 8 перевязочных пакетов.',
  },
  {
    id: 'shtyk', name: 'Денис Штыков', callsign: 'Штык', rank: 'ефрейтор', role: 'rifleman', roleName: 'Стрелок-штурмовик',
    weapon: 'ak74m', age: 26, stats: { aim: 70, reaction: 79, nerve: 72, stamina: 82 },
    bio: 'Быстрый и агрессивный, хорош в ближнем бою и при зачистке зданий.',
  },
  {
    id: 'lis', name: 'Тимур Лисицын', callsign: 'Лис', rank: 'рядовой', role: 'rifleman', roleName: 'Стрелок (1П78)',
    weapon: 'ak74m_1p78', age: 23, stats: { aim: 76, reaction: 68, nerve: 58, stamina: 72 },
    bio: 'Автомат с оптикой 1П78. Уверенно работает на 300–400 м.',
  },
  {
    id: 'kedr', name: 'Павел Кедров', callsign: 'Кедр', rank: 'мл. сержант', role: 'rifleman', roleName: 'Стрелок (АКМ)',
    weapon: 'akm', age: 38, stats: { aim: 66, reaction: 55, nerve: 90, stamina: 70 },
    bio: 'Ветеран, прошёл три командировки. Не теряет голову под огнём.',
  },
  {
    id: 'tundra', name: 'Аян Тундрин', callsign: 'Тундра', rank: 'рядовой', role: 'rifleman', roleName: 'Стрелок-следопыт',
    weapon: 'ak74m', age: 22, stats: { aim: 68, reaction: 84, nerve: 54, stamina: 92 },
    bio: 'Местный, вырос в стойбище. Первым замечает противника.',
  },
];

export const STAT_NAMES = { aim: 'Меткость', reaction: 'Реакция', nerve: 'Стойкость под огнём', stamina: 'Выносливость' };

export function toSkill(stats) {
  return { aim: stats.aim / 100, reaction: stats.reaction / 100, nerve: stats.nerve / 100, stamina: stats.stamina / 100 };
}
