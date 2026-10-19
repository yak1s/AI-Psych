import { html, useState, useEffect, useRef, useMemo } from '../vendor/preact-htm.js';
import { Btn, Avatar, Meter, QuestionText, TimerRing, Confirm, Modal, Doodle, cx, playerMap, useStep, useOnKey, useNow } from './common.js';
import { wash } from './art.js';
import { ANSWER_MAX } from '../game/engine.js';
import { levelInfo } from '../game/deck.js';
import { seen, markSeen, session } from '../storage.js';
import { sfx, buzz } from './audio.js';
import { seeded } from '../game/util.js';
import { AI_LINES, GENERIC_LINES, WRITE_QUIPS, WRITE_CREEPY, VOTE_QUIPS, VOTE_CREEPY, pickLines } from './lines.js';

// ---------------------------------------------------------------------------
// The "AI is writing a question" theatre

function Bot({ level }) {
  const red = level >= 4;
  return html`<div class="ai-bot">
    <div class="halo"></div>
    <svg viewBox="0 0 120 120" width="150" height="150" fill="none" stroke="#2d2a4a" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" style="position:relative">
      <path d="M60 14v14" /><circle cx="60" cy="11" r="6" fill=${red ? '#c8414b' : '#ffc93c'} />
      <path d="M22 40c0-8 6-12 14-12.5 16-1 32-1 48 0 8 .5 14 4.5 14 12.5v34c0 8-6 13-14 13.5-16 1-32 1-48 0C28 87 22 82 22 74z" fill="#fffcf4" />
      <path d="M22 50h-6v18h6M98 50h6v18h-6" />
      <g style="animation: blink 3.2s infinite; transform-origin: 60px 55px">
        <ellipse cx="44" cy="54" rx="9" ry=${red ? 6 : 9} fill=${red ? '#c8414b' : '#58b4f2'} />
        <ellipse cx="76" cy="54" rx="9" ry=${red ? 6 : 9} fill=${red ? '#c8414b' : '#58b4f2'} />
        <circle cx="46" cy="52" r="2.5" fill="#fff" stroke="none" /><circle cx="78" cy="52" r="2.5" fill="#fff" stroke="none" />
      </g>
      ${red ? html`<path d="M44 76c6-4 26-4 32 0" />` : html`<path d="M42 72c8 8 28 8 36 0" />`}
      <path d="M40 100c12-4 28-4 40 0" />
    </svg>
  </div>`;
}

export function AiIntro({ view, onDone }) {
  const g = view.game;
  const who = playerMap(view);
  const level = g.q.level;
  const name = g.q.about.length ? who(g.q.about[0]).name : 'everyone';
  const generic = g.q.generic;
  const lines = useMemo(() => {
    const rand = seeded(g.q.key);
    const pool = generic ? GENERIC_LINES : AI_LINES[level] || AI_LINES[1];
    return pickLines(pool, 3, rand).map((l) => l.replace(/\{name\}/g, name));
  }, [g.q.key]);
  const step = useStep(lines.length, 850, { key: g.q.key, delay: 350 });
  useEffect(() => {
    sfx('magic');
    if (level >= 4) setTimeout(() => sfx('creepy'), 500);
  }, [g.q.key]);
  useEffect(() => {
    if (step > 0) sfx(level >= 4 && step === lines.length ? 'glitch' : 'type');
    if (step === lines.length) {
      const t = setTimeout(onDone, 1100);
      return () => clearTimeout(t);
    }
  }, [step]);
  return html`<div class="card ai-intro enter" onClick=${onDone} data-testid="ai-intro">
    ${g.idx === 0 && g.number > 1 && html`<div class="new-game-banner" data-testid="new-game-banner">🎉 Game ${g.number} — fresh scores! (The AI remembers everything, though.)</div>`}
    <div class="ai-title">🤖 ${generic ? 'The AI is trying to write' : 'The AI is writing'} question ${g.idx + 1}/${g.n}<span class="dots"></span></div>
    <${Bot} level=${level} />
    <div class="ai-lines">
      ${lines.slice(0, step).map((l, i) => html`<div key=${i} class=${level >= 4 && i === lines.length - 1 ? 'creep' : ''}>${l}</div>`)}
    </div>
    <span class="muted small">tap to skip</span>
  </div>`;
}

