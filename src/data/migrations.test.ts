import { describe, expect, it } from 'vitest';
import { migrate } from './migrations';
import { parseState } from './validation';

describe('v1 -> v2 migration', () => {
  it('drops the essential flag from an existing v1 document', () => {
    const v1 = {
      schemaVersion: 1,
      settings: { periodStartDay: 15, currency: 'lv' },
      groups: [{ id: 'g', name: 'G', sortOrder: 0 }],
      categories: [{ id: 'c', groupId: 'g', name: 'Rent', sortOrder: 0, essential: true }],
      transactions: [],
      assignments: {},
    };
    const { doc, applied } = migrate(v1);
    expect(applied.some((a) => a.startsWith('v2'))).toBe(true);
    expect((doc.categories as any[])[0]).not.toHaveProperty('essential');
    // Surviving fields are untouched.
    const { state } = parseState(doc);
    expect(state.categories[0]!.name).toBe('Rent');
    expect(state.settings.periodStartDay).toBe(15);
    expect(state.schemaVersion).toBe(2);
  });
});
