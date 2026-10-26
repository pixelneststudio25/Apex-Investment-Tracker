// Installing Apex on the home screen or desktop, and keeping the offline copy in place.
// The service worker only saves the app's own files. Records stay in the encrypted local database.

let deferred = null; // the browser's install offer, kept until the person asks for it
const listeners = new Set();
const tell = () => listeners.forEach((fn) => { try { fn(installState()); } catch (e) { console.error(e); } });

export const isStandalone = () => {
  try { if (typeof window === 'undefined') return false; return !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true; } catch (e) { return false; }
};
export const isIos = () => typeof navigator !== 'undefined' && (/iphone|ipad|ipod/i.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

// 'installed' (already open as an app), 'ready' (the browser can show its install prompt),
// 'ios' (needs Share > Add to Home Screen), or 'unavailable' (nothing to offer right now).
export function installState() {
  if (isStandalone()) return 'installed';
  if (deferred) return 'ready';
  if (isIos()) return 'ios';
  return 'unavailable';
}

export function onInstallChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export async function promptInstall() {
  if (!deferred) return 'unavailable';
  const offer = deferred; deferred = null;
  try { await offer.prompt(); const r = await offer.userChoice; tell(); return r && r.outcome === 'accepted' ? 'accepted' : 'dismissed'; }
  catch (e) { tell(); return 'dismissed'; }
}

export function initPwa() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; tell(); });
  window.addEventListener('appinstalled', () => { deferred = null; tell(); });
  if (!('serviceWorker' in navigator)) return;
  const register = () => navigator.serviceWorker.register('/sw.js').catch((e) => console.error('Offline copy could not be set up:', e));
  if (document.readyState === 'complete') register(); else window.addEventListener('load', register);
}