// ---------------------------------------------------------------------------

export function QuestionCard({ view, animate = true, compact }) {
  const g = view.game;
  const who = playerMap(view);
  const aboutMe = g.q.about.includes(view.me);
  const info = levelInfo(g.q.level);
  return html`<div class=${cx('card q-card', !compact && 'tilt-l')} data-testid="question">
    <div class="tape"></div>
    <div class="q-meta">
      <span class="q-num">Q ${g.idx + 1}/${g.n}</span>
      ${view.settings.showMeter && html`<${Meter} level=${g.q.level} />`}
    </div>
    <${QuestionText} segments=${g.q.segments} who=${who} animate=${animate} compact=${compact} />
    ${view.settings.showMeter && !compact && html`<div class="script muted" style="margin-top:8px">${info.emoji} ${info.name}</div>`}
    ${aboutMe && !compact && html`<div class="about-you">👀 This one's about YOU — your vote counts double!</div>`}
  </div>`;
}

function timerEnd(view) {
  const t = view.game.timer;
  if (!t) return null;
  return (view.receivedAt || Date.now()) + t.remaining;
}

export function StatusList({ view, ids, done, doneText = 'done!', waitText = 'thinking…' }) {
  const who = playerMap(view);
  return html`<div class="status-list">
    ${ids.map((pid) => {
      const p = who(pid);
      const ok = done.includes(pid);
      return html`<div key=${pid} class=${cx('status-item', ok && 'done')}>
        <${Avatar} p=${p} size="sm" off=${!p.online} badge=${ok ? '✓' : !p.online ? '📡' : null} />
        <div style="min-width:0">
          <div class="nm">${p.name}${pid === view.me ? ' (you)' : ''}</div>
          <div class=${cx('st', !ok && 'writing')}>${ok ? doneText : !p.online ? 'reconnecting…' : html`<span class="row" style="gap:4px;flex-wrap:nowrap">${Doodle.pencil({ size: 16 })} ${waitText}</span>`}</div>
        </div>
      </div>`;
    })}
  </div>`;
}

function Progress({ n, total, label }) {
  return html`<div class="progress-doodle" data-testid="progress">
    <div class="bar"><i style=${`width:${total ? (n / total) * 100 : 0}%`}></i></div>
    <span class="count">${n} of ${total} ${label}</span>
  </div>`;
}

/** Rotating fun lines while waiting; {slow} becomes someone who really is still going. */
function Quips({ pool, creepy, slow = [] }) {
  const lines = useMemo(() => {
    const all = creepy ? [...pool, ...creepy] : pool;
    return pickLines(all, all.length, Math.random);
  }, [pool]);
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => x + 1), 4200);
    return () => clearInterval(t);
  }, []);
  const usable = slow.length ? lines : lines.filter((l) => !l.includes('{slow}'));
  const line = usable[i % usable.length] || '';
  const name = slow.length ? slow[(i * 7) % slow.length] : '';
  return html`<p class="quip" key=${i} data-testid="quip">${line.replace(/\{slow\}/g, name)}</p>`;
}

// ---------------------------------------------------------------------------
// Answer phase

export function AnswerPhase({ ctrl, view }) {
  const g = view.game;
  const introKey = 'intro.' + g.q.key;
  const [intro, setIntro] = useState(() => !seen(introKey));
  useOnKey(g.q.key, () => setIntro(!seen(introKey)));
  const draftKey = 'aipsych.draft.' + g.q.key;
  const [text, setText] = useState(() => session.get(draftKey, ''));
  useOnKey(g.q.key, () => setText(session.get(draftKey, '')));
  const [editing, setEditing] = useState(false);
  const endsAt = timerEnd(view);
  const now = useNow(500, !!endsAt);
  const expired = endsAt && now >= endsAt;
  const hard = g.timer && g.timer.hard;
  const who = playerMap(view);
  const slow = g.q.answerers.filter((p) => !g.answered.includes(p) && p !== view.me).map((p) => who(p).name);

  // Keep the host up to date with what I'm typing: if time runs out, it gets submitted for me.
  const draftTimer = useRef(null);
  const pushDraft = (value, now = false) => {
    clearTimeout(draftTimer.current);
    const go = () => ctrl.sendDraft && ctrl.sendDraft(value, g.q.key);
    if (now) go();
    else draftTimer.current = setTimeout(go, 350);
  };
  useEffect(() => {
    if (text && !g.myAnswer) pushDraft(text, true); // after a refresh / reconnect
  }, [g.q.key]);
  useEffect(() => {
    if (!endsAt) return;
    const t = setTimeout(() => text && pushDraft(text, true), Math.max(0, endsAt - Date.now() - 900));
    return () => clearTimeout(t);
  }, [endsAt, text]);

  const participating = g.q.participants.includes(view.me);
  const iAnswer = g.q.answerers.includes(view.me);
  const mine = g.myAnswer;
  const doneCount = g.answered.length;
  const total = g.q.answerers.length;

  const prevDone = useRef(doneCount);
  useEffect(() => {
    if (doneCount > prevDone.current && !intro) sfx('pop');
    prevDone.current = doneCount;
  }, [doneCount]);

  if (intro)
    return html`<${AiIntro} view=${view} onDone=${() => { markSeen(introKey); setIntro(false); sfx('reveal'); }} />`;

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    ctrl.dispatch({ type: 'answer', text: t, qkey: g.q.key });
    session.del(draftKey);
    setEditing(false);
    sfx('submit');
    buzz([15, 40, 15]);
  };

  const timer = endsAt && html`<${TimerRing} endsAt=${endsAt} total=${g.timer.total} />`;

  if (!participating) {
    return html`<div class="stack enter">
      <${QuestionCard} view=${view} />
      <div class="card center"><p class="script" style="font-size:26px;margin:0">You joined mid-question — you're in from the next one! 🎟️</p></div>
      <${StatusList} view=${view} ids=${g.q.answerers} done=${g.answered} doneText="answered!" waitText="writing…" />
    </div>`;
  }

  if (!iAnswer || (mine && !editing)) {
    return html`<div class="stack enter" data-testid="answer-waiting">
      <${QuestionCard} view=${view} animate=${false} />
      ${timer}
      ${mine
        ? html`<div class="stack" style="align-items:center">
            <div class="script" style="font-size:26px">Answer locked in! ✍️</div>
            <div class="sticky-note" data-testid="my-answer">${mine}</div>
            ${!view.pendingCount && html`<button class="link-btn" style="font-size:19px" onClick=${() => { setText(mine); setEditing(true); }}>change it</button>`}
          </div>`
        : html`<div class="card center"><p class="script" style="font-size:26px;margin:0">Sit back — everyone is writing about you 😈</p></div>`}
      <${Progress} n=${doneCount} total=${total} label="answered" />
      <${StatusList} view=${view} ids=${g.q.answerers} done=${g.answered} doneText="answered!" waitText="writing…" />
      ${g.stalled
        ? html`<p class="quip">⏰ Nobody wrote anything! The host is deciding what's next…</p>`
        : expired
          ? html`<p class="quip">${hard ? "⏰ Time's up! Collecting whatever everyone wrote…" : "⏰ Time's up! The host decides who we wait for…"}</p>`
          : html`<${Quips} pool=${WRITE_QUIPS} creepy=${g.q.level >= 4 && !g.q.generic ? WRITE_CREEPY : null} slow=${slow} />`}
    </div>`;
  }

  const left = ANSWER_MAX - text.length;
  return html`<div class="stack enter" data-testid="answer-form">
    <${QuestionCard} view=${view} />
    ${timer}
    ${expired && html`<p class="quip" style="color:#b3261e">${hard ? "⏰ Time's up! Sending what you wrote…" : '⏰ Hurry! The host can move on without you now…'}</p>`}
    ${hard && !expired && html`<p class="muted small center" style="margin:0">When time runs out, whatever you've typed is sent automatically.</p>`}
    <div class="card stack" style="gap:8px">
      <label class="script" for="answer" style="font-size:24px;font-weight:700">Your answer</label>
      <textarea id="answer" class="notebook" maxlength=${ANSWER_MAX} rows="3" placeholder="Something hilarious… or suspiciously true"
        value=${text} data-testid="answer-input"
        onInput=${(e) => { const v = e.currentTarget.value; setText(v); session.set(draftKey, v); pushDraft(v); }}
        onBlur=${() => text && pushDraft(text, true)}
        onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}></textarea>
      <div class="row" style="justify-content:space-between">
        <${Progress} n=${doneCount} total=${total} label="in" />
        <span class=${cx('counter', left < 15 && 'warn')}>${left}</span>
      </div>
      <${Btn} big block color="mint" disabled=${!text.trim()} onClick=${submit} sound=${null} testid="submit-answer">${Doodle.pencil({ size: 26 })} Submit answer<//>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Vote phase

