// Device clues for the AI's "how does it know that?!" questions. Nothing here
// asks for permission: the time zone, languages, phone/computer, battery, Wi-Fi
// vs mobile data, a rough location from the internet connection, and which
// players share a network (compared by a one-way fingerprint, never the address).
// Only the host's device receives these, and only to pick questions.

import { hash } from './game/util.js';
import { ICE_SERVERS, geoEnabled } from './config.js';

// time zone -> [country code, area label, lat, lon]
const TZ = {
  'America/New_York': ['US', 'the US East Coast', 40.7, -74],
  'America/Detroit': ['US', 'Michigan', 42.3, -83],
  'America/Indiana/Indianapolis': ['US', 'Indiana', 39.8, -86.2],
  'America/Kentucky/Louisville': ['US', 'Kentucky', 38.3, -85.8],
  'America/Chicago': ['US', 'the US Midwest', 41.9, -87.6],
  'America/Denver': ['US', 'the Rockies', 39.7, -105],
  'America/Phoenix': ['US', 'Arizona', 33.4, -112],
  'America/Los_Angeles': ['US', 'the US West Coast', 34, -118.2],
  'America/Anchorage': ['US', 'Alaska', 61.2, -149.9],
  'Pacific/Honolulu': ['US', 'Hawaii', 21.3, -157.8],
  'America/Toronto': ['CA', 'Eastern Canada', 43.7, -79.4],
  'America/Montreal': ['CA', 'Quebec', 45.5, -73.6],
  'America/Vancouver': ['CA', 'Western Canada', 49.3, -123.1],
  'America/Edmonton': ['CA', 'Alberta', 53.5, -113.5],
  'America/Winnipeg': ['CA', 'Manitoba', 49.9, -97.1],
  'America/Halifax': ['CA', 'Atlantic Canada', 44.6, -63.6],
  'America/Mexico_City': ['MX', 'Mexico', 19.4, -99.1],
  'America/Cancun': ['MX', 'Cancún', 21.2, -86.8],
  'America/Tijuana': ['MX', 'Tijuana', 32.5, -117],
  'America/Argentina/Buenos_Aires': ['AR', 'Argentina', -34.6, -58.4],
  'America/Buenos_Aires': ['AR', 'Argentina', -34.6, -58.4],
  'America/Argentina/Cordoba': ['AR', 'Argentina', -31.4, -64.2],
  'America/Argentina/Mendoza': ['AR', 'Mendoza', -32.9, -68.8],
  'America/Sao_Paulo': ['BR', 'Brazil', -23.5, -46.6],
  'America/Bahia': ['BR', 'Bahia', -13, -38.5],
  'America/Fortaleza': ['BR', 'the north of Brazil', -3.7, -38.5],
  'America/Recife': ['BR', 'Recife', -8.1, -34.9],
  'America/Manaus': ['BR', 'the Amazon', -3.1, -60],
  'America/Santiago': ['CL', 'Chile', -33.4, -70.7],
  'America/Montevideo': ['UY', 'Uruguay', -34.9, -56.2],
  'America/Asuncion': ['PY', 'Paraguay', -25.3, -57.6],
  'America/La_Paz': ['BO', 'Bolivia', -16.5, -68.1],
  'America/Lima': ['PE', 'Peru', -12, -77],
  'America/Bogota': ['CO', 'Colombia', 4.7, -74.1],
  'America/Caracas': ['VE', 'Venezuela', 10.5, -66.9],
  'America/Guayaquil': ['EC', 'Ecuador', -2.2, -79.9],
  'America/Panama': ['PA', 'Panama', 9, -79.5],
  'America/Costa_Rica': ['CR', 'Costa Rica', 9.9, -84.1],
  'America/Puerto_Rico': ['PR', 'Puerto Rico', 18.5, -66.1],
  'America/Santo_Domingo': ['DO', 'the Dominican Republic', 18.5, -69.9],
  'Europe/London': ['GB', 'the UK', 51.5, -0.1],
  'Europe/Dublin': ['IE', 'Ireland', 53.3, -6.3],
  'Europe/Lisbon': ['PT', 'Portugal', 38.7, -9.1],
  'Europe/Madrid': ['ES', 'Spain', 40.4, -3.7],
  'Europe/Paris': ['FR', 'France', 48.9, 2.4],
  'Europe/Brussels': ['BE', 'Belgium', 50.8, 4.4],
  'Europe/Amsterdam': ['NL', 'the Netherlands', 52.4, 4.9],
  'Europe/Berlin': ['DE', 'Germany', 52.5, 13.4],
  'Europe/Zurich': ['CH', 'Switzerland', 47.4, 8.5],
  'Europe/Vienna': ['AT', 'Austria', 48.2, 16.4],
  'Europe/Rome': ['IT', 'Italy', 41.9, 12.5],
  'Europe/Prague': ['CZ', 'Czechia', 50.1, 14.4],
  'Europe/Warsaw': ['PL', 'Poland', 52.2, 21],
  'Europe/Budapest': ['HU', 'Hungary', 47.5, 19],
  'Europe/Copenhagen': ['DK', 'Denmark', 55.7, 12.6],
  'Europe/Stockholm': ['SE', 'Sweden', 59.3, 18.1],
  'Europe/Oslo': ['NO', 'Norway', 59.9, 10.8],
  'Europe/Helsinki': ['FI', 'Finland', 60.2, 24.9],
  'Europe/Athens': ['GR', 'Greece', 38, 23.7],
  'Europe/Bucharest': ['RO', 'Romania', 44.4, 26.1],
  'Europe/Kiev': ['UA', 'Ukraine', 50.5, 30.5],
  'Europe/Kyiv': ['UA', 'Ukraine', 50.5, 30.5],
  'Europe/Istanbul': ['TR', 'Turkey', 41, 29],
  'Europe/Moscow': ['RU', 'Russia', 55.8, 37.6],
  'Asia/Jerusalem': ['IL', 'Israel', 31.8, 35.2],
  'Asia/Tel_Aviv': ['IL', 'Israel', 32.1, 34.8],
  'Asia/Dubai': ['AE', 'the UAE', 25.2, 55.3],
  'Asia/Kolkata': ['IN', 'India', 19, 72.8],
  'Asia/Calcutta': ['IN', 'India', 19, 72.8],
  'Asia/Bangkok': ['TH', 'Thailand', 13.8, 100.5],
  'Asia/Singapore': ['SG', 'Singapore', 1.35, 103.8],
  'Asia/Jakarta': ['ID', 'Indonesia', -6.2, 106.8],
  'Asia/Manila': ['PH', 'the Philippines', 14.6, 121],
  'Asia/Hong_Kong': ['HK', 'Hong Kong', 22.3, 114.2],
  'Asia/Shanghai': ['CN', 'China', 31.2, 121.5],
  'Asia/Seoul': ['KR', 'South Korea', 37.6, 127],
  'Asia/Tokyo': ['JP', 'Japan', 35.7, 139.7],
  'Australia/Sydney': ['AU', 'Sydney', -33.9, 151.2],
  'Australia/Melbourne': ['AU', 'Melbourne', -37.8, 145],
  'Australia/Brisbane': ['AU', 'Brisbane', -27.5, 153],
  'Australia/Perth': ['AU', 'Perth', -31.9, 115.9],
  'Australia/Adelaide': ['AU', 'Adelaide', -34.9, 138.6],
  'Pacific/Auckland': ['NZ', 'New Zealand', -36.8, 174.8],
  'Africa/Johannesburg': ['ZA', 'South Africa', -26.2, 28],
  'Africa/Cairo': ['EG', 'Egypt', 30, 31.2],
  'Africa/Lagos': ['NG', 'Nigeria', 6.5, 3.4],
  'Africa/Nairobi': ['KE', 'Kenya', -1.3, 36.8],
  'Africa/Casablanca': ['MA', 'Morocco', 33.6, -7.6],
};

