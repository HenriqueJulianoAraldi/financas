// Ajustes: categorias, contas, lançamentos recorrentes e backup.

import { el, field, select, iconButton, modal, confirmDialog, toast, empty } from '../dom.js';
import * as store from '../store.js';
import { state } from '../store.js';
import {
  competenceFor, categoryName, accountName, accountTypeLabel, ACCOUNT_TYPES,
} from '../selectors.js';
import { brl, parseMoney, round2, clampDay, monthLabelLong } from '../format.js';
import { getMonth } from '../ui-state.js';

export function render() {
  return el('div', { class: 'stack' },
    categoriesCard(),
    accountsCard(),
    recurringCard(),
    backupCard()
  );
}

// --- categorias ------------------------------------------------------

function categoriesCard() {
  const expense = state.categories.filter((c) => c.kind === 'expense');
  const income = state.categories.filter((c) => c.kind === 'income');

  return el('div', { class: 'card' },
    el('div', { class: 'card-head' },
      el('h2', {}, 'Categorias'),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openCategoryForm() }, '+ Nova')
    ),
    state.categories.length
      ? el('div', {},
          el('div', { class: 'section-title' }, 'Despesas'),
          ...expense.map(categoryRow),
          el('div', { class: 'section-title' }, 'Receitas'),
          ...income.map(categoryRow)
        )
      : empty('Nenhuma categoria cadastrada.')
  );
}

function categoryRow(category) {
  return el('div', { class: 'rank-head', style: { padding: '.45rem 0' } },
    el('span', { class: 'dot', style: { background: category.color } }),
    el('span', { class: 'rank-name' },
      category.name,
      category.archived ? el('span', { class: 'chip', style: { marginLeft: '.4rem' } }, 'arquivada') : null
    ),
    el('span', { class: 'rank-value num muted' },
      category.monthly_budget ? `teto ${brl(category.monthly_budget)}` : ''),
    iconButton('✎', 'Editar categoria', () => openCategoryForm(category)),
    iconButton('🗑', 'Excluir categoria', () => removeRow('categories', category,
      `Excluir "${category.name}"? Os lançamentos existentes ficam sem categoria.`), 'danger')
  );
}

function openCategoryForm(existing = null) {
  const editing = Boolean(existing);
  modal({
    title: editing ? `Editar ${existing.name}` : 'Nova categoria',
    render: () => el('div', { class: 'form-grid' },
      field('Nome', el('input', {
        type: 'text', name: 'name', required: true, maxlength: '40', value: existing?.name ?? '',
      })),
      field('Tipo', select(
        [{ value: 'expense', label: 'Despesa' }, { value: 'income', label: 'Receita' }],
        { name: 'kind', value: existing?.kind ?? 'expense' }
      )),
      field('Cor', el('input', { type: 'color', name: 'color', value: existing?.color ?? '#8b5cf6' })),
      field('Teto mensal', el('input', {
        type: 'text', name: 'monthly_budget', inputmode: 'decimal', placeholder: 'sem teto',
        value: existing?.monthly_budget ? brl(existing.monthly_budget).replace('R$', '').trim() : '',
      })),
      editing ? field('Arquivada', el('input', {
        type: 'checkbox', name: 'archived', checked: existing.archived,
      }), 'Some dos formulários, mantém o histórico.') : null
    ),
    onSubmit: async (data) => {
      const raw = data.get('monthly_budget').trim();
      const budget = raw ? parseMoney(raw) : null;
      if (raw && (!Number.isFinite(budget) || budget < 0)) throw new Error('Teto inválido.');

      const row = {
        name: data.get('name').trim(),
        kind: data.get('kind'),
        color: data.get('color'),
        monthly_budget: raw ? round2(budget) : null,
      };
      if (editing) row.archived = data.get('archived') === 'on';

      if (editing) await store.update('categories', existing.id, row);
      else await store.create('categories', row);
      toast(editing ? 'Categoria atualizada.' : 'Categoria criada.', 'success');
    },
  });
}

// --- contas ----------------------------------------------------------

function accountsCard() {
  return el('div', { class: 'card' },
    el('div', { class: 'card-head' },
      el('h2', {}, 'Contas e cartões'),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openAccountForm() }, '+ Nova')
    ),
    state.accounts.length
      ? el('div', {}, ...state.accounts.map(accountRow))
      : empty('Nenhuma conta cadastrada.')
  );
}

function accountRow(account) {
  const detail = account.type === 'credit_card'
    ? [account.closing_day ? `fecha dia ${account.closing_day}` : null,
       account.due_day ? `vence dia ${account.due_day}` : null].filter(Boolean).join(' · ')
    : accountTypeLabel(account.type);

  return el('div', { class: 'rank-head', style: { padding: '.45rem 0' } },
    el('span', { class: 'rank-name' }, account.name),
    el('span', { class: 'rank-value muted small' }, detail),
    iconButton('✎', 'Editar conta', () => openAccountForm(account)),
    iconButton('🗑', 'Excluir conta', () => removeRow('accounts', account,
      `Excluir "${account.name}"? Os lançamentos existentes ficam sem conta.`), 'danger')
  );
}

