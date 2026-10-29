// "The AI noticed something": questions built from clues the game quietly collects
// — each device's rough location (time zone / network), languages, phone or
// computer, battery, Wi-Fi, the local time — and from how people play (typing
// speed, deleting, leaving the app, who votes for whom…).
//
// Every template has a condition. It only becomes a question when the clues
// make it true AND interesting (e.g. everyone is in the US except one person).
// Templates are grouped in categories with a per-game cap, so one game never
// turns into ten location questions.
//
// Placeholders: {p1} {p2} are players (they become "about" the question, so their
// vote counts double); [var] are plain words filled in from the clues.

import { random } from './util.js';

/** At most this many questions per category in one game. */
export const CATEGORY_MAX = { place: 2, device: 2, lang: 1, net: 1, time: 1, habit: 3, group: 2 };

const MIN_KNOWN = 3; // "odd one out" needs at least this many players with the clue

// ---------------------------------------------------------------------------
// helpers

function groupBy(ids, fn) {
  const m = new Map();
  for (const pid of ids) {
    const v = fn(pid);
    if (v == null || v === '') continue;
    if (!m.has(v)) m.set(v, []);
    m.get(v).push(pid);
  }
  return m;
}

/** Exactly one player differs from everybody else (who all agree). */
function oddOneOut(ids, fn) {
  const g = groupBy(ids, fn);
  const known = [...g.values()].reduce((n, l) => n + l.length, 0);
  if (known < MIN_KNOWN || g.size !== 2) return null;
  const [a, b] = [...g.entries()].sort((x, y) => x[1].length - y[1].length);
  if (a[1].length !== 1) return null;
  return { pid: a[1][0], value: a[0], others: b[0], othersIds: b[1] };
}

/** Exactly two players share something nobody else has (and the rest are known). */
function onlyPair(ids, fn) {
  const g = groupBy(ids, fn);
  const known = [...g.values()].reduce((n, l) => n + l.length, 0);
  if (known < 4) return null;
  const pairs = [...g.entries()].filter(([, l]) => l.length === 2);
  if (pairs.length !== 1 || [...g.values()].some((l) => l.length > 2 && l !== pairs[0][1])) return null;
  return { pids: pairs[0][1], value: pairs[0][0] };
}

function top(ids, fn, { min = -Infinity, unique = true, low = false } = {}) {
  const rows = ids.map((pid) => [pid, fn(pid)]).filter(([, v]) => v != null && Number.isFinite(v) && (low ? v <= min : v >= min));
  if (rows.length < 1) return null;
  rows.sort((a, b) => (low ? a[1] - b[1] : b[1] - a[1]));
  if (unique && rows[1] && rows[1][1] === rows[0][1]) return null;
  return { pid: rows[0][0], value: rows[0][1], runnerUp: rows[1] ? rows[1][1] : null };
}

const RAD = Math.PI / 180;
function km(a, b) {
  if (!a || !b) return null;
  const dLat = (b[0] - a[0]) * RAD;
  const dLon = (b[1] - a[1]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function localParts(tz, now) {
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', weekday: 'long', hour12: true, month: 'numeric' });
    const parts = Object.fromEntries(f.formatToParts(new Date(now)).map((p) => [p.type, p.value]));
    const h24 = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date(now)));
    return { hour: h24, time: `${parts.hour}:${parts.minute} ${parts.dayPeriod || ''}`.trim(), weekday: parts.weekday, month: Number(parts.month) };
  } catch {
    return null;
  }
}

function season(lat, month) {
  if (lat == null || !month) return null;
  const north = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'fall', 'fall', 'fall', 'winter'][month - 1];
  if (Math.abs(lat) < 15) return null; // tropics: no real seasons
  if (lat >= 0) return north;
  return { winter: 'summer', summer: 'winter', spring: 'fall', fall: 'spring' }[north];
}

