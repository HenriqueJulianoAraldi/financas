-- =====================================================================
-- Finanças — schema completo
-- Rode este arquivo inteiro no SQL Editor do Supabase (uma vez).
-- É idempotente: rodar de novo não apaga nada.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Categorias
-- ---------------------------------------------------------------------
create table if not exists public.categories (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name           text not null,
  kind           text not null default 'expense' check (kind in ('expense', 'income')),
  color          text not null default '#64748b',
  monthly_budget numeric(14, 2),
  archived       boolean not null default false,
  created_at     timestamptz not null default now()
);

-- Trava contra duplicata: um nome de categoria por usuário e tipo.
create unique index if not exists categories_user_name_kind_uniq
  on public.categories (user_id, lower(name), kind);

-- ---------------------------------------------------------------------
-- Contas e cartões
-- ---------------------------------------------------------------------
create table if not exists public.accounts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  type        text not null default 'checking' check (type in ('checking', 'cash', 'credit_card')),
  closing_day int check (closing_day between 1 and 31),
  due_day     int check (due_day between 1 and 31),
  archived    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Trava contra duplicata: um nome de conta por usuário.
create unique index if not exists accounts_user_name_uniq
  on public.accounts (user_id, lower(name));

-- ---------------------------------------------------------------------
-- Regras de lançamentos recorrentes
-- ---------------------------------------------------------------------
create table if not exists public.recurring_rules (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  description    text not null,
  amount         numeric(14, 2) not null check (amount >= 0),
  kind           text not null default 'expense' check (kind in ('expense', 'income')),
  category_id    uuid references public.categories(id) on delete set null,
  account_id     uuid references public.accounts(id) on delete set null,
  day_of_month   int not null default 1 check (day_of_month between 1 and 31),
  active         boolean not null default true,
  last_generated date,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Lançamentos
--   amount é sempre positivo; o sinal vem de `kind`.
--   competence = 1º dia do mês em que o lançamento pesa no orçamento
--                (para cartão, o mês da fatura).
-- ---------------------------------------------------------------------
create table if not exists public.transactions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date              date not null,
  competence        date not null,
  description       text not null,
  amount            numeric(14, 2) not null check (amount >= 0),
  kind              text not null default 'expense' check (kind in ('expense', 'income')),
  category_id       uuid references public.categories(id) on delete set null,
  account_id        uuid references public.accounts(id) on delete set null,
  notes             text,
  installment_group uuid,
  installment_no    int,
  installment_total int,
  recurring_id      uuid references public.recurring_rules(id) on delete set null,
  created_at        timestamptz not null default now()
);

create index if not exists transactions_user_date_idx
  on public.transactions (user_id, date desc);
create index if not exists transactions_user_competence_idx
  on public.transactions (user_id, competence);

-- Trava de idempotência: uma regra recorrente só gera um lançamento por competência.
create unique index if not exists transactions_recurring_competence_uniq
  on public.transactions (user_id, recurring_id, competence)
  where recurring_id is not null;

-- ---------------------------------------------------------------------
-- Metas de economia
-- ---------------------------------------------------------------------
create table if not exists public.goals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name          text not null,
  target_amount numeric(14, 2) not null check (target_amount > 0),
  target_date   date,
  color         text not null default '#0ea5e9',
  archived      boolean not null default false,
  created_at    timestamptz not null default now()
);

create table if not exists public.goal_contributions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_id    uuid not null references public.goals(id) on delete cascade,
  date       date not null,
  amount     numeric(14, 2) not null,
  note       text,
  created_at timestamptz not null default now()
);

create index if not exists goal_contributions_goal_idx
  on public.goal_contributions (user_id, goal_id, date);

-- ---------------------------------------------------------------------
-- Investimentos
--   quantidade e preço médio são derivados de asset_trades no cliente.
-- ---------------------------------------------------------------------
create table if not exists public.assets (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ticker           text not null,
  name             text,
  asset_class      text not null default 'acao'
                   check (asset_class in ('acao', 'fii', 'rf', 'tesouro', 'cripto', 'internacional', 'outro')),
  current_price    numeric(18, 6) not null default 0,
  price_updated_at timestamptz,
  target_pct       numeric(5, 2),
  archived         boolean not null default false,
  created_at       timestamptz not null default now()
);

create table if not exists public.asset_trades (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  asset_id   uuid not null references public.assets(id) on delete cascade,
  date       date not null,
  side       text not null check (side in ('buy', 'sell')),
  quantity   numeric(18, 8) not null check (quantity > 0),
  price      numeric(18, 6) not null check (price >= 0),
  fees       numeric(14, 2) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists asset_trades_asset_idx
  on public.asset_trades (user_id, asset_id, date);

create table if not exists public.portfolio_snapshots (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  month       date not null,
  total_value numeric(18, 2) not null,
  created_at  timestamptz not null default now()
);

create unique index if not exists portfolio_snapshots_month_uniq
  on public.portfolio_snapshots (user_id, month);

-- =====================================================================
-- Row Level Security — cada usuário só enxerga as próprias linhas.
-- Sem isto a chave anon publicada no GitHub exporia os dados.
-- =====================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'categories', 'accounts', 'recurring_rules', 'transactions',
    'goals', 'goal_contributions', 'assets', 'asset_trades', 'portfolio_snapshots'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t || '_owner', t
    );
  end loop;
end $$;
