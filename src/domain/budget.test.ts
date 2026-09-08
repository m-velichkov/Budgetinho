import { describe, expect, it } from 'vitest';
import {
  buildDashboard,
  buildLedger,
  buildPayeeIndex,
  categoryStatus,
  goalProgress,
  periodRow,
  spendingByCategory,
  spendingPace,
  suggestPayees,
} from './budget';
import { periodFromAnchor } from './period';
import { parseAmount, formatMoney } from './money';
import { emptyState, type BudgetState, type Transaction } from '../data/schema';

// --- fixtures --------------------------------------------------------------

let seq = 0;
const tx = (over: Partial<Transaction>): Transaction => ({
  id: `t${++seq}`,
  date: '2025-09-20',
  payee: 'Shop',
  categoryId: 'rent',
  amount: 1000,
  kind: 'expense',
  createdAt: '2025-09-20T00:00:00.000Z',
  updatedAt: '2025-09-20T00:00:00.000Z',
  ...over,
});

function makeState(over: Partial<BudgetState> = {}): BudgetState {
  const base = emptyState();
  return {
    ...base,
    settings: { ...base.settings, periodStartDay: 15, currency: 'lv' },
    groups: [
      { id: 'fixed', name: 'Fixed costs', sortOrder: 0 },
      { id: 'fun', name: 'Fun', sortOrder: 1 },
    ],
    categories: [
      { id: 'rent', groupId: 'fixed', name: 'Rent', sortOrder: 0 },
      { id: 'food', groupId: 'fun', name: 'Food', sortOrder: 1 },
    ],
    ...over,
  };
}

// --- status ----------------------------------------------------------------

describe('categoryStatus', () => {
  const base = { carryover: 0, threshold: 0.8, basis: 'available' as const };

  it('is green below the threshold', () => {
    expect(categoryStatus({ ...base, assigned: 10000, activity: 0 })).toBe('green');
    expect(categoryStatus({ ...base, assigned: 10000, activity: 7999 })).toBe('green');
  });

  it('is orange from 80% up to fully spent', () => {
    expect(categoryStatus({ ...base, assigned: 10000, activity: 8000 })).toBe('orange');
    expect(categoryStatus({ ...base, assigned: 10000, activity: 10000 })).toBe('orange');
  });

  it('is red past the funded amount', () => {
    expect(categoryStatus({ ...base, assigned: 10000, activity: 10001 })).toBe('red');
  });

  it('is neutral when nothing is funded and nothing spent', () => {
    expect(categoryStatus({ ...base, assigned: 0, activity: 0 })).toBe('neutral');
  });

  it('is red when spending from an unfunded category', () => {
    expect(categoryStatus({ ...base, assigned: 0, activity: 500 })).toBe('red');
  });

  it("counts positive carry-over under 'available' but not under 'assigned'", () => {
    const spent = { assigned: 0, activity: 5000, carryover: 50000, threshold: 0.8 };
    expect(categoryStatus({ ...spent, basis: 'available' })).toBe('green');
    expect(categoryStatus({ ...spent, basis: 'assigned' })).toBe('red');
  });

  it('always counts negative carry-over against you', () => {
    const debt = { assigned: 10000, activity: 6000, carryover: -5000, threshold: 0.8 };
    expect(categoryStatus({ ...debt, basis: 'available' })).toBe('red');
    expect(categoryStatus({ ...debt, basis: 'assigned' })).toBe('red');
  });
});

// --- pace ------------------------------------------------------------------

describe('spendingPace', () => {
  const period = periodFromAnchor(2025, 9, 15); // 30 days

  it('flags over pace when spending outruns the calendar', () => {
    // Day 3 of 30 (10% elapsed) with half the money gone.
    expect(spendingPace(5000, 10000, period, '2025-09-17', 0.1).pace).toBe('over');
  });

  it('flags under pace when spending lags', () => {
    expect(spendingPace(500, 10000, period, '2025-10-10', 0.1).pace).toBe('under');
  });

  it('calls it on pace inside the tolerance band', () => {
    // Half way through the period, half the money spent.
    expect(spendingPace(5000, 10000, period, '2025-09-29', 0.1).pace).toBe('on');
  });

  it('returns none when nothing is funded', () => {
    expect(spendingPace(100, 0, period, '2025-09-29', 0.1).pace).toBe('none');
  });
});

// --- ledger / rollover -----------------------------------------------------

