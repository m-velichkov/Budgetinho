/** Sticky period switcher. Present on every date-scoped screen. */

import { formatPeriodLabel, formatPeriodRange, periodFromKey, shiftPeriodKey, type PeriodKey } from '../domain/period';
import { today } from '../domain/date';
import { periodForDate } from '../domain/period';
import { setPeriodKey, goToToday } from '../store/store';

export function PeriodBar({ periodKey, startDay }: { periodKey: PeriodKey; startDay: number }) {
  const period = periodFromKey(periodKey, startDay);
  const currentKey = periodForDate(today(), startDay).key;
  const isCurrent = periodKey === currentKey;

  return (
    <div className="period-bar">
      <button
        type="button"
        className="icon-button"
        aria-label="Previous period"
        onClick={() => setPeriodKey(shiftPeriodKey(periodKey, -1))}
      >
        ‹
      </button>

      <button
        type="button"
        className="grow label"
        style={{ background: 'none', border: 'none', color: 'inherit' }}
        onClick={goToToday}
        aria-label={isCurrent ? 'Current period' : 'Jump to the current period'}
      >
        <strong>{formatPeriodLabel(period)}</strong>
        <span className="tiny muted">
          {formatPeriodRange(period)}
          {isCurrent ? '' : ' · tap for today'}
        </span>
      </button>

      <button
        type="button"
        className="icon-button"
        aria-label="Next period"
        onClick={() => setPeriodKey(shiftPeriodKey(periodKey, 1))}
      >
        ›
      </button>
    </div>
  );
}
