// Apex service worker. It keeps the app's own files on this device so Apex opens with no connection.
// It never stores anything from the server (Supabase) and never stores records: those are already
// encrypted in the browser's own database. Change VERSION whenever a file below is added or removed.
const VERSION = 'apex-shell-4';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/css/base.css',
  '/css/categories.css',
  '/css/components.css',
  '/css/documents.css',
  '/css/fonts.css',
  '/css/forms.css',
  '/css/home.css',
  '/css/help.css',
  '/css/manage.css',
  '/css/motion.css',
  '/css/picker.css',
  '/css/pin.css',
  '/css/reports.css',
  '/css/sync.css',
  '/css/tokens.css',
  '/css/workspace.css',
  '/fonts/apex-naira-wght-normal.woff2',
  '/fonts/geist-latin-ext-wght-normal.woff2',
  '/fonts/geist-latin-wght-normal.woff2',
  '/fonts/geist-mono-latin-wght-normal.woff2',
  '/fonts/inter-latin-ext-wght-normal.woff2',
  '/fonts/inter-latin-wght-normal.woff2',
  '/fonts/newsreader-latin-ext-opsz-normal.woff2',
  '/fonts/newsreader-latin-opsz-normal.woff2',
  '/fonts/newsreader-latin-wght-italic.woff2',
  '/fonts/newsreader-naira-opsz-normal.woff2',
  '/js/app.js',
  '/js/boot.js',
  '/js/config.js',
  '/js/core/auth.js',
  '/js/core/backup.js',
  '/js/core/crypto.js',
  '/js/core/db.js',
  '/js/core/doccrypt.js',
  '/js/core/files.js',
  '/js/core/idle.js',
  '/js/core/keys.js',
  '/js/core/kv.js',
  '/js/core/remote.js',
  '/js/core/store.js',
  '/js/core/supabase.js',
  '/js/core/sync.js',
  '/js/core/vault.js',
  '/js/engine/dates.js',
  '/js/engine/errors.js',
  '/js/engine/format.js',
  '/js/engine/index.js',
  '/js/engine/metrics.js',
  '/js/engine/money.js',
  '/js/engine/partners.js',
  '/js/engine/projection.js',
  '/js/engine/schedule.js',
  '/js/engine/value.js',
  '/js/engine/xirr.js',
  '/js/models/categories.js',
  '/js/models/docbackup.js',
  '/js/models/documents.js',
  '/js/models/export.js',
  '/js/models/help-content.js',
  '/js/models/inputs.js',
  '/js/models/manage.js',
  '/js/models/portfolio-projection.js',
  '/js/models/portfolio.js',
  '/js/models/projections.js',
  '/js/models/records.js',
  '/js/models/sample.js',
  '/js/models/schemas.js',
  '/js/models/templates.js',
  '/js/models/wizard.js',
  '/js/pwa.js',
  '/js/theme-init.js',
  '/js/ui/auth-views.js',
  '/js/ui/category-views.js',
  '/js/ui/charts.js',
  '/js/ui/dialog.js',
  '/js/ui/document-views.js',
  '/js/ui/dom.js',
  '/js/ui/fmt.js',
  '/js/ui/formkit.js',
  '/js/ui/forms.js',
  '/js/ui/help.js',
  '/js/ui/icons.js',
  '/js/ui/install-panel.js',
  '/js/ui/manage-views.js',
  '/js/ui/motion.js',
  '/js/ui/palette.js',
  '/js/ui/picker.js',
  '/js/ui/pin-views.js',
  '/js/ui/report-views.js',
  '/js/ui/sync-ui.js',
  '/js/ui/wizard.js',
  '/js/ui/workspace.js',
  '/vendor/decimal.mjs',
  '/vendor/supabase.js',
  '/img/apex-mark-512.png',
  '/img/apex-mark.svg',
  '/img/apex-wordmark.png',
  '/img/apple-touch-icon.png',
  '/img/favicon-32.png',
  '/img/favicon.svg',
  '/img/icon-192.png',
  '/img/icon-maskable-192.png',
  '/img/icon-maskable-512.png',
];
const WAIT_MS = 4000; // on a slow connection, fall back to the saved copy after this long

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('apex-shell-') && k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Network first, so a new deploy shows up as soon as you are online. The saved copy is used only
// when the network fails or is too slow. Only same-site GET requests are handled.
self.addEventListener('fetch', (event) => {
  const req = event.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname === '/sw.js') return;
  event.respondWith(handle(req));
});

async function handle(req) {
  const cache = await caches.open(VERSION);
  const nav = req.mode === 'navigate';
  const saved = () => cache.match(nav ? '/index.html' : req, { ignoreSearch: true });
  const copy = await saved();
  try {
    const live = fetch(req);
    // With a saved copy, give up on a slow network after WAIT_MS; with none, keep waiting for the network.
    const res = copy ? await Promise.race([live, new Promise((resolve) => setTimeout(() => resolve(null), WAIT_MS))]) : await live;
    if (!res) { live.catch(() => {}); return copy; }
    if (res.ok && (nav || res.type === 'basic')) cache.put(nav ? '/index.html' : req, res.clone());
    return res;
  } catch (e) {
    return copy || new Response('Apex is offline and this page was not saved yet.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}
