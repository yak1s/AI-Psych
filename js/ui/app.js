import { html, useState, useEffect, useReducer, useRef } from '../vendor/preact-htm.js';
import { Btn, Toast, Confirm, Modal, Splash, Doodle, cx, useNow } from './common.js';
import { splotch, Scatter } from './art.js';
import { Home, HostSetup, JoinForm, Knocking, Ended, HowToPlay } from './home.js';
import { PlayerLobby, HostLobby } from './lobby.js';
import { AnswerPhase, VotePhase, HostDock } from './game.js';
import { ResultsPhase, FinalPhase } from './results.js';
import { HostController } from '../host-controller.js';
import { PlayerController } from '../player-controller.js';
import { sfx, isMuted, setMuted, onMuteChange } from './audio.js';
import { local, session, KEYS } from '../storage.js';

// ---------------------------------------------------------------------------
// Backdrop: big watercolor blooms whose palette darkens as questions get creepier

const MOODS = {
  1: ['sun', 'bubblegum', 'sky', 'mint'],
  2: ['sky', 'sun', 'grape', 'mint'],
  3: ['grape', 'sky', 'tangerine', 'bubblegum'],
  4: ['grape', 'coral', 'teal', 'plum'],
  5: ['plum', 'blood', 'night', 'teal'],
};

function Backdrop({ mood }) {
  const [layers, setLayers] = useState([{ mood, id: 0 }]);
  useEffect(() => {
    setLayers((ls) => {
      if (ls[ls.length - 1].mood === mood) return ls;
      return [...ls.slice(-1), { mood, id: Date.now() }];
    });
    const t = setTimeout(() => setLayers((ls) => ls.slice(-1)), 2600);
    return () => clearTimeout(t);
  }, [mood]);
  return html`<div class="backdrop">
    ${layers.map((l, i) => html`<div key=${l.id} class=${cx('backdrop-layer', i < layers.length - 1 && 'out')}>
      ${MOODS[l.mood].map((c, j) => html`<div key=${j} class="bloom" style=${`background-image:${splotch(c, j * 7 + l.mood, { strength: l.mood >= 4 ? 0.9 : 0.75, irregular: 0.4 })}`}></div>`)}
    </div>`)}
    <div class="vignette"></div>
  </div>`;
}

function moodOf(view) {
  const g = view && view.game;
  if (!g || !g.q || g.phase === 'final') return 1;
  return g.q.level || 1;
}

const TAB_ID = Math.random().toString(36).slice(2);

function claimHost(c) {
  try {
    const bc = new BroadcastChannel('aipsych');
    bc.postMessage({ t: 'host-claim', code: c.room.code, token: c.token, tab: TAB_ID });
    bc.close();
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------

function useWakeLock(active) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock = null;
    let dead = false;
    const get = async () => {
      if (document.visibilityState !== 'visible' || dead) return;
      try {
        lock = await navigator.wakeLock.request('screen');
      } catch {
        /* not allowed right now */
      }
    };
    get();
    document.addEventListener('visibilitychange', get);
    return () => {
      dead = true;
      document.removeEventListener('visibilitychange', get);
      lock && lock.release().catch(() => {});
    };
  }, [active]);
}

function MuteButton() {
  const [m, setM] = useState(isMuted());
  useEffect(() => onMuteChange(setM), []);
  return html`<button class="icon-btn" aria-label=${m ? 'Unmute sounds' : 'Mute sounds'} title=${m ? 'Unmute' : 'Mute'} data-testid="mute"
    onClick=${() => { setMuted(!m); if (m) setTimeout(() => sfx('pop'), 30); }}>
    ${m ? Doodle.muted({ size: 26 }) : Doodle.speaker({ size: 26 })}
  </button>`;
}

function netInfo(ctrl) {
  if (!ctrl) return null;
  if (ctrl.isHost) {
    const s = ctrl.status;
    if (s === 'online') return { ok: true, text: 'Room is open' };
    if (s === 'id-taken') return { bad: true, text: 'Reclaiming room code…' };
    if (s === 'unsupported') return { bad: true, text: 'This browser does not support WebRTC' };
    return { meh: true, text: s === 'connecting' ? 'Opening room…' : 'Reconnecting to the internet…' };
  }
  if (ctrl.status === 'connected' && ctrl.welcomed) return { ok: true, text: 'Connected' };
  if (ctrl.status === 'host-missing') return { bad: true, text: 'Looking for the host…' };
  return { meh: true, text: 'Reconnecting…' };
}

function NetBanner({ ctrl, view }) {
  const info = netInfo(ctrl);
  const [since, setSince] = useState(null);
  const bad = info && !info.ok;
  useEffect(() => setSince(bad ? Date.now() : null), [bad]);
  const now = useNow(500, bad);
  if (!bad || !since || now - since < 2500) return null;
  const pending = view && view.pendingCount;
  return html`<div class="net-banner" role="status" data-testid="net-banner">
    ${Doodle.wifi({ size: 22 })} ${info.text}${pending ? ' — your moves are saved' : ''}
  </div>`;
}

