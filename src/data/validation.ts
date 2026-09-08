/**
 * Validation lives at two boundaries:
 *
 * 1. Form input -> `validateTransactionInput` / `validateCategoryInput` etc.
 *    return field-level errors for the UI.
 * 2. Untrusted documents -> `parseState` repairs and validates a whole JSON
 *    document coming out of localStorage or off the shared Gist. The Gist is
 *    edited by a second person (and is hand-editable on github.com), so it is
 *    treated as hostile input: anything malformed is dropped or defaulted
 *    rather than allowed to crash the app on boot.
 */

import { isISODate, type ISODate } from '../domain/date';
import { parseAmount, type Cents } from '../domain/money';
import { clampStartDay } from '../domain/period';
import {
  defaultGistSettings,
  defaultSettings,
  emptyState,
  nowStamp,
  NEAR_LIMIT_THRESHOLD,
  SCHEMA_VERSION,
  type Assignments,
  type BudgetState,
  type Category,
  type CategoryGroup,
  type Goal,
  type Settings,
  type Transaction,
} from './schema';

export type FieldErrors<T extends string = string> = Partial<Record<T, string>>;

export class ValidationError extends Error {
  readonly fields: FieldErrors;
  constructor(message: string, fields: FieldErrors = {}) {
    super(message);
    this.name = 'ValidationError';
    this.fields = fields;
  }
}

export const MAX_NAME_LENGTH = 60;
export const MAX_MEMO_LENGTH = 280;
/** ~10 million major units. Guards against a fat-fingered paste, not real budgets. */
export const MAX_AMOUNT_CENTS = 1_000_000_000;

// ---------------------------------------------------------------------------
// Form input validation
// ---------------------------------------------------------------------------

export interface TransactionInput {
  date: string;
  payee: string;
  categoryId: string | null;
  amount: string;
  kind: 'expense' | 'income';
  memo?: string;
}

export type TransactionField = 'date' | 'payee' | 'categoryId' | 'amount' | 'memo';

export interface ValidatedTransaction {
  date: ISODate;
  payee: string;
  categoryId: string | null;
  amount: Cents;
  kind: 'expense' | 'income';
  memo: string;
}

export function validateTransactionInput(
  input: TransactionInput,
  knownCategoryIds: ReadonlySet<string>,
): { ok: true; value: ValidatedTransaction } | { ok: false; errors: FieldErrors<TransactionField> } {
  const errors: FieldErrors<TransactionField> = {};

  if (!isISODate(input.date)) errors.date = 'Pick a valid date.';

  const payee = input.payee.trim();
  if (!payee) errors.payee = 'Who was it?';
  else if (payee.length > MAX_NAME_LENGTH) errors.payee = `Keep it under ${MAX_NAME_LENGTH} characters.`;

  const cents = parseAmount(input.amount);
  if (cents === null) errors.amount = 'Enter an amount.';
  else if (cents === 0) errors.amount = 'Amount must not be zero.';
  else if (Math.abs(cents) > MAX_AMOUNT_CENTS) errors.amount = 'That amount looks too large.';

  // Income is never categorised -- it funds the unassigned pool (single-account
  // model, no transfers). Expenses must name a category that still exists.
  let categoryId: string | null = null;
  if (input.kind === 'expense') {
    if (!input.categoryId) errors.categoryId = 'Choose a category.';
    else if (!knownCategoryIds.has(input.categoryId)) errors.categoryId = 'That category no longer exists.';
    else categoryId = input.categoryId;
  }

  const memo = (input.memo ?? '').trim();
  if (memo.length > MAX_MEMO_LENGTH) errors.memo = `Keep the memo under ${MAX_MEMO_LENGTH} characters.`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      date: input.date,
      payee,
      categoryId,
      // Sign is carried by `kind`; a user typing "-20" for an expense means 20 out.
      amount: Math.abs(cents!),
      kind: input.kind,
      memo,
    },
  };
}

