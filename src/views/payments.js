// Раздел «Платежи»: всё, что привязано к дате, в одном месте —
// что оплатить и что получить в месяце, со статусом и кнопкой отметки.
// Два вида: список и календарь.

import { el, avatar, formatMonth, shiftMonth } from '../ui.js';
import { formatWhole } from '../money.js';
import { displayToggle, loadDisplay } from '../display.js';
import { segmented } from './form-parts.js';
import { calendarState, loadMonth, renderCalendarMonth, eventRow, totalsCard } from './calendar.js';
import { payStatus } from '../pay-status.js';

/** @type {{ view: 'list' | 'calendar' }} */
const paymentsState = { view: 'list' };

/**
 * @param {HTMLElement} root
 * @param {Record<string, string>} params — view=calendar
 */
export async function renderPayments(root, params = {}) {
  await loadDisplay();
  if (params.view === 'calendar' || params.view === 'list') paymentsState.view = params.view;
  const monthLabel = el('span', { class: 'month-label' }, formatMonth(calendarState.month));
  const body = el('div');
  const viewToggle = segmented([['list', 'Список'], ['calendar', 'Календарь']], paymentsState.view, (v) => {
    paymentsState.view = /** @type {'list' | 'calendar'} */ (v);
    refresh();
  });
  viewToggle.classList.add('segmented-mini');

  root.append(
    el('div', { class: 'month-nav' },
      el('button', { class: 'icon-btn', 'aria-label': 'Предыдущий месяц', onclick: () => go(-1) }, '‹'),
      monthLabel,
      el('button', { class: 'icon-btn', 'aria-label': 'Следующий месяц', onclick: () => go(1) }, '›'),
    ),
    el('div', { class: 'display-row' }, viewToggle, el('span', { style: 'flex:1' }), el('span', { class: 'muted small' }, 'в'), displayToggle()),
    body,
  );

  /** @param {number} delta */
  function go(delta) {
    calendarState.month = shiftMonth(calendarState.month, delta);
    monthLabel.textContent = formatMonth(calendarState.month);
    refresh();
  }

  async function refresh() {
    const data = await loadMonth(calendarState.month);
    body.innerHTML = '';
    if (paymentsState.view === 'calendar') renderCalendarMonth(body, data);
    else renderList(body, data);
    body.append(
      el('div', { class: 'btn-row', style: 'margin-top:12px' },
        el('a', { class: 'btn', href: '#/payments/new' }, '+ Платёж'),
        el('a', { class: 'btn btn-secondary', href: '#/debts' }, 'Долги людям'),
      ),
      el('p', { class: 'muted small', style: 'margin:8px 4px 0' },
        'Здесь всё, что привязано к дате: кредиты, страховки, подписки, зарплаты, разовые счета. В срок нажмите «Оплатил(а)» или «Получил(а)» — запись попадёт в операции. Расписания (пауза, завершение, выгрузка в календарь телефона) — ',
        el('a', { href: '#/schedules' }, 'здесь'), '.'),
    );
  }

  await refresh();
}

/**
 * Список месяца: «Оплатить», «Получить», «Сделано».
 * @param {HTMLElement} body
 * @param {import('./calendar.js').MonthData} data
 */
function renderList(body, data) {
  const { today, dated, undated, done, rate } = data;
  const all = [...dated, ...undated];
  const sortByUrgency = (/** @type {import('../calendar-events.js').CalEvent[]} */ items) =>
    [...items].sort((a, b) => {
      // Просроченные и сегодняшние — вверху, затем по дате; без даты — в конце
      const ka = payStatus({ date: a.date, type: a.type }, today);
      const kb = payStatus({ date: b.date, type: b.type }, today);
      const rank = { overdue: 0, today: 1, upcoming: 2, done: 3 };
      if (rank[ka.kind] !== rank[kb.kind]) return rank[ka.kind] - rank[kb.kind];
      return (a.date ?? '9999') < (b.date ?? '9999') ? -1 : 1;
    });
  const toPay = sortByUrgency(all.filter((e) => e.type === 'expense'));
  const toGet = sortByUrgency(all.filter((e) => e.type === 'income'));

  body.append(totalsCard(dated, undated, rate));
  section('Оплатить', toPay, 'Платежей на этот месяц нет.');
  section('Получить', toGet, 'Поступлений на этот месяц нет.');

  if (done.length) {
    const list = el('div', { class: 'list' });
    for (const d of done) {
      const st = payStatus({ date: d.date, type: d.type, done: true, doneDate: d.date }, today);
      list.append(el('a', { class: 'row', href: d.href },
        avatar(d.name, { income: d.type === 'income' }),
        el('div', { class: 'row-main' }, el('div', null, d.name), el('div', { class: 'muted small' }, st.text)),
        el('div', { class: `row-amount ${d.type}` }, formatWhole(d.type === 'expense' ? -d.amount : d.amount, d.currency)),
      ));
    }
    body.append(el('details', { class: 'card list-card', style: 'margin-top:12px' }, el('summary', { class: 'muted' }, `Сделано в этом месяце: ${done.length}`), list));
  }

  /** @param {string} title @param {import('../calendar-events.js').CalEvent[]} items @param {string} empty */
  function section(title, items, empty) {
    const overdue = items.filter((e) => payStatus({ date: e.date, type: e.type }, today).kind === 'overdue').length;
    body.append(el('h2', { class: 'section-title' }, title, overdue ? el('span', { class: 'warn', style: 'font-weight:500;text-transform:none;letter-spacing:0;margin-left:8px' }, `просрочено: ${overdue}`) : null));
    if (!items.length) {
      body.append(el('p', { class: 'muted', style: 'margin:0 4px' }, empty));
      return;
    }
    const list = el('div', { class: 'list' });
    for (const ev of items) list.append(eventRow(ev, today));
    body.append(list);
  }
}
