import { el, avatar, formatMonth, shiftMonth, currentMonth, formatDate } from '../ui.js';
import { formatMoney, formatWhole, toEurCents } from '../money.js';
import { money, displayToggle, loadDisplay } from '../display.js';
import { monthEvents } from '../calendar-events.js';
import { listAllLines } from '../repo/budgets.js';
import { listCategories } from '../repo/categories.js';
import { listDebts, listRepayments } from '../repo/debts.js';
import { debtStatus } from '../debts.js';
import { listPlanned } from '../repo/planned.js';
import { suggestRate } from '../repo/rates.js';
import { listUpcoming } from '../repo/upcoming.js';
import { monthRange, todayISO, listOperations } from '../repo/operations.js';
import { weekdayMon0, daysInMonth } from '../dates.js';

export const calendarState = { month: currentMonth() };

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/** @param {HTMLElement} root */
export async function renderCalendar(root) {
  await loadDisplay();
  const monthLabel = el('span', { class: 'month-label' }, formatMonth(calendarState.month));
  const body = el('div');
  root.append(
    el(
      'div',
      { class: 'month-nav' },
      el('button', { class: 'icon-btn', 'aria-label': 'Предыдущий месяц', onclick: () => go(-1) }, '‹'),
      monthLabel,
      el('button', { class: 'icon-btn', 'aria-label': 'Следующий месяц', onclick: () => go(1) }, '›'),
    ),
    el('div', { class: 'display-row' }, el('span', { class: 'muted small' }, 'Показывать в'), displayToggle()),
    body,
  );

  /** @param {number} delta */
  function go(delta) {
    calendarState.month = shiftMonth(calendarState.month, delta);
    monthLabel.textContent = formatMonth(calendarState.month);
    refresh();
  }

  async function refresh() {
    const month = calendarState.month;
    const { from, to } = monthRange(month);
    const today = todayISO();
    const rate = (await suggestRate(today))?.rate ?? null;
    const allLines = await listAllLines();
    const sources = (await listCategories({ kind: 'income' })).map((category) => ({ category, lines: allLines.filter((l) => l.categoryId === category.id) }));
    const reps = await listRepayments();
    const debts = (await listDebts()).map((debt) => ({ debt, remaining: debtStatus(debt, reps, today, rate).remaining }));
    const { dated, undated } = monthEvents({
      month,
      upcoming: await listUpcoming(from, to),
      planned: await listPlanned({ from, to }),
      sources,
      debts,
    });

    // Траты по дням: «когда» уходят деньги
    /** @type {Map<string, number>} */
    const spentByDay = new Map();
    for (const o of await listOperations({ from, to })) {
      if (o.type !== 'expense' || o.amountEur == null) continue;
      spentByDay.set(o.date, (spentByDay.get(o.date) ?? 0) + o.amountEur);
    }
    const maxSpent = Math.max(0, ...spentByDay.values());
    /** @type {Map<string, import('../calendar-events.js').CalEvent[]>} */
    const byDate = new Map();
    for (const ev of dated) byDate.set(/** @type {string} */ (ev.date), [...(byDate.get(/** @type {string} */ (ev.date)) ?? []), ev]);

    body.innerHTML = '';
    const grid = el('div', { class: 'cal-grid' }, ...WEEKDAYS.map((w) => el('div', { class: 'cal-head' }, w)));
    const [y, m] = month.split('-').map(Number);
    const offset = weekdayMon0(from);
    for (let i = 0; i < offset; i++) grid.append(el('div'));
    const dayBox = el('div');
    let selected = dated.find((ev) => /** @type {string} */ (ev.date) >= today)?.date ?? (today >= from && today <= to ? today : null);

    for (let d = 1; d <= daysInMonth(y, m); d++) {
      const date = `${month}-${String(d).padStart(2, '0')}`;
      const has = byDate.get(date) ?? [];
      const spent = spentByDay.get(date) ?? 0;
      const tint = spent && maxSpent ? Math.max(0.12, spent / maxSpent) : 0;
      const dots = el('span', { class: 'cal-dots' },
        has.some((ev) => ev.type === 'expense') ? el('span', { class: 'cal-dot cal-dot-out' }) : null,
        has.some((ev) => ev.type === 'income') ? el('span', { class: 'cal-dot cal-dot-in' }) : null,
      );
      const cell = el(
        'button',
        {
          type: 'button',
          class: `cal-day${date === today ? ' cal-today' : ''}${spent ? ' cal-spent' : ''}`,
          style: spent ? `--tint:${tint.toFixed(2)}` : null,
          onclick: () => {
            selected = date;
            grid.querySelectorAll('.cal-day').forEach((c) => c.classList.toggle('cal-selected', c === cell));
            showDay();
          },
        },
        el('span', { class: 'cal-num' }, String(d)),
        spent ? el('span', { class: 'cal-sum' }, compact(spent)) : null,
        has.length ? dots : null,
      );
      if (date === selected) cell.classList.add('cal-selected');
      grid.append(cell);
    }

    // Итоги месяца в валюте показа
    let inEur = 0;
    let outEur = 0;
    let unknown = 0;
    for (const ev of [...dated, ...undated]) {
      const eur = toEurCents(ev.amount, ev.currency, rate);
      if (eur == null) {
        unknown++;
        continue;
      }
      if (ev.type === 'income') inEur += eur;
      else outEur += eur;
    }

    body.append(
      el('div', { class: 'card' },
        grid,
        el('p', { class: 'muted small', style: 'margin:8px 0 0' },
          el('span', { class: 'cal-dot cal-dot-out cal-legend' }), ' оплатить  ',
          el('span', { class: 'cal-dot cal-dot-in cal-legend' }), ' получить  · число — потрачено за день'),
      ),
      el('div', { class: 'card' },
        el('div', { class: 'cal-total' }, el('span', null, 'Придёт по плану'), el('strong', { class: 'income' }, money(inEur))),
        el('div', { class: 'cal-total' }, el('span', null, 'Нужно оплатить'), el('strong', null, money(outEur))),
        unknown ? el('p', { class: 'muted small', style: 'margin:6px 0 0' }, 'Часть сумм в тенге не учтена: нет курса.') : null,
      ),
      dayBox,
    );

    const all = el('div', { class: 'list' });
    for (const ev of dated) all.append(eventRow(ev, true));
    body.append(el('h2', { class: 'section-title' }, `Весь ${formatMonth(month).toLowerCase().replace(/ \d{4}$/, '')}`));
    body.append(dated.length ? all : el('p', { class: 'muted', style: 'margin:0 4px' }, 'Платежей и выплат с датой нет.'));
    if (undated.length) {
      const list = el('div', { class: 'list' });
      for (const ev of undated) list.append(eventRow(ev, false));
      body.append(el('h2', { class: 'section-title' }, 'В течение месяца, без точной даты'), list);
    }

    function showDay() {
      dayBox.innerHTML = '';
      if (!selected) return;
      const dayItems = byDate.get(selected) ?? [];
      const spent = spentByDay.get(selected) ?? 0;
      if (!dayItems.length && !spent) return;
      dayBox.append(el('h2', { class: 'section-title' }, formatDate(selected)));
      if (spent) dayBox.append(el('a', { class: 'banner', href: `#/operations?month=${month}` }, el('strong', null, `Потрачено: ${money(spent)}`), el('div', { class: 'small' }, 'Открыть операции месяца')));
      if (dayItems.length) {
        const group = el('div', { class: 'list' });
        for (const ev of dayItems) group.append(eventRow(ev, false));
        dayBox.append(group);
      }
    }
    showDay();
  }

  await refresh();
}

