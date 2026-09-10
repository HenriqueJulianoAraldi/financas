// Leitura de extratos em CSV. Extrato de banco brasileiro costuma vir com
// separador ";", decimal com vírgula e data dd/mm/aaaa — tudo tratado aqui.

import { parseMoney, parseDateBR } from './format.js';

const DELIMITERS = [';', ',', '\t', '|'];

/** Descobre o separador pela linha de cabeçalho (o que mais aparece fora de aspas). */
function detectDelimiter(firstLine) {
  let best = ';';
  let bestCount = 0;
  for (const delimiter of DELIMITERS) {
    const count = splitLine(firstLine, delimiter).length;
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

/** Divide uma linha respeitando aspas duplas e o escape "" dentro delas. */
function splitLine(line, delimiter) {
  const cells = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') { cell += '"'; i += 1; }
        else quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells.map((value) => value.trim());
}

/** Quebra o texto em linhas lógicas (uma célula entre aspas pode ter \n). */
function splitRecords(text) {
  const records = [];
  let record = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      quoted = !quoted;
      record += char;
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      if (record.trim()) records.push(record);
      record = '';
    } else {
      record += char;
    }
  }
  if (record.trim()) records.push(record);
  return records;
}

/**
 * @returns {{headers: string[], rows: string[][], delimiter: string}}
 */
export function parseCSV(text) {
  const clean = text.replace(/^﻿/, '');
  const records = splitRecords(clean);
  if (!records.length) throw new Error('O arquivo está vazio.');

  const delimiter = detectDelimiter(records[0]);
  const all = records.map((line) => splitLine(line, delimiter));
  const width = Math.max(...all.map((row) => row.length));
  const normalized = all.map((row) => [...row, ...Array(width - row.length).fill('')]);

  const headers = normalized[0].map((header, index) => header || `Coluna ${index + 1}`);
  return { headers, rows: normalized.slice(1), delimiter };
}

const PATTERNS = {
  date: /(data|date|dia|lan[çc]amento|compet)/i,
  description: /(descri|hist[óo]rico|lan[çc]amento|estabelec|memo|detalhe|t[íi]tulo)/i,
  amount: /(valor|amount|montante|quantia|cr[ée]dito|d[ée]bito|r\$)/i,
  category: /(categoria|category|classific)/i,
};

/** Palpite inicial de qual coluna é o quê, por nome e depois por conteúdo. */
export function guessMapping(headers, rows) {
  const mapping = { date: -1, description: -1, amount: -1, category: -1 };

  for (const [field, pattern] of Object.entries(PATTERNS)) {
    mapping[field] = headers.findIndex((header) => pattern.test(header));
  }

  const sample = rows.slice(0, 12);
  const scoreColumn = (index, test) =>
    sample.filter((row) => test(row[index])).length / Math.max(sample.length, 1);

  if (mapping.date < 0) {
    mapping.date = headers.findIndex((_, i) => scoreColumn(i, (v) => parseDateBR(v) != null) > 0.6);
  }
  if (mapping.amount < 0) {
    mapping.amount = headers.findIndex((_, i) =>
      i !== mapping.date && scoreColumn(i, (v) => v && Number.isFinite(parseMoney(v))) > 0.6);
  }
  if (mapping.description < 0) {
    mapping.description = headers.findIndex((_, i) =>
      i !== mapping.date && i !== mapping.amount &&
      scoreColumn(i, (v) => v && !Number.isFinite(parseMoney(v))) > 0.5);
  }
  return mapping;
}

/**
 * Converte as linhas cruas em lançamentos prontos.
 * Valor negativo vira despesa; positivo, receita — salvo se `forceKind` mandar.
 */
export function buildRows(rows, mapping, { forceKind = null, invertSign = false } = {}) {
  const parsed = [];
  const skipped = [];

  rows.forEach((row, index) => {
    const rawDate = mapping.date >= 0 ? row[mapping.date] : '';
    const rawAmount = mapping.amount >= 0 ? row[mapping.amount] : '';
    const date = parseDateBR(rawDate);
    let amount = parseMoney(rawAmount);

    if (!date || !Number.isFinite(amount) || amount === 0) {
      skipped.push({ line: index + 2, reason: !date ? 'data inválida' : 'valor inválido' });
      return;
    }
    if (invertSign) amount = -amount;

    parsed.push({
      date,
      description: (mapping.description >= 0 ? row[mapping.description] : '').trim() || 'Importado',
      amount: Math.abs(amount),
      kind: forceKind ?? (amount < 0 ? 'expense' : 'income'),
      sourceCategory: mapping.category >= 0 ? row[mapping.category]?.trim() : '',
    });
  });

  return { parsed, skipped };
}

/** Chave de deduplicação: mesma data, mesmo valor e mesma descrição. */
export function dedupeKey({ date, amount, description }) {
  return [
    date,
    Number(amount).toFixed(2),
    String(description).toLowerCase().replace(/\s+/g, ' ').trim(),
  ].join('|');
}
