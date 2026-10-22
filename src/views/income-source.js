import { el, toast, currentMonth } from '../ui.js';
import { navigate } from '../router.js';
import { createCategory, setIncomeTerms } from '../repo/categories.js';
import { setBudgetLine } from '../repo/budgets.js';
import { saveRate } from '../repo/rates.js';
import { todayISO } from '../repo/operations.js';
import { currencyControls } from './currency-input.js';
import { termsFields } from './income-line.js';
import { field } from './form-parts.js';

/**
 * Новый источник дохода (работа): название, работодатель, срок выплаты и план — на одном экране.
 * @param {HTMLElement} root
 */
export async function renderIncomeSource(root) {
  const today = todayISO();
  const name = el('input', { class: 'input', placeholder: 'Например: Зарплата Альфа', maxlength: 60 });
  const terms = termsFields({ payNextMonth: true });
  const amount = el('input', { class: 'input input-amount', inputmode: 'decimal', autocomplete: 'off', placeholder: '0' });
  const money = currencyControls({ date: () => today, amountInput: /** @type {HTMLInputElement} */ (amount), currency: 'KZT' });
  const fromMonth = el('input', { class: 'input', type: 'month', value: currentMonth() });

  root.append(
    el('form', { class: 'form', novalidate: true, onsubmit: save },
      field('Название источника', name),
      terms.el,
      el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Сколько платят в месяц'), el('div', { class: 'amount-row' }, amount, money.toggle), money.preview, money.rateField),
      field('С какого месяца', fromMonth, el('p', { class: 'muted small' }, 'План будет повторяться каждый месяц. Если вам уже должны за прошлые месяцы — укажите первый неоплаченный месяц.')),
      el('div', { class: 'form-actions' }, el('button', { class: 'btn', type: 'submit' }, 'Сохранить')),
    ),
  );
  name.focus();

  /** @param {Event} e */
  async function save(e) {
    e.preventDefault();
    const t = terms.read();
    const title = name.value.trim() || (t.employer ? `Зарплата ${t.employer}` : '');
    if (!title) return toast('Укажите название или работодателя', { error: true });
    const a = money.amount();
    const eur = a == null ? null : money.eurCents();
    if (a != null && eur == null) return toast('Укажите курс тенге к евро', { error: true });
    try {
      const cat = await createCategory(title, 'income');
      await setIncomeTerms(cat.id, t);
      if (a != null && eur != null) {
        await setBudgetLine(fromMonth.value || currentMonth(), cat.id, { planned: eur, limit: null, plannedCurrency: money.currency, plannedOriginal: a, repeat: true });
        const r = money.rate();
        if (r) await saveRate(today, r);
      }
      toast('Источник дохода добавлен');
      navigate(`/budget/${currentMonth()}/${cat.id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Не удалось сохранить', { error: true });
    }
  }
}
