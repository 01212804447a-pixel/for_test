// Прицельные сетки оптики. Все отметки строятся по реальным угловым величинам:
// дальномерные шкалы — по высоте цели, угольники и марки — по баллистическому
// решению для конкретного боеприпаса (то же, что и в таблице стрельбы).
import { MIL } from '../core/math.js';

export function drawScope(ctx, W, H, scope, o) {
  const { f, cx, cy, r, offX = 0, offY = 0, night = false, marks = [], extra = [] } = o;
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  // тубус
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath(); ctx.arc(cx + offX, cy + offY, r, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  const vg = ctx.createRadialGradient(cx + offX, cy + offY, r * 0.82, cx + offX, cy + offY, r);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.92)');
  ctx.fillStyle = vg;
  ctx.beginPath(); ctx.arc(cx + offX, cy + offY, r + 1, 0, Math.PI * 2); ctx.fill();
  // сетка
  ctx.beginPath(); ctx.arc(cx + offX, cy + offY, r * 0.985, 0, Math.PI * 2); ctx.clip();
  const col = night ? 'rgba(255,90,30,0.95)' : 'rgba(8,8,8,0.95)';
  ctx.strokeStyle = col; ctx.fillStyle = col;
  if (night) { ctx.shadowColor = 'rgba(255,80,20,0.9)'; ctx.shadowBlur = 4; }
  ctx.lineWidth = Math.max(1.2, r / 260);
  ctx.font = `${Math.round(Math.max(10, r / 26))}px Arial`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const X = (m) => cx + Math.tan(m * MIL) * f;
  const Y = (m) => cy + Math.tan(m * MIL) * f;
  const line = (x0, y0, x1, y1) => { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); };
  const chevron = (mx, my, s) => {
    ctx.beginPath(); ctx.moveTo(X(mx - s), Y(my + s)); ctx.lineTo(X(mx), Y(my)); ctx.lineTo(X(mx + s), Y(my + s)); ctx.stroke();
  };
  const rangefinder = (H0, from, to, x0, y0, labels, stepM) => {
    // базовая линия и кривая высоты цели H0 на дальностях from..to
    const xs = (D) => x0 + ((to - D) / (to - from)) * 24;
    line(X(x0), Y(y0), X(x0 + 25), Y(y0));
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    for (let D = from; D <= to; D += 10) {
      const hm = (H0 / D) / MIL;
      const xx = X(xs(D)), yy = Y(y0 - hm);
      if (D === from) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
    }
    ctx.stroke(); ctx.setLineDash([]);
    for (const D of labels) {
      ctx.fillText(String(Math.round(D / stepM)), X(xs(D)), Y(y0 + 1.6));
      line(X(xs(D)), Y(y0), X(xs(D)), Y(y0 + 0.5));
    }
  };

  if (scope.reticle === 'pso1') {
    chevron(0, 0, 1);
    line(X(0), Y(1.2), X(0), Y(2.4));
    for (const e of extra) chevron(0, e / MIL, 0.6);
    for (let i = 1; i <= 10; i++) {
      const hgt = i % 5 === 0 ? 1.2 : 0.55;
      line(X(i), Y(0), X(i), Y(-hgt)); line(X(-i), Y(0), X(-i), Y(-hgt));
    }
    line(X(1), Y(0), X(10), Y(0)); line(X(-1), Y(0), X(-10), Y(0));
    ctx.fillText('10', X(-10), Y(-2.2)); ctx.fillText('10', X(10), Y(-2.2));
    rangefinder(scope.rangefinder.H, scope.rangefinder.from, scope.rangefinder.to, -34, 15, [200, 400, 600, 800, 1000], 100);
    ctx.fillText('1,7', X(-36), Y(9));
  } else if (scope.reticle === 'bdc') {
    // 1П78: центральный угольник — пристрелка 100 м, ниже марки 2..4
    chevron(0, 0, 1.2);
    for (const mk of marks) {
      if (mk.range === scope.zero) continue;
      const my = mk.ang / MIL;
      line(X(-1.5), Y(my), X(1.5), Y(my));
      ctx.fillText(String(mk.range / 100), X(-3.2), Y(my));
    }
    const last = marks.length ? marks[marks.length - 1].ang / MIL : 10;
    line(X(0), Y(1.6), X(0), Y(last - 0.8));
    line(X(4), Y(0), X(18), Y(0)); line(X(-4), Y(0), X(-18), Y(0));
    for (const i of [5, 10, 15]) { line(X(i), Y(-0.8), X(i), Y(0.8)); line(X(-i), Y(-0.8), X(-i), Y(0.8)); }
    rangefinder(1.7, 100, 400, -38, 26, [100, 200, 300, 400], 100);
  } else if (scope.reticle === 'pgo7') {
    // ПГО-7: шкала дальностей 2..5 и боковые поправки через 10 тысячных
    for (const mk of marks) {
      const my = mk.ang / MIL;
      if (mk.range === scope.zero) chevron(0, my, 1.2);
      else line(X(-1.2), Y(my), X(1.2), Y(my));
      ctx.fillText(String(mk.range / 100), X(-3), Y(my + 0.2));
    }
    const last = marks.length ? marks[marks.length - 1].ang / MIL : 10;
    line(X(0), Y(1.4), X(0), Y(last + 3));
    for (let i = 1; i <= 4; i++) {
      for (const sg of [-1, 1]) {
        line(X(sg * i * 10), Y(-1.5), X(sg * i * 10), Y(1.5));
        if (i < 4) line(X(sg * (i * 10 - 5)), Y(-0.6), X(sg * (i * 10 - 5)), Y(0.6));
      }
    }
    line(X(-40), Y(0), X(-3), Y(0)); line(X(3), Y(0), X(40), Y(0));
    rangefinder(scope.rangefinder.H, scope.rangefinder.from, scope.rangefinder.to, -14, 36, [200, 300, 400, 500, 600, 700], 100);
  } else if (scope.reticle === 'pp61') {
    chevron(0, 0, 1.5);
    for (const mk of marks) {
      if (mk.range === scope.zero) continue;
      const my = mk.ang / MIL;
      line(X(-1.5), Y(my), X(1.5), Y(my));
      ctx.fillText(String(mk.range / 100), X(3.5), Y(my));
    }
    for (let i = 5; i <= 30; i += 5) { line(X(i), Y(-1), X(i), Y(1)); line(X(-i), Y(-1), X(-i), Y(1)); }
    line(X(3), Y(0), X(30), Y(0)); line(X(-3), Y(0), X(-30), Y(0));
  } else if (scope.reticle === 'binocular') {
    // угломерная сетка бинокля: деления 5 тыс., оцифровка через 10
    line(X(-50), Y(0), X(50), Y(0));
    for (let i = -50; i <= 50; i += 5) {
      const hgt = i % 10 === 0 ? 1.6 : 0.8;
      line(X(i), Y(0), X(i), Y(-hgt));
      if (i % 10 === 0 && i !== 0) ctx.fillText(String(Math.abs(i)), X(i), Y(-3));
    }
    line(X(0), Y(-3), X(0), Y(20));
    for (let i = 5; i <= 20; i += 5) { line(X(-1.2), Y(i), X(1.2), Y(i)); ctx.fillText(String(i), X(3), Y(i)); }
    ctx.textAlign = 'left';
    ctx.fillText('D = H·1000 / тыс.', X(-48), Y(30));
  }
  ctx.restore();
}
