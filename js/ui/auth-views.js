import { AuthError } from '../core/auth.js';
import { h } from './dom.js';

const invalid = (msg) => new AuthError('VALIDATION', msg);

function field({ id, label, type = 'text', autocomplete, hint, value, readonly, inputmode }) {
  const input = h('input', { id, name: id, type, autocomplete, value, readonly, inputmode, class: 'input', required: true, spellcheck: 'false', autocapitalize: 'none' });
  return { input, node: h('div', { class: 'field' }, h('label', { for: id }, label), input, hint && h('p', { class: 'hint' }, hint)) };
}
const alertBox = () => h('div', { class: 'alert alert--error', role: 'alert', hidden: true });
function showError(box, err) {
  box.textContent = err instanceof AuthError ? err.message : 'Something went wrong. Please try again.';
  box.hidden = false;
}
// Runs `run` on submit with a busy state and error display. Returns the form.
function wireForm(form, button, box, busyLabel, run) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); box.hidden = true;
    const label = button.textContent; button.disabled = true; button.textContent = busyLabel;
    try { await run(); } catch (err) { showError(box, err); } finally { button.disabled = false; button.textContent = label; }
  });
  return form;
}

export function welcomeView({ onCreate, onSignIn }) {
  return h('section', { class: 'stack' },
    h('h1', {}, 'Every asset, on record.'), h('hr', { class: 'gold-rule' }),
    h('p', { class: 'muted' }, 'A private place for your investment records. Everything is encrypted on your device before it is saved, so only you can read it.'),
    h('button', { class: 'btn', type: 'button', onclick: onCreate }, 'Create your account'),
    h('button', { class: 'btn btn--secondary', type: 'button', onclick: onSignIn }, 'Sign in'));
}

export function signupView({ onSubmit, onBack }) {
  const email = field({ id: 'email', label: 'Email', type: 'email', autocomplete: 'username', inputmode: 'email' });
  const pw = field({ id: 'password', label: 'Password', type: 'password', autocomplete: 'new-password', hint: 'At least 10 characters. A phrase of several words is easy to remember and hard to guess.' });
  const pw2 = field({ id: 'password2', label: 'Confirm password', type: 'password', autocomplete: 'new-password' });
  const consent = h('input', { id: 'consent', type: 'checkbox', required: true });
  const box = alertBox();
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Create account');
  const form = h('form', { class: 'stack', novalidate: true },
    h('h1', {}, 'Create your account'), h('hr', { class: 'gold-rule' }),
    email.node, pw.node, pw2.node,
    h('label', { class: 'check' }, consent, h('span', {}, 'I agree to the privacy notice (draft) and understand that my data is encrypted with a key only I hold.')),
    box, btn, h('button', { class: 'link-btn', type: 'button', onclick: onBack }, 'Back'));
  return wireForm(form, btn, box, 'Securing your vault…', async () => {
    if (!email.input.checkValidity()) throw invalid('Please enter a valid email address.');
    if (pw.input.value.length < 10) throw invalid('Your password needs at least 10 characters.');
    if (pw.input.value !== pw2.input.value) throw invalid('The two passwords do not match.');
    if (!consent.checked) throw invalid('Please accept the privacy notice to continue.');
    await onSubmit({ email: email.input.value, password: pw.input.value });
  });
}

const normGroup = (s) => s.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');

export function ceremonyView({ recoveryKey, onDone }) {
  const groups = recoveryKey.split('-');
  const idx = [];
  while (idx.length < 2) { const i = Math.floor(Math.random() * groups.length); if (!idx.includes(i)) idx.push(i); }
  idx.sort((a, b) => a - b);

  const grid = h('ol', { class: 'recovery-grid', 'aria-label': 'Your recovery key' },
    groups.map((g) => h('li', {}, h('code', {}, g))));
  const a = field({ id: 'g1', label: `Group ${idx[0] + 1}`, autocomplete: 'off' });
  const b = field({ id: 'g2', label: `Group ${idx[1] + 1}`, autocomplete: 'off' });
  const understand = h('input', { id: 'understand', type: 'checkbox' });
  const btn = h('button', { class: 'btn', type: 'submit', disabled: true }, 'I have saved my recovery key');
  const box = alertBox();
  const copied = h('span', { class: 'hint', role: 'status' });

  const sheet = () => `APEX RECOVERY KEY\n\n${recoveryKey}\n\nCreated: ${new Date().toDateString()}\n\n` +
    'Keep this somewhere safe and private (a locked drawer or safe). Anyone with this key and your account can read your records. ' +
    'If you forget your password and lose this key, your data cannot be recovered by anyone, including Apex.\n';
  const refresh = () => {
    const good = normGroup(a.input.value) === groups[idx[0]] && normGroup(b.input.value) === groups[idx[1]];
    btn.disabled = !(good && understand.checked);
  };
  [a.input, b.input, understand].forEach((el) => el.addEventListener('input', refresh));

  const form = h('form', { class: 'stack', novalidate: true },
    h('h1', {}, 'Your recovery key'), h('hr', { class: 'gold-rule' }),
    h('div', { class: 'alert alert--warn' }, h('strong', {}, 'This is the only way back in if you forget your password. '),
      'It is shown once. Apex cannot recover your data without it, and neither can anyone else.'),
    grid,
    h('div', { class: 'row' },
      h('button', { class: 'btn btn--secondary', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(recoveryKey); copied.textContent = 'Copied. Paste it somewhere safe, then clear your clipboard.'; } catch { copied.textContent = 'Copy failed. Please save the file instead.'; } } }, 'Copy'),
      h('button', { class: 'btn btn--secondary', type: 'button', onclick: () => {
        const url = URL.createObjectURL(new Blob([sheet()], { type: 'text/plain' }));
        const link = h('a', { href: url, download: 'apex-recovery-key.txt' }); document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } }, 'Download')),
    copied,
    h('p', {}, 'To confirm you saved it, type these two groups from your copy:'),
    h('div', { class: 'row row--fields' }, a.node, b.node),
    h('label', { class: 'check' }, understand, h('span', {}, 'I understand that without this key, my data is permanently lost if I forget my password.')),
    box, btn);
  return wireForm(form, btn, box, 'Saving…', async () => { await onDone(); });
}

