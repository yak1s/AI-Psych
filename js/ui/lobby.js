import { html, useState, useEffect, useMemo, useRef } from '../vendor/preact-htm.js';
import { Btn, Avatar, Toggle, Seg, Confirm, Modal, Doodle, cx, playerMap } from './common.js';
import { AvatarPicker } from './home.js';
import { local, KEYS } from '../storage.js';
import { MAX_PLAYERS, MIN_PLAYERS, ROUND_CHOICES, TIME_LIMITS } from '../game/engine.js';
import { parseDeck, TEMPLATE_DECK, LEVELS } from '../game/deck.js';
import { brush } from './art.js';
import { netQuery } from '../config.js';
import { sfx, buzz } from './audio.js';
import qrcode from '../vendor/qrcode.js';
import { AiDeckHelper } from './deckprompt.js';
import { DeviceToggles } from './people.js';

export function joinUrl(code) {
  const base = location.origin + location.pathname;
  return `${base}?room=${code}${netQuery()}`;
}

function useJoinSounds(view) {
  const count = view.players.length;
  const prev = useRef(count);
  useEffect(() => {
    if (count > prev.current) {
      sfx('join');
      buzz(30);
    } else if (count < prev.current) sfx('whistleDown');
    prev.current = count;
  }, [count]);
}

export function PlayerTiles({ view, onKick, showEmpty, onEditMe }) {
  const tiles = view.players.map((p, i) => html`<div class="player-tile" key=${p.id} style=${`animation-delay:${i * 0.05}s`}>
    ${p.id === view.me && onEditMe
      ? html`<button class="avatar-edit" title="Change your face" aria-label="Change your face" onClick=${onEditMe} data-testid="edit-avatar">
          <${Avatar} p=${p} size="lg" bob delay=${i * 0.3} /><span class="edit-pencil">✏️</span>
        </button>`
      : html`<${Avatar} p=${p} size="lg" bob off=${!p.online} delay=${i * 0.3} badge=${!p.online ? '📡' : null} />`}
    <div class="name">${p.name}</div>
    <div class="tag">${p.isHost ? 'host' : p.id === view.me ? 'you!' : !p.online ? 'reconnecting…' : ''}</div>
    ${onKick && p.online && p.net === 'relay' && html`<span class="net-tag" title="Connected through the backup relay (direct connection blocked on this network)">relay</span>`}
    ${onKick && !p.isHost && html`<button class="kick" title=${`Remove ${p.name}`} onClick=${() => onKick(p)}>${Doodle.cross({ size: 16, sw: 4 })}</button>`}
  </div>`);
  if (showEmpty) {
    for (let i = view.players.length; i < Math.min(MAX_PLAYERS, view.players.length + 1); i++) {
      tiles.push(html`<div class="player-tile empty" key=${'e' + i}><div class="avatar lg"><span>?</span></div><div class="tag">waiting…</div></div>`);
    }
  }
  return html`<div class="player-grid">${tiles}</div>`;
}

const LOBBY_TIPS = [
  'Tip: the person a question is about gets a double vote ⚖️',
  'Tip: funny beats true. Usually.',
  "Tip: the app is learning about you as we speak. Probably.",
  'Tip: you can mute sounds with the speaker button up top 🔈',
  'Tip: refreshing is safe — you will pop right back in.',
  "Tip: if you don't vote, your own answer gets no points!",
];

/** Tap your own face in the lobby to pick another one. */
function FacePicker({ ctrl, view, onClose }) {
  const me = view.players.find((p) => p.id === view.me);
  return html`<${Modal} onClose=${onClose} title="Pick a new face">
    <${AvatarPicker} value=${me && me.avatar} onChange=${(a) => {
      ctrl.dispatch({ type: 'avatar', avatar: a });
      local.set(KEYS.profile, { ...local.get(KEYS.profile, {}), avatar: a });
    }} />
    <div class="row" style="justify-content:flex-end;margin-top:10px"><${Btn} small color="mint" onClick=${onClose} testid="avatar-done">Done<//></div>
  <//>`;
}

