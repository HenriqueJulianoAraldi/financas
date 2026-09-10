// Carteira: ativos, negociações, atualização manual de preços e alocação.

import { el, field, select, iconButton, modal, confirmDialog, toast, empty } from '../dom.js';
import * as store from '../store.js';
import { state } from '../store.js';
import { portfolio, positionOf, ASSET_CLASSES, classLabel } from '../selectors.js';
import { brl, num, pct, signedPct, parseMoney, round2, todayISO, currentMonth, monthStart, dateBR } from '../format.js';

export function render() {
  const wallet = portfolio();

  return el('div', { class: 'stack' },
    el('div', { class: 'grid grid-stats' },
      stat('Posição atual', brl(wallet.total)),
      stat('Custo total', brl(wallet.cost)),
      stat('Resultado aberto', `${wallet.pnl >= 0 ? '+' : '−'} ${brl(Math.abs(wallet.pnl))}`,
        wallet.pnl >= 0 ? 'income' : 'danger',
        wallet.cost > 0 ? `${signedPct(wallet.pnlPct)} sobre o custo` : null),
      stat('Resultado realizado', `${wallet.realized >= 0 ? '+' : '−'} ${brl(Math.abs(wallet.realized))}`,
        wallet.realized >= 0 ? 'income' : 'danger', 'vendas já feitas')
    ),

    el('div', { class: 'toolbar' },
      el('button', { class: 'btn btn-primary', onclick: () => openAssetForm() }, '+ Novo ativo'),
      el('button', { class: 'btn btn-ghost', onclick: () => openTradeForm() }, 'Registrar compra/venda'),
      el('button', { class: 'btn btn-ghost', onclick: () => openPriceUpdate(wallet) }, 'Atualizar preços'),
      el('span', { class: 'spacer' }),
      wallet.total > 0 && el('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: () => saveSnapshot(wallet.total),
      }, 'Registrar patrimônio do mês')
    ),

    allocationCard(wallet),
    assetsCard(wallet),
    tradesCard()
  );
}

function stat(label, value, tone, foot) {
  return el('div', { class: 'stat', dataset: tone ? { tone } : {} },
    el('div', { class: 'stat-label' }, label),
    el('div', { class: `stat-value ${tone || ''}` }, value),
    foot && el('div', { class: 'stat-foot' }, foot)
  );
}

// --- alocação --------------------------------------------------------

function allocationCard(wallet) {
  if (!wallet.classes.length) return null;
  const max = Math.max(...wallet.classes.map((bucket) => bucket.value));

  return el('div', { class: 'card' },
    el('div', { class: 'card-head' },
      el('h2', {}, 'Alocação por classe'),
      el('span', { class: 'muted small' }, brl(wallet.total))
    ),
    el('div', { class: 'ranks' }, ...wallet.classes.map((bucket) =>
      el('div', { class: 'rank-row' },
        el('div', { class: 'rank-head' },
          el('span', { class: 'rank-name' }, bucket.label),
          el('span', { class: 'rank-value num' }, brl(bucket.value)),
          el('span', { class: 'rank-share num dim' }, pct(bucket.weight, 0))
        ),
        el('div', { class: 'bar' },
          el('span', { style: { width: `${max > 0 ? (bucket.value / max) * 100 : 0}%` } })
        )
      )
    ))
  );
}

// --- ativos ----------------------------------------------------------

function assetsCard(wallet) {
  if (!wallet.rows.length) {
    return el('div', { class: 'card' },
      empty('Nenhum ativo na carteira.',
        el('button', { class: 'btn btn-primary', onclick: () => openAssetForm() }, 'Cadastrar o primeiro'))
    );
  }

  return el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('h2', {}, 'Ativos')),
    el('div', { class: 'table-wrap' },
      el('table', {},
        el('thead', {}, el('tr', {},
          el('th', {}, 'Ativo'),
          el('th', { class: 'num' }, 'Qtd.'),
          el('th', { class: 'num' }, 'Preço médio'),
          el('th', { class: 'num' }, 'Preço atual'),
          el('th', { class: 'num' }, 'Posição'),
          el('th', { class: 'num' }, 'Resultado'),
          el('th', { class: 'num' }, '% carteira'),
          el('th', {}, '')
        )),
        el('tbody', {}, ...wallet.rows.map(assetRow))
      )
    )
  );
}

