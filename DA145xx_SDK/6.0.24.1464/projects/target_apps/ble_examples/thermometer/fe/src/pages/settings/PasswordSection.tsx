import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { redirectToChangePassword } from '../../auth/oidc';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

/**
 * Password change for every role — a redirect, not a form.
 *
 * No password field exists anywhere in this app: the button sends the browser
 * into Keycloak's own `kc_action=UPDATE_PASSWORD` required-action form (the same
 * mechanism its Account Console uses), which verifies identity via the existing
 * SSO session, enforces the realm's password policy, and redirects back here on
 * completion or cancellation.
 */
export function PasswordSection() {
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setRedirecting(true);
    setError(null);
    try {
      await redirectToChangePassword();
    } catch (err) {
      setRedirecting(false);
      setError(err instanceof Error ? err.message : 'Could not start the password change flow.');
    }
  };

  return (
    <Card
      density="compact"
      header={
        <h2 className="flex items-center gap-2 text-h3 font-semibold text-ink-primary">
          <KeyRound className="size-4" aria-hidden />
          Password
        </h2>
      }
    >
      <p className="mb-3 text-caption text-ink-muted">
        Changing your password takes you to Keycloak's own secure form, then brings you back here.
      </p>
      <Button type="button" size="sm" loading={redirecting} onClick={() => void handleClick()}>
        Change password
      </Button>
      {error && (
        <Alert status="danger" className="mt-3">
          {error}
        </Alert>
      )}
    </Card>
  );
}
