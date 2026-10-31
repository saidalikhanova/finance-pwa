import { el, avatar, toast, formatDate, formatMonth, formatMonthGen, currentMonth, shiftMonth, confirmDialog } from '../ui.js';
import { getCategory, setIncomeTerms, renameCategory, setCategoryArchived } from '../repo/categories.js';
import { listPlanned } from '../repo/planned.js';
import { navigate } from '../router.js';
import { segmented } from './form-parts.js';
import { formatMoney as fmtMoney, amountToInput } from '../money.js';

/** Без «,00» у целых сумм: 600 000 ₸ вместо 600 000,00 ₸. @param {number} a @param {'EUR' | 'KZT'} c */
const formatMoney = (a, c) => fmtMoney(a, c).replace(/,00(?=\u00a0)/, '');
import { setBudgetLine, listCategoryLines, removeFromMonth, restoreToMonth } from '../repo/budgets.js';
import { createOperation, listOperations, monthRange, todayISO } from '../repo/operations.js';
import { suggestRate, saveRate } from '../repo/rates.js';
import { effectiveLine, lineOriginal, incomeDebt } from '../income.js';
import { currencyControls } from './currency-input.js';
import { budgetState, expectedRow } from './budget.js';

/**
 * Источник дохода на месяц: план, полученное (факт) и долг на сегодня — на одном экране.
 * @param {HTMLElement} root
 * @param {import('../repo/categories.js').Category} category
 * @param {string} month — ГГГГ-ММ
 */
