// Metas de economia: progresso, aportes e ritmo necessário até o prazo.

import { el, field, iconButton, modal, confirmDialog, toast, empty } from '../dom.js';
import * as store from '../store.js';
import { state } from '../store.js';
import { goalProgress } from '../selectors.js';
import { brl, pct, dateBR, todayISO, parseMoney, round2 } from '../format.js';

export function render() {
  const goals = state.goals.filter((goal) => !goal.archived);
  const totals = goals.reduce((acc, goal) => {
    const progress = goalProgress(goal);
    acc.saved += progress.saved;
    acc.target += progress.target;
    return acc;
  }, { saved: 0, target: 0 });

  return el('div', { class: 'stack' },
    goals.length ? el('div', { class: 'grid grid-stats' },
      stat('Guardado', brl(totals.saved), 'income'),
      stat('Objetivo total', brl(totals.target)),
      stat('Falta', brl(Math.max(totals.target - totals.saved, 0)), null,
        totals.target > 0 ? `${pct((totals.saved / totals.target) * 100, 0)} concluído` : null)
    ) : null,

    el('div', { class: 'toolbar' },
      el('button', { class: 'btn btn-primary', onclick: () => openGoalForm() }, '+ Nova meta')
    ),

    goals.length
      ? el('div', { class: 'grid grid-2' }, ...goals.map(goalCard))
      : el('div', { class: 'card' },
          empty('Nenhuma meta ainda. Reserva de emergência, viagem, entrada do carro…',
            el('button', { class: 'btn btn-primary', onclick: () => openGoalForm() }, 'Criar a primeira')))
  );
}

function stat(label, value, tone, foot) {
  return el('div', { class: 'stat', dataset: tone ? { tone } : {} },
    el('div', { class: 'stat-label' }, label),
    el('div', { class: `stat-value ${tone || ''}` }, value),
    foot && el('div', { class: 'stat-foot' }, foot)
  );
}

function goalCard(goal) {
  const progress = goalProgress(goal);
  const tone = progress.done ? 'done' : progress.late ? 'over' : null;
  const contributions = state.contributions.filter((row) => row.goal_id === goal.id).slice(0, 4);

  return el('div', { class: 'card' },
    el('div', { class: 'card-head' },
      el('span', { class: 'dot', style: { background: goal.color } }),
      el('h2', {}, goal.name),
      iconButton('✎', 'Editar meta', () => openGoalForm(goal)),
      iconButton('🗑', 'Excluir meta', () => removeGoal(goal), 'danger')
    ),

    el('div', { class: 'budget-top' },
      el('span', { class: 'values num', style: { marginLeft: '0' } },
        el('strong', {}, brl(progress.saved)), ' de ', brl(progress.target))
    ),
    el('div', { class: 'bar', dataset: tone ? { tone } : {} },
      el('span', { style: { width: `${Math.min(progress.ratio, 1) * 100}%` } })
    ),
    el('div', { class: 'budget-foot' },
      el('span', {}, pct(progress.ratio * 100, 0), ' concluído'),
      el('span', { class: 'spacer' }),
      el('span', { class: progress.late ? 'neg' : '' }, statusText(goal, progress))
    ),

    contributions.length
      ? el('div', { class: 'stack', style: { marginTop: '.9rem' } },
          el('div', { class: 'section-title' }, 'Aportes'),
          ...contributions.map((row) => el('div', { class: 'rank-head' },
            el('span', { class: 'rank-name muted' }, dateBR(row.date), row.note ? ` · ${row.note}` : ''),
            el('span', { class: 'rank-value num' }, brl(row.amount)),
            iconButton('🗑', 'Excluir aporte', () => removeContribution(row), 'danger')
          ))
        )
      : null,

    el('div', { class: 'toolbar', style: { marginTop: '.9rem', marginBottom: 0 } },
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openContributionForm(goal) },
        'Registrar aporte')
    )
  );
}

function statusText(goal, progress) {
  if (progress.done) return 'meta atingida 🎉';
  if (!goal.target_date) return `faltam ${brl(progress.missing)}`;
  if (progress.late) return `venceu em ${dateBR(goal.target_date)}`;
  if (progress.monthsLeft === 0) return `vence este mês · ${brl(progress.missing)}`;
  return `${brl(progress.monthlyNeeded)}/mês por ${progress.monthsLeft} meses`;
}

// --- formulários -----------------------------------------------------

function openGoalForm(existing = null) {
  const editing = Boolean(existing);
  modal({
    title: editing ? `Editar ${existing.name}` : 'Nova meta',
    render: () => el('div', { class: 'form-grid' },
      field('Nome', el('input', {
        type: 'text', name: 'name', required: true, maxlength: '60',
        value: existing?.name ?? '', placeholder: 'Reserva de emergência',
      })),
      field('Valor alvo', el('input', {
        type: 'text', name: 'target_amount', required: true, inputmode: 'decimal',
        placeholder: '0,00',
        value: existing ? brl(existing.target_amount).replace('R$', '').trim() : '',
      })),
      field('Prazo', el('input', {
        type: 'date', name: 'target_date', value: existing?.target_date ?? '',
      }), 'Opcional — define o aporte mensal sugerido.'),
      field('Cor', el('input', {
        type: 'color', name: 'color', value: existing?.color ?? '#8b5cf6',
      }))
    ),
    onSubmit: async (data) => {
      const target = parseMoney(data.get('target_amount'));
      if (!Number.isFinite(target) || target <= 0) throw new Error('Informe um valor alvo maior que zero.');

      const row = {
        name: data.get('name').trim(),
        target_amount: round2(target),
        target_date: data.get('target_date') || null,
        color: data.get('color'),
      };
      if (editing) await store.update('goals', existing.id, row);
      else await store.create('goals', row);
      toast(editing ? 'Meta atualizada.' : 'Meta criada.', 'success');
    },
  });
}

function openContributionForm(goal) {
  modal({
    title: `Aporte em ${goal.name}`,
    render: () => el('div', { class: 'form-grid' },
      field('Data', el('input', { type: 'date', name: 'date', required: true, value: todayISO() })),
      field('Valor', el('input', {
        type: 'text', name: 'amount', required: true, inputmode: 'decimal', placeholder: '0,00',
      }), 'Negativo para registrar uma retirada.'),
      field('Observação', el('input', { type: 'text', name: 'note', maxlength: '80' }))
    ),
    onSubmit: async (data) => {
      const amount = parseMoney(data.get('amount'));
      if (!Number.isFinite(amount) || amount === 0) throw new Error('Informe um valor diferente de zero.');
      await store.create('contributions', {
        goal_id: goal.id,
        date: data.get('date'),
        amount: round2(amount),
        note: data.get('note').trim() || null,
      });
      toast('Aporte registrado.', 'success');
    },
  });
}

async function removeGoal(goal) {
  const ok = await confirmDialog({
    title: 'Excluir meta',
    message: `Excluir "${goal.name}" e todos os aportes registrados nela?`,
  });
  if (!ok) return;
  try {
    await store.remove('goals', goal.id);
    toast('Meta excluída.');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function removeContribution(row) {
  try {
    await store.remove('contributions', row.id);
    toast('Aporte excluído.');
  } catch (error) {
    toast(error.message, 'error');
  }
}
