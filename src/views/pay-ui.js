// Общие части для платежей по графику: состояние и история оплат.

import { el, avatar, formatDate } from '../ui.js';
import { formatWhole } from '../money.js';
import { todayISO } from '../repo/operations.js';
import { loanDue, loanPayments } from '../repo/loans.js';
import { payStatus } from '../pay-status.js';

/**
 * Состояние платежа по графику (кредит, страховка): ближайший срок, просрочка, последняя оплата.
 * @param {import('../recurring.js').Schedule} s
 * @returns {Promise<{ text: string, late: boolean, canPay: boolean, due: string | null }>}
 */
export async function loanStatus(s) {
  const today = todayISO();
  const due = await loanDue(s);
  const [last] = await loanPayments(s.id);
  const lastText = last ? `последняя оплата ${formatDate(last.date)} — ${formatWhole(last.amount, last.currency)}` : '';
  if (!due) return { text: lastText || 'платежей по графику больше нет', late: false, canPay: false, due: null };
  const st = payStatus({ date: due.date, type: s.type }, today);
  return { text: [st.text, lastText].filter(Boolean).join(' · '), late: st.kind === 'overdue', canPay: true, due: due.date };
}

/**
 * Свёрнутая история оплат по графику («оплачено 24 окт. · по графику 28 окт.»).
 * @param {import('../recurring.js').Schedule} s
 */
export async function historyDetails(s) {
  const pays = await loanPayments(s.id);
  if (!pays.length) return el('p', { class: 'muted small', style: 'margin:12px 0 0' }, 'Оплат пока нет.');
  const list = el('div', { class: 'list', style: 'margin:8px 0 0' });
  for (const o of pays) {
    const sched = o.scheduledDate && o.scheduledDate !== o.date ? `по графику ${formatDate(o.scheduledDate)}` : '';
    list.append(el('a', { class: 'row', href: `#/operations/${o.id}` },
      avatar(s.bank ?? s.name, { small: true }),
      el('div', { class: 'row-main' }, el('div', null, `${s.type === 'income' ? 'получено' : 'оплачено'} ${formatDate(o.date)}`), sched ? el('div', { class: 'muted small' }, sched) : null),
      el('div', { class: `row-amount ${s.type}` }, formatWhole(s.type === 'expense' ? -o.amount : o.amount, o.currency)),
    ));
  }
  return el('details', { style: 'margin-top:12px' }, el('summary', { class: 'small' }, `История (${pays.length})`), list);
}
