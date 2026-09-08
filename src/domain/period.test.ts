import { describe, expect, it } from 'vitest';
import {
  effectiveStartDay,
  fractionElapsed,
  formatPeriodRange,
  isDateInPeriod,
  lastNPeriodKeys,
  periodForDate,
  periodFromAnchor,
  periodKeyRange,
  periodLengthDays,
  periodsBetweenKeys,
  shiftPeriodKey,
} from './period';

/** Convenience: [start, end] of the period containing `date`. */
const range = (date: string, startDay: number): [string, string] => {
  const p = periodForDate(date, startDay);
  return [p.start, p.end];
};

describe('effectiveStartDay (short-month rule)', () => {
  it('leaves valid days alone', () => {
    expect(effectiveStartDay(2025, 9, 15)).toBe(15);
    expect(effectiveStartDay(2025, 1, 31)).toBe(31);
  });

  it('clamps day 31 to the last day of shorter months', () => {
    expect(effectiveStartDay(2025, 2, 31)).toBe(28); // non-leap Feb
    expect(effectiveStartDay(2024, 2, 31)).toBe(29); // leap Feb
    expect(effectiveStartDay(2025, 4, 31)).toBe(30); // 30-day month
  });

  it('clamps day 30 and 29 in February only', () => {
    expect(effectiveStartDay(2025, 2, 30)).toBe(28);
    expect(effectiveStartDay(2025, 2, 29)).toBe(28);
    expect(effectiveStartDay(2024, 2, 29)).toBe(29); // exists in a leap year
    expect(effectiveStartDay(2025, 4, 30)).toBe(30);
  });
});

describe('periodForDate - the spec example (start day 15)', () => {
  it('runs 15th to the 14th of the next month', () => {
    expect(range('2025-09-15', 15)).toEqual(['2025-09-15', '2025-10-14']);
    expect(range('2025-10-01', 15)).toEqual(['2025-09-15', '2025-10-14']);
    expect(range('2025-10-14', 15)).toEqual(['2025-09-15', '2025-10-14']);
    expect(range('2025-10-15', 15)).toEqual(['2025-10-15', '2025-11-14']);
  });

  it('uses the previous month as the anchor before the boundary', () => {
    expect(periodForDate('2025-09-14', 15).key).toBe('2025-08');
    expect(periodForDate('2025-09-15', 15).key).toBe('2025-09');
  });
});

describe('periodForDate - start day 1 behaves like calendar months', () => {
  it('matches month boundaries exactly', () => {
    expect(range('2025-02-01', 1)).toEqual(['2025-02-01', '2025-02-28']);
    expect(range('2024-02-10', 1)).toEqual(['2024-02-01', '2024-02-29']);
    expect(range('2025-12-31', 1)).toEqual(['2025-12-01', '2025-12-31']);
  });

  it('rolls the year over', () => {
    expect(range('2026-01-01', 1)).toEqual(['2026-01-01', '2026-01-31']);
    expect(periodForDate('2025-12-05', 1).key).toBe('2025-12');
  });
});

describe('periodForDate - start day 31 (the hard case)', () => {
  it('walks Jan -> Feb -> Mar -> Apr with clamped boundaries', () => {
    expect(range('2025-01-31', 31)).toEqual(['2025-01-31', '2025-02-27']);
    expect(range('2025-02-27', 31)).toEqual(['2025-01-31', '2025-02-27']);
    expect(range('2025-02-28', 31)).toEqual(['2025-02-28', '2025-03-30']);
    expect(range('2025-03-30', 31)).toEqual(['2025-02-28', '2025-03-30']);
    expect(range('2025-03-31', 31)).toEqual(['2025-03-31', '2025-04-29']);
    expect(range('2025-04-30', 31)).toEqual(['2025-04-30', '2025-05-30']);
  });

  it('uses Feb 29 as the boundary in a leap year', () => {
    expect(range('2024-02-29', 31)).toEqual(['2024-02-29', '2024-03-30']);
    expect(range('2024-02-28', 31)).toEqual(['2024-01-31', '2024-02-28']);
  });

  it('produces very short and very long periods without gaps', () => {
    expect(periodLengthDays(periodFromAnchor(2025, 1, 31))).toBe(28); // Jan 31 - Feb 27
    expect(periodLengthDays(periodFromAnchor(2025, 4, 31))).toBe(31); // Apr 30 - May 30
  });
});

