// ---------------------------------------------------------------------------
// Kurulum sonrasi doldurulacak iki deger. README.md'deki adimlari izle.
// ---------------------------------------------------------------------------
self.HN_VERSION = "1.0.20";
self.HN_CONFIG = {
  // Cloudflare Worker adresin. Ornek: "https://hukuk-push.aliemre.workers.dev"
  // Bos birakirsan uygulama calisir ama bildirim ozelligi kapali gorunur.
  WORKER_URL: "https://hukuk-push.aliemrozcan.workers.dev",

  // tools/vapid.html ile urettigin ACIK anahtar (base64url, ~87 karakter).
  VAPID_PUBLIC_KEY: "BCfLeqQpigEhfz7QSO_LosCk8M8KoXlkgi7m5BgI-ZdsW4IwgZ1kQvaT7yuVGQey8td7_d41HkqhrFqUU_Wbr4w",

  // Varsayilan hatirlatma saatleri (kullanici Ayarlar'dan degistirebilir)
  DEFAULT_TIMES: ["08:30", "20:30"],

  // Bir oturumda gosterilecek azami kart sayisi
  DAILY_LIMIT: 60
};
