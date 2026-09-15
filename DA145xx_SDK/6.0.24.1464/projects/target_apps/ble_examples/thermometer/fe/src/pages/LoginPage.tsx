import { Thermometer } from 'lucide-react';
import { useAuth } from 'react-oidc-context';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Alert } from '../components/ui/Alert';

/**
 * The demo accounts from the dev realm (`../../../deploy/keycloak/realm-export.json`).
 *
 * Rendered ONLY when `import.meta.env.DEV` — i.e. under `npm run dev`, never in
 * anything `vite build` produces, which is what the container serves. Vite
 * statically replaces that flag with `false` in a build, so the constant folds
 * away and the strings are not even present in the bundle. Previously this list
 * shipped unconditionally and handed every visitor a working admin credential
 * (review FE-01); the accounts are also written up in `../../README.md`, which
 * is where to look when the local stack needs them.
 */
const DEMO_ACCOUNTS: Array<[username: string, password: string]> = [
  ['customer1', 'Customer1!'],
  ['customer2', 'Customer2!'],
  ['doctor1', 'Doctor1!'],
  ['admin1', 'Admin01!'],
];

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
          <p className="mb-4 mt-1 text-caption text-ink-muted">
            Signs you in through Keycloak. Forgot your password (e.g. after using Settings → "Change
            password")? Keycloak's own sign-in page has a reset-password link.
          </p>

          {import.meta.env.DEV && (
            <div className="mb-4">
              <p className="mb-1 text-caption text-ink-muted">
                Dev build only — demo accounts from the local realm (password ≠ username, the realm
                requires upper/lower/digit/special-char):
              </p>
              <ul className="space-y-0.5 text-caption text-ink-muted">
                {DEMO_ACCOUNTS.map(([username, password]) => (
                  <li key={username}>
                    <code className="font-mono text-ink-primary">{username}</code> /{' '}
                    <code className="font-mono text-ink-primary">{password}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}

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
