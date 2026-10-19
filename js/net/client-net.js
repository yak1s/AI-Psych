// Player side of the network. Two transports run side by side:
//   • direct: a WebRTC data channel to the host (via PeerJS)
//   • relay:  end-to-end encrypted messages through public MQTT brokers
// The relay handshake starts immediately, so if WebRTC can't connect (VPNs,
// strict NATs, some carriers) the game works anyway. Heartbeats on both paths
// detect silent failures (sleeping phones, Wi-Fi hiccups, a host refresh) and
// each path reconnects on its own without interrupting the other.

import { Peer } from '../vendor/peer.js';
import { peerOptions, hostPeerId, APP_ID, TIMING, relayBrokers, relayTopic, rtcEnabled } from '../config.js';
import { uid } from '../game/util.js';
import { Relay } from './mqtt.js';
import { cryptoReady, newKeyPair, exportPublic, deriveShared, seal, unseal, plain, unplain } from './secure.js';

export class ClientNet {
  /**
   * @param {object} o
   * @param {string} o.code
   * @param {() => void} o.onOpen          a path to the host is open (send hello now)
   * @param {(msg) => void} o.onMessage
   * @param {(status, detail) => void} o.onStatus  'connecting' | 'connected' | 'reconnecting' | 'host-missing' | 'unsupported'
   */
  constructor(o) {
    this.o = o;
    this.code = o.code;
    this.chan = uid(16); // identifies this device's link on both transports
    this.peer = null;
    this.conn = null;
    this.rtcUp = false;
    this.lastRtc = 0;
    this.retry = 0;
    this.timer = null;
    this.stopped = false;
    this.status = 'connecting';
    this.progress = Date.now();
    this.wasOpen = false;
    // relay
    this.relay = null;
    this.key = null;
    this.lastRelay = 0;
    this.hsSentAt = 0;
    this._beat = setInterval(() => this._heartbeat(), TIMING.heartbeat);
    this._wake = () => this.poke();
    addEventListener('online', this._wake);
    document.addEventListener('visibilitychange', this._wake);
    addEventListener('pageshow', this._wake);
  }

  start() {
    if (rtcEnabled()) this._ensurePeer();
    this._startRelay();
  }

  stop() {
    this.stopped = true;
    clearInterval(this._beat);
    clearTimeout(this.timer);
    removeEventListener('online', this._wake);
    document.removeEventListener('visibilitychange', this._wake);
    removeEventListener('pageshow', this._wake);
    this._closeConn();
    if (this.peer) this.peer.destroy();
    if (this.relay) this.relay.close();
  }

  /** Dev tool: silently drop all traffic for `ms` (like a phone in a tunnel). */
  simulateOutage(ms = 10000) {
    this.blackhole = Date.now() + ms;
  }

  /** Dev tool: kill the direct WebRTC path for good (as if a VPN blocked it). */
  disableDirect() {
    this.noDirect = true;
    this._closeConn();
    if (this.peer) this.peer.destroy();
    this.peer = null;
    this._check();
  }

  _dark() {
    return this.blackhole && Date.now() < this.blackhole;
  }

  get rtcOpen() {
    return this.rtcUp && Date.now() - this.lastRtc < TIMING.deadAfter;
  }

  get relayOpen() {
    return !!(this.key && Date.now() - this.lastRelay < TIMING.deadAfter);
  }

  /** True when at least one path to the host works. */
  get open() {
    return this.rtcOpen || this.relayOpen;
  }

  get transport() {
    return this.rtcOpen ? 'direct' : this.relayOpen ? 'relay' : 'none';
  }

  send(msg) {
    if (this._dark()) return false;
    if (this.rtcOpen) {
      try {
        this.conn.send(msg);
        return true;
      } catch {
        this._fail(this.conn);
      }
    }
    if (this.key) {
      this._relaySend(msg);
      return this.relayOpen;
    }
    return false;
  }

  /** Called when the page wakes up / comes back online: check fast, reconnect fast. */
  poke() {
    if (this.stopped || document.visibilityState === 'hidden') return;
    if (this.rtcUp && Date.now() - this.lastRtc > TIMING.deadAfter / 2) this._fail(this.conn);
    if (this.key && Date.now() - this.lastRelay > TIMING.deadAfter / 2) this._relayHandshake(true);
    this._ping();
    if (!this.rtcUp && rtcEnabled() && !this.noDirect) {
      this.retry = 0;
      this._schedule(30);
    }
  }