function countryName(cc) {
  if (!cc) return null;
  try {
    const n = new Intl.DisplayNames(['en'], { type: 'region' }).of(cc);
    return { US: 'the US', GB: 'the UK', AE: 'the UAE', NL: 'the Netherlands', PH: 'the Philippines', DO: 'the Dominican Republic' }[cc] || n;
  } catch {
    return cc;
  }
}

function device() {
  const ua = navigator.userAgent || '';
  const touch = (navigator.maxTouchPoints || 0) > 1;
  let os = null;
  if (/iPhone|iPod/.test(ua)) os = 'iOS';
  else if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch)) os = 'iPadOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  let kind = 'computer';
  if (os === 'iOS' || (os === 'Android' && /Mobile/.test(ua))) kind = 'phone';
  else if (os === 'iPadOS' || os === 'Android') kind = 'tablet';
  let browser = 'Chrome';
  if (/SamsungBrowser/.test(ua)) browser = 'Samsung Internet';
  else if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/DuckDuckGo/.test(ua)) browser = 'DuckDuckGo';
  else if (/Firefox|FxiOS/.test(ua)) browser = 'Firefox';
  else if (navigator.brave) browser = 'Brave';
  else if (/CriOS|Chrome/.test(ua)) browser = 'Chrome';
  else if (/Safari/.test(ua)) browser = 'Safari';
  const brand = os === 'iOS' || os === 'iPadOS' || os === 'macOS' ? 'Apple' : null;
  return { os, device: kind, browser, brand };
}

function brandFromModel(model) {
  const m = String(model || '');
  if (/^SM-|Galaxy/i.test(m)) return 'Samsung';
  if (/Pixel/i.test(m)) return 'Google Pixel';
  if (/moto/i.test(m)) return 'Motorola';
  if (/Redmi|POCO|Xiaomi|^M2\d|^2\d{3}/i.test(m)) return 'Xiaomi';
  if (/OnePlus|^CPH|^PH\d/i.test(m)) return /OnePlus/i.test(m) ? 'OnePlus' : 'OPPO';
  if (/HUAWEI|^[A-Z]{3}-L/i.test(m)) return 'Huawei';
  if (/Nokia/i.test(m)) return 'Nokia';
  if (/^LM-|LG/i.test(m)) return 'LG';
  return null;
}

