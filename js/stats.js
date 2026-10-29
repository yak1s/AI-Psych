// Small helpers shared by the host: clean up a device's clues before storing them,
// and add to a player's "how they play" counters.

const STR = (v, max = 40) => (typeof v === 'string' ? v.replace(/[{}[\]<>]/g, '').slice(0, max) : null);
const NUM = (v) => (Number.isFinite(v) ? v : null);

/** Keep only the fields the question templates use, with sane types and lengths. */
export function cleanSignals(s) {
  if (!s || typeof s !== 'object') return {};
  const ll = Array.isArray(s.ll) && s.ll.length === 2 && s.ll.every(Number.isFinite) ? [s.ll[0], s.ll[1]] : null;
  const battery =
    s.battery && Number.isFinite(s.battery.level) ? { level: Math.max(0, Math.min(100, s.battery.level)), charging: !!s.battery.charging, at: Date.now() } : null;
  return {
    tz: STR(s.tz, 60),
    country: STR(s.country, 3),
    countryName: STR(s.countryName),
    area: STR(s.area),
    city: STR(s.city),
    precise: !!s.precise,
    ll,
    langs: Array.isArray(s.langs) ? s.langs.slice(0, 4).map((x) => STR(x, 16)).filter(Boolean) : [],
    lang: STR(s.lang, 16),
    langRegion: STR(s.langRegion, 3),
    os: STR(s.os, 16),
    device: ['phone', 'tablet', 'computer'].includes(s.device) ? s.device : null,
    browser: STR(s.browser, 20),
    brand: STR(s.brand, 20),
    model: STR(s.model, 30),
    dark: typeof s.dark === 'boolean' ? s.dark : null,
    installed: !!s.installed,
    conn: STR(s.conn, 12),
    netId: STR(s.netId, 20),
    cores: NUM(s.cores),
    memory: NUM(s.memory),
    battery,
  };
}

export function addStat(room, pid, add) {
  room.stats = room.stats || {};
  const st = (room.stats[pid] ||= {});
  for (const [k, v] of Object.entries(add)) st[k] = (st[k] || 0) + v;
  return st;
}
