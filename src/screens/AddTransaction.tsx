/** The Add tab: one tap from anywhere via the bottom nav. */

import { useState } from 'react';
import { TransactionForm } from '../components/TransactionForm';
import { addTransaction } from '../store/store';
import type { Route } from '../store/hooks';

export function AddTransaction({ navigate }: { navigate: (route: Route) => void }) {
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
          addTransaction(value);
          setFormKey((k) => k + 1);
          // Land on Activity so the new entry is visible straight away.
          navigate('transactions');
        }}
      />
    </div>
  );
}
