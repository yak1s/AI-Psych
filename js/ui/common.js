import { html, useState, useEffect, useRef, useMemo } from '../vendor/preact-htm.js';
import { Doodle, colorOf, splotch, brush, PALETTE } from './art.js';
import { sfx, buzz } from './audio.js';
import { levelInfo } from '../game/deck.js';

export const cx = (...a) => a.filter(Boolean).join(' ');

// ---------------------------------------------------------------------------
// hooks

export function useNow(ms = 250, active = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, active]);
  return now;
}

/** Run once per unique key (e.g. play a sound when a phase starts). */
export function useOnKey(key, fn) {
  const last = useRef(null);
  useEffect(() => {
    if (key != null && last.current !== key) {
      last.current = key;
      return fn();
    }
  }, [key]);
}

export function useStep(count, interval, { key, skip = false, delay = 0 } = {}) {
  const [step, setStep] = useState(skip ? count : 0);
  useEffect(() => {
    if (skip) {
      setStep(count);
      return;
    }
    setStep(0);
    let i = 0;
    let t;
    const tick = () => {
      i++;
      setStep(i);
      if (i < count) t = setTimeout(tick, typeof interval === 'function' ? interval(i) : interval);
    };
    t = setTimeout(tick, delay);
    return () => clearTimeout(t);
  }, [key, count, skip]);
  return step;
}

// ---------------------------------------------------------------------------
// players

const GHOST = { id: '?', name: '???', avatar: '👻', color: 'paper', online: false };

export function playerMap(view) {
  const m = {};
  for (const p of view.players) m[p.id] = p;
  return (pid) => m[pid] || { ...GHOST, id: pid };
}

export function Avatar({ p, size = '', badge, crown, off, bob, style, delay }) {
  const bg = splotch(p.color, (p.name || '').length + 3, { strength: 1.1 });
  const st = `background-image:${bg};${style || ''}${delay != null ? `;animation-delay:${delay}s` : ''}`;
  return html`<div class=${cx('avatar', size, off && 'off', bob && 'bobbing')} style=${st} title=${p.name}>
    <span aria-hidden="true">${p.avatar}</span>
    ${badge && html`<span class=${cx('badge', badge === '✓' && 'ok')}>${badge === '✓' ? Doodle.check({ size: 16, sw: 5 }) : badge}</span>`}
    ${crown && html`<span class="crown-on">${Doodle.crown({ size: size === 'xl' ? 60 : 34, sw: 3.5 })}</span>`}
  </div>`;
}

export function PName({ p }) {
  return html`<span class="pname" style=${`background-image:${brush(p.color, (p.name || '').length)}`}>${p.name}</span>`;
}

// ---------------------------------------------------------------------------
// controls

export function Btn({ color = 'sun', big, block, small, ghost, pulse, sound = 'pop', onClick, disabled, children, type = 'button', cls, title, testid }) {
  return html`<button type=${type} title=${title} data-testid=${testid} class=${cx('btn', color, big && 'big', block && 'block', small && 'small', ghost && 'ghost', pulse && 'pulse', cls)}
    disabled=${disabled}
    onClick=${(e) => {
      if (sound) sfx(sound);
      buzz(12);
      onClick && onClick(e);
    }}>${children}</button>`;
}

export function Toggle({ checked, onChange, label, hint }) {
  return html`<label class="toggle">
    <input type="checkbox" checked=${checked} onChange=${(e) => { sfx('tap'); onChange(e.currentTarget.checked); }} />
    <span class="box">${Doodle.check({ size: 22, sw: 5 })}</span>
    <span>${label}${hint && html`<br /><span class="muted small">${hint}</span>`}</span>
  </label>`;
}

export function Seg({ options, value, onChange }) {
  return html`<div class="seg" role="radiogroup">
    ${options.map((o) => html`<button key=${o.value} role="radio" aria-checked=${value === o.value} class=${value === o.value ? 'on' : ''}
      onClick=${() => { sfx('tap'); onChange(o.value); }}>${o.label}</button>`)}
  </div>`;
}

let openModals = 0;

export function Modal({ onClose, children, title, big, head, foot, testid }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  // Dialogs live inside the page; lift the page above the top bar while one is open.
  useEffect(() => {
    openModals++;
    document.body.classList.add('modal-open');
    return () => {
      if (--openModals <= 0) document.body.classList.remove('modal-open');
    };
  }, []);
  return html`<div class="modal-bg" onClick=${(e) => e.target === e.currentTarget && onClose && onClose()}>
    ${big
      ? html`<div class="modal big card" role="dialog" aria-modal="true" data-testid=${testid}>
          <div class="modal-head">
            ${title && html`<h2>${title}</h2>`}
            ${onClose && html`<button class="modal-x" aria-label="Close" onClick=${onClose}>✕</button>`}
            ${head}
          </div>
          <div class="modal-body">${children}</div>
          ${foot && html`<div class="modal-foot">${foot}</div>`}
        </div>`
      : html`<div class="modal card" role="dialog" aria-modal="true">
          ${title && html`<h2>${title}</h2>`}
          ${children}
        </div>`}
  </div>`;
}

