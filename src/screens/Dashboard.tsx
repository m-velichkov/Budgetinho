/**
 * Home screen (dashboard-first, per the spec): safe-to-spend up top, then the
 * period's assigned/unassigned numbers, then every category as a tinted card.
 */

import { useState } from 'react';
import { formatMoney } from '../domain/money';
import { CategoryCard } from '../components/CategoryCard';
import { CategorySheet } from '../components/CategorySheet';
import { EmptyState } from '../components/ui';
import { autoAssignGoals, notify } from '../store/store';
import { useApp, useDerived, type Route } from '../store/hooks';

const PACE_COPY: Record<string, string> = {
  over: 'Spending is ahead of the calendar',
  under: 'Spending is behind the calendar',
  on: 'Spending is tracking the calendar',
  none: 'Assign money to see your pace',
};

export function Dashboard({ navigate }: { navigate: (route: Route) => void }) {
  const { data, periodKey } = useApp();
  const { dashboard } = useDerived();
  const currency = data.settings.currency;
  const [openCategoryId, setOpenCategoryId] = useState<string | null>(null);

  const open = dashboard.categories.find((c) => c.category.id === openCategoryId) ?? null;
  const goalsToFund = dashboard.categories.filter((c) => c.goal && c.goal.remainingThisPeriod > 0).length;

  return (
    <div className="screen">
      {/* Safe to spend: the one "can I afford this right now" number. */}
      <div className="headline">
        <div className="label">Safe to spend</div>
        <div className={`value ${dashboard.safeToSpend < 0 ? 'negative' : ''}`}>
          {formatMoney(dashboard.safeToSpend, currency)}
        </div>
        <div className="small muted">
          Unassigned income minus what is sitting in essential categories.
        </div>
        <div className="breakdown small">
          <div className="grow">
            <div className="muted tiny">Unassigned</div>
            <div className="num">{formatMoney(dashboard.unassigned, currency)}</div>
          </div>
          <div className="grow">
            <div className="muted tiny">Essential held</div>
            <div className="num">{formatMoney(dashboard.essentialCommitted, currency)}</div>
          </div>
        </div>
      </div>

      <div className="row" style={{ gap: 10, marginTop: 12, alignItems: 'stretch' }}>
        <div className="card card-tight grow">
          <div className="tiny muted">Income</div>
          <div className="num">{formatMoney(dashboard.income, currency)}</div>
        </div>
        <div className="card card-tight grow">
          <div className="tiny muted">Assigned</div>
          <div className="num">{formatMoney(dashboard.totalAssigned, currency)}</div>
        </div>
        <div className="card card-tight grow">
          <div className="tiny muted">Spent</div>
          <div className="num">{formatMoney(dashboard.totalActivity, currency)}</div>
        </div>
      </div>

      {/* Pace: informational nudge, never a gate. */}
      <div className="card card-tight" style={{ marginTop: 12 }}>
        <div className="row-between">
          <div className="grow">
            <div className="small">{PACE_COPY[dashboard.overallPace.pace]}</div>
            <div className="tiny muted">
              {Math.round(dashboard.overallPace.elapsed * 100)}% of the period gone ·{' '}
              {Math.round(dashboard.overallPace.spent * 100)}% of funding spent
            </div>
          </div>
          <span className="chip" style={{ background: 'var(--surface-raised)' }}>
            {dashboard.overallPace.pace === 'none' ? '—' : dashboard.overallPace.pace}
          </span>
        </div>
      </div>

      {dashboard.uncategorised > 0 ? (
        <div className="card card-tight" style={{ marginTop: 12 }}>
          <div className="small">
            {formatMoney(dashboard.uncategorised, currency)} spent without a category this period.
          </div>
          <button type="button" className="btn small ghost" onClick={() => navigate('transactions')}>
            Review them
          </button>
        </div>
      ) : null}

      {goalsToFund > 0 ? (
        <button
          type="button"
          className="btn block"
          style={{ marginTop: 12 }}
          onClick={() => {
            const touched = autoAssignGoals(periodKey, dashboard);
            notify('success', `Funded ${touched} goal${touched === 1 ? '' : 's'} for this period.`);
          }}
        >
          Fund {goalsToFund} goal{goalsToFund === 1 ? '' : 's'} for this period
        </button>
      ) : null}

      {dashboard.groups.length === 0 ? (
        <div style={{ marginTop: 16 }}>
          <EmptyState
            title="No categories yet"
            body="Add a few categories in Settings and they will show up here."
            action={
              <button type="button" className="btn primary" onClick={() => navigate('settings')}>
                Open settings
              </button>
            }
          />
        </div>
      ) : (
        dashboard.groups.map((group) => (
          <section key={group.id}>
            <div className="section-title row-between">
              <span>{group.name}</span>
              <span className="num" style={{ textTransform: 'none', letterSpacing: 0 }}>
                {formatMoney(group.balance, currency, { compact: true })}
              </span>
            </div>
            <div className="stack">
              {group.categories.map((c) => (
                <CategoryCard
                  key={c.category.id}
                  view={c}
                  currency={currency}
                  onClick={() => setOpenCategoryId(c.category.id)}
                />
              ))}
            </div>
          </section>
        ))
      )}

      {open ? (
        <CategorySheet
          view={open}
          periodKey={periodKey}
          currency={currency}
          onClose={() => setOpenCategoryId(null)}
        />
      ) : null}
    </div>
  );
}
