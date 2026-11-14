/* Shared behaviour: menu-bar clock, phone launcher, Control Panel sheet, and the opening zoom on the home page. */
(function () {
  var root = document.documentElement;

  /* ---- Menu-bar clock ---- */
  var clock = document.getElementById('clock');
  function tick() {
    var d = new Date();
    clock.textContent = d.toLocaleDateString(undefined, { weekday: 'short' }) + ' ' +
      d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  if (clock) { tick(); setInterval(tick, 15000); }

  /* ---- Launcher: the phone menu, drawn as an app grid ---- */
  var launchBtn = document.getElementById('launch-btn');
  var launcher = document.getElementById('launcher');
  if (launchBtn && launcher) {
    var setLauncher = function (open) {
      launcher.hidden = !open;
      launchBtn.setAttribute('aria-expanded', String(open));
      if (open) { var first = launcher.querySelector('.tile'); if (first) first.focus({ preventScroll: true }); }
    };
    launchBtn.addEventListener('click', function () { setLauncher(launcher.hidden); });
    document.getElementById('launcher-close').addEventListener('click', function () {
      setLauncher(false); launchBtn.focus();
    });
    launcher.addEventListener('click', function (e) {
      if (e.target.closest('.tile')) setLauncher(false);
    });
    document.addEventListener('click', function (e) {
      if (!launcher.hidden && !launcher.contains(e.target) && !launchBtn.contains(e.target)) setLauncher(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !launcher.hidden) { setLauncher(false); launchBtn.focus(); }
    });
    window.matchMedia('(min-width: 641px)').addEventListener('change', function (m) {
      if (m.matches) setLauncher(false);
    });
  }

  /* ---- Agent view: plain text for AI agents ---- */
  var agentBtn = document.getElementById('agent-toggle');
  function setAgent(on, save) {
    root.classList.toggle('agent', on);
    if (agentBtn) agentBtn.setAttribute('aria-pressed', String(on));
    if (save) { try { localStorage.setItem('amend-agent', on ? '1' : '0'); } catch (e) {} }
  }
  setAgent(root.classList.contains('agent'), false);
  if (agentBtn) {
    agentBtn.addEventListener('click', function () {
      var on = !root.classList.contains('agent');
      setAgent(on, true);
      // Drop ?agent from the address so the saved choice wins on reload.
      if (/[?&]agent\b/.test(location.search)) {
        try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
      }
    });
  }

  /* ---- Info buttons: show or hide a short description ---- */
  document.querySelectorAll('.info-btn').forEach(function (btn) {
    var target = document.getElementById(btn.getAttribute('aria-controls'));
    if (!target) return;
    btn.addEventListener('click', function () {
      var open = target.hidden;
      target.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
    });
  });

  /* ---- Control panel: a sheet that swipes up from the bottom edge ---- */
  var STORE = 'amend-controls-v5';
  var DEFAULTS = { hue: 206, contrast: 155, brightness: 100, grid: true, text: false, still: false };
  var prefs = {};
  try { prefs = JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) {}
  Object.keys(DEFAULTS).forEach(function (k) { if (!(k in prefs)) prefs[k] = DEFAULTS[k]; });
  function save() { try { localStorage.setItem(STORE, JSON.stringify(prefs)); } catch (e) {} }

  var sliders = {
    hue: [document.getElementById('theme-color'), document.getElementById('theme-color-value'), '°'],
    contrast: [document.getElementById('contrast'), document.getElementById('contrast-value'), '%'],
    brightness: [document.getElementById('brightness'), document.getElementById('brightness-value'), '%']
  };
  var switches = {
    grid: document.getElementById('opt-grid'),
    text: document.getElementById('opt-text'),
    still: document.getElementById('opt-motion')
  };

  function apply() {
    // One accent for every button on the site.
    root.style.setProperty('--accent-h', prefs.hue);
    root.style.setProperty('--page-contrast', 'contrast(' + prefs.contrast + '%)');
    root.style.setProperty('--bg-brightness', prefs.brightness + '%');
    Object.keys(sliders).forEach(function (k) {
      sliders[k][0].value = prefs[k];
      sliders[k][1].textContent = prefs[k] + sliders[k][2];
    });
    root.classList.toggle('no-grid', !prefs.grid);
    root.classList.toggle('large-text', prefs.text);
    root.classList.toggle('still', prefs.still);
    Object.keys(switches).forEach(function (k) {
      switches[k].setAttribute('aria-pressed', String(prefs[k]));
    });
  }

  Object.keys(sliders).forEach(function (k) {
    sliders[k][0].addEventListener('input', function () {
      prefs[k] = parseInt(this.value, 10); apply(); save();
    });
  });
  Object.keys(switches).forEach(function (k) {
    switches[k].addEventListener('click', function () {
      prefs[k] = !prefs[k]; apply(); save();
    });
  });
  document.getElementById('opt-reset').addEventListener('click', function () {
    Object.keys(DEFAULTS).forEach(function (k) { prefs[k] = DEFAULTS[k]; });
    apply(); save();
  });
  apply();

  var sheet = document.getElementById('controls');
  var handle = document.getElementById('controls-toggle');
  var sheetBody = document.getElementById('controls-body');
  function setSheet(open) {
    sheet.classList.toggle('is-open', open);
    handle.setAttribute('aria-expanded', String(open));
    sheetBody.inert = !open;
  }
  setSheet(false);

  // Drag the handle: the sheet follows the finger, then settles open or
  // closed. A short tap (or Enter/Space) just toggles it.
  var drag = null, dragged = false;
  function travel() { return sheet.offsetHeight - handle.offsetHeight; }
  handle.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    drag = { y: e.clientY, start: sheet.classList.contains('is-open') ? 0 : travel(), max: travel(), offset: null };
    dragged = false;
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var dy = e.clientY - drag.y;
    if (!dragged && Math.abs(dy) < 6) return;
    dragged = true;
    sheet.classList.add('is-dragging');
    drag.offset = Math.min(drag.max, Math.max(0, drag.start + dy));
    sheet.style.transform = 'translateY(' + drag.offset + 'px)';
  });
  function endDrag() {
    if (!drag) return;
    if (dragged && drag.offset !== null) {
      var moved = drag.offset - drag.start;
      var open = drag.start === 0 ? moved < drag.max * 0.25 : moved < -drag.max * 0.25;
      sheet.classList.remove('is-dragging');
      sheet.style.transform = '';
      setSheet(open);
    }
    drag = null;
  }
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
  handle.addEventListener('click', function () {
    if (dragged) { dragged = false; return; }
    setSheet(!sheet.classList.contains('is-open'));
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && sheet.classList.contains('is-open')) { setSheet(false); handle.focus(); }
  });
  document.addEventListener('pointerdown', function (e) {
    if (sheet.classList.contains('is-open') && !sheet.contains(e.target) &&
        !e.target.closest('[data-open-controls]')) setSheet(false);
  });
  document.querySelectorAll('[data-open-controls]').forEach(function (b) {
    b.addEventListener('click', function () { setSheet(!sheet.classList.contains('is-open')); });
  });

  /* ---- Opening zoom: outline rectangles grow from the menu-bar logo
     to the hero window, the way an old desktop opened a window. ---- */
  var hero = document.querySelector('.window-hero');
  var brand = document.querySelector('.brand');
  try {
    if (prefs.still) root.classList.remove('zoom-pending');
    if (root.classList.contains('zoom-pending') && hero && brand) {
      var from = brand.getBoundingClientRect();
      var to = hero.getBoundingClientRect();
      var steps = 9, i = 0, live = [];
      var timer = setInterval(function () {
        i++;
        var t = i / steps;
        var r = document.createElement('div');
        r.className = 'zoomrect';
        r.style.left = (from.left + (to.left - from.left) * t) + 'px';
        r.style.top = (from.top + (to.top - from.top) * t) + 'px';
        r.style.width = (from.width + (to.width - from.width) * t) + 'px';
        r.style.height = (from.height + (to.height - from.height) * t) + 'px';
        document.body.appendChild(r);
        live.push(r);
        if (live.length > 3) live.shift().remove();
        if (i >= steps) {
          clearInterval(timer);
          setTimeout(function () {
            live.forEach(function (n) { n.remove(); });
            root.classList.remove('zoom-pending');
          }, 40);
        }
      }, 28);
    }
  } catch (e) {
    root.classList.remove('zoom-pending');
  }
  // Never leave the hero hidden.
  setTimeout(function () { root.classList.remove('zoom-pending'); }, 1500);
})();
