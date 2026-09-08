/**
 * The budget engine: turns the stored document into the numbers every screen
 * shows. Everything here is scoped by rolling periods from ./period.ts.
 *
 * Rollover model (matches the spec, which mirrors YNAB on a custom cadence):
 *
 *   balance(period) = balance(previous period) + assigned(period) - activity(period)
 *
 * A leftover carries forward as a positive; an overspend carries forward as a
 * negative that eats into the next period. Because balances are cumulative, they
 * are computed by walking forward from the earliest period that has any data --
 * there is no way to answer "what is this category's balance" from one period in
 * isolation.
 */

import { today, type ISODate } from './date';
import { sum, type Cents } from './money';
import {
  fractionElapsed,
  lastNPeriodKeys,
  periodForDate,
  periodFromKey,
  periodKeyRange,
  periodsBetweenKeys,
  shiftPeriodKey,
  type Period,
  type PeriodKey,
} from './period';
import type { BudgetState, Category, Goal, Transaction } from '../data/schema';

// ---------------------------------------------------------------------------
// Status colours
// ---------------------------------------------------------------------------

/**
 * `neutral` is an addition to the spec's three states: it covers a category
 * with nothing funded and nothing spent, which would otherwise render as a
 * bright green "funded" card despite holding no money. It uses the neutral card
 * surface, so the dashboard stays quiet until a category is actually in play.
 */
export type CategoryStatus = 'green' | 'orange' | 'red' | 'neutral';

/**
 * Which number the 80% cutoff is measured against.
 *
 * - 'available' (default): carried-over balance + assigned this period. Once
 *   rollover exists this is the only basis that tells the truth -- a category
 *   holding 500 carried forward with 0 assigned is not "overspent" the moment
 *   you spend 1 of it.
 * - 'assigned': the spec's literal wording, "activity exceeds assigned amount".
 *   Identical to 'available' whenever there is no carry-over (i.e. always, in a
 *   brand new budget). Selectable in Settings.
 */
export type StatusBasis = 'available' | 'assigned';

export interface StatusInput {
  assigned: Cents;
  activity: Cents;
  carryover: Cents;
  threshold: number;
  basis: StatusBasis;
}

export function categoryStatus({ assigned, activity, carryover, threshold, basis }: StatusInput): CategoryStatus {
  // Negative carry-over (last period's overspend) always counts against you;
  // positive carry-over only counts under the 'available' basis.
  const base = basis === 'available' ? assigned + carryover : assigned + Math.min(0, carryover);

  if (base <= 0) {
    if (activity > 0) return 'red'; // spent from a category with nothing in it
    return 'neutral';
  }
  const ratio = activity / base;
  if (ratio > 1) return 'red';
  if (ratio >= threshold) return 'orange';
  return 'green';
}

// ---------------------------------------------------------------------------
// Pace
// ---------------------------------------------------------------------------

export type Pace = 'under' | 'on' | 'over' | 'none';

export interface PaceResult {
  pace: Pace;
  /** Share of the period elapsed, 0-1. */
  elapsed: number;
  /** Share of the funding spent, 0-1+ (uncapped so "160% spent" is visible). */
  spent: number;
}

export function spendingPace(
  activity: Cents,
  base: Cents,
  period: Period,
  asOf: ISODate,
  tolerance: number,
): PaceResult {
  const elapsed = fractionElapsed(period, asOf);
  if (base <= 0) return { pace: 'none', elapsed, spent: activity > 0 ? 1 : 0 };
  const spent = activity / base;
  const delta = spent - elapsed;
  if (delta > tolerance) return { pace: 'over', elapsed, spent };
  if (delta < -tolerance) return { pace: 'under', elapsed, spent };
  return { pace: 'on', elapsed, spent };
}

// ---------------------------------------------------------------------------
// Ledger: cumulative per-category balances across periods
// ---------------------------------------------------------------------------

export interface CategoryPeriodRow {
  categoryId: string;
  assigned: Cents;
  activity: Cents;
  /** Balance at the end of the previous period. */
  carryover: Cents;
  /** carryover + assigned - activity. */
  balance: Cents;
}

export interface PeriodRow {
  key: PeriodKey;
  income: Cents;
  totalAssigned: Cents;
  totalActivity: Cents;
  /** Expenses recorded with no category (recovered from a broken import). */
  uncategorised: Cents;
  byCategory: Map<string, CategoryPeriodRow>;
}

export interface Ledger {
  rows: Map<PeriodKey, PeriodRow>;
  firstKey: PeriodKey;
  lastKey: PeriodKey;
}

