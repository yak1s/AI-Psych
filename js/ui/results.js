import { html, useState, useEffect } from '../vendor/preact-htm.js';
import { Btn, Avatar, PName, QuestionText, Doodle, cx, playerMap, useStep, confetti } from './common.js';
import { brush, wash } from './art.js';
import { seen, markSeen } from '../storage.js';
import { sfx, buzz } from './audio.js';

// ---------------------------------------------------------------------------
// Round results: answers revealed one by one, least popular first.

function ResultEntry({ e, stage, who, view, top, index }) {
  const author = who(e.pid);
  const judge = e.votes.filter((v) => v.pts === 2);
  return html`<div class=${cx('result', top && stage >= 2 && 'top')} style=${`background-image:${stage >= 1 ? wash(author.color, index + 30, { strength: 0.55 }) : 'none'}`} data-testid="result">
    <div class="ans">“${e.text}”</div>
    ${stage >= 1 &&
    html`<div class="author">
      <${Avatar} p=${author} size="sm" />
      <span class="by">— ${author.name}${e.pid === view.me ? ' (you!)' : ''}</span>
    </div>`}
    ${stage >= 2 &&
    html`<div class="voters">
        ${e.votes.length === 0 && html`<span class="crickets">🦗 crickets…</span>`}
        ${e.votes.map((v, i) => html`<span key=${v.pid} class=${cx('voter', v.pts === 2 && 'judge')} style=${`animation-delay:${i * 0.12}s`}>
          <${Avatar} p=${who(v.pid)} size="xs" /> ${who(v.pid).name} ${v.pts === 2 ? '⚖️ +2' : '+1'}
        </span>`)}
        ${judge.length > 0 && html`<span class="script" style="font-size:19px">the judge loved it!</span>`}
      </div>
      <div class=${cx('pts', e.points === 0 && 'zero')}>${e.points ? `+${e.points}` : '0'}</div>`}
  </div>`;
}

export function Scoreboard({ view, before, after, seenKey }) {
  const animate = !seenKey || !seen(seenKey);
  const who = playerMap(view);
  const ids = view.players.map((p) => p.id);
  const sortBy = (sc) => ids.slice().sort((a, b) => (sc[b] || 0) - (sc[a] || 0) || who(a).name.localeCompare(who(b).name));
  const orderAfter = sortBy(after);
  const orderBefore = sortBy(before);
  const [settled, setSettled] = useState(!animate);
  useEffect(() => {
    if (!animate) return;
    const t = setTimeout(() => {
      setSettled(true);
      sfx('whoosh');
      if (seenKey) markSeen(seenKey);
    }, 450);
    return () => clearTimeout(t);
  }, []);
  const max = Math.max(1, ...orderAfter.map((p) => after[p] || 0));
  const STEP = 50;
  let rank = 0;
  return html`<div class="card"><div class="card-title">${Doodle.star({ size: 24 })} Scoreboard</div>
    <div class="scoreboard" style=${`height:${orderAfter.length * STEP - 10}px`}>
      ${orderAfter.map((pid, i) => {
        const p = who(pid);
        const sc = settled ? after[pid] || 0 : before[pid] || 0;
        const delta = (after[pid] || 0) - (before[pid] || 0);
        const shift = settled ? 0 : (orderBefore.indexOf(pid) - i) * STEP;
        if (i === 0 || (after[pid] || 0) !== (after[orderAfter[i - 1]] || 0)) rank = i + 1;
        return html`<div key=${pid} class=${cx('score-row', pid === view.me && 'me')} style=${`position:absolute;left:0;right:0;top:${i * STEP}px;height:40px;transform:translateY(${shift}px)`}>
          <span class="rank">${rank === 1 && (after[pid] || 0) > 0 ? '👑' : rank}</span>
          <${Avatar} p=${p} size="sm" />
          <div class="bar"><i style=${`width:${(sc / max) * 100}%;background-image:${brush(p.color, i + 1)}`}></i><span>${p.name}</span></div>
          <span class="num">${sc}${settled && delta > 0 && html`<span class="delta">+${delta}</span>`}</span>
        </div>`;
      })}
    </div>
  </div>`;
}