function assetRow(row) {
  const stale = !row.asset.price_updated_at;
  return el('tr', {},
    el('td', {},
      el('div', { class: 'cell-main' }, row.asset.ticker),
      el('div', { class: 'cell-sub' }, row.asset.name || classLabel(row.asset.asset_class))
    ),
    el('td', { class: 'num' }, num(row.quantity, 8)),
    el('td', { class: 'num' }, brl(row.avgPrice)),
    el('td', { class: `num ${stale ? 'dim' : ''}` }, brl(row.price)),
    el('td', { class: 'num' }, brl(row.value)),
    el('td', { class: `num ${row.pnl >= 0 ? 'pos' : 'neg'}` },
      `${row.pnl >= 0 ? '+' : '−'} ${brl(Math.abs(row.pnl))}`,
      el('div', { class: 'cell-sub' }, row.cost > 0 ? signedPct(row.pnlPct) : '—')
    ),
    el('td', { class: 'num' }, pct(row.weight, 1)),
    el('td', { class: 'actions' },
      iconButton('+', 'Registrar negociação', () => openTradeForm(row.asset)),
      iconButton('✎', 'Editar ativo', () => openAssetForm(row.asset)),
      iconButton('🗑', 'Excluir ativo', () => removeAsset(row.asset), 'danger')
    )
  );
}

function tradesCard() {
  const trades = state.trades.slice(0, 12);
  if (!trades.length) return null;
  const assets = new Map(state.assets.map((asset) => [asset.id, asset]));

  return el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('h2', {}, 'Últimas negociações')),
    el('div', { class: 'table-wrap' },
      el('table', {},
        el('thead', {}, el('tr', {},
          el('th', {}, 'Data'), el('th', {}, 'Ativo'), el('th', {}, 'Operação'),
          el('th', { class: 'num' }, 'Qtd.'), el('th', { class: 'num' }, 'Preço'),
          el('th', { class: 'num' }, 'Total'), el('th', {}, '')
        )),
        el('tbody', {}, ...trades.map((trade) => el('tr', {},
          el('td', { class: 'num' }, dateBR(trade.date)),
          el('td', {}, assets.get(trade.asset_id)?.ticker ?? '—'),
          el('td', {}, el('span', { class: `chip ${trade.side === 'buy' ? '' : 'neg'}` },
            trade.side === 'buy' ? 'Compra' : 'Venda')),
          el('td', { class: 'num' }, num(trade.quantity, 8)),
          el('td', { class: 'num' }, brl(trade.price)),
          el('td', { class: 'num' },
            brl(Number(trade.quantity) * Number(trade.price) + Number(trade.fees || 0))),
          el('td', { class: 'actions' },
            iconButton('🗑', 'Excluir negociação', () => removeTrade(trade), 'danger'))
        )))
      )
    )
  );
}

// --- formulários -----------------------------------------------------

function openAssetForm(existing = null) {
  const editing = Boolean(existing);
  modal({
    title: editing ? `Editar ${existing.ticker}` : 'Novo ativo',
    render: () => el('div', { class: 'form-grid' },
      field('Ticker / código', el('input', {
        type: 'text', name: 'ticker', required: true, maxlength: '24',
        value: existing?.ticker ?? '', placeholder: 'PETR4, BTC, CDB Banco X',
        style: { textTransform: 'uppercase' },
      })),
      field('Classe', select(ASSET_CLASSES, {
        name: 'asset_class', value: existing?.asset_class ?? 'acao',
      })),
      field('Nome (opcional)', el('input', {
        type: 'text', name: 'name', maxlength: '80', value: existing?.name ?? '',
      })),
      field('Preço atual', el('input', {
        type: 'text', name: 'current_price', inputmode: 'decimal', placeholder: '0,00',
        value: existing?.current_price ? String(existing.current_price).replace('.', ',') : '',
      }), 'Você atualiza quando quiser.'),
      field('Alvo na carteira (%)', el('input', {
        type: 'number', name: 'target_pct', min: '0', max: '100', step: '0.5',
        value: existing?.target_pct ?? '',
      }), 'Opcional.')
    ),
    onSubmit: async (data) => {
      const price = data.get('current_price').trim();
      const parsedPrice = price ? parseMoney(price) : 0;
      if (price && !Number.isFinite(parsedPrice)) throw new Error('Preço inválido.');

      const row = {
        ticker: data.get('ticker').trim().toUpperCase(),
        name: data.get('name').trim() || null,
        asset_class: data.get('asset_class'),
        current_price: parsedPrice || 0,
        price_updated_at: parsedPrice ? new Date().toISOString() : existing?.price_updated_at ?? null,
        target_pct: data.get('target_pct') ? Number(data.get('target_pct')) : null,
      };

      if (editing) await store.update('assets', existing.id, row);
      else await store.create('assets', row);
      toast(editing ? 'Ativo atualizado.' : 'Ativo cadastrado.', 'success');
    },
  });
}

