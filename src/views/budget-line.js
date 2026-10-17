import { el, toast, formatMonth } from '../ui.js';
import { parseAmount, amountToInput, formatMoney } from '../money.js';
import { navigate } from '../router.js';
import { getCategory } from '../repo/categories.js';
import { getBudgetLine, setBudgetLine } from '../repo/budgets.js';
import { sumByCategory } from '../repo/operations.js';
import { budgetState } from './budget.js';

/**
 * План и лимит категории на месяц.
 * @param {HTMLElement} root
 * @param {Record<string, string>} params — { month, categoryId }
 */
export async function renderBudgetLine(root, params) {
  const { month, categoryId } = params;
  const category = await getCategory(categoryId);
  if (!category || !/^\d{4}-\d{2}$/.test(month)) {
    root.append(el('p', { class: 'muted' }, 'Категория не найдена.'));
    return;
  }
  budgetState.month = month;
  const line = await getBudgetLine(month, categoryId);
  const fact = (await sumByCategory(month)).get(categoryId) ?? 0;
  const isExpense = category.kind === 'expense';

  const plannedInput = el('input', {
    class: 'input input-amount',
    inputmode: 'decimal',
    autocomplete: 'off',
    placeholder: '0,00',
    value: line?.planned != null ? amountToInput(line.planned) : '',
  });
  const limitInput = el('input', {
    class: 'input input-amount',
    inputmode: 'decimal',
    autocomplete: 'off',
    placeholder: '0,00',
    value: line?.limit != null ? amountToInput(line.limit) : '',
  });

  const form = el(
    'form',
    { class: 'form', novalidate: true, onsubmit: onSubmit },
    el('div', { class: 'card' }, el('div', { class: 'muted small' }, `${category.name} · ${formatMonth(month)}`), el('div', null, `Факт: ${formatMoney(fact, 'EUR')}`)),
    el('label', { class: 'field' }, el('span', { class: 'field-label' }, isExpense ? 'План расходов, €' : 'План доходов, €'), plannedInput),
    ...(isExpense
      ? [
          el(
            'label',
            { class: 'field' },
            el('span', { class: 'field-label' }, 'Лимит, €'),
            limitInput,
            el('p', { class: 'muted small' }, 'Предупреждение при 80 % и при превышении. Пустое поле — без лимита.'),
          ),
        ]
      : []),
    el('div', { class: 'form-actions' }, el('button', { class: 'btn', type: 'submit' }, 'Сохранить')),
  );
  root.append(form);
  plannedInput.focus();

  /** @param {Event} e */
  async function onSubmit(e) {
    e.preventDefault();
    const planned = parseOptional(plannedInput.value);
    const limit = isExpense ? parseOptional(limitInput.value) : null;
    if (planned === false || limit === false) {
      toast('Введите сумму, например 200 или 150,50', { error: true });
      return;
    }
    try {
      await setBudgetLine(month, categoryId, { planned, limit });
      toast('Сохранено');
      navigate('/budget');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Не удалось сохранить', { error: true });
    }
  }
}

/**
 * Пусто → null, корректная сумма → число, иначе false.
 * @param {string} value
 * @returns {number | null | false}
 */
function parseOptional(value) {
  if (!value.trim()) return null;
  const s = value.replace(/\s+/g, '').replace(',', '.');
  if (s === '0' || s === '0.00' || s === '0.0') return 0;
  return parseAmount(value) ?? false;
}
