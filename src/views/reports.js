import { el, emptyState, formatMonth, shiftMonth, currentMonth } from '../ui.js';
import { formatMoney } from '../money.js';
import { listCategories } from '../repo/categories.js';
import { listOperations, monthRange } from '../repo/operations.js';
import { summary, expensesByCategory, lastMonths, monthlySeries } from '../reports.js';

const DYNAMICS_MONTHS = 12;

export const reportsState = { month: currentMonth() };

/** @param {HTMLElement} root */
export async function renderReports(root) {
  const monthLabel = el('span', { class: 'month-label' }, formatMonth(reportsState.month));
  const body = el('div');
  root.append(
    el(
      'div',
      { class: 'month-nav' },
      el('button', { class: 'icon-btn', 'aria-label': 'Предыдущий месяц', onclick: () => go(-1) }, '‹'),
      monthLabel,
      el('button', { class: 'icon-btn', 'aria-label': 'Следующий месяц', onclick: () => go(1) }, '›'),
    ),
    body,
  );

  /** @param {number} delta */
  function go(delta) {
    reportsState.month = shiftMonth(reportsState.month, delta);
    monthLabel.textContent = formatMonth(reportsState.month);
    refresh();
  }

  async function refresh() {
    const month = reportsState.month;
    const [categories, monthOps, allOps] = await Promise.all([
      listCategories({ includeArchived: true }),
      listOperations(monthRange(month)),
      listOperations({}),
    ]);
    const byId = new Map(categories.map((c) => [c.id, c]));
    body.innerHTML = '';

    // 1. Итоги за месяц
    const s = summary(monthOps);
    body.append(
      el(
        'div',
        { class: 'card tiles' },
        tile('Доходы', s.income, 'income'),
        tile('Расходы', s.expense),
        tile('Баланс', s.balance, s.balance < 0 ? 'over' : '', true),
      ),
    );
    if (s.unknownRate) body.append(el('p', { class: 'muted small' }, `Операций без курса: ${s.unknownRate} — в итоги не входят.`));

    // 2. Расходы по категориям: диаграмма (полосы) и таблица
    body.append(el('h2', { class: 'section-title' }, 'Расходы по категориям'));
    const rows = expensesByCategory(monthOps, byId);
    if (!rows.length) {
      body.append(emptyState('basket', 'За этот месяц расходов нет', 'Добавить расход', '#/add'));
    } else {
      const max = rows[0].amount;
      const table = el('div', { class: 'card bars' });
      for (const r of rows) {
        table.append(
          el(
            'a',
            { class: 'bar-row', href: `#/operations?month=${month}&category=${r.categoryId}`, title: `${r.name}: ${formatMoney(r.amount, 'EUR')} (${r.share} %)` },
            el('div', { class: 'bar-row-head' }, el('span', null, r.name), el('span', { class: 'bar-row-amount' }, formatMoney(r.amount, 'EUR'), el('span', { class: 'muted small' }, ` ${r.share} %`))),
            el('div', { class: 'hbar' }, el('div', { class: 'hbar-fill', style: `width:${Math.max(1, (r.amount * 100) / max)}%` })),
          ),
        );
      }
      body.append(table);
    }

    body.append(el('div', { class: 'btn-row' }, el('a', { class: 'btn btn-secondary', href: '#/product-reports' }, 'Отчёт по продуктам'), el('a', { class: 'btn btn-secondary', href: '#/forecast' }, 'Прогноз закупок')));

    // 3. Динамика по месяцам
    body.append(el('h2', { class: 'section-title' }, `Динамика за ${DYNAMICS_MONTHS} месяцев`));
    const months = lastMonths(DYNAMICS_MONTHS, month);
    const series = monthlySeries(allOps, months);
    if (!series.some((m) => m.income || m.expense)) {
      body.append(el('p', { class: 'muted' }, 'Пока нет данных.'));
    } else {
      body.append(el('div', { class: 'card' }, columnChart(series), legend()));
      const t = el('table', { class: 'table' });
      t.append(
        el('thead', null, el('tr', null, el('th', null, 'Месяц'), el('th', { class: 'num' }, 'Доходы'), el('th', { class: 'num' }, 'Расходы'), el('th', { class: 'num' }, 'Баланс'))),
        el(
          'tbody',
          null,
          ...series
            .filter((m) => m.income || m.expense)
            .reverse()
            .map((m) =>
              el(
                'tr',
                null,
                el('td', null, `${monthShort(m.month).split(' ')[0]} ${m.month.slice(0, 4)}`),
                el('td', { class: 'num income' }, formatMoney(m.income, 'EUR')),
                el('td', { class: 'num' }, formatMoney(m.expense, 'EUR')),
                el('td', { class: `num${m.balance < 0 ? ' over' : ''}` }, formatMoney(m.balance, 'EUR', { sign: true })),
              ),
            ),
        ),
      );
      body.append(el('div', { class: 'card list-card' }, t));
    }
  }

  await refresh();
}

