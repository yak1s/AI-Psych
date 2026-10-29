// Screenshots for the README (phone-sized).
import { startWorld, hostRoom, joinRoom, tap, sleep, state, until, answerAll, voteAll } from './harness.js';
const OUT = new URL('../../docs/screenshots/', import.meta.url).pathname;
const phone = { width: 390, height: 844, scale: 2 };
const shot = async (p, name, opts = {}) => {
  await sleep(opts.wait ?? 900);
  await p.screenshot({ path: OUT + name + '.jpg', type: 'jpeg', quality: 82, ...opts.clip });
  console.log('saved', name);
};
const world = await startWorld();
const home = await world.device('home', phone);
await home.goto(world.base + '?' + world.query());
await shot(home, 'home', { wait: 2200 });

const { host, code } = await hostRoom(world, 'Sarah', { width: 1180, height: 900 });
const names = [['Mommy', '🦉'], ['Daddy', '🦖'], ['Leo', '🐸'], ['Mia', '🦄']];
const ps = [];
for (const [n] of names) ps.push(await joinRoom(world, code, n, phone));
await host.getByTestId('deck-input').setInputFiles(new URL('../../decks/template.json', import.meta.url).pathname);
await sleep(800);
await shot(host, 'host-lobby', { wait: 1200 });
// AI helper needs no deck loaded: remove it, open the helper, then put the deck back
await host.getByRole('button', { name: 'Remove', exact: true }).click({ force: true });
await tap(host, 'ai-deck');
await host.getByTestId('ai-helper').waitFor();
await shot(host, 'ai-deck-helper', { wait: 900 });
await host.keyboard.press('Escape');
await host.mouse.click(5, 5);
await host.getByTestId('deck-input').setInputFiles(new URL('../../decks/template.json', import.meta.url).pathname);
await sleep(600);

// Device clues so the AI has something to notice.
const [mom, dad, leo, mia] = ps;
await host.evaluate(() => {
  const c = window.__aipsych.current;
  const ids = Object.fromEntries(c.room.players.map((p) => [p.name, p.id]));
  const base = { country: 'US', countryName: 'the US', area: 'the US East Coast', os: 'Android', device: 'phone', brand: 'Samsung', lang: 'en-US', langs: ['en-US'] };
  c.room.signals[ids.Sarah] = { ...base };
  c.room.signals[ids.Mommy] = { ...base, country: 'BR', countryName: 'Brazil', area: 'Brazil', lang: 'pt-BR', langs: ['pt-BR', 'en-US'] };
  c.room.signals[ids.Daddy] = { ...base, os: 'iOS', brand: 'Apple' };
  c.room.signals[ids.Leo] = { ...base };
  c.room.signals[ids.Mia] = { ...base };
  c.room.settings.rounds = 5;
  c.commit();
});
await tap(host, 'start-game');
const all = [host, ...ps];
// Q1: answer & vote, with Leo not voting (no vote, no points)
const answer = async (texts) => {
  for (const p of all) await p.getByTestId('answer-form').or(p.getByTestId('answer-waiting')).first().waitFor({ timeout: 20000 });
  for (const [i, p] of all.entries()) if (await p.getByTestId('answer-input').count()) { await p.getByTestId('answer-input').fill(texts[i]); await tap(p, 'submit-answer'); }
};
await answer(['A lifetime supply of bubble wrap', 'Her secret banana bread recipe', 'Three hundred rubber ducks', 'The TV remote, hidden forever', 'A llama named Kevin']);
for (const p of all) await p.getByTestId('vote-phase').waitFor();
await sleep(5000);
await shot(mia, 'vote', { wait: 400 });
for (const p of [host, mom, dad, mia]) { const o = p.getByTestId('option').first(); await o.click({ force: true }); await tap(p, 'lock-vote'); }
await tap(host, 'end-phase');
await sleep(600);
await host.screenshot({ path: '/tmp/claude-0/-home-user-AI-Psych/3f276d0c-66b3-5c7c-9149-08ceb875f643/scratchpad/dbg-host.png' });
console.log(await state(host, (c) => ({ phase: c.view.game.phase, voted: c.view.game.voted.length, voters: c.view.game.voters.length })));
await host.getByRole('button', { name: 'Show results' }).click({ force: true, timeout: 5000 });
await mom.getByTestId('results-phase').waitFor();
await mom.getByText('skip ⏩').click({ force: true }).catch(() => {});
await sleep(1500);
const forfeit = mom.getByTestId('forfeit');
if (await forfeit.count()) await forfeit.first().scrollIntoViewIfNeeded();
else await mom.evaluate(() => scrollTo(0, 260));
await shot(mom, 'results', { wait: 700 });
// chat while waiting
for (const p of [mom, dad, mia]) await tap(p, 'ready-btn');
await mom.getByTestId('chat-input').waitFor();
await sleep(400);
await mom.getByTestId('chat-input').fill('who wrote the llama one 😂');
await tap(mom, 'chat-send');
await sleep(500);
await mia.getByTestId('chat-input').fill('not me!! it was definitely Daddy');
await tap(mia, 'chat-send');
await sleep(500);
await dad.getByTestId('chat-bubble').first().click({ force: true });
await dad.locator('.react-bar button', { hasText: '🤣' }).click({ force: true });
await sleep(900);
await mom.getByTestId('chat').scrollIntoViewIfNeeded();
await shot(mom, 'chat', { wait: 600 });
await tap(host, 'force-next');

