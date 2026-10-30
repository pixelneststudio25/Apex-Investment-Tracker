// Settings as a grouped list. Each row has an icon, a title, its current value and a chevron. Rows that open a section go to
// #/settings/<section> (so the back button works); one-tap choices open the Apex sheet; actions run straight away.
// On a wide screen the list stays on the left and the chosen section shows on the right, using the same routes.
// workspace.js passes in what it owns (settings, toast, repainting); nothing here uses innerHTML or inline styles.
import { h } from './dom.js';
import { haptic, hapticsSupported } from './haptics.js';
import { icon } from './icons.js';
import { stepSlider } from './formkit.js';
import { confirmDialog } from './dialog.js';
import { pickOption } from './picker.js';
import { applyTheme, getThemeMode, withBusy } from './motion.js';
import { describeStatus, syncPanel } from './sync-ui.js';
import { documentsBackupPanel } from './document-views.js';
import { installPanel } from './install-panel.js';
import { HELP_ROUTE } from '../models/help-content.js';

export const THEME_WORDS = { system: 'Match device', light: 'Light', dark: 'Dark' };
const THEME_SHORT = { system: 'Auto', light: 'Light', dark: 'Dark' };
export const LOCK_CHOICES = [['1', '1 minute of inactivity'], ['2', '2 minutes of inactivity'], ['5', '5 minutes of inactivity'], ['15', '15 minutes of inactivity'], ['0', 'Only when I lock it or close the app']];
export const lockWord = (min) => (Number(min) === 0 ? 'Never' : `${Number(min)} min`);
const SIZES = [[90, 'Smaller'], [100, 'Standard'], [115, 'Larger'], [130, 'Largest']];

// Every section page. The search palette uses this to open the exact section.
export const SETTINGS_SECTIONS = {
  profile: ['Profile', 'users', 'name portfolio name email account'],
  appearance: ['Appearance', 'sun', 'theme dark light match device text size larger smaller'],
  privacy: ['Amounts and privacy', 'eye', 'hide amounts blur money balance'],
  documents: ['Documents backup', 'paperclip', 'files attachments backup'],
  backup: ['Backup and sync', 'upload', 'sync cloud online restore download backup file'],
  device: ['This device', 'sliders', 'install app home screen sample portfolio'],
  danger: ['Danger zone', 'alert', 'recovery key new remove data wipe'],
};

const row = ({ ic, title, value, href, onclick, current, noChev, danger, key }) => {
  const val = h('span', { class: 'sx-v' }, value ?? '');
  const kids = [h('span', { class: `sx-ic${danger ? ' sx-ic--danger' : ''}`, 'aria-hidden': 'true' }, icon(ic, { size: 20 })), h('span', { class: 'sx-t' }, title), val, !noChev && h('span', { class: 'sx-chev', 'aria-hidden': 'true' }, icon('chevronRight', { size: 18 }))];
  const el = href ? h('a', { class: 'sx-row', href, 'aria-current': current ? 'page' : null }, kids) : h('button', { class: `sx-row${danger ? ' sx-row--danger' : ''}`, type: 'button', onclick }, kids);
  return { el, val, key };
};

