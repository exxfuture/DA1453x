import { Thermometer } from 'lucide-react';
import { useAuth } from 'react-oidc-context';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Alert } from '../components/ui/Alert';

/**
 * No credential fields here — signing in is a redirect into Keycloak's own
 * hosted login page (standard Authorization Code + PKCE flow, see
 * ../auth/oidc.ts), which also has the "Forgot password?" link Keycloak
 * provides out of the box (`resetPasswordAllowed` in
 * ../../../deploy/keycloak/realm-export.json). This app never sees a raw
 * password.
 */
export function LoginPage() {
  const auth = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Thermometer className="size-10 text-primary-600 dark:text-primary-300" aria-hidden />
          <p className="text-caption uppercase tracking-wide text-ink-muted">Thermometer</p>
        </div>

        <Card>
          <h1 className="font-display text-display font-semibold text-ink-primary">Sign in</h1>
          <p className="mb-2 mt-1 text-caption text-ink-muted">
            Signs you in through Keycloak. Demo accounts (password ≠ username — the realm requires
            upper/lower/digit/special-char passwords):
          </p>
          <ul className="mb-4 space-y-0.5 text-caption text-ink-muted">
            <li>
              <code className="font-mono text-ink-primary">customer1</code> /{' '}
              <code className="font-mono text-ink-primary">Customer1!</code>
            </li>
            <li>
              <code className="font-mono text-ink-primary">customer2</code> /{' '}
              <code className="font-mono text-ink-primary">Customer2!</code>
            </li>
            <li>
              <code className="font-mono text-ink-primary">doctor1</code> /{' '}
              <code className="font-mono text-ink-primary">Doctor1!</code>
            </li>
            <li>
              <code className="font-mono text-ink-primary">admin1</code> /{' '}
              <code className="font-mono text-ink-primary">Admin123!</code>
            </li>
          </ul>
          <p className="mb-4 text-caption text-ink-muted">
            Forgot yours (e.g. after using Settings → "Change password")? Keycloak's own sign-in page has a
            reset-password link.
          </p>

          {auth.error && <Alert status="danger">{auth.error.message}</Alert>}

          <Button
            type="button"
            size="lg"
            className="w-full"
            loading={auth.isLoading}
            onClick={() => void auth.signinRedirect()}
          >
            {auth.isLoading ? 'Redirecting…' : 'Sign in with Keycloak'}
          </Button>
        </Card>
      </div>
    </div>
  );
}
