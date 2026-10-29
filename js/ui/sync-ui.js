// Screens for backup and sync: the small status chip at the top, and the "Backup and sync" panel in Settings.
// The wording is the whole point here: it always says plainly whether your records are safe online.
import { fill, h } from './dom.js';
import { icon } from './icons.js';
import { withBusy } from './motion.js';

export function timeAgo(iso, nowMs = Date.now()) {
  const s = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m} ${m === 1 ? 'minute' : 'minutes'} ago`;
  const hr = Math.round(m / 60); if (hr < 24) return `${hr} ${hr === 1 ? 'hour' : 'hours'} ago`;
  const d = Math.round(hr / 24); return `${d} ${d === 1 ? 'day' : 'days'} ago`;
}

const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;

// -> { tone: 'ok' | 'busy' | 'warn' | 'bad' | 'idle', label, detail }
export function describeStatus(s, nowMs = Date.now()) {
  if (s.state === 'syncing') return { tone: 'busy', label: 'Syncing…', detail: 'Backing up your latest changes.' };
  if (s.state === 'offline') return { tone: 'warn', label: s.pending ? `Offline, ${s.pending} waiting` : 'Offline', detail: s.pending ? `You are offline. ${n(s.pending, 'change is', 'changes are')} saved on this device and will be backed up when you are back online.` : 'You are offline. Everything you have is saved on this device.' };
  if (s.state === 'auth') return { tone: 'warn', label: 'Sign in again to back up', detail: 'Your sign-in has expired, so backing up has paused. Lock Apex and unlock it with your password to continue.' };
  if (s.state === 'error' || (s.failed && s.failed.length)) return { tone: 'bad', label: 'Backup problem', detail: s.error || 'Something stopped your records from being backed up. Try Back up now.' };
  if (s.pending > 0) return { tone: 'warn', label: `${s.pending} waiting to back up`, detail: `${n(s.pending, 'change is', 'changes are')} saved on this device and not backed up yet.` };
  if (s.lastSyncedAt) return { tone: 'ok', label: 'Backed up', detail: `Everything is backed up. Last checked ${timeAgo(s.lastSyncedAt, nowMs)}.` };
  return { tone: 'idle', label: 'Not backed up yet', detail: 'Apex has not backed up yet in this session.' };
}

// The chip at the top of every screen. "Syncing…" only appears if a cycle takes a moment, so it never flickers.
export function statusChip(sync) {
  const el = h('span', { class: 'chip-status', role: 'status', 'data-tone': 'idle' });
  let showBusy = null, last = null;
  const paint = (s) => {
    const d = describeStatus(s);
    el.textContent = d.label; el.dataset.tone = d.tone; el.title = d.detail; el.setAttribute('aria-label', `${d.label}. ${d.detail}`);
  };
  sync.subscribe((s) => {
    if (!el.isConnected && last) { /* chip replaced by a re-render; keep painting, it is cheap */ }
    last = s;
    if (s.state === 'syncing') { if (!showBusy) showBusy = setTimeout(() => { showBusy = null; if (last.state === 'syncing') paint(last); }, 700); return; }
    if (showBusy) { clearTimeout(showBusy); showBusy = null; }
    paint(s);
  });
  return el;
}

export function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// The Settings panel. `actions` supplies exportBackup() and importBackup(text) (they know the signed-in account).
export function syncPanel({ sync, toast, actions }) {
  const status = h('p', { class: 'sync-status', 'aria-live': 'polite' });
  const detail = h('p', { class: 'sub' });
  const result = h('p', { class: 'sync-result', role: 'status', 'aria-live': 'polite', hidden: true });
  const say = (text, tone = 'ok') => { result.hidden = !text; result.textContent = text || ''; result.dataset.tone = tone; };
  const dot = h('span', { class: 'sync-dot', 'data-tone': 'idle', 'aria-hidden': 'true' });
  const paint = (s) => {
    const d = describeStatus(s); fill(status, dot, h('strong', {}, d.label)); dot.dataset.tone = d.tone; detail.textContent = d.detail;
  };

  const backUp = h('button', { class: 'btn', type: 'button', onclick: (e) => withBusy(e.currentTarget, async () => {
    say('');
    const s = await sync.run();
    if (s.state === 'synced' && !s.pending) { say('Everything is backed up.'); toast('Backed up.'); } else say(describeStatus(s).detail, s.state === 'error' ? 'bad' : 'warn');
  }) }, 'Back up now');

  const check = h('button', { class: 'btn btn--secondary', type: 'button', onclick: (e) => withBusy(e.currentTarget, async () => {
    say('');
    try {
      await sync.run();
      const v = await sync.verify();
      if (v.notBackedUp === 0 && v.historyPending === 0) say(v.local === 0 ? 'You have no records yet. Nothing to back up.' : `All ${n(v.local, 'record is', 'records are')} safely on the server.`);
      else say(`${n(v.notBackedUp, 'record is', 'records are')} not backed up yet${v.historyPending ? ` and ${n(v.historyPending, 'old version is', 'old versions are')} still waiting` : ''}. Press Back up now, and keep this page open until it says Backed up.`, 'warn');
    } catch (err) { say(err.code === 'OFFLINE' ? 'You are offline, so Apex cannot check right now.' : 'Apex could not check the backup. Please try again.', 'warn'); }
  }) }, 'Check my backup');

  const download = h('button', { class: 'btn btn--secondary', type: 'button', onclick: (e) => withBusy(e.currentTarget, async () => {
    try { const f = await actions.exportBackup(); downloadText(f.filename, f.text); say(`Saved ${n(f.records, 'record', 'records')} to ${f.filename}. The file is encrypted: only your password or recovery key can open it.`); }
    catch (err) { say('Could not create the backup file. Please try again.', 'bad'); console.error(err); }
  }) }, icon('download'), 'Download a backup file');

  const file = h('input', { type: 'file', accept: 'application/json,.json', class: 'visually-hidden', id: 'restore-file', tabindex: '-1' });
  file.addEventListener('change', async () => {
    const f = file.files?.[0]; file.value = '';
    if (!f) return;
    say('');
    try {
      const r = await actions.importBackup(await f.text());
      if (r.added + r.updated === 0) say(`Nothing to restore: this device already has everything in ${f.name} (or something newer).`);
      else { say(`Restored ${n(r.added + r.updated, 'record', 'records')} from the backup made ${String(r.exportedAt || '').slice(0, 10) || 'earlier'}. They will be backed up online shortly.`); sync.run(); window.dispatchEvent(new HashChangeEvent('hashchange')); }
    } catch (err) { say(err.code === 'BACKUP' || err.code === 'LOCKED' ? err.message : 'Could not restore from that file.', 'bad'); if (!err.code) console.error(err); }
  });
  const restore = h('button', { class: 'btn btn--secondary', type: 'button', onclick: () => file.click() }, 'Restore from a backup file');

  const panel = h('section', { class: 'panel stack sync-panel' },
    h('h2', {}, 'Backup and sync'),
    h('p', { class: 'sub' }, 'Apex locks your records on this device, then keeps a locked copy online. That is how you can open Apex on another phone or laptop, and how nothing is lost if this device is. The server cannot read your records.'),
    h('div', { class: 'sync-state' }, status, detail),
    h('div', { class: 'row' }, backUp, check),
    h('div', { class: 'row' }, download, restore, file),
    result);

  const off = sync.subscribe((s) => { if (!panel.isConnected && panel.dataset.shown) { off(); return; } paint(s); });
  setTimeout(() => { panel.dataset.shown = '1'; }, 2000); // only start cleaning up once the panel has had time to appear
  return panel;
}
