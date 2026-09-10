// Formatação e parsing em pt-BR / BRL.

const brlFmt = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numFmt = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const MONTHS = [
  'jan', 'fev', 'mar', 'abr', 'mai', 'jun',
  'jul', 'ago', 'set', 'out', 'nov', 'dez',
];

const MONTHS_LONG = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

export function brl(value) {
  return brlFmt.format(Number(value) || 0);
}

/** Compacto para eixos de gráfico: 1,2 mil / 3,4 mi. */
export function brlShort(value) {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  if (abs >= 1e6) return `R$ ${numFmt.format(n / 1e6).replace(',00', '')} mi`;
  if (abs >= 1e3) return `R$ ${numFmt.format(n / 1e3).replace(',00', '')} mil`;
  return brlFmt.format(n);
}

export function num(value, digits = 2) {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(Number(value) || 0);
}

export function pct(value, digits = 1) {
  const n = Number(value) || 0;
  return `${n.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

export function signedPct(value, digits = 1) {
  const n = Number(value) || 0;
  return (n > 0 ? '+' : '') + pct(n, digits);
}

// --- datas -----------------------------------------------------------
// Todas as datas trafegam como 'YYYY-MM-DD' (string), nunca como Date, para
// não escorregar um dia por causa de fuso horário.

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function currentMonth() {
  return todayISO().slice(0, 7);
}

/** 'YYYY-MM-DD' → '01/02/2026' */
export function dateBR(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** '01/02/2026' ou '2026-02-01' → 'YYYY-MM-DD' (ou null) */
export function parseDateBR(input) {
  if (!input) return null;
  const s = String(input).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (!m) return null;
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${pad(m[2])}-${pad(m[1])}`;
}

/** 'YYYY-MM' → 'fev/26' */
export function monthLabel(monthKey) {
  const [y, m] = monthKey.split('-');
  return `${MONTHS[Number(m) - 1]}/${y.slice(2)}`;
}

/** 'YYYY-MM' → 'Fevereiro de 2026' */
export function monthLabelLong(monthKey) {
  const [y, m] = monthKey.split('-');
  return `${MONTHS_LONG[Number(m) - 1]} de ${y}`;
}

/** 'YYYY-MM' → 'YYYY-MM-01' (competência sempre no dia 1) */
export function monthStart(monthKey) {
  return `${monthKey.slice(0, 7)}-01`;
}

/** Soma meses a 'YYYY-MM' ou 'YYYY-MM-DD', preservando o dia quando possível. */
export function addMonths(iso, delta) {
  const short = iso.length === 7;
  const [y, m, d] = `${iso}${short ? '-01' : ''}`.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1 + delta, 1));
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth() + 1;
  if (short) return `${year}-${pad(month)}`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(Math.min(d, lastDay))}`;
}

/** Lista de 'YYYY-MM' terminando no mês informado. */
export function lastMonths(count, endMonth = currentMonth()) {
  return Array.from({ length: count }, (_, i) =>
    addMonths(endMonth, i - count + 1)
  );
}

/** Dia seguro dentro do mês: dia 31 em fevereiro vira o último dia. */
export function clampDay(monthKey, day) {
  const [y, m] = monthKey.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${monthKey}-${pad(Math.min(day, lastDay))}`;
}

export function monthsBetween(fromISO, toISO) {
  const [y1, m1] = fromISO.split('-').map(Number);
  const [y2, m2] = toISO.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

// --- números ---------------------------------------------------------

/**
 * Aceita o que o usuário (ou o extrato do banco) digitar:
 * '1.234,56', '1234.56', 'R$ 1.234,56', '-45,90', '(45,90)'.
 */
export function parseMoney(input) {
  if (typeof input === 'number') return input;
  if (input == null) return NaN;
  let s = String(input).trim();
  if (!s) return NaN;

  const negative = s.startsWith('(') && s.endsWith(')');
  s = s.replace(/[()]/g, '').replace(/[R$\s ]/gi, '');

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) {
    // vírgula é o separador decimal (padrão pt-BR)
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
    s = s.replace(/,/g, '');
  } else {
    s = s.replace(/[.,]/g, '');
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return negative ? -n : n;
}

/** Arredonda para centavos sem o erro de ponto flutuante do toFixed direto. */
export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function pad(n) {
  return String(n).padStart(2, '0');
}
