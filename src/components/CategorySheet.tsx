/**
 * Tapping a category card opens this sheet: assign money to it for the visible
 * period, set a goal, and see what has been spent from it. This is where
 * budgeting (as opposed to spending) actually happens.
 *
 * Nothing here writes on blur or on keystroke -- every change needs an explicit
 * Save, and the button stays disabled until something has actually changed.
 */

import { useMemo, useState } from 'react';
import { formatMoney, parseAmount, centsToDecimalString } from '../domain/money';
import { formatPeriodRange, periodFromKey, type PeriodKey } from '../domain/period';
import { formatShort } from '../domain/date';
import { validateGoalInput } from '../data/validation';
import { setAssignment, setCategoryGoal } from '../store/store';
import { useApp } from '../store/hooks';
import { Field, Modal, Segmented } from './ui';
import type { CategoryView } from '../domain/budget';
import type { Goal } from '../data/schema';

export function CategorySheet({
  view,
  periodKey,
  currency,
  onClose,
}: {
  view: CategoryView;
  periodKey: PeriodKey;
  currency: string;
  onClose: () => void;
}) {
  const { data } = useApp();
  const period = periodFromKey(periodKey, data.settings.periodStartDay);

  const assignedText = view.assigned ? centsToDecimalString(view.assigned) : '';
  const [amount, setAmount] = useState(assignedText);
  const [amountError, setAmountError] = useState<string | undefined>();

  const [goalType, setGoalType] = useState<Goal['type']>(view.category.goal?.type ?? 'per_period');
  const [goalAmount, setGoalAmount] = useState(() =>
    view.category.goal ? centsToDecimalString(view.category.goal.amount) : '',
  );
  const [goalDate, setGoalDate] = useState(view.category.goal?.targetDate ?? '');
  const [goalErrors, setGoalErrors] = useState<{ amount?: string; targetDate?: string }>({});
  const [showGoal, setShowGoal] = useState(Boolean(view.category.goal));

  const amountDirty = amount.trim() !== assignedText;

  const recent = useMemo(
    () =>
      data.transactions
        .filter((t) => t.categoryId === view.category.id && t.date >= period.start && t.date <= period.end)
        .slice(0, 8),
    [data.transactions, view.category.id, period.start, period.end],
  );

  const saveAssignment = () => {
    const cents = amount.trim() === '' ? 0 : parseAmount(amount);
    if (cents === null) {
      setAmountError('Enter a number, or leave it empty for zero.');
      return;
    }
    if (cents < 0) {
      setAmountError('Assigned amounts cannot be negative.');
      return;
    }
    setAmountError(undefined);
    setAssignment(periodKey, view.category.id, cents);
  };

  /** Quick actions stage a value in the field; Save still commits it. */
  const stage = (cents: number) => {
    setAmount(centsToDecimalString(cents));
    setAmountError(undefined);
  };

  const saveGoal = () => {
    const result = validateGoalInput(goalType, goalAmount, goalDate);
    if (!result.ok) {
      setGoalErrors(result.errors);
      return;
    }
    setGoalErrors({});
    setCategoryGoal(view.category.id, result.value);
  };

  const removeGoal = () => {
    setCategoryGoal(view.category.id, undefined);
    setShowGoal(false);
    setGoalAmount('');
    setGoalDate('');
  };

  return (
    <Modal title={view.category.name} subtitle={formatPeriodRange(period)} onClose={onClose}>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row-between small">
          <span className="muted">Carried in</span>
          <span className="num">{formatMoney(view.carryover, currency, { signed: true })}</span>
        </div>
        <div className="row-between small">
          <span className="muted">Assigned this period</span>
          <span className="num">{formatMoney(view.assigned, currency)}</span>
        </div>
        <div className="row-between small">
          <span className="muted">Spent this period</span>
          <span className="num">{formatMoney(-view.activity, currency)}</span>
        </div>
        <div className="divider" style={{ margin: '10px 0' }} />
        <div className="row-between">
          <strong>Available</strong>
          <strong className={`num ${view.balance < 0 ? 'neg' : 'pos'}`}>
            {formatMoney(view.balance, currency)}
          </strong>
        </div>
      </div>

      <Field label={`Assign for ${formatPeriodRange(period)}`} error={amountError}>
        {(id) => (
          <input
            id={id}
            className={`input num ${amountError ? 'invalid' : ''}`}
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        )}
      </Field>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {view.balance < 0 ? (
          <button type="button" className="btn small" onClick={() => stage(view.assigned - view.balance)}>
            Cover {formatMoney(-view.balance, currency, { compact: true })} overspend
          </button>
        ) : null}
        {view.goal && view.goal.remainingThisPeriod > 0 ? (
          <button
            type="button"
            className="btn small"
            onClick={() => stage(view.assigned + view.goal!.remainingThisPeriod)}
          >
            Fund goal ({formatMoney(view.goal.remainingThisPeriod, currency, { compact: true })})
          </button>
        ) : null}
        {amount.trim() !== '' ? (
          <button type="button" className="btn small ghost" onClick={() => stage(0)}>
            Clear
          </button>
        ) : null}
      </div>

      <button type="button" className="btn primary block" disabled={!amountDirty} onClick={saveAssignment}>
        {amountDirty ? 'Save assignment' : 'Saved'}
      </button>

      <div className="divider" />

      <div className="row-between" style={{ marginBottom: 10 }}>
        <strong className="small">Goal</strong>
        {showGoal || view.category.goal ? (
          <button type="button" className="btn small ghost" onClick={removeGoal}>
            Remove
          </button>
        ) : (
          <button type="button" className="btn small" onClick={() => setShowGoal(true)}>
            Add a goal
          </button>
        )}
      </div>

      {showGoal ? (
        <>
          <div style={{ marginBottom: 12 }}>
            <Segmented
              label="Goal type"
              value={goalType}
              onChange={setGoalType}
              options={[
                { value: 'per_period', label: 'Every period' },
                { value: 'target_by_date', label: 'By a date' },
              ]}
            />
          </div>

          <Field
            label={goalType === 'per_period' ? 'Amount to assign each period' : 'Total to save'}
            error={goalErrors.amount}
          >
            {(id) => (
              <input
                id={id}
                className={`input num ${goalErrors.amount ? 'invalid' : ''}`}
                inputMode="decimal"
                placeholder="0.00"
                value={goalAmount}
                onChange={(e) => setGoalAmount(e.target.value)}
              />
            )}
          </Field>

          {goalType === 'target_by_date' ? (
            <Field label="Reach it by" error={goalErrors.targetDate}>
              {(id) => (
                <input
                  id={id}
                  type="date"
                  className={`input ${goalErrors.targetDate ? 'invalid' : ''}`}
                  value={goalDate}
                  onChange={(e) => setGoalDate(e.target.value)}
                />
              )}
            </Field>
          ) : null}

          <button type="button" className="btn block" onClick={saveGoal}>
            Save goal
          </button>

          {view.goal ? (
            <p className="small muted" style={{ marginTop: 10 }}>
              {view.goal.overdue
                ? `Target date has passed; ${formatMoney(view.goal.remainingThisPeriod, currency)} short.`
                : view.goal.remainingThisPeriod > 0
                  ? `Assign ${formatMoney(view.goal.remainingThisPeriod, currency)} this period${
                      view.goal.periodsLeft ? ` (${view.goal.periodsLeft} period(s) left)` : ''
                    }.`
                  : 'Fully funded for this period.'}
            </p>
          ) : null}
        </>
      ) : null}

      <div className="divider" />

      <strong className="small">This period’s activity</strong>
      {recent.length === 0 ? (
        <p className="small muted">Nothing spent from this category yet.</p>
      ) : (
        <div className="list" style={{ marginTop: 8 }}>
          {recent.map((t) => (
            <div key={t.id} className="list-row">
              <div className="grow truncate">
                <div className="small">{t.payee}</div>
                <div className="tiny muted">{formatShort(t.date)}</div>
              </div>
              <div className="num small">{formatMoney(-t.amount, currency)}</div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
