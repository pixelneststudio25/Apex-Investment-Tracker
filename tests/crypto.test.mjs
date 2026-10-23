// Shared by Node (tests/run-node.mjs) and the browser (tests/index.html).
import {
  DEFAULT_KDF, b64decode, b64encode, decryptRecord, encryptRecord, generateDek,
} from '../js/core/crypto.js';
import {
  changePassword, checkRecoveryKey, createAccountKeys, deriveLoginSecrets, formatRecoveryKey,
  parseRecoveryKey, recoverWithKey, rotateRecoveryKey, unlockWithPassword, unwrapDekWithKek,
  unwrapDekWithPin, wrapDekWithPin,
} from '../js/core/keys.js';

const FAST = { v: 1, alg: 'PBKDF2-SHA256', iterations: 1000 }; // tests only; real default is 600,000
const PIN_FAST = 1000;
const EMAIL = 'tunde@example.com', PW = 'correct horse battery staple', USER = 'user-1', REC = 'rec-1';
const SAMPLE = { kind: 'investment', name: 'Land at Lekki ₦', amountKobo: 1245000000 };

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
async function rejects(p, code) {
  try { await p; } catch (e) { if (!code || e.code === code) return; throw new Error(`wrong error: ${e.code || e.message}`); }
  throw new Error('expected failure but it succeeded');
}
const sameKey = async (dekA, dekB) => {
  const p = await encryptRecord(dekA, USER, REC, SAMPLE);
  return JSON.stringify(await decryptRecord(dekB, USER, REC, p)) === JSON.stringify(SAMPLE);
};
const flip = (b64) => { const b = b64decode(b64); b[b.length - 1] ^= 1; return b64encode(b); };

test('records: round-trip including ₦ and unicode', async () => {
  const dek = await generateDek();
  const back = await decryptRecord(dek, USER, REC, await encryptRecord(dek, USER, REC, SAMPLE));
  ok(JSON.stringify(back) === JSON.stringify(SAMPLE));
});
test('records: fresh IV each time (same input, different ciphertext)', async () => {
  const dek = await generateDek();
  ok(await encryptRecord(dek, USER, REC, SAMPLE) !== await encryptRecord(dek, USER, REC, SAMPLE));
});
test('records: tampered ciphertext fails', async () => {
  const dek = await generateDek();
  await rejects(decryptRecord(dek, USER, REC, flip(await encryptRecord(dek, USER, REC, SAMPLE))), 'DECRYPT_FAILED');
});
test('records: ciphertext cannot be moved to another record id or user', async () => {
  const dek = await generateDek();
  const p = await encryptRecord(dek, USER, REC, SAMPLE);
  await rejects(decryptRecord(dek, USER, 'rec-2', p), 'DECRYPT_FAILED');
  await rejects(decryptRecord(dek, 'user-2', REC, p), 'DECRYPT_FAILED');
});
test('records: wrong DEK fails', async () => {
  const p = await encryptRecord(await generateDek(), USER, REC, SAMPLE);
  await rejects(decryptRecord(await generateDek(), USER, REC, p), 'DECRYPT_FAILED');
});

test('recovery key: format is 14 groups of 4 and round-trips', async () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const text = await formatRecoveryKey(bytes);
  ok(/^([0-9A-HJKMNP-TV-Z]{4}-){13}[0-9A-HJKMNP-TV-Z]{4}$/.test(text), text);
  ok((await parseRecoveryKey(text)).every((b, i) => b === bytes[i]));
});
test('recovery key: tolerates lowercase, spaces, O/0 and I/L/1 mix-ups', async () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const text = await formatRecoveryKey(bytes);
  const messy = text.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o').replace(/1/g, 'l');
  ok((await parseRecoveryKey(messy)).every((b, i) => b === bytes[i]));
});
test('recovery key: a typo is caught by the checksum, wrong length is rejected', async () => {
  const text = await formatRecoveryKey(crypto.getRandomValues(new Uint8Array(32)));
  const first = text[0] === '2' ? '3' : '2';
  await rejects(parseRecoveryKey(first + text.slice(1)), 'RECOVERY_KEY_CHECKSUM');
  await rejects(parseRecoveryKey(text.slice(0, 20)), 'RECOVERY_KEY_FORMAT');
});

