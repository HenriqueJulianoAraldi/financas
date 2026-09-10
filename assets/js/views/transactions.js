// Lançamentos: lista agrupada por dia, filtros de período, formulário (com
// parcelamento) e importação de CSV.

import { el, clear, field, select, iconButton, modal, confirmDialog, toast, empty } from '../dom.js';
import * as store from '../store.js';
import { state } from '../store.js';
import {
  transactionsOfPeriod, resolvePeriod, totalsOf, groupByDay, PERIODS,
  competenceFor, categoryName, categoryColor, accountName, isCreditCard, creditInvoices,
} from '../selectors.js';
import { brl, dateBR, todayISO, parseMoney, round2, addMonths } from '../format.js';
import { getMonth } from '../ui-state.js';
import { parseCSV, guessMapping, buildRows, dedupeKey } from '../csv.js';

// Sobrevive ao redesenho disparado pelo store.
const filters = {
  text: '', kind: '', categoryId: '', accountId: '',
  period: 'mes', from: todayISO(), to: todayISO(),
};

// Trocar um filtro redesenha só a lista — refazer a tela inteira roubaria o
// foco do campo de busca no meio da digitação.
let listHost = null;
let statsHost = null;
let countLabel = null;
let rangeLabel = null;

function currentPeriod() {
  return resolvePeriod(filters.period, {
    month: getMonth(), from: filters.from, to: filters.to,
  });
}

export function render() {
  const period = currentPeriod();
  const rows = applyFilters(transactionsOfPeriod(period, getMonth()));

  statsHost = el('div', { class: 'grid grid-stats' }, ...statCards(totalsOf(rows)));
  listHost = el('div', {}, listCard(rows, period));
  countLabel = el('span', { class: 'muted small' }, countText(rows.length));
  rangeLabel = el('span', { class: 'period-range' }, period.label);

  // O seletor de mês do topo só comanda o período "Mês"; nos outros ele não
  // faria nada e confundiria. Roda depois do onRender do roteador.
  queueMicrotask(syncMonthNav);

  return el('div', { class: 'stack' },
    statsHost,
    periodBar(),
    el('div', { class: 'toolbar' },
      el('button', { class: 'btn btn-primary', onclick: () => openForm() }, '+ Novo lançamento'),
      el('button', { class: 'btn btn-ghost', onclick: openImport }, 'Importar CSV'),
      el('span', { class: 'spacer' }),
      countLabel
    ),
    filtersCard(),
    listHost,
    ...(period.byCompetence ? invoiceCards(getMonth()) : [])
  );
}

function syncMonthNav() {
  const nav = document.getElementById('month-nav');
  if (nav) nav.hidden = filters.period !== 'mes';
}

function countText(count) {
  return `${count} ${count === 1 ? 'lançamento' : 'lançamentos'}`;
}

/** Trocar o período muda a tela toda (faturas, seletor de mês), então redesenha. */
function rerender() {
  import('../router.js').then((router) => router.render());
}

function refreshList() {
  if (!listHost?.isConnected) return;
  const period = currentPeriod();
  const rows = applyFilters(transactionsOfPeriod(period, getMonth()));
  clear(listHost).append(listCard(rows, period));
  clear(statsHost).append(...statCards(totalsOf(rows)));
  countLabel.textContent = countText(rows.length);
  rangeLabel.textContent = period.label;
}

function statCards(totals) {
  return [
    stat('Receitas', brl(totals.income), 'income'),
    stat('Despesas', brl(totals.expense), 'expense'),
    stat('Saldo', brl(totals.balance), totals.balance < 0 ? 'danger' : null),
  ];
}

function stat(label, value, tone) {
  return el('div', { class: 'stat', dataset: tone ? { tone } : {} },
    el('div', { class: 'stat-label' }, label),
    el('div', { class: `stat-value ${tone || ''}` }, value)
  );
}

