// Staying in the game while the phone is busy with another app.
//
// Phones pause web pages in the background (iPhones almost right away), which drops the
// connection. Two things help:
//  - a Web Lock while in a room: Chrome doesn't freeze pages that hold one (silent, free);
//  - "Stay connected" (opt-in): a very soft, looping hiss. A page that plays sound keeps
//    running in the background on Android and iPhone, so the connection stays up. It also puts
//    the game in the phone's media controls ("AI Psych — time to vote!"), and a little chime
//    plays when the game needs you. (It can pause music playing on the same phone — hence opt-in.)

import { local } from '../storage.js';

const KEY = 'aipsych.keepAlive';
const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

export const keepAliveSupported = () => typeof Audio !== 'undefined' && coarse();
export const keepAliveWanted = () => !!local.get(KEY, false);

let active = false; // in a room right now
let loop = null;
let chime = null;
let chimeReady = false;
let releaseLock = null;

/** A small 8-bit mono WAV as a data: URL. */
function wav(samples, rate) {
  const n = samples.length;
  const buf = new Uint8Array(44 + n);
  const dv = new DataView(buf.buffer);
  const str = (o, s) => [...s].forEach((c, i) => (buf[o + i] = c.charCodeAt(0)));
  str(0, 'RIFF');
  dv.setUint32(4, 36 + n, true);
  str(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate, true);
  dv.setUint16(32, 1, true);
  dv.setUint16(34, 8, true);
  str(36, 'data');
  dv.setUint32(40, n, true);
  buf.set(samples, 44);
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return 'data:audio/wav;base64,' + btoa(bin);
}

function hiss() {
  // Barely-there noise: 1 step of 8 bits. Real sound (so the phone keeps the page running), but you'd need to press your ear to the speaker.
  const rate = 8000;
  const s = new Uint8Array(rate * 2);
  for (let i = 0; i < s.length; i++) s[i] = 128 + (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.6 ? 1 : 0);
  return wav(s, rate);
}

function ding() {
  const rate = 22050;
  const notes = [[880, 0.14], [1320, 0.32]];
  const total = notes.reduce((t, [, d]) => t + d, 0);
  const s = new Uint8Array(Math.round(rate * total));
  let o = 0;
  for (const [f, d] of notes) {
    const len = Math.round(rate * d);
    for (let i = 0; i < len; i++) {
      const env = Math.min(1, i / 200) * Math.exp((-4 * i) / len);
      s[o + i] = 128 + Math.round(70 * env * Math.sin((2 * Math.PI * f * i) / rate));
    }
    o += len;
  }
  return wav(s, rate);
}

function setMedia(title, artist = 'Tap to go back to the game') {
  try {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    navigator.mediaSession.metadata = new MediaMetadata({ title, artist, album: 'AI Psych', artwork: [{ src: 'assets/icon.svg', sizes: 'any', type: 'image/svg+xml' }] });
  } catch {
    /* ignore */
  }
}

function start() {
  if (!keepAliveSupported()) return;
  try {
    loop ||= Object.assign(new Audio(hiss()), { loop: true });
    if (loop.paused) loop.play().catch(() => {});
    setMedia('AI Psych — game on 🎲');
  } catch {
    /* not allowed yet: the next tap starts it */
  }
}

function stop() {
  if (loop && !loop.paused) loop.pause();
}

function holdLock(on) {
  if (on && !releaseLock && navigator.locks && navigator.locks.request) {
    navigator.locks
      .request('aipsych-game', () => new Promise((res) => (releaseLock = res)))
      .catch(() => {});
  } else if (!on && releaseLock) {
    releaseLock();
    releaseLock = null;
  }
}

/** In a room (or not). */
export function setInRoom(on) {
  active = on;
  holdLock(on);
  if (on && keepAliveWanted()) start();
  else stop();
}

/** The toggle (call it from a tap: phones only start sound after a tap). */
export function setKeepAlive(on) {
  local.set(KEY, on);
  primeChime();
  if (on && active) start();
  else stop();
}

function primeChime() {
  if (chimeReady || !keepAliveSupported()) return;
  try {
    chime ||= new Audio(ding());
    chime.muted = true;
    chime
      .play()
      .then(() => {
        chime.pause();
        chime.currentTime = 0;
        chime.muted = false;
        chimeReady = true;
      })
      .catch(() => {});
  } catch {
    /* ignore */
  }
}

/** The game needs this player (they're in another app): show it in the media controls and chime. */
export function needYou(title) {
  if (!keepAliveWanted() || !loop || loop.paused) return;
  setMedia(title);
  if (chime && chimeReady) {
    chime.currentTime = 0;
    chime.play().catch(() => {});
  }
}

/** Back in the game: the media controls go back to normal. */
export function seenYou() {
  if (loop && !loop.paused) setMedia('AI Psych — game on 🎲');
}

export function installKeepAlive() {
  // Phones only allow sound after a tap: (re)start on the next one when it's wanted.
  addEventListener(
    'pointerup',
    () => {
      if (!keepAliveWanted() || !active) return;
      primeChime();
      if (!loop || loop.paused) start();
    },
    { passive: true },
  );
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') seenYou();
  });
}
