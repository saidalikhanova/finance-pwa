// Категории в два уровня: категория («Здоровье») и статьи внутри неё
// («Страховка Freedom», «Аптека»). Статья — та же категория с parentId.
// Чистые функции.

/** @typedef {import('./repo/categories.js').Category} Category */

/** @param {Pick<Category, 'parentId'>} c */
export function isTop(c) {
  return !c.parentId;
}

/**
 * Статьи категории (без архивных, если не попросили).
 * @param {Category[]} all
 * @param {string} id
 * @param {{ includeArchived?: boolean }} [opts]
 */
export function childrenOf(all, id, opts = {}) {
  return all.filter((c) => c.parentId === id && (opts.includeArchived || !c.archived)).sort(byOrder);
}

/**
 * Категория и все её статьи — для фильтров и сумм.
 * @param {Category[]} all
 * @param {string} id
 */
export function withChildren(all, id) {
  return [id, ...all.filter((c) => c.parentId === id).map((c) => c.id)];
}

/**
 * Название с категорией: «Здоровье › Аптека».
 * @param {Category | undefined} c
 * @param {Map<string, Category>} byId
 */
export function fullName(c, byId) {
  if (!c) return 'Без категории';
  const parent = c.parentId ? byId.get(c.parentId) : null;
  return parent ? `${parent.name} › ${c.name}` : c.name;
}

/**
 * Категории по порядку: каждая — со своими статьями сразу после неё.
 * @param {Category[]} all
 * @param {{ kind?: string, includeArchived?: boolean, keep?: string | null }} [opts] — keep: показать, даже если в архиве
 * @returns {{ c: Category, depth: 0 | 1 }[]}
 */
export function ordered(all, opts = {}) {
  const visible = (/** @type {Category} */ c) => (opts.includeArchived || !c.archived || c.id === opts.keep) && (!opts.kind || c.kind === opts.kind);
  /** @type {{ c: Category, depth: 0 | 1 }[]} */
  const out = [];
  for (const top of all.filter((c) => isTop(c) && visible(c)).sort(byOrder)) {
    out.push({ c: top, depth: 0 });
    for (const ch of all.filter((c) => c.parentId === top.id && visible(c)).sort(byOrder)) out.push({ c: ch, depth: 1 });
  }
  // Статьи, чья категория скрыта (например, в архиве), — отдельно в конце
  const shown = new Set(out.map((x) => x.c.id));
  for (const c of all.filter((c) => !isTop(c) && visible(c) && !shown.has(c.id)).sort(byOrder)) out.push({ c, depth: 1 });
  return out;
}

/**
 * Суммы с учётом статей: у категории — своя сумма плюс суммы её статей.
 * У статей — как было.
 * @param {Map<string, number>} sums
 * @param {Category[]} all
 * @returns {Map<string, number>}
 */
export function rollup(sums, all) {
  const out = new Map(sums);
  for (const c of all) {
    if (!c.parentId) continue;
    const v = sums.get(c.id);
    if (v) out.set(c.parentId, (out.get(c.parentId) ?? 0) + v);
  }
  return out;
}

/**
 * Какие лимиты проверить после траты: сама статья (категория) и её категория.
 * @param {string[]} ids
 * @param {Category[]} all
 */
export function idsWithParents(ids, all) {
  const out = new Set(ids);
  for (const id of ids) {
    const p = all.find((c) => c.id === id)?.parentId;
    if (p) out.add(p);
  }
  return [...out];
}

/** @param {Category} a @param {Category} b */
function byOrder(a, b) {
  return a.order - b.order || a.name.localeCompare(b.name, 'ru');
}