/** The public address seen by a STUN server, as a fingerprint (same fingerprint = same network). */
function networkId() {
  return new Promise((resolve) => {
    let pc;
    try {
      pc = new RTCPeerConnection({ iceServers: ICE_SERVERS.filter((s) => String(s.urls).includes('stun:')) });
    } catch {
      return resolve(null);
    }
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      try {
        pc.close();
      } catch {
        /* ignore */
      }
      resolve(v);
    };
    pc.createDataChannel('x');
    pc.onicecandidate = (e) => {
      const c = e.candidate && e.candidate.candidate;
      const m = c && / ([0-9a-f.:]+) \d+ typ srflx/.exec(c);
      if (m) finish('n' + hash('aipsych-net|' + m[1]));
      else if (!e.candidate) finish(null);
    };
    pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => finish(null));
    setTimeout(() => finish(null), 6000);
  });
}

/** Rough location from the internet connection (city level), no permission needed. */
async function ipLocation() {
  if (!geoEnabled()) return null;
  const tries = [
    ['https://get.geojs.io/v1/ip/geo.json', (j) => ({ city: j.city, region: j.region, cc: j.country_code, lat: +j.latitude, lon: +j.longitude })],
    ['https://ipapi.co/json/', (j) => ({ city: j.city, region: j.region, cc: j.country_code, lat: +j.latitude, lon: +j.longitude })],
  ];
  for (const [url, map] of tries) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 4000);
      const r = await fetch(url, { signal: ctl.signal, credentials: 'omit' });
      clearTimeout(t);
      if (!r.ok) continue;
      const v = map(await r.json());
      if (v.cc) return v;
    } catch {
      /* blocked / offline: the time zone is enough */
    }
  }
  return null;
}

let cached = null;
const listeners = new Set();

function emit() {
  for (const fn of listeners) fn(cached);
}

/** Collect the clues (fast ones now, slow ones arrive later through onSignals). */
export function signals() {
  if (cached) return cached;
  const tz = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return null;
    }
  })();
  const t = TZ[tz];
  const langs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]).filter(Boolean).slice(0, 4);
  const d = device();
  cached = {
    tz,
    country: t ? t[0] : null,
    countryName: t ? countryName(t[0]) : null,
    area: t ? t[1] : tz ? tz.split('/').pop().replace(/_/g, ' ') : null,
    ll: t ? [t[2], t[3]] : null,
    langs,
    lang: langs[0] || null,
    langRegion: (langs[0] || '').split('-')[1] || null,
    ...d,
    dark: typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)').matches : null,
    installed: typeof matchMedia === 'function' ? matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || !!navigator.standalone : false,
    conn: (navigator.connection && navigator.connection.type) || null,
    cores: navigator.hardwareConcurrency || null,
    memory: navigator.deviceMemory || null,
  };
  if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
    navigator.userAgentData
      .getHighEntropyValues(['model'])
      .then((v) => {
        if (v.model) {
          cached.model = v.model;
          cached.brand = brandFromModel(v.model) || cached.brand;
          emit();
        }
      })
      .catch(() => {});
  } else {
    const m = /Android [\d.]+; ([^;)]+)[;)]/.exec(navigator.userAgent || '');
    if (m && m[1] !== 'K') {
      cached.model = m[1].trim();
      cached.brand = brandFromModel(cached.model) || cached.brand;
    }
  }
  if (cached.os === 'Android' && !cached.brand) cached.brand = 'Android';
  if (navigator.getBattery) {
    navigator
      .getBattery()
      .then((b) => {
        const upd = () => {
          cached.battery = { level: Math.round(b.level * 100), charging: b.charging, at: Date.now() };
          emit();
        };
        upd();
        b.addEventListener('levelchange', upd);
        b.addEventListener('chargingchange', upd);
      })
      .catch(() => {});
  }
  networkId().then((id) => {
    if (id) {
      cached.netId = id;
      emit();
    }
  });
  ipLocation().then((g) => {
    if (!g) return;
    if (g.cc) {
      cached.country = g.cc;
      cached.countryName = countryName(g.cc);
    }
    if (g.city) {
      cached.city = g.city;
      cached.precise = true;
      cached.area = g.region || cached.area;
    }
    if (Number.isFinite(g.lat) && Number.isFinite(g.lon)) cached.ll = [Math.round(g.lat * 10) / 10, Math.round(g.lon * 10) / 10];
    emit();
  });
  return cached;
}

export function onSignals(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------------------------------------------------------------------------
// How this player plays: leaving the app during a game

const away = { since: null };
let awayHook = null;

/** fn(ms) is called every time the player comes back after leaving the page. */
export function trackAway(fn) {
  awayHook = fn;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      away.since = Date.now();
    } else if (away.since) {
      const dt = Date.now() - away.since;
      away.since = null;
      if (dt < 1500) return; // a glance at the notification shade doesn't count
      awayHook && awayHook(dt);
    }
  });
}
