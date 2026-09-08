/**
 * GitHub Gist sync -- the app's only network dependency.
 *
 * There is no backend. A single secret Gist, shared by both people, is the
 * backup and the hand-off point between devices. This module is the whole
 * "API layer": four operations against api.github.com.
 *
 *   pullGist(cfg)            GET    /gists/:id          read the document
 *   pushGist(cfg, content)   PATCH  /gists/:id          overwrite the document
 *   createGist(cfg, content) POST   /gists              first-time setup
 *   verifyToken(token)       GET    /user               check the credential
 *
 * Conflict rule (from the spec): every successful pull or push records the
 * gist's `updated_at`. Before pushing, the current `updated_at` is fetched and
 * compared. If it moved, the other person wrote first and the caller must
 * surface a warning instead of silently clobbering their work.
 */

const API_ROOT = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 20_000;

export interface GistConfig {
  gistId: string;
  fileName: string;
  token: string;
}

export type SyncErrorCode =
  | 'not_configured'
  | 'unauthorized'
  | 'not_found'
  | 'file_missing'
  | 'rate_limited'
  | 'network'
  | 'timeout'
  | 'conflict'
  | 'server'
  | 'invalid_content';

export class SyncError extends Error {
  readonly code: SyncErrorCode;
  /** Present on 'conflict': what the remote says now vs. what we last saw. */
  readonly remoteUpdatedAt?: string;
  readonly lastSeenUpdatedAt?: string | null;

  constructor(code: SyncErrorCode, message: string, extra: Partial<SyncError> = {}) {
    super(message);
    this.name = 'SyncError';
    this.code = code;
    this.remoteUpdatedAt = extra.remoteUpdatedAt;
    this.lastSeenUpdatedAt = extra.lastSeenUpdatedAt;
  }
}

export interface GistSnapshot {
  content: string;
  updatedAt: string;
  /** Handy for the "open the gist" link in Settings. */
  htmlUrl: string;
}

function assertConfigured(cfg: GistConfig, needsId = true): void {
  if (!cfg.token) {
    throw new SyncError('not_configured', 'Add a GitHub token in Settings first.');
  }
  if (needsId && !cfg.gistId) {
    throw new SyncError('not_configured', 'Add the shared Gist id in Settings first.');
  }
}

async function request(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${API_ROOT}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new SyncError('timeout', 'GitHub did not respond in time. Check your connection and retry.');
    }
    throw new SyncError('network', 'Could not reach GitHub. Check your connection.');
  } finally {
    clearTimeout(timer);
  }
}

/** Turn a non-2xx response into a typed error with a message worth showing. */
async function fail(res: Response): Promise<never> {
  let detail = '';
  try {
    const body = (await res.json()) as { message?: string };
    detail = body.message ?? '';
  } catch {
    /* body wasn't JSON; the status is enough */
  }

  switch (res.status) {
    case 401:
      throw new SyncError('unauthorized', 'GitHub rejected the token. Generate a new one with the "gist" scope.');
    case 403:
      // 403 here is nearly always secondary rate limiting or a missing scope.
      throw new SyncError(
        res.headers.get('X-RateLimit-Remaining') === '0' ? 'rate_limited' : 'unauthorized',
        detail || 'GitHub refused the request. The token may be missing the "gist" scope.',
      );
    case 404:
      throw new SyncError(
        'not_found',
        'Gist not found. Check the id, and make sure this token belongs to an account that can see it.',
      );
    case 422:
      throw new SyncError('invalid_content', detail || 'GitHub rejected the file contents.');
    default:
      throw new SyncError('server', detail || `GitHub returned ${res.status}.`);
  }
}

interface GistApiResponse {
  updated_at: string;
  html_url: string;
  files: Record<string, { content?: string; truncated?: boolean; raw_url?: string } | null>;
}

async function readGist(cfg: GistConfig): Promise<GistApiResponse> {
  // cache: 'no-store' matters: without it a phone can re-read a stale response
  // and "successfully" pull yesterday's budget.
  const res = await request(`/gists/${encodeURIComponent(cfg.gistId)}`, cfg.token, { cache: 'no-store' });
  if (!res.ok) await fail(res);
  return (await res.json()) as GistApiResponse;
}

