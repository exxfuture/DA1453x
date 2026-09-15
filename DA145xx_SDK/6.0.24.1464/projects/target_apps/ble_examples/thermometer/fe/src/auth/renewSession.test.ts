import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The real `renewSession()` single-flight, over a fake UserManager
 * (review FE-09 / FE-11).
 *
 * `api/client.test.ts` proves the REST client calls this once per burst of
 * 401s; this proves the function itself only redeems the refresh token once,
 * which is the property that stops concurrent renewals from invalidating each
 * other's token at Keycloak.
 *
 * `oidc-client-ts` is mocked whole because importing ../auth/oidc constructs a
 * UserManager at module scope, which would otherwise try to reach the
 * discovery document.
 */

const signinSilent = vi.fn<() => Promise<{ access_token: string } | null>>();

vi.mock('oidc-client-ts', () => ({
  UserManager: class {
    signinSilent = signinSilent;
    getUser = () => Promise.resolve(null);
    events = {
      addUserLoaded: () => undefined,
      addUserUnloaded: () => undefined,
      addAccessTokenExpired: () => undefined,
    };
  },
  WebStorageStateStore: class {},
  User: class {},
}));

const { renewSession } = await import('./oidc');

/** A promise we resolve by hand, so several callers can be in flight at once. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  signinSilent.mockReset();
});

describe('renewSession', () => {
  it('redeems the refresh token once for any number of concurrent callers', async () => {
    const pending = deferred<{ access_token: string }>();
    signinSilent.mockReturnValue(pending.promise);

    const callers = [renewSession(), renewSession(), renewSession(), renewSession()];
    pending.resolve({ access_token: 'fresh' });

    await expect(Promise.all(callers)).resolves.toEqual([true, true, true, true]);
    expect(signinSilent).toHaveBeenCalledOnce();
  });

  it('hands every concurrent caller the same promise', async () => {
    const pending = deferred<{ access_token: string }>();
    signinSilent.mockReturnValue(pending.promise);

    expect(renewSession()).toBe(renewSession());

    // Settled before the test ends: the in-flight promise is module state, so a
    // renewal left hanging here would be adopted by every later test.
    pending.resolve({ access_token: 'fresh' });
    await renewSession();
  });

  it('starts a new renewal once the previous one has settled', async () => {
    signinSilent.mockResolvedValue({ access_token: 'first' });
    await expect(renewSession()).resolves.toBe(true);

    signinSilent.mockResolvedValue({ access_token: 'second' });
    await expect(renewSession()).resolves.toBe(true);

    expect(signinSilent).toHaveBeenCalledTimes(2);
  });

  it('resolves false instead of throwing when the refresh token is invalid', async () => {
    // Callers are `await`ed on a 401 path; a rejection here would replace the
    // request's own actionable error with an auth-library one.
    signinSilent.mockRejectedValue(new Error('invalid_grant'));
    await expect(renewSession()).resolves.toBe(false);
  });

  it('clears the in-flight promise after a failure, so the next 401 retries', async () => {
    signinSilent.mockRejectedValue(new Error('network'));
    await expect(renewSession()).resolves.toBe(false);

    signinSilent.mockResolvedValue({ access_token: 'recovered' });
    await expect(renewSession()).resolves.toBe(true);
    expect(signinSilent).toHaveBeenCalledTimes(2);
  });

  it('resolves false when the IdP returns no user', async () => {
    signinSilent.mockResolvedValue(null);
    await expect(renewSession()).resolves.toBe(false);
  });
});
