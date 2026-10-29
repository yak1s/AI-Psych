// Test harness: serves the app, runs a private PeerJS signaling server and
// drives several independent browsers (each one is a separate "device").
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';
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
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];
  const world = {
    browser,
    errors,
    signal,
    base: `http://127.0.0.1:${httpPort}/`,
    broker,
    /** extra: e.g. 'rtc=off' to simulate a network where WebRTC can't connect (VPN, strict NAT). */
    query: (extra = '') => `signal=http://127.0.0.1:${world.signal.port}/&ice=none&nosw=1&geo=off&relay=ws://127.0.0.1:${broker.port}${extra ? '&' + extra : ''}`,
    async device(name, { width = 420, height = 860, scale = 1, context } = {}) {
      const ctx = context || (await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale }));
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
      page.on('console', (m) => m.type() === 'error' && !/WebSocket connection|ERR_CONNECTION_REFUSED/.test(m.text()) && errors.push(`[${name}] ${m.text()}`));
      page.name = name;
      return page;
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
export const tap = (page, testid) => page.getByTestId(testid).click({ force: true });

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
    await opt.click({ force: true });
    await tap(p, 'lock-vote');
  }
  for (const p of devices) await p.getByTestId('results-phase').waitFor({ timeout: 20000 });
}