const LANG_NAMES = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' });
  } catch {
    return null;
  }
})();
function langName(code) {
  const base = String(code || '').split('-')[0];
  if (!base) return null;
  try {
    return (LANG_NAMES && LANG_NAMES.of(base)) || base;
  } catch {
    return base;
  }
}

const n = (x) => Math.round(x);

// ---------------------------------------------------------------------------
// The data the templates look at

function makeData(room, g, activeIds, ctx) {
  const sig = (pid) => (room.signals && room.signals[pid]) || {};
  const st = (pid) => (room.stats && room.stats[pid]) || {};
  const H = (g && g.history) || [];
  const now = ctx.now;
  const local = {};
  for (const pid of activeIds) if (sig(pid).tz) local[pid] = localParts(sig(pid).tz, now);
  return { room, g, ids: activeIds, sig, st, H, now, local, ctx, hostPid: room.hostPid };
}

// ---------------------------------------------------------------------------
// Templates. when(d) returns { bind: {p1, p2}, vars: {...} } or null.
// Several phrasings per template keep it fresh.

const T = [
  // ------------------------------------------------------------------ place
  {
    id: 'place-odd-country', cat: 'place', level: 4,
    text: [
      'Everyone here is in [others]… except {p1}, who is somewhere in [place]. What is {p1} really doing there?',
      'The AI traced every phone to [others] — except {p1}\'s, which is in [place]. What is {p1} not telling everyone about this trip?',
    ],
    when(d) {
      const o = oddOneOut(d.ids, (p) => d.sig(p).country);
      if (!o) return null;
      return { bind: { p1: o.pid }, vars: { place: d.sig(o.pid).countryName || o.value, others: d.sig(o.othersIds[0]).countryName || o.others } };
    },
  },
  {
    id: 'place-odd-region', cat: 'place', level: 3,
    text: ['Everybody else is around [others]. {p1} is the only one near [place]. Who or what is {p1} with right now?'],
    when(d) {
      const o = oddOneOut(d.ids, (p) => d.sig(p).area);
      if (!o || d.sig(o.pid).country !== d.sig(o.othersIds[0]).country) return null; // same country, different area
      return { bind: { p1: o.pid }, vars: { place: o.value, others: o.others } };
    },
  },
  {
    id: 'place-far-pair', cat: 'place', level: 3,
    text: [
      '{p1} and {p2} are about [km] km apart right now. What would {p1} send {p2} if it could be delivered tonight?',
      '[km] km separate {p1} and {p2} right now. What is the first thing they will do when they are in the same room again?',
    ],
    when(d) {
      let best = null;
      for (let i = 0; i < d.ids.length; i++)
        for (let j = i + 1; j < d.ids.length; j++) {
          const k = km(d.sig(d.ids[i]).ll, d.sig(d.ids[j]).ll);
          if (k != null && (!best || k > best.k)) best = { k, a: d.ids[i], b: d.ids[j] };
        }
      if (!best || best.k < 800) return null;
      const rounded = best.k > 3000 ? Math.round(best.k / 500) * 500 : Math.round(best.k / 100) * 100;
      return { bind: { p1: best.a, p2: best.b }, vars: { km: rounded.toLocaleString('en-US') } };
    },
  },
  {
    id: 'place-same-city-pair', cat: 'place', level: 4,
    text: ['{p1} and {p2} are the only two in [place]. What are they planning without the rest of you?'],
    when(d) {
      const p = onlyPair(d.ids, (x) => d.sig(x).city || null);
      return p ? { bind: { p1: p.pids[0], p2: p.pids[1] }, vars: { place: p.value } } : null;
    },
  },
  {
    id: 'place-season', cat: 'place', level: 2,
    text: ["It's [s1] for {p1} and [s2] for everyone else. What did {p1} pack that would get them laughed at here?"],
    when(d) {
      const o = oddOneOut(d.ids, (p) => season(d.sig(p).ll && d.sig(p).ll[0], d.local[p] && d.local[p].month));
      return o ? { bind: { p1: o.pid }, vars: { s1: o.value, s2: o.others } } : null;
    },
  },
  {
    id: 'place-city', cat: 'place', level: 5,
    text: ["The AI knows {p1} is near [city]. What's the place there {p1} goes to that nobody in this game knows about?"],
    when(d) {
      const ids = d.ids.filter((p) => d.sig(p).city && d.sig(p).precise);
      if (ids.length < 2) return null;
      const pid = ids[Math.floor(random() * ids.length)];
      return { bind: { p1: pid }, vars: { city: d.sig(pid).city } };
    },
  },

  // ------------------------------------------------------------------ device
  {
    id: 'dev-only-iphone', cat: 'device', level: 2,
    text: [
      '{p1} is the only one here on an iPhone. What would it take for {p1} to give it up and join the Android side?',
      'Everyone else is on Android. What does {p1} tell themselves to justify the iPhone?',
    ],
    when(d) {
      const o = oddOneOut(d.ids.filter((p) => d.sig(p).device === 'phone'), (p) => d.sig(p).os);
      return o && o.value === 'iOS' && o.others === 'Android' ? { bind: { p1: o.pid } } : null;
    },
  },
  {
    id: 'dev-only-android', cat: 'device', level: 2,
    text: [
      'Everyone else has an iPhone. What does {p1}\'s [brand] phone do that {p1} will not stop bragging about?',
      '{p1} is the only one not on an iPhone. What happens to {p1} in the group chat because of the green bubbles?',
    ],
    when(d) {
      const o = oddOneOut(d.ids.filter((p) => d.sig(p).device === 'phone'), (p) => d.sig(p).os);
      return o && o.value === 'Android' && o.others === 'iOS' ? { bind: { p1: o.pid }, vars: { brand: d.sig(o.pid).brand && d.sig(o.pid).brand !== 'Android' ? d.sig(o.pid).brand : 'Android' } } : null;
    },
  },
  {
    id: 'dev-only-computer', cat: 'device', level: 4,
    text: [
      '{p1} is the only one playing on a computer. What else is open in the other tabs right now?',
      '{p1} is playing on a [os] computer while everyone else uses a phone. What is {p1} supposed to be working on instead?',
    ],
    when(d) {
      const o = oddOneOut(d.ids, (p) => (d.sig(p).device === 'computer' ? 'computer' : d.sig(p).device ? 'handheld' : null));
      return o && o.value === 'computer' ? { bind: { p1: o.pid }, vars: { os: d.sig(o.pid).os || 'a' } } : null;
    },
  },
  {
    id: 'dev-tablet', cat: 'device', level: 3,
    text: ['{p1} is playing on a tablet. Who else in the house uses that tablet, and what would they find on it?'],
    when(d) {
      const t = d.ids.filter((p) => d.sig(p).device === 'tablet');
      return t.length === 1 ? { bind: { p1: t[0] } } : null;
    },
  },
  {
    id: 'dev-low-battery', cat: 'device', level: 3,
    text: [
      "{p1}'s battery is at [pct]% and dropping. What will {p1} do the second their phone dies?",
      "{p1}'s phone is at [pct]%. What is more important to {p1} right now: a charger or winning?",
    ],
    when(d) {
      const t = top(d.ids, (p) => (d.sig(p).battery && !d.sig(p).battery.charging && d.now - d.sig(p).battery.at < 10 * 60000 ? d.sig(p).battery.level : null), { min: 22, low: true });
      return t ? { bind: { p1: t.pid }, vars: { pct: n(t.value) } } : null;
    },
  },
  {
    id: 'dev-charging', cat: 'device', level: 3,
    text: ['{p1} is plugged into a charger right now. Where exactly is that outlet, and why does {p1} sit there every night?'],
    when(d) {
      const c = d.ids.filter((p) => d.sig(p).battery && d.sig(p).battery.charging);
      return c.length === 1 && d.ids.filter((p) => d.sig(p).battery).length >= 3 ? { bind: { p1: c[0] } } : null;
    },
  },
  {
    id: 'dev-dark-mode', cat: 'device', level: 3,
    text: ['{p1} is the only one with their phone in dark mode. What does {p1} look at in the dark?'],
    when(d) {
      const o = oddOneOut(d.ids, (p) => (d.sig(p).dark == null ? null : d.sig(p).dark ? 'dark' : 'light'));
      return o && o.value === 'dark' ? { bind: { p1: o.pid } } : null;
    },
  },
  {
    id: 'dev-installed', cat: 'device', level: 3,
    text: ['{p1} put this game on their home screen. What app right next to it would {p1} never let anyone open?'],
    when(d) {
      const c = d.ids.filter((p) => d.sig(p).installed);
      return c.length === 1 ? { bind: { p1: c[0] } } : null;
    },
  },
  {
    id: 'dev-browser', cat: 'device', level: 4,
    text: ['{p1} is the only one using [browser]. What is {p1} trying to keep private?'],
    when(d) {
      const o = oddOneOut(d.ids, (p) => d.sig(p).browser);
      return o && ['Firefox', 'Brave', 'Opera', 'DuckDuckGo'].includes(o.value) ? { bind: { p1: o.pid }, vars: { browser: o.value } } : null;
    },
  },
  {
    id: 'dev-same-phone', cat: 'device', level: 2,
    text: ['{p1} and {p2} have the exact same kind of [model]. Who copied whom, and what else did they copy?'],
    when(d) {
      const p = onlyPair(d.ids, (x) => (d.sig(x).model ? d.sig(x).brand + ' ' + d.sig(x).model : null));
      return p ? { bind: { p1: p.pids[0], p2: p.pids[1] }, vars: { model: p.value } } : null;
    },
  },

  // ------------------------------------------------------------------ languages
  {
    id: 'lang-odd', cat: 'lang', level: 4,
    text: [
      "{p1}'s phone is set to [lang]; everyone else's is in [others]. What does {p1} say about all of you in [lang]?",
      "{p1} reads their phone in [lang]. What is the [lang] word {p1} mutters when they're losing?",
    ],
    when(d) {
      const o = oddOneOut(d.ids, (p) => langName(d.sig(p).lang));
      return o ? { bind: { p1: o.pid }, vars: { lang: o.value, others: o.others } } : null;
    },
  },
  {
    id: 'lang-many', cat: 'lang', level: 3,
    text: ["{p1}'s phone speaks [langs]. Which language does {p1} switch to when they really want to complain?"],
    when(d) {
      const t = top(d.ids, (p) => new Set((d.sig(p).langs || []).map((l) => langName(l))).size, { min: 2 });
      if (!t) return null;
      const list = [...new Set(d.sig(t.pid).langs.map(langName))].slice(0, 3);
      return { bind: { p1: t.pid }, vars: { langs: list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1] } };
    },
  },
  {
    id: 'lang-abroad', cat: 'lang', level: 3,
    text: ['{p1} is in [country] but their phone speaks [lang]. Which local word does {p1} still get wrong?'],
    when(d) {
      const c = d.ids.filter((p) => {
        const s = d.sig(p);
        return s.lang && s.country && s.langRegion && s.langRegion !== s.country && s.countryName;
      });
      return c.length === 1 ? { bind: { p1: c[0] }, vars: { country: d.sig(c[0]).countryName, lang: langName(d.sig(c[0]).lang) } } : null;
    },
  },

  // ------------------------------------------------------------------ network
  {
    id: 'net-same-wifi-pair', cat: 'net', level: 4,
    text: ["{p1} and {p2} are on the same Wi-Fi right now. What's going on in that room that the rest of you can't see?"],
    when(d) {
      const p = onlyPair(d.ids, (x) => d.sig(x).netId || null);
      return p ? { bind: { p1: p.pids[0], p2: p.pids[1] } } : null;
    },
  },
  {
    id: 'net-odd-wifi', cat: 'net', level: 3,
    text: ["Everyone's on the same internet connection except {p1}. Why isn't {p1} allowed on the Wi-Fi?"],
    when(d) {
      const o = oddOneOut(d.ids, (p) => d.sig(p).netId || null);
      return o && o.othersIds.length >= 2 ? { bind: { p1: o.pid } } : null;
    },
  },
  {
    id: 'net-mobile-data', cat: 'net', level: 3,
    text: ['{p1} is playing on mobile data, not Wi-Fi. Where is {p1} right now that has no Wi-Fi?'],
    when(d) {
      const c = d.ids.filter((p) => d.sig(p).conn === 'cellular');
      return c.length === 1 ? { bind: { p1: c[0] } } : null;
    },
  },
  {
    id: 'net-detour', cat: 'net', level: 4,
    text: ["{p1}'s connection is taking a strange detour. What is {p1} hiding behind it?"],
    when(d) {
      const c = d.ids.filter((p) => d.ctx.transport && d.ctx.transport[p] === 'relay');
      return c.length === 1 && d.ids.length >= 3 ? { bind: { p1: c[0] } } : null;
    },
  },

  // ------------------------------------------------------------------ time
  {
    id: 'time-late', cat: 'time', level: 4,
    text: [
      "It's [time] where {p1} is. Why is {p1} still awake?",
      "It's [time] for {p1}. Who is {p1} going to blame tomorrow morning?",
    ],
    when(d) {
      const c = d.ids.filter((p) => d.local[p] && (d.local[p].hour >= 23 || d.local[p].hour < 4));
      if (!c.length || c.length === d.ids.length) return null;
      const pid = c[Math.floor(random() * c.length)];
      return { bind: { p1: pid }, vars: { time: d.local[pid].time } };
    },
  },
  {
    id: 'time-early', cat: 'time', level: 3,
    text: ["It's only [time] for {p1}. Who did {p1} ignore this morning to play this?"],
    when(d) {
      const c = d.ids.filter((p) => d.local[p] && d.local[p].hour >= 5 && d.local[p].hour < 9);
      return c.length === 1 ? { bind: { p1: c[0] }, vars: { time: d.local[c[0]].time } } : null;
    },
  },
  {
    id: 'time-work', cat: 'time', level: 4,
    text: ["It's [day], [time] where {p1} is. Who thinks {p1} is working right now?"],
    when(d) {
      const c = d.ids.filter((p) => {
        const l = d.local[p];
        return l && !['Saturday', 'Sunday'].includes(l.weekday) && l.hour >= 9 && l.hour < 17;
      });
      if (!c.length) return null;
      const pid = c[Math.floor(random() * c.length)];
      return { bind: { p1: pid }, vars: { day: d.local[pid].weekday, time: d.local[pid].time } };
    },
  },
  {
    id: 'time-diff', cat: 'time', level: 3,
    text: ["It's [t1] for {p1} but [t2] for {p2}. What is {p1} doing that {p2} would never be doing at that hour?"],
    when(d) {
      const ids = d.ids.filter((p) => d.local[p]);
      let best = null;
      for (const a of ids)
        for (const b of ids) {
          const diff = (((d.local[a].hour - d.local[b].hour) % 24) + 24) % 24;
          if (diff >= 4 && diff <= 20 && (!best || diff > best.diff)) best = { a, b, diff };
        }
      return best ? { bind: { p1: best.a, p2: best.b }, vars: { t1: d.local[best.a].time, t2: d.local[best.b].time } } : null;
    },
  },
  {
    id: 'time-dinner', cat: 'time', level: 2,
    text: ["It's dinner time where {p1} is. What is {p1} secretly eating right now?"],
    when(d) {
      const c = d.ids.filter((p) => d.local[p] && d.local[p].hour >= 19 && d.local[p].hour < 21);
      return c.length === 1 ? { bind: { p1: c[0] } } : null;
    },
  },

  // ------------------------------------------------------------------ how they play
  {
    id: 'habit-leaves-app', cat: 'habit', level: 4,
    text: [
      '{p1} has left the game [n] times already. What is so important in the other app?',
      '{p1} keeps sneaking out of the game ([n] times so far). Who is {p1} texting?',
    ],
    when(d) {
      const t = top(d.ids, (p) => d.st(p).away || 0, { min: 2 });
      return t ? { bind: { p1: t.pid }, vars: { n: t.value } } : null;
    },
  },
  {
    id: 'habit-long-away', cat: 'habit', level: 4,
    text: ['{p1} vanished from the game for [secs] seconds. Where did {p1} go?'],
    when(d) {
      const t = top(d.ids, (p) => (d.st(p).awayLongest || 0) / 1000, { min: 40 });
      return t ? { bind: { p1: t.pid }, vars: { secs: n(t.value) } } : null;
    },
  },
  {
    id: 'habit-deleter', cat: 'habit', level: 5,
    text: [
      '{p1} has typed and deleted [n] letters in their answers so far. What did {p1} write and then erase?',
      'The AI saw {p1} delete a whole answer and start over. What did the first version say?',
    ],
    when(d) {
      const t = top(d.ids, (p) => d.st(p).dels || 0, { min: 25 });
      return t && (!t.runnerUp || t.value > t.runnerUp * 1.4) ? { bind: { p1: t.pid }, vars: { n: t.value } } : null;
    },
  },
  {
    id: 'habit-fast-typer', cat: 'habit', level: 3,
    text: ['{p1} types about [cps] letters a second — the fastest here. Who is {p1} usually texting that fast?'],
    when(d) {
      const t = top(d.ids, (p) => (d.st(p).typeMs > 4000 ? (d.st(p).chars / d.st(p).typeMs) * 1000 : null), { min: 3 });
      return t ? { bind: { p1: t.pid }, vars: { cps: Math.round(t.value * 10) / 10 } } : null;
    },
  },
  {
    id: 'habit-slow-writer', cat: 'habit', level: 3,
    text: ['{p1} takes about [secs] seconds to write an answer — longer than anyone. What is {p1} actually doing all that time?'],
    when(d) {
      const t = top(d.ids, (p) => (d.st(p).answers >= 2 ? d.st(p).answerMs / d.st(p).answers / 1000 : null), { min: 25 });
      return t ? { bind: { p1: t.pid }, vars: { secs: n(t.value) } } : null;
    },
  },
  {
    id: 'habit-editor', cat: 'habit', level: 3,
    text: ['{p1} has changed an answer after submitting it [n] times. What else does {p1} second-guess?'],
    when(d) {
      const t = top(d.ids, (p) => d.st(p).edits || 0, { min: 2 });
      return t ? { bind: { p1: t.pid }, vars: { n: t.value } } : null;
    },
  },
  {
    id: 'habit-quick-voter', cat: 'habit', level: 3,
    text: ['{p1} votes in about [secs] seconds flat. What else does {p1} decide without thinking?'],
    when(d) {
      const t = top(d.ids, (p) => (d.st(p).votes >= 2 ? d.st(p).voteMs / d.st(p).votes / 1000 : null), { min: 4, low: true });
      return t ? { bind: { p1: t.pid }, vars: { secs: Math.max(1, n(t.value)) } } : null;
    },
  },
  {
    id: 'habit-slow-voter', cat: 'habit', level: 2,
    text: ['{p1} takes the longest to vote, every time. What was the hardest decision {p1} ever had to make?'],
    when(d) {
      const t = top(d.ids, (p) => (d.st(p).votes >= 2 ? d.st(p).voteMs / d.st(p).votes / 1000 : null), { min: 12 });
      return t ? { bind: { p1: t.pid } } : null;
    },
  },
  {
    id: 'habit-first', cat: 'habit', level: 2,
    text: ['{p1} keeps answering first. What is {p1} trying to prove?'],
    when(d) {
      const t = top(d.ids, (p) => d.H.filter((h) => h.first === p).length, { min: 2 });
      return t ? { bind: { p1: t.pid } } : null;
    },
  },
  {
    id: 'habit-last', cat: 'habit', level: 4,
    text: ['{p1} is the last to answer, every single time. Who is really writing {p1}\'s answers?'],
    when(d) {
      const t = top(d.ids, (p) => d.H.filter((h) => h.last === p).length, { min: 2 });
      return t ? { bind: { p1: t.pid } } : null;
    },
  },
  {
    id: 'habit-loyal-vote', cat: 'habit', level: 4,
    text: [
      "{p1} has voted for {p2}'s answer [n] times. What does {p1} want from {p2}?",
      "{p1} keeps voting for {p2} ([n] times so far). What deal did they make before the game?",
    ],
    when(d) {
      const c = {};
      for (const h of d.H) for (const [v, a] of h.votes) if (d.ids.includes(v) && d.ids.includes(a)) c[v + '|' + a] = (c[v + '|' + a] || 0) + 1;
      const best = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
      if (!best || best[1] < 3) return null;
      const [p1, p2] = best[0].split('|');
      return { bind: { p1, p2 }, vars: { n: best[1] } };
    },
  },
  {
    id: 'habit-long-answers', cat: 'habit', level: 4,
    text: ['{p1} writes the longest answers in the room. What did {p1} write in their notes app last night?'],
    when(d) {
      const t = top(d.ids, (p) => {
        const e = d.H.flatMap((h) => h.entries.filter((x) => x.pid === p && !x.auto));
        return e.length >= 2 ? e.reduce((s, x) => s + x.len, 0) / e.length : null;
      }, { min: 45 });
      return t ? { bind: { p1: t.pid } } : null;
    },
  },
  {
    id: 'habit-short-answers', cat: 'habit', level: 3,
    text: ['{p1} answers in about [len] letters. What is {p1} hiding behind such short answers?'],
    when(d) {
      const t = top(d.ids, (p) => {
        const e = d.H.flatMap((h) => h.entries.filter((x) => x.pid === p && !x.auto));
        return e.length >= 2 ? e.reduce((s, x) => s + x.len, 0) / e.length : null;
      }, { min: 14, low: true });
      return t ? { bind: { p1: t.pid }, vars: { len: n(t.value) } } : null;
    },
  },
  {
    id: 'habit-chatty', cat: 'habit', level: 3,
    text: ['{p1} has sent [n] chat messages while waiting. Who is {p1} really trying to impress?'],
    when(d) {
      const t = top(d.ids, (p) => d.st(p).chats || 0, { min: 5 });
      return t ? { bind: { p1: t.pid }, vars: { n: t.value } } : null;
    },
  },
  {
    id: 'habit-emoji', cat: 'habit', level: 2,
    text: ['{p1} keeps reacting with [emoji]. What does [emoji] really mean when {p1} sends it?'],
    when(d) {
      const t = top(d.ids, (p) => {
        const e = Object.entries(d.st(p).emoji || {}).sort((a, b) => b[1] - a[1])[0];
        return e && e[1] >= 3 ? e[1] : null;
      }, { min: 3 });
      if (!t) return null;
      const emoji = Object.entries(d.st(t.pid).emoji).sort((a, b) => b[1] - a[1])[0][0];
      return { bind: { p1: t.pid }, vars: { emoji } };
    },
  },
  {
    id: 'habit-dropouts', cat: 'habit', level: 3,
    text: ["{p1}'s connection has dropped [n] times. Where is {p1} hiding that the signal can't reach?"],
    when(d) {
      const t = top(d.ids, (p) => d.st(p).drops || 0, { min: 3 });
      return t ? { bind: { p1: t.pid }, vars: { n: t.value } } : null;
    },
  },

  // ------------------------------------------------------------------ the group
  {
    id: 'group-late-joiner', cat: 'group', level: 2,
    text: ["{p1} showed up after the game started. What's the excuse, and what's the real reason?"],
    when(d) {
      const c = d.ids.filter((p) => d.st(p).lateJoin);
      return c.length ? { bind: { p1: c[c.length - 1] } } : null;
    },
  },
  {
    id: 'group-before-joined', cat: 'group', level: 3,
    text: ['What was everybody saying about {p1} before {p1} joined the game?'],
    when(d) {
      const c = d.ids.filter((p) => d.st(p).lateJoin);
      return c.length ? { bind: { p1: c[c.length - 1] } } : null;
    },
  },
  {
    id: 'group-most-asked', cat: 'group', level: 5,
    text: ['The AI has asked about {p1} [n] times tonight. What is the AI going to find out about {p1} next?'],
    when(d) {
      const t = top(d.ids, (p) => (d.g && d.g.featured && d.g.featured[p]) || 0, { min: 3 });
      return t ? { bind: { p1: t.pid }, vars: { n: t.value } } : null;
    },
  },
  {
    id: 'group-never-asked', cat: 'group', level: 4,
    text: ["The AI hasn't asked a single question about {p1} yet. What is {p1} hiding that keeps the AI away?"],
    when(d) {
      if (!d.g || d.g.idx < 4) return null;
      const c = d.ids.filter((p) => !(d.g.featured && d.g.featured[p]));
      return c.length === 1 ? { bind: { p1: c[0] } } : null;
    },
  },
  {
    id: 'group-host', cat: 'group', level: 3,
    text: ['If nobody was watching, which questions would our host {p1} quietly delete from this game, and why?'],
    when(d) {
      return d.ids.includes(d.hostPid) && d.ids.length >= 3 ? { bind: { p1: d.hostPid } } : null;
    },
  },
  {
    id: 'group-leader', cat: 'group', level: 2,
    text: ['{p1} is winning right now. What is {p1} going to do with all this power?'],
    when(d) {
      if (!d.g || d.g.idx < 3 || !d.g.scores) return null;
      const t = top(d.ids, (p) => d.g.scores[p] || 0, { min: 1 });
      return t ? { bind: { p1: t.pid } } : null;
    },
  },
  {
    id: 'group-no-votes', cat: 'group', level: 3,
    text: ['Nobody has voted for {p1} yet. Which answer of {p1}\'s secretly deserved it?'],
    when(d) {
      if (d.H.length < 4) return null;
      const got = new Set(d.H.flatMap((h) => h.votes.map(([, a]) => a)));
      const c = d.ids.filter((p) => !got.has(p) && d.H.some((h) => h.answerers.includes(p)));
      return c.length === 1 ? { bind: { p1: c[0] } } : null;
    },
  },
];

