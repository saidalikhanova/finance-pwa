import { el, toast } from '../ui.js';
import { parseAmount, amountToInput } from '../money.js';
import { navigate } from '../router.js';
import { listCategories } from '../repo/categories.js';
import { createPlanned, updatePlanned, getPlanned } from '../repo/planned.js';
import { todayISO } from '../repo/operations.js';
import { field, segmented, categorySelectFor } from './form-parts.js';

/**
 * Форма разового запланированного платежа.
 * @param {HTMLElement} root
 * @param {Record<string, string>} params
 */
export async function renderPlannedForm(root, params) {
  const existing = params.id ? await getPlanned(params.id) : null;
  if (params.id && !existing) {
    root.append(el('p', { class: 'muted' }, 'Платёж не найден.'));
    return;
  }
  const categories = await listCategories({ includeArchived: true });

  const nameInput = el('input', { class: 'input', value: existing?.name ?? '', placeholder: 'Страховка, кружок…', maxlength: 80 });
  const typeInput = el('input', { type: 'hidden', value: existing?.type ?? 'expense' });
  const typeToggle = segmented([['expense', 'Расход'], ['income', 'Доход']], typeInput.value, (v) => {
    typeInput.value = v;
    categorySelect.fill(v);
  });
  const amountInput = el('input', { class: 'input input-amount', inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00', value: existing ? amountToInput(existing.amount) : '' });
  const currencyInput = el('input', { type: 'hidden', value: existing?.currency ?? 'EUR' });
  const currencyToggle = segmented([['EUR', '€'], ['KZT', '₸']], currencyInput.value, (v) => (currencyInput.value = v));
  const categorySelect = categorySelectFor(categories, existing?.categoryId);
  categorySelect.fill(typeInput.value);
  const dateInput = el('input', { class: 'input', type: 'date', value: existing?.date ?? todayISO() });

  root.append(
    el(
      'form',
      { class: 'form', novalidate: true, onsubmit: onSubmit },
      field('Название', nameInput),
      field('Тип', typeToggle),
      field('Сумма', el('div', { class: 'amount-row' }, amountInput, currencyToggle)),
      field('Дата платежа', dateInput),
      field('Категория', categorySelect.el),
      el('p', { class: 'muted small' }, 'Это напоминание в календаре. Когда платёж совершён, нажмите «Оплачено» — откроется форма операции с заполненными полями.'),
      el('div', { class: 'form-actions' }, el('button', { class: 'btn', type: 'submit' }, 'Сохранить')),
    ),
  );
  if (!existing) nameInput.focus();

  /** @param {Event} e */
  async function onSubmit(e) {
    e.preventDefault();
    const amount = parseAmount(amountInput.value);
    if (amount == null) {
      toast('Введите сумму', { error: true });
      return;
    }
    const data = {
      name: nameInput.value,
      type: /** @type {'expense' | 'income'} */ (typeInput.value),
      amount,
      currency: /** @type {'EUR' | 'KZT'} */ (currencyInput.value),
      categoryId: categorySelect.el.value,
      date: dateInput.value,
    };
    try {
      if (existing) await updatePlanned(existing.id, data);
      else await createPlanned(data);
      toast('Сохранено');
      navigate('/payments');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Не удалось сохранить', { error: true });
    }
  }
}
