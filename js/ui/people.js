// People coming and going: the host's "someone is knocking" prompt, the welcome
// banner everyone sees, the "hosting moved" note, and the host's mid-game players panel.

import { html, useState, useEffect } from '../vendor/preact-htm.js';
import { Btn, Avatar, Modal, Confirm, playerMap } from './common.js';
import { sfx, haptic } from './audio.js';
import { notifyState, enableNotify } from './notify.js';

const WELCOMES = [
  'Welcome, {name}! The AI already started a file on you. 📁',
  '{name} just walked in. Act natural, everyone.',
  'Say hi to {name}! (The AI is updating its questions…)',
  '{name} has entered the chat. The AI noticed. 👀',
  'Everybody wave at {name}! 👋',
];
const BACK = ['{name} is back! 🎉', 'Welcome back, {name} — your seat (and score) were waiting.', '{name} found their way back in. 🧭'];

export function Greeting({ view }) {
  const gr = view.greet;
  const [shown, setShown] = useState(null);
  useEffect(() => {
    if (!gr || gr.pid === view.me) return;
    setShown(gr);
    sfx('join');
    haptic('tap');
    const t = setTimeout(() => setShown(null), 6500);
    return () => clearTimeout(t);
  }, [gr && gr.at]);
  if (!shown) return null;
  const p = playerMap(view)(shown.pid);
  const pool = shown.kind === 'back' ? BACK : WELCOMES;
  const line = pool[Math.floor(shown.at / 1000) % pool.length].replace('{name}', p.name);
  return html`<div class="greet-banner" role="status" data-testid="greeting">
    <${Avatar} p=${p} size="sm" bob />
    <span>${line}</span>
  </div>`;
}

export function HandoverNote({ view }) {
  const h = view.handover;
  const [shown, setShown] = useState(null);
  useEffect(() => {
    if (!h) return;
    setShown(h);
    const t = setTimeout(() => setShown(null), 7000);
    return () => clearTimeout(t);
  }, [h && h.at]);
  if (!shown || shown.to === view.me) return null;
  const who = playerMap(view);
  return html`<div class="greet-banner" role="status" data-testid="handover">
    <span>👑 ${who(shown.from).name}'s connection is gone — ${who(shown.to).name} is hosting now. The game goes on!</span>
  </div>`;
}

/** Host only: someone wants to join mid-game (or take back a disconnected player's seat). */
export function JoinRequests({ ctrl, view }) {
  const reqs = (view.host && view.host.requests) || [];
  const r = reqs[0];
  useEffect(() => {
    if (r) {
      sfx('join');
      haptic('alert');
    }
  }, [r && r.joinId]);
  if (!r) return null;
  const who = playerMap(view);
  const seat = r.claim ? who(r.claim) : null;
  const decide = (type) => ctrl.dispatch({ type, joinId: r.joinId });
  return html`<${Modal} onClose=${() => {}} title=${seat ? '🔑 Someone wants their seat back' : '🛎️ Someone is knocking'}>
    <div class="row" style="gap:12px;margin-bottom:10px;flex-wrap:nowrap">
      <${Avatar} p=${{ name: r.name, avatar: r.avatar, color: seat ? seat.color : 'sun' }} size="lg" />
      <div>
        <b style="font-family:var(--display);font-size:22px">${r.name}</b>
        <div class="muted small">${seat
          ? `Joining with ${seat.name}'s name while ${seat.name} is disconnected. If it's really them, they get their seat and points back.`
          : 'wants to join the game. They start playing from the next question.'}</div>
      </div>
    </div>
    <div class="stack" style="gap:10px">
      <${Btn} block color="mint" onClick=${() => decide('admit')} testid="admit">${seat ? `Yes, it's ${seat.name}` : `Let ${r.name} in`}<//>
      <${Btn} block color="paper" sound="tap" onClick=${() => decide('deny')} testid="deny">Not now<//>
    </div>
    ${reqs.length > 1 && html`<p class="muted small center" style="margin:8px 0 0">${reqs.length - 1} more waiting…</p>`}
  <//>`;
}

/** Host only, mid-game: who's here, kick someone, match newcomers to the deck's names. */
export function PlayersPanel({ ctrl, view, onClose }) {
  const who = playerMap(view);
  const deck = view.host && view.host.deck;
  const [kick, setKick] = useState(null);
  const unmatched = deck ? deck.predicted.filter((x) => !x.pid) : [];
  const keyOf = (pid) => deck && (deck.predicted.find((x) => x.pid === pid) || {}).key;
  return html`<${Modal} onClose=${onClose} title="👥 Players">
    <div class="stack" style="gap:8px" data-testid="players-panel">
      ${view.players.map((p) => html`<div key=${p.id} class="row" style="justify-content:space-between;flex-wrap:nowrap;gap:8px">
        <span class="row" style="gap:8px;flex-wrap:nowrap;min-width:0">
          <${Avatar} p=${p} size="sm" off=${!p.online} />
          <span style="min-width:0"><b>${p.name}</b>${p.isHost ? ' (host)' : ''}<br /><span class="muted small">${p.online ? (p.net === 'relay' ? 'online (backup relay)' : 'online') : 'disconnected'}</span></span>
        </span>
        <span class="row" style="gap:6px;flex-wrap:nowrap">
          ${deck &&
          html`<select class=${keyOf(p.id) ? 'set' : ''} value=${keyOf(p.id) || ''} aria-label=${`Deck name for ${p.name}`} data-testid=${'mid-assign-' + p.name}
            onChange=${(e) => {
              const key = e.currentTarget.value;
              if (key) ctrl.dispatch({ type: 'assign', key, pid: p.id });
              else if (keyOf(p.id)) ctrl.dispatch({ type: 'assign', key: keyOf(p.id), pid: null });
              sfx('tap');
            }}>
            <option value="">— not in deck —</option>
            ${deck.predicted.filter((x) => !x.pid || x.pid === p.id).map((x) => html`<option key=${x.key} value=${x.key}>${x.name}</option>`)}
          </select>`}
          ${!p.isHost && html`<${Btn} small color="coral" onClick=${() => setKick(p)} testid=${'kick-' + p.name}>Remove<//>`}
        </span>
      </div>`)}
      ${deck && unmatched.length > 0 && html`<p class="muted small" style="margin:4px 0 0">Not matched yet: ${unmatched.map((x) => x.name).join(', ')}. Questions about them are skipped until you match someone.</p>`}
    </div>
    ${kick &&
    html`<${Confirm} title=${`Remove ${kick.name}?`} text="They leave the game right away (their answer this round is dropped)." yes="Remove"
      onNo=${() => setKick(null)} onYes=${() => { ctrl.dispatch({ type: 'kick', pid: kick.id }); setKick(null); }} />`}
  <//>`;
}

/** One tap to get reminders when the game needs you while you're in another app. */
export function ReminderPrompt() {
  const [state, setState] = useState(() => notifyState());
  if (state !== 'ask') return null;
  return html`<div class="card row" style="justify-content:space-between;gap:10px" data-testid="reminder-prompt">
    <span>🔔 Get a nudge when it's your turn, even if you switch apps.</span>
    <${Btn} small color="sun" onClick=${async () => setState(await enableNotify())}>Turn on<//>
  </div>`;
}
