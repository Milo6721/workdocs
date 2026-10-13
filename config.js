// Work Docs — konfiguracja chmury (Supabase).
// Te dwie wartości są PUBLICZNE z założenia (dostęp chroni RLS w bazie), więc można je trzymać w tym pliku.
// Znajdziesz je w Supabase → Project Settings → API:
//   Project URL        → supabaseUrl
//   anon / publishable → supabaseAnonKey
// NIGDY nie wpisuj tu klucza "service_role" — ten należy wyłącznie do zmiennych środowiskowych Vercela.
window.WORKDOCS_CONFIG = {
  supabaseUrl: 'https://ibafumzehizoamwiixlc.supabase.co',
  supabaseAnonKey: 'sb_publishable_1pJjII-6FCQGkIbqcKuTiQ_QPtZw8bv'
};
