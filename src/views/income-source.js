import { el, toast, currentMonth } from '../ui.js';
import { navigate } from '../router.js';
import { createCategory, setIncomeTerms, listCategories } from '../repo/categories.js';
import { setBudgetLine, listCategoryLines } from '../repo/budgets.js';
import { saveRate } from '../repo/rates.js';
import { todayISO } from '../repo/operations.js';
import { effectiveLine } from '../income.js';
import { currencyControls } from './currency-input.js';
import { termsFields } from './income-line.js';
import { field } from './form-parts.js';

const NEW = '__new__';

/**
 * Работодатель и срок выплаты: для существующего источника дохода (по умолчанию)
 * или новый источник — на одном экране.
 * @param {HTMLElement} root
 * @param {Record<string, string>} params — category=ID, чтобы сразу выбрать источник
 */
export async function renderIncomeSource(root, params = {}) {
  const today = todayISO();
  const sources = await listCategories({ kind: 'income' });
  // По умолчанию — переданный источник, иначе первый без работодателя, иначе первый
  const preferred = params.new ? NEW : params.category ?? (sources.find((c) => !c.employer) ?? sources[0])?.id ?? NEW;

  const sourceSelect = el('select', { class: 'select' },
    ...sources.map((c) => el('option', { value: c.id }, c.employer ? `${c.name} — ${c.employer}` : c.name)),
    el('option', { value: NEW }, '+ Новый источник (работа, проект)'),
  );
  sourceSelect.value = preferred;

  const name = el('input', { class: 'input', placeholder: 'Например: Зарплата Альфа', maxlength: 60 });
  const nameField = field('Название нового источника', name);
  const termsBox = el('div');
  /** @type {ReturnType<typeof termsFields>} */
  let terms = termsFields({ payNextMonth: true });

  const amount = el('input', { class: 'input input-amount', inputmode: 'decimal', autocomplete: 'off', placeholder: '0' });
  const money = currencyControls({ date: () => today, amountInput: /** @type {HTMLInputElement} */ (amount), currency: 'KZT' });
  const fromMonth = el('input', { class: 'input', type: 'month', value: currentMonth() });
  const planNote = el('p', { class: 'muted small' });

  async function onSourceChange() {
    const isNew = sourceSelect.value === NEW;
    nameField.hidden = !isNew;
    const c = sources.find((s) => s.id === sourceSelect.value);
    terms = termsFields(c ? { employer: c.employer, payDay: c.payDay, payNextMonth: c.payDay ? c.payNextMonth : true } : { payNextMonth: true });
    termsBox.replaceChildren(terms.el);
    planNote.textContent = 'Необязательно. План будет повторяться каждый месяц. Если вам уже должны за прошлые месяцы — укажите первый неоплаченный месяц.';
    if (c) {
      const eff = effectiveLine(await listCategoryLines(c.id), currentMonth());
      if (eff) planNote.textContent = 'План у этого источника уже есть. Оставьте сумму пустой, чтобы его не менять.';
    }
  }
  sourceSelect.addEventListener('change', onSourceChange);
  await onSourceChange();

  root.append(
    el('form', { class: 'form', novalidate: true, onsubmit: save },
      field('Для какого источника дохода', sourceSelect),
      nameField,
      termsBox,
      el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Сколько платят в месяц'), el('div', { class: 'amount-row' }, amount, money.toggle), money.preview, money.rateField),
      field('С какого месяца', fromMonth, planNote),
      el('div', { class: 'form-actions' }, el('button', { class: 'btn', type: 'submit' }, 'Сохранить')),
    ),
  );

  /** @param {Event} e */
  async function save(e) {
    e.preventDefault();
    const t = terms.read();
    const a = money.amount();
    const eur = a == null ? null : money.eurCents();
    if (a != null && eur == null) return toast('Укажите курс тенге к евро', { error: true });
    try {
      let id = sourceSelect.value;
      if (id === NEW) {
        const title = name.value.trim() || (t.employer ? `Зарплата ${t.employer}` : '');
        if (!title) return toast('Укажите название или работодателя', { error: true });
        id = (await createCategory(title, 'income')).id;
      }
      await setIncomeTerms(id, t);
      if (a != null && eur != null) {
        await setBudgetLine(fromMonth.value || currentMonth(), id, { planned: eur, limit: null, plannedCurrency: money.currency, plannedOriginal: a, repeat: true });
        const r = money.rate();
        if (r) await saveRate(today, r);
      }
      toast('Сохранено');
      navigate(`/budget/${currentMonth()}/${id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Не удалось сохранить', { error: true });
    }
  }
}
