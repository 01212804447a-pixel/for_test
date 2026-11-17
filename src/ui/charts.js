// Отрисовка графиков траекторий и таблиц (для стенда в штабе и окна просмотра)
const COLORS = ['#1f5aa6', '#b3261e', '#2e7d32', '#8e24aa', '#ef6c00', '#00838f', '#5d4037', '#455a64'];

export function drawChart(cv, chart, { light = true, font = 13, pad = null } = {}) {
  const g = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const P = pad || { l: 64, r: 16, t: 34, b: 44 };
  g.fillStyle = light ? '#f4f1e8' : '#10151a'; g.fillRect(0, 0, W, H);
  const fg = light ? '#1c1c1c' : '#dfe6ea', grid = light ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.1)';
  let xmin = 0, xmax = chart.xMax || 1000, ymin = Infinity, ymax = -Infinity;
  for (const s of chart.series) for (const [x, y] of s.pts) { if (x > xmax) continue; ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }
  if (!isFinite(ymin)) { ymin = 0; ymax = 1; }
  if (chart.yClamp) { ymin = Math.max(ymin, chart.yClamp[0]); ymax = Math.min(ymax, chart.yClamp[1]); }
  const yr = ymax - ymin || 1; ymin -= yr * 0.08; ymax += yr * 0.08;
  if (chart.equal) ymin = Math.min(ymin, 0);
  const X = (x) => P.l + ((x - xmin) / (xmax - xmin)) * (W - P.l - P.r);
  const Y = (y) => H - P.b - ((y - ymin) / (ymax - ymin)) * (H - P.t - P.b);
  g.font = `bold ${font + 1}px Arial`; g.fillStyle = fg; g.textAlign = 'left';
  g.fillText(chart.title, P.l, P.t - 12);
  // сетка
  const nice = (r) => { const p = Math.pow(10, Math.floor(Math.log10(r))); const m = r / p; return (m < 2 ? 1 : m < 5 ? 2 : 5) * p; };
  const xs = nice((xmax - xmin) / 8), ys = nice((ymax - ymin) / 6);
  g.strokeStyle = grid; g.lineWidth = 1; g.font = `${font}px Arial`; g.fillStyle = fg;
  g.textAlign = 'center';
  for (let x = Math.ceil(xmin / xs) * xs; x <= xmax + 1e-6; x += xs) { g.beginPath(); g.moveTo(X(x), P.t); g.lineTo(X(x), H - P.b); g.stroke(); g.fillText(String(Math.round(x)), X(x), H - P.b + font + 4); }
  g.textAlign = 'right';
  for (let y = Math.ceil(ymin / ys) * ys; y <= ymax + 1e-6; y += ys) { g.beginPath(); g.moveTo(P.l, Y(y)); g.lineTo(W - P.r, Y(y)); g.stroke(); g.fillText((Math.abs(ys) < 1 ? y.toFixed(1) : Math.round(y)).toString(), P.l - 6, Y(y) + 4); }
  // ось / линия прицеливания
  if (ymin < 0 && ymax > 0) { g.strokeStyle = fg; g.lineWidth = 1.5; g.setLineDash([6, 4]); g.beginPath(); g.moveTo(P.l, Y(0)); g.lineTo(W - P.r, Y(0)); g.stroke(); g.setLineDash([]); }
  g.textAlign = 'center'; g.fillText(chart.xLabel, (P.l + W - P.r) / 2, H - 8);
  g.save(); g.translate(16, (P.t + H - P.b) / 2); g.rotate(-Math.PI / 2); g.fillText(chart.yLabel, 0, 0); g.restore();
  g.save(); g.beginPath(); g.rect(P.l, P.t, W - P.l - P.r, H - P.t - P.b); g.clip();
  chart.series.forEach((s, i) => {
    g.strokeStyle = COLORS[i % COLORS.length]; g.lineWidth = 2.2; g.beginPath();
    let first = true;
    for (const [x, y] of s.pts) { if (x > xmax) break; if (first) { g.moveTo(X(x), Y(y)); first = false; } else g.lineTo(X(x), Y(y)); }
    g.stroke();
  });
  g.restore();
  // легенда
  g.textAlign = 'left'; g.font = `${font}px Arial`;
  let lx = P.l + 8, ly = P.t + 14;
  chart.series.forEach((s, i) => {
    const w = g.measureText(s.label).width + 30;
    if (lx + w > W - P.r) { lx = P.l + 8; ly += font + 6; }
    g.fillStyle = COLORS[i % COLORS.length]; g.fillRect(lx, ly - font / 2, 16, 3);
    g.fillStyle = fg; g.fillText(s.label, lx + 20, ly);
    lx += w;
  });
}

export function drawTable(g, x, y, w, table, { font = 12, maxRows = 99, light = true } = {}) {
  const cols = table.columns, rows = table.rows.slice(0, maxRows);
  const cw = w / cols.length;
  const rh = font + 8;
  g.font = `bold ${font - 1}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = light ? '#d9d2bf' : '#26313a';
  const headH = rh * 2.3;
  g.fillRect(x, y, w, headH);
  g.fillStyle = light ? '#111' : '#eee';
  cols.forEach((c, i) => {
    const words = c.split(' ');
    const lines = []; let cur = '';
    for (const wd of words) { if (g.measureText(cur + ' ' + wd).width > cw - 4 && cur) { lines.push(cur); cur = wd; } else cur = cur ? cur + ' ' + wd : wd; }
    lines.push(cur);
    lines.slice(0, 3).forEach((l, k) => g.fillText(l, x + cw * (i + 0.5), y + headH / 2 + (k - (Math.min(3, lines.length) - 1) / 2) * (font - 1)));
  });
  g.font = `${font}px Arial`;
  rows.forEach((r, j) => {
    const yy = y + headH + j * rh;
    g.fillStyle = j % 2 ? (light ? '#efe9da' : '#182027') : (light ? '#f7f3e9' : '#1d262e');
    g.fillRect(x, yy, w, rh);
    g.fillStyle = light ? '#111' : '#e5e5e5';
    r.cells.forEach((c, i) => g.fillText(String(c), x + cw * (i + 0.5), yy + rh / 2));
  });
  g.strokeStyle = light ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.2)';
  g.strokeRect(x, y, w, headH + rows.length * rh);
  g.textBaseline = 'alphabetic';
  return headH + rows.length * rh;
}
