import { el, avatar, toast, formatMonth, confirmDialog } from '../ui.js';
import { parseAmount, amountToInput, formatMoney, toEurCents, fromEurCents, formatRate } from '../money.js';
import { navigate } from '../router.js';
import { getCategory } from '../repo/categories.js';
import { getBudgetLine, setBudgetLine, removeFromMonth, restoreToMonth } from '../repo/budgets.js';
import { sumByCategory, todayISO } from '../repo/operations.js';
import { suggestRate, saveRate } from '../repo/rates.js';
import { budgetState } from './budget.js';
import { renderIncomeLine } from './income-line.js';
import { segmented } from './form-parts.js';
import { listLoans } from '../repo/loans.js';
import { isLoanCategory, scheduledInMonth } from '../loans.js';
import { remaining } from '../recurring.js';
import { formatWhole } from '../money.js';

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
  // Источник дохода: план, получено и долг — отдельный экран
  if (category.kind === 'income') return renderIncomeLine(root, category, month);
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
    el('p', { class: 'muted small' }, isExpense ? 'План — сколько ожидаете потратить; факт считается из записанных расходов.' : 'Здесь — общий план, если не хотите расписывать по поступлениям. Ожидаемые доходы (кнопка «+ Ожидаемый доход» в бюджете) добавляются к нему автоматически. Факт считается из полученных доходов.'),
    el('div', { class: 'form-actions' }, el('button', { class: 'btn', type: 'submit' }, 'Сохранить')),
    ...(isExpense ? [] : [
      el('a', { class: 'btn btn-secondary', style: 'width:100%;margin-bottom:8px', href: `#/planned/new?type=income&category=${categoryId}&month=${month}&from=budget` }, '+ Ожидаемый доход'),
      el('a', { class: 'btn btn-secondary', style: 'width:100%;margin-bottom:8px', href: `#/add?type=income&category=${categoryId}&date=${month === today.slice(0, 7) ? today : `${month}-01`}` }, '+ Уже получен'),
    ]),
    el('a', { class: 'btn btn-secondary', style: 'width:100%', href: `#/operations?month=${month}&category=${categoryId}` }, 'Операции категории за месяц'),
    line?.hidden
      ? el('button', { class: 'btn btn-secondary', type: 'button', style: 'width:100%;margin-top:8px', onclick: onRestore }, `Вернуть в бюджет: ${formatMonth(month).toLowerCase()}`)
      : el('button', { class: 'btn btn-danger', type: 'button', style: 'width:100%;margin-top:8px', onclick: onRemove }, `Убрать из бюджета: ${formatMonth(month).toLowerCase()}`),
  );
  // Категория «Кредиты»: список кредитов и платежи этого месяца — над планом
  if (isLoanCategory(category)) {
    root.append(await loansCard(categoryId, month));
  } else {
    plannedInput.focus();
  }
  root.append(form);

  async function onRemove() {
    const ok = await confirmDialog(`Убрать «${category.name}» из бюджета: ${formatMonth(month).toLowerCase()}? Категория останется в других месяцах, записанные операции не удаляются.`, 'Убрать');
    if (!ok) return;
    try {
      await removeFromMonth(month, categoryId);
      toast('Убрано из бюджета месяца');
      navigate('/budget');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Не удалось убрать', { error: true });
    }
  }

  async function onRestore() {
    await restoreToMonth(month, categoryId);
    toast('Категория возвращена в бюджет месяца');
    navigate('/budget');
  }

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

/**
 * «Мои кредиты»: все кредиты, платежи месяца, кнопка «+ Кредит».
 * @param {string} categoryId
 * @param {string} month
 */
async function loansCard(categoryId, month) {
  const loans = (await listLoans()).filter((s) => s.categoryId === categoryId);
  const card = el('div', { class: 'card' }, el('div', { class: 'card-title' }, 'Мои кредиты'));
  if (!loans.length) {
    card.append(el('p', { class: 'muted small', style: 'margin:0 0 10px' }, 'Добавьте кредит: банк, платёж в месяц и день платежа — он появится в календаре каждый месяц до последнего платежа.'));
  } else {
    const list = el('div', { class: 'list', style: 'margin:0 0 10px' });
    for (const s of loans) {
      const left = remaining(s);
      const day = Number(s.startDate.slice(8));
      const sub = [`${day} числа`, s.status === 'paused' ? 'на паузе' : s.status === 'finished' ? 'выплачен' : left ? `осталось платежей: ${left.count}` : 'срок не указан'].join(' · ');
      // Сумма кредита и сколько ещё выплатить по графику
      const money2 = [s.principal ? `кредит ${formatWhole(s.principal, s.currency)}` : null, left && left.count && s.status !== 'finished' ? `осталось выплатить ${formatWhole(left.amount, s.currency)}` : null].filter(Boolean).join(' · ');
      list.append(el('a', { class: 'row', href: `#/loans/${s.id}?month=${month}` },
        avatar(s.bank ?? s.name, { small: true }),
        el('div', { class: 'row-main' }, el('div', null, s.name), el('div', { class: 'muted small' }, sub), money2 ? el('div', { class: 'muted small' }, money2) : null),
        el('div', { class: 'row-amount expense' }, formatWhole(-s.amount, s.currency)),
      ));
    }
    card.append(list);
    // Итого по кредитам: суммы кредитов и сколько ещё выплатить — по валютам
    /** @type {(pick: (s: import('../recurring.js').Schedule) => number) => string} */
    const byCurrency = (pick) => {
      /** @type {Map<'EUR' | 'KZT', number>} */
      const m = new Map();
      for (const s of loans) {
        const v = pick(s);
        if (v) m.set(s.currency, (m.get(s.currency) ?? 0) + v);
      }
      return [...m].map(([c, a]) => formatWhole(a, c)).join(' + ');
    };
    if (loans.length > 1) {
      const principalTotal = byCurrency((s) => s.principal ?? 0);
      const leftTotal = byCurrency((s) => (s.status === 'finished' ? 0 : remaining(s)?.amount ?? 0));
      const parts = [principalTotal ? `сумма кредитов ${principalTotal}` : null, leftTotal ? `осталось выплатить ${leftTotal}` : null].filter(Boolean);
      if (parts.length) card.append(el('p', { class: 'small', style: 'margin:0 0 6px' }, `Всего: ${parts.join(' · ')}`));
    }
    // Сколько платить в этом месяце — по валютам
    /** @type {Map<string, number>} */
    const sums = new Map();
    for (const { s } of scheduledInMonth(loans, categoryId, month)) sums.set(s.currency, (sums.get(s.currency) ?? 0) + s.amount);
    if (sums.size) {
      const total = [...sums].map(([c, a]) => formatWhole(a, /** @type {'EUR' | 'KZT'} */ (c))).join(' + ');
      card.append(el('p', { class: 'small', style: 'margin:0 0 10px' }, `Платежей в ${formatMonth(month).toLowerCase().replace(/ь /, 'е ').replace(/й /, 'е ').replace(/т /, 'те ')}: ${total}`));
    }
  }
  card.append(el('a', { class: 'btn btn-secondary', style: 'width:100%', href: `#/loans/new?month=${month}` }, '+ Кредит'));
  return card;
}
