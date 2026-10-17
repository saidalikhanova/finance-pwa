import { el, toast, confirmDialog } from '../ui.js';
import { parseAmount, amountToInput, formatMoney } from '../money.js';
import { navigate } from '../router.js';
import {
  createOperation,
  updateOperation,
  deleteOperation,
  getOperation,
  todayISO,
} from '../repo/operations.js';
import { listCategories } from '../repo/categories.js';

/**
 * Форма создания и редактирования операции.
 * @param {HTMLElement} root
 * @param {Record<string, string>} params — { id } или { id: 'new' }
 */
export async function renderOperationForm(root, params) {
  // Адрес #/operations/new не содержит параметра id — это новая операция.
  const isNew = !params.id || params.id === 'new';
  const existing = isNew ? null : await getOperation(params.id);
  if (!isNew && !existing) {
    root.append(el('p', { class: 'muted' }, 'Операция не найдена.'));
    return;
  }

  const allCategories = await listCategories({ includeArchived: true });

  const form = el('form', { class: 'form', novalidate: true, onsubmit: onSubmit });

  // Тип
  const typeInput = el('input', { type: 'hidden', name: 'type', value: existing?.type ?? 'expense' });
  const typeToggle = segmented(
    [
      ['expense', 'Расход'],
      ['income', 'Доход'],
    ],
    typeInput.value,
    (v) => {
      typeInput.value = v;
      fillCategories();
    },
  );

  // Сумма и валюта
  const amountInput = el('input', {
    class: 'input input-amount',
    name: 'amount',
    inputmode: 'decimal',
    autocomplete: 'off',
    placeholder: '0,00',
    value: existing ? amountToInput(existing.amount) : '',
    required: true,
  });
  const currencyInput = el('input', { type: 'hidden', name: 'currency', value: existing?.currency ?? 'EUR' });
  const currencyToggle = segmented(
    [
      ['EUR', '€'],
      ['KZT', '₸'],
    ],
    currencyInput.value,
    (v) => {
      currencyInput.value = v;
      updateRateNote();
    },
  );

  const rateNote = el('p', { class: 'muted small' });
  function updateRateNote() {
    if (currencyInput.value === 'EUR') {
      rateNote.textContent = '';
      return;
    }
    if (existing?.amountEur != null) {
      rateNote.textContent = `≈ ${formatMoney(existing.amountEur, 'EUR')} по курсу ${existing.rateSource === 'manual' ? '(задан вручную)' : 'Нацбанка'}`;
    } else {
      rateNote.textContent = 'Курс к евро будет подставлен автоматически (этап 3). Пока — «курс не определён».';
    }
  }
  updateRateNote();

  // Дата
  const dateInput = el('input', { class: 'input', type: 'date', name: 'date', value: existing?.date ?? todayISO(), required: true });

  // Категория
  const categorySelect = el('select', { class: 'select', name: 'categoryId', required: true });
  function fillCategories() {
    const kind = typeInput.value;
    const current = existing?.categoryId;
    categorySelect.innerHTML = '';
    categorySelect.append(el('option', { value: '', disabled: true, selected: true }, 'Выберите категорию'));
    for (const c of allCategories) {
      if (c.kind !== kind) continue;
      if (c.archived && c.id !== current) continue;
      categorySelect.append(el('option', { value: c.id }, c.archived ? `${c.name} (архив)` : c.name));
    }
    if (current && [...categorySelect.options].some((o) => o.value === current)) categorySelect.value = current;
  }
  fillCategories();

  // Комментарий
  const commentInput = el('input', { class: 'input', name: 'comment', value: existing?.comment ?? '', placeholder: 'Необязательно', maxlength: 200 });

  form.replaceChildren(
    field('Тип', typeToggle),
    field('Сумма', el('div', { class: 'amount-row' }, amountInput, currencyToggle), rateNote),
    field('Дата', dateInput),
    field('Категория', categorySelect),
    field('Комментарий', commentInput),
    el('div', { class: 'form-actions' }, el('button', { class: 'btn', type: 'submit' }, isNew ? 'Сохранить' : 'Сохранить изменения')),
    ...(existing ? [el('button', { class: 'btn btn-danger', type: 'button', onclick: onDelete }, 'Удалить операцию')] : []),
  );
  root.append(form);
  if (isNew) amountInput.focus();

  /** @param {Event} e */
  async function onSubmit(e) {
    e.preventDefault();
    const amount = parseAmount(amountInput.value);
    if (amount == null) {
      toast('Введите сумму, например 12,50', { error: true });
      amountInput.focus();
      return;
    }
    if (!categorySelect.value) {
      toast('Выберите категорию', { error: true });
      categorySelect.focus();
      return;
    }
    const data = {
      type: /** @type {'expense' | 'income'} */ (typeInput.value),
      amount,
      currency: /** @type {'EUR' | 'KZT'} */ (currencyInput.value),
      date: dateInput.value,
      categoryId: categorySelect.value,
      comment: commentInput.value,
    };
    try {
      if (existing) {
        // При смене валюты прежний курс теряет смысл.
        const keepRate = existing.currency === data.currency;
        await updateOperation(existing.id, { ...data, rate: keepRate ? existing.rate : null, rateSource: keepRate ? existing.rateSource : null });
        toast('Изменения сохранены');
      } else {
        await createOperation(data);
        toast('Операция сохранена');
      }
      navigate('/operations');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Не удалось сохранить', { error: true });
    }
  }

  async function onDelete() {
    if (!existing) return;
    if (!(await confirmDialog('Удалить операцию? Это действие нельзя отменить.'))) return;
    await deleteOperation(existing.id);
    toast('Операция удалена');
    navigate('/operations');
  }
}

/**
 * @param {string} label
 * @param {...(Node | null)} controls
 */
function field(label, ...controls) {
  return el('label', { class: 'field' }, el('span', { class: 'field-label' }, label), ...controls);
}

/**
 * Переключатель из нескольких кнопок.
 * @param {[string, string][]} options — [значение, подпись]
 * @param {string} value
 * @param {(v: string) => void} onChange
 */
function segmented(options, value, onChange) {
  const wrap = el('div', { class: 'segmented', role: 'group' });
  for (const [v, label] of options) {
    const b = el('button', { type: 'button', class: v === value ? 'active' : '', dataset: { value: v } }, label);
    b.addEventListener('click', () => {
      wrap.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      onChange(v);
    });
    wrap.append(b);
  }
  return wrap;
}
