# Hukuk Notları

HMGS hazırlığı için not yönetimi + aralıklı tekrar (spaced repetition) uygulaması.
Tek bir statik web sitesi olarak çalışır; iPhone’da ana ekrana eklenince gerçek bir
uygulama gibi davranır ve **kilit ekranına bildirim düşürür**.

- Notlar cihazda (IndexedDB) durur, internetsiz çalışır
- Toplu yapıştırma ile yüzlerce notu dakikalar içinde girebilirsin
- SM-2 türevi tekrar algoritması: neyi ne zaman tekrar edeceğini uygulama söyler
- Serbest çalışma: türe/derse/zorlandıklarına göre istediğin an ek tur
- Belirlediğin saatlerde push bildirimi + ana ekran ikonunda bekleyen kart rozeti
- Bildirim metni **cihazda** üretilir; not içeriği sunucuya hiç gitmez

---

## Dosyalar

| Dosya | Ne işe yarar |
|---|---|
| `index.html`, `app.js`, `app.css` | Arayüz ve uygulama mantığı |
| `db.js` | IndexedDB katmanı (sayfa + service worker ortak kullanır) |
| `srs.js` | Tekrar algoritması |
| `parse.js` | Toplu yapıştırma ayrıştırıcısı, Türkçe duyarlı arama |
| `sw.js` | Service worker: çevrimdışı çalışma + push bildirimi |
| `config.js` | **Kurulumda doldurulacak** iki değer |
| `manifest.webmanifest`, `icons/` | Ana ekran uygulaması kimliği |
| `tools/vapid.html` | VAPID anahtar çifti üretici (tarayıcıda çalışır) |
| `tools/bump.sh` | Sürüm artırıcı — her deploy öncesi çalıştır |
| `worker/src/index.js` | Cloudflare Worker — push zamanlayıcı |
| `ornek-notlar.txt` | Başlangıç için örnek toplu not metni |

---

## Kurulum

Dört adım. Node.js gerekmiyor, her şey tarayıcı + panel üzerinden.

### Adım 1 — Siteyi GitHub Pages’e koy

1. GitHub’da yeni bir **public** repo aç (ör. `hukuknotlari`).
2. Bu klasördeki dosyaları repoya yükle (`worker/` klasörü de kalabilir, zararı yok).
3. Repo → **Settings → Pages** → *Source*: `Deploy from a branch`,
   *Branch*: `main` / `/ (root)` → **Save**.
4. Bir iki dakika sonra adresin hazır: `https://KULLANICIADIN.github.io/hukuknotlari/`

> HTTPS şart — bildirim ve service worker ancak güvenli bağlantıda çalışır.
> GitHub Pages bunu kendiliğinden veriyor.

Komut satırından yapmak istersen:

```bash
git init && git add -A && git commit -m "ilk sürüm" && git branch -M main
```

### Adım 2 — VAPID anahtarı üret

`tools/vapid.html` dosyasını tarayıcıda aç (çift tıklaman yeterli) ve
**Anahtar üret**’e bas. İki değer çıkacak:

- **Açık anahtar** → `config.js` + Worker değişkeni
- **Gizli anahtar (JWK)** → sadece Worker’a *Secret* olarak

Anahtarlar tarayıcında üretilir, hiçbir yere gönderilmez. Bir kez üret, ikisini de sakla.
Gizli anahtarı repoya **koyma**.

### Adım 3 — Cloudflare Worker’ı kur

