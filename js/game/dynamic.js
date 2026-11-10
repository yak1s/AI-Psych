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
export const CATEGORY_MAX = { place: 2, device: 2, lang: 1, net: 1, time: 1, habit: 3, group: 2, perf: 2 };

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

/** Has a location from the internet connection (city level, usually right). */
function ipOk(d, p) {
  const s = d.sig(p);
  return !!(s.precise && s.city && s.ll);
}

/**
 * The town is believable: nobody else is close by (under 80 km) in a *different* town — that's a
 * big metro area where the internet lookup easily picks the wrong suburb (Babylon vs Brooklyn).
 * Mobile data is a bit vaguer still, so it needs a second device to agree.
 */
function townOk(d, p) {
  const s = d.sig(p);
  if (!ipOk(d, p)) return false;
  const near = d.ids.filter((q) => q !== p && ipOk(d, q) && km(d.sig(q).ll, s.ll) < 80);
  if (near.some((q) => d.sig(q).city !== s.city)) return false;
  return s.conn !== 'cellular' || near.some((q) => d.sig(q).city === s.city);
}

/** Everyone's connection type is known, and exactly one person is on mobile data. */
function onlyOnMobile(d, extra = () => true) {
  const c = d.ids.filter((p) => d.sig(p).conn === 'cellular');
  if (c.length !== 1 || !extra(c[0])) return null;
  const others = d.ids.filter((p) => p !== c[0]);
  if (others.length < 2 || !others.every((p) => ['wifi', 'ethernet'].includes(d.sig(p).conn))) return null;
  const net = d.sig(c[0]).netId;
  if (net && others.some((p) => d.sig(p).netId === net)) return null; // contradicting clues
  return c[0];
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
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', weekday: 'long', hour12: true, month: 'numeric', day: 'numeric' });
    const parts = Object.fromEntries(f.formatToParts(new Date(now)).map((p) => [p.type, p.value]));
    const h24 = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date(now)));
    return { hour: h24, time: `${parts.hour}:${parts.minute} ${parts.dayPeriod || ''}`.trim(), weekday: parts.weekday, month: Number(parts.month), day: Number(parts.day) };
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

/** Joined this game after it started, and has played at least 2 questions since (no ambush on arrival). */
function lateJoiners(d) {
  if (!d.g) return [];
  return d.ids.filter((p) => d.st(p).lateGame === d.g.id && Number.isFinite(d.st(p).joinedQ) && d.g.idx - d.st(p).joinedQ >= 2);
}

/** "phone", "iPhone", "Samsung", "laptop"… — whatever we know about someone's device. */
function deviceWord(s) {
  if (s.device === 'computer') return s.os === 'Mac' ? 'Mac' : 'computer';
  if (s.device === 'tablet') return s.os === 'iOS' ? 'iPad' : 'tablet';
  if (s.os === 'iOS') return 'iPhone';
  if (s.brand && s.brand !== 'Android') return s.brand + ' phone';
  return 'phone';
}

/** Points per round so far for a player (history of this game). */
function roundPoints(d, pid) {
  return d.H.map((h) => (h.entries.find((e) => e.pid === pid) || {}).points || 0);
}

const ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth'];

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
      'The app traced every phone to [others] — except {p1}\'s, which is in [place]. What is {p1} not telling everyone about this trip?',
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
      // Only with internet locations for everyone, and really far from all the others.
      if (!d.ids.every((p) => ipOk(d, p))) return null;
      const o = oddOneOut(d.ids, (p) => d.sig(p).area);
      if (!o || d.sig(o.pid).country !== d.sig(o.othersIds[0]).country) return null; // same country, different area
      if (o.othersIds.some((p) => km(d.sig(p).ll, d.sig(o.pid).ll) < 150)) return null;
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
      if (!d.ids.every((p) => ipOk(d, p))) return null;
      const p = onlyPair(d.ids, (x) => d.sig(x).city || null);
      if (!p || !p.pids.every((x) => townOk(d, x))) return null;
      if (d.ids.some((x) => !p.pids.includes(x) && km(d.sig(x).ll, d.sig(p.pids[0]).ll) < 100)) return null; // the others are just next door
      return { bind: { p1: p.pids[0], p2: p.pids[1] }, vars: { place: p.value } };
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
    text: ["The app knows {p1} is near [city]. What's the place there {p1} goes to that nobody in this game knows about?"],
    when(d) {
      const ids = d.ids.filter((p) => townOk(d, p));
      if (!ids.length || d.ids.filter((p) => ipOk(d, p)).length < 2) return null;
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
      const c = onlyOnMobile(d);
      return c ? { bind: { p1: c } } : null;
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
      'The app saw {p1} delete a whole answer and start over. What did the first version say?',
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
    text: [
      "{p1} showed up after the game started. What's the excuse, and what's the real reason?",
      "{p1} walked in late. Who did {p1} text 'on my way!' while still in bed?",
      "If {p1} were late to their own wedding, what would the excuse be?",
      '{p1} missed the first [n] questions. What was {p1} doing that was more fun than this?',
    ],
    when(d) {
      const c = lateJoiners(d);
      return c.length ? { bind: { p1: c[c.length - 1] }, vars: { n: d.st(c[c.length - 1]).joinedQ } } : null;
    },
  },
  {
    id: 'group-before-joined', cat: 'group', level: 3,
    text: [
      'What was everybody saying about {p1} before {p1} joined the game?',
      "Which of the questions {p1} missed would have been the most dangerous for {p1}?",
      "{p1} skipped the first [n] questions. What is the one thing {p1} hopes nobody said while they were away?",
    ],
    when(d) {
      const c = lateJoiners(d);
      return c.length ? { bind: { p1: c[c.length - 1] }, vars: { n: d.st(c[c.length - 1]).joinedQ } } : null;
    },
  },
  {
    id: 'group-most-asked', cat: 'group', level: 5,
    text: ['The app has asked about {p1} [n] times tonight. What is the app going to find out about {p1} next?'],
    when(d) {
      const t = top(d.ids, (p) => (d.g && d.g.featured && d.g.featured[p]) || 0, { min: 3 });
      return t ? { bind: { p1: t.pid }, vars: { n: t.value } } : null;
    },
  },
  {
    id: 'group-never-asked', cat: 'group', level: 4,
    text: ["The app hasn't asked a single question about {p1} yet. What is {p1} hiding that keeps the app away?"],
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
  // ------------------------------------------------------------------ more places
  {
    id: 'place-host-away', cat: 'place', level: 4, sim: 'place-odd',
    text: [
      'Everyone else is in [others], but our host {p1} is running this game from [place]. Why did {p1} really have to be so far away tonight?',
      "{p1} is hosting from [place] while everyone else is in [others]. What is {p1} going to bring back to apologize?",
    ],
    when(d) {
      const o = oddOneOut(d.ids, (p) => d.sig(p).country);
      return o && o.pid === d.hostPid ? { bind: { p1: o.pid }, vars: { place: d.sig(o.pid).countryName || o.value, others: d.sig(o.othersIds[0]).countryName || o.others } } : null;
    },
  },
  {
    id: 'place-split', cat: 'place', level: 3, sim: 'place-split',
    text: [
      "Tonight's game is split between [c1] and [c2]. What does {p1} secretly envy about {p2}'s side?",
      '{p1} is in [c1], {p2} is in [c2]. What would {p1} smuggle across to {p2} if nobody checked the bags?',
    ],
    when(d) {
      const g = groupBy(d.ids, (p) => d.sig(p).country);
      if (g.size !== 2) return null;
      const [[c1, a], [c2, b]] = [...g.entries()];
      if (a.length < 2 || b.length < 2) return null;
      return { bind: { p1: a[Math.floor(random() * a.length)], p2: b[Math.floor(random() * b.length)] }, vars: { c1: d.sig(a[0]).countryName || c1, c2: d.sig(b[0]).countryName || c2 } };
    },
  },
  {
    id: 'place-many-countries', cat: 'place', level: 2, sim: 'place-many',
    text: [
      'This game is happening in [n] countries at once. What is {p1} going to bring back for everyone — and what will {p1} quietly keep?',
      'Players in [n] different countries tonight. Which country would {p1} move to tomorrow if nobody could stop them?',
    ],
    when(d) {
      const g = groupBy(d.ids, (p) => d.sig(p).country);
      if (g.size < 3) return null;
      return { bind: { p1: d.ids[Math.floor(random() * d.ids.length)] }, vars: { n: g.size } };
    },
  },
  {
    id: 'place-neighbors', cat: 'place', level: 3, sim: 'place-pair',
    text: [
      '{p1} and {p2} are only about [km] km apart right now. Who would show up at the other one\'s door uninvited first, and why?',
      'The app measured it: {p1} and {p2} are about [km] km apart. What did {p1} borrow from {p2} and never give back?',
    ],
    when(d) {
      let best = null;
      for (let i = 0; i < d.ids.length; i++)
        for (let j = i + 1; j < d.ids.length; j++) {
          const k = km(d.sig(d.ids[i]).ll, d.sig(d.ids[j]).ll);
          if (!ipOk(d, d.ids[i]) || !ipOk(d, d.ids[j])) continue; // short distances need trustworthy locations
          if (k != null && k > 2 && (!best || k < best.k)) best = { k, a: d.ids[i], b: d.ids[j] };
        }
      if (!best || best.k > 60) return null;
      const far = d.ids.some((p) => p !== best.a && p !== best.b && km(d.sig(p).ll, d.sig(best.a).ll) > 300);
      return far ? { bind: { p1: best.a, p2: best.b }, vars: { km: Math.max(1, Math.round(best.k)) } } : null;
    },
  },

  // ------------------------------------------------------------------ more devices
  {
    id: 'dev-odd-brand', cat: 'device', level: 2, sim: 'dev-os',
    text: [
      'Everyone else has a [others] phone. {p1} has a [brand]. What is {p1} trying to prove?',
      "{p1} is the only one here with a [brand]. What does {p1} say every time someone mentions [others]?",
    ],
    when(d) {
      const o = oddOneOut(d.ids.filter((p) => d.sig(p).device === 'phone'), (p) => d.sig(p).brand);
      return o && o.value !== 'Android' && o.others !== 'Android' && o.value !== o.others ? { bind: { p1: o.pid }, vars: { brand: o.value, others: o.others } } : null;
    },
  },
  {
    id: 'dev-only-mac', cat: 'device', level: 3, sim: 'dev-computer',
    text: [
      "{p1} is the only one on a Mac. What does {p1} mutter every time someone says 'PC'?",
      "Out of everyone on a computer, only {p1} uses a Mac. What's the most expensive thing {p1} bought just because it was shiny?",
    ],
    when(d) {
      const comps = d.ids.filter((p) => d.sig(p).device === 'computer');
      if (comps.length < 2) return null;
      const o = oddOneOut(comps, (p) => (d.sig(p).os === 'macOS' ? 'mac' : 'other'));
      return o && o.value === 'mac' ? { bind: { p1: o.pid } } : null;
    },
  },
  {
    id: 'dev-vintage', cat: 'device', level: 2, sim: 'dev-age',
    text: [
      "The app thinks {p1}'s phone is… experienced. What year does that phone think it is?",
      "{p1}'s device is the oldest in the room. What would it say about {p1} if it could finally retire?",
    ],
    when(d) {
      const t = top(d.ids, (p) => (d.sig(p).memory ? d.sig(p).memory : null), { min: 2, low: true });
      return t && t.runnerUp != null && t.runnerUp >= 4 ? { bind: { p1: t.pid } } : null;
    },
  },
  {
    id: 'dev-powerhouse', cat: 'device', level: 3, sim: 'dev-age',
    text: ['{p1} has the most powerful device in the room. What does {p1} actually use all that power for?'],
    when(d) {
      const t = top(d.ids, (p) => (d.sig(p).cores && d.sig(p).memory ? d.sig(p).cores * d.sig(p).memory : null), { min: 32 });
      return t && t.runnerUp != null && t.value >= t.runnerUp * 2 ? { bind: { p1: t.pid } } : null;
    },
  },
  {
    id: 'dev-full-battery', cat: 'device', level: 2, sim: 'battery',
    text: [
      "{p1}'s phone is at [pct]% while everyone else is draining. Who taught {p1} to be this prepared?",
      "{p1} showed up with a fully charged phone. What is {p1} planning to outlast?",
    ],
    when(d) {
      const known = d.ids.filter((p) => d.sig(p).battery);
      if (known.length < 3) return null;
      const t = top(known, (p) => (!d.sig(p).battery.charging ? d.sig(p).battery.level : null), { min: 95 });
      return t && t.runnerUp != null && t.runnerUp < 70 ? { bind: { p1: t.pid }, vars: { pct: n(t.value) } } : null;
    },
  },
  {
    id: 'dev-light-mode', cat: 'device', level: 3, sim: 'dark',
    text: ['Everyone else uses dark mode. {p1} plays with a bright white screen. What is {p1} not afraid of?'],
    when(d) {
      const o = oddOneOut(d.ids, (p) => (d.sig(p).dark == null ? null : d.sig(p).dark ? 'dark' : 'light'));
      return o && o.value === 'light' ? { bind: { p1: o.pid } } : null;
    },
  },
  {
    id: 'dev-two-phones-alike', cat: 'device', level: 3, sim: 'dev-pair',
    text: ["{p1} and {p2} are the only two on a [os] device. What do they talk about when the others aren't around?"],
    when(d) {
      const p = onlyPair(d.ids, (x) => d.sig(x).os || null);
      return p ? { bind: { p1: p.pids[0], p2: p.pids[1] }, vars: { os: p.value } } : null;
    },
  },

  // ------------------------------------------------------------------ more languages / network / time
  {
    id: 'lang-pair', cat: 'lang', level: 3, sim: 'lang-pair',
    text: ["Only {p1} and {p2} have their phones in [lang]. What are they saying about everyone else in [lang]?"],
    when(d) {
      const p = onlyPair(d.ids, (x) => langName(d.sig(x).lang));
      return p ? { bind: { p1: p.pids[0], p2: p.pids[1] }, vars: { lang: p.value } } : null;
    },
  },
  {
    id: 'net-all-same', cat: 'net', level: 3, sim: 'net-same',
    text: [
      "Everyone here is on the same internet connection. What has {p1} been downloading on it all night?",
      'Same Wi-Fi for everyone tonight. Whose fault is it, honestly, when it gets slow — and what is {p1} streaming?',
    ],
    when(d) {
      const g = groupBy(d.ids, (p) => d.sig(p).netId || null);
      if (g.size !== 1 || [...g.values()][0].length < 3 || [...g.values()][0].length !== d.ids.length) return null;
      return { bind: { p1: d.ids[Math.floor(random() * d.ids.length)] } };
    },
  },
  {
    id: 'net-mobile-low-battery', cat: 'net', level: 4, sim: 'battery',
    text: ["{p1} is on mobile data with [pct]% battery left. Where exactly is {p1} right now — and who are they hiding from?"],
    when(d) {
      const c = onlyOnMobile(d, (p) => d.sig(p).battery && !d.sig(p).battery.charging && d.sig(p).battery.level < 35);
      return c ? { bind: { p1: c }, vars: { pct: d.sig(c).battery.level } } : null;
    },
  },
  {
    id: 'time-tomorrow', cat: 'time', level: 4, sim: 'time-diff',
    text: [
      "It's already [d1] for {p1}, but still [d2] for {p2}. What does {p1} know about tomorrow that {p2} doesn't?",
      '{p1} is living in tomorrow ([d1]) while {p2} is stuck in [d2]. What should {p1} warn {p2} about?',
    ],
    when(d) {
      const ids = d.ids.filter((p) => d.local[p] && d.local[p].day);
      for (const a of ids)
        for (const b of ids)
          if (a !== b && d.local[a].weekday !== d.local[b].weekday && (d.local[a].day > d.local[b].day || (d.local[a].day === 1 && d.local[b].day >= 28)))
            return { bind: { p1: a, p2: b }, vars: { d1: d.local[a].weekday, d2: d.local[b].weekday } };
      return null;
    },
  },
  {
    id: 'time-weekend-night', cat: 'time', level: 3, sim: 'time-night',
    text: [
      "It's [day] night where {p1} is, and {p1} is playing a party game on a phone. What did {p1} cancel to be here?",
      "[day] night, [time], and {p1} is here with us. Who did {p1} tell they were 'busy tonight'?",
    ],
    when(d) {
      const c = d.ids.filter((p) => d.local[p] && ['Friday', 'Saturday'].includes(d.local[p].weekday) && d.local[p].hour >= 20);
      if (!c.length) return null;
      const pid = c[Math.floor(random() * c.length)];
      return { bind: { p1: pid }, vars: { day: d.local[pid].weekday, time: d.local[pid].time } };
    },
  },
  {
    id: 'time-lunch', cat: 'time', level: 2, sim: 'time-meal',
    text: ["It's lunchtime where {p1} is. What is {p1} eating right now that they would never post a photo of?"],
    when(d) {
      const c = d.ids.filter((p) => d.local[p] && d.local[p].hour >= 12 && d.local[p].hour < 14);
      return c.length === 1 ? { bind: { p1: c[0] } } : null;
    },
  },

  // ------------------------------------------------------------------ more habits
  {
    id: 'habit-clock-grabbed', cat: 'habit', level: 3, sim: 'habit-slow',
    text: ['The clock had to grab {p1}\'s answer [n] times tonight. What was {p1} doing instead of typing?'],
    when(d) {
      const t = top(d.ids, (p) => d.H.filter((h) => h.entries.some((e) => e.pid === p && e.auto)).length, { min: 2 });
      return t ? { bind: { p1: t.pid }, vars: { n: t.value } } : null;
    },
  },
  {
    id: 'habit-never-votes-for', cat: 'habit', level: 4, sim: 'habit-votes',
    text: [
      "{p1} has had [n] chances and never once voted for {p2}'s answer. What did {p2} do to {p1}?",
      "Not a single vote from {p1} to {p2} in [n] rounds. What is {p1} still holding against {p2}?",
    ],
    when(d) {
      if (d.H.length < 4) return null;
      const cand = [];
      for (const a of d.ids)
        for (const b of d.ids) {
          if (a === b) continue;
          const chances = d.H.filter((h) => h.votes.some(([v]) => v === a) && h.entries.some((e) => e.pid === b)).length;
          const hits = d.H.filter((h) => h.votes.some(([v, x]) => v === a && x === b)).length;
          if (chances >= 4 && !hits) cand.push({ a, b, chances });
        }
      if (!cand.length) return null;
      const c = cand.sort((x, y) => y.chances - x.chances)[0];
      return { bind: { p1: c.a, p2: c.b }, vars: { n: c.chances } };
    },
  },
  {
    id: 'habit-mutual-votes', cat: 'habit', level: 4, sim: 'habit-votes',
    text: [
      '{p1} and {p2} keep voting for each other. What did they agree on before the game started?',
      "The app noticed {p1} and {p2} trading votes all night. What is {p2} getting out of this deal?",
    ],
    when(d) {
      const c = {};
      for (const h of d.H) for (const [v, a] of h.votes) c[v + '|' + a] = (c[v + '|' + a] || 0) + 1;
      for (const a of d.ids)
        for (const b of d.ids) if (a < b && (c[a + '|' + b] || 0) >= 2 && (c[b + '|' + a] || 0) >= 2) return { bind: { p1: a, p2: b } };
      return null;
    },
  },
  {
    id: 'habit-chat-silent', cat: 'habit', level: 3, sim: 'habit-chat',
    text: ["{p1} hasn't sent a single chat message while everyone else talks. What is {p1} thinking that they won't type?"],
    when(d) {
      const total = d.ids.reduce((sum, p) => sum + (d.st(p).chats || 0), 0);
      const silent = d.ids.filter((p) => !d.st(p).chats);
      return total >= 8 && silent.length === 1 ? { bind: { p1: silent[0] } } : null;
    },
  },
  {
    id: 'habit-crowd-favorite', cat: 'habit', level: 3, sim: 'habit-score',
    text: [
      'Everyone keeps voting for {p1}. What did {p1} promise the group before the game?',
      "{p1}'s answers collected [n] votes so far — more than anyone. Who is secretly writing {p1}'s answers?",
    ],
    when(d) {
      const t = top(d.ids, (p) => d.H.reduce((sum, h) => sum + h.votes.filter(([, a]) => a === p).length, 0), { min: 4 });
      return t && t.runnerUp != null && t.value >= t.runnerUp + 2 ? { bind: { p1: t.pid }, vars: { n: t.value } } : null;
    },
  },
  {
    id: 'habit-crickets', cat: 'habit', level: 2, sim: 'habit-score',
    text: ["{p1}'s answers got crickets [n] times tonight. Which of them was secretly the best answer of the night?"],
    when(d) {
      const t = top(d.ids, (p) => d.H.filter((h) => h.entries.some((e) => e.pid === p && !e.judge && !e.crowd)).length, { min: 3 });
      return t ? { bind: { p1: t.pid }, vars: { n: t.value } } : null;
    },
  },

  // ------------------------------------------------------------------ more about the group
  {
    id: 'group-avatar', cat: 'group', level: 2, sim: 'group-avatar',
    text: [
      '{p1} chose [face] as their face tonight. What does that say about {p1} that {p1} would rather not admit?',
      "Of all the faces, {p1} picked [face]. What's the real story behind that choice?",
    ],
    when(d) {
      const pid = d.ids[Math.floor(random() * d.ids.length)];
      const p = d.room.players.find((x) => x.id === pid);
      return p && p.avatar ? { bind: { p1: pid }, vars: { face: p.avatar } } : null;
    },
  },
  {
    id: 'group-trophies', cat: 'group', level: 2, sim: 'group-wins',
    text: ['{p1} has already won [n] game[s] in this room. Where is {p1} keeping the imaginary trophies — and who has to polish them?'],
    when(d) {
      const w = d.room.wins || {};
      const t = top(d.ids, (p) => w[p] || 0, { min: 1 });
      return t ? { bind: { p1: t.pid }, vars: { n: t.value, s: t.value > 1 ? 's' : '' } } : null;
    },
  },
  {
    id: 'group-veteran', cat: 'group', level: 2, sim: 'group-experience',
    text: ['{p1} has played this game more than anyone here. What is {p1}\'s secret strategy that nobody else has figured out?'],
    when(d) {
      const t = top(d.ids, (p) => Object.keys((d.room.seenBy && d.room.seenBy[p]) || {}).length, { min: 30 });
      return t && t.runnerUp != null && t.value >= t.runnerUp * 2 ? { bind: { p1: t.pid } } : null;
    },
  },
  {
    id: 'group-first-timer', cat: 'group', level: 2, sim: 'group-experience',
    text: ["It's {p1}'s first time playing with this app. What did the others warn {p1} about before the game?"],
    when(d) {
      const seen = (p) => Object.keys((d.room.seenBy && d.room.seenBy[p]) || {}).length;
      const fresh = d.ids.filter((p) => seen(p) <= ((d.g && d.g.idx) || 0) + 1);
      return fresh.length === 1 && d.ids.filter((p) => seen(p) >= 20).length >= 2 ? { bind: { p1: fresh[0] } } : null;
    },
  },
  {
    id: 'group-last-place', cat: 'group', level: 2, sim: 'group-score',
    text: ["{p1} is in last place but still smiling. What is {p1}'s comeback plan?"],
    when(d) {
      if (!d.g || d.g.idx < 4 || !d.g.scores) return null;
      const t = top(d.ids, (p) => d.g.scores[p] || 0, { min: Infinity, low: true });
      return t && t.runnerUp != null && t.runnerUp > t.value ? { bind: { p1: t.pid } } : null;
    },
  },

  // ------------------------------------------------------------------ how they're doing tonight
  {
    id: 'perf-judge-fooler', cat: 'perf', level: 3, sim: 'perf-judge',
    text: [
      '{p1} has fooled the person the question was about [n] times tonight. What would the title of {p1}\'s autobiography be?',
      "{p1} keeps writing answers people believe about themselves ([n] times so far). What is {p1}'s day job, really?",
      '{p1} has tricked the subject of a question [n] times. Finish the sentence: "Trust me, I\'m a…"',
    ],
    when(d) {
      const t = top(d.ids, (p) => d.H.reduce((sum, h) => sum + h.entries.filter((e) => e.pid === p && e.judge).length, 0), { min: 2 });
      return t ? { bind: { p1: t.pid }, vars: { n: t.value } } : null;
    },
  },
  {
    id: 'perf-streak', cat: 'perf', level: 3, sim: 'perf-streak',
    text: [
      '{p1} has scored in [n] rounds in a row. What is written on the sticky note on the back of {p1}\'s [dev]?',
      "{p1} is on a [n]-round streak. What's {p1}'s pre-game ritual that nobody has seen?",
      '[n] rounds in a row with points for {p1}. What would {p1} name this winning streak if it were a racehorse?',
    ],
    when(d) {
      if (d.H.length < 3) return null;
      const t = top(d.ids, (p) => {
        const r = roundPoints(d, p);
        let k = 0;
        for (let i = r.length - 1; i >= 0 && r[i] > 0; i--) k++;
        return k;
      }, { min: 3 });
      return t ? { bind: { p1: t.pid }, vars: { n: t.value, dev: deviceWord(d.sig(t.pid)) } } : null;
    },
  },
  {
    id: 'perf-comeback', cat: 'perf', level: 3, sim: 'perf-rank',
    text: [
      '{p1} went from last place to [place] place. What did {p1} promise someone to make that happen?',
      "{p1} was in last place and now is [place]. What's the name of {p1}'s comeback documentary?",
    ],
    when(d) {
      if (d.H.length < 4 || !d.g.scores) return null;
      const wasLast = (p) => d.H.some((h) => h.rank && h.rank[p] && h.rank[p] === Math.max(...d.ids.map((q) => h.rank[q] || 0)) && h.rank[p] > 1);
      const nowRank = rankNow(d);
      const c = d.ids.filter((p) => wasLast(p) && nowRank[p] <= 2);
      return c.length === 1 ? { bind: { p1: c[0] }, vars: { place: ORD[nowRank[c[0]]] } } : null;
    },
  },
  {
    id: 'perf-close-race', cat: 'perf', level: 2, sim: 'perf-rank',
    text: [
      '{p1} and {p2} are neck and neck at the top. What trash talk is {p1} saving for after the game?',
      "Only [gap] point[s] between {p1} and {p2}. What will the loser of these two have to do for the winner?",
      '{p1} and {p2} are fighting for first place. Which childish thing would {p1} do to win?',
    ],
    when(d) {
      if (d.H.length < 4 || !d.g.scores) return null;
      const order = d.ids.slice().sort((a, b) => (d.g.scores[b] || 0) - (d.g.scores[a] || 0));
      const [a, b, c] = order;
      if (!a || !b) return null;
      const gap = (d.g.scores[a] || 0) - (d.g.scores[b] || 0);
      if (!d.g.scores[a] || gap > 1 || (c && d.g.scores[c] >= d.g.scores[b])) return null;
      return { bind: { p1: a, p2: b }, vars: { gap: Math.max(1, gap), s: gap === 1 ? '' : 's' } };
    },
  },
  {
    id: 'perf-zero', cat: 'perf', level: 2, sim: 'group-score',
    text: [
      '{p1} still has zero points. Finish {p1}\'s sentence: "I\'m not losing, I\'m just…"',
      "{p1} hasn't scored a single point yet. What does {p1}'s [dev] know about this that we don't?",
    ],
    when(d) {
      if (d.H.length < 4 || !d.g.scores) return null;
      const c = d.ids.filter((p) => !(d.g.scores[p] || 0) && d.H.filter((h) => h.answerers.includes(p)).length >= 3);
      return c.length === 1 ? { bind: { p1: c[0] }, vars: { dev: deviceWord(d.sig(c[0])) } } : null;
    },
  },
  {
    id: 'perf-leader-battery', cat: 'perf', level: 3, sim: 'battery',
    text: [
      '{p1} is winning with only [pct]% battery left. If the phone dies, who does {p1} accuse of sabotage?',
      "{p1} is in the lead, but {p1}'s phone is at [pct]%. What will {p1} sacrifice to stay alive: dignity or a charger?",
    ],
    when(d) {
      if (d.H.length < 3 || !d.g.scores) return null;
      const lead = top(d.ids, (p) => d.g.scores[p] || 0, { min: 1 });
      const b = lead && d.sig(lead.pid).battery;
      if (!b || b.charging || b.level > 30 || d.now - b.at > 10 * 60000) return null;
      return { bind: { p1: lead.pid }, vars: { pct: n(b.level) } };
    },
  },
  {
    id: 'perf-leader-night', cat: 'perf', level: 4, sim: 'time-night',
    text: [
      "It's [time] for {p1} and {p1} is winning. What is {p1} going to say to their boss tomorrow?",
      '{p1} is leading the game at [time] their time. What is keeping {p1} this sharp so late?',
    ],
    when(d) {
      if (d.H.length < 3 || !d.g.scores) return null;
      const lead = top(d.ids, (p) => d.g.scores[p] || 0, { min: 1 });
      const l = lead && d.local[lead.pid];
      return l && (l.hour >= 23 || l.hour < 4) ? { bind: { p1: lead.pid }, vars: { time: l.time } } : null;
    },
  },
  {
    id: 'perf-last-device', cat: 'perf', level: 2, sim: 'group-score',
    text: [
      "{p1} is in last place. Which app on {p1}'s [dev] is to blame?",
      "{p1} is at the bottom of the scoreboard. What will {p1}'s [dev] autocorrect 'I lost' into?",
    ],
    when(d) {
      if (!d.g || d.H.length < 4 || !d.g.scores) return null;
      const t = top(d.ids, (p) => d.g.scores[p] || 0, { min: Infinity, low: true });
      return t && t.runnerUp != null && t.runnerUp > t.value ? { bind: { p1: t.pid }, vars: { dev: deviceWord(d.sig(t.pid)) } } : null;
    },
  },
  {
    id: 'perf-fast-and-winning', cat: 'perf', level: 3, sim: 'perf-speed',
    text: [
      '{p1} answers the fastest AND is doing great. What is {p1} not telling us about how much they practiced?',
      "{p1} types the quickest and still scores. What else is {p1} suspiciously fast at?",
    ],
    when(d) {
      if (d.H.length < 3 || !d.g.scores) return null;
      const speed = (p) => (d.st(p).answers >= 3 ? d.st(p).answerMs / d.st(p).answers : null);
      const fast = top(d.ids, (p) => (speed(p) == null ? null : -speed(p)));
      const rank = rankNow(d);
      return fast && rank[fast.pid] <= 2 && (d.g.scores[fast.pid] || 0) > 0 ? { bind: { p1: fast.pid } } : null;
    },
  },
  {
    id: 'perf-late-catchup', cat: 'perf', level: 3, sim: 'group-late',
    text: [
      '{p1} joined late and has already passed [n] people who were here from the start. What is {p1}\'s secret?',
      "{p1} missed the beginning and still beat [n] of you. Who should be most embarrassed right now?",
    ],
    when(d) {
      const c = lateJoiners(d);
      if (!c.length || !d.g.scores) return null;
      const p = c[c.length - 1];
      const beat = d.ids.filter((q) => !c.includes(q) && (d.g.scores[q] || 0) < (d.g.scores[p] || 0)).length;
      return beat >= 1 ? { bind: { p1: p }, vars: { n: beat } } : null;
    },
  },
];

