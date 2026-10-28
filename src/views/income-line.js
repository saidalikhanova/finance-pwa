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

    // 0. Работодатель и срок выплаты
    const terms = termsFields(category);
    const nameInput = /** @type {HTMLInputElement} */ (el('input', { class: 'input', value: category.name, maxlength: 60 }));
    body.append(
      el('details', { class: 'card list-card', open: !category.employer && !category.payDay },
        el('summary', null, el('span', null, 'Название, работодатель и срок выплаты', el('div', { class: 'muted small' },
          [category.employer || 'работодатель не указан', category.payDay ? termsText(category) : 'срок не задан'].join(' · ')))),
        el('label', { class: 'field', style: 'margin-top:8px' }, el('span', { class: 'field-label' }, 'Название источника'), nameInput),
        terms.el,
        el('button', { class: 'btn', type: 'button', style: 'width:100%;margin:4px 0 12px', onclick: async () => {
          try {
            if (nameInput.value.trim() !== category.name) {
              await renameCategory(category.id, nameInput.value);
              const title = document.getElementById('page-title');
              if (title) title.textContent = nameInput.value.trim();
            }
            await setIncomeTerms(category.id, terms.read());
            toast('Сохранено');
            refresh();
          } catch (err) {
            toast(err instanceof Error ? err.message : 'Ошибка', { error: true });
          }
        } }, 'Сохранить'),
      ),
    );

    // 1. План на месяц
    const planAmount = el('input', { class: 'input input-amount', inputmode: 'decimal', autocomplete: 'off', placeholder: '0', value: orig ? amountToInput(orig.amount).replace(/,00$/, '') : '' });
    const planMoney = currencyControls({ date: () => today, amountInput: /** @type {HTMLInputElement} */ (planAmount), currency: orig?.currency ?? 'KZT' });
    const repeatBox = /** @type {HTMLInputElement} */ (el('input', { type: 'checkbox', checked: eff ? Boolean(eff.line.repeat) : true }));
    body.append(
      el('div', { class: 'card' },
        el('div', { class: 'card-title' }, `План на ${formatMonth(month).toLowerCase()}`),
        el('p', { class: 'muted small', style: 'margin:0 0 8px' }, 'Сколько должны заплатить за этот месяц.'),
        el('div', { class: 'amount-row' }, planAmount, planMoney.toggle),
        planMoney.preview,
        planMoney.rateField,
        el('label', { class: 'cat-row', style: 'border:0;padding:8px 0' }, repeatBox, el('span', { class: 'cat-name' }, 'Каждый месяц, пока не изменю')),
        eff?.inherited ? el('p', { class: 'muted small', style: 'margin:0 0 8px' }, `План действует с ${formatMonthGen(eff.line.month)} (каждый месяц).`) : null,
        el('button', { class: 'btn', type: 'button', style: 'width:100%', onclick: savePlan }, 'Сохранить план'),
        isHidden
          ? el('button', { class: 'btn btn-secondary', type: 'button', style: 'width:100%;margin-top:8px', onclick: async () => { await restoreToMonth(month, category.id); toast('Возвращено в бюджет месяца'); refresh(); } }, `Вернуть в бюджет: ${formatMonth(month).toLowerCase()}`)
          : el('button', { class: 'btn btn-danger', type: 'button', style: 'width:100%;margin-top:8px', onclick: removePlan }, `Убрать из бюджета: ${formatMonth(month).toLowerCase()}`),
      ),
    );

    // 2. Получено в этом месяце (факт)
    const recAmount = el('input', { class: 'input input-amount', inputmode: 'decimal', autocomplete: 'off', placeholder: '0' });
    const recDate = el('input', { class: 'input', type: 'date', value: month === thisMonth ? today : month < thisMonth ? to : from });
    const recMoney = currencyControls({ date: () => recDate.value || today, amountInput: /** @type {HTMLInputElement} */ (recAmount), currency: orig?.currency ?? 'KZT' });
    const list = el('div', { class: 'list', style: 'margin:8px 0' });
    for (const o of monthOps) {
      list.append(el('a', { class: 'row', href: `#/operations/${o.id}` },
        avatar(category.name, { income: true }),
        el('div', { class: 'row-main' }, el('div', null, formatDate(o.date)), o.comment ? el('div', { class: 'muted small' }, o.comment) : null),
        el('div', { class: 'row-amount income' }, formatMoney(o.amount, o.currency)),
      ));
    }
    body.append(
      el('div', { class: 'card' },
        el('div', { class: 'card-title' }, `Получено в ${formatMonth(month).toLowerCase().replace(/ь /, 'е ').replace(/й /, 'е ').replace(/т /, 'те ')}`),
        monthOps.length ? list : el('p', { class: 'muted small', style: 'margin:0 0 8px' }, 'Пока ничего не получено.'),
        el('div', { class: 'field-label', style: 'margin-top:8px' }, 'Записать поступление'),
        el('div', { class: 'amount-row' }, recAmount, recMoney.toggle),
        recMoney.preview,
        recMoney.rateField,
        el('div', { class: 'add-row' }, recDate, el('button', { class: 'btn', type: 'button', onclick: addReceived }, 'Получил(а)')),
      ),
    );

    // Разовые поступления этого источника в месяце (тренинг, проект — с примерной датой)
    const oneOff = (await listPlanned({ from, to, includeDone: true, type: 'income' })).filter((p) => p.categoryId === category.id);
    const oneOffList = el('div', { class: 'list', style: 'margin:8px 0' });
    for (const p of oneOff) oneOffList.append(expectedRow(p, today, rateNow));
    body.append(
      el('div', { class: 'card' },
        el('div', { class: 'card-title' }, `Поступления с датой в ${formatMonth(month).toLowerCase().replace(/ь /, 'е ').replace(/й /, 'е ').replace(/т /, 'те ')}`),
        oneOff.length ? oneOffList : el('p', { class: 'muted small', style: 'margin:0 0 8px' }, 'Например, оплата за тренинг или проект, которая придёт один раз. Входит в план доходов месяца и в «Платежи».'),
        el('a', { class: 'btn btn-secondary', style: 'width:100%', href: `#/planned/new?type=income&category=${category.id}&month=${month}&from=budget` }, '+ Поступление с датой'),
      ),
    );

    // 3. Долг на сегодня
    const debt = incomeDebt({ lines, ops: allIncome, upTo: shiftMonth(thisMonth, 1), rateNow, today, terms: category });
    if (debt) {
      const owed = debt.debt;
      const table = el('table', { class: 'table' },
        el('thead', null, el('tr', null, el('th', null, 'За месяц'), el('th', null, 'Срок'), el('th', { class: 'num' }, 'План'), el('th', { class: 'num' }, 'Получено'))),
        el('tbody', null, ...debt.months.filter((m) => !m.pending || m === debt.next).map((m) => el('tr', { class: m.pending ? 'muted' : '' },
          el('td', null, formatMonth(m.month).replace(/ \d{4}$/, '')),
          el('td', { class: m.pending ? '' : m.due === debt.overdueSince ? 'warn' : '' }, m.pending ? `${formatDate(m.due)} (впереди)` : formatDate(m.due)),
          el('td', { class: 'num' }, formatMoney(m.plan, debt.currency)),
          el('td', { class: `num${m.received >= m.plan && m.plan ? ' income' : ''}` }, formatMoney(m.received, debt.currency)),
        ))),
      );
      // Долг — самое важное, поэтому наверху
      body.prepend(
        el('div', { class: `card debt-card ${owed > 0 ? 'debt-owed' : 'debt-ok'}` },
          el('div', { class: 'card-title' }, category.employer ? `${category.employer} должен` : 'Долг на сегодня'),
          el('div', { class: 'hero-value', style: 'font-size:28px;margin:0' }, owed > 0 ? formatMoney(owed, debt.currency) : 'Нет'),
          debt.daysLate ? el('p', { class: 'warn', style: 'margin:4px 0 0;font-weight:600' }, `Просрочка ${debt.daysLate} дн. — с ${formatDate(/** @type {string} */ (debt.overdueSince))}`) : null,
          el('p', { class: 'muted small', style: 'margin:4px 0 6px' },
            owed > 0
              ? `Наступившие выплаты с ${formatMonthGen(debt.months[0]?.month ?? thisMonth)}: ${formatMoney(debt.plan, debt.currency)}, получено ${formatMoney(debt.received, debt.currency)}.`
              : owed < 0 ? `Получено больше на ${formatMoney(-owed, debt.currency)} (аванс).` : 'Все наступившие выплаты получены.'),
          debt.next ? el('p', { class: 'small', style: 'margin:0 0 10px' }, `Следующая выплата: ${formatDate(debt.next.due)} — ${formatMoney(debt.next.plan, debt.currency)} за ${formatMonth(debt.next.month).toLowerCase()}`) : null,
          table,
        ),
      );
    }

    // Архив: источник больше не нужен (история и операции сохраняются)
    body.append(el('button', { class: 'btn btn-danger', type: 'button', style: 'margin-top:8px', onclick: async () => {
      const ok = await confirmDialog(category.archived
        ? `Вернуть «${category.name}» из архива?`
        : `Перенести «${category.name}» в архив? Источник пропадёт из бюджета и из выбора при записи дохода. Полученные суммы и история сохранятся; вернуть можно здесь же.`, category.archived ? 'Вернуть' : 'В архив');
      if (!ok) return;
      await setCategoryArchived(category.id, !category.archived);
      toast(category.archived ? 'Источник возвращён' : 'Источник перенесён в архив');
      navigate('/budget');
    } }, category.archived ? 'Вернуть источник из архива' : 'Перенести источник в архив'));

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
