// Главная: только то, что нужно сегодня — итоги месяца, быстрый расход,
// предупреждения и ближайшие 7 дней. Отчёты и круг расходов — в «Отчётах».

import { money, displayToggle, loadDisplay } from '../display.js';
import { el, formatDate, formatMonth, currentMonth, shiftMonth, emptyState } from '../ui.js';
import { listAllLines, getBudget } from '../repo/budgets.js';
import { incomeDebt } from '../income.js';
import { getDb, getSetting, setSetting } from '../db.js';
import { formatWhole, toEurCents } from '../money.js';
import { listOperations, monthRange, sumByCategory, todayISO } from '../repo/operations.js';
import { listCategories } from '../repo/categories.js';
import { summary } from '../reports.js';
import { rollup, fullName } from '../category-tree.js';
import { limitStatus } from '../limits.js';
import { addDays } from '../dates.js';
import { suggestRate } from '../repo/rates.js';
import { loadMonth, eventRow } from './calendar.js';
import { payStatus } from '../pay-status.js';
import { renderOperationForm } from './operation-form.js';
import { backupReminder, DEFAULT_REMINDER_DAYS } from '../backup-reminder.js';

const INSTALLED_AT = 'installedAt';

/** @param {HTMLElement} root */
export async function renderHome(root) {
  const db = await getDb();
  await loadDisplay();
  const today = todayISO();
  const month = currentMonth();

  let installedAt = await getSetting(INSTALLED_AT, db);
  if (!installedAt) {
    installedAt = new Date().toISOString();
    await setSetting(INSTALLED_AT, installedAt, db);
  }

  // 1. Итоги месяца: расходы, доходы, баланс, лимиты и «можно сегодня»
  const [monthOps, budget, categories] = await Promise.all([listOperations(monthRange(month)), getBudget(month), listCategories({ includeArchived: true })]);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const s = summary(monthOps);
  // У категории расходы — вместе со статьями (лимит категории — на всё)
  const spentBy = rollup(await sumByCategory(month, db), categories);
  let limitTotal = 0;
  let limitSpent = 0;
  /** @type {{ name: string, percent: number, over: boolean, href: string }[]} */
  const tightLimits = [];
  for (const line of budget) {
    if (line.limit == null) continue;
    const cat = byId.get(line.categoryId);
    if (cat?.kind !== 'expense') continue;
    limitTotal += line.limit;
    const spent = spentBy.get(line.categoryId) ?? 0;
    limitSpent += spent;
    const st = limitStatus(line.limit, spent, month, today);
    if (st.level !== 'ok') tightLimits.push({ name: fullName(cat, byId), percent: st.percent, over: st.level === 'over', href: `#/budget/${month}/${cat.id}` });
  }
  const hero = el('div', { class: 'card hero' },
    el('div', { class: 'row-top' }, el('div', { class: 'hero-label' }, `Расходы за ${formatMonth(month).toLowerCase()}`), displayToggle()),
    el('div', { class: 'hero-value' }, money(s.expense)),
    el('div', { class: 'hero-grid' },
      el('div', null, el('div', { class: 'small' }, 'Доходы'), el('strong', { class: 'income' }, money(s.income))),
      el('div', null, el('div', { class: 'small' }, 'Баланс'), el('strong', { class: s.balance < 0 ? 'over' : '' }, money(s.balance, { sign: true }))),
    ),
  );
  if (limitTotal > 0) {
    const st = limitStatus(limitTotal, limitSpent, month, today);
    // «Можно потратить сегодня»: остаток по всем лимитам, делённый на дни до конца месяца
    hero.querySelector('.hero-grid')?.append(
      el('div', null, el('div', { class: 'small' }, 'Можно сегодня'), el('strong', { class: st.level === 'over' ? 'over' : st.level === 'warn' ? 'warn' : 'income' }, st.perDay != null ? money(st.perDay) : st.remaining < 0 ? 'лимиты превышены' : '—')),
      el('div', null, el('div', { class: 'small' }, 'Осталось по лимитам'), el('strong', { class: st.remaining < 0 ? 'over' : '' }, money(st.remaining))),
    );
    hero.append(
      el('div', { class: `bar bar-${st.level}` }, el('div', { class: 'bar-fill', style: `width:${Math.min(100, st.percent)}%` })),
      el('div', { class: 'small muted' }, `Лимиты: ${money(limitSpent)} из ${money(limitTotal)} (${st.percent} %)`),
    );
  }
  if (s.unknownRate) hero.append(el('div', { class: 'small muted' }, `Без курса: ${s.unknownRate} — в итоги не входят.`));
  root.append(hero);

  // 2. Быстрый расход (п. 4.11 ТЗ) — та же форма операции, в сокращённом виде
  const quick = el('div', { class: 'card' }, el('div', { class: 'field-label' }, 'Быстрый расход'));
  await renderOperationForm(quick, {}, { compact: true, onSaved: () => window.dispatchEvent(new HashChangeEvent('hashchange')) });
  root.append(quick);

  // 3. Предупреждения: просроченные платежи и поступления, «вам должны», лимиты, копия
  const thisMonth = await loadMonth(month);
  const nextMonthData = addDays(today, 6).slice(0, 7) !== month ? await loadMonth(shiftMonth(month, 1)) : null;
  const overdue = thisMonth.dated.filter((e) => payStatus({ date: e.date, type: e.type }, today).kind === 'overdue');
  const alerts = el('div', { class: 'card list-card' }, el('div', { class: 'hero-label', style: 'padding-top:12px' }, 'Внимание'));
  let alertCount = 0;
  const overduePay = overdue.filter((e) => e.type === 'expense');
  if (overduePay.length) {
    alertCount++;
    alerts.append(el('a', { class: 'menu-row', href: '#/payments' }, el('span', { class: 'warn' }, `Просрочено платежей: ${overduePay.length}`, el('div', { class: 'small muted' }, overduePay.map((e) => e.name).join(', '))), el('span', { class: 'muted' }, '›')));
  }
  // Вам должны: по источникам дохода (план по сроку минус получено)
  {
    const rateNow = (await suggestRate(today, db))?.rate ?? null;
    const allLines = await listAllLines(db);
    const incomeOps = await listOperations({ type: 'income' }, db);
    for (const c of categories.filter((c) => c.kind === 'income' && !c.archived)) {
      const d = incomeDebt({ lines: allLines.filter((l) => l.categoryId === c.id), ops: incomeOps.filter((o) => o.categoryId === c.id), upTo: shiftMonth(month, 1), rateNow, today, terms: c });
      if (!d || d.debt <= 0) continue;
      alertCount++;
      alerts.append(el('a', { class: 'menu-row', href: `#/budget/${month}/${c.id}` },
        el('span', null, `Вам должны: ${c.employer || c.name}`, el('div', { class: `small ${d.daysLate ? 'warn' : 'muted'}` }, d.daysLate ? `просрочено ${d.daysLate} дн.` : 'по плану')),
        el('strong', { class: 'warn' }, formatWhole(d.debt, d.currency)),
      ));
    }
  }
  const lateIncome = overdue.filter((e) => e.type === 'income' && e.kind !== 'source');
  if (lateIncome.length) {
    alertCount++;
    alerts.append(el('a', { class: 'menu-row', href: '#/payments' }, el('span', { class: 'warn' }, `Задерживается поступлений: ${lateIncome.length}`, el('div', { class: 'small muted' }, lateIncome.map((e) => e.name).join(', '))), el('span', { class: 'muted' }, '›')));
  }
  for (const l of tightLimits) {
    alertCount++;
    alerts.append(el('a', { class: 'menu-row', href: l.href }, el('span', { class: l.over ? 'over' : 'warn' }, l.over ? `Лимит превышен: ${l.name}` : `Лимит почти исчерпан: ${l.name}`), el('strong', { class: l.over ? 'over' : 'warn' }, `${l.percent} %`)));
  }
  const reminder = backupReminder({
    enabled: (await getSetting('backupReminderEnabled', db)) ?? true,
    days: Number((await getSetting('backupReminderDays', db)) ?? DEFAULT_REMINDER_DAYS),
    lastBackupAt: (await getSetting('lastBackupAt', db)) ?? null,
    installedAt,
    now: new Date(),
  });
  if (reminder.show) {
    alertCount++;
    alerts.append(el('a', { class: 'menu-row', href: '#/backup' }, el('span', null, 'Сделать резервную копию', el('div', { class: 'small muted' }, reminder.daysSince == null ? 'Копия ещё не делалась — данные хранятся только на этом устройстве.' : `С последней копии прошло ${reminder.daysSince} дн.`)), el('span', { class: 'muted' }, '›')));
  }
  if (alertCount) root.append(alerts);

  // 4. Ближайшие 7 дней: платежи и поступления со статусом и кнопкой отметки
  const until = addDays(today, 6);
  const week = [...thisMonth.dated, ...(nextMonthData?.dated ?? [])].filter((e) => e.date && e.date >= today && e.date <= until);
  root.append(el('h2', { class: 'section-title' }, 'Ближайшие 7 дней'));
  if (!week.length) {
    root.append(emptyState('repeat', 'На ближайшую неделю платежей и поступлений нет', 'Добавить платёж', '#/payments/new'));
  } else {
    const rate = thisMonth.rate;
    let outEur = 0;
    let inEur = 0;
    let unknown = 0;
    for (const e of week) {
      const eur = toEurCents(e.amount, e.currency, rate);
      if (eur == null) unknown++;
      else if (e.type === 'expense') outEur += eur;
      else inEur += eur;
    }
    const list = el('div', { class: 'list' });
    let lastDate = '';
    for (const e of week) {
      if (e.date !== lastDate) {
        lastDate = /** @type {string} */ (e.date);
        list.append(el('div', { class: 'date-head', style: 'padding:0 16px' }, e.date === today ? 'Сегодня' : e.date === addDays(today, 1) ? 'Завтра' : formatDate(lastDate)));
      }
      list.append(eventRow(e, today));
    }
    root.append(list, el('p', { class: 'muted small', style: 'margin:0 4px 12px' }, `Оплатить: ${money(outEur)} · получить: ${money(inEur)}${unknown ? ` (без курса: ${unknown})` : ''}`));
  }
  root.append(el('div', { class: 'btn-row' }, el('a', { class: 'btn btn-secondary', href: '#/payments' }, 'Все платежи'), el('a', { class: 'btn btn-secondary', href: '#/reports' }, 'Отчёты')));
}
