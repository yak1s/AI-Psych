// The authoritative game engine. Runs only on the host device; players receive
// per-player "views" computed by viewFor(). All state is plain JSON so the host
// can persist it to localStorage after every change and resume after a refresh.

import { uid, shuffle, seeded, pick, random, normName, cleanText } from './util.js';
import { renderSegments, segmentsToText } from './deck.js';
import { STARTER } from './starter.js';

export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 2;
export const TIMER_MS = 45000;
export const ROUND_CHOICES = [5, 10, 15];
export const ANSWER_MAX = 120;
export const NAME_MAX = 14;
export const PROTOCOL = 1;

export const AVATARS = ['🦄', '🐸', '🦖', '🐙', '🥑', '🌮', '👽', '🤡', '🐔', '🦝', '🐷', '🦊', '🐼', '🐵', '🦉', '🐢', '🍕', '🧁', '🌵', '👻', '🤖', '🦩', '🐳', '🍩'];
export const COLORS = ['coral', 'sky', 'sun', 'mint', 'grape', 'bubblegum', 'tangerine', 'leaf'];

// ---------------------------------------------------------------------------
// Rooms & players

export function createRoom({ code, host }) {
  const room = {
    v: 1,
    roomId: uid(12),
    code: String(code),
    createdAt: Date.now(),
    hostPid: null,
    players: [],
    deck: null,
    assign: {},
    used: [],
    settings: { rounds: 10, subjectAnswers: true, showMeter: true, fillStarter: true },
    gamesPlayed: 0,
    game: null,
    acts: {},
    seq: 0,
  };
  const res = addPlayer(room, host, { isHost: true });
  if (!res.ok) throw new Error(res.error);
  room.hostPid = res.player.id;
  return room;
}

export function activePlayers(room) {
  return room.players.filter((p) => !p.gone);
}

export function getPlayer(room, pid) {
  return room.players.find((p) => p.id === pid) || null;
}

export function isActive(room, pid) {
  const p = getPlayer(room, pid);
  return !!p && !p.gone;
}

export function validateProfile(room, profile, exceptPid = null) {
  const name = cleanText(profile && profile.name, NAME_MAX);
  if (!name) return { ok: false, error: 'name-empty' };
  if (/[{}]/.test(name)) return { ok: false, error: 'name-braces' };
  const taken = activePlayers(room).some((p) => p.id !== exceptPid && normName(p.name) === normName(name));
  if (taken) return { ok: false, error: 'name-taken' };
  const avatar = AVATARS.includes(profile.avatar) ? profile.avatar : AVATARS[0];
  return { ok: true, name, avatar };
}

export function addPlayer(room, profile, { isHost = false } = {}) {
  if (activePlayers(room).length >= MAX_PLAYERS) return { ok: false, error: 'room-full' };
  const v = validateProfile(room, profile);
  if (!v.ok) return v;
  const usedColors = new Set(activePlayers(room).map((p) => p.color));
  const color = COLORS.find((c) => !usedColors.has(c)) || COLORS[room.players.length % COLORS.length];
  const player = { id: uid(10), secret: uid(16), name: v.name, avatar: v.avatar, color, joinedAt: Date.now(), isHost };
  room.players.push(player);
  if (room.game && room.game.scores[player.id] == null) room.game.scores[player.id] = 0;
  room.seq++;
  return { ok: true, player };
}

/** Try to match a deck's predicted names to players who joined. */
export function autoAssign(room) {
  if (!room.deck) return;
  const players = activePlayers(room);
  const taken = new Set(Object.values(room.assign));
  for (const { key } of room.deck.predicted) {
    if (room.assign[key] && isActive(room, room.assign[key])) continue;
    delete room.assign[key];
    const first = key.split(' ')[0];
    const tests = [
      (n) => n === key,
      (n) => n.split(' ')[0] === first,
      (n) => n.startsWith(key) || key.startsWith(n),
    ];
    for (const test of tests) {
      const hits = players.filter((p) => !taken.has(p.id) && test(normName(p.name)));
      if (hits.length === 1) {
        room.assign[key] = hits[0].id;
        taken.add(hits[0].id);
        break;
      }
    }
  }
}

