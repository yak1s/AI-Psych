import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../js/game/engine.js';
import { parseDeck, TEMPLATE_DECK } from '../js/game/deck.js';
import { setRandom, seeded } from '../js/game/util.js';
import { dynamicCandidates } from '../js/game/dynamic.js';

setRandom(seeded('tests'));

function setup(names = ['Host', 'Ann', 'Bob', 'Cid']) {
  const room = E.createRoom({ code: '1234', host: { name: names[0], avatar: '🦄' } });
  room.settings.clues = false; // dynamic "clue" questions have their own tests
  for (const n of names.slice(1)) assert.ok(E.addPlayer(room, { name: n, avatar: '🐸' }).ok);
  const ids = Object.fromEntries(room.players.map((p) => [p.name, p.id]));
  const online = new Set(room.players.map((p) => p.id));
  const ctx = { now: 1000, online };
  const act = (name, action) => E.apply(room, ids[name], action, ctx);
  return { room, ids, ctx, act, names };
}

function playRound(t, answerFor = (n) => `answer of ${n}`) {
  const g = t.room.game;
  assert.equal(g.phase, 'answer');
  for (const n of t.names) {
    if (g.q.answerers.includes(t.ids[n])) assert.ok(t.act(n, { type: 'answer', text: answerFor(n), qkey: g.q.key }).ok);
  }
  assert.equal(g.phase, 'vote');
  // everyone votes for the first option that isn't theirs
  for (const n of t.names) {
    if (!g.voters.includes(t.ids[n])) continue;
    const opt = g.options.find((o) => o.pid !== t.ids[n]);
    assert.ok(t.act(n, { type: 'vote', oid: opt.oid, qkey: g.q.key }).ok);
  }
  assert.equal(g.phase, 'results');
}

test('names must be unique and room caps at 30', () => {
  const t = setup();
  assert.equal(E.addPlayer(t.room, { name: 'ann' }).error, 'name-taken');
  for (let i = 0; i < 26; i++) assert.ok(E.addPlayer(t.room, { name: 'P' + i }).ok);
  assert.equal(E.addPlayer(t.room, { name: 'Late' }).error, 'room-full');
  const colors = new Set(t.room.players.map((p) => p.color));
  assert.equal(colors.size, 30, 'every player gets a distinct color');
});

test('full game: scoring gives 2 points for the subject vote, 1 otherwise', () => {
  const t = setup();
  t.room.settings.rounds = 5;
  assert.ok(t.act('Host', { type: 'start' }).ok);
  const g = t.room.game;
  assert.equal(g.n, 5);
  let expectedTotal = 0;
  for (let r = 0; r < 5; r++) {
    playRound(t);
    const about = g.q.about;
    for (const e of g.result.entries) {
      for (const v of e.votes) assert.equal(v.pts, about.includes(v.pid) ? 2 : 1);
    }
    expectedTotal += Object.keys(g.votes).reduce((s, voter) => s + (about.includes(voter) ? 2 : 1), 0);
    for (const n of t.names) t.act(n, { type: 'ready', qkey: g.q.key });
  }
  assert.equal(g.phase, 'final');
  const total = Object.values(g.scores).reduce((a, b) => a + b, 0);
  assert.equal(total, expectedTotal);
  assert.equal(g.final.ranking.length, 4);
  assert.equal(g.final.ranking[0].rank, 1);
});

test('cannot vote for your own answer, and votes are locked', () => {
  const t = setup(['Host', 'Ann', 'Bob']);
  t.act('Host', { type: 'start' });
  const g = t.room.game;
  for (const n of t.names) t.act(n, { type: 'answer', text: 'x' + n, qkey: g.q.key });
  const own = g.options.find((o) => o.pid === t.ids.Ann);
  assert.equal(t.act('Ann', { type: 'vote', oid: own.oid }).error, 'own-answer');
  const other = g.options.find((o) => o.pid !== t.ids.Ann);
  assert.ok(t.act('Ann', { type: 'vote', oid: other.oid }).ok);
  const third = g.options.find((o) => o.pid !== t.ids.Ann && o.oid !== other.oid);
  assert.equal(t.act('Ann', { type: 'vote', oid: third.oid }).ok, false);
});

