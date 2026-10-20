import { expect, it } from 'vitest';
import { bundleBudgetReason, BUNDLE_BUDGET } from '../src/analysis/bundleBudget';

it('admits complete small inventories and rejects unknown or oversized inputs', () => {
  expect(bundleBudgetReason({ total: 0, items: [] })).toBeUndefined();
  expect(bundleBudgetReason({ total: 1, items: [{ length: BUNDLE_BUDGET.perScript }] })).toBeUndefined();
  for (const inventory of [undefined, { total: 1 }, { total: 1, items: [] }, { total: 1, items: [{ length: null }] }, { total: 1, items: [{ length: -1 }] }, { total: 1, items: [{ length: Infinity }] }, { total: 1, items: [{ length: BUNDLE_BUDGET.perScript + 1 }] }, { total: 101, items: Array(101).fill({ length: 1 }) }, { total: 5, items: Array(5).fill({ length: BUNDLE_BUDGET.perScript }) }]) expect(bundleBudgetReason(inventory)).toBeTypeOf('string');
});
