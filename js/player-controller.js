// Player device: keeps an identity (player id + secret) in localStorage so a
// refresh or a network blip silently rejoins as the same player. Actions are
// queued and retried until the host acknowledges them, so nothing is lost.

import { uid } from './game/util.js';
import { PROTOCOL } from './game/engine.js';
import { ClientNet } from './net/client-net.js';
import { takeoverMs } from './config.js';
import { local, session, KEYS, seenQuestions } from './storage.js';
import { unpack } from './net/secure.js';
import { signals, onSignals } from './signals.js';

// If the host can't be reached for takeoverMs() (25s), the first device in line takes over
// hosting; the second one waits a bit longer, in case the first one is gone too.

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
    // Anything not yet acknowledged is re-sent every few seconds (the host ignores duplicates),
    // so an answer sent into a silent network hiccup is never lost.
    this._resend = setInterval(() => {
      this._watchHost();
      if (!this.welcomed || this.ended) return;
      const now = Date.now();
      for (const item of this.pending) {
        if (now - (item.sentAt || 0) > 3500) {
          item.sentAt = now;
          this.net.send({ t: 'act', id: item.id, a: item.a });
        }
      }
    }, 1000);
    this._offSignals = onSignals((dev) => this.welcomed && this.net.send({ t: 'info', dev }));
  }

  /** The host is gone for good? If this device is next in line, take over hosting. */
  _watchHost() {
    if (this.ended || !this.identity.pid || !this.onPromote) return;
    if (this.welcomed && this.net.open) return;
    const b = this._backup();
    if (!b || b.rank < 0 || b.room.roomId !== this.identity.roomId) return;
    if (this.net.epoch > (b.room.epoch || 0)) return; // someone already took over: just find them
    const now = Date.now();
    if (now - b.recvAt > 30 * 60000) return; // too old to trust
    if (now - this.net.lastHeard < takeoverMs() * (1 + b.rank * 1.2)) return;
    // Only if *this* device has internet (otherwise it's us who's lost, not the host).
    const since = this.net.onlineSince;
    if (!since || now - since < 10000) return;
    this.onPromote(b);
  }

  _backup() {
    if (this._backupCache === undefined) this._backupCache = local.get(KEYS.backup);
    return this._backupCache;
  }

  async _storeBackup(m) {
    try {
      if (m.t === 'backup-deck') {
        local.set(KEYS.backupDeck, { sig: m.sig, deck: await unpack(m.deck) });
        return;
      }
      if (m.rank < 0) {
        const b = this._backup();
        if (b) {
          b.rank = -1;
          local.set(KEYS.backup, b);
        }
        return;
      }
      const b = { rank: m.rank, at: m.at, recvAt: Date.now(), deckSig: m.deckSig, room: await unpack(m.room) };
      this._backupCache = b;
      local.set(KEYS.backup, b);
    } catch {
      /* a broken backup is just skipped */
    }
  }

  _startNet() {
    this.net = new ClientNet({
      code: this.identity.code,
      epoch: this.identity.epoch || 0,
      roomId: () => this.identity.roomId,
      onEpoch: (epoch) => {
        this.identity = { ...this.identity, epoch };
        if (this.identity.pid) local.set(KEYS.player, { ...this.identity, savedAt: Date.now() });
      },
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
    const item = { id: uid(10), a, sentAt: Date.now() };
    this.pending.push(item);
    session.set(KEYS.pending, this.pending);
    if (this.welcomed) this.net.send({ t: 'act', id: item.id, a });
    this.emit();
  }

  /** The answer I picked but haven't locked in (counts if time runs out). */
  sendVoteDraft(oid, qkey) {
    this.voteDraft = { t: 'draft', vote: true, oid, qkey };
    if (this.welcomed) this.net.send(this.voteDraft);
  }

  sendInfo(msg) {
    if (this.welcomed) this.net.send({ t: 'info', ...msg });
  }

  /** What I'm typing right now — the host submits it for me if time runs out. */
  sendDraft(text, qkey) {
    this.draft = { t: 'draft', text, qkey };
    if (this.welcomed) this.net.send(this.draft);
  }

  chatPresence(scope) {
    this.chatScope = scope || null;
    if (this.welcomed) this.net.send({ t: 'chat-here', scope: this.chatScope });
  }

  sendChat(text) {
    if (this.welcomed) this.net.send({ t: 'chat', text });
  }

  sendReaction(mid, emoji) {
    if (this.welcomed) this.net.send({ t: 'chat-react', mid, emoji });
  }

  onChatEvent(fn) {
    (this.chatListeners ||= new Set()).add(fn);
    return () => this.chatListeners.delete(fn);
  }

  get transport() {
    return this.net ? this.net.transport : 'none';
  }

  leave() {
    if (this.welcomed) this.net.send({ t: 'act', id: uid(10), a: { type: 'leave' } });
    setTimeout(() => this.stop(), 300);
    this._forget();
  }

  stop() {
    clearInterval(this._resend);
    this._offSignals && this._offSignals();
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
        this.identity = { ...this.identity, pid: m.pid, secret: m.secret, roomId: m.roomId, code: m.code, epoch: Math.max(m.epoch || 0, this.identity.epoch || 0) };
        local.set(KEYS.player, { ...this.identity, savedAt: Date.now() });
        session.set(KEYS.role, { role: 'player', code: m.code });
        this.welcomed = true;
        this.holding = null;
        if (m.epoch > this.net.epoch) this.net.adopt(m.epoch);
        for (const item of this.pending) this.net.send({ t: 'act', id: item.id, a: item.a });
        if (this.draft) this.net.send(this.draft);
        if (this.voteDraft) this.net.send(this.voteDraft);
        if (!this._sentInfo) {
          this._sentInfo = true;
          this.net.send({ t: 'info', dev: signals(), seen: seenQuestions() });
        } else this.net.send({ t: 'info', dev: signals() });
        if (this.chatScope) this.net.send({ t: 'chat-here', scope: this.chatScope });
        this.emit();
        break;
      }
      case 'state':
        // Two paths (direct + relay) can deliver out of order: never go backwards.
        if (this._view && this._view.roomId === m.view.roomId && m.view.seq < this._view.seq && this.welcomed && this._fresh) return;
        this._fresh = true;
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
      case 'chat':
      case 'chat-react':
        this.chatListeners && this.chatListeners.forEach((fn) => fn(m));
        break;
      case 'hold':
        // Mid-game join (or taking back a seat): waiting for the host to say yes.
        if (!this.holding) {
          this.holding = { claim: !!m.claim, since: Date.now() };
          this.emit();
        }
        break;
      case 'backup':
      case 'backup-deck':
        this._storeBackup(m);
        break;
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
