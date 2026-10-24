import { el, avatar, toast, confirmDialog, promptDialog, currentMonth, formatDate } from '../ui.js';
import { parseAmount, amountToInput } from '../money.js';
import { navigate } from '../router.js';
import { createSchedule, updateSchedule, getSchedule, deleteSchedule } from '../repo/recurring.js';
import { listBanks, addBank } from '../repo/banks.js';
import { ensureLoanCategory, loanDue, loanPayments } from '../repo/loans.js';
import { formatWhole } from '../money.js';
import { diffDays } from '../dates.js';
import { loanName, loanPurpose } from '../loans.js';
import { todayISO } from '../repo/operations.js';
import { field, segmented } from './form-parts.js';

const ADD_BANK = '__add__';

/**
 * Кредит: ежемесячный платёж банку. Хранится как повторяющийся платёж
 * в категории «Кредиты» с банком из справочника и подтверждением «Оплачено».
 * @param {HTMLElement} root
 * @param {Record<string, string>} params — id (правка), month (вернуться в бюджет месяца)
 */
export async function renderLoanForm(root, params) {
  const existing = params.id ? await getSchedule(params.id) : null;
  if (params.id && !existing) {
    root.append(el('p', { class: 'muted' }, 'Кредит не найден.'));
    return;
  }
  const title = document.getElementById('page-title');
  if (title) title.textContent = existing ? 'Кредит' : 'Новый кредит';

  const bankSelect = /** @type {HTMLSelectElement} */ (el('select', { class: 'select' }));
  async function fillBanks(/** @type {string | null | undefined} */ selected) {
    const banks = await listBanks();
    if (selected && !banks.includes(selected)) banks.unshift(selected);
    bankSelect.replaceChildren(
      el('option', { value: '', disabled: true }, banks.length ? 'Выберите банк' : 'Банков пока нет — добавьте'),
      ...banks.map((b) => el('option', { value: b }, b)),
      el('option', { value: ADD_BANK }, '+ Добавить банк…'),
    );
    bankSelect.value = selected ?? '';
  }
  await fillBanks(existing?.bank);
  let lastBank = bankSelect.value;
  bankSelect.addEventListener('change', async () => {
    if (bankSelect.value !== ADD_BANK) {
      lastBank = bankSelect.value;
      return;
    }
    const name = await promptDialog('Название банка', '');
    if (!name?.trim()) {
      bankSelect.value = lastBank;
      return;
    }
    try {
      lastBank = await addBank(name);
      await fillBanks(lastBank);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Ошибка', { error: true });
      bankSelect.value = lastBank;
    }
  });

  const purposeInput = el('input', { class: 'input', value: existing ? loanPurpose(existing) : '', placeholder: 'ипотека, авто, потребительский', maxlength: 60 });
  const amountInput = el('input', { class: 'input input-amount', inputmode: 'decimal', autocomplete: 'off', placeholder: '0', value: existing ? amountToInput(existing.amount).replace(/,00$/, '') : '' });
  const principalInput = el('input', { class: 'input input-amount', inputmode: 'decimal', autocomplete: 'off', placeholder: '0', value: existing?.principal ? amountToInput(existing.principal).replace(/,00$/, '') : '' });
  let currency = existing?.currency ?? 'KZT';
  const principalUnit = el('span', { class: 'muted' }, currency === 'KZT' ? '₸' : '€');
  const currencyToggle = segmented([['KZT', '₸'], ['EUR', '€']], currency, (v) => {
    currency = /** @type {'EUR' | 'KZT'} */ (v);
    principalUnit.textContent = currency === 'KZT' ? '₸' : '€';
  });
  const startInput = /** @type {HTMLInputElement} */ (el('input', { class: 'input', type: 'date', value: existing?.startDate ?? todayISO() }));

  let endType = existing?.endType ?? 'date';
  const endDateInput = /** @type {HTMLInputElement} */ (el('input', { class: 'input', type: 'date', value: existing?.endDate ?? '' }));
  const countInput = /** @type {HTMLInputElement} */ (el('input', { class: 'input', type: 'number', min: 1, step: 1, inputmode: 'numeric', value: existing?.count ?? '' }));
  const endDateField = field('Дата последнего платежа', endDateInput);
  const countField = field('Сколько платежей осталось (включая ближайший)', countInput);
  const endToggle = segmented([['date', 'До даты'], ['count', 'Число платежей'], ['none', 'Не знаю']], endType, (v) => {
    endType = v;
    showEnd();
  });
  function showEnd() {
    endDateField.hidden = endType !== 'date';
    countField.hidden = endType !== 'count';
  }
  showEnd();

  const form = el(
    'form',
    { class: 'form', novalidate: true, onsubmit: save },
    field('Банк', bankSelect, el('p', { class: 'muted small' }, 'Список банков — «Ещё» → «Банки».')),
    field('Что за кредит (необязательно)', purposeInput),
    field('Платёж в месяц', el('div', { class: 'amount-row' }, amountInput, currencyToggle)),
    field('Сумма кредита (основной долг), необязательно', el('div', { class: 'amount-row' }, principalInput, principalUnit), el('p', { class: 'muted small' }, 'Сколько взяли в кредит или сколько основного долга осталось — как вам удобнее. В той же валюте, что и платёж.')),
    field(existing ? 'Дата платежа (её число — день платежа каждый месяц)' : 'Дата ближайшего платежа', startInput, el('p', { class: 'muted small' }, 'Число этой даты — день платежа каждый месяц.')),
    field('Когда закончится', endToggle),
    endDateField,
    countField,
    el('p', { class: 'muted small' }, 'В день платежа кредит появится в календаре, на главной и в «Платежах». В расходы он попадёт, когда вы нажмёте «Оплачено» — так факт совпадает с тем, что вы реально заплатили.'),
    el('div', { class: 'form-actions' }, el('button', { class: 'btn', type: 'submit' }, 'Сохранить')),
    existing ? el('button', { class: 'btn btn-danger', type: 'button', onclick: remove }, 'Удалить кредит') : null,
  );
  // У заведённого кредита — ближайший платёж с «Оплачено» и история оплат
  if (existing) {
    const status = await loanStatus(existing);
    const pays = await loanPayments(existing.id);
    const history = el('div', { class: 'list', style: 'margin:8px 0 0' });
    for (const o of pays) {
      history.append(el('a', { class: 'row', href: `#/operations/${o.id}` },
        avatar(existing.bank ?? existing.name, { small: true }),
        el('div', { class: 'row-main' }, el('div', null, formatDate(o.date)), o.comment && o.comment !== existing.name ? el('div', { class: 'muted small' }, o.comment) : null),
        el('div', { class: 'row-amount expense' }, formatWhole(-o.amount, o.currency)),
      ));
    }
    root.append(el('div', { class: 'card' },
      el('div', { class: 'card-title' }, 'Платежи'),
      status.text ? el('p', { class: `small ${status.late ? 'warn' : ''}`, style: 'margin:0 0 8px' }, status.text) : null,
      status.canPay ? el('a', { class: 'btn', style: 'width:100%', href: `#/operations/new?loan=${existing.id}` }, 'Оплачено') : null,
      el('div', { class: 'field-label', style: 'margin-top:12px' }, 'История оплат'),
      pays.length ? history : el('p', { class: 'muted small', style: 'margin:4px 0 0' }, 'Оплат пока нет.'),
    ));
  }
  root.append(form);

  /** @param {Event} e */
  async function save(e) {
    e.preventDefault();
    const bank = bankSelect.value;
    if (!bank || bank === ADD_BANK) return toast('Выберите банк', { error: true });
    const amount = parseAmount(/** @type {HTMLInputElement} */ (amountInput).value);
    if (amount == null) return toast('Введите платёж в месяц, например 45000', { error: true });
    const principalText = /** @type {HTMLInputElement} */ (principalInput).value.trim();
    const principal = principalText ? parseAmount(principalText) : null;
    if (principalText && principal == null) return toast('Сумма кредита: введите число, например 2000000', { error: true });
    try {
      const data = {
        name: loanName(bank, /** @type {HTMLInputElement} */ (purposeInput).value),
        bank,
        principal,
        type: /** @type {const} */ ('expense'),
        amount,
        currency: /** @type {'EUR' | 'KZT'} */ (currency),
        categoryId: existing?.categoryId ?? (await ensureLoanCategory()),
        period: /** @type {const} */ ('monthly'),
        intervalDays: 0,
        startDate: startInput.value,
        endType: /** @type {any} */ (endType),
        endDate: endDateInput.value || null,
        count: Number(countInput.value),
        confirm: true,
      };
      if (existing) await updateSchedule(existing.id, data);
      else await createSchedule(data);
      toast(existing ? 'Кредит изменён' : 'Кредит добавлен — платежи появятся в календаре');
      back(data.categoryId);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Не удалось сохранить', { error: true });
    }
  }

  async function remove() {
    if (!existing) return;
    if (!(await confirmDialog(`Удалить «${existing.name}»? Уже записанные оплаты останутся в расходах.`, 'Удалить'))) return;
    await deleteSchedule(existing.id);
    toast('Кредит удалён');
    back(existing.categoryId);
  }

  /** @param {string} categoryId */
  function back(categoryId) {
    navigate(params.month ? `/budget/${params.month}/${categoryId}` : `/budget/${currentMonth()}/${categoryId}`);
  }
}

/**
 * Состояние кредита для списка: ближайший платёж, просрочка, последняя оплата.
 * @param {import('../recurring.js').Schedule} s
 * @returns {Promise<{ text: string, late: boolean, canPay: boolean }>}
 */
export async function loanStatus(s) {
  const today = todayISO();
  const due = await loanDue(s);
  const [last] = await loanPayments(s.id);
  const lastText = last ? `оплачено ${formatDate(last.date)} — ${formatWhole(last.amount, last.currency)}` : '';
  if (!due) return { text: lastText || 'платежей по графику больше нет', late: false, canPay: false };
  const late = due.date < today;
  const dueText = late ? `просрочен ${diffDays(due.date, today)} дн. — платёж ${formatDate(due.date)}` : `следующий платёж ${formatDate(due.date)}`;
  return { text: [dueText, lastText].filter(Boolean).join(' · '), late, canPay: true };
}
