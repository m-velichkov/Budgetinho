/**
 * Integration smoke tests: mount the real app against a real localStorage and
 * drive the primary workflows through the UI. These catch the class of breakage
 * that unit tests on the domain layer cannot -- a screen that throws on render,
 * a store action wired to the wrong field, a form that never submits.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

const stored = () => JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);

/** The starter budget seeds these; look them up by name. */
const categoryId = (name: string): string =>
  (stored().categories as Array<{ id: string; name: string }>).find((c) => c.name === name)!.id;

const currentKey = () => periodForDate(today(), 1).key;

/** Scope a query to the settings card that contains a given field. */
const cardFor = (labelText: RegExp | string): HTMLElement =>
  screen.getByLabelText(labelText).closest('.card') as HTMLElement;

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
    expect(screen.getByText('Unassigned')).toBeTruthy();
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
    expect(screen.getByText('Unassigned')).toBeTruthy();
  });

  it('orders the nav Home, Activity, Add, Reports, Settings', () => {
    boot();
    const labels = [...document.querySelectorAll('.bottom-nav > button')].map(
      // Tabs render an icon glyph followed by the label; strip the glyph.
      (b) => b.getAttribute('aria-label') ?? (b.textContent ?? '').replace(/[^A-Za-z ]/g, ''),
    );
    expect(labels).toEqual(['Home', 'Activity', 'Add a transaction', 'Reports', 'Settings']);
  });

  it('gives the Add button no text label', () => {
    boot();
    const add = screen.getByRole('button', { name: 'Add a transaction' });
    expect(add.className).toContain('nav-add');
    expect(add.textContent).toBe('+');
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
    expect(screen.getAllByText(/2[\s ]000\.00/).length).toBeGreaterThan(0);
  });
});

