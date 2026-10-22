import { el, toast, confirmDialog, formatDate } from '../ui.js';
import { parseAmount, formatWhole } from '../money.js';
import { navigate } from '../router.js';
import { createDebt, getDebt, addBorrow, updateDebt, repay, deleteDebt, listRepayments } from '../repo/debts.js';
import { saveRate, suggestRate } from '../repo/rates.js';
import { todayISO } from '../repo/operations.js';
import { debtStatus } from '../debts.js';
import { debtLabel } from './debts.js';
import { currencyControls } from './currency-input.js';
import { field, segmented } from './form-parts.js';

/**
 * Новый долг или карточка долга: остаток, «Отдала», «Заняла ещё», история.
 * @param {HTMLElement} root
 * @param {Record<string, string>} params
 */
export async function renderDebt(root, params) {
  const today = todayISO();
  if (!params.id) return renderNew(root, today);

  const debt = await getDebt(params.id);
  if (!debt) {
    root.append(el('p', { class: 'muted' }, 'Долг не найден.'));
    return;
  }
  const h = document.getElementById('page-title');
  if (h) h.textContent = debt.person;
  const rate = (await suggestRate(today))?.rate ?? null;
  const repayments = (await listRepayments()).filter((o) => o.debtId === debt.id);
  const st = debtStatus(debt, repayments, today, rate);

  // Остаток
  root.append(
    el('div', { class: `card debt-card ${st.status === 'closed' ? 'debt-ok' : 'debt-owed'}` },
      el('div', { class: 'card-title' }, st.status === 'closed' ? 'Долг закрыт' : 'Осталось вернуть'),
      el('div', { class: 'hero-value', style: 'font-size:30px;margin:0' }, st.status === 'closed' ? '✓' : formatWhole(st.remaining, debt.currency)),
      el('p', { class: 'muted small', style: 'margin:4px 0 0' },
        `Заняла ${formatWhole(st.borrowed, debt.currency)}, вернула ${formatWhole(st.repaid, debt.currency)} · ${debtLabel(st, debt.dueDate)}`),
      st.remaining < 0 ? el('p', { class: 'small', style: 'margin:4px 0 0' }, `Вернула больше на ${formatWhole(-st.remaining, debt.currency)}`) : null,
    ),
  );

  // Отдала (возврат = расход)
  if (st.status !== 'closed') {
    const amount = el('input', { class: 'input input-amount', inputmode: 'decimal', autocomplete: 'off', placeholder: '0' });
    const date = el('input', { class: 'input', type: 'date', value: today });
    const money = currencyControls({ date: () => date.value || today, amountInput: /** @type {HTMLInputElement} */ (amount), currency: debt.currency });
    root.append(
      el('div', { class: 'card' },
        el('div', { class: 'card-title' }, 'Отдала'),
        el('p', { class: 'muted small', style: 'margin:0 0 8px' }, 'Запишется расходом в категорию «Возврат долгов».'),
        el('div', { class: 'amount-row' }, amount, money.toggle),
        money.preview,
        money.rateField,
        el('div', { class: 'add-row' }, date, el('button', { class: 'btn', type: 'button', onclick: async () => {
          const a = money.amount();
          if (a == null) return toast('Введите сумму', { error: true });
          const r = money.rate();
          if (money.currency === 'KZT' && !r) return toast('Укажите курс тенге к евро', { error: true });
          await repay(debt.id, { amount: a, currency: money.currency, date: date.value || today, rate: r });
          if (r) await saveRate(date.value || today, r);
          toast('Возврат записан');
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        } }, 'Отдала')),
      ),
    );
  }

  // Заняла ещё
  const moreAmount = el('input', { class: 'input', inputmode: 'decimal', autocomplete: 'off', placeholder: `Сумма, ${debt.currency === 'KZT' ? '₸' : '€'}` });
  const moreDate = el('input', { class: 'input', type: 'date', value: today });
  root.append(
    el('details', { class: 'card list-card' },
      el('summary', null, 'Заняла ещё у этого человека'),
      el('div', { class: 'add-row' }, moreAmount, moreDate),
      el('button', { class: 'btn btn-secondary', type: 'button', style: 'width:100%;margin-bottom:12px', onclick: async () => {
        const a = parseAmount(moreAmount.value);
        if (a == null) return toast('Введите сумму', { error: true });
        await addBorrow(debt.id, { amount: a, date: moreDate.value || today });
        toast('Добавлено к долгу');
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } }, 'Добавить к долгу'),
    ),
  );

  // История
  const history = [
    ...debt.borrows.map((b) => ({ date: b.date, text: 'Заняла', amount: `+${formatWhole(b.amount, debt.currency)}`, cls: '', href: null })),
    ...repayments.map((o) => ({ date: o.date, text: 'Отдала', amount: `−${formatWhole(o.amount, o.currency)}`, cls: 'income', href: `#/operations/${o.id}` })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));
  const list = el('div', { class: 'list' });
  for (const h2 of history) {
    list.append(el(h2.href ? 'a' : 'div', { class: 'row', href: h2.href },
      el('div', { class: 'row-main' }, el('div', null, h2.text), el('div', { class: 'muted small' }, formatDate(h2.date))),
      el('div', { class: `row-amount ${h2.cls}` }, h2.amount),
    ));
  }
  root.append(el('h2', { class: 'section-title' }, 'История'), list);

  // Правка и удаление
  const person = el('input', { class: 'input', value: debt.person, maxlength: 60 });
  const due = el('input', { class: 'input', type: 'date', value: debt.dueDate ?? '' });
  const comment = el('input', { class: 'input', value: debt.comment, placeholder: 'Необязательно', maxlength: 200 });
  root.append(
    el('details', { class: 'card list-card' },
      el('summary', null, 'Изменить'),
      field('У кого', person),
      field('Вернуть до (необязательно)', due),
      field('Комментарий', comment),
      el('button', { class: 'btn', type: 'button', style: 'width:100%;margin-bottom:8px', onclick: async () => {
        try {
          await updateDebt(debt.id, { person: person.value, dueDate: due.value || null, comment: comment.value });
          toast('Сохранено');
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Ошибка', { error: true });
        }
      } }, 'Сохранить'),
      el('button', { class: 'btn btn-danger', type: 'button', style: 'margin-bottom:12px', onclick: async () => {
        if (!(await confirmDialog(`Удалить долг «${debt.person}»? Записанные возвраты останутся в расходах.`))) return;
        await deleteDebt(debt.id);
        toast('Удалено');
        navigate('/debts');
      } }, 'Удалить долг'),
    ),
  );
}

