// Beispiel-Chat mit gemockten Assistenten, nachgebaut nach der App.
// Vorlesen über die Browser-Sprachausgabe (Vorschau, nicht die Qwen3-TTS-Stimmen).
(function () {
  'use strict';
  var SM = window.SM || { en: false, root: '', t: function (de) { return de; } };
  var root = document.querySelector('[data-demo]');
  if (!root) return;

  // blocks: { p: Absatz } oder { h: Überschrift, items: [Listenpunkte] }
  var DATA_DE = [
    { name: 'Robin', role: 'Zusammenfasser', avatar: 'assets/avatars/avatar-17.webp', pitch: 1.05, rate: 1,
      q: 'Was ist die STVO?',
      blocks: [
        { h: 'Kernaussagen:', items: [
          'Die StVO steht für Straßenverkehrs-Ordnung.',
          'Sie wurde am 6. März 2013 neu erlassen und trat am 1. April 2013 in Kraft.',
          'Zuletzt wurde sie durch Artikel 4 der Verordnung vom 30. Januar 2026 geändert.' ] },
        { h: 'Offene Punkte:', items: [
          'Warum und auf welche Weise die StVO geändert wurde, geht aus den Quellen nicht hervor.' ] }
      ], src: 'Wissenspaket „Straßenverkehrs-Ordnung“' },
    { name: 'Clara', role: 'Vertragsprüferin', avatar: 'assets/avatars/avatar-11.webp', pitch: 1.15, rate: 1,
      q: 'Welche Kündigungsfrist gilt im Wartungsvertrag mit der Müller GmbH?',
      blocks: [
        { p: 'Der Wartungsvertrag kann mit einer Frist von drei Monaten zum Jahresende gekündigt werden.' },
        { p: 'Ohne fristgerechte Kündigung verlängert er sich automatisch um ein weiteres Jahr.' }
      ], src: 'Wartungsvertrag_Mueller.pdf, § 8 Laufzeit und Kündigung' },
    { name: 'Jonas', role: 'HR-Berater', avatar: 'assets/avatars/avatar-12.webp', pitch: 0.8, rate: 0.95,
      q: 'Wie viele Urlaubstage stehen neuen Mitarbeitenden im ersten Jahr zu?',
      blocks: [
        { h: 'Laut Betriebsvereinbarung:', items: [
          '30 Urlaubstage pro Jahr.',
          'Im Eintrittsjahr wird der Anspruch anteilig pro vollem Monat berechnet.' ] }
      ], src: 'Betriebsvereinbarung_Urlaub.docx, Abschnitt 2' },
    { name: 'Sam', role: 'Technischer Support', avatar: 'assets/avatars/avatar-16.webp', pitch: 0.95, rate: 1.05,
      q: 'Wie ist der Status von Ticket 4711?',
      blocks: [
        { p: 'Ticket 4711 ist aktuell in Bearbeitung. Es wurde gestern dem Second-Level-Support zugewiesen, die nächste Rückmeldung wird bis morgen Mittag erwartet.' }
      ], src: 'Werkzeug „Support-Tickets“: get_ticket_status', tool: true }
  ];
  var DATA_EN = [
    { name: 'Robin', role: 'Summarizer', avatar: 'assets/avatars/avatar-17.webp', pitch: 1.05, rate: 1,
      q: 'What is the StVO?',
      blocks: [
        { h: 'Key points:', items: [
          'StVO stands for Straßenverkehrs-Ordnung, the German road traffic regulations.',
          'It was reissued on 6 March 2013 and came into force on 1 April 2013.',
          'It was last amended by Article 4 of the ordinance of 30 January 2026.' ] },
        { h: 'Open points:', items: [
          'Why and in what way the StVO was amended is not stated in the sources.' ] }
      ], src: 'Knowledge package “Straßenverkehrs-Ordnung”' },
    { name: 'Clara', role: 'Contract reviewer', avatar: 'assets/avatars/avatar-11.webp', pitch: 1.15, rate: 1,
      q: 'What notice period applies to the maintenance contract with Müller GmbH?',
      blocks: [
        { p: 'The maintenance contract can be terminated with three months’ notice to the end of the year.' },
        { p: 'Without timely notice it renews automatically for another year.' }
      ], src: 'Wartungsvertrag_Mueller.pdf, § 8 Term and termination' },
    { name: 'Jonas', role: 'HR advisor', avatar: 'assets/avatars/avatar-12.webp', pitch: 0.8, rate: 0.95,
      q: 'How many vacation days do new employees get in their first year?',
      blocks: [
        { h: 'According to the works agreement:', items: [
          '30 vacation days per year.',
          'In the year of joining, the entitlement is prorated per full month.' ] }
      ], src: 'Betriebsvereinbarung_Urlaub.docx, section 2' },
    { name: 'Sam', role: 'Technical support', avatar: 'assets/avatars/avatar-16.webp', pitch: 0.95, rate: 1.05,
      q: 'What is the status of ticket 4711?',
      blocks: [
        { p: 'Ticket 4711 is currently in progress. It was assigned to second-level support yesterday; the next update is expected by tomorrow noon.' }
      ], src: 'Tool “Support tickets”: get_ticket_status', tool: true }
  ];
  var DATA = SM.en ? DATA_EN : DATA_DE;

  var tabs = root.querySelector('.demo-tabs');
  var chat = root.querySelector('.demo-chat');
  var note = root.querySelector('[data-demo-note]');
  var canSpeak = 'speechSynthesis' in window;
  var stopCurrent = null;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function spokenText(d) {
    return d.blocks.map(function (b) {
      return b.p ? b.p : b.h + ' ' + b.items.join(' ');
    }).join(' ');
  }

  function fmt(sec) {
    var s = Math.max(0, Math.round(sec));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  // Player wie in der App: Play, Fortschrittsbalken, Zeit
  function player(d) {
    var text = spokenText(d);
    var total = text.length / (14 * d.rate);
    var box = el('div', 'player');
    var play = el('button', 'pl-btn', '▶');
    play.type = 'button';
    play.setAttribute('aria-label', SM.t('Vorlesen', 'Read aloud'));
    var bar = el('div', 'pl-bar');
    var fill = el('div', 'pl-fill');
    bar.appendChild(fill);
    var time = el('span', 'pl-time', '0:00 / ' + fmt(total));
    box.appendChild(play); box.appendChild(bar); box.appendChild(time);

    function reset() {
      play.textContent = '▶';
      fill.style.width = '0';
      time.textContent = '0:00 / ' + fmt(total);
      if (stopCurrent === reset) stopCurrent = null;
    }
    // Echte Aufnahme (assets/voices/demo-<name>.mp3 oder .wav), sonst Browser-Stimme
    // Die Aufnahmen sind deutsch: auf der englischen Seite spricht die Browser-Stimme (Vorschau).
    var sources = SM.en ? [] : ['mp3', 'wav'].map(function (ext) { return SM.root + 'assets/voices/demo-' + d.name.toLowerCase() + '.' + ext; });
    function playFile(k) {
      if (k >= sources.length) { playSynth(); return; }
      var a = new Audio(sources[k]);
      var started = false;
      a.addEventListener('error', function () { if (!started) playFile(k + 1); else reset(); });
      a.addEventListener('loadedmetadata', function () { total = a.duration; });
      a.addEventListener('timeupdate', function () {
        var p = a.duration ? a.currentTime / a.duration : 0;
        fill.style.width = (p * 100) + '%';
        time.textContent = fmt(a.currentTime) + ' / ' + fmt(a.duration || total);
      });
      a.addEventListener('ended', reset);
      a.play().then(function () {
        started = true;
        play.textContent = '❚❚';
        stopCurrent = function () { a.pause(); reset(); };
      }, function () { if (!started) playFile(k + 1); });
    }
    play.addEventListener('click', function () {
      var playing = play.textContent !== '▶';
      if (stopCurrent) stopCurrent();
      if (playing) return;
      playFile(0);
    });
    function playSynth() {
      if (!canSpeak) return;
      speechSynthesis.cancel();
      var ut = new SpeechSynthesisUtterance(text);
      ut.lang = SM.en ? 'en-US' : 'de-DE'; ut.pitch = d.pitch; ut.rate = d.rate;
      ut.onboundary = function (e) {
        var p = Math.min(1, e.charIndex / text.length);
        fill.style.width = (p * 100) + '%';
        time.textContent = fmt(p * total) + ' / ' + fmt(total);
      };
      ut.onend = ut.onerror = reset;
      play.textContent = '❚❚';
      stopCurrent = function () { speechSynthesis.cancel(); reset(); };
      speechSynthesis.speak(ut);
    }
    return box;
  }

  function render(i) {
    if (stopCurrent) stopCurrent();
    var d = DATA[i];
    Array.prototype.forEach.call(tabs.children, function (b, k) {
      b.setAttribute('aria-selected', k === i ? 'true' : 'false');
    });
    chat.textContent = '';

    // Kopfzeile wie in der App
    var head = el('div', 'chat-head');
    var hi = el('img'); hi.src = SM.root + d.avatar; hi.alt = ''; hi.width = 28; hi.height = 28;
    head.appendChild(hi);
    var ht = el('span', null, SM.t('Assistent: ', 'Assistant: '));
    ht.appendChild(el('b', null, d.name));
    head.appendChild(ht);
    head.appendChild(el('span', 'role', '▤ ' + d.role));
    head.appendChild(el('span', 'ai', SM.t('KI-Assistent', 'AI assistant')));
    chat.appendChild(head);

    var body = el('div', 'chat-body');
    var u = el('div', 'msg user');
    u.appendChild(el('div', 'bubble', d.q));
    body.appendChild(u);

    var m = el('div', 'msg bot');
    var img = el('img'); img.src = SM.root + d.avatar; img.alt = ''; img.width = 36; img.height = 36;
    var col = el('div', 'col');
    var who = el('div', 'who');
    who.appendChild(el('b', null, d.name));
    who.appendChild(el('span', null, SM.t(' KI-Assistent', ' AI assistant')));
    col.appendChild(who);
    var b = el('div', 'bubble');
    d.blocks.forEach(function (bl) {
      if (bl.p) { b.appendChild(el('p', null, bl.p)); return; }
      b.appendChild(el('p', null, bl.h));
      var ul = el('ul');
      bl.items.forEach(function (t) { ul.appendChild(el('li', null, t)); });
      b.appendChild(ul);
    });
    b.appendChild(el('div', 'src', (d.tool ? '' : SM.t('Quelle: ', 'Source: ')) + d.src));
    col.appendChild(b);
    col.appendChild(player(d));
    m.appendChild(img);
    m.appendChild(col);
    body.appendChild(m);
    chat.appendChild(body);

    note.textContent = SM.en
      ? 'Sample data. In the product, ' + d.name + ' has its own voice, assigned by the admin.'
      : 'Beispieldaten. ' + d.name + ' hat im Produkt eine eigene Stimme, die der Admin zuweist.';
  }

  DATA.forEach(function (d, i) {
    var t = el('button');
    t.type = 'button';
    t.setAttribute('role', 'tab');
    var im = el('img'); im.src = SM.root + d.avatar; im.alt = ''; im.width = 36; im.height = 36;
    var l = el('span', null, d.name);
    l.appendChild(el('small', null, d.role));
    t.appendChild(im);
    t.appendChild(l);
    t.addEventListener('click', function () { render(i); });
    tabs.appendChild(t);
  });
  render(0);
})();