export async function renderIncomeLine(root, category, month) {
  budgetState.month = month;
  const today = todayISO();
  const thisMonth = currentMonth();
  const rateNow = (await suggestRate(today))?.rate ?? null;

  const h = document.getElementById('page-title');
  if (h) h.textContent = category.name;

  const body = el('div');
  root.append(body);
  await refresh();

  async function refresh() {
    category = /** @type {any} */ (await getCategory(category.id)) ?? category;
    const lines = await listCategoryLines(category.id);
    const allIncome = (await listOperations({ type: 'income' })).filter((o) => o.categoryId === category.id);
    const { from, to } = monthRange(month);
    const monthOps = allIncome.filter((o) => o.date >= from && o.date <= to).sort((a, b) => (a.date < b.date ? -1 : 1));
    const eff = effectiveLine(lines, month);
    const isHidden = Boolean(lines.find((l) => l.month === month)?.hidden);
    const orig = eff ? lineOriginal(eff.line) : null;
    body.innerHTML = '';
    const monthIn = formatMonth(month).toLowerCase().replace(/ь /, 'е ').replace(/й /, 'е ').replace(/т /, 'те ');
    const debt = incomeDebt({ lines, ops: allIncome, upTo: shiftMonth(thisMonth, 1), rateNow, today, terms: category });

    // --- Формы (скрыты, раскрываются по «изменить» / «+ Факт»)
    const terms = termsFields(category);
    const nameInput = /** @type {HTMLInputElement} */ (el('input', { class: 'input', value: category.name, maxlength: 60 }));
    const termsPanel = el('div', { class: 'panel', hidden: Boolean(category.employer || category.payDay) },
      el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Название источника'), nameInput),
      terms.el,
      el('button', { class: 'btn', type: 'button', style: 'width:100%;margin:4px 0 4px', onclick: async () => {
        try {
          if (nameInput.value.trim() !== category.name) await renameCategory(category.id, nameInput.value);
          await setIncomeTerms(category.id, terms.read());
          toast('Сохранено');
          refresh();
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Ошибка', { error: true });
        }
      } }, 'Сохранить'),
    );
    const planAmount = el('input', { class: 'input input-amount', inputmode: 'decimal', autocomplete: 'off', placeholder: '0', value: orig ? amountToInput(orig.amount).replace(/,00$/, '') : '' });
    const planMoney = currencyControls({ date: () => today, amountInput: /** @type {HTMLInputElement} */ (planAmount), currency: orig?.currency ?? 'KZT' });
    const repeatBox = /** @type {HTMLInputElement} */ (el('input', { type: 'checkbox', checked: eff ? Boolean(eff.line.repeat) : true }));
    const planPanel = el('div', { class: 'panel', hidden: Boolean(orig) },
      el('div', { class: 'amount-row' }, planAmount, planMoney.toggle),
      planMoney.preview,
      planMoney.rateField,
      el('label', { class: 'cat-row', style: 'border:0;padding:8px 0' }, repeatBox, el('span', { class: 'cat-name' }, 'Каждый месяц, пока не изменю')),
      el('button', { class: 'btn', type: 'button', style: 'width:100%', onclick: savePlan }, 'Сохранить план'),
    );
    const recAmount = el('input', { class: 'input input-amount', inputmode: 'decimal', autocomplete: 'off', placeholder: '0', value: orig ? amountToInput(orig.amount).replace(/,00$/, '') : '' });
    const recDate = el('input', { class: 'input', type: 'date', value: month === thisMonth ? today : month < thisMonth ? to : from });
    const recMoney = currencyControls({ date: () => recDate.value || today, amountInput: /** @type {HTMLInputElement} */ (recAmount), currency: orig?.currency ?? 'KZT' });
    const recPanel = el('div', { class: 'panel', hidden: true },
      el('div', { class: 'amount-row' }, recAmount, recMoney.toggle),
      recMoney.preview,
      recMoney.rateField,
      el('div', { class: 'add-row' }, recDate, el('button', { class: 'btn', type: 'button', onclick: addReceived }, 'Записать')),
    );

    // --- Одна карточка: кто платит · план · получено · долг
    const recMonth = orig ? monthOps.reduce((sum, o) => sum + (o.currency === orig.currency ? o.amount : o.amount), 0) : 0;
    const needMore = orig && ((debt?.debt ?? 0) > 0 || recMonth < orig.amount);
    const toggle = (/** @type {HTMLElement} */ panel) => el('button', { class: 'link-btn', type: 'button', style: 'padding:0', onclick: () => { panel.hidden = !panel.hidden; } }, 'изменить');
    const line = (/** @type {string} */ label, /** @type {Node | string} */ value, /** @type {Node | null} */ action) =>
      el('div', { class: 'kv-row' }, el('span', { class: 'muted small' }, label), el('span', { class: 'kv-value' }, value), action);
    const card = el('div', { class: 'card' },
      line('Кто платит', category.employer ? `${category.employer} · ${category.payDay ? termsText(category) : 'срок не указан'}` : 'не указано', toggle(termsPanel)),
      termsPanel,
      line('План в месяц', orig ? `${formatMoney(orig.amount, orig.currency)}${eff?.line.repeat ? ' · каждый месяц' : ''}` : 'не задан', toggle(planPanel)),
      planPanel,
      // Статус: «не получено» (пока ничего нет), иначе сумма; «+ Факт» — записать поступление (месяц должен начаться)
      line(`Получено в ${monthIn}`,
        !monthOps.length ? el('span', { class: 'warn' }, 'не получено') : orig ? `${formatMoney(recMonth, orig.currency)}${needMore ? ' · частично' : ''}` : `${monthOps.length} поступл.`,
        (needMore || !orig) && month <= thisMonth ? el('button', { class: 'btn btn-small', type: 'button', onclick: () => { recPanel.hidden = !recPanel.hidden; recAmount.focus(); } }, '+ Факт') : null),
      recPanel,
    );
    if (monthOps.length) {
      const list = el('div', { class: 'list', style: 'margin:4px 0 8px' });
      for (const o of monthOps) list.append(el('a', { class: 'row', href: `#/operations/${o.id}` }, el('div', { class: 'row-main' }, el('div', { class: 'small' }, formatDate(o.date)), o.comment ? el('div', { class: 'muted small' }, o.comment) : null), el('div', { class: 'row-amount income small' }, formatMoney(o.amount, o.currency))));
      card.append(list);
    }
    if (debt) {
      const owed = debt.debt;
      card.append(el('div', { class: `kv-row ${owed > 0 ? 'debt-owed' : ''}`, style: 'border-radius:10px;padding:8px' },
        el('span', { class: 'muted small' }, 'Долг'),
        el('span', { class: `kv-value ${owed > 0 ? 'warn' : ''}` }, owed > 0 ? `${formatMoney(owed, debt.currency)}${debt.daysLate ? ` · просрочено ${debt.daysLate} дн.` : ''}` : owed < 0 ? `аванс ${formatMoney(-owed, debt.currency)}` : 'нет'),
      ));
      if (debt.next) card.append(el('p', { class: 'muted small', style: 'margin:6px 0 0' }, `Следующая выплата: ${formatDate(debt.next.due)} — ${formatMoney(debt.next.plan, debt.currency)} за ${formatMonth(debt.next.month).toLowerCase()}`));
    }
    body.append(card);

    // --- Подробнее: по месяцам, поступления с датой, архив, убрать из месяца
    const oneOff = (await listPlanned({ from, to, includeDone: true, type: 'income' })).filter((p) => p.categoryId === category.id);
    const oneOffList = el('div', { class: 'list', style: 'margin:8px 0' });
    for (const p of oneOff) oneOffList.append(expectedRow(p, today, rateNow));
    const more = el('details', { class: 'card list-card' }, el('summary', { class: 'muted' }, `Подробнее${oneOff.length ? ` · поступлений с датой: ${oneOff.length}` : ''}`));
    if (debt) {
      more.append(el('table', { class: 'table', style: 'margin-top:8px' },
        el('thead', null, el('tr', null, el('th', null, 'За месяц'), el('th', null, 'Срок'), el('th', { class: 'num' }, 'План'), el('th', { class: 'num' }, 'Получено'))),
        el('tbody', null, ...debt.months.filter((m) => !m.pending || m === debt.next).map((m) => el('tr', { class: m.pending ? 'muted' : '' },
          el('td', null, formatMonth(m.month).replace(/ \d{4}$/, '')),
          el('td', { class: m.pending ? '' : m.due === debt.overdueSince ? 'warn' : '' }, m.pending ? `${formatDate(m.due)} (впереди)` : formatDate(m.due)),
          el('td', { class: 'num' }, formatMoney(m.plan, debt.currency)),
          el('td', { class: `num${m.received >= m.plan && m.plan ? ' income' : ''}` }, formatMoney(m.received, debt.currency)),
        ))),
      ));
    }
    more.append(
      el('div', { class: 'field-label', style: 'margin-top:12px' }, `Поступления с датой в ${monthIn}`),
      oneOff.length ? oneOffList : el('p', { class: 'muted small', style: 'margin:4px 0 8px' }, 'Разовое поступление с датой — например, оплата за тренинг. Входит в план месяца и в «Платежи».'),
      el('a', { class: 'btn btn-secondary btn-small', style: 'width:100%;margin-bottom:8px', href: `#/planned/new?type=income&category=${category.id}&month=${month}&from=budget` }, '+ Поступление с датой'),
      isHidden
        ? el('button', { class: 'btn btn-secondary btn-small', type: 'button', style: 'width:100%;margin-bottom:8px', onclick: async () => { await restoreToMonth(month, category.id); toast('Возвращено в бюджет месяца'); refresh(); } }, `Вернуть в бюджет: ${formatMonth(month).toLowerCase()}`)
        : el('button', { class: 'btn btn-secondary btn-small', type: 'button', style: 'width:100%;margin-bottom:8px', onclick: removePlan }, `Убрать из бюджета: ${formatMonth(month).toLowerCase()}`),
      el('button', { class: 'btn btn-danger btn-small', type: 'button', style: 'width:100%;margin-bottom:12px', onclick: async () => {
        const ok = await confirmDialog(category.archived
          ? `Вернуть «${category.name}» из архива?`
          : `Перенести «${category.name}» в архив? Источник пропадёт из бюджета и из выбора при записи дохода. Полученные суммы и история сохранятся.`, category.archived ? 'Вернуть' : 'В архив');
        if (!ok) return;
        await setCategoryArchived(category.id, !category.archived);
        toast(category.archived ? 'Источник возвращён' : 'Источник перенесён в архив');
        navigate('/budget');
      } }, category.archived ? 'Вернуть источник из архива' : 'Перенести источник в архив'),
    );
    body.append(more);

    async function removePlan() {
      const ok = await confirmDialog(`Убрать «${category.name}» из бюджета: ${formatMonth(month).toLowerCase()}? Другие месяцы, категория и полученные суммы не изменятся.`, 'Убрать');
      if (!ok) return;
      try {
        await removeFromMonth(month, category.id);
        toast('Убрано из бюджета месяца');
        refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Не удалось убрать', { error: true });
      }
    }

    async function savePlan() {
      const amount = planMoney.amount();
      if (amount == null) {
        toast('Введите сумму плана, например 600000', { error: true });
        return;
      }
      const eur = planMoney.eurCents();
      if (eur == null) {
        toast('Укажите курс тенге к евро', { error: true });
        return;
      }
      await setBudgetLine(month, category.id, { planned: eur, limit: null, plannedCurrency: planMoney.currency, plannedOriginal: amount, repeat: repeatBox.checked });
      const r = planMoney.rate();
      if (r) await saveRate(today, r);
      toast(repeatBox.checked ? 'План сохранён на этот и следующие месяцы' : 'План сохранён');
      refresh();
    }

    async function addReceived() {
      const amount = recMoney.amount();
      if (amount == null) {
        toast('Введите полученную сумму', { error: true });
        return;
      }
      const rate = recMoney.rate();
      if (recMoney.currency === 'KZT' && !rate) {
        toast('Укажите курс тенге к евро', { error: true });
        return;
      }
      const date = recDate.value || today;
      if (date > today) {
        toast('Эта дата ещё не наступила. Отметьте поступление, когда деньги придут', { error: true });
        return;
      }
      await createOperation({ type: 'income', amount, currency: recMoney.currency, date, categoryId: category.id, comment: '', rate, rateSource: rate ? 'manual' : null });
      if (rate) await saveRate(date, rate);
      toast('Поступление записано');
      refresh();
    }
  }
}

