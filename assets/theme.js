/* Hell/Dunkel: ohne Wahl gilt die Systemeinstellung, die Wahl wird nur lokal im Browser gemerkt. */
(function () {
  var KEY = 'sm-theme';
  var root = document.documentElement;
  var media = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  var stored = null;
  try { stored = localStorage.getItem(KEY); } catch (e) { /* gesperrter Speicher: Systemwahl */ }
  if (stored === 'light' || stored === 'dark') root.setAttribute('data-theme', stored);

  function effective() {
    return root.getAttribute('data-theme') || (media && media.matches ? 'dark' : 'light');
  }

  document.addEventListener('DOMContentLoaded', function () {
    var nav = document.querySelector('nav.main');
    if (!nav) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-toggle';
    var cta = nav.querySelector('a.btn');
    nav.insertBefore(btn, cta);

    function paint() {
      var dark = effective() === 'dark';
      btn.textContent = dark ? 'Hell' : 'Dunkel';
      btn.setAttribute('aria-label', dark ? 'Zu hellem Design wechseln' : 'Zu dunklem Design wechseln');
    }
    btn.addEventListener('click', function () {
      var next = effective() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem(KEY, next); } catch (e) { /* nur nicht merken */ }
      paint();
    });
    if (media && media.addEventListener) media.addEventListener('change', paint);
    paint();
  });
})();