function TopBar({ ctrl, view, onMenu, onHome }) {
  const info = netInfo(ctrl);
  const g = view && view.game;
  return html`<header class="topbar">
    <button class="logo-mini" onClick=${onHome} aria-label="AI Psych home"><span class="logo-text">AI Psych</span><span class="eye-dot">${Doodle.eye({ size: 22 })}</span></button>
    <div class="grow"></div>
    ${g && g.phase !== 'final' && html`<span class="chip">Q ${g.idx + 1}/${g.n}</span>`}
    ${view && html`<span class="chip code" title="Room code">#${view.code}</span>`}
    ${info && html`<span class=${cx('net-dot', info.bad && 'bad', info.meh && 'meh')} title=${info.text} aria-label=${info.text}></span>`}
    <${MuteButton} />
    ${ctrl && html`<button class="icon-btn" aria-label="Menu" onClick=${onMenu} data-testid="menu">${Doodle.menu({ size: 24 })}</button>`}
  </header>`;
}

function GameScreen({ ctrl, view }) {
  const g = view.game;
  if (!g) return ctrl.isHost ? html`<${HostLobby} ctrl=${ctrl} view=${view} />` : html`<${PlayerLobby} view=${view} />`;
  let body;
  if (g.phase === 'answer') body = html`<${AnswerPhase} ctrl=${ctrl} view=${view} />`;
  else if (g.phase === 'vote') body = html`<${VotePhase} ctrl=${ctrl} view=${view} />`;
  else if (g.phase === 'results') body = html`<${ResultsPhase} ctrl=${ctrl} view=${view} />`;
  else body = html`<${FinalPhase} ctrl=${ctrl} view=${view} />`;
  return html`<div class="screen" key=${g.phase + (g.q ? g.q.key : '')}>${body}</div>
    ${ctrl.isHost && g.phase !== 'final' && html`<${HostDock} ctrl=${ctrl} view=${view} />`}`;
}

// ---------------------------------------------------------------------------

export function App({ boot }) {
  const [, rerender] = useReducer((x) => x + 1, 0);
  const [mode, setMode] = useState(boot.mode);
  const [joinCode, setJoinCode] = useState(boot.code || '');
  const [joinError, setJoinError] = useState(null);
  const [menu, setMenu] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [rules, setRules] = useState(false);
  const ctrlRef = useRef(null);
  const knockSince = useRef(Date.now());

  const setCtrl = (c) => {
    const old = ctrlRef.current;
    if (old && old !== c && old.stop) old.stop();
    ctrlRef.current = c;
    rerender();
  };

  // boot: resume an existing session after a refresh
  useEffect(() => {
    if (boot.resume === 'host') {
      const c = HostController.resume(rerender);
      if (c) claimHost(c);
      setCtrl(c);
    } else if (boot.resume === 'player') setCtrl(PlayerController.resume(rerender));
  }, []);

  const ctrl = ctrlRef.current;
  const view = ctrl ? ctrl.view : null;
  window.__aipsych = ctrlRef; // handy for debugging from the console

  // A join that the host refused (bad name, room full): back to the form with the error.
  useEffect(() => {
    if (ctrl && !ctrl.isHost && ctrl.ended && !ctrl.pid) {
      setJoinError(ctrl.ended.reason);
      setJoinCode(ctrl.identity.code);
      ctrlRef.current = null;
      setMode('join');
    }
  });

  // Another tab took over hosting this room.
  useEffect(() => {
    if (!('BroadcastChannel' in window)) return;
    const bc = new BroadcastChannel('aipsych');
    bc.onmessage = (e) => {
      const c = ctrlRef.current;
      const d = e.data;
      if (d && d.t === 'host-claim' && d.tab !== TAB_ID && c && c.isHost && c.room.code === d.code && c.token === d.token) {
        c.detach();
        ctrlRef.current = { ended: { reason: 'replaced-host' }, isHost: false, stop() {} };
        rerender();
      }
    };
    return () => bc.close();
  }, []);

  const mood = moodOf(view);
  useEffect(() => {
    document.body.dataset.mood = String(mood);
  }, [mood]);
  useWakeLock(!!(view && view.game));

  const phaseKey = view && view.game ? view.game.phase + ':' + (view.game.q ? view.game.q.key : '') : view ? 'lobby' : null;
  const [splash, setSplash] = useState(null);
  const lastPhase = useRef(phaseKey);
  useEffect(() => {
    if (phaseKey && lastPhase.current && phaseKey !== lastPhase.current) {
      setSplash(phaseKey);
      sfx('whoosh');
    }
    lastPhase.current = phaseKey;
  }, [phaseKey]);

  const goHome = () => {
    setCtrl(null);
    setMode('home');
    setJoinError(null);
  };

  const hostSaved = HostController.saved();
  const playerSaved = PlayerController.saved();

  let content;
  if (ctrl && ctrl.ended && ctrl.ended.reason === 'replaced-host') {
    content = html`<div class="screen"><div class="center-msg"><div style="font-size:70px">🗂️</div><h2>Hosting moved to another tab</h2>
      <p class="muted">This room is now being hosted from a different tab or window.</p><${Btn} onClick=${goHome}>OK</${Btn}></div></div>`;
  } else if (ctrl && ctrl.ended) {
    content = html`<${Ended} reason=${ctrl.ended.reason} onHome=${goHome} onReclaim=${() => ctrl.reclaim()}
      onRejoin=${() => { const code = ctrl.identity.code; setCtrl(null); setJoinCode(code); setMode('join'); }} />`;
  } else if (ctrl && view) {
    content = html`<${GameScreen} ctrl=${ctrl} view=${view} />`;
  } else if (ctrl && !ctrl.isHost) {
    content = html`<${Knocking} code=${ctrl.identity.code} status=${ctrl.status} since=${knockSince.current}
      onCancel=${() => { setCtrl(null); session.del(KEYS.role); setJoinCode(''); setMode('join'); }} />`;
  } else if (mode === 'host-setup') {
    content = html`<${HostSetup} onBack=${() => setMode('home')} onCreate=${(profile) => {
      const c = HostController.create(profile, rerender);
      claimHost(c);
      setCtrl(c);
      sfx('join');
    }} />`;
  } else if (mode === 'join') {
    content = html`<${JoinForm} initialCode=${joinCode} error=${joinError} onBack=${() => { setJoinError(null); setMode('home'); }}
      onJoin=${(code, profile) => {
        setJoinError(null);
        knockSince.current = Date.now();
        setCtrl(PlayerController.join(code, profile, rerender));
      }} />`;
  } else {
    content = html`<${Home}
      resumeHost=${hostSaved} resumePlayer=${playerSaved}
      onHost=${() => setMode('host-setup')} onJoin=${() => setMode('join')}
      onResumeHost=${() => { const c = HostController.resume(rerender); claimHost(c); setCtrl(c); }}
      onResumePlayer=${() => { knockSince.current = Date.now(); setCtrl(PlayerController.resume(rerender)); }}
      onForgetHost=${() => { local.del(KEYS.host); rerender(); }}
      onForgetPlayer=${() => { local.del(KEYS.player); rerender(); }} />`;
  }

  const leave = () => {
    setConfirmLeave(false);
    setMenu(false);
    if (ctrl.isHost) ctrl.closeRoom();
    else ctrl.leave && ctrl.leave();
    ctrlRef.current = null;
    session.del(KEYS.role);
    setMode('home');
    rerender();
  };

  return html`<div class="app">
    <${Backdrop} mood=${mood} />
    <${Scatter} count=${12} />
    <div class="spotlight-layer" aria-hidden="true"></div>
    <${TopBar} ctrl=${ctrl && !ctrl.ended ? ctrl : null} view=${ctrl && !ctrl.ended ? view : null} onMenu=${() => setMenu(true)}
      onHome=${() => (ctrl && !ctrl.ended ? setMenu(true) : goHome())} />
    ${content}
    ${ctrl && !ctrl.ended && html`<${NetBanner} ctrl=${ctrl} view=${view} />`}
    <${Toast} toast=${ctrl && ctrl.toast} />
    <${Splash} trigger=${splash} color=${mood >= 4 ? 'plum' : 'grape'} />
    ${menu &&
    html`<${Modal} onClose=${() => setMenu(false)} title="Menu">
      <div class="stack" style="gap:10px">
        <${Btn} block color="sky" sound="tap" onClick=${() => { setMenu(false); setRules(true); }}>How to play<//>
        <${Btn} block color="coral" onClick=${() => setConfirmLeave(true)} testid="leave-room">${ctrl && ctrl.isHost ? 'Close the room' : 'Leave the room'}<//>
        <${Btn} block color="paper" sound="tap" onClick=${() => setMenu(false)}>Back to the game<//>
      </div>
    <//>`}
    ${confirmLeave &&
    html`<${Confirm} title=${ctrl && ctrl.isHost ? 'Close the room?' : 'Leave the room?'}
      text=${ctrl && ctrl.isHost ? 'Everyone will be disconnected and the game ends.' : "You'll leave the game. You can join again with the code."}
      yes=${ctrl && ctrl.isHost ? 'Close it' : 'Leave'} onNo=${() => setConfirmLeave(false)} onYes=${leave} />`}
    ${rules && html`<${HowToPlay} onClose=${() => setRules(false)} />`}
  </div>`;
}
