// Запуск фонового потока с расчётом таблиц стрельбы (если браузер не даёт создать поток —
// таблицы, как раньше, посчитаются при первом обращении).
import SRC from '../../dist/tables.worker.txt';
import { primeFiringTable } from '../artillery/d30.js';
import { primeMortarTable } from '../artillery/mortar82.js';

export function precomputeTables(jobs) {
  if (!jobs.length) return false;
  let w;
  try { w = new Worker(URL.createObjectURL(new Blob([SRC], { type: 'text/javascript' }))); } catch (e) { return false; }
  let left = jobs.length;
  w.onmessage = (e) => {
    const { job, T } = e.data;
    if (T) {
      if (job.k === 'd30') primeFiringTable(job.ci, T);
      else if (job.k === 'd30d') primeFiringTable(job.shell, T);
      else if (job.k === 'mortar') primeMortarTable(job.ci, T);
    }
    if (--left <= 0) w.terminate();
  };
  w.onerror = () => { try { w.terminate(); } catch (e) { /* */ } };
  w.postMessage(jobs);
  return true;
}
