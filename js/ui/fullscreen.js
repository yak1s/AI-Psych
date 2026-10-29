// Full screen on phones and tablets: entered automatically on the first tap (browsers
// only allow it after a tap), and again after it's lost — unless the player turned it off.

import { local, KEYS } from '../storage.js';

const el = () => document.documentElement;
export const fullscreenSupported = () => !!(el().requestFullscreen || el().webkitRequestFullscreen);
export const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

export function fullscreenWanted() {
  return local.get(KEYS.fullscreen, coarse());
}

export function enterFullscreen() {
  if (!fullscreenSupported() || isFullscreen()) return;
  try {
    const p = el().requestFullscreen ? el().requestFullscreen({ navigationUI: 'hide' }) : el().webkitRequestFullscreen();
    if (p && p.catch) p.catch(() => {});
  } catch {
    /* not allowed right now */
  }
}

export function setFullscreen(on) {
  local.set(KEYS.fullscreen, on);
  if (on) enterFullscreen();
  else if (isFullscreen()) (document.exitFullscreen || document.webkitExitFullscreen).call(document).catch?.(() => {});
}

export function installAutoFullscreen() {
  const go = () => {
    if (fullscreenWanted()) enterFullscreen();
  };
  addEventListener('pointerup', go, { passive: true });
  addEventListener('keydown', (e) => e.key === 'Enter' && go());
}
