import { el, avatar, toast } from '../ui.js';
import { parseAmount } from '../money.js';
import { navigate } from '../router.js';
import { listCategories } from '../repo/categories.js';
import { createOperation, sumByCategory, todayISO } from '../repo/operations.js';
import { getBudgetLine } from '../repo/budgets.js';
import { limitStatus, limitMessage } from '../limits.js';

/**
 * Быстрый экран добавления расхода (по кнопке «+»): сумма крупно, категории с иконками,
 * дата — сегодня. «Подробнее» ведёт в полную форму с уже введёнными значениями.
 * @param {HTMLElement} root
 */
export async function renderQuickAdd(root) {
  const categories = await listCategories({ kind: 'expense' });
  /** @type {import('../repo/categories.js').Category | null} */
  let selected = null;

  const amountInput = el('input', { class: 'input quick-amount', inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00', 'aria-label': 'Сумма, €' });
  const dateInput = el('input', { class: 'input', type: 'date', value: todayISO(), 'aria-label': 'Дата' });
  const chips = el('div', { class: 'chips' });
  const hint = el('p', { class: 'muted small', style: 'text-align:center' }, 'Выберите категорию');
  for (const c of categories) {
    const chip = el('button', { type: 'button', class: 'chip', onclick: () => {
      selected = c;
      chips.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === chip));
      hint.textContent = c.name;
    } }, avatar(c.name, { small: true }), c.name);
    chips.append(chip);
  }

  const form = el(
    'form',
    { class: 'form quick-add', novalidate: true, onsubmit: save },
    el('div', { class: 'quick-amount-wrap' }, amountInput, el('span', { class: 'quick-currency' }, '€')),
    hint,
    chips,
    el('div', { class: 'field', style: 'margin-top:12px' }, el('span', { class: 'field-label' }, 'Дата'), dateInput),
    el('div', { class: 'form-actions' }, el('button', { class: 'btn', type: 'submit' }, 'Сохранить')),
    el('a', { class: 'link-btn', style: 'display:block;text-align:center', href: '#/operations/new', onclick: toFull }, 'Подробнее: тенге, позиции чека, фото, доход'),
  );
  root.append(form);
  amountInput.focus();

  /** @param {Event} e */
  function toFull(e) {
    e.preventDefault();
    const q = new URLSearchParams();
    const amount = parseAmount(amountInput.value);
    if (amount != null) q.set('amount', String(amount));
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
      toast('Выберите категорию', { error: true });
      return;
    }
    const date = dateInput.value || todayISO();
    await createOperation({ type: 'expense', amount, currency: 'EUR', date, categoryId: selected.id, comment: '' });
    const month = date.slice(0, 7);
    const line = await getBudgetLine(month, selected.id);
    if (line?.limit != null) {
      const spent = (await sumByCategory(month)).get(selected.id) ?? 0;
      const s = limitStatus(line.limit, spent, month, todayISO());
      toast(limitMessage(selected.name, s), { ms: 6000, error: s.level === 'over' });
    } else {
      toast('Расход сохранён');
    }
    navigate('/operations');
  }
}
