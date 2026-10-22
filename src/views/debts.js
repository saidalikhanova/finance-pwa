import { el, avatar, emptyState, formatDate } from '../ui.js';
import { formatWhole } from '../money.js';
import { listDebts, listRepayments } from '../repo/debts.js';
import { suggestRate } from '../repo/rates.js';
import { todayISO } from '../repo/operations.js';
import { debtStatus, totalsByCurrency } from '../debts.js';

/** Подпись статуса долга. @param {ReturnType<typeof debtStatus>} st @param {string | null} due */
export function debtLabel(st, due) {
  if (st.status === 'closed') return 'закрыт';
  if (st.status === 'overdue') return `просрочен на ${st.daysLate} дн.`;
  return due ? `вернуть до ${formatDate(due)}` : 'без срока';
}

/** @param {HTMLElement} root */
export async function renderDebts(root) {
  const today = todayISO();
  const [debts, repayments] = await Promise.all([listDebts(), listRepayments()]);
  const rate = (await suggestRate(today))?.rate ?? null;
  const rows = debts.map((debt) => ({ debt, st: debtStatus(debt, repayments, today, rate) }));
  const open = rows.filter((r) => r.st.status !== 'closed');
  const closed = rows.filter((r) => r.st.status === 'closed');

  root.append(el('a', { class: 'btn', style: 'width:100%;margin-bottom:12px', href: '#/debts/new' }, '+ Заняла'));

  if (!rows.length) {
    root.append(emptyState('bank', 'Здесь будут ваши долги: кому, сколько и сколько уже вернули', 'Записать долг', '#/debts/new'));
    return;
  }

  const totals = totalsByCurrency(open);
  root.append(
    el('div', { class: `card ${open.length ? 'debt-owed' : ''}` },
      el('div', { class: 'hero-label' }, 'Вы должны всего'),
      el('div', { class: 'hero-value', style: 'font-size:28px;margin:2px 0 0' },
        totals.size ? [...totals].map(([c, v]) => formatWhole(v, c)).join(' + ') : 'Ничего'),
    ),
  );

  if (open.length) {
    const list = el('div', { class: 'list' });
    for (const r of open) list.append(debtRow(r));
    root.append(el('h2', { class: 'section-title' }, 'Открытые'), list);
  }
  if (closed.length) {
    const details = el('details', { class: 'card list-card' }, el('summary', { class: 'muted' }, `Закрытые: ${closed.length}`));
    const list = el('div', { class: 'list', style: 'margin:0 -16px 8px;border-radius:0;box-shadow:none;border-left:0;border-right:0' });
    for (const r of closed) list.append(debtRow(r));
    details.append(list);
    root.append(details);
  }
}

/** @param {{ debt: import('../debts.js').Debt, st: ReturnType<typeof debtStatus> }} r */
export function debtRow({ debt, st }) {
  return el('a', { class: 'row', href: `#/debts/${debt.id}` },
    avatar(debt.person),
    el('div', { class: 'row-main' },
      el('div', null, debt.person),
      el('div', { class: 'small' }, el('span', { class: `chip-status chip-${st.status === 'closed' ? 'received' : st.status === 'overdue' ? 'overdue' : 'expected'}` }, debtLabel(st, debt.dueDate))),
    ),
    el('div', { class: 'row-amount' },
      el('div', { class: st.status === 'closed' ? 'income' : st.status === 'overdue' ? 'warn' : '' }, st.status === 'closed' ? '✓' : formatWhole(st.remaining, debt.currency)),
      el('div', { class: 'muted small' }, `из ${formatWhole(st.borrowed, debt.currency)}`),
    ),
  );
}
