/* Shared behaviour: Control Panel, and the opening zoom on the home page. */
(function () {
  var root = document.documentElement;

  /* ---- Appearance: Classic (System 6), Aqua (Mac OS X) or Aero (Frutiger Aero) ---- */
  var themeButtons = document.querySelectorAll('[data-theme-choice]');
  function setTheme(theme, save) {
    if (theme === 'aqua' || theme === 'aero') root.setAttribute('data-theme', theme);
    else { theme = 'classic'; root.removeAttribute('data-theme'); }
    themeButtons.forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-theme-choice') === theme));
    });
    if (save) {
      try { localStorage.setItem('amend-theme', theme); } catch (e) {}
    }
  }
  themeButtons.forEach(function (b) {
    b.addEventListener('click', function () { setTheme(b.getAttribute('data-theme-choice'), true); });
  });
  setTheme(root.getAttribute('data-theme') || 'classic', false);

  /* ---- Control panel ---- */
  var hueInput = document.getElementById('theme-color');
  var contrastInput = document.getElementById('contrast');
  var brightnessInput = document.getElementById('brightness');
  var hueValue = document.getElementById('theme-color-value');
  var contrastValue = document.getElementById('contrast-value');
  var brightnessValue = document.getElementById('brightness-value');

  function applyTheme() {
    var hue = parseInt(hueInput.value, 10);
    var contrast = parseInt(contrastInput.value, 10);
    var brightness = parseInt(brightnessInput.value, 10);
    // Black and white stay put; only the logo's colored pixels shift hue.
    root.style.setProperty('--accent-filter', 'hue-rotate(' + hue + 'deg)');
    root.style.setProperty('--page-contrast', 'contrast(' + contrast + '%)');
    root.style.setProperty('--bg-brightness', brightness + '%');
    hueValue.textContent = hue + '°';
    contrastValue.textContent = contrast + '%';
    brightnessValue.textContent = brightness + '%';
  }
  hueInput.addEventListener('input', applyTheme);
  contrastInput.addEventListener('input', applyTheme);
  brightnessInput.addEventListener('input', applyTheme);
  applyTheme();

  var controls = document.getElementById('controls');
  var body = document.getElementById('controls-body');
  var toggle = document.getElementById('controls-cancel');
  function setMinimized(min) {
    controls.classList.toggle('is-minimized', min);
    body.hidden = min;
    toggle.setAttribute('aria-expanded', String(!min));
    toggle.setAttribute('aria-label', min ? 'Expand control panel' : 'Minimize control panel');
  }
  toggle.addEventListener('click', function () {
    setMinimized(!controls.classList.contains('is-minimized'));
  });
  if (window.matchMedia('(max-width: 900px)').matches) setMinimized(true);

  /* ---- Opening zoom: outline rectangles grow from the menu-bar logo
     to the hero window, the way the classic Finder opened a window. ---- */
  var hero = document.querySelector('.window-hero');
  var brand = document.querySelector('.brand');
  try {
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
