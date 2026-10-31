import { test, assert } from './runner.js';
import { openDatabase, deleteDatabase } from '../src/db.js';
import { createCategory, createArticle, listCategories } from '../src/repo/categories.js';
import { setBudgetLine } from '../src/repo/budgets.js';
import { createSchedule } from '../src/repo/recurring.js';
import { createPlanned } from '../src/repo/planned.js';
import { ensureLoanCategory } from '../src/repo/loans.js';
import { monthPlans } from '../src/plan.js';

const DB = 'finance-test-plan';
async function fresh() {
  await deleteDatabase(DB);
  return openDatabase(DB);
}

test('план категории: вручную + статьи + платежи с датой; план служит лимитом', async () => {
  const db = await fresh();
  const health = await createCategory('Здоровье', 'expense', db);
  const ins = await createArticle(health.id, 'Страховка', db);
  const pharmacy = await createArticle(health.id, 'Аптека', db);
  const food = await createCategory('Продукты', 'expense', db);
  const salary = await createCategory('Зарплата', 'income', db);
  const loansId = await ensureLoanCategory(db);
  // «прочее» Здоровья — вручную; страховка — разовый платёж в месяце; аптека — по графику
  await setBudgetLine('2026-11', health.id, { planned: 10_00 }, db);
  await createPlanned({ name: 'Страховка', type: 'expense', amount: 120_00, currency: 'EUR', categoryId: ins.id, dateKind: 'day', date: '2026-11-05' }, db);
  await createSchedule({ name: 'Витамины', type: 'expense', amount: 20_00, currency: 'EUR', categoryId: pharmacy.id, period: 'monthly', startDate: '2026-01-10' }, db);
  // Старое поле «лимит» хранится, но на расчёт не влияет
  await setBudgetLine('2026-11', food.id, { planned: 300_00, limit: 500_00 }, db);
  await createSchedule({ name: 'Кредит Kaspi', bank: 'Kaspi', type: 'expense', amount: 100_00, currency: 'EUR', categoryId: loansId, period: 'monthly', startDate: '2026-01-15', confirm: true }, db);

  const cats = await listCategories({ includeArchived: true }, db);
  const byName = (n) => cats.find((c) => c.name === n);
  const plans = await monthPlans('2026-11', cats, { db });

  assert.equal(plans.own(byName('Здоровье')), 10_00, 'свой план «прочее»');
  assert.equal(plans.own(byName('Страховка')), 120_00, 'план статьи — из разового платежа');
  assert.equal(plans.own(byName('Аптека')), 20_00, 'план статьи — по графику');
  assert.equal(plans.total(byName('Здоровье')), 150_00, 'план категории = прочее + статьи');
  assert.equal(plans.limit(byName('Здоровье')), 150_00, 'лимит категории — её план со статьями');
  assert.equal(plans.limit(byName('Аптека')), 20_00, 'лимит статьи — её план');
  assert.equal(plans.limit(byName('Продукты')), 300_00, 'старый лимит не используется — только план');
  assert.equal(plans.own(byName('Кредиты')), 100_00, 'план кредитов — по графику');
  assert.equal(plans.limit(byName('Кредиты')), null, 'у кредитов лимита нет');
  assert.equal(plans.limit(salary), null, 'у доходов лимита нет');
  assert.equal(plans.total(await (async () => byName('Продукты'))()), 300_00);

  const plansDec = await monthPlans('2026-12', cats, { db });
  assert.equal(plansDec.total(byName('Здоровье')), 20_00, 'в другом месяце — только платёж по графику');
  assert.equal(plansDec.limit(byName('Продукты')), null, 'без плана нет и лимита');
});
