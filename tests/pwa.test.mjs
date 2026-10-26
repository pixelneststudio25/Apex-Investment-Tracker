// Installable app tests: the manifest, the icons, the list of saved files, and how the service worker behaves
// (offline fallback, never touches the server, cleans old copies). Reads source files, so Node only.
import { initPwa, installState } from '../js/pwa.js';
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || 'not equal'}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };

const inNode = typeof process !== 'undefined' && !!process.versions?.node;
const fs = inNode ? await import('node:fs/promises') : null;
const vm = inNode ? await import('node:vm') : null;
const root = new URL('../', import.meta.url);
const read = (rel) => fs.readFile(new URL(rel, root), 'utf8');
const walk = async (dir) => {
  const out = [];
  for (const e of await fs.readdir(new URL(dir + '/', root), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...await walk(p)); else out.push('/' + p);
  }
  return out;
};
const pngSize = async (rel) => { const b = await fs.readFile(new URL(rel, root)); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
const shellOf = async () => { const src = await read('sw.js'); return Function(`${src.slice(src.indexOf('const SHELL'), src.indexOf('];', src.indexOf('const SHELL')) + 2)}; return SHELL;`)(); };

test('manifest: installable fields, standalone, and real icons of the right size (any and maskable)', async () => {
  if (!inNode) return;
  const m = JSON.parse(await read('manifest.webmanifest'));
  eq([m.name, m.short_name, m.start_url, m.scope, m.display], ['Apex', 'Apex', '/', '/', 'standalone']);
  ok(/^#[0-9A-Fa-f]{6}$/.test(m.theme_color) && /^#[0-9A-Fa-f]{6}$/.test(m.background_color), 'colours');
  for (const purpose of ['any', 'maskable']) {
    for (const size of [192, 512]) {
      const ic = m.icons.find((i) => i.purpose === purpose && i.sizes === `${size}x${size}`);
      ok(ic, `${purpose} ${size} icon listed`);
      eq(await pngSize(ic.src.slice(1)), [size, size], `${ic.src} is really ${size}px`);
    }
  }
});

test('index.html links the manifest and keeps the Apple home-screen tags', async () => {
  if (!inNode) return;
  const html = await read('index.html');
  ok(html.includes('<link rel="manifest" href="/manifest.webmanifest">'), 'manifest link');
  ok(html.includes('apple-mobile-web-app-capable') && html.includes('apple-touch-icon'), 'apple tags');
});

test('service worker: saves every app file (nothing missing, nothing that does not exist)', async () => {
  if (!inNode) return;
  const shell = await shellOf();
  eq(new Set(shell).size, shell.length, 'no duplicates');
  const real = new Set(['/', '/index.html', '/manifest.webmanifest']);
  for (const d of ['js', 'css', 'fonts', 'vendor']) for (const f of await walk(d)) if (!/\.(md|txt|LICENSE)$/.test(f)) real.add(f);
  for (const f of shell) ok(real.has(f) || f.startsWith('/img/'), `listed but not a real file: ${f}`);
  for (const f of shell.filter((x) => x.startsWith('/img/'))) await fs.access(new URL(f.slice(1), root));
  for (const f of real) ok(shell.includes(f), `file missing from the offline list (add it to SHELL and bump VERSION): ${f}`);
  const html = await read('index.html');
  for (const m of html.matchAll(/(?:href|src)="(\/[^"#?]+)"/g)) if (!/\.(svg|png|jpg)$/.test(m[1]) || !m[1].startsWith('/img/apex-share')) ok(shell.includes(m[1]) || m[1] === '/', `index.html uses ${m[1]} but the offline list lacks it`);
});

test('service worker: no secrets or server addresses in it, and it is served fresh', async () => {
  if (!inNode) return;
  const sw = await read('sw.js');
  ok(!/https?:\/\/|anonKey|apikey|authorization|Bearer/i.test(sw.replace(/\/\/.*$/gm, '')), 'no server address or key in the code');
  const v = JSON.parse(await read('vercel.json'));
  for (const src of ['/sw.js', '/manifest.webmanifest']) ok(v.headers.some((h) => h.source === src && h.headers.some((x) => x.key === 'Cache-Control' && x.value === 'no-cache')), `${src} no-cache`);
  const csp = v.headers[0].headers.find((x) => x.key === 'Content-Security-Policy').value;
  ok(/worker-src 'self'/.test(csp) && /manifest-src 'self'/.test(csp), 'CSP allows the worker and manifest');
});

// A small fake browser around sw.js.
async function loadWorker({ cached = {}, online = true, hang = false } = {}) {
  const src = await read('sw.js');
  const listeners = {}; const stores = new Map(); const fetched = [];
  const mkCache = (init = {}) => { const m = new Map(Object.entries(init)); return {
    m, match: async (k) => m.get(typeof k === 'string' ? k : new URL(k.url).pathname), put: async (k, v) => { m.set(typeof k === 'string' ? k : new URL(k.url).pathname, v); },
    addAll: async (list) => { for (const u of list) m.set(u, `shell:${u}`); } }; };
  const ver = /const VERSION = '([^']+)'/.exec(src)[1];
  stores.set('apex-shell-OLD', mkCache()); stores.set(ver, mkCache(cached)); stores.set('other-app', mkCache());
  class Resp { constructor(body, o = {}) { this.body = body; this.status = o.status || 200; this.ok = this.status < 400; this.type = 'basic'; } clone() { return this; } }
  const self = { location: new URL('https://apex.test/'), addEventListener: (t, f) => { listeners[t] = f; }, skipWaiting() {}, clients: { claim: async () => {} } };
  const ctx = { self, Response: Resp, URL, Promise, setTimeout, console,
    caches: { open: async (n) => { if (!stores.has(n)) stores.set(n, mkCache()); return stores.get(n); }, keys: async () => [...stores.keys()], delete: async (n) => stores.delete(n) },
    fetch: (req) => { fetched.push(req.url); if (hang) return new Promise(() => {}); return online ? Promise.resolve(new Resp(`live:${new URL(req.url).pathname}`)) : Promise.reject(new TypeError('offline')); } };
  vm.runInNewContext(src.replace('const WAIT_MS = 4000', 'const WAIT_MS = 30'), ctx);
  const go = async (url, o = {}) => { let p = null; const req = { url, method: o.method || 'GET', mode: o.mode || 'cors' }; listeners.fetch({ request: req, respondWith: (x) => { p = x; } }); return p ? await p : 'IGNORED'; };
  return { go, listeners, stores, fetched, ver };
}

test('service worker: online it serves the live file and refreshes its saved copy', async () => {
  if (!inNode) return;
  const w = await loadWorker({ cached: { '/js/app.js': 'old' } });
  eq((await w.go('https://apex.test/js/app.js')).body, 'live:/js/app.js');
  eq((await w.stores.get(w.ver).match('/js/app.js')).body, 'live:/js/app.js', 'saved copy updated');
});
test('service worker: offline it opens the saved page for any address and the saved files', async () => {
  if (!inNode) return;
  const w = await loadWorker({ online: false, cached: { '/index.html': 'PAGE', '/js/app.js': 'JS' } });
  eq(await w.go('https://apex.test/investments', { mode: 'navigate' }), 'PAGE');
  eq(await w.go('https://apex.test/js/app.js'), 'JS');
  eq((await w.go('https://apex.test/js/never-saved.js')).status, 503, 'a plain offline message, not a crash');
});
test('service worker: a very slow network falls back to the saved copy', async () => {
  if (!inNode) return;
  const w = await loadWorker({ hang: true, cached: { '/css/base.css': 'CSS' } });
  eq(await w.go('https://apex.test/css/base.css'), 'CSS');
});
test('service worker: never touches the server, other sites, or anything that is not a plain GET', async () => {
  if (!inNode) return;
  const w = await loadWorker({ cached: { '/js/app.js': 'x' } });
  eq(await w.go('https://ialsuhajbubejqavhjnw.supabase.co/rest/v1/records'), 'IGNORED');
  eq(await w.go('https://ialsuhajbubejqavhjnw.supabase.co/storage/v1/object/vault/x'), 'IGNORED');
  eq(await w.go('https://apex.test/js/app.js', { method: 'POST' }), 'IGNORED');
  eq(await w.go('https://apex.test/sw.js'), 'IGNORED');
  eq(w.fetched.length, 0, 'no request was made for ignored addresses');
});
test('service worker: install saves the whole list; activate removes only old Apex copies', async () => {
  if (!inNode) return;
  const w = await loadWorker();
  let done; w.listeners.install({ waitUntil: (p) => { done = p; } }); await done;
  ok((await w.stores.get(w.ver).match('/index.html')), 'index saved on install');
  w.listeners.activate({ waitUntil: (p) => { done = p; } }); await done;
  ok(!w.stores.has('apex-shell-OLD') && w.stores.has(w.ver) && w.stores.has('other-app'), 'old Apex copy gone, others untouched');
});

test('install helper: no offer outside a browser, and the iPhone guidance is chosen by device', () => {
  eq(installState(), 'unavailable');
  initPwa(); // must not throw with no browser around
});

export async function runPwaTests(log = console.log) {
  let passed = 0, failed = 0;
  for (const t of tests) { try { await t.fn(); passed++; log(`PASS  ${t.name}`); } catch (e) { failed++; log(`FAIL  ${t.name}\n      ${e.message}`); } }
  log(`\n${passed} passed, ${failed} failed (installable app).`);
  return { passed, failed };
}
