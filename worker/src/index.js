/**
 * Hukuk Notlari — push zamanlayici (Cloudflare Worker)
 *
 * Ne yapar:
 *   - Tarayicidan gelen push aboneliklerini KV'ye yazar (endpoint + saatler + saat dilimi)
 *   - Her 15 dakikada bir cron ile uyanir, saati gelen aboneliklere BOS bir push atar
 *   - Bildirim metnini cihazdaki service worker uretir; not icerigi buraya hic gelmez
 *
 * Gerekli baglantilar:
 *   KV namespace binding : SUBS
 *   Secret               : VAPID_PRIVATE_JWK   (tools/vapid.html ciktisi, JSON metni)
 *   Var                  : VAPID_PUBLIC_KEY    (base64url acik anahtar)
 *   Var                  : VAPID_SUBJECT       (ornek: mailto:seninmailin@ornek.com)
 *   Var                  : ALLOWED_ORIGIN      (ornek: https://kullanici.github.io)
 */

const WINDOW_MIN = 20;   // cron 15 dk'da bir; kacirma olmasin diye biraz genis pencere
const TTL_SEC = 3 * 3600;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      if (url.pathname === '/' || url.pathname === '/health') {
        return json({ ok: true, service: 'hukuknotlari-push' }, 200, cors);
      }
      if (url.pathname === '/subscribe' && request.method === 'POST') {
        return await handleSubscribe(request, env, cors);
      }
      if (url.pathname === '/unsubscribe' && request.method === 'POST') {
        return await handleUnsubscribe(request, env, cors);
      }
      if (url.pathname === '/test' && request.method === 'POST') {
        return await handleTest(request, env, cors);
      }
      return json({ error: 'not found' }, 404, cors);
    } catch (err) {
      return json({ error: String(err && err.message || err) }, 500, cors);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReminders(env, new Date(event.scheduledTime)));
  }
};

// ---------------------------------------------------------------------------
// Uc noktalar
// ---------------------------------------------------------------------------

async function handleSubscribe(request, env, cors) {
  const body = await request.json();
  const sub = body.subscription;
  if (!sub || !sub.endpoint) return json({ error: 'subscription eksik' }, 400, cors);
  if (!/^https:\/\//.test(sub.endpoint)) return json({ error: 'gecersiz endpoint' }, 400, cors);

  const key = await subKey(sub.endpoint);
  const existing = await env.SUBS.get(key, 'json');

  const record = {
    endpoint: sub.endpoint,
    times: normalizeTimes(body.times) || (existing && existing.times) || ['08:30', '20:30'],
    tz: body.tz || (existing && existing.tz) || 'Europe/Istanbul',
    created: (existing && existing.created) || Date.now(),
    updated: Date.now(),
    lastSent: (existing && existing.lastSent) || ''
  };

  await env.SUBS.put(key, JSON.stringify(record));
  return json({ ok: true, times: record.times, tz: record.tz }, 200, cors);
}

async function handleUnsubscribe(request, env, cors) {
  const body = await request.json();
  if (!body.endpoint) return json({ error: 'endpoint eksik' }, 400, cors);
  await env.SUBS.delete(await subKey(body.endpoint));
  return json({ ok: true }, 200, cors);
}

async function handleTest(request, env, cors) {
  const body = await request.json();
  if (!body.endpoint) return json({ error: 'endpoint eksik' }, 400, cors);
  const key = await subKey(body.endpoint);
  const rec = await env.SUBS.get(key, 'json');
  if (!rec) return json({ error: 'abonelik bulunamadi' }, 404, cors);

  const res = await sendPush(env, rec.endpoint);
  if (res.status === 404 || res.status === 410) await env.SUBS.delete(key);
  return json({ ok: res.ok, status: res.status }, res.ok ? 200 : 502, cors);
}

// ---------------------------------------------------------------------------
// Cron
// ---------------------------------------------------------------------------

async function runReminders(env, now) {
  let cursor;
  let sent = 0, checked = 0;

  do {
    const page = await env.SUBS.list({ prefix: 'sub:', cursor });
    cursor = page.list_complete ? null : page.cursor;

    for (const k of page.keys) {
      const rec = await env.SUBS.get(k.name, 'json');
      if (!rec) continue;
      checked++;

      const hit = dueTime(rec, now);
      if (!hit) continue;

      const stamp = hit.date + 'T' + hit.time;
      if (rec.lastSent === stamp) continue;

      const res = await sendPush(env, rec.endpoint);
      if (res.status === 404 || res.status === 410) {
        await env.SUBS.delete(k.name);
        continue;
      }
      if (res.ok) {
        rec.lastSent = stamp;
        await env.SUBS.put(k.name, JSON.stringify(rec));
        sent++;
      }
    }
  } while (cursor);

  console.log(`cron: ${checked} abonelik kontrol edildi, ${sent} bildirim gonderildi`);
}

/** Kullanicinin saat diliminde su an hatirlatma saatlerinden birine denk geliyor mu? */
function dueTime(rec, now) {
  const local = localParts(rec.tz || 'Europe/Istanbul', now);
  for (const t of (rec.times || [])) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (!m) continue;
    const target = Number(m[1]) * 60 + Number(m[2]);
    const diff = local.minutes - target;
    if (diff >= 0 && diff < WINDOW_MIN) {
      return { date: local.date, time: pad(m[1]) + ':' + m[2] };
    }
  }
  return null;
}

