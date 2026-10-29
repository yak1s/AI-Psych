// End-to-end encryption for the relay path: an ECDH (P-256) handshake per player
// connection, then AES-GCM for every message. The public brokers only ever see
// random-looking bytes.

const subtle = () => globalThis.crypto && globalThis.crypto.subtle;

export const cryptoReady = () => !!subtle();

export async function newKeyPair() {
  return subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
}

export async function exportPublic(kp) {
  const raw = new Uint8Array(await subtle().exportKey('raw', kp.publicKey));
  return btoa(String.fromCharCode(...raw));
}

export async function deriveShared(kp, peerPublicB64) {
  const raw = Uint8Array.from(atob(peerPublicB64), (c) => c.charCodeAt(0));
  const pub = await subtle().importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  return subtle().deriveKey({ name: 'ECDH', public: pub }, kp.privateKey, { name: 'AES-GCM', length: 128 }, false, ['encrypt', 'decrypt']);
}

const te = new TextEncoder();
const td = new TextDecoder();

export async function seal(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(obj))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0);
  out.set(ct, 12);
  return out;
}

export async function unseal(key, bytes) {
  const plain = await subtle().decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12));
  return JSON.parse(td.decode(plain));
}

export const plain = (obj) => te.encode(JSON.stringify(obj));
export const unplain = (bytes) => JSON.parse(td.decode(bytes));

// Compressed JSON (for the host's backups): gzip + base64 where the browser supports it.
const b64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

export async function pack(obj) {
  const json = JSON.stringify(obj);
  if (typeof CompressionStream === 'undefined') return { raw: json };
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
  return { gz: b64(new Uint8Array(await new Response(stream).arrayBuffer())) };
}

export async function unpack(p) {
  if (!p) return null;
  if (typeof p.raw === 'string') return JSON.parse(p.raw);
  const bytes = Uint8Array.from(atob(p.gz), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}