test('views hide other answers and authors until results', () => {
  const t = setup(['Host', 'Ann', 'Bob']);
  t.act('Host', { type: 'start' });
  const g = t.room.game;
  t.act('Ann', { type: 'answer', text: 'secret ann', qkey: g.q.key });
  const v = E.viewFor(t.room, t.ids.Bob, t.ctx);
  assert.deepEqual(v.game.answered, [t.ids.Ann]);
  assert.equal(v.game.myAnswer, null);
  assert.ok(!JSON.stringify(v).includes('secret ann'));
  t.act('Bob', { type: 'answer', text: 'secret bob', qkey: g.q.key });
  t.act('Host', { type: 'answer', text: 'secret host', qkey: g.q.key });
  const vote = E.viewFor(t.room, t.ids.Bob, t.ctx);
  assert.equal(vote.game.phase, 'vote');
  assert.equal(vote.game.options.length, 3);
  assert.equal(vote.game.options.filter((o) => o.mine).length, 1);
  assert.ok(!JSON.stringify(vote.game.options).includes(t.ids.Ann), 'authors hidden during vote');
  assert.ok(!JSON.stringify(vote).includes(t.room.players[1].secret), 'player secrets never leak');
});

test('host timer, move on without missing players, and skip question', () => {
  const t = setup();
  t.act('Host', { type: 'start' });
  const g = t.room.game;
  const firstKey = g.q.key;
  const firstId = g.q.id;
  assert.equal(t.act('Ann', { type: 'timer', on: true }).error, 'host-only');
  assert.ok(t.act('Host', { type: 'timer', on: true }).ok);
  assert.ok(E.viewFor(t.room, t.ids.Ann, t.ctx).game.timer.remaining > 40000);
  // skip entire question: answers discarded, new question for the same round
  t.act('Ann', { type: 'answer', text: 'hello', qkey: g.q.key });
  assert.ok(t.act('Host', { type: 'skipQuestion' }).ok);
  assert.equal(g.idx, 0);
  assert.notEqual(g.q.key, firstKey);
  assert.notEqual(g.q.id, firstId);
  assert.deepEqual(g.answers, {});
  assert.equal(g.timer, null);
  // stale answer for the skipped question is rejected
  assert.equal(t.act('Ann', { type: 'answer', text: 'late', qkey: firstKey }).error, 'stale');
  // move on without Cid
  t.act('Ann', { type: 'answer', text: 'a', qkey: g.q.key });
  t.act('Bob', { type: 'answer', text: 'b', qkey: g.q.key });
  assert.equal(g.phase, 'answer');
  assert.ok(t.act('Host', { type: 'moveOn' }).ok);
  assert.equal(g.phase, 'vote');
  assert.equal(g.options.length, 2);
  assert.ok(g.voters.includes(t.ids.Cid), 'players who did not answer can still vote');
});

test('ready: offline players do not block, host can force next', () => {
  const t = setup();
  t.act('Host', { type: 'start' });
  playRound(t);
  const g = t.room.game;
  t.ctx.online.delete(t.ids.Cid);
  for (const n of ['Host', 'Ann']) t.act(n, { type: 'ready' });
  assert.equal(g.phase, 'results');
  t.act('Bob', { type: 'ready' });
  assert.equal(g.phase, 'answer');
  assert.equal(g.idx, 1);
  playRound(t);
  assert.ok(t.act('Host', { type: 'next' }).ok);
  assert.equal(g.idx, 2);
});

test('questions are never reused within the same room, even across games', () => {
  const t = setup();
  t.room.settings.rounds = 15;
  const seen = new Set();
  for (let game = 0; game < 3; game++) {
    assert.ok(t.act('Host', { type: game ? 'playAgain' : 'start' }).ok);
    const g = t.room.game;
    while (g.phase !== 'final') {
      assert.ok(!seen.has(g.q.id), 'question reused');
      seen.add(g.q.id);
      playRound(t);
      t.act('Host', { type: 'next' });
    }
  }
  assert.equal(seen.size, 45);
});

