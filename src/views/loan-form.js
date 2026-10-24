import { el, toast, confirmDialog, promptDialog, currentMonth } from '../ui.js';
import { parseAmount, amountToInput } from '../money.js';
import { navigate } from '../router.js';
import { createSchedule, updateSchedule, getSchedule, deleteSchedule } from '../repo/recurring.js';
import { listBanks, addBank } from '../repo/banks.js';
import { ensureLoanCategory } from '../repo/loans.js';
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
  let currency = existing?.currency ?? 'KZT';
  const currencyToggle = segmented([['KZT', '₸'], ['EUR', '€']], currency, (v) => (currency = /** @type {'EUR' | 'KZT'} */ (v)));
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
    field(existing ? 'Дата платежа (её число — день платежа каждый месяц)' : 'Дата ближайшего платежа', startInput, el('p', { class: 'muted small' }, 'Число этой даты — день платежа каждый месяц.')),
    field('Когда закончится', endToggle),
    endDateField,
    countField,
    el('p', { class: 'muted small' }, 'В день платежа кредит появится в календаре, на главной и в «Платежах». В расходы он попадёт, когда вы нажмёте «Оплачено» — так факт совпадает с тем, что вы реально заплатили.'),
    el('div', { class: 'form-actions' }, el('button', { class: 'btn', type: 'submit' }, 'Сохранить')),
    existing ? el('button', { class: 'btn btn-danger', type: 'button', onclick: remove }, 'Удалить кредит') : null,
  );
  root.append(form);

  /** @param {Event} e */
  async function save(e) {
    e.preventDefault();
    const bank = bankSelect.value;
    if (!bank || bank === ADD_BANK) return toast('Выберите банк', { error: true });
    const amount = parseAmount(/** @type {HTMLInputElement} */ (amountInput).value);
    if (amount == null) return toast('Введите платёж в месяц, например 45000', { error: true });
    try {
      const data = {
        name: loanName(bank, /** @type {HTMLInputElement} */ (purposeInput).value),
        bank,
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
