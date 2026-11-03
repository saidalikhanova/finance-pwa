import { el, toast, formatDate } from '../ui.js';
import { getSetting } from '../db.js';
import { todayISO } from '../repo/operations.js';
import { suggestRate } from '../repo/rates.js';
import { compressForReading, stitchImages, savePhoto } from '../photos.js';
import { KEY_SETTING, MAX_RECEIPT_PHOTOS, buildReceiptRequest, recognizeReceipt, totalMismatch } from '../receipt-ai.js';
import { formatMoney } from '../money.js';
import { navigate } from '../router.js';
import { listCategories } from '../repo/categories.js';
import { fullName } from '../category-tree.js';
import { listProducts } from '../repo/products.js';
import { parseChatImport, buildClaudePrompt } from '../chat-import.js';
import { applyImport } from '../repo/import.js';
import { itemsEditor } from './items-editor.js';
import { field } from './form-parts.js';
import { sourceChips, lastSource, rememberSource } from './source-chips.js';

/** Фото, выбранные кнопкой в «Операциях», ждут экрана чека. @type {File[] | null} */
let pendingFiles = null;

/** Открывает выбор фото: камера или галерея. @param {(files: File[]) => void} onPick */
function choosePhotos(onPick) {
  const input = /** @type {HTMLInputElement} */ (el('input', { type: 'file', accept: 'image/*', multiple: true }));
  input.onchange = () => {
    const files = [...(input.files ?? [])];
    if (files.length > MAX_RECEIPT_PHOTOS) toast(`Взяты первые ${MAX_RECEIPT_PHOTOS} снимка`);
    if (files.length) onPick(files.slice(0, MAX_RECEIPT_PHOTOS));
  };
  input.click();
}

/** Кнопка «Сфотографировать чек» в «Операциях». */
export function pickReceipt() {
  // Камеру можно открыть только сразу по нажатию, поэтому выбор — до чтения настроек
  choosePhotos((files) => {
    pendingFiles = files;
    navigate('/import');
  });
}

