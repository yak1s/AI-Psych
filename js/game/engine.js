// The authoritative game engine. Runs only on the host device; players receive
// per-player "views" computed by viewFor(). All state is plain JSON so the host
// can persist it to localStorage after every change and resume after a refresh.

import { uid, shuffle, seeded, pick, random, normName, cleanText } from './util.js';
import { renderSegments, segmentsToText } from './deck.js';
import { STARTER } from './starter.js';

export const MAX_PLAYERS = 16;
export const MIN_PLAYERS = 2;
export const TIMER_MS = 45000;
export const HOST_TIMER_CHOICES = [30, 45, 60];
/** Hard time limits (seconds): auto-submit what's typed and move on. */
export const TIME_LIMITS = {
  off: null,
  chill: { answer: 120, vote: 60, label: 'Chill' },
  normal: { answer: 90, vote: 45, label: 'Normal' },
  fast: { answer: 60, vote: 30, label: 'Fast' },
};
const INTRO_MS = 4500; // the "AI is writing" intro before anyone can type
const DEAL_MS = 650; // per answer card dealt on the voting screen
const GRACE_MS = 1500; // let the last keystrokes arrive before a hard timer fires
export const ROUND_CHOICES = [5, 10, 15];
export const ANSWER_MAX = 120;
export const NAME_MAX = 14;
export const PROTOCOL = 1;

export const AVATARS = [
  '🦄', '🐸', '🦖', '🐙', '🥑', '🌮', '👽', '🤡', '🐔', '🦝', '🐷', '🦊', '🐼', '🐵', '🦉', '🐢',
  '🍕', '🧁', '🌵', '👻', '🤖', '🦩', '🐳', '🍩', '🐧', '🦁', '🐯', '🐨', '🐰', '🦔', '🦥', '🦦',
  '🐌', '🦋', '🐞', '🦈', '🐬', '🦜', '🦚', '🐲', '🦕', '🍉', '🍍', '🥨', '🧀', '🍪', '🍿', '🥐',
  '🎩', '👑', '🕶️', '🎸', '🎨', '📸', '🎮', '🚀', '⚽', '🎈', '🌈', '🌻', '🍄', '⭐', '🔮', '🧸',
];
export const COLORS = ['coral', 'sky', 'sun', 'mint', 'grape', 'bubblegum', 'tangerine', 'leaf', 'ocean', 'rose', 'lime', 'indigo', 'peach', 'aqua', 'lilac', 'gold'];

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
    settings: { rounds: 10, subjectAnswers: true, showMeter: true, fillStarter: true, timeLimit: 'off' },
    awardsGiven: [],
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

/** Even steps from the lowest level to the highest (e.g. 15 questions, 5 levels: 3 each). */
export function targetLevel(levels, idx, n) {
  if (!levels.length) return 1;
  if (n <= 1 || levels.length === 1) return levels[0];
  if (levels.length > n) return levels[Math.round((idx * (levels.length - 1)) / (n - 1))];
  return levels[Math.min(levels.length - 1, Math.floor((idx * levels.length) / n))];
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

function limits(room) {
  return TIME_LIMITS[room.settings.timeLimit] || null;
}

function hardTimer(room, phase, ms, ctx, extra = 0) {
  return { endsAt: ctx.now + ms * 1000 + extra, total: ms * 1000, start: ctx.now + extra, phase, hard: true };
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
    generic: q.id[0] === 's',
  };
  g.phase = 'answer';
  g.answers = {};
  g.drafts = {};
  g.options = null;
  g.votes = {};
  g.voters = [];
  g.ready = [];
  g.stalled = false;
  const lim = limits(room);
  g.timer = lim ? hardTimer(room, 'answer', lim.answer, ctx, INTRO_MS) : null;
  g.result = null;
}

/** Whatever a player had typed (but not submitted) counts when time runs out. */
function collectDrafts(room, ctx) {
  const g = room.game;
  for (const pid of g.q.answerers) {
    const d = g.drafts && g.drafts[pid];
    if (!g.answers[pid] && d && isActive(room, pid)) g.answers[pid] = { text: d, at: ctx.now, auto: true };
  }
}

function beginVote(room, ctx) {
  const g = room.game;
  collectDrafts(room, ctx);
  const answered = g.q.answerers.filter((p) => isActive(room, p) && g.answers[p]);
  if (!answered.length) return beginQuestion(room, ctx);
  g.options = shuffle(answered.map((pid) => ({ oid: uid(6), pid, text: g.answers[pid].text })));
  g.voters = g.q.participants.filter((p) => isActive(room, p) && g.options.some((o) => o.pid !== p));
  g.votes = {};
  const lim = limits(room);
  g.timer = lim ? hardTimer(room, 'vote', lim.vote, ctx, 600 + g.options.length * DEAL_MS) : null;
  g.phase = 'vote';
  g.voteStartedAt = ctx.now;
  if (!g.voters.length) beginResults(room, ctx);
}

