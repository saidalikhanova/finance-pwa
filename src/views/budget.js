import { money, displayToggle, loadDisplay, displayCurrency } from '../display.js';
import { el, avatar, toast, confirmDialog, formatDate, formatMonth, shiftMonth, currentMonth } from '../ui.js';
import { formatMoney, formatWhole } from '../money.js';
import { listCategories } from '../repo/categories.js';
import { getBudget, listBudgetMonths, copyBudget, listAllLines, restoreToMonth } from '../repo/budgets.js';
import { sumByCategory, todayISO, monthRange, listOperations } from '../repo/operations.js';
import { effectiveLine, lineOriginal, incomeDebt, effectivePlanEur, convert } from '../income.js';
import { listPlanned } from '../repo/planned.js';
import { incomeExpectations, expectedStatus, whenLabel } from '../expected.js';
import { limitStatus, pluralDays } from '../limits.js';
import { listWishes, planWishes } from '../repo/wishes.js';
import { suggestRate } from '../repo/rates.js';
import { listSchedules } from '../repo/recurring.js';
import { scheduledInMonth, isLoanCategory } from '../loans.js';
import { childrenOf, rollup } from '../category-tree.js';
import { toEurCents } from '../money.js';

// Месяц сохраняется между переходами, чтобы после правки строки
// вернуться к тому же месяцу.
export const budgetState = { month: currentMonth() };