/** @param {HTMLElement} root @param {string} today */
function renderNew(root, today) {
  const person = el('input', { class: 'input', placeholder: 'Например: Айгуль', maxlength: 60 });
  const amount = el('input', { class: 'input input-amount', inputmode: 'decimal', autocomplete: 'off', placeholder: '0' });
  let currency = /** @type {'EUR' | 'KZT'} */ ('KZT');
  const toggle = segmented([['EUR', '€'], ['KZT', '₸']], currency, (v) => (currency = /** @type {'EUR' | 'KZT'} */ (v)));
  const date = el('input', { class: 'input', type: 'date', value: today });
  const due = el('input', { class: 'input', type: 'date' });
  const comment = el('input', { class: 'input', placeholder: 'Необязательно', maxlength: 200 });
  root.append(
    el('form', { class: 'form', novalidate: true, onsubmit: async (/** @type {Event} */ e) => {
      e.preventDefault();
      const a = parseAmount(amount.value);
      if (a == null) return toast('Введите сумму', { error: true });
      try {
        const d = await createDebt({ person: person.value, amount: a, currency, date: date.value || today, dueDate: due.value || null, comment: comment.value });
        toast('Долг записан');
        navigate(`/debts/${d.id}`);
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Ошибка', { error: true });
      }
    } },
      field('У кого заняла', person),
      field('Сколько', el('div', { class: 'amount-row' }, amount, toggle)),
      field('Когда', date),
      field('Вернуть до (необязательно)', due),
      field('Комментарий', comment),
      el('p', { class: 'muted small' }, 'Занятые деньги не считаются доходом. Возвраты будут записываться расходом «Возврат долгов».'),
      el('div', { class: 'form-actions' }, el('button', { class: 'btn', type: 'submit' }, 'Сохранить')),
    ),
  );
  person.focus();
}
