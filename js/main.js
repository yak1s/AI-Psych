import { html, render } from './vendor/preact-htm.js';
import { App } from './ui/app.js';
import { installArt } from './ui/art.js';
import { unlockAudio } from './ui/audio.js';
import { HostController } from './host-controller.js';
import { PlayerController } from './player-controller.js';
import { session, KEYS } from './storage.js';

installArt();
unlockAudio();

// Decide where to start: a refresh of an active tab resumes silently.
const role = session.get(KEYS.role);
const params = new URLSearchParams(location.search);
let boot = { mode: 'home' };
const savedHost = HostController.saved();
const savedPlayer = PlayerController.saved();
if (role && role.role === 'host' && savedHost && savedHost.room.code === role.code) boot = { mode: 'session', resume: 'host' };
else if (role && role.role === 'player' && savedPlayer && savedPlayer.code === role.code) boot = { mode: 'session', resume: 'player' };
else if (/^\d{4}$/.test(params.get('room') || '')) boot = { mode: 'join', code: params.get('room') };
else if (params.has('check')) boot = { mode: 'netcheck' };

render(html`<${App} boot=${boot} />`, document.getElementById('app'));

// Offline cache: lets a refresh work even while the internet is flaky.
if ('serviceWorker' in navigator && location.protocol === 'https:' && !params.has('nosw')) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
