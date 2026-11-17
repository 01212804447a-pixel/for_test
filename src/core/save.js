// Сохранение прогресса (localStorage, с защитой от недоступности)
const KEY = 'negs-zapolyarye-save-v1';

const DEFAULT = {
  started: false,
  completed: {},
  hospital: {},
  xp: {},
  squad: ['grom', 'sova', 'bury', 'doc', 'shtyk', 'lis'],
  primary: 'ak74m_gp',
  launcher: false,
  vehicles: ['tigr'],
  loads: {},
  settings: { sens: 2.2, fov: 72, volume: 0.8, quality: 'medium', invertY: false },
};

export function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s) return { ...DEFAULT, ...s, settings: { ...DEFAULT.settings, ...(s.settings || {}) } };
  } catch (e) { /* недоступно */ }
  return JSON.parse(JSON.stringify(DEFAULT));
}

export function writeSave(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* недоступно */ }
}

export function resetSave() {
  try { localStorage.removeItem(KEY); } catch (e) { /* */ }
  return JSON.parse(JSON.stringify(DEFAULT));
}
