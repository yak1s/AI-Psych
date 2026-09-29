// Procedural watercolor + hand-drawn art. Watercolor washes are small SVGs with
// turbulence filters, rendered once into data-URIs and cached, so browsers
// rasterize them a single time (smooth animations even on older phones).

import { html } from '../vendor/preact-htm.js';
import { seeded } from '../game/util.js';

export const PALETTE = {
  coral: '#ff7b6b',
  sky: '#58b4f2',
  sun: '#ffc93c',
  mint: '#43d1a3',
  grape: '#a27cf2',
  bubblegum: '#ff8cc6',
  tangerine: '#ff9d42',
  leaf: '#8fd45a',
  paper: '#fffaf0',
  ink: '#2d2a4a',
  plum: '#5b2a86',
  blood: '#c8414b',
  teal: '#1f7a82',
  night: '#3a2d5c',
};

export function colorOf(name) {
  return PALETTE[name] || name || PALETTE.sun;
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const mix = amt < 0 ? 0 : 255;
  const t = Math.abs(amt);
  const ch = (v) => Math.round(v + (mix - v) * t);
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

/** Smooth organic closed path through jittered points on an ellipse. */
export function blobPath(rand, cx, cy, rx, ry, points = 9, irregular = 0.3) {
  const pts = [];
  const off = rand() * Math.PI * 2;
  for (let i = 0; i < points; i++) {
    const a = off + (i / points) * Math.PI * 2 + (rand() - 0.5) * 0.35;
    const k = 1 - irregular / 2 + rand() * irregular;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  const f = (v) => v.toFixed(1);
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < points; i++) {
    const p0 = pts[(i - 1 + points) % points];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % points];
    const p3 = pts[(i + 2) % points];
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)},${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)},${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])},${f(p2[1])}`;
  }
  return d + 'Z';
}

function filterDef(seed, warp, displace) {
  return (
    `<filter id='w' x='-15%' y='-15%' width='130%' height='130%'>` +
    `<feTurbulence type='fractalNoise' baseFrequency='${warp}' numOctaves='3' seed='${seed}' result='t'/>` +
    `<feDisplacementMap in='SourceGraphic' in2='t' scale='${displace}' xChannelSelector='R' yChannelSelector='G' result='d'/>` +
    `<feTurbulence type='fractalNoise' baseFrequency='0.7' numOctaves='2' seed='${seed + 7}' result='g'/>` +
    `<feColorMatrix in='g' type='matrix' values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 -1.1 1.35' result='m'/>` +
    `<feComposite in='d' in2='m' operator='in' result='c'/>` +
    `<feGaussianBlur in='c' stdDeviation='0.5'/>` +
    `</filter>`
  );
}

const cache = new Map();

function toUri(svg) {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * A rectangular-ish watercolor wash for buttons/cards.
 * @param {string} color palette name or hex
 */
export function wash(color, seed = 1, { w = 200, h = 100, strength = 1 } = {}) {
  const key = `wash:${color}:${seed}:${w}:${h}:${strength}`;
  if (cache.has(key)) return cache.get(key);
  const hex = colorOf(color);
  const rand = seeded(key);
  // Painted "inside the lines, a bit sloppy": fills the shape with uneven pigment,
  // lighter blooms, a darker pooled edge and paper showing through at the corners.
  const main = blobPath(rand, w / 2, h / 2, w * 0.54, h * 0.56, 12, 0.08);
  const bloom = blobPath(rand, w * (0.3 + rand() * 0.4), h * (0.35 + rand() * 0.3), w * 0.26, h * 0.34, 8, 0.45);
  const bloom2 = blobPath(rand, w * (0.15 + rand() * 0.7), h * (0.3 + rand() * 0.4), w * 0.14, h * 0.24, 7, 0.5);
  const pool = blobPath(rand, w * (0.2 + rand() * 0.6), h * (0.55 + rand() * 0.2), w * 0.3, h * 0.18, 8, 0.4);
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}' preserveAspectRatio='none'>` +
    filterDef(Math.floor(rand() * 100), 0.03, 8) +
    `<g filter='url(#w)'>` +
    `<path d='${main}' fill='${hex}' fill-opacity='${0.6 * strength}'/>` +
    `<path d='${pool}' fill='${shade(hex, -0.15)}' fill-opacity='${0.25 * strength}'/>` +
    `<path d='${bloom}' fill='${shade(hex, 0.45)}' fill-opacity='${0.55 * strength}'/>` +
    `<path d='${bloom2}' fill='${shade(hex, -0.2)}' fill-opacity='${0.22 * strength}'/>` +
    `<path d='${main}' fill='none' stroke='${shade(hex, -0.3)}' stroke-width='3' stroke-opacity='${0.4 * strength}'/>` +
    `</g></svg>`;
  const uri = toUri(svg);
  cache.set(key, uri);
  return uri;
}

