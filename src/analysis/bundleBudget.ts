// Admission policy for the automatic workflow, measured in CDP source characters.
// ASTs and semantic indexes can be much larger than their input. These are
// conservative admission limits, not a guarantee of bounded engine memory.
export const BUNDLE_BUDGET = { scripts: 100, perScript: 500_000, total: 2_000_000 } as const;

export function bundleBudgetReason(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return 'Script inventory unavailable.';
  const { total, items } = value as { total?: unknown; items?: unknown };
  if (!Number.isSafeInteger(total) || (total as number) < 0 || !Array.isArray(items) || items.length !== total) return 'Script inventory incomplete.';
  if (items.length > BUNDLE_BUDGET.scripts) return 'Script count exceeds the automatic analysis budget.';
  let sum = 0;
  for (const item of items) {
    const length = item?.length;
    if (!Number.isSafeInteger(length) || length < 0) return 'Script size unavailable.';
    if (length > BUNDLE_BUDGET.perScript) return 'A script exceeds the automatic analysis size budget.';
    sum += length;
    if (sum > BUNDLE_BUDGET.total) return 'Combined scripts exceed the automatic analysis size budget.';
  }
  return undefined;
}
