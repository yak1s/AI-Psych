// Host side of the network. Every player device gets a Link with up to two
// transports:
//   • direct: a WebRTC data channel (fast, peer-to-peer; found via PeerJS)
//   • relay:  end-to-end encrypted messages through public MQTT brokers, for
//             networks where WebRTC can't connect (VPNs, strict NATs, carriers)
// Messages go over whichever transport is alive (direct preferred). Both sides
// heartbeat on both transports, so a dead path is noticed in seconds and the
// other one simply takes over — players don't even see a "reconnecting" blip.

import { Peer } from '../vendor/peer.js';
import { peerOptions, hostPeerId, epochTag, TIMING, relayBrokers, relayTopic, rtcEnabled } from '../config.js';
import { Relay } from './mqtt.js';
import { cryptoReady, newKeyPair, exportPublic, deriveShared, seal, unseal, plain, unplain } from './secure.js';

const RECOVERABLE = new Set(['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected', 'unavailable-id', 'webrtc']);
const MAX_LINKS = 80;

class Link {
  constructor(net, chan) {
    this.net = net;
    this.chan = chan;
    this.pid = null;
    this.born = Date.now();
    this.rtc = null;
    this.lastRtc = 0;
    this.key = null; // AES key for the relay
    this.lastRelay = 0;
    this.wasAlive = false;
  }

  get rtcOpen() {
    return !!(this.rtc && this.rtc.open && Date.now() - this.lastRtc < TIMING.deadAfter);
  }

  get relayOpen() {
    return !!(this.key && Date.now() - this.lastRelay < TIMING.deadAfter);
  }

  get alive() {
    return this.rtcOpen || this.relayOpen;
  }

  get transport() {
    return this.rtcOpen ? 'direct' : this.relayOpen ? 'relay' : 'none';
  }

  send(msg) {
    if (this.net._dark()) return false;
    if (this.rtc && this.rtc.open && this.rtcOpen) {
      try {
        this.rtc.send(msg);
        return true;
      } catch {
        this.dropRtc();
      }
    }
    if (this.key) {
      this.net._relaySend(this, msg);
      return true;
    }
    return false;
  }

  dropRtc() {
    const c = this.rtc;
    this.rtc = null;
    if (c) {
      try {
        c.close();
      } catch {
        /* ignore */
      }
    }
  }

  close() {
    this.dropRtc();
    if (this.key) this.net.relay && this.net.relay.unsubscribe(relayTopic('c', this.chan, 'up'));
    this.key = null;
  }
}

export class HostNet {
  /**
   * @param {object} o
   * @param {string} o.code  4-digit room code
   * @param {string} o.token secret token so a refreshed host can reclaim its peer id instantly
   * @param {(link, msg) => void} o.onHello
   * @param {(pid, msg) => void} o.onAction
   * @param {(pid, msg) => void} o.onDraft
   * @param {(pid, online) => void} o.onPresence
   * @param {(status, detail) => void} o.onStatus
   * @param {number} [o.epoch]   how many times hosting has moved to another device
   * @param {string} [o.roomId]
   * @param {(epoch) => void} [o.onSuperseded]  another device hosts this room now
   */
  constructor(o) {
    this.o = o;
    this.code = o.code;
    this.epoch = o.epoch || 0;
    this.peer = null;
    this.peerStatus = 'connecting';
    this.relayUp = false;
    this.links = new Map(); // chan -> Link
    this.byPid = new Map(); // pid -> Link
    this.retry = 0;
    this.timer = null;
    this.stopped = false;
    this._beat = setInterval(() => this._heartbeat(), TIMING.heartbeat);
    this._wake = () => this._poke();
    addEventListener('online', this._wake);
    document.addEventListener('visibilitychange', this._wake);
  }

  start() {
    if (rtcEnabled()) this._createPeer();
    else this.peerStatus = 'off';
    this._startRelay();
    this._emitStatus();
  }

  stop() {
    this.stopped = true;
    clearInterval(this._beat);
    clearTimeout(this.timer);
    removeEventListener('online', this._wake);
    document.removeEventListener('visibilitychange', this._wake);
    for (const link of this.links.values()) link.close();
    if (this.peer) this.peer.destroy();
    if (this.relay) this.relay.close();
  }

