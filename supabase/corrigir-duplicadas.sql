-- =====================================================================
-- Correção pontual: categorias e contas duplicadas
--
-- Causa: uma consulta feita antes do token de acesso ser aplicado volta
-- vazia com status 200 (a RLS filtra tudo), e o app concluía que era uma
-- conta nova, criando as categorias iniciais uma segunda vez.
--
-- Este script mantém a linha mais antiga de cada nome, repontta o que
-- apontava para as duplicadas e cria a trava que impede a repetição.
-- Rode uma vez no SQL Editor. Rodar de novo não faz mal.
-- =====================================================================

-- --- 1. Antes: ver o que está duplicado ------------------------------
select 'categorias' as tabela, kind as tipo, name as nome, count(*) as vezes
  from public.categories
 group by user_id, kind, lower(name), name, kind
having count(*) > 1
union all
select 'contas', type, name, count(*)
  from public.accounts
 group by user_id, type, lower(name), name, type
having count(*) > 1;

-- --- 2. Categorias: repontar antes de apagar --------------------------
with ranked as (
  select id,
         first_value(id) over (
           partition by user_id, lower(name), kind
           order by created_at, id
         ) as keep_id
    from public.categories
)
update public.transactions t
   set category_id = r.keep_id
  from ranked r
 where t.category_id = r.id
   and r.id <> r.keep_id;

with ranked as (
  select id,
         first_value(id) over (
           partition by user_id, lower(name), kind
           order by created_at, id
         ) as keep_id
    from public.categories
)
update public.recurring_rules rr
   set category_id = r.keep_id
  from ranked r
 where rr.category_id = r.id
   and r.id <> r.keep_id;

with ranked as (
  select id,
         first_value(id) over (
           partition by user_id, lower(name), kind
           order by created_at, id
         ) as keep_id
    from public.categories
)
delete from public.categories c
 using ranked r
 where c.id = r.id
   and r.id <> r.keep_id;

-- --- 3. Contas: mesmo tratamento --------------------------------------
with ranked as (
  select id,
         first_value(id) over (
           partition by user_id, lower(name)
           order by created_at, id
         ) as keep_id
    from public.accounts
)
update public.transactions t
   set account_id = r.keep_id
  from ranked r
 where t.account_id = r.id
   and r.id <> r.keep_id;

with ranked as (
  select id,
         first_value(id) over (
           partition by user_id, lower(name)
           order by created_at, id
         ) as keep_id
    from public.accounts
)
update public.recurring_rules rr
   set account_id = r.keep_id
  from ranked r
 where rr.account_id = r.id
   and r.id <> r.keep_id;

with ranked as (
  select id,
         first_value(id) over (
           partition by user_id, lower(name)
           order by created_at, id
         ) as keep_id
    from public.accounts
)
delete from public.accounts a
 using ranked r
 where a.id = r.id
   and r.id <> r.keep_id;

-- --- 4. Trava definitiva ----------------------------------------------
create unique index if not exists categories_user_name_kind_uniq
  on public.categories (user_id, lower(name), kind);

create unique index if not exists accounts_user_name_uniq
  on public.accounts (user_id, lower(name));

-- --- 5. Depois: conferir que não sobrou nada --------------------------
select kind as tipo, name as nome, count(*) as vezes
  from public.categories
 group by user_id, kind, lower(name), name
having count(*) > 1;
