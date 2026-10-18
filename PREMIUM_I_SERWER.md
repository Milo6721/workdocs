# Premium, płatność 10 zł (Przelewy24), potwierdzanie e-maila i serwer

Wszystko jest już w kodzie. Poniżej tylko to, co musisz zrobić Ty (klucze i kilka kliknięć).

## Co działa
- **Biblioteka matematyczna** (Σ) to funkcja Premium. Bez Premium widać kłódki na wszystkich kartach i okno „Zdobądź Premium — 10 zł”.
- Klik „Zdobądź Premium” → (jeśli niezalogowany: logowanie) → strona płatności Przelewy24 → po zapłacie Przelewy24 woła `api/p24_notify.js`, który sprawdza podpis, potwierdza płatność i zapisuje Premium w bazie (tabela `premium_workdocs`, kto zapłacił: `payments_workdocs`). Po powrocie na stronę Premium włącza się samo.
- **Premium jest miesięczne:** jedna płatność = 30 dni (kolumna `premium_until`). Kolejna płatność przedłuża o następne 30 dni, doliczone na koniec obecnego okresu. Odnowienie jest możliwe na tydzień przed końcem. Przelew nie odnawia się sam, więc użytkownik płaci ręcznie co miesiąc. Wiersz bez daty `premium_until` (np. dodany ręcznie) oznacza Premium bez końca.
- **Potwierdzanie e-maila:** po rejestracji wysyłamy link. Jeśli poczta nie działa (limit, awaria, duży ruch), konto jest **od razu potwierdzone na stałe** i nie trzeba już nic robić.

## Krok 1 — baza (Supabase → SQL Editor)
Uruchom cały plik `supabase_workdocs.sql` (jest bezpieczny do powtórzenia). Dodaje tabele `premium_workdocs` i `payments_workdocs`. Zapisuje do nich tylko serwer, aplikacja może odczytać wyłącznie własny wiersz.

## Krok 2 — zmienne w Vercelu (Settings → Environment Variables), potem Redeploy
Już masz: `ANTHROPIC_API_KEY`, `ACCESS_CODE`, `SUPABASE_URL_WORKDOCS`, `SUPABASE_SERVICE_ROLE_KEY_WORKDOCS`, `SIGNUP_CODE_WORKDOCS`.

Dodaj (jako Secret):

| Nazwa | Wartość |
|---|---|
| `SITE_URL_WORKDOCS` | `https://www.workdocs.online` (adres Twojej strony, bez `/` na końcu) |
| `P24_MERCHANT_ID` | numer sprzedawcy z Przelewy24 |
| `P24_POS_ID` | numer punktu płatności (zwykle taki sam) |
| `P24_CRC` | klucz CRC |
| `P24_API_KEY` | klucz do API REST („klucz do raportów”) |
| `P24_SANDBOX` | `1` na czas testów; po testach **usuń** tę zmienną |
| `PREMIUM_PRICE_GR` | (opcjonalnie) cena w groszach, domyślnie `1000` = 10 zł |

## Krok 3 — Supabase: potwierdzanie e-maila
Authentication → Sign In / Providers → Email → włącz **Confirm email**. W Authentication → URL Configuration ustaw **Site URL** na adres strony (to tam prowadzi link z e-maila).
Domyślna poczta Supabase ma niski limit wiadomości na godzinę. To właśnie wtedy działa Twoje zabezpieczenie: konto zostaje potwierdzone automatycznie. Chcesz więcej maili? W Authentication → SMTP Settings możesz podłączyć własną skrzynkę (np. Resend, Brevo).

## Krok 4 — test płatności
1. Z `P24_SANDBOX=1` załóż konto w aplikacji, kliknij Σ → „Zdobądź Premium”.
2. Zapłać testowo w sandboxie Przelewy24 (dane testowe są w panelu sandboxa).
3. Po powrocie powinno pokazać „Premium aktywne”, a w Supabase pojawi się wiersz w `premium_workdocs` i `payments_workdocs` (status `paid`).
4. Przełączenie na prawdziwe płatności: usuń `P24_SANDBOX`, wpisz produkcyjne klucze, Redeploy.

Do sprawdzenia przy Przelewy24: w panelu konta włącz dostęp do API REST i skopiuj klucz. Aktualne szczegóły API (podpisy, adresy) są w ich dokumentacji. Pamiętaj o regulaminie, polityce prywatności i informacji o prawie odstąpienia (treść cyfrowa).

## Awaryjne odblokowanie dla wszystkich
W `config.js` dodaj `premiumAll: true` (np. na promocję lub testy). Usuń, gdy chcesz włączyć blokadę.

## Serwer do współpracy wielu osób
- **Teraz:** współpraca na żywo działa przez Supabase Realtime. Nic nie stawiasz. Limit to liczba jednoczesnych połączeń w Twoim planie Supabase (sprawdź w Billing).
- **Gdy będzie więcej osób:** podnieś plan Supabase (bez zmian w kodzie).
- **Własny serwer** dopiero, gdy to przestanie wystarczać: mały serwer Node.js z WebSocketami (np. Yjs) na Railway/Fly.io/VPS. Vercel nie utrzymuje stałych połączeń.

## Ważne o bezpieczeństwie
Kłódki w interfejsie same w sobie można obejść (kod strony jest publiczny). Premium jest jednak zapisane w bazie po stronie serwera. Gdy zechcesz, przeniesiemy dane biblioteki do funkcji `api/`, która oddaje je tylko kontom z Premium. Wtedy nie da się ich obejść w przeglądarce.
