import { el, avatar, toast, formatMonth, formatDate, confirmDialog, promptDialog } from '../ui.js';
import { parseAmount, amountToInput, formatMoney, toEurCents, fromEurCents, formatRate } from '../money.js';
import { navigate } from '../router.js';
import { getCategory, listCategories, createArticle, renameCategory, setCategoryArchived } from '../repo/categories.js';
import { childrenOf, rollup, fullName } from '../category-tree.js';
import { listSchedules } from '../repo/recurring.js';
import { listPlanned } from '../repo/planned.js';
import { PERIOD_LABEL } from '../recurring.js';
import { getBudgetLine, setBudgetLine, removeFromMonth, restoreToMonth } from '../repo/budgets.js';
import { sumByCategory, todayISO, monthRange } from '../repo/operations.js';
import { suggestRate, saveRate } from '../repo/rates.js';
import { budgetState } from './budget.js';
import { renderIncomeLine } from './income-line.js';
import { segmented } from './form-parts.js';
import { listLoans, loanLeft } from '../repo/loans.js';
import { loanStatus } from './loan-form.js';
import { isLoanCategory, scheduledInMonth } from '../loans.js';
import { money, loadDisplay } from '../display.js';
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
  const allCats = await listCategories({ includeArchived: true });
  const byId = new Map(allCats.map((c) => [c.id, c]));
  const articles = category.parentId ? [] : childrenOf(allCats, categoryId);
  const isArticle = Boolean(category.parentId);
  // Факт категории — вместе со статьями
  const fact = rollup(await sumByCategory(month), allCats).get(categoryId) ?? 0;
  const isExpense = category.kind === 'expense';
  const title = document.getElementById('page-title');
  if (title && isExpense) title.textContent = fullName(category, byId);
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
    plannedLabel.textContent = !isExpense ? `План доходов, ${unit}` : articles.length ? `План без статьи (прочее), ${unit}` : isArticle ? `План статьи, ${unit}` : `План расходов, ${unit}`;
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
    el('div', { class: 'card' }, el('div', { class: 'muted small' }, `${fullName(category, byId)} · ${formatMonth(month)}`), el('div', null, `Факт: ${formatMoney(fact, 'EUR')}${articles.length ? ' (вместе со статьями)' : ''}`)),
    el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Валюта ввода'), toggle),
    rateField,
    el('label', { class: 'field' }, plannedLabel, plannedInput, plannedPreview),
    ...(isExpense
      ? [el('label', { class: 'field' }, limitLabel, limitInput, limitPreview, el('p', { class: 'muted small' }, 'Предупреждение при 80 % и при превышении. Пустое поле — без лимита.'))]
      : []),
    el('p', { class: 'muted small' }, isExpense
      ? articles.length
        ? 'План категории = планы статей + этот план «прочее» (траты без статьи). Лимит — на всю категорию вместе со статьями.'
        : isArticle
          ? 'План статьи — сколько ожидаете потратить; если поле пустое, план берётся из платежей статьи ниже. Факт — из записанных расходов по статье.'
          : 'План — сколько ожидаете потратить; факт считается из записанных расходов.'
      : 'Здесь — общий план, если не хотите расписывать по поступлениям. Ожидаемые доходы (кнопка «+ Ожидаемый доход» в бюджете) добавляются к нему автоматически. Факт считается из полученных доходов.'),
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
  // Категория «Кредиты»: план — это платежи по графику, лимит не нужен.
  // Вместо полей плана и лимита — кредиты, оплачено за месяц и операции.
  if (isLoanCategory(category)) {
    await loadDisplay();
    const title = document.getElementById('page-title');
    if (title) title.textContent = category.name;
    root.append(
      await loansCard(categoryId, month),
      el('div', { class: 'card' },
        el('div', { class: 'muted small' }, `${category.name} · ${formatMonth(month)}`),
        el('div', null, `Оплачено за месяц: ${money(fact)}`),
        el('p', { class: 'muted small', style: 'margin:6px 0 0' }, 'План по кредитам считается сам — по графику платежей. Лимит для кредитов не нужен.'),
      ),
      el('a', { class: 'btn btn-secondary', style: 'width:100%', href: `#/operations?month=${month}&category=${categoryId}` }, 'Все оплаты за месяц'),
    );
    if (line?.hidden) root.append(el('button', { class: 'btn btn-secondary', type: 'button', style: 'width:100%;margin-top:8px', onclick: onRestore }, `Вернуть в бюджет: ${formatMonth(month).toLowerCase()}`));
    return;
  }
  // Статьи категории / платежи статьи — над планом и лимитом
  if (isExpense && !isArticle) root.append(await articlesCard(category, articles, month));
  if (isArticle) root.append(await articlePaymentsCard(category, month));
  root.append(form);
  if (isArticle) root.append(articleActions(category, month));

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
      const left = await loanLeft(s);
      const day = Number(s.startDate.slice(8));
      const sub = [`${day} числа`, s.status === 'paused' ? 'на паузе' : s.status === 'finished' ? 'выплачен' : left ? `осталось платежей: ${left.count}` : 'срок не указан'].join(' · ');
      // Сумма кредита и сколько ещё выплатить по графику
      const money2 = [s.principal ? `кредит ${formatWhole(s.principal, s.currency)}` : null, left && left.count && s.status !== 'finished' ? `осталось выплатить ${formatWhole(left.amount, s.currency)}` : null].filter(Boolean).join(' · ');
      const href = `#/loans/${s.id}?month=${month}`;
      const status = await loanStatus(s);
      list.append(el('div', { class: 'row' },
        el('a', { href, style: 'display:contents' }, avatar(s.bank ?? s.name, { small: true })),
        el('a', { class: 'row-main', href, style: 'color:inherit;text-decoration:none' },
          el('div', null, s.name),
          el('div', { class: 'muted small' }, sub),
          money2 ? el('div', { class: 'muted small' }, money2) : null,
          status.text ? el('div', { class: `small ${status.late ? 'warn' : ''}` }, status.text) : null,
        ),
        el('div', { class: 'row-amount expense' },
          el('div', null, formatWhole(-s.amount, s.currency)),
          status.canPay ? el('a', { class: 'btn btn-small expected-btn', href: `#/operations/new?loan=${s.id}` }, 'Отметить оплату') : null,
        ),
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
      const leftBy = new Map(await Promise.all(loans.map(async (s) => /** @type {[string, number]} */ ([s.id, (await loanLeft(s))?.amount ?? 0]))));
      const leftTotal = byCurrency((s) => leftBy.get(s.id) ?? 0);
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

/**
 * План статьи на месяц, центы евро: введённый вручную, иначе — её платежи
 * (по графику и разовые). null — плана нет.
 * @param {string} id
 * @param {string} month
 * @param {{ schedules: import('../recurring.js').Schedule[], oneOff: import('../repo/planned.js').PlannedPayment[], rate: number | null }} ctx
 */
async function articlePlanEur(id, month, ctx) {
  const line = await getBudgetLine(month, id);
  if (line?.hidden) return null;
  if (line?.planned != null) return line.planned;
  const sched = scheduledInMonth(ctx.schedules, id, month).reduce((sum, { s }) => sum + (toEurCents(s.amount, s.currency, ctx.rate) ?? 0), 0);
  const once = ctx.oneOff.filter((p) => p.categoryId === id).reduce((sum, p) => sum + (toEurCents(p.amount, p.currency, ctx.rate) ?? 0), 0);
  return sched + once || null;
}

/**
 * «Статьи»: из чего состоит категория — план и факт каждой статьи, «+ Статья».
 * @param {import('../repo/categories.js').Category} category
 * @param {import('../repo/categories.js').Category[]} articles
 * @param {string} month
 */
async function articlesCard(category, articles, month) {
  await loadDisplay();
  const { from, to } = monthRange(month);
  const ctx = {
    schedules: await listSchedules(),
    oneOff: (await listPlanned({ from, to, includeDone: true, type: 'expense' })).filter((p) => !p.recurringId),
    rate: (await suggestRate(todayISO()))?.rate ?? null,
  };
  const facts = await sumByCategory(month);
  const card = el('div', { class: 'card' }, el('div', { class: 'card-title' }, 'Статьи'));
  if (!articles.length) {
    card.append(el('p', { class: 'muted small', style: 'margin:0 0 10px' }, `Разбейте «${category.name}» на статьи — например, «Страховка Freedom», «Аптека». План категории сложится из планов статей; у статьи можно указать платёж с датой — он появится в календаре.`));
  } else {
    const list = el('div', { class: 'list', style: 'margin:0 0 10px' });
    let planSum = 0;
    for (const a of articles) {
      const plan = await articlePlanEur(a.id, month, ctx);
      planSum += plan ?? 0;
      const f = facts.get(a.id) ?? 0;
      list.append(el('a', { class: 'row', href: `#/budget/${month}/${a.id}` },
        avatar(a.name, { small: true }),
        el('div', { class: 'row-main' }, el('div', null, a.name), el('div', { class: 'muted small' }, plan != null ? `план ${money(plan)}` : 'план не задан')),
        el('div', { class: 'row-amount' }, el('div', null, money(f)), el('div', { class: 'muted small' }, 'факт')),
      ));
    }
    card.append(list, el('p', { class: 'small', style: 'margin:0 0 10px' }, `Планы статей: ${money(planSum)}`));
  }
  card.append(el('button', { class: 'btn btn-secondary', type: 'button', style: 'width:100%', onclick: async () => {
    const name = await promptDialog(`Новая статья в «${category.name}»`, '');
    if (!name?.trim()) return;
    try {
      const a = await createArticle(category.id, name);
      toast(`Статья «${a.name}» добавлена`);
      location.hash = `#/budget/${month}/${a.id}`;
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Ошибка', { error: true });
    }
  } }, '+ Статья'));
  return card;
}

/**
 * Платежи статьи с датой: регулярные (раз в месяц, раз в год) и разовые —
 * с состоянием и «Отметить оплату».
 * @param {import('../repo/categories.js').Category} article
 * @param {string} month
 */
async function articlePaymentsCard(article, month) {
  const today = todayISO();
  const { from, to } = monthRange(month);
  const schedules = (await listSchedules()).filter((s) => s.categoryId === article.id);
  const oneOff = (await listPlanned({ from, to, includeDone: true, type: 'expense' })).filter((p) => p.categoryId === article.id && !p.recurringId);
  const card = el('div', { class: 'card' }, el('div', { class: 'card-title' }, 'Платежи с датой'));
  if (!schedules.length && !oneOff.length) {
    card.append(el('p', { class: 'muted small', style: 'margin:0 0 10px' }, 'Если у статьи есть срок оплаты (например, страховка раз в год 15 марта) — добавьте платёж: он появится в календаре, войдёт в план, и в срок его можно будет отметить оплаченным.'));
  }
  const list = el('div', { class: 'list', style: 'margin:0 0 10px' });
  for (const s of schedules) {
    const status = s.confirm ? await loanStatus(s) : { text: 'записывается в расходы автоматически в день платежа', late: false, canPay: false };
    list.append(el('div', { class: 'row' },
      el('a', { class: 'row-main', href: `#/payments/${s.id}`, style: 'color:inherit;text-decoration:none' },
        el('div', null, s.name),
        el('div', { class: 'muted small' }, `${PERIOD_LABEL[s.period]} · с ${formatDate(s.startDate)}`),
        status.text ? el('div', { class: `small ${status.late ? 'warn' : ''}` }, status.text) : null,
      ),
      el('div', { class: 'row-amount expense' },
        el('div', null, formatWhole(-s.amount, s.currency)),
        status.canPay ? el('a', { class: 'btn btn-small expected-btn', href: `#/operations/new?loan=${s.id}` }, 'Отметить оплату') : null,
      ),
    ));
  }
  for (const p of oneOff) {
    const text = p.done
      ? `оплачено${p.receivedDate ? ` ${formatDate(p.receivedDate)}` : ''}`
      : p.date < today ? `просрочен — срок ${formatDate(p.date)}` : `ожидает оплаты — срок ${formatDate(p.date)}`;
    list.append(el('div', { class: 'row' },
      el('a', { class: 'row-main', href: `#/planned/${p.id}`, style: 'color:inherit;text-decoration:none' },
        el('div', null, p.name),
        el('div', { class: `small ${!p.done && p.date < today ? 'warn' : 'muted'}` }, `разовый · ${text}`),
      ),
      el('div', { class: 'row-amount expense' },
        el('div', null, formatWhole(-p.amount, p.currency)),
        p.done ? null : el('a', { class: 'btn btn-small expected-btn', href: `#/operations/new?planned=${p.id}` }, 'Отметить оплату'),
      ),
    ));
  }
  if (schedules.length || oneOff.length) card.append(list);
  const name = encodeURIComponent(article.name);
  card.append(
    el('a', { class: 'btn btn-secondary', style: 'width:100%;margin-bottom:8px', href: `#/payments/new?category=${article.id}&confirm=1&name=${name}` }, '+ Регулярный платёж (каждый месяц / год)'),
    el('a', { class: 'btn btn-secondary', style: 'width:100%', href: `#/planned/new?type=expense&category=${article.id}&month=${month}&name=${name}&from=article` }, '+ Разовый платёж'),
  );
  return card;
}

/**
 * Переименовать статью или убрать её в архив.
 * @param {import('../repo/categories.js').Category} article
 * @param {string} month
 */
function articleActions(article, month) {
  return el('div', { class: 'btn-row', style: 'margin-top:8px' },
    el('button', { class: 'btn btn-secondary', type: 'button', onclick: async () => {
      const next = await promptDialog('Новое название статьи', article.name);
      if (next == null || next.trim() === article.name) return;
      try {
        await renameCategory(article.id, next);
        toast('Статья переименована');
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Ошибка', { error: true });
      }
    } }, 'Переименовать статью'),
    el('button', { class: 'btn btn-danger', type: 'button', onclick: async () => {
      if (!(await confirmDialog(`Убрать статью «${article.name}» в архив? Записанные расходы останутся в категории; вернуть можно в «Ещё → Категории».`, 'В архив'))) return;
      await setCategoryArchived(article.id, true);
      toast('Статья перенесена в архив');
      navigate(`/budget/${month}/${article.parentId}`);
    } }, 'В архив'),
  );
}
