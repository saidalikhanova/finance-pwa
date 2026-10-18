import { el, toast, confirmDialog } from '../ui.js';
import { parseAmount, amountToInput } from '../money.js';
import { navigate } from '../router.js';
import { listCategories } from '../repo/categories.js';
import { createWish, updateWish, deleteWish, getWish, PRIORITY_LABEL, WISH_STATUS_LABEL } from '../repo/wishes.js';
import { compressImage, savePhoto, getPhoto, deletePhoto } from '../photos.js';
import { field, segmented, categorySelectFor } from './form-parts.js';

/**
 * Форма записи списка желаемых покупок.
 * @param {HTMLElement} root
 * @param {Record<string, string>} params
 */
export async function renderWishForm(root, params) {
  const existing = params.id ? await getWish(params.id) : null;
  if (params.id && !existing) {
    root.append(el('p', { class: 'muted' }, 'Запись не найдена.'));
    return;
  }
  const categories = await listCategories({ includeArchived: true });

  const nameInput = el('input', { class: 'input', value: existing?.name ?? '', placeholder: 'Что хочется купить', maxlength: 120 });

  // Фото
  /** @type {Blob | null} */
  let newPhoto = null;
  let removePhoto = false;
  const preview = el('div', { class: 'photo-preview' });
  const fileInput = el('input', { type: 'file', accept: 'image/*', hidden: true });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    try {
      newPhoto = await compressImage(f);
      removePhoto = false;
      showPreview(newPhoto);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Не удалось обработать фото', { error: true });
    }
    fileInput.value = '';
  });
  const photoButtons = el(
    'div',
    { class: 'btn-row' },
    el('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: () => fileInput.click() }, 'Выбрать фото'),
    el('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: () => { newPhoto = null; removePhoto = true; preview.innerHTML = ''; } }, 'Убрать'),
  );
  /** @param {Blob} blob */
  function showPreview(blob) {
    const img = el('img', { src: URL.createObjectURL(blob), alt: '' });
    img.addEventListener('load', () => URL.revokeObjectURL(img.src));
    preview.replaceChildren(img);
  }
  if (existing?.photoId) getPhoto(existing.photoId).then((b) => b && showPreview(b));

  const linkInput = el('input', { class: 'input', type: 'url', inputmode: 'url', value: existing?.link ?? '', placeholder: 'https://…' });
  const priceInput = el('input', { class: 'input input-amount', inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00', value: existing?.price != null ? amountToInput(existing.price) : '' });
  const currencyInput = el('input', { type: 'hidden', value: existing?.currency ?? 'EUR' });
  const currencyToggle = segmented([['EUR', '€'], ['KZT', '₸']], currencyInput.value, (v) => (currencyInput.value = v));
  const categorySelect = categorySelectFor(categories, existing?.categoryId);
  categorySelect.fill('expense');
  const priorityInput = el('input', { type: 'hidden', value: existing?.priority ?? 'medium' });
  const priorityToggle = segmented(Object.entries(PRIORITY_LABEL), priorityInput.value, (v) => (priorityInput.value = v));
  const commentInput = el('input', { class: 'input', value: existing?.comment ?? '', placeholder: 'Необязательно', maxlength: 200 });

  const form = el(
    'form',
    { class: 'form', novalidate: true, onsubmit: onSubmit },
    field('Название', nameInput),
    el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Фотография'), preview, photoButtons, fileInput),
    field('Ссылка', linkInput, existing?.link ? el('a', { class: 'small', href: existing.link, target: '_blank', rel: 'noopener' }, 'Открыть ссылку ↗') : null),
    field('Ориентировочная цена', el('div', { class: 'amount-row' }, priceInput, currencyToggle)),
    field('Категория', categorySelect.el),
    field('Приоритет', priorityToggle),
    field('Комментарий', commentInput),
  );
  if (existing) {
    const statusText = existing.status === 'planned' && existing.plannedMonth ? `${WISH_STATUS_LABEL.planned} (${existing.plannedMonth})` : WISH_STATUS_LABEL[existing.status];
    form.append(el('p', { class: 'muted small' }, `Статус: ${statusText}`));
  }
  form.append(el('div', { class: 'form-actions' }, el('button', { class: 'btn', type: 'submit' }, 'Сохранить')));
  if (existing && existing.status !== 'bought') {
    form.append(
      el('a', { class: 'btn btn-secondary', style: 'width:100%;margin-bottom:12px', href: `#/operations/new?wish=${existing.id}` }, 'Куплено — записать расход'),
    );
  }
  if (existing) {
    form.append(el('button', { class: 'btn btn-danger', type: 'button', onclick: onDelete }, 'Удалить запись'));
  }
  root.append(form);
  if (!existing) nameInput.focus();

  /** @param {Event} e */
  async function onSubmit(e) {
    e.preventDefault();
    let price = null;
    if (priceInput.value.trim()) {
      price = parseAmount(priceInput.value);
      if (price == null) {
        toast('Введите цену, например 49,90', { error: true });
        return;
      }
    }
    try {
      let photoId = existing?.photoId ?? null;
      if (removePhoto && photoId) {
        await deletePhoto(photoId);
        photoId = null;
      }
      if (newPhoto) {
        if (photoId) await deletePhoto(photoId);
        photoId = await savePhoto(newPhoto);
      }
      const data = {
        name: nameInput.value,
        link: linkInput.value,
        price,
        currency: /** @type {'EUR' | 'KZT'} */ (currencyInput.value),
        categoryId: categorySelect.el.value,
        priority: /** @type {any} */ (priorityInput.value),
        comment: commentInput.value,
        photoId,
      };
      if (existing) await updateWish(existing.id, data);
      else await createWish(data);
      toast('Сохранено');
      navigate('/wishes');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Не удалось сохранить', { error: true });
    }
  }

  async function onDelete() {
    if (!existing) return;
    if (!(await confirmDialog('Удалить запись вместе с фотографией?'))) return;
    await deleteWish(existing.id);
    toast('Запись удалена');
    navigate('/wishes');
  }
}