test('signup then login on a "new device" recovers the same DEK', async () => {
  const acct = await createAccountKeys(PW, EMAIL, FAST);
  const { dek } = await unlockWithPassword(PW, EMAIL, acct.profileKeys);
  ok(await sameKey(acct.dek, dek));
});
test('login: wrong password cannot unwrap the DEK', async () => {
  const acct = await createAccountKeys(PW, EMAIL, FAST);
  await rejects(unlockWithPassword('wrong password', EMAIL, acct.profileKeys), 'WRONG_KEY_OR_CORRUPT');
});
test('login: tampered wrapped_dek fails', async () => {
  const acct = await createAccountKeys(PW, EMAIL, FAST);
  const bad = { ...acct.profileKeys, wrapped_dek: flip(acct.profileKeys.wrapped_dek) };
  await rejects(unlockWithPassword(PW, EMAIL, bad), 'WRONG_KEY_OR_CORRUPT');
});
test('auth secret: deterministic, email is case/space-insensitive, depends on password and email', async () => {
  const a = await deriveLoginSecrets(PW, EMAIL, FAST);
  const b = await deriveLoginSecrets(PW, '  Tunde@Example.COM ', FAST);
  const c = await deriveLoginSecrets(PW + '!', EMAIL, FAST);
  const d = await deriveLoginSecrets(PW, 'other@example.com', FAST);
  ok(a.authSecret === b.authSecret);
  ok(a.authSecret !== c.authSecret && a.authSecret !== d.authSecret);
  ok(/^[A-Za-z0-9_-]{43}$/.test(a.authSecret), 'auth secret should be 43 url-safe chars');
});
test('auth secret is independent of the KEK (cannot unwrap the DEK with it)', async () => {
  const acct = await createAccountKeys(PW, EMAIL, FAST);
  const wrongPw = await deriveLoginSecrets(acct.authSecret, EMAIL, FAST); // using the secret as a password
  await rejects(unwrapDekWithKek(wrongPw.kek, acct.profileKeys.wrapped_dek), 'WRONG_KEY_OR_CORRUPT');
});

test('recovery: recovery key unlocks the same DEK; wrong key does not', async () => {
  const acct = await createAccountKeys(PW, EMAIL, FAST);
  ok(await sameKey(acct.dek, await recoverWithKey(acct.recoveryKey, acct.profileKeys.recovery_wrapped_dek)));
  const other = await formatRecoveryKey(crypto.getRandomValues(new Uint8Array(32)));
  await rejects(recoverWithKey(other, acct.profileKeys.recovery_wrapped_dek), 'WRONG_KEY_OR_CORRUPT');
});
test('recovery: forgot password, recover, set new password, old password stops working', async () => {
  const acct = await createAccountKeys(PW, EMAIL, FAST);
  const dek = await recoverWithKey(acct.recoveryKey, acct.profileKeys.recovery_wrapped_dek);
  const next = await changePassword(dek, 'a brand new passphrase', EMAIL, FAST);
  const profile = { ...acct.profileKeys, ...next.profileKeys };
  ok(await sameKey(acct.dek, (await unlockWithPassword('a brand new passphrase', EMAIL, profile)).dek));
  await rejects(unlockWithPassword(PW, EMAIL, profile), 'WRONG_KEY_OR_CORRUPT');
  ok(next.authSecret !== (await deriveLoginSecrets(PW, EMAIL, FAST)).authSecret);
});
test('recovery: check prompt returns true for the right key, false otherwise', async () => {
  const acct = await createAccountKeys(PW, EMAIL, FAST);
  ok(await checkRecoveryKey(acct.recoveryKey, acct.profileKeys.recovery_wrapped_dek) === true);
  ok(await checkRecoveryKey('0000-0000', acct.profileKeys.recovery_wrapped_dek) === false);
});
test('recovery: rotation invalidates the old key, new key works, DEK unchanged', async () => {
  const acct = await createAccountKeys(PW, EMAIL, FAST);
  const rot = await rotateRecoveryKey(acct.dek);
  await rejects(recoverWithKey(acct.recoveryKey, rot.recovery_wrapped_dek), 'WRONG_KEY_OR_CORRUPT');
  ok(await sameKey(acct.dek, await recoverWithKey(rot.recoveryKey, rot.recovery_wrapped_dek)));
});

test('PIN: right PIN unlocks, wrong PIN fails, non-digits rejected', async () => {
  const dek = await generateDek();
  const blob = await wrapDekWithPin(dek, '4821', PIN_FAST);
  ok(await sameKey(dek, await unwrapDekWithPin('4821', blob)));
  await rejects(unwrapDekWithPin('4822', blob), 'WRONG_KEY_OR_CORRUPT');
  await rejects(wrapDekWithPin(dek, '48a1', PIN_FAST), 'PIN_FORMAT');
});
test('PIN: per-device salt makes blobs differ for the same PIN', async () => {
  const dek = await generateDek();
  const a = await wrapDekWithPin(dek, '1234', PIN_FAST), b = await wrapDekWithPin(dek, '1234', PIN_FAST);
  ok(a.salt !== b.salt && a.wrapped !== b.wrapped);
});

test(`default KDF settings are ${DEFAULT_KDF.iterations} iterations (timing is logged)`, async () => {
  ok(DEFAULT_KDF.iterations >= 600000);
  const t = performance.now();
  await deriveLoginSecrets(PW, EMAIL); // real cost, as a user would feel it
  globalThis.__apexKdfMs = Math.round(performance.now() - t);
});

export async function runTests(log = console.log) {
  let passed = 0, failed = 0;
  for (const t of tests) {
    try { await t.fn(); passed++; log(`PASS  ${t.name}`); }
    catch (e) { failed++; log(`FAIL  ${t.name}\n      ${e.message}`); }
  }
  log(`\n${passed} passed, ${failed} failed. Real login key derivation took ${globalThis.__apexKdfMs ?? '?'} ms on this device.`);
  return { passed, failed };
}