export async function settingsView(env, parts = []) {
  const { ctx, actions, email, toast } = env;
  const S = () => env.getSettings();
  const wide = window.matchMedia('(min-width: 900px)').matches;
  const slug = parts[1] && SETTINGS_SECTIONS[parts[1]] ? parts[1] : null;
  const active = slug || (wide ? 'profile' : null);
  const [hasPin, sampleLive] = await Promise.all([actions.hasPin ? actions.hasPin().catch(() => false) : false, env.sampleLive()]);
  const who = () => S().displayName || String(email || '').split('@')[0] || 'You';
  const values = {};
  const setValue = (key, text) => { if (values[key]) values[key].textContent = text; };
  const appearanceText = () => `${THEME_SHORT[getThemeMode()]} · ${S().textScale || 100}%`;
  const hideText = () => (S().hideAmounts ? 'Hidden' : 'Shown');

  // ---------- the list ----------
  const mk = (spec) => { const r = row(spec); if (spec.key) values[spec.key] = r.val; return r.el; };
  const link = (key, ic, title, value, extra = {}) => mk({ ic, title, value, href: `#/settings/${key}`, current: active === key, key, ...extra });
  const group = (title, rows) => h('section', { class: 'sx-group' }, h('h2', { class: 'sx-gh' }, title), h('div', { class: 'sx-card' }, rows));

  let syncWord = '';
  if (actions.sync) { const off = actions.sync.subscribe((s) => { syncWord = describeStatus(s).label; }); off(); }
  const lockRow = mk({ ic: 'clock', title: 'Auto-lock', value: lockWord(S().lockTimeoutMin ?? 2), key: 'lock', onclick: async (e) => {
    const chosen = await pickOption({ title: 'Lock automatically after', options: LOCK_CHOICES, value: String(S().lockTimeoutMin ?? 2), trigger: e.currentTarget });
    if (chosen == null) return;
    try { await env.save({ lockTimeoutMin: Number(chosen) }); actions.onLockTimeout?.(S().lockTimeoutMin); setValue('lock', lockWord(S().lockTimeoutMin)); toast('Lock time saved.'); }
    catch (err) { toast('Could not save the lock time.'); console.error(err); }
  } });
  const me = h('a', { class: 'sx-me', href: '#/settings/profile', 'aria-current': active === 'profile' ? 'page' : null },
    h('span', { class: 'avatar avatar--lg', 'aria-hidden': 'true' }, env.initials(who())),
    h('span', { class: 'sx-me-text' }, h('span', { class: 'sx-me-name' }, who()), h('span', { class: 'sx-me-sub' }, email)),
    h('span', { class: 'sx-chev', 'aria-hidden': 'true' }, icon('chevronRight', { size: 18 })));
  values.me = me.querySelector('.sx-me-name');

  const list = h('nav', { class: 'sx-list', 'aria-label': 'Settings' },
    me,
    group('Preferences', [link('appearance', 'sun', 'Appearance', appearanceText()), link('privacy', S().hideAmounts ? 'eyeOff' : 'eye', 'Amounts and privacy', hideText())]),
    group('Your data', [
      mk({ ic: 'tag', title: 'My categories', href: '#/categories' }),
      link('documents', 'paperclip', 'Documents backup', ''),
      mk({ ic: 'download', title: 'Export and print', href: '#/export' }),
      mk({ ic: 'undo', title: 'Recently deleted', href: '#/deleted' })]), // Reminders and Projections live on the Outlook tab now
    group('Backup', [link('backup', 'upload', 'Backup and sync', syncWord), link('device', 'sliders', 'This device', sampleLive ? 'Sample on' : '', { key: 'device' })]),
    group('Security', [
      mk({ ic: 'key', title: 'PIN', value: hasPin ? 'On' : 'Off', onclick: actions.onSetPin }),
      lockRow,
      mk({ ic: 'shield', title: 'Recovery key', value: 'Check', onclick: actions.onCheckKey }),
      mk({ ic: 'lock', title: 'Lock now', noChev: true, onclick: actions.onLock })]),
    group('Help', [mk({ ic: 'book', title: 'How to use Apex', href: HELP_ROUTE.home }), mk({ ic: 'help', title: 'Common questions', href: HELP_ROUTE.faq })]),
    group('Account', [mk({ ic: 'arrowRight', title: 'Sign out', noChev: true, onclick: actions.onSignOut }), link('danger', 'alert', 'Danger zone', '', { danger: true })]));

  // ---------- the sections ----------
  const head = (title) => h('div', { class: 'sx-head' }, h('a', { class: 'back sx-back', href: '#/settings' }, icon('chevronLeft', { size: 18 }), 'Settings'), h(wide ? 'h2' : 'h1', { class: 'page-title sx-h' }, title));

  const profile = () => {
    const name = h('input', { class: 'input', id: 'displayName', value: S().displayName, maxlength: 80, autocomplete: 'name', placeholder: 'How should Apex greet you?' });
    const pname = h('input', { class: 'input', id: 'portfolioName', value: S().portfolioName, maxlength: 80, placeholder: 'For example, My assets' });
    const saved = h('p', { class: 'hint', role: 'status' });
    const form = h('form', { class: 'stack', novalidate: true },
      h('div', { class: 'field' }, h('label', { for: 'displayName' }, 'Your name'), name),
      h('div', { class: 'field' }, h('label', { for: 'portfolioName' }, 'Portfolio name'), pname, h('p', { class: 'hint' }, 'Shown on your dashboard.')),
      h('button', { class: 'btn', type: 'submit', hidden: true }, 'Save changes'), saved);
    const saveBtn = form.querySelector('button[type=submit]');
    let base = { n: S().displayName || '', p: S().portfolioName || '' };
    const sync = () => { saveBtn.hidden = name.value === base.n && pname.value === base.p; if (!saveBtn.hidden) saved.textContent = ''; };
    name.addEventListener('input', sync); pname.addEventListener('input', sync);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await withBusy(saveBtn, async () => {
        await env.save({ displayName: name.value, portfolioName: pname.value });
        env.paintChrome('settings');
        base = { n: S().displayName || '', p: S().portfolioName || '' };
        saveBtn.hidden = true; saved.textContent = 'Saved.';
        setValue('me', who());
      });
    });
    return [h('section', { class: 'panel stack' }, h('div', { class: 'profile-head' }, h('span', { class: 'avatar avatar--lg', 'aria-hidden': 'true' }, env.initials(who())), h('div', {}, h('p', { class: 'sx-me-name' }, who()), h('p', { class: 'sub' }, email))), form)];
  };

  const appearance = () => {
    // Three preview cards. The switch reveals outward from the card you pressed. They always show what is really applied on
    // this device and repaint whenever the theme changes anywhere (header button, search, sign-in screen).
    const themeOpts = h('div', { class: 'theme-opts', role: 'group', 'aria-label': 'Theme' },
      Object.entries(THEME_WORDS).map(([v, l]) => {
        const b = h('button', { type: 'button', class: 'theme-opt', 'aria-pressed': String(v === getThemeMode()), 'data-mode': v },
          h('span', { class: `theme-prev theme-prev--${v}`, 'aria-hidden': 'true' }, h('i', {}), h('i', {}), h('i', {})), h('span', {}, l));
        b.addEventListener('click', async () => { [...themeOpts.children].forEach((x) => x.setAttribute('aria-pressed', String(x === b))); await applyTheme(v, b); });
        return b;
      }));
    const paintCards = () => { const now = getThemeMode(); [...themeOpts.children].forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.mode === now))); setValue('appearance', appearanceText()); };
    const onThemeChange = () => { if (!themeOpts.isConnected) { document.removeEventListener('apex:theme', onThemeChange); return; } paintCards(); };
    document.addEventListener('apex:theme', onThemeChange);
    const prevName = h('span', { class: 'size-preview-name' }), prevPct = h('span', {});
    const prev = h('div', { class: 'size-preview', 'aria-hidden': 'true' },
      h('p', { class: 'size-preview-top' }, prevName, prevPct),
      h('p', { class: 'size-preview-amount money' }, '₦18,500,000', h('span', { class: 'dec' }, '.00')),
      h('p', { class: 'size-preview-text' }, 'Your rent for this year has been received.'));
    const paintPreview = ([v, nm]) => { prev.style.setProperty('--pv', String(v / 100)); prevName.textContent = nm; prevPct.textContent = `${v}%`; };
    const slider = stepSlider({ label: 'Text size', stops: SIZES, value: S().textScale || 100, hint: 'Drag to preview. The size applies everywhere when you let go.', onPreview: paintPreview,
      onChange: async ([v]) => { try { await env.save({ textScale: v }); env.applyAppearance(); setValue('appearance', appearanceText()); } catch (e) { toast('Could not save the text size.'); console.error(e); } } });
    paintPreview(slider.current());
    slider.el.querySelector('label')?.classList.add('sr-only'); // the card already says "Text size"
    const buzz = h('input', { type: 'checkbox', id: 'buzz' }); buzz.checked = !!S().haptics;
    buzz.addEventListener('change', async () => { try { await env.save({ haptics: buzz.checked }); env.applyAppearance(); haptic('success'); } catch (e) { buzz.checked = !buzz.checked; toast('Could not save that. Try again.'); } });
    const touch = h('section', { class: 'panel stack' }, h('h2', {}, 'Touch feedback'),
      h('label', { class: 'check check--switch', for: 'buzz' }, buzz, h('span', {}, 'A light tap on your finger when you move along a chart or flip a switch.')),
      !hapticsSupported() && h('p', { class: 'hint' }, 'This device does not allow web apps to vibrate (iPhones and iPads do not). The setting is kept for your other devices.'));
    return [h('section', { class: 'panel stack' }, h('h2', {}, 'Theme'), themeOpts), h('section', { class: 'panel stack' }, h('h2', {}, 'Text size'), h('div', { class: 'size-control' }, slider.el, prev)), touch];
  };

  const privacy = () => {
    const hide = h('input', { type: 'checkbox', id: 'hide' }); hide.checked = !!S().hideAmounts;
    hide.addEventListener('change', async () => { await env.save({ hideAmounts: hide.checked }); env.applyAppearance(); env.flashAmounts(); env.paintChrome('settings'); setValue('privacy', hideText()); });
    return [h('section', { class: 'panel stack' }, h('h2', {}, 'Hide amounts'), h('label', { class: 'check check--switch', for: 'hide' }, hide, h('span', {}, 'Hide amounts on screen (percentages stay visible). You can also use the eye at the top.')))];
  };

  const device = () => [installPanel({ toast }),
    h('section', { class: 'panel stack' }, h('h2', {}, 'Sample portfolio'), h('p', { class: 'sub' }, sampleLive ? 'The sample portfolio is on this device. It is made up and can be removed without touching your own records.' : 'Adds a made-up portfolio (land, a rental flat, a car, a treasury bill and a partnership) so you can explore Apex before adding real records.'),
      sampleLive ? h('button', { class: 'btn btn--secondary', type: 'button', onclick: (e) => withBusy(e.currentTarget, () => env.removeSample(ctx)) }, 'Remove the sample portfolio') : env.sampleButton(ctx))];

  const danger = () => [
    h('section', { class: 'panel panel--danger stack' }, h('h2', {}, 'Create a new recovery key'), h('p', { class: 'sub' }, 'Replaces your current recovery key with a new one. Save the new key somewhere safe straight away.'),
      h('button', { class: 'btn btn--danger', type: 'button', onclick: async () => {
        if (await confirmDialog({ title: 'Create a new recovery key?', body: 'Your current recovery key stops working. You will be shown the new one once, so have somewhere safe ready to keep it.', confirmLabel: 'Create new key', cancelLabel: 'Keep my key', danger: true })) actions.onRotateKey();
      } }, 'Create a new recovery key')),
    h('section', { class: 'panel panel--danger stack' }, h('h2', {}, 'Remove my data from this device'), h('p', { class: 'sub' }, 'Deletes the copy of your records stored in this browser and signs you out, for example on a shared computer. Apex first checks that everything is backed up online; signing in again brings it all back.'),
      h('button', { class: 'btn btn--danger', type: 'button', onclick: actions.onWipe }, 'Remove my data from this device'))];

  const BUILD = {
    profile, appearance, privacy, device, danger,
    documents: () => [documentsBackupPanel({ ctx, toast })],
    backup: () => [actions.sync ? syncPanel({ sync: actions.sync, toast, actions }) : h('section', { class: 'panel' }, h('p', { class: 'sub' }, 'Online backup is not available right now. Your records are stored encrypted on this device.'))],
  };
  const pane = active ? h('section', { class: 'sx-pane', 'aria-label': SETTINGS_SECTIONS[active][0] }, head(SETTINGS_SECTIONS[active][0]), ...BUILD[active]()) : null;
  return h('div', { class: `settings sx flow${slug ? ' sx--detail' : ''}` }, h('h1', { class: 'page-title sx-title' }, 'Settings'), h('div', { class: 'sx-grid' }, list, pane));
}
