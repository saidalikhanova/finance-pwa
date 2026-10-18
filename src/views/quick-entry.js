import { el, toast } from '../ui.js';
import { parseAmount } from '../money.js';
import { listCategories } from '../repo/categories.js';
import { createOperation, sumByCategory, todayISO } from '../repo/operations.js';
import { getBudgetLine } from '../repo/budgets.js';
import { limitStatus, limitMessage } from '../limits.js';

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
  const form = el('form', { class: 'quick-form', hidden: true, novalidate: true, onsubmit: save }, amountInput, saveBtn);
  const hint = el('p', { class: 'muted small' }, 'Выберите категорию, введите сумму в евро — расход запишется сегодняшним днём.');

  /** @type {import('../repo/categories.js').Category | null} */
  let selected = null;

  for (const c of categories) {
    const chip = el('button', { type: 'button', class: 'chip', onclick: () => {
      selected = c;
      chips.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === chip));
      form.hidden = false;
      amountInput.focus();
      hint.textContent = `${c.name}: сумма в евро, дата — сегодня.`;
    } }, c.name);
    chips.append(chip);
  }

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
    await createOperation({ type: 'expense', amount, currency: 'EUR', date, categoryId: selected.id, comment: '' });
    const month = date.slice(0, 7);
    const line = await getBudgetLine(month, selected.id);
    if (line?.limit != null) {
      const spent = (await sumByCategory(month)).get(selected.id) ?? 0;
      const s = limitStatus(line.limit, spent, month, date);
      toast(limitMessage(selected.name, s), { ms: 6000, error: s.level === 'over' });
    } else {
      toast(`${selected.name}: записано ${amountInput.value.trim()} €`);
    }
    amountInput.value = '';
    form.hidden = true;
    selected = null;
    chips.querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
    hint.textContent = 'Выберите категорию, введите сумму в евро — расход запишется сегодняшним днём.';
    onSaved?.();
  }

  return el('div', { class: 'card' }, el('div', { class: 'field-label' }, 'Быстрый расход'), chips, form, hint);
}
