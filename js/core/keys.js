// Key hierarchy (General System Plan 5.1 to 5.3, plus Addendum B).
// password --PBKDF2--> master --HKDF--> auth secret (sent to Supabase) | KEK (stays here)
// KEK wraps the DEK; the recovery key and the PIN each wrap the same DEK independently.

import {
  CryptoError, DEFAULT_KDF, b64decode, b64encode, b64urlencode, generateDek, hkdfBits, hkdfWrapKey,
  pbkdf2ToHkdfKey, randomBytes, rawToHkdfKey, unwrapDek, utf8, wrapDek,
} from './crypto.js';

export const DEFAULT_PIN_ITERATIONS = 600000;
const AAD_DEK = 'apex/wrap/dek/v1';
const AAD_RDEK = 'apex/wrap/recovery-dek/v1';
const AAD_PDEK = 'apex/wrap/pin-dek/v1';
const subtle = globalThis.crypto.subtle;

export function normalizeEmail(email) { return email.normalize('NFKC').trim().toLowerCase(); }

// The salt must be known BEFORE login (the profile row is unreadable until
// authenticated), so it is derived from the email rather than random.
async function emailSalt(email) {
  return new Uint8Array(await subtle.digest('SHA-256', utf8('apex-kdf-salt-v1:' + normalizeEmail(email))));
}

// ---------- password: auth secret + KEK ----------
export async function deriveLoginSecrets(password, email, params = DEFAULT_KDF) {
  const salt = await emailSalt(email);
  const master = await pbkdf2ToHkdfKey(utf8(password.normalize('NFKC')), salt, params.iterations);
  const authSecret = b64urlencode(await hkdfBits(master, 'apex/auth/v1'));
  const kek = await hkdfWrapKey(master, 'apex/kek/v1');
  return { authSecret, kek, kdf_params: { ...params }, kdf_salt: b64encode(salt) };
}

export function unwrapDekWithKek(kek, wrappedDek) { return unwrapDek(kek, wrappedDek, AAD_DEK); }

export async function unlockWithPassword(password, email, profile) {
  const s = await deriveLoginSecrets(password, email, profile.kdf_params);
  return { dek: await unwrapDekWithKek(s.kek, profile.wrapped_dek), authSecret: s.authSecret };
}

// ---------- signup ----------
export async function createAccountKeys(password, email, params = DEFAULT_KDF) {
  const s = await deriveLoginSecrets(password, email, params);
  const dek = await generateDek();
  const recoveryBytes = randomBytes(32);
  const recKek = await recoveryWrapKey(recoveryBytes);
  return {
    authSecret: s.authSecret,
    dek,
    recoveryKey: await formatRecoveryKey(recoveryBytes), // show once; never store
    profileKeys: {
      kdf_params: s.kdf_params,
      kdf_salt: s.kdf_salt,
      wrapped_dek: await wrapDek(s.kek, dek, AAD_DEK),
      recovery_wrapped_dek: await wrapDek(recKek, dek, AAD_RDEK),
    },
  };
}

// ---------- change password (while unlocked) or finish recovery ----------
export async function changePassword(dek, newPassword, email, params = DEFAULT_KDF) {
  const s = await deriveLoginSecrets(newPassword, email, params);
  return {
    authSecret: s.authSecret,
    profileKeys: { kdf_params: s.kdf_params, kdf_salt: s.kdf_salt, wrapped_dek: await wrapDek(s.kek, dek, AAD_DEK) },
  };
}

// ---------- recovery key ----------
const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32 (no I, L, O, U)

function b32encode(bytes) {
  let bits = 0, val = 0, out = '';
  for (const b of bytes) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += ALPHA[(val >>> (bits - 5)) & 31]; bits -= 5; }
    val &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHA[(val << (5 - bits)) & 31];
  return out;
}
function b32decode(str) { // returns bytes, requires zero padding bits
  let bits = 0, val = 0; const out = [];
  for (const ch of str) {
    const i = ALPHA.indexOf(ch);
    if (i < 0) throw new CryptoError('RECOVERY_KEY_FORMAT', 'Invalid character in recovery key');
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; val &= (1 << bits) - 1; }
  }
  if (val !== 0) throw new CryptoError('RECOVERY_KEY_FORMAT', 'Invalid recovery key');
  return new Uint8Array(out);
}
async function checksum(keyBytes) {
  const h = new Uint8Array(await subtle.digest('SHA-256', keyBytes));
  const n = ((h[0] << 16) | (h[1] << 8) | h[2]) >>> 4; // 20 bits
  return [3, 2, 1, 0].map((i) => ALPHA[(n >>> (5 * i)) & 31]).join('');
}

export async function formatRecoveryKey(bytes) {
  const raw = b32encode(bytes) + await checksum(bytes); // 52 + 4 chars
  return raw.match(/.{4}/g).join('-');
}

// Accepts any case, spaces or hyphens; fixes the usual look-alikes (O->0, I/L->1).
export async function parseRecoveryKey(input) {
  const s = String(input).toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== 56) throw new CryptoError('RECOVERY_KEY_FORMAT', 'Recovery key has the wrong length');
  const bytes = b32decode(s.slice(0, 52));
  if (bytes.length !== 32 || s.slice(52) !== await checksum(bytes)) {
    throw new CryptoError('RECOVERY_KEY_CHECKSUM', 'Recovery key has a typo');
  }
  return bytes;
}
async function recoveryWrapKey(bytes) { return hkdfWrapKey(await rawToHkdfKey(bytes), 'apex/recovery-kek/v1'); }

export async function recoverWithKey(recoveryKeyText, recoveryWrappedDek) {
  const kek = await recoveryWrapKey(await parseRecoveryKey(recoveryKeyText));
  return unwrapDek(kek, recoveryWrappedDek, AAD_RDEK);
}
// For the periodic "check your recovery key" prompt (Addendum A.2).
export async function checkRecoveryKey(recoveryKeyText, recoveryWrappedDek) {
  try { await recoverWithKey(recoveryKeyText, recoveryWrappedDek); return true; } catch { return false; }
}
export async function rotateRecoveryKey(dek) {
  const bytes = randomBytes(32);
  return {
    recoveryKey: await formatRecoveryKey(bytes),
    recovery_wrapped_dek: await wrapDek(await recoveryWrapKey(bytes), dek, AAD_RDEK),
  };
}

// ---------- PIN (local convenience lock; stored in IndexedDB by lock.js) ----------
async function pinWrapKey(pin, salt, iterations) {
  if (!/^\d{4}$/.test(pin)) throw new CryptoError('PIN_FORMAT', 'PIN must be 4 digits');
  return hkdfWrapKey(await pbkdf2ToHkdfKey(utf8(pin), salt, iterations), 'apex/pin/v1');
}
export async function wrapDekWithPin(dek, pin, iterations = DEFAULT_PIN_ITERATIONS) {
  const salt = randomBytes(16);
  return { v: 1, iterations, salt: b64encode(salt), wrapped: await wrapDek(await pinWrapKey(pin, salt, iterations), dek, AAD_PDEK) };
}
export async function unwrapDekWithPin(pin, blob) {
  return unwrapDek(await pinWrapKey(pin, b64decode(blob.salt), blob.iterations), blob.wrapped, AAD_PDEK);
}
