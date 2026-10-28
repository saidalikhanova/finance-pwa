import { el, toast, confirmDialog, formatDate } from '../ui.js';
import { parseAmount, amountToInput, formatMoney, parseRate, formatRate, toEurCents } from '../money.js';
import { suggestRate, saveRate } from '../repo/rates.js';
import { getBudgetLine } from '../repo/budgets.js';
import { sumByCategory } from '../repo/operations.js';
import { limitStatus, limitMessage } from '../limits.js';
import { getWish, updateWish } from '../repo/wishes.js';
import { itemsEditor } from './items-editor.js';
import { ensureProducts } from '../repo/products.js';
import { compressImage, savePhoto, getPhoto, deletePhoto } from '../photos.js';
import { getPlanned, markReceived } from '../repo/planned.js';
import { navigate, goBack } from '../router.js';
import { getSchedule } from '../repo/recurring.js';
import { loanDue, settleLoanPayment } from '../repo/loans.js';
import {
  createOperation,
  updateOperation,
  deleteOperation,
  getOperation,
  todayISO,
} from '../repo/operations.js';
import { listCategories } from '../repo/categories.js';
import { categoryLabel } from './form-parts.js';
import { categoryChips } from './category-chips.js';
import { fullName } from '../category-tree.js';
import { showLimitMessages } from './limit-check.js';

/**
 * Форма создания и редактирования операции.
 * @param {HTMLElement} root
 * @param {Record<string, string>} params — { id } или { id: 'new' }
 */
