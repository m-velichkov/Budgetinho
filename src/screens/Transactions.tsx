/**
 * Activity tab: every transaction in the visible period, grouped by day, with
 * search and a category filter. Tapping a row opens it for editing.
 */

import { useMemo, useState } from 'react';
import { formatMoney } from '../domain/money';
import { formatShort } from '../domain/date';
import { periodFromKey } from '../domain/period';
import { TransactionForm } from '../components/TransactionForm';
import { ConfirmDialog, EmptyState, Modal } from '../components/ui';
import { deleteTransaction, notify, updateTransaction } from '../store/store';
import { useApp, type Route } from '../store/hooks';
import type { Transaction } from '../data/schema';

export function Transactions({ navigate }: { navigate: (route: Route) => void }) {
  const { data, periodKey } = useApp();
  const currency = data.settings.currency;
  const period = periodFromKey(periodKey, data.settings.periodStartDay);

  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [deleting, setDeleting] = useState<Transaction | null>(null);

  const categoryName = useMemo(
    () => new Map(data.categories.map((c) => [c.id, c.name])),
    [data.categories],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.transactions.filter((t) => {
      if (t.date < period.start || t.date > period.end) return false;
      if (categoryFilter === '__income') {
        if (t.kind !== 'income') return false;
      } else if (categoryFilter === '__uncategorised') {
        if (t.kind !== 'expense' || t.categoryId) return false;
      } else if (categoryFilter && t.categoryId !== categoryFilter) {
        return false;
      }
      if (!q) return true;
      const haystack = `${t.payee} ${t.memo ?? ''} ${t.categoryId ? categoryName.get(t.categoryId) ?? '' : ''}`;
      return haystack.toLowerCase().includes(q);
    });
  }, [data.transactions, period.start, period.end, query, categoryFilter, categoryName]);

  // Transactions arrive newest-first from the store, so a simple walk produces
  // day groups already in order.
  const byDay = useMemo(() => {
    const days: Array<{ date: string; items: Transaction[]; total: number }> = [];
    for (const t of visible) {
      let day = days[days.length - 1];
      if (!day || day.date !== t.date) {
        day = { date: t.date, items: [], total: 0 };
        days.push(day);
      }
      day.items.push(t);
      day.total += t.kind === 'income' ? t.amount : -t.amount;
    }
    return days;
  }, [visible]);

  const totals = useMemo(() => {
    let income = 0;
    let spending = 0;
    for (const t of visible) {
      if (t.kind === 'income') income += t.amount;
      else spending += t.amount;
    }
    return { income, spending };
  }, [visible]);

  return (
    <div className="screen">
      <div className="screen-header">
        <h1 className="screen-title">Activity</h1>
        <span className="small muted num">
          {visible.length} item{visible.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="row" style={{ gap: 10, marginBottom: 12, alignItems: 'stretch' }}>
        <div className="card card-tight grow">
          <div className="tiny muted">In</div>
          <div className="num pos">{formatMoney(totals.income, currency, { compact: true })}</div>
        </div>
        <div className="card card-tight grow">
          <div className="tiny muted">Out</div>
          <div className="num">{formatMoney(totals.spending, currency, { compact: true })}</div>
        </div>
        <div className="card card-tight grow">
          <div className="tiny muted">Net</div>
          <div className={`num ${totals.income - totals.spending < 0 ? 'neg' : 'pos'}`}>
            {formatMoney(totals.income - totals.spending, currency, { compact: true, signed: true })}
          </div>
        </div>
      </div>

      <input
        className="input"
        type="search"
        placeholder="Search payee, memo or category"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ marginBottom: 10 }}
        aria-label="Search transactions"
      />

      <select
        className="select"
        value={categoryFilter}
        onChange={(e) => setCategoryFilter(e.target.value)}
        aria-label="Filter by category"
        style={{ marginBottom: 14 }}
      >
        <option value="">All categories</option>
        <option value="__income">Income only</option>
        <option value="__uncategorised">Uncategorised</option>
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

      {byDay.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          body={
            data.transactions.length === 0
              ? 'Add your first transaction and it will show up here.'
              : 'No transactions match this period and filter.'
          }
          action={
            <button type="button" className="btn primary" onClick={() => navigate('add')}>
              Add a transaction
            </button>
          }
        />
      ) : (
        <div className="list">
          {byDay.map((day) => (
            <div key={day.date}>
              <div className="day-heading">
                <span>{formatShort(day.date, true)}</span>
                <span className="num">{formatMoney(day.total, currency, { compact: true, signed: true })}</span>
              </div>
              {day.items.map((t) => (
                <button key={t.id} type="button" className="list-row" onClick={() => setEditing(t)}>
                  <div className="grow truncate">
                    <div className="truncate">{t.payee}</div>
                    <div className="tiny muted truncate">
                      {t.kind === 'income'
                        ? 'Income'
                        : t.categoryId
                          ? categoryName.get(t.categoryId) ?? 'Deleted category'
                          : 'Uncategorised'}
                      {t.memo ? ` · ${t.memo}` : ''}
                    </div>
                  </div>
                  <div className={`num ${t.kind === 'income' ? 'pos' : ''}`}>
                    {formatMoney(t.kind === 'income' ? t.amount : -t.amount, currency)}
                  </div>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {editing ? (
        <Modal
          title="Edit transaction"
          subtitle={`Added ${formatShort(editing.createdAt.slice(0, 10), true)}`}
          onClose={() => setEditing(null)}
        >
          <TransactionForm
            initial={editing}
            submitLabel="Save changes"
            onCancel={() => setEditing(null)}
            onSubmit={(value) => {
              updateTransaction(editing.id, value);
              setEditing(null);
              notify('success', 'Transaction updated.');
            }}
          />
          <div className="divider" />
          <button
            type="button"
            className="btn danger block"
            onClick={() => {
              setDeleting(editing);
              setEditing(null);
            }}
          >
            Delete transaction
          </button>
        </Modal>
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title="Delete this transaction?"
          body={
            <>
              {deleting.payee} · {formatMoney(deleting.amount, currency)} on {formatShort(deleting.date, true)}.
              This cannot be undone.
            </>
          }
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            deleteTransaction(deleting.id);
            setDeleting(null);
            notify('success', 'Transaction deleted.');
          }}
        />
      ) : null}
    </div>
  );
}