describe('buildLedger rollover', () => {
  it('carries a leftover forward into the next period', () => {
    const state = makeState({
      assignments: { '2025-09': { rent: 100_00 }, '2025-10': { rent: 100_00 } },
      transactions: [tx({ date: '2025-09-20', categoryId: 'rent', amount: 40_00 })],
    });
    const ledger = buildLedger(state, '2025-10');

    const sep = periodRow(ledger, '2025-09').byCategory.get('rent')!;
    expect(sep.activity).toBe(40_00);
    expect(sep.balance).toBe(60_00);

    const oct = periodRow(ledger, '2025-10').byCategory.get('rent')!;
    expect(oct.carryover).toBe(60_00);
    expect(oct.balance).toBe(160_00); // 60 carried + 100 assigned, nothing spent
  });

  it('carries an overspend forward as a negative', () => {
    const state = makeState({
      assignments: { '2025-09': { food: 50_00 }, '2025-10': { food: 50_00 } },
      transactions: [tx({ date: '2025-09-20', categoryId: 'food', amount: 80_00 })],
    });
    const ledger = buildLedger(state, '2025-10');

    expect(periodRow(ledger, '2025-09').byCategory.get('food')!.balance).toBe(-30_00);
    const oct = periodRow(ledger, '2025-10').byCategory.get('food')!;
    expect(oct.carryover).toBe(-30_00);
    expect(oct.balance).toBe(20_00); // 50 assigned reduced by last period's 30 overspend
  });

  it('files transactions by rolling period, not calendar month', () => {
    // Start day 15: Sep 14 belongs to the August period, Sep 15 to September's.
    const state = makeState({
      transactions: [
        tx({ date: '2025-09-14', categoryId: 'food', amount: 10_00 }),
        tx({ date: '2025-09-15', categoryId: 'food', amount: 20_00 }),
      ],
    });
    const ledger = buildLedger(state, '2025-09');
    expect(periodRow(ledger, '2025-08').byCategory.get('food')!.activity).toBe(10_00);
    expect(periodRow(ledger, '2025-09').byCategory.get('food')!.activity).toBe(20_00);
  });

  it('accumulates across a gap period with no data', () => {
    const state = makeState({
      assignments: { '2025-07': { food: 30_00 }, '2025-09': { food: 30_00 } },
      transactions: [],
    });
    const ledger = buildLedger(state, '2025-09');
    expect(periodRow(ledger, '2025-08').byCategory.get('food')!.balance).toBe(30_00);
    expect(periodRow(ledger, '2025-09').byCategory.get('food')!.balance).toBe(60_00);
  });
});

// --- dashboard -------------------------------------------------------------

describe('buildDashboard', () => {
  const state = makeState({
    assignments: { '2025-09': { rent: 800_00, food: 200_00 } },
    transactions: [
      tx({ date: '2025-09-15', kind: 'income', categoryId: null, payee: 'Salary', amount: 2000_00 }),
      tx({ date: '2025-09-18', categoryId: 'food', amount: 50_00, payee: 'Lidl' }),
    ],
  });
  const ledger = buildLedger(state, '2025-09');
  const view = buildDashboard(state, '2025-09', ledger, { asOf: '2025-09-20' });

  it('reports assigned vs unassigned income for the period', () => {
    expect(view.income).toBe(2000_00);
    expect(view.totalAssigned).toBe(1000_00);
    expect(view.unassigned).toBe(1000_00);
  });

  it('reports a negative unassigned when you over-assign', () => {
    const over = makeState({
      assignments: { '2025-09': { rent: 3000_00 } },
      transactions: [tx({ date: '2025-09-15', kind: 'income', categoryId: null, amount: 2000_00 })],
    });
    const v = buildDashboard(over, '2025-09', buildLedger(over, '2025-09'), { asOf: '2025-09-20' });
    expect(v.unassigned).toBe(-1000_00);
  });

  it('groups categories and hides empty groups', () => {
    expect(view.groups.map((g) => g.name)).toEqual(['Fixed costs', 'Fun']);
    const archived = buildDashboard(
      { ...state, categories: state.categories.map((c) => (c.id === 'rent' ? { ...c, archived: true } : c)) },
      '2025-09',
      ledger,
      { asOf: '2025-09-20' },
    );
    expect(archived.groups.map((g) => g.name)).toEqual(['Fun']);
  });

  it('colours the food category green at 25% spent', () => {
    expect(view.categories.find((c) => c.category.id === 'food')!.status).toBe('green');
  });
});

// --- goals -----------------------------------------------------------------

