// Player side of the network: connects to the host's room peer and keeps that
// connection alive forever — heartbeats detect silent failures (phones going to
// sleep, Wi-Fi hiccups, the host refreshing) and trigger a fresh connection.

import { Peer } from '../vendor/peer.js';
import { peerOptions, hostPeerId, APP_ID, TIMING } from '../config.js';
import { uid } from '../game/util.js';

export class ClientNet {
  /**
   * @param {object} o
   * @param {string} o.code
   * @param {() => void} o.onOpen          channel to host is open (send hello now)
   * @param {(msg) => void} o.onMessage
   * @param {(status, detail) => void} o.onStatus  'connecting' | 'connected' | 'reconnecting' | 'host-missing' | 'unsupported'
   */
  constructor(o) {
    this.o = o;
    this.code = o.code;
    this.peer = null;
    this.conn = null;
    this.open = false;
    this.lastSeen = 0;
    this.retry = 0;
    this.timer = null;
    this.stopped = false;
    this.status = 'connecting';
    this.progress = Date.now();
    this._beat = setInterval(() => this._heartbeat(), TIMING.heartbeat);
    this._wake = () => this.poke();
    addEventListener('online', this._wake);
    document.addEventListener('visibilitychange', this._wake);
    addEventListener('pageshow', this._wake);
  }

  start() {
    this._ensurePeer();
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
  }

  /** Dev tool: silently drop all traffic for `ms` (like a phone in a tunnel). */
  simulateOutage(ms = 10000) {
    this.blackhole = Date.now() + ms;
  }

  _dark() {
    return this.blackhole && Date.now() < this.blackhole;
  }

  send(msg) {
    if (!this.open || !this.conn || this._dark()) return false;
    try {
      this.conn.send(msg);
      return true;
    } catch {
      this._fail(this.conn);
      return false;
    }
  }

  /** Called when the page wakes up / comes back online: check fast, reconnect fast. */
  poke() {
    if (this.stopped || document.visibilityState === 'hidden') return;
    if (this.open) {
      if (Date.now() - this.lastSeen > TIMING.deadAfter / 2) this._fail(this.conn);
      else this.send({ t: 'ping', ts: Date.now() });
      return;
    }
    this.retry = 0;
    this._schedule(30);
  }

  // -------------------------------------------------------------------------

  _setStatus(status, detail) {
    if (this.status === status && !detail) return;
    this.status = status;
    this.o.onStatus(status, detail);
  }

  _ensurePeer() {
    if (this.stopped) return;
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
    const peer = new Peer(`${APP_ID}-p-${uid(12)}`, peerOptions());
    this.peer = peer;
    peer.on('open', () => {
      if (peer !== this.peer) return;
      this.progress = Date.now();
      this._connect();
    });
    peer.on('disconnected', () => {
      // Signaling lost. Existing P2P channel may still be fine; only needed for new connections.
      if (peer !== this.peer || this.stopped) return;
      if (!this.open) this._schedule();
    });
    peer.on('close', () => {
      if (peer !== this.peer || this.stopped) return;
      this.peer = null;
      if (!this.open) this._schedule();
    });
    peer.on('error', (err) => {
      if (peer !== this.peer || this.stopped) return;
      const type = err && err.type;
      if (type === 'peer-unavailable') {
        // host isn't registered right now (refreshing? offline?) — keep trying
        this._setStatus('host-missing');
        if (this.conn && !this.open) this._fail(this.conn);
        else this._schedule();
      } else if (type === 'unavailable-id') {
        this.peer = null;
        peer.destroy();
        this._schedule(100);
      } else if (type === 'browser-incompatible') {
        this._setStatus('unsupported');
      } else if (!this.open) {
        this._schedule();
      }
    });
  }

  _connect() {
    if (this.stopped || this.conn) return;
    const peer = this.peer;
    if (!peer || !peer.open) return this._ensurePeer();
    this._setStatus(this.retry ? 'reconnecting' : 'connecting');
    let conn;
    try {
      conn = peer.connect(hostPeerId(this.code), { reliable: true, serialization: 'json' });
    } catch {
      return this._schedule();
    }
    if (!conn) return this._schedule();
    this.conn = conn;
    this.open = false;
    const timeout = setTimeout(() => {
      if (this.conn === conn && !this.open) this._fail(conn);
    }, TIMING.connectTimeout);
    conn.on('open', () => {
      clearTimeout(timeout);
      if (this.conn !== conn) return void conn.close();
      this.open = true;
      this.lastSeen = Date.now();
      this.retry = 0;
      this._setStatus('connected');
      this.o.onOpen();
    });
    conn.on('data', (msg) => {
      if (this.conn !== conn || !msg || typeof msg !== 'object' || this._dark()) return;
      this.lastSeen = Date.now();
      if (msg.t === 'ping') this.send({ t: 'pong', ts: msg.ts });
      else if (msg.t !== 'pong') this.o.onMessage(msg);
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
    this.open = false;
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
    this._setStatus('reconnecting');
    this._schedule();
  }

  _schedule(delay) {
    if (this.stopped) return;
    clearTimeout(this.timer);
    const backoff = [250, 800, 1500, 2500, 4000][Math.min(this.retry, 4)];
    this.retry++;
    this.timer = setTimeout(() => {
      if (this.stopped || this.open) return;
      if (this.conn) this._closeConn(); // a stuck half-open attempt
      this._ensurePeer();
    }, delay ?? backoff + Math.random() * 300);
  }

  _heartbeat() {
    if (this.stopped) return;
    const now = Date.now();
    if (this.open) {
      this.progress = now;
      if (now - this.lastSeen > TIMING.deadAfter) return this._fail(this.conn);
      this.send({ t: 'ping', ts: now });
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