export function PlayerLobby({ ctrl, view }) {
  useJoinSounds(view);
  const [faces, setFaces] = useState(false);
  const host = view.players.find((p) => p.isHost);
  const [tip, setTip] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTip((x) => (x + 1) % LOBBY_TIPS.length), 5000);
    return () => clearInterval(t);
  }, []);
  return html`<div class="screen enter"><div class="stack">
    <div class="center"><h1 style="font-size:38px">You're in! 🎉</h1>
      <p class="script" style="margin:6px 0 0">Waiting for ${host ? host.name : 'the host'} to start<span class="dots"></span></p></div>
    <div class="card"><div class="card-title">${Doodle.star({ size: 24 })} Players (${view.players.length}/${MAX_PLAYERS})</div>
      <${PlayerTiles} view=${view} onEditMe=${() => setFaces(true)} />
      <p class="muted small center" style="margin:6px 0 0">Tap your face to change it ✏️</p>
    </div>
    ${faces && html`<${FacePicker} ctrl=${ctrl} view=${view} onClose=${() => setFaces(false)} />`}
    <${DeviceToggles} />
    <p class="quip" key=${tip}>${LOBBY_TIPS[tip]}</p>
    ${view.gamesPlayed > 0 && html`<p class="center muted">Games played in this room: ${view.gamesPlayed}</p>`}
  </div></div>`;
}

// ---------------------------------------------------------------------------
// Host lobby

function CodeCard({ code }) {
  const [qr, setQr] = useState(false);
  const url = joinUrl(code);
  const qrSrc = useMemo(() => {
    const q = qrcode(0, 'M');
    q.addData(url);
    q.make();
    return q.createDataURL(6, 2);
  }, [url]);
  const [copied, setCopied] = useState(false);
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'AI Psych', text: `Join my AI Psych game! Room code ${code}`, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      /* user cancelled */
    }
  };
  return html`<div class="card stack" style="align-items:center">
    <div class="tape"></div>
    <div class="script" style="font-size:26px">Room code</div>
    <div class="big-code" data-testid="room-code" aria-label=${`Room code ${code.split('').join(' ')}`}>${code.split('').map((d, i) => html`<span key=${i + d}>${d}</span>`)}</div>
    <div class="join-url">${location.host}${location.pathname}</div>
    ${qr && html`<div class="qr"><img src=${qrSrc} alt="QR code to join" /></div>`}
    <div class="row center">
      <${Btn} small color="sky" sound="tap" onClick=${() => setQr(!qr)}>${Doodle.qr({ size: 20 })} ${qr ? 'Hide QR' : 'QR code'}<//>
      <${Btn} small color="mint" onClick=${share}>${Doodle.copy({ size: 20 })} ${copied ? 'Copied!' : 'Share link'}<//>
    </div>
  </div>`;
}

export function Settings({ ctrl, info, title = 'Game settings' }) {
  const s = info.settings;
  const set = (patch) => ctrl.dispatch({ type: 'settings', settings: patch });
  return html`<div class="card stack" style="gap:10px">
    <div class="card-title">${Doodle.spark({ size: 24 })} ${title}</div>
    <div class="row" style="justify-content:space-between">
      <span class="script" style="font-size:24px">Questions</span>
      <${Seg} value=${s.rounds} onChange=${(v) => set({ rounds: v })} options=${ROUND_CHOICES.map((n) => ({ value: n, label: String(n) }))} />
    </div>
    <div class="stack" style="gap:6px">
      <div class="row" style="justify-content:space-between">
        <span class="script" style="font-size:24px">Time limit</span>
        <${Seg} value=${s.timeLimit || 'off'} onChange=${(v) => set({ timeLimit: v })}
          options=${Object.entries(TIME_LIMITS).map(([k, v]) => ({ value: k, label: v ? v.label : 'Off' }))} />
      </div>
      <span class="time-hint">${(() => {
        const l = TIME_LIMITS[s.timeLimit || 'off'];
        const f = (x) => (x >= 60 ? `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}` : `${x}s`);
        return l ? `${f(l.answer)} to write, ${f(l.vote)} to vote — then whatever is typed gets sent and the game moves on by itself.` : 'No limit — the host can still start a 30/45/60-second timer any time.';
      })()}</span>
    </div>
    <${Toggle} checked=${s.subjectAnswers} onChange=${(v) => set({ subjectAnswers: v })} label="The person asked about writes an answer too" />
    <${Toggle} checked=${s.clues !== false} onChange=${(v) => set({ clues: v })} label="Let the app use what it notices (time zones, phones, how people play…) 👀" />
    ${s.clues !== false &&
    html`<${Toggle} checked=${!!s.moreClues} onChange=${(v) => set({ moreClues: v })} testid="more-clues"
      label="Extra personal: more questions about you, fewer generic ones"
      hint="Leans on what the app has noticed about the players — with or without a deck. Starts once it has noticed enough." />`}
    ${info.deck && html`<${Toggle} checked=${s.fillStarter} onChange=${(v) => set({ fillStarter: v })} label="Top up with built-in questions if the deck runs out" testid="fill-starter" />`}
  </div>`;
}