function openAccountForm(existing = null) {
  const editing = Boolean(existing);
  let cardFields;

  modal({
    title: editing ? `Editar ${existing.name}` : 'Nova conta',
    render: () => {
      const closing = el('input', {
        type: 'number', name: 'closing_day', min: '1', max: '31', value: existing?.closing_day ?? '',
      });
      const due = el('input', {
        type: 'number', name: 'due_day', min: '1', max: '31', value: existing?.due_day ?? '',
      });
      cardFields = el('div', { class: 'form-grid' },
        field('Dia de fechamento', closing, 'Compra depois disso cai na fatura seguinte.'),
        field('Dia de vencimento', due)
      );
      cardFields.hidden = (existing?.type ?? 'checking') !== 'credit_card';

      return el('div', { class: 'stack' },
        el('div', { class: 'form-grid' },
          field('Nome', el('input', {
            type: 'text', name: 'name', required: true, maxlength: '40',
            value: existing?.name ?? '', placeholder: 'Nubank, Itaú, Carteira',
          })),
          field('Tipo', select(ACCOUNT_TYPES, {
            name: 'type',
            value: existing?.type ?? 'checking',
            onchange: (event) => { cardFields.hidden = event.target.value !== 'credit_card'; },
          }))
        ),
        cardFields
      );
    },
    onSubmit: async (data) => {
      const type = data.get('type');
      const row = {
        name: data.get('name').trim(),
        type,
        closing_day: type === 'credit_card' && data.get('closing_day') ? Number(data.get('closing_day')) : null,
        due_day: type === 'credit_card' && data.get('due_day') ? Number(data.get('due_day')) : null,
      };
      if (editing) await store.update('accounts', existing.id, row);
      else await store.create('accounts', row);
      toast(editing ? 'Conta atualizada.' : 'Conta criada.', 'success');
    },
  });
}

// --- recorrentes ------------------------------------------------------

function recurringCard() {
  const month = getMonth();
  const pending = pendingRecurring(month);

  return el('div', { class: 'card' },
    el('div', { class: 'card-head' },
      el('h2', {}, 'Lançamentos fixos'),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openRecurringForm() }, '+ Nova regra')
    ),
    el('p', { class: 'muted small' },
      'Contas que se repetem todo mês. Gere todas de uma vez no início do mês.'),

    state.recurring.length
      ? el('div', {}, ...state.recurring.map(recurringRow))
      : empty('Nenhuma regra cadastrada.'),

    state.recurring.length
      ? el('div', { class: 'toolbar', style: { marginTop: '1rem', marginBottom: 0 } },
          el('button', {
            class: pending.length ? 'btn btn-accent' : 'btn btn-ghost',
            disabled: !pending.length,
            onclick: () => generateRecurring(month),
          }, pending.length
            ? `Gerar ${pending.length} lançamento(s) de ${monthLabelLong(month).toLowerCase()}`
            : `Nada pendente em ${monthLabelLong(month).toLowerCase()}`)
        )
      : null
  );
}

function recurringRow(rule) {
  return el('div', { class: 'rank-head', style: { padding: '.45rem 0' } },
    el('span', { class: 'rank-name' },
      rule.description,
      el('span', { class: 'cell-sub' },
        `dia ${rule.day_of_month} · ${categoryName(rule.category_id)} · ${accountName(rule.account_id)}`)
    ),
    el('span', { class: `rank-value num ${rule.kind === 'income' ? 'pos' : ''}` }, brl(rule.amount)),
    !rule.active ? el('span', { class: 'chip' }, 'pausada') : null,
    iconButton('✎', 'Editar regra', () => openRecurringForm(rule)),
    iconButton('🗑', 'Excluir regra', () => removeRow('recurring', rule,
      `Excluir a regra "${rule.description}"? Os lançamentos já gerados permanecem.`), 'danger')
  );
}

/** Regras ativas que ainda não geraram lançamento na competência do mês. */
function pendingRecurring(month) {
  return state.recurring.filter((rule) => rule.active).map((rule) => {
    const date = clampDay(month, rule.day_of_month);
    const competence = competenceFor(date, rule.account_id);
    const exists = state.transactions.some(
      (row) => row.recurring_id === rule.id && row.competence === competence
    );
    return exists ? null : { rule, date, competence };
  }).filter(Boolean);
}

