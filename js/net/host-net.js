// Host side of the network: owns the well-known room peer id, accepts player
// connections, heartbeats them and reports presence. It never gives up — if
// the signaling server or the internet drops, it keeps reconnecting while the
// already-established peer-to-peer channels keep working.

import { Peer } from '../vendor/peer.js';
import { peerOptions, hostPeerId, TIMING } from '../config.js';

const RECOVERABLE = new Set(['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected', 'unavailable-id', 'webrtc']);

export class HostNet {
  /**
   * @param {object} o
   * @param {string} o.code  4-digit room code
   * @param {string} o.token secret token so a refreshed host can reclaim its peer id instantly
   * @param {(conn, msg) => void} o.onHello
   * @param {(pid, msg) => void} o.onAction
   * @param {(pid, online) => void} o.onPresence
   * @param {(status, detail) => void} o.onStatus
   */
  constructor(o) {
    this.o = o;
    this.code = o.code;
    this.peer = null;
    this.status = 'connecting';
    this.byPid = new Map(); // pid -> conn
    this.meta = new Map(); // conn -> { pid, lastSeen, born }
    this.retry = 0;
    this.idTaken = 0;
    this.timer = null;
    this.stopped = false;
    this._beat = setInterval(() => this._heartbeat(), TIMING.heartbeat);
    this._wake = () => this._poke();
    addEventListener('online', this._wake);
    document.addEventListener('visibilitychange', this._wake);
  }

  start() {
    this._createPeer();
  }

  stop() {
    this.stopped = true;
    clearInterval(this._beat);
    clearTimeout(this.timer);
    removeEventListener('online', this._wake);
    document.removeEventListener('visibilitychange', this._wake);
    for (const conn of this.meta.keys()) this._safeClose(conn);
    if (this.peer) this.peer.destroy();
  }

  isOnline(pid) {
    const c = this.byPid.get(pid);
    return !!(c && c.open);
  }

  onlinePids() {
    return [...this.byPid.keys()].filter((pid) => this.isOnline(pid));
  }

  send(pid, msg) {
    const conn = this.byPid.get(pid);
    return conn ? this.sendConn(conn, msg) : false;
  }

  /** Dev tool: silently drop all traffic for `ms`. */
  simulateOutage(ms = 10000) {
    this.blackhole = Date.now() + ms;
  }

  _dark() {
    return this.blackhole && Date.now() < this.blackhole;
  }

  sendConn(conn, msg) {
    if (!conn || !conn.open || this._dark()) return false;
    try {
      conn.send(msg);
      return true;
    } catch {
      this._drop(conn);
      return false;
    }
  }

  /** Attach an accepted connection to a player (replacing any older one). */
  bind(conn, pid) {
    const m = this.meta.get(conn);
    if (!m) return;
    const old = this.byPid.get(pid);
    if (old && old !== conn) {
      this.sendConn(old, { t: 'bye', reason: 'replaced' });
      this.meta.delete(old);
      setTimeout(() => this._safeClose(old), 300);
    }
    m.pid = pid;
    this.byPid.set(pid, conn);
    this.o.onPresence(pid, true);
  }

  /** Forget a player entirely (kicked / left). */
  release(pid, bye) {
    const conn = this.byPid.get(pid);
    if (!conn) return;
    if (bye) this.sendConn(conn, bye);
    this.byPid.delete(pid);
    this.meta.delete(conn);
    setTimeout(() => this._safeClose(conn), 400);
  }

  // -------------------------------------------------------------------------

  _setStatus(status, detail) {
    this.status = status;
    this.o.onStatus(status, detail);
  }