/** Current `updated_at` without downloading the file. Used for the pre-push check. */
export async function fetchRemoteUpdatedAt(cfg: GistConfig): Promise<string> {
  assertConfigured(cfg);
  return (await readGist(cfg)).updated_at;
}

export async function pullGist(cfg: GistConfig): Promise<GistSnapshot> {
  assertConfigured(cfg);
  const gist = await readGist(cfg);

  const file = gist.files[cfg.fileName];
  if (!file) {
    const available = Object.keys(gist.files).filter(Boolean);
    throw new SyncError(
      'file_missing',
      available.length
        ? `The gist has no file called "${cfg.fileName}". It contains: ${available.join(', ')}.`
        : `The gist has no file called "${cfg.fileName}".`,
    );
  }

  // Files over ~1MB come back truncated with a raw_url instead of content.
  let content = file.content ?? '';
  if (file.truncated && file.raw_url) {
    const raw = await fetch(file.raw_url, { cache: 'no-store' });
    if (!raw.ok) throw new SyncError('server', 'Could not download the full gist contents.');
    content = await raw.text();
  }
  if (!content.trim()) throw new SyncError('invalid_content', 'The gist file is empty.');

  return { content, updatedAt: gist.updated_at, htmlUrl: gist.html_url };
}

export interface PushOptions {
  /**
   * The `updated_at` this device last saw. If the remote has moved on, the push
   * is refused with a 'conflict' error unless `force` is set.
   */
  lastSeenUpdatedAt: string | null;
  force?: boolean;
}

export async function pushGist(cfg: GistConfig, content: string, opts: PushOptions): Promise<GistSnapshot> {
  assertConfigured(cfg);

  if (!opts.force) {
    const remoteUpdatedAt = await fetchRemoteUpdatedAt(cfg);
    // A first-ever push has nothing to compare against, so it is allowed
    // through; after that any drift means someone else wrote first.
    if (opts.lastSeenUpdatedAt !== null && remoteUpdatedAt !== opts.lastSeenUpdatedAt) {
      throw new SyncError('conflict', 'The shared gist changed since your last sync.', {
        remoteUpdatedAt,
        lastSeenUpdatedAt: opts.lastSeenUpdatedAt,
      });
    }
  }

  const res = await request(`/gists/${encodeURIComponent(cfg.gistId)}`, cfg.token, {
    method: 'PATCH',
    body: JSON.stringify({ files: { [cfg.fileName]: { content } } }),
  });
  if (!res.ok) await fail(res);
  const gist = (await res.json()) as GistApiResponse;
  return { content, updatedAt: gist.updated_at, htmlUrl: gist.html_url };
}

/** Create the shared gist (secret by default) and return its id. */
export async function createGist(
  cfg: Pick<GistConfig, 'token' | 'fileName'>,
  content: string,
): Promise<{ gistId: string; snapshot: GistSnapshot }> {
  assertConfigured({ ...cfg, gistId: '' }, false);
  const res = await request('/gists', cfg.token, {
    method: 'POST',
    body: JSON.stringify({
      description: 'Budgetinho shared budget',
      public: false, // secret gist: unlisted, but anyone with the URL can read it
      files: { [cfg.fileName]: { content } },
    }),
  });
  if (!res.ok) await fail(res);
  const gist = (await res.json()) as GistApiResponse & { id: string };
  return {
    gistId: gist.id,
    snapshot: { content, updatedAt: gist.updated_at, htmlUrl: gist.html_url },
  };
}

export async function verifyToken(token: string): Promise<{ login: string }> {
  if (!token) throw new SyncError('not_configured', 'Enter a token first.');
  const res = await request('/user', token, { cache: 'no-store' });
  if (!res.ok) await fail(res);
  const user = (await res.json()) as { login: string };
  return { login: user.login };
}

/** Accepts a full gist URL or a bare id and returns the id. */
export function normaliseGistId(input: string): string {
  const trimmed = input.trim();
  const match = /gist\.github\.com\/(?:[^/]+\/)?([0-9a-f]+)/i.exec(trimmed);
  if (match) return match[1]!;
  return trimmed.replace(/^\/+|\/+$/g, '');
}
