// Shows the branded splash until the app has drawn its first screen, then fades it out.
// Loaded as a classic script in <head>. Without JavaScript the splash never appears.
(function () {
  var root = document.documentElement;
  root.classList.add('is-booting');

  var start = Date.now(), finished = false, seen = false;
  try { seen = sessionStorage.getItem('apex.splash') === '1'; sessionStorage.setItem('apex.splash', '1'); } catch (e) { /* storage unavailable */ }
  var minMs = seen ? 0 : 750; // first open of the session lets the logo finish drawing

  function finish() {
    if (finished) return;
    finished = true;
    setTimeout(function () {
      root.classList.add('boot-done');
      setTimeout(function () { root.classList.remove('is-booting', 'boot-done'); }, 480);
    }, Math.max(0, minMs - (Date.now() - start)));
  }

  function hasContent(app) {
    for (var i = 0; i < app.childNodes.length; i++) {
      var n = app.childNodes[i];
      if (n.nodeType === 1 && n.tagName !== 'NOSCRIPT') return true;
      if (n.nodeType === 3 && n.textContent.trim()) return true;
    }
    return false;
  }
  function watch() {
    var app = document.getElementById('app');
    if (!app || hasContent(app)) return finish();
    try {
      new MutationObserver(function (_m, obs) { if (hasContent(app)) { obs.disconnect(); finish(); } }).observe(app, { childList: true });
    } catch (e) { finish(); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
  setTimeout(finish, 6000); // never trap the person behind the splash
})();
