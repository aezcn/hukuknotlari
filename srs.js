/* Araliklarla tekrar (SM-2 tureviyle). Gun bazli calisir. */
(function (root) {
  'use strict';

  var MIN_EASE = 1.3;
  var MAX_INTERVAL = 365 * 2;
  var LEECH_AT = 8;      /* bu kadar unutmadan sonra kart "takilan" sayilir */
  var LEECH_AGAIN = 4;   /* uyari tekrarlanmadan once gereken ek unutma */

  function today() { return root.HN_DB.localDateString(new Date()); }

  function addDays(dateStr, days) {
    var p = dateStr.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    d.setDate(d.getDate() + days);
    return root.HN_DB.localDateString(d);
  }

  function daysBetween(a, b) {
    var pa = a.split('-'), pb = b.split('-');
    var da = new Date(Number(pa[0]), Number(pa[1]) - 1, Number(pa[2]));
    var db = new Date(Number(pb[0]), Number(pb[1]) - 1, Number(pb[2]));
    return Math.round((db - da) / 86400000);
  }

  function fresh() {
    return { due: today(), interval: 0, ease: 2.5, reps: 0, lapses: 0, state: 'yeni' };
  }

  /* rating: 'tekrar' | 'zor' | 'normal' | 'kolay'
     Donus: { srs: {...}, again: bool }  -> again true ise kart bu oturumda tekrar sorulur. */
  function review(srs, rating) {
    var s = Object.assign({}, srs || fresh());
    var again = false;
    s.reps = (s.reps || 0) + 1;

    if (rating === 'tekrar') {
      s.lapses = (s.lapses || 0) + 1;
      s.ease = Math.max(MIN_EASE, (s.ease || 2.5) - 0.2);
      s.interval = 0;
      s.due = today();
      s.state = 'ogreniliyor';
      again = true;
      return { srs: s, again: again };
    }

    if (s.state === 'yeni' || s.state === 'ogreniliyor') {
      if (rating === 'zor') s.interval = 1;
      else if (rating === 'normal') s.interval = 2;
      else s.interval = 4;
      s.state = 'tekrar';
    } else {
      var iv = Math.max(1, s.interval || 1);
      if (rating === 'zor') {
        s.ease = Math.max(MIN_EASE, s.ease - 0.15);
        s.interval = Math.max(1, Math.round(iv * 1.2));
      } else if (rating === 'normal') {
        s.interval = Math.max(1, Math.round(iv * s.ease));
      } else {
        s.ease = s.ease + 0.15;
        s.interval = Math.max(1, Math.round(iv * s.ease * 1.3));
      }
    }

    s.interval = Math.min(MAX_INTERVAL, s.interval);
    s.due = addDays(today(), s.interval);
    return { srs: s, again: false };
  }

  /* Bir sonraki tekrarin ne kadar sonra olacagini butonda gostermek icin. */
  function preview(srs, rating) {
    var r = review(srs, rating);
    if (r.again) return 'birazdan';
    var d = r.srs.interval;
    if (d < 1) return 'bugün';
    if (d === 1) return '1 gün';
    if (d < 30) return d + ' gün';
    if (d < 365) return Math.round(d / 30) + ' ay';
    return (Math.round(d / 36.5) / 10) + ' yıl';
  }

  /* Cok unutulan kart genelde kotu yazilmis karttir. Bunlari isaretliyoruz. */
  function isLeech(note) {
    var s = note && note.srs;
    return !!(s && (s.lapses || 0) >= LEECH_AT);
  }

  /* Her unutmada uyarmayalim: esikte bir kez, sonra dorder unutmada bir. */
  function shouldWarnLeech(srs) {
    var l = (srs && srs.lapses) || 0;
    if (l < LEECH_AT) return false;
    var last = srs.leechWarn || 0;
    if (!last) return true;
    return (l - last) >= LEECH_AGAIN;
  }

  function markLeechWarned(srs) {
    if (srs) srs.leechWarn = srs.lapses || 0;
  }

  function isDue(note, dateStr) {
    if (note.suspended) return false;
    if (note.type === 'not') return false;
    return note.srs && note.srs.due <= (dateStr || today());
  }

  root.HN_SRS = {
    fresh: fresh, review: review, preview: preview, isDue: isDue,
    today: today, addDays: addDays, daysBetween: daysBetween,
    isLeech: isLeech, shouldWarnLeech: shouldWarnLeech,
    markLeechWarned: markLeechWarned, LEECH_AT: LEECH_AT
  };
})(self);