export function Confirm({ title, text, yes = 'Yes', no = 'Never mind', color = 'coral', onYes, onNo }) {
  return html`<${Modal} onClose=${onNo} title=${title}>
    <p>${text}</p>
    <div class="row" style="justify-content:flex-end;margin-top:14px">
      <${Btn} small color="paper" onClick=${onNo} sound="tap">${no}<//>
      <${Btn} small color=${color} onClick=${onYes}>${yes}<//>
    </div>
  <//>`;
}

const ERRORS = {
  'name-taken': 'Someone already has that name — pick another!',
  'name-empty': 'You need a name first!',
  'name-braces': "Names can't contain { or }",
  'room-full': 'That room is full (30 players max).',
  denied: "The host didn't let you in this time.",
  'need-players': 'Need at least one more player!',
  'no-questions': 'No fresh questions left for this group! Reset used questions or load another deck.',
  'in-game': 'Finish the current game first.',
  'bad-deck': 'That deck looks empty.',
  'no-answers': 'Nobody has answered yet — skip the question instead.',
  'own-answer': "Nice try! You can't vote for your own answer 😏",
  'not-in-room': "You're not in this room anymore.",
  'host-only': 'Only the host can do that.',
  empty: 'Write something first!',
};

export function errorText(code) {
  return ERRORS[code] || 'Oops! Something went sideways (' + code + ')';
}

export function Toast({ toast }) {
  const [shown, setShown] = useState(null);
  useEffect(() => {
    if (!toast) return;
    setShown(toast);
    sfx(toast.info ? 'tap' : 'error');
    const t = setTimeout(() => setShown(null), 3200);
    return () => clearTimeout(t);
  }, [toast && toast.at]);
  if (!shown) return null;
  return html`<div key=${shown.at} class=${cx('toast', shown.info && 'info')} role="status">${shown.text || errorText(shown.error)}</div>`;
}

// ---------------------------------------------------------------------------
// creep-o-meter

