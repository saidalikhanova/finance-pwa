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
import { loanLeft } from '../repo/loans.js';
import { loanStatus } from './pay-ui.js';
import { isLoanCategory, scheduledInMonth } from '../loans.js';
import { limitStatus } from '../limits.js';
import { monthPlans } from '../plan.js';
import { payStatus, markLabel } from '../pay-status.js';
import { money, loadDisplay } from '../display.js';
import { formatWhole } from '../money.js';

/**
 * План категории на месяц (он же лимит: полоса и предупреждения — от плана).
 * Суммы можно вводить в евро или тенге;
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
  if (title && isExpense) title.textContent = isArticle ? fullName(category, byId) : category.name;
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
  const plannedPreview = el('p', { class: 'muted small', style: 'margin:4px 0 0' });
  const plannedLabel = el('span', { class: 'field-label' });

  const toggle = segmented([['EUR', '€'], ['KZT', '₸']], currency, (v) => {
    const prev = currency;
    currency = /** @type {'EUR' | 'KZT'} */ (v);
    renderRate();
    // Переводим уже введённые значения в выбранную валюту, чтобы цифры не «прыгали»
    const rate = parseRateSafe();
    for (const input of [plannedInput]) {
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
    for (const [input, out] of [[plannedInput, plannedPreview]]) {
      const eur = eurOf(/** @type {HTMLInputElement} */ (input));
      out.textContent = currency === 'KZT' && typeof eur === 'number' ? `≈ ${formatMoney(eur, 'EUR')}` : currency === 'KZT' && eur == null && input.value.trim() ? 'укажите курс' : '';
    }
  }
  updatePreview();

  const loan = isLoanCategory(category);
  await loadDisplay();
  // Шапка: категория и месяц, факт, полоса от плана (у категории — вместе со статьями)
  const plans = await monthPlans(month, allCats);
  const planLimit = plans.limit(category);
  const header = el('div', { class: 'card' },
    el('div', { class: 'muted small' }, `${fullName(category, byId)} · ${formatMonth(month)}`),
    el('div', null, `${loan ? 'Оплачено за месяц' : 'Факт'}: ${money(fact)}${articles.length ? ' (вместе со статьями)' : ''}`),
  );
  if (planLimit != null) {
    const st = limitStatus(planLimit, fact, month, today);
    header.append(
      el('div', { class: `bar bar-${st.level}`, style: 'margin-top:8px' }, el('div', { class: 'bar-fill', style: `width:${Math.min(100, st.percent)}%` })),
      el('div', { class: `small ${st.level === 'ok' ? 'muted' : st.level === 'warn' ? 'warn' : 'over'}` }, `${st.percent} % из плана ${money(planLimit)}${st.remaining >= 0 ? ` · осталось ${money(st.remaining)}` : ` · превышение ${money(-st.remaining)}`}`),
    );
  }
  const form = el(
    'form',
    { class: 'form', novalidate: true, onsubmit: onSubmit },
    el('div', { class: 'row-top', style: 'margin-bottom:8px' }, el('div', { class: 'card-title', style: 'margin:0' }, 'План'), toggle),
    rateField,
    el('label', { class: 'field' }, plannedLabel, plannedInput, plannedPreview),
    el('p', { class: 'muted small' }, articles.length ? 'План категории = планы статей + этот план «прочее». При 80 % от плана и при превышении приложение предупредит.' : 'При 80 % от плана и при превышении приложение предупредит.'),
    el('div', { class: 'form-actions' }, el('button', { class: 'btn', type: 'submit' }, 'Сохранить')),
  );
  // Единый порядок для любой категории и статьи:
  // шапка → план → статьи → платежи с датой → операции → убрать / вернуть
  const payments = await paymentsCard(category, month, loan);
  const hasPayments = payments.dataset.count !== '0';
  const planBlock = loan
    ? el('div', { class: 'card' }, el('p', { class: 'muted small', style: 'margin:0' }, 'План по кредитам считается сам — по графику платежей.'))
    : el('div', { class: 'card' }, form);
  // Статьи и платежи — карточками, только если они есть; иначе одна строка с кнопками добавления
  const blocks = [];
  if (isExpense && !isArticle && !loan && articles.length) blocks.push(await articlesCard(category, articles, month, plans));
  if (hasPayments || loan) blocks.push(payments);
  if (!blocks.length || (!articles.length && !isArticle && !loan && !hasPayments)) {
    const links = [];
    if (!isArticle && !loan && !articles.length) links.push(el('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: addArticle(category, month) }, '+ Статья'));
    if (!hasPayments && !loan) links.push(el('a', { class: 'btn btn-secondary btn-small', href: `#/payments/new?category=${categoryId}&confirm=1&from=budget${isArticle ? `&name=${encodeURIComponent(category.name)}` : ''}` }, '+ Платёж с датой'));
    if (links.length) blocks.push(el('div', { class: 'btn-row' }, ...links));
  }
  const actions = el('details', { class: 'card list-card', style: 'margin-top:8px' }, el('summary', { class: 'muted' }, 'Ещё действия'),
    el('div', { style: 'padding:8px 0 4px' },
      line?.hidden
        ? el('button', { class: 'btn btn-secondary btn-small', type: 'button', style: 'width:100%;margin-bottom:8px', onclick: onRestore }, `Вернуть в бюджет: ${formatMonth(month).toLowerCase()}`)
        : el('button', { class: 'btn btn-secondary btn-small', type: 'button', style: 'width:100%;margin-bottom:8px', onclick: onRemove }, `Убрать из бюджета: ${formatMonth(month).toLowerCase()}`),
      ...(isArticle ? [articleActions(category, month)] : []),
    ),
  );
  root.append(
    header,
    planBlock,
    ...blocks,
    el('a', { class: 'btn btn-secondary', style: 'width:100%;margin-top:8px', href: `#/operations?month=${month}&category=${categoryId}` }, loan ? 'Все оплаты за месяц' : 'Операции за месяц'),
    actions,
  );

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
    if (planned === false) {
      toast('Введите сумму, например 200 или 150,50', { error: true });
      return;
    }
    try {
      // Старое поле «лимит» больше не вводится; сохранённое значение не трогаем
      await setBudgetLine(month, categoryId, { planned, limit: line?.limit ?? null });
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
 * «Статьи»: из чего состоит категория — план и факт каждой статьи, «+ Статья».
 * @param {import('../repo/categories.js').Category} category
 * @param {import('../repo/categories.js').Category[]} articles
 * @param {string} month
 * @param {import('../plan.js').MonthPlans} plans
 */
async function articlesCard(category, articles, month, plans) {
  await loadDisplay();
  const facts = await sumByCategory(month);
  const card = el('div', { class: 'card' }, el('div', { class: 'card-title' }, 'Статьи'));
  if (!articles.length) {
    card.append(el('p', { class: 'muted small', style: 'margin:0 0 10px' }, `Разбейте «${category.name}» на статьи — например, «Страховка Freedom», «Аптека». План категории сложится из планов статей; у статьи можно указать платёж с датой — он появится в календаре.`));
  } else {
    const list = el('div', { class: 'list', style: 'margin:0 0 10px' });
    let planSum = 0;
    for (const a of articles) {
      const plan = plans.own(a);
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
  card.append(el('button', { class: 'btn btn-secondary', type: 'button', style: 'width:100%', onclick: addArticle(category, month) }, '+ Статья'));
  return card;
}

/**
 * «Платежи с датой» категории или статьи: по графику (кредиты, страховки, подписки)
 * и разовые — с состоянием и «Оплатила». У «Кредитов» — банк, остаток, итоги.
 * @param {import('../repo/categories.js').Category} c
 * @param {string} month
 * @param {boolean} loan — категория «Кредиты»
 */
async function paymentsCard(c, month, loan) {
  const today = todayISO();
  const { from, to } = monthRange(month);
  const schedules = (await listSchedules()).filter((s) => s.categoryId === c.id);
  const oneOff = (await listPlanned({ from, to, includeDone: true, type: 'expense' })).filter((p) => p.categoryId === c.id && !p.recurringId);
  const card = el('div', { class: 'card' }, el('div', { class: 'card-title' }, loan ? 'Мои кредиты' : 'Платежи с датой'));
  card.dataset.count = String(schedules.length + oneOff.length);
  if (!schedules.length && !oneOff.length) {
    card.append(el('p', { class: 'muted small', style: 'margin:0 0 10px' }, loan
      ? 'Добавьте кредит: банк, платёж в месяц и день платежа — он появится в календаре каждый месяц до последнего платежа.'
      : 'Если есть срок оплаты (страховка раз в год, подписка каждый месяц) — добавьте платёж: он появится в «Платежах» и календаре, войдёт в план, и в срок его можно будет отметить.'));
  }
  const list = el('div', { class: 'list', style: 'margin:0 0 10px' });
  for (const s of schedules) {
    const status = s.confirm ? await loanStatus(s) : { text: 'записывается сам в день платежа', late: false, canPay: false };
    const href = loan ? `#/loans/${s.id}?month=${month}` : `#/payments/${s.id}?from=budget`;
    const subs = [];
    if (loan) {
      const left = await loanLeft(s);
      subs.push([`${Number(s.startDate.slice(8))} числа`, s.status === 'paused' ? 'на паузе' : s.status === 'finished' ? 'выплачен' : left ? `осталось платежей: ${left.count}` : 'срок не указан'].join(' · '));
      const money2 = [s.principal ? `кредит ${formatWhole(s.principal, s.currency)}` : null, left && left.count && s.status !== 'finished' ? `осталось выплатить ${formatWhole(left.amount, s.currency)}` : null].filter(Boolean).join(' · ');
      if (money2) subs.push(money2);
    } else {
      subs.push(`${PERIOD_LABEL[s.period]} · с ${formatDate(s.startDate)}`);
    }
    list.append(el('div', { class: 'row' },
      el('a', { href, style: 'display:contents' }, avatar(s.bank ?? s.name, { small: true })),
      el('a', { class: 'row-main', href, style: 'color:inherit;text-decoration:none' },
        el('div', null, s.name),
        ...subs.map((t) => el('div', { class: 'muted small' }, t)),
        status.text ? el('div', { class: `small ${status.late ? 'warn' : ''}` }, status.text) : null,
      ),
      el('div', { class: 'row-amount expense' },
        el('div', null, formatWhole(-s.amount, s.currency)),
        status.canPay ? el('a', { class: 'btn btn-small expected-btn', href: `#/operations/new?loan=${s.id}` }, markLabel('expense')) : null,
      ),
    ));
  }
  for (const p of oneOff) {
    const st = payStatus({ date: p.dateKind === 'day' ? p.date : null, type: 'expense', done: p.done, doneDate: p.receivedDate }, today);
    list.append(el('div', { class: 'row' },
      el('a', { href: `#/planned/${p.id}?from=budget`, style: 'display:contents' }, avatar(p.name, { small: true })),
      el('a', { class: 'row-main', href: `#/planned/${p.id}?from=budget`, style: 'color:inherit;text-decoration:none' },
        el('div', null, p.name),
        el('div', { class: `small ${st.kind === 'overdue' ? 'warn' : 'muted'}` }, `один раз · ${st.text}`),
      ),
      el('div', { class: 'row-amount expense' },
        el('div', null, formatWhole(-p.amount, p.currency)),
        p.done ? null : el('a', { class: 'btn btn-small expected-btn', href: `#/operations/new?planned=${p.id}` }, markLabel('expense')),
      ),
    ));
  }
  if (schedules.length || oneOff.length) card.append(list);
  // Итоги: по кредитам — суммы и остаток; у всех — платежи этого месяца
  if (loan && schedules.length > 1) {
    /** @type {Map<'EUR' | 'KZT', number>} */
    const principal = new Map();
    /** @type {Map<'EUR' | 'KZT', number>} */
    const left = new Map();
    for (const s of schedules) {
      if (s.principal) principal.set(s.currency, (principal.get(s.currency) ?? 0) + s.principal);
      const l = s.status === 'finished' ? null : await loanLeft(s);
      if (l?.amount) left.set(s.currency, (left.get(s.currency) ?? 0) + l.amount);
    }
    const fmt = (/** @type {Map<'EUR' | 'KZT', number>} */ m) => [...m].map(([cur, a]) => formatWhole(a, cur)).join(' + ');
    const parts = [principal.size ? `сумма кредитов ${fmt(principal)}` : null, left.size ? `осталось выплатить ${fmt(left)}` : null].filter(Boolean);
    if (parts.length) card.append(el('p', { class: 'small', style: 'margin:0 0 6px' }, `Всего: ${parts.join(' · ')}`));
  }
  /** @type {Map<string, number>} */
  const sums = new Map();
  for (const { s } of scheduledInMonth(schedules, c.id, month)) sums.set(s.currency, (sums.get(s.currency) ?? 0) + s.amount);
  for (const p of oneOff) if (!p.done) sums.set(p.currency, (sums.get(p.currency) ?? 0) + p.amount);
  if (sums.size) {
    const total = [...sums].map(([cur, a]) => formatWhole(a, /** @type {'EUR' | 'KZT'} */ (cur))).join(' + ');
    card.append(el('p', { class: 'small', style: 'margin:0 0 10px' }, `Платежей в ${formatMonth(month).toLowerCase().replace(/ь /, 'е ').replace(/й /, 'е ').replace(/т /, 'те ')}: ${total}`));
  }
  card.append(loan
    ? el('a', { class: 'btn btn-secondary', style: 'width:100%', href: `#/loans/new?month=${month}` }, '+ Кредит')
    : el('a', { class: 'btn btn-secondary', style: 'width:100%', href: `#/payments/new?category=${c.id}&confirm=1&from=budget${c.parentId ? `&name=${encodeURIComponent(c.name)}` : ''}` }, '+ Платёж с датой'));
  return card;
}

/**
 * Обработчик «+ Статья»: спрашивает название и открывает новую статью.
 * @param {import('../repo/categories.js').Category} category
 * @param {string} month
 */
function addArticle(category, month) {
  return async () => {
    const name = await promptDialog(`Новая статья в «${category.name}»`, '');
    if (!name?.trim()) return;
    try {
      const a = await createArticle(category.id, name);
      toast(`Статья «${a.name}» добавлена`);
      location.hash = `#/budget/${month}/${a.id}`;
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Ошибка', { error: true });
    }
  };
}

/**
 * Переименовать статью или убрать её в архив.
 * @param {import('../repo/categories.js').Category} article
 * @param {string} month
 */
function articleActions(article, month) {
  return el('div', { class: 'btn-row' },
    el('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: async () => {
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
    el('button', { class: 'btn btn-danger btn-small', type: 'button', onclick: async () => {
      if (!(await confirmDialog(`Убрать статью «${article.name}» в архив? Записанные расходы останутся в категории; вернуть можно в «Ещё → Категории».`, 'В архив'))) return;
      await setCategoryArchived(article.id, true);
      toast('Статья перенесена в архив');
      navigate(`/budget/${month}/${article.parentId}`);
    } }, 'В архив'),
  );
}
