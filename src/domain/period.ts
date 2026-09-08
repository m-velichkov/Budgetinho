/**
 * THE CORE MECHANIC: custom rolling periods.
 *
 * Every date-scoped number in this app (category assigned/activity/balance,
 * unassigned income, goal progress, reports) is computed against a period
 * produced here -- never against `getMonth()`.
 *
 * Definition
 * ----------
 * A period runs from `startDay` of one month up to the day *before* `startDay`
 * of the next month. Start day 15 => Sep 15 - Oct 14, Oct 15 - Nov 14, ...
 *
 * Short-month rule: if `startDay` doesn't exist in a month (day 31 in February,
 * day 30 in February, day 31 in April) the boundary rolls back to the *last
 * valid day of that month*. So with startDay 31 in a non-leap year:
 *
 *   Jan 31 - Feb 27   (next boundary is Feb 28, the clamped start)
 *   Feb 28 - Mar 30
 *   Mar 31 - Apr 29   (next boundary is Apr 30, the clamped start)
 *
 * Identity
 * --------
 * A period is identified by its *anchor month* -- the calendar month its start
 * date falls in -- serialized as `YYYY-MM`. This key is what gets stored in the
 * assignments table, so it must stay stable: it does NOT depend on `startDay`.
 * Changing the period start day re-slices which transactions land in which
 * period but never renames the periods themselves.
 */

import {
  addDays,
  addMonths,
  compareISO,
  daysBetween,
  daysInMonth,
  formatShort,
  monthName,
  parseISO,
  toISO,
  type ISODate,
} from './date';

export type PeriodKey = string; // 'YYYY-MM' of the period's anchor month

export interface Period {
  key: PeriodKey;
  /** First day of the period, inclusive. */
  start: ISODate;
  /** Last day of the period, inclusive. */
  end: ISODate;
  /** Calendar year/month the period starts in. */
  anchorYear: number;
  anchorMonth: number; // 1-12
}

export const MIN_START_DAY = 1;
export const MAX_START_DAY = 31;

export function clampStartDay(day: number): number {
  if (!Number.isFinite(day)) return 1;
  return Math.min(MAX_START_DAY, Math.max(MIN_START_DAY, Math.trunc(day)));
}

/**
 * The start day actually used in a given month, after the short-month rule.
 * effectiveStartDay(2025, 2, 31) === 28
 */
export function effectiveStartDay(year: number, month: number, startDay: number): number {
  return Math.min(clampStartDay(startDay), daysInMonth(year, month));
}

/** The boundary date that opens the period anchored to (year, month). */
function boundary(year: number, month: number, startDay: number): ISODate {
  return toISO({ year, month, day: effectiveStartDay(year, month, startDay) });
}

export function periodKey(year: number, month: number): PeriodKey {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

export function parsePeriodKey(key: PeriodKey): { year: number; month: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) throw new Error(`Invalid period key: ${key}`);
  const month = +m[2]!;
  if (month < 1 || month > 12) throw new Error(`Invalid period key: ${key}`);
  return { year: +m[1]!, month };
}

/** Build the period anchored to a given calendar month. */
export function periodFromAnchor(year: number, month: number, startDay: number): Period {
  const start = boundary(year, month, startDay);
  const next = addMonths(year, month, 1);
  const end = addDays(boundary(next.year, next.month, startDay), -1);
  return { key: periodKey(year, month), start, end, anchorYear: year, anchorMonth: month };
}

export function periodFromKey(key: PeriodKey, startDay: number): Period {
  const { year, month } = parsePeriodKey(key);
  return periodFromAnchor(year, month, startDay);
}

/**
 * The period a given date belongs to.
 *
 * A date in calendar month M belongs to the period anchored at M if it's on or
 * after M's boundary, otherwise to the period anchored at M-1. That holds for
 * every start day because boundaries are strictly increasing month to month
 * (each one lives inside its own calendar month).
 */
export function periodForDate(date: ISODate, startDay: number): Period {
  const { year, month } = parseISO(date);
  if (compareISO(date, boundary(year, month, startDay)) >= 0) {
    return periodFromAnchor(year, month, startDay);
  }
  const prev = addMonths(year, month, -1);
  return periodFromAnchor(prev.year, prev.month, startDay);
}

export function isDateInPeriod(date: ISODate, period: Period): boolean {
  return compareISO(date, period.start) >= 0 && compareISO(date, period.end) <= 0;
}

/** Shift a period key by whole periods (which is exactly whole months). */
export function shiftPeriodKey(key: PeriodKey, delta: number): PeriodKey {
  const { year, month } = parsePeriodKey(key);
  const next = addMonths(year, month, delta);
  return periodKey(next.year, next.month);
}

export function shiftPeriod(period: Period, delta: number, startDay: number): Period {
  return periodFromKey(shiftPeriodKey(period.key, delta), startDay);
}

/** Signed number of periods from `from` to `to` (periods are one per month). */
export function periodsBetweenKeys(from: PeriodKey, to: PeriodKey): number {
  const a = parsePeriodKey(from);
  const b = parsePeriodKey(to);
  return (b.year - a.year) * 12 + (b.month - a.month);
}

/** Inclusive list of period keys from `from` to `to`. Empty if `to` precedes `from`. */
export function periodKeyRange(from: PeriodKey, to: PeriodKey): PeriodKey[] {
  const span = periodsBetweenKeys(from, to);
  if (span < 0) return [];
  const out: PeriodKey[] = [];
  for (let i = 0; i <= span; i++) out.push(shiftPeriodKey(from, i));
  return out;
}

/** The last `count` period keys ending at (and including) `endKey`. */
export function lastNPeriodKeys(endKey: PeriodKey, count: number): PeriodKey[] {
  const n = Math.max(1, Math.trunc(count));
  return periodKeyRange(shiftPeriodKey(endKey, -(n - 1)), endKey);
}

/** Length of a period in days, inclusive of both endpoints. */
export function periodLengthDays(period: Period): number {
  return daysBetween(period.start, period.end) + 1;
}

/**
 * Fraction of the period elapsed as of `date`, in [0, 1].
 * The start day itself counts as one day elapsed, so a 30-day period is 1/30
 * through on day one rather than 0 -- this keeps the pace indicator from
 * screaming "over pace" the instant you spend anything on the first morning.
 */
export function fractionElapsed(period: Period, date: ISODate): number {
  const total = periodLengthDays(period);
  if (compareISO(date, period.start) < 0) return 0;
  if (compareISO(date, period.end) >= 0) return 1;
  return (daysBetween(period.start, date) + 1) / total;
}

export function daysRemaining(period: Period, date: ISODate): number {
  if (compareISO(date, period.end) >= 0) return 0;
  if (compareISO(date, period.start) < 0) return periodLengthDays(period);
  return daysBetween(date, period.end);
}

/** '15 Sep - 14 Oct' (adds years when the period straddles a year boundary). */
export function formatPeriodRange(period: Period): string {
  const s = parseISO(period.start);
  const e = parseISO(period.end);
  const withYear = s.year !== e.year;
  return `${formatShort(period.start, withYear)} \u2013 ${formatShort(period.end, withYear)}`;
}

/** 'Sep 2025' -- short label for chart axes and period pickers. */
export function formatPeriodLabel(period: Period | PeriodKey): string {
  const key = typeof period === 'string' ? period : period.key;
  const { year, month } = parsePeriodKey(key);
  return `${monthName(month)} ${year}`;
}

export function formatPeriodLabelShort(key: PeriodKey): string {
  const { month } = parsePeriodKey(key);
  return monthName(month);
}
