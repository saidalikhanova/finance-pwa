import { el, formatDate, formatMonth, currentMonth } from '../ui.js';
import { getDb, getSetting, setSetting } from '../db.js';
import { formatMoney, toEurCents } from '../money.js';
import { listUpcoming } from '../repo/upcoming.js';
import { listOperations, monthRange, sumByCategory, todayISO } from '../repo/operations.js';
import { getBudget } from '../repo/budgets.js';
import { listCategories } from '../repo/categories.js';
import { summary } from '../reports.js';
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
    el('div', { class: 'hero-label' }, `Расходы за ${formatMonth(month).toLowerCase()}`),
    el('div', { class: 'hero-value' }, formatMoney(s.expense, 'EUR')),
    el('div', { class: 'hero-grid' },
      el('div', null, el('div', { class: 'small' }, 'Доходы'), el('strong', { class: 'income' }, formatMoney(s.income, 'EUR'))),
      el('div', null, el('div', { class: 'small' }, 'Баланс'), el('strong', { class: s.balance < 0 ? 'over' : '' }, formatMoney(s.balance, 'EUR', { sign: true }))),
    ),
  );
  if (limitTotal > 0) {
    const st = limitStatus(limitTotal, limitSpent, month, today);
    hero.append(
      el('div', { class: `bar bar-${st.level}` }, el('div', { class: 'bar-fill', style: `width:${Math.min(100, st.percent)}%` })),
      el('div', { class: 'small muted' }, `Лимиты: ${formatMoney(limitSpent, 'EUR')} из ${formatMoney(limitTotal, 'EUR')} (${st.percent} %)${limitOver ? ` · превышено: ${limitOver}` : ''}`),
    );
  }
  root.append(hero);

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
    root.append(el('p', { class: 'muted', style: 'margin:0 4px 12px' }, 'Платежей не запланировано.'));
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
    root.append(list, el('p', { class: 'muted small', style: 'margin:0 4px 12px' }, `Итого к оплате: ${formatMoney(Math.max(0, totalEur), 'EUR')}${unknown ? ` (без курса: ${unknown})` : ''}`));
  }
  root.append(el('div', { class: 'btn-row' }, el('a', { class: 'btn btn-secondary', href: '#/calendar' }, 'Календарь'), el('a', { class: 'btn btn-secondary', href: '#/payments' }, 'Платежи')));
}