function removePlayer(room, pid, reason, ctx) {
  const p = getPlayer(room, pid);
  if (!p || p.gone || pid === room.hostPid) return { ok: false, error: 'bad-player' };
  p.gone = reason;
  for (const [k, v] of Object.entries(room.assign)) if (v === pid) delete room.assign[k];
  if (room.game) recheck(room, ctx);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Question pool

function eligibleDeck(room, activeIds) {
  if (!room.deck) return [];
  const active = new Set(activeIds);
  return room.deck.questions.filter((q) => {
    const pids = q.refs.map((k) => room.assign[k]);
    if (pids.some((p) => !p || !active.has(p))) return false;
    if (new Set(pids).size !== pids.length) return false;
    return q.wild.length <= activeIds.length - pids.length;
  });
}

function eligibleStarter(activeIds) {
  return STARTER.filter((q) => q.wild.length <= activeIds.length);
}

export function questionPool(room, activeIds = activePlayers(room).map((p) => p.id)) {
  const used = new Set(room.used);
  const deck = eligibleDeck(room, activeIds).filter((q) => !used.has(q.id));
  const useStarter = !room.deck || room.settings.fillStarter;
  const starter = useStarter ? eligibleStarter(activeIds).filter((q) => !used.has(q.id)) : [];
  const primary = room.deck ? deck : starter;
  const backup = room.deck ? starter : [];
  return { deck, starter, primary, backup, total: primary.length + backup.length };
}

export function targetLevel(levels, idx, n) {
  if (!levels.length) return 1;
  if (n <= 1 || levels.length === 1) return levels[0];
  return levels[Math.round((idx * (levels.length - 1)) / (n - 1))];
}

/** Resolve which players fill a question, preferring people asked about least. */
function mapQuestion(room, g, q, activeIds) {
  const named = {};
  const about = [];
  for (const key of q.refs) {
    named[key] = room.assign[key];
    about.push(room.assign[key]);
  }
  const featured = (pid) => g.featured[pid] || 0;
  const recent = new Set(g.lastAbout || []);
  const free = shuffle(activeIds.filter((p) => !about.includes(p))).sort(
    (a, b) => featured(a) + (recent.has(a) ? 0.5 : 0) - (featured(b) + (recent.has(b) ? 0.5 : 0)),
  );
  const wild = {};
  for (const slot of q.wild) {
    const pid = free.shift();
    wild[slot] = pid;
    about.push(pid);
  }
  let score = 0;
  for (const pid of about) score += featured(pid) * 10 + (recent.has(pid) ? 25 : 0);
  return { named, wild, about, score };
}

function chooseQuestion(room, g, activeIds) {
  const pool = questionPool(room, activeIds);
  const list = pool.primary.length ? pool.primary : pool.backup;
  if (!list.length) return null;
  const target = targetLevel(g.levels, g.idx, g.n);
  const last = g.lastLevel || 0;
  const available = [...new Set(list.map((q) => q.level))];
  const rank = (l) => (l === target ? 0 : l >= last && l < target ? target - l : l > target ? 10 + l - target : 20 + last - l);
  const level = available.sort((a, b) => rank(a) - rank(b))[0];
  const scored = list.filter((q) => q.level === level).map((q) => ({ q, m: mapQuestion(room, g, q, activeIds) }));
  const min = Math.min(...scored.map((s) => s.m.score));
  return pick(scored.filter((s) => s.m.score === min));
}

// ---------------------------------------------------------------------------
// Game flow

export function startGame(room, ctx) {
  const active = activePlayers(room);
  if (active.length < MIN_PLAYERS) return { ok: false, error: 'need-players' };
  const pool = questionPool(room);
  if (!pool.total) return { ok: false, error: 'no-questions' };
  const rounds = ROUND_CHOICES.includes(room.settings.rounds) ? room.settings.rounds : 10;
  const levelSource = pool.primary.length ? pool.primary : pool.backup;
  room.gamesPlayed++;
  room.game = {
    id: uid(8),
    number: room.gamesPlayed,
    n: Math.min(rounds, pool.total),
    idx: 0,
    phase: 'answer',
    levels: [...new Set(levelSource.map((q) => q.level))].sort((a, b) => a - b),
    scores: Object.fromEntries(active.map((p) => [p.id, 0])),
    featured: {},
    history: [],
    startedAt: ctx.now,
  };
  beginQuestion(room, ctx);
  return { ok: true };
}

function beginQuestion(room, ctx) {
  const g = room.game;
  const activeIds = activePlayers(room).map((p) => p.id);
  const choice = chooseQuestion(room, g, activeIds);
  if (!choice) return finishGame(room, ctx, 'out-of-questions');
  const { q, m } = choice;
  room.used.push(q.id);
  const byId = Object.fromEntries(room.players.map((p) => [p.id, p]));
  const segments = renderSegments(q.text, m, byId);
  const about = [...new Set(segments.filter((s) => s.t === 'p').map((s) => s.pid))];
  for (const pid of about) g.featured[pid] = (g.featured[pid] || 0) + 1;
  g.lastAbout = about;
  g.lastLevel = q.level;
  let answerers = room.settings.subjectAnswers ? activeIds : activeIds.filter((p) => !about.includes(p));
  if (!answerers.length) answerers = activeIds;
  g.q = {
    key: uid(8),
    id: q.id,
    level: q.level,
    segments,
    text: segmentsToText(segments),
    about,
    participants: activeIds,
    answerers,
    startedAt: ctx.now,
  };
  g.phase = 'answer';
  g.answers = {};
  g.options = null;
  g.votes = {};
  g.voters = [];
  g.ready = [];
  g.timer = null;
  g.result = null;
}

function beginVote(room, ctx) {
  const g = room.game;
  const answered = g.q.answerers.filter((p) => isActive(room, p) && g.answers[p]);
  if (!answered.length) return beginQuestion(room, ctx);
  g.options = shuffle(answered.map((pid) => ({ oid: uid(6), pid, text: g.answers[pid].text })));
  g.voters = g.q.participants.filter((p) => isActive(room, p) && g.options.some((o) => o.pid !== p));
  g.votes = {};
  g.timer = null;
  g.phase = 'vote';
  g.voteStartedAt = ctx.now;
  if (!g.voters.length) beginResults(room, ctx);
}

function beginResults(room, ctx) {
  const g = room.game;
  const entries = g.options.map((o) => ({ oid: o.oid, pid: o.pid, text: o.text, votes: [], points: 0 }));
  for (const [voter, oid] of Object.entries(g.votes)) {
    const e = entries.find((x) => x.oid === oid);
    if (!e) continue;
    const pts = g.q.about.includes(voter) ? 2 : 1;
    e.votes.push({ pid: voter, pts });
    e.points += pts;
  }
  const before = { ...g.scores };
  for (const e of entries) g.scores[e.pid] = (g.scores[e.pid] || 0) + e.points;
  g.result = {
    entries: shuffle(entries).sort((a, b) => a.points - b.points),
    before,
    after: { ...g.scores },
    missingAnswers: g.q.answerers.filter((p) => isActive(room, p) && !g.answers[p]),
    missingVotes: g.voters.filter((p) => isActive(room, p) && !g.votes[p]),
  };
  g.history.push({
    idx: g.idx,
    level: g.q.level,
    about: g.q.about,
    entries: entries.map((e) => ({
      pid: e.pid,
      points: e.points,
      judge: e.votes.filter((v) => v.pts === 2).length,
      crowd: e.votes.filter((v) => v.pts === 1).length,
    })),
  });
  g.phase = 'results';
  g.ready = [];
  g.timer = null;
}

function advance(room, ctx) {
  const g = room.game;
  if (g.idx + 1 >= g.n) return finishGame(room, ctx, 'done');
  g.idx++;
  beginQuestion(room, ctx);
}

function finishGame(room, ctx, reason) {
  const g = room.game;
  g.phase = 'final';
  g.timer = null;
  g.ready = [];
  const players = activePlayers(room);
  const sorted = players.map((p) => ({ pid: p.id, score: g.scores[p.id] || 0 })).sort((a, b) => b.score - a.score);
  let rank = 0;
  sorted.forEach((r, i) => {
    if (i === 0 || r.score !== sorted[i - 1].score) rank = i + 1;
    r.rank = rank;
  });
  g.final = { ranking: sorted, awards: computeAwards(room, g, sorted), reason, rounds: g.history.length };
}

function computeAwards(room, g, ranking) {
  const tally = (fn) => {
    const t = {};
    for (const h of g.history) for (const e of h.entries) t[e.pid] = (t[e.pid] || 0) + fn(e, h);
    return t;
  };
  const featured = {};
  for (const h of g.history) for (const pid of h.about) featured[pid] = (featured[pid] || 0) + 1;
  const zeroRounds = {};
  for (const h of g.history) {
    for (const pid of room.players.map((p) => p.id)) {
      const e = h.entries.find((x) => x.pid === pid);
      if (!e || e.points === 0) zeroRounds[pid] = (zeroRounds[pid] || 0) + 1;
    }
  }
  const candidates = [
    { id: 'judge', emoji: '⚖️', title: "The Judge's Pet", t: tally((e) => e.judge), unit: 'double-point votes' },
    { id: 'crowd', emoji: '📣', title: 'Crowd Pleaser', t: tally((e) => e.crowd), unit: 'votes from the crowd' },
    { id: 'famous', emoji: '🔎', title: 'Most Investigated', t: featured, unit: 'questions about them' },
    { id: 'ghost', emoji: '👻', title: 'The Mysterious Ghost', t: zeroRounds, unit: 'rounds with zero points' },
    { id: 'hot', emoji: '🔥', title: 'Hottest Round', t: tally((e) => (e.points >= 3 ? 1 : 0)), unit: 'rounds with 3+ points' },
  ];
  const awards = [];
  const activeIds = new Set(ranking.map((r) => r.pid));
  for (const c of candidates) {
    const rows = Object.entries(c.t).filter(([pid, v]) => activeIds.has(pid) && v > 0).sort((a, b) => b[1] - a[1]);
    if (!rows.length || (rows[1] && rows[1][1] === rows[0][1])) continue;
    awards.push({ id: c.id, emoji: c.emoji, title: c.title, pid: rows[0][0], detail: `${rows[0][1]} ${c.unit}` });
  }
  if (ranking.length > 2) {
    const last = ranking[ranking.length - 1];
    if (last.rank !== 1) awards.push({ id: 'spoon', emoji: '🥄', title: 'The Wooden Spoon', pid: last.pid, detail: 'Better luck next time!' });
  }
  return awards.slice(0, 5);
}

/** Re-evaluate phase completion after presence/roster changes. */
export function recheck(room, ctx) {
  const g = room.game;
  if (!g) return;
  if (g.phase === 'answer') {
    const need = g.q.answerers.filter((p) => isActive(room, p));
    if (need.length && need.every((p) => g.answers[p])) beginVote(room, ctx);
  } else if (g.phase === 'vote') {
    const need = g.voters.filter((p) => isActive(room, p));
    if (need.every((p) => g.votes[p])) beginResults(room, ctx);
  } else if (g.phase === 'results') {
    const need = activePlayers(room).filter((p) => p.id === room.hostPid || !ctx.online || ctx.online.has(p.id));
    if (need.every((p) => g.ready.includes(p.id))) advance(room, ctx);
  }
}

// ---------------------------------------------------------------------------
// Actions

const HOST_ONLY = new Set(['settings', 'deck', 'clearDeck', 'assign', 'kick', 'start', 'timer', 'moveOn', 'skipQuestion', 'next', 'endGame', 'playAgain', 'resetUsed']);

/**
 * Apply an action from player `pid`. Mutates `room`.
 * ctx: { now: ms, online: Set<pid> }
 */
export function apply(room, pid, action, ctx) {
  const res = applyInner(room, pid, action || {}, ctx);
  if (res.ok) room.seq++;
  return res;
}

function applyInner(room, pid, action, ctx) {
  const p = getPlayer(room, pid);
  if (!p || p.gone) return { ok: false, error: 'not-in-room' };
  if (HOST_ONLY.has(action.type) && pid !== room.hostPid) return { ok: false, error: 'host-only' };
  const g = room.game;
  const inLobby = !g || g.phase === 'final';

  switch (action.type) {
    case 'answer': {
      if (!g || g.phase !== 'answer') return { ok: false, error: 'stale' };
      if (action.qkey && action.qkey !== g.q.key) return { ok: false, error: 'stale' };
      if (!g.q.answerers.includes(pid)) return { ok: false, error: 'not-answering' };
      const text = cleanText(action.text, ANSWER_MAX);
      if (!text) return { ok: false, error: 'empty' };
      g.answers[pid] = { text, at: ctx.now };
      recheck(room, ctx);
      return { ok: true };
    }
    case 'vote': {
      if (!g || g.phase !== 'vote') return { ok: false, error: 'stale' };
      if (action.qkey && action.qkey !== g.q.key) return { ok: false, error: 'stale' };
      if (!g.voters.includes(pid)) return { ok: false, error: 'not-voting' };
      if (g.votes[pid]) return { ok: g.votes[pid] === action.oid, error: 'already-voted' };
      const opt = g.options.find((o) => o.oid === action.oid);
      if (!opt) return { ok: false, error: 'bad-option' };
      if (opt.pid === pid) return { ok: false, error: 'own-answer' };
      g.votes[pid] = action.oid;
      recheck(room, ctx);
      return { ok: true };
    }
    case 'ready': {
      if (!g || g.phase !== 'results') return { ok: false, error: 'stale' };
      if (action.qkey && action.qkey !== g.q.key) return { ok: false, error: 'stale' };
      if (!g.ready.includes(pid)) g.ready.push(pid);
      recheck(room, ctx);
      return { ok: true };
    }
    case 'leave':
      return removePlayer(room, pid, 'left', ctx);

    // ---- host only ----
    case 'settings': {
      const s = room.settings;
      const a = action.settings || {};
      if (ROUND_CHOICES.includes(a.rounds)) s.rounds = a.rounds;
      for (const k of ['subjectAnswers', 'showMeter', 'fillStarter']) if (typeof a[k] === 'boolean') s[k] = a[k];
      return { ok: true };
    }
    case 'deck': {
      if (!inLobby) return { ok: false, error: 'in-game' };
      if (activePlayers(room).length < 2) return { ok: false, error: 'need-players' };
      const d = action.deck;
      if (!d || !Array.isArray(d.questions) || !d.questions.length) return { ok: false, error: 'bad-deck' };
      room.deck = d;
      const keys = new Set(d.predicted.map((x) => x.key));
      for (const k of Object.keys(room.assign)) if (!keys.has(k)) delete room.assign[k];
      autoAssign(room);
      return { ok: true };
    }
    case 'clearDeck':
      if (!inLobby) return { ok: false, error: 'in-game' };
      room.deck = null;
      room.assign = {};
      return { ok: true };
    case 'assign': {
      if (!room.deck) return { ok: false, error: 'no-deck' };
      const key = action.key;
      if (!room.deck.predicted.some((x) => x.key === key)) return { ok: false, error: 'bad-key' };
      if (!action.pid) {
        delete room.assign[key];
        return { ok: true };
      }
      if (!isActive(room, action.pid)) return { ok: false, error: 'bad-player' };
      for (const [k, v] of Object.entries(room.assign)) if (v === action.pid) delete room.assign[k];
      room.assign[key] = action.pid;
      return { ok: true };
    }
    case 'kick':
      return removePlayer(room, action.pid, 'kicked', ctx);
    case 'start':
    case 'playAgain':
      if (g && g.phase !== 'final') return { ok: false, error: 'in-game' };
      return startGame(room, ctx);
    case 'timer': {
      if (!g || (g.phase !== 'answer' && g.phase !== 'vote')) return { ok: false, error: 'stale' };
      g.timer = action.on ? { endsAt: ctx.now + TIMER_MS, phase: g.phase, key: g.q.key } : null;
      return { ok: true };
    }
    case 'moveOn': {
      if (!g) return { ok: false, error: 'stale' };
      if (g.phase === 'answer') {
        if (!Object.keys(g.answers).length) return { ok: false, error: 'no-answers' };
        beginVote(room, ctx);
      } else if (g.phase === 'vote') beginResults(room, ctx);
      else return { ok: false, error: 'stale' };
      return { ok: true };
    }
    case 'skipQuestion': {
      if (!g || (g.phase !== 'answer' && g.phase !== 'vote')) return { ok: false, error: 'stale' };
      for (const pid2 of g.q.about) g.featured[pid2] = Math.max(0, (g.featured[pid2] || 1) - 1);
      beginQuestion(room, ctx);
      return { ok: true };
    }
    case 'next': {
      if (!g || g.phase !== 'results') return { ok: false, error: 'stale' };
      advance(room, ctx);
      return { ok: true };
    }
    case 'endGame':
      room.game = null;
      return { ok: true };
    case 'resetUsed':
      if (!inLobby) return { ok: false, error: 'in-game' };
      room.used = [];
      return { ok: true };
    default:
      return { ok: false, error: 'unknown-action' };
  }
}

/** Remember processed action ids so retries after reconnects are idempotent. */
export function seenAction(room, pid, id) {
  const list = room.acts[pid] || (room.acts[pid] = []);
  if (list.includes(id)) return true;
  list.push(id);
  if (list.length > 40) list.splice(0, list.length - 40);
  return false;
}

// ---------------------------------------------------------------------------
// Views (what each device is allowed to see)

function publicPlayer(p, ctx) {
  return { id: p.id, name: p.name, avatar: p.avatar, color: p.color, isHost: !!p.isHost, online: p.isHost || !ctx.online || ctx.online.has(p.id) };
}

export function viewFor(room, pid, ctx) {
  const g = room.game;
  const view = {
    code: room.code,
    roomId: room.roomId,
    seq: room.seq,
    me: pid,
    hostPid: room.hostPid,
    players: activePlayers(room).map((p) => publicPlayer(p, ctx)),
    settings: { rounds: room.settings.rounds, showMeter: room.settings.showMeter, subjectAnswers: room.settings.subjectAnswers },
    gamesPlayed: room.gamesPlayed,
    game: null,
  };
  if (!g) return view;
  const gv = {
    id: g.id,
    number: g.number,
    n: g.n,
    idx: g.idx,
    phase: g.phase,
    scores: g.scores,
    levels: g.levels,
  };
  if (g.q) {
    gv.q = { key: g.q.key, level: g.q.level, segments: g.q.segments, about: g.q.about, participants: g.q.participants, answerers: g.q.answerers };
  }
  if (g.timer && (g.phase === 'answer' || g.phase === 'vote')) {
    gv.timer = { remaining: g.timer.endsAt - ctx.now, total: TIMER_MS };
  }
  if (g.phase === 'answer') {
    gv.answered = Object.keys(g.answers).filter((p) => g.q.answerers.includes(p));
    gv.myAnswer = g.answers[pid] ? g.answers[pid].text : null;
  }
  if (g.phase === 'vote') {
    const rand = seeded(g.q.key + ':' + pid);
    gv.options = shuffle(g.options, rand).map((o) => ({ oid: o.oid, text: o.text, mine: o.pid === pid }));
    gv.voters = g.voters.filter((p) => isActive(room, p));
    gv.voted = Object.keys(g.votes);
    gv.myVote = g.votes[pid] || null;
  }
  if (g.phase === 'results') {
    gv.result = g.result;
    gv.ready = g.ready;
  }
  if (g.phase === 'final') {
    gv.final = g.final;
    gv.result = g.result;
  }
  view.game = gv;
  return view;
}

/** Extra information only the host's own screen gets (never sent over the wire). */
export function hostInfo(room) {
  const pool = questionPool(room);
  const byLevel = {};
  for (const q of pool.primary) byLevel[q.level] = (byLevel[q.level] || 0) + 1;
  let deck = null;
  if (room.deck) {
    const refCount = {};
    for (const q of room.deck.questions) for (const k of q.refs) refCount[k] = (refCount[k] || 0) + 1;
    deck = {
      title: room.deck.title,
      fileName: room.deck.fileName,
      total: room.deck.questions.length,
      counts: room.deck.counts,
      predicted: room.deck.predicted.map((x) => ({ ...x, pid: isActive(room, room.assign[x.key]) ? room.assign[x.key] : null, uses: refCount[x.key] || 0 })),
    };
  }
  return {
    deck,
    pool: { deck: pool.deck.length, starter: pool.starter.length, total: pool.total, byLevel },
    usedCount: room.used.length,
    settings: room.settings,
  };
}

export { random };