describe('periodForDate - start day 29 and 30', () => {
  it('handles day 30 across February', () => {
    expect(range('2025-01-30', 30)).toEqual(['2025-01-30', '2025-02-27']);
    expect(range('2025-02-28', 30)).toEqual(['2025-02-28', '2025-03-29']);
  });

  it('handles day 29 across a leap February', () => {
    expect(range('2024-02-29', 29)).toEqual(['2024-02-29', '2024-03-28']);
    // Feb 2023 clamps the boundary to the 28th, so the 27th is still January's
    // period and the 28th opens February's.
    expect(range('2023-02-27', 29)).toEqual(['2023-01-29', '2023-02-27']);
    expect(range('2023-02-28', 29)).toEqual(['2023-02-28', '2023-03-28']);
    expect(range('2023-03-01', 29)).toEqual(['2023-02-28', '2023-03-28']);
  });
});

describe('period coverage invariants', () => {
  // Exhaustive: for every start day and every day across four years (including a
  // leap year), each date lands in exactly one period, and consecutive periods
  // touch with no gap and no overlap.
  it('tiles the calendar for every start day 1-31', () => {
    for (let startDay = 1; startDay <= 31; startDay++) {
      let cursor = new Date(2023, 0, 1);
      const endStamp = new Date(2027, 0, 1).getTime();
      let previous = periodForDate('2023-01-01', startDay);

      while (cursor.getTime() < endStamp) {
        const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(
          cursor.getDate(),
        ).padStart(2, '0')}`;
        const p = periodForDate(iso, startDay);

        expect(isDateInPeriod(iso, p)).toBe(true);
        if (p.key !== previous.key) {
          // A new period must begin the day after the old one ended.
          expect(periodsBetweenKeys(previous.key, p.key)).toBe(1);
          expect(p.start > previous.end).toBe(true);
          expect(Date.parse(`${p.start}T00:00:00Z`) - Date.parse(`${previous.end}T00:00:00Z`)).toBe(86_400_000);
          previous = p;
        }
        cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
      }
    }
  });

  it('keeps period keys stable regardless of start day', () => {
    // The key is the anchor month, so the same anchor yields the same key.
    expect(periodFromAnchor(2025, 9, 1).key).toBe('2025-09');
    expect(periodFromAnchor(2025, 9, 31).key).toBe('2025-09');
  });
});

describe('period key arithmetic', () => {
  it('shifts across year boundaries', () => {
    expect(shiftPeriodKey('2025-12', 1)).toBe('2026-01');
    expect(shiftPeriodKey('2025-01', -1)).toBe('2024-12');
    expect(shiftPeriodKey('2025-06', 12)).toBe('2026-06');
  });

  it('counts and lists ranges', () => {
    expect(periodsBetweenKeys('2025-01', '2025-06')).toBe(5);
    expect(periodsBetweenKeys('2025-06', '2025-01')).toBe(-5);
    expect(periodKeyRange('2025-11', '2026-01')).toEqual(['2025-11', '2025-12', '2026-01']);
    expect(periodKeyRange('2025-06', '2025-01')).toEqual([]);
    expect(lastNPeriodKeys('2025-03', 3)).toEqual(['2025-01', '2025-02', '2025-03']);
  });
});

describe('fractionElapsed (drives the pace indicator)', () => {
  const p = periodFromAnchor(2025, 9, 15); // Sep 15 - Oct 14, 30 days

  it('counts the first day as elapsed', () => {
    expect(fractionElapsed(p, '2025-09-15')).toBeCloseTo(1 / 30);
  });

  it('reaches 1 on the last day and clamps outside the period', () => {
    expect(fractionElapsed(p, '2025-10-14')).toBe(1);
    expect(fractionElapsed(p, '2025-11-01')).toBe(1);
    expect(fractionElapsed(p, '2025-09-01')).toBe(0);
  });

  it('is roughly half way at the midpoint', () => {
    expect(fractionElapsed(p, '2025-09-29')).toBeCloseTo(15 / 30);
  });
});

describe('formatPeriodRange', () => {
  it('omits the year within one year and adds it across the boundary', () => {
    expect(formatPeriodRange(periodFromAnchor(2025, 9, 15))).toBe('15 Sep – 14 Oct');
    expect(formatPeriodRange(periodFromAnchor(2025, 12, 15))).toBe('15 Dec 2025 – 14 Jan 2026');
  });
});
