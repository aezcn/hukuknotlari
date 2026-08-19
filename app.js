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
    quickOnly: false,
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

  /* Her ders kendi rengini alsin diye adindan sabit bir ton uretiyoruz.
     Rastgele degil, elle secilmis sekiz tondan biri — hepsi bir arada uyumlu. */
  var DERS_HUES = [212, 338, 32, 158, 268, 14, 188, 292, 96, 50];

  /* Ton, ders adindan hesaplanmiyor: bir kez atanip saklaniyor. Hesaplasaydik
     iki ders ayni tonu kapabilirdi ve renk kimligi anlamini yitirirdi.
     Atama en az kullanilan tonu secer, sonra bir daha degismez. */
  function ensureDersColors() {
    var map = state.dersColors || {};
    var used = {};
    Object.keys(map).forEach(function (k) { used[map[k]] = (used[map[k]] || 0) + 1; });
    var changed = false;

    dersNames().forEach(function (n) {
      var key = P.norm(n);
      if (map[key] !== undefined) return;
      var best = DERS_HUES[0], bestN = Infinity;
      DERS_HUES.forEach(function (h) {
        var c = used[h] || 0;
        if (c < bestN) { bestN = c; best = h; }
      });
      map[key] = best;
      used[best] = (used[best] || 0) + 1;
      changed = true;
    });

    state.dersColors = map;
    if (changed) DB.setMeta('dersColors', map);
  }

  function dersHue(name) {
    var key = P.norm(name || 'genel');
    var m = state.dersColors || {};
    if (m[key] !== undefined) return m[key];
    var h = 0;
    for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 1000003;
    return DERS_HUES[h % DERS_HUES.length];
  }
  function dh(name) { return ' style="--dh:' + dersHue(name) + '"'; }

  var ICONS = {
    bos:    '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    bitti:  '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>',
    kutla:  '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/><circle cx="12" cy="12" r="3.2"/>',
    hedef:  '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>'
  };
  function icon(name, size) {
    return '<svg class="icon-empty" width="' + (size || 40) + '" height="' + (size || 40) + '" ' +
      'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + '</svg>';
  }

  /* Halkanin dolulugu bugunun ilerlemesi: yapilan / (yapilan + bekleyen). */
  function ring(pct, buyuk, alt) {
    var r = 54, c = 2 * Math.PI * r;
    pct = Math.max(0, Math.min(1, pct || 0));
    var off = c * (1 - pct);
    return '<div class="ring-wrap">' +
      '<svg class="ring" width="138" height="138" viewBox="0 0 120 120" aria-hidden="true">' +
        '<defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1">' +
          '<stop offset="0" style="stop-color:var(--accent-2)"/>' +
          '<stop offset="1" style="stop-color:var(--accent)"/>' +
        '</linearGradient></defs>' +
        '<circle class="bg" cx="60" cy="60" r="' + r + '"/>' +
        '<circle class="fg" cx="60" cy="60" r="' + r + '" stroke="url(#rg)" ' +
          'style="--c:' + c.toFixed(1) + '" ' +
          'stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '"/>' +
      '</svg>' +
      '<div class="ring-mid"><b>' + buyuk + '</b><span>' + esc(alt) + '</span></div>' +
    '</div>';
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
      return DB.getMeta('lastBackup', null);
    }).then(function (b) {
      state.backup = computeBackup(b);
      return DB.getMeta('log', {}).then(function (log) {
        state.todayCount = (log || {})[SRS.today()] || 0;
      });
    }).then(function () {
      return DB.getMeta('dersColors', {});
    }).then(function (m) {
      state.dersColors = m || {};
      ensureDersColors();
      refreshDersList();
      updateBadge();
      updateBackupDot();
      render();
    });
  }

  // =========================================================================
  // Yedek durumu
  // =========================================================================
  var BACKUP_DAYS = 14;   /* bu kadar gun gecerse hatirlat */
  var BACKUP_NEW = 40;    /* ya da bu kadar yeni not birikirse */

  function computeBackup(b) {
    var total = state.notes.length;
    var out = { level: 'ok', days: null, yeni: 0, hic: !b || !b.at, total: total };
    if (!total) return out;
    if (out.hic) {
      out.yeni = total;
      out.level = total >= 20 ? 'warn' : 'ok';
      return out;
    }
    out.days = Math.floor((Date.now() - b.at) / 86400000);
    out.yeni = state.notes.filter(function (n) { return (n.created || 0) > b.at; }).length;
    out.level = (out.days >= BACKUP_DAYS || out.yeni >= BACKUP_NEW) ? 'warn' : 'ok';
    return out;
  }

  function backupText(b) {
    if (b.hic) {
      return 'Hiç yedek almadın. ' + b.total + ' not yalnızca bu telefonda duruyor — ' +
        'telefon kaybolursa geri gelmez.';
    }
    var ne = b.days === 0 ? 'bugün' : (b.days === 1 ? 'dün' : b.days + ' gün önce');
    return 'Son yedek ' + ne + ' alındı' +
      (b.yeni ? ' · o günden beri ' + b.yeni + ' yeni not eklendi' : '') + '.';
  }

  function updateBackupDot() {
    var el = $('#tabDot');
    if (!el) return;
    el.classList.toggle('hidden', !(state.backup && state.backup.level === 'warn'));
  }

  function renderBackupStatus() {
    var el = $('#backupStatus');
    if (!el) return;
    var b = state.backup;
    if (!b || !b.total) { el.className = 'hidden'; el.innerHTML = ''; return; }
    el.className = 'notice ' + (b.level === 'warn' ? 'warn' : 'ok');
    el.innerHTML = '<b>' + (b.level === 'warn' ? 'Yedek almanın zamanı' : 'Yedek güncel') +
      '</b>' + esc(backupText(b));
  }

  /* Oturum sonu, yedek hatirlatmak icin dogru an: is bitmis, acele yok. */
  function backupNudge() {
    var b = state.backup;
    if (!b || b.level !== 'warn') return '';
    return '<div class="notice warn"><b>Yedek almanın zamanı</b>' + esc(backupText(b)) +
      '<button class="wide" id="nudgeBackup">Şimdi yedek al</button></div>';
  }

  function bindBackupNudge() {
    var el = $('#nudgeBackup');
    if (el) el.addEventListener('click', doExport);
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
    var m = document.querySelector('main');
    if (m) m.scrollTop = 0;
    render();
  }

  function render() {
    if (state.view === 'bugun') renderStudy();
    else if (state.view === 'notlar') renderList();
    else if (state.view === 'istatistik') renderStats();
    else if (state.view === 'ayarlar') { renderPushStatus(); renderBackupStatus(); }
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
      state.lastCard = null;
      if (!state.notes.length) {
        wrap.innerHTML = '<div class="empty">' + icon('bos') + '' +
          'Henüz not yok.<br>“Ekle” sekmesinden başla — toplu yapıştırma en hızlısı.</div>' +
          '<button class="primary wide" id="goAdd">Not ekle</button>';
        $('#goAdd').addEventListener('click', function () { go('ekle'); });
        return;
      }
      if (!due.length) {
        var next = nextDueDate();
        wrap.innerHTML = '<div class="empty">' + icon('bitti') + '' +
          'Bugünlük tekrar bitti.<br><span class="small">' +
          (next ? 'Sıradaki tekrar: ' + esc(prettyDate(next)) : 'Sırada bekleyen kart yok.') +
          '</span></div>' +
          '<button class="wide" id="aheadBtn">Yine de çalış (ileriden 20 kart)</button>' +
          '<div class="spacer"></div>' + backupNudge() + drillCard();
        $('#aheadBtn').addEventListener('click', studyAhead);
        bindDrillEntry();
        bindBackupNudge();
        return;
      }
      var yapilan = state.todayCount || 0;
      wrap.innerHTML =
        '<div class="card center">' +
          ring(yapilan / (yapilan + due.length), due.length, 'kart bekliyor') +
          (yapilan ? '<div class="tiny muted" style="margin:-8px 0 12px">' +
            'bugün ' + yapilan + ' tekrar yaptın</div>' : '') +
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
        wrap.innerHTML = '<div class="empty">' + icon('hedef') + '' +
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
        wrap.innerHTML = '<div class="empty">' + icon('kutla') + '' +
          'Oturum tamamlandı — ' + s.done + ' tekrar.</div>' + backupNudge() + drillCard();
        bindDrillEntry();
        bindBackupNudge();
      }
      updateBadge();
      return;
    }

    if (s.leech) {
      var lnote = byId(s.leech);
      if (lnote) return renderLeech(lnote);
      s.leech = null;
    }

    var note = byId(s.queue[0]);
    if (!note) { s.queue.shift(); return renderStudy(); }

    /* Kart degistiyse giris animasyonu; sadece cevap acildiysa kart yerinde kalsin. */
    var isNew = state.lastCard !== note.id;
    state.lastCard = note.id;

    var pct = s.total ? Math.round((s.done / (s.done + s.queue.length)) * 100) : 0;
    $('#viewSub').textContent = s.done + ' / ' + (s.done + s.queue.length);

    var html =
      (s.mode === 'serbest'
        ? '<div class="session-tag"><span class="pill gold">Serbest</span>' +
          '<span>' + esc(s.label || '') + '</span>' +
          (s.reschedule ? '' : '<span class="muted tiny">· plan etkilenmiyor</span>') + '</div>'
        : '') +
      '<div class="progress"><i style="width:' + pct + '%"></i></div>' +
      '<div class="study-card' + (isNew ? ' enter' : '') + '"' + dh(note.ders) + '>' +
        '<div class="study-meta">' +
          '<span class="pill ders">' + esc(note.ders || 'Genel') + '</span>' +
          (note.konu ? '<span class="pill">' + esc(note.konu) + '</span>' : '') +
          '<span class="pill">' + esc(TYPE_LABEL[note.type] || note.type) + '</span>' +
          (SRS.isLeech(note) ? '<span class="pill gold">takılan</span>' : '') +
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
      studyFoot(s);
    } else {
      html += '<div class="spacer"></div><button class="primary wide" id="showBtn">Cevabı göster</button>' +
        '<div class="spacer"></div>' +
        studyFoot(s);
    }

    wrap.innerHTML = html;

    if ($('#showBtn')) $('#showBtn').addEventListener('click', function () {
      s.revealed = true; renderStudy();
    });
    $$('.grades button').forEach(function (b) {
      b.addEventListener('click', function () { answer(note, b.dataset.g); });
    });
    if ($('#undoBtn')) $('#undoBtn').addEventListener('click', undoLast);
    $('#editCur').addEventListener('click', function () { openEditor(note); });
    $('#stopBtn').addEventListener('click', function () {
      state.session = null; renderStudy(); updateBadge();
    });
  }

  function studyFoot(s) {
    return '<div class="row study-foot">' +
      ((s.undo && s.undo.length)
        ? '<button class="ghost small" id="undoBtn">Geri al</button>' : '') +
      '<button class="ghost small" id="editCur">Düzenle</button>' +
      '<button class="ghost small" id="stopBtn">Oturumu bitir</button></div>';
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

    pushUndo(note, true);
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
    if (rating === 'tekrar' && SRS.shouldWarnLeech(note.srs)) {
      SRS.markLeechWarned(note.srs);
      s.leech = note.id;
    }
    logReview();
    DB.put(note).then(function () { updateBadge(); });
    renderStudy();
  }

  /* Kart takildiginda araya giren ekran. Anki gibi sessizce bekletmiyoruz;
     karari kullaniciya birakmak, kartin neden takildigini dusunmesini sagliyor. */
  function renderLeech(note) {
    var wrap = $('#studyWrap');
    var s0 = state.session;
    $('#viewSub').textContent = s0 ? (s0.done + ' / ' + (s0.done + s0.queue.length)) : '';
    wrap.innerHTML =
      '<div class="notice warn"><b>Bu kart seni takıyor</b>' +
        'Bu kartı ' + (note.srs.lapses || 0) + ' kez unuttun. Genelde bu, kartın tek ' +
        'seferde çok şey sorduğunu ya da ifadesinin bulanık olduğunu gösterir — ' +
        'senin çalışmadığını değil.</div>' +
      '<div class="study-card enter"' + dh(note.ders) + '>' +
        '<div class="study-meta">' +
          '<span class="pill ders">' + esc(note.ders || 'Genel') + '</span>' +
          (note.konu ? '<span class="pill">' + esc(note.konu) + '</span>' : '') +
          '<span class="pill gold">takılan</span>' +
        '</div>' +
        '<div class="study-front">' + esc(note.front) + '</div>' +
        (note.back ? '<div class="study-back">' + esc(note.back) + '</div>' : '') +
      '</div>' +
      '<div class="spacer"></div>' +
      '<button class="primary wide" id="leechEdit">Notu düzelt — böl ya da sadeleştir</button>' +
      '<div class="spacer"></div>' +
      '<div class="row">' +
        '<button id="leechSuspend">Beklet</button>' +
        '<button class="ghost" id="leechSkip">Şimdilik devam</button>' +
      '</div>';

    $('#leechEdit').addEventListener('click', function () {
      clearLeech();
      openEditor(note);
    });
    $('#leechSuspend').addEventListener('click', function () {
      note.suspended = true;
      note.updated = Date.now();
      var s = state.session;
      if (s) {
        s.queue = s.queue.filter(function (id) { return id !== note.id; });
        s.leech = null;
      }
      DB.put(note).then(function () {
        updateBadge();
        toast('Bekletiliyor — Notlar’dan geri alabilirsin');
        renderStudy();
      });
    });
    $('#leechSkip').addEventListener('click', function () {
      clearLeech();
      renderStudy();
    });
  }

  function clearLeech() {
    if (state.session) state.session.leech = null;
  }

  /* Cevaptan ONCE oturumun ve kartin halini sakla; "Geri al" bunu geri yukler. */
  function pushUndo(note, graded) {
    var s = state.session;
    if (!s) return;
    s.undo = s.undo || [];
    s.undo.push({
      id: note.id,
      graded: !!graded,
      srs: graded ? JSON.parse(JSON.stringify(note.srs)) : null,
      updated: note.updated,
      queue: s.queue.slice(),
      done: s.done,
      missed: s.missed ? s.missed.slice() : null,
      retries: s.retries ? JSON.parse(JSON.stringify(s.retries)) : null
    });
    if (s.undo.length > 30) s.undo.shift();
  }

  function undoLast() {
    var s = state.session;
    if (!s || !s.undo || !s.undo.length) return;
    var u = s.undo.pop();
    var note = byId(u.id);

    s.queue = u.queue;
    s.done = u.done;
    if (u.missed) s.missed = u.missed;
    if (u.retries) s.retries = u.retries;
    s.revealed = true;          /* kart cevabi acik halde geri gelsin, yeniden puanlansin */
    unlogReview();

    if (u.graded && note) {
      note.srs = u.srs;
      note.updated = u.updated;
      DB.put(note).then(function () { updateBadge(); renderStudy(); });
    } else {
      renderStudy();
    }
    toast('Geri alındı');
  }

  /* Ard arda hizli cevaplarda sayac kaybolmasin diye sirayla yazilir. */
  var logChain = Promise.resolve();
  function logReview() {
    var d = SRS.today();
    logChain = logChain.then(function () {
      return DB.getMeta('log', {}).then(function (log) {
        log = log || {};
        log[d] = (log[d] || 0) + 1;
        state.todayCount = log[d];
        return DB.setMeta('log', log);
      });
    }).catch(function () {});
    return logChain;
  }

  function unlogReview() {
    var d = SRS.today();
    logChain = logChain.then(function () {
      return DB.getMeta('log', {}).then(function (log) {
        log = log || {};
        if (log[d]) {
          log[d]--;
          if (!log[d]) delete log[d];
        }
        state.todayCount = log[d] || 0;
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
    gecikmis: 'bugün bekleyenler', yaklasan: 'yaklaşanlar', takilan: 'takılanlar'
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
      if (scope === 'takilan') return SRS.isLeech(n);
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
    pushUndo(note, false);
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
      if (state.quickOnly && !n.quick) return false;
      if (ders && n.ders !== ders) return false;
      if (tip && n.type !== tip) return false;
      return P.matches(n, q);
    }).sort(function (a, b) { return b.updated - a.updated; });

    renderQuickBar();

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
      return '<div class="note-item" data-id="' + n.id + '"' + dh(n.ders) + '>' +
        '<div class="nf">' + esc(n.front) + '</div>' +
        (n.back ? '<div class="nb">' + esc(n.back) + '</div>' : '') +
        '<div class="meta">' +
          '<span class="pill ders">' + esc(n.ders || 'Genel') + '</span>' +
          (n.konu ? '<span class="pill">' + esc(n.konu) + '</span>' : '') +
          (n.kaynak ? '<span class="pill gold">' + esc(n.kaynak) + '</span>' : '') +
          '<span class="pill">' + esc(when) + '</span>' +
          (n.suspended ? '<span class="pill">bekletiliyor</span>' : '') +
          (n.quick ? '<span class="pill gold">işlenmemiş</span>' : '') +
          (SRS.isLeech(n) ? '<span class="pill gold">takılan</span>' : '') +
        '</div>' +
        '<div class="note-act"><button class="ghost small" data-edit="' + n.id + '">Düzenle</button></div>' +
      '</div>';
    }).join('') +
    (out.length > 300 ? '<div class="tiny muted center">İlk 300 gösteriliyor — aramayı daralt.</div>' : '');

    $$('#list .note-item').forEach(function (el) {
      el.addEventListener('click', function () { el.classList.toggle('open'); });
    });
    $$('#list [data-edit]').forEach(function (b) {
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();          /* nota dokunmayla karismasin */
        openEditor(byId(b.dataset.edit));
      });
    });
  }

  /* Hizli yakalanmis, henuz elden gecmemis notlarin seridi. */
  function renderQuickBar() {
    var bar = $('#quickBar');
    var n = state.notes.filter(function (x) { return x.quick; }).length;

    if (!n && !state.quickOnly) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');

    if (state.quickOnly) {
      bar.innerHTML = '<b>İşlenmemiş notlar' + (n ? ' (' + n + ')' : '') + '</b>' +
        'Her birine dokun, açılınca <b style="display:inline">Düzenle</b> de. ' +
        'Tür ve ders verdiğinde tekrara girmeye başlar.' +
        '<button class="ghost small" id="quickAllBtn">Tüm notlara dön</button>';
      $('#quickAllBtn').addEventListener('click', function () {
        state.quickOnly = false;
        renderList();
      });
    } else {
      bar.innerHTML = '<b>' + n + ' işlenmemiş not</b>' +
        'Hızlı yakaladıkların burada bekliyor — tür ve ders verilene kadar tekrara girmezler.' +
        '<button class="ghost small" id="quickOnlyBtn">Göster</button>';
      $('#quickOnlyBtn').addEventListener('click', function () {
        state.quickOnly = true;
        $('#q').value = '';
        $('#fDers').value = '';
        $('#fTip').value = '';
        renderList();
      });
    }
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
    $('#modeQuick').addEventListener('click', function () { setAddMode('quick'); });
    $('#modeSingle').addEventListener('click', function () { setAddMode('single'); });
    $('#modeBulk').addEventListener('click', function () { setAddMode('bulk'); });

    $('#sDers').addEventListener('input', updateCtxLine);
    $('#sKonu').addEventListener('input', updateCtxLine);
    $('#saveQuick').addEventListener('click', saveQuick);

    /* Son kullanilan ders/konu/tur bir sonraki acilista hazir gelsin. */
    DB.getMeta('lastCtx', null).then(function (c) {
      if (c) {
        if (c.ders && c.ders !== 'Genel') $('#sDers').value = c.ders;
        if (c.konu) $('#sKonu').value = c.konu;
        if (c.type) {
          $('#sType').value = c.type;
          $('#sType').dispatchEvent(new Event('change'));
        }
      }
      updateCtxLine();
    });

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
    $('#paneQuick').classList.toggle('hidden', m !== 'quick');
    $('#paneSingle').classList.toggle('hidden', m !== 'single');
    $('#paneBulk').classList.toggle('hidden', m !== 'bulk');
    $('#modeQuick').className = m === 'quick' ? 'primary' : 'ghost';
    $('#modeSingle').className = m === 'single' ? 'primary' : 'ghost';
    $('#modeBulk').className = m === 'bulk' ? 'primary' : 'ghost';
    if (m === 'quick') $('#qText').focus();
  }

  function updateCtxLine() {
    var d = $('#sDers').value.trim();
    var k = $('#sKonu').value.trim();
    $('#sCtx').textContent = d
      ? ('Şu an yazdığın yer: ' + d + (k ? ' / ' + k : '') + ' — kaydettikçe burada kalır')
      : 'Ders yazarsan sonraki notlarda hazır gelir.';
  }

  /* Hizli yakalama: yapiyi sonraya birak, simdi sadece kaydet.
     Tur 'not' oldugu icin tekrara girmez; quick isareti "islenmemis" demek. */
  function saveQuick() {
    var text = $('#qText').value.trim();
    if (!text) return toast('Önce bir şeyler yaz');
    var lines = text.split('\n');
    var first = lines[0].trim();
    var rest = lines.slice(1).join('\n').trim();
    var now = Date.now();
    var note = {
      id: P.uid(),
      type: 'not',
      ders: $('#sDers').value.trim() || 'Genel',
      konu: $('#sKonu').value.trim(),
      front: first || text.slice(0, 60),
      back: rest,
      kaynak: '',
      tags: [],
      created: now, updated: now, suspended: false,
      quick: true,
      srs: SRS.fresh()
    };
    DB.put(note).then(function () {
      $('#qText').value = '';
      $('#qText').focus();
      toast('Yakalandı — sonra düzenlersin');
      return reload();
    });
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
      DB.setMeta('lastCtx', { ders: note.ders, konu: note.konu, type: note.type });
      $('#sFront').value = ''; $('#sBack').value = '';
      $('#sKaynak').value = ''; $('#sTags').value = '';
      $('#sFront').focus();
      updateCtxLine();
      toast('Kaydedildi — sıradaki');
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
    if (e.quick) delete e.quick;   /* elden gecti, artik islenmemis degil */
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

      var leeches = cards.filter(function (n) {
        return SRS.isLeech(n) && !n.suspended;
      }).sort(function (a, b) { return (b.srs.lapses || 0) - (a.srs.lapses || 0); });

      var leechHtml = leeches.length
        ? '<div class="card"><b class="small">Takılan kartlar (' + leeches.length + ')</b>' +
          '<div class="tiny muted" style="margin:4px 0 10px">' +
          'Bunları ' + SRS.LEECH_AT + '+ kez unuttun. Sorun genelde kartın kendisindedir — ' +
          'dokun, böl ya da sadeleştir.</div>' +
          leeches.map(function (n) {
            return '<div class="leech-row" data-id="' + esc(n.id) + '">' +
              '<span class="name">' + esc(n.front) + '</span>' +
              '<span class="num">' + (n.srs.lapses || 0) + ' kez</span></div>';
          }).join('') + '</div>'
        : '';

      $('#statWrap').innerHTML =
        '<div class="stat-grid">' +
          stat(total, 'toplam not') +
          stat(due, 'bugün bekleyen') +
          stat(neww, 'hiç çalışılmamış') +
          stat(mature, 'oturmuş (21+ gün)') +
          stat(streak, 'günlük seri') +
          stat(totalReviews, 'toplam tekrar') +
        '</div>' +
        leechHtml +
        '<div class="card"><b class="small">Son 14 gün — yapılan tekrar</b>' +
          bars(past) + '<div class="tiny muted center">' + past[0].d.slice(5) + ' → bugün</div></div>' +
        '<div class="card"><b class="small">Önümüzdeki 14 gün — gelecek yük</b>' +
          bars(fut) + '<div class="tiny muted center">bugün → ' + fut[13].d.slice(5) + '</div></div>' +
        (dersArr.length ? '<div class="card"><b class="small">Derslere göre</b><div class="spacer"></div>' +
          dersArr.map(function (d) {
            var pct = d.total ? Math.round(d.mature / d.total * 100) : 0;
            return '<div class="ders-row"' + dh(d.name) + '><span class="name">' + esc(d.name) + '</span>' +
              '<span class="track"><i style="width:' + pct + '%"></i></span>' +
              '<span class="num">' + d.total + ' · %' + pct + '</span></div>';
          }).join('') + '</div>' : '');

      $$('#statWrap .leech-row').forEach(function (el) {
        el.addEventListener('click', function () { openEditor(byId(el.dataset.id)); });
      });
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

    segmented('#fontSize', function () {
      var v = Number(segValue('#fontSize')) || 1;
      applyRead(v);
      DB.setMeta('read', v);
    });
    DB.getMeta('read', 1).then(function (v) {
      applyRead(setReadButtons(Number(v) || 1));
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

  /* Okuma metinlerinin olcegi. Cerceve (sekme, etiket) sabit kaliyor;
     buyuyen sey kartin ve notun kendisi. */
  function applyRead(v) {
    document.documentElement.style.setProperty('--read', String(v));
  }

  function setReadButtons(v) {
    var found = false;
    $$('#fontSize button').forEach(function (b) {
      var on = Number(b.dataset.v) === v;
      if (on) found = true;
      b.classList.toggle('on', on);
    });
    if (!found) {
      v = 1;
      $$('#fontSize button').forEach(function (b) {
        b.classList.toggle('on', Number(b.dataset.v) === 1);
      });
    }
    return v;
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
      return DB.setMeta('lastBackup', { at: Date.now(), count: state.notes.length })
        .then(reload);
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
