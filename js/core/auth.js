// Account flows: signup, email verification, login, recovery ceremony. Dependencies are injected
// so the flows can be tested with fakes (tests/auth.test.mjs).
import { CryptoError, DEFAULT_KDF } from './crypto.js';
import {
  changePassword as rewrapForPassword, createAccountKeys, deriveLoginSecrets, normalizeEmail,
  recoverWithKey, rotateRecoveryKey, unwrapDekWithKek,
} from './keys.js';

export const CONSENT_VERSION = 'draft-1'; // TODO: replace after legal review of the privacy notice

export class AuthError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

const FRIENDLY = {
  email_not_confirmed: ['EMAIL_NOT_CONFIRMED', 'Please verify your email first. Check your inbox.'],
  invalid_credentials: ['INVALID_LOGIN', 'Email or password is incorrect.'],
  over_email_send_rate_limit: ['RATE_LIMIT', 'Too many emails sent. Please wait a few minutes and try again.'],
  over_request_rate_limit: ['RATE_LIMIT', 'Too many attempts. Please wait a few minutes and try again.'],
  user_already_exists: ['EXISTS', 'An account with this email already exists. Try signing in.'],
};
function mapError(e) {
  const hit = FRIENDLY[e?.code];
  return hit ? new AuthError(hit[0], hit[1]) : new AuthError('AUTH_ERROR', e?.message || 'Something went wrong.');
}

function keyError(e) {
  if (e instanceof CryptoError && (e.code === 'RECOVERY_KEY_FORMAT' || e.code === 'RECOVERY_KEY_CHECKSUM')) {
    return new AuthError('RECOVERY_KEY_TYPO', 'That recovery key does not look right. Please check it for typos.');
  }
  if (e instanceof CryptoError) return new AuthError('WRONG_RECOVERY_KEY', 'That recovery key does not match this account.');
  return e instanceof AuthError ? e : new AuthError('AUTH_ERROR', 'Something went wrong.');
}

