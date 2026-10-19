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
