// Encrypts and decrypts one uploaded file. The file is sealed on this device with the account's data key (AES-GCM,
// a fresh random IV every time) BEFORE it leaves the device, so the server and the storage bucket only ever hold
// unreadable bytes. The associated data binds each file to its owner and its record id, so a file copied under
// another name or another account fails to open instead of showing the wrong thing.
import { CryptoError, concat, randomBytes, utf8 } from './crypto.js';

const { subtle } = globalThis.crypto;
const aad = (userId, docId) => utf8(`apex/doc/v1|${userId}|${docId}`);

// bytes: Uint8Array -> Uint8Array of (12-byte IV + ciphertext + 16-byte tag)
export async function encryptFile(dek, userId, docId, bytes) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(userId, docId) }, dek, bytes));
  return concat(iv, ct);
}

export async function decryptFile(dek, userId, docId, sealed) {
  try {
    const all = sealed instanceof Uint8Array ? sealed : new Uint8Array(sealed);
    if (all.length < 12 + 16) throw new Error('too short');
    return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: all.subarray(0, 12), additionalData: aad(userId, docId) }, dek, all.subarray(12)));
  } catch {
    throw new CryptoError('DECRYPT_FAILED', 'This file could not be opened: it is damaged or does not belong to this account.');
  }
}