  // -------------------------------------------------------------------------

  _setStatus(status, detail) {
    if (this.status === status && !detail) return;
    this.status = status;
    this.o.onStatus(status, detail);
  }

  /** Recompute the overall state after anything changed. */
  _check() {
    const open = this.open;
    if (open) {
      this.progress = Date.now();
      this._setStatus('connected');
    } else if (this.status === 'connected') this._setStatus('reconnecting');
    if (open && !this.wasOpen) {
      this.wasOpen = true;
      this.o.onOpen();
    } else if (!open) this.wasOpen = false;
  }

  _message(msg) {
    if (!msg || typeof msg !== 'object') return;
    this._check();
    if (msg.t === 'who') return this.o.onOpen(); // host doesn't know this link yet
    if (msg.t !== 'ping' && msg.t !== 'pong') this.o.onMessage(msg);
  }

  // ---------------------------------------------------------------- direct

  _ensurePeer() {
    if (this.stopped || this.noDirect) return;
    if (this.peer && !this.peer.destroyed) {
      if (this.peer.open) return this._connect();
      if (this.peer.disconnected) {
        try {
          this.peer.reconnect();
        } catch {
          this.peer = null;
          return this._ensurePeer();
        }
      }
      return this._schedule(4000); // still connecting to signaling; check back
    }
    let peer;
    try {
      peer = new Peer(`${APP_ID}-p-${uid(12)}`, peerOptions());
    } catch {
      return;
    }
    this.peer = peer;
    peer.on('open', () => {
      if (peer !== this.peer) return;
      this.progress = Date.now();
      this._connect();
    });
    peer.on('disconnected', () => {
      // Signaling lost. Existing P2P channel may still be fine; only needed for new connections.
      if (peer !== this.peer || this.stopped) return;
      if (!this.rtcUp) this._schedule();
    });
    peer.on('close', () => {
      if (peer !== this.peer || this.stopped) return;
      this.peer = null;
      if (!this.rtcUp) this._schedule();
    });
    peer.on('error', (err) => {
      if (peer !== this.peer || this.stopped) return;
      const type = err && err.type;
      if (type === 'peer-unavailable') {
        // host isn't registered right now (refreshing? offline?) — keep trying
        if (!this.open) this._setStatus('host-missing');
        if (this.conn && !this.rtcUp) this._fail(this.conn);
        else this._schedule();
      } else if (type === 'unavailable-id') {
        this.peer = null;
        peer.destroy();
        this._schedule(100);
      } else if (type === 'browser-incompatible') {
        if (!this.open) this._setStatus('unsupported');
      } else if (!this.rtcUp) {
        this._schedule();
      }
    });
  }

  _connect() {
    if (this.stopped || this.conn || this.noDirect) return;
    const peer = this.peer;
    if (!peer || !peer.open) return this._ensurePeer();
    if (!this.open) this._setStatus(this.retry ? 'reconnecting' : 'connecting');
    let conn;
    try {
      conn = peer.connect(hostPeerId(this.code), { reliable: true, serialization: 'json', metadata: { chan: this.chan } });
    } catch {
      return this._schedule();
    }
    if (!conn) return this._schedule();
    this.conn = conn;
    this.rtcUp = false;
    const timeout = setTimeout(() => {
      if (this.conn === conn && !this.rtcUp) this._fail(conn);
    }, TIMING.connectTimeout);
    conn.on('open', () => {
      clearTimeout(timeout);
      if (this.conn !== conn) return void conn.close();
      this.rtcUp = true;
      this.lastRtc = Date.now();
      this.retry = 0;
      this._check();
      this.o.onOpen(); // a brand-new path: (re)introduce ourselves on it
    });
    conn.on('data', (msg) => {
      if (this.conn !== conn || this._dark()) return;
      this.lastRtc = Date.now();
      this._message(msg);
    });
    conn.on('close', () => this._fail(conn));
    conn.on('error', () => this._fail(conn));
    conn.on('iceStateChanged', (s) => {
      if (s === 'failed' || s === 'closed') this._fail(conn);
    });
  }

