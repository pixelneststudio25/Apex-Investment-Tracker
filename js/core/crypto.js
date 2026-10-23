// Low-level primitives (Web Crypto only, no dependencies). Never logs secrets.

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = globalThis.crypto.subtle;

export class CryptoError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

export const DEFAULT_KDF = Object.freeze({ v: 1, alg: 'PBKDF2-SHA256', iterations: 600000 });
const HKDF_SALT = enc.encode('apex-hkdf-v1');

// ---------- encoding helpers ----------
export function utf8(s) { return enc.encode(s); }
export function fromUtf8(b) { return dec.decode(b); }

export function b64encode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64decode(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
export function b64urlencode(bytes) {
  return b64encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function randomBytes(n) { return globalThis.crypto.getRandomValues(new Uint8Array(n)); }
export function concat(...arrs) {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

// ---------- key derivation ----------
// secretBytes -> PBKDF2-SHA256 -> 256-bit master, imported as an HKDF key.
export async function pbkdf2ToHkdfKey(secretBytes, salt, iterations) {
  const base = await subtle.importKey('raw', secretBytes, 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256);
  return subtle.importKey('raw', bits, 'HKDF', false, ['deriveBits', 'deriveKey']);
}
export function rawToHkdfKey(bytes) {
  return subtle.importKey('raw', bytes, 'HKDF', false, ['deriveBits', 'deriveKey']);
}
export async function hkdfBits(hkdfKey, info, length = 256) {
  return new Uint8Array(await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: enc.encode(info) }, hkdfKey, length));
}
// Non-extractable AES-GCM key used only to wrap/unwrap the DEK.
export function hkdfWrapKey(hkdfKey, info) {
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: enc.encode(info) },
    hkdfKey, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}

// ---------- DEK ----------
// The DEK is extractable on purpose: it must be re-wrapped on password change,
// PIN setup and recovery-key rotation. It only ever lives in memory.
export function generateDek() {
  return subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}
export async function wrapDek(wrapKey, dek, aad) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle.wrapKey('raw', dek, wrapKey,
    { name: 'AES-GCM', iv, additionalData: enc.encode(aad) }));
  return b64encode(concat(iv, ct));
}
export async function unwrapDek(wrapKey, wrappedB64, aad) {
  try {
    const all = b64decode(wrappedB64);
    return await subtle.unwrapKey('raw', all.subarray(12), wrapKey,
      { name: 'AES-GCM', iv: all.subarray(0, 12), additionalData: enc.encode(aad) },
      { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  } catch {
    throw new CryptoError('WRONG_KEY_OR_CORRUPT', 'Could not unlock: wrong key or damaged data');
  }
}

// ---------- records (AES-GCM, fresh 96-bit IV, AAD binds owner + record id) ----------
const recordAad = (userId, recordId) => `apex/record/v1|${userId}|${recordId}`;

export async function encryptRecord(dek, userId, recordId, obj) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(recordAad(userId, recordId)) },
    dek, enc.encode(JSON.stringify(obj))));
  return b64encode(concat(iv, ct)); // base64(iv + ciphertext)
}
export async function decryptRecord(dek, userId, recordId, payloadB64) {
  try {
    const all = b64decode(payloadB64);
    const pt = await subtle.decrypt(
      { name: 'AES-GCM', iv: all.subarray(0, 12), additionalData: enc.encode(recordAad(userId, recordId)) },
      dek, all.subarray(12));
    return JSON.parse(dec.decode(pt));
  } catch {
    throw new CryptoError('DECRYPT_FAILED', 'Record failed authentication');
  }
}