function applyFilters(rows) {
  const text = filters.text.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.kind && row.kind !== filters.kind) return false;
    if (filters.categoryId && row.category_id !== filters.categoryId) return false;
    if (filters.accountId && row.account_id !== filters.accountId) return false;
    if (text && !`${row.description} ${row.notes || ''}`.toLowerCase().includes(text)) return false;
    return true;
  });
}

function periodBar() {
  const chips = PERIODS.map((option) => el('button', {
    type: 'button',
    class: `period-chip${filters.period === option.key ? ' is-active' : ''}`,
    'aria-pressed': filters.period === option.key ? 'true' : 'false',
    onclick: () => {
      if (filters.period === option.key) return;
      filters.period = option.key;
      rerender();
    },
  }, option.label));

  const dateInput = (key) => el('input', {
    type: 'date',
    value: filters[key],
    onchange: (event) => {
      filters[key] = event.target.value || todayISO();
      refreshList();
    },
  });

  const custom = el('div', { class: 'period-custom', hidden: filters.period !== 'custom' },
    field('De', dateInput('from')),
    field('Até', dateInput('to'))
  );

  const chipsRow = el('div', { class: 'period-chips' }, ...chips);

  // A fila rola na horizontal no celular: traz a pílula ativa para o centro.
  // Mexer no scrollLeft do container em vez de scrollIntoView, que arrastaria
  // a página inteira junto.
  queueMicrotask(() => {
    const ativo = chipsRow.querySelector('.is-active');
    if (!ativo || !chipsRow.isConnected) return;
    const alvo = ativo.offsetLeft - (chipsRow.clientWidth - ativo.offsetWidth) / 2;
    chipsRow.scrollLeft = Math.max(0, alvo);
  });

  return el('div', { class: 'period-bar' },
    chipsRow,
    custom,
    el('div', { class: 'period-foot' },
      rangeLabel,
      filters.period === 'mes'
        ? el('span', { class: 'dim small' }, 'por competência — compra no cartão entra na fatura')
        : null
    )
  );
}

function filtersCard() {
  const update = (key) => (event) => {
    filters[key] = event.target.value;
    refreshList();
  };

  const search = el('input', {
    type: 'search',
    placeholder: 'Buscar descrição…',
    value: filters.text,
    oninput: debounce((event) => { filters.text = event.target.value; refreshList(); }, 200),
  });

  return el('div', { class: 'filters' },
    search,
    select([{ value: 'expense', label: 'Só despesas' }, { value: 'income', label: 'Só receitas' }],
      { value: filters.kind, placeholder: 'Tipo: todos', onchange: update('kind') }),
    select(state.categories.map((c) => ({ value: c.id, label: c.name })),
      { value: filters.categoryId, placeholder: 'Categoria: todas', onchange: update('categoryId') }),
    select(state.accounts.map((a) => ({ value: a.id, label: a.name })),
      { value: filters.accountId, placeholder: 'Conta: todas', onchange: update('accountId') })
  );
}

function listCard(rows, period) {
  if (!rows.length) {
    const semFiltro = transactionsOfPeriod(period, getMonth()).length === 0;
    return el('div', { class: 'card' },
      empty(
        semFiltro
          ? `Nada lançado em ${period.label.toLowerCase()}.`
          : 'Nenhum lançamento bate com os filtros.',
        semFiltro
          ? el('button', { class: 'btn btn-primary', onclick: () => openForm() }, 'Lançar o primeiro')
          : null
      )
    );
  }

  return el('div', { class: 'card card-flush' },
    el('div', { class: 'days' }, ...groupByDay(rows).map(dayGroup))
  );
}

function dayGroup(grupo) {
  const liquido = grupo.balance;
  return el('section', { class: 'day-group' },
    el('header', { class: 'day-head' },
      el('span', { class: 'day-title' }, grupo.label),
      el('span', { class: 'day-date' }, dateBR(grupo.date)),
      el('span', { class: `day-total num ${liquido >= 0 ? 'pos' : ''}` },
        `${liquido >= 0 ? '+' : '−'} ${brl(Math.abs(liquido))}`)
    ),
    ...grupo.items.map(entryRow)
  );
}