export function createAuth({ supabase, kv, kdf = DEFAULT_KDF, redirectTo = '/' }) {
  const state = { dek: null, userId: null, email: null };

  async function sessionFor(email) {
    const { data } = await supabase.auth.getSession();
    const s = data?.session;
    return s && normalizeEmail(s.user.email) === normalizeEmail(email) ? s : null;
  }

  // Upload the locally held keys once the recovery key is confirmed AND a verified session exists.
  async function uploadPendingIfPossible() {
    const pending = await kv.get('pending');
    if (!pending?.ceremonyDone) return false;
    const session = await sessionFor(pending.email);
    if (!session) return false;
    const { error } = await supabase.from('profiles').insert({
      user_id: session.user.id,
      ...pending.profileKeys,
      consent_version: pending.consent.version,
      consented_at: pending.consent.at,
    });
    if (error && error.code !== '23505') throw mapError(error); // 23505 = already uploaded
    await kv.delete('pending');
    return true;
  }

  // Profile first, then the auth secret: if the second step fails the user can retry, and the
  // recovery key (untouched) still opens the data either way.
  async function applyNewPassword(dek, email, userId, newPassword) {
    const next = await rewrapForPassword(dek, newPassword, email, kdf);
    const { data, error } = await supabase.from('profiles').update(next.profileKeys).eq('user_id', userId).select('user_id');
    if (error) throw mapError(error);
    if (!data?.length) throw new AuthError('SAVE_FAILED', 'Could not save your new password. Please try again.');
    const { error: uerr } = await supabase.auth.updateUser({ password: next.authSecret });
    if (uerr) throw mapError(uerr);
    await supabase.auth.signOut({ scope: 'others' }); // sign out every other device
  }

  return {
    state,
    isUnlocked: () => !!state.dek,

    async currentSession() { return (await supabase.auth.getSession()).data?.session || null; },

    async signUp({ email, password }) {
      const keys = await createAccountKeys(password, email, kdf);
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(), password: keys.authSecret, options: { emailRedirectTo: redirectTo },
      });
      if (error) throw mapError(error);
      await kv.set('pending', {
        email: normalizeEmail(email), profileKeys: keys.profileKeys, ceremonyDone: false,
        consent: { version: CONSENT_VERSION, at: new Date().toISOString() },
      });
      Object.assign(state, { dek: keys.dek, userId: data.user?.id ?? null, email: normalizeEmail(email) });
      return { recoveryKey: keys.recoveryKey, hasSession: !!data.session };
    },

    // Called when the user has saved the key and re-entered the check groups.
    async confirmCeremony() {
      const pending = await kv.get('pending');
      if (!pending) throw new AuthError('NO_PENDING', 'Nothing to confirm.');
      await kv.set('pending', { ...pending, ceremonyDone: true });
      return { synced: await uploadPendingIfPossible() };
    },

    async resendVerification(email) {
      const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: redirectTo } });
      if (error) throw mapError(error);
    },

    async signIn({ email, password }) {
      const first = await deriveLoginSecrets(password, email, kdf);
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: first.authSecret });
      if (error) throw mapError(error);
      const userId = data.user.id;
      const { data: profile, error: perr } = await supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle();
      if (perr) throw mapError(perr);

      let dek;
      try {
        if (profile) {
          const secrets = profile.kdf_params.iterations === kdf.iterations ? first
            : await deriveLoginSecrets(password, email, profile.kdf_params);
          dek = await unwrapDekWithKek(secrets.kek, profile.wrapped_dek);
        } else {
          const pending = await kv.get('pending');
          if (!pending || pending.email !== normalizeEmail(email)) {
            throw new AuthError('NO_KEYS', 'This account has no encryption keys on this device. It was never finished on the device where it was created.');
          }
          dek = await unwrapDekWithKek(first.kek, pending.profileKeys.wrapped_dek);
          Object.assign(state, { dek, userId, email: normalizeEmail(email) });
          if (!pending.ceremonyDone) { // reloaded before confirming the key: issue a fresh one
            const rot = await rotateRecoveryKey(dek);
            await kv.set('pending', { ...pending, profileKeys: { ...pending.profileKeys, recovery_wrapped_dek: rot.recovery_wrapped_dek } });
            return { status: 'ceremony', recoveryKey: rot.recoveryKey };
          }
          await uploadPendingIfPossible();
        }
      } catch (e) {
        if (e instanceof AuthError) throw e;
        throw new AuthError('KEYS_FAILED', 'Could not unlock your data with this password.');
      }
      Object.assign(state, { dek, userId, email: normalizeEmail(email) });
      return { status: 'unlocked' };
    },

    // ---------- forgot password ----------
    // Always succeeds from the user's point of view (Supabase does not reveal whether the email exists).
    async requestPasswordReset(email) {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
      if (error) throw mapError(error);
    },

    // Runs in the session created by the reset link. The recovery key unlocks the data key,
    // which is then re-wrapped under the new password. No records are re-encrypted.
    async completeRecovery({ recoveryKey, newPassword }) {
      const session = await this.currentSession();
      if (!session) throw new AuthError('NO_SESSION', 'This reset link has expired or was already used. Please request a new one.');
      const { data: profile, error } = await supabase.from('profiles').select('*').eq('user_id', session.user.id).maybeSingle();
      if (error) throw mapError(error);
      if (!profile) throw new AuthError('NO_PROFILE', 'This account has no saved encryption keys, so there is nothing to recover.');
      let dek;
      try { dek = await recoverWithKey(recoveryKey, profile.recovery_wrapped_dek); } catch (e) { throw keyError(e); }
      await applyNewPassword(dek, session.user.email, session.user.id, newPassword);
      Object.assign(state, { dek, userId: session.user.id, email: normalizeEmail(session.user.email) });
      return { status: 'unlocked' };
    },

    // Change password while unlocked (Settings, later). Verifies the current password locally first.
    async changePasswordUnlocked({ currentPassword, newPassword }) {
      if (!state.dek) throw new AuthError('LOCKED', 'Unlock Apex first.');
      const { data: profile, error } = await supabase.from('profiles').select('*').eq('user_id', state.userId).maybeSingle();
      if (error) throw mapError(error);
      try {
        const cur = await deriveLoginSecrets(currentPassword, state.email, profile.kdf_params);
        await unwrapDekWithKek(cur.kek, profile.wrapped_dek);
      } catch { throw new AuthError('INVALID_LOGIN', 'Your current password is incorrect.'); }
      await applyNewPassword(state.dek, state.email, state.userId, newPassword);
    },

    lock() { state.dek = null; },
    async signOut() { state.dek = null; state.userId = null; state.email = null; await supabase.auth.signOut(); },
  };
}
