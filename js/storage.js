// Safe wrappers around localStorage / sessionStorage (both can throw in private
// mode or when storage is full). localStorage survives closing the tab;
// sessionStorage survives a refresh of *this* tab only.

function wrap(getStore) {
  return {
    get(key, fallback = null) {
      try {
        const raw = getStore().getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        getStore().setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    del(key) {
      try {
        getStore().removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}

export const local = wrap(() => localStorage);
export const session = wrap(() => sessionStorage);

export const KEYS = {
  host: 'aipsych.host',
  played: 'aipsych.played', // every question this device has ever hosted, across rooms
  player: 'aipsych.player',
  profile: 'aipsych.profile',
  muted: 'aipsych.muted',
  role: 'aipsych.role',
  pending: 'aipsych.pending',
  view: 'aipsych.view',
  backup: 'aipsych.backup', // a copy of the game, in case this device has to take over hosting
  backupDeck: 'aipsych.backupDeck',
  seenQ: 'aipsych.seenQ', // every question this device has played (any role, any room): {id: times}
  chat: 'aipsych.chatlog',
  notify: 'aipsych.notify',
  fullscreen: 'aipsych.fullscreen',
};

/** Questions this device has already played, so no one gets the same one twice. */
export function seenQuestions() {
  return local.get(KEYS.seenQ, {});
}

export function recordSeen(id) {
  if (!id) return;
  const m = seenQuestions();
  m[id] = (m[id] || 0) + 1;
  const keys = Object.keys(m);
  if (keys.length > 3000) for (const k of keys.slice(0, keys.length - 3000)) delete m[k];
  local.set(KEYS.seenQ, m);
}

/** "Seen" flags so animations don't replay after a refresh. */
export function seen(key) {
  return !!session.get('aipsych.seen.' + key, false);
}
export function markSeen(key) {
  session.set('aipsych.seen.' + key, true);
}
