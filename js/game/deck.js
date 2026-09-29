// Question decks: parsing uploaded files (JSON / TXT / CSV), placeholders and rendering.
//
// A question references players with curly-brace placeholders:
//   {Mom}            -> a "predicted player" from the deck, mapped by the host to someone who joined
//   {any} / {any1}   -> a random player (whoever has been asked about least)
//   {any2}, {any3}   -> more random players, all different from each other and from named ones
// Every player referenced in a question is "about" that question: their vote is worth 2 points.

import { hash, normName, cleanText, clamp } from './util.js';

export const MAX_LEVEL = 5;
export const LEVELS = [
  { n: 1, name: 'Innocent', emoji: '😇' },
  { n: 2, name: 'Curious', emoji: '🤔' },
  { n: 3, name: 'Suspicious', emoji: '🧐' },
  { n: 4, name: 'Creepy', emoji: '😰' },
  { n: 5, name: 'How do they know?!', emoji: '👁️' },
];

export function levelInfo(n) {
  return LEVELS[clamp((n | 0) - 1, 0, LEVELS.length - 1)];
}

const PLACEHOLDER = /\{([^{}]{1,40})\}/g;
const WILD = /^(?:any|random|someone)([1-9]?)$/i;
export const MAX_QUESTION_LENGTH = 280;

/** Returns 0 for named placeholders, or the 1-based wildcard slot. */
function wildSlot(token) {
  const m = WILD.exec(token.trim());
  if (!m) return 0;
  return m[1] ? parseInt(m[1], 10) : 1;
}

/** Break a question template into its placeholder tokens. */
export function analyzeTemplate(text) {
  const named = new Map(); // norm -> display
  const wild = new Set();
  for (const m of text.matchAll(PLACEHOLDER)) {
    const token = m[1].trim();
    const slot = wildSlot(token);
    if (slot) wild.add(slot);
    else if (token) named.set(normName(token), token);
  }
  return { named, wild: [...wild].sort((a, b) => a - b) };
}

export function makeQuestion(text, level, source = 'deck') {
  const clean = cleanText(text, MAX_QUESTION_LENGTH);
  const lvl = clamp(Math.round(Number(level) || 1), 1, MAX_LEVEL);
  const { named, wild } = analyzeTemplate(clean);
  return {
    id: (source === 'deck' ? 'd' : 's') + hash(lvl + '|' + clean.toLowerCase()),
    text: clean,
    level: lvl,
    refs: [...named.keys()],
    wild,
  };
}

// ---------------------------------------------------------------------------
// Parsing

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === ';' || c === '\t') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function fromJson(data, res) {
  let items = [];
  if (Array.isArray(data)) {
    items = data;
  } else if (data && typeof data === 'object') {
    res.title = cleanText(data.title || data.name || '', 60);
    const players = data.players || data.predictedPlayers || data.people;
    if (Array.isArray(players)) res.players.push(...players.map((p) => (typeof p === 'string' ? p : p && p.name)));
    if (Array.isArray(data.questions)) items = data.questions;
    // Grouped form: { "levels": { "1": ["..."], "2": ["..."] } } or [{level, questions:[...]}]
    const grouped = data.levels || (data.questions && !Array.isArray(data.questions) ? data.questions : null);
    if (grouped && typeof grouped === 'object') {
      const groups = Array.isArray(grouped) ? grouped : Object.entries(grouped).map(([level, qs]) => ({ level, questions: qs }));
      for (const g of groups) {
        for (const q of g.questions || []) {
          items.push(typeof q === 'string' ? { text: q, level: g.level } : { level: g.level, ...q });
        }
      }
    }
  }
  for (const item of items) {
    if (typeof item === 'string') res.raw.push({ text: item, level: 1 });
    else if (item && typeof item === 'object') {
      res.raw.push({
        text: item.text ?? item.q ?? item.question ?? item.prompt ?? '',
        level: item.level ?? item.lvl ?? item.creepiness ?? item.creepy ?? 1,
      });
    }
  }
}

function fromText(text, res) {
  let level = 1;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    let m;
    if ((m = /^(?:title|name)\s*[:=]\s*(.+)$/i.exec(line))) { res.title = cleanText(m[1], 60); continue; }
    if ((m = /^(?:players|people|predicted(?: players)?)\s*[:=]\s*(.+)$/i.exec(line))) {
      res.players.push(...m[1].split(/[,;|]/));
      continue;
    }
    if ((m = /^[\[=\-\s]*(?:level|lvl|creepiness)\s*[:#]?\s*(\d+)[^\w{]*$/i.exec(line))) { level = parseInt(m[1], 10); continue; }
    if ((m = /^(\d)\s*[|:\-)\].]\s+(.+)$/.exec(line))) { res.raw.push({ text: m[2], level: parseInt(m[1], 10) }); continue; }
    res.raw.push({ text: line.replace(/^[-*•]\s+/, ''), level });
  }
}

function fromCsv(text, res) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return;
  const head = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const qi = head.findIndex((h) => /question|text|prompt/.test(h));
  const li = head.findIndex((h) => /level|creep|lvl/.test(h));
  const hasHeader = qi !== -1;
  for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    if (hasHeader) res.raw.push({ text: cells[qi] || '', level: li >= 0 ? cells[li] : 1 });
    else if (cells.length >= 2 && /^\d+$/.test(cells[0])) res.raw.push({ text: cells.slice(1).join(', '), level: cells[0] });
    else res.raw.push({ text: cells.join(', '), level: 1 });
  }
}

