// All sounds are synthesized with the Web Audio API — no audio files to load,
// works offline, and every device can mute itself (remembered per device).

import { local, KEYS } from '../storage.js';

let ctx = null;
let master = null;
let muted = !!local.get(KEYS.muted, false);
const listeners = new Set();

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp);
    comp.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** Browsers only allow audio after a user gesture; call on first tap. */
export function unlockAudio() {
  const once = () => {
    const c = ac();
    if (c) {
      const b = c.createBuffer(1, 1, 22050);
      const s = c.createBufferSource();
      s.buffer = b;
      s.connect(c.destination);
      s.start(0);
    }
  };
  addEventListener('pointerdown', once, { passive: true });
  addEventListener('keydown', once);
}

export function isMuted() {
  return muted;
}

export function setMuted(m) {
  muted = !!m;
  local.set(KEYS.muted, muted);
  listeners.forEach((fn) => fn(muted));
}

export function onMuteChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------------------------------------------------------------------------
// Primitives

function env(g, t, { attack = 0.005, peak = 0.3, hold = 0, decay = 0.2 }) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.setValueAtTime(peak, t + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + decay);
  return t + attack + hold + decay;
}

function tone(c, { type = 'sine', f0 = 440, f1, at = 0, dur = 0.2, vol = 0.3, attack = 0.005, vibrato = 0, vibRate = 6, dest = master, glide = 'exp' }) {
  const t = c.currentTime + at;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1) {
    if (glide === 'exp') o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    else o.frequency.linearRampToValueAtTime(f1, t + dur);
  }
  if (vibrato) {
    const l = c.createOscillator();
    const lg = c.createGain();
    l.frequency.value = vibRate;
    lg.gain.value = vibrato;
    l.connect(lg).connect(o.frequency);
    l.start(t);
    l.stop(t + dur + 0.1);
  }
  o.connect(g).connect(dest);
  const end = env(g, t, { attack, peak: vol, decay: Math.max(0.02, dur - attack) });
  o.start(t);
  o.stop(end + 0.05);
}

let noiseBuf = null;
function noise(c, { at = 0, dur = 0.2, vol = 0.2, type = 'bandpass', f0 = 1000, f1, q = 1, attack = 0.003 }) {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = c.currentTime + at;
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  const f = c.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = c.createGain();
  s.connect(f).connect(g).connect(master);
  const end = env(g, t, { attack, peak: vol, decay: Math.max(0.02, dur - attack) });
  s.start(t, Math.random() * 0.5);
  s.stop(end + 0.05);
}

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

// ---------------------------------------------------------------------------
// The sound board