interface PeriodBuckets {
  income: Cents;
  uncategorised: Cents;
  activity: Map<string, Cents>;
}

/** Group transactions by the period their date falls into. */
function bucketTransactions(transactions: readonly Transaction[], startDay: number): Map<PeriodKey, PeriodBuckets> {
  const buckets = new Map<PeriodKey, PeriodBuckets>();
  for (const t of transactions) {
    const key = periodForDate(t.date, startDay).key;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { income: 0, uncategorised: 0, activity: new Map() };
      buckets.set(key, bucket);
    }
    if (t.kind === 'income') {
      bucket.income += t.amount;
    } else if (t.categoryId) {
      bucket.activity.set(t.categoryId, (bucket.activity.get(t.categoryId) ?? 0) + t.amount);
    } else {
      bucket.uncategorised += t.amount;
    }
  }
  return buckets;
}

/** Earliest period key with any data, or the current period if the budget is empty. */
export function firstDataPeriodKey(state: BudgetState, currentKey: PeriodKey): PeriodKey {
  const startDay = state.settings.periodStartDay;
  let earliest: PeriodKey | null = null;
  for (const t of state.transactions) {
    const key = periodForDate(t.date, startDay).key;
    if (!earliest || key < earliest) earliest = key;
  }
  for (const key of Object.keys(state.assignments)) {
    if (!earliest || key < earliest) earliest = key;
  }
  if (!earliest || earliest > currentKey) return currentKey;
  return earliest;
}

/**
 * Walk every period from the first with data through `throughKey`, accumulating
 * carry-over. One pass; callers slice the result.
 */
export function buildLedger(state: BudgetState, throughKey: PeriodKey): Ledger {
  const startDay = state.settings.periodStartDay;
  const buckets = bucketTransactions(state.transactions, startDay);

  let firstKey = firstDataPeriodKey(state, throughKey);
  if (firstKey > throughKey) firstKey = throughKey;

  const keys = periodKeyRange(firstKey, throughKey);
  const rows = new Map<PeriodKey, PeriodRow>();
  const runningBalance = new Map<string, Cents>();
  const categoryIds = state.categories.map((c) => c.id);

  for (const key of keys) {
    const bucket = buckets.get(key);
    const assignedForPeriod = state.assignments[key] ?? {};
    const byCategory = new Map<string, CategoryPeriodRow>();
    let totalAssigned = 0;
    let totalActivity = 0;

    for (const categoryId of categoryIds) {
      const assigned = assignedForPeriod[categoryId] ?? 0;
      const activity = bucket?.activity.get(categoryId) ?? 0;
      const carryover = runningBalance.get(categoryId) ?? 0;
      const balance = carryover + assigned - activity;
      runningBalance.set(categoryId, balance);
      byCategory.set(categoryId, { categoryId, assigned, activity, carryover, balance });
      totalAssigned += assigned;
      totalActivity += activity;
    }

    rows.set(key, {
      key,
      income: bucket?.income ?? 0,
      totalAssigned,
      totalActivity,
      uncategorised: bucket?.uncategorised ?? 0,
      byCategory,
    });
  }

  return { rows, firstKey, lastKey: throughKey };
}

const EMPTY_ROW = (key: PeriodKey): PeriodRow => ({
  key,
  income: 0,
  totalAssigned: 0,
  totalActivity: 0,
  uncategorised: 0,
  byCategory: new Map(),
});