function ReadyBar({ ctrl, view, isLast }) {
  const g = view.game;
  const who = playerMap(view);
  const ready = g.ready.includes(view.me);
  const waiting = view.players.filter((p) => p.online && !g.ready.includes(p.id));
  return html`<div class="card stack" style="align-items:center;text-align:center" data-testid="ready-bar">
    ${!ready
      ? html`<${Btn} big block color=${isLast ? 'sun' : 'mint'} pulse onClick=${() => ctrl.dispatch({ type: 'ready', qkey: g.q.key })} testid="ready-btn">
          ${isLast ? '🏆 Reveal the winner!' : 'Ready for the next one! 👍'}
        <//>`
      : html`<p class="script" style="font-size:26px;margin:0">${waiting.length ? 'Waiting for the others…' : "Here we go!"}</p>`}
    <div class="ready-strip">
      ${view.players.map((p) => html`<${Avatar} key=${p.id} p=${p} size="sm" off=${!p.online} badge=${g.ready.includes(p.id) ? '✓' : null} />`)}
    </div>
    ${ready && waiting.length > 0 && html`<span class="muted small">still waiting on ${waiting.map((p) => p.name).join(', ')}</span>`}
  </div>`;
}

export function ResultsPhase({ ctrl, view }) {
  const g = view.game;
  const r = g.result;
  const who = playerMap(view);
  const key = 'res.' + g.q.key;
  const [skip, setSkip] = useState(() => seen(key));
  const total = r.entries.length * 3;
  const step = useStep(total, (i) => (i % 3 === 0 ? 650 : i % 3 === 1 ? 850 : 1250), { key: g.q.key + skip, skip, delay: 600 });
  const done = step >= total;
  const maxPts = Math.max(0, ...r.entries.map((e) => e.points));
  const isLast = g.idx + 1 >= g.n;

  useEffect(() => {
    if (skip || step === 0) return;
    const idx = Math.floor((step - 1) / 3);
    const sub = (step - 1) % 3;
    const e = r.entries[idx];
    if (!e) return;
    if (sub === 0) sfx('reveal');
    else if (sub === 1) {
      sfx('stamp');
      buzz(25);
    } else {
      if (!e.votes.length) sfx('crickets');
      else if (e.points >= 3 || (e.points === maxPts && idx === r.entries.length - 1)) sfx('bigCoin');
      else sfx('coin');
      if (e.points === maxPts && maxPts > 0 && idx === r.entries.length - 1) confetti({ count: 70, origin: { x: 0.5, y: 0.6 } });
    }
  }, [step]);
  useEffect(() => {
    if (done) markSeen(key);
  }, [done]);

  const stageOf = (i) => (skip ? 3 : Math.max(0, Math.min(3, step - i * 3)));
  const visible = r.entries.filter((_, i) => stageOf(i) > 0);
  return html`<div class="stack enter" data-testid="results-phase">
    <div class="center"><h1 style="font-size:32px">The results are in!</h1></div>
    <div class="card flat" style="padding:12px 16px;text-align:center"><${QuestionText} segments=${g.q.segments} who=${who} animate=${false} compact /></div>
    <div class="result-list">
      ${r.entries.map((e, i) => (stageOf(i) > 0 ? html`<${ResultEntry} key=${e.oid} e=${e} index=${i} stage=${stageOf(i) - 1} who=${who} view=${view} top=${e.points === maxPts && maxPts > 0} />` : null))}
    </div>
    ${!done && visible.length < r.entries.length + 1 && html`<div class="center"><button class="link-btn" onClick=${() => { sfx('tap'); setSkip(true); markSeen(key); }}>skip ⏩</button></div>`}
    ${done &&
    html`
      ${r.missingAnswers.length > 0 && html`<p class="missing-note">🐢 No answer from ${r.missingAnswers.map((p) => who(p).name).join(', ')} this time.</p>`}
      <${Scoreboard} view=${view} before=${r.before} after=${r.after} seenKey=${key + '.sb'} />
      <${ReadyBar} ctrl=${ctrl} view=${view} isLast=${isLast} />
    `}
  </div>`;
}

// ---------------------------------------------------------------------------
// Final ceremony

function PodiumStep({ r, place, who }) {
  if (!r) return html`<div class=${`step p${place}`} style="visibility:hidden"><div class="block"></div></div>`;
  return html`<div class=${`step p${place}`}>
    <${Avatar} p=${who(r.pid)} size=${place === 1 ? 'lg' : ''} crown=${place === 1} />
    <div class="nm">${who(r.pid).name}</div>
    <div class="block">${r.score}</div>
  </div>`;
}

export function FinalPhase({ ctrl, view }) {
  const g = view.game;
  const f = g.final;
  const who = playerMap(view);
  const key = 'final.' + g.id;
  const [skip] = useState(() => seen(key));
  const step = useStep(4, (i) => [0, 1400, 1500, 2200][i] || 1500, { key: g.id, skip, delay: 2900 });
  const ranking = f.ranking.filter((r) => view.players.some((p) => p.id === r.pid));
  const winners = ranking.filter((r) => r.rank === 1);
  const second = ranking.find((r) => r.rank === 2) || null;
  const third = ranking.find((r) => r.rank === 3) || null;
  const me = ranking.find((r) => r.pid === view.me);
  const isHost = ctrl.isHost;

  useEffect(() => {
    if (skip) return;
    sfx('drumroll', { dur: 2.7 });
  }, []);
  useEffect(() => {
    const on = !skip && step < 3;
    document.body.classList.toggle('spotlight', on);
    return () => document.body.classList.remove('spotlight');
  }, [step, skip]);
  useEffect(() => {
    if (skip) return;
    if (step === 1 || step === 2) sfx('pop');
    if (step === 3) {
      sfx('fanfare');
      buzz([60, 40, 60, 40, 200]);
      confetti({ count: 200 });
      setTimeout(() => confetti({ count: 120, origin: { x: 0.15, y: 0.5 } }), 500);
      setTimeout(() => confetti({ count: 120, origin: { x: 0.85, y: 0.5 } }), 900);
    }
    if (step === 4) {
      markSeen(key);
      if (me && ranking.length > 2 && me.rank === ranking[ranking.length - 1].rank && me.rank !== 1) setTimeout(() => sfx('sadTrombone'), 600);
    }
  }, [step]);

  if (step === 0 && !skip) {
    return html`<div class="final-stage enter" data-testid="final-drumroll">
      <div style="height:18vh"></div>
      <div class="drum-text" style="position:relative;z-index:6">🥁 And the winner is<span class="dots"></span></div>
    </div>`;
  }

  return html`<div class="final-stage enter" data-testid="final-phase">
    ${step < 3 && html`<div class="final-caption" key=${step}>${step === 1 ? (third ? '🥉 In third place…' : '🥁 Drumroll…') : second ? '🥈 In second place…' : '🥁 Almost there…'}</div>`}
    ${step >= 3 &&
    html`<div class="stack" style="align-items:center;gap:6px">
      <div class="crown-drop">${Doodle.crown({ size: 90, sw: 3 })}</div>
      <div class="row center" style="gap:18px">${winners.map((w) => html`<${Avatar} key=${w.pid} p=${who(w.pid)} size="xl" bob />`)}</div>
      <div class="winner-label">${winners.length > 1 ? "IT'S A TIE!" : 'WINNER!'}</div>
      <div class="winner-name" data-testid="winner-name">
        ${winners.map((w) => who(w.pid).name).join(' & ').split('').map((ch, i) => html`<span key=${i} style=${`animation-delay:${i * 0.05}s, ${i * 0.12}s`}>${ch === ' ' ? ' ' : ch}</span>`)}
      </div>
      <div class="script" style="font-size:26px">with ${winners[0] ? winners[0].score : 0} points${winners.some((w) => w.pid === view.me) ? ' — that’s YOU! 🎉' : ''}</div>
    </div>`}
    <div class="podium" style="position:relative;z-index:6">
      ${step >= 2 ? html`<${PodiumStep} r=${second} place=${2} who=${who} />` : html`<div class="step" style="visibility:hidden"></div>`}
      ${step >= 3 ? html`<${PodiumStep} r=${winners[0]} place=${1} who=${who} />` : html`<div class="step" style="visibility:hidden"></div>`}
      ${step >= 1 ? html`<${PodiumStep} r=${third} place=${3} who=${who} />` : html`<div class="step" style="visibility:hidden"></div>`}
    </div>
    ${step >= 4 &&
    html`
      ${f.awards.length > 0 &&
      html`<div class="awards">
        ${f.awards.map((a, i) => html`<div key=${a.id} class="card award" style=${`animation-delay:${i * 0.25}s`}>
          <div class="emo">${a.emoji}</div><div class="t">${a.title}</div>
          <div class="row center" style="gap:6px"><${Avatar} p=${who(a.pid)} size="xs" /><b>${who(a.pid).name}</b></div>
          <div class="d">${a.detail}</div>
        </div>`)}
      </div>`}
      <div class="card" style="width:100%;text-align:left">
        <div class="card-title">${Doodle.star({ size: 24 })} Final scores</div>
        ${ranking.map((r) => html`<div key=${r.pid} class="row" style="justify-content:space-between;padding:4px 0;border-bottom:1.5px dashed var(--ink-faint)">
          <span class="row" style="gap:10px"><b style="font-family:var(--display);width:28px">${r.rank}</b><${Avatar} p=${who(r.pid)} size="sm" /> <${PName} p=${who(r.pid)} /></span>
          <b style="font-family:var(--display);font-size:22px">${r.score}</b>
        </div>`)}
      </div>
      ${f.reason === 'out-of-questions' && html`<p class="muted small">The AI ran out of fresh questions for this group, so the game ended early.</p>`}
      ${isHost
        ? html`<div class="row center">
            <${Btn} color="paper" sound="tap" onClick=${() => ctrl.dispatch({ type: 'endGame' })} testid="back-lobby">Back to lobby<//>
            <${Btn} big color="coral" pulse onClick=${() => ctrl.dispatch({ type: 'playAgain' })} sound="whoosh" testid="play-again">🔁 Play again<//>
          </div>
          <p class="muted small">New game, same room — the AI never repeats a question.</p>`
        : html`<p class="script" style="font-size:24px">Waiting for the host to start another round<span class="dots"></span></p>`}
    `}
  </div>`;
}
