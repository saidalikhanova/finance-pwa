import { el, emptyState, toast, confirmDialog, formatDate } from '../ui.js';
import { formatMoney } from '../money.js';
import { listSchedules, setScheduleStatus, deleteSchedule } from '../repo/recurring.js';
import { listPlanned, deletePlanned } from '../repo/planned.js';
import { listUpcoming } from '../repo/upcoming.js';
import { listCategories } from '../repo/categories.js';
import { todayISO } from '../repo/operations.js';
import { nextOccurrence, remaining, PERIOD_LABEL } from '../recurring.js';
import { addDays } from '../dates.js';
import { buildIcs, shareOrDownload } from '../ics.js';

const STATUS_LABEL = { active: 'активен', paused: 'приостановлен', finished: 'завершён' };

/** @param {HTMLElement} root */
export async function renderPayments(root) {
  const body = el('div');
  root.append(body);

  async function refresh() {
    const today = todayISO();
    const [schedules, planned, categories] = await Promise.all([listSchedules(), listPlanned({ from: today }), listCategories({ includeArchived: true })]);
    const catName = (/** @type {string} */ id) => categories.find((c) => c.id === id)?.name ?? 'Без категории';
    body.innerHTML = '';

    body.append(
      el(
        'div',
        { class: 'btn-row' },
        el('a', { class: 'btn', href: '#/payments/new' }, '+ Повторяющийся'),
        el('a', { class: 'btn btn-secondary', href: '#/planned/new' }, '+ Разовый'),
      ),
    );

    // Повторяющиеся
    body.append(el('h2', { class: 'section-title' }, 'Повторяющиеся платежи'));
    if (!schedules.length) body.append(emptyState('repeat', 'Аренда, подписки, кредит, зарплата — заведите один раз, операции будут создаваться сами', 'Добавить', '#/payments/new'));
    for (const s of schedules) {
      const next = nextOccurrence(s, addDays(today, -1));
      const rem = remaining(s);
      const lines = [`${PERIOD_LABEL[s.period]}${s.period === 'custom' ? ` (${s.intervalDays} дн.)` : ''} · ${catName(s.categoryId)}`];
      if (s.status === 'active' && next) lines.push(`Следующий: ${formatDate(next.date)}`);
      if (rem) lines.push(rem.count ? `Осталось ${rem.count} пл. на ${formatMoney(rem.amount, s.currency)}` : 'Все платежи выполнены');
      if (s.status !== 'active') lines.push(STATUS_LABEL[s.status]);

      const actions = el('div', { class: 'row-actions' });
      if (s.status === 'active') actions.append(linkBtn('Приостановить', () => change(s.id, 'paused')));
      if (s.status === 'paused') actions.append(linkBtn('Возобновить', () => change(s.id, 'active')));
      if (s.status !== 'finished') actions.append(linkBtn('Завершить', async () => (await confirmDialog(`Завершить «${s.name}» досрочно? Созданные операции останутся.`)) && change(s.id, 'finished')));
      actions.append(linkBtn('Удалить', async () => {
        if (!(await confirmDialog(`Удалить «${s.name}»? Созданные операции останутся.`))) return;
        await deleteSchedule(s.id);
        refresh();
      }));

      body.append(
        el(
          'div',
          { class: `card pay-card${s.status === 'finished' ? ' muted' : ''}` },
          el(
            'a',
            { class: 'row-top', href: `#/payments/${s.id}` },
            el('div', { class: 'row-main' }, el('div', null, s.name), el('div', { class: 'muted small' }, lines.join(' · '))),
            el('div', { class: `row-amount ${s.type}` }, formatMoney(s.type === 'expense' ? -s.amount : s.amount, s.currency, { sign: true })),
          ),
          actions,
        ),
      );
    }

    // Разовые
    body.append(el('h2', { class: 'section-title' }, 'Разовые запланированные'));
    if (!planned.length) body.append(emptyState('document', 'Разовые платежи: страховка, кружок, налог — напоминание в календаре', 'Добавить', '#/planned/new'));
    for (const p of planned) {
      body.append(
        el(
          'div',
          { class: 'card pay-card' },
          el(
            'a',
            { class: 'row-top', href: `#/planned/${p.id}` },
            el('div', { class: 'row-main' }, el('div', null, p.name), el('div', { class: 'muted small' }, `${formatDate(p.date)} · ${catName(p.categoryId)}`)),
            el('div', { class: `row-amount ${p.type}` }, formatMoney(p.type === 'expense' ? -p.amount : p.amount, p.currency, { sign: true })),
          ),
          el(
            'div',
            { class: 'row-actions' },
            el('a', { class: 'link-btn', href: `#/operations/new?planned=${p.id}` }, 'Оплачено'),
            linkBtn('Удалить', async () => {
              if (!(await confirmDialog(`Удалить «${p.name}»?`))) return;
              await deletePlanned(p.id);
              refresh();
            }),
          ),
        ),
      );
    }

    body.append(
      el('h2', { class: 'section-title' }, 'Календарь телефона'),
      el('p', { class: 'muted small' }, 'Файл .ics с платежами на 12 месяцев вперёд: откройте его на телефоне, чтобы добавить напоминания в системный календарь.'),
      el('button', { class: 'btn btn-secondary', onclick: exportIcs }, 'Выгрузить в календарь (.ics)'),
    );

    /** @param {string} id @param {'active' | 'paused' | 'finished'} status */
    async function change(id, status) {
      await setScheduleStatus(id, status, today);
      refresh();
    }
  }

  async function exportIcs() {
    const today = todayISO();
    const items = await listUpcoming(today, addDays(today, 365));
    if (!items.length) {
      toast('Нет платежей для выгрузки', { error: true });
      return;
    }
    const events = items.map((u) => ({
      uid: `${u.source}-${u.refId}-${u.date}@finance`,
      date: u.date,
      title: `${u.name}: ${formatMoney(u.amount, u.currency)}`,
      description: u.type === 'expense' ? 'Платёж' : 'Поступление',
    }));
    const result = await shareOrDownload(buildIcs(events), `платежи-${today}.ics`, 'text/calendar');
    if (result !== 'cancelled') toast(`Подготовлено событий: ${events.length}`);
  }

  await refresh();
}

/** @param {string} text @param {() => unknown} onclick */
function linkBtn(text, onclick) {
  return el('button', { class: 'link-btn', type: 'button', onclick }, text);
}
