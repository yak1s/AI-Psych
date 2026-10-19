// A tiny MQTT 3.1.1 client over WebSocket, plus a multi-broker "Relay".
//
// Why: WebRTC needs a direct path (or a working TURN server) between devices.
// On some networks (VPNs, carrier-grade NAT, strict Wi-Fi) that path never opens.
// The relay sends the same (end-to-end encrypted) messages through public MQTT
// brokers over plain secure WebSockets, which pass almost everywhere. Several
// brokers are used at once and messages are de-duplicated, so one broker going
// down doesn't matter.

const enc = new TextEncoder();

function remLen(n) {
  const out = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 128;
    out.push(b);
  } while (n > 0);
  return out;
}

function str(s) {
  const b = enc.encode(s);
  return [b.length >> 8, b.length & 255, ...b];
}

function packet(type, body) {
  const head = [type, ...remLen(body.length)];
  const out = new Uint8Array(head.length + body.length);
  out.set(head, 0);
  out.set(body, head.length);
  return out;
}

function concat(...parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** One broker connection that reconnects forever and re-subscribes after each reconnect. */
export class MqttSocket {
  constructor(url, onPublish, onState) {
    this.url = url;
    this.onPublish = onPublish;
    this.onState = onState || (() => {});
    this.subs = new Set();
    this.up = false;
    this.closed = false;
    this.retry = 0;
    this.pid = 1;
    this.buf = new Uint8Array(0);
    this._open();
  }

  _open() {
    if (this.closed) return;
    let ws;
    try {
      ws = new WebSocket(this.url, ['mqtt']);
    } catch {
      return this._later();
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.buf = new Uint8Array(0);
    const timeout = setTimeout(() => ws.readyState !== 1 && ws.close(), 10000);
    ws.onopen = () => {
      clearTimeout(timeout);
      const id = 'aip' + Math.random().toString(36).slice(2, 14) + Date.now().toString(36).slice(-6);
      const body = [0, 4, 77, 81, 84, 84, 4, 2, 0, 30, ...str(id.slice(0, 23))];
      this._raw(packet(0x10, body));
    };
    ws.onmessage = (e) => this._data(new Uint8Array(e.data));
    ws.onclose = () => {
      clearTimeout(timeout);
      if (this.ws !== ws) return;
      this._down();
      this._later();
    };
    ws.onerror = () => {};
  }

  _down() {
    clearInterval(this.ping);
    if (this.up) {
      this.up = false;
      this.onState(false);
    }
  }

  _later() {
    if (this.closed) return;
    const delay = [500, 1000, 2000, 4000, 8000][Math.min(this.retry++, 4)] + Math.random() * 500;
    setTimeout(() => this._open(), delay);
  }

  _raw(bytes) {
    try {
      if (this.ws && this.ws.readyState === 1) {
        this.ws.send(bytes);
        return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  }

  _data(chunk) {
    this.buf = this.buf.length ? concat(this.buf, chunk) : chunk;
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      let len = 0;
      let mult = 1;
      let i = 1;
      let byte;
      do {
        if (i >= b.length) return;
        byte = b[i++];
        len += (byte & 127) * mult;
        mult *= 128;
      } while (byte & 128);
      if (b.length < i + len) return;
      const type = b[0] >> 4;
      const flags = b[0] & 15;
      const body = b.subarray(i, i + len);
      this.buf = b.subarray(i + len);
      this._packet(type, flags, body);
    }
  }

  _packet(type, flags, body) {
    if (type === 2) {
      // CONNACK
      if (body[1] !== 0) return this.ws.close();
      this.retry = 0;
      this.up = true;
      for (const t of this.subs) this._sub(t);
      clearInterval(this.ping);
      this.ping = setInterval(() => this._raw(new Uint8Array([0xc0, 0])), 20000);
      this.onState(true);
    } else if (type === 3) {
      // PUBLISH
      const tl = (body[0] << 8) | body[1];
      const topic = new TextDecoder().decode(body.subarray(2, 2 + tl));
      let o = 2 + tl;
      if ((flags >> 1) & 3) o += 2; // packet id for QoS>0
      this.onPublish(topic, body.slice(o));
    }
  }

  _sub(topic) {
    const id = this.pid++ & 0xffff || 1;
    this._raw(packet(0x82, [id >> 8, id & 255, ...str(topic), 0]));
  }

  subscribe(topic) {
    if (this.subs.has(topic)) return;
    this.subs.add(topic);
    if (this.up) this._sub(topic);
  }

  unsubscribe(topic) {
    if (!this.subs.delete(topic) || !this.up) return;
    const id = this.pid++ & 0xffff || 1;
    this._raw(packet(0xa2, [id >> 8, id & 255, ...str(topic)]));
  }

  publish(topic, payload) {
    if (!this.up) return false;
    return this._raw(packet(0x30, concat(new Uint8Array(str(topic)), payload)));
  }

  close() {
    this.closed = true;
    this._down();
    try {
      this.ws && this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Fan-out over several brokers: subscribe/publish on all of them, drop duplicates.
 * Wire format: [kind:1][id:8][body]  (kind 0 = plain handshake JSON, 1 = sealed)
 */
export class Relay {
  constructor(urls, onMessage, onState) {
    this.onMessage = onMessage;
    this.onState = onState || (() => {});
    this.seen = new Set();
    this.order = [];
    this.sockets = urls.map(
      (u) =>
        new MqttSocket(
          u,
          (topic, bytes) => this._in(topic, bytes),
          () => this.onState(this.up),
        ),
    );
  }

  get up() {
    return this.sockets.some((s) => s.up);
  }

  _in(topic, bytes) {
    if (bytes.length < 9) return;
    const id = Array.from(bytes.subarray(1, 9), (x) => x.toString(16).padStart(2, '0')).join('');
    if (this.seen.has(id)) return;
    this.seen.add(id);
    this.order.push(id);
    if (this.order.length > 2000) this.seen.delete(this.order.shift());
    this.onMessage(topic, bytes[0], bytes.subarray(9));
  }

  subscribe(topic) {
    for (const s of this.sockets) s.subscribe(topic);
  }

  unsubscribe(topic) {
    for (const s of this.sockets) s.unsubscribe(topic);
  }

  publish(topic, kind, body) {
    const id = crypto.getRandomValues(new Uint8Array(8));
    const bytes = concat(new Uint8Array([kind]), id, body);
    let ok = false;
    for (const s of this.sockets) ok = s.publish(topic, bytes) || ok;
    return ok;
  }

  close() {
    for (const s of this.sockets) s.close();
  }
}
