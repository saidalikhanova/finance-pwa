import { el, avatar, toast, confirmDialog, formatDate, formatMonth, shiftMonth, currentMonth } from '../ui.js';
import { formatMoney, formatWhole } from '../money.js';
import { listCategories } from '../repo/categories.js';
import { getBudget, listBudgetMonths, copyBudget, listAllLines } from '../repo/budgets.js';
import { sumByCategory, todayISO, monthRange, listOperations } from '../repo/operations.js';
import { effectiveLine, lineOriginal, incomeDebt, effectivePlanEur, convert } from '../income.js';
import { listPlanned } from '../repo/planned.js';
import { incomeExpectations, expectedStatus, whenLabel } from '../expected.js';
import { limitStatus, pluralDays } from '../limits.js';
import { listWishes, planWishes } from '../repo/wishes.js';
import { suggestRate } from '../repo/rates.js';
import { toEurCents } from '../money.js';

// Месяц сохраняется между переходами, чтобы после правки строки
// вернуться к тому же месяцу.
export const budgetState = { month: currentMonth() };

/** @param {HTMLElement} root */
export async function renderBudget(root) {
  const monthLabel = el('span', { class: 'month-label' }, formatMonth(budgetState.month));
  const body = el('div');

  root.append(
    el(
      'div',
      { class: 'month-nav' },
      el('button', { class: 'icon-btn', 'aria-label': 'Предыдущий месяц', onclick: () => go(-1) }, '‹'),
      monthLabel,
      el('button', { class: 'icon-btn', 'aria-label': 'Следующий месяц', onclick: () => go(1) }, '›'),
    ),
    body,
  );

  /** @param {number} delta */
  function go(delta) {
    budgetState.month = shiftMonth(budgetState.month, delta);
    monthLabel.textContent = formatMonth(budgetState.month);
    refresh();
  }

  async function refresh() {
    const month = budgetState.month;
    const [categories, lines, fact, months] = await Promise.all([
      listCategories({ includeArchived: true }),
      getBudget(month),
      sumByCategory(month),
      listBudgetMonths(),
    ]);
    const byCat = new Map(lines.map((l) => [l.categoryId, l]));
    const today = todayISO();
    // Ожидаемые поступления месяца: входят в план доходов
    const rate = (await suggestRate(today))?.rate ?? null;
    const { from, to } = monthRange(month);
    const monthIncome = await listPlanned({ from, to, includeDone: true, type: 'income' });
    const exp = incomeExpectations(monthIncome, month, (p) => toEurCents(p.amount, p.currency, rate));
    // В текущем месяце показываем и задержанные с прошлых месяцев
    const lateFromBefore = month === today.slice(0, 7) ? (await listPlanned({ to: `${month}-00`, type: 'income' })) : [];
    const thisMonth = today.slice(0, 7);
    const allLines = await listAllLines();
    const incomeOps = await listOperations({ type: 'income' });
    body.innerHTML = '';

    // Копирование бюджета из другого месяца
    const sources = months.filter((m) => m !== month);
    if (sources.length) {
      const prev = sources.find((m) => m < month) ?? sources[0];
      const select = el('select', { class: 'select', 'aria-label': 'Месяц-источник' }, ...sources.map((m) => el('option', { value: m }, formatMonth(m))));
      select.value = prev;
      body.append(
        el(
          'div',
          { class: lines.length ? 'copy-row copy-row-compact' : 'card copy-row' },
          lines.length ? null : el('p', { class: 'muted' }, 'На этот месяц бюджета ещё нет.'),
          el('div', { class: 'add-row' }, select, el('button', { class: 'btn btn-small', onclick: () => doCopy(select.value) }, 'Скопировать')),
        ),
      );
    } else if (!lines.length) {
      body.append(el('p', { class: 'muted' }, 'Нажмите на категорию, чтобы задать план и лимит на месяц.'));
    }

    // Итоги
    let planIncome = 0;
    let planExpense = 0;
    let factIncome = 0;
    let factExpense = 0;
    for (const c of categories) {
      const line = byCat.get(c.id);
      const f = fact.get(c.id) ?? 0;
      if (c.kind === 'income') {
        planIncome += (effectivePlanEur(allLines.filter((l) => l.categoryId === c.id), month, rate) ?? 0) + (exp.byCategory.get(c.id)?.planned ?? 0);
        factIncome += f;
      } else {
        planExpense += line?.planned ?? 0;
        factExpense += f;
      }
    }
    body.append(
      el(
        'div',
        { class: 'card' },
        el('div', { class: 'plan-head' }, el('span'), el('span', { class: 'muted small' }, 'План'), el('span', { class: 'muted small' }, 'Факт')),
        totalRow('Доходы', planIncome, factIncome, 'income'),
        totalRow('Расходы', planExpense, factExpense),
        totalRow('Баланс', planIncome - planExpense, factIncome - factExpense, '', true),
        exp.pending ? el('p', { class: 'small', style: 'margin:8px 0 0' }, `Ещё ожидается поступлений: ${formatMoney(exp.pending, 'EUR')}`) : null,
        el('p', { class: 'muted small', style: 'margin:8px 0 0' }, 'План вы задаёте сами, нажав на категорию. Факт — из записанных операций и отмеченных поступлений.'),
      ),
    );

    // Расходы
    body.append(el('h2', { class: 'section-title' }, 'Расходы'));
    const expenseList = el('div', { class: 'list' });
    for (const c of categories.filter((c) => c.kind === 'expense')) {
      const line = byCat.get(c.id);
      const f = fact.get(c.id) ?? 0;
      if (c.archived && !line && !f) continue;
      expenseList.append(expenseRow(c, line, f, month, today));
    }
    body.append(expenseList);

    // Доходы: у каждого источника — план месяца, получено и долг на сегодня
    body.append(
      el('h2', { class: 'section-title' }, 'Доходы'),
      el('p', { class: 'muted small', style: 'margin:-4px 4px 8px' }, 'Нажмите на источник, чтобы задать план и отметить, когда и сколько получено.'),
    );
    const incomeList = el('div', { class: 'list' });
    body.append(incomeList);
    for (const c of categories.filter((c) => c.kind === 'income')) {
      const catLines = allLines.filter((l) => l.categoryId === c.id);
      const eff = effectiveLine(catLines, month);
      const orig = eff ? lineOriginal(eff.line) : null;
      const f = fact.get(c.id) ?? 0;
      const e = exp.byCategory.get(c.id);
      if (c.archived && !eff && !f && !e) continue;
      const catOps = incomeOps.filter((o) => o.categoryId === c.id);
      const recMonth = orig ? catOps.filter((o) => o.date.slice(0, 7) === month).reduce((s, o) => s + (o.currency === orig.currency ? o.amount : (convert(o.amount, o.currency, orig.currency, o.rate ?? rate) ?? 0)), 0) : null;
      const debt = incomeDebt({ lines: catLines, ops: catOps, upTo: thisMonth, rateNow: rate });
      const sub = orig
        ? `план ${formatWhole(orig.amount, orig.currency)} · получено ${formatWhole(/** @type {number} */ (recMonth), orig.currency)}`
        : e ? `ожидается ${formatMoney(e.pending, 'EUR')}` : 'план не задан';
      const right = debt && debt.debt > 0
        ? el('div', { class: 'row-amount' }, el('div', { class: 'warn' }, formatWhole(debt.debt, debt.currency)), el('div', { class: 'muted small' }, 'должны'))
        : el('div', { class: 'row-amount' }, el('div', { class: 'income' }, formatMoney(f, 'EUR')), el('div', { class: 'muted small' }, 'получено'));
      incomeList.append(
        el('a', { class: 'row', href: `#/budget/${month}/${c.id}` },
          avatar(c.name, { income: true }),
          el('div', { class: 'row-main' }, el('div', null, c.archived ? `${c.name} (архив)` : c.name), el('div', { class: 'muted small' }, sub)),
          right,
        ),
      );
    }
    body.append(el('a', { class: 'link-btn', style: 'display:block;margin:0 4px 12px', href: '#/categories' }, '+ Добавить источник дохода (например, отдельно по каждой работе)'));

    // Ожидаемые поступления месяца (и задержанные с прошлых месяцев)
    const expectedRows = [...lateFromBefore, ...monthIncome];
    if (expectedRows.length) {
      body.append(el('h2', { class: 'section-title' }, 'Ожидаемые поступления'));
      const list = el('div', { class: 'list' });
      for (const p of expectedRows) list.append(expectedRow(p, today, rate));
      body.append(list);
    }

    // Желаемые покупки рядом с бюджетом (п. 4.14 ТЗ)
    const wishes = (await listWishes()).filter((w) => w.status === 'want');
    const plannedWishes = (await listWishes()).filter((w) => w.status === 'planned' && w.plannedMonth === month);
    if (wishes.length || plannedWishes.length) {
      body.append(el('h2', { class: 'section-title' }, 'Желаемые покупки'));
      const card = el('div', { class: 'card list-card' });
      const priceEur = (/** @type {import('../repo/wishes.js').Wish} */ w) => (w.price == null ? null : toEurCents(w.price, w.currency, rate));
      /** @type {HTMLInputElement[]} */
      const boxes = [];
      for (const w of wishes) {
        const eur = priceEur(w);
        const box = /** @type {HTMLInputElement} */ (el('input', { type: 'checkbox', value: w.id, disabled: eur == null }));
        boxes.push(box);
        card.append(
          el(
            'label',
            { class: 'cat-row' },
            box,
            el('span', { class: 'cat-name' }, w.name, el('span', { class: 'muted small' }, ` · ${categories.find((c) => c.id === w.categoryId)?.name ?? ''}`)),
            el('span', { class: 'small' }, eur == null ? 'без цены' : formatMoney(eur, 'EUR')),
          ),
        );
      }
      if (wishes.length) {
        card.append(
          el('div', { class: 'add-row' }, el('button', {
            class: 'btn btn-small',
            onclick: async () => {
              const ids = boxes.filter((b) => b.checked).map((b) => b.value);
              if (!ids.length) {
                toast('Отметьте записи', { error: true });
                return;
              }
              const r = await planWishes(ids, month, priceEur);
              toast(`В план месяца добавлено: ${r.moved}`);
              refresh();
            },
          }, `В план ${formatMonth(month)}`)),
        );
      }
      for (const w of plannedWishes) {
        card.append(el('div', { class: 'cat-row muted small' }, el('span', { class: 'cat-name' }, `${w.name} — в плане месяца`), el('a', { class: 'link-btn', href: `#/wishes/${w.id}` }, '›')));
      }
      body.append(card);
    }

    /** @param {string} from */
    async function doCopy(from) {
      if (lines.length && !(await confirmDialog(`Заменить бюджет на ${formatMonth(month)} бюджетом за ${formatMonth(from)}?`))) return;
      try {
        const n = await copyBudget(from, month);
        toast(`Скопировано строк: ${n}`);
        refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Не удалось скопировать', { error: true });
      }
    }
  }

  await refresh();
}

