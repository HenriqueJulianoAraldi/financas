// Orçamento: teto mensal por categoria e quanto já foi consumido.

import { el, field, modal, toast, empty, iconButton } from '../dom.js';
import * as store from '../store.js';
import { state } from '../store.js';
import { budgetUsage } from '../selectors.js';
import { brl, pct, parseMoney, round2 } from '../format.js';
import { getMonth } from '../ui-state.js';

export function render() {
  const usage = budgetUsage(getMonth());
  const available = round2(usage.totalBudget - usage.totalSpent);
  const ratio = usage.totalBudget > 0 ? usage.totalSpent / usage.totalBudget : 0;

  return el('div', { class: 'stack' },
    el('div', { class: 'grid grid-stats' },
      statCard('Orçado', brl(usage.totalBudget)),
      statCard('Gasto', brl(usage.totalSpent), 'expense'),
      statCard(available < 0 ? 'Estourado em' : 'Disponível', brl(Math.abs(available)),
        available < 0 ? 'danger' : 'income',
        usage.totalBudget > 0 ? `${pct(ratio * 100, 0)} do orçamento` : 'Defina tetos abaixo')
    ),

    el('div', { class: 'card' },
      el('div', { class: 'card-head' },
        el('h2', {}, 'Tetos por categoria'),
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openBudgetEditor() }, 'Definir tetos')
      ),
      usage.rows.length
        ? el('div', {}, ...usage.rows.map(budgetRow))
        : empty('Nenhuma categoria com teto definido.',
            el('button', { class: 'btn btn-primary', onclick: () => openBudgetEditor() }, 'Definir tetos'))
    ),

    usage.untracked.length
      ? el('div', { class: 'card' },
          el('div', { class: 'card-head' }, el('h2', {}, 'Gastos fora do orçamento')),
          el('p', { class: 'muted small' }, 'Categorias sem teto que tiveram gasto neste mês.'),
          el('div', {}, ...usage.untracked.map(untrackedRow))
        )
      : null
  );
}

function statCard(label, value, tone, foot) {
  return el('div', { class: 'stat', dataset: tone ? { tone } : {} },
    el('div', { class: 'stat-label' }, label),
    el('div', { class: `stat-value ${tone || ''}` }, value),
    foot && el('div', { class: 'stat-foot' }, foot)
  );
}

function toneFor(ratio) {
  if (ratio > 1) return 'over';
  if (ratio >= 0.8) return 'warn';
  return null;
}

function budgetRow(row) {
  const ratio = row.ratio ?? 0;
  const tone = toneFor(ratio);

  return el('div', { class: 'budget-row' },
    el('div', { class: 'budget-top' },
      el('span', { class: 'dot', style: { background: row.category.color } }),
      el('span', { class: 'name' }, row.category.name),
      el('span', { class: 'values num' },
        el('strong', { class: tone === 'over' ? 'neg' : '' }, brl(row.spent)),
        ' / ', brl(row.budget))
    ),
    el('div', { class: 'bar', dataset: tone ? { tone } : {} },
      el('span', { style: { width: `${Math.min(ratio, 1) * 100}%` } })
    ),
    el('div', { class: 'budget-foot' },
      el('span', {}, pct(ratio * 100, 0), ' usado'),
      el('span', { class: 'spacer' }),
      el('span', { class: row.remaining < 0 ? 'neg' : '' },
        row.remaining < 0 ? `estourou ${brl(-row.remaining)}` : `restam ${brl(row.remaining)}`)
    )
  );
}

function untrackedRow(row) {
  return el('div', { class: 'budget-row' },
    el('div', { class: 'budget-top' },
      el('span', { class: 'dot', style: { background: row.category.color } }),
      el('span', { class: 'name' }, row.category.name),
      el('span', { class: 'values num' }, brl(row.spent)),
      iconButton('+', 'Definir teto', () => openSingleBudget(row.category))
    )
  );
}

// --- edição ----------------------------------------------------------

function openSingleBudget(category) {
  modal({
    title: `Teto de ${category.name}`,
    render: () => field('Limite mensal',
      el('input', {
        type: 'text', name: 'budget', inputmode: 'decimal', placeholder: '0,00',
        value: category.monthly_budget ? brl(category.monthly_budget).replace('R$', '').trim() : '',
      }),
      'Deixe em branco para não acompanhar esta categoria.'),
    onSubmit: async (data) => {
      const raw = data.get('budget').trim();
      const value = raw ? parseMoney(raw) : null;
      if (raw && (!Number.isFinite(value) || value < 0)) throw new Error('Valor inválido.');
      await store.update('categories', category.id, { monthly_budget: raw ? round2(value) : null });
      toast('Teto atualizado.', 'success');
    },
  });
}

/** Edita todos os tetos de uma vez — mais rápido que abrir categoria por categoria. */
function openBudgetEditor() {
  const categories = state.categories.filter((c) => c.kind === 'expense' && !c.archived);
  if (!categories.length) {
    toast('Cadastre categorias de despesa em Ajustes primeiro.', 'error');
    return;
  }

  modal({
    title: 'Tetos mensais',
    width: '520px',
    render: () => el('div', { class: 'stack' },
      el('p', { class: 'muted small', style: { margin: 0 } },
        'Em branco = categoria sem acompanhamento de orçamento.'),
      ...categories.map((category) => field(
        category.name,
        el('input', {
          type: 'text', name: category.id, inputmode: 'decimal', placeholder: '0,00',
          value: category.monthly_budget ? brl(category.monthly_budget).replace('R$', '').trim() : '',
        })
      ))
    ),
    onSubmit: async (data) => {
      const updates = [];
      for (const category of categories) {
        const raw = (data.get(category.id) || '').trim();
        const parsed = raw ? parseMoney(raw) : null;
        if (raw && (!Number.isFinite(parsed) || parsed < 0)) {
          throw new Error(`Valor inválido em ${category.name}.`);
        }
        const next = raw ? round2(parsed) : null;
        const current = category.monthly_budget == null ? null : Number(category.monthly_budget);
        if (next !== current) updates.push([category.id, next]);
      }
      for (const [id, monthly_budget] of updates) {
        await store.update('categories', id, { monthly_budget });
      }
      toast(updates.length ? `${updates.length} teto(s) atualizado(s).` : 'Nada mudou.', 'success');
    },
  });
}
