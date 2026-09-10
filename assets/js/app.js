// Boot: autenticação → carga de dados → roteador.

import {
  configured, getSession, onAuthChange, signInWithPassword,
  signUpWithPassword, signInWithMagicLink, signOut,
} from './supabase.js';
import * as store from './store.js';
import { initRouter, render as renderRoute, currentRoute } from './router.js';
import { getMonth, setMonth, onMonthChange } from './ui-state.js';
import { monthLabelLong, addMonths, currentMonth } from './format.js';
import { toast, closeModal } from './dom.js';

const $ = (id) => document.getElementById(id);
const boot = $('boot');
const setupGate = $('setup');
const authGate = $('auth');
const appEl = $('app');

let started = false;

main();

async function main() {
  if (!configured) {
    boot.hidden = true;
    setupGate.hidden = false;
    return;
  }

  wireAuthForm();
  wireShell();

  const session = await getSession();
  cleanAuthHashFromUrl();

  if (session) await startApp(session);
  else showAuthGate();

  onAuthChange((next) => {
    if (next && !started) startApp(next);
    else if (!next && started) resetToLogin();
  });
}

/** O link mágico volta com #access_token=… — limpa antes do roteador ler o hash. */
function cleanAuthHashFromUrl() {
  if (window.location.hash.includes('access_token')) {
    history.replaceState(null, '', window.location.pathname + window.location.search + '#/');
  }
}

function showAuthGate() {
  boot.hidden = true;
  appEl.hidden = true;
  authGate.hidden = false;
}

async function startApp(session) {
  started = true;
  authGate.hidden = true;

  // Cache primeiro: a tela aparece preenchida antes da rede responder.
  const hadCache = store.loadCache(session.user.id);
  boot.hidden = true;
  appEl.hidden = false;

  initRouter({
    viewEl: $('view'),
    navEl: $('tabs'),
    onRender: (route) => { $('month-nav').hidden = !route.month; },
  });
  store.onChange(() => renderRoute());
  onMonthChange(() => { updateMonthLabel(); renderRoute(); });
  updateMonthLabel();

  setSync('syncing');
  try {
    await store.loadAll(session.user.id);
    const seeded = await store.ensureSeed();
    setSync('ok');
    if (seeded) toast('Categorias e contas iniciais criadas. Ajuste em Ajustes.', 'success');
  } catch (error) {
    setSync('error');
    console.error(error);
    toast(error.message, 'error');
    if (!hadCache) renderRoute();
  }
}

function resetToLogin() {
  started = false;
  store.clearLocal();
  closeModal();
  showAuthGate();
}

function setSync(state) {
  const dot = $('sync-dot');
  dot.dataset.state = state === 'ok' ? '' : state;
  dot.title = { ok: 'Sincronizado', syncing: 'Sincronizando…', error: 'Falha na sincronização' }[state];
}

// --- shell -----------------------------------------------------------

function wireShell() {
  const input = $('month-input');

  $('month-prev').addEventListener('click', () => setMonth(addMonths(getMonth(), -1)));
  $('month-next').addEventListener('click', () => setMonth(addMonths(getMonth(), 1)));
  $('month-current').addEventListener('click', () => {
    input.value = getMonth();
    if (typeof input.showPicker === 'function') input.showPicker();
    else input.click();
  });
  input.addEventListener('change', () => { if (input.value) setMonth(input.value); });

  $('logout').addEventListener('click', async () => {
    await signOut();
    resetToLogin();
  });

  // Atalhos: J/K trocam o mês quando o foco não está num campo.
  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) return;
    if (!currentRoute().month) return;
    if (event.key === 'j') setMonth(addMonths(getMonth(), -1));
    if (event.key === 'k') setMonth(addMonths(getMonth(), 1));
  });
}

function updateMonthLabel() {
  const month = getMonth();
  const button = $('month-current');
  button.textContent = monthLabelLong(month);
  button.classList.toggle('is-past', month !== currentMonth());
}

// --- login -----------------------------------------------------------

function wireAuthForm() {
  const form = $('auth-form');
  const error = $('auth-error');
  const info = $('auth-info');
  const submit = $('auth-submit');
  const signupBtn = $('auth-signup');
  const toggle = $('auth-toggle-magic');
  const passwordField = $('password-field');
  const passwordInput = passwordField.querySelector('input');
  let magicMode = false;

  const showError = (message) => {
    error.textContent = message;
    error.hidden = false;
    info.hidden = true;
  };
  const showInfo = (message) => {
    info.textContent = message;
    info.hidden = false;
    error.hidden = true;
  };

  toggle.addEventListener('click', () => {
    magicMode = !magicMode;
    passwordField.hidden = magicMode;
    passwordInput.required = !magicMode;
    signupBtn.hidden = magicMode;
    submit.textContent = magicMode ? 'Enviar link de acesso' : 'Entrar';
    toggle.textContent = magicMode ? 'Prefiro usar senha' : 'Prefiro receber um link por e-mail';
    error.hidden = true;
    info.hidden = true;
  });

  const run = async (button, action) => {
    const original = button.textContent;
    button.disabled = true;
    signupBtn.disabled = true;
    button.textContent = 'Aguarde…';
    try {
      await action();
    } catch (err) {
      showError(err.message);
    } finally {
      button.disabled = false;
      signupBtn.disabled = false;
      button.textContent = original;
    }
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const email = form.email.value.trim();
    run(submit, async () => {
      if (magicMode) {
        await signInWithMagicLink(email);
        showInfo('Link enviado. Abra o e-mail neste mesmo dispositivo.');
      } else {
        await signInWithPassword(email, passwordInput.value);
      }
    });
  });

  signupBtn.addEventListener('click', () => {
    const email = form.email.value.trim();
    if (!email || !passwordInput.value) {
      showError('Preencha e-mail e senha para criar a conta.');
      return;
    }
    run(signupBtn, async () => {
      const { needsConfirmation } = await signUpWithPassword(email, passwordInput.value);
      if (needsConfirmation) {
        showInfo('Conta criada. Confirme pelo link enviado ao seu e-mail e depois entre.');
      }
    });
  });
}
