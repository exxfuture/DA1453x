import { ReactNode } from 'react';
import { useAuth } from 'react-oidc-context';
import { Role, roleOf } from '../auth/oidc';
import { Alert } from './ui/Alert';

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
