/**
 * Store-level sync flows, with `fetch` stubbed.
 *
 * gist.test.ts pins the HTTP conversation; this pins what the app *does* with
 * it -- which is where a mistake costs real data: clobbering the other person's
 * budget, leaking the token into a shared file, or letting a failed pull wipe
 * what is on this device.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addTransaction,
  checkToken,
  createSharedGist,
  getSnapshot,
  initStore,
  pullFromGist,
  pushToGist,
  updateGistSettings,
} from './store';
import { STORAGE_KEY, type BudgetState } from '../data/schema';
import { today } from '../domain/date';
import { periodForDate } from '../domain/period';

function res(
  body: unknown,
  { status = 200, headers = {} }: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k] ?? null },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

const gistBody = (content: string, updatedAt = '2026-01-01T10:00:00Z') => ({
  id: 'abc123',
  updated_at: updatedAt,
  html_url: 'https://gist.github.com/abc123',
  files: { 'budgetinho.json': { content } },
});

/** A complete budget document as another device would have written it. */
const remoteDocument = (over: Partial<BudgetState> = {}) =>
  JSON.stringify({
    schemaVersion: 2,
    settings: {
      periodStartDay: 20,
      currency: 'EUR',
      statusBasis: 'available',
      nearLimitThreshold: 0.8,
      // A document written by the other phone carries its own (blank) creds.
      gist: { gistId: '', fileName: 'budgetinho.json', token: '', lastSyncedAt: null, lastSyncedGistUpdatedAt: null },
    },
    groups: [{ id: 'g1', name: 'Remote group', sortOrder: 0 }],
    categories: [{ id: 'c1', groupId: 'g1', name: 'Remote category', sortOrder: 0 }],
    transactions: [
      {
        id: 't1',
        date: '2026-01-05',
        payee: 'Partner shop',
        categoryId: 'c1',
        amount: 1234,
        kind: 'expense',
        createdAt: '2026-01-05T00:00:00Z',
        updatedAt: '2026-01-05T00:00:00Z',
      },
    ],
    assignments: { '2026-01': { c1: 5000 } },
    updatedAt: '2026-01-05T00:00:00Z',
    ...over,
  });

let fetchMock: ReturnType<typeof vi.fn>;

const configure = (over: Partial<{ token: string; gistId: string; lastSyncedGistUpdatedAt: string | null }> = {}) =>
  updateGistSettings({
    token: 'ghp_test',
    gistId: 'abc123',
    fileName: 'budgetinho.json',
    lastSyncedGistUpdatedAt: null,
    ...over,
  });

const patchCalls = () =>
  fetchMock.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'PATCH');