function beginResults(room, ctx) {
  const g = room.game;
  const entries = g.options.map((o) => ({ oid: o.oid, pid: o.pid, text: o.text, votes: [], points: 0 }));
  const votePairs = [];
  for (const [voter, oid] of Object.entries(g.votes)) {
    const e = entries.find((x) => x.oid === oid);
    if (!e) continue;
    const pts = g.q.about.includes(voter) ? 2 : 1;
    e.votes.push({ pid: voter, pts });
    e.points += pts;
    votePairs.push([voter, e.pid]);
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
  const order = Object.entries(g.answers).filter(([, a]) => !a.auto).sort((a, b) => a[1].at - b[1].at).map(([pid]) => pid);
  g.history.push({
    idx: g.idx,
    level: g.q.level,
    about: g.q.about,
    answerers: g.q.answerers.slice(),
    votes: votePairs,
    first: order[0] || null,
    last: order.length > 2 ? order[order.length - 1] : null,
    rank: rankOf(g.scores),
    entries: entries.map((e) => ({
      pid: e.pid,
      points: e.points,
      len: e.text.length,
      auto: !!(g.answers[e.pid] && g.answers[e.pid].auto),
      judge: e.votes.filter((v) => v.pts === 2).length,
      crowd: e.votes.filter((v) => v.pts === 1).length,
    })),
  });
  g.phase = 'results';
  g.ready = [];
  g.timer = null;
}

function rankOf(scores) {
  const ids = Object.keys(scores).sort((a, b) => scores[b] - scores[a]);
  const out = {};
  ids.forEach((pid, i) => (out[pid] = i > 0 && scores[pid] === scores[ids[i - 1]] ? out[ids[i - 1]] : i + 1));
  return out;
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
  // Room trophy cabinet: wins carry over from game to game.
  room.wins = room.wins || {};
  if (g.history.length) for (const r of sorted) if (r.rank === 1 && r.score > 0) room.wins[r.pid] = (room.wins[r.pid] || 0) + 1;
}

const AWARD_COUNT = 4;

function computeAwards(room, g, ranking) {
  const activeIds = new Set(ranking.map((r) => r.pid));
  const H = g.history;
  const add = (t, pid, v = 1) => activeIds.has(pid) && (t[pid] = (t[pid] || 0) + v);
  const tally = (fn) => {
    const t = {};
    for (const h of H) for (const e of h.entries) add(t, e.pid, fn(e, h));
    return t;
  };
  const per = (fn) => {
    const t = {};
    for (const h of H) fn(h, t);
    return t;
  };
  const avg = (fn, min = 2) => {
    const sum = {};
    const n = {};
    for (const h of H) for (const e of h.entries) if (!e.auto) { add(sum, e.pid, fn(e)); add(n, e.pid, 1); }
    const t = {};
    for (const pid of Object.keys(sum)) if (n[pid] >= min) t[pid] = Math.round(sum[pid] / n[pid]);
    return t;
  };
  const shortest = (() => {
    const a = avg((e) => e.len);
    const t = {};
    for (const [pid, v] of Object.entries(a)) t[pid] = 1000 - v; // invert so "most" wins
    return { t, show: (pid) => `${1000 - t[pid]} letters per answer, on average` };
  })();
  const midRank = H.length >= 4 ? H[Math.floor(H.length / 2) - 1].rank : null;
  const finalRank = Object.fromEntries(ranking.map((r) => [r.pid, r.rank]));

  const candidates = [
    { id: 'judge', emoji: '⚖️', title: "The Judge's Pet", t: tally((e) => e.judge), detail: (v) => `${v} double-point votes` },
    { id: 'crowd', emoji: '📣', title: 'Crowd Pleaser', t: tally((e) => e.crowd), detail: (v) => `${v} votes from the crowd` },
    { id: 'famous', emoji: '🔎', title: 'Most Investigated', t: per((h, t) => h.about.forEach((p) => add(t, p))), detail: (v) => `the AI asked about them ${v} times` },
    { id: 'ghost', emoji: '👻', title: 'The Mysterious Ghost', t: per((h, t) => h.answerers.forEach((p) => { const e = h.entries.find((x) => x.pid === p); if (!e || !e.points) add(t, p); })), detail: (v) => `${v} rounds without a single point`, min: 2 },
    { id: 'hot', emoji: '🔥', title: 'On Fire', t: tally((e) => (e.points >= 3 ? 1 : 0)), detail: (v) => `${v} rounds with 3+ points` },
    { id: 'sharp', emoji: '🎯', title: 'The Sharpshooter', t: per((h, t) => { const m = Math.max(0, ...h.entries.map((e) => e.points)); if (m) h.entries.filter((e) => e.points === m).forEach((e) => add(t, e.pid)); }), detail: (v) => `won ${v} rounds outright` },
    { id: 'speed', emoji: '⚡', title: 'Speed Demon', t: per((h, t) => h.first && add(t, h.first)), detail: (v) => `first to answer ${v} times`, min: 2 },
    { id: 'late', emoji: '🐢', title: 'Fashionably Late', t: per((h, t) => h.last && add(t, h.last)), detail: (v) => `last to answer ${v} times`, min: 2 },
    { id: 'novel', emoji: '📜', title: 'The Novelist', t: avg((e) => e.len), detail: (v) => `${v} letters per answer, on average` },
    { id: 'short', emoji: '🤏', title: 'Short & Sweet', t: shortest.t, detail: (v, pid) => shortest.show(pid) },
    { id: 'king', emoji: '🗳️', title: 'The Kingmaker', t: per((h, t) => { const m = Math.max(0, ...h.entries.map((e) => e.points)); const top = new Set(h.entries.filter((e) => e.points === m && m).map((e) => e.pid)); h.votes.forEach(([v, a]) => top.has(a) && add(t, v)); }), detail: (v) => `voted for the winning answer ${v} times`, min: 2 },
    { id: 'lonely', emoji: '🦄', title: 'One of a Kind', t: per((h, t) => h.votes.forEach(([v, a]) => { const e = h.entries.find((x) => x.pid === a); if (e && e.judge + e.crowd === 1) add(t, v); })), detail: (v) => `${v} votes nobody else agreed with`, min: 2 },
    { id: 'magnet', emoji: '🧲', title: 'Vote Magnet', t: per((h, t) => h.entries.forEach((e) => { const n = e.judge + e.crowd; if (activeIds.has(e.pid) && n > (t[e.pid] || 0)) t[e.pid] = n; })), detail: (v) => `${v} votes in a single round`, min: 3 },
    { id: 'fans', emoji: '🌍', title: 'Fan Club President', t: per((h, t) => { t.__s ||= {}; h.votes.forEach(([v, a]) => { (t.__s[a] ||= new Set()).add(v); }); for (const [a, set] of Object.entries(t.__s)) if (activeIds.has(a)) t[a] = set.size; }), detail: (v) => `got votes from ${v} different players`, min: 3 },
    { id: 'sleepy', emoji: '😴', title: 'The Sleepy Scribe', t: per((h, t) => h.answerers.forEach((p) => { const e = h.entries.find((x) => x.pid === p); if (!e || e.auto) add(t, p); })), detail: (v) => `${v} answers the clock had to grab`, min: 2 },
    { id: 'comeback', emoji: '📈', title: 'The Comeback Kid', t: midRank ? Object.fromEntries(Object.keys(finalRank).filter((p) => midRank[p]).map((p) => [p, midRank[p] - finalRank[p]])) : {}, detail: (v) => `climbed ${v} places in the second half`, min: 2 },
    { id: 'spoon', emoji: '🥄', title: 'The Wooden Spoon', t: ranking.length > 2 && ranking[ranking.length - 1].rank !== 1 ? { [ranking[ranking.length - 1].pid]: 1 } : {}, detail: () => 'better luck next time!' },
  ];
  delete candidates.find((c) => c.id === 'fans').t.__s;

  const eligible = [];
  for (const c of candidates) {
    const rows = Object.entries(c.t).filter(([pid, v]) => activeIds.has(pid) && v >= (c.min || 1)).sort((a, b) => b[1] - a[1]);
    if (!rows.length || (rows[1] && rows[1][1] === rows[0][1])) continue;
    eligible.push({ id: c.id, emoji: c.emoji, title: c.title, pid: rows[0][0], detail: c.detail(rows[0][1], rows[0][0]) });
  }
  // Rotate: prefer awards this room hasn't seen lately, and spread them across different people.
  const recent = new Set((room.awardsGiven || []).slice(-8));
  const rand = seeded(g.id);
  const sorted = shuffle(eligible, rand).sort((a, b) => recent.has(a.id) - recent.has(b.id));
  const picked = [];
  const people = new Set();
  for (const a of sorted) if (picked.length < AWARD_COUNT && !people.has(a.pid)) { picked.push(a); people.add(a.pid); }
  for (const a of sorted) if (picked.length < AWARD_COUNT && !picked.includes(a)) picked.push(a);
  room.awardsGiven = [...(room.awardsGiven || []), ...picked.map((a) => a.id)].slice(-30);
  return picked;
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

/** Remember what a player is typing, so a time-out can submit it. */
export function setDraft(room, pid, text, qkey) {
  const g = room.game;
  if (!g || g.phase !== 'answer' || (qkey && qkey !== g.q.key) || !g.q.answerers.includes(pid)) return false;
  g.drafts = g.drafts || {};
  g.drafts[pid] = cleanText(text, ANSWER_MAX);
  return true;
}

/** Hard time limits: called by the host every half second. Returns true if anything changed. */
export function tick(room, ctx) {
  const g = room.game;
  if (!g || !g.timer || !g.timer.hard || ctx.now < g.timer.endsAt + GRACE_MS) return false;
  if (g.phase === 'answer') {
    collectDrafts(room, ctx);
    if (Object.keys(g.answers).length) beginVote(room, ctx);
    else {
      // Nobody wrote anything at all: don't burn questions — wait for the host.
      g.timer = null;
      g.stalled = true;
    }
  } else if (g.phase === 'vote') beginResults(room, ctx);
  else return false;
  room.seq++;
  return true;
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
      if (g.answers[pid] && g.answers[pid].text === text) return { ok: true };
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
      if (a.timeLimit in TIME_LIMITS) s.timeLimit = a.timeLimit;
      return { ok: true };
    }
    case 'deck': {
      if (!inLobby) return { ok: false, error: 'in-game' };
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
      const secs = HOST_TIMER_CHOICES.includes(action.seconds) ? action.seconds : TIMER_MS / 1000;
      g.timer = action.on ? { endsAt: ctx.now + secs * 1000, total: secs * 1000, start: ctx.now, phase: g.phase } : null;
      return { ok: true };
    }
    case 'moveOn': {
      if (!g) return { ok: false, error: 'stale' };
      if (g.phase === 'answer') {
        collectDrafts(room, ctx);
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
  const net = p.isHost ? 'host' : (ctx.transport && ctx.transport[p.id]) || undefined;
  return { id: p.id, name: p.name, avatar: p.avatar, color: p.color, isHost: !!p.isHost, online: p.isHost || !ctx.online || ctx.online.has(p.id), net };
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
    settings: { rounds: room.settings.rounds, showMeter: room.settings.showMeter, subjectAnswers: room.settings.subjectAnswers, timeLimit: room.settings.timeLimit || 'off' },
    gamesPlayed: room.gamesPlayed,
    wins: room.wins || {},
    game: null,
  };
  if (!g) return view;
  const gv = {
    id: g.id,
    number: g.number,
    n: g.n,
    idx: g.idx,
    phase: g.phase,
    levels: g.levels,
    isLast: g.idx + 1 >= g.n,
  };
  // Totals stay secret during the last round — the podium reveals them.
  if (!(gv.isLast && g.phase !== 'final')) gv.scores = g.scores;
  if (g.q) {
    gv.q = { key: g.q.key, level: g.q.level, segments: g.q.segments, about: g.q.about, participants: g.q.participants, answerers: g.q.answerers, generic: !!g.q.generic };
  }
  if (g.timer && (g.phase === 'answer' || g.phase === 'vote')) {
    gv.timer = { remaining: g.timer.endsAt - ctx.now, total: g.timer.total || TIMER_MS, hard: !!g.timer.hard, startsIn: Math.max(0, (g.timer.start || 0) - ctx.now) };
  }
  if (g.phase === 'answer') {
    gv.answered = Object.keys(g.answers).filter((p) => g.q.answerers.includes(p));
    gv.myAnswer = g.answers[pid] ? g.answers[pid].text : null;
    gv.stalled = !!g.stalled;
  }
  if (g.phase === 'vote') {
    const rand = seeded(g.q.key + ':' + pid);
    gv.options = shuffle(g.options, rand).map((o) => ({ oid: o.oid, text: o.text, mine: o.pid === pid }));
    gv.voters = g.voters.filter((p) => isActive(room, p));
    gv.voted = Object.keys(g.votes);
    gv.myVote = g.votes[pid] || null;
  }
  if (g.phase === 'results') {
    gv.result = gv.isLast ? { ...g.result, before: null, after: null } : g.result;
    gv.autoAnswered = g.q.answerers.filter((p) => g.answers[p] && g.answers[p].auto);
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
