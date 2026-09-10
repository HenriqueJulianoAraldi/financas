// Cliente Supabase e autenticação.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured } from './config.js';

export const configured = isConfigured;

export const supabase = configured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'financas.auth',
      },
    })
  : null;

/** URL desta página, usada como destino do link mágico. */
function redirectTo() {
  return window.location.origin + window.location.pathname;
}

export async function getSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session ?? null;
}

export function onAuthChange(callback) {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}

export async function signInWithPassword(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(translateAuthError(error));
}

export async function signUpWithPassword(email, password) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: redirectTo() },
  });
  if (error) throw new Error(translateAuthError(error));
  // Sem sessão na resposta = o projeto exige confirmação por e-mail.
  return { needsConfirmation: !data.session };
}

export async function signInWithMagicLink(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo() },
  });
  if (error) throw new Error(translateAuthError(error));
}

export async function signOut() {
  await supabase.auth.signOut();
}

/** Mensagens do Supabase vêm em inglês; traduz as que aparecem no dia a dia. */
function translateAuthError(error) {
  const message = error?.message || '';
  if (/Invalid login credentials/i.test(message)) return 'E-mail ou senha incorretos.';
  if (/Email not confirmed/i.test(message)) return 'Confirme o e-mail antes de entrar (veja a caixa de entrada).';
  if (/User already registered/i.test(message)) return 'Esse e-mail já tem conta. Use "Entrar".';
  if (/Password should be at least/i.test(message)) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (/rate limit|too many/i.test(message)) return 'Muitas tentativas seguidas. Espere alguns minutos.';
  if (/Failed to fetch|NetworkError/i.test(message)) return 'Sem conexão com o Supabase. Confira a URL em config.js.';
  return message || 'Não foi possível autenticar.';
}
