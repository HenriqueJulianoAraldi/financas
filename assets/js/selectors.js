// Tudo que é derivado dos dados brutos mora aqui: competência da fatura,
// totais do mês, consumo de orçamento, posição da carteira e progresso das metas.
// Nenhuma dessas contas é gravada no banco.

import { state } from './store.js';
import { round2, monthStart, addMonths, monthsBetween, currentMonth, todayISO } from './format.js';

export const ASSET_CLASSES = [
  { value: 'acao', label: 'Ações' },
  { value: 'fii', label: 'FIIs' },
  { value: 'rf', label: 'Renda fixa' },
  { value: 'tesouro', label: 'Tesouro Direto' },
  { value: 'cripto', label: 'Cripto' },
  { value: 'internacional', label: 'Internacional' },
  { value: 'outro', label: 'Outro' },
];

export const ASSET_MODES = [
  { value: 'quota', label: 'Cotas — ação, FII, cripto' },
  { value: 'balance', label: 'Saldo — cofrinho, CDB, poupança' },
];

export const ACCOUNT_TYPES = [
  { value: 'checking', label: 'Conta corrente' },
  { value: 'cash', label: 'Dinheiro' },
  { value: 'credit_card', label: 'Cartão de crédito' },
];

export function classLabel(value) {
  return ASSET_CLASSES.find((c) => c.value === value)?.label ?? value;
}

export function accountTypeLabel(value) {
  return ACCOUNT_TYPES.find((t) => t.value === value)?.label ?? value;
}

// --- índices ---------------------------------------------------------

export function byId(collection) {
  return new Map(state[collection].map((row) => [row.id, row]));
}

export function categoryName(id) {
  return state.categories.find((c) => c.id === id)?.name ?? 'Sem categoria';
}

export function categoryColor(id) {
  return state.categories.find((c) => c.id === id)?.color ?? '#6b7280';
}

export function accountName(id) {
  return state.accounts.find((a) => a.id === id)?.name ?? '—';
}

export function isCreditCard(accountId) {
  return state.accounts.find((a) => a.id === accountId)?.type === 'credit_card';
}

// --- competência -----------------------------------------------------

/**
 * Em que mês o lançamento pesa no orçamento.
 * Débito/dinheiro: o próprio mês da compra.
 * Cartão: se a compra caiu depois do fechamento, entra na fatura seguinte.
 */
export function competenceFor(dateISO, accountId) {
  const month = dateISO.slice(0, 7);
  const account = state.accounts.find((a) => a.id === accountId);
  if (!account || account.type !== 'credit_card' || !account.closing_day) {
    return monthStart(month);
  }
  const day = Number(dateISO.slice(8, 10));
  return monthStart(day > account.closing_day ? addMonths(month, 1) : month);
}

// --- lançamentos -----------------------------------------------------

/** Lançamentos que pesam no mês informado ('YYYY-MM'). */
export function transactionsOfMonth(monthKey) {
  const competence = monthStart(monthKey);
  return state.transactions.filter((t) => t.competence === competence);
}

export function monthTotals(monthKey) {
  let income = 0;
  let expense = 0;
  for (const t of transactionsOfMonth(monthKey)) {
    if (t.kind === 'income') income += Number(t.amount);
    else expense += Number(t.amount);
  }
  const balance = round2(income - expense);
  return {
    income: round2(income),
    expense: round2(expense),
    balance,
    savingsRate: income > 0 ? (balance / income) * 100 : 0,
  };
}

/** Série de {month, income, expense, balance} para os meses informados. */
export function monthlySeries(months) {
  return months.map((month) => ({ month, ...monthTotals(month) }));
}

/** Gastos por categoria no mês, do maior para o menor. */
export function expensesByCategory(monthKey) {
  const totals = new Map();
  for (const t of transactionsOfMonth(monthKey)) {
    if (t.kind !== 'expense') continue;
    const key = t.category_id ?? 'none';
    totals.set(key, (totals.get(key) || 0) + Number(t.amount));
  }
  return [...totals.entries()]
    .map(([id, total]) => ({
      id,
      name: id === 'none' ? 'Sem categoria' : categoryName(id),
      color: id === 'none' ? '#6b7280' : categoryColor(id),
      total: round2(total),
    }))
    .sort((a, b) => b.total - a.total);
}

/** Consumo do orçamento no mês, por categoria com teto definido. */
export function budgetUsage(monthKey) {
  const spentByCategory = new Map(expensesByCategory(monthKey).map((row) => [row.id, row.total]));
  const rows = state.categories
    .filter((c) => c.kind === 'expense' && !c.archived)
    .map((category) => {
      const budget = category.monthly_budget == null ? null : Number(category.monthly_budget);
      const spent = round2(spentByCategory.get(category.id) || 0);
      return {
        category,
        budget,
        spent,
        remaining: budget == null ? null : round2(budget - spent),
        ratio: budget ? spent / budget : null,
      };
    });

  const withBudget = rows.filter((r) => r.budget != null);
  return {
    rows: withBudget.sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0)),
    untracked: rows.filter((r) => r.budget == null && r.spent > 0).sort((a, b) => b.spent - a.spent),
    totalBudget: round2(withBudget.reduce((sum, r) => sum + r.budget, 0)),
    totalSpent: round2(withBudget.reduce((sum, r) => sum + r.spent, 0)),
  };
}