function localParts(tz, now) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    }).formatToParts(now);
  } catch (_) {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    }).formatToParts(now);
  }
  const p = {};
  for (const x of parts) p[x.type] = x.value;
  const hour = Number(p.hour) % 24;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: hour * 60 + Number(p.minute)
  };
}

// ---------------------------------------------------------------------------
// Web Push (govdesiz) — VAPID imzasi Web Crypto ile
// ---------------------------------------------------------------------------

let cachedKey = null;

async function signingKey(env) {
  if (cachedKey) return cachedKey;
  const jwk = JSON.parse(env.VAPID_PRIVATE_JWK);
  delete jwk.key_ops;
  delete jwk.ext;
  delete jwk.alg;
  cachedKey = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
  return cachedKey;
}

async function vapidJWT(env, audience) {
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || 'mailto:noreply@example.com'
  };
  const signingInput = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(payload));
  const key = await signingKey(env);
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput)
  );
  return signingInput + '.' + b64urlBytes(new Uint8Array(sig));
}

/** Govdesiz push: icerik yok, sadece "uyan" sinyali. Metni cihaz uretir. */
async function sendPush(env, endpoint) {
  const aud = new URL(endpoint).origin;
  const jwt = await vapidJWT(env, aud);
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      'TTL': String(TTL_SEC),
      'Urgency': 'normal',
      'Authorization': `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`
    }
  });
}

// ---------------------------------------------------------------------------
// Yardimcilar
// ---------------------------------------------------------------------------

async function subKey(endpoint) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return 'sub:' + b64urlBytes(new Uint8Array(digest));
}

function b64url(str) {
  return b64urlBytes(new TextEncoder().encode(str));
}

function b64urlBytes(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function normalizeTimes(times) {
  if (!Array.isArray(times)) return null;
  const out = times
    .filter(t => typeof t === 'string' && /^\d{1,2}:\d{2}$/.test(t))
    .map(t => {
      const [h, m] = t.split(':');
      return pad(h) + ':' + m;
    });
  return out.length ? Array.from(new Set(out)).sort() : null;
}

function pad(h) { return String(Number(h)).padStart(2, '0'); }

function corsHeaders(request, env) {
  const allowed = env.ALLOWED_ORIGIN || '*';
  const origin = request.headers.get('Origin') || '';
  const allow = allowed === '*' ? '*'
    : (allowed.split(',').map(s => s.trim()).includes(origin) ? origin : allowed.split(',')[0].trim());
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors }
  });
}
