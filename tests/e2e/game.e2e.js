// End-to-end tests: real browsers, real WebRTC, a private signaling server.
// Run with: npm run test:e2e   (see README)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startWorld, hostRoom, joinRoom, tap, state, until, sleep, onlineCount, answerAll, voteAll } from './harness.js';

let world;
before(async () => {
  world = await startWorld();
});
after(async () => {
  await world.close();
  assert.deepEqual(world.errors, [], 'no page errors');
});

test('a full game with a secret deck, a player refresh and a host refresh', { timeout: 240000 }, async () => {
  const { host, code } = await hostRoom(world, 'Sarah', { width: 1100, height: 900 });
  // The deck can go in before anyone joins; names match up as people arrive.
  await host.getByTestId('deck-input').setInputFiles(new URL('../../decks/template.json', import.meta.url).pathname);
  await host.getByTestId('assign-mom').waitFor();
  const mommy = await joinRoom(world, code, 'Mommy');
  const daddy = await joinRoom(world, code, 'Daddy');
  const all = [host, mommy, daddy];

  await until(() => state(host, (c) => c.room.assign.mom && c.room.assign.dad && c.room.assign.sarah));
  assert.equal(await state(host, (c) => c.room.assign['grandpa joe'] || null), null, 'Grandpa Joe did not join');

  await host.getByRole('radio', { name: '5', exact: true }).click({ force: true });
  await tap(host, 'start-game');

  const levels = [];
  for (let round = 0; round < 5; round++) {
    const q = await state(host, (c) => c.view.game.q);
    const text = q.segments.map((s) => s.v).join('');
    levels.push(q.level);
    assert.ok(!/[{}]/.test(text) && !/\b(Mom|Dad|Grandpa)\b/.test(text), 'uses joined names: ' + text);

    if (round === 1) {
      // A player refreshes while typing: the draft and the seat survive.
      await mommy.getByTestId('answer-input').waitFor({ timeout: 20000 });
      await mommy.getByTestId('answer-input').fill('a draft that survives');
      await mommy.reload();
      await mommy.getByTestId('answer-input').waitFor({ timeout: 20000 });
      assert.equal(await mommy.getByTestId('answer-input').inputValue(), 'a draft that survives');
    }
    if (round === 2) {
      // The host refreshes mid-question: everyone is back within seconds.
      await host.reload();
      await until(() => state(host, (c) => c && c.net && c.status === 'online'));
      await until(async () => (await onlineCount(host)) === 2, 20000);
    }
    await answerAll(all);
    await voteAll(all);

    const res = await state(host, (c) => c.view.game.result);
    for (const e of res.entries) for (const v of e.votes) assert.equal(v.pts, q.about.includes(v.pid) ? 2 : 1, 'judge votes count double');
    if (round === 0) {
      for (const p of all) {
        await p.getByTestId('ready-btn').waitFor({ timeout: 30000 });
        await tap(p, 'ready-btn');
      }
    } else {
      await tap(host, 'force-next');
    }
  }
  assert.deepEqual(levels, [1, 2, 3, 4, 5], 'creepiness climbs slowly');

  for (const p of all) await p.getByTestId('final-drumroll').waitFor({ timeout: 20000 });
  const winner = await mommy.getByTestId('winner-name').textContent({ timeout: 20000 });
  const ranking = await state(host, (c) => c.view.game.final.ranking.map((r) => [c.view.players.find((p) => p.id === r.pid).name, r.rank]));
  assert.ok(ranking.filter((r) => r[1] === 1).some((r) => winner.includes(r[0])), `winner ${winner} is ranked 1 in ${JSON.stringify(ranking)}`);

  // Same room, new game: no question is ever repeated.
  const used = await state(host, (c) => c.room.used.slice());
  await tap(host, 'play-again');
  await until(() => state(host, (c) => c.view.game && c.view.game.phase === 'answer'));
  const next = await state(host, (c) => c.room.game.q.id);
  assert.ok(!used.includes(next), 'fresh question after play again');
  for (const p of all) await p.context().close();
});

