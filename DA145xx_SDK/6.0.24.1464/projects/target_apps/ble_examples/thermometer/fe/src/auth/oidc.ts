import { User, UserManager, WebStorageStateStore } from 'oidc-client-ts';

const KEYCLOAK_URL = import.meta.env.VITE_KEYCLOAK_URL ?? 'http://localhost:8082';
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

/**
 * Standard OAuth2 Authorization Code + PKCE flow against Keycloak (realm
 * `thermometer`, public client `thermometer-web` — standardFlowEnabled with
 * PKCE required, directAccessGrantsEnabled OFF; see
 * ../../../deploy/keycloak/realm-export.json). Login, logout, "forgot
 * password", and "change password" are all handled by Keycloak's own hosted
 * UI via browser redirects — this app never sees a raw credential.
 *
 * The refresh token is persisted in localStorage (survives reloads) and
 * `automaticSilentRenew` redeems a fresh access token in the background
 * before it expires, so the session lasts until Keycloak's SSO session
 * itself ends (expiry, explicit logout, or an admin revoking the session).
 */
export const userManager = new UserManager({
  authority: `${KEYCLOAK_URL}/realms/${REALM}`,
  client_id: CLIENT_ID,
  redirect_uri: `${window.location.origin}/`,
  post_logout_redirect_uri: `${window.location.origin}/`,
  response_type: 'code',
  scope: 'openid profile email',
  userStore: new WebStorageStateStore({ store: window.localStorage }),
  automaticSilentRenew: true,
  monitorSession: true,
});

// react-oidc-context's useAuth() gives components reactive access to the
// current user; api/client.ts and live/mqttClient.ts are plain modules
// outside React that need the token/subject synchronously (a fetch/topic
// build can't await a Promise mid-call), so this mirrors userManager's own
// state into a synchronous cache via its event stream instead.
let cachedUser: User | null = null;

void userManager.getUser().then((user) => {
  cachedUser = user;
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

export function getAuthSubject(): string | null {
  return cachedUser?.profile.sub ?? null;
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
