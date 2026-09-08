/**
 * The application store: one observable snapshot plus the action functions that
 * mutate it. With no server, this module is the app's API surface -- screens
 * call these actions instead of issuing HTTP requests, and everything that
 * touches persistence or GitHub funnels through here.
 *
 * State is immutable: every action builds a new BudgetState, writes it to
 * localStorage, and notifies subscribers (React binds via useSyncExternalStore).
 */

import {
  createGist,
  normaliseGistId,
  pullGist,
  pushGist,
  SyncError,
  verifyToken,
  type GistConfig,
} from '../api/gist';
import {
  buildDashboard,
  buildLedger,
  buildPayeeIndex,
  type DashboardView,
  type Ledger,
  type PayeeSuggestion,
} from '../domain/budget';
import { today, type ISODate } from '../domain/date';
import { clampStartDay, periodForDate, type PeriodKey } from '../domain/period';
import { loadState, saveState, serialise, deserialise } from '../data/storage';
import { seedState } from '../data/seed';
import {
  emptyState,
  newId,
  nowStamp,
  type BudgetState,
  type Category,
  type Goal,
  type Settings,
  type Transaction,
} from '../data/schema';
import type { ValidatedTransaction } from '../data/validation';

export type NoticeKind = 'info' | 'success' | 'error';

export interface Notice {
  id: string;
  kind: NoticeKind;
  text: string;
}

export interface ConflictInfo {
  remoteUpdatedAt: string;
  lastSeenUpdatedAt: string | null;
}

export interface SyncState {
  busy: boolean;
  /** Set when a push was refused because the gist moved under us. */
  conflict: ConflictInfo | null;
  lastError: string | null;
  /**
   * Outcome of the last sync action, shown inline in Settings. Sync is the one
   * place that still needs an explicit "it worked" -- pressing Export with no
   * visible result would be indistinguishable from a no-op.
   */
  lastResult: string | null;
}

export interface AppSnapshot {
  data: BudgetState;
  ready: boolean;
  notices: Notice[];
  sync: SyncState;
  /** Which period the UI is looking at. Defaults to (and follows) today's. */
  periodKey: PeriodKey;
  /** Bumped on every change; used to invalidate derived-value caches. */
  revision: number;
}

let snapshot: AppSnapshot = {
  data: emptyState(),
  ready: false,
  notices: [],
  sync: { busy: false, conflict: null, lastError: null, lastResult: null },
  periodKey: periodForDate(today(), 1).key,
  revision: 0,
};

const listeners = new Set<() => void>();

function emit(next: Partial<AppSnapshot>): void {
  snapshot = { ...snapshot, ...next, revision: snapshot.revision + 1 };
  for (const l of listeners) l();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): AppSnapshot {
  return snapshot;
}

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------

export function notify(kind: NoticeKind, text: string): void {
  const notice: Notice = { id: newId('n'), kind, text };
  emit({ notices: [...snapshot.notices, notice] });
  if (kind !== 'error') {
    setTimeout(() => dismissNotice(notice.id), 4000);
  }
}

export function dismissNotice(id: string): void {
  const notices = snapshot.notices.filter((n) => n.id !== id);
  if (notices.length !== snapshot.notices.length) emit({ notices });
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** Commit a new document: stamp it, persist it, publish it. */
function commit(next: BudgetState, opts: { keepPeriod?: boolean } = {}): void {
  const stamped: BudgetState = { ...next, updatedAt: nowStamp() };
  const result = saveState(stamped);
  if (!result.ok) notify('error', result.error);

  // Changing the period start day re-slices the calendar, so the visible period
  // has to be recomputed from today rather than kept.
  const periodKey = opts.keepPeriod
    ? snapshot.periodKey
    : periodForDate(today(), stamped.settings.periodStartDay).key;

  emit({ data: stamped, periodKey });
}

export function initStore(): void {
  const { state, isFirstRun, notices } = loadState();
  const data = isFirstRun ? seedState() : state;
  if (isFirstRun) saveState(data);

  snapshot = {
    ...snapshot,
    data,
    ready: true,
    periodKey: periodForDate(today(), data.settings.periodStartDay).key,
    revision: snapshot.revision + 1,
  };
  for (const l of listeners) l();

  for (const text of notices) notify('info', text);
}

/**
 * Periods auto-advance: when the calendar crosses the next start day while the
 * app is open (or backgrounded on a phone), snap the view to the new period --
 * but only if the user hadn't deliberately navigated to another period.
 */
export function refreshCurrentPeriod(): void {
  const startDay = snapshot.data.settings.periodStartDay;
  const currentKey = periodForDate(today(), startDay).key;
  if (currentKey !== snapshot.periodKey && snapshot.periodKey < currentKey) {
    emit({ periodKey: currentKey });
  }
}

export function setPeriodKey(key: PeriodKey): void {
  emit({ periodKey: key });
}

export function goToToday(): void {
  emit({ periodKey: periodForDate(today(), snapshot.data.settings.periodStartDay).key });
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export function addTransaction(input: ValidatedTransaction): Transaction {
  const stamp = nowStamp();
  const transaction: Transaction = {
    id: newId('tx'),
    date: input.date,
    payee: input.payee,
    categoryId: input.categoryId,
    amount: input.amount,
    kind: input.kind,
    memo: input.memo || undefined,
    createdAt: stamp,
    updatedAt: stamp,
  };
  // Newest first: the list renders in this order and never has to re-sort.
  const transactions = [transaction, ...snapshot.data.transactions].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt.localeCompare(a.createdAt),
  );
  commit({ ...snapshot.data, transactions }, { keepPeriod: true });
  return transaction;
}

export function updateTransaction(id: string, input: ValidatedTransaction): void {
  const transactions = snapshot.data.transactions
    .map((t) => (t.id === id ? { ...t, ...input, memo: input.memo || undefined, updatedAt: nowStamp() } : t))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt.localeCompare(a.createdAt)));
  commit({ ...snapshot.data, transactions }, { keepPeriod: true });
}