/**
 * Строка ожидаемого поступления со статусом и кнопкой «Получено».
 * @param {import('../repo/planned.js').PlannedPayment} p
 * @param {string} today
 * @param {number | null} rate
 */
export function expectedRow(p, today, rate) {
  const st = expectedStatus(p, today);
  const label =
    st.status === 'received'
      ? `получено ${p.receivedDate ? formatDate(p.receivedDate) : ''}`
      : st.status === 'overdue'
        ? `задерживается ${st.daysLate} дн.`
        : `ожидается ${whenLabel(p, formatDate)}`;
  const eur = p.currency === 'KZT' ? toEurCents(p.amount, 'KZT', rate) : null;
  const shown = st.status === 'received' && p.receivedAmount != null ? p.receivedAmount : p.amount;
  return el(
    'div',
    { class: `row expected-row expected-${st.status}` },
    avatar(p.name, { income: true }),
    el('a', { class: 'row-main', href: `#/planned/${p.id}?from=budget`, style: 'color:inherit;text-decoration:none' },
      el('div', null, p.name),
      el('div', { class: 'small' }, el('span', { class: `chip-status chip-${st.status}` }, label), p.movedFrom ? el('span', { class: 'muted' }, ` · перенесено с ${formatMonth(p.movedFrom).toLowerCase()}`) : null),
    ),
    el('div', { class: 'row-amount' },
      el('div', { class: st.status === 'received' ? 'income' : '' }, formatMoney(shown, p.currency)),
      eur != null && st.status !== 'received' ? el('div', { class: 'muted small' }, `≈ ${formatMoney(eur, 'EUR')}`) : null,
      st.status !== 'received' ? el('a', { class: 'btn btn-small expected-btn', href: `#/operations/new?planned=${p.id}` }, 'Получено') : null,
    ),
  );
}