export function verifyView({ email, onResend, onSignIn }) {
  const note = h('p', { class: 'hint', role: 'status' });
  const resend = h('button', { class: 'btn btn--secondary', type: 'button' }, 'Resend email');
  resend.addEventListener('click', async () => {
    resend.disabled = true;
    try { await onResend(); note.textContent = 'Sent. It can take a minute to arrive.'; } catch (e) { note.textContent = e instanceof AuthError ? e.message : 'Could not send. Try again shortly.'; }
    setTimeout(() => { resend.disabled = false; }, 60000);
  });
  return h('section', { class: 'stack' },
    h('h1', {}, 'Check your email'), h('hr', { class: 'gold-rule' }),
    h('p', {}, 'We sent a verification link to ', h('strong', {}, email), '. Open it, then come back and sign in with your password.'),
    h('p', { class: 'muted' }, 'Your recovery key is saved and your vault is ready on this device. Verification lets us back up your encrypted data.'),
    h('button', { class: 'btn', type: 'button', onclick: onSignIn }, 'I have verified, sign in'),
    resend, note);
}

export function loginView({ email = '', notice, onSubmit, onResend, onCreate, onForgot }) {
  const e = field({ id: 'email', label: 'Email', type: 'email', autocomplete: 'username', inputmode: 'email', value: email });
  const p = field({ id: 'password', label: 'Password', type: 'password', autocomplete: 'current-password' });
  const box = alertBox();
  const extra = h('div', {});
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Sign in');
  const form = h('form', { class: 'stack', novalidate: true },
    h('h1', {}, 'Welcome back'), h('hr', { class: 'gold-rule' }),
    notice && h('p', { class: 'muted' }, notice), e.node, p.node, box, extra, btn,
    onForgot && h('button', { class: 'link-btn', type: 'button', onclick: () => onForgot(e.input.value) }, 'Forgot your password?'),
    onCreate && h('button', { class: 'link-btn', type: 'button', onclick: onCreate }, 'Create an account'));
  return wireForm(form, btn, box, 'Unlocking…', async () => {
    extra.replaceChildren();
    try { await onSubmit({ email: e.input.value, password: p.input.value }); }
    catch (err) {
      if (err instanceof AuthError && err.code === 'EMAIL_NOT_CONFIRMED') {
        extra.append(h('button', { class: 'link-btn', type: 'button', onclick: async () => {
          try { await onResend(e.input.value); extra.textContent = 'Verification email sent.'; } catch (x) { extra.textContent = x instanceof AuthError ? x.message : 'Could not send.'; }
        } }, 'Resend verification email'));
      }
      throw err;
    }
  });
}


export function forgotView({ email = '', onSubmit, onBack }) {
  const e = field({ id: 'email', label: 'Email', type: 'email', autocomplete: 'username', inputmode: 'email', value: email });
  const box = alertBox(); const sent = h('div', { class: 'stack', hidden: true });
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Send reset link');
  const form = h('form', { class: 'stack', novalidate: true },
    h('h1', {}, 'Reset your password'), h('hr', { class: 'gold-rule' }),
    h('div', { class: 'alert alert--warn' }, h('strong', {}, 'You will need your recovery key. '),
      'Your data is encrypted with a key only you hold. If you cannot find the recovery key you saved when you created your account, nobody can restore your records.'),
    e.node, box, btn, h('button', { class: 'link-btn', type: 'button', onclick: onBack }, 'Back to sign in'));
  wireForm(form, btn, box, 'Sending…', async () => {
    if (!e.input.checkValidity()) throw invalid('Please enter a valid email address.');
    await onSubmit(e.input.value);
    sent.replaceChildren(h('p', {}, 'If an account exists for ', h('strong', {}, e.input.value.trim()), ', a reset link is on its way. Open it in this browser if you can.'));
    sent.hidden = false; btn.hidden = true;
  });
  return h('section', {}, form, sent);
}