test('connections heal after outages, ICE failures and a signaling restart', { timeout: 180000 }, async () => {
  const { host, code } = await hostRoom(world);
  const ann = await joinRoom(world, code, 'Ann');
  const bob = await joinRoom(world, code, 'Bob');

  // Ann's phone goes into a tunnel for 12 seconds.
  await ann.evaluate(() => window.__aipsych.current.net.simulateOutage(12000));
  await until(async () => (await onlineCount(host)) === 1, 20000);
  await until(async () => (await onlineCount(host)) === 2, 25000);

  // Bob's peer connection dies abruptly.
  await bob.evaluate(() => window.__aipsych.current.net.conn.peerConnection.close());
  await until(() => state(bob, (c) => c.status === 'connected' && c.welcomed), 15000);
  await until(async () => (await onlineCount(host)) === 2, 15000);

  // The signaling server goes down: existing players stay connected, new players can join after.
  await world.restartSignal(4000);
  assert.equal(await onlineCount(host), 2);
  await until(() => state(host, (c) => c.status === 'online'), 30000);
  const cid = await joinRoom(world, code, 'Cid');

  // The host itself drops off for 12 seconds; an answer submitted meanwhile is delivered after.
  await tap(host, 'start-game');
  await ann.getByTestId('answer-input').waitFor({ timeout: 20000 });
  await host.evaluate(() => window.__aipsych.current.net.simulateOutage(12000));
  await ann.getByTestId('answer-input').fill('sent during an outage');
  await tap(ann, 'submit-answer');
  await until(async () => (await onlineCount(host)) === 3, 45000);
  await until(() => state(host, (c) => Object.values(c.room.game.answers).some((a) => a.text === 'sent during an outage')), 15000);

  // Closing the tab and coming back later: the home screen offers to rejoin.
  const ctx = cid.context();
  await cid.close();
  const cid2 = await world.device('Cid again', { context: ctx });
  await cid2.goto(world.base + '?' + world.query());
  await tap(cid2, 'resume-player');
  await cid2.getByTestId('answer-form').or(cid2.getByTestId('answer-waiting')).first().waitFor({ timeout: 20000 });
  for (const p of [host, ann, bob, cid2]) await p.context().close();
});

test('host timer needs confirmation, skip question, kick and late join', { timeout: 120000 }, async () => {
  const { host, code } = await hostRoom(world);
  const ann = await joinRoom(world, code, 'Ann');
  const bob = await joinRoom(world, code, 'Bob');
  await tap(host, 'start-game');
  await host.getByTestId('answer-input').waitFor({ timeout: 20000 });

  // Skip: same round, brand new question, answers discarded.
  const first = await state(host, (c) => c.view.game.q.key);
  await ann.getByTestId('answer-input').waitFor({ timeout: 20000 });
  await ann.getByTestId('answer-input').fill('thrown away');
  await tap(ann, 'submit-answer');
  await tap(host, 'skip-question');
  await host.getByRole('button', { name: 'Skip it' }).click({ force: true });
  await until(async () => {
    const g = await state(host, (c) => c.view.game);
    return g.q.key !== first && g.idx === 0 && g.answered.length === 0;
  });

  // Timer: when it runs out the host must confirm moving on without Bob.
  await answerAll([host, ann]);
  await tap(host, 'start-timer');
  await tap(host, 'timer-30');
  assert.equal(await state(host, (c) => c.room.game.timer.total), 30000);
  await host.evaluate(() => {
    const c = window.__aipsych.current;
    c.room.game.timer.endsAt = Date.now() + 2500; // fast-forward the 45s for the test
    c.commit();
  });
  await host.getByTestId('confirm-move-on').waitFor({ timeout: 10000 });
  assert.equal(await state(host, (c) => c.view.game.phase), 'answer', 'nothing happens without the host');
  await tap(host, 'confirm-move-on');
  await voteAll([host, ann, bob]);
  const res = await state(host, (c) => c.view.game.result);
  assert.equal(res.entries.length, 2);
  assert.equal(res.missingAnswers.length, 1);

  // A late joiner plays from the next question; a kicked player is told so.
  const cid = await joinRoom(world, code, 'Cid').catch(() => null);
  assert.ok(cid, 'late joiner got in');
  await tap(host, 'force-next');
  await cid.getByTestId('answer-form').waitFor({ timeout: 20000 });
  const bobId = await state(bob, (c) => c.pid);
  await host.evaluate((pid) => window.__aipsych.current.dispatch({ type: 'kick', pid }), bobId);
  await bob.getByText('You were removed from the room').waitFor({ timeout: 10000 });
  for (const p of [host, ann, bob, cid]) await p.context().close();
});