function openTradeForm(asset = null) {
  if (!state.assets.length) {
    toast('Cadastre um ativo antes de registrar negociações.', 'error');
    return;
  }

  const totalPreview = el('p', { class: 'muted small', style: { margin: 0 } }, 'Total: —');

  modal({
    title: 'Registrar negociação',
    render: (form) => {
      const recalc = () => {
        const quantity = parseMoney(form.quantity.value);
        const price = parseMoney(form.price.value);
        const fees = parseMoney(form.fees.value) || 0;
        const valid = Number.isFinite(quantity) && Number.isFinite(price);
        totalPreview.textContent = valid
          ? `Total: ${brl(quantity * price + (form.side.value === 'buy' ? fees : -fees))}`
          : 'Total: —';
      };

      const wrap = el('div', { class: 'stack' },
        el('div', { class: 'form-grid' },
          field('Ativo', select(
            state.assets.map((item) => ({ value: item.id, label: item.ticker })),
            { name: 'asset_id', value: asset?.id ?? state.assets[0].id }
          )),
          field('Operação', select(
            [{ value: 'buy', label: 'Compra' }, { value: 'sell', label: 'Venda' }],
            { name: 'side', value: 'buy', onchange: recalc }
          )),
          field('Data', el('input', { type: 'date', name: 'date', required: true, value: todayISO() })),
          field('Quantidade', el('input', {
            type: 'text', name: 'quantity', required: true, inputmode: 'decimal',
            placeholder: '100', oninput: recalc,
          })),
          field('Preço unitário', el('input', {
            type: 'text', name: 'price', required: true, inputmode: 'decimal',
            placeholder: '0,00', oninput: recalc,
          })),
          field('Taxas', el('input', {
            type: 'text', name: 'fees', inputmode: 'decimal', placeholder: '0,00', oninput: recalc,
          }))
        ),
        totalPreview
      );
      return wrap;
    },
    onSubmit: async (data) => {
      const quantity = parseMoney(data.get('quantity'));
      const price = parseMoney(data.get('price'));
      const fees = data.get('fees').trim() ? parseMoney(data.get('fees')) : 0;
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Quantidade inválida.');
      if (!Number.isFinite(price) || price < 0) throw new Error('Preço inválido.');

      const assetId = data.get('asset_id');
      if (data.get('side') === 'sell') {
        const held = positionOf(assetId).quantity;
        if (quantity > held + 1e-9) {
          throw new Error(`Você tem ${num(held, 8)} em carteira — não dá para vender ${num(quantity, 8)}.`);
        }
      }

      await store.create('trades', {
        asset_id: assetId,
        date: data.get('date'),
        side: data.get('side'),
        quantity,
        price,
        fees: round2(fees) || 0,
      });
      toast('Negociação registrada.', 'success');
    },
  });
}

/** Edita o preço de todos os ativos numa tela só e grava o patrimônio do mês. */
function openPriceUpdate(wallet) {
  const rows = wallet.rows.filter((row) => row.quantity > 0);
  if (!rows.length) {
    toast('Nenhum ativo com posição aberta.', 'error');
    return;
  }

  modal({
    title: 'Atualizar preços',
    width: '520px',
    render: () => el('div', { class: 'stack' },
      el('p', { class: 'muted small', style: { margin: 0 } },
        'Ao salvar, o patrimônio do mês atual também é registrado para o gráfico de evolução.'),
      ...rows.map((row) => field(
        `${row.asset.ticker} · ${num(row.quantity, 8)} un.`,
        el('input', {
          type: 'text', name: row.asset.id, inputmode: 'decimal',
          value: String(row.price ?? 0).replace('.', ','),
        })
      ))
    ),
    onSubmit: async (data) => {
      let changed = 0;
      for (const row of rows) {
        const raw = (data.get(row.asset.id) || '').trim();
        if (!raw) continue;
        const price = parseMoney(raw);
        if (!Number.isFinite(price) || price < 0) {
          throw new Error(`Preço inválido em ${row.asset.ticker}.`);
        }
        if (Math.abs(price - row.price) < 1e-9) continue;
        await store.update('assets', row.asset.id, {
          current_price: price,
          price_updated_at: new Date().toISOString(),
        });
        changed += 1;
      }
      await store.upsertSnapshot(monthStart(currentMonth()), portfolio().total);
      toast(changed ? `${changed} preço(s) atualizado(s).` : 'Patrimônio do mês registrado.', 'success');
    },
  });
}

async function saveSnapshot(total) {
  try {
    await store.upsertSnapshot(monthStart(currentMonth()), total);
    toast('Patrimônio do mês registrado.', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function removeAsset(asset) {
  const ok = await confirmDialog({
    title: 'Excluir ativo',
    message: `Excluir ${asset.ticker}? As negociações registradas nele também somem.`,
  });
  if (!ok) return;
  try {
    await store.remove('assets', asset.id);
    toast('Ativo excluído.');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function removeTrade(trade) {
  const ok = await confirmDialog({
    title: 'Excluir negociação',
    message: 'O preço médio e a posição serão recalculados.',
  });
  if (!ok) return;
  try {
    await store.remove('trades', trade.id);
    toast('Negociação excluída.');
  } catch (error) {
    toast(error.message, 'error');
  }
}
