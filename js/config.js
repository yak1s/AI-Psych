// Network configuration. Everything here can be left as-is for GitHub Pages.
//
// SIGNALING: WebRTC needs a tiny "introduction" server so devices can find each
// other; after that all game traffic flows directly between devices (or through
// a TURN relay when networks are strict). By default we use the free public
// PeerJS server. To self-host one: `npx peer --port 9000` and set
//   SIGNALING = { host: 'your.server', port: 443, path: '/', secure: true, key: 'peerjs' }
// or open the app with ?signal=https://your.server:443/path (kept for the tab).
//
// ICE_SERVERS: STUN finds your public address; TURN relays traffic when a direct
// connection is impossible (e.g. some mobile carriers / corporate Wi-Fi). The
// PeerJS TURN servers are included; for maximum reliability add your own
// (e.g. a free TURN account from metered.ca, or Cloudflare's TURN service).

export const APP_ID = 'aipsych-v1-x7q';

export const SIGNALING = null; // null = PeerJS cloud (0.peerjs.com)

export const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
  {
    urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'],
    username: 'peerjs',
    credential: 'peerjsp',
  },
  // { urls: 'turns:your.turn.server:443', username: '...', credential: '...' },
];

export const TIMING = {
  heartbeat: 2000, // ping every 2s
  deadAfter: 9000, // no message for 9s => connection is dead, reconnect
  connectTimeout: 12000, // give ICE this long to connect before retrying
};

// ---------------------------------------------------------------------------
// Runtime overrides (?signal=..., ?ice=none) — remembered for the browser tab.

function readOverrides() {
  const out = {};
  try {
    const params = new URLSearchParams(location.search);
    const saved = JSON.parse(sessionStorage.getItem('aipsych.net') || '{}');
    Object.assign(out, saved);
    if (params.has('signal')) out.signal = params.get('signal');
    if (params.has('ice')) out.ice = params.get('ice');
    if (params.has('debug')) out.debug = Number(params.get('debug')) || 2;
    sessionStorage.setItem('aipsych.net', JSON.stringify(out));
  } catch {
    /* storage may be unavailable */
  }
  return out;
}

const overrides = typeof location !== 'undefined' ? readOverrides() : {};

export function peerOptions() {
  const opts = { debug: overrides.debug || 0, config: { iceServers: ICE_SERVERS, iceCandidatePoolSize: 2 } };
  let sig = SIGNALING;
  if (overrides.signal) {
    try {
      const raw = /^https?:\/\//.test(overrides.signal) ? overrides.signal : 'http://' + overrides.signal;
      const u = new URL(raw);
      sig = {
        host: u.hostname,
        port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname || '/',
        secure: u.protocol === 'https:',
        key: u.searchParams.get('key') || 'peerjs',
      };
    } catch {
      /* ignore bad override */
    }
  }
  if (sig) Object.assign(opts, sig);
  if (overrides.ice === 'none') opts.config = { iceServers: [] };
  return opts;
}

/** Query string to append to share links so joiners use the same servers. */
export function netQuery() {
  const q = new URLSearchParams();
  if (overrides.signal) q.set('signal', overrides.signal);
  if (overrides.ice) q.set('ice', overrides.ice);
  const s = q.toString();
  return s ? '&' + s : '';
}

export function hostPeerId(code) {
  return `${APP_ID}-room-${code}`;
}
