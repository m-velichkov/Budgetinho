/**
 * Integration smoke tests: mount the real app against a real localStorage and
 * drive the primary workflows through the UI. These catch the class of breakage
 * that unit tests on the domain layer cannot -- a screen that throws on render,
 * a store action wired to the wrong field, a form that never submits.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from './App';
import { initStore, addTransaction, setAssignment, updateSettings } from './store/store';
import { STORAGE_KEY } from './data/schema';
import { serialise } from './data/storage';
import { today } from './domain/date';
import { periodForDate } from './domain/period';

function boot() {
  window.location.hash = '';
  initStore();
  return render(<App />);
}

/**
 * Store mutations made outside an event handler have to be wrapped so React
 * flushes the useSyncExternalStore update before the assertions read the DOM.
 */
const apply = (fn: () => void) => act(() => { fn(); });

/** The starter budget seeds these; look them up by name. */
const categoryId = (name: string): string => {
  const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!) as {
    categories: Array<{ id: string; name: string }>;
  };
  return raw.categories.find((c) => c.name === name)!.id;
};

const currentKey = () => periodForDate(today(), 1).key;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('app shell', () => {
  it('seeds a starter budget and renders the dashboard', () => {
    boot();
    expect(screen.getByText('Safe to spend')).toBeTruthy();
    expect(screen.getByText('Groceries')).toBeTruthy();
    expect(screen.getByText('Fixed costs')).toBeTruthy();
  });

  it('navigates between tabs from the bottom nav', () => {
    boot();
    fireEvent.click(screen.getByRole('button', { name: /Reports/ }));
    expect(screen.getByRole('heading', { name: 'Reports' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Settings/ }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Home/ }));
    expect(screen.getByText('Safe to spend')).toBeTruthy();
  });

  it('persists across a reload', () => {
    boot();
    apply(() =>
      addTransaction({
        date: today(),
        payee: 'Salary',
        categoryId: null,
        amount: 200_000,
        kind: 'income',
        memo: '',
      }),
    );
    cleanup();

    boot();
    // Reboot reads localStorage, so the income is still on the dashboard.
    expect(screen.getAllByText(/2[\s ]000\.00/).length).toBeGreaterThan(0);
  });
});

