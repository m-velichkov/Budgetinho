/**
 * Tests for the GitHub Gist client with `fetch` stubbed out.
 *
 * This is the only code in the app that talks to a network, and it is the one
 * part that cannot be exercised without live credentials -- so every request it
 * builds and every response it can receive is pinned here instead.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGist,
  fetchRemoteUpdatedAt,
  normaliseGistId,
  pullGist,
  pushGist,
  SyncError,
  verifyToken,
  type GistConfig,
} from './gist';

const CFG: GistConfig = { gistId: 'abc123', fileName: 'budgetinho.json', token: 'ghp_test' };

/** Minimal Response stand-in: only the members the client actually touches. */
function res(
  body: unknown,
  { status = 200, headers = {}, nonJson = false }: { status?: number; headers?: Record<string, string>; nonJson?: boolean } = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k] ?? null },
    json: async () => {
      if (nonJson) throw new SyntaxError('not json');
      return body;
    },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

/** A well-formed gist payload. */
const gistBody = (over: Record<string, unknown> = {}) => ({
  id: 'abc123',
  updated_at: '2026-01-01T10:00:00Z',
  html_url: 'https://gist.github.com/abc123',
  files: { 'budgetinho.json': { content: '{"schemaVersion":2}' } },
  ...over,
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Assert on the (url, init) of a given call. */
const call = (i = 0) => {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
  return { url, init, headers: (init?.headers ?? {}) as Record<string, string> };
};

// ---------------------------------------------------------------------------

describe('request shape', () => {
  it('sends auth, accept and API version headers, and bypasses the cache', async () => {
    fetchMock.mockResolvedValue(res(gistBody()));
    await pullGist(CFG);

    const { url, init, headers } = call();
    expect(url).toBe('https://api.github.com/gists/abc123');
    expect(headers.Authorization).toBe('Bearer ghp_test');
    expect(headers.Accept).toBe('application/vnd.github+json');
    expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28');
    // A cached read would silently "succeed" with yesterday's budget.
    expect(init.cache).toBe('no-store');
  });

  it('url-encodes the gist id', async () => {
    fetchMock.mockResolvedValue(res(gistBody()));
    await fetchRemoteUpdatedAt({ ...CFG, gistId: 'a/b' });
    expect(call().url).toBe('https://api.github.com/gists/a%2Fb');
  });
});

describe('configuration guards', () => {
  it('refuses to act without a token', async () => {
    await expect(pullGist({ ...CFG, token: '' })).rejects.toMatchObject({ code: 'not_configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to act without a gist id', async () => {
    await expect(pullGist({ ...CFG, gistId: '' })).rejects.toMatchObject({ code: 'not_configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lets createGist through with no gist id', async () => {
    fetchMock.mockResolvedValue(res(gistBody()));
    await expect(createGist({ token: 'ghp_test', fileName: 'b.json' }, '{}')).resolves.toBeTruthy();
  });
});

describe('pullGist', () => {
  it('returns the file content, timestamp and url', async () => {
    fetchMock.mockResolvedValue(res(gistBody()));
    const snap = await pullGist(CFG);
    expect(snap).toEqual({
      content: '{"schemaVersion":2}',
      updatedAt: '2026-01-01T10:00:00Z',
      htmlUrl: 'https://gist.github.com/abc123',
    });
  });

  it('names the files it did find when the expected one is missing', async () => {
    fetchMock.mockResolvedValue(res(gistBody({ files: { 'other.json': { content: '{}' } } })));
    await expect(pullGist(CFG)).rejects.toMatchObject({ code: 'file_missing' });
    await expect(pullGist(CFG)).rejects.toThrow(/other\.json/);
  });

  it('follows raw_url when GitHub truncates a large file', async () => {
    fetchMock
      .mockResolvedValueOnce(
        res(
          gistBody({
            files: {
              'budgetinho.json': { truncated: true, raw_url: 'https://gist.githubusercontent.com/raw/x', content: 'CUT' },
            },
          }),
        ),
      )
      .mockResolvedValueOnce({ ok: true, text: async () => '{"schemaVersion":2,"big":true}' } as Response);

    const snap = await pullGist(CFG);
    expect(snap.content).toBe('{"schemaVersion":2,"big":true}');
    expect(fetchMock.mock.calls[1]![0]).toBe('https://gist.githubusercontent.com/raw/x');
  });

  it('fails when the raw download fails', async () => {
    fetchMock
      .mockResolvedValueOnce(
        res(gistBody({ files: { 'budgetinho.json': { truncated: true, raw_url: 'https://x/raw' } } })),
      )
      .mockResolvedValueOnce({ ok: false } as Response);
    await expect(pullGist(CFG)).rejects.toMatchObject({ code: 'server' });
  });

  it('rejects an empty file rather than wiping the budget with it', async () => {
    fetchMock.mockResolvedValue(res(gistBody({ files: { 'budgetinho.json': { content: '   ' } } })));
    await expect(pullGist(CFG)).rejects.toMatchObject({ code: 'invalid_content' });
  });
});

describe('error mapping', () => {
  const cases: Array<[number, string, Record<string, string>]> = [
    [401, 'unauthorized', {}],
    [403, 'rate_limited', { 'X-RateLimit-Remaining': '0' }],
    [403, 'unauthorized', { 'X-RateLimit-Remaining': '57' }],
    [404, 'not_found', {}],
    [422, 'invalid_content', {}],
    [500, 'server', {}],
  ];

  for (const [status, code, headers] of cases) {
    it(`maps HTTP ${status}${headers['X-RateLimit-Remaining'] === '0' ? ' (rate limited)' : ''} to ${code}`, async () => {
      fetchMock.mockResolvedValue(res({ message: 'boom' }, { status, headers }));
      await expect(pullGist(CFG)).rejects.toMatchObject({ code });
    });
  }

  it('survives a non-JSON error body', async () => {
    fetchMock.mockResolvedValue(res('<html>502</html>', { status: 502, nonJson: true }));
    await expect(pullGist(CFG)).rejects.toMatchObject({ code: 'server' });
  });

  it('reports an aborted request as a timeout', async () => {
    fetchMock.mockRejectedValue(new DOMException('aborted', 'AbortError'));
    await expect(pullGist(CFG)).rejects.toMatchObject({ code: 'timeout' });
  });

  it('reports a dropped connection as a network error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(pullGist(CFG)).rejects.toMatchObject({ code: 'network' });
  });

  it('always throws SyncError, never a raw fetch error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(pullGist(CFG)).rejects.toBeInstanceOf(SyncError);
  });
});

describe('pushGist conflict detection', () => {
  it('re-reads updated_at, then PATCHes the file', async () => {
    fetchMock
      .mockResolvedValueOnce(res(gistBody({ updated_at: '2026-01-01T10:00:00Z' })))
      .mockResolvedValueOnce(res(gistBody({ updated_at: '2026-01-01T11:00:00Z' })));

    const snap = await pushGist(CFG, '{"mine":true}', { lastSeenUpdatedAt: '2026-01-01T10:00:00Z' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(call(1).init.method).toBe('PATCH');
    expect(JSON.parse(call(1).init.body as string)).toEqual({
      files: { 'budgetinho.json': { content: '{"mine":true}' } },
    });
    expect(call(1).headers['Content-Type']).toBe('application/json');
    expect(snap.updatedAt).toBe('2026-01-01T11:00:00Z');
  });

  it('refuses and does NOT write when the gist moved since the last sync', async () => {
    fetchMock.mockResolvedValueOnce(res(gistBody({ updated_at: '2026-01-02T09:00:00Z' })));

    await expect(
      pushGist(CFG, '{"mine":true}', { lastSeenUpdatedAt: '2026-01-01T10:00:00Z' }),
    ).rejects.toMatchObject({
      code: 'conflict',
      remoteUpdatedAt: '2026-01-02T09:00:00Z',
      lastSeenUpdatedAt: '2026-01-01T10:00:00Z',
    });

    // The critical assertion: the other person's data was not overwritten.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === 'PATCH')).toBe(false);
  });

  it('allows a first-ever push, which has nothing to compare against', async () => {
    fetchMock
      .mockResolvedValueOnce(res(gistBody({ updated_at: '2026-01-05T00:00:00Z' })))
      .mockResolvedValueOnce(res(gistBody()));
    await expect(pushGist(CFG, '{}', { lastSeenUpdatedAt: null })).resolves.toBeTruthy();
    expect(call(1).init.method).toBe('PATCH');
  });

  it('skips the pre-check entirely when forced', async () => {
    fetchMock.mockResolvedValueOnce(res(gistBody()));
    await pushGist(CFG, '{}', { lastSeenUpdatedAt: '2020-01-01T00:00:00Z', force: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(call(0).init.method).toBe('PATCH');
  });
});

describe('createGist', () => {
  it('creates a secret gist and returns its id', async () => {
    fetchMock.mockResolvedValue(res(gistBody({ id: 'newid' })));
    const { gistId, snapshot } = await createGist({ token: 'ghp_test', fileName: 'b.json' }, '{"a":1}');

    expect(gistId).toBe('newid');
    expect(snapshot.content).toBe('{"a":1}');

    const { url, init } = call();
    expect(url).toBe('https://api.github.com/gists');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.public).toBe(false); // secret, never public
    expect(body.files['b.json'].content).toBe('{"a":1}');
  });
});

describe('verifyToken', () => {
  it('returns the login for a good token', async () => {
    fetchMock.mockResolvedValue(res({ login: 'm-velichkov' }));
    await expect(verifyToken('ghp_test')).resolves.toEqual({ login: 'm-velichkov' });
    expect(call().url).toBe('https://api.github.com/user');
  });

  it('rejects an empty token without a request', async () => {
    await expect(verifyToken('')).rejects.toMatchObject({ code: 'not_configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a rejected token to unauthorized', async () => {
    fetchMock.mockResolvedValue(res({ message: 'Bad credentials' }, { status: 401 }));
    await expect(verifyToken('nope')).rejects.toMatchObject({ code: 'unauthorized' });
  });
});

describe('normaliseGistId', () => {
  it('extracts the id from every shape a person might paste', () => {
    expect(normaliseGistId('https://gist.github.com/m-velichkov/9f2c8a')).toBe('9f2c8a');
    expect(normaliseGistId('https://gist.github.com/9f2c8a')).toBe('9f2c8a');
    expect(normaliseGistId('gist.github.com/user/abc123def')).toBe('abc123def');
    expect(normaliseGistId('  9f2c8a  ')).toBe('9f2c8a');
    expect(normaliseGistId('/9f2c8a/')).toBe('9f2c8a');
  });
});