/**
 * @param {string} label
 * @param {number} plan
 * @param {number} fact
 * @param {string} [cls]
 * @param {boolean} [signed]
 */
function totalRow(label, plan, fact, cls = '', signed = false) {
  return el(
    'div',
    { class: 'plan-row' },
    el('span', null, label),
    el('span', { class: 'muted' }, formatMoney(plan, 'EUR', { sign: signed })),
    el('span', { class: cls }, formatMoney(fact, 'EUR', { sign: signed })),
  );
}

/**
 * @param {import('../repo/categories.js').Category} c
 * @param {import('../repo/budgets.js').BudgetLine | undefined} line
 * @param {number} fact
 * @param {string} month
 * @param {string} today
 */
function expenseRow(c, line, fact, month, today) {
  const name = c.archived ? `${c.name} (архив)` : c.name;
  const limit = line?.limit ?? null;
  const planned = line?.planned ?? null;

  const main = el('div', { class: 'row-main' }, el('div', null, name));
  const amount = el('div', { class: 'row-amount' }, el('div', null, formatMoney(fact, 'EUR')));
  const row = el('a', { class: 'row row-budget', href: `#/budget/${month}/${c.id}` }, el('div', { class: 'row-top' }, el('div', { style: 'display:flex;gap:12px;align-items:center;min-width:0' }, avatar(c.name), main), amount));

  const notes = [];
  if (planned != null) notes.push(`план ${formatMoney(planned, 'EUR')}`);

  if (limit != null) {
    const s = limitStatus(limit, fact, month, today);
    amount.append(el('div', { class: `small ${s.level === 'ok' ? 'muted' : s.level === 'warn' ? 'warn' : 'over'}` }, `${s.percent} % из ${formatMoney(limit, 'EUR')}`));
    const bar = el('div', { class: `bar bar-${s.level}` }, el('div', { class: 'bar-fill', style: `width:${Math.min(100, s.percent)}%` }));
    row.append(bar);
    if (s.remaining < 0) notes.push(`превышение ${formatMoney(-s.remaining, 'EUR')}`);
    else {
      notes.push(`осталось ${formatMoney(s.remaining, 'EUR')}`);
      if (s.perDay != null) notes.push(`${formatMoney(s.perDay, 'EUR')} в день (${s.daysLeft} ${pluralDays(s.daysLeft)})`);
    }
  } else {
    amount.append(el('div', { class: 'muted small' }, 'лимит не задан'));
  }
  if (notes.length) row.append(el('div', { class: 'muted small' }, notes.join(' · ')));
  return row;
}