function downloadTemplate() {
  const blob = new Blob([JSON.stringify(TEMPLATE_DECK, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ai-psych-deck-template.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function DeckPanel({ ctrl, view, info }) {
  const [warnings, setWarnings] = useState([]);
  const [over, setOver] = useState(false);
  const fileRef = useRef();
  const [ai, setAi] = useState(false);
  const deck = info.deck;

  const loadText = (text, name) => {
    const res = parseDeck(text, name);
    if (!res.ok) {
      ctrl.toast = { text: res.errors[0], at: Date.now() };
      ctrl.emit();
      return;
    }
    const r = ctrl.dispatch({ type: 'deck', deck: res.deck });
    if (r.ok) {
      sfx('magic');
      setWarnings(res.warnings);
      setAi(false);
    }
  };
  const load = async (file) => {
    if (file) loadText(await file.text(), file.name);
  };

  const builtinTotal = info.builtin ? info.builtin.total : 0; // always the full collection, not what this device already played
  return html`<div class="card stack" style="gap:10px" data-testid="deck-panel">
    <div class="card-title" style="margin:0">🤫 Secret question deck <span class="muted small">(optional)</span></div>
    ${!deck &&
    html`<p style="margin:0">The secret ingredient: questions written about <b>the people who are coming</b> — their names, habits and inside jokes. The app asks them as if it simply knew. Nobody else has to find out you prepared them. 😉</p>
      <div class="deck-options">
        <div class="deck-option">
          <b>✨ Make one with AI</b>
          <span class="muted small">Describe the group in a few words, copy the ready-made prompt into ChatGPT, Gemini or Claude, paste the answer back.</span>
          <${Btn} small color="grape" onClick=${() => setAi(true)} testid="ai-deck">Make one with AI<//>
        </div>
        <div class="deck-option">
          <b>✍️ Write your own</b>
          <span class="muted small">Download the template, fill in your questions and creepiness levels, then upload it below.</span>
          <${Btn} small color="sky" sound="tap" onClick=${downloadTemplate} testid="template-btn">Download the template<//>
        </div>
      </div>
      <label class=${cx('deck-drop', over && 'over')}
        onDragOver=${(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave=${() => setOver(false)}
        onDrop=${(e) => { e.preventDefault(); setOver(false); load(e.dataTransfer.files[0]); }}>
        ${Doodle.upload({ size: 32 })}
        <b style="font-family:var(--display)">Upload a deck</b>
        <span class="muted small">.json, .txt or .csv — from the AI, the template, or one you already have</span>
        <input ref=${fileRef} type="file" accept=".json,.txt,.csv,.tsv,application/json,text/plain,text/csv"
          style="display:none" data-testid="deck-input" onChange=${(e) => { load(e.currentTarget.files[0]); e.currentTarget.value = ''; }} />
      </label>
      <p class="muted small" style="margin:0">No deck? No problem: the app uses its ${builtinTotal} built-in questions — plus whatever it notices about you.</p>`}
        ${deck &&
        html`<div class="stack" style="gap:8px">
            <div class="row" style="justify-content:space-between">
              <div><b style="font-family:var(--display)">“${deck.title}”</b><div class="muted small">${deck.total} questions · ${deck.fileName}</div></div>
              <${Btn} small color="paper" sound="tap" onClick=${() => { ctrl.dispatch({ type: 'clearDeck' }); setWarnings([]); }}>Remove<//>
            </div>
            <div class="level-bars" title="Questions per creepiness level">
              ${LEVELS.map((l) => {
                const n = deck.counts[l.n] || 0;
                const max = Math.max(1, ...Object.values(deck.counts));
                return html`<div key=${l.n}><span>${n}</span><i style=${`height:${6 + (n / max) * 34}px;background-image:${brush(['mint', 'sky', 'sun', 'tangerine', 'coral'][l.n - 1], l.n)}`}></i><span>${l.emoji}</span></div>`;
              })}
            </div>
            ${warnings.length > 0 && html`<ul class="warn-list">${warnings.map((w, i) => html`<li key=${i}>${w}</li>`)}</ul>`}
            <div class="secret-hint">Who is who? Match the deck's names to the players who joined${view.players.length < 2 ? ' (as people join, obvious names match automatically)' : ''}:</div>
            ${deck.predicted.map((x) => html`<div class="assign-row" key=${x.key}>
              <div><div class="who">${x.name}</div><div class="muted small">${x.uses} question${x.uses === 1 ? '' : 's'}</div></div>
              <select class=${x.pid ? 'set' : ''} value=${x.pid || ''} data-testid=${`assign-${x.key}`}
                onChange=${(e) => { sfx('tap'); ctrl.dispatch({ type: 'assign', key: x.key, pid: e.currentTarget.value || null }); }}>
                <option value="">— not here (skip) —</option>
                ${view.players.map((p) => html`<option key=${p.id} value=${p.id}>${p.avatar} ${p.name}</option>`)}
              </select>
            </div>`)}
            <div class="muted small">Questions about people who aren't matched are skipped. Names in questions use what players typed when joining.</div>
          </div>`}
    ${ai && html`<${AiDeckHelper} view=${view} onClose=${() => setAi(false)} onPaste=${(text) => loadText(text, 'ai-deck.json')} onTemplate=${downloadTemplate} />`}
    ${info.builtin && info.builtin.seen > 0 && html`<div class="muted small" data-testid="seen-info">Built-in questions: ${info.builtin.fresh} nobody here has played yet · ${info.builtin.seen} played before by someone here (those come last)</div>`}
    ${info.usedCount > 0 && html`<div class="row" style="justify-content:space-between">
      <span class="muted small">${info.usedCount} question${info.usedCount === 1 ? '' : 's'} already played on this device — never repeated</span>
      <button class="link-btn" style="font-size:18px" onClick=${() => ctrl.dispatch({ type: 'resetUsed' })}>reset</button>
    </div>`}
  </div>`;
}

/**
 * About to start with a deck that can't fill the game (generic questions are off)?
 * Returns { left, rounds } or null.
 */
export function deckShortfall(info) {
  const pool = info.pool;
  if (!info.deck || info.settings.fillStarter || pool.deck >= info.settings.rounds) return null;
  return { left: pool.deck, rounds: info.settings.rounds, builtin: pool.builtinLeft || 0 };
}

/** Starts the game — but first says so when the deck doesn't have enough unused questions. */
export function useGuardedStart(ctrl, info, type) {
  const [ask, setAsk] = useState(null);
  const start = () => {
    const short = deckShortfall(info);
    if (short) setAsk(short);
    else ctrl.dispatch({ type });
  };
  const dialog =
    ask &&
    html`<${Modal} onClose=${() => setAsk(null)} title=${ask.left ? '🃏 The deck is running low' : '🃏 The deck is used up'}>
      <div data-testid="deck-short">
        <p style="margin-top:0">${ask.left
          ? `Only ${ask.left} unused deck question${ask.left === 1 ? '' : 's'} left for this group — not enough for a ${ask.rounds}-question game.`
          : 'Every deck question has already been played with this group.'}
          ${ask.builtin ? ` Add built-in questions to fill the rest of the game?` : ''}</p>
        <div class="stack" style="gap:10px">
          ${ask.builtin > 0 &&
          html`<${Btn} block color="mint" testid="deck-short-fill" onClick=${() => { ctrl.dispatch({ type: 'settings', settings: { fillStarter: true } }); ctrl.dispatch({ type }); setAsk(null); }}>
            Add built-in questions & start ▶<//>`}
          ${ask.left > 0 &&
          html`<${Btn} block color="paper" testid="deck-short-play" onClick=${() => { ctrl.dispatch({ type }); setAsk(null); }}>
            Play just ${ask.left} deck question${ask.left === 1 ? '' : 's'}<//>`}
          <${Btn} block color="paper" sound="tap" onClick=${() => setAsk(null)}>Not yet (load another deck)<//>
        </div>
      </div>
    <//>`;
  const short = deckShortfall(info);
  return { start, dialog, canStart: info.pool.total > 0 || !!(short && short.builtin > 0) };
}

export function HostLobby({ ctrl, view }) {
  useJoinSounds(view);
  const info = view.host;
  const [kick, setKick] = useState(null);
  const [faces, setFaces] = useState(false);
  const n = view.players.length;
  const pool = info.pool;
  const short = deckShortfall(info);
  const guard = useGuardedStart(ctrl, info, 'start');
  const rounds = short ? short.rounds : Math.min(info.settings.rounds, pool.total);
  let poolNote;
  if (short) poolNote = html`<span style="color:#b3261e">${short.left ? `Only ${short.left} unused deck question${short.left === 1 ? '' : 's'} left` : 'All deck questions were already played'} — turn on built-in questions to fill the game.</span>`;
  else if (info.deck && pool.deck < info.settings.rounds && pool.total) poolNote = html`Only ${pool.deck} unused deck question${pool.deck === 1 ? '' : 's'} left — the rest of the game will be built-in questions.`;
  else if (!pool.total) poolNote = html`<span style="color:#b3261e">No fresh questions left for this group — load a deck or reset used questions.</span>`;
  else if (pool.total < info.settings.rounds) poolNote = html`Only ${pool.total} fresh question${pool.total === 1 ? '' : 's'} left — this game will be ${pool.total} long.`;
  else poolNote = html`${info.deck ? `${pool.deck} deck question${pool.deck === 1 ? '' : 's'} ready` : `${info.builtin.total} built-in questions ready`}${info.deck && info.settings.fillStarter ? ` (+ ${info.builtin.total} built-in as backup)` : ''}.`;

  return html`<div class="screen wide enter">
    <div class="host-grid">
      <div class="stack sticky">
        <${CodeCard} code=${view.code} />
        <div class="card">
          <div class="card-title">${Doodle.star({ size: 24 })} Players (${n}/${MAX_PLAYERS})</div>
          <${PlayerTiles} view=${view} showEmpty onKick=${(p) => setKick(p)} onEditMe=${() => setFaces(true)} />
          ${n < MIN_PLAYERS && html`<p class="script center" style="margin:8px 0 0">${n < 2 ? 'Tell your friends to open this page & type the code!' : `You need at least ${MIN_PLAYERS} players — ${MIN_PLAYERS - n} more to go!`}</p>`}
        </div>
      </div>
      <div class="stack">
        <${DeviceToggles} />
        <${Settings} ctrl=${ctrl} info=${info} />
        <${DeckPanel} ctrl=${ctrl} view=${view} info=${info} />
        <div class="card stack" style="align-items:center;text-align:center">
          <div class="muted small">${poolNote}</div>
          <${Btn} big block color="coral" pulse=${n >= MIN_PLAYERS && guard.canStart} disabled=${n < MIN_PLAYERS || !guard.canStart}
            onClick=${guard.start} sound="whoosh" testid="start-game">
            ${n < MIN_PLAYERS ? 'Waiting for players…' : `Start game ▶ (${rounds} questions)`}
          <//>
        </div>
      </div>
    </div>
    ${guard.dialog}
    ${faces && html`<${FacePicker} ctrl=${ctrl} view=${view} onClose=${() => setFaces(false)} />`}
    ${kick && html`<${Confirm} title=${`Remove ${kick.name}?`} text="They'll be kicked out of the room. (They can rejoin with a new name.)" yes="Remove"
      onNo=${() => setKick(null)} onYes=${() => { ctrl.dispatch({ type: 'kick', pid: kick.id }); setKick(null); }} />`}
  </div>`;
}
