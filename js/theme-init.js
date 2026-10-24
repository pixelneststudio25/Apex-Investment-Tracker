// Runs before first paint (loaded synchronously in <head>) so the right theme shows with no flash.
// "Match device" = no data-theme attribute (the CSS follows the device). Light/Dark = attribute + saved choice.
(function () {
  var root = document.documentElement;
  var COLORS = { light: '#F7F4EC', dark: '#0B0F0D' }; // keep in step with --bg in tokens.css
  try {
    var t = localStorage.getItem('apex.theme'); // 'light' | 'dark' | null (follow device)
    if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t);
  } catch (e) { /* storage unavailable: follow the device */ }

  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function resolved() {
    var a = root.getAttribute('data-theme');
    if (a === 'light' || a === 'dark') return a;
    return mq && mq.matches ? 'dark' : 'light';
  }
  // Keep the browser / status-bar colour in step with the active theme.
  function sync() {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', COLORS[resolved()]);
  }
  sync();
  try { new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['data-theme'] }); } catch (e) { /* old browser */ }
  if (mq) { if (mq.addEventListener) mq.addEventListener('change', sync); else if (mq.addListener) mq.addListener(sync); }
})();