async function generateRecurring(month) {
  const pending = pendingRecurring(month);
  if (!pending.length) return;

  try {
    await store.createMany('transactions', pending.map(({ rule, date, competence }) => ({
      date,
      competence,
      description: rule.description,
      amount: rule.amount,
      kind: rule.kind,
      category_id: rule.category_id,
      account_id: rule.account_id,
      recurring_id: rule.id,
    })));
    for (const { rule, date } of pending) {
      await store.update('recurring', rule.id, { last_generated: date });
    }
    toast(`${pending.length} lançamento(s) gerado(s).`, 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

function openRecurringForm(existing = null) {
  const editing = Boolean(existing);
  if (!state.accounts.length) {
    toast('Cadastre uma conta antes.', 'error');
    return;
  }

  let categorySelect;
  const categoryOptions = (kind) => state.categories
    .filter((c) => c.kind === kind && !c.archived)
    .map((c) => ({ value: c.id, label: c.name }));

  modal({
    title: editing ? 'Editar regra' : 'Nova regra fixa',
    render: () => {
      categorySelect = select(categoryOptions(existing?.kind ?? 'expense'), {
        name: 'category_id', value: existing?.category_id ?? '', placeholder: 'Sem categoria',
      });

      return el('div', { class: 'form-grid' },
        field('Descrição', el('input', {
          type: 'text', name: 'description', required: true, maxlength: '60',
          value: existing?.description ?? '', placeholder: 'Aluguel, Netflix, Salário',
        })),
        field('Valor', el('input', {
          type: 'text', name: 'amount', required: true, inputmode: 'decimal', placeholder: '0,00',
          value: existing ? brl(existing.amount).replace('R$', '').trim() : '',
        })),
        field('Tipo', select(
          [{ value: 'expense', label: 'Despesa' }, { value: 'income', label: 'Receita' }],
          {
            name: 'kind',
            value: existing?.kind ?? 'expense',
            onchange: (event) => {
              categorySelect.replaceChildren(el('option', { value: '' }, 'Sem categoria'));
              for (const option of categoryOptions(event.target.value)) {
                categorySelect.append(el('option', { value: option.value }, option.label));
              }
            },
          }
        )),
        field('Dia do mês', el('input', {
          type: 'number', name: 'day_of_month', min: '1', max: '31', required: true,
          value: existing?.day_of_month ?? 5,
        })),
        field('Categoria', categorySelect),
        field('Conta', select(
          state.accounts.map((a) => ({ value: a.id, label: a.name })),
          { name: 'account_id', value: existing?.account_id ?? state.accounts[0].id }
        )),
        editing ? field('Ativa', el('input', {
          type: 'checkbox', name: 'active', checked: existing.active,
        })) : null
      );
    },
    onSubmit: async (data) => {
      const amount = parseMoney(data.get('amount'));
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Informe um valor maior que zero.');

      const row = {
        description: data.get('description').trim(),
        amount: round2(amount),
        kind: data.get('kind'),
        day_of_month: Number(data.get('day_of_month')),
        category_id: data.get('category_id') || null,
        account_id: data.get('account_id') || null,
      };
      if (editing) row.active = data.get('active') === 'on';

      if (editing) await store.update('recurring', existing.id, row);
      else await store.create('recurring', { ...row, active: true });
      toast(editing ? 'Regra atualizada.' : 'Regra criada.', 'success');
    },
  });
}

// --- backup ----------------------------------------------------------

function backupCard() {
  const counts = [
    ['lançamentos', state.transactions.length],
    ['categorias', state.categories.length],
    ['ativos', state.assets.length],
    ['negociações', state.trades.length],
    ['metas', state.goals.length],
  ];

  return el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('h2', {}, 'Backup')),
    el('p', { class: 'muted small' },
      'Seus dados já ficam no Supabase. O backup em JSON serve para guardar uma cópia ou migrar de projeto.'),
    el('div', { class: 'budget-foot', style: { flexWrap: 'wrap', gap: '.9rem' } },
      ...counts.map(([label, count]) => el('span', {}, `${count} ${label}`))
    ),
    el('div', { class: 'toolbar', style: { marginTop: '1rem', marginBottom: 0 } },
      el('button', { class: 'btn btn-ghost', onclick: downloadBackup }, 'Exportar JSON'),
      el('button', { class: 'btn btn-ghost', onclick: openImportBackup }, 'Importar JSON')
    )
  );
}

function downloadBackup() {
  const payload = JSON.stringify(store.exportBackup(), null, 2);
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
  const link = el('a', {
    href: url,
    download: `financas-${new Date().toISOString().slice(0, 10)}.json`,
  });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast('Backup exportado.', 'success');
}

function openImportBackup() {
  modal({
    title: 'Importar backup',
    submitLabel: 'Importar',
    render: () => el('div', { class: 'stack' },
      el('p', { class: 'muted small', style: { margin: 0 } },
        'Registros já existentes são ignorados — dá para importar o mesmo arquivo duas vezes sem duplicar.'),
      field('Arquivo JSON', el('input', { type: 'file', name: 'file', accept: '.json,application/json', required: true }))
    ),
    onSubmit: async (data) => {
      const file = data.get('file');
      if (!file || !file.size) throw new Error('Escolha um arquivo.');
      let backup;
      try {
        backup = JSON.parse(await file.text());
      } catch {
        throw new Error('Arquivo não é um JSON válido.');
      }
      const imported = await store.importBackup(backup);
      toast(imported ? `${imported} registro(s) importado(s).` : 'Nada novo para importar.', 'success');
    },
  });
}

// --- comum -----------------------------------------------------------

async function removeRow(collection, row, message) {
  const ok = await confirmDialog({ title: 'Confirmar exclusão', message });
  if (!ok) return;
  try {
    await store.remove(collection, row.id);
    toast('Excluído.');
  } catch (error) {
    toast(error.message, 'error');
  }
}