export function deleteTransaction(id: string): void {
  commit(
    { ...snapshot.data, transactions: snapshot.data.transactions.filter((t) => t.id !== id) },
    { keepPeriod: true },
  );
}

// ---------------------------------------------------------------------------
// Assignments (budgeting)
// ---------------------------------------------------------------------------

export function setAssignment(periodKey: PeriodKey, categoryId: string, cents: number): void {
  const assignments = { ...snapshot.data.assignments };
  const bucket = { ...(assignments[periodKey] ?? {}) };
  if (cents === 0) delete bucket[categoryId];
  else bucket[categoryId] = Math.round(cents);

  if (Object.keys(bucket).length === 0) delete assignments[periodKey];
  else assignments[periodKey] = bucket;

  commit({ ...snapshot.data, assignments }, { keepPeriod: true });
}

/** Fill every category that has a goal with what the goal asks for this period. */
export function autoAssignGoals(periodKey: PeriodKey, view: DashboardView): number {
  const assignments = { ...snapshot.data.assignments };
  const bucket = { ...(assignments[periodKey] ?? {}) };
  let touched = 0;

  for (const c of view.categories) {
    if (!c.goal || c.goal.remainingThisPeriod <= 0) continue;
    bucket[c.category.id] = (bucket[c.category.id] ?? 0) + c.goal.remainingThisPeriod;
    touched++;
  }
  if (touched === 0) return 0;

  assignments[periodKey] = bucket;
  commit({ ...snapshot.data, assignments }, { keepPeriod: true });
  return touched;
}

// ---------------------------------------------------------------------------
// Categories and groups
// ---------------------------------------------------------------------------

export function addGroup(name: string): void {
  const sortOrder = Math.max(-1, ...snapshot.data.groups.map((g) => g.sortOrder)) + 1;
  commit(
    { ...snapshot.data, groups: [...snapshot.data.groups, { id: newId('grp'), name, sortOrder }] },
    { keepPeriod: true },
  );
}

export function renameGroup(id: string, name: string): void {
  commit(
    { ...snapshot.data, groups: snapshot.data.groups.map((g) => (g.id === id ? { ...g, name } : g)) },
    { keepPeriod: true },
  );
}

/** Deletes a group and everything in it. History for those categories goes too. */
export function deleteGroup(id: string): void {
  const doomed = new Set(snapshot.data.categories.filter((c) => c.groupId === id).map((c) => c.id));
  commit(
    {
      ...snapshot.data,
      groups: snapshot.data.groups.filter((g) => g.id !== id),
      categories: snapshot.data.categories.filter((c) => c.groupId !== id),
      transactions: snapshot.data.transactions.map((t) =>
        t.categoryId && doomed.has(t.categoryId) ? { ...t, categoryId: null } : t,
      ),
      assignments: stripAssignments(snapshot.data.assignments, doomed),
    },
    { keepPeriod: true },
  );
}

export function addCategory(groupId: string, name: string): void {
  const sortOrder = Math.max(-1, ...snapshot.data.categories.map((c) => c.sortOrder)) + 1;
  commit(
    {
      ...snapshot.data,
      categories: [...snapshot.data.categories, { id: newId('cat'), groupId, name, sortOrder }],
    },
    { keepPeriod: true },
  );
}

export function updateCategory(id: string, patch: Partial<Omit<Category, 'id'>>): void {
  commit(
    { ...snapshot.data, categories: snapshot.data.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)) },
    { keepPeriod: true },
  );
}

