/* Hell/Dunkel: ohne Wahl gilt die Systemeinstellung, die Wahl wird nur lokal im Browser gemerkt. Dazu das Mobil-Menü. */
(function () {
  var KEY = 'sm-theme';
  var root = document.documentElement;
  var media = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  var stored = null;
  try { stored = localStorage.getItem(KEY); } catch (e) { /* gesperrter Speicher: Systemwahl */ }
  if (stored === 'light' || stored === 'dark') root.setAttribute('data-theme', stored);
  root.classList.add('js');

  // Sprache der Seite und Wurzelpfad (en/ liegt eine Ebene tiefer, data-root="../"); die Skripte der Seite nutzen window.SM.
  var EN = (root.getAttribute('lang') || 'de').slice(0, 2) === 'en';
  window.SM = {
    en: EN,
    root: root.getAttribute('data-root') || '',
    t: function (de, en) { return EN ? en : de; }
  };

  function effective() {
    return root.getAttribute('data-theme') || (media && media.matches ? 'dark' : 'light');
  }

  document.addEventListener('DOMContentLoaded', function () {
    // Kopfzeile: data-scrolled, sobald die Seite gescrollt ist (1-px-Wächter, kein Scroll-Listener)
    var head = document.querySelector('header.site');
    if (head && 'IntersectionObserver' in window) {
      var sentinel = document.createElement('div');
      sentinel.className = 'scroll-sentinel';
      sentinel.setAttribute('aria-hidden', 'true');
      document.body.insertBefore(sentinel, document.body.firstChild);
      new IntersectionObserver(function (entries) {
        head.toggleAttribute('data-scrolled', !entries[entries.length - 1].isIntersecting);
      }).observe(sentinel);
    }

    var nav = document.querySelector('nav.main');
    if (!nav) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-toggle';
    var cta = nav.querySelector('a.btn');
    nav.insertBefore(btn, cta);

    function paint() {
      var dark = effective() === 'dark';
      btn.textContent = dark ? SM.t('Hell', 'Light') : SM.t('Dunkel', 'Dark');
      btn.setAttribute('aria-label', dark ? SM.t('Zu hellem Design wechseln', 'Switch to light theme') : SM.t('Zu dunklem Design wechseln', 'Switch to dark theme'));
    }
    btn.addEventListener('click', function () {
      var next = effective() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem(KEY, next); } catch (e) { /* nur nicht merken */ }
      paint();
    });
    if (media && media.addEventListener) media.addEventListener('change', paint);
    paint();

    var toggle = document.querySelector('.nav-toggle');
    if (toggle) {
      function setOpen(open) {
        nav.classList.toggle('open', open);
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggle.textContent = open ? SM.t('Schließen', 'Close') : SM.t('Menü', 'Menu');
      }
      toggle.addEventListener('click', function () { setOpen(!nav.classList.contains('open')); });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && nav.classList.contains('open')) { setOpen(false); toggle.focus(); }
      });
      nav.addEventListener('click', function (e) { if (e.target.closest('a')) setOpen(false); });
    }
  });
})();
