/* Toplu not yapistirma ayristiricisi + Turkce duyarli arama yardimcilari. */
(function (root) {
  'use strict';

  var MAP = {
    'ç': 'c', 'ğ': 'g', 'ı': 'i', 'İ': 'i',
    'ö': 'o', 'ş': 's', 'ü': 'u',
    'â': 'a', 'î': 'i', 'û': 'u'
  };

  function norm(s) {
    if (!s) return '';
    var out = '';
    var lower = String(s).replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase();
    for (var i = 0; i < lower.length; i++) {
      var ch = lower[i];
      out += (MAP[ch] !== undefined ? MAP[ch] : ch);
    }
    return out;
  }

  function uid() {
    return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  var TYPES = ['kart', 'not', 'madde', 'sure', 'karsilastirma'];

  /* Desteklenen bicim:
       @medeni/esya            -> sonraki bloklar icin ders/konu
       T: sure                 -> blogun tipi
       S: soru                 -> on yuz  (Soru:, Q: de olur)
       C: cevap                -> arka yuz (Cevap:, A: de olur)
       K: TMK m.1007           -> kaynak
       #etiket #etiket2        -> etiketler
       ---                     -> blok ayraci (bos satir da ayirir)
       "soru :: cevap"         -> tek satirlik kisayol
     Hicbir isaret yoksa: ilk satir baslik, gerisi govde -> serbest not.
  */
  function parseBulk(text, defaults) {
    defaults = defaults || {};
    var lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    var ctxDers = defaults.ders || '';
    var ctxKonu = defaults.konu || '';
    var blocks = [];
    var cur = [];

    function flush() {
      if (cur.length) { blocks.push({ lines: cur, ders: ctxDers, konu: ctxKonu }); cur = []; }
    }

    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      var t = raw.trim();
      if (t === '' || /^-{3,}$/.test(t) || /^={3,}$/.test(t)) { flush(); continue; }
      var mCtx = t.match(/^@\s*([^\/]+?)(?:\s*\/\s*(.+))?$/);
      if (mCtx) {
        flush();
        ctxDers = mCtx[1].trim();
        ctxKonu = (mCtx[2] || '').trim();
        continue;
      }
      cur.push(raw);
    }
    flush();

    var notes = [];
    var errors = [];

    blocks.forEach(function (b, idx) {
      try {
        var n = blockToNote(b, defaults);
        if (n) notes.push(n);
      } catch (e) {
        errors.push({ block: idx + 1, message: e.message, preview: b.lines[0] });
      }
    });

    return { notes: notes, errors: errors };
  }

  function blockToNote(b, defaults) {
    var front = [], back = [], tags = [], kaynak = '', type = '';
    var target = null;
    var sawMarker = false;
    var plain = [];

    b.lines.forEach(function (raw) {
      var line = raw.trim();

      if (/^#\S/.test(line)) {
        line.split(/\s+/).forEach(function (w) {
          if (w[0] === '#' && w.length > 1) tags.push(w.slice(1));
        });
        sawMarker = true;
        return;
      }

      var m = line.match(/^(S|Soru|Q|C|Cevap|A|K|Kaynak|T|Tip|N|Not)\s*:\s*(.*)$/i);
      if (m) {
        sawMarker = true;
        var key = m[1].toLowerCase();
        var val = m[2];
        if (key === 's' || key === 'soru' || key === 'q' || key === 'n' || key === 'not') {
          target = front; if (val) front.push(val);
          if (key === 'n' || key === 'not') type = type || 'not';
        } else if (key === 'c' || key === 'cevap' || key === 'a') {
          target = back; if (val) back.push(val);
        } else if (key === 'k' || key === 'kaynak') {
          kaynak = val; target = null;
        } else {
          type = normalizeType(val); target = null;
        }
        return;
      }

      if (target) { target.push(raw.trim()); return; }

      var mInline = line.match(/^(.+?)\s*::\s*(.+)$/);
      if (mInline && !sawMarker) {
        sawMarker = true;
        front.push(mInline[1].trim());
        back.push(mInline[2].trim());
        return;
      }

      plain.push(raw.trim());
    });

    if (!sawMarker) {
      if (!plain.length) return null;
      front = [plain[0]];
      back = plain.slice(1);
      type = type || 'not';
    } else if (plain.length) {
      back = back.length ? back.concat(plain) : plain;
    }

    var f = front.join('\n').trim();
    var bk = back.join('\n').trim();
    if (!f && !bk) return null;
    if (!f) throw new Error('On yuz bos (S: satiri eksik)');

    if (!type) type = bk ? 'kart' : 'not';

    var now = Date.now();
    return {
      id: uid(),
      type: type,
      ders: b.ders || defaults.ders || 'Genel',
      konu: b.konu || defaults.konu || '',
      front: f,
      back: bk,
      kaynak: kaynak || '',
      tags: dedupe(tags.concat(defaults.tags || [])),
      created: now,
      updated: now,
      suspended: false,
      srs: root.HN_SRS.fresh()
    };
  }

  function normalizeType(v) {
    var n = norm(v);
    for (var i = 0; i < TYPES.length; i++) if (norm(TYPES[i]) === n) return TYPES[i];
    if (n.indexOf('kars') === 0) return 'karsilastirma';
    if (n.indexOf('sur') === 0) return 'sure';
    return 'kart';
  }

  function dedupe(a) {
    var seen = {}, out = [];
    a.forEach(function (x) {
      var k = norm(x);
      if (x && !seen[k]) { seen[k] = 1; out.push(x); }
    });
    return out;
  }

  function matches(note, query) {
    if (!query) return true;
    var q = norm(query).split(/\s+/).filter(Boolean);
    var hay = norm([note.front, note.back, note.ders, note.konu, note.kaynak,
                    (note.tags || []).join(' ')].join('  '));
    for (var i = 0; i < q.length; i++) if (hay.indexOf(q[i]) === -1) return false;
    return true;
  }

  root.HN_PARSE = { parseBulk: parseBulk, norm: norm, matches: matches, uid: uid, TYPES: TYPES };
})(self);