export function recoverView({ email, hasPin, onSubmit }) {
  let mode = 'key';
  const k = field({ id: 'rkey', label: 'Recovery key', autocomplete: 'off', hint: 'Spaces, hyphens and lowercase are fine.' });
  const pn = field({ id: 'rpin', label: 'PIN on this device', type: 'password', autocomplete: 'off', inputmode: 'numeric', hint: 'The 4-digit PIN you use to unlock Apex here.' });
  pn.input.required = false; k.input.required = false;
  const pinBox = h('div', { hidden: true }, pn.node), keyBox = h('div', {}, k.node);
  const p = field({ id: 'password', label: 'New password', type: 'password', autocomplete: 'new-password', hint: 'At least 10 characters.' });
  const p2 = field({ id: 'password2', label: 'Confirm new password', type: 'password', autocomplete: 'new-password' });
  const box = alertBox();
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Unlock and set new password');
  const swap = h('button', { class: 'link-btn', type: 'button', hidden: !hasPin }, 'Use my PIN on this device instead');
  swap.addEventListener('click', () => {
    mode = mode === 'key' ? 'pin' : 'key';
    keyBox.hidden = mode === 'pin'; pinBox.hidden = mode === 'key';
    swap.textContent = mode === 'key' ? 'Use my PIN on this device instead' : 'Use my recovery key instead';
  });
  const form = h('form', { class: 'stack', novalidate: true },
    h('h1', {}, 'Choose a new password'), h('hr', { class: 'gold-rule' }),
    h('p', { class: 'muted' }, 'Reset link verified for ', h('strong', {}, email), '. Unlock your data with your recovery key', hasPin ? ' or the PIN on this device' : '', ', then choose a new password.'),
    keyBox, pinBox, swap, p.node, p2.node, box, btn,
    h('details', {}, h('summary', {}, 'I cannot find my recovery key'),
      h('p', { class: 'hint' }, 'Apex never holds a copy of your key, so it cannot be recovered or reset by anyone. Look for the file, printout or password-manager entry you saved at signup. If it is truly lost, the old records cannot be opened.')));
  return wireForm(form, btn, box, 'Unlocking…', async () => {
    if (p.input.value.length < 10) throw invalid('Your password needs at least 10 characters.');
    if (p.input.value !== p2.input.value) throw invalid('The two passwords do not match.');
    if (mode === 'pin') await onSubmit({ mode, pin: pn.input.value, newPassword: p.input.value });
    else await onSubmit({ mode, recoveryKey: k.input.value, newPassword: p.input.value });
  });
}

export function checkKeyView({ onSubmit, onBack }) {
  const k = field({ id: 'rkey', label: 'Recovery key', autocomplete: 'off', hint: 'Paste or type the key you saved. Spaces, hyphens and lowercase are fine.' });
  const box = alertBox(); const good = h('div', { class: 'alert alert--ok', role: 'status', hidden: true });
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Check my key');
  const form = h('form', { class: 'stack', novalidate: true },
    h('h1', {}, 'Check your recovery key'), h('hr', { class: 'gold-rule' }),
    h('p', { class: 'muted' }, 'This confirms your saved key really opens your data, without changing anything.'),
    k.node, box, good, btn, h('button', { class: 'link-btn', type: 'button', onclick: onBack }, 'Back'));
  return wireForm(form, btn, box, 'Checking…', async () => {
    good.hidden = true; await onSubmit(k.input.value);
    good.textContent = 'This recovery key is correct. Keep it safe.'; good.hidden = false;
  });
}

export function homeView({ email, onLock, onSignOut, onCheckKey, onRotateKey, onSetPin }) {
  return h('section', { class: 'stack' },
    h('h1', {}, 'Your vault is unlocked'), h('hr', { class: 'gold-rule' }),
    h('p', {}, 'Signed in as ', h('strong', {}, email), '.'),
    h('p', { class: 'muted' }, 'Security is set up. Next we build your dashboard and investments.'),
    h('button', { class: 'btn', type: 'button', onclick: onLock }, 'Lock now'),
    h('button', { class: 'btn btn--secondary', type: 'button', onclick: onCheckKey }, 'Check my recovery key'),
    h('button', { class: 'btn btn--secondary', type: 'button', onclick: onRotateKey }, 'Create a new recovery key'),
    h('button', { class: 'btn btn--secondary', type: 'button', onclick: onSetPin }, 'Set or change PIN'),
    h('button', { class: 'link-btn', type: 'button', onclick: onSignOut }, 'Sign out'));
}
