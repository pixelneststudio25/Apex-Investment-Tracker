// Where the person came from, so "back" always goes somewhere that makes sense. Pages that belong to Settings (Reminders,
// Recently deleted, Export, My categories) always count as Settings. Help and Projections can be reached from Home or from
// Settings, so they go back to whichever one you were last on. The answer is kept for the tab so a reload does not lose it.
const KEY = 'apex.origin';
const SETTINGS_PAGES = new Set(['settings', 'deleted', 'export', 'statement', 'categories']);
const OUTLOOK_PAGES = new Set(['outlook', 'reminders']);
const store = (() => { try { return window.sessionStorage; } catch { return null; } })();
let origin = null;
try { origin = store?.getItem(KEY) || null; } catch { origin = null; }

/** Call on every route change with the hash parts (['settings', 'appearance'], ['help'], ...). */
export function noteRoute(parts) {
  const page = parts[0] || 'home';
  const next = SETTINGS_PAGES.has(page) ? 'settings' : OUTLOOK_PAGES.has(page) ? 'outlook' : page === 'investments' || page === 'new' ? 'investments' : page === 'home' ? 'home' : null;
  if (!next || next === origin) return;
  origin = next;
  try { store?.setItem(KEY, next); } catch { /* private mode: the answer just lives for this page load */ }
}
export const getOrigin = () => origin;

/** Where Help goes "back" to: Settings when you came from Settings, otherwise Home. */
export function backToOrigin() {
  return origin === 'settings' ? { text: 'Settings', href: '#/settings' } : origin === 'outlook' ? { text: 'Outlook', href: '#/outlook' } : { text: 'Home', href: '#/' };
}
/** Which bottom tab those pages light up, matching their back link. */
export function tabForShared() {
  return origin === 'settings' ? 'settings' : origin === 'outlook' ? 'outlook' : 'home';
}
