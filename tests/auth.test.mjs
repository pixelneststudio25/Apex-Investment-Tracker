// Account-flow tests against an in-memory fake of Supabase and local storage.
import { decryptRecord, encryptRecord } from '../js/core/crypto.js';
import { recoverWithKey } from '../js/core/keys.js';
import { createAuth } from '../js/core/auth.js';

const FAST = { v: 1, alg: 'PBKDF2-SHA256', iterations: 1000 };
const EMAIL = 'tunde@example.com', PW = 'correct horse battery staple';

function fakeKv() { const m = new Map(); return { get: async (k) => m.get(k), set: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); } }; }

function fakeBackend() {
  const users = new Map(), profiles = new Map(); let session = null, n = 0;
  const supabase = {
    auth: {
      async signUp({ email, password }) {
        const e = email.toLowerCase(); const u = { id: 'u' + (++n), email: e, password, confirmed: false };
        users.set(e, u); return { data: { user: { id: u.id, email: e }, session: null }, error: null };
      },
      async signInWithPassword({ email, password }) {
        const u = users.get(email.toLowerCase());
        if (!u || u.password !== password) return { data: {}, error: { code: 'invalid_credentials' } };
        if (!u.confirmed) return { data: {}, error: { code: 'email_not_confirmed' } };
        session = { user: u }; return { data: { user: u, session }, error: null };
      },
      async getSession() { return { data: { session } }; },
      async signOut() { session = null; return {}; },
      async resend() { return { error: null }; },
      async resetPasswordForEmail() { return { error: null }; },
      async updateUser({ password }) { if (!session) return { error: { code: 'no_session' } }; users.get(session.user.email).password = password; return { error: null }; },
    },
    from: () => ({
      async insert(row) {
        if (session?.user.id !== row.user_id) return { error: { code: '42501' } };
        if (profiles.has(row.user_id)) return { error: { code: '23505' } };
        profiles.set(row.user_id, row); return { error: null };
      },
      update: (vals) => ({ eq: (_c, v) => {
        const hit = session?.user.id === v && profiles.has(v);
        if (hit) profiles.set(v, { ...profiles.get(v), ...vals });
        const res = { data: hit ? [{ user_id: v }] : [], error: null };
        return Object.assign(Promise.resolve(res), { select: async () => res });
      } }),
      select: () => ({ eq: (_c, v) => ({ maybeSingle: async () => ({ data: profiles.get(v) || null, error: null }) }) }),
    }),
  };
  // Simulates clicking the verification link in the email (also signs that browser in).
  const clickRecoveryLink = (email) => { session = { user: users.get(email.toLowerCase()) }; };
  const clickLink = (email) => { const u = users.get(email.toLowerCase()); u.confirmed = true; session = { user: u }; };
  return { supabase, users, profiles, clickLink, clickRecoveryLink, endSession: () => { session = null; } };
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
async function rejects(p, code) {
  try { await p; } catch (e) { if (e.code === code) return; throw new Error(`wrong error: ${e.code || e.message}`); }
  throw new Error('expected failure but it succeeded');
}
const mk = (be, kv = fakeKv()) => ({ kv, auth: createAuth({ supabase: be.supabase, kv, kdf: FAST }) });
const sample = { name: 'Land at Lekki', amountKobo: 1245000000 };

test('signup: real password never reaches the server; nothing uploaded before verification', async () => {
  const be = fakeBackend(); const { auth, kv } = mk(be);
  const r = await auth.signUp({ email: EMAIL, password: PW });
  ok(r.recoveryKey.split('-').length === 14);
  ok(be.users.get(EMAIL).password !== PW && be.users.get(EMAIL).password.length === 43, 'server got the auth secret');
  ok(be.profiles.size === 0, 'no profile yet');
  const pending = await kv.get('pending');
  ok(pending && pending.ceremonyDone === false && !JSON.stringify(pending).includes(r.recoveryKey));
});

test('ceremony confirmed before email is verified: keys stay local, no upload', async () => {
  const be = fakeBackend(); const { auth, kv } = mk(be);
  await auth.signUp({ email: EMAIL, password: PW });
  ok((await auth.confirmCeremony()).synced === false);
  ok(be.profiles.size === 0 && (await kv.get('pending')).ceremonyDone === true);
});

test('unverified login is refused with a clear code; wrong password is refused', async () => {
  const be = fakeBackend(); const { auth } = mk(be);
  await auth.signUp({ email: EMAIL, password: PW }); await auth.confirmCeremony();
  await rejects(auth.signIn({ email: EMAIL, password: PW }), 'EMAIL_NOT_CONFIRMED');
  be.clickLink(EMAIL); be.endSession();
  await rejects(auth.signIn({ email: EMAIL, password: 'wrong password!!' }), 'INVALID_LOGIN');
});

test('full journey: signup, ceremony, verify, first login uploads keys, new device can unlock', async () => {
  const be = fakeBackend(); const a = mk(be);
  await a.auth.signUp({ email: EMAIL, password: PW });
  const payload = await encryptRecord(a.auth.state.dek, 'u1', 'rec-1', sample);
  await a.auth.confirmCeremony();
  be.clickLink(EMAIL); be.endSession();
  ok((await a.auth.signIn({ email: EMAIL, password: PW })).status === 'unlocked');
  ok(be.profiles.size === 1 && (await a.kv.get('pending')) === undefined, 'uploaded and pending cleared');
  const prof = [...be.profiles.values()][0];
  ok(Object.keys(prof).sort().join() === 'consent_version,consented_at,kdf_params,kdf_salt,recovery_wrapped_dek,user_id,wrapped_dek');
  // brand-new device: empty local storage
  const b = mk(be); await b.auth.signOut();
  ok((await b.auth.signIn({ email: EMAIL, password: PW })).status === 'unlocked');
  ok(JSON.stringify(await decryptRecord(b.auth.state.dek, 'u1', 'rec-1', payload)) === JSON.stringify(sample));
});

test('reload before confirming the key: login issues a fresh recovery key that really works', async () => {
  const be = fakeBackend(); const a = mk(be);
  const first = await a.auth.signUp({ email: EMAIL, password: PW }); // key shown, page "reloaded" before confirming
  be.clickLink(EMAIL); be.endSession();
  const again = mk(be, a.kv); // same device storage, new page load
  const r = await again.auth.signIn({ email: EMAIL, password: PW });
  ok(r.status === 'ceremony' && r.recoveryKey !== first.recoveryKey);
  ok(be.profiles.size === 0, 'nothing uploaded until the new key is confirmed');
  ok((await again.auth.confirmCeremony()).synced === true && be.profiles.size === 1);
  const prof = [...be.profiles.values()][0];
  const viaRecovery = await recoverWithKey(r.recoveryKey, prof.recovery_wrapped_dek);
  const p = await encryptRecord(again.auth.state.dek, 'u1', 'x', sample);
  ok(JSON.stringify(await decryptRecord(viaRecovery, 'u1', 'x', p)) === JSON.stringify(sample));
  await rejects(recoverWithKey(first.recoveryKey, prof.recovery_wrapped_dek), 'WRONG_KEY_OR_CORRUPT');
});

test('account with neither a profile nor local keys reports NO_KEYS', async () => {
  const be = fakeBackend(); const a = mk(be);
  await a.auth.signUp({ email: EMAIL, password: PW }); await a.auth.confirmCeremony();
  be.clickLink(EMAIL); be.endSession();
  await rejects(mk(be).auth.signIn({ email: EMAIL, password: PW }), 'NO_KEYS'); // fresh device, never uploaded
});

async function accountWithProfile(be) {
  const a = mk(be);
  const { recoveryKey } = await a.auth.signUp({ email: EMAIL, password: PW });
  const payload = await encryptRecord(a.auth.state.dek, 'u1', 'rec-1', sample);
  await a.auth.confirmCeremony(); be.clickLink(EMAIL); be.endSession();
  await a.auth.signIn({ email: EMAIL, password: PW }); await a.auth.signOut();
  return { recoveryKey, payload };
}

test('forgot password: recovery key + new password; old password dies, old data still opens', async () => {
  const be = fakeBackend(); const { recoveryKey, payload } = await accountWithProfile(be);
  await mk(be).auth.requestPasswordReset(EMAIL);
  await mk(be).auth.requestPasswordReset('nobody@example.com'); // must not reveal whether an account exists
  be.clickRecoveryLink(EMAIL);
  const r = mk(be); // fresh device, no local keys
  await r.auth.completeRecovery({ recoveryKey, newPassword: 'a brand new passphrase' });
  ok(JSON.stringify(await decryptRecord(r.auth.state.dek, 'u1', 'rec-1', payload)) === JSON.stringify(sample));
  be.endSession();
  await rejects(mk(be).auth.signIn({ email: EMAIL, password: PW }), 'INVALID_LOGIN');
  const n = mk(be); await n.auth.signIn({ email: EMAIL, password: 'a brand new passphrase' });
  ok(JSON.stringify(await decryptRecord(n.auth.state.dek, 'u1', 'rec-1', payload)) === JSON.stringify(sample));
});

test('forgot password: wrong or mistyped recovery key changes nothing', async () => {
  const be = fakeBackend(); const { recoveryKey } = await accountWithProfile(be);
  be.clickRecoveryLink(EMAIL); const r = mk(be);
  const typo = (recoveryKey[0] === '2' ? '3' : '2') + recoveryKey.slice(1);
  await rejects(r.auth.completeRecovery({ recoveryKey: typo, newPassword: 'a brand new passphrase' }), 'RECOVERY_KEY_TYPO');
  const other = (await accountWithProfile(fakeBackend())).recoveryKey; // valid format, wrong account
  await rejects(r.auth.completeRecovery({ recoveryKey: other, newPassword: 'a brand new passphrase' }), 'WRONG_RECOVERY_KEY');
  ok(!r.auth.isUnlocked());
  be.endSession(); ok((await mk(be).auth.signIn({ email: EMAIL, password: PW })).status === 'unlocked', 'old password still works');
});

test('forgot password: expired link (no session) is refused', async () => {
  const be = fakeBackend(); const { recoveryKey } = await accountWithProfile(be);
  be.endSession();
  await rejects(mk(be).auth.completeRecovery({ recoveryKey, newPassword: 'a brand new passphrase' }), 'NO_SESSION');
});

test('change password while unlocked: needs the current password; data unaffected', async () => {
  const be = fakeBackend(); const { payload } = await accountWithProfile(be);
  const a = mk(be); await a.auth.signIn({ email: EMAIL, password: PW });
  await rejects(a.auth.changePasswordUnlocked({ currentPassword: 'not it at all', newPassword: 'another passphrase!' }), 'INVALID_LOGIN');
  await a.auth.changePasswordUnlocked({ currentPassword: PW, newPassword: 'another passphrase!' });
  be.endSession();
  await rejects(mk(be).auth.signIn({ email: EMAIL, password: PW }), 'INVALID_LOGIN');
  const b = mk(be); await b.auth.signIn({ email: EMAIL, password: 'another passphrase!' });
  ok(JSON.stringify(await decryptRecord(b.auth.state.dek, 'u1', 'rec-1', payload)) === JSON.stringify(sample));
});

export async function runAuthTests(log = console.log) {
  let passed = 0, failed = 0;
  for (const t of tests) {
    try { await t.fn(); passed++; log(`PASS  ${t.name}`); } catch (e) { failed++; log(`FAIL  ${t.name}\n      ${e.message}`); }
  }
  log(`\n${passed} passed, ${failed} failed (account flows).`);
  return { passed, failed };
}
