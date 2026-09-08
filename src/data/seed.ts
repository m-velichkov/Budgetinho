/**
 * Starter budget for a brand new install. Nothing here is sacred -- it exists
 * so the dashboard isn't an empty void on first launch, and every group and
 * category can be renamed or deleted in Settings.
 */

import { emptyState, newId, nowStamp, type BudgetState } from './schema';

interface SeedCategory {
  name: string;
  essential: boolean;
}

const SEED: Array<{ group: string; categories: SeedCategory[] }> = [
  {
    group: 'Fixed costs',
    categories: [
      { name: 'Rent', essential: true },
      { name: 'Utilities', essential: true },
      { name: 'Internet & phone', essential: true },
    ],
  },
  {
    group: 'Everyday',
    categories: [
      { name: 'Groceries', essential: true },
      { name: 'Transport', essential: false },
      { name: 'Eating out', essential: false },
      { name: 'Household', essential: false },
    ],
  },
  {
    group: 'Life',
    categories: [
      { name: 'Health', essential: false },
      { name: 'Fun', essential: false },
      { name: 'Gifts', essential: false },
    ],
  },
  {
    group: 'Savings',
    categories: [{ name: 'Emergency fund', essential: false }],
  },
];

export function seedState(periodStartDay = 1): BudgetState {
  const state = emptyState();
  state.settings.periodStartDay = periodStartDay;

  let groupOrder = 0;
  let categoryOrder = 0;
  for (const entry of SEED) {
    const groupId = newId('grp');
    state.groups.push({ id: groupId, name: entry.group, sortOrder: groupOrder++ });
    for (const c of entry.categories) {
      state.categories.push({
        id: newId('cat'),
        groupId,
        name: c.name,
        sortOrder: categoryOrder++,
        essential: c.essential,
      });
    }
  }

  state.updatedAt = nowStamp();
  return state;
}
