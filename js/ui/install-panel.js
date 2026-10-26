// Settings panel: put Apex on the home screen or desktop so it opens like an app, even with no connection.
import { h } from './dom.js';
import { icon } from './icons.js';
import { installState, onInstallChange, promptInstall } from '../pwa.js';

const WORDS = {
  installed: 'Apex is open as an installed app on this device.',
  ready: 'Add Apex to this device so it opens in its own window, with no browser bars, and still opens when you have no connection. Your records stay encrypted on this device as before.',
  ios: 'On an iPhone or iPad: tap the Share button in Safari, then choose Add to Home Screen. Apex then opens like any other app and still opens with no connection.',
  unavailable: 'Open your browser menu and choose Install Apex (or Add to Home screen). If you do not see it, your browser may not support installing. Apex still works in a normal tab, and still opens with no connection once it has loaded here.',
};

export function installPanel({ toast }) {
  const text = h('p', { class: 'sub' });
  const row = h('div', { class: 'row' });
  const box = h('section', { class: 'panel stack' }, h('h2', {}, 'Install Apex'), text, row);
  const paint = (state = installState()) => {
    text.textContent = WORDS[state];
    row.replaceChildren();
    if (state === 'ready') row.append(h('button', { class: 'btn', type: 'button', onclick: async () => {
      const r = await promptInstall();
      if (r === 'accepted') toast('Apex is being added to your device.');
    } }, icon('download'), 'Install Apex'));
  };
  paint();
  const stop = onInstallChange(paint);
  // Stop listening once this panel has left the page.
  new MutationObserver((_m, obs) => { if (!box.isConnected && box.dataset.seen) { obs.disconnect(); stop(); } else if (box.isConnected) box.dataset.seen = '1'; })
    .observe(document.body, { childList: true, subtree: true });
  return box;
}