  /** Dev tool: silently drop all traffic for `ms`. */
  simulateOutage(ms = 10000) {
    this.blackhole = Date.now() + ms;
  }

  _dark() {
    return this.blackhole && Date.now() < this.blackhole;
  }

  isOnline(pid) {
    const l = this.byPid.get(pid);
    return !!(l && l.alive);
  }

  onlinePids() {
    return [...this.byPid.keys()].filter((pid) => this.isOnline(pid));
  }

  transportOf(pid) {
    const l = this.byPid.get(pid);
    return l ? l.transport : 'none';
  }

  send(pid, msg) {
    const link = this.byPid.get(pid);
    return link ? link.send(msg) : false;
  }

  /** Attach a link to a player (replacing any older one). */
  bind(link, pid) {
    const old = this.byPid.get(pid);
    if (old && old !== link) {
      old.send({ t: 'bye', reason: 'replaced' });
      old.pid = null;
      setTimeout(() => this._remove(old), 400);
    }
    link.pid = pid;
    link.wasAlive = true;
    this.byPid.set(pid, link);
    this.o.onPresence(pid, true);
  }

  /** Forget a player entirely (kicked / left). */
  release(pid, bye) {
    const link = this.byPid.get(pid);
    if (!link) return;
    if (bye) link.send(bye);
    this.byPid.delete(pid);
    link.pid = null;
    setTimeout(() => this._remove(link), 500);
  }

  // -------------------------------------------------------------------------
  // status

  get status() {
    if (this.peerStatus === 'unsupported' && !this.relayUp) return 'unsupported';
    if (this.peerStatus === 'online' || this.relayUp) return 'online';
    if (this.peerStatus === 'id-taken') return 'id-taken';
    return this.peerStatus === 'connecting' ? 'connecting' : 'reconnecting';
  }

  _setPeerStatus(s, detail) {
    this.peerStatus = s;
    this._emitStatus(detail);
  }

  _emitStatus(detail) {
    this.o.onStatus(this.status, detail, { direct: this.peerStatus, relay: this.relayUp });
  }

  // -------------------------------------------------------------------------
  // direct (PeerJS / WebRTC)

