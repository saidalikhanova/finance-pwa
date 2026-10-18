import { el, toast, formatMonth } from '../ui.js';
import { parseAmount, amountToInput, formatMoney, toEurCents, fromEurCents, formatRate } from '../money.js';
import { navigate } from '../router.js';
import { getCategory } from '../repo/categories.js';
import { getBudgetLine, setBudgetLine } from '../repo/budgets.js';
import { sumByCategory, todayISO } from '../repo/operations.js';
import { suggestRate, saveRate } from '../repo/rates.js';
import { budgetState } from './budget.js';
import { segmented } from './form-parts.js';

/**
 * План и лимит категории на месяц. Суммы можно вводить в евро или тенге;
 * хранятся и сравниваются в евро (п. 4.3 ТЗ), пересчёт — по курсу на сегодня.
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
  const today = todayISO();

  /** @type {'EUR' | 'KZT'} */
  let currency = 'EUR';
  const known = (await suggestRate(today))?.rate ?? null;
  let editingRate = !known;
  const rateInput = el('input', { class: 'input', inputmode: 'decimal', autocomplete: 'off', placeholder: 'например 508,95', value: known ? formatRate(known) : '', oninput: updatePreview });
  const rateEdit = el('label', { class: 'field', hidden: true }, el('span', { class: 'field-label' }, 'Курс, ₸ за 1 €'), rateInput, el('p', { class: 'muted small' }, 'Суммы будут сохранены в евро по этому курсу; курс запомнится на сегодня.'));
  const rateText = el('span');
  const rateLine = el('p', { class: 'muted small rate-line', hidden: true }, rateText, ' · ', el('button', { type: 'button', class: 'link-btn', onclick: () => { editingRate = true; renderRate(); rateInput.focus(); } }, 'изменить'));
  const rateField = el('div', null, rateLine, rateEdit);
  function renderRate() {
    const isKzt = currency === 'KZT';
    const r = parseRateSafe();
    rateLine.hidden = !isKzt || editingRate || !r;
    rateEdit.hidden = !isKzt || (!editingRate && Boolean(r));
    if (r) rateText.textContent = `по курсу ${formatRate(r)} ₸ за 1 €`;
  }

  const plannedInput = el('input', { class: 'input input-amount', inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00', value: line?.planned != null ? amountToInput(line.planned) : '', oninput: updatePreview });
  const limitInput = el('input', { class: 'input input-amount', inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00', value: line?.limit != null ? amountToInput(line.limit) : '', oninput: updatePreview });
  const plannedPreview = el('p', { class: 'muted small', style: 'margin:4px 0 0' });
  const limitPreview = el('p', { class: 'muted small', style: 'margin:4px 0 0' });
  const plannedLabel = el('span', { class: 'field-label' });
  const limitLabel = el('span', { class: 'field-label' });

  const toggle = segmented([['EUR', '€'], ['KZT', '₸']], currency, (v) => {
    const prev = currency;
    currency = /** @type {'EUR' | 'KZT'} */ (v);
    renderRate();
    // Переводим уже введённые значения в выбранную валюту, чтобы цифры не «прыгали»
    const rate = parseRateSafe();
    for (const input of [plannedInput, limitInput]) {
      const v0 = parseOptional(input.value);
      if (typeof v0 !== 'number' || !rate) continue;
      input.value = amountToInput(prev === 'EUR' ? fromEurCents(v0, rate) : /** @type {number} */ (toEurCents(v0, 'KZT', rate)));
    }
    updatePreview();
  });

  function parseRateSafe() {
    const s = rateInput.value.replace(/\s+/g, '').replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 10000) : null;
  }

  /** @param {HTMLInputElement} input */
  function eurOf(input) {
    const v = parseOptional(input.value);
    if (typeof v !== 'number') return v;
    return currency === 'EUR' ? v : toEurCents(v, 'KZT', parseRateSafe());
  }

  function updatePreview() {
    const unit = currency === 'EUR' ? '€' : '₸';
    plannedLabel.textContent = isExpense ? `План расходов, ${unit}` : `План доходов, ${unit}`;
    limitLabel.textContent = `Лимит, ${unit}`;
    for (const [input, out] of [[plannedInput, plannedPreview], [limitInput, limitPreview]]) {
      const eur = eurOf(/** @type {HTMLInputElement} */ (input));
      out.textContent = currency === 'KZT' && typeof eur === 'number' ? `≈ ${formatMoney(eur, 'EUR')}` : currency === 'KZT' && eur == null && input.value.trim() ? 'укажите курс' : '';
    }
  }
  updatePreview();

  const form = el(
    'form',
    { class: 'form', novalidate: true, onsubmit: onSubmit },
    el('div', { class: 'card' }, el('div', { class: 'muted small' }, `${category.name} · ${formatMonth(month)}`), el('div', null, `Факт: ${formatMoney(fact, 'EUR')}`)),
    el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Валюта ввода'), toggle),
    rateField,
    el('label', { class: 'field' }, plannedLabel, plannedInput, plannedPreview),
    ...(isExpense
      ? [el('label', { class: 'field' }, limitLabel, limitInput, limitPreview, el('p', { class: 'muted small' }, 'Предупреждение при 80 % и при превышении. Пустое поле — без лимита.'))]
      : []),
    el('div', { class: 'form-actions' }, el('button', { class: 'btn', type: 'submit' }, 'Сохранить')),
    el('a', { class: 'btn btn-secondary', style: 'width:100%', href: `#/operations?month=${month}&category=${categoryId}` }, 'Операции категории за месяц'),
  );
  root.append(form);
  plannedInput.focus();

  /** @param {Event} e */
  async function onSubmit(e) {
    e.preventDefault();
    if (currency === 'KZT' && !parseRateSafe()) {
      toast('Укажите курс тенге к евро', { error: true });
      rateInput.focus();
      return;
    }
    const planned = eurOf(plannedInput);
    const limit = isExpense ? eurOf(limitInput) : null;
    if (planned === false || limit === false) {
      toast('Введите сумму, например 200 или 150,50', { error: true });
      return;
    }
    try {
      await setBudgetLine(month, categoryId, { planned, limit });
      if (currency === 'KZT') {
        const r = parseRateSafe();
        if (r && !known) await saveRate(today, r);
      }
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