export function setCategoryGoal(id: string, goal: Goal | undefined): void {
  commit(
    {
      ...snapshot.data,
      categories: snapshot.data.categories.map((c) => (c.id === id ? { ...c, goal } : c)),
    },
    { keepPeriod: true },
  );
}

/**
 * Deleting a category keeps its transactions (they become uncategorised) so the
 * money never silently vanishes from reports. Archiving is the softer option
 * and is what the UI recommends.
 */
export function deleteCategory(id: string): void {
  commit(
    {
      ...snapshot.data,
      categories: snapshot.data.categories.filter((c) => c.id !== id),
      transactions: snapshot.data.transactions.map((t) => (t.categoryId === id ? { ...t, categoryId: null } : t)),
      assignments: stripAssignments(snapshot.data.assignments, new Set([id])),
    },
    { keepPeriod: true },
  );
}

function stripAssignments(assignments: BudgetState['assignments'], ids: ReadonlySet<string>) {
  const next: BudgetState['assignments'] = {};
  for (const [periodKey, bucket] of Object.entries(assignments)) {
    const kept = Object.fromEntries(Object.entries(bucket).filter(([categoryId]) => !ids.has(categoryId)));
    if (Object.keys(kept).length > 0) next[periodKey] = kept;
  }
  return next;
}

