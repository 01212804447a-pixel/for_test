// Фоновый поток (отдельное ядро процессора): таблицы стрельбы Д-30 по зарядам, таблицы прямой
// наводки и таблицы миномёта. Считаются при старте задания, пока игрок едет к позиции, —
// в игре таблица уже готова, и открытие прицела ОП4М-45 или таблицы (T) не подвешивает кадр.
import { firingTable } from '../artillery/d30.js';
import { mortarTable } from '../artillery/mortar82.js';

self.onmessage = (e) => {
  for (const job of e.data) {
    let T = null;
    try {
      if (job.k === 'd30') T = firingTable(job.ci);
      else if (job.k === 'd30d') T = firingTable(0, job.shell);
      else if (job.k === 'mortar') T = mortarTable(job.ci);
    } catch (err) { T = null; }
    self.postMessage({ job, T: T ? { ...T, ammo: null } : null });
  }
};
