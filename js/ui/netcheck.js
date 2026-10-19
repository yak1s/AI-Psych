// "Test my connection": checks every piece the game relies on, from this device
// and this network, and gives a plain-language verdict. Run it from each country
// / network before game night.

import { html, useState, useEffect } from '../vendor/preact-htm.js';
import { Btn, Doodle } from './common.js';
import { Peer } from '../vendor/peer.js';
import { peerOptions, relayBrokers, APP_ID } from '../config.js';
import { MqttSocket } from '../net/mqtt.js';
import { uid } from '../game/util.js';

const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r({ ok: false, note: 'timed out' }), ms))]);

function checkSignaling() {
  return withTimeout(
    new Promise((resolve) => {
      let peer;
      try {
        peer = new Peer(`${APP_ID}-check-${uid(10)}`, peerOptions());
      } catch (e) {
        return resolve({ ok: false, note: 'WebRTC not supported in this browser' });
      }
      const t0 = performance.now();
      peer.on('open', () => {
        resolve({ ok: true, note: `${Math.round(performance.now() - t0)} ms` });
        peer.destroy();
      });
      peer.on('error', (e) => {
        resolve({ ok: false, note: e.type || 'error' });
        peer.destroy();
      });
    }),
    12000,
  );
}

/** Which kinds of ICE candidates can this network produce? */
function checkIce() {
  return withTimeout(
    new Promise((resolve) => {
      let pc;
      try {
        pc = new RTCPeerConnection(peerOptions().config);
      } catch {
        return resolve({ ok: false, note: 'WebRTC not supported', kinds: {} });
      }
      const kinds = {};
      pc.createDataChannel('x');
      pc.onicecandidate = (e) => {
        if (!e.candidate) {
          pc.close();
          resolve({ ok: !!(kinds.srflx || kinds.relay), kinds });
          return;
        }
        const m = / typ (\w+)/.exec(e.candidate.candidate);
        if (m) kinds[m[1]] = true;
      };
      pc.createOffer().then((o) => pc.setLocalDescription(o));
      setTimeout(() => {
        try {
          pc.close();
        } catch {
          /* ignore */
        }
        resolve({ ok: !!(kinds.srflx || kinds.relay), kinds });
      }, 9000);
    }),
    10000,
  );
}

/** Connect to one broker and bounce a message off it. */
function checkBroker(url) {
  return withTimeout(
    new Promise((resolve) => {
      const topic = `aipsych/check/${uid(12)}`;
      const t0 = performance.now();
      const sock = new MqttSocket(
        url,
        () => {
          resolve({ ok: true, note: `${Math.round(performance.now() - t0)} ms round trip` });
          sock.close();
        },
        (up) => {
          if (!up) return;
          sock.subscribe(topic);
          setTimeout(() => sock.publish(topic, new Uint8Array([1, 2, 3])), 300);
        },
      );
      setTimeout(() => sock.close(), 9500);
    }),
    10000,
  );
}

function Row({ label, r, hint }) {
  const icon = !r ? '⏳' : r.ok ? '✅' : '❌';
  return html`<div class="check-row">
    <span class="check-icon">${icon}</span>
    <div style="min-width:0"><b>${label}</b>${r && r.note ? html` <span class="muted small">— ${r.note}</span>` : null}
      ${hint && html`<div class="muted small">${hint}</div>`}</div>
  </div>`;
}

export function NetCheck({ onClose }) {
  const brokers = relayBrokers();
  const [sig, setSig] = useState(null);
  const [ice, setIce] = useState(null);
  const [rel, setRel] = useState(brokers.map(() => null));
  const [run, setRun] = useState(0);
  useEffect(() => {
    setSig(null);
    setIce(null);
    setRel(brokers.map(() => null));
    checkSignaling().then(setSig);
    checkIce().then(setIce);
    brokers.forEach((u, i) => checkBroker(u).then((r) => setRel((x) => x.map((v, j) => (j === i ? r : v)))));
  }, [run]);
  const done = sig && ice && rel.every(Boolean);
  const relayOk = rel.filter((r) => r && r.ok).length;
  const directOk = sig && sig.ok && ice && ice.ok;
  let verdict = null;
  if (done) {
    if (relayOk && directOk) verdict = ['🎉', 'You’re all set!', `Direct connections should work, and ${relayOk} backup relay${relayOk > 1 ? 's are' : ' is'} ready if they don't.`];
    else if (relayOk) verdict = ['👍', 'You can play.', 'Direct peer-to-peer looks blocked on this network, but the encrypted relay works — the game will use it automatically.'];
    else if (directOk) verdict = ['⚠️', 'Probably OK.', 'Direct connections work, but no relay is reachable from this network. If someone far away can’t connect, try mobile data or a different Wi-Fi.'];
    else verdict = ['😟', 'This network is blocking the game.', 'Try switching between Wi-Fi and mobile data, or turn off a VPN, then test again.'];
  }
  const k = (ice && ice.kinds) || {};
  return html`<div class="screen enter"><div class="stack">
    <h1 class="center" style="font-size:32px">📡 Connection check</h1>
    <p class="center muted" style="margin:0">Run this on each phone before game night — from every country and network you'll play on.</p>
    <div class="card stack" style="gap:12px" data-testid="netcheck">
      <${Row} label="Room finder (signaling server)" r=${sig} />
      <${Row} label="Direct peer-to-peer" r=${ice && { ok: ice.ok, note: ice.kinds ? [k.host && 'local', k.srflx && 'public address', k.relay && 'TURN'].filter(Boolean).join(' + ') || 'nothing found' : ice.note }}
        hint=${ice && !k.relay ? 'No TURN relay reachable — far-away direct connections may fail; the backup relay covers that.' : null} />
      ${brokers.map((u, i) => html`<${Row} key=${u} label=${`Backup relay ${i + 1} (${new URL(u).hostname})`} r=${rel[i]} />`)}
    </div>
    ${verdict
      ? html`<div class="card center" data-testid="netcheck-verdict"><div style="font-size:54px">${verdict[0]}</div><h2>${verdict[1]}</h2><p style="margin:6px 0 0">${verdict[2]}</p></div>`
      : html`<p class="quip">Testing<span class="dots"></span></p>`}
    <div class="row center">
      <${Btn} color="paper" sound="tap" onClick=${onClose}>${Doodle.back({ size: 22 })} Back<//>
      <${Btn} color="sky" disabled=${!done} onClick=${() => setRun(run + 1)}>Test again<//>
    </div>
  </div></div>`;
}
