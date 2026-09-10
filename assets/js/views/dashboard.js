// Visão geral do mês + evolução do patrimônio.

import { el, empty } from '../dom.js';
import { state } from '../store.js';
import {
  monthTotals, monthlySeries, expensesByCategory, portfolio, equitySeries, goalProgress,
} from '../selectors.js';
import { brl, pct, lastMonths, monthLabelLong, signedPct } from '../format.js';
import { getMonth } from '../ui-state.js';
import { monthlyBars, equityLine, destroyAll } from '../charts.js';

export function render() {
  destroyAll();

  const month = getMonth();
  const totals = monthTotals(month);
  const series = monthlySeries(lastMonths(12, month));
  const categories = expensesByCategory(month);
  const wallet = portfolio();

  return el('div', { class: 'stack' },
    statsRow(totals, wallet),

    el('div', { class: 'grid grid-2' },
      chartCard('Receitas e despesas', 'Últimos 12 meses', (canvas) => monthlyBars(canvas, series)),
      categoriesCard(categories, totals.expense)
    ),

    el('div', { class: 'grid grid-2' },
      walletCard(wallet),
      goalsCard()
    )
  );
}

function statsRow(totals, wallet) {
  const positive = totals.balance >= 0;
  return el('div', { class: 'grid grid-stats' },
    stat('Saldo do mês', brl(totals.balance), positive ? null : 'danger',
      monthLabelLong(getMonth())),
    stat('Receitas', brl(totals.income), 'income'),
    stat('Despesas', brl(totals.expense), 'expense'),
    stat('Taxa de poupança', totals.income > 0 ? pct(totals.savingsRate, 0) : '—',
      totals.savingsRate >= 0 ? 'income' : 'danger',
      totals.income > 0 ? 'do que entrou, sobrou' : 'sem receita lançada'),
    stat('Investido', brl(wallet.total), null,
      wallet.cost > 0 ? `${signedPct(wallet.pnlPct)} sobre o custo` : 'nenhum ativo ainda')
  );
}

function stat(label, value, tone, foot) {
  return el('div', { class: 'stat', dataset: tone ? { tone } : {} },
    el('div', { class: 'stat-label' }, label),
    el('div', { class: `stat-value ${tone || ''}` }, value),
    foot && el('div', { class: 'stat-foot' }, foot)
  );
}

function chartCard(title, subtitle, build) {
  const canvas = el('canvas');
  const card = el('div', { class: 'card' },
    el('div', { class: 'card-head' },
      el('h2', {}, title),
      subtitle && el('span', { class: 'muted small' }, subtitle)
    ),
    el('div', { class: 'chart-box' }, canvas)
  );
  build(canvas);
  return card;
}

/** Ranking de gastos: uma medida, uma cor — barra com rótulo direto. */
function categoriesCard(rows, totalExpense) {
  const top = rows.slice(0, 8);
  const rest = rows.slice(8);
  const max = top[0]?.total ?? 0;

  return el('div', { class: 'card' },
    el('div', { class: 'card-head' },
      el('h2', {}, 'Gastos por categoria'),
      el('span', { class: 'muted small' }, monthLabelLong(getMonth()))
    ),
    rows.length
      ? el('div', { class: 'ranks' },
          ...top.map((row) => rankRow(row.name, row.total, max, totalExpense, row.color)),
          rest.length
            ? rankRow(`Outras ${rest.length} categorias`,
                rest.reduce((sum, row) => sum + row.total, 0), max, totalExpense, null)
            : null
        )
      : empty('Nenhuma despesa neste mês.')
  );
}

function rankRow(name, value, max, total, dotColor) {
  const share = total > 0 ? (value / total) * 100 : 0;
  return el('div', { class: 'rank-row' },
    el('div', { class: 'rank-head' },
      dotColor && el('span', { class: 'dot', style: { background: dotColor } }),
      el('span', { class: 'rank-name' }, name),
      el('span', { class: 'rank-value num' }, brl(value)),
      el('span', { class: 'rank-share num dim' }, pct(share, 0))
    ),
    el('div', { class: 'bar' },
      el('span', { style: { width: `${max > 0 ? (value / max) * 100 : 0}%` } })
    )
  );
}

function walletCard(wallet) {
  // Só desenha a linha a partir do primeiro mês com valor: preencher os meses
  // anteriores com zero inventaria uma queda que nunca existiu.
  const series = equitySeries(lastMonths(12, getMonth()));
  const first = series.findIndex((row) => row.value != null);
  const points = first < 0 ? [] : series.slice(first);

  const canvas = el('canvas');
  const card = el('div', { class: 'card' },
    el('div', { class: 'card-head' },
      el('h2', {}, 'Patrimônio investido'),
      wallet.cost > 0 && el('span', { class: `chip ${wallet.pnl >= 0 ? 'pos' : 'neg'}` },
        `${wallet.pnl >= 0 ? '+' : '−'} ${brl(Math.abs(wallet.pnl))}`)
    ),
    points.length >= 2
      ? el('div', { class: 'chart-box' }, canvas)
      : el('div', { class: 'empty' },
          el('div', { class: 'stat-value' }, brl(wallet.total)),
          el('p', { class: 'small' }, wallet.total > 0
            ? 'Atualize os preços a cada mês para montar o gráfico de evolução.'
            : 'Cadastre ativos em Investimentos para acompanhar a evolução.')
        )
  );

  if (points.length >= 2) equityLine(canvas, points);
  return card;
}

function goalsCard() {
  const goals = state.goals.filter((goal) => !goal.archived).slice(0, 4);

  return el('div', { class: 'card' },
    el('div', { class: 'card-head' },
      el('h2', {}, 'Metas'),
      el('a', { class: 'muted small', href: '#/metas' }, 'ver todas')
    ),
    goals.length
      ? el('div', {}, ...goals.map((goal) => {
          const progress = goalProgress(goal);
          const tone = progress.done ? 'done' : progress.late ? 'over' : null;
          return el('div', { class: 'budget-row' },
            el('div', { class: 'budget-top' },
              el('span', { class: 'dot', style: { background: goal.color } }),
              el('span', { class: 'name' }, goal.name),
              el('span', { class: 'values num' }, `${brl(progress.saved)} / ${brl(progress.target)}`)
            ),
            el('div', { class: 'bar', dataset: tone ? { tone } : {} },
              el('span', { style: { width: `${Math.min(progress.ratio, 1) * 100}%` } })
            )
          );
        }))
      : empty('Nenhuma meta cadastrada.',
          el('a', { class: 'btn btn-ghost', href: '#/metas' }, 'Criar meta'))
  );
}
