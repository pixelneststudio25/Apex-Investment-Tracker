import { createAuth } from './core/auth.js';
import { createIdleLock } from './core/idle.js';
import { kv } from './core/kv.js';
import { createSupabase } from './core/supabase.js';
import { createVault } from './core/vault.js';
import { ceremonyView, checkKeyView, forgotView, loginView, recoverView, signupView, verifyView, welcomeView } from './ui/auth-views.js';
import { pinSetupView, pinUnlockView } from './ui/pin-views.js';
import { mountWorkspace } from './ui/workspace.js';

// Read the link parameters before the Supabase client consumes and clears them.
const linkParams = new URLSearchParams(location.hash.slice(1));
const isRecoveryLink = linkParams.get('type') === 'recovery';
const hashError = linkParams.get('error_description');

// Theme switcher
const root = document.documentElement;
document.getElementById('theme-toggle')?.addEventListener('click', () => {
  const next = getComputedStyle(root).colorScheme.startsWith('light') ? 'dark' : 'light';
  root.setAttribute('data-theme', next);
  try { localStorage.setItem('apex.theme', next); } catch { /* storage unavailable */ }
});

const app = document.getElementById('app');
// The signed-in workspace has its own navigation, so the plain page header is hidden while it is showing.
const show = (node, { workspace = false } = {}) => {
  document.body.classList.toggle('is-workspace', workspace);
  app.replaceChildren(node); window.scrollTo(0, 0);
};

let auth, vault;
try {
  auth = createAuth({ supabase: createSupabase(), kv, redirectTo: location.origin + '/' });
  vault = createVault({ auth });
} catch {
  app.textContent = 'Apex could not start. Please reload the page.';
  throw new Error('init failed');
}

// ---------- idle auto-lock (2 minutes) ----------
const idle = createIdleLock({ ms: 120000, onLock: () => lockNow() });
['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach((ev) => window.addEventListener(ev, () => idle.bump(), { passive: true }));
document.addEventListener('visibilitychange', () => (document.hidden ? idle.hidden() : idle.visible()));

// ---------- flows ----------
const enterApp = () => { idle.start(); showHome(); };

async function afterUnlock() { // after password login or recovery
  const rec = await auth.pinInfo();
  if (rec && rec.userId === auth.state.userId) enterApp(); else showSetPin();
}

async function lockNow() {
  idle.stop(); auth.lock();
  await vault.close(); // decrypted records leave memory right away
  await showLocked();
}

async function showLocked(notice) {
  const rec = await auth.pinInfo(); const session = await auth.currentSession();
  if (rec && session && session.user.id === rec.userId) showPinUnlock(rec);
  else showLogin({ email: rec?.email || session?.user.email || auth.state.email || '', notice: notice || 'Your vault is locked. Enter your password to open it.' });
}

const showPinUnlock = (rec) => show(pinUnlockView({
  email: rec.email, attemptsLeft: rec.attemptsLeft,
  onPin: async (pin) => { await auth.unlockWithPin(pin); enterApp(); },
  onUsePassword: () => showLogin({ email: rec.email }),
  onWiped: (msg) => showLogin({ email: rec.email, notice: msg }),
}));

const showSetPin = () => show(pinSetupView({
  onSet: async (pin) => { await auth.setPin(pin); enterApp(); },
  onSkip: enterApp,
}));

const showWelcome = () => show(welcomeView({ onCreate: showSignup, onSignIn: () => showLogin() }));

function showSignup() {
  show(signupView({
    onBack: showWelcome,
    onSubmit: async ({ email, password }) => {
      const { recoveryKey } = await auth.signUp({ email, password });
      showCeremony(recoveryKey, async () => {
        const { synced } = await auth.confirmCeremony();
        if (synced) await afterUnlock(); else showVerify(email);
      });
    },
  }));
}

const showCeremony = (recoveryKey, onConfirmed) => show(ceremonyView({ recoveryKey, onDone: onConfirmed }));

const showVerify = (email) => show(verifyView({
  email, onResend: () => auth.resendVerification(email), onSignIn: () => showLogin({ email }),
}));

function showLogin({ email = '', notice } = {}) {
  show(loginView({
    email, notice, onCreate: showSignup, onForgot: (e) => showForgot(e), onResend: (e) => auth.resendVerification(e),
    onSubmit: async (creds) => {
      const r = await auth.signIn(creds);
      if (r.status === 'ceremony') {
        showCeremony(r.recoveryKey, async () => { await auth.confirmCeremony(); await afterUnlock(); });
      } else await afterUnlock();
    },
  }));
}

const showForgot = (email = '') => show(forgotView({
  email, onSubmit: (e) => auth.requestPasswordReset(e), onBack: () => showLogin({ email }),
}));

async function showRecover(email, userId) {
  const rec = await auth.pinInfo();
  show(recoverView({
    email, hasPin: !!rec && rec.userId === userId,
    onSubmit: async (c) => {
      if (c.mode === 'pin') {
        const r = await auth.completeRecoveryWithPin(c);
        // The old key stays valid until the new one is confirmed.
        showCeremony(r.recoveryKey, async () => { await auth.commitRecoveryRotation(); await afterUnlock(); });
      } else { await auth.completeRecovery(c); await afterUnlock(); }
    },
  }));
}

const showCheckKey = () => show(checkKeyView({ onSubmit: (k) => auth.verifyRecoveryKey(k), onBack: showHome }));

function showHome() {
  show(mountWorkspace({
    data: vault,
    email: auth.state.email,
    actions: {
    onLock: lockNow,
    onCheckKey: showCheckKey,
    onRotateKey: async () => {
      const { recoveryKey } = await auth.beginRecoveryRotation();
      showCeremony(recoveryKey, async () => { await auth.commitRecoveryRotation(); showHome(); });
    },
    onSetPin: showSetPin,
    onSignOut: async () => { idle.stop(); await vault.close(); await auth.signOut(); showWelcome(); },
    },
  }), { workspace: true });
}

(async function boot() {
  const session = await auth.currentSession();
  history.replaceState(null, '', location.pathname);
  if (hashError) showLogin({ notice: 'That link has expired or was already used. Sign in, or use "Forgot your password?" for a new one.' });
  else if (isRecoveryLink && session) await showRecover(session.user.email, session.user.id);
  else if (isRecoveryLink) showForgot();
  else if (session) await showLocked('Welcome back. Enter your password to unlock Apex.');
  else showWelcome();
})();
