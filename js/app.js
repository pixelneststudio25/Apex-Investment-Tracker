import { createAuth } from './core/auth.js';
import { createIdleLock } from './core/idle.js';
import { kv } from './core/kv.js';
import { createSupabase } from './core/supabase.js';
import { createVault } from './core/vault.js';
import { createRemote } from './core/remote.js';
import { createFiles } from './core/files.js';
import { createSync } from './core/sync.js';
import { createBackup, restoreBackup } from './core/backup.js';
import { confirmDialog } from './ui/dialog.js';
import { ceremonyView, checkKeyView, forgotView, loginView, recoverView, signupView, verifyView, welcomeView } from './ui/auth-views.js';
import { pinSetupView, pinUnlockView } from './ui/pin-views.js';
import { mountWorkspace } from './ui/workspace.js';
import { createPortfolio } from './models/portfolio.js';
import { enter, toggleTheme, unlockMoment } from './ui/motion.js';
import { initPwa } from './pwa.js';

initPwa(); // offline copy of the app files, and the install button in Settings

// Read the link parameters before the Supabase client consumes and clears them.
const linkParams = new URLSearchParams(location.hash.slice(1));
const isRecoveryLink = linkParams.get('type') === 'recovery';
const hashError = linkParams.get('error_description');

// Theme switcher: the circular reveal grows from the button; the choice is saved on this device.
document.getElementById('theme-toggle')?.addEventListener('click', (e) => { toggleTheme(e.currentTarget); });

const app = document.getElementById('app');
// The signed-in workspace has its own navigation, so the plain page header is hidden while it is showing.
// `wide` gives the welcome screen room for its two columns. Every new screen rises in gently.
const show = (node, { workspace = false, wide = false } = {}) => {
  document.body.classList.toggle('is-workspace', workspace);
  document.body.classList.toggle('is-wide', wide);
  app.replaceChildren(node); window.scrollTo(0, 0);
  enter(node);
};

let auth, vault, sync, files, notifyWrite = () => {};
try {
  const supabase = createSupabase();
  auth = createAuth({ supabase, kv, redirectTo: location.origin + '/' });
  vault = createVault({ auth, onWrite: () => notifyWrite() }); // every local save asks the sync engine to back up shortly after
  sync = createSync({ getStore: () => vault.store(), remote: createRemote({ supabase, getUserId: () => auth.state.userId }), canRun: () => auth.isUnlocked() });
  files = createFiles({ supabase });
  notifyWrite = () => sync.touch();
} catch {
  app.textContent = 'Apex could not start. Please reload the page.';
  throw new Error('init failed');
}

// ---------- idle auto-lock (2 minutes) ----------
const idle = createIdleLock({ ms: 120000, onLock: () => lockNow() });
['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach((ev) => window.addEventListener(ev, () => idle.bump(), { passive: true }));
document.addEventListener('visibilitychange', () => (document.hidden ? idle.hidden() : idle.visible()));

// ---------- flows ----------
// The name typed at sign-up is kept in memory only until the vault is open, then saved inside it (encrypted), never sent in the clear.
let pendingName = '';
async function applyPendingName() {
  if (!pendingName) return;
  const displayName = pendingName; pendingName = '';
  try { await createPortfolio(await vault.store()).updateSettings({ displayName }); } catch (e) { console.error(e); } // the greeting simply stays generic
}
const enterApp = async () => { idle.start(); sync.start(); unlockMoment(); await applyPendingName(); showHome(); };

async function afterUnlock() { // after password login or recovery
  const rec = await auth.pinInfo();
  if (rec && rec.userId === auth.state.userId) enterApp(); else showSetPin();
}

async function lockNow() {
  idle.stop(); sync.stop(); auth.lock();
  await sync.whenIdle(); // a backup that was already running stops as soon as it finds the vault locked
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

const showWelcome = () => show(welcomeView({ onCreate: showSignup, onSignIn: () => showLogin() }), { wide: true });

function showSignup() {
  show(signupView({
    onBack: showWelcome,
    onSubmit: async ({ email, password, name }) => {
      const { recoveryKey } = await auth.signUp({ email, password });
      pendingName = name || '';
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

// A correct key is remembered on this device, so the setup checklist on Home can tick "Check your recovery key".
const showCheckKey = () => show(checkKeyView({
  onSubmit: async (k) => {
    await auth.verifyRecoveryKey(k);
    try { await (await vault.store()).meta.set('keyChecked', true); } catch { /* the checklist simply stays unticked */ }
  },
  onBack: showHome,
}));

// Signing out keeps this device's encrypted copy (so unsynced work is never lost), but it first tries to back up
// and warns if anything could not be.
async function signOut() {
  idle.stop();
  try { await sync.flush(); } catch { /* the question below covers it */ }
  let left = 0; try { left = (await (await vault.store()).pending()).count; } catch { /* locked */ }
  if (left > 0) {
    const yes = await confirmDialog({ title: 'Some changes are not backed up', body: `${left} ${left === 1 ? 'change has' : 'changes have'} not reached the server yet. Signing out keeps ${left === 1 ? 'it' : 'them'} safe on this device, but if this device is lost they are lost with it. Sign out anyway?`, confirmLabel: 'Sign out anyway', danger: true });
    if (!yes) { idle.start(); return; }
  }
  sync.stop(); await sync.whenIdle();
  await vault.close(); await auth.signOut(); showWelcome();
}

// "Remove my data from this device": backs up first, checks the server really has everything, then deletes the
// local copy and signs out. If it cannot be sure, it says exactly why and asks again.
async function wipeThisDevice() {
  const first = await confirmDialog({ title: 'Remove my data from this device?', body: 'This deletes the copy of your records stored in this browser and signs you out. Your backed-up records stay online, and sign-in brings everything back.', confirmLabel: 'Continue', danger: true });
  if (!first) return;
  idle.stop();
  let problem = null;
  try {
    await sync.flush();
    const v = await sync.verify();
    if (v.notBackedUp > 0 || v.historyPending > 0) problem = `${v.notBackedUp} ${v.notBackedUp === 1 ? 'record is' : 'records are'} not backed up${v.historyPending ? `, and ${v.historyPending} old ${v.historyPending === 1 ? 'version is' : 'versions are'} still waiting` : ''}.`;
  } catch (e) { problem = e.code === 'OFFLINE' ? 'You are offline, so Apex cannot confirm that everything is backed up.' : 'Apex could not confirm that everything is backed up.'; }
  if (problem) {
    const yes = await confirmDialog({ title: 'Not everything is backed up', body: `${problem} If you remove this device's data now, anything not backed up is lost for good. You can download a backup file in Settings first.`, confirmLabel: 'Remove anyway', danger: true });
    if (!yes) { idle.start(); return; }
  }
  sync.stop(); await sync.whenIdle();
  await vault.wipe(); await auth.signOut(); showWelcome();
}

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
    hasPin: async () => { const r = await auth.pinInfo(); return !!r && r.userId === auth.state.userId; },
    sync,
    files: { api: files, getDek: () => auth.state.dek, userId: () => auth.state.userId },
    exportBackup: async () => createBackup(await vault.store(), { userId: auth.state.userId }),
    importBackup: async (text) => restoreBackup(await vault.store(), text, { userId: auth.state.userId }),
    onSignOut: signOut,
    onWipe: wipeThisDevice,
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