/** @param {File} file @returns {Promise<string>} */
async function toBase64(file) {
  const blob = await compressForReading(file);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** @param {HTMLElement} root */
export async function renderImport(root) {
  const categories = await listCategories({ includeArchived: true });

  const textarea = el('textarea', { class: 'input textarea', rows: 8, placeholder: 'Вставьте сюда JSON из чата' });
  const preview = el('div');

  const key = await getSetting(KEY_SETTING);
  const hasRate = Boolean(await suggestRate(todayISO()));
  const known = new Set((await listProducts()).map((pr) => pr.nameLower));
  const status = el('div');
  root.append(
    el('div', { class: 'card' },
      el('div', { class: 'card-title' }, 'Фото чека'),
      key
        ? el('div', null,
            el('p', { class: 'muted small', style: 'margin:0 0 8px' }, `Приложение прочитает чек и разложит покупки по категориям. Длинный чек можно снять частями, до ${MAX_RECEIPT_PHOTOS} снимков.`),
            el('button', { class: 'btn', type: 'button', style: 'width:100%', onclick: () => choosePhotos(recognize) }, 'Сфотографировать чек'))
        : el('div', null,
            el('p', { class: 'muted small', style: 'margin:0 0 8px' }, 'Чтобы приложение само читало чеки, нужен ключ Anthropic API. Он вставляется один раз в настройках.'),
            el('a', { class: 'btn', href: '#/settings', style: 'display:block;text-align:center' }, 'Вставить ключ')),
      status,
    ),
    el('details', { class: 'card', style: 'margin-top:12px' },
      el('summary', { class: 'muted' }, 'Другой способ: через чат с Claude'),
      el('p', { class: 'small', style: 'margin:8px 0' }, '1. Скопируйте инструкцию и вставьте её в чат с Claude вместе с фотографией чека. 2. Полученный JSON вставьте ниже.'),
      el('button', { class: 'btn btn-secondary', type: 'button', style: 'width:100%', onclick: copyPrompt }, 'Скопировать инструкцию для Claude'),
      field('JSON из чата', textarea),
      el('button', { class: 'btn', type: 'button', style: 'width:100%', onclick: () => parse(textarea.value) }, 'Разобрать'),
    ),
    preview,
  );

  if (pendingFiles) {
    const files = pendingFiles;
    pendingFiles = null;
    if (key) recognize(files);
    else toast('Сначала вставьте ключ', { error: true });
  }

  /** @param {File[]} files */
  async function recognize(files) {
    preview.innerHTML = '';
    status.replaceChildren(el('p', { class: 'small', style: 'margin:8px 0 0' }, 'Читаю чек, это занимает до минуты…'));
    try {
      const [images, products] = await Promise.all([Promise.all(files.map(toBase64)), listProducts()]);
      const text = await recognizeReceipt(key, buildReceiptRequest({ categories, products, today: todayISO() }, images));
      status.replaceChildren();
      parse(text, files);
    } catch (err) {
      status.replaceChildren(el('p', { class: 'over small', style: 'margin:8px 0 0' }, err instanceof Error ? err.message : 'Не удалось распознать чек'));
    }
  }

  async function copyPrompt() {
    const products = await listProducts();
    const byId = new Map(categories.map((c) => [c.id, c]));
    const text = buildClaudePrompt(categories, products, new Map(categories.map((c) => [c.id, fullName(c, byId)])));
    try {
      await navigator.clipboard.writeText(text);
      toast('Инструкция скопирована');
    } catch {
      const ta = el('textarea', { class: 'input textarea', rows: 10 }, text);
      preview.replaceChildren(el('p', { class: 'muted small' }, 'Скопируйте текст вручную:'), ta);
      ta.select();
    }
  }

  /** @param {string} text @param {File[]} [files] — снимки, если чек сфотографирован */
  function parse(text, files) {
    const { purchases, errors } = parseChatImport(text, categories);
    preview.innerHTML = '';
    if (errors.length) preview.append(el('div', { class: 'card' }, el('div', { class: 'over small' }, 'Замечания:'), ...errors.map((e) => el('div', { class: 'small' }, `• ${e}`))));
    if (!purchases.length) {
      if (!errors.length) preview.append(el('p', { class: 'muted' }, 'Покупок не найдено.'));
      return;
    }

    /** @type {{ p: import('../chat-import.js').ParsedPurchase, editor: ReturnType<typeof itemsEditor>, date: HTMLInputElement, store: HTMLInputElement }[]} */
    const blocks = [];
    for (const p of purchases) {
      const date = /** @type {HTMLInputElement} */ (el('input', { class: 'input input-sm', type: 'date', value: p.date }));
      const store = /** @type {HTMLInputElement} */ (el('input', { class: 'input', value: p.store, placeholder: 'Магазин' }));
      const editor = itemsEditor(
        p.items.map((it) => ({ productId: null, name: it.name, qty: it.qty, unit: it.unit, price: it.price, sum: it.sum, categoryId: it.categoryId, wasted: 0 })),
        { categories, currency: () => p.currency },
      );
      const unknown = p.items.filter((it) => !it.categoryId).map((it) => it.categoryName || '(пусто)');
      preview.append(
        el('div', { class: 'card' },
          el('div', { class: 'row-top' }, el('strong', null, `${formatDate(p.date)} · ${p.currency}`), el('span', null, formatMoney(editor.total(), p.currency))),
          p.currency === 'KZT' && !hasRate ? el('p', { class: 'warn small' }, 'Курса тенге пока нет: чек сохранится, но в итоги не войдёт. Введите курс в «Ещё → Курсы» на дату чека.') : null,
          mismatchNote(p, editor),
          newProductsNote(p, known),
          unknown.length ? el('p', { class: 'warn small' }, `Категории не найдены: ${[...new Set(unknown)].join(', ')} — выберите в позициях.`) : null,
          el('div', { class: 'item-line', style: 'margin:8px 0' }, date, store),
          editor.el,
        ),
      );
      blocks.push({ p, editor, date, store });
    }

    const addProducts = /** @type {HTMLInputElement} */ (el('input', { type: 'checkbox', checked: true }));
    // Чем оплачено — одно на все чеки этого импорта
    let getSource = () => '';
    const sourceHolder = el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Чем оплачено'));
    sourceChips({ value: lastSource() }).then((c) => {
      getSource = c.get;
      sourceHolder.append(c.el);
    });
    preview.append(
      sourceHolder,
      el('label', { class: 'cat-row' }, addProducts, el('span', null, 'Добавить новые продукты в справочник')),
      el('button', { class: 'btn', type: 'button', style: 'width:100%', onclick: confirm }, `Создать операции (${purchases.length})`),
    );

    async function confirm() {
      if (blocks.some((b) => b.date.value > todayISO())) {
        toast('Дата чека ещё не наступила. Проверьте дату', { error: true });
        return;
      }
      const photoId = files ? await savePhoto(await stitchImages(files)).catch(() => null) : null;
      const final = blocks.map((b) => ({
        ...b.p,
        photoId,
        date: b.date.value,
        store: b.store.value.trim(),
        items: b.editor.read().map((it) => ({ ...it, categoryName: '' })),
      }));
      try {
        const r = await applyImport(final, { addProducts: addProducts.checked, source: getSource() });
        rememberSource(getSource());
        toast(`Создано операций: ${r.operations}${r.newProducts ? `, новых продуктов: ${r.newProducts}` : ''}`);
        navigate('/operations');
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Не удалось создать операции', { error: true });
      }
    }
  }
}

/**
 * Предупреждение, если сумма позиций не сходится с итогом чека.
 * @param {import('../chat-import.js').ParsedPurchase} p
 * @param {ReturnType<typeof itemsEditor>} editor
 */
function mismatchNote(p, editor) {
  if (totalMismatch({ items: [{ sum: editor.total() }], total: p.total }) == null) return null;
  return el('p', { class: 'warn small' }, `Итог на чеке ${formatMoney(/** @type {number} */ (p.total), p.currency)}, а сумма позиций ${formatMoney(editor.total(), p.currency)}. Сверьте позиции с чеком.`);
}

/**
 * Какие товары будут добавлены в справочник: остальные там уже есть.
 * @param {import('../chat-import.js').ParsedPurchase} p
 * @param {Set<string>} known
 */
function newProductsNote(p, known) {
  const fresh = [...new Set(p.items.map((it) => it.name.trim()))].filter((n) => !known.has(n.toLowerCase()));
  return fresh.length ? el('p', { class: 'muted small' }, `Новые в справочнике: ${fresh.join(', ')}.`) : null;
}
