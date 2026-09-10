// Estado de interface compartilhado entre as telas: o mês de referência.
// Fica separado do store para não misturar dado com navegação.

import { currentMonth } from './format.js';

const STORAGE_KEY = 'financas.month';

let month = readStored();
const listeners = new Set();

function readStored() {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved && /^\d{4}-\d{2}$/.test(saved)) return saved;
  } catch { /* ignore */ }
  return currentMonth();
}

export function getMonth() {
  return month;
}

export function setMonth(next) {
  if (!/^\d{4}-\d{2}$/.test(next) || next === month) return;
  month = next;
  try { sessionStorage.setItem(STORAGE_KEY, month); } catch { /* ignore */ }
  for (const listener of listeners) listener(month);
}

export function onMonthChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}
