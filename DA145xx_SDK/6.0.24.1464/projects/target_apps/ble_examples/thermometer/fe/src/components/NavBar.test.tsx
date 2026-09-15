import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Role } from '../auth/oidc';

/**
 * The nav's active-link matching (review FE-32) and role-driven link set.
 *
 * `location.pathname.startsWith(to)` had no boundary check, so a future
 * `/history-export` route would have lit up `/history`. The fix has to keep
 * `/admin` matching every `/admin/*` sub-path, which is what the admin console's
 * deep links rely on — so both halves need pinning.
 */

vi.mock('react-oidc-context', () => ({
  useAuth: () => ({
    user: { profile: { preferred_username: 'customer1', realm_access: { roles: [currentRole] } } },
    signoutRedirect: () => Promise.resolve(),
  }),
}));

// The MQTT session is torn down on sign-out; irrelevant to routing.
vi.mock('../live/mqttClient', () => ({ closeLiveSession: () => undefined }));

let currentRole: Role = 'customer';

const { NavBar } = await import('./NavBar');

function renderAt(pathname: string, role: Role = 'customer') {
  currentRole = role;
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <NavBar />
    </MemoryRouter>,
  );
}

/** The desktop link set marks the current page with aria-current. */
function activeLinkNames(): string[] {
  return screen
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page')
    .map((link) => link.textContent ?? '');
}

describe('NavBar active link', () => {
  it('marks the exact route as current', () => {
    renderAt('/history');
    expect(activeLinkNames()).toContain('History');
  });

  it('does not mark a route whose path is merely a prefix of the current one (FE-32)', () => {
    // The regression this pins: a sibling route that happens to start with an
    // existing path must not light up that path's nav entry.
    renderAt('/history-export');
    expect(activeLinkNames()).not.toContain('History');
  });

  it('keeps a parent route current on its sub-paths', () => {
    renderAt('/admin/rollouts/abc-123', 'admin');
    expect(activeLinkNames()).toContain('Admin');
  });

  it('shows only the signed-in roles links', () => {
    renderAt('/dashboard', 'doctor');
    const labels = screen.getAllByRole('link').map((link) => link.textContent);
    expect(labels).toContain('Patients');
    expect(labels).not.toContain('Connect');
  });
});