test('deck: placeholders map to joined names, unassigned players are skipped, levels progress', () => {
  const t = setup(['Host', 'Mommy', 'Daddy-O', 'Sis']);
  const deck = parseDeck(
    JSON.stringify({
      players: ['Mom', 'Dad', 'Sarah', 'Uncle Bob'],
      questions: [
        { level: 1, text: 'L1 {Mom} a' }, { level: 1, text: 'L1 {Dad} b' }, { level: 1, text: 'L1 {Uncle Bob} never' },
        { level: 2, text: 'L2 {Sarah} c' }, { level: 2, text: 'L2 {Mom} and {Dad} d' },
        { level: 3, text: 'L3 {Dad} e' }, { level: 3, text: 'L3 {any} f' },
        { level: 4, text: 'L4 {Sarah} g' }, { level: 4, text: 'L4 {Uncle Bob} never' },
        { level: 5, text: 'L5 {Mom} h' }, { level: 5, text: 'L5 {any} and {any2} i' },
      ],
    }),
    'fam.json',
  );
  assert.ok(deck.ok, deck.errors.join());
  assert.equal(deck.deck.predicted.length, 4);
  assert.ok(t.act('Host', { type: 'deck', deck: deck.deck }).ok);
  t.act('Host', { type: 'assign', key: 'mom', pid: t.ids.Mommy });
  t.act('Host', { type: 'assign', key: 'dad', pid: t.ids['Daddy-O'] });
  t.act('Host', { type: 'assign', key: 'sarah', pid: t.ids.Sis });
  t.room.settings.rounds = 5;
  t.room.settings.fillStarter = false;
  const info = E.hostInfo(t.room);
  assert.equal(info.pool.deck, 9, 'Uncle Bob questions are not eligible');
  assert.ok(t.act('Host', { type: 'start' }).ok);
  const g = t.room.game;
  assert.deepEqual(g.levels, [1, 2, 3, 4, 5]);
  const levels = [];
  while (g.phase !== 'final') {
    const text = g.q.segments.map((s) => s.v).join('');
    assert.ok(!text.includes('{'), 'no raw placeholders: ' + text);
    assert.ok(!text.includes('never'));
    assert.ok(!/\b(Mom|Dad|Sarah)\b/.test(text), 'uses joined names, not predicted names: ' + text);
    for (const s of g.q.segments.filter((x) => x.t === 'p')) assert.ok(g.q.about.includes(s.pid));
    levels.push(g.q.level);
    playRound(t);
    t.act('Host', { type: 'next' });
  }
  assert.deepEqual(levels, [1, 2, 3, 4, 5]);
});

test('level progression is monotonic for longer games', () => {
  const t = setup();
  t.room.settings.rounds = 15;
  t.act('Host', { type: 'start' });
  const g = t.room.game;
  const levels = [];
  while (g.phase !== 'final') {
    levels.push(g.q.level);
    playRound(t);
    t.act('Host', { type: 'next' });
  }
  assert.equal(levels.length, 15);
  for (let i = 1; i < levels.length; i++) assert.ok(levels[i] >= levels[i - 1], levels.join(','));
  assert.deepEqual(levels, [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5], 'three questions per level');
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => E.targetLevel([1, 2, 3, 4, 5], i, 10)), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  assert.deepEqual([0, 1, 2].map((i) => E.targetLevel([1, 2, 3, 4, 5], i, 3)), [1, 3, 5], 'short games still end at the top');
});

test('subject may be excluded from answering', () => {
  const t = setup();
  t.room.settings.subjectAnswers = false;
  t.act('Host', { type: 'start' });
  const g = t.room.game;
  for (const pid of g.q.about) assert.ok(!g.q.answerers.includes(pid));
  playRound(t);
});

test('kicking a player unblocks the phase; kicked players cannot act', () => {
  const t = setup();
  t.act('Host', { type: 'start' });
  const g = t.room.game;
  for (const n of ['Host', 'Ann', 'Bob']) if (g.q.answerers.includes(t.ids[n])) t.act(n, { type: 'answer', text: n, qkey: g.q.key });
  assert.ok(t.act('Host', { type: 'kick', pid: t.ids.Cid }).ok);
  assert.equal(g.phase, 'vote');
  assert.equal(t.act('Cid', { type: 'vote', oid: g.options[0].oid }).error, 'not-in-room');
});

