// Small, dependency-free helpers shared by the engine, network and UI.

let rng = Math.random;

/** Swap the random source (used by tests for deterministic games). */
export function setRandom(fn) {
  rng = fn || Math.random;
}

export function random() {
  return rng();
}

export function randInt(min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

export function pick(arr) {
  return arr[Math.floor(rng() * arr.length)];
}

export function shuffle(arr, rand = rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789';

/** Random id. Uses crypto when available so ids never collide across devices. */
export function uid(len = 10) {
  let out = '';
  const c = globalThis.crypto;
  if (c && c.getRandomValues && rng === Math.random) {
    const bytes = new Uint8Array(len);
    c.getRandomValues(bytes);
    for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
    return out;
  }
  for (let i = 0; i < len; i++) out += ALPHABET[Math.floor(rng() * ALPHABET.length)];
  return out;
}

/** 53-bit string hash (cyrb53) rendered base36 — stable question ids. */
export function hash(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Deterministic PRNG (mulberry32) seeded from a string. */
export function seeded(seedStr) {
  let a = parseInt(hash(String(seedStr)).slice(0, 8), 36) >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function normName(name) {
  return String(name || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function cleanText(text, max) {
  let t = String(text ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (max && t.length > max) t = t.slice(0, max);
  return t;
}
