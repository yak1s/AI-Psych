// Waiting-room chat: only while you're on a waiting screen. You only ever get
// the messages sent while you were here (the host doesn't forward anything else).
// What you did get stays with you for the rest of the room's games, with markers
// showing when you were in a waiting room and when you were away.

import { html, useState, useEffect, useRef } from '../vendor/preact-htm.js';
import { Avatar, cx, playerMap, colorOf } from './common.js';
import { local, KEYS } from '../storage.js';
import { sfx, buzz } from './audio.js';

const QUICK = ['😂', '❤️', '👍', '😮', '🤣', '🔥', '👀', '😱'];
const MORE = [
  '😀', '😅', '🥹', '😍', '🤩', '😎', '🤔', '🙄', '😬', '🫣', '😴', '🤯', '🥳', '😇', '🤭', '😈',
  '👏', '🙌', '🤝', '🙏', '💪', '👌', '✌️', '🤞', '💯', '✨', '🎉', '💀', '🙈', '🤡', '👻', '🤖',
  '🍕', '🍩', '☕', '🎯', '🏆', '💡', '❓', '‼️', '🇧🇷', '🇦🇷', '🇺🇸', '🇫🇷', '🇮🇱', '🕯️', '📸', '🎸',
];

function tint(color, a) {
  const hex = colorOf(color).replace('#', '');
  const n = parseInt(hex, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const MAX_ITEMS = 200;

export function WaitChat({ ctrl, view, scope, label = 'Waiting room' }) {
  const key = `${KEYS.chat}.${view.roomId}.${view.me}`;
  const [msgs, setMsgs] = useState(() => local.get(key, []));
  const [text, setText] = useState('');
  const [picker, setPicker] = useState(null); // mid with open reaction bar
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState(true);
  const listRef = useRef();
  const count = msgs.filter((m) => !m.sep).length;
  // Markers only where they separate actual messages: "you were away" + which waiting room this is.
  const shown = [];
  let pendingJoin = null;
  let away = false;
  for (const m of msgs) {
    if (m.sep === 'join') pendingJoin = m;
    else if (m.sep === 'leave') away = true;
    else {
      const any = shown.some((x) => !x.sep);
      if (pendingJoin && (any || shown.length === 0)) {
        if (away && any) shown.push({ sep: 'leave', mid: 'a' + pendingJoin.mid });
        if (any) shown.push(pendingJoin);
      }
      pendingJoin = null;
      away = false;
      shown.push(m);
    }
  }
  const who = playerMap(view);
  const me = view.me;

  const update = (fn) =>
    setMsgs((list) => {
      const next = fn(list).slice(-MAX_ITEMS);
      local.set(key, next);
      return next;
    });

  // Tell the host we're here (and when we leave), and listen for messages.
  useEffect(() => {
    if (!ctrl.chatPresence) return;
    ctrl.chatPresence(scope);
    // A marker: from here on you're receiving messages (again).
    update((list) => {
      const last = list[list.length - 1];
      return last && last.sep === 'join' && last.scope === scope ? list : [...list, { sep: 'join', scope, label, at: Date.now(), mid: 'j' + Date.now() }];
    });
    const off = ctrl.onChatEvent((ev) => {
      setMsgs((list) => {
        let next = list;
        if (ev.t === 'chat') {
          if (list.some((m) => m.mid === ev.msg.mid)) return list;
          next = [...list, { ...ev.msg, reactions: {} }].slice(-MAX_ITEMS);
          if (ev.msg.from !== me) {
            sfx('tap');
            buzz(8);
          }
        } else if (ev.t === 'chat-react') {
          next = list.map((m) => {
            if (m.mid !== ev.mid) return m;
            const r = { ...(m.reactions || {}) };
            const set = new Set(r[ev.emoji] || []);
            set.has(ev.from) ? set.delete(ev.from) : set.add(ev.from);
            if (set.size) r[ev.emoji] = [...set];
            else delete r[ev.emoji];
            return { ...m, reactions: r };
          });
          if (ev.from !== me) buzz(6);
        }
        local.set(key, next);
        return next;
      });
    });
    return () => {
      off();
      ctrl.chatPresence(null);
      const list = local.get(key, []);
      const last = list[list.length - 1];
      if (last && last.sep !== 'leave') local.set(key, [...list, { sep: 'leave', at: Date.now(), mid: 'l' + Date.now() }].slice(-MAX_ITEMS));
    };
  }, [scope]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [msgs.length]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    ctrl.sendChat(t);
    setText('');
    sfx('pop');
    buzz(12);
  };
  const react = (mid, emoji) => {
    ctrl.sendReaction(mid, emoji);
    setPicker(null);
    setMore(false);
    sfx('tap');
    buzz(10);
  };

  return html`<div class="card chat" data-testid="chat">
    <button class="chat-head" onClick=${() => { setOpen(!open); sfx('tap'); }}>
      <span>💬 Waiting-room chat</span><span class="muted small">${open ? 'hide' : `show${count ? ` (${count})` : ''}`}</span>
    </button>
    ${open &&
    html`
      <p class="chat-rule">Only people in a waiting room right now get your messages — and you only get the ones sent while you're here. Earlier rounds stay below.</p>
      <div class="chat-list" ref=${listRef}>
        ${!count && html`<p class="muted small center" style="margin:10px 0">Say something while you wait! 👋</p>`}
        ${shown.map((m) => {
          if (m.sep === 'join') return html`<div key=${m.mid} class="chat-sep" data-testid="chat-sep">— ${m.label} —</div>`;
          if (m.sep === 'leave') return html`<div key=${m.mid} class="chat-sep away">🚪 You were away — anything said meanwhile isn't shown</div>`;
          const p = who(m.from);
          const mine = m.from === me;
          const reactions = Object.entries(m.reactions || {});
          return html`<div key=${m.mid} class=${cx('chat-msg', mine ? 'mine' : 'theirs')}>
            ${!mine && html`<${Avatar} p=${p} size="xs" />`}
            <div class="chat-col">
              ${!mine && html`<span class="chat-name" style=${`color:${colorOf(p.color)}`}>${p.name}</span>`}
              <button class="chat-bubble" style=${`background:${tint(p.color, mine ? 0.42 : 0.3)};border-color:${colorOf(p.color)}`}
                onClick=${() => { setPicker(picker === m.mid ? null : m.mid); setMore(false); buzz(5); }} data-testid="chat-bubble">${m.text}</button>
              ${reactions.length > 0 &&
              html`<div class="chat-reacts">${reactions.map(([e, ids]) => html`<button key=${e} class=${cx('chat-react', ids.includes(me) && 'me')}
                  title=${ids.map((id) => who(id).name).join(', ')} onClick=${() => react(m.mid, e)}>${e} ${ids.length > 1 ? ids.length : ''}</button>`)}</div>`}
              ${picker === m.mid &&
              html`<div class="react-bar">
                ${QUICK.map((e) => html`<button key=${e} onClick=${() => react(m.mid, e)}>${e}</button>`)}
                <button class="more" onClick=${() => setMore(!more)}>${more ? '–' : '+'}</button>
                ${more && html`<div class="react-more">${MORE.map((e) => html`<button key=${e} onClick=${() => react(m.mid, e)}>${e}</button>`)}</div>`}
              </div>`}
            </div>
          </div>`;
        })}
      </div>
      <div class="chat-input">
        <input class="input" maxlength="200" placeholder="Type a message… 😄" value=${text} data-testid="chat-input"
          onInput=${(e) => setText(e.currentTarget.value)} onKeyDown=${(e) => e.key === 'Enter' && send()} />
        <button class="chat-send" onClick=${send} disabled=${!text.trim()} aria-label="Send" data-testid="chat-send">➤</button>
      </div>
    `}
  </div>`;
}
