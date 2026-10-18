// Work Docs — start płatności Premium przez Przelewy24 (Vercel Serverless Function).
// Zalogowany użytkownik klika „Zdobądź Premium”; zwracamy adres strony płatności.
//
// Zmienne środowiskowe (Vercel → Settings → Environment Variables), wszystkie jako Secret:
//   P24_MERCHANT_ID   numer sprzedawcy (ten sam co login do panelu)
//   P24_POS_ID        numer punktu płatności (zwykle taki sam jak merchant id)
//   P24_CRC           klucz CRC (panel Przelewy24 → Moje dane → Dane konta/klucze)
//   P24_API_KEY       klucz do API REST („klucz do raportów”)
//   P24_SANDBOX       "1" = środowisko testowe (sandbox); usuń na produkcji
//   SITE_URL_WORKDOCS adres strony, np. https://www.workdocs.online
//   PREMIUM_PRICE_GR  (opcjonalne) cena w groszach, domyślnie 1000 (= 10 zł)
//   SUPABASE_URL_WORKDOCS, SUPABASE_SERVICE_ROLE_KEY_WORKDOCS (te same co przy rejestracji)

const crypto = require('crypto');

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}
const sha384 = s => crypto.createHash('sha384').update(s).digest('hex');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Metoda niedozwolona' });

  const env = process.env;
  const sbUrl = (env.SUPABASE_URL_WORKDOCS || '').replace(/\/+$/, '');
  const sbKey = env.SUPABASE_SERVICE_ROLE_KEY_WORKDOCS;
  const merchantId = Number(env.P24_MERCHANT_ID), posId = Number(env.P24_POS_ID || env.P24_MERCHANT_ID);
  const crc = env.P24_CRC, apiKey = env.P24_API_KEY;
  const site = (env.SITE_URL_WORKDOCS || '').replace(/\/+$/, '');
  if (!sbUrl || !sbKey || !merchantId || !crc || !apiKey || !site) return send(res, 501, { error: 'not_configured' });

  // kto kupuje: sprawdzamy token zalogowanego użytkownika
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return send(res, 401, { error: 'Zaloguj się, aby kupić Premium.' });
  let user;
  try {
    const r = await fetch(`${sbUrl}/auth/v1/user`, { headers: { apikey: sbKey, authorization: `Bearer ${token}` } });
    if (!r.ok) return send(res, 401, { error: 'Sesja wygasła — zaloguj się ponownie.' });
    user = await r.json();
  } catch { return send(res, 502, { error: 'Nie udało się sprawdzić konta.' }); }
  if (!user || !user.id || !user.email) return send(res, 401, { error: 'Zaloguj się, aby kupić Premium.' });

  const rest = (path, method, payload, extra) => fetch(`${sbUrl}/rest/v1/${path}`, {
    method,
    headers: { 'content-type': 'application/json', apikey: sbKey, authorization: `Bearer ${sbKey}`, ...(extra || {}) },
    body: payload ? JSON.stringify(payload) : undefined
  });

  try {
    // już ma Premium?
    const ex = await rest(`premium_workdocs?select=premium_until&user_id=eq.${user.id}`, 'GET');
    const prem = ex.ok ? (await ex.json())[0] : null;
    // aktywne Premium z zapasem > 7 dni: nie pozwalamy płacić drugi raz przez pomyłkę (odnowienie można zrobić na tydzień przed końcem)
    if (prem && prem.premium_until && new Date(prem.premium_until).getTime() - Date.now() > 7 * 24 * 3600 * 1000) return send(res, 200, { already: true, until: prem.premium_until });

    const amount = Number(env.PREMIUM_PRICE_GR) || 1000;
    const sessionId = 'wd_' + crypto.randomUUID();
    const ins = await rest('payments_workdocs', 'POST', { session_id: sessionId, user_id: user.id, email: user.email, amount, currency: 'PLN', status: 'pending' }, { prefer: 'return=minimal' });
    if (!ins.ok) return send(res, 502, { error: 'Nie udało się zapisać zamówienia.' });

    const base = env.P24_SANDBOX === '1' ? 'https://sandbox.przelewy24.pl' : 'https://secure.przelewy24.pl';
    const sign = sha384(JSON.stringify({ sessionId, merchantId, amount, currency: 'PLN', crc }));
    const r = await fetch(`${base}/api/v1/transaction/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Basic ' + Buffer.from(`${posId}:${apiKey}`).toString('base64') },
      body: JSON.stringify({
        merchantId, posId, sessionId, amount, currency: 'PLN', description: 'Work Docs Premium', email: user.email,
        country: 'PL', language: 'pl', urlReturn: `${site}/?premium=return`, urlStatus: `${site}/api/p24_notify`, sign
      })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.data || !j.data.token) return send(res, 502, { error: 'Przelewy24 odrzuciło zamówienie. Spróbuj później.' });
    return send(res, 200, { url: `${base}/trnRequest/${j.data.token}` });
  } catch {
    return send(res, 502, { error: 'Nie udało się połączyć z Przelewy24.' });
  }
};
