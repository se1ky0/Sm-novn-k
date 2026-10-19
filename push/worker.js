/* Směnovník – server pro notifikace (Cloudflare Worker).
 * Aplikace sem po změně v týmu pošle jen „co se změnilo“ (např. akce X). Server si podrobnosti
 * přečte z Firestore s přihlášením odesílatele (platí stejná pravidla jako v aplikaci),
 * sám složí text a rozešle Web Push na telefony kolegů.
 * Přihlášení telefonů k notifikacím drží v KV pod klíčem s:{kod týmu}:{uid}. */

const TYPY = { skoleni: ['🎓', 'Školení'], porada: ['💬', 'Porada'], prescas: ['⏱️', 'Přesčas'], lekar: ['🩺', 'Lékař'], jine: ['📌', 'Akce'] };
const ODP = { ano: ['✓', 'přijde'], mozna: ['?', 'možná přijde'], ne: ['✗', 'nepřijde'] };
const SMENY = { D: 'Denní', N: 'Noční', V: 'Volno' };
const DNY = ['ne', 'po', 'út', 'st', 'čt', 'pá', 'so'];
const KOD = /^[A-Z2-9]{8}$/, ID = /^[A-Za-z0-9_-]{1,40}$/, UID = /^[A-Za-z0-9]{1,128}$/;
const DAT = /^\d{4}-\d\d-\d\d$/, HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const PUSH_HOSTY = /^(fcm\.googleapis\.com|[a-z0-9.-]*push\.services\.mozilla\.com|[a-z0-9.-]*notify\.windows\.com|web\.push\.apple\.com|[a-z0-9.-]*\.push\.apple\.com)$/;

class Chyba extends Error { constructor(status, msg) { super(msg); this.status = status; } }

/* ---------- pomocné ---------- */
const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const zB64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const spoj = (...casti) => { const out = new Uint8Array(casti.reduce((n, c) => n + c.length, 0)); let i = 0; for (const c of casti) { out.set(c, i); i += c.length; } return out; };
const text = (x, n) => String(x ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
function kdy(datum, od) {
  const [y, m, d] = datum.split('-').map(Number);
  return `${DNY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d}. ${m}.${od ? ' ' + od : ''}`;
}
/* hodnoty z Firestore REST → obyčejný JS */
function zFs(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('mapValue' in v) return zFsMapa(v.mapValue.fields);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(zFs);
  return null;
}
const zFsMapa = f => { const o = {}; for (const k in f || {}) o[k] = zFs(f[k]); return o; };

/* ---------- přihlášení: ID token z Firebase Auth ---------- */
let klice = { jwk: null, do: 0 };
async function overToken(token, env) {
  const casti = String(token || '').split('.');
  if (casti.length !== 3) throw new Chyba(401, 'Chybí přihlášení');
  let hlava, telo;
  try { hlava = JSON.parse(new TextDecoder().decode(zB64u(casti[0]))); telo = JSON.parse(new TextDecoder().decode(zB64u(casti[1]))); }
  catch (e) { throw new Chyba(401, 'Neplatné přihlášení'); }
  const now = Date.now() / 1000;
  if (telo.aud !== env.PROJECT_ID || telo.iss !== 'https://securetoken.google.com/' + env.PROJECT_ID || !(telo.exp > now) || !(telo.iat < now + 300) || !UID.test(telo.sub || ''))
    throw new Chyba(401, 'Neplatné přihlášení');
  if (env.EMU === '1') return telo.sub; /* emulátor Firebase tokeny nepodepisuje (jen pro testy) */
  if (hlava.alg !== 'RS256') throw new Chyba(401, 'Neplatné přihlášení');
  if (!klice.jwk || klice.do < Date.now()) {
    const r = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
    const max = /max-age=(\d+)/.exec(r.headers.get('cache-control') || '');
    klice = { jwk: (await r.json()).keys, do: Date.now() + (max ? +max[1] : 3600) * 1000 };
  }
  const jwk = klice.jwk.find(k => k.kid === hlava.kid);
  if (!jwk) throw new Chyba(401, 'Neplatné přihlášení');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, zB64u(casti[2]), enc.encode(casti[0] + '.' + casti[1]));
  if (!ok) throw new Chyba(401, 'Neplatné přihlášení');
  return telo.sub;
}

