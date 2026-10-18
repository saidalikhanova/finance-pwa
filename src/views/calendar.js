import { el, formatMonth, shiftMonth, currentMonth, formatDate } from '../ui.js';
import { formatMoney } from '../money.js';
import { listUpcoming } from '../repo/upcoming.js';
import { monthRange, todayISO } from '../repo/operations.js';
import { weekdayMon0, daysInMonth } from '../dates.js';

export const calendarState = { month: currentMonth() };

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/** @param {HTMLElement} root */
export async function renderCalendar(root) {
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
    const items = await listUpcoming(from, to);
    const today = todayISO();
    /** @type {Map<string, import('../repo/upcoming.js').Upcoming[]>} */
    const byDate = new Map();
    for (const it of items) byDate.set(it.date, [...(byDate.get(it.date) ?? []), it]);

    body.innerHTML = '';
    const grid = el('div', { class: 'cal-grid' }, ...WEEKDAYS.map((w) => el('div', { class: 'cal-head' }, w)));
    const [y, m] = month.split('-').map(Number);
    const offset = weekdayMon0(from);
    for (let i = 0; i < offset; i++) grid.append(el('div'));
    const list = el('div');
    let selected = items.find((it) => it.date >= today)?.date ?? null;

    for (let d = 1; d <= daysInMonth(y, m); d++) {
      const date = `${month}-${String(d).padStart(2, '0')}`;
      const has = byDate.get(date);
      const cell = el(
        'button',
        {
          type: 'button',
          class: `cal-day${date === today ? ' cal-today' : ''}${has ? ' cal-has' : ''}`,
          onclick: () => {
            selected = date;
            grid.querySelectorAll('.cal-day').forEach((c) => c.classList.toggle('cal-selected', c === cell));
            showDay();
          },
        },
        String(d),
        has ? el('span', { class: 'cal-dot' }) : null,
      );
      if (date === selected) cell.classList.add('cal-selected');
      grid.append(cell);
    }
    body.append(el('div', { class: 'card' }, grid), list);

    function showDay() {
      list.innerHTML = '';
      if (!selected) {
        list.append(el('p', { class: 'muted' }, items.length ? 'Выберите день.' : 'В этом месяце платежей нет.'));
        return;
      }
      const dayItems = byDate.get(selected) ?? [];
      list.append(el('h2', { class: 'section-title' }, formatDate(selected)));
      if (!dayItems.length) {
        list.append(el('p', { class: 'muted' }, 'Платежей нет.'));
        return;
      }
      for (const it of dayItems) list.append(upcomingRow(it));
    }
    showDay();
  }

  await refresh();
}

/** @param {import('../repo/upcoming.js').Upcoming} it */
export function upcomingRow(it) {
  const href = it.source === 'recurring' ? `#/payments/${it.refId}` : `#/planned/${it.refId}`;
  return el(
    'a',
    { class: 'row', href },
    el('div', { class: 'row-main' }, el('div', null, it.name), el('div', { class: 'muted small' }, it.source === 'recurring' ? 'повторяющийся' : 'разовый')),
    el('div', { class: `row-amount ${it.type}` }, formatMoney(it.type === 'expense' ? -it.amount : it.amount, it.currency, { sign: true })),
  );
}
