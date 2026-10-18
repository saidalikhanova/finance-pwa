import { el, toast, confirmDialog } from '../ui.js';
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
import { navigate } from '../router.js';
import {
  createOperation,
  updateOperation,
  deleteOperation,
  getOperation,
  todayISO,
} from '../repo/operations.js';
import { listCategories } from '../repo/categories.js';

/**
 * Форма создания и редактирования операции.
 * @param {HTMLElement} root
 * @param {Record<string, string>} params — { id } или { id: 'new' }
 */
export async function renderOperationForm(root, params) {
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
  const preset = wish
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
  const hint = wish
    ? el('p', { class: 'muted small' }, `Покупка из списка желаний: «${wish.name}». Проверьте сумму и сохраните.`)
    : plannedPay
      ? el('p', { class: 'muted small' }, plannedPay.type === 'income'
          ? `Ожидаемый доход «${plannedPay.name}». Укажите, сколько и когда фактически пришло — это попадёт в факт.`
          : `Запланированный платёж «${plannedPay.name}». Проверьте сумму и дату.`)
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

  // Категория
  const categorySelect = el('select', { class: 'select', name: 'categoryId', required: true });
  function fillCategories() {
    const kind = typeInput.value;
    const current = existing?.categoryId ?? preset?.categoryId;
    categorySelect.innerHTML = '';
    categorySelect.append(el('option', { value: '', disabled: true, selected: true }, 'Выберите категорию'));
    for (const c of allCategories) {
      if (c.kind !== kind) continue;
      if (c.archived && c.id !== current) continue;
      categorySelect.append(el('option', { value: c.id }, c.archived ? `${c.name} (архив)` : c.name));
    }
    if (current && [...categorySelect.options].some((o) => o.value === current)) categorySelect.value = current;
  }
  fillCategories();

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
    categorySelect.disabled = has;
    if (has) {
      amountInput.value = amountToInput(editor.total());
      const first = editor.read()[0];
      if (first?.categoryId) categorySelect.value = first.categoryId;
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

  form.replaceChildren(
    field('Тип', typeToggle),
    field('Сумма', el('div', { class: 'amount-row' }, amountInput, currencyToggle), eurPreview),
    field('Дата', dateInput),
    rateField,
    field('Категория', categorySelect),
    itemsDetails,
    field('Магазин', storeInput),
    field('Комментарий', commentInput),
    photoField,
    el('div', { class: 'form-actions' }, el('button', { class: 'btn', type: 'submit' }, isNew ? 'Сохранить' : 'Сохранить изменения')),
    ...(existing ? [el('button', { class: 'btn btn-danger', type: 'button', onclick: onDelete }, 'Удалить операцию')] : []),
  );
  if (hint) form.prepend(hint);
  root.append(form);
  syncAmountWithItems();
  if (isNew) amountInput.focus();

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
      toast('Выберите категорию', { error: true });
      categorySelect.focus();
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
    };
    try {
      if (existing) {
        await updateOperation(existing.id, data);
      } else {
        const op = await createOperation(data);
        if (wish) await updateWish(wish.id, { status: 'bought', boughtAt: data.date, actualPrice: data.amount, operationId: op.id });
        if (plannedPay) await markReceived(plannedPay.id, { operationId: op.id, date: data.date, amount: data.amount });
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
        const spentBy = await sumByCategory(month);
        const messages = [];
        let over = false;
        for (const catId of catIds) {
          const line = await getBudgetLine(month, catId);
          if (line?.limit == null) continue;
          const category = allCategories.find((c) => c.id === catId);
          const status = limitStatus(line.limit, spentBy.get(catId) ?? 0, month, todayISO());
          messages.push(limitMessage(category?.name ?? 'Категория', status));
          if (status.level === 'over') over = true;
        }
        if (messages.length) {
          toast(messages.join('\n'), { ms: 6000 + 2000 * (messages.length - 1), error: over });
          navigate('/operations');
          return;
        }
      }
      toast(plannedPay?.type === 'income' ? 'Получено — записано в факт' : message);
      navigate(plannedPay?.type === 'income' ? '/budget' : '/operations');
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
