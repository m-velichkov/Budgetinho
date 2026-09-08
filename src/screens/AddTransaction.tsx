/** The Add tab: one tap from anywhere via the bottom nav. */

import { useState } from 'react';
import { formatMoney } from '../domain/money';
import { TransactionForm } from '../components/TransactionForm';
import { addTransaction, notify } from '../store/store';
import { useApp, type Route } from '../store/hooks';
import type { Transaction } from '../data/schema';

export function AddTransaction({ navigate }: { navigate: (route: Route) => void }) {
  const { data } = useApp();
  const [last, setLast] = useState<Transaction | null>(null);
  // Remounting the form after a save clears every field without threading
  // reset logic through it.
  const [formKey, setFormKey] = useState(0);

  return (
    <div className="screen">
      <div className="screen-header">
        <h1 className="screen-title">Add a transaction</h1>
      </div>

      <TransactionForm
        key={formKey}
        submitLabel="Save transaction"
        onSubmit={(value) => {
          const saved = addTransaction(value);
          setLast(saved);
          setFormKey((k) => k + 1);
          notify('success', `Saved ${formatMoney(value.amount, data.settings.currency)} for ${value.payee}.`);
        }}
      />

      {last ? (
        <div className="card card-tight" style={{ marginTop: 16 }}>
          <div className="row-between">
            <div className="grow truncate">
              <div className="small">
                Last saved: {last.payee} · {formatMoney(last.amount, data.settings.currency)}
              </div>
              <div className="tiny muted">Add another above, or review everything in Activity.</div>
            </div>
            <button type="button" className="btn small ghost" onClick={() => navigate('transactions')}>
              Activity
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