  _closeConn() {
    const c = this.conn;
    this.conn = null;
    this.rtcUp = false;
    if (c) {
      try {
        c.close();
      } catch {
        /* ignore */
      }
    }
  }

  _fail(conn) {
    if (!conn || conn !== this.conn) return;
    this._closeConn();
    if (this.stopped) return;
    this._check();
    this._schedule();
  }

  _schedule(delay) {
    if (this.stopped || this.noDirect || !rtcEnabled()) return;
    clearTimeout(this.timer);
    const backoff = [250, 800, 1500, 2500, 4000, 8000][Math.min(this.retry, 5)];
    this.retry++;
    this.timer = setTimeout(() => {
      if (this.stopped || this.rtcUp) return;
      if (this.conn) this._closeConn(); // a stuck half-open attempt
      this._ensurePeer();
    }, delay ?? backoff + Math.random() * 300);
  }

  // ---------------------------------------------------------------- relay

  _startRelay() {
    const urls = relayBrokers();
    if (!urls.length || !cryptoReady() || typeof WebSocket === 'undefined') return;
    this.relay = new Relay(
      urls,
      (topic, kind, body) => this._relayIn(topic, kind, body),
      (up) => up && this._relayHandshake(true),
    );
    this.relay.subscribe(relayTopic('c', this.chan, 'down'));
    this._relayHandshake(true);
  }

  async _relayHandshake(force) {
    if (!this.relay || this.stopped) return;
    const now = Date.now();
    if (!force && now - this.hsSentAt < 2500) return;
    this.hsSentAt = now;
    if (!this.kp) {
      this.kp = await newKeyPair();
      this.pub = await exportPublic(this.kp);
    }
    this.relay.publish(relayTopic('r', this.code, 'join'), 0, plain({ chan: this.chan, pub: this.pub }));
  }

  async _relayIn(topic, kind, body) {
    if (this.stopped || this._dark()) return;
    try {
      if (kind === 0) {
        const m = unplain(body);
        if (m.t === 'hs' && typeof m.pub === 'string' && m.pub !== this.hostPub) {
          this.key = await deriveShared(this.kp, m.pub);
          this.hostPub = m.pub;
          this.lastRelay = Date.now();
          this._relaySend({ t: 'ping', ts: Date.now() });
          this._check();
          if (!this.rtcOpen) this.o.onOpen(); // new relay session (e.g. host refreshed)
        }
        return;
      }
      if (!this.key) return;
      const msg = await unseal(this.key, body);
      this.lastRelay = Date.now();
      this._message(msg);
    } catch {
      /* not for us / stale key */
    }
  }

  async _relaySend(msg) {
    if (!this.relay || !this.key) return;
    try {
      this.relay.publish(relayTopic('c', this.chan, 'up'), 1, await seal(this.key, msg));
    } catch {
      /* ignore */
    }
  }

  // ---------------------------------------------------------------- heartbeat

  _ping() {
    if (this._dark()) return;
    const ping = { t: 'ping', ts: Date.now() };
    if (this.rtcUp && this.conn) {
      try {
        this.conn.send(ping);
      } catch {
        this._fail(this.conn);
      }
    }
    // Keep the relay warm, but gently (public brokers): every ~4s while the direct path is fine.
    if (this.key && (!this.rtcOpen || Date.now() - (this.lastRelayPing || 0) > 3900)) {
      this.lastRelayPing = Date.now();
      this._relaySend(ping);
    }
  }

  _heartbeat() {
    if (this.stopped) return;
    const now = Date.now();
    if (this.rtcUp && now - this.lastRtc > TIMING.deadAfter) this._fail(this.conn);
    // No relay handshake yet, or the relay went quiet (host refreshed?): (re)introduce ourselves.
    if (this.relay && (!this.key || now - this.lastRelay > TIMING.deadAfter)) this._relayHandshake(false);
    this._ping();
    this._check();
    if (this.open || !rtcEnabled() || this.noDirect) {
      this.progress = now;
      return;
    }
    // Watchdog: if nothing has progressed for a while, start over with a brand new peer.
    if (now - (this.progress || now) > 25000) {
      this.progress = now;
      this._closeConn();
      const old = this.peer;
      this.peer = null;
      if (old) old.destroy();
      this.retry = 0;
      this._schedule(0);
    }
  }
}
