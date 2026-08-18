/* Hukuk Notları — uygulama mantığı */
(function () {
  'use strict';

  var DB = self.HN_DB, SRS = self.HN_SRS, P = self.HN_PARSE;
  var CFG = self.HN_CONFIG || {};

  var state = {
    notes: [],
    view: 'bugun',
    session: null,
    editing: null,
    pending: null,
    limit: CFG.DAILY_LIMIT || 60
  };

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  function showUpdateBar() {
    var bar = $('#updateBar');
    if (!bar || !bar.classList.contains('hidden')) return;
    /* Çalışma ortasında sayfayı yenilemek oturumu düşürür; uyarısını ver. */
    $('#updateReload').previousElementSibling.textContent =
      state.session ? 'Yeni sürüm hazır — oturum sonunda yenile' : 'Yeni sürüm hazır';
    bar.classList.remove('hidden');
  }

  var TYPE_LABEL = {
    kart: 'Kart', not: 'Not', madde: 'Madde',
    sure: 'Süre', karsilastirma: 'Karıştırılanlar'
  };

  // =========================================================================
  // Açılış
  // =========================================================================
  function boot() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function (e) {
        console.warn('SW kaydı başarısız', e);
      });
      /* Yeni sürüm devreye girdiğinde service worker haber veriyor.
         Sayfa hâlâ eski dosyalarla çalıştığı için yenilemeyi kullanıcıya bırakıyoruz. */
      navigator.serviceWorker.addEventListener('message', function (e) {
        if (e.data && e.data.type === 'hn-updated') showUpdateBar();
      });
    }

    $('#updateReload').addEventListener('click', function () {
      location.reload();
    });

    bindTabs();
    bindAdd();
    bindList();
    bindSettings();
    bindEditor();
    bindDrill();

    DB.getMeta('limit', state.limit).then(function (v) {
      state.limit = Number(v) || 60;
      $('#dailyLimit').value = state.limit;
      return reload();
    });

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) reload();
    });
  }

  function reload() {
    return DB.all().then(function (list) {
      state.notes = list;
      refreshDersList();
      updateBadge();
      render();
    });
  }

  // =========================================================================
  // Sekmeler
  // =========================================================================
  var TITLES = {
    bugun: 'Bugün', notlar: 'Notlar', ekle: 'Not Ekle',
    istatistik: 'İstatistik', ayarlar: 'Ayarlar'
  };

  function bindTabs() {
    $$('nav.tabs button').forEach(function (b) {
      b.addEventListener('click', function () { go(b.dataset.view); });
    });
  }

  function go(v) {
    state.view = v;
    $$('.view').forEach(function (s) { s.classList.toggle('active', s.id === 'view-' + v); });
    $$('nav.tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.view === v); });
    $('#viewTitle').textContent = TITLES[v] || '';
    window.scrollTo(0, 0);
    render();
  }

  function render() {
    if (state.view === 'bugun') renderStudy();
    else if (state.view === 'notlar') renderList();
    else if (state.view === 'istatistik') renderStats();
    else if (state.view === 'ayarlar') renderPushStatus();
    else $('#viewSub').textContent = '';
  }

  function dueList() {
    var t = SRS.today();
    return state.notes.filter(function (n) { return SRS.isDue(n, t); });
  }

  function updateBadge() {
    var n = dueList().length;
    var el = $('#tabBadge');
    el.textContent = n > 99 ? '99+' : n;
    el.classList.toggle('hidden', n === 0);
    if (navigator.setAppBadge) {
      if (n > 0) navigator.setAppBadge(n).catch(function () {});
      else if (navigator.clearAppBadge) navigator.clearAppBadge().catch(function () {});
    }
  }

  // =========================================================================
  // Bugün / çalışma
  // =========================================================================
  function startSession() {
    var due = dueList();
    due.sort(function (a, b) {
      if (a.srs.due !== b.srs.due) return a.srs.due < b.srs.due ? -1 : 1;
      return Math.random() - 0.5;
    });
    state.session = {
      queue: due.slice(0, state.limit).map(function (n) { return n.id; }),
      done: 0,
      total: Math.min(due.length, state.limit),
      revealed: false
    };
    renderStudy();
  }

  function renderStudy() {
    var wrap = $('#studyWrap');
    var due = dueList();
    var s = state.session;

    if (!s) {
      $('#viewSub').textContent = '';
      if (!state.notes.length) {
        wrap.innerHTML = '<div class="empty"><div class="big">📖</div>' +
          'Henüz not yok.<br>“Ekle” sekmesinden başla — toplu yapıştırma en hızlısı.</div>' +
          '<button class="primary wide" id="goAdd">Not ekle</button>';
        $('#goAdd').addEventListener('click', function () { go('ekle'); });
        return;
      }
      if (!due.length) {
        var next = nextDueDate();
        wrap.innerHTML = '<div class="empty"><div class="big">✅</div>' +
          'Bugünlük tekrar bitti.<br><span class="small">' +
          (next ? 'Sıradaki tekrar: ' + esc(prettyDate(next)) : 'Sırada bekleyen kart yok.') +
          '</span></div>' +
          '<button class="wide" id="aheadBtn">Yine de çalış (ileriden 20 kart)</button>' +
          drillCard();
        $('#aheadBtn').addEventListener('click', studyAhead);
        bindDrillEntry();
        return;
      }
      wrap.innerHTML =
        '<div class="card center">' +
          '<div style="font-size:44px;font-weight:700;letter-spacing:-.03em">' + due.length + '</div>' +
          '<div class="muted small" style="margin-bottom:14px">kart tekrar bekliyor</div>' +
          '<button class="primary wide" id="startBtn">Çalışmaya başla</button>' +
        '</div>' + overdueNotice(due) + drillCard();
      $('#startBtn').addEventListener('click', startSession);
      bindDrillEntry();
      return;
    }

    if (!s.queue.length) {
      state.session = null;
      $('#viewSub').textContent = '';
      if (s.mode === 'serbest') {
        var missed = (s.missed || []).filter(function (id) { return byId(id); });
        wrap.innerHTML = '<div class="empty"><div class="big">🎯</div>' +
          'Serbest çalışma bitti.<br><span class="small">' +
          esc(s.label || '') + ' · ' + s.done + ' cevap' +
          (missed.length ? ' · ' + missed.length + ' tanesini bilemedin' : ' · hepsini bildin') +
          '</span></div>' +
          (missed.length
            ? '<button class="primary wide" id="redoMissed">Bilemediklerimi tekrar çalış (' +
              missed.length + ')</button><div class="spacer"></div>'
            : '') +
          '<button class="wide" id="newDrill">Yeni serbest çalışma</button>';
        if ($('#redoMissed')) $('#redoMissed').addEventListener('click', function () {
          startDrillWith(missed, 'Bilemediklerim', s.reschedule);
        });
        $('#newDrill').addEventListener('click', function () { openDrill({}); });
      } else {
        wrap.innerHTML = '<div class="empty"><div class="big">🎉</div>' +
          'Oturum tamamlandı — ' + s.done + ' tekrar.</div>' + drillCard();
        bindDrillEntry();
      }
      updateBadge();
      return;
    }

    var note = byId(s.queue[0]);
    if (!note) { s.queue.shift(); return renderStudy(); }

    var pct = s.total ? Math.round((s.done / (s.done + s.queue.length)) * 100) : 0;
    $('#viewSub').textContent = s.done + ' / ' + (s.done + s.queue.length);

    var html =
      (s.mode === 'serbest'
        ? '<div class="session-tag"><span class="pill gold">Serbest</span>' +
          '<span>' + esc(s.label || '') + '</span>' +
          (s.reschedule ? '' : '<span class="muted tiny">· plan etkilenmiyor</span>') + '</div>'
        : '') +
      '<div class="progress"><i style="width:' + pct + '%"></i></div>' +
      '<div class="study-card">' +
        '<div class="study-meta">' +
          '<span class="pill accent">' + esc(note.ders || 'Genel') + '</span>' +
          (note.konu ? '<span class="pill">' + esc(note.konu) + '</span>' : '') +
          '<span class="pill">' + esc(TYPE_LABEL[note.type] || note.type) + '</span>' +
        '</div>' +
        '<div class="study-front">' + esc(note.front) + '</div>';

    if (s.revealed) {
      html += '<div class="study-back">' + esc(note.back || '—') + '</div>';
      if (note.kaynak) html += '<div class="study-src">' + esc(note.kaynak) + '</div>';
      if (note.tags && note.tags.length) {
        html += '<div>' + note.tags.map(function (t) {
          return '<span class="pill gold">#' + esc(t) + '</span>';
        }).join('') + '</div>';
      }
    }
    html += '</div>';

    if (s.revealed) {
      html += (s.mode === 'serbest' && !s.reschedule
        ? '<div class="grades two">' +
            '<button data-g="bilemedim">Bilemedim<span class="when">yine sorulur</span></button>' +
            '<button data-g="bildim">Bildim<span class="when">bu tur bitti</span></button>' +
          '</div>'
        : '<div class="grades">' +
            grade('tekrar', 'Tekrar', note) +
            grade('zor', 'Zor', note) +
            grade('normal', 'Normal', note) +
            grade('kolay', 'Kolay', note) +
          '</div>') +
      '<div class="spacer"></div>' +
      '<div class="row"><button class="ghost small" id="editCur">Bu notu düzenle</button>' +
      '<button class="ghost small" id="stopBtn">Oturumu bitir</button></div>';
    } else {
      html += '<div class="spacer"></div><button class="primary wide" id="showBtn">Cevabı göster</button>' +
        '<div class="spacer"></div>' +
        '<div class="row"><button class="ghost small" id="editCur">Bu notu düzenle</button>' +
        '<button class="ghost small" id="stopBtn">Oturumu bitir</button></div>';
    }

    wrap.innerHTML = html;

    if ($('#showBtn')) $('#showBtn').addEventListener('click', function () {
      s.revealed = true; renderStudy();
    });
    $$('.grades button').forEach(function (b) {
      b.addEventListener('click', function () { answer(note, b.dataset.g); });
    });
    $('#editCur').addEventListener('click', function () { openEditor(note); });
    $('#stopBtn').addEventListener('click', function () {
      state.session = null; renderStudy(); updateBadge();
    });
  }

  function grade(g, label, note) {
    return '<button data-g="' + g + '">' + label +
      '<span class="when">' + esc(SRS.preview(note.srs, g)) + '</span></button>';
  }

  function overdueNotice(due) {
    var t = SRS.today();
    var late = due.filter(function (n) { return n.srs.due < t; }).length;
    if (!late) return '';
    return '<div class="notice warn"><b>' + late + ' kart gecikmiş</b>' +
      'Bunlar önce gösterilecek.</div>';
  }

  function answer(note, rating) {
    var s0 = state.session;
    if (s0 && s0.mode === 'serbest' && !s0.reschedule) return answerDrill(note, rating);

    var r = SRS.review(note.srs, rating);
    note.srs = r.srs;
    note.updated = Date.now();
    var s = state.session;
    s.queue.shift();
    s.done++;
    s.revealed = false;
    if (r.again) {
      var pos = Math.min(s.queue.length, 4);
      s.queue.splice(pos, 0, note.id);
    }
    logReview();
    DB.put(note).then(function () { updateBadge(); });
    renderStudy();
  }

  /* Ard arda hizli cevaplarda sayac kaybolmasin diye sirayla yazilir. */
  var logChain = Promise.resolve();
  function logReview() {
    var d = SRS.today();
    logChain = logChain.then(function () {
      return DB.getMeta('log', {}).then(function (log) {
        log = log || {};
        log[d] = (log[d] || 0) + 1;
        return DB.setMeta('log', log);
      });
    }).catch(function () {});
    return logChain;
  }

  function studyAhead() {
    var t = SRS.today();
    var upcoming = state.notes.filter(function (n) {
      return !n.suspended && n.type !== 'not' && n.srs && n.srs.due > t;
    }).sort(function (a, b) { return a.srs.due < b.srs.due ? -1 : 1; }).slice(0, 20);
    if (!upcoming.length) return toast('Sırada kart yok');
    state.session = {
      queue: upcoming.map(function (n) { return n.id; }),
      done: 0, total: upcoming.length, revealed: false
    };
    renderStudy();
  }

  // =========================================================================
  // Serbest calisma (gunluk tekrardan bagimsiz)
  // =========================================================================
  var SCOPE_LABEL = {
    hepsi: 'hepsi', zor: 'zorlandıklarım', yeni: 'hiç çalışmadıklarım',
    gecikmis: 'bugün bekleyenler', yaklasan: 'yaklaşanlar'
  };

  function drillCard() {
    return '<div class="card">' +
      '<b class="small">Serbest çalışma</b>' +
      '<div class="tiny muted" style="margin:4px 0 10px">' +
      'Türe, derse ya da zorlandıklarına göre istediğin kadar kart çalış. ' +
      'Günlük planını bozmaz.</div>' +
      '<button class="wide" id="openDrill">Serbest çalışma başlat</button></div>';
  }

  function bindDrillEntry() {
    var b = $('#openDrill');
    if (b) b.addEventListener('click', function () { openDrill({}); });
  }

  function bindDrill() {
    $('#drillCancel').addEventListener('click', function () { $('#drillDlg').close(); });
    $('#drillStart').addEventListener('click', startDrill);
    ['#dType', '#dDers', '#dScope'].forEach(function (sel) {
      $(sel).addEventListener('change', updateDrillCount);
    });
    segmented('#dCount', updateDrillCount);
    segmented('#dOrder', null);
    $('#dResched').addEventListener('change', function () {
      $('#dReschedHint').textContent = $('#dResched').checked
        ? 'Cevapların normal tekrar gibi işlenir, kartların tarihleri değişir.'
        : 'Bu çalışma günlük planını hiç değiştirmez — sadece pratik.';
    });
  }

  function segmented(sel, onChange) {
    $$(sel + ' button').forEach(function (b) {
      b.addEventListener('click', function () {
        $$(sel + ' button').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        if (onChange) onChange();
      });
    });
  }

  function segValue(sel) {
    var on = $(sel + ' button.on');
    return on ? on.dataset.v : '';
  }

  function openDrill(prefill) {
    prefill = prefill || {};
    state.drillQuery = prefill.q || '';

    var dersSel = $('#dDers');
    var arr = dersNames();
    dersSel.innerHTML = '<option value="">Tüm dersler</option>' +
      arr.map(function (d) { return '<option value="' + esc(d) + '">' + esc(d) + '</option>'; }).join('');

    $('#dType').value = prefill.type || '';
    dersSel.value = (arr.indexOf(prefill.ders) >= 0) ? prefill.ders : '';
    $('#dScope').value = prefill.scope || 'hepsi';

    $('#dQuery').textContent = state.drillQuery ? 'arama: ' + state.drillQuery : '';
    $('#dQuery').classList.toggle('hidden', !state.drillQuery);

    updateDrillCount();
    $('#drillDlg').showModal();
  }

  function drillPool() {
    var type = $('#dType').value;
    var ders = $('#dDers').value;
    var scope = $('#dScope').value;
    var q = state.drillQuery;
    var t = SRS.today();

    return state.notes.filter(function (n) {
      if (n.suspended) return false;
      if (type === '') { if (n.type === 'not') return false; }
      else if (n.type !== type) return false;
      if (ders && n.ders !== ders) return false;
      if (q && !P.matches(n, q)) return false;

      var srs = n.srs || {};
      if (scope === 'zor') return (srs.lapses || 0) > 0 || (srs.ease || 2.5) < 2.35;
      if (scope === 'yeni') return srs.state === 'yeni';
      if (scope === 'gecikmis') return n.type !== 'not' && srs.due <= t;
      if (scope === 'yaklasan') {
        return n.type !== 'not' && srs.due > t && SRS.daysBetween(t, srs.due) <= 7;
      }
      return true;
    });
  }

  function updateDrillCount() {
    var pool = drillPool();
    var want = Number(segValue('#dCount')) || 0;
    var n = want ? Math.min(want, pool.length) : pool.length;
    var el = $('#dCountInfo');
    if (!pool.length) {
      el.className = 'notice warn';
      el.innerHTML = '<b>Bu filtreyle kart yok</b>Filtreyi gevşetmeyi dene.';
      $('#drillStart').disabled = true;
    } else {
      el.className = 'notice ok';
      el.innerHTML = '<b>' + n + ' kart çalışılacak</b>' +
        'Filtreye uyan toplam ' + pool.length + ' kart var.';
      $('#drillStart').disabled = false;
    }
  }

  function drillLabel() {
    var parts = [];
    parts.push($('#dType').value ? TYPE_LABEL[$('#dType').value] : 'Tüm kartlar');
    if ($('#dDers').value) parts.push($('#dDers').value);
    if ($('#dScope').value !== 'hepsi') parts.push(SCOPE_LABEL[$('#dScope').value]);
    if (state.drillQuery) parts.push('“' + state.drillQuery + '”');
    return parts.join(' · ');
  }

  function startDrill() {
    var pool = drillPool();
    if (!pool.length) return toast('Bu filtreyle kart yok');

    var order = segValue('#dOrder');
    if (order === 'eski') {
      pool.sort(function (a, b) { return (a.updated || 0) - (b.updated || 0); });
    } else if (order === 'zor') {
      pool.sort(function (a, b) {
        var ea = (a.srs && a.srs.ease) || 2.5, eb = (b.srs && b.srs.ease) || 2.5;
        if (ea !== eb) return ea - eb;
        return ((b.srs && b.srs.lapses) || 0) - ((a.srs && a.srs.lapses) || 0);
      });
    } else {
      shuffle(pool);
    }

    var want = Number(segValue('#dCount')) || 0;
    var picked = want ? pool.slice(0, want) : pool;

    $('#drillDlg').close();
    startDrillWith(picked.map(function (n) { return n.id; }), drillLabel(), $('#dResched').checked);
  }

  function startDrillWith(ids, label, reschedule) {
    state.session = {
      queue: ids.slice(),
      done: 0,
      total: ids.length,
      revealed: false,
      mode: 'serbest',
      reschedule: !!reschedule,
      missed: [],
      retries: {},
      label: label
    };
    go('bugun');
  }

  /* Plan etkilenmeyen serbest calismada cevap: sadece pratik. */
  function answerDrill(note, rating) {
    var s = state.session;
    s.queue.shift();
    s.done++;
    s.revealed = false;
    if (rating === 'bilemedim') {
      if (s.missed.indexOf(note.id) === -1) s.missed.push(note.id);
      var tries = (s.retries[note.id] || 0);
      if (tries < 2) {
        s.retries[note.id] = tries + 1;
        s.queue.push(note.id);
      }
    }
    logReview();
    renderStudy();
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function dersNames() {
    var set = {};
    state.notes.forEach(function (n) { if (n.ders) set[n.ders] = 1; });
    return Object.keys(set).sort(function (a, b) { return a.localeCompare(b, 'tr'); });
  }

  function nextDueDate() {
    var t = SRS.today(), best = null;
    state.notes.forEach(function (n) {
      if (n.suspended || n.type === 'not' || !n.srs) return;
      if (n.srs.due > t && (!best || n.srs.due < best)) best = n.srs.due;
    });
    return best;
  }

  function prettyDate(ds) {
    var d = SRS.daysBetween(SRS.today(), ds);
    if (d === 1) return 'yarın';
    if (d < 7) return d + ' gün sonra';
    var p = ds.split('-');
    return p[2] + '.' + p[1] + '.' + p[0];
  }

  function byId(id) {
    for (var i = 0; i < state.notes.length; i++) if (state.notes[i].id === id) return state.notes[i];
    return null;
  }

  // =========================================================================
  // Notlar listesi
  // =========================================================================
  function bindList() {
    var t;
    $('#q').addEventListener('input', function () {
      clearTimeout(t); t = setTimeout(renderList, 140);
    });
    $('#fDers').addEventListener('change', renderList);
    $('#fTip').addEventListener('change', renderList);
    $('#listDrill').addEventListener('click', function () {
      openDrill({
        type: $('#fTip').value,
        ders: $('#fDers').value,
        q: $('#q').value.trim()
      });
    });
  }

  function renderList() {
    var q = $('#q').value.trim();
    var ders = $('#fDers').value;
    var tip = $('#fTip').value;

    var out = state.notes.filter(function (n) {
      if (ders && n.ders !== ders) return false;
      if (tip && n.type !== tip) return false;
      return P.matches(n, q);
    }).sort(function (a, b) { return b.updated - a.updated; });

    $('#listCount').textContent = out.length + ' not' +
      (out.length !== state.notes.length ? ' (toplam ' + state.notes.length + ')' : '');
    $('#viewSub').textContent = '';

    var drillable = out.filter(function (n) { return n.type !== 'not' && !n.suspended; });
    var fb = $('#listDrill');
    fb.classList.toggle('hidden', drillable.length < 2);
    fb.textContent = 'Bu filtreyle çalış (' + drillable.length + ' kart)';

    if (!out.length) {
      $('#list').innerHTML = '<div class="empty">Eşleşen not yok.</div>';
      return;
    }

    var t = SRS.today();
    $('#list').innerHTML = out.slice(0, 300).map(function (n) {
      var when = n.type === 'not' ? 'not' :
        (n.srs.due <= t ? 'bugün' : prettyDate(n.srs.due));
      return '<div class="note-item" data-id="' + n.id + '">' +
        '<div class="nf">' + esc(n.front) + '</div>' +
        (n.back ? '<div class="nb">' + esc(n.back) + '</div>' : '') +
        '<div class="meta">' +
          '<span class="pill accent">' + esc(n.ders || 'Genel') + '</span>' +
          (n.konu ? '<span class="pill">' + esc(n.konu) + '</span>' : '') +
          (n.kaynak ? '<span class="pill gold">' + esc(n.kaynak) + '</span>' : '') +
          '<span class="pill">' + esc(when) + '</span>' +
          (n.suspended ? '<span class="pill">bekletiliyor</span>' : '') +
        '</div>' +
      '</div>';
    }).join('') +
    (out.length > 300 ? '<div class="tiny muted center">İlk 300 gösteriliyor — aramayı daralt.</div>' : '');

    $$('#list .note-item').forEach(function (el) {
      var tapped = 0;
      el.addEventListener('click', function () {
        var now = Date.now();
        if (now - tapped < 400) { openEditor(byId(el.dataset.id)); tapped = 0; return; }
        tapped = now;
        el.classList.toggle('open');
      });
    });
  }

  function refreshDersList() {
    var arr = dersNames();

    var dl = $('#dersList');
    dl.innerHTML = arr.map(function (d) { return '<option value="' + esc(d) + '">'; }).join('');

    var sel = $('#fDers');
    var cur = sel.value;
    sel.innerHTML = '<option value="">Tüm dersler</option>' +
      arr.map(function (d) { return '<option value="' + esc(d) + '">' + esc(d) + '</option>'; }).join('');
    if (arr.indexOf(cur) >= 0) sel.value = cur;
  }

  // =========================================================================
  // Ekleme
  // =========================================================================
  function bindAdd() {
    $('#modeSingle').addEventListener('click', function () { setAddMode('single'); });
    $('#modeBulk').addEventListener('click', function () { setAddMode('bulk'); });

    $('#sType').addEventListener('change', function () {
      var v = $('#sType').value;
      var labels = {
        kart: ['Soru / ön yüz', 'Cevap / arka yüz'],
        madde: ['Madde başlığı / konusu', 'Madde metni ve açıklama'],
        sure: ['Hangi süre?', 'Süre ve dayanağı'],
        karsilastirma: ['Neler karışıyor?', 'Fark tablosu'],
        not: ['Başlık', 'İçerik']
      };
      $('#lblFront').textContent = labels[v][0];
      $('#lblBack').textContent = labels[v][1];
    });

    $('#saveSingle').addEventListener('click', saveSingle);
    $('#bPreview').addEventListener('click', previewBulk);
    $('#bImport').addEventListener('click', importBulk);
  }

  function setAddMode(m) {
    $('#paneSingle').classList.toggle('hidden', m !== 'single');
    $('#paneBulk').classList.toggle('hidden', m === 'single');
    $('#modeSingle').className = m === 'single' ? 'primary' : 'ghost';
    $('#modeBulk').className = m === 'bulk' ? 'primary' : 'ghost';
  }

  function saveSingle() {
    var front = $('#sFront').value.trim();
    if (!front) return toast('Ön yüz boş olamaz');
    var now = Date.now();
    var note = {
      id: P.uid(),
      type: $('#sType').value,
      ders: $('#sDers').value.trim() || 'Genel',
      konu: $('#sKonu').value.trim(),
      front: front,
      back: $('#sBack').value.trim(),
      kaynak: $('#sKaynak').value.trim(),
      tags: $('#sTags').value.trim().split(/\s+/).filter(Boolean).map(function (t) {
        return t.replace(/^#/, '');
      }),
      created: now, updated: now, suspended: false,
      srs: SRS.fresh()
    };
    DB.put(note).then(function () {
      $('#sFront').value = ''; $('#sBack').value = '';
      $('#sKaynak').value = ''; $('#sTags').value = '';
      $('#sFront').focus();
      toast('Kaydedildi');
      return reload();
    });
  }

  function previewBulk() {
    var text = $('#bText').value;
    if (!text.trim()) return toast('Önce metin yapıştır');
    var res = P.parseBulk(text, {
      ders: $('#bDers').value.trim(),
      konu: $('#bKonu').value.trim()
    });
    state.pending = res.notes;

    var byDers = {};
    res.notes.forEach(function (n) { byDers[n.ders] = (byDers[n.ders] || 0) + 1; });

    var html = '<div class="spacer"></div>';
    if (!res.notes.length) {
      html += '<div class="notice warn"><b>Hiç not çıkmadı</b>Biçimi kontrol et.</div>';
      $('#bImport').disabled = true;
    } else {
      html += '<div class="notice ok"><b>' + res.notes.length + ' not hazır</b>' +
        Object.keys(byDers).map(function (d) {
          return esc(d) + ': ' + byDers[d];
        }).join(' · ') + '</div>';
      html += res.notes.slice(0, 6).map(function (n) {
        return '<div class="note-item"><div class="nf">' + esc(n.front) + '</div>' +
          (n.back ? '<div class="nb">' + esc(n.back) + '</div>' : '') +
          '<div class="meta"><span class="pill accent">' + esc(n.ders) + '</span>' +
          '<span class="pill">' + esc(TYPE_LABEL[n.type]) + '</span></div></div>';
      }).join('');
      if (res.notes.length > 6) {
        html += '<div class="tiny muted center">…ve ' + (res.notes.length - 6) + ' tane daha</div>';
      }
      $('#bImport').disabled = false;
    }
    if (res.errors.length) {
      html += '<div class="notice warn"><b>' + res.errors.length + ' blok atlandı</b>' +
        res.errors.slice(0, 4).map(function (e) {
          return esc(e.preview) + ' — ' + esc(e.message);
        }).join('<br>') + '</div>';
    }
    $('#bResult').innerHTML = html;
  }

  function importBulk() {
    if (!state.pending || !state.pending.length) return;
    var n = state.pending.length;
    DB.putMany(state.pending).then(function () {
      state.pending = null;
      $('#bText').value = '';
      $('#bResult').innerHTML = '';
      $('#bImport').disabled = true;
      toast(n + ' not eklendi');
      return reload();
    });
  }

  // =========================================================================
  // Düzenleme
  // =========================================================================
  function bindEditor() {
    $('#eCancel').addEventListener('click', function () { $('#editDlg').close(); });
    $('#eSave').addEventListener('click', saveEdit);
    $('#eDelete').addEventListener('click', function () {
      if (!confirm('Bu not silinsin mi?')) return;
      var id = state.editing.id;
      DB.remove(id).then(function () {
        $('#editDlg').close();
        if (state.session) {
          state.session.queue = state.session.queue.filter(function (x) { return x !== id; });
        }
        toast('Silindi');
        return reload();
      });
    });
    $('#eReset').addEventListener('click', function () {
      state.editing.srs = SRS.fresh();
      toast('Tekrar sıfırlandı — kaydet');
    });
    $('#eSuspend').addEventListener('click', function () {
      state.editing.suspended = !state.editing.suspended;
      $('#eSuspend').textContent = state.editing.suspended ? 'Beklemeyi kaldır' : 'Beklet';
      toast(state.editing.suspended ? 'Bekletilecek — kaydet' : 'Tekrara dönecek — kaydet');
    });
  }

  function openEditor(note) {
    if (!note) return;
    state.editing = JSON.parse(JSON.stringify(note));
    $('#eType').value = note.type;
    $('#eDers').value = note.ders || '';
    $('#eKonu').value = note.konu || '';
    $('#eFront').value = note.front || '';
    $('#eBack').value = note.back || '';
    $('#eKaynak').value = note.kaynak || '';
    $('#eTags').value = (note.tags || []).join(' ');
    $('#eSuspend').textContent = note.suspended ? 'Beklemeyi kaldır' : 'Beklet';
    var STATE_LABEL = { yeni: 'yeni', ogreniliyor: 'öğreniliyor', tekrar: 'tekrarda' };
    $('#eInfo').textContent = note.type === 'not' ? 'Serbest not — tekrara girmez.' :
      ('Durum: ' + (STATE_LABEL[note.srs.state] || note.srs.state) +
       ' · aralık ' + note.srs.interval + ' gün · ' +
       'sonraki ' + note.srs.due + ' · ' + note.srs.reps + ' tekrar');
    $('#editDlg').showModal();
  }

  function saveEdit() {
    var e = state.editing;
    e.type = $('#eType').value;
    e.ders = $('#eDers').value.trim() || 'Genel';
    e.konu = $('#eKonu').value.trim();
    e.front = $('#eFront').value.trim();
    e.back = $('#eBack').value.trim();
    e.kaynak = $('#eKaynak').value.trim();
    e.tags = $('#eTags').value.trim().split(/\s+/).filter(Boolean).map(function (t) {
      return t.replace(/^#/, '');
    });
    e.updated = Date.now();
    if (!e.front) return toast('Ön yüz boş olamaz');
    DB.put(e).then(function () {
      $('#editDlg').close();
      toast('Güncellendi');
      return reload();
    });
  }

  // =========================================================================
  // İstatistik
  // =========================================================================
  function renderStats() {
    $('#viewSub').textContent = '';
    var t = SRS.today();
    var total = state.notes.length;
    var cards = state.notes.filter(function (n) { return n.type !== 'not'; });
    var due = dueList().length;
    var neww = cards.filter(function (n) { return n.srs.state === 'yeni'; }).length;
    var mature = cards.filter(function (n) { return n.srs.interval >= 21; }).length;

    DB.getMeta('log', {}).then(function (log) {
      log = log || {};

      var past = [], streak = 0;
      for (var i = 13; i >= 0; i--) {
        var d = SRS.addDays(t, -i);
        past.push({ d: d, v: log[d] || 0 });
      }
      for (var j = 0; ; j++) {
        var dd = SRS.addDays(t, -j);
        if (log[dd]) streak++;
        else if (j > 0) break;
        else if (!log[dd]) break;
      }

      var fut = [];
      for (var k = 0; k < 14; k++) {
        var fd = SRS.addDays(t, k);
        var c = cards.filter(function (n) {
          return !n.suspended && (k === 0 ? n.srs.due <= fd : n.srs.due === fd);
        }).length;
        fut.push({ d: fd, v: c });
      }

      var dersStats = {};
      cards.forEach(function (n) {
        var d = n.ders || 'Genel';
        if (!dersStats[d]) dersStats[d] = { total: 0, mature: 0 };
        dersStats[d].total++;
        if (n.srs.interval >= 21) dersStats[d].mature++;
      });
      var dersArr = Object.keys(dersStats).map(function (d) {
        return { name: d, total: dersStats[d].total, mature: dersStats[d].mature };
      }).sort(function (a, b) { return b.total - a.total; });

      var totalReviews = Object.keys(log).reduce(function (a, k2) { return a + log[k2]; }, 0);

      $('#statWrap').innerHTML =
        '<div class="stat-grid">' +
          stat(total, 'toplam not') +
          stat(due, 'bugün bekleyen') +
          stat(neww, 'hiç çalışılmamış') +
          stat(mature, 'oturmuş (21+ gün)') +
          stat(streak, 'günlük seri') +
          stat(totalReviews, 'toplam tekrar') +
        '</div>' +
        '<div class="card"><b class="small">Son 14 gün — yapılan tekrar</b>' +
          bars(past) + '<div class="tiny muted center">' + past[0].d.slice(5) + ' → bugün</div></div>' +
        '<div class="card"><b class="small">Önümüzdeki 14 gün — gelecek yük</b>' +
          bars(fut) + '<div class="tiny muted center">bugün → ' + fut[13].d.slice(5) + '</div></div>' +
        (dersArr.length ? '<div class="card"><b class="small">Derslere göre</b><div class="spacer"></div>' +
          dersArr.map(function (d) {
            var pct = d.total ? Math.round(d.mature / d.total * 100) : 0;
            return '<div class="ders-row"><span class="name">' + esc(d.name) + '</span>' +
              '<span class="track"><i style="width:' + pct + '%"></i></span>' +
              '<span class="num">' + d.total + ' · %' + pct + '</span></div>';
          }).join('') + '</div>' : '');
    });
  }

  function stat(v, label) {
    return '<div class="stat"><b>' + v + '</b><span>' + label + '</span></div>';
  }

  function bars(arr) {
    var max = Math.max(1, Math.max.apply(null, arr.map(function (x) { return x.v; })));
    return '<div class="bars">' + arr.map(function (x) {
      var h = Math.round(x.v / max * 100);
      return '<div title="' + x.d + ': ' + x.v + '"><i style="height:' + h + '%"></i></div>';
    }).join('') + '</div>';
  }

  // =========================================================================
  // Ayarlar
  // =========================================================================
  function bindSettings() {
    $('#saveLimit').addEventListener('click', function () {
      var v = parseInt($('#dailyLimit').value, 10);
      if (!v || v < 1) return toast('Geçerli bir sayı gir');
      state.limit = v;
      DB.setMeta('limit', v).then(function () { toast('Kaydedildi'); });
    });

    $('#exportBtn').addEventListener('click', doExport);
    $('#importBtn').addEventListener('click', function () { $('#importFile').click(); });
    $('#importFile').addEventListener('change', doImport);

    $('#wipeBtn').addEventListener('click', function () {
      if (!confirm('TÜM notlar silinecek. Önce dışa aktardın mı?')) return;
      if (!confirm('Emin misin? Bu geri alınamaz.')) return;
      DB.clearAll().then(function () { toast('Silindi'); return reload(); });
    });

    $('#buildInfo').textContent = 'Hukuk Notları · sürüm ' + (self.HN_VERSION || '1.0');
  }

  function doExport() {
    DB.getMeta('log', {}).then(function (log) {
      var payload = {
        format: 'hukuknotlari-v1',
        exported: new Date().toISOString(),
        count: state.notes.length,
        notes: state.notes,
        log: log || {}
      };
      var blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'hukuk-notlari-' + SRS.today() + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
      toast('Yedek indirildi');
    });
  }

  function doImport(ev) {
    var f = ev.target.files && ev.target.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      try {
        var data = JSON.parse(r.result);
        var notes = data.notes || (Array.isArray(data) ? data : null);
        if (!notes) throw new Error('Beklenen biçim değil');
        var existing = {};
        state.notes.forEach(function (n) { existing[n.id] = 1; });
        var fresh = notes.filter(function (n) { return n && n.id && n.front; });
        var added = fresh.filter(function (n) { return !existing[n.id]; }).length;
        DB.putMany(fresh).then(function () {
          if (data.log) {
            return DB.getMeta('log', {}).then(function (cur) {
              cur = cur || {};
              Object.keys(data.log).forEach(function (k) {
                cur[k] = Math.max(cur[k] || 0, data.log[k]);
              });
              return DB.setMeta('log', cur);
            });
          }
        }).then(function () {
          toast(added + ' yeni, ' + (fresh.length - added) + ' güncellendi');
          return reload();
        });
      } catch (e) {
        toast('Dosya okunamadı: ' + e.message);
      }
      ev.target.value = '';
    };
    r.readAsText(f);
  }

  // =========================================================================
  // Push bildirimleri
  // =========================================================================
  function isStandalone() {
    return window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function pushSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  function configured() {
    return !!(CFG.WORKER_URL && CFG.VAPID_PUBLIC_KEY);
  }

  function renderPushStatus() {
    var el = $('#pushStatus');

    if (!configured()) {
      el.innerHTML = '<div class="notice warn" style="margin:8px 0 0"><b>Kurulum tamamlanmadı</b>' +
        'config.js içindeki WORKER_URL ve VAPID_PUBLIC_KEY boş. README.md’deki adımları izle.</div>';
      return;
    }

    if (!pushSupported()) {
      if (isIOS() && !isStandalone()) {
        el.innerHTML = '<div class="notice warn" style="margin:8px 0 0"><b>Önce ana ekrana ekle</b>' +
          'iPhone’da bildirim sadece ana ekrana eklenmiş uygulamalarda çalışır. ' +
          'Safari’de <b>Paylaş → Ana Ekrana Ekle</b> yap, sonra uygulamayı ana ekrandan aç.</div>';
      } else {
        el.innerHTML = '<div class="notice warn" style="margin:8px 0 0"><b>Bu tarayıcı desteklemiyor</b>' +
          'Web Push desteği bulunamadı.</div>';
      }
      return;
    }

    if (Notification.permission === 'denied') {
      el.innerHTML = '<div class="notice warn" style="margin:8px 0 0"><b>Bildirim izni kapalı</b>' +
        'iPhone: Ayarlar → Bildirimler → Hukuk Notları → “Bildirimlere İzin Ver”i aç.</div>';
      return;
    }

    navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.getSubscription();
    }).then(function (sub) {
      if (!sub) {
        el.innerHTML = '<div class="tiny muted" style="margin:6px 0 10px">' +
          'Belirlediğin saatlerde “bugün kaç kart bekliyor” bildirimi gelir. ' +
          'Not içerikleri cihazdan hiç çıkmaz.</div>' +
          '<button class="primary wide" id="pushOn">Bildirimleri aç</button>';
        $('#pushOn').addEventListener('click', enablePush);
        return;
      }
      DB.getMeta('times', CFG.DEFAULT_TIMES || ['08:30', '20:30']).then(function (times) {
        el.innerHTML =
          '<div class="notice ok" style="margin:8px 0 10px"><b>Bildirimler açık</b>' +
          'Aşağıdaki saatlerde hatırlatma gelir.</div>' +
          '<div id="timeRows"></div>' +
          '<div class="row"><button id="addTime" class="ghost">+ Saat ekle</button>' +
          '<button id="saveTimes" class="primary">Saatleri kaydet</button></div>' +
          '<div class="spacer"></div>' +
          '<div class="row"><button id="testPush" class="ghost">Test bildirimi</button>' +
          '<button id="pushOff" class="danger">Kapat</button></div>';
        drawTimes(times);
        $('#addTime').addEventListener('click', function () {
          var cur = readTimes(); cur.push('12:00'); drawTimes(cur);
        });
        $('#saveTimes').addEventListener('click', function () { saveTimes(sub); });
        $('#testPush').addEventListener('click', function () { testPush(sub); });
        $('#pushOff').addEventListener('click', function () { disablePush(sub); });
      });
    }).catch(function (e) {
      el.innerHTML = '<div class="notice warn">Durum okunamadı: ' + esc(e.message) + '</div>';
    });
  }

  function drawTimes(times) {
    $('#timeRows').innerHTML = times.map(function (t, i) {
      return '<div class="row" style="margin-bottom:8px">' +
        '<input type="time" value="' + esc(t) + '" data-i="' + i + '" class="tinput">' +
        '<button class="ghost delTime" data-i="' + i + '" style="flex:0 0 54px">✕</button></div>';
    }).join('');
    $$('.delTime').forEach(function (b) {
      b.addEventListener('click', function () {
        var cur = readTimes();
        cur.splice(Number(b.dataset.i), 1);
        drawTimes(cur.length ? cur : ['08:30']);
      });
    });
  }

  function readTimes() {
    return $$('.tinput').map(function (i) { return i.value; }).filter(Boolean);
  }

  function urlB64ToUint8(base64String) {
    var padding = '='.repeat((4 - base64String.length % 4) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(base64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function enablePush() {
    Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') { renderPushStatus(); return toast('İzin verilmedi'); }
      return navigator.serviceWorker.ready.then(function (reg) {
        return reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlB64ToUint8(CFG.VAPID_PUBLIC_KEY)
        });
      }).then(function (sub) {
        var times = CFG.DEFAULT_TIMES || ['08:30', '20:30'];
        return DB.setMeta('times', times).then(function () {
          return postWorker('/subscribe', {
            subscription: sub.toJSON(),
            times: times,
            tz: Intl.DateTimeFormat().resolvedOptions().timeZone
          });
        });
      }).then(function () {
        toast('Bildirimler açıldı');
        renderPushStatus();
      });
    }).catch(function (e) {
      toast('Hata: ' + e.message);
    });
  }

  function saveTimes(sub) {
    var times = readTimes();
    if (!times.length) return toast('En az bir saat gerekli');
    times.sort();
    DB.setMeta('times', times).then(function () {
      return postWorker('/subscribe', {
        subscription: sub.toJSON(),
        times: times,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone
      });
    }).then(function () { toast('Saatler kaydedildi'); })
      .catch(function (e) { toast('Kaydedilemedi: ' + e.message); });
  }

  function testPush(sub) {
    postWorker('/test', { endpoint: sub.endpoint })
      .then(function () { toast('Gönderildi — birkaç saniye içinde gelmeli'); })
      .catch(function (e) { toast('Hata: ' + e.message); });
  }

  function disablePush(sub) {
    postWorker('/unsubscribe', { endpoint: sub.endpoint })
      .catch(function () {})
      .then(function () { return sub.unsubscribe(); })
      .then(function () { toast('Kapatıldı'); renderPushStatus(); });
  }

  function postWorker(path, body) {
    return fetch(CFG.WORKER_URL.replace(/\/+$/, '') + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(r.status + ' ' + t); });
      return r.json().catch(function () { return {}; });
    });
  }

  // =========================================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