export function periodRow(ledger: Ledger, key: PeriodKey): PeriodRow {
  return ledger.rows.get(key) ?? EMPTY_ROW(key);
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export interface GoalProgress {
  goal: Goal;
  /** What the goal says should be assigned to this category this period. */
  needThisPeriod: Cents;
  /** Still to assign this period to stay on track. */
  remainingThisPeriod: Cents;
  /** 0-1 completion of the overall target (per-period goals use this period). */
  progress: number;
  /** Periods left including the current one; only for target_by_date. */
  periodsLeft?: number;
  /** The target date has passed and the target was not met. */
  overdue?: boolean;
}

export function goalProgress(
  goal: Goal,
  row: CategoryPeriodRow,
  currentKey: PeriodKey,
  startDay: number,
): GoalProgress {
  if (goal.type === 'per_period') {
    const progress = goal.amount > 0 ? Math.min(1, row.assigned / goal.amount) : 1;
    return {
      goal,
      needThisPeriod: goal.amount,
      remainingThisPeriod: Math.max(0, goal.amount - row.assigned),
      progress,
    };
  }

  // target_by_date: back-calculate the per-period contribution over the periods
  // that remain, using the app's custom period length rather than months.
  const targetKey = goal.targetDate ? periodForDate(goal.targetDate, startDay).key : currentKey;
  const periodsLeft = Math.max(0, periodsBetweenKeys(currentKey, targetKey)) + 1;
  const stillNeeded = Math.max(0, goal.amount - row.balance);
  const overdue = targetKey < currentKey && row.balance < goal.amount;

  // `row.balance` already includes anything assigned this period, so spreading
  // what's left over the remaining periods gives the *additional* amount to
  // assign now. The period's full share is that plus what's already assigned.
  const remainingThisPeriod = overdue ? stillNeeded : Math.ceil(stillNeeded / periodsLeft);
  return {
    goal,
    needThisPeriod: Math.max(0, row.assigned) + remainingThisPeriod,
    remainingThisPeriod,
    progress: goal.amount > 0 ? Math.min(1, Math.max(0, row.balance) / goal.amount) : 1,
    periodsLeft: overdue ? 0 : periodsLeft,
    overdue,
  };
}

// ---------------------------------------------------------------------------
// Dashboard view model
// ---------------------------------------------------------------------------

export interface CategoryView extends CategoryPeriodRow {
  category: Category;
  status: CategoryStatus;
  pace: PaceResult;
  goal?: GoalProgress;
}

export interface GroupView {
  id: string;
  name: string;
  categories: CategoryView[];
  assigned: Cents;
  activity: Cents;
  balance: Cents;
}

export interface DashboardView {
  period: Period;
  isCurrentPeriod: boolean;
  income: Cents;
  totalAssigned: Cents;
  totalActivity: Cents;
  uncategorised: Cents;
  /**
   * Income this period minus everything assigned this period -- the headline
   * "not yet given a job" number.
   */
  unassigned: Cents;
  overallPace: PaceResult;
  groups: GroupView[];
  categories: CategoryView[];
}

export interface ViewOptions {
  /** Defaults to the real today; injectable for tests. */
  asOf?: ISODate;
  statusBasis?: StatusBasis;
  paceTolerance?: number;
}

export function buildDashboard(
  state: BudgetState,
  key: PeriodKey,
  ledger: Ledger,
  opts: ViewOptions = {},
): DashboardView {
  const startDay = state.settings.periodStartDay;
  const asOf = opts.asOf ?? today();
  const threshold = state.settings.nearLimitThreshold;
  const basis = opts.statusBasis ?? 'available';
  const tolerance = opts.paceTolerance ?? 0.1;

  const period = periodFromKey(key, startDay);
  const row = periodRow(ledger, key);
  const currentKey = periodForDate(asOf, startDay).key;

  // Pace only makes sense inside a period that is actually running. For a past
  // period treat it as fully elapsed, for a future one as not started.
  const paceDate = key === currentKey ? asOf : key < currentKey ? period.end : period.start;

  const categories: CategoryView[] = [];
  for (const category of state.categories) {
    if (category.archived) continue;
    const catRow = row.byCategory.get(category.id) ?? {
      categoryId: category.id,
      assigned: 0,
      activity: 0,
      carryover: 0,
      balance: 0,
    };
    const base = basis === 'available' ? catRow.assigned + catRow.carryover : catRow.assigned;
    categories.push({
      ...catRow,
      category,
      status: categoryStatus({
        assigned: catRow.assigned,
        activity: catRow.activity,
        carryover: catRow.carryover,
        threshold,
        basis,
      }),
      pace: spendingPace(catRow.activity, base, period, paceDate, tolerance),
      goal: category.goal ? goalProgress(category.goal, catRow, key, startDay) : undefined,
    });
  }

  const groups: GroupView[] = state.groups
    .map((group) => {
      const members = categories.filter((c) => c.category.groupId === group.id);
      return {
        id: group.id,
        name: group.name,
        categories: members,
        assigned: sum(members.map((m) => m.assigned)),
        activity: sum(members.map((m) => m.activity)),
        balance: sum(members.map((m) => m.balance)),
      };
    })
    .filter((g) => g.categories.length > 0);

  const unassigned = row.income - row.totalAssigned;
  const totalFunding = sum(categories.map((c) => Math.max(0, c.assigned + c.carryover)));

  return {
    period,
    isCurrentPeriod: key === currentKey,
    income: row.income,
    totalAssigned: row.totalAssigned,
    totalActivity: row.totalActivity,
    uncategorised: row.uncategorised,
    unassigned,
    overallPace: spendingPace(row.totalActivity, totalFunding, period, paceDate, tolerance),
    groups,
    categories,
  };
}

// ---------------------------------------------------------------------------
// Payee memory
// ---------------------------------------------------------------------------

export interface PayeeSuggestion {
  name: string;
  lastCategoryId: string | null;
  lastUsed: ISODate;
  count: number;
}

/**
 * Derived from the transaction list rather than stored separately, so it can
 * never drift out of sync with the data (including after a Gist pull).
 */
export function buildPayeeIndex(transactions: readonly Transaction[]): PayeeSuggestion[] {
  const index = new Map<string, PayeeSuggestion>();
  for (const t of transactions) {
    const name = t.payee.trim();
    if (!name) continue;
    const lower = name.toLowerCase();
    const existing = index.get(lower);
    if (!existing) {
      index.set(lower, { name, lastCategoryId: t.categoryId, lastUsed: t.date, count: 1 });
      continue;
    }
    existing.count++;
    if (t.date >= existing.lastUsed) {
      existing.lastUsed = t.date;
      existing.name = name;
      // Remember the most recent categorisation for this payee.
      if (t.categoryId) existing.lastCategoryId = t.categoryId;
    }
  }
  return [...index.values()].sort((a, b) => (b.lastUsed === a.lastUsed ? b.count - a.count : b.lastUsed < a.lastUsed ? -1 : 1));
}

export function suggestPayees(index: readonly PayeeSuggestion[], query: string, limit = 6): PayeeSuggestion[] {
  const q = query.trim().toLowerCase();
  if (!q) return index.slice(0, limit);
  const starts: PayeeSuggestion[] = [];
  const contains: PayeeSuggestion[] = [];
  for (const p of index) {
    const name = p.name.toLowerCase();
    if (name.startsWith(q)) starts.push(p);
    else if (name.includes(q)) contains.push(p);
  }
  return [...starts, ...contains].slice(0, limit);
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export interface PeriodTotals {
  key: PeriodKey;
  income: Cents;
  spending: Cents;
  assigned: Cents;
  net: Cents;
}

export function periodTotalsSeries(ledger: Ledger, keys: readonly PeriodKey[]): PeriodTotals[] {
  return keys.map((key) => {
    const row = periodRow(ledger, key);
    const spending = row.totalActivity + row.uncategorised;
    return { key, income: row.income, spending, assigned: row.totalAssigned, net: row.income - spending };
  });
}

export interface CategorySpend {
  categoryId: string;
  name: string;
  groupName: string;
  amount: Cents;
  share: number;
}

export function spendingByCategory(
  state: BudgetState,
  ledger: Ledger,
  keys: readonly PeriodKey[],
): CategorySpend[] {
  const totals = new Map<string, Cents>();
  for (const key of keys) {
    const row = periodRow(ledger, key);
    for (const [categoryId, catRow] of row.byCategory) {
      if (catRow.activity === 0) continue;
      totals.set(categoryId, (totals.get(categoryId) ?? 0) + catRow.activity);
    }
  }
  const grand = sum([...totals.values()]);
  const groupName = new Map(state.groups.map((g) => [g.id, g.name]));
  return [...totals.entries()]
    .map(([categoryId, amount]) => {
      const category = state.categories.find((c) => c.id === categoryId);
      return {
        categoryId,
        name: category?.name ?? 'Deleted category',
        groupName: category ? groupName.get(category.groupId) ?? '' : '',
        amount,
        share: grand > 0 ? amount / grand : 0,
      };
    })
    .sort((a, b) => b.amount - a.amount);
}

export interface CategoryHistoryPoint {
  key: PeriodKey;
  assigned: Cents;
  activity: Cents;
  balance: Cents;
}

export function categoryHistory(
  ledger: Ledger,
  categoryId: string,
  keys: readonly PeriodKey[],
): CategoryHistoryPoint[] {
  return keys.map((key) => {
    const row = periodRow(ledger, key).byCategory.get(categoryId);
    return {
      key,
      assigned: row?.assigned ?? 0,
      activity: row?.activity ?? 0,
      balance: row?.balance ?? 0,
    };
  });
}

/** Report window: the last `count` periods ending at `endKey`. */
export function reportWindow(endKey: PeriodKey, count: number): PeriodKey[] {
  return lastNPeriodKeys(endKey, count);
}

export { shiftPeriodKey };
