import { el, avatar, formatMonth, shiftMonth, currentMonth, formatDate } from '../ui.js';
import { formatMoney } from '../money.js';
import { listUpcoming } from '../repo/upcoming.js';
import { monthRange, todayISO, listOperations } from '../repo/operations.js';
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
    // Траты по дням: «когда» уходят деньги
    /** @type {Map<string, number>} */
    const spentByDay = new Map();
    for (const o of await listOperations({ from, to })) {
      if (o.type !== 'expense' || o.amountEur == null) continue;
      spentByDay.set(o.date, (spentByDay.get(o.date) ?? 0) + o.amountEur);
    }
    const maxSpent = Math.max(0, ...spentByDay.values());
    /** @type {Map<string, import('../repo/upcoming.js').Upcoming[]>} */
    const byDate = new Map();
    for (const it of items) byDate.set(it.date, [...(byDate.get(it.date) ?? []), it]);

    body.innerHTML = '';
    const grid = el('div', { class: 'cal-grid' }, ...WEEKDAYS.map((w) => el('div', { class: 'cal-head' }, w)));
    const [y, m] = month.split('-').map(Number);
    const offset = weekdayMon0(from);
    for (let i = 0; i < offset; i++) grid.append(el('div'));
    const list = el('div');
    let selected = items.find((it) => it.date >= today)?.date ?? (today >= from && today <= to ? today : null);

    for (let d = 1; d <= daysInMonth(y, m); d++) {
      const date = `${month}-${String(d).padStart(2, '0')}`;
      const has = byDate.get(date);
      const spent = spentByDay.get(date) ?? 0;
      const tint = spent && maxSpent ? Math.max(0.12, spent / maxSpent) : 0;
      const cell = el(
        'button',
        {
          type: 'button',
          class: `cal-day${date === today ? ' cal-today' : ''}${has ? ' cal-has' : ''}${spent ? ' cal-spent' : ''}`,
          style: spent ? `--tint:${tint.toFixed(2)}` : null,
          onclick: () => {
            selected = date;
            grid.querySelectorAll('.cal-day').forEach((c) => c.classList.toggle('cal-selected', c === cell));
            showDay();
          },
        },
        el('span', { class: 'cal-num' }, String(d)),
        spent ? el('span', { class: 'cal-sum' }, Math.round(spent / 100) ? String(Math.round(spent / 100)) : '<1') : null,
        has ? el('span', { class: 'cal-dot' }) : null,
      );
      if (date === selected) cell.classList.add('cal-selected');
      grid.append(cell);
    }
    body.append(el('div', { class: 'card' }, grid, el('p', { class: 'muted small', style: 'margin:8px 0 0' }, 'Число в ячейке — расходы дня в евро, точка — платёж по плану.')), list);

    function showDay() {
      list.innerHTML = '';
      if (!selected) {
        list.append(el('p', { class: 'muted', style: 'margin:0 4px' }, items.length ? 'Выберите день.' : 'В этом месяце запланированных платежей нет. Нажмите день, чтобы увидеть траты.'));
        return;
      }
      const dayItems = byDate.get(selected) ?? [];
      const spent = spentByDay.get(selected) ?? 0;
      list.append(el('h2', { class: 'section-title' }, formatDate(selected)));
      if (spent) list.append(el('a', { class: 'banner', href: `#/operations?month=${month}` }, el('strong', null, `Потрачено: ${formatMoney(spent, 'EUR')}`), el('div', { class: 'small' }, 'Открыть операции месяца')));
      if (!dayItems.length) {
        list.append(el('p', { class: 'muted', style: 'margin:0 4px' }, 'Платежей на этот день нет.'));
        return;
      }
      const group = el('div', { class: 'list' });
      for (const it of dayItems) group.append(upcomingRow(it));
      list.append(group);
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
    avatar(it.name, { income: it.type === 'income' }),
    el('div', { class: 'row-main' }, el('div', null, it.name), el('div', { class: 'muted small' }, it.source === 'recurring' ? 'повторяющийся' : 'разовый')),
    el('div', { class: `row-amount ${it.type}` }, formatMoney(it.type === 'expense' ? -it.amount : it.amount, it.currency, { sign: true })),
  );
}
