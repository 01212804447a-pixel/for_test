// Общие математические утилиты
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
// Русская артиллерийская "тысячная": 1/6000 окружности
export const MIL = TAU / 6000;

export function wrapAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

export function rand(a = 0, b = 1) {
  return a + Math.random() * (b - a);
}
export function randInt(a, b) {
  return Math.floor(a + Math.random() * (b - a + 1));
}
export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
// Нормальное распределение (Бокс–Мюллер)
export function randn() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
}

// Детерминированный ГПСЧ
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Азимут (0 = север = -Z, по часовой) из вектора направления
export function azimuthOf(dx, dz) {
  let a = Math.atan2(dx, -dz);
  if (a < 0) a += TAU;
  return a;
}

export function dist2D(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

// Ближайшее расстояние от точки до отрезка (3D, массивы/объекты {x,y,z})
export function segPointDist(p0, p1, q) {
  const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
  const len2 = dx * dx + dy * dy + dz * dz;
  let t = 0;
  if (len2 > 1e-9) t = clamp(((q.x - p0.x) * dx + (q.y - p0.y) * dy + (q.z - p0.z) * dz) / len2, 0, 1);
  const cx = p0.x + dx * t - q.x, cy = p0.y + dy * t - q.y, cz = p0.z + dz * t - q.z;
  return { d: Math.sqrt(cx * cx + cy * cy + cz * cz), t };
}

export function formatMil(rad) {
  // формат "7-50"
  let m = Math.round(rad / MIL);
  m = ((m % 6000) + 6000) % 6000;
  const hi = Math.floor(m / 100), lo = m % 100;
  return `${hi}-${lo.toString().padStart(2, '0')}`;
}

export const CARDINALS = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
export function cardinal(az) {
  const i = Math.round(az / (TAU / 8)) % 8;
  return CARDINALS[i];
}