test('action ids are deduplicated', () => {
  const t = setup();
  assert.equal(E.seenAction(t.room, t.ids.Ann, 'a1'), false);
  assert.equal(E.seenAction(t.room, t.ids.Ann, 'a1'), true);
});

test('parse TXT and CSV decks', () => {
  const txt = parseDeck('Title: Test\nPlayers: Mom, Dad\n\n[Level 1]\nWhat is {Mom} doing?\n# comment\n[Level 3]\nWhy is {Dad} {any}?\n5| Very {Mom}\n', 'q.txt');
  assert.ok(txt.ok);
  assert.equal(txt.deck.title, 'Test');
  assert.deepEqual(txt.deck.questions.map((q) => q.level), [1, 3, 5]);
  assert.deepEqual(txt.deck.questions[1].wild, [1]);
  const csv = parseDeck('level,question\n1,"Hello, {Mom}"\n4,Creepy {Dad}\n', 'q.csv');
  assert.ok(csv.ok);
  assert.equal(csv.deck.questions[0].text, 'Hello, {Mom}');
  assert.equal(csv.deck.questions[1].level, 4);
  const bad = parseDeck('{ nope', 'x.json');
  assert.equal(bad.ok, false);
  const tpl = parseDeck(JSON.stringify(TEMPLATE_DECK), 't.json');
  assert.ok(tpl.ok);
  assert.equal(tpl.deck.questions.length, TEMPLATE_DECK.questions.length);
});

test('a deck can be uploaded before anyone joins', () => {
  const room = E.createRoom({ code: '1234', host: { name: 'Solo' } });
  const deck = parseDeck(JSON.stringify(TEMPLATE_DECK), 't.json').deck;
  assert.ok(E.apply(room, room.hostPid, { type: 'deck', deck }, { now: 1, online: new Set() }).ok);
});

test('time running out submits what was typed; an unsent edit keeps the original', () => {
  const t = setup(['Host', 'Ann', 'Bob', 'Cid']);
  t.act('Host', { type: 'start' });
  const g = t.room.game;
  t.act('Host', { type: 'answer', text: 'host original', qkey: g.q.key });
  E.setDraft(t.room, t.ids.Host, 'host edited but never sent', g.q.key); // editing after submitting
  E.setDraft(t.room, t.ids.Ann, 'ann typed this', g.q.key);
  E.setDraft(t.room, t.ids.Bob, '   ', g.q.key); // blank drafts don't count
  assert.ok(t.act('Host', { type: 'moveOn' }).ok);
  const texts = Object.fromEntries(g.options.map((o) => [o.pid, o.text]));
  assert.equal(texts[t.ids.Host], 'host original');
  assert.equal(texts[t.ids.Ann], 'ann typed this');
  assert.equal(texts[t.ids.Bob], undefined);
  assert.equal(texts[t.ids.Cid], undefined);
});

test('hard time limits auto-advance answer and vote phases', () => {
  const t = setup();
  t.act('Host', { type: 'settings', settings: { timeLimit: 'normal' } });
  t.act('Host', { type: 'start' });
  const g = t.room.game;
  assert.ok(g.timer.hard);
  assert.equal(g.timer.total, 90000);
  assert.equal(E.tick(t.room, { ...t.ctx, now: g.timer.endsAt }), false, 'grace period for last keystrokes');
  E.setDraft(t.room, t.ids.Ann, 'half-finished thou', g.q.key);
  t.act('Bob', { type: 'answer', text: 'bob', qkey: g.q.key });
  assert.ok(E.tick(t.room, { ...t.ctx, now: g.timer.endsAt + 2000 }));
  assert.equal(g.phase, 'vote');
  assert.equal(g.options.length, 2);
  assert.equal(g.timer.total, 45000);
  assert.ok(E.tick(t.room, { ...t.ctx, now: g.timer.endsAt + 2000 }));
  assert.equal(g.phase, 'vote', 'Ann and Bob get 10 more seconds (first time this game)');
  assert.ok(E.tick(t.room, { ...t.ctx, now: g.timer.endsAt + 2000 }));
  assert.equal(g.phase, 'results');
});

