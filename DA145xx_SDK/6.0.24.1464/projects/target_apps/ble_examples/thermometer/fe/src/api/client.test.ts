import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The REST client's 401 handling (review FE-09 / FE-11).
 *
 * `auth/oidc.ts` is mocked, because the thing under test is the *number* of
 * renewals a burst of 401s triggers — and that is decided by the single-flight
 * wrapper, not by oidc-client-ts. The real `renewSession()` has its own
 * single-flight test below, driven through the same mock-free promise it returns.
 */

const signinSilent = vi.fn<() => Promise<{ access_token: string } | null>>();

vi.mock('../auth/oidc', () => {
  // The real renewSession() implementation, over a fake UserManager: that keeps
  // the de-duplication logic itself under test rather than re-implementing it.
  let renewal: Promise<boolean> | null = null;
  let token: string | null = 'expired-token';
  return {
    getAuthToken: () => token,
    renewSession: () => {
      renewal ??= signinSilent()
        .then((user) => {
          token = user ? user.access_token : token;
          return user != null;
        })
        .catch(() => false)
        .finally(() => {
          renewal = null;
        });
      return renewal;
    },
  };
});

const { api } = await import('./client');

let fetchMock: ReturnType<typeof vi.fn>;

/** Answers 401 for the first `unauthorizedCount` calls, then 200 with `body`. */
function respondWith(unauthorizedCount: number, body: unknown = { ok: true }) {
  let remaining = unauthorizedCount;
  return vi.fn(() => {
    if (remaining > 0) {
      remaining -= 1;
      return Promise.resolve(new Response('{"message":"expired"}', { status: 401 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
  });
}

beforeEach(() => {
  signinSilent.mockReset();
  signinSilent.mockResolvedValue({ access_token: 'fresh-token' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('request()', () => {
  it('sends the bearer token and returns the parsed body', async () => {
    fetchMock = respondWith(0, { id: 'u1', username: 'customer1' });
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.me()).resolves.toMatchObject({ username: 'customer1' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/me');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer expired-token');
  });

  it('renews once and retries a single 401', async () => {
    fetchMock = respondWith(1);
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.me()).resolves.toBeTruthy();

    expect(signinSilent).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The retry must carry the NEW token, not the one that just 401'd.
    const retryInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect((retryInit.headers as Record<string, string>).Authorization).toBe('Bearer fresh-token');
  });

  it('de-duplicates the renewal when several requests 401 together (FE-09)', async () => {
    // The Dashboard's four queries mounting as the access token expires. Each
    // 401s once, then succeeds — but there must be exactly ONE renewal between
    // them, or concurrent refresh-token redemptions race and one invalidates the
    // token another is about to retry with.
    let pendingUnauthorized = 4;
    fetchMock = vi.fn(() => {
      if (pendingUnauthorized > 0) {
        pendingUnauthorized -= 1;
        return Promise.resolve(new Response('{}', { status: 401 }));
      }
      return Promise.resolve(
        new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    // Deliberately not awaited one at a time: they have to be in flight together.
    const results = await Promise.all([api.me(), api.listDevices(), api.doctors(), api.consents()]);

    expect(results).toHaveLength(4);
    expect(signinSilent).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(8); // four 401s + four retries
  });

  it('starts a fresh renewal for a later 401, rather than replaying the first result', async () => {
    fetchMock = respondWith(1);
    vi.stubGlobal('fetch', fetchMock);
    await api.me();

    fetchMock = respondWith(1);
    vi.stubGlobal('fetch', fetchMock);
    await api.me();

    expect(signinSilent).toHaveBeenCalledTimes(2);
  });

  it('surfaces the API error message when the retry also fails', async () => {
    signinSilent.mockRejectedValue(new Error('refresh token expired'));
    fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response('{"message":"Full authentication is required"}', {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    // A failed renewal must not throw its own error: the request's own failure is
    // what the caller can act on.
    await expect(api.me()).rejects.toThrow('Full authentication is required');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-401 failure', async () => {
    fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response('{"message":"Device already claimed"}', {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.claimDevice('AA:BB:CC:DD:EE:FF')).rejects.toThrow('Device already claimed');
    expect(signinSilent).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('falls back to a status line when the error body is not JSON', async () => {
    fetchMock = vi.fn(() => Promise.resolve(new Response('<html>502</html>', { status: 502 })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.me()).rejects.toThrow(/GET \/api\/me failed: 502/);
  });

  it('treats 204 as an empty result rather than failing to parse it', async () => {
    fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.releaseDevice('AA:BB:CC:DD:EE:FF')).resolves.toBeUndefined();
  });

  it('POSTs the live-credential mint with no body (FE-03)', async () => {
    fetchMock = respondWith(0, {
      username: 'user-u1',
      password: 'secret',
      userId: 'u1',
      expiresAt: '2026-09-15T00:00:00Z',
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.mintLiveCredentials()).resolves.toMatchObject({ userId: 'u1' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/live/credentials');
    expect(init.method).toBe('POST');
  });
});