/* ---------- Firestore s přihlášením odesílatele ---------- */
async function fs(env, token, cesta) {
  const base = env.FIRESTORE || `https://firestore.googleapis.com/v1/projects/${env.PROJECT_ID}/databases/(default)/documents`;
  const r = await fetch(`${base}/${cesta}`, { headers: { Authorization: 'Bearer ' + token } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Chyba(r.status === 401 ? 401 : 403, 'Firestore odmítl přístup');
  return r.json();
}
const dokument = async (env, token, cesta) => { const d = await fs(env, token, cesta); return d ? zFsMapa(d.fields) : null; };
async function clenove(env, token, kod) {
  const d = await fs(env, token, `tymy/${kod}/clenove?pageSize=300`);
  const m = {};
  for (const x of (d && d.documents) || []) m[x.name.split('/').pop()] = zFsMapa(x.fields);
  return m;
}

/* ---------- Web Push: VAPID (RFC 8292) a šifrování aes128gcm (RFC 8291) ---------- */
let vapidKlic = null;
async function vapid(endpoint, env) {
  if (!vapidKlic) vapidKlic = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const h = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const p = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, vapidKlic, enc.encode(h + '.' + p));
  return `vapid t=${h}.${p}.${b64u(sig)}, k=${env.VAPID_PUBLIC}`;
}
async function hkdf(salt, ikm, info, bajty) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, bajty * 8));
}
async function zasifruj(zprava, sub) {
  const uaPub = zB64u(sub.keys.p256dh), auth = zB64u(sub.keys.auth);
  const ua = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const tajne = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: ua }, as.privateKey, 256));
  const ikm = await hkdf(auth, tajne, spoj(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const klic = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const sifra = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, klic, spoj(enc.encode(zprava), new Uint8Array([2]))));
  const hlava = new Uint8Array(21); hlava.set(salt); new DataView(hlava.buffer).setUint32(16, 4096); hlava[20] = 65;
  return spoj(hlava, asPub, sifra);
}
/* vrací stav od push služby; 410 = telefon už neexistuje (i když pro něj nejde šifrovat), 0 = výpadek sítě */
async function posli(sub, zprava, env) {
  let telo;
  try { telo = await zasifruj(JSON.stringify(zprava), sub); } catch (e) { console.log('push: nejde šifrovat', e.message); return 410; }
  try {
    const r = await fetch(sub.endpoint, {
      method: 'POST',
      headers: { Authorization: await vapid(sub.endpoint, env), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high' },
      body: telo
    });
    if (!r.ok) console.log('push:', r.status, new URL(sub.endpoint).host, (await r.text()).slice(0, 120));
    return r.status;
  } catch (e) { console.log('push: chyba', e.message); return 0; }
}

/* ---------- přihlášené telefony v KV ---------- */
const kvKlic = (kod, uid) => `s:${kod}:${uid}`;
async function telefony(env, kod, uid) { return (await env.SUBS.get(kvKlic(kod, uid), 'json')) || []; }
async function rozesli(env, kod, komu, zprava, filtr) {
  let n = 0;
  await Promise.all(komu.map(async uid => {
    const subs = await telefony(env, kod, uid), mrtve = [];
    for (const s of subs) {
      if (filtr && !filtr(s)) continue;
      const st = await posli(s, zprava, env);
      if (st >= 200 && st < 300) n++;
      else if (st === 404 || st === 410) mrtve.push(s.endpoint);
    }
    if (mrtve.length) {
      const zbyle = subs.filter(s => !mrtve.includes(s.endpoint));
      if (zbyle.length) await env.SUBS.put(kvKlic(kod, uid), JSON.stringify(zbyle)); else await env.SUBS.delete(kvKlic(kod, uid));
    }
  }));
  return n;
}
const platnyEndpoint = (e, env) => {
  try { const u = new URL(e); return e.length <= 1000 && ((u.protocol === 'https:' && PUSH_HOSTY.test(u.hostname)) || (env.PUSH_TEST_HOST && u.host === env.PUSH_TEST_HOST)); }
  catch (x) { return false; }
};

/* ---------- požadavky z aplikace ---------- */
const limity = new Map();
function limit(uid) {
  const t = Date.now(), l = (limity.get(uid) || []).filter(x => x > t - 60000);
  if (l.length >= 30) throw new Chyba(429, 'Příliš mnoho požadavků');
  l.push(t); limity.set(uid, l);
}
async function obsluz(cesta, data, uid, token, env) {
  const kod = String(data.kod || '');
  if (!KOD.test(kod)) throw new Chyba(400, 'Neplatný kód týmu');
  const lide = await clenove(env, token, kod);
  const ja = lide[uid];
  if (!ja) throw new Chyba(403, 'Nejsi členem týmu');
  const jmeno = text(ja.jmeno, 40) || 'Kolega';

  if (cesta === '/subscribe') {
    const s = data.sub || {}, k = s.keys || {};
    if (!platnyEndpoint(s.endpoint, env) || !/^[A-Za-z0-9_-]{80,100}$/.test(k.p256dh || '') || !/^[A-Za-z0-9_-]{16,32}$/.test(k.auth || ''))
      throw new Chyba(400, 'Neplatné přihlášení k notifikacím');
    try { await crypto.subtle.importKey('raw', zB64u(k.p256dh), { name: 'ECDH', namedCurve: 'P-256' }, false, []); }
    catch (e) { throw new Chyba(400, 'Neplatný klíč pro notifikace'); }
    const subs = (await telefony(env, kod, uid)).filter(x => x.endpoint !== s.endpoint);
    subs.push({ endpoint: s.endpoint, keys: { p256dh: k.p256dh, auth: k.auth }, smeny: data.smeny !== false, ts: Date.now() });
    await env.SUBS.put(kvKlic(kod, uid), JSON.stringify(subs.slice(-5)));
    return { ok: true };
  }
  if (cesta === '/unsubscribe') {
    const subs = await telefony(env, kod, uid), zbyle = subs.filter(x => x.endpoint !== data.endpoint);
    if (zbyle.length) await env.SUBS.put(kvKlic(kod, uid), JSON.stringify(zbyle)); else await env.SUBS.delete(kvKlic(kod, uid));
    return { ok: true };
  }
  if (cesta !== '/notify') throw new Chyba(404, 'Neznámá adresa');

  const typ = data.typ, ostatni = Object.keys(lide).filter(u => u !== uid);
  const cile = pro => Array.isArray(pro) && pro.length ? pro.filter(u => u !== uid && lide[u]) : ostatni;
  let komu, zprava, filtr = null;
  if (typ === 'test') {
    komu = [uid];
    zprava = { title: '🔔 Notifikace fungují', body: 'Takhle ti budou chodit novinky z týmu.', tag: 'test', url: './?tab=tym' };
  } else if (typ === 'akce' || typ === 'zruseno') {
    if (!ID.test(String(data.id || ''))) throw new Chyba(400, 'Neplatná akce');
    const a = await dokument(env, token, `tymy/${kod}/akce/${data.id}`);
    let x;
    if (typ === 'akce') {
      if (!a || a.autor !== uid) throw new Chyba(403, 'Akci nezadal(a) ty');
      x = a;
    } else {
      const tym = await dokument(env, token, `tymy/${kod}`);
      if (a || !tym || !Array.isArray(tym.mistri) || !tym.mistri.includes(uid)) throw new Chyba(403, 'Akci může zrušit jen mistr');
      x = { typ: data.typAkce, nazev: data.nazev, datum: data.datum, od: data.od, pro: data.pro };
    }
    if (!DAT.test(x.datum || '')) throw new Chyba(400, 'Neplatná akce');
    const [i, n] = TYPY[x.typ] || TYPY.jine, nazev = text(x.nazev, 60) || n, od = HM.test(x.od || '') ? x.od : '';
    komu = cile(x.pro);
    if (typ === 'zruseno') zprava = { title: `❌ Zrušeno: ${nazev}`, body: `${kdy(x.datum, od)} · zrušil(a) ${jmeno}`, tag: 'akce-' + data.id, url: './?tab=tym' };
    else zprava = {
      title: `${i} ${data.zmena ? 'Změna' : 'Nové'}: ${nazev}`,
      body: `${kdy(x.datum, od)}${HM.test(x.do || '') && od ? '–' + x.do : ''}${x.misto ? ' · ' + text(x.misto, 60) : ''} · zadal(a) ${jmeno}. Přijdeš?`,
      tag: 'akce-' + data.id, url: './?akce=' + data.id
    };
  } else if (typ === 'odpoved') {
    if (!ID.test(String(data.id || ''))) throw new Chyba(400, 'Neplatná akce');
    const a = await dokument(env, token, `tymy/${kod}/akce/${data.id}`), o = ja.odpovedi && ja.odpovedi[data.id];
    if (!a || !o || !ODP[o.stav] || !lide[a.autor] || a.autor === uid) throw new Chyba(400, 'Není komu odpovídat');
    const [i, n] = ODP[o.stav], nazev = text(a.nazev, 60) || (TYPY[a.typ] || TYPY.jine)[1];
    komu = [a.autor];
    zprava = { title: `${i} ${jmeno} ${n}`, body: `${nazev} · ${kdy(a.datum, a.od)}${o.poznamka ? ` – „${text(o.poznamka, 120)}“` : ''}`, tag: `odp-${data.id}-${uid}`, url: './?akce=' + data.id };
  } else if (typ === 'smena') {
    if (!DAT.test(String(data.datum || ''))) throw new Chyba(400, 'Neplatné datum');
    const z = (Array.isArray(ja.zasahy) ? ja.zasahy : []).find(x => x && x.datum === data.datum);
    let co = 'zpět podle rozpisu';
    if (z && SMENY[z.smena]) {
      const s = ja.nastaveni && ja.nastaveni.smeny && ja.nastaveni.smeny[z.smena];
      const cas = HM.test(z.od || '') && HM.test(z.do || '') ? `${z.od}–${z.do}` : s && HM.test(s.od || '') ? `${s.od}–${s.do}` : '';
      co = SMENY[z.smena] + (z.smena !== 'V' && cas ? ' ' + cas : '') + (z.poznamka ? ` · ${text(z.poznamka, 80)}` : '');
    }
    komu = ostatni;
    filtr = s => s.smeny !== false;
    zprava = { title: `🔁 ${jmeno}: změna směny`, body: `${kdy(data.datum)} → ${co}`, tag: `smena-${uid}-${data.datum}`, url: './?tab=tym' };
  } else throw new Chyba(400, 'Neznámý typ zprávy');
  return { ok: true, odeslano: await rozesli(env, kod, komu, zprava, filtr) };
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const povolene = String(env.ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const cors = povolene.includes(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
    const odpovez = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors } });
    const cesta = new URL(req.url).pathname;
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '86400' } });
    if (req.method === 'GET' && cesta === '/') return odpovez({ ok: true, sluzba: 'Směnovník – notifikace' });
    if (req.method !== 'POST') return odpovez({ chyba: 'Nepovolená metoda' }, 405);
    try {
      if (!cors['Access-Control-Allow-Origin']) throw new Chyba(403, 'Nepovolený původ');
      const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      const uid = await overToken(token, env);
      limit(uid);
      const data = await req.json().catch(() => ({}));
      return odpovez(await obsluz(cesta, data, uid, token, env));
    } catch (e) {
      return odpovez({ chyba: e.message || 'Chyba' }, e.status || 500);
    }
  }
};
