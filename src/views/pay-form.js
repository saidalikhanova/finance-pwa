// Одна форма для всего, что привязано к дате: платёж или поступление,
// один раз или по графику (каждый месяц / год / неделю / свой период),
// в том числе кредит (банк и сумма кредита). Заменяет три прежние формы.

import { el, toast, confirmDialog, promptDialog, formatMonth, formatDate } from '../ui.js';
import { parseAmount, amountToInput } from '../money.js';
import { navigate, goBack } from '../router.js';
import { listCategories } from '../repo/categories.js';
import { createSchedule, updateSchedule, getSchedule, deleteSchedule } from '../repo/recurring.js';
import { createPlanned, updatePlanned, getPlanned, deletePlanned, moveToNextMonth } from '../repo/planned.js';
import { listBanks, addBank } from '../repo/banks.js';
import { ensureLoanCategory } from '../repo/loans.js';
import { isLoanCategory, loanName, loanPurpose } from '../loans.js';
import { todayISO } from '../repo/operations.js';
import { nextOccurrence } from '../recurring.js';
import { addDays } from '../dates.js';
import { payStatus, markLabel } from '../pay-status.js';
import { field, segmented, categorySelectFor, categoryLabel } from './form-parts.js';
import { loanStatus, historyDetails } from './pay-ui.js';

const ADD_BANK = '__add__';
/** @type {[string, string][]} */
const KINDS = [['once', 'Один раз'], ['monthly', 'Каждый месяц'], ['yearly', 'Каждый год'], ['weekly', 'Каждую неделю'], ['custom', 'Свой период']];

/**
 * @param {HTMLElement} root
 * @param {Record<string, string>} params
 *   store — 'schedule' | 'planned' (для существующей записи); id;
 *   type, category, name, month, from, confirm, kind, loan=1 — для новой
 */