/**
 * «10-го числа следующего месяца» / «25-го числа того же месяца».
 * @param {{ payDay?: number | null, payNextMonth?: boolean }} t
 */
export function termsText(t) {
  if (!t.payDay) return 'срок не задан';
  return `${t.payDay}-го числа ${t.payNextMonth ? 'следующего месяца' : 'того же месяца'}`;
}

/**
 * Поля «Работодатель», «Какого числа платят», «За какой месяц».
 * @param {{ employer?: string, payDay?: number | null, payNextMonth?: boolean }} [initial]
 */
export function termsFields(initial = {}) {
  const employer = el('input', { class: 'input', value: initial.employer ?? '', placeholder: 'Например: ТОО «Альфа»', maxlength: 80 });
  const payDay = el('input', { class: 'input input-sm', type: 'number', min: 1, max: 31, value: initial.payDay ?? '', placeholder: '—' });
  let nextMonth = initial.payNextMonth ?? true;
  const whenToggle = segmented([['next', 'В следующем месяце'], ['same', 'В том же месяце']], nextMonth ? 'next' : 'same', (v) => (nextMonth = v === 'next'));
  const root = el('div', null,
    el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Работодатель (кто платит)'), employer),
    el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Какого числа платят'), el('div', { class: 'add-row', style: 'padding:0' }, payDay, el('span', { class: 'muted small', style: 'align-self:center' }, 'число месяца, пусто — без срока'))),
    el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Зарплату за месяц платят'), whenToggle),
  );
  return {
    el: root,
    read: () => ({ employer: employer.value, payDay: payDay.value ? Number(payDay.value) : null, payNextMonth: nextMonth }),
  };
}
