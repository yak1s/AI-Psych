// Staying in the game while the phone is busy with another app.
//
// Phones pause web pages in the background (iPhones almost right away), which drops the
// connection. Two things help:
//  - a Web Lock while in a room: Chrome doesn't freeze pages that hold one (silent, free);
//  - "Stay connected" (opt-in): the page keeps "playing" a sound nobody can hear. A page that
//    plays sound keeps running in the background on Android and iPhone, so the connection stays
//    up. The game also shows up in the phone's media controls ("AI Psych — time to vote!"),
//    and a short chime plays when the game needs you. While it's on, the game holds the phone's
//    audio, so other apps can't play sound at the same time.
//
// The inaudible bed: a 30 Hz tone at about -68 dB below full scale.
//  - 30 Hz is far below what a phone speaker can physically play (and at this level far below
//    what ears can hear even in earbuds at full volume).
//  - It can't be much quieter: Chrome counts anything under about -72 dB as silence, and a
//    "silent" page is treated like any other background page (frozen, then dropped).
//  - 12 seconds long: Android Chrome only gives sounds of 5+ seconds a proper media session
//    (the media notification that keeps the page alive). The tone fits the loop exactly
//    (360 whole waves), so the loop point has no click.

import { local } from '../storage.js';
import { isMuted } from './audio.js';

const KEY = 'aipsych.keepAlive';
const LOG = 'aipsych.keepAliveLog';
const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

export const keepAliveSupported = () => typeof Audio !== 'undefined' && coarse();
export const keepAliveWanted = () => !!local.get(KEY, false);

let active = false; // in a room right now
let bed = null;
let ours = false; // we paused it on purpose
let userPaused = false; // paused from the phone's media controls: wait until they're back in the game
let retries = [];
let releaseLock = null;
const calls = {}; // kind -> { el, ready }

/** What happened to the background sound (kept on the device, for troubleshooting). */
function log(event) {
  try {
    const list = local.get(LOG, []);
    list.push([new Date().toISOString().slice(5, 19), event, document.visibilityState]);
    local.set(LOG, list.slice(-40));
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Sound files, made on the device (no downloads)

function wav16(samples, rate) {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const dv = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  dv.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  str(36, 'data');
  dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.max(-32767, Math.min(32767, Math.round(samples[i] * 32767))), true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

function bedSound() {
  const rate = 8000;
  const secs = 12;
  const f = 30; // 30 Hz × 12 s = 360 whole waves: a seamless loop
  const amp = 5.6e-4; // ≈ -68 dB RMS: just above where Chrome would call it silence
  const s = new Float32Array(rate * secs);
  for (let i = 0; i < s.length; i++) s[i] = amp * Math.sin((2 * Math.PI * f * i) / rate);
  return wav16(s, rate);
}

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

/** The "come back!" sounds, in the game's own style, rendered once into little files. */
const CALLS = {
  // a new question for you: the game's sparkly "magic" run, landing on a bright note
  turn: (t) => {
    [72, 76, 79, 84, 88].forEach((n, i) => t({ type: 'sine', f: NOTE(n), at: i * 0.07, dur: 0.28, vol: 0.16 }));
    t({ type: 'triangle', f: NOTE(91), at: 0.36, dur: 0.6, vol: 0.18 });
  },
  // time to vote: a friendly two-note "ding-dong" bell
  vote: (t) => {
    for (const [n, at] of [[88, 0], [81, 0.32]]) {
      t({ type: 'sine', f: NOTE(n), at, dur: 0.9, vol: 0.26 });
      t({ type: 'sine', f: NOTE(n) * 2.01, at, dur: 0.45, vol: 0.06 });
      t({ type: 'triangle', f: NOTE(n - 12), at, dur: 0.5, vol: 0.08 });
    }
  },
  // everybody is waiting for you: the game's cheeky "boing" plus a little knock-knock
  waiting: (t) => {
    t({ type: 'sine', f: 160, f1: 520, at: 0, dur: 0.45, vol: 0.28, vib: 45, vibRate: 16 });
    t({ type: 'triangle', f: NOTE(79), at: 0.5, dur: 0.12, vol: 0.2 });
    t({ type: 'triangle', f: NOTE(84), at: 0.64, dur: 0.12, vol: 0.2 });
    t({ type: 'triangle', f: NOTE(91), at: 0.78, dur: 0.35, vol: 0.2 });
  },
  // results / winner: a short fanfare
  news: (t) => {
    [76, 79, 84, 88].forEach((n, i) => t({ type: 'square', f: NOTE(n), at: i * 0.07, dur: 0.14, vol: 0.07 }));
    t({ type: 'triangle', f: NOTE(91), at: 0.28, dur: 0.55, vol: 0.16 });
  },
};

async function renderCall(kind) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) return null;
  const rate = 22050;
  const c = new OAC(1, Math.round(rate * 1.4), rate);
  const tone = ({ type, f, f1, at, dur, vol, vib = 0, vibRate = 6 }) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, at);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, at + dur);
    if (vib) {
      const l = c.createOscillator();
      const lg = c.createGain();
      l.frequency.value = vibRate;
      lg.gain.value = vib;
      l.connect(lg).connect(o.frequency);
      l.start(at);
      l.stop(at + dur + 0.05);
    }
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(c.destination);
    o.start(at);
    o.stop(at + dur + 0.05);
  };
  CALLS[kind](tone);
  const buf = c.startRendering ? await c.startRendering() : null;
  if (!buf) return null;
  // Same loudness for every chime (peak about -8 dB: clear, not harsh).
  const d = buf.getChannelData(0);
  let peak = 0;
  for (const v of d) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let i = 0; i < d.length; i++) d[i] *= 0.4 / peak;
  return wav16(d, rate);
}

