/* ============================================================
   Opportunities archive
   - Public visitors: entries are read from data/opportunities.json.
   - Admin: a GitHub fine-grained token (Contents: read/write on this
     repo only) is stored in data/admin.json, encrypted with AES-GCM
     using a key derived from your password (PBKDF2-SHA256). Entering
     the password decrypts the token in memory, and new entries are
     committed straight to the repo through the GitHub API. GitHub
     Pages then republishes the site (usually within a minute).
   ============================================================ */
(function () {
  'use strict';

  var REPO = { owner: 'mcnoob12', repo: 'theamendwebsite', branch: 'main' };
  var DATA_PATH = 'data/opportunities.json';
  var ADMIN_PATH = 'data/admin.json';
  var IMG_DIR = 'assets/opportunities/';
  var API = 'https://api.github.com/repos/' + REPO.owner + '/' + REPO.repo + '/contents/';
  var ITERATIONS = 600000;
  var MAX_IMAGE_DIM = 1400;

  var entries = [];
  var token = null;            // decrypted GitHub token, kept in memory only
  var localImages = {};        // id -> data URL, shown until Pages republishes

  var $ = function (id) { return document.getElementById(id); };
  var grid = $('opp-grid');
  var empty = $('opp-empty');
  var statusEl = $('opp-status');
  var adminBar = $('opp-adminbar');
  var adminLink = $('opp-admin-link');
  var dialog = $('opp-dialog');
  var dialogTitle = $('opp-dialog-title');
  var unlockForm = $('opp-unlock-form');
  var setupForm = $('opp-setup-form');
  var entryForm = $('opp-entry-form');
  var preview = $('opp-preview');

  /* ---------------------------  encoding helpers  --------------------------- */
  function bytesToB64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }
  function b64ToBytes(b64) {
    var s = atob(String(b64).replace(/\s/g, ''));
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  function utf8ToB64(str) { return bytesToB64(new TextEncoder().encode(str)); }
  function b64ToUtf8(b64) { return new TextDecoder().decode(b64ToBytes(b64)); }

  /* ---------------------------  crypto  --------------------------- */
  async function deriveKey(password, salt, iterations) {
    var base = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encryptToken(tok, password) {
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var key = await deriveKey(password, salt, ITERATIONS);
    var ct = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(tok)));
    return { v: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS,
             salt: bytesToB64(salt), iv: bytesToB64(iv), ciphertext: bytesToB64(ct) };
  }
  async function decryptToken(blob, password) {
    var key = await deriveKey(password, b64ToBytes(blob.salt), blob.iterations);
    var pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64ToBytes(blob.iv) }, key, b64ToBytes(blob.ciphertext));
    return new TextDecoder().decode(pt);
  }

  /* ---------------------------  GitHub API  --------------------------- */
  async function gh(path, opts) {
    opts = opts || {};
    var res = await fetch(API + path + (opts.method ? '' : '?ref=' + REPO.branch + '&t=' + Date.now()), {
      method: opts.method || 'GET',
      cache: 'no-store',
      headers: {
        'Authorization': 'Bearer ' + (opts.token || token),
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    if (res.status === 404 && opts.allow404) return null;
    if (!res.ok) {
      var msg = '';
      try { msg = (await res.json()).message || ''; } catch (e) { /* ignore */ }
      var err = new Error('GitHub said ' + res.status + (msg ? ': ' + msg : ''));
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }
  function getFile(path, tok) { return gh(path, { token: tok, allow404: true }); }
  function putFile(path, contentB64, message, sha, tok) {
    var body = { message: message, content: contentB64, branch: REPO.branch };
    if (sha) body.sha = sha;
    return gh(path, { method: 'PUT', body: body, token: tok });
  }
  function deleteFile(path, sha, message) {
    return gh(path, { method: 'DELETE', body: { message: message, sha: sha, branch: REPO.branch } });
  }

  // Read-modify-write data/opportunities.json, retrying once if someone
  // (e.g. another tab) changed it in between.
  async function updateEntries(mutate, message) {
    for (var attempt = 0; attempt < 2; attempt++) {
      var file = await getFile(DATA_PATH);
      var list = file ? JSON.parse(b64ToUtf8(file.content) || '[]') : [];
      list = mutate(list);
      try {
        await putFile(DATA_PATH, utf8ToB64(JSON.stringify(list, null, 2) + '\n'),
                      message, file && file.sha);
        return list;
      } catch (e) {
        if (attempt === 0 && (e.status === 409 || e.status === 422)) continue;
        throw e;
      }
    }
  }

  /* ---------------------------  rendering  --------------------------- */
  function setStatus(text) {
    statusEl.textContent = text || '';
    statusEl.hidden = !text;
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function noImage(label) {
    var box = el('div', 'opp-card-img opp-card-noimg');
    box.appendChild(el('span', null, label));
    return box;
  }

  function render() {
    grid.textContent = '';
    empty.hidden = entries.length > 0;
    entries.forEach(function (entry) {
      var card = el('article', 'opp-card');

      var src = localImages[entry.id] ||
        (typeof entry.image === 'string' && entry.image.indexOf(IMG_DIR) === 0 ? entry.image : '');
      if (src) {
        var img = el('img', 'opp-card-img');
        img.src = src;
        img.alt = entry.name || '';
        img.loading = 'lazy';
        img.onerror = function () { img.replaceWith(noImage('Image unavailable')); };
        card.appendChild(img);
      } else {
        card.appendChild(noImage('No image'));
      }

      var body = el('div', 'opp-card-body');
      body.appendChild(el('h3', 'opp-card-name', entry.name));
      body.appendChild(el('div', 'opp-card-details', entry.details));

      var meta = el('dl', 'opp-card-meta');
      [['Venue', entry.venue], ['Timing', entry.timing]].forEach(function (pair) {
        if (!pair[1]) return;
        meta.appendChild(el('dt', null, pair[0]));
        meta.appendChild(el('dd', null, pair[1]));
      });
      body.appendChild(meta);

      if (token) {
        var del = el('button', 'opp-delete', 'Delete');
        del.type = 'button';
        del.addEventListener('click', function () { removeEntry(entry, del); });
        body.appendChild(del);
      }
      card.appendChild(body);
      grid.appendChild(card);
    });
  }

  async function loadPublic() {
    try {
      var res = await fetch(DATA_PATH + '?t=' + Date.now(), { cache: 'no-store' });
      entries = res.ok ? await res.json() : [];
      if (!Array.isArray(entries)) entries = [];
    } catch (e) {
      entries = [];
    }
    render();
  }

  // When unlocked, read straight from GitHub so recent edits show
  // even before Pages has republished.
  async function loadFromRepo() {
    var file = await getFile(DATA_PATH);
    entries = file ? JSON.parse(b64ToUtf8(file.content) || '[]') : [];
    render();
  }

  /* ---------------------------  dialog  --------------------------- */
  function showForm(form) {
    [unlockForm, setupForm, entryForm].forEach(function (f) {
      f.hidden = f !== form;
      f.querySelector('.opp-form-error').textContent = '';
    });
    dialogTitle.textContent = form.getAttribute('data-title');
    if (!dialog.open) dialog.showModal();
    var first = form.querySelector('input, textarea');
    if (first) first.focus();
  }
  function closeDialog() { if (dialog.open) dialog.close(); }
  function formError(form, msg) { form.querySelector('.opp-form-error').textContent = msg; }
  function setBusy(form, busy, label) {
    var btn = form.querySelector('button[type="submit"]');
    if (!btn.dataset.label) btn.dataset.label = btn.textContent;
    btn.disabled = busy;
    btn.textContent = busy ? (label || 'Working…') : btn.dataset.label;
  }

  async function fetchAdminBlob() {
    try {
      var res = await fetch(ADMIN_PATH + '?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return null;
      var blob = await res.json();
      return blob && blob.ciphertext ? blob : null;
    } catch (e) {
      return null;
    }
  }

  async function openAdmin() {
    if (token) { adminBar.hidden = false; showForm(entryForm); return; }
    var blob = await fetchAdminBlob();
    showForm(blob ? unlockForm : setupForm);
  }

  function enterAdminMode() {
    adminBar.hidden = false;
    adminLink.hidden = true;
    render();
    loadFromRepo().catch(function () { /* keep the public copy */ });
  }

  /* ---------------------------  handlers  --------------------------- */
  unlockForm.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var password = unlockForm.password.value;
    setBusy(unlockForm, true, 'Checking…');
    try {
      var blob = await fetchAdminBlob();
      if (!blob) { showForm(setupForm); return; }
      try {
        token = await decryptToken(blob, password);
      } catch (e) {
        formError(unlockForm, 'Wrong password.');
        return;
      }
      unlockForm.reset();
      enterAdminMode();
      showForm(entryForm);
    } finally {
      setBusy(unlockForm, false);
    }
  });

  $('opp-show-setup').addEventListener('click', function () { showForm(setupForm); });

  setupForm.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var tok = setupForm.token.value.trim();
    var pw = setupForm.password.value;
    if (pw.length < 12) return formError(setupForm, 'Use at least 12 characters.');
    if (pw !== setupForm.confirm.value) return formError(setupForm, 'Passwords do not match.');
    setBusy(setupForm, true, 'Saving…');
    try {
      // Checks the token can read the repo, and gets the current sha if
      // admin.json already exists (re-running setup).
      var existing = await getFile(ADMIN_PATH, tok);
      var blob = await encryptToken(tok, pw);
      await putFile(ADMIN_PATH, utf8ToB64(JSON.stringify(blob, null, 2) + '\n'),
                    'Update opportunities admin key', existing && existing.sha, tok);
      token = tok;
      setupForm.reset();
      enterAdminMode();
      setStatus('Setup saved. From now on, unlock with your password.');
      showForm(entryForm);
    } catch (e) {
      formError(setupForm, e.status === 401 || e.status === 403 || e.status === 404
        ? 'That token cannot write to ' + REPO.owner + '/' + REPO.repo + '. Check its repository access and Contents permission.'
        : e.message);
    } finally {
      setBusy(setupForm, false);
    }
  });

  entryForm.image.addEventListener('change', function () {
    var file = entryForm.image.files[0];
    if (!file) { preview.hidden = true; return; }
    preview.src = URL.createObjectURL(file);
    preview.hidden = false;
  });

  function resizeImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, MAX_IMAGE_DIM / Math.max(img.naturalWidth, img.naturalHeight));
        var w = Math.max(1, Math.round(img.naturalWidth * scale));
        var h = Math.max(1, Math.round(img.naturalHeight * scale));
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('Could not read that image. Try a JPG or PNG.'));
      };
      img.src = url;
    });
  }

  function slugify(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'entry';
  }

  entryForm.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    if (!token) return showForm(unlockForm);
    var f = entryForm;
    var entry = {
      id: slugify(f.name.value) + '-' + Date.now().toString(36),
      name: f.name.value.trim(),
      image: '',
      details: f.details.value.trim(),
      venue: f.venue.value.trim(),
      timing: f.timing.value.trim(),
      added: new Date().toISOString()
    };
    setBusy(f, true, 'Publishing…');
    try {
      var file = f.image.files[0];
      if (file) {
        var dataUrl = await resizeImage(file);
        entry.image = IMG_DIR + entry.id + '.jpg';
        await putFile(entry.image, dataUrl.split(',')[1], 'Add image for ' + entry.name);
        localImages[entry.id] = dataUrl;
      }
      entries = await updateEntries(function (list) {
        return [entry].concat(list);
      }, 'Add opportunity: ' + entry.name);
      render();
      f.reset();
      preview.hidden = true;
      closeDialog();
      setStatus('Published "' + entry.name + '". It appears for everyone once GitHub Pages republishes (about a minute).');
      document.getElementById('opportunities').scrollIntoView({ behavior: 'smooth' });
    } catch (e) {
      if (e.status === 401) {
        token = null;
        formError(f, 'GitHub rejected the saved token (it may have expired). Run setup again with a new token.');
      } else {
        formError(f, e.message);
      }
    } finally {
      setBusy(f, false);
    }
  });

  async function removeEntry(entry, btn) {
    if (!window.confirm('Delete "' + entry.name + '"?')) return;
    btn.disabled = true;
    btn.textContent = 'Deleting…';
    try {
      entries = await updateEntries(function (list) {
        return list.filter(function (e) { return e.id !== entry.id; });
      }, 'Remove opportunity: ' + entry.name);
      if (entry.image && entry.image.indexOf(IMG_DIR) === 0) {
        var img = await getFile(entry.image);
        if (img) await deleteFile(entry.image, img.sha, 'Remove image for ' + entry.name);
      }
      render();
      setStatus('Deleted "' + entry.name + '".');
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Delete';
      setStatus('Could not delete: ' + e.message);
    }
  }

  adminLink.addEventListener('click', openAdmin);
  $('opp-add').addEventListener('click', function () { showForm(entryForm); });
  $('opp-lock').addEventListener('click', function () {
    token = null;
    adminBar.hidden = true;
    adminLink.hidden = false;
    setStatus('');
    render();
  });
  $('opp-dialog-close').addEventListener('click', closeDialog);
  dialog.addEventListener('click', function (ev) { if (ev.target === dialog) closeDialog(); });

  if (location.hash === '#admin') openAdmin();
  loadPublic();
})();
