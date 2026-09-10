// Helpers de DOM: criação de elementos, modal e toast.
// Nada de innerHTML com dado do usuário — tudo por textContent.

/**
 * el('div', {class: 'card', onclick: fn}, 'texto', outroEl)
 * Props especiais: class, dataset, style (objeto), html (confia no autor),
 * on* (listener). Filhos null/false/undefined são ignorados.
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value);
    } else if (key in node && key !== 'list') {
      node[key] = value;
    } else {
      node.setAttribute(key, value === true ? '' : value);
    }
  }

  append(node, children);
  return node;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === '') continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function $(selector, scope = document) {
  return scope.querySelector(selector);
}

// --- campos de formulário -------------------------------------------

export function field(label, control, hint) {
  return el('label', { class: 'field' },
    el('span', { class: 'field-label' }, label),
    control,
    hint && el('span', { class: 'field-hint' }, hint)
  );
}

export function select(options, { value, name, onchange, placeholder } = {}) {
  const node = el('select', { name, onchange });
  if (placeholder) node.append(el('option', { value: '' }, placeholder));
  for (const opt of options) {
    node.append(el('option', { value: opt.value, selected: String(opt.value) === String(value) }, opt.label));
  }
  if (value != null) node.value = String(value);
  return node;
}

export function iconButton(label, title, onclick, extraClass = '') {
  return el('button', {
    type: 'button',
    class: `icon-btn ${extraClass}`.trim(),
    title,
    'aria-label': title,
    onclick,
  }, label);
}

// --- modal ------------------------------------------------------------

let openDialog = null;

/**
 * Abre um modal com um <form>. `render(form)` devolve os campos.
 * `onSubmit(FormData, form)` pode ser async; lançar um Error mostra a
 * mensagem sem fechar o modal.
 */
export function modal({ title, submitLabel = 'Salvar', destructive = false, render, onSubmit, onClose, width }) {
  closeModal();

  const error = el('p', { class: 'modal-error', hidden: true });
  const submit = el('button', {
    type: 'submit',
    class: destructive ? 'btn btn-danger' : 'btn btn-primary',
  }, submitLabel);

  const form = el('form', {
    class: 'modal-form',
    onsubmit: async (event) => {
      event.preventDefault();
      error.hidden = true;
      submit.disabled = true;
      const original = submit.textContent;
      submit.textContent = 'Salvando…';
      try {
        await onSubmit(new FormData(form), form);
        closeModal();
      } catch (err) {
        error.textContent = err?.message || 'Não foi possível salvar.';
        error.hidden = false;
      } finally {
        submit.disabled = false;
        submit.textContent = original;
      }
    },
  });

  append(form, [render(form)]);
  form.append(error, el('div', { class: 'modal-actions' },
    el('button', { type: 'button', class: 'btn btn-ghost', onclick: closeModal }, 'Cancelar'),
    submit
  ));

  const dialog = el('dialog', { class: 'modal', style: width ? { '--modal-width': width } : null },
    el('header', { class: 'modal-header' },
      el('h2', {}, title),
      iconButton('×', 'Fechar', closeModal, 'modal-close')
    ),
    form
  );

  // Não dá para confiar no evento 'close' do <dialog>: em alguns ambientes ele
  // não dispara, e aí o modal ficava no DOM para sempre e quem esperava por ele
  // (o confirmDialog) nunca era avisado. A limpeza é chamada na mão e é
  // idempotente; o listener fica só para o Esc, que fecha por fora.
  let pendingClose = onClose;
  const cleanup = () => {
    if (openDialog === dialog) openDialog = null;
    dialog.remove();
    const callback = pendingClose;
    pendingClose = null;
    if (callback) callback();
  };
  dialog.cleanupModal = cleanup;

  dialog.addEventListener('close', cleanup);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeModal();
  });

  document.body.append(dialog);
  dialog.showModal();
  openDialog = dialog;

  const first = form.querySelector('input, select, textarea');
  if (first) first.focus();
  return dialog;
}

export function closeModal() {
  const dialog = openDialog;
  openDialog = null;
  if (!dialog) return;
  if (dialog.open) dialog.close();
  dialog.cleanupModal?.();
}

/** Confirmação destrutiva. Resolve para true/false. */
export function confirmDialog({ title, message, confirmLabel = 'Excluir' }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    modal({
      title,
      submitLabel: confirmLabel,
      destructive: true,
      render: () => el('p', { class: 'modal-message' }, message),
      onSubmit: async () => finish(true),
      onClose: () => finish(false),
    });
  });
}

// --- toast ------------------------------------------------------------

export function toast(message, kind = 'info') {
  const host = document.getElementById('toasts');
  if (!host) return;
  const node = el('div', { class: `toast toast-${kind}`, role: 'status' }, message);
  host.append(node);
  setTimeout(() => {
    node.classList.add('toast-out');
    setTimeout(() => node.remove(), 250);
  }, kind === 'error' ? 6000 : 3200);
}

export function empty(message, action) {
  return el('div', { class: 'empty' },
    el('p', {}, message),
    action || null
  );
}
