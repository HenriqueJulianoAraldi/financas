# Finanças

Controle pessoal de gastos e investimentos. Página estática (HTML + CSS + JavaScript,
sem build) que guarda os dados no Supabase — abre no celular e no computador com os
mesmos lançamentos.

- Lançamentos de despesas e receitas, com filtros e busca
- Cartão de crédito com parcelamento automático e agrupamento por fatura
- Orçamento mensal por categoria, com alerta ao se aproximar do teto
- Carteira de investimentos por ativo: preço médio, posição, resultado e alocação
- Metas de economia com aporte mensal sugerido
- Lançamentos fixos gerados em um clique
- Importação de extrato em CSV
- Backup em JSON

## Como colocar no ar

### 1. Criar o projeto no Supabase

1. Crie um projeto grátis em [supabase.com/dashboard](https://supabase.com/dashboard).
2. Abra **SQL Editor**, cole todo o conteúdo de [`supabase/schema.sql`](supabase/schema.sql)
   e execute. Isso cria as tabelas, os índices e as políticas de segurança.
3. Copie os dois valores — eles ficam em telas diferentes:
   - **Project URL**: na tela **Project Overview** (a home do projeto). Use só a raiz,
     `https://SEU-REF.supabase.co` — sem `/rest/v1/` no final, que o `supabase-js`
     monta esse caminho sozinho.
   - **Chave pública**: em **Settings → API Keys**. Nos projetos novos ela se chama
     **publishable key** (`sb_publishable_...`); nos antigos, *anon public*. O
     `supabase-js` aceita as duas no mesmo lugar.
4. Cole as duas em [`assets/js/config.js`](assets/js/config.js).

> A chave pública é pública por design e pode ficar num repositório aberto: quem protege
> os dados é a Row Level Security criada pelo `schema.sql`, que só deixa cada usuário
> enxergar as próprias linhas. **Nunca** coloque aqui a `service_role` / `secret key`.

### 2. Ajustar a autenticação

Em **Authentication → Providers → Email**, para uso pessoal o mais prático é
**desligar "Confirm email"**: assim você cria a conta com e-mail e senha e entra na
hora, sem depender de e-mail (o serviço de e-mail gratuito do Supabase tem limite de
poucas mensagens por hora).

Em **Authentication → URL Configuration**, deixe na allowlist apenas:

```
https://SEU-USUARIO.github.io/SEU-REPO/
http://localhost:8000
```

### 3. Publicar no GitHub Pages

```bash
git init
git add .
git commit -m "Finanças: primeira versão"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/SEU-REPO.git
git push -u origin main
```

No GitHub: **Settings → Pages → Source: Deploy from a branch → main / (root)**.
Em um ou dois minutos a página fica em `https://SEU-USUARIO.github.io/SEU-REPO/`.

O arquivo `.nojekyll` está no repositório para o Pages não ignorar nada.

### Rodar localmente

```bash
python -m http.server 8000
```

E abrir `http://localhost:8000`. Não existe passo de build: editou o arquivo,
recarregou a página.

## Como está organizado

```
index.html                  casca da página (login + shell do app)
assets/css/styles.css       tema escuro: roxo, amarelo queimado e pretos
assets/js/config.js         URL e chave do Supabase
assets/js/supabase.js       cliente e autenticação
assets/js/store.js          camada de dados — todo CRUD passa por aqui
assets/js/selectors.js      contas derivadas (competência, orçamento, posição)
assets/js/format.js         BRL, datas e parsing de números em pt-BR
assets/js/csv.js            leitura de extrato CSV
assets/js/charts.js         gráficos em canvas
assets/js/dom.js            helpers de DOM, modal e toast
assets/js/router.js         navegação por hash
assets/js/app.js            boot da aplicação
assets/js/views/            uma tela por arquivo
supabase/schema.sql         tabelas, índices e RLS
```

Nenhuma view fala com o Supabase direto: tudo passa por `store.js`. Para trocar o
backend um dia, é o único arquivo que muda.

## Detalhes que valem saber

**Competência.** Cada lançamento tem uma data (quando aconteceu) e uma competência (em
que mês ele pesa no orçamento). Para conta corrente e dinheiro são o mesmo mês. Para
cartão de crédito, uma compra feita depois do dia de fechamento cai na fatura do mês
seguinte — por isso vale cadastrar o dia de fechamento do cartão em **Ajustes**.

**Parcelas.** Ao lançar uma compra no cartão com N parcelas, são criados N lançamentos
com a mesma data de compra e competências consecutivas. Excluir uma parcela exclui a
compra inteira.

**Preços dos investimentos.** São atualizados à mão, em **Investimentos → Atualizar
preços**. Cotação automática ficou de fora porque as APIs gratuitas confiáveis exigem
uma chave, e chave em site estático é chave exposta. Se um dia quiser, dá para colocar
uma Edge Function no Supabase guardando a chave do lado do servidor.

**Patrimônio.** Cada vez que você atualiza os preços, o total do mês é gravado em
`portfolio_snapshots` — é isso que desenha o gráfico de evolução.

**Projeto pausado.** No plano gratuito, o Supabase pausa projetos após cerca de uma
semana sem acesso. Se a página reclamar de conexão depois de um tempo sumido, basta
reativar no painel.

## Atalhos

- `J` / `K` — mês anterior / próximo mês