/**
 * Parse an uploaded deck. Always returns { ok, deck?, errors[], warnings[] }.
 * deck = { title, fileName, predicted: [{key, name}], questions: [...], counts: {level: n} }
 */
export function parseDeck(text, fileName = 'deck') {
  const res = { title: '', players: [], raw: [] };
  const errors = [];
  const warnings = [];
  const src = String(text || '').replace(/^﻿/, '');
  const trimmed = src.trim();
  if (!trimmed) return { ok: false, errors: ['The file is empty.'], warnings };

  const ext = (fileName.split('.').pop() || '').toLowerCase();
  if (ext === 'json' || /^[\[{]/.test(trimmed)) {
    try {
      fromJson(JSON.parse(trimmed), res);
    } catch (e) {
      return { ok: false, errors: ['This JSON file has a typo: ' + e.message], warnings };
    }
  } else if (ext === 'csv' || ext === 'tsv') {
    fromCsv(src, res);
  } else {
    fromText(src, res);
  }

  // Predicted players: declared list + anything referenced in questions.
  const predicted = new Map();
  for (const p of res.players) {
    const name = cleanText(p, 30);
    if (!name || wildSlot(name)) continue;
    if (!predicted.has(normName(name))) predicted.set(normName(name), name);
  }
  const declared = new Set(predicted.keys());

  const seen = new Set();
  const questions = [];
  let skipped = 0;
  for (const r of res.raw) {
    const text = cleanText(r.text);
    if (!text) continue;
    if (text.length > MAX_QUESTION_LENGTH) warnings.push(`A question was trimmed to ${MAX_QUESTION_LENGTH} characters: "${text.slice(0, 40)}…"`);
    const lvlNum = Number(r.level);
    if (!Number.isFinite(lvlNum) || lvlNum < 1 || lvlNum > MAX_LEVEL) {
      warnings.push(`Level "${r.level}" is not 1–${MAX_LEVEL}; used ${clamp(Math.round(lvlNum) || 1, 1, MAX_LEVEL)} instead.`);
    }
    const q = makeQuestion(text, lvlNum, 'deck');
    if (seen.has(q.id)) { skipped++; continue; }
    seen.add(q.id);
    const { named } = analyzeTemplate(q.text);
    for (const [key, display] of named) {
      if (!predicted.has(key)) {
        predicted.set(key, display);
        if (declared.size) warnings.push(`"{${display}}" is used in a question but isn't in the players list — added it.`);
      }
    }
    questions.push(q);
  }
  if (skipped) warnings.push(`${skipped} duplicate question${skipped > 1 ? 's were' : ' was'} ignored.`);
  if (!questions.length) {
    errors.push('No questions found. Check the format in the README (or download the template).');
    return { ok: false, errors, warnings };
  }
  const counts = {};
  for (const q of questions) counts[q.level] = (counts[q.level] || 0) + 1;
  return {
    ok: true,
    errors,
    warnings: [...new Set(warnings)].slice(0, 12),
    deck: {
      title: res.title || fileName.replace(/\.[^.]+$/, ''),
      fileName,
      predicted: [...predicted].map(([key, name]) => ({ key, name })),
      questions,
      counts,
    },
  };
}

// ---------------------------------------------------------------------------
// Rendering

/**
 * Turn a template into display segments given a token->player mapping.
 * mapping: { named: {normName: pid}, wild: {slot: pid} }, players: {pid: {name}}
 * Returns [{ t: 'text', v } | { t: 'p', pid, v }]
 */
export function renderSegments(text, mapping, players) {
  const segs = [];
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER)) {
    const token = m[1].trim();
    const slot = wildSlot(token);
    const pid = slot ? mapping.wild[slot] : mapping.named[normName(token)];
    if (!pid || !players[pid]) continue; // leave unknown braces as literal text
    if (m.index > last) segs.push({ t: 'text', v: text.slice(last, m.index) });
    segs.push({ t: 'p', pid, v: players[pid].name });
    last = m.index + m[0].length;
  }
  if (last < text.length) segs.push({ t: 'text', v: text.slice(last) });
  return segs;
}

export function segmentsToText(segs) {
  return segs.map((s) => s.v).join('');
}

export const TEMPLATE_DECK = {
  title: 'Family Night',
  players: ['Mom', 'Dad', 'Sarah', 'Grandpa Joe'],
  questions: [
    { level: 1, text: "What is {Mom}'s secret talent that nobody knows about?" },
    { level: 1, text: 'If {Dad} were a kitchen appliance, which one would it be?' },
    { level: 2, text: 'What does {Sarah} actually do during "homework time"?' },
    { level: 2, text: 'What would {Grandpa Joe} and {Dad} argue about on a road trip?' },
    { level: 3, text: "What is hidden in the back of {Mom}'s closet?" },
    { level: 3, text: 'What did {any} really do last weekend?' },
    { level: 4, text: 'Why was {Dad} awake at 3am last Tuesday?' },
    { level: 4, text: "What does {Sarah} really think of {Mom}'s cooking?" },
    { level: 5, text: "What is {Grandpa Joe} planning for the next birthday that nobody has been told about?" },
    { level: 5, text: 'What is the name {any} whispers when nobody is around?' },
  ],
};