export function moveCategory(id: string, direction: -1 | 1): void {
  const categories = [...snapshot.data.categories].sort((a, b) => a.sortOrder - b.sortOrder);
  const index = categories.findIndex((c) => c.id === id);
  if (index === -1) return;
  const target = index + direction;
  const current = categories[index]!;
  const neighbour = categories[target];
  // Only swap within the same group; moving between groups is done by editing.
  if (!neighbour || neighbour.groupId !== current.groupId) return;
  categories[index] = neighbour;
  categories[target] = current;
  commit({ ...snapshot.data, categories: categories.map((c, i) => ({ ...c, sortOrder: i })) }, { keepPeriod: true });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function updateSettings(patch: Partial<Settings>): void {
  const settings: Settings = { ...snapshot.data.settings, ...patch };
  if (patch.periodStartDay !== undefined) settings.periodStartDay = clampStartDay(patch.periodStartDay);
  // Period start day changes re-slice everything, so let commit() re-derive the
  // visible period rather than keeping a key that may no longer contain today.
  commit({ ...snapshot.data, settings }, { keepPeriod: patch.periodStartDay === undefined });
}

export function updateGistSettings(patch: Partial<Settings['gist']>): void {
  const gist = { ...snapshot.data.settings.gist, ...patch };
  if (patch.gistId !== undefined) gist.gistId = normaliseGistId(patch.gistId);
  commit({ ...snapshot.data, settings: { ...snapshot.data.settings, gist } }, { keepPeriod: true });
}

export function resetEverything(): void {
  // Keep the sync credentials: wiping them makes recovery from the gist harder
  // at exactly the moment the user needs it.
  const fresh = seedState(snapshot.data.settings.periodStartDay);
  fresh.settings = { ...fresh.settings, ...snapshot.data.settings };
  commit(fresh);
}

// ---------------------------------------------------------------------------
// Sync: export / import
// ---------------------------------------------------------------------------

function gistConfig(): GistConfig {
  const { gistId, fileName, token } = snapshot.data.settings.gist;
  return { gistId, fileName, token };
}

function setSync(patch: Partial<SyncState>): void {
  emit({ sync: { ...snapshot.sync, ...patch } });
}

function describeSyncError(err: unknown): string {
  if (err instanceof SyncError) return err.message;
  if (err instanceof SyntaxError) return 'The gist does not contain valid JSON.';
  return err instanceof Error ? err.message : 'Something went wrong.';
}

function recordSyncSuccess(updatedAt: string, extra: Partial<BudgetState> = {}): void {
  const settings: Settings = {
    ...snapshot.data.settings,
    gist: {
      ...snapshot.data.settings.gist,
      lastSyncedGistUpdatedAt: updatedAt,
      lastSyncedAt: nowStamp(),
    },
  };
  commit({ ...snapshot.data, ...extra, settings }, { keepPeriod: true });
}

/** Push local state to the shared gist. Refuses on conflict unless forced. */
export async function pushToGist(force = false): Promise<boolean> {
  setSync({ busy: true, lastError: null, conflict: null, lastResult: null });
  try {
    const snap = await pushGist(gistConfig(), serialise(snapshot.data), {
      lastSeenUpdatedAt: snapshot.data.settings.gist.lastSyncedGistUpdatedAt,
      force,
    });
    recordSyncSuccess(snap.updatedAt);
    setSync({ busy: false, lastResult: 'Exported to the shared gist.' });
    return true;
  } catch (err) {
    if (err instanceof SyncError && err.code === 'conflict') {
      setSync({
        busy: false,
        conflict: {
          remoteUpdatedAt: err.remoteUpdatedAt ?? '',
          lastSeenUpdatedAt: err.lastSeenUpdatedAt ?? null,
        },
      });
      return false;
    }
    const message = describeSyncError(err);
    setSync({ busy: false, lastError: message });
    notify('error', message);
    return false;
  }
}

/** Pull the shared gist and replace local state with it. */
export async function pullFromGist(): Promise<boolean> {
  setSync({ busy: true, lastError: null, conflict: null, lastResult: null });
  try {
    const snap = await pullGist(gistConfig());
    const { state, notices } = deserialise(snap.content, snapshot.data);
    recordSyncSuccess(snap.updatedAt, {
      groups: state.groups,
      categories: state.categories,
      transactions: state.transactions,
      assignments: state.assignments,
      settings: {
        ...state.settings,
        // Sync credentials stay device-local.
        gist: snapshot.data.settings.gist,
      },
    });
    setSync({ busy: false, lastResult: 'Pulled the latest budget from the gist.' });
    for (const n of notices) notify('info', n);
    return true;
  } catch (err) {
    const message = describeSyncError(err);
    setSync({ busy: false, lastError: message });
    notify('error', message);
    return false;
  }
}

export async function createSharedGist(): Promise<boolean> {
  setSync({ busy: true, lastError: null, conflict: null, lastResult: null });
  try {
    const { gistId, snapshot: snap } = await createGist(
      { token: snapshot.data.settings.gist.token, fileName: snapshot.data.settings.gist.fileName },
      serialise(snapshot.data),
    );
    const settings: Settings = {
      ...snapshot.data.settings,
      gist: {
        ...snapshot.data.settings.gist,
        gistId,
        lastSyncedGistUpdatedAt: snap.updatedAt,
        lastSyncedAt: nowStamp(),
      },
    };
    commit({ ...snapshot.data, settings }, { keepPeriod: true });
    setSync({ busy: false, lastResult: 'Created a secret gist and pushed your budget to it.' });
    return true;
  } catch (err) {
    const message = describeSyncError(err);
    setSync({ busy: false, lastError: message });
    notify('error', message);
    return false;
  }
}

export async function checkToken(): Promise<void> {
  setSync({ busy: true, lastError: null, lastResult: null });
  try {
    const { login } = await verifyToken(snapshot.data.settings.gist.token);
    setSync({ busy: false, lastResult: `Token works. Signed in as ${login}.` });
  } catch (err) {
    const message = describeSyncError(err);
    setSync({ busy: false, lastError: message });
    notify('error', message);
  }
}

export function dismissConflict(): void {
  setSync({ conflict: null });
}

// --- file-based backup (works with no token at all) ------------------------

export function exportToFile(): void {
  const blob = new Blob([serialise(snapshot.data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `budgetinho-${today()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function importFromText(text: string): boolean {
  try {
    const { state, notices } = deserialise(text, snapshot.data);
    commit({
      ...state,
      settings: { ...state.settings, gist: snapshot.data.settings.gist },
    });
    for (const n of notices) notify('info', n);
    return true;
  } catch (err) {
    notify('error', err instanceof SyntaxError ? 'That file is not valid JSON.' : describeSyncError(err));
    return false;
  }
}

// ---------------------------------------------------------------------------
// Derived data (memoised on revision + period)
// ---------------------------------------------------------------------------

interface DerivedCache {
  revision: number;
  periodKey: PeriodKey;
  asOf: ISODate;
  ledger: Ledger;
  dashboard: DashboardView;
  payees: PayeeSuggestion[];
}

let cache: DerivedCache | null = null;

/**
 * The ledger has to walk every period from the first with data, so it is
 * recomputed only when the document or the selected period actually changes.
 */
export function getDerived(): DerivedCache {
  const asOf = today();
  if (
    cache &&
    cache.revision === snapshot.revision &&
    cache.periodKey === snapshot.periodKey &&
    cache.asOf === asOf
  ) {
    return cache;
  }

  const { data, periodKey } = snapshot;
  const currentKey = periodForDate(asOf, data.settings.periodStartDay).key;
  // Always build through the later of "today" and "what we're looking at" so
  // reports can look back from either.
  const ledger = buildLedger(data, periodKey > currentKey ? periodKey : currentKey);
  cache = {
    revision: snapshot.revision,
    periodKey,
    asOf,
    ledger,
    dashboard: buildDashboard(data, periodKey, ledger, { asOf, statusBasis: data.settings.statusBasis }),
    payees: buildPayeeIndex(data.transactions),
  };
  return cache;
}