export async function renderPayForm(root, params) {
  const today = todayISO();
  const schedule = params.store === 'schedule' && params.id ? await getSchedule(params.id) : null;
  const planned = params.store === 'planned' && params.id ? await getPlanned(params.id) : null;
  if (params.id && !schedule && !planned) {
    root.append(el('p', { class: 'muted' }, 'Запись не найдена.'));
    return;
  }
  const existing = schedule ?? planned;
  const categories = await listCategories({ includeArchived: true });
  const loanCategoryIds = new Set(categories.filter(isLoanCategory).map((c) => c.id));
  const title = document.getElementById('page-title');
  if (title) title.textContent = existing ? existing.name : params.loan === '1' ? 'Новый кредит' : 'Новый платёж';

  // Откуда пришли — туда и вернёмся (бюджет, статья, источник); иначе — в «Платежи»
  const leave = () => (params.from || params.category || params.month ? goBack() : navigate('/payments'));

  // ---- Состояние уже заведённого платежа
  if (schedule) {
    const st = schedule.confirm ? await loanStatus(schedule) : null;
    const next = schedule.status === 'active' ? nextOccurrence(schedule, addDays(today, -1)) : null;
    const text = st ? st.text : next ? `следующий ${formatDate(next.date)} · запишется сам` : schedule.status === 'paused' ? 'приостановлен' : 'завершён';
    const card = el('div', { class: `card status-card ${st?.late ? 'status-overdue' : 'status-expected'}` }, el('strong', null, text));
    if (st?.canPay) card.append(el('a', { class: 'btn btn-small', style: 'margin-top:10px', href: `#/operations/new?loan=${schedule.id}` }, markLabel(schedule.type)));
    if (schedule.confirm) card.append(await historyDetails(schedule));
    root.append(card);
  }
  if (planned) {
    const st = payStatus({ date: planned.dateKind === 'day' ? planned.date : null, type: planned.type, done: planned.done, doneDate: planned.receivedDate }, today);
    const cls = st.kind === 'done' ? 'status-received' : st.kind === 'overdue' ? 'status-overdue' : 'status-expected';
    const card = el('div', { class: `card status-card ${cls}` },
      el('strong', null, st.kind === 'upcoming' && planned.dateKind === 'month' ? `в течение ${formatMonth(planned.date.slice(0, 7)).toLowerCase()}` : st.text),
      planned.movedFrom ? el('div', { class: 'muted small' }, `Перенесено с ${formatMonth(planned.movedFrom).toLowerCase()}`) : null,
    );
    if (!planned.done) {
      card.append(el('div', { class: 'btn-row', style: 'margin:10px 0 0' },
        el('a', { class: 'btn btn-small', href: `#/operations/new?planned=${planned.id}` }, markLabel(planned.type)),
        el('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: async () => {
          await moveToNextMonth(planned.id);
          toast('Перенесено на следующий месяц');
          leave();
        } }, 'На след. месяц'),
      ));
    }
    root.append(card);
  }

  // ---- Поля
  const isNewLoan = params.loan === '1';
  const initialType = existing?.type ?? (params.type === 'income' ? 'income' : 'expense');
  const nameInput = /** @type {HTMLInputElement} */ (el('input', { class: 'input', value: existing?.name ?? params.name ?? '', placeholder: 'Страховка, аренда, зарплата, кредит…', maxlength: 80 }));
  let type = initialType;
  const typeToggle = segmented([['expense', 'Расход'], ['income', 'Поступление']], type, (v) => {
    type = /** @type {'expense' | 'income'} */ (v);
    categorySelect.fill(type);
    categoryLabelEl.textContent = categoryLabel(type);
    renderLoan();
    renderConfirm();
  });
  const amountInput = /** @type {HTMLInputElement} */ (el('input', { class: 'input input-amount', inputmode: 'decimal', autocomplete: 'off', placeholder: '0', value: existing ? amountToInput(existing.amount).replace(/,00$/, '') : '' }));
  let currency = existing?.currency ?? 'KZT';
  const principalUnit = el('span', { class: 'muted' }, currency === 'KZT' ? '₸' : '€');
  const currencyToggle = segmented([['KZT', '₸'], ['EUR', '€']], currency, (v) => {
    currency = /** @type {'EUR' | 'KZT'} */ (v);
    principalUnit.textContent = currency === 'KZT' ? '₸' : '€';
  });

  const initialCategory = existing?.categoryId ?? params.category ?? (isNewLoan ? await ensureLoanCategory() : null);
  const categorySelect = categorySelectFor(categories, initialCategory);
  categorySelect.fill(type);
  const categoryLabelEl = el('span', { class: 'field-label' }, categoryLabel(type));
  categorySelect.el.addEventListener('change', renderLoan);

  // Кредит: банк и сумма кредита — при категории «Кредиты»
  const bankSelect = /** @type {HTMLSelectElement} */ (el('select', { class: 'select' }));
  async function fillBanks(/** @type {string | null | undefined} */ selected) {
    const banks = await listBanks();
    if (selected && !banks.includes(selected)) banks.unshift(selected);
    bankSelect.replaceChildren(
      el('option', { value: '', disabled: true }, banks.length ? 'Выберите банк' : 'Банков пока нет — добавьте'),
      ...banks.map((b) => el('option', { value: b }, b)),
      el('option', { value: ADD_BANK }, '+ Добавить банк…'),
    );
    bankSelect.value = selected ?? '';
  }
  await fillBanks(schedule?.bank ?? params.bank);
  let lastBank = bankSelect.value;
  bankSelect.addEventListener('change', async () => {
    if (bankSelect.value !== ADD_BANK) {
      lastBank = bankSelect.value;
      return;
    }
    const b = await promptDialog('Название банка', '');
    if (!b?.trim()) {
      bankSelect.value = lastBank;
      return;
    }
    try {
      lastBank = await addBank(b);
      await fillBanks(lastBank);
      renderLoan();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Ошибка', { error: true });
      bankSelect.value = lastBank;
    }
  });
  const purposeInput = /** @type {HTMLInputElement} */ (el('input', { class: 'input', value: schedule ? loanPurpose(schedule) : '', placeholder: 'ипотека, авто, потребительский', maxlength: 60 }));
  const principalInput = /** @type {HTMLInputElement} */ (el('input', { class: 'input input-amount', inputmode: 'decimal', autocomplete: 'off', placeholder: '0', value: schedule?.principal ? amountToInput(schedule.principal).replace(/,00$/, '') : '' }));
  const loanBox = el('div', null,
    field('Банк', bankSelect, el('p', { class: 'muted small' }, 'Список банков — «Ещё» → «Банки».')),
    field('Что за кредит (необязательно)', purposeInput),
    field('Сумма кредита (основной долг), необязательно', el('div', { class: 'amount-row' }, principalInput, principalUnit)),
  );
  function isLoan() {
    return type === 'expense' && loanCategoryIds.has(categorySelect.el.value);
  }
  function renderLoan() {
    loanBox.hidden = !isLoan();
    if (isLoan() && !nameInput.value.trim() && bankSelect.value && bankSelect.value !== ADD_BANK) nameInput.value = loanName(bankSelect.value, purposeInput.value);
  }

  // Когда
  /** @type {string} */
  // Существующий — как заведён; новый — по графику (каждый месяц), если не попросили разовый
  let kind = schedule ? schedule.period : planned ? 'once' : params.kind ?? 'monthly';
  // Пять вариантов — списком, кнопками не помещаются на телефоне
  const kindSelect = /** @type {HTMLSelectElement} */ (el('select', { class: 'select', onchange: () => {
    kind = kindSelect.value;
    renderWhen();
    renderConfirm();
  } }, ...KINDS.map(([v, l]) => el('option', { value: v }, l))));
  kindSelect.value = kind;
  // Один раз: точная дата или только месяц
  let dateKind = planned?.dateKind ?? (params.month || initialType === 'income' ? 'month' : 'day');
  const dateInput = /** @type {HTMLInputElement} */ (el('input', { class: 'input', type: 'date', value: planned?.dateKind === 'day' ? planned.date : params.month && params.month !== today.slice(0, 7) ? `${params.month}-01` : today }));
  const monthInput = /** @type {HTMLInputElement} */ (el('input', { class: 'input', type: 'month', value: planned?.date.slice(0, 7) ?? params.month ?? today.slice(0, 7) }));
  const dateKindToggle = segmented([['day', 'Точная дата'], ['month', 'Только месяц']], dateKind, (v) => {
    dateKind = v;
    renderWhen();
  });
  const dateField = field('Дата', dateInput);
  const monthField = field('Месяц', monthInput, el('p', { class: 'muted small' }, 'Если точный день неизвестен. После конца месяца — «просрочено».'));
  // По графику
  const startInput = /** @type {HTMLInputElement} */ (el('input', { class: 'input', type: 'date', value: schedule?.startDate ?? today }));
  const intervalInput = /** @type {HTMLInputElement} */ (el('input', { class: 'input', type: 'number', min: 1, step: 1, inputmode: 'numeric', value: schedule?.intervalDays || 30 }));
  const intervalField = field('Интервал, дней', intervalInput);
  let endType = schedule?.endType ?? 'none';
  const endToggle = segmented([['none', 'Бессрочно'], ['date', 'До даты'], ['count', 'Число платежей']], endType, (v) => {
    endType = v;
    renderWhen();
  });
  const endDateInput = /** @type {HTMLInputElement} */ (el('input', { class: 'input', type: 'date', value: schedule?.endDate ?? '' }));
  const countInput = /** @type {HTMLInputElement} */ (el('input', { class: 'input', type: 'number', min: 1, step: 1, inputmode: 'numeric', value: schedule?.count ?? '' }));
  const endDateField = field('Дата последнего платежа', endDateInput);
  const countField = field('Сколько платежей осталось (включая ближайший)', countInput);
  const onceBox = el('div', null, el('div', { class: 'field' }, dateKindToggle), dateField, monthField);
  const repeatBox = el('div', null,
    field(schedule ? 'Дата платежа (её число — день платежа)' : 'Дата ближайшего платежа', startInput, el('p', { class: 'muted small' }, 'Число этой даты — день платежа каждый период.')),
    intervalField,
    field('Когда закончится', endToggle),
    endDateField,
    countField,
  );
  function renderWhen() {
    onceBox.hidden = kind !== 'once';
    repeatBox.hidden = kind === 'once';
    dateField.hidden = dateKind !== 'day';
    monthField.hidden = dateKind !== 'month';
    intervalField.hidden = kind !== 'custom';
    endDateField.hidden = endType !== 'date';
    countField.hidden = endType !== 'count';
  }

  // Ждать подтверждения — только по графику (разовый всегда ждёт отметки)
  const confirmBox = /** @type {HTMLInputElement} */ (el('input', { type: 'checkbox', checked: schedule ? Boolean(schedule.confirm) : params.confirm !== '0' }));
  const confirmHint = el('div', { class: 'muted small' });
  const confirmField = el('label', { class: 'cat-row field' }, confirmBox, el('span', { class: 'cat-name' }, 'Ждать отметки', confirmHint));
  function renderConfirm() {
    confirmField.hidden = kind === 'once';
    confirmHint.textContent = type === 'income'
      ? 'В срок появится как «ожидается»; в факт попадёт, когда нажмёте «Получил(а)». Снимите, если деньги приходят точно в срок и их можно записывать автоматически.'
      : 'В срок появится в «Платежах» и будет ждать «Оплатил(а)» — с фактической датой и суммой. Снимите, если платёж списывается сам и его можно записывать автоматически.';
  }
  renderLoan();
  renderWhen();
  renderConfirm();

  const form = el('form', { class: 'form', novalidate: true, onsubmit: save },
    field('Что', nameInput),
    field('Тип', typeToggle),
    field('Сумма', el('div', { class: 'amount-row' }, amountInput, currencyToggle)),
    el('label', { class: 'field' }, categoryLabelEl, categorySelect.el),
    loanBox,
    field('Когда', kindSelect),
    onceBox,
    repeatBox,
    confirmField,
    el('div', { class: 'form-actions' }, el('button', { class: 'btn', type: 'submit' }, 'Сохранить')),
    existing ? el('button', { class: 'btn btn-danger', type: 'button', onclick: remove }, 'Удалить') : null,
  );
  root.append(form);
  if (!existing && !nameInput.value) nameInput.focus();

  /** @param {Event} e */
  async function save(e) {
    e.preventDefault();
    const amount = parseAmount(amountInput.value);
    if (amount == null) return toast('Введите сумму, например 45000', { error: true });
    if (!categorySelect.el.value) return toast(type === 'income' ? 'Выберите источник' : 'Выберите категорию', { error: true });
    const loan = isLoan();
    const bank = loan ? bankSelect.value : '';
    if (loan && (!bank || bank === ADD_BANK)) return toast('Выберите банк', { error: true });
    const principalText = principalInput.value.trim();
    const principal = loan && principalText ? parseAmount(principalText) : null;
    if (loan && principalText && principal == null) return toast('Сумма кредита: введите число', { error: true });
    const name = nameInput.value.trim() || (loan ? loanName(bank, purposeInput.value) : '');
    if (!name) return toast('Укажите, что это за платёж', { error: true });
    const cur = /** @type {'EUR' | 'KZT'} */ (currency);
    try {
      if (kind === 'once') {
        const data = { name, type, amount, currency: cur, categoryId: categorySelect.el.value, dateKind: /** @type {'day' | 'month'} */ (dateKind), date: dateKind === 'month' ? monthInput.value : dateInput.value };
        if (planned) await updatePlanned(planned.id, data);
        else {
          await createPlanned(data);
          if (schedule) await deleteSchedule(schedule.id); // был по графику — стал разовым
        }
      } else {
        const data = {
          name: loan ? loanName(bank, purposeInput.value) : name,
          type, amount, currency: cur, categoryId: categorySelect.el.value,
          period: /** @type {any} */ (kind), intervalDays: Number(intervalInput.value), startDate: startInput.value,
          endType: /** @type {any} */ (endType), endDate: endDateInput.value || null, count: Number(countInput.value),
          confirm: confirmBox.checked, bank: bank || null, principal,
        };
        if (schedule) await updateSchedule(schedule.id, data);
        else {
          if (planned?.done) return toast('Отмеченный платёж нельзя сделать повторяющимся — заведите новый', { error: true });
          await createSchedule(data);
          if (planned) await deletePlanned(planned.id); // был разовым — стал по графику
        }
      }
      toast(existing ? 'Сохранено' : kind === 'once' ? 'Платёж добавлен — он в «Платежах» и календаре' : 'Добавлен — каждый период появится в «Платежах» и календаре');
      leave();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Не удалось сохранить', { error: true });
    }
  }

  async function remove() {
    if (!existing) return;
    const note = schedule ? 'Уже записанные оплаты останутся.' : planned?.done ? 'Записанная операция останется.' : '';
    if (!(await confirmDialog(`Удалить «${existing.name}»? ${note}`.trim(), 'Удалить'))) return;
    if (schedule) await deleteSchedule(schedule.id);
    else if (planned) await deletePlanned(planned.id);
    toast('Удалено');
    leave();
  }
}