export async function renderOperationForm(root, params, opts = {}) {
  // compact — быстрый ввод на главной: только расход, сегодня, без «Подробнее»;
  // после сохранения форма очищается и вызывается opts.onSaved
  const compact = Boolean(opts.compact);
  // Адрес #/operations/new не содержит параметра id — это новая операция.
  const isNew = !params.id || params.id === 'new';
  const existing = isNew ? null : await getOperation(params.id);
  if (!isNew && !existing) {
    root.append(el('p', { class: 'muted' }, 'Операция не найдена.'));
    return;
  }

  const allCategories = await listCategories({ includeArchived: true });

  // Предзаполнение из списка желаемых покупок («Куплено») или разового платежа («Оплачено»).
  const wish = isNew && params.wish ? await getWish(params.wish) : null;
  const plannedPay = isNew && params.planned ? await getPlanned(params.planned) : null;
  // Оплата кредита: от конкретного кредита («Оплачено» в «Мои кредиты» или на экране кредита)
  const loan = isNew && params.loan ? await getSchedule(params.loan) : null;
  const loanDueInfo = loan ? await loanDue(loan) : null;
  const preset = loan
    ? { type: 'expense', amount: loan.amount, currency: loan.currency, categoryId: loan.categoryId, comment: loan.name, date: todayISO() }
    : wish
    ? { type: 'expense', amount: wish.price, currency: wish.currency, categoryId: wish.categoryId, comment: wish.name, date: null }
    : plannedPay
      ? {
          type: plannedPay.type,
          amount: plannedPay.amount,
          currency: plannedPay.currency,
          categoryId: plannedPay.categoryId,
          comment: plannedPay.name,
          // Пришло позже срока или срок «в течение месяца» — по умолчанию сегодня
          date: plannedPay.dateKind === 'month' || plannedPay.date < todayISO() ? todayISO() : plannedPay.date,
        }
      : isNew && (params.amount || params.category || params.date || params.type)
        ? { type: params.type === 'income' ? 'income' : 'expense', amount: Number(params.amount) || null, currency: params.currency === 'KZT' ? 'KZT' : 'EUR', categoryId: params.category ?? null, comment: '', date: params.date ?? null }
        : null;

  const form = el('form', { class: 'form', novalidate: true, onsubmit: onSubmit });
  const hint = loan
    ? el('div', { class: 'banner' },
        el('strong', null, loan.bank ? `Оплата кредита: ${loan.name}` : `Оплата: ${loan.name}`),
        el('div', { class: 'small' }, loanDueInfo ? `Платёж по графику ${formatDate(loanDueInfo.date)} — ${formatMoney(loan.amount, loan.currency)}. Ниже укажите, когда фактически заплатили (например, вчера), и сумму, если она отличалась.` : 'По графику платежей больше нет.'))
    : wish
    ? el('p', { class: 'muted small' }, `Покупка из списка желаний: «${wish.name}». Проверьте сумму и сохраните.`)
    : plannedPay
      ? el('p', { class: 'muted small' }, plannedPay.type === 'income'
          ? `Поступление «${plannedPay.name}». Укажите, сколько и когда фактически пришло — это попадёт в факт.`
          : `Платёж «${plannedPay.name}». Укажите, когда фактически заплатили, и сумму, если она отличалась.`)
      : null;

  // Тип
  const typeInput = el('input', { type: 'hidden', name: 'type', value: existing?.type ?? preset?.type ?? 'expense' });
  const typeToggle = segmented(
    [
      ['expense', 'Расход'],
      ['income', 'Доход'],
    ],
    typeInput.value,
    (v) => {
      typeInput.value = v;
      fillCategories();
      itemsDetails.hidden = v !== 'expense';
      if (compact) mainBox.hidden = true;
    },
  );

  // Сумма и валюта
  const amountInput = el('input', {
    class: 'input input-amount',
    name: 'amount',
    inputmode: 'decimal',
    autocomplete: 'off',
    placeholder: '0,00',
    value: existing ? amountToInput(existing.amount) : preset?.amount ? amountToInput(preset.amount) : '',
    required: true,
  });
  const currencyInput = el('input', { type: 'hidden', name: 'currency', value: existing?.currency ?? preset?.currency ?? 'EUR' });
  const currencyToggle = segmented(
    [
      ['EUR', '€'],
      ['KZT', '₸'],
    ],
    currencyInput.value,
    (v) => {
      currencyInput.value = v;
      updateRateField();
    },
  );

  // Дата
  const dateInput = el('input', {
    class: 'input',
    type: 'date',
    name: 'date',
    value: existing?.date ?? preset?.date ?? todayISO(),
    required: true,
    onchange: () => suggestRateForDate(),
  });

  // Курс (только для тенге). Вводится вручную; введённый курс запоминается
  // на дату и подставляется в следующие операции.
  const rateInput = el('input', {
    class: 'input',
    name: 'rate',
    inputmode: 'decimal',
    autocomplete: 'off',
    placeholder: 'например 508,95',
    value: existing?.rate ? formatRate(existing.rate) : '',
    oninput: () => {
      rateTouched = true;
      updateEurPreview();
    },
  });
  let rateTouched = Boolean(existing?.rate);
  const rateField = field('Курс, ₸ за 1 €', rateInput, el('p', { class: 'muted small' }, 'Если оставить пустым, операция сохранится со статусом «курс не определён».'));
  const eurPreview = el('p', { class: 'muted small' });
  amountInput.addEventListener('input', updateEurPreview);

  function updateRateField() {
    rateField.hidden = currencyInput.value !== 'KZT';
    if (!rateField.hidden && !rateTouched) suggestRateForDate();
    updateEurPreview();
  }

  async function suggestRateForDate() {
    if (currencyInput.value !== 'KZT' || rateTouched) return;
    const r = await suggestRate(dateInput.value);
    rateInput.value = r ? formatRate(r.rate) : '';
    updateEurPreview();
  }

  function updateEurPreview() {
    if (currencyInput.value !== 'KZT') {
      eurPreview.textContent = '';
      return;
    }
    const amount = parseAmount(amountInput.value);
    const rate = parseRate(rateInput.value);
    const eur = amount && rate ? toEurCents(amount, 'KZT', rate) : null;
    eurPreview.textContent = eur != null ? `≈ ${formatMoney(eur, 'EUR')}` : '';
  }
  updateRateField();

  // Категория → статья (у доходов — источник): кнопками, как в быстром вводе.
  // Выбранное значение хранится в скрытом поле.
  const categoryLabelEl = el('span', { class: 'field-label' });
  const categorySelect = /** @type {HTMLInputElement} */ (el('input', { type: 'hidden', name: 'categoryId', value: '' }));
  const categoryBox = el('div');
  /** @type {ReturnType<typeof categoryChips> | null} */
  let picker = null;
  function fillCategories() {
    const kind = /** @type {'expense' | 'income'} */ (typeInput.value);
    const current = categorySelect.value || existing?.categoryId || preset?.categoryId || '';
    categoryLabelEl.textContent = categoryLabel(kind);
    categorySelect.value = '';
    // Архивную категорию уже записанной операции показываем, чтобы её было видно
    const parentOfCurrent = allCategories.find((x) => x.id === current)?.parentId;
    const list = allCategories.map((c) => (c.archived && (c.id === current || c.id === parentOfCurrent) ? { ...c, archived: false } : c));
    picker = categoryChips({ categories: list, kind, onSelect: (c) => {
      categorySelect.value = c?.id ?? '';
      if (compact) mainBox.hidden = !c;
      if (compact && c) amountInput.focus();
    } });
    categoryBox.replaceChildren(picker.el);
    if (current && allCategories.some((c) => c.id === current && c.kind === kind)) picker.select(current);
  }

  // Комментарий и магазин
  const commentInput = el('input', { class: 'input', name: 'comment', value: existing?.comment ?? preset?.comment ?? '', placeholder: 'Необязательно', maxlength: 200 });
  const storeInput = el('input', { class: 'input', name: 'store', value: existing?.store ?? '', placeholder: 'Необязательно', maxlength: 80 });

  // Позиции покупки (чек). При наличии позиций сумма считается по ним.
  const editor = itemsEditor(existing?.items ?? [], {
    categories: allCategories,
    currency: () => /** @type {'EUR' | 'KZT'} */ (currencyInput.value),
    onChange: syncAmountWithItems,
  });
  const itemsDetails = el('details', { class: 'card list-card', open: Boolean(existing?.items?.length), hidden: typeInput.value !== 'expense' },
    el('summary', null, 'Позиции (чек)'),
    el('p', { class: 'muted small' }, 'Для покупки из нескольких продуктов с разными категориями. Лимиты и отчёты учитывают категорию каждой позиции.'),
    editor.el,
  );
  function syncAmountWithItems() {
    const has = editor.length > 0;
    amountInput.readOnly = has;
    categoryBox.style.pointerEvents = has ? 'none' : '';
    categoryBox.style.opacity = has ? '0.6' : '';
    if (has) {
      amountInput.value = amountToInput(editor.total());
      const first = editor.read()[0];
      if (first?.categoryId) picker?.select(first.categoryId);
      updateEurPreview();
    }
  }

  // Фото чека
  /** @type {Blob | null} */
  let newPhoto = null;
  let removePhoto = false;
  const photoPreview = el('div', { class: 'photo-preview' });
  const fileInput = el('input', { type: 'file', accept: 'image/*', hidden: true });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    try {
      newPhoto = await compressImage(f);
      removePhoto = false;
      showPhoto(newPhoto);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Не удалось обработать фото', { error: true });
    }
    fileInput.value = '';
  });
  /** @param {Blob} blob */
  function showPhoto(blob) {
    const img = el('img', { src: URL.createObjectURL(blob), alt: 'Фото чека' });
    img.addEventListener('load', () => URL.revokeObjectURL(img.src));
    photoPreview.replaceChildren(img);
  }
  if (existing?.photoId) getPhoto(existing.photoId).then((b) => b && showPhoto(b));
  const photoField = el('div', { class: 'field' },
    el('span', { class: 'field-label' }, 'Фото чека'),
    photoPreview,
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: () => fileInput.click() }, 'Снять или выбрать'),
      el('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: () => { newPhoto = null; removePhoto = true; photoPreview.innerHTML = ''; } }, 'Убрать'),
    ),
    fileInput,
  );

  // Два слоя: главное (сумма, валюта, категория, дата) и «Подробнее»
  const hasDetails = Boolean(existing?.comment || existing?.store || existing?.items?.length || existing?.photoId);
  const details = el('details', { class: 'card list-card', open: hasDetails },
    el('summary', null, 'Подробнее: магазин, комментарий, чек, фото'),
    field('Магазин', storeInput),
    field('Комментарий', commentInput),
    itemsDetails,
    photoField,
  );
  const dateField = field(loan || plannedPay?.recurringId ? 'Дата оплаты — когда фактически заплатили' : 'Дата', dateInput);
  // В быстром вводе сумма и кнопка появляются после выбора категории
  const mainBox = el('div', { hidden: compact }, ...[
    field('Сумма', el('div', { class: 'amount-row' }, amountInput, currencyToggle), eurPreview),
    rateField,
    compact ? null : dateField,
    compact ? null : details,
    el('div', { class: 'form-actions' }, el('button', { class: 'btn', type: 'submit' }, isNew ? 'Сохранить' : 'Сохранить изменения')),
    existing ? el('button', { class: 'btn btn-danger', type: 'button', onclick: onDelete }, 'Удалить операцию') : null,
  ].filter((n) => n != null));
  form.replaceChildren(...[
    compact || loan || plannedPay ? null : field('Тип', typeToggle),
    el('div', { class: 'field' }, categoryLabelEl, categoryBox),
    mainBox,
  ].filter((n) => n != null));
  if (hint) form.prepend(hint);
  root.append(form);
  fillCategories();
  syncAmountWithItems();
  if (isNew && !compact && categorySelect.value) amountInput.focus();

  /** @param {Event} e */
  async function onSubmit(e) {
    e.preventDefault();
    const items = editor.read();
    // Позиции без привязки к справочнику получают продукт (создаётся при необходимости).
    if (items.some((it) => !it.productId && it.name.trim() && it.categoryId)) {
      const map = await ensureProducts(items.filter((it) => !it.productId && it.name.trim() && it.categoryId).map((it) => ({ name: it.name, unit: it.unit, categoryId: it.categoryId })));
      for (const it of items) if (!it.productId) it.productId = map.get(it.name.trim().replace(/\s+/g, ' ').toLowerCase())?.id ?? null;
    }
    const amount = items.length ? editor.total() : parseAmount(amountInput.value);
    if (amount == null || amount <= 0) {
      toast(items.length ? 'Укажите суммы позиций' : 'Введите сумму, например 12,50', { error: true });
      if (!items.length) amountInput.focus();
      return;
    }
    if (items.some((it) => !it.categoryId)) {
      toast('У каждой позиции должна быть категория', { error: true });
      return;
    }
    if (!items.length && !categorySelect.value) {
      toast(typeInput.value === 'income' ? 'Выберите источник дохода' : 'Выберите категорию', { error: true });
      return;
    }
    const currency = /** @type {'EUR' | 'KZT'} */ (currencyInput.value);
    let rate = null;
    if (currency === 'KZT' && rateInput.value.trim()) {
      rate = parseRate(rateInput.value);
      if (rate == null) {
        toast('Введите курс, например 508,95', { error: true });
        rateInput.focus();
        return;
      }
    }
    let photoId = existing?.photoId ?? null;
    try {
      if (removePhoto && photoId) {
        await deletePhoto(photoId);
        photoId = null;
      }
      if (newPhoto) {
        if (photoId) await deletePhoto(photoId);
        photoId = await savePhoto(newPhoto);
      }
    } catch (err) {
      toast('Не удалось сохранить фото', { error: true });
      return;
    }
    const data = {
      type: /** @type {'expense' | 'income'} */ (typeInput.value),
      amount,
      currency,
      date: dateInput.value,
      categoryId: items.length ? items[0].categoryId : categorySelect.value,
      comment: commentInput.value,
      store: storeInput.value,
      items: typeInput.value === 'expense' ? items : [],
      photoId,
      rate,
      rateSource: rate ? /** @type {const} */ ('manual') : null,
      // Связь с кредитом (или другим платежом по расписанию)
      recurringId: loan?.id ?? plannedPay?.recurringId ?? existing?.recurringId ?? null,
      // Дата по графику — чтобы видеть, в срок ли оплачено
      scheduledDate: loanDueInfo?.date ?? (plannedPay?.recurringId ? plannedPay.date : null) ?? existing?.scheduledDate ?? null,
    };
    try {
      if (existing) {
        await updateOperation(existing.id, data);
      } else {
        const op = await createOperation(data);
        if (wish) await updateWish(wish.id, { status: 'bought', boughtAt: data.date, actualPrice: data.amount, operationId: op.id });
        if (plannedPay) await markReceived(plannedPay.id, { operationId: op.id, date: data.date, amount: data.amount });
        if (loan && loanDueInfo) {
          await settleLoanPayment(loan, loanDueInfo, { operationId: op.id, date: data.date, amount: data.amount });
          toast(`Оплата записана: ${loan.name}`);
          // Платёж в статье или кредит — вернуться туда, откуда пришли
          goBack();
          return;
        }
      }
      let message = existing ? 'Изменения сохранены' : 'Операция сохранена';
      if (rate) {
        // Запоминаем курс на дату и пересчитываем другие операции за эту дату без курса.
        const n = await saveRate(data.date, rate);
        if (n) message += `. Курс применён ещё к ${n} ${plural(n, 'операции', 'операциям', 'операциям')}`;
      }
      // Сообщение по лимиту категории (п. 4.3 ТЗ) — для расходов с заданным лимитом.
      // У покупки с позициями — по каждой затронутой категории с лимитом.
      if (data.type === 'expense') {
        const month = data.date.slice(0, 7);
        const catIds = [...new Set(items.length ? items.map((it) => it.categoryId) : [data.categoryId])];
        // Лимиты статьи и её категории (у категории — вместе со статьями)
        const shown = await showLimitMessages(month, catIds, allCategories, todayISO());
        if (compact) {
          if (!shown) toast(`Записано: ${fullName(allCategories.find((c) => c.id === data.categoryId), new Map(allCategories.map((c) => [c.id, c])))} — ${amountInput.value.trim()} ${currency === 'KZT' ? '₸' : '€'}`);
          amountInput.value = '';
          categorySelect.value = '';
          picker?.clear();
          mainBox.hidden = true;
          opts.onSaved?.();
          return;
        }
        if (shown) {
          navigate('/operations');
          return;
        }
      }
      if (plannedPay) {
        // Отметили из «Платежей», бюджета или статьи — возвращаемся туда же
        toast(plannedPay.type === 'income' ? 'Получено — записано в факт' : 'Оплачено — записано в расходы');
        goBack();
        return;
      }
      toast(message);
      navigate('/operations');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Не удалось сохранить', { error: true });
    }
  }

  async function onDelete() {
    if (!existing) return;
    if (!(await confirmDialog('Удалить операцию? Это действие нельзя отменить.'))) return;
    if (existing.photoId) await deletePhoto(existing.photoId);
    await deleteOperation(existing.id);
    toast('Операция удалена');
    navigate('/operations');
  }
}

/**
 * @param {string} label
 * @param {...(Node | null)} controls
 */
function field(label, ...controls) {
  return el('label', { class: 'field' }, el('span', { class: 'field-label' }, label), ...controls);
}

/**
 * Форма слова по числу: plural(3, 'операции', 'операциям', 'операциям').
 * @param {number} n
 * @param {string} one
 * @param {string} few
 * @param {string} many
 */
function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/**
 * Переключатель из нескольких кнопок.
 * @param {[string, string][]} options — [значение, подпись]
 * @param {string} value
 * @param {(v: string) => void} onChange
 */
function segmented(options, value, onChange) {
  const wrap = el('div', { class: 'segmented', role: 'group' });
  for (const [v, label] of options) {
    const b = el('button', { type: 'button', class: v === value ? 'active' : '', dataset: { value: v } }, label);
    b.addEventListener('click', () => {
      wrap.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      onChange(v);
    });
    wrap.append(b);
  }
  return wrap;
}