test('players whose network blocks WebRTC (VPN, strict NAT) play through the encrypted relay', { timeout: 120000 }, async () => {
  const { host, code } = await hostRoom(world);
  const direct = await joinRoom(world, code, 'Direct');
  const blocked = await joinRoom(world, code, 'Vpn', { net: 'rtc=off' });
  assert.equal(await state(direct, (c) => c.transport), 'direct');
  assert.equal(await state(blocked, (c) => c.transport), 'relay');
  await host.getByRole('radio', { name: '5', exact: true }).click({ force: true });
  await tap(host, 'start-game');
  await answerAll([host, direct, blocked]);
  await voteAll([host, direct, blocked]);
  const res = await state(host, (c) => c.view.game.result.entries.map((e) => e.text));
  assert.ok(res.includes("Vpn's answer"), 'relay player answered');
  for (const p of [host, direct, blocked]) await p.context().close();
});

test('if the direct path dies mid-game the relay takes over without a disconnect', { timeout: 120000 }, async () => {
  const { host, code } = await hostRoom(world);
  const ann = await joinRoom(world, code, 'Ann');
  const bob = await joinRoom(world, code, 'Bob');
  await until(() => state(ann, (c) => c.transport === 'direct' && c.net.relayOpen), 20000);
  await tap(host, 'start-game');
  await ann.getByTestId('answer-input').waitFor({ timeout: 20000 });
  await ann.evaluate(() => window.__aipsych.current.net.disableDirect());
  // Watch presence on the host for a while: Ann must never drop offline.
  let dropped = false;
  for (let i = 0; i < 30; i++) {
    if ((await onlineCount(host)) < 2) dropped = true;
    await sleep(300);
  }
  assert.equal(dropped, false, 'no disconnect when the direct path died');
  assert.equal(await state(ann, (c) => c.transport), 'relay');
  await ann.getByTestId('answer-input').fill('still here via relay');
  await tap(ann, 'submit-answer');
  await until(() => state(host, (c) => Object.values(c.room.game.answers).some((a) => a.text === 'still here via relay')), 10000);
  for (const p of [host, ann, bob]) await p.context().close();
});

test('hard time limit sends whatever was typed and moves on by itself', { timeout: 120000 }, async () => {
  const { host, code } = await hostRoom(world);
  const ann = await joinRoom(world, code, 'Ann');
  const bob = await joinRoom(world, code, 'Bob', { net: 'rtc=off' });
  await host.getByRole('radio', { name: 'Fast', exact: true }).click({ force: true });
  await tap(host, 'start-game');
  for (const p of [ann, bob]) await p.getByTestId('answer-input').waitFor({ timeout: 20000 });
  await ann.getByTestId('answer-input').fill('typed but never submitted');
  await bob.getByTestId('answer-input').fill('bob submitted this');
  await tap(bob, 'submit-answer');
  // Bob opens his answer to edit it but runs out of time: his original stays.
  await bob.getByText('change it').click({ force: true });
  await bob.getByTestId('answer-input').fill('bob edit that never got sent');
  await sleep(1200);
  await host.evaluate(() => {
    const c = window.__aipsych.current;
    c.room.game.timer.endsAt = Date.now() + 1500; // fast-forward the 60s limit
    c.commit();
  });
  for (const p of [host, ann, bob]) await p.getByTestId('vote-phase').waitFor({ timeout: 15000 });
  const texts = await state(host, (c) => c.room.game.options.map((o) => o.text));
  assert.ok(texts.includes('typed but never submitted'), 'unsent text was submitted: ' + texts);
  assert.ok(texts.includes('bob submitted this'), 'original kept when the edit was not sent');
  assert.ok(!texts.includes('bob edit that never got sent'));
  // the voting limit also moves on by itself
  await host.evaluate(() => {
    const c = window.__aipsych.current;
    c.room.game.timer.endsAt = Date.now() + 500;
    c.commit();
  });
  for (const p of [host, ann, bob]) await p.getByTestId('results-phase').waitFor({ timeout: 15000 });
  for (const p of [host, ann, bob]) await p.context().close();
});
