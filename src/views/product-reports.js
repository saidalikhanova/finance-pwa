import { el, toast, formatMonth, shiftMonth, currentMonth } from '../ui.js';
import { formatMoney } from '../money.js';
import { formatQty } from '../items.js';
import { getSetting } from '../db.js';
import { listCategories } from '../repo/categories.js';
import { listOperations, monthRange } from '../repo/operations.js';
import { productReport, groupByCategory } from '../products-stats.js';
import { lastMonths } from '../reports.js';
import { buildItemsCsv, buildAnalysisPrompt } from '../csv.js';
import { shareOrDownload } from '../ics.js';

export const productReportState = { month: currentMonth(), view: 'products', sort: 'eur' };

/** @param {HTMLElement} root */
export async function renderProductReports(root) {
  const monthLabel = el('span', { class: 'month-label' }, formatMonth(productReportState.month));
  const body = el('div');
  root.append(
    el('div', { class: 'month-nav' },
      el('button', { class: 'icon-btn', 'aria-label': 'Предыдущий месяц', onclick: () => go(-1) }, '‹'),
      monthLabel,
      el('button', { class: 'icon-btn', 'aria-label': 'Следующий месяц', onclick: () => go(1) }, '›'),
    ),
    body,
  );

  /** @param {number} delta */
  function go(delta) {
    productReportState.month = shiftMonth(productReportState.month, delta);
    monthLabel.textContent = formatMonth(productReportState.month);
    refresh();
  }

  async function refresh() {
    const month = productReportState.month;
    const [categories, ops] = await Promise.all([listCategories({ includeArchived: true }), listOperations({})]);
    const catName = (/** @type {string} */ id) => categories.find((c) => c.id === id)?.name ?? 'Без категории';
    const overbuyPercent = Number((await getSetting('overbuyPercent')) ?? 30);
    const rows = productReport(ops, month, { overbuyPercent, sort: /** @type {any} */ (productReportState.sort) });
    body.innerHTML = '';

    const viewToggle = el('div', { class: 'segmented' });
    for (const [v, label] of [['products', 'По продуктам'], ['categories', 'По категориям']]) {
      const b = el('button', { type: 'button', class: v === productReportState.view ? 'active' : '', onclick: () => ((productReportState.view = v), refresh()) }, label);
      viewToggle.append(b);
    }
    const sortSelect = el('select', { class: 'select', 'aria-label': 'Сортировка', onchange: () => ((productReportState.sort = sortSelect.value), refresh()) },
      el('option', { value: 'eur' }, 'По сумме'), el('option', { value: 'qty' }, 'По количеству'));
    sortSelect.value = productReportState.sort;
    body.append(el('div', { class: 'filters' }, viewToggle, el('div', { class: 'filter-row', style: 'margin-top:8px' }, sortSelect)));

    if (!rows.length) {
      body.append(el('p', { class: 'muted' }, 'За этот месяц покупок с позициями нет. Позиции появляются из импорта чеков и из формы операции.'));
    } else if (productReportState.view === 'products') {
      const total = rows.reduce((s, r) => s + r.eur, 0);
      body.append(el('p', { class: 'muted small' }, `Продуктов: ${rows.length} · всего ${formatMoney(total, 'EUR')} · ⚠ — куплено на ${overbuyPercent} % больше среднего за прошлые месяцы`));
      const card = el('div', { class: 'card list-card' });
      for (const r of rows) card.append(productRow(r));
      body.append(card);
    } else {
      for (const [catId, g] of groupByCategory(rows)) {
        body.append(el('h2', { class: 'section-title' }, `${catName(catId)} — ${formatMoney(g.eur, 'EUR')}`));
        const card = el('div', { class: 'card list-card' });
        for (const r of g.products) card.append(productRow(r));
        body.append(card);
      }
    }

    body.append(
      el('div', { class: 'btn-row', style: 'margin-top:16px' },
        el('a', { class: 'btn btn-secondary', href: '#/forecast' }, 'Прогноз закупок'),
        el('a', { class: 'btn btn-secondary', href: '#/products' }, 'Справочник'),
      ),
    );

    // Экспорт для анализа (п. 4.13)
    const periodSelect = el('select', { class: 'select' },
      el('option', { value: '1' }, `Месяц: ${formatMonth(month)}`),
      el('option', { value: '3' }, 'Последние 3 месяца'),
      el('option', { value: 'all' }, 'Всё время'));
    body.append(
      el('h2', { class: 'section-title' }, 'Экспорт для анализа'),
      el('div', { class: 'card' },
        el('p', { class: 'small', style: 'margin:0 0 8px' }, 'Файл CSV: одна строка на каждую позицию покупки. Отправьте его в чат с Claude вместе с запросом.'),
        field2('Период', periodSelect),
        el('div', { class: 'btn-row' },
          el('button', { class: 'btn', type: 'button', onclick: () => exportCsv(periodSelect.value) }, 'Выгрузить CSV'),
          el('button', { class: 'btn btn-secondary', type: 'button', onclick: () => copyPrompt(periodSelect.value) }, 'Скопировать запрос'),
        ),
      ),
    );

    /** @param {string} period */
    function periodOps() {
      const p = periodSelect.value;
      if (p === 'all') return { ops, label: 'всё время' };
      const months = lastMonths(Number(p), month);
      const { from } = monthRange(months[0]);
      const { to } = monthRange(month);
      return { ops: ops.filter((o) => o.date >= from && o.date <= to), label: p === '1' ? formatMonth(month) : `${formatMonth(months[0])} — ${formatMonth(month)}` };
    }
    /** @param {string} _p */
    async function exportCsv(_p) {
      const { ops: sel, label } = periodOps();
      const csv = buildItemsCsv(sel, new Map(categories.map((c) => [c.id, c.name])));
      const lines = csv.split('\n').length - 2;
      if (lines <= 0) {
        toast('За выбранный период позиций нет', { error: true });
        return;
      }
      const r = await shareOrDownload(csv, `покупки-${month}${periodSelect.value === '1' ? '' : `-${periodSelect.value}`}.csv`, 'text/csv');
      if (r !== 'cancelled') toast(`Выгружено позиций: ${lines} (${label})`);
    }
    /** @param {string} _p */
    async function copyPrompt(_p) {
      const text = buildAnalysisPrompt(periodOps().label);
      try {
        await navigator.clipboard.writeText(text);
        toast('Запрос скопирован');
      } catch {
        const ta = el('textarea', { class: 'input textarea', rows: 8 }, text);
        body.append(ta);
        ta.select();
      }
    }

    /** @param {import('../products-stats.js').ProductRow} r */
    function productRow(r) {
      const sub = [`${formatQty(r.qty)} ${r.unit}`, `${formatMoney(r.avgPrice, 'EUR')}/${r.unit}`];
      if (r.prevQty != null) sub.push(`пред. мес.: ${formatQty(r.prevQty)} ${r.unit}`);
      if (r.wasted) sub.push(`выброшено ${formatQty(r.wasted)} ${r.unit}`);
      return el('a', { class: 'menu-row', href: `#/products/${r.key.startsWith('name:') ? '' : r.key}` },
        el('span', null, `${r.overbuy ? '⚠ ' : ''}${r.name}`, el('div', { class: `muted small${r.overbuy ? ' warn' : ''}` }, sub.join(' · '))),
        el('span', { class: 'row-amount' }, formatMoney(r.eur, 'EUR')),
      );
    }
  }
  await refresh();
}

/** @param {string} label @param {Node} control */
function field2(label, control) {
  return el('label', { class: 'field' }, el('span', { class: 'field-label' }, label), control);
}
