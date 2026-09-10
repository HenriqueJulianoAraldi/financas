-- =====================================================================
-- Adiciona o tipo de investimento "saldo" (cofrinho, CDB, poupança,
-- Tesouro Selic): sem quantidade e sem cotação, só o saldo informado.
--
-- Rode uma vez no SQL Editor. Rodar de novo não faz mal.
-- Os ativos que já existem continuam como estão ('quota').
-- =====================================================================

alter table public.assets
  add column if not exists pricing_mode text not null default 'quota';

alter table public.assets
  add column if not exists balance numeric(18, 2) not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'assets_pricing_mode_check'
  ) then
    alter table public.assets
      add constraint assets_pricing_mode_check
      check (pricing_mode in ('quota', 'balance'));
  end if;
end $$;

-- Confere o resultado
select column_name, data_type, column_default
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'assets'
   and column_name in ('pricing_mode', 'balance');