export function validateName(name: string, label = 'Name'): string {
  const trimmed = name.trim();
  if (!trimmed) throw new ValidationError(`${label} is required.`, { name: `${label} is required.` });
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new ValidationError(`${label} is too long.`, { name: `Keep it under ${MAX_NAME_LENGTH} characters.` });
  }
  return trimmed;
}

export function validateGoalInput(
  type: Goal['type'],
  amountInput: string,
  targetDate?: string,
): { ok: true; value: Goal } | { ok: false; errors: FieldErrors<'amount' | 'targetDate'> } {
  const errors: FieldErrors<'amount' | 'targetDate'> = {};
  const amount = parseAmount(amountInput);

  if (amount === null || amount <= 0) errors.amount = 'Enter an amount greater than zero.';
  else if (amount > MAX_AMOUNT_CENTS) errors.amount = 'That amount looks too large.';

  if (type === 'target_by_date') {
    if (!targetDate || !isISODate(targetDate)) errors.targetDate = 'Pick a target date.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const goal: Goal = { type, amount: amount! };
  if (type === 'target_by_date') goal.targetDate = targetDate!;
  return { ok: true, value: goal };
}

// ---------------------------------------------------------------------------
// Document validation (localStorage / Gist)
// ---------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

const int = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
};

const bool = (v: unknown, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback);

function parseGoal(raw: unknown): Goal | undefined {
  if (!isObject(raw)) return undefined;
  const type = raw.type === 'target_by_date' || raw.type === 'per_period' ? raw.type : null;
  if (!type) return undefined;
  const amount = int(raw.amount, 0);
  if (amount <= 0) return undefined;
  if (type === 'target_by_date') {
    const targetDate = str(raw.targetDate);
    if (!isISODate(targetDate)) return undefined;
    return { type, amount, targetDate };
  }
  return { type, amount };
}

function parseSettings(raw: unknown): Settings {
  const base = defaultSettings();
  if (!isObject(raw)) return base;

  const gistRaw = isObject(raw.gist) ? raw.gist : {};
  const threshold = typeof raw.nearLimitThreshold === 'number' ? raw.nearLimitThreshold : NEAR_LIMIT_THRESHOLD;

  return {
    periodStartDay: clampStartDay(int(raw.periodStartDay, base.periodStartDay)),
    statusBasis: raw.statusBasis === 'assigned' ? 'assigned' : 'available',
    currency: str(raw.currency, base.currency).slice(0, 8) || base.currency,
    // Keep the cutoff inside a sane band so the colour logic can't invert.
    nearLimitThreshold: Math.min(0.99, Math.max(0.1, threshold)),
    gist: {
      ...defaultGistSettings(),
      gistId: str(gistRaw.gistId).trim(),
      fileName: str(gistRaw.fileName, 'budgetinho.json').trim() || 'budgetinho.json',
      token: str(gistRaw.token).trim(),
      lastSyncedGistUpdatedAt: typeof gistRaw.lastSyncedGistUpdatedAt === 'string' ? gistRaw.lastSyncedGistUpdatedAt : null,
      lastSyncedAt: typeof gistRaw.lastSyncedAt === 'string' ? gistRaw.lastSyncedAt : null,
    },
  };
}

/**
 * Parse and repair a whole document. Returns the state plus a list of
 * human-readable repairs, which the import flow shows before committing.
 */