  _createPeer() {
    if (this.stopped) return;
    if (this.peer && !this.peer.destroyed) {
      try {
        this.peer.destroy();
      } catch {
        /* ignore */
      }
    }
    this._setPeerStatus('connecting');
    let peer;
    try {
      peer = new Peer(hostPeerId(this.code, this.epoch), { ...peerOptions(), token: this.o.token });
    } catch {
      this._setPeerStatus('unsupported');
      return;
    }
    this.peer = peer;
    peer.on('open', () => {
      if (peer !== this.peer) return;
      this.retry = 0;
      this._setPeerStatus('online');
    });
    peer.on('connection', (conn) => {
      if (peer === this.peer) this._accept(conn);
    });
    const lost = () => {
      if (peer !== this.peer || this.stopped) return;
      if (this.peerStatus === 'id-taken') return; // retry already scheduled (with a longer delay)
      this._setPeerStatus('reconnecting');
      this._schedule();
    };
    peer.on('disconnected', lost);
    peer.on('close', lost);
    peer.on('error', (err) => {
      if (peer !== this.peer || this.stopped) return;
      const type = err && err.type;
      if (type === 'unavailable-id') {
        this.idTaken = (this.idTaken || 0) + 1;
        this._setPeerStatus('id-taken', this.idTaken);
        this._schedule(2500);
      } else if (type === 'browser-incompatible') {
        this._setPeerStatus('unsupported');
      } else if (RECOVERABLE.has(type)) {
        this._setPeerStatus('reconnecting');
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
    if (this.stopped || !rtcEnabled()) return;
    const peer = this.peer;
    if (!peer || peer.destroyed) return this._createPeer();
    if (peer.disconnected) {
      try {
        peer.reconnect();
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
    if (rtcEnabled() && (!peer || peer.destroyed || peer.disconnected)) {
      this.retry = 0;
      this._schedule(50);
    }
    this._heartbeat();
  }

  _link(chan) {
    let link = this.links.get(chan);
    if (!link) {
      if (this.links.size >= MAX_LINKS) this._gc(true);
      link = new Link(this, chan);
      this.links.set(chan, link);
    }
    return link;
  }

  /** Is someone hosting this room at `epoch`? Calls back only if a host answers. */
  probe(epoch, found) {
    const peer = this.peer;
    if (!peer || !peer.open || this.stopped) return;
    let conn;
    try {
      conn = peer.connect(hostPeerId(this.code, epoch), { reliable: true, serialization: 'json', metadata: { probe: true } });
    } catch {
      return;
    }
    if (!conn) return;
    const t = setTimeout(() => conn.close(), 10000);
    conn.on('open', () => {
      clearTimeout(t);
      conn.close();
      if (!this.stopped) found(epoch);
    });
    conn.on('error', () => clearTimeout(t));
  }

  _accept(conn) {
    const meta = conn.metadata || {};
    if (meta.probe) {
      conn.on('open', () => setTimeout(() => conn.close(), 1000));
      return;
    }
    const chan = typeof meta.chan === 'string' && meta.chan.length < 64 ? meta.chan : 'rtc-' + conn.connectionId;
    const link = this._link(chan);
    if (link.rtc && link.rtc !== conn) link.dropRtc();
    link.rtc = conn;
    conn.on('open', () => {
      if (link.rtc === conn) link.lastRtc = Date.now();
    });
    conn.on('data', (msg) => {
      if (link.rtc !== conn || this._dark()) return;
      link.lastRtc = Date.now();
      this._onMessage(link, msg);
    });
    const drop = () => {
      if (link.rtc === conn) {
        link.rtc = null;
        this._presence(link);
      }
    };
    conn.on('close', drop);
    conn.on('error', drop);
    conn.on('iceStateChanged', (s) => {
      if (s === 'failed' || s === 'closed') {
        link.dropRtc();
        drop();
      }
    });
  }

  // -------------------------------------------------------------------------
  // relay (MQTT)

  _startRelay() {
    const urls = relayBrokers();
    if (!urls.length || !cryptoReady() || typeof WebSocket === 'undefined') return;
    this.relay = new Relay(
      urls,
      (topic, kind, body) => this._relayIn(topic, kind, body),
      (up) => {
        this.relayUp = up;
        this._emitStatus();
      },
    );
    this.relay.subscribe(relayTopic('r', this.code, 'join'));
    this.relay.subscribe(relayTopic('r', this.code, 'epoch'));
  }

  /** Tell everyone (including a previous host that comes back) who hosts the room now. */
  _announce() {
    if (!this.relay || !this.o.roomId || !this.epoch) return;
    const host = this.o.hostPid ? this.o.hostPid() : null;
    this.relay.publish(relayTopic('r', this.code, 'epoch'), 0, plain({ t: 'epoch', epoch: this.epoch, tag: epochTag(this.o.roomId, this.epoch), host }));
  }

  async _relayIn(topic, kind, body) {
    if (this.stopped || this._dark()) return;
    const parts = topic.split('/');
    try {
      if (parts[parts.length - 1] === 'epoch' && kind === 0) {
        const m = unplain(body);
        if (!this.o.roomId || m.tag !== epochTag(this.o.roomId, m.epoch)) return;
        // A newer host — or (rare) two devices took over at once: the smaller player id keeps it.
        const me = this.o.hostPid ? this.o.hostPid() : null;
        const newer = m.epoch > this.epoch || (m.epoch === this.epoch && this.epoch > 0 && m.host && me && m.host < me);
        if (newer) this.o.onSuperseded && this.o.onSuperseded(m.epoch);
        return;
      }
      if (parts[parts.length - 1] === 'join' && kind === 0) {
        // A player wants to talk through the relay: ECDH handshake.
        const req = unplain(body);
        if (typeof req.chan !== 'string' || req.chan.length > 64 || typeof req.pub !== 'string') return;
        const link = this._link(req.chan);
        if (!link.hs || link.hs.peerPub !== req.pub) {
          const kp = await newKeyPair();
          link.key = await deriveShared(kp, req.pub);
          link.hs = { peerPub: req.pub, pub: await exportPublic(kp) };
          this.relay.subscribe(relayTopic('c', req.chan, 'up'));
        }
        this.relay.publish(relayTopic('c', req.chan, 'down'), 0, plain({ t: 'hs', pub: link.hs.pub, epoch: this.epoch }));
        return;
      }
      if (kind === 1 && parts[parts.length - 1] === 'up') {
        const chan = parts[parts.length - 2];
        const link = this.links.get(chan);
        if (!link || !link.key) return;
        const msg = await unseal(link.key, body);
        link.lastRelay = Date.now();
        this._onMessage(link, msg);
      }
    } catch {
      /* bad or foreign message — ignore */
    }
  }

  async _relaySend(link, msg) {
    if (!this.relay || !link.key) return;
    try {
      const bytes = await seal(link.key, msg);
      this.relay.publish(relayTopic('c', link.chan, 'down'), 1, bytes);
    } catch {
      /* ignore */
    }
  }

  // -------------------------------------------------------------------------

  _onMessage(link, msg) {
    if (!msg || typeof msg !== 'object') return;
    this._presence(link);
    // Traffic from a device we haven't identified yet (e.g. after a host refresh): ask who it is.
    if (msg.t !== 'hello' && (!link.pid || this.byPid.get(link.pid) !== link) && Date.now() - (link.askedAt || 0) > 2000) {
      link.askedAt = Date.now();
      link.send({ t: 'who' });
    }
    switch (msg.t) {
      case 'ping':
      case 'pong':
        break;
      case 'hello':
        this.o.onHello(link, msg);
        break;
      case 'act':
        if (link.pid && this.byPid.get(link.pid) === link) this.o.onAction(link.pid, msg);
        break;
      case 'draft':
        if (link.pid && this.byPid.get(link.pid) === link) this.o.onDraft(link.pid, msg);
        break;
      case 'info':
        if (link.pid && this.byPid.get(link.pid) === link && this.o.onInfo) this.o.onInfo(link.pid, msg);
        break;
      case 'chat':
      case 'chat-here':
      case 'chat-react':
        if (link.pid && this.byPid.get(link.pid) === link && this.o.onChat) this.o.onChat(link.pid, msg);
        break;
      default:
        break;
    }
  }

  _presence(link) {
    const alive = link.alive;
    if (alive === link.wasAlive) return;
    link.wasAlive = alive;
    if (link.pid && this.byPid.get(link.pid) === link) this.o.onPresence(link.pid, alive);
  }

  _remove(link) {
    link.close();
    if (this.links.get(link.chan) === link) this.links.delete(link.chan);
  }

  _gc(force) {
    const now = Date.now();
    for (const link of this.links.values()) {
      const idle = now - Math.max(link.born, link.lastRtc, link.lastRelay);
      if (!link.pid && (idle > 30000 || (force && !link.alive))) this._remove(link);
      else if (link.pid && this.byPid.get(link.pid) !== link) this._remove(link);
    }
  }

  _heartbeat() {
    if (this.stopped) return;
    const now = Date.now();
    if (now - (this.announcedAt || 0) > 5000 && !this._dark()) {
      this.announcedAt = now;
      this._announce();
    }
    for (const link of this.links.values()) {
      // A direct channel that went silent is dead: drop it (the relay may still carry us).
      if (link.rtc && link.rtc.open && link.lastRtc && now - link.lastRtc > TIMING.deadAfter) link.dropRtc();
      if (link.rtc && !link.rtc.open && now - link.born > TIMING.connectTimeout + 8000 && !link.lastRtc) link.dropRtc();
      this._presence(link);
      if (this._dark()) continue;
      const ping = { t: 'ping', ts: now };
      if (link.rtc && link.rtc.open) {
        try {
          link.rtc.send(ping);
        } catch {
          link.dropRtc();
        }
      }
      // Keep the relay warm (every ~4s) so it can take over instantly if the direct path dies.
      if (link.key && (!link.rtcOpen || now - (link.lastRelayPing || 0) > 3900)) {
        link.lastRelayPing = now;
        this._relaySend(link, ping);
      }
    }
    this._gc(false);
  }
}
