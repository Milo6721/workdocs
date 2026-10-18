// Work Docs — potwierdzenie płatności od Przelewy24 (webhook, Vercel Serverless Function).
// Przelewy24 woła ten adres po zapłacie (urlStatus). Weryfikujemy podpis, potwierdzamy transakcję
// u Przelewy24 i zapisujemy Premium w bazie (tabela premium_workdocs) — to jedyne miejsce, które to robi.
// Zmienne środowiskowe: jak w p24_create.js.

const crypto = require('crypto');

const sha384 = s => crypto.createHash('sha384').update(s).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

module.exports = async function handler(req, res) {
  const done = (status, text) => { res.statusCode = status; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end(text); };
  if (req.method !== 'POST') return done(405, 'method');

  const env = process.env;
  const sbUrl = (env.SUPABASE_URL_WORKDOCS || '').replace(/\/+$/, '');
  const sbKey = env.SUPABASE_SERVICE_ROLE_KEY_WORKDOCS;
  const merchantId = Number(env.P24_MERCHANT_ID), posId = Number(env.P24_POS_ID || env.P24_MERCHANT_ID);
  const crc = env.P24_CRC, apiKey = env.P24_API_KEY;
  if (!sbUrl || !sbKey || !merchantId || !crc || !apiKey) return done(501, 'not configured');

  let n = req.body;
  if (typeof n === 'string') { try { n = JSON.parse(n); } catch { n = null; } }
  if (!n || typeof n.sessionId !== 'string' || !n.orderId || !n.sign) return done(400, 'bad request');

  // 1) podpis powiadomienia
  const expect = sha384(JSON.stringify({
    merchantId: n.merchantId, posId: n.posId, sessionId: n.sessionId, amount: n.amount, originAmount: n.originAmount,
    currency: n.currency, orderId: n.orderId, methodId: n.methodId, statement: n.statement, crc
  }));
  if (!safeEq(expect, n.sign)) return done(400, 'bad sign');
  if (Number(n.merchantId) !== merchantId) return done(400, 'bad merchant');

  const rest = (path, method, payload, extra) => fetch(`${sbUrl}/rest/v1/${path}`, {
    method,
    headers: { 'content-type': 'application/json', apikey: sbKey, authorization: `Bearer ${sbKey}`, ...(extra || {}) },
    body: payload ? JSON.stringify(payload) : undefined
  });

  try {
    // 2) zamówienie musi istnieć i kwota się zgadzać
    const q = await rest(`payments_workdocs?select=*&session_id=eq.${encodeURIComponent(n.sessionId)}`, 'GET');
    const rows = q.ok ? await q.json() : [];
    const pay = rows[0];
    if (!pay) return done(404, 'unknown order');
    if (Number(n.amount) !== Number(pay.amount) || n.currency !== pay.currency) return done(400, 'amount mismatch');
    if (pay.status === 'paid') return done(200, 'OK'); // powtórne powiadomienie

    // 3) potwierdzenie transakcji u Przelewy24
    const base = env.P24_SANDBOX === '1' ? 'https://sandbox.przelewy24.pl' : 'https://secure.przelewy24.pl';
    const sign = sha384(JSON.stringify({ sessionId: n.sessionId, orderId: n.orderId, amount: n.amount, currency: n.currency, crc }));
    const v = await fetch(`${base}/api/v1/transaction/verify`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: 'Basic ' + Buffer.from(`${posId}:${apiKey}`).toString('base64') },
      body: JSON.stringify({ merchantId, posId, sessionId: n.sessionId, amount: n.amount, currency: n.currency, orderId: n.orderId, sign })
    });
    const vj = await v.json().catch(() => ({}));
    if (!v.ok || !vj.data || vj.data.status !== 'success') {
      await rest(`payments_workdocs?session_id=eq.${encodeURIComponent(n.sessionId)}`, 'PATCH', { status: 'failed' });
      return done(400, 'not verified');
    }

    // 4) zapis: płatność + Premium dla konta
    await rest(`payments_workdocs?session_id=eq.${encodeURIComponent(n.sessionId)}`, 'PATCH', { status: 'paid', p24_order_id: Number(n.orderId), paid_at: new Date().toISOString() });
    // Premium na 30 dni; jeśli jeszcze trwa poprzednie, nowe 30 dni dolicza się na jego koniec
    let from = Date.now();
    try {
      const ex = await rest(`premium_workdocs?select=premium_until&user_id=eq.${pay.user_id}`, 'GET');
      const prev = ex.ok ? (await ex.json())[0] : null;
      if (prev && prev.premium_until && new Date(prev.premium_until).getTime() > from) from = new Date(prev.premium_until).getTime();
    } catch { /* liczymy od teraz */ }
    const until = new Date(from + 30 * 24 * 3600 * 1000).toISOString();
    const up = await rest('premium_workdocs?on_conflict=user_id', 'POST', { user_id: pay.user_id, plan: 'premium', premium_until: until, last_order_id: String(n.orderId) }, { prefer: 'resolution=merge-duplicates,return=minimal' });
    if (!up.ok) return done(500, 'db error'); // Przelewy24 ponowi powiadomienie
    return done(200, 'OK');
  } catch {
    return done(500, 'error');
  }
};
