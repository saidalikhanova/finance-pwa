import { el, avatar, toast, formatDate, formatMonth, formatMonthGen, currentMonth } from '../ui.js';
import { formatMoney as fmtMoney, amountToInput } from '../money.js';

/** Без «,00» у целых сумм: 600 000 ₸ вместо 600 000,00 ₸. @param {number} a @param {'EUR' | 'KZT'} c */
const formatMoney = (a, c) => fmtMoney(a, c).replace(/,00(?=\u00a0)/, '');
import { setBudgetLine, listCategoryLines } from '../repo/budgets.js';
import { createOperation, listOperations, monthRange, todayISO } from '../repo/operations.js';
import { suggestRate, saveRate } from '../repo/rates.js';
import { effectiveLine, lineOriginal, incomeDebt } from '../income.js';
import { currencyControls } from './currency-input.js';
import { budgetState } from './budget.js';

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
    const lines = await listCategoryLines(category.id);
    const allIncome = (await listOperations({ type: 'income' })).filter((o) => o.categoryId === category.id);
    const { from, to } = monthRange(month);
    const monthOps = allIncome.filter((o) => o.date >= from && o.date <= to).sort((a, b) => (a.date < b.date ? -1 : 1));
    const eff = effectiveLine(lines, month);
    const orig = eff ? lineOriginal(eff.line) : null;
    body.innerHTML = '';

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
        el('div', { class: 'field-label', style: 'margin-top:8px' }, 'Отметить поступление'),
        el('div', { class: 'amount-row' }, recAmount, recMoney.toggle),
        recMoney.preview,
        recMoney.rateField,
        el('div', { class: 'add-row' }, recDate, el('button', { class: 'btn', type: 'button', onclick: addReceived }, 'Получено')),
      ),
    );

    // 3. Долг на сегодня
    const debt = incomeDebt({ lines, ops: allIncome, upTo: thisMonth, rateNow });
    if (debt) {
      const owed = debt.debt;
      const table = el('table', { class: 'table' },
        el('thead', null, el('tr', null, el('th', null, 'Месяц'), el('th', { class: 'num' }, 'План'), el('th', { class: 'num' }, 'Получено'))),
        el('tbody', null, ...debt.months.map((m) => el('tr', null,
          el('td', null, formatMonth(m.month)),
          el('td', { class: 'num' }, formatMoney(m.plan, debt.currency)),
          el('td', { class: `num${m.received >= m.plan ? ' income' : ''}` }, formatMoney(m.received, debt.currency)),
        ))),
      );
      body.append(
        el('div', { class: `card debt-card ${owed > 0 ? 'debt-owed' : 'debt-ok'}` },
          el('div', { class: 'card-title' }, 'Долг на сегодня'),
          el('div', { class: 'hero-value', style: 'font-size:28px;margin:0' }, owed > 0 ? formatMoney(owed, debt.currency) : 'Нет'),
          el('p', { class: 'muted small', style: 'margin:4px 0 10px' },
            owed > 0
              ? `Должны заплатить: план ${formatMoney(debt.plan, debt.currency)} с ${formatMonthGen(debt.months[0]?.month ?? thisMonth)} минус получено ${formatMoney(debt.received, debt.currency)}.`
              : owed < 0 ? `Получено больше плана на ${formatMoney(-owed, debt.currency)}.` : 'Всё по плану получено.'),
          table,
        ),
      );
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
