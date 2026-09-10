// Gráficos em canvas (Chart.js). Rankings e alocação são desenhados em HTML
// nas views — barra com rótulo direto lê melhor que rosca.
//
// A paleta abaixo foi validada para o fundo escuro #17141f: faixa de
// luminosidade, croma mínimo, separação sob daltonismo (protan/deutan/tritan)
// e contraste contra a superfície.

import { brl, brlShort, monthLabel } from './format.js';

export const CHART_COLORS = {
  income: '#34a87b',
  expense: '#bd8420',
  series: '#8b5cf6',
  surface: '#17141f',
  grid: 'rgba(255, 255, 255, 0.06)',
  tick: '#6f6786',
  text: '#a79fbb',
};

let ChartLib = null;
const active = new Set();

async function lib() {
  if (!ChartLib) {
    const module = await import('https://cdn.jsdelivr.net/npm/chart.js@4.4.4/auto/+esm');
    ChartLib = module.default ?? module.Chart;
    ChartLib.defaults.font.family =
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ChartLib.defaults.font.size = 11;
    ChartLib.defaults.color = CHART_COLORS.tick;
    ChartLib.defaults.animation.duration = 350;
  }
  return ChartLib;
}

/** Destrói os gráficos da tela anterior — a view é redesenhada por inteiro. */
export function destroyAll() {
  for (const chart of active) chart.destroy();
  active.clear();
}

/** Só instancia quando o canvas já está no documento e tem largura. */
function mount(canvas, factory) {
  const tick = () => {
    if (!canvas.isConnected) return;
    if (!canvas.clientWidth) { requestAnimationFrame(tick); return; }
    factory().then((chart) => {
      if (!canvas.isConnected) { chart.destroy(); return; }
      active.add(chart);
    }).catch((error) => {
      console.error(error);
      canvas.replaceWith(fallbackMessage());
    });
  };
  requestAnimationFrame(tick);
}

function fallbackMessage() {
  const node = document.createElement('p');
  node.className = 'muted small';
  node.textContent = 'Não foi possível carregar o gráfico (sem conexão com o CDN).';
  return node;
}

const tooltipStyle = {
  backgroundColor: '#262034',
  borderColor: '#3b3352',
  borderWidth: 1,
  titleColor: '#f2eff8',
  bodyColor: '#a79fbb',
  padding: 10,
  cornerRadius: 8,
  displayColors: true,
  boxWidth: 8,
  boxHeight: 8,
  boxPadding: 4,
};

/** Receitas × despesas por mês. Duas séries → legenda sempre presente. */
export function monthlyBars(canvas, series) {
  mount(canvas, async () => {
    const Chart = await lib();
    return new Chart(canvas, {
      type: 'bar',
      data: {
        labels: series.map((row) => monthLabel(row.month)),
        datasets: [
          {
            label: 'Receitas',
            data: series.map((row) => row.income),
            backgroundColor: CHART_COLORS.income,
            borderRadius: 4,
            borderSkipped: 'bottom',
            // 2px da cor da superfície separam barras vizinhas
            borderColor: CHART_COLORS.surface,
            borderWidth: { top: 0, right: 1, bottom: 0, left: 1 },
          },
          {
            label: 'Despesas',
            data: series.map((row) => row.expense),
            backgroundColor: CHART_COLORS.expense,
            borderRadius: 4,
            borderSkipped: 'bottom',
            borderColor: CHART_COLORS.surface,
            borderWidth: { top: 0, right: 1, bottom: 0, left: 1 },
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'top',
            align: 'end',
            labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: 'circle', color: CHART_COLORS.text },
          },
          tooltip: {
            ...tooltipStyle,
            callbacks: { label: (item) => ` ${item.dataset.label}: ${brl(item.raw)}` },
          },
        },
        scales: {
          x: { grid: { display: false }, border: { color: CHART_COLORS.grid } },
          y: {
            beginAtZero: true,
            grid: { color: CHART_COLORS.grid },
            border: { display: false },
            ticks: { callback: (value) => brlShort(value) },
          },
        },
      },
    });
  });
}

/** Evolução do patrimônio. Série única → sem legenda; o título nomeia a série. */
export function equityLine(canvas, series) {
  mount(canvas, async () => {
    const Chart = await lib();
    return new Chart(canvas, {
      type: 'line',
      data: {
        labels: series.map((row) => monthLabel(row.month)),
        datasets: [{
          label: 'Patrimônio',
          data: series.map((row) => row.value),
          borderColor: CHART_COLORS.series,
          borderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: CHART_COLORS.series,
          pointBorderColor: CHART_COLORS.surface,
          pointBorderWidth: 2,
          tension: 0.25,
          spanGaps: true,
          fill: {
            target: 'origin',
            above: 'rgba(139, 92, 246, 0.10)',
          },
        }],
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipStyle,
            displayColors: false,
            callbacks: { label: (item) => ` ${brl(item.raw)}` },
          },
        },
        scales: {
          x: { grid: { display: false }, border: { color: CHART_COLORS.grid } },
          y: {
            grid: { color: CHART_COLORS.grid },
            border: { display: false },
            ticks: { callback: (value) => brlShort(value) },
          },
        },
      },
    });
  });
}