test('hard limit with nobody answering waits for the host instead of burning questions', () => {
  const t = setup();
  t.act('Host', { type: 'settings', settings: { timeLimit: 'fast' } });
  t.act('Host', { type: 'start' });
  const g = t.room.game;
  const key = g.q.key;
  assert.ok(E.tick(t.room, { ...t.ctx, now: g.timer.endsAt + 2000 }));
  assert.equal(g.phase, 'answer');
  assert.equal(g.q.key, key);
  assert.equal(g.timer, null);
  assert.ok(E.viewFor(t.room, t.ids.Ann, t.ctx).game.stalled);
});

test('host timer lengths 30/45/60', () => {
  const t = setup();
  t.act('Host', { type: 'start' });
  t.act('Host', { type: 'timer', on: true, seconds: 30 });
  assert.equal(t.room.game.timer.total, 30000);
  t.act('Host', { type: 'timer', on: true, seconds: 60 });
  assert.equal(t.room.game.timer.endsAt - t.ctx.now, 60000);
});

test('last round hides running totals until the podium', () => {
  const t = setup();
  t.room.settings.rounds = 5;
  t.act('Host', { type: 'start' });
  const g = t.room.game;
  for (let r = 0; r < 4; r++) {
    playRound(t);
    assert.ok(E.viewFor(t.room, t.ids.Ann, t.ctx).game.result.after);
    t.act('Host', { type: 'next' });
  }
  playRound(t);
  const v = E.viewFor(t.room, t.ids.Ann, t.ctx).game;
  assert.ok(v.isLast);
  assert.equal(v.scores, undefined);
  assert.equal(v.result.after, null);
  assert.ok(v.result.entries.length, 'round answers are still revealed');
  t.act('Host', { type: 'next' });
  assert.ok(E.viewFor(t.room, t.ids.Ann, t.ctx).game.scores, 'podium shows totals');
});

test('awards rotate between games', () => {
  const t = setup(['Host', 'Ann', 'Bob', 'Cid', 'Dee']);
  t.room.settings.rounds = 10;
  const seen = [];
  for (let game = 0; game < 4; game++) {
    t.act('Host', { type: game ? 'playAgain' : 'start' });
    const g = t.room.game;
    while (g.phase !== 'final') {
      playRound(t, (n) => n.repeat(1 + Math.floor(Math.random() * 6)));
      t.act('Host', { type: 'next' });
    }
    assert.ok(g.final.awards.length >= 2 && g.final.awards.length <= 4, 'a handful of awards');
    seen.push(...g.final.awards.map((a) => a.id));
  }
  assert.ok(new Set(seen).size >= 7, 'many different awards across games: ' + [...new Set(seen)].join(','));
});

test('built-in questions are flagged so the AI can "struggle"', () => {
  const t = setup();
  t.act('Host', { type: 'start' });
  assert.equal(E.viewFor(t.room, t.ids.Ann, t.ctx).game.q.generic, true);
});

test('no vote, no points: a player who could vote but did not loses their own points', () => {
  const t = setup();
  t.act('Host', { type: 'start' });
  const g = t.room.game;
  for (const n of t.names) if (g.q.answerers.includes(t.ids[n])) t.act(n, { type: 'answer', text: 'a ' + n, qkey: g.q.key });
  const annOpt = g.options.find((o) => o.pid === t.ids.Ann);
  // everyone except Ann votes for Ann
  for (const n of ['Host', 'Bob', 'Cid']) t.act(n, { type: 'vote', oid: annOpt.oid, qkey: g.q.key });
  assert.ok(t.act('Host', { type: 'moveOn' }).ok);
  const e = g.result.entries.find((x) => x.pid === t.ids.Ann);
  assert.ok(e.forfeit > 0, 'points were forfeited');
  assert.equal(e.points, 0);
  assert.equal(g.scores[t.ids.Ann], 0);
});

