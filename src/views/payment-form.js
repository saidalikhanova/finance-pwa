import { el, toast } from '../ui.js';
import { parseAmount, amountToInput } from '../money.js';
import { navigate, goBack } from '../router.js';
import { listCategories } from '../repo/categories.js';
import { createSchedule, updateSchedule, getSchedule } from '../repo/recurring.js';
import { todayISO } from '../repo/operations.js';
import { PERIOD_LABEL } from '../recurring.js';
import { field, segmented, categorySelectFor } from './form-parts.js';
import { renderLoanForm } from './loan-form.js';

/**
 * Форма повторяющегося платежа.
 * @param {HTMLElement} root
 * @param {Record<string, string>} params
 */
export async function renderPaymentForm(root, params) {
  const existing = params.id ? await getSchedule(params.id) : null;
  if (params.id && !existing) {
    root.append(el('p', { class: 'muted' }, 'Платёж не найден.'));
    return;
  }
  // Кредит — своя форма (банк, платёж в месяц, срок)
  if (existing?.bank) return renderLoanForm(root, params);
  const categories = await listCategories({ includeArchived: true });

  const nameInput = el('input', { class: 'input', value: existing?.name ?? params.name ?? '', placeholder: 'Аренда, подписка, страховка…', maxlength: 80 });
  const typeInput = el('input', { type: 'hidden', value: existing?.type ?? 'expense' });
  const typeToggle = segmented([['expense', 'Расход'], ['income', 'Доход']], typeInput.value, (v) => {
    typeInput.value = v;
    categorySelect.fill(v);
    confirmHint.textContent = confirmText(v);
  });
  const confirmText = (/** @type {string} */ t) => (t === 'income'
    ? 'Для дохода, который приходит не точно в срок: каждый период появится как «ожидается», а в факт попадёт, когда вы нажмёте «Получено».'
    : 'В день платежа расход не записывается сам: платёж ждёт «Отметить оплату» — с фактической датой и суммой (например, страховка).');
  const confirmBox = /** @type {HTMLInputElement} */ (el('input', { type: 'checkbox', checked: existing ? Boolean(existing.confirm) : params.confirm === '1' }));
  const confirmHint = el('div', { class: 'muted small' }, confirmText(typeInput.value));
  const confirmField = el('label', { class: 'cat-row field' },
    confirmBox,
    el('span', { class: 'cat-name' }, 'Ждать подтверждения', confirmHint),
  );
  const amountInput = el('input', { class: 'input input-amount', inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00', value: existing ? amountToInput(existing.amount) : '' });
  const currencyInput = el('input', { type: 'hidden', value: existing?.currency ?? 'EUR' });
  const currencyToggle = segmented([['EUR', '€'], ['KZT', '₸']], currencyInput.value, (v) => (currencyInput.value = v));
  const categorySelect = categorySelectFor(categories, existing?.categoryId ?? params.category);
  categorySelect.fill(typeInput.value);

  const periodSelect = el('select', { class: 'select', onchange: updateVisibility }, ...Object.entries(PERIOD_LABEL).map(([v, l]) => el('option', { value: v }, l)));
  periodSelect.value = existing?.period ?? 'monthly';
  const intervalInput = el('input', { class: 'input', type: 'number', min: 1, step: 1, value: existing?.intervalDays || 30 });
  const intervalField = field('Интервал, дней', intervalInput);
  const startInput = el('input', { class: 'input', type: 'date', value: existing?.startDate ?? todayISO() });

  const endInput = el('input', { type: 'hidden', value: existing?.endType ?? 'none' });
  const endToggle = segmented([['none', 'Бессрочно'], ['date', 'До даты'], ['count', 'Число платежей']], endInput.value, (v) => {
    endInput.value = v;
    updateVisibility();
  });
  const endDateInput = el('input', { class: 'input', type: 'date', value: existing?.endDate ?? '' });
  const endDateField = field('Дата окончания', endDateInput);
  const countInput = el('input', { class: 'input', type: 'number', min: 1, step: 1, value: existing?.count ?? 12 });
  const countField = field('Число платежей', countInput);

  function updateVisibility() {
    intervalField.hidden = periodSelect.value !== 'custom';
    endDateField.hidden = endInput.value !== 'date';
    countField.hidden = endInput.value !== 'count';
  }
  updateVisibility();

  const form = el(
    'form',
    { class: 'form', novalidate: true, onsubmit: onSubmit },
    field('Название', nameInput),
    field('Тип', typeToggle),
    field('Сумма', el('div', { class: 'amount-row' }, amountInput, currencyToggle), currencyInput.value === 'KZT' ? null : null),
    field('Категория', categorySelect.el),
    field('Периодичность', periodSelect),
    intervalField,
    field(existing ? 'Дата первого платежа (задаёт день платежа)' : 'Дата первого платежа', startInput, el('p', { class: 'muted small' }, 'День этой даты становится днём платежа: для ежемесячных — число месяца, для еженедельных — день недели.')),
    field('Срок действия', endToggle),
    endDateField,
    countField,
    confirmField,
    el('div', { class: 'form-actions' }, el('button', { class: 'btn', type: 'submit' }, 'Сохранить')),
  );
  if (existing) form.append(el('p', { class: 'muted small' }, `Создано операций: ${existing.generatedCount}. Изменения действуют со следующего платежа; созданные операции не меняются.`));
  root.append(form);
  if (!existing) nameInput.focus();

  /** @param {Event} e */
  async function onSubmit(e) {
    e.preventDefault();
    const amount = parseAmount(amountInput.value);
    if (amount == null) {
      toast('Введите сумму, например 450', { error: true });
      return;
    }
    const data = {
      name: nameInput.value,
      type: /** @type {'expense' | 'income'} */ (typeInput.value),
      amount,
      currency: /** @type {'EUR' | 'KZT'} */ (currencyInput.value),
      categoryId: categorySelect.el.value,
      period: /** @type {any} */ (periodSelect.value),
      intervalDays: Number(intervalInput.value),
      startDate: startInput.value,
      endType: /** @type {any} */ (endInput.value),
      endDate: endDateInput.value || null,
      count: Number(countInput.value),
      confirm: confirmBox.checked,
      bank: existing?.bank ?? null,
      principal: existing?.principal ?? null,
    };
    try {
      if (existing) await updateSchedule(existing.id, data);
      else await createSchedule(data);
      toast(existing ? 'Платёж изменён' : data.confirm
        ? 'Платёж сохранён. В срок он появится в календаре — отметьте оплату, когда заплатите.'
        : 'Платёж сохранён. Операции будут создаваться по расписанию.');
      // Пришли со статьи бюджета — туда и возвращаемся
      if (params.category) goBack();
      else navigate('/payments');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Не удалось сохранить', { error: true });
    }
  }
}