describe('goalProgress', () => {
  const row = { categoryId: 'x', assigned: 0, activity: 0, carryover: 0, balance: 0 };

  it('tracks a per-period funding target', () => {
    const g = goalProgress({ type: 'per_period', amount: 200_00 }, { ...row, assigned: 50_00 }, '2025-09', 15);
    expect(g.needThisPeriod).toBe(200_00);
    expect(g.remainingThisPeriod).toBe(150_00);
    expect(g.progress).toBeCloseTo(0.25);
  });

  it('back-calculates a target-by-date across custom periods', () => {
    // 600 needed, target falls in the period three after the current one.
    const goal = { type: 'target_by_date' as const, amount: 600_00, targetDate: '2025-12-20' };
    const g = goalProgress(goal, row, '2025-09', 15);
    expect(g.periodsLeft).toBe(4); // Sep, Oct, Nov, Dec
    expect(g.remainingThisPeriod).toBe(150_00);
  });

  it('counts an existing balance towards the target', () => {
    const goal = { type: 'target_by_date' as const, amount: 600_00, targetDate: '2025-12-20' };
    const g = goalProgress(goal, { ...row, balance: 300_00 }, '2025-09', 15);
    expect(g.remainingThisPeriod).toBe(75_00); // 300 left over 4 periods
    expect(g.progress).toBeCloseTo(0.5);
  });

  it('flags an overdue target and asks for the whole shortfall', () => {
    const goal = { type: 'target_by_date' as const, amount: 600_00, targetDate: '2025-07-01' };
    const g = goalProgress(goal, { ...row, balance: 100_00 }, '2025-09', 15);
    expect(g.overdue).toBe(true);
    expect(g.remainingThisPeriod).toBe(500_00);
  });

  it('is complete when the balance covers the target', () => {
    const goal = { type: 'target_by_date' as const, amount: 600_00, targetDate: '2025-12-20' };
    const g = goalProgress(goal, { ...row, balance: 600_00 }, '2025-09', 15);
    expect(g.remainingThisPeriod).toBe(0);
    expect(g.progress).toBe(1);
  });
});

// --- payees ----------------------------------------------------------------

describe('payee memory', () => {
  const transactions = [
    tx({ payee: 'Lidl', categoryId: 'food', date: '2025-09-01' }),
    tx({ payee: 'lidl', categoryId: 'rent', date: '2025-09-10' }), // later, different category
    tx({ payee: 'Billa', categoryId: 'food', date: '2025-09-05' }),
  ];

  it('suggests the most recently used category for a payee', () => {
    const index = buildPayeeIndex(transactions);
    const lidl = index.find((p) => p.name.toLowerCase() === 'lidl')!;
    expect(lidl.count).toBe(2);
    expect(lidl.lastCategoryId).toBe('rent');
  });

  it('matches prefixes before substrings', () => {
    const index = buildPayeeIndex([...transactions, tx({ payee: 'Super Lidl', date: '2025-08-01' })]);
    expect(suggestPayees(index, 'lid').map((p) => p.name)).toEqual(['lidl', 'Super Lidl']);
  });

  it('returns recent payees for an empty query', () => {
    expect(suggestPayees(buildPayeeIndex(transactions), '')[0]!.name).toBe('lidl');
  });
});

// --- reports ---------------------------------------------------------------

describe('spendingByCategory', () => {
  it('totals across a window of periods and computes shares', () => {
    const state = makeState({
      transactions: [
        tx({ date: '2025-08-20', categoryId: 'food', amount: 25_00 }),
        tx({ date: '2025-09-20', categoryId: 'food', amount: 25_00 }),
        tx({ date: '2025-09-21', categoryId: 'rent', amount: 50_00 }),
      ],
    });
    const rows = spendingByCategory(state, buildLedger(state, '2025-09'), ['2025-08', '2025-09']);
    expect(rows.map((r) => [r.name, r.amount])).toEqual([
      ['Food', 50_00],
      ['Rent', 50_00],
    ]);
    expect(rows[0]!.share).toBeCloseTo(0.5);
  });
});

// --- money -----------------------------------------------------------------

describe('money parsing and formatting', () => {
  it('parses the shapes people actually type', () => {
    expect(parseAmount('12')).toBe(1200);
    expect(parseAmount('12.5')).toBe(1250);
    expect(parseAmount('12,50')).toBe(1250);
    expect(parseAmount(' 1 234,56 лв ')).toBe(123456);
    expect(parseAmount('1,234')).toBe(123400); // thousands group, not decimals
    expect(parseAmount('-8')).toBe(-800);
    expect(parseAmount('12.999')).toBe(1299); // truncated, never rounded up
  });

  it('rejects junk', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });

  it('formats with grouping and a real minus sign', () => {
    expect(formatMoney(123456, 'lv')).toBe('1 234.56 lv');
    expect(formatMoney(-500, 'lv')).toBe('−5.00 lv');
    expect(formatMoney(500, 'lv', { signed: true })).toBe('+5.00 lv');
  });
});