function fill(text, bind, vars = {}) {
  return text.replace(/\[(\w+)\]/g, (m, k) => (vars[k] != null ? String(vars[k]).replace(/[{}[\]]/g, '') : m));
}

/**
 * Every dynamic question that could be asked right now:
 * [{ id, cat, level, text, bind: {p1: pid}, weightPenalty }]
 */
export function dynamicCandidates(room, g, activeIds, ctx) {
  if (!g || activeIds.length < 2) return [];
  const d = makeData(room, g, activeIds, ctx || { now: Date.now() });
  const used = new Set(room.used || []);
  const cats = (g && g.dynCats) || {};
  const out = [];
  for (const t of T) {
    const id = 'x' + t.id;
    if (used.has(id) || (cats[t.cat] || 0) >= (CATEGORY_MAX[t.cat] || 1)) continue;
    let b;
    try {
      b = t.when(d);
    } catch {
      b = null;
    }
    if (!b || Object.values(b.bind).some((pid) => !activeIds.includes(pid))) continue;
    if (new Set(Object.values(b.bind)).size !== Object.keys(b.bind).length) continue;
    const phrase = t.text[Math.floor(random() * t.text.length)];
    out.push({ id, cat: t.cat, level: t.level, text: fill(phrase, b.bind, b.vars), bind: b.bind, weightPenalty: (cats[t.cat] || 0) * 0.5 });
  }
  return out;
}

export const DYNAMIC_TEMPLATES = T;
