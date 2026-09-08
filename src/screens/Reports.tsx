/**
 * Reports. Every bucket is a rolling period -- "last 6 periods", never "last 6
 * months". The window ends at whichever period the app is currently showing, so
 * scrolling back through periods scrolls the reports with it.
 */

import { useMemo, useState } from 'react';
import { formatMoney } from '../domain/money';
import {
  categoryHistory,
  periodTotalsSeries,
  reportWindow,
  spendingByCategory,
} from '../domain/budget';
import { formatPeriodLabel, formatPeriodLabelShort, formatPeriodRange, periodFromKey } from '../domain/period';
import { BarList, ChartTable, GroupedBars, SERIES } from '../components/charts';
import { EmptyState } from '../components/ui';
import { useApp, useDerived } from '../store/hooks';

const WINDOW_OPTIONS = [3, 6, 12];

export function Reports() {
  const { data, periodKey } = useApp();
  const { ledger } = useDerived();
  const currency = data.settings.currency;

  const [windowSize, setWindowSize] = useState(6);
  const [categoryId, setCategoryId] = useState('');
  const [showTable, setShowTable] = useState(false);

  const keys = useMemo(() => reportWindow(periodKey, windowSize), [periodKey, windowSize]);
  const totals = useMemo(() => periodTotalsSeries(ledger, keys), [ledger, keys]);
  const thisPeriodSpend = useMemo(
    () => spendingByCategory(data, ledger, [periodKey]),
    [data, ledger, periodKey],
  );
  const windowSpend = useMemo(() => spendingByCategory(data, ledger, keys), [data, ledger, keys]);

  const history = useMemo(
    () => (categoryId ? categoryHistory(ledger, categoryId, keys) : []),
    [ledger, categoryId, keys],
  );

  const windowTotal = totals.reduce((acc, t) => acc + t.spending, 0);
  const averageSpend = totals.length > 0 ? Math.round(windowTotal / totals.length) : 0;
  const hasData = windowTotal > 0 || totals.some((t) => t.income > 0);

  return (
    <div className="screen">
      <div className="screen-header">
        <h1 className="screen-title">Reports</h1>
        <div className="row" style={{ gap: 4 }}>
          {WINDOW_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              className="btn small"
              aria-pressed={windowSize === n}
              style={
                windowSize === n
                  ? { background: 'var(--surface-raised)', borderColor: 'var(--accent-2)' }
                  : undefined
              }
              onClick={() => setWindowSize(n)}
            >
              {n}p
            </button>
          ))}
        </div>
      </div>

      <p className="small muted" style={{ marginTop: -6 }}>
        Last {windowSize} periods ending {formatPeriodRange(periodFromKey(periodKey, data.settings.periodStartDay))}.
      </p>

      {!hasData ? (
        <EmptyState
          title="Nothing to report yet"
          body="Once you have a period or two of transactions, trends and category breakdowns show up here."
        />
      ) : (
        <>
          {/* Trend across periods: two series, one y-axis. */}
          <section>
            <div className="section-title">Income vs spending by period</div>
            <div className="card">
              <GroupedBars
                points={totals.map((t) => ({
                  key: t.key,
                  label: formatPeriodLabelShort(t.key),
                  a: t.income,
                  b: t.spending,
                }))}
                currency={currency}
                seriesA={{ label: 'Income', color: SERIES.income }}
                seriesB={{ label: 'Spending', color: SERIES.spending }}
              />
              <div className="divider" style={{ margin: '12px 0' }} />
              <div className="row-between small">
                <span className="muted">Average spending per period</span>
                <span className="num">{formatMoney(averageSpend, currency)}</span>
              </div>
              <div className="row-between small">
                <span className="muted">Net across {windowSize} periods</span>
                <span className={`num ${totals.reduce((a, t) => a + t.net, 0) < 0 ? 'neg' : 'pos'}`}>
                  {formatMoney(
                    totals.reduce((a, t) => a + t.net, 0),
                    currency,
                    { signed: true },
                  )}
                </span>
              </div>
              <button
                type="button"
                className="btn small ghost"
                style={{ marginTop: 10 }}
                onClick={() => setShowTable((v) => !v)}
                aria-expanded={showTable}
              >
                {showTable ? 'Hide table' : 'Show as a table'}
              </button>
              {showTable ? (
                <div style={{ marginTop: 10 }}>
                  <ChartTable
                    head={['Period', 'Income', 'Spending', 'Net']}
                    rows={totals.map((t) => [
                      formatPeriodLabel(t.key),
                      formatMoney(t.income, currency, { compact: true }),
                      formatMoney(t.spending, currency, { compact: true }),
                      formatMoney(t.net, currency, { compact: true, signed: true }),
                    ])}
                  />
                </div>
              ) : null}
            </div>
          </section>

          {/* Magnitude across categories: one hue, labels carry identity. */}
          <section>
            <div className="section-title">Spending this period</div>
            <div className="card">
              {thisPeriodSpend.length === 0 ? (
                <p className="small muted" style={{ margin: 0 }}>
                  Nothing spent in this period yet.
                </p>
              ) : (
                <BarList
                  rows={thisPeriodSpend.map((r) => ({
                    id: r.categoryId,
                    label: r.name,
                    sublabel: r.groupName,
                    value: r.amount,
                    share: r.share,
                  }))}
                  currency={currency}
                  onSelect={setCategoryId}
                />
              )}
            </div>
          </section>

          <section>
            <div className="section-title">Spending across {windowSize} periods</div>
            <div className="card">
              {windowSpend.length === 0 ? (
                <p className="small muted" style={{ margin: 0 }}>
                  No spending in this window.
                </p>
              ) : (
                <>
                  <BarList
                    rows={windowSpend.slice(0, 10).map((r) => ({
                      id: r.categoryId,
                      label: r.name,
                      value: r.amount,
                      share: r.share,
                    }))}
                    currency={currency}
                    onSelect={setCategoryId}
                  />
                  {windowSpend.length > 10 ? (
                    <p className="tiny muted" style={{ margin: 0 }}>
                      Showing the top 10 of {windowSpend.length} categories.
                    </p>
                  ) : null}
                </>
              )}
            </div>
          </section>

          {/* Category history over time. */}
          <section>
            <div className="section-title">Category history</div>
            <div className="card">
              <select
                className="select"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                aria-label="Category to chart"
                style={{ marginBottom: 12 }}
              >
                <option value="">Choose a category…</option>
                {data.groups.map((g) => {
                  const members = data.categories.filter((c) => c.groupId === g.id);
                  if (members.length === 0) return null;
                  return (
                    <optgroup key={g.id} label={g.name}>
                      {members.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>

              {categoryId && history.length > 0 ? (
                <>
                  <GroupedBars
                    points={history.map((h) => ({
                      key: h.key,
                      label: formatPeriodLabelShort(h.key),
                      a: h.assigned,
                      b: h.activity,
                    }))}
                    currency={currency}
                    seriesA={{ label: 'Assigned', color: SERIES.assigned }}
                    seriesB={{ label: 'Spent', color: SERIES.spent }}
                  />
                  <div style={{ marginTop: 12 }}>
                    <ChartTable
                      head={['Period', 'Assigned', 'Spent', 'Balance']}
                      rows={history.map((h) => [
                        formatPeriodLabel(h.key),
                        formatMoney(h.assigned, currency, { compact: true }),
                        formatMoney(h.activity, currency, { compact: true }),
                        <span className={h.balance < 0 ? 'neg' : undefined}>
                          {formatMoney(h.balance, currency, { compact: true })}
                        </span>,
                      ])}
                    />
                  </div>
                </>
              ) : (
                <p className="small muted" style={{ margin: 0 }}>
                  Pick a category to see how it has been funded and spent over the last {windowSize} periods.
                </p>
              )}
            </div>
          </section>

        </>
      )}
    </div>
  );
}
