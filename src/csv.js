// Экспорт позиций покупок в CSV (UTF-8) и текст запроса на анализ для Claude.

import { amountToInput } from './money.js';
import { formatQty } from './items.js';
import { flattenItems } from './products-stats.js';

export const CSV_COLUMNS = ['дата', 'магазин', 'продукт', 'категория', 'количество', 'единица', 'цена_за_единицу', 'сумма', 'валюта', 'сумма_eur', 'выброшено', 'id_покупки'];

/** @param {unknown} v */
function cell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Строит CSV: одна строка на позицию. В начале — BOM, чтобы Excel распознал UTF-8.
 * @param {import('./repo/operations.js').Operation[]} ops
 * @param {Map<string, string>} categoryNames
 */
export function buildItemsCsv(ops, categoryNames) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const f of flattenItems(ops).sort((a, b) => (a.op.date < b.op.date ? -1 : a.op.date > b.op.date ? 1 : 0))) {
    lines.push(
      [
        f.op.date,
        f.op.store,
        f.item.name,
        categoryNames.get(f.item.categoryId) ?? '',
        formatQty(f.item.qty).replace(',', '.'),
        f.item.unit,
        f.item.price ? amountToInput(f.item.price).replace(',', '.') : '',
        amountToInput(f.item.sum).replace(',', '.'),
        f.op.currency,
        f.eur == null ? '' : amountToInput(f.eur).replace(',', '.'),
        f.item.wasted ? formatQty(f.item.wasted).replace(',', '.') : '',
        f.op.id,
      ]
        .map(cell)
        .join(','),
    );
  }
  return '﻿' + lines.join('\n') + '\n';
}

/**
 * Текст запроса на анализ для Claude (п. 4.13 ТЗ).
 * @param {string} periodLabel
 */
export function buildAnalysisPrompt(periodLabel) {
  return [
    `Прилагаю файл CSV с позициями всех моих покупок за период: ${periodLabel}.`,
    'Столбцы: дата, магазин, продукт, категория, количество, единица, цена за единицу, сумма в исходной валюте, валюта, сумма в евро, выброшено (количество, которое не использовали), идентификатор покупки.',
    '',
    'Проанализируй и ответь по пунктам, с цифрами в евро:',
    '1. На что уходит больше всего денег — по категориям и по продуктам (топ-10).',
    '2. Какие продукты покупаются чаще или в большем количестве, чем обычно (сравни месяцы между собой).',
    '3. Где выросла цена за единицу — продукт, магазин, насколько.',
    '4. Что выбрасывается и сколько это стоит; что можно покупать меньше.',
    '5. Что можно сократить без потери качества жизни — конкретные предложения с ожидаемой экономией в месяц.',
    '6. Прогноз закупок на следующий месяц: перечень продуктов с количеством и ориентировочной стоимостью, итог по категориям.',
    '',
    'Ответ — кратко, таблицами там, где уместно, на русском языке.',
  ].join('\n');
}
