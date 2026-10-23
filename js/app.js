import { createAuth } from './core/auth.js';
import { kv } from './core/kv.js';
import { createSupabase } from './core/supabase.js';
import { ceremonyView, forgotView, homeView, loginView, recoverView, signupView, verifyView, welcomeView } from './ui/auth-views.js';

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
const show = (node) => { app.replaceChildren(node); window.scrollTo(0, 0); };

let auth;
try {
  auth = createAuth({ supabase: createSupabase(), kv, redirectTo: location.origin + '/' });
} catch {
  app.textContent = 'Apex could not start. Please reload the page.';
  throw new Error('init failed');
}

const showWelcome = () => show(welcomeView({ onCreate: showSignup, onSignIn: () => showLogin() }));

function showSignup() {
  show(signupView({
    onBack: showWelcome,
    onSubmit: async ({ email, password }) => {
      const { recoveryKey } = await auth.signUp({ email, password });
      showCeremony(recoveryKey, email);
    },
  }));
}

function showCeremony(recoveryKey, email) {
  show(ceremonyView({
    recoveryKey,
    onDone: async () => {
      const { synced } = await auth.confirmCeremony();
      if (synced) showHome(); else showVerify(email);
    },
  }));
}

const showVerify = (email) => show(verifyView({
  email, onResend: () => auth.resendVerification(email), onSignIn: () => showLogin({ email }),
}));

function showLogin({ email = '', notice } = {}) {
  show(loginView({
    email, notice, onCreate: showSignup, onResend: (e) => auth.resendVerification(e), onForgot: (e) => showForgot(e),
    onSubmit: async (creds) => {
      const r = await auth.signIn(creds);
      if (r.status === 'ceremony') showCeremony(r.recoveryKey, creds.email); else showHome();
    },
  }));
}

const showForgot = (email = '') => show(forgotView({
  email, onSubmit: (e) => auth.requestPasswordReset(e), onBack: () => showLogin({ email }),
}));

const showRecover = (email) => show(recoverView({
  email,
  onSubmit: async (creds) => { await auth.completeRecovery(creds); showHome(); },
}));

const showHome = () => show(homeView({
  email: auth.state.email,
  onLock: () => { auth.lock(); showLogin({ email: auth.state.email, notice: 'Your vault is locked. Enter your password to open it.' }); },
  onSignOut: async () => { await auth.signOut(); showWelcome(); },
}));

(async function boot() {
  const session = await auth.currentSession();
  history.replaceState(null, '', location.pathname);
  if (hashError) showLogin({ notice: 'That link has expired or was already used. Sign in, or use "Forgot your password?" for a new one.' });
  else if (isRecoveryLink && session) showRecover(session.user.email);
  else if (isRecoveryLink) showForgot();
  else if (session) showLogin({ email: session.user.email, notice: 'Welcome back. Enter your password to unlock Apex.' });
  else showWelcome();
})();
