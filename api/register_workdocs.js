// Work Docs — rejestracja kont z potwierdzeniem e-maila, które samo się wyłącza, gdy poczta nie daje rady
// (Vercel Serverless Function).
//
// Jak działa:
//  1) action "register" (domyślnie): tworzymy konto po stronie serwera i próbujemy wysłać e-mail z linkiem.
//     - wysłano       -> { ok:true, confirmed:false }  (użytkownik klika link, potem się loguje)
//     - NIE wysłano   -> konto jest od razu potwierdzone na stałe -> { ok:true, confirmed:true }
//       (limit maili w Supabase, awaria poczty, zbyt duży ruch — nikt nie zostaje „w kolejce”)
//  2) action "resend": ponowne wysłanie linku (wymaga e-maila i hasła). Gdy wysłanie się nie uda,
//     konto jest potwierdzane na stałe i nigdy więcej nie trzeba go potwierdzać.
//
// Zmienne środowiskowe (Vercel → Settings → Environment Variables):
//   SUPABASE_URL_WORKDOCS               (wymagane) np. https://abcdxyz.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY_WORKDOCS  (wymagane) klucz „service_role" — TAJNY, tylko tu
//   SUPABASE_ANON_KEY_WORKDOCS          (opcjonalne) klucz publiczny; bez niego używamy service_role
//   SIGNUP_CODE_WORKDOCS                (opcjonalne) jeśli ustawisz, rejestracja wymaga tego kodu
//   SITE_URL_WORKDOCS                   (opcjonalne) np. https://www.workdocs.online — dokąd prowadzi link z e-maila
// W Supabase: Authentication → Sign In / Providers → Email → włącz „Confirm email”.

const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > 10;
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
  const anon = process.env.SUPABASE_ANON_KEY_WORKDOCS || key;
  const site = (process.env.SITE_URL_WORKDOCS || '').replace(/\/+$/, '');

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'x').split(',')[0].trim();
  if (limited(ip)) return send(res, 429, { error: 'Za dużo prób — odczekaj kilka minut.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || typeof body.email !== 'string' || typeof body.password !== 'string') return send(res, 400, { error: 'Nieprawidłowe dane.' });

  const email = body.email.trim().toLowerCase();
  const password = body.password;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) return send(res, 400, { error: 'Podaj poprawny adres e-mail.' });
  if (password.length < 6 || password.length > 72) return send(res, 400, { error: 'Hasło musi mieć od 6 do 72 znaków.' });

  const admin = (path, method, payload) => fetch(`${url}/auth/v1/${path}`, {
    method,
    headers: { 'content-type': 'application/json', apikey: key, authorization: `Bearer ${key}` },
    body: payload ? JSON.stringify(payload) : undefined
  });
  // Próba wysłania e-maila z linkiem (zwraca true tylko, gdy Supabase potwierdzi wysłanie)
  const sendMail = async () => {
    try {
      const r = await fetch(`${url}/auth/v1/resend`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: anon, authorization: `Bearer ${anon}` },
        body: JSON.stringify({ type: 'signup', email, ...(site ? { options: { emailRedirectTo: site } } : {}) })
      });
      return r.ok;
    } catch { return false; }
  };
  const confirmForever = async id => {
    try { return (await admin(`admin/users/${id}`, 'PUT', { email_confirm: true })).ok; } catch { return false; }
  };

  try {
    if (body.action === 'resend') {
      // tożsamość: poprawne hasło musi dawać błąd „niepotwierdzony”, a nie „błędne dane”
      const t = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: { 'content-type': 'application/json', apikey: anon }, body: JSON.stringify({ email, password })
      });
      if (t.ok) return send(res, 200, { ok: true, confirmed: true });
      let tj = {};
      try { tj = await t.json(); } catch { /* ignore */ }
      const tm = String(tj.error_code || tj.msg || tj.message || tj.error_description || '');
      if (!/not.?confirmed/i.test(tm)) return send(res, 401, { error: 'Nieprawidłowy e-mail lub hasło.' });
      if (await sendMail()) return send(res, 200, { ok: true, confirmed: false, resent: true });
      // poczta nie działa -> potwierdzamy na stałe
      const g = await admin('admin/generate_link', 'POST', { type: 'magiclink', email });
      let gj = {};
      try { gj = await g.json(); } catch { /* ignore */ }
      const id = gj.id || (gj.user && gj.user.id);
      if (id && await confirmForever(id)) return send(res, 200, { ok: true, confirmed: true, auto: true });
      return send(res, 502, { error: 'Nie udało się potwierdzić konta. Spróbuj za chwilę.' });
    }

    const need = process.env.SIGNUP_CODE_WORKDOCS;
    if (need && body.code !== need) return send(res, 403, { error: 'Podaj poprawny kod rejestracji.', needCode: true });

    const r = await admin('admin/users', 'POST', { email, password, email_confirm: false, user_metadata: { app: 'workdocs' } });
    if (!r.ok) {
      let j = {};
      try { j = await r.json(); } catch { /* ignore */ }
      const msg = String(j.msg || j.message || j.error_description || j.error || '');
      if (r.status === 422 || /already|exists|registered/i.test(msg)) {
        return send(res, 409, { error: 'Konto z tym e-mailem już istnieje (konta są wspólne w całym Supabase) — zaloguj się.' });
      }
      if (/password/i.test(msg)) return send(res, 400, { error: 'Hasło jest zbyt słabe lub niepoprawne.' });
      return send(res, 502, { error: 'Nie udało się utworzyć konta.' });
    }
    const u = await r.json().catch(() => ({}));
    if (await sendMail()) return send(res, 200, { ok: true, confirmed: false });
    // poczta niedostępna (limit, awaria) — konto potwierdzamy na stałe i nic więcej nie trzeba robić
    if (u.id && await confirmForever(u.id)) return send(res, 200, { ok: true, confirmed: true, auto: true });
    return send(res, 502, { error: 'Konto utworzono, ale nie udało się go potwierdzić. Spróbuj się zalogować.' });
  } catch {
    return send(res, 502, { error: 'Nie udało się połączyć z serwerem kont.' });
  }
};
