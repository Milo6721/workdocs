# Work Docs — konfiguracja chmury (Supabase)

Konta, zapis tablic, udostępnianie i praca na żywo. Wszystkie obiekty w bazie mają sufiks `_workdocs`.

## 1. Baza danych (raz)
1. Supabase → **SQL Editor** → **New query**.
2. Wklej całą zawartość pliku `supabase_workdocs.sql` i kliknij **Run**.
   Skrypt można uruchomić ponownie bez szkody; nie rusza niczego bez sufiksu `_workdocs`.

## 2. Dane publiczne projektu — `config.js`
Supabase → **Project Settings → API**:
- **Project URL** → `supabaseUrl`
- klucz **anon / publishable** → `supabaseAnonKey`

Wpisz je w pliku `config.js` (są publiczne z założenia, dostęp chroni RLS).
**Nigdy** nie wpisuj tam klucza `service_role`.

## 3. Rejestracja bez potwierdzania e-maila (zmienne w Vercelu)
Vercel → projekt → **Settings → Environment Variables**:

| Nazwa | Wartość |
|---|---|
| `SUPABASE_URL_WORKDOCS` | ten sam Project URL |
| `SUPABASE_SERVICE_ROLE_KEY_WORKDOCS` | klucz **service_role** z Supabase (TAJNY, tylko tu) |
| `SIGNUP_CODE_WORKDOCS` | (opcjonalnie) kod, który trzeba podać przy rejestracji |

Potem **Redeploy**. Dzięki temu konta powstają od razu aktywne, a ustawienie „Confirm email”
w Supabase (wspólne dla wszystkich Twoich projektów) zostaje nietknięte.

## 4. Wdrożenie
Wdróż cały folder (razem z `api/`, `config.js`, `vercel.json`). Zmienne środowiskowe z AI
(`ANTHROPIC_API_KEY`, `ACCESS_CODE`) zostają bez zmian.

## Jak to działa
- Logowanie: e-mail + hasło. Konta są wspólne w całym projekcie Supabase.
- Tablica w chmurze zapisuje tylko zmienione elementy (kilkaset ms po zmianie).
- Udostępnianie po e-mailu: osoba widzi tablicę po zalogowaniu na ten e-mail
  (także jeśli założy konto dopiero później). Uprawnienia: edycja albo tylko podgląd.
- Na żywo: zmiany, kursory i lista osób online. Kanały są prywatne (RLS na `realtime.messages`).