function rankNow(d) {
  const r = {};
  const sc = d.g.scores || {};
  const vals = d.ids.map((p) => sc[p] || 0);
  for (const p of d.ids) r[p] = 1 + vals.filter((v) => v > (sc[p] || 0)).length;
  return r;
}

// More ways to say each one, so the same situation never sounds the same twice.
const MORE_WORDINGS = {
  'place-odd-region': ['{p1} is the only one near [place] tonight; everyone else is around [others]. What is {p1} doing there that nobody was told about?'],
  'place-same-city-pair': ['Only {p1} and {p2} are in [place]. Which one of them suggested meeting up after this game — and where?'],
  'place-season': ["{p1} is in [s1] while everyone else is in [s2]. What is {p1} wearing right now that would make everyone else jealous?"],
  'place-city': ["The app found {p1} near [city]. Which spot in [city] does {p1} keep going back to — and why alone?", "{p1} is somewhere around [city]. What does {p1} do there on the days nobody hears from them?"],
  'dev-tablet': ["{p1} is playing on a tablet. Whose tablet is it really, and what is {p1} not supposed to see on it?"],
  'dev-charging': ["{p1} is the only one plugged in. How long has {p1} been sitting next to that outlet, and why?"],
  'dev-dark-mode': ['{p1} keeps their phone in dark mode, unlike everyone else. What is {p1} reading at night that needs the lights off?'],
  'dev-installed': ['{p1} saved this game to their home screen. What other app sits right next to it that {p1} hopes nobody notices?'],
  'dev-browser': ['{p1} is the only one on [browser]. What happened that made {p1} stop trusting the normal browsers?'],
  'dev-same-phone': ['{p1} and {p2} have the exact same [model]. Which of them bought it first — and who still won\'t admit they copied?'],
  'lang-many': ["{p1}'s phone knows [langs]. Which one does {p1} use to argue with the GPS?"],
  'lang-abroad': ['{p1} is in [country], but their phone still speaks [lang]. What does {p1} pretend to understand when the locals talk?'],
  'net-same-wifi-pair': ['{p1} and {p2} are sharing a Wi-Fi network right now. What are they watching together while pretending to play?'],
  'net-odd-wifi': ["Everyone's connected to the same network — except {p1}. Who changed the Wi-Fi password, and why didn't they tell {p1}?"],
  'net-mobile-data': ["{p1} is on mobile data instead of Wi-Fi. What is {p1} doing out there instead of being home?"],
  'net-detour': ["The app noticed {p1}'s signal is taking a long way around. Who is {p1} trying very hard not to be found by?"],
  'time-early': ["It's [time] for {p1}. What did {p1} skip this morning to be here?"],
  'time-work': ["It's [day], [time] for {p1}. What is open in the other window that {p1}'s boss thinks they're doing?"],
  'time-diff': ['[t1] where {p1} is, [t2] where {p2} is. What would {p2} be shocked to learn {p1} usually does at this hour?'],
  'time-dinner': ["It's dinner time for {p1}. Who is {p1} ignoring at the dinner table to play this?"],
  'habit-long-away': ['{p1} disappeared for [secs] seconds during the game. Who was {p1} talking to?'],
  'habit-fast-typer': ['{p1} types [cps] letters per second. How many group chats is {p1} secretly keeping up with right now?'],
  'habit-slow-writer': ['{p1} takes about [secs] seconds per answer. How many drafts does {p1} delete before submitting?'],
  'habit-editor': ['{p1} went back and changed their answer [n] times already. What did the first versions say?'],
  'habit-quick-voter': ['{p1} picks a favorite in about [secs] seconds every time. What other big decisions does {p1} make that fast?'],
  'habit-slow-voter': ['{p1} always takes the longest to vote. What is {p1} weighing up that the rest of us can\'t see?'],
  'habit-first': ['{p1} is always the first to answer. What does {p1} do with all the free time while everyone else is writing?'],
  'habit-last': ['{p1} keeps finishing last. Who is texting {p1} the answers?'],
  'habit-long-answers': ["{p1}'s answers are always the longest. What is the longest message {p1} ever sent — and to whom?"],
  'habit-short-answers': ['{p1} never writes more than about [len] letters. What is {p1} saving all those words for?'],
  'habit-chatty': ["{p1} has sent [n] messages in the waiting room. What would {p1}'s messages say if nobody else could read them?"],
  'habit-emoji': ['{p1} reacts with [emoji] to everything. Who taught {p1} that one, and what does it mean in private?'],
  'habit-dropouts': ["{p1} keeps losing the connection ([n] times now). Where does {p1} keep wandering off to?"],
  'group-late-joiner': ['{p1} joined late. What was {p1} doing that was more important than this game?'],
  'group-before-joined': ['Before {p1} arrived, the group was quiet for a reason. What were they all saying about {p1}?'],
  'group-most-asked': ["The app has asked about {p1} [n] times tonight. What does the app suspect about {p1}?"],
  'group-never-asked': ["Not one question about {p1} so far. What is {p1} hiding so well that even the app can't find it?"],
  'group-host': ['Our host {p1} controls the game tonight. What rule would {p1} secretly add if nobody could object?'],
  'group-leader': ['{p1} is in the lead. What will {p1} make everyone do if they win?'],
  'group-no-votes': ['{p1} is still waiting for their first vote. What would {p1} offer for just one?'],
  'dev-powerhouse': ["{p1}'s device could run a small country. What is it really doing in the background right now?"],
  'dev-light-mode': ['{p1} is the only one not using dark mode. What does {p1} know about the dark that the rest of us don\'t?'],
  'dev-two-phones-alike': ['{p1} and {p2} are the only [os] people here. What secret club meeting are they skipping to play this?'],
  'lang-pair': ['{p1} and {p2} both have their phones in [lang]. What inside joke do they share that the rest of us would never get?'],
  'net-mobile-low-battery': ['{p1}: mobile data and [pct]% battery. Where is {p1}, and who is going to have to come pick them up?'],
  'time-lunch': ["It's lunchtime for {p1}. Who is {p1} eating with that they haven't mentioned?"],
  'habit-clock-grabbed': ["{p1}'s time ran out [n] times. What was {p1} actually typing to someone else?"],
  'habit-chat-silent': ['{p1} has stayed quiet in the chat all night. What is {p1} writing in their head about everyone?'],
  'habit-crickets': ["Nobody voted for {p1}'s answers [n] times. Which answer will {p1} still be defending next week?"],
  'group-trophies': ['{p1} has won [n] game[s] here already. What is {p1} going to demand as a prize this time?'],
  'group-veteran': ['{p1} has seen more of these questions than anyone. Which one is {p1} secretly hoping comes up tonight?'],
  'group-first-timer': ["This is {p1}'s first time playing. What does {p1} think is going on right now?"],
  'group-last-place': ['{p1} is in last place. Who is {p1} going to blame for it?'],
};
// Psych-style twists: the same clue, asked like a party question.
const PSYCH_WORDINGS = {
  'place-odd-country': ["{p1} is in [place] while everyone else is in [others]. What would {p1}'s travel vlog be called?"],
  'place-far-pair': ['{p1} and {p2} are [km] km apart. If they met halfway, what would they argue about first?'],
  'place-season': ["It's [s1] for {p1}. If {p1} were a [s1] holiday decoration, what would they be?"],
  'dev-only-iphone': ["If {p1}'s iPhone could talk, what would it say about {p1}?"],
  'dev-only-android': ["What is {p1}'s phone wallpaper, and what is it trying to tell us?"],
  'dev-only-computer': ['{p1} is the only one on a computer. What are the other 14 tabs {p1} has open right now?'],
  'dev-low-battery': ["{p1}'s phone is at [pct]%. Write the last text {p1} would send before it dies."],
  'dev-dark-mode': ['{p1} uses dark mode on everything. If {p1} were a villain, what would their evil plan be?'],
  'lang-odd': ['{p1} has their phone in [lang]. What is the one word in [lang] {p1} uses way too much?'],
  'net-same-wifi-pair': ["{p1} and {p2} are on the same Wi-Fi. What is the Wi-Fi network's name, honestly?"],
  'net-mobile-data': ["Finish {p1}'s sentence: \"Sorry, I'm on data, so I…\""],
  'time-late': ["It's [time] for {p1}. What does {p1}'s 3 a.m. thought sound like?"],
  'time-early': ["It's [time] for {p1}. What's the first thing {p1} says to the mirror in the morning?"],
  'time-dinner': ["It's dinner time where {p1} is. If {p1} were a dish on a menu, what would it be called?"],
  'habit-fast-typer': ['{p1} types super fast. What would be the title of the novel {p1} writes in one night?'],
  'habit-slow-writer': ['{p1} takes their time with every answer. If {p1} were a snail, what would be written on its shell?'],
  'habit-deleter': ['{p1} deletes a lot before answering. What was the answer {p1} deleted that would have won the game?'],
  'habit-leaves-app': ["{p1} keeps leaving the game to check something. What's the name of the app {p1} can't stay away from?"],
  'habit-quick-voter': ["{p1} votes in a flash. What would {p1}'s campaign slogan be if they ran for mayor?"],
  'habit-long-answers': ['{p1} writes the longest answers. What would {p1} write in a fortune cookie?'],
  'habit-short-answers': ["{p1} keeps it short. Describe {p1}'s dream vacation in {p1}'s own style: three words or less."],
  'habit-chatty': ["{p1} talks the most in the chat. What would {p1}'s talk show be called?"],
  'habit-emoji': ['{p1} loves [emoji]. If [emoji] were {p1}\'s spirit animal, what would its job be?'],
  'group-host': ["{p1} is the host tonight. What's the theme song that plays when {p1} enters a room?"],
  'group-leader': ['{p1} is winning. What will {p1} put on their trophy shelf right next to this win?'],
  'group-last-place': ["{p1} is in last place. What's the name of {p1}'s comeback album?"],
  'group-avatar': ['{p1} chose [face] tonight. What would [face] say about {p1} at a roast?'],
  'habit-crowd-favorite': ["Everyone loves {p1}'s answers. What would {p1}'s fan club be called?"],
  'habit-crickets': ["{p1}'s answers got crickets [n] times. What's the name of {p1}'s underappreciated art style?"],
};
for (const t of T) if (MORE_WORDINGS[t.id]) t.text = [...t.text, ...MORE_WORDINGS[t.id]];
for (const t of T) if (PSYCH_WORDINGS[t.id]) t.text = [...t.text, ...PSYCH_WORDINGS[t.id]];

