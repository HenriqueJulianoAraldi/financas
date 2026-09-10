// Camada de dados. Nenhuma view fala com o Supabase direto — tudo passa por aqui.
// Estratégia: cache local pinta a tela na hora, o servidor revalida logo em seguida.
// Escrita vai sempre direto ao Supabase (sem fila offline).

import { supabase } from './supabase.js';

const TABLES = {
  categories: 'categories',
  accounts: 'accounts',
  recurring: 'recurring_rules',
  transactions: 'transactions',
  goals: 'goals',
  contributions: 'goal_contributions',
  assets: 'assets',
  trades: 'asset_trades',
  snapshots: 'portfolio_snapshots',
};

const COLLECTIONS = Object.keys(TABLES);

const SORTERS = {
  categories: (a, b) => a.name.localeCompare(b.name, 'pt-BR'),
  accounts: (a, b) => a.name.localeCompare(b.name, 'pt-BR'),
  recurring: (a, b) => a.day_of_month - b.day_of_month || a.description.localeCompare(b.description, 'pt-BR'),
  transactions: (a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at),
  goals: (a, b) => (a.target_date || '9999').localeCompare(b.target_date || '9999'),
  contributions: (a, b) => b.date.localeCompare(a.date),
  assets: (a, b) => a.ticker.localeCompare(b.ticker, 'pt-BR'),
  trades: (a, b) => b.date.localeCompare(a.date),
  snapshots: (a, b) => a.month.localeCompare(b.month),
};

export const state = {
  userId: null,
  loaded: false,
  ...Object.fromEntries(COLLECTIONS.map((key) => [key, []])),
};

const listeners = new Set();

export function onChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function emit() {
  saveCache();
  for (const callback of listeners) callback(state);
}

// --- cache -----------------------------------------------------------

function cacheKey() {
  return `financas.cache.${state.userId}`;
}

function saveCache() {
  if (!state.userId) return;
  try {
    const snapshot = Object.fromEntries(COLLECTIONS.map((key) => [key, state[key]]));
    localStorage.setItem(cacheKey(), JSON.stringify(snapshot));
  } catch {
    // Cota estourada ou modo privativo: seguir sem cache é aceitável.
  }
}

export function loadCache(userId) {
  state.userId = userId;
  try {
    const raw = localStorage.getItem(cacheKey());
    if (!raw) return false;
    const snapshot = JSON.parse(raw);
    for (const key of COLLECTIONS) {
      if (Array.isArray(snapshot[key])) state[key] = snapshot[key];
    }
    return true;
  } catch {
    return false;
  }
}

export function clearLocal() {
  if (state.userId) {
    try { localStorage.removeItem(cacheKey()); } catch { /* ignore */ }
  }
  for (const key of COLLECTIONS) state[key] = [];
  state.userId = null;
  state.loaded = false;
}

// --- carga -----------------------------------------------------------

export async function loadAll(userId) {
  state.userId = userId;
  const results = await Promise.all(
    COLLECTIONS.map((key) => supabase.from(TABLES[key]).select('*'))
  );

  results.forEach((result, index) => {
    const key = COLLECTIONS[index];
    if (result.error) throw new Error(prettyError(result.error, TABLES[key]));
    state[key] = (result.data || []).sort(SORTERS[key]);
  });

  state.loaded = true;
  emit();
}

// --- CRUD genérico ---------------------------------------------------

export async function create(key, row) {
  const { data, error } = await supabase
    .from(TABLES[key])
    .insert({ ...row, user_id: state.userId })
    .select()
    .single();
  if (error) throw new Error(prettyError(error, TABLES[key]));
  state[key] = [...state[key], data].sort(SORTERS[key]);
  emit();
  return data;
}

export async function createMany(key, rows) {
  if (!rows.length) return [];
  const { data, error } = await supabase
    .from(TABLES[key])
    .insert(rows.map((row) => ({ ...row, user_id: state.userId })))
    .select();
  if (error) throw new Error(prettyError(error, TABLES[key]));
  state[key] = [...state[key], ...data].sort(SORTERS[key]);
  emit();
  return data;
}

export async function update(key, id, patch) {
  const { data, error } = await supabase
    .from(TABLES[key])
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(prettyError(error, TABLES[key]));
  state[key] = state[key].map((row) => (row.id === id ? data : row)).sort(SORTERS[key]);
  emit();
  return data;
}

export async function remove(key, id) {
  const { error } = await supabase.from(TABLES[key]).delete().eq('id', id);
  if (error) throw new Error(prettyError(error, TABLES[key]));
  state[key] = state[key].filter((row) => row.id !== id);
  if (key === 'goals') state.contributions = state.contributions.filter((c) => c.goal_id !== id);
  if (key === 'assets') state.trades = state.trades.filter((t) => t.asset_id !== id);
  emit();
}