function entryRow(row) {
  const marcas = [
    categoryName(row.category_id),
    accountName(row.account_id),
    row.installment_total > 1 ? `parcela ${row.installment_no}/${row.installment_total}` : null,
    row.recurring_id ? 'fixo' : null,
    row.notes || null,
  ].filter(Boolean).join(' · ');

  return el('div', { class: 'entry' },
    el('span', {
      class: 'dot',
      style: { background: categoryColor(row.category_id) },
      title: categoryName(row.category_id),
    }),
    el('div', { class: 'entry-main' },
      el('div', { class: 'entry-desc' }, row.description),
      el('div', { class: 'entry-sub' }, marcas)
    ),
    el('span', { class: `entry-amount num ${row.kind === 'income' ? 'pos' : ''}` },
      `${row.kind === 'income' ? '+' : '−'} ${brl(row.amount)}`),
    el('span', { class: 'entry-actions' },
      iconButton('✎', 'Editar', () => openForm(row)),
      iconButton('🗑', 'Excluir', () => removeTransaction(row), 'danger')
    )
  );
}

function invoiceCards(month) {
  return creditInvoices(month).map((invoice) =>
    el('div', { class: 'card' },
      el('div', { class: 'card-head' },
        el('h2', {}, `Fatura · ${invoice.account.name}`),
        invoice.dueDate && el('span', { class: 'chip' }, `vence ${dateBR(invoice.dueDate)}`),
        el('strong', { class: 'num' }, brl(invoice.total))
      ),
      el('p', { class: 'muted small', style: { margin: 0 } },
        `${invoice.items.length} ${invoice.items.length === 1 ? 'compra' : 'compras'} nesta competência.`)
    )
  );
}

// --- formulário ------------------------------------------------------

function openForm(existing = null) {
  if (!state.accounts.length) {
    toast('Cadastre uma conta em Ajustes antes de lançar.', 'error');
    return;
  }

  const editing = Boolean(existing);
  const initial = existing ?? {
    kind: 'expense',
    date: defaultDate(),
    description: '',
    amount: '',
    category_id: '',
    account_id: state.accounts[0].id,
    notes: '',
  };

  let categorySelect;
  let installmentsWrap;
  let accountSelect;
  let kindSelect;

  const categoryOptions = (kind) => state.categories
    .filter((c) => c.kind === kind && !c.archived)
    .map((c) => ({ value: c.id, label: c.name }));

  const syncInstallments = () => {
    const showable = !editing && kindSelect.value === 'expense' && isCreditCard(accountSelect.value);
    installmentsWrap.hidden = !showable;
  };

  modal({
    title: editing ? 'Editar lançamento' : 'Novo lançamento',
    submitLabel: editing ? 'Salvar' : 'Lançar',
    render: () => {
      kindSelect = select(
        [{ value: 'expense', label: 'Despesa' }, { value: 'income', label: 'Receita' }],
        {
          name: 'kind',
          value: initial.kind,
          onchange: (event) => {
            const options = categoryOptions(event.target.value);
            clear(categorySelect).append(el('option', { value: '' }, 'Sem categoria'));
            for (const option of options) {
              categorySelect.append(el('option', { value: option.value }, option.label));
            }
            syncInstallments();
          },
        }
      );

      categorySelect = select(categoryOptions(initial.kind), {
        name: 'category_id',
        value: initial.category_id ?? '',
        placeholder: 'Sem categoria',
      });

      accountSelect = select(
        state.accounts.filter((a) => !a.archived).map((a) => ({ value: a.id, label: a.name })),
        { name: 'account_id', value: initial.account_id ?? '', onchange: syncInstallments }
      );

      const installmentsInput = el('input', {
        type: 'number', name: 'installments', min: '1', max: '60', step: '1', value: '1',
      });
      installmentsWrap = field('Parcelas', installmentsInput, 'Cada parcela cai numa fatura.');
      installmentsWrap.hidden = true;

      const wrap = el('div', { class: 'form-grid' },
        field('Tipo', kindSelect),
        field('Data', el('input', { type: 'date', name: 'date', required: true, value: initial.date })),
        field('Descrição', el('input', {
          type: 'text', name: 'description', required: true, maxlength: '120',
          value: initial.description, placeholder: 'Mercado, aluguel, salário…',
        })),
        field('Valor', el('input', {
          type: 'text', name: 'amount', required: true, inputmode: 'decimal',
          value: initial.amount === '' ? '' : brl(initial.amount).replace('R$', '').trim(),
          placeholder: '0,00',
        })),
        field('Categoria', categorySelect),
        field('Conta', accountSelect),
        installmentsWrap,
        Object.assign(field('Observação', el('textarea', {
          name: 'notes', rows: '2', value: initial.notes ?? '',
        })), { className: 'field span-2' })
      );

      queueMicrotask(syncInstallments);
      return wrap;
    },

    onSubmit: async (data) => {
      const amount = parseMoney(data.get('amount'));
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Informe um valor maior que zero.');

      const base = {
        kind: data.get('kind'),
        date: data.get('date'),
        description: data.get('description').trim(),
        amount: round2(amount),
        category_id: data.get('category_id') || null,
        account_id: data.get('account_id') || null,
        notes: data.get('notes')?.trim() || null,
      };
      base.competence = competenceFor(base.date, base.account_id);

      if (editing) {
        await store.update('transactions', existing.id, base);
        toast('Lançamento atualizado.', 'success');
        return;
      }

      const installments = installmentsWrap.hidden ? 1 : Number(data.get('installments')) || 1;
      if (installments > 1) {
        await store.createMany('transactions', splitInstallments(base, installments));
        toast(`Compra parcelada em ${installments}x lançada.`, 'success');
      } else {
        await store.create('transactions', base);
        toast('Lançamento salvo.', 'success');
      }
    },
  });
}

