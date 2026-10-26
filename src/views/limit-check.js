import { toast } from '../ui.js';
import { getBudgetLine } from '../repo/budgets.js';
import { sumByCategory } from '../repo/operations.js';
import { limitStatus, limitMessage } from '../limits.js';
import { rollup, idsWithParents, fullName } from '../category-tree.js';

/**
 * Сообщения по лимитам после траты: по самой статье (категории) и по её категории —
 * у категории расходы считаются вместе со статьями.
 * @param {string} month
 * @param {string[]} categoryIds — категории траты
 * @param {import('../repo/categories.js').Category[]} categories
 * @param {string} today
 * @returns {Promise<boolean>} — показано ли сообщение
 */
export async function showLimitMessages(month, categoryIds, categories, today) {
  const spent = rollup(await sumByCategory(month), categories);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const messages = [];
  let over = false;
  for (const id of idsWithParents(categoryIds, categories)) {
    const line = await getBudgetLine(month, id);
    if (line?.limit == null) continue;
    const s = limitStatus(line.limit, spent.get(id) ?? 0, month, today);
    messages.push(limitMessage(fullName(byId.get(id), byId), s));
    if (s.level === 'over') over = true;
  }
  if (!messages.length) return false;
  toast(messages.join('\n'), { ms: 6000 + 2000 * (messages.length - 1), error: over });
  return true;
}