let tracking = false;
function trackPointer() {
  if (tracking) return;
  tracking = true;
  const root = document.documentElement.style;
  const move = (x, y) => {
    root.setProperty('--px', ((x / innerWidth) * 2 - 1).toFixed(3));
    root.setProperty('--py', ((y / innerHeight) * 2 - 1).toFixed(3));
  };
  addEventListener('pointermove', (e) => move(e.clientX, e.clientY), { passive: true });
  addEventListener('touchstart', (e) => e.touches[0] && move(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
}

export function Eye({ open, follow, delay = 0 }) {
  useEffect(() => follow && trackPointer(), [follow]);
  const pupilStyle = follow ? 'transform: translate(calc(var(--px, 0) * 3.5px), calc(var(--py, 0) * 2.2px))' : '';
  return html`<span class=${cx('eyeball', open && 'open')} style=${`animation-delay:${delay}s`}>
    <svg viewBox="0 0 30 20" fill="none" stroke="#2d2a4a" stroke-width="2" stroke-linecap="round">
      ${open
        ? html`<g class="lid" style=${`animation-delay:${delay}s`}>
            <path d="M2 10C8 1.5 22 1.5 28 10 22 18.5 8 18.5 2 10z" fill="#fff" />
            <g class="pupil" style=${pupilStyle}>
              <circle cx="15" cy="10" r="5" fill=${delay > 0.3 ? PALETTE.blood : PALETTE.grape} stroke="none" />
              <circle cx="15" cy="10" r="2.4" fill="#2d2a4a" stroke="none" />
              <circle cx="16.6" cy="8.4" r="1" fill="#fff" stroke="none" />
            </g>
          </g>`
        : html`<path d="M3 9c6 6 18 6 24 0M7 13l-1.6 3M15 15v3.4M23 13l1.6 3" />`}
    </svg>
  </span>`;
}

export function Meter({ level, max = 5 }) {
  const info = levelInfo(level);
  return html`<div class="meter" title=${`Creep-o-meter: ${info.name}`}>
    <span class="meter-label">creep-o-meter</span>
    ${Array.from({ length: max }, (_, i) => html`<${Eye} key=${i} open=${i < level} follow=${level >= 4 && i < level} delay=${i * 0.13} />`)}
  </div>`;
}

// ---------------------------------------------------------------------------
// question text with ink-bleed reveal

export function QuestionText({ segments, who, animate = true, compact }) {
  const parts = useMemo(() => {
    const out = [];
    for (const s of segments) {
      if (s.t === 'p') out.push({ p: who(s.pid) });
      else for (const w of s.v.match(/\S+\s*|\s+/g) || []) out.push({ w });
    }
    return out;
  }, [segments]);
  return html`<div class=${cx('q-text', compact && 'compact')}>
    ${parts.map((x, i) => {
      const st = animate ? `animation-delay:${(0.12 + i * 0.075).toFixed(2)}s` : 'animation:none';
      return x.p
        ? html`<span key=${i} class="w" style=${st}><${PName} p=${x.p} /></span>`
        : html`<span key=${i} class="w" style=${st}>${x.w}</span>`;
    })}
  </div>`;
}

// ---------------------------------------------------------------------------
// countdown ring

export function TimerRing({ endsAt, total, onTick = true }) {
  const now = useNow(200, true);
  const left = Math.max(0, endsAt - now);
  const secs = Math.min(Math.ceil(left / 1000), total ? Math.round(total / 1000) : Infinity);
  const lastSec = useRef(null);
  useEffect(() => {
    if (!onTick || secs === lastSec.current) return;
    if (lastSec.current !== null && secs <= 10 && secs > 0) sfx(secs <= 3 ? 'tock' : 'tick');
    if (lastSec.current !== null && secs <= 3 && secs > 0) buzz(14);
    if (lastSec.current !== null && lastSec.current > 0 && secs === 0) {
      sfx('buzzer');
      buzz([80, 60, 80]);
    }
    lastSec.current = secs;
  }, [secs]);
  const r = 24;
  const c = 2 * Math.PI * r;
  const frac = total ? Math.min(1, left / total) : 0;
  return html`<div class=${cx('timer', secs <= 10 && secs > 0 && 'urgent', secs === 0 && 'done')}>
    <div class="timer-ring">
      <svg viewBox="0 0 58 58">
        <circle cx="29" cy="29" r=${r} fill="#fffcf4" stroke="#2d2a4a" stroke-width="2.5" />
        <circle cx="29" cy="29" r=${r} fill="none" stroke=${secs <= 10 ? PALETTE.coral : PALETTE.mint} stroke-width="7"
          stroke-dasharray=${c} stroke-dashoffset=${c * (1 - frac)} stroke-linecap="round" style="transition: stroke-dashoffset .2s linear, stroke .3s" />
      </svg>
      <span class="num">${secs}</span>
    </div>
    ${secs === 0 ? html`<span class="script">Time's up!</span>` : null}
  </div>`;
}

// ---------------------------------------------------------------------------
// confetti & splashes

export function confetti({ count = 160, duration = 4200, origin = { x: 0.5, y: 0.35 }, spread = 1 } = {}) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti-canvas';
  document.body.appendChild(canvas);
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = (canvas.width = innerWidth * dpr);
  const H = (canvas.height = innerHeight * dpr);
  const g = canvas.getContext('2d');
  const colors = Object.values(PALETTE).slice(0, 8);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3 * spread;
    const v = (8 + Math.random() * 14) * dpr;
    parts.push({
      x: origin.x * W, y: origin.y * H, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      w: (6 + Math.random() * 8) * dpr, h: (8 + Math.random() * 12) * dpr, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
      c: colors[i % colors.length], splat: Math.random() < 0.18, flutter: Math.random() * 10,
    });
  }
  const t0 = performance.now();
  const frame = (t) => {
    const el = t - t0;
    g.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.32 * dpr;
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.x += p.vx + Math.sin((el / 180) + p.flutter) * 1.2 * dpr;
      p.y += p.vy;
      p.rot += p.vr;
      g.save();
      g.globalAlpha = Math.max(0, 1 - el / duration);
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.fillStyle = p.c;
      if (p.splat) {
        g.globalAlpha *= 0.55;
        g.beginPath();
        g.ellipse(0, 0, p.w * 1.1, p.w * 0.8, 0, 0, Math.PI * 2);
        g.fill();
      } else {
        g.fillRect(-p.w / 2, -p.h / 2 * Math.abs(Math.cos(el / 120 + p.flutter)), p.w, p.h * Math.abs(Math.cos(el / 120 + p.flutter)) + 1);
        g.strokeStyle = 'rgba(45,42,74,.5)';
        g.lineWidth = 1;
      }
      g.restore();
    }
    if (el < duration) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

/** Full-screen watercolor splash used between phases. */
export function Splash({ trigger, color = 'grape' }) {
  const [k, setK] = useState(null);
  useEffect(() => {
    if (trigger == null) return;
    setK(trigger);
    const t = setTimeout(() => setK(null), 950);
    return () => clearTimeout(t);
  }, [trigger]);
  if (!k) return null;
  return html`<div class="splash" key=${k}><i style=${`background-image:${splotch(color, String(k).length + 7, { strength: 1.3 })}`}></i></div>`;
}

export { Doodle, colorOf };
