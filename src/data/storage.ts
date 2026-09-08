/**
 * localStorage repository -- the persistence layer.
 *
 * Everything goes through here so the rest of the app never touches
 * localStorage directly. Reads migrate + validate; writes serialise and guard
 * against quota errors (Safari private mode throws on every write).
 */

import { migrate } from './migrations';
import { parseState } from './validation';
import { emptyState, nowStamp, STORAGE_KEY, type BudgetState, type Settings } from './schema';

export interface LoadResult {
  state: BudgetState;
  /** True when nothing was stored yet -- the caller seeds a starter budget. */
  isFirstRun: boolean;
  notices: string[];
}

function storage(): Storage | null {
  try {
    // Accessing localStorage throws in some privacy modes; probe once.
    const s = window.localStorage;
    const probe = '__budgetinho_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function isStorageAvailable(): boolean {
  return storage() !== null;
}

export function loadState(): LoadResult {
  const s = storage();
  if (!s) {
    return {
      state: emptyState(),
      isFirstRun: true,
      notices: ['This browser is blocking local storage, so changes will be lost when you close the tab.'],
    };
  }

  const rawText = s.getItem(STORAGE_KEY);
  if (!rawText) return { state: emptyState(), isFirstRun: true, notices: [] };

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    // Corrupt payload: keep a copy so nothing is silently destroyed.
    try {
      s.setItem(`${STORAGE_KEY}.corrupt.${Date.now()}`, rawText);
    } catch {
      /* best effort */
    }
    return {
      state: emptyState(),
      isFirstRun: true,
      notices: ['Saved data could not be read. A backup copy was kept and a fresh budget was started.'],
    };
  }

  const migrated = migrate(parsedJson);
  const { state, repairs } = parseState(migrated.doc);
  const notices = [...migrated.applied.map((a) => `Upgraded stored data (${a})`), ...repairs];
  if (migrated.fromFuture) {
    notices.push('This data was saved by a newer version of the app. Update this device before making changes.');
  }
  return { state, isFirstRun: false, notices };
}

export type SaveResult = { ok: true } | { ok: false; error: string };

export function saveState(state: BudgetState): SaveResult {
  const s = storage();
  if (!s) return { ok: false, error: 'Local storage is unavailable in this browser.' };
  try {
    s.setItem(STORAGE_KEY, JSON.stringify(state));
    return { ok: true };
  } catch (err) {
    const quotaExceeded =
      err instanceof DOMException && (err.name === 'QuotaExceededError' || err.code === 22);
    return {
      ok: false,
      error: quotaExceeded
        ? 'Device storage is full. Export to the Gist, then delete old transactions.'
        : 'Could not save to this device.',
    };
  }
}

/** Serialise for export. Credentials are stripped -- the Gist is shared. */
export function toExportDocument(state: BudgetState): BudgetState {
  const settings: Settings = {
    ...state.settings,
    gist: {
      ...state.settings.gist,
      token: '',
      gistId: '',
      lastSyncedAt: null,
      lastSyncedGistUpdatedAt: null,
    },
  };
  return { ...state, settings, updatedAt: nowStamp() };
}

export function serialise(state: BudgetState): string {
  return JSON.stringify(toExportDocument(state), null, 2);
}

/**
 * Parse an incoming document (Gist pull or file import) into state, keeping this
 * device's own gist credentials and reporting anything that had to be repaired.
 */
export function deserialise(text: string, current: BudgetState): { state: BudgetState; notices: string[] } {
  const parsedJson: unknown = JSON.parse(text);
  const migrated = migrate(parsedJson);
  const { state, repairs } = parseState(migrated.doc, { keepLocalGistSettings: current.settings });
  const notices = [...migrated.applied.map((a) => `Upgraded imported data (${a})`), ...repairs];
  if (migrated.fromFuture) {
    notices.push('That file came from a newer version of the app; some fields may have been dropped.');
  }
  return { state, notices };
}

export function clearState(): void {
  storage()?.removeItem(STORAGE_KEY);
}