/**
 * @param {string} label
 * @param {number} value
 * @param {string} [cls]
 * @param {boolean} [signed]
 */
function tile(label, value, cls = '', signed = false) {
  return el('div', { class: 'tile' }, el('div', { class: 'muted small' }, label), el('div', { class: `tile-value ${cls}` }, formatMoney(value, 'EUR', { sign: signed })));
}

function legend() {
  return el(
    'div',
    { class: 'legend' },
    el('span', null, el('i', { class: 'swatch swatch-income' }), 'Доходы'),
    el('span', null, el('i', { class: 'swatch swatch-expense' }), 'Расходы'),
  );
}

/**
 * Столбчатая диаграмма доходов и расходов по месяцам (SVG без внешних библиотек).
 * @param {{ month: string, income: number, expense: number }[]} series
 */
function columnChart(series) {
  const W = 343;
  const H = 160;
  const padL = 0;
  const padB = 18;
  const padT = 8;
  const plotH = H - padB - padT;
  const max = Math.max(1, ...series.flatMap((m) => [m.income, m.expense]));
  const group = (W - padL) / series.length;
  const barW = Math.max(3, Math.floor((group - 6) / 2) - 1);

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Доходы и расходы по месяцам');

  // Базовая линия
  svg.append(line(padL, H - padB, W, H - padB, 'chart-axis'));

  series.forEach((m, i) => {
    const x0 = padL + i * group + 3;
    svg.append(rect(x0, m.income, 'chart-income'), rect(x0 + barW + 2, m.expense, 'chart-expense'));
    // Подпись месяца: только каждый третий, чтобы не слипались, и последний
    if (i % 3 === 0 || i === series.length - 1) {
      const t = document.createElementNS(ns, 'text');
      t.setAttribute('x', String(x0 + barW + 1));
      t.setAttribute('y', String(H - 4));
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('class', 'chart-label');
      t.textContent = monthShort(m.month);
      svg.append(t);
    }
    const title = document.createElementNS(ns, 'title');
    title.textContent = `${formatMonth(m.month)}: доходы ${formatMoney(m.income, 'EUR')}, расходы ${formatMoney(m.expense, 'EUR')}`;
    const hit = document.createElementNS(ns, 'rect');
    hit.setAttribute('x', String(padL + i * group));
    hit.setAttribute('y', '0');
    hit.setAttribute('width', String(group));
    hit.setAttribute('height', String(H));
    hit.setAttribute('fill', 'transparent');
    hit.append(title);
    svg.append(hit);
  });
  return svg;

  /** @param {number} x @param {number} v @param {string} cls */
  function rect(x, v, cls) {
    const h = v ? Math.max(2, Math.round((v / max) * plotH)) : 0;
    const r = document.createElementNS(ns, 'rect');
    r.setAttribute('x', String(x));
    r.setAttribute('y', String(H - padB - h));
    r.setAttribute('width', String(barW));
    r.setAttribute('height', String(h));
    r.setAttribute('rx', '2');
    r.setAttribute('class', cls);
    return r;
  }
  /** @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 @param {string} cls */
  function line(x1, y1, x2, y2, cls) {
    const l = document.createElementNS(ns, 'line');
    l.setAttribute('x1', String(x1));
    l.setAttribute('y1', String(y1));
    l.setAttribute('x2', String(x2));
    l.setAttribute('y2', String(y2));
    l.setAttribute('class', cls);
    return l;
  }
}

/** «2026-10» → «окт», в январе — «янв 26». @param {string} month */
function monthShort(month) {
  const [y, m] = month.split('-').map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '');
  return m === 1 ? `${s} ${String(y).slice(2)}` : s;
}
