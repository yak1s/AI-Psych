import { html, render } from './vendor/preact-htm.js';
import { App } from './ui/app.js';
import { installArt } from './ui/art.js';
import { unlockAudio } from './ui/audio.js';
import { installAutoFullscreen } from './ui/fullscreen.js';
import { HostController } from './host-controller.js';
import { PlayerController } from './player-controller.js';
import { session, KEYS } from './storage.js';

installArt();
unlockAudio();
installAutoFullscreen();
stableBackground();

// Decide where to start: a refresh of an active tab resumes silently.
const role = session.get(KEYS.role);
const params = new URLSearchParams(location.search);
let boot = { mode: 'home' };
const savedHost = HostController.saved();
const savedPlayer = PlayerController.saved();
if (role && role.role === 'host' && savedHost && savedHost.room.code === role.code) boot = { mode: 'session', resume: 'host' };
else if (role && role.role === 'player' && savedPlayer && savedPlayer.code === role.code) boot = { mode: 'session', resume: 'player' };
else if (/^\d{4}$/.test(params.get('room') || '')) boot = { mode: 'join', code: params.get('room') };

// (Firefox gets a "please use Chrome or Safari" page from index.html instead.)
if (!window.__aipsychBlocked) render(html`<${App} boot=${boot} />`, document.getElementById('app'));

// Offline cache: lets a refresh work even while the internet is flaky.
if ('serviceWorker' in navigator && location.protocol === 'https:' && !params.has('nosw')) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

// The painted background is sized once from the screen, not the viewport, so it never
// jumps when the address bar slides away or full screen turns on/off (only on rotation).
function stableBackground() {
  const root = document.documentElement.style;
  let lastW = 0;
  const set = () => {
    const w = Math.max(innerWidth, 1);
    if (Math.abs(w - lastW) < 2) return; // height-only change: address bar, full screen
    lastW = w;
    const portrait = innerHeight >= innerWidth;
    const sw = screen.width || w;
    const sh = screen.height || innerHeight;
    const h = Math.max(innerHeight, portrait ? Math.max(sw, sh) : Math.min(sw, sh)) + 120;
    root.setProperty('--bg-w', w + 'px');
    root.setProperty('--bg-h', h + 'px');
    root.setProperty('--bg-u', Math.max(w, h) / 100 + 'px');
  };
  set();
  addEventListener('resize', set, { passive: true });
  addEventListener('orientationchange', () => setTimeout(() => ((lastW = 0), set()), 250));
}
