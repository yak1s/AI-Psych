// Test harness: serves the app, runs a private PeerJS signaling server and
// drives several independent browsers (each one is a separate "device").
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium, firefox } from 'playwright';
import { PeerServer } from 'peer';
import { Aedes } from 'aedes';
import { WebSocketServer, createWebSocketStream } from 'ws';

const ROOT = new URL('../..', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.csv': 'text/csv' };

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

export async function startWorld() {
  const http = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = join(ROOT, path.endsWith('/') ? path + 'index.html' : path);
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  const httpPort = await listen(http);
  const signal = await startSignal();
  const broker = await startBroker();
  // BROWSER=firefox runs the whole suite in Firefox (CI runs both).
  const browser =
    process.env.BROWSER === 'firefox'
      ? await firefox.launch({
          firefoxUserPrefs: {
            // let two test windows on one machine reach each other directly (real devices don't need this)
            'media.peerconnection.ice.obfuscate_host_addresses': false,
            'media.peerconnection.ice.loopback': true,
            'media.navigator.permission.disabled': true,
          },
        })
      : await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];
  const world = {
    browser,
    errors,
    signal,
    base: `http://127.0.0.1:${httpPort}/`,
    broker,
    /** extra: e.g. 'rtc=off' to simulate a network where WebRTC can't connect (VPN, strict NAT). */
    query: (extra = '') => `signal=http://127.0.0.1:${world.signal.port}/&ice=none&nosw=1&geo=off&relay=ws://127.0.0.1:${broker.port}${extra ? '&' + extra : ''}`,
    async device(name, { width = 420, height = 860, scale = 1, userAgent, context } = {}) {
      const ctx = context || (await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, ...(userAgent ? { userAgent } : {}) }));
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
      // (a dropped connection to the test servers is expected in the outage tests — Chrome and Firefox word it differently)
      page.on('console', (m) => m.type() === 'error' && !/WebSocket connection|ERR_CONNECTION_REFUSED|can.t establish a connection/.test(m.text()) && errors.push(`[${name}] ${m.text()}`));
      page.logs = [];
      page.on('console', (m) => {
        page.logs.push(`${m.type()}: ${m.text()}`.slice(0, 300));
        if (page.logs.length > 40) page.logs.shift();
      });
      page.on('pageerror', (e) => page.logs.push('pageerror: ' + e.message));
      world.pages.push(page);
      page.name = name;
      return page;
    },
    pages: [],
    /** When a test fails: print what every open device was doing (shows up in the CI log). */
    async dump(label) {
      console.log(`\n===== state of every device (${label}) =====`);
      for (const p of world.pages) {
        if (p.isClosed()) continue;
        let st;
        try {
          st = await p.evaluate(() => {
            const c = window.__aipsych && window.__aipsych.current;
            if (!c) return { noController: true, body: document.body.innerText.slice(0, 200) };
            const v = c.view;
            const g = v && v.game;
            return {
              host: !!c.isHost, status: c.status, welcomed: c.welcomed, transport: c.transport, pending: c.pending && c.pending.map((x) => x.a.type),
              ended: c.ended, phase: g && g.phase, idx: g && g.idx, q: g && g.q && g.q.key,
              answered: g && g.answered, voted: g && g.voted, voters: g && g.voters, myVote: g && g.myVote, ready: g && g.ready,
              online: c.isHost ? c.net.onlinePids() : undefined,
              testids: [...document.querySelectorAll('[data-testid]')].map((e) => e.dataset.testid).slice(0, 25).join(','),
            };
          });
        } catch (e) {
          st = { evalError: e.message };
        }
        console.log(`--- ${p.name}: ${JSON.stringify(st)}`);
        for (const l of p.logs.slice(-12)) console.log(`    ${l}`);
      }
    },
    async restartSignal(downMs = 0) {
      await world.signal.close();
      if (downMs) await sleep(downMs);
      world.signal = await startSignal(world.signal.port);
    },
    async close() {
      await browser.close();
      await world.signal.close();
      await broker.close();
      http.close();
    },
  };
  return world;
}

async function startSignal(port = 0) {
  if (!port) {
    const probe = createServer();
    port = await listen(probe);
    await new Promise((r) => probe.close(r));
  }
  // PeerServer hands the underlying http server to its callback.
  const server = await new Promise((resolve) => PeerServer({ port, host: '127.0.0.1', path: '/' }, (srv) => resolve(srv)));
  const sockets = new Set();
  server.on('connection', (sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
  });
  return {
    port,
    // Hard stop: drop every client (including upgraded websockets), like a crash.
    close: () =>
      new Promise((r) => {
        for (const sock of sockets) sock.destroy();
        server.close(() => r());
        setTimeout(r, 500);
      }),
  };
}