// ---------------------------------------------------------------------------

function setMedia(title, artist = 'Tap to go back to the game') {
  try {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    navigator.mediaSession.metadata = new MediaMetadata({ title, artist, album: 'AI Psych', artwork: [{ src: 'assets/icon.svg', sizes: 'any', type: 'image/svg+xml' }] });
    navigator.mediaSession.playbackState = 'playing';
  } catch {
    /* ignore */
  }
}

function makeBed() {
  bed = new Audio(bedSound());
  bed.loop = true;
  bed.preload = 'auto';
  // Stopped by the phone (another app took the sound, the system, a glitch): try to start it
  // again — once. If it keeps getting stopped, leave it until the player is back in the game,
  // rather than fighting another app over the speaker.
  bed.addEventListener('pause', () => {
    if (ours || userPaused || !active || !keepAliveWanted()) return;
    log('stopped by the phone');
    const now = Date.now();
    retries = retries.filter((t) => now - t < 30000);
    if (retries.length >= 2) return log('gave up until back in the game');
    retries.push(now);
    setTimeout(() => play('auto-restart'), 800);
  });
  bed.addEventListener('playing', () => log('playing'));
  try {
    navigator.mediaSession.setActionHandler('pause', () => {
      userPaused = true;
      ours = true;
      bed.pause();
      ours = false;
      navigator.mediaSession.playbackState = 'paused';
      log('paused from the media controls');
    });
    navigator.mediaSession.setActionHandler('play', () => {
      userPaused = false;
      play('play from the media controls');
    });
  } catch {
    /* ignore */
  }
}

function play(why) {
  if (!keepAliveSupported() || !active || !keepAliveWanted() || userPaused) return;
  if (!bed) makeBed();
  if (!bed.paused) return;
  bed.play().then(
    () => {
      log('started: ' + why);
      setMedia('AI Psych — game on 🎲');
    },
    (e) => log(`couldn't start (${why}): ${e && e.name}`),
  );
}

function stop() {
  if (!bed || bed.paused) return;
  ours = true;
  bed.pause();
  ours = false;
}

function holdLock(on) {
  if (on && !releaseLock && navigator.locks && navigator.locks.request) {
    navigator.locks.request('aipsych-game', () => new Promise((res) => (releaseLock = res))).catch(() => {});
  } else if (!on && releaseLock) {
    releaseLock();
    releaseLock = null;
  }
}

/** In a room (or not). */
export function setInRoom(on) {
  active = on;
  holdLock(on);
  if (on) makeCalls();
  if (on && keepAliveWanted()) play('in a room');
  else stop();
}

/** The toggle (call it from a tap: phones only start sound after a tap). */
export function setKeepAlive(on) {
  local.set(KEY, on);
  log(on ? 'turned on' : 'turned off');
  userPaused = false;
  if (on) {
    primeCalls();
    play('turned on');
  } else stop();
}

/** Render the chimes ahead of time, so a tap can unlock them right away. */
function makeCalls() {
  if (!keepAliveSupported()) return;
  for (const kind of Object.keys(CALLS)) {
    const c = (calls[kind] ||= { el: null, ready: false, making: null });
    if (c.el || c.making) continue;
    c.making = renderCall(kind)
      .then((url) => {
        if (!url) return;
        c.el = new Audio(url);
        c.el.preload = 'auto';
        c.url = url;
      })
      .catch(() => {});
  }
}

/** Phones only let a page play a sound it has played once after a tap: unlock the chimes silently. */
function primeCalls() {
  if (!keepAliveSupported()) return;
  for (const kind of Object.keys(CALLS)) {
    const c = (calls[kind] ||= { el: null, ready: false, making: null });
    if (c.ready) continue;
    const unlock = () => {
      c.el.muted = true;
      c.el.play().then(
        () => {
          c.el.pause();
          c.el.currentTime = 0;
          c.el.muted = false;
          c.ready = true;
        },
        () => {},
      );
    };
    if (c.el) unlock();
    else makeCalls();
  }
}

const TITLES = { turn: '✏️ Your turn to answer', vote: '🗳️ Time to vote!', waiting: '⏰ Everyone is waiting for you', news: '📊 The results are in' };

/** The game needs this player (they left the app): show it in the media controls and chime. */
export function needYou(kind = 'turn', title = TITLES[kind]) {
  if (!keepAliveWanted() || !bed || bed.paused) return;
  setMedia(title);
  const c = calls[kind];
  if (!c || !c.ready || isMuted()) return;
  c.el.currentTime = 0;
  c.el.play().catch(() => {});
}

export function installKeepAlive() {
  // Phones only allow sound after a tap: (re)start on the next one when it's wanted.
  addEventListener(
    'pointerup',
    () => {
      if (!keepAliveWanted() || !active) return;
      primeCalls();
      play('tap');
    },
    { passive: true },
  );
  // Back in the game: start again if the phone stopped it, and reset the media controls.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    userPaused = false;
    retries = [];
    if (bed && !bed.paused) setMedia('AI Psych — game on 🎲');
    else play('back in the game');
  });
}

/** For tests and troubleshooting: is the background sound playing, and what happened to it. */
export function keepAliveState() {
  return {
    wanted: keepAliveWanted(),
    active,
    playing: !!(bed && !bed.paused),
    duration: bed ? bed.duration : null,
    bedUrl: bed ? bed.src : null,
    chimeUrls: Object.fromEntries(Object.entries(calls).map(([k, c]) => [k, c.url || null])),
    chimes: Object.fromEntries(Object.entries(calls).map(([k, c]) => [k, !!c.ready])),
    log: local.get(LOG, []),
  };
}

/** Tests only: what the phone does when it stops background sound. */
export function _phoneStops() {
  if (bed) bed.pause();
}