  _createPeer() {
    if (this.stopped) return;
    if (this.peer && !this.peer.destroyed) {
      try {
        this.peer.destroy();
      } catch {
        /* ignore */
      }
    }
    this._setStatus('connecting');
    const peer = new Peer(hostPeerId(this.code), { ...peerOptions(), token: this.o.token });
    this.peer = peer;
    peer.on('open', () => {
      if (peer !== this.peer) return;
      this.retry = 0;
      this.idTaken = 0;
      this._setStatus('online');
    });
    peer.on('connection', (conn) => {
      if (peer === this.peer) this._accept(conn);
    });
    const lost = () => {
      if (peer !== this.peer || this.stopped) return;
      if (this.status === 'id-taken') return; // retry already scheduled (with a longer delay)
      this._setStatus('reconnecting');
      this._schedule();
    };
    peer.on('disconnected', lost);
    peer.on('close', lost);
    peer.on('error', (err) => {
      if (peer !== this.peer || this.stopped) return;
      const type = err && err.type;
      if (type === 'unavailable-id') {
        this.idTaken++;
        this._setStatus('id-taken', this.idTaken);
        this._schedule(2500);
      } else if (type === 'browser-incompatible') {
        this._setStatus('unsupported');
      } else if (RECOVERABLE.has(type)) {
        this._setStatus('reconnecting');
        this._schedule();
      }
    });
  }

  _schedule(delay) {
    if (this.stopped) return;
    clearTimeout(this.timer);
    const backoff = [500, 1000, 2000, 3000, 5000][Math.min(this.retry, 4)];
    this.retry++;
    this.timer = setTimeout(() => this._recover(), delay ?? backoff + Math.random() * 400);
  }

  _recover() {
    if (this.stopped) return;
    const peer = this.peer;
    if (!peer || peer.destroyed) return this._createPeer();
    if (peer.disconnected) {
      try {
        peer.reconnect();
        // if the reconnect silently stalls, try again
        this.timer = setTimeout(() => {
          if (this.peer === peer && !peer.open) this._schedule();
        }, 8000);
      } catch {
        this._createPeer();
      }
    }
  }

  _poke() {
    if (document.visibilityState === 'hidden' || this.stopped) return;
    const peer = this.peer;
    if (!peer || peer.destroyed || peer.disconnected) {
      this.retry = 0;
      this._schedule(50);
    }
    this._heartbeat();
  }

  _accept(conn) {
    const m = { pid: null, lastSeen: Date.now(), born: Date.now() };
    this.meta.set(conn, m);
    conn.on('open', () => {
      m.lastSeen = Date.now();
    });
    conn.on('data', (msg) => this._onData(conn, msg));
    conn.on('close', () => this._drop(conn));
    conn.on('error', () => this._drop(conn));
    conn.on('iceStateChanged', (s) => {
      if (s === 'failed' || s === 'closed') this._drop(conn);
    });
  }

  _onData(conn, msg) {
    const m = this.meta.get(conn);
    if (!m || !msg || typeof msg !== 'object' || this._dark()) return;
    m.lastSeen = Date.now();
    switch (msg.t) {
      case 'ping':
        this.sendConn(conn, { t: 'pong', ts: msg.ts });
        break;
      case 'pong':
        break;
      case 'hello':
        this.o.onHello(conn, msg);
        break;
      case 'act':
        if (m.pid && this.byPid.get(m.pid) === conn) this.o.onAction(m.pid, msg);
        break;
      default:
        break;
    }
  }

  _drop(conn) {
    const m = this.meta.get(conn);
    if (!m) return;
    this.meta.delete(conn);
    this._safeClose(conn);
    if (m.pid && this.byPid.get(m.pid) === conn) {
      this.byPid.delete(m.pid);
      this.o.onPresence(m.pid, false);
    }
  }

  _safeClose(conn) {
    try {
      conn.close();
    } catch {
      /* ignore */
    }
  }

  _heartbeat() {
    const now = Date.now();
    for (const [conn, m] of this.meta) {
      // Silent for too long, or connected but never said who it is: drop it.
      if (now - m.lastSeen > TIMING.deadAfter || (!m.pid && now - m.born > TIMING.connectTimeout + 8000)) {
        this._drop(conn);
        continue;
      }
      if (conn.open) this.sendConn(conn, { t: 'ping', ts: now });
    }
  }
}
