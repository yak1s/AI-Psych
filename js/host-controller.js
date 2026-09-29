// Glue between the engine and the host network. The host device is the single
// source of truth; every change is persisted to localStorage immediately, so a
// refresh (or a crashed browser) resumes exactly where the game was.

import * as E from './game/engine.js';
import { uid } from './game/util.js';
import { HostNet } from './net/host-net.js';
import { local, session, KEYS } from './storage.js';

function randomCode() {
  return String(1000 + Math.floor(Math.random() * 9000));
}

export class HostController {
  static create(profile, onChange) {
    const room = E.createRoom({ code: randomCode(), host: profile });
    const c = new HostController(room, uid(24), onChange, true);
    c.save();
    return c;
  }

  static saved() {
    const s = local.get(KEYS.host);
    return s && s.room && s.room.v === 1 ? s : null;
  }

  static resume(onChange) {
    const s = HostController.saved();
    if (!s) return null;
    return new HostController(s.room, s.token, onChange, false);
  }

  constructor(room, token, onChange, fresh) {
    this.isHost = true;
    this.room = room;
    this.token = token;
    this.onChange = onChange;
    this.fresh = fresh;
    this.status = 'connecting';
    this.statusDetail = null;
    this.toast = null;
    this._queued = false;
    session.set(KEYS.role, { role: 'host', code: room.code });
    this._startNet();
    this._unload = () => this.save();
    addEventListener('pagehide', this._unload);
  }

  get pid() {
    return this.room.hostPid;
  }

  _startNet() {
    this.net = new HostNet({
      code: this.room.code,
      token: this.token,
      onHello: (conn, msg) => this._hello(conn, msg),
      onAction: (pid, msg) => this._action(pid, msg),
      onPresence: () => {
        const g = this.room.game;
        const before = g && g.phase + g.idx;
        E.recheck(this.room, this.ctx());
        if (g && before !== g.phase + g.idx) this.room.seq++;
        this.commit();
      },
      onStatus: (status, detail) => {
        // A brand-new room whose code collides with someone else's: just pick another code.
        if (status === 'id-taken' && this.fresh && this.room.players.length === 1 && !this.room.game) {
          this.changeCode();
          return;
        }
        this.status = status;
        this.statusDetail = detail;
        if (status === 'online') this.fresh = false;
        this.emit();
      },
    });
    this.net.start();
  }

  changeCode() {
    this.net.stop();
    this.room.code = randomCode();
    this.token = uid(24);
    session.set(KEYS.role, { role: 'host', code: this.room.code });
    this.save();
    this._startNet();
    this.emit();
  }

  ctx() {
    return { now: Date.now(), online: new Set([this.room.hostPid, ...this.net.onlinePids()]) };
  }

  save() {
    local.set(KEYS.host, { room: this.room, token: this.token, savedAt: Date.now() });
  }

  /** Persist and push fresh state to everyone (coalesced per tick). */
  commit() {
    this.save();
    if (this._queued) return;
    this._queued = true;
    queueMicrotask(() => {
      this._queued = false;
      this.broadcast();
    });
  }

  broadcast() {
    const ctx = this.ctx();
    for (const pid of ctx.online) {
      if (pid === this.room.hostPid) continue;
      this.net.send(pid, { t: 'state', view: E.viewFor(this.room, pid, ctx) });
    }
    this.emit();
  }

  emit() {
    this.onChange && this.onChange();
  }

  /** The host's own view of the game (plus host-only info). */
  get view() {
    const ctx = this.ctx();
    const v = E.viewFor(this.room, this.room.hostPid, ctx);
    v.receivedAt = ctx.now; // timers are relative to when this view was computed
    v.host = E.hostInfo(this.room);
    return v;
  }

  dispatch(action) {
    const res = E.apply(this.room, this.room.hostPid, action, this.ctx());
    if (res.ok) {
      if (action.type === 'kick') this.net.release(action.pid, { t: 'bye', reason: 'kicked' });
      this.commit();
    } else {
      this.toast = { error: res.error, at: Date.now() };
      this.emit();
    }
    return res;
  }

  /** Stop hosting on this tab (data stays saved so it can be resumed). */
  stop() {
    this.save();
    this.detach();
  }

  /** Stop without saving — another tab has taken over and owns the saved state now. */
  detach() {
    this.net.stop();
    removeEventListener('pagehide', this._unload);
  }

  closeRoom() {
    for (const pid of this.net.onlinePids()) this.net.send(pid, { t: 'bye', reason: 'closed' });
    setTimeout(() => this.net.stop(), 300);
    removeEventListener('pagehide', this._unload);
    local.del(KEYS.host);
    session.del(KEYS.role);
  }

  // -------------------------------------------------------------------------

  _reject(conn, reason) {
    this.net.sendConn(conn, { t: 'reject', reason });
    setTimeout(() => {
      try {
        conn.close();
      } catch {
        /* ignore */
      }
    }, 500);
  }

  _welcome(conn, player) {
    this.net.bind(conn, player.id);
    this.net.sendConn(conn, { t: 'welcome', pid: player.id, secret: player.secret, roomId: this.room.roomId, code: this.room.code });
    this.net.sendConn(conn, { t: 'state', view: E.viewFor(this.room, player.id, this.ctx()) });
  }

  _hello(conn, msg) {
    if (msg.proto !== E.PROTOCOL) return this._reject(conn, 'proto');
    const room = this.room;
    if (msg.pid) {
      const p = E.getPlayer(room, msg.pid);
      if (!p || p.secret !== msg.secret || msg.roomId !== room.roomId) return this._reject(conn, 'unknown');
      if (p.gone) return this._reject(conn, p.gone);
      if (p.isHost) return this._reject(conn, 'unknown');
      this._welcome(conn, p);
      this.commit();
      return;
    }
    // New player. A retried join (lost welcome) is recognised by its joinId.
    const again = msg.joinId && room.players.find((p) => p.joinId === msg.joinId && !p.gone);
    if (again) {
      this._welcome(conn, again);
      return;
    }
    const res = E.addPlayer(room, msg.profile || {});
    if (!res.ok) return this._reject(conn, res.error);
    res.player.joinId = msg.joinId || null;
    E.autoAssign(room);
    this._welcome(conn, res.player);
    this.commit();
  }

  _action(pid, msg) {
    if (!msg.id || !msg.a) return;
    if (E.seenAction(this.room, pid, msg.id)) {
      this.net.send(pid, { t: 'ack', id: msg.id, ok: true, dup: true });
      return;
    }
    const res = E.apply(this.room, pid, msg.a, this.ctx());
    this.net.send(pid, { t: 'ack', id: msg.id, ok: res.ok, error: res.error });
    if (msg.a.type === 'leave' && res.ok) this.net.release(pid, { t: 'bye', reason: 'left' });
    this.commit();
  }
}