// Templates without an explicit similarity group: these share one.
const SIM = {
  'place-odd-country': 'place-odd', 'place-odd-region': 'place-odd', 'place-city': 'place-odd',
  'place-far-pair': 'place-pair', 'place-same-city-pair': 'place-pair',
  'dev-only-iphone': 'dev-os', 'dev-only-android': 'dev-os', 'dev-same-phone': 'dev-pair',
  'dev-only-computer': 'dev-computer', 'dev-tablet': 'dev-computer',
  'dev-low-battery': 'battery', 'dev-charging': 'battery', 'dev-dark-mode': 'dark',
  'lang-odd': 'lang-odd', 'lang-abroad': 'lang-odd',
  'net-same-wifi-pair': 'net-same', 'net-odd-wifi': 'net-same', 'net-mobile-data': 'net-mobile',
  'time-late': 'time-night', 'time-early': 'time-day', 'time-work': 'time-day', 'time-dinner': 'time-meal', 'time-diff': 'time-diff',
  'habit-leaves-app': 'habit-away', 'habit-long-away': 'habit-away', 'habit-dropouts': 'habit-away',
  'habit-fast-typer': 'habit-typing', 'habit-slow-writer': 'habit-slow', 'habit-deleter': 'habit-typing', 'habit-editor': 'habit-typing',
  'habit-quick-voter': 'habit-voting-speed', 'habit-slow-voter': 'habit-voting-speed', 'habit-first': 'habit-order', 'habit-last': 'habit-order',
  'habit-loyal-vote': 'habit-votes', 'habit-long-answers': 'habit-length', 'habit-short-answers': 'habit-length',
  'habit-chatty': 'habit-chat', 'habit-emoji': 'habit-chat',
  'group-late-joiner': 'group-late', 'group-before-joined': 'group-late', 'group-most-asked': 'group-featured', 'group-never-asked': 'group-featured',
  'group-leader': 'group-score', 'group-no-votes': 'habit-score',
};
const simOf = (t) => t.sim || SIM[t.id] || t.id;

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
  const sims = new Set((g && g.dynSims) || []); // never two similar ones in the same game
  const out = [];
  for (const t of T) {
    const id = 'x' + t.id;
    if (used.has(id) || sims.has(simOf(t)) || (cats[t.cat] || 0) >= (CATEGORY_MAX[t.cat] || 1)) continue;
    let b;
    try {
      b = t.when(d);
    } catch {
      b = null;
    }
    if (!b || Object.values(b.bind).some((pid) => !activeIds.includes(pid))) continue;
    if (new Set(Object.values(b.bind)).size !== Object.keys(b.bind).length) continue;
    const phrase = t.text[Math.floor(random() * t.text.length)];
    // spread these questions over different people too
    const featured = Object.values(b.bind).reduce((sum, pid) => sum + ((g.featured && g.featured[pid]) || 0), 0);
    // The same kind of clue in an earlier game here (or about the same person) weighs against it too.
    const before = ((room.simsUsed || {})[simOf(t)] || 0) + Object.values(b.bind).filter((pid) => ((room.simsUsedOn || {})[pid] || []).includes(simOf(t))).length;
    out.push({ id, cat: t.cat, sim: simOf(t), level: t.level, text: fill(phrase, b.bind, b.vars), bind: b.bind, weightPenalty: (cats[t.cat] || 0) * 0.5 + featured * 0.3 + before * 0.8 });
  }
  return out;
}

export const DYNAMIC_TEMPLATES = T;