/** @param {HTMLElement} root */
export async function renderBudget(root) {
  await loadDisplay();
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
    el('div', { class: 'display-row' }, el('span', { class: 'muted small' }, 'Показывать в'), displayToggle()),
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
    // Платежи по расписанию (кредиты и др.) в этом месяце — план расходов «по графику»
    const schedules = await listSchedules();
    const scheduledEur = (/** @type {string} */ catId) => scheduledInMonth(schedules, catId, month).reduce((sum, { s }) => sum + (toEurCents(s.amount, s.currency, rate) ?? 0), 0);
    // Подпись «по графику»: в валюте показа, а без курса — в валютах платежей
    const scheduledLabel = (/** @type {string} */ catId) => {
      const items = scheduledInMonth(schedules, catId, month);
      if (!items.length) return '';
      if (rate || items.every(({ s }) => s.currency === 'EUR')) return money(scheduledEur(catId));
      /** @type {Map<'EUR' | 'KZT', number>} */
      const by = new Map();
      for (const { s } of items) by.set(s.currency, (by.get(s.currency) ?? 0) + s.amount);
      return [...by].map(([c, a]) => formatWhole(a, c)).join(' + ');
    };
    const { from, to } = monthRange(month);
    // Разовые платежи месяца (не из расписания) — тоже план своей категории / статьи
    const oneOff = (await listPlanned({ from, to, includeDone: true, type: 'expense' })).filter((p) => !p.recurringId);
    const oneOffEur = (/** @type {string} */ catId) => oneOff.filter((p) => p.categoryId === catId).reduce((sum, p) => sum + (toEurCents(p.amount, p.currency, rate) ?? 0), 0);
    /**
     * Свой план категории или статьи (без статей внутри): введённый вручную,
     * иначе — платежи по графику и разовые; null — плана нет.
     * @param {import('../repo/categories.js').Category} c
     */
    const ownPlan = (c) => {
      if (isLoanCategory(c)) return scheduledEur(c.id) || null;
      const line = byCat.get(c.id);
      if (line?.hidden) return null;
      if (line?.planned != null) return line.planned;
      return scheduledEur(c.id) + oneOffEur(c.id) || null;
    };
    /** Статьи категории, которые стоит показать в этом месяце. @param {string} id */
    const articlesOf = (id) => childrenOf(categories, id, { includeArchived: true }).filter((k) => !k.archived || byCat.get(k.id) || fact.get(k.id));
    /**
     * План категории = её собственный план («прочее», без статьи) + планы статей.
     * @param {import('../repo/categories.js').Category} c
     */
    const totalPlan = (c) => {
      const parts = [ownPlan(c), ...articlesOf(c.id).map(ownPlan)].filter((v) => v != null);
      return parts.length ? parts.reduce((a, b) => /** @type {number} */ (a) + /** @type {number} */ (b), 0) : null;
    };
    const factWithArticles = rollup(fact, categories);
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
      // Свёрнуто, чтобы не занимать место: раскрыто только у месяца без бюджета
      body.append(
        el('details', { class: 'card list-card', open: !lines.length },
          el('summary', { class: 'muted' }, lines.length ? 'Скопировать бюджет из другого месяца' : 'На этот месяц бюджета ещё нет — скопировать из другого месяца?'),
          el('div', { class: 'add-row', style: 'padding:8px 0 12px' }, select, el('button', { class: 'btn btn-small', onclick: () => doCopy(select.value) }, 'Скопировать')),
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
        const catLines = allLines.filter((l) => l.categoryId === c.id);
        const inheritedOnly = c.archived && effectiveLine(catLines, month)?.inherited;
        planIncome += (inheritedOnly ? 0 : effectivePlanEur(catLines, month, rate) ?? 0) + (exp.byCategory.get(c.id)?.planned ?? 0);
        factIncome += f;
      } else {
        // План — по категориям верхнего уровня (вместе со статьями); факт — по всем записям
        if (!c.parentId) planExpense += totalPlan(c) ?? 0;
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
        exp.pending ? el('p', { class: 'small', style: 'margin:8px 0 0' }, `Ещё ожидается поступлений: ${money(exp.pending)}`) : null,
        el('p', { class: 'muted small', style: 'margin:8px 0 0' }, 'План вы задаёте сами, нажав на категорию. Факт — из записанных операций и отмеченных поступлений.'),
      ),
    );

    // Доходы: у каждого источника — план месяца, получено и долг на сегодня
    body.append(
      el('h2', { class: 'section-title' }, 'Доходы'),
      el('p', { class: 'muted small', style: 'margin:-4px 4px 8px' }, 'Нажмите на источник, чтобы задать план и отметить, когда и сколько получено.'),
    );
    const incomeList = el('div', { class: 'list' });
    body.append(incomeList);
    // Ожидаемые разовые поступления (и задержанные с прошлых месяцев) —
    // под своим источником дохода, а не отдельным списком
    /** @type {Map<string, typeof monthIncome>} */
    const expectedBy = new Map();
    for (const p of [...lateFromBefore, ...monthIncome]) {
      expectedBy.set(p.categoryId, [...(expectedBy.get(p.categoryId) ?? []), p]);
    }
    /** @param {typeof monthIncome} items */
    const appendExpected = (items) => {
      for (const p of items) incomeList.append(expectedRow(p, today, rate, true));
    };
    // Категории, убранные из этого месяца (без записанных сумм)
    /** @type {typeof categories} */
    const hidden = [];
    for (const c of categories.filter((c) => c.kind === 'income')) {
      if (byCat.get(c.id)?.hidden && !fact.get(c.id)) {
        if (!c.archived) hidden.push(c);
        continue;
      }
      const catLines = allLines.filter((l) => l.categoryId === c.id);
      const eff = effectiveLine(catLines, month);
      const orig = eff ? lineOriginal(eff.line) : null;
      const f = fact.get(c.id) ?? 0;
      const e = exp.byCategory.get(c.id);
      // Источник в архиве: план «каждый месяц» дальше не действует
      if (c.archived && !(eff && !eff.inherited) && !f && !e && !expectedBy.get(c.id)?.length) continue;
      const catOps = incomeOps.filter((o) => o.categoryId === c.id);
      const recMonth = orig ? catOps.filter((o) => o.date.slice(0, 7) === month).reduce((s, o) => s + (o.currency === orig.currency ? o.amount : (convert(o.amount, o.currency, orig.currency, o.rate ?? rate) ?? 0)), 0) : null;
      const debt = incomeDebt({ lines: catLines, ops: catOps, upTo: shiftMonth(thisMonth, 1), rateNow: rate, today, terms: c });
      const sub = orig
        ? `план ${formatWhole(orig.amount, orig.currency)} · получено ${formatWhole(/** @type {number} */ (recMonth), orig.currency)}`
        : e ? `ожидается ${money(e.pending)}` : expectedBy.get(c.id)?.length ? 'ожидаемые поступления — ниже' : 'план не задан';
      const right = debt && debt.debt > 0
        ? el('div', { class: 'row-amount' }, el('div', { class: 'warn' }, formatWhole(debt.debt, debt.currency)), el('div', { class: 'muted small' }, debt.daysLate ? `просрочка ${debt.daysLate} дн.` : 'должны'))
        : el('div', { class: 'row-amount' }, el('div', { class: 'income' }, money(f)), el('div', { class: 'muted small' }, 'получено'));
      // «Получено» — как у ожидаемых поступлений: записать пришедшие деньги одним нажатием
      if (orig) {
        const date = month === today.slice(0, 7) ? today : `${month}-01`;
        right.append(el('a', { class: 'btn btn-small expected-btn', href: `#/add?type=income&category=${c.id}&currency=${orig.currency}&date=${date}` }, 'Получено'));
      }
      const href = `#/budget/${month}/${c.id}`;
      incomeList.append(
        el('div', { class: 'row' },
          el('a', { href, style: 'display:contents' }, avatar(c.name, { income: true })),
          el('a', { class: 'row-main', href, style: 'color:inherit;text-decoration:none' }, el('div', null, c.archived ? `${c.name} (архив)` : c.name), c.employer ? el('div', { class: 'small' }, c.employer) : el('div', { class: 'small muted' }, 'работодатель не указан'), el('div', { class: 'muted small' }, sub)),
          right,
        ),
      );
      appendExpected(expectedBy.get(c.id) ?? []);
      expectedBy.delete(c.id);
    }
    // Поступления без показанного источника (например, источник в архиве)
    appendExpected([...expectedBy.values()].flat());
    body.append(el('a', { class: 'btn btn-secondary btn-small', style: 'width:100%;margin-bottom:12px', href: '#/income/new?new=1' }, '+ Новый источник дохода'));

    // Расходы
    body.append(el('h2', { class: 'section-title' }, 'Расходы'));
    const expenseList = el('div', { class: 'list' });
    for (const c of categories.filter((c) => c.kind === 'expense' && !c.parentId)) {
      const line = byCat.get(c.id);
      const f = factWithArticles.get(c.id) ?? 0;
      if (line?.hidden && !f) {
        if (!c.archived) hidden.push(c);
        continue;
      }
      if (c.archived && !line && !f) continue;
      const articles = articlesOf(c.id);
      expenseList.append(expenseRow(c, line, f, month, today, scheduledLabel(c.id), { plan: totalPlan(c), articles: articles.length }));
      // Статьи — под своей категорией
      for (const k of articles) {
        const kLine = byCat.get(k.id);
        const kf = fact.get(k.id) ?? 0;
        if (kLine?.hidden && !kf) continue;
        expenseList.append(expenseRow(k, kLine, kf, month, today, '', { plan: ownPlan(k), article: true }));
      }
    }
    body.append(expenseList);

    if (hidden.length) {
      const details = el('details', { class: 'card list-card' }, el('summary', { class: 'muted' }, `Убраны из этого месяца: ${hidden.length}`));
      for (const c of hidden) {
        details.append(el('div', { class: 'cat-row' },
          avatar(c.name, { income: c.kind === 'income', small: true }),
          el('span', { class: 'cat-name' }, c.name),
          el('button', { class: 'link-btn', type: 'button', onclick: async () => {
            await restoreToMonth(month, c.id);
            toast(`«${c.name}» возвращена в ${formatMonth(month).toLowerCase()}`);
            refresh();
          } }, 'Вернуть'),
        ));
      }
      body.append(details);
    }


    // Желаемые покупки рядом с бюджетом (п. 4.14 ТЗ)
    const wishes = (await listWishes()).filter((w) => w.status === 'want');
    const plannedWishes = (await listWishes()).filter((w) => w.status === 'planned' && w.plannedMonth === month);
    if (wishes.length || plannedWishes.length) {
      // Свёрнуто: раскрывается, когда нужно перенести желаемое в план месяца
      const card = el('details', { class: 'card list-card' }, el('summary', { class: 'muted' }, `Желаемые покупки: ${wishes.length}${plannedWishes.length ? ` · в плане месяца: ${plannedWishes.length}` : ''}`));
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
            el('span', { class: 'small' }, eur == null ? 'без цены' : money(eur)),
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
 * @param {boolean} [nested] — под строкой источника дохода в бюджете
 */
export function expectedRow(p, today, rate, nested = false) {
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
    { class: `row expected-row expected-${st.status}${nested ? ' expected-nested' : ''}` },
    avatar(p.name, { income: true }),
    el('a', { class: 'row-main', href: `#/planned/${p.id}?from=budget`, style: 'color:inherit;text-decoration:none' },
      el('div', null, p.name),
      el('div', { class: 'small' }, el('span', { class: `chip-status chip-${st.status}` }, label), p.movedFrom ? el('span', { class: 'muted' }, ` · перенесено с ${formatMonth(p.movedFrom).toLowerCase()}`) : null),
    ),
    el('div', { class: 'row-amount' },
      el('div', { class: st.status === 'received' ? 'income' : '' }, formatMoney(shown, p.currency)),
      eur != null && st.status !== 'received' && displayCurrency() !== p.currency ? el('div', { class: 'muted small' }, `≈ ${money(eur)}`) : null,
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
    el('span', { class: 'muted' }, money(plan, { sign: signed })),
    el('span', { class: cls }, money(fact, { sign: signed })),
  );
}

/**
 * @param {import('../repo/categories.js').Category} c
 * @param {import('../repo/budgets.js').BudgetLine | undefined} line
 * @param {number} fact
 * @param {string} month
 * @param {string} today
 * @param {string} [scheduled] — платежи по расписанию в месяце (подпись суммы)
 * @param {{ plan?: number | null, articles?: number, article?: boolean }} [opts] —
 *   plan: план (у категории — вместе со статьями); articles: сколько статей; article: строка статьи
 */
function expenseRow(c, line, fact, month, today, scheduled = '', opts = {}) {
  const name = c.archived ? `${c.name} (архив)` : c.name;
  const loan = isLoanCategory(c);
  const limit = loan ? null : line?.limit ?? null;
  const planned = loan ? null : opts.plan !== undefined ? opts.plan : line?.planned ?? null;

  const main = el('div', { class: 'row-main' }, el('div', null, name));
  const amount = el('div', { class: 'row-amount' }, el('div', null, money(fact)));
  const row = el('a', { class: `row row-budget${opts.article ? ' row-article' : ''}`, href: `#/budget/${month}/${c.id}` }, el('div', { class: 'row-top' }, el('div', { style: 'display:flex;gap:12px;align-items:center;min-width:0' }, avatar(c.name, { small: opts.article }), main), amount));

  const notes = [];
  if (opts.articles) notes.push(`статей: ${opts.articles}`);
  if (planned != null) notes.push(`план ${money(planned)}`);
  else if (scheduled && !loan) notes.push(`по графику ${scheduled}`);
  else if (scheduled) notes.push('по графику платежей');

  if (limit != null) {
    const s = limitStatus(limit, fact, month, today);
    amount.append(el('div', { class: `small ${s.level === 'ok' ? 'muted' : s.level === 'warn' ? 'warn' : 'over'}` }, `${s.percent} % из ${money(limit)}`));
    const bar = el('div', { class: `bar bar-${s.level}` }, el('div', { class: 'bar-fill', style: `width:${Math.min(100, s.percent)}%` }));
    row.append(bar);
    if (s.remaining < 0) notes.push(`превышение ${money(-s.remaining)}`);
    else {
      notes.push(`осталось ${money(s.remaining)}`);
      if (s.perDay != null) notes.push(`${money(s.perDay)} в день (${s.daysLeft} ${pluralDays(s.daysLeft)})`);
    }
  } else if (loan) {
    amount.append(el('div', { class: 'muted small' }, scheduled ? `из ${scheduled}` : 'кредитов нет'));
  } else if (!opts.article) {
    amount.append(el('div', { class: 'muted small' }, 'лимит не задан'));
  }
  if (notes.length) row.append(el('div', { class: 'muted small' }, notes.join(' · ')));
  return row;
}