test('a picked but not locked vote is counted when time runs out', () => {
  const t = setup();
  t.room.settings.timeLimit = 'fast';
  t.act('Host', { type: 'start' });
  const g = t.room.game;
  for (const n of t.names) if (g.q.answerers.includes(t.ids[n])) t.act(n, { type: 'answer', text: 'a ' + n, qkey: g.q.key });
  const pick = g.options.find((o) => o.pid !== t.ids.Ann);
  assert.ok(E.setVoteDraft(t.room, t.ids.Ann, pick.oid, g.q.key));
  assert.equal(E.setVoteDraft(t.room, t.ids.Ann, g.options.find((o) => o.pid === t.ids.Ann).oid, g.q.key), false, 'not your own');
  t.ctx.now = g.timer.endsAt + 5000;
  assert.ok(E.tick(t.room, t.ctx)); // the others get their one last chance first
  t.ctx.now = g.timer.endsAt + 5000;
  assert.ok(E.tick(t.room, t.ctx));
  assert.equal(g.phase, 'results');
  assert.equal(g.votes[t.ids.Ann], pick.oid);
  assert.deepEqual(g.result.autoVotes, [t.ids.Ann]);
});

test('a time limit waits (a little) for players whose connection just dropped', () => {
  const t = setup();
  t.room.settings.timeLimit = 'fast';
  t.act('Host', { type: 'start' });
  const g = t.room.game;
  t.act('Ann', { type: 'answer', text: 'hi', qkey: g.q.key });
  t.ctx.now = g.timer.endsAt + 2000;
  t.ctx.flaky = new Set([t.ids.Bob]);
  assert.ok(E.tick(t.room, t.ctx));
  assert.equal(g.phase, 'answer', 'still answering');
  assert.deepEqual(g.timer.waiting, [t.ids.Bob]);
  for (let i = 0; i < 10 && g.phase === 'answer'; i++) {
    t.ctx.now = g.timer.endsAt + 2000;
    E.tick(t.room, t.ctx);
  }
  assert.equal(g.phase, 'vote', 'but never forever');
  const before = g.timer.endsAt;
  E.pauseTimer(t.room, 7000);
  assert.equal(g.timer.endsAt, before + 7000);
});

test('from the second game on there are no level-1 questions', () => {
  const t = setup();
  t.room.settings.rounds = 5;
  t.act('Host', { type: 'start' });
  t.act('Host', { type: 'endGame' });
  t.act('Host', { type: 'start' });
  const g = t.room.game;
  const levels = [];
  for (let r = 0; r < 5; r++) {
    levels.push(g.q.level);
    playRound(t);
    t.act('Host', { type: 'next' });
  }
  assert.ok(levels.every((l) => l >= 2), 'levels ' + levels);
});

test('another device can take over hosting with the game intact', () => {
  const t = setup();
  t.room.settings.timeLimit = 'normal';
  t.act('Host', { type: 'start' });
  const g = t.room.game;
  t.act('Ann', { type: 'answer', text: 'kept', qkey: g.q.key });
  const snap = JSON.parse(JSON.stringify(t.room));
  const seq = snap.seq;
  assert.ok(E.promote(snap, t.ids.Bob, { now: 5_000_000, snapAt: t.ctx.now }));
  assert.equal(snap.hostPid, t.ids.Bob);
  assert.equal(snap.epoch, 1);
  assert.ok(snap.seq > seq + 500);
  assert.ok(snap.players.find((p) => p.id === t.ids.Bob).isHost);
  assert.ok(!snap.players.find((p) => p.id === t.ids.Host).isHost);
  assert.equal(snap.game.answers[t.ids.Ann].text, 'kept');
  assert.ok(snap.game.timer.endsAt - 5_000_000 >= 20000, 'clock restarted with time left');
  assert.deepEqual(E.demotedIdentity(snap, t.ids.Host).pid, t.ids.Host);
});

test('a disconnected player can get their seat back by name; mid-game joins need the host', () => {
  const t = setup();
  t.act('Host', { type: 'start' });
  const online = new Set([t.ids.Host, t.ids.Bob]);
  assert.equal(E.seatByName(t.room, { name: 'ANN ' }, online).id, t.ids.Ann);
  assert.equal(E.seatByName(t.room, { name: 'Bob' }, online), null, 'Bob is online: not claimable');
  assert.ok(E.inGame(t.room));
  const r = E.requestJoin(t.room, { joinId: 'j1', name: 'Dee', avatar: '🐸' }, t.ctx);
  assert.equal(r.status, 'waiting');
  assert.equal(E.hostInfo(t.room).requests.length, 1);
  assert.ok(t.act('Host', { type: 'admit', joinId: 'j1' }).ok);
  assert.equal(r.status, 'admitted');
  assert.equal(t.act('Ann', { type: 'admit', joinId: 'j1' }).error, 'host-only');
});

