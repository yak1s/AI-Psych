// Reminders while the game is in the background (another app or tab): a system
// notification where the browser allows it, plus a blinking tab title.

import { local, KEYS } from '../storage.js';

export function notifySupported() {
  return typeof Notification !== 'undefined';
}

export function notifyState() {
  if (!notifySupported()) return 'unsupported';
  if (Notification.permission === 'granted') return local.get(KEYS.notify, true) ? 'on' : 'off';
  return Notification.permission === 'denied' ? 'blocked' : 'ask';
}

export async function enableNotify() {
  if (!notifySupported()) return 'unsupported';
  local.set(KEYS.notify, true);
  try {
    if (Notification.permission === 'default') await Notification.requestPermission();
  } catch {
    /* ignore */
  }
  return notifyState();
}

export function disableNotify() {
  local.set(KEYS.notify, false);
}

const BASE_TITLE = typeof document !== 'undefined' ? document.title : 'AI Psych';
let blink = null;

function flashTitle(text) {
  clearInterval(blink);
  let on = false;
  blink = setInterval(() => {
    on = !on;
    document.title = on ? text : BASE_TITLE;
  }, 1000);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      clearInterval(blink);
      document.title = BASE_TITLE;
    }
  });
}

/** Remind the player — only when they're not looking at the game. */
export async function remind(title, body, tag = 'aipsych') {
  if (typeof document === 'undefined' || document.visibilityState === 'visible') return;
  flashTitle(title);
  if (notifyState() !== 'on') return;
  const opts = { body, tag, renotify: true, icon: 'assets/icon.svg', badge: 'assets/icon.svg', vibrate: [80, 40, 80] };
  try {
    const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
    if (reg && reg.showNotification) return void (await reg.showNotification(title, opts));
  } catch {
    /* fall through */
  }
  try {
    const n = new Notification(title, opts);
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* some mobile browsers only allow notifications through the service worker */
  }
}