export function parseState(raw: unknown, opts: { keepLocalGistSettings?: Settings } = {}): {
  state: BudgetState;
  repairs: string[];
} {
  const repairs: string[] = [];
  if (!isObject(raw)) {
    return { state: emptyState(), repairs: ['File was not a JSON object; started from an empty budget.'] };
  }

  const settings = parseSettings(raw.settings);
  if (opts.keepLocalGistSettings) {
    // Credentials are per-device. Never let an imported document overwrite the
    // token/gist id this browser is configured with.
    settings.gist = opts.keepLocalGistSettings.gist;
  }

  const groups: CategoryGroup[] = [];
  const groupIds = new Set<string>();
  if (Array.isArray(raw.groups)) {
    for (const g of raw.groups) {
      if (!isObject(g)) continue;
      const id = str(g.id);
      const name = str(g.name).trim();
      if (!id || !name || groupIds.has(id)) continue;
      groupIds.add(id);
      groups.push({ id, name: name.slice(0, MAX_NAME_LENGTH), sortOrder: int(g.sortOrder, groups.length) });
    }
  }

  const categories: Category[] = [];
  const categoryIds = new Set<string>();
  if (Array.isArray(raw.categories)) {
    for (const c of raw.categories) {
      if (!isObject(c)) continue;
      const id = str(c.id);
      const name = str(c.name).trim();
      if (!id || !name || categoryIds.has(id)) continue;
      let groupId = str(c.groupId);
      if (!groupIds.has(groupId)) {
        // Orphaned category: park it in a recovered group rather than lose it.
        const orphanGroup = groups.find((g) => g.id === '__orphans') ?? {
          id: '__orphans',
          name: 'Recovered',
          sortOrder: 9999,
        };
        if (!groupIds.has('__orphans')) {
          groups.push(orphanGroup);
          groupIds.add('__orphans');
          repairs.push('Some categories had no group; moved them into "Recovered".');
        }
        groupId = '__orphans';
      }
      categoryIds.add(id);
      categories.push({
        id,
        groupId,
        name: name.slice(0, MAX_NAME_LENGTH),
        sortOrder: int(c.sortOrder, categories.length),
        archived: bool(c.archived) || undefined,
        goal: parseGoal(c.goal),
        notes: str(c.notes).slice(0, MAX_MEMO_LENGTH) || undefined,
      });
    }
  }

  const transactions: Transaction[] = [];
  const txIds = new Set<string>();
  let droppedTx = 0;
  if (Array.isArray(raw.transactions)) {
    for (const t of raw.transactions) {
      if (!isObject(t)) {
        droppedTx++;
        continue;
      }
      const id = str(t.id);
      const date = str(t.date);
      const amount = Math.abs(int(t.amount, 0));
      const kind = t.kind === 'income' ? 'income' : 'expense';
      if (!id || txIds.has(id) || !isISODate(date) || amount <= 0) {
        droppedTx++;
        continue;
      }
      let categoryId = typeof t.categoryId === 'string' ? t.categoryId : null;
      if (kind === 'income') categoryId = null;
      else if (!categoryId || !categoryIds.has(categoryId)) {
        // Keep the money, lose the (missing) category: it shows as Uncategorised
        // and can be re-filed from the transactions list.
        categoryId = null;
      }
      txIds.add(id);
      transactions.push({
        id,
        date,
        payee: str(t.payee, 'Unknown').trim().slice(0, MAX_NAME_LENGTH) || 'Unknown',
        categoryId,
        amount,
        kind,
        memo: str(t.memo).slice(0, MAX_MEMO_LENGTH) || undefined,
        createdAt: str(t.createdAt, nowStamp()),
        updatedAt: str(t.updatedAt, nowStamp()),
      });
    }
  }
  if (droppedTx > 0) repairs.push(`Skipped ${droppedTx} unreadable transaction(s).`);

  const assignments: Assignments = {};
  if (isObject(raw.assignments)) {
    for (const [periodKey, perCategory] of Object.entries(raw.assignments)) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey) || !isObject(perCategory)) continue;
      const bucket: Record<string, number> = {};
      for (const [categoryId, amount] of Object.entries(perCategory)) {
        if (!categoryIds.has(categoryId)) continue;
        const cents = int(amount, 0);
        if (cents !== 0) bucket[categoryId] = cents;
      }
      if (Object.keys(bucket).length > 0) assignments[periodKey] = bucket;
    }
  }

  return {
    state: {
      schemaVersion: SCHEMA_VERSION,
      settings,
      groups: groups.sort((a, b) => a.sortOrder - b.sortOrder),
      categories: categories.sort((a, b) => a.sortOrder - b.sortOrder),
      transactions: transactions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
      assignments,
      updatedAt: str(raw.updatedAt, nowStamp()),
    },
    repairs,
  };
}