/** Apaga todas as parcelas de uma compra parcelada de uma vez. */
export async function removeInstallmentGroup(groupId) {
  const { error } = await supabase.from(TABLES.transactions).delete().eq('installment_group', groupId);
  if (error) throw new Error(prettyError(error, TABLES.transactions));
  state.transactions = state.transactions.filter((row) => row.installment_group !== groupId);
  emit();
}

/** Grava (ou sobrescreve) o patrimônio do mês. */
export async function upsertSnapshot(month, totalValue) {
  const { data, error } = await supabase
    .from(TABLES.snapshots)
    .upsert(
      { user_id: state.userId, month, total_value: totalValue },
      { onConflict: 'user_id,month' }
    )
    .select()
    .single();
  if (error) throw new Error(prettyError(error, TABLES.snapshots));
  state.snapshots = [...state.snapshots.filter((s) => s.month !== month), data].sort(SORTERS.snapshots);
  emit();
  return data;
}

// --- seed do primeiro acesso -----------------------------------------

const DEFAULT_CATEGORIES = [
  { name: 'Moradia', kind: 'expense', color: '#8b5cf6' },
  { name: 'Mercado', kind: 'expense', color: '#d99a2b' },
  { name: 'Transporte', kind: 'expense', color: '#a78bfa' },
  { name: 'Saúde', kind: 'expense', color: '#e8b04b' },
  { name: 'Lazer', kind: 'expense', color: '#c084fc' },
  { name: 'Educação', kind: 'expense', color: '#b8860b' },
  { name: 'Assinaturas', kind: 'expense', color: '#7c3aed' },
  { name: 'Outros', kind: 'expense', color: '#6b7280' },
  { name: 'Salário', kind: 'income', color: '#10b981' },
  { name: 'Freela', kind: 'income', color: '#34d399' },
  { name: 'Rendimentos', kind: 'income', color: '#059669' },
];

export async function ensureSeed() {
  if (state.categories.length || state.accounts.length) return false;

  // Lista vazia não prova que a conta é nova: uma consulta feita antes do token
  // de acesso ser aplicado volta [] com status 200, porque a RLS filtra tudo.
  // Confirmar que existe usuário autenticado e reconferir no servidor evita
  // semear as categorias uma segunda vez.
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth?.user) return false;

  const { count, error } = await supabase
    .from(TABLES.categories)
    .select('id', { count: 'exact', head: true });
  if (error) throw new Error(prettyError(error, TABLES.categories));
  if (count) {
    await loadAll(state.userId);
    return false;
  }

  await createMany('categories', DEFAULT_CATEGORIES);
  await createMany('accounts', [
    { name: 'Conta corrente', type: 'checking' },
    { name: 'Dinheiro', type: 'cash' },
  ]);
  return true;
}

// --- backup ----------------------------------------------------------

export function exportBackup() {
  return {
    app: 'financas',
    version: 1,
    exported_at: new Date().toISOString(),
    data: Object.fromEntries(COLLECTIONS.map((key) => [key, state[key]])),
  };
}

/**
 * Reimporta um backup. Mantém os ids originais (o backup veio da mesma conta,
 * então as chaves estrangeiras continuam válidas) e ignora linhas duplicadas.
 */
export async function importBackup(backup) {
  const data = backup?.data;
  if (!data || typeof data !== 'object') throw new Error('Arquivo de backup inválido.');

  let imported = 0;
  // Ordem importa: pais antes dos filhos, por causa das foreign keys.
  for (const key of COLLECTIONS) {
    const rows = data[key];
    if (!Array.isArray(rows) || !rows.length) continue;
    const known = new Set(state[key].map((row) => row.id));
    const incoming = rows
      .filter((row) => !known.has(row.id))
      .map((row) => ({ ...row, user_id: state.userId }));
    if (!incoming.length) continue;
    const { data: inserted, error } = await supabase
      .from(TABLES[key])
      .upsert(incoming, { onConflict: 'id' })
      .select();
    if (error) throw new Error(prettyError(error, TABLES[key]));
    state[key] = [...state[key], ...inserted].sort(SORTERS[key]);
    imported += inserted.length;
  }
  emit();
  return imported;
}

// --- erros -----------------------------------------------------------

function prettyError(error, table) {
  const message = error?.message || '';
  if (error?.code === '42P01') {
    return `A tabela "${table}" não existe. Rode o supabase/schema.sql no SQL Editor.`;
  }
  if (error?.code === '42501' || /row-level security/i.test(message)) {
    return `Sem permissão em "${table}". Confira se as policies do schema.sql foram criadas.`;
  }
  if (error?.code === '23505') {
    return 'Esse registro já existe.';
  }
  if (error?.code === '23503') {
    return 'Existe outro registro apontando para este. Remova-o antes.';
  }
  if (/Failed to fetch|NetworkError/i.test(message)) {
    return 'Sem conexão com o Supabase. O projeto pode estar pausado por inatividade.';
  }
  return message || 'Erro inesperado ao falar com o banco.';
}
