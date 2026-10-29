import { html, useState, useEffect, useRef } from '../vendor/preact-htm.js';
import { Btn, Avatar, Modal, Doodle, cx, errorText, useNow } from './common.js';
import { AVATARS, COLORS, NAME_MAX, MAX_PLAYERS } from '../game/engine.js';
import { local, KEYS } from '../storage.js';
import { sfx } from './audio.js';

export function Logo({ small }) {
  const letters = 'AI Psych'.split('');
  return html`<div class="logo" style=${small ? 'transform:scale(.7);margin:0' : ''}>
    <div class="logo-word" aria-label="AI Psych">
      <div class="logo-splash"></div>
      ${letters.map((ch, i) =>
        ch === ' ' ? html`<span key=${i} class="gap"></span>` : html`<span key=${i} style=${`animation-delay:${i * 0.07}s, ${i * 0.21}s`}>${ch}</span>`,
      )}
    </div>
  </div>`;
}

export function HowToPlay({ onClose }) {
  return html`<${Modal} onClose=${onClose} title="How to play">
    <ol class="rules">
      <li>One person <b>hosts</b> on their phone or laptop. Everyone else <b>joins</b> with the 4-digit code (${MAX_PLAYERS} players max).</li>
      <li>Our AI asks a question <b>about one of you</b>. Everybody writes a funny (or honest…) answer.</li>
      <li>Everyone votes for their favorite answer — but not their own! <b>No vote, no points:</b> if you don't vote, your own answer's points don't count.</li>
      <li>The person the question is about is the <b>judge</b>: their vote is worth <b>2 points</b>. Everyone else's vote is worth 1.</li>
      <li>The questions start innocent… and the AI gets more and more <i>curious</i> as the game goes on. It also notices things about you while you play. 👀</li>
    </ol>
    <p class="muted small">No accounts, no downloads. If your connection drops or you refresh, you'll pop right back in — even if the host's phone dies, someone else takes over and the game goes on.</p>
    <div class="row" style="justify-content:flex-end"><${Btn} small onClick=${onClose}>Got it!<//></div>
  <//>`;
}

export function Home({ onHost, onJoin, resumeHost, resumePlayer, onResumeHost, onResumePlayer, onForgetHost, onForgetPlayer }) {
  const [rules, setRules] = useState(false);
  return html`<div class="screen enter">
    <div class="stack" style="align-items:center;gap:22px">
      <${Logo} />
      <p class="tagline">The party game where a very curious AI asks questions about <u>you</u>.</p>

      ${resumeHost &&
      html`<div class="card resume-card" style="width:100%">
        <div><div class="card-title">${Doodle.crown({ size: 26 })} You were hosting room ${resumeHost.room.code}</div>
        <div class="muted small">${resumeHost.room.players.filter((p) => !p.gone).length} players · ${resumeHost.room.game ? 'game in progress' : 'in the lobby'}</div></div>
        <div class="row"><${Btn} small color="paper" sound="tap" onClick=${onForgetHost}>Close it</${Btn}><${Btn} small color="mint" onClick=${onResumeHost} testid="resume-host">Resume</${Btn}></div>
      </div>`}
      ${resumePlayer &&
      html`<div class="card resume-card" style="width:100%">
        <div class="row" style="flex-wrap:nowrap"><${Avatar} p=${{ ...resumePlayer.profile, color: 'sky' }} size="sm" />
        <div><div class="card-title" style="margin:0">Room ${resumePlayer.code}</div><div class="muted small">as ${resumePlayer.profile && resumePlayer.profile.name}</div></div></div>
        <div class="row"><${Btn} small color="paper" sound="tap" onClick=${onForgetPlayer}>Forget</${Btn}><${Btn} small color="mint" onClick=${onResumePlayer} testid="resume-player">Rejoin</${Btn}></div>
      </div>`}

      <div class="stack" style="width:100%;max-width:420px">
        <${Btn} big block color="coral" onClick=${onHost} testid="host-btn">${Doodle.crown({ size: 30 })} Host a game<//>
        <${Btn} big block color="sky" onClick=${onJoin} testid="join-btn">${Doodle.door({ size: 30 })} Join with a code<//>
      </div>
      <div class="row center" style="gap:22px">
        <button class="link-btn" onClick=${() => { sfx('tap'); setRules(true); }}>How do I play?</button>
      </div>
      <p class="footer-note">No accounts · no app · 2–${MAX_PLAYERS} players</p>
    </div>
    ${rules && html`<${HowToPlay} onClose=${() => setRules(false)} />`}
  </div>`;
}

