/**
 * Date helpers.
 *
 * The entire app represents calendar days as plain `YYYY-MM-DD` strings and never
 * as `Date` objects in stored data. This is deliberate: `new Date('2025-09-15')`
 * parses as UTC midnight, which is the previous day for anyone west of Greenwich,
 * and that class of off-by-one bug is fatal for an app whose whole premise is
 * "which period does this date fall into".
 */

export type ISODate = string; // 'YYYY-MM-DD'

export interface YMD {
  year: number;
  month: number; // 1-12 (NOT the 0-based JS month)
  day: number;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string') return false;
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const ymd = { year: +m[1]!, month: +m[2]!, day: +m[3]! };
  if (ymd.month < 1 || ymd.month > 12) return false;
  return ymd.day >= 1 && ymd.day <= daysInMonth(ymd.year, ymd.month);
}

export function parseISO(iso: ISODate): YMD {
  const m = ISO_RE.exec(iso);
  if (!m) throw new Error(`Invalid ISO date: ${iso}`);
  return { year: +m[1]!, month: +m[2]!, day: +m[3]! };
}

export function toISO({ year, month, day }: YMD): ISODate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Days in a 1-12 month. Day 0 of the *next* month is the last day of this one. */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Today in the *browser's local* timezone, as `YYYY-MM-DD`. */
export function today(now: Date = new Date()): ISODate {
  return toISO({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
}

/** Add months to a (year, month) pair, keeping month in 1-12. */
export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const zeroBased = year * 12 + (month - 1) + delta;
  return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 };
}

export function addDays(iso: ISODate, days: number): ISODate {
  const { year, month, day } = parseISO(iso);
  const d = new Date(year, month - 1, day + days); // local-time arithmetic, DST-safe for whole days
  return toISO({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() });
}

/** Lexicographic comparison is chronological for zero-padded ISO dates. */
export function compareISO(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Whole days from `a` to `b` (negative if b is before a). */
export function daysBetween(a: ISODate, b: ISODate): number {
  const pa = parseISO(a);
  const pb = parseISO(b);
  // UTC.getTime avoids DST hour drift; both endpoints use the same fiction.
  const ms = Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day);
  return Math.round(ms / 86_400_000);
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** '2025-09-15' -> '15 Sep' (or '15 Sep 2025' when the year matters). */
export function formatShort(iso: ISODate, withYear = false): string {
  const { year, month, day } = parseISO(iso);
  return `${day} ${MONTH_NAMES[month - 1]}${withYear ? ` ${year}` : ''}`;
}

export function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? '';
}
