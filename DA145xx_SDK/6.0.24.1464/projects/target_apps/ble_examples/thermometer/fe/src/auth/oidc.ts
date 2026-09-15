import { User, UserManager, WebStorageStateStore } from 'oidc-client-ts';
import { keycloakUrl } from '../config/env';

const REALM = 'thermometer';
const CLIENT_ID = 'thermometer-web';

export type Role = 'customer' | 'doctor' | 'admin';

/** Mirrors the backend's Role.fromRealmRoles priority (security/Role.java) — first match wins. */
export function primaryRole(roles: string[]): Role | null {
  const known: Role[] = ['admin', 'doctor', 'customer'];
  return known.find((role) => roles.includes(role)) ?? null;
}

function rolesOf(user: User | null | undefined): string[] {
  const realmAccess = user?.profile?.realm_access as { roles?: string[] } | undefined;
  return realmAccess?.roles ?? [];
}

export function roleOf(user: User | null | undefined): Role | null {
  return primaryRole(rolesOf(user));
}

/** Minimal `Storage` surface oidc-client-ts's WebStorageStateStore uses. */
type StateStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/**
 * In-memory stand-in used when no usable Web Storage exists: unit tests under
 * vitest/Node, and a browser that has blocked site data. Without it, importing
 * this module would leave a rejected promise behind (review FE-02 / the
 * `getUser()` unhandled rejection) or throw outright.
 */
function memoryStorage(): StateStorage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    removeItem: (key: string) => void entries.delete(key),
  };
}

/**
 * `window.sessionStorage` when it is genuinely usable, otherwise memory.
 *
 * The feature test is deliberately behavioural rather than a `typeof window`
 * check: Node ≥ 24 exposes a partially-implemented global `localStorage`/
 * `sessionStorage` under vitest that has no `getItem`, and Safari's private
 * mode throws on access. Both must degrade, not explode.
 */
function stateStorage(): StateStorage {
  try {
    const store = typeof window === 'undefined' ? undefined : window.sessionStorage;
    if (store && typeof store.getItem === 'function' && typeof store.setItem === 'function') {
      const probe = '__thermometer_probe__';
      store.setItem(probe, '1');
      store.removeItem(probe);
      return store;
    }
  } catch {
    // blocked/unavailable site data — fall through to memory
  }
  return memoryStorage();
}

/**
 * Standard OAuth2 Authorization Code + PKCE flow against Keycloak (realm
 * `thermometer`, public client `thermometer-web` — standardFlowEnabled with
 * PKCE required, directAccessGrantsEnabled OFF; see
 * ../../../deploy/keycloak/realm-export.json). Login, logout, "forgot
 * password", and "change password" are all handled by Keycloak's own hosted
 * UI via browser redirects — this app never sees a raw credential.
 *
 * TOKEN STORAGE (review FE-02): the user object — access **and refresh**
 * token — lives in `sessionStorage`, never `localStorage`. It is therefore
 * scoped to one tab and gone when that tab closes, so an XSS foothold cannot
 * lift a refresh token that outlives the session (a durable one would let an
 * attacker keep minting access tokens for a health-data account long after the
 * user walked away). `automaticSilentRenew` still refreshes the access token in
 * the background for as long as the tab is open, so nothing about an active
 * session changes; the cost is that a reopened tab has no local session and
 * signs in again — which is one redirect, not a password prompt, while
 * Keycloak's own SSO session is still valid. The trade-off is written up in
 * ../../README.md ("Security posture").
 */
export const userManager = new UserManager({
  authority: `${keycloakUrl()}/realms/${REALM}`,
  client_id: CLIENT_ID,
  redirect_uri: `${window.location.origin}/`,
  post_logout_redirect_uri: `${window.location.origin}/`,
  response_type: 'code',
  scope: 'openid profile email',
  userStore: new WebStorageStateStore({ store: stateStorage() as Storage }),
  // PKCE verifier / nonce / state for an in-flight redirect: same per-tab
  // lifetime as the user store, so the two can never disagree.
  stateStore: new WebStorageStateStore({ store: stateStorage() as Storage }),
  automaticSilentRenew: true,
  monitorSession: true,
});

// react-oidc-context's useAuth() gives components reactive access to the
// current user; api/client.ts is a plain module outside React that needs the
// access token synchronously (a fetch can't await a Promise mid-call), so this
// mirrors userManager's own state into a synchronous cache via its event stream
// instead.
//
// Only the token is exposed. There is deliberately no `getAuthSubject()` any
// more: the JWT `sub` used to build the MQTT publish topic's user segment, which
// review FE-03 replaced with the server-asserted id from the minted broker
// credential — re-adding a subject getter here would invite that back.
let cachedUser: User | null = null;

// `.catch` is not optional: a storage layer that rejects here (see
// stateStorage()) must not surface as an unhandled rejection that fails the
// whole test run or spams a production console.
void userManager
  .getUser()
  .then((user) => {
    cachedUser = user;
  })
  .catch(() => {
    cachedUser = null;
  });
userManager.events.addUserLoaded((user) => {
  cachedUser = user;
});
userManager.events.addUserUnloaded(() => {
  cachedUser = null;
});
userManager.events.addAccessTokenExpired(() => {
  cachedUser = null;
});

export function getAuthToken(): string | null {
  return cachedUser && !cachedUser.expired ? cachedUser.access_token : null;
}

/**
 * Single-flight `signinSilent()` (review FE-09).
 *
 * A whole page's queries mount together (Dashboard alone fires me / devices /
 * measurements / annotations), so when the access token expires they all see
 * 401 within the same tick. Each calling `signinSilent()` independently races
 * refresh-token redemptions against Keycloak: with refresh-token rotation on,
 * one renewal invalidates the token another in-flight renewal is about to use,
 * and the loser's retry fails for no reason. Sharing one promise means one
 * renewal per expiry, whatever the fan-out.
 *
 * Resolves to true when a renewed user is in hand. Never throws — callers
 * decide what a failed renewal means for them.
 */
let renewal: Promise<boolean> | null = null;

export function renewSession(): Promise<boolean> {
  renewal ??= userManager
    .signinSilent()
    .then((user) => user != null)
    .catch(() => false)
    .finally(() => {
      // Cleared only once settled, so the next 401 after this one starts a
      // fresh attempt instead of replaying a stale result.
      renewal = null;
    });
  return renewal;
}

/**
 * Redirects into Keycloak's own hosted "update password" required-action
 * form (the same mechanism its Account Console uses) — Keycloak verifies
 * identity via the existing SSO session, enforces the realm's password
 * policy, and redirects back here on completion/cancellation. No password
 * ever passes through this app's own code.
 */
export function redirectToChangePassword(): Promise<void> {
  return userManager.signinRedirect({ extraQueryParams: { kc_action: 'UPDATE_PASSWORD' } });
}
