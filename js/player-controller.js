// Player device: keeps an identity (player id + secret) in localStorage so a
// refresh or a network blip silently rejoins as the same player. Actions are
// queued and retried until the host acknowledges them, so nothing is lost.

import { uid } from './game/util.js';
import { PROTOCOL } from './game/engine.js';
import { ClientNet } from './net/client-net.js';
import { local, session, KEYS } from './storage.js';

export class PlayerController {
  /** Start a brand-new join. */
  static join(code, profile, onChange) {
    return new PlayerController({ code: String(code), profile, joinId: uid(12) }, onChange);
  }

  static saved() {
    const s = local.get(KEYS.player);
    return s && s.pid && s.code ? s : null;
  }

  /** Rejoin using the identity saved on this device. */
  static resume(onChange) {
    const s = PlayerController.saved();
    return s ? new PlayerController(s, onChange) : null;
  }

  constructor(identity, onChange) {
    this.isHost = false;
    this.identity = identity;
    this.onChange = onChange;
    this.status = 'connecting';
    this.ended = null; // { reason } when the session is over
    this.toast = null;
    this.welcomed = false;
    const cached = session.get(KEYS.view);
    this._view = cached && cached.code === identity.code && (!identity.roomId || cached.roomId === identity.roomId) ? cached : null;
    this.pending = identity.pid ? session.get(KEYS.pending, []) : [];
    this._startNet();
  }

  _startNet() {
    this.net = new ClientNet({
      code: this.identity.code,
      onOpen: () => this._hello(),
      onMessage: (m) => this._message(m),
      onStatus: (s) => {
        this.status = s;
        if (s !== 'connected') this.welcomed = false;
        this.emit();
      },
    });
    this.net.start();
  }

  get pid() {
    return this.identity.pid;
  }

  get view() {
    return this._view ? this._optimistic(this._view) : null;
  }

  emit() {
    this.onChange && this.onChange();
  }

  dispatch(a) {
    if (this.ended) return;
    const item = { id: uid(10), a };
    this.pending.push(item);
    session.set(KEYS.pending, this.pending);
    if (this.welcomed) this.net.send({ t: 'act', id: item.id, a });
    this.emit();
  }

  leave() {
    if (this.welcomed) this.net.send({ t: 'act', id: uid(10), a: { type: 'leave' } });
    setTimeout(() => this.stop(), 300);
    this._forget();
  }

  stop() {
    this.net.stop();
  }

  /** Take over from another tab/device that is using the same identity. */
  reclaim() {
    this.ended = null;
    this.net.stop();
    this._startNet();
    this.emit();
  }

  // -------------------------------------------------------------------------

  _forget() {
    local.del(KEYS.player);
    session.del(KEYS.role);
    session.del(KEYS.pending);
    session.del(KEYS.view);
  }

  _hello() {
    // Keep saying hello until the host answers (a lost hello must never leave us stuck).
    clearTimeout(this._helloRetry);
    this._helloRetry = setTimeout(() => {
      if (!this.welcomed && !this.ended && this.net.open) this._hello();
    }, 3000);
    const id = this.identity;
    if (id.pid) this.net.send({ t: 'hello', proto: PROTOCOL, pid: id.pid, secret: id.secret, roomId: id.roomId });
    else this.net.send({ t: 'hello', proto: PROTOCOL, profile: id.profile, joinId: id.joinId });
  }

  _message(m) {
    switch (m.t) {
      case 'welcome': {
        this.identity = { ...this.identity, pid: m.pid, secret: m.secret, roomId: m.roomId, code: m.code };
        local.set(KEYS.player, { ...this.identity, savedAt: Date.now() });
        session.set(KEYS.role, { role: 'player', code: m.code });
        this.welcomed = true;
        for (const item of this.pending) this.net.send({ t: 'act', id: item.id, a: item.a });
        this.emit();
        break;
      }
      case 'state':
        this._view = m.view;
        session.set(KEYS.view, m.view);
        this._view.receivedAt = Date.now();
        this.emit();
        break;
      case 'ack': {
        const item = this.pending.find((p) => p.id === m.id);
        this.pending = this.pending.filter((p) => p.id !== m.id);
        session.set(KEYS.pending, this.pending);
        if (!m.ok && item && m.error !== 'stale' && m.error !== 'already-voted') this.toast = { error: m.error, at: Date.now() };
        this.emit();
        break;
      }
      case 'reject':
        this._end(m.reason);
        break;
      case 'bye':
        this._end(m.reason);
        break;
      default:
        break;
    }
  }

  _end(reason) {
    // 'replaced' = same identity opened elsewhere; keep identity so this tab can reclaim.
    if (reason !== 'replaced') this._forget();
    this.ended = { reason };
    this.net.stop();
    this.emit();
  }

  /** Overlay not-yet-acknowledged actions so the UI responds instantly. */
  _optimistic(v) {
    if (!this.pending.length || !v.game) return v;
    const g = { ...v.game };
    for (const { a } of this.pending) {
      if (a.qkey && g.q && a.qkey !== g.q.key) continue;
      if (a.type === 'answer' && g.phase === 'answer') {
        g.myAnswer = a.text;
        if (!g.answered.includes(v.me)) g.answered = [...g.answered, v.me];
      } else if (a.type === 'vote' && g.phase === 'vote' && !g.myVote) {
        g.myVote = a.oid;
        if (!g.voted.includes(v.me)) g.voted = [...g.voted, v.me];
      } else if (a.type === 'ready' && g.phase === 'results') {
        if (!g.ready.includes(v.me)) g.ready = [...g.ready, v.me];
      }
    }
    return { ...v, game: g, pendingCount: this.pending.length };
  }
}