test('clue questions: built from device clues, only when the condition holds, capped per category', () => {
  const t = setup(['Host', 'Ann', 'Bob', 'Cid', 'Dee']);
  const us = { country: 'US', countryName: 'the US', os: 'Android', device: 'phone', lang: 'en-US', langs: ['en-US'] };
  for (const n of t.names) t.room.signals[t.ids[n]] = { ...us };
  t.room.signals[t.ids.Cid] = { ...us, country: 'AR', countryName: 'Argentina', os: 'iOS' };
  t.room.settings.clues = true;
  t.act('Host', { type: 'start' });
  const g = t.room.game;
  g.idx = 2;
  const c = dynamicCandidates(t.room, g, t.room.players.map((p) => p.id), t.ctx);
  const ids = c.map((x) => x.id);
  assert.ok(ids.includes('xplace-odd-country'), ids.join(','));
  assert.ok(ids.includes('xdev-only-iphone'));
  const q = c.find((x) => x.id === 'xplace-odd-country');
  assert.deepEqual(q.bind, { p1: t.ids.Cid });
  assert.ok(q.text.includes('Argentina') && q.text.includes('the US'), q.text);
  assert.ok(!c.some((x) => x.id === 'xlang-odd'), 'everyone has the same language: no language question');
  g.dynCats = { place: 2 };
  assert.ok(!dynamicCandidates(t.room, g, t.room.players.map((p) => p.id), t.ctx).some((x) => x.cat === 'place'), 'category cap');
});

test('questions other players already played elsewhere are avoided', () => {
  const t = setup();
  const pool = E.questionPool(t.room);
  // Everyone has seen every built-in question except one level-1 question.
  const keep = pool.primary.find((q) => q.level === 1);
  for (const n of t.names) t.room.seenBy[t.ids[n]] = Object.fromEntries(pool.primary.filter((q) => q !== keep).map((q) => [q.id, 2]));
  t.act('Host', { type: 'start' });
  assert.equal(t.room.game.q.id, keep.id);
  assert.ok(E.seenScore(t.room, keep.id, Object.values(t.ids)) > 0, 'now marked as seen');
});

test('first time a player runs out of time to vote in a game: a warning and 10 more seconds, once', () => {
  const t = setup();
  t.room.settings.timeLimit = 'fast';
  t.room.settings.rounds = 5;
  t.act('Host', { type: 'start' });
  const g = t.room.game;
  const voteRound = () => {
    for (const n of t.names) if (g.q.answerers.includes(t.ids[n])) t.act(n, { type: 'answer', text: 'a ' + n + g.idx, qkey: g.q.key });
    for (const n of ['Host', 'Ann', 'Cid']) t.act(n, { type: 'vote', oid: g.options.find((o) => o.pid !== t.ids[n]).oid, qkey: g.q.key });
  };
  voteRound();
  t.ctx.now = g.timer.endsAt + 2000;
  assert.ok(E.tick(t.room, t.ctx));
  assert.equal(g.phase, 'vote', 'Bob gets a last chance');
  assert.deepEqual(g.timer.lastChance, [t.ids.Bob]);
  assert.equal(g.timer.endsAt - t.ctx.now, E.LAST_CHANCE_MS);
  assert.deepEqual(E.viewFor(t.room, t.ids.Bob, t.ctx).game.timer.lastChance, [t.ids.Bob]);
  t.ctx.now = g.timer.endsAt + 2000;
  E.tick(t.room, t.ctx);
  assert.equal(g.phase, 'results', 'only one extension');
  // Next round, Bob runs out again: no more warnings this game.
  t.act('Host', { type: 'next' });
  voteRound();
  t.ctx.now = g.timer.endsAt + 2000;
  E.tick(t.room, t.ctx);
  assert.equal(g.phase, 'results', 'the warning is once per game');
});