beforeEach(() => {
  window.localStorage.clear();
  initStore();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

// ---------------------------------------------------------------------------

describe('pushToGist', () => {
  it('records the sync stamps and reports success inline', async () => {
    configure();
    fetchMock
      .mockResolvedValueOnce(res(gistBody('{}', '2026-01-01T10:00:00Z')))
      .mockResolvedValueOnce(res(gistBody('{}', '2026-01-01T12:00:00Z')));

    expect(await pushToGist()).toBe(true);

    const { data, sync } = getSnapshot();
    expect(data.settings.gist.lastSyncedGistUpdatedAt).toBe('2026-01-01T12:00:00Z');
    expect(data.settings.gist.lastSyncedAt).toBeTruthy();
    expect(sync.lastResult).toMatch(/Exported/);
    expect(sync.lastError).toBeNull();
    expect(sync.busy).toBe(false);
  });

  it('never puts the token or gist id into the pushed payload', async () => {
    configure();
    fetchMock.mockResolvedValue(res(gistBody('{}')));
    await pushToGist();

    const pushed = JSON.parse(patchCalls()[0]![1]!.body as string).files['budgetinho.json'].content;
    expect(pushed).not.toContain('ghp_test');
    expect(pushed).not.toContain('abc123');
    // But the actual budget is in there.
    expect(JSON.parse(pushed).categories.length).toBeGreaterThan(0);
  });

  it('refuses to overwrite when the gist moved, and writes nothing', async () => {
    configure({ lastSyncedGistUpdatedAt: '2026-01-01T10:00:00Z' });
    fetchMock.mockResolvedValueOnce(res(gistBody('{}', '2026-01-02T08:00:00Z')));

    expect(await pushToGist()).toBe(false);

    const { sync } = getSnapshot();
    expect(sync.conflict).toEqual({
      remoteUpdatedAt: '2026-01-02T08:00:00Z',
      lastSeenUpdatedAt: '2026-01-01T10:00:00Z',
    });
    expect(sync.busy).toBe(false);
    // A conflict is not an error banner -- it is a decision for the user.
    expect(sync.lastError).toBeNull();
    expect(patchCalls()).toHaveLength(0);
  });

  it('overwrites when the user explicitly forces it', async () => {
    configure({ lastSyncedGistUpdatedAt: '2026-01-01T10:00:00Z' });
    fetchMock.mockResolvedValueOnce(res(gistBody('{}', '2026-01-02T08:00:00Z')));
    await pushToGist();
    expect(patchCalls()).toHaveLength(0);

    fetchMock.mockResolvedValueOnce(res(gistBody('{}', '2026-01-03T09:00:00Z')));
    expect(await pushToGist(true)).toBe(true);

    expect(patchCalls()).toHaveLength(1);
    const { sync, data } = getSnapshot();
    expect(sync.conflict).toBeNull();
    expect(data.settings.gist.lastSyncedGistUpdatedAt).toBe('2026-01-03T09:00:00Z');
  });

  it('surfaces a rejected token as a readable error', async () => {
    configure();
    fetchMock.mockResolvedValue(res({ message: 'Bad credentials' }, { status: 401 }));

    expect(await pushToGist()).toBe(false);
    const { sync } = getSnapshot();
    expect(sync.lastError).toMatch(/rejected the token/i);
    expect(sync.busy).toBe(false);
  });

  it('surfaces an offline device without losing local data', async () => {
    configure();
    const before = JSON.stringify(getSnapshot().data);
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    expect(await pushToGist()).toBe(false);
    expect(getSnapshot().sync.lastError).toMatch(/Could not reach GitHub/);
    expect(JSON.stringify(getSnapshot().data)).toBe(before);
  });
});

describe('pullFromGist', () => {
  it('replaces the local budget with the remote one', async () => {
    configure();
    fetchMock.mockResolvedValue(res(gistBody(remoteDocument(), '2026-01-06T10:00:00Z')));

    expect(await pullFromGist()).toBe(true);

    const { data, sync } = getSnapshot();
    expect(data.groups.map((g) => g.name)).toEqual(['Remote group']);
    expect(data.categories.map((c) => c.name)).toEqual(['Remote category']);
    expect(data.transactions).toHaveLength(1);
    expect(data.transactions[0]!.payee).toBe('Partner shop');
    expect(data.assignments['2026-01']!.c1).toBe(5000);
    expect(data.settings.periodStartDay).toBe(20);
    expect(data.settings.currency).toBe('EUR');
    expect(sync.lastResult).toMatch(/Pulled/);
    expect(data.settings.gist.lastSyncedGistUpdatedAt).toBe('2026-01-06T10:00:00Z');
  });

  it('adopts a period start day changed on the other phone', async () => {
    // Regression: recordSyncSuccess used to rebuild settings from the LOCAL
    // copy, so a pull silently discarded the other device's start day and the
    // two phones then bucketed transactions into different periods.
    configure();
    expect(getSnapshot().data.settings.periodStartDay).toBe(1);
    fetchMock.mockResolvedValue(res(gistBody(remoteDocument())));

    await pullFromGist();

    expect(getSnapshot().data.settings.periodStartDay).toBe(20);
    // The visible period must be re-derived, not kept from the old slicing.
    expect(getSnapshot().periodKey).toBe(periodForDate(today(), 20).key);
  });

  it('keeps this device credentials, never the ones in the file', async () => {
    configure();
    // A hand-edited gist that (wrongly) carries someone else's credentials.
    const hostile = JSON.parse(remoteDocument());
    hostile.settings.gist = {
      gistId: 'someone-elses-gist',
      fileName: 'evil.json',
      token: 'ghp_stolen',
      lastSyncedAt: '2020-01-01T00:00:00Z',
      lastSyncedGistUpdatedAt: '2020-01-01T00:00:00Z',
    };
    fetchMock.mockResolvedValue(res(gistBody(JSON.stringify(hostile))));

    await pullFromGist();

    const { gist } = getSnapshot().data.settings;
    expect(gist.token).toBe('ghp_test');
    expect(gist.gistId).toBe('abc123');
    expect(gist.fileName).toBe('budgetinho.json');
  });

  it('persists the pulled budget to localStorage', async () => {
    configure();
    fetchMock.mockResolvedValue(res(gistBody(remoteDocument())));
    await pullFromGist();

    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!) as BudgetState;
    expect(saved.categories.map((c) => c.name)).toEqual(['Remote category']);
  });

  it('leaves local data untouched when the gist holds invalid JSON', async () => {
    configure();
    // Give the local device something worth losing first.
    addTransaction({
      date: today(),
      payee: 'Local entry',
      categoryId: null,
      amount: 500,
      kind: 'income',
      memo: '',
    });
    const before = JSON.stringify(getSnapshot().data.transactions);

    fetchMock.mockResolvedValue(res(gistBody('this is not json')));
    expect(await pullFromGist()).toBe(false);

    expect(getSnapshot().sync.lastError).toMatch(/not contain valid JSON|not valid JSON/i);
    expect(JSON.stringify(getSnapshot().data.transactions)).toBe(before);
  });

  it('leaves local data untouched when the file is missing', async () => {
    configure();
    const before = JSON.stringify(getSnapshot().data);
    fetchMock.mockResolvedValue(
      res({ id: 'abc123', updated_at: 'x', html_url: 'u', files: { 'notes.txt': { content: 'hi' } } }),
    );

    expect(await pullFromGist()).toBe(false);
    expect(getSnapshot().sync.lastError).toMatch(/no file called/);
    expect(JSON.stringify(getSnapshot().data)).toBe(before);
  });

  it('repairs a damaged document rather than crashing on it', async () => {
    configure();
    const damaged = JSON.parse(remoteDocument());
    damaged.transactions.push({ id: 'bad', date: 'not-a-date', amount: 10, kind: 'expense' });
    damaged.transactions.push(null);
    damaged.categories.push({ id: 'orphan', groupId: 'missing-group', name: 'Orphan', sortOrder: 9 });
    fetchMock.mockResolvedValue(res(gistBody(JSON.stringify(damaged))));

    expect(await pullFromGist()).toBe(true);

    const { data } = getSnapshot();
    // The two unusable rows are dropped, the good one survives.
    expect(data.transactions.map((t) => t.id)).toEqual(['t1']);
    // The orphaned category is kept, parked in a recovered group.
    expect(data.categories.map((c) => c.name)).toContain('Orphan');
    expect(data.groups.map((g) => g.name)).toContain('Recovered');
  });

  it('migrates a v1 document pushed by a device on an older build', async () => {
    configure();
    const v1 = {
      schemaVersion: 1,
      settings: { periodStartDay: 15, currency: 'lv' },
      groups: [{ id: 'g', name: 'Old group', sortOrder: 0 }],
      categories: [{ id: 'c', groupId: 'g', name: 'Old category', sortOrder: 0, essential: true }],
      transactions: [],
      assignments: {},
    };
    fetchMock.mockResolvedValue(res(gistBody(JSON.stringify(v1))));

    expect(await pullFromGist()).toBe(true);
    const { data } = getSnapshot();
    expect(data.schemaVersion).toBe(2);
    expect(data.categories[0]!.name).toBe('Old category');
    expect(data.categories[0]).not.toHaveProperty('essential');
  });
});

describe('createSharedGist', () => {
  it('stores the new gist id and stamps the sync', async () => {
    updateGistSettings({ token: 'ghp_test', gistId: '', fileName: 'budgetinho.json' });
    fetchMock.mockResolvedValue(res(gistBody('{}', '2026-02-01T00:00:00Z')));

    expect(await createSharedGist()).toBe(true);

    const { data, sync } = getSnapshot();
    expect(data.settings.gist.gistId).toBe('abc123');
    expect(data.settings.gist.lastSyncedGistUpdatedAt).toBe('2026-02-01T00:00:00Z');
    expect(sync.lastResult).toMatch(/Created a secret gist/);
  });

  it('reports a missing token without calling GitHub', async () => {
    updateGistSettings({ token: '', gistId: '' });
    expect(await createSharedGist()).toBe(false);
    expect(getSnapshot().sync.lastError).toMatch(/token/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('checkToken', () => {
  it('reports the signed-in account', async () => {
    configure();
    fetchMock.mockResolvedValue(res({ login: 'm-velichkov' }));
    await checkToken();
    expect(getSnapshot().sync.lastResult).toBe('Token works. Signed in as m-velichkov.');
    expect(getSnapshot().sync.lastError).toBeNull();
  });

  it('reports a bad token', async () => {
    configure({ token: 'nope' });
    fetchMock.mockResolvedValue(res({ message: 'Bad credentials' }, { status: 401 }));
    await checkToken();
    expect(getSnapshot().sync.lastError).toMatch(/rejected the token/i);
    expect(getSnapshot().sync.lastResult).toBeNull();
  });
});