/**
 * Трата дня в ячейке: коротко, в валюте показа (12, 1,2к).
 * @param {number} eurCents
 */
function compact(eurCents) {
  const s = money(eurCents).replace(/[^\d\s,]/g, '').trim();
  const n = Number(s.replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',').replace(',0', '')}м`;
  if (n >= 10_000) return `${Math.round(n / 1000)}к`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.', ',').replace(',0', '')}к`;
  return n < 1 ? '<1' : String(Math.round(n));
}

/**
 * @param {import('../calendar-events.js').CalEvent} ev
 * @param {boolean} withDate
 */
function eventRow(ev, withDate) {
  const sign = ev.type === 'expense' ? -ev.amount : ev.amount;
  return el(
    'a',
    { class: 'row', href: ev.href },
    avatar(ev.name, { income: ev.type === 'income' }),
    el('div', { class: 'row-main' }, el('div', null, ev.name), el('div', { class: 'muted small' }, withDate && ev.date ? `${formatDate(ev.date)} · ${ev.sub}` : ev.sub)),
    el('div', { class: `row-amount ${ev.type}` }, formatWhole(sign, ev.currency).replace(/^(?!−)/, ev.type === 'income' ? '+' : '')),
  );
}

/** @param {import('../repo/upcoming.js').Upcoming} it */
export function upcomingRow(it) {
  const href = it.source === 'recurring' ? `#/payments/${it.refId}` : `#/planned/${it.refId}`;
  return el(
    'a',
    { class: 'row', href },
    avatar(it.name, { income: it.type === 'income' }),
    el('div', { class: 'row-main' }, el('div', null, it.name), el('div', { class: 'muted small' }, it.source === 'recurring' ? 'повторяющийся' : 'разовый')),
    el('div', { class: `row-amount ${it.type}` }, formatMoney(it.type === 'expense' ? -it.amount : it.amount, it.currency, { sign: true })),
  );
}
