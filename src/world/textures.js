// Процедурные текстуры (canvas)
import * as THREE from 'three';
import { Noise2D } from '../core/noise.js';
import { mulberry32 } from '../core/math.js';

const cache = new Map();

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function toTex(c, { repeat = true, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

function cached(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}

// Тайлящийся шум (периодический за счёт обёртки координат на торе)
function tileNoise(noise, x, y, size, scale) {
  const a = (x / size) * Math.PI * 2, b = (y / size) * Math.PI * 2;
  const r = scale / (Math.PI * 2);
  return noise.noise(Math.cos(a) * r + 10, Math.sin(a) * r + 10) * 0.5 +
    noise.noise(Math.cos(b) * r + 50, Math.sin(b) * r + 50) * 0.5 +
    noise.noise((Math.cos(a) + Math.sin(b)) * r * 1.7, (Math.sin(a) + Math.cos(b)) * r * 1.7) * 0.6;
}

export function snowTexture() {
  return cached('snow', () => {
    const S = 256, c = canvas(S), g = c.getContext('2d');
    const img = g.createImageData(S, S);
    const n = new Noise2D(7);
    const rnd = mulberry32(3);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const v = tileNoise(n, x, y, S, 6) * 0.5 + tileNoise(n, x * 3 % S, y * 3 % S, S, 12) * 0.25;
      let l = 236 + v * 16;
      if (rnd() > 0.9985) l = 255;
      const i = (y * S + x) * 4;
      img.data[i] = l - 4; img.data[i + 1] = l - 1; img.data[i + 2] = Math.min(255, l + 6); img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return toTex(c);
  });
}

export function snowNormal() {
  return cached('snowN', () => {
    const S = 256, c = canvas(S), g = c.getContext('2d');
    const n = new Noise2D(11);
    const hgt = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      hgt[y * S + x] = tileNoise(n, x, y, S, 8) * 0.6 + tileNoise(n, (x * 2) % S, (y * 2) % S, S, 20) * 0.4;
    }
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const l = hgt[y * S + ((x - 1 + S) % S)], r = hgt[y * S + ((x + 1) % S)];
      const u = hgt[((y - 1 + S) % S) * S + x], d = hgt[((y + 1) % S) * S + x];
      let nx = (l - r) * 2.2, ny = (u - d) * 2.2, nz = 1;
      const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
      const i = (y * S + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255; img.data[i + 1] = (ny * 0.5 + 0.5) * 255; img.data[i + 2] = (nz * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return toTex(c, { srgb: false });
  });
}

export function woodTexture(tone = 0) {
  return cached('wood' + tone, () => {
    const W = 256, c = canvas(W), g = c.getContext('2d');
    const rnd = mulberry32(5 + tone);
    const base = tone === 0 ? [110, 92, 74] : tone === 1 ? [92, 64, 40] : [130, 118, 100];
    const plank = 32;
    for (let x = 0; x < W; x += plank) {
      const k = 0.8 + rnd() * 0.35;
      g.fillStyle = `rgb(${base[0] * k | 0},${base[1] * k | 0},${base[2] * k | 0})`;
      g.fillRect(x, 0, plank, W);
      for (let i = 0; i < 40; i++) {
        g.strokeStyle = `rgba(30,20,10,${0.05 + rnd() * 0.12})`;
        g.lineWidth = 1 + rnd();
        g.beginPath();
        const xx = x + rnd() * plank;
        g.moveTo(xx, 0);
        g.bezierCurveTo(xx + rnd() * 6 - 3, W * 0.3, xx + rnd() * 6 - 3, W * 0.6, xx + rnd() * 4 - 2, W);
        g.stroke();
      }
      g.fillStyle = 'rgba(20,14,8,0.6)';
      g.fillRect(x, 0, 2, W);
      // сучки
      if (rnd() > 0.5) {
        g.fillStyle = 'rgba(40,25,12,0.5)';
        g.beginPath(); g.ellipse(x + plank / 2, rnd() * W, 3, 5, 0, 0, Math.PI * 2); g.fill();
      }
    }
    return toTex(c);
  });
}

export function concreteTexture() {
  return cached('concrete', () => {
    const S = 256, c = canvas(S), g = c.getContext('2d');
    const img = g.createImageData(S, S);
    const n = new Noise2D(21);
    const rnd = mulberry32(9);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const v = tileNoise(n, x, y, S, 5) * 0.6 + (rnd() - 0.5) * 0.3;
      const stain = Math.max(0, tileNoise(n, x + 33, y * 0.4, S, 3)) * 30 * (y / S);
      const l = 150 + v * 22 - stain;
      const i = (y * S + x) * 4;
      img.data[i] = l; img.data[i + 1] = l; img.data[i + 2] = l + 3; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    g.strokeStyle = 'rgba(60,60,60,0.5)'; g.lineWidth = 2;
    g.strokeRect(1, 1, S - 2, S - 2);
    return toTex(c);
  });
}

export function metalTexture(hex = '#4a5a3a', rust = 0.3, key = '') {
  return cached('metal' + hex + rust + key, () => {
    const S = 256, c = canvas(S), g = c.getContext('2d');
    g.fillStyle = hex; g.fillRect(0, 0, S, S);
    const rnd = mulberry32(hex.length * 31 + Math.round(rust * 100));
    const img = g.getImageData(0, 0, S, S);
    const n = new Noise2D(31);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const v = tileNoise(n, x, y, S, 4);
      const k = 1 + v * 0.08 + (rnd() - 0.5) * 0.05;
      let r = img.data[i] * k, gg = img.data[i + 1] * k, b = img.data[i + 2] * k;
      if (v > 1 - rust * 1.2) { const t = Math.min(1, (v - (1 - rust * 1.2)) * 4); r = r * (1 - t) + 110 * t; gg = gg * (1 - t) + 60 * t; b = b * (1 - t) + 30 * t; }
      img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b;
    }
    g.putImageData(img, 0, 0);
    for (let i = 0; i < 60; i++) {
      g.strokeStyle = `rgba(200,200,200,${rnd() * 0.12})`;
      g.beginPath(); const x = rnd() * S, y = rnd() * S; g.moveTo(x, y); g.lineTo(x + rnd() * 20 - 10, y + rnd() * 6 - 3); g.stroke();
    }
    return toTex(c);
  });
}

// Камуфляж: пятна нескольких цветов
export function camoTexture(colors, key, scale = 3) {
  return cached('camo' + key, () => {
    const S = 256, c = canvas(S), g = c.getContext('2d');
    const img = g.createImageData(S, S);
    const n = new Noise2D(key.length * 17 + 3);
    const rgb = colors.map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const v1 = tileNoise(n, x, y, S, scale);
      const v2 = tileNoise(n, x + 77, y + 13, S, scale * 1.6);
      let idx = 0;
      if (v1 > 0.25) idx = 1;
      if (v2 > 0.45 && rgb.length > 2) idx = 2;
      if (v1 < -0.55 && rgb.length > 3) idx = 3;
      const col = rgb[idx];
      const j = (y * S + x) * 4;
      const fz = 1 + ((x * 7 + y * 13) % 5 - 2) * 0.01;
      img.data[j] = col[0] * fz; img.data[j + 1] = col[1] * fz; img.data[j + 2] = col[2] * fz; img.data[j + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return toTex(c);
  });
}

export function rockTexture() {
  return cached('rock', () => {
    const S = 256, c = canvas(S), g = c.getContext('2d');
    const img = g.createImageData(S, S);
    const n = new Noise2D(41);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const v = tileNoise(n, x, y, S, 7) * 0.5 + tileNoise(n, (x * 4) % S, (y * 4) % S, S, 24) * 0.3;
      const l = 92 + v * 40;
      const i = (y * S + x) * 4;
      img.data[i] = l; img.data[i + 1] = l + 2; img.data[i + 2] = l + 6; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return toTex(c);
  });
}

export function textTexture(lines, { w = 512, h = 128, bg = '#e8e2d0', fg = '#1a1a1a', font = 'bold 44px "Arial"' } = {}) {
  const c = canvas(w, h), g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(4, 4, w - 8, h - 8);
  g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  const arr = Array.isArray(lines) ? lines : [lines];
  arr.forEach((l, i) => g.fillText(l, w / 2, (h / (arr.length + 1)) * (i + 1)));
  return toTex(c, { repeat: false });
}

// Мишень (грудная фигура / круги) — для полигона
export function targetTexture(kind = 'chest') {
  return cached('target' + kind, () => {
    const W = 256, H = kind === 'chest' ? 256 : 256, c = canvas(W, H), g = c.getContext('2d');
    if (kind === 'rings') {
      g.fillStyle = '#efe9da'; g.fillRect(0, 0, W, H);
      for (let r = 10; r >= 1; r--) {
        g.beginPath(); g.arc(W / 2, H / 2, r * 12, 0, Math.PI * 2);
        g.fillStyle = r <= 4 ? '#222' : '#efe9da'; g.fill();
        g.strokeStyle = r <= 4 ? '#ddd' : '#333'; g.lineWidth = 1.5; g.stroke();
      }
    } else {
      g.fillStyle = '#d8d4c4'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#4a5a32';
      g.beginPath();
      g.moveTo(W * 0.5 - 40, H * 0.08); g.lineTo(W * 0.5 + 40, H * 0.08);
      g.quadraticCurveTo(W * 0.5 + 52, H * 0.4, W * 0.5 + 34, H * 0.42);
      g.lineTo(W * 0.95, H * 0.55); g.lineTo(W * 0.95, H); g.lineTo(W * 0.05, H); g.lineTo(W * 0.05, H * 0.55);
      g.lineTo(W * 0.5 - 34, H * 0.42); g.quadraticCurveTo(W * 0.5 - 52, H * 0.4, W * 0.5 - 40, H * 0.08);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2;
      for (let r = 1; r <= 4; r++) { g.beginPath(); g.ellipse(W / 2, H * 0.68, r * 22, r * 18, 0, 0, Math.PI * 2); g.stroke(); }
    }
    return toTex(c, { repeat: false });
  });
}

export function softSpriteTexture() {
  return cached('soft', () => {
    const S = 64, c = canvas(S), g = c.getContext('2d');
    const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    return toTex(c, { repeat: false });
  });
}

export function flashTexture() {
  return cached('flash', () => {
    const S = 128, c = canvas(S), g = c.getContext('2d');
    g.translate(S / 2, S / 2);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, S / 2);
    gr.addColorStop(0, 'rgba(255,250,220,1)'); gr.addColorStop(0.25, 'rgba(255,190,90,0.9)'); gr.addColorStop(1, 'rgba(255,120,20,0)');
    g.fillStyle = gr;
    for (let i = 0; i < 6; i++) {
      g.rotate(Math.PI / 3);
      g.beginPath(); g.moveTo(0, -6); g.lineTo(S / 2, 0); g.lineTo(0, 6); g.fill();
    }
    g.beginPath(); g.arc(0, 0, S * 0.22, 0, Math.PI * 2); g.fill();
    return toTex(c, { repeat: false });
  });
}

// Бревенчатая стена избы
export function logTexture() {
  return cached('logs', () => {
    const S = 256, c = canvas(S), g = c.getContext('2d');
    const rnd = mulberry32(77);
    const lh = 32;
    for (let y = 0; y < S; y += lh) {
      const k = 0.85 + rnd() * 0.25;
      const gr = g.createLinearGradient(0, y, 0, y + lh);
      gr.addColorStop(0, `rgb(${45 * k | 0},${33 * k | 0},${24 * k | 0})`);
      gr.addColorStop(0.35, `rgb(${105 * k | 0},${80 * k | 0},${58 * k | 0})`);
      gr.addColorStop(0.7, `rgb(${88 * k | 0},${66 * k | 0},${48 * k | 0})`);
      gr.addColorStop(1, `rgb(${30 * k | 0},${22 * k | 0},${16 * k | 0})`);
      g.fillStyle = gr; g.fillRect(0, y, S, lh);
      for (let i = 0; i < 20; i++) { g.strokeStyle = `rgba(20,14,8,${rnd() * 0.25})`; g.beginPath(); const yy = y + rnd() * lh; g.moveTo(0, yy); g.lineTo(S, yy + (rnd() - 0.5) * 4); g.stroke(); }
      // мох/пакля между брёвнами
      g.fillStyle = 'rgba(120,110,80,0.5)'; g.fillRect(0, y + lh - 2, S, 2);
    }
    return toTex(c);
  });
}

// Кирпичная кладка (силикатный/красный кирпич на растворе), 512 px ≈ 1,5 м; bump — та же раскладка
export function brickTexture(kind = 'red') {
  return cached('brick' + kind, () => {
    const S = 512, c = canvas(S), g = c.getContext('2d');
    const b = canvas(S), gb = b.getContext('2d');
    const rnd = mulberry32(kind === 'red' ? 31 : 37);
    const n = new Noise2D(kind === 'red' ? 5 : 6);
    const rows = 22, bh = S / rows, bw = bh * 2.6;
    g.fillStyle = kind === 'red' ? '#8e8478' : '#9a978f'; g.fillRect(0, 0, S, S);
    gb.fillStyle = '#202020'; gb.fillRect(0, 0, S, S);
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * bw * 0.5;
      for (let x = -bw; x < S + bw; x += bw) {
        const x0 = x + off + 1.5, y0 = r * bh + 1.5, w = bw - 3, h = bh - 3;
        const t = rnd();
        let col;
        if (kind === 'red') {
          // старый советский кирпич: приглушённый терракотовый, часть пережжённых тёмных и выцветших
          const k = rnd(), dk = k < 0.1 ? 0.62 : k > 0.9 ? 1.12 : 1;
          const R = (108 + t * 40) * dk, G = (64 + t * 22) * dk, B = (52 + t * 16) * dk;
          col = `rgb(${R | 0},${G | 0},${B | 0})`;
        }
        else { const L = 190 + t * 35; col = `rgb(${L | 0},${(L - 4) | 0},${(L - 10) | 0})`; }
        g.fillStyle = col; g.fillRect(x0, y0, w, h);
        // сколы и копоть
        if (rnd() < 0.15) { g.fillStyle = 'rgba(40,30,25,0.35)'; g.fillRect(x0 + rnd() * w * 0.6, y0, w * 0.3, h); }
        gb.fillStyle = `rgb(${(170 + rnd() * 50) | 0},0,0)`; gb.fillRect(x0, y0, w, h);
      }
    }
    // потёки, выветривание
    const img = g.getImageData(0, 0, S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const v = tileNoise(n, x, y, S, 7) * 18 - Math.max(0, tileNoise(n, x * 0.5 + 99, y * 0.15, S, 3)) * 22 * (y / S);
      const i = (y * S + x) * 4;
      img.data[i] += v; img.data[i + 1] += v; img.data[i + 2] += v;
    }
    g.putImageData(img, 0, 0);
    const map = toTex(c), bump = toTex(b, { srgb: false });
    return { map, bump };
  });
}