export function AvatarPicker({ value, onChange }) {
  const ref = useRef();
  const surprise = () => {
    const a = AVATARS[Math.floor(Math.random() * AVATARS.length)];
    sfx('boing');
    onChange(a);
    setTimeout(() => {
      const el = ref.current && ref.current.querySelector('button.on');
      if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 30);
  };
  return html`<div class="stack" style="gap:8px">
    <div class="avatar-pick" role="radiogroup" aria-label="Pick your avatar" ref=${ref}>
      ${AVATARS.map(
        (a, i) => html`<button key=${a} role="radio" aria-checked=${value === a} class=${value === a ? 'on' : ''}
          onClick=${() => { sfx('pop'); onChange(a); }}>
          <${Avatar} p=${{ avatar: a, color: COLORS[(i * 5) % COLORS.length], name: a }} />
        </button>`,
      )}
    </div>
    <button class="link-btn" style="align-self:center" onClick=${surprise}>🎲 surprise me</button>
  </div>`;
}

function useProfile() {
  const saved = local.get(KEYS.profile, {});
  const [name, setName] = useState(saved.name || '');
  const [avatar, setAvatar] = useState(saved.avatar || AVATARS[Math.floor(Math.random() * AVATARS.length)]);
  return { name, setName, avatar, setAvatar, save: () => local.set(KEYS.profile, { name: name.trim(), avatar }) };
}

function NameField({ prof, error, autoFocus }) {
  return html`<div class="field">
    <label for="name">What should we call you?</label>
    <input id="name" class=${cx('input', error && 'error')} maxlength=${NAME_MAX} autocomplete="nickname" placeholder="Your name"
      value=${prof.name} onInput=${(e) => prof.setName(e.currentTarget.value.replace(/[{}]/g, ''))} autoFocus=${autoFocus} data-testid="name-input" />
  </div>`;
}

export function HostSetup({ onBack, onCreate }) {
  const prof = useProfile();
  const [err, setErr] = useState(null);
  const go = () => {
    if (!prof.name.trim()) return setErr('name-empty');
    prof.save();
    onCreate({ name: prof.name.trim(), avatar: prof.avatar });
  };
  return html`<div class="screen enter">
    <div class="stack">
      <h1 class="center" style="font-size:36px;margin-top:8px">Host a game</h1>
      <div class="card tilt-l stack">
        <${NameField} prof=${prof} error=${err} autoFocus />
        <div class="field"><label>Pick a face</label><${AvatarPicker} value=${prof.avatar} onChange=${prof.setAvatar} /></div>
        ${err && html`<p class="shake" style="color:#b3261e;margin:0">${errorText(err)}</p>`}
      </div>
      <div class="row center">
        <${Btn} color="paper" sound="tap" onClick=${onBack}>${Doodle.back({ size: 24 })} Back<//>
        <${Btn} big color="coral" pulse onClick=${go} testid="create-room">Create room!<//>
      </div>
    </div>
  </div>`;
}

export function CodeBoxes({ value, onChange, onDone }) {
  const refs = [useRef(), useRef(), useRef(), useRef()];
  const digits = (value + '    ').slice(0, 4).split('');
  const set = (i, ch) => {
    const arr = (value.padEnd(4, ' ')).split('');
    arr[i] = ch || ' ';
    const next = arr.join('').replace(/\s+$/, '');
    onChange(next.replace(/ /g, ''));
  };
  const onInput = (i, e) => {
    const v = e.currentTarget.value.replace(/\D/g, '');
    if (v.length > 1) {
      // pasted or autofilled several digits
      const all = (value.slice(0, i) + v).slice(0, 4);
      onChange(all);
      const k = Math.min(3, all.length);
      refs[k].current && refs[k].current.focus();
      if (all.length === 4) onDone && onDone(all);
      return;
    }
    set(i, v);
    if (v) sfx('tap');
    if (v && i < 3) refs[i + 1].current.focus();
    const full = (value.slice(0, i) + v + value.slice(i + 1)).slice(0, 4);
    if (v && full.length === 4 && i === 3) onDone && onDone(full);
  };
  const onKey = (i, e) => {
    if (e.key === 'Backspace' && !digits[i].trim() && i > 0) {
      refs[i - 1].current.focus();
      set(i - 1, '');
      e.preventDefault();
    }
  };
  return html`<div class="code-boxes">
    ${digits.map((d, i) => html`<input key=${i} ref=${refs[i]} inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete=${i ? 'off' : 'one-time-code'}
      aria-label=${`Digit ${i + 1}`} class=${d.trim() ? 'filled' : ''} value=${d.trim()} data-testid=${`code-${i}`}
      onInput=${(e) => onInput(i, e)} onKeyDown=${(e) => onKey(i, e)} onFocus=${(e) => e.currentTarget.select()} />`)}
  </div>`;
}

export function JoinForm({ initialCode = '', error, onBack, onJoin }) {
  const prof = useProfile();
  const [code, setCode] = useState(initialCode);
  const [err, setErr] = useState(error || null);
  useEffect(() => setErr(error || null), [error]);
  const go = () => {
    if (!/^\d{4}$/.test(code)) return setErr('code');
    if (!prof.name.trim()) return setErr('name-empty');
    prof.save();
    onJoin(code, { name: prof.name.trim(), avatar: prof.avatar });
  };
  return html`<div class="screen enter">
    <div class="stack">
      <h1 class="center" style="font-size:36px;margin-top:8px">Join a game</h1>
      <div class="card tilt-r stack">
        <div class="field"><label>Room code</label><${CodeBoxes} value=${code} onChange=${(c) => { setCode(c); setErr(null); }} /></div>
        <${NameField} prof=${prof} error=${err && err !== 'code'} autoFocus=${initialCode.length === 4} />
        <div class="field"><label>Pick a face</label><${AvatarPicker} value=${prof.avatar} onChange=${prof.setAvatar} /></div>
        ${err && html`<p class="shake" style="color:#b3261e;margin:0">${err === 'code' ? 'The room code is 4 digits — ask the host!' : errorText(err)}</p>`}
      </div>
      <div class="row center">
        <${Btn} color="paper" sound="tap" onClick=${onBack}>${Doodle.back({ size: 24 })} Back<//>
        <${Btn} big color="sky" pulse onClick=${go} testid="join-go">Let me in!<//>
      </div>
    </div>
  </div>`;
}

export function Knocking({ code, status, onCancel, since, holding }) {
  const now = useNow(1000);
  const long = now - since > 14000;
  if (holding) {
    return html`<div class="screen enter"><div class="center-msg" data-testid="knock-hold">
      <div class="knock">🛎️</div>
      <h2>${holding.claim ? 'Asking to get your seat back' : 'The game already started!'}<span class="dots"></span></h2>
      <p class="muted">${holding.claim ? 'Same name as a player who got disconnected — the host just needs to confirm it is you.' : 'The host has to let you in. Hang tight — you will jump in with the next question.'}</p>
      <${Btn} color="paper" sound="tap" onClick=${onCancel}>${Doodle.back({ size: 22 })} Never mind<//>
    </div></div>`;
  }
  return html`<div class="screen enter"><div class="center-msg">
    <div class="knock">🚪</div>
    <h2>Knocking on room ${code}<span class="dots"></span></h2>
    <p class="muted">${status === 'host-missing' || long ? "Can't find the host yet… we'll keep trying." : 'Finding the host through the internet tubes.'}</p>
    ${long && html`<p class="small muted" style="max-width:360px">Make sure the code is right and the host's screen is open. Strict Wi-Fi? Try mobile data.</p>`}
    <${Btn} color="paper" sound="tap" onClick=${onCancel}>${Doodle.back({ size: 22 })} Different code<//>
  </div></div>`;
}

const ENDED = {
  kicked: ['👢', 'You were removed from the room', 'The host showed you the door. Rude!'],
  closed: ['🎬', 'The host closed the room', 'Thanks for playing! Start a new one anytime.'],
  left: ['👋', 'You left the room', 'Come back soon!'],
  unknown: ['🤔', "This room doesn't remember you", 'The room may have been restarted. Join again with a name.'],
  replaced: ['📱', "You're playing in another tab", 'The same player opened the game somewhere else.'],
  proto: ['🔄', 'Version mismatch', 'Refresh the page (host too) so everyone runs the same version.'],
  denied: ['🚪', "The host didn't let you in", 'Maybe next game! Ask the host if you think it was a mistake.'],
};

export function Ended({ reason, onHome, onReclaim, onRejoin }) {
  const [emo, title, text] = ENDED[reason] || ['😵', 'Disconnected', errorText(reason)];
  return html`<div class="screen enter"><div class="center-msg">
    <div style="font-size:72px" class="bobbing">${emo}</div>
    <h2>${title}</h2>
    <p class="muted">${text}</p>
    <div class="row center">
      ${reason === 'replaced' && html`<${Btn} color="mint" onClick=${onReclaim}>Play here instead<//>`}
      ${reason === 'unknown' && html`<${Btn} color="mint" onClick=${onRejoin}>Join again<//>`}
      <${Btn} color="sun" onClick=${onHome}>Back to start<//>
    </div>
  </div></div>`;
}