/** Divide o total em N parcelas; a diferença de arredondamento vai na última. */
function splitInstallments(base, count) {
  const group = crypto.randomUUID();
  const each = round2(base.amount / count);
  const last = round2(base.amount - each * (count - 1));

  return Array.from({ length: count }, (_, index) => ({
    ...base,
    amount: index === count - 1 ? last : each,
    competence: addMonths(base.competence, index),
    installment_group: group,
    installment_no: index + 1,
    installment_total: count,
    description: base.description,
  }));
}

async function removeTransaction(row) {
  const grouped = row.installment_total > 1 && row.installment_group;
  const ok = await confirmDialog({
    title: 'Excluir lançamento',
    message: grouped
      ? `"${row.description}" é uma compra em ${row.installment_total}x. Todas as parcelas serão excluídas.`
      : `Excluir "${row.description}" de ${brl(row.amount)}?`,
  });
  if (!ok) return;
  try {
    if (grouped) await store.removeInstallmentGroup(row.installment_group);
    else await store.remove('transactions', row.id);
    toast('Lançamento excluído.');
  } catch (error) {
    toast(error.message, 'error');
  }
}

// --- importação de CSV ------------------------------------------------

function openImport() {
  if (!state.accounts.length) {
    toast('Cadastre uma conta em Ajustes antes de importar.', 'error');
    return;
  }

  let parsed = null;   // { headers, rows }
  let mapping = null;
  const details = el('div', { class: 'stack', hidden: true });

  modal({
    title: 'Importar extrato CSV',
    submitLabel: 'Importar',
    width: '640px',
    render: () => {
      const fileInput = el('input', {
        type: 'file', name: 'file', accept: '.csv,text/csv,text/plain',
        onchange: async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          try {
            parsed = parseCSV(await file.text());
            mapping = guessMapping(parsed.headers, parsed.rows);
            renderDetails();
            details.hidden = false;
          } catch (error) {
            details.hidden = true;
            toast(error.message, 'error');
          }
        },
      });

      function renderDetails() {
        clear(details);
        const options = parsed.headers.map((header, index) => ({ value: index, label: header }));

        const mapSelect = (key) => select(options, {
          value: mapping[key],
          placeholder: '— ignorar —',
          onchange: (event) => {
            mapping[key] = event.target.value === '' ? -1 : Number(event.target.value);
            renderPreview();
          },
        });

        const preview = el('div', {});
        const renderPreview = () => {
          clear(preview);
          const { parsed: rows, skipped } = buildRows(parsed.rows, mapping, {
            invertSign: details.querySelector('[name="invert"]')?.checked ?? false,
          });
          const existing = new Set(state.transactions.map(dedupeKey));
          const fresh = rows.filter((row) => !existing.has(dedupeKey(row)));
          const duplicates = rows.length - fresh.length;

          preview.append(
            el('p', { class: 'muted small', style: { margin: '0 0 .5rem' } },
              `${fresh.length} para importar` +
              (duplicates ? ` · ${duplicates} já existem` : '') +
              (skipped.length ? ` · ${skipped.length} linhas ignoradas` : '')
            ),
            fresh.length
              ? el('div', { class: 'table-wrap' },
                  el('table', {},
                    el('thead', {}, el('tr', {},
                      el('th', {}, 'Data'), el('th', {}, 'Descrição'),
                      el('th', {}, 'Tipo'), el('th', { class: 'num' }, 'Valor'))),
                    el('tbody', {}, ...fresh.slice(0, 6).map((row) => el('tr', {},
                      el('td', { class: 'num' }, dateBR(row.date)),
                      el('td', {}, row.description),
                      el('td', { class: 'muted' }, row.kind === 'income' ? 'Receita' : 'Despesa'),
                      el('td', { class: 'num' }, brl(row.amount))
                    )))
                  )
                )
              : el('p', { class: 'muted small' }, 'Nada novo para importar com este mapeamento.')
          );
        };

        details.append(
          el('div', { class: 'form-grid' },
            field('Coluna da data', mapSelect('date')),
            field('Coluna da descrição', mapSelect('description')),
            field('Coluna do valor', mapSelect('amount')),
            field('Conta de destino', select(
              state.accounts.map((a) => ({ value: a.id, label: a.name })),
              { name: 'account_id', value: state.accounts[0].id }
            )),
            field('Categoria padrão', select(
              state.categories.filter((c) => c.kind === 'expense').map((c) => ({ value: c.id, label: c.name })),
              { name: 'category_id', placeholder: 'Sem categoria' }
            ))
          ),
          el('label', { class: 'chip', style: { cursor: 'pointer', padding: '.4rem .7rem' } },
            el('input', { type: 'checkbox', name: 'invert', onchange: renderPreview }),
            'Inverter o sinal (o extrato traz despesas como positivo)'
          ),
          preview
        );
        renderPreview();
      }

      return el('div', { class: 'stack' },
        field('Arquivo CSV', fileInput, 'Aceita separador ; ou , e valores no formato brasileiro.'),
        details
      );
    },

    onSubmit: async (data) => {
      if (!parsed) throw new Error('Escolha um arquivo primeiro.');
      const accountId = data.get('account_id') || null;
      const categoryId = data.get('category_id') || null;
      const { parsed: rows } = buildRows(parsed.rows, mapping, {
        invertSign: data.get('invert') === 'on',
      });

      const existing = new Set(state.transactions.map(dedupeKey));
      const fresh = rows.filter((row) => !existing.has(dedupeKey(row)));
      if (!fresh.length) throw new Error('Nenhum lançamento novo neste arquivo.');

      await store.createMany('transactions', fresh.map((row) => ({
        date: row.date,
        competence: competenceFor(row.date, accountId),
        description: row.description,
        amount: row.amount,
        kind: row.kind,
        category_id: row.kind === 'expense' ? categoryId : null,
        account_id: accountId,
      })));
      toast(`${fresh.length} lançamentos importados.`, 'success');
    },
  });
}

// --- utilidades -------------------------------------------------------

/** No mês corrente usa hoje; navegando no passado, o dia 1 daquele mês. */
function defaultDate() {
  const month = getMonth();
  const today = todayISO();
  return today.startsWith(month) ? today : `${month}-01`;
}

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
