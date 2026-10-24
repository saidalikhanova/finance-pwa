import { el, toast, confirmDialog, formatDate, formatMonth } from '../ui.js';
import { parseAmount, amountToInput, formatMoney } from '../money.js';
import { navigate } from '../router.js';
import { listCategories } from '../repo/categories.js';
import { createPlanned, updatePlanned, getPlanned, deletePlanned, moveToNextMonth } from '../repo/planned.js';
import { todayISO } from '../repo/operations.js';
import { expectedStatus, whenLabel } from '../expected.js';
import { field, segmented, categorySelectFor, categoryLabel } from './form-parts.js';

/**
 * Разовый запланированный платёж или ожидаемое поступление.
 * Параметры: type=income, category=ID, month=ГГГГ-ММ, from=budget.
 * @param {HTMLElement} root
 * @param {Record<string, string>} params
 */
export async function renderPlannedForm(root, params) {
  const existing = params.id ? await getPlanned(params.id) : null;
  if (params.id && !existing) {
    root.append(el('p', { class: 'muted' }, 'Запись не найдена.'));
    return;
  }
  const backTo = params.from === 'budget' ? '/budget' : '/payments';
  // Заголовок и «Назад» зависят от того, доход это или платёж и откуда пришли
  const setHeader = (/** @type {string} */ type) => {
    const t = type === 'income' ? 'Ожидаемый доход' : 'Разовый платёж';
    const h = document.getElementById('page-title');
    if (h) h.textContent = t;
    document.title = `${t} — Финансы`;
  };
  const back = /** @type {HTMLAnchorElement | null} */ (document.getElementById('back-link'));
  if (back) back.href = `#${backTo}`;
  const categories = await listCategories({ includeArchived: true });
  const today = todayISO();
  const initialType = existing?.type ?? (params.type === 'income' ? 'income' : 'expense');

  // Состояние записи и действия — для уже созданной
  if (existing) {
    const st = expectedStatus(existing, today);
    const isIncome = existing.type === 'income';
    const statusText =
      st.status === 'received'
        ? `${isIncome ? 'Получено' : 'Оплачено'} ${existing.receivedDate ? formatDate(existing.receivedDate) : ''}${existing.receivedAmount != null ? ` · ${formatMoney(existing.receivedAmount, existing.currency)}` : ''}`
        : st.status === 'overdue'
          ? `${isIncome ? 'Задерживается' : 'Просрочено'} на ${st.daysLate} дн.`
          : `${isIncome ? 'Ожидается' : 'Предстоит'} ${whenLabel(existing, formatDate)}`;
    const card = el('div', { class: `card status-card status-${st.status}` },
      el('strong', null, statusText),
      existing.movedFrom ? el('div', { class: 'muted small' }, `Перенесено с ${formatMonth(existing.movedFrom).toLowerCase()}`) : null,
    );
    if (st.status !== 'received') {
      card.append(el('div', { class: 'btn-row', style: 'margin:10px 0 0' },
        el('a', { class: 'btn btn-small', href: `#/operations/new?planned=${existing.id}` }, isIncome ? 'Получено' : 'Оплачено'),
        el('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: async () => {
          await moveToNextMonth(existing.id);
          toast('Перенесено на следующий месяц');
          navigate(backTo);
        } }, 'На след. месяц'),
      ));
    }
    root.append(card);
  }

  const nameInput = el('input', { class: 'input', value: existing?.name ?? '', placeholder: initialType === 'income' ? 'Тренинг, проект, зарплата…' : 'Страховка, кружок…', maxlength: 80 });
  const typeInput = el('input', { type: 'hidden', value: initialType });
  const typeToggle = segmented([['expense', 'Расход'], ['income', 'Доход']], typeInput.value, (v) => {
    typeInput.value = v;
    categorySelect.fill(v);
    categoryLabelEl.textContent = categoryLabel(v);
    renderLabels();
  });
  const amountInput = el('input', { class: 'input input-amount', inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00', value: existing ? amountToInput(existing.amount) : '' });
  const currencyInput = el('input', { type: 'hidden', value: existing?.currency ?? 'EUR' });
  const currencyToggle = segmented([['EUR', '€'], ['KZT', '₸']], currencyInput.value, (v) => (currencyInput.value = v));
  const categorySelect = categorySelectFor(categories, existing?.categoryId ?? params.category);
  categorySelect.fill(typeInput.value);
  const categoryLabelEl = el('span', { class: 'field-label' }, categoryLabel(typeInput.value));

  // Когда: точная дата или «в течение месяца»
  let dateKind = existing?.dateKind ?? (params.month || initialType === 'income' ? 'month' : 'day');
  const defaultMonth = existing?.date.slice(0, 7) ?? params.month ?? today.slice(0, 7);
  const dateInput = el('input', { class: 'input', type: 'date', value: existing?.dateKind === 'day' ? existing.date : params.month && params.month !== today.slice(0, 7) ? `${params.month}-01` : today });
  const monthInput = el('input', { class: 'input', type: 'month', value: defaultMonth });
  const whenToggle = segmented([['day', 'Точная дата'], ['month', 'Только месяц']], dateKind, (v) => {
    dateKind = /** @type {'day' | 'month'} */ (v);
    renderWhen();
  });
  const dateField = field('Дата', dateInput);
  const monthField = field('Месяц', monthInput, el('p', { class: 'muted small' }, 'Если точная дата неизвестна. Станет «задерживается» после конца месяца.'));
  function renderWhen() {
    dateField.hidden = dateKind !== 'day';
    monthField.hidden = dateKind !== 'month';
  }
  renderWhen();

  const note = el('p', { class: 'muted small' });
  const whenLabelEl = el('span', { class: 'field-label' });
  function renderLabels() {
    const income = typeInput.value === 'income';
    setHeader(typeInput.value);
    whenLabelEl.textContent = income ? 'Когда ожидается' : 'Когда платить';
    note.textContent = income
      ? 'Ожидаемый доход входит в план месяца. Когда деньги придут, нажмите «Получено» — укажете фактическую дату и сумму, и они попадут в факт.'
      : 'Это напоминание в календаре. Когда платёж совершён, нажмите «Оплачено» — откроется форма операции с заполненными полями.';
  }
  renderLabels();

  const form = el(
    'form',
    { class: 'form', novalidate: true, onsubmit: onSubmit },
    field('Название', nameInput),
    field('Тип', typeToggle),
    field('Сумма', el('div', { class: 'amount-row' }, amountInput, currencyToggle)),
    el('div', { class: 'field' }, whenLabelEl, whenToggle),
    dateField,
    monthField,
    el('label', { class: 'field' }, categoryLabelEl, categorySelect.el),
    note,
    el('div', { class: 'form-actions' }, el('button', { class: 'btn', type: 'submit' }, 'Сохранить')),
  );
  if (existing) {
    form.append(el('button', { class: 'btn btn-danger', type: 'button', onclick: async () => {
      if (!(await confirmDialog(`Удалить «${existing.name}»?${existing.done ? ' Записанная операция останется.' : ''}`))) return;
      await deletePlanned(existing.id);
      toast('Удалено');
      navigate(backTo);
    } }, 'Удалить'));
  }
  root.append(form);
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
      dateKind: /** @type {'day' | 'month'} */ (dateKind),
      date: dateKind === 'month' ? monthInput.value : dateInput.value,
    };
    try {
      if (existing) await updatePlanned(existing.id, data);
      else await createPlanned(data);
      toast('Сохранено');
      navigate(backTo);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Не удалось сохранить', { error: true });
    }
  }
}
