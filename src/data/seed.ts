/**
 * Starter budget for a brand new install. Nothing here is sacred -- it exists
 * so the dashboard isn't an empty void on first launch, and every group and
 * category can be renamed or deleted in Settings.
 */

import { emptyState, newId, nowStamp, type BudgetState } from './schema';

const SEED: Array<{ group: string; categories: string[] }> = [
  {
    group: 'Fixed costs',
    categories: [
      'Rent',
      'Utilities',
      'Internet & phone',
    ],
  },
  {
    group: 'Everyday',
    categories: [
      'Groceries',
      'Transport',
      'Eating out',
      'Household',
    ],
  },
  {
    group: 'Life',
    categories: [
      'Health',
      'Fun',
      'Gifts',
    ],
  },
  {
    group: 'Savings',
    categories: ['Emergency fund'],
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
    for (const name of entry.categories) {
      state.categories.push({ id: newId('cat'), groupId, name, sortOrder: categoryOrder++ });
    }
  }

  state.updatedAt = nowStamp();
  return state;
}
