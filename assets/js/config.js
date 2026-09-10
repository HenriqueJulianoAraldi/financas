// Preencha com os dados do seu projeto Supabase:
//   Painel → Settings → API Keys.
//
// Serve tanto a `publishable key` nova (`sb_publishable_...`) quanto a `anon`
// antiga — o supabase-js aceita as duas no mesmo lugar. As duas são públicas
// por design e podem ficar num repositório aberto: quem protege os dados é a
// Row Level Security do schema.sql, não o segredo da chave.
//
// NUNCA coloque aqui a `service_role` (ou `secret key`).

// Só a raiz do projeto, sem /rest/v1 — o supabase-js monta o caminho sozinho.
export const SUPABASE_URL = 'https://tsmmfqwrjafndkcrynvn.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_n27au1yDsARszyD_IW-FMQ_4rilc6Ou';

export const isConfigured =
  SUPABASE_URL.startsWith('http') &&
  SUPABASE_ANON_KEY.length > 20 &&
  !SUPABASE_ANON_KEY.startsWith('COLE_AQUI');
