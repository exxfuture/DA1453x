import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Role } from './auth/oidc';

/**
 * Route-table smoke tests (review FE-12 / FE-31 / FE-33).
 *
 * Three things at once, all of which a unit test can see and the e2e suite
 * cannot cheaply:
 *  - the **react-router-dom 7** upgrade taken for FE-12's open-redirect advisory
 *    still drives this declarative `BrowserRouter` route table;
 *  - the doctor/admin routes are `React.lazy()` (FE-31) and actually resolve
 *    behind the shared `Suspense` fallback;
 *  - `RequireRole` refuses a route the signed-in role does not allow (FE-33) —
 *    as navigation, with the real boundary server-side.
 *
 * `react-oidc-context` is mocked rather than driven: a real `AuthProvider` would
 * try to reach Keycloak's discovery document.
 */

let currentRole: Role = 'doctor';

vi.mock('react-oidc-context', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({
    isLoading: false,
    isAuthenticated: true,
    error: undefined,
    user: { profile: { preferred_username: 'user1', realm_access: { roles: [currentRole] } } },
    signinRedirect: () => Promise.resolve(),
    signoutRedirect: () => Promise.resolve(),
  }),
}));

// Constructing a real UserManager reaches the network at import time.
vi.mock('oidc-client-ts', () => ({
  UserManager: class {
    getUser = () => Promise.resolve(null);
    signinSilent = () => Promise.resolve(null);
    events = {
      addUserLoaded: () => undefined,
      addUserUnloaded: () => undefined,
      addAccessTokenExpired: () => undefined,
    };
  },
  WebStorageStateStore: class {},
  User: class {},
}));

vi.mock('./live/mqttClient', () => ({
  closeLiveSession: () => undefined,
  subscribeLive: () => () => undefined,
  publishMeasurement: () => Promise.resolve(),
}));

// Every page mounts queries; answering them all with empty data keeps the test
// about routing rather than about any one page's content.
vi.mock('./api/client', () => {
  const empty = () => Promise.resolve([]);
  return {
    api: {
      me: () =>
        Promise.resolve({
          id: 'u1',
          username: 'user1',
          email: null,
          role: currentRole,
          displayName: null,
          temperatureUnit: 'CELSIUS' as const,
        }),
      listDevices: empty,
      availableDevices: empty,
      doctorPatients: empty,
      doctorPatientsSummary: empty,
      consents: empty,
      doctors: empty,
      listPatientEvents: empty,
      doctorAuditLog: () => Promise.resolve({ content: [], page: 0, size: 10, totalElements: 0, totalPages: 1 }),
      doctorConsentActivity: () =>
        Promise.resolve({ content: [], page: 0, size: 10, totalElements: 0, totalPages: 1 }),
      adminUserGrowth: () => Promise.resolve({ total: 0, byRole: [], signupsLast90Days: [] }),
      adminUsers: () => Promise.resolve({ content: [], page: 0, size: 25, totalElements: 0, totalPages: 1 }),
    },
  };
});

const App = (await import('./App')).default;

function renderAt(pathname: string, role: Role) {
  currentRole = role;
  window.history.replaceState({}, '', pathname);
  return render(<App />);
}

describe('App routing', () => {
  it('resolves the lazy doctor dashboard behind the Suspense fallback (FE-31)', async () => {
    renderAt('/dashboard', 'doctor');

    // "Your patients at a glance" only exists in the lazily-loaded
    // pages/doctor/DoctorDashboardPage chunk.
    expect(await screen.findByText('Your patients at a glance')).toBeInTheDocument();
  });

  it('resolves the lazy admin console', async () => {
    renderAt('/admin/users', 'admin');

    expect(await screen.findByRole('heading', { name: 'Admin', level: 1 })).toBeInTheDocument();
  });

  it('renders the statically-imported customer dashboard', async () => {
    renderAt('/dashboard', 'customer');

    expect(await screen.findByRole('heading', { name: 'Dashboard', level: 1 })).toBeInTheDocument();
  });

  it('refuses a route the signed-in role does not allow (FE-33)', async () => {
    renderAt('/admin/users', 'doctor');

    expect(await screen.findByText('Not available for your role.')).toBeInTheDocument();
  });

  it('sends each role to its own home from /', async () => {
    renderAt('/', 'admin');
    expect(await screen.findByRole('heading', { name: 'Admin', level: 1 })).toBeInTheDocument();
  });

  it('falls back home from an unknown deep link rather than a blank page', async () => {
    renderAt('/does-not-exist', 'customer');
    expect(await screen.findByRole('heading', { name: 'Dashboard', level: 1 })).toBeInTheDocument();
  });
});