/** Very soft paper tint for cards: a few pale clouds of pigment, no hard edges. */
export function paperWash(seed = 1) {
  const key = `paper:${seed}`;
  if (cache.has(key)) return cache.get(key);
  const rand = seeded(key);
  const tints = ['#ffe7a8', '#ffd6e4', '#d5ecff', '#e3f7df'];
  let blobs = '';
  for (let i = 0; i < 4; i++) {
    const d = blobPath(rand, 20 + rand() * 160, 10 + rand() * 80, 40 + rand() * 30, 22 + rand() * 18, 8, 0.5);
    blobs += `<path d='${d}' fill='${tints[i % tints.length]}' fill-opacity='.35'/>`;
  }
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 100' preserveAspectRatio='none'>` +
    `<filter id='b' x='-20%' y='-20%' width='140%' height='140%'><feTurbulence type='fractalNoise' baseFrequency='0.04' numOctaves='3' seed='${seed}'/>` +
    `<feDisplacementMap in='SourceGraphic' scale='14' xChannelSelector='R' yChannelSelector='G'/><feGaussianBlur stdDeviation='3'/></filter>` +
    `<g filter='url(#b)'>${blobs}</g></svg>`;
  const uri = toUri(svg);
  cache.set(key, uri);
  return uri;
}

/** A round splotch (avatars, backdrop, splashes). */
export function splotch(color, seed = 1, { strength = 1, irregular = 0.32 } = {}) {
  const key = `splotch:${color}:${seed}:${strength}:${irregular}`;
  if (cache.has(key)) return cache.get(key);
  const hex = colorOf(color);
  const rand = seeded(key);
  const main = blobPath(rand, 100, 100, 84, 84, 9, irregular);
  const inner = blobPath(rand, 90 + rand() * 20, 88 + rand() * 20, 52, 50, 8, 0.45);
  const dot = blobPath(rand, 60 + rand() * 80, 60 + rand() * 80, 18, 16, 6, 0.5);
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'>` +
    filterDef(Math.floor(rand() * 100), 0.025, 14) +
    `<g filter='url(#w)'>` +
    `<path d='${main}' fill='${hex}' fill-opacity='${0.55 * strength}'/>` +
    `<path d='${inner}' fill='${shade(hex, 0.4)}' fill-opacity='${0.45 * strength}'/>` +
    `<path d='${dot}' fill='${shade(hex, -0.2)}' fill-opacity='${0.3 * strength}'/>` +
    `<path d='${main}' fill='none' stroke='${shade(hex, -0.3)}' stroke-width='3' stroke-opacity='${0.4 * strength}'/>` +
    `</g></svg>`;
  const uri = toUri(svg);
  cache.set(key, uri);
  return uri;
}

/** A brush stroke (for highlights, score bars, underlines). */
export function brush(color, seed = 1) {
  const key = `brush:${color}:${seed}`;
  if (cache.has(key)) return cache.get(key);
  const hex = colorOf(color);
  const rand = seeded(key);
  const y = () => (20 + rand() * 6).toFixed(1);
  const d = `M4,${y()} C40,${10 + rand() * 6} 90,${14 + rand() * 6} 150,${12 + rand() * 6} S 190,${14 + rand() * 8} 196,${y()} C170,${34 + rand() * 4} 110,${32 + rand() * 6} 60,${34 + rand() * 4} S 10,${32 + rand() * 4} 4,${y()}Z`;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 44' preserveAspectRatio='none'>` +
    filterDef(Math.floor(rand() * 100), 0.04, 6) +
    `<g filter='url(#w)'><path d='${d}' fill='${hex}' fill-opacity='.7'/>` +
    `<path d='${d}' fill='none' stroke='${shade(hex, -0.25)}' stroke-width='1.6' stroke-opacity='.5'/></g></svg>`;
  const uri = toUri(svg);
  cache.set(key, uri);
  return uri;
}

