// Work Docs — rejestracja kont BEZ potwierdzania e-maila (Vercel Serverless Function).
//
// Dlaczego osobny endpoint: ustawienie „Confirm email" w Supabase jest globalne dla całego projektu
// (dotyczy też Twoich innych aplikacji w tym samym Supabase). Tutaj konto tworzymy po stronie serwera
// z flagą email_confirm=true, więc nic globalnie nie zmieniamy.
//
// Zmienne środowiskowe (Vercel → Settings → Environment Variables):
//   SUPABASE_URL_WORKDOCS               (wymagane) np. https://abcdxyz.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY_WORKDOCS  (wymagane) klucz „service_role" — TAJNY, tylko tu
//   SIGNUP_CODE_WORKDOCS                (opcjonalne) jeśli ustawisz, rejestracja wymaga tego kodu

const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > 8;
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Metoda niedozwolona' });

  const url = (process.env.SUPABASE_URL_WORKDOCS || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY_WORKDOCS;
  if (!url || !key) return send(res, 501, { error: 'fallback' });

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'x').split(',')[0].trim();
  if (limited(ip)) return send(res, 429, { error: 'Za dużo prób rejestracji — odczekaj kilka minut.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || typeof body.email !== 'string' || typeof body.password !== 'string') return send(res, 400, { error: 'Nieprawidłowe dane.' });

  const email = body.email.trim().toLowerCase();
  const password = body.password;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) return send(res, 400, { error: 'Podaj poprawny adres e-mail.' });
  if (password.length < 6 || password.length > 72) return send(res, 400, { error: 'Hasło musi mieć od 6 do 72 znaków.' });

  const need = process.env.SIGNUP_CODE_WORKDOCS;
  if (need && body.code !== need) return send(res, 403, { error: 'Podaj poprawny kod rejestracji.', needCode: true });

  try {
    const r = await fetch(`${url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: key, authorization: `Bearer ${key}` },
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { app: 'workdocs' } })
    });
    if (r.ok) return send(res, 200, { ok: true });
    let j = {};
    try { j = await r.json(); } catch { /* ignore */ }
    const msg = String(j.msg || j.message || j.error_description || j.error || '');
    if (r.status === 422 || /already|exists|registered/i.test(msg)) {
      return send(res, 409, { error: 'Konto z tym e-mailem już istnieje (konta są wspólne w całym Supabase) — zaloguj się.' });
    }
    if (/password/i.test(msg)) return send(res, 400, { error: 'Hasło jest zbyt słabe lub niepoprawne.' });
    return send(res, 502, { error: 'Nie udało się utworzyć konta.' });
  } catch {
    return send(res, 502, { error: 'Nie udało się połączyć z serwerem kont.' });
  }
};