// Hunt for a "the AI noticed something" question for the screenshot
await host.evaluate(() => {
  const c = window.__aipsych.current;
  const ids = Object.fromEntries(c.room.players.map((p) => [p.name, p.id]));
  const base = { country: 'US', countryName: 'the US', area: 'the US East Coast', os: 'Android', device: 'phone', brand: 'Samsung', lang: 'en-US', langs: ['en-US'] };
  c.room.signals[ids.Sarah] = { ...base };
  c.room.signals[ids.Mommy] = { ...base, country: 'BR', countryName: 'Brazil', area: 'Brazil', lang: 'pt-BR', langs: ['pt-BR', 'en-US'] };
  c.room.signals[ids.Daddy] = { ...base, os: 'iOS', brand: 'Apple' };
  c.room.signals[ids.Leo] = { ...base };
  c.room.signals[ids.Mia] = { ...base };
  c.room.settings.rounds = 5;
  c.commit();
});
for (let i = 0; i < 40; i++) {
  const q = await state(host, (c) => c.room.game.q);
  if (q.kind === 'clue' && ['place', 'device', 'lang'].includes(q.cat)) break;
  await host.evaluate(() => {
    const c = window.__aipsych.current;
    c.room.game.idx = 2 + (Date.now() % 2);
    c.dispatch({ type: 'skipQuestion' });
  });
  await sleep(150);
}
console.log('clue question:', await state(host, (c) => c.room.game.q.text));
await dad.getByTestId('ai-intro').waitFor({ timeout: 10000 }).catch(() => {});
await sleep(1800);
await shot(dad, 'question-intro', { wait: 300 });
await dad.getByTestId('answer-form').waitFor({ timeout: 15000 });
await shot(dad, 'question-clue', { wait: 2600 });

// mid-game join + host approval + greeting
const zoe = await world.device('Zoe', phone);
await zoe.goto(world.base + `?room=${code}&` + world.query());
await zoe.getByTestId('name-input').fill('Zoe');
await tap(zoe, 'join-go');
await host.getByTestId('admit').waitFor();
await sleep(600);
await tap(host, 'admit');
await mia.getByTestId('greeting').waitFor();
await shot(mia, 'greeting', { wait: 700 });

// Last round: play it, then fix the scores for a tie in second place
await host.evaluate(() => {
  const c = window.__aipsych.current;
  c.room.game.idx = c.room.game.n - 1;
  c.commit();
});
await answerAll(all);
await voteAll(all);
await host.evaluate(() => {
  const c = window.__aipsych.current;
  const ids = Object.fromEntries(c.room.players.map((p) => [p.name, p.id]));
  Object.assign(c.room.game.scores, { [ids.Sarah]: 7, [ids.Mommy]: 11, [ids.Daddy]: 7, [ids.Leo]: 3, [ids.Mia]: 4, [ids.Zoe]: 0 });
  c.dispatch({ type: 'next' });
});
await mia.getByTestId('final-phase').waitFor({ timeout: 20000 });
await sleep(6500);
await mia.evaluate(() => scrollTo(0, 0));
await shot(mia, 'winner', { wait: 500 });
await world.close();
process.exit(0);
