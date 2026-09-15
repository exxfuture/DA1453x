import { ReactNode } from 'react';
import { useAuth } from 'react-oidc-context';
import { Role, roleOf } from '../auth/oidc';
import { Alert } from './ui/Alert';

/**
 * Route gate by role, derived from the `realm_access.roles` claim in the JWT.
 *
 * **This is navigation, not authorisation** (review FE-33). It exists so a user
 * is not shown pages that would only fail for them, and it can be bypassed by
 * anyone willing to edit their own client state. The actual security boundary is
 * server-side and independent: every endpoint re-derives the caller's role from
 * the bearer token — `backend/.../security/Role.java#fromRealmRoles` (whose
 * priority order `auth/oidc.ts#primaryRole` deliberately mirrors) plus the
 * per-controller checks, with consent-scoped data access enforced in the query
 * layer and refusals written to `audit_log` as `access.denied`. See
 * `backend/README.md` and `../../ARCHITECTURE_V3.html` §6. Removing this
 * component would degrade the UX; it would not grant anybody access to anything.
 */
export function RequireRole({ allow, children }: { allow: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  const role = roleOf(user);

  if (!role || !allow.includes(role)) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <Alert status="warning">Not available for your role.</Alert>
      </div>
    );
  }

  return <>{children}</>;
}
