/* SEC Filing Analyzer — Analyze page logic (v2) */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var state = { matches: [], company: null, filter: 'ALL', shown: 12, lastRun: null, analysis: null };

  /* ---------- Preferences (remembered between visits) ---------- */
  var prefs = { level: 'easy', display: 'presentation' };
  try {
    prefs.level = localStorage.getItem('secfa_level') || 'easy';
    prefs.display = localStorage.getItem('secfa_display') || 'presentation';
  } catch (e) { /* private browsing */ }
  function savePrefs() {
    try {
      localStorage.setItem('secfa_level', prefs.level);
      localStorage.setItem('secfa_display', prefs.display);
    } catch (e) { /* ignore */ }
  }

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  var FORM_NAMES = {
    '10-K': 'Annual report', '10-K/A': 'Annual report (amended)',
    '10-Q': 'Quarterly report', '10-Q/A': 'Quarterly report (amended)',
    '8-K': 'Current report', '8-K/A': 'Current report (amended)',
    'S-1': 'IPO registration', 'S-1/A': 'IPO registration (amended)',
    '424B4': 'Prospectus', '424B5': 'Prospectus', 'S-3': 'Shelf registration',
    'S-8': 'Employee stock plan', 'DEF 14A': 'Proxy statement',
    'DEFA14A': 'Proxy material', '20-F': 'Annual report (foreign)',
    '6-K': 'Report (foreign)', '4': 'Insider trading report',
    '3': 'Initial insider ownership', '5': 'Annual insider report',
    'SC 13G': 'Ownership disclosure', 'SC 13G/A': 'Ownership disclosure',
    'SC 13D': 'Activist ownership disclosure', '13F-HR': 'Institutional holdings',
    '11-K': 'Employee plan annual report', 'ARS': 'Annual report to shareholders',
    'SD': 'Specialized disclosure', 'FWP': 'Free writing prospectus',
    '25-NSE': 'Delisting notice', 'CERT': 'Certification', 'PX14A6G': 'Shareholder letter'
  };

  /* ---------- Helpers ---------- */
  var statusTimer = null;
  function setStatus(msg, isError, busy) {
    if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
    var el = $('status');
    el.className = isError ? 'error' : '';
    el.textContent = msg || '';
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (busy && msg && !reduced) {
      var dots = 0;
      statusTimer = setInterval(function () {
        dots = (dots + 1) % 4;
        el.textContent = msg + ' ' + new Array(dots + 1).join('·');
      }, 400);
    }
  }

  function relTime(dateStr) {
    var then = new Date(dateStr + 'T00:00:00Z').getTime();
    if (isNaN(then)) return '';
    var days = Math.floor((Date.now() - then) / 86400000);
    if (days <= 0) return 'TODAY';
    if (days === 1) return '1 DAY AGO';
    if (days < 60) return days + ' DAYS AGO';
    var months = Math.floor(days / 30.44);
    if (months < 24) return months + ' MONTHS AGO';
    return Math.floor(months / 12) + ' YEARS AGO';
  }

  function formLabel(f) {
    return FORM_NAMES[f.form] || f.description || 'SEC filing';
  }

  function matchesFilter(f, key) {
    if (key === 'ALL') return true;
    if (key === 'OTHER') {
      return !(f.form.indexOf('10-K') === 0 || f.form.indexOf('10-Q') === 0 || f.form.indexOf('8-K') === 0);
    }
    return f.form.indexOf(key) === 0;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function dropIn(el) {
    el.classList.remove('hidden');
    el.classList.remove('drop-in');
    void el.offsetWidth;
    el.classList.add('drop-in');
  }

  /* ---------- Mode tabs ---------- */
  var panels = { search: $('panel-search'), upload: $('panel-upload'), url: $('panel-url') };
  function setMode(name) {
    ['search', 'upload', 'url'].forEach(function (m) {
      panels[m].classList.toggle('hidden', m !== name);
      $('mode-' + m).classList.toggle('active', m === name);
    });
    dropIn(panels[name]);
  }
  $('mode-search').addEventListener('click', function () { setMode('search'); });
  $('mode-upload').addEventListener('click', function () { setMode('upload'); });
  $('mode-url').addEventListener('click', function () { setMode('url'); });

  /* ---------- EDGAR search flow ---------- */
  $('search-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var q = $('search-input').value.trim();
    if (q) runSearch(q);
  });

  function runSearch(q) {
    $('dossier').classList.add('hidden');
    $('results').classList.add('hidden');
    setStatus('SCANNING EDGAR FOR "' + q.toUpperCase() + '"', false, true);
    fetch('/api/edgar?q=' + encodeURIComponent(q))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) { setStatus(data.error.toUpperCase(), true); return; }
        state.matches = data.matches || [];
        if (!state.matches.length) {
          setStatus('NO COMPANY FOUND FOR "' + q.toUpperCase() + '" — TRY THE FULL NAME OR THE STOCK TICKER', true);
          return;
        }
        loadCompany(state.matches[0]);
      })
      .catch(function () {
        setStatus('CONNECTION FAILED — CHECK YOUR INTERNET AND TRY AGAIN', true);
      });
  }

  function loadCompany(match) {
    setStatus('LOADING FILINGS FOR ' + (match.ticker || match.name).toUpperCase(), false, true);
    fetch('/api/edgar?cik=' + encodeURIComponent(match.cik))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) { setStatus(data.error.toUpperCase(), true); return; }
        state.company = data;
        state.filter = 'ALL';
        state.shown = 12;
        renderDossier(match);
        setStatus('');
      })
      .catch(function () {
        setStatus('CONNECTION FAILED — CHECK YOUR INTERNET AND TRY AGAIN', true);
      });
  }

  /* ---------- Dossier rendering ---------- */
  function renderDossier(activeMatch) {
    var c = state.company;
    $('acquired').textContent = 'TARGET ACQUIRED · CIK ' + c.cik;
    $('d-ticker').textContent = c.ticker || activeMatch.ticker || '—';
    $('d-name').textContent = c.name || activeMatch.name;

    var chips = $('statchips');
    chips.innerHTML = '';
    var chip1 = document.createElement('span');
    chip1.className = 'chip';
    chip1.textContent = c.total + ' FILINGS ON RECORD';
    chips.appendChild(chip1);
    if (c.filings.length) {
      var chip2 = document.createElement('span');
      chip2.className = 'chip';
      chip2.textContent = 'LATEST: ' + c.filings[0].form + ' · ' + relTime(c.filings[0].date);
      chips.appendChild(chip2);
    }

    var others = state.matches.filter(function (m) { return m.cik !== c.cik; });
    if (others.length) {
      var det = document.createElement('details');
      det.className = 'othermatches';
      var sum = document.createElement('summary');
      var firstWord = (c.name || '').split(' ')[0].toUpperCase().replace(/[^A-Z0-9]/g, '');
      sum.textContent = 'NOT ' + (firstWord || 'THIS ONE') + '? ▾';
      det.appendChild(sum);
      var drop = document.createElement('div');
      drop.className = 'dropdown';
      others.forEach(function (m) {
        var b = document.createElement('button');
        b.type = 'button';
        b.innerHTML = '<span class="tk">' + escapeHtml(m.ticker || '—') + '</span> &nbsp;' + escapeHtml(m.name);
        b.addEventListener('click', function () {
          det.removeAttribute('open');
          loadCompany(m);
        });
        drop.appendChild(b);
      });
      det.appendChild(drop);
      chips.appendChild(det);
    }

    renderFilters();
    renderRail();
    dropIn($('dossier'));
    $('dossier').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderFilters() {
    var keys = ['ALL', '10-K', '10-Q', '8-K', 'OTHER'];
    var wrap = $('filters');
    wrap.innerHTML = '';
    keys.forEach(function (k) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = k;
      if (k === state.filter) b.className = 'active';
      b.addEventListener('click', function () {
        state.filter = k;
        state.shown = 12;
        renderFilters();
        renderRail();
      });
      wrap.appendChild(b);
    });
  }

  function renderRail() {
    var rail = $('rail');
    rail.innerHTML = '';
    var list = state.company.filings.filter(function (f) { return matchesFilter(f, state.filter); });
    if (!list.length) {
      var p = document.createElement('p');
      p.className = 'muted';
      p.style.padding = '8px 0';
      p.textContent = 'No ' + (state.filter === 'ALL' ? '' : state.filter + ' ') + 'filings in the most recent records.';
      rail.appendChild(p);
      $('showmore').classList.add('hidden');
      return;
    }
    list.slice(0, state.shown).forEach(function (f, i) {
      var row = document.createElement('div');
      row.className = 'frow' + (i === 0 ? ' newest' : '');
      var inner = document.createElement('div');
      inner.className = 'inner';
      var left = document.createElement('div');
      left.innerHTML =
        '<span class="formtag">' + escapeHtml(f.form) + '</span> ' +
        '<span class="ftitle">' + escapeHtml(formLabel(f)) + '</span>' +
        '<div class="fdate">' + escapeHtml(f.date) + ' · ' + relTime(f.date) + '</div>';
      var go = document.createElement('button');
      go.type = 'button';
      go.className = 'go';
      go.textContent = 'Analyze →';
      go.addEventListener('click', function () { analyzeFiling(f); });
      var node = document.createElement('div');
      node.className = 'node';
      inner.appendChild(left);
      inner.appendChild(go);
      row.appendChild(node);
      row.appendChild(inner);
      rail.appendChild(row);
    });
    var more = $('showmore');
    if (list.length > state.shown) {
      more.classList.remove('hidden');
      more.textContent = 'SHOW MORE (' + (list.length - state.shown) + ')';
      more.onclick = function () { state.shown += 12; renderRail(); };
    } else {
      more.classList.add('hidden');
    }
  }

  $('launch').addEventListener('click', function () {
    if (state.company && state.company.filings.length) {
      analyzeFiling(state.company.filings[0]);
    }
  });

  function analyzeFiling(f) {
    if (!f.url) {
      setStatus('THIS FILING HAS NO READABLE DOCUMENT ON EDGAR', true);
      return;
    }
    runAnalysis(
      { type: 'url', url: f.url },
      {
        company: state.company ? state.company.name : '',
        ticker: state.company ? state.company.ticker : '',
        form: f.form,
        date: f.date
      }
    );
  }

  /* ---------- Upload flow ---------- */
  var dropzone = $('dropzone');
  var fileInput = $('file-input');
  dropzone.addEventListener('click', function () { fileInput.click(); });
  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
    fileInput.value = '';
  });
  ['dragover', 'dragenter'].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.remove('over'); });
  });
  dropzone.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  });

  function handleFile(file) {
    var name = (file.name || '').toLowerCase();
    var isPdf = file.type === 'application/pdf' || name.slice(-4) === '.pdf';
    var isImage = (file.type || '').indexOf('image/') === 0;
    if (isPdf) {
      extractPdf(file);
    } else if (isImage) {
      if (file.size > 3 * 1024 * 1024) {
        setStatus('THAT IMAGE IS OVER 3 MB — PLEASE USE A SMALLER ONE OR A PDF', true);
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        var base64 = String(reader.result).split(',')[1] || '';
        runAnalysis(
          { type: 'image', mimeType: file.type || 'image/png', data: base64 },
          { company: file.name }
        );
      };
      reader.onerror = function () { setStatus('COULD NOT READ THAT FILE', true); };
      reader.readAsDataURL(file);
    } else {
      setStatus('UNSUPPORTED FILE TYPE — PLEASE USE A PDF OR AN IMAGE', true);
    }
  }

  function extractPdf(file) {
    if (!window.pdfjsLib) {
      setStatus('THE PDF READER FAILED TO LOAD — REFRESH THE PAGE AND TRY AGAIN', true);
      return;
    }
    setStatus('OPENING PDF', false, true);
    file.arrayBuffer().then(function (data) {
      return window.pdfjsLib.getDocument({ data: data }).promise;
    }).then(function (pdf) {
      var text = '';
      var p = 1;
      function nextPage() {
        if (p > pdf.numPages || text.length > 320000) {
          if (text.replace(/\s+/g, '').length < 200) {
            setStatus('THIS PDF HAS NO READABLE TEXT (IT MAY BE A SCAN) — TRY UPLOADING IT AS AN IMAGE INSTEAD', true);
            return;
          }
          runAnalysis({ type: 'text', text: text }, { company: file.name });
          return;
        }
        setStatus('READING PDF — PAGE ' + p + ' OF ' + pdf.numPages, false, false);
        pdf.getPage(p).then(function (page) {
          return page.getTextContent();
        }).then(function (tc) {
          text += tc.items.map(function (it) { return it.str; }).join(' ') + '\n';
          p++;
          nextPage();
        }).catch(function () { p++; nextPage(); });
      }
      nextPage();
    }).catch(function () {
      setStatus('COULD NOT OPEN THAT PDF — THE FILE MAY BE CORRUPTED OR PASSWORD-PROTECTED', true);
    });
  }

  /* ---------- URL flow ---------- */
  $('url-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var url = $('url-input').value.trim();
    if (!url) return;
    if (url.indexOf('http') !== 0) url = 'https://' + url;
    runAnalysis({ type: 'url', url: url }, {});
  });

  /* ---------- Analysis ---------- */
  function runAnalysis(source, meta) {
    state.lastRun = { source: source, meta: meta || {} };
    $('results').classList.add('hidden');
    var phase = source.type === 'url'
      ? 'FETCHING DOCUMENT, THEN ANALYZING WITH GEMINI — USUALLY 15-45 SECONDS'
      : 'ANALYZING WITH GEMINI — USUALLY 15-45 SECONDS';
    setStatus(phase, false, true);
    fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'analyze', level: prefs.level, source: source, meta: meta || {} })
    })
      .then(function (r) {
        return r.json().then(function (d) { return { ok: r.ok, d: d }; });
      })
      .then(function (out) {
        if (!out.ok || out.d.error) {
          setStatus(String(out.d.error || 'ANALYSIS FAILED — PLEASE TRY AGAIN').toUpperCase(), true);
          return;
        }
        setStatus('');
        renderResults(out.d);
      })
      .catch(function () {
        setStatus('CONNECTION FAILED OR TIMED OUT — PLEASE TRY AGAIN', true);
      });
  }

  /* ---------- Results rendering ---------- */
  function renderResults(d) {
    state.analysis = d;
    var meta = (state.lastRun && state.lastRun.meta) || {};
    var metaBits = ['ANALYSIS COMPLETE'];
    if (d.form || meta.form) metaBits.push(d.form || meta.form);
    if (meta.date) metaBits.push(meta.date);
    if (d.period) metaBits.push(d.period);
    $('r-meta').textContent = metaBits.join(' · ').toUpperCase();
    var title = d.ticker || meta.ticker || d.company || meta.company || 'RESULTS';
    $('r-title').textContent = title;
    $('r-sub').textContent = (d.ticker || meta.ticker) ? (d.company || meta.company || '') : '';

    renderToggles();

    $('r-briefing').textContent = d.briefing || '';

    var mwrap = $('r-metrics');
    mwrap.innerHTML = '';
    (d.metrics || []).forEach(function (m) {
      var card = document.createElement('div');
      card.className = 'mcard';
      var dir = m.direction === 'up' ? 'up' : (m.direction === 'down' ? 'down' : 'flat');
      var arrow = dir === 'up' ? '▲ ' : (dir === 'down' ? '▼ ' : '— ');
      card.innerHTML =
        '<p class="mlabel">' + escapeHtml(m.label || '') + '</p>' +
        '<p class="mval">' + escapeHtml(m.value || '') + '</p>' +
        '<p class="mnote ' + dir + '">' + arrow + escapeHtml(m.note || '') + '</p>';
      mwrap.appendChild(card);
    });

    var swrap = $('r-sections');
    swrap.innerHTML = '';
    (d.sections || []).forEach(function (s) {
      var card = document.createElement('div');
      var tone = s.tone === 'positive' ? 'positive' : (s.tone === 'negative' ? 'negative' : 'neutral');
      card.className = 'scard';
      card.innerHTML =
        '<p class="stagrow"><span class="stag ' + tone + '">' + escapeHtml(s.tag || 'SECTION') + '</span></p>' +
        (s.title ? '<p class="stitle">' + escapeHtml(s.title) + '</p>' : '') +
        '<p class="sbody">' + escapeHtml(s.body || '') + '</p>';
      swrap.appendChild(card);
    });

    var lwrap = $('r-list');
    lwrap.innerHTML = '';
    (d.listSummary || []).forEach(function (item) {
      var li = document.createElement('li');
      li.textContent = item;
      lwrap.appendChild(li);
    });

    applyDisplay();
    updateDefHint();
    dropIn($('results'));
    $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function seg(container, options, active, onPick) {
    container.innerHTML = '';
    options.forEach(function (opt) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = opt;
      if (opt === active) b.className = 'on';
      b.addEventListener('click', function () { onPick(opt); });
      container.appendChild(b);
    });
  }

  function renderToggles() {
    seg($('display-toggle'), ['PRESENTATION', 'LIST'], prefs.display.toUpperCase(), function (v) {
      prefs.display = v.toLowerCase();
      savePrefs();
      renderToggles();
      applyDisplay();
    });
    seg($('level-toggle'), ['EASY', 'MEDIUM', 'EXPERT'], prefs.level.toUpperCase(), function (v) {
      var nl = v.toLowerCase();
      if (nl === prefs.level) return;
      prefs.level = nl;
      savePrefs();
      renderToggles();
      hideDefBtn();
      hideDefPop();
      updateDefHint();
      if (state.lastRun) {
        setStatus('RE-ANALYZING AT ' + v + ' LEVEL', false, true);
        runAnalysis(state.lastRun.source, state.lastRun.meta);
      }
    });
  }

  function applyDisplay() {
    var pres = prefs.display !== 'list';
    $('r-pres').classList.toggle('hidden', !pres);
    $('r-list-wrap').classList.toggle('hidden', pres);
  }

  /* ---------- Highlight to define (Easy mode) ---------- */
  var defCache = {};
  try { defCache = JSON.parse(localStorage.getItem('secfa_defs') || '{}') || {}; } catch (e) { defCache = {}; }
  function saveDefCache() {
    try {
      var keys = Object.keys(defCache);
      if (keys.length > 120) {
        keys.slice(0, keys.length - 120).forEach(function (k) { delete defCache[k]; });
      }
      localStorage.setItem('secfa_defs', JSON.stringify(defCache));
    } catch (e) { /* ignore */ }
  }

  var defBtn = document.createElement('button');
  defBtn.type = 'button';
  defBtn.className = 'defbtn hidden';
  defBtn.textContent = '✦ DEFINE';
  document.body.appendChild(defBtn);

  var defPop = document.createElement('div');
  defPop.className = 'defpop hidden';
  defPop.innerHTML = '<p class="dterm"></p><p class="dtext"></p>';
  document.body.appendChild(defPop);

  var pendingDef = null;

  function hideDefBtn() { defBtn.classList.add('hidden'); }
  function hideDefPop() { defPop.classList.add('hidden'); }

  function placeFixed(el, rect) {
    el.style.visibility = 'hidden';
    el.classList.remove('hidden');
    var w = el.offsetWidth, h = el.offsetHeight;
    var top = rect.top - h - 8;
    if (top < 8) top = rect.bottom + 8;
    var left = rect.left + rect.width / 2 - w / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    el.style.top = top + 'px';
    el.style.left = left + 'px';
    el.style.visibility = 'visible';
  }

  function sentenceAround(node, term) {
    var holder = node && node.nodeType === 3 ? node.parentElement : node;
    var full = holder ? String(holder.textContent || '') : '';
    if (!full) return '';
    var idx = full.toLowerCase().indexOf(term.toLowerCase());
    if (idx === -1) return full.slice(0, 300);
    var start = Math.max(full.lastIndexOf('.', idx), full.lastIndexOf('!', idx), full.lastIndexOf('?', idx));
    var endCandidates = [full.indexOf('.', idx), full.indexOf('!', idx), full.indexOf('?', idx)]
      .filter(function (n) { return n !== -1; });
    var end = endCandidates.length ? Math.min.apply(null, endCandidates) : full.length - 1;
    return full.slice(start + 1, end + 1).trim().slice(0, 400);
  }

  var selTimer = null;
  document.addEventListener('selectionchange', function () {
    if (selTimer) clearTimeout(selTimer);
    selTimer = setTimeout(handleSelection, 250);
  });

  function handleSelection() {
    if (prefs.level !== 'easy') { hideDefBtn(); return; }
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) { hideDefBtn(); return; }
    var text = sel.toString().trim();
    if (!text || text.length > 80 || text.split(/\s+/).length > 5) { hideDefBtn(); return; }
    var results = $('results');
    if (results.classList.contains('hidden') || !results.contains(sel.anchorNode)) {
      hideDefBtn();
      return;
    }
    var rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) { hideDefBtn(); return; }
    pendingDef = { term: text, context: sentenceAround(sel.anchorNode, text), rect: rect };
    hideDefPop();
    placeFixed(defBtn, rect);
  }

  defBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
  defBtn.addEventListener('click', function () {
    if (!pendingDef) return;
    var info = pendingDef;
    hideDefBtn();
    showDefinition(info);
  });

  function showDefinition(info) {
    var key = info.term.toLowerCase();
    defPop.querySelector('.dterm').textContent = info.term;
    var dtext = defPop.querySelector('.dtext');
    placeFixed(defPop, info.rect);
    if (defCache[key]) {
      dtext.textContent = defCache[key];
      placeFixed(defPop, info.rect);
      return;
    }
    dtext.textContent = 'Looking it up…';
    fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'define', term: info.term, context: info.context })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.error || !d.definition) {
          dtext.textContent = 'Could not get a definition right now — try again.';
        } else {
          defCache[key] = d.definition;
          saveDefCache();
          dtext.textContent = d.definition;
        }
        placeFixed(defPop, info.rect);
      })
      .catch(function () {
        dtext.textContent = 'Could not get a definition right now — try again.';
        placeFixed(defPop, info.rect);
      });
  }

  document.addEventListener('pointerdown', function (e) {
    if (!defPop.contains(e.target) && e.target !== defBtn) hideDefPop();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { hideDefBtn(); hideDefPop(); }
  });
  window.addEventListener('scroll', function () { hideDefBtn(); hideDefPop(); }, { passive: true });

  function updateDefHint() {
    $('def-hint').classList.toggle('hidden', prefs.level !== 'easy');
  }

  /* ---------- Auto-run ?q= from Home ---------- */
  var params = new URLSearchParams(window.location.search);
  var q = params.get('q');
  if (q) {
    $('search-input').value = q;
    runSearch(q);
  }
})();
