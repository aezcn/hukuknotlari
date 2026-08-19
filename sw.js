/* Service worker: cevrimdisi calisma + push bildirimi.
   Bildirim metni CIHAZDA uretilir; sunucu bos bir push gonderir, icerik disari cikmaz. */

/* SURUM: index.html'deki ?v= degeri ile ayni olmali.
   Ikisini birden artirmak icin: tools/bump.sh */
var VERSION = 'v23';
var ASSET_V = VERSION.slice(1);

importScripts('config.js?v=' + ASSET_V, 'db.js?v=' + ASSET_V);

var CACHE = 'hukuknotlari-' + VERSION;
var SHELL = [
  './',
  './index.html',
  './app.css?v=' + ASSET_V,
  './config.js?v=' + ASSET_V,
  './db.js?v=' + ASSET_V,
  './srs.js?v=' + ASSET_V,
  './parse.js?v=' + ASSET_V,
  './app.js?v=' + ASSET_V,
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(SHELL.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      /* Eski bir surum onbellegi varsa bu bir GUNCELLEME'dir, ilk kurulum degil.
         Ayrimi burada yapiyoruz; ilk kurulumda "yeni surum" seridi cikmasin. */
      var wasUpdate = keys.some(function (k) {
        return k !== CACHE && k.indexOf('hukuknotlari-') === 0;
      });
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      })).then(function () { return wasUpdate; });
    }).then(function (wasUpdate) {
      return self.clients.claim().then(function () {
        if (!wasUpdate) return;
        return self.clients.matchAll({ type: 'window' }).then(function (list) {
          list.forEach(function (c) {
            c.postMessage({ type: 'hn-updated', version: VERSION });
          });
        });
      });
    })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put('./index.html', copy); });
        return res;
      }).catch(function () {
        return caches.match('./index.html').then(function (r) {
          return r || new Response('Cevrimdisi', { status: 503 });
        });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function (cached) {
      var net = fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return cached; });
      return cached || net;
    })
  );
});

/* -------------------------------------------------------------------------
   Push: sunucudan govde gelmez. Bekleyen kart sayisini yerel veritabanindan
   okuyup bildirimi burada olusturuyoruz.
-------------------------------------------------------------------------- */
self.addEventListener('push', function (e) {
  e.waitUntil(showReminder(readPayload(e)));
});

function readPayload(e) {
  try {
    if (e.data) {
      var txt = e.data.text();
      if (txt) {
        try { return JSON.parse(txt); } catch (_) { return { body: txt }; }
      }
    }
  } catch (_) {}
  return {};
}

function showReminder(payload) {
  return self.HN_DB.dueCount().then(function (n) {
    if (navigator.setAppBadge) {
      if (n > 0) navigator.setAppBadge(n).catch(function () {});
      else if (navigator.clearAppBadge) navigator.clearAppBadge().catch(function () {});
    }
    var title = payload.title || 'Hukuk Notları';
    var body = payload.body || (n > 0
      ? n + ' kart tekrar bekliyor'
      : 'Bugün tekrar yok. Yeni not eklemeye ne dersin?');
    return self.registration.showNotification(title, {
      body: body,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: 'hn-reminder',
      renotify: true,
      data: { url: './' }
    });
  }).catch(function () {
    return self.registration.showNotification('Hukuk Notları', {
      body: 'Tekrar zamanı',
      icon: './icons/icon-192.png',
      tag: 'hn-reminder',
      data: { url: './' }
    });
  });
}

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var target = new URL((e.notification.data && e.notification.data.url) || './',
                       self.location.href).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url.indexOf(self.registration.scope) === 0 && 'focus' in list[i]) {
          return list[i].focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

/* Abonelik suresi dolarsa tarayici bunu tetikler; yenisini sunucuya bildir. */
self.addEventListener('pushsubscriptionchange', function (e) {
  var base = (self.HN_CONFIG && self.HN_CONFIG.WORKER_URL) || '';
  if (!base) return;
  e.waitUntil(
    self.registration.pushManager.getSubscription().then(function (sub) {
      if (!sub) return;
      return fetch(base.replace(/\/+$/, '') + '/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON() })
      }).catch(function () {});
    })
  );
});
