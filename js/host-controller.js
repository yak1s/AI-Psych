// Glue between the engine and the host network. The host device is the single
// source of truth; every change is persisted to localStorage immediately, so a
// refresh (or a crashed browser) resumes exactly where the game was.

import * as E from './game/engine.js';
import { uid, hash } from './game/util.js';
import { HostNet } from './net/host-net.js';
import { pack } from './net/secure.js';
import { TIMING } from './config.js';
import { local, session, KEYS, seenQuestions } from './storage.js';
import { signals, onSignals } from './signals.js';
import { cleanSignals, addStat } from './stats.js';

const DEPUTIES = 2; // devices that keep a backup of the game, ready to take over hosting

function randomCode() {
  return String(1000 + Math.floor(Math.random() * 9000));
}

export class HostController {
  static create(profile, onChange) {
    const room = E.createRoom({ code: randomCode(), host: profile });
    // Questions this device has already hosted (in any room) are never asked again.
    const prev = HostController.saved();
    room.used = [...new Set([...local.get(KEYS.played, []), ...((prev && prev.room.used) || [])])];
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

  /**
   * The host vanished and this device was next in line: carry on hosting from the
   * last backup. Everyone's devices find the new host by themselves.
   */
  static fromBackup(backup, pid, onChange) {
    const room = backup.room;
    if (!room || !E.getPlayer(room, pid)) return null;
    const deck = local.get(KEYS.backupDeck);
    room.deck = backup.deckSig && deck && deck.sig === backup.deckSig ? deck.deck : null;
    if (!room.deck) room.assign = {};
    E.promote(room, pid, { now: Date.now(), snapAt: backup.at });
    room.used = [...new Set([...room.used, ...local.get(KEYS.played, [])])];
    local.del(KEYS.player);
    local.del(KEYS.backup);
    const c = new HostController(room, uid(24), onChange, false);
    c.promoted = Date.now();
    c.save();
    return c;
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
    this.lastOff = {};
    // This device's own clues and question history count too.
    room.signals = room.signals || {};
    room.stats = room.stats || {};
    room.seenBy = room.seenBy || {};
    room.signals[room.hostPid] = cleanSignals(signals());
    this._offSignals = onSignals((sig) => {
      this.room.signals[this.room.hostPid] = cleanSignals(sig);
    });
    this._mergeSeen(room.hostPid, seenQuestions());
    // Hard time limits are enforced by the host's clock.
    this._tick = setInterval(() => this._onTick(), 500);
  }

  _onTick() {
    const room = this.room;
    const now = Date.now();
    const dt = now - (this._lastTick || now);
    this._lastTick = now;
    const others = E.activePlayers(room).filter((p) => !p.isHost);
    const online = this.net.onlinePids();
    for (const p of others) if (!online.includes(p.id)) this.lastOff[p.id] = now;
    // The host itself lost the internet (nobody can reach it): stop the clock, nobody should
    // lose their turn because of the host's connection.
    if (others.length && !online.length && this._hadOnline) {
      if (!this._dark) {
        this._dark = true;
        E.pauseTimer(room, TIMING.deadAfter); // it took this long to notice
      }
      E.pauseTimer(room, dt);
      this._lonely = (this._lonely || 0) + dt;
      // Away for long? Maybe another device took over hosting meanwhile: ask (relay-free check).
      if (this._lonely > 15000 && now - (this._probedAt || 0) > 15000) {
        this._probedAt = now;
        this.net.probe((room.epoch || 0) + 1, (e) => this._superseded(e));
      }
    } else {
      this._dark = false;
      this._lonely = 0;
    }
    if (online.length) this._hadOnline = true;
    if (room.game && E.tick(room, this.ctx())) this.commit();
  }

  get pid() {
    return this.room.hostPid;
  }

  _startNet() {
    this.net = new HostNet({
      code: this.room.code,
      token: this.token,
      onHello: (link, msg) => this._hello(link, msg),
      onAction: (pid, msg) => this._action(pid, msg),
      onDraft: (pid, msg) => this._draft(pid, msg),
      onChat: (pid, msg) => this._chat(pid, msg),
      onInfo: (pid, msg) => this._info(pid, msg),
      epoch: this.room.epoch || 0,
      roomId: this.room.roomId,
      hostPid: () => this.room.hostPid,
      onSuperseded: (epoch) => this._superseded(epoch),
      onPresence: (pid, online) => {
        if (!online && pid && E.inGame(this.room)) addStat(this.room, pid, { drops: 1 });
        const g = this.room.game;
        const before = g && g.phase + g.idx;
        E.recheck(this.room, this.ctx());
        if (g && before !== g.phase + g.idx) this.room.seq++;
        this.commit();
      },
      onStatus: (status, detail, paths) => {
        this.paths = paths;
        // A brand-new room whose code collides with someone else's: just pick another code.
        if (status === 'id-taken' && this.fresh && this.room.players.length === 1 && !this.room.game) {
          this.changeCode();
          return;
        }
        // Took over hosting, but another device beat us to it: go back to playing.
        if (paths && paths.direct === 'id-taken' && this.promoted && detail >= 3) {
          this._superseded(this.room.epoch);
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
    const now = Date.now();
    const online = this.net.onlinePids();
    const transport = {};
    for (const pid of online) transport[pid] = this.net.transportOf(pid);
    // Players whose connection dropped in the last few seconds (a time limit waits for them).
    const flaky = new Set(Object.keys(this.lastOff || {}).filter((pid) => now - this.lastOff[pid] < 8000));
    return { now, online: new Set([this.room.hostPid, ...online]), transport, flaky };
  }

  // ---------------------------------------------------------------- hand-over

  /** Another device hosts this room now (we were away too long): become a player. */
  _superseded(epoch) {
    if (this.demoted) return;
    this.demoted = true;
    const identity = { ...E.demotedIdentity(this.room), epoch };
    this.detach();
    local.del(KEYS.host);
    if (this.onDemote) this.onDemote(identity);
  }

  /** Keep a compressed backup of the whole game on the next devices in line. */
  _backup() {
    if (this._backupTimer) return;
    this._backupTimer = setTimeout(async () => {
      this._backupTimer = null;
      if (this.demoted || this.net.stopped) return;
      const room = this.room;
      const online = new Set(this.net.onlinePids());
      const deputies = E.activePlayers(room)
        .filter((p) => !p.isHost && online.has(p.id))
        .sort((a, b) => a.joinedAt - b.joinedAt)
        .slice(0, DEPUTIES)
        .map((p) => p.id);
      const deckIds = new Set(room.deck ? room.deck.questions.map((q) => q.id) : []);
      const lite = { ...room, deck: null, used: room.used.filter((id) => id[0] !== 'd' || deckIds.has(id)) };
      const sig = room.deck ? hash(room.deck.questions.map((q) => q.id).join(',')) : null;
      const body = await pack(lite);
      const at = Date.now();
      for (const [rank, pid] of deputies.entries()) {
        const link = this.net.byPid.get(pid);
        if (sig && link && link.deckSent !== sig) {
          link.deckSent = sig;
          this.net.send(pid, { t: 'backup-deck', sig, deck: await pack(room.deck) });
        }
        this.net.send(pid, { t: 'backup', rank, at, deckSig: sig, room: body });
      }
      for (const pid of this._deputies || []) if (!deputies.includes(pid)) this.net.send(pid, { t: 'backup', rank: -1 });
      this._deputies = deputies;
    }, 1200);
  }

  // ---------------------------------------------------------------- clues & stats

  _mergeSeen(pid, seen) {
    if (!seen || typeof seen !== 'object') return;
    const m = (this.room.seenBy[pid] ||= {});
    let n = 0;
    for (const [id, c] of Object.entries(seen)) {
      if (n++ > 3000) break;
      if (typeof id === 'string' && id.length < 24 && Number.isFinite(c)) m[id] = Math.max(m[id] || 0, Math.min(99, c | 0));
    }
  }

  _info(pid, msg) {
    if (msg.dev) this.room.signals[pid] = cleanSignals(msg.dev);
    if (msg.seen) this._mergeSeen(pid, msg.seen);
    if (Number.isFinite(msg.awayMs) && E.inGame(this.room)) {
      const ms = Math.min(msg.awayMs, 3600000);
      const st = (this.room.stats[pid] ||= {});
      addStat(this.room, pid, { away: 1, awayMs: ms });
      st.awayLongest = Math.max(st.awayLongest || 0, ms);
    }
    clearTimeout(this._infoSave);
    this._infoSave = setTimeout(() => this.save(), 1500);
  }

  /** Remember how someone plays (typing, deleting, voting speed) — for the AI's questions. */
  _playStats(pid, a) {
    const g = this.room.game;
    if (!g || !a) return;
    const m = a.meta && typeof a.meta === 'object' ? a.meta : {};
    const num = (v, max) => (Number.isFinite(v) && v >= 0 ? Math.min(v, max) : 0);
    if (a.type === 'answer' && g.phase === 'answer' && (!a.qkey || a.qkey === g.q.key)) {
      if (g.answers[pid]) {
        if (g.answers[pid].text !== a.text) addStat(this.room, pid, { edits: 1 });
      } else {
        addStat(this.room, pid, { answers: 1, answerMs: num(m.ms, 600000), typeMs: num(m.typeMs, 600000), chars: num(m.chars, 500), dels: num(m.dels, 2000) });
      }
    } else if (a.type === 'vote' && g.phase === 'vote' && !g.votes[pid]) {
      addStat(this.room, pid, { votes: 1, voteMs: num(m.ms, 600000) });
    }
  }

  // ---------------------------------------------------------------- waiting-room chat
  // Messages only go to people who are on a waiting screen *right now* (same scope).

  chatPresence(scope) {
    this._chat(this.room.hostPid, { t: 'chat-here', scope });
  }

  sendChat(text) {
    this._chat(this.room.hostPid, { t: 'chat', text });
  }

  sendReaction(mid, emoji) {
    this._chat(this.room.hostPid, { t: 'chat-react', mid, emoji });
  }

  onChatEvent(fn) {
    (this.chatListeners ||= new Set()).add(fn);
    return () => this.chatListeners.delete(fn);
  }

  _chat(pid, msg) {
    this.chatHere ||= new Map();
    if (msg.t === 'chat-here') {
      if (msg.scope) this.chatHere.set(pid, String(msg.scope).slice(0, 40));
      else this.chatHere.delete(pid);
      return;
    }
    const scope = this.chatHere.get(pid);
    if (!scope || !E.isActive(this.room, pid)) return;
    let out;
    if (msg.t === 'chat') {
      const text = String(msg.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (!text) return;
      // gentle flood protection
      const now = Date.now();
      const hist = ((this._chatRate ||= {})[pid] ||= []).filter((t) => now - t < 4000);
      if (hist.length >= 6) return;
      hist.push(now);
      this._chatRate[pid] = hist;
      out = { t: 'chat', scope, msg: { mid: uid(8), from: pid, text, at: now } };
      addStat(this.room, pid, { chats: 1 });
    } else if (msg.t === 'chat-react') {
      if (typeof msg.mid !== 'string' || typeof msg.emoji !== 'string' || msg.emoji.length > 16) return;
      out = { t: 'chat-react', scope, mid: msg.mid, emoji: msg.emoji, from: pid };
      const st = (this.room.stats[pid] ||= {});
      st.emoji = st.emoji || {};
      if (Object.keys(st.emoji).length < 30 || st.emoji[msg.emoji]) st.emoji[msg.emoji] = (st.emoji[msg.emoji] || 0) + 1;
    } else return;
    for (const [to, s] of this.chatHere) {
      if (s !== scope) continue;
      if (to === this.room.hostPid) this.chatListeners && this.chatListeners.forEach((fn) => fn(out));
      else this.net.send(to, out);
    }
  }

  /** Typing in progress (never shown to anyone; used if time runs out). */
  sendDraft(text, qkey) {
    this._draft(this.room.hostPid, { text, qkey });
  }

  /** The answer I picked but haven't locked in yet (counts if time runs out). */
  sendVoteDraft(oid, qkey) {
    this._draft(this.room.hostPid, { vote: true, oid, qkey });
  }

  /** This device's own info (away from the page…) */
  sendInfo(msg) {
    this._info(this.room.hostPid, msg);
  }

  _draft(pid, msg) {
    const ok = msg.vote ? E.setVoteDraft(this.room, pid, msg.oid || null, msg.qkey) : E.setDraft(this.room, pid, msg.text, msg.qkey);
    if (!ok) return;
    clearTimeout(this._draftSave);
    this._draftSave = setTimeout(() => this.save(), 800);
  }

  save() {
    local.set(KEYS.host, { room: this.room, token: this.token, savedAt: Date.now() });
    const played = local.get(KEYS.played, []);
    if (this.room.used.some((id) => !played.includes(id))) {
      local.set(KEYS.played, [...new Set([...played, ...this.room.used])].slice(-5000));
    }
  }

  /** Persist and push fresh state to everyone (coalesced per tick). */
  commit() {
    this.room.seq++;
    this.save();
    this._backup();
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
    this._playStats(this.room.hostPid, action);
    const res = E.apply(this.room, this.room.hostPid, action, this.ctx());
    if (res.ok) {
      if (action.type === 'kick') this.net.release(action.pid, { t: 'bye', reason: 'kicked' });
      // Let the person in right away (they're waiting on the knocking screen).
      if (action.type === 'admit' || action.type === 'deny') {
        const held = this.holding && this.holding.get(action.joinId);
        if (held) this._hello(held.link, held.msg);
      }
      this.commit();
      if (action.type === 'resetUsed') local.set(KEYS.played, []); // forget across rooms too
    } else {
      this.toast = { error: res.error, at: Date.now() };
      this.emit();
    }
    return res;
  }

  /** Stop hosting on this tab (data stays saved so it can be resumed). */
  stop() {
    if (!this.demoted) this.save();
    this.detach();
  }

  get transport() {
    return 'host';
  }

  /** Stop without saving — another tab has taken over and owns the saved state now. */
  detach() {
    clearInterval(this._tick);
    clearTimeout(this._backupTimer);
    this._offSignals && this._offSignals();
    this.net.stop();
    removeEventListener('pagehide', this._unload);
  }

  closeRoom() {
    clearInterval(this._tick);
    for (const pid of this.net.onlinePids()) this.net.send(pid, { t: 'bye', reason: 'closed' });
    setTimeout(() => this.net.stop(), 300);
    removeEventListener('pagehide', this._unload);
    local.del(KEYS.host);
    session.del(KEYS.role);
  }

  // -------------------------------------------------------------------------

  _reject(link, reason) {
    link.send({ t: 'reject', reason });
  }

  _welcome(link, player) {
    this.net.bind(link, player.id);
    link.send({ t: 'welcome', pid: player.id, secret: player.secret, roomId: this.room.roomId, code: this.room.code, epoch: this.room.epoch || 0 });
    link.send({ t: 'state', view: E.viewFor(this.room, player.id, this.ctx()) });
  }

  _hello(link, msg) {
    if (msg.proto !== E.PROTOCOL) return this._reject(link, 'proto');
    const room = this.room;
    if (msg.pid) {
      const p = E.getPlayer(room, msg.pid);
      if (!p || p.secret !== msg.secret || msg.roomId !== room.roomId) return this._reject(link, 'unknown');
      if (p.gone) return this._reject(link, p.gone);
      if (p.isHost) return this._reject(link, 'unknown');
      this._welcome(link, p);
      this.commit();
      return;
    }
    // New player. A retried join (lost welcome) is recognised by its joinId.
    const again = msg.joinId && room.players.find((p) => p.joinId === msg.joinId && !p.gone);
    if (again) {
      this._welcome(link, again);
      return;
    }
    const profile = msg.profile || {};
    const ctx = this.ctx();
    // Same name as a player who's disconnected = probably them on a new device (or after
    // clearing the browser). Mid-game, newcomers need the host's OK. Either way: ask the host.
    const claim = E.seatByName(room, profile, ctx.online);
    let req = msg.joinId && (room.requests || []).find((r) => r.joinId === msg.joinId);
    if (!req && msg.joinId && (claim || E.inGame(room))) {
      if (!claim) {
        const v = E.validateProfile(room, profile);
        if (!v.ok) return this._reject(link, v.error);
        if (E.activePlayers(room).length >= E.MAX_PLAYERS) return this._reject(link, 'room-full');
      }
      req = E.requestJoin(room, { joinId: msg.joinId, name: profile.name, avatar: profile.avatar, claim: claim ? claim.id : null }, ctx);
      this.toast = { info: true, text: claim ? `${req.name} wants back in` : `${req.name} is knocking`, at: Date.now() };
      this.commit();
    }
    if (req) {
      (this.holding ||= new Map()).set(req.joinId, { link, msg });
      if (req.status === 'waiting') return link.send({ t: 'hold', claim: !!req.claim });
      this.holding.delete(req.joinId);
      room.requests = room.requests.filter((r) => r !== req);
      if (req.status === 'denied') {
        this.commit();
        return this._reject(link, 'denied');
      }
      const back = req.claim && E.getPlayer(room, req.claim);
      if (back && !back.gone) {
        back.joinId = msg.joinId;
        E.greet(room, back.id, 'back', ctx);
        this._welcome(link, back);
        this.commit();
        return;
      }
    }
    const res = E.addPlayer(room, profile);
    if (!res.ok) {
      this.commit();
      return this._reject(link, res.error);
    }
    res.player.joinId = msg.joinId || null;
    E.autoAssign(room);
    if (E.inGame(room)) {
      addStat(room, res.player.id, { lateJoin: 1 });
      E.greet(room, res.player.id, 'new', ctx);
    }
    this._welcome(link, res.player);
    this.commit();
  }

  _action(pid, msg) {
    if (!msg.id || !msg.a) return;
    if (E.seenAction(this.room, pid, msg.id)) {
      this.net.send(pid, { t: 'ack', id: msg.id, ok: true, dup: true });
      return;
    }
    this._playStats(pid, msg.a);
    const res = E.apply(this.room, pid, msg.a, this.ctx());
    this.net.send(pid, { t: 'ack', id: msg.id, ok: res.ok, error: res.error });
    if (msg.a.type === 'leave' && res.ok) this.net.release(pid, { t: 'bye', reason: 'left' });
    this.commit();
  }
}
