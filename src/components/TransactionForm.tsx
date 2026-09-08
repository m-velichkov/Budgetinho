/**
 * Manual transaction entry -- the only way money enters this app.
 *
 * Every transaction is either income or a single categorised expense (single
 * account, no transfers, no splits). Typing a payee suggests payees you have
 * used before and, on picking one, pre-fills the category you last filed it
 * under.
 */

import { useMemo, useRef, useState } from 'react';
import { centsToDecimalString } from '../domain/money';
import { formatPeriodRange, periodForDate } from '../domain/period';
import { today } from '../domain/date';
import { suggestPayees } from '../domain/budget';
import { validateTransactionInput, type FieldErrors, type TransactionField } from '../data/validation';
import { useApp, useDerived } from '../store/hooks';
import { Field, Segmented } from './ui';
import type { Transaction } from '../data/schema';
import type { ValidatedTransaction } from '../data/validation';

export interface TransactionFormProps {
  /** Pre-fill for editing; omit to create. */
  initial?: Transaction;
  submitLabel: string;
  onSubmit: (value: ValidatedTransaction) => void;
  onCancel?: () => void;
}

export function TransactionForm({ initial, submitLabel, onSubmit, onCancel }: TransactionFormProps) {
  const { data } = useApp();
  const { payees } = useDerived();
  const startDay = data.settings.periodStartDay;

  const [kind, setKind] = useState<'expense' | 'income'>(initial?.kind ?? 'expense');
  const [date, setDate] = useState(initial?.date ?? today());
  const [payee, setPayee] = useState(initial?.payee ?? '');
  const [categoryId, setCategoryId] = useState<string>(initial?.categoryId ?? '');
  const [amount, setAmount] = useState(initial ? centsToDecimalString(initial.amount) : '');
  const [memo, setMemo] = useState(initial?.memo ?? '');
  const [errors, setErrors] = useState<FieldErrors<TransactionField>>({});
  const [showSuggestions, setShowSuggestions] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(
    () => (showSuggestions ? suggestPayees(payees, payee) : []),
    [payees, payee, showSuggestions],
  );

  const activeCategories = useMemo(
    () => data.categories.filter((c) => !c.archived),
    [data.categories],
  );

  const groupsWithCategories = useMemo(
    () =>
      data.groups
        .map((g) => ({ group: g, categories: activeCategories.filter((c) => c.groupId === g.id) }))
        .filter((entry) => entry.categories.length > 0),
    [data.groups, activeCategories],
  );

  // Which period will this land in? Shown so a date near a boundary isn't a
  // surprise -- this is the whole point of the custom period.
  const period = useMemo(() => {
    try {
      return periodForDate(date, startDay);
    } catch {
      return null;
    }
  }, [date, startDay]);

  const pickPayee = (name: string, lastCategoryId: string | null) => {
    setPayee(name);
    setShowSuggestions(false);
    if (kind === 'expense' && lastCategoryId && activeCategories.some((c) => c.id === lastCategoryId)) {
      setCategoryId(lastCategoryId);
    }
    amountRef.current?.focus();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = validateTransactionInput(
      { date, payee, categoryId: categoryId || null, amount, kind, memo },
      new Set(activeCategories.map((c) => c.id)),
    );
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    onSubmit(result.value);
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div style={{ marginBottom: 14 }}>
        <Segmented
          label="Transaction type"
          value={kind}
          onChange={(next) => {
            setKind(next);
            if (next === 'income') setCategoryId('');
            setErrors({});
          }}
          options={[
            { value: 'expense', label: 'Expense' },
            { value: 'income', label: 'Income' },
          ]}
        />
      </div>

      <Field label={`Amount${kind === 'income' ? ' received' : ''}`} error={errors.amount}>
        {(id) => (
          <input
            id={id}
            ref={amountRef}
            className={`input amount ${errors.amount ? 'invalid' : ''}`}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        )}
      </Field>

      <Field label={kind === 'income' ? 'Source' : 'Payee'} error={errors.payee}>
        {(id) => (
          <>
            <input
              id={id}
              className={`input ${errors.payee ? 'invalid' : ''}`}
              autoComplete="off"
              placeholder={kind === 'income' ? 'Salary' : 'Where did it go?'}
              value={payee}
              onChange={(e) => {
                setPayee(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              // Delay so a click on a suggestion registers before the list closes.
              onBlur={() => window.setTimeout(() => setShowSuggestions(false), 150)}
            />
            {suggestions.length > 0 ? (
              <ul className="suggestions">
                {suggestions.map((s) => {
                  const category = activeCategories.find((c) => c.id === s.lastCategoryId);
                  return (
                    <li key={s.name}>
                      <button type="button" onMouseDown={() => pickPayee(s.name, s.lastCategoryId)}>
                        <span className="grow">{s.name}</span>
                        {category ? <span className="tiny muted"> · {category.name}</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </>
        )}
      </Field>

      {kind === 'expense' ? (
        <Field label="Category" error={errors.categoryId}>
          {(id) => (
            <select
              id={id}
              className={`select ${errors.categoryId ? 'invalid' : ''}`}
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">Choose a category…</option>
              {groupsWithCategories.map(({ group, categories }) => (
                <optgroup key={group.id} label={group.name}>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
        </Field>
      ) : (
        <p className="small muted" style={{ marginTop: -4, marginBottom: 14 }}>
          Income is not categorised — it lands in this period’s unassigned pool for you to hand out.
        </p>
      )}

      <Field
        label="Date"
        error={errors.date}
        hint={period ? `Falls in the ${formatPeriodRange(period)} period.` : undefined}
      >
        {(id) => (
          <input
            id={id}
            type="date"
            className={`input ${errors.date ? 'invalid' : ''}`}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        )}
      </Field>

      <Field label="Memo (optional)" error={errors.memo}>
        {(id) => (
          <textarea
            id={id}
            className={`textarea ${errors.memo ? 'invalid' : ''}`}
            placeholder="Anything worth remembering"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        )}
      </Field>

      <div className="row" style={{ gap: 8 }}>
        {onCancel ? (
          <button type="button" className="btn grow" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        <button type="submit" className="btn primary grow">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
