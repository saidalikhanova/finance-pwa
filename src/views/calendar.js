// Календарь месяца: вид раздела «Платежи». Собирает все даты денег
// (платежи, кредиты, долги, выплаты по источникам, разовые поступления).

import { el, avatar, formatDate, currentMonth } from '../ui.js';
import { formatMoney, formatWhole, toEurCents } from '../money.js';
import { money } from '../display.js';
import { monthEvents } from '../calendar-events.js';
import { isLoanCategory } from '../loans.js';
import { payStatus, markLabel } from '../pay-status.js';
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

/**
 * @typedef {Object} MonthData
 * @property {string} month
 * @property {string} today
 * @property {number | null} rate
 * @property {import('../calendar-events.js').CalEvent[]} dated — ещё не отмеченные, по датам
 * @property {import('../calendar-events.js').CalEvent[]} undated — без точной даты
 * @property {{ name: string, type: 'expense' | 'income', amount: number, currency: 'EUR' | 'KZT', date: string, href: string }[]} done — отмеченные в этом месяце
 * @property {Map<string, number>} spentByDay — траты по дням, центы евро
 */

/**
 * Все даты денег месяца.
 * @param {string} month
 * @returns {Promise<MonthData>}
 */
export async function loadMonth(month) {
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
    loanCategories: (await listCategories({ kind: 'expense', includeArchived: true })).filter(isLoanCategory).map((c) => c.id),
  });

  // Отмеченные в этом месяце: по дате отметки (а не срока) — так видно, что уже сделано
  /** @type {MonthData['done']} */
  const done = [];
  const seen = new Set();
  for (const p of await listPlanned({ includeDone: true })) {
    if (!p.done || !p.receivedDate || p.receivedDate < from || p.receivedDate > to) continue;
    done.push({ name: p.name, type: p.type, amount: p.receivedAmount ?? p.amount, currency: p.currency, date: p.receivedDate, href: p.operationId ? `#/operations/${p.operationId}` : `#/planned/${p.id}` });
    if (p.operationId) seen.add(p.operationId);
  }
  /** @type {Map<string, number>} */
  const spentByDay = new Map();
  for (const o of await listOperations({ from, to })) {
    if (o.type === 'expense' && o.amountEur != null) spentByDay.set(o.date, (spentByDay.get(o.date) ?? 0) + o.amountEur);
    // Оплаты по графику (например, кредит заранее) — без записи «к оплате»
    if (o.recurringId && !seen.has(o.id)) done.push({ name: o.comment || 'Платёж', type: o.type, amount: o.amount, currency: o.currency, date: o.date, href: `#/operations/${o.id}` });
  }
  done.sort((a, b) => (a.date < b.date ? 1 : -1));
  return { month, today, rate, dated, undated, done, spentByDay };
}

/**
 * Сетка месяца с точками, итоги и платежи выбранного дня.
 * @param {HTMLElement} body
 * @param {MonthData} data
 */
export function renderCalendarMonth(body, data) {
  const { month, today, rate, dated, undated, spentByDay } = data;
  const { from, to } = monthRange(month);
  const maxSpent = Math.max(0, ...spentByDay.values());
  /** @type {Map<string, import('../calendar-events.js').CalEvent[]>} */
  const byDate = new Map();
  for (const ev of dated) byDate.set(/** @type {string} */ (ev.date), [...(byDate.get(/** @type {string} */ (ev.date)) ?? []), ev]);

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

  body.append(
    el('div', { class: 'card' },
      grid,
      el('p', { class: 'muted small', style: 'margin:8px 0 0' },
        el('span', { class: 'cal-dot cal-dot-out cal-legend' }), ' оплатить  ',
        el('span', { class: 'cal-dot cal-dot-in cal-legend' }), ' получить  · число — потрачено за день'),
    ),
    totalsCard(dated, undated, rate),
    dayBox,
  );
  if (undated.length) {
    const list = el('div', { class: 'list' });
    for (const ev of undated) list.append(eventRow(ev, today));
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
      for (const ev of dayItems) group.append(eventRow(ev, today));
      dayBox.append(group);
    }
  }
  showDay();
}

/**
 * Итоги месяца: что придёт и что нужно оплатить, в валюте показа.
 * @param {import('../calendar-events.js').CalEvent[]} dated
 * @param {import('../calendar-events.js').CalEvent[]} undated
 * @param {number | null} rate
 */
export function totalsCard(dated, undated, rate) {
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
  return el('div', { class: 'card' },
    el('div', { class: 'cal-total' }, el('span', null, 'Ещё получить'), el('strong', { class: 'income' }, money(inEur))),
    el('div', { class: 'cal-total' }, el('span', null, 'Ещё оплатить'), el('strong', null, money(outEur))),
    unknown ? el('p', { class: 'muted small', style: 'margin:6px 0 0' }, 'Часть сумм в тенге не учтена: нет курса.') : null,
  );
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
 * Строка платежа / поступления: название, статус, сумма, кнопка отметки.
 * Нажатие на строку открывает запись.
 * @param {import('../calendar-events.js').CalEvent} ev
 * @param {string} today
 */
export function eventRow(ev, today) {
  const st = payStatus({ date: ev.date, type: ev.type }, today);
  const sign = ev.type === 'expense' ? -ev.amount : ev.amount;
  const statusClass = st.kind === 'overdue' ? 'warn' : st.kind === 'today' ? '' : 'muted';
  return el('div', { class: 'row' },
    el('a', { href: ev.href, style: 'display:contents' }, avatar(ev.name, { income: ev.type === 'income' })),
    el('a', { class: 'row-main', href: ev.href, style: 'color:inherit;text-decoration:none' },
      el('div', null, ev.name),
      el('div', { class: `small ${statusClass}` }, `${st.text} · ${ev.sub}`),
    ),
    el('div', { class: `row-amount ${ev.type}` },
      el('div', null, formatWhole(sign, ev.currency).replace(/^(?!−)/, ev.type === 'income' ? '+' : '')),
      ev.pay ? el('a', { class: 'btn btn-small expected-btn', href: ev.pay }, markLabel(ev.type)) : el('div', { class: 'muted small' }, 'запишется сам'),
    ),
  );
}

/** @param {import('../repo/upcoming.js').Upcoming} it */
export function upcomingRow(it) {
  const href = it.source === 'recurring' ? `#/payments/${it.refId}` : `#/planned/${it.refId}`;
  return el(
    'a',
    { class: 'row', href },
    avatar(it.name, { income: it.type === 'income' }),
    el('div', { class: 'row-main' }, el('div', null, it.name), el('div', { class: 'muted small' }, it.source === 'recurring' ? 'по графику' : 'разовый')),
    el('div', { class: `row-amount ${it.type}` }, formatMoney(it.type === 'expense' ? -it.amount : it.amount, it.currency, { sign: true })),
  );
}
