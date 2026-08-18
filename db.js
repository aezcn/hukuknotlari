/* IndexedDB katmani. Hem sayfa hem service worker tarafindan kullanilir,
   bu yuzden ES module degil, global bir nesne olarak taniml. */
(function (root) {
  'use strict';

  var DB_NAME = 'hukuknotlari';
  var DB_VERSION = 1;
  var STORE = 'notes';
  var META = 'meta';

  function open() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var s = db.createObjectStore(STORE, { keyPath: 'id' });
          s.createIndex('due', 'srs.due');
          s.createIndex('ders', 'ders');
          s.createIndex('updated', 'updated');
        }
        if (!db.objectStoreNames.contains(META)) {
          db.createObjectStore(META, { keyPath: 'key' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function tx(store, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, mode);
        var s = t.objectStore(store);
        var out = fn(s);
        var isReq = (typeof IDBRequest !== 'undefined') && (out instanceof IDBRequest);
        t.oncomplete = function () { db.close(); resolve(isReq ? out.result : out); };
        t.onerror = function () { db.close(); reject(t.error); };
        t.onabort = function () { db.close(); reject(t.error); };
      });
    });
  }

  function all() {
    return tx(STORE, 'readonly', function (s) { return s.getAll(); })
      .then(function (r) { return r || []; });
  }

  function get(id) {
    return tx(STORE, 'readonly', function (s) { return s.get(id); });
  }

  function put(note) {
    return tx(STORE, 'readwrite', function (s) { s.put(note); return note; });
  }

  function putMany(notes) {
    return tx(STORE, 'readwrite', function (s) {
      notes.forEach(function (n) { s.put(n); });
      return notes.length;
    });
  }

  function remove(id) {
    return tx(STORE, 'readwrite', function (s) { s.delete(id); return id; });
  }

  function clearAll() {
    return tx(STORE, 'readwrite', function (s) { s.clear(); return true; });
  }

  function getMeta(key, fallback) {
    return tx(META, 'readonly', function (s) { return s.get(key); })
      .then(function (r) { return (r && r.value !== undefined) ? r.value : fallback; });
  }

  function setMeta(key, value) {
    return tx(META, 'readwrite', function (s) { s.put({ key: key, value: value }); return value; });
  }

  /* Bugun tekrari gelmis (veya gecikmis) kart sayisi.
     Service worker bildirim metnini buradan uretir. */
  function dueCount(todayStr) {
    return all().then(function (list) {
      var today = todayStr || localDateString(new Date());
      var n = 0;
      for (var i = 0; i < list.length; i++) {
        var x = list[i];
        if (x.suspended) continue;
        if (x.type === 'not') continue;
        if (x.srs && x.srs.due <= today) n++;
      }
      return n;
    });
  }

  function localDateString(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  root.HN_DB = {
    all: all, get: get, put: put, putMany: putMany, remove: remove,
    clearAll: clearAll, getMeta: getMeta, setMeta: setMeta,
    dueCount: dueCount, localDateString: localDateString,
    STORE: STORE, DB_NAME: DB_NAME
  };
})(self);