function paperTexture() {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='260' height='260'>` +
    `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/>` +
    `<feColorMatrix values='0 0 0 0 .38 0 0 0 0 .3 0 0 0 0 .2 0 0 0 .11 0'/></filter>` +
    `<filter id='f'><feTurbulence type='fractalNoise' baseFrequency='.018 .06' numOctaves='2' seed='4' stitchTiles='stitch'/>` +
    `<feColorMatrix values='0 0 0 0 .5 0 0 0 0 .4 0 0 0 0 .25 0 0 0 .07 0'/></filter>` +
    `<rect width='100%' height='100%' filter='url(#n)'/><rect width='100%' height='100%' filter='url(#f)'/></svg>`;
  return toUri(svg);
}

/** Install global CSS variables for washes so plain CSS classes can use them. */
export function installArt() {
  const root = document.documentElement.style;
  root.setProperty('--paper-texture', paperTexture());
  for (const name of ['coral', 'sky', 'sun', 'mint', 'grape', 'bubblegum', 'tangerine', 'leaf', 'paper']) {
    root.setProperty(`--wash-${name}`, wash(name, 3));
    root.setProperty(`--wash-${name}-2`, wash(name, 11));
    root.setProperty(`--splotch-${name}`, splotch(name, 5));
    root.setProperty(`--brush-${name}`, brush(name, 2));
  }
  root.setProperty('--wash-card', paperWash(21));
}

// ---------------------------------------------------------------------------
// Doodles (inline SVG, hand-drawn look)

const S = (children, { size = 28, cls = '', vb = '0 0 48 48', sw = 3 } = {}) => html`
  <svg class=${'doodle ' + cls} width=${size} height=${size} viewBox=${vb} fill="none" stroke="currentColor"
       stroke-width=${sw} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${children}</svg>`;

export const Doodle = {
  star: (o) => S(html`<path d="M24 5l5.5 12.2 13 1.4-9.8 8.8 2.9 13-11.6-6.8-11.5 6.9 2.7-13L5.4 18.8l13.1-1.5z"/>`, o),
  spark: (o) => S(html`<path d="M24 6v10M24 32v10M6 24h10M32 24h10M12 12l6 6M30 30l6 6M36 12l-6 6M18 30l-6 6"/>`, o),
  spiral: (o) => S(html`<path d="M25 24c0-2-3-2.5-4-.5-1.4 2.8 2.3 5.5 5 4.6 4.6-1.5 4.6-8 .6-10.4-5.4-3.2-12 .4-12.6 6.4-.8 7.3 6.2 12.3 13 10.6 8.7-2.1 11.4-13 6.4-19.9"/>`, o),
  heart: (o) => S(html`<path d="M24 40C12 31 6 24 7 16.5 8 10 16 7.5 20 12c1.8 2 3 4 4 6 1-2.2 2.4-4.4 4.4-6.2 4.6-4 12.1-1.3 12.6 5.2.6 7.6-5.5 14.3-17 23z"/>`, o),
  question: (o) => S(html`<path d="M16 16c0-6 4.5-9 9-8.6 5 .4 8.2 4 7.6 8.4-.7 5-6.4 6.3-8 10.3-.6 1.5-.6 3-.6 4.4"/><path d="M24 38.5v.5"/>`, o),
  check: (o) => S(html`<path d="M9 25.5c3.2 2.7 6 6 8.2 9.7C22 25 29.4 16.4 40 9.5"/>`, o),
  cross: (o) => S(html`<path d="M12 12c8 7.6 16.3 16 24 24.6M36 11.5C27.7 19.6 19.8 27.6 12 36"/>`, o),
  pencil: (o) => S(html`<path d="M10 38l2.4-8.6L32.8 9c1.7-1.7 4.4-1.6 6 .1 1.6 1.7 1.6 4.3 0 6L18.5 35.6z"/><path d="M29 13l6 6M12.4 29.4l6 6"/>`, o),
  crown: (o) => S(html`<path d="M8 36l-2-20 10 8 8-14 8 14 10-8-2 20z"/><path d="M8 41h32"/>`, o),
  arrow: (o) => S(html`<path d="M6 26c10-1.6 22-2 34-1.4"/><path d="M30 15c4 3.8 7 7 10.4 10-3.4 3-6.5 6.4-9.4 10"/>`, o),
  wifi: (o) => S(html`<path d="M6 19c11-9.5 25-9.5 36 0M12 26c7.4-6 16.6-6 24 0M18 33c3.8-3 8.2-3 12 0"/><path d="M24 39.5v.5"/>`, o),
  speaker: (o) => S(html`<path d="M8 19h7l10-8v26l-10-8H8z"/><path d="M31 18c2.5 3.4 2.5 8.6 0 12M36 13c5 6 5 16 0 22"/>`, o),
  muted: (o) => S(html`<path d="M8 19h7l10-8v26l-10-8H8z"/><path d="M32 19l9 10M41 19l-9 10"/>`, o),
  clock: (o) => S(html`<path d="M24 7c10 0 17.5 7.7 17 17.6-.5 9.4-8.4 16.4-17.6 16C14 40 7 32.6 7.2 23.4 7.4 14 14.6 7 24 7z"/><path d="M24 14v10.5l7 4"/>`, o),
  skip: (o) => S(html`<path d="M9 11l15 13-15 13zM25 11l14 13-14 13"/>`, o),
  door: (o) => S(html`<path d="M12 42V8.5c7.8-1 15.6-1 23.5 0V42"/><path d="M6 42h36M29 25v1"/>`, o),
  upload: (o) => S(html`<path d="M24 32V9M14 18c3.6-3.4 6.8-6.6 10-9.6 3.4 3 6.6 6.2 10 9.6"/><path d="M8 32v7.5h32V32"/>`, o),
  copy: (o) => S(html`<path d="M16 16h22v24H16z"/><path d="M10 32V8.5h22"/>`, o),
  qr: (o) => S(html`<path d="M8 8h12v12H8zM28 8h12v12H28zM8 28h12v12H8zM28 28h4M36 28h4v4M28 36v4h4M36 36h4v4"/>`, o),
  menu: (o) => S(html`<path d="M9 14c10-.8 20-.8 30 0M9 24.5c10-.6 20-.6 30 0M9 35c10-.8 20-.8 30 0"/>`, o),
  gavel: (o) => S(html`<path d="M20 8l12 12M14 14l12 12M17 11l12 12M23 23l15 15"/><path d="M8 40h16"/>`, o),
  eye: (o) => S(html`<path d="M4 24c10-13 30-13 40 0-10 13-30 13-40 0z"/><circle cx="24" cy="24" r="6"/>`, o),
  back: (o) => S(html`<path d="M40 24c-10 .6-20 .4-31 0"/><path d="M19 13c-3.8 4-7 7.4-10 11 3 3.4 6.2 7 10 11"/>`, o),
};

/** Ambient floating doodles scattered around the page edges. */
export function Scatter({ count = 10, seed = 'scatter' }) {
  const rand = seeded(seed);
  const kinds = ['star', 'spiral', 'heart', 'question', 'spark', 'eye'];
  const colors = ['coral', 'sky', 'grape', 'mint', 'tangerine', 'bubblegum'];
  const items = [];
  for (let i = 0; i < count; i++) {
    const side = i % 2 ? rand() * 14 : 86 + rand() * 12;
    items.push({
      kind: kinds[Math.floor(rand() * kinds.length)],
      color: colors[Math.floor(rand() * colors.length)],
      left: side,
      top: 4 + rand() * 90,
      size: 22 + rand() * 26,
      delay: -rand() * 12,
      dur: 9 + rand() * 8,
      rot: (rand() - 0.5) * 40,
    });
  }
  return html`<div class="scatter" aria-hidden="true">
    ${items.map(
      (it, i) => html`<span key=${i} class="scatter-item" style=${`left:${it.left}%;top:${it.top}%;color:${colorOf(it.color)};--rot:${it.rot}deg;animation-delay:${it.delay}s;animation-duration:${it.dur}s`}>
        ${Doodle[it.kind]({ size: it.size })}
      </span>`,
    )}
  </div>`;
}
