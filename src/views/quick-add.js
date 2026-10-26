import { el, avatar, toast } from '../ui.js';
import { parseAmount } from '../money.js';
import { navigate } from '../router.js';
import { listCategories } from '../repo/categories.js';
import { createOperation, sumByCategory, todayISO } from '../repo/operations.js';
import { getBudgetLine } from '../repo/budgets.js';
import { limitStatus, limitMessage } from '../limits.js';
import { saveRate } from '../repo/rates.js';
import { currencyControls } from './currency-input.js';
import { segmented } from './form-parts.js';
import { categoryChips } from './category-chips.js';
import { showLimitMessages } from './limit-check.js';

/**
 * Быстрый экран добавления (по кнопке «+»): расход или доход, сумма крупно,
 * валюта, категории с иконками, дата — сегодня. «Подробнее» ведёт в полную форму
 * с уже введёнными значениями.
 * @param {HTMLElement} root
 * @param {Record<string, string>} params — type=income, category=ID
 */
export async function renderQuickAdd(root, params = {}) {
  const all = await listCategories({});
  /** @type {'expense' | 'income'} */
  let type = params.type === 'income' ? 'income' : 'expense';
  /** @type {import('../repo/categories.js').Category | null} */
  let selected = null;

  const amountInput = el('input', { class: 'input quick-amount', inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00', 'aria-label': 'Сумма' });
  const dateInput = el('input', { class: 'input', type: 'date', value: params.date ?? todayISO(), 'aria-label': 'Дата' });
  const money = currencyControls({ date: () => dateInput.value || todayISO(), amountInput: /** @type {HTMLInputElement} */ (amountInput), currency: params.currency === 'KZT' ? 'KZT' : 'EUR' });
  const currencySign = el('span', { class: 'quick-currency' }, money.currency === 'KZT' ? '₸' : '€');
  money.toggle.addEventListener('click', () => (currencySign.textContent = money.currency === 'KZT' ? '₸' : '€'));
  dateInput.addEventListener('change', () => money.refreshSuggestion());

  const chips = el('div');
  const hint = el('p', { class: 'muted small', style: 'text-align:center' });
  /** @type {string} */
  let selectedLabel = '';
  function fillChips() {
    selected = null;
    hint.textContent = type === 'income' ? 'Выберите источник дохода' : 'Выберите категорию';
    // Категория, затем — статья внутри неё (если есть)
    const picker = categoryChips({ categories: all, kind: type, onSelect: (c, label) => {
      selected = c;
      selectedLabel = label;
      hint.textContent = label;
    } });
    chips.replaceChildren(picker.el);
    if (params.category) picker.select(params.category);
  }
  const typeToggle = segmented([['expense', 'Расход'], ['income', 'Доход']], type, (v) => {
    type = /** @type {'expense' | 'income'} */ (v);
    fillChips();
  });
  fillChips();

  const form = el(
    'form',
    { class: 'form quick-add', novalidate: true, onsubmit: save },
    el('div', { class: 'field' }, typeToggle),
    el('div', { class: 'quick-amount-wrap' }, amountInput, currencySign),
    el('div', { class: 'quick-currency-row' }, money.toggle),
    money.preview,
    money.rateField,
    hint,
    chips,
    el('div', { class: 'field', style: 'margin-top:12px' }, el('span', { class: 'field-label' }, 'Дата'), dateInput),
    el('div', { class: 'form-actions' }, el('button', { class: 'btn', type: 'submit' }, 'Сохранить')),
    el('a', { class: 'link-btn', style: 'display:block;text-align:center', href: '#/operations/new', onclick: toFull }, 'Подробнее: позиции чека, фото, комментарий'),
  );
  root.append(form);
  amountInput.focus();

  /** @param {Event} e */
  function toFull(e) {
    e.preventDefault();
    const q = new URLSearchParams();
    const amount = parseAmount(amountInput.value);
    if (amount != null) q.set('amount', String(amount));
    q.set('currency', money.currency);
    q.set('type', type);
    if (selected) q.set('category', selected.id);
    if (dateInput.value) q.set('date', dateInput.value);
    navigate(`/operations/new?${q}`);
  }

  /** @param {Event} e */
  async function save(e) {
    e.preventDefault();
    const amount = parseAmount(amountInput.value);
    if (amount == null) {
      toast('Введите сумму, например 12,50', { error: true });
      amountInput.focus();
      return;
    }
    if (!selected) {
      toast(type === 'income' ? 'Выберите источник дохода' : 'Выберите категорию', { error: true });
      return;
    }
    const date = dateInput.value || todayISO();
    const rate = money.rate();
    if (money.currency === 'KZT' && !rate) {
      toast('Укажите курс тенге к евро', { error: true });
      return;
    }
    await createOperation({ type, amount, currency: money.currency, date, categoryId: selected.id, comment: '', rate, rateSource: rate ? 'manual' : null });
    if (rate) await saveRate(date, rate);
    const month = date.slice(0, 7);
    const shown = type === 'expense' && (await showLimitMessages(month, [selected.id], all, todayISO()));
    if (!shown) toast(type === 'income' ? 'Доход записан' : `Расход сохранён: ${selectedLabel}`);
    navigate(type === 'income' ? '/budget' : '/operations');
  }
}