/** Faturas de cartão agrupadas por competência. */
export function creditInvoices(monthKey) {
  const cards = state.accounts.filter((a) => a.type === 'credit_card');
  const competence = monthStart(monthKey);
  return cards.map((card) => {
    const items = state.transactions.filter(
      (t) => t.account_id === card.id && t.competence === competence && t.kind === 'expense'
    );
    return {
      account: card,
      items,
      total: round2(items.reduce((sum, t) => sum + Number(t.amount), 0)),
      dueDate: card.due_day ? `${monthKey}-${String(card.due_day).padStart(2, '0')}` : null,
    };
  }).filter((invoice) => invoice.items.length > 0);
}

// --- investimentos ---------------------------------------------------

/**
 * Posição de um ativo a partir do histórico de negociações.
 * Preço médio pela média ponderada das compras; venda reduz a quantidade e o
 * custo proporcionalmente, sem mexer no preço médio.
 */
export function positionOf(assetId) {
  const trades = state.trades
    .filter((t) => t.asset_id === assetId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at));

  let quantity = 0;
  let cost = 0;
  let realized = 0;

  for (const trade of trades) {
    const qty = Number(trade.quantity);
    const price = Number(trade.price);
    const fees = Number(trade.fees) || 0;

    if (trade.side === 'buy') {
      quantity += qty;
      cost += qty * price + fees;
    } else {
      const sold = Math.min(qty, quantity);
      const avg = quantity > 0 ? cost / quantity : 0;
      realized += sold * price - sold * avg - fees;
      quantity -= sold;
      cost -= sold * avg;
      if (quantity <= 1e-9) {
        quantity = 0;
        cost = 0;
      }
    }
  }

  return {
    quantity,
    cost: round2(cost),
    avgPrice: quantity > 0 ? cost / quantity : 0,
    realized: round2(realized),
    tradeCount: trades.length,
  };
}

/**
 * Ativo de saldo: cofrinho, CDB, poupança, Tesouro Selic. Não tem quantidade
 * nem cotação — você informa o saldo que o banco mostra, e o rendimento é a
 * diferença entre ele e o que foi aportado. Os aportes e resgates são gravados
 * em asset_trades com preço 1, então `cost` já sai como aportes − resgates.
 */
export function isBalanceAsset(asset) {
  return asset?.pricing_mode === 'balance';
}

/** Carteira completa: posições, participação e alvo de alocação. */
export function portfolio() {
  const rows = state.assets
    .filter((asset) => !asset.archived)
    .map((asset) => {
      const position = positionOf(asset.id);
      const balanceMode = isBalanceAsset(asset);
      const price = Number(asset.current_price) || 0;
      const value = balanceMode
        ? round2(Number(asset.balance) || 0)
        : round2(position.quantity * price);
      const pnl = round2(value - position.cost);
      return {
        asset,
        ...position,
        balanceMode,
        price,
        value,
        pnl,
        pnlPct: position.cost > 0 ? (pnl / position.cost) * 100 : 0,
      };
    })
    .filter((row) => row.quantity > 0 || row.tradeCount > 0 || row.value > 0);

  const total = round2(rows.reduce((sum, row) => sum + row.value, 0));
  const cost = round2(rows.reduce((sum, row) => sum + row.cost, 0));

  for (const row of rows) {
    row.weight = total > 0 ? (row.value / total) * 100 : 0;
  }
  rows.sort((a, b) => b.value - a.value);

  const byClass = new Map();
  for (const row of rows) {
    const key = row.asset.asset_class;
    const bucket = byClass.get(key) || { key, label: classLabel(key), value: 0, cost: 0, rows: [] };
    bucket.value = round2(bucket.value + row.value);
    bucket.cost = round2(bucket.cost + row.cost);
    bucket.rows.push(row);
    byClass.set(key, bucket);
  }
  for (const bucket of byClass.values()) {
    bucket.weight = total > 0 ? (bucket.value / total) * 100 : 0;
    bucket.pnl = round2(bucket.value - bucket.cost);
  }

  return {
    rows,
    classes: [...byClass.values()].sort((a, b) => b.value - a.value),
    total,
    cost,
    pnl: round2(total - cost),
    pnlPct: cost > 0 ? ((total - cost) / cost) * 100 : 0,
    realized: round2(rows.reduce((sum, row) => sum + row.realized, 0)),
  };
}

/** Evolução do patrimônio: snapshots gravados + o valor atual no mês corrente. */
export function equitySeries(months) {
  const snapshots = new Map(state.snapshots.map((s) => [s.month.slice(0, 7), Number(s.total_value)]));
  const now = currentMonth();
  const live = portfolio().total;
  let last = null;
  return months.map((month) => {
    let value = snapshots.get(month);
    if (month === now && live > 0) value = live;
    if (value == null) value = last;
    if (value != null) last = value;
    return { month, value };
  });
}

// --- metas -----------------------------------------------------------

export function goalProgress(goal) {
  const saved = round2(
    state.contributions
      .filter((c) => c.goal_id === goal.id)
      .reduce((sum, c) => sum + Number(c.amount), 0)
  );
  const target = Number(goal.target_amount);
  const missing = round2(Math.max(target - saved, 0));

  let monthsLeft = null;
  let monthlyNeeded = null;
  if (goal.target_date) {
    monthsLeft = Math.max(monthsBetween(todayISO().slice(0, 7), goal.target_date.slice(0, 7)), 0);
    monthlyNeeded = monthsLeft > 0 ? round2(missing / monthsLeft) : missing;
  }

  return {
    saved,
    target,
    missing,
    ratio: target > 0 ? saved / target : 0,
    monthsLeft,
    monthlyNeeded,
    done: saved >= target,
    late: Boolean(goal.target_date) && goal.target_date < todayISO() && saved < target,
  };
}
