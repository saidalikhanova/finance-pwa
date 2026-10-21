import { money, displayToggle, loadDisplay } from '../display.js';
import { el, formatDate, formatMonth, currentMonth, shiftMonth } from '../ui.js';
import { listPlanned } from '../repo/planned.js';
import { listAllLines } from '../repo/budgets.js';
import { incomeDebt } from '../income.js';
import { expectedStatus, incomeExpectations } from '../expected.js';
import { expectedRow } from './budget.js';
import { getDb, getSetting, setSetting } from '../db.js';
import { formatMoney, formatWhole, toEurCents } from '../money.js';
import { listUpcoming } from '../repo/upcoming.js';
import { listOperations, monthRange, sumByCategory, todayISO } from '../repo/operations.js';
import { getBudget } from '../repo/budgets.js';
import { listCategories } from '../repo/categories.js';
import { summary, expensesByCategory } from '../reports.js';
import { donut } from './donut.js';
import { emptyState } from '../ui.js';
import { limitStatus } from '../limits.js';
import { addDays } from '../dates.js';
import { suggestRate } from '../repo/rates.js';
import { upcomingRow } from './calendar.js';
import { quickEntry } from './quick-entry.js';
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

  // Сводка месяца: расходы, доходы, баланс и использование лимитов
  const [monthOps, budget, categories] = await Promise.all([listOperations(monthRange(month)), getBudget(month), listCategories({ includeArchived: true })]);
  const s = summary(monthOps);
  const spentBy = await sumByCategory(month, db);
  let limitTotal = 0;
  let limitSpent = 0;
  let limitOver = 0;
  for (const line of budget) {
    if (line.limit == null) continue;
    const cat = categories.find((c) => c.id === line.categoryId);
    if (cat?.kind !== 'expense') continue;
    limitTotal += line.limit;
    const spent = spentBy.get(line.categoryId) ?? 0;
    limitSpent += spent;
    if (spent > line.limit) limitOver++;
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
    const grid = hero.querySelector('.hero-grid');
    grid?.append(
      el('div', null, el('div', { class: 'small' }, 'Можно сегодня'), el('strong', { class: st.level === 'over' ? 'over' : st.level === 'warn' ? 'warn' : 'income' }, st.perDay != null ? money(st.perDay) : st.remaining < 0 ? 'лимиты превышены' : '—')),
      el('div', null, el('div', { class: 'small' }, 'Осталось по лимитам'), el('strong', { class: st.remaining < 0 ? 'over' : '' }, money(st.remaining))),
    );
    hero.append(
      el('div', { class: `bar bar-${st.level}` }, el('div', { class: 'bar-fill', style: `width:${Math.min(100, st.percent)}%` })),
      el('div', { class: 'small muted' }, `Лимиты: ${money(limitSpent)} из ${money(limitTotal)} (${st.percent} %)${limitOver ? ` · превышено: ${limitOver}` : ''}`),
    );
  }
  root.append(hero);

  // Долги по источникам дохода: план минус получено на сегодня
  {
    const rateNow = (await suggestRate(today, db))?.rate ?? null;
    const allLines = await listAllLines(db);
    const incomeOps = await listOperations({ type: 'income' }, db);
    const owed = [];
    for (const c of categories.filter((c) => c.kind === 'income')) {
      const d = incomeDebt({ lines: allLines.filter((l) => l.categoryId === c.id), ops: incomeOps.filter((o) => o.categoryId === c.id), upTo: month, rateNow });
      if (d && d.debt > 0) owed.push({ c, d });
    }
    if (owed.length) {
      const card = el('div', { class: 'card list-card debt-owed' });
      card.append(el('div', { class: 'hero-label', style: 'padding-top:12px' }, 'Вам должны'));
      for (const { c, d } of owed) {
        card.append(el('a', { class: 'menu-row', href: `#/budget/${month}/${c.id}` },
          el('span', null, c.name, el('div', { class: 'muted small' }, `${d.months.filter((m) => m.received < m.plan).length} мес. с недоплатой`)),
          el('strong', { class: 'warn' }, formatWhole(d.debt, d.currency)),
        ));
      }
      root.append(card);
    }
  }

  // Ожидаемые поступления: этот и следующий месяц, задержанные — отдельно
  const nextMonth = shiftMonth(month, 1);
  const pendingIncome = await listPlanned({ to: monthRange(nextMonth).to, type: 'income' }, db);
  if (pendingIncome.length) {
    const rateNow = (await suggestRate(today, db))?.rate ?? null;
    const toEur = (/** @type {import('../repo/planned.js').PlannedPayment} */ p) => toEurCents(p.amount, p.currency, rateNow);
    const late = pendingIncome.filter((p) => expectedStatus(p, today).status === 'overdue');
    const sumFor = (/** @type {string} */ m) => incomeExpectations(pendingIncome, m, toEur).pending;
    const card = el('div', { class: 'card list-card' });
    card.append(el('div', { class: 'hero-label', style: 'padding-top:12px' }, 'Ожидаемые поступления'));
    const lines = [[month, sumFor(month)], [nextMonth, sumFor(nextMonth)]].filter(([, v]) => v);
    for (const [m, v] of lines) {
      card.append(el('div', { class: 'cat-row' }, el('span', { class: 'cat-name' }, `${m === month ? 'В этом месяце' : formatMonth(String(m))}`), el('strong', { class: 'income' }, money(Number(v)))));
    }
    if (late.length) {
      card.append(el('div', { class: 'small warn', style: 'padding:8px 0 4px' }, `Задерживается: ${late.length}`));
      const list = el('div', { class: 'list', style: 'margin:0 -16px 12px;border-radius:0;box-shadow:none;border-left:0;border-right:0' });
      for (const p of late) list.append(expectedRow(p, today, rateNow));
      card.append(list);
    }
    card.append(el('a', { class: 'menu-row', href: '#/budget' }, 'Все поступления в бюджете', el('span', null, '›')));
    root.append(card);
  }

  // Круг расходов по категориям (нажатие — операции категории)
  const byCategory = expensesByCategory(monthOps, new Map(categories.map((c) => [c.id, c])));
  const ring = donut(byCategory, month);
  if (ring) root.append(el('div', { class: 'card' }, el('div', { class: 'hero-label', style: 'margin-bottom:8px' }, 'На что уходят деньги'), ring));

  // Напоминание о резервной копии (п. 4.8 ТЗ)
  const reminder = backupReminder({
    enabled: (await getSetting('backupReminderEnabled', db)) ?? true,
    days: Number((await getSetting('backupReminderDays', db)) ?? DEFAULT_REMINDER_DAYS),
    lastBackupAt: (await getSetting('lastBackupAt', db)) ?? null,
    installedAt,
    now: new Date(),
  });
  if (reminder.show) {
    root.append(
      el('div', { class: 'banner banner-warn' },
        el('strong', null, 'Резервная копия'),
        el('div', { class: 'small' }, reminder.daysSince == null ? 'Копия данных ещё не делалась. Данные хранятся только на этом устройстве.' : `С последней копии прошло ${reminder.daysSince} дн.`),
        el('a', { class: 'btn btn-small', style: 'margin-top:8px', href: '#/backup' }, 'Сделать копию сейчас'),
      ),
    );
  }

  // Баннер о платежах сегодня и завтра
  const tomorrow = addDays(today, 1);
  const soon = await listUpcoming(today, tomorrow);
  if (soon.length) {
    const todayItems = soon.filter((u) => u.date === today);
    const tomorrowItems = soon.filter((u) => u.date === tomorrow);
    const parts = [];
    if (todayItems.length) parts.push(`сегодня: ${todayItems.map((u) => `${u.name} ${formatMoney(u.amount, u.currency)}`).join(', ')}`);
    if (tomorrowItems.length) parts.push(`завтра: ${tomorrowItems.map((u) => `${u.name} ${formatMoney(u.amount, u.currency)}`).join(', ')}`);
    root.append(el('a', { class: 'banner', href: '#/calendar' }, el('strong', null, 'Платежи'), el('div', { class: 'small' }, parts.join('; '))));
  }

  // Быстрый ввод расхода (п. 4.11 ТЗ)
  root.append(await quickEntry());

  // Ближайшие 7 дней
  const week = await listUpcoming(today, addDays(today, 6));
  root.append(el('h2', { class: 'section-title' }, 'Платежи на 7 дней'));
  if (!week.length) {
    root.append(emptyState('repeat', 'На ближайшую неделю платежей нет', 'Добавить платёж', '#/payments/new'));
  } else {
    let totalEur = 0;
    let unknown = 0;
    const rate = (await suggestRate(today, db))?.rate ?? null;
    for (const u of week) {
      const eur = toEurCents(u.amount, u.currency, rate);
      if (eur == null) unknown++;
      else totalEur += u.type === 'expense' ? eur : -eur;
    }
    const list = el('div', { class: 'list' });
    let lastDate = '';
    for (const u of week) {
      if (u.date !== lastDate) {
        lastDate = u.date;
        list.append(el('div', { class: 'date-head', style: 'padding:0 16px' }, u.date === today ? 'Сегодня' : u.date === tomorrow ? 'Завтра' : formatDate(u.date)));
      }
      list.append(upcomingRow(u));
    }
    root.append(list, el('p', { class: 'muted small', style: 'margin:0 4px 12px' }, `Итого к оплате: ${money(Math.max(0, totalEur))}${unknown ? ` (без курса: ${unknown})` : ''}`));
  }
  root.append(el('div', { class: 'btn-row' }, el('a', { class: 'btn btn-secondary', href: '#/calendar' }, 'Календарь'), el('a', { class: 'btn btn-secondary', href: '#/payments' }, 'Платежи')));
}