const SOUNDS = {
  tap: (c) => tone(c, { type: 'triangle', f0: 900, f1: 520, dur: 0.07, vol: 0.18 }),
  pop: (c) => {
    tone(c, { type: 'sine', f0: 380, f1: 1100, dur: 0.1, vol: 0.32 });
    tone(c, { type: 'sine', f0: 1500, dur: 0.05, vol: 0.06, at: 0.05 });
  },
  boing: (c) => tone(c, { type: 'sine', f0: 160, f1: 520, dur: 0.45, vol: 0.3, vibrato: 45, vibRate: 16 }),
  join: (c) => {
    SOUNDS.boing(c);
    tone(c, { type: 'triangle', f0: NOTE(79), dur: 0.12, vol: 0.14, at: 0.18 });
    tone(c, { type: 'triangle', f0: NOTE(84), dur: 0.2, vol: 0.14, at: 0.28 });
  },
  whoosh: (c) => noise(c, { type: 'bandpass', f0: 300, f1: 3200, dur: 0.38, vol: 0.22, q: 0.8, attack: 0.12 }),
  swish: (c) => noise(c, { type: 'highpass', f0: 1800, f1: 5000, dur: 0.12, vol: 0.12, attack: 0.02 }),
  card: (c) => {
    noise(c, { type: 'highpass', f0: 2500, dur: 0.07, vol: 0.2 });
    tone(c, { type: 'triangle', f0: 700 + Math.random() * 300, f1: 400, dur: 0.06, vol: 0.08, at: 0.02 });
  },
  ding: (c) => {
    tone(c, { type: 'sine', f0: 1318.5, dur: 0.9, vol: 0.22 });
    tone(c, { type: 'sine', f0: 1975.5, dur: 0.6, vol: 0.1 });
    tone(c, { type: 'sine', f0: 2637, dur: 0.35, vol: 0.05 });
  },
  submit: (c) => {
    SOUNDS.swish(c);
    tone(c, { type: 'triangle', f0: NOTE(76), dur: 0.1, vol: 0.2, at: 0.05 });
    tone(c, { type: 'triangle', f0: NOTE(83), dur: 0.25, vol: 0.2, at: 0.14 });
  },
  coin: (c) => {
    tone(c, { type: 'square', f0: 987.8, dur: 0.08, vol: 0.09 });
    tone(c, { type: 'square', f0: 1318.5, dur: 0.35, vol: 0.09, at: 0.08 });
  },
  bigCoin: (c) => {
    [76, 79, 84, 88].forEach((n, i) => tone(c, { type: 'square', f0: NOTE(n), dur: 0.14, vol: 0.08, at: i * 0.07 }));
    tone(c, { type: 'triangle', f0: NOTE(91), dur: 0.5, vol: 0.12, at: 0.28 });
  },
  stamp: (c) => {
    tone(c, { type: 'sine', f0: 150, f1: 45, dur: 0.28, vol: 0.5 });
    noise(c, { type: 'lowpass', f0: 900, dur: 0.12, vol: 0.3 });
  },
  tick: (c) => tone(c, { type: 'sine', f0: 1800, dur: 0.03, vol: 0.12 }),
  tock: (c) => tone(c, { type: 'sine', f0: 1200, dur: 0.04, vol: 0.14 }),
  buzzer: (c) => {
    tone(c, { type: 'sawtooth', f0: 110, dur: 0.7, vol: 0.12 });
    tone(c, { type: 'sawtooth', f0: 116.5, dur: 0.7, vol: 0.12 });
  },
  whistleUp: (c) => tone(c, { type: 'sine', f0: 400, f1: 1700, dur: 0.5, vol: 0.2, vibrato: 18, vibRate: 9 }),
  whistleDown: (c) => tone(c, { type: 'sine', f0: 1600, f1: 350, dur: 0.6, vol: 0.2, vibrato: 18, vibRate: 9 }),
  magic: (c) => {
    const scale = [72, 74, 76, 79, 81, 84, 86, 88, 91];
    for (let i = 0; i < 9; i++) tone(c, { type: 'sine', f0: NOTE(scale[Math.floor(Math.random() * scale.length)]), dur: 0.25, vol: 0.09, at: i * 0.075 });
    noise(c, { type: 'highpass', f0: 6000, dur: 0.7, vol: 0.05, attack: 0.2 });
  },
  creepy: (c) => {
    tone(c, { type: 'sine', f0: 330, f1: 520, dur: 1.4, vol: 0.12, attack: 0.3, vibrato: 14, vibRate: 5, glide: 'lin' });
    tone(c, { type: 'sine', f0: 336, f1: 470, dur: 1.4, vol: 0.08, attack: 0.4, vibrato: 10, vibRate: 4.3, glide: 'lin' });
    tone(c, { type: 'triangle', f0: 55, dur: 1.4, vol: 0.12, attack: 0.3 });
  },
  glitch: (c) => {
    for (let i = 0; i < 6; i++) tone(c, { type: 'square', f0: 200 + Math.random() * 1800, dur: 0.03, vol: 0.05, at: i * 0.035 });
  },
  type: (c) => noise(c, { type: 'bandpass', f0: 3000 + Math.random() * 1500, dur: 0.02, vol: 0.05, q: 4 }),
  reveal: (c) => {
    SOUNDS.whoosh(c);
    tone(c, { type: 'triangle', f0: NOTE(84), dur: 0.2, vol: 0.12, at: 0.28 });
  },
  crickets: (c) => {
    for (let i = 0; i < 3; i++) tone(c, { type: 'sine', f0: 4200, dur: 0.05, vol: 0.05, at: i * 0.09, vibrato: 400, vibRate: 60 });
  },
  drumroll: (c, { dur = 2.6 } = {}) => {
    const hits = Math.floor(dur * 22);
    for (let i = 0; i < hits; i++) {
      const p = i / hits;
      noise(c, { type: 'bandpass', f0: 1800, dur: 0.05, vol: 0.05 + p * 0.22, q: 0.7, at: i / 22 });
    }
    // cymbal + boom
    noise(c, { type: 'highpass', f0: 5000, dur: 1.4, vol: 0.28, at: dur, attack: 0.005 });
    tone(c, { type: 'sine', f0: 90, f1: 40, dur: 0.6, vol: 0.5, at: dur });
  },
  fanfare: (c) => {
    const seq = [
      [67, 0, 0.12], [72, 0.13, 0.12], [76, 0.26, 0.12], [79, 0.39, 0.3],
      [76, 0.72, 0.12], [79, 0.86, 0.9],
    ];
    for (const [n, at, d] of seq) {
      tone(c, { type: 'sawtooth', f0: NOTE(n), dur: d, vol: 0.07, at });
      tone(c, { type: 'triangle', f0: NOTE(n), dur: d, vol: 0.14, at, vibrato: d > 0.5 ? 5 : 0 });
    }
    [60, 64, 67].forEach((n) => tone(c, { type: 'triangle', f0: NOTE(n), dur: 1.2, vol: 0.08, at: 0.86 }));
  },
  sadTrombone: (c) => {
    [[55, 0, 0.4], [54, 0.45, 0.4], [53, 0.9, 0.4], [52, 1.35, 1.1]].forEach(([n, at, d]) =>
      tone(c, { type: 'sawtooth', f0: NOTE(n), dur: d, vol: 0.1, at, vibrato: d > 0.5 ? 6 : 1.5, vibRate: 5 }),
    );
  },
  error: (c) => {
    tone(c, { type: 'square', f0: 220, dur: 0.09, vol: 0.08 });
    tone(c, { type: 'square', f0: 180, dur: 0.16, vol: 0.08, at: 0.1 });
  },
  allIn: (c) => {
    [72, 76, 79, 84].forEach((n, i) => tone(c, { type: 'triangle', f0: NOTE(n), dur: 0.18, vol: 0.14, at: i * 0.08 }));
  },
};

export function sfx(name, opts) {
  if (muted) return;
  try {
    const c = ac();
    if (!c || c.state !== 'running') return;
    SOUNDS[name] && SOUNDS[name](c, opts);
  } catch {
    /* never let sound break the game */
  }
}

export function buzz(pattern = 20) {
  if (muted) return;
  try {
    navigator.vibrate && navigator.vibrate(pattern);
  } catch {
    /* ignore */
  }
}
