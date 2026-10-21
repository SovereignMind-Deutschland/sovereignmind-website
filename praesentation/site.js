(function () {
  'use strict';
  var slides = Array.prototype.slice.call(document.querySelectorAll('.slide'));
  var picker = document.querySelector('#picker');
  var status = document.querySelector('#status');
  var prev = document.querySelector('#prev');
  var next = document.querySelector('#next');
  var current = Math.max(0, Math.min(slides.length - 1, (parseInt(location.hash.slice(1), 10) || 1) - 1));

  // Fuß mit Seitentitel, Logo und Nummer an jede Inhaltsfolie hängen
  slides.forEach(function (s, i) {
    var o = document.createElement('option');
    o.value = i;
    o.textContent = (i + 1) + ' · ' + s.dataset.title;
    picker.appendChild(o);
    if (s.classList.contains('cover') || s.classList.contains('statement')) return;
    var f = document.createElement('div');
    f.className = 'foot';
    var l = document.createElement('span');
    l.textContent = 'SovereignMind · ' + s.dataset.title;
    var r = document.createElement('span');
    r.className = 'r';
    var n = document.createElement('span');
    n.textContent = String(i + 1).padStart(2, '0');
    var img = document.createElement('img');
    img.src = '../assets/logo.svg';
    img.alt = '';
    r.appendChild(n);
    r.appendChild(img);
    f.appendChild(l);
    f.appendChild(r);
    s.appendChild(f);
  });

  function show(n) {
    current = Math.max(0, Math.min(slides.length - 1, n));
    slides.forEach(function (s, i) {
      s.classList.toggle('active', i === current);
      s.setAttribute('aria-hidden', i !== current);
    });
    picker.value = current;
    status.textContent = (current + 1) + ' / ' + slides.length;
    prev.disabled = current === 0;
    next.disabled = current === slides.length - 1;
    history.replaceState(null, '', '#' + (current + 1));
  }

  function resize() {
    var s = Math.min(innerWidth / 1920, (innerHeight - 50) / 1080);
    document.documentElement.style.setProperty('--scale', s);
  }

  function full() {
    var p = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    if (p && p.catch) p.catch(function () { status.textContent = 'Vollbild nicht möglich'; });
  }

  prev.onclick = function () { show(current - 1); };
  next.onclick = function () { show(current + 1); };
  document.querySelector('#full').onclick = full;
  picker.onchange = function () { show(+picker.value); };

  addEventListener('keydown', function (e) {
    if (e.target.matches('select,input,textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
    if ([' ', 'ArrowRight', 'ArrowDown', 'PageDown'].indexOf(e.key) >= 0) { e.preventDefault(); show(current + 1); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp'].indexOf(e.key) >= 0) { e.preventDefault(); show(current - 1); }
    else if (e.key === 'Home') show(0);
    else if (e.key === 'End') show(slides.length - 1);
    else if (e.key.toLowerCase() === 'f') full();
  });
  addEventListener('hashchange', function () { show((parseInt(location.hash.slice(1), 10) || 1) - 1); });
  addEventListener('resize', resize);
  addEventListener('fullscreenchange', function () {
    document.querySelector('#full').textContent = document.fullscreenElement ? 'Vollbild beenden' : 'Vollbild';
    resize();
  });

  // Touch: Wischen
  var x0 = null;
  addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
  addEventListener('touchend', function (e) {
    if (x0 === null) return;
    var dx = e.changedTouches[0].clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 50) show(current + (dx < 0 ? 1 : -1));
  });

  if (location.search.indexOf('overview') >= 0) document.body.classList.add('overview');
  resize();
  show(current);
})();
