import { el, toast, confirmDialog, formatMonth, shiftMonth, currentMonth } from '../ui.js';
import { formatMoney } from '../money.js';
import { listCategories } from '../repo/categories.js';
import { getBudget, listBudgetMonths, copyBudget } from '../repo/budgets.js';
import { sumByCategory, todayISO } from '../repo/operations.js';
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
        planIncome += line?.planned ?? 0;
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
      ),
    );

    // Расходы
    body.append(el('h2', { class: 'section-title' }, 'Расходы'));
    for (const c of categories.filter((c) => c.kind === 'expense')) {
      const line = byCat.get(c.id);
      const f = fact.get(c.id) ?? 0;
      if (c.archived && !line && !f) continue;
      body.append(expenseRow(c, line, f, month, today));
    }

    // Доходы
    body.append(el('h2', { class: 'section-title' }, 'Доходы'));
    for (const c of categories.filter((c) => c.kind === 'income')) {
      const line = byCat.get(c.id);
      const f = fact.get(c.id) ?? 0;
      if (c.archived && !line && !f) continue;
      body.append(
        el(
          'a',
          { class: 'row', href: `#/budget/${month}/${c.id}` },
          el('div', { class: 'row-main' }, el('div', null, c.archived ? `${c.name} (архив)` : c.name)),
          el(
            'div',
            { class: 'row-amount' },
            el('div', { class: 'income' }, formatMoney(f, 'EUR')),
            el('div', { class: 'muted small' }, line?.planned != null ? `план ${formatMoney(line.planned, 'EUR')}` : 'план не задан'),
          ),
        ),
      );
    }

    // Желаемые покупки рядом с бюджетом (п. 4.14 ТЗ)
    const wishes = (await listWishes()).filter((w) => w.status === 'want');
    const plannedWishes = (await listWishes()).filter((w) => w.status === 'planned' && w.plannedMonth === month);
    if (wishes.length || plannedWishes.length) {
      body.append(el('h2', { class: 'section-title' }, 'Желаемые покупки'));
      const card = el('div', { class: 'card list-card' });
      const rate = (await suggestRate(today))?.rate ?? null;
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
  const row = el('a', { class: 'row row-budget', href: `#/budget/${month}/${c.id}` }, el('div', { class: 'row-top' }, main, amount));

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