/** A local MQTT-over-WebSocket broker standing in for the public relay brokers. */
async function startBroker() {
  const aedes = await Aedes.createBroker();
  const server = createServer();
  const wss = new WebSocketServer({ server, handleProtocols: (p) => (p.has('mqtt') ? 'mqtt' : false) });
  wss.on('connection', (ws) => aedes.handle(createWebSocketStream(ws)));
  const port = await listen(server);
  return {
    port,
    close: () =>
      new Promise((r) => {
        for (const c of wss.clients) c.terminate();
        aedes.close(() => server.close(() => r()));
        setTimeout(r, 500);
      }),
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function until(fn, ms = 30000, step = 150) {
  const start = Date.now();
  let last;
  while (Date.now() - start < ms) {
    try {
      last = await fn();
      if (last) return last;
    } catch {
      /* page may be mid-reload */
    }
    await sleep(step);
  }
  throw new Error('Timed out waiting for condition (last value: ' + JSON.stringify(last) + ')');
}

/** Click without waiting for bouncy animations to settle. */
/** Wait until an element has stopped moving (pop-in / deal animations), like a person would. */
export async function settled(locator) {
  await locator.waitFor({ state: 'visible', timeout: 20000 });
  let last = null;
  for (let i = 0; i < 30; i++) {
    const b = await locator.boundingBox().catch(() => null);
    const key = b && [b.x, b.y, b.width, b.height].map(Math.round).join(',');
    if (key && key === last) return;
    last = key;
    await sleep(80);
  }
}

/**
 * Click like a person: Playwright's careful click first (it notices when something covers the
 * button — e.g. Firefox scrolls it under the host's fixed toolbar — and scrolls again). Buttons
 * that pulse forever never count as "stable", so those fall back to a forced click once they sit still.
 */
export async function press(locator) {
  await settled(locator);
  try {
    await locator.click({ timeout: 4000 });
  } catch {
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    await locator.evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
    await locator.click({ force: true });
  }
}

export const tap = (page, testid) => press(page.getByTestId(testid));

/** Read the live controller state of a device. `fn` runs in the page, so it can't use outer variables. */
export const state = (page, fn) => page.evaluate(`(() => { const c = window.__aipsych && window.__aipsych.current; return (${fn})(c); })()`);

export async function hostRoom(world, name = 'Hosty', opts = {}) {
  const host = await world.device('host', opts);
  await host.goto(world.base + '?' + world.query(opts.net));
  await tap(host, 'host-btn');
  await host.getByTestId('name-input').fill(name);
  await tap(host, 'create-room');
  await host.getByTestId('room-code').waitFor();
  await until(() => state(host, (c) => c.status === 'online'));
  const code = (await host.getByTestId('room-code').getAttribute('aria-label')).replace(/\D/g, '');
  return { host, code };
}

export async function joinRoom(world, code, name, opts = {}) {
  const p = await world.device(name, opts);
  await p.goto(world.base + `?room=${code}&` + world.query(opts.net));
  await p.getByTestId('name-input').fill(name);
  await tap(p, 'join-go');
  // Mid-game joins (and taking back a seat) wait for the host's OK.
  if (opts.admitBy) {
    await opts.admitBy.getByTestId('admit').waitFor({ timeout: 20000 });
    await tap(opts.admitBy, 'admit');
  }
  await until(() => state(p, (c) => c && c.welcomed && !!c.view), 20000);
  return p;
}

export const onlineCount = (host) => state(host, (c) => c.net.onlinePids().length);

/** Answer (if asked), then vote for the first allowed option. */
export async function answerAll(devices, text = (p) => `${p.name}'s answer`) {
  for (const p of devices) await p.getByTestId('answer-form').or(p.getByTestId('answer-waiting')).first().waitFor({ timeout: 20000 });
  for (const p of devices) {
    if (await p.getByTestId('answer-input').count()) {
      await p.getByTestId('answer-input').fill(text(p));
      await tap(p, 'submit-answer');
    }
  }
}

export async function voteAll(devices) {
  for (const p of devices) await p.getByTestId('vote-phase').waitFor({ timeout: 20000 });
  for (const p of devices) {
    const canVote = await state(p, (c) => c.view.game.voters.includes(c.view.me));
    if (!canVote) continue;
    const opt = p.getByTestId('option').first();
    await opt.waitFor({ timeout: 15000 });
    await press(opt);
    await tap(p, 'lock-vote');
  }
  for (const p of devices) await p.getByTestId('results-phase').waitFor({ timeout: 20000 });
}
