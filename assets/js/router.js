// Roteamento por hash — funciona em subpasta do GitHub Pages sem configuração.

import { el, clear } from './dom.js';
import * as dashboard from './views/dashboard.js';
import * as transactions from './views/transactions.js';
import * as budget from './views/budget.js';
import * as investments from './views/investments.js';
import * as goals from './views/goals.js';
import * as settings from './views/settings.js';

// `short` é o rótulo usado na barra inferior do celular, onde os seis cabem justos.
export const ROUTES = [
  { path: '', label: 'Visão geral', short: 'Visão', icon: '◈', view: dashboard, month: true },
  { path: 'lancamentos', label: 'Lançamentos', short: 'Lançar', icon: '≡', view: transactions, month: true },
  { path: 'orcamento', label: 'Orçamento', short: 'Orçam.', icon: '◑', view: budget, month: true },
  { path: 'investimentos', label: 'Investimentos', short: 'Carteira', icon: '▲', view: investments, month: false },
  { path: 'metas', label: 'Metas', short: 'Metas', icon: '★', view: goals, month: false },
  { path: 'ajustes', label: 'Ajustes', short: 'Ajustes', icon: '⚙', view: settings, month: false },
];

let container = null;
let onNavigate = null;

export function currentRoute() {
  const path = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  return ROUTES.find((route) => route.path === path) ?? ROUTES[0];
}

export function buildTabs(nav) {
  clear(nav);
  for (const route of ROUTES) {
    nav.append(el('a', {
      class: 'tab',
      href: `#/${route.path}`,
      title: route.label,
      dataset: { path: route.path },
    },
      el('span', { class: 'tab-icon', 'aria-hidden': 'true' }, route.icon),
      el('span', { class: 'tab-full' }, route.label),
      el('span', { class: 'tab-short', 'aria-hidden': 'true' }, route.short)
    ));
  }
}

/**
 * Leva a página ao topo ao trocar de tela.
 * Não usar scrollIntoView no container: ele fica abaixo do cabeçalho, e alinhar
 * o topo dele com o topo da janela empurra o cabeçalho para fora — a tela abre
 * já rolada. A segunda chamada, no quadro seguinte, cobre os navegadores que
 * reposicionam a rolagem depois do hashchange.
 */
function scrollToTop() {
  window.scrollTo(0, 0);
  requestAnimationFrame(() => window.scrollTo(0, 0));
}

function markActive(nav) {
  const active = currentRoute().path;
  for (const tab of nav.querySelectorAll('.tab')) {
    if (tab.dataset.path === active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
}

export function initRouter({ viewEl, navEl, onRender }) {
  container = viewEl;
  onNavigate = onRender;
  buildTabs(navEl);
  // Sem isto o navegador guarda a rolagem de cada entrada do histórico e a
  // devolve depois do hashchange, desfazendo o scroll para o topo.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  window.addEventListener('hashchange', () => {
    markActive(navEl);
    render(true);
    scrollToTop();
  });
  markActive(navEl);
  render(true);
}

/**
 * Redesenha a tela atual.
 * `animate` só é ligado em navegação (troca de aba ou de mês). O store dispara
 * este mesmo render a cada alteração de dado, e animar ali faria a tela piscar
 * inteira toda vez que um lançamento fosse salvo.
 */
export function render(animate = false) {
  if (!container) return;
  const route = currentRoute();
  clear(container);
  try {
    const view = route.view.render();
    // O nó é novo a cada render, então a animação sempre roda do começo.
    if (animate) view.classList.add('view-enter');
    container.append(view);
  } catch (error) {
    console.error(error);
    container.append(el('div', { class: 'empty' },
      el('p', {}, 'Algo quebrou ao desenhar esta tela.'),
      el('p', { class: 'small' }, error.message)
    ));
  }
  onNavigate?.(route);
}
