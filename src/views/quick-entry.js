import { el, avatar, toast } from '../ui.js';
import { parseAmount } from '../money.js';
import { listCategories } from '../repo/categories.js';
import { createOperation, sumByCategory, todayISO } from '../repo/operations.js';
import { getBudgetLine } from '../repo/budgets.js';
import { limitStatus, limitMessage } from '../limits.js';
import { saveRate } from '../repo/rates.js';
import { currencyControls } from './currency-input.js';
import { categoryChips } from './category-chips.js';
import { showLimitMessages } from './limit-check.js';

/**
 * Быстрый ввод расхода с главного экрана: категория → сумма → сохранить.
 * Валюта — евро, дата — сегодня.
 * @param {() => void} [onSaved]
 */
export async function quickEntry(onSaved) {
  const categories = await listCategories({ kind: 'expense' });
  const chips = el('div', { class: 'chips' });
  const amountInput = el('input', { class: 'input input-amount', inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00' });
  const saveBtn = el('button', { class: 'btn', type: 'submit' }, 'Сохранить');
  const money = currencyControls({ date: () => todayISO(), amountInput: /** @type {HTMLInputElement} */ (amountInput) });
  money.toggle.classList.add('segmented-compact');
  const form = el('form', { class: 'quick-form', hidden: true, novalidate: true, onsubmit: save }, el('div', { class: 'quick-form-row' }, amountInput, money.toggle, saveBtn), money.preview, money.rateField);
  const hint = el('p', { class: 'muted small' }, 'Выберите категорию, введите сумму — расход запишется сегодняшним днём.');

  /** @type {import('../repo/categories.js').Category | null} */
  let selected = null;

  /** @type {string} */
  let selectedLabel = '';
  // Категория, затем — статья внутри неё (если есть)
  const picker = categoryChips({ categories, kind: 'expense', onSelect: (c, label) => {
    selected = c;
    selectedLabel = label;
    form.hidden = false;
    hint.textContent = `${label}: сумма, дата — сегодня.`;
    money.refreshSuggestion();
  } });
  chips.append(picker.el);

  /** @param {Event} e */
  async function save(e) {
    e.preventDefault();
    if (!selected) return;
    const amount = parseAmount(amountInput.value);
    if (amount == null) {
      toast('Введите сумму, например 12,50', { error: true });
      return;
    }
    const date = todayISO();
    const rate = money.rate();
    if (money.currency === 'KZT' && !rate) {
      toast('Укажите курс тенге к евро', { error: true });
      return;
    }
    await createOperation({ type: 'expense', amount, currency: money.currency, date, categoryId: selected.id, comment: '', rate, rateSource: rate ? 'manual' : null });
    if (rate) await saveRate(date, rate);
    const month = date.slice(0, 7);
    const shown = await showLimitMessages(month, [selected.id], categories, date);
    if (!shown) toast(`${selectedLabel}: записано ${amountInput.value.trim()} ${money.currency === 'KZT' ? '₸' : '€'}`);
    amountInput.value = '';
    form.hidden = true;
    selected = null;
    picker.clear();
    hint.textContent = 'Выберите категорию, введите сумму — расход запишется сегодняшним днём.';
    onSaved?.();
  }

  return el('div', { class: 'card' }, el('div', { class: 'field-label' }, 'Быстрый расход'), chips, form, hint);
}
