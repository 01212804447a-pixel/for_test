// Синтезированный звук (WebAudio): выстрелы с задержкой по скорости звука,
// щелчки сверхзвуковых пуль, взрывы, шаги, двигатели, ветер, рация.
import { SOUNDS } from '../data/weapons.js';

const SPEED_OF_SOUND = 325; // ~ при -20 °C

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this.engines = new Set();
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { this.ctx = null; return; }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6; comp.attack.value = 0.002; comp.release.value = 0.2;
    // глушение при контузии: общий фильтр низких частот на выходе
    this.deaf = ctx.createBiquadFilter(); this.deaf.type = 'lowpass'; this.deaf.frequency.value = 20000; this.deaf.Q.value = 0.5;
    this.master.connect(this.deaf); this.deaf.connect(comp); comp.connect(ctx.destination);
    // Белый шум
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // Эхо гор: свёртка с затухающим шумом
    this.reverb = ctx.createConvolver();
    const rl = Math.floor(ctx.sampleRate * 2.6);
    const ir = ctx.createBuffer(2, rl, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < rl; i++) {
        const t = i / ctx.sampleRate;
        // запаздывающие отражения от склонов
        const echo = (t > 0.35 && t < 0.5) || (t > 0.9 && t < 1.05) ? 2.2 : 1;
        ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rl, 3) * 0.35 * echo * (t < 0.05 ? t / 0.05 : 1);
      }
    }
    this.reverb.buffer = ir;
    this.revGain = ctx.createGain(); this.revGain.gain.value = 0.35;
    this.reverb.connect(this.revGain); this.revGain.connect(this.master);
    this._startWind();
  }

  // контузия: звук глохнет на t секунд (k — сила 0..1), в ушах звенит
  concussion(k = 1, t = 3) {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime, f = this.deaf.frequency;
    f.cancelScheduledValues(t0);
    f.setValueAtTime(Math.max(160, 900 - k * 700), t0 + 0.02);
    f.setValueAtTime(Math.max(160, 900 - k * 700), t0 + t * 0.45);
    f.exponentialRampToValueAtTime(20000, t0 + t);
    // звон: высокий тон, мимо фильтра, медленно затухает
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 3600 + Math.random() * 900;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.05 * this.volume * (0.4 + k), t0 + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + t * 1.2);
    o.connect(g); g.connect(ctx.destination); o.start(t0); o.stop(t0 + t * 1.2 + 0.1);
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  setListener(x, y, z, yaw) {
    const l = this.listener; l.x = x; l.y = y; l.z = z; l.yaw = yaw;
  }

  _spatial(pos) {
    const l = this.listener;
    if (!pos) return { d: 0, gain: 1, pan: 0, delay: 0, lp: 20000 };
    const dx = pos.x - l.x, dy = pos.y - l.y, dz = pos.z - l.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    // правый вектор слушателя
    const rx = Math.cos(l.yaw), rz = -Math.sin(l.yaw);
    const pan = d > 0.5 ? Math.max(-1, Math.min(1, (dx * rx + dz * rz) / d)) * 0.85 : 0;
    return {
      d,
      gain: 1 / (1 + d / 12),
      pan,
      delay: d / SPEED_OF_SOUND,
      lp: Math.max(500, 16000 * Math.exp(-d / 350)),
    };
  }

  // ограничение одновременных звуков: в перестрелке десятки бойцов, и каждый выстрел создаёт
  // свою цепочку узлов Web Audio — тише всего и дальше всего пропускаем (своё и взрывы — всегда)
  _voice(dur, prio = false, d = 0) {
    const now = this.ctx.currentTime, V = this._voices || (this._voices = []);
    let n = 0;
    for (let i = 0; i < V.length; i++) if (V[i] > now) V[n++] = V[i];
    V.length = n;
    if (!prio && (n >= 28 || (n >= 16 && d > 300))) return false;
    V.push(now + dur);
    return true;
  }

  _out(sp, revAmt = 0.4) {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = sp.lp;
    const g = ctx.createGain(); g.gain.value = sp.gain;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    lp.connect(g);
    if (p) { p.pan.value = sp.pan; g.connect(p); p.connect(this.master); } else g.connect(this.master);
    const rs = ctx.createGain(); rs.gain.value = revAmt * Math.min(1, 0.3 + sp.d / 150);
    lp.connect(rs); rs.connect(this.reverb);
    return lp;
  }

  _noiseBurst(dest, t0, dur, { type = 'bandpass', freq = 1000, q = 0.7, gain = 1, attack = 0.001, decayPow = 1 } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t0, Math.random() * 1.5); src.stop(t0 + dur + 0.05);
  }

  _thump(dest, t0, freq, dur, gain) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(freq * 2, t0);
    o.frequency.exponentialRampToValueAtTime(freq * 0.5, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  shot(pos, profileId, own = false) {
    if (!this.ctx) return;
    const pr = SOUNDS[profileId] || SOUNDS.r545;
    const sp = own ? { d: 0, gain: 0.9, pan: 0, delay: 0, lp: 16000 } : this._spatial(pos);
    if (sp.d > 2500) return;
    if (!this._voice(sp.delay + 0.6, own, sp.d)) return;
    const t0 = this.ctx.currentTime + sp.delay;
    const out = this._out(sp, 0.55);
    this._noiseBurst(out, t0, 0.025 + pr.decay * 0.15, { type: 'highpass', freq: pr.freq * 1.6, gain: pr.crack, q: 0.5 });
    this._noiseBurst(out, t0, pr.decay, { type: 'bandpass', freq: pr.freq * 0.6, gain: pr.body, q: 0.6 });
    this._thump(out, t0, pr.thump, pr.decay * 1.4, pr.body * 0.9);
    if (profileId === 'rpg') {
      this._noiseBurst(out, t0 + 0.05, 1.3, { type: 'bandpass', freq: 900, gain: 0.35, q: 0.4, attack: 0.08 });
    }
  }

  // Щелчок сверхзвуковой пули рядом с головой
  crack(intensity = 1, pan = 0, supersonic = true) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const g = ctx.createGain(); g.gain.value = Math.min(1, intensity);
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) { p.pan.value = pan; g.connect(p); p.connect(this.master); } else g.connect(this.master);
    if (supersonic) {
      this._noiseBurst(g, t0, 0.03, { type: 'highpass', freq: 3500, gain: 0.9, q: 0.3 });
      this._noiseBurst(g, t0 + 0.004, 0.06, { type: 'bandpass', freq: 1800, gain: 0.3 });
    } else {
      // дозвуковой «вжик»
      const src = ctx.createBufferSource(); src.buffer = this.noise;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 6;
      f.frequency.setValueAtTime(2500, t0); f.frequency.exponentialRampToValueAtTime(700, t0 + 0.25);
      const gg = ctx.createGain(); gg.gain.setValueAtTime(0.0001, t0); gg.gain.exponentialRampToValueAtTime(0.4, t0 + 0.08); gg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
      src.connect(f); f.connect(gg); gg.connect(g); src.start(t0); src.stop(t0 + 0.3);
    }
  }

  explosion(pos, size = 1) {
    if (!this.ctx) return;
    const sp = this._spatial(pos);
    const t0 = this.ctx.currentTime + sp.delay;
    sp.gain = Math.min(1.6, sp.gain * 2.2 * size);
    const out = this._out(sp, 0.8);
    this._noiseBurst(out, t0, 0.15, { type: 'highpass', freq: 1500, gain: 0.8 * size });
    this._noiseBurst(out, t0, 1.8 * size, { type: 'lowpass', freq: 600, gain: 1.0, q: 0.5 });
    this._thump(out, t0, 40, 1.2 * size, 1.0);
    // осыпающиеся осколки / снег
    this._noiseBurst(out, t0 + 0.4, 1.2, { type: 'bandpass', freq: 3000, gain: 0.05, attack: 0.3 });
  }

  impact(pos, mat = 'snow') {
    if (!this.ctx) return;
    const sp = this._spatial(pos);
    if (sp.d > 120) return;
    if (!this._voice(sp.delay + 0.3, false, sp.d * 3)) return;
    const t0 = this.ctx.currentTime + sp.delay;
    const out = this._out(sp, 0.2);
    if (mat === 'metal') {
      const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 1800 + Math.random() * 1500;
      const g = this.ctx.createGain(); g.gain.setValueAtTime(0.25, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
      o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + 0.4);
    } else if (mat === 'glass') {
      // звон и осыпь стекла: несколько коротких высоких звонов и шорох
      for (let k = 0; k < 5; k++) {
        const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 3200 + Math.random() * 4200;
        const g = this.ctx.createGain(); const t = t0 + k * (0.02 + Math.random() * 0.05);
        g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18 + Math.random() * 0.2);
        o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.45);
      }
      this._noiseBurst(out, t0, 0.35, { type: 'highpass', freq: 3500, gain: 0.35 });
    } else if (mat === 'target') {
      const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 900 + Math.random() * 100;
      const g = this.ctx.createGain(); g.gain.setValueAtTime(0.5, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
      o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + 1);
    } else {
      this._noiseBurst(out, t0, 0.08, { type: 'bandpass', freq: mat === 'wood' ? 700 : mat === 'concrete' ? 2200 : 400, gain: 0.4 });
    }
  }

  ricochet(pos) {
    if (!this.ctx) return;
    const sp = this._spatial(pos);
    if (sp.d > 150) return;
    if (!this._voice(sp.delay + 0.5, false, sp.d * 3)) return;
    const t0 = this.ctx.currentTime + sp.delay;
    const out = this._out(sp, 0.3);
    const o = this.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(3000, t0); o.frequency.exponentialRampToValueAtTime(900, t0 + 0.4);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.18, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);
    o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + 0.5);
  }

  footstep(pos, own = false, loud = 0.12) {
    if (!this.ctx) return;
    const sp = own ? { d: 0, gain: 1, pan: 0, delay: 0, lp: 6000 } : this._spatial(pos);
    if (sp.d > 40) return;
    if (!own && !this._voice(0.2, false, 400)) return;
    const t0 = this.ctx.currentTime + sp.delay;
    const out = this._out(sp, 0.05);
    this._noiseBurst(out, t0, 0.12, { type: 'bandpass', freq: 700 + Math.random() * 500, gain: loud, q: 1.2, attack: 0.015 });
    this._noiseBurst(out, t0 + 0.03, 0.09, { type: 'highpass', freq: 3000, gain: loud * 0.4 });
  }

  click() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    this._noiseBurst(this.master, t0, 0.03, { type: 'highpass', freq: 2500, gain: 0.25 });
  }
  mech(kind = 'reload') {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const seq = kind === 'reload' ? [0, 0.35, 0.9, 1.6] : kind === 'sight' ? [0] : [0, 0.12];
    for (const dt of seq) this._noiseBurst(this.master, t0 + dt, 0.05, { type: 'bandpass', freq: 2200 + Math.random() * 800, gain: 0.22, q: 2 });
  }
  pin() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = 3200;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.05, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.08);
    o.connect(g); g.connect(this.master); o.start(t0); o.stop(t0 + 0.1);
  }

  radio() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = 1150;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.04, t0); g.gain.setValueAtTime(0.0001, t0 + 0.12);
    o.connect(g); g.connect(this.master); o.start(t0); o.stop(t0 + 0.14);
    this._noiseBurst(this.master, t0 + 0.13, 0.35, { type: 'bandpass', freq: 1800, gain: 0.06, q: 0.6, attack: 0.02 });
  }

  hurt() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    this._thump(this.master, t0, 70, 0.35, 0.8);
    this._noiseBurst(this.master, t0, 0.2, { type: 'lowpass', freq: 400, gain: 0.5 });
  }

  _startWind() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = 0.4;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13;
    const lfoG = ctx.createGain(); lfoG.gain.value = 220;
    lfo.connect(lfoG); lfoG.connect(f.frequency);
    src.connect(f); f.connect(this.windGain); this.windGain.connect(this.master);
    src.start(); lfo.start();
  }
  setWind(strength) {
    if (this.windGain) this.windGain.gain.setTargetAtTime(Math.min(0.25, strength * 0.018), this.ctx.currentTime, 0.5);
  }

  createEngine(kind = 'car') {
    if (!this.ctx) return { set() {}, stop() {} };
    const ctx = this.ctx;
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
    const o2 = ctx.createOscillator(); o2.type = 'square';
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; f.Q.value = 2;
    const g = ctx.createGain(); g.gain.value = 0;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    o1.connect(f); o2.connect(f); f.connect(g);
    if (p) { g.connect(p); p.connect(this.master); } else g.connect(this.master);
    o1.start(); o2.start();
    // газовая турбина: ровный гул и высокий свист компрессора
    const turb = kind === 'turbine';
    if (turb) o2.type = 'sine';
    const base = kind === 'tracked' ? 28 : kind === 'diesel' ? 34 : kind === 'drone' ? 118 : turb ? 40 : 45;
    const fb = kind === 'drone' ? 1600 : turb ? 3200 : 300;
    const eng = {
      set: (rpm01, gain, pos) => {
        const t = ctx.currentTime;
        const fr = base * (1 + rpm01 * 2.2);
        o1.frequency.setTargetAtTime(fr, t, 0.1);
        o2.frequency.setTargetAtTime(turb ? 1900 + rpm01 * 1400 : fr * 0.5, t, 0.1);
        f.frequency.setTargetAtTime(fb + rpm01 * 900, t, 0.1);
        let gg = gain;
        if (pos) { const sp = this._spatial(pos); gg *= sp.gain * 2; if (p) p.pan.setTargetAtTime(sp.pan, t, 0.1); }
        g.gain.setTargetAtTime(Math.min(0.25, gg), t, 0.15);
      },
      stop: () => { try { g.gain.setTargetAtTime(0, ctx.currentTime, 0.1); o1.stop(ctx.currentTime + 0.5); o2.stop(ctx.currentTime + 0.5); } catch (e) { /* */ } this.engines.delete(eng); },
    };
    this.engines.add(eng);
    return eng;
  }
  stopAllEngines() { for (const e of [...this.engines]) e.stop(); }
}
