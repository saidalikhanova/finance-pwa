import { getDb } from '../db.js';
import { listCategories, createCategory, setCategoryArchived } from './categories.js';
import { listSchedules } from './recurring.js';
import { isLoanCategory, LOAN_CATEGORY } from '../loans.js';

/**
 * Категория «Кредиты»: находит (и возвращает из архива) или создаёт.
 * @param {IDBDatabase} [db]
 * @returns {Promise<string>}
 */
export async function ensureLoanCategory(db) {
  const d = db ?? (await getDb());
  const found = (await listCategories({ kind: 'expense', includeArchived: true }, d)).find(isLoanCategory);
  if (found) {
    if (found.archived) await setCategoryArchived(found.id, false, d);
    return found.id;
  }
  return (await createCategory(LOAN_CATEGORY, 'expense', d)).id;
}

/**
 * Кредиты — повторяющиеся платежи с банком.
 * @param {IDBDatabase} [db]
 */
export async function listLoans(db) {
  return (await listSchedules(db)).filter((s) => s.bank);
}