const LETTER_COLORS = ['coral', 'sky', 'sun', 'mint', 'grape', 'bubblegum', 'tangerine', 'leaf'];

export function VotePhase({ ctrl, view }) {
  const g = view.game;
  const dealKey = 'deal.' + g.q.key;
  const [skipDeal] = useState(() => seen(dealKey));
  const shown = useStep(g.options.length, 650, { key: g.q.key, skip: skipDeal, delay: 500 });
  const [sel, setSel] = useState(null);
  useOnKey(g.q.key, () => setSel(null));
  useEffect(() => {
    if (shown > 0 && !skipDeal) sfx('card');
    if (shown >= g.options.length) markSeen(dealKey);
  }, [shown]);
  const canVote = g.voters.includes(view.me);
  const isJudge = g.q.about.includes(view.me);
  const endsAt = timerEnd(view);
  const now = useNow(500, !!endsAt);
  const expired = endsAt && now >= endsAt;
  const dealt = shown >= g.options.length;
  const hasChoice = g.options.some((o) => !o.mine);
  const who = playerMap(view);
  const slow = g.voters.filter((p) => !g.voted.includes(p) && p !== view.me).map((p) => who(p).name);
  const hard = g.timer && g.timer.hard;

  const lock = () => {
    if (!sel) return;
    ctrl.dispatch({ type: 'vote', oid: sel, qkey: g.q.key });
    sfx('stamp');
    buzz([20, 30, 40]);
  };

  const voted = g.myVote;
  return html`<div class="stack enter" data-testid="vote-phase">
    <${QuestionCard} view=${view} animate=${false} compact />
    ${endsAt && html`<${TimerRing} endsAt=${endsAt} total=${g.timer.total} />`}
    ${canVote && !voted && (isJudge
      ? html`<div class="judge-banner">⚖️ You're the judge! Your vote is worth <b>2 points</b></div>`
      : html`<h2 class="center" style="font-size:26px">Pick your favorite!</h2>`)}
    ${!canVote && html`<div class="card center"><p class="script" style="font-size:24px;margin:0">${hasChoice ? 'Watch the others vote 👀' : 'Only your answer is in — nothing to vote on this time!'}</p></div>`}
    <div class="options" role="radiogroup">
      ${g.options.slice(0, shown).map((o, i) => {
        const disabled = o.mine || !canVote || !!voted;
        const picked = (voted || sel) === o.oid;
        return html`<button key=${o.oid} class=${cx('option', o.mine && 'mine', picked && (voted ? 'voted' : 'selected'))} role="radio" aria-checked=${picked}
          disabled=${disabled} data-testid=${o.mine ? 'option-mine' : 'option'}
          style=${`animation-delay:${skipDeal ? i * 0.05 : 0}s`}
          onClick=${() => { if (!disabled) { setSel(o.oid); sfx('tap'); buzz(10); } }}>
          <span class="letter" style=${`background-image:${wash(LETTER_COLORS[i % 8], i)}`}>${String.fromCharCode(65 + i)}</span>
          ${o.text}
          ${o.mine && html`<span class="mine-tag">your answer — no voting for yourself!</span>`}
        </button>`;
      })}
    </div>
    ${canVote && !voted && dealt && html`<${Btn} big block color=${isJudge ? 'sun' : 'grape'} disabled=${!sel} onClick=${lock} sound=${null} testid="lock-vote">
      🔒 Lock it in${isJudge ? ' (2 pts)' : ''}
    <//>`}
    ${(voted || !canVote) && html`<div class="stack">
      ${voted && html`<p class="script center" style="font-size:26px;margin:0">Vote locked! 🔒</p>`}
      <${Progress} n=${g.voted.length} total=${g.voters.length} label="voted" />
      <${StatusList} view=${view} ids=${g.voters} done=${g.voted} doneText="voted!" waitText="deciding…" />
      ${expired
        ? html`<p class="quip">${hard ? "⏰ Time's up! Counting the votes…" : "⏰ Time's up! Waiting on the host…"}</p>`
        : html`<${Quips} pool=${VOTE_QUIPS} creepy=${g.q.level >= 4 && !g.q.generic ? VOTE_CREEPY : null} slow=${slow} />`}
    </div>`}
  </div>`;
}

// ---------------------------------------------------------------------------
// Host controls

export function HostDock({ ctrl, view }) {
  const g = view.game;
  const who = playerMap(view);
  const [confirm, setConfirm] = useState(null);
  const [dismissed, setDismissed] = useState(null);
  const [menu, setMenu] = useState(false);
  const endsAt = timerEnd(view);
  const now = useNow(500, !!endsAt);
  const expired = endsAt && now >= endsAt;
  const hard = g.timer && g.timer.hard;
  const phase = g.phase;
  const missing =
    phase === 'answer' ? g.q.answerers.filter((p) => !g.answered.includes(p)) : phase === 'vote' ? g.voters.filter((p) => !g.voted.includes(p)) : [];
  const expiredKey = expired ? g.q.key + phase + Math.round(endsAt / 1000) : null;
  // Hard limits move on by themselves; soft (host) timers ask the host first.
  const showTimesUp = expired && !hard && missing.length > 0 && dismissed !== expiredKey;
  const stalled = phase === 'answer' && g.stalled && dismissed !== 'stalled' + g.q.key;
  const noneSubmitted = phase === 'answer' && g.answered.length === 0;

  const startTimer = (seconds) => {
    setMenu(false);
    ctrl.dispatch({ type: 'timer', on: true, seconds });
  };
  const moveOn = () => {
    setConfirm(null);
    // Anything typed (even unsubmitted) counts; if nobody typed a thing, pick a new question.
    const res = ctrl.dispatch({ type: 'moveOn' });
    if (!res.ok && res.error === 'no-answers') {
      ctrl.dispatch({ type: 'skipQuestion' });
      ctrl.toast = null;
    }
  };

  return html`
    <div class="dock" data-testid="host-dock">
      <span class="lbl">host</span>
      ${(phase === 'answer' || phase === 'vote') &&
      html`
        ${!endsAt
          ? html`<div class="timer-menu-wrap">
              <${Btn} small color="sky" onClick=${() => setMenu(!menu)} testid="start-timer">${Doodle.clock({ size: 20 })} Timer<span class="long">…</span><//>
              ${menu && html`<div class="timer-menu" role="menu">
                ${[30, 45, 60].map((s) => html`<button key=${s} role="menuitem" data-testid=${'timer-' + s} onClick=${() => { sfx('tap'); startTimer(s); }}>${s}s</button>`)}
              </div>`}
            </div>`
          : expired && missing.length && !hard
            ? html`<${Btn} small color="tangerine" onClick=${() => setDismissed(null)} testid="move-on-open">⏭ Move on<span class="long">…</span><//>`
            : html`<${Btn} small color="paper" sound="tap" onClick=${() => ctrl.dispatch({ type: 'timer', on: false })}>${Doodle.cross({ size: 18 })} Stop<span class="long"> timer</span><//>`}
        <${Btn} small color="coral" onClick=${() => setConfirm('skip')} testid="skip-question">${Doodle.skip({ size: 20 })} Skip<span class="long"> question</span><//>
      `}
      ${phase === 'results' && html`<${Btn} small color="mint" onClick=${() => ctrl.dispatch({ type: 'next' })} testid="force-next">Next<span class="long"> anyway</span> ▶<//>`}
      <${Btn} small color="paper" sound="tap" onClick=${() => setConfirm('end')}>End<span class="long"> game</span><//>
    </div>
    ${showTimesUp &&
    html`<${Modal} onClose=${() => setDismissed(expiredKey)} title="⏰ Time's up!">
      <p>Still waiting on:</p>
      <div class="row" style="margin-bottom:10px">${missing.map((pid) => html`<span key=${pid} class="chip">${who(pid).avatar} ${who(pid).name}</span>`)}</div>
      <p class="muted small">${phase === 'answer'
        ? noneSubmitted
          ? "Whatever they've typed so far will be used. If nobody typed anything, the AI writes a new question."
          : "Whatever they've typed so far is sent for them (they can still vote)."
        : 'Move on and their votes will be left out.'}</p>
      <div class="stack" style="gap:10px">
        <${Btn} block color="tangerine" onClick=${moveOn} testid="confirm-move-on">Move on without ${missing.length === 1 ? who(missing[0]).name : 'them'}<//>
        <div class="row" style="gap:8px;justify-content:center">
          ${[30, 45, 60].map((s) => html`<${Btn} key=${s} small color="sky" onClick=${() => startTimer(s)}>+${s}s<//>`)}
        </div>
        <${Btn} block color="paper" sound="tap" onClick=${() => setDismissed(expiredKey)}>Keep waiting<//>
      </div>
    <//>`}
    ${stalled &&
    html`<${Modal} onClose=${() => setDismissed('stalled' + g.q.key)} title="😴 Nobody wrote anything">
      <p>The time limit ran out and not a single answer came in.</p>
      <div class="stack" style="gap:10px">
        <${Btn} block color="coral" onClick=${() => { setDismissed('stalled' + g.q.key); ctrl.dispatch({ type: 'skipQuestion' }); }} testid="stalled-skip">New question<//>
        <${Btn} block color="sky" onClick=${() => { setDismissed('stalled' + g.q.key); startTimer(60); }}>Give everyone 60 more seconds<//>
      </div>
    <//>`}
    ${confirm === 'skip' &&
    html`<${Confirm} title="Skip this question?" text="Everyone's answers are thrown away and the AI writes a brand-new question for this round." yes="Skip it"
      onNo=${() => setConfirm(null)} onYes=${() => { setConfirm(null); ctrl.dispatch({ type: 'skipQuestion' }); sfx('whistleDown'); }} />`}
    ${confirm === 'end' &&
    html`<${Confirm} title="End the game?" text="Scores are wiped and everyone goes back to the lobby. Used questions stay used." yes="End game"
      onNo=${() => setConfirm(null)} onYes=${() => { setConfirm(null); ctrl.dispatch({ type: 'endGame' }); }} />`}
  `;
}
