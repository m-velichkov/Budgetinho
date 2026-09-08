/**
 * The dashboard's core unit: one category as a fully tinted pastel card.
 *
 * The whole surface carries the status colour (green / orange / red) so a long
 * list can be scanned at arm's length. `neutral` categories -- nothing funded,
 * nothing spent -- stay on the dark surface so an untouched budget doesn't look
 * like a bag of sweets.
 */

import { formatMoney } from '../domain/money';
import type { CategoryView } from '../domain/budget';

const PACE_LABEL: Record<string, string> = {
  over: 'Over pace',
  under: 'Under pace',
  on: 'On pace',
  none: '',
};

export function CategoryCard({
  view,
  currency,
  onClick,
}: {
  view: CategoryView;
  currency: string;
  onClick: () => void;
}) {
  const { category, assigned, activity, carryover, balance, status, pace, goal } = view;
  const funded = assigned + carryover;
  // The meter shows what is LEFT, so a category with 47 of 50 still available
  // reads as nearly full and drains as you spend. Equivalent to
  // 1 - activity/funded, clamped for the overspent case.
  const remainingShare = funded > 0 ? Math.max(0, Math.min(1, balance / funded)) : 0;

  // One line of detail, chosen by what's most useful in this state.
  const detail =
    funded > 0
      ? `${formatMoney(activity, currency, { compact: true })} of ${formatMoney(funded, currency, { compact: true })} spent`
      : activity > 0
        ? `${formatMoney(activity, currency, { compact: true })} spent, nothing assigned`
        : 'Nothing assigned yet';

  return (
    <button type="button" className={`cat-card ${status}`} onClick={onClick}>
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <div className="cat-name truncate">{category.name}</div>
          <div className="cat-detail">{detail}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="cat-balance">{formatMoney(balance, currency)}</div>
          <div className="cat-detail tiny">available</div>
        </div>
      </div>

      <div
        className="meter"
        role="img"
        aria-label={`${Math.round(remainingShare * 100)}% of this category's money still available`}
      >
        <span style={{ width: `${Math.round(remainingShare * 100)}%` }} />
      </div>

      {(pace.pace !== 'none' && funded > 0) || goal || carryover !== 0 ? (
        <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          {pace.pace !== 'none' && funded > 0 ? (
            <span className="chip">
              {PACE_LABEL[pace.pace]} · {Math.round(pace.spent * 100)}% spent, {Math.round(pace.elapsed * 100)}%
              of period gone
            </span>
          ) : null}
          {goal ? (
            <span className="chip">
              {goal.remainingThisPeriod > 0
                ? `Goal: assign ${formatMoney(goal.remainingThisPeriod, currency, { compact: true })}${
                    goal.overdue ? ' (overdue)' : ''
                  }`
                : 'Goal funded'}
            </span>
          ) : null}
          {carryover !== 0 ? (
            <span className="chip">
              {carryover > 0 ? 'Carried in ' : 'Overspend carried in '}
              {formatMoney(carryover, currency, { compact: true })}
            </span>
          ) : null}
        </div>
      ) : null}
    </button>
  );
}