describe('adding a transaction', () => {
  it('saves an expense and lands on Activity', () => {
    boot();
    fireEvent.click(screen.getByRole('button', { name: 'Add a transaction' }));

    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '42.50' } });
    fireEvent.change(screen.getByLabelText('Payee'), { target: { value: 'Lidl' } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: categoryId('Groceries') } });
    fireEvent.click(screen.getByRole('button', { name: 'Save transaction' }));

    // Requirement: go straight to Activity rather than staying on the form.
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeTruthy();
    expect(screen.getByText('Lidl')).toBeTruthy();

    expect(stored().transactions).toHaveLength(1);
    expect(stored().transactions[0]).toMatchObject({ payee: 'Lidl', amount: 4250, kind: 'expense' });
  });

  it('blocks an expense with no category or amount', () => {
    boot();
    fireEvent.click(screen.getByRole('button', { name: 'Add a transaction' }));
    fireEvent.change(screen.getByLabelText('Payee'), { target: { value: 'Lidl' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save transaction' }));

    expect(screen.getByText('Enter an amount.')).toBeTruthy();
    expect(screen.getByText('Choose a category.')).toBeTruthy();
    // Still on the form, nothing written.
    expect(screen.getByRole('heading', { name: 'Add a transaction' })).toBeTruthy();
    expect(stored().transactions).toHaveLength(0);
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

    fireEvent.click(screen.getByRole('button', { name: 'Add a transaction' }));
    fireEvent.change(screen.getByLabelText('Payee'), { target: { value: 'kau' } });
    fireEvent.mouseDown(screen.getByRole('button', { name: /Kaufland/ }));

    expect((screen.getByLabelText('Payee') as HTMLInputElement).value).toBe('Kaufland');
    expect((screen.getByLabelText('Category') as HTMLSelectElement).value).toBe(categoryId('Groceries'));
  });

  it('hides the category picker for income', () => {
    boot();
    fireEvent.click(screen.getByRole('button', { name: 'Add a transaction' }));
    fireEvent.click(screen.getByRole('button', { name: 'Income' }));
    expect(screen.queryByLabelText('Category')).toBeNull();
    expect(screen.getByText(/Income is not categorised/)).toBeTruthy();
  });
});

describe('dashboard numbers', () => {
  it('shows income not yet assigned as the headline', () => {
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
    apply(() => setAssignment(currentKey(), categoryId('Rent'), 100_000));

    expect(document.querySelector('.headline .label')!.textContent).toBe('Unassigned');
    expect(document.querySelector('.headline .value')!.textContent).toMatch(/2[\s ]000\.00/);
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

    expect(screen.getByText('Fun').closest('button')!.className).toContain('red');
    expect(screen.getByText('Transport').closest('button')!.className).toContain('green');
  });

  it('drains the meter as money is spent rather than filling it', () => {
    boot();
    // 50 assigned, 3 spent -> 47 available -> the bar should read 94% full.
    apply(() => setAssignment(currentKey(), categoryId('Eating out'), 50_00));
    apply(() =>
      addTransaction({
        date: today(),
        payee: 'Cafe',
        categoryId: categoryId('Eating out'),
        amount: 3_00,
        kind: 'expense',
        memo: '',
      }),
    );

    const card = screen.getByText('Eating out').closest('button')!;
    expect((card.querySelector('.meter > span') as HTMLElement).style.width).toBe('94%');

    // An untouched, fully funded category is completely full.
    apply(() => setAssignment(currentKey(), categoryId('Transport'), 20_00));
    const transport = screen.getByText('Transport').closest('button')!;
    expect((transport.querySelector('.meter > span') as HTMLElement).style.width).toBe('100%');
  });

  it('has no trace of the removed essential flag', () => {
    boot();
    expect(screen.queryByText(/essential/i)).toBeNull();
    for (const c of stored().categories as Array<Record<string, unknown>>) {
      expect(c).not.toHaveProperty('essential');
    }
  });
});

describe('explicit save', () => {
  it('does not persist a settings change until Save is pressed', () => {
    boot();
    fireEvent.click(screen.getByRole('button', { name: /Settings/ }));

    fireEvent.change(screen.getByLabelText(/Period start day/), { target: { value: '15' } });
    // Typing alone must not write.
    expect(stored().settings.periodStartDay).toBe(1);

    fireEvent.click(within(cardFor(/Period start day/)).getByRole('button', { name: 'Save' }));
    expect(stored().settings.periodStartDay).toBe(15);
  });

  it('rejects an out-of-range start day instead of saving it', () => {
    boot();
    fireEvent.click(screen.getByRole('button', { name: /Settings/ }));
    fireEvent.change(screen.getByLabelText(/Period start day/), { target: { value: '44' } });
    fireEvent.click(within(cardFor(/Period start day/)).getByRole('button', { name: 'Save' }));

    expect(screen.getByText('Pick a day between 1 and 31.')).toBeTruthy();
    expect(stored().settings.periodStartDay).toBe(1);
  });

  it('shows a disabled Save -- not "Saved" -- on a pristine settings page', () => {
    boot();
    fireEvent.click(screen.getByRole('button', { name: /Settings/ }));
    const card = cardFor(/Period start day/);

    expect(within(card).getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
    expect(within(card).queryByRole('button', { name: 'Saved' })).toBeNull();

    fireEvent.change(screen.getByLabelText(/Period start day/), { target: { value: '9' } });
    expect(within(card).getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(false);
  });

  it('only says "Saved" after an actual save, and reverts when edited again', () => {
    boot();
    fireEvent.click(screen.getByRole('button', { name: /Settings/ }));
    const card = cardFor(/Period start day/);

    fireEvent.change(screen.getByLabelText(/Period start day/), { target: { value: '9' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Save' }));

    expect(within(card).getByRole('button', { name: 'Saved' }).hasAttribute('disabled')).toBe(true);

    // Editing again takes it back to an enabled "Save".
    fireEvent.change(screen.getByLabelText(/Period start day/), { target: { value: '12' } });
    expect(within(card).getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(false);
  });

  it('does not assign money until Save is pressed in the category sheet', () => {
    boot();
    fireEvent.click(screen.getByText('Groceries').closest('button')!);

    fireEvent.change(screen.getByLabelText(/^Assign for/), { target: { value: '120' } });
    expect(stored().assignments).toEqual({});

    fireEvent.click(screen.getByRole('button', { name: 'Save assignment' }));
    expect(stored().assignments[currentKey()][categoryId('Groceries')]).toBe(12_000);
  });

  it('does not rename a category until Save is pressed', () => {
    boot();
    fireEvent.click(screen.getByRole('button', { name: /Settings/ }));

    const row = screen.getByText('Groceries').closest('.list-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));

    fireEvent.change(screen.getByDisplayValue('Groceries'), { target: { value: 'Food shopping' } });
    const names = () => (stored().categories as Array<{ name: string }>).map((c) => c.name);
    expect(names()).not.toContain('Food shopping');

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));
    expect(names()).toContain('Food shopping');
  });
});

describe('no success toasts', () => {
  it('shows no notification after saving a transaction', () => {
    boot();
    fireEvent.click(screen.getByRole('button', { name: 'Add a transaction' }));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Payee'), { target: { value: 'Kiosk' } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: categoryId('Groceries') } });
    fireEvent.click(screen.getByRole('button', { name: 'Save transaction' }));

    expect(document.querySelector('.notices')).toBeNull();
  });

  it('shows no notification after assigning money', () => {
    boot();
    fireEvent.click(screen.getByText('Groceries').closest('button')!);
    fireEvent.change(screen.getByLabelText(/^Assign for/), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save assignment' }));

    expect(document.querySelector('.notices')).toBeNull();
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
  it('adds a category group', () => {
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
    expect(serialise(stored())).not.toContain('secret-token');
  });
});