Ücretsiz plan yeterli. [dash.cloudflare.com](https://dash.cloudflare.com) → giriş yap.

**3a. KV deposu aç**
*Storage & Databases → KV → Create namespace*, adı: `hukuk-notlari-subs`

**3b. Worker oluştur**
*Workers & Pages → Create → Worker* → isim ver (ör. `hukuk-push`) → **Deploy**
Sonra **Edit code**: açılan editördeki her şeyi sil,
`worker/src/index.js` dosyasının içeriğini yapıştır → **Deploy**.

**3c. Bağlantıları ekle** (Worker → *Settings*)

| Tür | Ad | Değer |
|---|---|---|
| KV namespace binding | `SUBS` | az önce açtığın namespace |
| Variable (metin) | `VAPID_PUBLIC_KEY` | açık anahtar |
| Variable (metin) | `VAPID_SUBJECT` | `mailto:senin@mailin.com` |
| Variable (metin) | `ALLOWED_ORIGIN` | `https://KULLANICIADIN.github.io` |
| **Secret** | `VAPID_PRIVATE_JWK` | gizli anahtar (JWK’nin tamamı, `{...}` dahil) |

> `ALLOWED_ORIGIN` sadece origin’dir — sonuna `/hukuknotlari` gibi bir yol **ekleme**.

**3d. Cron ekle**
Worker → *Settings → Trigger Events → Cron Triggers → Add* → ifade: `*/15 * * * *`
(15 dakikada bir uyanıp saati gelen bildirimleri atar.)

Kontrol: `https://hukuk-push.HESABIN.workers.dev/health` adresi
`{"ok":true,...}` dönmeli.

### Adım 4 — `config.js` dosyasını doldur

```js
self.HN_CONFIG = {
  WORKER_URL: "https://hukuk-push.HESABIN.workers.dev",
  VAPID_PUBLIC_KEY: "BEk...  (açık anahtar)",
  DEFAULT_TIMES: ["08:30", "20:30"],
  DAILY_LIMIT: 60
};
```

Değiştirip repoya push et. Pages birkaç saniyede günceller.

---

## iPhone’da kurulum (kardeşinin yapacağı kısım)

1. **Safari**’de siteyi aç (Chrome değil — ekleme işlemi Safari’den yapılmalı).
2. Paylaş tuşu → **Ana Ekrana Ekle** → Ekle.
3. Uygulamayı artık **ana ekrandaki ikondan** aç.
4. İçeride **Ayarlar → Bildirimleri aç** → iOS izin soracak, **İzin Ver**.
5. Hatırlatma saatlerini seç → **Saatleri kaydet**.
6. **Test bildirimi**’ne basıp geldiğini doğrula.

> Bildirim sadece ana ekrana eklenmiş sürümde çalışır. Safari sekmesinde açıkken
> izin bile istenemez — bu iOS’un kuralı, uygulamanın eksiği değil.
> Bildirim gelmezse: Ayarlar → Bildirimler → *Hukuk Notları* → izin açık mı, bak.

---

## Not yazım biçimi (toplu yapıştırma)

```
@Medeni Hukuk/Eşya          ← sonraki notlar bu ders/konuya yazılır
S: Soru metni               ← ön yüz  (Soru: / Q: de olur)
C: Cevap metni              ← arka yüz (Cevap: / A: de olur)
K: TMK m.1007               ← kaynak
T: sure                     ← tür: kart, madde, sure, karsilastirma, not
#etiket #etiket2            ← etiketler
                            ← boş satır = yeni not başlar
```

Kısayollar:

- Tek satır: `Zamanaşımı süresi :: 10 yıl`
- Hiç işaret yoksa blok serbest nota dönüşür (ilk satır başlık, gerisi gövde)
- Serbest notlar tekrara girmez, sadece arşiv/arama içindir

`ornek-notlar.txt` dosyasının içeriğini kopyalayıp “Toplu yapıştır” alanına
yapıştırarak deneyebilirsin.

---

## Günlük kullanım

- **Bugün**: tekrarı gelen kartlar. Cevabı gör → *Tekrar / Zor / Normal / Kolay*.
  Butonların altındaki süre, o seçenekte kartın ne zaman geri geleceğini gösterir.
- **Notlar**: arama ve filtreleme. Bir nota dokun → açılır; **çift dokun** → düzenle.
- **İstatistik**: seri, geçmiş çalışma, önümüzdeki günlerin yükü, ders bazlı ilerleme.
- Bir konuyu bir süre görmek istemiyorsan notu düzenleyip **Beklet** de.

### Serbest çalışma

Günlük tekrarın dışında, canın istediğinde istediğin kesiti çalışmak için.
İki yerden başlatılır:

- **Bugün** ekranındaki *Serbest çalışma başlat*
- **Notlar** ekranında filtreleyip *Bu filtreyle çalış* — arama terimi de taşınır

Seçenekler:

| Ayar | Ne yapar |
|---|---|
| Tür | Sadece Süre, Madde, Karıştırılanlar… ya da tüm kartlar |
| Ders | Tek derse odaklan |
| Kapsam | Hepsi · Zorlandıklarım · Hiç çalışmadıklarım · Bugün bekleyenler · Yaklaşanlar (7 gün) |
| Kaç kart | 10 / 20 / 30 / 50 / hepsi |
| Sıra | Karışık · En eski · Zordan kolaya |

Örnek: *Süre + 20 kart + karışık* → 20 kartlık hızlı bir süre turu.

**Önemli:** Varsayılan olarak bu turlar **tekrar planını değiştirmez**. Kartlar
*Bilemedim / Bildim* ile geçilir, bilemediklerin tur içinde tekrar sorulur ve
sonunda “Bilemediklerimi tekrar çalış” çıkar — ama kartların tarihleri olduğu gibi
kalır. Bu turun gerçek tekrar sayılmasını istersen diyalogdaki
**“Cevaplarım tekrar planımı güncellesin”** anahtarını aç; o zaman normal
*Tekrar / Zor / Normal / Kolay* butonları gelir ve tarihler güncellenir.

Zorlandıklarım kapsamı, daha önce “Tekrar” dediğin (lapses > 0) ya da kolaylık
katsayısı düşmüş kartları toplar — sınav öncesi en verimli tur genelde budur.

---

## Yedekleme

Notlar yalnızca telefonun tarayıcı deposunda. Ana ekrana eklenmiş uygulamaların
verisi Safari’nin otomatik temizliğinden muaftır, ama yine de:

**Ayarlar → Dışa aktar** ile ara sıra JSON yedeği al (Dosyalar’a kaydedilir).
Yeni cihazda **İçe aktar** ile geri yükle — aynı `id`’li notlar güncellenir,
yenileri eklenir, mevcut ilerleme silinmez.

---

## Güncelleme yaparken

Uygulama dosyalarını her değiştirdiğinde, push etmeden önce sürümü artır:

```bash
sh tools/bump.sh
```

Bu komut üç yeri birlikte günceller — üçünün de aynı sayıda olması şart:

| Yer | Ne işe yarıyor |
|---|---|
| `sw.js` → `VERSION` | Önbelleği tazeler, eskisini siler |
| `index.html` → `?v=` | Tarayıcıyı yeni JS/CSS'i ağdan çekmeye zorlar |
| `config.js` → `HN_VERSION` | Ayarlar'ın en altında görünen sürüm |

`?v=` işaretleri önemli: onlar olmadan tarayıcı yeni `index.html` ile eski
`app.js`'i eşleştirebiliyor ve ikisi uyuşmazsa uygulama açılışta bozuluyor.

### Telefonda ne oluyor

Uygulama ana ekrandan açıldığında yeni sürüm kendiliğinden iniyor, ekranda
**“Yeni sürüm hazır — Yenile”** şeridi çıkıyor. Şeride basmak yeterli;
basılmazsa bir sonraki açılışta zaten yeni sürümle açılır.

Notlar bundan hiç etkilenmiyor: IndexedDB'de duruyorlar, önbellek silinse de
yerinde kalıyorlar. Sürüm atlamak veri kaybettirmez.

> `db.js` içindeki `DB_VERSION` ayrı bir konu — ona dokunmak veritabanı şeması
> değiştirmek demek ve `onupgradeneeded` içine geçiş yazmayı gerektirir.
> Yeni alan eklemek için gerekmiyor; sadece yeni kodun eski notlarda o alanı
> bulamayacağını hesaba katıp `n.tags || []` gibi savunmacı yazmak yeterli.

---

## Yerelde test

```bash
python3 -m http.server 8787
```

Sonra `http://localhost:8787` — `localhost` güvenli sayıldığı için service worker
orada da çalışır (push için Worker adresini doldurman gerekir).

---

## Sorun giderme

| Belirti | Sebep / çözüm |
|---|---|
| Ayarlar’da “Kurulum tamamlanmadı” | `config.js` boş — Adım 4 |
| “Önce ana ekrana ekle” uyarısı | Safari sekmesinden açılmış; ana ekran ikonundan aç |
| İzin isteme ekranı hiç çıkmıyor | Daha önce reddedilmiş: iOS Ayarlar → Bildirimler → Hukuk Notları |
| Test bildirimi 502 dönüyor | Worker’daki `VAPID_PRIVATE_JWK` / `VAPID_PUBLIC_KEY` eşleşmiyor — ikisini de aynı üretimden al |
| Test çalışıyor ama zamanlı bildirim gelmiyor | Cron tetikleyicisi eklenmemiş (Adım 3d) ya da saat dilimi yanlış; bildirimi kapatıp aç |
| Değişiklik telefona yansımıyor | Sürüm artırılmamış — `sh tools/bump.sh` çalıştırıp tekrar push et |

---

## Gizlilik

Sunucuya giden tek şey: push endpoint adresi, seçtiğin hatırlatma saatleri ve
saat dilimin. Notların, cevapların, çalışma geçmişin telefondan çıkmaz — push
gövdesiz gönderilir, “kaç kart bekliyor” sayısını service worker cihazda hesaplar.