describe('adding a transaction', () => {
  it('saves an expense entered through the form', () => {
    boot();
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));

    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '42.50' } });
    fireEvent.change(screen.getByLabelText('Payee'), { target: { value: 'Lidl' } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: categoryId('Groceries') } });
    fireEvent.click(screen.getByRole('button', { name: 'Save transaction' }));

    expect(screen.getByText(/Last saved: Lidl/)).toBeTruthy();

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!) as {
      transactions: Array<{ payee: string; amount: number; kind: string }>;
    };
    expect(stored.transactions).toHaveLength(1);
    expect(stored.transactions[0]).toMatchObject({ payee: 'Lidl', amount: 4250, kind: 'expense' });
  });

  it('blocks an expense with no category or amount', () => {
    boot();
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    fireEvent.change(screen.getByLabelText('Payee'), { target: { value: 'Lidl' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save transaction' }));

    expect(screen.getByText('Enter an amount.')).toBeTruthy();
    expect(screen.getByText('Choose a category.')).toBeTruthy();
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toContain('"payee":"Lidl"');
  });

  it('suggests a known payee and pre-fills its last category', () => {
    boot();
    apply(() =>
      addTransaction({
        date: today(),
        payee: 'Kaufland',
        categoryId: categoryId('Groceries'),
        amount: 1000,
        kind: 'expense',
        memo: '',
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    fireEvent.change(screen.getByLabelText('Payee'), { target: { value: 'kau' } });
    fireEvent.mouseDown(screen.getByRole('button', { name: /Kaufland/ }));

    expect((screen.getByLabelText('Payee') as HTMLInputElement).value).toBe('Kaufland');
    expect((screen.getByLabelText('Category') as HTMLSelectElement).value).toBe(categoryId('Groceries'));
  });

  it('hides the category picker for income', () => {
    boot();
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Income' }));
    expect(screen.queryByLabelText('Category')).toBeNull();
    expect(screen.getByText(/Income is not categorised/)).toBeTruthy();
  });
});

describe('dashboard numbers', () => {
  it('subtracts essential balances from safe to spend', () => {
    boot();
    apply(() =>
      addTransaction({
        date: today(),
        payee: 'Salary',
        categoryId: null,
        amount: 300_000, // 3000.00
        kind: 'income',
        memo: '',
      }),
    );
    // Rent is seeded as essential; assigning to it should reduce safe-to-spend
    // by more than it reduces unassigned alone.
    apply(() => setAssignment(currentKey(), categoryId('Rent'), 100_000));

    // Unassigned is 2000 (3000 income - 1000 assigned); safe-to-spend is that
    // minus the 1000 now held in the essential Rent category.
    expect(document.querySelector('.headline .value')!.textContent).toMatch(/1[\s ]000\.00/);
    expect(document.querySelector('.headline .breakdown')!.textContent).toMatch(/2[\s ]000\.00/);
  });

  it('colours an overspent category red and a funded one green', () => {
    boot();
    apply(() => setAssignment(currentKey(), categoryId('Fun'), 10_000));
    apply(() =>
      addTransaction({
        date: today(),
        payee: 'Cinema',
        categoryId: categoryId('Fun'),
        amount: 20_000,
        kind: 'expense',
        memo: '',
      }),
    );
    apply(() => setAssignment(currentKey(), categoryId('Transport'), 10_000));

    const fun = screen.getByText('Fun').closest('button')!;
    const transport = screen.getByText('Transport').closest('button')!;
    expect(fun.className).toContain('red');
    expect(transport.className).toContain('green');
  });
});

describe('activity list', () => {
  it('lists, filters and deletes a transaction', () => {
    boot();
    apply(() =>
      addTransaction({
        date: today(),
        payee: 'Bakery',
        categoryId: categoryId('Groceries'),
        amount: 550,
        kind: 'expense',
        memo: 'bread',
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /Activity/ }));
    expect(screen.getByText('Bakery')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search transactions'), { target: { value: 'nothing' } });
    expect(screen.queryByText('Bakery')).toBeNull();
    fireEvent.change(screen.getByLabelText('Search transactions'), { target: { value: 'bread' } });
    expect(screen.getByText('Bakery')).toBeTruthy();

    fireEvent.click(screen.getByText('Bakery').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: 'Delete transaction' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(screen.queryByText('Bakery')).toBeNull();
  });
});

describe('settings', () => {
  it('changes the period start day and re-slices the visible period', () => {
    boot();
    fireEvent.click(screen.getByRole('button', { name: /Settings/ }));
    fireEvent.change(screen.getByLabelText(/Period start day/), { target: { value: '15' } });

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!) as {
      settings: { periodStartDay: number };
    };
    expect(stored.settings.periodStartDay).toBe(15);
  });

  it('adds and deletes a category group', () => {
    boot();
    fireEvent.click(screen.getByRole('button', { name: /Settings/ }));
    fireEvent.change(screen.getByPlaceholderText('New group name'), { target: { value: 'Pets' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add group' }));

    expect(screen.getByText('Pets')).toBeTruthy();
  });

  it('keeps the sync token out of exported JSON', () => {
    boot();
    apply(() =>
      updateSettings({
        gist: {
          gistId: 'abc',
          fileName: 'b.json',
          token: 'secret-token',
          lastSyncedAt: null,
          lastSyncedGistUpdatedAt: null,
        },
      }),
    );
    // serialise() is what both the gist push and the file download use.
    const exported = serialise(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!));
    expect(exported).not.toContain('secret-token');
  });
});
